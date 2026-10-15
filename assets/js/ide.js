/* =====================================================================
   The IDE tab. Most work in the workbench is done in the notebook, but
   some jobs are easier in an integrated development environment: a
   script that is too long for a few cells, an R Markdown or Quarto
   report, a Shiny app, or code to step through line by line. The tab
   offers two IDEs:

     RStudio   for R        rstudio.js and rsource.js, with R from
                            rsession.js (webR in a worker of its own)
     Spyder    for Python   spyder.js, with Python from pyide.js
                            (Pyodide in a worker of its own)

   Both are imitations of the real programs, made for teaching. They
   are not RStudio and Spyder themselves, and they are not made or
   endorsed by Posit or by the Spyder project.

   Neither IDE is loaded with the page: the tab opens on a choice
   between them, and an IDE's scripts and styles are loaded the first
   time it is opened. Once open, an IDE keeps running while the other
   one is shown, and the bar at the top of the tab switches between
   them.

   MG.app.openIDE(name)          show RStudio or Spyder ('rstudio' | 'spyder'), opening it first if need be
                                 → a promise of the IDE
   MG.app.ideReady(name)         the same, once the IDE has reopened the documents of the last visit
   MG.app.openInRStudio(path)    open a file in RStudio's Source pane
   MG.app.openInSpyder(path)     open a file in Spyder's Editor
   MG.app.openInIDE(path)        open a file in the IDE it belongs to (MG.app.ideFor)
   MG.app.ideFor(path)           'rstudio' | 'spyder' | null
   MG.app.browse(url, opts)      what R's browseURL() asks to show
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast } = MG;
  MG.app = MG.app || {};
  MG.page = MG.page || {};
  MG.actions = MG.actions || {};

  /* ------------------------------------------------------------------
     the two IDEs: what each one needs, loaded the first time it opens
     ------------------------------------------------------------------ */
  const CM = 'assets/vendor/codemirror/';
  const IDES = {
    rstudio: {
      name: 'RStudio',
      lang: 'R',
      icon: 'rlang',
      css: ['assets/css/r.css', 'assets/css/rstudio.css'],
      // (CodeMirror's add-ons first: the R Markdown mode is built from the overlay, multiplex and front-matter ones)
      js: [CM + 'overlay.js', CM + 'multiplex.js', CM + 'yaml-frontmatter.js', CM + 'rmarkdown.js', CM + 'searchcursor.js', CM + 'active-line.js', CM + 'runmode.js', 'assets/js/rsession.js', 'assets/js/rui.js', 'assets/js/dataview.js', 'assets/js/knit.js', 'assets/js/rstudio.js', 'assets/js/rsource.js', 'assets/js/shiny.js'],
      make: (root) => (MG.app.rstudio = new MG.RStudioApp(root, { fs: MG.app.fs })),
      files: /\.(r|rmd|rmarkdown|qmd|rnw|rhistory|rprofile)$|(^|\/)\.rprofile$/i
    },
    spyder: {
      name: 'Spyder',
      lang: 'Python',
      icon: 'python',
      css: ['assets/css/r.css', 'assets/css/spyder.css'],
      js: [CM + 'searchcursor.js', CM + 'active-line.js', CM + 'runmode.js', 'assets/js/rui.js', 'assets/js/dataview.js', 'assets/js/pyide.js', 'assets/js/spyder.js', 'assets/js/spyder-panes.js'],
      make: (root) => (MG.app.spyder = new MG.SpyderApp(root, { fs: MG.app.fs })),
      files: /\.(py|pyw|pyi)$/i
    }
  };
  MG.app.IDES = IDES;

  /* each script and style sheet is loaded once (one that could not be loaded is tried again the next time) */
  const once = {};
  const loadOnce = (key, make) => {
    if (!once[key]) {
      once[key] = make();
      once[key].catch(() => delete once[key]);
    }
    return once[key];
  };
  const loadJs = (src) => loadOnce(src, () => MG.loadScript(src));
  const loadCss = (href) =>
    loadOnce(
      href,
      () =>
        new Promise((resolve, reject) => {
          const l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = href;
          l.onload = resolve;
          l.onerror = () => {
            l.remove();
            reject(new Error('Could not load ' + href));
          };
          document.head.appendChild(l);
        })
    );

  /* ------------------------------------------------------------------
     the tab: the choice of IDE, the bar that switches between them, and
     a place for each IDE
     ------------------------------------------------------------------ */
  class IDETab {
    constructor(root) {
      this.root = root;
      this.apps = {}; // name → the IDE, once it has opened
      this.opening = {}; // name → a promise, while its scripts load
      this.hosts = {};
      this.btns = {};
      this.cur = null;
      this._build();
    }
    _build() {
      const R = this.root;
      R.classList.add('ide');
      const sw = h('div.ide-switch', { role: 'tablist', 'aria-label': 'IDEs' });
      for (const [name, I] of Object.entries(IDES)) {
        const b = h('button.ide-sw', { type: 'button', role: 'tab', 'aria-selected': 'false', title: `${I.name}, the IDE for ${I.lang}`, html: MG.icon(I.icon) + `<span>${esc(I.name)}</span><i class="ide-state" aria-hidden="true"></i>` });
        b.addEventListener('click', () => this.show(name));
        sw.appendChild(b);
        this.btns[name] = b;
      }
      const help = h('button.ide-helpbtn', { type: 'button', title: 'How the IDEs work, in the help pane', html: MG.icon('help') + '<span>About the IDEs</span>' });
      help.addEventListener('click', () => MG.app.showHelp && MG.app.showHelp('h-ide'));
      this.bar = h('div.ide-bar', { hidden: true }, sw, h('span.ide-grow'), help);
      this.body = h('div.ide-body');
      this.launcher = this._launcher();
      this.body.appendChild(this.launcher);
      for (const name of Object.keys(IDES)) {
        this.hosts[name] = h('div.ide-host.ide-host-' + name, { hidden: true });
        this.body.appendChild(this.hosts[name]);
      }
      R.append(this.bar, this.body);
    }

    /** the first thing the tab shows: a card for each IDE, with a sketch of where its panes are */
    _launcher() {
      const shot = (name, panes) =>
        h(
          'div.ide-shot.ide-shot-' + name,
          { 'aria-hidden': 'true' },
          h('div.ide-shot-bar', h('i'), h('i'), h('i')),
          h('div.ide-shot-grid', panes.map(([cls, label]) => h('span.ide-shot-p.' + cls, label)))
        );
      const card = (name, panes, lead, text) => {
        const I = IDES[name];
        const go = h('button.btn.primary.ide-go', { type: 'button', html: MG.icon(I.icon) + `<span>Open ${esc(I.name)}</span>` });
        go.addEventListener('click', () => this.show(name));
        return h(
          'article.ide-card.ide-card-' + name,
          shot(name, panes),
          h('div.ide-card-b', h('h3', I.name, h('span.ide-lang', 'for ' + I.lang)), h('p.ide-lead', lead), h('p', text), go)
        );
      };
      const more = h('button.linkbtn', { type: 'button' }, 'the help page about the IDEs');
      more.addEventListener('click', () => MG.app.showHelp && MG.app.showHelp('h-ide'));
      return h(
        'div.ide-launch',
        h(
          'div.ide-launch-in',
          h('h2', 'Integrated development environments'),
          h(
            'p.ide-intro',
            'The notebook is the main place to work in this workbench, but some jobs are easier in an IDE: writing a script that is longer than a few cells, turning an analysis into a report, building a Shiny app, or going through your code line by line to find out why it doesn’t do what you expected. Choose the IDE for the language you are working in.'
          ),
          h(
            'div.ide-cards',
            card(
              'rstudio',
              [['src', 'Source'], ['env', 'Environment'], ['con', 'Console'], ['files', 'Files, Plots, Help']],
              'The IDE most people use for R.',
              'Write R scripts, R Markdown and Quarto documents and Shiny apps. The Console runs R as you type, and the panes on the right show your objects, files, plots, installed packages and R’s help pages.'
            ),
            card(
              'spyder',
              [['ed', 'Editor'], ['vars', 'Variable Explorer, Plots, Help'], ['con', 'IPython Console']],
              'A Python IDE made for scientific work.',
              'Write Python scripts and run them all at once or a cell at a time. The IPython Console runs Python as you type, the Variable Explorer shows your variables (data frames and arrays as tables), and the debugger steps through your code a line at a time.'
            )
          ),
          h(
            'div.ide-notes',
            h('h3', 'Good to know'),
            h(
              'ul',
              h('li', 'Each IDE has its own R or Python, separate from the notebook’s. A variable you create in RStudio or Spyder doesn’t exist in the notebook, and the other way round. They all work on the same files, though, so a script can read a file that a notebook wrote.'),
              h('li', 'The first time you open an IDE, your browser downloads R or Python, which can take a minute (R is about 30 MB). After that it keeps a copy, and the IDE opens much more quickly.'),
              h('li', 'Both IDEs are imitations of the real programs, made for teaching, and they work in the same way as far as possible. They are not RStudio and Spyder themselves, and they are not made or endorsed by Posit or by the Spyder project.'),
              h('li', 'You can have both open at once, and switch between them with the buttons at the top of this tab. For more, see ', more, '.')
            )
          )
        )
      );
    }

    /** open an IDE (the first time: load it) and show it → a promise of the IDE */
    async show(name, opts = {}) {
      if (!IDES[name]) return null;
      this._select(name);
      let app = null;
      try {
        app = await this.open(name);
      } catch (e) {
        return null;
      }
      if (this.cur === name && !opts.quiet) this._shown(opts);
      return app;
    }
    /** load and start an IDE, if it has not been opened yet → a promise of the IDE */
    open(name) {
      if (this.apps[name]) return Promise.resolve(this.apps[name]);
      if (this.opening[name]) return this.opening[name];
      const I = IDES[name];
      const host = this.hosts[name];
      const b = this.btns[name];
      host.innerHTML = '';
      host.appendChild(h('div.wb-loading', h('span.spinner'), ` Loading ${I.name}…`));
      b.classList.add('opening');
      const p = (async () => {
        const css = Promise.all(I.css.map(loadCss));
        for (const src of I.js) await loadJs(src);
        await css;
        host.innerHTML = '';
        const root = h('div.ide-app');
        host.appendChild(root);
        const app = I.make(root);
        this.apps[name] = app;
        return app;
      })();
      this.opening[name] = p;
      p.then(
        () => {
          delete this.opening[name];
          b.classList.remove('opening');
          b.classList.add('open');
          bus.emit('ide:open', { name });
        },
        (e) => {
          console.error(e);
          delete this.opening[name];
          b.classList.remove('opening');
          // (the scripts that did load stay loaded: trying again loads the rest)
          host.innerHTML = '';
          const again = h('button.btn', { type: 'button' }, 'Try again');
          again.addEventListener('click', () => this.show(name));
          host.appendChild(h('div.wb-failed', h('h3', `${I.name} could not be opened`), h('p', (e && e.message) || String(e)), h('p', 'Check your internet connection, then try again or reload the page.'), again));
        }
      );
      return p;
    }
    _select(name) {
      this.cur = name;
      this.bar.hidden = false;
      this.launcher.hidden = true;
      for (const [n, host] of Object.entries(this.hosts)) host.hidden = n !== name;
      for (const [n, b] of Object.entries(this.btns)) {
        b.classList.toggle('on', n === name);
        b.setAttribute('aria-selected', n === name ? 'true' : 'false');
      }
      bus.emit('ide:show', { name });
    }
    _shown(opts) {
      const app = this.cur && this.apps[this.cur];
      if (app && app.shown) app.shown(opts);
    }
    /** the IDE tab was shown (or resized) */
    shown(opts) {
      this._shown(opts);
    }
    /** the files with changes that have not been saved, in every open IDE */
    dirtyPaths() {
      const out = [];
      for (const app of Object.values(this.apps)) if (app && app.dirtyPaths) out.push(...app.dirtyPaths());
      return out;
    }
  }

  /* ------------------------------------------------------------------
     the tab is built the first time it is shown (workbench.js)
     ------------------------------------------------------------------ */
  MG.page.lazy = MG.page.lazy || {};
  MG.page.shown = MG.page.shown || {};
  MG.page.lazy.ide = (pane) => {
    MG.app.ideTab = new IDETab(pane.querySelector('#ideRoot'));
  };
  MG.page.shown.ide = (pane, opts) => MG.app.ideTab && MG.app.ideTab.shown(opts);

  /** show an IDE, opening it first if need be → a promise of the IDE (null if it could not be opened) */
  MG.app.openIDE = async (name, opts = {}) => {
    await MG.app.showWorkbench('ide');
    const T = MG.app.ideTab;
    return T ? T.show(name, opts) : null;
  };
  /** the IDE that a file belongs to: 'rstudio' (R, R Markdown, Quarto), 'spyder' (Python) or null */
  MG.app.ideFor = (path) => {
    const p = String(path || '');
    for (const [name, I] of Object.entries(IDES)) if (I.files.test(p)) return name;
    return null;
  };
  /** show an IDE, and wait until it has brought back the documents of the last visit (so that a document opened or
      added now is not hidden behind them) → a promise of the IDE, or null */
  MG.app.ideReady = async (name) => {
    const app = await MG.app.openIDE(name);
    if (app && app.restored) await app.restored.catch(() => {});
    return app;
  };
  /** open a file in RStudio's Source pane */
  MG.app.openInRStudio = async (path, opts = {}) => {
    const rs = await MG.app.ideReady('rstudio');
    if (rs) return rs.openFile(MG.app.fs.resolve(path), opts);
  };
  /** open a file in Spyder's Editor */
  MG.app.openInSpyder = async (path, opts = {}) => {
    const sp = await MG.app.ideReady('spyder');
    if (sp) return sp.openFile(MG.app.fs.resolve(path), opts);
  };
  /** open a file in the IDE it belongs to (Files in the other cases) */
  MG.app.openInIDE = (path, opts = {}) => {
    const ide = MG.app.ideFor(path);
    if (ide === 'rstudio') return MG.app.openInRStudio(path, opts);
    if (ide === 'spyder') return MG.app.openInSpyder(path, opts);
    return MG.app.editFile(path, opts);
  };

  /** what R's browseURL() asks to show: a web address in a new browser tab; a file of R's (an HTML report) in
      RStudio's Viewer when RStudio asked, else in a new browser tab */
  MG.app.browse = async (url, opts = {}) => {
    url = String(url || '');
    if (/^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const fs = MG.app.fs;
    const p = fs.resolve(url.replace(/^file:\/\//, ''));
    if (!fs.exists(p)) {
      toast(`There is no file ${esc(url)} to show.`, 'warn');
      return;
    }
    if (opts.from === 'rstudio' && MG.app.rstudio) return MG.app.rstudio.viewFile(p);
    const blob = await fs.toBlob(p);
    const type = /\.html?$/i.test(p) ? 'text/html' : /\.pdf$/i.test(p) ? 'application/pdf' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'text/plain';
    const u = URL.createObjectURL(new Blob([blob], { type }));
    const w = window.open(u, '_blank');
    if (!w) toast('The browser didn’t open a new tab, perhaps because pop-ups are blocked. You can find the file in the Files tab.', 'warn', 6000);
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  };

  /* Documents in the IDEs are saved with Save (Ctrl+S): before the page is left or reloaded with unsaved changes,
     the browser asks (with its own message). Not after Start afresh, which deletes the files anyway. */
  let resetting = false;
  window.addEventListener('beforeunload', (e) => {
    if (resetting || !MG.app.ideTab) return;
    if (MG.app.ideTab.dirtyPaths().length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  const beforeReset = MG.page.beforeReset;
  MG.page.beforeReset = async () => {
    resetting = true;
    if (beforeReset) await beforeReset();
  };

  /* ------------------------------------------------------------------
     ▶ buttons of the help pages
     data-ide="rstudio|spyder"   show an IDE (opening it first if need be)
     data-rs-open="path"         open a file in RStudio (~/… or a path in the examples)
     data-rs-run="code"          run code in RStudio's Console
     data-sp-open="path"         open a file in Spyder
     data-sp-run="code"          run code in Spyder's IPython Console
     ------------------------------------------------------------------ */
  const HOME = () => MG.app.HOME;
  const inHome = (p) => (p.startsWith('/') ? p : p.startsWith('~/') ? HOME() + p.slice(1) : HOME() + '/' + p);
  const code = (s) => String(s).replace(/\\n/g, '\n');
  MG.actions.ide = async (name) => {
    if (!IDES[name]) throw new Error('There is no IDE called ' + name);
    await MG.app.openIDE(name);
  };
  MG.actions.rsOpen = async (p) => {
    if (!MG.app.fs.exists(inHome(p))) throw new Error(`There is no file ${p} (was it renamed or deleted?)`);
    return MG.app.openInRStudio(inHome(p));
  };
  MG.actions.rsRun = async (c) => {
    const rs = await MG.app.openIDE('rstudio');
    if (rs) rs.consoleRun(code(c));
  };
  MG.actions.spOpen = async (p) => {
    if (!MG.app.fs.exists(inHome(p))) throw new Error(`There is no file ${p} (was it renamed or deleted?)`);
    return MG.app.openInSpyder(inHome(p));
  };
  MG.actions.spRun = async (c) => {
    const sp = await MG.app.openIDE('spyder');
    if (sp) sp.consoleRun(code(c));
  };
})();
