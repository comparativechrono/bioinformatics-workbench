#!/usr/bin/env python3
"""Write the checksum lists (SHA256SUMS) of site/assets/vendor/ again – after any change to the files there.

- each program folder, assets/vendor/biowasm/NAME/VERSION/ and assets/vendor/genomics-wasm/NAME/VERSION/ (the
  programs of the genomics-wasm project, and pyodide/314.0.7/, the Python of Cutadapt and Bracken): every file in it;
- assets/vendor/biowasm/: the four files at its top (the runner, its licence, the two descriptions of the
  local changes);
- assets/vendor/licenses/: every file below it, the source archives in sources/ too (which may be handed
  over separately: they are listed all the same);
- assets/vendor/r-packages/: every file below it (the R packages built for the site, and their index).

Run:  python3 build/vendor_sums.py
"""
import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = ROOT if os.path.isdir(os.path.join(ROOT, 'assets')) else os.path.join(ROOT, 'site')
V = os.path.join(SITE, 'assets', 'vendor')


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write(folder, rels):
    lines = [f'{sha(os.path.join(folder, r))}  {r}' for r in sorted(rels)]
    with open(os.path.join(folder, 'SHA256SUMS'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    return len(lines)


def every_file(folder):
    out = []
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        for name in files:
            rel = os.path.relpath(os.path.join(root, name), folder).replace(os.sep, '/')
            if rel != 'SHA256SUMS':
                out.append(rel)
    return out


def main():
    bw = os.path.join(V, 'biowasm')
    n = 0
    for base in (bw, os.path.join(V, 'genomics-wasm')):
        if not os.path.isdir(base):
            continue
        for prog in sorted(os.listdir(base)):
            p = os.path.join(base, prog)
            if not os.path.isdir(p):
                continue
            for ver in sorted(os.listdir(p)):
                folder = os.path.join(p, ver)
                if os.path.isdir(folder):
                    write(folder, every_file(folder))
                    n += 1
    top = [f for f in ('aioli.js', 'LICENSE.txt', 'RUNTIME-PATCHES.txt', 'execio-source.txt') if os.path.exists(os.path.join(bw, f))]
    write(bw, top)
    k = write(os.path.join(V, 'licenses'), every_file(os.path.join(V, 'licenses')))
    r = write(os.path.join(V, 'r-packages'), every_file(os.path.join(V, 'r-packages'))) if os.path.isdir(os.path.join(V, 'r-packages')) else 0
    print(f'SHA256SUMS written: {n} program folders, biowasm/ ({len(top)} files), licenses/ ({k} files), r-packages/ ({r} files)')


if __name__ == '__main__':
    main()
