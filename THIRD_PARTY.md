# Third-party software, data and source provenance

The Bioinformatics workbench bundles independently licensed programs and libraries, and uses others that the browser loads at run time. Each keeps its own licence: the MIT licence of the Biowasm build framework does **not** relicense the programs it compiled, and none of the licences below applies to the workbench's own text and code. Keep each component's notices and licence files when copying or redistributing its files.

## Command-line programs (WebAssembly, run in the browser)

These are the real programs, compiled to WebAssembly. They run on the student's own computer, inside the web page – in the Terminal, in notebook cells (`!`, `%%bash`) and as the tools of the Galaxy tab. Each folder `assets/vendor/biowasm/NAME/VERSION/` holds the program (`.wasm`, its JavaScript loader, sometimes a `.data` file), its licence, a `NOTICE.txt` (origin and local changes) and `SHA256SUMS`. (The folder of the base module has a notice and checksums only: its licence is the Biowasm licence in `assets/vendor/biowasm/LICENSE.txt`. The four files at the top of `assets/vendor/biowasm/` – the runner, its licence and the two descriptions of the local changes – have a `SHA256SUMS` of their own there.)

| Program | Version | Licence | Folder | Upstream source |
| --- | --- | --- | --- | --- |
| fastp | 0.20.1 | MIT | [fastp/0.20.1](assets/vendor/biowasm/fastp/0.20.1/) | [OpenGene/fastp](https://github.com/OpenGene/fastp/tree/v0.20.1) |
| seqtk | 1.4 | MIT | [seqtk/1.4](assets/vendor/biowasm/seqtk/1.4/) | [lh3/seqtk](https://github.com/lh3/seqtk/tree/v1.4) |
| wgsim | 0.3.1-r13 (Biowasm's build of 17 Oct 2011) | MIT | [wgsim/2011.10.17](assets/vendor/biowasm/wgsim/2011.10.17/) | [lh3/wgsim](https://github.com/lh3/wgsim) |
| minimap2 | 2.22 | MIT | [minimap2/2.22](assets/vendor/biowasm/minimap2/2.22/) | [lh3/minimap2](https://github.com/lh3/minimap2/tree/v2.22) |
| **Bowtie 2** (`bowtie2-align-s`, `bowtie2-build-s`) | 2.4.2 | **GNU GPL 3**; built with zlib (zlib licence) | [bowtie2/2.4.2](assets/vendor/biowasm/bowtie2/2.4.2/) | [BenLangmead/bowtie2](https://github.com/BenLangmead/bowtie2/tree/v2.4.2), [included](assets/vendor/licenses/sources/) |
| SAMtools | 1.17 | MIT/Expat | [samtools/1.17](assets/vendor/biowasm/samtools/1.17/) | [samtools](https://github.com/samtools/samtools/tree/1.17) |
| BCFtools (with its built-in HTSlib 1.10) | 1.10 | MIT/Expat (GPL only if built with the GNU Scientific Library, which it is not); HTSlib: MIT/Expat and modified 3-clause BSD | [bcftools/1.10](assets/vendor/biowasm/bcftools/1.10/) | [bcftools](https://github.com/samtools/bcftools/tree/1.10) |
| HTSlib utilities `bgzip`, `tabix` | 1.17 | MIT/Expat and modified 3-clause BSD | [htslib/1.17](assets/vendor/biowasm/htslib/1.17/) | [htslib](https://github.com/samtools/htslib/tree/1.17) |
| bedtools | 2.31.0 | MIT | [bedtools/2.31.0](assets/vendor/biowasm/bedtools/2.31.0/) | [arq5x/bedtools2](https://github.com/arq5x/bedtools2/tree/v2.31.0) |
| gffread (with GCLib) | 0.12.7 | MIT; GCLib: Artistic License 2.0 | [gffread/0.12.7](assets/vendor/biowasm/gffread/0.12.7/) | [gpertea/gffread](https://github.com/gpertea/gffread/tree/v0.12.7) |
| **Kalign** | 3.3.1 | **GNU GPL 3** | [kalign/3.3.1](assets/vendor/biowasm/kalign/3.3.1/) | [TimoLassmann/kalign](https://github.com/TimoLassmann/kalign/tree/v3.3.1), [included](assets/vendor/licenses/sources/) |
| MUSCLE | 3.8.1551 | public domain | [muscle/3.8.1551](assets/vendor/biowasm/muscle/3.8.1551/) | [drive5.com](https://drive5.com/muscle/muscle_src_3.8.1551.tar.gz) |
| **FastTree** | 2.1.11 | **GNU GPL 2 or later** | [fasttree/2.1.11](assets/vendor/biowasm/fasttree/2.1.11/) | [microbesonline.org/fasttree](http://www.microbesonline.org/fasttree/), [included](assets/vendor/licenses/sources/) |
| seq-align (`needleman_wunsch`, `smith_waterman`, `lcs`) | 2017.10.18 | public domain (the Unlicense) | [seq-align/2017.10.18](assets/vendor/biowasm/seq-align/2017.10.18/) | [noporpoise/seq-align](https://github.com/noporpoise/seq-align) |
| LASTZ | 1.04.52 | MIT | [lastz/1.04.52](assets/vendor/biowasm/lastz/1.04.52/) | [lastz/lastz](https://github.com/lastz/lastz/tree/1.04.52) |
| jq | 1.7 | MIT (and others, see its `COPYING`); with Oniguruma (2-clause BSD) | [jq/1.7](assets/vendor/biowasm/jq/1.7/) | [jqlang/jq](https://github.com/jqlang/jq/tree/jq-1.7) |
| **GNU coreutils**: `cat comm cut date fold head join md5sum paste seq shuf sort tail tee tr uniq wc` | 8.32 | **GNU GPL 3 or later** | [coreutils/8.32](assets/vendor/biowasm/coreutils/8.32/) | [release source](https://ftp.gnu.org/gnu/coreutils/coreutils-8.32.tar.xz), [included](assets/vendor/licenses/sources/) |
| **GNU Awk** (`gawk`, also as `awk`) | 5.1.0 | **GNU GPL 3 or later** | [gawk/5.1.0](assets/vendor/biowasm/gawk/5.1.0/) | [release source](https://ftp.gnu.org/gnu/gawk/gawk-5.1.0.tar.xz), [included](assets/vendor/licenses/sources/) |
| **GNU grep** | 3.7 | **GNU GPL 3 or later** | [grep/3.7](assets/vendor/biowasm/grep/3.7/) | [release source](https://ftp.gnu.org/gnu/grep/grep-3.7.tar.xz), [included](assets/vendor/licenses/sources/) |
| **GNU grep with PCRE2**, for `grep -P` | grep 3.11, PCRE2 10.42 | grep: **GNU GPL 3 or later**; PCRE2: 3-clause BSD with the PCRE2 exemption (`PCRE2-LICENCE`) | [grep/3.11](assets/vendor/biowasm/grep/3.11/) | [grep release source](https://ftp.gnu.org/gnu/grep/grep-3.11.tar.xz), [PCRE2 release source](https://github.com/PCRE2Project/pcre2/releases/tag/pcre2-10.42); both [included](assets/vendor/licenses/sources/) |
| **GNU sed** | 4.8 | **GNU GPL 3 or later** | [sed/4.8](assets/vendor/biowasm/sed/4.8/) | [release source](https://ftp.gnu.org/gnu/sed/sed-4.8.tar.xz), [included](assets/vendor/licenses/sources/) |
| **GNU diffutils**: `diff`, `cmp` | 3.10 | **GNU GPL 3 or later** | [diffutils/3.10](assets/vendor/biowasm/diffutils/3.10/) | [release source](https://ftp.gnu.org/gnu/diffutils/diffutils-3.10.tar.xz); source, patch and build script [included](assets/vendor/licenses/) |
| Biowasm base module and the Aioli runner (`aioli.js`, which includes Comlink) | base 1.0.0; Aioli from the Biowasm CDN, series 3 | MIT. Comlink: Apache 2.0 (Copyright 2019 Google LLC) | [notice and MIT licence](assets/vendor/biowasm/LICENSE.txt); [Apache 2.0](assets/vendor/licenses/Apache-2.0.txt) | [biowasm](https://github.com/biowasm/biowasm), [aioli](https://github.com/biowasm/aioli), [comlink](https://github.com/GoogleChromeLabs/comlink) |

Every `.wasm` file also contains parts of the Emscripten runtime and its C and C++ libraries (musl, libc++, compiler-rt: MIT; Apache 2.0 with LLVM exception), and, where compressed files are read, zlib (HTSlib-based programs also bzip2 and liblzma). The licence texts of these libraries are in [assets/vendor/licenses/runtime-libraries/](assets/vendor/licenses/runtime-libraries/).

**Where the builds came from.** All programs except Bowtie 2, `diff` and `cmp`, and the grep that carries out `grep -P` are builds of the [Biowasm](https://biowasm.com) project, downloaded from `https://biowasm.com/cdn/v3/NAME/VERSION/` between 30 September and 10 October 2026 (each `NOTICE.txt` has the date). Bowtie 2, `diff` and `cmp` of GNU diffutils, and GNU grep 3.11 with PCRE2 10.42, were compiled with Emscripten for the course – Bowtie 2 from its release source with a patch for the WebAssembly build (its Makefile; the search runs in the calling thread; a read file that cannot be opened is reported), `cmp` from its release source with a one-line patch, `diff`, grep and PCRE2 from theirs unchanged; they are not Biowasm builds. How each was built is in [assets/vendor/licenses/](assets/vendor/licenses/) (`bowtie2-build/`, `diffutils-build/`, `grep-perl-build/`).

**Local changes** – all listed in [assets/vendor/biowasm/RUNTIME-PATCHES.txt](assets/vendor/biowasm/RUNTIME-PATCHES.txt):

- The JavaScript loaders of the programs record each program's exit status. The Aioli runner has two added methods: `execIO` runs a program with real standard input, output and error – and starts every program afresh for each run, as a process is on Linux –, and `statTree` lists the shared file system in one answer; [execio-source.txt](assets/vendor/biowasm/execio-source.txt) is their readable source.
- In each of the 17 **coreutils** programs and in **grep** 3.7, **one byte** of the `.wasm` file is changed, which makes the C library's standard output unbuffered. Unchanged, these builds lose output that does not end with a newline (`tr`, `head -c`, `fold` …; `grep -lZ`, `grep -z`). The byte, the reason and the checksums of the files as downloaded are in the [coreutils notice](assets/vendor/biowasm/coreutils/8.32/NOTICE.txt) and the [grep notice](assets/vendor/biowasm/grep/3.7/NOTICE.txt); the script that makes the change is [unbuffer-stdout.py](assets/vendor/licenses/local-patches/unbuffer-stdout.py).
- In the loaders of **date** and **gawk** the day of the year is counted in calendar days ([fix-day-of-year.py](assets/vendor/licenses/local-patches/fix-day-of-year.py)): as downloaded, `date -d 2024-07-15` printed “invalid date” in zones with summer time.
- All other `.wasm` and `.data` files from Biowasm are unmodified.

**Source code of the GPL programs.** [assets/vendor/licenses/](assets/vendor/licenses/) – see its [README.txt](assets/vendor/licenses/README.txt) – holds:

- the full text of the GPL version 3 ([GPL-3.0.txt](assets/vendor/licenses/GPL-3.0.txt)) and of the Apache License 2.0 ([Apache-2.0.txt](assets/vendor/licenses/Apache-2.0.txt), for Comlink);
- the release sources of Bowtie 2, Kalign, FastTree, the five GNU packages (coreutils, diffutils, gawk, grep 3.7 and 3.11, sed) and PCRE2 10.42 in [sources/](assets/vendor/licenses/sources/), with origins and SHA-256 values in [source-archives.json](assets/vendor/licenses/source-archives.json);
- for Bowtie 2, `diff` and `cmp`, and the grep that carries out `grep -P`: the build scripts and instructions;
- for the Biowasm builds: the recipes (scripts and patches) of the programs used here, from one pinned commit ([`97bb232`](https://github.com/biowasm/biowasm/tree/97bb23225892ba5cc59ba0deac8b212b957db66a)), in [biowasm-build/](assets/vendor/licenses/biowasm-build/), listed with checksums in [biowasm-build-manifest.json](assets/vendor/licenses/biowasm-build-manifest.json). The commit and toolchain of the original CDN builds are not known, so this is a pinned recipe for inspection and rebuilding, **not** a claim that rebuilding gives identical binaries;
- the licence texts of the libraries inside the programs (Emscripten's runtime, musl, LLVM's libraries, zlib, bzip2, liblzma) in [runtime-libraries/](assets/vendor/licenses/runtime-libraries/);
- the scripts of the local changes to downloaded files in [local-patches/](assets/vendor/licenses/local-patches/).

The GPL's terms for distributing compiled programs and their Corresponding Source are in its section 6. Whoever hosts this site should keep `assets/vendor/licenses/` and this file with it. Copyright statements of the programs and of the code they include remain in their source releases; a licence label in the table above does not replace the notices in individual source files.

## JavaScript libraries (bundled)

| Library | Version | Licence | Files |
| --- | --- | --- | --- |
| NGL Viewer (the 3D viewer; includes three.js r158, MIT; chroma.js 1.4.1, 3-clause BSD, with the ColorBrewer colours, Apache 2.0; JS Signals and a k-d tree, MIT) | 2.5.0 | MIT | [assets/vendor/ngl/LICENSE](assets/vendor/ngl/LICENSE), [THIRD-PARTY-NOTICES.txt](assets/vendor/ngl/THIRD-PARTY-NOTICES.txt) |
| igv.js (the genome browser; includes pako, MIT and zlib) | 3.8.9 | MIT | [assets/vendor/igv/LICENSE](assets/vendor/igv/LICENSE) |
| CodeMirror 5 (editors, with the Python, R, YAML, shell, Markdown and JavaScript modes and three add-ons) | 5.65.18 | MIT | [assets/vendor/codemirror/LICENSE](assets/vendor/codemirror/LICENSE) |
| marked (Markdown in notebooks and AI answers) | 18.0.13 | MIT | [assets/vendor/marked/LICENSE](assets/vendor/marked/LICENSE) |
| DOMPurify (cleans formatted text before display) | 3.4.16 | Apache 2.0 or MPL 2.0 | [assets/vendor/dompurify/LICENSE](assets/vendor/dompurify/LICENSE) |
| JSZip (zip files; includes pako) | 3.10.1 | MIT or GPL v3 (pako: MIT) | [assets/vendor/jszip/LICENSE.markdown](assets/vendor/jszip/LICENSE.markdown) |
| Viz.js (Graphviz for `dot` and `snakemake --dag \| dot`) | 3.31.0 | MIT | [assets/vendor/viz/LICENSE](assets/vendor/viz/LICENSE), [NOTICE](assets/vendor/viz/NOTICE.txt) |
| – Graphviz, compiled into Viz.js | 16.1.0 | Eclipse Public License 1.0 | [GRAPHVIZ-EPL-1.0.txt](assets/vendor/viz/GRAPHVIZ-EPL-1.0.txt); [source](https://gitlab.com/graphviz/graphviz/-/tree/16.1.0) |
| – Expat, compiled into Viz.js | 2.8.5 | MIT | [EXPAT-COPYING.txt](assets/vendor/viz/EXPAT-COPYING.txt); [source](https://github.com/libexpat/libexpat/releases/tag/R_2_8_5) |

## Loaded at run time, not bundled

- **Pyodide 0.29.5** (MPL 2.0) – CPython 3.13 compiled to WebAssembly – is downloaded by the student's browser from the jsDelivr CDN (`https://cdn.jsdelivr.net/pyodide/v0.29.5/full/`) when a Python notebook is open (the page opens the last notebook the student had open, a Python one on the first visit), and then taken from the browser's cache. It provides CPython 3.13.2 (PSF licence) and the Pyodide builds of NumPy, pandas, Matplotlib, Biopython, SciPy, scikit-learn and the other packages a notebook imports, each under its own licence (see the [Pyodide package list](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)). Packages installed with `%pip` come from PyPI.
- **webR 0.6.0** – R 4.6.0 compiled to WebAssembly – is downloaded from `https://webr.r-wasm.org/v0.6.0/` when an R notebook is open, or R is first used in the terminal. The webR binaries are distributed under the GNU GPL 3 (R itself: GNU GPL 2 and 3); webR's JavaScript is MIT-licensed ([webR's licence notes](https://github.com/r-wasm/webr/blob/main/LICENSE.md)). R packages come from the webR repository (`repo.r-wasm.org`) and r-universe (`bioc.r-universe.dev`, `cran.r-universe.dev`, with downloads from `r2.ropensci.org`), each under its own licence.
- The **hosted genomes** of the genome browser are listed by the IGV team (`igv.org`), and their files come from there and from UCSC (`hgdownload.soe.ucsc.edu`, or its copy `genome-browser.s3.us-east-1.amazonaws.com`); **structures** from RCSB PDB and AlphaFold DB; the **Databases** tab and code in notebooks use public web services (EMBL-EBI, NCBI, RCSB PDB, UCSC, STRING, Reactome), each under its own terms of use.
- The **AI assistant** sends a student's messages – and the agent its commands and their output – to the AI service the student chose, with the student's own key. No AI model or service is part of the site.

## Re-implementations written for the course

These files contain no code from the programs they imitate. Their names, options and messages follow the real programs, so that what students learn transfers:

| File | Imitates | Licence of the real program |
| --- | --- | --- |
| `assets/py/smk.py` | [Snakemake](https://snakemake.github.io) 9.27 (the commonly used core) | MIT |
| `assets/js/galaxy.js` | the [Galaxy](https://galaxyproject.org) interface, histories, workflow editor and `.ga` workflow format; tool IDs name real Galaxy Tool Shed tools | MIT (since Galaxy release 26.0, 2026; before, the Academic Free License 3.0) |
| `assets/js/conda.js` | [conda](https://docs.conda.io) environments (`create`, `install`, `list`, `env export`, solver messages), with the real versions and dependencies of the packages | BSD 3-clause |

## Data

| Data (`data/examples/`) | Source | Terms |
| --- | --- | --- |
| `reads/NA12878_R1.fastq`, `_R2.fastq` | NA12878 exome reads (run SRR098401), from the [1000 Genomes phase 3 exome alignment](https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/phase3/data/NA12878/exome_alignment/) of NA12878, for two regions of chromosome 10 | open data of the 1000 Genomes Project, distributed by the International Genome Sample Resource ([IGSR disclaimer](https://www.internationalgenome.org/IGSR_disclaimer)); NA12878 is the widely used public reference sample (Coriell cell line GM12878) |
| `reads/reference.fa` (+ `.fai`) | two slices of the UCSC hg19 human reference (chr10) | [UCSC Genome Browser conditions of use](https://genome.ucsc.edu/conditions.html) |
| `variants/NA12878.calls.vcf.gz` (+ `.tbi`) | called from those reads with bcftools 1.10 | made for the course |
| `annotation/` | genes, transcripts and exons of the two slices, from Ensembl (GRCh37) | [Ensembl: no restrictions on use](https://www.ensembl.org/info/about/legal/disclaimer.html) |
| `sequences/pBR322.fasta` | the cloning vector pBR322, GenBank J01749.1 (Sutcliffe, 1979) | NCBI GenBank |
| `sequences/myoglobins.fasta`, `unknown_myoglobin.fasta` | myoglobin sequences from UniProt (horse P68082 and carp P02204 among them), as used in the course | UniProt: CC BY 4.0 |
| `sequences/tRNA-Thr.afa` | six human threonine tRNAs (named as in GtRNAdb), aligned, as used in the course | – |
| `tables/yeast_genes.csv` | 5,481 yeast genes: SGD, PaxDb v6.1, BioGRID 5.0.261, UniProt 2026_03, AlphaFold DB (downloaded 30 September 2026) | SGD, UniProt and AlphaFold DB: CC BY 4.0; BioGRID: MIT; PaxDb: see pax-db.org |
| `structures/1mbn.pdb` | sperm whale myoglobin, RCSB PDB 1MBN | PDB data: CC0 |

How the reads and reference were extracted – URLs, hashes, counts and limitations – is recorded in [data/examples/reads/provenance.json](data/examples/reads/provenance.json); [data/examples/README.md](data/examples/README.md) describes every file. The reads are real sequencing data; none are simulated.
