/* =====================================================================
   The Python of the IDE tab: Spyder's console, a Python of its own in
   a worker of its own (the notebook's Python is another).

   It is the notebook's worker (py-worker.js: Pyodide, the copy of the
   home folder, !commands run by the page's shell) with these added:
   · IPython: the console is IPython itself, with Spyder's magics
     (assets/py/wb_ide.py);
   · the example data are read only when they are used (the notebook's
     Python copies them all as it starts);
   · input() and the debugger's prompt: the worker waits for the answer
     without returning to the browser – Atomics.wait on a
     SharedArrayBuffer, which the page has only when it is cross-origin
     isolated;
   · Ctrl+C: Pyodide's interrupt buffer (also isolated pages only).

   Messages from the page, besides the notebook's:
     init     with ide: true, lazyFiles, inputBuffer, interrupt, ideOpts
     ide-run  {id, code, silent, scan, extra}   → output…, done {ok, count, cwd}
     ide-call {id, fn, args}                    → ide-reply {value}
   and to the page: input {id, prompt, password}.
   ===================================================================== */
/* global importScripts, pyodide, runId:writable, post, flushStream, resetOutput, loadImports, doneWithChanges, setUser, mkdirp, dirnameOf, status */
'use strict';
importScripts('py-worker.js');

let ideInput = null; // {ctl: Int32Array [state, length], data: Uint8Array}
let ideIntr = null; // the interrupt buffer (Int32Array): 2 = Ctrl+C
const INPUT_WAIT = 0, INPUT_READY = 1, INPUT_INTERRUPT = 2;

/* input() and the debugger's prompt: the question goes to the page; the worker waits until the page has written the
   answer (or Ctrl+C) into the shared buffer → JSON {ok, text} or {ok: false, why} */
self.ide_input = (prompt, password) => {
  flushStream();
  if (!ideInput) return JSON.stringify({ ok: false, why: 'isolation' });
  const { ctl, data } = ideInput;
  Atomics.store(ctl, 0, INPUT_WAIT);
  post({ type: 'input', id: runId, prompt: String(prompt), password: !!password });
  while (Atomics.load(ctl, 0) === INPUT_WAIT) Atomics.wait(ctl, 0, INPUT_WAIT, 1000);
  const state = Atomics.load(ctl, 0);
  Atomics.store(ctl, 0, INPUT_WAIT);
  if (state === INPUT_INTERRUPT) return JSON.stringify({ ok: false, why: 'interrupt' });
  const n = Math.min(Atomics.load(ctl, 1), data.length);
  // (TextDecoder does not read a shared buffer: a copy)
  return JSON.stringify({ ok: true, text: new TextDecoder().decode(data.slice(0, n)) });
};

/* time.sleep(): the worker waits on the interrupt buffer, so that Ctrl+C ends the sleep at once (Python's own sleep
   cannot be interrupted here). → false where there is no buffer (Python sleeps in its own way) */
self.ide_sleep = (secs) => {
  if (!ideIntr) return false;
  if (secs > 0) Atomics.wait(ideIntr, 0, 0, secs * 1000);
  return true;
};

/* the example data, as files that are fetched the first time they are read */
function lazyExamples(list) {
  const FS = pyodide.FS;
  const dirs = new Set();
  for (const f of list || []) {
    const dir = dirnameOf(f.path);
    try {
      mkdirp(dir);
      dirs.add(dir);
      FS.createLazyFile(dir, f.path.slice(dir.length + 1), f.url, true, false);
    } catch (e) {
      /* there already */
    }
  }
  // (read-only, the folders too, up to /data)
  for (const d of dirs) {
    for (let p = d; p && p !== '/'; p = dirnameOf(p)) {
      try {
        FS.chmod(p, 0o555);
      } catch (e) {}
      if (p === '/data') break;
    }
  }
}

self.wbAfterInit = async (m, versions) => {
  if (!m.ide) return;
  lazyExamples(m.lazyFiles);
  if (m.interrupt) {
    ideIntr = new Int32Array(m.interrupt);
    pyodide.setInterruptBuffer(ideIntr);
  }
  if (m.inputBuffer) ideInput = { ctl: new Int32Array(m.inputBuffer, 0, 2), data: new Uint8Array(m.inputBuffer, 8) };
  status('Starting IPython…');
  await pyodide.loadPackage(['ipython'], { messageCallback: () => {}, errorCallback: () => {} });
  const opts = Object.assign({}, m.ideOpts || {}, { can_ask: !!ideInput });
  const r = await pyodide.runPythonAsync(`import wb_ide\nwb_ide.start(${JSON.stringify(JSON.stringify(opts))})`);
  Object.assign(versions, { ide: JSON.parse(r) });
};

let ideMod = null;
const ide = () => (ideMod = ideMod || pyodide.pyimport('wb_ide'));

async function ideRun(m) {
  setUser(m.user);
  runId = m.id;
  resetOutput();
  // (the packages that the code imports – or the file that %runfile runs – are loaded first)
  await loadImports(String(m.scan != null ? m.scan : m.code).replace(/^\s*[!%].*$/gm, ''), m.id);
  // (run with runPythonAsync rather than by calling the coroutine from here: only then does Ctrl+C – the interrupt
  // buffer – reach the code that is running)
  let res = { ok: false };
  const args = pyodide.toPy([m.code, !!m.silent, JSON.stringify(m.extra || {})]);
  pyodide.globals.set('_ide_args', args);
  try {
    res = JSON.parse(await pyodide.runPythonAsync('import wb_ide\nawait wb_ide.run_cell(*_ide_args)'));
  } catch (e) {
    self.nb_post_output(JSON.stringify({ type: 'error', ename: 'Error', evalue: String((e && e.message) || e), text: String((e && e.message) || e) }));
  } finally {
    args.destroy();
    try {
      pyodide.globals.delete('_ide_args');
    } catch (e) {}
    flushStream();
  }
  doneWithChanges({ type: 'done', id: m.id, ok: !!res.ok, count: res.count, cwd: res.cwd });
  runId = null;
}

async function ideCall(m) {
  let value = 'null';
  try {
    value = ide().call(m.fn, JSON.stringify(m.args || []));
  } catch (e) {
    value = JSON.stringify({ error: String((e && e.message) || e) });
  }
  post({ type: 'ide-reply', id: m.id, value });
}

self.wbHandle = async (m) => {
  if (m.type === 'ide-run') await ideRun(m);
  else if (m.type === 'ide-call') await ideCall(m);
};
