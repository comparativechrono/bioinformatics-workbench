BWA, BWA-MEM2, HISAT2, FreeBayes, featureCounts, StringTie, kallisto, Salmon, mosdepth, Cutadapt, LoFreq,
SomaticSniper, Strelka2, Kraken2, Bracken, Prodigal, HMMER, bustools, PLINK 2, MACS3 and the R package locfit – from
the genomics-wasm project
======================================================================================================================
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

Cutadapt, LoFreq, SomaticSniper and Strelka2 (added on 11 October 2026)
  Cutadapt 5.2 (with dnaio 1.2.4 and xopen 2.1.0, in Pyodide 314.0.7 – CPython 3.14.2), LoFreq 2.1.5, SomaticSniper
  1.0.5.0 and Strelka2 2.9.10 in ../../genomics-wasm/ come from the same project at commit
  bfacba302b32f9fe12da4cc694c9a0b65b492986 (11 October 2026). Their parts of the repository, in its layout:
  scripts/           build-cutadapt.py, build-lofreq.sh, build-somaticsniper.sh, build-strelka2.sh,
                     setup-strelka2-python.py (Python 2.7.18, only for the comparison with Strelka's native workflow)
  tools/cutadapt/    README.md, browser.patch, sources.lock.json (every source archive, compiler download and Python
                     build dependency, with its SHA-256), build-requirements.lock, runtime-sources.json, native-entry.py,
                     the licences, cython-notices/ and runtime-notices/
  tools/lofreq/      README.md, browser.patch, portable_math.c/.h, counts.h, numerics.c, build.py, sources.lock.json,
                     the licences
  tools/somaticsniper/ README.md, browser.patch, samtools.patch, build.py, sources.lock.json, the licences
  tools/strelka2/    README.md, browser.patch, htslib.patch, rapidjson.patch, CMakeLists.txt (the cross-build layer),
                     build.py, sources.lock.json, the licences
  tools/strelka2-python/ the recipe's record of Python 2.7.18
  runtime/           lofreq.mjs, lofreq-somatic.mjs, strelka2.mjs, strelka2-somatic.mjs, cutadapt.mjs,
                     cutadapt-worker.mjs, cutadapt-execute.mjs, and LOFREQ.md, STRELKA2.md, CUTADAPT.md (how they work).
                     lofreq-somatic.mjs (MIT) and strelka2-somatic.mjs (GNU GPL 3 or later) are used unchanged, next
                     to the programs; assets/js/python-worker.mjs here was adapted from cutadapt-execute.mjs (it was
                     called cutadapt-worker.mjs until Bracken came – see below).
  Source code included here (in ../sources/): Strelka2 2.9.10 as released (GNU GPL 3 or later; the archive holds
  Boost, HTSlib, samtools, CodeMin, RapidJSON, bgzf_extras and pyflow as Strelka bundles them), and Pyodide 314.0.7
  and hiwire (Mozilla Public License 2.0), the Python runtime of Cutadapt. The other parts are under permissive
  licences (MIT, BSD, PSF, zlib) and their sources are where the lock files point.
  What was done for this site:
    workbench/build-somatic-and-cutadapt-for-workbench.sh  the builds, step by step (the repository's scripts, with
                                            the build machine's folders mapped out of the programs' strings)
    workbench/recreate-github-archive.sh    makes again the archives that GitHub makes of a tag or a commit (git
                                            archive, gzip -n), and checks their SHA-256 against the lock files
    workbench/build-cutadapt-offline-bzip2.py  runs build-cutadapt.py unchanged, accepting the one archive that could
                                            not be made again byte for byte (see the script)
  None of the four is linked again: each runs as built, each command in a worker of its own (threads-worker.mjs;
  python-worker.mjs for Cutadapt), with no need for a cross-origin isolated page.

  How they were made and checked (11 October 2026)
  1. Native programs from the unchanged sources, native programs with the port's changes, and the WebAssembly programs,
     with each tool's script ("all"); Emscripten 3.1.64 (LoFreq, SomaticSniper, Strelka2) and 5.0.3 with pyodide-build
     (Cutadapt's and dnaio's Cython extensions, for CPython 3.14.2 built from python.org's source).
  2. The project's comparisons in Node.js 22 passed: validate-cutadapt.mjs (34 of 34 cases: human and yeast reads –
     the same reads, qualities and statistics as native Cutadapt), validate-somatic.mjs --tool somaticsniper (11 of
     11) and --tool lofreq (20 of 20, with complete somatic workflows run by upstream's own lofreq2_somatic.py),
     validate-strelka2.mjs (13 of 13, against Strelka's unchanged native workflow run by Python 2.7.18 and pyflow):
     real HCC1395 tumour and HCC1395BL normal reads (SEQC2).
  3. In the workbench's terminal and in its Galaxy, with the example data, the results were compared with the native
     programs once more: Cutadapt's trimmed FASTQ files (byte for byte) and report; lofreq call's VCF records, lofreq
     indelqual's BAM file (byte for byte), lofreq somatic's files and records; bam-somaticsniper's VCF records;
     Strelka2's somatic SNV and indel records, index files and run statistics, from configureStrelkaSomaticWorkflow.py
     and runWorkflow.py – all the same, apart from dates, times and command lines in headers.

  In the terminal of the workbench
  cutadapt, lofreq, bam-somaticsniper (also somaticsniper), configureStrelkaSomaticWorkflow.py and the runWorkflow.py
  it writes run these programs. cutadapt -j N and lofreq somatic --threads N run with one, with a note. lofreq
  call-parallel and vcfplot (Python scripts upstream) are not available. runWorkflow.py runs with -m local; -j does not
  matter. Strelka's germline workflow is not here. There is no Python 2: python2 runs Strelka's run scripts only.

Kraken2 and Bracken (added on 12 October 2026)
  Kraken2 2.17.2 and Bracken 3.1 in ../../genomics-wasm/, and the example data in data/examples/metagenomics/, come
  from the same project at commit ebe345482f587ca151ffd54fc65c36f520a8a1ae (12 October 2026). Their parts of the
  repository, in its layout:
  scripts/           build-kraken2.sh, build-bracken.sh, fetch-metagenomics-test-data.py (how the example data was
                     made from its sources, and checked)
  tools/kraken2/     README.md, browser.patch, abi-check.cc (the checks of the 64-bit database layout), build.py,
                     sources.lock.json, the licences
  tools/bracken/     README.md, browser.patch, build.py, sources.lock.json, runtime-sources.json, the licences and
                     runtime-notices/ (those of the Python it runs in)
  runtime/           kraken2.mjs, bracken.mjs, bracken-execute.mjs, bracken-worker.mjs, and KRAKEN2.md, BRACKEN.md (how
                     they work). kraken2.mjs (MIT) is used unchanged, next to the programs; assets/js/python-worker.mjs
                     here runs Bracken's Python programs as bracken-execute.mjs does.
  datasets/metagenomics/ README.md (what the example data is), manifest.json (its files, with their SHA-256),
                     provenance/sources.lock.json (the sources: ENA's reads, NCBI's sequences and taxonomy)
  Source code included here (in ../sources/): Bracken 3.1 (GNU GPL 3 or later). Kraken2 is under the MIT licence;
  its source is where tools/kraken2/sources.lock.json points. Bracken's Python programs run in the Pyodide that
  Cutadapt uses – one copy, ../../genomics-wasm/pyodide/314.0.7/ (its source, and hiwire's: ../sources/, as above).
  What was done for this site:
    workbench/build-kraken2-and-bracken-for-workbench.sh  the builds, step by step (as for Cutadapt and the somatic
                                            callers: the build machine's folders mapped out of the programs' strings,
                                            and GitHub's archives made again with recreate-github-archive.sh)
    workbench/build-bracken-offline-bzip2.py  runs tools/bracken/build.py unchanged, accepting the one archive that
                                            could not be made again byte for byte (see the script)
  Neither is linked again: each program runs as built, each command in a worker of its own (threads-worker.mjs;
  python-worker.mjs for Bracken's Python programs), with no need for a cross-origin isolated page. Kraken2's and
  Bracken's own scripts – kraken2, kraken2-build and kraken2-inspect (Perl and shell), bracken and bracken-build
  (shell) – are not run: assets/js/metagenomics.js does what they do, with their options, checks and messages.

  How they were made and checked (12 October 2026)
  1. Native programs from the unchanged sources, native programs with the port's changes, and the WebAssembly programs,
     with each tool's script ("all"); Emscripten 3.1.64; CPython 3.14.2 for Bracken's Python programs natively.
  2. The project's comparison in Node.js 22 passed: validate-metagenomics.mjs --tool all (Kraken2 13 of 13 cases,
     Bracken 14 of 14): real reads of a mock community (ERR2984773), with databases built natively and in WebAssembly
     and read by the other; the same classifications, reports, database files and distributions.
  3. In the workbench's terminal and in its Galaxy, with the example data, the results were compared with the native
     programs, run by Kraken2's and Bracken's own scripts: kraken2's reports (also with --use-mpa-style,
     --report-zero-counts, --report-minimizer-data, --confidence and --minimum-hit-groups), classifications, and
     classified and unclassified reads; kraken2-inspect's table; kraken2-build's hash.k2d and taxo.k2d; bracken's
     abundance tables and reports; bracken-build's database.kraken and distributions (151- and 100-base reads) – all
     the same, byte for byte. (kraken2-build's opts.k2d differs from a native build's in unused padding bytes only,
     which the port writes as zeros – tools/kraken2/README.md.)

  In the terminal of the workbench
  kraken2, kraken2-inspect, kraken2-build, bracken and bracken-build run these programs (and est_abundance.py,
  generate_kmer_distribution.py and kmer2read_distr, which Bracken's scripts run). Thread options are left out with a
  note: everything runs on one thread. kraken2-build cannot download (--download-taxonomy, --download-library,
  --standard, --special) and has no --add-to-library; databases are built from a library/, seqid2taxid.map and
  taxonomy/ that are there, without masking (--no-masking). A file of reads that is not there is an error here
  (upstream's kraken2 counts it as no reads); - is such a file name, as upstream – the standard input is /dev/stdin.
  Where Bracken's shell script reports an error but ends with status 0, bracken here ends with status 2.

Prodigal, HMMER and bustools (added on 13 October 2026)
  Prodigal 2.6.3, HMMER 3.4 and bustools 0.45.1 in ../../genomics-wasm/, and the example data in data/examples/bacteria/,
  data/examples/hmmer/ and data/examples/singlecell/, come from the same project at commit
  46c94182b10556cc636d634812019e2838e176af (13 October 2026). Their parts of the repository, in its layout:
  scripts/           build-prodigal.sh, build-hmmer.sh, build-bustools.sh, fetch-annotation-test-data.py and
                     fetch-bustools-test-data.py (how the test data was made from its sources, and checked)
  tools/prodigal/    README.md, browser.patch, abi-check.c (the layout of training files), build.py, sources.lock.json,
                     the licences
  tools/hmmer/       README.md, browser.patch, abi-check.c, compat/x86intrin.h (Emscripten's SSE2 header in place of
                     Clang's x86 one), build.py, sources.lock.json, the licences (LICENSE.embedded: the source files
                     with further notices)
  tools/bustools/    README.md, browser.patch, abi-check.cpp (the layout of BUS records), pre.js, build.py,
                     sources.lock.json, the licences
  runtime/           prodigal.mjs, hmmer.mjs, bustools.mjs and PRODIGAL.md, HMMER.md, BUSTOOLS.md (how genomics-wasm
                     runs them). The workbench does not use these three modules: its terminal starts each program in a
                     worker of its own (assets/js/threads-worker.mjs) and gives it its files (assets/js/tools-wasm.js).
  datasets/annotation/, datasets/bustools/  README.md (what the test data is), manifest.json (its files, with their
                     SHA-256), provenance/ (the sources: NCBI RefSeq; HMMER's release archive; kb_python's test files
                     and the BUStools getting_started release – and the maps of how the larger BUS file was renumbered)
  Source code included here (in ../sources/): Prodigal 2.6.3 (GNU GPL 3 or later) and bustools 0.45.1 – BSD itself, but
  it contains Eigen 3.3.7, under the Mozilla Public License 2.0, which asks for its source to be offered with it.
  HMMER is under the BSD licence; its source is where tools/hmmer/sources.lock.json points (eddylab.org's archive).
  What was done for this site:
    workbench/build-prodigal-hmmer-bustools-for-workbench.sh  the builds, step by step (as for Kraken2: the build
                                            machine's folders mapped out of the programs' strings, and GitHub's
                                            archives made again with recreate-github-archive.sh)
    workbench/build-hmmer-workbench.py      runs tools/hmmer/build.py unchanged for the WebAssembly programs, with one
                                            patch more after genomics-wasm's browser.patch:
    workbench/hmmer-easel-messages.patch    Easel takes a program whose parent process is process 1 for a daemon, and
                                            sends its error messages to syslog; Emscripten's getppid() always answers
                                            1, so the WebAssembly programs lost their messages (hmmpress's "Delete old
                                            hmmpress indices first", the reasons of "Failed to parse command line" …).
                                            Under Emscripten getppid() answers 2. A change of the workbench, not of
                                            genomics-wasm; the native programs are not changed.
  None is linked again: each program runs as built, each command in a worker of its own, with no need for a
  cross-origin isolated page. HMMER needs WebAssembly SIMD (its SSE2 code); Prodigal and bustools do not.

  How they were made and checked (13 October 2026)
  1. Native programs from the unchanged sources, native programs with the port's changes, and the WebAssembly programs,
     with each tool's script ("all"); Emscripten 3.1.64. Then HMMER's WebAssembly programs again, with the patch above.
  2. The project's comparison in Node.js 22 passed: validate-annotation.mjs --tool all (Prodigal 15 of 15 cases, HMMER
     33 of 33), validate-bustools.mjs (bustools 56 of 56) – and, after the second build, HMMER's 33 cases again: the
     same genes, training files, profiles, pressed databases, hits and alignments, BUS files, matrices and compressed
     files, with files made by one build read by the other.
  3. In the workbench's terminal and in its Galaxy, with the example data, the results were compared with the native
     programs: Prodigal's genes, proteins, gene sequences, starts and training files (GFF, GenBank, SCO; single and meta
     mode; from a file, a pipe and a redirection) and messages; the profiles, pressed databases, outputs and tables of
     hmmbuild, hmmsearch, hmmscan, hmmpress, phmmer, jackhmmer, nhmmer, nhmmscan, hmmalign, hmmemit, hmmfetch, hmmstat
     and hmmconvert, and their error messages; bustools' sorted, corrected and captured records, text, matrices (also
     with --genecounts and --umi-gene), barcode lists, compressed files and messages – all the same, byte for byte, but
     for what changes from one run to the next (HMMER's dates, times, working folder and command line; bustools sort's
     times) and the numbers of the equivalence classes that count lists without using them (see the NOTICE.txt of
     bustools).

  In the terminal of the workbench
  prodigal, the thirteen HMMER programs and bustools run these programs. HMMER's --cpu and bustools sort's -t N are left
  out (or made -t 1) with a note: everything runs on one thread; bustools sort's -m is at most 1 GB here (a larger one
  becomes -m 64M, with a note). HMMER cannot read files compressed with gzip – it starts gzip for them, which a web page
  cannot do – and says so; Easel's miniapps (esl-*), hmmpgmd and HMMER's MPI mode are not here. Prodigal reading from a
  pipe copies its input to a file first, as upstream does, with upstream's message.

PLINK 2 (added on 13 October 2026)
  PLINK 2.0.0-b.1-dev (12 Oct 2026) in ../../genomics-wasm/plink2/2.0.0-b.1-dev/, and the example data in
  data/examples/plink2/, come from the same project at commit 8eea96b9 (13 October 2026; its PLINK 2 port is commit
  d68433f). Their parts of the repository, in its layout:
  scripts/           build-plink2.sh, fetch-plink2-test-data.py (how the test data was made from its sources, and
                     checked)
  tools/plink2/      README.md, browser.patch (the port's two changes, under PLINK2_WASM_PORT), abi-check.cpp, build.py
                     (the NOLAPACK build: native, native with the port's changes, WebAssembly), mailbox.js (Emscripten's
                     mailbox for the threads, as for featureCounts), sources.lock.json, the licences
  runtime/           plink2.mjs and PLINK2.md (how genomics-wasm runs it: --threads 1 --memory 640 require unless given,
                     --threads 1 or 2, --memory 640 to 1024, no --script or --rerun). The workbench does not use this
                     module: its terminal starts each command in a worker of its own (assets/js/threads-worker.mjs),
                     gives it its files and adds those options itself (assets/js/tools-wasm.js).
  datasets/plink2/   README.md, manifest.json, provenance/ (DATA_REUSE.md: the 1000 Genomes data and its citation;
                     fixture-sources.json: how each file was made; sources.lock.json; upstream/: PLINK 2's test recipes;
                     PLINK2-COPYING, the GPL of those recipes)
  Source code included here (in ../sources/): PLINK 2 – GitHub's archive of plink-ng at commit 7211906, with the
  libraries it bundles – and zlib 1.3.2, which is part of it.
  What was done for this site:
    workbench/build-plink2-for-workbench.sh  the build, step by step (as for Prodigal, HMMER and bustools: the build
                                            machine's folders mapped out of the programs' strings, and GitHub's
                                            archives made again with recreate-github-archive.sh)
  Nothing is linked again: the program runs as built – plink2.mjs and plink2.wasm; Emscripten's plink2.worker.mjs is a
  placeholder that is never loaded, and is left out. PLINK 2 starts threads that share its memory (it reads its files on
  threads of their own even with --threads 1), so it needs a cross-origin isolated page, as featureCounts and Salmon do,
  and WebAssembly SIMD.

  How it was made and checked (13 October 2026)
  1. The native program from the unchanged source, the native program with the port's changes, and the WebAssembly
     program, with build-plink2.sh all; Emscripten 3.1.64.
  2. The project's comparison in Node.js 22 passed: validate-plink2.mjs --engine node, 41 of 41 cases – every result
     file the same as both native programs', byte for byte (the comparison allows printed rounding in the columns of
     numbers; none was needed), files written by one build read by the other, and the commands that must fail (--pca,
     --pheno-svd, a missing file) failing with native PLINK's status and message.
  3. In the workbench's terminal, with the example data, the results were compared with the unchanged native program:
     every command of the help page – import, frequencies, missingness, Hardy-Weinberg, filters, LD pruning and r2,
     linear, logistic and Firth regression, scores – and --make-bed with --bfile, --keep with --make-king-table,
     --export vcf, --pmerge-list, two threads and the errors: the same files, byte for byte (the VCF but for its date),
     and the same logs but for the host, the working folder, the times, the random seed and the memory found.

  In the terminal of the workbench
  plink2 runs this program. Unless they are given, the terminal adds --threads 1 --memory 640 require (640 MiB is the
  least working memory PLINK 2 takes); --threads above 2 becomes 2 and --memory above 1024 becomes 1024, with a note.
  --script and --rerun are refused (the terminal must see those options; in this development version --script also
  stops the native program, with a buffer overflow): plink2 $(cat FILE) does the same. Not in this build, which has no
  LAPACK: --pca and --pheno-svd – PLINK says so and stops.

MACS3 (added on 13 October 2026)
  MACS3 3.0.5, with hmmlearn 0.3.3, in ../../genomics-wasm/macs3/3.0.5/ – and the thirteen packages of Pyodide 314.0.7's
  own distribution that it needs (NumPy, SciPy, pandas, scikit-learn, h5py …), next to the shared Python in
  ../../genomics-wasm/pyodide/314.0.7/ – and the example data in data/examples/chipseq/ and atacseq/, come from the same
  project at commit c977980 (13 October 2026; its MACS3 port is commit 1b306c5). Their parts of the repository, in its
  layout:
  scripts/           build-macs3.py (HDF5 and h5py for Linux, MACS3 unchanged and with the port's changes for the
                     comparison, Emscripten 5.0.3, Pyodide's cross-build environment, the two WebAssembly wheels, and
                     dist/macs3/), fetch-macs3-test-data.py (how the test data was taken from MACS's repository, and
                     checked)
  tools/macs3/       README.md, browser.patch, integer-width.patch, hmmlearn-wasm.patch (the changes, and why),
                     sources.lock.json (every source archive, compiler download, Pyodide package and Python build
                     dependency, with its SHA-256), build-requirements.lock, native-entry.py (how the native programs are
                     started for the comparison), check-wheel-dependencies.py, extract-scientific-notices.py, the
                     licences; its notices – cython-notices/, runtime-notices/, scientific-notices/ – are in
                     ../../genomics-wasm/macs3/3.0.5/, the same files
  runtime/           macs3.mjs, macs3-worker.mjs, macs3-execute.mjs and MACS3.md: how genomics-wasm runs it. The workbench
                     does not use these modules: assets/js/python-worker.mjs was adapted from macs3-execute.mjs (the same
                     checks of the manifest, of every package and of Pyodide's catalogue, the same order of installation,
                     the same synchronous compilation while the packages are installed – which WebKit needs –, and the
                     same version checks); its terminal gives each command its files (assets/js/tools-wasm.js)
  datasets/macs3/    README.md, manifest.json, provenance/ (DATA_REUSE.md: the test data of MACS and how it may be used;
                     fixture-sources.json: how each file was made; sources.lock.json: the files of MACS's repository,
                     with their SHA-256 and git blobs)
  Source code included here (in ../sources/): pyodide-recipes 314-20260911 (Mozilla Public License 2.0), the recipes
  with which Pyodide built its packages. Pyodide and hiwire were there already. MACS3, hmmlearn and the other packages
  are under permissive licences (BSD, MIT, Apache 2.0) and their sources are where the lock file points.
  What was done for this site:
    workbench/build-macs3-for-workbench.sh   the build, step by step: the archives fetched first (two that GitHub makes,
                                            of HDF5 1.12.1 and pyodide-recipes, made again with recreate-github-archive.sh
                                            – byte for byte), then the repository's script without network access, with
                                            the build machine's folders mapped out of the programs' strings
    workbench/build-macs3-offline-bzip2.py  runs build-macs3.py unchanged, accepting the one archive that cannot be made
                                            again byte for byte (as for Cutadapt and Bracken)

  How it was made and checked (13 October 2026)
  1. MACS3 from the unchanged source and with the port's changes, for CPython 3.14.2 on Linux (with HDF5 1.12.1 and
     h5py 3.13.0 compiled for it), and the WebAssembly wheels of MACS3 and hmmlearn, with build-macs3.py all.
  2. The project's comparison in Node.js 22 passed: validate-macs3.mjs --engine node, 39 of 39 cases – all fourteen
     commands with MACS's own test data – against both native programs: 99 of the 103 result files the same byte for
     byte (peaks, summits, bedGraph tracks, tables, states, variant calls), the other four – models: the R scripts of
     callpeak's and predictd's model, the HMMs that hmmratac trains – the same but for their last decimals (1.3e-12,
     relative, at most; the comparison allows such differences).
  3. In the workbench's terminal and in its Galaxy, with the example data, the results were compared with the unchanged
     native program: every command of the help page Peaks (callpeak on single-end reads and on fragments, bdgcmp,
     hmmratac), bdgopt, and the Galaxy tool MACS3 callpeak (narrow, and broad without a model) – the same peaks,
     summits, bedGraph tracks, tables and accessible regions, byte for byte (the tables but for the paths of the data,
     which MACS3 writes as they were typed), and the same models but for their last decimals; also in a page opened with
     plain http:// from another computer, where the packages' SHA-256 is computed in JavaScript.

  In the terminal of the workbench
  macs3 runs this program. Each command starts the Python of Cutadapt in a worker of its own, installs the packages and
  runs MACS3's command line – a few seconds; the first time about 45 MB are loaded. callvar -m N runs its N parts one
  after another (the port's change), with the same result. The memory that MACS3 uses is not measured: its messages say
  [RSS unavailable].
