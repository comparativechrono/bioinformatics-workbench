/* =====================================================================
   Settings for the Bioinformatics workbench.
   Edit and re-upload this file; nothing else needs to change.
   Never put an API key in this file: anyone could copy it from a public site.
   ===================================================================== */
window.MG_CONFIG = {
  courseTitle: 'Bioinformatics workbench',
  courseSubtitle: 'Notebook · terminal · Galaxy · databases · 3D · genomes · AI – in your browser',

  /* The prefix of what the page keeps in the browser (files, notebooks, settings). Change it only
     if two copies of the workbench on one web site must not share their saved work. */
  storePrefix: 'biowb',
  hostname: 'workbench',

  /* Python in the browser (Pyodide). To host it with the site instead of the CDN, see
     "Python and R from your own server" in README.md and use 'assets/vendor/pyodide/'. */
  pyodideBase: 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
  /* Python packages loaded in the background once Python has started, so that the first
     import is quick. Any other Pyodide package loads when a cell imports it. */
  pythonPreload: ['numpy', 'pandas', 'matplotlib'],

  /* R in the browser (webR). R packages are downloaded when a notebook asks for them
     (install.packages("ggplot2")): CRAN packages from the webR repository, Bioconductor
     packages (the current release) from r-universe. */
  webrBase: 'https://webr.r-wasm.org/v0.6.0/',
  rRepos: ['https://repo.r-wasm.org', 'https://bioc-release.r-universe.dev', 'https://cran.r-universe.dev'],
  /* R packages that the repositories above have no browser build of, built for this site and
     looked in first: locfit, which DESeq2 and edgeR need (see the README.txt in that folder). */
  rLocalRepo: 'assets/vendor/r-packages',

  /* The WebAssembly bioinformatics programs of the terminal and of Galaxy. */
  biowasmBase: 'assets/vendor/biowasm',
  // the programs of the genomics-wasm project that run in a worker of their own: featureCounts, Salmon and PLINK 2 (on
  // several threads), Cutadapt, MACS3, LoFreq, SomaticSniper, Strelka2, Kraken2, Bracken, Prodigal, HMMER and bustools (see
  // tools-wasm.js: OWN_WORKER, somatic.js and metagenomics.js); and pyodide/314.0.7/, the Python that Cutadapt, MACS3 and
  // Bracken run in (with the packages that MACS3 needs)
  threadsBase: 'assets/vendor/genomics-wasm/',

  /* AI assistant. Each user enters their own API key in the assistant's settings; it is kept
     in the browser tab's memory (or, if the user ticks "Remember", in this tab's session
     storage, which is cleared when the tab closes) – never in this file or on the server.
     The service offered first ('gemini', 'anthropic' or 'openai') and the model of each.
     Models are retired from time to time: if the assistant reports that a model is not found,
     put a current one here (see ai.google.dev/gemini-api/docs/models). */
  liveProvider: 'gemini',
  geminiModel: 'gemini-3.8-flash',
  /* If that model is busy, over a limit or not found, the assistant asks these in turn. */
  geminiFallbackModels: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  aiWaitSeconds: 60,
  anthropicModel: 'claude-sonnet-5-5',
  /* The AI agent: after how many seconds a step that has not ended is stopped. */
  agentCommandSeconds: 150,

  /* How much the workbench may keep in this browser before it warns (megabytes). */
  storageWarnMB: 1500
};
