/* =====================================================================
   PDF files in the Files tab, drawn by PDF.js (assets/vendor/pdfjs).

   The page draws the PDF itself, on canvases: it does not hand the file to
   the browser's own PDF viewer. That viewer is a plug-in that phones and
   some browsers do not have, that settings and policies can turn off, and
   that can fail inside a frame of this page ("Failed to load PDF
   document"). Here the pages are drawn as they come into view, the text of
   each page lies over it (it can be selected, copied, and found with the
   browser's Find), and links work.

   MG.pdfView(host, bytes, { name, state }) → a viewer in host:
     .state()    { zoom, page } – to open the same file again where it was
     .destroy()  stops drawing and frees the document (and its worker)
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc } = MG;
  const BASE = 'assets/vendor/pdfjs/';
  const abs = (p) => new URL(p, location.href).href;
  const PX = 96 / 72; // CSS pixels per point of the PDF: zoom 100 % is the size the PDF gives its pages
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const MAX_PIXELS = 2896 * 2896; // the largest canvas of one page, 32 MB (sharpness gives way first)
  const KEEP = 24, KEEP_PIXELS = 64e6; // pages kept drawn – 256 MB of canvas at most; the ones furthest from view go
  const GAP = 12; // between pages (pipe.css: .pdfv-page)
  const PAD = 16; // on each side of the pages (pipe.css: .pdfv-pages)

  let SBW = null;
  /** the width of a scroll bar in this browser (0 where scroll bars lie over the content) */
  function scrollbarWidth() {
    if (SBW == null) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:-9999px;left:0;width:100px;height:100px;overflow:scroll';
      document.body.appendChild(d);
      SBW = Math.max(0, d.offsetWidth - d.clientWidth);
      d.remove();
    }
    return SBW;
  }
  /** a canvas let go of: its memory is freed at once (Safari counts the memory of canvases until they are collected) */
  const freeCanvas = (c) => {
    if (c) c.width = c.height = 0;
  };

  let lib = null;
  /** PDF.js, loaded the first time a PDF is shown */
  function load() {
    if (!lib) {
      lib = import(abs(BASE + 'pdf.min.mjs')).then((m) => {
        m.GlobalWorkerOptions.workerSrc = abs(BASE + 'pdf.worker.min.mjs');
        return m;
      });
      lib.catch(() => {
        lib = null;
      });
    }
    return lib;
  }

  class PdfView {
    constructor(host, bytes, opts = {}) {
      this.opts = opts;
      this.name = opts.name || 'document.pdf';
      const st = opts.state || {};
      this.zoom = st.zoom || 'fit'; // 'fit' (the width of the pane) or a zoom: 1 = 100 %
      this.startPage = st.page || 1;
      this.lastPage = this.startPage; // (the page at the top, as last seen: while the pane is hidden nothing can be measured)
      this.pages = [];
      this.textDivs = new Set();
      this.dead = false;
      this.el = h('div.pdfv');
      this.bar = h('div.pdfv-bar', { role: 'toolbar', 'aria-label': 'PDF' });
      this.scroll = h('div.pdfv-scroll', { tabindex: '0', 'aria-label': this.name });
      this.list = h('div.pdfv-pages');
      this.msg = h('div.pdfv-msg', 'Opening the PDF…');
      this.list.appendChild(this.msg);
      this.scroll.appendChild(this.list);
      this.el.append(this.bar, this.scroll);
      host.appendChild(this.el);
      this.ready = this._open(bytes).catch((e) => this._failed(e));
    }

    /* ---------------- opening ---------------- */
    async _open(bytes) {
      let L;
      try {
        L = await load();
      } catch (e) {
        // (the viewer could not be loaded – an old browser, or the site is incomplete: the browser's own viewer then)
        if (!this.dead) this._browserViewer(bytes, e);
        return;
      }
      if (this.dead) return;
      this.L = L;
      this.task = L.getDocument({
        data: bytes,
        cMapUrl: abs(BASE + 'cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: abs(BASE + 'standard_fonts/'),
        wasmUrl: abs(BASE + 'wasm/'),
        iccUrl: abs(BASE + 'iccs/'),
        isEvalSupported: false,
        enableXfa: false,
        verbosity: L.VerbosityLevel.ERRORS
      });
      this.task.onPassword = (answer, why) => this._askPassword(answer, why);
      const doc = await this.task.promise;
      if (this.dead) return; // (destroy() has destroyed the loading task, and the document with it)
      this.doc = doc;
      const first = await doc.getPage(1);
      if (this.dead) return;
      const vp = first.getViewport({ scale: 1 });
      // every page the size of the first, until its own size is known (most PDFs have one size)
      for (let n = 1; n <= doc.numPages; n++) this.pages.push(this._pageBox(n, vp.width, vp.height));
      this.pages[0].page = first;
      this.msg.remove();
      this.list.append(...this.pages.map((P) => P.el));
      this._toolbar();
      this._layout();
      this._watch();
      if (this.startPage > 1) this.goTo(this.startPage);
      this._sizes();
    }
    _pageBox(n, w, hgt) {
      const el = h('div.pdfv-page', { 'data-page': String(n), role: 'region', 'aria-label': 'Page ' + n });
      const text = h('div.textLayer');
      const links = h('div.pdfv-links');
      el.append(text, links);
      this.textDivs.add(text);
      text.addEventListener('mousedown', () => text.classList.add('selecting'));
      text.addEventListener('copy', (ev) => {
        // (the text as it reads: ligatures and other composed characters taken apart, no NUL characters)
        const s = String(document.getSelection() || '');
        if (!this.L || !ev.clipboardData) return;
        ev.clipboardData.setData('text/plain', this.L.normalizeUnicode(s).replace(/\u0000/g, ''));
        ev.preventDefault();
      });
      return { num: n, el, text, links, w, h: hgt, scale: 0, canvas: null, page: null, task: null, layer: null, seen: false };
    }
    /** the true size of each page, read after the first one is shown */
    async _sizes() {
      let changed = false;
      for (const P of this.pages.slice(1)) {
        if (this.dead) return;
        try {
          P.page = P.page || (await this.doc.getPage(P.num));
        } catch (e) {
          continue;
        }
        const vp = P.page.getViewport({ scale: 1 });
        if (Math.abs(vp.width - P.w) > 0.5 || Math.abs(vp.height - P.h) > 0.5) {
          P.w = vp.width;
          P.h = vp.height;
          changed = true;
        }
      }
      if (changed && !this.dead) {
        const at = this.current();
        this._layout();
        this.goTo(at, true);
        this._drawVisible();
      }
    }
    _askPassword(answer, why) {
      if (this.dead) return;
      const wrong = why === (this.L && this.L.PasswordResponses.INCORRECT_PASSWORD);
      const input = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Password of the PDF' });
      const go = h('button.btn.small.primary', { type: 'submit' }, 'Open');
      const form = h('form.pdfv-pass', h('p', wrong ? 'That password does not open it. Try again:' : `${this.name} is protected with a password.`), h('div', input, go));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.msg.textContent = 'Opening the PDF…';
        answer(input.value);
      });
      this.msg.replaceChildren(form);
      setTimeout(() => input.focus(), 0);
    }
    _failed(e) {
      if (this.dead) return;
      const name = (e && e.name) || '';
      let text;
      if (name === 'InvalidPDFException' || /Invalid PDF|no pdf header|not a pdf/i.test((e && e.message) || ''))
        text = `${this.name} cannot be read as a PDF: it is damaged, it is not a PDF, or the program that writes it has not finished it. A plot that is still open is not finished yet – in R, close it with dev.off(); in Python, save the figure with plt.savefig() or close the PdfPages file.`;
      else if (name === 'PasswordException') text = `${this.name} is protected with a password.`;
      else text = `${this.name} could not be shown: ${(e && e.message) || e}`;
      this.msg.replaceChildren(h('b', 'This PDF cannot be shown'), h('p', text), h('p.muted', 'Download it (the button above) to open it with another program.'));
      if (!this.msg.isConnected) this.list.replaceChildren(this.msg);
      this.bar.hidden = true;
    }
    /** the browser's own viewer – only if PDF.js itself could not be loaded */
    _browserViewer(bytes, e) {
      this.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      this.bar.hidden = true;
      this.scroll.replaceChildren(h('iframe.pdfv-frame', { src: this.url, title: this.name }));
      console.warn('The PDF viewer (PDF.js) could not be loaded – the browser shows the file instead: ' + ((e && e.message) || e));
    }

    /* ---------------- the toolbar ---------------- */
    _toolbar() {
      const n = this.pages.length;
      const btn = (icon, label, title, fn) => {
        const b = h('button.tbtn', { type: 'button', title, 'aria-label': label || title, html: MG.icon(icon) + (label ? '<span>' + esc(label) + '</span>' : '') });
        b.addEventListener('click', fn);
        return b;
      };
      this.pageIn = h('input.pdfv-num', { type: 'number', min: '1', max: String(n), value: '1', 'aria-label': 'Page number', title: 'Go to page' });
      this.pageIn.addEventListener('change', () => this.goTo(Math.round(+this.pageIn.value) || 1));
      this.pageIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.goTo(Math.round(+this.pageIn.value) || 1);
      });
      this.zoomEl = h('span.pdfv-zoom', { 'aria-live': 'polite' });
      this.fitBtn = btn('maximize', 'Fit width', 'Pages as wide as the pane', () => this.setZoom('fit'));
      this.bar.replaceChildren(
        h('label.pdfv-pg', 'Page ', this.pageIn, h('span', ` of ${n}`)),
        h('span.pdfv-sep'),
        btn('minus', '', 'Zoom out', () => this.step(-1)),
        this.zoomEl,
        btn('plus', '', 'Zoom in', () => this.step(1)),
        this.fitBtn
      );
      this._zoomLabel();
    }
    _zoomLabel() {
      if (!this.zoomEl) return;
      this.zoomEl.textContent = Math.round((this._scale() / PX) * 100) + ' %';
      this.fitBtn.classList.toggle('on', this.zoom === 'fit');
    }
    /** the scale of the pages: CSS pixels per point */
    _scale() {
      if (this.zoom !== 'fit') return this.zoom * PX;
      const P = this.pages[0];
      const s = this._room() / (P ? P.w : 612);
      return Math.max(0.1, Math.min(s, 4 * PX));
    }
    /** the width the pages have to fit in: the same whether the scroll bar is there or not – else a page that is
        about as tall as the pane would make the scroll bar come and go, and the width with it, again and again */
    _room() {
      const sc = this.scroll, w = sc.clientWidth;
      if (!w) return 600 - 2 * PAD; // (the pane is hidden: laid out again when it is shown)
      return w - (sc.offsetWidth - w > 0 ? 0 : scrollbarWidth()) - 2 * PAD;
    }
    setZoom(z) {
      const at = this.current(), into = this._into(at);
      this.zoom = z === 'fit' ? 'fit' : Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
      this._layout();
      this.goTo(at, true, into);
      this._zoomLabel();
      this._drawVisible();
    }
    step(dir) {
      const now = this._scale() / PX;
      const next = dir > 0 ? ZOOMS.find((z) => z > now + 0.005) : ZOOMS.slice().reverse().find((z) => z < now - 0.005);
      if (next) this.setZoom(next);
    }

    /* ---------------- pages ---------------- */
    _layout() {
      const s = this._scale();
      const was = this.layoutScale;
      this.layoutScale = s;
      this.room = this._room();
      for (const P of this.pages) {
        P.el.style.width = Math.floor(P.w * s) + 'px';
        P.el.style.height = Math.floor(P.h * s) + 'px';
        P.el.style.setProperty('--scale-factor', String(s));
        if (P.task && was !== s) P.task.cancel(); // (being drawn at the old size)
        if (P.scale && P.scale !== s) P.el.classList.add('stale'); // (drawn at another size: shown stretched until drawn again)
      }
    }
    /** the page at the top of the view */
    current() {
      if (!this.scroll.clientHeight) return this.pendingPage || this.lastPage; // (hidden: nothing to measure)
      const top = this.scroll.scrollTop + this.scroll.clientHeight / 3;
      let n = 1;
      for (const P of this.pages) {
        if (P.el.offsetTop <= top) n = P.num;
        else break;
      }
      return n;
    }
    /** how far into page n the top of the view is (0 – 1) */
    _into(n) {
      const P = this.pages[n - 1];
      if (!P || !P.el.offsetHeight) return 0;
      return Math.max(0, Math.min(1, (this.scroll.scrollTop - P.el.offsetTop + GAP) / P.el.offsetHeight));
    }
    goTo(n, quiet, into) {
      const P = this.pages[Math.max(1, Math.min(this.pages.length, n)) - 1];
      if (!P) return;
      // (the pane is hidden: the page is gone to when it is shown – see _watch)
      if (!this.scroll.clientHeight) {
        this.pendingPage = P.num;
        return;
      }
      this.scroll.scrollTop = P.el.offsetTop - GAP + (into ? into * P.el.offsetHeight : 0);
      this.lastPage = P.num;
      if (!quiet && this.pageIn) this.pageIn.value = String(P.num);
    }
    _watch() {
      this.io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const P = this.pages[+en.target.dataset.page - 1];
            if (P) P.seen = en.isIntersecting;
          }
          this._drawVisible();
        },
        { root: this.scroll, rootMargin: '50% 0px' }
      );
      this.pages.forEach((P) => this.io.observe(P.el));
      let raf = 0;
      this.scroll.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!this.scroll.clientHeight) return;
          this.lastPage = this.current();
          if (this.pageIn && document.activeElement !== this.pageIn) this.pageIn.value = String(this.lastPage);
        });
      });
      // The pane is shown again, or got wider or narrower: pages that fit its width are laid out again, and the page
      // that was at the top is there again. (While it is hidden nothing can be measured: its height is 0.)
      let t = 0, hidden = !this.scroll.clientHeight;
      this.ro = new ResizeObserver(() => {
        if (this.dead) return;
        if (!this.scroll.clientHeight) {
          hidden = true;
          return;
        }
        const back = hidden;
        hidden = false;
        const refit = this.zoom === 'fit' && this._room() !== this.room;
        if (!refit && !back && !this.pendingPage) return;
        clearTimeout(t);
        t = setTimeout(() => {
          if (this.dead || !this.scroll.clientHeight) return;
          const at = this.pendingPage || (back ? this.lastPage : this.current()), into = this.pendingPage || back ? 0 : this._into(at);
          this.pendingPage = 0;
          if (this.zoom === 'fit') this._layout();
          this.goTo(at, true, into);
          if (this.pageIn) this.pageIn.value = String(at);
          this._zoomLabel();
          this._drawVisible();
        }, back ? 0 : 120);
      });
      this.ro.observe(this.scroll);
      this._up = () => this.textDivs.forEach((d) => d.classList.remove('selecting'));
      document.addEventListener('pointerup', this._up);
      window.addEventListener('blur', this._up);
    }
    /** draw what is in view (one page after another), and let go of pages far from it */
    async _drawVisible() {
      if (this.drawing) {
        this.again = true;
        return;
      }
      this.drawing = true;
      try {
        do {
          this.again = false;
          const s = this.layoutScale;
          const want = this.pages.filter((P) => P.seen && P.scale !== s);
          // (the page at the top first)
          const cur = this.current();
          want.sort((a, b) => Math.abs(a.num - cur) - Math.abs(b.num - cur));
          for (const P of want) {
            if (this.dead || this.again) break;
            await this._draw(P, s);
          }
          this._forget();
        } while (this.again && !this.dead);
      } finally {
        this.drawing = false;
      }
    }
    async _draw(P, s) {
      const L = this.L;
      let page;
      try {
        page = P.page || (P.page = await this.doc.getPage(P.num));
      } catch (e) {
        return;
      }
      if (this.dead || s !== this.layoutScale) return;
      const vp = page.getViewport({ scale: s });
      let ratio = window.devicePixelRatio || 1;
      if (vp.width * vp.height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width * ratio));
      canvas.height = Math.max(1, Math.floor(vp.height * ratio));
      canvas.setAttribute('aria-hidden', 'true');
      P.task = page.render({ canvas, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
      try {
        await P.task.promise;
      } catch (e) {
        freeCanvas(canvas);
        if (!(e instanceof L.RenderingCancelledException)) console.warn('PDF page ' + P.num + ': ' + ((e && e.message) || e));
        return;
      } finally {
        P.task = null;
      }
      if (this.dead || s !== this.layoutScale) return freeCanvas(canvas);
      if (P.canvas) {
        freeCanvas(P.canvas);
        P.canvas.replaceWith(canvas);
      } else P.el.prepend(canvas);
      P.canvas = canvas;
      P.scale = s;
      P.el.classList.remove('stale');
      P.el.style.setProperty('--user-unit', String(vp.userUnit || 1));
      // the text, over the picture of the page
      if (P.layer) P.layer.cancel();
      P.text.replaceChildren();
      P.layer = new L.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: P.text, viewport: vp });
      try {
        await P.layer.render();
        P.text.appendChild(h('div.endOfContent'));
      } catch (e) {
        /* (no text on this page, or drawing it was stopped) */
      }
      await this._links(P, page, vp);
    }
    async _links(P, page, vp) {
      P.links.replaceChildren();
      let annots = [];
      try {
        annots = await page.getAnnotations({ intent: 'display' });
      } catch (e) {
        return;
      }
      for (const a of annots) {
        if (a.subtype !== 'Link' || !a.rect || (!a.url && a.dest == null)) continue;
        const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
        const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
        // (in % of the page: the links stay in place while the page is zoomed, before it is drawn again)
        const pc = (v, of) => (100 * v) / of + '%';
        const style = { left: pc(Math.min(x1, x2), vp.width), top: pc(Math.min(y1, y2), vp.height), width: pc(Math.abs(x2 - x1), vp.width), height: pc(Math.abs(y2 - y1), vp.height) };
        let link;
        if (a.url) link = h('a.pdfv-link', { href: a.url, target: '_blank', rel: 'noopener noreferrer', title: a.url, style });
        else {
          link = h('a.pdfv-link', { href: '#', title: 'Go to the place in this PDF', style });
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this._goDest(a.dest);
          });
        }
        P.links.appendChild(link);
      }
    }
    async _goDest(dest) {
      try {
        if (typeof dest === 'string') dest = await this.doc.getDestination(dest);
        if (!Array.isArray(dest)) return;
        const ref = dest[0];
        const index = ref && typeof ref === 'object' ? await this.doc.getPageIndex(ref) : Number(ref);
        const P = this.pages[index];
        if (!P) return;
        let into = 0;
        // [page, /XYZ, left, top, zoom]: the place on the page
        if (dest[1] && dest[1].name === 'XYZ' && dest[3] != null && P.page) {
          const vp = P.page.getViewport({ scale: this.layoutScale });
          const y = vp.convertToViewportPoint(0, dest[3])[1];
          into = Math.max(0, Math.min(1, y / vp.height));
        }
        this.goTo(index + 1, false, into);
      } catch (e) {
        /* (a link to nowhere) */
      }
    }
    /** let go of the drawn pages furthest from the view, beyond KEEP of them or KEEP_PIXELS of canvas */
    _forget() {
      const drawn = this.pages.filter((P) => P.canvas);
      const px = (P) => P.canvas.width * P.canvas.height;
      let over = drawn.length - KEEP, pixels = drawn.reduce((n, P) => n + px(P), 0);
      if (over <= 0 && pixels <= KEEP_PIXELS) return;
      const cur = this.current();
      const far = drawn.filter((P) => !P.seen).sort((a, b) => Math.abs(b.num - cur) - Math.abs(a.num - cur));
      for (const P of far) {
        if (over <= 0 && pixels <= KEEP_PIXELS) break;
        over--;
        pixels -= px(P);
        freeCanvas(P.canvas);
        P.canvas.remove();
        P.canvas = null;
        P.scale = 0;
        if (P.layer) P.layer.cancel();
        P.layer = null;
        P.text.replaceChildren();
        P.links.replaceChildren();
        if (P.page) P.page.cleanup();
      }
    }

    /* ---------------- the end ---------------- */
    state() {
      // (a hidden pane has no positions to measure: the page last seen)
      return { zoom: this.zoom, page: this.pages.length ? this.current() : this.startPage };
    }
    destroy() {
      if (this.dead) return;
      this.dead = true;
      if (this.io) this.io.disconnect();
      if (this.ro) this.ro.disconnect();
      if (this._up) {
        document.removeEventListener('pointerup', this._up);
        window.removeEventListener('blur', this._up);
      }
      for (const P of this.pages) {
        if (P.task) P.task.cancel();
        if (P.layer) P.layer.cancel();
        freeCanvas(P.canvas);
      }
      // (the loading task destroys the document and stops its worker)
      if (this.task) this.task.destroy().catch(() => {});
      if (this.url) URL.revokeObjectURL(this.url);
      this.el.remove();
    }
  }

  MG.pdfView = (host, bytes, opts) => new PdfView(host, bytes, opts);
  MG.pdfView.load = load;
})();
