/* =====================================================================
   RStudio, in the IDE tab (ide.js): an integrated development
   environment for R in the manner of RStudio (Posit's IDE) – made for
   teaching, and not RStudio itself. Four panes:

     Source        scripts and documents (R, R Markdown, R Notebooks,
                   Quarto, text), with Run, Source, Knit / Render /
                   Preview; R Markdown chunks run with their output under
                   them; data (View()) and text in tabs of their own
     Console       an R of its own (rsession.js) – plus the Terminal and
                   Background Jobs (what knitting prints)
     Environment   what R has in memory (with Import Dataset), History
     Files, Plots, Packages, Help, Viewer

   Everything that runs code runs it in the Console's R, as RStudio does
   – except Knit and Render, which run the document in a new R.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const rstr = (s) => MG.R.rstr(s);
  const IC = (n) => MG.icon(n);

  /* ------------------------------------------------------------------
     R code: where a statement begins and ends (Run of one line runs the whole statement it belongs to)
     ------------------------------------------------------------------ */
  /** is this R code incomplete – an open bracket or string, or a line that ends in an operator? */
  function incomplete(code) {
    let depth = 0, q = null, last = '';
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) {
        if (ch === '\\') i++;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === '#') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') q = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (!/\s/.test(ch)) last = code.slice(Math.max(0, i - 2), i + 1);
    }
    if (q || depth > 0) return true;
    return /(\+|-|\*|\/|\^|%[^%\s]*%|\|>|<-|<<-|=|==|!=|<=|>=|&&?|\|\|?|~|,|\$|@|:|!)$/.test(last.trim()) && !/^[<>]$/.test(last.trim());
  }

  /* ------------------------------------------------------------------
     templates of new documents (written for the workbench)
     ------------------------------------------------------------------ */
  const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  function rmdTemplate(title, author, kind) {
    const head = kind === 'notebook' ? `---\ntitle: "${title}"\noutput: html_notebook\n---\n` : `---\ntitle: "${title}"\nauthor: "${author}"\ndate: "\`r Sys.Date()\`"\noutput: html_document\n---\n`;
    if (kind === 'notebook')
      return `${head}
This is an R Notebook. When you run a chunk of code, its output appears underneath the chunk.

Try running the chunk below. Click the ▶ button at its top right, or put the cursor inside it and press *Ctrl+Shift+Enter*.

\`\`\`{r}
summary(penguins)
\`\`\`

You can add a new chunk with *Ctrl+Alt+I*.

When you save the notebook, a web page is saved next to it, with the same name ending in *.nb.html*. The page shows the text, the code and the outputs exactly as they are when you save, and **Preview** opens it. No code is run again to make the page.
`;
    return `${head}
\`\`\`{r setup, include=FALSE}
knitr::opts_chunk$set(echo = TRUE)
\`\`\`

## About this document

This is an R Markdown document. It mixes ordinary text, written in Markdown, with chunks of R code like the one below. When you click **Knit**, all of the code is run from the beginning in a new R session, and the result is a web page containing the text, the code and everything the code printed or plotted.

\`\`\`{r penguins}
summary(penguins$body_mass)
\`\`\`

## A plot

The chunk below has the option \`echo = FALSE\`, so its code is left out of the web page, but its output (the plot) is still shown.

\`\`\`{r mass-plot, echo=FALSE}
plot(body_mass ~ flipper_len, data = penguins)
\`\`\`
`;
  }
  function qmdTemplate(title, author) {
    return `---
title: "${title}"
author: "${author}"
format: html
---

## Quarto

Quarto documents work much like R Markdown documents: they combine text with chunks of code. When you click **Render**, the code is run from the beginning in a new R session, and the result is a web page.

\`\`\`{r}
#| label: mass-summary
summary(penguins$body_mass)
\`\`\`

A chunk's options can be written inside the chunk, as comment lines that begin with \`#|\`. In the chunk below, \`echo: false\` hides the code in the web page, so only the plot appears.

\`\`\`{r}
#| label: mass-plot
#| echo: false
plot(body_mass ~ flipper_len, data = penguins)
\`\`\`
`;
  }
  const SHINY_TEMPLATE = `library(shiny)

# The user interface: a slider in a sidebar, and a plot in the main panel
ui <- fluidPage(
  titlePanel("Penguin body mass"),
  sidebarLayout(
    sidebarPanel(
      sliderInput("bins", "Number of bins:", min = 5, max = 50, value = 20)
    ),
    mainPanel(
      plotOutput("hist")
    )
  )
)

# The server computes and draws the plot, and draws it again whenever
# an input (here, the slider) changes
server <- function(input, output) {
  output$hist <- renderPlot({
    x <- na.omit(penguins$body_mass)
    bins <- seq(min(x), max(x), length.out = input$bins + 1)
    hist(x, breaks = bins, col = "steelblue", border = "white",
         xlab = "Body mass (g)", main = "Penguins")
  })
}

shinyApp(ui = ui, server = server)
`;

  /* ------------------------------------------------------------------
     the application
     ------------------------------------------------------------------ */
  let docSeq = 0;
  class RStudioApp {
    constructor(root, opts = {}) {
      this.root = root;
      this.fs = opts.fs || MG.app.fs;
      this.docs = [];
      this.cur = null;
      this.plots = [];
      this.plotAt = -1;
      this.prefs = Object.assign({ restore: true, saveOnExit: 'ask', inline: true }, store.get('rsPrefs', {}));
      this.filesDir = MG.app.HOME;
      this._build();
      this.start();
      // (the documents of the last visit open again; a file that is to be opened as RStudio starts waits for them –
      // see MG.app.ideReady in ide.js – or else it would be hidden behind the one that was on top last time)
      this.restored = this._restoreDocs();
      this.fs.onChange((p, what) => this._fsChanged(p, what));
      bus.on('r:userlib', () => this.refreshPackages());
    }

    /* ================= the frame ================= */
    _build() {
      const R = this.root;
      R.classList.add('rs');
      // menus
      const menu = (label, items) => {
        const b = h('button.rs-menu', { type: 'button' }, label);
        b.addEventListener('click', () => MG.popmenu(b, items().filter(Boolean)));
        return b;
      };
      this.menubar = h(
        'div.rs-menubar',
        menu('File', () => [
          ['newfile', 'New File: R Script  (Ctrl+Alt+Shift+N)', () => this.newDoc('r')],
          ['newfile', 'New File: R Markdown…', () => this.newDocDialog('rmd')],
          ['newfile', 'New File: R Notebook', () => this.newDocDialog('notebook')],
          ['newfile', 'New File: Quarto Document…', () => this.newDocDialog('qmd')],
          ['newfile', 'New File: Shiny Web App…', () => this.newShinyDialog()],
          ['newfile', 'New File: Text File', () => this.newDoc('text')],
          ['openfolder', 'Open File…  (Ctrl+O)', () => this.openDialog()],
          ['save', 'Save  (Ctrl+S)', () => this.save()],
          ['save', 'Save As…', () => this.saveAs()],
          ['saveall', 'Save All', () => this.saveAll()],
          ['knit', 'Knit Document  (Ctrl+Shift+K)', () => this.knit()],
          ['x', 'Close', () => this.cur && this.closeDoc(this.cur)],
          ['x', 'Close All', () => this.closeAll()],
          ['x', 'Quit Session…  (q())', () => this.consoleRun('q()')]
        ]),
        menu('Edit', () => [
          ['search', 'Find…  (Ctrl+F)', () => this.find()],
          ['broom', 'Clear Console  (Ctrl+L)', () => this.cv.clear()]
        ]),
        menu('Code', () => [
          ['runline', 'Run Selected Line(s)  (Ctrl+Enter)', () => this.runCurrent()],
          ['runline', 'Run All  (Ctrl+Alt+R)', () => this.runAll()],
          ['sourcefile', 'Source  (Ctrl+Shift+S)', () => this.sourceDoc(false)],
          ['sourcefile', 'Source with Echo  (Ctrl+Shift+Enter)', () => this.sourceDoc(true)],
          ['chunk', 'Insert Chunk  (Ctrl+Alt+I)', () => this.insertChunk()],
          ['play', 'Run Current Chunk', () => this.runChunkAtCursor()],
          ['code', 'Comment/Uncomment Lines  (Ctrl+Shift+C)', () => this.cm.toggleComment()],
          ['code', 'Insert pipe operator |>  (Ctrl+Shift+M)', () => this.cm.replaceSelection(' |> ')],
          ['code', 'Insert assignment <-  (Alt+-)', () => this.cm.replaceSelection(' <- ')]
        ]),
        menu('View', () => [
          ['panes', 'Panes: Show All Panes', () => this.showAllPanes()],
          ['panes', 'Zoom Source', () => this.zoom('source')],
          ['panes', 'Zoom Console', () => this.zoom('console')],
          ['panes', 'Show Files  (Ctrl+5)', () => this.showTab('files', 'files')],
          ['panes', 'Show Plots  (Ctrl+6)', () => this.showTab('files', 'plots')],
          ['panes', 'Show Environment  (Ctrl+8)', () => this.showTab('env', 'env')]
        ]),
        menu('Plots', () => [
          ['arrowL', 'Previous Plot', () => this.plotGo(-1)],
          ['arrowR', 'Next Plot', () => this.plotGo(1)],
          ['zoom', 'Zoom Plot…', () => this.plotZoom()],
          ['download', 'Save as Image…', () => this.plotExport()],
          ['x', 'Remove Plot…', () => this.plotRemove()],
          ['broom', 'Clear All…', () => this.plotClear()]
        ]),
        menu('Session', () => [
          ['reset', 'Restart R  (Ctrl+Shift+F10)', () => this.restart()],
          ['stop', 'Interrupt R  (Esc)', () => this.interrupt()],
          ['x', 'Terminate R…', () => this.terminate()],
          ['folder', 'Set Working Directory: To Source File Location', () => this.setwdSource()],
          ['folder', 'Set Working Directory: To Files Pane Location', () => this.consoleRun(`setwd(${rstr(this.fs.pretty(this.filesDir))})`)],
          ['folder', 'Set Working Directory: Choose Directory…', () => this.chooseDir()],
          ['upload', 'Load Workspace…', () => this.loadWorkspace()],
          ['save', 'Save Workspace As…', () => this.saveWorkspace()],
          ['broom', 'Clear Workspace…', () => this.clearWorkspace()]
        ]),
        menu('Tools', () => [
          ['pkg', 'Install Packages…', () => this.installDialog()],
          ['gear', 'Global Options…', () => this.optionsDialog()]
        ]),
        menu('Help', () => [
          ['help', 'R Help', () => this.helpHome()],
          ['keyboard', 'Keyboard Shortcuts Help', () => this.shortcuts()],
          MG.app.showHelp ? ['book', 'RStudio in the Workbench (Help Page)', () => MG.app.showHelp('h-rstudio')] : null,
          ['info', 'About this RStudio', () => this.about()]
        ])
      );
      // the main toolbar
      const tb = (icon, title, fn, cls, label) => {
        const b = h('button.rs-tb' + (cls || ''), { type: 'button', title, 'aria-label': title, html: IC(icon) + (label ? `<span>${esc(label)}</span>` : '') });
        b.addEventListener('click', fn);
        return b;
      };
      const newBtn = tb('newfile', 'New File', () => MG.popmenu(newBtn, [
        ['code', 'R Script', () => this.newDoc('r')],
        ['book', 'R Markdown…', () => this.newDocDialog('rmd')],
        ['notebook', 'R Notebook', () => this.newDocDialog('notebook')],
        ['book2', 'Quarto Document…', () => this.newDocDialog('qmd')],
        ['globe', 'Shiny Web App…', () => this.newShinyDialog()],
        ['text', 'Text File', () => this.newDoc('text')]
      ]), '.green', '▾');
      this.toolbar = h(
        'div.rs-toolbar',
        newBtn,
        h('span.rs-tsep'),
        tb('openfolder', 'Open an existing file (Ctrl+O)', () => this.openDialog()),
        tb('save', 'Save current document (Ctrl+S)', () => this.save(), '.blue'),
        tb('saveall', 'Save all open documents', () => this.saveAll(), '.blue'),
        h('span.rs-tsep'),
        tb('search', 'Go to file', () => this.openDialog()),
        h('span.rs-tsep'),
        tb('panes', 'Workspace panes', (e) => MG.popmenu(e.currentTarget, [
          ['panes', 'Show All Panes', () => this.showAllPanes()],
          ['panes', 'Zoom Source', () => this.zoom('source')],
          ['panes', 'Zoom Console', () => this.zoom('console')]
        ])),
        h('span.rs-project', { title: 'RStudio projects are not available here' }, h('span', { html: IC('pkg') }), 'Project: (None)')
      );
      // the four panes
      this.panes = {};
      this.main = h('div.rs-main');
      const left = h('div.rs-col.left'), right = h('div.rs-col.right');
      this.panes.source = this._pane('source', []);
      this.panes.console = this._pane('console', [
        ['console', 'Console'],
        ['terminal', 'Terminal'],
        ['jobs', 'Background Jobs']
      ]);
      this.panes.env = this._pane('env', [
        ['env', 'Environment'],
        ['history', 'History']
      ]);
      this.panes.files = this._pane('files', [
        ['files', 'Files'],
        ['plots', 'Plots'],
        ['packages', 'Packages'],
        ['help', 'Help'],
        ['viewer', 'Viewer']
      ]);
      const hs1 = h('div.rs-hsplit'), hs2 = h('div.rs-hsplit'), vs = h('div.rs-vsplit');
      left.append(this.panes.source.el, hs1, this.panes.console.el);
      right.append(this.panes.env.el, hs2, this.panes.files.el);
      this.main.append(left, vs, right);
      this.cols = { left, right };
      this._splitters(vs, hs1, hs2);
      R.append(this.menubar, this.toolbar, this.main);
      this._buildSource();
      this._buildConsole();
      this._buildEnv();
      this._buildFiles();
      document.addEventListener('keydown', (e) => this._globalKey(e));
    }
    _pane(name, tabs) {
      const tabsEl = h('div.rs-ptabs', { role: 'tablist' });
      const body = h('div.rs-pbody');
      const el = h('section.rs-pane.rs-pane-' + name, tabsEl, body);
      const P = { name, el, tabsEl, body, views: {}, tabs: {}, cur: null };
      for (const [id, label] of tabs) {
        const b = h('button.rs-ptab', { type: 'button', role: 'tab', dataset: { tab: id } }, h('span.tname', label));
        b.addEventListener('click', () => this.showTab(name, id));
        tabsEl.appendChild(b);
        P.tabs[id] = b;
        P.views[id] = h('div.rs-view', { hidden: true });
        body.appendChild(P.views[id]);
      }
      if (tabs.length) {
        tabsEl.appendChild(h('span.rs-tabsgrow'));
        const mx = h('button.rs-pane-btn', { type: 'button', title: 'Maximise this pane', html: IC('maximize') });
        mx.addEventListener('click', () => this.zoom(name));
        tabsEl.appendChild(mx);
      }
      return P;
    }
    showTab(pane, id, opts) {
      const P = this.panes[pane];
      if (!P || !P.views[id]) return;
      P.cur = id;
      for (const [k, b] of Object.entries(P.tabs)) b.classList.toggle('on', k === id);
      for (const [k, v] of Object.entries(P.views)) v.hidden = k !== id;
      if (pane === 'files' && id === 'files') this.renderFiles();
      if (pane === 'files' && id === 'packages') this.refreshPackages();
      if (pane === 'files' && id === 'plots') this._plotShow();
      if (pane === 'console' && id === 'terminal') this._terminal();
      if (pane === 'console' && id === 'console' && !(opts && opts.nofocus)) setTimeout(() => this.cv.focus(), 20);
      if (pane === 'env' && id === 'env') this.refreshEnv();
      bus.emit('rstudio:tab', { pane, tab: id });
    }
    _splitters(vs, hs1, hs2) {
      const R = this.root;
      const saved = store.get('rsSplit', null);
      if (saved) for (const [k, v] of Object.entries(saved)) R.style.setProperty(k, v);
      const drag = (el, prop, axis, box) => {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          document.body.classList.add('dragging');
          const mv = (ev) => {
            const r = box().getBoundingClientRect();
            const f = axis === 'x' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
            R.style.setProperty(prop, (MG.clamp(f, 0.12, 0.88) * 100).toFixed(1) + '%');
          };
          const up = () => {
            el.removeEventListener('pointermove', mv);
            el.removeEventListener('pointerup', up);
            document.body.classList.remove('dragging');
            const s = {};
            for (const p of ['--rs-left', '--rs-top', '--rs-rtop']) if (R.style.getPropertyValue(p)) s[p] = R.style.getPropertyValue(p);
            store.set('rsSplit', s);
            this._resized();
          };
          el.addEventListener('pointermove', mv);
          el.addEventListener('pointerup', up);
        });
        el.addEventListener('dblclick', () => {
          R.style.removeProperty(prop);
          this._resized();
        });
      };
      drag(vs, '--rs-left', 'x', () => this.main);
      drag(hs1, '--rs-top', 'y', () => this.cols.left);
      drag(hs2, '--rs-rtop', 'y', () => this.cols.right);
    }
    zoom(pane) {
      const col = pane === 'source' || pane === 'console' ? this.cols.left : this.cols.right;
      const top = pane === 'source' || pane === 'env';
      const already = col.classList.contains(top ? 'max-top' : 'max-bottom');
      this.cols.left.classList.remove('max-top', 'max-bottom');
      this.cols.right.classList.remove('max-top', 'max-bottom');
      if (!already) col.classList.add(top ? 'max-top' : 'max-bottom');
      this._resized();
    }
    showAllPanes() {
      this.cols.left.classList.remove('max-top', 'max-bottom');
      this.cols.right.classList.remove('max-top', 'max-bottom');
      this._resized();
    }
    _resized() {
      clearTimeout(this._rz);
      this._rz = setTimeout(() => {
        if (this.cm) this.cm.refresh();
        this._sizeConsole();
        this._plotResize();
      }, 80);
    }
    shown(opts) {
      this._resized();
      if (!opts || !opts.resize) {
        if (this.cur && this.cur.cmDoc) setTimeout(() => this.cm.focus(), 30);
        else setTimeout(() => this.cv.focus(), 30);
      }
    }
    _globalKey(e) {
      if (e.defaultPrevented || !this.root.isConnected || this.root.closest('[hidden]')) return;
      if (!this.root.contains(document.activeElement) && document.activeElement !== document.body) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && k === 'f10') (e.preventDefault(), this.restart());
      else if (ctrl && e.shiftKey && k === 'n') (e.preventDefault(), this.newDoc('r'));
      else if (ctrl && e.shiftKey && k === 's' && this.cur && this.cur.type === 'code') (e.preventDefault(), this.sourceDoc(false));
      else if (ctrl && !e.shiftKey && k === 'o') (e.preventDefault(), this.openDialog());
      else if (ctrl && e.shiftKey && k === 'k') (e.preventDefault(), this.knit());
      else if (ctrl && k === '1') (e.preventDefault(), this.cur && this.cur.cmDoc && this.cm.focus());
      else if (ctrl && k === '2') (e.preventDefault(), this.showTab('console', 'console'));
    }

    /* ================= R: the console's session ================= */
    start() {
      const S = new MG.R.Session({ kind: 'rstudio', banner: true, graphics: 'canvas', cwd: MG.app.HOME, restoreData: this.prefs.restore ? 'rstudio' : false });
      this.S = S;
      this.cv.attach(S);
      S.on('state', (d) => this._state(d));
      S.on('wd', (d) => this._wd(d.wd));
      S.on('echo', (d) => {
        if (!d.silent && d.kind === 'top' && d.line.trim()) this._history(d.line);
      });
      // (while a chunk runs with its output under it, what R prints goes there: the Console shows the code only)
      S.on('output', (d) => this.capture && this._captureOut(d));
      S.on('plot', (d) => this._plot(d));
      S.on('help', (d) => this._help(d));
      S.on('helpchoice', (d) => this._helpChoice(d));
      S.on('view', (d) => this._viewData(d));
      S.on('pager', (d) => this._pager(d));
      S.on('browse', (d) => MG.app.browse(d.url, { from: 'rstudio' }));
      S.on('edit', (d) => this.openFile(d.file));
      S.on('rerror', () => this._captureError());
      S.on('idle', () => this._idle());
      S.on('event', (d) => this._event(d));
      S.on('ended', (d) => this._ended(d));
      S.on('installed', (d) => {
        this.refreshPackages();
        bus.emit('rstudio:installed', { pkgs: [].concat(d.pkgs) });
      });
      this._endedEl && this._endedEl.remove();
      S.start().then(() => {
        this._sizeConsole();
        this._plotResize();
        this.refreshEnv();
        this.refreshPackages();
      }, (e) => {
        const why = String((e && e.message) || e).trim();
        this.cv.note(`R could not start: ${why}${/[.!?]$/.test(why) ? '' : '.'} ${/internet connection/.test(why) ? 'Then reload the page.' : 'Check your internet connection and reload the page.'}`);
      });
      return S;
    }
    _state(d) {
      const busy = d.state === 'busy' || d.state === 'starting';
      this.root.classList.toggle('busy', busy);
      this.stopBtn.hidden = !(this.shinyApp || d.state === 'busy' || d.state === 'input' || d.state === 'continue' || d.state === 'browser');
      if (d.state === 'starting') this.conStatus.textContent = d.text || 'Starting R…';
      else this._wd(this.S.wd);
    }
    _wd(wd) {
      const v = this.S && this.S.versions ? 'R ' + this.S.versions.r : 'R';
      this.conVer.textContent = v;
      this.conStatus.textContent = ' · ' + (wd ? this.fs.pretty(wd) + (wd === MG.app.HOME ? '/' : '') : '~/');
    }
    async _idle() {
      if (this.capture) this._captureEnd();
      else this._nextChunk();
      this.refreshEnv();
      if (this.panes.files.cur === 'packages') this.refreshPackages();
    }
    _event(d) {
      if (d.event === 'shiny') return this._shinyStart(d);
    }
    /** runApp() started a Shiny app: it shows in the Viewer, and the console is busy until it is stopped */
    _shinyStart(d) {
      if (!MG.Shiny) return;
      MG.Shiny.start(this.S, d, {
        show: (app) => {
          this.shinyApp = app;
          this.viewerBox.innerHTML = '';
          const fr = h('iframe.rs-viewer', { title: 'Shiny app: ' + app.title, src: app.url });
          this.viewerBox.appendChild(fr);
          this.viewerTitle.textContent = `http://127.0.0.1:${app.port}`;
          this.viewerNow = { app, url: app.url, title: app.title };
          this.viewerStop.hidden = false;
          this.showTab('files', 'viewer');
          this.cv.hold('The Shiny app is running. Press Esc or click Stop to stop it.');
          this.stopBtn.hidden = false;
          bus.emit('rstudio:shiny', { title: app.title, running: true });
        },
        stopped: (app) => {
          if (this.shinyApp === app) this.shinyApp = null;
          this.cv.release();
          this.viewerStop.hidden = true;
          if (this.viewerNow && this.viewerNow.app === app) {
            this.viewerBox.innerHTML = '';
            this.viewerBox.appendChild(h('div.rs-empty', 'The app has stopped. Click Run App to run it again.'));
            this.viewerNow = null;
          }
          if (this.S) this._state({ state: this.S.state });
          bus.emit('rstudio:shiny', { title: app.title, running: false });
        },
        failed: (msg) => this.cv.note(msg)
      });
    }
    consoleRun(code, opts = {}) {
      this.showTab('console', 'console', { nofocus: !!opts.nofocus });
      if (!this.S || this.S.state === 'ended' || this.S.state === 'failed') return this._deadNote();
      this.cv.run(code);
    }
    consoleType(code) {
      this.showTab('console', 'console');
      this.cv.type(code);
    }
    interrupt() {
      this.cv.interrupt();
    }
    async restart() {
      if (this.capture) this._captureEnd(true);
      this.chunkQueue = [];
      if (MG.Shiny && this.shinyApp) MG.Shiny.stop(this.S, true);
      if (this.S) this.S.close(true);
      this.cv.write('\nRestarting R session...\n\n', 'out', true);
      this.start();
      bus.emit('rstudio:restart', {});
    }
    async terminate() {
      if (!(await MG.confirmBox('Terminate R', "<p>This ends the R session immediately. Everything in R's memory will be lost, but your files are not affected. A new session will start straight away.</p>", 'Terminate', { danger: true }))) return;
      this.restart();
    }
    _ended(d) {
      if (this.capture) this._captureEnd(true);
      this.chunkQueue = [];
      if (d && d.quit) {
        const box = h('div.rs-ended', h('div', h('h3', 'R Session Ended'), h('p', d.quit.saved ? 'Your workspace was saved in ~/.RData.' : 'Your R session ended.'), (() => {
          const b = h('button.btn.primary', { type: 'button' }, 'Start New Session');
          b.addEventListener('click', () => this.restart());
          return b;
        })()));
        this._endedEl = box;
        this.panes.console.views.console.appendChild(box);
        bus.emit('rstudio:quit', { saved: !!d.quit.saved });
      }
    }
    _deadNote() {
      this.cv.note('R is not running. To start a new R session, choose Session → Restart R.');
    }

    /* ================= Console pane ================= */
    _buildConsole() {
      const V = this.panes.console.views;
      this.conVer = h('span.rver', 'R');
      this.conStatus = h('span', ' · ~/');
      this.stopBtn = h('button.rs-tb.red', { type: 'button', title: 'Interrupt R (Esc)', html: IC('stopsq') });
      this.stopBtn.hidden = true;
      this.stopBtn.addEventListener('click', () => this.interrupt());
      const broom = h('button.rs-tb', { type: 'button', title: 'Clear console (Ctrl+L)', html: IC('broom') });
      broom.addEventListener('click', () => this.cv.clear());
      const head = h('div.rs-conhead', this.conVer, this.conStatus, h('span.grow'), this.stopBtn, broom);
      const host = h('div.rs-conhost', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
      V.console.append(head, host);
      this.cv = new MG.ConsoleView(host, {
        theme: 'rstudio',
        label: 'RStudio console',
        onDead: () => this._deadNote(),
        onCannotInterrupt: () => this.cannotInterrupt(),
        // (an error in the console – not in a chunk run with its output under it – can be sent to the AI assistant)
        askAI: () => (this.capture ? null : 'rstudio'),
        // (Esc while a Shiny app runs stops the app)
        onInterrupt: () => {
          if (!this.shinyApp) return false;
          MG.Shiny.stop(this.S);
          return true;
        },
        outputFilter: () => !this.capture
      });
      const hist = store.get('rsHistory', []);
      if (Array.isArray(hist)) this.cv.history = hist.slice(-500);
      // jobs: what knitting prints
      this.jobLog = h('pre.rs-log');
      const jbar = h('div.rs-bar', h('b', { style: { fontSize: '12px' } }, 'Render'), h('span.grow'));
      const clr = h('button.rs-tb', { type: 'button', title: 'Clear', html: IC('broom') });
      clr.addEventListener('click', () => {
        this.jobLog.innerHTML = '';
        this._jobLine = null;
      });
      jbar.appendChild(clr);
      V.jobs.append(jbar, this.jobLog);
      this.showTab('console', 'console');
    }
    cannotInterrupt() {
      MG.confirmBox('Interrupt R', "<p>R can't be interrupted in this browser, because the page is not cross-origin isolated. Terminating R will stop what it is doing, but everything in R's memory will be lost as well.</p>", 'Terminate R', { danger: true }).then((ok) => ok && this.restart());
    }
    _sizeConsole() {
      if (!this.S) return;
      const el = this.cv.out;
      const w = el.clientWidth;
      if (!w) return;
      const probe = h('span', { style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', font: getComputedStyle(el).font } }, 'x'.repeat(50));
      el.appendChild(probe);
      const cw = probe.getBoundingClientRect().width / 50 || 7.8;
      probe.remove();
      const chars = Math.floor((w - 20) / cw);
      const go = () => this.S.consoleWidth(chars);
      if (this.S.ready) go();
      else if (this.S.started) this.S.started.then(go).catch(() => {});
    }
    _terminal() {
      if (this.term) return setTimeout(() => this.term.focus(), 30);
      const host = h('div.rs-term');
      this.panes.console.views.terminal.appendChild(host);
      this.term = new MG.TerminalUI(host, { fs: Object.create(this.fs), hostname: MG.config.hostname || 'workbench', env: {}, welcome: 'This is Terminal 1, a shell that works on the same files as RStudio. It has the same programs as the Terminal tab, and Rscript runs R scripts.' });
      // (the terminal of RStudio has a folder of its own: cd here does not move the Terminal tab)
      this.term.fs.cwd = MG.app.HOME;
      setTimeout(() => this.term.focus(), 30);
    }
    /** text into the Background Jobs log (what knitting prints). \r starts the line again – knitr's progress bar
        writes over itself; cls 'err' (errors are red), 'done' */
    _job(text, cls) {
      const L = this.jobLog;
      if (!L.firstChild) this._jobLine = null;
      for (const part of String(text).split(/(\r\n|\r|\n)/)) {
        if (!part) continue;
        if (part === '\n' || part === '\r\n') {
          L.appendChild(document.createTextNode('\n'));
          this._jobLine = null;
        } else if (part === '\r') {
          if (this._jobLine) this._jobLine.textContent = '';
        } else {
          if (!this._jobLine) {
            this._jobLine = h('span');
            L.appendChild(this._jobLine);
          }
          const red = cls === 'err' && /^(Error|Quitting from|Execution halted|Warning|!)/m.test(part);
          this._jobLine.appendChild(h('span' + (red ? '.err' : cls === 'done' ? '.done' : ''), part));
        }
      }
      L.scrollTop = L.scrollHeight;
    }

    /* ================= Environment and History ================= */
    _buildEnv() {
      const V = this.panes.env.views;
      const imp = h('button.rs-tb', { type: 'button', title: 'Import a dataset from a file', html: IC('table') + '<span>Import Dataset</span><span class="caret">▾</span>' });
      imp.addEventListener('click', () => MG.popmenu(imp, [
        ['table', 'From Text (base)…', () => this.importDialog('base')],
        ['table', 'From Text (readr)…', () => this.importDialog('readr')],
        ['table', 'From Excel…', () => this.importDialog('excel')]
      ]));
      const clear = h('button.rs-tb', { type: 'button', title: 'Clear objects from the workspace', html: IC('broom') });
      clear.addEventListener('click', () => this.clearWorkspace());
      const refresh = h('button.rs-tb', { type: 'button', title: 'Refresh the list of objects', html: IC('refresh') });
      refresh.addEventListener('click', () => this.refreshEnv());
      this.envSearch = h('input.rs-search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search the environment' });
      this.envSearch.addEventListener('input', () => this._renderEnv());
      const bar = h('div.rs-bar', imp, h('span.rs-tsep'), clear, h('span.grow'), refresh);
      const bar2 = h('div.rs-bar', h('span', { style: { fontSize: '12px', color: '#3a4650' }, html: '<b>R</b> ▾ &nbsp; Global Environment ▾' }), h('span.grow'), this.envSearch);
      this.envList = h('div.rs-env');
      V.env.append(bar, bar2, this.envList);
      this.expanded = new Set();
      // History
      const toCon = h('button.rs-tb', { type: 'button', title: 'Send the selected commands to the console', html: IC('runline') + '<span>To Console</span>' });
      toCon.addEventListener('click', () => this._histSend('console'));
      const toSrc = h('button.rs-tb', { type: 'button', title: 'Insert the selected commands into the current document', html: IC('sourcefile') + '<span>To Source</span>' });
      toSrc.addEventListener('click', () => this._histSend('source'));
      const hClear = h('button.rs-tb', { type: 'button', title: 'Clear all history', html: IC('broom') });
      hClear.addEventListener('click', () => {
        this.history = [];
        store.set('rsHistory', []);
        this._renderHistory();
      });
      this.histList = h('div.rs-hist', { tabindex: '0' });
      V.history.append(h('div.rs-bar', toCon, toSrc, h('span.grow'), hClear), this.histList);
      this.history = (store.get('rsHistory', []) || []).slice(-500);
      this._renderHistory();
      this.showTab('env', 'env');
    }
    async refreshEnv() {
      if (!this.S || !this.S.idle) return;
      const vars = await this.S.variables();
      if (vars == null) return;
      this.vars = vars;
      this._renderEnv();
    }
    _renderEnv() {
      const L = this.envList;
      if (!L) return;
      L.innerHTML = '';
      const q = (this.envSearch.value || '').toLowerCase();
      const vars = (this.vars || []).filter((v) => !q || v.name.toLowerCase().includes(q));
      if (!vars.length) {
        L.appendChild(h('div.rs-empty', q ? 'No objects match.' : 'Environment is empty'));
        return;
      }
      const groups = [['data', 'Data'], ['value', 'Values'], ['function', 'Functions']];
      for (const [k, title] of groups) {
        const vs = vars.filter((v) => v.kind === k);
        if (!vs.length) continue;
        L.appendChild(h('div.rs-envsec', title));
        for (const v of vs) {
          const row = h('div.rs-envrow', { title: `${v.name}: ${v.cls}${v.size ? ' · ' + v.size : ''}` });
          let exp = h('span');
          if (k === 'data') {
            exp = h('button.exp' + (this.expanded.has(v.name) ? '.open' : ''), { type: 'button', title: 'Show the columns', html: '▶' });
            exp.addEventListener('click', () => {
              if (this.expanded.has(v.name)) this.expanded.delete(v.name);
              else this.expanded.add(v.name);
              this._renderEnv();
            });
          }
          const tbl = k === 'data' ? h('button.tbl', { type: 'button', title: `View(${v.name})`, html: IC('table') }) : h('span');
          if (k === 'data') tbl.addEventListener('click', () => this.consoleRun(`View(${/^[A-Za-z.][\w.]*$/.test(v.name) ? v.name : '`' + v.name + '`'})`));
          row.append(exp, h('span.nm', v.name), h('span.val', v.desc), tbl);
          if (k === 'function') row.addEventListener('dblclick', () => this.consoleRun(`View(${v.name})`));
          L.appendChild(row);
          if (k === 'data' && this.expanded.has(v.name)) {
            const pre = h('pre.rs-envstr', '…');
            L.appendChild(pre);
            this.S.evalLines(`utils::capture.output(utils::str(get(${rstr(v.name)}, envir = globalenv()), give.attr = FALSE, vec.len = 3))`).then((x) => (pre.textContent = (x || []).slice(1).join('\n') || ''));
          }
        }
      }
    }
    _history(line) {
      this.history.push(line);
      if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
      store.set('rsHistory', this.history);
      this.cv.history = this.history.slice();
      this._renderHistory();
    }
    _renderHistory() {
      const L = this.histList;
      L.innerHTML = '';
      this.history.forEach((c, i) => {
        const r = h('div.rs-hrow', { dataset: { i } }, c);
        r.addEventListener('click', (e) => {
          if (!e.shiftKey && !e.ctrlKey) L.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
          r.classList.toggle('sel');
        });
        r.addEventListener('dblclick', () => this.consoleType(c));
        L.appendChild(r);
      });
      L.scrollTop = L.scrollHeight;
    }
    _histSend(where) {
      const sel = Array.from(this.histList.querySelectorAll('.sel')).map((r) => this.history[+r.dataset.i]);
      if (!sel.length) return toast('Select one or more commands in the History first. Click a command to select it, and Ctrl+click to select more.', 'warn');
      if (where === 'console') this.consoleType(sel.join('\n'));
      else if (this.cur && this.cur.cmDoc) {
        this.cm.replaceSelection(sel.join('\n') + '\n');
        this.cm.focus();
      } else this.newDoc('r', sel.join('\n') + '\n');
    }
    async clearWorkspace() {
      if (!(await MG.confirmBox('Clear Workspace', '<p>Are you sure you want to remove all objects from the environment? (This runs <code>rm(list = ls())</code>. Your files are not affected.)</p>', 'Yes', { danger: true }))) return;
      this.consoleRun('rm(list = ls())');
    }

    /* ================= Files, Plots, Packages, Help, Viewer ================= */
    _buildFiles() {
      const V = this.panes.files.views;
      const fb = (icon, label, title, fn) => {
        const b = h('button.rs-tb', { type: 'button', title, html: IC(icon) + (label ? `<span>${esc(label)}</span>` : '') });
        b.addEventListener('click', fn);
        return b;
      };
      const more = fb('gear', 'More ▾', 'More file commands', () => MG.popmenu(more, [
        ['folder', 'Set As Working Directory', () => this.consoleRun(`setwd(${rstr(this.fs.pretty(this.filesDir))})`)],
        ['folder', 'Go To Working Directory', () => this.S && this.S.wd && ((this.filesDir = this.S.wd), this.renderFiles())],
        ['copy', 'Copy…', () => this._fileAct('copy')],
        ['move', 'Move…', () => this._fileAct('move')],
        ['download', 'Export… (download)', () => this._fileAct('export')],
        ['eye', 'Show Hidden Files', () => ((this.showHidden = !this.showHidden), this.renderFiles())]
      ]));
      const fbar = h('div.rs-bar',
        fb('folder', 'New Folder', 'Create a new folder', () => this._newFolder()),
        fb('newfile', 'New Blank File ▾', 'Create a new blank file in this folder', (e) => MG.popmenu(e.currentTarget, [
          ['code', 'R Script', () => this._newBlank('.R')],
          ['book', 'R Markdown', () => this._newBlank('.Rmd')],
          ['book2', 'Quarto Doc', () => this._newBlank('.qmd')],
          ['text', 'Text File', () => this._newBlank('.txt')]
        ])),
        fb('upload', 'Upload', 'Upload files from your computer', () => MG.app.pickFiles(this.filesDir, false).then(() => this.renderFiles())),
        fb('trash', 'Delete', 'Delete the checked files', () => this._fileAct('delete')),
        fb('rename', 'Rename', 'Rename the checked file', () => this._fileAct('rename')),
        more,
        h('span.grow'),
        fb('refresh', '', 'Refresh the file listing', () => this.renderFiles())
      );
      this.crumbs = h('div.rs-crumbs');
      this.fileList = h('div.rs-files');
      V.files.append(fbar, this.crumbs, this.fileList);
      // Plots
      const pb = (icon, label, title, fn) => fb(icon, label, title, fn);
      this.plotPrev = pb('arrowL', '', 'Previous plot', () => this.plotGo(-1));
      this.plotNext = pb('arrowR', '', 'Next plot', () => this.plotGo(1));
      const plotBar = h('div.rs-bar', this.plotPrev, this.plotNext, h('span.rs-tsep'), pb('zoom', 'Zoom', 'View a larger version of the plot', () => this.plotZoom()), pb('download', 'Export ▾', 'Export the plot', (e) => MG.popmenu(e.currentTarget, [
        ['image', 'Save as Image…', () => this.plotExport()],
        ['copy', 'Copy to Clipboard…', () => this.plotCopy()]
      ])), h('span.rs-tsep'), pb('x', '', 'Remove the current plot', () => this.plotRemove()), pb('broom', '', 'Clear all plots', () => this.plotClear()), h('span.grow'), (this.plotInfo = h('span', { style: { fontSize: '11.5px', color: '#666' } })));
      this.plotBox = h('div.rs-plotbox');
      V.plots.append(plotBar, this.plotBox);
      // Packages
      const inst = fb('pkg', 'Install', 'Install R packages', () => this.installDialog());
      const upd = fb('refresh', 'Update', 'Check for package updates', () => this.consoleRun('update.packages()'));
      this.pkgSearch = h('input.rs-search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search packages' });
      this.pkgSearch.addEventListener('input', () => this._renderPackages());
      this.pkgList = h('div.rs-pkgs');
      V.packages.append(h('div.rs-bar', inst, upd, h('span.grow'), this.pkgSearch), this.pkgList);
      // Help
      this.helpBack = fb('arrowL', '', 'Previous topic', () => this._helpNav(-1));
      this.helpFwd = fb('arrowR', '', 'Next topic', () => this._helpNav(1));
      this.helpSearch = h('input.rs-search', { type: 'search', placeholder: 'Search help', 'aria-label': 'Search R help' });
      this.helpSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && this.helpSearch.value.trim()) this.helpTopic(this.helpSearch.value.trim());
      });
      this.helpTitle = h('span', { style: { fontSize: '12px', color: '#555', marginLeft: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
      this.helpBody = h('div.rs-help');
      V.help.append(h('div.rs-bar', this.helpBack, this.helpFwd, fb('home', '', 'Show R help home', () => this.helpHome()), this.helpTitle, h('span.grow'), this.helpSearch), this.helpBody);
      this.helpHist = [];
      this.helpAt = -1;
      // Viewer
      this.viewerTitle = h('span', { style: { fontSize: '12px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
      this.viewerStop = fb('stopsq', 'Stop', 'Stop the app (or press Esc in the Console)', () => MG.Shiny && MG.Shiny.stop(this.S));
      this.viewerStop.hidden = true;
      const vOpen = fb('external', '', 'Show in a new window', () => this.viewerOpen());
      const vClear = fb('broom', '', 'Clear the viewer', () => this.viewerClear());
      this.viewerBox = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
      V.viewer.append(h('div.rs-bar', this.viewerTitle, h('span.grow'), this.viewerStop, vOpen, vClear), this.viewerBox);
      this.viewerClear();
      this.showTab('files', 'files');
      this.helpHome(true);
    }
    /* ---------- Files ---------- */
    renderFiles() {
      const fs = this.fs;
      if (!fs.isDir(this.filesDir)) this.filesDir = MG.app.HOME;
      const dir = this.filesDir;
      // breadcrumbs: Home > folder > folder
      this.crumbs.innerHTML = '';
      const home = h('button', { type: 'button', html: IC('home') + ' Home' });
      home.addEventListener('click', () => ((this.filesDir = MG.app.HOME), this.renderFiles()));
      this.crumbs.appendChild(home);
      const rel = dir.slice(MG.app.HOME.length).split('/').filter(Boolean);
      let acc = MG.app.HOME;
      for (const seg of rel) {
        acc += '/' + seg;
        const to = acc;
        const b = h('button', { type: 'button' }, seg);
        b.addEventListener('click', () => ((this.filesDir = to), this.renderFiles()));
        this.crumbs.append(h('span.sep', '›'), b);
      }
      const rows = fs.list(dir).filter((c) => this.showHidden || !c.name.startsWith('.'));
      rows.sort((a, b) => ((a.entry.kind === 'dir') === (b.entry.kind === 'dir') ? a.name.localeCompare(b.name) : a.entry.kind === 'dir' ? -1 : 1));
      const table = h('table.rs-ftable', h('thead', h('tr', h('th', { style: { width: '22px' } }, ''), h('th', 'Name'), h('th', { style: { textAlign: 'right' } }, 'Size'), h('th', 'Modified'))));
      const tb = h('tbody');
      if (dir !== MG.app.HOME) {
        const up = h('button', { type: 'button', html: IC('dotdot') + '<span>..</span>' });
        up.addEventListener('click', () => ((this.filesDir = MG.path.dirname(dir)), this.renderFiles()));
        tb.appendChild(h('tr', h('td'), h('td.nm', up), h('td.sz'), h('td.mt')));
      }
      for (const c of rows) {
        const isDir = c.entry.kind === 'dir';
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + c.name, dataset: { path: c.path } });
        const icon = isDir ? 'folder' : /\.r$/i.test(c.name) ? 'code' : /\.(rmd|qmd)$/i.test(c.name) ? 'book' : /\.(csv|tsv|xlsx?)$/i.test(c.name) ? 'table' : /\.(png|jpe?g|svg|pdf)$/i.test(c.name) ? 'image' : /\.html?$/i.test(c.name) ? 'globe' : /\.rdata$|\.rds$/i.test(c.name) ? 'env' : 'file';
        const b = h('button' + (isDir ? '.dir' : ''), { type: 'button', html: IC(icon) + `<span>${esc(c.name)}</span>` });
        b.addEventListener('click', (e) => this._fileClick(c, e.currentTarget));
        const t = new Date(c.entry.mtime || Date.now());
        const when = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        tb.appendChild(h('tr', h('td', cb), h('td.nm', b), h('td.sz', isDir ? '' : fmtSize(fs.size(c.entry))), h('td.mt', isDir ? '' : when)));
      }
      table.appendChild(tb);
      this.fileList.innerHTML = '';
      this.fileList.appendChild(table);
      if (!rows.length) this.fileList.appendChild(h('div.rs-empty', 'No files in this folder.'));
    }
    _fileClick(c, anchor) {
      const p = c.path, n = c.name;
      if (c.entry.kind === 'dir') {
        this.filesDir = p;
        return this.renderFiles();
      }
      if (/\.(csv|tsv|txt)$/i.test(n) && /\.(csv|tsv)$/i.test(n))
        return MG.popmenu(anchor, [
          ['eye', 'View File', () => this.openFile(p)],
          ['table', 'Import Dataset…', () => this.importDialog('readr', p)]
        ]);
      if (/\.xlsx?$/i.test(n)) return this.importDialog('excel', p);
      if (/\.html?$/i.test(n))
        return MG.popmenu(anchor, [
          ['code', 'Open in Editor', () => this.openFile(p)],
          ['globe', 'View in Web Browser', () => this.viewFile(p)]
        ]);
      if (/\.(rdata|rda)$/i.test(n)) return MG.confirmBox('Confirm Load RData', `<p>Do you want to load the R data file "${esc(this.fs.pretty(p))}" into the global environment?</p>`, 'Yes').then((ok) => ok && this.consoleRun(`load(${rstr(this.fs.pretty(p))})`));
      if (/\.rds$/i.test(n)) return this.consoleType(`${n.replace(/\.rds$/i, '').replace(/[^\w.]/g, '_')} <- readRDS(${rstr(this.fs.pretty(p))})`);
      if (/\.(png|jpe?g|gif|svg|pdf)$/i.test(n)) return MG.app.browse(p);
      return this.openFile(p);
    }
    _checked() {
      return Array.from(this.fileList.querySelectorAll('input[type=checkbox]:checked')).map((x) => x.dataset.path);
    }
    async _newFolder() {
      const name = await MG.promptText('New Folder', 'Please enter the new folder name:', 'Folder', 'OK');
      if (!name) return;
      this.fs.mkdirp(this.filesDir + '/' + name.replace(/[\/\\]/g, '_'));
      this.renderFiles();
    }
    async _newBlank(ext) {
      const name = await MG.promptText('New Blank File', 'File name:', 'Untitled' + ext, 'OK');
      if (!name) return;
      const p = this.filesDir + '/' + name.replace(/[\/\\]/g, '_');
      if (this.fs.exists(p)) return toast('A file with that name already exists.', 'warn');
      this.fs.writeText(p, '');
      this.renderFiles();
      this.openFile(p);
    }
    async _fileAct(what) {
      const sel = this._checked();
      if (!sel.length) return toast('Tick one or more files first.', 'warn');
      const fs = this.fs;
      if (what === 'delete') {
        if (!(await MG.confirmBox('Confirm Delete', `<p>Are you sure you want to permanently delete ${sel.length === 1 ? '<b>' + esc(MG.path.basename(sel[0])) + '</b>' : sel.length + ' files'}? This cannot be undone.</p>`, 'Delete', { danger: true }))) return;
        sel.forEach((p) => fs.remove(p));
      } else if (what === 'rename') {
        const p = sel[0];
        const name = await MG.promptText('Rename File', 'New name:', MG.path.basename(p), 'OK');
        if (!name || name === MG.path.basename(p)) return;
        fs.rename(p, MG.path.dirname(p) + '/' + name.replace(/[\/\\]/g, '_'));
      } else if (what === 'copy' || what === 'move') {
        const to = await MG.promptText(what === 'copy' ? 'Copy File' : 'Move Files', `Enter the folder to ${what} ${sel.length === 1 ? 'the file' : 'the files'} to. It must be in your home folder, for example ~/results.`, '~/', 'OK');
        if (!to) return;
        const dest = fs.resolve(to);
        if (!dest.startsWith(MG.app.HOME)) return toast('Please choose a folder inside your home folder.', 'warn');
        fs.mkdirp(dest);
        for (const p of sel) {
          if (what === 'copy' && fs.get(p).kind !== 'dir') fs.copy(p, dest + '/' + MG.path.basename(p));
          else if (what === 'move') fs.rename(p, dest + '/' + MG.path.basename(p));
        }
      } else if (what === 'export') {
        for (const p of sel) {
          if (fs.isDir(p)) await MG.project.download(p, MG.path.basename(p) + '.zip');
          else MG.downloadBlob(await fs.toBlob(p), MG.path.basename(p));
        }
      }
      this.renderFiles();
    }
    _fsChanged(path, what) {
      clearTimeout(this._ft);
      this._ft = setTimeout(() => this.panes.files.cur === 'files' && this.renderFiles(), 200);
      // an open document whose file was renamed or moved (Files, the terminal: a 'remove' then a 'rename'), or changed
      if (what === 'remove') {
        this._removed = path;
        return;
      }
      if (what === 'rename' && this._removed) {
        const was = this._removed;
        this._removed = null;
        for (const x of this.docs) {
          if (x.type !== 'code' || !x.path || !(x.path === was || x.path.startsWith(was + '/'))) continue;
          x.path = path + x.path.slice(was.length);
          x.name = MG.path.basename(x.path);
        }
        this._renderSrcTabs();
        this._saveOpen();
        return;
      }
      const d = this.docs.find((x) => x.path === path);
      if (!d || d.saving) return;
      if (what === 'write') this._reloadDoc(d);
    }
    async _reloadDoc(d) {
      const e = this.fs.get(d.path);
      if (!e || e === d.entry || e.kind === 'dir') return;
      let text;
      try {
        text = await this.fs.readText(d.path);
      } catch (err) {
        return;
      }
      d.entry = e;
      if (text === d.saved) return;
      if (d.dirty) {
        toast(`<b>${esc(d.name)}</b> has been changed on disk (by R, the terminal or the Files tab). Your unsaved edits have been kept, but if you save them, they will replace the other version.`, 'warn', 8000);
        return;
      }
      const cur = d === this.cur ? this.cm.getCursor() : null;
      d.saved = text;
      d.cmDoc.setValue(text);
      d.gen = d.cmDoc.changeGeneration(true);
      d.dirty = false;
      if (cur) this.cm.setCursor(cur);
      this._renderSrcTabs();
      this._decorate(d, true);
    }
    /* ---------- Plots ---------- */
    _plot(d) {
      if (this.capture && !this.capture.done) return this._capturePlot(d);
      if (d.kind === 'new') {
        // (a plot drawn again at the pane's new size takes the place of the one it redraws)
        if (this._replacing != null && this.plots[this._replacing]) {
          const p = this.plots[this._replacing];
          p.id = d.id;
          p.plot.newPage();
          this._replacing = null;
          this.plotAt = this.plots.indexOf(p);
        } else {
          const box = this.plotBox.getBoundingClientRect();
          const plot = new MG.PlotCanvas(Math.max(200, box.width) * 2, Math.max(150, box.height) * 2);
          this.plots.push({ id: d.id, plot });
          if (this.plots.length > 30) this.plots.shift();
          this.plotAt = this.plots.length - 1;
          this.showTab('files', 'plots');
          bus.emit('rstudio:plot', { n: this.plots.length });
        }
        this._plotShow();
        return;
      }
      // (a device's pictures go to its newest page: each new page of a device is a plot of its own in the history)
      let p = null;
      for (let i = this.plots.length - 1; i >= 0 && !p; i--) if (this.plots[i].id === d.id) p = this.plots[i];
      p = p || this.plots[this.plots.length - 1];
      if (p) p.plot.draw(d.image);
    }
    _plotShow() {
      const p = this.plots[this.plotAt];
      this.plotBox.innerHTML = '';
      if (p) this.plotBox.appendChild(p.plot.canvas);
      else this.plotBox.appendChild(h('div.rs-empty', 'There are no plots yet. Plots made with plot(), hist() or ggplot will appear here.'));
      this.plotPrev.disabled = this.plotAt <= 0;
      this.plotNext.disabled = this.plotAt >= this.plots.length - 1;
      this.plotInfo.textContent = this.plots.length ? `${this.plotAt + 1} / ${this.plots.length}` : '';
    }
    plotGo(d) {
      this.plotAt = MG.clamp(this.plotAt + d, 0, this.plots.length - 1);
      this._plotShow();
    }
    /** the size of the Plots tab – also while another tab of its pane is shown: the pane, less the toolbar */
    _plotSize() {
      const r = this.panes.files.body.getBoundingClientRect();
      return { w: Math.max(200, Math.round(r.width)), h: Math.max(150, Math.round(r.height - 30)) };
    }
    async _plotResize() {
      if (!this.S || !this.S.ready || !this.panes.files.body.offsetParent) return;
      const s = this._plotSize();
      // (R's devices have 72 pixels to the inch, the page 96: a plot is drawn at 3/4 of the pane's size in R's pixels
      // and shown at the pane's size – its text is as large as in RStudio)
      await this.S.figSize(s.w * 0.75, s.h * 0.75);
      // the latest plot is drawn again at the new size (R keeps only the latest plot's drawing instructions)
      const last = this.plots.length - 1;
      if (last < 0 || this.plotAt !== last || !this.S.idle) return;
      const p = this.plots[last];
      const c = p.plot.canvas;
      if (Math.abs(c.width / 1.5 - s.w) < 8 && Math.abs(c.height / 1.5 - s.h) < 8) return;
      this._replacing = last;
      await this.S.evalVoid(`local({ if (grDevices::dev.cur() > 1 && identical(names(grDevices::dev.cur()), "canvas")) { p <- grDevices::recordPlot(); grDevices::dev.off(); grDevices::dev.new(); grDevices::replayPlot(p) } })`);
      setTimeout(() => (this._replacing = null), 1500);
    }
    plotZoom() {
      const p = this.plots[this.plotAt];
      if (!p) return;
      const m = MG.modal('Plot Zoom', '');
      m.box.classList.add('wide');
      const img = h('img', { src: p.plot.png(), alt: 'Plot', style: { maxWidth: '100%', display: 'block', margin: 'auto' } });
      m.box.querySelector('.modal-b').appendChild(img);
    }
    plotExport() {
      const p = this.plots[this.plotAt];
      if (!p) return toast('There is no plot to export.', 'warn');
      const a = h('a', { href: p.plot.png(), download: 'Rplot.png' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Rplot.png has been downloaded to your computer. (To save a plot into your files from R, use <code>png("plot.png")</code> … <code>dev.off()</code>, or <code>ggsave()</code>.)', null, 6000);
    }
    async plotCopy() {
      const p = this.plots[this.plotAt];
      if (!p) return;
      try {
        const blob = await (await fetch(p.plot.png())).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('The plot has been copied to the clipboard.', 'ok');
      } catch (e) {
        toast('This browser did not allow the plot to be copied. Please use Save as Image instead.', 'warn');
      }
    }
    plotRemove() {
      if (this.plotAt < 0) return;
      this.plots.splice(this.plotAt, 1);
      this.plotAt = Math.min(this.plotAt, this.plots.length - 1);
      this._plotShow();
    }
    async plotClear() {
      if (!this.plots.length) return;
      if (!(await MG.confirmBox('Clear Plots', '<p>Are you sure you want to clear all of the plots in the history?</p>', 'Yes'))) return;
      this.plots = [];
      this.plotAt = -1;
      this._plotShow();
      if (this.S && this.S.idle) this.S.evalVoid('grDevices::graphics.off()');
    }
    /* ---------- Packages ---------- */
    async refreshPackages() {
      if (!this.S || !this.S.idle) return;
      const lines = await this.S.evalLines('local({ ip <- utils::installed.packages(fields = "Title"); att <- .packages(); paste(ip[, "Package"], ip[, "Version"], ifelse(is.na(ip[, "Priority"]), "", ip[, "Priority"]), gsub("[\\t\\n]+", " ", ifelse(is.na(ip[, "Title"]), "", ip[, "Title"])), ip[, "Package"] %in% att, sep = "\\t") })');
      if (!lines) return;
      this.pkgs = lines.map((l) => {
        const [name, version, priority, title, attached] = l.split('\t');
        return { name, version, priority, title, attached: attached === 'TRUE' };
      });
      this._renderPackages();
    }
    _renderPackages() {
      const L = this.pkgList;
      if (!L) return;
      const q = (this.pkgSearch.value || '').toLowerCase();
      const have = new Map((this.pkgs || []).map((p) => [p.name, p]));
      const user = MG.R.userlib.list();
      const userRows = user.map((n) => have.get(n) || { name: n, version: '', title: '(installed – it is loaded into this R session the first time it is used)', attached: false });
      const sys = (this.pkgs || []).filter((p) => !user.includes(p.name) && (p.priority === 'base' || p.priority === 'recommended' || p.name === 'webr'));
      const more = (this.pkgs || []).filter((p) => !user.includes(p.name) && !(p.priority === 'base' || p.priority === 'recommended' || p.name === 'webr'));
      const t = h('table', h('thead', h('tr', h('th', ''), h('th', 'Name'), h('th', 'Description'), h('th', 'Version'))));
      const tb = h('tbody');
      const sec = (title, rows) => {
        rows = rows.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
        if (!rows.length) return;
        tb.appendChild(h('tr', h('td.sec', { colspan: '4' }, title)));
        rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        for (const p of rows) {
          const cb = h('input', { type: 'checkbox', 'aria-label': (p.attached ? 'Detach ' : 'Load ') + p.name });
          cb.checked = !!p.attached;
          cb.addEventListener('change', () => this.consoleRun(cb.checked ? `library(${p.name})` : `detach("package:${p.name}", unload = TRUE)`));
          const nm = h('button.pk', { type: 'button', title: 'Help for the package' }, p.name);
          nm.addEventListener('click', () => this.consoleRun(`help(package = "${p.name}")`));
          tb.appendChild(h('tr', h('td', cb), h('td', nm), h('td.desc', p.title || ''), h('td.ver', p.version || '')));
        }
      };
      sec('User Library', userRows);
      sec('System Library', sys.concat(more));
      t.appendChild(tb);
      L.innerHTML = '';
      L.appendChild(t);
    }
    async installDialog(pkgs) {
      const m = MG.modal('Install Packages', '');
      m.box.classList.add('rs-dialog');
      const inp = h('input', { type: 'text', value: pkgs || '', placeholder: 'e.g. ggplot2, dplyr', style: { width: '100%' }, 'aria-label': 'Packages' });
      const deps = h('input', { type: 'checkbox', checked: true });
      const go = h('button.btn.primary', { type: 'button' }, 'Install');
      const cancel = h('button.btn', { type: 'button' }, 'Cancel');
      m.box.querySelector('.modal-b').append(
        h('label.row', h('span', 'Install from:'), h('span', 'Repository (webR: CRAN packages built for the browser)')),
        h('label.row', h('span', 'Packages'), inp),
        h('p.muted', { style: { fontSize: '12px', margin: '2px 0 0 9.6em' } }, 'Separate multiple packages with a space or comma'),
        h('label.row', h('span', 'Install to library:'), h('span', '/usr/lib/R/library [Default] – kept in this browser and available to every R session in the workbench')),
        h('label.check', { style: { marginTop: '6px' } }, deps, 'Install dependencies'),
        h('div.prompt-actions', cancel, go)
      );
      cancel.addEventListener('click', () => m.close());
      const run = () => {
        const list = inp.value.split(/[\s,]+/).filter(Boolean);
        if (!list.length) return;
        m.close();
        this.consoleRun(list.length === 1 ? `install.packages("${list[0]}")` : `install.packages(c(${list.map((x) => `"${x}"`).join(', ')}))`);
      };
      go.addEventListener('click', run);
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && run());
      setTimeout(() => inp.focus(), 30);
    }
    /* ---------- Help ---------- */
    _help(d) {
      if (d.missing) {
        this.helpBody.innerHTML = '';
        this.helpBody.appendChild(h('div.rs-empty', `No documentation for ‘${d.topic}’ in specified packages and libraries.`));
        this.showTab('files', 'help');
        return;
      }
      if (!this._helpNavigating) {
        this.helpHist = this.helpHist.slice(0, this.helpAt + 1);
        this.helpHist.push({ topic: d.topic, package: d.package });
        this.helpAt = this.helpHist.length - 1;
      }
      this._helpNavigating = false;
      this.helpTitle.textContent = `R: ${d.title || d.topic}`;
      this.helpBody.innerHTML = '';
      this.helpBody.appendChild(MG.helpHtml(d.html, (topic, pkg) => this.helpTopic(topic, pkg)));
      this.helpBody.scrollTop = 0;
      this.showTab('files', 'help');
    }
    _helpChoice(d) {
      this.helpBody.innerHTML = '';
      const box = h('div', h('h3', { style: { fontSize: '14px' } }, `Help on topic ‘${d.topic}’ was found in the following packages:`));
      const ul = h('ul');
      d.files.forEach((f, i) => {
        const a = h('a', { href: '#' }, `${d.topic} {${d.packages[i]}}`);
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.S.helpFile(f, d.topic);
        });
        ul.appendChild(h('li', a));
      });
      box.appendChild(ul);
      this.helpBody.appendChild(box);
      this.showTab('files', 'help');
    }
    helpTopic(topic, pkg) {
      if (!this.S || !this.S.idle) return toast('R is still busy. Please wait until it has finished.', 'warn');
      this.S.helpTopic(topic, pkg || '');
    }
    _helpNav(d) {
      const at = this.helpAt + d;
      const t = this.helpHist[at];
      if (!t) return;
      this.helpAt = at;
      this._helpNavigating = true;
      this.helpTopic(t.topic, t.package);
    }
    helpHome(quiet) {
      this.helpTitle.textContent = 'R Help';
      this.helpBody.innerHTML = '';
      const box = h('div.rs-helphome');
      box.innerHTML = `<h2>R Resources</h2>
<p>To see R's help on a topic, type it in the search box above, or type <code>?name</code> in the Console. A help page explains what a function does, describes its arguments and gives examples.</p>
<ul>
<li><a data-topic="mean">mean</a> · <a data-topic="read.csv">read.csv</a> · <a data-topic="plot">plot</a> · <a data-topic="summary">summary</a> · <a data-topic="penguins">penguins</a></li>
</ul>
<h2>Manuals</h2>
<ul>
<li><a href="https://cran.r-project.org/doc/manuals/r-release/R-intro.html" target="_blank" rel="noopener">An Introduction to R</a></li>
<li><a href="https://cran.r-project.org/doc/manuals/r-release/R-data.html" target="_blank" rel="noopener">R Data Import/Export</a></li>
<li><a href="https://rmarkdown.rstudio.com/lesson-1.html" target="_blank" rel="noopener">R Markdown (rmarkdown.rstudio.com)</a> · <a href="https://quarto.org/docs/get-started/" target="_blank" rel="noopener">Quarto (quarto.org)</a></li>
</ul>`;
      box.querySelectorAll('a[data-topic]').forEach((a) =>
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.helpTopic(a.dataset.topic);
        })
      );
      this.helpBody.appendChild(box);
      if (!quiet) this.showTab('files', 'help');
    }
    /* ---------- Viewer ---------- */
    viewerClear() {
      if (MG.Shiny && this.shinyApp) return MG.Shiny.stop(this.S);
      this.viewerBox.innerHTML = '';
      this.viewerBox.appendChild(h('div.rs-empty', 'Web content appears here, such as knitted documents, Shiny apps and HTML widgets.'));
      this.viewerTitle.textContent = '';
      this.viewerNow = null;
    }
    /** an HTML file of the user's in the Viewer */
    async viewFile(path) {
      const html = await this.fs.readText(path);
      this.viewHtml(html, this.fs.pretty(path), path);
    }
    viewHtml(html, title, path) {
      if (MG.Shiny && this.shinyApp) MG.Shiny.stop(this.S, true);
      this.viewerBox.innerHTML = '';
      const fr = h('iframe.rs-viewer', { title: title || 'Viewer', sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox' });
      fr.srcdoc = html;
      this.viewerBox.appendChild(fr);
      this.viewerTitle.textContent = title || '';
      this.viewerNow = { html, path, title };
      this.showTab('files', 'viewer');
      bus.emit('rstudio:viewer', { path: path || '', title: title || '' });
    }
    viewUrl(url, title) {
      this.viewerBox.innerHTML = '';
      const fr = h('iframe.rs-viewer', { title: title || 'Viewer', src: url });
      this.viewerBox.appendChild(fr);
      this.viewerTitle.textContent = title || url;
      this.viewerNow = { url, title };
      this.showTab('files', 'viewer');
    }
    viewerOpen() {
      const v = this.viewerNow;
      if (!v) return;
      if (v.url) return window.open(v.url, '_blank');
      const u = URL.createObjectURL(new Blob([v.html], { type: 'text/html' }));
      window.open(u, '_blank');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  MG.RStudioApp = RStudioApp;
  MG.RStudio = { incomplete, rmdTemplate, qmdTemplate, SHINY_TEMPLATE, fmtSize };
})();
