#!/usr/bin/env bash
# How the WebAssembly programs of BWA-MEM2, StringTie, kallisto, mosdepth, featureCounts and Salmon were built for this
# site, in a checkout of https://github.com/comparativechrono/genomics-wasm at commit e8c3e15 (11 October 2026), with
# Emscripten 3.1.64 active (scripts/setup-emsdk.sh) and, for Salmon, Rust nightly-2026-09-25 with rust-src and the
# wasm32-unknown-emscripten target.
#
#   GENOMICS_WASM=/path/to/genomics-wasm bash build-wasm-for-workbench.sh
#
# The repository's own build scripts do the work. The only addition: the build machine's folders are mapped out of the
# strings that compilers write into programs (assert messages and Rust's panic messages name their source files) –
# -ffile-prefix-map for C, C++ and Nim's C (EMCC_CFLAGS reaches every emcc call), --remap-path-prefix for Rust. The
# Rust flags repeat the target features that scripts/build-salmon.sh sets (RUSTFLAGS takes the place of those).
# The unchanged native and the patched native programs, for the comparisons, are built with "native" and
# "patched-native" instead of "wasm", without these settings.
set -euo pipefail
GW=${GENOMICS_WASM:?set GENOMICS_WASM to the genomics-wasm checkout}
: "${EMSDK:?activate Emscripten 3.1.64 first}"
cd "$GW"
export EMCC_CFLAGS="-ffile-prefix-map=$GW=/genomics-wasm -ffile-prefix-map=$EMSDK=/emsdk"
for tool in bwa-mem2 stringtie kallisto mosdepth featurecounts; do
  bash "scripts/build-$tool.sh" wasm
done
B="$GW/build/salmon"
SYSROOT=$(RUSTUP_TOOLCHAIN=nightly-2026-09-25 rustc --print sysroot)
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128"
RUSTFLAGS+=" --remap-path-prefix=$B/vendor-patched=/cargo/vendor --remap-path-prefix=$B/source-patched=/salmon"
RUSTFLAGS+=" --remap-path-prefix=$B/cargo-home=/cargo/home"
RUSTFLAGS+=" --remap-path-prefix=$SYSROOT/lib/rustlib/src/rust=/rustc/f7575a9da8e4a4fca3b5668d5a2ea7476db44b3f"
export RUSTFLAGS
bash scripts/build-salmon.sh wasm
# Then: relink-bwa-mem2-stringtie-kallisto-mosdepth.sh links the first four for the site's program runner;
# dist/featurecounts/featurecounts.{mjs,wasm} and dist/salmon/salmon.{mjs,wasm} are used as they are.
