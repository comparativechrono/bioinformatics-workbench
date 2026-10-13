#!/usr/bin/env bash
# How MACS3 3.0.5 was built for this site (13 October 2026), in a checkout of
# https://github.com/comparativechrono/genomics-wasm at commit c977980 (the merge of its MACS3 port, 1b306c5).
#
#   GENOMICS_WASM=/path/to/genomics-wasm PYTHON314=/path/to/python3.14 bash build-macs3-for-workbench.sh
#
# PYTHON314 is CPython 3.14.2 (python.org's source, built with its shared library), as the script asks. The repository's
# own build script does the work (scripts/build-macs3.py all): HDF5 1.12.1 and h5py 3.13.0 for Linux, MACS3 from the
# unchanged source (native) and with the port's changes (patched-native) for the comparison, Emscripten 5.0.3 from the
# pinned archives, Pyodide's cross-build environment, and the two WebAssembly wheels (hmmlearn and MACS3, with
# pyodide-build) – then dist/macs3/ with Pyodide's own packages, the manifest and the notices. What was added here:
#  - The build machine's folders are mapped out of the strings that the compiler writes into the programs
#    (-ffile-prefix-map in EMCC_CFLAGS).
#  - Two archives that GitHub makes (codeload.github.com) could not be downloaded from the build machine: HDF5 1.12.1 and
#    pyodide-recipes 314-20260911. They were made again from their git repositories with recreate-github-archive.sh,
#    which checks the SHA-256 of the lock file (tools/macs3/sources.lock.json) – byte for byte.
#  - GitHub's zip of emscripten-ports/bzip2 1.0.6 is no longer the one the lock file pins (see
#    build-macs3-offline-bzip2.py): a zip of the same commit made by git archive is used, as for Cutadapt and Bracken.
#  - Every archive was downloaded first; the build itself ran without network access (unshare -rn), so it could only
#    use what the lock file names.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
PY=${PYTHON314:?set PYTHON314 to CPython 3.14.2}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$GW"
D=build/downloads
A="$HERE/recreate-github-archive.sh"
"$A" https://github.com/HDFGroup/hdf5.git hdf5-1_12_1 hdf5-hdf5-1_12_1 $D/macs3-runtime-sources/hdf5-1.12.1.tar.gz e6dde173c2d243551922d23a0387a79961205b018502e6a742acb30b61bc2d5f
"$A" https://github.com/pyodide/pyodide-recipes.git 314-20260911 pyodide-recipes-314-20260911 $D/macs3-runtime-sources/pyodide-recipes-314-20260911.tar.gz caf4a2752d74abae09adafb8dfaa9730b8f850885c78d23650be1b4d24f8e925
"$A" https://github.com/emscripten-ports/bzip2.git 60ce9dfe9a75f7ee92956aba8a83d1a37625bc1d bzip2-1.0.6 $D/bzip2-1.0.6.zip bb380435a7e769b51b80bc0e35d75df6f34e37ec2b6f3ce11c8060e48c9487b9 zip

# the other archives, with the script's own fetch() (each checked against its SHA-256): every source archive, the
# compiler downloads, Pyodide's packages and the Python packages of the build
"$PY" - "$GW/scripts/build-macs3.py" <<'EOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("build_macs3", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for record in m.archive_records():
    if record.get("archive") != "bzip2-1.0.6.zip":
        m.fetch(record)
for record in m.LOCK["toolchainDownloads"]:
    m.fetch(record, toolchain=True)
EOF

export EMCC_CFLAGS="-ffile-prefix-map=$GW/="
unshare -rn "$PY" "$HERE/build-macs3-offline-bzip2.py" "$GW/scripts/build-macs3.py" all
"$PY" scripts/fetch-macs3-test-data.py --verify
MACS3_PYTHON="$PY" unshare -rn node scripts/validate-macs3.mjs --engine node --dataset all   # 39 of 39 cases passed

# Then, for the site: dist/macs3/manifest.json, macs3.py and wheels/ in assets/vendor/genomics-wasm/macs3/3.0.5/, with
# the notices of dist/macs3/notices/ (LICENSE, THIRD_PARTY_LICENSES.txt, runtime-notices/, scientific-notices/,
# cython-notices/); Pyodide's own packages of dist/macs3/pyodide/ (the thirteen wheels the manifest names "pyodide/…") in
# assets/vendor/genomics-wasm/pyodide/314.0.7/, next to the one copy of the Python that Cutadapt and Bracken use – its
# five files are those of dist/macs3/pyodide/, byte for byte. dist/macs3/node_modules/ (ws, for Node.js) and
# build-manifest.json are left out. Of dist/macs3/sources/, the archive under the Mozilla Public License that the site
# did not have yet – pyodide-recipes-314-20260911.tar.gz – is in ../sources/; the others are under permissive licences
# and their sources are where the lock file points.
# The workbench does not use runtime/macs3.mjs: its terminal starts each command in a worker of its own
# (assets/js/python-worker.mjs, which has the checks and the installation of runtime/macs3-execute.mjs) and gives it
# its files. The example data, data/examples/chipseq/ and atacseq/, is MACS's own test data – see their NOTICE.txt.
