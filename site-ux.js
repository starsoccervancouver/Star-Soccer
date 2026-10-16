(() => {
  const nav = document.querySelector('.site-nav');
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  if (nav) {
    const header = nav.closest('header');
    if (header) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mobile-nav-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      toggle.textContent = 'Menu';
      nav.id = nav.id || 'site-primary-navigation';
      toggle.setAttribute('aria-controls', nav.id);
      nav.before(toggle);
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        nav.classList.toggle('mobile-nav-open', open);
      });
      nav.querySelectorAll('a').forEach(link => { if (link.getAttribute('href') === currentPage) link.setAttribute('aria-current','page'); });
      nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
        nav.classList.remove('mobile-nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }));
      const register = document.createElement('a');
      register.className = 'header-program-cta';
      register.href = 'programs.html';
      register.textContent = 'Find a Program';
      register.setAttribute('aria-label', 'Find a Star Soccer training program');
      nav.appendChild(register);
      document.addEventListener('keydown', event => { if (event.key === 'Escape') { nav.classList.remove('mobile-nav-open'); toggle.setAttribute('aria-expanded','false'); } });
    }
  }
  const footer = document.querySelector('footer.home-contact-footer');
  if (footer && !footer.querySelector('.footer-quick-links')) {
    const links = document.createElement('nav');
    links.className = 'footer-quick-links';
    links.setAttribute('aria-label', 'Footer quick links');
    links.innerHTML = '<a href="programs.html">Programs</a><a href="methodology.html">Methodology</a><a href="locations.html">Training locations</a><a href="contact.html">Contact</a>';
    footer.appendChild(links);
  }
  const filters = document.querySelectorAll('[data-age-filter]');
  if (filters.length) {
    const rows = document.querySelectorAll('.psg-row[data-age-group]');
    filters.forEach(button => button.addEventListener('click', () => {
      const chosen = button.dataset.ageFilter;
      filters.forEach(b => {
        const active = b === button;
        b.classList.toggle('is-selected', active);
        b.setAttribute('aria-pressed', String(active));
      });
      rows.forEach(row => { row.hidden = chosen !== 'all' && row.dataset.ageGroup !== chosen; });
    }));
  }
})();
