/* =====================================================================
   Shiny apps, run from R in the page: RStudio's Run App (and runApp()
   in the R console) show the app in the Viewer (in a window).

   On a computer, runApp() starts a web server in R and waits for the
   browser's requests. Here the app's frame asks the site's service
   worker (isolation-sw.js) for the pages below app_<name>/, the service
   worker hands each request to this page, and this page asks R – the
   R that runs the app – for the answer (rsession.js: wb$shiny_http,
   wb$shiny_ws_*, wb$shiny_tick). The app's websocket goes through a
   MessagePort of the frame (shiny-socket.js). While the app runs, R's
   console is busy, as in RStudio: Stop (or Esc) stops the app.

   The way the requests reach R is that of Shinylive (Posit, MIT
   licence: shinylive-sw.ts, messageporthttp.ts, messageportwebsocket.ts)
   – written again here for the workbench's R sessions.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { bus, toast } = MG;
  const rstr = (s) => MG.R.rstr(s);
  const WB = 'get("wb", envir = as.environment("tools:workbench"))';
  const NOCAP = { captureStreams: false, captureConditions: false };

  const apps = new Map(); // name → app
  const conns = new Map(); // connection id → {app, sock}
  let connSeq = 0;

  /** base64 ⇄ bytes */
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64 || '');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /** the server's end of an app's websocket: messages to and from the frame's MessagePort */
  class ServerSocket {
    constructor(port) {
      this.port = port;
      this.open = false;
      this.onmessage = null;
      this.onclose = null;
      port.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'message' && this.onmessage) this.onmessage(m.value && m.value.data);
        else if (m.type === 'close') this._closed();
      };
    }
    accept() {
      if (this.open) return;
      this.open = true;
      this.port.postMessage({ type: 'open' });
    }
    send(data) {
      if (this.open) this.port.postMessage({ type: 'message', value: { data } });
    }
    close(code, reason) {
      if (!this.open) return;
      this.port.postMessage({ type: 'close', value: { code: code || 1000, reason: reason || '' } });
      this._closed();
    }
    _closed() {
      if (this.done) return;
      this.done = true;
      this.open = false;
      if (this.onclose) this.onclose();
      try {
        this.port.close();
      } catch (e) {
        /* closed */
      }
    }
  }

  class ShinyApp {
    constructor(S, info, host) {
      this.S = S;
      this.name = info.app;
      this.title = info.title || 'Shiny';
      this.port = info.port;
      this.host = host;
      this.cache = new Map();
      this.running = true;
    }
    get url() {
      return new URL(this.name + '/', location.href).href;
    }
    /** R answers: one call at a time, while it waits at its prompt (the console is held while an app runs) */
    _r(code, type) {
      return this.S.whenIdle((W) => (type ? W.evalRRaw(code, type, NOCAP) : W.evalRVoid(code, NOCAP)));
    }
    async start() {
      const sw = navigator.serviceWorker;
      if (!sw || !sw.controller) {
        this.running = false;
        await this._r(`${WB}$shiny_stop(${rstr(this.name)})`).catch(() => {});
        this.host.failed(sw ? 'The page is not yet controlled by its service worker, which Shiny apps need. Please reload the page once, then run the app again.' : "Shiny apps can't be shown, because service workers are not available in this browser here (perhaps because this is a private window).");
        return;
      }
      // the service worker passes the requests of the app's frame to this page
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'makeRequest' && e.ports[0]) this._request(m, e.ports[0]);
      };
      this.channel = ch;
      sw.controller.postMessage({ type: 'configureProxyPath', path: this.name + '/' }, [ch.port2]);
      this.tick = setInterval(() => this._tick(), 100);
      this.host.show(this);
      bus.emit('shiny:start', { app: this.name, title: this.title });
    }
    /** a service worker that was stopped and started again has forgotten the app: it is told again */
    reregister() {
      const sw = navigator.serviceWorker;
      if (!this.running || !sw || !sw.controller) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = this.channel.port1.onmessage;
      this.channel = ch;
      sw.controller.postMessage({ type: 'configureProxyPath', path: this.name + '/' }, [ch.port2]);
    }
    async _request(m, reply) {
      const key = m.method === 'GET' ? m.path + '?' + (m.query || '') : null;
      const cached = key && this.cache.get(key);
      if (cached) return reply.postMessage(cached);
      let out;
      try {
        const body = m.body && m.body.byteLength ? toB64(new Uint8Array(m.body)) : '';
        const json = await this._r(`${WB}$shiny_http(${rstr(this.name)}, ${rstr(m.path)}, ${rstr(m.method)}, ${rstr(m.query || '')}, ${rstr(body)})`, 'string');
        if (json == null) throw new Error('R is busy');
        const r = JSON.parse(json);
        out = { status: r.status || 200, headers: r.headers || {}, body: fromB64(r.body) };
      } catch (e) {
        out = { status: 500, headers: { 'Content-Type': 'text/plain; charset=UTF-8' }, body: new TextEncoder().encode('The app could not respond to this request: ' + ((e && e.message) || e)) };
      }
      // (shiny's own files – its JavaScript, styles, fonts – are the same every time: kept for the app's next page)
      if (key && out.status === 200 && /^\/[^/]+-\d[\w.]*\//.test(m.path)) this.cache.set(key, out);
      reply.postMessage(out);
    }
    async _tick() {
      if (this.ticking || !this.running) return;
      this.ticking = true;
      try {
        const r = await this._r(`${WB}$shiny_tick()`, 'string');
        if (r === 'stopped') this.stop();
      } catch (e) {
        /* (an error of the app: R has printed it) */
      } finally {
        this.ticking = false;
      }
    }
    /** the app's frame opens its websocket */
    async openSocket(port) {
      const id = 'c' + ++connSeq;
      const sock = new ServerSocket(port);
      conns.set(id, { app: this, sock });
      let ok = false;
      try {
        ok = await this._r(`${WB}$shiny_ws_open(${rstr(this.name)}, ${rstr(id)})`, 'boolean');
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        sock.close(1011, 'The app is not running.');
        conns.delete(id);
        return;
      }
      sock.accept();
      sock.onmessage = (text) => {
        if (typeof text === 'string') this._r(`${WB}$shiny_ws_msg(${rstr(id)}, ${rstr(text)})`).catch(() => {});
      };
      sock.onclose = () => {
        conns.delete(id);
        if (this.running) this._r(`${WB}$shiny_ws_close(${rstr(id)})`).catch(() => {});
      };
    }
    async stop(quiet) {
      if (!this.running) return;
      this.running = false;
      clearInterval(this.tick);
      for (const [id, c] of conns) if (c.app === this) (c.sock.close(1001, 'The app was stopped.'), conns.delete(id));
      const sw = navigator.serviceWorker;
      if (sw && sw.controller) sw.controller.postMessage({ type: 'removeProxyPath', path: this.name + '/' });
      apps.delete(this.name);
      if (!this.S.closed) await this._r(`${WB}$shiny_stop(${rstr(this.name)})`).catch(() => {});
      this.host.stopped(this, quiet);
      bus.emit('shiny:stop', { app: this.name });
    }
  }

  /* messages of the frames (shiny-socket.js) and of the service worker */
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (e.origin !== location.origin || m.type !== 'openChannel' || !e.ports[0]) return;
    const app = apps.get(m.appName);
    if (app && app.running) app.openSocket(e.ports[0]);
  });
  if (navigator.serviceWorker)
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'serviceworkerStart') for (const a of apps.values()) a.reregister();
    });
  // (what R sends the app's websocket: wb$send("ws", …) – see rsession.js)
  function wsEvent(d) {
    const c = conns.get(d.conn);
    if (!c) return;
    if (d.type === 'send') c.sock.send(d.msg);
    else if (d.type === 'close') {
      c.sock.close(1000, '');
      conns.delete(d.conn);
    }
  }
  const watched = new WeakSet();

  MG.Shiny = {
    /** an app that R started (the 'shiny' event of its session): shown by host – {show(app), stopped(app, quiet), failed(msg)} */
    async start(S, d, host) {
      if (!watched.has(S)) {
        watched.add(S);
        S.on('event', (x) => x.event === 'ws' && wsEvent(x));
        S.on('ended', () => {
          for (const a of Array.from(apps.values())) if (a.S === S) a.stop(true);
        });
      }
      // (one app at a time in a session, as runApp() runs one)
      for (const a of Array.from(apps.values())) if (a.S === S) await a.stop(true);
      const app = new ShinyApp(S, d, host);
      apps.set(app.name, app);
      await app.start();
      return app;
    },
    /** the app of a session that runs (or null) */
    running(S) {
      for (const a of apps.values()) if (a.S === S && a.running) return a;
      return null;
    },
    stop(S, quiet) {
      const a = MG.Shiny.running(S);
      return a ? a.stop(quiet) : Promise.resolve();
    }
  };
  void toast;
})();
