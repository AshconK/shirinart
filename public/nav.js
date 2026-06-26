// Active nav link
const path = window.location.pathname;
document.querySelectorAll('.nav__links a').forEach(link => {
  const href = link.getAttribute('href');
  if (href === path || (href === '/' && path === '/') || (href !== '/' && path === href)) {
    link.classList.add('is-active');
  }
});

// Hamburger toggle
const hamburger = document.getElementById('hamburger');
const navLinks = document.querySelector('.nav__links');
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('is-open');
    hamburger.setAttribute('aria-expanded', String(open));
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      navLinks.classList.remove('is-open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
}

// Footer year
document.querySelectorAll('.footer-year').forEach(el => {
  el.textContent = new Date().getFullYear();
});
