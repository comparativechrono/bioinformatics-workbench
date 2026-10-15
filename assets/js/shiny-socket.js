/* In the frame of a Shiny app (see shiny.js): the app's websocket goes to the workbench page through a MessagePort –
   there is no web server to connect to. The service worker (isolation-sw.js) puts this script into the app's first
   page, after Shiny's own scripts. (After Shinylive's shinylive-inject-socket.ts and messageportwebsocket.ts – Posit,
   MIT licence – written again for the workbench.) */
(function () {
  'use strict';
  class PortSocket extends EventTarget {
    constructor(port) {
      super();
      this.readyState = 0; // CONNECTING
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
      for (const t of ['open', 'message', 'error', 'close'])
        this.addEventListener(t, (e) => {
          if (typeof this['on' + t] === 'function') this['on' + t](e);
        });
      this._port = port;
      port.onmessage = (e) => this._got(e.data || {});
    }
    _got(m) {
      if (m.type === 'open' && this.readyState === 0) {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      } else if (m.type === 'message' && this.readyState === 1) {
        this.dispatchEvent(new MessageEvent('message', { data: m.value && m.value.data }));
      } else if (m.type === 'close' && this.readyState < 3) {
        this.readyState = 3;
        const v = m.value || {};
        this.dispatchEvent(new CloseEvent('close', { code: v.code || 1000, reason: v.reason || '' }));
      }
    }
    send(data) {
      if (this.readyState === 0) throw new DOMException("Can't send messages while WebSocket is in CONNECTING state", 'InvalidStateError');
      if (this.readyState === 1) this._port.postMessage({ type: 'message', value: { data } });
    }
    close(code, reason) {
      if (this.readyState > 1) return;
      this.readyState = 3;
      this._port.postMessage({ type: 'close', value: { code: code || 1000, reason: reason || '' } });
      this.dispatchEvent(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
    }
  }
  window.Shiny = window.Shiny || {};
  window.Shiny.createSocket = function () {
    const ch = new MessageChannel();
    const appName = (/\/(app_[^/]+)\/[^/]*$/.exec(location.pathname) || [])[1] || '';
    // (the page of the workbench: the frame's parent – or, for an app opened in a window of its own, its opener)
    const page = window.parent !== window ? window.parent : window.opener;
    if (page) page.postMessage({ type: 'openChannel', appName, path: '/websocket/' }, location.origin, [ch.port2]);
    return new PortSocket(ch.port1);
  };
})();
