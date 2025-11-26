const SPLASH_TIMEOUT = 3000; // 3 segundos

function hideSplash() {
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  if (!splash || !app) return;
  splash.classList.add('hidden');
  setTimeout(() => {
    splash.style.display = 'none';
    app.classList.add('visible');
    app.setAttribute('aria-hidden', 'false');
  }, 1000); 
}


window.addEventListener('load', () => {
  const timer = setTimeout(hideSplash, SPLASH_TIMEOUT);

  const splash = document.getElementById('splash');
  if (splash) {
    splash.addEventListener('click', () => {
      clearTimeout(timer);
      hideSplash();
    });
  }
});
