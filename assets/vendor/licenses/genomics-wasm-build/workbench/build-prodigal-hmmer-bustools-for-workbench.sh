#!/usr/bin/env bash
# How Prodigal, HMMER and bustools were built for this site (13 October 2026), in a checkout of
# https://github.com/comparativechrono/genomics-wasm at commit 46c94182b10556cc636d634812019e2838e176af.
#
#   GENOMICS_WASM=/path/to/genomics-wasm EMSDK=/path/to/emsdk-3.1.64 bash build-prodigal-hmmer-bustools-for-workbench.sh
#
# The repository's own build scripts do the work; each builds the unchanged native programs, the native programs with
# the port's changes, and the WebAssembly programs ("all"). What was added here, as for Kraken2 and Bracken
# (build-kraken2-and-bracken-for-workbench.sh):
#  - The build machine's folders are mapped out of the strings that the compiler writes into programs:
#    -ffile-prefix-map in EMCC_CFLAGS, which reaches every emcc call (only the WebAssembly builds use emcc).
#  - The archives that GitHub makes (codeload.github.com) could not be downloaded from the build machine. They were made
#    again from the git repositories with recreate-github-archive.sh, which checks the SHA-256 of the lock files:
#    Prodigal 2.6.3, bustools 0.45.1 (commit d4d7a28) and zlib 1.3.1 – byte for byte. HMMER 3.4 is the release archive
#    of eddylab.org, with the SHA-256 of its lock file.
#  - HMMER's WebAssembly programs were then built a second time, with one patch more: hmmer-easel-messages.patch (see
#    build-hmmer-workbench.py). Without it, Easel takes every program compiled with Emscripten for a daemon, and its
#    error messages are lost. The programs of the site are those of the second build.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
: "${EMSDK:?the folder of Emscripten 3.1.64 (scripts/setup-emsdk.sh)}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$GW"
D=build/downloads
mkdir -p "$D"
A="$HERE/recreate-github-archive.sh"
"$A" https://github.com/hyattpd/Prodigal.git v2.6.3 Prodigal-2.6.3 $D/prodigal-2.6.3.tar.gz 89094ad4bff5a8a8732d899f31cec350f5a4c27bcbdd12663f87c9d1f0ec599f
"$A" https://github.com/BUStools/bustools.git d4d7a283dbe9d34d2106e9ba31e2566413be6a70 bustools-d4d7a283dbe9d34d2106e9ba31e2566413be6a70 $D/bustools-0.45.1.tar.gz b014317ea4501c3314ac358eb074dbbe3a10ed6daec53587f17a897e670e40df
"$A" https://github.com/madler/zlib.git v1.3.1 zlib-1.3.1 $D/zlib-1.3.1-github.tar.gz 17e88863f3600672ab49182f217281b6fc4d3c762bde361935e436a95214d05c
[[ -f $D/hmmer-3.4.tar.gz ]] || curl -fsSL -o $D/hmmer-3.4.tar.gz https://eddylab.org/software/hmmer/hmmer-3.4.tar.gz
echo "ca70d94fd0cf271bd7063423aabb116d42de533117343a9b27a65c17ff06fbf3  $D/hmmer-3.4.tar.gz" | sha256sum -c -
# (and emscripten-3.1.64.tar.gz, as in build-kraken2-and-bracken-for-workbench.sh, if it is not there yet)

set +u; source "$EMSDK/emsdk_env.sh"; set -u
export EMCC_CFLAGS="-ffile-prefix-map=$GW/= -ffile-prefix-map=$EMSDK/=emsdk/"
export EM_NODE_JS="$(command -v node)"
bash scripts/build-prodigal.sh all
bash scripts/build-hmmer.sh all
bash scripts/build-bustools.sh all
python3 scripts/fetch-annotation-test-data.py --verify
python3 scripts/fetch-bustools-test-data.py --verify
node scripts/validate-annotation.mjs --tool all --engine node    # Prodigal 15 of 15 passed, HMMER 33 of 33 passed
node scripts/validate-bustools.mjs --engine node                 # bustools 56 of 56 passed

# HMMER's WebAssembly programs again, with hmmer-easel-messages.patch after genomics-wasm's browser.patch:
python3 -I "$HERE/build-hmmer-workbench.py" tools/hmmer/build.py wasm
node scripts/validate-annotation.mjs --tool hmmer --engine node  # HMMER 33 of 33 passed

# Then, for the site (assets/vendor/genomics-wasm/): dist/prodigal/prodigal.{mjs,wasm}, dist/hmmer/*.{mjs,wasm} (the
# thirteen programs, of the second build) and dist/bustools/bustools.{mjs,wasm}, with the notices of tools/prodigal/,
# tools/hmmer/ and tools/bustools/. The workbench does not use runtime/prodigal.mjs, hmmer.mjs or bustools.mjs: its
# terminal starts each program in a worker of its own (assets/js/threads-worker.mjs), as for Kraken2.
# The example data: data/examples/bacteria/ is datasets/annotation/prodigal/ (ecoli.fna, salmonella.fna, combined.fna);
# data/examples/hmmer/ holds the twelve files of the folder tutorial/ of hmmer-3.4.tar.gz, unchanged and under their
# own names (eleven of them are in datasets/annotation/hmmer/ too, renamed; 7LESS_DROME is there as
# sevenless-drome.faa, the record's sequence in FASTA); data/examples/singlecell/ is
# datasets/bustools/bustools/ – R1.fastq, R2.fastq, input.bus, matrix.ec, transcripts.txt, transcripts-to-genes.txt,
# whitelist.txt, and large/ with input.bus, matrix.ec, transcripts.txt, transcripts-to-genes.txt and whitelist.txt.
