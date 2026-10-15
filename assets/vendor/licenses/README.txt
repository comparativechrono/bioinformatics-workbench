Licences, sources and build recipes of the bundled programs
===========================================================
This folder belongs to the WebAssembly programs in ../biowasm/ and ../genomics-wasm/. Keep it with the site: some of
those programs are under the GNU General Public License, which asks whoever distributes the
programs to offer their source code and build scripts in the same place.

GPL-3.0.txt                    the GNU General Public License, version 3
Apache-2.0.txt                 the Apache License, version 2.0 – for Comlink, which is part of
                                 ../biowasm/aioli.js (see ../biowasm/LICENSE.txt)
sources/                       the source code of the GPL and MPL programs, as released:
                                 coreutils 8.32, diffutils 3.10, gawk 5.1.0, grep 3.7 and 3.11,
                                 sed 4.8 (GNU), Bowtie 2 2.4.2, kalign 3.3.1 and FastTree 2.1.11 –
                                 and of PCRE2 10.42 (BSD), which is part of the grep that carries
                                 out "grep -P"; BWA 0.7.19, HISAT2 2.2.2, FreeBayes 1.3.6 (with
                                 all its submodules) and featureCounts (Subread 2.1.1), with zlib
                                 1.3.1 and SIMDe 0.8.2, which are part of them; Strelka2 2.9.10
                                 (with what it bundles); the R package locfit 1.5-9.12
                                 (../../r-packages/); Bracken 3.1; Prodigal 2.6.3; PLINK 2 (plink-ng,
                                 commit 7211906), with zlib 1.3.2, which is part of it; and, under
                                 the Mozilla Public License 2.0, Pyodide 314.0.7 and hiwire – the
                                 Python that Cutadapt, Bracken and MACS3 run in, with the recipes with which
                                 Pyodide built the packages that MACS3 uses (pyodide-recipes 314-20260911) –
                                 and bustools 0.45.1, for the Eigen 3.3.7 in it
source-archives.json           where each archive came from, its size and SHA-256
biowasm-build/                 the Biowasm recipes (scripts and patches) with which the programs
                                 other than Bowtie 2, diff, cmp and the grep for "grep -P" were
                                 compiled – one pinned commit (among them kalign, MUSCLE, FastTree,
                                 seq-align, wgsim, gffread and lastz)
biowasm-build-manifest.json    the list of those files, with their addresses and SHA-256
bowtie2-build/                 how the two Bowtie 2 programs were compiled for the course:
                                 patch, build script, instructions
diffutils-build/               how diff and cmp (GNU diffutils) were compiled for the course:
                                 patch, build script, instructions
grep-perl-build/               how GNU grep 3.11 with PCRE2 10.42 ("grep -P") was compiled for the
                                 course: build script, one added function, instructions
genomics-wasm-build/           how BWA, BWA-MEM2, HISAT2, FreeBayes, featureCounts, StringTie,
                                 kallisto, Salmon, mosdepth, Cutadapt, MACS3, LoFreq, SomaticSniper,
                                 Strelka2, Kraken2, Bracken, Prodigal, HMMER, bustools and PLINK 2 were
                                 compiled (the recipes of the genomics-wasm project: scripts,
                                 patches, the files that replace upstream ones, lock files with the
                                 SHA-256 of every source archive),
                                 how they were linked for this site's runner (workbench/relink-*.sh),
                                 how locfit was built for webR (workbench/build-locfit-offline.sh),
                                 and the workbench's one change to HMMER
                                 (workbench/hmmer-easel-messages.patch)
                                 – see its README.txt
runtime-libraries/             the licences of the libraries that are part of every program (Emscripten's
                                 runtime, the C library musl, LLVM's libraries, zlib, bzip2, liblzma)
local-patches/                 unbuffer-stdout.py – the one-byte change made to the 17 coreutils programs
                                 and to grep (see the NOTICE.txt in ../biowasm/coreutils/8.32/ and
                                 ../biowasm/grep/3.7/)
                               fix-day-of-year.py – the day of the year in the loaders of date and gawk
                                 (see ../biowasm/RUNTIME-PATCHES.txt, section 2)
shinylive-MIT.txt              the MIT licence of Shinylive (Posit): Shiny apps in RStudio (the IDE tab) reach their
                                 R in the way that Shinylive's do (assets/js/shiny.js, shiny-socket.js, isolation-sw.js)
SHA256SUMS                     checksums of everything in this folder

Next to each program in ../biowasm/NAME/VERSION/ and ../genomics-wasm/NAME/VERSION/ are its licence, a NOTICE.txt
(origin, local changes) and SHA256SUMS (the base module has a notice and checksums only; its licence is ../biowasm/LICENSE.txt). ../biowasm/RUNTIME-PATCHES.txt lists the changes to the runtime.
The table of all third-party parts is THIRD_PARTY.md at the top of the site.
