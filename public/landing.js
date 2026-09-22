'use strict';
// Native details provide accessible menus and FAQs even if scripting is disabled.
const menu = document.querySelector('.mobile-menu');
menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false; }));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary').focus(); } });

// Illustrative app only: no network calls, wallet access or VPN provisioning.
const concept = document.getElementById('app-concept');
const toggle = document.getElementById('connection-toggle');
if (concept && toggle) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer, started = false, autoTimer;
  function display(state) {
    concept.dataset.state = state;
    toggle.setAttribute('aria-checked', String(state !== 'off'));
    document.getElementById('connection-title').textContent = state === 'on' ? 'You’re connected.' : state === 'connecting' ? 'Finding your connection.' : 'Ready when you are.';
    document.getElementById('connection-description').textContent = state === 'on' ? 'Your day. Your connection.' : state === 'connecting' ? 'Connecting to Sydney…' : 'Choose a location. Make it yours.';
    document.getElementById('connection-status').textContent = state === 'on' ? 'Connected · preview' : state === 'connecting' ? 'Connecting…' : 'Not connected';
  }
  function connect() {
    clearTimeout(timer);
    if (reducedMotion.matches) return display('on');
    display('connecting');
    timer = setTimeout(() => display('on'), 1100);
  }
  toggle.addEventListener('click', () => {
    started = true; clearTimeout(autoTimer); clearTimeout(timer);
    if (concept.dataset.state === 'off') connect(); else display('off');
  });
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !started && !reducedMotion.matches) {
      started = true;
      autoTimer = setTimeout(connect, 1200);
      observer.disconnect();
    }
  }, { threshold: 0.55 });
  observer.observe(concept);
  reducedMotion.addEventListener('change', () => { clearTimeout(autoTimer); clearTimeout(timer); if (concept.dataset.state === 'connecting') display('on'); });
}
