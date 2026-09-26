(() => {
  document.documentElement.classList.add('js');

  // Official LINE add-friend URL — replace with the real one (e.g. https://lin.ee/xxxxxxx)
  const LINE_URL = '';
  if (LINE_URL) {
    document.querySelectorAll('[data-line-url]').forEach((a) => {
      a.href = LINE_URL;
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  // Header background + floating CTA on scroll
  const header = document.querySelector('.header');
  const floatCta = document.getElementById('floatCta');
  const reserve = document.getElementById('reserve');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    const reserveTop = reserve.getBoundingClientRect().top;
    floatCta.classList.toggle('is-visible', y > window.innerHeight * 0.8 && reserveTop > window.innerHeight);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile nav
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('nav');
  const setNav = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    document.body.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setNav(!nav.classList.contains('is-open')));
  nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setNav(false)));

  // Facial / Body tabs
  const tabs = document.querySelectorAll('.tabs__btn');
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

  // Scroll reveal
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-in'));
  }
})();
