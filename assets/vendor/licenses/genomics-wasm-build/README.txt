BWA, BWA-MEM2, HISAT2, FreeBayes, featureCounts, StringTie, kallisto, Salmon, mosdepth and the R package
locfit – from the genomics-wasm project
===========================================================================================================
The WebAssembly builds of BWA 0.7.19, HISAT2 2.2.2 and FreeBayes 1.3.6 in ../../biowasm/, and of the
R package locfit 1.5-9.12 in ../../r-packages/, come from the genomics-wasm project:
https://github.com/comparativechrono/genomics-wasm, commit 0e5df1fba226dbfd606f719600336aeeccbe754a
(11 October 2026). Its own scripts are under the MIT licence (LICENSE.txt); the programs keep their
own licences (GPL-3.0 for BWA and HISAT2; MIT for FreeBayes, which contains GPL-2.0-or-later code –
see ../../biowasm/*/*/ and THIRD_PARTY.md at the top of the site). Their source code: ../sources/.

The parts of that repository that make them, in its own layout:
  scripts/           build-bwa.sh, build-hisat2.sh, build-freebayes.sh, build-deseq2-locfit.sh, setup-emsdk.sh
  tools/bwa/         README.md (what was changed, and why), browser.patch (every change to the source),
                     kopen.c, kthread.c, bwashm.c (the files that the patch replaces), port.h,
                     sources.lock.json (the source archive and its SHA-256)
  tools/hisat2/      README.md, browser.patch, dispatch.cpp (hisat2-build, hisat2-align and hisat2-inspect
                     as one program: "hisat2 build|align|inspect"), sources.lock.json
  tools/freebayes/   README.md, build.py, sources.json (the files that are compiled), patches/ (three
                     portability patches), upstream.lock.json (FreeBayes and the commits of its submodules)
  tools/deseq2/      locfit-build.R, locfit.lock.json, webr-build-provenance.json
What was done for this site:
  workbench/relink-for-workbench.sh    links the WebAssembly objects of the three programs for the runner
                                       of this site, and checks that the .wasm files are those of step 2
  workbench/finish-loader.py           records the exit status in a loader (Module.__exitStatus)
  workbench/freebayes-prefix-map.patch keeps the build machine's folders out of FreeBayes's assert
                                       messages (-ffile-prefix-map); nothing else changes
  workbench/build-locfit-offline.sh, build-deseq2-locfit-offline.sh, locfit-build-offline.R
                                       how locfit was built (below); locfit-build-environment.txt: the record

How the three programs were made (11 October 2026)
  1. In a checkout of genomics-wasm at that commit, with Emscripten 3.1.64 (scripts/setup-emsdk.sh):
       bash scripts/build-bwa.sh all
       bash scripts/build-hisat2.sh all
       patch -p1 < freebayes-prefix-map.patch && bash scripts/build-freebayes.sh all
     "all" builds the unchanged native program, the changed native program and the WebAssembly one.
  2. The project's own comparison (node scripts/validate.mjs --tool bwa|hisat2|freebayes --engine node,
     Node.js 22) passed: BWA 16 of 16 cases, HISAT2 45 of 45 (DNA and RNA reads of human and yeast),
     FreeBayes 9 of 9. The native and the WebAssembly programs made the same index files, the same SAM
     records and tags, and the same VCF records (FreeBayes: QUAL values below 1e-8 may differ by 1e-13
     at most – x86 and WebAssembly compute long double with different precision; tools/freebayes/README.md).
  3. bash workbench/relink-for-workbench.sh linked the same objects for this site's runner. The .wasm files
     are byte for byte those checked in step 2; only the JavaScript loaders differ.
  4. In the workbench's terminal, with the example data, the results were compared with the native
     programs once more: the index files of bwa index and hisat2-build, the SAM files of bwa mem (also with
     -R) and of hisat2 (also with --known-splicesite-infile, and from .gz reads), and the VCF file of
     freebayes – the same, apart from the command lines in the headers (FreeBayes: QUAL values below
     1e-13 differ in 10 of 79 records, by 1.1e-14 at most).

locfit, for DESeq2 and edgeR
  DESeq2 and edgeR need locfit, and none of the webR repositories had a build of it for webR 0.6.0
  (R 4.6.0). It was built with genomics-wasm's recipe (scripts/build-deseq2-locfit.sh,
  tools/deseq2/locfit-build.R) in the webR build image that the recipe pins
  (ghcr.io/r-wasm/webr@sha256:3fbf3dc3…: webR 0.6.0, R 4.6.0, Emscripten 5.0.7, rwasm 0.3.0.9000), from
  the CRAN source (../sources/locfit_1.5-9.12.tar.gz), without network access inside the image – which
  is why rwasm's two build steps are called directly (workbench/build-locfit-offline.sh says how).
  The R and C code of locfit are unchanged. The index of ../../r-packages/ was written with R 4.6.0's
  tools::write_PACKAGES(type = "mac.binary").
  Checked with genomics-wasm's DESeq2 comparison (scripts/validate-deseq2.mjs, validation/deseq2/): its
  analysis script in webR 0.6.0 (Node.js 22) with this locfit and the 42 other pinned packages, against
  native R 4.6.0 (the image's, with reference BLAS and LAPACK 3.12.0): all 17 checks passed within
  validation/deseq2/tolerances.json. The fit with fitType = "local", which runs locfit's compiled code,
  differed from native R by 7.7e-7 (relative) at most in the dispersions.

In the terminal of the workbench
  bwa, hisat2, hisat2-build, hisat2-inspect and freebayes run these programs. Thread options (bwa -t,
  hisat2 -p, hisat2-build -p) are left out, with a note. hisat2's wrapper scripts (perl, python) are not
  here: the terminal does what they do that a person meets – --wrapper basic-0, the checks for the read
  files and the index with the wrapper's messages, unpacking .gz reads – and says that --un, --al,
  --un-conc and --al-conc (done by the wrapper) are not available. The CPU times in bwa's messages are
  not measured in WebAssembly (the C library gives fixed values); the real times are right.

BWA-MEM2, StringTie, kallisto, mosdepth, featureCounts and Salmon (added on 11 October 2026)
  The WebAssembly builds of BWA-MEM2 2.2.1, StringTie 3.0.3, kallisto 0.52.0 and mosdepth 0.3.14 in ../../biowasm/,
  and of featureCounts 2.1.1 (Subread) and Salmon 2.8.0 in ../../genomics-wasm/, come from the same project at
  commit e8c3e15 (11 October 2026). Their parts of the repository, in its layout:
  scripts/           build-bwa-mem2.sh, build-stringtie.sh, build-kallisto.sh, build-mosdepth.sh,
                     build-featurecounts.sh, build-salmon.sh
  tools/bwa-mem2/    README.md, browser.patch, port.h, sources.lock.json
  tools/stringtie/   README.md, browser.patch, provenance.py, sources.lock.json
  tools/kallisto/    README.md, browser.patch, serial-thread.h, sources.lock.json
  tools/mosdepth/    README.md, browser.patch, hts-nim.patch, width_check.nim, sources.lock.json
  tools/featurecounts/ README.md, browser.patch, count-guard.h, count-check.c, mailbox.js, sources.lock.json
  tools/salmon/      README.md, browser.patch, mailbox.js, linker.sh, prepare.py, finish.py, port-check.rs,
                     Cargo.lock, Cargo.std.lock, Cargo.upstream.lock, sources.lock.json (the 426 crates)
  runtime/           index.mjs, worker.mjs, execute.mjs: the project's runner, from which
                     assets/js/threads-worker.mjs (the worker of featureCounts and Salmon here) was adapted
  Each sources.lock.json names the upstream archives with their SHA-256. Source code included here (in
  ../sources/): Subread 2.1.1, for featureCounts (GNU GPL 3 or later), and zlib 1.3.1. The other programs are under
  permissive licences (MIT, BSD) and their sources are where the lock files point. (The archives that GitHub makes
  of a commit – codeload.github.com – were made again from the git repositories with git archive and gzip -n -6;
  their SHA-256 values are those of the lock files.)
  What was done for this site:
    workbench/build-wasm-for-workbench.sh   the WebAssembly builds: the repository's scripts, with the build
                                            machine's folders mapped out of the strings in the programs
                                            (-ffile-prefix-map; --remap-path-prefix for Salmon's Rust)
    workbench/relink-bwa-mem2-stringtie-kallisto-mosdepth.sh
                                            links the first four for this site's runner, and checks that the .wasm
                                            files are those of the builds (they are, byte for byte)
    workbench/finish-loader.py              (as above; it now knows the loaders that are not minified too)
    workbench/crate-notices.py              collects the licence files of Salmon's crates (CRATE-NOTICES.txt)
  featureCounts and Salmon are not linked again: they use threads, and run as built, each command in a worker
  of its own; they need a cross-origin isolated page (isolation.js, isolation-sw.js at the top of the site).

  How they were made and checked (11 October 2026)
  1. Native programs from the unchanged sources, native programs with the port's changes, and the WebAssembly
     programs, with each tool's script (native, patched-native, wasm); Emscripten 3.1.64, Nim 2.2.12 (mosdepth),
     Rust nightly-2026-09-25 with rust-src (Salmon).
  2. The project's comparisons in Node.js 22 passed: node scripts/validate.mjs --tool bwa-mem2 (24 of 24 cases,
     and test-bwa-mem2-memory.mjs), validate-rna-analysis.mjs --tool stringtie (27 of 27), --tool mosdepth
     (28 of 28), --tool featurecounts (30 of 30), validate-quant.mjs --tool kallisto (29 of 29), --tool salmon
     (31 of 31): real human and yeast data; the same index files, SAM records, GTF records, count tables, depths
     and abundance tables as the native programs.
  3. In the workbench's terminal, with the example data, the results were compared with the native programs once
     more: BWA-MEM2's five index files and its SAM records; StringTie's GTF records and gene table; mosdepth's
     summary, distribution, per-base and window depths; kallisto's abundance table; featureCounts' count table
     and summary (paired fragments); Salmon's quant.sf (paired and single-end) and library type – all the same,
     apart from command lines in headers. (kallisto's index files are not the same from one run to the next, on
     Linux either; the abundances are.)

  In the terminal of the workbench
  bwa-mem2, stringtie, kallisto, mosdepth, featureCounts and salmon run these programs. Thread options are left
  out with a note where the build runs one thread (bwa-mem2 mem -t, stringtie -p, kallisto -t, salmon -p, and
  mosdepth -t, which must be 0); featureCounts counts on up to four threads (-T 5 and more become -T 4). Emscripten's
  note about a system call that it does not have (featureCounts: "warning: unsupported syscall: __syscall_prlimit64")
  is left out, and Salmon's system error numbers are given as Linux numbers them.
