(() => {
  document.documentElement.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  /* ===== HERO: crowd that gathers around the pointer ===== */
  const cv = document.getElementById('crowd');
  const ctx = cv.getContext('2d');
  const out = document.getElementById('pulled');
  const hint = document.getElementById('hint');
  let W = 0, H = 0, P = [], auto = 0, lastMove = 0, shown = 0, heroVisible = true;
  const ptr = { x: 0, y: 0, active: false };

  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(1000, Math.max(380, W * H / 900)));
    P = [];
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      P.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, r: Math.random() * 1.3 + .6, ph: Math.random() * 6.28 });
    }
  }
  function setPtr(x, y) {
    ptr.x = x; ptr.y = y; ptr.active = true;
    lastMove = performance.now();
    hint.classList.add('gone');
  }
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    setPtr(e.clientX - r.left, e.clientY - r.top);
  });
  cv.addEventListener('pointerleave', () => { ptr.active = false; });

  function frame(t) {
    requestAnimationFrame(frame);
    if (!heroVisible) return;
    const idle = t - lastMove > 2500;
    let ax, ay;
    if (!ptr.active || idle) {
      auto += 0.004;
      ax = W * (.5 + .2 * Math.sin(auto * 1.3));
      ay = H * (.3 + .1 * Math.sin(auto * 2.1));
    } else { ax = ptr.x; ay = ptr.y; }

    ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * .28, R2 = R * R;
    let c = 0;
    for (const p of P) {
      const dx = ax - p.x, dy = ay - p.y, d2 = dx * dx + dy * dy;
      const near = d2 < R2;
      if (near) {
        const f = (1 - d2 / R2) * .06;
        p.vx += dx * f * .05; p.vy += dy * f * .05; c++;
        if (d2 < 900) { p.vx -= dx * .004; p.vy -= dy * .004; }
      } else {
        p.vx += (p.hx - p.x) * .0009; p.vy += (p.hy - p.y) * .0009;
      }
      p.ph += .02;
      p.vx += Math.cos(p.ph) * .02; p.vy += Math.sin(p.ph) * .02;
      p.vx *= .92; p.vy *= .92;
      p.x += p.vx; p.y += p.vy;
      const k = near ? 1 - d2 / R2 : 0;
      ctx.fillStyle = near
        ? `rgba(${140 + Math.round(60 * k)},${110 + Math.round(110 * k)},255,${.45 + .55 * k})`
        : 'rgba(126,162,255,.3)';
      ctx.beginPath(); ctx.arc(p.x, p.y, near ? p.r + .4 : p.r, 0, 6.283); ctx.fill();
    }
    // "the one" at the centre of attention
    const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, 60);
    g.addColorStop(0, 'rgba(220,235,255,.95)');
    g.addColorStop(.15, 'rgba(123,47,255,.45)');
    g.addColorStop(1, 'rgba(47,123,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax, ay, 60, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(155,92,255,.95)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ax, ay, 14 + 3 * Math.sin(t / 300), 0, 6.283); ctx.stroke();

    shown += (c - shown) * .08;
    out.textContent = Math.round(shown);
  }
  function still() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(150,140,230,.35)';
    for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }
  }
  size();
  addEventListener('resize', () => { size(); if (reduce) still(); });
  if (reduce) { still(); hint.classList.add('gone'); }
  else {
    if (hasIO) new IntersectionObserver(es => { heroVisible = es[0].isIntersecting; }).observe(cv);
    requestAnimationFrame(frame);
  }

  /* ===== Header becomes solid after the hero ===== */
  const top = document.querySelector('.top');
  const onScroll = () => top.classList.toggle('solid', scrollY > 80);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ===== Scroll reveal ===== */
  const reveals = document.querySelectorAll('.reveal');
  if (hasIO && !reduce) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .15, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => io.observe(el));
  } else reveals.forEach(el => el.classList.add('in'));

  /* ===== Transmission typing ===== */
  const body = document.getElementById('termBody');
  if (!reduce && hasIO) {
    const lines = [...body.children].map(el => ({ el, html: el.innerHTML }));
    let started = false;
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting && !started) { started = true; io.disconnect(); type(); }
    }, { threshold: .4 });
    function type() {
      lines.forEach(l => { l.el.innerHTML = ''; l.el.style.minHeight = '1.5em'; });
      let i = 0;
      const caret = document.createElement('span'); caret.className = 'caret';
      (function next() {
        if (i >= lines.length) { lines[lines.length - 1].el.appendChild(caret); return; }
        const { el, html } = lines[i];
        const parts = html.split(/(<br>)/);
        let k = 0, seg = 0, buf = '';
        el.appendChild(caret);
        (function ch() {
          if (seg >= parts.length) { i++; setTimeout(next, i === 1 ? 300 : 520); return; }
          const s = parts[seg];
          if (s === '<br>') { buf += '<br>'; seg++; ch(); return; }
          if (k < s.length) {
            buf += s[k++]; el.innerHTML = buf; el.appendChild(caret);
            setTimeout(ch, el.classList.contains('from') ? 18 : 58);
          } else { seg++; k = 0; ch(); }
        })();
      })();
    }
    io.observe(document.getElementById('term'));
  }

  /* ===== Screening quiz ===== */
  const Q = [
    ['知らない人ばかりの場所。<br>君は、自分から話しかけるか？', '話しかける', '様子を見る'],
    ['友人の誘いより、<br>自分が声をかけて人を集めたことがある。', 'ある', 'ない'],
    ['「変わりたい」と思ったまま、<br>1年以上が過ぎている。', 'YES', 'NO'],
  ];
  const QUALIFIED = ['QUALIFIED', '素質はある。あとは磨くだけだ。', '動ける漢は、勝ち方を知った瞬間に化ける。何を磨くかは面談で伝える。'];
  const RESULTS = [
    ['POTENTIAL DETECTED', 'まだ眠っているだけだ。', '自分から動けないのは、やり方を知らないだけ。Xが最初の一歩を渡す。'],
    QUALIFIED,
    QUALIFIED,
    ['PRINCE CANDIDATE', '君を待っていた。', 'すでに人を動かせる側の漢だ。だからこそ、頂点を取る方法を聞きに来い。'],
  ];
  const box = document.getElementById('quizBox');
  let step = 0, score = 0;
  const bars = () => `<div class="bars">${Q.map((_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('')}</div>`;
  function render() {
    if (step < Q.length) {
      const [q, a, b] = Q[step];
      box.innerHTML = `<div class="quiz-top mono"><span>Q.${String(step + 1).padStart(2, '0')} / 03</span>${bars()}</div>
        <div class="quiz-q"><h3>${q}</h3><div class="quiz-a">
        <button type="button" data-v="1"><span>A</span>${a}</button>
        <button type="button" data-v="0"><span>B</span>${b}</button></div></div>`;
      box.querySelectorAll('button').forEach(bt => bt.onclick = () => { score += +bt.dataset.v; step++; render(); });
    } else {
      const [stamp, title, text] = RESULTS[score];
      box.innerHTML = `<div class="quiz-top mono"><span>RESULT</span>${bars()}</div>
        <div class="quiz-q verdict"><span class="stamp">${stamp}</span><h3>${title}</h3><p>${text}</p>
        <div class="row"><a class="btn btn-gold" href="#join">面談で話を聞く</a><button type="button" class="link-btn mono" id="qa-retry">もう一度</button></div></div>`;
      document.getElementById('qa-retry').onclick = () => { step = 0; score = 0; render(); };
    }
  }
  render();

  /* ===== Countdown to 1/23 00:00 JST ===== */
  const now0 = new Date();
  const y = now0.getUTCFullYear();
  let target = Date.UTC(y, 0, 22, 15, 0, 0);
  if (target < now0) target = Date.UTC(y + 1, 0, 22, 15, 0, 0);
  const el = k => document.getElementById('cd-' + k);
  const pad = n => String(n).padStart(2, '0');
  function tick() {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    el('d').textContent = Math.floor(s / 86400); s %= 86400;
    el('h').textContent = pad(Math.floor(s / 3600)); s %= 3600;
    el('m').textContent = pad(Math.floor(s / 60));
    el('s').textContent = pad(s % 60);
  }
  tick(); setInterval(tick, 1000);

  /* ===== Floating CTA hides at the final section ===== */
  const fl = document.getElementById('float');
  if (hasIO) new IntersectionObserver(es => fl.classList.toggle('hide', es[0].isIntersecting), { threshold: .2 })
    .observe(document.getElementById('join'));
})();
