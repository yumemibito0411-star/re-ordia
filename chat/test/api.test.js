'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChatServer } = require('../server');

const INVITE = 'test-invite';

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
  const server = createChatServer({ dataDir, inviteCode: INVITE, workspaceName: 'Test' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function client(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'x-chat-client': '1',
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    call,
    get cookie() {
      return cookie;
    },
    async signup(username, extra = {}) {
      const r = await call('POST', '/api/signup', { username, password: 'password123', displayName: username.toUpperCase(), inviteCode: INVITE, ...extra });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.user;
    },
  };
}

function openSocket(base, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new (require('ws'))(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
    const events = [];
    const waiters = [];
    ws.on('message', (data) => {
      const ev = JSON.parse(data.toString());
      events.push(ev);
      for (const w of [...waiters]) {
        if (w.match(ev)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(ev);
        }
      }
    });
    ws.on('open', () => resolve({
      ws,
      events,
      next(match, timeout = 2000) {
        const found = events.find(match);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('timed out waiting for event')), timeout);
          waiters.push({ match, resolve: (ev) => { clearTimeout(timer); res(ev); } });
        });
      },
    }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`ws rejected: ${res.statusCode}`)));
  });
}

test('chat API end to end', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const alice = client(srv.base);
  const bob = client(srv.base);
  const carol = client(srv.base);

  await t.test('signup requires a valid invite code and unique username', async () => {
    const r = await alice.call('POST', '/api/signup', { username: 'alice', password: 'password123', inviteCode: 'wrong' });
    assert.equal(r.status, 403);
    const a = await alice.signup('alice');
    assert.equal(a.isAdmin, true, 'first user becomes admin');
    const b = await bob.signup('bob');
    assert.equal(b.isAdmin, false);
    await carol.signup('carol');
    const dup = await client(srv.base).call('POST', '/api/signup', { username: 'Bob', password: 'password123', inviteCode: INVITE });
    assert.equal(dup.status, 409);
  });

  await t.test('rejects unauthenticated and CSRF-style requests', async () => {
    assert.equal((await client(srv.base).call('GET', '/api/bootstrap')).status, 401);
    const r = await alice.call('POST', '/api/channels', { name: 'x' }, { 'x-chat-client': '' });
    assert.equal(r.status, 403);
  });

  await t.test('login works and wrong passwords are rejected', async () => {
    const c = client(srv.base);
    assert.equal((await c.call('POST', '/api/login', { username: 'alice', password: 'nope' })).status, 401);
    assert.equal((await c.call('POST', '/api/login', { username: 'ALICE', password: 'password123' })).status, 200);
    assert.equal((await c.call('GET', '/api/bootstrap')).status, 200);
  });

  const ids = {};
  await t.test('bootstrap includes default channels', async () => {
    const { data } = await alice.call('GET', '/api/bootstrap');
    const names = data.channels.map((c) => c.name).sort();
    assert.deepEqual(names, ['general', 'random']);
    ids.general = data.channels.find((c) => c.name === 'general').id;
    for (const u of data.users) ids[u.username] = u.id;
    assert.equal(data.users.length, 3);
  });

  await t.test('messages, mentions, unread counts and realtime delivery', async () => {
    const bobWs = await openSocket(srv.base, bob.cookie);
    t.after(() => bobWs.ws.close());

    const r = await alice.call('POST', `/api/channels/${ids.general}/messages`, { body: 'こんにちは @bob さん' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.message.mentionIds, [ids.bob]);
    ids.msg = r.data.message.id;

    const ev = await bobWs.next((e) => e.type === 'message.new' && e.message.id === ids.msg);
    assert.equal(ev.message.body, 'こんにちは @bob さん');

    let general = (await bob.call('GET', '/api/bootstrap')).data.channels.find((c) => c.id === ids.general);
    assert.equal(general.unread, 1);
    assert.equal(general.mentions, 1);

    await bob.call('POST', `/api/channels/${ids.general}/read`, {});
    general = (await bob.call('GET', '/api/bootstrap')).data.channels.find((c) => c.id === ids.general);
    assert.equal(general.unread, 0);
    assert.equal(general.mentions, 0);

    const list = await bob.call('GET', `/api/channels/${ids.general}/messages`);
    assert.ok(list.data.messages.some((m) => m.id === ids.msg));
  });

  await t.test('threads, reactions, editing and deletion', async () => {
    const reply = await bob.call('POST', `/api/channels/${ids.general}/messages`, { body: '返信です', parentId: ids.msg });
    assert.equal(reply.status, 200);
    const thread = await alice.call('GET', `/api/messages/${ids.msg}/thread`);
    assert.equal(thread.data.parent.replyCount, 1);
    assert.equal(thread.data.replies[0].body, '返信です');

    const nested = await bob.call('POST', `/api/channels/${ids.general}/messages`, { body: 'x', parentId: reply.data.message.id });
    assert.equal(nested.status, 400, 'cannot reply to a reply');

    let re = await bob.call('POST', `/api/messages/${ids.msg}/reactions`, { emoji: '👍' });
    assert.deepEqual(re.data.message.reactions, [{ emoji: '👍', userIds: [ids.bob] }]);
    re = await bob.call('POST', `/api/messages/${ids.msg}/reactions`, { emoji: '👍' });
    assert.deepEqual(re.data.message.reactions, []);

    assert.equal((await bob.call('PATCH', `/api/messages/${ids.msg}`, { body: 'hack' })).status, 403);
    const edited = await alice.call('PATCH', `/api/messages/${ids.msg}`, { body: '編集済み' });
    assert.ok(edited.data.message.editedAt);

    assert.equal((await carol.call('DELETE', `/api/messages/${reply.data.message.id}`)).status, 403);
    assert.equal((await bob.call('DELETE', `/api/messages/${reply.data.message.id}`)).status, 200);
    const after = await alice.call('GET', `/api/messages/${ids.msg}/thread`);
    assert.equal(after.data.parent.replyCount, 0);
    assert.equal(after.data.replies.length, 0);
  });

  await t.test('private channels are hidden from non-members', async () => {
    const created = await alice.call('POST', '/api/channels', { name: 'Secret Room', isPrivate: true, memberIds: [ids.bob] });
    assert.equal(created.status, 200);
    assert.equal(created.data.channel.name, 'secret-room');
    const cid = created.data.channel.id;
    await alice.call('POST', `/api/channels/${cid}/messages`, { body: 'ひみつの話 needle' });

    assert.equal((await carol.call('GET', `/api/channels/${cid}/messages`)).status, 404);
    assert.equal((await carol.call('POST', `/api/channels/${cid}/join`)).status, 404);
    assert.equal((await carol.call('POST', `/api/channels/${cid}/messages`, { body: 'hi' })).status, 404);
    assert.equal((await carol.call('GET', '/api/search?q=needle')).data.messages.length, 0);
    assert.equal((await bob.call('GET', '/api/search?q=needle')).data.messages.length, 1);
    const browse = await carol.call('GET', '/api/channels/browse');
    assert.ok(!browse.data.channels.some((c) => c.id === cid));
  });

  await t.test('public channels can be previewed and joined', async () => {
    const { data } = await alice.call('POST', '/api/channels', { name: 'dev', topic: '開発' });
    const cid = data.channel.id;
    assert.equal((await carol.call('GET', `/api/channels/${cid}/messages`)).status, 200);
    assert.equal((await carol.call('POST', `/api/messages/${ids.msg}/reactions`, { emoji: '🎉' })).status, 200);
    const joined = await carol.call('POST', `/api/channels/${cid}/join`);
    assert.equal(joined.data.channel.isMember, true);
    assert.equal(joined.data.channel.memberIds.length, 2);
    const left = await carol.call('POST', `/api/channels/${cid}/leave`);
    assert.equal(left.status, 200);
  });

  await t.test('direct messages are reused and private', async () => {
    const a = await alice.call('POST', '/api/dm', { userIds: [ids.bob] });
    const b = await bob.call('POST', '/api/dm', { userIds: [ids.alice] });
    assert.equal(a.data.channel.id, b.data.channel.id);
    assert.equal(a.data.channel.isDm, true);
    await alice.call('POST', `/api/channels/${a.data.channel.id}/messages`, { body: 'DM です' });
    assert.equal((await carol.call('GET', `/api/channels/${a.data.channel.id}/messages`)).status, 404);
    const bobDm = (await bob.call('GET', '/api/bootstrap')).data.channels.find((c) => c.id === a.data.channel.id);
    assert.equal(bobDm.unread, 1);
  });

  await t.test('file upload and access control', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const up = await alice.call('POST', '/api/files', png, { 'content-type': 'image/png', 'x-filename': encodeURIComponent('画像.png') });
    assert.equal(up.status, 200);
    assert.equal(up.data.file.name, '画像.png');
    assert.equal(up.data.file.isImage, true);

    // Not yet attached: only the uploader can fetch it.
    const fetchFile = (c) => fetch(srv.base + up.data.file.url, { headers: { cookie: c.cookie } });
    assert.equal((await fetchFile(alice)).status, 200);
    assert.equal((await fetchFile(bob)).status, 404);

    const dm = (await alice.call('POST', '/api/dm', { userIds: [ids.bob] })).data.channel;
    const sent = await alice.call('POST', `/api/channels/${dm.id}/messages`, { body: '', fileId: up.data.file.id });
    assert.equal(sent.status, 200);
    assert.equal((await fetchFile(bob)).status, 200);
    assert.equal((await fetchFile(carol)).status, 404);

    const html = await alice.call('POST', '/api/files', new TextEncoder().encode('<script>alert(1)</script>'), { 'content-type': 'text/html', 'x-filename': 'x.html' });
    const res = await fetch(srv.base + html.data.file.url, { headers: { cookie: alice.cookie } });
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition'), /^attachment/);
  });

  await t.test('websocket rejects unauthenticated connections', async () => {
    await assert.rejects(openSocket(srv.base, ''), /401/);
  });

  await t.test('logout invalidates the session', async () => {
    await carol.call('POST', '/api/logout');
    assert.equal((await carol.call('GET', '/api/bootstrap')).status, 401);
  });
});
