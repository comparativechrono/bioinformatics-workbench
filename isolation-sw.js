/* Cross-origin isolation for the workbench, where the web server cannot send the headers itself (GitHub Pages).

   Three programs of the terminal, featureCounts, Salmon and PLINK 2, work on several threads that share the program's
   memory (SharedArrayBuffer). A browser allows that only in a page that is "cross-origin isolated": the page and its workers
   must come with the headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.
   This service worker adds them to the pages and workers of this site (assets/js/isolation.js registers it). It
   stores nothing and changes no content.

   Under these headers a page may show a file of another site only if that site allows it. Images of other sites
   (structure pictures of the RCSB, pathway diagrams of Reactome) are therefore asked for in the way that lets the
   site allow it (CORS); a site that does not answer such a request gets the request as it was.

   To turn isolation off: open the workbench with ?isolation=off (the service worker is removed). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (r.method !== 'GET') return;
  // (a request the browser makes while checking its cache: fetch() refuses it unless it is same-origin)
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  const url = new URL(r.url);
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
