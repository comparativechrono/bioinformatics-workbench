/* =====================================================================
   The Python of Spyder in the IDE tab. It is a Python of its own – as
   Spyder's console is a separate process on a computer – so a variable
   made here is not in the notebook's Python, and the other way round.
   Both work on the same files.

   A PyKernel (kernels.js) whose worker is py-ide-worker.js, with a copy
   of the home folder of its own (MG.pysync's ways, its own record of
   what was sent).

   new MG.IDEPython({ideOpts})
     .ensure()               start Python (if it is not running) → a promise
     .restart()              a new Python: the namespace is lost
     .exec(code, handlers, opts) → {ok, count, cwd}
         handlers.onOutput(o)    what the code prints, its results, errors, plots, the debugger's position
         handlers.onInput(m)     input() or the debugger asks: {prompt, password} – answer with .answer(text)
         opts: {silent, scan (the code whose imports are loaded first), extra (cells, breakpoints)}
     .answer(text)           the answer to input()
     .interrupt()            Ctrl+C → true if Python was told (only where the page is cross-origin isolated)
     .call(fn, ...args)      a request to wb_ide.py (variables, view, complete, inspect, lint …) → its answer
     .canAsk                 input() and the debugger can wait for an answer here
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const CFG = MG.config;
  const abs = (u) => new URL(u, location.href).href;
  const INPUT_MAX = 1 << 20; // the longest answer to input(), in bytes

  class IDEPython extends MG.PyKernel {
    constructor(opts = {}) {
      const sync = Object.create(MG.pysync);
      sync.sent = new Map();
      const build = CFG.buildId || '1';
      super({
        workerUrl: 'assets/js/py-ide-worker.js?v=' + build,
        indexURL: abs(CFG.pyodideBase || 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'),
        // (numpy, pandas and matplotlib load after the console has started – a package that a command imports is
        // loaded before the command runs – and so do jedi and pyflakes, for the Editor's completion and code analysis)
        preload: [],
        background: (CFG.pythonPreload || ['numpy', 'pandas', 'matplotlib']).concat(['jedi', abs('assets/vendor/pyflakes/pyflakes-4.0.3-py2.py3-none-any.whl')]),
        files: [],
        modules: [
          { name: 'smk.py', url: abs('assets/py/smk.py') + '?v=' + build },
          { name: 'wb_ide.py', url: abs('assets/py/wb_ide.py') + '?v=' + build }
        ],
        sync,
        evLang: 'spyder',
        init: () => this._init()
      });
      this.label = 'Python';
      this.ideOpts = opts.ideOpts || {};
      this.waiting = null; // the question of input() that has not been answered yet
      this.busy = false;
    }
    /** what the worker needs besides the notebook's: new shared buffers each time Python starts */
    _init() {
      const iso = !!window.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
      this.inputSab = iso ? new SharedArrayBuffer(8 + INPUT_MAX) : null;
      this.intr = iso ? new Int32Array(new SharedArrayBuffer(4)) : null;
      this.waiting = null;
      return {
        ide: true,
        lazyFiles: ((MG.app && MG.app.exampleFiles) || []).map((f) => ({ path: f.path, url: f.url })),
        inputBuffer: this.inputSab,
        interrupt: this.intr ? this.intr.buffer : null,
        ideOpts: this.ideOpts
      };
    }
    get canAsk() {
      return !!this.inputSab;
    }
    onMessage(m) {
      if (m.type === 'input') {
        this.waiting = { id: m.id, prompt: m.prompt, password: !!m.password };
        const p = this.pending.get(m.id);
        if (p && p.onInput) p.onInput(m);
        // (nobody to ask: as if Ctrl+C had been pressed)
        else this.interrupt();
      } else if (m.type === 'ide-reply') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        let v = null;
        try {
          v = JSON.parse(m.value);
        } catch (e) {
          v = null;
        }
        p.resolve(v);
      }
    }
    /** run code in the console (typed, or sent by the editor) → the 'done' message: {ok, count, cwd} */
    async exec(code, handlers = {}, opts = {}) {
      await this.ensure();
      await this.files.push(this);
      if (this.intr) Atomics.store(this.intr, 0, 0);
      this.busy = true;
      try {
        return await this._send({ type: 'ide-run', code, silent: !!opts.silent, scan: opts.scan != null ? opts.scan : code, extra: opts.extra || {}, user: MG.user.login() }, handlers);
      } finally {
        this.busy = false;
        this.waiting = null;
      }
    }
    answer(text) {
      if (!this.inputSab || !this.waiting) return false;
      const ctl = new Int32Array(this.inputSab, 0, 2);
      const data = new Uint8Array(this.inputSab, 8);
      const b = new TextEncoder().encode(String(text == null ? '' : text)).slice(0, data.length);
      data.set(b);
      Atomics.store(ctl, 1, b.length);
      Atomics.store(ctl, 0, 1);
      Atomics.notify(ctl, 0);
      this.waiting = null;
      return true;
    }
    interrupt() {
      if (this.waiting && this.inputSab) {
        const ctl = new Int32Array(this.inputSab, 0, 2);
        Atomics.store(ctl, 0, 2);
        Atomics.notify(ctl, 0);
        this.waiting = null;
        return true;
      }
      if (this.intr && this.busy) {
        Atomics.store(this.intr, 0, 2);
        // (a time.sleep() that is waiting wakes up: see ide_sleep in py-ide-worker.js)
        Atomics.notify(this.intr, 0);
        return true;
      }
      return false;
    }
    /** a request to wb_ide.py → its answer (null when Python is not running) */
    async call(fn, ...args) {
      if (this.state !== 'ready') return null;
      return this._send({ type: 'ide-call', fn, args });
    }
  }

  MG.IDEPython = IDEPython;
})();
