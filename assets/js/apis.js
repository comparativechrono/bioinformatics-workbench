/* =====================================================================
   The Databases tab: public bioinformatics web services, called from the
   browser (they all allow it – CORS). Each card is one service; each
   query shows its results with ways to keep them:
     · Save to my files (FASTA, tables, JSON, structures);
     · Send to notebook – Python (requests) or R code that makes the same
       query, so it can be re-run, changed and kept (.ipynb);
     · Show in the 3D viewer / the genome browser where that fits.
   Every query made here is listed under "Your queries" and can be saved
   as a notebook.
   UniProt and the PDB have their own explorers (uniprot.js, pdb.js).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;

  /* ------------------------------------------------------------------
     calling a service: every request is recorded (for the notebook)
     ------------------------------------------------------------------ */
  const LOG = [];
  class ApiError extends Error {}
  async function call(req) {
    // req: {method, url, headers, form (object → x-www-form-urlencoded), json (object), expect: 'json'|'text'|'blob', service, label, timeout}
    const init = { method: req.method || 'GET', headers: Object.assign({}, req.headers || {}) };
    if (req.form) {
      init.body = new URLSearchParams(req.form);
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (req.json) {
      init.body = JSON.stringify(req.json);
      init.headers['Content-Type'] = 'application/json';
    }
    const entry = { t: Date.now(), service: req.service || '', label: req.label || '', method: init.method, url: req.url, headers: req.headers || null, form: req.form || null, json: req.json || null, expect: req.expect || 'json', status: null, quiet: !!req.quiet };
    if (!req.quiet) LOG.push(entry);
    let r;
    try {
      // A request that got no answer at all (the connection, or a server that answered without the headers that let a
      // web page read it) is asked again, twice: these services are busy at times. (Only GET: it changes nothing.)
      for (let attempt = 0; ; attempt++) {
        try {
          r = await MG.fetchWithTimeout(req.url, init, req.timeout || 60000);
          break;
        } catch (e) {
          if (init.method !== 'GET' || e.status || /Timed out/.test(String(e.message)) || attempt >= 2) throw e;
          await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
        }
      }
    } catch (e) {
      entry.status = e.status || 'failed';
      bus.emit('api:log', entry);
      const msg = String(e.message || e);
      if (e.status === 404) throw new ApiError('Not found (HTTP 404): check the identifier.');
      if (e.status === 400) throw new ApiError('The service did not accept the query (HTTP 400): check what you typed.');
      if (e.status === 429) throw new ApiError('The service asks to slow down (too many requests, HTTP 429). Wait a minute and try again.');
      if (e.status >= 500) throw new ApiError(`The service is not answering just now (HTTP ${e.status}). Try again in a little while.`);
      if (/Timed out/.test(msg)) throw new ApiError('The service took too long to answer. Try again, or ask for less.');
      // (a server that is down often answers without the headers that let a web page read the answer: to the page that
      // looks like no answer at all)
      let host = '';
      try {
        host = new URL(req.url).host;
      } catch (err) {
        host = 'the service';
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('This browser is offline: connect it to the internet and try again.');
      throw new ApiError(`No answer from ${host} that the page could read – the service may be down or busy just now. Try again in a few minutes (the service's own web site may say more).`);
    }
    entry.status = r.status;
    bus.emit('api:log', entry);
    if (req.expect === 'text') return r.text();
    if (req.expect === 'blob') return r.blob();
    const text = await r.text();
    if (r.status === 204 || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new ApiError('The service answered, but not with data this page can read.');
    }
  }
  const enc = encodeURIComponent;

  /* ------------------------------------------------------------------
     code for the notebook: the same query in Python or R
     ------------------------------------------------------------------ */
  const pyStr = (s) => JSON.stringify(String(s));
  const pyDict = (o) => '{' + Object.entries(o).map(([k, v]) => `${pyStr(k)}: ${typeof v === 'number' ? v : pyStr(v)}`).join(', ') + '}';
  const rStr = (s) => JSON.stringify(String(s));
  // (an e-mail address typed for EBI is not written into notebooks: they may be shared)
  const noEmail = (form) => (form && form.email ? Object.assign({}, form, { email: 'YOUR_EMAIL' }) : form);
  function pyRequest(e0, name = 'data') {
    const e = Object.assign({}, e0, { form: noEmail(e0.form) });
    const lines = ['import requests', ''];
    const hdr = e.headers && Object.keys(e.headers).length ? `, headers=${pyDict(e.headers)}` : '';
    if (e.method === 'GET') lines.push(`r = requests.get(${pyStr(e.url)}${hdr})`);
    else if (e.form) lines.push(`r = requests.post(${pyStr(e.url)}, data=${pyDict(e.form)}${hdr})`);
    else if (e.json) lines.push(`r = requests.post(${pyStr(e.url)}, json=${JSON.stringify(e.json, null, 1).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')}${hdr})`);
    lines.push('r.raise_for_status()');
    if (e.expect === 'json') lines.push(`${name} = r.json()`);
    else lines.push(`${name} = r.text`, `print(${name}[:2000])`);
    return lines.join('\n');
  }
  function rRequest(e0, name = 'data') {
    const e = Object.assign({}, e0, { form: noEmail(e0.form) });
    if (e.method !== 'GET') {
      return [
        '# This query is a POST request. In the browser, R can only make GET requests:',
        '# run it in a Python notebook – or on your own computer with httr2:',
        '# library(httr2)',
        `# resp <- request(${rStr(e.url)}) |>`,
        e.form ? `#   req_body_form(${Object.entries(e.form).map(([k, v]) => `${k} = ${rStr(v)}`).join(', ')}) |>` : `#   req_body_json(jsonlite::fromJSON(${rStr(JSON.stringify(e.json))})) |>`,
        '#   req_perform()',
        `# ${name} <- resp_body_${e.expect === 'json' ? 'json(resp)' : 'string(resp)'}`
      ].join('\n');
    }
    if (e.expect === 'json') return [`library(jsonlite)`, '', `${name} <- fromJSON(${rStr(e.url)})`, `str(${name}, max.level = 1)`].join('\n');
    return [`${name} <- readLines(${rStr(e.url)}, warn = FALSE)`, `cat(head(${name}, 30), sep = "\\n")`].join('\n');
  }

  /* ------------------------------------------------------------------
     pieces of a result
     ------------------------------------------------------------------ */
  const fmtNum = (v, d) => (v == null || v === '' || isNaN(v) ? '–' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: d == null ? 3 : d }));
  const fmtE = (v) => (v == null ? '–' : Number(v) < 1e-3 && Number(v) !== 0 ? Number(v).toExponential(1) : fmtNum(v, 3));
  function link(href, text) {
    return h('a', { href, target: '_blank', rel: 'noopener' }, text || href);
  }
  /** a sortable table. cols: [{key, label, fmt(row) → text|node, num}] */
  function table(cols, rows, opts = {}) {
    const t = h('table.table.small.api-table');
    const thead = h('thead', h('tr', cols.map((c, j) => {
      const th = h('th', { title: 'Click to sort' }, c.label);
      th.addEventListener('click', () => sortBy(j, th));
      return th;
    })));
    const tbody = h('tbody');
    let data = rows.slice();
    const fill = () => {
      tbody.innerHTML = '';
      data.slice(0, opts.max || 500).forEach((r) => {
        const tr = h('tr');
        cols.forEach((c) => {
          const v = c.fmt ? c.fmt(r) : r[c.key];
          tr.appendChild(h('td' + (c.num ? '.num' : ''), v instanceof Node ? v : v == null ? '–' : String(v)));
        });
        tbody.appendChild(tr);
      });
    };
    let by = -1, dir = 1;
    const sortBy = (j, th) => {
      dir = by === j ? -dir : 1;
      by = j;
      const c = cols[j];
      const val = (r) => (c.sort ? c.sort(r) : r[c.key]);
      data.sort((a, b) => {
        const x = val(a), y = val(b);
        if (c.num || (typeof x === 'number' && typeof y === 'number')) return ((Number(x) || 0) - (Number(y) || 0)) * dir;
        return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * dir;
      });
      thead.querySelectorAll('th').forEach((x) => x.removeAttribute('data-sort'));
      th.dataset.sort = dir > 0 ? '▲' : '▼';
      fill();
    };
    fill();
    t.append(thead, tbody);
    const box = h('div.api-tablebox', t);
    if (rows.length > (opts.max || 500)) box.appendChild(h('p.muted.small', `The first ${opts.max || 500} of ${rows.length} rows.`));
    return box;
  }
  /** rows → TSV text */
  function toTsv(cols, rows) {
    const clean = (v) => String(v == null ? '' : v).replace(/[\t\n\r]+/g, ' ');
    return cols.map((c) => c.label).join('\t') + '\n' + rows.map((r) => cols.map((c) => clean(c.text ? c.text(r) : c.fmt ? (c.fmt(r) instanceof Node ? c.fmt(r).textContent : c.fmt(r)) : r[c.key])).join('\t')).join('\n') + '\n';
  }
  function pre(text, max = 60000) {
    return h('pre.api-pre', text.length > max ? text.slice(0, max) + `\n… (${(text.length - max).toLocaleString('en-GB')} more characters – save the file to see it all)` : text);
  }

  /** save text or bytes among the user's files (asks for the name) → the path */
  async function saveFile(defName, content, opts = {}) {
    const fs = MG.app.fs;
    const dflt = (opts.folder || '~/data') + '/' + defName.replace(/[\/\\:*?"<>|\s]+/g, '_');
    const name = MG.promptText ? await MG.promptText('Save to my files', 'Where to save it (a path in your home folder ~):', dflt, 'Save') : window.prompt('Save as', dflt);
    if (!name) return null;
    const abs = fs.resolve(name);
    if (!abs.startsWith(MG.app.HOME + '/')) {
      toast('Files can only be saved in your home folder (~).', 'warn');
      return null;
    }
    fs.mkdirp(MG.path.dirname(abs));
    if (content instanceof Blob) fs.put(abs, { kind: 'blob', blob: content, size: content.size, fresh: true });
    else if (content instanceof Uint8Array) fs.put(abs, { kind: 'blob', blob: new Blob([content]), size: content.length, fresh: true });
    else fs.writeText(abs, String(content));
    const t = h('span', { html: `Saved <b>${esc(fs.pretty(abs))}</b>. ` });
    const open = h('button.linkbtn', { type: 'button' }, 'Show it');
    open.addEventListener('click', () => MG.app.revealFile(abs));
    t.appendChild(open);
    const id = 'sv' + Math.random().toString(36).slice(2);
    toast(`<span id="${id}"></span>`, 'ok', 5000);
    setTimeout(() => {
      const slot = document.getElementById(id);
      if (slot) slot.replaceWith(t);
    }, 0);
    bus.emit('api:saved', { path: abs });
    return abs;
  }

  /* ------------------------------------------------------------------
     the services
     form: {id, label, fields:[{name,label,type,options,value,placeholder,wide,help}], examples:[[label, values]], run(v, out) → result}
     result: {title, summary, nodes:[…], text, textName, table:{cols, rows, name}, json, actions:[[icon,label,fn]], code:{python, r}}
     ------------------------------------------------------------------ */
  const SPECIES = [
    ['homo_sapiens', 'Human (Homo sapiens)'], ['mus_musculus', 'Mouse (Mus musculus)'], ['rattus_norvegicus', 'Rat'], ['danio_rerio', 'Zebrafish'],
    ['gallus_gallus', 'Chicken'], ['drosophila_melanogaster', 'Fruit fly (Drosophila)'], ['caenorhabditis_elegans', 'Worm (C. elegans)'], ['saccharomyces_cerevisiae', 'Yeast (S. cerevisiae)']
  ];
  const TAXA = [['9606', 'Human'], ['10090', 'Mouse'], ['10116', 'Rat'], ['7955', 'Zebrafish'], ['7227', 'Fruit fly'], ['6239', 'C. elegans'], ['4932', 'Yeast (S. cerevisiae)'], ['3702', 'Arabidopsis'], ['511145', 'E. coli K-12']];
  const ENS = 'https://rest.ensembl.org';
  const ACC_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/i;

  const SERVICES = [
    /* ---------------- proteins ---------------- */
    {
      id: 'uniprot', group: 'Proteins', name: 'UniProt', by: 'UniProt Consortium', icon: 'database', explorer: true,
      blurb: 'Protein sequences and what is known about them: function, domains, variants, structures, cross-references.',
      docs: 'https://www.uniprot.org/help/api', help: 'h-db-uniprot'
    },
    {
      id: 'pdb', group: 'Proteins', name: 'Protein Data Bank', by: 'RCSB PDB', icon: 'cube', explorer: true,
      blurb: 'Experimentally determined 3D structures: search, read an entry, load it into the 3D viewer.',
      docs: 'https://www.rcsb.org/docs/programmatic-access', help: 'h-db-pdb'
    },
    {
      id: 'alphafold', group: 'Proteins', name: 'AlphaFold DB', by: 'EMBL-EBI & Google DeepMind', icon: 'sparkle',
      blurb: 'Predicted structures for almost every UniProt protein, with confidence (pLDDT) and predicted errors (PAE).',
      docs: 'https://alphafold.ebi.ac.uk/api-docs', help: 'h-db-proteins',
      forms: [{
        id: 'model', label: 'Model of a protein',
        fields: [{ name: 'acc', label: 'UniProt accession', placeholder: 'e.g. P69905', value: 'P69905' }],
        examples: [['Haemoglobin α (P69905)', { acc: 'P69905' }], ['TLR4 (O00206)', { acc: 'O00206' }], ['Spike protein (P0DTC2)', { acc: 'P0DTC2' }]],
        async run(v) {
          const acc = v.acc.trim().toUpperCase();
          const url = `https://alphafold.ebi.ac.uk/api/prediction/${enc(acc)}`;
          const data = await call({ url, service: 'AlphaFold DB', label: `model of ${acc}` });
          const models = Array.isArray(data) ? data : [data];
          const m = models[0] || {};
          const nodes = [];
          if (m.paeImageUrl) nodes.push(h('figure.api-fig', h('img', { src: m.paeImageUrl, alt: 'Predicted aligned error', loading: 'lazy' }), h('figcaption', 'Predicted aligned error (PAE): dark = confident about the relative position of two residues.')));
          const cols = [
            { key: 'entryId', label: 'Model' }, { key: 'gene', label: 'Gene' }, { key: 'uniprotDescription', label: 'Protein' },
            { key: 'organismScientificName', label: 'Organism' }, { key: 'globalMetricValue', label: 'Mean pLDDT', num: true, fmt: (r) => fmtNum(r.globalMetricValue, 1) },
            { key: 'latestVersion', label: 'Version' }
          ];
          return {
            title: `${m.uniprotDescription || acc} – AlphaFold model`,
            summary: `${m.organismScientificName || ''} · ${m.uniprotEnd ? m.uniprotEnd - (m.uniprotStart || 1) + 1 + ' residues · ' : ''}mean pLDDT ${fmtNum(m.globalMetricValue, 1)} (above 90: very high confidence; below 50: very low)`,
            table: { cols, rows: models, name: `alphafold_${acc}.tsv` },
            nodes,
            json: data,
            actions: [
              ['cube', 'Show in the 3D viewer', () => MG.app.viewerRun('load af ' + acc)],
              m.pdbUrl ? ['download', 'Save the model (.pdb) to my files', async () => saveFile(`${m.entryId || 'AF-' + acc}.pdb`, await call({ url: m.pdbUrl, expect: 'text', service: 'AlphaFold DB', label: `model file of ${acc}` }), { folder: '~/structures' })] : null,
              m.cifUrl ? ['download', 'Save the model (.cif)', async () => saveFile(`${m.entryId || 'AF-' + acc}.cif`, await call({ url: m.cifUrl, expect: 'text', service: 'AlphaFold DB', label: `model file of ${acc}` }), { folder: '~/structures' })] : null,
              ['external', 'Open at AlphaFold DB', () => window.open(`https://alphafold.ebi.ac.uk/entry/${enc(acc)}`, '_blank', 'noopener')]
            ],
            code: {
              python: `import requests\n\nacc = ${pyStr(acc)}\nmodels = requests.get(f"https://alphafold.ebi.ac.uk/api/prediction/{acc}").json()\nm = models[0]\nprint(m["entryId"], m["uniprotDescription"], "mean pLDDT", m["globalMetricValue"])\n\n# the model itself (PDB format): save it next to the notebook\npdb = requests.get(m["pdbUrl"]).text\nwith open(f"{m['entryId']}.pdb", "w") as fh:\n    fh.write(pdb)`,
              r: `library(jsonlite)\n\nacc <- ${rStr(acc)}\nmodels <- fromJSON(paste0("https://alphafold.ebi.ac.uk/api/prediction/", acc))\nmodels[, c("entryId", "uniprotDescription", "globalMetricValue")]\n# download.file(models$pdbUrl[1], paste0(models$entryId[1], ".pdb"))`
            }
          };
        }
      }]
    },
    {
      id: 'interpro', group: 'Proteins', name: 'InterPro', by: 'EMBL-EBI', icon: 'layers',
      blurb: 'Protein families, domains and important sites (Pfam, PROSITE, SMART …) of a protein, drawn along its sequence.',
      docs: 'https://interpro-documentation.readthedocs.io/en/latest/download.html#api', help: 'h-db-proteins',
      forms: [{
        id: 'domains', label: 'Domains of a protein',
        fields: [
          { name: 'acc', label: 'UniProt accession', placeholder: 'e.g. P04637', value: 'P04637' },
          { name: 'db', label: 'Signatures from', type: 'select', options: [['interpro', 'InterPro entries'], ['pfam', 'Pfam'], ['smart', 'SMART'], ['prosite', 'PROSITE profiles'], ['cdd', 'CDD']], value: 'interpro' }
        ],
        examples: [['p53 (P04637)', { acc: 'P04637' }], ['TLR4 (O00206)', { acc: 'O00206' }], ['BRCA2 (P51587)', { acc: 'P51587', db: 'pfam' }]],
        async run(v) {
          const acc = v.acc.trim().toUpperCase();
          const url = `https://www.ebi.ac.uk/interpro/api/entry/${v.db}/protein/uniprot/${enc(acc)}?page_size=100`;
          const data = await call({ url, service: 'InterPro', label: `${v.db} signatures of ${acc}` });
          const res = (data && data.results) || [];
          let len = 0;
          const rows = res.map((x) => {
            const p = (x.proteins || [])[0] || {};
            len = Math.max(len, p.protein_length || 0);
            const frags = (p.entry_protein_locations || []).flatMap((l) => l.fragments || []);
            return { acc: x.metadata.accession, name: x.metadata.name, type: x.metadata.type, db: x.metadata.source_database, frags, where: frags.map((f) => `${f.start}–${f.end}`).join(', ') };
          });
          const nodes = [];
          if (rows.length && len) nodes.push(domainSvg(rows, len));
          const cols = [
            { key: 'acc', label: 'Entry', fmt: (r) => link(`https://www.ebi.ac.uk/interpro/entry/${r.db === 'interpro' ? 'InterPro' : r.db}/${r.acc}/`, r.acc), text: (r) => r.acc },
            { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'where', label: 'Positions' }
          ];
          return {
            title: `${rows.length} ${v.db === 'interpro' ? 'InterPro entries' : v.db + ' signatures'} in ${acc}`,
            summary: len ? `Protein length ${len} amino acids.` : 'No signatures found.',
            nodes,
            table: { cols, rows, name: `interpro_${acc}.tsv` },
            json: data,
            actions: [['external', 'Open at InterPro', () => window.open(`https://www.ebi.ac.uk/interpro/protein/UniProt/${enc(acc)}/`, '_blank', 'noopener')]],
            code: {
              python: `import requests\nimport pandas as pd\n\nacc = ${pyStr(acc)}\ndata = requests.get(f"https://www.ebi.ac.uk/interpro/api/entry/${v.db}/protein/uniprot/{acc}?page_size=100").json()\nrows = []\nfor x in data["results"]:\n    for loc in x["proteins"][0]["entry_protein_locations"]:\n        for f in loc["fragments"]:\n            rows.append({"entry": x["metadata"]["accession"], "name": x["metadata"]["name"], "type": x["metadata"]["type"], "start": f["start"], "end": f["end"]})\npd.DataFrame(rows)`,
              r: `library(jsonlite)\n\nacc <- ${rStr(acc)}\ndata <- fromJSON(paste0("https://www.ebi.ac.uk/interpro/api/entry/${v.db}/protein/uniprot/", acc, "?page_size=100"))\ndata$results$metadata[, c("accession", "name", "type")]`
            }
          };
        }
      }]
    },
    /* ---------------- genes and genomes ---------------- */
    {
      id: 'ensembl', group: 'Genes and genomes', name: 'Ensembl', by: 'EMBL-EBI', icon: 'genome',
      blurb: 'Genes, transcripts and their sequences; the effect of variants (VEP); orthologues; what lies in a region.',
      docs: 'https://rest.ensembl.org', help: 'h-db-genes',
      forms: [
        {
          id: 'gene', label: 'Gene',
          fields: [{ name: 'species', label: 'Species', type: 'select', options: SPECIES, value: 'homo_sapiens' }, { name: 'q', label: 'Gene symbol or Ensembl ID', placeholder: 'e.g. BRCA2 or ENSG00000139618', value: 'CYP2C19' }],
          examples: [['CYP2C19', { q: 'CYP2C19' }], ['TP53', { q: 'TP53' }], ['Mouse Pax6', { species: 'mus_musculus', q: 'Pax6' }], ['Yeast GAL4', { species: 'saccharomyces_cerevisiae', q: 'GAL4' }]],
          async run(v) {
            const q = v.q.trim();
            const url = /^ENS[A-Z]*G\d+/i.test(q) ? `${ENS}/lookup/id/${enc(q)}?expand=1;content-type=application/json` : `${ENS}/lookup/symbol/${v.species}/${enc(q)}?expand=1;content-type=application/json`;
            const g = await call({ url, service: 'Ensembl', label: `gene ${q}` });
            const tr = (g.Transcript || []).map((t) => ({ id: t.id, name: t.display_name, biotype: t.biotype, start: t.start, end: t.end, canonical: t.is_canonical ? 'yes' : '', protein: t.Translation ? t.Translation.length : null, exons: (t.Exon || []).length }));
            tr.sort((a, b) => (b.canonical ? 1 : 0) - (a.canonical ? 1 : 0));
            const loc = `${g.seq_region_name}:${g.start}-${g.end}`;
            const seqBtn = (id, type, label) => {
              const b = h('button.btn.small', { type: 'button' }, label);
              b.addEventListener('click', async () => {
                const fa = await call({ url: `${ENS}/sequence/id/${enc(id)}?type=${type};content-type=text/x-fasta`, expect: 'text', service: 'Ensembl', label: `${type} sequence of ${id}` });
                saveFile(`${g.display_name || id}_${id}_${type}.fasta`, fa);
              });
              return b;
            };
            const cols = [
              { key: 'id', label: 'Transcript', fmt: (r) => link(`https://www.ensembl.org/id/${r.id}`, r.id), text: (r) => r.id },
              { key: 'name', label: 'Name' }, { key: 'biotype', label: 'Biotype' }, { key: 'canonical', label: 'Canonical' },
              { key: 'exons', label: 'Exons', num: true }, { key: 'protein', label: 'Protein (aa)', num: true },
              { key: 'seq', label: 'Sequence', fmt: (r) => h('span.api-btns', seqBtn(r.id, 'cdna', 'cDNA'), r.protein ? seqBtn(r.id, 'cds', 'CDS') : null, r.protein ? seqBtn(r.id, 'protein', 'protein') : null), text: () => '' }
            ];
            return {
              title: `${g.display_name} – ${(g.description || '').replace(/\s*\[Source.*$/, '')}`,
              summary: `${g.id} · ${g.biotype} · chromosome ${loc} (${g.strand > 0 ? '+' : '−'} strand) · ${g.assembly_name || ''} · ${tr.length} transcript${tr.length === 1 ? '' : 's'}`,
              table: { cols, rows: tr, name: `${g.display_name}_transcripts.tsv` },
              json: g,
              actions: [
                ['dna', 'Save the gene sequence (FASTA)', async () => saveFile(`${g.display_name}_${g.id}_genomic.fasta`, await call({ url: `${ENS}/sequence/id/${enc(g.id)}?type=genomic;content-type=text/x-fasta`, expect: 'text', service: 'Ensembl', label: `genomic sequence of ${g.id}` }))],
                g.species === 'homo_sapiens' ? ['genome', 'Show in the Genome browser (GRCh38)', () => MG.app.igvGoto && MG.app.igvGoto(`chr${loc}`, 'hg38')] : null,
                ['external', 'Open at Ensembl', () => window.open(`https://www.ensembl.org/id/${g.id}`, '_blank', 'noopener')]
              ],
              code: {
                python: `import requests\nimport pandas as pd\n\nserver = "https://rest.ensembl.org"\ngene = requests.get(f"{server}/lookup/symbol/${v.species}/${q}?expand=1", headers={"Content-Type": "application/json"}).json()\nprint(gene["id"], gene["seq_region_name"], gene["start"], gene["end"], gene["strand"])\ntranscripts = pd.DataFrame([{"id": t["id"], "name": t["display_name"], "biotype": t["biotype"], "canonical": t["is_canonical"], "protein_length": t.get("Translation", {}).get("length")} for t in gene["Transcript"]])\ntranscripts\n\n# the protein sequence of the canonical transcript (FASTA)\ncanonical = next(t for t in gene["Transcript"] if t["is_canonical"])\nprint(requests.get(f"{server}/sequence/id/{canonical['id']}?type=protein", headers={"Content-Type": "text/x-fasta"}).text)`,
                r: `library(jsonlite)\n\ngene <- fromJSON("https://rest.ensembl.org/lookup/symbol/${v.species}/${q}?expand=1;content-type=application/json")\ngene[c("id", "seq_region_name", "start", "end", "strand")]\ngene$Transcript[, c("id", "display_name", "biotype", "is_canonical")]`
              }
            };
          }
        },
        {
          id: 'seq', label: 'Sequence',
          fields: [
            { name: 'id', label: 'Ensembl ID (gene, transcript or protein)', placeholder: 'e.g. ENST00000371321', value: 'ENST00000371321' },
            { name: 'type', label: 'Type', type: 'select', options: [['genomic', 'genomic'], ['cdna', 'cDNA (transcript)'], ['cds', 'CDS (coding)'], ['protein', 'protein']], value: 'cds' },
            { name: 'flank', label: 'Extra bases on each side (genomic only)', type: 'number', value: '0' }
          ],
          examples: [['CYP2C19 CDS', { id: 'ENST00000371321', type: 'cds' }], ['CYP2C19 protein', { id: 'ENST00000371321', type: 'protein' }], ['BRCA2 gene ± 500', { id: 'ENSG00000139618', type: 'genomic', flank: '500' }]],
          async run(v) {
            const f = Math.max(0, parseInt(v.flank, 10) || 0);
            const url = `${ENS}/sequence/id/${enc(v.id.trim())}?type=${v.type}${f && v.type === 'genomic' ? `;expand_5prime=${f};expand_3prime=${f}` : ''};content-type=text/x-fasta`;
            const fa = await call({ url, expect: 'text', service: 'Ensembl', label: `${v.type} sequence of ${v.id}` });
            const len = fa.split('\n').filter((l) => !l.startsWith('>')).join('').length;
            return {
              title: `${v.type} sequence of ${v.id.trim()}`,
              summary: `${len.toLocaleString('en-GB')} ${v.type === 'protein' ? 'amino acids' : 'bases'}`,
              text: fa,
              textName: `${v.id.trim()}_${v.type}.fasta`,
              code: {
                python: `import requests\nfrom io import StringIO\nfrom Bio import SeqIO\n\nr = requests.get(${pyStr(url.replace(';content-type=text/x-fasta', ''))}, headers={"Content-Type": "text/x-fasta"})\nrecord = SeqIO.read(StringIO(r.text), "fasta")\nprint(record.id, len(record.seq))\nrecord.seq`,
                r: `fa <- readLines(${rStr(url)}, warn = FALSE)\nseq <- paste(fa[-1], collapse = "")\nnchar(seq)\nsubstr(seq, 1, 60)`
              }
            };
          }
        },
        {
          id: 'vep', label: 'Variant effect (VEP)',
          fields: [
            { name: 'q', label: 'Variant: rs ID, HGVS, or "chromosome position ref alt" (GRCh38)', placeholder: 'rs4244285 · ENST00000371321.3:c.681G>A · 10 94781859 G A', value: 'rs4244285', wide: true }
          ],
          examples: [['rs4244285 (CYP2C19*2)', { q: 'rs4244285' }], ['BRAF V600E (HGVS)', { q: 'ENST00000646891.2:c.1799T>A' }], ['HBB sickle cell', { q: 'rs334' }], ['A position', { q: '17 7675088 C T' }]],
          async run(v) {
            const q = v.q.trim();
            const opts = 'canonical=1;hgvs=1;af=1;af_gnomadg=1;numbers=1;variant_class=1;protein=1';
            let data, label = `VEP for ${q}`, url, req;
            const m = /^(?:chr)?(\w+)[\s:]+(\d+)[\s:]+([ACGTN-]+)[\s:>/]+([ACGTN-]+)$/i.exec(q);
            if (m) {
              url = `${ENS}/vep/homo_sapiens/region?content-type=application/json;${opts}`;
              req = { method: 'POST', url, json: { variants: [`${m[1]} ${m[2]} . ${m[3].toUpperCase()} ${m[4].toUpperCase()} . . .`] }, headers: { Accept: 'application/json' }, service: 'Ensembl', label };
            } else if (/^rs\d+$/i.test(q)) url = `${ENS}/vep/human/id/${enc(q)}?content-type=application/json;${opts}`;
            else url = `${ENS}/vep/human/hgvs/${enc(q)}?content-type=application/json;${opts}`;
            data = await call(req || { url, service: 'Ensembl', label });
            const x = (data || [])[0] || {};
            const tc = (x.transcript_consequences || []).map((t) => ({
              gene: t.gene_symbol, transcript: t.transcript_id, canonical: t.canonical ? 'yes' : '', consequence: (t.consequence_terms || []).join(', '), impact: t.impact,
              aa: t.amino_acids || '', pos: t.protein_start || '', codons: t.codons || '', hgvsp: t.hgvsp || '', sift: t.sift_prediction ? `${t.sift_prediction} (${t.sift_score})` : '', polyphen: t.polyphen_prediction ? `${t.polyphen_prediction} (${t.polyphen_score})` : ''
            }));
            tc.sort((a, b) => (b.canonical ? 1 : 0) - (a.canonical ? 1 : 0));
            const co = (x.colocated_variants || []).filter((c) => c.id);
            const freqs = [];
            co.forEach((c) => Object.entries(c.frequencies || {}).forEach(([allele, f]) => Object.entries(f).forEach(([pop, val]) => freqs.push({ id: c.id, allele, pop, val }))));
            const nodes = [];
            if (co.length) nodes.push(h('p.api-note', 'Known variant here: ', co.slice(0, 5).map((c, i) => [i ? ', ' : '', link(/^rs/.test(c.id) ? `https://www.ncbi.nlm.nih.gov/snp/${c.id}` : `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=${c.id}`, c.id), c.clin_sig ? ` (${c.clin_sig.join(', ')})` : ''])));
            if (freqs.length) {
              const top = freqs.filter((f) => /^(af|gnomadg|gnomadg_afr|gnomadg_eas|gnomadg_nfe|gnomadg_sas|gnomadg_amr)$/.test(f.pop));
              if (top.length) nodes.push(table([{ key: 'id', label: 'Variant' }, { key: 'allele', label: 'Allele' }, { key: 'pop', label: 'Population' }, { key: 'val', label: 'Allele frequency', num: true, fmt: (r) => fmtNum(r.val, 4) }], top));
            }
            const cols = [
              { key: 'gene', label: 'Gene' }, { key: 'transcript', label: 'Transcript' }, { key: 'canonical', label: 'Canonical' }, { key: 'consequence', label: 'Consequence' },
              { key: 'impact', label: 'Impact' }, { key: 'aa', label: 'Amino acids' }, { key: 'pos', label: 'Protein position', num: true }, { key: 'sift', label: 'SIFT' }, { key: 'polyphen', label: 'PolyPhen' }
            ];
            return {
              title: `${q}: ${String(x.most_severe_consequence || 'no consequence found').replace(/_/g, ' ')}`,
              summary: x.seq_region_name ? `GRCh38 ${x.seq_region_name}:${x.start}${x.end !== x.start ? '-' + x.end : ''} · allele ${x.allele_string || ''} · ${tc.length} transcript consequences` : '',
              nodes,
              table: { cols, rows: tc, name: `vep_${q.replace(/\W+/g, '_')}.tsv` },
              json: data,
              code: req
                ? { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data[0]["transcript_consequences"])', r: rRequest(LOG[LOG.length - 1]) }
                : {
                    python: `import requests\nimport pandas as pd\n\nr = requests.get(${pyStr(url)})\nr.raise_for_status()\nvep = r.json()[0]\nprint(vep["most_severe_consequence"])\npd.DataFrame(vep["transcript_consequences"])[["gene_symbol", "transcript_id", "consequence_terms", "impact", "amino_acids", "protein_start"]]`,
                    r: `library(jsonlite)\n\nvep <- fromJSON(${rStr(url)})\nvep$most_severe_consequence\nvep$transcript_consequences[[1]][, c("gene_symbol", "transcript_id", "impact")]`
                  }
            };
          }
        },
        {
          id: 'orth', label: 'Orthologues',
          fields: [{ name: 'q', label: 'Human gene symbol', value: 'TP53' }, { name: 'target', label: 'In', type: 'select', options: [['', 'all species (many)']].concat(SPECIES.filter((s) => s[0] !== 'homo_sapiens')), value: 'mus_musculus' }],
          examples: [['TP53 in mouse', { q: 'TP53', target: 'mus_musculus' }], ['PAX6 in zebrafish', { q: 'PAX6', target: 'danio_rerio' }]],
          async run(v) {
            const url = `${ENS}/homology/symbol/human/${enc(v.q.trim())}?type=orthologues;format=condensed${v.target ? ';target_species=' + v.target : ''};content-type=application/json`;
            const data = await call({ url, service: 'Ensembl', label: `orthologues of ${v.q}`, timeout: 90000 });
            const hs = (((data || {}).data || [])[0] || {}).homologies || [];
            const rows = hs.map((x) => ({ species: x.species, id: x.id, type: (x.type || '').replace(/_/g, ' '), protein: x.protein_id }));
            return {
              title: `${rows.length} orthologue${rows.length === 1 ? '' : 's'} of ${v.q.trim()}`,
              table: { cols: [{ key: 'species', label: 'Species' }, { key: 'id', label: 'Gene', fmt: (r) => link(`https://www.ensembl.org/id/${r.id}`, r.id), text: (r) => r.id }, { key: 'type', label: 'Relationship' }, { key: 'protein', label: 'Protein' }], rows, name: `orthologues_${v.q}.tsv` },
              json: data,
              code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data["data"][0]["homologies"])', r: rRequest(LOG[LOG.length - 1]) }
            };
          }
        },
        {
          id: 'region', label: 'Genes in a region',
          fields: [{ name: 'species', label: 'Species', type: 'select', options: SPECIES, value: 'homo_sapiens' }, { name: 'region', label: 'Region (chromosome:start-end, at most 5 Mb)', value: '10:94750000-94900000' }],
          examples: [['Around CYP2C19 (GRCh38)', { region: '10:94750000-94900000' }], ['HLA region (part)', { region: '6:29900000-30100000' }]],
          async run(v) {
            const reg = v.region.replace(/^chr/i, '').replace(/,/g, '').trim();
            const url = `${ENS}/overlap/region/${v.species}/${enc(reg)}?feature=gene;content-type=application/json`;
            const data = await call({ url, service: 'Ensembl', label: `genes in ${reg}` });
            const rows = (data || []).map((g) => ({ id: g.id, name: g.external_name || '', biotype: g.biotype, start: g.start, end: g.end, strand: g.strand > 0 ? '+' : '−', desc: (g.description || '').replace(/\s*\[Source.*$/, '') }));
            return {
              title: `${rows.length} genes in ${reg}`,
              table: {
                cols: [{ key: 'id', label: 'Gene', fmt: (r) => link(`https://www.ensembl.org/id/${r.id}`, r.id), text: (r) => r.id }, { key: 'name', label: 'Name' }, { key: 'biotype', label: 'Biotype' }, { key: 'start', label: 'Start', num: true, fmt: (r) => fmtNum(r.start, 0) }, { key: 'end', label: 'End', num: true, fmt: (r) => fmtNum(r.end, 0) }, { key: 'strand', label: 'Strand' }, { key: 'desc', label: 'Description' }],
                rows, name: `genes_${reg.replace(/\W+/g, '_')}.tsv`
              },
              json: data,
              code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data)[["id", "external_name", "biotype", "start", "end", "strand"]]', r: rRequest(LOG[LOG.length - 1]) }
            };
          }
        }
      ]
    },
    {
      id: 'ncbi', group: 'Genes and genomes', name: 'NCBI', by: 'NCBI E-utilities', icon: 'search',
      blurb: 'Search Gene, Nucleotide, Protein, PubMed, dbSNP, ClinVar and Taxonomy; download sequences as FASTA or GenBank.',
      docs: 'https://www.ncbi.nlm.nih.gov/books/NBK25501/', help: 'h-db-genes',
      forms: [
        {
          id: 'search', label: 'Search',
          fields: [
            { name: 'db', label: 'Database', type: 'select', options: [['gene', 'Gene'], ['nuccore', 'Nucleotide'], ['protein', 'Protein'], ['pubmed', 'PubMed'], ['snp', 'dbSNP'], ['clinvar', 'ClinVar'], ['taxonomy', 'Taxonomy'], ['assembly', 'Assembly']], value: 'gene' },
            { name: 'term', label: 'Search terms (Entrez syntax works: BRCA2[sym] AND human[orgn])', value: 'CYP2C19[sym] AND human[orgn]', wide: true },
            { name: 'n', label: 'At most', type: 'select', options: [['10', '10'], ['20', '20'], ['50', '50']], value: '20' }
          ],
          examples: [['Gene CYP2C19', { db: 'gene', term: 'CYP2C19[sym] AND human[orgn]' }], ['Myoglobin proteins (RefSeq)', { db: 'protein', term: 'myoglobin[title] AND refseq[filter]' }], ['ClinVar BRCA2', { db: 'clinvar', term: 'BRCA2[gene] AND pathogenic[clinsig]' }], ['PubMed', { db: 'pubmed', term: 'clopidogrel CYP2C19 genotype' }]],
          async run(v) {
            const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
            const s = await call({ url: `${base}/esearch.fcgi?db=${v.db}&term=${enc(v.term)}&retmax=${v.n}&retmode=json`, service: 'NCBI', label: `search ${v.db}: ${v.term}` });
            const ids = (s.esearchresult && s.esearchresult.idlist) || [];
            const count = Number((s.esearchresult && s.esearchresult.count) || 0);
            let rows = [];
            if (ids.length) {
              const sum = await call({ url: `${base}/esummary.fcgi?db=${v.db}&id=${ids.join(',')}&retmode=json`, service: 'NCBI', label: `summaries (${v.db})` });
              const res = sum.result || {};
              rows = (res.uids || ids).map((u) => res[u] || { uid: u });
            }
            const cols = ncbiCols(v.db);
            return {
              title: `${count.toLocaleString('en-GB')} record${count === 1 ? '' : 's'} in NCBI ${v.db}`,
              summary: count > ids.length ? `Showing the first ${ids.length}.` : '',
              table: { cols, rows, name: `ncbi_${v.db}.tsv` },
              json: rows,
              code: {
                python: `import requests\nimport pandas as pd\n\nbase = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"\nsearch = requests.get(f"{base}/esearch.fcgi", params={"db": ${pyStr(v.db)}, "term": ${pyStr(v.term)}, "retmax": ${v.n}, "retmode": "json"}).json()\nids = search["esearchresult"]["idlist"]\nsummary = requests.get(f"{base}/esummary.fcgi", params={"db": ${pyStr(v.db)}, "id": ",".join(ids), "retmode": "json"}).json()["result"]\nrecords = pd.DataFrame([summary[u] for u in summary["uids"]])\nrecords.head()`,
                r: `library(jsonlite)\n\nbase <- "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"\nsearch <- fromJSON(paste0(base, "/esearch.fcgi?db=${v.db}&retmode=json&retmax=${v.n}&term=", URLencode(${rStr(v.term)}, reserved = TRUE)))\nids <- search$esearchresult$idlist\nsummary <- fromJSON(paste0(base, "/esummary.fcgi?db=${v.db}&retmode=json&id=", paste(ids, collapse = ",")))\nstr(summary$result[[ids[1]]], max.level = 1)`
              }
            };
          }
        },
        {
          id: 'fetch', label: 'Download sequences',
          fields: [
            { name: 'db', label: 'Database', type: 'select', options: [['nuccore', 'Nucleotide'], ['protein', 'Protein']], value: 'nuccore' },
            { name: 'ids', label: 'Accessions or IDs (separated by commas)', placeholder: 'e.g. NM_000769.4, J01749.1', value: 'NM_000769.4', wide: true },
            { name: 'fmt', label: 'Format', type: 'select', options: [['fasta', 'FASTA'], ['gb', 'GenBank (nucleotide)'], ['gp', 'GenPept (protein)']], value: 'fasta' }
          ],
          examples: [['CYP2C19 mRNA', { db: 'nuccore', ids: 'NM_000769.4', fmt: 'fasta' }], ['pBR322 (GenBank)', { db: 'nuccore', ids: 'J01749.1', fmt: 'gb' }], ['Myoglobins', { db: 'protein', ids: 'NP_005359.1, NP_038621.2', fmt: 'fasta' }]],
          async run(v) {
            const ids = v.ids.split(/[\s,;]+/).filter(Boolean).join(',');
            const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=${v.db}&id=${enc(ids)}&rettype=${v.fmt}&retmode=text`;
            const text = await call({ url, expect: 'text', service: 'NCBI', label: `${v.fmt} of ${ids}` });
            const n = v.fmt === 'fasta' ? (text.match(/^>/gm) || []).length : (text.match(/^LOCUS/gm) || []).length;
            return {
              title: `${n} record${n === 1 ? '' : 's'} (${v.fmt === 'fasta' ? 'FASTA' : 'GenBank'})`,
              text,
              textName: ids.split(',')[0].replace(/\W+/g, '_') + (v.fmt === 'fasta' ? '.fasta' : '.gb'),
              code: {
                python: `import requests\nfrom io import StringIO\nfrom Bio import SeqIO\n\nr = requests.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", params={"db": ${pyStr(v.db)}, "id": ${pyStr(ids)}, "rettype": ${pyStr(v.fmt)}, "retmode": "text"})\nrecords = list(SeqIO.parse(StringIO(r.text), ${pyStr(v.fmt === 'fasta' ? 'fasta' : 'genbank')}))\nfor rec in records:\n    print(rec.id, len(rec.seq), rec.description[:60])`,
                r: `text <- readLines(${rStr(url)}, warn = FALSE)\ncat(head(text, 20), sep = "\\n")`
              }
            };
          }
        }
      ]
    },
    {
      id: 'ucsc', group: 'Genes and genomes', name: 'UCSC Genome Browser', by: 'UC Santa Cruz', icon: 'dna',
      blurb: 'The DNA sequence of any region of a genome assembly (hg38, hg19, mouse, yeast, fly …).',
      docs: 'https://genome.ucsc.edu/goldenPath/help/api.html', help: 'h-db-genes',
      forms: [{
        id: 'dna', label: 'DNA of a region',
        fields: [
          { name: 'genome', label: 'Assembly', type: 'select', options: [['hg38', 'Human hg38 (GRCh38)'], ['hg19', 'Human hg19 (GRCh37)'], ['mm39', 'Mouse mm39'], ['mm10', 'Mouse mm10'], ['danRer11', 'Zebrafish danRer11'], ['dm6', 'Fly dm6'], ['ce11', 'Worm ce11'], ['sacCer3', 'Yeast sacCer3']], value: 'hg19' },
          { name: 'region', label: 'Region (chr:start-end, 1-based, at most 1 Mb)', value: 'chr10:96541580-96541650', wide: true }
        ],
        examples: [['CYP2C19*2 (hg19)', { genome: 'hg19', region: 'chr10:96541580-96541650' }], ['TP53 exon 5 (hg38)', { genome: 'hg38', region: 'chr17:7675994-7676272' }], ['Yeast GAL1-10 promoter', { genome: 'sacCer3', region: 'chrII:278352-279021' }]],
        async run(v) {
          const m = /^(\w+):([\d,]+)-([\d,]+)$/.exec(v.region.trim());
          if (!m) throw new ApiError('Write the region as chr:start-end, e.g. chr10:96541580-96541650');
          const start = Number(m[2].replace(/,/g, '')), end = Number(m[3].replace(/,/g, ''));
          if (end - start > 1e6) throw new ApiError('At most 1,000,000 bases at a time.');
          const url = `https://api.genome.ucsc.edu/getData/sequence?genome=${v.genome};chrom=${m[1]};start=${start - 1};end=${end}`;
          const d = await call({ url, service: 'UCSC', label: `DNA of ${v.region} (${v.genome})` });
          const dna = (d && d.dna) || '';
          const fa = `>${v.genome}_${m[1]}:${start}-${end}\n` + dna.match(/.{1,60}/g).join('\n') + '\n';
          return {
            title: `${v.genome} ${m[1]}:${start.toLocaleString('en-GB')}-${end.toLocaleString('en-GB')}`,
            summary: `${dna.length.toLocaleString('en-GB')} bases · lower case = repeats (soft-masked)`,
            text: fa,
            textName: `${v.genome}_${m[1]}_${start}-${end}.fasta`,
            actions: /^hg(19|38)$/.test(v.genome) ? [['genome', 'Show this region in the Genome browser', () => MG.app.igvGoto && MG.app.igvGoto(`${m[1]}:${start}-${end}`, v.genome)]] : [],
            code: {
              python: `import requests\n\nd = requests.get("https://api.genome.ucsc.edu/getData/sequence", params={"genome": ${pyStr(v.genome)}, "chrom": ${pyStr(m[1])}, "start": ${start - 1}, "end": ${end}}).json()\ndna = d["dna"]   # (the API counts from 0: start ${start - 1} is position ${start})\nprint(len(dna), dna[:60])`,
              r: `library(jsonlite)\n\nd <- fromJSON(${rStr(url)})\nnchar(d$dna)\nsubstr(d$dna, 1, 60)`
            }
          };
        }
      }]
    },
    {
      id: 'ena', group: 'Genes and genomes', name: 'European Nucleotide Archive', by: 'EMBL-EBI', icon: 'layers',
      blurb: 'Sequencing runs (FASTQ files) of public studies, and any sequence by accession.',
      docs: 'https://www.ebi.ac.uk/ena/portal/api/', help: 'h-db-genes',
      forms: [
        {
          id: 'runs', label: 'Sequencing runs',
          fields: [{ name: 'q', label: 'Study, sample or run accession – or an ENA query', placeholder: 'PRJEB37886 · SRR098401 · tax_eq(9606) AND library_strategy="AMPLICON"', value: 'SRR098401', wide: true }],
          examples: [['A run of NA12878', { q: 'SRR098401' }], ['A SARS-CoV-2 study', { q: 'PRJEB37886' }]],
          async run(v) {
            const q = v.q.trim();
            const fields = 'run_accession,sample_accession,study_accession,scientific_name,instrument_model,library_strategy,library_layout,read_count,base_count,fastq_ftp,fastq_bytes';
            let query;
            if (/^(PRJ[EDN][A-Z]\d+|[EDS]RP\d+)$/i.test(q)) query = `study_accession="${q}"`;
            else if (/^[EDS]R[RX]\d+$/i.test(q)) query = `run_accession="${q}"`;
            else if (/^(SAM[EDN][A-Z]?\d+|[EDS]RS\d+)$/i.test(q)) query = `sample_accession="${q}"`;
            else query = q;
            const url = `https://www.ebi.ac.uk/ena/portal/api/search?result=read_run&query=${enc(query)}&fields=${fields}&limit=50&format=json`;
            const data = await call({ url, service: 'ENA', label: `runs: ${q}` });
            const rows = data || [];
            const fq = (r) => {
              const files = String(r.fastq_ftp || '').split(';').filter(Boolean);
              const sizes = String(r.fastq_bytes || '').split(';');
              return h('span.api-btns', files.map((f, i) => {
                const b = h('button.btn.small', { type: 'button', title: 'Download into your files (through the browser)' }, `${f.split('/').pop()} (${MG.humanSize(Number(sizes[i]) || 0)}B)`);
                b.addEventListener('click', async () => {
                  const n = Number(sizes[i]) || 0;
                  if (n > 300e6 && !window.confirm(`This file is ${MG.humanSize(n)}B. Downloading it into the browser may take long and fill its storage. Go on?`)) return;
                  b.disabled = true;
                  b.textContent = 'downloading…';
                  try {
                    const blob = await call({ url: 'https://' + f, expect: 'blob', service: 'ENA', label: `FASTQ ${f.split('/').pop()}`, timeout: 1800000 });
                    await saveFile(f.split('/').pop(), blob, { folder: '~/reads' });
                  } catch (e) {
                    toast(esc(e.message), 'error');
                  } finally {
                    b.disabled = false;
                    b.textContent = `${f.split('/').pop()} (${MG.humanSize(n)}B)`;
                  }
                });
                return b;
              }));
            };
            return {
              title: `${rows.length} run${rows.length === 1 ? '' : 's'}`,
              summary: rows.length === 50 ? 'Showing the first 50.' : '',
              table: {
                cols: [
                  { key: 'run_accession', label: 'Run', fmt: (r) => link(`https://www.ebi.ac.uk/ena/browser/view/${r.run_accession}`, r.run_accession), text: (r) => r.run_accession },
                  { key: 'scientific_name', label: 'Organism' }, { key: 'instrument_model', label: 'Instrument' }, { key: 'library_strategy', label: 'Strategy' }, { key: 'library_layout', label: 'Layout' },
                  { key: 'read_count', label: 'Reads', num: true, fmt: (r) => fmtNum(r.read_count, 0) }, { key: 'fastq_ftp', label: 'FASTQ files', fmt: fq, text: (r) => r.fastq_ftp }
                ],
                rows, name: `ena_runs_${q.replace(/\W+/g, '_')}.tsv`
              },
              json: data,
              code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data)', r: rRequest(LOG[LOG.length - 1]) }
            };
          }
        },
        {
          id: 'seq', label: 'Sequence by accession',
          fields: [{ name: 'acc', label: 'ENA/GenBank accession', placeholder: 'e.g. MN908947.3', value: 'MN908947.3' }],
          examples: [['SARS-CoV-2 genome', { acc: 'MN908947.3' }], ['pBR322', { acc: 'J01749' }]],
          async run(v) {
            const url = `https://www.ebi.ac.uk/ena/browser/api/fasta/${enc(v.acc.trim())}`;
            const text = await call({ url, expect: 'text', service: 'ENA', label: `FASTA of ${v.acc}` });
            const len = text.split('\n').filter((l) => !l.startsWith('>')).join('').length;
            return { title: text.split('\n')[0].slice(1, 120), summary: `${len.toLocaleString('en-GB')} bases`, text, textName: v.acc.trim() + '.fasta', code: { python: pyRequest(LOG[LOG.length - 1], 'fasta'), r: rRequest(LOG[LOG.length - 1], 'fasta') } };
          }
        }
      ]
    },
    /* ---------------- sequence analysis ---------------- */
    {
      id: 'blast', group: 'Sequence searches', name: 'BLAST', by: 'EMBL-EBI Job Dispatcher', icon: 'search',
      blurb: 'Find similar sequences in UniProt, the PDB or ENA. The search runs at EBI and takes from seconds to a few minutes.',
      docs: 'https://www.ebi.ac.uk/jdispatcher/sss/ncbiblast', help: 'h-db-blast', job: true,
      forms: [{
        id: 'blast', label: 'BLAST search',
        fields: [
          { name: 'program', label: 'Program', type: 'select', options: [['blastp', 'blastp – protein vs protein'], ['blastn', 'blastn – DNA vs DNA'], ['blastx', 'blastx – translated DNA vs protein'], ['tblastn', 'tblastn – protein vs translated DNA']], value: 'blastp' },
          { name: 'database', label: 'Database', type: 'select', options: [], value: 'uniprotkb_swissprot' },
          { name: 'sequence', label: 'Sequence (FASTA or just the letters)', type: 'textarea', wide: true, value: '>unknown_myoglobin\nMGLSDGEWQLVLNVWGKVEADIPGHGQEVLIRLFKGHPETLEKFDKFKHLKSEDEMKASEDLKKHGATVLTALGGILKKKGHHEAEIKPLAQSHATKHKIPVKYLEFISECIIQVLQSKHPGDFGADAQGAMNKALELFRKDMASNYKELGFQG' },
          { name: 'exp', label: 'E-value cut-off', type: 'select', options: [['1e-10', '1e-10'], ['1e-5', '1e-5'], ['1e-3', '0.001'], ['10', '10 (keep everything)']], value: '1e-3' },
          { name: 'n', label: 'Hits', type: 'select', options: [['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']], value: '25' },
          { name: 'email', label: 'Your e-mail address (EBI asks for one with each job)', type: 'email', placeholder: 'name@example.ac.uk', remember: 'ebiEmail', wide: true }
        ],
        examples: [['Myoglobin (protein)', { program: 'blastp', database: 'uniprotkb_swissprot' }], ['A piece of DNA', { program: 'blastn', database: 'em_cds_hum', sequence: '>query\nATGGATCCTTTTGTGGTCCTTGTGCTCTGTCTCTCATGTTTGCTTCTCCTTTCAATCTGGAGACAGAGCTCTGGGAGAGGAAAACTCCCTCCTGGCCCCACTCCTCTCCCAGTGATTGGAAATATCCTACAGATAGGTATTAAGGACATCAGCAAATCCTTAACCAATCTCTCAAAGGTCTATGGCCCTGTGTTCACTCTGTATTTTGGCCTGAAACCCATAGTGGTGCTGCATGGATATGAAGCAGTGAAGGAAGCCCTGATTGATCTTGGAGAGGAGTTTTCTGGAAGAGGCATTTTCCCACTGGCTGAAAGAGCTAACAGAGGATTTGG' }]],
        dbFor: (program) => (program === 'blastn' || program === 'tblastn'
          ? [['em_cds_hum', 'ENA coding sequences: human'], ['em_cds_mam', 'ENA coding sequences: mammals'], ['em_cds_mus', 'ENA coding sequences: mouse'], ['em_vrl', 'ENA sequences: viruses'], ['em_cds', 'ENA coding sequences: all (slow)']]
          : [['uniprotkb_swissprot', 'UniProtKB/Swiss-Prot (reviewed)'], ['pdb', 'PDB (structures)'], ['afdb', 'AlphaFold DB'], ['uniprotkb_human', 'UniProtKB: human'], ['uniprotkb', 'UniProtKB: everything (slow)']]),
        async run(v, out) {
          const email = (v.email || '').trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('EBI needs an e-mail address with each job (they write to it only if something goes wrong). Type yours in the e-mail field.');
          let seq = v.sequence.trim();
          if (!seq) throw new ApiError('Paste a sequence first.');
          if (!seq.startsWith('>')) seq = '>query\n' + seq;
          const stype = v.program === 'blastn' || v.program === 'tblastn' ? (v.program === 'blastn' ? 'dna' : 'protein') : v.program === 'blastx' ? 'dna' : 'protein';
          const base = 'https://www.ebi.ac.uk/Tools/services/rest/ncbiblast';
          const form = { email, program: v.program, stype, database: v.database, sequence: seq, exp: v.exp, alignments: v.n, scores: v.n };
          const job = String(await call({ method: 'POST', url: `${base}/run`, form, expect: 'text', service: 'BLAST', label: `${v.program} vs ${v.database}` })).trim();
          const res = await waitForJob(base, job, out);
          void res;
          let json = null;
          try {
            json = await call({ url: `${base}/result/${job}/json`, service: 'BLAST', label: `results of ${job}`, quiet: true });
          } catch (e) {
            json = null;
          }
          const textOut = await call({ url: `${base}/result/${job}/out`, expect: 'text', service: 'BLAST', label: `report of ${job}`, quiet: true }).catch(() => '');
          const hits = ((json && json.hits) || []).map((x) => {
            const s = (x.hit_hsps || [])[0] || {};
            return {
              n: x.hit_num, acc: x.hit_acc || x.hit_id, db: x.hit_db, desc: x.hit_uni_de || x.hit_desc || x.hit_def || '', os: x.hit_uni_os || x.hit_os || '', len: x.hit_len,
              e: s.hsp_expect, bits: s.hsp_bit_score, ident: s.hsp_identity, alen: s.hsp_align_len, q: `${s.hsp_query_from}-${s.hsp_query_to}`
            };
          });
          const accLink = (r) => (r.db && /pdb/i.test(r.db) ? link(`https://www.rcsb.org/structure/${String(r.acc).slice(0, 4)}`, r.acc) : /^em_/.test(v.database) ? link(`https://www.ebi.ac.uk/ena/browser/view/${r.acc}`, r.acc) : link(`https://www.uniprot.org/uniprotkb/${r.acc}`, r.acc));
          return {
            title: `${hits.length} hit${hits.length === 1 ? '' : 's'} – ${v.program} against ${v.database}`,
            summary: `EBI job ${job}. The results stay at EBI for 7 days.`,
            table: hits.length ? {
              cols: [
                { key: 'n', label: '#', num: true }, { key: 'acc', label: 'Hit', fmt: accLink, text: (r) => r.acc }, { key: 'desc', label: 'Description' }, { key: 'os', label: 'Organism' },
                { key: 'ident', label: 'Identity %', num: true, fmt: (r) => fmtNum(r.ident, 1) }, { key: 'alen', label: 'Aligned', num: true }, { key: 'e', label: 'E-value', num: true, fmt: (r) => fmtE(r.e) }, { key: 'bits', label: 'Bits', num: true, fmt: (r) => fmtNum(r.bits, 1) }
              ],
              rows: hits, name: `blast_${job}.tsv`
            } : null,
            text: hits.length ? null : textOut,
            textName: `blast_${job}.txt`,
            extraText: textOut ? ['The full BLAST report (text)', textOut, `blast_${job}.txt`] : null,
            json,
            actions: [
              textOut ? ['download', 'Save the full report', () => saveFile(`blast_${job}.txt`, textOut)] : null,
              ['external', 'Open the results at EBI', () => window.open(`https://www.ebi.ac.uk/jdispatcher/sss/ncbiblast/summary?jobId=${enc(job)}`, '_blank', 'noopener')]
            ],
            code: {
              python: `import time\nimport requests\nimport pandas as pd\n\nbase = "https://www.ebi.ac.uk/Tools/services/rest/ncbiblast"\nemail = "YOUR_EMAIL"   # EBI asks for an e-mail address with each job\nsequence = """${seq.replace(/"""/g, '')}"""\njob = requests.post(f"{base}/run", data={"email": email, "program": ${pyStr(v.program)}, "stype": ${pyStr(stype)}, "database": ${pyStr(v.database)}, "sequence": sequence, "exp": ${pyStr(v.exp)}, "alignments": ${v.n}, "scores": ${v.n}}).text\nwhile requests.get(f"{base}/status/{job}").text not in ("FINISHED", "ERROR", "FAILURE", "NOT_FOUND"):\n    time.sleep(5)\nhits = requests.get(f"{base}/result/{job}/json").json()["hits"]\npd.DataFrame([{"hit": x["hit_acc"], "description": x.get("hit_uni_de") or x.get("hit_desc"), "organism": x.get("hit_uni_os"), "identity": x["hit_hsps"][0]["hsp_identity"], "evalue": x["hit_hsps"][0]["hsp_expect"]} for x in hits])`,
              r: '# BLAST jobs are submitted with a POST request, which R cannot make in the browser.\n# Use a Python notebook (Send to notebook → Python), or the ncbiblast client of EBI on your own computer.'
            }
          };
        }
      }]
    },
    /* ---------------- function, pathways, interactions ---------------- */
    {
      id: 'string', group: 'Function and pathways', name: 'STRING', by: 'STRING Consortium', icon: 'link',
      blurb: 'Known and predicted protein–protein interactions, as a network.',
      docs: 'https://string-db.org/help/api/', help: 'h-db-function',
      forms: [{
        id: 'network', label: 'Interaction network',
        fields: [
          { name: 'ids', label: 'Proteins or genes (one per line, or separated by commas)', type: 'textarea', value: 'TP53\nMDM2\nCDKN1A', wide: true },
          { name: 'species', label: 'Species', type: 'select', options: TAXA, value: '9606' },
          { name: 'score', label: 'Minimum confidence', type: 'select', options: [['400', 'medium (0.4)'], ['700', 'high (0.7)'], ['900', 'highest (0.9)']], value: '700' },
          { name: 'add', label: 'Add neighbours', type: 'select', options: [['0', 'none'], ['5', '5'], ['10', '10'], ['20', '20']], value: '5' }
        ],
        examples: [['p53 and friends', { ids: 'TP53\nMDM2\nCDKN1A', species: '9606' }], ['Yeast GAL genes', { ids: 'GAL1\nGAL4\nGAL80', species: '4932', add: '5' }]],
        async run(v) {
          const ids = v.ids.split(/[\s,;]+/).filter(Boolean);
          if (!ids.length) throw new ApiError('Type at least one protein or gene name.');
          const params = `identifiers=${enc(ids.join('\r'))}&species=${v.species}&required_score=${v.score}&add_nodes=${v.add}&caller_identity=bioinformatics_workbench`;
          const data = await call({ url: `https://string-db.org/api/json/network?${params}`, service: 'STRING', label: `network of ${ids.join(', ')}` });
          const rows = (data || []).map((e) => ({ a: e.preferredName_A, b: e.preferredName_B, score: e.score, exp: e.escore, db: e.dscore, text: e.tscore, coexp: e.ascore }));
          const img = `https://string-db.org/api/image/network?identifiers=${enc(ids.join('\r'))}&species=${v.species}&required_score=${v.score}&add_white_nodes=${v.add}&network_flavor=confidence&caller_identity=bioinformatics_workbench`;
          return {
            title: `${new Set(rows.flatMap((r) => [r.a, r.b])).size} proteins, ${rows.length} interactions`,
            summary: 'Line thickness in the picture shows how confident STRING is about each interaction.',
            nodes: [h('figure.api-fig', h('img', { src: img, alt: 'STRING network', loading: 'lazy' }), h('figcaption', 'The STRING network (picture from string-db.org).'))],
            table: {
              cols: [{ key: 'a', label: 'Protein A' }, { key: 'b', label: 'Protein B' }, { key: 'score', label: 'Combined score', num: true, fmt: (r) => fmtNum(r.score, 3) }, { key: 'exp', label: 'Experiments', num: true, fmt: (r) => fmtNum(r.exp, 2) }, { key: 'db', label: 'Databases', num: true, fmt: (r) => fmtNum(r.db, 2) }, { key: 'text', label: 'Text mining', num: true, fmt: (r) => fmtNum(r.text, 2) }],
              rows, name: `string_${ids[0]}.tsv`
            },
            json: data,
            actions: [['external', 'Open at STRING', () => window.open(`https://string-db.org/cgi/network?identifiers=${enc(ids.join('%0d'))}&species=${v.species}`, '_blank', 'noopener')]],
            code: {
              python: `import requests\nimport pandas as pd\n\nparams = {"identifiers": "\\r".join(${JSON.stringify(ids)}), "species": ${v.species}, "required_score": ${v.score}, "add_nodes": ${v.add}}\nedges = pd.DataFrame(requests.get("https://string-db.org/api/json/network", params=params).json())\nedges[["preferredName_A", "preferredName_B", "score"]]`,
              r: `library(jsonlite)\n\nedges <- fromJSON(paste0("https://string-db.org/api/json/network?species=${v.species}&required_score=${v.score}&add_nodes=${v.add}&identifiers=", URLencode(paste(${'c(' + ids.map(rStr).join(', ') + ')'}, collapse = "\\r"), reserved = TRUE)))\nedges[, c("preferredName_A", "preferredName_B", "score")]`
            }
          };
        }
      }]
    },
    {
      id: 'reactome', group: 'Function and pathways', name: 'Reactome', by: 'Reactome', icon: 'workflow',
      blurb: 'The biological pathways a protein takes part in, with pathway diagrams.',
      docs: 'https://reactome.org/dev/content-service', help: 'h-db-function',
      forms: [{
        id: 'pathways', label: 'Pathways of a protein',
        fields: [{ name: 'acc', label: 'UniProt accession', value: 'P04637' }, { name: 'species', label: 'Species', type: 'select', options: [['9606', 'Human'], ['10090', 'Mouse'], ['10116', 'Rat'], ['7955', 'Zebrafish'], ['4932', 'Yeast']], value: '9606' }],
        examples: [['p53 (P04637)', { acc: 'P04637' }], ['Insulin receptor (P06213)', { acc: 'P06213' }]],
        async run(v) {
          const acc = v.acc.trim().toUpperCase();
          const url = `https://reactome.org/ContentService/data/mapping/UniProt/${enc(acc)}/pathways?species=${v.species}`;
          const data = await call({ url, service: 'Reactome', label: `pathways of ${acc}` });
          const rows = (data || []).map((p) => ({ id: p.stId, name: p.displayName, diagram: p.hasDiagram, disease: p.isInDisease ? 'yes' : '' }));
          const show = (r) => {
            if (!r.diagram) return '';
            const b = h('button.btn.small', { type: 'button' }, 'Diagram');
            b.addEventListener('click', () => MG.modal(r.name, `<p><img src="https://reactome.org/ContentService/exporter/diagram/${esc(r.id)}.png?quality=7" alt="Pathway diagram" style="max-width:100%"></p><p class="muted small">From reactome.org. <a href="https://reactome.org/PathwayBrowser/#/${esc(r.id)}" target="_blank" rel="noopener">Open it in the Pathway Browser</a>.</p>`));
            return b;
          };
          return {
            title: `${rows.length} pathway${rows.length === 1 ? '' : 's'} with ${acc}`,
            table: { cols: [{ key: 'id', label: 'Pathway', fmt: (r) => link(`https://reactome.org/content/detail/${r.id}`, r.id), text: (r) => r.id }, { key: 'name', label: 'Name' }, { key: 'disease', label: 'Disease' }, { key: 'diagram', label: '', fmt: show, text: () => '' }], rows, name: `reactome_${acc}.tsv` },
            json: data,
            code: { python: pyRequest(LOG[LOG.length - 1], 'pathways') + '\n\nimport pandas as pd\npd.DataFrame(pathways)[["stId", "displayName", "isInDisease"]]', r: rRequest(LOG[LOG.length - 1], 'pathways') }
          };
        }
      }]
    },
    {
      id: 'go', group: 'Function and pathways', name: 'Gene Ontology', by: 'QuickGO & OLS (EMBL-EBI)', icon: 'tree',
      blurb: 'The GO terms of a protein (function, process, location); look up terms of GO and other ontologies.',
      docs: 'https://www.ebi.ac.uk/QuickGO/api/index.html', help: 'h-db-function',
      forms: [
        {
          id: 'annot', label: 'GO terms of a protein',
          fields: [{ name: 'acc', label: 'UniProt accession', value: 'P04637' }, { name: 'aspect', label: 'Kind', type: 'select', options: [['', 'all three'], ['molecular_function', 'molecular function'], ['biological_process', 'biological process'], ['cellular_component', 'cellular component']], value: '' }],
          examples: [['p53 (P04637)', { acc: 'P04637' }], ['TLR4, processes', { acc: 'O00206', aspect: 'biological_process' }]],
          async run(v) {
            const acc = v.acc.trim().toUpperCase();
            const url = `https://www.ebi.ac.uk/QuickGO/services/annotation/search?geneProductId=${enc(acc)}&limit=200${v.aspect ? '&aspect=' + v.aspect : ''}`;
            const data = await call({ url, service: 'QuickGO', label: `GO annotations of ${acc}`, headers: { Accept: 'application/json' } });
            const res = (data && data.results) || [];
            const ids = Array.from(new Set(res.map((r) => r.goId)));
            const names = {};
            for (let i = 0; i < ids.length; i += 100) {
              const t = await call({ url: `https://www.ebi.ac.uk/QuickGO/services/ontology/go/terms/${ids.slice(i, i + 100).map(enc).join(',')}`, service: 'QuickGO', label: 'GO term names', headers: { Accept: 'application/json' }, quiet: true });
              ((t && t.results) || []).forEach((x) => (names[x.id] = x.name));
            }
            const seen = new Map();
            res.forEach((r) => {
              const k = r.goId + '|' + r.qualifier;
              const x = seen.get(k) || { id: r.goId, name: names[r.goId] || '', aspect: (r.goAspect || '').replace(/_/g, ' '), qualifier: (r.qualifier || '').replace(/_/g, ' '), evidence: new Set(), by: new Set() };
              x.evidence.add(r.goEvidence);
              x.by.add(r.assignedBy);
              seen.set(k, x);
            });
            const rows = Array.from(seen.values()).map((x) => Object.assign(x, { evidence: Array.from(x.evidence).join(', '), by: Array.from(x.by).join(', ') }));
            return {
              title: `${rows.length} GO term${rows.length === 1 ? '' : 's'} for ${acc}`,
              summary: data && data.numberOfHits > 200 ? `${data.numberOfHits} annotations in all; the first 200 are summarised.` : '',
              table: { cols: [{ key: 'id', label: 'GO term', fmt: (r) => link(`https://www.ebi.ac.uk/QuickGO/term/${r.id}`, r.id), text: (r) => r.id }, { key: 'name', label: 'Name' }, { key: 'aspect', label: 'Aspect' }, { key: 'qualifier', label: 'Qualifier' }, { key: 'evidence', label: 'Evidence' }, { key: 'by', label: 'From' }], rows, name: `go_${acc}.tsv` },
              json: data,
              code: { python: `import requests\nimport pandas as pd\n\nr = requests.get(${pyStr(url)}, headers={"Accept": "application/json"})\nannotations = pd.DataFrame(r.json()["results"])\nannotations[["goId", "goAspect", "qualifier", "goEvidence"]].drop_duplicates()`, r: rRequest(LOG.filter((e) => e.label.startsWith('GO annotations')).slice(-1)[0] || LOG[LOG.length - 1], 'annotations') }
            };
          }
        },
        {
          id: 'terms', label: 'Look up a term',
          fields: [{ name: 'q', label: 'Words', value: 'apoptosis' }, { name: 'ont', label: 'Ontology', type: 'select', options: [['go', 'Gene Ontology'], ['hp', 'Human Phenotype Ontology'], ['mondo', 'Mondo (diseases)'], ['efo', 'Experimental Factor Ontology'], ['uberon', 'Uberon (anatomy)'], ['cl', 'Cell Ontology'], ['chebi', 'ChEBI (chemicals)'], ['so', 'Sequence Ontology']], value: 'go' }],
          examples: [['apoptosis (GO)', { q: 'apoptosis', ont: 'go' }], ['seizure (HPO)', { q: 'seizure', ont: 'hp' }], ['missense (SO)', { q: 'missense variant', ont: 'so' }]],
          async run(v) {
            const url = `https://www.ebi.ac.uk/ols4/api/search?q=${enc(v.q)}&ontology=${v.ont}&rows=30`;
            const data = await call({ url, service: 'OLS', label: `${v.ont} terms: ${v.q}` });
            const rows = ((data.response || {}).docs || []).map((d) => ({ id: d.obo_id || d.short_form, label: d.label, desc: (d.description || [])[0] || '', iri: d.iri }));
            return {
              title: `${rows.length} term${rows.length === 1 ? '' : 's'}`,
              table: { cols: [{ key: 'id', label: 'Term', fmt: (r) => link(`https://www.ebi.ac.uk/ols4/ontologies/${v.ont}/classes/${enc(enc(r.iri))}`, r.id), text: (r) => r.id }, { key: 'label', label: 'Name' }, { key: 'desc', label: 'Definition' }], rows, name: `${v.ont}_${v.q.replace(/\W+/g, '_')}.tsv` },
              json: data,
              code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data["response"]["docs"])[["obo_id", "label"]]', r: rRequest(LOG[LOG.length - 1]) }
            };
          }
        }
      ]
    },
    /* ---------------- literature and chemistry ---------------- */
    {
      id: 'europepmc', group: 'Literature and chemistry', name: 'Europe PMC', by: 'EMBL-EBI', icon: 'book',
      blurb: 'Search the life-science literature (PubMed and more), with links to the full text where it is free.',
      docs: 'https://europepmc.org/RestfulWebService', help: 'h-db-literature',
      forms: [{
        id: 'search', label: 'Search articles',
        fields: [{ name: 'q', label: 'Search terms', value: 'CYP2C19 clopidogrel', wide: true }, { name: 'oa', label: 'Only open access', type: 'checkbox', value: '' }, { name: 'n', label: 'At most', type: 'select', options: [['10', '10'], ['25', '25'], ['50', '50']], value: '25' }],
        examples: [['CYP2C19 and clopidogrel', { q: 'CYP2C19 clopidogrel' }], ['AlphaFold reviews', { q: 'AlphaFold AND PUB_TYPE:review' }]],
        async run(v) {
          const q = v.q + (v.oa ? ' AND OPEN_ACCESS:y' : '');
          const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&pageSize=${v.n}&resultType=lite`;
          const data = await call({ url, service: 'Europe PMC', label: `articles: ${q}` });
          const rows = ((data.resultList || {}).result || []).map((r) => ({ title: r.title, authors: r.authorString, journal: r.journalTitle, year: r.pubYear, cited: r.citedByCount, oa: r.isOpenAccess === 'Y' ? 'yes' : '', id: r.id, source: r.source, pmid: r.pmid, doi: r.doi }));
          return {
            title: `${Number(data.hitCount || 0).toLocaleString('en-GB')} articles`,
            summary: rows.length < Number(data.hitCount || 0) ? `Showing ${rows.length}, most relevant first.` : '',
            table: { cols: [{ key: 'title', label: 'Title', fmt: (r) => link(`https://europepmc.org/article/${r.source}/${r.id}`, r.title), text: (r) => r.title }, { key: 'authors', label: 'Authors', fmt: (r) => String(r.authors || '').slice(0, 80) + (String(r.authors || '').length > 80 ? '…' : '') }, { key: 'journal', label: 'Journal' }, { key: 'year', label: 'Year', num: true }, { key: 'cited', label: 'Cited by', num: true }, { key: 'oa', label: 'Open access' }], rows, name: 'europepmc.tsv' },
            json: data,
            code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\nimport pandas as pd\npd.DataFrame(data["resultList"]["result"])[["title", "authorString", "journalTitle", "pubYear"]]', r: rRequest(LOG[LOG.length - 1]) }
          };
        }
      }]
    },
    {
      id: 'pubchem', group: 'Literature and chemistry', name: 'PubChem', by: 'NCBI', icon: 'flask',
      blurb: 'Small molecules – drugs, metabolites, ligands: properties, 2D drawing, and a 3D model for the 3D viewer.',
      docs: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest', help: 'h-db-literature',
      forms: [{
        id: 'compound', label: 'A compound',
        fields: [{ name: 'q', label: 'Name or CID', value: 'clopidogrel' }],
        examples: [['Clopidogrel', { q: 'clopidogrel' }], ['Haem (heme b)', { q: 'heme b' }], ['Caffeine', { q: 'caffeine' }]],
        async run(v) {
          const q = v.q.trim();
          const key = /^\d+$/.test(q) ? `cid/${q}` : `name/${enc(q)}`;
          const props = 'MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES,XLogP,HBondDonorCount,HBondAcceptorCount';
          const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${key}/property/${props}/JSON`;
          const data = await call({ url, service: 'PubChem', label: `compound ${q}` });
          const p = (((data || {}).PropertyTable || {}).Properties || [])[0] || {};
          const rows = Object.entries(p).map(([k, val]) => ({ k: k.replace(/([a-z])([A-Z])/g, '$1 $2'), v: val }));
          return {
            title: `${q} – PubChem CID ${p.CID}`,
            summary: `${p.MolecularFormula || ''} · ${p.MolecularWeight ? fmtNum(p.MolecularWeight, 2) + ' g/mol' : ''}`,
            nodes: [h('figure.api-fig.small', h('img', { src: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${p.CID}/PNG`, alt: '2D structure', loading: 'lazy' }))],
            table: { cols: [{ key: 'k', label: 'Property' }, { key: 'v', label: 'Value' }], rows, name: `pubchem_${p.CID}.tsv` },
            json: data,
            actions: [
              ['cube', 'Show in the 3D viewer', async () => {
                const sdf = await call({ url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${p.CID}/record/SDF?record_type=3d`, expect: 'text', service: 'PubChem', label: `3D model of CID ${p.CID}` });
                const V = await MG.app.ensureViewer();
                await V.loadFile(new File([sdf], `${q.replace(/\W+/g, '_')}_${p.CID}.sdf`));
              }],
              ['download', 'Save the 3D model (.sdf)', async () => saveFile(`${q.replace(/\W+/g, '_')}_${p.CID}.sdf`, await call({ url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${p.CID}/record/SDF?record_type=3d`, expect: 'text', service: 'PubChem', label: `3D model of CID ${p.CID}` }), { folder: '~/structures' })],
              ['external', 'Open at PubChem', () => window.open(`https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`, '_blank', 'noopener')]
            ],
            code: { python: pyRequest(LOG[LOG.length - 1]) + '\n\ndata["PropertyTable"]["Properties"][0]', r: rRequest(LOG[LOG.length - 1]) }
          };
        }
      }]
    }
  ];

  function ncbiCols(db) {
    const uid = (base) => ({ key: 'uid', label: 'ID', fmt: (r) => link(`https://www.ncbi.nlm.nih.gov/${base}/${r.uid}`, r.uid), text: (r) => r.uid });
    if (db === 'gene') return [uid('gene'), { key: 'name', label: 'Symbol' }, { key: 'description', label: 'Name' }, { key: 'org', label: 'Organism', fmt: (r) => (r.organism && r.organism.scientificname) || '' }, { key: 'chromosome', label: 'Chr' }, { key: 'maplocation', label: 'Location' }];
    if (db === 'nuccore' || db === 'protein') return [{ key: 'caption', label: 'Accession', fmt: (r) => link(`https://www.ncbi.nlm.nih.gov/${db}/${r.accessionversion || r.caption}`, r.accessionversion || r.caption), text: (r) => r.accessionversion || r.caption }, { key: 'title', label: 'Title' }, { key: 'slen', label: 'Length', num: true }, { key: 'organism', label: 'Organism' }, { key: 'fa', label: '', fmt: (r) => fetchBtn(db, r.accessionversion || r.caption), text: () => '' }];
    if (db === 'pubmed') return [uid('pubmed'), { key: 'title', label: 'Title' }, { key: 'source', label: 'Journal' }, { key: 'pubdate', label: 'Date' }, { key: 'au', label: 'First author', fmt: (r) => ((r.authors || [])[0] || {}).name || '' }];
    if (db === 'snp') return [{ key: 'uid', label: 'rs', fmt: (r) => link(`https://www.ncbi.nlm.nih.gov/snp/rs${r.uid}`, 'rs' + r.uid), text: (r) => 'rs' + r.uid }, { key: 'genes', label: 'Gene', fmt: (r) => (r.genes || []).map((g) => g.name).join(', ') }, { key: 'chrpos', label: 'Position (GRCh38)' }, { key: 'docsum', label: 'Alleles', fmt: (r) => String(r.docsum || '').slice(0, 80) }, { key: 'fxn_class', label: 'Function' }];
    if (db === 'clinvar') return [uid('clinvar/variation'), { key: 'title', label: 'Variant' }, { key: 'cs', label: 'Significance', fmt: (r) => ((r.germline_classification || r.clinical_significance || {}).description) || '' }, { key: 'genes', label: 'Gene', fmt: (r) => (r.genes || []).map((g) => g.symbol).join(', ') }];
    if (db === 'taxonomy') return [uid('Taxonomy/Browser/wwwtax.cgi?id='), { key: 'scientificname', label: 'Name' }, { key: 'commonname', label: 'Common name' }, { key: 'rank', label: 'Rank' }, { key: 'division', label: 'Division' }];
    if (db === 'assembly') return [{ key: 'assemblyaccession', label: 'Accession' }, { key: 'assemblyname', label: 'Name' }, { key: 'organism', label: 'Organism' }, { key: 'assemblystatus', label: 'Level' }, { key: 'submitterorganization', label: 'From' }];
    return [{ key: 'uid', label: 'ID' }, { key: 'title', label: 'Title' }];
  }
  function fetchBtn(db, acc) {
    const b = h('button.btn.small', { type: 'button', title: 'Download the sequence (FASTA) into your files' }, 'FASTA');
    b.addEventListener('click', async () => {
      try {
        const fa = await call({ url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=${db}&id=${enc(acc)}&rettype=fasta&retmode=text`, expect: 'text', service: 'NCBI', label: `FASTA of ${acc}` });
        saveFile(`${acc}.fasta`, fa);
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    });
    return b;
  }
  /** the domains of a protein along its sequence (InterPro) */
  function domainSvg(rows, len) {
    const W = 680, rowH = 18, left = 8, right = 8;
    const x = (p) => left + ((p - 1) / Math.max(1, len - 1)) * (W - left - right);
    const H = 34 + rows.length * rowH;
    const colours = { domain: '#2f7fc1', family: '#9b59b6', homologous_superfamily: '#16a085', repeat: '#e67e22', site: '#c0392b', active_site: '#c0392b', binding_site: '#d35400', conserved_site: '#7f8c8d', ptm: '#8e44ad' };
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="11">`;
    s += `<rect x="${left}" y="8" width="${W - left - right}" height="8" rx="4" fill="#d5dde6"/><text x="${left}" y="30" fill="#647086">1</text><text x="${W - right}" y="30" fill="#647086" text-anchor="end">${len}</text>`;
    rows.forEach((r, i) => {
      const y = 36 + i * rowH;
      const c = colours[r.type] || '#5d6d7e';
      (r.frags || []).forEach((f) => (s += `<rect x="${x(f.start).toFixed(1)}" y="${y}" width="${Math.max(2, x(f.end) - x(f.start)).toFixed(1)}" height="12" rx="3" fill="${c}" opacity="0.85"><title>${esc(r.acc)} ${esc(r.name)}: ${f.start}–${f.end}</title></rect>`));
      const f0 = (r.frags || [])[0];
      if (f0) s += `<text x="${(x(f0.end) + 4).toFixed(1)}" y="${y + 10}" fill="#18212f">${esc(String(r.name).slice(0, 48))}</text>`;
    });
    s += '</svg>';
    return h('div.api-svg', { html: s });
  }
  /** wait for an EBI job; shows its state in `out` */
  async function waitForJob(base, job, out) {
    const t0 = Date.now();
    const st = h('p.api-wait', h('span.spinner.small'), h('span', ` Job ${job} submitted to EBI – waiting for it…`));
    out.innerHTML = '';
    out.appendChild(st);
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 2000 : 5000));
      let s;
      try {
        s = String(await call({ url: `${base}/status/${job}`, expect: 'text', quiet: true })).trim();
      } catch (e) {
        continue;
      }
      st.lastChild.textContent = ` Job ${job}: ${s.toLowerCase()} (${Math.round((Date.now() - t0) / 1000)} s)`;
      if (s === 'FINISHED') return s;
      if (s === 'ERROR' || s === 'FAILURE' || s === 'NOT_FOUND') throw new ApiError(`The job at EBI ended with ${s}. Check the sequence and the program (protein vs DNA).`);
    }
    throw new ApiError('The job is taking very long. It keeps running at EBI: open it there later (job ' + job + ').');
  }

  /* ------------------------------------------------------------------
     the tab
     ------------------------------------------------------------------ */
  class ApiExplorer {
    constructor(root) {
      this.root = root;
      this.root.classList.add('api');
      this.panels = {};
      this.current = null;
      this.home = h('div.api-home');
      this.panelBox = h('div.api-panels');
      root.append(this.home, this.panelBox);
      this._renderHome();
      bus.on('api:log', () => this._renderLog());
      MG.app.apis = this;
      const last = store.get('apiService', null);
      if (last && SERVICES.some((s) => s.id === last)) this.show(last, { quiet: true });
    }
    _renderHome() {
      const H = this.home;
      H.innerHTML = '';
      H.appendChild(h('div.api-intro', h('h2', 'Databases'), h('p', 'Public bioinformatics databases and tools, searched from your browser. Each answer can be saved to your files, or sent to a notebook as Python or R code that does the same search – so the work can be repeated and kept.')));
      const groups = [];
      SERVICES.forEach((s) => {
        let g = groups.find((x) => x.name === s.group);
        if (!g) groups.push((g = { name: s.group, items: [] }));
        g.items.push(s);
      });
      const grid = h('div.api-groups');
      groups.forEach((g) => {
        const sec = h('section.api-group', h('h3', g.name));
        const list = h('div.api-cards');
        g.items.forEach((s) => {
          const b = h('button.api-card', { type: 'button', dataset: { svc: s.id } }, h('span.api-card-ic', { html: MG.icon(s.icon) }), h('span.api-card-t', h('b', s.name), h('small', s.by)), h('span.api-card-d', s.blurb));
          b.addEventListener('click', () => this.show(s.id));
          list.appendChild(b);
        });
        sec.appendChild(list);
        grid.appendChild(sec);
      });
      H.appendChild(grid);
      this.logBox = h('section.api-log');
      H.appendChild(this.logBox);
      H.appendChild(h('p.api-foot.muted.small', 'These services are run by the institutes named on each card; the page sends them only the query you type (and, for BLAST, the e-mail address you give). Never send personal or patient data to them.'));
      this._renderLog();
    }
    _renderLog() {
      const box = this.logBox;
      if (!box) return;
      box.innerHTML = '';
      const list = LOG.filter((e) => !e.quiet);
      box.appendChild(h('h3', 'Your queries', h('small', list.length ? ` (${list.length})` : '')));
      if (!list.length) {
        box.appendChild(h('p.muted.small', 'The queries you make appear here; you can save them all as a notebook.'));
        return;
      }
      const btns = h('div.api-logbtns');
      const py = h('button.btn.small', { type: 'button', html: MG.icon('notebook') + '<span>Save as a Python notebook</span>' });
      py.addEventListener('click', () => this.exportLog('python'));
      const r = h('button.btn.small', { type: 'button', html: MG.icon('notebook') + '<span>… as an R notebook</span>' });
      r.addEventListener('click', () => this.exportLog('r'));
      btns.append(py, r);
      box.appendChild(btns);
      const ul = h('ol.api-loglist');
      list.slice(-30).reverse().forEach((e) => ul.appendChild(h('li', h('b', e.service), ' ', e.label, ' ', h('span.muted', `· ${new Date(e.t).toLocaleTimeString('en-GB')}`), e.status && e.status !== 200 ? h('span.api-bad', ` · ${e.status}`) : null)));
      box.appendChild(ul);
    }
    /** every query of this visit as a notebook */
    async exportLog(lang) {
      const list = LOG.filter((e) => !e.quiet);
      const cells = [{ type: 'markdown', source: `# Database queries\n\nThe queries made in the Databases tab of the Bioinformatics workbench on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, as ${lang === 'r' ? 'R' : 'Python'} code. Run a cell to make the same query again (the answer may have changed since: databases are updated).` }];
      list.forEach((e) => {
        cells.push({ type: 'markdown', source: `## ${e.service}: ${e.label}\n\n\`${e.method} ${e.url}\`` });
        cells.push({ type: 'code', source: lang === 'r' ? rRequest(e) : pyRequest(e) });
      });
      const fs = MG.app.fs;
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const path = `${MG.app.HOME}/notebooks/database-queries-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${lang === 'r' ? '-R' : ''}.ipynb`;
      fs.mkdirp(MG.path.dirname(path));
      fs.writeText(path, JSON.stringify(MG.nbformat.make(lang, cells), null, 1));
      await MG.app.showWorkbench('notebook');
      await MG.app.nbApp.open(path);
      toast(`Saved your ${list.length} queries as <b>${esc(fs.pretty(path))}</b>.`, 'ok');
    }
    /** show a service (its card) */
    show(id, opts = {}) {
      const s = SERVICES.find((x) => x.id === id);
      if (!s) {
        this.showHome();
        return null;
      }
      let p = this.panels[id];
      if (!p) p = this.panels[id] = this._makePanel(s);
      Object.values(this.panels).forEach((x) => (x.el.hidden = x !== p));
      this.home.hidden = true;
      this.panelBox.hidden = false;
      this.current = id;
      store.set('apiService', id);
      if (!opts.quiet) bus.emit('api:service', { id });
      return p;
    }
    showHome() {
      Object.values(this.panels).forEach((x) => (x.el.hidden = true));
      this.home.hidden = false;
      // (the box of the cards' panels would otherwise take half of the height)
      this.panelBox.hidden = true;
      this.current = null;
      store.remove('apiService');
      this._renderLog();
    }
    _makePanel(s) {
      const el = h('div.api-panel');
      const back = h('button.btn.small.api-back', { type: 'button', html: '← <span>All databases</span>' });
      back.addEventListener('click', () => this.showHome());
      const head = h('div.api-head', back, h('span.api-head-ic', { html: MG.icon(s.icon) }), h('div.api-head-t', h('b', s.name), h('small', s.by)), h('span.grow'), s.help ? h('button.tbtn', { type: 'button', 'data-goto': s.help, html: MG.icon('help') + '<span>Help</span>' }) : null, s.docs ? h('a.tbtn', { href: s.docs, target: '_blank', rel: 'noopener', html: MG.icon('external') + '<span>About the API</span>' }) : null);
      el.appendChild(head);
      const body = h('div.api-body');
      el.appendChild(body);
      this.panelBox.appendChild(el);
      const panel = { el, body, s };
      if (s.explorer) {
        const root = h('div.api-explorer');
        body.appendChild(root);
        if (s.id === 'uniprot') MG.app.uniprot = new MG.UniProtExplorer(root);
        if (s.id === 'pdb') MG.app.pdb = new MG.PDBExplorer(root);
        panel.explorer = s.id === 'uniprot' ? MG.app.uniprot : MG.app.pdb;
        return panel;
      }
      body.appendChild(h('p.api-blurb', s.blurb));
      const tabs = h('div.api-forms', { role: 'tablist' });
      const formBox = h('div.api-formbox');
      const out = h('div.api-out');
      body.append(tabs, formBox, out);
      const showForm = (f) => {
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f.id));
        formBox.innerHTML = '';
        formBox.appendChild(this._form(s, f, out));
      };
      if (s.forms.length > 1) {
        s.forms.forEach((f) => {
          const b = h('button.api-ftab', { type: 'button', dataset: { f: f.id }, role: 'tab' }, f.label);
          b.addEventListener('click', () => showForm(f));
          tabs.appendChild(b);
        });
      } else tabs.hidden = true;
      showForm(s.forms[0]);
      panel.showForm = (fid) => showForm(s.forms.find((f) => f.id === fid) || s.forms[0]);
      return panel;
    }
    _form(s, f, out) {
      const form = h('form.api-form');
      const inputs = {};
      f.fields.forEach((fd) => {
        let input;
        // (a remembered value – the e-mail address for EBI – is kept with the workbench's settings: Start afresh
        // forgets it with them)
        const saved = fd.remember ? String(store.get('remember:' + fd.remember, '') || '') : '';
        if (fd.type === 'select') {
          input = h('select', { name: fd.name }, (fd.options || []).map(([v, l]) => h('option', { value: v }, l)));
          input.value = fd.value;
        } else if (fd.type === 'textarea') input = h('textarea', { name: fd.name, rows: 5, spellcheck: 'false' }, fd.value || '');
        else if (fd.type === 'checkbox') input = h('input', { type: 'checkbox', name: fd.name });
        else input = h('input', { type: fd.type === 'number' ? 'number' : fd.type === 'email' ? 'email' : 'text', name: fd.name, value: saved || fd.value || '', placeholder: fd.placeholder || '', spellcheck: 'false', autocomplete: fd.type === 'email' ? 'email' : 'off' });
        inputs[fd.name] = input;
        const lab = h('label.api-field' + (fd.wide || fd.type === 'textarea' ? '.wide' : '') + (fd.type === 'checkbox' ? '.check' : ''), fd.type === 'checkbox' ? [input, h('span', fd.label)] : [h('span', fd.label), input]);
        form.appendChild(lab);
        if (fd.remember) {
          const keep = h('input', { type: 'checkbox' });
          keep.checked = !!saved;
          const remember = () => {
            if (keep.checked && input.value.trim()) store.set('remember:' + fd.remember, input.value.trim());
            else store.remove('remember:' + fd.remember);
          };
          keep.addEventListener('change', remember);
          input.addEventListener('change', remember);
          form.appendChild(h('label.api-field.check.wide.small', keep, h('span', 'Remember it in this browser')));
        }
      });
      // BLAST: the databases depend on the program
      if (f.dbFor && inputs.program && inputs.database) {
        const fill = () => {
          const keep = inputs.database.value;
          inputs.database.innerHTML = '';
          f.dbFor(inputs.program.value).forEach(([v, l]) => inputs.database.appendChild(h('option', { value: v }, l)));
          if (Array.from(inputs.database.options).some((o) => o.value === keep)) inputs.database.value = keep;
        };
        inputs.program.addEventListener('change', fill);
        fill();
        inputs.database.value = f.fields.find((x) => x.name === 'database').value;
      }
      const go = h('button.btn.primary', { type: 'submit', html: MG.icon(s.job ? 'play' : 'search') + `<span>${s.job ? 'Run' : 'Search'}</span>` });
      const exRow = h('div.api-examples', h('span.muted', 'Try: '));
      (f.examples || []).forEach(([label, vals]) => {
        const b = h('button.chip', { type: 'button' }, label);
        b.addEventListener('click', () => {
          Object.entries(vals).forEach(([k, v]) => {
            if (!inputs[k]) return;
            if (inputs[k].type === 'checkbox') inputs[k].checked = !!v;
            else inputs[k].value = v;
            inputs[k].dispatchEvent(new Event('change'));
          });
          if (vals.database && inputs.database) inputs.database.value = vals.database;
          if (!s.job) form.requestSubmit();
        });
        exRow.appendChild(b);
      });
      form.appendChild(h('div.api-go', go, exRow));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = {};
        Object.entries(inputs).forEach(([k, el]) => (v[k] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value));
        go.disabled = true;
        out.innerHTML = '';
        out.appendChild(h('p.api-wait', h('span.spinner.small'), h('span', ' Asking ' + s.name + '…')));
        const n0 = LOG.length;
        try {
          const res = await f.run(v, out);
          this._show(out, res, s, LOG.slice(n0));
          bus.emit('api:result', { service: s.id, form: f.id });
        } catch (err) {
          console.error(err);
          out.innerHTML = '';
          out.appendChild(h('div.api-error', MG.icon ? h('span', { html: MG.icon('warning') }) : null, h('span', err instanceof ApiError ? err.message : 'Something went wrong: ' + (err.message || err))));
        } finally {
          go.disabled = false;
        }
      });
      return form;
    }
    _show(out, res, s, reqs) {
      out.innerHTML = '';
      const head = h('div.api-reshead', h('h3', res.title || 'Result'), res.summary ? h('p.muted', res.summary) : null);
      out.appendChild(head);
      // what can be done with it
      const acts = h('div.api-acts');
      const act = (icon, label, fn, title) => {
        const b = h('button.btn.small', { type: 'button', title: title || label, html: MG.icon(icon) + '<span>' + esc(label) + '</span>' });
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await fn();
          } catch (e) {
            toast(esc(e.message || String(e)), 'error');
          } finally {
            b.disabled = false;
          }
        });
        acts.appendChild(b);
      };
      if (res.text) act('download', 'Save to my files', () => saveFile(res.textName || 'result.txt', res.text));
      if (res.table && res.table.rows.length) act('table', 'Save the table (.tsv)', () => saveFile(res.table.name || 'table.tsv', toTsv(res.table.cols, res.table.rows)));
      (res.actions || []).filter(Boolean).forEach(([icon, label, fn]) => act(icon, label, fn));
      const code = res.code || (reqs.length ? { python: pyRequest(reqs[reqs.length - 1]), r: rRequest(reqs[reqs.length - 1]) } : null);
      if (code) {
        act('notebook', 'Send to notebook', () => this._sendCode(s, res, code), 'Add Python or R code that makes this query to a notebook');
      }
      if (res.json != null) act('code', 'Raw data (JSON)', () => MG.modal(`${s.name}: the data`, `<pre class="api-pre">${esc(JSON.stringify(res.json, null, 1).slice(0, 200000))}</pre>`));
      const getReq = reqs.filter((r) => r.method === 'GET').slice(-1)[0];
      if (getReq) act('link', 'Copy the URL', async () => {
        await MG.copyText(getReq.url);
        toast('Copied the URL of the query – it also works in a browser, in curl and in code.', null, 2500);
      });
      out.appendChild(acts);
      (res.nodes || []).forEach((n) => out.appendChild(n));
      if (res.table) out.appendChild(res.table.rows.length ? table(res.table.cols, res.table.rows) : h('p.muted', 'Nothing found.'));
      if (res.text) out.appendChild(pre(res.text));
      if (res.extraText) {
        const [label, text] = res.extraText;
        const d = h('details.api-more', h('summary', label), pre(text));
        out.appendChild(d);
      }
    }
    _sendCode(s, res, code) {
      MG.popmenu(document.activeElement && document.activeElement.closest('.api-acts') ? document.activeElement : this.root, [
        ['python', 'Python (requests)', () => MG.app.toNotebook(`# ${s.name}: ${res.title}\n` + code.python, 'python', false)],
        ['rlang', 'R', () => MG.app.toNotebook(`# ${s.name}: ${res.title}\n` + code.r, 'r', false)]
      ]);
    }
    /** for ▶ buttons in the help: data-api="ensembl" or "ensembl:vep:rs4244285" or "uniprot:P04637" */
    async go(spec) {
      const [id, a, ...rest] = String(spec).split(':');
      const b = rest.join(':');
      const p = this.show(id);
      if (!p) return;
      if (p.explorer) {
        if (a && id === 'uniprot') ACC_RE.test(a) ? p.explorer.open(a.toUpperCase()) : p.explorer.search(a);
        else if (a && id === 'pdb') /^\d[A-Za-z0-9]{3}$/.test(a) ? p.explorer.entry(a.toUpperCase()) : p.explorer.search(a);
        return;
      }
      if (a && p.showForm) {
        p.showForm(a);
        if (b) {
          const form = p.body.querySelector('form.api-form');
          const first = form.querySelector('input[type="text"], textarea');
          if (first) first.value = b;
          if (first && !p.s.job) form.requestSubmit();
        }
      }
    }
    get services() {
      return SERVICES.map((s) => ({ id: s.id, name: s.name }));
    }
  }

  MG.ApiExplorer = ApiExplorer;
  MG.apiCall = call;
  MG.apiLog = LOG;
  /** for the UniProt and PDB explorers: a query in "Your queries", saving a file, code for a notebook */
  MG.apiTools = {
    record(e) {
      const last = LOG[LOG.length - 1];
      if (last && last.url === e.url && last.method === (e.method || 'GET') && !e.json && Date.now() - last.t < 60000) return last;
      const entry = Object.assign({ t: Date.now(), service: '', label: '', method: 'GET', url: '', headers: null, form: null, json: null, expect: 'json', status: 200, quiet: false }, e);
      LOG.push(entry);
      bus.emit('api:log', entry);
      return entry;
    },
    pyRequest,
    rRequest,
    saveFile,
    sendCode(anchor, title, code) {
      MG.popmenu(anchor, [
        ['python', 'Python (requests)', () => MG.app.toNotebook(`# ${title}\n` + code.python, 'python', false)],
        ['rlang', 'R', () => MG.app.toNotebook(`# ${title}\n` + code.r, 'r', false)]
      ]);
    }
  };
})();
