(() => {
  document.documentElement.classList.add('js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- header / sticky CTA ----------
  const header = document.querySelector('.header');
  const sticky = document.getElementById('stickyCta');
  const finale = document.querySelector('.finale');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    const finaleTop = finale.getBoundingClientRect().top;
    sticky.classList.toggle('is-visible', y > window.innerHeight * 0.9 && finaleTop > window.innerHeight * 0.6);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- overlay nav ----------
  const burger = document.getElementById('burger');
  const overlay = document.getElementById('overlay');
  const setNav = (open) => {
    overlay.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  };
  burger.addEventListener('click', () => setNav(!overlay.classList.contains('is-open')));
  overlay.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setNav(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

  // ---------- statement: split into words that light up on scroll ----------
  const big = document.querySelector('[data-words]');
  const wrapChars = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        [...n.textContent.trim()].forEach((ch) => {
          const s = document.createElement('span');
          s.className = 'w';
          s.textContent = ch;
          frag.appendChild(s);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') {
        wrapChars(n);
      }
    });
  };
  wrapChars(big);
  const chars = big.querySelectorAll('.w');
  const strike = big.querySelector('.strike');
  const lightUp = () => {
    const r = big.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
    const n = Math.round(p * chars.length);
    chars.forEach((c, i) => c.classList.toggle('on', i < n));
    strike.classList.toggle('on', p > 0.45);
  };
  if (reduce) {
    chars.forEach((c) => c.classList.add('on'));
    strike.classList.add('on');
  } else {
    window.addEventListener('scroll', lightUp, { passive: true });
    lightUp();
  }

  // ---------- 12 moons (one per month, current month highlighted) ----------
  const moons = document.getElementById('moons');
  const now = new Date().getMonth();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'moon' + (i === now ? ' is-now' : '');
    // phase: waxing from new moon to full across the year
    const phase = i / 11;
    d.style.setProperty('--shift', `${(1 - phase) * 100}%`);
    d.innerHTML = `<span>${m}</span>`;
    moons.appendChild(d);
  });

  // ---------- menu split (facial / body) ----------
  const tabs = document.querySelectorAll('.split__item');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
        document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
      });
    });
  });

  // ---------- price counter 10000 -> 5000 ----------
  const countEl = document.querySelector('[data-count]');
  const runCount = () => {
    if (reduce) return;
    const from = 10000, to = +countEl.dataset.count, dur = 1600, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      countEl.textContent = Math.round(from + (to - from) * e).toLocaleString('ja-JP');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---------- reveal + one-shot triggers ----------
  const once = (el, fn, margin = '-10%') => {
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { fn(); io.disconnect(); } });
    }, { rootMargin: `0px 0px ${margin} 0px` });
    io.observe(el);
  };
  document.querySelectorAll('.reveal').forEach((el) => once(el, () => el.classList.add('on'), '-8%'));
  once(countEl, runCount);
  const path = document.getElementById('path');
  once(path, () => path.classList.add('on'), '-20%');
  const chat = document.getElementById('chat');
  once(chat, () => chat.classList.add('play'), '-15%');
})();
