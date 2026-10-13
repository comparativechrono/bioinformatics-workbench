/* =====================================================================
   A Galaxy server that runs in the page.

   Tools panel · history of datasets (kept in the browser) · tool forms ·
   dataset details (tool, version, command line and parameters: Galaxy's
   provenance) · upload from your files, your computer or pasted text ·
   a graphical workflow editor with typed connections · workflow runs
   (invocations) · "extract workflow from history" · .ga export/import ·
   the history as a notebook that repeats every step (.ipynb).

   Jobs run the same WebAssembly programs as the terminal, in a job
   working directory, the way Galaxy does – so a workflow gives the same
   results as the same commands typed in the terminal.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const GX_ROOT = '/galaxy';
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  /** a word for the shell, in single quotes */
  const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  /** a read-group value: letters, digits and . _ - : only */
  const rgSafe = (s) => String(s || '').replace(/[^\w.:-]+/g, '_') || 'sample';
  const int = (v, d) => (Number.isFinite(+v) && String(v).trim() !== '' ? Math.round(+v) : d);

  /* ------------------------------------------------------------------ datatypes */
  const FORMATS = [
    ['fastqsanger', 'fastqsanger – reads (FASTQ, Sanger qualities)', 'fastq'],
    ['fasta', 'fasta – sequences, or an alignment', 'fasta'],
    ['sam', 'sam – alignments (text)', 'sam'],
    ['bam', 'bam – alignments (binary, sorted and indexed)', 'bam'],
    ['vcf', 'vcf – variants (text)', 'vcf'],
    ['vcf_bgzip', 'vcf_bgzip – variants (compressed with bgzip)', 'vcf.gz'],
    ['bcf', 'bcf – variants (binary)', 'bcf'],
    ['bed', 'bed – intervals', 'bed'],
    ['bedgraph', 'bedgraph – values along the genome', 'bedgraph'],
    ['gff3', 'gff3 – genome annotation', 'gff3'],
    ['gtf', 'gtf – genome annotation', 'gtf'],
    ['genbank', 'genbank – annotated sequences (GenBank)', 'genbank'],
    ['hmm3', 'hmm3 – profile HMMs (HMMER 3)', 'hmm3'],
    ['stockholm', 'stockholm – a multiple alignment (Stockholm)', 'stockholm'],
    ['bus', 'bus – single-cell records of kallisto bus (binary BUS)', 'bus'],
    ['mtx', 'mtx – a sparse matrix (Matrix Market)', 'mtx'],
    ['tabular', 'tabular – a table with tab-separated columns', 'tsv'],
    ['csv', 'csv – a table with comma-separated columns', 'csv'],
    ['txt', 'txt – plain text', 'txt'],
    ['json', 'json', 'json'],
    ['html', 'html – a report', 'html'],
    ['newick', 'newick – a phylogenetic tree', 'nwk'],
    ['sif', 'sif – a network (simple interaction format)', 'sif'],
    ['xgmml', 'xgmml – a network (XGMML, Cytoscape’s XML)', 'xgmml'],
    ['pdb', 'pdb – a 3D structure', 'pdb']
  ];
  const DOWNLOAD_EXT = Object.fromEntries(FORMATS.map((f) => [f[0], f[2]]));
  const TEXT = ['tabular', 'txt', 'csv', 'bed', 'bedgraph', 'vcf', 'gff3', 'gtf', 'sam', 'fasta', 'fastqsanger', 'json', 'genbank', 'hmm3', 'stockholm', 'mtx', 'sif', 'xgmml'];
  const NETWORKS = ['sif', 'xgmml'];
  const FEATURES = ['bed', 'bedgraph', 'vcf', 'vcf_bgzip', 'gff3', 'gtf'];
  const GENOMIC = ['bam', 'vcf', 'vcf_bgzip', 'bed', 'bedgraph', 'gff3', 'gtf'];
  const SNIFF = [
    [/\.(fastq|fq)$/, 'fastqsanger'], [/\.(fa|fasta|fna|faa|fas|afa|mfa)$/, 'fasta'], [/\.sam$/, 'sam'], [/\.bam$/, 'bam'],
    [/\.vcf\.gz$/, 'vcf_bgzip'], [/\.vcf$/, 'vcf'], [/\.bcf$/, 'bcf'], [/\.bed$/, 'bed'], [/\.(bedgraph|bg)$/, 'bedgraph'],
    [/\.(gff3|gff)$/, 'gff3'], [/\.gtf$/, 'gtf'], [/\.(gb|gbk|gbff|genbank)$/, 'genbank'], [/\.(hmm|hmm3)$/, 'hmm3'], [/\.(sto|stk|stockholm)$/, 'stockholm'], [/\.bus$/, 'bus'], [/\.mtx$/, 'mtx'], [/\.sif$/, 'sif'], [/\.xgmml$/, 'xgmml'],
    [/\.(tsv|tab|tabular)$/, 'tabular'], [/\.csv$/, 'csv'], [/\.json$/, 'json'],
    [/\.html?$/, 'html'], [/\.(nwk|newick|tree|treefile)$/, 'newick'], [/\.(pdb|ent)$/, 'pdb'], [/\.(txt|log|md)$/, 'txt']
  ];
  /** a datatype from the name of a file – or, when the name says nothing, from its first bytes */
  function sniff(name, head) {
    const n = String(name).toLowerCase();
    for (const [re, x] of SNIFF) if (re.test(n)) return x;
    const t = head || '';
    if (/^>/.test(t)) return 'fasta';
    if (/^@[^\n]*\n[^\n]*\n\+/.test(t)) return 'fastqsanger';
    if (/^##fileformat=VCF/.test(t)) return 'vcf';
    if (/^##gff-version 3/.test(t)) return 'gff3';
    if (/^HMMER3\//.test(t)) return 'hmm3';
    if (/^# STOCKHOLM 1\.0/.test(t)) return 'stockholm';
    if (/^%%MatrixMarket/.test(t)) return 'mtx';
    if (/^BUS\0/.test(t)) return 'bus';
    if (/^LOCUS {7}/.test(t)) return 'genbank';
    if (/^(HEADER|ATOM  |HETATM|REMARK)/.test(t)) return 'pdb';
    if (/^\s*[{[]/.test(t)) return 'json';
    if (/^[^\n]*\t/.test(t)) return 'tabular';
    return 'txt';
  }
  // files that are uncompressed on upload (Galaxy's tools here read them uncompressed)
  const GUNZIP = /\.(fastq|fq|fasta|fa|fna|faa|sam|bed|gff3?|gtf|tsv|tab|txt|csv|vcf_text|hmm|hmm3|sto|stk|gb|gbk|gbff)\.gz$/i;

  /* ------------------------------------------------------------------ the tools
     inputs:  {name, short, label, ext:[…], nice: 'file name' | (dataset) => name, pick?: /regex/, optional?}
     params:  {name, short, label, type: select|bool|int|float|text, default, options?, help?}
     outputs: {name, short, ext: 'type' | (params) => type | {from: input, map?}, file, when?: (inputs, params) => bool, label}
     command: (inputs: name → file in the job's folder, params) => the command line
     needs:   a program of the terminal – the tool is offered only if the program is there
     cite:    the references of the tool (keys of build/citations.json, in the page as window.WB_CITATIONS): those of the
              Galaxy Tool Shed tool – with the published paper in place of a preprint (fastp), and the paper of the
              program's own version added where the tool cites only an earlier one (Kraken, HISAT, BWA for BWA-MEM2, the
              HMMER web server, SAMtools 2009 for BCFtools); not GNU Parallel, which Galaxy's FreeBayes tool cites because
              it runs FreeBayes through it (here it does not). The workbench's own tools (Kalign, MUSCLE, bustools,
              PLINK 2) cite the papers that their programs ask for. Shown at the end of the tool's form, as Galaxy shows
              them. */
  const TS = 'toolshed.g2.bx.psu.edu/repos';
  const L = (tool, ins, what) => `${tool} on ${dataList(ins)}${what ? ': ' + what : ''}`;

  /* HMMER: the options IUC's hmmer3 tools share (their macros.xml), and their part of the command line, in the
     wrappers' order. --cpu is left out: here HMMER runs on one thread. */
  const hmmNum = (v) => (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(v == null ? '' : v).trim()) ? String(v).trim() : '');
  const hmmFormats = (list) => list.map(([name, label, on]) => ({ name, short: '--' + name, label: `Output Formats: ${label} (--${name})`, type: 'bool', default: on }));
  const HMM_OUT_OPTS = [
    { name: 'acc', short: '--acc', label: 'Prefer accessions over names in output (--acc)', type: 'bool', default: false },
    { name: 'noali', short: '--noali', label: "Don't output alignments, so output is smaller (--noali)", type: 'bool', default: false },
    { name: 'notextw', short: '--notextw', label: 'Unlimited ASCII text output line width (--notextw)', type: 'bool', default: false }
  ];
  const hmmThresholds = (dom, cut) => [
    { name: 'repopt_sel', short: 'threshold', label: 'Threshold option', type: 'select', default: 'evalue', options: [['evalue', 'E-value (reporting threshold)'], ['score', 'Score (reporting threshold)']].concat(cut ? [['--cut_ga', "Use profile's GA gathering cutoffs (model specific threshold)"], ['--cut_nc', "Use profile's NC gathering cutoffs (model specific threshold)"], ['--cut_tc', "Use profile's TC gathering cutoffs (model specific threshold)"]] : []), help: cut ? 'Gathering cutoffs are part of a profile – those of Pfam (fn3, Pkinase) and Dfam have them; a profile built from an alignment without them has none.' : '' },
    { name: 'E', short: '-E', label: 'E-value threshold (-E; threshold option “E-value”)', type: 'float', default: 10, help: 'Report sequences <= this E-Value threshold in output. Default: 10.0' },
    { name: 'incE', short: '--incE', label: 'consider sequences <= this E-Value threshold as significant (--incE; optional)', type: 'text', default: '' }
  ].concat(dom ? [
    { name: 'domE', short: '--domE', label: 'Domains E-value threshold (--domE; threshold option “E-value”)', type: 'float', default: 10, help: 'Report domains <= this E-Value threshold in output. Default: 10.0' },
    { name: 'incdomE', short: '--incdomE', label: 'consider domains <= this E-Value threshold as significant (--incdomE; optional)', type: 'text', default: '' }
  ] : [], [
    { name: 'T', short: '-T', label: 'Score Threshold (-T; threshold option “Score”)', type: 'text', default: '', help: 'Report sequences >= this score threshold in output.' }
  ], dom ? [
    { name: 'domT', short: '--domT', label: 'Domains Score Threshold (--domT; threshold option “Score”)', type: 'text', default: '', help: 'Report domains >= this score threshold in output.' }
  ] : []);
  const HMM_ACCEL = [
    { name: 'max', short: '--max', label: 'Turn all heuristic filters off (less speed, more power) (--max)', type: 'bool', default: false, help: 'With --max the three thresholds below and --nobias are left out: HMMER takes none of them with --max (Galaxy’s tool passes them all, and its job stops).' },
    { name: 'F1', short: '--F1', label: 'Stage 1 (MSV) threshold: promote hits w/ P <= F1 (--F1)', type: 'float', default: 0.02 },
    { name: 'F2', short: '--F2', label: 'Stage 2 (Vit) threshold: promote hits w/ P <= F2 (--F2)', type: 'float', default: 0.001 },
    { name: 'F3', short: '--F3', label: 'Stage 3 (Fwd) threshold: promote hits w/ P <= F3 (--F3)', type: 'float', default: 0.00001 },
    { name: 'nobias', short: '--nobias', label: 'Turn off composition bias filter (--nobias)', type: 'bool', default: false }
  ];
  const hmmAdvanced = (domZ) => [
    { name: 'nonull2', short: '--nonull2', label: 'Turn off biased composition score corrections (--nonull2)', type: 'bool', default: false },
    { name: 'Z', short: '-Z', label: '# of comparisons done for E-value calculation (-Z; optional)', type: 'text', default: '' }
  ].concat(domZ ? [{ name: 'domZ', short: '--domZ', label: '# of significant sequences, for domain E-value calculation (--domZ; optional)', type: 'text', default: '' }] : []);
  const HMM_SEED = { name: 'seed', short: '--seed', label: 'RNG seed, 0 generates a random seed (--seed)', type: 'int', default: 42 };
  const HMM_ALPHABET = (dna) => ({ name: 'input_format_select', short: 'alphabet', label: 'Format of sequence and model', type: 'select', default: dna ? '--dna' : '--amino', options: (dna ? [] : [['--amino', 'Protein']]).concat([['--dna', 'DNA'], ['--rna', 'RNA']]) });
  /** the output tables chosen, as files of the job */
  const hmmTables = (p, list) => list.filter((f) => p[f]).map((f) => ` --${f} ${f}.txt`).join('');
  /** null when the options are fine, else why not */
  const hmmCheck = (p, dom) => (p.repopt_sel === 'score' && (!hmmNum(p.T) || (dom && !hmmNum(p.domT))) ? `The threshold option “Score” needs a score threshold (-T)${dom ? ' and a domain score threshold (--domT)' : ''}.` : null);
  /** @OFORMAT_WITH_OPTS@ (without the tables) @THRESHOLDS@ @THRESHOLDS_DOM@ @ACCEL_HEUR@ … @ADV_OPTS@ @SEED@ */
  const hmmOpts = (p, o) => {
    const a = [];
    ['acc', 'noali', 'notextw'].forEach((f) => p[f] && a.push('--' + f));
    if (o.hssi && p.hssi_select === 'singlemx') a.push(`--popen ${+p.popen >= 0 && +p.popen < 0.5 ? +p.popen : 0.02} --pextend ${+p.pextend >= 0 && +p.pextend < 1 ? +p.pextend : 0.4}`);
    const inc = (opt, v) => (hmmNum(v) ? ` ${opt} ${hmmNum(v)}` : '');
    if (p.repopt_sel === 'score') {
      a.push(`-T ${hmmNum(p.T)}`);
      if (o.dom) a.push(`--domT ${hmmNum(p.domT)}`);
    } else if (/^--cut_(ga|nc|tc)$/.test(p.repopt_sel) && o.cut) a.push(p.repopt_sel);
    else a.push(`-E ${hmmNum(p.E) || 10}${inc('--incE', p.incE)}` + (o.dom ? ` --domE ${hmmNum(p.domE) || 10}${inc('--incdomE', p.incdomE)}` : ''));
    a.push(p.max ? '--max' : `--F1 ${hmmNum(p.F1) || 0.02} --F2 ${hmmNum(p.F2) || 0.001} --F3 ${hmmNum(p.F3) || 0.00001}${p.nobias ? ' --nobias' : ''}`);
    if (o.alphabet) a.push(['--dna', '--rna'].includes(p.input_format_select) ? p.input_format_select : '--dna');
    if (p.nonull2) a.push('--nonull2');
    if (hmmNum(p.Z)) a.push(`-Z ${hmmNum(p.Z)}`);
    if (o.domZ && hmmNum(p.domZ)) a.push(`--domZ ${hmmNum(p.domZ)}`);
    if (o.lengths) {
      if (hmmNum(p.w_beta)) a.push(`--w_beta ${hmmNum(p.w_beta)}`);
      if (/^\d+$/.test(String(p.w_length).trim())) a.push(`--w_length ${String(p.w_length).trim()}`);
    }
    a.push(`--seed ${Math.max(0, int(p.seed, 42))}`);
    return ' ' + a.join(' ');
  };
  /** a job that stops with a message (Galaxy's form would not let it start) */
  const refuse = (msg) => `echo ${shq(msg)} >&2 && false`;
  const HMM_HSSI = [
    { name: 'hssi_select', short: 'single sequences', label: 'Options for handling single sequence inputs', type: 'select', default: 'false', options: [['false', 'Disable'], ['singlemx', 'Use substitution score matrix for single-sequence inputs']], help: 'With a substitution score matrix: the gap open and extend probabilities below.' },
    { name: 'popen', short: '--popen', label: 'Gap open probability (--popen)', type: 'float', default: 0.02 },
    { name: 'pextend', short: '--pextend', label: 'Gap extend probability (--pextend)', type: 'float', default: 0.4 }
  ];
  const HMM_TABLES_DOM = [['tblout', 'Table of per-sequence hits', true], ['domtblout', 'Table of per-domain hits', true], ['pfamtblout', 'Table of hits and domains in Pfam format', true]];
  /** the outputs of hmmsearch, hmmscan and phmmer (IUC: output_dom_pfam) */
  const hmmOutputsDom = (tool) => [
    { name: 'output', short: 'output', ext: 'txt', file: 'output.txt', label: (ins) => L(tool, ins) },
    { name: 'tblout', short: 'per-sequence hits', ext: 'txt', file: 'tblout.txt', when: (i, p) => !!p.tblout, label: (ins) => L(tool, ins, 'per-sequence hits from HMM matches') },
    { name: 'domtblout', short: 'per-domain hits', ext: 'txt', file: 'domtblout.txt', when: (i, p) => !!p.domtblout, label: (ins) => L(tool, ins, 'per-domain hits from HMM matches') },
    { name: 'pfamtblout', short: 'Pfam-style hits', ext: 'txt', file: 'pfamtblout.txt', when: (i, p) => !!p.pfamtblout, label: (ins) => L(tool, ins, 'per-sequence/per-domain hits from HMM matches') }
  ];
  const MINIFAM = ['globins4', 'fn3', 'Pkinase'].map((n) => `/data/examples/hmmer/${n}.hmm`);
  const dsName = (ins, name) => ((ins.find((x) => x.name === name) || {}).ds || {}).name || name;

  const TOOLS = [
    /* ---------- Quality control ---------- */
    {
      id: 'fastp', toolId: `${TS}/iuc/fastp/fastp/0.20.1+galaxy0`, name: 'fastp', desc: 'fast all-in-one preprocessing for FASTQ files', version: '0.20.1+galaxy0', section: 'Quality control', needs: 'fastp',
      requirements: [['fastp', '0.20.1']],
      cite: ['fastp2018'],
      inputs: [
        { name: 'in1', short: 'reads 1', label: 'Reads (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_1.fastq', pick: /_1\b|R1|forward/i },
        { name: 'in2', short: 'reads 2', label: 'Reverse reads (for paired-end reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_2.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'q', short: 'quality', label: 'Qualified quality Phred (-q)', type: 'int', default: 15, help: 'A base is "qualified" when its Phred quality is at least this.' },
        { name: 'u', short: 'unqualified %', label: 'Unqualified percent limit (-u)', type: 'int', default: 40, help: 'A read is removed when more than this percentage of its bases are not qualified.' },
        { name: 'l', short: 'min length', label: 'Length required (-l)', type: 'int', default: 15, help: 'Reads shorter than this after trimming are removed.' },
        { name: 'cut_tail', short: 'cut tail', label: 'Trim low-quality bases from the 3′ end (--cut_tail)', type: 'bool', default: false },
        { name: 'pe_adapters', short: 'PE adapters', label: 'Detect adapters for paired-end reads (--detect_adapter_for_pe)', type: 'bool', default: true }
      ],
      outputs: [
        { name: 'out1', short: 'reads 1', ext: 'fastqsanger', file: 'out1.fastq', label: (ins) => L('fastp', ins, 'Read 1 output') },
        { name: 'out2', short: 'reads 2', ext: 'fastqsanger', file: 'out2.fastq', when: (i) => !!i.in2, label: (ins) => L('fastp', ins, 'Read 2 output') },
        { name: 'report_html', short: 'HTML report', ext: 'html', file: 'report.html', label: (ins) => L('fastp', ins, 'HTML report') },
        { name: 'report_json', short: 'JSON report', ext: 'json', file: 'report.json', label: (ins) => L('fastp', ins, 'JSON report') }
      ],
      command: (i, p) => `fastp -i ${i.in1}${i.in2 ? ` -I ${i.in2}` : ''} -o out1.fastq${i.in2 ? ' -O out2.fastq' : ''} -q ${int(p.q, 15)} -u ${int(p.u, 40)} -l ${int(p.l, 15)}${p.cut_tail ? ' --cut_tail' : ''}${i.in2 && p.pe_adapters ? ' --detect_adapter_for_pe' : ''} -h report.html -j report.json`,
      help: '<p>Removes adapters and low-quality bases, and reports the quality of the reads before and after (the HTML report). For paired-end reads give both files: the two outputs stay in step, read for read.</p>'
    },
    {
      id: 'cutadapt', toolId: `${TS}/lparsons/cutadapt/cutadapt/5.2+galaxy2`, name: 'Cutadapt', desc: 'Remove adapter sequences from FASTQ/FASTA', version: '5.2+galaxy2', section: 'Quality control', needs: 'cutadapt',
      requirements: [['cutadapt', '5.2']],
      cite: ['cutadapt2011'],
      inputs: [
        { name: 'input_1', short: 'reads 1', label: 'FASTQ/A file #1 (or the single-end reads)', ext: ['fastqsanger'], nice: 'input_1.fastq', pick: /_1\b|R1|forward/i },
        { name: 'input_2', short: 'reads 2', label: 'FASTQ/A file #2 (for paired-end reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_2.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'adapter', short: '-a', label: "Read 1: 3' (end) adapter sequence (-a)", type: 'text', default: 'AGATCGGAAGAGC', help: "The start of the Illumina TruSeq adapters (AGATCGGAAGAGC) finds most of them. Leave empty for no 3' adapter." },
        { name: 'adapter2', short: '-A', label: "Read 2: 3' (end) adapter sequence (-A; paired-end reads)", type: 'text', default: 'AGATCGGAAGAGC' },
        { name: 'error_rate', short: 'error rate', label: 'Maximum error rate (--error-rate)', type: 'float', default: 0.1, help: 'Errors allowed in the match, as a fraction of its length.' },
        { name: 'overlap', short: 'overlap', label: 'Minimum overlap length (--overlap)', type: 'int', default: 3, help: 'A match with the adapter shorter than this does not count – it may be chance.' },
        { name: 'quality_cutoff', short: 'quality', label: "Quality cutoff (--quality-cutoff): trim 3' ends below this Phred quality", type: 'int', default: 0 },
        { name: 'minimum_length', short: 'min length', label: 'Minimum length (--minimum-length): discard reads shorter than this after trimming', type: 'int', default: 1 },
        { name: 'discard_untrimmed', short: 'discard untrimmed', label: 'Discard Untrimmed Reads (--discard-untrimmed)', type: 'bool', default: false },
        { name: 'poly_a', short: 'poly-A', label: 'Trim poly-A tails (--poly-a)', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'out1', short: 'reads 1', ext: 'fastqsanger', file: 'out1.fastq', label: (ins) => L('Cutadapt', ins, 'Read 1 Output') },
        { name: 'out2', short: 'reads 2', ext: 'fastqsanger', file: 'out2.fastq', when: (i) => !!i.input_2, label: (ins) => L('Cutadapt', ins, 'Read 2 Output') },
        { name: 'report', short: 'report', ext: 'txt', file: 'report.txt', label: (ins) => L('Cutadapt', ins, 'Report') }
      ],
      command: (i, p) => {
        const seq = (v) => String(v || '').trim().toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, '');
        const num = (v, d) => (Number.isFinite(+v) && String(v).trim() !== '' && +v >= 0 ? +v : d);
        const a = seq(p.adapter), a2 = seq(p.adapter2);
        return `cutadapt -j 1${a ? ' -a ' + a : ''}${i.input_2 && a2 ? ' -A ' + a2 : ''} --error-rate=${num(p.error_rate, 0.1)} --overlap=${int(p.overlap, 3)} --quality-cutoff=${int(p.quality_cutoff, 0)} --minimum-length=${int(p.minimum_length, 1)}${p.discard_untrimmed ? ' --discard-untrimmed' : ''}${p.poly_a ? ' --poly-a' : ''} -o out1.fastq${i.input_2 ? ' -p out2.fastq' : ''} ${i.input_1}${i.input_2 ? ' ' + i.input_2 : ''} > report.txt`;
      },
      help: '<p>Finds the adapter sequence in each read and removes it, with everything after it (a 3′ adapter), and can trim low-quality ends and drop reads that end up too short. The <b>Report</b> says how many reads had the adapter and how many bases were removed. For paired-end reads give both files: the pairs stay in step. Cutadapt runs on one core here.</p>'
    },
    {
      id: 'seqtk_comp', toolId: `${TS}/iuc/seqtk/seqtk_comp/1.4+galaxy0`, name: 'seqtk_comp', desc: 'get the nucleotide composition of FASTA/Q', version: '1.4+galaxy0', section: 'Quality control', needs: 'seqtk',
      requirements: [['seqtk', '1.4']],
      cite: ['seqtk'],
      inputs: [{ name: 'input', short: 'sequences', label: 'Input FASTA/Q file', ext: ['fastqsanger', 'fasta'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [],
      outputs: [{ name: 'default', short: 'composition', ext: 'tabular', file: 'output.tsv', label: (ins) => L('seqtk_comp', ins) }],
      command: (i) => `seqtk comp ${i.input} > output.tsv`,
      help: '<p>One line per sequence: name, length, the counts of A, C, G, T, the count of IUPAC codes for two bases, and more. Use it for GC content and lengths.</p>'
    },
    /* ---------- Mapping ---------- */
    {
      id: 'minimap2', toolId: `${TS}/iuc/minimap2/minimap2/2.22+galaxy0`, name: 'Map with minimap2', desc: 'A fast pairwise aligner for genomic and spliced nucleotide sequences', version: '2.22+galaxy0', section: 'Mapping', needs: 'minimap2',
      requirements: [['minimap2', '2.22'], ['samtools', '1.17']],
      cite: ['minimap2_2018', 'samtools2009'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Use the following dataset as the reference sequence', ext: ['fasta'], nice: 'reference.fa' },
        { name: 'fastq1', short: 'reads 1', label: 'Select fastq dataset (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_f.fastq', pick: /_1\b|R1|forward/i },
        { name: 'fastq2', short: 'reads 2', label: 'Select fastq dataset (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_r.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'preset', short: 'preset', label: 'Select a profile of preset options', type: 'select', default: 'sr', options: [['sr', 'Short single-end reads without splicing (-k21 -w11 --sr --frag=yes …) (sr)'], ['map-ont', 'Oxford Nanopore read to reference mapping (map-ont)'], ['map-pb', 'PacBio CLR read to reference mapping (map-pb)'], ['asm5', 'Long assembly to reference mapping, divergence below 1% (asm5)']], help: 'sr is the profile for short Illumina reads, as in the command line minimap2 -ax sr.' },
        { name: 'rg_id', short: 'read group ID', label: 'Read group identifier (ID)', type: 'text', default: 'sample1' },
        { name: 'rg_sm', short: 'sample (SM)', label: 'Sample name (SM)', type: 'text', default: 'sample1' }
      ],
      outputs: [{ name: 'alignment_output', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('Map with minimap2', ins, 'mapped reads in BAM format') }],
      command: (i, p) => `minimap2 -x ${p.preset} -a -t 1 -R '@RG\\tID:${rgSafe(p.rg_id)}\\tSM:${rgSafe(p.rg_sm)}' ${i.reference} ${i.fastq1}${i.fastq2 ? ' ' + i.fastq2 : ''} | samtools sort -o output.bam -`,
      help: '<p><b>minimap2</b> aligns the reads to the reference; the output is sorted by position with <b>samtools sort</b>, like <code>minimap2 -ax sr … | samtools sort</code>. Galaxy indexes BAM files by itself (the index is kept with the dataset).</p>'
    },
    {
      id: 'bowtie2', toolId: `${TS}/devteam/bowtie2/bowtie2/2.4.2+galaxy0`, name: 'Bowtie2', desc: '- map reads against reference genome', version: '2.4.2+galaxy0', section: 'Mapping', needs: 'bowtie2',
      requirements: [['bowtie2', '2.4.2'], ['samtools', '1.17']],
      cite: ['bowtie2009', 'bowtie2_2012'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Select reference genome (from the history; it is indexed first)', ext: ['fasta'], nice: 'reference.fa' },
        { name: 'fastq1', short: 'reads 1', label: 'FASTQ file (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_f.fastq', pick: /_1\b|R1|forward/i },
        { name: 'fastq2', short: 'reads 2', label: 'FASTQ file (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_r.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'preset', short: 'preset', label: 'Preset (sensitivity and speed)', type: 'select', default: '--sensitive', options: [['--very-fast', 'Very fast end-to-end (--very-fast)'], ['--fast', 'Fast end-to-end (--fast)'], ['--sensitive', 'Sensitive end-to-end (--sensitive)'], ['--very-sensitive', 'Very sensitive end-to-end (--very-sensitive)'], ['--sensitive-local', 'Sensitive local (--sensitive-local)']] },
        { name: 'rg_id', short: 'read group ID', label: 'Read group identifier (--rg-id)', type: 'text', default: 'sample1' },
        { name: 'rg_sm', short: 'sample (SM)', label: 'Sample name (--rg SM:)', type: 'text', default: 'sample1' }
      ],
      outputs: [
        { name: 'output', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('Bowtie2', ins, 'aligned reads (sorted BAM)') },
        { name: 'mapping_stats', short: 'mapping stats', ext: 'txt', file: 'mapping_stats.txt', label: (ins) => L('Bowtie2', ins, 'mapping stats') }
      ],
      command: (i, p) => `bowtie2-build ${i.reference} genome > /dev/null && bowtie2 -x genome ${i.fastq2 ? `-1 ${i.fastq1} -2 ${i.fastq2}` : `-U ${i.fastq1}`} ${p.preset} --rg-id ${rgSafe(p.rg_id)} --rg SM:${rgSafe(p.rg_sm)} 2> mapping_stats.txt | samtools sort -o output.bam -`,
      help: '<p>Builds a Bowtie 2 index of the reference, aligns the reads and sorts the alignments. The second output is Bowtie 2\'s summary: how many reads aligned once, more than once or not at all.</p>'
    },
    {
      id: 'bwa_mem', toolId: `${TS}/devteam/bwa/bwa_mem/0.7.19`, name: 'Map with BWA-MEM', desc: '- map medium and long reads (> 100 bp) against reference genome', version: '0.7.19', section: 'Mapping', needs: 'bwa',
      requirements: [['bwa', '0.7.19'], ['samtools', '1.17']],
      cite: ['bwa2009', 'bwasw2010', 'bwamem2013'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Use the following dataset as the reference sequence (from the history; it is indexed first)', ext: ['fasta'], nice: 'reference.fa' },
        { name: 'fastq1', short: 'reads 1', label: 'Select first set of reads (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_f.fastq', pick: /_1\b|R1|forward/i },
        { name: 'fastq2', short: 'reads 2', label: 'Select second set of reads (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_r.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'rg_id', short: 'read group ID', label: 'Read group identifier (ID)', type: 'text', default: 'sample1' },
        { name: 'rg_sm', short: 'sample (SM)', label: 'Read group sample name (SM)', type: 'text', default: 'sample1' },
        { name: 'min_seed', short: 'min seed', label: 'Minimum seed length (-k)', type: 'int', default: 19 },
        { name: 'min_score', short: 'min score', label: 'Minimum score to output (-T)', type: 'int', default: 30 }
      ],
      outputs: [{ name: 'bam_output', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('Map with BWA-MEM', ins, 'mapped reads in BAM format') }],
      command: (i, p) => `bwa index -p localref.fa ${i.reference} && bwa mem -t 1 -v 1 -k ${int(p.min_seed, 19)} -T ${int(p.min_score, 30)} -R '@RG\\tID:${rgSafe(p.rg_id)}\\tSM:${rgSafe(p.rg_sm)}' localref.fa ${i.fastq1}${i.fastq2 ? ' ' + i.fastq2 : ''} | samtools sort -o output.bam -`,
      help: '<p>Indexes the reference (<b>bwa index</b>), aligns the reads with <b>bwa mem</b> and sorts the alignments by position (<b>samtools sort</b>). BWA-MEM suits Illumina reads of 70 bp and longer; give both files of paired-end reads, in step. Galaxy indexes BAM files by itself (the index is kept with the dataset).</p>'
    },
    {
      id: 'hisat2', toolId: `${TS}/iuc/hisat2/hisat2/2.2.2+galaxy0`, name: 'HISAT2', desc: 'A fast and sensitive alignment program', version: '2.2.2+galaxy0', section: 'Mapping', needs: 'hisat2',
      requirements: [['hisat2', '2.2.2'], ['samtools', '1.17']],
      cite: ['hisat2015', 'hisat2_2019'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Use a genome from history and build index (FASTA)', ext: ['fasta'], nice: 'genome.fa' },
        { name: 'fastq1', short: 'reads 1', label: 'FASTQ file (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_f.fastq', pick: /_1\b|R1|forward/i },
        { name: 'fastq2', short: 'reads 2', label: 'FASTQ file (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_r.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'strandedness', short: 'strand', label: 'Specify strand information (--rna-strandness)', type: 'select', default: 'unstranded', options: [['unstranded', 'Unstranded'], ['FR', 'Forward (FR, or F for single-end reads)'], ['RF', 'Reverse (RF, or R for single-end reads)']], help: 'Which strand of the transcript the reads come from: the library protocol tells.' },
        { name: 'no_spliced', short: 'no spliced', label: 'Disable spliced alignment (--no-spliced-alignment; for DNA reads)', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'output_alignments', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('HISAT2', ins, 'aligned reads (BAM)') },
        { name: 'summary_file', short: 'summary', ext: 'txt', file: 'summary.txt', label: (ins) => L('HISAT2', ins, 'mapping summary') }
      ],
      command: (i, p) => {
        const strand = p.strandedness === 'unstranded' ? '' : ` --rna-strandness ${i.fastq2 ? p.strandedness : p.strandedness[0]}`;
        return `hisat2-build ${i.reference} genome > /dev/null && hisat2 -x genome ${i.fastq2 ? `-1 ${i.fastq1} -2 ${i.fastq2}` : `-U ${i.fastq1}`}${strand}${p.no_spliced ? ' --no-spliced-alignment' : ''} 2> summary.txt | samtools sort -o output.bam -`;
      },
      help: '<p>Builds a HISAT2 index of the reference, aligns RNA-seq reads – a read may span an intron, and is then split across the exons (an N in its CIGAR string) – and sorts the alignments by position. The second output is HISAT2\'s summary of how many reads aligned.</p>'
    },
    {
      id: 'bwa_mem2', toolId: `${TS}/iuc/bwa_mem2/bwa_mem2/2.2.1+galaxy4`, name: 'Map with BWA-MEM2', desc: '- map medium and long reads (> 100 bp) against reference genome', version: '2.2.1+galaxy4', section: 'Mapping', needs: 'bwa-mem2',
      requirements: [['bwa-mem2', '2.2.1'], ['samtools', '1.17']],
      cite: ['bwa2009', 'bwasw2010', 'bwamem2013', 'bwamem2_2019'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Use the following dataset as the reference sequence (from the history; it is indexed first)', ext: ['fasta'], nice: 'reference.fa' },
        { name: 'fastq1', short: 'reads 1', label: 'Select first set of reads (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'input_f.fastq', pick: /_1\b|R1|forward/i },
        { name: 'fastq2', short: 'reads 2', label: 'Select second set of reads (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'input_r.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'rg_id', short: 'read group ID', label: 'Read group identifier (ID)', type: 'text', default: 'sample1' },
        { name: 'rg_sm', short: 'sample (SM)', label: 'Read group sample name (SM)', type: 'text', default: 'sample1' },
        { name: 'min_seed', short: 'min seed', label: 'Minimum seed length (-k)', type: 'int', default: 19 },
        { name: 'min_score', short: 'min score', label: 'Minimum score to output (-T)', type: 'int', default: 30 }
      ],
      outputs: [{ name: 'bam_output', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('Map with BWA-MEM2', ins, 'mapped reads in BAM format') }],
      command: (i, p) => `bwa-mem2 index -p localref.fa ${i.reference} > /dev/null && bwa-mem2 mem -t 1 -v 1 -k ${int(p.min_seed, 19)} -T ${int(p.min_score, 30)} -R '@RG\\tID:${rgSafe(p.rg_id)}\\tSM:${rgSafe(p.rg_sm)}' localref.fa ${i.fastq1}${i.fastq2 ? ' ' + i.fastq2 : ''} | samtools sort -o output.bam -`,
      help: '<p>The same as <b>Map with BWA-MEM</b>, with BWA-MEM2: bwa mem\'s algorithm rewritten to be faster on modern processors (in the browser it is not faster). It indexes the reference with <b>bwa-mem2 index</b> (an index of its own), aligns the reads and sorts the alignments by position.</p>'
    },
    /* ---------- SAM/BAM ---------- */
    {
      id: 'samtools_flagstat', toolId: `${TS}/devteam/samtools_flagstat/samtools_flagstat/2.0.5`, name: 'Samtools flagstat', desc: 'tabulate descriptive stats for BAM datset', version: '2.0.5', section: 'SAM/BAM', needs: 'samtools',
      requirements: [['samtools', '1.17']],
      cite: ['samtools_bcftools2021', 'baq2011'],
      inputs: [{ name: 'input1', short: 'BAM', label: 'BAM File to Convert', ext: ['bam'], nice: 'input.bam' }],
      params: [],
      outputs: [{ name: 'output1', short: 'stats', ext: 'txt', file: 'output.txt', label: (ins) => L('Samtools flagstat', ins) }],
      command: (i) => `samtools flagstat ${i.input1} > output.txt`,
      help: '<p>Counts the reads by their SAM flags: mapped, properly paired, duplicates…</p>'
    },
    {
      id: 'samtools_stats', toolId: `${TS}/devteam/samtools_stats/samtools_stats/2.0.5`, name: 'Samtools stats', desc: 'generate statistics for BAM dataset', version: '2.0.5', section: 'SAM/BAM', needs: 'samtools',
      requirements: [['samtools', '1.17']],
      cite: ['samtools_bcftools2021', 'baq2011'],
      inputs: [{ name: 'input', short: 'BAM', label: 'BAM file', ext: ['bam'], nice: 'input.bam' }],
      params: [],
      outputs: [{ name: 'output', short: 'stats', ext: 'txt', file: 'output.txt', label: (ins) => L('Samtools stats', ins) }],
      command: (i) => `samtools stats ${i.input} > output.txt`,
      help: '<p>Detailed statistics: the summary numbers (lines starting with SN), insert sizes, read lengths, coverage, error rates. <code>grep ^SN</code> on the output gives the summary.</p>'
    },
    {
      id: 'samtools_idxstats', toolId: `${TS}/devteam/samtools_idxstats/samtools_idxstats/2.0.4`, name: 'Samtools idxstats', desc: 'reports stats of the BAM index file', version: '2.0.4', section: 'SAM/BAM', needs: 'samtools',
      requirements: [['samtools', '1.17']],
      cite: ['samtools_bcftools2021', 'baq2011'],
      inputs: [{ name: 'input', short: 'BAM', label: 'BAM file', ext: ['bam'], nice: 'input.bam' }],
      params: [],
      outputs: [{ name: 'output', short: 'per sequence', ext: 'tabular', file: 'output.tsv', label: (ins) => L('Samtools idxstats', ins) }],
      command: (i) => `samtools idxstats ${i.input} > output.tsv`,
      help: '<p>One line per reference sequence: its name, length, and the numbers of mapped and unmapped reads on it.</p>'
    },
    {
      id: 'samtools_depth', toolId: `${TS}/iuc/samtools_depth/samtools_depth/1.17`, name: 'Samtools depth', desc: 'compute the depth at each position or region', version: '1.17', section: 'SAM/BAM', needs: 'samtools',
      requirements: [['samtools', '1.17']],
      cite: ['samtools_bcftools2021', 'baq2011'],
      inputs: [{ name: 'input', short: 'BAM', label: 'BAM file', ext: ['bam'], nice: 'input.bam' }],
      params: [
        { name: 'all', short: 'all positions', label: 'Output all positions, also those with depth 0 (-a)', type: 'bool', default: false },
        { name: 'mapq', short: 'min MAPQ', label: 'Only count reads with mapping quality at least (-Q)', type: 'int', default: 0 }
      ],
      outputs: [{ name: 'output', short: 'depth', ext: 'tabular', file: 'output.tsv', label: (ins) => L('Samtools depth', ins) }],
      command: (i, p) => `samtools depth ${p.all ? '-a ' : ''}-Q ${int(p.mapq, 0)} ${i.input} > output.tsv`,
      help: '<p>Three columns: reference, position, number of reads covering it.</p>'
    },
    {
      id: 'samtools_view', toolId: `${TS}/iuc/samtools_view/samtools_view/1.17+galaxy0`, name: 'Samtools view', desc: '- reformat, filter, or subsample SAM, BAM or CRAM', version: '1.17+galaxy0', section: 'SAM/BAM', needs: 'samtools',
      requirements: [['samtools', '1.17']],
      cite: ['samtools_bcftools2021', 'baq2011'],
      inputs: [{ name: 'input', short: 'BAM', label: 'SAM/BAM/CRAM data set', ext: ['bam', 'sam'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'region', short: 'region', label: 'Region (e.g. chr10:1000-2000; empty: everything)', type: 'text', default: '' },
        { name: 'mapq', short: 'min MAPQ', label: 'Minimum mapping quality (-q)', type: 'int', default: 0 },
        { name: 'require', short: 'require flags', label: 'Only reads with all these flag bits (-f, a number; 2 = properly paired)', type: 'int', default: 0 },
        { name: 'exclude', short: 'exclude flags', label: 'No reads with any of these flag bits (-F, a number; 4 = unmapped, 1024 = duplicate)', type: 'int', default: 0 },
        { name: 'fmt', short: 'format', label: 'Output format', type: 'select', default: 'bam', options: [['bam', 'BAM (-b)'], ['sam', 'SAM with header (-h)']] }
      ],
      outputs: [{ name: 'outputsam', short: 'filtered', ext: (p) => (p.fmt === 'sam' ? 'sam' : 'bam'), file: 'output', label: (ins) => L('Samtools view', ins, 'filtered data') }],
      command: (i, p) => `samtools view ${p.fmt === 'sam' ? '-h' : '-b'} -q ${int(p.mapq, 0)} -f ${int(p.require, 0)} -F ${int(p.exclude, 0)} -o output ${i.input}${String(p.region || '').trim() ? ' ' + shq(String(p.region).trim()) : ''}`,
      help: '<p>Keeps the alignments that pass the filters: a region (needs an indexed BAM, which Galaxy has), a minimum mapping quality, and SAM flag bits that must or must not be set.</p>'
    },
    {
      id: 'mosdepth', toolId: `${TS}/iuc/mosdepth/mosdepth/0.3.14+galaxy0`, name: 'mosdepth', desc: 'compute depth of BAM/CRAM files', version: '0.3.14+galaxy0', section: 'SAM/BAM', needs: 'mosdepth',
      requirements: [['mosdepth', '0.3.14']],
      cite: ['mosdepth2018'],
      inputs: [
        { name: 'input', short: 'BAM', label: 'BAM file (sorted by position)', ext: ['bam'], nice: 'input.bam' },
        { name: 'by_bed', short: 'regions', label: 'Regions: the mean depth of each interval of this BED file (optional)', ext: ['bed'], nice: 'regions.bed', optional: true }
      ],
      params: [
        { name: 'window', short: 'window', label: 'Or: the mean depth in windows of this many bases (--by; 0 for none, and when a BED file is given)', type: 'int', default: 0 },
        { name: 'mapq', short: 'min MAPQ', label: 'Only count reads with mapping quality at least (-Q)', type: 'int', default: 0 },
        { name: 'thresholds', short: 'thresholds', label: 'For each region, how many bases reach each of these depths (--thresholds, e.g. 1,10,20; empty for none)', type: 'text', default: '' }
      ],
      outputs: [
        { name: 'output_summary', short: 'summary', ext: 'tabular', file: 'summary.tsv', label: (ins) => L('mosdepth', ins, 'summary') },
        { name: 'output_dist', short: 'distribution', ext: 'tabular', file: 'global.dist.tsv', label: (ins) => L('mosdepth', ins, 'cumulative distribution') },
        { name: 'output_per_base', short: 'per base', ext: 'bedgraph', file: 'per-base.bedgraph', label: (ins) => L('mosdepth', ins, 'per-base depth') },
        { name: 'output_regions', short: 'regions', ext: 'bedgraph', file: 'regions.bedgraph', when: (i, p) => !!i.by_bed || int(p.window, 0) > 0, label: (ins) => L('mosdepth', ins, 'mean depth of the regions') },
        { name: 'output_thresholds', short: 'thresholds', ext: 'tabular', file: 'thresholds.tsv', when: (i, p) => (!!i.by_bed || int(p.window, 0) > 0) && /^\s*\d+(\s*,\s*\d+)*\s*$/.test(String(p.thresholds || '')), label: (ins) => L('mosdepth', ins, 'bases at each depth') }
      ],
      command: (i, p) => {
        const by = i.by_bed ? ` --by ${i.by_bed}` : int(p.window, 0) > 0 ? ` --by ${int(p.window, 0)}` : '';
        const th = by && /^\s*\d+(\s*,\s*\d+)*\s*$/.test(String(p.thresholds || '')) ? ` --thresholds ${String(p.thresholds).replace(/\s+/g, '')}` : '';
        return `mosdepth -Q ${int(p.mapq, 0)}${by}${th} out ${i.input} && cp out.mosdepth.summary.txt summary.tsv && cp out.mosdepth.global.dist.txt global.dist.tsv && zcat out.per-base.bed.gz > per-base.bedgraph`
          + (by ? ' && zcat out.regions.bed.gz > regions.bedgraph' : '') + (th ? ' && zcat out.thresholds.bed.gz > thresholds.tsv' : '');
      },
      help: '<p>The read depth (coverage) along the reference: for each run of bases with the same depth (per-base), the mean of each region or window, a summary per sequence (length, bases covered, mean, minimum and maximum depth) and the cumulative distribution (which proportion of the bases has at least each depth). mosdepth needs the BAM file\'s index, which Galaxy keeps with the dataset.</p>'
    },
    /* ---------- RNA-seq ---------- */
    {
      id: 'featurecounts', toolId: `${TS}/iuc/featurecounts/featurecounts/2.1.1+galaxy1`, name: 'featureCounts', desc: 'Measure gene expression in RNA-Seq experiments from SAM or BAM files', version: '2.1.1+galaxy1', section: 'RNA-seq', needs: 'featureCounts',
      requirements: [['subread', '2.1.1']],
      cite: ['featurecounts2014'],
      inputs: [
        { name: 'alignment', short: 'BAM', label: 'Alignment file (BAM)', ext: ['bam'], nice: 'input.bam' },
        { name: 'anno', short: 'annotation', label: 'Gene annotation file: in your history (GTF)', ext: ['gtf'], nice: 'annotation.gtf' }
      ],
      params: [
        { name: 'strand', short: 'strand', label: 'Specify strand information (-s)', type: 'select', default: '0', options: [['0', 'Unstranded'], ['1', 'Stranded (Forward)'], ['2', 'Stranded (Reverse)']], help: 'Which strand of the transcript the reads come from: the library protocol tells (a dUTP library is reverse).' },
        { name: 'pairs', short: 'paired', label: 'Paired-end reads (-p)', type: 'select', default: 'fragments', options: [['fragments', 'Paired-end: count fragments (-p --countReadPairs)'], ['reads', 'Paired-end: count reads (-p)'], ['single', 'Single-end reads']], help: 'For paired reads featureCounts needs -p; without it, it stops ("Paired-end reads were detected in single-end read library").' },
        { name: 'multi', short: 'multimapping', label: 'Count multi-mapping reads (-M)', type: 'bool', default: false },
        { name: 'mapq', short: 'min MAPQ', label: 'Minimum mapping quality (-Q)', type: 'int', default: 0 },
        { name: 'feature', short: 'feature', label: 'GFF feature type filter (-t)', type: 'text', default: 'exon' },
        { name: 'attr', short: 'gene ID', label: 'GFF gene identifier (-g)', type: 'text', default: 'gene_id' }
      ],
      outputs: [
        { name: 'output_short', short: 'counts', ext: 'tabular', file: 'counts.tsv', label: (ins) => L('featureCounts', ins, 'Counts') },
        { name: 'output_summary', short: 'summary', ext: 'tabular', file: 'summary.tsv', label: (ins) => L('featureCounts', ins, 'Summary') },
        { name: 'output_feature_lengths', short: 'lengths', ext: 'tabular', file: 'lengths.tsv', label: (ins) => L('featureCounts', ins, 'Feature lengths') }
      ],
      command: (i, p) => {
        const word = (v, d) => (/^[\w.-]+$/.test(String(v || '').trim()) ? String(v).trim() : d);
        const pe = p.pairs === 'fragments' ? ' -p --countReadPairs' : p.pairs === 'reads' ? ' -p' : '';
        return `featureCounts -T 1 -s ${['0', '1', '2'].includes(String(p.strand)) ? p.strand : 0}${pe}${p.multi ? ' -M' : ''} -Q ${int(p.mapq, 0)} -t ${word(p.feature, 'exon')} -g ${word(p.attr, 'gene_id')} -a ${i.anno} -o output ${i.alignment}`
          + ` && tail -n +2 output | cut -f 1,7 > counts.tsv && cp output.summary summary.tsv && tail -n +2 output | cut -f 1,6 > lengths.tsv`;
      },
      help: '<p>Counts the reads (or, for paired reads, the fragments) that overlap each gene of the annotation: the input for differential expression with DESeq2 or edgeR. The <b>Counts</b> table has a column of gene IDs and a column of counts; the <b>Summary</b> says how many reads were counted and why the others were not (no gene there, more than one gene, multi-mapping). featureCounts counts on several threads, which needs a cross-origin isolated page (see Limits in the help).</p>'
    },
    {
      id: 'stringtie', toolId: `${TS}/iuc/stringtie/stringtie/3.0.3+galaxy2`, name: 'StringTie', desc: 'transcript assembly and quantification', version: '3.0.3+galaxy2', section: 'RNA-seq', needs: 'stringtie',
      requirements: [['stringtie', '3.0.3']],
      cite: ['stringtie2_2019', 'stringtie2015', 'stringtie3_2026'],
      inputs: [
        { name: 'input_bam', short: 'BAM', label: 'Input short mapped reads (BAM, sorted by position)', ext: ['bam'], nice: 'input.bam' },
        { name: 'guide_gff', short: 'guide', label: 'Use a reference file to guide assembly: GTF from your history (optional)', ext: ['gtf', 'gff3'], nice: (d) => 'guide.' + DOWNLOAD_EXT[d.ext], optional: true }
      ],
      params: [
        { name: 'strand', short: 'strand', label: 'Specify strand information', type: 'select', default: 'none', options: [['none', 'Unstranded'], ['--fr', 'Forward (FR)'], ['--rf', 'Reverse (RF)']] },
        { name: 'estimate', short: '-e', label: 'Use the reference transcripts only – no new ones (-e; needs a guide)', type: 'bool', default: false },
        { name: 'min_tlen', short: 'min length', label: 'Minimum transcript length (-m)', type: 'int', default: 200 },
        { name: 'min_cov', short: 'min coverage', label: 'Minimum read coverage of a transcript (-c)', type: 'float', default: 1 }
      ],
      outputs: [
        { name: 'output_gtf', short: 'transcripts', ext: 'gtf', file: 'output.gtf', label: (ins) => L('StringTie', ins, 'Assembled transcripts') },
        { name: 'gene_abundance_estimation', short: 'gene abundances', ext: 'tabular', file: 'gene_abundance.tsv', label: (ins) => L('StringTie', ins, 'Gene abundance estimates') }
      ],
      command: (i, p) => {
        const c = Number.isFinite(+p.min_cov) && String(p.min_cov).trim() !== '' ? +p.min_cov : 1;
        return `stringtie ${i.input_bam}${i.guide_gff ? ` -G ${i.guide_gff}` : ''}${i.guide_gff && p.estimate ? ' -e' : ''}${p.strand === '--fr' || p.strand === '--rf' ? ' ' + p.strand : ''} -m ${int(p.min_tlen, 200)} -c ${c} -p 1 -o output.gtf -A gene_abundance.tsv`;
      },
      help: '<p>Assembles the transcripts that the alignments show – guided by a reference annotation, if one is given – and estimates how abundant each is (coverage, FPKM and TPM in the GTF output; a table per gene). For spliced reads StringTie needs the strand tag (XS), which HISAT2 writes: map with HISAT2 and give the sorted BAM.</p>'
    },
    {
      id: 'kallisto_quant', toolId: `${TS}/iuc/kallisto_quant/kallisto_quant/0.48.0+galaxy1`, name: 'Kallisto quant', desc: '- quantify abundances of RNA-Seq transcripts', version: '0.48.0+galaxy1', section: 'RNA-seq', needs: 'kallisto',
      requirements: [['kallisto', '0.52.0']],
      cite: ['kallisto2016'],
      inputs: [
        { name: 'transcripts', short: 'transcripts', label: 'Transcript sequences: a FASTA file from your history (it is indexed first)', ext: ['fasta'], nice: 'transcripts.fa' },
        { name: 'reads1', short: 'reads 1', label: 'FASTQ file (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'reads_1.fastq', pick: /_1\b|R1|forward/i },
        { name: 'reads2', short: 'reads 2', label: 'FASTQ file (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'reads_2.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'strand', short: 'strand', label: 'Strand-specific reads', type: 'select', default: 'none', options: [['none', 'Unstranded'], ['--fr-stranded', 'First read forward (--fr-stranded)'], ['--rf-stranded', 'First read reverse (--rf-stranded)']] },
        { name: 'frag_len', short: 'fragment length', label: 'Single-end reads: estimated average fragment length (-l)', type: 'float', default: 200 },
        { name: 'frag_sd', short: 'fragment sd', label: 'Single-end reads: estimated standard deviation of the fragment length (-s)', type: 'float', default: 20 },
        { name: 'bias', short: 'bias', label: 'Perform sequence based bias correction (--bias)', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'abundance_tab', short: 'abundances', ext: 'tabular', file: 'abundance.tsv', label: (ins) => L('Kallisto quant', ins, 'abundances') },
        { name: 'run_info', short: 'run info', ext: 'json', file: 'run_info.json', label: (ins) => L('Kallisto quant', ins, 'run info') }
      ],
      command: (i, p) => {
        const num = (v, d) => (Number.isFinite(+v) && String(v).trim() !== '' && +v > 0 ? +v : d);
        const single = i.reads2 ? '' : ` --single -l ${num(p.frag_len, 200)} -s ${num(p.frag_sd, 20)}`;
        return `kallisto index -i transcripts.idx ${i.transcripts} && kallisto quant -i transcripts.idx -o out -t 1${single}${p.strand === '--fr-stranded' || p.strand === '--rf-stranded' ? ' ' + p.strand : ''}${p.bias ? ' --bias' : ''} ${i.reads1}${i.reads2 ? ' ' + i.reads2 : ''} && mv out/abundance.tsv abundance.tsv && mv out/run_info.json run_info.json`;
      },
      help: '<p>Pseudoaligns the reads to the transcript sequences – it finds which transcripts each read could come from, without aligning it base by base – and estimates the abundance of each transcript: estimated counts and TPM. Make the transcript sequences from a genome and its annotation with gffread. (Galaxy\'s tool of this version runs kallisto 0.48.0; here it runs kallisto 0.52.0, the program of the terminal.)</p>'
    },
    {
      id: 'salmon', toolId: `${TS}/bgruening/salmon/salmon/1.10.1+galaxy5`, name: 'Salmon quant', desc: 'Perform dual-phase, selective alignment-based estimation of transcript abundance from RNA-seq reads', version: '1.10.1+galaxy5', section: 'RNA-seq', needs: 'salmon',
      requirements: [['salmon', '2.8.0']],
      cite: ['alevin2019', 'salmon2017'],
      inputs: [
        { name: 'transcripts', short: 'transcripts', label: 'Transcripts FASTA file from your history (it is indexed first)', ext: ['fasta'], nice: 'transcripts.fa' },
        { name: 'reads1', short: 'reads 1', label: 'FASTQ file (forward reads, or single-end reads)', ext: ['fastqsanger'], nice: 'reads_1.fastq', pick: /_1\b|R1|forward/i },
        { name: 'reads2', short: 'reads 2', label: 'FASTQ file (reverse reads; leave empty for single-end)', ext: ['fastqsanger'], nice: 'reads_2.fastq', pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'libtype', short: 'library type', label: 'Specify the strandedness and orientation of the reads (-l)', type: 'select', default: 'A', options: [['A', 'Automatically infer the library type (A)'], ['IU', 'Paired, inward, unstranded (IU)'], ['ISF', 'Paired, inward, read 1 from the forward strand (ISF)'], ['ISR', 'Paired, inward, read 1 from the reverse strand (ISR)'], ['U', 'Single-end, unstranded (U)'], ['SF', 'Single-end, forward strand (SF)'], ['SR', 'Single-end, reverse strand (SR)']] },
        { name: 'fld_mean', short: 'fragment length', label: 'Single-end reads: mean fragment length (--fldMean)', type: 'int', default: 250 },
        { name: 'fld_sd', short: 'fragment sd', label: 'Single-end reads: standard deviation of the fragment length (--fldSD)', type: 'int', default: 25 }
      ],
      outputs: [
        { name: 'output_quant', short: 'quantification', ext: 'tabular', file: 'quant.tsv', label: (ins) => L('Salmon quant', ins, 'Quantification') },
        { name: 'output_libformat', short: 'library type', ext: 'json', file: 'lib_format_counts.json', label: (ins) => L('Salmon quant', ins, 'library format counts') }
      ],
      command: (i, p) => {
        const lib = ['A', 'IU', 'ISF', 'ISR', 'U', 'SF', 'SR'].includes(p.libtype) ? p.libtype : 'A';
        const reads = i.reads2 ? `-1 ${i.reads1} -2 ${i.reads2}` : `-r ${i.reads1} --fldMean ${int(p.fld_mean, 250)} --fldSD ${int(p.fld_sd, 25)}`;
        return `salmon index -t ${i.transcripts} -i index -p 1 && salmon quant -i index -l ${lib} ${reads} -p 1 -o out && mv out/quant.sf quant.tsv && mv out/lib_format_counts.json lib_format_counts.json`;
      },
      help: '<p>Indexes the transcript sequences, maps the reads to them (selective alignment) and estimates the abundance of each transcript: the number of reads (NumReads) and TPM. Library type A lets Salmon work out how the reads were made; the second output says what it found. Salmon works on several threads, which needs a cross-origin isolated page (see Limits in the help). (Galaxy\'s tool of this version runs Salmon 1.10.1; here it runs Salmon 2.8.0, the program of the terminal.)</p>'
    },
    /* ---------- Single-cell: bustools. The Galaxy Tool Shed has no bustools tools, so these are the workbench's own,
       with IDs of their own (as Kalign's): a workflow with them does not open on a Galaxy server. ---------- */
    {
      id: 'bustools_sort', toolId: 'bustools_sort_workbench', name: 'bustools sort', desc: 'sort the records of a BUS file', version: '0.45.1', section: 'Single-cell', needs: 'bustools',
      requirements: [['bustools', '0.45.1']],
      cite: ['bustools2021', 'bus2019'],
      inputs: [{ name: 'input', short: 'BUS', label: 'BUS file (written by kallisto bus)', ext: ['bus'], nice: 'input.bus' }],
      params: [
        { name: 'order', short: 'order', label: 'Sort the records by', type: 'select', default: '', options: [['', 'barcode, UMI, equivalence class, then flag (default)'], ['--umi', 'UMI, barcode, then equivalence class (--umi)'], ['--count', 'multiplicity, barcode, UMI, then equivalence class (--count)'], ['--flags', 'flag, equivalence class, barcode, then UMI (--flags)'], ['--flags-bc', 'flag, barcode, UMI, then equivalence class (--flags-bc)']] },
        { name: 'no_flags', short: '--no-flags', label: 'Ignore and reset the flag while sorting (--no-flags)', type: 'bool', default: false }
      ],
      outputs: [{ name: 'output', short: 'sorted', ext: 'bus', file: 'output.bus', label: (ins) => L('bustools sort', ins, 'sorted BUS') }],
      command: (i, p) => `bustools sort -t 1 -o output.bus${['--umi', '--count', '--flags', '--flags-bc'].includes(p.order) ? ' ' + p.order : ''}${p.no_flags ? ' --no-flags' : ''} ${i.input}`,
      help: '<p>Sorts the records of a BUS file – by default by cell barcode, then UMI and equivalence class – and merges the records that are the same, adding up how often each was seen. A BUS file has a record for each molecule seen: the barcode of its droplet (its cell), its UMI, the equivalence class of its read (the transcripts the read fits, numbered as in matrix.ec of kallisto bus) and a count. <b>bustools correct</b> and <b>bustools count</b> need sorted records; sort again after correcting barcodes. Here bustools sorts on one thread.</p>'
    },
    {
      id: 'bustools_correct', toolId: 'bustools_correct_workbench', name: 'bustools correct', desc: 'correct cell barcodes against an on-list', version: '0.45.1', section: 'Single-cell', needs: 'bustools',
      requirements: [['bustools', '0.45.1']],
      cite: ['bustools2021', 'bus2019'],
      inputs: [
        { name: 'input', short: 'BUS', label: 'Sorted BUS file', ext: ['bus'], nice: 'input.bus' },
        { name: 'onlist', short: 'on-list', label: 'On-list of barcodes (-w): the barcodes of the technology, one per line', ext: ['txt', 'tabular'], nice: 'onlist.txt', pick: /white|on-?list|allow/i }
      ],
      params: [{ name: 'nocorrect', short: '--nocorrect', label: 'Keep perfect matches only: no correction (--nocorrect)', type: 'bool', default: false }],
      outputs: [{ name: 'output', short: 'corrected', ext: 'bus', file: 'output.bus', label: (ins) => L('bustools correct', ins, 'corrected BUS') }],
      command: (i, p) => `bustools correct -w ${i.onlist}${p.nocorrect ? ' --nocorrect' : ''} -o output.bus ${i.input}`,
      help: '<p>Compares the cell barcode of each record with the list of barcodes that the technology uses (its on-list, or whitelist: 737,280 barcodes for 10x Chromium v2). A barcode in the list stays; one that is a single letter from exactly one barcode of the list takes that barcode – a sequencing error, corrected –; the others are left out. The job’s messages (in the details of the dataset) say how many records were on the list, corrected and left out. Correcting changes barcodes: sort the output again before <b>bustools count</b>.</p>'
    },
    {
      id: 'bustools_count', toolId: 'bustools_count_workbench', name: 'bustools count', desc: 'count the molecules of each gene in each cell', version: '0.45.1', section: 'Single-cell', needs: 'bustools',
      requirements: [['bustools', '0.45.1']],
      cite: ['bustools2021', 'bus2019'],
      inputs: [
        { name: 'input', short: 'BUS', label: 'Sorted BUS file (corrected, then sorted again)', ext: ['bus'], nice: 'input.bus' },
        { name: 'genemap', short: 'gene map', label: 'Transcripts to genes (-g): a transcript and its gene on each line', ext: ['txt', 'tabular'], nice: 'genemap.txt', pick: /genes|t2g/i },
        { name: 'ecmap', short: 'equivalence classes', label: 'Equivalence classes (-e): the matrix.ec of kallisto bus', ext: ['tabular', 'txt'], nice: 'matrix.ec', pick: /\.ec$/i },
        { name: 'txnames', short: 'transcripts', label: 'Transcript names (-t): the transcripts.txt of kallisto bus', ext: ['txt', 'tabular'], nice: 'transcripts.txt', pick: /^transcripts\.txt$/i }
      ],
      params: [
        { name: 'genecounts', short: '--genecounts', label: 'Aggregate counts to genes (--genecounts)', type: 'bool', default: true, help: 'Without it the matrix has a column for each equivalence class, and the output lists the classes in place of the genes.' },
        { name: 'umi_gene', short: '--umi-gene', label: 'Perform gene-level collapsing of UMIs (--umi-gene)', type: 'bool', default: false },
        { name: 'cm', short: '--cm', label: 'Count multiplicities instead of UMIs (--cm)', type: 'bool', default: false },
        { name: 'multimapping', short: '-m', label: 'Include records that pseudoalign to more than one gene (-m)', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'matrix', short: 'matrix', ext: 'mtx', file: 'cells_x_genes.mtx', label: (ins) => L('bustools count', ins, 'matrix') },
        { name: 'barcodes', short: 'barcodes', ext: 'txt', file: 'cells_x_genes.barcodes.txt', label: (ins) => L('bustools count', ins, 'barcodes (rows)') },
        { name: 'genes', short: 'genes', ext: 'txt', file: 'cells_x_genes.genes.txt', when: (i, p) => !!p.genecounts, label: (ins) => L('bustools count', ins, 'genes (columns)') },
        { name: 'ecs', short: 'equivalence classes', ext: 'tabular', file: 'cells_x_genes.ec.txt', when: (i, p) => !p.genecounts, label: (ins) => L('bustools count', ins, 'equivalence classes (columns)') }
      ],
      command: (i, p) => `bustools count -o cells_x_genes -g ${i.genemap} -e ${i.ecmap} -t ${i.txnames}${p.genecounts ? ' --genecounts' : ''}${p.umi_gene ? ' --umi-gene' : ''}${p.cm ? ' --cm' : ''}${p.multimapping ? ' -m' : ''} ${i.input}`,
      help: '<p>Counts, for each barcode and each gene, the different UMIs – molecules, not reads: the copies that PCR made of one molecule count once. The <b>matrix</b> is in Matrix Market format, which lists only what is not zero: after its header, its size (barcodes, genes, entries), then a line for each entry – the barcode’s row, the gene’s column, the count. The <b>barcodes</b> and <b>genes</b> name the rows and the columns. In Python, <code>scipy.io.mmread</code> reads the matrix; Scanpy and Seurat take the three files. The records must be sorted, and their barcodes corrected.</p>'
    },
    {
      id: 'bustools_inspect', toolId: 'bustools_inspect_workbench', name: 'bustools inspect', desc: 'summarize a sorted BUS file', version: '0.45.1', section: 'Single-cell', needs: 'bustools',
      requirements: [['bustools', '0.45.1']],
      cite: ['bustools2021', 'bus2019'],
      inputs: [
        { name: 'input', short: 'BUS', label: 'Sorted BUS file', ext: ['bus'], nice: 'input.bus' },
        { name: 'ecmap', short: 'equivalence classes', label: 'Equivalence classes (-e; optional): the matrix.ec of kallisto bus – for the counts of targets', ext: ['tabular', 'txt'], nice: 'matrix.ec', pick: /\.ec$/i, optional: true },
        { name: 'onlist', short: 'on-list', label: 'On-list of barcodes (-w; optional): how many barcodes and reads are on it', ext: ['txt', 'tabular'], nice: 'onlist.txt', pick: /white|on-?list|allow/i, optional: true }
      ],
      params: [],
      outputs: [
        { name: 'report', short: 'report', ext: 'txt', file: 'inspect.txt', label: (ins) => L('bustools inspect', ins, 'report') },
        { name: 'json', short: 'JSON', ext: 'json', file: 'inspect.json', label: (ins) => L('bustools inspect', ins, 'report (JSON)') }
      ],
      command: (i) => {
        const o = `${i.ecmap ? ' -e ' + i.ecmap : ''}${i.onlist ? ' -w ' + i.onlist : ''}`;
        return `bustools inspect${o} ${i.input} > inspect.txt && bustools inspect -o inspect.json${o} ${i.input}`;
      },
      help: '<p>Counts what a sorted BUS file holds: records, reads, barcodes and UMIs, the reads and UMIs of a barcode (median and mean), how many new records twice the sequencing would bring – and, with the equivalence classes and the on-list, the transcripts the reads fit and how many barcodes and reads are on the list. The <b>report</b> is text; the <b>JSON</b> has the same numbers for a program to read (bustools writes it with <code>-o</code>).</p>'
    },
    {
      id: 'bustools_text', toolId: 'bustools_text_workbench', name: 'bustools text', desc: 'write the records of a BUS file as a table', version: '0.45.1', section: 'Single-cell', needs: 'bustools',
      requirements: [['bustools', '0.45.1']],
      cite: ['bustools2021', 'bus2019'],
      inputs: [{ name: 'input', short: 'BUS', label: 'BUS file', ext: ['bus'], nice: 'input.bus' }],
      params: [
        { name: 'flags', short: '-f', label: 'Write the flag column (-f)', type: 'bool', default: false },
        { name: 'pad', short: '-d', label: 'Write the pad column (-d)', type: 'bool', default: false },
        { name: 'showall', short: '-a', label: 'Show hidden metadata in barcodes (-a)', type: 'bool', default: false }
      ],
      outputs: [{ name: 'output', short: 'table', ext: 'tabular', file: 'output.tsv', label: (ins) => L('bustools text', ins, 'records as text') }],
      command: (i, p) => `bustools text -o output.tsv${p.flags ? ' -f' : ''}${p.pad ? ' -d' : ''}${p.showall ? ' -a' : ''} ${i.input}`,
      help: '<p>Writes each record of a BUS file as a line of text: the cell barcode, the UMI, the equivalence class and the count – and, if asked, the flag and the padding. A BUS file itself is binary.</p>'
    },
    /* ---------- Variant calling ---------- */
    {
      id: 'bcftools_mpileup', toolId: `${TS}/iuc/bcftools_mpileup/bcftools_mpileup/1.10`, name: 'bcftools mpileup', desc: 'Generate VCF or BCF containing genotype likelihoods for one or multiple alignment (BAM or CRAM) files', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Choose the source for the reference genome: use a genome from the history', ext: ['fasta'], nice: 'ref.fa' },
        { name: 'input_bam', short: 'BAM', label: 'Input BAM/CRAM', ext: ['bam'], nice: 'input.bam' }
      ],
      params: [
        { name: 'max_depth', short: 'max depth', label: 'Maximum read depth per file (-d)', type: 'int', default: 250 },
        { name: 'annotate', short: 'AD, DP', label: 'Add the FORMAT fields AD and DP (-a AD,DP)', type: 'bool', default: false },
        { name: 'output_type', short: 'output type', label: 'Output type', type: 'select', default: 'u', options: [['u', 'uncompressed BCF'], ['b', 'compressed BCF'], ['v', 'uncompressed VCF'], ['z', 'compressed VCF']] }
      ],
      outputs: [{ name: 'output_file', short: 'likelihoods', ext: (p) => (p.output_type === 'v' ? 'vcf' : p.output_type === 'z' ? 'vcf_bgzip' : 'bcf'), file: 'output', label: (ins) => L('bcftools mpileup', ins) }],
      command: (i, p) => `bcftools mpileup -f ${i.reference} -d ${int(p.max_depth, 250)}${p.annotate ? ' -a AD,DP' : ''} ${i.input_bam} -O${p.output_type} -o output`,
      help: '<p>Collects, for every position of the reference, the evidence in the reads (<i>genotype likelihoods</i>). The next step, <b>bcftools call</b>, decides the genotypes.</p>'
    },
    {
      id: 'bcftools_call', toolId: `${TS}/iuc/bcftools_call/bcftools_call/1.10`, name: 'bcftools call', desc: 'SNP/indel variant calling from VCF/BCF', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [{ name: 'input_file', short: 'likelihoods', label: 'VCF/BCF Data', ext: ['bcf', 'vcf', 'vcf_bgzip'], nice: 'input.bcf' }],
      params: [
        { name: 'method', short: 'caller', label: 'Calling method', type: 'select', default: 'm', options: [['m', 'Multiallelic and rare-variant caller (-m)'], ['c', 'Consensus caller (-c)']] },
        { name: 'variants_only', short: 'variants only', label: 'Output variant sites only (-v)', type: 'bool', default: true },
        { name: 'output_type', short: 'output type', label: 'Output type', type: 'select', default: 'z', options: [['z', 'compressed VCF'], ['v', 'uncompressed VCF'], ['b', 'compressed BCF'], ['u', 'uncompressed BCF']] }
      ],
      outputs: [{ name: 'output_file', short: 'VCF', ext: (p) => (p.output_type === 'z' ? 'vcf_bgzip' : p.output_type === 'v' ? 'vcf' : 'bcf'), file: 'output', label: (ins) => L('bcftools call', ins) }],
      command: (i, p) => `bcftools call -${p.method}${p.variants_only ? 'v' : ''} -O${p.output_type} -o output ${i.input_file}`,
      help: '<p>Calls the variants: for each position it chooses the most likely genotype (0/0, 0/1 or 1/1) from the likelihoods made by mpileup. With <b>-v</b> only the variant sites are written.</p>'
    },
    {
      id: 'freebayes', toolId: `${TS}/devteam/freebayes/freebayes/1.3.6+galaxy0`, name: 'FreeBayes', desc: 'bayesian genetic variant detector', version: '1.3.6+galaxy0', section: 'Variant calling', needs: 'freebayes',
      requirements: [['freebayes', '1.3.6'], ['samtools', '1.17']],
      cite: ['freebayes2012'],
      inputs: [
        { name: 'reference', short: 'reference', label: 'Choose the source for the reference genome: use a genome from the history', ext: ['fasta'], nice: 'ref.fa' },
        { name: 'input_bam', short: 'BAM', label: 'BAM dataset (sorted by position)', ext: ['bam'], nice: 'input.bam' }
      ],
      params: [
        { name: 'ploidy', short: 'ploidy', label: 'Ploidy of the sample (-p)', type: 'int', default: 2 },
        { name: 'min_alt_count', short: 'min alt count', label: 'Require at least this many reads supporting an alternate allele (-C)', type: 'int', default: 2 },
        { name: 'min_alt_fraction', short: 'min alt fraction', label: 'Require at least this fraction of the reads supporting an alternate allele (-F)', type: 'float', default: 0.05 },
        { name: 'min_mapq', short: 'min MAPQ', label: 'Exclude alignments with a mapping quality less than (-m)', type: 'int', default: 1 },
        { name: 'min_baseq', short: 'min base quality', label: 'Exclude alleles with a base quality less than (-q)', type: 'int', default: 0 }
      ],
      outputs: [{ name: 'output_vcf', short: 'VCF', ext: 'vcf', file: 'output.vcf', label: (ins) => L('FreeBayes', ins) }],
      command: (i, p) => {
        const f = Number.isFinite(+p.min_alt_fraction) && String(p.min_alt_fraction).trim() !== '' ? +p.min_alt_fraction : 0.05;
        return `samtools faidx ${i.reference} && freebayes --bam ${i.input_bam} --fasta-reference ${i.reference} -p ${int(p.ploidy, 2)} -C ${int(p.min_alt_count, 2)} -F ${f} -m ${int(p.min_mapq, 1)} -q ${int(p.min_baseq, 0)} --vcf output.vcf`;
      },
      help: '<p>Calls SNPs, indels and multi-nucleotide variants from the reads, looking at the haplotypes in each read rather than at single positions. The output is a VCF file; its QUAL column is the evidence that a variant is there. An alternative to <b>bcftools mpileup</b> + <b>bcftools call</b>.</p>'
    },
    {
      id: 'lofreq_indelqual', toolId: `${TS}/iuc/lofreq_indelqual/lofreq_indelqual/2.1.5+galaxy1`, name: 'Insert indel qualities', desc: 'into a BAM file', version: '2.1.5+galaxy1', section: 'Variant calling', needs: 'lofreq',
      requirements: [['lofreq', '2.1.5'], ['samtools', '1.17']],
      cite: ['lofreq2012', 'dindel2011'],
      inputs: [
        { name: 'reads', short: 'BAM', label: 'Reads (BAM)', ext: ['bam'], nice: 'reads.bam' },
        { name: 'ref', short: 'reference', label: 'Reference (for Dindel): use a genome from the history', ext: ['fasta'], nice: 'ref.fa', optional: true }
      ],
      params: [
        { name: 'selector', short: 'approach', label: 'Indel calculation approach', type: 'select', default: 'dindel', options: [['dindel', 'Dindel (needs the reference)'], ['uniform', 'Uniform']], help: 'Dindel computes indel qualities from the reads and the reference (Illumina reads); Uniform gives every base the same quality.' },
        { name: 'insertions', short: 'quality', label: 'Uniform: indel quality to add', type: 'int', default: 30 }
      ],
      outputs: [{ name: 'output', short: 'BAM', ext: 'bam', file: 'output.bam', label: (ins) => L('Insert indel qualities', ins) }],
      command: (i, p) => p.selector === 'uniform'
        ? `lofreq indelqual --uniform ${int(p.insertions, 30)} -o output.bam ${i.reads}`
        : `samtools faidx ${i.ref || 'NO_REFERENCE_GIVEN.fa'} && lofreq indelqual --dindel --ref ${i.ref || 'NO_REFERENCE_GIVEN.fa'} -o output.bam ${i.reads}`,
      help: '<p>Adds indel qualities to every read: LoFreq needs them to call indels (Call variants with LoFreq, “SNVs and indels”). Do not realign the reads afterwards.</p>'
    },
    {
      id: 'lofreq_call', toolId: `${TS}/iuc/lofreq_call/lofreq_call/2.1.5+galaxy3`, name: 'Call variants', desc: 'with LoFreq', version: '2.1.5+galaxy3', section: 'Variant calling', needs: 'lofreq',
      requirements: [['lofreq', '2.1.5'], ['samtools', '1.17']],
      cite: ['lofreq2012'],
      inputs: [
        { name: 'reads', short: 'BAM', label: 'Input reads in BAM format', ext: ['bam'], nice: 'reads.bam' },
        { name: 'ref', short: 'reference', label: 'Choose the source for the reference genome: use a genome from the history', ext: ['fasta'], nice: 'ref.fa' },
        { name: 'bed', short: 'regions', label: 'Call variants across: regions specified in BED (optional; empty: the whole reference)', ext: ['bed'], nice: 'regions.bed', optional: true }
      ],
      params: [
        { name: 'variant_types', short: 'types', label: 'Types of variants to call', type: 'select', default: '', options: [['', 'Only SNVs'], ['--call-indels', 'SNVs and indels'], ['--call-indels --only-indels', 'Only indels']], help: 'Indels need indel qualities in the reads: run Insert indel qualities first.' },
        { name: 'filter_type', short: 'filter', label: 'Variant filter parameters', type: 'select', default: 'set_lofreq_standard', options: [['set_lofreq_standard', 'Preset filtering on QUAL score + coverage + strand bias (lofreq call default)'], ['set_no_default', 'Preset QUAL score-based filtering'], ['set_all_off', 'Strictly no filtering']] },
        { name: 'min_cov', short: 'min coverage', label: 'Minimum coverage at a position (--min-cov)', type: 'int', default: 1 }
      ],
      outputs: [{ name: 'variants', short: 'VCF', ext: 'vcf', file: 'variants.vcf', label: (ins) => L('Call variants', ins) }],
      command: (i, p) => {
        const types = ['', '--call-indels', '--call-indels --only-indels'].includes(p.variant_types) ? p.variant_types : '';
        const filter = p.filter_type === 'set_all_off' ? ' --sig 1 --bonf 1 --no-default-filter' : p.filter_type === 'set_no_default' ? ' --sig 0.01 --bonf dynamic --no-default-filter' : ' --sig 0.01 --bonf dynamic';
        return `samtools faidx ${i.ref} && lofreq call --ref ${i.ref} --out variants.vcf${types ? ' ' + types : ''}${i.bed ? ' --bed ' + i.bed : ''} --min-cov ${Math.max(1, int(p.min_cov, 1))}${filter} ${i.reads}`;
      },
      help: '<p>Calls single-nucleotide variants (and indels, with indel qualities) at any frequency the data supports – also variants carried by only a few percent of the reads, as in viral populations or tumours. Each call has a quality (QUAL) and the allele frequency (AF). (Galaxy\'s tool runs lofreq call-parallel on several cores; here lofreq call runs on one. The calls are the same, but for rare differences where call-parallel splits the genome.)</p>'
    },
    {
      id: 'strelka_somatic', toolId: `${TS}/iuc/strelka_somatic/strelka_somatic/2.9.10+galaxy0`, name: 'Strelka Somatic', desc: 'small variant caller for somatic variation in tumor/normal sample pairs', version: '2.9.10+galaxy0', section: 'Variant calling', needs: 'configureStrelkaSomaticWorkflow.py',
      requirements: [['strelka', '2.9.10'], ['samtools', '1.17'], ['htslib', '1.17']],
      cite: ['strelka2_2018'],
      inputs: [
        { name: 'normalBam', short: 'normal', label: 'Select normal sample file (BAM)', ext: ['bam'], nice: 'input_normal.bam', pick: /normal/i },
        { name: 'tumorBam', short: 'tumor', label: 'Select tumor sample file (BAM)', ext: ['bam'], nice: 'input_tumor.bam', pick: /tumou?r/i },
        { name: 'ref', short: 'reference', label: 'Choose the source for the reference genome: use a genome from the history', ext: ['fasta'], nice: 'input_ref.fa' }
      ],
      params: [
        { name: 'optimization', short: 'data', label: 'Optimize variant calling for', type: 'select', default: '', options: [['', 'Whole-genome sequencing (WGS) data (default mode)'], ['--exome', 'Whole-exome sequencing (WES) data (--exome)']], help: '--exome turns off the filter of positions with a much higher depth than the chromosome\'s mean.' },
        { name: 'minTier1Mapq', short: 'min MAPQ', label: 'Set minTier1Mapq: minimum MAPQ score for reads at tier1', type: 'int', default: 20 },
        { name: 'ssnvQuality_LowerBound', short: 'SNV QSS', label: 'Set ssnvQuality_LowerBound: somatic quality score below which SNVs are marked as filtered', type: 'int', default: 15 },
        { name: 'sindelQuality_LowerBound', short: 'indel QSI', label: 'Set sindelQuality_LowerBound: somatic quality score below which indels are marked as filtered', type: 'int', default: 40 },
        { name: 'outputCallableRegions', short: 'callable', label: 'Generate bed file describing somatic callable regions of the genome', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'out_indels', short: 'indels', ext: 'vcf', file: 'indels.vcf', label: (ins) => L('Strelka Somatic', ins, 'Indels, vcf') },
        { name: 'out_snvs', short: 'SNVs', ext: 'vcf', file: 'snvs.vcf', label: (ins) => L('Strelka Somatic', ins, 'SNVs, vcf') },
        { name: 'out_callable', short: 'callable', ext: 'bed', file: 'callable.bed', when: (i, p) => !!p.outputCallableRegions, label: (ins) => L('Strelka Somatic', ins, 'Callable regions, bed') }
      ],
      command: (i, p) => {
        const conf = `[StrelkaSomatic]\\nminTier1Mapq = ${int(p.minTier1Mapq, 20)}\\nssnvQuality_LowerBound = ${int(p.ssnvQuality_LowerBound, 15)}\\nsindelQuality_LowerBound = ${int(p.sindelQuality_LowerBound, 40)}\\n`;
        // (the BAM datasets come with their index, as in Galaxy: .bai next to them in the job's folder)
        return `samtools faidx ${i.ref} && printf '${conf}' > config.txt && `
          + `configureStrelkaSomaticWorkflow.py --normalBam ${i.normalBam} --tumorBam ${i.tumorBam}${p.outputCallableRegions ? ' --outputCallableRegions' : ''} --config=config.txt${p.optimization === '--exome' ? ' --exome' : ''} --referenceFasta ${i.ref} --runDir results > /dev/null && `
          + `results/runWorkflow.py -m local -j 1 --quiet && bgzip -d results/results/variants/somatic.indels.vcf.gz && bgzip -d results/results/variants/somatic.snvs.vcf.gz && mv results/results/variants/somatic.indels.vcf indels.vcf && mv results/results/variants/somatic.snvs.vcf snvs.vcf`
          + (p.outputCallableRegions ? ' && bgzip -d results/results/regions/somatic.callable.regions.bed.gz && mv results/results/regions/somatic.callable.regions.bed callable.bed' : '');
      },
      help: '<p>Calls somatic SNVs and small indels: variants in the tumour that its matched normal sample does not have. Strelka runs its own workflow – depth of each chromosome, calling in segments, empirical variant scoring – and marks each call PASS or with the filters it failed (in FILTER). Both BAM files must be aligned to the reference given here, with the same chromosomes.</p>'
    },
    /* ---------- Genotypes (GWAS): PLINK 2. The Tool Shed's plink tool (iuc) runs PLINK 1.9, whose options and files
       differ: this tool is the workbench's own, with an ID of its own (as Kalign's). ---------- */
    {
      id: 'plink2', toolId: 'plink2_workbench', name: 'PLINK 2', desc: 'quality control, LD, kinship, association and scores of genotypes', version: '2.0.0-b.1-dev', section: 'Genotypes (GWAS)', needs: 'plink2',
      requirements: [['plink2', '2.0.0-b.1-dev']],
      cite: ['plink2_2015', 'plink2_site'],
      inputs: [
        { name: 'input', short: 'VCF', label: 'Genotypes (VCF)', ext: ['vcf', 'vcf_bgzip'], nice: (d) => (d.ext === 'vcf_bgzip' ? 'input.vcf.gz' : 'input.vcf') },
        { name: 'pheno', short: 'phenotypes', label: 'Phenotype file (--pheno; optional – for association): a column of sample IDs (#IID), then one column per phenotype', ext: ['tabular', 'txt'], nice: 'phenotypes.tsv', pick: /pheno/i, optional: true },
        { name: 'covar', short: 'covariates', label: 'Covariate file (--covar; optional – for association): a column of sample IDs, then one per covariate', ext: ['tabular', 'txt'], nice: 'covariates.tsv', pick: /covar/i, optional: true },
        { name: 'keep', short: 'samples', label: 'Samples to keep (--keep; optional): a list of sample IDs', ext: ['txt', 'tabular'], nice: 'keep.txt', pick: /keep|samples/i, optional: true },
        { name: 'score', short: 'weights', label: 'Weights for scores (--score; for “Scores”): a variant ID, an allele and a weight on each line', ext: ['tabular', 'txt'], nice: 'weights.tsv', pick: /score|weight/i, optional: true }
      ],
      params: [
        { name: 'func', short: 'analysis', label: 'What to do', type: 'select', default: 'stats', options: [['stats', 'Basic statistics: allele frequencies, missing genotypes, Hardy-Weinberg, heterozygosity'], ['filter', 'Filter, and write the variants that pass as VCF (--export vcf)'], ['ld', 'LD pruning (--indep-pairwise)'], ['king', 'Kinship of each pair of samples (--make-king-table)'], ['glm', 'Association: linear or logistic regression (--glm)'], ['score', 'Scores: a weighted sum of alleles for each sample (--score)']] },
        { name: 'maf', short: '--maf', label: 'Filter: minimum minor allele frequency (--maf; optional, e.g. 0.01)', type: 'text', default: '' },
        { name: 'geno', short: '--geno', label: 'Filter: maximum share of missing genotypes of a variant (--geno; optional, e.g. 0.02)', type: 'text', default: '' },
        { name: 'mind', short: '--mind', label: 'Filter: maximum share of missing genotypes of a sample (--mind; optional, e.g. 0.02)', type: 'text', default: '' },
        { name: 'hwe', short: '--hwe', label: 'Filter: Hardy-Weinberg exact test p-value threshold (--hwe; optional, e.g. 1e-6)', type: 'text', default: '' },
        { name: 'freq', short: '--freq', label: 'Basic statistics: allele frequencies (--freq)', type: 'bool', default: true },
        { name: 'missing', short: '--missing', label: 'Basic statistics: missing genotypes of each sample and variant (--missing)', type: 'bool', default: true },
        { name: 'hardy', short: '--hardy', label: 'Basic statistics: Hardy-Weinberg exact test (--hardy)', type: 'bool', default: true },
        { name: 'het', short: '--het', label: 'Basic statistics: heterozygosity and inbreeding coefficient of each sample (--het)', type: 'bool', default: false },
        { name: 'window', short: 'window', label: 'LD pruning: window, in variants', type: 'int', default: 50 },
        { name: 'step', short: 'step', label: 'LD pruning: step, in variants', type: 'int', default: 5 },
        { name: 'r2', short: 'r²', label: 'LD pruning: r² threshold', type: 'float', default: 0.2 },
        { name: 'pheno_name', short: '--pheno-name', label: 'Association: the phenotype to test – a column of the phenotype file (--pheno-name)', type: 'text', default: '' },
        { name: 'firth', short: 'regression', label: 'Association: for a case/control phenotype', type: 'select', default: 'firth-fallback', options: [['firth-fallback', 'logistic regression; Firth regression where it fails (default)'], ['firth', 'Firth regression for every variant (firth)'], ['no-firth', 'logistic regression only (no-firth)']] },
        { name: 'hide_covar', short: 'hide-covar', label: 'Association: leave out the lines of the covariates (hide-covar)', type: 'bool', default: true },
        { name: 'allow_no_covars', short: 'allow-no-covars', label: 'Association: allow a test without covariates (allow-no-covars)', type: 'bool', default: false, help: 'PLINK refuses a test without covariates unless asked: it is usually a mistake (ancestry, sex, age …).' },
        { name: 'score_cols', short: 'columns', label: 'Scores: the columns of the variant ID, the allele and the weight', type: 'text', default: '1 2 3' },
        { name: 'header', short: 'header-read', label: 'Scores: the weights file has a header line (header-read)', type: 'bool', default: true },
        { name: 'sums', short: 'cols=+scoresums', label: 'Scores: also write the sums (cols=+scoresums)', type: 'bool', default: true }
      ],
      outputs: [
        { name: 'log', short: 'log', ext: 'txt', file: 'output.log', label: (ins) => L('PLINK 2', ins, 'log') },
        { name: 'afreq', short: 'frequencies', ext: 'tabular', file: 'output.afreq', when: (i, p) => p.func === 'stats' && !!p.freq, label: (ins) => L('PLINK 2', ins, 'allele frequencies') },
        { name: 'smiss', short: 'missing (samples)', ext: 'tabular', file: 'output.smiss', when: (i, p) => p.func === 'stats' && !!p.missing, label: (ins) => L('PLINK 2', ins, 'missing genotypes of each sample') },
        { name: 'vmiss', short: 'missing (variants)', ext: 'tabular', file: 'output.vmiss', when: (i, p) => p.func === 'stats' && !!p.missing, label: (ins) => L('PLINK 2', ins, 'missing genotypes of each variant') },
        { name: 'hardy', short: 'Hardy-Weinberg', ext: 'tabular', file: 'output.hardy', when: (i, p) => p.func === 'stats' && !!p.hardy, label: (ins) => L('PLINK 2', ins, 'Hardy-Weinberg') },
        { name: 'het', short: 'heterozygosity', ext: 'tabular', file: 'output.het', when: (i, p) => p.func === 'stats' && !!p.het, label: (ins) => L('PLINK 2', ins, 'heterozygosity') },
        { name: 'vcf', short: 'VCF', ext: 'vcf', file: 'output.vcf', when: (i, p) => p.func === 'filter', label: (ins) => L('PLINK 2', ins, 'filtered variants') },
        { name: 'prune_in', short: 'kept', ext: 'txt', file: 'output.prune.in', when: (i, p) => p.func === 'ld', label: (ins) => L('PLINK 2', ins, 'LD pruning: variants kept') },
        { name: 'prune_out', short: 'left out', ext: 'txt', file: 'output.prune.out', when: (i, p) => p.func === 'ld', label: (ins) => L('PLINK 2', ins, 'LD pruning: variants left out') },
        { name: 'kin0', short: 'kinship', ext: 'tabular', file: 'output.kin0', when: (i, p) => p.func === 'king', label: (ins) => L('PLINK 2', ins, 'kinship (KING)') },
        { name: 'glm', short: 'association', ext: 'tabular', file: 'glm.tsv', when: (i, p) => p.func === 'glm', label: (ins, p) => L('PLINK 2', ins, 'association' + (p && /^[A-Za-z0-9_.-]+$/.test(String(p.pheno_name || '').trim()) ? ' with ' + String(p.pheno_name).trim() : '')) },
        { name: 'sscore', short: 'scores', ext: 'tabular', file: 'output.sscore', when: (i, p) => p.func === 'score', label: (ins) => L('PLINK 2', ins, 'scores') }
      ],
      command: (i, p) => {
        const num = (v) => { const t = String(v == null ? '' : v).trim(); return /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? t : ''; };
        const f = ['stats', 'filter', 'ld', 'king', 'glm', 'score'].includes(p.func) ? p.func : 'stats';
        const a = ['plink2 --vcf ' + i.input];
        if (i.pheno) a.push('--pheno ' + i.pheno);
        if (i.covar) a.push('--covar ' + i.covar);
        if (i.keep) a.push('--keep ' + i.keep);
        for (const k of ['maf', 'geno', 'mind', 'hwe']) if (num(p[k])) a.push(`--${k} ${num(p[k])}`);
        let then = '';
        if (f === 'stats') {
          const which = ['freq', 'missing', 'hardy', 'het'].filter((k) => p[k]);
          if (!which.length) return refuse('PLINK 2: choose at least one of the basic statistics.');
          a.push(which.map((k) => '--' + k).join(' '));
        } else if (f === 'filter') a.push('--export vcf');
        else if (f === 'ld') a.push(`--indep-pairwise ${Math.max(2, int(p.window, 50))} ${Math.max(1, int(p.step, 5))} ${num(p.r2) || 0.2}`);
        else if (f === 'king') a.push('--make-king-table');
        else if (f === 'glm') {
          const name = String(p.pheno_name || '').trim();
          if (!i.pheno) return refuse('PLINK 2: an association test needs a phenotype file.');
          if (!/^[A-Za-z0-9_.-]+$/.test(name)) return refuse('PLINK 2: name the phenotype to test – the name of a column of the phenotype file (letters, digits, _ . -).');
          const mods = [];
          if (i.covar && p.hide_covar) mods.push('hide-covar');
          if (p.firth === 'firth' || p.firth === 'no-firth') mods.push(p.firth);
          if (!i.covar && p.allow_no_covars) mods.push('allow-no-covars');
          a.push('--pheno-name ' + name, '--glm' + (mods.length ? ' ' + mods.join(' ') : ''));
          // (PLINK names the file after the phenotype and the test: output.NAME.glm.linear, .glm.logistic.hybrid …)
          then = ` && cp output.${name}.glm.* glm.tsv`;
        } else if (f === 'score') {
          if (!i.score) return refuse('PLINK 2: scores need a file of weights.');
          const cols = String(p.score_cols || '').trim().split(/\s+/).filter((c) => /^\d+$/.test(c));
          a.push(`--score ${i.score} ${(cols.length >= 1 && cols.length <= 3 ? cols : ['1', '2', '3']).join(' ')}${p.header ? ' header-read' : ''}${p.sums ? ' cols=+scoresums' : ''}`);
        }
        a.push('--out output --threads 1 --memory 640 require');
        return a.join(' ') + then;
      },
      help: '<p>Runs PLINK 2 on the genotypes of a VCF file: first the filters – minor allele frequency, missing genotypes of variants and of samples, Hardy-Weinberg, the samples to keep – then one analysis: basic statistics, the variants that pass as a VCF, LD pruning, the kinship of each pair of samples (KING), an association test of each variant with a phenotype (linear regression for a quantitative one, logistic for cases and controls, with the covariates in the model), or scores (a weighted sum of the alleles of each sample, as for a polygenic score). The <b>log</b> says what PLINK did – how many variants and samples each filter removed. The Galaxy Tool Shed has no PLINK 2 tool (its <i>plink</i> tool runs PLINK 1.9, with other options and files), so this tool is the workbench’s own: a workflow with it does not open on a Galaxy server. PLINK 2 needs the page to be cross-origin isolated (see Limits in the help); this build of it has no principal components (<code>--pca</code>).</p>'
    },
    {
      id: 'kraken2', toolId: `${TS}/iuc/kraken2/kraken2/2.17.1+galaxy0`, name: 'Kraken2', desc: 'assign taxonomic labels to sequencing reads', version: '2.17.1+galaxy0', section: 'Metagenomics', needs: 'kraken2',
      requirements: [['kraken2', '2.17.2']],
      cite: ['kraken2014', 'kraken2_2019'],
      inputs: [
        { name: 'input_sequences', short: 'reads', label: 'Input sequences (single-end reads – or, for paired reads, the forward reads)', ext: ['fastqsanger', 'fasta'], nice: (d) => 'input_1.' + DOWNLOAD_EXT[d.ext], pick: /_1\b|R1|forward/i },
        { name: 'input_reverse', short: 'reverse reads', label: 'Reverse reads, for paired reads (leave empty for single-end reads)', ext: ['fastqsanger', 'fasta'], nice: (d) => 'input_2.' + DOWNLOAD_EXT[d.ext], pick: /_2\b|R2|reverse/i, optional: true }
      ],
      params: [
        { name: 'kraken2_database', short: 'database', label: 'Select a Kraken2 database', type: 'select', default: 'mock3', options: [['mock3', 'Mock community example: Escherichia coli, Salmonella enterica, Shigella flexneri (1 Mb of each)']], help: 'On a Galaxy server the administrators install the databases (Standard, PlusPF, viral …). Here there is the example database, /data/examples/metagenomics/db.' },
        { name: 'use_names', short: 'names', label: 'Print scientific names instead of just taxids (--use-names)', type: 'bool', default: false },
        { name: 'confidence', short: 'confidence', label: 'Confidence (--confidence)', type: 'float', default: 0, help: 'Confidence score threshold. Must be in [0, 1]' },
        { name: 'min_base_quality', short: 'min base quality', label: 'Minimum Base Quality (--minimum-base-quality)', type: 'int', default: 0, help: 'Minimum base quality used in classification (only effective with FASTQ input)' },
        { name: 'minimum_hit_groups', short: 'hit groups', label: 'Minimum hit groups (--minimum-hit-groups)', type: 'int', default: 2, help: 'Number of overlapping k-mers sharing the same minimizer needed to make a call' },
        { name: 'quick', short: 'quick', label: 'Enable quick operation (--quick)', type: 'bool', default: false, help: 'Quick operation (use first hit)' },
        { name: 'split_reads', short: 'split', label: 'Split classified and unclassified outputs?', type: 'bool', default: false, help: 'Sets --unclassified-out and --classified-out' },
        { name: 'create_report', short: 'report', label: 'Print a report with aggregrate counts/clade to file (--report)', type: 'select', default: 'false', options: [['true', 'Yes'], ['false', 'No']], help: 'Can be used as input for Bracken' },
        { name: 'use_mpa_style', short: 'mpa style', label: "Report: format report output like Kraken 1's kraken-mpa-report (--use-mpa-style)", type: 'bool', default: false },
        { name: 'report_zero_counts', short: 'zero counts', label: 'Report: report counts for ALL taxa, even if counts are zero (--report-zero-counts)', type: 'bool', default: false },
        { name: 'report_minimizer_data', short: 'minimizer data', label: 'Report: report minimizer data (--report-minimizer-data)', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'classified_out_s', short: 'classified', ext: { from: 'input_sequences' }, file: 'cl_out', when: (i, p) => !!p.split_reads && !i.input_reverse, label: (ins) => L('Kraken2', ins, 'Classified reads') },
        { name: 'unclassified_out_s', short: 'unclassified', ext: { from: 'input_sequences' }, file: 'un_out', when: (i, p) => !!p.split_reads && !i.input_reverse, label: (ins) => L('Kraken2', ins, 'Unclassified reads') },
        { name: 'classified_forward', short: 'classified forward', ext: { from: 'input_sequences' }, file: 'cl_out_1', when: (i, p) => !!p.split_reads && !!i.input_reverse, label: (ins) => L('Kraken2', ins, 'Classified read pairs: forward') },
        { name: 'classified_reverse', short: 'classified reverse', ext: { from: 'input_sequences' }, file: 'cl_out_2', when: (i, p) => !!p.split_reads && !!i.input_reverse, label: (ins) => L('Kraken2', ins, 'Classified read pairs: reverse') },
        { name: 'unclassified_forward', short: 'unclassified forward', ext: { from: 'input_sequences' }, file: 'un_out_1', when: (i, p) => !!p.split_reads && !!i.input_reverse, label: (ins) => L('Kraken2', ins, 'Unclassified read pairs: forward') },
        { name: 'unclassified_reverse', short: 'unclassified reverse', ext: { from: 'input_sequences' }, file: 'un_out_2', when: (i, p) => !!p.split_reads && !!i.input_reverse, label: (ins) => L('Kraken2', ins, 'Unclassified read pairs: reverse') },
        { name: 'report_output', short: 'report', ext: 'tabular', file: 'report.tsv', when: (i, p) => p.create_report === 'true', label: (ins) => L('Kraken2', ins, 'Report') },
        { name: 'output', short: 'classification', ext: 'tabular', file: 'output.tsv', label: (ins) => L('Kraken2', ins, 'Classification') }
      ],
      command: (i, p) => {
        const num = (v, d) => (Number.isFinite(+v) && String(v).trim() !== '' ? Math.min(1, Math.max(0, +v)) : d);
        const pe = !!i.input_reverse, report = p.create_report === 'true';
        return `kraken2 --threads 1 --db /data/examples/metagenomics/db${p.quick ? ' --quick' : ''}${pe ? ` --paired ${i.input_sequences} ${i.input_reverse}` : ` ${i.input_sequences}`}`
          + (p.split_reads ? (pe ? " --unclassified-out 'un_out#' --classified-out 'cl_out#'" : ' --unclassified-out un_out --classified-out cl_out') : '')
          + ` --confidence ${num(p.confidence, 0)} --minimum-base-quality ${int(p.min_base_quality, 0)} --minimum-hit-groups ${int(p.minimum_hit_groups, 2)}${p.use_names ? ' --use-names' : ''}`
          + (report ? ` --report report.tsv${p.use_mpa_style ? ' --use-mpa-style' : ''}${p.report_zero_counts ? ' --report-zero-counts' : ''}${p.report_minimizer_data ? ' --report-minimizer-data' : ''}` : '')
          + ' > output.tsv';
      },
      help: '<p>Gives each read the taxon – species, genus, family … – whose DNA its k-mers match in the database, or none (unclassified). The <b>Classification</b> has a line per read: C or U, its name, the taxonomy ID, its length and the taxa of its k-mers; the <b>Report</b> counts the reads per taxon and is what Bracken reads. Only what is in the database can be found: a read of a species that is not there stays unclassified, or goes to a relative. Kraken2 runs on one thread here.</p>'
    },
    {
      id: 'est_abundance', toolId: `${TS}/iuc/bracken/est_abundance/3.1+galaxy0`, name: 'Bracken', desc: 'to re-estimate abundance at a taxonomic level from kraken output', version: '3.1+galaxy0', section: 'Metagenomics', needs: 'est_abundance.py',
      requirements: [['bracken', '3.1']],
      cite: ['bracken2017'],
      inputs: [
        { name: 'input', short: 'report', label: 'Kraken report file', ext: ['tabular'], nice: 'kraken_report.tsv' }
      ],
      params: [
        { name: 'kmer_distr', short: 'distribution', label: 'Select a Kmer distribution', type: 'select', default: 'mock3_151', options: [['mock3_151', 'Mock community example database, reads of 151 bases']], help: 'The distribution of the Kraken2 database the reads were classified with, for the length of the reads. On a Galaxy server the administrators install them with the databases.' },
        { name: 'level', short: 'level', label: 'Level', type: 'select', default: 'S', options: [['S2', 'Subspecies 2'], ['S1', 'Subspecies 1'], ['S', 'Species'], ['G', 'Genus'], ['F', 'Family'], ['O', 'Order'], ['C', 'Class'], ['P', 'Phylum'], ['D', 'Domain']], help: 'Level to push all reads to' },
        { name: 'threshold', short: 'threshold', label: 'Threshold: the reads a taxon needs before re-estimation (-t)', type: 'int', default: 10, help: 'Threshold for the minimum number of reads kraken must assign to a classification for that classification to be considered in the final abundance estimation. (On usegalaxy.org this field is labelled "Number of mismatches allowed when matching tag".)' },
        { name: 'out_report', short: 'Kraken-style report', label: 'Produce Kraken-Style Bracken report (--out-report)', type: 'bool', default: false },
        { name: 'logfile_output', short: 'log', label: 'Add log file output', type: 'bool', default: false }
      ],
      outputs: [
        { name: 'report', short: 'report', ext: 'tabular', file: 'report.tsv', label: (ins) => L('Bracken', ins, 'Report') },
        { name: 'kraken_report', short: 'Kraken-style report', ext: 'tabular', file: 'bracken.report', when: (i, p) => !!p.out_report, label: (ins) => L('Bracken', ins, 'Kraken style report') },
        { name: 'logfile', short: 'log', ext: 'txt', file: 'log.txt', when: (i, p) => !!p.logfile_output, label: (ins) => L('Bracken', ins, 'log file') }
      ],
      command: (i, p) => {
        const level = ['S2', 'S1', 'S', 'G', 'F', 'O', 'C', 'P', 'D'].includes(p.level) ? p.level : 'S';
        return `est_abundance.py -i ${i.input} -k /data/examples/metagenomics/db/database151mers.kmer_distrib -l ${level} -t ${int(p.threshold, 10)} -o report.tsv --out-report bracken.report${p.logfile_output ? ' | tee log.txt' : ''}`;
      },
      help: '<p>Kraken2 assigns many reads only to a genus or a family, where species share their DNA. Bracken moves those reads down to the level chosen – species, by default – in proportion to how likely each species is to give reads that end there (the k-mer distribution of the database), and estimates how many reads each species has. The <b>Report</b> has a line per taxon: Kraken2\'s reads, the reads added, the new estimate and its share of all the reads estimated at that level.</p>'
    },
    /* ---------- Annotation: genes, and profile HMMs ---------- */
    {
      id: 'prodigal', toolId: `${TS}/iuc/prodigal/prodigal/2.6.3+galaxy0`, name: 'Prodigal Gene Predictor', desc: 'A tool for gene prediction in microbial genomes', version: '2.6.3+galaxy0', section: 'Annotation', needs: 'prodigal',
      requirements: [['prodigal', '2.6.3']],
      cite: ['prodigal2010'],
      inputs: [{ name: 'input_fa', short: 'genome', label: 'Specify input file (-i)', ext: ['fasta'], nice: 'input.fasta' }],
      params: [
        { name: 'out_format', short: 'format', label: 'Specify output format (-f)', type: 'select', default: 'gbk', options: [['gbk', 'GBK (default)'], ['gff', 'GFF'], ['sco', 'SCO']], help: 'GBK: features in the style of GenBank; GFF: GFF3, for genome browsers; SCO: the start, end and strand of each gene. (Galaxy’s tool also lists SQN, which Prodigal 2.6.3 does not have: it stops with “Invalid output format specified.”)' },
        { name: 'procedure', short: 'mode', label: 'Specify mode (-p)', type: 'select', default: 'single', options: [['single', 'Single : Single genome, any number of sequences (default)'], ['meta', 'Meta : Anonymous sequences, analyze using preset training files, ideal for metagenomic data or single short sequences']] },
        { name: 'trans_table', short: 'genetic code', label: 'Specify a translation table to use (-g)', type: 'select', default: '11', options: [['11', '11 : Standard Bacteria/Archaea (default)'], ['4', '4 : Mycoplasma/Spiroplasma']] },
        { name: 'closed', short: '-c', label: 'Closed ends (-c)', type: 'bool', default: false, help: 'Closed ends. Do not allow partial genes at edges of sequence' },
        { name: 'force_nonsd', short: '-n', label: 'Force Prodigal to scan for motifs (-n)', type: 'bool', default: false, help: 'Do not use the Shine-Dalgarno RBS finder and instead force Prodigal to scan for motifs' },
        { name: 'masked_seq', short: '-m', label: 'Treat runs of N as masked sequence (-m)', type: 'bool', default: false, help: "Treat runs of N as masked sequence; don't build genes across them" }
      ],
      outputs: [
        { name: 'output', short: 'coordinates', ext: (p) => (p.out_format === 'gff' ? 'gff3' : 'genbank'), file: 'output', label: (ins) => L('Prodigal Gene Predictor', ins, 'coordinates') },
        { name: 'output_faa', short: 'proteins', ext: 'fasta', file: 'output.faa', label: (ins) => L('Prodigal Gene Predictor', ins, 'protein translations file') },
        { name: 'output_fnn', short: 'genes', ext: 'fasta', file: 'output.fnn', label: (ins) => L('Prodigal Gene Predictor', ins, 'nucleotide sequences file') },
        { name: 'output_start', short: 'starts', ext: 'tabular', file: 'output.start', label: (ins) => L('Prodigal Gene Predictor', ins, 'complete starts file') }
      ],
      command: (i, p) => {
        const f = ['gbk', 'gff', 'sco'].includes(p.out_format) ? p.out_format : 'gbk';
        return `prodigal -i ${i.input_fa} -o output -f ${f} -p ${p.procedure === 'meta' ? 'meta' : 'single'} -g ${p.trans_table === '4' ? 4 : 11} -a output.faa -d output.fnn -s output.start${p.closed ? ' -c' : ''}${p.force_nonsd ? ' -n' : ''}${p.masked_seq ? ' -m' : ''}`;
      },
      help: '<p>Finds the genes that code for proteins in the genome of a bacterium or an archaeon. In mode <b>Single</b> Prodigal first learns the genome – its GC content, codon usage, start codons and ribosome binding sites – from the sequence itself, so it needs no training data: give it the whole genome, contigs and all (100,000 bases or more), not one gene. Mode <b>Meta</b> uses models that come with Prodigal: for a metagenome, or a sequence too short to learn from. The <b>coordinates</b> list the genes (GenBank-style by default, or GFF); the <b>protein translations</b> and <b>nucleotide sequences</b> have one record per gene; the <b>complete starts</b> file has every possible start of every gene, with its scores.</p>'
    },
    {
      id: 'hmmer_hmmbuild', toolId: `${TS}/iuc/hmmer_hmmbuild/hmmer_hmmbuild/3.4+galaxy0`, name: 'hmmbuild', desc: 'Build a profile HMM from an input multiple alignment', version: '3.4+galaxy0', section: 'Annotation', needs: 'hmmbuild',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [{ name: 'msafile', short: 'alignment', label: 'Multiple Sequence Alignment (Stockholm, or aligned FASTA)', ext: ['stockholm', 'fasta'], nice: (d) => 'msafile.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'hmmname', short: '-n', label: 'Name for the HMM (-n; optional)', type: 'text', default: '', help: 'Without one, the profile takes the name of the alignment (its #=GF ID line, in Stockholm), or else that of its file in the job – here “msafile”.' },
        HMM_ALPHABET(false),
        { name: 'model_construction_strategy_select', short: 'construction', label: 'Model Construction Strategy', type: 'select', default: 'fast', options: [['fast', 'Assign columns with >= symfrac residues as consensus (--fast)'], ['hand', 'Manual construction (requires reference annotation) (--hand)']] },
        { name: 'symfrac', short: '--symfrac', label: 'Sets sym fraction controlling --fast construction (--symfrac)', type: 'float', default: 0.5 },
        { name: 'fragthresh', short: '--fragthresh', label: 'Fraction of alignment length, under which sequences are excluded (--fragthresh)', type: 'float', default: 0.5, help: 'HMMER infers fragments if the sequence length L is less than or equal to a fraction x times the alignment length in columns' },
        { name: 'arsws_select', short: 'weighting', label: 'Alternative relative sequence weighting strategies', type: 'select', default: '--wpb', options: [['--wpb', 'Henikoff position-based weights (--wpb)'], ['--wgsc', 'Gerstein/Sonnhammer/Chothia tree weights (--wgsc)'], ['--wblosum', 'Henikoff simple filter weights (--wblosum)'], ['--wnone', "don't do any relative weighting; set all to 1 (--wnone)"], ['--wgiven', 'use weights as given in MSA file (--wgiven)']] },
        { name: 'wid', short: '--wid', label: 'Set identity cutoff (--wid; with --wblosum)', type: 'float', default: 0.62 },
        { name: 'aeews_select', short: 'effective number', label: 'Alternative effective sequence weighting strategies', type: 'select', default: '', options: [['', 'Disabled'], ['enone', 'No effective seq # weighting: just use nseq (--enone)']], help: 'Disabled: HMMER’s default, --eent (entropy weighting).' },
        { name: 'aps_select', short: 'prior', label: 'Alternative Prior Strategies', type: 'select', default: '', options: [['', 'Unspecified'], ['--pnone', "Don't use any prior; parameters are frequencies (--pnone)"], ['--plaplace', 'Use a Laplace +1 prior (--plaplace)']] },
        HMM_SEED
      ],
      outputs: [{ name: 'hmmout', short: 'HMM', ext: 'hmm3', file: 'output.hmm', label: (ins) => `HMM profile from ${dsName(ins, 'msafile')}` }],
      command: (i, p) => {
        const name = String(p.hmmname || '').trim();
        const sym = hmmNum(p.symfrac) || 0.5, frag = hmmNum(p.fragthresh) || 0.5;
        const w = ['--wpb', '--wgsc', '--wblosum', '--wnone', '--wgiven'].includes(p.arsws_select) ? p.arsws_select : '--wpb';
        return `hmmbuild${name ? ' -n ' + shq(name) : ''} ${['--dna', '--rna'].includes(p.input_format_select) ? p.input_format_select : '--amino'}`
          + (p.model_construction_strategy_select === 'hand' ? ' --hand' : ` --fast --symfrac ${sym}`) + ` --fragthresh ${frag}`
          + ` ${w}${w === '--wblosum' ? ' --wid ' + (hmmNum(p.wid) || 0.62) : ''}${p.aeews_select === 'enone' ? ' --enone' : ''}${['--pnone', '--plaplace'].includes(p.aps_select) ? ' ' + p.aps_select : ''}`
          + ` --seed ${Math.max(0, int(p.seed, 42))} output.hmm ${i.msafile}`;
      },
      help: '<p>Builds a profile HMM from a multiple alignment: for each column, how likely each residue is there, and how likely an insertion or a deletion. hmmsearch, hmmscan, nhmmer and hmmalign search and align with it. The alignment must be aligned (Stockholm, or FASTA with gaps); for DNA or RNA choose the format of sequence and model. With <b>--hand</b> the columns marked in the alignment’s reference line (#=GC RF) become the profile’s.</p>'
    },
    {
      id: 'hmmer_hmmsearch', toolId: `${TS}/iuc/hmmer_hmmsearch/hmmer_hmmsearch/3.4+galaxy0`, name: 'hmmsearch', desc: 'search profile(s) against a sequence database', version: '3.4+galaxy0', section: 'Annotation', needs: 'hmmsearch',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [
        { name: 'hmmfile', short: 'HMM', label: 'HMM model', ext: ['hmm3'], nice: 'hmmfile.hmm' },
        { name: 'seqdb', short: 'sequences', label: 'Sequence database to search against', ext: ['fasta'], nice: 'seqdb.fasta' }
      ],
      params: [].concat(hmmFormats(HMM_TABLES_DOM), HMM_OUT_OPTS, hmmThresholds(true, true), HMM_ACCEL, hmmAdvanced(true), [HMM_SEED]),
      outputs: hmmOutputsDom('HMMSEARCH'),
      command: (i, p) => hmmCheck(p, true) ? refuse('hmmsearch: ' + hmmCheck(p, true)) : `hmmsearch${hmmTables(p, ['tblout', 'domtblout', 'pfamtblout'])}${hmmOpts(p, { dom: true, cut: true, domZ: true })} ${i.hmmfile} ${i.seqdb} > output.txt`,
      help: '<p>Searches a database of sequences with one or more profile HMMs (from hmmbuild, or Pfam’s), and ranks the sequences that match by <b>E-value</b> – the number of hits this good expected by chance in a database of this size. The output has the hits, their domains and the alignments to the profile; the tables have one line per sequence (per-sequence hits) or per domain (per-domain hits), ready for Select, Cut or Python. Their columns are separated by spaces, not tabs.</p>'
    },
    {
      id: 'hmmer_hmmscan', toolId: `${TS}/iuc/hmmer_hmmscan/hmmer_hmmscan/3.4+galaxy0`, name: 'hmmscan', desc: 'search protein sequence(s) against a protein profile database', version: '3.4+galaxy0', section: 'Annotation', needs: 'hmmscan',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [
        { name: 'hmmfile', short: 'HMM database', label: 'HMM model (with “Use a HMM database from history”)', ext: ['hmm3'], nice: 'localref.hmm', optional: true },
        { name: 'seqfile', short: 'sequences', label: 'Sequence file', ext: ['fasta'], nice: 'seqfile.fasta' }
      ],
      params: [].concat([
        { name: 'input_hmm_source', short: 'database from', label: 'Use a built-in HMM model database or own from your history', type: 'select', default: 'indexed', options: [['indexed', 'Use a built-in HMM model database'], ['history', 'Use a HMM database from history']] },
        { name: 'index', short: 'database', label: 'Select a HMM model database (built-in)', type: 'select', default: 'minifam', options: [['minifam', 'Minifam: globins4, fn3 and Pkinase (the HMMER tutorial)']], help: 'On a Galaxy server the administrators install the databases (Pfam-A …). Here there are the three profiles of the HMMER tutorial, in /data/examples/hmmer.' }
      ], hmmFormats(HMM_TABLES_DOM), HMM_OUT_OPTS, hmmThresholds(true, true), HMM_ACCEL, hmmAdvanced(true), [HMM_SEED]),
      outputs: hmmOutputsDom('HMMSCAN'),
      command: (i, p) => {
        if (hmmCheck(p, true)) return refuse('hmmscan: ' + hmmCheck(p, true));
        const own = p.input_hmm_source === 'history';
        if (own && !i.hmmfile) return refuse('hmmscan: choose the HMM model from the history (an hmm3 dataset), or a built-in database.');
        const db = own ? 'localref.hmm' : 'minifam.hmm';
        return (own ? 'hmmpress localref.hmm' : `cat ${MINIFAM.join(' ')} > minifam.hmm && hmmpress minifam.hmm`)
          + ` && hmmscan${hmmTables(p, ['tblout', 'domtblout', 'pfamtblout'])}${hmmOpts(p, { dom: true, cut: true, domZ: true })} ${db} ${i.seqfile} > output.txt`;
      },
      help: '<p>The other way round from hmmsearch: each sequence is searched against a collection of profiles, such as Pfam’s, to see which domains it has. The built-in database here is the small one of the HMMER tutorial: three Pfam families – globins, fibronectin type III (fn3) and protein kinase. A collection of your own (an hmm3 dataset with one profile or more; Concatenate datasets joins them) is first prepared with hmmpress, as Galaxy does.</p>'
    },
    {
      id: 'hmmer_phmmer', toolId: `${TS}/iuc/hmmer_phmmer/hmmer_phmmer/3.4+galaxy0`, name: 'phmmer', desc: 'search a protein sequence against a protein database (BLASTP-like)', version: '3.4+galaxy0', section: 'Annotation', needs: 'phmmer',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [
        { name: 'seqfile', short: 'query', label: 'Protein sequence to search with', ext: ['fasta'], nice: 'seqfile.fasta' },
        { name: 'seqdb', short: 'database', label: 'Sequence Database', ext: ['fasta'], nice: 'seqdb.fasta' }
      ],
      params: [].concat(hmmFormats(HMM_TABLES_DOM), HMM_OUT_OPTS, HMM_HSSI, hmmThresholds(true, false), HMM_ACCEL, hmmAdvanced(true), [HMM_SEED]),
      outputs: hmmOutputsDom('PHMMER'),
      command: (i, p) => hmmCheck(p, true) ? refuse('phmmer: ' + hmmCheck(p, true)) : `phmmer${hmmTables(p, ['tblout', 'domtblout', 'pfamtblout'])}${hmmOpts(p, { dom: true, hssi: true, domZ: true })} ${i.seqfile} ${i.seqdb} > output.txt`,
      help: '<p>Searches a protein database with a protein, as BLASTP does, but with HMMER’s scores and E-values. Each sequence of the first dataset is a query of its own.</p>'
    },
    {
      id: 'hmmer_nhmmer', toolId: `${TS}/iuc/hmmer_nhmmer/hmmer_nhmmer/3.4+galaxy0`, name: 'nhmmer', desc: 'search a DNA model or alignment against a DNA database (BLASTN-like)', version: '3.4+galaxy0', section: 'Annotation', needs: 'nhmmer',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [
        { name: 'hmmfile', short: 'HMM', label: 'HMM model', ext: ['hmm3'], nice: 'hmmfile.hmm' },
        { name: 'seqfile', short: 'target', label: 'Target sequence file', ext: ['fasta'], nice: 'seqfile.fasta' }
      ],
      params: [].concat(hmmFormats([['tblout', 'Table of per-sequence hits', true], ['dfamtblout', 'Table of hits in Dfam format', true], ['aliscoresout', 'Scores for each position in each alignment to file', false]]), HMM_OUT_OPTS, HMM_HSSI, hmmThresholds(false, true), HMM_ACCEL, [HMM_ALPHABET(true)], hmmAdvanced(false), [
        { name: 'w_beta', short: '--w_beta', label: 'Tail mass at which window length is determined (--w_beta; optional)', type: 'text', default: '' },
        { name: 'w_length', short: '--w_length', label: 'Window Length (--w_length; optional)', type: 'text', default: '' }
      ], [HMM_SEED]),
      outputs: [
        { name: 'output', short: 'output', ext: 'txt', file: 'output.txt', label: (ins) => L('NHMMER', ins) },
        { name: 'tblout', short: 'hits', ext: 'txt', file: 'tblout.txt', when: (i, p) => !!p.tblout, label: (ins) => L('NHMMER', ins, 'per-sequence hits from HMM matches') },
        { name: 'dfamtblout', short: 'Dfam-style hits', ext: 'txt', file: 'dfamtblout.txt', when: (i, p) => !!p.dfamtblout, label: (ins) => L('NHMMER', ins, 'per-sequence/per-domain hits from HMM matches') },
        { name: 'aliscoresout', short: 'scores', ext: 'txt', file: 'aliscoresout.txt', when: (i, p) => !!p.aliscoresout, label: (ins) => L('NHMMER', ins, 'scores for positional matches') }
      ],
      command: (i, p) => hmmCheck(p, false) ? refuse('nhmmer: ' + hmmCheck(p, false)) : `nhmmer${hmmTables(p, ['tblout', 'dfamtblout', 'aliscoresout'])}${hmmOpts(p, { cut: true, hssi: true, alphabet: true, lengths: true })} ${i.hmmfile} ${i.seqfile} > output.txt`,
      help: '<p>Searches DNA with a DNA profile HMM – such as those of Dfam, for repeats and transposons – on both strands. The hits are ranked by E-value; the tables give where each hit is and on which strand (a hit on the minus strand runs from the higher coordinate to the lower). Galaxy’s tool sets the filters of hmmsearch (--F2 0.001, --F3 1e-05), which are a little stricter than those nhmmer has by default.</p>'
    },
    {
      id: 'hmmer_hmmalign', toolId: `${TS}/iuc/hmmer_hmmalign/hmmer_hmmalign/3.4+galaxy0`, name: 'hmmalign', desc: 'align sequences to a profile HMM', version: '3.4+galaxy0', section: 'Annotation', needs: 'hmmalign',
      requirements: [['hmmer', '3.4']],
      cite: ['hmmer_web2011', 'hmmer3_2011'],
      inputs: [
        { name: 'seq', short: 'sequences', label: 'Sequence to align against model', ext: ['fasta'], nice: 'seq.fasta' },
        { name: 'hmmfile', short: 'HMM', label: 'HMM model', ext: ['hmm3'], nice: 'hmmfile.hmm' }
      ],
      params: [
        { name: 'trim', short: '--trim', label: 'trim terminal tails of nonaligned residues from alignment (--trim)', type: 'bool', default: false },
        HMM_ALPHABET(false)
      ],
      outputs: [{ name: 'output', short: 'alignment', ext: 'stockholm', file: 'output.sto', label: (ins) => `Alignment of ${dsName(ins, 'seq')} to ${dsName(ins, 'hmmfile')}` }],
      command: (i, p) => `hmmalign${p.trim ? ' --trim' : ''} ${['--dna', '--rna'].includes(p.input_format_select) ? p.input_format_select : '--amino'} --outformat stockholm ${i.hmmfile} ${i.seq} > output.sto`,
      help: '<p>Aligns sequences to a profile HMM, one by one, which makes a multiple alignment of them all (Stockholm format). Each sequence should hold one copy of the domain: residues that do not fit the profile are pushed to the ends – or removed, with --trim. The HMM should have one profile; if it has more, the first is used.</p>'
    },
    {
      id: 'bcftools_filter', toolId: `${TS}/iuc/bcftools_filter/bcftools_filter/1.10`, name: 'bcftools filter', desc: 'Apply fixed-threshold filters', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [{ name: 'input_file', short: 'VCF', label: 'VCF/BCF Data', ext: ['vcf_bgzip', 'vcf', 'bcf'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'include', short: 'include', label: 'Include (expression)', type: 'text', default: 'QUAL>=20 && INFO/DP>=5', help: 'Keep only the sites for which the expression is true, e.g. QUAL>=20 && INFO/DP>=5' },
        { name: 'output_type', short: 'output type', label: 'Output type', type: 'select', default: 'z', options: [['z', 'compressed VCF'], ['v', 'uncompressed VCF']] }
      ],
      outputs: [{ name: 'output_file', short: 'VCF', ext: (p) => (p.output_type === 'z' ? 'vcf_bgzip' : 'vcf'), file: 'output', label: (ins) => L('bcftools filter', ins) }],
      command: (i, p) => `bcftools filter -i ${shq(p.include)} -O${p.output_type} -o output ${i.input_file}`,
      help: '<p>Keeps the variant sites that pass a filter expression (QUAL, INFO/DP, FORMAT/GT …). See <code>bcftools filter --help</code> in the terminal for the syntax.</p>'
    },
    {
      id: 'bcftools_view_h', toolId: `${TS}/iuc/bcftools_view/bcftools_view/1.10`, name: 'bcftools view', desc: 'VCF/BCF conversion, view, subset and filter VCF/BCF files', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [{ name: 'input_file', short: 'VCF', label: 'VCF/BCF Data', ext: ['vcf_bgzip', 'vcf', 'bcf'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [{ name: 'header', short: 'header', label: 'Header', type: 'select', default: 'H', options: [['H', 'suppress the header (-H): records only'], ['h', 'header only (-h)'], ['', 'header and records']] }],
      outputs: [{ name: 'output_file', short: 'text', ext: 'tabular', file: 'output.tsv', label: (ins) => L('bcftools view', ins) }],
      command: (i, p) => `bcftools view ${p.header ? '-' + p.header + ' ' : ''}${i.input_file} > output.tsv`,
      help: '<p>Shows a VCF as text. With <b>-H</b> only the variant records are written, without the header (whose lines record dates, file names and commands, so they differ between runs).</p>'
    },
    {
      id: 'bcftools_query', toolId: `${TS}/iuc/bcftools_query/bcftools_query/1.10`, name: 'bcftools query', desc: 'Extracts fields from VCF/BCF file and prints them in user-defined format', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [{ name: 'input_file', short: 'VCF', label: 'VCF/BCF Data', ext: ['vcf_bgzip', 'vcf', 'bcf'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'format', short: 'format', label: 'Format (-f)', type: 'text', default: '%CHROM\\t%POS\\t%REF\\t%ALT\\t%QUAL\\t%INFO/DP[\\t%GT]\\n', help: 'Fields: %CHROM %POS %ID %REF %ALT %QUAL %FILTER %INFO/TAG; per sample in [ ]: %GT %DP %SAMPLE. \\t is a tab, \\n the end of a line.' },
        { name: 'header', short: 'header', label: 'Print a header line (-H)', type: 'bool', default: true }
      ],
      outputs: [{ name: 'output', short: 'table', ext: 'tabular', file: 'output.tsv', label: (ins) => L('bcftools query', ins) }],
      command: (i, p) => `bcftools query${p.header ? ' -H' : ''} -f ${shq(p.format)} ${i.input_file} > output.tsv`,
      help: '<p>Turns a VCF into a table of the fields you name – ready for a spreadsheet, Python or R.</p>'
    },
    {
      id: 'bcftools_stats', toolId: `${TS}/iuc/bcftools_stats/bcftools_stats/1.10`, name: 'bcftools stats', desc: 'Parses VCF or BCF and produces stats which can be plotted using plot-vcfstats', version: '1.10', section: 'Variant calling', needs: 'bcftools',
      requirements: [['bcftools', '1.10']],
      cite: ['samtools2009', 'samtools_bcftools2021'],
      inputs: [{ name: 'input_file', short: 'VCF', label: 'VCF/BCF Data', ext: ['vcf_bgzip', 'vcf', 'bcf'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [],
      outputs: [{ name: 'output_file', short: 'stats', ext: 'txt', file: 'output.txt', label: (ins) => L('bcftools stats', ins) }],
      command: (i) => `bcftools stats ${i.input_file} > output.txt`,
      help: '<p>Counts of SNPs, indels, transitions and transversions (the lines starting with SN and TSTV), quality and depth distributions.</p>'
    },
    /* ---------- Intervals ---------- */
    {
      id: 'bedtools_genomecoveragebed', toolId: `${TS}/iuc/bedtools/bedtools_genomecoveragebed/2.31.0`, name: 'bedtools Genome Coverage', desc: 'compute the coverage over an entire genome', version: '2.31.0', section: 'Intervals (bedtools)', needs: 'bedtools',
      requirements: [['bedtools', '2.31.0']],
      cite: ['bedtools2010'],
      inputs: [{ name: 'input', short: 'BAM', label: 'Input BAM file', ext: ['bam'], nice: 'input.bam' }],
      params: [{ name: 'report', short: 'report', label: 'Output type', type: 'select', default: '-bg', options: [['-bg', 'BedGraph coverage file (-bg)'], ['-bga', 'BedGraph, regions with no coverage too (-bga)'], ['', 'Histogram of coverage']] }],
      outputs: [{ name: 'output', short: 'coverage', ext: (p) => (p.report ? 'bedgraph' : 'tabular'), file: 'output', label: (ins) => L('Genome Coverage', ins) }],
      command: (i, p) => `bedtools genomecov -ibam ${i.input}${p.report ? ' ' + p.report : ''} > output`,
      help: '<p>The read depth along the genome. A BedGraph can be shown in the Genome browser (the 👁 of the dataset, or copy it to your files).</p>'
    },
    {
      id: 'bedtools_intersectbed', toolId: `${TS}/iuc/bedtools/bedtools_intersectbed/2.31.0`, name: 'bedtools Intersect intervals', desc: 'find overlapping intervals in various ways', version: '2.31.0', section: 'Intervals (bedtools)', needs: 'bedtools',
      requirements: [['bedtools', '2.31.0']],
      cite: ['bedtools2010'],
      inputs: [
        { name: 'inputA', short: 'A', label: 'File A (its features are reported)', ext: FEATURES, nice: (d) => 'a.' + DOWNLOAD_EXT[d.ext] },
        { name: 'inputB', short: 'B', label: 'File B (compared with A)', ext: FEATURES, nice: (d) => 'b.' + DOWNLOAD_EXT[d.ext] }
      ],
      params: [
        { name: 'mode', short: 'report', label: 'What should be written?', type: 'select', default: 'u', options: [['u', 'Each feature of A that overlaps B, once (-u)'], ['v', 'The features of A that do NOT overlap B (-v)'], ['wa', 'The feature of A for every overlap with B (-wa)']] },
        { name: 'header', short: 'header', label: 'Keep the header of A (-header)', type: 'bool', default: true }
      ],
      outputs: [{ name: 'output', short: 'features of A', ext: { from: 'inputA', map: { vcf_bgzip: 'vcf' } }, file: 'output', label: (ins) => L('Intersect intervals', ins) }],
      command: (i, p) => `bedtools intersect -a ${i.inputA} -b ${i.inputB} -${p.mode}${p.header ? ' -header' : ''} > output`,
      help: '<p>Keeps the features of A by their overlap with B – for example the variants (VCF) that fall in exons (BED or GFF). The output has the format of A.</p>'
    },
    /* ---------- FASTA/FASTQ ---------- */
    {
      id: 'seqtk_seq', toolId: `${TS}/iuc/seqtk/seqtk_seq/1.4+galaxy0`, name: 'seqtk_seq', desc: 'common transformation of FASTA/Q (FASTQ to FASTA)', version: '1.4+galaxy0', section: 'FASTA/FASTQ', needs: 'seqtk',
      requirements: [['seqtk', '1.4']],
      cite: ['seqtk'],
      inputs: [{ name: 'input', short: 'reads', label: 'Input FASTQ file', ext: ['fastqsanger'], nice: 'input.fastq' }],
      params: [{ name: 'q', short: 'mask below', label: 'Mask bases with quality lower than this as N (-q; 0: none)', type: 'int', default: 0 }],
      outputs: [{ name: 'default', short: 'FASTA', ext: 'fasta', file: 'output.fasta', label: (ins) => L('seqtk_seq', ins, 'FASTA') }],
      command: (i, p) => `seqtk seq -a${int(p.q, 0) > 0 ? ` -q ${int(p.q, 0)} -n N` : ''} ${i.input} > output.fasta`,
      help: '<p>Converts reads from FASTQ to FASTA (and can mask low-quality bases).</p>'
    },
    {
      id: 'seqtk_sample', toolId: `${TS}/iuc/seqtk/seqtk_sample/1.4+galaxy0`, name: 'seqtk_sample', desc: 'random subsample of fasta or fastq sequences', version: '1.4+galaxy0', section: 'FASTA/FASTQ', needs: 'seqtk',
      requirements: [['seqtk', '1.4']],
      cite: ['seqtk'],
      inputs: [{ name: 'input', short: 'sequences', label: 'Input FASTA/Q file', ext: ['fastqsanger', 'fasta'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'n', short: 'number', label: 'Number of sequences (or a fraction, e.g. 0.1)', type: 'text', default: '1000' },
        { name: 'seed', short: 'seed', label: 'Random seed (-s): use the same seed for the two files of a pair', type: 'int', default: 11 }
      ],
      outputs: [{ name: 'default', short: 'sample', ext: { from: 'input' }, file: 'output', label: (ins) => L('seqtk_sample', ins) }],
      command: (i, p) => `seqtk sample -s ${int(p.seed, 11)} ${i.input} ${/^\d+(\.\d+)?$/.test(String(p.n).trim()) ? String(p.n).trim() : '1000'} > output`,
      help: '<p>A random sample of the sequences. With the same seed, the two files of paired-end reads give the same pairs.</p>'
    },
    /* ---------- Multiple alignments and trees ---------- */
    {
      id: 'kalign', toolId: 'kalign_workbench', name: 'Kalign', desc: 'multiple sequence alignments', version: '3.3.1', section: 'Alignments and trees', needs: 'kalign',
      requirements: [['kalign', '3.3.1']],
      cite: ['kalign3_2020'],
      inputs: [{ name: 'input', short: 'sequences', label: 'Sequences to align (FASTA)', ext: ['fasta'], nice: 'input.fasta' }],
      params: [],
      outputs: [{ name: 'output', short: 'alignment', ext: 'fasta', file: 'output.fasta', label: (ins) => L('Kalign', ins, 'alignment') }],
      command: (i) => `kalign -i ${i.input} -o output.fasta > /dev/null`,
      help: '<p>Aligns all the sequences (DNA, RNA or protein) at once. The output is an aligned FASTA file: every sequence has the same length, with - for gaps.</p>'
    },
    {
      id: 'muscle', toolId: 'muscle_workbench', name: 'MUSCLE', desc: 'multiple aligner tool', version: '3.8.1551', section: 'Alignments and trees', needs: 'muscle',
      requirements: [['muscle', '3.8.1551']],
      cite: ['muscle2004'],
      inputs: [{ name: 'input', short: 'sequences', label: 'Sequences to align (FASTA)', ext: ['fasta'], nice: 'input.fasta' }],
      params: [{ name: 'maxiters', short: 'iterations', label: 'Maximum number of iterations (-maxiters; 2 is faster for many sequences)', type: 'int', default: 16 }],
      outputs: [{ name: 'output', short: 'alignment', ext: 'fasta', file: 'output.fasta', label: (ins) => L('MUSCLE', ins, 'alignment') }],
      command: (i, p) => `muscle -in ${i.input} -out output.fasta -maxiters ${Math.max(1, int(p.maxiters, 16))} -quiet`,
      help: '<p>MUSCLE version 3: progressive alignment, refined by iteration.</p>'
    },
    {
      id: 'fasttree', toolId: `${TS}/iuc/fasttree/fasttree/2.1.11+galaxy0`, name: 'FastTree', desc: 'build large maximum-likelihood phylogenies', version: '2.1.11+galaxy0', section: 'Alignments and trees', needs: 'fasttree',
      requirements: [['fasttree', '2.1.11']],
      cite: ['fasttree2_2010'],
      inputs: [{ name: 'input', short: 'alignment', label: 'Aligned sequences (FASTA)', ext: ['fasta'], nice: 'alignment.fasta' }],
      params: [{ name: 'model', short: 'model', label: 'Sequence type and model', type: 'select', default: 'prot', options: [['prot', 'Protein, JTT+CAT (default)'], ['wag', 'Protein, WAG+CAT (-wag)'], ['lg', 'Protein, LG+CAT (-lg)'], ['nt', 'Nucleotide, Jukes-Cantor+CAT (-nt)'], ['gtr', 'Nucleotide, GTR+CAT (-nt -gtr)']] }],
      outputs: [{ name: 'output', short: 'tree', ext: 'newick', file: 'output.nwk', label: (ins) => L('FastTree', ins, 'tree') }],
      command: (i, p) => `fasttree ${{ prot: '', wag: '-wag ', lg: '-lg ', nt: '-nt ', gtr: '-nt -gtr ' }[p.model] || ''}${i.input} > output.nwk`,
      help: '<p>An approximately-maximum-likelihood tree from a multiple alignment, in Newick format, with local support values (0–1) at the branches. The 👁 of the dataset draws it.</p>'
    },
    /* ---------- Text manipulation ---------- */
    {
      id: 'Grep1', toolId: 'Grep1', name: 'Select', desc: 'lines that match an expression', version: '1.0.4', section: 'Text manipulation',
      requirements: [['grep', '3.7']],
      inputs: [{ name: 'input', short: 'text', label: 'Select lines from', ext: TEXT, nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'invert', short: 'matching', label: 'that', type: 'select', default: '', options: [['', 'Matching'], ['-v', 'NOT Matching']] },
        { name: 'pattern', short: 'pattern', label: 'the pattern (an extended regular expression, as in grep -E)', type: 'text', default: '', help: 'e.g. ^human_CYP2C19 (lines that begin with it), PASS, essential' }
      ],
      outputs: [{ name: 'out_file1', short: 'lines', ext: { from: 'input' }, file: 'output', label: (ins) => `Select on ${dataList(ins)}` }],
      command: (i, p) => `grep ${p.invert ? '-v ' : ''}-E -- ${shq(p.pattern)} ${i.input} > output || [ $? -eq 1 ]`,
      help: '<p>Keeps the lines that match (or do not match) a pattern. No line matching is not an error: the output is then empty.</p>'
    },
    {
      id: 'Cut1', toolId: 'Cut1', name: 'Cut', desc: 'columns from a table', version: '1.0.2', section: 'Text manipulation',
      requirements: [['coreutils', '8.32']],
      inputs: [{ name: 'input', short: 'table', label: 'From', ext: ['tabular', 'csv', 'bed', 'bedgraph', 'vcf', 'gff3', 'gtf', 'txt', 'sam'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'columns', short: 'columns', label: 'Cut columns (e.g. c1,c4 or 1-3)', type: 'text', default: 'c1,c2' },
        { name: 'delimiter', short: 'delimiter', label: 'Delimited by', type: 'select', default: 'tab', options: [['tab', 'Tab'], ['comma', 'Comma']] }
      ],
      outputs: [{ name: 'out_file1', short: 'columns', ext: (p) => (p.delimiter === 'comma' ? 'csv' : 'tabular'), file: 'output', label: (ins) => `Cut on ${dataList(ins)}` }],
      command: (i, p) => `cut ${p.delimiter === 'comma' ? "-d ',' " : ''}-f ${String(p.columns).replace(/[cC\s]/g, '').replace(/[^\d,-]/g, '') || '1'} ${i.input} > output`,
      help: '<p>Keeps the columns you name, in the order of the file. Columns are counted from 1.</p>'
    },
    {
      id: 'sort1', toolId: 'sort1', name: 'Sort', desc: 'data in ascending or descending order', version: '1.2.0', section: 'Text manipulation',
      requirements: [['coreutils', '8.32']],
      inputs: [{ name: 'input', short: 'table', label: 'Sort Dataset', ext: ['tabular', 'bed', 'bedgraph', 'vcf', 'gff3', 'gtf', 'txt'], nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [
        { name: 'column', short: 'column', label: 'on column', type: 'int', default: 1 },
        { name: 'numeric', short: 'numeric', label: 'with flavor', type: 'select', default: 'g', options: [['g', 'Numerical sort'], ['', 'Alphabetical sort']] },
        { name: 'order', short: 'order', label: 'everything in', type: 'select', default: 'r', options: [['r', 'Descending order'], ['', 'Ascending order']] },
        { name: 'header', short: 'header lines', label: 'Number of header lines to keep at the top', type: 'int', default: 0 }
      ],
      outputs: [{ name: 'out_file1', short: 'sorted', ext: { from: 'input' }, file: 'output', label: (ins) => `Sort on ${dataList(ins)}` }],
      command: (i, p) => {
        const c = Math.max(1, int(p.column, 1)), hd = Math.max(0, int(p.header, 0));
        const sort = `sort -t "$(printf '\\t')" -k ${c},${c}${p.numeric}${p.order} -s`;
        return hd ? `{ head -n ${hd} ${i.input}; tail -n +${hd + 1} ${i.input} | ${sort}; } > output` : `${sort} ${i.input} > output`;
      },
      help: '<p>Sorts the lines of a table by one column.</p>'
    },
    {
      id: 'wc_gnu', toolId: 'wc_gnu', name: 'Line/Word/Character count', desc: 'of a dataset', version: '1.0.0', section: 'Text manipulation',
      requirements: [['coreutils', '8.32']],
      inputs: [{ name: 'input', short: 'text', label: 'Text file', ext: TEXT, nice: (d) => 'input.' + DOWNLOAD_EXT[d.ext] }],
      params: [],
      outputs: [{ name: 'out_file1', short: 'counts', ext: 'tabular', file: 'output.tsv', label: (ins) => `Line/Word/Character count on ${dataList(ins)}` }],
      command: (i) => `wc ${i.input} | awk 'BEGIN { print "#lines\\twords\\tcharacters" } { print $1 "\\t" $2 "\\t" $3 }' > output.tsv`,
      help: '<p>Counts the lines, words and characters.</p>'
    },
    {
      id: 'cat1', toolId: 'cat1', name: 'Concatenate datasets', desc: 'tail-to-head', version: '1.0.0', section: 'Text manipulation',
      requirements: [['coreutils', '8.32']],
      inputs: [
        { name: 'input1', short: 'first', label: 'First dataset', ext: TEXT, nice: (d) => 'first.' + DOWNLOAD_EXT[d.ext] },
        { name: 'input2', short: 'second', label: 'Second dataset (put after the first)', ext: TEXT, nice: (d) => 'second.' + DOWNLOAD_EXT[d.ext] }
      ],
      params: [],
      outputs: [{ name: 'out_file1', short: 'joined', ext: { from: 'input1' }, file: 'output', label: (ins) => `Concatenate datasets on ${dataList(ins)}` }],
      command: (i) => `cat ${i.input1} ${i.input2} > output`,
      help: '<p>Puts the second dataset after the first – for example two FASTA files of sequences to align together.</p>'
    }
  ];
  const TOOL = new Map(TOOLS.map((t) => [t.id, t]));
  const available = (t) => !t.needs || !!(MG.shellTools && MG.shellTools[t.needs]);
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  /** the datatype of an output when a job runs: from the parameters, or from an input */
  function runExt(o, params, inDs) {
    if (o.ext && typeof o.ext === 'object') {
      const x = inDs.find((i) => i.name === o.ext.from);
      const e = x && x.ds ? x.ds.ext : 'txt';
      return (o.ext.map && o.ext.map[e]) || e;
    }
    return typeof o.ext === 'function' ? o.ext(params || {}) : o.ext;
  }
  /** the datatypes an output of a workflow step can have (from what its inputs are connected to) */
  function stepOutExts(w, st, outName, depth = 0) {
    if (!st) return [];
    if (st.type === 'input') return st.ext;
    const t = TOOL.get(st.tool);
    const o = t && t.outputs.find((x) => x.name === outName);
    if (!o) return [];
    if (o.ext && typeof o.ext === 'object') {
      const c = (st.connections || {})[o.ext.from];
      const src = c && w.steps.find((s) => s.id === c.step);
      const inp = t.inputs.find((i) => i.name === o.ext.from);
      const base = src && depth < 30 ? stepOutExts(w, src, c.output, depth + 1) : inp ? inp.ext : [];
      return uniq(base.map((x) => (o.ext.map && o.ext.map[x]) || x));
    }
    return [typeof o.ext === 'function' ? o.ext(st.params || {}) : o.ext];
  }
  /** the outputs a step makes: an output with a condition (fastp's second file) only when its input is connected */
  function stepOutputs(st) {
    const t = TOOL.get(st.tool);
    if (!t) return [];
    const conn = {};
    Object.keys(st.connections || {}).forEach((k) => st.connections[k] && (conn[k] = true));
    return t.outputs.filter((o) => !o.when || o.when(conn, st.params || {}));
  }
  function dataList(ins) {
    const hids = ins.map((x) => 'data ' + x.hid);
    if (hids.length <= 1) return hids.join('');
    if (hids.length === 2) return hids.join(' and ');
    return hids.slice(0, -1).join(', ') + ', and ' + hids[hids.length - 1];
  }
  const uid = () => Math.random().toString(36).slice(2, 10);
  const uuid = () => ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  const quiet = () => ({ out() {}, err() {}, note() {}, html() {}, progress() {}, colored() {}, clear() {} });

  class GalaxyApp {
    constructor(root, opts) {
      this.root = root;
      this.fs = opts.fs;
      // Galaxy has its own working directory: a view of the shared file system with its own cwd
      this.gfs = Object.create(this.fs);
      this.gfs.cwd = GX_ROOT;
      this.fs.mkdirp(GX_ROOT + '/database/files/000');
      this.fs.mkdirp(GX_ROOT + '/jobs');
      this.shell = new MG.Shell({ fs: this.gfs, term: null });
      this.datasets = [];
      this.jobs = [];
      this.uploads = [];
      this.invocations = [];
      this.hid = 0;
      this.jobN = 0;
      this.queue = Promise.resolve();
      this.historyName = 'Unnamed history';
      this.showDeleted = false;
      const saved = store.get('galaxy', null);
      this.workflows = saved && Array.isArray(saved.workflows) ? saved.workflows : [];
      try {
        this._restore();
      } catch (e) {
        console.error(e);
      }
      // (a job's working directory left behind by a page that was closed while it ran)
      for (const p of Array.from(this.fs.entries.keys())) if (/^\/galaxy\/jobs\/000\/[^/]+$/.test(p)) this.fs.remove(p);
      this._build();
      this.showHome();
    }
    save() {
      store.set('galaxy', { workflows: this.workflows });
    }

    /* ================= the history, kept in the browser ================= */
    _snapshot() {
      const cut = (s, n) => (s && s.length > n ? s.slice(0, n / 2) + '\n… (shortened) …\n' + s.slice(-n / 2) : s || '');
      const t = (d) => (d ? +d : null);
      const job = (j) => ({ id: j.id, toolId: j.toolId, toolShedId: j.toolShedId || null, toolName: j.toolName, version: j.version, inputs: j.inputs || [], params: j.params || {}, state: j.state, created: t(j.created), started: t(j.started), finished: t(j.finished), runtime: j.runtime == null ? null : j.runtime, exitCode: j.exitCode == null ? null : j.exitCode, command: j.command || '', stdout: cut(j.stdout, 4000), stderr: cut(j.stderr, 16000), invocation: j.invocation || null, step: j.step || null, outputs: j.outputs || [] });
      return {
        version: 1,
        name: this.historyName,
        hid: this.hid,
        jobN: this.jobN,
        datasets: this.datasets.map((d) => ({ hid: d.hid, name: d.name, ext: d.ext, state: d.state, created: t(d.created), dbkey: d.dbkey, uuid: d.uuid, path: d.path, size: d.size || 0, info: d.info || '', peek: (d.peek || '').slice(0, 1500), deleted: !!d.deleted, missing: !!d.missing, job: d.job ? d.job.id : null, upload: d.upload ? d.upload.id : null, outName: d.outName || null })),
        jobs: this.jobs.map(job),
        uploads: this.uploads.map(job),
        invocations: this.invocations.map((v) => ({ id: v.id, workflow: v.workflow, created: t(v.created), state: v.state, items: v.items.map((x) => ({ tool: x.tool, job: x.job && x.job.id })) }))
      };
    }
    _saveSoon() {
      clearTimeout(this._st);
      this._st = setTimeout(() => {
        try {
          store.set('galaxy:history', this._snapshot());
        } catch (e) {
          console.error(e);
        }
      }, 300);
    }
    _restore() {
      const H = store.get('galaxy:history', null);
      if (!H || !Array.isArray(H.datasets)) return;
      const date = (x) => (x ? new Date(x) : null);
      const job = (j) => Object.assign({}, j, { created: date(j.created) || new Date(), started: date(j.started), finished: date(j.finished) });
      this.historyName = H.name || this.historyName;
      this.hid = +H.hid || 0;
      this.jobN = +H.jobN || 0;
      this.jobs = (H.jobs || []).map(job);
      this.uploads = (H.uploads || []).map(job);
      const J = new Map(this.jobs.concat(this.uploads).map((j) => [j.id, j]));
      // jobs that were waiting or running when the page was closed did not finish
      for (const j of J.values()) {
        if (j.state === 'queued' || j.state === 'running') {
          j.state = 'error';
          j.stderr = (j.stderr ? j.stderr + '\n' : '') + 'The page was closed or reloaded before this job had finished. Run it again (↻).';
        }
      }
      this.datasets = H.datasets.map((d) => Object.assign({}, d, { created: date(d.created) || new Date(), job: d.job ? J.get(d.job) || null : null, upload: d.upload ? J.get(d.upload) || null : null }));
      for (const d of this.datasets) {
        if (d.state === 'queued' || d.state === 'running') d.state = 'error';
        if (d.state === 'ok' && !this.fs.exists(d.path)) {
          d.state = 'error';
          d.missing = true;
        }
      }
      this.invocations = (H.invocations || []).map((v) => Object.assign({}, v, { created: date(v.created) || new Date(), items: (v.items || []).map((x) => ({ tool: x.tool, job: J.get(x.job) || { state: 'error' } })) }));
    }

    /* ================= layout ================= */
    _build() {
      const r = this.root;
      r.classList.add('gx');
      const nav = h('div.gx-nav');
      const navb = (icon, label, fn) => {
        const b = h('button.gx-navb', { type: 'button', html: MG.icon(icon) + '<span>' + esc(label) + '</span>' });
        b.addEventListener('click', fn);
        return b;
      };
      this.navHome = navb('database', 'Analyse data', () => this.showHome());
      this.navWf = navb('workflow', 'Workflows', () => this.showWorkflows());
      this.navInv = navb('history', 'Invocations', () => this.showInvocations());
      nav.append(h('span.gx-brand', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f6c343" stroke-width="2" aria-hidden="true"><path d="M12 3l2.6 5.6L20 9.5l-4 4 1 5.8L12 16.6 7 19.3l1-5.8-4-4 5.4-.9z"/></svg><b>Galaxy</b><small>in your browser</small>' }), this.navHome, this.navWf, this.navInv);
      this.toolSearch = h('input.gx-search', { type: 'search', placeholder: 'search tools', 'aria-label': 'Search tools' });
      this.toolList = h('div.gx-toollist');
      this.toolSearch.addEventListener('input', () => this.renderTools());
      const up = h('button.btn.small.gx-upload', { type: 'button', html: MG.icon('upload') + '<span>Upload Data</span>' });
      up.addEventListener('click', () => this.showUpload());
      this.toolPanel = h('aside.gx-tools', h('div.gx-ph', 'Tools'), h('div.gx-upwrap', up), this.toolSearch, this.toolList);
      this.center = h('main.gx-center');
      this.histHead = h('div.gx-hh');
      this.histList = h('div.gx-hlist');
      this.histPanel = h('aside.gx-history', h('div.gx-ph', 'History'), this.histHead, this.histList);
      this.sideCol = h('aside.gx-sidecol');
      r.append(nav, h('div.gx-body', this.toolPanel, this.center, this.histPanel, this.sideCol));
      this.renderTools();
      this.renderHistory();
    }
    setNav(which) {
      this.navHome.classList.toggle('on', which === 'home');
      this.navWf.classList.toggle('on', which === 'wf');
      this.navInv.classList.toggle('on', which === 'inv');
    }
    _center(view) {
      this.view = view;
      if (view !== 'editor') {
        this.root.classList.remove('gx-editing');
        this.editing = null;
      }
      this.center.innerHTML = '';
      this.center.scrollTop = 0;
      return this.center;
    }
    /** the tab is shown again: the wires of the workflow editor are drawn where the boxes are now */
    shown() {
      if (this.view === 'editor' && this.canvas) requestAnimationFrame(() => this._drawWires(this.canvas.querySelector('svg')));
    }

    /* ================= tools panel ================= */
    renderTools() {
      const q = this.toolSearch.value.trim().toLowerCase();
      const L2 = this.toolList;
      L2.innerHTML = '';
      const sections = [];
      TOOLS.forEach((t) => {
        if (!available(t)) return;
        if (q && !(t.name + ' ' + t.desc + ' ' + t.section).toLowerCase().includes(q)) return;
        let s = sections.find((x) => x.name === t.section);
        if (!s) sections.push((s = { name: t.section, tools: [] }));
        s.tools.push(t);
      });
      sections.forEach((s) => {
        const det = h('details.gx-sec', { open: true });
        det.appendChild(h('summary', s.name));
        s.tools.forEach((t) => {
          const b = h('button.gx-tool', { type: 'button', title: t.desc, dataset: { tool: t.id } }, h('b', t.name), h('span', ' ' + t.desc));
          b.addEventListener('click', () => {
            if (this.view === 'editor' && this.editing) this.editorAddTool(t.id);
            else this.showTool(t.id);
          });
          det.appendChild(b);
        });
        L2.appendChild(det);
      });
      if (!sections.length) L2.appendChild(h('p.muted.small', 'No tools match.'));
    }

    /* ================= history ================= */
    addDataset(d) {
      const hid = ++this.hid;
      const ds = Object.assign({ hid, state: 'ok', created: new Date(), dbkey: '?', uuid: uuid() }, d);
      ds.path = `${GX_ROOT}/database/files/000/dataset_${ds.uuid}.dat`;
      this.datasets.push(ds);
      this.renderHistory();
      return ds;
    }
    ds(hid) {
      return this.datasets.find((d) => d.hid === hid);
    }
    renderHistory() {
      const vis = this.datasets.filter((d) => !d.deleted || this.showDeleted);
      const live = this.datasets.filter((d) => !d.deleted);
      const nDel = this.datasets.length - live.length;
      const size = live.reduce((s, d) => s + (d.size || 0), 0);
      this.histHead.innerHTML = '';
      const name = h('button.gx-hname', { type: 'button', title: 'Click to rename the history' }, this.historyName);
      name.addEventListener('click', async () => {
        const n = await MG.promptText('Rename the history', 'A name that says what the analysis is.', this.historyName, 'Rename');
        if (n && n.trim()) {
          this.historyName = n.trim();
          this.renderHistory();
        }
      });
      const extract = h('button.btn.small', { type: 'button', title: 'Turn the jobs in this history into a workflow', html: MG.icon('workflow') + '<span>Extract workflow</span>' });
      extract.addEventListener('click', () => this.extractWorkflow());
      const more = h('button.btn.small', { type: 'button', title: 'History options: export as a notebook, deleted datasets, a new history', 'aria-label': 'History options', html: MG.icon('dots') });
      more.addEventListener('click', () =>
        MG.popmenu(more, [
          ['notebook', 'Open the history as a notebook', () => this.historyToNotebook(true)],
          ['download', 'Download the history as a notebook (.ipynb)', () => this.historyToNotebook(false)],
          ['eye', this.showDeleted ? 'Hide deleted datasets' : `Show deleted datasets (${nDel})`, () => {
            this.showDeleted = !this.showDeleted;
            this.renderHistory();
          }],
          ['trash', 'Purge deleted datasets (frees space)', () => this.purgeDeleted()],
          ['plus', 'Start a new history…', () => this.newHistory()]
        ])
      );
      this.histHead.append(name, h('div.gx-hmeta', `${live.length} dataset${live.length === 1 ? '' : 's'} · ${MG.humanSize(size)}B${nDel ? ` · ${nDel} deleted` : ''}`), h('div.gx-hacts', extract, more));
      const L2 = this.histList;
      const openSet = new Set(Array.from(L2.querySelectorAll('.gx-ds.open')).map((e) => +e.dataset.hid));
      L2.innerHTML = '';
      vis.slice().reverse().forEach((d) => {
        const row = h('div.gx-ds.' + d.state + (d.deleted ? '.deleted' : ''), { dataset: { hid: d.hid } });
        const title = h('div.gx-ds-t', { role: 'button', tabindex: '0' }, h('span.gx-hid', d.hid + ':'), h('span.gx-dname', d.name));
        const icons = h('span.gx-ds-ic');
        const mk = (ic, tip, fn) => {
          const b = h('button.gx-ib', { type: 'button', title: tip, 'aria-label': tip, html: MG.icon(ic) });
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            fn();
          });
          return b;
        };
        if (d.state === 'ok' && !d.deleted) icons.append(mk('eye', 'View data', () => this.showDataset(d.hid)));
        if (!d.deleted) icons.append(mk('x', 'Delete', () => this.deleteDataset(d.hid)));
        row.append(h('div.gx-ds-top', title, icons));
        const body = h('div.gx-ds-body');
        if (d.deleted) {
          const un = h('button.gx-link', { type: 'button' }, 'Undelete');
          un.addEventListener('click', () => {
            d.deleted = false;
            this.renderHistory();
          });
          const pu = h('button.gx-link', { type: 'button' }, 'Purge');
          pu.addEventListener('click', () => this.purge([d]));
          body.appendChild(h('div.gx-stateline', 'This dataset has been deleted. ', un, pu));
        }
        if (d.state === 'queued') body.appendChild(h('div.gx-stateline', 'This job is waiting to run'));
        else if (d.state === 'running') body.appendChild(h('div.gx-stateline', { html: '<span class="spinner small"></span> This job is currently running' }));
        else if (d.state === 'error') body.appendChild(h('div.gx-stateline.err', d.missing ? 'The file of this dataset is no longer stored in this browser.' : 'An error occurred with this dataset – click the ⓘ to see the error message'));
        if (d.state === 'ok' || d.state === 'error') {
          if (d.info) body.appendChild(h('div.gx-blurb', d.info));
          body.appendChild(h('div.gx-fmt', { html: `format <b>${esc(d.ext)}</b>, database <b>${esc(d.dbkey)}</b>` }));
          if (d.peek) body.appendChild(h('pre.gx-peek', d.peek));
          const acts = h('div.gx-acts');
          if (d.state === 'ok') acts.append(mk('download', 'Download', () => this.download(d.hid)));
          acts.append(mk('info', 'Dataset details (how was this made?)', () => this.showDetails(d.hid)));
          if (d.job && TOOL.get(d.job.toolId)) acts.append(mk('rerun', 'Run this job again', () => this.showTool(d.job.toolId, d.job)));
          if (d.state === 'ok' && GENOMIC.includes(d.ext)) acts.append(mk('genome', 'Show in the Genome browser', () => this.toGenomeBrowser(d.hid)));
          if (d.state === 'ok' && d.ext === 'pdb') acts.append(mk('cube', 'Open in the 3D viewer', () => this.toViewer(d.hid)));
          if (d.state === 'ok' && NETWORKS.includes(d.ext)) acts.append(mk('network', 'Open in Networks', () => this.toNetworks(d.hid)));
          if (d.state === 'ok') {
            const cp = h('button.gx-link', { type: 'button', title: 'Copy this dataset into your home folder (~/galaxy), to use it in the Terminal or a notebook' }, 'copy to my files');
            cp.addEventListener('click', (e) => {
              e.stopPropagation();
              this.copyToFiles(d.hid);
            });
            acts.appendChild(cp);
          }
          body.appendChild(acts);
        }
        row.appendChild(body);
        if (openSet.has(d.hid) || (d.state !== 'ok' && !d.deleted)) row.classList.add('open');
        const toggle = () => row.classList.toggle('open');
        title.addEventListener('click', toggle);
        title.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle()));
        L2.appendChild(row);
      });
      if (!vis.length) L2.appendChild(h('div.gx-empty', h('p', 'This history is empty.'), h('p.muted.small', { html: 'Use <b>Upload Data</b> (top left) to bring in files – from your folders, your computer, or pasted text.' })));
      this._saveSoon();
    }
    deleteDataset(hid) {
      const d = this.ds(hid);
      if (!d) return;
      d.deleted = true;
      this.renderHistory();
      toast(`Deleted <b>${d.hid}: ${esc(d.name)}</b>. (⋯ in the history: show deleted datasets, to undelete it.)`, null, 4000);
    }
    purge(list) {
      for (const d of list) {
        if (this.fs.exists(d.path)) this.fs.remove(d.path);
        if (this.fs.exists(d.path + '.bai')) this.fs.remove(d.path + '.bai');
      }
      const gone = new Set(list);
      this.datasets = this.datasets.filter((d) => !gone.has(d));
      this.renderHistory();
    }
    purgeDeleted() {
      const del = this.datasets.filter((d) => d.deleted);
      if (!del.length) return toast('There are no deleted datasets.', 'warn');
      this.purge(del);
      toast(`Purged ${del.length} dataset${del.length === 1 ? '' : 's'}: their files are gone.`, 'ok');
    }
    newHistory() {
      const m = MG.modal('Start a new history?', `<p>The datasets of <b>${esc(this.historyName)}</b> (${this.datasets.length}) are removed, with their files. Your workflows stay. To keep a record of this history first: ⋯ → Download the history as a notebook.</p><div class="prompt-actions"><button class="btn" data-x="no" type="button">Cancel</button><button class="btn danger" data-x="yes" type="button">Start a new history</button></div>`);
      m.box.querySelector('[data-x="no"]').addEventListener('click', () => m.close());
      m.box.querySelector('[data-x="yes"]').addEventListener('click', () => {
        m.close();
        this.purge(this.datasets.slice());
        this.jobs = [];
        this.uploads = [];
        this.invocations = [];
        this.hid = 0;
        this.historyName = 'Unnamed history';
        this.renderHistory();
        this.showHome();
      });
    }
    fileName(d) {
      return `Galaxy${d.hid}-[${d.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}].${DOWNLOAD_EXT[d.ext] || d.ext}`;
    }
    async download(hid) {
      const d = this.ds(hid);
      try {
        MG.downloadBlob(await this.fs.toBlob(d.path), this.fileName(d));
        bus.emit('gx:download', { hid, ext: d.ext });
      } catch (e) {
        toast('Could not download: ' + esc(e.message), 'error');
      }
    }
    /** a copy of a dataset in ~/galaxy (with its index); → the path */
    copyToFiles(hid, quietly) {
      const d = this.ds(hid);
      const dir = HOME() + '/galaxy';
      this.fs.mkdirp(dir);
      const target = dir + '/' + this.fileName(d);
      this.fs.copy(d.path, target);
      if (d.ext === 'bam' && this.fs.exists(d.path + '.bai')) this.fs.copy(d.path + '.bai', target + '.bai');
      if (!quietly) toast(`Copied to <b>${esc(this.fs.pretty(target))}</b> – use it in the Terminal or a notebook.`, null, 5000);
      bus.emit('gx:copy', { hid, ext: d.ext, path: target, tool: d.job ? d.job.toolId : null });
      return target;
    }
    async toGenomeBrowser(hid) {
      const d = this.ds(hid);
      if (d.ext === 'bam' && !this.fs.exists(d.path + '.bai')) return toast('This BAM file has no index (it is not sorted by position?): sort it first.', 'warn');
      const p = this.copyToFiles(hid, true);
      toast(`Copied to <b>${esc(this.fs.pretty(p))}</b> and shown in the Genome browser.`, null, 4000);
      await MG.app.igvLoad([p]);
    }
    async toViewer(hid) {
      const p = this.copyToFiles(hid, true);
      await MG.app.viewStructure(p);
    }
    async toNetworks(hid) {
      const p = this.copyToFiles(hid, true);
      toast(`Copied to <b>${esc(this.fs.pretty(p))}</b> and opened in the Networks tab.`, null, 4000);
      await MG.app.netOpen([p]);
    }

    /* ================= upload ================= */
    showUpload(which) {
      const C = this._center('upload');
      this.setNav('home');
      C.appendChild(h('h3', { html: MG.icon('upload') + ' Upload Data' }));
      C.appendChild(h('p.muted', 'Bring files into your history: from your folders in the workbench, from your computer, or as pasted text. Compressed text files (.fastq.gz, .fa.gz …) are uncompressed on the way in.'));
      const tabs = h('div.gx-uptabs', { role: 'tablist' });
      const panes = {};
      const body = h('div.gx-uppane');
      const show = (k) => {
        Object.entries(panes).forEach(([n, p]) => (p.hidden = n !== k));
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      };
      [['files', 'From your files'], ['computer', 'From your computer'], ['paste', 'Paste text']].forEach(([k, label]) => {
        const b = h('button.gx-uptab', { type: 'button', role: 'tab', dataset: { k } }, label);
        b.addEventListener('click', () => show(k));
        tabs.appendChild(b);
      });
      const fmtSelect = (value) => {
        const sel = h('select', { 'aria-label': 'Format' });
        sel.appendChild(h('option', { value: 'auto' }, 'auto-detect'));
        FORMATS.forEach(([v]) => sel.appendChild(h('option', { value: v }, v)));
        sel.value = value || 'auto';
        return sel;
      };
      /* ---- your files ---- */
      {
        const P = (panes.files = h('div'));
        const filter = h('input.gx-search', { type: 'search', placeholder: 'filter, e.g. fastq or examples/reads', 'aria-label': 'Filter the files' });
        const list = h('div.gx-uplist');
        const files = [];
        for (const [p, e] of this.fs.entries) {
          if (e.kind === 'dir' || e.hidden) continue;
          const mine = p.startsWith(HOME() + '/') && !/\/\./.test(p.slice(HOME().length));
          const ex = p.startsWith('/data/examples/') && !/README\.md$/.test(p);
          if (!mine && !ex) continue;
          if (/\.(fai|bai|tbi|csi|ipynb|crai)$/.test(p) || /\/ai-agent\/run-\d+\/agent-record/.test(p)) continue;
          files.push(p);
        }
        files.sort((a, b) => (a.startsWith('/data/') === b.startsWith('/data/') ? a.localeCompare(b) : a.startsWith('/data/') ? 1 : -1));
        const rows = files.map((p) => {
          const cb = h('input', { type: 'checkbox', value: p });
          const sel = fmtSelect('auto');
          const row = h('label.gx-uprow', cb, h('code', this.fs.pretty(p)), h('small.muted', MG.humanSize(this.fs.size(this.fs.get(p))) + 'B'), sel);
          row.dataset.path = p.toLowerCase();
          list.appendChild(row);
          return row;
        });
        if (!rows.length) list.appendChild(h('p.muted', 'No files yet.'));
        filter.addEventListener('input', () => {
          const q = filter.value.trim().toLowerCase();
          rows.forEach((r) => (r.hidden = !!q && !r.dataset.path.includes(q)));
        });
        const go = h('button.btn.primary', { type: 'button', html: MG.icon('upload') + '<span>Start</span>' });
        go.addEventListener('click', () => {
          const chosen = rows.filter((r) => !r.hidden && r.querySelector('input').checked);
          if (!chosen.length) return toast('Tick at least one file.', 'warn');
          chosen.forEach((r) => {
            const f = r.querySelector('select').value;
            this.upload(r.querySelector('input').value, f === 'auto' ? null : f);
          });
          this.showHome();
        });
        P.append(filter, list, h('div.gx-runrow', go));
      }
      /* ---- your computer ---- */
      {
        const P = (panes.computer = h('div'));
        const inp = h('input', { type: 'file', multiple: true });
        const drop = h('div.gx-drop', h('p', { html: MG.icon('upload') + ' Drop files here, or ' }), inp);
        const list = h('div.gx-uplist');
        let picked = [];
        const showPicked = () => {
          list.innerHTML = '';
          picked.forEach((x) => list.appendChild(h('div.gx-uprow', h('code', x.file.name), h('small.muted', MG.humanSize(x.file.size) + 'B'), x.sel)));
        };
        const add = (fl) => {
          picked = picked.concat(Array.from(fl || []).map((file) => ({ file, sel: fmtSelect('auto') })));
          showPicked();
        };
        inp.addEventListener('change', () => add(inp.files));
        drop.addEventListener('dragover', (e) => {
          e.preventDefault();
          drop.classList.add('over');
        });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => {
          e.preventDefault();
          drop.classList.remove('over');
          add(e.dataTransfer.files);
        });
        const go = h('button.btn.primary', { type: 'button', html: MG.icon('upload') + '<span>Start</span>' });
        go.addEventListener('click', () => {
          if (!picked.length) return toast('Choose at least one file.', 'warn');
          picked.forEach((x) => this.uploadFile(x.file, x.sel.value === 'auto' ? null : x.sel.value));
          this.showHome();
        });
        P.append(drop, list, h('p.muted.small', 'The files are copied into this browser (your history) – nothing is sent to a server. Never upload personal or patient data to a tool you have not been told you may use for it.'), h('div.gx-runrow', go));
      }
      /* ---- paste ---- */
      {
        const P = (panes.paste = h('div.gx-form'));
        const name = h('input', { type: 'text', value: 'Pasted entry', 'aria-label': 'Name' });
        const sel = fmtSelect('auto');
        const ta = h('textarea.gx-paste', { rows: 10, spellcheck: 'false', placeholder: '>seq1\nACGTACGT…' });
        const go = h('button.btn.primary', { type: 'button', html: MG.icon('upload') + '<span>Start</span>' });
        go.addEventListener('click', () => {
          if (!ta.value.trim()) return toast('Paste something first.', 'warn');
          this.uploadText(name.value.trim() || 'Pasted entry', ta.value.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n'), sel.value === 'auto' ? null : sel.value);
          this.showHome();
        });
        P.append(field('Name', name), field('Format', sel), field('Text', ta), h('div.gx-runrow', go));
      }
      Object.values(panes).forEach((p) => body.appendChild(p));
      C.append(tabs, body);
      show(which || 'files');
      bus.emit('gx:uploadform', {});
    }
    /** files of the workbench → the history (used by the Files tab: "Upload to Galaxy") */
    async uploadPaths(paths) {
      const ok = paths.filter((p) => this.fs.exists(p) && !this.fs.isDir(p));
      ok.forEach((p) => this.upload(p, null));
      if (ok.length) toast(`Uploading ${ok.length} file${ok.length === 1 ? '' : 's'} to your Galaxy history.`, null, 3000);
      this.showHome();
    }
    /** queue an upload job: make() puts the bytes at the dataset's path */
    _uploadJob(name, ext, params, make) {
      const d = this.addDataset({ name, ext: ext || 'txt', state: 'queued' });
      const job = { id: ++this.jobN, toolId: 'upload1', toolName: 'Upload File', version: '1.1.7', inputs: [], params, state: 'queued', created: new Date(), outputs: [d.hid] };
      d.upload = job;
      this.uploads.push(job);
      this.queue = this.queue.then(async () => {
        await sleep(250);
        d.state = job.state = 'running';
        this.renderHistory();
        try {
          const sniffed = await make(d);
          if (!ext) d.ext = sniffed || 'txt';
          job.params.file_type = d.ext;
          d.size = this.fs.size(this.fs.get(d.path));
          if (d.ext === 'bam') {
            const r = await this.shell.exec(`samtools index '${d.path}'`, quiet(), { errexit: true });
            if (r !== 0) d.note = 'not indexed: it is not sorted by position (sort it with Samtools sort first)';
          }
          await this._describe(d);
          d.state = job.state = 'ok';
        } catch (e) {
          console.error(e);
          d.state = job.state = 'error';
          job.stderr = String((e && e.message) || e);
        }
        this.renderHistory();
        bus.emit('gx:upload', { hid: d.hid, name, ext: d.ext });
      });
      return d;
    }
    upload(path, ext) {
      const gz = GUNZIP.test(path);
      const name = MG.path.basename(path).replace(gz ? /\.gz$/i : /$^/, '');
      return this._uploadJob(name, ext || (gz ? sniff(name) : null), { file: path, from: this.fs.pretty(path), gunzip: gz }, async (d) => {
        if (gz) {
          const code = await this.shell.exec(`gzip -dc ${shq(path)} > ${shq(d.path)}`, quiet(), { errexit: true });
          if (code !== 0) throw new Error('could not uncompress ' + path);
        } else this.fs.copy(path, d.path);
        return sniff(name, await this._head(d.path));
      });
    }
    uploadFile(file, ext) {
      const gz = GUNZIP.test(file.name);
      const name = file.name.replace(gz ? /\.gz$/i : /$^/, '');
      return this._uploadJob(name, ext || (gz ? sniff(name) : null), { file: null, from: 'your computer: ' + file.name, gunzip: gz }, async (d) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (gz) {
          const tmp = `${GX_ROOT}/upload-${d.uuid}.gz`;
          this.fs.put(tmp, { kind: 'blob', blob: new Blob([bytes]), size: bytes.length });
          try {
            const code = await this.shell.exec(`gzip -dc ${shq(tmp)} > ${shq(d.path)}`, quiet(), { errexit: true });
            if (code !== 0) throw new Error('could not uncompress ' + file.name);
          } finally {
            this.fs.remove(tmp);
          }
        } else {
          const text = MG.looksText(name, bytes);
          this.fs.put(d.path, text != null ? { kind: 'text', text } : { kind: 'blob', blob: new Blob([bytes]), size: bytes.length });
        }
        return sniff(name, await this._head(d.path));
      });
    }
    uploadText(name, text, ext) {
      return this._uploadJob(name, ext, { file: null, from: 'pasted text', text: text.length <= 20000 ? text : null }, async (d) => {
        this.fs.writeText(d.path, text);
        return sniff(name, text.slice(0, 2000));
      });
    }
    async _head(path) {
      try {
        const e = this.fs.get(path);
        if (e && e.kind === 'text') return e.text.slice(0, 2000);
        const b = await this.fs.readBytes(path);
        return new TextDecoder().decode(b.slice(0, 2000));
      } catch (e) {
        return '';
      }
    }

    /* ================= home ================= */
    showHome() {
      const C = this._center('home');
      this.setNav('home');
      C.append(
        h('h3', 'Welcome to Galaxy'),
        h('p', { html: 'This Galaxy works like <b>usegalaxy.org</b> and its sister servers: <b>tools</b> on the left, your <b>history</b> of datasets on the right, forms and results in the middle. Its jobs run the same programs as the Terminal – fastp, minimap2, Bowtie 2, samtools, bcftools, bedtools, seqtk and more – compiled to WebAssembly, in this browser.' }),
        h('div.gx-cards',
          card('upload', 'Get data', 'Upload Data (top left) brings in files from your folders, from your computer, or pasted text.'),
          card('wrench', 'Run tools', 'Click a tool, choose its inputs from the history and press Run tool. New datasets appear at the top of the history: grey = queued, yellow = running, green = done.'),
          card('workflow', 'Workflows', 'Build an analysis as a graph of tools – or extract it from your history – and run it again on new data with one click.'),
          card('notebook', 'Keep a record', 'The ⓘ of each dataset shows how it was made. ⋯ in the history turns the whole history into a notebook that repeats every step.')
        ),
        h('p.muted.small', 'Your history is kept in this browser, with its files; download what you want to keep elsewhere. Help for Galaxy: the Help pane, “Galaxy”.')
      );
    }

    /* ================= tool form ================= */
    showTool(id, rerunJob) {
      const t = TOOL.get(id);
      if (!t) return;
      const C = this._center('tool');
      this.setNav('home');
      C.appendChild(h('div.gx-toolh', h('h3', t.name), h('span.muted', `${t.desc} (Galaxy Version ${t.version})`)));
      if (!available(t)) C.appendChild(h('p.warnline', `The program of this tool (${t.needs}) is not available in this browser.`));
      const form = h('form.gx-form');
      const values = {};
      const prev = rerunJob || null;
      t.inputs.forEach((inp) => {
        const sel = h('select', { name: inp.name });
        const cand = this.datasets.filter((d) => !d.deleted && d.state === 'ok' && inp.ext.includes(d.ext));
        if (inp.optional) sel.appendChild(h('option', { value: '' }, '(nothing selected)'));
        cand.slice().reverse().forEach((d) => sel.appendChild(h('option', { value: String(d.hid) }, `${d.hid}: ${d.name}`)));
        if (!cand.length && !inp.optional) sel.appendChild(h('option', { value: '' }, `No ${inp.ext.join(' / ')} dataset in the history`));
        if (prev && prev.inputs) {
          const p = prev.inputs.find((x) => x.name === inp.name);
          sel.value = p ? String(p.hid) : '';
        } else if (inp.pick) {
          const pick = cand.slice().reverse().find((d) => inp.pick.test(d.name));
          if (pick) sel.value = String(pick.hid);
          else if (inp.optional) sel.value = '';
        }
        values[inp.name] = sel;
        form.appendChild(field(inp.label + (inp.optional ? ' (optional)' : ''), sel, inp.ext.join(', ')));
      });
      t.params.forEach((p) => {
        const cur = prev && prev.params && p.name in prev.params ? prev.params[p.name] : p.default;
        const ctl = control(p, cur);
        values[p.name] = ctl;
        form.appendChild(field(p.label, ctl, null, p.help));
      });
      const run = h('button.btn.primary', { type: 'submit', html: MG.icon('play') + '<span>Run tool</span>' });
      form.appendChild(h('div.gx-runrow', run));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputs = t.inputs.map((inp) => ({ name: inp.name, hid: +values[inp.name].value || 0, optional: !!inp.optional })).filter((x) => x.hid || !x.optional);
        if (inputs.some((x) => !x.hid)) return toast('Choose an input dataset for every input first.', 'warn');
        const params = {};
        t.params.forEach((p) => (params[p.name] = readControl(p, values[p.name])));
        this.submit(t.id, inputs.map((x) => ({ name: x.name, hid: x.hid })), params);
        C.innerHTML = '';
        C.appendChild(h('div.gx-queued', h('h3', { html: MG.icon('check') + ' Job submitted' }), h('p', `${t.name} has been added to the queue. Its output appears at the top of your history.`)));
      });
      C.appendChild(form);
      if (t.help) C.appendChild(h('div.gx-help', h('h4', 'What it does'), h('div', { html: t.help })));
      const refs = (t.cite || []).map((k) => (window.WB_CITATIONS || {})[k]).filter(Boolean);
      if (refs.length) C.appendChild(h('div.gx-cite', h('h4', 'References'), h('ul', ...refs.map((r) => h('li', { html: r })))));
      bus.emit('gx:toolform', { tool: id });
    }

    /* ================= jobs ================= */
    submit(toolId, inputs, params, opts = {}) {
      const t = TOOL.get(toolId);
      const inDs = inputs.map((x) => ({ name: x.name, hid: x.hid, ds: this.ds(x.hid) }));
      const job = { id: ++this.jobN, toolId, toolShedId: t.toolId, toolName: t.name, version: t.version, inputs: inputs.map((x) => ({ name: x.name, hid: x.hid })), params, state: 'queued', created: new Date(), invocation: opts.invocation || null, step: opts.step || null };
      const given = {};
      inputs.forEach((x) => (given[x.name] = true));
      const db = (inDs.find((x) => x.ds && x.ds.dbkey && x.ds.dbkey !== '?') || {}).ds;
      const outs = t.outputs.filter((o) => !o.when || o.when(given, params)).map((o) => this.addDataset({ name: o.label(inDs, params), ext: runExt(o, params, inDs), state: 'queued', job, outName: o.name, dbkey: db ? db.dbkey : '?' }));
      job.outputs = outs.map((d) => d.hid);
      this.jobs.push(job);
      const done = (this.queue = this.queue.then(() => this._runJob(job, t, inDs, outs)));
      bus.emit('gx:submitted', { tool: toolId, job: job.id, invocation: job.invocation });
      return { job, outs, done };
    }
    async _runJob(job, t, inDs, outs) {
      if (inDs.some((x) => !x.ds || x.ds.state !== 'ok' || x.ds.deleted)) {
        await Promise.resolve();
        outs.forEach((d) => (d.state = 'error'));
        job.state = 'error';
        job.stderr = 'An input dataset is not ready (it is in the error state, was deleted, or was not made by an earlier step), so this job was not run.';
        this.renderHistory();
        bus.emit('gx:job', { tool: t.id, state: 'error', job: job.id, invocation: job.invocation });
        return;
      }
      await sleep(300);
      outs.forEach((d) => (d.state = 'running'));
      job.state = 'running';
      job.started = new Date();
      this.renderHistory();
      const jobDir = `${GX_ROOT}/jobs/000/${job.id}`;
      const wd = `${jobDir}/working`;
      this.fs.mkdirp(wd);
      const links = [];
      const paths = {};
      inDs.forEach((x) => {
        const inp = t.inputs.find((i) => i.name === x.name);
        const nice = typeof inp.nice === 'function' ? inp.nice(x.ds) : inp.nice || x.name;
        this.fs.copy(x.ds.path, wd + '/' + nice);
        links.push(`ln -f -s '${x.ds.path}' '${nice}'`);
        if (x.ds.ext === 'bam' && this.fs.exists(x.ds.path + '.bai')) {
          this.fs.copy(x.ds.path + '.bai', wd + '/' + nice + '.bai');
          links.push(`ln -f -s '${x.ds.path}.bai' '${nice}.bai'`);
        }
        paths[x.name] = nice;
      });
      const cmd = t.command(paths, job.params);
      job.command = links.join(' && ') + (links.length ? ' && ' : '') + cmd;
      let stdout = '', stderr = '';
      const io = Object.assign(quiet(), { out: (x) => (stdout += typeof x === 'string' ? x : new TextDecoder().decode(x)), err: (x) => (stderr += x), colored: (x) => (stderr += x) });
      const t0 = performance.now();
      let code = 0;
      this.gfs.cwd = wd;
      try {
        code = await this.shell.exec(cmd, io, { errexit: true, pipefail: true });
      } catch (e) {
        stderr += String(e && e.message ? e.message : e);
        code = 1;
      }
      const el = performance.now() - t0;
      if (el < 600) await sleep(600 - el);
      job.stdout = stdout;
      job.stderr = stderr.replace(/\/shared\/vfs/g, '');
      job.exitCode = code;
      job.finished = new Date();
      job.runtime = (performance.now() - t0) / 1000;
      const files = outs.map((d) => t.outputs.find((x) => x.name === d.outName).file);
      const ok = code === 0 && files.every((f) => this.fs.exists(wd + '/' + f));
      if (!ok) {
        // (what a tool wrote into a log of its own – Bowtie 2's summary – belongs to the error message)
        for (const f of files) {
          const e = this.fs.get(wd + '/' + f);
          if (e && e.kind === 'text' && e.text.trim() && e.text.length < 20000) job.stderr += `\n--- ${f} ---\n${e.text}`;
        }
        if (code === 0) job.stderr += `\nThe tool ended without an error, but did not write ${files.filter((f) => !this.fs.exists(wd + '/' + f)).join(', ')}.`;
        job.state = 'error';
        outs.forEach((d) => (d.state = 'error'));
        this.fs.remove(jobDir);
        this.renderHistory();
        bus.emit('gx:job', { tool: t.id, state: 'error', job: job.id, invocation: job.invocation });
        return;
      }
      for (const d of outs) {
        const o = t.outputs.find((x) => x.name === d.outName);
        this.fs.rename(wd + '/' + o.file, d.path);
        d.size = this.fs.size(this.fs.get(d.path));
        if (d.ext === 'bam') {
          // Galaxy indexes BAM datasets itself (the index is kept as metadata of the dataset)
          const r = await this.shell.exec(`samtools index '${d.path}'`, Object.assign(quiet(), { err: (x) => (job.stderr += x) }), { errexit: true });
          if (r !== 0) d.note = 'not indexed: it is not sorted by position';
        }
        try {
          await this._describe(d);
        } catch (err) {
          console.error(err);
        }
        d.state = 'ok';
      }
      this.fs.remove(jobDir);
      job.state = 'ok';
      this.renderHistory();
      bus.emit('gx:job', { tool: t.id, state: 'ok', job: job.id, invocation: job.invocation });
    }
    /** the short summary and peek Galaxy shows under a dataset */
    async _describe(d) {
      const text = async (cmd) => {
        let o = '';
        await this.shell.exec(cmd, Object.assign(quiet(), { out: (x) => (o += typeof x === 'string' ? x : new TextDecoder().decode(x)) }), {});
        return o;
      };
      const lines = (t, n = 4, w = 90) => t.split('\n').filter((l) => l !== '').slice(0, n).map((l) => (l.length > w ? l.slice(0, w) + '…' : l)).join('\n');
      const read = async () => (await this.fs.readText(d.path)) || '';
      try {
        if (d.ext === 'fastqsanger') {
          const t = await read();
          const n = Math.floor(t.split('\n').filter(Boolean).length / 4);
          d.info = `${MG.fmt(n)} sequences`;
          d.peek = t.split('\n').slice(0, 4).join('\n');
        } else if (d.ext === 'fasta') {
          const t = await read();
          const seqs = (t.match(/^>/gm) || []).length;
          d.info = `${MG.fmt(seqs)} sequence${seqs === 1 ? '' : 's'}`;
          d.peek = lines(t, 3, 60);
        } else if (d.ext === 'bam') {
          d.info = d.note ? `Alignments (${d.note})` : 'Alignments sorted by coordinate (indexed)';
          d.peek = (await text(`samtools view '${d.path}' | head -n 2 | cut -f 1-6`)).trim();
        } else if (d.ext === 'sam') {
          const t = await read();
          const n = t.split('\n').filter((l) => l && !l.startsWith('@')).length;
          d.info = `${MG.fmt(n)} alignments`;
          d.peek = lines(t.split('\n').filter((l) => l && !l.startsWith('@')).map((l) => l.split('\t').slice(0, 6).join('\t')).join('\n'));
        } else if (d.ext === 'bcf') {
          d.info = 'Variants or genotype likelihoods (binary BCF)';
        } else if (d.ext === 'bus') {
          // (the records as bustools text writes them: barcode, UMI, equivalence class, count)
          const n = +(await text(`bustools text -p '${d.path}' | wc -l`)).trim();
          d.info = `${MG.fmt(n)} BUS record${n === 1 ? '' : 's'} (binary)`;
          d.peek = (await text(`bustools text -p '${d.path}' | head -n 3`)).trim();
        } else if (d.ext === 'mtx') {
          const t = await read();
          const size = t.split('\n').find((l) => l.trim() && !l.startsWith('%'));
          const [rows, cols, n] = (size || '').trim().split(/\s+/).map(Number);
          d.info = size && Number.isFinite(n) ? `a sparse matrix of ${MG.fmt(rows)} rows × ${MG.fmt(cols)} columns, ${MG.fmt(n)} entries that are not zero` : 'a matrix (Matrix Market)';
          d.peek = lines(t, 5);
        } else if (d.ext === 'vcf_bgzip' || d.ext === 'vcf') {
          const n = (await text(`bcftools view -H '${d.path}' | wc -l`)).trim();
          d.info = `${n} variant sites`;
          d.peek = (await text(`bcftools view -H '${d.path}' | head -n 3 | cut -f 1-6`)).trim();
        } else if (d.ext === 'html') {
          d.info = 'HTML file (👁 shows it)';
        } else if (d.ext === 'json') {
          const t = await read();
          d.info = `JSON, ${MG.humanSize(t.length)}B`;
          d.peek = lines(t, 4);
        } else if (d.ext === 'newick') {
          const t = await read();
          d.info = `a tree of ${(t.match(/[(,]\s*[^(),:;\s]+/g) || []).length} leaves (👁 draws it)`;
          d.peek = t.slice(0, 200) + (t.length > 200 ? '…' : '');
        } else if (d.ext === 'pdb') {
          const t = await read();
          d.info = `${(t.match(/^ATOM  /gm) || []).length} atoms`;
          d.peek = lines(t, 2);
        } else if (d.ext === 'hmm3') {
          const t = await read();
          const names = (t.match(/^NAME  +\S+/gm) || []).map((l) => l.split(/\s+/)[1]);
          const lengths = (t.match(/^LENG  +\d+/gm) || []).map((l) => l.split(/\s+/)[1]);
          d.info = `${names.length} profile HMM${names.length === 1 ? '' : 's'}` + (names.length ? ': ' + names.slice(0, 4).map((n, k) => `${n} (${lengths[k] || '?'} match states)`).join(', ') + (names.length > 4 ? ', …' : '') : '');
          d.peek = lines(t.split('\n').filter((l) => /^(HMMER3|NAME|ACC|DESC|LENG|ALPH|NSEQ) /.test(l)).slice(0, 6).join('\n'), 6);
        } else if (d.ext === 'stockholm') {
          const t = await read();
          const seqs = new Set(t.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('//')).map((l) => l.split(/\s+/)[0]));
          d.info = `an alignment of ${MG.fmt(seqs.size)} sequence${seqs.size === 1 ? '' : 's'}`;
          d.peek = lines(t.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('//')).join('\n'), 3, 80);
        } else if (d.ext === 'genbank') {
          const t = await read();
          const cds = (t.match(/^ {5}CDS {13}/gm) || []).length;
          const records = (t.match(/^\/\/\s*$/gm) || []).length;
          d.info = `${MG.fmt(records)} record${records === 1 ? '' : 's'}, ${MG.fmt(cds)} CDS`;
          d.peek = lines(t, 4);
        } else {
          const t = await read();
          const L2 = t.split('\n').filter(Boolean);
          const comments = L2.filter((l) => l.startsWith('#')).length;
          d.info = `${MG.fmt(L2.length - comments)} lines${comments ? `, ${comments} comment line${comments === 1 ? '' : 's'}` : ''}`;
          d.peek = lines(L2.filter((l) => !l.startsWith('##')).join('\n'));
        }
      } catch (e) {
        /* the summary is optional */
      }
    }

    /* ================= dataset views ================= */
    async showDataset(hid) {
      const d = this.ds(hid);
      if (!d) return;
      const C = this._center('dataset');
      C.appendChild(h('div.gx-toolh', h('h3', `${d.hid}: ${d.name}`), h('span.muted', `${d.ext} · ${MG.humanSize(d.size || 0)}B`)));
      bus.emit('gx:view', { hid, ext: d.ext });
      const acts = h('div.gx-runrow');
      const btn = (icon, label, fn) => {
        const b = h('button.btn.small', { type: 'button', html: MG.icon(icon) + '<span>' + esc(label) + '</span>' });
        b.addEventListener('click', fn);
        acts.appendChild(b);
      };
      btn('download', 'Download', () => this.download(hid));
      btn('folder', 'Copy to my files', () => this.copyToFiles(hid));
      if (GENOMIC.includes(d.ext)) btn('genome', 'Show in the Genome browser', () => this.toGenomeBrowser(hid));
      if (d.ext === 'pdb') btn('cube', 'Open in the 3D viewer', () => this.toViewer(hid));
      if (NETWORKS.includes(d.ext)) btn('network', 'Open in Networks', () => this.toNetworks(hid));
      C.appendChild(acts);
      if (d.ext === 'bam' || d.ext === 'bcf' || d.ext === 'bus') {
        C.appendChild(h('p', `This is a binary ${d.ext.toUpperCase()} file, so Galaxy cannot show it as text. Its first records${d.ext === 'bus' ? ' (as bustools text writes them: barcode, UMI, equivalence class, count)' : ''}:`));
        C.appendChild(h('pre.gx-pre', d.peek || '(binary)'));
        return;
      }
      let text = '';
      try {
        if (d.ext === 'vcf_bgzip') await this.shell.exec(`bcftools view '${d.path}'`, Object.assign(quiet(), { out: (x) => (text += x) }), {});
        else text = await this.fs.readText(d.path);
      } catch (e) {
        text = '(could not read the dataset)';
      }
      if (d.ext === 'html') {
        // (no scripts: an HTML file could come from anywhere – reports such as fastp's work without them)
        const fr = h('iframe.gx-frame', { sandbox: '', title: d.name });
        fr.srcdoc = text;
        C.appendChild(fr);
        C.appendChild(h('p.muted.small', 'Shown without its scripts (for safety). To see it with everything, download it and open it in your browser.'));
      } else if (d.ext === 'newick' && MG.treeSvg) C.appendChild(MG.treeSvg(text));
      else if (d.ext === 'json') {
        let pretty = text;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch (e) {
          /* as it is */
        }
        C.appendChild(h('pre.gx-pre', pretty.length > 200000 ? pretty.slice(0, 200000) + '\n…' : pretty));
      } else if (['vcf', 'vcf_bgzip', 'tabular', 'bed', 'bedgraph', 'gff3', 'gtf'].includes(d.ext)) C.appendChild(tsvTable(text, d.ext === 'vcf' || d.ext === 'vcf_bgzip' || d.ext === 'gff3'));
      else if (d.ext === 'csv') C.appendChild(tsvTable(text.split('\n').map((l) => splitCsv(l).join('\t')).join('\n'), false));
      else C.appendChild(h('pre.gx-pre', text.length > 200000 ? text.slice(0, 200000) + '\n…' : text));
    }
    showDetails(hid) {
      const d = this.ds(hid);
      if (!d) return;
      const C = this._center('details');
      C.appendChild(h('h3', 'Dataset Information'));
      const tbl = h('table.table.small.gx-details');
      const row = (k, v) => tbl.appendChild(h('tr', h('th', k), h('td', v instanceof Node ? v : String(v == null ? '' : v))));
      row('Number', d.hid);
      row('Name', d.name);
      row('Created', d.created.toLocaleString('en-GB'));
      row('Filesize', MG.humanSize(d.size || 0) + 'B');
      row('Dbkey', d.dbkey);
      row('Format', d.ext);
      row('UUID', d.uuid);
      row('Full Path', d.path);
      C.appendChild(tbl);
      const job = d.job || d.upload;
      if (job) {
        const t = TOOL.get(job.toolId);
        C.appendChild(h('h4', 'Job Information'));
        const jt = h('table.table.small.gx-details');
        const jr = (k, v) => jt.appendChild(h('tr', h('th', k), h('td', v instanceof Node ? v : String(v == null ? '' : v))));
        jr('Galaxy Tool ID', t ? t.toolId : job.toolId);
        jr('Galaxy Tool Version', job.version);
        jr('Job State', job.state);
        if (job.exitCode != null) jr('Command Exit Code', job.exitCode);
        if (job.runtime != null) jr('Job Runtime (Wall Clock)', job.runtime.toFixed(1) + ' seconds');
        if (job.invocation) jr('Workflow Invocation', '#' + job.invocation);
        C.appendChild(jt);
        if (t) {
          C.appendChild(h('h4', 'Dependencies'));
          C.appendChild(h('p.muted.small', 'The exact software versions the tool ran with – Galaxy records them for every job.'));
          const dt = h('table.table.small');
          dt.appendChild(h('tr', h('th', 'Dependency'), h('th', 'Dependency Type'), h('th', 'Version')));
          t.requirements.forEach(([n, v]) => dt.appendChild(h('tr', h('td', n), h('td', 'conda'), h('td', v))));
          C.appendChild(dt);
          C.appendChild(h('h4', 'Command Line'));
          C.appendChild(h('p.muted.small', 'Galaxy writes a script for every job. This is the command it ran in the job’s working directory.'));
          C.appendChild(h('pre.gx-cmd', job.command || ''));
          C.appendChild(h('h4', 'Tool Parameters'));
          const pt = h('table.table.small');
          pt.appendChild(h('tr', h('th', 'Input Parameter'), h('th', 'Value')));
          t.inputs.forEach((inp) => {
            const x = job.inputs.find((i) => i.name === inp.name);
            const src = x && this.ds(x.hid);
            pt.appendChild(h('tr', h('td', inp.label), h('td', src ? `${src.hid}: ${src.name}` : inp.optional ? '(nothing selected)' : '')));
          });
          t.params.forEach((p) => pt.appendChild(h('tr', h('td', p.label), h('td', fmtParam(p, job.params[p.name])))));
          C.appendChild(pt);
          if ((job.stdout || '').trim()) {
            C.appendChild(h('h4', 'Tool Standard Output'));
            C.appendChild(h('pre.gx-pre.small', job.stdout.trim()));
          }
          C.appendChild(h('h4', 'Tool Standard Error'));
          C.appendChild(h('pre.gx-pre.small', (job.stderr || '').trim() || '(empty)'));
        } else {
          C.appendChild(h('h4', 'Upload'));
          C.appendChild(h('p', `Uploaded from ${job.params.from || job.params.file || 'a file'}${job.params.gunzip ? ' (uncompressed)' : ''} as ${job.params.file_type || d.ext}.`));
          if (job.stderr) C.appendChild(h('pre.gx-pre.small', job.stderr));
        }
      }
      bus.emit('gx:details', { hid, tool: job && job.toolId });
    }

    /* ================= the history as a notebook ================= */
    historyNotebook() {
      const fs = this.fs;
      const slug = this.historyName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'history';
      const dir = `~/galaxy-rerun/${slug}`;
      const fname = (d) => `data${d.hid}.${DOWNLOAD_EXT[d.ext] || d.ext}`;
      const cells = [
        {
          type: 'markdown',
          source: `# Galaxy history: ${this.historyName}\n\nEvery step of this history, as commands. Each code cell starts with \`%%bash\`: run the cells from the top and they make the same datasets again, as files \`data1.fastq\`, \`data2.bam\` … (data N = dataset N of the history) in \`${dir}\`. They run in the Notebook tab of the workbench, and in Jupyter on a computer with the same programs (the versions are in each step).\n\nExported from the Bioinformatics workbench on ${new Date().toLocaleString('en-GB')}.`
        }
      ];
      const steps = this.uploads.concat(this.jobs).filter((j) => j.state === 'ok').sort((a, b) => a.id - b.id);
      let first = true;
      const cd = () => {
        const s = first ? `mkdir -p ${dir} && cd ${dir}` : `cd ${dir}`;
        first = false;
        return s;
      };
      for (const j of steps) {
        if (j.toolId === 'upload1') {
          const d = this.ds(j.outputs[0]);
          if (!d) continue;
          const src = j.params.file && fs.exists(j.params.file) ? j.params.file : d.path;
          const fromText = j.params.text != null;
          cells.push({ type: 'markdown', source: `## data ${d.hid}: ${d.name}\n\nUploaded from ${j.params.from || 'a file'}${j.params.gunzip ? ' (uncompressed on upload)' : ''}, as **${d.ext}**.` });
          const body = fromText ? `cat > ${fname(d)} << 'GALAXY_PASTE_EOF'\n${j.params.text.replace(/\n$/, '')}\nGALAXY_PASTE_EOF` : j.params.gunzip ? `gzip -dc ${shq(src)} > ${fname(d)}` : `cp ${shq(src)} ${fname(d)}`;
          cells.push({ type: 'code', source: `%%bash\n${cd()}\n${body}${d.ext === 'bam' ? `\nsamtools index ${fname(d)}` : ''}`, outputs: [] });
          continue;
        }
        const t = TOOL.get(j.toolId);
        if (!t) continue;
        const paths = {};
        j.inputs.forEach((x) => {
          const d = this.ds(x.hid);
          if (d) paths[x.name] = fname(d);
        });
        const outs = j.outputs.map((hid) => this.ds(hid)).filter(Boolean);
        const mv = outs.map((d) => {
          const o = t.outputs.find((x) => x.name === d.outName);
          return o ? `mv ${o.file} ${fname(d)}` : null;
        }).filter(Boolean);
        const idx = outs.filter((d) => d.ext === 'bam').map((d) => `samtools index ${fname(d)}`);
        const ins = j.inputs.map((x) => {
          const d = this.ds(x.hid);
          return `data ${x.hid}${d ? ` (${d.name})` : ''}`;
        });
        const ps = t.params.map((p) => `${p.short || p.label}: ${fmtParam(p, p.name in (j.params || {}) ? j.params[p.name] : p.default)}`);
        cells.push({ type: 'markdown', source: `## ${t.name} – ${outs.map((d) => 'data ' + d.hid).join(', ')}\n\nGalaxy tool \`${t.toolId}\`, version ${t.version} (${t.requirements.map((r) => r.join(' ')).join(', ')}).\n\n- Inputs: ${ins.join(', ') || '–'}\n- Parameters: ${ps.join('; ') || '–'}\n- Outputs: ${outs.map((d) => `data ${d.hid} (${d.name}, ${d.ext})`).join(', ')}` });
        const outputs = [];
        if ((j.stdout || '').trim()) outputs.push({ type: 'stream', name: 'stdout', text: j.stdout });
        if ((j.stderr || '').trim()) outputs.push({ type: 'stream', name: 'stderr', text: j.stderr });
        cells.push({ type: 'code', source: `%%bash\n${cd()}\n${t.command(paths, j.params)}\n${mv.concat(idx).join('\n')}`.replace(/\n$/, ''), outputs, meta: { workbench: { galaxy_job: j.id, tool: t.toolId } } });
      }
      if (cells.length === 1) cells.push({ type: 'markdown', source: '*(This history has no finished datasets yet.)*' });
      return MG.nbformat.make('python', cells, { workbench: { kind: 'galaxy-history', history: this.historyName } });
    }
    async historyToNotebook(open) {
      const nb = this.historyNotebook();
      const slug = this.historyName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'history';
      const text = JSON.stringify(nb, null, 1);
      if (!open) {
        MG.downloadText(text, `galaxy-${slug}.ipynb`, 'application/x-ipynb+json');
        return;
      }
      const dir = HOME() + '/notebooks';
      this.fs.mkdirp(dir);
      let path = `${dir}/galaxy-${slug}.ipynb`;
      for (let n = 2; this.fs.exists(path); n++) path = `${dir}/galaxy-${slug}-${n}.ipynb`;
      this.fs.writeText(path, text);
      await MG.app.showWorkbench('notebook');
      await MG.app.nbApp.open(path);
      toast(`Saved as <b>${esc(this.fs.pretty(path))}</b>.`, 'ok', 4000);
    }

    /* ================= workflows ================= */
    showWorkflows() {
      const C = this._center('workflows');
      this.setNav('wf');
      C.appendChild(h('h3', 'Workflows'));
      C.appendChild(h('p.muted', 'A workflow is a saved graph of tools: each step’s inputs are connected to the outputs of earlier steps, so the whole analysis can be run again – on the same or on new data – with one click.'));
      if (this.workflows.length) {
        const t = h('table.table.gx-wft');
        t.appendChild(h('tr', h('th', 'Name'), h('th', 'Steps'), h('th', 'Updated'), h('th', '')));
        this.workflows.forEach((w, i) => {
          const b = (icon, label, fn, cls, tip) => {
            const x = h('button.btn.small' + (cls || ''), { type: 'button', title: tip || label, html: MG.icon(icon) + '<span>' + label + '</span>' });
            x.addEventListener('click', fn);
            return x;
          };
          t.appendChild(h('tr',
            h('td', h('b', w.name), h('div.muted.small', w.annotation || '')),
            h('td', String(w.steps.length)),
            h('td.small', w.updated ? new Date(w.updated).toLocaleString('en-GB') : ''),
            h('td.nowrap', b('pencil', 'Edit', () => this.showEditor(i)), ' ', b('play', 'Run', () => this.showRunForm(i), '.primary'), ' ', b('download', '.ga', () => this.exportGa(i), '', 'Download as a Galaxy workflow file (.ga) – it imports into usegalaxy.org (steps with Kalign, MUSCLE, bustools or PLINK 2 – tools of the workbench, with no Tool Shed counterpart – are missing there)'), ' ', b('save', 'to my files', () => this.saveGa(i), '', 'Save the .ga file in ~/galaxy/workflows'), ' ', b('trash', '', () => this.deleteWorkflow(i), '', 'Delete this workflow'))));
        });
        C.appendChild(t);
      } else C.appendChild(h('p', h('i', 'You have no workflows yet.')));
      const nw = h('button.btn.primary', { type: 'button', html: MG.icon('plus') + '<span>Create a new workflow</span>' });
      nw.addEventListener('click', () => {
        const w = { id: uid(), name: 'Unnamed workflow ' + (this.workflows.length + 1), annotation: '', steps: [], created: Date.now(), updated: Date.now() };
        this.workflows.push(w);
        this.save();
        this.showEditor(this.workflows.length - 1);
        bus.emit('gx:wfnew', { name: w.name });
      });
      const imp = h('button.btn', { type: 'button', html: MG.icon('upload') + '<span>Import a .ga file</span>' });
      imp.addEventListener('click', () => this.importGa());
      C.appendChild(h('div.gx-runrow', nw, ' ', imp));
      bus.emit('gx:workflows', {});
    }
    deleteWorkflow(i) {
      const w = this.workflows[i];
      const m = MG.modal('Delete the workflow?', `<p>“${esc(w.name)}” will be deleted. Download it (.ga) first if you want to keep it.</p><div class="prompt-actions"><button class="btn" data-x="no" type="button">Cancel</button><button class="btn danger" data-x="yes" type="button">Delete</button></div>`);
      m.box.querySelector('[data-x="no"]').addEventListener('click', () => m.close());
      m.box.querySelector('[data-x="yes"]').addEventListener('click', () => {
        m.close();
        this.workflows.splice(i, 1);
        this.save();
        this.showWorkflows();
      });
    }

    /* ---------- extract a workflow from the history ---------- */
    extractWorkflow() {
      const used = this.jobs.filter((j) => j.state === 'ok' && TOOL.has(j.toolId) && j.outputs.some((hid) => this.ds(hid) && !this.ds(hid).deleted));
      if (!used.length) return toast('There are no finished tool jobs in this history yet – run some tools first.', 'warn');
      const w = { id: uid(), name: 'Workflow constructed from history ‘' + this.historyName + '’', annotation: 'Extracted from the history on ' + new Date().toLocaleString('en-GB'), steps: [], created: Date.now(), updated: Date.now() };
      const stepOfHid = {};
      const inputOf = (hid) => {
        if (stepOfHid[hid]) return stepOfHid[hid];
        const d = this.ds(hid);
        const st = { id: 's' + uid(), type: 'input', label: d ? d.name.replace(/\.[^.]+$/, '') : 'Input dataset', ext: [d ? d.ext : 'txt'], x: 0, y: 0 };
        w.steps.push(st);
        stepOfHid[hid] = { step: st.id, output: 'output' };
        return stepOfHid[hid];
      };
      used.sort((a, b) => a.id - b.id).forEach((j) => {
        const st = { id: 's' + uid(), type: 'tool', tool: j.toolId, params: Object.assign({}, j.params), connections: {}, x: 0, y: 0 };
        j.inputs.forEach((inp) => {
          const src = this.ds(inp.hid);
          st.connections[inp.name] = src && src.job && stepOfHid[inp.hid] ? stepOfHid[inp.hid] : inputOf(inp.hid);
        });
        w.steps.push(st);
        j.outputs.forEach((hid) => {
          const d = this.ds(hid);
          if (d && d.outName) stepOfHid[hid] = { step: st.id, output: d.outName };
        });
      });
      autoLayout(w);
      this.workflows.push(w);
      this.save();
      toast('Workflow extracted from your history – it opens in the editor.');
      bus.emit('gx:extract', { steps: w.steps.length });
      this.showEditor(this.workflows.length - 1);
    }

    /* ---------- the editor ---------- */
    showEditor(i) {
      const w = this.workflows[i];
      const C = this._center('editor');
      this.root.classList.add('gx-editing');
      this.editing = w;
      this.editingIndex = i;
      this.setNav('wf');
      const nameIn = h('input.gx-wfname', { type: 'text', value: w.name, 'aria-label': 'Workflow name' });
      nameIn.addEventListener('input', () => {
        w.name = nameIn.value;
        this._touch();
      });
      const b = (icon, label, fn, cls) => {
        const x = h('button.btn.small' + (cls || ''), { type: 'button', html: (icon ? MG.icon(icon) : '') + '<span>' + label + '</span>' });
        x.addEventListener('click', fn);
        return x;
      };
      const addIn = b('plus', 'Input dataset', () => {
        const n = w.steps.filter((s) => s.type === 'input').length + 1;
        w.steps.push({ id: 's' + uid(), type: 'input', label: 'Input dataset ' + n, ext: ['fastqsanger'], x: 16, y: 16 + 96 * (n - 1) });
        this._touch();
        this.drawEditor();
        bus.emit('gx:addinput', {});
      });
      C.appendChild(h('div.gx-edbar', b('', '← Workflows', () => this.showWorkflows()), nameIn, h('span.grow'), addIn, b('', 'Tidy layout', () => {
        autoLayout(w);
        this._touch();
        this.drawEditor();
      }), b('download', '.ga', () => this.exportGa(i)), b('play', 'Run', () => this.showRunForm(i), '.primary')));
      C.appendChild(h('p.muted.small.gx-edhint', { html: 'Add <b>Input dataset</b> boxes and click tools on the left to add steps. Drag from an <b>output</b> (dot on the right of a box) to an <b>input</b> (dot on the left) to connect them – only matching formats connect. Click a box to change its settings. Changes are saved as you go.' }));
      this.canvas = h('div.gx-canvas');
      // a click on the empty canvas deselects the step and shows the checks
      this.canvas.addEventListener('click', (e) => {
        if (!e.target.closest('.gx-node') && !e.target.closest('.gx-wire')) this.showStepSettings(null);
      });
      this.side = this.sideCol;
      this.side.innerHTML = '';
      C.appendChild(h('div.gx-edwrap', this.canvas));
      this.drawEditor();
      bus.emit('gx:editor', { name: w.name });
    }
    _touch() {
      if (this.editing) this.editing.updated = Date.now();
      this.save();
    }
    editorAddTool(id) {
      const w = this.editing;
      const t = TOOL.get(id);
      const maxX = Math.max(0, ...w.steps.map((s) => s.x || 0));
      const params = {};
      t.params.forEach((p) => (params[p.name] = p.default));
      const st = { id: 's' + uid(), type: 'tool', tool: id, params, connections: {}, x: Math.min(maxX + 220, 1100), y: 20 + (w.steps.length % 4) * 70 };
      w.steps.push(st);
      this._touch();
      this.drawEditor();
      this.showStepSettings(st);
      // a reminder for the first few steps only, so toasts do not pile up
      this._addedN = (this._addedN || 0) + 1;
      if (this._addedN <= 2) toast(`Added <b>${esc(t.name)}</b> – now connect its input${t.inputs.length > 1 ? 's' : ''}: drag from an output dot (right of a box) to an input dot (left).`, null, 4000);
      bus.emit('gx:added', { tool: id, steps: w.steps.length });
    }
    drawEditor() {
      const w = this.editing;
      const cv = this.canvas;
      cv.innerHTML = '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gx-wires');
      cv.appendChild(svg);
      if (!w.steps.length) cv.appendChild(h('div.gx-canvas-empty', h('p', { html: 'An empty workflow. Start with <b>+ Input dataset</b> (above), then click tools on the left.' })));
      w.steps.forEach((st) => {
        const t = st.type === 'tool' ? TOOL.get(st.tool) : null;
        const el = h('div.gx-node' + (st.type === 'input' ? '.input' : ''), { dataset: { id: st.id } });
        el.style.left = (st.x || 0) + 'px';
        el.style.top = (st.y || 0) + 'px';
        const title = h('div.gx-node-t', h('span', st.type === 'input' ? st.label : t ? t.name : st.tool + ' (not installed)'));
        const del = h('button.gx-node-x', { type: 'button', title: 'Remove this step', 'aria-label': 'Remove this step', html: MG.icon('x') });
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          w.steps = w.steps.filter((s) => s !== st);
          w.steps.forEach((s) => Object.keys(s.connections || {}).forEach((k) => s.connections[k] && s.connections[k].step === st.id && delete s.connections[k]));
          this._touch();
          this.drawEditor();
        });
        title.appendChild(del);
        el.appendChild(title);
        const ins = st.type === 'input' || !t ? [] : t.inputs;
        const outs = st.type === 'input' ? [{ name: 'output', ext: st.ext, label: st.ext.join('/') }] : t ? stepOutputs(st).map((o) => ({ name: o.name, ext: stepOutExts(w, st, o.name), label: o.short || o.name })) : [];
        const portsIn = h('div.gx-ports.in');
        ins.forEach((inp) => {
          const connected = !!(st.connections || {})[inp.name];
          portsIn.appendChild(h('div.gx-port.in' + (connected ? '.on' : ''), { dataset: { step: st.id, name: inp.name }, title: inp.label + ' – accepts ' + inp.ext.join(', ') + (inp.optional ? ' (optional)' : '') }, h('i.dot'), h('span', (inp.short || inp.name) + (inp.optional ? ' (opt.)' : '')), h('small', inp.ext.length > 3 ? inp.ext.slice(0, 3).join('/') + '…' : inp.ext.join('/'))));
        });
        const portsOut = h('div.gx-ports.out');
        outs.forEach((o) => {
          const p = h('div.gx-port.out', { dataset: { step: st.id, name: o.name, ext: o.ext.join(',') }, title: 'produces ' + o.ext.join(', ') + ' – drag from the dot to an input' }, h('small', o.ext.length > 3 ? o.ext.slice(0, 3).join('/') + '…' : o.ext.join('/')), h('span', o.label), h('i.dot'));
          portsOut.appendChild(p);
          p.querySelector('.dot').addEventListener('pointerdown', (e) => this._startWire(e, st, o, svg));
        });
        el.append(portsIn, portsOut);
        this._draggable(el, st);
        el.addEventListener('click', () => this.showStepSettings(st));
        cv.appendChild(el);
      });
      const maxX = Math.max(640, ...w.steps.map((s) => (s.x || 0) + 230));
      const maxY = Math.max(380, ...w.steps.map((s) => (s.y || 0) + 190));
      cv.style.width = maxX + 'px';
      cv.style.height = maxY + 'px';
      svg.setAttribute('width', maxX);
      svg.setAttribute('height', maxY);
      requestAnimationFrame(() => this._drawWires(svg));
      this.showStepSettings(this._selStep && w.steps.includes(this._selStep) ? this._selStep : null);
    }
    _portPos(stepId, name, dir) {
      const el = this.canvas.querySelector(`.gx-port.${dir}[data-step="${stepId}"][data-name="${CSS.escape(name)}"] .dot`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const c = this.canvas.getBoundingClientRect();
      return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
    }
    _drawWires(svg) {
      const w = this.editing;
      if (!w || !svg) return;
      Array.from(svg.querySelectorAll('path')).forEach((p) => p.remove());
      w.steps.forEach((st) => {
        Object.entries(st.connections || {}).forEach(([inName, c]) => {
          if (!c) return;
          const a = this._portPos(c.step, c.output, 'out');
          const b = this._portPos(st.id, inName, 'in');
          if (!a || !b) return;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
          path.setAttribute('d', `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`);
          path.setAttribute('class', 'gx-wire');
          path.addEventListener('click', () => {
            delete st.connections[inName];
            this._touch();
            this.drawEditor();
          });
          const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          tt.textContent = 'Click to remove this connection';
          path.appendChild(tt);
          svg.appendChild(path);
        });
      });
    }
    _draggable(el, st) {
      let start = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.dot') || e.target.closest('button')) return;
        start = { x: e.clientX, y: e.clientY, sx: st.x || 0, sy: st.y || 0, moved: false };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
        st.x = Math.max(0, start.sx + dx);
        st.y = Math.max(0, start.sy + dy);
        el.style.left = st.x + 'px';
        el.style.top = st.y + 'px';
        this._drawWires(this.canvas.querySelector('svg'));
      });
      el.addEventListener('pointerup', (e) => {
        if (start && start.moved) {
          e.stopPropagation();
          this._touch();
        }
        start = null;
      });
    }
    /** connect an output to an input (used by dragging, and by tests) */
    connect(fromStep, outName, toStep, inName) {
      const w = this.editing;
      const a = w.steps.find((s) => s.id === fromStep);
      const b = w.steps.find((s) => s.id === toStep);
      if (!a || !b || a === b || b.type !== 'tool') return false;
      const t = TOOL.get(b.tool);
      const inp = t && t.inputs.find((i) => i.name === inName);
      const outExt = stepOutExts(w, a, outName);
      if (!inp || !outExt.some((x) => inp.ext.includes(x))) {
        toast(`Can't connect: <b>${esc(t ? t.name : b.tool)}</b> needs <b>${esc(inp ? inp.ext.join(' or ') : '?')}</b>, but this output is <b>${esc(outExt.join(', '))}</b>.`, 'error', 6000);
        bus.emit('gx:badwire', { from: a.tool || 'input', to: b.tool, need: inp ? inp.ext.join(',') : '', got: outExt.join(',') });
        return false;
      }
      if (reaches(w, b.id, a.id)) {
        toast('Can\'t connect: that would make a loop – a step cannot depend on its own output.', 'error', 5000);
        return false;
      }
      b.connections = b.connections || {};
      b.connections[inName] = { step: fromStep, output: outName };
      this._touch();
      this.drawEditor();
      bus.emit('gx:wire', { from: a.tool || 'input', to: b.tool, input: inName, n: countWires(w) });
      return true;
    }
    _startWire(e, st, out, svg) {
      e.preventDefault();
      e.stopPropagation();
      const c = this.canvas.getBoundingClientRect();
      const a = this._portPos(st.id, out.name, 'out');
      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tmp.setAttribute('class', 'gx-wire tmp');
      svg.appendChild(tmp);
      this.canvas.querySelectorAll('.gx-port.in').forEach((p) => {
        const step = this.editing.steps.find((s) => s.id === p.dataset.step);
        const t = step && TOOL.get(step.tool);
        const inp = t && t.inputs.find((i) => i.name === p.dataset.name);
        const ok = inp && out.ext.some((x) => inp.ext.includes(x)) && step.id !== st.id;
        p.classList.add(ok ? 'ok' : 'bad');
      });
      const move = (ev) => {
        const x = ev.clientX - c.left, y = ev.clientY - c.top;
        const dx = Math.max(40, Math.abs(x - a.x) / 2);
        tmp.setAttribute('d', `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${x - dx} ${y} ${x} ${y}`);
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        tmp.remove();
        this.canvas.querySelectorAll('.gx-port.in').forEach((p) => p.classList.remove('ok', 'bad'));
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const port = target && target.closest('.gx-port.in');
        if (!port) return;
        this.connect(st.id, out.name, port.dataset.step, port.dataset.name);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    showStepSettings(st) {
      this._selStep = st;
      if (st) bus.emit('gx:step', { tool: st.tool || 'input' });
      const S = this.side;
      if (!S || !this.canvas) return;
      S.innerHTML = '';
      this.canvas.querySelectorAll('.gx-node').forEach((n) => n.classList.toggle('sel', !!st && n.dataset.id === st.id));
      if (!st) {
        S.appendChild(h('div.gx-ph', 'Step settings'));
        S.appendChild(h('p.muted.small.gx-pad', 'Click a step in the workflow to see and change its settings.'));
        const probs = validateWorkflow(this.editing);
        S.appendChild(h('div.gx-ph', 'Checks'));
        S.appendChild(probs.length ? h('ul.gx-probs', ...probs.map((p) => h('li', p))) : h('p.okline.gx-pad', '✓ Every input is connected.'));
        return;
      }
      if (st.type === 'input') {
        S.appendChild(h('div.gx-ph', 'Input dataset'));
        const lab = h('input', { type: 'text', value: st.label });
        lab.addEventListener('input', () => {
          st.label = lab.value;
          const n = this.canvas.querySelector(`.gx-node[data-id="${st.id}"] .gx-node-t span`);
          if (n) n.textContent = st.label;
          this._touch();
        });
        const fmt = h('select');
        FORMATS.forEach(([v, l]) => fmt.appendChild(h('option', { value: v }, l)));
        fmt.value = st.ext[0];
        fmt.addEventListener('change', () => {
          st.ext = [fmt.value];
          this._touch();
          this.drawEditor();
          bus.emit('gx:inputformat', { ext: fmt.value });
        });
        S.append(h('div.gx-pad', field('Label', lab), field('Format', fmt)));
        return;
      }
      const t = TOOL.get(st.tool);
      if (!t) {
        S.appendChild(h('p.warnline.gx-pad', `The tool ${st.tool} is not installed here.`));
        return;
      }
      S.appendChild(h('div.gx-ph', t.name));
      const box = h('div.gx-pad');
      box.appendChild(h('p.muted.small', t.desc + ' · version ' + t.version));
      t.params.forEach((p) => {
        const cur = st.params && p.name in st.params ? st.params[p.name] : p.default;
        const ctl = control(p, cur);
        ctl.addEventListener('change', () => {
          st.params = st.params || {};
          st.params[p.name] = readControl(p, ctl);
          this._touch();
          if (t.outputs.some((o) => typeof o.ext === 'function')) this.drawEditor();
          bus.emit('gx:param', { tool: st.tool, name: p.name, value: st.params[p.name] });
        });
        box.appendChild(field(p.label, ctl, null, p.help));
      });
      const missing = t.inputs.filter((i) => !i.optional && !(st.connections || {})[i.name]);
      if (missing.length) box.appendChild(h('p.warnline', `Not connected: ${missing.map((m) => m.short || m.name).join(', ')}`));
      S.appendChild(box);
    }

    /* ---------- .ga export / import ---------- */
    toGa(w) {
      const order = orderSteps(w);
      const idx = new Map(order.map((s, i) => [s.id, i]));
      const steps = {};
      order.forEach((s, i) => {
        if (s.type === 'input') {
          steps[i] = { annotation: '', content_id: null, errors: null, id: i, input_connections: {}, inputs: [{ description: '', name: s.label }], label: s.label, name: 'Input dataset', outputs: [], position: { left: s.x || 0, top: s.y || 0 }, tool_id: null, tool_state: JSON.stringify({ optional: false, format: s.ext, tag: null }), tool_version: null, type: 'data_input', uuid: uuid(), when: null, workflow_outputs: [] };
        } else {
          const t = TOOL.get(s.tool);
          if (!t) return;
          const conns = {};
          Object.entries(s.connections || {}).forEach(([k, c]) => c && idx.has(c.step) && (conns[k] = { id: idx.get(c.step), output_name: c.output }));
          const shed = t.toolId.includes('/repos/') ? { tool_shed_repository: { changeset_revision: 'workbench', name: t.toolId.split('/')[3], owner: t.toolId.split('/')[2], tool_shed: 'toolshed.g2.bx.psu.edu' } } : {};
          steps[i] = Object.assign({ annotation: '', content_id: t.toolId, errors: null, id: i, input_connections: conns, inputs: [], label: null, name: t.name, outputs: stepOutputs(s).map((o) => ({ name: o.name, type: stepOutExts(w, s, o.name)[0] || 'data' })), position: { left: s.x || 0, top: s.y || 0 }, post_job_actions: {}, tool_id: t.toolId }, shed, { tool_state: JSON.stringify(Object.assign({}, s.params, { __page__: null, __rerun_remap_job_id__: null })), tool_version: t.version, type: 'tool', uuid: uuid(), when: null, workflow_outputs: [] });
        }
      });
      return { a_galaxy_workflow: 'true', annotation: w.annotation || '', 'format-version': '0.1', name: w.name, steps, tags: [], uuid: uuid(), version: 1 };
    }
    exportGa(i) {
      const w = this.workflows[i];
      const ga = this.toGa(w);
      MG.downloadText(JSON.stringify(ga, null, 4), `Galaxy-Workflow-${w.name.replace(/[^A-Za-z0-9._-]+/g, '_')}.ga`, 'application/json');
      bus.emit('gx:export', { name: w.name, steps: w.steps.length });
    }
    /** keep the workflow among the user's files: ~/galaxy/workflows/NAME.ga */
    saveGa(i) {
      const w = this.workflows[i];
      const text = JSON.stringify(this.toGa(w), null, 4);
      const dir = HOME() + '/galaxy/workflows';
      this.fs.mkdirp(dir);
      const path = `${dir}/${w.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'workflow'}.ga`;
      this.fs.writeText(path, text + '\n');
      toast(`Saved <b>${esc(this.fs.pretty(path))}</b> – open it in the Files tab.`, null, 5000);
      bus.emit('gx:export', { name: w.name, steps: w.steps.length, to: 'files', path });
    }
    importGa() {
      const inp = h('input', { type: 'file', accept: '.ga,.json' });
      inp.addEventListener('change', async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
          const ga = JSON.parse(await f.text());
          const w = fromGa(ga);
          this.workflows.push(w);
          this.save();
          toast(`Imported <b>${esc(w.name)}</b>.`);
          this.showEditor(this.workflows.length - 1);
        } catch (e) {
          toast('This is not a workflow that this Galaxy can read: ' + esc(e.message), 'error', 7000);
        }
      });
      inp.click();
    }

    /* ---------- run a workflow ---------- */
    showRunForm(i) {
      const w = this.workflows[i];
      const C = this._center('runform');
      this.setNav('wf');
      const problems = validateWorkflow(w);
      C.appendChild(h('h3', 'Run workflow: ' + w.name));
      if (problems.length) {
        C.appendChild(h('div.callout.warn', h('div.co-t', 'This workflow is not ready to run'), h('ul', ...problems.map((p) => h('li', p)))));
        const ed = h('button.btn', { type: 'button', text: 'Open it in the editor' });
        ed.addEventListener('click', () => this.showEditor(i));
        C.appendChild(ed);
        bus.emit('gx:runblocked', { problems: problems.length });
        return;
      }
      const form = h('form.gx-form');
      const pickers = {};
      orderSteps(w).filter((s) => s.type === 'input').forEach((s) => {
        const sel = h('select');
        const cand = this.datasets.filter((d) => !d.deleted && d.state === 'ok' && s.ext.includes(d.ext));
        cand.slice().reverse().forEach((d) => sel.appendChild(h('option', { value: String(d.hid) }, `${d.hid}: ${d.name}`)));
        if (!cand.length) sel.appendChild(h('option', { value: '' }, `No ${s.ext.join('/')} dataset in the history`));
        const words = s.label.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1);
        const guess = cand.find((d) => words.some((wd) => d.name.toLowerCase().includes(wd))) || (/(forward|_1|r1)/i.test(s.label) && cand.find((d) => /_1|R1/.test(d.name))) || (/(reverse|_2|r2)/i.test(s.label) && cand.find((d) => /_2|R2/.test(d.name)));
        if (guess) sel.value = String(guess.hid);
        pickers[s.id] = sel;
        form.appendChild(field(s.label, sel, s.ext.join(', ')));
      });
      const summary = h('ol.gx-steps');
      orderSteps(w).filter((s) => s.type === 'tool').forEach((s) => {
        const t = TOOL.get(s.tool);
        const ps = t.params.map((p) => `${p.short || p.label}: ${fmtParam(p, s.params && p.name in s.params ? s.params[p.name] : p.default)}`).join(' · ');
        summary.appendChild(h('li', h('b', t.name), ps ? h('span.muted.small', ' – ' + ps) : null));
      });
      form.appendChild(h('div.gx-field', h('label', 'Steps that will run'), summary));
      const run = h('button.btn.primary', { type: 'submit', html: MG.icon('play') + '<span>Run workflow</span>' });
      form.appendChild(h('div.gx-runrow', run));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputs = {};
        for (const [sid, sel] of Object.entries(pickers)) {
          if (!sel.value) return toast('Choose a dataset for every input.', 'warn');
          inputs[sid] = +sel.value;
        }
        this.invoke(w, inputs);
      });
      C.appendChild(form);
      bus.emit('gx:runform', { workflow: w.name });
    }
    invoke(w, inputs) {
      const inv = { id: this.invocations.length + 1, workflow: w.name, created: new Date(), items: [], state: 'scheduled' };
      this.invocations.push(inv);
      const produced = {};
      Object.entries(inputs).forEach(([sid, hid]) => (produced[sid] = { output: hid }));
      const steps = orderSteps(w).filter((s) => s.type === 'tool' && TOOL.has(s.tool));
      steps.forEach((s) => {
        const t = TOOL.get(s.tool);
        const ins = t.inputs
          .map((inp) => {
            const c = s.connections[inp.name];
            if (!c) return inp.optional ? null : { name: inp.name, hid: 0 };
            return { name: inp.name, hid: (produced[c.step] && produced[c.step][c.output]) || 0 };
          })
          .filter(Boolean);
        const params = {};
        t.params.forEach((p) => (params[p.name] = s.params && p.name in s.params ? s.params[p.name] : p.default));
        const { job, outs } = this.submit(t.id, ins, params, { invocation: inv.id, step: s.id });
        produced[s.id] = {};
        outs.forEach((d) => (produced[s.id][d.outName] = d.hid));
        inv.items.push({ tool: t.name, job });
      });
      bus.emit('gx:invoked', { inv: inv.id, workflow: w.name, steps: steps.length });
      this.showInvocation(inv.id);
      this._saveSoon();
      const watch = setInterval(() => {
        const done = inv.items.filter((x) => x.job.state === 'ok' || x.job.state === 'error').length;
        if (done === inv.items.length) {
          clearInterval(watch);
          inv.state = inv.items.every((x) => x.job.state === 'ok') ? 'ok' : 'error';
          this._saveSoon();
          if (this.view === 'invocation' && this._invShown === inv.id) this.showInvocation(inv.id);
          bus.emit('gx:invocation', { inv: inv.id, ok: inv.state === 'ok', steps: inv.items.length, workflow: w.name });
        } else if (this.view === 'invocation' && this._invShown === inv.id) this._invStates(inv);
      }, 500);
    }
    showInvocations() {
      const C = this._center('invocations');
      this.setNav('inv');
      C.appendChild(h('h3', 'Workflow Invocations'));
      if (!this.invocations.length) return C.appendChild(h('p.muted', 'No workflow has been run yet.'));
      const t = h('table.table.small');
      t.appendChild(h('tr', h('th', '#'), h('th', 'Workflow'), h('th', 'Invoked'), h('th', 'State'), h('th', '')));
      this.invocations.slice().reverse().forEach((inv) => {
        const b = h('button.btn.small', { type: 'button' }, 'View');
        b.addEventListener('click', () => this.showInvocation(inv.id));
        t.appendChild(h('tr', h('td', String(inv.id)), h('td', inv.workflow), h('td', inv.created.toLocaleString('en-GB')), h('td', inv.state), h('td', b)));
      });
      C.appendChild(t);
    }
    showInvocation(id) {
      const inv = this.invocations.find((x) => x.id === id);
      const C = this._center('invocation');
      this._invShown = id;
      this.setNav('inv');
      C.appendChild(h('h3', { html: MG.icon('workflow') + ' Workflow invocation #' + inv.id }));
      C.appendChild(h('p', `“${inv.workflow}” – ${inv.items.length} jobs, invoked ${inv.created.toLocaleString('en-GB')}. The outputs appear in your history: grey (queued) → yellow (running) → green (done).`));
      const list = h('ol.gx-inv');
      inv.items.forEach((x) => {
        const st = h('span.gx-invstate.' + x.job.state, x.job.state);
        const li = h('li', h('b', x.tool), ' ', st);
        x.el = st;
        list.appendChild(li);
      });
      C.appendChild(list);
      if (inv.state === 'ok') C.appendChild(h('p.okline', '✓ All steps finished. Open the datasets in your history – the ⓘ of each one shows exactly how it was made.'));
      else if (inv.state === 'error') C.appendChild(h('p.warnline', 'Some steps failed – open the ⓘ of the red dataset to see why.'));
    }
    _invStates(inv) {
      inv.items.forEach((x) => {
        if (x.el) {
          x.el.textContent = x.job.state;
          x.el.className = 'gx-invstate ' + x.job.state;
        }
      });
    }
  }

  /* ================= helpers ================= */
  function control(p, cur) {
    let ctl;
    if (p.type === 'select') {
      ctl = h('select');
      p.options.forEach(([v, l]) => ctl.appendChild(h('option', { value: v }, l)));
      ctl.value = cur;
    } else if (p.type === 'bool') {
      ctl = h('input', { type: 'checkbox' });
      ctl.checked = !!cur;
    } else {
      ctl = h('input', { type: p.type === 'text' ? 'text' : 'number', step: p.type === 'float' ? 'any' : '1', spellcheck: 'false' });
      ctl.value = cur;
    }
    return ctl;
  }
  function readControl(p, c) {
    return p.type === 'bool' ? c.checked : p.type === 'int' ? int(c.value, p.default) : p.type === 'float' ? (Number.isFinite(parseFloat(c.value)) ? parseFloat(c.value) : p.default) : c.value;
  }
  function fmtParam(p, v) {
    if (p.type === 'select') return (p.options.find((o) => o[0] === v) || [v, v])[1];
    if (p.type === 'bool') return v ? 'Yes' : 'No';
    return String(v);
  }
  function field(label, ctl, ext, help) {
    const f = h('div.gx-field');
    f.appendChild(h('label', label));
    f.appendChild(ctl);
    if (ext) f.appendChild(h('small.muted', 'Format: ' + ext));
    if (help) f.appendChild(h('small.gx-fhelp', help));
    return f;
  }
  function card(ic, title, text) {
    return h('div.gx-card', h('div.gx-card-t', { html: MG.icon(ic) + '<b>' + esc(title) + '</b>' }), h('p', text));
  }
  /** one line of a CSV file → its fields (quotes understood) */
  function splitCsv(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') out.push(cur), (cur = '');
      else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.replace(/\t/g, ' '));
  }
  function tsvTable(text, meta2) {
    const L2 = text.split('\n').filter(Boolean);
    const meta = meta2 ? L2.filter((l) => l.startsWith('##')) : [];
    const rows = L2.filter((l) => !meta2 || !l.startsWith('##'));
    const wrap = h('div.gx-tablewrap');
    if (meta.length) {
      const d = h('details');
      d.appendChild(h('summary', `${meta.length} header lines (##) – click to show`));
      d.appendChild(h('pre.gx-pre.small', meta.join('\n')));
      wrap.appendChild(d);
    }
    const t = h('table.table.small.mono');
    rows.slice(0, 500).forEach((r, i) => {
      const tr = h('tr');
      r.split('\t').forEach((c) => tr.appendChild(h(i === 0 && r.startsWith('#') ? 'th' : 'td', c.length > 60 ? c.slice(0, 57) + '…' : c)));
      t.appendChild(tr);
    });
    wrap.appendChild(h('div.ch-table-scroll', t));
    if (rows.length > 500) wrap.appendChild(h('p.muted.small', `Showing the first 500 of ${rows.length} lines.`));
    return wrap;
  }
  function orderSteps(w) {
    const done = new Set();
    const out = [];
    let guard = 0;
    while (out.length < w.steps.length && guard++ < 200) {
      w.steps.forEach((s) => {
        if (done.has(s.id)) return;
        const deps = Object.values(s.connections || {}).filter(Boolean).map((c) => c.step);
        if (deps.every((d) => done.has(d) || !w.steps.some((x) => x.id === d))) {
          done.add(s.id);
          out.push(s);
        }
      });
    }
    w.steps.forEach((s) => !done.has(s.id) && out.push(s));
    return out;
  }
  /** does step `from` lead (through its outputs) to step `to`? */
  function reaches(w, from, to) {
    const seen = new Set();
    const go = (id) => {
      if (id === to) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return w.steps.filter((s) => Object.values(s.connections || {}).some((c) => c && c.step === id)).some((s) => go(s.id));
    };
    return go(from);
  }
  function countWires(w) {
    return w.steps.reduce((n, s) => n + Object.values(s.connections || {}).filter(Boolean).length, 0);
  }
  function validateWorkflow(w) {
    const probs = [];
    if (!w.steps.some((s) => s.type === 'input')) probs.push('It has no input dataset.');
    if (!w.steps.some((s) => s.type === 'tool')) probs.push('It has no tool steps.');
    w.steps.forEach((s) => {
      if (s.type !== 'tool') return;
      const t = TOOL.get(s.tool);
      if (!t) return probs.push(`The tool ${s.tool} is not installed here.`);
      if (!available(t)) probs.push(`${t.name}: its program (${t.needs}) is not available in this browser.`);
      t.inputs.forEach((i) => {
        const c = (s.connections || {})[i.name];
        if (!c) {
          if (!i.optional) probs.push(`${t.name}: “${i.short || i.name}” is not connected.`);
          return;
        }
        const src = w.steps.find((x) => x.id === c.step);
        if (!src) probs.push(`${t.name}: “${i.short || i.name}” is connected to a step that was removed.`);
        else if (src.type === 'tool' && !stepOutputs(src).some((o) => o.name === c.output)) probs.push(`${t.name}: “${i.short || i.name}” is connected to an output that ${TOOL.get(src.tool) ? TOOL.get(src.tool).name : 'its step'} does not make with these inputs.`);
      });
    });
    return probs;
  }
  function autoLayout(w) {
    const depth = {};
    orderSteps(w).forEach((s) => {
      const deps = Object.values(s.connections || {}).filter(Boolean).map((c) => depth[c.step] || 0);
      depth[s.id] = deps.length ? Math.max(...deps) + 1 : 0;
    });
    const cols = {};
    w.steps.forEach((s) => {
      const d = depth[s.id] || 0;
      cols[d] = (cols[d] || 0) + 1;
      s.x = 16 + d * 222;
      s.y = 16 + (cols[d] - 1) * 132;
    });
  }
  function fromGa(ga) {
    if (!ga || ga.a_galaxy_workflow !== 'true' || !ga.steps) throw new Error('no a_galaxy_workflow / steps');
    const w = { id: uid(), name: ga.name || 'Imported workflow', annotation: ga.annotation || '', steps: [], created: Date.now(), updated: Date.now() };
    const ids = {};
    Object.values(ga.steps).forEach((s) => (ids[s.id] = 's' + uid()));
    const repo = (id) => String(id).split('/').slice(0, -1).join('/');
    Object.values(ga.steps).forEach((s) => {
      if (s.type === 'data_input') {
        let fmt = ['fastqsanger'];
        try {
          const st = JSON.parse(s.tool_state || '{}');
          if (st.format && st.format.length) fmt = [].concat(st.format);
        } catch (e) {
          /* the default */
        }
        w.steps.push({ id: ids[s.id], type: 'input', label: s.label || (s.inputs && s.inputs[0] && s.inputs[0].name) || 'Input dataset', ext: fmt, x: (s.position && s.position.left) || 0, y: (s.position && s.position.top) || 0 });
      } else if (s.type === 'tool') {
        const t = TOOLS.find((x) => x.toolId === s.tool_id || (x.toolId.includes('/repos/') && repo(x.toolId) === repo(s.tool_id)) || x.id === s.tool_id);
        if (!t) throw new Error(`the tool ${s.tool_id} is not installed on this server`);
        let params = {};
        try {
          params = JSON.parse(s.tool_state || '{}');
        } catch (e) {
          /* the defaults */
        }
        const clean = {};
        t.params.forEach((p) => (clean[p.name] = p.name in params && params[p.name] != null && typeof params[p.name] !== 'object' ? params[p.name] : p.default));
        const conns = {};
        Object.entries(s.input_connections || {}).forEach(([k, c]) => {
          const cc = Array.isArray(c) ? c[0] : c;
          if (cc && ids[cc.id]) conns[k] = { step: ids[cc.id], output: cc.output_name };
        });
        w.steps.push({ id: ids[s.id], type: 'tool', tool: t.id, params: clean, connections: conns, x: (s.position && s.position.left) || 0, y: (s.position && s.position.top) || 0 });
      }
    });
    return w;
  }

  MG.GalaxyApp = GalaxyApp;
  MG.galaxyUtil = { TOOLS, FORMATS, sniff, orderSteps, validateWorkflow, autoLayout, fromGa, stepOutExts };
})();
