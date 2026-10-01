'use strict';
// In-browser stand-in for server.js so the UI can be previewed without a backend.
// It intercepts fetch('/api/...') and WebSocket('/ws'), keeps data in memory,
// and simulates coworkers who type, reply and react.

(() => {
  const ME = 1;
  const T0 = Date.now();
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const CANNED = [
    '了解です！',
    'ありがとうございます、確認します 👀',
    'いいですね！🎉',
    '承知しました。後ほど共有します',
    'なるほど、助かります 🙏',
    '確認しました ✅',
    'それで進めましょう！',
    '少し考えてみます。午後に返事しますね',
  ];

  const users = new Map();
  const channels = new Map();
  const messages = [];
  let nextMsgId = 1;
  let nextChannelId = 1;
  let nextFileId = 1;

  function addUser(id, username, displayName, color, status, online, isAdmin = false) {
    users.set(id, { id, username, displayName, color, status, online, isAdmin });
  }
  addUser(1, 'demo', 'あなた（デモ）', '#2bac76', '', true, true);
  addUser(2, 'hanako', '佐藤 花子', '#1264a3', '🏠 在宅勤務中', true);
  addUser(3, 'ichiro', '鈴木 一郎', '#e8912d', '📅 15時まで会議', true);
  addUser(4, 'misaki', '田中 美咲', '#cd2553', '', true);
  addUser(5, 'kenta', '高橋 健太', '#7c3085', '🌴 休暇中', false);

  function addChannel({ name, topic = '', isPrivate = false, isDm = false, isDefault = false, members, createdBy = ME }) {
    const id = nextChannelId++;
    const c = { id, name, topic, isPrivate: isPrivate || isDm, isDm, isDefault, createdBy, members: new Map() };
    for (const uid of members) c.members.set(uid, 0);
    channels.set(id, c);
    return c;
  }

  function addMessage(c, userId, body, { at = Date.now(), parentId = null, kind = 'message', file = null } = {}) {
    const m = {
      id: nextMsgId++, channelId: c.id, userId, parentId, kind, body, file,
      createdAt: at, editedAt: null, deleted: false, reactions: new Map(), mentionIds: [],
    };
    if (kind === 'message') m.mentionIds = mentionsIn(c, userId, body);
    messages.push(m);
    if (c.members.has(userId) && c.members.get(userId) < m.id) c.members.set(userId, m.id);
    return m;
  }

  function mentionsIn(c, authorId, body) {
    const targets = new Set();
    for (const match of body.matchAll(/(^|[^\w@])@([a-z0-9._-]+)/gi)) {
      const name = match[2].toLowerCase().replace(/\.+$/, '');
      if (['channel', 'here', 'all'].includes(name)) c.members.forEach((_, id) => targets.add(id));
      else {
        const u = [...users.values()].find((x) => x.username === name);
        if (u && c.members.has(u.id)) targets.add(u.id);
      }
    }
    targets.delete(authorId);
    return [...targets];
  }

  const react = (m, uid, emoji) => {
    if (!m.reactions.has(emoji)) m.reactions.set(emoji, []);
    m.reactions.get(emoji).push(uid);
  };

  // ---- seed data ----------------------------------------------------------------

  const general = addChannel({ name: 'general', topic: '全社向けのお知らせ・連絡', isDefault: true, members: [1, 2, 3, 4, 5] });
  const random = addChannel({ name: 'random', topic: '雑談・なんでも', isDefault: true, members: [1, 2, 3, 4, 5] });
  const dev = addChannel({ name: '開発', topic: 'アプリ開発の進捗共有', members: [1, 3, 4] });
  const design = addChannel({ name: 'デザイン', topic: 'デザインレビュー・素材の共有', members: [2, 4] });
  const plan = addChannel({ name: '経営企画', topic: '来期の計画（関係者のみ）', isPrivate: true, members: [1, 2] });
  const dmHanako = addChannel({ name: 'dm-1,2', isDm: true, members: [1, 2] });
  const dmIchiro = addChannel({ name: 'dm-1,3', isDm: true, members: [1, 3] });

  for (const uid of [1, 2, 3, 4, 5]) addMessage(general, uid, 'joined', { at: T0 - 50 * HOUR + uid * MIN, kind: 'system' });
  const g1 = addMessage(general, 3, 'おはようございます！来週月曜は *全社ミーティング* です。\n場所は 3F 大会議室、時間は `10:00〜11:00` です 📅', { at: T0 - 26 * HOUR });
  react(g1, 2, '👍'); react(g1, 4, '👍'); react(g1, 1, '✅');
  addMessage(general, 4, '了解です！資料は前日までに共有しますね', { at: T0 - 25.8 * HOUR });
  const g2 = addMessage(general, 2, '新しいオフィスの Wi-Fi パスワードが変わりました。\n> 総務ポータルの「お知らせ」に掲載しています\n不明点はこのスレッドで質問してください 🙏', { at: T0 - 3 * HOUR });
  addMessage(general, 5, 'ありがとうございます！つながりました', { at: T0 - 2.8 * HOUR, parentId: g2.id });
  addMessage(general, 3, '会議室のプロジェクターも同じネットワークで大丈夫ですか？', { at: T0 - 2.5 * HOUR, parentId: g2.id });
  addMessage(general, 2, 'はい、同じで大丈夫です！', { at: T0 - 2.4 * HOUR, parentId: g2.id });
  react(g2, 3, '🙏'); react(g2, 5, '🙏');
  general.members.set(ME, nextMsgId - 1);
  const g3 = addMessage(general, 4, '@demo さん、明日のお客様向けデモの件、15時からで大丈夫でしょうか？', { at: T0 - 35 * MIN });
  void g3;

  addMessage(random, 4, '駅前に新しいカフェができてました ☕ ランチもやってるみたいです', { at: T0 - 5 * HOUR });
  const r1 = addMessage(random, 3, 'いいですね！今度みんなで行きましょう', { at: T0 - 4.9 * HOUR });
  react(r1, 4, '🙌');
  random.members.set(ME, nextMsgId - 1);

  addMessage(dev, 3, 'v1.2 のリリース準備を進めています。テスト環境は https://example.com/staging です', { at: T0 - 6 * HOUR });
  addMessage(dev, 4, 'ログイン画面の修正 PR を出しました。レビューお願いします！', { at: T0 - 1.5 * HOUR });
  dev.members.set(ME, nextMsgId - 1);

  addMessage(design, 4, '新しいロゴ案を3つ作りました。コメントください 🎨', { at: T0 - 7 * HOUR });
  addMessage(design, 2, 'B 案が好きです！色味をもう少し明るくしても良さそう', { at: T0 - 6.5 * HOUR });

  addMessage(plan, 2, '来期の予算案のたたき台をまとめました。月末までに確認をお願いします', { at: T0 - 20 * HOUR });
  plan.members.set(ME, nextMsgId - 1);

  addMessage(dmIchiro, 1, '先日の資料ありがとうございました！', { at: T0 - 22 * HOUR });
  addMessage(dmIchiro, 3, 'いえいえ、また何かあれば言ってください 👍', { at: T0 - 21.5 * HOUR });
  dmIchiro.members.set(ME, nextMsgId - 1);

  addMessage(dmHanako, 2, 'お疲れさまです！', { at: T0 - 12 * MIN });
  addMessage(dmHanako, 2, '経営企画チャンネルの資料、時間のあるときに見てもらえると嬉しいです 🙇', { at: T0 - 11 * MIN });

  // ---- serializers -------------------------------------------------------------

  const replies = (m) => messages.filter((x) => x.parentId === m.id && !x.deleted);
  const fileOut = (f) => f && { ...f };

  function messageOut(m) {
    const rs = replies(m);
    return {
      id: m.id, channelId: m.channelId, userId: m.userId, parentId: m.parentId, kind: m.kind,
      body: m.deleted ? '' : m.body,
      file: m.deleted ? null : fileOut(m.file),
      createdAt: m.createdAt, editedAt: m.editedAt, deleted: m.deleted,
      replyCount: rs.length,
      lastReplyAt: rs.length ? rs.at(-1).createdAt : null,
      replyUserIds: [...new Set(rs.map((x) => x.userId))].slice(0, 5),
      reactions: [...m.reactions].filter(([, ids]) => ids.length).map(([emoji, userIds]) => ({ emoji, userIds: [...userIds] })),
      mentionIds: [...m.mentionIds],
    };
  }

  const channelBase = (c) => ({
    id: c.id, name: c.name, topic: c.topic, isPrivate: c.isPrivate, isDm: c.isDm, isDefault: c.isDefault, memberIds: [...c.members.keys()],
  });

  function channelOut(c) {
    if (!c.members.has(ME)) return { ...channelBase(c), isMember: false };
    const lastRead = c.members.get(ME);
    const inChannel = messages.filter((m) => m.channelId === c.id);
    return {
      ...channelBase(c),
      isMember: true,
      lastReadId: lastRead,
      unread: inChannel.filter((m) => !m.parentId && !m.deleted && m.kind === 'message' && m.userId !== ME && m.id > lastRead).length,
      mentions: inChannel.filter((m) => !m.deleted && m.id > lastRead && m.mentionIds.includes(ME)).length,
      latestId: inChannel.length ? inChannel.at(-1).id : 0,
    };
  }

  // ---- fake WebSocket ----------------------------------------------------------

  const sockets = new Set();
  function emit(event) {
    const data = JSON.stringify(event);
    for (const ws of sockets) setTimeout(() => ws._fire('message', { data }), 0);
  }
  const visible = (c) => !c.isPrivate || c.members.has(ME);
  const emitChannel = (c, event) => { if (visible(c)) emit(event); };

  class FakeWebSocket {
    constructor() {
      this.readyState = 0;
      this._listeners = {};
      setTimeout(() => {
        this.readyState = 1;
        sockets.add(this);
        this._fire('open', {});
        this._fire('message', { data: JSON.stringify({ type: 'hello', onlineIds: [...users.values()].filter((u) => u.online).map((u) => u.id) }) });
      }, 50);
    }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
    _fire(type, ev) { for (const fn of this._listeners[type] || []) fn(ev); }
    send() {}
    close(code = 1000) {
      this.readyState = 3;
      sockets.delete(this);
      this._fire('close', { code });
    }
  }
  window.WebSocket = FakeWebSocket;

  // ---- simulated coworkers ---------------------------------------------------------

  function postAs(c, uid, body, opts) {
    const m = addMessage(c, uid, body, opts);
    emitChannel(c, { type: 'message.new', message: messageOut(m) });
    if (m.parentId) emitChannel(c, { type: 'message.updated', message: messageOut(messages.find((x) => x.id === m.parentId)) });
    return m;
  }

  function simulateResponse(c, mine) {
    const others = [...c.members.keys()].filter((id) => id !== ME && users.get(id).online);
    if (!others.length) return;
    const mentioned = mine.mentionIds.filter((id) => id !== ME && users.get(id)?.online);
    const responder = mentioned[0] ?? (c.isDm ? others[0] : others[Math.floor(Math.random() * others.length)]);
    const shouldReply = c.isDm || mentioned.length || mine.parentId || Math.random() < 0.75;

    if (Math.random() < 0.5) {
      const reactor = others[Math.floor(Math.random() * others.length)];
      setTimeout(() => {
        if (mine.deleted) return;
        const emoji = ['👍', '🙌', '👀', '🎉'][Math.floor(Math.random() * 4)];
        react(mine, reactor, emoji);
        emitChannel(c, { type: 'message.updated', message: messageOut(mine) });
      }, 1200);
    }
    if (!shouldReply) return;
    setTimeout(() => emitChannel(c, { type: 'typing', channelId: c.id, parentId: mine.parentId, userId: responder }), 700);
    setTimeout(() => {
      let text = CANNED[Math.floor(Math.random() * CANNED.length)];
      if (/[?？]/.test(mine.body)) text = 'はい、大丈夫です！ 👌';
      postAs(c, responder, text, { parentId: mine.parentId });
    }, 2400 + Math.random() * 1200);
  }

  // ---- fake API -------------------------------------------------------------------

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const getChannel = (id) => {
    const c = channels.get(Number(id));
    if (!c || !visible(c)) throw new ApiError(404, 'チャンネルが見つかりません');
    return c;
  };
  const getMessage = (id) => {
    const m = messages.find((x) => x.id === Number(id));
    if (!m) throw new ApiError(404, 'メッセージが見つかりません');
    return { m, c: getChannel(m.channelId) };
  };
  const requireMember = (c) => { if (!c.members.has(ME)) throw new ApiError(403, 'このチャンネルに参加していません'); };

  function systemMessage(c, uid, body) {
    postAs(c, uid, body, { kind: 'system' });
  }
  function membershipChanged(c, joined = []) {
    for (const uid of joined) if (uid === ME) emit({ type: 'channel.joined', channel: channelOut(c) });
    emitChannel(c, { type: 'channel.updated', channel: channelBase(c) });
  }

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

  route('GET', '/api/config', () => ({ workspaceName: 're-ordia デモ', inviteRequired: true }));
  route('GET', '/api/bootstrap', () => ({
    workspaceName: 're-ordia デモ',
    me: users.get(ME),
    users: [...users.values()],
    channels: [...channels.values()].filter((c) => c.members.has(ME)).map(channelOut),
  }));
  route('POST', '/api/logout', () => ({ ok: true }));
  route('PATCH', '/api/me', ({ body }) => {
    const me = users.get(ME);
    if (body.displayName !== undefined) {
      const name = String(body.displayName).trim().slice(0, 50);
      if (!name) throw new ApiError(400, '表示名を入力してください');
      me.displayName = name;
    }
    if (body.status !== undefined) me.status = String(body.status).trim().slice(0, 100);
    emit({ type: 'user.updated', user: { ...me } });
    return { user: { ...me } };
  });
  route('POST', '/api/me/password', ({ body }) => {
    if (String(body.newPassword || '').length < 8) throw new ApiError(400, '新しいパスワードは8文字以上にしてください');
    return { ok: true };
  });

  route('GET', '/api/channels/browse', () => ({
    channels: [...channels.values()].filter((c) => !c.isPrivate).sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ ...channelBase(c), isMember: c.members.has(ME) })),
  }));
  route('POST', '/api/channels', ({ body }) => {
    const name = String(body.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(name)) throw new ApiError(400, 'チャンネル名には文字・数字・ハイフン・アンダースコアのみ使えます');
    if ([...channels.values()].some((c) => !c.isDm && c.name === name)) throw new ApiError(409, '同じ名前のチャンネルがすでにあります');
    const c = addChannel({ name, topic: String(body.topic || '').trim(), isPrivate: !!body.isPrivate, members: [ME] });
    membershipChanged(c, [ME]);
    return { channel: channelOut(c) };
  });
  route('GET', '/api/channels/:id', ({ params }) => ({ channel: channelOut(getChannel(params.id)) }));
  route('PATCH', '/api/channels/:id', ({ params, body }) => {
    const c = getChannel(params.id);
    requireMember(c);
    c.topic = String(body.topic ?? c.topic).trim().slice(0, 250);
    systemMessage(c, ME, `topic:${c.topic}`);
    emitChannel(c, { type: 'channel.updated', channel: channelBase(c) });
    return { channel: channelOut(c) };
  });
  route('POST', '/api/channels/:id/join', ({ params }) => {
    const c = getChannel(params.id);
    if (c.isPrivate) throw new ApiError(403, 'プライベートチャンネルには招待が必要です');
    if (!c.members.has(ME)) {
      c.members.set(ME, 0);
      membershipChanged(c, [ME]);
      systemMessage(c, ME, 'joined');
    }
    return { channel: channelOut(c) };
  });
  route('POST', '/api/channels/:id/leave', ({ params }) => {
    const c = getChannel(params.id);
    requireMember(c);
    if (c.isDm) throw new ApiError(400, 'ダイレクトメッセージからは退出できません');
    systemMessage(c, ME, 'left');
    c.members.delete(ME);
    emit({ type: 'channel.left', channelId: c.id });
    membershipChanged(c);
    return { ok: true };
  });
  route('POST', '/api/channels/:id/members', ({ params, body }) => {
    const c = getChannel(params.id);
    requireMember(c);
    const added = (body.userIds || []).map(Number).filter((id) => users.has(id) && !c.members.has(id));
    for (const id of added) c.members.set(id, 0);
    if (added.length) {
      membershipChanged(c, added);
      for (const id of added) systemMessage(c, id, `added:${ME}`);
    }
    return { channel: channelOut(c) };
  });
  route('POST', '/api/channels/:id/read', ({ params }) => {
    const c = getChannel(params.id);
    requireMember(c);
    const latest = messages.filter((m) => m.channelId === c.id).at(-1)?.id || 0;
    c.members.set(ME, Math.max(c.members.get(ME), latest));
    const out = channelOut(c);
    emit({ type: 'channel.read', channelId: c.id, lastReadId: out.lastReadId, unread: out.unread, mentions: out.mentions });
    return { ok: true };
  });
  route('POST', '/api/dm', ({ body }) => {
    const ids = [...new Set([ME, ...(body.userIds || []).map(Number)])].sort((a, b) => a - b);
    if (ids.length > 9) throw new ApiError(400, 'グループDMは自分を含めて9人までです');
    const key = `dm-${ids.join(',')}`;
    let c = [...channels.values()].find((x) => x.isDm && x.name === key);
    if (!c) {
      c = addChannel({ name: key, isDm: true, members: ids });
      membershipChanged(c, [ME]);
    }
    return { channel: channelOut(c) };
  });

  route('GET', '/api/channels/:id/messages', ({ params, query }) => {
    const c = getChannel(params.id);
    const before = Number(query.get('before')) || Infinity;
    const list = messages.filter((m) => m.channelId === c.id && !m.parentId && m.id < before && (!m.deleted || replies(m).length));
    const page = list.slice(-50);
    return { messages: page.map(messageOut), hasMore: list.length > page.length };
  });
  route('GET', '/api/messages/:id/thread', ({ params }) => {
    const { m } = getMessage(params.id);
    const root = m.parentId ? messages.find((x) => x.id === m.parentId) : m;
    return { parent: messageOut(root), replies: replies(root).map(messageOut) };
  });
  route('POST', '/api/channels/:id/messages', ({ params, body }) => {
    const c = getChannel(params.id);
    if (!c.members.has(ME)) {
      if (c.isPrivate) throw new ApiError(403, 'このチャンネルに参加していません');
      c.members.set(ME, 0);
      membershipChanged(c, [ME]);
    }
    const text = String(body.body || '').trim();
    const file = body.fileId ? files.get(Number(body.fileId)) : null;
    if (!text && !file) throw new ApiError(400, 'メッセージを入力してください');
    if (body.parentId != null) {
      const parent = messages.find((x) => x.id === Number(body.parentId));
      if (!parent || parent.channelId !== c.id || parent.parentId || parent.deleted) throw new ApiError(400, '返信先のメッセージが見つかりません');
    }
    if (file) files.delete(file.id);
    const m = postAs(c, ME, text, { parentId: body.parentId ? Number(body.parentId) : null, file });
    simulateResponse(c, m);
    return { message: messageOut(m) };
  });
  route('PATCH', '/api/messages/:id', ({ params, body }) => {
    const { m, c } = getMessage(params.id);
    if (m.userId !== ME || m.deleted) throw new ApiError(403, 'このメッセージは編集できません');
    const text = String(body.body || '').trim();
    if (!text && !m.file) throw new ApiError(400, 'メッセージを入力してください');
    m.body = text;
    m.editedAt = Date.now();
    m.mentionIds = mentionsIn(c, ME, text);
    emitChannel(c, { type: 'message.updated', message: messageOut(m) });
    return { message: messageOut(m) };
  });
  route('DELETE', '/api/messages/:id', ({ params }) => {
    const { m, c } = getMessage(params.id);
    if (m.deleted || m.kind !== 'message') throw new ApiError(403, 'このメッセージは削除できません');
    m.deleted = true;
    m.reactions.clear();
    m.mentionIds = [];
    if (replies(m).length) emitChannel(c, { type: 'message.updated', message: messageOut(m) });
    else emitChannel(c, { type: 'message.deleted', channelId: c.id, messageId: m.id, parentId: m.parentId });
    if (m.parentId) {
      const parent = messages.find((x) => x.id === m.parentId);
      if (parent.deleted && !replies(parent).length) emitChannel(c, { type: 'message.deleted', channelId: c.id, messageId: parent.id, parentId: null });
      else emitChannel(c, { type: 'message.updated', message: messageOut(parent) });
    }
    return { ok: true };
  });
  route('POST', '/api/messages/:id/reactions', ({ params, body }) => {
    const { m, c } = getMessage(params.id);
    requireMember(c);
    const emoji = String(body.emoji || '').trim();
    const list = m.reactions.get(emoji) || [];
    if (list.includes(ME)) m.reactions.set(emoji, list.filter((id) => id !== ME));
    else m.reactions.set(emoji, [...list, ME]);
    emitChannel(c, { type: 'message.updated', message: messageOut(m) });
    return { message: messageOut(m) };
  });
  route('GET', '/api/search', ({ query }) => {
    const q = String(query.get('q') || '').trim().toLowerCase();
    if (!q) return { messages: [] };
    return {
      messages: messages.filter((m) => !m.deleted && m.kind === 'message' && m.body.toLowerCase().includes(q) && visible(channels.get(m.channelId)))
        .reverse().slice(0, 50).map(messageOut),
    };
  });

  const files = new Map();
  route('POST', '/api/files', ({ blob, headers }) => {
    if (!blob || !blob.size) throw new ApiError(400, '空のファイルはアップロードできません');
    if (blob.size > 20 * 1024 * 1024) throw new ApiError(413, 'ファイルサイズは20MBまでです');
    let name = 'file';
    try { name = decodeURIComponent(headers['x-filename'] || 'file'); } catch { /* keep default */ }
    const mime = blob.type || 'application/octet-stream';
    const f = {
      id: nextFileId++, name, mime, size: blob.size, url: URL.createObjectURL(blob),
      isImage: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime),
    };
    files.set(f.id, f);
    return { file: f };
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let params;
    const r = routes.find((x) => {
      if (x.method !== method) return false;
      const m = x.re.exec(url.pathname);
      if (m) params = m.groups || {};
      return !!m;
    });
    await new Promise((res) => setTimeout(res, 40));
    let status = 200;
    let data;
    try {
      if (!r) throw new ApiError(404, 'Not found');
      const blob = init.body instanceof Blob ? init.body : null;
      const body = !blob && typeof init.body === 'string' ? JSON.parse(init.body) : {};
      data = r.fn({ params, body, blob, headers: init.headers || {}, query: url.searchParams }) ?? { ok: true };
    } catch (err) {
      status = err.status || 500;
      data = { error: err.status ? err.message : 'エラーが発生しました' };
      if (!err.status) console.error(err);
    }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };

  // The preview frame has no native dialogs and may refuse history/notification APIs.
  window.confirm = () => true;
  const replaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => { try { replaceState(...args); } catch { /* sandboxed */ } };
})();
