R packages built for this site
==============================
A repository of R packages for webR (R 4.6.0, webR 0.6.0) in the layout that R expects
(bin/emscripten/contrib/4.6/: the packages and their index, PACKAGES). The R of the notebooks
looks here first, before the webR and r-universe repositories (config.js: rLocalRepo).

locfit 1.5-9.12   Local regression, likelihood and density estimation (CRAN; Catherine Loader,
                  Jiayang Sun, Lucent Technologies, Andy Liaw). Licence: GPL (>= 2).
                  DESeq2 and edgeR need it, and none of the repositories had a build of it for
                  webR 0.6.0 (its DESCRIPTION asks for the C17 standard, USE_C17, and the usual
                  webR build settings do not point R's C17 compiler at Emscripten).

How it was built: with the recipe of the genomics-wasm project (comparativechrono/genomics-wasm,
commit 0e5df1fb…: scripts/build-deseq2-locfit.sh and tools/deseq2/locfit-build.R) in the webR
build image it pins (ghcr.io/r-wasm/webr@sha256:3fbf3dc3…, webR 0.6.0, R 4.6.0, Emscripten 5.0.7,
rwasm 0.3.0.9000), from the CRAN source locfit_1.5-9.12.tar.gz (SHA-256 fa31b9d4…). The source,
the recipe and a record of the build are in ../licenses/ (sources/locfit_1.5-9.12.tar.gz and
genomics-wasm-build/locfit/). The R and C code of locfit are unchanged.

Checked: the analysis script of genomics-wasm (validation/deseq2/analysis.R – size factors,
dispersions, Wald and likelihood-ratio tests, shrinkage, variance-stabilised counts, and a
separate fit with fitType = "local", which runs locfit's compiled code) gave the same results
with this locfit in webR as native R 4.6.0 with reference BLAS/LAPACK, within the bounds
recorded in genomics-wasm's validation/deseq2/tolerances.json (11 October 2026).
