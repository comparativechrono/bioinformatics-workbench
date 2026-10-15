/* =====================================================================
   The parts that the R console and RStudio share:

   MG.ConsoleView   an R console: what R prints (as it prints it – a line
                    that has not ended yet, \r of a progress bar), the
                    prompt, the line being typed, history (↑ ↓),
                    completion (Tab), Esc / Ctrl+C to interrupt, Ctrl+L to
                    clear. It shows one R session (rsession.js).
   MG.FloatWin      a window inside a pane, as the R console's windows for
                    plots, help and data: moved by its title, resized by its
                    corner, closed with ×.
   MG.PlotCanvas    a plot as R draws it: each new page clears it, each
                    picture is drawn over it.
   MG.helpHtml      a help page (Rd2HTML) made safe to show, with its links
                    turned into requests for other help pages.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus } = MG;
  const MAX_CHARS = 400000; // what a console keeps (the oldest output goes first)

  /* ------------------------------------------------------------------
     the console
     ------------------------------------------------------------------ */
  class ConsoleView {
    constructor(root, opts = {}) {
      this.root = root;
      this.opts = opts;
      this.history = [];
      this.hIdx = null;
      this.pendingOut = [];
      this.chars = 0;
      this.offs = [];
      this._build();
      if (opts.session) this.attach(opts.session);
    }
    _build() {
      const R = this.root;
      R.classList.add('rc', 'rc-' + (this.opts.theme || 'rgui'));
      this.out = h('div.rc-out', { role: 'log', 'aria-live': 'polite', 'aria-label': this.opts.label || 'R console output' });
      this.promptEl = h('span.rc-prompt');
      this.input = h('textarea.rc-input', { rows: 1, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': this.opts.inputLabel || 'R command – type and press Enter' });
      this.inputLine = h('div.rc-inputline', this.promptEl, this.input);
      this.scroller = h('div.rc-scroll', this.out, this.inputLine);
      R.append(this.scroller);
      this.scroller.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        if (!sel || !String(sel)) this.input.focus({ preventScroll: true });
      });
      this.input.addEventListener('keydown', (e) => this._key(e));
      this.input.addEventListener('input', () => this._grow());
      this.input.addEventListener('paste', (e) => {
        const t = (e.clipboardData || window.clipboardData).getData('text');
        if (t && /\n/.test(t.replace(/\n+$/, ''))) {
          // several lines pasted: R reads them one after another, as in R's own console
          e.preventDefault();
          const before = this.input.value.slice(0, this.input.selectionStart);
          const after = this.input.value.slice(this.input.selectionEnd);
          this.input.value = '';
          this._submit((before + t + after).replace(/\r\n?/g, '\n').replace(/\n+$/, ''));
        }
      });
    }
    _grow() {
      this.input.style.height = 'auto';
      this.input.style.height = Math.min(this.input.scrollHeight, 240) + 'px';
    }
    focus() {
      this.input.focus({ preventScroll: true });
    }
    /** while R serves a Shiny app: no prompt, and what is typed waits; Esc (opts.onInterrupt) stops the app */
    hold(text) {
      this.held = true;
      this.root.classList.add('held');
      this.promptEl.textContent = '';
      this.input.placeholder = text || '';
    }
    release() {
      this.held = false;
      this.root.classList.remove('held');
      this.input.placeholder = '';
      if (this.S && this.S.ready && this.S.waiting) this.promptEl.textContent = this.S.prompt;
    }

    /* ---------------- the session ---------------- */
    attach(S) {
      this.detach();
      this.S = S;
      const on = (t, fn) => this.offs.push(S.on(t, fn));
      on('output', (d) => {
        // (opts.outputFilter: output that goes elsewhere – RStudio's chunk outputs)
        if (this.opts.outputFilter && this.opts.outputFilter(d) === false) return;
        this.write(d.text, d.stream === 'err' ? 'err' : 'out');
      });
      on('echo', (d) => {
        this._flush();
        if (!d.silent) this.write(d.prompt, 'prompt', true), this.write(d.line + '\n', 'in', true);
        this.promptEl.textContent = '';
        this.root.classList.add('busy');
      });
      on('prompt', (d) => {
        this._flush();
        this.promptEl.textContent = this.held ? '' : d.prompt;
        this.root.classList.remove('busy');
        // (after an error: a button that asks the AI assistant about it – opts.askAI() names the console, or null)
        if (this._erred && d.kind === 'top') {
          this._erred = false;
          const where = typeof this.opts.askAI === 'function' ? this.opts.askAI() : this.opts.askAI;
          if (where && MG.aiUtil && MG.Assistant) this._askLink(where);
        }
        this._scroll();
      });
      on('rerror', () => (this._erred = true));
      on('state', (d) => {
        this.root.dataset.state = d.state;
        if (d.state === 'starting') this.promptEl.textContent = '';
      });
      on('ended', (d) => {
        this._flush();
        this.promptEl.textContent = '';
        this.root.classList.remove('busy');
        if (d && d.why && !(d.quit)) this.note(d.why);
      });
      this.root.dataset.state = S.state;
      if (S.waiting && S.ready) this.promptEl.textContent = S.prompt;
    }
    _askLink(where) {
      const b = h('button.rc-ask', { type: 'button', title: 'Send the command and its error message to the AI assistant' }, '✦ Ask the AI assistant about this error');
      b.addEventListener('click', () => {
        const e = MG.aiUtil.lastRError(this.text(8000));
        b.disabled = true;
        if (e) bus.emit('r:ask', Object.assign({ where }, e));
      });
      this.html(h('div.rc-askrow', b));
    }
    detach() {
      this.offs.forEach((f) => f());
      this.offs = [];
      this.S = null;
    }

    /* ---------------- output ---------------- */
    /** text into the console: cls 'out' | 'err' | 'in' | 'prompt' | 'note'. Written in the next animation frame,
        many pieces at once (now: at once) */
    write(text, cls, now) {
      if (!text) return;
      // (the control sequences of a terminal – colours, the cursor shown and hidden – that some packages print: a
      // console of the workbench shows the text without them)
      text = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      if (!text) return;
      this.pendingOut.push([text, cls || 'out']);
      if (now) this._flush();
      else if (!this._raf) this._raf = requestAnimationFrame(() => this._flush());
    }
    note(text) {
      this._flush();
      const el = h('div.rc-note', String(text));
      this.out.appendChild(el);
      this._scroll();
    }
    html(node) {
      this._flush();
      this.out.appendChild(node);
      this._scroll();
    }
    _flush() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      const P = this.pendingOut;
      if (!P.length) return;
      this.pendingOut = [];
      // pieces of the same kind one after another become one
      const merged = [];
      for (const [t, c] of P) {
        const l = merged[merged.length - 1];
        if (l && l[1] === c) l[0] += t;
        else merged.push([t, c]);
      }
      for (const [t, c] of merged) this._put(t, c);
      this._trim();
      this._scroll();
    }
    _put(text, cls) {
      const last = this.out.lastChild;
      const same = last && last.nodeType === 1 && last.classList.contains('rc-' + cls) && last.tagName === 'SPAN';
      // \r and \b (a progress bar that writes over itself): on the line that the output of this kind ended with
      if (/[\r\b]/.test(text) && cls !== 'in') {
        let was = same ? last.textContent : '';
        const nl = was.lastIndexOf('\n');
        let done = was.slice(0, nl + 1), line = Array.from(was.slice(nl + 1)), at = line.length;
        for (const ch of text) {
          if (ch === '\r') at = 0;
          else if (ch === '\b') at = Math.max(0, at - 1);
          else if (ch === '\n') {
            done += line.join('') + '\n';
            line = [];
            at = 0;
          } else line[at++] = ch;
        }
        const t = done + line.join('');
        if (same) {
          this.chars += t.length - last.textContent.length;
          last.textContent = t;
        } else {
          this.out.appendChild(h('span.rc-' + cls, t));
          this.chars += t.length;
        }
        return;
      }
      if (same && last.textContent.length < 50000) last.appendChild(document.createTextNode(text));
      else this.out.appendChild(h('span.rc-' + cls, text));
      this.chars += text.length;
    }
    _trim() {
      if (this.chars <= MAX_CHARS) return;
      while (this.chars > MAX_CHARS * 0.7 && this.out.firstChild) {
        const n = this.out.firstChild;
        this.chars -= (n.textContent || '').length;
        n.remove();
      }
      if (!this.out.querySelector('.rc-cut')) this.out.prepend(h('div.rc-cut', '… the oldest output is no longer shown here'));
    }
    _scroll() {
      this.scroller.scrollTop = this.scroller.scrollHeight;
    }
    clear() {
      this._flush();
      this.out.innerHTML = '';
      this.chars = 0;
      bus.emit('rcon:clear', { theme: this.opts.theme });
    }
    /** all of the console's text (for "Save console", the AI) */
    text(max) {
      this._flush();
      let t = this.out.textContent;
      // (without the "Ask the AI assistant" buttons under errors: they are not part of what R printed)
      if (this.out.querySelector('.rc-askrow')) {
        const c = this.out.cloneNode(true);
        c.querySelectorAll('.rc-askrow').forEach((x) => x.remove());
        t = c.textContent;
      }
      return max && t.length > max ? t.slice(-max) : t;
    }

    /* ---------------- input ---------------- */
    _submit(text) {
      const S = this.S;
      if (!S || S.state === 'ended' || S.state === 'failed') {
        if (this.opts.onDead) this.opts.onDead(text);
        return;
      }
      const lines = String(text);
      if (lines.trim()) {
        for (const l of lines.split('\n')) if (l.trim() && this.history[this.history.length - 1] !== l) this.history.push(l);
        if (this.history.length > 1000) this.history.splice(0, this.history.length - 1000);
        if (this.opts.onHistory) this.opts.onHistory(lines);
      }
      this.hIdx = null;
      S.send(lines);
      this._grow();
    }
    /** run code as if it was typed (the "Run" of a script, a button in the instructions) */
    run(code) {
      this._submit(String(code).replace(/\r\n?/g, '\n').replace(/\n+$/, ''));
    }
    /** put code into the input line (not run) */
    type(code) {
      this.input.value = String(code);
      this._grow();
      this.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      this.input.classList.add('flash');
      setTimeout(() => this.input.classList.remove('flash'), 900);
    }
    _key(e) {
      const inp = this.input;
      if (this._pop && this._popKey(e)) return;
      if (this.held && (e.key === 'Escape' || (e.key === 'c' && e.ctrlKey && !String(window.getSelection() || '')))) {
        e.preventDefault();
        this.interrupt();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (this.held) return;
        const v = inp.value;
        inp.value = '';
        this._submit(v);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.S && !this.S.idle && this.S.state !== 'ended') this.interrupt();
        else {
          inp.value = '';
          this._grow();
        }
        return;
      }
      if (e.key === 'c' && e.ctrlKey && !e.shiftKey) {
        if (window.getSelection && String(window.getSelection())) return; // copy
        if (inp.selectionStart !== inp.selectionEnd) return;
        e.preventDefault();
        if (this.S && !this.S.idle) this.interrupt();
        else {
          this.write(this.promptEl.textContent + inp.value + '^C\n', 'in', true);
          inp.value = '';
          this._grow();
        }
        return;
      }
      if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        this.clear();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this._complete();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const v = inp.value;
        const atTop = !v.slice(0, inp.selectionStart).includes('\n');
        const atEnd = !v.slice(inp.selectionEnd).includes('\n');
        if ((e.key === 'ArrowUp' && !atTop) || (e.key === 'ArrowDown' && !atEnd)) return;
        e.preventDefault();
        const H = this.history;
        if (!H.length) return;
        if (this.hIdx == null) {
          this.pending = v;
          this.hIdx = H.length;
        }
        this.hIdx = Math.max(0, Math.min(H.length, this.hIdx + (e.key === 'ArrowUp' ? -1 : 1)));
        inp.value = this.hIdx === H.length ? this.pending : H[this.hIdx];
        this._grow();
        setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length), 0);
      }
    }
    interrupt() {
      const S = this.S;
      if (!S) return;
      // (what the console's owner stops instead – a Shiny app that R serves)
      if (this.opts.onInterrupt && this.opts.onInterrupt() === true) return;
      if (S.interrupt()) return;
      if (this.opts.onCannotInterrupt) this.opts.onCannotInterrupt();
    }

    /* ---------------- completion (Tab): R's own, as R's console completes ---------------- */
    async _complete() {
      const S = this.S, inp = this.input;
      if (!S || !S.idle) return;
      const cur = inp.selectionStart;
      const v = inp.value;
      const lineStart = v.lastIndexOf('\n', cur - 1) + 1;
      const line = v.slice(lineStart, cur);
      const r = await S.complete(line, line.length);
      if (!r || !r.items.length) return;
      const token = r.token || '';
      const items = r.items.slice(0, 200);
      const put = (it) => {
        const a = cur - token.length;
        inp.value = v.slice(0, a) + it + v.slice(cur);
        const at = a + it.length;
        inp.setSelectionRange(at, at);
        this._closePop();
        this.focus();
      };
      if (items.length === 1) return put(items[0]);
      // what all of them begin with
      const common = items.reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(0, i);
      });
      if (common.length > token.length) {
        inp.value = v.slice(0, cur - token.length) + common + v.slice(cur);
        inp.setSelectionRange(cur - token.length + common.length, cur - token.length + common.length);
        return;
      }
      this._openPop(items, put);
    }
    _openPop(items, put) {
      this._closePop();
      const pop = h('div.rc-pop', { role: 'listbox' });
      items.forEach((it, i) => {
        const b = h('div.rc-popi' + (i === 0 ? '.on' : ''), { role: 'option' }, it);
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          put(it);
        });
        pop.appendChild(b);
      });
      this.root.appendChild(pop);
      const r = this.input.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
      pop.style.left = Math.max(4, r.left - rr.left + 10) + 'px';
      const below = r.bottom - rr.top + 2;
      if (below + 200 > rr.height) pop.style.bottom = rr.bottom - r.top + 2 + 'px';
      else pop.style.top = below + 'px';
      this._pop = { pop, items, i: 0, put };
      setTimeout(() => document.addEventListener('mousedown', this._popOff = (e) => !pop.contains(e.target) && this._closePop()), 0);
    }
    _popKey(e) {
      const P = this._pop;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        P.i = (P.i + (e.key === 'ArrowDown' ? 1 : P.items.length - 1)) % P.items.length;
        Array.from(P.pop.children).forEach((c, k) => c.classList.toggle('on', k === P.i));
        P.pop.children[P.i].scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        P.put(P.items[P.i]);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closePop();
        return true;
      }
      this._closePop();
      return false;
    }
    _closePop() {
      if (!this._pop) return;
      this._pop.pop.remove();
      this._pop = null;
      document.removeEventListener('mousedown', this._popOff);
    }
  }

  /* ------------------------------------------------------------------
     a window inside a pane
     ------------------------------------------------------------------ */
  let zTop = 10;
  class FloatWin {
    constructor(desk, opts = {}) {
      this.desk = desk;
      this.opts = opts;
      const W = Math.min(opts.w || 520, Math.max(240, desk.clientWidth - 30));
      const H = Math.min(opts.h || 420, Math.max(180, desk.clientHeight - 30));
      const n = desk.querySelectorAll('.fwin').length;
      const x = opts.x != null ? opts.x : Math.max(4, desk.clientWidth - W - 16 - (n % 5) * 22);
      const y = opts.y != null ? opts.y : 14 + (n % 5) * 22;
      this.titleEl = h('span.fwin-t', opts.title || '');
      this.tools = h('span.fwin-tools');
      const x0 = h('button.fwin-x', { type: 'button', title: 'Close', 'aria-label': 'Close ' + (opts.title || 'window'), html: MG.icon('x') });
      x0.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      this.bar = h('div.fwin-bar', this.titleEl, this.tools, x0);
      this.body = h('div.fwin-body');
      this.grip = h('div.fwin-grip', { 'aria-hidden': 'true' });
      this.el = h('div.fwin' + (opts.kind ? '.fwin-' + opts.kind : ''), { role: 'dialog', 'aria-label': opts.title || 'Window', style: { left: x + 'px', top: y + 'px', width: W + 'px', height: H + 'px' } }, this.bar, this.body, this.grip);
      desk.appendChild(this.el);
      this.front();
      this.el.addEventListener('pointerdown', () => this.front());
      this._drag(this.bar, (dx, dy, s) => {
        this.el.style.left = MG.clamp(s.l + dx, -this.el.offsetWidth + 60, desk.clientWidth - 40) + 'px';
        this.el.style.top = MG.clamp(s.t + dy, 0, desk.clientHeight - 30) + 'px';
      });
      this._drag(this.grip, (dx, dy, s) => {
        this.el.style.width = Math.max(220, s.w + dx) + 'px';
        this.el.style.height = Math.max(140, s.h + dy) + 'px';
        if (this.opts.onResizing) this.opts.onResizing();
      }, () => this.opts.onResized && this.opts.onResized());
    }
    _drag(handle, move, end) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || e.button !== 0) return;
        e.preventDefault();
        const s = { x: e.clientX, y: e.clientY, l: this.el.offsetLeft, t: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight };
        handle.setPointerCapture(e.pointerId);
        document.body.classList.add('dragging');
        const mv = (ev) => move(ev.clientX - s.x, ev.clientY - s.y, s);
        const up = () => {
          handle.removeEventListener('pointermove', mv);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          document.body.classList.remove('dragging');
          if (end) end();
        };
        handle.addEventListener('pointermove', mv);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }
    front() {
      this.el.style.zIndex = ++zTop;
      this.desk.querySelectorAll('.fwin.on').forEach((w) => w.classList.remove('on'));
      this.el.classList.add('on');
    }
    setTitle(t) {
      this.titleEl.textContent = t;
      this.el.setAttribute('aria-label', t);
    }
    tool(icon, title, fn) {
      const b = h('button.fwin-tool', { type: 'button', title, 'aria-label': title, html: MG.icon(icon) });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(e);
      });
      this.tools.appendChild(b);
      return b;
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.el.remove();
      if (this.opts.onClose) this.opts.onClose();
    }
  }

  /* ------------------------------------------------------------------
     a plot: R's pictures drawn on a canvas, page after page
     ------------------------------------------------------------------ */
  class PlotCanvas {
    constructor(w, h0) {
      this.canvas = h('canvas.rplot', { width: w || 1008, height: h0 || 720, role: 'img', 'aria-label': 'R plot' });
      this.ctx = this.canvas.getContext('2d');
      this.empty = true;
    }
    newPage() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.empty = true;
    }
    draw(img) {
      if (!img) return;
      if (img.width !== this.canvas.width || img.height !== this.canvas.height) {
        // (a device of another size: the canvas takes its size – what was drawn before is gone, as on a new page)
        if (this.empty) {
          this.canvas.width = img.width;
          this.canvas.height = img.height;
        } else {
          const old = document.createElement('canvas');
          old.width = this.canvas.width;
          old.height = this.canvas.height;
          old.getContext('2d').drawImage(this.canvas, 0, 0);
          this.canvas.width = img.width;
          this.canvas.height = img.height;
          this.ctx.drawImage(old, 0, 0);
        }
      }
      this.ctx.drawImage(img, 0, 0);
      try {
        img.close();
      } catch (e) {
        /* fine */
      }
      this.empty = false;
    }
    /** the plot as a PNG (white behind it) → a data URL */
    png() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(this.canvas, 0, 0);
      return c.toDataURL('image/png');
    }
    copy() {
      const p = new PlotCanvas(this.canvas.width, this.canvas.height);
      p.ctx.drawImage(this.canvas, 0, 0);
      p.empty = this.empty;
      return p;
    }
  }

  /* ------------------------------------------------------------------
     help pages: Rd2HTML's page, made safe to show
     ------------------------------------------------------------------ */
  /** the body of a help page (R's own HTML) as a node: no scripts or styles from it, links to other help pages
      call onTopic(topic, package), links to the web open in a new tab */
  function helpHtml(html, onTopic) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script, link, style, meta, iframe, object, embed').forEach((n) => n.remove());
    const clean = window.DOMPurify ? window.DOMPurify.sanitize(doc.body.innerHTML, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'script'], FORBID_ATTR: ['style'] }) : esc(doc.body.textContent);
    const box = h('div.rhelp', { html: clean });
    box.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener';
        return;
      }
      if (href.startsWith('#')) return;
      // ../../stats/html/weighted.mean.html, ../../base/help/sum, ../html/00Index.html
      const m = /(?:^|\/)([A-Za-z][\w.]*)\/(?:html|help)\/([^/#?]+?)(?:\.html)?(?:[#?].*)?$/.exec(href) || /^([^/#?]+?)(?:\.html)?$/.exec(href);
      if (!m) return;
      const pkg = m.length === 3 ? m[1] : '', topic = decodeURIComponent(m.length === 3 ? m[2] : m[1]);
      if (topic === '00Index') {
        a.removeAttribute('href');
        a.classList.add('rhelp-dead');
        return;
      }
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (onTopic) onTopic(topic, pkg);
      });
    });
    return box;
  }

  /** a text window or pane: what file.show() or a pager shows */
  function textNode(text) {
    return h('pre.rtext', text);
  }

  MG.ConsoleView = ConsoleView;
  MG.FloatWin = FloatWin;
  MG.PlotCanvas = PlotCanvas;
  MG.helpHtml = helpHtml;
  MG.rTextNode = textNode;
})();
