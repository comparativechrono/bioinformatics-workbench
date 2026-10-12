/* Metagenomics in the terminal: Kraken2 2.17.2 and Bracken 3.1.

   kraken2, kraken2-inspect, kraken2-build
       Kraken2's commands are scripts upstream (Perl, and the shell script build_kraken2_db.sh) around its compiled
       programs: classify, dump_table, estimate_capacity, build_db. Here the terminal does what the scripts do – the
       options as Perl's Getopt::Long reads them, the search for the database, the checks and messages, the lines that
       kraken2-build prints – and genomics-wasm's translation of the scripts (kraken2.mjs, unchanged: the options of the
       compiled programs, gzip input, the capacity of a new database) runs the compiled programs, each in a worker of
       its own, through ToolRunner of the index.mjs next to it (see there).
   bracken, bracken-build, est_abundance.py, generate_kmer_distribution.py, kmer2read_distr
       Bracken's commands are shell scripts upstream around two Python programs and one compiled program. Here the
       terminal does what the scripts do (their options, checks, messages and steps), and runs the programs: the Python
       ones in the Python that comes with them (Pyodide 314, shared with Cutadapt – python-worker.mjs), kmer2read_distr
       and Kraken2 as compiled programs.
   Each program runs in a worker of its own (tools-wasm.js: OWN_WORKER, execWorker), with the files it needs; what it
   makes comes back into the terminal's files. Where an upstream script ends with status 0 after an error (Bracken's,
   on a missing database or report), the status here is 2.

   Licence: the help texts, messages and steps of Bracken's scripts (bracken, bracken-build) in this file are
   Bracken's (Copyright (C) 2016-2023 Jennifer Lu; GNU General Public License version 3 or later –
   assets/vendor/genomics-wasm/bracken/3.1/LICENSE; the source is in assets/vendor/licenses/sources/), so this file is
   distributed under the GNU GPL version 3 or later. Kraken2's texts are under Kraken2's MIT licence
   (assets/vendor/genomics-wasm/kraken2/2.17.2/LICENSE).
   SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  const MG = window.MG;
  const T = (MG.shellTools = MG.shellTools || {});
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');
  const vendor = (rel) => new URL(String(MG.config.threadsBase || 'assets/vendor/genomics-wasm').replace(/\/?$/, '/') + rel, location.href);
  const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const K2 = 'kraken2/2.17.2/';
  const BR = 'bracken/3.1/';
  const PYTHON = { worker: 'assets/js/python-worker.mjs', pyodide: 'pyodide/314.0.7/', module: BR + 'manifest.json' };
  const KRAKEN_VERSION = 'Kraken version 2.17.1\nCopyright 2013-2023, Derrick Wood (dwood@cs.jhu.edu)\n';
  const BRACKEN_VERSION = '3.0.1';

  /* ------------------------------------------------------------------ what a command prints, in order */
  const concat = (parts) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return all;
  };
  class Out {
    constructor() { this.parts = []; }
    out(s) { if (s && s.length) this.parts.push([1, typeof s === 'string' ? enc.encode(s) : s]); }
    err(s) { if (s && s.length) this.parts.push([2, typeof s === 'string' ? enc.encode(s) : s]); }
    // a program's output and messages, in the order it wrote them
    add(r) {
      const ord = r.order && r.order.length ? r.order : [1, r.stdout.length, 2, r.stderr.length];
      let i1 = 0, i2 = 0;
      for (let k = 0; k < ord.length; k += 2) {
        const n = ord[k + 1];
        if (ord[k] === 1) { this.out(r.stdout.subarray(i1, i1 + n)); i1 += n; } else { this.err(r.stderr.subarray(i2, i2 + n)); i2 += n; }
      }
      if (i1 < r.stdout.length) this.out(r.stdout.subarray(i1));
      if (i2 < r.stderr.length) this.err(r.stderr.subarray(i2));
    }
    result(exitCode, files = []) {
      const order = [];
      for (const [fd, b] of this.parts) {
        const n = order.length;
        if (n && order[n - 2] === fd) order[n - 1] += b.length; else order.push(fd, b.length);
      }
      return { exitCode, stdout: concat(this.parts.filter((p) => p[0] === 1).map((p) => p[1])), stderr: concat(this.parts.filter((p) => p[0] === 2).map((p) => p[1])), order, files };
    }
  }
  class Stop extends Error { constructor(code) { super('stop'); this.code = code; } }

  /* ------------------------------------------------------------------ options, as the scripts read them */
  // Perl's Getopt::Long, as Kraken2's scripts use it: --name or -name, a unique beginning of a name, any case,
  // --name=value; values s (text, which may begin with -), i (a whole number), f (a number); ! (--no-name too).
  // An unknown, ambiguous or faulty option is warned about and left out, as Perl does; help and version are
  // carried out where they come.
  function getopt(args, spec) {
    const names = Object.keys(spec);
    const opts = {}, rest = [], warn = [];
    let ok = true;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { rest.push(...args.slice(i + 1)); break; }
      if (a === '-' || !a.startsWith('-')) { rest.push(a); continue; }
      let body = a.replace(/^--?/, ''), value = null;
      const eq = body.indexOf('=');
      if (eq >= 0) { value = body.slice(eq + 1); body = body.slice(0, eq); }
      const low = body.toLowerCase();
      let cands = names.filter((n) => n === low), neg = false;
      if (!cands.length) cands = names.filter((n) => n.startsWith(low));
      if (!cands.length && /^no-?./.test(low)) {
        const b = low.replace(/^no-?/, '');
        const c = names.filter((n) => spec[n] === '!' && (n === b || n.startsWith(b)));
        if (c.length) { cands = c; neg = true; }
      }
      if (cands.length > 1) { warn.push(`Option ${low} is ambiguous (${cands.sort().join(', ')})`); ok = false; continue; }
      if (!cands.length) { warn.push(`Unknown option: ${low}`); ok = false; continue; }
      const name = cands[0], type = spec[name];
      if (type === 'help' || type === 'version') return { action: type, opts, rest, warn, ok };
      if (type === '' || type === '!') {
        if (value !== null) { warn.push(`Option ${name} does not take an argument`); ok = false; continue; }
        opts[name] = !neg;
        continue;
      }
      if (value === null) {
        if (i + 1 >= args.length) { warn.push(`Option ${name} requires an argument`); ok = false; continue; }
        value = args[++i];
      }
      if (type === 'i' && !/^[-+]?\d+$/.test(value)) { warn.push(`Value "${value}" invalid for option ${name} (number expected)`); ok = false; continue; }
      if (type === 'f' && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) { warn.push(`Value "${value}" invalid for option ${name} (real number expected)`); ok = false; continue; }
      opts[name] = type === 'i' ? parseInt(value, 10) : type === 'f' ? Number(value) : value;
    }
    return { action: null, opts, rest, warn, ok };
  }
  // bash's getopts, as Bracken's scripts use it: -x VALUE or -xVALUE, letters together (-vt 5); it stops at the first
  // word that is not an option. An unknown option, or one without its value, ends in the script's usage.
  function getopts(args, letters, prog, stopAt = 'v') {
    const opts = {}, order = [];
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { i++; break; }
      if (!a.startsWith('-') || a === '-') break;
      for (let k = 1; k < a.length; k++) {
        const c = a[k], at = letters.indexOf(c);
        if (at < 0) return { bad: `${prog}: illegal option -- ${c}\n`, opts, order };
        if (letters[at + 1] === ':') {
          let v = a.slice(k + 1);
          if (!v) {
            if (i + 1 >= args.length) return { bad: `${prog}: option requires an argument -- ${c}\n`, opts, order };
            v = args[++i];
          }
          opts[c] = v;
          order.push(c);
          break;
        }
        opts[c] = true;
        order.push(c);
        // (the scripts end where they meet -v: what comes after it is not read)
        if (c === stopAt) return { bad: null, opts, order, rest: [] };
      }
    }
    return { bad: null, opts, order, rest: args.slice(i) };
  }
  // an unquoted $VARIABLE in a shell script: its words (an empty one is none)
  const words = (v) => String(v == null ? '' : v).split(/[ \t\n]+/).filter(Boolean);
  // the time a step took, as Kraken2's build script prints it: 1h2m3.456s
  function took(ms) {
    let s = ms / 1000;
    const hr = Math.floor(s / 3600), min = Math.floor((s % 3600) / 60);
    s -= hr * 3600 + min * 60;
    return (hr ? hr + 'h' : '') + (min || hr ? min + 'm' : '') + s.toFixed(3) + 's';
  }

  /* ------------------------------------------------------------------ one program, in a worker of its own */
  // → what genomics-wasm's ToolRunner returns – {exitCode, stdout, stderr, order, files, missingOutputs}: of the files
  // the program made or changed, those it was asked for (outputs, and those below outputDirectories); all it made
  // below the folders of its arguments, when `all` is set. Each run is noted in `log` (program, result, time).
  async function runProgram(h, T, args, { files = [], outputs = [], outputDirectories = [], stdin = null, roots = null, all = false, log = null, stage = null } = {}) {
    const want = new Set(outputs);
    const top = roots || [...new Set([...outputs.map(dirname), ...outputDirectories])];
    // (a folder the program writes into is there for it, when it is there in the terminal)
    const dirs = [...new Set([h.cwd, ...top.filter((d) => d !== '/' && h.isDir(d))])];
    h.stage(stage || T.name);
    const t0 = performance.now();
    const r = await h.spawn(T, { args, thisProgram: T.name, files, stdin: stdin && stdin.length ? stdin : null, roots: top, dirs });
    const ms = performance.now() - t0;
    if (r.error) throw new Error(`${T.name}: ${r.error}`);
    const made = r.files.filter((f) => all || want.has(f.path) || outputDirectories.some((d) => f.path.startsWith(d + '/')));
    const have = new Set([...made.map((f) => f.path), ...files.map((f) => f.path)]);
    const missingOutputs = [...outputs.filter((p) => !have.has(p)), ...outputDirectories.filter((d) => ![...have].some((p) => p.startsWith(d + '/')))];
    const res = { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, order: r.order || [], files: made, missingOutputs };
    if (log) log.push({ program: T.name, args, result: res, ms });
    return res;
  }
  // Kraken2's compiled programs, for genomics-wasm's Kraken2Runner (kraken2.mjs) – through index.mjs next to it
  async function kraken2Runner(h, log, label) {
    const [mod, ws] = await Promise.all([import(vendor(K2 + 'kraken2.mjs').href), import(vendor(K2 + 'index.mjs').href)]);
    ws.setWorkspace(h.cwd);
    const base = vendor('').href;
    ws.setRunner((moduleUrl, args, o) => {
      const href = String(moduleUrl);
      if (!href.startsWith(base)) throw new Error('kraken2: not a program of the workbench: ' + href);
      const module = href.slice(base.length), program = module.split('/').pop().replace(/\.mjs$/, '');
      return runProgram(h, { name: program, module }, args, { ...o, log, stage: (label || 'kraken2') + ' – ' + program });
    });
    return { runner: new mod.Kraken2Runner({ baseUrl: vendor(K2) }), ws };
  }
  // the files of a folder (all of them, with what is in them), sorted by name
  async function folderFiles(h, dir) {
    return (await h.inputsOf([dir], [])).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  const exists = (h, p) => h.isFile(h.abs(p)) || h.isDir(h.abs(p));
  const envOf = (ctx, names) => Object.fromEntries(names.filter((n) => ctx.env && typeof ctx.env[n] === 'string').map((n) => [n, ctx.env[n]]));

  /* ------------------------------------------------------------------ Kraken2 */
  // the usage texts of Kraken2's scripts, as they are (their $NAMES are filled in when they are shown)
  const USAGE_KRAKEN2 = "Usage: $PROG [options] <filename(s)>\n\nOptions:\n  --db NAME               Name for Kraken 2 DB\n                          (default: $default_db)\n  --threads NUM           Number of threads (default: $def_thread_ct)\n  --quick                 Quick operation (use first hit or hits)\n  --unclassified-out FILENAME\n                          Print unclassified sequences to filename\n  --classified-out FILENAME\n                          Print classified sequences to filename\n  --output FILENAME       Print output to filename (default: stdout); \"-\" will\n                          suppress normal output\n  --confidence FLOAT      Confidence score threshold (default: 0.0); must be\n                          in [0, 1].\n  --minimum-base-quality NUM\n                          Minimum base quality used in classification (def: 0,\n                          only effective with FASTQ input).\n  --report FILENAME       Print a report with aggregrate counts/clade to file\n  --use-mpa-style         With --report, format report output like Kraken 1's\n                          kraken-mpa-report\n  --report-zero-counts    With --report, report counts for ALL taxa, even if\n                          counts are zero\n  --report-minimizer-data With --report, report minimizer and distinct minimizer\n                          count information in addition to normal Kraken report\n  --memory-mapping        Avoids loading database into RAM\n  --paired                The filenames provided have paired-end reads\n  --use-names             Print scientific names instead of just taxids\n  --gzip-compressed       Input files are compressed with gzip\n  --bzip2-compressed      Input files are compressed with bzip2\n  --minimum-hit-groups NUM\n                          Minimum number of hit groups (overlapping k-mers\n                          sharing the same minimizer) needed to make a call\n                          (default: $minimum_hit_groups)\n  --help                  Print this message\n  --version               Print version information\n\nIf none of the *-compressed flags are specified, and the filename provided\nis a regular file, automatic format detection is attempted.\n";
  const USAGE_INSPECT = "Usage: $PROG [options]\n\nOptions:\n  --db NAME               Name for Kraken 2 DB\n                          (default: $default_db)\n  --threads NUM           Number of threads to use\n  --skip-counts           Only print database summary statistics\n  --use-mpa-style         Format output like Kraken 1's kraken-mpa-report\n  --report-zero-counts    Report counts for ALL taxa, even if\n                          counts are zero\n  --help                  Print this message\n  --version               Print version information\n";
  const USAGE_BUILD = "Usage: $PROG [task option] [options]\n\nTask options (exactly one must be selected):\n  --download-taxonomy        Download NCBI taxonomic information\n  --download-library TYPE    Download partial library\n                             (TYPE = one of \"archaea\", \"bacteria\", \"plasmid\",\n                             \"viral\", \"human\", \"fungi\", \"plant\", \"protozoa\",\n                             \"nr\", \"nt\", \"UniVec\", \"UniVec_Core\")\n  --special TYPE             Download and build a special database\n                             (TYPE = one of \"greengenes\", \"silva\", \"rdp\")\n  --add-to-library FILE      Add FILE to library\n  --build                    Create DB from library\n                             (requires taxonomy d/l'ed and at least one file\n                             in library)\n  --clean                    Remove unneeded files from a built database\n  --standard                 Download and build default database\n  --help                     Print this message\n  --version                  Print version information\n\nOptions:\n  --db NAME                  Kraken 2 DB name (mandatory except for\n                             --help/--version)\n  --threads #                Number of threads (def: 1)\n  --kmer-len NUM             K-mer length in bp/aa (build task only;\n                             def: 35 nt, 15 aa)\n  --minimizer-len NUM        Minimizer length in bp/aa (build task only;\n                             def: 31 nt, 12 aa)\n  --minimizer-spaces NUM     Number of characters in minimizer that are\n                             ignored in comparisons (build task only;\n                             def: 7 nt, 0 aa)\n  --protein                  Build a protein database for translated search\n  --no-masking               Used with --standard/--download-library/\n                             --add-to-library to avoid masking low-complexity\n                             sequences prior to building; masking requires\n                             dustmasker or segmasker to be installed in PATH,\n                             which some users might not have.\n  --max-db-size NUM          Maximum number of bytes for Kraken 2 hash table;\n                             if the estimator determines more would normally be\n                             needed, the reference library will be downsampled\n                             to fit. (Used with --build/--standard/--special)\n  --use-ftp                  Use FTP for downloading instead of RSYNC; used with\n                             --download-library/--download-taxonomy/--standard.\n  --skip-maps                Avoids downloading accession number to taxid maps,\n                             used with --download-taxonomy.\n  --load-factor FRAC         Proportion of the hash table to be populated\n                             (build task only; def: 0.7, must be\n                             between 0 and 1).\n  --fast-build               Do not require database to be deterministically\n                             built when using multiple threads.  This is faster,\n                             but does introduce variability in minimizer/LCA\n                             pairs.  Used with --build and --standard options.\n";
  const K2_ENV = ['KRAKEN2_DEFAULT_DB', 'KRAKEN2_DB_PATH', 'KRAKEN2_NUM_THREADS'];
  class Die extends Error { constructor(message, code) { super(message); this.code = code; } }
  // kraken2lib::find_db: --db NAME (or $KRAKEN2_DEFAULT_DB); a NAME without a slash is looked for in the folders of
  // $KRAKEN2_DB_PATH (default: .); the database needs taxo.k2d, hash.k2d and opts.k2d
  function findDb(h, supplied, env) {
    if (supplied == null) {
      if (env.KRAKEN2_DEFAULT_DB == null) throw new Die('Must specify DB with either --db or $KRAKEN2_DEFAULT_DB', 255);
      supplied = env.KRAKEN2_DEFAULT_DB;
    }
    let prefix = null;
    if (supplied.includes('/')) prefix = supplied;
    else {
      let path = ['.'];
      if (env.KRAKEN2_DB_PATH != null) path = env.KRAKEN2_DB_PATH.replace(/^:/, '.:').replace(/:$/, ':.').replace(/::/, ':.:').split(':');
      for (const dir of path) {
        const c = dir + '/' + supplied;
        if (h.isDir(h.abs(c))) { prefix = c; break; }
      }
      if (prefix == null) throw new Die(`unable to find ${supplied} in $KRAKEN2_DB_PATH (${env.KRAKEN2_DB_PATH != null ? '"' + env.KRAKEN2_DB_PATH + '"' : 'undefined'})`, 2);
    }
    for (const f of ['taxo.k2d', 'hash.k2d', 'opts.k2d']) {
      if (!exists(h, prefix + '/' + f)) throw new Die(`database ("${prefix}") does not contain necessary file ${f}`, 2);
    }
    return prefix;
  }
  function defaultDb(h, env) {
    try { return '"' + findDb(h, null, env) + '"'; } catch (e) { return 'none'; }
  }
  const threadsOf = (opts, env) => (opts.threads != null ? opts.threads : Number(env.KRAKEN2_NUM_THREADS) || 1);
  function oneThread(h, prog, n) {
    if (n !== 1 && h.io && h.io.note) h.io.note(`${prog}: --threads ${n} left out – in the browser Kraken2 runs on one thread.`);
  }
  // a message of genomics-wasm's runner (status 64): in the program's words
  const runnerMessage = (prog, r) => (r.exitCode === 64 && !r.files.length ? `${prog}: ${dec.decode(r.stderr).trim()}\n` : null);

  const K2_SPEC = {
    help: 'help', version: 'version', db: 's', threads: 'i', quick: '', 'unclassified-out': 's', 'classified-out': 's',
    output: 's', confidence: 'f', 'memory-mapping': '', paired: '', 'use-names': '', 'gzip-compressed': '',
    'bzip2-compressed': '', 'only-classified-output': '', 'minimum-base-quality': 'i', report: 's', 'use-mpa-style': '',
    'report-zero-counts': '', 'minimum-hit-groups': 'i', 'report-minimizer-data': ''
  };
  async function classify(args, h, o) {
    const prog = h.name || 'kraken2', env = h.opts.env || {}, out = new Out();
    const g = getopt(args, K2_SPEC);
    for (const w of g.warn) out.err(w + '\n');
    const usage = (code) => {
      out.err(USAGE_KRAKEN2.replace('$PROG', prog).replace('$default_db', defaultDb(h, env)).replace('$def_thread_ct', String(Number(env.KRAKEN2_NUM_THREADS) || (env.KRAKEN2_NUM_THREADS != null ? 0 : 1)))
        .replace('$minimum_hit_groups', String(g.opts['minimum-hit-groups'] != null ? g.opts['minimum-hit-groups'] : 2)));
      return out.result(code);
    };
    if (g.action === 'help') return usage(0);
    if (g.action === 'version') { out.out(KRAKEN_VERSION); return out.result(0); }
    const opts = g.opts, threads = threadsOf(opts, env);
    if (!g.rest.length) { out.err('Need to specify input filenames!\n'); return usage(64); }
    let db;
    try { db = findDb(h, opts.db, env); } catch (e) { if (!(e instanceof Die)) throw e; out.err(`${prog}: ${e.message}\n`); return out.result(e.code); }
    const die = (m) => { out.err(`${prog}: ${m}\n`); return out.result(255); };
    if (opts.paired && (g.rest.length % 2 !== 0 || !g.rest.length)) return die('--paired requires positive and even number filenames');
    if (opts['gzip-compressed'] && opts['bzip2-compressed']) return die("can't use both gzip and bzip2 compression flags");
    const confidence = opts.confidence != null ? opts.confidence : 0;
    if (confidence < 0) return die('confidence threshold must be nonnegative');
    if (confidence > 1) return die('confidence threshold must be no greater than 1');
    const groups = opts['minimum-hit-groups'] != null ? opts['minimum-hit-groups'] : 2;
    if (groups < 0) return die('minimum number of hit groups must be nonnegative');
    // (upstream's classify reads a file that is not there as no reads at all, and says 0 sequences: here it is an error.
    // - is such a file name too – for the standard input, give /dev/stdin, as upstream. /dev/null: no reads)
    const stdinName = (f) => f === '/dev/stdin' || f === '/dev/fd/0' || f === '/proc/self/fd/0' || f === '/dev/null';
    for (const f of g.rest) {
      if (!stdinName(f) && !h.isFile(h.abs(f))) { out.err(`${prog}: ${f} does not exist!${f === '-' ? ' (the standard input is /dev/stdin)' : ''}\n`); return out.result(2); }
    }
    oneThread(h, prog, threads);
    const input = g.rest.some((f) => stdinName(f) && f !== '/dev/null') ? h.stdin || new Uint8Array(0) : new Uint8Array(0);
    const files = await h.inputsOf([...g.rest.filter((f) => !stdinName(f)), ...['taxo.k2d', 'hash.k2d', 'opts.k2d'].map((f) => db + '/' + f)], []);
    const first = stdinName(g.rest[0]) ? input : (files.find((f) => f.path === h.abs(g.rest[0])) || {}).data;
    if (opts['bzip2-compressed'] || (first && first[0] === 0x42 && first[1] === 0x5a && first[2] === 0x68)) {
      out.err(`${prog}: bzip2-compressed reads cannot be read here – give them uncompressed, or compressed with gzip (on your computer: bunzip2 FILE.bz2, or gzip FILE).\n`);
      return out.result(1);
    }
    const ra = ['--db', h.abs(db), '--threads', '1'];
    for (const k of ['quick', 'paired', 'use-names', 'use-mpa-style', 'report-zero-counts', 'report-minimizer-data', 'memory-mapping', 'gzip-compressed']) if (opts[k]) ra.push('--' + k);
    ra.push('--confidence', String(confidence), '--minimum-base-quality', String(opts['minimum-base-quality'] || 0), '--minimum-hit-groups', String(groups));
    for (const k of ['report', 'output', 'classified-out', 'unclassified-out']) if (opts[k] != null) ra.push('--' + k, opts[k]);
    // (the runner reads its standard input where it is given -)
    ra.push(...g.rest.map((f) => (stdinName(f) ? '-' : f)));
    const { runner } = await kraken2Runner(h, null, prog);
    const r = await runner.run(ra, { files, stdin: input });
    const said = runnerMessage(prog, r);
    if (said) { out.err(said); return out.result(64); }
    out.add(r);
    if (o && o.capture) return { ...out.result(r.exitCode, r.files), raw: r };
    return out.result(r.exitCode, r.files);
  }

  const INSPECT_SPEC = { help: 'help', version: 'version', db: 's', 'skip-counts': '', 'use-mpa-style': '', 'report-zero-counts': '', threads: 'i' };
  async function inspect(args, h) {
    const prog = h.name || 'kraken2-inspect', env = h.opts.env || {}, out = new Out();
    const g = getopt(args, INSPECT_SPEC);
    for (const w of g.warn) out.err(w + '\n');
    const usage = (code) => { out.err(USAGE_INSPECT.replace('$PROG', prog).replace('$default_db', defaultDb(h, env))); return out.result(code); };
    if (g.action === 'help') return usage(0);
    if (g.action === 'version') { out.out(KRAKEN_VERSION); return out.result(0); }
    if (g.rest.length) return usage(64);
    let db;
    try { db = findDb(h, g.opts.db, env); } catch (e) { if (!(e instanceof Die)) throw e; out.err(`${prog}: ${e.message}\n`); return out.result(e.code); }
    oneThread(h, prog, threadsOf(g.opts, env));
    const files = await h.inputsOf(['taxo.k2d', 'hash.k2d', 'opts.k2d'].map((f) => db + '/' + f), []);
    const ra = ['inspect', '--db', h.abs(db), '--threads', '1'];
    for (const k of ['skip-counts', 'use-mpa-style', 'report-zero-counts']) if (g.opts[k]) ra.push('--' + k);
    const { runner } = await kraken2Runner(h, null, prog);
    const r = await runner.run(ra, { files });
    const said = runnerMessage(prog, r);
    if (said) { out.err(said); return out.result(64); }
    out.add(r);
    return out.result(r.exitCode);
  }

  const BUILD_SPEC = {
    help: 'help', version: 'version', db: 's', threads: 'i', 'minimizer-len': 'i', 'kmer-len': 'i', 'minimizer-spaces': 'i',
    protein: '', masking: '!', 'max-db-size': 'i', 'use-ftp': '', 'skip-maps': '', 'load-factor': 'f', 'fast-build': '',
    'block-size': 'i', 'subblock-size': 'i', 'minimum-bits-for-taxid': 'i', 'download-taxonomy': '', 'download-library': 's',
    'add-to-library': 's', build: '', standard: '', clean: '', special: 's'
  };
  const TASKS = ['download-taxonomy', 'download-library', 'add-to-library', 'build', 'standard', 'clean', 'special'];
  async function build(args, h) {
    const prog = h.name || 'kraken2-build', env = h.opts.env || {}, out = new Out();
    const g = getopt(args, BUILD_SPEC);
    for (const w of g.warn) out.err(w + '\n');
    const usage = (code) => { out.err(USAGE_BUILD.replace('$PROG', prog)); return out.result(code); };
    if (g.action === 'help') return usage(0);
    if (g.action === 'version') { out.out(KRAKEN_VERSION); return out.result(0); }
    if (!g.ok) return usage(64);
    const o = g.opts;
    const db = o.db != null ? o.db : env.KRAKEN2_DB_NAME;
    const threads = o.threads != null ? o.threads : Number(env.KRAKEN2_THREAD_CT) || 1;
    const loadFactor = o['load-factor'] != null ? o['load-factor'] : 0.7;
    const protein = !!o.protein;
    const k = o['kmer-len'] != null ? o['kmer-len'] : protein ? 15 : 35;
    const l = o['minimizer-len'] != null ? o['minimizer-len'] : protein ? 12 : 31;
    const block = o['block-size'] != null ? o['block-size'] : 16384;
    if ((o['subblock-size'] || 0) === 0 && threads === 0) { out.err(`Illegal division by zero at /usr/bin/${prog} line 137.\n`); return out.result(255); }
    if (g.rest.length) { out.err('Extra arguments on command line.\n'); return usage(64); }
    const tasks = TASKS.filter((t) => o[t] != null && o[t] !== false);
    if (tasks.length > 1) { out.err('More than one task option selected.\n'); return usage(64); }
    if (!tasks.length) { out.err('Must select a task option.\n'); return usage(64); }
    const die = (m) => { out.err(m + '\n'); return out.result(255); };
    if (db == null) return die('Must specify a database name');
    if (threads <= 0) return die(`Can't use nonpositive thread count of ${threads}`);
    if (l > k) return die(`Minimizer length (${l}) must not be greater than k (${k})`);
    if (l <= 0) return die(`Can't use nonpositive minimizer length of ${l}`);
    if (l > 31) return die(`Can't use minimizer len of ${l} (must be <= 31)`);
    if (loadFactor <= 0) return die(`Can't have nonnegative load factor of ${loadFactor}`);
    if (loadFactor > 1) return die(`Can't have load factor of ${loadFactor} (must be no more than 1.0).`);
    const task = tasks[0];
    if (['download-taxonomy', 'download-library', 'standard', 'special'].includes(task)) {
      out.err(`${prog}: --${task} is not available here: it downloads NCBI's taxonomy and genomes (tens of gigabytes, over rsync or FTP), which a web page cannot do – and a database that large would not fit in the browser. Build a small database from sequences and a taxonomy you have (kraken2-build --build), or use the example: /data/examples/metagenomics/db (see the help page Metagenomics).\n`);
      return out.result(1);
    }
    if (task === 'add-to-library') {
      out.err(`${prog}: --add-to-library is not available here. Put the sequences into DB/library/ yourself (a FASTA file ending in .fna), and the taxonomy ID of each sequence into DB/seqid2taxid.map (sequence ID, a tab, taxonomy ID), with the taxonomy in DB/taxonomy/ (nodes.dmp, names.dmp); then kraken2-build --build --db DB.\n`);
      return out.result(1);
    }
    const dbAbs = h.abs(db);
    if (task === 'clean') {
      if (!h.isDir(dbAbs)) { out.err(`/usr/libexec/kraken2/clean_db.sh: line 13: cd: ${db}: No such file or directory\n`); return out.result(1); }
      const all = await folderFiles(h, dbAbs);
      if (dbAbs.startsWith('/data/')) {
        out.err(`Database disk usage: ${humanSize(all.reduce((n, f) => n + Math.ceil(f.data.length / 4096) * 4096, 0))}\nrm: cannot remove 'library/': Read-only file system\n`);
        return out.result(1);
      }
      // (du -sh: the disk blocks of the files and of their folders)
      const size = (list) => list.reduce((n, f) => n + Math.ceil(f.data.length / 4096) * 4096, 0) + 4096 * new Set(list.map((f) => dirname(f.path))).size;
      const gone = all.filter((f) => /^(library|taxonomy)\//.test(f.path.slice(dbAbs.length + 1)) || f.path === dbAbs + '/seqid2taxid.map');
      out.err(`Database disk usage: ${humanSize(size(all))}\n`);
      out.err(`After cleaning, database uses ${humanSize(size(all.filter((f) => !gone.includes(f))))}\n`);
      const r = out.result(0);
      r.remove = [dbAbs + '/library', dbAbs + '/taxonomy', dbAbs + '/seqid2taxid.map'].filter((p) => h.isDir(p) || h.isFile(p));
      return r;
    }
    // --build: build_kraken2_db.sh
    const start = performance.now();
    if (!h.isDir(dbAbs)) { out.out(`Can't find Kraken 2 DB directory "${db}"\n`); return out.result(1); }
    if (!h.isDir(dbAbs + '/taxonomy')) { out.out("Can't find taxonomy/ subdirectory in database directory, exiting.\n"); return out.result(1); }
    if (!h.isDir(dbAbs + '/library')) { out.out("Can't find library/ subdirectory in database directory, exiting.\n"); return out.result(1); }
    out.out('Creating sequence ID to taxonomy ID map (step 1)...\n');
    if (!exists(h, dbAbs + '/seqid2taxid.map')) { out.out('No preliminary seqid/taxid mapping files found, aborting.\n'); return out.result(1); }
    out.out('Sequence ID to taxonomy ID map already present, skipping map creation.\n');
    const files = await folderFiles(h, dbAbs);
    const lib = files.filter((f) => f.path.startsWith(dbAbs + '/library/') && /\.(fna|faa)$/.test(f.path));
    if (!lib.length) {
      out.out('Estimating required capacity (step 2)...\n');
      out.err(`${prog}: there are no sequences in ${db}/library/ – files ending in .fna (DNA), or .faa for a protein database (--protein).\n`);
      return out.result(1);
    }
    for (const f of ['nodes.dmp', 'names.dmp']) {
      if (!h.isFile(dbAbs + '/taxonomy/' + f)) { out.out('Estimating required capacity (step 2)...\n'); out.err(`build_db: error opening taxonomy//${f}: No such file or directory\n`); return out.result(66); }
    }
    oneThread(h, prog, threads);
    // (the library first, by name, then the other files: the order in which the sequences are read)
    const ordered = [...lib, ...files.filter((f) => !lib.includes(f))];
    const ra = ['build', '--db', dbAbs, '--threads', '1', '--no-masking', '--kmer-len', String(k), '--minimizer-len', String(l),
      '--minimizer-spaces', String(o['minimizer-spaces'] != null ? o['minimizer-spaces'] : protein ? 0 : 7), '--load-factor', String(loadFactor),
      '--block-size', String(block), '--minimum-bits-for-taxid', String(o['minimum-bits-for-taxid'] || 0)];
    if (o['subblock-size']) ra.push('--subblock-size', String(o['subblock-size']));
    if (o['max-db-size'] != null) ra.push('--max-db-size', String(o['max-db-size']));
    if (protein) ra.push('--protein');
    if (o['fast-build']) ra.push('--fast-build');
    const log = [];
    const { runner } = await kraken2Runner(h, log, prog);
    const r = await runner.run(ra, { files: ordered.map((f) => ({ path: f.path, data: f.data })) });
    const said = runnerMessage(prog, r);
    if (said) { out.err(said); return out.result(64); }
    const est = log.find((s) => s.program === 'estimate_capacity'), made = log.find((s) => s.program === 'build_db');
    out.out('Estimating required capacity (step 2)...\n');
    if (est) out.add({ ...est.result, stdout: new Uint8Array(0), order: [] });
    if (!est || est.result.exitCode !== 0) return out.result(est ? est.result.exitCode : 1);
    out.out(`Estimated hash table requirement: ${r.capacity * 4} bytes\n`);
    if (o['max-db-size'] != null && o['max-db-size'] < r.capacity * 4) out.out(`Specifying lower maximum hash table size of ${o['max-db-size']} bytes\n`);
    out.out(`Capacity estimation complete. [${took(est.ms)}]\n`);
    out.out('Building database files (step 3)...\n');
    if (!made) out.out('Hash table already present, skipping database file build.\n');
    else {
      out.add(made.result);
      if (made.result.exitCode !== 0) return out.result(made.result.exitCode);
      out.out(`Database files completed. [${took(made.ms)}]\n`);
    }
    out.out(`Database construction complete. [Total: ${took(performance.now() - start)}]\n`);
    return out.result(0, made ? r.files.filter((f) => f.path.startsWith(dbAbs + '/')) : []);
  }
  // du -sh
  function humanSize(n) {
    const units = ['K', 'M', 'G', 'T'];
    let v = n / 1024, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)) + units[u];
  }
  async function kraken2(args, h) {
    const mode = h.opts.mode || 'classify';
    if (mode === 'inspect') return inspect(args, h);
    if (mode === 'build') return build(args, h);
    return classify(args, h);
  }

  /* ------------------------------------------------------------------ Bracken */
  const BRACKEN_USAGE = [
    'Usage: bracken -v -d MY_DB -i INPUT -o OUTPUT -w OUTREPORT -r READ_LEN -l LEVEL -t THRESHOLD',
    '  -v             Echoes the current software version and exits',
    '  MY_DB          location of Kraken database',
    '  INPUT          Kraken REPORT file to use for abundance estimation',
    '  OUTPUT         file name for Bracken default output',
    '  OUTREPORT      New Kraken REPORT output file with Bracken read estimates',
    '  READ_LEN       read length to get all classifications for (default: 100)',
    '  LEVEL          level to estimate abundance at [options: D,P,C,O,F,G,S,S1,etc] (default: S)',
    '  THRESHOLD      number of reads required PRIOR to abundance estimation to perform reestimation (default: 0)',
    '', ''].join('\n');
  const BUILD_USAGE = [
    'Usage: bracken_build -v -k KMER_LEN -l READ_LEN -d MY_DB -x K_INSTALLATION -y K_TYPE -t THREADS',
    '  -v             Echoes the current software version and exits',
    '  KMER_LEN       kmer length used to build the kraken database (default: 35)',
    '  THREADS        the number of threads to use when running kraken classification and the bracken scripts',
    '  READ_LEN       read length to get all classifications for (default: 100)',
    '  MY_DB          location of Kraken database',
    '  K_INSTALLATION location of the installed kraken/kraken-build scripts (default assumes scripts can be run from the user path)',
    '  K_TYPE         version of kraken to use (default = kraken2 - other options: kraken, krakenuniq)',
    ''].join('\n');
  // one of Bracken's Python programs, in the Python that comes with it
  function python(h, script, args, o = {}) {
    return runProgram(h, { name: script, ...PYTHON }, [script, ...args], { ...o, stage: o.stage || script });
  }
  const KMER2READ = { name: 'kmer2read_distr', module: BR + 'kmer2read_distr.mjs' };
  // the folders a program may write into: the working folder, and those of the files it is given or asked to write
  const rootsOf = (h, paths) => [...new Set([h.cwd, ...paths.filter((p) => p && p !== '-').map((p) => dirname(h.abs(p)))])];

  async function bracken(args, h) {
    const mode = h.opts.mode || 'bracken';
    if (mode === 'build') return brackenBuild(args, h);
    if (mode === 'program') return brackenProgram(args, h);
    const out = new Out();
    const g = getopts(args, 't:i:o:r:d:w:l:v', '/usr/bin/bracken');
    if (g.bad) { out.err(g.bad); out.out(BRACKEN_USAGE); return out.result(0); }
    if (g.opts.v) { out.out(`Bracken v${BRACKEN_VERSION}\n`); return out.result(0); }
    const o = g.opts;
    const INPUT = o.i || '', OUTPUT = o.o || '', OUTREPORT = o.w || '', READ_LEN = o.r || '100', THRESHOLD = o.t || '10', LEVEL = o.l || 'S';
    let DATABASE = o.d || '';
    if (DATABASE.endsWith('/')) DATABASE = DATABASE.slice(0, -1);
    out.out(' >> Checking for Valid Options...\n');
    // ([ -d $DATABASE ] with nothing in $DATABASE is [ -d ]: true)
    const distrib = `${DATABASE}/database${READ_LEN}mers.kmer_distrib`;
    if (!DATABASE || h.isDir(h.abs(DATABASE))) {
      if (!h.isFile(h.abs(distrib))) {
        out.out(` ERROR: ${distrib} does not exist\n        Run bracken-build to generate the kmer distribution file.\n`);
        return out.result(2);
      }
    } else {
      out.out(` ERROR: Kraken database ${DATABASE} does not exist\n`);
      return out.result(2);
    }
    out.out(' >> Running Bracken \n');
    if (INPUT && !h.isFile(h.abs(INPUT))) {
      out.out(`  ERROR: Input file ${INPUT} does not exist\n         If running kraken v1.0, run kraken-report\n         If running kraken v2.0, run kraken2 with the --report flag\n`);
      return out.result(2);
    }
    out.out(`      >> python src/est_abundance.py -i ${INPUT} -o ${OUTPUT} -k ${distrib} -l ${LEVEL} -t ${THRESHOLD}\n`);
    const pa = ['-i', ...words(INPUT), '-o', ...words(OUTPUT), ...(OUTREPORT ? ['--out-report', ...words(OUTREPORT)] : []),
      '-k', ...words(distrib), '-l', ...words(LEVEL), '-t', ...words(THRESHOLD)];
    const files = await h.inputsOf([INPUT, distrib].filter(Boolean), []);
    const r = await python(h, 'est_abundance.py', pa, { files, roots: rootsOf(h, [INPUT, OUTPUT, OUTREPORT]), all: true });
    out.add(r);
    if (r.exitCode !== 0) return out.result(r.exitCode, r.files);
    out.out('  Bracken complete.\n');
    return out.result(0, r.files);
  }

  async function brackenBuild(args, h) {
    const out = new Out(), files = [];
    const g = getopts(args, 'k:l:d:x:t:y:v', '/usr/bin/bracken-build');
    if (g.bad) { out.err(g.bad); out.out(BUILD_USAGE); return out.result(0); }
    if (g.opts.v) { out.out(`bracken-build.sh v${BRACKEN_VERSION}\n`); return out.result(0); }
    const o = g.opts;
    const THREADS = o.t || '1', KMER_LEN = o.k || '35', READ_LEN = o.l || '100', KTYPE = o.y || 'kraken2';
    let DATABASE = o.d || '', KINSTALL = o.x || '';
    out.out(` >> Selected Options:\n       kmer length = ${KMER_LEN}\n       read length = ${READ_LEN}\n       database    = ${DATABASE}\n       threads     = ${THREADS}\n       kraken type = ${KTYPE}\n`);
    if (DATABASE.endsWith('/')) DATABASE = DATABASE.slice(0, -1);
    const installed = 'User must first specify/install kraken, krakenuniq, or kraken2 and/or specify installation directory of kraken/krakenuniq/kraken2 using -x flag\n';
    if (!KINSTALL) {
      if (KTYPE === 'kraken') { out.out('Kraken not installed. Please specify installation directory using -x flag\n'); return out.result(2); }
      if (KTYPE === 'krakenuniq') { out.out('Krakenuniq not installed. Please specify installation directory using -x flag\n'); return out.result(2); }
      if (KTYPE !== 'kraken2') { out.out(installed); return out.result(2); }
    } else {
      // (kraken2 is in /usr/bin here)
      if (!(KTYPE === 'kraken2' && h.abs(KINSTALL.replace(/\/?$/, '/') + 'kraken2') === '/usr/bin/kraken2')) { out.out(installed); return out.result(2); }
      KINSTALL = KINSTALL.replace(/\/?$/, '/');
    }
    out.out(' >> Checking for Valid Options...\n');
    // (with nothing in $DATABASE, the script's paths begin at /: /library, /taxonomy …)
    const db = DATABASE ? h.abs(DATABASE) : '';
    if (!DATABASE || h.isDir(db)) {
      if (!h.isDir(db + '/library')) { out.out(` ERROR: Database library ${DATABASE}/library does not exist\n`); return out.result(2); }
      if (!h.isDir(db + '/taxonomy')) { out.out(` ERROR : Database taxonomy ${DATABASE}/taxonomy does not exist\n`); return out.result(2); }
      if (!h.isFile(db + '/taxonomy/nodes.dmp')) { out.out(` ERROR: Database taxonomy ${DATABASE}/taxonomy/nodes.dmp does not exist\n`); return out.result(2); }
      if (!h.isFile(db + '/hash.k2d')) { out.out(` ERROR: Kraken2 Database incomplete: ${DATABASE}/hash.k2d does not exist\n`); return out.result(2); }
    } else {
      out.out(` ERROR: Kraken database ${DATABASE} does not exist\n`);
      return out.result(2);
    }
    // (the example data is read-only: the files of the distribution cannot be written there)
    if (db.startsWith('/data/')) {
      out.err(`bracken-build: ${DATABASE}: Read-only file system – bracken-build writes its files into the database folder. Copy the database into your home folder first:  cp -r ${DATABASE} ~/${DATABASE.split('/').pop() || 'db'}\n`);
      return out.result(1);
    }
    if (THREADS !== '1' && h.io && h.io.note) h.io.note(`bracken-build: -t ${THREADS} – in the browser Kraken2 and kmer2read_distr run on one thread.`);
    // what the steps read and write: the files of the database
    const space = new Map((await folderFiles(h, db)).map((f) => [f.path, f.data]));
    const put = (p, data) => { space.set(p, data); files.push({ path: p, data }); };
    out.out(' >> Creating database.kraken [if not found]\n');
    const nonEmpty = (p) => space.has(p) && space.get(p).length > 0;
    if (nonEmpty(db + '/database.kraken')) out.out('          database.kraken exists, skipping creation....\n');
    else if (nonEmpty(db + '/database.kraken.tsv')) {
      out.out('          database.kraken.tsv exists, skipping creation....\n');
      put(db + '/database.kraken', space.get(db + '/database.kraken.tsv'));
    } else {
      const genomes = [...space.keys()].filter((p) => p.startsWith(db + '/library/') && /\.(fna|fa|fasta)$/.test(p)).sort();
      const filenames = genomes.map((p) => (DATABASE ? DATABASE : '') + p.slice(db.length));
      out.out(`      >> ${KINSTALL}kraken2 --db ${DATABASE} --threads ${THREADS} ${filenames.join('\n')} > ${DATABASE}/database.kraken.tmp\n`);
      const hk = Object.assign({}, h, { name: 'kraken2', opts: { env: {} } });
      const r = await classify(['--db', DATABASE || '.', '--threads', '1', ...filenames], hk);
      out.err(r.stderr);
      if (r.exitCode === 0) {
        put(db + '/database.kraken', r.stdout);
        out.out('          Finished creating database.kraken [in DB folder]\n');
      } else {
        out.out('          Unable to create database.kraken [in DB folder]\n');
        return out.result(1, files);
      }
    }
    out.out(` >> Creating database${READ_LEN}mers.kmer_distrib \n`);
    const kmers = `${DATABASE}/database${READ_LEN}mers.kraken`, distrib = `${DATABASE}/database${READ_LEN}mers.kmer_distrib`;
    const inputs = () => [...space].map(([path, data]) => ({ path, data }));
    const r1 = await runProgram(h, KMER2READ, ['--seqid2taxid', `${DATABASE}/seqid2taxid.map`, '--taxonomy', `${DATABASE}/taxonomy/`,
      '--kraken', `${DATABASE}/database.kraken`, '--output', kmers, '-k', KMER_LEN, '-l', READ_LEN, '-t', '1'],
    { files: inputs(), outputs: [h.abs(kmers)] });
    out.add(r1);
    for (const f of r1.files) put(f.path, f.data);
    if (r1.exitCode !== 0) return out.result(r1.exitCode, files);
    const r2 = await python(h, 'generate_kmer_distribution.py', ['-i', kmers, '-o', distrib], { files: inputs(), outputs: [h.abs(distrib)] });
    out.add(r2);
    for (const f of r2.files) put(f.path, f.data);
    if (r2.exitCode !== 0) return out.result(r2.exitCode, files);
    out.out(`          Finished creating database${READ_LEN}mers.kraken and database${READ_LEN}mers.kmer_distrib [in DB folder]\n`);
    out.out('          *NOTE: to create read distribution files for multiple read lengths, \n');
    out.out('                 rerun this script specifying the same database but a different read length\n\n');
    out.out('Bracken build complete.\n');
    return out.result(0, files);
  }

  // est_abundance.py, generate_kmer_distribution.py, kmer2read_distr: Bracken's programs, by themselves
  const PROGRAM_OUTPUTS = {
    'est_abundance.py': ['-o', '--output', '--out-report'],
    'generate_kmer_distribution.py': ['-o', '--output'],
    kmer2read_distr: ['-o', '--output']
  };
  async function brackenProgram(args, h) {
    const name = h.opts.program, out = new Out();
    let a = args.slice();
    if (name === 'kmer2read_distr') {
      // (one thread here: -t N, --threads N)
      a = a.map((v, i) => ((a[i - 1] === '-t' || a[i - 1] === '--threads') && v !== '1' ? (h.io && h.io.note && h.io.note(`kmer2read_distr: ${a[i - 1]} ${v} – in the browser it runs on one thread.`), '1') : v));
    }
    const outs = PROGRAM_OUTPUTS[name];
    const files = await h.inputsOf(a, outs);
    const named = a.filter((v, i) => i && outs.includes(a[i - 1]));
    const roots = rootsOf(h, [...files.map((f) => f.path), ...named]);
    const r = name === 'kmer2read_distr'
      ? await runProgram(h, KMER2READ, a, { files, roots, all: true })
      : await python(h, name, a, { files, roots, all: true });
    out.add(r);
    return out.result(r.exitCode, r.files);
  }

  /* ------------------------------------------------------------------ the commands */
  const EX = '/data/examples/metagenomics';
  const MAN = {
    kraken2: `kraken2 2.17.2 · Kraken2's classifier, running in your browser

Kraken2 gives each read the taxon – species, genus, family … – whose DNA the k-mers of the read match, in a database of
known genomes. With the example database (three bacteria) and real reads of a mock community:

kraken2 --db ${EX}/db --paired --report sample.report --output sample.kraken \\
    ${EX}/reads_1.fastq.gz ${EX}/reads_2.fastq.gz
cat sample.report        (per taxon: % of the reads, reads in its clade, reads assigned to it, rank, taxonomy ID, name)
head sample.kraken       (per read: C or U, the read's ID, the taxonomy ID, length, the taxa of its k-mers)

--db DB: a folder with hash.k2d, opts.k2d and taxo.k2d (a name without a slash is looked for in the working folder,
or in the folders of $KRAKEN2_DB_PATH); --paired; --report FILE (what Bracken reads); --output FILE (- for none);
--use-names; --confidence 0.1 (0 to 1: the share of a read's k-mers that must agree); --minimum-hit-groups N;
--classified-out / --unclassified-out FILE (paired reads: a # in the name, for _1 and _2). Gzip-compressed reads are
read as they are.
kraken2-inspect --db DB lists what is in a database; kraken2-build --build --db DB builds one (man kraken2-build).

In the browser Kraken2 runs on one thread (--threads N is left out, with a note), and the database must fit in the
browser's memory: a few hundred megabytes at most – the standard databases, of tens of gigabytes, do not. No bzip2
input. A file of reads that is not there is an error here; upstream counts it as no reads.`,
    'kraken2-inspect': `kraken2-inspect 2.17.2 · what is in a Kraken2 database

kraken2-inspect --db ${EX}/db                  (per taxon: the share of the database's minimizers, as a report)
kraken2-inspect --db ${EX}/db --skip-counts    (only the summary: k, minimizer length, size of the hash table)

--use-mpa-style; --report-zero-counts. One thread here.`,
    'kraken2-build': `kraken2-build 2.17.2 · builds a Kraken2 database, in your browser

A database folder needs: library/ with the sequences (FASTA files ending in .fna – .faa with --protein), seqid2taxid.map
(each sequence's ID, a tab, its taxonomy ID) and taxonomy/ with NCBI's nodes.dmp and names.dmp (the part of the taxonomy
the sequences need). Then:

cp -r ${EX}/db ~/mydb && rm ~/mydb/*.k2d     (the example's library, map and taxonomy – without its built files)
kraken2-build --build --db ~/mydb
kraken2-inspect --db ~/mydb --skip-counts

--kmer-len (35), --minimizer-len (31), --minimizer-spaces (7), --load-factor (0.7), --max-db-size BYTES (a smaller
hash table: the library is sampled), --protein, --fast-build. kraken2-build --clean removes library/, taxonomy/ and
seqid2taxid.map from a built database. If hash.k2d is there already, the build is skipped, as upstream.
Not here: --download-taxonomy, --download-library, --standard, --special (they download tens of gigabytes) and
--add-to-library (put the sequences into library/ and their IDs into seqid2taxid.map yourself). One thread.`,
    bracken: `bracken 3.1 · Bracken's abundance estimation, running in your browser

Kraken2 assigns many reads only to a genus or family – where species share their DNA. Bracken moves those reads down to
the species (or another rank), in proportion to how likely each species is to produce reads that end there, which it
knows from the database (DB/databaseREADLENmers.kmer_distrib, made by bracken-build):

bracken -d ${EX}/db -i sample.report -o sample.bracken -r 151 -l S -t 10
cat sample.bracken       (per species: Kraken2's reads, the reads added, the new estimate, its share of the estimates)

-d DB; -i the Kraken2 report (kraken2 --report); -o the table; -w a report in Kraken2's format with the new counts (by
default it is written next to the report, as REPORT_bracken_species.report); -r the read length of the distribution
(default 100 – the example database has 151); -l the rank: D, P, C, O, F, G, S, S1 …; -t the reads a taxon needs to be
re-estimated (default 10).
Bracken's Python programs run in the Python that comes with them (Pyodide 314): the first command loads about 13 MB,
and each takes a few seconds to start. Where Bracken's script reports an error but ends with status 0 (no database, no
report), the status here is 2.`,
    'bracken-build': `bracken-build 3.1 · makes Bracken's read distribution for a Kraken2 database, in your browser

The database folder needs what kraken2-build used (library/, seqid2taxid.map, taxonomy/) and the built database
(hash.k2d …). bracken-build classifies the library's sequences with Kraken2 (DB/database.kraken – kept, and reused),
cuts them into reads of the length you give, and writes DB/databaseREADLENmers.kmer_distrib:

cp -r ${EX}/db ~/mydb
bracken-build -d ~/mydb -t 1 -k 35 -l 100

-k: the database's k-mer length (35); -l: the read length; -t: threads (one here). The example data is read-only: copy
a database into your home folder first.`,
    'est_abundance.py': `est_abundance.py 3.1 · Bracken's estimation itself (what bracken runs)

est_abundance.py -i sample.report -k ${EX}/db/database151mers.kmer_distrib -o sample.bracken -l S -t 10 [--out-report FILE]`,
    'generate_kmer_distribution.py': `generate_kmer_distribution.py 3.1 · Bracken: from kmer2read_distr's classifications to the distribution (what bracken-build runs)

generate_kmer_distribution.py -i DB/database100mers.kraken -o DB/database100mers.kmer_distrib`,
    kmer2read_distr: `kmer2read_distr 3.1 · Bracken: classifies every read-length window of the database's sequences (what bracken-build runs)

kmer2read_distr --seqid2taxid DB/seqid2taxid.map --taxonomy DB/taxonomy/ --kraken DB/database.kraken \\
    --output DB/database100mers.kraken -k 35 -l 100 -t 1
One thread here.`
  };
  const SUMMARY = {
    kraken2: 'Kraken2: assigns reads to taxa by their k-mers, with a database of genomes; --report for Bracken',
    'kraken2-inspect': 'Kraken2: shows what is in a database',
    'kraken2-build': 'Kraken2: builds a database from sequences and a taxonomy (--build)',
    bracken: 'Bracken: re-estimates the abundance of species (or another rank) from a Kraken2 report',
    'bracken-build': 'Bracken: makes the read distribution of a Kraken2 database (DB/databaseREADLENmers.kmer_distrib)',
    'est_abundance.py': "Bracken's estimation program (bracken runs it)",
    'generate_kmer_distribution.py': "Bracken's distribution program (bracken-build runs it)",
    kmer2read_distr: "Bracken's read-classification program (bracken-build runs it)"
  };
  const via = (program, flow) => (ctx) => MG.runReal(ctx, program, { flow: { ...flow, env: envOf(ctx, K2_ENV) } });
  const RUN = {
    kraken2: via('kraken2', { mode: 'classify' }),
    'kraken2-inspect': via('kraken2', { mode: 'inspect' }),
    'kraken2-build': via('kraken2', { mode: 'build' }),
    bracken: via('bracken', { mode: 'bracken' }),
    'bracken-build': via('bracken', { mode: 'build' }),
    'est_abundance.py': via('bracken', { mode: 'program', program: 'est_abundance.py' }),
    'generate_kmer_distribution.py': via('bracken', { mode: 'program', program: 'generate_kmer_distribution.py' }),
    kmer2read_distr: via('bracken', { mode: 'program', program: 'kmer2read_distr' })
  };
  for (const name of Object.keys(RUN)) {
    T[name] = { version: /^kraken2/.test(name) ? '2.17.2' : '3.1', summary: SUMMARY[name], man: MAN[name], hidden: /\.py$|kmer2read/.test(name), run: RUN[name] };
  }
  MG.metagenomics = { kraken2, bracken, getopt, getopts };
})();
