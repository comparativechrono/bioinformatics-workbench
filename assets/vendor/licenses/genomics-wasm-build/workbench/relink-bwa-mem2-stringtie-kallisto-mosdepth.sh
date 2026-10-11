#!/usr/bin/env bash
# Link BWA-MEM2, StringTie, kallisto and mosdepth – the WebAssembly objects of the genomics-wasm builds – for the
# program runner of this site (assets/vendor/biowasm/aioli.js): a classic loader that defines Module, with the PROXYFS
# and WORKERFS file systems, and the exit status of each run recorded as Module.__exitStatus (finish-loader.py).
# featureCounts and Salmon are not linked again: they run on several threads, and the site uses their modules as built
# (assets/vendor/genomics-wasm; see threads.js).
#
#   GENOMICS_WASM=/path/to/genomics-wasm OUT=/path/to/output TOOLS="bwa-mem2 stringtie kallisto mosdepth" \
#     bash relink-for-workbench.sh
#
# Before: in a checkout of https://github.com/comparativechrono/genomics-wasm (commit e8c3e15…), with Emscripten 3.1.64
# active, build each program with that repository's own script, and with the build machine's folders mapped out of
# the strings that the compiler writes into the programs (assert messages name their source files):
#   EMCC_CFLAGS="-ffile-prefix-map=$PWD=/genomics-wasm -ffile-prefix-map=$EMSDK=/emsdk" bash scripts/build-NAME.sh wasm
# The .wasm files written here are byte for byte those of the builds in dist/ (the linker gets the same objects and
# the same code options; only the JavaScript loader differs) – the script checks that.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
OUT=${OUT:?set OUT to the output folder}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case "$(emcc --version | head -n 1)" in *" 3.1.64 "*) ;; *) echo "Emscripten 3.1.64 is needed" >&2; exit 1;; esac
export EMCC_CFLAGS="-ffile-prefix-map=$GW=/genomics-wasm -ffile-prefix-map=$EMSDK=/emsdk"
RUNNER=(-sMODULARIZE=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 '-sEXPORTED_RUNTIME_METHODS=callMain,FS,PROXYFS,WORKERFS'
        -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=8388608 -lproxyfs.js -lworkerfs.js)
same() { if cmp -s "$1" "$2"; then echo "$(basename "$1"): the same as $2"; else echo "$(basename "$1") DIFFERS from $2" >&2; exit 1; fi; }
for tool in ${TOOLS:-bwa-mem2 stringtie kallisto mosdepth}; do case "$tool" in
bwa-mem2)
  # BWA-MEM2 2.2.1 – the link line of the port's makefile (scripts/build-bwa-mem2.sh), with this site's loader
  W="$GW/build/bwa-mem2/wasm"; mkdir -p "$OUT/bwa-mem2/2.2.1"
  (cd "$W/source" &&
    em++ -O3 -pipe -std=gnu++11 -msse4.1 -msimd128 -include port.h -Werror=format -I"$W/zlib-prefix/include" \
      -DV17=1 -DMATE_SORT=0 -DSAIS=1 -DENABLE_PREFETCH -Isrc -Iext/safestringlib/include -Wl,--fatal-warnings \
      "${RUNNER[@]}" -sABORTING_MALLOC=1 -sINITIAL_MEMORY=33554432 \
      $(sed -n 's/^OBJS = //p' port.mk) libsafestring.a "$W/zlib-prefix/lib/libz.a" -lm -o "$OUT/bwa-mem2/2.2.1/bwa-mem2.js")
  python3 "$HERE/finish-loader.py" "$OUT/bwa-mem2/2.2.1/bwa-mem2.js" \
    'BWA-MEM2 2.2.1 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
  same "$OUT/bwa-mem2/2.2.1/bwa-mem2.wasm" "$GW/dist/bwa-mem2/bwa-mem2.wasm";;
stringtie)
  # StringTie 3.0.3 – the link line of StringTie's makefile as scripts/build-stringtie.sh runs it (no -O at the link)
  W="$GW/build/stringtie/wasm"; P="$W/prefix/lib"; mkdir -p "$OUT/stringtie/3.0.3"
  (cd "$W/source" &&
    em++ -Wl,--fatal-warnings "${RUNNER[@]}" -sABORTING_MALLOC=1 -sINITIAL_MEMORY=67108864 -o "$OUT/stringtie/3.0.3/stringtie.js" \
      gclib/GBase.o gclib/GArgs.o gclib/GStr.o gclib/GSam.o gclib/gdna.o gclib/codons.o gclib/GFastaIndex.o gclib/GFaSeqGet.o \
      gclib/gff.o bundle.o rlink.o tablemaker.o tmerge.o stringtie.o htslib/libhts.a "$P/libbz2.a" "$P/liblzma.a" \
      "$P/libdeflate.a" "$P/libz.a" -lm)
  python3 "$HERE/finish-loader.py" "$OUT/stringtie/3.0.3/stringtie.js" \
    'StringTie 3.0.3 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
  same "$OUT/stringtie/3.0.3/stringtie.wasm" "$GW/dist/stringtie/stringtie.wasm";;
kallisto)
  # kallisto 0.52.0 – the link line of scripts/build-kallisto.sh (64-bit source lowered to wasm32: MEMORY64=2)
  W="$GW/build/kallisto/wasm"; mkdir -p "$OUT/kallisto/0.52.0"
  (cd "$W/source" &&
    em++ -O3 -DNDEBUG -DMAX_KMER_SIZE=32 -DMAX_GMER_SIZE=32 -DNO_HTSLIB=ON -DDISABLEAVX -sMEMORY64=2 -std=c++17 -fexceptions \
      -include serial-thread.h $(sed -n 's/^OBJS = //p' port.mk) -sMEMORY64=2 -Wl,--fatal-warnings -fexceptions \
      -sDISABLE_EXCEPTION_CATCHING=0 "${RUNNER[@]}" -sABORTING_MALLOC=1 -sINITIAL_MEMORY=67108864 "$W/zlib-prefix/lib/libz.a" \
      -o "$OUT/kallisto/0.52.0/kallisto.js")
  python3 "$HERE/finish-loader.py" "$OUT/kallisto/0.52.0/kallisto.js" \
    'kallisto 0.52.0 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
  same "$OUT/kallisto/0.52.0/kallisto.wasm" "$GW/dist/kallisto/kallisto.wasm";;
mosdepth)
  # mosdepth 0.3.14 – Nim's own link line (nimcache/mosdepth.json: the objects in its order), with this site's loader
  W="$GW/build/mosdepth/wasm"; mkdir -p "$OUT/mosdepth/0.3.14"
  mapfile -t OBJECTS < <(python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["link"]))' "$W/nimcache/mosdepth.json")
  emcc -o "$OUT/mosdepth/0.3.14/mosdepth.js" "${OBJECTS[@]}" -lm -lm -lrt -sMEMORY64=1 "$W/htslib/libhts.a" \
    "$W/zlib-prefix/lib/libz.a" -O3 -sMEMORY64=2 -Wl,--fatal-warnings "${RUNNER[@]}" -sABORTING_MALLOC=1 \
    -sINITIAL_MEMORY=67108864 -lm -ldl
  python3 "$HERE/finish-loader.py" "$OUT/mosdepth/0.3.14/mosdepth.js" \
    'mosdepth 0.3.14 compiled to WebAssembly from the genomics-wasm port (comparativechrono/genomics-wasm; see THIRD_PARTY.md).'
  same "$OUT/mosdepth/0.3.14/mosdepth.wasm" "$GW/dist/mosdepth/mosdepth.wasm";;
*) echo "unknown tool $tool" >&2; exit 2;;
esac; done
