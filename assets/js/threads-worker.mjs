/* One command of a program of the genomics-wasm project, in a worker of its own. featureCounts and Salmon count or
   quantify on several threads: they run their main function on a thread of their own (Emscripten's PROXY_TO_PTHREAD)
   and start more threads, which share the program's memory – that takes SharedArrayBuffer, and so a cross-origin
   isolated page (see isolation.js). LoFreq, SomaticSniper and Strelka2's programs run on one thread, in any page; a
   workflow (lofreq somatic, Strelka's runWorkflow.py) runs each of its commands in a worker like this one (see
   somatic.js). The other programs of the terminal run in the program runner of assets/vendor/biowasm.

   The page sends: the program's module (as genomics-wasm built it), its arguments, the folders and files it needs
   (each file at the path it has in the terminal's program file system), the links of the home folder and /data, the
   working folder and the standard input. The answer: the exit status, the standard output and error (and the order
   in which the program wrote them), and every file the program made or changed – a file that was handed over keeps
   the time 0, so a file with another time, or another size, is one the program wrote.

   Adapted from runtime/execute.mjs of genomics-wasm (https://github.com/comparativechrono/genomics-wasm, MIT licence). */
self.addEventListener('message', async (event) => {
  try {
    const result = await run(event.data);
    const transfer = new Set([result.stdout.buffer, result.stderr.buffer, ...result.files.map((f) => f.data.buffer)]);
    self.postMessage({ type: 'result', result }, [...transfer]);
  } catch (error) {
    self.postMessage({ type: 'error', error: { name: (error && error.name) || 'Error', message: (error && error.message) || String(error) } });
  }
}, { once: true });

const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';

async function run({ moduleUrl, args, thisProgram, cwd, dirs, files, links, stdin, roots }) {
  const factory = (await import(moduleUrl)).default;
  if (typeof factory !== 'function') throw new TypeError('The program module has no Emscripten factory');
  const out = new Bytes(), err = new Bytes(), order = [];
  // [1 or 2, bytes, 1 or 2, bytes …]: which output the program wrote to, in turn
  const put = (fd, byte) => {
    if (byte === null || byte === undefined) return;
    (fd === 1 ? out : err).write(byte);
    const n = order.length;
    if (n && order[n - 2] === fd) order[n - 1]++;
    else order.push(fd, 1);
  };
  const text = (fd, s) => { for (const b of new TextEncoder().encode(s)) put(fd, b); };
  const input = stdin || new Uint8Array(0);
  let offset = 0, prepared = false, finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  const sizes = new Map();
  const module = await factory({
    noInitialRun: true,
    thisProgram,
    print: (...v) => text(1, v.join(' ') + '\n'),
    // (Emscripten's runtime notes system calls it has no use for – featureCounts asks for its limit of open files:
    // "warning: unsupported syscall: __syscall_prlimit64". That is not a message of the program: it is left out.)
    printErr: (...v) => { const line = v.join(' '); if (!/^warning: unsupported syscall: /.test(line)) text(2, line + '\n'); },
    onExit: (status) => finish({ status }),
    onAbort: (reason) => finish({ error: String(reason || 'aborted') }),
    quit: (status, exception) => { throw exception; },
    preRun: [(m) => {
      const { FS } = m;
      FS.init(() => (offset < input.length ? input[offset++] : null), (b) => put(1, b), (b) => put(2, b));
      for (const d of dirs) FS.mkdirTree(d);
      for (const f of files) {
        FS.mkdirTree(dirname(f.path));
        FS.writeFile(f.path, f.data);
        // (chmod sets the time too: the time 0 comes last)
        if (f.readonly) FS.chmod(f.path, 0o444);
        FS.utime(f.path, 0, 0);
        sizes.set(f.path, f.data.length);
      }
      for (const [target, link] of links) {
        FS.mkdirTree(dirname(link));
        try { FS.symlink(target, link); } catch (e) { /* (a folder of that name is there already) */ }
      }
      FS.chdir(cwd);
      prepared = true;
    }]
  });
  if (!prepared) throw new Error('The program did not start (its preRun hooks did not run)');
  try {
    module.callMain(args);
  } catch (e) {
    if (!(e && e.name === 'ExitStatus')) throw e;
    finish({ status: e.status });
  }
  // The program's main function runs on a thread of its own: callMain returns at once. This worker serves the
  // program's file system until the program has ended.
  const end = await exited;
  const { FS } = module;
  // what the program made or changed: below the roots (the program file system of the terminal), without following links
  const made = [], folders = [];
  const walk = (dir) => {
    let names;
    try { names = FS.readdir(dir); } catch (e) { return; }
    for (const name of names.sort()) {
      if (name === '.' || name === '..') continue;
      const p = dir === '/' ? '/' + name : dir + '/' + name;
      let st;
      try { st = FS.lstat(p); } catch (e) { continue; }
      if (FS.isDir(st.mode)) { folders.push(p); walk(p); }
      else if (FS.isFile(st.mode)) {
        const was = sizes.get(p);
        if (was === undefined || +st.mtime !== 0 || st.size !== was) made.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  const result = { exitCode: end.status == null ? 1 : end.status, error: end.error || null, stdout: out.bytes(), stderr: err.bytes(), order, dirs: folders, files: [] };
  for (const p of made) result.files.push({ path: p, data: FS.readFile(p) });
  result.removed = [...sizes.keys()].filter((p) => !FS.analyzePath(p).exists);
  result.stdinPos = offset;
  return result;
}

class Bytes {
  constructor() { this.chunks = []; this.chunk = new Uint8Array(65536); this.used = 0; this.length = 0; }
  write(byte) {
    if (this.used === this.chunk.length) { this.chunks.push(this.chunk); this.chunk = new Uint8Array(65536); this.used = 0; }
    this.chunk[this.used++] = byte;
    this.length++;
  }
  bytes() {
    const all = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    all.set(this.chunk.subarray(0, this.used), o);
    return all;
  }
}
