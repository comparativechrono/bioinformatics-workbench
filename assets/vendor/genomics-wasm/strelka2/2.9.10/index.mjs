/* The workbench's stand-in for runtime/index.mjs of genomics-wasm (https://github.com/comparativechrono/genomics-wasm,
   MIT licence), for the workflow script next to it (lofreq-somatic.mjs, strelka2-somatic.mjs). Those scripts are
   used unchanged; they import one function from here: workspacePath, which gives every path its one spelling.

   genomics-wasm keeps a command's files in /work; the terminal's commands use the paths of the terminal. Here a path
   is taken as the terminal takes it: relative to the folder the command was given in, or absolute – the home folder
   and /data through the links that the programs have (see assets/js/tools-wasm.js) – with . and .. resolved. /work,
   where the scripts put the files they make when they are told no folder (Strelka's StrelkaSomaticWorkflow), is
   that folder too. The terminal sets the folder and the links (setWorkspace) before it runs a workflow. */
let base = '/work';
let links = [];

export function setWorkspace(folder, linkList = []) {
  base = normalize(folder);
  links = linkList.map(([target, link]) => [normalize(target), normalize(link)]);
}

export function workspacePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw new TypeError('File paths must be non-empty POSIX paths');
  let p = value === '/work' || value.startsWith('/work/') ? base + value.slice(5) : value.startsWith('/') ? value : base + '/' + value;
  p = normalize(p);
  for (const [target, link] of links) if (p === link || p.startsWith(link + '/')) { p = target + p.slice(link.length); break; }
  if (p === '/') throw new TypeError('A file path must name a file, not the root folder');
  return p;
}

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}
