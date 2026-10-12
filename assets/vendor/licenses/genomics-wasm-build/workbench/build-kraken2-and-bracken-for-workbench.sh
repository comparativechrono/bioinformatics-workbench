#!/usr/bin/env bash
# How Kraken2 and Bracken were built for this site (12 October 2026), in a checkout of
# https://github.com/comparativechrono/genomics-wasm at commit ebe345482f587ca151ffd54fc65c36f520a8a1ae.
#
#   GENOMICS_WASM=/path/to/genomics-wasm EMSDK=/path/to/emsdk-3.1.64 PY314=/path/to/cpython-3.14.2/bin \
#     bash build-kraken2-and-bracken-for-workbench.sh
#
# The repository's own build scripts do the work; each builds the unchanged native programs, the native programs with
# the port's changes, and the WebAssembly programs ("all"). What was added here, as for Cutadapt and the somatic callers
# (build-somatic-and-cutadapt-for-workbench.sh):
#  - The build machine's folders are mapped out of the strings that the compiler writes into programs:
#    -ffile-prefix-map in EMCC_CFLAGS, which reaches every emcc call (only the WebAssembly builds use emcc).
#  - The archives that GitHub makes of a tag (codeload.github.com) could not be downloaded from the build machine. They
#    were made again from the git repositories with recreate-github-archive.sh, which checks the SHA-256 of the lock
#    file: Kraken2 2.17.2, Bracken 3.1 and Emscripten 3.1.64 – byte for byte. Bracken's Python runtime records (Pyodide
#    314.0.7, Emscripten 5.0.3, libffi, hiwire, zstd, zlib) are the archives made for Cutadapt, with the same SHA-256;
#    build-bracken-offline-bzip2.py runs tools/bracken/build.py unchanged but accepts the one archive that could not be
#    made again byte for byte (bzip2-1.0.6.zip: the same files, another zip container), which is only copied into the
#    source records – nothing is built from it.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
: "${EMSDK:?the folder of Emscripten 3.1.64 (scripts/setup-emsdk.sh)}"
: "${PY314:?the bin folder of CPython 3.14.2}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$GW"
D=build/downloads
mkdir -p "$D"
A="$HERE/recreate-github-archive.sh"
"$A" https://github.com/DerrickWood/kraken2.git 2.17.2 kraken2-2.17.2 $D/kraken2-2.17.2.tar.gz 84ff95cd6d8a4c9e93ab6bf1d9b3892099baaefb0277bcf2edc3eb4948566035
"$A" https://github.com/jenniferlu717/Bracken.git v3.1 Bracken-3.1 $D/bracken-3.1.tar.gz c0a35331a8aac1e0dbb14c2a92c4de6f89f0aac540101c05c2eec54032107560
"$A" https://github.com/emscripten-core/emscripten.git 3.1.64 emscripten-3.1.64 $D/emscripten-3.1.64.tar.gz 7ee24e77ed0a026d00c3df2e46bfe53106ef61db57059949a38bc5bfe5399686
# (and those of build-somatic-and-cutadapt-for-workbench.sh for Pyodide's sources, if they are not there yet)

set +u; source "$EMSDK/emsdk_env.sh"; set -u
export EMCC_CFLAGS="-ffile-prefix-map=$GW/= -ffile-prefix-map=$EMSDK/=emsdk/"
bash scripts/build-kraken2.sh all
# Bracken: kmer2read_distr with Emscripten 3.1.64; its Python programs need CPython 3.14.2 natively, for the comparison
export BRACKEN_PYTHON="$PY314/python3.14" EM_NODE_JS="$(command -v node)"
python3 -I "$HERE/build-bracken-offline-bzip2.py" tools/bracken/build.py all
python3 scripts/fetch-metagenomics-test-data.py --verify
node scripts/validate-metagenomics.mjs --engine node --tool all    # Kraken2 13 of 13 passed, Bracken 14 of 14 passed

# Then, for the site (assets/vendor/genomics-wasm/): dist/kraken2/{classify,build_db,estimate_capacity,dump_table}.
# {mjs,wasm} with runtime/kraken2.mjs unchanged, next to a stand-in for runtime/index.mjs (index.mjs there);
# dist/bracken/kmer2read_distr.{mjs,wasm}, manifest.json and python/ (the two unchanged scripts), with their notices;
# dist/bracken/pyodide/ – the same five files as dist/cutadapt/pyodide/, byte for byte – as the one shared Python,
# pyodide/314.0.7/. The example data (data/examples/metagenomics/) is datasets/metagenomics/zymo/ of the same commit:
# reads_1.fastq.gz, reads_2.fastq.gz and db/ (hash.k2d, opts.k2d, taxo.k2d, seqid2taxid.map, library/, taxonomy/,
# database151mers.kmer_distrib), as scripts/fetch-metagenomics-test-data.py made and checks them.
