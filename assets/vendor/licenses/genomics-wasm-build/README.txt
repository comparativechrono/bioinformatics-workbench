BWA, HISAT2, FreeBayes and the R package locfit – from the genomics-wasm project
================================================================================
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
