/* =====================================================================
   RStudio's Source pane (rstudio.js has the rest of RStudio):
   the documents open for editing – R scripts, R Markdown documents,
   R Notebooks, Quarto documents, text files – and what can be done
   with them:

     Run (Ctrl+Enter)     the statement at the cursor, or the selection,
                          in the Console's R
     Source               the whole script, with source()
     chunks               ▶ on a chunk runs it; its output (text and
                          plots) shows under it, as RStudio does
     Knit / Render        the document from the top in a new R (knit.js)
     Preview              an R Notebook's .nb.html – the outputs as they are

   and the tabs that R opens in it: data (View()) and text (a function,
   file.show()). Also the Import Dataset dialogs, the file dialogs and
   Global Options.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const rstr = (s) => MG.R.rstr(s);
  const IC = (n) => MG.icon(n);
  const RS = MG.RStudio;
  const WB = 'get("wb", envir = as.environment("tools:workbench"))';
  const P = MG.RStudioApp.prototype;

  const KINDS = {
    r: { label: 'R Script', icon: 'code', ext: '.R', mode: 'r' },
    rmd: { label: 'R Markdown', icon: 'book', ext: '.Rmd', mode: 'rmarkdown' },
    notebook: { label: 'R Notebook', icon: 'notebook', ext: '.Rmd', mode: 'rmarkdown' },
    qmd: { label: 'Quarto', icon: 'book2', ext: '.qmd', mode: 'rmarkdown' },
    md: { label: 'Markdown', icon: 'text', ext: '.md', mode: 'markdown' },
    text: { label: 'Text File', icon: 'text', ext: '.txt', mode: 'text/plain' }
  };
  const isMd = (k) => k === 'rmd' || k === 'notebook' || k === 'qmd';
  function modeFor(path, kind) {
    if (kind && KINDS[kind] && kind !== 'text') return KINDS[kind].mode;
    const p = String(path || '');
    if (/\.r$/i.test(p)) return 'r';
    if (/\.(rmd|qmd)$/i.test(p)) return 'rmarkdown';
    if (/\.(md|markdown)$/i.test(p)) return 'markdown';
    if (/\.py$/i.test(p)) return 'python';
    if (/\.(sh|bash)$/i.test(p)) return 'shell';
    if (/\.(js|json)$/i.test(p)) return 'javascript';
    if (/\.ya?ml$/i.test(p)) return 'yaml';
    return 'text/plain';
  }
  function labelFor(d) {
    if (d.kind !== 'text') return KINDS[d.kind].label;
    const p = d.path || '';
    if (/\.py$/i.test(p)) return 'Python Script';
    if (/\.(sh|bash)$/i.test(p)) return 'Shell Script';
    if (/\.html?$/i.test(p)) return 'HTML';
    if (/\.json$/i.test(p)) return 'JSON';
    if (/\.ya?ml$/i.test(p)) return 'YAML';
    if (/\.(csv|tsv)$/i.test(p)) return 'Text File (data)';
    return 'Text File';
  }
  /** the kind of a document, for a sentence: 'an R script', 'a text file' … */
  function kindPhrase(d) {
    const l = labelFor(d);
    return { 'R Script': 'an R script', 'Python Script': 'a Python script', 'Shell Script': 'a shell script', HTML: 'an HTML file', JSON: 'a JSON file', YAML: 'a YAML file', 'Text File (data)': 'a data file', 'Text File': 'a text file' }[l] || 'this kind of file';
  }
  const isShiny = (d) => d.kind === 'r' && ((d.path && /(^|\/)(app|server|ui)\.R$/i.test(d.path)) || /\bshinyApp\s*\(/.test(d.cmDoc.getValue()));

  /** the lines of the statement that line `at` belongs to: R reads a statement until it is complete (brackets
      closed, no operator at the end of a line), so Run of one line runs the whole of a statement that goes on over
      several lines */
  function statementAt(lines, at) {
    let from = at;
    for (let k = at - 1; k >= Math.max(0, at - 80); k--) if (RS.incomplete(lines.slice(k, at).join('\n'))) from = k;
    let to = Math.max(from, at);
    while (to < lines.length - 1 && RS.incomplete(lines.slice(from, to + 1).join('\n'))) to++;
    return { from, to };
  }

  let seq = 0;
  let untitled = 0;

  /* ================= building the pane ================= */
  P._buildSource = function () {
    const SP = this.panes.source;
    this.chunkQueue = [];
    this.srcTabsBox = h('div.rs-srctabs', { role: 'tablist', 'aria-label': 'Open documents' });
    this.srcNote = h('span.rs-srcnote', 'No documents are open. Choose File ▸ New File, or click a file in the Files pane.');
    const mx = h('button.rs-pane-btn', { type: 'button', title: 'Maximise this pane', html: IC('maximize') });
    mx.addEventListener('click', () => this.zoom('source'));
    SP.tabsEl.append(this.srcTabsBox, h('span.rs-tabsgrow'), this.srcNote, mx);
    this.docBar = h('div.rs-bar.rs-docbar');
    this.findBar = h('div.rs-findbar');
    this.findBar.hidden = true;
    this.cmHost = h('div.rs-src-cm');
    this.srcStatus = h('div.rs-srcstatus');
    this.srcCode = h('div.rs-view', this.docBar, this.findBar, this.cmHost, this.srcStatus);
    this.srcOther = h('div.rs-view');
    this.srcCode.hidden = true;
    this.srcOther.hidden = true;
    SP.body.append(this.srcCode, this.srcOther);
    const keys = {};
    const both = (k, fn) => {
      keys['Ctrl-' + k] = fn;
      keys['Cmd-' + k] = fn;
    };
    const shift = (k, fn) => {
      keys['Shift-Ctrl-' + k] = fn;
      keys['Shift-Cmd-' + k] = fn;
    };
    both('Enter', () => this.runCurrent());
    shift('Enter', () => this._shiftEnter());
    both('Alt-R', () => this.runAll());
    both('Alt-I', () => this.insertChunk());
    both('Alt-C', () => this.runChunkAtCursor());
    both('Alt-N', () => this.runNextChunk());
    both('Alt-P', () => this.runChunksAbove());
    both('S', () => this.save());
    shift('S', () => this.sourceDoc(false));
    shift('K', () => this.knit());
    shift('C', 'toggleComment');
    shift('M', (cm) => cm.replaceSelection(' |> '));
    both('F', () => this.find());
    keys['Shift-Ctrl-Alt-N'] = keys['Shift-Cmd-Alt-N'] = () => this.newDoc('r');
    keys['Alt--'] = (cm) => cm.replaceSelection(' <- ');
    keys.Tab = (cm) => this._tab(cm);
    keys['Shift-Tab'] = 'indentLess';
    keys.Esc = () => {
      if (this._pop) return this._srcPopClose();
      if (!this.findBar.hidden) return this._findClose();
      return window.CodeMirror.Pass;
    };
    this.cm = window.CodeMirror(this.cmHost, {
      value: '',
      mode: 'r',
      theme: 'textmate',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: this.prefs.autoClose !== false,
      lineWrapping: false,
      extraKeys: keys,
      screenReaderLabel: 'Source editor'
    });
    this.cm.on('cursorActivity', () => this._srcStatusUpdate());
    this.cm.on('changes', () => this._docChanged());
    this._applyPrefs();
  };

  /* ================= documents ================= */
  P._newCodeDoc = function ({ path, text, kind, name }) {
    text = text || '';
    const k = kind || MG.Knit.docKind(path || '', text);
    const d = {
      id: ++seq,
      type: 'code',
      path: path || null,
      name: name || (path ? MG.path.basename(path) : 'Untitled' + ++untitled),
      kind: k,
      outs: [],
      marks: [],
      lineCls: [],
      chunks: [],
      sourceOnSave: false,
      renderOnSave: false
    };
    d.cmDoc = window.CodeMirror.Doc(text, modeFor(path || '', k));
    d.saved = path ? text : '';
    // (a new document with text from a template is unsaved from the start: its name is red until it is saved)
    d.gen = !path && text ? -1 : d.cmDoc.changeGeneration(true);
    d.dirty = !path && !!text;
    this.docs.push(d);
    return d;
  };
  /** open a file in the Source pane (or show it, if it is open) → the document. opts.line: go to that line */
  P.openFile = async function (path, opts = {}) {
    const fs = this.fs;
    const p = fs.resolve(path);
    let d = this.docs.find((x) => x.path === p);
    if (!d) {
      const e = fs.get(p);
      if (!e) {
        toast(`The file ${esc(fs.pretty(p))} does not exist.`, 'warn');
        return null;
      }
      if (e.kind === 'dir') {
        this.filesDir = p;
        this.showTab('files', 'files');
        return null;
      }
      if (fs.size(e) > 5 * 1024 * 1024) {
        toast(`${esc(MG.path.basename(p))} is too large to open in the editor (more than 5 MB).`, 'warn');
        return null;
      }
      let text = null;
      try {
        if (e.kind === 'text') text = await fs.readText(p);
        else text = MG.looksText(p, await fs.readBytes(p));
      } catch (err) {
        text = null;
      }
      if (text == null) {
        toast(`${esc(MG.path.basename(p))} is not a text file, so it can't be opened in the editor.`, 'warn');
        return null;
      }
      d = this.docs.find((x) => x.path === p); // (opened meanwhile)
      if (!d) {
        d = this._newCodeDoc({ path: p, text });
        d.entry = fs.get(p);
      }
    }
    if (opts.noActivate) return d;
    this.activate(d);
    if (opts.line && d.type === 'code') {
      this.cm.setCursor({ line: Math.max(0, opts.line - 1), ch: 0 });
      this.cm.scrollIntoView(null, 80);
    }
    if (!opts.noFocus) setTimeout(() => this.cm.focus(), 30);
    return d;
  };
  /** a new, untitled document: kind 'r' | 'rmd' | 'notebook' | 'qmd' | 'text' */
  P.newDoc = function (kind, text) {
    const d = this._newCodeDoc({ text: text || '', kind: KINDS[kind] ? kind : 'r' });
    this.activate(d);
    // (the cursor goes where one starts writing: in a document from a template, after the YAML header)
    if (text && isMd(d.kind)) {
      const fm = MG.Knit.splitFrontMatter(text);
      this.cm.setCursor({ line: fm.lines + 1, ch: 0 });
    }
    setTimeout(() => this.cm.focus(), 30);
    bus.emit('rstudio:new', { kind: d.kind, name: d.name });
    return d;
  };
  /** show a document: its tab is the current one */
  P.activate = function (d) {
    if (!d) {
      this._renderSrcTabs();
      return;
    }
    const prev = this.cur;
    this.cur = d;
    this._srcPopClose();
    if (d.type === 'code') {
      this.srcOther.hidden = true;
      this.srcCode.hidden = false;
      if (this.cm.getDoc() !== d.cmDoc) this.cm.swapDoc(d.cmDoc);
      const mode = modeFor(d.path || '', d.kind);
      if (d.cmDoc.modeOption !== mode) this.cm.setOption('mode', mode);
      this.cm.setOption('lineWrapping', (isMd(d.kind) || d.kind === 'md') && this.prefs.wrapRmd !== false);
      this._renderDocBar();
      this._decorate(d, true);
      this._srcStatusUpdate();
      setTimeout(() => {
        this.cm.refresh();
        d.outs.forEach((o) => o.widget.changed());
      }, 0);
    } else {
      this.srcCode.hidden = true;
      this.srcOther.hidden = false;
      if (!d.view.parentNode) this.srcOther.appendChild(d.view);
      for (const c of Array.from(this.srcOther.children)) c.hidden = c !== d.view;
      if (d.grid) setTimeout(() => d.grid._draw(true), 0);
    }
    this._renderSrcTabs();
    this._saveOpen();
    if (prev !== d) bus.emit('rstudio:doc', { path: d.path || '', kind: d.kind || d.type, name: d.name });
  };
  P._renderSrcTabs = function () {
    const box = this.srcTabsBox;
    box.innerHTML = '';
    for (const d of this.docs) {
      const icon = d.type === 'data' ? 'table' : d.type === 'text' ? 'file' : KINDS[d.kind] ? KINDS[d.kind].icon : 'text';
      const x = h('span.tx', { role: 'button', title: 'Close', 'aria-label': 'Close ' + d.name }, '×');
      const on = d === this.cur;
      const b = h('button.rs-ptab' + (on ? '.on' : '') + (d.dirty ? '.dirty' : ''), { type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', title: d.path ? this.fs.pretty(d.path) : d.name }, h('span', { html: IC(icon) }), h('span.tname', d.name + (d.dirty ? '*' : '')), x);
      b.addEventListener('click', (e) => {
        if (e.target === x) return;
        this.activate(d);
      });
      b.addEventListener('auxclick', (e) => e.button === 1 && this.closeDoc(d));
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeDoc(d);
      });
      box.appendChild(b);
    }
    this.srcNote.hidden = this.docs.length > 0;
    const col = this.cols.left;
    const was = col.classList.contains('nosrc');
    col.classList.toggle('nosrc', !this.docs.length);
    if (was !== !this.docs.length) this._resized();
    const cur = box.querySelector('.on');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  /** close a document (asks first when it has unsaved edits) → false if it stays open */
  P.closeDoc = async function (d) {
    if (!d) return false;
    if (d.type === 'code' && d.dirty) {
      const a = await ask3('Save File', `<p>Do you want to save changes to <b>${esc(d.name)}</b>?</p>`, 'Save', "Don't Save");
      if (a === 'cancel') return false;
      if (a === 'yes' && !(await this.save(d))) return false;
    }
    const i = this.docs.indexOf(d);
    if (i < 0) return true;
    this.docs.splice(i, 1);
    if (d.grid) d.grid.destroy();
    if (d.view) d.view.remove();
    this.chunkQueue = this.chunkQueue.filter((j) => j.d !== d);
    if (this.cur === d) {
      this.cur = null;
      const next = this.docs[i] || this.docs[i - 1];
      if (next) this.activate(next);
      else {
        this.cm.swapDoc(window.CodeMirror.Doc('', 'r'));
        this.srcCode.hidden = true;
        this.srcOther.hidden = true;
        this.findBar.hidden = true;
        this._renderSrcTabs();
      }
    } else this._renderSrcTabs();
    this._saveOpen();
    bus.emit('rstudio:close', { path: d.path || '', name: d.name });
    return true;
  };
  P.closeAll = async function () {
    for (const d of this.docs.slice()) if (!(await this.closeDoc(d))) return false;
    return true;
  };
  P.dirtyPaths = function () {
    return this.docs.filter((d) => d.type === 'code' && d.dirty).map((d) => d.path || d.name);
  };
  /* the documents open in Source are opened again when the page is (their files: unsaved new documents are not kept) */
  P._saveOpen = function () {
    if (this._restoring) return;
    const files = this.docs.filter((d) => d.type === 'code' && d.path).map((d) => ({ p: d.path, sos: d.sourceOnSave || undefined, ros: d.renderOnSave || undefined }));
    store.set('rsOpen', { files, cur: this.cur && this.cur.path ? this.cur.path : null });
  };
  P._restoreDocs = async function () {
    const st = store.get('rsOpen', null);
    this._restoring = true;
    try {
      if (st && Array.isArray(st.files)) {
        for (const f of st.files) {
          const p = typeof f === 'string' ? f : f && f.p;
          if (!p || !this.fs.exists(p) || this.fs.isDir(p)) continue;
          const d = await this.openFile(p, { noActivate: true });
          if (d) {
            d.sourceOnSave = !!f.sos;
            d.renderOnSave = !!f.ros;
          }
        }
      }
      const cur = st && st.cur && this.docs.find((d) => d.path === st.cur);
      this.activate(cur || this.cur || this.docs[0] || null);
    } finally {
      this._restoring = false;
    }
  };
  /** edits: the tab turns red (unsaved); chunks are marked again */
  P._docChanged = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    const dirty = !d.cmDoc.isClean(d.gen);
    if (dirty !== d.dirty) {
      d.dirty = dirty;
      this._renderSrcTabs();
    }
    if (isMd(d.kind)) {
      clearTimeout(this._decT);
      this._decT = setTimeout(() => this._decorate(d), 200);
    }
  };

  /* ================= saving ================= */
  P.save = async function (d) {
    d = d && d.type ? d : this.cur;
    if (!d || d.type !== 'code') return false;
    if (!d.path) return this.saveAs(d);
    const text = d.cmDoc.getValue();
    d.saving = true;
    try {
      this.fs.writeText(d.path, text);
    } catch (e) {
      toast('The file could not be saved: ' + esc(e.message), 'error');
      return false;
    } finally {
      d.saving = false;
    }
    d.saved = text;
    d.entry = this.fs.get(d.path);
    d.gen = d.cmDoc.changeGeneration(true);
    d.dirty = false;
    const k = MG.Knit.docKind(d.path, text);
    if (k !== d.kind) {
      d.kind = k;
      if (d === this.cur) {
        this.cm.setOption('mode', modeFor(d.path, k));
        this._renderDocBar();
        this._decorate(d, true);
      }
    }
    this._renderSrcTabs();
    if (d.kind === 'notebook') this._writeNbHtml(d);
    bus.emit('rstudio:saved', { path: d.path, kind: d.kind });
    if (d.sourceOnSave && d.kind === 'r') this.sourceDoc(false, d);
    if (d.renderOnSave && d.kind === 'qmd') this.knit(d);
    return true;
  };
  P.saveAs = async function (d) {
    d = d && d.type ? d : this.cur;
    if (!d || d.type !== 'code') return false;
    const ext = (KINDS[d.kind] || KINDS.text).ext;
    const def = d.path ? MG.path.basename(d.path) : d.name + ext;
    const dir = d.path ? MG.path.dirname(d.path) : this.filesDir || MG.app.HOME;
    let p = await this._fileDialog({ title: 'Save File', mode: 'save', dir, name: def });
    if (!p) return false;
    if (!/\.[A-Za-z0-9]+$/.test(MG.path.basename(p))) p += ext;
    if (this.fs.isDir(p)) {
      toast('That is a folder, not a file. Please choose a file name.', 'warn');
      return false;
    }
    if (this.fs.exists(p) && p !== d.path && !(await MG.confirmBox('Confirm Overwrite', `<p><b>${esc(this.fs.pretty(p))}</b> already exists. Do you want to replace it?</p>`, 'Replace', { danger: true }))) return false;
    const other = this.docs.find((x) => x !== d && x.path === p);
    if (other) {
      this.docs.splice(this.docs.indexOf(other), 1);
      if (other.view) other.view.remove();
    }
    d.path = p;
    d.name = MG.path.basename(p);
    d.kind = MG.Knit.docKind(p, d.cmDoc.getValue());
    if (d === this.cur) this.cm.setOption('mode', modeFor(p, d.kind));
    this.fs.mkdirp(MG.path.dirname(p));
    const ok = await this.save(d);
    if (d === this.cur) {
      this._renderDocBar();
      this._decorate(d, true);
    }
    this._saveOpen();
    return ok;
  };
  P.saveAll = async function () {
    for (const d of this.docs.slice()) if (d.type === 'code' && d.dirty && !(await this.save(d))) return false;
    return true;
  };
  /** an R Notebook's NAME.nb.html: the text, the code and the outputs of the chunks as they are */
  P._writeNbHtml = function (d) {
    if (!d.path) return null;
    const text = d.cmDoc.getValue();
    const doc = d.cmDoc;
    const outputs = {};
    MG.Knit.chunks(text).forEach((c, k) => {
      const o = d.outs.find((x) => x.widget.line && doc.getLineNumber(x.widget.line) === c.to);
      if (o) outputs[k] = o.items.map((it) => (it.type === 'plot' ? { type: 'plot', src: it.plot.png() } : { type: 'text', text: it.text, stream: it.stream === 'err' ? 'err' : 'out' }));
    });
    const nb = d.path.replace(/\.[^./]+$/, '') + '.nb.html';
    this.fs.writeText(nb, MG.Knit.notebookHtml(d.path, text, outputs));
    return nb;
  };

  /* ================= the toolbar and status bar of a document ================= */
  P._renderDocBar = function () {
    const d = this.cur;
    const B = this.docBar;
    B.innerHTML = '';
    if (!d || d.type !== 'code') return;
    const tb = (icon, title, fn, label, cls) => {
      const b = h('button.rs-tb' + (cls || ''), { type: 'button', title, 'aria-label': title, html: IC(icon) + (label ? `<span>${esc(label)}</span>` : '') });
      b.addEventListener('click', (e) => fn(e.currentTarget));
      return b;
    };
    const caret = (title, items) => {
      const b = h('button.rs-tb.rs-caret', { type: 'button', title, 'aria-label': title, html: '<span class="caret">▾</span>' });
      b.addEventListener('click', () => MG.popmenu(b, items()));
      return b;
    };
    const check = (label, title, val, fn) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!val;
      cb.addEventListener('change', () => fn(cb.checked));
      return h('label', { title }, cb, label);
    };
    const sep = () => h('span.rs-tsep');
    B.append(tb('save', 'Save current document (Ctrl+S)', () => this.save(d), '', '.blue'));
    if (d.kind === 'r') B.append(check('Source on Save', 'Run source() on the script each time it is saved', d.sourceOnSave, (v) => ((d.sourceOnSave = v), this._saveOpen())));
    if (d.kind === 'qmd') B.append(check('Render on Save', 'Render the document each time it is saved', d.renderOnSave, (v) => ((d.renderOnSave = v), this._saveOpen())));
    B.append(sep(), tb('search', 'Find and replace (Ctrl+F)', () => this.find()), tb('wand', 'Code tools', (b) =>
      MG.popmenu(b, [
        ['code', 'Comment/Uncomment Lines  (Ctrl+Shift+C)', () => this.cm.toggleComment()],
        ['code', 'Reindent Lines', () => this._reindent()],
        ['code', 'Insert pipe operator |>  (Ctrl+Shift+M)', () => this.cm.replaceSelection(' |> ')],
        ['code', 'Insert assignment <-  (Alt+-)', () => this.cm.replaceSelection(' <- ')]
      ]), '▾'));
    const knitting = !!this.knitting;
    if (d.kind === 'rmd') {
      const k = tb('knit', 'Knit the document to a web page (Ctrl+Shift+K)', () => this.knit(d), knitting ? 'Knitting…' : 'Knit', '.rs-knitbtn');
      k.disabled = knitting;
      B.append(sep(), k, caret('Knit options', () => [
        ['knit', 'Knit to HTML', () => this.knit(d)],
        ['knit', 'Knit to PDF', () => this._noFormat('PDF', 'a PDF needs LaTeX and pandoc')],
        ['knit', 'Knit to Word', () => this._noFormat('Word', 'a Word document needs pandoc')]
      ]), this._gearBtn(d));
    } else if (d.kind === 'notebook') {
      B.append(sep(), tb('eye', 'Preview the notebook as a web page (.nb.html), with its current outputs (Ctrl+Shift+K)', () => this.preview(d), 'Preview', '.rs-knitbtn'), caret('Preview options', () => [
        ['eye', 'Preview Notebook', () => this.preview(d)],
        ['knit', 'Knit to HTML (runs all the code in a new R session)', () => this.knit(d, { knit: true })]
      ]), this._gearBtn(d));
    } else if (d.kind === 'qmd') {
      const r = tb('arrowR', 'Render the document to a web page (Ctrl+Shift+K)', () => this.knit(d), knitting ? 'Rendering…' : 'Render', '.rs-knitbtn');
      r.disabled = knitting;
      B.append(sep(), r, this._gearBtn(d));
    } else if (d.kind === 'md') {
      B.append(sep(), tb('eye', 'Preview the Markdown as a web page', () => this.previewMd(d), 'Preview', '.rs-knitbtn'));
    }
    B.append(h('span.grow'));
    if (isMd(d.kind)) {
      B.append(tb('chunk', 'Insert a new code chunk (Ctrl+Alt+I)', () => this.insertChunk(), '', '.green'), sep(), tb('arrowUp', 'Go to the previous chunk', () => this._goChunk(-1)), tb('arrowDown', 'Go to the next chunk', () => this._goChunk(1)), sep(), tb('runline', 'Run the current line or selection (Ctrl+Enter)', () => this.runCurrent(), 'Run', '.green'), caret('Run options', () => [
        ['runline', 'Run Selected Line(s)  (Ctrl+Enter)', () => this.runCurrent()],
        ['play', 'Run Current Chunk  (Ctrl+Shift+Enter)', () => this.runChunkAtCursor()],
        ['play', 'Run Next Chunk  (Ctrl+Alt+N)', () => this.runNextChunk()],
        ['arrowUp', 'Run All Chunks Above  (Ctrl+Alt+P)', () => this.runChunksAbove()],
        ['arrowDown', 'Run Current and All Chunks Below', () => this.runChunksBelow()],
        ['reset', 'Restart R and Run All Chunks', () => this.restartRunAll()],
        ['fastforward', 'Run All  (Ctrl+Alt+R)', () => this.runAll()]
      ]));
    } else if (d.kind === 'r') {
      B.append(tb('runline', 'Run the current line or selection (Ctrl+Enter)', () => this.runCurrent(), 'Run', '.green'), tb('rerun', 'Re-run the previous code region', () => this.rerun()));
      if (isShiny(d)) B.append(sep(), tb('play', 'Run the Shiny app (in the Viewer)', () => this.runApp(d), 'Run App', '.green'));
      else
        B.append(sep(), tb('sourcefile', 'Run the whole script with source() (Ctrl+Shift+S)', () => this.sourceDoc(false, d), 'Source', '.blue'), caret('Source options', () => [
          ['sourcefile', 'Source  (Ctrl+Shift+S)', () => this.sourceDoc(false, d)],
          ['sourcefile', 'Source with Echo  (Ctrl+Shift+Enter)', () => this.sourceDoc(true, d)]
        ]));
    }
  };
  P._gearBtn = function (d) {
    const b = h('button.rs-tb', { type: 'button', title: 'Output options', 'aria-label': 'Output options', html: IC('gear') + '<span class="caret">▾</span>' });
    b.addEventListener('click', () => {
      const inline = this._inline(d);
      MG.popmenu(b, [
        [inline ? 'check' : 'minus', 'Chunk Output Inline', () => this._setOutputType(d, 'inline')],
        [inline ? 'minus' : 'check', 'Chunk Output in Console', () => this._setOutputType(d, 'console')],
        ['broom', 'Clear All Output', () => this.clearAllOutput(d)]
      ]);
    });
    return b;
  };
  P._noFormat = function (what, why) {
    MG.confirmBox(`Knit to ${what}`, `<p>Knitting to ${esc(what)} is not available in the browser, because ${esc(why)}, which can't run here. You can knit to HTML instead. That turns the document into a web page, which you can print to PDF from your browser.</p>`, 'Knit to HTML', { cancel: 'Close' }).then((ok) => ok && this.knit());
  };
  P._srcStatusUpdate = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    const c = this.cm.getCursor();
    let where = '(Top Level)';
    if (isMd(d.kind)) {
      const cs = d.chunks || [];
      const i = cs.findIndex((x) => c.line >= x.from && c.line <= x.to);
      if (i >= 0) where = `Chunk ${i + 1}${cs[i].label ? ': ' + cs[i].label : ''}`;
      else {
        where = '(Top Level)';
        for (let l = c.line; l >= Math.max(0, c.line - 400); l--) {
          const m = /^(#{1,6})\s+(.*)$/.exec(this.cm.getLine(l));
          if (m && !cs.some((x) => l > x.from && l < x.to)) {
            where = m[1] + ' ' + m[2];
            break;
          }
        }
      }
    } else if (d.kind !== 'r') where = '';
    this.srcStatus.innerHTML = '';
    this.srcStatus.append(h('span', `${c.line + 1}:${c.ch + 1}`), h('span', where), h('span.grow'), h('span.type', labelFor(d)));
  };
  /** the chunks of an R Markdown or Quarto document: grey lines, and ⚙ ▼ ▶ at the right of a chunk's first line */
  P._decorate = function (d, force) {
    if (!d || d.type !== 'code') return;
    const doc = d.cmDoc;
    const text = doc.getValue();
    // (R Markdown ⇄ R Notebook: what the output: of the header says)
    if (d.kind === 'rmd' || d.kind === 'notebook') {
      const k = MG.Knit.outputOf(d.path || 'x.Rmd', text).kind === 'notebook' ? 'notebook' : 'rmd';
      if (k !== d.kind) {
        d.kind = k;
        if (d === this.cur) this._renderDocBar();
        this._renderSrcTabs();
      }
    }
    const cs = isMd(d.kind) ? MG.Knit.chunks(text) : [];
    const sig = cs.map((c) => c.from + ':' + c.to + ':' + c.header).join('|');
    d.chunks = cs;
    if (!force && sig === d.sig) return;
    d.sig = sig;
    for (const m of d.marks) m.clear();
    d.marks = [];
    for (const lh of d.lineCls) doc.removeLineClass(lh, 'background', 'rs-chunkline');
    d.lineCls = [];
    for (const c of cs) {
      for (let l = c.from; l <= c.to; l++) {
        const lh = doc.getLineHandle(l);
        if (lh) {
          doc.addLineClass(lh, 'background', 'rs-chunkline');
          d.lineCls.push(lh);
        }
      }
      let mark = null;
      const acts = this._chunkActs(d, () => mark, c.lang);
      mark = doc.setBookmark({ line: c.from, ch: doc.getLine(c.from).length }, { widget: acts, insertLeft: true });
      d.marks.push(mark);
    }
    // (the outputs of chunks whose lines are gone go with them)
    d.outs = d.outs.filter((o) => {
      const ok = !!o.widget.line && doc.getLineNumber(o.widget.line) != null;
      if (!ok) o.widget.clear();
      return ok;
    });
    if (d === this.cur) this._srcStatusUpdate();
  };
  P._chunkActs = function (d, getMark, lang) {
    const el = h('span.rs-chunkacts');
    const chunk = () => {
      const m = getMark();
      const pos = m && m.find();
      if (!pos) return null;
      return MG.Knit.chunks(d.cmDoc.getValue()).find((c) => c.from === pos.line) || null;
    };
    const btn = (icon, title, fn, cls) => {
      const b = h('button' + (cls || ''), { type: 'button', title, 'aria-label': title, html: IC(icon) });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = chunk();
        if (c) fn(c, b);
      });
      el.appendChild(b);
      return b;
    };
    btn('gear', 'Modify chunk options', (c, b) => this._chunkOptions(d, c, b), '.opt');
    if (lang === 'r') {
      btn('arrowDown', 'Run All Chunks Above', (c) => this.runChunks(d, MG.Knit.chunks(d.cmDoc.getValue()).filter((x) => x.to < c.from)), '.above');
      btn('play', 'Run Current Chunk', (c) => this.runChunks(d, [c]), '.run');
    }
    return el;
  };
  /** the options of a chunk, as RStudio's chunk menu: what the knitted document shows of the chunk */
  P._chunkOptions = function (d, c, anchor) {
    const set = (opts) => this._setChunkOpts(d, c, opts);
    MG.popmenu(anchor, [
      ['code', 'Output: (use document default)', () => set({ echo: null, include: null, eval: null })],
      ['eye', 'Show output only  (echo = FALSE)', () => set({ echo: false, include: null, eval: null })],
      ['code', 'Show code and output  (echo = TRUE)', () => set({ echo: true, include: null, eval: null })],
      ['eyeOff', 'Show nothing, run code  (include = FALSE)', () => set({ echo: null, include: false, eval: null })],
      ['eyeOff', "Show nothing, don't run code  (eval = FALSE)", () => set({ echo: null, include: false, eval: false })],
      ['warning', 'Hide warnings  (warning = FALSE)', () => set({ warning: false })],
      ['info', 'Hide messages  (message = FALSE)', () => set({ message: false })]
    ]);
  };
  /** set options of a chunk: {name: true | false | null (taken out)}; in its header ({r label, echo=FALSE}) or, in
      Quarto, as #| lines at its top */
  P._setChunkOpts = function (d, c, opts) {
    const doc = d.cmDoc;
    if (d.kind === 'qmd') {
      // #| echo: false
      let at = c.from + 1;
      const have = {};
      while (at < c.to) {
        const m = /^#\|\s*([\w.-]+)\s*:/.exec(doc.getLine(at));
        if (!m) break;
        have[m[1]] = at;
        at++;
      }
      doc.operation(() => {
        const lines = Object.entries(opts);
        // (from the bottom up, so that line numbers stay right)
        const rm = lines.filter(([k, v]) => v == null && have[k] != null).map(([k]) => have[k]).sort((a, b) => b - a);
        for (const l of rm) doc.replaceRange('', { line: l, ch: 0 }, { line: l + 1, ch: 0 });
        for (const [k, v] of lines) {
          if (v == null) continue;
          const line = `#| ${k}: ${v ? 'true' : 'false'}`;
          const cur = Object.keys(have).includes(k) && !rm.includes(have[k]) ? have[k] - rm.filter((x) => x < have[k]).length : null;
          if (cur != null) doc.replaceRange(line, { line: cur, ch: 0 }, { line: cur, ch: doc.getLine(cur).length });
          else doc.replaceRange(line + '\n', { line: c.from + 1, ch: 0 });
        }
      });
    } else {
      const head = doc.getLine(c.from);
      const m = /^(\s*`{3,}\s*\{)([A-Za-z]+)([^}]*)(\}.*)$/.exec(head);
      if (!m) return;
      const parts = splitOpts(m[3]);
      let label = '';
      const named = [];
      parts.forEach((p, i) => {
        if (i === 0 && !/=/.test(p)) label = p;
        else if (p) named.push(p);
      });
      const out = named.filter((p) => {
        const k = p.split('=')[0].trim();
        return !(k in opts);
      });
      for (const [k, v] of Object.entries(opts)) if (v != null) out.push(`${k}=${v ? 'TRUE' : 'FALSE'}`);
      const inside = [label].concat(out).filter(Boolean).join(', ');
      doc.replaceRange(m[1] + m[2] + (inside ? ' ' + inside : '') + m[4], { line: c.from, ch: 0 }, { line: c.from, ch: head.length });
    }
    this._decorate(d, true);
  };
  /** the options of a chunk header (label, a=1, b="x, y") → ['label', 'a=1', 'b="x, y"'] */
  function splitOpts(s) {
    const out = [];
    let cur = '', depth = 0, q = null;
    for (const ch of String(s || '')) {
      if (q) {
        cur += ch;
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.length ? out : [''];
  }
  /** where the output of the chunks of a document goes: under each chunk (inline), or the console – the header's
      editor_options: chunk_output_type, else Global Options */
  P._inline = function (d) {
    if (!isMd(d.kind)) return false;
    const y = MG.Knit.frontMatter(d.cmDoc.getValue());
    const t = y.editor_options && typeof y.editor_options === 'object' ? y.editor_options.chunk_output_type : null;
    if (t === 'console') return false;
    if (t === 'inline') return true;
    return this.prefs.inline !== false;
  };
  P._setOutputType = function (d, type) {
    const doc = d.cmDoc;
    const text = doc.getValue();
    const fm = MG.Knit.splitFrontMatter(text);
    if (!fm.yaml && !/^---/.test(text)) {
      doc.replaceRange(`---\neditor_options:\n  chunk_output_type: ${type}\n---\n\n`, { line: 0, ch: 0 });
    } else {
      const L = fm.yaml.split('\n');
      const i = L.findIndex((l) => /^editor_options\s*:/.test(l));
      let y;
      if (i < 0) y = L.concat(['editor_options:', `  chunk_output_type: ${type}`]);
      else {
        let j = i + 1;
        while (j < L.length && /^\s+/.test(L[j]) && !/chunk_output_type/.test(L[j])) j++;
        if (j < L.length && /chunk_output_type/.test(L[j])) L[j] = L[j].replace(/chunk_output_type\s*:.*/, `chunk_output_type: ${type}`);
        else L.splice(i + 1, 0, `  chunk_output_type: ${type}`);
        y = L;
      }
      const end = fm.lines - 1; // the line of the closing ---
      doc.replaceRange(y.join('\n'), { line: 1, ch: 0 }, { line: end - 1, ch: doc.getLine(end - 1).length });
    }
    if (type === 'console') this.clearAllOutput(d);
    toast(type === 'console' ? 'From now on, chunk output will appear in the Console (set by <code>chunk_output_type: console</code> in the header).' : 'From now on, chunk output will appear underneath each chunk.', null, 4000);
  };
  P.clearAllOutput = function (d) {
    d = d || this.cur;
    if (!d || d.type !== 'code') return;
    for (const o of d.outs) o.widget.clear();
    d.outs = [];
  };

  /* ================= running code ================= */
  /** where code goes: the Console (shown, but the keyboard stays in the editor) */
  P._send = function (code) {
    this.consoleRun(code, { nofocus: true });
  };
  P._rContext = function (d, line) {
    if (!d || d.type !== 'code') return false;
    if (d.kind === 'r') return true;
    if (!isMd(d.kind)) return false;
    const c = this._chunkAt(d, line);
    return !!c && c.lang === 'r' && line > c.from && line < c.to;
  };
  P._chunkAt = function (d, line) {
    return MG.Knit.chunks(d.cmDoc.getValue()).find((c) => line >= c.from && line <= c.to) || null;
  };
  /** Run (Ctrl+Enter): the selection, or the statement at the cursor – then the cursor goes to the next line */
  P.runCurrent = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    if (d.kind === 'text' || d.kind === 'md') return toast('Run sends R code to the Console, so it can only be used in an R script or an R Markdown document.', 'warn');
    const doc = d.cmDoc;
    if (doc.somethingSelected()) {
      const code = doc.getSelection();
      const line = doc.getCursor('from').line;
      const c = isMd(d.kind) ? this._chunkAt(d, line) : null;
      if (c && c.lang !== 'r') return toast(`This is a ${esc(c.lang)} chunk. Only R code can be run here.`, 'warn');
      if (code.trim()) this._runCode(d, code, c);
      return;
    }
    const cur = doc.getCursor();
    let lo = 0, hi = doc.lineCount() - 1, c = null;
    if (isMd(d.kind)) {
      c = this._chunkAt(d, cur.line);
      if (!c) return; // (in the text of the document: nothing to run)
      if (c.lang !== 'r') return toast(`This is a ${esc(c.lang)} chunk. Only R code can be run here.`, 'warn');
      if (cur.line === c.from) return this.runChunks(d, [c]);
      if (cur.line === c.to) return;
      lo = c.codeFrom;
      hi = c.to - 1;
      if (hi < lo) return;
    }
    const lines = [];
    for (let i = lo; i <= hi; i++) lines.push(doc.getLine(i));
    const st = statementAt(lines, cur.line - lo);
    const code = lines.slice(st.from, st.to + 1).join('\n');
    if (code.trim()) this._runCode(d, code, c);
    let next = st.to + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    const target = lo + Math.min(next, lines.length);
    doc.setCursor({ line: Math.min(target, doc.lineCount() - 1), ch: 0 });
    this.cm.scrollIntoView(null, 60);
  };
  P._runCode = function (d, code, c) {
    this.lastRun = { d, code, c };
    if (c && this._inline(d)) {
      this.chunkQueue.push({ d, c, code });
      return this._nextChunk();
    }
    this._send(code);
  };
  /** re-run the code that was run last */
  P.rerun = function () {
    const L = this.lastRun;
    if (!L) return toast('Nothing has been run yet.', 'warn');
    this._runCode(L.d, L.code, L.c);
  };
  P.runAll = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    if (isMd(d.kind)) return this.runChunks(d, MG.Knit.chunks(d.cmDoc.getValue()));
    if (d.kind !== 'r') return toast('Run All can only be used in an R script or an R Markdown document.', 'warn');
    const code = d.cmDoc.getValue().replace(/\s+$/, '');
    if (!code.trim()) return;
    this.lastRun = { d, code };
    this._send(code);
  };
  P._shiftEnter = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    if (isMd(d.kind)) return this.runChunkAtCursor();
    if (d.kind === 'r') return this.sourceDoc(true, d);
  };
  P.runChunkAtCursor = function () {
    const d = this.cur;
    if (!d || d.type !== 'code' || !isMd(d.kind)) return;
    const c = this._chunkAt(d, d.cmDoc.getCursor().line);
    if (!c) return toast('Put the cursor in a chunk first.', 'warn');
    this.runChunks(d, [c]);
  };
  P.runNextChunk = function () {
    const d = this.cur;
    if (!d || d.type !== 'code' || !isMd(d.kind)) return;
    const line = d.cmDoc.getCursor().line;
    const c = MG.Knit.chunks(d.cmDoc.getValue()).find((x) => x.from > line);
    if (!c) return toast('There is no chunk below the cursor.', 'warn');
    d.cmDoc.setCursor({ line: c.codeFrom, ch: 0 });
    this.cm.scrollIntoView(null, 80);
    this.runChunks(d, [c]);
  };
  P.runChunksAbove = function () {
    const d = this.cur;
    if (!d || d.type !== 'code' || !isMd(d.kind)) return;
    const line = d.cmDoc.getCursor().line;
    const cs = MG.Knit.chunks(d.cmDoc.getValue());
    const here = cs.find((x) => line >= x.from && line <= x.to);
    this.runChunks(d, cs.filter((x) => x.to < (here ? here.from : line)));
  };
  P.runChunksBelow = function () {
    const d = this.cur;
    if (!d || d.type !== 'code' || !isMd(d.kind)) return;
    const line = d.cmDoc.getCursor().line;
    const cs = MG.Knit.chunks(d.cmDoc.getValue());
    const here = cs.find((x) => line >= x.from && line <= x.to);
    this.runChunks(d, cs.filter((x) => x.from >= (here ? here.from : line)));
  };
  P.restartRunAll = async function () {
    const d = this.cur;
    if (!d || d.type !== 'code' || !isMd(d.kind)) return;
    this.restart();
    await this._nextIdle();
    this.runChunks(d, MG.Knit.chunks(d.cmDoc.getValue()));
  };
  /** run chunks of a document, one after another (an error stops them, as in RStudio) */
  P.runChunks = function (d, cs) {
    const list = cs.filter((c) => c.lang === 'r');
    if (list.length < cs.length) toast('Only R chunks can be run here, so chunks in other languages have been skipped.', 'warn');
    if (!list.length) return;
    const ev = list.some((c) => /\beval\s*=\s*F(ALSE)?\b/.test(c.header) || /^#\|\s*eval:\s*false/m.test(c.code));
    if (ev) toast('A chunk with eval = FALSE still runs when you run it yourself, but it is left out when the document is knitted.', null, 4000);
    if (!this._inline(d)) {
      this.lastRun = { d, code: list.map((c) => c.code).join('\n') };
      return this._send(this.lastRun.code);
    }
    for (const c of list) this.chunkQueue.push({ d, c, code: c.code, whole: true });
    this._nextChunk();
  };
  P._nextChunk = function () {
    if (this.capture || !this.chunkQueue.length) return;
    if (!this.S || this.S.state === 'ended' || this.S.state === 'failed') {
      this.chunkQueue = [];
      return this._deadNote();
    }
    if (!this.S.idle) return; // (when R is ready: _idle)
    const job = this.chunkQueue.shift();
    if (!this.docs.includes(job.d)) return this._nextChunk();
    this._startCapture(job);
  };
  /** run code of a chunk with its output going under the chunk: R prints and draws into the output of the chunk while
      this.capture is set (the Console shows the code only) */
  P._startCapture = function (job) {
    const { d } = job;
    const doc = d.cmDoc;
    const cs = MG.Knit.chunks(doc.getValue());
    const c = cs.find((x) => x.from === job.c.from && x.header === job.c.header) || cs.find((x) => x.header === job.c.header && x.code === job.c.code) || cs.find((x) => x.header === job.c.header) || null;
    if (!c) return this._nextChunk();
    const out = this._chunkOut(d, c, true);
    out.node.classList.add('running');
    const fig = this._chunkFig(d, c);
    this.capture = { d, out, job, c, err: false, fig, page: null };
    // (a graphics device of the chunk's own: its plots go under the chunk, not into the Plots pane)
    this.S.evalVoid(`local({ w <- ${WB}; w$set("chunk_prev", grDevices::dev.cur()); w$canvas(width = ${fig.w}, height = ${fig.h}); w$set("chunk_dev", grDevices::dev.cur()) })`);
    this.lastRun = { d, code: job.code, c };
    this._send(job.code);
  };
  /** the size of a chunk's plots: fig.width × fig.height inches (7 × 5 unless the chunk says) – R's device at 72
      pixels to the inch, shown at 96 to the inch, or smaller to fit the editor */
  P._chunkFig = function (d, c) {
    const num = (re, def) => {
      const m = re.exec(c.header) || re.exec(c.code);
      return m && Number(m[1]) > 0 ? Number(m[1]) : def;
    };
    const fw = Math.min(20, num(/fig[.-]width\s*[=:]\s*([\d.]+)/, 7)), fh = Math.min(20, num(/fig[.-]height\s*[=:]\s*([\d.]+)/, 5));
    const avail = Math.max(240, (this.cm.getWrapperElement().clientWidth || 600) - 90);
    return { w: Math.round(fw * 72), h: Math.round(fh * 72), cssW: Math.round(Math.min(avail, fw * 96)) };
  };
  P._chunkOut = function (d, c, reset) {
    const doc = d.cmDoc;
    let o = d.outs.find((x) => x.widget.line && doc.getLineNumber(x.widget.line) === c.to);
    if (!o) {
      const body = h('div.rs-chunkbody');
      const x = h('button.x', { type: 'button', title: 'Clear output', 'aria-label': 'Clear the output of this chunk' }, '×');
      const node = h('div.rs-chunkout', x, body);
      o = { d, node, body, items: [], chars: 0 };
      x.addEventListener('click', () => this._removeOut(d, o));
      o.widget = doc.addLineWidget(c.to, node, { coverGutter: false, noHScroll: true });
      d.outs.push(o);
    } else if (reset) {
      o.items = [];
      o.chars = 0;
      o.cut = false;
      o.body.innerHTML = '';
    }
    return o;
  };
  P._removeOut = function (d, o) {
    o.widget.clear();
    d.outs = d.outs.filter((x) => x !== o);
  };
  P._outChanged = function (o) {
    if (o.raf || o.d !== this.cur) return;
    o.raf = requestAnimationFrame(() => {
      o.raf = 0;
      if (o.d === this.cur) o.widget.changed();
    });
  };
  P._captureOut = function (m) {
    const C = this.capture;
    if (!C) return;
    const o = C.out;
    const stream = m.stream === 'err' ? 'err' : 'out';
    if (o.chars > 200000) {
      if (!o.cut) {
        o.cut = true;
        o.body.appendChild(h('pre.err', '… There is more output, but it is not shown here.'));
      }
      return;
    }
    let last = o.items[o.items.length - 1];
    if (!last || last.type !== 'text' || last.stream !== stream) {
      last = { type: 'text', stream, text: '', el: h('pre' + (stream === 'err' ? '.err' : '')) };
      o.items.push(last);
      o.body.appendChild(last.el);
    }
    last.text += m.text;
    o.chars += m.text.length;
    last.el.appendChild(document.createTextNode(m.text));
    this._outChanged(o);
  };
  P._capturePlot = function (p) {
    const C = this.capture;
    if (p.kind === 'new') {
      C.page = null;
      return;
    }
    if (!C.page) {
      const pc = new MG.PlotCanvas(C.fig.w * 2, C.fig.h * 2);
      pc.canvas.style.width = C.fig.cssW + 'px';
      const item = { type: 'plot', plot: pc };
      C.out.items.push(item);
      C.out.body.appendChild(pc.canvas);
      C.page = item;
    }
    C.page.plot.draw(p.image);
    this._outChanged(C.out);
  };
  P._captureError = function () {
    if (!this.capture) return;
    this.capture.err = true;
    if (this.S) this.S.clearQueue();
  };
  P._captureEnd = function (abort) {
    const C = this.capture;
    if (!C) return;
    this.capture = null;
    C.out.node.classList.remove('running');
    // (an error in a chunk: it can be sent to the AI assistant)
    if (C.err && !abort && MG.Assistant && C.out.items.length) {
      const texts = C.out.items.filter((it) => it.type === 'text');
      const errAt = texts.map((it) => it.stream === 'err' && /\bError\b/.test(it.text)).lastIndexOf(true);
      const error = errAt >= 0 ? texts[errAt].text.slice(-2000) : '';
      const output = texts.slice(0, Math.max(0, errAt)).map((it) => it.text).join('').slice(-1500);
      const b = h('button.rc-ask', { type: 'button', title: 'Send the chunk and its error message to the AI assistant' }, '✦ Ask the AI assistant about this error');
      b.addEventListener('click', () => {
        b.disabled = true;
        bus.emit('r:ask', { where: 'rstudio', code: C.job.code, error: error.trim(), output });
      });
      C.out.body.appendChild(h('div.rc-askrow', b));
    }
    if (!C.out.items.length) this._removeOut(C.d, C.out);
    else this._outChanged(C.out);
    if (this.S && !abort) this.S.evalVoid(`local({ w <- ${WB}; d <- w$chunk_dev; if (!is.null(d) && d %in% grDevices::dev.list()) grDevices::dev.off(d); p <- w$chunk_prev; if (!is.null(p) && p > 1 && p %in% grDevices::dev.list()) grDevices::dev.set(p); w$set("chunk_dev", NULL) })`);
    if (C.err || abort) this.chunkQueue = [];
    bus.emit('rstudio:chunk', { path: C.d.path || '', name: C.d.name, label: C.c.label || '', ok: !C.err, kind: C.d.kind, outputs: C.out.items.length, whole: !!C.job.whole });
    if (!abort) this._nextChunk();
  };
  P._nextIdle = function () {
    return new Promise((resolve) => {
      const S = this.S;
      if (!S) return resolve();
      const offs = [];
      const done = () => {
        offs.forEach((f) => f());
        resolve();
      };
      offs.push(S.on('idle', done), S.on('ended', done));
    });
  };
  /** Source: the script is saved, and run with source() in the Console */
  P.sourceDoc = async function (echo, d) {
    d = d && d.type ? d : this.cur;
    if (!d || d.type !== 'code') return;
    if (isMd(d.kind)) return toast("R Markdown and Quarto documents can't be sourced. Use Knit (or Render) to run the whole document, or the Run menu to run its chunks.", 'warn');
    if (d.kind !== 'r') return toast('Source only works with an R script (a .R file).', 'warn');
    let p = d.path;
    if (!p) {
      // (as RStudio: an untitled script is written to ~/.active-rstudio-document, and that is sourced)
      p = MG.app.HOME + '/.active-rstudio-document';
      this.fs.writeText(p, d.cmDoc.getValue());
    } else if (d.dirty && !(await this.save(d))) return;
    this._send(`source(${rstr(this.fs.pretty(p))}${echo ? ', echo = TRUE' : ''})`);
    bus.emit('rstudio:source', { path: d.path || '', echo: !!echo });
  };
  P.insertChunk = function (lang) {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    if (!isMd(d.kind) && d.kind !== 'md') return toast('Chunks can only be inserted into R Markdown and Quarto documents.', 'warn');
    const doc = d.cmDoc;
    const cur = doc.getCursor();
    const head = '```{' + (lang || 'r') + '}';
    const inChunk = isMd(d.kind) ? this._chunkAt(d, cur.line) : null;
    if (inChunk && cur.line > inChunk.from && cur.line < inChunk.to) {
      // (in a chunk: as RStudio, the chunk is split in two here)
      doc.replaceRange('```\n\n' + head + '\n', { line: cur.line, ch: 0 });
      doc.setCursor({ line: cur.line + 3, ch: 0 });
    } else if (!doc.getLine(cur.line).trim()) {
      doc.replaceRange(head + '\n\n```', { line: cur.line, ch: 0 }, { line: cur.line, ch: doc.getLine(cur.line).length });
      doc.setCursor({ line: cur.line + 1, ch: 0 });
    } else {
      const end = doc.getLine(cur.line).length;
      doc.replaceRange('\n\n' + head + '\n\n```\n', { line: cur.line, ch: end });
      doc.setCursor({ line: cur.line + 3, ch: 0 });
    }
    this._decorate(d, true);
    this.cm.focus();
  };
  P._goChunk = function (dir) {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    const line = d.cmDoc.getCursor().line;
    const cs = MG.Knit.chunks(d.cmDoc.getValue());
    const c = dir > 0 ? cs.find((x) => x.from > line) : cs.filter((x) => x.to < line).pop();
    if (!c) return;
    d.cmDoc.setCursor({ line: c.codeFrom, ch: 0 });
    this.cm.scrollIntoView(null, 80);
    this.cm.focus();
  };
  P._reindent = function () {
    const cm = this.cm;
    const from = cm.getCursor('from').line, to = cm.getCursor('to').line;
    cm.operation(() => {
      for (let l = from; l <= to; l++) cm.indentLine(l, 'smart');
    });
  };
  P.setwdSource = function () {
    const d = this.cur;
    if (!d || !d.path) return toast('Save the document first – it has no folder until it has been saved.', 'warn');
    this.consoleRun(`setwd(${rstr(this.fs.pretty(MG.path.dirname(d.path)))})`);
  };
  P.chooseDir = async function () {
    const p = await this._fileDialog({ title: 'Choose Working Directory', mode: 'dir', dir: (this.S && this.S.wd) || MG.app.HOME });
    if (p) this.consoleRun(`setwd(${rstr(this.fs.pretty(p))})`);
  };
  P.loadWorkspace = async function () {
    const p = await this._fileDialog({ title: 'Load Workspace', mode: 'open', filter: /\.(rdata|rda)$/i, dir: (this.S && this.S.wd) || MG.app.HOME, hidden: true });
    if (p) this.consoleRun(`load(${rstr(this.fs.pretty(p))})`);
  };
  P.saveWorkspace = async function () {
    const p = await this._fileDialog({ title: 'Save Workspace As', mode: 'save', name: '.RData', dir: (this.S && this.S.wd) || MG.app.HOME });
    if (p) this.consoleRun(`save.image(${rstr(this.fs.pretty(p))})`);
  };
  /** Knit (R Markdown) or Render (Quarto): saved, then run from the top in a new R; the page shows in the Viewer */
  P.knit = async function (d, opts = {}) {
    d = d && d.type ? d : this.cur;
    if (!d || d.type !== 'code') return toast('Open an R Markdown (.Rmd) or Quarto (.qmd) document to knit it.', 'warn');
    if (d.kind === 'notebook' && !opts.knit) return this.preview(d);
    if (d.kind === 'md') return this.previewMd(d);
    if (!isMd(d.kind)) return toast(`Knit turns an R Markdown (.Rmd) or Quarto (.qmd) document into a web page, so it can't be used on ${esc(kindPhrase(d))}.`, 'warn');
    if (this.knitting) return toast('A document is already being knitted. Please wait until it has finished.', 'warn');
    if ((!d.path || d.dirty) && !(await this.save(d))) return;
    const verb = d.kind === 'qmd' ? 'Rendering' : 'Knitting';
    if (!(await this._needPkgs(['knitr', 'markdown'], verb))) return;
    this.knitting = true;
    if (d === this.cur) this._renderDocBar();
    this.showTab('console', 'jobs');
    this.jobLog.innerHTML = '';
    this._jobLine = null;
    this._job(`${verb} ${this.fs.pretty(d.path)} in a new R session…\n`);
    try {
      const r = await MG.Knit.render(d.path, { onLog: (t, s) => this._job(t, s === 'err' ? 'err' : s === 'done' ? 'done' : '') });
      if (r.ok) {
        this.viewFile(r.output);
        bus.emit('rstudio:knit', { path: d.path, output: r.output, kind: d.kind });
      } else {
        this._job(`\n${verb} stopped at the error above. The document is run from the beginning in a new R session, so it must create or load everything it uses itself. Objects that exist only in the Console are not available to it.\n`, 'note');
        bus.emit('rstudio:knit', { path: d.path, output: null, kind: d.kind, failed: true });
      }
    } finally {
      this.knitting = false;
      if (d === this.cur) this._renderDocBar();
    }
  };
  /** an R Notebook's Preview: its .nb.html (written when it is saved) in the Viewer */
  P.preview = async function (d) {
    d = d && d.type ? d : this.cur;
    if (!d || d.type !== 'code') return;
    if (!d.path || d.dirty) {
      if (!(await this.save(d))) return;
    } else this._writeNbHtml(d);
    const nb = d.path.replace(/\.[^./]+$/, '') + '.nb.html';
    this.viewFile(nb);
    bus.emit('rstudio:preview', { path: d.path, output: nb });
  };
  /** a Markdown file as a web page */
  P.previewMd = async function (d) {
    if ((!d.path || d.dirty) && !(await this.save(d))) return;
    const body = MG.renderMarkdownSafe ? MG.renderMarkdownSafe(d.cmDoc.getValue()) : '<pre>' + esc(d.cmDoc.getValue()) + '</pre>';
    const out = d.path.replace(/\.[^./]+$/, '') + '.html';
    this.fs.writeText(out, `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(d.name)}</title><style>body{font-family:system-ui,sans-serif;max-width:780px;margin:24px auto;padding:0 16px;line-height:1.5;color:#222}pre{background:#f6f8fa;padding:8px;border-radius:4px;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace}</style></head><body>\n${body}\n</body></html>\n`);
    this.viewFile(out);
  };
  /** packages that something needs: if one is not installed, ask, and install it in the Console → true when they are there */
  P._needPkgs = async function (pkgs, what) {
    const miss = pkgs.filter((p) => !MG.R.userlib.list().includes(p));
    if (!miss.length) return true;
    const n = miss.length;
    const ok = await MG.confirmBox('Install Required Packages', `<p>${esc(what)} needs the package${n > 1 ? 's' : ''} ${miss.map((p) => `<code>${esc(p)}</code>`).join(' and ')}, which ${n > 1 ? 'are' : 'is'} not installed yet. Do you want to install ${n > 1 ? 'them' : 'it'} now?</p><p class="muted">Installing takes a moment, but you only have to do it once. After that, every R session in the workbench can use ${n > 1 ? 'them' : 'it'}. You can follow the installation in the Console.</p>`, 'Install');
    if (!ok) return false;
    if (!this.S || this.S.state === 'ended' || this.S.state === 'failed') {
      this._deadNote();
      return false;
    }
    const idle = this._nextIdle();
    this.consoleRun(`install.packages(${n === 1 ? rstr(miss[0]) : 'c(' + miss.map(rstr).join(', ') + ')'})`);
    await idle;
    const still = pkgs.filter((p) => !MG.R.userlib.list().includes(p));
    if (still.length) {
      toast(`${esc(still.join(', '))} could not be installed. See the Console for the reason.`, 'error');
      return false;
    }
    return true;
  };
  /** a Shiny app: run in the Console's R, shown in the Viewer (shiny.js) */
  P.runApp = async function (d) {
    d = d && d.type ? d : this.cur;
    if (!d) return;
    if ((!d.path || d.dirty) && !(await this.save(d))) return;
    if (!(await this._needPkgs(['shiny'], 'A Shiny app'))) return;
    const dir = MG.path.dirname(d.path);
    const isApp = /(^|\/)(app|server|ui)\.R$/i.test(d.path);
    this._send(isApp ? `shiny::runApp(${rstr(this.fs.pretty(dir))})` : `shiny::runApp(${rstr(this.fs.pretty(d.path))})`);
  };

  /* ================= new documents ================= */
  P.newDocDialog = function (kind) {
    if (kind === 'notebook') return this.newDoc('notebook', RS.rmdTemplate('R Notebook', '', 'notebook'));
    const q = kind === 'qmd';
    const m = MG.modal(q ? 'New Quarto Document' : 'New R Markdown', '');
    m.box.classList.add('rs-dialog', 'rs-newdoc');
    const B = m.box.querySelector('.modal-b');
    const nm = MG.user.name();
    const title = h('input', { type: 'text', value: 'Untitled', 'aria-label': 'Title', spellcheck: 'false' });
    const author = h('input', { type: 'text', value: nm === MG.user.DEFAULT ? '' : nm.replace(/[._]+/g, ' '), 'aria-label': 'Author', spellcheck: 'false' });
    let fmt = 'html';
    const opts = h('div.opts');
    const formats = [
      ['html', 'HTML', 'Recommended format for authoring (you can switch to PDF or Word output anytime).'],
      ['pdf', 'PDF', `PDF output needs LaTeX, which is not available in the browser, so here the document will be ${q ? 'rendered' : 'knitted'} to HTML.`],
      ['word', 'Word', `Word output needs pandoc, which is not available in the browser, so here the document will be ${q ? 'rendered' : 'knitted'} to HTML.`]
    ];
    for (const [k, label, note] of formats) {
      const r = h('input', { type: 'radio', name: 'rs-fmt', value: k });
      r.checked = k === 'html';
      const o = h('label.opt' + (k === 'html' ? '.on' : ''), r, h('span', h('b', label), h('br'), h('small.muted', note)));
      r.addEventListener('change', () => {
        fmt = k;
        opts.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === o));
      });
      opts.appendChild(o);
    }
    const empty = h('button.btn', { type: 'button' }, 'Create Empty Document');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const ok = h('button.btn.primary', { type: 'button' }, q ? 'Create' : 'OK');
    B.append(h('label.row', h('span', 'Title:'), title), h('label.row', h('span', 'Author:'), author), h('p', { style: { margin: '10px 0 6px', fontWeight: '600', fontSize: '0.9rem' } }, 'Default Output Format:'), opts, h('div.prompt-actions', empty, h('span.grow'), cancel, ok));
    cancel.addEventListener('click', () => m.close());
    empty.addEventListener('click', () => {
      m.close();
      this.newDoc(q ? 'qmd' : 'rmd', '');
    });
    ok.addEventListener('click', () => {
      m.close();
      const t = title.value.replace(/"/g, "'") || 'Untitled';
      const a = author.value.replace(/"/g, "'");
      let text = q ? RS.qmdTemplate(t, a) : RS.rmdTemplate(t, a, 'rmd');
      if (fmt !== 'html') text = q ? text.replace('format: html', 'format: ' + (fmt === 'word' ? 'docx' : 'pdf')) : text.replace('output: html_document', 'output: ' + (fmt === 'word' ? 'word_document' : 'pdf_document'));
      if (!a) text = text.replace(/^author: ""\n/m, '');
      this.newDoc(q ? 'qmd' : 'rmd', text);
    });
    setTimeout(() => {
      title.focus();
      title.select();
    }, 40);
  };
  P.newShinyDialog = async function () {
    const name = await MG.promptText('New Shiny Web Application', 'Enter a name for the application. A new folder with this name will be created in your home folder to hold the app (app.R).', 'myapp', 'Create');
    if (!name) return;
    const safe = name.replace(/[^\w.-]+/g, '_');
    const dir = MG.app.HOME + '/' + safe;
    if (this.fs.exists(dir + '/app.R')) {
      toast(`There is already an app in ~/${esc(safe)}, so that one has been opened.`, 'warn');
      return this.openFile(dir + '/app.R');
    }
    this.fs.mkdirp(dir);
    this.fs.writeText(dir + '/app.R', RS.SHINY_TEMPLATE);
    bus.emit('rstudio:new', { kind: 'shiny', name: safe });
    return this.openFile(dir + '/app.R');
  };
  P.openDialog = async function () {
    const p = await this._fileDialog({ title: 'Open File', mode: 'open', dir: this.cur && this.cur.path ? MG.path.dirname(this.cur.path) : this.filesDir });
    if (p) this.openFile(p);
  };

  /* ================= what R opens in Source: data, text ================= */
  P._viewData = function (data) {
    let d = this.docs.find((x) => x.type === 'data' && x.name === data.title);
    if (d) {
      if (d.grid) d.grid.destroy();
      d.view.innerHTML = '';
    } else {
      d = { id: ++seq, type: 'data', name: data.title, view: h('div.rs-dataview') };
      this.docs.push(d);
      this.srcOther.appendChild(d.view);
    }
    d.data = data;
    this.activate(d);
    d.grid = new MG.DataGrid(d.view, data, { filters: false });
  };
  P._pager = function (p) {
    const name = p.title || 'R Information';
    let d = this.docs.find((x) => x.type === 'text' && x.name === name);
    if (!d) {
      d = { id: ++seq, type: 'text', name, view: h('div.rs-textview') };
      this.docs.push(d);
      this.srcOther.appendChild(d.view);
    }
    d.view.innerHTML = '';
    const pre = h('pre.rtext');
    if (p.view) pre.innerHTML = MG.Knit.highlight(p.text, 'r');
    else pre.textContent = p.text;
    d.view.appendChild(pre);
    this.activate(d);
  };

  /* ================= find and replace ================= */
  P.find = function () {
    const d = this.cur;
    if (!d || d.type !== 'code') return;
    const F = this.findBar;
    if (!this.findIn) {
      this.findIn = h('input', { type: 'text', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
      this.replIn = h('input', { type: 'text', placeholder: 'Replace', 'aria-label': 'Replace with', spellcheck: 'false' });
      this.findCase = h('input', { type: 'checkbox' });
      this.findRe = h('input', { type: 'checkbox' });
      this.findMsg = h('span.msg');
      const b = (label, title, fn) => {
        const x = h('button.rs-tb', { type: 'button', title }, label);
        x.addEventListener('click', fn);
        return x;
      };
      const close = h('button.rs-tb', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close the find bar', html: IC('x') });
      close.addEventListener('click', () => this._findClose());
      F.append(this.findIn, b('Next', 'Find the next match (Enter)', () => this._findGo(false)), b('Prev', 'Find the previous match (Shift+Enter)', () => this._findGo(true)), h('span.rs-tsep'), this.replIn, b('Replace', 'Replace this match (Enter in Replace)', () => this._replace()), b('All', 'Replace all matches', () => this._replaceAll()), h('span.rs-tsep'), h('label', this.findCase, 'Match case'), h('label', this.findRe, 'Regex'), this.findMsg, h('span.grow'), close);
      const keys = (inp, enter) =>
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            enter(e);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this._findClose();
          }
        });
      keys(this.findIn, (e) => this._findGo(e.shiftKey));
      keys(this.replIn, () => this._replace());
      this.findIn.addEventListener('input', () => this._findCount());
      this.findCase.addEventListener('change', () => this._findCount());
      this.findRe.addEventListener('change', () => this._findCount());
    }
    const was = F.hidden;
    F.hidden = false;
    const sel = this.cm.getSelection();
    if (sel && !sel.includes('\n')) this.findIn.value = sel;
    this.findIn.focus();
    this.findIn.select();
    this._findCount();
    if (was) this.cm.refresh();
  };
  P._findClose = function () {
    this.findBar.hidden = true;
    this.cm.refresh();
    this.cm.focus();
  };
  P._query = function () {
    const q = this.findIn.value;
    if (!q) return null;
    if (!this.findRe.checked) return q;
    try {
      return new RegExp(q, this.findCase.checked ? 'g' : 'gi');
    } catch (e) {
      this.findMsg.textContent = 'not a valid regular expression';
      return null;
    }
  };
  P._findCount = function () {
    const q = this._query();
    if (q == null) {
      if (!this.findIn.value) this.findMsg.textContent = '';
      return 0;
    }
    let n = 0;
    const c = this.cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: !this.findCase.checked });
    while (n < 1000 && c.findNext()) n++;
    this.findMsg.textContent = n ? `${n >= 1000 ? '1000+' : n} match${n === 1 ? '' : 'es'}` : 'no matches';
    return n;
  };
  P._findGo = function (rev) {
    const q = this._query();
    if (q == null) return false;
    const cm = this.cm;
    const o = { caseFold: !this.findCase.checked };
    let c = cm.getSearchCursor(q, rev ? cm.getCursor('from') : cm.getCursor('to'), o);
    if (!c.find(rev)) {
      c = cm.getSearchCursor(q, rev ? { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length } : { line: 0, ch: 0 }, o);
      if (!c.find(rev)) {
        this.findMsg.textContent = 'no matches';
        return false;
      }
    }
    cm.setSelection(c.from(), c.to());
    cm.scrollIntoView({ from: c.from(), to: c.to() }, 80);
    return true;
  };
  P._replace = function () {
    const q = this._query();
    if (q == null) return;
    const cm = this.cm;
    if (cm.somethingSelected()) {
      const c = cm.getSearchCursor(q, cm.getCursor('from'), { caseFold: !this.findCase.checked });
      if (c.findNext() && window.CodeMirror.cmpPos(c.from(), cm.getCursor('from')) === 0 && window.CodeMirror.cmpPos(c.to(), cm.getCursor('to')) === 0) c.replace(this.replIn.value);
    }
    this._findGo(false);
    this._findCount();
  };
  P._replaceAll = function () {
    const q = this._query();
    if (q == null) return;
    const cm = this.cm;
    let n = 0;
    cm.operation(() => {
      const c = cm.getSearchCursor(q, { line: 0, ch: 0 }, { caseFold: !this.findCase.checked });
      while (c.findNext()) {
        c.replace(this.replIn.value);
        n++;
      }
    });
    this._findCount();
    this.findMsg.textContent = `${n} replaced`;
  };

  /* ================= completion (Tab) ================= */
  P._tab = function (cm) {
    const d = this.cur;
    const pos = cm.getCursor();
    const before = cm.getLine(pos.line).slice(0, pos.ch);
    if (cm.somethingSelected()) return cm.execCommand('indentMore');
    if (!/[\w.$@:"'/~]$/.test(before) || !this._rContext(d, pos.line) || !this.S || !this.S.idle) return cm.execCommand('insertSoftTab');
    this.S.complete(before, before.length).then((r) => {
      if (!r || !r.items.length || cm.getDoc() !== d.cmDoc) return;
      const now = cm.getCursor();
      if (now.line !== pos.line || now.ch !== pos.ch) return;
      const token = r.token || '';
      const items = r.items.slice(0, 200);
      if (items.length === 1) return cm.replaceRange(items[0], { line: pos.line, ch: pos.ch - token.length }, pos);
      const common = items.reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(0, i);
      });
      if (common.length > token.length) cm.replaceRange(common, { line: pos.line, ch: pos.ch - token.length }, pos);
      const at = cm.getCursor();
      this._srcPop(cm, at, common.length > token.length ? common : token, items);
    });
  };
  P._srcPop = function (cm, pos, token, items) {
    this._srcPopClose();
    const pop = h('div.rs-cpop', { role: 'listbox', 'aria-label': 'Completions' });
    let i = 0;
    const put = (it) => {
      cm.replaceRange(it, { line: pos.line, ch: pos.ch - token.length }, pos);
      this._srcPopClose();
      cm.focus();
    };
    items.forEach((it, k) => {
      const r = h('div.rs-cpopi' + (k === 0 ? '.on' : ''), { role: 'option' }, it);
      r.addEventListener('mousedown', (e) => {
        e.preventDefault();
        put(it);
      });
      pop.appendChild(r);
    });
    document.body.appendChild(pop);
    const c = cm.cursorCoords(pos, 'window');
    pop.style.left = Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 8, c.left - 4)) + 'px';
    const below = c.bottom + 2 + pop.offsetHeight < window.innerHeight;
    pop.style.top = (below ? c.bottom + 2 : Math.max(4, c.top - 2 - pop.offsetHeight)) + 'px';
    const move = (k) => {
      i = (i + k + items.length) % items.length;
      Array.from(pop.children).forEach((x, j) => x.classList.toggle('on', j === i));
      pop.children[i].scrollIntoView({ block: 'nearest' });
    };
    const km = { Up: () => move(-1), Down: () => move(1), Enter: () => put(items[i]), Tab: () => put(items[i]), Esc: () => this._srcPopClose() };
    const off = () => this._srcPopClose();
    cm.addKeyMap(km);
    setTimeout(() => {
      if (this._pop && this._pop.pop === pop) {
        cm.on('blur', off);
        cm.on('cursorActivity', off);
      }
    }, 0);
    this._pop = { pop, km, cm, off };
  };
  P._srcPopClose = function () {
    const Q = this._pop;
    if (!Q) return;
    this._pop = null;
    Q.pop.remove();
    Q.cm.removeKeyMap(Q.km);
    Q.cm.off('blur', Q.off);
    Q.cm.off('cursorActivity', Q.off);
  };

  /* ================= Import Dataset ================= */
  /** readr's, base R's or readxl's import, with a preview of the data and of the code it runs */
  P.importDialog = async function (kind, path) {
    kind = kind || 'readr';
    const fs = this.fs;
    const excel = kind === 'excel';
    const m = MG.modal(excel ? 'Import Excel Data' : kind === 'base' ? 'Import Dataset (base R)' : 'Import Text Data', '');
    m.box.classList.add('rs-dialog', 'wide', 'rs-import');
    const B = m.box.querySelector('.modal-b');
    const fileIn = h('input', { type: 'text', value: path ? fs.pretty(path) : '', placeholder: excel ? '~/data/penguins.xlsx' : '~/data/penguins.csv', 'aria-label': 'File', spellcheck: 'false' });
    const browse = h('button.btn', { type: 'button' }, 'Browse…');
    const update = h('button.btn', { type: 'button' }, 'Update');
    const preview = h('div.preview', h('div.rs-empty', 'Choose a file to see its first rows.'));
    const nameIn = h('input', { type: 'text', value: '', 'aria-label': 'Name', spellcheck: 'false' });
    const skipIn = h('input', { type: 'number', value: '0', min: '0', 'aria-label': 'Rows to skip', style: { width: '5em' } });
    const header = h('input', { type: 'checkbox' });
    header.checked = true;
    const viewer = h('input', { type: 'checkbox' });
    viewer.checked = true;
    const sel = (label, opts) => h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v }, t)));
    const delim = sel('Delimiter', [['comma', 'Comma'], ['semicolon', 'Semicolon'], ['tab', 'Tab'], ['whitespace', 'Whitespace']]);
    const naSel = sel('NA', excel || kind === 'readr' ? [['default', 'Default'], ['NA', 'NA'], ['empty', 'empty']] : [['NA', 'NA'], ['empty', 'empty'], ['both', 'NA or empty']]);
    const sheetSel = sel('Sheet', [['', 'Default']]);
    const factors = h('input', { type: 'checkbox' });
    const codeEl = h('pre.code');
    const ok = h('button.btn.primary', { type: 'button' }, 'Import');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const row = (label, el) => h('label.row', h('span', label), el);
    const chk = (el, label) => h('label.check', el, ' ', label);
    const opts = h('div.cols', row('Name:', nameIn), row('Skip:', skipIn), excel ? row('Sheet:', sheetSel) : row(kind === 'base' ? 'Separator:' : 'Delimiter:', delim), row('NA:', naSel), chk(header, kind === 'base' ? 'Heading (first row as names)' : 'First Row as Names'), chk(viewer, 'Open Data Viewer'), kind === 'base' ? chk(factors, 'Strings as factors') : null);
    B.append(h('div.rs-filerow', h('span', 'File:'), fileIn, browse, update), h('div.rs-sub', 'Data Preview:'), preview, h('div.rs-sub', 'Import Options:'), opts, h('div.rs-sub', 'Code Preview:'), codeEl, h('div.prompt-actions', cancel, ok));
    let cur = null; // {path, rows, sheets}
    const ident = (s) => {
      let v = String(s || 'dataset').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._]+/g, '_');
      if (!/^[A-Za-z.]/.test(v) || /^\.\d/.test(v)) v = 'X' + v;
      return v;
    };
    const rel = (p) => {
      const wd = this.S && this.S.wd;
      return wd && p.startsWith(wd + '/') ? p.slice(wd.length + 1) : fs.pretty(p);
    };
    const code = () => {
      if (!cur) return '';
      const nm = nameIn.value.trim() || 'dataset';
      const v = /^[A-Za-z.][\w.]*$/.test(nm) ? nm : '`' + nm + '`';
      const f = rstr(rel(cur.path));
      const skip = Math.max(0, parseInt(skipIn.value, 10) || 0);
      const args = [];
      let lib = '', call;
      if (excel) {
        lib = 'library(readxl)\n';
        if (sheetSel.value) args.push(`sheet = ${rstr(sheetSel.value)}`);
        if (skip) args.push(`skip = ${skip}`);
        if (!header.checked) args.push('col_names = FALSE');
        if (naSel.value === 'NA') args.push('na = "NA"');
        else if (naSel.value === 'empty') args.push('na = ""');
        call = `read_excel(${[f].concat(args).join(', ')})`;
      } else if (kind === 'readr') {
        lib = 'library(readr)\n';
        const fn = { comma: 'read_csv', semicolon: 'read_csv2', tab: 'read_tsv', whitespace: 'read_table' }[delim.value];
        if (!header.checked) args.push('col_names = FALSE');
        if (skip) args.push(`skip = ${skip}`);
        if (naSel.value === 'NA') args.push('na = "NA"');
        else if (naSel.value === 'empty') args.push('na = ""');
        call = `${fn}(${[f].concat(args).join(', ')})`;
      } else {
        const fn = { comma: 'read.csv', semicolon: 'read.csv2', tab: 'read.delim', whitespace: 'read.table' }[delim.value];
        if (fn === 'read.table' ? header.checked : !header.checked) args.push(`header = ${header.checked ? 'TRUE' : 'FALSE'}`);
        if (skip) args.push(`skip = ${skip}`);
        if (naSel.value === 'empty') args.push('na.strings = ""');
        else if (naSel.value === 'both') args.push('na.strings = c("NA", "")');
        if (factors.checked) args.push('stringsAsFactors = TRUE');
        call = `${fn}(${[f].concat(args).join(', ')})`;
      }
      return `${lib}${v} <- ${call}${viewer.checked ? `\nView(${v})` : ''}`;
    };
    const show = () => {
      codeEl.textContent = code();
      preview.innerHTML = '';
      if (!cur) return preview.appendChild(h('div.rs-empty', 'Choose a file to see its first rows.'));
      if (cur.error) return preview.appendChild(h('div.rs-empty', cur.error));
      const skip = Math.max(0, parseInt(skipIn.value, 10) || 0);
      let rows = excel ? cur.rows.slice(skip) : parseDelim(cur.text, { comma: ',', semicolon: ';', tab: '\t', whitespace: 'ws' }[delim.value], 52 + skip).slice(skip);
      rows = rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
      if (!rows.length) return preview.appendChild(h('div.rs-empty', 'The file has no rows to show.'));
      const ncol = Math.max(...rows.map((r) => r.length));
      const names = header.checked ? rows[0] : Array.from({ length: ncol }, (_, i) => (excel || kind === 'readr' ? `X${i + 1}` : `V${i + 1}`));
      const body = (header.checked ? rows.slice(1) : rows).slice(0, 50);
      const na = naSel.value === 'NA' ? ['NA'] : naSel.value === 'empty' ? [''] : ['NA', ''];
      const t = h('table');
      const hr = h('tr');
      for (let j = 0; j < ncol; j++) hr.appendChild(h('th', String(names[j] == null || names[j] === '' ? `...${j + 1}` : names[j]), h('small', '(' + typeName(guessType(body.map((r) => r[j] == null ? '' : r[j]), na), kind, factors.checked) + ')')));
      t.appendChild(h('thead', hr));
      const tb = h('tbody');
      for (const r of body) {
        const tr = h('tr');
        for (let j = 0; j < ncol; j++) {
          const v = r[j] == null ? '' : r[j];
          tr.appendChild(h('td', na.includes(v) ? h('i.muted', 'NA') : v));
        }
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      preview.appendChild(t);
    };
    const load = async () => {
      const raw = fileIn.value.trim();
      if (!raw) {
        cur = null;
        return show();
      }
      const p = fs.resolve(raw, (this.S && this.S.wd) || MG.app.HOME);
      if (!fs.exists(p) || fs.isDir(p)) {
        cur = { path: p, error: `The file ${raw} does not exist.`, rows: [], text: '' };
        return show();
      }
      try {
        if (excel) {
          const want = sheetSel.value;
          const x = await readXlsx(await fs.readBytes(p), want, 60);
          sheetSel.innerHTML = '';
          sheetSel.appendChild(h('option', { value: '' }, 'Default'));
          for (const s of x.sheets) sheetSel.appendChild(h('option', { value: s }, s));
          sheetSel.value = x.sheets.includes(want) ? want : '';
          cur = { path: p, rows: x.rows, sheets: x.sheets };
        } else {
          const text = (await fs.readText(p)).slice(0, 65536);
          if (!cur || cur.path !== p) {
            // (the delimiter that the first line suggests)
            const first = text.split('\n')[0] || '';
            const n = (re) => (first.match(re) || []).length;
            delim.value = n(/\t/g) > n(/,/g) && n(/\t/g) >= n(/;/g) ? 'tab' : n(/;/g) > n(/,/g) ? 'semicolon' : 'comma';
          }
          cur = { path: p, text, rows: [] };
        }
      } catch (e) {
        cur = { path: p, error: 'The file could not be read: ' + e.message, rows: [], text: '' };
      }
      if (!nameIn.value || nameIn.dataset.auto) {
        nameIn.value = ident(MG.path.basename(p));
        nameIn.dataset.auto = '1';
      }
      show();
    };
    browse.addEventListener('click', async () => {
      const p = await this._fileDialog({ title: 'Choose File', mode: 'open', filter: excel ? /\.xlsx?$/i : /\.(csv|tsv|txt|tab|dat)$/i, dir: cur && cur.path ? MG.path.dirname(cur.path) : MG.app.HOME + '/data' });
      if (p) {
        fileIn.value = fs.pretty(p);
        nameIn.dataset.auto = '1';
        load();
      }
    });
    update.addEventListener('click', load);
    fileIn.addEventListener('keydown', (e) => e.key === 'Enter' && load());
    nameIn.addEventListener('input', () => {
      delete nameIn.dataset.auto;
      show();
    });
    for (const el of [skipIn, header, viewer, delim, naSel, factors]) el.addEventListener('change', show);
    skipIn.addEventListener('input', show);
    sheetSel.addEventListener('change', load);
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', async () => {
      if (!cur || cur.error) return toast('Choose a file to import first.', 'warn');
      const c = code();
      m.close();
      const pk = excel ? 'readxl' : kind === 'readr' ? 'readr' : null;
      if (pk && !(await this._needPkgs([pk], 'This import'))) return;
      this.consoleRun(c);
      bus.emit('rstudio:import', { kind, path: cur.path, name: nameIn.value.trim() });
    });
    if (path) load();
    else setTimeout(() => fileIn.focus(), 40);
  };
  /** delimited text → rows of fields (quotes as in CSV; 'ws': any run of spaces or tabs) */
  function parseDelim(text, sep, maxRows) {
    const rows = [];
    let row = [], f = '', q = false, quoted = false;
    const ws = sep === 'ws';
    const endField = () => {
      if (!ws || f !== '' || quoted) row.push(f);
      f = '';
      quoted = false;
    };
    for (let i = 0; i < text.length && rows.length < maxRows; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            f += '"';
            i++;
          } else q = false;
        } else f += ch;
      } else if (ch === '"' && f === '') q = quoted = true;
      else if (ws ? ch === ' ' || ch === '\t' : ch === sep) endField();
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        endField();
        rows.push(row);
        row = [];
      } else f += ch;
    }
    if ((f !== '' || row.length) && rows.length < maxRows) {
      endField();
      rows.push(row);
    }
    return rows;
  }
  function guessType(vals, na) {
    const vs = vals.filter((v) => !na.includes(v));
    if (!vs.length) return 'logical';
    if (vs.every((v) => /^(TRUE|FALSE|T|F|true|false)$/.test(v))) return 'logical';
    if (vs.every((v) => /^[-+]?\d+$/.test(v))) return 'integer';
    if (vs.every((v) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v))) return 'double';
    if (vs.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
    return 'character';
  }
  function typeName(t, kind, factors) {
    if (kind === 'base') return { logical: 'logi', integer: 'int', double: 'num', date: 'chr', character: factors ? 'Factor' : 'chr' }[t];
    return { logical: 'lgl', integer: 'dbl', double: 'dbl', date: 'date', character: 'chr' }[t];
  }
  /** the sheets of an .xlsx file and the first rows of one of them (read in the page, for the preview) */
  async function readXlsx(bytes, sheetName, maxRows) {
    if (!window.JSZip) await MG.loadScript('assets/vendor/jszip/jszip.min.js');
    const zip = await window.JSZip.loadAsync(bytes);
    const xml = async (name) => {
      const f = zip.file(name);
      return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
    };
    const wb = await xml('xl/workbook.xml');
    const rels = await xml('xl/_rels/workbook.xml.rels');
    if (!wb) throw new Error('it is not an Excel (.xlsx) workbook');
    const sheets = Array.from(wb.getElementsByTagName('sheet')).map((s) => ({ name: s.getAttribute('name'), rid: s.getAttribute('r:id') }));
    const target = (rid) => {
      const r = rels ? Array.from(rels.getElementsByTagName('Relationship')).find((x) => x.getAttribute('Id') === rid) : null;
      const t = r ? r.getAttribute('Target') : 'worksheets/sheet1.xml';
      return t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    };
    const sh = sheets.find((s) => s.name === sheetName) || sheets[0];
    const ss = await xml('xl/sharedStrings.xml');
    const strings = ss ? Array.from(ss.getElementsByTagName('si')).map((si) => Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join('')) : [];
    const doc = sh ? await xml(target(sh.rid)) : null;
    const col = (ref) => {
      let n = 0;
      for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n - 1;
    };
    const rows = [];
    if (doc) {
      for (const r of Array.from(doc.getElementsByTagName('row')).slice(0, maxRows || 60)) {
        const row = [];
        for (const c of Array.from(r.getElementsByTagName('c'))) {
          const j = col((c.getAttribute('r') || '').replace(/\d+$/, ''));
          const t = c.getAttribute('t');
          const v = c.getElementsByTagName('v')[0];
          let val = v ? v.textContent : '';
          if (t === 's') val = strings[+val] || '';
          else if (t === 'inlineStr') {
            const is = c.getElementsByTagName('t')[0];
            val = is ? is.textContent : '';
          } else if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE';
          row[j >= 0 ? j : row.length] = val;
        }
        rows.push(Array.from(row, (x) => (x == null ? '' : x)));
      }
    }
    return { sheets: sheets.map((s) => s.name), sheet: sh ? sh.name : '', rows };
  }

  /* ================= dialogs: files, options, shortcuts, about ================= */
  /** choose a file or folder in the home folder → its path, or null. o: {title, mode 'open' | 'save' | 'dir', dir,
      name (save), filter (a RegExp of the files that can be chosen), hidden (show hidden files)} */
  P._fileDialog = function (o = {}) {
    return new Promise((resolve) => {
      const fs = this.fs;
      const HOME = MG.app.HOME;
      let dir = o.dir && fs.isDir(o.dir) ? o.dir : HOME;
      let chosen = null;
      let done = false;
      const m = MG.modal(o.title || 'Choose File', '', {
        onClose: () => {
          if (!done) {
            done = true;
            resolve(null);
          }
        }
      });
      m.box.classList.add('rs-dialog', 'rs-filedlg');
      const B = m.box.querySelector('.modal-b');
      const crumbs = h('div.rs-crumbs');
      const list = h('div.rs-fdlist', { role: 'listbox', 'aria-label': 'Files' });
      const nameIn = h('input', { type: 'text', value: o.name || '', 'aria-label': 'File name', spellcheck: 'false' });
      const newF = h('button.btn', { type: 'button' }, 'New Folder');
      const okB = h('button.btn.primary', { type: 'button' }, o.mode === 'save' ? 'Save' : o.mode === 'dir' ? 'Choose' : 'Open');
      const cancel = h('button.btn', { type: 'button' }, 'Cancel');
      const finish = (p) => {
        if (done) return;
        done = true;
        m.close();
        resolve(p);
      };
      const render = () => {
        crumbs.innerHTML = '';
        const home = h('button', { type: 'button', html: IC('home') + ' Home' });
        home.addEventListener('click', () => ((dir = HOME), render()));
        crumbs.appendChild(home);
        let acc = HOME;
        for (const seg of dir.slice(HOME.length).split('/').filter(Boolean)) {
          acc += '/' + seg;
          const to = acc;
          const b = h('button', { type: 'button' }, seg);
          b.addEventListener('click', () => ((dir = to), render()));
          crumbs.append(h('span.sep', '›'), b);
        }
        list.innerHTML = '';
        if (dir !== HOME) {
          const up = h('button.rs-fdrow', { type: 'button', html: IC('dotdot') + '<span>..</span>' });
          up.addEventListener('click', () => ((dir = MG.path.dirname(dir)), render()));
          list.appendChild(up);
        }
        const rows = fs.list(dir).filter((c) => o.hidden || !c.name.startsWith('.') || (o.filter && o.filter.test(c.name)));
        rows.sort((a, b) => ((a.entry.kind === 'dir') === (b.entry.kind === 'dir') ? a.name.localeCompare(b.name) : a.entry.kind === 'dir' ? -1 : 1));
        for (const c of rows) {
          const isDir = c.entry.kind === 'dir';
          const off = !isDir && (o.mode === 'dir' || (o.filter && o.mode !== 'save' && !o.filter.test(c.name)));
          const b = h('button.rs-fdrow' + (isDir ? '.dir' : '') + (off ? '.off' : '') + (c.path === chosen ? '.sel' : ''), { type: 'button', html: IC(isDir ? 'folder' : 'file') + `<span>${esc(c.name)}</span>` });
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
        if (!rows.length) list.appendChild(h('div.rs-empty', 'This folder is empty.'));
      };
      okB.addEventListener('click', () => {
        if (o.mode === 'dir') return finish(dir);
        const n = nameIn.value.trim();
        if (o.mode === 'save') {
          if (!n) return nameIn.focus();
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
        const n = await MG.promptText('New Folder', 'Please enter the new folder name:', 'Folder', 'OK');
        if (!n) return;
        fs.mkdirp(dir + '/' + n.replace(/[\/\\]/g, '_'));
        render();
      });
      nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && okB.click());
      B.append(crumbs, list, o.mode === 'save' ? h('label.row', h('span', 'File name:'), nameIn) : null, h('div.prompt-actions', newF, h('span.grow'), cancel, okB));
      render();
      setTimeout(() => (o.mode === 'save' ? (nameIn.focus(), nameIn.setSelectionRange(0, nameIn.value.replace(/\.[^.]*$/, '').length || nameIn.value.length)) : null), 40);
    });
  };
  P._applyPrefs = function () {
    const pf = this.prefs;
    if (!this.cm) return;
    this.cm.setOption('autoCloseBrackets', pf.autoClose !== false);
    this.cmHost.style.setProperty('--rs-edfont', (pf.fontSize || 13) + 'px');
    const d = this.cur;
    if (d && d.type === 'code') this.cm.setOption('lineWrapping', (isMd(d.kind) || d.kind === 'md') && pf.wrapRmd !== false);
    this.cm.refresh();
  };
  P.optionsDialog = function () {
    const m = MG.modal('Global Options', '');
    m.box.classList.add('rs-dialog', 'rs-options');
    const B = m.box.querySelector('.modal-b');
    const pf = this.prefs;
    const boxes = [];
    const cb = (label, key, def) => {
      const i = h('input', { type: 'checkbox' });
      i.checked = pf[key] != null ? !!pf[key] : def;
      boxes.push([key, i]);
      return h('label.check', i, ' ', label);
    };
    const size = h('select', { 'aria-label': 'Editor font size' }, [11, 12, 13, 14, 15, 16, 18, 20].map((n) => h('option', { value: String(n), selected: (pf.fontSize || 13) === n }, String(n))));
    const ok = h('button.btn.primary', { type: 'button' }, 'OK');
    const apply = h('button.btn', { type: 'button' }, 'Apply');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    B.append(
      h('h4', 'General'),
      cb('Restore .RData into workspace at startup', 'restore', true),
      h('p.muted', 'When you quit with q(), R asks whether to save the workspace in ~/.RData (y/n/c).'),
      h('h4', 'Code'),
      cb('Insert matching parens/quotes', 'autoClose', true),
      cb('Soft-wrap R Markdown files', 'wrapRmd', true),
      h('label.row', h('span', 'Editor font size:'), size),
      h('h4', 'R Markdown'),
      cb('Show output inline for all R Markdown documents', 'inline', true),
      h('div.prompt-actions', cancel, apply, ok)
    );
    const save = () => {
      for (const [k, i] of boxes) pf[k] = i.checked;
      pf.fontSize = Number(size.value) || 13;
      store.set('rsPrefs', pf);
      this._applyPrefs();
    };
    cancel.addEventListener('click', () => m.close());
    apply.addEventListener('click', save);
    ok.addEventListener('click', () => {
      save();
      m.close();
    });
  };
  P.shortcuts = function () {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const K = (s) => (mac ? s.replace(/Ctrl\+/g, 'Cmd+').replace(/Alt\+/g, 'Option+') : s);
    const rows = [
      ['Run the current line or selection', 'Ctrl+Enter'],
      ['Run the current chunk (in an R script: Source with Echo)', 'Ctrl+Shift+Enter'],
      ['Run all (the whole script, or all the chunks)', 'Ctrl+Alt+R'],
      ['Source the script', 'Ctrl+Shift+S'],
      ['Insert a chunk', 'Ctrl+Alt+I'],
      ['Run the next chunk', 'Ctrl+Alt+N'],
      ['Run the chunks above', 'Ctrl+Alt+P'],
      ['Knit / Render / Preview', 'Ctrl+Shift+K'],
      ['Save', 'Ctrl+S'],
      ['Find and replace', 'Ctrl+F'],
      ['Comment or uncomment lines', 'Ctrl+Shift+C'],
      ['Insert <-', 'Alt+-'],
      ['Insert |>', 'Ctrl+Shift+M'],
      ['Complete a name', 'Tab'],
      ['New R script', 'Ctrl+Alt+Shift+N'],
      ['Open a file', 'Ctrl+O'],
      ['Restart R', 'Ctrl+Shift+F10'],
      ['Interrupt R (in the Console)', 'Esc'],
      ['Earlier commands (in the Console)', '↑  ↓'],
      ['Clear the Console', 'Ctrl+L']
    ];
    MG.modal('Keyboard Shortcuts', `<table class="rs-keys"><tbody>${rows.map(([a, k]) => `<tr><td>${esc(a)}</td><td><kbd>${esc(K(k))}</kbd></td></tr>`).join('')}</tbody></table><p class="muted">Some of RStudio's usual shortcuts (such as Ctrl+Shift+N, Ctrl+W and Ctrl+1) are used by the browser itself, so they don't work here. You can find the same commands in the menus.</p>`).box.classList.add('rs-dialog');
  };
  P.about = function () {
    const v = this.S && this.S.versions;
    MG.modal('About this RStudio', `<p>This <b>RStudio</b>, in the IDE tab of the workbench, imitates the RStudio IDE so that it can be used for teaching. It is not RStudio itself, and it is not made or endorsed by Posit, the company that makes RStudio.</p>
<p>${v ? `This is ${esc(v.string)}, running in your browser with webR ${esc(v.webr)}.` : 'R runs in your browser.'} Packages are installed from the webR repository, which has CRAN packages built to run in the browser, and from r-universe, which also has builds of Bioconductor packages.</p>
<p>It differs from RStudio on your own computer in a few ways. Pandoc is not available in a browser, so Knit uses knitr and R's markdown package instead, and documents can only be knitted to HTML. There are no projects, no Git and no add-ins, and the Terminal is a Linux shell that is simulated in the page.</p>`).box.classList.add('rs-dialog');
  };

  /** a question with three answers → 'yes' | 'no' | 'cancel' */
  function ask3(title, html, yes, no) {
    return new Promise((resolve) => {
      let done = false;
      const m = MG.modal(title, `${html}<div class="prompt-actions"><button class="btn" data-x="no" type="button">${esc(no)}</button><span class="grow"></span><button class="btn" data-x="cancel" type="button">Cancel</button><button class="btn primary" data-x="yes" type="button">${esc(yes)}</button></div>`, {
        onClose: () => {
          if (!done) {
            done = true;
            resolve('cancel');
          }
        }
      });
      for (const b of m.box.querySelectorAll('[data-x]'))
        b.addEventListener('click', () => {
          if (done) return;
          done = true;
          m.close();
          resolve(b.dataset.x);
        });
    });
  }

  Object.assign(MG.RStudio, { statementAt, splitOpts, parseDelim, readXlsx, KINDS });
})();
