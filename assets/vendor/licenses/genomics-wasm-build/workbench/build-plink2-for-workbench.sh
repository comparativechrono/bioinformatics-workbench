#!/usr/bin/env bash
# How PLINK 2 was built for this site (13 October 2026), in a checkout of
# https://github.com/comparativechrono/genomics-wasm at commit 8eea96b9 (the merge of its PLINK 2 port, d68433f).
#
#   GENOMICS_WASM=/path/to/genomics-wasm EMSDK=/path/to/emsdk-3.1.64 bash build-plink2-for-workbench.sh
#
# The repository's own build script does the work: it builds PLINK 2 from the unchanged source (native), the native
# program with the port's two changes (patched-native) and the WebAssembly program ("all"), with upstream's NOLAPACK
# profile. What was added here, as for Prodigal, HMMER and bustools (build-prodigal-hmmer-bustools-for-workbench.sh):
#  - The build machine's folders are mapped out of the strings that the compiler writes into programs:
#    -ffile-prefix-map in EMCC_CFLAGS, which reaches every emcc call (only the WebAssembly build uses emcc).
#  - The archives that GitHub makes (codeload.github.com) could not be downloaded from the build machine. They were made
#    again from the git repositories with recreate-github-archive.sh, which checks the SHA-256 of the lock file
#    (tools/plink2/sources.lock.json): plink-ng at commit 7211906 and zlib 1.3.2 – byte for byte.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
: "${EMSDK:?the folder of Emscripten 3.1.64 (scripts/setup-emsdk.sh)}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$GW"
D=build/downloads
mkdir -p "$D"
A="$HERE/recreate-github-archive.sh"
"$A" https://github.com/chrchang/plink-ng.git 72119068234ce0acf7189e53dfe67a527bc53e2c plink-ng-72119068234ce0acf7189e53dfe67a527bc53e2c $D/plink-ng-72119068234ce0acf7189e53dfe67a527bc53e2c.tar.gz 99cc4a517249847cfb1d3b4599dd8bc231bcd9aaff08d88e8fa569b4af060f9c
"$A" https://github.com/madler/zlib.git v1.3.2 zlib-1.3.2 $D/zlib-1.3.2-github.tar.gz b99a0b86c0ba9360ec7e78c4f1e43b1cbdf1e6936c8fa0f6835c0cd694a495a1

set +u; source "$EMSDK/emsdk_env.sh"; set -u
export EMCC_CFLAGS="-ffile-prefix-map=$GW/= -ffile-prefix-map=$EMSDK/=emsdk/"
export EM_NODE_JS="$(command -v node)"
export JOBS=2
bash scripts/build-plink2.sh all
python3 scripts/fetch-plink2-test-data.py --verify     # "Verified 35 frozen PLINK2 fixture/provenance files."
node scripts/validate-plink2.mjs --engine node         # 41 of 41 cases passed (native, patched-native, WebAssembly)

# Then, for the site (assets/vendor/genomics-wasm/plink2/2.0.0-b.1-dev/): dist/plink2/plink2.mjs and plink2.wasm, with
# the notices of dist/plink2/notices/ (those of tools/plink2/). dist/plink2/plink2.worker.mjs is left out: Emscripten
# 3.1.64 still writes it, but only as a placeholder that throws if it is loaded – the program's threads are started from
# plink2.mjs itself. The workbench does not use runtime/plink2.mjs: its terminal starts each command in a worker of its
# own (assets/js/threads-worker.mjs) and gives it its files and the options that runtime/plink2.mjs would add
# (assets/js/tools-wasm.js: --threads 1 --memory 640 require unless they are given).
# The example data, data/examples/plink2/, is six files of datasets/plink2/plink2/, unchanged: real/1kg-phase3-chr21.vcf.gz
# and real/keep48.samples.txt under their own names; real/scores.tsv as synthetic_scores.tsv; and
# synthetic/glm-missing/input.vcf, phenotypes.tsv and covariates.tsv as synthetic_glm.vcf, synthetic_phenotypes.tsv
# and synthetic_covariates.tsv.
