# Bioinformatics workbench

**A workbench in the browser for students who have done the practicals: Jupyter-style notebooks in Python and R, a Linux terminal with real bioinformatics programs, Galaxy, public databases, a 3D structure viewer, a genome browser and an AI assistant – with a guide to every tool in the help pane.**

Everything runs in the student's browser. The programs are the real ones – fastp, minimap2, Bowtie 2, BWA, BWA-MEM2, HISAT2, samtools, mosdepth, featureCounts, StringTie, kallisto, Salmon, bcftools, FreeBayes, bedtools, seqtk, Kalign, MUSCLE, FastTree, gffread, LASTZ and the GNU text tools – compiled to WebAssembly; Python is Pyodide (CPython 3.13), R is webR (R 4.6). Nothing is installed, there is no server-side code, and students' files are kept in their own browser. The site is static (HTML, CSS, JavaScript), so it can be hosted free on **GitHub Pages** or on any web server.

---

## Contents

1. [What is in it](#what-is-in-it)
2. [Before students use it](#before-students-use-it)
3. [Put it on GitHub Pages](#put-it-on-github-pages)
4. [Try it on your own computer](#try-it-on-your-own-computer)
5. [Settings: `config.js`](#settings-configjs)
6. [Python and R from your own server](#python-and-r-from-your-own-server)
7. [Editing the help, the starter notebooks and the examples](#editing-the-help-the-starter-notebooks-and-the-examples)
8. [What students keep](#what-students-keep)
9. [Privacy](#privacy)
10. [Browser support and limits](#browser-support-and-limits)
11. [How it was tested](#how-it-was-tested)
12. [Files](#files)
13. [Credits and licences](#credits-and-licences)

---

## What is in it

One page, `index.html`: the **help** on the left, the **workbench** on the right. The help can be hidden (button, or <kbd>Ctrl</kbd>+<kbd>\</kbd>) and the workbench made full screen.

| Tab | What it is |
| --- | --- |
| **Notebook** | Jupyter-style notebooks (`.ipynb`) in Python or R: code and Markdown cells, plots, tables, `%pip install`, `install.packages()` (Bioconductor too – DESeq2, edgeR, limma), `%%bash` and `!` cells with the terminal's programs. Download as `.ipynb`, `.py`/`.R` or `.html`. Two starter notebooks are put in `~/notebooks` on the first visit |
| **Terminal** | bash with the bioinformatics programs, `python`, `Rscript`, Snakemake (a browser edition), Graphviz `dot`, `curl`/`wget` for web services; *Save session* turns the commands typed into a notebook or a script |
| **Files** | the student's home folder and the read-only example data: an editor, viewers for tables, FASTA, alignments, trees, pictures, PDFs and HTML reports; upload, download (a folder as `.zip`) |
| **Galaxy** | a Galaxy in the style of usegalaxy.org: 36 tools (QC, mapping – minimap2, Bowtie2, BWA-MEM, BWA-MEM2, HISAT2 –, SAM/BAM with mosdepth, RNA-seq – featureCounts, StringTie, kallisto, Salmon –, variant calling – bcftools, FreeBayes –, intervals, alignments and trees, text) with Tool Shed IDs, a history kept in the browser, dataset details, a workflow editor, `.ga` import and export, and *history as a notebook* |
| **Databases** | 14 cards: UniProt and the PDB (full explorers), AlphaFold DB, InterPro, Ensembl (gene, sequence, VEP, orthologues, region), NCBI E-utilities, UCSC, ENA, BLAST at EBI, STRING, Reactome, Gene Ontology (QuickGO, OLS), Europe PMC, PubChem. Every answer can be saved to the files or sent to a notebook as Python or R code; *Your queries* become one notebook |
| **3D viewer** | NGL: PDB entries, AlphaFold models, files; styles, colours, selections, binding sites and contacts, distances, labels, superposition, saved views, a command language; pictures to the files or to the computer |
| **Genome browser** | igv.js: the example genome (two slices of chromosome 10, with genes), hosted genomes (hg38, hg19, mouse, zebrafish, fly, worm, yeast) or a FASTA file; BAM, VCF, BED, GFF and bigWig tracks |
| **AI assistant** | a chat that sees what the student chooses (the open notebook's code, file names, last commands) and puts code into the notebook or terminal; an **agent** that carries out a task in the terminal in a folder of its own and keeps a record as a notebook. The student connects a model of their own (Gemini, Claude, or any OpenAI-compatible service) |

**The help** has 43 pages in 11 groups – a first session, every tab, every program, recipes and reference (programs and versions, keyboard shortcuts, limits, troubleshooting, privacy, credits). Code boxes have *Run in the terminal* or *Add to notebook*; ▶ buttons do what the text describes (open a card with a query, load a structure, go to a locus …). The six **recipes** – reads to variants, RNA-seq reads to differential expression (HISAT2, featureCounts, DESeq2, edgeR), from a protein to its structure, a table in Python and in R, databases from code, keeping your work – each open as a notebook with one button.

**Everything a student runs can become a notebook**: notebooks themselves, terminal sessions, Galaxy histories, database queries, the AI agent's runs and the recipes.

## Before students use it

1. **Computers and browsers.** A laptop or desktop with a current Chrome, Edge, Firefox or Safari; 8 GB of memory is comfortable. The 3D viewer needs WebGL (hardware acceleration on). Phones work, cramped.
2. **Network.** Besides your site, the students' browsers must reach:
   - `cdn.jsdelivr.net` (Python: the page downloads it in the background as soon as a Python notebook is open – and when it starts, the page opens the last notebook the student had open, a Python one on the first visit), `webr.r-wasm.org`, `repo.r-wasm.org`, `bioc-release.r-universe.dev`, `cran.r-universe.dev` and `r2.ropensci.org` (R and its packages), `pypi.org` and `files.pythonhosted.org` (`%pip install`);
   - the databases: `www.ebi.ac.uk`, `rest.uniprot.org`, `alphafold.ebi.ac.uk`, `rest.ensembl.org` (and `grch37.rest.ensembl.org`), `eutils.ncbi.nlm.nih.gov`, `pubchem.ncbi.nlm.nih.gov`, `data.rcsb.org`, `search.rcsb.org`, `files.rcsb.org`, `models.rcsb.org`, `cdn.rcsb.org`, `api.genome.ucsc.edu`, `string-db.org`, `reactome.org`, `ftp.sra.ebi.ac.uk`;
   - for the hosted genomes of the genome browser: the IGV team's list of genomes (`igv.org`) and the files it points to (`hgdownload.soe.ucsc.edu`, or – when that does not answer – its copy `genome-browser.s3.us-east-1.amazonaws.com`);
   - the AI service each student uses (for Gemini: `generativelanguage.googleapis.com`).
3. **AI keys.** The assistant uses a key that each student enters; it is kept only in the browser tab (never in a file or in the browser's long-term storage). Decide which service the students use, and tell them before:
   - **Google Gemini**: a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (a Google account; 18 or over). The free tier allows a few requests per minute and a limited number per day for each model; when a model is busy or over its limit, the page asks the next model of `geminiFallbackModels`. Read Google's [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) first. On the free tier Google may use what is sent to improve its products, and people may read it – but for users in the European Economic Area, Switzerland and the United Kingdom the data terms of the paid service apply to the free tier too. The same terms say that API clients made available to users in those regions may use only the paid service: whether a course page on which each student uses a key of their own counts as such a client is for your institution to decide.
   - **Anthropic (Claude)** – a paid key; or **any OpenAI-compatible service** that allows requests from web pages (CORS), such as one your university provides: the address, the model and, if it needs one, a key.
   - Check that the model names in `config.js` are current ([Gemini models](https://ai.google.dev/gemini-api/docs/models)).
4. **Shared computers.** Students' files are kept in the browser profile. Computers that wipe profiles at log-out lose them: tell students to download their work (*My files → Download all my files*), and to use *Start afresh* when they leave a shared computer.
5. **Personal and patient data.** The workbench is for public data. The help and the AI settings tell students never to put personal or patient data into it or into an AI tool.

## Put it on GitHub Pages

**First put the two parts together.** The workbench comes as two zip files: `bioinformatics-workbench.zip`, the site, and `bioinformatics-workbench-sources.zip`, the source code of the bundled programs that are under the GNU General Public License (seventeen archives, 82 MB). Unzip both, and move the seventeen archives from the folder `sources` into `bioinformatics-workbench/assets/vendor/licenses/sources/` (a `README.txt` in that folder lists them). The site works without them, but the licence asks whoever publishes those programs to offer their source code with them – see [Credits and licences](#credits-and-licences).

1. On GitHub, create a **new repository** (for example `bioinformatics-workbench`). It must be public unless your plan supports Pages for private repositories.
2. Upload the site: `index.html` must be at the **top level**, with `assets/` and `data/` beside it.
   - **With [GitHub Desktop](https://desktop.github.com/)** (easiest): *File → Add local repository* (choose the unzipped folder and let it create a repository), *Commit*, then *Publish repository* with “Keep this code private” unticked. GitHub's upload page in the browser is not suitable: it takes at most 100 files at a time, and the site has about 600.
   - **Or with git:**
     ```bash
     cd bioinformatics-workbench
     git init && git add . && git commit -m "Bioinformatics workbench"
     git branch -M main
     git remote add origin https://github.com/<you>/bioinformatics-workbench.git
     git push -u origin main
     ```
3. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
4. After a minute the site is at `https://<you>.github.io/bioinformatics-workbench/`. Share that address. The first time a browser opens it, the page loads once more by itself: it installs a small service worker (`isolation-sw.js`, next to `index.html`) that makes the page *cross-origin isolated*, which featureCounts and Salmon need for their threads (see [Browser support and limits](#browser-support-and-limits)).

The empty file `.nojekyll` stops GitHub from processing the site. The folder `build/` is not needed by the site (it builds `index.html`); keep `assets/vendor/licenses/`. On any other web server: copy the folder; it needs no server-side code, but it must answer HTTP range requests (all common servers do), which the genome browser uses.

**Students' files belong to the address.** They are kept by the browser for the site's address: if the workbench moves to another address, students start with an empty home folder there (their files stay at the old address). Two copies of the workbench on one address share their files unless their `storePrefix` differs.

## Try it on your own computer

Opening `index.html` directly (`file://…`) does not work – browsers block the Web Workers and the data files. Serve the folder instead:

```bash
cd bioinformatics-workbench
python3 serve.py 8000        # then open http://localhost:8000
```

`serve.py` answers range requests and sends the headers of cross-origin isolation itself. Any other local server works too (the service worker isolates the page), as long as the address is `localhost` or `https`.

## Settings: `config.js`

`assets/js/config.js` is the only file to edit for most changes. **Never put an API key in it**: anyone can read the files of a public site.

| Setting | What it does |
| --- | --- |
| `courseTitle`, `courseSubtitle` | the name at the top of the page (and in the browser's tab) and the line under it |
| `hostname` | the computer's name in the terminal's prompt (`student@workbench`) |
| `storePrefix` | the prefix of everything kept in the browser (files, notebooks, settings). Change it only if two copies of the workbench on one address must not share their files |
| `pyodideBase`, `pythonPreload` | where Python comes from, and the packages loaded when it starts |
| `webrBase`, `rRepos`, `rLocalRepo` | where R comes from, the repositories of R packages (CRAN for webR; the current Bioconductor release and CRAN on r-universe), and the site's own packages, looked in first (`assets/vendor/r-packages/`: locfit, for DESeq2 and edgeR) |
| `biowasmBase` | the folder of the WebAssembly programs |
| `threadsBase` | the folder of the two programs that work on several threads, featureCounts and Salmon (`assets/vendor/genomics-wasm/`) |
| `liveProvider`, `geminiModel`, `geminiFallbackModels`, `anthropicModel` | the AI service offered first and its models. Models are retired from time to time: put current ones here |
| `aiWaitSeconds` | how long the assistant waits for an answer before it asks the next model |
| `agentCommandSeconds` | after how many seconds a step of the AI agent that has not ended is stopped |
| `storageWarnMB` | from how many megabytes of files the page warns the student (the indicator at the top, and a message once a visit) |

## Python and R from your own server

By default the browser downloads Python (Pyodide, about 30 MB for the core and the first packages) from jsDelivr as soon as a Python notebook is open, and R (webR) from `webr.r-wasm.org` when an R notebook is open – the page opens the last notebook the student had open (a Python one on the first visit); it keeps a copy in its cache for the next visits. To serve them with the site instead – for a network that blocks those servers:

- **Python**: download the Pyodide 0.29.5 release (`pyodide-0.29.5.tar.bz2` from [github.com/pyodide/pyodide/releases](https://github.com/pyodide/pyodide/releases)), unpack it as `assets/vendor/pyodide/`, and set `pyodideBase: 'assets/vendor/pyodide/'`. The full release is large (several hundred MB in thousands of files): copy only the packages you need if you host on GitHub Pages (a repository should stay under 1 GB).
- **R**: download the webR 0.6.0 release, unpack it as `assets/vendor/webr/`, and set `webrBase: 'assets/vendor/webr/'`. R packages still come from `rRepos`; mirroring them is possible with the [rwasm](https://r-wasm.github.io/rwasm/) tools.

## Editing the help, the starter notebooks and the examples

The page is built from parts in `build/`. After any change there, run:

```bash
python3 build/make_page.py        # writes index.html; warns about links to pages that do not exist
```

- **Help pages**: `build/help/NN-name.html`, one file per page, in the order of their names. The first line names the page: `<!-- id: h-name | title: … | group: … | summary: … | keys: words for the search -->`; the groups are listed in `make_page.py`. Links between pages: `<a href="#h-name">` (or `#h-name/anchor` for a heading with `data-anchor="anchor"`). Code: `<pre class="code" data-run="term|py|r"><code>…</code></pre>` gets *Run in the terminal* or *Add to notebook*, and *Copy*. Buttons (`<button class="do" type="button" …>`) act through attributes: `data-term-run` (run a command), `data-term` (type it), `data-bench` (open a tab), `data-goto` (open a help page), `data-open` (open a file), `data-new-nb="python|r"`, `data-open-nb` (a notebook), `data-cmd` (a script of the 3D viewer), `data-igv` (a locus), `data-api="card:form:value"` (a query in the Databases tab) and `data-recipe="python|r"` (the page as a notebook). `<!--ICON:name-->` puts in an icon of `assets/js/icons.js`.
- **Starter notebooks**: `python3 build/make_starters.py` writes `data/starter/*.ipynb` from the text in that script. They are copied into `~/notebooks` on a student's first visit (a file of the same name is left alone).
- **Example data**: `data/examples/` – read-only for students, with a `README.md` that describes every file. After adding or changing a file, run `make_page.py` (the page lists the files and their sizes).
- **Programs**: after a change in `assets/vendor/`, run `python3 build/vendor_sums.py` to write the checksum lists again.

## What students keep

Students' files – notebooks, results, uploads, Galaxy's history – are kept in their browser's storage for the site (IndexedDB), on their computer, and are there when they come back in the same browser. They are not on any server, and nobody else can see them. Another browser, another computer or a private window has none of them, and clearing the browser's site data deletes them. *My files → Download all my files* downloads everything as a `.zip`; every notebook downloads as `.ipynb`. The help page *Keep and share your work* explains this to students.

## Privacy

The site sets no cookies and has no tracking or analytics. What leaves a student's computer: requests for the page and its programs (your server), Python and R and their packages (the CDNs above), the queries the student makes to public databases (and, for BLAST, an e-mail address that EBI asks for), structures and genome regions the student opens (RCSB PDB, AlphaFold DB, the hosted genomes), and – only when the student connects a model – the questions, and what the student chooses to send with them, to the AI service of their choice, with their own key. The help page *Your data and privacy* lists it for students.

## Browser support and limits

Current Chrome, Edge, Firefox and Safari. Each program runs on one processor core with a few gigabytes of memory at most (featureCounts counts on up to four threads, and Salmon runs helper threads): regions of a genome, exomes of a few genes, bacterial and viral genomes work; a whole human genome does not. Web services must allow requests from web pages (CORS): the big bioinformatics services do; KEGG and most web pages do not. R in the browser can only make GET requests. Some R packages have no build for webR yet; DESeq2 and edgeR work (locfit, which they need, comes with the site). The help page *What is different in the browser* explains the limits to students.

**Cross-origin isolation.** featureCounts and Salmon start threads that share memory (`SharedArrayBuffer`), which browsers allow only in a page served with the headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot send them, so `assets/js/isolation.js` registers `isolation-sw.js`, a service worker that adds them to the page and its workers (it caches nothing): on the first visit the page loads once more by itself, and is isolated from then on. Under these headers a page may show pictures of other sites only if those sites allow it; the service worker asks for them in the way that lets them (CORS) – the RCSB and Reactome do. Isolation needs `https` (or `localhost`) and a browser that allows service workers there (some private windows do not); where it is missing, featureCounts and Salmon say so and the rest of the workbench works as before. `?isolation=off` at the end of the address removes the service worker. It was tested in Chromium; test Firefox and Safari on your students' computers.

## How it was tested

The workbench was tested in Chromium (Playwright) on 10 October 2026, again after BWA, HISAT2, FreeBayes and DESeq2 were added on 11 October 2026, and again – twice: as an ordinary page, and cross-origin isolated – after BWA-MEM2, featureCounts, StringTie, kallisto, Salmon and mosdepth were added later that day: every code block and every button of the help pages (terminal blocks run in order, Python and R blocks in notebooks), the recipes as notebooks from the first cell to the last (six notebooks, among them the RNA-seq recipe with featureCounts, DESeq2 and edgeR), the 36 Galaxy tools and a workflow (with the history-as-notebook re-made byte for byte), the Files viewers, the 3D viewer and the genome browser, the programs of the genomics-wasm project against native builds of the same sources (index files, SAM, VCF and GTF records, count tables, depths, abundances), the service worker that isolates the page (installed on the first visit, the page loaded once more, featureCounts run, pictures of the RCSB shown, `?isolation=off`), every database card against the real services (BLAST against a stand-in, so as not to send jobs to EBI), and the layout at phone and desktop widths. The AI assistant's chat and agent were tested against stand-ins of the AI services with a dummy key: before you rely on them, try them with a real key on the network the students use. Public services are sometimes slow or down – on the day of testing, EMBL-EBI's services answered with errors for a while, and at the last run Ensembl's orthologue service (`/homology`) did not answer at all; the cards then say that the service is not answering.

## Files

```
index.html             the page (built by build/make_page.py)
isolation-sw.js        the service worker that makes the page cross-origin isolated (keep it next to index.html)
assets/js/             the workbench: config.js (settings), the tabs, the shell, the kernels, the AI assistant
assets/css/            styles
assets/py/smk.py       the browser edition of Snakemake
assets/vendor/         bundled programs and libraries, with their licences (see THIRD_PARTY.md); genomics-wasm/: the
                       two programs that work on several threads (featureCounts, Salmon)
data/examples/         the example data (read-only for students) and its README.md
data/starter/          the starter notebooks
build/                 make_page.py, help/ (the help pages), template.html, make_starters.py, vendor_sums.py
serve.py               a small local web server (optional)
THIRD_PARTY.md         the third-party software and data, their licences and sources
```

## Credits and licences

The workbench is built from open-source programs and libraries and open data – fastp, seqtk, wgsim, minimap2, Bowtie 2, BWA, BWA-MEM2, HISAT2, SAMtools, mosdepth, featureCounts (Subread), StringTie, kallisto, Salmon, BCFtools, FreeBayes, HTSlib, bedtools, gffread, Kalign, MUSCLE, FastTree, seq-align, LASTZ, jq and the GNU tools (compiled by the Biowasm project, by the genomics-wasm project or for the course); the R package locfit (built for the site with genomics-wasm's recipe); Pyodide and webR; NGL, igv.js, CodeMirror, marked, DOMPurify, JSZip and Viz.js (Graphviz). Each keeps its own licence; **[THIRD_PARTY.md](THIRD_PARTY.md)** lists them all, with versions, licences, origins and the local changes. Several programs are under the GNU General Public License: their source code is in `assets/vendor/licenses/sources/` (handed over as the second zip file) – keep it with the site.

The example data are public: 1000 Genomes Project reads of NA12878, the UCSC hg19 reference, Ensembl annotation, GenBank and UniProt sequences, a yeast gene table from SGD, PaxDb, BioGRID, UniProt and AlphaFold DB, the PDB structure 1MBN, and RNA-seq data – yeast reads from nf-core/test-datasets and the airway gene counts from Bioconductor – see `data/examples/README.md`.
