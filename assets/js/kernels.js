/* =====================================================================
   The notebook's languages ("kernels"):
   · Python – Pyodide in a Web Worker (py-worker.js);
   · R      – webR (R compiled to WebAssembly), which runs its own worker.
   One Python and one R serve the whole page: every Python notebook and
   the terminal's python share the first, every R notebook and the
   terminal's Rscript the second. Each starts the first time it is
   needed.

   Both keep a copy of the home folder in their own file system: before
   code runs the files that changed are copied in, afterwards the files
   the code wrote are copied back (MG.pysync for Python, RSync for R).

   Shell commands from notebooks (Python's !ls, %%bash cells) run in a
   shell of their own on the page: the same programs as the terminal.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { bus, esc, toast } = MG;
  const CFG = MG.config;
  const abs = (u) => new URL(u, location.href).href;
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const MAX_SYNC = 300 * 1024 * 1024; // larger files are not copied into Python or R
  const under = (p) => p === HOME() || p.startsWith(HOME() + '/');

  /* example data that both languages can read (read-only): set by page-wb.js */
  const examples = () => (MG.app && MG.app.exampleFiles) || [];

  /* ------------------------------------------------------------------
     a shell for notebooks: !commands and %%bash cells
     ------------------------------------------------------------------ */
  let nbShell = null;
  function shellFor(cwd) {
    if (!nbShell) {
      const view = Object.create(MG.app.fs);
      view.cwd = HOME();
      nbShell = new MG.Shell({ fs: view, term: null, env: { PS1: '$ ' } });
      nbShell._view = view;
    }
    const F = MG.app.fs;
    nbShell._view.cwd = cwd && F.isDir(cwd) ? cwd : HOME();
    return nbShell;
  }
  let shellQueue = Promise.resolve();
  /** run shell commands for a notebook. opts: {cwd, capture, onOutput(o)} → {code, out} */
  function runShell(cmd, opts = {}) {
    const job = shellQueue.then(async () => {
      const sh = shellFor(opts.cwd);
      let out = '';
      const emit = (name, text) => {
        if (!text) return;
        if (name === 'stdout' && opts.capture) out += text;
        else if (opts.onOutput) opts.onOutput({ type: 'stream', name, text });
      };
      const asText = (t) => (t instanceof Uint8Array ? `[${t.length.toLocaleString('en')} bytes of binary output: send it to a file with  > file]\n` : String(t));
      const io = {
        out: (t) => emit('stdout', asText(t)),
        err: (t) => emit('stderr', String(t)),
        colored: (t) => emit('stdout', String(t)),
        note: (t) => emit('stderr', String(t).endsWith('\n') ? String(t) : String(t) + '\n'),
        html: (h) => opts.onOutput && opts.onOutput({ type: 'display', mime: 'text/html', data: String(h) }),
        progress: () => {},
        clear: () => {}
      };
      let code = 1;
      try {
        code = await sh.exec(cmd, io, { command: true, name: 'bash' });
      } catch (e) {
        emit('stderr', String((e && e.message) || e) + '\n');
        code = 1;
      }
      bus.emit('nb:shell', { cmd, code });
      return { code: Number(code) || 0, out };
    });
    shellQueue = job.catch(() => {});
    return job;
  }

  /* ------------------------------------------------------------------
     Python
     ------------------------------------------------------------------ */
  class PyKernel {
    constructor(opts) {
      this.lang = 'python';
      this.label = 'Python';
      this.opts = opts;
      // (the Python of the IDE tab – pyide.js – is a PyKernel as well, with a file sync of its own and its own name in
      // the kernel:state and kernel:status events, so that the notebook does not take its news for its own)
      this.evLang = opts.evLang || 'python';
      this.seq = 0;
      this.pending = new Map();
      this.state = 'off';
      this.versions = null;
      this.readyPromise = null;
    }
    /** start Python (if it is not running) → a promise that resolves when it is ready */
    ensure() {
      if (this.state === 'off' || this.state === 'failed') this.start();
      return this.readyPromise;
    }
    /** the copy of the home folder that this Python keeps in step with the page's (pysync.js) */
    get files() {
      return this.opts.sync || MG.pysync;
    }
    start() {
      this.state = 'loading';
      this._status('Starting Python…');
      bus.emit('kernel:state', { lang: this.evLang, state: 'loading' });
      this.worker = new Worker(this.opts.workerUrl);
      let resolveReady, rejectReady;
      this.readyPromise = new Promise((res, rej) => {
        resolveReady = res;
        rejectReady = rej;
      });
      this.readyPromise.catch(() => {});
      this._rejectReady = rejectReady;
      this.files.reset();
      this.worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'status') {
          if (!m.id) this._status(m.text);
          const p = this.pending.get(m.id);
          if (p && p.onStatus) p.onStatus(m.text);
        } else if (m.type === 'ready') {
          this.state = 'ready';
          this.versions = m.versions;
          this._status(null);
          resolveReady(m.versions);
          bus.emit('kernel:state', { lang: this.evLang, state: 'ready', versions: m.versions });
        } else if (m.type === 'background') {
          bus.emit('kernel:state', { lang: this.evLang, state: 'packages' });
        } else if (m.type === 'output') {
          const p = this.pending.get(m.id);
          if (p && p.onOutput) p.onOutput(JSON.parse(m.payload));
        } else if (m.type === 'done' || m.type === 'vars' || m.type === 'scanned') {
          if (m.changes) this.files.apply(m.changes);
          if (m.type === 'done' && m.where) this.where = m.where;
          const p = this.pending.get(m.id);
          if (p) {
            this.pending.delete(m.id);
            p.resolve(m.type === 'vars' ? m.value : m);
          }
        } else if (m.type === 'nb-shell') {
          this._nbShell(m);
        } else if (m.type === 'fs-changes' && this.opts.sync) {
          this.files.apply(m.changes);
        } else if (['term-out', 'term-done', 'smk-shell', 'fs-changes', 'pushed'].includes(m.type)) {
          MG.py.onExtra(m, this);
        } else if (m.type === 'fatal') {
          if (m.stage === 'init') {
            this.state = 'failed';
            this._status('Python could not start: ' + m.message, true);
            rejectReady(new Error(m.message));
            bus.emit('kernel:state', { lang: this.evLang, state: 'failed', message: m.message });
          } else {
            const p = this.pending.get(m.id);
            if (p) {
              this.pending.delete(m.id);
              p.reject(new Error(m.message));
            }
          }
        } else if (this.onMessage) {
          // (the other messages of a worker that does more than the notebook's: see pyide.js)
          this.onMessage(m);
        }
      };
      this.worker.onerror = (e) => {
        this.state = 'failed';
        this._status('Python stopped unexpectedly: ' + (e.message || 'error'), true);
        rejectReady(new Error(e.message || 'worker error'));
        for (const p of this.pending.values()) p.reject(new Error('Python stopped unexpectedly'));
        this.pending.clear();
        bus.emit('kernel:state', { lang: this.evLang, state: 'failed', message: e.message || '' });
      };
      this.worker.postMessage(
        Object.assign(
          {
            type: 'init',
            indexURL: this.opts.indexURL,
            preload: this.opts.preload,
            background: this.opts.background,
            files: this.opts.files,
            modules: this.opts.modules || [],
            home: HOME(),
            user: MG.user.login()
          },
          // (what a worker that does more than the notebook's needs to know as well)
          typeof this.opts.init === 'function' ? this.opts.init() : this.opts.init || {}
        )
      );
    }
    _status(text, bad) {
      this.statusText = text;
      bus.emit('kernel:status', { lang: this.evLang, text, bad: !!bad });
    }
    ready() {
      return this.ensure();
    }
    _send(msg, handlers) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, Object.assign({ resolve, reject }, handlers || {}));
        this.worker.postMessage(Object.assign({ id }, msg));
      });
    }
    /** run a cell. handlers: {onOutput(o), onStatus(text)}; cwd: the notebook's folder → {ok, secs} */
    async run(code, handlers, cwd) {
      await this.ensure();
      await this.files.push(this);
      return this._send({ type: 'run', code, cwd: cwd || HOME(), user: MG.user.login() }, handlers);
    }
    async vars() {
      if (this.state !== 'ready') return [];
      return this._send({ type: 'vars' });
    }
    /** the files Python wrote → the page (before a shell command looks at them) */
    async sync() {
      if (this.state !== 'ready') return;
      await this._send({ type: 'scan' });
    }
    async _nbShell(m) {
      const p = this.pending.get(m.id);
      this.files.apply(m.changes);
      const r = await runShell(m.cmd, { cwd: m.cwd, capture: m.capture, onOutput: p && p.onOutput });
      const { changes, transfer } = await this.files.collect();
      this.worker.postMessage({ type: 'smk-shell-result', sid: m.sid, code: r.code, out: r.out, changes }, transfer);
    }
    restart() {
      if (this.state === 'off') return;
      try {
        this.worker.terminate();
      } catch (e) {
        /* already gone */
      }
      for (const p of this.pending.values()) p.reject(new Error('Python was restarted'));
      this.pending.clear();
      if (this._rejectReady) this._rejectReady(new Error('Python was restarted'));
      this.start();
      bus.emit('kernel:state', { lang: this.evLang, state: 'restarted' });
    }
    describe() {
      const v = this.versions || {};
      return `Python ${v.python || ''} (Pyodide ${v.pyodide || ''}) in your browser`;
    }
  }

  /* ------------------------------------------------------------------
     R (webR)
     ------------------------------------------------------------------ */
  /* The R side: runs a cell expression by expression (stopping at the first error, as Jupyter does),
     shows data frames as tables, reports errors with a traceback and a hint, and lists files for the sync.
     Rich output reaches the page as marked lines on stdout: \x01WB:kind\x01payload (newlines as \x02, fields
     separated by \x03). */
  const R_SETUP = String.raw`
local({
  wb <- new.env()
  wb$lastcwd <- ""
  wb$args <- NULL
  wb$in_script <- FALSE
  wb$calls <- NULL
  wb$mark <- function(kind, fields) {
    s <- paste(gsub("\n", "\002", as.character(fields), fixed = TRUE), collapse = "\003")
    cat("\001WB:", kind, "\001", s, "\n", sep = "")
  }
  wb$esc <- function(s) {
    s <- gsub("&", "&amp;", s, fixed = TRUE)
    s <- gsub("<", "&lt;", s, fixed = TRUE)
    gsub(">", "&gt;", s, fixed = TRUE)
  }
  wb$abbr <- function(col) {
    cl <- class(col)[1]
    switch(cl, integer = "int", numeric = "dbl", character = "chr", factor = "fct", ordered = "ord",
           logical = "lgl", Date = "date", POSIXct = "dttm", list = "list", complex = "cpl", cl)
  }
  wb$df_html <- function(x, n = 25L) {
    nr <- nrow(x); nc <- ncol(x)
    shown <- as.data.frame(utils::head(x, n))
    cells <- lapply(shown, function(col) {
      v <- if (is.list(col)) vapply(col, function(e) paste(format(e), collapse = ", "), "")
           else format(col, digits = 7, trim = TRUE, justify = "none")
      wb$esc(as.character(v))
    })
    hdr <- paste0("<th>", wb$esc(names(x)), "<br><small>&lt;", vapply(x, wb$abbr, ""), "&gt;</small></th>", collapse = "")
    rows <- ""
    if (nrow(shown)) {
      body <- if (length(cells)) do.call(paste0, lapply(cells, function(v) paste0("<td>", v, "</td>"))) else ""
      rows <- paste0("<tr><th>", wb$esc(rownames(shown)), "</th>", body, "</tr>", collapse = "")
    }
    info <- if (nr > n) sprintf("first %d of %s rows · %d columns", n, format(nr, big.mark = ","), nc)
            else sprintf("%s rows · %d columns", format(nr, big.mark = ","), nc)
    paste0("<table class=\"dataframe\"><thead><tr><th></th>", hdr, "</tr></thead><tbody>", rows,
           "</tbody></table><p class=\"nb-dfinfo\">", info, "</p>")
  }
  wb$show <- function(x) {
    if (is.data.frame(x)) {
      h <- tryCatch(wb$df_html(x), error = function(e) NULL)
      if (!is.null(h)) return(invisible(wb$mark("html", h)))
    }
    if (isS4(x)) methods::show(x) else print(x)
    invisible()
  }
  wb$fmt_call <- function(cl) {
    if (is.null(cl)) return("")
    d <- deparse(cl, nlines = 1L, width.cutoff = 60L)
    if (length(d) > 1 || nchar(d[1]) > 70) paste0(substr(d[1], 1, 70), " …") else d[1]
  }
  wb$pkg_of <- c(ggplot = "ggplot2", aes = "ggplot2", geom_point = "ggplot2", geom_line = "ggplot2", geom_bar = "ggplot2",
    geom_col = "ggplot2", geom_histogram = "ggplot2", geom_boxplot = "ggplot2", ggsave = "ggplot2", theme_bw = "ggplot2",
    labs = "ggplot2", facet_wrap = "ggplot2", read_csv = "readr", read_tsv = "readr", write_csv = "readr",
    mutate = "dplyr", filter = "dplyr", select = "dplyr", arrange = "dplyr", summarise = "dplyr", summarize = "dplyr",
    group_by = "dplyr", left_join = "dplyr", inner_join = "dplyr", count = "dplyr", tibble = "tibble",
    pivot_longer = "tidyr", pivot_wider = "tidyr", str_detect = "stringr", str_replace = "stringr", str_sub = "stringr",
    DNAString = "Biostrings", readDNAStringSet = "Biostrings", AAString = "Biostrings", DNAStringSet = "Biostrings",
    readAAStringSet = "Biostrings", pairwiseAlignment = "pwalign", fromJSON = "jsonlite", toJSON = "jsonlite",
    GET = "httr", content = "httr", pheatmap = "pheatmap", melt = "reshape2", kable = "knitr", fread = "data.table",
    read_excel = "readxl", glue = "glue", as_tibble = "tibble", plot_ly = "plotly", ggtree = "ggtree", read.tree = "ape",
    read.dna = "ape", dist.dna = "ape", nj = "ape", GRanges = "GenomicRanges", IRanges = "IRanges")
  wb$hint <- function(msg, code = "") {
    m <- regmatches(msg, regexec("could not find function \"([^\"]+)\"", msg))[[1]]
    if (length(m) == 2) {
      f <- m[2]
      if (f == "%>%") return("%>% comes from dplyr (or magrittr): run  library(dplyr)  first – or use R's own pipe |>.")
      if (!is.na(wb$pkg_of[f])) return(sprintf("%s comes from the %s package: run  library(%s)  first (the first time, this downloads it into the browser).", f, wb$pkg_of[f], wb$pkg_of[f]))
      fns <- ls(globalenv())
      same <- fns[tolower(fns) == tolower(f) & fns != f]
      if (length(same)) return(sprintf("Names are case-sensitive: %s is not %s.", f, same[1]))
      return(sprintf("There is no function called %s. Check the spelling (R is case-sensitive) – or load the package it comes from with library().", f))
    }
    m <- regmatches(msg, regexec("object '([^']+)' not found", msg))[[1]]
    if (length(m) == 2) {
      o <- m[2]
      cand <- ls(globalenv())
      same <- cand[tolower(cand) == tolower(o) & cand != o]
      if (length(same)) return(sprintf("Names are case-sensitive: %s is not the same as %s.", o, same[1]))
      close <- if (length(cand)) cand[utils::adist(o, cand)[1, ] <= max(1, nchar(o) %/% 4)] else character(0)
      if (length(close)) return(sprintf("Did you mean %s?", paste(utils::head(close, 3), collapse = ", ")))
      if (grepl("^[ACGTUacgtu]{2,}$", o)) return(sprintf("If %s is a sequence, put it in quotes: \"%s\"", o, o))
      return(sprintf("%s has not been made yet: run the cell that creates it first (after Restart, R forgets everything). If it is meant to be text, put it in quotes; if it is a column, use df$%s or a package such as dplyr.", o, o))
    }
    if (grepl("there is no package called", msg)) return("That package could not be loaded: it is not in the webR repositories (repo.r-wasm.org for CRAN, bioc-release.r-universe.dev for Bioconductor), or it failed to download. Packages that need system libraries may not exist for the browser.")
    if (grepl("cannot open|No such file", msg)) return(sprintf("R is working in %s; relative paths start there. Your files are in %s (~), the examples in /data/examples.", getwd(), path.expand("~")))
    if (grepl("non-numeric argument to binary operator", msg)) return("One of the values is text, not a number. Convert it with as.numeric(), or look at the column types with str().")
    if (grepl("subscript out of bounds", msg)) return("R counts from 1 (not 0), and the position must exist: check with length(), nrow() or ncol().")
    if (grepl("missing value where TRUE/FALSE needed", msg)) return("An if() or while() got NA. Check for missing values with is.na().")
    if (grepl("argument is of length zero", msg)) return("An if() got an empty value – often a column name that does not exist (df$name gives NULL).")
    if (grepl("arguments imply differing number of rows", msg)) return("All the columns of a data frame must have the same length.")
    if (grepl("unused argument", msg)) return("The function does not take an argument with that name: check its help with ?name.")
    if (grepl("unexpected", msg)) {
      if (grepl("(^|\n)\\s*(import |from \\w+ import|def |print\\()", code)) return("This looks like Python. R code goes in an R notebook, Python code in a Python notebook (Notebook menu → New).")
      return("R could not read this code: check that every ( [ { has its ) ] }, that quotes come in pairs, and that commas separate the arguments. The mistake is often just before the place shown.")
    }
    ""
  }
  wb$report <- function(e, code) {
    cl <- conditionCall(e)
    msg <- conditionMessage(e)
    callTxt <- if (is.null(cl)) "" else wb$fmt_call(cl)
    if (startsWith(callTxt, "eval(") || startsWith(callTxt, "withVisible(")) callTxt <- ""
    head <- if (nzchar(callTxt)) paste0("Error in ", callTxt, ": ", msg) else paste0("Error: ", msg)
    tb <- ""
    calls <- wb$calls
    wb$calls <- NULL
    if (length(calls)) {
      txt <- vapply(calls, function(c) paste(deparse(c, nlines = 1L), collapse = ""), "")
      k <- max(c(0L, which(startsWith(txt, "eval(.wb_e") | startsWith(txt, "eval(e, "))))
      if (k > 0 && k < length(calls)) {
        user <- calls[(k + 1):length(calls)]
        fn <- vapply(user, function(c) paste(deparse(c[[1]], nlines = 1L), collapse = ""), "")
        user <- user[!fn %in% c(".handleSimpleError", "h", "stop", "signalCondition", "doWithOneRestart", "withOneRestart",
                                 "withRestarts", ".signalSimpleWarning", "simpleError", "warning", "stopifnot")]
        if (length(user) >= 2) tb <- paste0(seq_along(user), ". ", vapply(user, wb$fmt_call, ""), collapse = "\n")
      }
    }
    wb$mark("error", c("Error", msg, head, tb, wb$hint(msg, code)))
  }
  wb$run <- function(code, cwd = NULL) {
    if (!is.null(cwd) && !identical(cwd, wb$lastcwd)) {
      wb$lastcwd <- cwd
      if (dir.exists(cwd)) setwd(cwd)
    }
    # (where R is afterwards – setwd() moves it – for the %%bash cells of the notebook, which run in the page)
    on.exit(wb$mark("cwd", c(wb$lastcwd, getwd())), add = TRUE)
    exprs <- tryCatch(parse(text = code, keep.source = FALSE), error = function(e) e)
    if (inherits(exprs, "error")) {
      msg <- sub("^<text>:", "line ", conditionMessage(exprs))
      wb$mark("error", c("Error", msg, paste0("Error: ", msg), "", wb$hint(msg, code)))
      return(invisible(FALSE))
    }
    for (.wb_e in exprs) {
      ok <- TRUE
      tryCatch(
        withCallingHandlers({
          res <- withVisible(eval(.wb_e, envir = globalenv()))
          if (res$visible) wb$show(res$value)
        },
        error = function(e) wb$calls <- sys.calls(),
        warning = function(w) {
          cl <- conditionCall(w)
          cat("Warning", if (!is.null(cl)) paste0(" in ", wb$fmt_call(cl)), ": ", conditionMessage(w), "\n", sep = "", file = stderr())
          invokeRestart("muffleWarning")
        },
        message = function(m) {
          cat(conditionMessage(m), sep = "", file = stderr())
          invokeRestart("muffleMessage")
        }),
        error = function(e) {
          ok <<- FALSE
          wb$report(e, code)
        })
      if (!ok) return(invisible(FALSE))
    }
    invisible(TRUE)
  }
  wb$script <- function(file = NULL, code = NULL, args = character(0), cwd = NULL) {
    old <- getwd()
    on.exit(setwd(old), add = TRUE)
    if (!is.null(cwd) && dir.exists(cwd)) setwd(cwd)
    wb$args <- args
    wb$in_script <- TRUE
    on.exit({ wb$args <- NULL; wb$in_script <- FALSE }, add = TRUE)
    devs <- grDevices::dev.list()
    op <- options(device = function(...) grDevices::pdf(file = "Rplots.pdf"))
    on.exit(options(op), add = TRUE)
    if (!is.null(file)) {
      if (!file.exists(file)) {
        cat("Fatal error: cannot open file '", file, "': No such file or directory\n", sep = "", file = stderr())
        return(wb$mark("status", 2L))
      }
      code <- paste(readLines(file, warn = FALSE), collapse = "\n")
    }
    exprs <- tryCatch(parse(text = code, keep.source = FALSE), error = function(e) e)
    if (inherits(exprs, "error")) {
      cat("Error: ", conditionMessage(exprs), "\nExecution halted\n", sep = "", file = stderr())
      return(wb$mark("status", 1L))
    }
    env <- new.env(parent = globalenv())
    status <- 0L
    for (e in exprs) {
      r <- withCallingHandlers(
        tryCatch({
          v <- withVisible(eval(e, env))
          if (v$visible) { if (isS4(v$value)) methods::show(v$value) else print(v$value) }
          0L
        },
        wb_quit = function(q) as.integer(q$status),
        error = function(err) {
          cl <- conditionCall(err)
          cat("Error", if (!is.null(cl)) paste0(" in ", wb$fmt_call(cl)), ": ", conditionMessage(err), "\nExecution halted\n", sep = "", file = stderr())
          1L
        }),
        warning = function(w) {
          cat("Warning message:\n", conditionMessage(w), "\n", sep = "", file = stderr())
          invokeRestart("muffleWarning")
        },
        message = function(m) {
          cat(conditionMessage(m), sep = "", file = stderr())
          invokeRestart("muffleMessage")
        })
      if (!identical(r, 0L)) { status <- r; break }
    }
    for (d in setdiff(grDevices::dev.list(), devs)) grDevices::dev.off(d)
    wb$mark("status", status)
  }
  wb$scan <- function(roots) {
    out <- character(0)
    for (r in roots) {
      if (!dir.exists(r)) next
      f <- list.files(r, recursive = TRUE, all.files = TRUE, full.names = TRUE, include.dirs = TRUE, no.. = TRUE)
      f <- f[!grepl("/(\\.Rproj\\.user|\\.ipynb_checkpoints|__pycache__)(/|$)", f)]
      if (!length(f)) next
      i <- file.info(f, extra_cols = FALSE)
      out <- c(out, paste(f, ifelse(i$isdir, "d", "f"), i$size, format(as.numeric(i$mtime) * 1000, scientific = FALSE), sep = "\t"))
    }
    out
  }
  wb$vars <- function() {
    nm <- ls(globalenv())
    vapply(nm, function(n) {
      x <- get(n, envir = globalenv())
      if (is.function(x)) return("")
      cls <- class(x)[1]
      d <- if (is.data.frame(x)) sprintf("%d rows × %d columns", nrow(x), ncol(x))
           else if (is.matrix(x)) sprintf("%d × %d matrix", nrow(x), ncol(x))
           else if (is.atomic(x) && length(x) == 1) substr(paste(format(x), collapse = ""), 1, 60)
           else if (is.atomic(x) || is.list(x)) sprintf("%d values", length(x))
           else cls
      paste(n, cls, d, sep = "\t")
    }, "")
  }
  e <- new.env()
  e$wb <- wb
  e$install.packages <- function(pkgs, repos = NULL, ..., quiet = FALSE) {
    webr::install(as.character(pkgs), repos = getOption("webr_pkg_repos"), quiet = quiet)
  }
  e$View <- function(x, title) wb$show(x)
  e$quit <- e$q <- function(save = "default", status = 0, runLast = TRUE) {
    if (isTRUE(wb$in_script)) stop(structure(list(message = "quit", call = NULL, status = status), class = c("wb_quit", "error", "condition")))
    stop("quit() would stop R for the whole page. To start R afresh, use the notebook's Restart button.", call. = FALSE)
  }
  e$commandArgs <- function(trailingOnly = FALSE) {
    if (!is.null(wb$args)) { if (trailingOnly) wb$args else c("/usr/lib/R/bin/exec/R", "--no-echo", "--no-restore", "--args", wb$args) }
    else base::commandArgs(trailingOnly)
  }
  e$system <- e$system2 <- e$shell <- function(...) stop("R cannot run programs from inside the browser. Run the command in a %%bash cell (a cell whose first line is %%bash) or in the Terminal tab.", call. = FALSE)
  attach(e, name = "workbench", warn.conflicts = FALSE)
})
`;

  /* data frames, errors and the like arrive as marked lines */
  function parseRLine(line) {
    const m = /^\x01WB:(\w+)\x01(.*)$/.exec(line);
    if (!m) return null;
    return { kind: m[1], fields: m[2].split('\x03').map((f) => f.replace(/\x02/g, '\n')) };
  }
  /** a line of R's standard output → [what R printed, a mark of the workbench or null]. What was printed last without
      a new line – cat("done") – has the mark that follows it on the same line. */
  function splitRLine(line) {
    const at = line.indexOf('\x01WB:');
    if (at < 0) return [line, null];
    const mk = parseRLine(line.slice(at));
    return mk ? [line.slice(0, at), mk] : [line, null];
  }
  const rstr = (s) => JSON.stringify(String(s)).replace(/\\u([0-9a-f]{4})/gi, (x, h4) => '\\u' + h4); // a JSON string is a valid R string
  const rvec = (a) => 'c(' + a.map(rstr).join(', ') + ')';

  // the helpers are reached through these names (the attached environment "workbench")
  const R_NAMES = String.raw`
.wb_run <- function(code, cwd = NULL) get("wb", envir = as.environment("workbench"))$run(code, cwd)
.wb_script <- function(...) get("wb", envir = as.environment("workbench"))$script(...)
.wb_vars <- function() get("wb", envir = as.environment("workbench"))$vars()
.wb_scan <- function(roots) get("wb", envir = as.environment("workbench"))$scan(roots)
`;

  class RKernel {
    constructor(opts) {
      this.lang = 'r';
      this.label = 'R';
      this.opts = opts;
      this.state = 'off';
      this.versions = null;
      this.readyPromise = null;
      this.queue = Promise.resolve();
      this.sync = new RSync(this);
      this.gen = 0;
    }
    ensure() {
      if (this.state === 'off' || this.state === 'failed') this.start();
      return this.readyPromise;
    }
    ready() {
      return this.ensure();
    }
    _status(text, bad) {
      this.statusText = text;
      bus.emit('kernel:status', { lang: 'r', text, bad: !!bad });
    }
    start() {
      this.state = 'loading';
      const gen = ++this.gen;
      bus.emit('kernel:state', { lang: 'r', state: 'loading' });
      this._status('Downloading R (webR)…');
      this.sync.reset();
      this.readyPromise = (async () => {
        const base = abs(this.opts.baseUrl);
        let mod;
        try {
          mod = await import(base + 'webr.mjs');
        } catch (e) {
          throw new Error('Could not download R from ' + base + ' – check the internet connection.');
        }
        const webR = new mod.WebR({ channelType: mod.ChannelType.PostMessage, baseUrl: base, homedir: HOME() });
        this.webR = webR;
        await webR.init();
        if (gen !== this.gen) throw new Error('R was restarted');
        this._status('Setting up R…');
        this.shelter = await new webR.Shelter();
        const repos = (this.opts.repos || ['https://repo.r-wasm.org']).map((r) => r.replace(/\/$/, ''));
        // (the site's own packages – locfit – are looked in first; CRAN stays the webR repository)
        const local = this.opts.localRepo ? [abs(this.opts.localRepo).replace(/\/$/, '')] : [];
        await webR.evalRVoid(
          `webr::shim_install()\noptions(webr_pkg_repos = ${rvec([...local, ...repos])}, repos = c(CRAN = ${rstr(repos[0])}), warn = 1, width = 100, digits = 7, ` +
            `device = function(...) grDevices::pdf(file = "Rplots.pdf"), timeout = 300, help_type = "text", ` +
            // (help pages – ?mean – are shown as text under the cell: the browser has no pager program)
            `pager = function(files, header, title, delete.file) { for (f in files) cat(gsub("_\\b", "", readLines(f, warn = FALSE), useBytes = TRUE), sep = "\\n"); if (isTRUE(delete.file)) unlink(files); invisible(NULL) })\n` +
            `Sys.setenv(USER = ${rstr(MG.user.login())}, LOGNAME = ${rstr(MG.user.login())}, HOME = ${rstr(HOME())})\nsetwd(${rstr(HOME())})\n` +
            // (the home folder was /home/student before: a path written with that name still leads home)
            `if (${rstr(HOME())} != "/home/student" && !file.exists("/home/student")) try(file.symlink(${rstr(HOME())}, "/home/student"), silent = TRUE)`
        );
        this._user = MG.user.login();
        await webR.evalRVoid(R_SETUP);
        await webR.evalRVoid(R_NAMES);
        // the examples, read-only
        for (const f of examples()) {
          try {
            const r = await fetch(f.url);
            if (!r.ok) continue;
            const bytes = new Uint8Array(await r.arrayBuffer());
            await this._mkdirs(f.path.slice(0, f.path.lastIndexOf('/')));
            await webR.FS.writeFile(f.path, bytes);
          } catch (e) {
            /* not there */
          }
        }
        // (read-only, the files and the folders: nothing can be changed or added there – "Permission denied")
        if (examples().length) {
          try {
            await webR.evalRVoid('local({ Sys.chmod(list.files("/data", recursive = TRUE, full.names = TRUE), "444"); Sys.chmod(list.dirs("/data"), "555") })');
          } catch (e) {}
        }
        const v = await webR.evalRRaw('c(paste(R.version$major, R.version$minor, sep = "."), as.character(packageVersion("webr")))', 'string[]');
        this.versions = { r: v[0], webr: v[1] };
        this.state = 'ready';
        this._status(null);
        bus.emit('kernel:state', { lang: 'r', state: 'ready', versions: this.versions });
        return this.versions;
      })();
      this.readyPromise.catch((e) => {
        if (gen !== this.gen) return;
        this.state = 'failed';
        this._status('R could not start: ' + e.message, true);
        bus.emit('kernel:state', { lang: 'r', state: 'failed', message: e.message });
      });
    }
    async _mkdirs(dir) {
      const parts = dir.split('/').filter(Boolean);
      let p = '';
      for (const s of parts) {
        p += '/' + s;
        try {
          await this.webR.FS.mkdir(p);
        } catch (e) {
          /* exists */
        }
      }
    }
    /** USER and LOGNAME of R: the name of the person (or "user" for the AI agent's commands) – it may have changed */
    async _userEnv() {
      const u = MG.user.login();
      if (this._user === u) return;
      try {
        await this.webR.evalRVoid(`Sys.setenv(USER = ${rstr(u)}, LOGNAME = ${rstr(u)})`);
        this._user = u;
      } catch (e) {
        /* (R keeps the name it had) */
      }
    }
    /** one thing at a time: R runs one evaluation after another */
    _queued(fn) {
      const job = this.queue.then(fn);
      this.queue = job.catch(() => {});
      return job;
    }
    /** run a cell → {ok, secs}; outputs go to handlers.onOutput as they are read */
    async run(code, handlers = {}, cwd) {
      await this.ensure();
      return this._queued(async () => {
        const t0 = performance.now();
        await this._userEnv();
        await this.sync.push();
        // BiocManager cannot download from Bioconductor's own servers here: its install() is done by webR instead
        let src = code;
        if (/BiocManager::install\s*\(/.test(src)) {
          src = src.replace(/BiocManager::install\s*\(/g, 'install.packages(');
          handlers.onOutput && handlers.onOutput({ type: 'stream', name: 'stderr', text: 'Note: BiocManager::install() is done by webR here (Bioconductor packages – the current release – come from bioc-release.r-universe.dev).\n' });
        }
        src = src.replace(/^\s*if\s*\(\s*!\s*(require|requireNamespace)\s*\(\s*["']BiocManager["'][^)]*\)\s*\)\s*install\.packages\(\s*["']BiocManager["']\s*\)\s*$/gm, '# (BiocManager is not needed here)');
        let ok = false;
        try {
          const g = this.opts.graphics || { width: 720, height: 450 };
          const res = await this.shelter.captureR(`.wb_run(${rstr(src)}, ${rstr(cwd || HOME())})`, {
            withAutoprint: false,
            captureStreams: true,
            captureConditions: false,
            captureGraphics: { width: g.width, height: g.height, bg: 'white', pointsize: 12 }
          });
          ok = this._outputs(res, handlers, (k, f) => {
            if (k === 'error') ok = false;
            if (k === 'cwd') this.where = { folder: f[0], cwd: f[1] };
          });
          for (const img of res.images || []) handlers.onOutput && handlers.onOutput({ type: 'display', mime: 'image/png', data: bitmapToPng(img), width: g.width });
        } catch (e) {
          handlers.onOutput && handlers.onOutput({ type: 'error', ename: 'Error', evalue: String((e && e.message) || e), traceback: String((e && e.message) || e), hints: [] });
          ok = false;
        } finally {
          try {
            await this.shelter.purge();
          } catch (e) {
            /* nothing to free */
          }
        }
        await this.sync.pull();
        return { ok, secs: (performance.now() - t0) / 1000 };
      });
    }
    /** the outputs of captureR → notebook outputs. → true unless an error was reported */
    _outputs(res, handlers, seen) {
      let ok = true;
      const emit = (o) => handlers.onOutput && handlers.onOutput(o);
      for (const o of res.output || []) {
        if (o.type !== 'stdout' && o.type !== 'stderr') continue;
        const [line, mk] = o.type === 'stdout' ? splitRLine(String(o.data)) : [String(o.data), null];
        if (mk) {
          if (line) emit({ type: 'stream', name: o.type, text: line });
          if (mk.kind === 'html') emit({ type: 'display', mime: 'text/html', data: mk.fields[0] });
          else if (mk.kind === 'error') {
            ok = false;
            const [ename, evalue, head, tb, hint] = mk.fields;
            emit({ type: 'error', ename, evalue, traceback: head + (tb ? '\nTraceback:\n' + tb : ''), hints: hint ? [hint] : [] });
          } else if (mk.kind === 'status') this._lastStatus = Number(mk.fields[0]);
          if (seen) seen(mk.kind, mk.fields);
          continue;
        }
        emit({ type: 'stream', name: o.type, text: line + '\n' });
      }
      return ok;
    }
    /** Rscript / R -e from the terminal: output to the terminal; plots go to Rplots.pdf → the exit status */
    async script(opts, io) {
      await this.ensure();
      return this._queued(async () => {
        await this._userEnv();
        await this.sync.push();
        this._lastStatus = 1;
        const call = `.wb_script(${opts.file ? 'file = ' + rstr(opts.file) : 'code = ' + rstr(opts.code)}, args = ${rvec(opts.args || [])}, cwd = ${rstr(opts.cwd || HOME())})`;
        try {
          const res = await this.shelter.captureR(call, { withAutoprint: false, captureStreams: true, captureConditions: false, captureGraphics: false });
          for (const o of res.output || []) {
            if (o.type !== 'stdout' && o.type !== 'stderr') continue;
            const [line, mk] = o.type === 'stdout' ? splitRLine(String(o.data)) : [String(o.data), null];
            if (mk) {
              // (what the script printed last, without a new line: cat("done") – as Rscript prints it)
              if (line) io.out(line);
              if (mk.kind === 'status') this._lastStatus = Number(mk.fields[0]);
              else if (mk.kind === 'html') io.out('[a table: shown as text in a notebook]\n');
              continue;
            }
            if (o.type === 'stdout') io.out(line + '\n');
            else io.err(line + '\n');
          }
        } catch (e) {
          io.err('Error: ' + ((e && e.message) || e) + '\n');
          this._lastStatus = 1;
        } finally {
          try {
            await this.shelter.purge();
          } catch (e) {
            /* nothing */
          }
        }
        await this.sync.pull(opts.fs);
        return this._lastStatus;
      });
    }
    async vars() {
      if (this.state !== 'ready') return [];
      return this._queued(async () => {
        const lines = await this.webR.evalRRaw('.wb_vars()', 'string[]');
        return lines.filter(Boolean).map((l) => {
          const [name, type, desc] = l.split('\t');
          return { name, type, desc };
        });
      });
    }
    async syncFiles() {
      if (this.state !== 'ready') return;
      return this._queued(() => this.sync.pull());
    }
    restart() {
      if (this.state === 'off') return;
      this.gen++;
      try {
        if (this.webR) this.webR.close();
      } catch (e) {
        /* already gone */
      }
      this.webR = null;
      this.shelter = null;
      this.queue = Promise.resolve();
      this.start();
      bus.emit('kernel:state', { lang: 'r', state: 'restarted' });
    }
    describe() {
      const v = this.versions || {};
      return `R ${v.r || ''} (webR ${v.webr || ''}) in your browser`;
    }
  }

  /** an ImageBitmap (an R plot) → PNG as base64 */
  function bitmapToPng(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    try {
      img.close();
    } catch (e) {
      /* fine */
    }
    return c.toDataURL('image/png').split(',')[1];
  }

  /* the home folder ↔ R's copy of it */
  class RSync {
    constructor(K) {
      this.K = K;
      this.reset();
    }
    reset() {
      this.sent = new Map(); // path → {e, m}: what R has of the page's files
      this.known = new Map(); // path → 'd' | 'size:mtime' as R last listed them
    }
    async _list() {
      const lines = await this.K.webR.evalRRaw(`.wb_scan(${rstr(HOME())})`, 'string[]');
      const m = new Map();
      for (const l of lines) {
        const [p, kind, size, mtime] = l.split('\t');
        m.set(p, kind === 'd' ? 'd' : size + ':' + mtime);
      }
      return m;
    }
    async push() {
      const F = MG.app.fs;
      const W = this.K.webR;
      const files = [], dirs = [], removed = [];
      for (const [p, e] of F.entries) {
        if (!under(p) || p === HOME()) continue;
        const s = this.sent.get(p);
        if (e.kind === 'dir') {
          if (!s || s.e !== 'dir') {
            dirs.push(p);
            this.sent.set(p, { e: 'dir' });
          }
          continue;
        }
        if (e.kind === 'virtual' || F.size(e) > MAX_SYNC) continue;
        if (s && s.e === e && s.m === e.mtime) continue;
        files.push(p);
      }
      for (const p of Array.from(this.sent.keys())) {
        if (!F.entries.has(p)) {
          removed.push(p);
          this.sent.delete(p);
        }
      }
      if (!files.length && !dirs.length && !removed.length) return;
      if (removed.length) await W.evalRVoid(`unlink(${rvec(removed)}, recursive = TRUE)`);
      dirs.sort((a, b) => a.length - b.length);
      for (const d of dirs) await this.K._mkdirs(d);
      const times = [];
      for (const p of files) {
        const e = F.entries.get(p);
        let bytes;
        try {
          bytes = await F.readBytes(p);
        } catch (err) {
          continue;
        }
        await this.K._mkdirs(p.slice(0, p.lastIndexOf('/')));
        await W.FS.writeFile(p, bytes);
        this.sent.set(p, { e, m: e.mtime });
        times.push([p, (e.mtime || Date.now()) / 1000]);
      }
      if (times.length) await W.evalRVoid(`invisible(Sys.setFileTime(${rvec(times.map((t) => t[0]))}, as.POSIXct(c(${times.map((t) => t[1]).join(', ')}), origin = "1970-01-01")))`);
      this.known = await this._list();
    }
    /** the files R wrote → the page (F0: the file system of the terminal command that ran Rscript) */
    async pull(F0) {
      const F = F0 || MG.app.fs;
      const W = this.K.webR;
      if (!W) return;
      let now;
      try {
        now = await this._list();
      } catch (e) {
        return;
      }
      const changed = [], made = [], gone = [];
      for (const [p, sig] of now) {
        if (this.known.get(p) === sig) continue;
        if (sig === 'd') made.push(p);
        else changed.push(p);
      }
      for (const p of this.known.keys()) if (!now.has(p)) gone.push(p);
      this.known = now;
      gone.sort((a, b) => b.length - a.length);
      for (const p of gone) {
        if (F.exists(p)) F.remove(p);
        for (const k of Array.from(this.sent.keys())) if (k === p || k.startsWith(p + '/')) this.sent.delete(k);
      }
      made.sort((a, b) => a.length - b.length);
      for (const d of made) {
        if (!F.isDir(d)) {
          if (F.exists(d)) F.remove(d);
          F.mkdirp(d);
        }
        this.sent.set(d, { e: 'dir' });
      }
      const files = [];
      for (const p of changed) {
        const size = Number(now.get(p).split(':')[0]);
        if (size > MAX_SYNC) continue;
        let bytes;
        try {
          bytes = await W.FS.readFile(p);
        } catch (e) {
          continue;
        }
        const mtime = Number(now.get(p).split(':')[1]) || Date.now();
        const text = MG.looksText(p, bytes);
        const entry = text != null ? { kind: 'text', text, mtime, fresh: true } : { kind: 'blob', blob: new Blob([bytes]), size: bytes.length, mtime, fresh: true };
        const old = F.get(p);
        if (old && old.mode) entry.mode = old.mode;
        if (old && old.readonly) continue;
        F.put(p, entry);
        const stored = F.get(p);
        this.sent.set(p, { e: stored, m: stored.mtime });
        files.push(p);
      }
      if (files.length || gone.length) bus.emit('r:files', { files, removed: gone });
    }
  }

  /* ------------------------------------------------------------------
     the registry
     ------------------------------------------------------------------ */
  const made = {};
  const kernels = {
    LANGS: {
      python: { label: 'Python', ext: '.py', cm: 'python', kernelspec: { name: 'python3', display_name: 'Python 3 (ipykernel)', language: 'python' }, language_info: { name: 'python', file_extension: '.py', mimetype: 'text/x-python' } },
      r: { label: 'R', ext: '.R', cm: 'r', kernelspec: { name: 'ir', display_name: 'R', language: 'R' }, language_info: { name: 'R', file_extension: '.r', mimetype: 'text/x-r-source' } }
    },
    /** the kernel of a language, made (not started) the first time */
    get(lang) {
      lang = lang === 'r' || lang === 'R' ? 'r' : 'python';
      if (!made[lang]) {
        if (lang === 'python')
          made[lang] = new PyKernel({
            workerUrl: 'assets/js/py-worker.js?v=' + (CFG.buildId || '1'),
            indexURL: abs(CFG.pyodideBase || 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'),
            preload: CFG.pythonPreload || ['numpy', 'pandas', 'matplotlib'],
            files: examples().map((f) => ({ path: f.path, url: f.url, mtime: f.mtime, readonly: true })),
            modules: [{ name: 'smk.py', url: abs('assets/py/smk.py') + '?v=' + (CFG.buildId || '1') }]
          });
        else made[lang] = new RKernel({ baseUrl: CFG.webrBase || 'https://webr.r-wasm.org/v0.6.0/', repos: CFG.rRepos, localRepo: CFG.rLocalRepo });
      }
      return made[lang];
    },
    /** the kernel if it was made, else null */
    peek(lang) {
      return made[lang === 'r' || lang === 'R' ? 'r' : 'python'] || null;
    },
    /** what the other languages wrote: into the page's files (before a shell command or the other language runs) */
    async syncAll() {
      const jobs = [];
      if (made.python && made.python.state === 'ready') jobs.push(made.python.sync().catch(() => {}));
      if (made.r && made.r.state === 'ready') jobs.push(made.r.syncFiles().catch(() => {}));
      await Promise.all(jobs);
    },
    runShell,
    bitmapToPng
  };
  MG.kernels = kernels;
  MG.PyKernel = PyKernel;
  MG.RKernel = RKernel;
})();
