/* The workbench's service worker (assets/js/isolation.js registers it). It has two jobs.

   1. Cross-origin isolation, where the web server cannot send the headers itself (GitHub Pages). Three programs of
      the terminal, featureCounts, Salmon and PLINK 2, work on several threads that share the program's memory
      (SharedArrayBuffer), and the R and Python of the IDE tab need the same shared memory to wait for what is typed
      (readline(), input()) and to be interrupted. A browser only allows that in a page that is "cross-origin
      isolated": the page and its workers must come with the headers Cross-Origin-Opener-Policy: same-origin and
      Cross-Origin-Embedder-Policy: require-corp. This service worker adds them to the pages and workers of this site.
      It stores nothing and changes no content.

      Under these headers a page may only show a file from another site if that site allows it. Images from other
      sites (structure pictures from the RCSB, pathway diagrams from Reactome) are therefore requested in the way that
      lets the site allow it (CORS); if a site doesn't answer such a request, the original request is sent instead.

   2. Shiny apps run from RStudio in the IDE tab (assets/js/shiny.js). An app's frame requests the pages below
      .../app_<name>/, but there is no web server to answer them, because the app runs in R inside the page. The page
      gives this worker a MessagePort for each app it runs (configureProxyPath), and each request from the app's frame
      is passed to the page through it (makeRequest); the answer comes back the same way. The app's first page gets one
      extra script, which connects the app's websocket to the page (assets/js/shiny-socket.js). This follows the design
      of Shinylive (Posit, MIT licence: shinylive-sw.ts), written again for the workbench.

   To turn isolation off, open the workbench with ?isolation=off (the service worker is then removed). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* ---------------- Shiny apps ---------------- */
const apps = {}; // 'app_<name>/' → the MessagePort of the page that runs the app
self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'configureProxyPath' && event.ports[0]) apps[m.path] = event.ports[0];
  else if (m.type === 'removeProxyPath') delete apps[m.path];
});
// (a worker that was stopped and started again has forgotten the apps, so the pages tell it again – see shiny.js)
self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ type: 'serviceworkerStart' })));

async function appFetch(r, key, path, url) {
  // (the page may be telling the worker about the app at this very moment)
  for (let i = 0; i < 10 && !apps[key]; i++) await new Promise((ok) => setTimeout(ok, 50));
  const port = apps[key];
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
  if (!port) return new Response('This Shiny app is not running any more. Run it again in RStudio.', { status: 404, headers });
  const body = r.method === 'GET' || r.method === 'HEAD' ? null : await r.arrayBuffer();
  const ch = new MessageChannel();
  const answer = new Promise((ok) => (ch.port1.onmessage = (e) => ok(e.data)));
  port.postMessage({ type: 'makeRequest', method: r.method, path, query: url.search.replace(/^\?/, ''), body }, [ch.port2]);
  const res = await Promise.race([answer, new Promise((ok) => setTimeout(() => ok(null), 120000))]);
  ch.port1.close();
  if (!res) return new Response('The app did not answer.', { status: 504, headers });
  let out = res.body;
  const h = new Headers();
  for (const [k, v] of Object.entries(res.headers || {})) {
    try {
      h.set(k, v);
    } catch (e) {
      /* (a header that cannot be set) */
    }
  }
  // the app's first page gets the script that connects its websocket to the page
  if (path === '/' && /^text\/html/i.test(h.get('Content-Type') || '')) {
    const base = self.location.pathname.replace(/[^/]*$/, '');
    const html = new TextDecoder().decode(out).replace(/<\/head>/i, `<script src="${base}assets/js/shiny-socket.js"></script>\n</head>`);
    out = new TextEncoder().encode(html);
  }
  // (the frame is part of the isolated page, so it needs the headers too; an app opened in a window of its own also
  // needs the opener's policy, to stay in touch with the page that runs it)
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.delete('Content-Length');
  return new Response(r.method === 'HEAD' ? null : out, { status: res.status || 200, headers: h });
}

self.addEventListener('fetch', (event) => {
  const r = event.request;
  const url = new URL(r.url);
  if (url.origin === self.location.origin) {
    const m = /^(.*?\/)(app_[A-Za-z0-9_]+\/)(.*)$/.exec(url.pathname);
    if (m) {
      event.respondWith(appFetch(r, m[2], '/' + m[3], url));
      return;
    }
  }
  if (r.method !== 'GET') return;
  // (a request the browser makes while checking its cache: fetch() refuses it unless it is same-origin)
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  if (url.origin === self.location.origin) {
    // the page itself, the frames and the workers need the headers; scripts, data and the rest of this site do not
    if (r.mode === 'navigate' || r.destination === 'worker' || r.destination === 'sharedworker') {
      event.respondWith(fetch(r).then(isolated).catch(() => fetch(r)));
    }
    return;
  }
  // another site: only what is asked for without CORS (an <img>, a <script> without crossorigin) can be refused
  if (r.mode === 'no-cors' && /^https?:$/.test(url.protocol)) event.respondWith(viaCors(r));
});

function isolated(response) {
  // (a redirect, or a response that cannot be read: as it is – the browser follows a redirect, and asks again)
  if (response.status === 0 || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function viaCors(r) {
  try {
    const response = await fetch(r.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (e) {
    return fetch(r);
  }
}
