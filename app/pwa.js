/**
 * Registers the service worker so the four screens keep loading with no
 * signal. Firestore already caches the data locally; this caches the shell.
 *
 * Registered with a relative URL so the scope follows whatever subpath the app
 * is served from - GitHub Pages puts it under /pastapronto/.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      // A failed registration must never stop the app from working.
      console.warn('[pwa] service worker registration failed:', err.message);
    });
  });
}
