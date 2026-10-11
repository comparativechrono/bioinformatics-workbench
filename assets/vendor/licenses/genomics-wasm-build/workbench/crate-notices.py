#!/usr/bin/env python3
"""Collect the licence and notice files of the Rust crates that Salmon is built from, into one text file.

  python3 crate-notices.py SOURCES_LOCK THIRD_PARTY_LICENSES VENDOR_DIR OUT

SOURCES_LOCK: genomics-wasm's tools/salmon/sources.lock.json (the crates); THIRD_PARTY_LICENSES: its
tools/salmon/THIRD_PARTY_LICENSES.txt (the SPDX licence of each crate, from its Cargo.toml);
VENDOR_DIR: the crates as unpacked by tools/salmon/prepare.py (build/salmon/vendor-patched). For each crate, the
files at its top whose names begin with LICENSE, LICENCE, COPYING, COPYRIGHT, NOTICE, AUTHORS or UNLICENSE; a text
that an earlier crate had already is named, not repeated."""
import hashlib, json, os, sys
lock, tpl, vendor, out = sys.argv[1:5]
crates = json.load(open(lock))['dependencies']['crates']
spdx = {}
for line in open(tpl, encoding='utf-8'):
    if ': ' in line and ' — ' in line:
        head, rest = line.split(': ', 1)
        spdx[head.strip()] = rest.split(' — ')[0].strip()
prefixes = ('license', 'licence', 'copying', 'copyright', 'notice', 'authors', 'unlicense')
seen = {}
parts = ['Licence and notice files of the Rust crates of Salmon 2.8.0',
         '=' * 60,
         'Salmon itself: BSD 3-Clause (LICENSE). Rust\'s standard library: COPYRIGHT.rust, LICENSE.rust-apache, LICENSE.rust-mit.',
         'Each crate below as the .crate archive of crates.io has it (SHA-256 in genomics-wasm\'s tools/salmon/sources.lock.json);',
         'a file whose text an earlier crate had already is named, not repeated. Some crates are only for other systems',
         '(Windows, macOS) and are not part of the program; they are listed all the same.', '']
missing = []
for c in crates:
    name = f"{c['name']}-{c['version']}"
    d = os.path.join(vendor, name)
    files = sorted(f for f in os.listdir(d) if f.lower().startswith(prefixes) and os.path.isfile(os.path.join(d, f)))
    parts.append('#' * 78)
    parts.append(f"{c['name']} {c['version']}   licence (Cargo.toml): {spdx.get(c['name'] + ' ' + c['version'], 'see below')}")
    if not files:
        missing.append(name)
        parts.append('  (no licence file in the crate; its licence is the one named in its Cargo.toml, above)')
    for f in files:
        text = open(os.path.join(d, f), 'rb').read().decode('utf-8', 'replace')
        h = hashlib.sha256(text.encode()).hexdigest()
        if h in seen:
            parts.append(f'--- {f}: the same text as {seen[h]}')
        else:
            seen[h] = f'{name}/{f}'
            parts.append(f'--- {f}')
            parts.append(text.rstrip('\n'))
    parts.append('')
open(out, 'w', encoding='utf-8').write('\n'.join(parts) + '\n')
print(len(crates), 'crates;', len(seen), 'distinct texts;', len(missing), 'without a licence file')
