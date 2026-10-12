/* The workbench's stand-in for runtime/index.mjs of genomics-wasm (https://github.com/comparativechrono/genomics-wasm,
   MIT licence), for kraken2.mjs next to it. kraken2.mjs is used unchanged; it imports two things from here:
   workspacePath, which gives every path its one spelling, and ToolRunner, which runs one compiled program of Kraken2
   (classify, estimate_capacity, build_db, dump_table) on its arguments and files.

   genomics-wasm keeps a command's files in /work and runs each program in a worker of its own. In the terminal a path
   is taken as the terminal takes it: relative to the folder the command was given in, or absolute, with . and ..
   resolved (/work is that folder too). ToolRunner hands the command to the terminal, which runs it in a worker of its
   own as well (assets/js/metagenomics.js). The terminal sets the folder and the way to run a program (setWorkspace,
   setRunner) before it runs Kraken2's commands. */
let base = '/work';
let links = [];
let runner = null;

export function setWorkspace(folder, linkList = []) {
  base = normalize(folder);
  links = linkList.map(([target, link]) => [normalize(target), normalize(link)]);
}

/** run(moduleUrl, args, {files, outputs, outputDirectories, stdin}) → {exitCode, stdout, stderr, files, missingOutputs} */
export function setRunner(run) {
  runner = run;
}

export function workspacePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw new TypeError('File paths must be non-empty POSIX paths');
  let p = value === '/work' || value.startsWith('/work/') ? base + value.slice(5) : value.startsWith('/') ? value : base + '/' + value;
  p = normalize(p);
  for (const [target, link] of links) if (p === link || p.startsWith(link + '/')) { p = target + p.slice(link.length); break; }
  if (p === '/') throw new TypeError('A file path must name a file, not the root folder');
  return p;
}

/** One program of Kraken2, run by the terminal: the same contract as genomics-wasm's ToolRunner. */
export class ToolRunner {
  constructor({ moduleUrl } = {}) {
    this.moduleUrl = new URL(moduleUrl);
  }

  async run(args = [], { files = [], outputs = [], outputDirectories = [], stdin = new Uint8Array() } = {}) {
    if (!runner) throw new Error('The terminal has not set a way to run the programs (setRunner)');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new TypeError('args must be an array of strings without NUL characters');
    }
    const inputFiles = files.map((file) => ({ path: workspacePath(file.path), data: file.data }));
    if (new Set(inputFiles.map((file) => file.path)).size !== inputFiles.length) throw new TypeError('Input file paths must be unique');
    return runner(this.moduleUrl, args, {
      files: inputFiles,
      outputs: [...new Set(outputs.map(workspacePath))],
      outputDirectories: [...new Set(outputDirectories.map(workspacePath))],
      stdin
    });
  }
}

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}
