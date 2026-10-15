/* =====================================================================
   R Markdown, R Notebooks and Quarto documents.

   Knit (R Markdown, output: html_document) and Render (Quarto, .qmd) run
   the document from the top in a NEW R – not the R of the console – as
   RStudio does: knitr runs the chunks and writes Markdown (the plots in
   it as pictures), R's markdown package turns the Markdown into HTML, and
   the page puts that into a page of the document's style, with the code
   coloured. The .html file is written next to the document. What the
   document needs must be made by the document itself: an object that
   exists only in the console is not there ("object not found").

   An R Notebook (output: html_notebook) is not knitted: its chunks are
   run one by one in RStudio (their output shows under each chunk), and
   saving it writes NAME.nb.html – the text, the code and the outputs as
   they are, without running anything again.

   (pandoc is not available in a browser, so rmarkdown::render() is not
   used: knitr and markdown give the same kind of HTML page.)
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { esc, bus } = MG;
  const rstr = (s) => MG.R.rstr(s);

  /* ------------------------------------------------------------------
     the YAML header of a document: enough of YAML for front matter
     ------------------------------------------------------------------ */
  function splitFrontMatter(text) {
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(String(text || ''));
    if (!m) return { yaml: '', body: String(text || ''), lines: 0 };
    return { yaml: m[1], body: text.slice(m[0].length), lines: m[0].split('\n').length - 1 };
  }
  function scalar(v) {
    v = v.trim();
    if (/^".*"$/.test(v)) {
      try {
        return JSON.parse(v);
      } catch (e) {
        return v.slice(1, -1);
      }
    }
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    if (/^(true|yes)$/i.test(v)) return true;
    if (/^(false|no)$/i.test(v)) return false;
    if (/^(null|~)$/i.test(v)) return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '');
    return v;
  }
  /** YAML of a front matter → an object (maps by indentation, lists with "- ", scalars) */
  function parseYaml(yaml) {
    const lines = String(yaml || '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
    let i = 0;
    const indentOf = (l) => l.match(/^ */)[0].length;
    function block(ind) {
      let obj = null, arr = null;
      while (i < lines.length) {
        const l = lines[i];
        const d = indentOf(l);
        if (d < ind) break;
        const t = l.trim();
        if (t.startsWith('- ') || t === '-') {
          arr = arr || [];
          i++;
          const rest = t.slice(1).trim();
          if (!rest) arr.push(block(d + 1));
          else if (/^[\w.-]+\s*:/.test(rest) && !/^https?:/.test(rest)) {
            // a map in a list: - name: value
            const o = {};
            const [k, ...v] = rest.split(':');
            const val = v.join(':').trim();
            o[k.trim()] = val ? scalar(val) : block(d + 2);
            const more = block(d + 2);
            if (more && typeof more === 'object' && !Array.isArray(more)) Object.assign(o, more);
            arr.push(o);
          } else arr.push(scalar(rest));
          continue;
        }
        const m = /^([^:]+?)\s*:(\s+(.*)|\s*)$/.exec(t);
        if (!m) {
          i++;
          continue;
        }
        obj = obj || {};
        i++;
        const key = m[1].trim().replace(/^["']|["']$/g, '');
        const val = (m[3] || '').trim();
        if (val === '|' || val === '>' || val === '|-' || val === '>-') {
          const parts = [];
          while (i < lines.length && indentOf(lines[i]) > d) parts.push(lines[i++].trim());
          obj[key] = parts.join(val[0] === '|' ? '\n' : ' ');
        } else if (val) obj[key] = scalar(val);
        else {
          const sub = block(d + 1);
          obj[key] = sub == null ? null : sub;
        }
      }
      return arr || obj;
    }
    try {
      return block(0) || {};
    } catch (e) {
      return {};
    }
  }
  function frontMatter(text) {
    const fm = splitFrontMatter(text);
    const y = parseYaml(fm.yaml);
    return y && typeof y === 'object' && !Array.isArray(y) ? y : {};
  }
  /** the output format a document asks for: 'html_document', 'html_notebook', 'quarto' (.qmd), or another
      (pdf_document, word_document …: not available here) */
  function outputOf(path, text) {
    const y = frontMatter(text);
    if (/\.qmd$/i.test(path)) {
      const f = y.format;
      const name = typeof f === 'string' ? f : f && typeof f === 'object' ? Object.keys(f)[0] : 'html';
      return { kind: 'quarto', format: name || 'html', yaml: y };
    }
    let o = y.output;
    let name = typeof o === 'string' ? o : o && typeof o === 'object' ? Object.keys(o)[0] : 'html_document';
    name = String(name || 'html_document').replace(/^rmarkdown::/, '');
    const opts = o && typeof o === 'object' && !Array.isArray(o) ? o[Object.keys(o)[0]] || {} : {};
    return { kind: name === 'html_notebook' ? 'notebook' : 'rmd', format: name, yaml: y, opts: typeof opts === 'object' ? opts : {} };
  }
  function docKind(path, text) {
    if (/\.r$/i.test(path)) return 'r';
    if (/\.qmd$/i.test(path)) return 'qmd';
    if (/\.rmd$/i.test(path)) return outputOf(path, text || '').kind === 'notebook' ? 'notebook' : 'rmd';
    if (/\.(md|markdown)$/i.test(path)) return 'md';
    return 'text';
  }
  /** the chunks of an R Markdown or Quarto document: [{from, to, header, lang, label, code, codeFrom}] (0-based lines) */
  function chunks(text) {
    const L = String(text || '').split('\n');
    const out = [];
    let open = null;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!open) {
        const m = /^(\s*)(`{3,})\s*\{([A-Za-z]+)[\s,]*([^}]*)\}\s*$/.exec(l);
        if (m) open = { from: i, fence: m[2], lang: m[3].toLowerCase(), header: l, opts: m[4] || '' };
      } else if (new RegExp('^\\s*' + open.fence + '\\s*$').test(l)) {
        const label = (/^([\w.-]+)(?=\s*(,|$))/.exec(open.opts.trim()) || [])[1] || '';
        const body = L.slice(open.from + 1, i);
        out.push({ from: open.from, to: i, header: open.header, lang: open.lang, label: label && !/=/.test(label) ? label : '', code: body.join('\n'), codeFrom: open.from + 1 });
        open = null;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------
     colouring code (CodeMirror's R mode, as RStudio colours it)
     ------------------------------------------------------------------ */
  function highlight(code, mode) {
    if (!window.CodeMirror || !window.CodeMirror.runMode) return esc(code);
    let out = '';
    window.CodeMirror.runMode(code, mode || 'r', (text, style) => {
      const t = esc(text);
      out += style ? `<span class="${style.split(' ').map((s) => 'tok-' + s).join(' ')}">${t}</span>` : t;
    });
    return out;
  }
  /** colour the R code blocks of an HTML page (<pre><code class="language-r">) */
  function highlightHtml(html) {
    const doc = new DOMParser().parseFromString('<div id="x">' + html + '</div>', 'text/html');
    const box = doc.getElementById('x');
    box.querySelectorAll('pre > code').forEach((c) => {
      const cls = c.className || '';
      const lang = (/language-(\w+)/.exec(cls) || [])[1];
      if (lang && /^(r|R)$/.test(lang)) {
        c.innerHTML = highlight(c.textContent, 'r');
        c.parentElement.classList.add('r-code');
      } else if (!lang) c.parentElement.classList.add('r-output');
    });
    return box.innerHTML;
  }

  /* ------------------------------------------------------------------
     the pages: R Markdown's html_document, Quarto's html, an R Notebook
     ------------------------------------------------------------------ */
  const TOK_CSS = `.tok-keyword{color:#007020;font-weight:bold}.tok-atom{color:#007020}.tok-number{color:#40a070}.tok-string,.tok-string-2{color:#4070a0}.tok-comment{color:#60a0b0;font-style:italic}.tok-operator,.tok-arg-is{color:#666}.tok-builtin{color:#06287e}`;
  const RMD_CSS = `html{-webkit-text-size-adjust:100%}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.42857;color:#333;background:#fff;margin:0}
.main-container{max-width:940px;margin:0 auto;padding:0 15px 40px}h1,h2,h3,h4,h5,h6{font-weight:500;line-height:1.1;color:inherit}h1{font-size:36px;margin:20px 0 10px}h2{font-size:30px;margin:20px 0 10px}h3{font-size:24px;margin:20px 0 10px}h4{font-size:18px;margin:10px 0}h5{font-size:14px}h1.title{font-size:38px;margin-top:20px}h4.author,h4.date{margin:6px 0;color:#333}h3.subtitle{margin-top:0}p{margin:0 0 10px}a{color:#337ab7}
pre{display:block;padding:9.5px;margin:0 0 10px;font-size:13px;line-height:1.42857;word-break:break-all;word-wrap:break-word;color:#333;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;overflow-x:auto}pre code{white-space:pre-wrap;font-family:Menlo,Monaco,Consolas,"Courier New",monospace;font-size:inherit;color:inherit;background:transparent;padding:0}
pre.r-code{background:#f8f8f8;border-color:#e5e5e5}pre.r-output{background:#fff;border-color:#e5e5e5}code{padding:2px 4px;font-size:90%;color:#c7254e;background:#f9f2f4;border-radius:4px;font-family:Menlo,Monaco,Consolas,"Courier New",monospace}pre code{color:inherit;background:none}
img{max-width:100%;height:auto}.figure{margin:10px 0}.figure p.caption,p.caption{color:#777;margin-top:4px}table{border-collapse:collapse;margin:10px 0}th,td{padding:4px 10px;border-bottom:1px solid #ddd;text-align:left}thead th{border-bottom:2px solid #ddd}blockquote{padding:10px 20px;margin:0 0 20px;font-size:17.5px;border-left:5px solid #eee}hr{border:0;border-top:1px solid #eee;margin:20px 0}
#TOC{margin:20px 0 25px;padding:6px 14px;border:1px solid #ddd;border-radius:4px;display:inline-block;min-width:240px}#TOC ul{padding-left:18px;margin:4px 0}#TOC a{text-decoration:none}`;
  const QMD_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:17px;line-height:1.5;color:#212529;background:#fff;margin:0}
.page{max-width:800px;margin:0 auto;padding:24px 20px 60px}#title-block-header{margin:12px 0 28px}h1.title{font-size:2.4rem;font-weight:500;margin:0 0 .4em;line-height:1.2}.subtitle{font-size:1.25rem;color:#6c757d;margin:0 0 .8em}.quarto-title-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,max-content));column-gap:3em;margin-top:1em}.quarto-title-meta-heading{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:#6c757d;margin-bottom:.15em;font-weight:500}.quarto-title-meta-contents{font-size:1rem}
h2{font-size:1.65rem;font-weight:500;margin:2rem 0 1rem;padding-bottom:.4rem;border-bottom:1px solid #dee2e6}h3{font-size:1.35rem;font-weight:500;margin:1.6rem 0 .8rem}h4{font-size:1.15rem;font-weight:500}p{margin:0 0 1rem}a{color:#2780e3;text-decoration:none}a:hover{text-decoration:underline}
pre{margin:0 0 1rem;padding:.4em .6em;background:#f8f9fa;border-left:3px solid #dee2e6;border-radius:2px;font-size:.875rem;overflow-x:auto}pre code{font-family:SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;white-space:pre-wrap;color:#003b4f;background:none;padding:0}pre.r-output{background:none;border-left:0;padding-left:0}pre.r-output code{color:#212529}code{font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:.875em;color:#7d12ba;background:rgba(233,236,239,.65);padding:.1em .3em;border-radius:3px}
img{max-width:100%;height:auto}.figure{margin:1rem 0}.figure .caption,p.caption{font-size:.9rem;color:#6c757d;text-align:center}table{border-collapse:collapse;margin:1rem 0}th,td{padding:.4rem .8rem;border-bottom:1px solid #dee2e6;text-align:left}thead th{border-bottom:2px solid #212529}blockquote{margin:0 0 1rem;padding:.5rem 1rem;border-left:.25rem solid #e9ecef;color:#6c757d}
.tok-keyword{color:#003b4f;font-weight:bold}.tok-atom{color:#ad0000}.tok-number{color:#ad0000}.tok-string,.tok-string-2{color:#20794d}.tok-comment{color:#5e5e5e;font-style:italic}.tok-operator,.tok-arg-is{color:#5e5e5e}.tok-builtin{color:#4758ab}
#TOC{float:right;width:220px;margin:0 0 20px 24px;font-size:.9rem;border-left:1px solid #dee2e6;padding-left:12px}#TOC ul{list-style:none;padding-left:.8em;margin:.3em 0}#TOC>ul{padding-left:0}#TOC a{color:#595959}`;

  function asList(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name || Object.values(x)[0] : x)).filter((x) => x != null).map(String);
    if (typeof v === 'object') return [String(v.name || Object.values(v)[0])];
    return [String(v)];
  }
  /** a table of contents from the headings of the body (h2–h3), and ids for them */
  function toc(body, depth) {
    const doc = new DOMParser().parseFromString('<div id="x">' + body + '</div>', 'text/html');
    const box = doc.getElementById('x');
    const hs = Array.from(box.querySelectorAll(depth >= 3 ? 'h1, h2, h3' : 'h1, h2'));
    if (!hs.length) return { body, toc: '' };
    let html = '<ul>';
    let level = null;
    hs.forEach((hh, k) => {
      if (!hh.id) hh.id = 'section-' + (k + 1);
      const n = +hh.tagName[1];
      if (level != null && n > level) html += '<ul>';
      else if (level != null && n < level) html += '</ul>';
      level = n;
      html += `<li><a href="#${esc(hh.id)}">${esc(hh.textContent)}</a></li>`;
    });
    html += '</ul>';
    return { body: box.innerHTML, toc: html };
  }
  function pageRmd(body, y, opts) {
    const title = y.title != null ? String(y.title) : '';
    let t = { body, toc: '' };
    if (opts && opts.toc) t = toc(body, Number(opts.toc_depth) || 3);
    const head = (title ? `<h1 class="title toc-ignore">${esc(title)}</h1>` : '') + (y.subtitle ? `<h3 class="subtitle">${esc(y.subtitle)}</h3>` : '') + asList(y.author).map((a) => `<h4 class="author">${esc(a)}</h4>`).join('') + (y.date != null ? `<h4 class="date">${esc(y.date)}</h4>` : '');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="generator" content="knitr and markdown, in the workbench">
<meta name="viewport" content="width=device-width, initial-scale=1">
${asList(y.author).map((a) => `<meta name="author" content="${esc(a)}">`).join('\n')}
<title>${esc(title || 'Document')}</title>
<style>${RMD_CSS}${TOK_CSS}</style>
</head>
<body>
<div class="container-fluid main-container">
<div id="header">${head}</div>
${t.toc ? `<div id="TOC">${t.toc}</div>` : ''}
${t.body}
</div>
</body>
</html>
`;
  }
  function pageQmd(body, y) {
    const title = y.title != null ? String(y.title) : '';
    const fmt = y.format && typeof y.format === 'object' ? y.format.html || {} : {};
    let t = { body, toc: '' };
    if (fmt.toc || y.toc) t = toc(body, 3);
    const authors = asList(y.author);
    const meta = [];
    if (authors.length) meta.push(`<div><div class="quarto-title-meta-heading">${authors.length > 1 ? 'Authors' : 'Author'}</div>${authors.map((a) => `<div class="quarto-title-meta-contents">${esc(a)}</div>`).join('')}</div>`);
    if (y.date != null) meta.push(`<div><div class="quarto-title-meta-heading">Published</div><div class="quarto-title-meta-contents">${esc(y.date)}</div></div>`);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="knitr and markdown, in the workbench (styled like a Quarto page)">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Document')}</title>
<style>${QMD_CSS}</style>
</head>
<body>
<main class="page">
<header id="title-block-header">${title ? `<h1 class="title">${esc(title)}</h1>` : ''}${y.subtitle ? `<p class="subtitle">${esc(y.subtitle)}</p>` : ''}${meta.length ? `<div class="quarto-title-meta">${meta.join('')}</div>` : ''}</header>
${t.toc ? `<nav id="TOC"><h2 style="font-size:1rem;border:0;margin:0 0 .3em">On this page</h2>${t.toc}</nav>` : ''}
${t.body}
</main>
</body>
</html>
`;
  }

  /* ------------------------------------------------------------------
     knitting: a new R, knitr, markdown
     ------------------------------------------------------------------ */
  const R_KNIT = String.raw`
.wb_knit <- function(input, kind = "rmd") {
  w <- get("wb", envir = as.environment("tools:workbench"))
  stem <- tools::file_path_sans_ext(basename(input))
  tmp <- tempfile("knit")
  dir.create(tmp)
  # (the Markdown is written next to the document, as rmarkdown does, and removed when the page is made)
  md <- paste0(stem, ".knit.md")
  on.exit(unlink(md), add = TRUE)
  frag <- file.path(tmp, paste0(stem, ".body.html"))
  # (the plots go into the page as pictures: knitr's image_uri; the folder of the pictures is a temporary one)
  knitr::opts_knit$set(upload.fun = knitr::image_uri, rmarkdown.pandoc.to = "html", progress = TRUE, verbose = FALSE)
  # (as rmarkdown::render and Quarto: an error in a chunk stops the knitting – knitr::knit on its own would go on)
  knitr::opts_chunk$set(fig.path = file.path(tmp, paste0(stem, "_files"), "figure-html", ""), dev = "png", dpi = 96, fig.retina = 2,
                        fig.width = 7, fig.height = 5, comment = if (kind == "quarto") "#>" else "##", message = TRUE, warning = TRUE,
                        error = FALSE)
  ok <- tryCatch({
    knitr::knit(input, output = md, quiet = FALSE, envir = new.env(parent = globalenv()))
    TRUE
  }, error = function(e) {
    cl <- conditionCall(e)
    msg <- conditionMessage(e)
    cat(if (is.null(cl)) paste0("Error: ", msg) else paste0("Error in ", paste(deparse(cl, nlines = 1L), collapse = ""), ":\n! ", msg), "\n", sep = "", file = stderr())
    FALSE
  })
  if (!ok) {
    cat("Execution halted\n", file = stderr())
    return(invisible(w$send("knit", ok = FALSE)))
  }
  html <- markdown::mark(md, format = "html")
  writeLines(html, frag, useBytes = TRUE)
  front <- tryCatch(xfun::yaml_body(readLines(md, warn = FALSE, encoding = "UTF-8"))$yaml, error = function(e) list())
  unlink(md)
  for (k in c("title", "subtitle", "date")) if (!is.null(front[[k]])) front[[k]] <- paste(as.character(unlist(front[[k]])), collapse = " ")
  invisible(w$send("knit", ok = TRUE, body = frag, title = if (is.null(front$title)) "" else front$title, subtitle = if (is.null(front$subtitle)) "" else front$subtitle,
                   date = if (is.null(front$date)) "" else front$date, author = w$arr(as.character(unlist(front$author)))))
}
`;
  /** knit an R Markdown document, or render a Quarto document → {ok, output} (the path of the .html). opts.onLog(text,
      stream): what knitting prints, as it prints it; opts.title */
  async function render(path, opts = {}) {
    const fs = MG.app.fs;
    const text = await fs.readText(path);
    const out = outputOf(path, text);
    const log = (t, s) => opts.onLog && opts.onLog(t, s || 'out');
    if (out.kind === 'rmd' && out.format !== 'html_document') {
      log(`The output format ${out.format} needs pandoc (and, for a PDF, LaTeX as well). These programs are not available in the browser, so the document will be knitted to HTML (html_document) instead.\n\n`, 'err');
    }
    if (out.kind === 'quarto' && !/^html/.test(out.format)) log(`The format ${out.format} needs Quarto's own programs, which are not available in the browser, so the document will be rendered to HTML instead.\n\n`, 'err');
    const dir = MG.path.dirname(path);
    const name = MG.path.basename(path);
    const stem = name.replace(/\.[^.]+$/, '');
    const t0 = performance.now();
    let S;
    try {
      S = await MG.R.fresh({ kind: 'knit', graphics: 'none', banner: false, interactive: false, cwd: dir, setup: R_KNIT, sync: true });
    } catch (e) {
      log('R could not start: ' + e.message + '\n', 'err');
      return { ok: false };
    }
    const result = await new Promise((resolve) => {
      let res = null;
      const offs = [];
      const done = (r) => {
        offs.forEach((f) => f());
        resolve(r);
      };
      offs.push(S.on('output', (d) => log(d.text, d.stream)));
      offs.push(S.on('event', (d) => d.event === 'knit' && (res = d)));
      offs.push(S.on('idle', () => done(res || { ok: false })));
      offs.push(S.on('ended', () => done(res || { ok: false })));
      S.send(`.wb_knit(${rstr(name)}, ${rstr(out.kind === 'quarto' ? 'quarto' : 'rmd')})`, { silent: true });
    });
    let output = null;
    if (result && result.ok) {
      let body = '';
      try {
        const bytes = await S.whenIdle((W) => W.FS.readFile(result.body));
        body = new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        body = '';
      }
      const y = Object.assign({}, out.yaml, { title: result.title || out.yaml.title, subtitle: result.subtitle || out.yaml.subtitle, date: result.date || out.yaml.date, author: [].concat(result.author || []).length ? [].concat(result.author) : out.yaml.author });
      body = highlightHtml(body);
      // (knitr's caption "plot of chunk …" where the chunk asked for none: rmarkdown shows no caption then)
      body = body.replace(/<p class="caption">plot of chunk [^<]*<\/p>/g, '');
      const html = out.kind === 'quarto' ? pageQmd(body, y) : pageRmd(body, y, out.opts || {});
      output = dir + '/' + stem + '.html';
      fs.writeText(output, html);
      log(`\n(R's markdown package was used to turn the Markdown into HTML, because pandoc is not available in the browser.)\n\n`);
      log(`Output created: ${stem}.html\n`, 'done');
    }
    S.close(true);
    const secs = (performance.now() - t0) / 1000;
    bus.emit('knit:done', { path, ok: !!output, output, kind: out.kind, secs });
    return { ok: !!output, output, kind: out.kind };
  }

  /* ------------------------------------------------------------------
     an R Notebook's .nb.html: the text, the code and the outputs as they are in the editor
     ------------------------------------------------------------------ */
  function b64(text) {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function mdHtml(md) {
    return MG.renderMarkdownSafe ? MG.renderMarkdownSafe(md) : esc(md);
  }
  /** outputs: chunk index → [{type: 'text', text, stream} | {type: 'plot', src} | {type: 'html', html}] */
  function notebookHtml(path, text, outputs) {
    const fm = splitFrontMatter(text);
    const y = parseYaml(fm.yaml) || {};
    const L = text.split('\n');
    const cs = chunks(text);
    let html = '';
    let at = fm.lines;
    cs.forEach((c, k) => {
      const md = L.slice(at, c.from).join('\n');
      if (md.trim()) html += `<!-- rnb-text-begin -->\n${mdHtml(md)}\n<!-- rnb-text-end -->\n`;
      html += `<!-- rnb-chunk-begin -->\n<pre class="r"><code>${c.lang === 'r' ? highlight(c.code, 'r') : esc(c.code)}</code></pre>\n`;
      for (const o of (outputs && outputs[k]) || []) {
        if (o.type === 'text') html += `<pre class="${o.stream === 'err' ? 'r-message' : 'r-output'}"><code>${esc(o.text)}</code></pre>\n`;
        else if (o.type === 'plot') html += `<p><img src="${esc(o.src)}" alt="Plot"></p>\n`;
        else if (o.type === 'html') html += o.html + '\n';
      }
      html += '<!-- rnb-chunk-end -->\n';
      at = c.to + 1;
    });
    const tail = L.slice(at).join('\n');
    if (tail.trim()) html += `<!-- rnb-text-begin -->\n${mdHtml(tail)}\n<!-- rnb-text-end -->\n`;
    const title = y.title != null ? String(y.title) : MG.path.basename(path);
    const css = RMD_CSS + TOK_CSS + `pre.r{background:#f8f8f8;border-color:#e5e5e5}pre.r-output{background:#fff;border-color:#e5e5e5}pre.r-message{background:#fff;border-color:#f3d1d1;color:#a94442}.nb-note{color:#777;font-size:12px;margin:0 0 18px}`;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="generator" content="R Notebook, in the workbench">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="container-fluid main-container">
<div id="header"><h1 class="title toc-ignore">${esc(title)}</h1>${asList(y.author).map((a) => `<h4 class="author">${esc(a)}</h4>`).join('')}${y.date != null ? `<h4 class="date">${esc(y.date)}</h4>` : ''}</div>
<p class="nb-note">This is an R Notebook. The outputs shown are from the last time each chunk was run in RStudio. No code was run again to make this file.</p>
${html}
</div>
<div id="rmd-source-code" style="display:none">${b64(text)}</div>
</body>
</html>
`;
  }

  MG.Knit = { render, notebookHtml, frontMatter, splitFrontMatter, parseYaml, outputOf, docKind, chunks, highlight, highlightHtml };
})();
