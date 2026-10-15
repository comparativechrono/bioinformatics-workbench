/* =====================================================================
   Spyder in the IDE tab: an IDE for Python in the manner of Spyder 6
   (its dark theme and its default layout), made for teaching – it is
   not Spyder itself. The panes:

     Editor              Python scripts and text files, with cells (#%%),
                         breakpoints, code analysis and completion
     IPython Console     IPython itself, in a Python of its own (pyide.js,
                         py-ide-worker.js, assets/py/wb_ide.py)
     Variable Explorer   the console's variables (spyder-panes.js), with
                         viewers for data frames, arrays and collections
     Plots, Help, Files, History, Debugger   (spyder-panes.js)

   As in Spyder 6, Run file (F5), Run cell (Ctrl+Enter) and Debug type
   Spyder's magics into the console: %runfile, %runcell, %debugfile.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;

  /* ------------------------------------------------------------------
     icons: Spyder's toolbars have their own (run is green, debugging is
     blue, stopping is red)
     ------------------------------------------------------------------ */
  const SVG = {
    newfile: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.5L4 19H5"/><path d="M4 19l3.5-9H22l-3.5 9z"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    saveall: '<path d="M8 3h10l3 3v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M10 3v4h6V3M10 18v-5h8v5M3 7v13a2 2 0 0 0 2 2h11"/>',
    run: '<path d="M7 4.5v15l12-7.5z"/>',
    runcell: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 8.5v7l5.5-3.5z"/>',
    runcelladv: '<rect x="3" y="3" width="14" height="13" rx="2"/><path d="M8.5 6.8v6l4.6-3z"/><path d="M20 10v10h-9M17 17l3 3 3-3"/>',
    runsel: '<path d="M3 6h9M3 11h7M3 16h9"/><path d="M14 8.5v10l7-5z"/>',
    rerun: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/><path d="M10.5 9v6l4.5-3z"/>',
    debug: '<path d="M7 4.5v15l12-7.5z"/><path d="M3 8h2M3 12h2M3 16h2"/>',
    debugcell: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 8.5v7l5.5-3.5z"/><path d="M6 9h1M6 12h1M6 15h1"/>',
    step: '<path d="M4 14a8 8 0 0 1 15-3.5"/><path d="M20 5v6h-6"/><circle cx="12" cy="19" r="2"/>',
    stepin: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><circle cx="12" cy="19" r="2"/>',
    stepout: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><circle cx="12" cy="19" r="2"/>',
    cont: '<path d="M4 4.5v15l10-7.5z"/><path d="M17 5v14M21 5v14"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    prefs: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.8-.6-.6-2.8z"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    pyfile: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8.5 17v-5h2a1.5 1.5 0 0 1 0 3h-2"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.3-2.4 3.8M12 17h.01"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    broom: '<path d="M14 4l6 6M12.5 5.5l6 6-7 7-6-6zM5.5 12.5l-2.5 7.5 7.5-2.5"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    plot: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    outline: '<path d="M4 6h16M8 10h12M8 14h12M4 18h16"/>'
  };
  const ic = (name, cls) => `<svg class="sp-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SVG[name] || ''}</svg>`;

  /* ------------------------------------------------------------------
     text helpers: ANSI colours (tracebacks, ?), Python's quoting
     ------------------------------------------------------------------ */
  /** text with ANSI colour codes → HTML with spans (the 16 colours are classes; 256 colours and RGB inline) */
  function ansiHtml(text) {
    const out = [];
    let fg = null, bg = null, bold = false, ital = false, under = false, open = false;
    const close = () => {
      if (open) out.push('</span>');
      open = false;
    };
    const start = () => {
      const cls = [], st = [];
      if (fg != null) typeof fg === 'number' ? cls.push('ansi-fg' + fg) : st.push('color:' + fg);
      if (bg != null) typeof bg === 'number' ? cls.push('ansi-bg' + bg) : st.push('background:' + bg);
      if (bold) cls.push('ansi-b');
      if (ital) cls.push('ansi-i');
      if (under) cls.push('ansi-u');
      if (cls.length || st.length) {
        out.push(`<span${cls.length ? ` class="${cls.join(' ')}"` : ''}${st.length ? ` style="${st.join(';')}"` : ''}>`);
        open = true;
      }
    };
    const c256 = (n) => {
      if (n < 16) return n;
      if (n >= 232) {
        const v = 8 + (n - 232) * 10;
        return `rgb(${v},${v},${v})`;
      }
      n -= 16;
      const s = [0, 95, 135, 175, 215, 255];
      return `rgb(${s[Math.floor(n / 36)]},${s[Math.floor(n / 6) % 6]},${s[n % 6]})`;
    };
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(esc(text.slice(last, m.index)));
      last = re.lastIndex;
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) (fg = bg = null), (bold = ital = under = false);
        else if (c === 1) bold = true;
        else if (c === 3) ital = true;
        else if (c === 4) under = true;
        else if (c === 22) bold = false;
        else if (c === 23) ital = false;
        else if (c === 24) under = false;
        else if (c >= 30 && c <= 37) fg = c - 30;
        else if (c >= 90 && c <= 97) fg = c - 90 + 8;
        else if (c === 39) fg = null;
        else if (c >= 40 && c <= 47) bg = c - 40;
        else if (c >= 100 && c <= 107) bg = c - 100 + 8;
        else if (c === 49) bg = null;
        else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
          const v = c256(codes[i + 2] || 0);
          c === 38 ? (fg = v) : (bg = v);
          i += 2;
        } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
          const v = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`;
          c === 38 ? (fg = v) : (bg = v);
          i += 4;
        }
      }
      close();
      start();
    }
    if (last < text.length) out.push(esc(text.slice(last)));
    close();
    // (other control sequences – the cursor shown and hidden – are dropped)
    return out.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  }
  const stripAnsi = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  /** a path as Spyder writes it in %runfile: quoted when it has spaces or quotes */
  const qpath = (p) => (/^[\w./~+@%-]+$/.test(p) ? p : "'" + p.replace(/'/g, "'\\''") + "'");

  /** is this Python code waiting for more lines (an open bracket or string, a line ending in : or \, a block
      not yet ended by an empty line)? As IPython decides when Enter is pressed. */
  function incomplete(code) {
    let depth = 0, q = null, triple = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) {
        if (ch === '\\') i++;
        else if (triple ? code.startsWith(q + q + q, i) : ch === q) {
          if (triple) i += 2;
          q = null;
        } else if (!triple && ch === '\n') q = null;
        continue;
      }
      if (ch === '#') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        triple = code.startsWith(ch + ch + ch, i);
        if (triple) i += 2;
        q = ch;
      } else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
    }
    if ((q && triple) || depth > 0) return true;
    const lines = code.split('\n');
    const last = lines[lines.length - 1];
    if (/\\$/.test(last)) return true;
    const bare = (l) => l.replace(/#.*$/, '').replace(/'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"/g, "''");
    const block = lines.some((l) => /:\s*$/.test(bare(l)) && /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|async|match|case)\b/.test(l)) || lines.some((l) => /^\s*@/.test(l));
    if (block) return last.trim() !== '';
    return false;
  }

  /* ------------------------------------------------------------------
     menus as Spyder's (Qt's): a column of shortcuts, check marks, separators
     items: [label, fn, {key, checked, disabled}] or '-'
     ------------------------------------------------------------------ */
  function spMenu(at, items, root) {
    document.querySelectorAll('.sp-qmenu').forEach((m) => m.remove());
    const m = h('div.sp-qmenu' + (root && root.classList.contains('sp-light') ? '.sp-light' : ''), { role: 'menu' });
    const close = (refocus) => {
      m.remove();
      document.removeEventListener('pointerdown', off, true);
      if (refocus && at instanceof Element && at.isConnected) at.focus();
    };
    for (const it of items) {
      if (!it) continue;
      if (it === '-') {
        m.appendChild(h('div.sp-qsep', { role: 'separator' }));
        continue;
      }
      const [label, fn, o = {}] = it;
      const b = h('button.sp-qitem', { type: 'button', role: o.checked != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': o.checked != null ? String(!!o.checked) : null }, h('span.sp-qchk', o.checked ? '✓' : ''), h('span.sp-qlbl', label), h('span.sp-qkey', o.key || ''));
      if (o.disabled) b.disabled = true;
      b.addEventListener('click', () => {
        close(false);
        fn();
      });
      m.appendChild(b);
    }
    m.addEventListener('keydown', (e) => {
      const bs = Array.from(m.querySelectorAll('button:not(:disabled)'));
      const i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        close(true);
      }
    });
    document.body.appendChild(m);
    let x, y;
    if (at instanceof Element) {
      const r = at.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 2;
      if (y + m.offsetHeight > window.innerHeight - 6) y = Math.max(6, r.top - 2 - m.offsetHeight);
    } else {
      x = at.x;
      y = at.y;
      if (y + m.offsetHeight > window.innerHeight - 6) y = Math.max(6, y - m.offsetHeight);
    }
    m.style.left = Math.max(4, Math.min(window.innerWidth - m.offsetWidth - 4, x)) + 'px';
    m.style.top = y + 'px';
    function off(e) {
      if (!m.contains(e.target)) close(false);
    }
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
    const first = m.querySelector('button:not(:disabled)');
    if (first) first.focus();
    return m;
  }

  /* the template of a new file (Spyder writes the date and the author at the top) */
  const template = () => `# -*- coding: utf-8 -*-\n"""\nCreated on ${new Date().toString().replace(/ GMT.*$/, '').replace(/^(\w+) (\w+) (\d+) (\d+) ([\d:]+)$/, '$1 $2 $3 $5 $4')}\n\n@author: ${MG.user.name()}\n"""\n\n`;

  const isTemplate = (t) => /^# -\*- coding: utf-8 -\*-\n"""\nCreated on [^\n]*\n\n@author: [^\n]*\n"""\s*$/.test(t);

  /* cells: a line that starts with #%% (or # %%, # <codecell>, # In[ ]:) begins a new one */
  const CELL = /^\s*#\s*(%%|<codecell>|In\[\d*\]:)/;

  /* ------------------------------------------------------------------
     the application
     ------------------------------------------------------------------ */
  let docSeq = 0;
  const PREFS = {
    theme: 'dark',
    fontSize: 13,
    lineNumbers: true,
    wrap: false,
    autoClose: true,
    lint: true,
    complete: true,
    muteInline: true,
    saveBeforeRun: true,
    clearBefore: false,
    currentNs: false,
    postMortem: false,
    vars: { private: true, uppercase: true, capitalized: false, unsupported: false, callables: true }
  };

  class SpyderApp {
    constructor(root, opts = {}) {
      this.root = root;
      this.fs = opts.fs || MG.app.fs;
      this.prefs = Object.assign({}, PREFS, store.get('spPrefs', {}));
      this.prefs.vars = Object.assign({}, PREFS.vars, this.prefs.vars || {});
      this.docs = [];
      this.cur = null;
      this.panes = {};
      this.cwd = MG.app.HOME;
      this.breakpoints = store.get('spBreak', {}) || {};
      this.runConf = store.get('spRunConf', {}) || {};
      this.plots = [];
      this.plotAt = -1;
      this.debugging = null; // {file, line, stack} while the debugger has stopped
      this._build();
      this._buildEditor();
      this._buildConsole();
      if (this._buildPanes) this._buildPanes();
      this._layout();
      // (the files of the last visit open again; openFile waits for them, so that the file asked for ends up on top)
      this.restored = this._restoreDocs();
      this.fs.onChange((p, what) => this._fsChanged(p, what));
      document.addEventListener('keydown', (e) => this._globalKey(e), true);
      this.startKernel();
    }

    /* ================= the frame: menus, toolbar, panes, status bar ================= */
    _build() {
      const R = this.root;
      R.classList.add('sp', this.prefs.theme === 'light' ? 'sp-light' : 'sp-dark');
      const menu = (label, items) => {
        const b = h('button.sp-menu', { type: 'button', 'aria-haspopup': 'menu' }, label);
        b.addEventListener('click', () => spMenu(b, items(), this.root));
        return b;
      };
      const D = () => !!this.debugging;
      this.menubar = h(
        'div.sp-menubar',
        menu('File', () => [
          ['New file', () => this.newDoc()],
          ['Open…', () => this.openDialog(), { key: 'Ctrl+O' }],
          '-',
          ['Save', () => this.save(), { key: 'Ctrl+S', disabled: !this.cur }],
          ['Save all', () => this.saveAll(), { key: 'Ctrl+Alt+S' }],
          ['Save as…', () => this.saveAs(), { key: 'Ctrl+Shift+S', disabled: !this.cur }],
          '-',
          ['Close', () => this.cur && this.closeDoc(this.cur), { disabled: !this.cur }],
          ['Close all', () => this.closeAll()]
        ]),
        menu('Edit', () => [
          ['Undo', () => this.cm.undo(), { key: 'Ctrl+Z' }],
          ['Redo', () => this.cm.redo(), { key: 'Ctrl+Shift+Z' }],
          '-',
          ['Select all', () => (this.cm.execCommand('selectAll'), this.cm.focus()), { key: 'Ctrl+A' }],
          '-',
          ['Comment/uncomment', () => this.toggleComment(), { key: 'Ctrl+1' }],
          ['Indent', () => this.cm.execCommand('indentMore'), { key: 'Tab' }],
          ['Unindent', () => this.cm.execCommand('indentLess'), { key: 'Shift+Tab' }]
        ]),
        menu('Search', () => [
          ['Find text', () => this.find(false), { key: 'Ctrl+F' }],
          ['Find next', () => this.findNext(1), { key: 'F3' }],
          ['Find previous', () => this.findNext(-1), { key: 'Shift+F3' }],
          ['Replace text', () => this.find(true), { key: 'Ctrl+R' }],
          '-',
          ['Go to line…', () => this.gotoLine(), { key: 'Ctrl+L' }]
        ]),
        menu('Source', () => [
          ['Run code analysis', () => this.lintNow(true), { key: 'F8' }],
          ['Show code analysis warnings', () => this.setPref('lint', !this.prefs.lint), { checked: !!this.prefs.lint }],
          ['Go to next warning or error', () => this.nextWarning(1)],
          ['Go to previous warning or error', () => this.nextWarning(-1)],
          '-',
          ['Remove trailing spaces', () => this.stripTrailing()],
          ['Fix indentation', () => this.fixIndentation()]
        ]),
        menu('Run', () => [
          ['Run', () => this.runFile(), { key: 'F5' }],
          ['Run cell', () => this.runCell(false), { key: 'Ctrl+Return' }],
          ['Run cell and advance', () => this.runCell(true), { key: 'Shift+Return' }],
          ['Re-run last cell', () => this.rerunCell(), { key: 'Alt+Return' }],
          ['Run selection or current line', () => this.runSelection(), { key: 'F9' }],
          '-',
          ['Configuration per file…', () => this.runConfigDialog(), { key: 'Ctrl+F6' }]
        ]),
        menu('Debug', () => [
          ['Debug file', () => this.debugFile(), { key: 'Ctrl+F5', disabled: D() }],
          ['Debug cell', () => this.debugCell(), { key: 'Alt+Shift+Return', disabled: D() }],
          '-',
          ['Step', () => this.dbgCmd('next'), { key: 'Ctrl+F10', disabled: !D() }],
          ['Step into', () => this.dbgCmd('step'), { key: 'Ctrl+F11', disabled: !D() }],
          ['Step return', () => this.dbgCmd('return'), { key: 'Ctrl+Shift+F11', disabled: !D() }],
          ['Continue', () => this.dbgCmd('continue'), { key: 'Ctrl+F12', disabled: !D() }],
          ['Stop', () => this.dbgCmd('exit'), { key: 'Ctrl+Shift+F12', disabled: !D() }],
          '-',
          ['Set/clear breakpoint', () => this.toggleBreakpoint(), { key: 'F12' }],
          ['Clear breakpoints in all files', () => this.clearBreakpoints()],
          ['List breakpoints', () => this.listBreakpoints()]
        ]),
        menu('Consoles', () => [
          ['Restart kernel', () => this.restartKernel(true), { key: 'Ctrl+.' }],
          ['Interrupt kernel', () => this.interrupt(), { disabled: !this.running }],
          '-',
          ['Remove all variables', () => this.removeAllVariables()],
          ['Clear console', () => this.clearConsole(), { key: 'Ctrl+L' }]
        ]),
        menu('Tools', () => [['Preferences', () => this.prefsDialog()]]),
        menu('View', () => [
          ['Editor', () => this.focusEditor()],
          ['IPython Console', () => this.showPane('console', { focus: true })],
          ['History', () => this.showPane('history')],
          ['Variable Explorer', () => this.showPane('vars')],
          ['Help', () => this.showPane('help')],
          ['Plots', () => this.showPane('plots')],
          ['Files', () => this.showPane('files')],
          ['Debugger', () => this.showPane('debugger')],
          '-',
          ['Maximise current pane', () => this.maximize(), { key: 'Ctrl+Alt+Shift+M' }],
          ['Reset window layout', () => this.resetLayout()]
        ]),
        menu('Help', () => [
          ['Spyder in the workbench (help page)', () => MG.app.showHelp && MG.app.showHelp('h-spyder')],
          ['Keyboard shortcuts', () => this.shortcutsDialog()],
          '-',
          ['About this Spyder', () => this.about()]
        ])
      );
      // the main toolbar
      const tb = (icon, title, fn, cls) => {
        const b = h('button.sp-tb' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title, html: ic(icon) });
        b.addEventListener('click', fn);
        return b;
      };
      const sep = () => h('span.sp-tsep');
      this.dbgBtns = [
        tb('step', 'Execute the current line (Ctrl+F10)', () => this.dbgCmd('next'), 'blue'),
        tb('stepin', 'Step into the function or method of the current line (Ctrl+F11)', () => this.dbgCmd('step'), 'blue'),
        tb('stepout', 'Execute until the current function or method returns (Ctrl+Shift+F11)', () => this.dbgCmd('return'), 'blue'),
        tb('cont', 'Continue execution until the next breakpoint (Ctrl+F12)', () => this.dbgCmd('continue'), 'blue'),
        tb('stop', 'Stop debugging (Ctrl+Shift+F12)', () => this.dbgCmd('exit'), 'red')
      ];
      this.wdIn = h('input.sp-wdin', { type: 'text', 'aria-label': 'Working directory', spellcheck: 'false', title: 'The working directory of the console: relative paths start here' });
      this.wdIn.value = this.cwd;
      this.wdIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.setCwd(this.wdIn.value.trim());
        if (e.key === 'Escape') this.wdIn.value = this.cwd;
      });
      this.toolbar = h(
        'div.sp-toolbar',
        tb('newfile', 'New file', () => this.newDoc()),
        tb('open', 'Open file (Ctrl+O)', () => this.openDialog()),
        tb('save', 'Save file (Ctrl+S)', () => this.save()),
        tb('saveall', 'Save all files (Ctrl+Alt+S)', () => this.saveAll()),
        sep(),
        tb('run', 'Run file (F5)', () => this.runFile(), 'green'),
        tb('runcell', 'Run current cell (Ctrl+Enter)', () => this.runCell(false), 'green'),
        tb('runcelladv', 'Run current cell and go to the next one (Shift+Enter)', () => this.runCell(true), 'green'),
        tb('runsel', 'Run selection or current line (F9)', () => this.runSelection(), 'green'),
        sep(),
        tb('debug', 'Debug file (Ctrl+F5)', () => this.debugFile(), 'blue'),
        tb('debugcell', 'Debug cell (Alt+Shift+Enter)', () => this.debugCell(), 'blue'),
        ...this.dbgBtns,
        sep(),
        tb('maximize', 'Maximise current pane (Ctrl+Alt+Shift+M)', () => this.maximize()),
        tb('prefs', 'Preferences', () => this.prefsDialog()),
        h('span.sp-tgrow'),
        h('span.sp-wdlabel', { html: ic('folder') }),
        this.wdIn,
        tb('folder', 'Change the working directory', () => this.chooseCwd()),
        tb('up', 'Change to the parent directory', () => this.setCwd(MG.path.dirname(this.cwd)))
      );
      this._dbgState(false);
      // the panes: the Editor on the left; on the right two docks, each with its tabs below it, as in Spyder
      this.main = h('div.sp-main');
      this.left = h('div.sp-left');
      this.right = h('div.sp-right');
      this.docks = {};
      this.docks.top = this._dock('top', [
        ['help', 'Help'],
        ['vars', 'Variable Explorer'],
        ['debugger', 'Debugger'],
        ['plots', 'Plots'],
        ['files', 'Files']
      ]);
      this.docks.bottom = this._dock('bottom', [
        ['console', 'IPython Console'],
        ['history', 'History']
      ]);
      this.hsplit = h('div.sp-hsplit', { role: 'separator', 'aria-orientation': 'horizontal' });
      this.vsplit = h('div.sp-vsplit', { role: 'separator', 'aria-orientation': 'vertical' });
      this.right.append(this.docks.top.el, this.hsplit, this.docks.bottom.el);
      this.main.append(this.left, this.vsplit, this.right);
      // the status bar
      this.stEnv = h('span.sp-st', { title: 'The Python of the IPython console' }, 'Python');
      this.stPos = h('span.sp-st', 'Line 1, Col 1');
      this.stEnc = h('span.sp-st', 'UTF-8');
      this.stEol = h('span.sp-st', 'LF');
      this.stRw = h('span.sp-st', 'RW');
      this.stMsg = h('span.sp-stmsg');
      this.status = h('div.sp-status', this.stMsg, h('span.sp-tgrow'), this.stEnv, this.stPos, this.stEnc, this.stEol, this.stRw);
      R.append(this.menubar, this.toolbar, this.main, this.status);
      this._splitters();
    }
    _dock(name, panes) {
      const body = h('div.sp-dockbody');
      const tabs = h('div.sp-docktabs', { role: 'tablist' });
      const D = { name, el: h('section.sp-dock.sp-dock-' + name, body, tabs), body, tabs, cur: null, ids: [] };
      for (const [id, label] of panes) {
        const btn = h('button.sp-dtab', { type: 'button', role: 'tab', 'aria-selected': 'false' }, label);
        btn.addEventListener('click', () => this.showPane(id, { focus: true }));
        tabs.appendChild(btn);
        const el = h('div.sp-pane.sp-pane-' + id, { hidden: true, role: 'tabpanel', 'aria-label': label });
        body.appendChild(el);
        this.panes[id] = { id, label, dock: D, btn, el };
        D.ids.push(id);
      }
      return D;
    }
    /** a pane's own toolbar (at its top) with its options menu (≡) on the right → the toolbar */
    _paneBar(id, items, options) {
      const bar = h('div.sp-pbar');
      for (const it of items) bar.appendChild(it);
      bar.appendChild(h('span.sp-tgrow'));
      if (options) {
        const b = h('button.sp-ptb', { type: 'button', title: 'Options', 'aria-label': 'Options', html: ic('menu') });
        b.addEventListener('click', () => spMenu(b, options(), this.root));
        bar.appendChild(b);
      }
      this.panes[id].el.appendChild(bar);
      return bar;
    }
    _ptb(icon, title, fn, cls) {
      const b = h('button.sp-ptb' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title, html: ic(icon) });
      b.addEventListener('click', fn);
      return b;
    }
    showPane(id, opts = {}) {
      const P = this.panes[id];
      if (!P) return;
      const D = P.dock;
      for (const x of D.ids) {
        const Q = this.panes[x];
        Q.el.hidden = Q !== P;
        Q.btn.classList.toggle('on', Q === P);
        Q.btn.setAttribute('aria-selected', Q === P ? 'true' : 'false');
      }
      D.cur = id;
      if (this.prefs.layout && this.prefs.layout[D.name] !== id) {
        this.prefs.layout[D.name] = id;
        this._savePrefs();
      }
      if (this._paneShown) this._paneShown(id, opts);
      if (id === 'console') {
        this._sizeConsole && this._sizeConsole();
        if (opts.focus) this.focusConsole();
      }
    }
    _layout() {
      const L = (this.prefs.layout = Object.assign({ top: 'vars', bottom: 'console' }, this.prefs.layout || {}));
      this.showPane(this.panes[L.top] ? L.top : 'vars');
      this.showPane(this.panes[L.bottom] ? L.bottom : 'console');
      const s = store.get('spSplit', null);
      if (s) for (const [k, v] of Object.entries(s)) this.root.style.setProperty(k, v);
    }
    resetLayout() {
      this.root.classList.remove('max-left', 'max-top', 'max-bottom');
      for (const k of ['--sp-left', '--sp-top']) this.root.style.removeProperty(k);
      store.remove('spSplit');
      this.showPane('vars');
      this.showPane('console');
      this._resized();
    }
    _splitters() {
      const drag = (el, prop, axis, box) => {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          const r = box().getBoundingClientRect();
          const move = (ev) => {
            const f = axis === 'x' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
            this.root.style.setProperty(prop, Math.round(MG.clamp(f, 0.15, 0.85) * 1000) / 10 + '%');
            this._resized();
          };
          const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            const s = {};
            for (const p of ['--sp-left', '--sp-top']) if (this.root.style.getPropertyValue(p)) s[p] = this.root.style.getPropertyValue(p);
            store.set('spSplit', s);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        });
        el.addEventListener('dblclick', () => {
          this.root.style.removeProperty(prop);
          this._resized();
        });
      };
      drag(this.vsplit, '--sp-left', 'x', () => this.main);
      drag(this.hsplit, '--sp-top', 'y', () => this.right);
    }
    maximize() {
      const where = this._focusArea();
      const cls = where === 'editor' ? 'max-left' : where === 'top' ? 'max-top' : 'max-bottom';
      const on = this.root.classList.contains(cls);
      this.root.classList.remove('max-left', 'max-top', 'max-bottom');
      if (!on) this.root.classList.add(cls);
      this._resized();
    }
    _focusArea() {
      const a = document.activeElement;
      if (a && this.left.contains(a)) return 'editor';
      if (a && this.docks.top.el.contains(a)) return 'top';
      if (a && this.docks.bottom.el.contains(a)) return 'bottom';
      return this._lastArea || 'editor';
    }
    _resized() {
      clearTimeout(this._rz);
      this._rz = setTimeout(() => {
        if (this.cm) this.cm.refresh();
        if (this._sizeConsole) this._sizeConsole();
        if (this._plotFit) this._plotFit();
      }, 60);
    }
    shown(opts) {
      this._resized();
      if (!opts || !opts.resize) setTimeout(() => (this.cur ? this.cm.focus() : this.focusConsole()), 40);
    }
    _status(text, ms) {
      this.stMsg.textContent = text || '';
      clearTimeout(this._stT);
      if (text && ms) this._stT = setTimeout(() => (this.stMsg.textContent = ''), ms);
    }
    _savePrefs() {
      store.set('spPrefs', this.prefs);
    }
    _globalKey(e) {
      if (e.defaultPrevented || !this.root.isConnected || this.root.closest('[hidden]')) return;
      const a = document.activeElement;
      if (!(a && this.root.contains(a)) && a !== document.body) return;
      if (document.querySelector('.modal-back')) return;
      const key = e.key, ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey, alt = e.altKey;
      const inEditor = this.cmHost.contains(a);
      const act = (fn) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (a) {
        const r = a.closest('.sp-left, .sp-dock-top, .sp-dock-bottom');
        if (r) this._lastArea = r.classList.contains('sp-left') ? 'editor' : r.classList.contains('sp-dock-top') ? 'top' : 'bottom';
      }
      // (the editor's own keys – Ctrl+Enter, F9 … – are its CodeMirror's: see _buildEditor)
      if (key === 'F5' && !ctrl && !shift) return act(() => this.runFile());
      if (key === 'F5' && ctrl) return act(() => this.debugFile());
      if (key === 'F10' && ctrl) return act(() => this.dbgCmd('next'));
      if (key === 'F11' && ctrl && shift) return act(() => this.dbgCmd('return'));
      if (key === 'F11' && ctrl) return act(() => this.dbgCmd('step'));
      if (key === 'F12' && ctrl && shift) return act(() => this.dbgCmd('exit'));
      if (key === 'F12' && ctrl) return act(() => this.dbgCmd('continue'));
      if (key === 'F6' && ctrl) return act(() => this.runConfigDialog());
      if (ctrl && alt && shift && (key === 'M' || key === 'm')) return act(() => this.maximize());
      if (ctrl && !shift && !alt && key === '.') return act(() => this.restartKernel(true));
      if (ctrl && !shift && !alt && (key === 'o' || key === 'O')) return act(() => this.openDialog());
      if (!inEditor && ctrl && !alt && (key === 's' || key === 'S')) return act(() => (shift ? this.saveAs() : this.save()));
      if (!inEditor && key === 'F9') return act(() => this.runSelection());
    }

    /* ================= the Editor ================= */
    _buildEditor() {
      this.edTabs = h('div.sp-edtabs', { role: 'tablist', 'aria-label': 'Open files' });
      const opt = h('button.sp-ptb', { type: 'button', title: 'Options', 'aria-label': 'Editor options', html: ic('menu') });
      opt.addEventListener('click', () =>
        spMenu(
          opt,
          [
            ['New file', () => this.newDoc()],
            ['Save all', () => this.saveAll()],
            ['Close all', () => this.closeAll()],
            '-',
            ['Show code analysis warnings', () => this.setPref('lint', !this.prefs.lint), { checked: !!this.prefs.lint }],
            ['Wrap lines', () => this.setPref('wrap', !this.prefs.wrap), { checked: !!this.prefs.wrap }],
            ['Show line numbers', () => this.setPref('lineNumbers', !this.prefs.lineNumbers), { checked: this.prefs.lineNumbers !== false }]
          ],
          this.root
        )
      );
      this.cmHost = h('div.sp-cm');
      this.edEmpty = h('div.sp-edempty', { hidden: true }, h('p', 'No files are open.'), (() => {
        const b = h('button.sp-btn', { type: 'button' }, 'New file');
        b.addEventListener('click', () => this.newDoc());
        return b;
      })());
      this.findBar = this._buildFind();
      const head = h('div.sp-edhead', this.edTabs, h('span.sp-tgrow'), opt);
      this.left.append(h('section.sp-editor', head, h('div.sp-edbody', this.cmHost, this.edEmpty), this.findBar));
      const keys = {
        'Ctrl-Enter': () => this.runCell(false),
        'Cmd-Enter': () => this.runCell(false),
        'Shift-Enter': () => this.runCell(true),
        'Alt-Enter': () => this.rerunCell(),
        'Shift-Alt-Enter': () => this.debugCell(),
        F9: () => this.runSelection(),
        F12: () => this.toggleBreakpoint(),
        F8: () => this.lintNow(true),
        F3: () => this.findNext(1),
        'Shift-F3': () => this.findNext(-1),
        'Ctrl-I': () => this.helpAtCursor(),
        'Cmd-I': () => this.helpAtCursor(),
        'Ctrl-1': () => this.toggleComment(),
        'Cmd-1': () => this.toggleComment(),
        'Ctrl-/': () => this.toggleComment(),
        'Ctrl-S': () => this.save(),
        'Cmd-S': () => this.save(),
        'Shift-Ctrl-S': () => this.saveAs(),
        'Ctrl-Alt-S': () => this.saveAll(),
        'Ctrl-F': () => this.find(false),
        'Cmd-F': () => this.find(false),
        'Ctrl-R': () => this.find(true),
        'Ctrl-L': () => this.gotoLine(),
        'Ctrl-G': () => this.gotoDefinition(),
        'Ctrl-Space': () => this.complete(true),
        'Ctrl-Z': 'undo',
        'Shift-Ctrl-Z': 'redo',
        'Ctrl-Y': 'redo',
        Tab: (cm) => this._tab(cm),
        'Shift-Tab': 'indentLess',
        Esc: () => {
          if (this._pop) return this._popClose();
          if (!this.findBar.hidden) return this._findClose();
          return window.CodeMirror.Pass;
        }
      };
      this.cm = window.CodeMirror(this.cmHost, {
        value: '',
        mode: 'python',
        lineNumbers: this.prefs.lineNumbers !== false,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        styleActiveLine: true,
        matchBrackets: true,
        autoCloseBrackets: this.prefs.autoClose !== false,
        lineWrapping: !!this.prefs.wrap,
        gutters: ['sp-bp', 'CodeMirror-linenumbers', 'sp-lint'],
        extraKeys: keys,
        screenReaderLabel: 'Editor'
      });
      this.cm.on('gutterClick', (cm, line, gutter) => {
        if (gutter === 'sp-bp' || gutter === 'CodeMirror-linenumbers') this.toggleBreakpoint(line);
      });
      this.cm.on('cursorActivity', () => this._cursorMoved());
      this.cm.on('changes', () => this._docChanged());
      this.cm.on('inputRead', (cm, chg) => this._typed((chg.text || []).join('\n').slice(-1)));
      this.cm.on('mousedown', (cm, e) => {
        if ((e.ctrlKey || e.metaKey) && e.button === 0 && !e.altKey) {
          // (Ctrl+click: go to the definition of the name, as in Spyder – not a second cursor)
          e.preventDefault();
          cm.setCursor(cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window'));
          this.gotoDefinition();
        }
      });
      this._applyPrefs();
    }
    _applyPrefs() {
      const pf = this.prefs;
      this.root.classList.toggle('sp-dark', pf.theme !== 'light');
      this.root.classList.toggle('sp-light', pf.theme === 'light');
      this.root.style.setProperty('--sp-edfont', (pf.fontSize || 13) + 'px');
      if (this.cm) {
        this.cm.setOption('lineNumbers', pf.lineNumbers !== false);
        this.cm.setOption('lineWrapping', !!pf.wrap);
        this.cm.setOption('autoCloseBrackets', pf.autoClose !== false);
        this.cm.refresh();
      }
      if (this.ccm) this.ccm.refresh();
      for (const d of this.docs) if (!pf.lint) this._clearLint(d);
      if (pf.lint) this.lintSoon();
    }
    setPref(key, value) {
      this.prefs[key] = value;
      this._savePrefs();
      this._applyPrefs();
      if (key === 'muteInline' || key === 'theme') this._kernelSettings && this._kernelSettings();
    }
    focusEditor() {
      if (this.cur) this.cm.focus();
    }

    /* ---------------- documents ---------------- */
    _untitledName() {
      for (let i = 0; ; i++) {
        const n = `untitled${i}.py`;
        if (!this.docs.some((d) => d.name === n && !d.path) && !this.fs.exists(this.cwd + '/' + n)) return n;
      }
    }
    _newDocObj({ path, text, name }, opts = {}) {
      const d = { id: ++docSeq, path: path || null, name: name || (path ? MG.path.basename(path) : this._untitledName()), lint: [], bpLines: [] };
      d.mode = !path || /\.(py|pyw|pyi)$/i.test(path) ? 'python' : /\.(md|markdown)$/i.test(path) ? 'markdown' : /\.(ya?ml)$/i.test(path) ? 'yaml' : /\.(sh|bash)$/i.test(path) ? 'shell' : /\.(js|json)$/i.test(path) ? { name: 'javascript', json: /\.json$/i.test(path) } : /\.r$/i.test(path) ? 'r' : 'text/plain';
      d.cmDoc = window.CodeMirror.Doc(text || '', d.mode);
      d.gen = d.cmDoc.changeGeneration(true);
      // (a new file is not "modified" until it is edited; one kept from the last visit with more than the template is)
      d.dirty = !path && !!text && !isTemplate(text) && !!opts.restored;
      // (an untitled file whose text came from elsewhere stays "modified" until it is saved, even if its edits are undone)
      d.unsavedText = d.dirty;
      this.docs.push(d);
      return d;
    }
    newDoc(text) {
      const d = this._newDocObj({ text: text != null ? text : template() });
      // (a new file with code from elsewhere – the AI assistant, the help – has something to save)
      if (text != null && text.trim() && !isTemplate(text)) d.dirty = d.unsavedText = true;
      this._renderTabs();
      this.switchTo(d);
      this.cm.setCursor({ line: d.cmDoc.lineCount() - 1, ch: 0 });
      this._persistDocs();
      bus.emit('spyder:new', { name: d.name });
      return d;
    }
    async openFile(path, opts = {}) {
      if (this.restored) await this.restored.catch(() => {});
      const fs = this.fs;
      const p = fs.resolve(path);
      let d = this.docs.find((x) => x.path === p);
      if (!d) {
        if (!fs.exists(p) || fs.isDir(p)) {
          toast(`There is no file ${esc(fs.pretty(p))}.`, 'warn');
          return null;
        }
        const e = fs.get(p);
        if (e.kind !== 'text') {
          // (a picture, a PDF …: the workbench's Files tab shows it)
          return MG.app.openFile ? MG.app.openFile(p) : null;
        }
        const text = await fs.readText(p);
        d = this._newDocObj({ path: p, text });
        this._renderTabs();
        this._restoreBreakpoints(d);
      }
      this.switchTo(d);
      if (opts.line) {
        this.cm.setCursor({ line: opts.line - 1, ch: opts.ch || 0 });
        this.cm.scrollIntoView(null, 120);
      }
      this._persistDocs();
      bus.emit('spyder:open', { path: p });
      return d;
    }
    switchTo(d) {
      if (!d) return;
      this.cur = d;
      this.cm.swapDoc(d.cmDoc);
      this._applyPendingBp(d);
      this.cmHost.hidden = false;
      this.edEmpty.hidden = true;
      this._renderTabs();
      this._cells();
      this._cursorMoved();
      this._markDebugLine();
      if (this.prefs.lint) this.lintSoon(100);
      setTimeout(() => this.cm.refresh(), 0);
      this.cm.focus();
    }
    _renderTabs() {
      this.edTabs.innerHTML = '';
      for (const d of this.docs) {
        const b = h('button.sp-edtab' + (d === this.cur ? '.on' : '') + (d.dirty ? '.dirty' : ''), { type: 'button', role: 'tab', 'aria-selected': d === this.cur ? 'true' : 'false', title: d.path ? d.path : d.name + ' (not saved yet)' }, h('span', d.name + (d.dirty ? '*' : '')));
        const x = h('span.sp-edx', { role: 'button', title: 'Close', 'aria-label': 'Close ' + d.name, html: ic('close') });
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeDoc(d);
        });
        b.appendChild(x);
        b.addEventListener('click', () => this.switchTo(d));
        b.addEventListener('auxclick', (e) => e.button === 1 && this.closeDoc(d));
        this.edTabs.appendChild(b);
      }
      if (!this.docs.length) {
        this.cmHost.hidden = true;
        this.edEmpty.hidden = false;
      }
    }
    _docChanged() {
      const d = this.cur;
      if (!d) return;
      const dirty = !d.cmDoc.isClean(d.gen) || (!d.path && !!d.unsavedText);
      if (dirty !== d.dirty) {
        d.dirty = dirty;
        this._renderTabs();
      }
      this._cells();
      if (this.prefs.lint) this.lintSoon();
      clearTimeout(this._persistT);
      this._persistT = setTimeout(() => this._persistDocs(), 800);
    }
    _cursorMoved() {
      const c = this.cm.getCursor();
      this.stPos.textContent = `Line ${c.line + 1}, Col ${c.ch + 1}`;
      this._curCell();
      if (this._pop && !this._popKeep) this._popClose();
    }
    /** the file's path → the path Spyder would run it as (an unsaved new file: in the working directory) */
    _pathOf(d) {
      return d.path || this.cwd + '/' + d.name;
    }
    async save(d = this.cur) {
      if (!d) return false;
      if (!d.path) return this.saveAs(d);
      const text = d.cmDoc.getValue();
      const e = this.fs.get(d.path);
      this.fs.writeText(d.path, text, e && e.mode ? { mode: e.mode } : {});
      d.gen = d.cmDoc.changeGeneration(true);
      d.dirty = d.unsavedText = false;
      d.selfWrite = Date.now();
      this._renderTabs();
      this._persistDocs();
      this._status(`File saved: ${this.fs.pretty(d.path)}`, 3000);
      bus.emit('spyder:save', { path: d.path });
      return true;
    }
    async saveAs(d = this.cur) {
      if (!d) return false;
      const p = await this.fileDialog({ title: 'Save file', mode: 'save', dir: d.path ? MG.path.dirname(d.path) : this.cwd, name: d.path ? MG.path.basename(d.path) : d.name });
      if (!p) return false;
      if (this.fs.exists(p) && p !== d.path && !(await MG.confirmBox('Save file', `<p><b>${esc(this.fs.pretty(p))}</b> already exists. Do you want to replace it?</p>`, 'Replace', { danger: true }))) return false;
      const old = d.path;
      d.path = p;
      d.name = MG.path.basename(p);
      if (old && this.breakpoints[old]) {
        this.breakpoints[p] = this.breakpoints[old];
        delete this.breakpoints[old];
        this._saveBreakpoints();
      }
      const mode = /\.(py|pyw|pyi)$/i.test(p) ? 'python' : d.mode;
      if (mode !== d.mode) {
        d.mode = mode;
        d.cmDoc.setOption ? d.cmDoc.setOption('mode', mode) : this.cm.setOption('mode', mode);
      }
      return this.save(d);
    }
    async saveAll() {
      for (const d of this.docs.slice()) if (d.dirty) if (!(await this.save(d))) return false;
      return true;
    }
    async closeDoc(d) {
      if (d.dirty && d.cmDoc.getValue().trim() && !isTemplate(d.cmDoc.getValue())) {
        const ans = await this._ask3(`Save ${d.name}`, `<p><b>${esc(d.name)}</b> has been modified. Do you want to save your changes?</p>`, ['Save', "Don't save", 'Cancel']);
        if (ans === 2 || ans == null) return false;
        if (ans === 0 && !(await this.save(d))) return false;
      }
      const i = this.docs.indexOf(d);
      if (i < 0) return true;
      this.docs.splice(i, 1);
      if (this.cur === d) {
        this.cur = null;
        const next = this.docs[Math.min(i, this.docs.length - 1)];
        if (next) this.switchTo(next);
        else this.cm.swapDoc(window.CodeMirror.Doc(''));
      }
      this._renderTabs();
      this._persistDocs();
      return true;
    }
    async closeAll() {
      for (const d of this.docs.slice()) if (!(await this.closeDoc(d))) return;
    }
    dirtyPaths() {
      return this.docs.filter((d) => d.dirty && d.path).map((d) => d.path);
    }
    /** a question with three answers → 0, 1 or 2 (null if the dialog was closed) */
    _ask3(title, html, labels) {
      return new Promise((resolve) => {
        let done = false;
        const m = MG.modal(title, html + `<div class="prompt-actions">${labels.map((l, i) => `<button class="btn${i === 0 ? ' primary' : ''}" data-i="${i}" type="button">${esc(l)}</button>`).join('')}</div>`, {
          onClose: () => {
            if (!done) {
              done = true;
              resolve(null);
            }
          }
        });
        m.box.classList.add('sp-dialog');
        m.box.querySelectorAll('[data-i]').forEach((b) =>
          b.addEventListener('click', () => {
            done = true;
            m.close();
            resolve(Number(b.dataset.i));
          })
        );
      });
    }
    _persistDocs() {
      const list = this.docs.map((d) => (d.path ? { path: d.path, cur: this.cur === d, line: d.cmDoc.getCursor().line } : { name: d.name, text: d.cmDoc.getValue().slice(0, 200000), cur: this.cur === d }));
      store.set('spOpen', list);
    }
    async _restoreDocs() {
      const list = store.get('spOpen', null);
      if (Array.isArray(list) && list.length) {
        let cur = null;
        for (const it of list) {
          let d = null;
          if (it.path) {
            if (!this.fs.exists(it.path) || this.fs.get(it.path).kind !== 'text') continue;
            d = this._newDocObj({ path: it.path, text: await this.fs.readText(it.path) });
            this._restoreBreakpoints(d);
            if (it.line) d.cmDoc.setCursor({ line: it.line, ch: 0 });
          } else if (it.text != null) {
            d = this._newDocObj({ text: it.text, name: it.name }, { restored: true });
          }
          if (d && it.cur) cur = d;
        }
        if (this.docs.length) {
          this._renderTabs();
          this.switchTo(cur || this.docs[0]);
          return;
        }
      }
      this.newDoc();
    }
    _fsChanged(path, what) {
      for (const d of this.docs) {
        if (!d.path || (path !== d.path && !d.path.startsWith(path + '/'))) continue;
        if (what === 'remove' && !this.fs.exists(d.path)) {
          // (the file was deleted: the document stays open, unsaved)
          d.path = null;
          d.dirty = d.unsavedText = true;
          this._renderTabs();
          continue;
        }
        if (d.selfWrite && Date.now() - d.selfWrite < 1500) continue;
        if (d.dirty) continue;
        // (changed outside the editor – by the script, the terminal, the notebook: the new text, as Spyder reloads it)
        const e = this.fs.get(d.path);
        if (!e || e.kind !== 'text') continue;
        this.fs.readText(d.path).then((t) => {
          if (t === d.cmDoc.getValue()) return;
          const c = d.cmDoc.getCursor();
          d.cmDoc.setValue(t);
          d.cmDoc.setCursor(c);
          d.gen = d.cmDoc.changeGeneration(true);
          d.dirty = false;
          this._renderTabs();
        });
      }
      if (this._filesChanged) this._filesChanged(path);
    }

    /* ---------------- cells ---------------- */
    _cellStarts(doc = this.cm.getDoc()) {
      const starts = [0];
      const n = doc.lineCount();
      for (let i = 1; i < n; i++) if (CELL.test(doc.getLine(i))) starts.push(i);
      return starts;
    }
    /** the cell at a line → {index, from, to (exclusive), name} */
    _cellAt(line, doc = this.cm.getDoc()) {
      const starts = this._cellStarts(doc);
      let k = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= line) k = i;
      const from = starts[k], to = k + 1 < starts.length ? starts[k + 1] : doc.lineCount();
      const m = /^\s*#\s*%%\s*(.*)$/.exec(doc.getLine(from) || '');
      return { index: k, from, to, name: m && m[1].trim() ? m[1].trim() : '', count: starts.length };
    }
    _cells() {
      const doc = this.cm.getDoc();
      const d = this.cur;
      if (!d || d.mode !== 'python') return;
      for (const l of d.cellLines || []) doc.removeLineClass(l, 'wrap', 'sp-cellsep');
      d.cellLines = [];
      const n = doc.lineCount();
      for (let i = 0; i < n; i++) {
        if (CELL.test(doc.getLine(i))) d.cellLines.push(doc.addLineClass(i, 'wrap', 'sp-cellsep'));
      }
      this._curCell(true);
    }
    _curCell(force) {
      const d = this.cur;
      if (!d || d.mode !== 'python') return;
      const doc = this.cm.getDoc();
      const hasCells = (d.cellLines || []).length > 0;
      const c = hasCells ? this._cellAt(this.cm.getCursor().line) : null;
      const key = c ? c.from + ':' + c.to : '';
      if (!force && key === d.curCellKey) return;
      d.curCellKey = key;
      this.cm.operation(() => {
        for (const l of d.curCellMarks || []) doc.removeLineClass(l, 'background', 'sp-curcell');
        d.curCellMarks = [];
        if (c) for (let i = c.from; i < c.to; i++) d.curCellMarks.push(doc.addLineClass(i, 'background', 'sp-curcell'));
      });
    }

    /* ---------------- run ---------------- */
    _conf(path) {
      const c = this.runConf[path] || {};
      return {
        wdir: c.wdir || 'file', // 'file' | 'cwd' | 'custom'
        wdirPath: c.wdirPath || '',
        clear: c.clear != null ? c.clear : !!this.prefs.clearBefore,
        currentNs: c.currentNs != null ? c.currentNs : !!this.prefs.currentNs,
        postMortem: c.postMortem != null ? c.postMortem : !!this.prefs.postMortem,
        args: c.args || ''
      };
    }
    /** the file of the current document, saved (Spyder saves before running) → its path, or null */
    async _savedPath() {
      const d = this.cur;
      if (!d) return null;
      if (d.mode !== 'python') {
        toast('Only Python files (.py) can be run here.', 'warn');
        return null;
      }
      if (!d.path) {
        if (!(await this.saveAs(d))) return null;
      } else if (d.dirty || this.prefs.saveBeforeRun) {
        if (this.prefs.saveBeforeRun) await this.saveAll();
        else await this.save(d);
      }
      return d.path;
    }
    _runLine(magic, path) {
      const c = this._conf(path);
      let line = `%${magic} ${qpath(path)}`;
      if (c.wdir === 'file') line += ' --wdir';
      else if (c.wdir === 'custom' && c.wdirPath) line += ' --wdir ' + qpath(this.fs.resolve(c.wdirPath));
      if (c.args) line += ' --args ' + qpath(c.args);
      if (c.postMortem && magic === 'runfile') line += ' --post-mortem';
      if (c.currentNs) line += ' --current-namespace';
      return { line, conf: c };
    }
    async runFile() {
      if (this.debugging) return toast('The debugger is running: stop it first (Ctrl+Shift+F12).', 'warn');
      const path = await this._savedPath();
      if (!path) return;
      const { line } = this._runLine('runfile', path);
      const text = this.cur.cmDoc.getValue();
      this.execute(line, { scan: text, clear: this._conf(path).clear, file: path });
      bus.emit('spyder:run', { what: 'file', path });
    }
    async debugFile() {
      if (this.debugging) return toast('The debugger is running already.', 'warn');
      if (!this._canDebug()) return;
      const path = await this._savedPath();
      if (!path) return;
      const { line } = this._runLine('debugfile', path);
      this.execute(line, { scan: this.cur.cmDoc.getValue(), debug: true, file: path });
      bus.emit('spyder:debug', { what: 'file', path });
    }
    _cellInfo(advance) {
      const d = this.cur;
      if (!d || d.mode !== 'python') {
        toast('Cells can only be run in Python files.', 'warn');
        return null;
      }
      const doc = d.cmDoc;
      const c = this._cellAt(doc.getCursor().line, doc);
      const code = doc.getRange({ line: c.from, ch: 0 }, { line: c.to, ch: 0 }).replace(/\n$/, '');
      const path = this._pathOf(d);
      if (advance) {
        const next = c.to < doc.lineCount() ? c.to : c.from;
        doc.setCursor({ line: Math.min(next + (next === c.to ? 1 : 0), doc.lineCount() - 1), ch: 0 });
        this.cm.scrollIntoView(null, 80);
      }
      return { path, index: c.index, code, first: c.from + 1, text: doc.getValue(), name: c.name };
    }
    runCell(advance) {
      if (this.debugging) return toast('The debugger is running: stop it first (Ctrl+Shift+F12).', 'warn');
      const c = this._cellInfo(advance);
      if (!c) return;
      this._lastCell = c;
      this.execute(`%runcell -i ${c.index} ${qpath(c.path)}`, { scan: c.code, cells: [c] });
      bus.emit('spyder:run', { what: 'cell', path: c.path, index: c.index });
    }
    rerunCell() {
      if (!this._lastCell) return this.runCell(false);
      const c = this._lastCell;
      // (the cell's code as it is now in the editor)
      const d = this.docs.find((x) => this._pathOf(x) === c.path);
      if (d) {
        const starts = this._cellStarts(d.cmDoc);
        if (c.index < starts.length) {
          const from = starts[c.index], to = c.index + 1 < starts.length ? starts[c.index + 1] : d.cmDoc.lineCount();
          c.code = d.cmDoc.getRange({ line: from, ch: 0 }, { line: to, ch: 0 }).replace(/\n$/, '');
          c.first = from + 1;
          c.text = d.cmDoc.getValue();
        }
      }
      this.execute(`%runcell -i ${c.index} ${qpath(c.path)}`, { scan: c.code, cells: [c] });
    }
    debugCell() {
      if (this.debugging) return toast('The debugger is running already.', 'warn');
      if (!this._canDebug()) return;
      const c = this._cellInfo(false);
      if (!c) return;
      this.execute(`%debugcell -i ${c.index} ${qpath(c.path)}`, { scan: c.code, cells: [c], debug: true });
      bus.emit('spyder:debug', { what: 'cell', path: c.path });
    }
    /** F9: the selected lines – or the current line – are typed into the console */
    runSelection() {
      const d = this.cur;
      if (!d) return;
      let code;
      if (this.cm.somethingSelected()) code = this.cm.getSelection();
      else {
        const c = this.cm.getCursor();
        code = this.cm.getLine(c.line);
        if (c.line < this.cm.lineCount() - 1) this.cm.setCursor({ line: c.line + 1, ch: 0 });
      }
      // (the common indentation goes: a selection inside a function runs at the top level)
      const lines = code.replace(/\s+$/, '').split('\n');
      const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
      code = lines.map((l) => l.slice(Math.min(ind, /^\s*/.exec(l)[0].length))).join('\n');
      if (!code.trim()) return;
      if (this.debugging && this.py.waiting) return this.consoleAnswer(code);
      this.execute(code, { scan: code });
      bus.emit('spyder:run', { what: 'selection' });
    }

    /* ---------------- breakpoints ---------------- */
    toggleBreakpoint(line) {
      const d = this.cur;
      if (!d || d.mode !== 'python') return;
      if (line == null) line = this.cm.getCursor().line;
      const info = this.cm.lineInfo(line);
      const has = info && info.gutterMarkers && info.gutterMarkers['sp-bp'];
      this.cm.setGutterMarker(line, 'sp-bp', has ? null : h('span.sp-bpdot', { title: 'Breakpoint' }));
      this._storeBreakpoints(d);
      if (this.debugging) this._bpDirty = true;
      bus.emit('spyder:breakpoint', { path: d.path, line: line + 1, on: !has });
    }
    _bpLines(d) {
      if (d.pendingBp) return d.pendingBp.slice();
      const out = [];
      const doc = d.cmDoc;
      doc.eachLine((lh) => {
        if (lh.gutterMarkers && lh.gutterMarkers['sp-bp']) out.push(doc.getLineNumber(lh) + 1);
      });
      return out;
    }
    _storeBreakpoints(d) {
      const p = this._pathOf(d);
      const lines = this._bpLines(d);
      if (lines.length) this.breakpoints[p] = lines;
      else delete this.breakpoints[p];
      this._saveBreakpoints();
    }
    _saveBreakpoints() {
      store.set('spBreak', this.breakpoints);
      if (this._renderDebugger) this._renderDebugger();
    }
    _restoreBreakpoints(d) {
      d.pendingBp = (this.breakpoints[d.path] || []).slice();
      if (this.cur === d) this._applyPendingBp(d);
    }
    _applyPendingBp(d) {
      if (!d.pendingBp) return;
      for (const n of d.pendingBp) if (n - 1 < d.cmDoc.lineCount()) this.cm.setGutterMarker(n - 1, 'sp-bp', h('span.sp-bpdot', { title: 'Breakpoint' }));
      d.pendingBp = null;
    }
    /** a gutter of a document emptied (the editor's own method works on the document it shows) */
    _clearGutter(d, gutter) {
      if (this.cm.getDoc() === d.cmDoc) return this.cm.clearGutter(gutter);
      d.cmDoc.eachLine((lh) => {
        if (lh.gutterMarkers && lh.gutterMarkers[gutter]) delete lh.gutterMarkers[gutter];
      });
    }
    _allBreakpoints() {
      for (const d of this.docs) if (d.mode === 'python') this._storeBreakpoints(d);
      return Object.assign({}, this.breakpoints);
    }
    clearBreakpoints() {
      for (const d of this.docs) {
        d.pendingBp = null;
        this._clearGutter(d, 'sp-bp');
      }
      this.breakpoints = {};
      this._saveBreakpoints();
      if (this.debugging) this._bpDirty = true;
      this._status('All breakpoints were cleared.', 3000);
    }
    listBreakpoints() {
      this.showPane('debugger');
    }

    /* ---------------- the debugger: the toolbar's buttons type pdb's commands into its prompt ---------------- */
    _canDebug() {
      if (this.py && !this.py.canAsk) {
        MG.confirmBox(
          'Debugging is not available',
          '<p>The debugger stops your code and waits for you to type commands, and a web page can only wait like that when it is <b>cross-origin isolated</b>. This page is not, so the debugger cannot run here.</p><p class="muted">The help page about Spyder explains why and what to do. Running files and cells works as usual.</p>',
          'Show the help',
          { cancel: 'Close' }
        ).then((ok) => ok && MG.app.showHelp && MG.app.showHelp('h-spyder', { anchor: 'isolation' }));
        return false;
      }
      return true;
    }
    dbgCmd(cmd) {
      if (!this.debugging || !this.py || !this.py.waiting) {
        if (cmd !== 'exit') this._status('The debugger is not running. Start it with Debug file (Ctrl+F5).', 4000);
        return;
      }
      this.consoleAnswer(cmd);
    }
    _dbgState(on) {
      for (const b of this.dbgBtns || []) b.disabled = !on;
    }
    _debugAt(m) {
      this.debugging = m;
      this._dbgState(true);
      if (m.file && this.fs.exists(m.file) && m.line) {
        const d = this.docs.find((x) => x.path === m.file);
        const go = () => this._markDebugLine(true);
        if (d) {
          if (this.cur !== d) this.switchTo(d);
          go();
        } else if (m.file.startsWith(MG.app.HOME + '/')) this.openFile(m.file).then(go);
      } else this._markDebugLine(true);
      if (this._renderDebugger) this._renderDebugger();
      if (this._debugVars) this._debugVars(m.vars || []);
      bus.emit('spyder:debug-stop', { file: m.file, line: m.line });
    }
    _debugEnd() {
      this.debugging = null;
      this._dbgState(false);
      this._markDebugLine();
      if (this._renderDebugger) this._renderDebugger();
      if (this.refreshVars) this.refreshVars();
      bus.emit('spyder:debug-end', {});
    }
    _markDebugLine(scroll) {
      const doc = this.cm.getDoc();
      if (this._dbgMark) {
        try {
          this._dbgMark.doc.removeLineClass(this._dbgMark.line, 'background', 'sp-dbgline');
          this._dbgMark.doc.removeLineClass(this._dbgMark.line, 'gutter', 'sp-dbggutter');
        } catch (e) {}
        this._dbgMark = null;
      }
      const m = this.debugging;
      if (!m || !this.cur || this.cur.path !== m.file || !m.line) return;
      const line = doc.getLineHandle(m.line - 1);
      if (!line) return;
      doc.addLineClass(line, 'background', 'sp-dbgline');
      doc.addLineClass(line, 'gutter', 'sp-dbggutter');
      this._dbgMark = { doc, line };
      if (scroll) {
        this.cm.setCursor({ line: m.line - 1, ch: 0 });
        this.cm.scrollIntoView({ line: m.line - 1, ch: 0 }, 100);
      }
    }

    /* ---------------- find, go to line, comments, tidying ---------------- */
    _buildFind() {
      this.findIn = h('input.sp-findin', { type: 'text', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
      this.replIn = h('input.sp-findin', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' });
      this.findCase = h('input', { type: 'checkbox', 'aria-label': 'Case sensitive' });
      this.findInfo = h('span.sp-findinfo');
      const b = (label, fn, title) => {
        const x = h('button.sp-btn.small', { type: 'button', title: title || label }, label);
        x.addEventListener('click', fn);
        return x;
      };
      this.replRow = h('div.sp-findrow', h('span.sp-findlbl', 'Replace with:'), this.replIn, b('Replace', () => this._replace(false)), b('Replace all', () => this._replace(true)));
      const closeB = h('button.sp-ptb', { type: 'button', title: 'Close', 'aria-label': 'Close the find bar', html: ic('close') });
      closeB.addEventListener('click', () => this._findClose());
      const bar = h(
        'div.sp-find',
        { hidden: true },
        h('div.sp-findrow', closeB, h('span.sp-findlbl', 'Find:'), this.findIn, b('▲', () => this.findNext(-1), 'Find previous (Shift+F3)'), b('▼', () => this.findNext(1), 'Find next (F3)'), h('label.sp-check', this.findCase, ' Case sensitive'), this.findInfo),
        this.replRow
      );
      this.findIn.addEventListener('input', () => this._findCount());
      this.findIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (e.preventDefault(), this.findNext(e.shiftKey ? -1 : 1));
        if (e.key === 'Escape') (e.preventDefault(), this._findClose());
      });
      this.replIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') (e.preventDefault(), this._replace(false));
        if (e.key === 'Escape') (e.preventDefault(), this._findClose());
      });
      this.findCase.addEventListener('change', () => this._findCount());
      return bar;
    }
    find(replace) {
      if (!this.cur) return;
      this.findBar.hidden = false;
      this.replRow.hidden = !replace;
      const sel = this.cm.getSelection();
      if (sel && !sel.includes('\n')) this.findIn.value = sel;
      this.findIn.focus();
      this.findIn.select();
      this._findCount();
      this.cm.refresh();
    }
    _findClose() {
      this.findBar.hidden = true;
      this.cm.focus();
      this.cm.refresh();
    }
    _query() {
      const q = this.findIn.value;
      return q ? q : null;
    }
    _findCount() {
      const q = this._query();
      if (!q) return (this.findInfo.textContent = '');
      let n = 0;
      const cur = this.cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: !this.findCase.checked });
      while (cur.findNext() && n < 10000) n++;
      this.findInfo.textContent = n ? `${n} match${n === 1 ? '' : 'es'}` : 'No matches';
    }
    findNext(dir) {
      const q = this._query();
      if (!q) return this.find(false);
      const fold = !this.findCase.checked;
      let cur = this.cm.getSearchCursor(q, dir > 0 ? this.cm.getCursor('to') : this.cm.getCursor('from'), { caseFold: fold });
      let found = dir > 0 ? cur.findNext() : cur.findPrevious();
      if (!found) {
        cur = this.cm.getSearchCursor(q, dir > 0 ? { line: 0, ch: 0 } : { line: this.cm.lineCount(), ch: 0 }, { caseFold: fold });
        found = dir > 0 ? cur.findNext() : cur.findPrevious();
      }
      if (found) {
        this.cm.setSelection(cur.from(), cur.to());
        this.cm.scrollIntoView({ from: cur.from(), to: cur.to() }, 60);
      }
    }
    _replace(all) {
      const q = this._query();
      if (!q) return;
      const fold = !this.findCase.checked;
      const rep = this.replIn.value;
      if (all) {
        let n = 0;
        this.cm.operation(() => {
          const cur = this.cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: fold });
          while (cur.findNext()) {
            cur.replace(rep);
            n++;
          }
        });
        this._status(`${n} occurrence${n === 1 ? ' was' : 's were'} replaced.`, 3000);
        return this._findCount();
      }
      const sel = this.cm.getSelection();
      if (sel && (fold ? sel.toLowerCase() === q.toLowerCase() : sel === q)) this.cm.replaceSelection(rep);
      this.findNext(1);
      this._findCount();
    }
    async gotoLine() {
      if (!this.cur) return;
      const v = await MG.promptText('Go to line', `Line number (1 to ${this.cm.lineCount()}):`, String(this.cm.getCursor().line + 1), 'Go');
      const n = parseInt(v, 10);
      if (!n) return;
      this.cm.setCursor({ line: Math.max(0, Math.min(this.cm.lineCount() - 1, n - 1)), ch: 0 });
      this.cm.scrollIntoView(null, 100);
      this.cm.focus();
    }
    toggleComment() {
      if (!this.cur) return;
      // (Spyder comments with "# " at the indentation of the lines; a line that starts with # loses it)
      const cm = this.cm;
      const from = cm.getCursor('from').line, to0 = cm.getCursor('to');
      const to = to0.ch === 0 && to0.line > from ? to0.line - 1 : to0.line;
      const lines = [];
      for (let i = from; i <= to; i++) lines.push(cm.getLine(i));
      const code = lines.filter((l) => l.trim());
      const allc = code.length && code.every((l) => /^\s*#/.test(l));
      cm.operation(() => {
        for (let i = from; i <= to; i++) {
          const l = cm.getLine(i);
          if (!l.trim()) continue;
          if (allc) {
            const m = /^(\s*)# ?/.exec(l);
            cm.replaceRange(m[1], { line: i, ch: 0 }, { line: i, ch: m[0].length });
          } else {
            const ind = /^\s*/.exec(l)[0].length;
            cm.replaceRange('# ', { line: i, ch: ind });
          }
        }
      });
    }
    stripTrailing() {
      if (!this.cur) return;
      const cm = this.cm;
      cm.operation(() => {
        for (let i = 0; i < cm.lineCount(); i++) {
          const l = cm.getLine(i);
          const m = /[ \t]+$/.exec(l);
          if (m) cm.replaceRange('', { line: i, ch: m.index }, { line: i, ch: l.length });
        }
      });
    }
    fixIndentation() {
      if (!this.cur) return;
      const cm = this.cm;
      cm.operation(() => {
        for (let i = 0; i < cm.lineCount(); i++) {
          const l = cm.getLine(i);
          const m = /^[ \t]*\t[ \t]*/.exec(l);
          if (m) cm.replaceRange(m[0].replace(/\t/g, '    '), { line: i, ch: 0 }, { line: i, ch: m[0].length });
        }
      });
    }
    _tab(cm) {
      if (cm.somethingSelected()) return cm.execCommand('indentMore');
      const c = cm.getCursor();
      const before = cm.getLine(c.line).slice(0, c.ch);
      // (after a name or a dot: completion, as in Spyder; elsewhere four spaces)
      if (/[\w.]$/.test(before) && this.prefs.complete !== false) return this.complete(true);
      cm.replaceSelection('    ');
    }

    /* ---------------- completion and help in the editor (jedi, in the console's Python) ---------------- */
    _typed(ch) {
      if (this.prefs.complete === false || !this.cur || this.cur.mode !== 'python') return;
      clearTimeout(this._acT);
      const c = this.cm.getCursor();
      const before = this.cm.getLine(c.line).slice(0, c.ch);
      if (/#/.test(before.replace(/'[^']*'|"[^"]*"/g, ''))) return;
      if (ch === '.' && /[\w)\]]\.$/.test(before)) this._acT = setTimeout(() => this.complete(false), 250);
      else if (/^\w$/.test(ch) && /(^|[^\w.])[A-Za-z_]\w{2}$/.test(before)) this._acT = setTimeout(() => this.complete(false), 400);
    }
    async complete(explicit) {
      const d = this.cur;
      if (!d || !this.py || this.py.state !== 'ready' || this.py.busy) {
        if (explicit && this.py && this.py.busy) this._status('Completion waits until the console has finished running.', 3000);
        return;
      }
      const c = this.cm.getCursor();
      const items = await this.py.call('jedi_complete', d.cmDoc.getValue(), c.line + 1, c.ch, d.path || '');
      const now = this.cm.getCursor();
      if (!Array.isArray(items) || now.line !== c.line || now.ch !== c.ch || this.cur !== d) return;
      if (!items.length) {
        if (explicit) this._status('No completions here.', 2000);
        return;
      }
      const word = /[\w]*$/.exec(this.cm.getLine(c.line).slice(0, c.ch))[0];
      if (items.length === 1 && explicit) {
        this.cm.replaceRange(items[0].name, { line: c.line, ch: c.ch - word.length }, c);
        return;
      }
      this._popList(
        this.cm,
        items.map((it) => ({ text: it.name, type: it.type })),
        (it) => {
          const cc = this.cm.getCursor();
          const w = /[\w]*$/.exec(this.cm.getLine(cc.line).slice(0, cc.ch))[0];
          this.cm.replaceRange(it.text, { line: cc.line, ch: cc.ch - w.length }, cc);
          this.cm.focus();
        },
        word
      );
    }
    /** a list of completions under the cursor of a CodeMirror; Up, Down, Enter or Tab, Esc */
    _popList(cm, items, pick, word) {
      this._popClose();
      const box = h('div.sp-pop', { role: 'listbox' });
      let at = 0;
      const els = items.slice(0, 200).map((it, i) => {
        const el = h('div.sp-popi', { role: 'option' }, h('span.sp-popt.t-' + (it.type || 'x').replace(/\W/g, ''), (it.type || '').slice(0, 1) || '·'), h('span', it.text));
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this._popClose();
          pick(it);
        });
        box.appendChild(el);
        return el;
      });
      const mark = () => {
        els.forEach((e, i) => e.classList.toggle('on', i === at));
        if (els[at]) els[at].scrollIntoView({ block: 'nearest' });
      };
      mark();
      const pos = cm.cursorCoords(null, 'window');
      box.style.left = Math.max(4, Math.min(window.innerWidth - 320, pos.left)) + 'px';
      document.body.appendChild(box);
      const below = pos.bottom + 4 + box.offsetHeight < window.innerHeight;
      box.style.top = (below ? pos.bottom + 2 : pos.top - box.offsetHeight - 2) + 'px';
      const keys = {
        Up: () => ((at = (at + els.length - 1) % els.length), mark()),
        Down: () => ((at = (at + 1) % els.length), mark()),
        Enter: () => (this._popClose(), pick(items[at])),
        Tab: () => (this._popClose(), pick(items[at])),
        Esc: () => this._popClose(),
        PageUp: () => ((at = Math.max(0, at - 8)), mark()),
        PageDown: () => ((at = Math.min(els.length - 1, at + 8)), mark())
      };
      cm.addKeyMap(keys);
      this._popKeep = true;
      setTimeout(() => (this._popKeep = false), 50);
      this._pop = { box, cm, keys, word };
    }
    _popClose() {
      if (!this._pop) return;
      this._pop.cm.removeKeyMap(this._pop.keys);
      this._pop.box.remove();
      this._pop = null;
    }
    /** the dotted name at a position of a line (np.linalg.norm) */
    _nameAt(line, ch) {
      let a = ch, b = ch;
      while (a > 0 && /[\w.]/.test(line[a - 1])) a--;
      while (b < line.length && /\w/.test(line[b])) b++;
      return line.slice(a, b).replace(/^\.+|\.+$/g, '');
    }
    async helpAtCursor() {
      const d = this.cur;
      if (!d) return;
      const c = this.cm.getCursor();
      const name = this._nameAt(this.cm.getLine(c.line), c.ch);
      if (!name) return;
      if (this.showHelp) this.showHelp(name, { source: 'editor', code: d.cmDoc.getValue(), line: c.line + 1, ch: c.ch, path: d.path || '' });
    }
    async gotoDefinition() {
      const d = this.cur;
      if (!d || !this.py || this.py.state !== 'ready' || this.py.busy) return;
      const c = this.cm.getCursor();
      const r = await this.py.call('jedi_goto', d.cmDoc.getValue(), c.line + 1, c.ch, d.path || '');
      const g = Array.isArray(r) && r[0];
      if (!g || !g.line) return this._status('No definition was found.', 3000);
      if (!g.path || g.path === d.path || g.path === 'None') {
        this.cm.setCursor({ line: g.line - 1, ch: g.col || 0 });
        this.cm.scrollIntoView(null, 100);
      } else if (g.path.startsWith(MG.app.HOME + '/') && this.fs.exists(g.path)) this.openFile(g.path, { line: g.line, ch: g.col || 0 });
      else this._status(`${g.name} is defined in ${g.path}, line ${g.line} (outside your files).`, 6000);
    }

    /* ---------------- code analysis (Python's own check, and pyflakes if it is there) ---------------- */
    lintSoon(ms = 900) {
      clearTimeout(this._lintT);
      this._lintT = setTimeout(() => this.lintNow(false), ms);
    }
    async lintNow(explicit) {
      const d = this.cur;
      if (!d || d.mode !== 'python' || !this.prefs.lint) return;
      if (!this.py || this.py.state !== 'ready' || this.py.busy) {
        if (explicit) this._status('Code analysis waits until the console is ready.', 3000);
        return;
      }
      const text = d.cmDoc.getValue();
      const r = await this.py.call('lint', text, d.path || '');
      if (!Array.isArray(r) || this.cur !== d || d.cmDoc.getValue() !== text) return;
      this._clearLint(d);
      for (const w of r) {
        const line = Math.max(0, Math.min(d.cmDoc.lineCount() - 1, (w.line || 1) - 1));
        const info = this.cm.lineInfo(line);
        const prev = info && info.gutterMarkers && info.gutterMarkers['sp-lint'];
        const msgs = (prev ? prev.title + '\n' : '') + (w.level === 'error' ? 'Error: ' : 'Warning: ') + w.msg;
        const el = h('span.sp-lintmark.' + (w.level === 'error' || (prev && prev.classList.contains('error')) ? 'error' : 'warning'), { title: msgs }, w.level === 'error' ? '●' : '▲');
        this.cm.setGutterMarker(line, 'sp-lint', el);
        const lt = d.cmDoc.getLine(line) || '';
        const from = Math.min(w.col || 0, Math.max(0, lt.length - 1));
        let to = from;
        while (to < lt.length && /\w/.test(lt[to])) to++;
        d.lint.push({ line, msg: w.msg, level: w.level, mark: d.cmDoc.markText({ line, ch: from }, { line, ch: Math.max(to, from + 1) }, { className: 'sp-lint-' + w.level, title: w.msg }) });
      }
      if (explicit) this._status(r.length ? `Code analysis: ${r.length} warning${r.length === 1 ? '' : 's'} or error${r.length === 1 ? '' : 's'}.` : 'Code analysis: no warnings.', 4000);
      bus.emit('spyder:lint', { path: d.path, count: r.length });
    }
    _clearLint(d) {
      this._clearGutter(d, 'sp-lint');
      for (const w of d.lint || []) w.mark.clear();
      d.lint = [];
    }
    nextWarning(dir) {
      const d = this.cur;
      if (!d || !d.lint.length) return this._status('There are no warnings in this file.', 2500);
      const lines = [...new Set(d.lint.map((w) => w.line))].sort((a, b) => a - b);
      const at = this.cm.getCursor().line;
      const n = dir > 0 ? lines.find((l) => l > at) ?? lines[0] : [...lines].reverse().find((l) => l < at) ?? lines[lines.length - 1];
      this.cm.setCursor({ line: n, ch: 0 });
      this.cm.scrollIntoView(null, 100);
      const w = d.lint.find((x) => x.line === n);
      if (w) this._status(w.msg, 5000);
    }

    /* ================= the IPython console ================= */
    _buildConsole() {
      const P = this.panes.console;
      this.conTab = h('span.sp-contab.on', h('span', 'Console 1/A'));
      this.stopBtn = this._ptb('stop', 'Interrupt kernel (Ctrl+C)', () => this.interrupt(), 'red');
      this.stopBtn.disabled = true;
      const bar = h('div.sp-pbar.sp-conbar', this.conTab, h('span.sp-tgrow'), this.stopBtn);
      const opt = this._ptb('menu', 'Options', () =>
        spMenu(
          opt,
          [
            ['Interrupt kernel', () => this.interrupt(), { disabled: !this.running }],
            ['Restart kernel', () => this.restartKernel(true), { key: 'Ctrl+.' }],
            '-',
            ['Remove all variables', () => this.removeAllVariables()],
            ['Clear console', () => this.clearConsole(), { key: 'Ctrl+L' }],
            '-',
            ['Mute inline plotting', () => this.setPref('muteInline', !this.prefs.muteInline), { checked: !!this.prefs.muteInline }]
          ],
          this.root
        )
      );
      bar.appendChild(opt);
      this.conOut = h('div.sp-conout', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Console output' });
      this.conIn = h('div.sp-conin');
      this.conScroll = h('div.sp-conscroll', this.conOut, this.conIn);
      P.el.append(bar, this.conScroll);
      this.conScroll.addEventListener('mouseup', () => {
        const s = window.getSelection();
        if ((!s || !String(s)) && !this.conIn.hidden) this.focusConsole();
      });
      const keys = {
        Enter: (cm) => this._conEnter(cm, false),
        'Shift-Enter': (cm) => this._conEnter(cm, true),
        'Ctrl-Enter': (cm) => cm.execCommand('newlineAndIndent'),
        Up: (cm) => this._conHist(cm, -1),
        Down: (cm) => this._conHist(cm, 1),
        Tab: (cm) => this._conTab(cm),
        'Shift-Tab': 'indentLess',
        'Ctrl-C': (cm) => (cm.somethingSelected() ? window.CodeMirror.Pass : this.interrupt()),
        'Cmd-C': () => window.CodeMirror.Pass,
        'Ctrl-L': () => this.clearConsole(),
        'Ctrl-.': () => this.restartKernel(true),
        'Ctrl-I': (cm) => this._conHelp(cm),
        Esc: (cm) => (this._pop ? this._popClose() : cm.setValue(''))
      };
      this.ccm = window.CodeMirror(this.conIn, {
        value: '',
        mode: 'python',
        lineNumbers: true,
        lineNumberFormatter: (n) => this._promptFor(n),
        indentUnit: 4,
        tabSize: 4,
        matchBrackets: true,
        autoCloseBrackets: false,
        lineWrapping: true,
        viewportMargin: Infinity,
        extraKeys: keys,
        screenReaderLabel: 'Console input'
      });
      this.ccm.on('change', () => this._sizeConsole());
      this.conIn.hidden = true;
      this.conHistory = store.get('spHistory', []) || [];
      this.sessionStart = this.conHistory.length;
      this.sessionTime = new Date();
      this.conPrompt = { kind: 'in', n: 1 };
      this.dbgHistory = [];
    }
    _promptFor(n) {
      const p = this.conPrompt || { kind: 'in', n: 1 };
      const first = p.kind === 'in' ? `In [${p.n}]:` : p.kind === 'pdb' ? p.text.trimEnd() : '';
      if (n === 1) return first;
      return '...:'.padStart(first.length);
    }
    _sizeConsole() {
      if (!this.ccm) return;
      this.ccm.refresh();
    }
    focusConsole() {
      if (!this.conIn.hidden) this.ccm.focus();
      else if (this._inputField) this._inputField.focus();
    }
    _scrollDown() {
      const S = this.conScroll;
      if (S.scrollHeight - S.scrollTop - S.clientHeight < 400 || this._stick) S.scrollTop = S.scrollHeight;
    }
    /** text into the console: cls 'out' | 'err' | 'note' */
    _write(text, cls) {
      if (!text) return;
      const last = this.conOut.lastElementChild;
      if (last && last.dataset.cls === (cls || 'out') && last.tagName === 'PRE' && !last.dataset.closed) last.insertAdjacentHTML('beforeend', ansiHtml(text));
      else {
        const pre = h('pre.sp-o.' + (cls || 'out'), { dataset: { cls: cls || 'out' } });
        pre.innerHTML = ansiHtml(text);
        this.conOut.appendChild(pre);
      }
      this._trimConsole();
      this._scrollDown();
    }
    _block(el) {
      const last = this.conOut.lastElementChild;
      if (last) last.dataset.closed = '1';
      this.conOut.appendChild(el);
      this._trimConsole();
      this._scrollDown();
    }
    _trimConsole() {
      // (a console keeps the last 2,000 pieces of output)
      while (this.conOut.childElementCount > 2000) this.conOut.firstElementChild.remove();
    }
    /** the end of the console as text – the commands after their prompts and what they printed – for the AI
        assistant. The banner, the figures and the buttons are left out. */
    consoleText(max) {
      const out = [];
      for (const el of this.conOut.children) {
        const c = el.classList;
        if (c.contains('sp-banner') || c.contains('sp-askrow') || c.contains('sp-kstatus')) continue;
        if (c.contains('sp-in')) out.push(Array.from(el.children, (r) => r.textContent).join('\n') + '\n');
        else if (c.contains('sp-img')) out.push('[a figure]\n');
        else if (c.contains('sp-blank')) out.push('\n');
        else out.push(el.textContent);
      }
      const t = out.join('').replace(/\n{3,}/g, '\n\n').trim();
      return max && t.length > max ? t.slice(-max) : t;
    }
    /** the end of the output is a blank line (IPython leaves one before each prompt) */
    _blankLine() {
      const t = this.conOut.lastElementChild;
      if (!t) return;
      if (t.classList.contains('sp-blank')) return;
      const txt = t.textContent || '';
      if (t.tagName === 'PRE' && /\n\n$/.test(txt)) return;
      if (t.tagName === 'PRE' && !/\n$/.test(txt)) t.insertAdjacentText('beforeend', '\n');
      this._block(h('div.sp-blank'));
    }
    /** code as it was typed after its prompt: In [3]: …, highlighted */
    _echo(code, prompt) {
      const lines = code.split('\n');
      const first = prompt || `In [${this.count}]:`;
      const box = h('div.sp-in');
      lines.forEach((l, i) => {
        const row = h('div.sp-inl');
        row.appendChild(h('span.sp-prompt' + (prompt && /^IPdb/.test(prompt) ? '.pdb' : ''), (i === 0 ? first : '...:'.padStart(first.length)) + ' '));
        const code1 = h('span.sp-incode.cm-s-default');
        if (window.CodeMirror.runMode) window.CodeMirror.runMode(l, 'python', code1);
        else code1.textContent = l;
        row.appendChild(code1);
        box.appendChild(row);
      });
      this._block(box);
    }
    _showPrompt() {
      this.conPrompt = { kind: 'in', n: this.count };
      this._blankLine();
      this.conIn.hidden = false;
      this.ccm.setOption('lineNumberFormatter', (n) => this._promptFor(n));
      this.ccm.refresh();
      this._scrollDown();
      this.conScroll.scrollTop = this.conScroll.scrollHeight;
    }

    /* ---------------- the kernel ---------------- */
    startKernel() {
      if (!this.py) {
        this.py = new MG.IDEPython({ ideOpts: this._ideOpts() });
        bus.on('kernel:state', (d) => d.lang === 'spyder' && this._kernelState(d));
        bus.on('kernel:status', (d) => d.lang === 'spyder' && d.text && this._kstatus(d.text, d.bad));
      }
      this.conIn.hidden = true;
      this.starting = true;
      this._kstatusEl = h('div.sp-kstatus', h('span.sp-spin'), h('span', 'Starting the Python console…'));
      this._block(this._kstatusEl);
      this.py.ensure().then(
        (v) => this._kernelReady(v),
        (e) => {
          if (/restarted/.test(String(e && e.message))) return;
          this._kstatusDone();
          this._write(`The Python console could not start: ${(e && e.message) || e}\nCheck your internet connection, then restart the kernel (Ctrl+.) or reload the page.\n`, 'err');
        }
      );
    }
    _ideOpts() {
      return { dark: this.prefs.theme !== 'light', mute_inline: !!this.prefs.muteInline };
    }
    _kstatus(text, bad) {
      if (!this._kstatusEl) return;
      this._kstatusEl.lastChild.textContent = text;
      this._kstatusEl.classList.toggle('bad', !!bad);
    }
    _kstatusDone() {
      if (this._kstatusEl) this._kstatusEl.remove();
      this._kstatusEl = null;
    }
    _kernelState(d) {
      if (d.state === 'failed' && !this.starting) this._write(`\nThe kernel died: ${d.message || 'Python stopped'}.\nRestart it with Consoles > Restart kernel (Ctrl+.).\n`, 'err');
    }
    _kernelReady(v) {
      this.starting = false;
      this._kstatusDone();
      const ide = (v && v.ide) || {};
      const py = (v && v.python) || '3';
      this.versions = v;
      this.stEnv.textContent = `Python ${py} (Pyodide ${(v && v.pyodide) || ''})`;
      const banner = `Python ${py} (Pyodide ${(v && v.pyodide) || ''}, running in your web browser)\nType "copyright", "credits" or "license" for more information.\n\nIPython ${ide.ipython || ''} -- An enhanced Interactive Python. Type '?' for help.\n`;
      // (a block of its own, which consoleText leaves out)
      this._block(h('pre.sp-o.out.sp-banner', banner));
      if (!this.py.canAsk) this._write("\nThis page is not cross-origin isolated, so input() and the debugger cannot wait for what you type here. Everything else works.\n", 'note');
      this.count = ide.count || 1;
      // (after a restart the console goes back to the folder it was in)
      const want = this.cwd;
      if (ide.cwd) this._setCwdShown(ide.cwd);
      if (want && ide.cwd && want !== ide.cwd && this.fs.isDir(want)) this.setCwd(want, true);
      this._showPrompt();
      if (this.refreshVars) this.refreshVars();
      if (this.prefs.lint) this.lintSoon(300);
      bus.emit('spyder:ready', { python: py });
      if (this._queued && this._queued.length) {
        const q = this._queued;
        this._queued = [];
        for (const [code, opts] of q) this.execute(code, opts);
      }
    }
    _kernelSettings() {
      if (this.py && this.py.state === 'ready') this.py.call('settings', { dark: this.prefs.theme !== 'light', mute_inline: !!this.prefs.muteInline });
    }
    async restartKernel(ask) {
      if (ask && !(await MG.confirmBox('Restart kernel', '<p>Do you want to restart the kernel? Python will start again, and all the variables in the console will be lost. Your files are not affected.</p>', 'Restart'))) return;
      if (this.debugging) this._debugEnd();
      this._inputDone();
      this.running = null;
      this.runQueue = [];
      this._blankLine();
      this._write('Restarting kernel...\n', 'note');
      this._block(h('div.sp-blank'));
      this.conIn.hidden = true;
      this.stopBtn.disabled = true;
      this.py.ideOpts = this._ideOpts();
      this.py.restart();
      this.startKernel();
      if (this._clearVars) this._clearVars();
      bus.emit('spyder:restart', {});
    }
    interrupt() {
      if (!this.py) return;
      if (this._inputField && this.py.waiting) {
        this.py.interrupt();
        return;
      }
      if (!this.running) return;
      if (this.py.interrupt()) return this._status('Interrupting the kernel…', 2000);
      MG.confirmBox(
        'Interrupt kernel',
        "<p>Python can't be interrupted in this browser, because the page is not cross-origin isolated. Restarting the kernel stops what it is doing, but all the variables in the console are lost too.</p>",
        'Restart kernel',
        { danger: true }
      ).then((ok) => ok && this.restartKernel(false));
    }
    clearConsole() {
      this.conOut.innerHTML = '';
      if (!this.conIn.hidden) this.ccm.focus();
    }
    async removeAllVariables() {
      if (!this.py || this.py.state !== 'ready') return;
      if (!(await MG.confirmBox('Remove all variables', '<p>All user-defined variables will be removed. Are you sure you want to proceed?</p>', 'Yes', { danger: true }))) return;
      if (this.running) return toast('Wait until the console has finished running.', 'warn');
      await this.py.call('reset_namespace');
      if (this.refreshVars) this.refreshVars();
      bus.emit('spyder:reset', {});
    }
    setCwd(p, quiet) {
      const fs = this.fs;
      const abs = fs.resolve(String(p || '').replace(/^~(?=\/|$)/, MG.app.HOME));
      if (!fs.isDir(abs)) {
        if (!quiet) toast(`There is no folder ${esc(p)}.`, 'warn');
        this.wdIn.value = this.cwd;
        return;
      }
      // (as Spyder does, silently: the console's working directory changes without a command in the console)
      const code = `import os as _os\n_os.chdir(${JSON.stringify(abs)})\ndel _os`;
      if (this.py && this.py.state === 'ready' && !this.running) this.py.exec(code, {}, { silent: true }).then((r) => r && r.cwd && this._setCwdShown(r.cwd));
      else this._setCwdShown(abs);
    }
    async chooseCwd() {
      const p = await this.fileDialog({ title: 'Select directory', mode: 'dir', dir: this.cwd });
      if (p) this.setCwd(p);
    }
    _setCwdShown(cwd) {
      if (!cwd) return;
      const changed = cwd !== this.cwd;
      this.cwd = cwd;
      this.wdIn.value = cwd;
      if (changed && this._cwdChanged) this._cwdChanged();
    }

    /* ---------------- running code in the console ---------------- */
    /** code into the console: shown after its prompt, then run. opts: {scan, cells, debug, silent} */
    execute(code, opts = {}) {
      if (!this.py || this.starting) {
        this._queued = (this._queued || []).concat([[code, opts]]);
        return;
      }
      if (this.running) {
        this.runQueue = (this.runQueue || []).concat([[code, opts]]);
        return;
      }
      this.showPane('console');
      this._run(code, opts);
    }
    async _run(code, opts = {}) {
      this._popClose();
      this.conIn.hidden = true;
      this._echo(code);
      if (code.trim()) this._addHistory(code);
      // (what is running: the command in the console, and – for the AI assistant, if it fails – the code that it ran:
      // a whole file for %runfile, one cell of it for %runcell)
      const cell = opts.cells && opts.cells[0] ? opts.cells[0] : null;
      this.running = { code, scan: opts.scan != null ? opts.scan : code, file: opts.file || (cell ? cell.path : null), cell };
      this.stopBtn.disabled = false;
      this._stick = true;
      const extra = {};
      if (opts.cells) extra.cells = opts.cells.map((c) => ({ path: c.path, index: c.index, code: c.code, first: c.first, text: c.text }));
      extra.breakpoints = this._allBreakpoints();
      const t0 = performance.now();
      let r = null;
      try {
        if (opts.clear) await this.py.exec('%reset -f', {}, { silent: true });
        r = await this.py.exec(code, { onOutput: (o) => this._out(o), onInput: (m) => this._askInput(m) }, { scan: opts.scan != null ? opts.scan : code, extra });
      } catch (e) {
        if (!/restarted/.test(String(e && e.message))) this._write(`${(e && e.message) || e}\n`, 'err');
      }
      this._inputDone();
      if (this.debugging) this._debugEnd();
      this.running = null;
      this._stick = false;
      this.stopBtn.disabled = true;
      if (!r) return;
      this.count = r.count || this.count + 1;
      if (r.cwd) this._setCwdShown(r.cwd);
      this._showPrompt();
      if (this.refreshVars) this.refreshVars();
      if (this._historyRender) this._historyRender();
      bus.emit('spyder:executed', { code, ok: !!r.ok, secs: (performance.now() - t0) / 1000 });
      const next = (this.runQueue || []).shift();
      if (next) this._run(next[0], next[1]);
      else if (document.activeElement === document.body || (document.activeElement && this.conScroll.contains(document.activeElement))) this.focusConsole();
      if (this.prefs.lint) this.lintSoon(500);
    }
    _out(o) {
      if (o.type === 'stream') this._write(o.text, o.name === 'stderr' ? 'err' : 'out');
      else if (o.type === 'result') {
        const multi = /\n/.test(o.text);
        const box = h('pre.sp-o.out.sp-result');
        box.innerHTML = `<span class="sp-outprompt">Out[${o.n}]:</span>${multi ? '\n' : ' '}${ansiHtml(o.text)}`;
        this._block(box);
        if (o.png) this._block(h('div.sp-img', h('img', { src: 'data:image/png;base64,' + o.png, alt: 'Out[' + o.n + ']' })));
        this._block(h('div.sp-blank'));
      } else if (o.type === 'error') {
        this._block(h('pre.sp-o.tb', { html: ansiHtml(o.text.replace(/\n+$/, '')) + '\n' }));
        this._askLink(o);
        bus.emit('spyder:error', { ename: o.ename, evalue: o.evalue });
      } else if (o.type === 'display') {
        const dd = o.data || {};
        if (o.plot) {
          if (this._addPlot) this._addPlot(dd['image/png'], o);
          if (this.prefs.muteInline) return;
        }
        if (dd['image/png']) this._block(h('div.sp-img', h('img', { src: 'data:image/png;base64,' + dd['image/png'], alt: 'Figure' })));
        else if (dd['image/jpeg']) this._block(h('div.sp-img', h('img', { src: 'data:image/jpeg;base64,' + dd['image/jpeg'], alt: 'Figure' })));
        else if (dd['image/svg+xml']) this._block(h('div.sp-img', h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(dd['image/svg+xml']), alt: 'Figure' })));
        else if (dd['text/plain'] != null) this._write(String(dd['text/plain']) + '\n', 'out');
      } else if (o.type === 'debug') this._debugAt(o);
      else if (o.type === 'debug-end') this._debugEnd();
      else if (o.type === 'cwd') this._setCwdShown(o.cwd);
      else if (o.type === 'clear') this.clearConsole();
      else if (o.type === 'next-input') setTimeout(() => this.ccm.setValue(o.text || ''), 50);
      else if (o.type === 'exit') setTimeout(() => this.restartKernel(false), 50);
    }
    /** a button under an error that sends it to the AI assistant */
    _askLink(o) {
      if (!MG.Assistant) return;
      const run = this.running || { code: '' };
      // kind: 'file' (Run file, Debug file), 'cell' (Run cell) or 'console' (typed in the console, or F9)
      const kind = run.cell ? 'cell' : run.file ? 'file' : 'console';
      const ask = {
        where: 'spyder',
        kind,
        code: kind === 'console' ? run.code : run.scan,
        command: run.code,
        file: run.file || null,
        cell: run.cell ? { index: run.cell.index, first: run.cell.first, name: run.cell.name || '' } : null,
        error: stripAnsi(o.text).trim().slice(-2500),
        ename: o.ename,
        evalue: o.evalue,
        cwd: o.cwd || this.cwd
      };
      const b = h('button.sp-ask', { type: 'button', title: 'Send the code and its error message to the AI assistant' }, '✦ Ask the AI assistant about this error');
      b.addEventListener('click', () => {
        b.disabled = true;
        bus.emit('py:ask', ask);
      });
      this._block(h('div.sp-askrow', b));
    }

    /* ---------------- input() and the debugger's prompt ---------------- */
    _askInput(m) {
      const pdb = /^IPdb \[\d+\]:\s*$/.test(m.prompt || '');
      if (pdb) {
        // the debugger's prompt: the console's input, with its own history
        this.conPrompt = { kind: 'pdb', text: m.prompt };
        this.ccm.setOption('lineNumberFormatter', (n) => this._promptFor(n));
        this._blankLineIf();
        this.conIn.hidden = false;
        this.ccm.setValue('');
        this.ccm.refresh();
        this.stopBtn.disabled = false;
        this._scrollDown();
        if (!this._dbgFocusHold) this.ccm.focus();
        return;
      }
      // input(): a line to type in, after the question
      const line = h('div.sp-inputline');
      const q = h('span.sp-o.out', m.prompt || '');
      const inp = h('input.sp-inputfield', { type: m.password ? 'password' : 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': m.prompt || 'Input' });
      line.append(q, inp);
      this._block(line);
      this._inputField = inp;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = inp.value;
          line.replaceChildren(h('span.sp-o.out', (m.prompt || '') + (m.password ? '' : v)));
          this._inputField = null;
          this.py.answer(v);
          bus.emit('spyder:input', { prompt: m.prompt });
        } else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey) && !inp.selectionEnd) {
          e.preventDefault();
          this.interrupt();
        }
      });
      setTimeout(() => inp.focus(), 20);
    }
    _blankLineIf() {
      const t = this.conOut.lastElementChild;
      if (t && t.tagName === 'PRE' && !/\n$/.test(t.textContent || '')) t.insertAdjacentText('beforeend', '\n');
    }
    _inputDone() {
      if (this._inputField) {
        this._inputField.disabled = true;
        this._inputField = null;
      }
      this.conPrompt = { kind: 'in', n: this.count };
    }
    /** an answer to the debugger's prompt (from the console, F9 or the toolbar) */
    consoleAnswer(text) {
      if (!this.py || !this.py.waiting) return;
      const prompt = this.conPrompt && this.conPrompt.kind === 'pdb' ? this.conPrompt.text.trimEnd() : '';
      this.conIn.hidden = true;
      this._echo(text, prompt);
      if (text.trim()) {
        this.dbgHistory.push(text);
        this._addHistory(text);
      }
      // (breakpoints set or cleared while the debugger waited go to it with the command)
      if (this._bpDirty) {
        this._bpDirty = false;
        return this.py.answer('\u0001bp:' + JSON.stringify(this._allBreakpoints()) + '\u0001' + text);
      }
      this.py.answer(text);
    }

    /* ---------------- the console's keys ---------------- */
    _conEnter(cm, force) {
      const code = cm.getValue();
      if (this.conPrompt.kind === 'pdb') {
        cm.setValue('');
        this._hIdx = null;
        return this.consoleAnswer(code);
      }
      const c = cm.getCursor();
      const atEnd = c.line === cm.lastLine() && c.ch === cm.getLine(c.line).length;
      if (!force && (!atEnd || incomplete(code))) return cm.execCommand('newlineAndIndent');
      if (!code.trim() && !force) {
        // (an empty line: a new prompt, as IPython gives)
        this._echo('');
        return;
      }
      cm.setValue('');
      this._hIdx = null;
      this.execute(code.replace(/\s+$/, ''), {});
    }
    _addHistory(code) {
      const H = this.conHistory;
      if (H[H.length - 1] !== code) H.push(code);
      while (H.length > 1000) {
        H.shift();
        this.sessionStart = Math.max(0, this.sessionStart - 1);
      }
      store.set('spHistory', H);
    }
    _conHist(cm, dir) {
      const c = cm.getCursor();
      if (dir < 0 && c.line > 0) return window.CodeMirror.Pass;
      if (dir > 0 && c.line < cm.lastLine()) return window.CodeMirror.Pass;
      const H = this.conPrompt.kind === 'pdb' ? this.dbgHistory : this.conHistory;
      if (!H.length) return;
      if (this._hIdx == null) {
        if (dir > 0) return;
        this._hDraft = cm.getValue();
        this._hIdx = H.length;
      }
      // (what was typed before ↑ selects the commands that start with it, as IPython does)
      const pre = this._hDraft || '';
      let i = this._hIdx;
      do i += dir;
      while (i >= 0 && i < H.length && pre && !H[i].startsWith(pre));
      if (i < 0) return;
      if (i >= H.length) {
        this._hIdx = null;
        cm.setValue(this._hDraft || '');
      } else {
        this._hIdx = i;
        cm.setValue(H[i]);
      }
      cm.setCursor(dir < 0 ? { line: 0, ch: cm.getLine(0).length } : { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length });
    }
    async _conTab(cm) {
      const c = cm.getCursor();
      const before = cm.getLine(c.line).slice(0, c.ch);
      if (!before.trim()) return cm.replaceSelection('    ');
      if (!this.py || this.py.state !== 'ready' || this.running) return;
      const code = cm.getValue();
      const pos = cm.indexFromPos(c);
      const r = await this.py.call('complete', code, pos);
      if (!r || !r.items || !r.items.length || cm.getValue() !== code) return;
      const from = cm.posFromIndex(r.start), to = cm.posFromIndex(r.end);
      const put = (text) => cm.replaceRange(text, from, to);
      if (r.items.length === 1) return put(r.items[0].text);
      // (the longest beginning that all the completions share is filled in at once)
      let common = r.items[0].text;
      for (const it of r.items) while (!it.text.startsWith(common)) common = common.slice(0, -1);
      if (common.length > r.end - r.start) put(common);
      this._popList(
        cm,
        r.items.map((it) => ({ text: it.text, type: it.type })),
        (it) => {
          const now = cm.getValue();
          const a = cm.posFromIndex(r.start);
          const b = cm.posFromIndex(r.start + (now.length - code.length) + (r.end - r.start));
          cm.replaceRange(it.text, a, b);
          cm.focus();
        },
        ''
      );
    }
    _conHelp(cm) {
      const c = cm.getCursor();
      const name = this._nameAt(cm.getLine(c.line), c.ch);
      if (name && this.showHelp) this.showHelp(name, { source: 'console' });
    }
    /** run code in the console as if it had been typed (help pages, the AI assistant) */
    consoleRun(code) {
      this.execute(code, {});
    }

    /* ================= dialogs ================= */
    /** choose a file or folder in the home folder → its path, or null. o: {title, mode 'open' | 'save' | 'dir', dir, name, filter} */
    fileDialog(o = {}) {
      return new Promise((resolve) => {
        const fs = this.fs;
        const HOME = MG.app.HOME;
        let dir = o.dir && fs.isDir(o.dir) && (o.dir === HOME || o.dir.startsWith(HOME + '/')) ? o.dir : HOME;
        let chosen = null;
        let done = false;
        const m = MG.modal(o.title || 'Open file', '', {
          onClose: () => {
            if (!done) {
              done = true;
              resolve(null);
            }
          }
        });
        m.box.classList.add('sp-dialog', 'sp-filedlg');
        const B = m.box.querySelector('.modal-b');
        const where = h('div.sp-fdwhere');
        const list = h('div.sp-fdlist', { role: 'listbox', 'aria-label': 'Files' });
        const nameIn = h('input', { type: 'text', value: o.name || '', 'aria-label': 'File name', spellcheck: 'false' });
        const okB = h('button.btn.primary', { type: 'button' }, o.mode === 'save' ? 'Save' : o.mode === 'dir' ? 'Choose' : 'Open');
        const cancel = h('button.btn', { type: 'button' }, 'Cancel');
        const newF = h('button.btn', { type: 'button' }, 'New folder');
        const finish = (p) => {
          if (done) return;
          done = true;
          m.close();
          resolve(p);
        };
        const render = () => {
          where.innerHTML = '';
          const up = h('button.sp-btn.small', { type: 'button', title: 'Parent folder', html: ic('up') });
          up.disabled = dir === HOME;
          up.addEventListener('click', () => ((dir = MG.path.dirname(dir)), render()));
          where.append(up, h('span.sp-fdpath', fs.pretty(dir) + (dir === HOME ? '/' : '')));
          list.innerHTML = '';
          const rows = fs.list(dir).filter((c) => !c.name.startsWith('.') && c.name !== '__pycache__');
          rows.sort((a, b) => ((a.entry.kind === 'dir') === (b.entry.kind === 'dir') ? a.name.localeCompare(b.name) : a.entry.kind === 'dir' ? -1 : 1));
          for (const c of rows) {
            const isDir = c.entry.kind === 'dir';
            const off = !isDir && (o.mode === 'dir' || (o.filter && o.mode !== 'save' && !o.filter.test(c.name)));
            const b = h('button.sp-fdrow' + (isDir ? '.dir' : '') + (off ? '.off' : '') + (c.path === chosen ? '.sel' : ''), { type: 'button', html: ic(isDir ? 'folder' : /\.py$/i.test(c.name) ? 'pyfile' : 'file') + `<span>${esc(c.name)}</span>` });
            if (off) b.disabled = true;
            b.addEventListener('click', () => {
              if (isDir) {
                dir = c.path;
                chosen = null;
                return render();
              }
              chosen = c.path;
              nameIn.value = c.name;
              list.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
              b.classList.add('sel');
            });
            b.addEventListener('dblclick', () => !isDir && o.mode !== 'dir' && finish(c.path));
            list.appendChild(b);
          }
          if (!rows.length) list.appendChild(h('div.sp-empty', 'This folder is empty.'));
        };
        okB.addEventListener('click', () => {
          if (o.mode === 'dir') return finish(dir);
          let n = nameIn.value.trim();
          if (o.mode === 'save') {
            if (!n) return nameIn.focus();
            if (!/\.[A-Za-z0-9]+$/.test(n)) n += '.py';
            return finish(fs.resolve(n.replace(/^\.\//, ''), dir));
          }
          if (chosen) return finish(chosen);
          if (n) {
            const p = fs.resolve(n, dir);
            if (fs.exists(p) && !fs.isDir(p)) return finish(p);
          }
          toast('Please choose a file from the list.', 'warn');
        });
        cancel.addEventListener('click', () => finish(null));
        newF.addEventListener('click', async () => {
          const n = await MG.promptText('New folder', 'The name of the new folder:', 'new_folder', 'Create');
          if (!n) return;
          fs.mkdirp(dir + '/' + n.replace(/[\/\\]/g, '_'));
          render();
        });
        nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && okB.click());
        B.append(where, list, o.mode === 'save' ? h('label.sp-fdname', h('span', 'File name:'), nameIn) : null, h('div.prompt-actions', newF, h('span.grow'), cancel, okB));
        render();
        setTimeout(() => (o.mode === 'save' ? (nameIn.focus(), nameIn.setSelectionRange(0, nameIn.value.replace(/\.[^.]*$/, '').length || nameIn.value.length)) : null), 40);
      });
    }
    async openDialog() {
      const p = await this.fileDialog({ title: 'Open file', mode: 'open', dir: this.cur && this.cur.path ? MG.path.dirname(this.cur.path) : this.cwd });
      if (p) this.openFile(p);
    }
    runConfigDialog() {
      const d = this.cur;
      if (!d || d.mode !== 'python') return toast('Open a Python file first.', 'warn');
      const path = this._pathOf(d);
      const c = this._conf(path);
      const m = MG.modal(`Run configuration: ${d.name}`, '');
      m.box.classList.add('sp-dialog', 'sp-prefs');
      const B = m.box.querySelector('.modal-b');
      const radio = (val, label) => {
        const i = h('input', { type: 'radio', name: 'spwd', value: val });
        i.checked = c.wdir === val;
        return h('label.sp-check', i, ' ', label);
      };
      const custom = h('input', { type: 'text', value: c.wdirPath, placeholder: '~/data', spellcheck: 'false', 'aria-label': 'Working directory' });
      const cb = (label, v) => {
        const i = h('input', { type: 'checkbox' });
        i.checked = v;
        return [h('label.sp-check', i, ' ', label), i];
      };
      const [l1, clear] = cb('Remove all variables before execution', c.clear);
      const [l2, ns] = cb("Run in console's namespace instead of an empty one", c.currentNs);
      const [l3, pm] = cb('Directly enter debugging when errors appear', c.postMortem);
      const args = h('input', { type: 'text', value: c.args, placeholder: 'e.g. data/genes.csv 10', spellcheck: 'false', 'aria-label': 'Command line options' });
      const ok = h('button.btn.primary', { type: 'button' }, 'OK');
      const cancel = h('button.btn', { type: 'button' }, 'Cancel');
      B.append(
        h('h4', 'Working directory settings'),
        radio('file', "The directory of the file being executed"),
        radio('cwd', "The current working directory"),
        h('div.sp-row', radio('custom', 'The following directory:'), custom),
        h('h4', 'General settings'),
        l1,
        l2,
        l3,
        h('label.sp-fdname', h('span', 'Command line options:'), args),
        h('p.sp-hint', 'These are what sys.argv gives the script, after its name.'),
        h('div.prompt-actions', cancel, ok)
      );
      cancel.addEventListener('click', () => m.close());
      ok.addEventListener('click', () => {
        const w = B.querySelector('input[name="spwd"]:checked');
        this.runConf[path] = { wdir: w ? w.value : 'file', wdirPath: custom.value.trim(), clear: clear.checked, currentNs: ns.checked, postMortem: pm.checked, args: args.value.trim() };
        store.set('spRunConf', this.runConf);
        m.close();
      });
    }
    prefsDialog() {
      const pf = this.prefs;
      const m = MG.modal('Preferences', '');
      m.box.classList.add('sp-dialog', 'sp-prefs');
      const B = m.box.querySelector('.modal-b');
      const boxes = [];
      const cb = (label, key) => {
        const i = h('input', { type: 'checkbox' });
        i.checked = !!pf[key];
        boxes.push([key, i]);
        return h('label.sp-check', i, ' ', label);
      };
      const theme = h('select', { 'aria-label': 'Interface theme' }, h('option', { value: 'dark', selected: pf.theme !== 'light' }, 'Dark'), h('option', { value: 'light', selected: pf.theme === 'light' }, 'Light'));
      const size = h('select', { 'aria-label': 'Font size' }, [11, 12, 13, 14, 15, 16, 18, 20].map((n) => h('option', { value: String(n), selected: (pf.fontSize || 13) === n }, String(n))));
      const ok = h('button.btn.primary', { type: 'button' }, 'OK');
      const cancel = h('button.btn', { type: 'button' }, 'Cancel');
      B.append(
        h('h4', 'Appearance'),
        h('label.sp-fdname', h('span', 'Interface theme:'), theme),
        h('label.sp-fdname', h('span', 'Font size of the editor and console:'), size),
        h('h4', 'Editor'),
        cb('Show line numbers', 'lineNumbers'),
        cb('Wrap lines', 'wrap'),
        cb('Automatically close brackets and quotes', 'autoClose'),
        cb('Show code analysis warnings (Python and pyflakes)', 'lint'),
        cb('Show completions automatically while typing', 'complete'),
        h('h4', 'Run'),
        cb('Save all files before running a script', 'saveBeforeRun'),
        cb('Remove all variables before execution', 'clearBefore'),
        cb("Run in console's namespace instead of an empty one", 'currentNs'),
        cb('Directly enter debugging when errors appear', 'postMortem'),
        h('p.sp-hint', 'Run > Configuration per file (Ctrl+F6) changes these for one file.'),
        h('h4', 'IPython console'),
        cb('Mute inline plotting (plots appear in the Plots pane only)', 'muteInline'),
        h('div.prompt-actions', cancel, ok)
      );
      cancel.addEventListener('click', () => m.close());
      ok.addEventListener('click', () => {
        for (const [k, i] of boxes) pf[k] = i.checked;
        pf.theme = theme.value;
        pf.fontSize = Number(size.value) || 13;
        this._savePrefs();
        this._applyPrefs();
        this._kernelSettings();
        m.close();
      });
    }
    shortcutsDialog() {
      const rows = [
        ['Run file', 'F5'],
        ['Run cell', 'Ctrl+Enter'],
        ['Run cell and advance', 'Shift+Enter'],
        ['Re-run last cell', 'Alt+Enter'],
        ['Run selection or current line', 'F9'],
        ['Debug file', 'Ctrl+F5'],
        ['Debug cell', 'Alt+Shift+Enter'],
        ['Step / Step into / Step return', 'Ctrl+F10 / Ctrl+F11 / Ctrl+Shift+F11'],
        ['Continue / Stop debugging', 'Ctrl+F12 / Ctrl+Shift+F12'],
        ['Set or clear a breakpoint', 'F12, or click left of the line number'],
        ['Help for the object at the cursor', 'Ctrl+I'],
        ['Code completion', 'Tab or Ctrl+Space'],
        ['Go to definition', 'Ctrl+G, or Ctrl+click'],
        ['Comment or uncomment lines', 'Ctrl+1'],
        ['Find / Replace', 'Ctrl+F / Ctrl+R'],
        ['Go to line', 'Ctrl+L (in the editor)'],
        ['Save / Save as / Save all', 'Ctrl+S / Ctrl+Shift+S / Ctrl+Alt+S'],
        ['Open a file', 'Ctrl+O'],
        ['Clear the console', 'Ctrl+L (in the console)'],
        ['Interrupt the kernel', 'Ctrl+C (in the console)'],
        ['Restart the kernel', 'Ctrl+.'],
        ['Maximise the current pane', 'Ctrl+Alt+Shift+M']
      ];
      MG.modal(
        'Keyboard shortcuts',
        `<table class="sp-keys"><tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td><kbd>${b.split(' / ').map(esc).join('</kbd> / <kbd>')}</kbd></td></tr>`).join('')}</tbody></table><p class="muted">Ctrl+N, Ctrl+T and Ctrl+W belong to the web browser (new window, new tab, close tab), so use the File menu or the toolbar for new files and closing them.</p>`
      ).box.classList.add('sp-dialog');
    }
    about() {
      const v = this.versions || {};
      MG.modal(
        'About this Spyder',
        `<p>This <b>Spyder</b>, in the IDE tab of the workbench, imitates the Spyder IDE so that it can be used for teaching. It is not Spyder itself, and it is not made or endorsed by the Spyder project.</p>
<p>Its console is real IPython${v.ide && v.ide.ipython ? ' ' + esc(v.ide.ipython) : ''}, running in Python ${esc(v.python || '3')} compiled to WebAssembly (Pyodide${v.pyodide ? ' ' + esc(v.pyodide) : ''}), inside your web browser. What you learn here about running files and cells, the Variable Explorer and the debugger carries over to Spyder on a computer.</p>
<p class="muted">Spyder itself is free and open-source software, licensed under the MIT licence. You can find it at spyder-ide.org.</p>`
      ).box.classList.add('sp-dialog');
    }
  }

  SpyderApp.prototype._menu = function (at, items) {
    return spMenu(at, items, this.root);
  };
  SpyderApp.ansiHtml = ansiHtml;
  SpyderApp.incomplete = incomplete;
  SpyderApp.ic = ic;
  MG.SpyderApp = SpyderApp;
  MG.Spyder = { ansiHtml, incomplete, ic, stripAnsi, qpath, template, menu: spMenu };
})();
