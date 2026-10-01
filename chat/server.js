'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { WebSocketServer } = require('ws');
const { openDb } = require('./db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 50;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

const AVATAR_COLORS = ['#e8912d', '#2bac76', '#1264a3', '#cd2553', '#7c3085', '#3aa3e3', '#e0a40e', '#4a154b', '#0b7a75', '#9e3c1f'];
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
// Only these upload types are rendered inline by the browser; everything else is forced to download.
const INLINE_FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function safeEqual(a, b) {
  const x = Buffer.from(sha256(String(a ?? '')));
  const y = Buffer.from(sha256(String(b ?? '')));
  return crypto.timingSafeEqual(x, y);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function toId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function createChatServer(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  const inviteCode = options.inviteCode ?? process.env.INVITE_CODE ?? '';
  const workspaceName = options.workspaceName || process.env.WORKSPACE_NAME || 're-ordia';
  const secureCookie = options.secureCookie ?? process.env.COOKIE_SECURE === '1';

  const db = openDb(path.join(dataDir, 'chat.db'));
  const { one, all, run, tx } = db;
  const now = () => Date.now();

  if (!one('SELECT id FROM channels WHERE is_dm = 0 LIMIT 1')) {
    run("INSERT INTO channels (name, topic, is_default, created_at) VALUES ('general', '全社向けのお知らせ・連絡', 1, ?)", now());
    run("INSERT INTO channels (name, topic, is_default, created_at) VALUES ('random', '雑談・なんでも', 1, ?)", now());
  }

  // ---- realtime state --------------------------------------------------------

  /** @type {Map<number, Set<import('ws').WebSocket>>} */
  const sockets = new Map();
  const isOnline = (uid) => sockets.has(uid);

  function sendTo(uid, event) {
    const set = sockets.get(uid);
    if (!set) return;
    const data = JSON.stringify(event);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  function broadcastAll(event, exceptUid) {
    for (const uid of sockets.keys()) if (uid !== exceptUid) sendTo(uid, event);
  }

  const memberIds = (cid) => all('SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY joined_at', cid).map((r) => r.user_id);

  // Public channels are visible to everyone (they can be previewed before joining),
  // so their events go to every connected user; private channels and DMs only to members.
  function broadcastChannel(channel, event, exceptUid) {
    const targets = channel.is_private ? memberIds(channel.id) : [...sockets.keys()];
    for (const uid of targets) if (uid !== exceptUid) sendTo(uid, event);
  }

  // ---- serializers -----------------------------------------------------------

  const userOut = (u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    color: u.color,
    status: u.status,
    isAdmin: !!u.is_admin,
    online: isOnline(u.id),
  });

  const fileOut = (f) => f && {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    url: `/files/${f.id}/${encodeURIComponent(f.name)}`,
    isImage: INLINE_FILE_TYPES.has(f.mime),
  };

  const channelBase = (c) => ({
    id: c.id,
    name: c.name,
    topic: c.topic,
    isPrivate: !!c.is_private,
    isDm: !!c.is_dm,
    isDefault: !!c.is_default,
    memberIds: memberIds(c.id),
  });

  function channelsFor(uid, onlyId = null) {
    const rows = all(
      `SELECT c.*, cm.last_read_id,
         (SELECT COUNT(*) FROM messages m
           WHERE m.channel_id = c.id AND m.id > cm.last_read_id AND m.parent_id IS NULL
             AND m.deleted = 0 AND m.kind = 'message' AND m.user_id <> ?) AS unread,
         (SELECT COUNT(*) FROM mentions mn JOIN messages m ON m.id = mn.message_id
           WHERE mn.user_id = ? AND m.channel_id = c.id AND m.id > cm.last_read_id AND m.deleted = 0) AS mention_count,
         (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id) AS latest_id
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
       WHERE (? IS NULL OR c.id = ?)
       ORDER BY c.name`,
      uid, uid, uid, onlyId, onlyId,
    );
    return rows.map((c) => ({
      ...channelBase(c),
      isMember: true,
      lastReadId: c.last_read_id,
      unread: c.unread,
      mentions: c.mention_count,
      latestId: c.latest_id || 0,
    }));
  }

  function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const reactions = db.raw.prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ph}) ORDER BY created_at`).all(...ids);
    const mentions = db.raw.prepare(`SELECT message_id, user_id FROM mentions WHERE message_id IN (${ph})`).all(...ids);
    const repliers = db.raw.prepare(
      `SELECT parent_id, user_id FROM messages WHERE parent_id IN (${ph}) AND deleted = 0 GROUP BY parent_id, user_id ORDER BY MIN(id)`,
    ).all(...ids);
    const fileIds = [...new Set(rows.map((r) => r.file_id).filter(Boolean))];
    const files = fileIds.length
      ? db.raw.prepare(`SELECT * FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds)
      : [];
    const fileById = new Map(files.map((f) => [f.id, f]));

    return rows.map((r) => {
      const grouped = new Map();
      for (const x of reactions) {
        if (x.message_id !== r.id) continue;
        if (!grouped.has(x.emoji)) grouped.set(x.emoji, []);
        grouped.get(x.emoji).push(x.user_id);
      }
      return {
        id: r.id,
        channelId: r.channel_id,
        userId: r.user_id,
        parentId: r.parent_id,
        kind: r.kind,
        body: r.deleted ? '' : r.body,
        file: r.deleted ? null : fileOut(fileById.get(r.file_id)),
        createdAt: r.created_at,
        editedAt: r.edited_at,
        deleted: !!r.deleted,
        replyCount: r.reply_count,
        lastReplyAt: r.last_reply_at,
        replyUserIds: repliers.filter((x) => x.parent_id === r.id).map((x) => x.user_id).slice(0, 5),
        reactions: [...grouped].map(([emoji, userIds]) => ({ emoji, userIds })),
        mentionIds: mentions.filter((x) => x.message_id === r.id).map((x) => x.user_id),
      };
    });
  }

  const messageById = (id) => hydrate([one('SELECT * FROM messages WHERE id = ?', id)].filter(Boolean))[0];

  // ---- access control ----------------------------------------------------------

  function getChannel(id) {
    const c = one('SELECT * FROM channels WHERE id = ?', toId(id));
    if (!c) throw new HttpError(404, 'チャンネルが見つかりません');
    return c;
  }
  const isMember = (cid, uid) => !!one('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?', cid, uid);
  const canRead = (c, uid) => !c.is_private || isMember(c.id, uid);

  function readableChannel(id, uid) {
    const c = getChannel(id);
    // Private channels the user isn't in are reported as missing so their existence doesn't leak.
    if (!canRead(c, uid)) throw new HttpError(404, 'チャンネルが見つかりません');
    return c;
  }

  function memberChannel(id, uid) {
    const c = readableChannel(id, uid);
    if (!isMember(c.id, uid)) throw new HttpError(403, 'このチャンネルに参加していません');
    return c;
  }

  function getMessage(id, uid) {
    const m = one('SELECT * FROM messages WHERE id = ?', toId(id));
    if (!m) throw new HttpError(404, 'メッセージが見つかりません');
    const c = readableChannel(m.channel_id, uid);
    return { m, c };
  }

  // ---- message helpers --------------------------------------------------------

  function saveMentions(messageId, channel, authorId, body) {
    run('DELETE FROM mentions WHERE message_id = ?', messageId);
    const members = new Set(memberIds(channel.id));
    const targets = new Set();
    for (const match of body.matchAll(/(^|[^\w@])@([a-z0-9._-]+)/gi)) {
      const name = match[2].toLowerCase().replace(/\.+$/, '');
      if (name === 'channel' || name === 'here' || name === 'all') {
        members.forEach((id) => targets.add(id));
      } else {
        const u = one('SELECT id FROM users WHERE username = ?', name);
        if (u && members.has(u.id)) targets.add(u.id);
      }
    }
    targets.delete(authorId);
    for (const t of targets) run('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', messageId, t);
  }

  function insertMessage(channel, uid, body, { parentId = null, fileId = null, kind = 'message' } = {}) {
    const t = now();
    const r = run(
      'INSERT INTO messages (channel_id, user_id, parent_id, kind, body, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      channel.id, uid, parentId, kind, body, fileId, t,
    );
    const id = Number(r.lastInsertRowid);
    if (parentId) run('UPDATE messages SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?', t, parentId);
    if (kind === 'message') saveMentions(id, channel, uid, body);
    run('UPDATE channel_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ? AND last_read_id < ?', id, channel.id, uid, id);
    return id;
  }

  function emitNewMessage(channel, id) {
    const message = messageById(id);
    broadcastChannel(channel, { type: 'message.new', message });
    if (message.parentId) broadcastChannel(channel, { type: 'message.updated', message: messageById(message.parentId) });
    return message;
  }

  function postSystem(channel, uid, body) {
    emitNewMessage(channel, insertMessage(channel, uid, body, { kind: 'system' }));
  }

  function addMember(channel, uid) {
    run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, last_read_id, joined_at) VALUES (?, ?, 0, ?)', channel.id, uid, now());
  }

  function notifyMembership(channel, joinedUids = []) {
    for (const uid of joinedUids) sendTo(uid, { type: 'channel.joined', channel: channelsFor(uid, channel.id)[0] });
    broadcastChannel(channel, { type: 'channel.updated', channel: channelBase(channel) });
  }

  // ---- sessions -----------------------------------------------------------------

  function sessionUser(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const tokenHash = sha256(token);
    const user = one(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      tokenHash, now(),
    );
    return user ? { user, tokenHash } : null;
  }

  function sessionCookie(token, maxAgeSec) {
    return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;
  }

  function startSession(res, uid) {
    const token = crypto.randomBytes(32).toString('base64url');
    run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), uid, now(), now() + SESSION_TTL_MS);
    run('DELETE FROM sessions WHERE expires_at < ?', now());
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000));
  }

  const loginFailures = new Map();
  function checkLoginRate(key) {
    const entry = loginFailures.get(key);
    if (entry && entry.until > now() && entry.count >= LOGIN_MAX_FAILURES) {
      throw new HttpError(429, 'ログイン試行回数が多すぎます。しばらくしてからお試しください');
    }
  }
  function recordLoginFailure(key) {
    const entry = loginFailures.get(key);
    if (!entry || entry.until < now()) loginFailures.set(key, { count: 1, until: now() + LOGIN_WINDOW_MS });
    else entry.count += 1;
  }

  // ---- routes -------------------------------------------------------------------

  const routes = [];
  function route(method, pattern, handler, opts = {}) {
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
    routes.push({ method, re, handler, auth: opts.auth !== false, upload: !!opts.upload });
  }

  route('GET', '/api/config', () => ({ workspaceName, inviteRequired: !!inviteCode }), { auth: false });

  route('POST', '/api/signup', ({ res, body }) => {
    const username = cleanText(body.username, 64).toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(username) || ['channel', 'here', 'all'].includes(username)) {
      throw new HttpError(400, 'ユーザー名は半角英数字と . _ - を使って2〜32文字で入力してください');
    }
    const password = String(body.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'パスワードは8文字以上にしてください');
    if (inviteCode && !safeEqual(body.inviteCode, inviteCode)) throw new HttpError(403, '招待コードが正しくありません');
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'このユーザー名はすでに使われています');

    const displayName = cleanText(body.displayName, 50) || username;
    const user = tx(() => {
      const isFirst = !one('SELECT 1 FROM users LIMIT 1');
      const color = AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)];
      const r = run(
        'INSERT INTO users (username, display_name, password_hash, color, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        username, displayName, hashPassword(password), color, isFirst ? 1 : 0, now(),
      );
      const uid = Number(r.lastInsertRowid);
      for (const c of all('SELECT * FROM channels WHERE is_default = 1')) addMember(c, uid);
      return one('SELECT * FROM users WHERE id = ?', uid);
    });
    startSession(res, user.id);
    broadcastAll({ type: 'user.joined', user: userOut(user) });
    for (const c of all('SELECT * FROM channels WHERE is_default = 1')) {
      broadcastChannel(c, { type: 'channel.updated', channel: channelBase(c) });
      postSystem(c, user.id, 'joined');
    }
    return { user: userOut(user) };
  }, { auth: false });

  route('POST', '/api/login', ({ req, res, body }) => {
    const username = cleanText(body.username, 64).toLowerCase();
    const key = `${req.socket.remoteAddress}|${username}`;
    checkLoginRate(key);
    const user = one('SELECT * FROM users WHERE username = ?', username);
    if (!user || !verifyPassword(String(body.password ?? ''), user.password_hash)) {
      recordLoginFailure(key);
      throw new HttpError(401, 'ユーザー名またはパスワードが正しくありません');
    }
    loginFailures.delete(key);
    startSession(res, user.id);
    return { user: userOut(user) };
  }, { auth: false });

  route('POST', '/api/logout', ({ res, session }) => {
    if (session) {
      run('DELETE FROM sessions WHERE token_hash = ?', session.tokenHash);
      for (const ws of sockets.get(session.user.id) || []) if (ws.tokenHash === session.tokenHash) ws.close(4001, 'logout');
    }
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/bootstrap', ({ user }) => ({
    workspaceName,
    me: userOut(user),
    users: all('SELECT * FROM users ORDER BY display_name').map(userOut),
    channels: channelsFor(user.id),
  }));

  route('PATCH', '/api/me', ({ user, body }) => {
    const displayName = body.displayName !== undefined ? cleanText(body.displayName, 50) : user.display_name;
    if (!displayName) throw new HttpError(400, '表示名を入力してください');
    const status = body.status !== undefined ? cleanText(body.status, 100) : user.status;
    run('UPDATE users SET display_name = ?, status = ? WHERE id = ?', displayName, status, user.id);
    const updated = userOut(one('SELECT * FROM users WHERE id = ?', user.id));
    broadcastAll({ type: 'user.updated', user: updated });
    return { user: updated };
  });

  route('POST', '/api/me/password', ({ user, body, session }) => {
    if (!verifyPassword(String(body.currentPassword ?? ''), user.password_hash)) throw new HttpError(400, '現在のパスワードが正しくありません');
    const next = String(body.newPassword ?? '');
    if (next.length < 8) throw new HttpError(400, '新しいパスワードは8文字以上にしてください');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
    // Sign out every other device.
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', user.id, session.tokenHash);
    return { ok: true };
  });

  route('GET', '/api/channels/browse', ({ user }) => ({
    channels: all('SELECT * FROM channels WHERE is_private = 0 AND is_dm = 0 ORDER BY name').map((c) => ({
      ...channelBase(c),
      isMember: isMember(c.id, user.id),
    })),
  }));

  route('POST', '/api/channels', ({ user, body }) => {
    const name = cleanText(body.name, 80).toLowerCase().replace(/\s+/g, '-');
    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(name)) throw new HttpError(400, 'チャンネル名には文字・数字・ハイフン・アンダースコアのみ使えます');
    if (one('SELECT 1 FROM channels WHERE name = ? AND is_dm = 0', name)) throw new HttpError(409, '同じ名前のチャンネルがすでにあります');
    const topic = cleanText(body.topic, 250);
    const isPrivate = body.isPrivate ? 1 : 0;
    const inviteIds = [...new Set((Array.isArray(body.memberIds) ? body.memberIds : []).map(toId).filter(Boolean))];

    const channel = tx(() => {
      const r = run('INSERT INTO channels (name, topic, is_private, created_by, created_at) VALUES (?, ?, ?, ?, ?)', name, topic, isPrivate, user.id, now());
      const c = one('SELECT * FROM channels WHERE id = ?', Number(r.lastInsertRowid));
      addMember(c, user.id);
      for (const id of inviteIds) if (one('SELECT 1 FROM users WHERE id = ?', id)) addMember(c, id);
      return c;
    });
    notifyMembership(channel, memberIds(channel.id));
    return { channel: channelsFor(user.id, channel.id)[0] };
  });

  route('GET', '/api/channels/:id', ({ user, params }) => {
    const c = readableChannel(params.id, user.id);
    return { channel: isMember(c.id, user.id) ? channelsFor(user.id, c.id)[0] : { ...channelBase(c), isMember: false } };
  });

  route('PATCH', '/api/channels/:id', ({ user, params, body }) => {
    const c = memberChannel(params.id, user.id);
    if (body.topic !== undefined) {
      const topic = cleanText(body.topic, 250);
      run('UPDATE channels SET topic = ? WHERE id = ?', topic, c.id);
      postSystem(c, user.id, `topic:${topic}`);
    }
    const updated = one('SELECT * FROM channels WHERE id = ?', c.id);
    broadcastChannel(updated, { type: 'channel.updated', channel: channelBase(updated) });
    return { channel: channelsFor(user.id, c.id)[0] };
  });

  route('POST', '/api/channels/:id/join', ({ user, params }) => {
    const c = readableChannel(params.id, user.id);
    if (c.is_private) throw new HttpError(403, 'プライベートチャンネルには招待が必要です');
    if (!isMember(c.id, user.id)) {
      addMember(c, user.id);
      notifyMembership(c, [user.id]);
      postSystem(c, user.id, 'joined');
    }
    return { channel: channelsFor(user.id, c.id)[0] };
  });

  route('POST', '/api/channels/:id/leave', ({ user, params }) => {
    const c = memberChannel(params.id, user.id);
    if (c.is_dm) throw new HttpError(400, 'ダイレクトメッセージからは退出できません');
    postSystem(c, user.id, 'left');
    run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', c.id, user.id);
    sendTo(user.id, { type: 'channel.left', channelId: c.id });
    notifyMembership(c);
    return { ok: true };
  });

  route('POST', '/api/channels/:id/members', ({ user, params, body }) => {
    const c = memberChannel(params.id, user.id);
    if (c.is_dm) throw new HttpError(400, 'ダイレクトメッセージにはメンバーを追加できません');
    const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : []).map(toId).filter(Boolean))];
    const added = [];
    for (const id of ids) {
      if (!isMember(c.id, id) && one('SELECT 1 FROM users WHERE id = ?', id)) {
        addMember(c, id);
        added.push(id);
      }
    }
    if (added.length) {
      notifyMembership(c, added);
      for (const id of added) postSystem(c, id, `added:${user.id}`);
    }
    return { channel: channelsFor(user.id, c.id)[0] };
  });

  route('POST', '/api/channels/:id/read', ({ user, params, body }) => {
    const c = memberChannel(params.id, user.id);
    const latest = one('SELECT MAX(id) AS id FROM messages WHERE channel_id = ?', c.id).id || 0;
    const target = Math.min(toId(body.messageId) ?? latest, latest);
    run('UPDATE channel_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ? AND last_read_id < ?', target, c.id, user.id, target);
    const channel = channelsFor(user.id, c.id)[0];
    sendTo(user.id, { type: 'channel.read', channelId: c.id, lastReadId: channel.lastReadId, unread: channel.unread, mentions: channel.mentions });
    return { ok: true };
  });

  route('POST', '/api/dm', ({ user, body }) => {
    const ids = [...new Set([user.id, ...(Array.isArray(body.userIds) ? body.userIds : []).map(toId).filter(Boolean)])].sort((a, b) => a - b);
    if (ids.length > 9) throw new HttpError(400, 'グループDMは自分を含めて9人までです');
    for (const id of ids) if (!one('SELECT 1 FROM users WHERE id = ?', id)) throw new HttpError(404, 'ユーザーが見つかりません');
    const key = ids.join(',');
    let c = one('SELECT * FROM channels WHERE dm_key = ?', key);
    if (!c) {
      c = tx(() => {
        const r = run('INSERT INTO channels (name, is_private, is_dm, dm_key, created_by, created_at) VALUES (?, 1, 1, ?, ?, ?)', `dm-${key}`, key, user.id, now());
        const created = one('SELECT * FROM channels WHERE id = ?', Number(r.lastInsertRowid));
        for (const id of ids) addMember(created, id);
        return created;
      });
      notifyMembership(c, ids);
    }
    return { channel: channelsFor(user.id, c.id)[0] };
  });

  route('GET', '/api/channels/:id/messages', ({ user, params, query }) => {
    const c = readableChannel(params.id, user.id);
    const before = toId(query.get('before')) ?? Number.MAX_SAFE_INTEGER;
    const limit = Math.min(toId(query.get('limit')) ?? PAGE_SIZE, 100);
    const rows = all(
      `SELECT * FROM messages
        WHERE channel_id = ? AND parent_id IS NULL AND id < ? AND (deleted = 0 OR reply_count > 0)
        ORDER BY id DESC LIMIT ?`,
      c.id, before, limit + 1,
    );
    const hasMore = rows.length > limit;
    return { messages: hydrate(rows.slice(0, limit).reverse()), hasMore };
  });

  route('GET', '/api/messages/:id/thread', ({ user, params }) => {
    const { m } = getMessage(params.id, user.id);
    const rootId = m.parent_id || m.id;
    const root = one('SELECT * FROM messages WHERE id = ?', rootId);
    const replies = all('SELECT * FROM messages WHERE parent_id = ? AND deleted = 0 ORDER BY id', rootId);
    return { parent: hydrate([root])[0], replies: hydrate(replies) };
  });

  route('POST', '/api/channels/:id/messages', ({ user, params, body }) => {
    const c = readableChannel(params.id, user.id);
    if (!isMember(c.id, user.id)) {
      if (c.is_private) throw new HttpError(403, 'このチャンネルに参加していません');
      addMember(c, user.id);
      notifyMembership(c, [user.id]);
    }
    const text = String(body.body ?? '').replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
    if (text.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `メッセージは${MAX_MESSAGE_LENGTH}文字以内にしてください`);

    let parentId = null;
    if (body.parentId != null) {
      const parent = one('SELECT * FROM messages WHERE id = ?', toId(body.parentId));
      if (!parent || parent.channel_id !== c.id || parent.parent_id || parent.deleted || parent.kind !== 'message') {
        throw new HttpError(400, '返信先のメッセージが見つかりません');
      }
      parentId = parent.id;
    }

    let fileId = null;
    if (body.fileId != null) {
      const f = one('SELECT * FROM files WHERE id = ? AND user_id = ?', toId(body.fileId), user.id);
      if (!f || one('SELECT 1 FROM messages WHERE file_id = ?', f.id)) throw new HttpError(400, '添付ファイルが見つかりません');
      fileId = f.id;
    }
    if (!text && !fileId) throw new HttpError(400, 'メッセージを入力してください');

    const id = tx(() => insertMessage(c, user.id, text, { parentId, fileId }));
    return { message: emitNewMessage(c, id) };
  });

  route('PATCH', '/api/messages/:id', ({ user, params, body }) => {
    const { m, c } = getMessage(params.id, user.id);
    if (m.user_id !== user.id || m.kind !== 'message' || m.deleted) throw new HttpError(403, 'このメッセージは編集できません');
    const text = String(body.body ?? '').replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
    if (!text && !m.file_id) throw new HttpError(400, 'メッセージを入力してください');
    if (text.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `メッセージは${MAX_MESSAGE_LENGTH}文字以内にしてください`);
    tx(() => {
      run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', text, now(), m.id);
      saveMentions(m.id, c, user.id, text);
    });
    const message = messageById(m.id);
    broadcastChannel(c, { type: 'message.updated', message });
    return { message };
  });

  route('DELETE', '/api/messages/:id', ({ user, params }) => {
    const { m, c } = getMessage(params.id, user.id);
    if (m.deleted || m.kind !== 'message' || (m.user_id !== user.id && !user.is_admin)) throw new HttpError(403, 'このメッセージは削除できません');
    const file = m.file_id && one('SELECT * FROM files WHERE id = ?', m.file_id);
    tx(() => {
      run("UPDATE messages SET deleted = 1, body = '', file_id = NULL WHERE id = ?", m.id);
      run('DELETE FROM reactions WHERE message_id = ?', m.id);
      run('DELETE FROM mentions WHERE message_id = ?', m.id);
      if (file) run('DELETE FROM files WHERE id = ?', file.id);
      if (m.parent_id) run('UPDATE messages SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?', m.parent_id);
    });
    if (file) fs.rm(path.join(uploadDir, file.storage_key), { force: true }, () => {});

    if (m.reply_count > 0) {
      // Keep a placeholder so the thread underneath stays reachable.
      broadcastChannel(c, { type: 'message.updated', message: messageById(m.id) });
    } else {
      broadcastChannel(c, { type: 'message.deleted', channelId: c.id, messageId: m.id, parentId: m.parent_id });
    }
    if (m.parent_id) {
      const parent = one('SELECT * FROM messages WHERE id = ?', m.parent_id);
      if (parent.deleted && parent.reply_count === 0) {
        broadcastChannel(c, { type: 'message.deleted', channelId: c.id, messageId: parent.id, parentId: null });
      } else {
        broadcastChannel(c, { type: 'message.updated', message: messageById(parent.id) });
      }
    }
    return { ok: true };
  });

  route('POST', '/api/messages/:id/reactions', ({ user, params, body }) => {
    const { m, c } = getMessage(params.id, user.id);
    if (!isMember(c.id, user.id)) throw new HttpError(403, 'このチャンネルに参加していません');
    if (m.deleted || m.kind !== 'message') throw new HttpError(400, 'このメッセージにはリアクションできません');
    const emoji = cleanText(body.emoji, 32);
    if (!emoji || /\s/.test(emoji)) throw new HttpError(400, '絵文字が正しくありません');
    const exists = one('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, user.id, emoji);
    if (exists) run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', m.id, user.id, emoji);
    else run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', m.id, user.id, emoji, now());
    const message = messageById(m.id);
    broadcastChannel(c, { type: 'message.updated', message });
    return { message };
  });

  route('GET', '/api/search', ({ user, query }) => {
    const q = cleanText(query.get('q'), 200);
    if (!q) return { messages: [] };
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = all(
      `SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id
        WHERE m.deleted = 0 AND m.kind = 'message' AND m.body LIKE ? ESCAPE '\\'
          AND (c.is_private = 0 OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?))
        ORDER BY m.id DESC LIMIT 50`,
      like, user.id,
    );
    return { messages: hydrate(rows) };
  });

  route('POST', '/api/files', async ({ req, user }) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_FILE_BYTES) throw new HttpError(413, 'ファイルサイズは20MBまでです');
    let name;
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] || ''));
    } catch {
      name = '';
    }
    name = cleanText(name.replace(/[\\/]/g, '_'), 200) || 'file';
    const mime = cleanText(String(req.headers['content-type'] || '').split(';')[0], 100).toLowerCase() || 'application/octet-stream';
    const storageKey = crypto.randomBytes(16).toString('hex');
    const dest = path.join(uploadDir, storageKey);

    let size = 0;
    try {
      await pipeline(
        req,
        async function* limit(source) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > MAX_FILE_BYTES) throw new HttpError(413, 'ファイルサイズは20MBまでです');
            yield chunk;
          }
        },
        fs.createWriteStream(dest),
      );
    } catch (err) {
      fs.rm(dest, { force: true }, () => {});
      throw err;
    }
    if (size === 0) {
      fs.rm(dest, { force: true }, () => {});
      throw new HttpError(400, '空のファイルはアップロードできません');
    }
    const r = run('INSERT INTO files (user_id, name, mime, size, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?)', user.id, name, mime, size, storageKey, now());
    return { file: fileOut(one('SELECT * FROM files WHERE id = ?', Number(r.lastInsertRowid))) };
  }, { upload: true });

  // ---- HTTP plumbing --------------------------------------------------------------

  function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_JSON_BYTES) {
          reject(new HttpError(413, 'リクエストが大きすぎます'));
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(new HttpError(400, 'JSON の形式が正しくありません'));
        }
      });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, url) {
    let params;
    const r = routes.find((x) => {
      if (x.method !== req.method) return false;
      const m = x.re.exec(url.pathname);
      if (m) params = m.groups || {};
      return !!m;
    });
    if (!r) throw new HttpError(404, 'Not found');
    // A custom header can't be sent cross-site without a CORS preflight, which we never allow: CSRF guard.
    if (req.method !== 'GET' && req.headers['x-chat-client'] !== '1') throw new HttpError(403, 'Forbidden');
    const session = sessionUser(req);
    if (r.auth && !session) throw new HttpError(401, 'ログインしてください');
    const body = r.upload || req.method === 'GET' ? {} : await readJson(req);
    const out = await r.handler({ req, res, params, body, query: url.searchParams, session, user: session?.user });
    sendJson(res, 200, out ?? { ok: true });
  }

  function serveFile(req, res, url) {
    const session = sessionUser(req);
    if (!session) throw new HttpError(401, 'ログインしてください');
    const id = toId(url.pathname.split('/')[2]);
    const f = id && one('SELECT * FROM files WHERE id = ?', id);
    if (!f) throw new HttpError(404, 'ファイルが見つかりません');
    if (f.user_id !== session.user.id) {
      const m = one('SELECT channel_id FROM messages WHERE file_id = ? AND deleted = 0', f.id);
      if (!m || !canRead(getChannel(m.channel_id), session.user.id)) throw new HttpError(404, 'ファイルが見つかりません');
    }
    const inline = INLINE_FILE_TYPES.has(f.mime);
    res.writeHead(200, {
      'Content-Type': inline ? f.mime : 'application/octet-stream',
      'Content-Length': f.size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(path.join(uploadDir, f.storage_key)).pipe(res);
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(PUBLIC_DIR, `.${rel}`);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (url.pathname.startsWith('/files/')) serveFile(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      if (res.headersSent) return res.destroy();
      sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'サーバーエラーが発生しました' });
    }
  });

  // ---- WebSocket ------------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    let sameOrigin = true;
    try {
      if (origin) sameOrigin = new URL(origin).host === req.headers.host;
    } catch {
      sameOrigin = false;
    }
    const session = url.pathname === '/ws' && sameOrigin ? sessionUser(req) : null;
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, session));
  });

  function onConnection(ws, session) {
    const uid = session.user.id;
    ws.tokenHash = session.tokenHash;
    ws.isAlive = true;
    const wasOnline = isOnline(uid);
    if (!sockets.has(uid)) sockets.set(uid, new Set());
    sockets.get(uid).add(ws);
    if (!wasOnline) broadcastAll({ type: 'presence', userId: uid, online: true }, uid);
    ws.send(JSON.stringify({ type: 'hello', onlineIds: [...sockets.keys()] }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.type === 'typing') {
        const c = one('SELECT * FROM channels WHERE id = ?', toId(msg.channelId));
        if (!c || !isMember(c.id, uid)) return;
        broadcastChannel(c, { type: 'typing', channelId: c.id, parentId: toId(msg.parentId), userId: uid }, uid);
      }
    });

    ws.on('close', () => {
      const set = sockets.get(uid);
      if (!set) return;
      set.delete(ws);
      if (!set.size) {
        sockets.delete(uid);
        broadcastAll({ type: 'presence', userId: uid, online: false });
      }
    });
  }

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  // Shutting down: drop live sockets so close() doesn't wait on them, then release the database.
  const closeServer = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    closeServer((err) => {
      db.close();
      callback?.(err);
    });
    server.closeAllConnections();
    return server;
  };

  return server;
}

module.exports = { createChatServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = createChatServer();
  server.listen(port, host, () => {
    console.log(`chat server listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!process.env.INVITE_CODE) console.warn('警告: INVITE_CODE が未設定のため、アクセスできる人は誰でもアカウントを作成できます');
  });
}
