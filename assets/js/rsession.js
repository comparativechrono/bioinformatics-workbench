/* =====================================================================
   R sessions for RStudio in the IDE tab. Each one is a separate R –
   webR, R compiled to WebAssembly, in a worker of its own – just as each
   R process is on a computer: RStudio's console and every knit of a
   document. (The notebooks' R and the terminal's Rscript are another R
   again: kernels.js.) What one session has in memory the others don't
   have; they share the files (the home folder) and the packages that
   were installed in RStudio (the user library). The example data in
   /data/examples are there too, read-only, read when they are used.

   MG.R.Session(opts)        one R
     opts.kind              'console' | 'rstudio' | 'notebook' | 'rterm' (R in the terminal) | 'rscript' | 'rcmd' | 'batch' | 'knit'
     opts.repl              true: R's own read–eval–print loop (the console of R: what R prints, its prompts,
                            warnings, errors, readline(), browser() – all as R does them); false: code is
                            run with evalR (the notebook, knitting)
     opts.banner            R's start-up message (the console, RStudio, R in the terminal)
     opts.graphics          'canvas' (plots are pictures in the page), 'pdf' (Rplots.pdf, as Rscript),
                            'capture' (the notebook: pictures after each cell)
     opts.cwd               R's working folder at the start
     opts.interactive       what interactive() says (Rscript: FALSE)
   session.on(event, fn)   'state' 'output' 'echo' 'prompt' 'idle' 'plot' 'view' 'help' 'pager' 'browse'
                           'files' 'quit' 'installed' 'event' (other messages of the workbench's R code)
   session.start()         → a promise: R is ready
   session.send(line)      a line of input (queued until R asks for one)
   session.interrupt()     Esc / Ctrl+C (only where the page is cross-origin isolated)
   session.close()

   The output of R is passed on as it is written – also a line that does not end yet (cat("abc")) – and
   in the order in which it was written (a hook in R's worker: see WORKER_HOOK). Before every command
   that R reads at its top-level prompt the files of the home folder that changed are copied into this
   R; after it the files that R wrote are copied back (RSync).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { bus, store } = MG;
  const CFG = MG.config || {};
  const abs = (u) => new URL(u, location.href).href;
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const MAX_SYNC = 300 * 1024 * 1024; // larger files are not copied into R
  const under = (p) => p === HOME() || p.startsWith(HOME() + '/');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** an R object as webR hands it over ({type, names, values}, lists of them) → plain JavaScript: a named list is an
      object, a vector an array */
  function rval(x) {
    if (x == null || typeof x !== 'object' || Array.isArray(x)) return x;
    if (typeof x.type === 'string' && Array.isArray(x.values)) {
      if (x.type === 'list') {
        const vals = x.values.map(rval);
        return Array.isArray(x.names) && x.names.length ? Object.fromEntries(x.names.map((n, i) => [n, vals[i]])) : vals;
      }
      return x.values;
    }
    return x;
  }
  /** a JavaScript string as an R string */
  const rstr = (s) => JSON.stringify(String(s)).replace(/\\u([0-9a-f]{4})/gi, (x, h4) => '\\u' + h4);
  const rvec = (a) => (a.length ? 'c(' + a.map(rstr).join(', ') + ')' : 'character(0)');
  /** the workbench's helpers in R (a user's own variable called wb does not hide them) */
  const WB = 'get("wb", envir = as.environment("tools:workbench"))';

  /* ------------------------------------------------------------------
     the packages installed in this browser: the user library
     ------------------------------------------------------------------ */
  /* Installed packages are shared by every R of the page, and kept from one visit to the next – as packages
     installed on a computer are. Each R has its own copy of the files of a package: a package that another R
     installed is fetched the first time this R loads it (library(), require(), pkg::fun – see the R code
     below), from the browser's cache once it has been downloaded. */
  const userlib = {
    list() {
      const v = store.get('rlib', []);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9.]*$/.test(x)) : [];
    },
    add(pkgs) {
      const have = new Set(userlib.list());
      let n = 0;
      for (const p of [].concat(pkgs || [])) if (p && !have.has(p)) (have.add(p), n++);
      if (n) {
        store.set('rlib', Array.from(have).sort());
        stale();
        bus.emit('r:userlib', { list: userlib.list() });
      }
    },
    remove(pkgs) {
      const out = new Set([].concat(pkgs || []));
      store.set('rlib', userlib.list().filter((p) => !out.has(p)));
      stale();
      bus.emit('r:userlib', { list: userlib.list() });
    }
  };
  /* (the other Rs of the page learn of the change before their next command: a package that RStudio installed can be
     loaded in the R console straight away, as on a computer) */
  function stale() {
    for (const S of sessions) S.libStale = true;
  }

  /* ------------------------------------------------------------------
     in R's worker: R's output as it is written
     ------------------------------------------------------------------ */
  /* webR passes on what R prints a line at a time, and keeps back a line that has not ended: cat("abc") was
     shown only with the next output, after the prompt. Here what R writes to its standard output and error
     (file descriptors 1 and 2) is collected and passed on in one message ('wbout', the pieces in order) when a
     line ends (at most every 20 ms), when there is a lot of it, when R checks for events during a long
     computation (after 40 ms), and before any other message – the prompt, a plot – so that nothing overtakes
     what was printed before it. */
  const WORKER_HOOK = String.raw`(() => {
  const M = globalThis.Module, W = M.webr, chan = W.channel;
  if (W.__wbHooked) return 'already';
  W.__wbHooked = true;
  const pend = [];
  let bytes = 0, since = 0, last = 0;
  const now = () => performance.now();
  const write = chan.write.bind(chan);
  const flush = () => {
    if (!pend.length) return;
    const out = [];
    for (const c of pend) {
      const l = out[out.length - 1];
      if (l && l.fd === c.fd) l.text += c.text;
      else out.push({ fd: c.fd, text: c.text });
    }
    pend.length = 0;
    bytes = 0;
    last = now();
    write({ type: 'wbout', data: out });
  };
  chan.write = (msg, transfer) => { flush(); return write(msg, transfer); };
  for (const fd of [1, 2]) {
    const s = M.FS.getStream(fd);
    if (!s) continue;
    const dec = new TextDecoder('utf-8');
    const ops = Object.assign({}, s.stream_ops);
    ops.write = (stream, buffer, offset, length) => {
      const text = dec.decode(buffer.slice(offset, offset + length), { stream: true });
      if (text) {
        if (!pend.length) since = now();
        pend.push({ fd, text });
        bytes += text.length;
        if (bytes > 32768 || (text.indexOf('\n') >= 0 && now() - last > 20)) flush();
      }
      return length;
    };
    s.stream_ops = ops;
  }
  const events = W.handleEvents;
  W.handleEvents = () => { if (pend.length && now() - since > 40) flush(); return events(); };
  W.wbFlush = flush;
  return 'hooked';
})()`;

  /* ------------------------------------------------------------------
     the workbench's R code, in every R: an attached environment, as RStudio's tools:rstudio
     ------------------------------------------------------------------ */
  const R_SETUP = String.raw`
local({
  wb <- new.env()
  wb$kind <- .wb_kind
  wb$can_block <- .wb_can_block
  wb$userlib <- .wb_userlib
  wb$interactive <- .wb_interactive
  wb$args <- .wb_args
  wb$home <- .wb_home
  rm(".wb_kind", ".wb_can_block", ".wb_userlib", ".wb_interactive", ".wb_args", ".wb_home", envir = globalenv())

  ## ---- messages to the page --------------------------------------------------------------
  wb$jstr <- function(s) {
    s <- enc2utf8(as.character(s))
    s <- gsub("\\", "\\\\", s, fixed = TRUE)
    s <- gsub("\"", "\\\"", s, fixed = TRUE)
    s <- gsub("\n", "\\n", s, fixed = TRUE)
    s <- gsub("\r", "\\r", s, fixed = TRUE)
    s <- gsub("\t", "\\t", s, fixed = TRUE)
    odd <- grepl("[\001-\037]| | ", s, perl = TRUE)
    if (any(odd, na.rm = TRUE)) s[which(odd)] <- vapply(s[which(odd)], function(one) {
      cs <- utf8ToInt(one)
      paste(vapply(cs, function(c) if (c < 32L || c == 8232L || c == 8233L) sprintf("\\u%04x", c) else intToUtf8(c), ""), collapse = "")
    }, "")
    paste0("\"", s, "\"")
  }
  wb$json <- function(x) {
    if (is.null(x)) return("null")
    if (is.list(x)) {
      nm <- names(x)
      if (!is.null(nm) && length(x) && all(nzchar(nm)))
        return(paste0("{", paste0(wb$jstr(nm), ":", vapply(x, wb$json, ""), collapse = ","), "}"))
      return(paste0("[", paste0(vapply(x, wb$json, ""), collapse = ","), "]"))
    }
    if (is.factor(x)) x <- as.character(x)
    v <- if (is.character(x)) ifelse(is.na(x), "null", wb$jstr(x))
         else if (is.logical(x)) ifelse(is.na(x), "null", ifelse(x, "true", "false"))
         else if (is.numeric(x)) ifelse(is.finite(x), as.character(x), "null")
         else wb$jstr(format(x))
    if (length(v) == 1L && is.null(attr(x, "wb_array"))) v else paste0("[", paste(v, collapse = ","), "]")
  }
  wb$arr <- function(x) structure(x, wb_array = TRUE)
  wb$send <- function(event, ...) {
    data <- list(...)
    data$event <- event
    webr::eval_js(paste0("Module.webr.channel.write({type:'wb',data:", wb$json(data), "})"))
    invisible(NULL)
  }

  ## ---- the user library: packages installed by any R of the page ------------------------
  wb$installing <- character(0)
  wb$ensure <- function(pkg) {
    pkg <- as.character(pkg)[1L]
    if (is.na(pkg) || !nzchar(pkg) || pkg %in% wb$installing || pkg %in% loadedNamespaces()) return(invisible(FALSE))
    if (!(pkg %in% wb$userlib) || length(find.package(pkg, quiet = TRUE))) return(invisible(FALSE))
    wb$installing <- c(wb$installing, pkg)
    on.exit(wb$installing <- setdiff(wb$installing, pkg), add = TRUE)
    try(suppressWarnings(webr::install(pkg, repos = getOption("webr_pkg_repos"), quiet = TRUE)), silent = TRUE)
    invisible(TRUE)
  }
  # (pkg::fun and the packages that a package needs are loaded by loadNamespace: it fetches a package of the user
  # library first, where this R does not have it yet)
  local({
    orig <- base::loadNamespace
    hook <- function(package, ...) {
      cl <- sys.call()
      # (pkg::fun – a primitive in R 4.6 – asks for the package by a name, not a string)
      p <- if (is.name(package)) as.character(package) else package
      if (is.character(p) && length(p) == 1L) tryCatch(wb$ensure(p), error = function(e) NULL)
      # (an error names the call as R's own loadNamespace does: "Error in loadNamespace(x) : there is no package …")
      tryCatch(orig(package, ...), error = function(e) {
        e$call <- cl
        stop(e)
      })
    }
    for (env in list(.BaseNamespaceEnv, baseenv())) {
      unlockBinding("loadNamespace", env)
      assign("loadNamespace", hook, envir = env)
      lockBinding("loadNamespace", env)
    }
  })

  e <- new.env()
  e$wb <- wb
  # (library(x) and require(x) as R's own: the call is evaluated as it was written, with R's function – an error
  # says "Error in library(x)" as in R)
  e$library <- function(package, help, pos = 2, lib.loc = NULL, character.only = FALSE, ...) {
    if (!missing(package)) {
      pkg <- tryCatch(if (isTRUE(character.only)) package else as.character(substitute(package)), error = function(e) NULL)
      if (is.character(pkg) && length(pkg) == 1L) wb$ensure(pkg)
    }
    cl <- sys.call()
    cl[[1L]] <- as.name("library")
    eval(cl, list(library = base::library), parent.frame())
  }
  e$require <- function(package, lib.loc = NULL, quietly = FALSE, warn.conflicts, character.only = FALSE) {
    if (!missing(package)) {
      pkg <- tryCatch(if (isTRUE(character.only)) package else as.character(substitute(package)), error = function(e) NULL)
      if (is.character(pkg) && length(pkg) == 1L) wb$ensure(pkg)
    }
    cl <- sys.call()
    cl[[1L]] <- as.name("require")
    eval(cl, list(require = base::require), parent.frame())
  }
  e$requireNamespace <- function(package, ..., quietly = TRUE) {
    wb$ensure(package)
    base::requireNamespace(package, ..., quietly = quietly)
  }
  e$install.packages <- function(pkgs, lib, repos = getOption("repos"), dependencies = NA, ..., quiet = FALSE) {
    pkgs <- unique(as.character(pkgs))
    if (!length(pkgs)) stop("no packages were specified")
    if (any(grepl("[/\\\\]|\\.(tar\\.gz|tgz|zip)$", pkgs))) stop("packages cannot be installed from a file here. They come ready-built from the webR repository, so install them by name with install.packages(\"NAME\").", call. = FALSE)
    lib <- .libPaths()[1L]
    if (!quiet) {
      if (length(pkgs) == 1L) message(sprintf("Installing package into %s\n(as %s is unspecified)", sQuote(lib), sQuote("lib")))
      else message(sprintf("Installing packages into %s\n(as %s is unspecified)", sQuote(lib), sQuote("lib")))
    }
    info <- tryCatch(utils::available.packages(contriburl = sprintf("%s/bin/emscripten/contrib/%s", sub("/$", "", getOption("webr_pkg_repos")), sub("\\.[^.]+$", "", as.character(getRversion())))), error = function(e) NULL)
    if (!is.null(info)) {
      gone <- setdiff(pkgs, rownames(info))
      for (p in gone) warning(sprintf("package %s is not available for this version of R (there is no build of it for webR)", sQuote(p)), call. = FALSE)
      pkgs <- setdiff(pkgs, gone)
    }
    if (!length(pkgs)) return(invisible(NULL))
    # (packages that this R has already are installed again: as R does, the newest copy replaces them)
    t0 <- proc.time()[["elapsed"]]
    webr::install(pkgs, repos = getOption("webr_pkg_repos"), info = info, quiet = quiet)
    ok <- pkgs[vapply(pkgs, function(p) length(find.package(p, quiet = TRUE)) > 0L, TRUE)]
    if (length(ok)) {
      wb$userlib <- union(wb$userlib, ok)
      wb$send("installed", pkgs = wb$arr(ok), secs = round(proc.time()[["elapsed"]] - t0, 1))
    }
    invisible(NULL)
  }
  e$remove.packages <- function(pkgs, lib) {
    pkgs <- as.character(pkgs)
    wb$userlib <- setdiff(wb$userlib, pkgs)
    wb$send("removed", pkgs = wb$arr(pkgs))
    message(sprintf("Removing package%s from %s\n(as %s is unspecified)", if (length(pkgs) > 1L) "s" else "", sQuote(.libPaths()[1L]), sQuote("lib")))
    invisible(NULL)
  }
  e$update.packages <- function(...) {
    message("All packages are up to date. They are installed from the webR repository, which keeps the current versions.")
    invisible(NULL)
  }

  ## ---- quitting --------------------------------------------------------------------------
  e$quit <- e$q <- function(save = "default", status = 0, runLast = TRUE) {
    save <- match.arg(save, c("default", "yes", "no", "ask"))
    if (save %in% c("default", "ask")) {
      if (isTRUE(wb$interactive) && isTRUE(wb$can_block)) {
        repeat {
          a <- tolower(substr(trimws(readline(if (identical(wb$kind, "rstudio")) "Save workspace image to ~/.RData? [y/n/c]: " else "Save workspace image? [y/n/c]: ")), 1L, 1L))
          if (a %in% c("y", "n", "c")) break
        }
        if (a == "c") return(invisible(NULL))
        save <- if (a == "y") "yes" else "no"
      } else save <- if (identical(wb$kind, "batch")) "yes" else "no"
    }
    if (save == "yes") save.image()
    if (isTRUE(runLast) && exists(".Last", envir = globalenv(), mode = "function", inherits = FALSE)) try(get(".Last", envir = globalenv())())
    wb$send("quit", status = as.integer(status), saved = identical(save, "yes"))
    invisible(NULL)
  }

  ## ---- what the page shows: plots, help, data, files -------------------------------------
  wb$fig <- c(width = 640, height = 480)
  wb$canvas <- function(width = NULL, height = NULL, pointsize = 12, bg = "white", ...) {
    w <- if (is.null(width)) wb$fig[["width"]] else width
    h <- if (is.null(height)) wb$fig[["height"]] else height
    webr::canvas(width = w, height = h, pointsize = pointsize, bg = bg)
  }
  wb$help_html <- function(file, topic) {
    rd <- utils:::.getHelpFile(file)
    pkg <- basename(dirname(dirname(file)))
    out <- tempfile(fileext = ".html")
    tools::Rd2HTML(rd, out = out, package = pkg, dynamic = FALSE, stylesheet = "", Links = NULL)
    title <- tryCatch(tools:::.Rd_get_title(rd), error = function(e) topic)
    wb$send("help", file = out, topic = topic, package = pkg, title = title)
  }
  # (a link in a help page, or a topic chosen in a list: the page asks for it)
  wb$help_topic <- function(topic, package = "") {
    args <- list(topic, help_type = "html")
    if (nzchar(package)) args$package <- package
    files <- as.character(tryCatch(do.call(utils::help, args), error = function(e) character(0)))
    if (!length(files) && nzchar(package)) files <- as.character(tryCatch(do.call(utils::help, list(topic, help_type = "html")), error = function(e) character(0)))
    if (!length(files)) return(wb$send("help", file = "", topic = topic, package = package, title = "", missing = TRUE))
    if (length(files) > 1L) wb$send("helpchoice", topic = topic, files = wb$arr(files), packages = wb$arr(basename(dirname(dirname(files)))))
    else wb$help_html(files[1L], topic)
  }
  registerS3method("print", "help_files_with_topic", function(x, ...) {
    files <- as.character(x)
    topic <- attr(x, "topic")
    w <- wb
    if (!length(files)) {
      msg <- sprintf("No documentation for %s in specified packages and libraries:\nyou could try %s", sQuote(topic), sQuote(paste0("??", topic)))
      writeLines(strwrap(msg, exdent = 0), con = stderr())
      return(invisible(x))
    }
    if (identical(attr(x, "type"), "text") || !(w$kind %in% c("console", "rstudio"))) {
      # (as R prints help in a terminal: the text, with its underlining taken out)
      for (f in files) {
        tf <- tempfile()
        tools::Rd2txt(utils:::.getHelpFile(f), out = tf, package = basename(dirname(dirname(f))), options = list(underline_titles = FALSE))
        file.show(tf, title = paste0("R Help on ", sQuote(topic)), delete.file = TRUE)
      }
      return(invisible(x))
    }
    if (length(files) > 1L) {
      pk <- basename(dirname(dirname(files)))
      w$send("helpchoice", topic = topic, files = w$arr(files), packages = w$arr(pk))
    } else w$help_html(files[1L], topic)
    invisible(x)
  }, envir = asNamespace("base"))
  options(pager = function(files, header, title, delete.file) {
    w <- wb
    text <- unlist(lapply(files, function(f) readLines(f, warn = FALSE)))
    text <- gsub("_\b", "", text, useBytes = TRUE)
    if (isTRUE(delete.file)) unlink(files)
    if (w$kind %in% c("console", "rstudio")) {
      tf <- tempfile(fileext = ".txt")
      writeLines(text, tf, useBytes = TRUE)
      w$send("pager", file = tf, title = if (length(title) && nzchar(title[1])) title[1] else basename(files[1]))
    } else writeLines(text)
    invisible(NULL)
  })
  e$View <- function(x, title) {
    if (missing(title)) title <- paste(deparse(substitute(x), width.cutoff = 500L), collapse = " ")
    if (!(wb$kind %in% c("console", "rstudio"))) {
      if (identical(wb$kind, "notebook")) return(invisible(print(x)))
      stop("View() needs a window to show the data in, and there is none while a document is being knitted. Look at the data with head(x) or str(x) instead, or use View() in RStudio's console.", call. = FALSE)
    }
    wb$view(x, title)
  }
  wb$view <- function(x, title) {
    if (is.function(x) || is.environment(x) || (is.list(x) && !is.data.frame(x))) {
      tf <- tempfile(fileext = ".txt")
      txt <- if (is.function(x)) deparse(x) else utils::capture.output(utils::str(x, max.level = 3L, list.len = 50L))
      writeLines(txt, tf)
      return(invisible(wb$send("pager", file = tf, title = title, view = TRUE)))
    }
    df <- if (is.data.frame(x)) x else if (is.matrix(x) || is.table(x)) as.data.frame.matrix(as.matrix(x)) else data.frame(x = x)
    if (!is.data.frame(x) && !is.matrix(x) && !is.table(x)) names(df) <- "x"
    n <- nrow(df)
    keep <- min(n, 100000L)
    d <- df[seq_len(keep), , drop = FALSE]
    types <- vapply(d, function(v) class(v)[1L], "")
    cols <- lapply(d, function(v) {
      if (is.factor(v)) as.character(v)
      else if (is.numeric(v) && !is.object(v)) as.double(v)
      else if (is.logical(v)) v
      else if (is.list(v)) vapply(v, function(z) paste(format(z), collapse = ", "), "")
      else as.character(format(v))
    })
    names(cols) <- make.unique(c(".wb_rownames", names(d)))[-1L]
    rn <- attr(df, "row.names")
    meta <- list(title = title, nrow = n, ncol = ncol(df), shown = keep, types = types, names = names(d))
    if (!is.integer(rn) || !identical(rn, seq_len(n))) meta$rownames <- as.character(row.names(d))
    labels <- vapply(d, function(v) { l <- attr(v, "label", exact = TRUE); if (is.character(l) && length(l) == 1L) l else "" }, "")
    if (any(nzchar(labels))) meta$labels <- labels
    cols$.wb_meta <- meta
    invisible(.External2(utils:::C_dataviewer, cols, title))
  }
  e$browseURL <- function(url, browser = getOption("browser"), encodeIfNeeded = FALSE) {
    url <- as.character(url)[1L]
    if (file.exists(url)) url <- normalizePath(url)
    else if (startsWith(url, "file://")) url <- sub("^file://", "", url)
    wb$send("browse", url = url)
    invisible(NULL)
  }
  e$file.edit <- e$edit.file <- function(..., title = file, editor = getOption("editor"), fileEncoding = "") {
    file <- c(...)
    for (f in file) {
      if (!file.exists(f)) file.create(f)
      wb$send("edit", file = normalizePath(f))
    }
    invisible(NULL)
  }
  e$system <- e$system2 <- e$shell <- function(...) stop("R cannot run other programs from inside the browser. Run the command in the Terminal tab instead.", call. = FALSE)
  if (!isTRUE(wb$interactive)) e$interactive <- function() FALSE
  e$commandArgs <- function(trailingOnly = FALSE) {
    if (is.null(wb$args)) return(base::commandArgs(trailingOnly))
    if (trailingOnly) wb$args else c("/usr/lib/R/bin/exec/R", "--no-echo", "--no-restore", "--args", wb$args)
  }

  ## ---- Shiny apps: served by the page (shiny.js) ----------------------------------------------
  # runApp() starts the app and returns: the page answers the app's requests (through the service worker,
  # isolation-sw.js) by calling these functions while R waits at its prompt – RStudio's console stays busy meanwhile.
  # (After the R code of Shinylive – Posit, MIT licence: assets/vendor/licenses/shinylive-MIT.txt – written again.)
  wb$shiny <- new.env()
  wb$shiny$apps <- list()
  wb$shiny$ws <- list()
  wb$shiny$seq <- 0L
  wb$shiny_run <- function(appDir = getwd(), port = getOption("shiny.port"), launch.browser = TRUE, host = getOption("shiny.host", "127.0.0.1"), workerId = "", quiet = FALSE, display.mode = c("auto", "normal", "showcase"), test.mode = FALSE, ...) {
    if (!(wb$kind %in% c("rstudio", "console")))
      stop("a Shiny app needs a window to be shown in, so run it in RStudio, with Run App or in the Console.", call. = FALSE)
    options(expressions = max(1000L, getOption("expressions")))
    # (as runApp(): the app works in its folder; the working directory comes back when it stops)
    wb$shiny$owd <- getwd()
    appObj <- shiny::as.shiny.appobj(appDir)
    if (is.character(appDir) && dir.exists(appDir)) setwd(appDir)
    if (is.function(appObj$onStart)) appObj$onStart()
    shiny:::workerId("")
    shiny:::clearCurrentAppState()
    shiny:::initCurrentAppState(appObj)
    h <- shiny:::createAppHandlers(appObj$httpHandler, appObj$serverFuncSource)
    hm <- shiny:::HandlerManager$new()
    hm$addHandler(h$http, "/", tail = TRUE)
    hm$addWSHandler(h$ws, "/", tail = TRUE)
    app <- hm$createHttpuvApp()
    g <- shiny:::.globals
    g$retval <- NULL
    g$stopped <- FALSE
    wb$shiny$seq <- wb$shiny$seq + 1L
    name <- sprintf("app_%d%s", wb$shiny$seq, paste(sample(c(letters, 0:9), 8, TRUE), collapse = ""))
    wb$shiny$apps[[name]] <- list(app = app, obj = appObj)
    if (is.null(port)) port <- sample(3000:8999, 1L)
    title <- if (is.character(appDir)) basename(normalizePath(appDir, mustWork = FALSE)) else "Shiny app"
    if (!isTRUE(quiet)) message("\nListening on http://", host, ":", port)
    wb$send("shiny", app = name, title = title, port = as.integer(port))
    invisible(NULL)
  }
  wb$shiny_reader <- function(bytes) {
    con <- rawConnection(bytes, "rb")
    list(read = function(l = -1L) readBin(con, "raw", n = if (l < 0) length(bytes) else l),
         read_lines = function(l = -1L) readLines(con, n = l, warn = FALSE),
         rewind = function() seek(con, 0),
         destroy = function() close(con))
  }
  # one request of the app's frame → JSON: {status, headers, body (base64)}
  wb$shiny_http <- function(name, path, method, query, body64) {
    a <- wb$shiny$apps[[name]]
    enc <- function(status, headers, body) jsonlite::toJSON(list(status = as.integer(status), headers = lapply(headers, function(v) paste(as.character(v), collapse = ", ")), body = jsonlite::base64_enc(body)), auto_unbox = TRUE)
    if (is.null(a)) return(enc(404L, list("Content-Type" = "text/plain; charset=UTF-8"), charToRaw("This Shiny app has stopped.")))
    reader <- wb$shiny_reader(if (nzchar(body64)) jsonlite::base64_dec(body64) else raw(0))
    on.exit(reader$destroy(), add = TRUE)
    r <- a$app$call(list(PATH_INFO = path, REQUEST_METHOD = method, QUERY_STRING = query, SCRIPT_NAME = "", rook.input = reader, HTTP_HOST = "127.0.0.1"))
    if (is.null(r)) return(enc(404L, list("Content-Type" = "text/plain; charset=UTF-8"), charToRaw("Not found")))
    body <- r$body
    if (is.list(body) && !is.null(body$file)) {
      f <- body$file
      body <- readBin(f, "raw", n = file.info(f)$size)
      if (isTRUE(r$body$owned)) unlink(f)
    } else if (is.character(body)) body <- charToRaw(enc2utf8(paste(body, collapse = "")))
    if (is.null(body)) body <- raw(0)
    enc(r$status, if (is.null(r$headers)) list() else r$headers, body)
  }
  wb$shiny_ws_open <- function(name, conn) {
    a <- wb$shiny$apps[[name]]
    if (is.null(a)) return(FALSE)
    cb <- new.env()
    cb$app <- name
    ws <- list(request = list(PATH_INFO = "/websocket/", REQUEST_METHOD = "GET", QUERY_STRING = "", HTTP_HOST = "127.0.0.1"),
               onMessage = function(func) cb$message <- func,
               onClose = function(func) cb$close <- func,
               send = function(message) wb$send("ws", conn = conn, type = "send", msg = message),
               close = function(...) wb$send("ws", conn = conn, type = "close", msg = ""))
    a$app$onWSOpen(ws)
    wb$shiny$ws[[conn]] <- cb
    TRUE
  }
  wb$shiny_ws_msg <- function(conn, text) {
    cb <- wb$shiny$ws[[conn]]
    if (!is.null(cb) && is.function(cb$message)) cb$message(FALSE, text)
    invisible(NULL)
  }
  wb$shiny_ws_close <- function(conn) {
    cb <- wb$shiny$ws[[conn]]
    wb$shiny$ws[[conn]] <- NULL
    if (!is.null(cb) && is.function(cb$close)) cb$close()
    invisible(NULL)
  }
  # what runApp() does between requests: timers, reactivity, pending work (later) → "stopped" after stopApp()
  wb$shiny_tick <- function() {
    if (!length(wb$shiny$apps)) return("")
    shiny:::timerCallbacks$executeElapsed()
    shiny:::flushReact()
    shiny:::flushPendingSessions()
    later::run_now(0)
    shiny:::flushReact()
    shiny:::flushPendingSessions()
    if (isTRUE(shiny:::.globals$stopped)) "stopped" else ""
  }
  wb$shiny_stop <- function(name) {
    for (k in names(wb$shiny$ws)) {
      cb <- wb$shiny$ws[[k]]
      if (identical(cb$app, name)) wb$shiny_ws_close(k)
    }
    wb$shiny$apps[[name]] <- NULL
    if (!is.null(wb$shiny$owd)) {
      try(setwd(wb$shiny$owd), silent = TRUE)
      wb$shiny$owd <- NULL
    }
    g <- shiny:::.globals
    g$stopped <- FALSE
    rv <- g$retval
    g$retval <- NULL
    # (what stopApp(value) gave back: runApp() returns it, and the console prints it)
    if (!is.null(rv) && !inherits(rv, "error") && isTRUE(rv$visible)) print(rv$value)
    invisible(NULL)
  }
  # (shiny's own runApp() would wait for requests that, here, only the page can answer: it is replaced when shiny loads)
  wb$shiny_patch <- function(env) {
    if (exists("runApp", envir = env, inherits = FALSE)) {
      unlockBinding("runApp", env)
      assign("runApp", wb$shiny_run, envir = env)
      lockBinding("runApp", env)
    }
  }
  setHook(packageEvent("shiny", "onLoad"), function(...) wb$shiny_patch(asNamespace("shiny")))
  setHook(packageEvent("shiny", "attach"), function(...) wb$shiny_patch(as.environment("package:shiny")))

  ## ---- what the page asks: the files, the variables, completions ---------------------------
  wb$scan <- function(roots) {
    # (the first line: where R is – getwd() – for the page's status lines and Files panes)
    out <- paste0("\001WD\t", getwd())
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
  wb$oneline <- function(x, width = 90L) {
    s <- tryCatch(paste(utils::capture.output(utils::str(x, give.attr = FALSE, vec.len = 4L, nchar.max = 60L, list.len = 3L, max.level = 1L, give.head = TRUE)), collapse = " "), error = function(e) class(x)[1L])
    s <- trimws(gsub("\\s+", " ", s))
    if (nchar(s) > width) paste0(substr(s, 1L, width - 1L), "…") else s
  }
  wb$envinfo <- function(env = globalenv(), all = FALSE) {
    nm <- ls(env, all.names = all)
    if (!length(nm)) return(character(0))
    vapply(nm, function(n) {
      if (bindingIsActive(n, env)) return(paste(n, "value", "active", "active binding", "", sep = "\t"))
      x <- get(n, envir = env)
      cls <- paste(class(x), collapse = "/")
      kind <- if (is.data.frame(x) || is.matrix(x)) "data" else if (is.function(x)) "function" else "value"
      desc <- if (is.data.frame(x)) sprintf("%s obs. of %d variable%s", format(nrow(x), big.mark = ","), ncol(x), if (ncol(x) == 1L) "" else "s")
        else if (is.function(x)) paste(sub("\\s*NULL$", "", paste(deparse(args(x)), collapse = " ")), collapse = "")
        else if (is.matrix(x)) wb$oneline(x)
        else if (is.atomic(x) && length(x) == 1L && is.null(attributes(x))) paste(format(x), collapse = "")
        else wb$oneline(x)
      desc <- gsub("[\t\n]", " ", desc)
      size <- tryCatch(format(utils::object.size(x), units = "auto", standard = "SI"), error = function(e) "")
      paste(n, kind, cls, desc, size, sep = "\t")
    }, "")
  }
  wb$complete <- function(line, cursor = nchar(line)) {
    utils:::.assignLinebuffer(line)
    utils:::.assignEnd(cursor)
    token <- utils:::.guessTokenFromLine()
    utils:::.completeToken()
    c(token, utils:::.retrieveCompletions())
  }
  wb$filetimes <- function(files, ms) invisible(Sys.setFileTime(files, as.POSIXct(ms / 1000, origin = "1970-01-01")))
  wb$set <- function(name, value) invisible(assign(name, value, envir = wb))

  ## ---- R's options here ------------------------------------------------------------------
  options(webr.show_menu = FALSE, menu.graphics = FALSE, browser = function(url) wb$send("browse", url = url))
  # (an error at the top level: the page hears of it – a chunk run in RStudio stops there, Rscript halts)
  options(error = function() wb$send("error"))
  attach(e, name = "tools:workbench", warn.conflicts = FALSE)
})
`;

  /* ------------------------------------------------------------------
     one R
     ------------------------------------------------------------------ */
  let modPromise = null;
  function webrModule() {
    if (!modPromise) {
      const base = abs(CFG.webrBase || 'https://webr.r-wasm.org/v0.6.0/');
      modPromise = import(base + 'webr.mjs').catch((e) => {
        modPromise = null;
        throw new Error('R could not be downloaded from ' + base + ' (' + ((e && e.message) || e) + '). Check your internet connection.');
      });
    }
    return modPromise;
  }

  const sessions = new Set();
  let seq = 0;

  class RSession {
    constructor(opts = {}) {
      this.id = ++seq;
      this.kind = opts.kind || 'console';
      this.opts = Object.assign({ repl: true, banner: false, graphics: 'canvas', interactive: true, sync: true }, opts);
      this.state = 'off';
      this.handlers = {};
      this.queue = []; // lines waiting for R to ask for input
      this.waiting = false; // R waits for input (a prompt was given)
      this.prompt = '';
      this.promptKind = '';
      this.work = Promise.resolve(); // jobs on the page's side, one after another
      this.sync = new RSync(this);
      this.versions = null;
      this.held = []; // what R printed before the session was ready (the banner)
      this.cwd = opts.cwd || HOME();
      sessions.add(this);
    }
    on(type, fn) {
      (this.handlers[type] = this.handlers[type] || []).push(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn);
    }
    emit(type, d) {
      for (const fn of (this.handlers[type] || []).slice()) {
        try {
          fn(d || {});
        } catch (e) {
          console.error('R session handler', type, e);
        }
      }
    }
    setState(state, text) {
      this.state = state;
      this.stateText = text || '';
      this.emit('state', { state, text: this.stateText });
      bus.emit('r:state', { id: this.id, kind: this.kind, state, text: this.stateText });
    }
    get isolated() {
      return !!window.crossOriginIsolated;
    }
    /** can R wait for an answer (readline(), browser()) and be interrupted? Only on the SharedArrayBuffer channel */
    get canBlock() {
      return this.channel === 'sab';
    }

    /* ---------------- starting ---------------- */
    start() {
      if (this.started) return this.started;
      this.started = this._start();
      this.started.catch(() => {});
      return this.started;
    }
    async _start() {
      this.setState('starting', 'Downloading R…');
      let mod;
      try {
        mod = await webrModule();
      } catch (e) {
        this.setState('failed', e.message);
        throw e;
      }
      const base = abs(CFG.webrBase || 'https://webr.r-wasm.org/v0.6.0/');
      const useSab = this.isolated && typeof SharedArrayBuffer !== 'undefined';
      this.channel = useSab ? 'sab' : 'pm';
      const RArgs = this.opts.banner ? [] : ['--quiet'];
      const webR = new mod.WebR({
        baseUrl: base,
        channelType: useSab ? mod.ChannelType.SharedArrayBuffer : mod.ChannelType.PostMessage,
        interactive: true,
        RArgs,
        homedir: HOME(),
        REnv: { R_HOME: '/usr/lib/R', FONTCONFIG_PATH: '/etc/fonts', R_ENABLE_JIT: '0', USER: MG.user.name(), LOGNAME: MG.user.name(), LANG: 'en_GB.UTF-8' }
      });
      this.webR = webR;
      this.setState('starting', 'Starting R…');
      try {
        await webR.init();
      } catch (e) {
        this.setState('failed', 'R could not start: ' + ((e && e.message) || e));
        throw e;
      }
      if (this.closed) throw new Error('R was closed');
      // the messages of this R are read from now on (the banner and the first prompt are held until R is set up)
      this._reader();
      this.setState('starting', 'Setting up R…');
      try {
        await this._setup();
      } catch (e) {
        console.error(e);
        this.setState('failed', 'R could not be set up: ' + ((e && e.message) || e));
        throw e;
      }
      this.ready = true;
      // what R printed while it started (its banner), then its prompt
      const held = this.held;
      this.held = null;
      // (what R printed as it started – its banner: R -f and R CMD BATCH print it again for a run of a spare R)
      this.bannerText = held.filter(([t]) => t === 'output').map(([, d]) => d.text).join('');
      for (const [type, d] of held) this.emit(type, d);
      if (this.waiting) this._prompted(this.prompt, true);
      else this.setState('busy');
      return this;
    }
    /** /data/examples in this R: lazy files of Emscripten's file system, each fetched (in parts) when it is read */
    async _examples() {
      const list = ((MG.app && MG.app.exampleFiles) || []).map((f) => {
        const i = f.path.lastIndexOf('/');
        return [f.path.slice(0, i), f.path.slice(i + 1), abs(f.url)];
      });
      if (!list.length) return;
      const js = `(function (L) { var FS = Module.FS, dirs = {}; L.forEach(function (f) { try { FS.mkdirTree(f[0]); dirs[f[0]] = 1; FS.createLazyFile(f[0], f[1], f[2], true, false); } catch (e) {} }); Object.keys(dirs).forEach(function (d) { for (var p = d; p.length > 1; p = p.replace(/\\/[^/]*$/, '') || '/') { try { FS.chmod(p, 365); } catch (e) {} if (p === '/data') break; } }); return L.length; })(${JSON.stringify(list)})`;
      try {
        await this.webR.evalRVoid(`invisible(webr::eval_js(${rstr(js)}))`);
      } catch (e) {
        console.error('examples', e);
      }
    }
    async _setup() {
      const W = this.webR;
      await W.evalRVoid(`invisible(webr::eval_js(${rstr(WORKER_HOOK)}))`);
      const repos = (CFG.rRepos || ['https://repo.r-wasm.org']).map((r) => r.replace(/\/$/, ''));
      // (the site's own packages – locfit, which DESeq2 and edgeR need – are looked in first; CRAN stays the webR
      // repository)
      const local = CFG.rLocalRepo ? [abs(CFG.rLocalRepo).replace(/\/$/, '')] : [];
      // When two repositories have the same package, R would take the newest version. Here the first repository in the
      // list wins instead, so webR's own builds of CRAN packages come before r-universe's: Shiny needs webR's builds of
      // later and httpuv, and r-universe's builds of packages that use threads cannot be loaded by this R.
      const firstRepo = 'available_packages_filters = list("R_version", "OS_type", "subarch", function(av) av[!duplicated(av[, "Package"]), , drop = FALSE])';
      const home = HOME();
      const cwd = this.cwd;
      const g = this.opts.graphics;
      await W.evalRVoid(
        [
          `options(webr_pkg_repos = ${rvec([...local, ...repos])}, repos = c(CRAN = ${rstr(repos[0])}), ${firstRepo}, warn = ${this.opts.warn != null ? this.opts.warn : 0}, width = ${this.opts.width || 80}, timeout = 300, help_type = "html")`,
          `Sys.setenv(HOME = ${rstr(home)}, USER = ${rstr(MG.user.name())}, LOGNAME = ${rstr(MG.user.name())}, R_USER = ${rstr(home)})`,
          `.wb_kind <- ${rstr(this.kind)}; .wb_can_block <- ${this.canBlock ? 'TRUE' : 'FALSE'}; .wb_userlib <- ${rvec(userlib.list())}; .wb_interactive <- ${this.opts.interactive ? 'TRUE' : 'FALSE'}; .wb_args <- ${this.opts.args ? rvec(this.opts.args) : 'NULL'}; .wb_home <- ${rstr(home)}`
        ].join('\n')
      );
      // (webR's own shims for library() and require() – webr::shim_install() – would install a missing package
      // without asking: the workbench's versions load only what is installed, as R does, and install.packages()
      // installs – see R_SETUP)
      await W.evalRVoid(R_SETUP);
      if (g === 'canvas') await W.evalRVoid('options(device = get("wb", envir = as.environment("tools:workbench"))$canvas)');
      else if (g === 'pdf') await W.evalRVoid('options(device = function(file = "Rplots.pdf", ...) grDevices::pdf(file = file, ...))');
      if (this.opts.setup) await W.evalRVoid(this.opts.setup);
      // the example data, read-only: each file is fetched the first time R reads it
      await this._examples();
      // (the home folder was /home/student until October 2026: a path written with that name still leads home)
      if (home !== '/home/student') await W.evalRVoid(`if (!file.exists("/home/student")) try(file.symlink(${rstr(home)}, "/home/student"), silent = TRUE)`);
      // the files of the home folder, and the folder R starts in
      await this.sync.push();
      await W.evalRVoid(`if (dir.exists(${rstr(cwd)})) setwd(${rstr(cwd)}) else setwd(${rstr(home)})`);
      // (R – and RStudio – load the workspace saved in .RData in the folder they start in, unless told not to)
      if (this.opts.restoreData) {
        const restored = await W.evalRRaw('if (file.exists(".RData")) { try(load(".RData", envir = globalenv()), silent = TRUE); TRUE } else FALSE', 'boolean');
        if (restored && this.held) this.held.push(['output', { text: this.opts.restoreData === 'rstudio' ? '[Workspace loaded from ~/.RData]\n\n' : '[Previously saved workspace restored]\n\n', stream: 'out' }]);
        this.restored = !!restored;
      }
      const v = await W.evalRRaw('c(paste(R.version$major, R.version$minor, sep = "."), as.character(packageVersion("webr")), R.version.string, getOption("prompt"), getOption("continue"), R.version$nickname)', 'string[]');
      this.versions = { r: v[0], webr: v[1], string: v[2], nick: v[5] || '' };
      this.promptTop = v[3] || '> ';
      this.promptMore = v[4] || '+ ';
      MG.R.versions = MG.R.versions || this.versions;
    }

    /* ---------------- R's messages ---------------- */
    async _reader() {
      const W = this.webR;
      for (;;) {
        let m;
        try {
          m = await W.read();
        } catch (e) {
          if (!this.closed) this._ended('R stopped: ' + ((e && e.message) || e));
          return;
        }
        if (!m) continue;
        if (m.type === 'closed') {
          if (!this.closed) this._ended('R has ended.');
          return;
        }
        try {
          this._message(m);
        } catch (e) {
          console.error('R message', m, e);
        }
      }
    }
    /** pass a message on – or hold it, while R is being set up */
    _out(type, d) {
      if (this.held) this.held.push([type, d]);
      else this.emit(type, d);
    }
    _message(m) {
      switch (m.type) {
        case 'wbout':
          for (const c of m.data || []) this._out('output', { text: c.text, stream: c.fd === 2 ? 'err' : 'out' });
          break;
        case 'stdout':
          this._out('output', { text: String(m.data) + '\n', stream: 'out' });
          break;
        case 'stderr':
          this._out('output', { text: String(m.data) + '\n', stream: 'err' });
          break;
        case 'prompt':
          this.waiting = true;
          this.prompt = String(m.data);
          if (this.ready) this._prompted(this.prompt);
          break;
        case 'canvas': {
          const d = m.data || {};
          if (d.event === 'canvasNewPage') this.emit('plot', { kind: 'new', id: d.id });
          else if (d.event === 'canvasImage') this.emit('plot', { kind: 'image', id: d.id, image: d.image });
          break;
        }
        case 'view':
          this._view(m.data || {});
          break;
        case 'pager':
          this._pagerFile(m.data && m.data.path, (m.data && m.data.title) || 'R Information', true);
          break;
        case 'browse':
          this.emit('browse', { url: m.data && m.data.url });
          break;
        case 'wb':
          this._wb(m.data || {});
          break;
        default:
          break;
      }
    }
    _wb(d) {
      switch (d.event) {
        case 'installed':
          userlib.add(d.pkgs);
          this.emit('installed', d);
          bus.emit('r:installed', { kind: this.kind, pkgs: [].concat(d.pkgs || []) });
          break;
        case 'removed':
          userlib.remove(d.pkgs);
          this.emit('event', d);
          break;
        case 'quit':
          this.quitting = d;
          this.emit('quit', d);
          break;
        case 'help':
          this._help(d);
          break;
        case 'pager':
          this._pagerFile(d.file, d.title, true, d.view);
          break;
        case 'browse':
          this.emit('browse', { url: d.url });
          break;
        case 'error':
          this.errors = (this.errors || 0) + 1;
          if (this.haltOnError) this.queue = [];
          this.emit('rerror', {});
          break;
        case 'helpchoice':
          this.emit('helpchoice', { topic: d.topic, files: [].concat(d.files || []), packages: [].concat(d.packages || []) });
          break;
        case 'edit':
          this.emit('edit', { file: d.file });
          break;
        default:
          this.emit('event', d);
      }
    }
    async _readText(path, remove) {
      if (!path) return '';
      try {
        const bytes = await this.webR.FS.readFile(path);
        if (remove) this.webR.FS.unlink(path).catch(() => {});
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        return '';
      }
    }
    async _help(d) {
      const html = d.missing ? '' : await this._readText(d.file, true);
      this.emit('help', { topic: d.topic, package: d.package, title: d.title, html, missing: !!d.missing });
      if (!d.missing) bus.emit('r:help', { kind: this.kind, topic: d.topic, package: d.package });
    }
    /** a help page asked for by the page (a link in a help page, the Help pane's search) – while R is idle */
    helpTopic(topic, pkg) {
      return this.whenIdle((W) => W.evalRVoid(`${WB}$help_topic(${rstr(topic)}, ${rstr(pkg || '')})`));
    }
    helpFile(file, topic) {
      return this.whenIdle((W) => W.evalRVoid(`${WB}$help_html(${rstr(file)}, ${rstr(topic || '')})`));
    }
    async _pagerFile(path, title, remove, view) {
      const text = await this._readText(path, remove);
      this.emit('pager', { title, text, view: !!view });
    }
    _view(m) {
      const data = m.data || {};
      const meta = data['.wb_meta'] || null;
      delete data['.wb_meta'];
      const M = meta ? rval(meta) : null;
      const cols = Object.entries(data).map(([name, c]) => ({ name, type: c && c.type, values: (c && c.values) || [] }));
      const one = (v) => (Array.isArray(v) ? v[0] : v);
      const names = M && M.names ? [].concat(M.names) : cols.map((c) => c.name);
      const types = M && M.types ? [].concat(M.types) : cols.map((c) => c.type);
      const out = {
        title: String((M && one(M.title)) || m.title || 'Data'),
        nrow: M ? Number(one(M.nrow)) : cols[0] ? cols[0].values.length : 0,
        ncol: M ? Number(one(M.ncol)) : cols.length,
        shown: M ? Number(one(M.shown)) : cols[0] ? cols[0].values.length : 0,
        rownames: M && M.rownames ? [].concat(M.rownames) : null,
        labels: M && M.labels ? [].concat(M.labels) : null,
        columns: cols.map((c, i) => ({ name: names[i] != null ? names[i] : c.name, type: types[i] || c.type, values: c.values }))
      };
      this.emit('view', out);
      bus.emit('r:view', { kind: this.kind, title: out.title, nrow: out.nrow, ncol: out.ncol });
    }

    /* ---------------- prompts and input ---------------- */
    _kindOf(p) {
      if (p === this.promptTop) return 'top';
      if (p === this.promptMore) return 'continue';
      if (/^Browse\[\d+\]> $/.test(p)) return 'browser';
      return 'input';
    }
    _prompted(p) {
      const kind = this._kindOf(p);
      this.promptKind = kind;
      if (this.quitting) {
        const d = this.quitting;
        this.quitting = null;
        this._job(async () => {
          await this.sync.pull();
          this.close(true);
          this._ended(null, d);
        });
        return;
      }
      this.emit('prompt', { prompt: p, kind });
      if (kind === 'top') {
        this._job(async () => {
          if (this.opts.sync) await this.sync.pull();
          if (!this.queue.length) {
            this.setState('idle');
            this.emit('idle', {});
          }
        });
      } else this.setState(kind === 'browser' ? 'browser' : kind === 'continue' ? 'continue' : 'input');
      this._job(() => this._feed());
    }
    /** one thing at a time on the page's side: the copying of files and the feeding of lines */
    _job(fn) {
      const job = this.work.then(fn);
      this.work = job.catch((e) => console.error('R session job', e));
      return job;
    }
    async _feed() {
      if (!this.waiting || !this.queue.length || this.closed) return;
      const item = this.queue.shift();
      if (this.promptKind === 'top' && this.libStale) {
        this.libStale = false;
        await this.webR.evalRVoid(`${WB}$set("userlib", ${rvec(userlib.list())})`).catch(() => {});
      }
      if (this.promptKind === 'top' && this.opts.sync) await this.sync.push();
      if (this.closed) return;
      this.waiting = false;
      this.setState('busy');
      this.emit('echo', { prompt: this.prompt, line: item.line, kind: this.promptKind, silent: !!item.silent });
      if (!item.silent) bus.emit('r:input', { kind: this.kind, line: item.line, promptKind: this.promptKind });
      this.webR.writeConsole(item.line);
    }
    /** a line of input for R: run when R asks for the next line. opts.silent: not shown as typed (the page's own) */
    send(line, opts = {}) {
      const lines = String(line).replace(/\r\n?/g, '\n').split('\n');
      for (const l of lines) this.queue.push({ line: l, silent: !!opts.silent });
      if (this.ready) this._job(() => this._feed());
      return this.queue.length;
    }
    /** what is still waiting to be read by R */
    pending() {
      return this.queue.map((x) => x.line);
    }
    clearQueue() {
      this.queue = [];
    }
    /** Esc / Ctrl+C: what R is doing is stopped (R stays, with its variables) */
    interrupt() {
      this.queue = [];
      if (!this.webR || this.closed) return false;
      if (!this.canBlock) return false;
      try {
        this.webR.interrupt();
        return true;
      } catch (e) {
        return false;
      }
    }
    get idle() {
      return this.ready && !this.closed && this.waiting && this.promptKind === 'top' && !this.queue.length;
    }
    /** run fn(webR) while R waits at its top-level prompt (the Environment pane, completions …) → its result */
    whenIdle(fn) {
      return this._job(async () => {
        if (!this.ready || this.closed || !this.waiting) return null;
        return fn(this.webR);
      });
    }
    async evalString(code) {
      return this.whenIdle((W) => W.evalRString(code));
    }
    async evalLines(code) {
      return this.whenIdle((W) => W.evalRRaw(code, 'string[]'));
    }
    async evalVoid(code) {
      return this.whenIdle((W) => W.evalRVoid(code));
    }
    /** the variables of the global environment: [{name, kind, cls, desc, size}] */
    async variables(all) {
      const lines = await this.evalLines(`get("wb", envir = as.environment("tools:workbench"))$envinfo(all = ${all ? 'TRUE' : 'FALSE'})`);
      return (lines || []).map((l) => {
        const [name, kind, cls, desc, size] = l.split('\t');
        return { name, kind, cls, desc, size };
      });
    }
    /** completions of what is typed (R's own: utils' rcompgen) → {token, items} */
    async complete(line, cursor) {
      try {
        const r = await this.evalLines(`get("wb", envir = as.environment("tools:workbench"))$complete(${rstr(line)}, ${cursor == null ? 'nchar(' + rstr(line) + ')' : Number(cursor)})`);
        if (!r) return null;
        return { token: r[0] || '', items: r.slice(1) };
      } catch (e) {
        return null;
      }
    }
    /** the size of new plots (in pixels of the page) */
    async figSize(width, height) {
      this.fig = { width: Math.max(120, Math.round(width)), height: Math.max(100, Math.round(height)) };
      return this.evalVoid(`${WB}$set("fig", c(width = ${this.fig.width}, height = ${this.fig.height}))`);
    }
    /** the width of the console in characters (options(width)) */
    async consoleWidth(chars) {
      const n = Math.max(20, Math.min(1000, Math.floor(chars)));
      if (n === this._width) return;
      this._width = n;
      return this.evalVoid(`options(width = ${n})`);
    }

    /* ---------------- ending ---------------- */
    _ended(why, quit) {
      if (this.endedOnce) return;
      this.endedOnce = true;
      this.ready = false;
      this.setState('ended', why || '');
      this.emit('ended', { why, quit: quit || null });
      sessions.delete(this);
    }
    close(quiet) {
      if (this.closed) return;
      this.closed = true;
      this.queue = [];
      try {
        if (this.webR) this.webR.close();
      } catch (e) {
        /* already gone */
      }
      sessions.delete(this);
      if (!quiet) this._ended('R was closed.');
    }
  }

  /* ------------------------------------------------------------------
     the home folder ↔ an R's copy of it
     ------------------------------------------------------------------ */
  class RSync {
    constructor(S) {
      this.S = S;
      this.sent = new Map(); // path → {e, m}: what R has of the page's files
      this.known = new Map(); // path → 'd' | 'size:mtime' as R last listed them
    }
    async _list() {
      const lines = await this.S.webR.evalRRaw(`get("wb", envir = as.environment("tools:workbench"))$scan(${rstr(HOME())})`, 'string[]');
      const m = new Map();
      for (const l of lines) {
        if (l.startsWith('\x01WD\t')) {
          const wd = l.slice(4);
          if (wd !== this.S.wd) {
            this.S.wd = wd;
            this.S.emit('wd', { wd });
          }
          continue;
        }
        const [p, kind, size, mtime] = l.split('\t');
        m.set(p, kind === 'd' ? 'd' : size + ':' + mtime);
      }
      return m;
    }
    async _mkdirs(dir) {
      const W = this.S.webR;
      const parts = dir.split('/').filter(Boolean);
      let p = '';
      for (const s of parts) {
        p += '/' + s;
        if (this._made && this._made.has(p)) continue;
        try {
          await W.FS.mkdir(p);
        } catch (e) {
          /* there */
        }
        (this._made = this._made || new Set()).add(p);
      }
    }
    /** the files that changed in the page → R */
    async push() {
      const F = MG.app.fs;
      const W = this.S.webR;
      if (!F || !W) return;
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
      if (removed.length) {
        await W.evalRVoid(`unlink(${rvec(removed)}, recursive = TRUE)`);
        if (this._made) for (const p of removed) for (const d of Array.from(this._made)) if (d === p || d.startsWith(p + '/')) this._made.delete(d);
      }
      dirs.sort((a, b) => a.length - b.length);
      for (const d of dirs) await this._mkdirs(d);
      const paths = [], times = [];
      for (const p of files) {
        const e = F.entries.get(p);
        let bytes;
        try {
          bytes = await F.readBytes(p);
        } catch (err) {
          continue;
        }
        await this._mkdirs(p.slice(0, p.lastIndexOf('/')));
        await W.FS.writeFile(p, bytes);
        this.sent.set(p, { e, m: e.mtime });
        paths.push(p);
        times.push(e.mtime || Date.now());
      }
      if (paths.length) await W.evalRVoid(`get("wb", envir = as.environment("tools:workbench"))$filetimes(${rvec(paths)}, c(${times.join(', ')}))`);
      this.known = await this._list();
    }
    /** the files that R wrote → the page */
    async pull() {
      const F = MG.app.fs;
      const W = this.S.webR;
      if (!F || !W || this.S.closed) return;
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
      const removed = [];
      for (const p of gone) {
        // (a file that the page has changed since R last had it is not removed: it is new to R)
        const s = this.sent.get(p), e = F.get(p);
        if (e && s && s.e !== 'dir' && s.e !== e) continue;
        if (F.exists(p)) {
          F.remove(p);
          removed.push(p);
        }
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
        const mtime = Math.round(Number(now.get(p).split(':')[1])) || Date.now();
        const text = MG.looksText(p, bytes);
        const entry = text != null ? { kind: 'text', text, mtime, fresh: true } : { kind: 'blob', blob: new Blob([bytes]), size: bytes.length, mtime, fresh: true };
        const old = F.get(p);
        if (old && old.readonly) continue;
        if (old && old.mode) entry.mode = old.mode;
        try {
          F.put(p, entry);
        } catch (e) {
          continue;
        }
        const stored = F.get(p);
        this.sent.set(p, { e: stored, m: stored.mtime });
        files.push(p);
      }
      if (files.length || removed.length || made.length) {
        this.S.emit('files', { files, removed, dirs: made });
        bus.emit('r:files', { kind: this.S.kind, files, removed });
      }
    }
  }

  /* ------------------------------------------------------------------
     sessions made ready in advance: Rscript and knitting each start an R of their own, as on a computer – one
     is started in the background once the first has been used, so that the next run does not wait for R
     ------------------------------------------------------------------ */
  const spares = new Map(); // key → Promise<RSession>
  function spareKey(o) {
    return [o.kind || '', o.banner ? 1 : 0, o.graphics || '', o.interactive === false ? 0 : 1].join('|');
  }
  /** a new R, started (a spare one if there is one) → RSession. opts as RSession's; opts.cwd and opts.args are
      set when it is handed out */
  async function fresh(opts = {}) {
    const key = spareKey(opts);
    let S = null;
    const sp = spares.get(key);
    if (sp) {
      spares.delete(key);
      try {
        S = await sp;
        if (S.closed || !S.ready) S = null;
      } catch (e) {
        S = null;
      }
    }
    if (S) {
      // the folder it works in, the arguments, the files that changed since it was made ready
      // (and the packages installed since it was made ready: they are loaded when they are first used)
      await S._job(async () => {
        await S.sync.push();
        const cwd = rstr(opts.cwd && opts.cwd !== '' ? opts.cwd : HOME());
        await S.webR.evalRVoid(`if (dir.exists(${cwd})) setwd(${cwd}) else setwd(${rstr(HOME())}); ${WB}$set("args", ${opts.args ? rvec(opts.args) : 'NULL'}); ${WB}$set("userlib", ${rvec(userlib.list())})`);
      });
      S.opts = Object.assign(S.opts, opts);
      S.cwd = opts.cwd || HOME();
    } else {
      S = new RSession(opts);
      await S.start();
    }
    if (opts.spare !== false) setTimeout(() => prewarm(opts), 1500);
    return S;
  }
  function prewarm(opts) {
    const key = spareKey(opts);
    if (spares.has(key)) return;
    const o = Object.assign({}, opts, { cwd: HOME(), args: null });
    const S = new RSession(o);
    S.spare = true;
    const p = S.start().then(() => S);
    p.catch(() => spares.delete(key));
    spares.set(key, p);
  }

  MG.R = {
    Session: RSession,
    sessions,
    userlib,
    fresh,
    prewarm,
    rstr,
    rvec,
    module: webrModule,
    versions: null,
    isolated: () => !!window.crossOriginIsolated
  };
})();
