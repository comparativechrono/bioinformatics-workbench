#!/usr/bin/env bash
# How Cutadapt, LoFreq, SomaticSniper and Strelka2 were built for this site (11 October 2026), in a checkout of
# https://github.com/comparativechrono/genomics-wasm at commit bfacba302b32f9fe12da4cc694c9a0b65b492986.
#
#   GENOMICS_WASM=/path/to/genomics-wasm EMSDK=/path/to/emsdk-3.1.64 PY314=/path/to/cpython-3.14.2/bin \
#     bash build-somatic-and-cutadapt-for-workbench.sh
#
# The repository's own build scripts do the work; each builds the unchanged native program, the native program with
# the port's changes, and the WebAssembly program ("all"). What was added here:
#  - The build machine's folders are mapped out of the strings that the compiler writes into programs (assert and
#    log messages name their source files): -ffile-prefix-map in EMCC_CFLAGS, which reaches every emcc call. Only the
#    WebAssembly builds use emcc; the native ones, for the comparisons, are not affected.
#  - The archives that GitHub makes of a tag or a commit (codeload.github.com) could not be downloaded from the build
#    machine. They were made again from the git repositories with recreate-github-archive.sh (git archive, gzip -n),
#    which checks the SHA-256 of the lock file: LoFreq 2.1.5, OpenLibm 0.8.8, SomaticSniper 1.0.5.0, and for Cutadapt
#    emsdk 5.0.3, Pyodide 314.0.7, Emscripten 5.0.3, libffi, hiwire, cpython-source-deps zstd-1.5.7 and zlib 1.3.1
#    – all byte for byte. The zip that GitHub makes of emscripten-ports/bzip2 1.0.6 could not be made again byte for
#    byte (the same files, another zip container); build-cutadapt-offline-bzip2.py runs build-cutadapt.py unchanged
#    but accepts that one archive, which is only copied into the source records of the distribution – nothing is
#    built from it (bzip2 comes with the Pyodide runtime, as released).
#  - Strelka2 was built one variant at a time (native, patched-native, wasm), to save disk space.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
: "${EMSDK:?the folder of Emscripten 3.1.64 (scripts/setup-emsdk.sh)}"
: "${PY314:?the bin folder of CPython 3.14.2}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$GW"
D=build/downloads
mkdir -p "$D"
A="$HERE/recreate-github-archive.sh"
"$A" https://github.com/CSB5/lofreq.git v2.1.5 lofreq-2.1.5 $D/lofreq-2.1.5.tar.gz da85ec4baca21e20a55b5f9ee491cdda2986d0dc672177007a2c70ca1d804fe7
"$A" https://github.com/JuliaMath/openlibm.git v0.8.8 openlibm-0.8.8 $D/openlibm-0.8.8.tar.gz 721bab18ff37160fd9e903eb211ff26fdee38c3d0041d556b07d76089c435d17
"$A" https://github.com/genome/somatic-sniper.git v1.0.5.0 somatic-sniper-1.0.5.0 $D/somatic-sniper-1.0.5.0.tar.gz fc41e90237b059fcc591e404830c4b1be678642dd5afd76ce545b97b4b7b3de1
"$A" https://github.com/emscripten-core/emsdk.git 5.0.3 emsdk-5.0.3 $D/emsdk-5.0.3.tar.gz 9a44a58bca0a3ea594ea7340d9a726cb58c772144dd37406d1c4e921823a75eb
"$A" https://github.com/pyodide/pyodide.git 314.0.7 pyodide-314.0.7 $D/pyodide-314.0.7.tar.gz 0731cd39bd1897c8cf0cac4da5cf9752594e5427cf4bad584200f8c9b617b9ef
"$A" https://github.com/emscripten-core/emscripten.git 5.0.3 emscripten-5.0.3 $D/emscripten-5.0.3.tar.gz b32ce4192bae12f15b06b1eec67b7ea6ac8ae809fc81230a43354c3c24251360
"$A" https://github.com/libffi/libffi.git f08493d249d2067c8b3207ba46693dd858f95db3 libffi-f08493d249d2067c8b3207ba46693dd858f95db3 $D/libffi-f08493d249d2067c8b3207ba46693dd858f95db3.tar.gz 0c4e5647b79e21b900eb872dd98a3e0a66be12b36ad89677f61fd901a2615778
"$A" https://github.com/pyodide/hiwire.git 6a1e67280a15d929ebeceee54a6358c9c8d5f697 hiwire-6a1e67280a15d929ebeceee54a6358c9c8d5f697 $D/hiwire-6a1e67280a15d929ebeceee54a6358c9c8d5f697.tar.gz 0d64144f149c0de3bd157551421833c6c16fdc0492c312a6325ffc25d185c93c
"$A" https://github.com/python/cpython-source-deps.git zstd-1.5.7 cpython-source-deps-zstd-1.5.7 $D/cpython-source-deps-zstd-1.5.7.tar.gz f24b52470d12f466e9fa4fcc94e6c530625ada51d7b36de7fdc6ed7e6f499c8e
"$A" https://github.com/madler/zlib.git v1.3.1 zlib-1.3.1 $D/zlib-1.3.1-emscripten.tar.gz 17e88863f3600672ab49182f217281b6fc4d3c762bde361935e436a95214d05c
"$A" https://github.com/emscripten-ports/bzip2.git 1.0.6 bzip2-1.0.6 $D/bzip2-1.0.6.zip 9628e7bc598719335ce1d1219c1a4fc241652c0a7b4d993fa82a9b98a6c5dec6 zip || true

# Cutadapt: its own Emscripten 5.0.3 (installed by the script) and CPython 3.14.2
PATH="$PY314:$PATH" "$PY314/python3.14" -I "$HERE/build-cutadapt-offline-bzip2.py" scripts/build-cutadapt.py all
PATH="$PY314:$PATH" node scripts/validate-cutadapt.mjs --engine node                       # 34 of 34 passed

# LoFreq, SomaticSniper, Strelka2: Emscripten 3.1.64; Python 2.7.18 for Strelka2's unchanged native workflow
set +u; source "$EMSDK/emsdk_env.sh"; set -u
export EMCC_CFLAGS="-ffile-prefix-map=$GW/= -ffile-prefix-map=$EMSDK/=emsdk/"
bash scripts/build-somaticsniper.sh all
bash scripts/build-lofreq.sh all
node scripts/validate-somatic.mjs --tool somaticsniper --engine node                      # 11 of 11 passed
node scripts/validate-somatic.mjs --tool lofreq --engine node                             # 20 of 20 passed
python3 scripts/setup-strelka2-python.py
export PATH="$GW/build/strelka2-python/bin:$PATH"
bash scripts/build-strelka2.sh native
bash scripts/build-strelka2.sh patched-native
bash scripts/build-strelka2.sh wasm
node scripts/validate-strelka2.mjs --engine node                                          # 13 of 13 passed

# Then, for the site (assets/vendor/genomics-wasm/): dist/lofreq/lofreq.{mjs,wasm}, dist/somaticsniper/somaticsniper.
# {mjs,wasm}, the seven programs of dist/strelka2/ with config/, and dist/cutadapt/ (manifest.json, pyodide/, wheels/)
# are used as they are, with their notices; runtime/lofreq-somatic.mjs and runtime/strelka2-somatic.mjs unchanged,
# next to a stand-in for runtime/index.mjs (index.mjs there).
