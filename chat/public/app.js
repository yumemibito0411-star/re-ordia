'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥', '😊', '😮', '😢', '🙌', '💯', '🚀', '👏', '🤔', '😅', '👌', '✨', '💡', '📌', '⭐', '🙇', '👋'];
  const SHORTCODES = {
    '+1': '👍', thumbsup: '👍', heart: '❤️', joy: '😂', tada: '🎉', pray: '🙏', eyes: '👀', white_check_mark: '✅',
    fire: '🔥', smile: '😊', open_mouth: '😮', cry: '😢', sob: '😭', raised_hands: '🙌', 100: '💯', rocket: '🚀',
    clap: '👏', thinking_face: '🤔', sweat_smile: '😅', ok_hand: '👌', sparkles: '✨', bulb: '💡', pushpin: '📌',
    star: '⭐', bow: '🙇', wave: '👋', coffee: '☕', warning: '⚠️', x: '❌', memo: '📝',
  };
  const MAX_UPLOAD = 20 * 1024 * 1024;

  const applyShortcodes = (text) => text.replace(/:([a-z0-9_+-]+):/g, (all, name) => SHORTCODES[name] || all);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(d, today)) return '今日';
    if (sameDay(d, yesterday)) return '昨日';
    return d.toLocaleDateString('ja-JP', {
      year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    });
  }
  function fmtWhen(ts) {
    return sameDay(ts, Date.now()) ? fmtTime(ts) : `${dayLabel(ts)} ${fmtTime(ts)}`;
  }
  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  async function api(method, url, body, extraHeaders) {
    const headers = { 'x-chat-client': '1', ...extraHeaders };
    let payload;
    if (body instanceof Blob) {
      payload = body;
      headers['content-type'] = body.type || 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && S.me) location.reload();
      const err = new Error(data.error || `エラーが発生しました (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const fail = (err) => toast(err.message || String(err));

  // ---------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------

  const S = {
    workspace: '',
    me: null,
    users: new Map(),
    channels: new Map(),
    current: null,
    messages: new Map(), // channelId -> { list, hasMore, atLatest, loading }
    unreadMarker: null,
    stick: true,
    panel: null, // { type: 'thread', channelId, parentId, parent, replies } | { type: 'search', q, results }
    editing: null, // { id, draft }
    drafts: new Map(),
    typing: new Map(), // "cid:pid" -> Map(uid -> timer)
    typingEls: new Map(),
    ws: null,
    wsRetries: 0,
    loggingOut: false,
  };

  const user = (id) => S.users.get(id) || { id, username: 'unknown', displayName: '不明なユーザー', color: '#888', status: '', online: false };
  const isViewing = (cid) => S.current === cid && document.visibilityState === 'visible';

  function channelLabel(c) {
    if (!c.isDm) return c.name;
    const others = c.memberIds.filter((id) => id !== S.me.id);
    if (!others.length) return `${S.me.displayName}（自分）`;
    return others.map((id) => user(id).displayName).join('、');
  }

  function avatar(u, size = '') {
    return h('span', { class: `avatar ${size}`, 'aria-hidden': 'true', 'data-color': u.color }, [...(u.displayName || '?')][0]);
  }
  // Colors are applied via CSSOM because the CSP forbids inline style attributes.
  function paintAvatars(root) {
    for (const el of root.querySelectorAll('.avatar[data-color]')) el.style.background = el.dataset.color;
  }

  // ---------------------------------------------------------------------------
  // message body formatting (DOM-built, never innerHTML)
  // ---------------------------------------------------------------------------

  const TOKEN = /(https?:\/\/[^\s<>"'「」（）]+)|(?<![\w@])@([a-z0-9._-]+)|(?<![\w&/])#([\p{L}\p{N}_-]+)|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)|(?<!\w)~([^~\n]+)~(?!\w)/gu;

  function formatText(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[1]) {
        const url = m[1].replace(/[.,!?;:)\]]+$/, '');
        out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
        if (url.length < m[1].length) out.push(m[1].slice(url.length));
      } else if (m[2]) {
        const name = m[2].replace(/\.+$/, '');
        const trail = m[2].slice(name.length);
        const lower = name.toLowerCase();
        const special = ['channel', 'here', 'all'].includes(lower);
        const u = [...S.users.values()].find((x) => x.username === lower);
        if (special) out.push(h('span', { class: 'mention me' }, `@${lower}`));
        else if (u) out.push(h('span', { class: `mention${u.id === S.me.id ? ' me' : ''}` }, `@${u.displayName}`));
        else out.push(`@${name}`);
        if (trail) out.push(trail);
      } else if (m[3]) {
        const c = [...S.channels.values()].find((x) => !x.isDm && x.name === m[3].toLowerCase());
        out.push(c ? h('span', { class: 'channel-link', onclick: () => openChannel(c.id) }, `#${c.name}`) : m[0]);
      } else if (m[4]) out.push(h('strong', {}, m[4]));
      else if (m[5]) out.push(h('em', {}, m[5]));
      else if (m[6]) out.push(h('del', {}, m[6]));
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function formatLines(text) {
    // "> quote" lines become blockquotes; everything else is inline-formatted.
    const out = [];
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const nl = i < lines.length - 1 ? '\n' : '';
      if (line.startsWith('> ') || line === '>') out.push(h('blockquote', {}, formatText(line.slice(2))));
      else out.push(...formatText(line + nl));
    });
    return out;
  }

  function renderBody(text) {
    const out = [];
    text.split(/```([\s\S]*?)```/).forEach((part, i) => {
      if (i % 2) {
        out.push(h('pre', {}, h('code', {}, part.replace(/^\n|\n$/g, ''))));
        return;
      }
      part.split(/`([^`\n]+)`/).forEach((seg, j) => {
        if (j % 2) out.push(h('code', {}, seg));
        else if (seg) out.push(...formatLines(seg));
      });
    });
    return out;
  }

  function systemText(m) {
    const name = `${user(m.userId).displayName} さん`;
    if (m.body === 'joined') return `${name}がチャンネルに参加しました`;
    if (m.body === 'left') return `${name}がチャンネルから退出しました`;
    if (m.body.startsWith('added:')) return `${user(Number(m.body.slice(6))).displayName} さんが${name}を追加しました`;
    if (m.body.startsWith('topic:')) {
      const topic = m.body.slice(6);
      return topic ? `${name}がトピックを「${topic}」に変更しました` : `${name}がトピックを削除しました`;
    }
    return m.body;
  }

  // ---------------------------------------------------------------------------
  // popovers, modals
  // ---------------------------------------------------------------------------

  let popoverCleanup = null;
  function showPopover(anchor, content, onClose) {
    closePopover();
    const pop = $('#popover');
    pop.replaceChildren(content);
    pop.hidden = false;
    paintAvatars(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
    const top = r.bottom + ph + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - ph - 4);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    const onDoc = (e) => {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover();
    };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    popoverCleanup = () => {
      document.removeEventListener('mousedown', onDoc);
      onClose?.();
    };
  }
  function closePopover() {
    $('#popover').hidden = true;
    const fn = popoverCleanup;
    popoverCleanup = null;
    fn?.();
  }

  function openModal(title, body) {
    closePopover();
    $('#modal-title').textContent = title;
    $('#modal-body').replaceChildren(body);
    $('#modal').hidden = false;
    paintAvatars($('#modal-body'));
    $('#modal-body').querySelector('input:not([type=checkbox]), textarea')?.focus();
  }
  const closeModal = () => { $('#modal').hidden = true; };

  function emojiPicker(anchor, onPick, onClose) {
    const grid = h('div', { class: 'emoji-grid' }, EMOJIS.map((e) => h('button', {
      type: 'button',
      onclick: () => { closePopover(); onPick(e); },
    }, e)));
    showPopover(anchor, grid, onClose);
  }

  function userCard(anchor, uid) {
    const u = user(uid);
    const card = h('div', { class: 'user-card' },
      avatar(u),
      h('div', { class: 'name' }, u.displayName),
      h('div', { class: 'sub' }, `@${u.username}`, u.online ? ' ・ オンライン' : ' ・ オフライン', u.status ? h('div', {}, u.status) : null),
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => { closePopover(); openDm([uid]); } }, 'メッセージを送信'));
    showPopover(anchor, card);
  }

  // ---------------------------------------------------------------------------
  // sidebar
  // ---------------------------------------------------------------------------

  function renderSidebar() {
    const mine = [...S.channels.values()].filter((c) => c.isMember);
    const item = (c, prefix, badge) => h('li', {},
      h('button', {
        type: 'button',
        class: `sidebar-item${c.id === S.current ? ' active' : ''}${c.unread || c.mentions ? ' unread' : ''}`,
        onclick: () => openChannel(c.id),
      }, prefix, h('span', { class: 'label' }, channelLabel(c)), badge ? h('span', { class: 'badge' }, badge) : null));

    $('#channel-list').replaceChildren(...mine.filter((c) => !c.isDm).sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => item(c, h('span', { class: 'prefix' }, c.isPrivate ? '🔒' : '#'), c.mentions)));

    $('#dm-list').replaceChildren(...mine.filter((c) => c.isDm).sort((a, b) => (b.latestId || 0) - (a.latestId || 0))
      .map((c) => {
        const others = c.memberIds.filter((id) => id !== S.me.id);
        const prefix = others.length > 1
          ? h('span', { class: 'prefix' }, others.length)
          : h('span', { class: 'prefix' }, h('span', { class: `presence${user(others[0] ?? S.me.id).online ? ' online' : ''}` }));
        return item(c, prefix, c.unread || c.mentions);
      }));

    const me = user(S.me.id);
    $('#me-btn').replaceChildren(h('span', { class: 'avatar-wrap' }, avatar(me, 'sm'), h('span', { class: `presence${me.online ? ' online' : ''}` })));
    paintAvatars($('#sidebar'));
    paintAvatars($('#me-btn'));

    const total = mine.reduce((n, c) => n + (c.isDm ? c.unread || c.mentions : c.mentions), 0);
    const anyUnread = mine.some((c) => c.unread);
    document.title = `${total ? `(${total}) ` : anyUnread ? '* ' : ''}${S.workspace}`;
  }

  // ---------------------------------------------------------------------------
  // channel view
  // ---------------------------------------------------------------------------

  function defaultChannelId() {
    const list = [...S.channels.values()].filter((c) => c.isMember && !c.isDm);
    return (list.find((c) => c.name === 'general') || list[0] || [...S.channels.values()][0])?.id;
  }

  async function openChannel(id, { jumpTo } = {}) {
    let c = S.channels.get(id);
    if (!c) {
      try {
        c = (await api('GET', `/api/channels/${id}`)).channel;
        S.channels.set(c.id, c);
      } catch (err) {
        fail(err);
        const fallback = defaultChannelId();
        if (fallback && fallback !== id) openChannel(fallback);
        return;
      }
    }
    const switching = S.current !== id;
    S.current = id;
    if (location.hash !== `#/c/${id}`) history.replaceState(null, '', `#/c/${id}`);
    $('#app').classList.remove('sidebar-open');
    if (switching) {
      S.unreadMarker = c.isMember && c.unread ? c.lastReadId : null;
      S.editing = null;
      renderComposerArea();
    }
    renderHeader();
    renderSidebar();

    let entry = S.messages.get(id);
    const hasTarget = jumpTo && entry?.list.some((m) => m.id === jumpTo);
    if (!entry || (jumpTo && !hasTarget)) {
      $('#messages').replaceChildren(h('div', { class: 'load-more' }, '読み込み中…'));
      try {
        entry = await loadMessages(id, jumpTo ? { before: jumpTo + 1 } : {});
      } catch (err) {
        return fail(err);
      }
      if (S.current !== id) return;
    }
    renderMessages(jumpTo ? { scrollToId: jumpTo } : { toBottom: switching || !jumpTo });
    markRead(c);
    if (switching && window.matchMedia('(min-width: 761px)').matches) $('#composer-area textarea')?.focus();
  }

  async function loadMessages(cid, { before } = {}) {
    const url = `/api/channels/${cid}/messages${before ? `?before=${before}` : ''}`;
    const { messages, hasMore } = await api('GET', url);
    const c = S.channels.get(cid);
    const lastId = messages.at(-1)?.id || 0;
    const entry = { list: messages, hasMore, atLatest: !before || !c?.latestId || lastId >= c.latestId, loading: false };
    S.messages.set(cid, entry);
    return entry;
  }

  async function loadOlder() {
    const cid = S.current;
    const entry = S.messages.get(cid);
    if (!entry || !entry.hasMore || entry.loading || !entry.list.length) return;
    entry.loading = true;
    try {
      const { messages, hasMore } = await api('GET', `/api/channels/${cid}/messages?before=${entry.list[0].id}`);
      entry.list = [...messages, ...entry.list];
      entry.hasMore = hasMore;
      if (S.current === cid) renderMessages({ prepend: true });
    } catch (err) {
      fail(err);
    } finally {
      entry.loading = false;
    }
  }

  function renderHeader() {
    const c = S.channels.get(S.current);
    if (!c) return;
    $('#channel-name').textContent = c.isDm ? channelLabel(c) : `${c.isPrivate ? '🔒 ' : '# '}${c.name}`;
    const topic = $('#channel-topic');
    if (c.isDm) {
      const others = c.memberIds.filter((id) => id !== S.me.id);
      topic.textContent = others.length === 1 ? user(others[0]).status : '';
      topic.disabled = true;
    } else {
      topic.textContent = c.topic || (c.isMember ? 'トピックを追加' : '');
      topic.disabled = !c.isMember;
    }
    $('#members-btn').textContent = `👥 ${c.memberIds.length}`;
  }

  function messageGroups(list) {
    const nodes = [];
    let prev = null;
    let markerShown = false;
    for (const m of list) {
      if (!prev || !sameDay(prev.createdAt, m.createdAt)) {
        nodes.push(h('div', { class: 'day-divider' }, h('span', {}, dayLabel(m.createdAt))));
        prev = null;
      }
      let showMarker = false;
      if (!markerShown && S.unreadMarker != null && m.id > S.unreadMarker && m.userId !== S.me.id) {
        nodes.push(h('div', { class: 'new-divider' }, '新着'));
        markerShown = true;
        showMarker = true;
      }
      const compact = !!prev && !showMarker && prev.userId === m.userId && prev.kind === 'message' && m.kind === 'message'
        && m.createdAt - prev.createdAt < 5 * 60 * 1000;
      nodes.push(renderMessage(m, { compact }));
      prev = m;
    }
    return nodes;
  }

  function renderMessages({ toBottom, scrollToId, prepend } = {}) {
    const box = $('#messages');
    const c = S.channels.get(S.current);
    const entry = S.messages.get(S.current);
    if (!c || !entry) return;
    const prevTop = box.scrollTop;
    const prevHeight = box.scrollHeight;
    const nearBottom = S.stick;

    const intro = entry.hasMore
      ? h('div', { class: 'load-more' }, entry.loading ? '読み込み中…' : '')
      : h('div', { class: 'messages-intro' },
        h('h3', {}, c.isDm ? channelLabel(c) : `${c.isPrivate ? '🔒' : '#'} ${c.name}`),
        h('p', {}, c.isDm
          ? 'ここはダイレクトメッセージの始まりです。'
          : `#${c.name} チャンネルの始まりです。${c.topic ? ` ${c.topic}` : ''}`));
    box.replaceChildren(intro, ...messageGroups(entry.list));
    paintAvatars(box);

    if (scrollToId) {
      const el = box.querySelector(`.msg[data-id="${scrollToId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        flash(el);
      }
    } else if (prepend) {
      box.scrollTop = box.scrollHeight - prevHeight + prevTop;
    } else if (toBottom || nearBottom) {
      box.scrollTop = box.scrollHeight;
    } else {
      box.scrollTop = prevTop;
    }
    updateStick();
    $('#jump-latest').hidden = entry.atLatest;
  }

  function flash(el) {
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 2000);
  }

  function updateStick() {
    const box = $('#messages');
    S.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  }

  function renderMessage(m, { compact = false, inPanel = false, isThreadParent = false } = {}) {
    const u = user(m.userId);
    const c = S.channels.get(m.channelId);
    if (m.kind === 'system') {
      return h('div', { class: 'msg system compact', 'data-id': m.id },
        h('div', { class: 'msg-gutter' }, h('span', { class: 'time-hover' }, fmtTime(m.createdAt))),
        h('div', { class: 'msg-content' }, h('div', { class: 'msg-body' }, systemText(m))));
    }

    const el = h('div', { class: `msg${compact ? ' compact' : ''}`, 'data-id': m.id });
    const authorBtn = h('button', { type: 'button', class: 'msg-author', onclick: (e) => userCard(e.currentTarget, m.userId) }, u.displayName);
    const gutter = h('div', { class: 'msg-gutter' }, compact
      ? h('span', { class: 'time-hover', title: new Date(m.createdAt).toLocaleString('ja-JP') }, fmtTime(m.createdAt))
      : avatar(u));

    const content = h('div', { class: 'msg-content' });
    if (!compact) {
      content.append(h('div', { class: 'msg-meta' }, authorBtn,
        h('span', { class: 'msg-time', title: new Date(m.createdAt).toLocaleString('ja-JP') }, fmtTime(m.createdAt))));
    }

    if (m.deleted) {
      content.append(h('div', { class: 'msg-body msg-deleted' }, 'このメッセージは削除されました'));
    } else if (S.editing?.id === m.id) {
      content.append(messageEditor(m));
    } else {
      const body = h('div', { class: 'msg-body' }, renderBody(m.body));
      if (m.editedAt) body.append(' ', h('span', { class: 'msg-edited', title: new Date(m.editedAt).toLocaleString('ja-JP') }, '(編集済み)'));
      if (m.body) content.append(body);
    }

    if (m.file) content.append(attachment(m.file));

    if (m.reactions.length) {
      content.append(h('div', { class: 'reactions' },
        m.reactions.map((r) => h('button', {
          type: 'button',
          class: `reaction${r.userIds.includes(S.me.id) ? ' mine' : ''}`,
          title: r.userIds.map((id) => user(id).displayName).join('、'),
          onclick: () => react(m, r.emoji),
        }, r.emoji, h('span', { class: 'count' }, r.userIds.length))),
        c?.isMember ? h('button', {
          type: 'button', class: 'reaction add', title: 'リアクションを追加',
          onclick: (e) => emojiPicker(e.currentTarget, (emoji) => react(m, emoji)),
        }, '☺＋') : null));
    }

    if (!inPanel && m.replyCount > 0) {
      content.append(h('button', { type: 'button', class: 'thread-summary', onclick: () => openThread(m.id) },
        m.replyUserIds.map((id) => avatar(user(id), 'xs')),
        h('span', { class: 'count' }, `${m.replyCount}件の返信`),
        m.lastReplyAt ? h('span', { class: 'when' }, `最終返信 ${fmtWhen(m.lastReplyAt)}`) : null));
    }

    el.append(gutter, content);

    if (!m.deleted && c?.isMember && S.editing?.id !== m.id) {
      const canEdit = m.userId === S.me.id;
      const canDelete = canEdit || S.me.isAdmin;
      const actions = h('div', { class: 'msg-actions' },
        h('button', {
          type: 'button', class: 'icon-btn', title: 'リアクション', 'aria-label': 'リアクション',
          onclick: (e) => {
            el.classList.add('menu-open');
            emojiPicker(e.currentTarget, (emoji) => react(m, emoji), () => el.classList.remove('menu-open'));
          },
        }, '☺'),
        !m.parentId && !isThreadParent ? h('button', {
          type: 'button', class: 'icon-btn', title: 'スレッドで返信', 'aria-label': 'スレッドで返信', onclick: () => openThread(m.id),
        }, '💬') : null,
        canDelete ? h('button', {
          type: 'button', class: 'icon-btn', title: 'その他', 'aria-label': 'その他',
          onclick: (e) => {
            el.classList.add('menu-open');
            showPopover(e.currentTarget, h('div', { class: 'menu' },
              canEdit ? h('button', { type: 'button', onclick: () => { closePopover(); startEdit(m); } }, 'メッセージを編集') : null,
              h('button', { type: 'button', class: 'danger', onclick: () => { closePopover(); deleteMessage(m); } }, 'メッセージを削除')),
            () => el.classList.remove('menu-open'));
          },
        }, '⋯') : null);
      el.append(actions);
    }
    return el;
  }

  function attachment(file) {
    if (file.isImage) {
      const img = h('img', { src: file.url, alt: file.name, loading: 'lazy' });
      img.addEventListener('load', () => { if (S.stick) $('#messages').scrollTop = $('#messages').scrollHeight; });
      img.addEventListener('click', () => {
        const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src: file.url, alt: file.name }));
        document.body.append(lb);
      });
      return h('div', { class: 'attachment' }, img);
    }
    const ext = (file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
    return h('div', { class: 'attachment' },
      h('a', { class: 'file-card', href: file.url, download: file.name },
        h('span', { class: 'file-icon' }, ext),
        h('span', {}, h('div', { class: 'file-name' }, file.name), h('div', { class: 'file-size' }, fmtSize(file.size)))));
  }

  function messageEditor(m) {
    const ta = h('textarea', { 'aria-label': 'メッセージを編集' });
    ta.value = S.editing.draft;
    const save = async () => {
      const body = applyShortcodes(ta.value).trim();
      if (!body && !m.file) return deleteMessage(m);
      try {
        const { message } = await api('PATCH', `/api/messages/${m.id}`, { body });
        S.editing = null;
        upsertMessage(message);
        rerender();
      } catch (err) {
        fail(err);
      }
    };
    const cancel = () => { S.editing = null; rerender(); };
    ta.addEventListener('input', () => { S.editing.draft = ta.value; });
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    return h('div', { class: 'msg-editor' }, ta,
      h('div', { class: 'hint' },
        h('button', { type: 'button', class: 'btn', onclick: cancel }, 'キャンセル'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, '保存'),
        h('span', {}, 'Enter で保存 / Esc でキャンセル')));
  }

  function startEdit(m) {
    S.editing = { id: m.id, draft: m.body };
    rerender();
  }

  async function deleteMessage(m) {
    if (!confirm('このメッセージを削除しますか？この操作は取り消せません。')) return;
    try {
      await api('DELETE', `/api/messages/${m.id}`);
      if (S.editing?.id === m.id) S.editing = null;
    } catch (err) {
      fail(err);
    }
  }

  async function react(m, emoji) {
    try {
      const { message } = await api('POST', `/api/messages/${m.id}/reactions`, { emoji });
      upsertMessage(message);
      rerender();
    } catch (err) {
      fail(err);
    }
  }

  let markReadTimer;
  function markRead(c) {
    if (!c?.isMember || !isViewing(c.id)) return;
    if (!c.unread && !c.mentions && c.lastReadId >= (c.latestId || 0)) return;
    c.unread = 0;
    c.mentions = 0;
    renderSidebar();
    clearTimeout(markReadTimer);
    markReadTimer = setTimeout(() => api('POST', `/api/channels/${c.id}/read`, {}).catch(() => {}), 300);
  }

  // ---------------------------------------------------------------------------
  // composer
  // ---------------------------------------------------------------------------

  function renderComposerArea() {
    const area = $('#composer-area');
    const c = S.channels.get(S.current);
    S.typingEls.forEach((_, key) => { if (!key.endsWith(':0')) return; S.typingEls.delete(key); });
    if (!c) return area.replaceChildren();
    if (!c.isMember) {
      area.replaceChildren(h('div', { class: 'join-bar' },
        h('p', {}, `#${c.name} をプレビューしています`),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => joinChannel(c.id) }, 'チャンネルに参加')));
      return;
    }
    const placeholder = c.isDm ? `${channelLabel(c)} へのメッセージ` : `#${c.name} へのメッセージ`;
    area.replaceChildren(makeComposer({ channelId: c.id, parentId: null, placeholder }));
  }

  function makeComposer({ channelId, parentId, placeholder }) {
    const key = `${channelId}:${parentId || 0}`;
    const ta = h('textarea', { rows: '1', placeholder, 'aria-label': placeholder });
    ta.value = S.drafts.get(key) || '';
    let pendingFile = null;
    let uploading = false;
    let lastTypingSent = 0;
    let ac = null; // autocomplete state { items, index, start }

    const fileInput = h('input', { type: 'file', hidden: true });
    const fileRow = h('div', { class: 'composer-file', hidden: true });
    const sendBtn = h('button', { type: 'button', class: 'send', title: '送信 (Enter)', 'aria-label': '送信' }, '➤');
    const acList = h('ul', { class: 'autocomplete', hidden: true, role: 'listbox' });
    const box = h('div', { class: 'composer' }, acList, fileRow, ta,
      h('div', { class: 'composer-toolbar' },
        h('button', { type: 'button', class: 'icon-btn', title: 'ファイルを添付', 'aria-label': 'ファイルを添付', onclick: () => fileInput.click() }, '📎'),
        h('button', {
          type: 'button', class: 'icon-btn', title: '絵文字', 'aria-label': '絵文字',
          onclick: (e) => emojiPicker(e.currentTarget, (emoji) => { insertAtCursor(emoji); }),
        }, '☺'),
        h('button', { type: 'button', class: 'icon-btn', title: 'メンション', 'aria-label': 'メンション', onclick: () => insertAtCursor('@') }, '@'),
        h('span', { class: 'spacer' }),
        sendBtn),
      fileInput);
    const typingEl = h('div', { class: 'typing', 'aria-live': 'polite' });
    S.typingEls.set(key, typingEl);
    renderTyping(key);

    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
    };
    const refreshSend = () => { sendBtn.disabled = uploading || (!ta.value.trim() && !pendingFile); };
    function insertAtCursor(text) {
      const { selectionStart: s, selectionEnd: e } = ta;
      ta.setRangeText(text, s, e, 'end');
      ta.focus();
      onInput();
    }

    function showFile() {
      if (!pendingFile && !uploading) {
        fileRow.hidden = true;
        return;
      }
      fileRow.hidden = false;
      fileRow.replaceChildren(
        h('span', {}, uploading ? '⏳' : '📄'),
        h('span', { class: 'file-name' }, uploading ? `アップロード中… ${uploading}` : pendingFile.name),
        pendingFile ? h('span', { class: 'file-size' }, fmtSize(pendingFile.size)) : null,
        pendingFile ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': '添付を取り消す', onclick: () => { pendingFile = null; showFile(); refreshSend(); } }, '✕') : null);
    }

    async function upload(file) {
      if (!file) return;
      if (file.size > MAX_UPLOAD) return toast('ファイルサイズは20MBまでです');
      uploading = file.name || 'file';
      showFile();
      refreshSend();
      try {
        const { file: f } = await api('POST', '/api/files', file, { 'x-filename': encodeURIComponent(file.name || 'paste.png') });
        pendingFile = f;
      } catch (err) {
        fail(err);
      } finally {
        uploading = false;
        showFile();
        refreshSend();
        ta.focus();
      }
    }

    async function send() {
      const body = applyShortcodes(ta.value).trim();
      if ((!body && !pendingFile) || uploading) return;
      sendBtn.disabled = true;
      try {
        const { message } = await api('POST', `/api/channels/${channelId}/messages`, { body, parentId, fileId: pendingFile?.id });
        ta.value = '';
        S.drafts.delete(key);
        pendingFile = null;
        showFile();
        autosize();
        S.stick = true;
        onNewMessage(message);
      } catch (err) {
        fail(err);
      } finally {
        refreshSend();
      }
    }

    function closeAc() {
      ac = null;
      acList.hidden = true;
    }
    function renderAc() {
      acList.replaceChildren(...ac.items.map((it, i) => h('li', {
        class: i === ac.index ? 'active' : '',
        role: 'option',
        onmousedown: (e) => { e.preventDefault(); ac.index = i; pickAc(); },
      }, it.user ? avatar(it.user, 'xs') : h('span', {}, '📣'), h('span', {}, it.label), h('span', { class: 'sub' }, it.sub))));
      paintAvatars(acList);
      acList.hidden = false;
    }
    function updateAc() {
      const before = ta.value.slice(0, ta.selectionStart);
      const m = /(^|\s)@([\w.-]*)$/.exec(before);
      if (!m) return closeAc();
      const q = m[2].toLowerCase();
      const c = S.channels.get(channelId);
      const members = new Set(c?.memberIds || []);
      const users = [...S.users.values()]
        .filter((u) => u.username.includes(q) || u.displayName.toLowerCase().includes(q))
        .sort((a, b) => (members.has(b.id) - members.has(a.id)) || a.displayName.localeCompare(b.displayName))
        .slice(0, 8)
        .map((u) => ({ insert: u.username, label: u.displayName, sub: `@${u.username}${members.has(u.id) ? '' : '（未参加）'}`, user: u }));
      const specials = c && !c.isDm ? [
        { insert: 'channel', label: '@channel', sub: 'チャンネルの全員に通知' },
        { insert: 'here', label: '@here', sub: 'チャンネルの全員に通知' },
      ].filter((s) => s.insert.startsWith(q)) : [];
      const items = [...users, ...specials];
      if (!items.length) return closeAc();
      ac = { items, index: 0, start: before.length - q.length };
      renderAc();
    }
    function pickAc() {
      const it = ac.items[ac.index];
      ta.setRangeText(`${it.insert} `, ac.start, ta.selectionStart, 'end');
      closeAc();
      ta.focus();
      onInput();
    }

    function onInput() {
      S.drafts.set(key, ta.value);
      autosize();
      refreshSend();
      updateAc();
      if (ta.value.trim() && Date.now() - lastTypingSent > 3000 && S.ws?.readyState === 1) {
        lastTypingSent = Date.now();
        S.ws.send(JSON.stringify({ type: 'typing', channelId, parentId }));
      }
    }

    ta.addEventListener('input', onInput);
    ta.addEventListener('click', updateAc);
    ta.addEventListener('blur', () => setTimeout(closeAc, 100));
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (ac) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          ac.index = (ac.index + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length;
          return renderAc();
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickAc(); }
        if (e.key === 'Escape') { e.preventDefault(); return closeAc(); }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      } else if (e.key === 'ArrowUp' && !ta.value && !parentId) {
        const entry = S.messages.get(channelId);
        const mine = entry?.list.filter((m) => m.userId === S.me.id && m.kind === 'message' && !m.deleted).at(-1);
        if (mine) { e.preventDefault(); startEdit(mine); }
      }
    });
    ta.addEventListener('paste', (e) => {
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        upload(file);
      }
    });
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('dragover');
      upload(e.dataTransfer?.files?.[0]);
    });
    fileInput.addEventListener('change', () => { upload(fileInput.files[0]); fileInput.value = ''; });
    sendBtn.addEventListener('click', send);

    requestAnimationFrame(autosize);
    refreshSend();
    return h('div', {}, box, typingEl);
  }

  function renderTyping(key) {
    const el = S.typingEls.get(key);
    if (!el) return;
    const ids = [...(S.typing.get(key)?.keys() || [])];
    const names = ids.map((id) => `${user(id).displayName} さん`);
    el.textContent = !names.length ? '' : names.length > 2 ? '複数人が入力中…' : `${names.join('と')}が入力中…`;
  }

  function setTyping(cid, pid, uid, on) {
    const key = `${cid}:${pid || 0}`;
    if (!S.typing.has(key)) S.typing.set(key, new Map());
    const map = S.typing.get(key);
    clearTimeout(map.get(uid));
    if (on) map.set(uid, setTimeout(() => setTyping(cid, pid, uid, false), 5000));
    else map.delete(uid);
    renderTyping(key);
  }

  async function joinChannel(id) {
    try {
      const { channel } = await api('POST', `/api/channels/${id}/join`);
      S.channels.set(channel.id, channel);
      renderComposerArea();
      openChannel(channel.id);
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------------------
  // side panel: threads & search
  // ---------------------------------------------------------------------------

  async function openThread(parentId, { highlightId } = {}) {
    try {
      const { parent, replies } = await api('GET', `/api/messages/${parentId}/thread`);
      S.panel = { type: 'thread', channelId: parent.channelId, parentId: parent.id, parent, replies };
      const c = S.channels.get(parent.channelId);
      $('#panel-title').replaceChildren('スレッド', h('small', {}, c ? (c.isDm ? channelLabel(c) : `#${c.name}`) : ''));
      $('#panel').hidden = false;
      S.typingEls.forEach((_, key) => { if (!key.endsWith(':0')) S.typingEls.delete(key); });
      $('#panel-footer').replaceChildren(c?.isMember
        ? makeComposer({ channelId: parent.channelId, parentId: parent.id, placeholder: '返信する…' })
        : h('div', { class: 'empty' }, '返信するにはチャンネルに参加してください'));
      renderPanel({ toBottom: !highlightId });
      if (highlightId) {
        const el = $('#panel-body').querySelector(`.msg[data-id="${highlightId}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); flash(el); }
      }
      $('#panel-footer textarea')?.focus();
    } catch (err) {
      fail(err);
    }
  }

  function closePanel() {
    S.panel = null;
    $('#panel').hidden = true;
    S.typingEls.forEach((_, key) => { if (!key.endsWith(':0')) S.typingEls.delete(key); });
  }

  function renderPanel({ toBottom } = {}) {
    const p = S.panel;
    const body = $('#panel-body');
    if (!p) return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    const prevTop = body.scrollTop;
    if (p.type === 'thread') {
      body.replaceChildren(
        renderMessage(p.parent, { inPanel: true, isThreadParent: true }),
        p.replies.length ? h('div', { class: 'reply-divider' }, `${p.replies.length}件の返信`) : null,
        ...p.replies.map((m, i) => {
          const prev = p.replies[i - 1];
          const compact = !!prev && prev.userId === m.userId && m.createdAt - prev.createdAt < 5 * 60 * 1000;
          return renderMessage(m, { inPanel: true, compact });
        }),
      );
    } else if (p.type === 'search') {
      body.replaceChildren(...(p.results.length ? p.results.map((m) => {
        const c = S.channels.get(m.channelId);
        const where = c ? (c.isDm ? channelLabel(c) : `#${c.name}`) : 'チャンネル';
        return h('div', { class: 'search-result', onclick: () => jumpToMessage(m) },
          h('div', { class: 'where' }, `${where} ・ ${fmtWhen(m.createdAt)}${m.parentId ? ' ・ スレッド' : ''}`),
          renderMessage({ ...m, replyCount: 0, reactions: [] }, { inPanel: true, isThreadParent: true }));
      }) : [h('div', { class: 'empty' }, `「${p.q}」に一致するメッセージはありません`)]));
      body.querySelectorAll('.msg-actions').forEach((el) => el.remove());
    }
    paintAvatars(body);
    body.scrollTop = toBottom || nearBottom ? body.scrollHeight : prevTop;
  }

  async function search(q) {
    q = q.trim();
    if (!q) return;
    try {
      const { messages } = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
      // Make sure channel names for results are resolvable (public channels the user hasn't joined).
      await Promise.all([...new Set(messages.map((m) => m.channelId))].filter((id) => !S.channels.has(id))
        .map((id) => api('GET', `/api/channels/${id}`).then(({ channel }) => S.channels.set(channel.id, channel)).catch(() => {})));
      S.panel = { type: 'search', q, results: messages };
      $('#panel-title').replaceChildren('検索結果', h('small', {}, `${messages.length}件`));
      $('#panel-footer').replaceChildren();
      $('#panel').hidden = false;
      renderPanel();
      $('#panel-body').scrollTop = 0;
    } catch (err) {
      fail(err);
    }
  }

  async function jumpToMessage(m) {
    if (m.parentId) {
      await openChannel(m.channelId);
      openThread(m.parentId, { highlightId: m.id });
    } else {
      if (window.matchMedia('(max-width: 1100px)').matches) closePanel();
      openChannel(m.channelId, { jumpTo: m.id });
    }
  }

  // ---------------------------------------------------------------------------
  // modals
  // ---------------------------------------------------------------------------

  function formError() {
    return h('p', { class: 'form-error', role: 'alert' });
  }

  function newChannelModal() {
    const err = formError();
    const form = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', {}, '名前'), h('input', { name: 'name', required: true, maxlength: '80', placeholder: '例: プロジェクト-x' }),
        h('small', {}, '小文字・数字・ハイフン・アンダースコアが使えます')),
      h('label', { class: 'field' }, h('span', {}, 'トピック（任意）'), h('input', { name: 'topic', maxlength: '250', placeholder: 'このチャンネルの目的' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPrivate' }),
        h('span', {}, 'プライベートにする', h('small', {}, '招待されたメンバーだけが閲覧・参加できます'))),
      err,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '作成')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const { channel } = await api('POST', '/api/channels', { name: fd.get('name'), topic: fd.get('topic'), isPrivate: fd.get('isPrivate') === 'on' });
        S.channels.set(channel.id, channel);
        closeModal();
        openChannel(channel.id);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    openModal('チャンネルを作成', form);
  }

  async function browseChannelsModal() {
    let channels;
    try {
      ({ channels } = await api('GET', '/api/channels/browse'));
    } catch (err) {
      return fail(err);
    }
    const list = h('ul', { class: 'list' });
    const filter = h('input', { class: 'filter', type: 'search', placeholder: 'チャンネルを検索' });
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...channels.filter((c) => c.name.includes(q) || c.topic.toLowerCase().includes(q)).map((c) => h('li', { class: 'list-item' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, `# ${c.name}`), h('div', { class: 'sub' }, `${c.memberIds.length}人のメンバー${c.topic ? ` ・ ${c.topic}` : ''}`)),
        h('button', { type: 'button', class: 'btn', onclick: () => { closeModal(); openChannel(c.id); } }, c.isMember ? '開く' : 'プレビュー'),
        c.isMember ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { closeModal(); joinChannel(c.id); } }, '参加'))));
      if (!list.children.length) list.append(h('li', { class: 'empty' }, '見つかりませんでした'));
    };
    filter.addEventListener('input', render);
    render();
    openModal('チャンネル一覧', h('div', {}, filter, list,
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn', onclick: newChannelModal }, '＋ 新しいチャンネルを作成'))));
  }

  function userPicker({ exclude = [], submitLabel, onSubmit }) {
    const selected = new Set();
    const filter = h('input', { class: 'filter', type: 'search', placeholder: '名前で検索' });
    const chips = h('div', { class: 'chips' });
    const list = h('ul', { class: 'list' });
    const err = formError();
    const submit = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, submitLabel);
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      chips.replaceChildren(...[...selected].map((id) => h('span', { class: 'chip' }, user(id).displayName,
        h('button', { type: 'button', 'aria-label': '削除', onclick: () => { selected.delete(id); render(); } }, '✕'))));
      list.replaceChildren(...[...S.users.values()]
        .filter((u) => !exclude.includes(u.id) && (u.username.includes(q) || u.displayName.toLowerCase().includes(q)))
        .map((u) => {
          const cb = h('input', { type: 'checkbox', checked: selected.has(u.id) });
          cb.addEventListener('change', () => { if (cb.checked) selected.add(u.id); else selected.delete(u.id); render(); });
          return h('li', {}, h('label', { class: 'list-item' }, cb, avatar(u, 'sm'),
            h('div', { class: 'grow' }, h('div', { class: 'title' }, u.displayName, u.id === S.me.id ? '（自分）' : ''), h('div', { class: 'sub' }, `@${u.username}${u.status ? ` ・ ${u.status}` : ''}`)),
            h('span', { class: `presence${u.online ? ' online' : ''}` })));
        }));
      if (!list.children.length) list.append(h('li', { class: 'empty' }, '該当するユーザーがいません'));
      paintAvatars(list);
      submit.disabled = !selected.size;
    };
    filter.addEventListener('input', render);
    submit.addEventListener('click', async () => {
      try {
        await onSubmit([...selected]);
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    render();
    return h('div', {}, filter, chips, list, err, h('div', { class: 'form-actions' }, submit));
  }

  function newDmModal() {
    openModal('ダイレクトメッセージ', userPicker({
      submitLabel: 'メッセージを開始',
      onSubmit: async (ids) => {
        closeModal();
        await openDm(ids);
      },
    }));
  }

  async function openDm(userIds) {
    try {
      const { channel } = await api('POST', '/api/dm', { userIds });
      S.channels.set(channel.id, channel);
      openChannel(channel.id);
    } catch (err) {
      fail(err);
    }
  }

  function membersModal() {
    const c = S.channels.get(S.current);
    if (!c) return;
    const members = c.memberIds.map(user).sort((a, b) => (b.online - a.online) || a.displayName.localeCompare(b.displayName));
    const list = h('ul', { class: 'list' }, members.map((u) => h('li', { class: 'list-item' },
      avatar(u, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, u.displayName, u.id === S.me.id ? '（自分）' : ''), h('div', { class: 'sub' }, `@${u.username}${u.status ? ` ・ ${u.status}` : ''}`)),
      h('span', { class: `presence${u.online ? ' online' : ''}`, title: u.online ? 'オンライン' : 'オフライン' }),
      u.id !== S.me.id ? h('button', { type: 'button', class: 'btn', onclick: () => { closeModal(); openDm([u.id]); } }, 'DM') : null)));
    const actions = h('div', { class: 'form-actions' });
    if (!c.isDm && c.isMember) {
      actions.append(
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => leaveChannel(c) }, 'チャンネルから退出'),
        h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => openModal(`#${c.name} にメンバーを追加`, userPicker({
            exclude: c.memberIds,
            submitLabel: '追加',
            onSubmit: async (ids) => {
              const { channel } = await api('POST', `/api/channels/${c.id}/members`, { userIds: ids });
              S.channels.set(channel.id, channel);
              renderHeader();
              closeModal();
              toast(`${ids.length}人を追加しました`);
            },
          })),
        }, 'メンバーを追加'));
    }
    openModal(`${c.isDm ? channelLabel(c) : `#${c.name}`} のメンバー（${members.length}）`, h('div', {}, list, h('hr', { class: 'sep' }), actions));
  }

  async function leaveChannel(c) {
    if (!confirm(`#${c.name} から退出しますか？`)) return;
    try {
      await api('POST', `/api/channels/${c.id}/leave`);
      closeModal();
    } catch (err) {
      fail(err);
    }
  }

  function topicModal() {
    const c = S.channels.get(S.current);
    if (!c || c.isDm || !c.isMember) return;
    const err = formError();
    const input = h('input', { name: 'topic', maxlength: '250', value: c.topic });
    const form = h('form', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'トピック'), input), err,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '保存')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PATCH', `/api/channels/${c.id}`, { topic: input.value });
        closeModal();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    openModal(`#${c.name} のトピックを編集`, form);
  }

  function profileModal() {
    const me = user(S.me.id);
    const err = formError();
    const form = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', {}, '表示名'), h('input', { name: 'displayName', required: true, maxlength: '50', value: me.displayName })),
      h('label', { class: 'field' }, h('span', {}, 'ステータス'), h('input', { name: 'status', maxlength: '100', value: me.status, placeholder: '例: 🏠 在宅勤務中 / 🍱 ランチ中' })),
      err,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '保存')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api('PATCH', '/api/me', { displayName: fd.get('displayName'), status: fd.get('status') });
        closeModal();
        toast('プロフィールを更新しました');
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    const pwErr = formError();
    const pwForm = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', {}, '現在のパスワード'), h('input', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true })),
      h('label', { class: 'field' }, h('span', {}, '新しいパスワード'), h('input', { name: 'newPassword', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' })),
      pwErr,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn' }, 'パスワードを変更')));
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(pwForm);
      try {
        await api('POST', '/api/me/password', { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') });
        pwForm.reset();
        pwErr.textContent = '';
        toast('パスワードを変更しました（他の端末はログアウトされます）');
      } catch (ex) {
        pwErr.textContent = ex.message;
      }
    });

    openModal('プロフィール', h('div', {},
      h('div', { class: 'profile-head' }, avatar(me), h('div', {}, h('div', { class: 'name' }, me.displayName), h('div', { class: 'sub' }, `@${me.username}${me.isAdmin ? ' ・ 管理者' : ''}`))),
      form, h('hr', { class: 'sep' }), pwForm));
  }

  function meMenu(anchor) {
    showPopover(anchor, h('div', { class: 'menu' },
      h('button', { type: 'button', onclick: () => { closePopover(); profileModal(); } }, 'プロフィールを編集'),
      'Notification' in window && Notification.permission === 'default'
        ? h('button', { type: 'button', onclick: () => { closePopover(); Notification.requestPermission(); } }, 'デスクトップ通知を有効にする') : null,
      h('button', { type: 'button', class: 'danger', onclick: logout }, 'ログアウト')));
  }

  async function logout() {
    S.loggingOut = true;
    await api('POST', '/api/logout').catch(() => {});
    location.hash = '';
    location.reload();
  }

  // ---------------------------------------------------------------------------
  // realtime
  // ---------------------------------------------------------------------------

  function connectWs() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    S.ws = ws;
    ws.addEventListener('open', () => {
      $('#connection').hidden = true;
      if (S.wsRetries > 0) resync();
      S.wsRetries = 0;
    });
    ws.addEventListener('message', (e) => {
      try {
        handleEvent(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    });
    ws.addEventListener('close', (e) => {
      if (S.ws === ws) S.ws = null;
      if (S.loggingOut || e.code === 4001) return;
      $('#connection').hidden = false;
      S.wsRetries += 1;
      // A failed upgrade may mean the session expired; the API call reloads to the login screen on 401.
      if (S.wsRetries % 3 === 0) api('GET', '/api/bootstrap').catch(() => {});
      setTimeout(connectWs, Math.min(1000 * 2 ** S.wsRetries, 15000));
    });
  }

  async function resync() {
    try {
      const data = await api('GET', '/api/bootstrap');
      applyBootstrap(data);
      const cid = S.current;
      S.messages.clear();
      if (cid) {
        await loadMessages(cid);
        renderHeader();
        renderMessages();
      }
      if (S.panel?.type === 'thread') openThread(S.panel.parentId);
      renderSidebar();
    } catch (err) {
      console.error(err);
    }
  }

  function upsertMessage(m) {
    const entry = S.messages.get(m.channelId);
    if (entry) {
      const i = entry.list.findIndex((x) => x.id === m.id);
      if (i >= 0) entry.list[i] = m;
    }
    const p = S.panel;
    if (p?.type === 'thread') {
      if (p.parent.id === m.id) p.parent = m;
      const i = p.replies.findIndex((x) => x.id === m.id);
      if (i >= 0) p.replies[i] = m;
    } else if (p?.type === 'search') {
      const i = p.results.findIndex((x) => x.id === m.id);
      if (i >= 0) p.results[i] = m;
    }
  }

  function rerender() {
    renderMessages();
    renderPanel();
  }

  function onNewMessage(m) {
    const c = S.channels.get(m.channelId);
    const mine = m.userId === S.me.id;
    setTyping(m.channelId, m.parentId, m.userId, false);

    let isNew = true;
    if (!m.parentId) {
      const entry = S.messages.get(m.channelId);
      if (entry?.list.some((x) => x.id === m.id)) isNew = false;
      else if (entry?.atLatest) entry.list.push(m);
    }
    const p = S.panel;
    if (p?.type === 'thread' && p.parentId === m.parentId) {
      if (p.replies.some((x) => x.id === m.id)) isNew = false;
      else p.replies.push(m);
    }
    if (!c) return;
    if (m.id > (c.latestId || 0)) c.latestId = m.id;
    if (mine) c.lastReadId = Math.max(c.lastReadId || 0, m.id);

    if (isNew && c.isMember && !mine && m.kind === 'message') {
      const mentioned = m.mentionIds.includes(S.me.id);
      if (isViewing(c.id)) {
        c.unread += m.parentId ? 0 : 1;
        markRead(c);
      } else {
        if (!m.parentId) c.unread += 1;
        if (mentioned) c.mentions += 1;
      }
      if ((mentioned || c.isDm) && (document.visibilityState !== 'visible' || S.current !== c.id)) notify(m, c);
    }

    if (m.channelId === S.current) renderMessages(mine ? { toBottom: !m.parentId } : {});
    if (p?.type === 'thread' && p.parentId === m.parentId) renderPanel({ toBottom: mine });
    renderSidebar();
  }

  function notify(m, c) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const title = c.isDm ? user(m.userId).displayName : `${user(m.userId).displayName}（#${c.name}）`;
    const n = new Notification(title, { body: m.body || (m.file ? `📎 ${m.file.name}` : ''), tag: `msg-${m.id}`, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      jumpToMessage(m);
      n.close();
    };
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'hello': {
        const online = new Set(ev.onlineIds);
        for (const u of S.users.values()) u.online = online.has(u.id);
        renderSidebar();
        break;
      }
      case 'message.new':
        onNewMessage(ev.message);
        break;
      case 'message.updated':
        upsertMessage(ev.message);
        if (ev.message.channelId === S.current || S.panel) rerender();
        break;
      case 'message.deleted': {
        const entry = S.messages.get(ev.channelId);
        if (entry) entry.list = entry.list.filter((x) => x.id !== ev.messageId);
        const p = S.panel;
        if (p?.type === 'thread') {
          if (p.parentId === ev.messageId) closePanel();
          else p.replies = p.replies.filter((x) => x.id !== ev.messageId);
        } else if (p?.type === 'search') {
          p.results = p.results.filter((x) => x.id !== ev.messageId);
        }
        if (S.editing?.id === ev.messageId) S.editing = null;
        if (ev.channelId === S.current || S.panel) rerender();
        break;
      }
      case 'channel.joined': {
        S.channels.set(ev.channel.id, ev.channel);
        if (ev.channel.id === S.current) {
          renderHeader();
          renderComposerArea();
          renderMessages();
        }
        renderSidebar();
        break;
      }
      case 'channel.left': {
        const c = S.channels.get(ev.channelId);
        if (c?.isPrivate) S.channels.delete(ev.channelId);
        else if (c) Object.assign(c, { isMember: false, unread: 0, mentions: 0 });
        if (S.panel?.channelId === ev.channelId) closePanel();
        if (S.current === ev.channelId) {
          S.current = null;
          openChannel(defaultChannelId());
        }
        renderSidebar();
        break;
      }
      case 'channel.updated': {
        const c = S.channels.get(ev.channel.id);
        if (!c) break;
        Object.assign(c, { name: ev.channel.name, topic: ev.channel.topic, memberIds: ev.channel.memberIds });
        if (c.id === S.current) renderHeader();
        renderSidebar();
        break;
      }
      case 'channel.read': {
        const c = S.channels.get(ev.channelId);
        if (!c) break;
        Object.assign(c, { lastReadId: ev.lastReadId, unread: ev.unread, mentions: ev.mentions });
        renderSidebar();
        break;
      }
      case 'user.joined':
      case 'user.updated': {
        const prev = S.users.get(ev.user.id);
        S.users.set(ev.user.id, { ...ev.user, online: prev?.online ?? ev.user.online });
        if (ev.user.id === S.me.id) S.me = { ...S.me, ...ev.user };
        renderSidebar();
        renderHeader();
        if (S.current) renderMessages();
        renderPanel();
        break;
      }
      case 'presence': {
        const u = S.users.get(ev.userId);
        if (u) u.online = ev.online;
        renderSidebar();
        break;
      }
      case 'typing':
        if (ev.userId !== S.me.id) setTyping(ev.channelId, ev.parentId, ev.userId, true);
        break;
      default:
    }
  }

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------

  function applyBootstrap(data) {
    S.workspace = data.workspaceName;
    S.me = data.me;
    S.users = new Map(data.users.map((u) => [u.id, u]));
    const previews = [...S.channels.values()].filter((c) => !c.isMember);
    S.channels = new Map(data.channels.map((c) => [c.id, c]));
    for (const c of previews) if (!S.channels.has(c.id)) S.channels.set(c.id, c);
  }

  async function startApp() {
    const data = await api('GET', '/api/bootstrap');
    applyBootstrap(data);
    $('#auth').hidden = true;
    $('#app').hidden = false;
    document.querySelectorAll('[data-workspace]').forEach((el) => { el.textContent = S.workspace; });
    renderSidebar();
    connectWs();
    const fromHash = Number((/^#\/c\/(\d+)$/.exec(location.hash) || [])[1]);
    openChannel(fromHash || defaultChannelId());
  }

  function bindAppEvents() {
    $('#messages').addEventListener('scroll', () => {
      updateStick();
      if ($('#messages').scrollTop < 200) loadOlder();
    });
    $('#jump-latest').addEventListener('click', async () => {
      const cid = S.current;
      await loadMessages(cid);
      renderMessages({ toBottom: true });
    });
    $('#new-channel').addEventListener('click', newChannelModal);
    $('#browse-channels').addEventListener('click', browseChannelsModal);
    $('#new-dm').addEventListener('click', newDmModal);
    $('#members-btn').addEventListener('click', membersModal);
    $('#channel-topic').addEventListener('click', topicModal);
    $('#me-btn').addEventListener('click', (e) => meMenu(e.currentTarget));
    $('#panel-close').addEventListener('click', closePanel);
    $('#sidebar-toggle').addEventListener('click', () => $('#app').classList.toggle('sidebar-open'));
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      search($('#search-input').value);
    });
    $('#modal').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeModal(); });
    $('#modal').querySelector('[data-close]').addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#popover').hidden) closePopover();
        else if (!$('#modal').hidden) closeModal();
        else if (document.querySelector('.lightbox')) document.querySelector('.lightbox').remove();
        else if (S.panel && !S.editing) closePanel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#search-input').focus();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markRead(S.channels.get(S.current));
    });
    window.addEventListener('hashchange', () => {
      const id = Number((/^#\/c\/(\d+)$/.exec(location.hash) || [])[1]);
      if (id && id !== S.current) openChannel(id);
    });
    // Browsers only allow the permission prompt after a user gesture.
    document.addEventListener('click', () => {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    }, { once: true });
  }

  function bindAuth(config) {
    let mode = 'login';
    const form = $('#auth-form');
    const setMode = (m) => {
      mode = m;
      document.querySelectorAll('[data-auth-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.authTab === m)));
      document.querySelectorAll('[data-signup-only]').forEach((el) => { el.hidden = m !== 'signup' || (el.hasAttribute('data-invite') && !config.inviteRequired); });
      form.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
      $('#auth-submit').textContent = m === 'signup' ? 'アカウントを作成' : 'ログイン';
      $('#auth-error').textContent = '';
    };
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.authTab)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      $('#auth-submit').disabled = true;
      try {
        await api('POST', mode === 'signup' ? '/api/signup' : '/api/login', fd);
        await startApp();
      } catch (err) {
        $('#auth-error').textContent = err.message;
      } finally {
        $('#auth-submit').disabled = false;
      }
    });
    setMode('login');
  }

  async function init() {
    const config = await api('GET', '/api/config').catch(() => ({ workspaceName: 'チャット', inviteRequired: false }));
    document.querySelectorAll('[data-workspace]').forEach((el) => { el.textContent = config.workspaceName; });
    document.title = config.workspaceName;
    bindAuth(config);
    bindAppEvents();
    try {
      await startApp();
    } catch (err) {
      if (err.status !== 401) console.error(err);
      $('#auth').hidden = false;
      $('#auth-form').username.focus();
    }
  }

  init();
})();
