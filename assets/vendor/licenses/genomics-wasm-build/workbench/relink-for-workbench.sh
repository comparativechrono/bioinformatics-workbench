#!/usr/bin/env bash
# Link BWA, HISAT2 and FreeBayes – the WebAssembly objects of the genomics-wasm builds – for the program runner of
# this site (assets/vendor/biowasm/aioli.js): a classic loader that defines Module, with the PROXYFS and WORKERFS
# file systems, and the exit status of each run recorded as Module.__exitStatus (finish-loader.py).
#
#   GENOMICS_WASM=/path/to/genomics-wasm OUT=/path/to/output bash relink-for-workbench.sh
#
# Before: in a checkout of https://github.com/comparativechrono/genomics-wasm (commit 0e5df1fb…), with
# Emscripten 3.1.64 active, build the three programs with that repository's own scripts:
#   bash scripts/build-bwa.sh wasm
#   bash scripts/build-hisat2.sh wasm
#   patch -p1 < freebayes-prefix-map.patch && bash scripts/build-freebayes.sh wasm
# (the patch keeps the build machine's folders out of FreeBayes's assert messages; nothing else changes).
# The .wasm files written here are byte for byte those of the builds in dist/ (the linker gets the same objects
# and the same code options; only the JavaScript loader differs) – the script checks that.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
OUT=${OUT:?set OUT to the output folder}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case "$(emcc --version | head -n 1)" in *" 3.1.64 "*) ;; *) echo "Emscripten 3.1.64 is needed" >&2; exit 1;; esac
RUNNER=(-sMODULARIZE=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 '-sEXPORTED_RUNTIME_METHODS=callMain,FS,PROXYFS,WORKERFS'
        -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=8388608 -lproxyfs.js -lworkerfs.js)
same() { if cmp -s "$1" "$2"; then echo "$(basename "$1"): the same as $2"; else echo "$(basename "$1") DIFFERS from $2" >&2; exit 1; fi; }

# BWA 0.7.19 – the link line of BWA's Makefile with the flags of scripts/build-bwa.sh
mkdir -p "$OUT/bwa/0.7.19"
(cd "$GW/build/bwa/wasm/source" &&
  emcc -O3 -Wall -Wno-unused-function -U__SSE2__ -U__ARM_NEON -U__ARM_NEON__ -include port.h -Wl,--fatal-warnings \
    "${RUNNER[@]}" -sINITIAL_MEMORY=33554432 \
    bwashm.o bwase.o bwaseqio.o bwtgap.o bwtaln.o bamlite.o bwape.o kopen.o pemerge.o maxk.o bwtsw2_core.o \
    bwtsw2_main.o bwtsw2_aux.o bwt_lite.o bwtsw2_chain.o fastmap.o bwtsw2_pair.o main.o \
    -o "$OUT/bwa/0.7.19/bwa.js" -L. -lbwa "$GW/build/bwa/wasm/zlib-prefix/lib/libz.a" -lm)
python3 "$HERE/finish-loader.py" "$OUT/bwa/0.7.19/bwa.js" \
  'BWA 0.7.19 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
same "$OUT/bwa/0.7.19/bwa.wasm" "$GW/dist/bwa/bwa.wasm"

# HISAT2 2.2.2 – hisat2-build, hisat2-align and hisat2-inspect in one module (dispatch.cpp); flags of scripts/build-hisat2.sh
mkdir -p "$OUT/hisat2/2.2.2"
(cd "$GW/build/hisat2/wasm/source" &&
  em++ -O3 -std=c++11 -msse2 -funroll-loops -fno-strict-aliasing -DNDEBUG -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64 \
    -D_GNU_SOURCE -DBOWTIE2 -DPOPCNT_CAPABILITY -I. -Ithird_party -msimd128 -fexceptions -DHISAT2_WASM_PORT -Werror=format \
    $(sed -n 's/^OBJS = //p' port.mk) -Wl,--fatal-warnings -sDISABLE_EXCEPTION_CATCHING=0 \
    "${RUNNER[@]}" -sINITIAL_MEMORY=33554432 -o "$OUT/hisat2/2.2.2/hisat2.js")
python3 "$HERE/finish-loader.py" "$OUT/hisat2/2.2.2/hisat2.js" \
  'HISAT2 2.2.2 (hisat2-build, hisat2-align and hisat2-inspect in one module) compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
same "$OUT/hisat2/2.2.2/hisat2.wasm" "$GW/dist/hisat2/hisat2.wasm"

# FreeBayes 1.3.6 – the objects in the order of tools/freebayes/sources.json; flags of tools/freebayes/build.py
mkdir -p "$OUT/freebayes/1.3.6"
W="$GW/build/freebayes/wasm"
mapfile -t OBJECTS < <(python3 -c 'import json,sys
for group in json.load(open(sys.argv[1])).values():
    for f in group: print(sys.argv[2] + "/objects/" + f + ".o")' "$GW/tools/freebayes/sources.json" "$W")
em++ -O2 -pipe -ffunction-sections -fdata-sections -msimd128 "${OBJECTS[@]}" "$W/zlib-1.3.1/libz.a" -lm \
  "${RUNNER[@]}" -sINITIAL_MEMORY=67108864 -sDISABLE_EXCEPTION_CATCHING=0 -fexceptions -o "$OUT/freebayes/1.3.6/freebayes.js"
python3 "$HERE/finish-loader.py" "$OUT/freebayes/1.3.6/freebayes.js" \
  'FreeBayes 1.3.6 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
same "$OUT/freebayes/1.3.6/freebayes.wasm" "$GW/dist/freebayes/freebayes.wasm"
