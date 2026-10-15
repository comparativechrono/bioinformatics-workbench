/* =====================================================================
   Spyder's panes besides the Editor and the IPython Console:

     Variable Explorer   the console's variables (or, while the debugger
                         has stopped, those of the function it is in);
                         a double click opens a viewer: data frames and
                         arrays as coloured tables, lists and dictionaries
                         as tables of their items, text in an editor
     Help                the documentation of an object (Ctrl+I)
     Plots               the figures that matplotlib drew
     Files               the working directory
     History             every command that ran in the console
     Debugger            where the debugger has stopped, and the
                         breakpoints
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast } = MG;
  const P = MG.SpyderApp.prototype;
  const { ic, stripAnsi } = MG.Spyder;

  P._buildPanes = function () {
    this._buildVars();
    this._buildHelp();
    this._buildPlots();
    this._buildFiles();
    this._buildHistory();
    this._buildDebugger();
  };
  P._paneShown = function (id) {
    if (id === 'vars' && this._varsStale) this.refreshVars();
    if (id === 'files') this.renderFiles();
    if (id === 'history') this._historyRender();
    if (id === 'plots') this._plotShow();
    if (id === 'debugger') this._renderDebugger();
  };

  /* ================= Variable Explorer ================= */
  const sizeText = (s) => (Array.isArray(s) ? '(' + s.join(', ') + (s.length === 1 ? ',' : '') + ')' : String(s));
  P._buildVars = function () {
    const id = 'vars';
    this.vSort = { key: 'name', dir: 1 };
    this.vSearch = h('input.sp-search', { type: 'search', placeholder: 'Search variable names and types', 'aria-label': 'Search variable names and types', spellcheck: 'false', hidden: true });
    this.vSearch.addEventListener('input', () => this._renderVars());
    this.vSearch.addEventListener('keydown', (e) => e.key === 'Escape' && ((this.vSearch.value = ''), (this.vSearch.hidden = true), this._renderVars()));
    const F = (key, label) => [label, () => this._varFilter(key), { checked: !!this.prefs.vars[key] }];
    this._paneBar(
      id,
      [
        this._ptb('trash', 'Remove all variables', () => this.removeAllVariables()),
        this._ptb('search', 'Search variable names and types', () => {
          this.vSearch.hidden = !this.vSearch.hidden;
          if (this.vSearch.hidden) {
            this.vSearch.value = '';
            this._renderVars();
          } else this.vSearch.focus();
        }),
        this._ptb('refresh', 'Refresh variables', () => this.refreshVars(true))
      ],
      () => [F('private', 'Exclude private variables'), F('uppercase', 'Exclude all-uppercase variables'), F('capitalized', 'Exclude capitalized variables'), F('unsupported', 'Exclude unsupported data types'), F('callables', 'Exclude callables and modules')]
    );
    const th = (key, label) => {
      const b = h('th', { scope: 'col' }, h('button.sp-vth', { type: 'button', dataset: { key } }, label));
      b.firstChild.addEventListener('click', () => {
        this.vSort = this.vSort.key === key ? { key, dir: -this.vSort.dir } : { key, dir: 1 };
        this._renderVars();
      });
      return b;
    };
    this.vHead = h('thead', h('tr', th('name', 'Name'), th('type', 'Type'), th('size', 'Size'), th('value', 'Value')));
    this.vBody = h('tbody');
    this.vTable = h('table.sp-vtable', { 'aria-label': 'Variables' }, this.vHead, this.vBody);
    this.vNote = h('div.sp-vnote', { hidden: true });
    this.vWrap = h('div.sp-vwrap', this.vTable);
    this.panes.vars.el.append(this.vSearch, this.vNote, this.vWrap);
    this.vars = [];
  };
  P._varFilter = function (key) {
    this.prefs.vars[key] = !this.prefs.vars[key];
    this._savePrefs();
    this.refreshVars(true);
  };
  P._clearVars = function () {
    this.vars = [];
    this._renderVars();
  };
  /** the console's variables, after each command (only when the pane is shown: else when it is next shown) */
  P.refreshVars = async function (force) {
    if (this.debugging) return this._debugVars(this.debugging.vars || []);
    if (!this.py || this.py.state !== 'ready') return this._clearVars();
    if (this.panes.vars.el.hidden && !force) {
      this._varsStale = true;
      return;
    }
    if (this.running && !force) return;
    this._varsStale = false;
    const r = await this.py.call('variables', this.prefs.vars);
    if (Array.isArray(r)) {
      this.vars = r;
      this.vFrame = null;
      this._renderVars();
      bus.emit('spyder:vars', { names: r.map((v) => v.name) });
    }
  };
  P._debugVars = function (vars) {
    this.vars = vars;
    this.vFrame = this.debugging ? this.debugging.func : null;
    this._renderVars();
  };
  P._renderVars = function () {
    const q = (this.vSearch.value || '').trim().toLowerCase();
    const { key, dir } = this.vSort;
    let rows = (this.vars || []).filter((v) => !q || v.name.toLowerCase().includes(q) || v.type.toLowerCase().includes(q));
    const val = (v) => (key === 'size' ? (Array.isArray(v.size) ? v.size.reduce((a, b) => a * b, 1) : v.size) : String(v[key]).toLowerCase());
    rows = rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    this.vHead.querySelectorAll('.sp-vth').forEach((b) => {
      b.classList.toggle('on', b.dataset.key === key);
      b.dataset.dir = b.dataset.key === key ? (dir > 0 ? '▲' : '▼') : '';
    });
    this.vBody.innerHTML = '';
    for (const v of rows) {
      const tr = h('tr.sp-vrow.c-' + v.color, { tabindex: '0', dataset: { name: v.name } }, h('td.n', v.name), h('td.t', v.type), h('td.s', sizeText(v.size)), h('td.v', { title: v.value.length > 60 ? v.value : '' }, v.value));
      tr.addEventListener('click', () => this._varSelect(tr));
      tr.addEventListener('dblclick', () => this.openVar([v.name], v, tr));
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._varSelect(tr);
        this._varMenu({ x: e.clientX, y: e.clientY }, v, tr);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.openVar([v.name], v, tr);
        else if (e.key === 'Delete') this._varRemove(v);
        else if (e.key === 'ArrowDown' && tr.nextSibling) (e.preventDefault(), tr.nextSibling.focus(), this._varSelect(tr.nextSibling));
        else if (e.key === 'ArrowUp' && tr.previousSibling) (e.preventDefault(), tr.previousSibling.focus(), this._varSelect(tr.previousSibling));
      });
      this.vBody.appendChild(tr);
    }
    this.vNote.hidden = !this.debugging;
    if (this.debugging) this.vNote.textContent = `The variables of ${this.debugging.func && this.debugging.func !== '<module>' ? this.debugging.func + '()' : 'the module'}, where the debugger has stopped.`;
  };
  P._varSelect = function (tr) {
    this.vBody.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    tr.classList.add('sel');
  };
  P._varMenu = function (at, v, tr) {
    const plain = ['number', 'bool', 'none', 'date', 'text'].includes(v.kind);
    const plottable = ['array', 'collection', 'series'].includes(v.kind);
    this._menu(at, [
      ['Edit', () => this.openVar([v.name], v, tr)],
      ['Plot', () => this._plotVar(v.name, 'plot'), { disabled: !plottable }],
      ['Histogram', () => this._plotVar(v.name, 'hist'), { disabled: !plottable }],
      ['Show image', () => this._plotVar(v.name, 'image'), { disabled: v.kind !== 'array' }],
      '-',
      ['Rename', () => this._varRename(v)],
      ['Remove', () => this._varRemove(v)],
      ['Duplicate', () => this._varDuplicate(v)],
      ['Copy value', () => this._varCopy(v), { disabled: !plain }],
      '-',
      ['Insert the name into the console', () => this._insertConsole(v.name)]
    ]);
  };
  P._busyNote = function () {
    if (this.running || (this.py && this.py.busy)) {
      toast('Wait until the console has finished running.', 'warn');
      return true;
    }
    return false;
  };
  P._varRemove = async function (v) {
    if (this._busyNote()) return;
    if (!(await MG.confirmBox('Remove', `<p>Do you want to remove the selected variable, <b>${esc(v.name)}</b>?</p>`, 'Yes', { danger: true }))) return;
    await this.py.call('remove', [v.name]);
    this.refreshVars(true);
  };
  P._varRename = async function (v) {
    if (this._busyNote()) return;
    const n = await MG.promptText('Rename', 'New variable name:', v.name, 'OK');
    if (!n || n === v.name) return;
    const r = await this.py.call('rename', v.name, n);
    if (r && r.error) return toast(esc(r.error), 'warn');
    this.refreshVars(true);
  };
  P._varDuplicate = async function (v) {
    if (this._busyNote()) return;
    const n = await MG.promptText('Duplicate', 'Variable name:', v.name + '_copy', 'OK');
    if (!n) return;
    const r = await this.py.call('duplicate', v.name, n);
    if (r && r.error) return toast(esc(r.error), 'warn');
    this.refreshVars(true);
  };
  P._varCopy = async function (v) {
    const ok = await MG.copyText(v.value);
    this._status(ok ? `The value of ${v.name} was copied.` : 'The value could not be copied.', 2500);
  };
  P._insertConsole = function (text) {
    this.showPane('console');
    if (this.conIn.hidden) return;
    this.ccm.replaceSelection(text);
    this.ccm.focus();
  };
  P._plotVar = async function (name, how) {
    if (this._busyNote()) return;
    await this.py.exec(`__import__('wb_ide').plot_var(${JSON.stringify(name)}, ${JSON.stringify(how)})`, { onOutput: (o) => o.type === 'display' && o.plot && this._addPlot(o.data['image/png'], o), onInput: () => this.py.interrupt() }, { silent: true, scan: 'import matplotlib' });
  };

  /** a variable opens: numbers in place, text in an editor, the rest in a viewer */
  P.openVar = async function (path, v, tr) {
    if (this._busyNote()) return;
    const kind = v ? v.kind : null;
    if (tr && ['number', 'bool', 'none', 'date'].includes(kind) && !this.debugging) return this._editInPlace(path, v, tr);
    const data = await this.py.call('view', path);
    if (!data || data.error) return toast(esc((data && data.error) || 'The variable could not be shown.'), 'warn');
    this._viewer(path, data);
  };
  P._editInPlace = function (path, v, tr) {
    const td = tr.querySelector('td.v');
    const inp = h('input.sp-vedit', { type: 'text', value: v.value, spellcheck: 'false', 'aria-label': 'New value of ' + v.name });
    td.replaceChildren(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      if (save && inp.value !== v.value) {
        const r = await this.py.call('set_value', path, inp.value, false);
        if (r && r.error) toast(esc(r.error), 'warn');
      }
      this.refreshVars(true);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(false));
  };
  const numType = (kind) => (kind === 'f' ? 'numeric' : kind === 'i' || kind === 'u' ? 'integer' : kind === 'b' ? 'logical' : 'character');
  /** a number as Spyder shows it in its tables (%.6g) */
  function g6(v) {
    if (typeof v !== 'number') return String(v);
    if (Number.isNaN(v)) return 'nan';
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v);
    if (v === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(v)));
    if (e < -4 || e >= 6) return v.toExponential(5).replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2');
    return String(Number(v.toPrecision(6)));
  }
  const unInf = (x) => (x === 'inf' ? Infinity : x === '-inf' ? -Infinity : x);
  P._viewer = function (path, data) {
    const title = data.title || path.join('.');
    const big = ['dataframe', 'series', 'index', 'array'].includes(data.kind);
    const W = new MG.FloatWin(this.root, {
      title: (data.kind === 'dataframe' ? 'DataFrame' : data.kind === 'series' ? 'Series' : data.kind === 'array' ? 'NumPy object array' : data.kind === 'collection' ? (data.type === 'dict' ? 'Dictionary' : data.type[0].toUpperCase() + data.type.slice(1)) : data.kind === 'text' ? 'Text editor' : 'Object') + ' – ' + title,
      w: big ? 720 : 560,
      h: big ? 460 : 380,
      x: Math.max(20, (this.root.clientWidth - (big ? 720 : 560)) / 2),
      y: 60,
      kind: 'sp'
    });
    W.el.classList.add('sp-viewer');
    const body = W.body;
    const foot = h('div.sp-vfoot');
    const closeB = h('button.sp-btn', { type: 'button' }, 'Close');
    closeB.addEventListener('click', () => W.close());
    if (data.kind === 'dataframe' || data.kind === 'series' || data.kind === 'index') {
      const cols = data.columns.map((c) => ({ name: c.name, type: numType(c.kind), dtype: c.dtype, values: c.kind === 'f' ? c.values.map(unInf) : c.values }));
      const host = h('div.sp-grid');
      const opts = { flavour: 'py', fmt: g6, typeLabel: () => '', colour: true, bar: false, rowLabel: data.index_name || '' };
      body.append(host);
      const grid = new MG.DataGrid(host, { title, nrow: data.nrow, ncol: data.ncol, shown: data.shown, rownames: data.index, columns: cols }, opts);
      const bg = h('input', { type: 'checkbox', checked: true });
      bg.addEventListener('change', () => {
        grid.ranges = bg.checked ? (grid._ranges(), grid.ranges) : null;
        grid._draw(true);
      });
      foot.append(h('label.sp-check', bg, ' Background colour'), h('span.sp-tgrow'), h('span.sp-vinfo', `${data.nrow.toLocaleString('en-GB')} rows × ${data.ncol} columns`), closeB);
      W.opts.onResized = () => grid._draw(true);
    } else if (data.kind === 'array') {
      const rows = data.rows || [];
      const n = rows.length ? rows[0].length : 0;
      const cols = [];
      for (let j = 0; j < n; j++) cols.push({ name: String(j), type: data.numeric ? (/int|uint/.test(data.dtype) ? 'integer' : /bool/.test(data.dtype) ? 'logical' : 'numeric') : 'character', values: rows.map((r) => unInf(r[j])) });
      const host = h('div.sp-grid');
      body.append(host);
      if (data.note) body.prepend(h('div.sp-vnote', data.note));
      const grid = new MG.DataGrid(host, { title, nrow: rows.length, ncol: n, shown: rows.length, rownames: rows.map((r, i) => String(i)), columns: cols }, { flavour: 'py', fmt: g6, typeLabel: () => '', colour: data.numeric, bar: false });
      foot.append(h('span.sp-vinfo', `Shape (${data.shape.join(', ')}${data.shape.length === 1 ? ',' : ''}), ${data.dtype}`), h('span.sp-tgrow'), closeB);
      W.opts.onResized = () => grid._draw(true);
    } else if (data.kind === 'collection') {
      const tb = h('tbody');
      for (const r of data.rows) {
        const tr = h('tr.sp-vrow.c-' + r.color, { tabindex: '0' }, h('td.n', r.name), h('td.t', r.type), h('td.s', sizeText(r.size)), h('td.v', r.value));
        tr.addEventListener('dblclick', () => {
          const sub = path.concat([r.pos]);
          if (['number', 'bool', 'none', 'date'].includes(r.kind) && data.editable) return this._editInPlace(sub, r, tr);
          this.openVar(sub, r);
        });
        tb.appendChild(tr);
      }
      body.append(h('div.sp-vwrap', h('table.sp-vtable', h('thead', h('tr', h('th', h('span.sp-vth', data.label)), h('th', h('span.sp-vth', 'Type')), h('th', h('span.sp-vth', 'Size')), h('th', h('span.sp-vth', 'Value')))), tb)));
      foot.append(h('span.sp-vinfo', data.total > data.rows.length ? `The first ${data.rows.length.toLocaleString('en-GB')} of ${data.total.toLocaleString('en-GB')} items` : `${data.total} item${data.total === 1 ? '' : 's'}`), h('span.sp-tgrow'), closeB);
    } else if (data.kind === 'text') {
      const ta = h('textarea.sp-vtext', { spellcheck: 'false', 'aria-label': 'Text of ' + title });
      ta.value = data.text;
      body.append(ta);
      if (data.editable) {
        const save = h('button.sp-btn.primary', { type: 'button' }, 'Save and close');
        save.addEventListener('click', async () => {
          if (this._busyNote()) return;
          await this.py.call('set_value', path, ta.value, true);
          W.close();
          this.refreshVars(true);
        });
        foot.append(h('span.sp-tgrow'), closeB, save);
      } else foot.append(h('span.sp-tgrow'), closeB);
    } else if (data.kind === 'scalar') {
      body.append(h('pre.sp-vrepr', data.text));
      foot.append(h('span.sp-tgrow'), closeB);
    } else {
      // (an object of another kind: what it is, and its attributes – as Spyder's Object Explorer)
      const tb = h('tbody');
      for (const a of data.attrs || []) tb.appendChild(h('tr.sp-vrow', h('td.n', a.name), h('td.t', a.type), h('td.v', a.value)));
      body.append(h('pre.sp-vrepr', data.repr), h('div.sp-vwrap', h('table.sp-vtable', h('thead', h('tr', h('th', h('span.sp-vth', 'Attribute')), h('th', h('span.sp-vth', 'Type')), h('th', h('span.sp-vth', 'Value')))), tb)));
      foot.append(h('span.sp-vinfo', data.type), h('span.sp-tgrow'), closeB);
    }
    body.appendChild(foot);
    bus.emit('spyder:view', { name: path[0], kind: data.kind });
    return W;
  };

  /* ================= Help ================= */
  P._buildHelp = function () {
    this.helpSource = h('select.sp-sel', { 'aria-label': 'Source' }, h('option', { value: 'console' }, 'Console'), h('option', { value: 'editor' }, 'Editor'));
    this.helpObj = h('input.sp-helpobj', { type: 'text', spellcheck: 'false', placeholder: 'an object, e.g. np.mean', 'aria-label': 'Object' });
    this.helpObj.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const n = this.helpObj.value.trim();
        if (n) this.showHelp(n, { source: this.helpSource.value, fromBox: true });
      }
    });
    this.helpPlain = false;
    this._paneBar('help', [h('span.sp-plabel', 'Source'), this.helpSource, h('span.sp-plabel', 'Object'), this.helpObj], () => [
      ['Rich text', () => this._helpMode(false), { checked: !this.helpPlain }],
      ['Plain text', () => this._helpMode(true), { checked: this.helpPlain }],
      '-',
      ['Show the introduction', () => this._helpIntro()]
    ]);
    this.helpBody = h('div.sp-helpbody', { tabindex: '0' });
    this.panes.help.el.appendChild(this.helpBody);
    this._helpIntro();
  };
  P._helpIntro = function () {
    this.helpLast = null;
    this.helpBody.innerHTML = `<div class="sp-hintro"><h2>Help</h2>
<p>To see the documentation of a function, class or variable, put the cursor on its name in the Editor or the Console and press <kbd>Ctrl</kbd>+<kbd>I</kbd>. You can also type its name into the <b>Object</b> box above and press <kbd>Enter</kbd>.</p>
<p>Names of the console's variables and of the modules you have imported work best, for example <code>np.mean</code> after <code>import numpy as np</code>. In the Editor, the documentation is also found for names that the script defines or imports but that have not been run yet.</p>
<p>In the console, <code>np.mean?</code> prints the same documentation, and <code>np.mean??</code> shows the source code where there is some.</p></div>`;
  };
  P._helpMode = function (plain) {
    this.helpPlain = plain;
    if (this.helpLast) this._renderHelp(this.helpLast);
  };
  /** the documentation of a name: the console's object, or (from the editor) what jedi knows */
  P.showHelp = async function (name, opts = {}) {
    this.showPane('help');
    this.helpObj.value = name;
    if (opts.source) this.helpSource.value = opts.source;
    if (!this.py || this.py.state !== 'ready') return this._helpMsg('The documentation appears once the console has started.');
    if (this.running || this.py.busy) return this._helpMsg('The console is busy. Ask again (Ctrl+I) when it has finished running.');
    let info = await this.py.call('inspect', name);
    if ((!info || !info.found) && opts.code != null) info = await this.py.call('jedi_help', opts.code, opts.line, opts.ch, opts.path || '');
    if (!info || !info.found) return this._helpMsg(`No documentation was found for ${name}. Run the line that imports or defines it first, then press Ctrl+I again.`, name);
    info.name = info.name || name;
    this.helpLast = info;
    this._renderHelp(info);
    bus.emit('spyder:help', { name });
  };
  P._helpMsg = function (text, name) {
    this.helpBody.innerHTML = '';
    if (name) this.helpBody.appendChild(h('h2.sp-hname', name));
    this.helpBody.appendChild(h('p.sp-hmsg', text));
  };
  P._renderHelp = function (info) {
    const B = this.helpBody;
    B.innerHTML = '';
    const def = info.definition || info.init_definition || info.call_def || '';
    const doc = stripAnsi(info.docstring || info.init_docstring || info.class_docstring || info.call_docstring || '');
    if (this.helpPlain) {
      const lines = [info.name, ''];
      if (def) lines.push('Definition: ' + stripAnsi(def), '');
      if (info.type_name) lines.push('Type: ' + info.type_name, '');
      lines.push(doc || '(no documentation)');
      B.appendChild(h('pre.sp-hplain', lines.join('\n')));
      return;
    }
    B.appendChild(h('h2.sp-hname', info.name));
    if (def) B.appendChild(h('div.sp-hdef', h('span.sp-hlbl', 'Definition:'), h('code', stripAnsi(def).replace(/^\w[\w.]*?(?=\()/, (m) => m))));
    const what = [info.type_name ? `Type: ${info.type_name}` : '', info.module ? `module ${info.module}` : '', info.file ? `File: ${info.file}` : ''].filter(Boolean);
    if (what.length) B.appendChild(h('div.sp-htype', what.join('  ·  ')));
    if (info.string_form && !doc && info.type_name && !/function|method|module|type/.test(info.type_name)) B.appendChild(h('pre.sp-hcode', stripAnsi(info.string_form)));
    B.appendChild(h('hr'));
    if (!doc) return B.appendChild(h('p.sp-hmsg', 'This object has no documentation.'));
    B.appendChild(docHtml(doc));
  };
  /** a docstring (NumPy's style, reStructuredText) → HTML: sections as headings, parameters, examples as code */
  function docHtml(doc) {
    const out = h('div.sp-hdoc');
    const lines = doc.replace(/\t/g, '    ').split('\n');
    const inline = (t) => esc(t).replace(/``([^`]+)``/g, '<code>$1</code>').replace(/`([^`]+)`/g, '<i>$1</i>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    let para = [];
    const flush = () => {
      if (para.length) out.appendChild(h('p', { html: inline(para.join(' ')) }));
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const next = lines[i + 1] || '';
      // a section: a title underlined with dashes or equals signs
      if (l.trim() && /^\s*[-=~^]{3,}\s*$/.test(next) && Math.abs(next.trim().length - l.trim().length) <= 2) {
        flush();
        out.appendChild(h('h3', l.trim()));
        i++;
        continue;
      }
      // examples: >>> lines and what follows them, up to a blank line
      if (/^\s*>>>/.test(l)) {
        flush();
        const ex = [];
        while (i < lines.length && lines[i].trim()) ex.push(lines[i++].replace(/^\s{0,8}/, ''));
        i--;
        out.appendChild(h('pre.sp-hcode', ex.join('\n')));
        continue;
      }
      // a parameter: "name : type" at the left margin, its description indented below it
      if (/^\S[^:]*\s:\s/.test(l) || /^\w+\s*$/.test(l.trim()) && /^\s{2,}\S/.test(next) && out.lastChild && out.lastChild.tagName === 'H3') {
        flush();
        const m = /^(\S[^:]*?)\s:\s(.*)$/.exec(l);
        const dt = h('dt', { html: m ? `<b>${esc(m[1])}</b> : <i>${esc(m[2])}</i>` : `<b>${esc(l.trim())}</b>` });
        const dd = [];
        while (i + 1 < lines.length && (/^\s{2,}\S/.test(lines[i + 1]) || (!lines[i + 1].trim() && /^\s{2,}\S/.test(lines[i + 2] || '')))) dd.push(lines[++i].trim());
        const dl = out.lastChild && out.lastChild.tagName === 'DL' ? out.lastChild : out.appendChild(h('dl'));
        dl.append(dt, h('dd', { html: inline(dd.join(' ')) }));
        continue;
      }
      // a block of code: a "::" paragraph, or lines indented more than the text
      if (/^\s{4,}\S/.test(l) && !para.length) {
        const blk = [];
        while (i < lines.length && (/^\s{4,}/.test(lines[i]) || !lines[i].trim())) blk.push(lines[i++].slice(4));
        i--;
        while (blk.length && !blk[blk.length - 1].trim()) blk.pop();
        out.appendChild(h('pre.sp-hcode', blk.join('\n')));
        continue;
      }
      if (!l.trim()) flush();
      else para.push(l.trim());
    }
    flush();
    return out;
  }

  /* ================= Plots ================= */
  P._buildPlots = function () {
    this.plotFitOn = this.prefs.plotFit !== false;
    this.plotZoom = 1;
    const bar = this._paneBar(
      'plots',
      [
        this._ptb('download', 'Save plot as… (a PNG file among your files)', () => this.plotSave()),
        this._ptb('copy', 'Copy plot to clipboard as image', () => this.plotCopy()),
        this._ptb('close', 'Remove plot', () => this.plotRemove()),
        this._ptb('trash', 'Remove all plots', () => this.plotClear()),
        h('span.sp-tsep'),
        this._ptb('prev', 'Previous plot', () => this.plotGo(-1)),
        this._ptb('next', 'Next plot', () => this.plotGo(1)),
        h('span.sp-tsep'),
        this._ptb('zoomout', 'Zoom out', () => this._zoom(1 / 1.25)),
        (this.plotZoomEl = h('span.sp-plabel.sp-zoom', '100%')),
        this._ptb('zoomin', 'Zoom in', () => this._zoom(1.25)),
        this._ptb('fit', 'Fit plot to the pane', () => this._fitToggle(true))
      ],
      () => [
        ['Mute inline plotting', () => this.setPref('muteInline', !this.prefs.muteInline), { checked: !!this.prefs.muteInline }],
        ['Fit plots to window', () => this._fitToggle(!this.plotFitOn), { checked: this.plotFitOn }]
      ]
    );
    bar.classList.add('sp-plotbar');
    this.plotImg = h('img.sp-plotimg', { alt: '' });
    this.plotView = h('div.sp-plotview', this.plotImg);
    this.plotEmpty = h('div.sp-empty', 'The figures that your code makes appear here.');
    this.plotThumbs = h('div.sp-thumbs', { role: 'listbox', 'aria-label': 'Plots' });
    this.panes.plots.el.appendChild(h('div.sp-plotmain', this.plotView, this.plotEmpty, this.plotThumbs));
    this._plotShow();
  };
  P._addPlot = function (png, o) {
    if (!png) return;
    this.plots.push({ png, size: o && o.size, dpi: (o && o.dpi) || 144 });
    while (this.plots.length > 120) this.plots.shift();
    this.plotAt = this.plots.length - 1;
    this._thumbs();
    this.showPane('plots');
    this._plotShow();
    bus.emit('spyder:plot', { count: this.plots.length });
  };
  P._thumbs = function () {
    this.plotThumbs.innerHTML = '';
    this.plots.forEach((p, i) => {
      const t = h('button.sp-thumb' + (i === this.plotAt ? '.on' : ''), { type: 'button', role: 'option', 'aria-selected': i === this.plotAt ? 'true' : 'false', title: `Figure ${i + 1}` }, h('img', { src: 'data:image/png;base64,' + p.png, alt: `Figure ${i + 1}` }));
      t.addEventListener('click', () => {
        this.plotAt = i;
        this._thumbs();
        this._plotShow();
      });
      this.plotThumbs.appendChild(t);
    });
    const on = this.plotThumbs.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };
  P._plotShow = function () {
    const p = this.plots[this.plotAt];
    this.plotEmpty.hidden = !!p;
    this.plotView.hidden = !p;
    this.plotThumbs.hidden = !p;
    if (!p) return;
    if (this.plotImg.dataset.at !== String(this.plotAt) || this.plotImg.dataset.n !== String(this.plots.length)) {
      this.plotImg.src = 'data:image/png;base64,' + p.png;
      this.plotImg.dataset.at = String(this.plotAt);
      this.plotImg.dataset.n = String(this.plots.length);
    }
    this._plotFit();
  };
  P._plotFit = function () {
    const p = this.plots[this.plotAt];
    if (!p || !this.plotImg) return;
    const nat = p.size ? { w: p.size[0], h: p.size[1] } : { w: this.plotImg.naturalWidth || 600, h: this.plotImg.naturalHeight || 400 };
    // (at 100 %, a figure is shown at its size in inches at 96 pixels each, as on a screen)
    const base = { w: (nat.w / (p.dpi || 144)) * 96, h: (nat.h / (p.dpi || 144)) * 96 };
    let z = this.plotZoom;
    if (this.plotFitOn) {
      const box = this.plotView.getBoundingClientRect();
      if (box.width > 20 && box.height > 20) z = Math.min((box.width - 16) / base.w, (box.height - 16) / base.h);
      this.plotZoom = z;
    }
    this.plotImg.style.width = Math.round(base.w * z) + 'px';
    this.plotImg.style.height = Math.round(base.h * z) + 'px';
    this.plotZoomEl.textContent = Math.round(z * 100) + '%';
  };
  P._zoom = function (f) {
    this.plotFitOn = false;
    this.plotZoom = MG.clamp(this.plotZoom * f, 0.1, 8);
    this._plotFit();
  };
  P._fitToggle = function (on) {
    this.plotFitOn = on;
    this.prefs.plotFit = on;
    this._savePrefs();
    if (!on) this.plotZoom = 1;
    this._plotFit();
  };
  P.plotGo = function (d) {
    if (!this.plots.length) return;
    this.plotAt = MG.clamp(this.plotAt + d, 0, this.plots.length - 1);
    this._thumbs();
    this._plotShow();
  };
  P.plotRemove = function () {
    if (!this.plots.length) return;
    this.plots.splice(this.plotAt, 1);
    this.plotAt = Math.min(this.plotAt, this.plots.length - 1);
    this._thumbs();
    this._plotShow();
  };
  P.plotClear = async function () {
    if (!this.plots.length) return;
    if (!(await MG.confirmBox('Remove all plots', '<p>Do you want to remove all the plots?</p>', 'Yes', { danger: true }))) return;
    this.plots = [];
    this.plotAt = -1;
    this._thumbs();
    this._plotShow();
  };
  P.plotSave = async function () {
    const p = this.plots[this.plotAt];
    if (!p) return;
    const path = await this.fileDialog({ title: 'Save plot as', mode: 'save', dir: this.cwd, name: `Figure_${this.plotAt + 1}.png` });
    if (!path) return;
    const bin = atob(p.png);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.fs.put(path.replace(/\.py$/, '.png'), { kind: 'blob', blob: new Blob([bytes], { type: 'image/png' }), size: bytes.length, mtime: Date.now() });
    this._status(`The plot was saved as ${this.fs.pretty(path.replace(/\.py$/, '.png'))}.`, 4000);
  };
  P.plotCopy = async function () {
    const p = this.plots[this.plotAt];
    if (!p) return;
    try {
      const blob = await (await fetch('data:image/png;base64,' + p.png)).blob();
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      this._status('The plot was copied to the clipboard.', 2500);
    } catch (e) {
      toast('The browser did not allow the picture to be copied. Use Save plot as… instead.', 'warn');
    }
  };

  /* ================= Files ================= */
  P._buildFiles = function () {
    this.filesOpen = new Set();
    this.filesHidden = false;
    this._paneBar(
      'files',
      [
        this._ptb('up', 'Parent directory', () => this.setCwd(MG.path.dirname(this.cwd))),
        this._ptb('home', 'Home directory', () => this.setCwd(MG.app.HOME)),
        this._ptb('refresh', 'Refresh', () => this.renderFiles()),
        (this.filesWhere = h('span.sp-plabel.sp-fwhere'))
      ],
      () => [
        ['New file…', () => this._filesNew(false)],
        ['New folder…', () => this._filesNew(true)],
        '-',
        ['Show hidden files', () => ((this.filesHidden = !this.filesHidden), this.renderFiles()), { checked: this.filesHidden }]
      ]
    );
    this.filesTree = h('div.sp-tree', { role: 'tree', 'aria-label': 'Files' });
    this.panes.files.el.appendChild(h('div.sp-treewrap', h('div.sp-treehead', h('span', 'Name'), h('span', 'Size'), h('span', 'Type'), h('span', 'Date modified')), this.filesTree));
  };
  P._cwdChanged = function () {
    if (!this.panes.files.el.hidden) this.renderFiles();
  };
  P._filesChanged = function () {
    if (this.panes.files.el.hidden) return;
    clearTimeout(this._filesT);
    this._filesT = setTimeout(() => this.renderFiles(), 250);
  };
  const KIND = (name, dir) => (dir ? 'Folder' : /\.py$/i.test(name) ? 'Python file' : /\.(csv|tsv)$/i.test(name) ? 'Data table' : /\.(png|jpe?g|svg|gif)$/i.test(name) ? 'Picture' : /\.(txt|md)$/i.test(name) ? 'Text file' : /\.ipynb$/i.test(name) ? 'Notebook' : (/\.([^.]+)$/.exec(name) || [, 'File'])[1].toUpperCase() + (/\./.test(name) ? ' file' : ''));
  P.renderFiles = function () {
    const fs = this.fs;
    this.filesWhere.textContent = fs.pretty(this.cwd);
    this.filesTree.innerHTML = '';
    const rows = [];
    const walk = (dir, depth) => {
      const kids = fs.list(dir).filter((c) => (this.filesHidden || !c.name.startsWith('.')) && c.name !== '__pycache__');
      kids.sort((a, b) => ((a.entry.kind === 'dir') === (b.entry.kind === 'dir') ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : a.entry.kind === 'dir' ? -1 : 1));
      for (const c of kids) {
        rows.push({ c, depth });
        if (c.entry.kind === 'dir' && this.filesOpen.has(c.path) && rows.length < 3000) walk(c.path, depth + 1);
      }
    };
    walk(this.cwd, 0);
    for (const { c, depth } of rows) {
      const dir = c.entry.kind === 'dir';
      const open = dir && this.filesOpen.has(c.path);
      const n = dir ? 0 : fs.size(c.entry);
      const size = dir ? '' : n < 1024 ? n + ' bytes' : MG.humanSize(n).replace(/([KMGT])$/, ' $1B');
      const date = c.entry.mtime ? new Date(c.entry.mtime).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const row = h(
        'div.sp-trow' + (dir ? '.dir' : ''),
        { role: 'treeitem', tabindex: '0', 'aria-expanded': dir ? String(open) : null, title: fs.pretty(c.path) },
        h('span.sp-tname', { style: { paddingLeft: 6 + depth * 16 + 'px' } }, h('span.sp-ttw', dir ? (open ? '▾' : '▸') : ''), h('span', { html: ic(dir ? 'folder' : /\.py$/i.test(c.name) ? 'pyfile' : 'file') }), h('span', c.name)),
        h('span.sp-tsz', size),
        h('span.sp-tty', KIND(c.name, dir)),
        h('span.sp-tdt', date)
      );
      const act = () => {
        if (dir) {
          open ? this.filesOpen.delete(c.path) : this.filesOpen.add(c.path);
          return this.renderFiles();
        }
        this._fileOpen(c.path);
      };
      row.addEventListener('dblclick', act);
      row.querySelector('.sp-ttw').addEventListener('click', (e) => {
        if (!dir) return;
        e.stopPropagation();
        act();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') act();
        else if (e.key === 'ArrowDown' && row.nextSibling) (e.preventDefault(), row.nextSibling.focus());
        else if (e.key === 'ArrowUp' && row.previousSibling) (e.preventDefault(), row.previousSibling.focus());
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._fileMenu({ x: e.clientX, y: e.clientY }, c.path, dir);
      });
      this.filesTree.appendChild(row);
    }
    if (!rows.length) this.filesTree.appendChild(h('div.sp-empty', 'This folder is empty.'));
  };
  const TEXT = /\.(py|pyw|pyi|txt|md|csv|tsv|json|ya?ml|toml|ini|cfg|sh|r|fa|fasta|fq|fastq|vcf|bed|gff3?|gtf|sam|log|tab|xml|html?|js|css)$/i;
  P._fileOpen = function (path) {
    const e = this.fs.get(path);
    if (e && e.kind === 'text' && (TEXT.test(path) || !/\.[^/]+$/.test(path))) return this.openFile(path);
    if (MG.app.openFile) return MG.app.openFile(path);
  };
  P._fileMenu = function (at, path, dir) {
    const fs = this.fs;
    const isPy = /\.py$/i.test(path);
    const data = /\.(csv|tsv|txt|tab)$/i.test(path);
    this._menu(at, [
      ['Open', () => (dir ? (this.filesOpen.add(path), this.renderFiles()) : this._fileOpen(path))],
      isPy ? ['Run', async () => (await this.openFile(path), this.runFile())] : null,
      dir ? ['Set as the working directory', () => this.setCwd(path)] : null,
      data ? ['Import data into the console', () => this._importData(path)] : null,
      '-',
      ['New file…', () => this._filesNew(false, dir ? path : MG.path.dirname(path))],
      ['New folder…', () => this._filesNew(true, dir ? path : MG.path.dirname(path))],
      ['Rename…', () => this._fileRename(path)],
      ['Delete…', () => this._fileDelete(path)],
      '-',
      ['Copy absolute path', () => MG.copyText(path).then((ok) => ok && this._status('Copied: ' + path, 2500))],
      ['Show in the Files tab', () => MG.app.revealFile && MG.app.revealFile(path)]
    ]);
  };
  P._importData = function (path) {
    const name = MG.path.basename(path).replace(/\.[^.]+$/, '').replace(/\W+/g, '_').replace(/^(\d)/, '_$1') || 'data';
    const sep = /\.(tsv|tab)$/i.test(path) ? ", sep='\\t'" : '';
    // (a path relative to the working directory when the file is in it, else the whole path)
    const rel = path.startsWith(this.cwd + '/') ? path.slice(this.cwd.length + 1) : path;
    this.execute(`import pandas as pd\n${name} = pd.read_csv(${JSON.stringify(rel)}${sep})`, { scan: 'import pandas' });
  };
  P._filesNew = async function (folder, where) {
    const dir = where || this.cwd;
    const n = await MG.promptText(folder ? 'New folder' : 'New file', folder ? 'Folder name:' : 'File name (for example analysis.py):', folder ? 'new_folder' : 'new_script.py', 'Create');
    if (!n) return;
    const p = this.fs.resolve(n.replace(/[\\]/g, '_'), dir);
    if (this.fs.exists(p)) return toast(`${esc(this.fs.pretty(p))} already exists.`, 'warn');
    if (folder) this.fs.mkdirp(p);
    else {
      this.fs.mkdirp(MG.path.dirname(p));
      this.fs.writeText(p, /\.py$/i.test(p) ? MG.Spyder.template() : '');
      this.openFile(p);
    }
    this.renderFiles();
  };
  P._fileRename = async function (path) {
    const n = await MG.promptText('Rename', 'New name:', MG.path.basename(path), 'Rename');
    if (!n || n === MG.path.basename(path)) return;
    const to = MG.path.dirname(path) + '/' + n.replace(/[\/\\]/g, '_');
    if (this.fs.exists(to)) return toast(`${esc(this.fs.pretty(to))} already exists.`, 'warn');
    // (the open files move with it – before the file system says that the old path has gone)
    const moved = [];
    for (const d of this.docs) {
      if (d.path === path || (d.path && d.path.startsWith(path + '/'))) {
        moved.push([d, d.path]);
        d.path = to + d.path.slice(path.length);
        d.name = MG.path.basename(d.path);
      }
    }
    if (!this.fs.rename(path, to)) {
      for (const [d, p] of moved) ((d.path = p), (d.name = MG.path.basename(p)));
      return toast(`${esc(this.fs.pretty(path))} could not be renamed.`, 'warn');
    }
    this._renderTabs();
    this._persistDocs();
    this.renderFiles();
  };
  P._fileDelete = async function (path) {
    if (!(await MG.confirmBox('Delete', `<p>Do you really want to delete <b>${esc(this.fs.pretty(path))}</b>? This cannot be undone.</p>`, 'Delete', { danger: true }))) return;
    this.fs.remove(path);
    this.renderFiles();
  };

  /* ================= History ================= */
  P._buildHistory = function () {
    this._paneBar('history', [h('span.sp-plabel', 'history.py')], () => [['Clear the history', () => this._historyClear()]]);
    this.histBody = h('div.sp-hist', { tabindex: '0', 'aria-label': 'History' });
    this.panes.history.el.appendChild(this.histBody);
  };
  const stamp = (d) => `## ---(${d.toString().replace(/ GMT.*$/, '').replace(/^(\w+) (\w+) (\d+) (\d+) ([\d:]+)$/, '$1 $2 $3 $5 $4')})---`;
  P._historyRender = function () {
    if (!this.histBody || this.panes.history.el.hidden) return;
    const H = this.conHistory || [];
    const pre = h('pre.sp-histpre.cm-s-default');
    const add = (text, cls) => {
      const line = h('div' + (cls ? '.' + cls : ''));
      if (cls) line.textContent = text;
      else if (window.CodeMirror.runMode) window.CodeMirror.runMode(text, 'python', line);
      else line.textContent = text;
      pre.appendChild(line);
    };
    H.forEach((c, i) => {
      if (i === this.sessionStart) add(stamp(this.sessionTime), 'sp-histsep');
      add(c);
    });
    if (this.sessionStart >= H.length) add(stamp(this.sessionTime), 'sp-histsep');
    this.histBody.replaceChildren(pre);
    this.histBody.scrollTop = this.histBody.scrollHeight;
  };
  P._historyClear = async function () {
    if (!(await MG.confirmBox('Clear the history', '<p>Do you want to clear the history of the commands that ran in the console?</p>', 'Clear', { danger: true }))) return;
    this.conHistory.length = 0;
    this.sessionStart = 0;
    MG.store.set('spHistory', []);
    this._historyRender();
  };

  /* ================= Debugger ================= */
  P._buildDebugger = function () {
    this._paneBar('debugger', [
      this._ptb('step', 'Execute the current line', () => this.dbgCmd('next'), 'blue'),
      this._ptb('stepin', 'Step into the function or method of the current line', () => this.dbgCmd('step'), 'blue'),
      this._ptb('stepout', 'Execute until the current function or method returns', () => this.dbgCmd('return'), 'blue'),
      this._ptb('cont', 'Continue execution until the next breakpoint', () => this.dbgCmd('continue'), 'blue'),
      this._ptb('stop', 'Stop debugging', () => this.dbgCmd('exit'), 'red')
    ]);
    this.dbgBody = h('div.sp-dbg');
    this.panes.debugger.el.appendChild(this.dbgBody);
    this._renderDebugger();
  };
  P._renderDebugger = function () {
    if (!this.dbgBody) return;
    const B = this.dbgBody;
    B.innerHTML = '';
    const m = this.debugging;
    B.appendChild(h('h4', 'Frames'));
    if (!m) B.appendChild(h('p.sp-empty.left', 'The debugger is not running. Set a breakpoint (F12, or click to the left of a line number) and start it with Debug file (Ctrl+F5).'));
    else {
      const list = h('div.sp-frames');
      for (const f of (m.stack || []).slice().reverse()) {
        const b = h('button.sp-frame' + (f.current ? '.on' : ''), { type: 'button' }, h('b', f.func === '<module>' ? '<module>' : f.func + '()'), h('span', ` ${this.fs.pretty(f.file)}:${f.line}`));
        b.addEventListener('click', () => this.fs.exists(f.file) && this.openFile(f.file, { line: f.line }));
        list.appendChild(b);
      }
      B.appendChild(list);
    }
    B.appendChild(h('h4', 'Breakpoints'));
    const bps = Object.entries(this.breakpoints || {}).filter(([, ls]) => ls && ls.length);
    if (!bps.length) B.appendChild(h('p.sp-empty.left', 'There are no breakpoints.'));
    else {
      const list = h('div.sp-frames');
      for (const [p, ls] of bps)
        for (const n of ls) {
          const b = h('button.sp-frame', { type: 'button' }, h('span.sp-bpdot.inline'), h('span', ` ${this.fs.pretty(p)}:${n}`));
          b.addEventListener('click', () => this.fs.exists(p) && this.openFile(p, { line: n }));
          list.appendChild(b);
        }
      B.appendChild(list);
    }
  };
})();
