/* One command of a Python program of the genomics-wasm project, in a worker of its own: Cutadapt (cutadapt) and
   Bracken's two Python programs (est_abundance.py, generate_kmer_distribution.py). The worker starts the Python that
   genomics-wasm bundles with them – Pyodide 314.0.7, CPython 3.14.2, unchanged; one copy for both, in
   assets/vendor/genomics-wasm/pyodide/314.0.7/ – and then:
   - Cutadapt: installs Cutadapt 5.2 and its two dependencies, dnaio and xopen, from their wheels (their compiled parts
     are WebAssembly), checked against the SHA-256 of the bundle's manifest, and runs Cutadapt's own command line;
   - Bracken: checks the program against the SHA-256 of the manifest and runs it as a script, with its arguments.
   Nothing is downloaded from elsewhere: the files are in assets/vendor/genomics-wasm/.

   The page sends what threads-worker.mjs gets: the bundle's manifest (moduleUrl) and the folder of the shared Python
   (pyodideUrl), the arguments (for Bracken: the program, then its arguments), the folders and files the command needs
   (each at the path it has in the terminal's program file system), the links of the home folder and /data, the
   working folder and the standard input. The answer has the same form: the exit status, the standard output and error
   (and the order in which they were written), and every file the command made or changed – a file that was handed
   over keeps the time 0, so a file with another time, or another size, is one it wrote.

   Adapted from runtime/cutadapt-execute.mjs and runtime/bracken-execute.mjs of genomics-wasm
   (https://github.com/comparativechrono/genomics-wasm, MIT licence): the same manifest checks, checksums,
   installation order and version checks. */
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

async function run({ moduleUrl, pyodideUrl, args, thisProgram, cwd, dirs, files, links, stdin, roots }) {
  const manifestUrl = new URL(moduleUrl);
  const manifest = JSON.parse(new TextDecoder().decode(await readAsset(manifestUrl)));
  const tool = manifest.tool;
  if (manifest.schema !== 1 || !manifest.pyodide?.path || !manifest.pyodide.version || !manifest.pyodide.python
      || !((tool === 'cutadapt' && Array.isArray(manifest.packages)) || (tool === 'bracken' && manifest.scripts))) {
    throw new Error('Unsupported Python bundle manifest');
  }
  const base = new URL('./', manifestUrl);
  // (the Python of the bundle: in its folder as genomics-wasm built it, or – here – the one copy the tools share)
  const pyBase = pyodideUrl ? new URL(String(pyodideUrl).replace(/\/?$/, '/')) : new URL(localPath(manifest.pyodide.path, true), base);
  const { loadPyodide } = await import(new URL('pyodide.mjs', pyBase).href);
  const pyodide = await loadPyodide({
    indexURL: pyBase.href,
    stdLibURL: new URL('python_stdlib.zip', pyBase).href,
    lockFileURL: new URL('pyodide-lock.json', pyBase).href,
    packageBaseUrl: pyBase.href,
    packages: [],
  });
  if (pyodide.version !== manifest.pyodide.version) throw new Error('Pyodide version differs from the bundle manifest');
  let entry;
  if (tool === 'cutadapt') entry = { ...(await installCutadapt(pyodide, manifest, base)), args, argv0: thisProgram || 'cutadapt' };
  else entry = { ...(await placeScript(pyodide, manifest, base, args[0])), args: args.slice(1) };

  const { FS } = pyodide;
  const sizes = new Map();
  for (const d of dirs) FS.mkdirTree(d);
  for (const f of files) {
    FS.mkdirTree(dirname(f.path));
    FS.writeFile(f.path, f.data);
    if (f.readonly) FS.chmod(f.path, 0o444);
    // (chmod sets the time too: the time 0 comes last)
    FS.utime(f.path, 0, 0);
    sizes.set(f.path, f.data.length);
  }
  for (const [target, link] of links) {
    FS.mkdirTree(dirname(link));
    try { FS.symlink(target, link); } catch (e) { /* (a folder of that name is there already) */ }
  }
  FS.chdir(cwd);

  // [1 or 2, bytes, 1 or 2, bytes …]: which output the program wrote to, in turn
  const out = new Bytes(), err = new Bytes(), order = [];
  const note = (fd, n) => { const k = order.length; if (k && order[k - 2] === fd) order[k - 1] += n; else order.push(fd, n); };
  const input = stdin || new Uint8Array(0);
  let offset = 0;
  pyodide.setStdin({ isatty: false, read(buffer) {
    const n = Math.min(buffer.length, input.length - offset);
    buffer.set(input.subarray(offset, offset + n));
    offset += n;
    return n;
  } });
  pyodide.setStdout({ isatty: false, write: (buffer) => { out.write(buffer); if (buffer.length) note(1, buffer.length); return buffer.length; } });
  pyodide.setStderr({ isatty: false, write: (buffer) => { err.write(buffer); if (buffer.length) note(2, buffer.length); return buffer.length; } });
  const pyArgs = pyodide.toPy(entry.args);
  let exitCode;
  try {
    pyodide.globals.set('_wb_args', pyArgs);
    pyodide.globals.set('_wb_name', entry.argv0);
    exitCode = pyodide.runPython(entry.code);
  } finally { pyArgs.destroy(); }
  if (!Number.isInteger(exitCode)) throw new Error(`${tool} returned an invalid exit status`);

  // what the command made or changed: below the roots (the program file system of the terminal), without following links
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
  const result = { exitCode, error: null, stdout: out.bytes(), stderr: err.bytes(), order, dirs: folders, files: [] };
  for (const p of made) result.files.push({ path: p, data: FS.readFile(p) });
  result.removed = [...sizes.keys()].filter((p) => !FS.analyzePath(p).exists);
  result.stdinPos = offset;
  return result;
}

/* Cutadapt: its three wheels, checked and installed in the pinned order, then its own command line */
async function installCutadapt(pyodide, manifest, base) {
  if (JSON.stringify(manifest.packages.map((pkg) => pkg.name)) !== JSON.stringify(['xopen', 'dnaio', 'cutadapt'])) {
    throw new Error('Cutadapt dependencies must be installed in the declared order');
  }
  for (const pkg of manifest.packages) {
    const wheel = new URL(localPath(pkg.filename), base);
    const data = await readAsset(wheel);
    if (!/^[a-f0-9]{64}$/.test(pkg.sha256) || (await sha256(data)) !== pkg.sha256) throw new Error(`Checksum mismatch for ${pkg.filename}`);
    const errors = [];
    // (the wheels have no entries in Pyodide's catalogue: installed in the pinned order, without a package index)
    await pyodide.loadPackage(wheel.href, { messageCallback: () => {}, errorCallback: (m) => errors.push(String(m)) });
    if (errors.length || !Object.hasOwn(pyodide.loadedPackages, pkg.name)) {
      throw new Error(`Could not install ${pkg.name}: ${errors.join('; ') || 'package was not loaded'}`);
    }
  }
  const installed = JSON.parse(pyodide.runPython(`
import importlib.metadata, json, sys
json.dumps({"python": ".".join(map(str, sys.version_info[:3])),
            "packages": {name: importlib.metadata.version(name) for name in ("xopen", "dnaio", "cutadapt")}})
`));
  if (installed.python !== manifest.pyodide.python || manifest.packages.some((pkg) => installed.packages[pkg.name] !== pkg.version)
      || installed.packages.cutadapt !== manifest.version) {
    throw new Error('Installed Python or package versions differ from the bundle manifest');
  }
  return { code: `
import sys
from cutadapt.cli import main as _cutadapt_main
def _run_cutadapt():
    sys.argv = [_wb_name, *_wb_args]
    try:
        _cutadapt_main(list(_wb_args))
        return 0
    except SystemExit as error:
        if error.code is None:
            return 0
        if isinstance(error.code, int):
            return error.code
        print(error.code, file=sys.stderr)
        return 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
_run_cutadapt()
` };
}

/* Bracken: one of its two Python programs (est_abundance.py, generate_kmer_distribution.py), checked against the
   manifest's SHA-256 and run as a script – as  python est_abundance.py ARGS  runs it */
async function placeScript(pyodide, manifest, base, name) {
  const script = manifest.scripts[name];
  if (!script) throw new Error(`${name}: not a program of this bundle`);
  const installed = pyodide.runPython('import sys; ".".join(map(str, sys.version_info[:3]))');
  if (installed !== manifest.pyodide.python) throw new Error('Python version differs from the bundle manifest');
  const data = await readAsset(new URL(localPath(script.path), base));
  if (!/^[a-f0-9]{64}$/.test(script.sha256) || (await sha256(data)) !== script.sha256) throw new Error(`Checksum mismatch for ${script.path}`);
  pyodide.FS.mkdirTree('/opt/' + manifest.tool);
  pyodide.FS.writeFile(`/opt/${manifest.tool}/${name}`, data);
  return { argv0: `/opt/${manifest.tool}/${name}`, code: `
import runpy, sys, traceback
def _run_script():
    sys.argv = [_wb_name, *_wb_args]
    try:
        runpy.run_path(_wb_name, run_name="__main__")
        return 0
    except SystemExit as error:
        if error.code is None:
            return 0
        if isinstance(error.code, int):
            return error.code
        print(error.code, file=sys.stderr)
        return 1
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
_run_script()
` };
}

function localPath(path, directory = false) {
  if (typeof path !== 'string') throw new Error('Bundle asset paths must be strings');
  const value = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (!value || value.startsWith('/') || /[\\:#?%]/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid bundle asset path: ${path}`);
  }
  return directory ? `${value}/` : value;
}

async function readAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// (a page that is not a secure context – http:// from another computer – has no crypto.subtle: then SHA-256 in JavaScript)
async function sha256(data) {
  const digest = globalThis.crypto && crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', data)) : sha256Bytes(data);
  return [...digest].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* SHA-256 of a Uint8Array, in JavaScript → Uint8Array(32) */
function sha256Bytes(data) {
  const K = SHA256_K;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const block = (dv, off) => {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      W[i] = W[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10));
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  };
  const n = data.length, full = n - (n % 64);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let off = 0; off < full; off += 64) block(dv, off);
  const tail = new Uint8Array(n % 64 < 56 ? 64 : 128);
  tail.set(data.subarray(full));
  tail[n - full] = 0x80;
  const tv = new DataView(tail.buffer);
  tv.setUint32(tail.length - 8, Math.floor(n / 0x20000000));
  tv.setUint32(tail.length - 4, (n * 8) >>> 0);
  for (let off = 0; off < tail.length; off += 64) block(tv, off);
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

class Bytes {
  constructor() { this.chunks = []; this.length = 0; }
  // (Pyodide reuses its buffer after the callback returns: a copy is kept)
  write(buffer) { this.chunks.push(buffer.slice()); this.length += buffer.length; }
  bytes() {
    const all = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    return all;
  }
}
