/* Cross-origin isolation – what lets featureCounts, Salmon and PLINK 2 work on several threads (see isolation-sw.js).
   Where the server sends the headers itself (serve.py), the page is isolated from the start. Elsewhere (GitHub Pages)
   the service worker isolation-sw.js adds them: the first time the workbench is opened, the worker is installed and the
   page is loaded once more, at once – before anything has been done in it. It is not loaded again and again: if the
   page is still not isolated after that, it stays as it is (and featureCounts, Salmon and PLINK 2 say why they cannot run).

   window.WB_ISOLATION = { isolated, reason } – reason, when the page is not isolated: 'insecure' (not https, nor
   localhost), 'no-service-worker' (the browser has none here: a private window in some browsers), 'off' (opened with
   ?isolation=off: the service worker is removed), 'not-yet' (installed now: the page is about to load again),
   'no-effect' (installed, but the page is still not isolated), or the error of the registration.
   This file is the first script of the page. */
(function () {
  'use strict';
  const KEY = 'wb-isolation-reload';
  const state = window.WB_ISOLATION = { isolated: !!window.crossOriginIsolated, reason: '' };
  const sw = navigator.serviceWorker;
  const mine = (r) => /\/isolation-sw\.js$/.test(((r.active || r.waiting || r.installing) || {}).scriptURL || '');
  // (how often the page was loaded again for this: without the browser's session storage it is not loaded again at
  // all – nothing could stop it from being loaded again and again)
  let tries = 1;
  try { tries = +sessionStorage.getItem(KEY) || 0; if (state.isolated) sessionStorage.removeItem(KEY); } catch (e) { /* (stays 1) */ }
  if (!window.isSecureContext) { state.reason = 'insecure'; return; }
  if (!sw) { state.reason = 'no-service-worker'; return; }
  if (/[?&]isolation=off(&|#|$)/.test(location.search)) {
    state.reason = 'off';
    sw.getRegistrations().then((rs) => rs.filter(mine).forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  // (also where the server isolates the page: the worker lets pictures of other sites through – see isolation-sw.js)
  const registered = sw.register('isolation-sw.js');
  if (state.isolated) { registered.catch(() => {}); return; }
  state.reason = 'not-yet';
  const reload = () => {
    if (tries >= 1) { state.reason = 'no-effect'; return; }
    try { sessionStorage.setItem(KEY, String(tries + 1)); } catch (e) { state.reason = 'no-effect'; return; }
    location.reload();
  };
  registered.then(() => {
    if (sw.controller) reload();
    else sw.addEventListener('controllerchange', reload, { once: true });
  }).catch((e) => { state.reason = 'error: ' + ((e && e.message) || e); });
})();
