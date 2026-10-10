/* =====================================================================
   Proteins in 3D – Protein Data Bank explorer (RCSB Search + Data APIs)
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast } = MG;
  const SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';
  const GQL = 'https://data.rcsb.org/graphql';
  const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`;
  const thumb = (id) => `https://cdn.rcsb.org/images/structures/${id.toLowerCase().slice(1, 3)}/${id.toLowerCase()}/${id.toLowerCase()}_assembly-1.jpeg`;
  const ccdImg = (id) => `https://cdn.rcsb.org/images/ccd/labeled/${id[0]}/${id}.svg`;
  const METHOD = { 'X-RAY DIFFRACTION': ['X-ray', 'x'], 'ELECTRON MICROSCOPY': ['Cryo-EM', 'em'], 'SOLUTION NMR': ['NMR', 'nmr'], 'SOLID-STATE NMR': ['NMR (solid)', 'nmr'], 'NEUTRON DIFFRACTION': ['Neutron', 'x'], 'ELECTRON CRYSTALLOGRAPHY': ['Electron cryst.', 'em'] };
  const method = (m) => (METHOD[m] || [m ? m.charAt(0) + m.slice(1).toLowerCase() : '?', 'x']);

  async function gql(query, variables) {
    const r = await MG.fetchWithTimeout(GQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }, 30000);
    const j = await r.json();
    if (j.errors && !j.data) throw new Error(j.errors[0].message);
    return j.data;
  }
  const SUMMARY_Q = `query($ids:[String!]!){ entries(entry_ids:$ids){ rcsb_id struct{title} exptl{method}
    rcsb_entry_info{resolution_combined deposited_polymer_entity_instance_count polymer_entity_count nonpolymer_bound_components}
    rcsb_accession_info{initial_release_date}
    polymer_entities{ rcsb_polymer_entity{pdbx_description} rcsb_entity_source_organism{ncbi_scientific_name} } } }`;
  const ENTRY_Q = `query($id:String!){ entry(entry_id:$id){ rcsb_id struct{title} struct_keywords{pdbx_keywords text} exptl{method}
    rcsb_entry_info{resolution_combined deposited_atom_count deposited_polymer_entity_instance_count polymer_entity_count assembly_count molecular_weight}
    rcsb_accession_info{initial_release_date deposit_date}
    rcsb_primary_citation{title journal_abbrev year pdbx_database_id_PubMed pdbx_database_id_DOI rcsb_authors}
    polymer_entities{ rcsb_polymer_entity{pdbx_description} rcsb_polymer_entity_container_identifiers{auth_asym_ids uniprot_ids}
      entity_poly{rcsb_entity_polymer_type rcsb_sample_sequence_length} rcsb_entity_source_organism{ncbi_scientific_name} }
    nonpolymer_entities{ nonpolymer_comp{chem_comp{id name formula}} rcsb_nonpolymer_entity_container_identifiers{auth_asym_ids} }
    branched_entities{ rcsb_branched_entity{pdbx_description} rcsb_branched_entity_container_identifiers{auth_asym_ids} }
    assemblies{ rcsb_assembly_info{assembly_id polymer_entity_instance_count} pdbx_struct_assembly{oligomeric_details details} } } }`;

  class PDBExplorer {
    constructor(root) {
      this.root = root;
      this.state = { page: 0 };
      this._build();
      this.renderIntro();
    }
    _build() {
      const r = this.root;
      r.classList.add('ex');
      this.input = h('input', { type: 'search', placeholder: 'PDB ID, protein name, UniProt accession or any text…', 'aria-label': 'Search the PDB', spellcheck: 'false' });
      this.mode = h('select', { 'aria-label': 'Search type', title: 'What kind of search?' },
        h('option', { value: 'auto' }, 'Auto'),
        h('option', { value: 'name' }, 'Protein name (UniProt)'),
        h('option', { value: 'uniprot' }, 'UniProt accession'),
        h('option', { value: 'text' }, 'Full text (anything)'));
      this.form = h('form.ex-search', this.input, h('button.btn.primary', { type: 'submit', html: MG.icon('search') + '<span>Search</span>' }));
      this.fHuman = h('input', { type: 'checkbox' });
      this.fDNA = h('input', { type: 'checkbox' });
      this.fMethod = h('select', { 'aria-label': 'Experimental method' }, h('option', { value: '' }, 'Any method'), h('option', { value: 'X-RAY DIFFRACTION' }, 'X-ray'), h('option', { value: 'ELECTRON MICROSCOPY' }, 'Cryo-EM'), h('option', { value: 'SOLUTION NMR' }, 'NMR'));
      this.fSort = h('select', { 'aria-label': 'Sort' }, h('option', { value: 'score' }, 'Best match'), h('option', { value: 'rcsb_accession_info.initial_release_date' }, 'Newest first'), h('option', { value: 'rcsb_entry_info.resolution_combined' }, 'Best resolution'));
      const filters = h('div.ex-filters', this.mode,
        h('label', this.fHuman, h('span', 'Human only')),
        h('label', this.fDNA, h('span', 'Contains DNA')),
        this.fMethod, this.fSort);
      this.body = h('div.ex-body');
      r.append(h('div.ex-top', h('div.logo', { html: MG.icon('cube') + 'PDB<small>RCSB</small>' }), this.form, filters), this.body);
      this.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = this.input.value.trim();
        if (q) this.search(q);
      });
      [this.fHuman, this.fDNA, this.fMethod, this.fSort, this.mode].forEach((x) => x.addEventListener('change', () => this.state.query && this.search(this.state.query)));
    }

    renderIntro() {
      this.body.innerHTML = '';
      const ex = (q, mode) => {
        const b = h('button.chip', { type: 'button' }, q);
        b.addEventListener('click', () => {
          this.mode.value = mode || 'auto';
          this.search(q);
        });
        return b;
      };
      this.body.append(h('div.ex-empty',
        h('div', { html: MG.icon('cube') }),
        h('h3', 'Search the Protein Data Bank'),
        h('p', 'Every experimentally determined structure has a 4-character PDB ID (e.g. 3FXI). Search by ID, by protein name, by UniProt accession or by any text.'),
        h('p', 'Try: ', ex('3FXI'), ' ', ex('Toll-like receptor 4', 'name'), ' ', ex('O00206', 'uniprot'), ' ', ex('TATA-box-binding protein', 'name')),
        h('p.hint', 'Live data from the RCSB PDB search and data services.')));
    }

    _detect(q) {
      const m = this.mode.value;
      if (m !== 'auto') return m;
      if (/^[0-9][A-Za-z0-9]{3}$/.test(q)) return 'id';
      if (/^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i.test(q)) return 'uniprot';
      return 'name';
    }

    async search(q, opts = {}) {
      MG.app.showWorkbench && MG.app.showWorkbench('pdb');
      if (opts.mode) this.mode.value = opts.mode;
      if (opts.human != null) this.fHuman.checked = !!opts.human;
      if (opts.dna != null) this.fDNA.checked = !!opts.dna;
      if (opts.method != null) this.fMethod.value = opts.method;
      if (opts.sort) this.fSort.value = opts.sort;
      this.input.value = q;
      const kind = this._detect(q.trim());
      if (kind === 'id') return this.entry(q.trim().toUpperCase());
      if (q !== this.state.query || !opts.keepPage) this.state.page = opts.page || 0;
      this.state.query = q;
      this.state.kind = kind;
      const nodes = [];
      const tx = (attribute, operator, value) => ({ type: 'terminal', service: 'text', parameters: { attribute, operator, value } });
      if (kind === 'uniprot') {
        nodes.push(tx('rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession', 'exact_match', q.trim().toUpperCase()));
        nodes.push(tx('rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_name', 'exact_match', 'UniProt'));
      } else if (kind === 'name') {
        nodes.push({ type: 'group', logical_operator: 'or', nodes: [tx('rcsb_uniprot_protein.name.value', 'contains_phrase', q.trim()), tx('rcsb_polymer_entity.pdbx_description', 'contains_phrase', q.trim())] });
      } else nodes.push({ type: 'terminal', service: 'full_text', parameters: { value: q.trim() } });
      if (this.fHuman.checked) nodes.push(tx('rcsb_entity_source_organism.ncbi_scientific_name', 'exact_match', 'Homo sapiens'));
      if (this.fDNA.checked) nodes.push(tx('entity_poly.rcsb_entity_polymer_type', 'exact_match', 'DNA'));
      if (this.fMethod.value) nodes.push(tx('exptl.method', 'exact_match', this.fMethod.value));
      const sortBy = this.fSort.value;
      const body = {
        query: nodes.length === 1 ? nodes[0] : { type: 'group', logical_operator: 'and', nodes },
        return_type: 'entry',
        request_options: {
          paginate: { start: this.state.page * 10, rows: 10 },
          results_content_type: ['experimental'],
          sort: [{ sort_by: sortBy, direction: sortBy === 'rcsb_entry_info.resolution_combined' ? 'asc' : 'desc' }]
        }
      };
      this.body.innerHTML = '';
      this.body.appendChild(h('div.ex-status', 'Searching the PDB…'));
      try {
        const r = await MG.fetchWithTimeout(SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 30000);
        let res = { total_count: 0, result_set: [] };
        if (r.status !== 204) res = await r.json();
        const ids = (res.result_set || []).map((x) => x.identifier);
        let entries = [];
        if (ids.length) entries = (await gql(SUMMARY_Q, { ids })).entries || [];
        const order = new Map(ids.map((id, k) => [id, k]));
        entries.sort((a, b) => order.get(a.rcsb_id) - order.get(b.rcsb_id));
        this.state.total = res.total_count || 0;
        this.state.entries = entries;
        if (MG.apiTools) MG.apiTools.record({ service: 'PDB', label: `search: ${q}`, method: 'POST', url: SEARCH, json: body });
        this.renderResults();
        bus.emit('pdb:search', { query: q, kind, total: this.state.total, human: this.fHuman.checked, dna: this.fDNA.checked, method: this.fMethod.value, sort: sortBy });
      } catch (e) {
        this.body.innerHTML = '';
        this.body.appendChild(h('div.ex-empty', h('h3', 'The PDB could not be reached'), h('p', e.message), h('p.hint', 'Check the internet connection, and try again. The example structure /data/examples/structures/1mbn.pdb opens without it (Files tab).')));
      }
    }

    renderResults() {
      const st = this.state;
      this.body.innerHTML = '';
      const kindTxt = { uniprot: 'UniProt accession', name: 'protein name', text: 'text' }[st.kind] || st.kind;
      const f = [this.fHuman.checked ? 'human' : '', this.fDNA.checked ? 'with DNA' : '', this.fMethod.value ? method(this.fMethod.value)[0] : ''].filter(Boolean).join(', ');
      this.body.appendChild(h('div.ex-status', { html: `<b>${MG.fmt(st.total)}</b> structure${st.total === 1 ? '' : 's'} for ${esc(kindTxt)} “${esc(st.query)}”${f ? ' · ' + f : ''}${st.total > 10 ? ` · page ${st.page + 1} of ${Math.ceil(st.total / 10)}` : ''}` }));
      if (!st.entries.length) {
        this.body.appendChild(h('p.muted', 'No structures found.'));
        return;
      }
      st.entries.forEach((e) => this.body.appendChild(this._card(e)));
      if (st.total > 10) {
        const prev = h('button.btn.small', { type: 'button', text: '← Previous', disabled: st.page === 0 });
        const next = h('button.btn.small', { type: 'button', text: 'Next →', disabled: (st.page + 1) * 10 >= st.total });
        prev.addEventListener('click', () => this.search(st.query, { page: st.page - 1, keepPage: true }));
        next.addEventListener('click', () => this.search(st.query, { page: st.page + 1, keepPage: true }));
        this.body.appendChild(h('div.pager', prev, next));
      }
    }
    _card(e) {
      const id = e.rcsb_id;
      const m = (e.exptl || [])[0] ? e.exptl[0].method : '';
      const [mName, mCls] = method(m);
      const res = e.rcsb_entry_info && e.rcsb_entry_info.resolution_combined ? e.rcsb_entry_info.resolution_combined[0] : null;
      const orgs = new Set();
      (e.polymer_entities || []).forEach((p) => (p.rcsb_entity_source_organism || []).forEach((o) => o && o.ncbi_scientific_name && orgs.add(o.ncbi_scientific_name)));
      const img = h('img.thumb', { src: thumb(id), alt: '', loading: 'lazy' });
      img.addEventListener('error', () => (img.style.visibility = 'hidden'));
      const load = h('button.btn.small.primary', { type: 'button', html: MG.icon('cube') + '<span>Load in 3D</span>' });
      load.addEventListener('click', () => MG.app.viewerRun('load ' + id));
      const det = h('button.btn.small', { type: 'button', text: 'Details' });
      det.addEventListener('click', () => this.entry(id));
      const ligs = (e.rcsb_entry_info && e.rcsb_entry_info.nonpolymer_bound_components) || [];
      return h('div.pdb-card', img, h('div',
        h('div.id', id),
        h('div.title', MG.niceDesc(e.struct ? e.struct.title : '')),
        h('div.facts',
          h('span', { html: `<b class="method-${mCls}">${esc(mName)}</b>${res ? ' · ' + res.toFixed(2) + ' Å' : ''}` }),
          h('span', 'Released ' + ((e.rcsb_accession_info || {}).initial_release_date || '').slice(0, 10)),
          orgs.size ? h('span', Array.from(orgs).slice(0, 3).join(', ')) : null,
          e.rcsb_entry_info ? h('span', e.rcsb_entry_info.deposited_polymer_entity_instance_count + ' chain' + (e.rcsb_entry_info.deposited_polymer_entity_instance_count === 1 ? '' : 's')) : null,
          ligs.length ? h('span', 'Ligands: ' + ligs.slice(0, 6).join(', ') + (ligs.length > 6 ? '…' : '')) : null),
        h('div.acts', load, det, h('span', { html: ext('https://www.rcsb.org/structure/' + id, 'RCSB') }))));
    }

    /* ---------- entry details ---------- */
    async entry(id) {
      id = id.toUpperCase();
      MG.app.showWorkbench && MG.app.showWorkbench('pdb');
      this.input.value = id;
      this.body.innerHTML = '';
      this.body.appendChild(h('div.ex-status', 'Loading ' + id + '…'));
      let e;
      try {
        e = (await gql(ENTRY_Q, { id })).entry;
        if (!e) throw new Error('No PDB entry ' + id);
      } catch (err) {
        this.body.innerHTML = '';
        this.body.appendChild(h('div.ex-empty', h('h3', 'Could not load ' + id), h('p', err.message)));
        return;
      }
      if (MG.apiTools) MG.apiTools.record({ service: 'PDB', label: `entry ${id}`, url: `https://data.rcsb.org/rest/v1/core/entry/${id}` });
      this.renderEntry(e);
      bus.emit('pdb:entry', { id });
    }

    renderEntry(e) {
      const B = this.body;
      B.innerHTML = '';
      const id = e.rcsb_id;
      const crumbs = h('div.ex-crumbs');
      if (this.state.entries && this.state.entries.length) {
        const back = h('button', { type: 'button' }, '← Back to results');
        back.addEventListener('click', () => this.renderResults());
        crumbs.append(back, h('span', '·'));
      }
      crumbs.append(h('span', 'PDB'), h('span', '›'), h('span', id), h('span', '·'), h('span', { html: ext('https://www.rcsb.org/structure/' + id, 'Open at RCSB PDB') }), h('span', '·'), h('span', { html: ext('https://www.ebi.ac.uk/pdbe/entry/pdb/' + id.toLowerCase(), 'PDBe') }));
      const m = (e.exptl || [])[0] ? e.exptl[0].method : '';
      const [mName, mCls] = method(m);
      const info = e.rcsb_entry_info || {};
      const res = info.resolution_combined ? info.resolution_combined[0] : null;
      const load = h('button.btn.primary', { type: 'button', html: MG.icon('cube') + '<span>Load in 3D viewer</span>' });
      load.addEventListener('click', () => MG.app.viewerRun('load ' + id));
      const img = h('img.thumb', { src: thumb(id), alt: 'Image of ' + id, style: { width: '120px', height: '120px' } });
      img.addEventListener('error', () => img.remove());
      B.append(crumbs,
        h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } }, img,
          h('div',
            h('div.entry-h', h('span.acc', id), h('h2', MG.niceDesc(e.struct.title))),
            h('div.entry-sub',
              h('span', { html: `Method: <b class="method-${mCls}">${esc(mName)}</b>` }),
              res ? h('span', { html: `Resolution: <b>${res.toFixed(2)} Å</b>` }) : null,
              h('span', { html: `Released: <b>${esc(((e.rcsb_accession_info || {}).initial_release_date || '').slice(0, 10))}</b>` }),
              info.deposited_atom_count ? h('span', { html: `Atoms: <b>${MG.fmt(info.deposited_atom_count)}</b>` }) : null),
            h('div', { style: { marginTop: '8px' } }, load))));
      const c = e.rcsb_primary_citation;
      if (c) {
        const au = (c.rcsb_authors || []).slice(0, 4).join(', ') + ((c.rcsb_authors || []).length > 4 ? ' et al.' : '');
        B.appendChild(h('p.hint', { html: `Paper: <b>${esc(c.title || '')}</b> ${esc(au)} <i>${esc(c.journal_abbrev || '')}</i> ${esc(c.year || '')}${c.pdbx_database_id_PubMed ? ' · ' + ext('https://pubmed.ncbi.nlm.nih.gov/' + c.pdbx_database_id_PubMed + '/', 'PubMed') : ''}${c.pdbx_database_id_DOI ? ' · ' + ext('https://doi.org/' + c.pdbx_database_id_DOI, 'DOI') : ''}` }));
      }
      // macromolecules
      const sec1 = h('section.sec', h('h3', 'Macromolecules'));
      const t = h('table.ftable');
      t.appendChild(h('tr', h('th', 'Molecule'), h('th', 'Chains'), h('th', 'Type'), h('th', 'Length'), h('th', 'Organism'), h('th', 'UniProt')));
      (e.polymer_entities || []).forEach((p) => {
        const ids = (p.rcsb_polymer_entity_container_identifiers || {});
        const up = (ids.uniprot_ids || []).map((a) => {
          const b = h('button.linkbtn', { type: 'button', title: 'Open this UniProt entry' }, a);
          b.addEventListener('click', async () => {
            await MG.app.showWorkbench('uniprot');
            if (MG.app.uniprot) MG.app.uniprot.open(a);
          });
          return b;
        });
        t.appendChild(h('tr',
          h('td', h('b', MG.niceDesc(p.rcsb_polymer_entity.pdbx_description))),
          h('td.mono', (ids.auth_asym_ids || []).join(', ')),
          h('td', (p.entity_poly || {}).rcsb_entity_polymer_type || ''),
          h('td', String((p.entity_poly || {}).rcsb_sample_sequence_length || '')),
          h('td', ((p.rcsb_entity_source_organism || [])[0] || {}).ncbi_scientific_name || ''),
          h('td', ...up)));
      });
      sec1.appendChild(t);
      B.appendChild(sec1);
      // small molecules
      const nps = e.nonpolymer_entities || [];
      const br = e.branched_entities || [];
      const sec2 = h('section.sec', h('h3', 'Small molecules (ligands, ions, sugars)'));
      if (nps.length) {
        const grid = h('div.lig-grid');
        nps.forEach((n) => {
          const cc = n.nonpolymer_comp.chem_comp;
          const im = h('img', { src: ccdImg(cc.id), alt: 'Chemical structure of ' + cc.id, loading: 'lazy' });
          im.addEventListener('error', () => im.remove());
          grid.appendChild(h('div.lig', im, h('div', h('b', cc.id), ' ', MG.niceDesc(cc.name)), h('div.muted', cc.formula + ' · chains ' + ((n.rcsb_nonpolymer_entity_container_identifiers || {}).auth_asym_ids || []).join(', '))));
        });
        sec2.appendChild(grid);
      } else sec2.appendChild(h('p.muted', 'No small-molecule ligands.'));
      if (br.length) {
        sec2.appendChild(h('h4', 'Branched sugars (oligosaccharides)'));
        const ul = h('ul');
        br.forEach((b) => ul.appendChild(h('li', { html: `<span class="mono">${esc(((b.rcsb_branched_entity_container_identifiers || {}).auth_asym_ids || []).join(', '))}</span>: ${esc(b.rcsb_branched_entity.pdbx_description)}` })));
        sec2.appendChild(ul);
      }
      B.appendChild(sec2);
      // assemblies
      const asm = e.assemblies || [];
      if (asm.length) {
        const sec3 = h('section.sec', h('h3', 'Biological assemblies'));
        sec3.appendChild(h('p', `The file contains ${info.deposited_polymer_entity_instance_count} polymer chain${info.deposited_polymer_entity_instance_count === 1 ? '' : 's'} (the “asymmetric unit”). The depositors/software suggest ${asm.length} biological assembl${asm.length === 1 ? 'y' : 'ies'} – the unit thought to exist in the cell:`));
        const ul = h('ul');
        asm.slice(0, 8).forEach((a) => {
          const psa = Array.isArray(a.pdbx_struct_assembly) ? a.pdbx_struct_assembly[0] : a.pdbx_struct_assembly;
          ul.appendChild(h('li', `Assembly ${a.rcsb_assembly_info.assembly_id}: ${psa ? psa.oligomeric_details : ''} (${a.rcsb_assembly_info.polymer_entity_instance_count} chain${a.rcsb_assembly_info.polymer_entity_instance_count === 1 ? '' : 's'}; ${psa ? psa.details.replace(/_/g, ' ') : ''})`));
        });
        if (asm.length > 8) ul.appendChild(h('li.muted', '… and ' + (asm.length - 8) + ' more'));
        sec3.appendChild(ul);
        B.appendChild(sec3);
      }
      // files
      const sec4 = h('section.sec', h('h3', 'Files – it’s just text!'));
      const mine = !!MG.apiTools;
      const dPDB = h('button.btn.small', { type: 'button', html: MG.icon('download') + (mine ? '<span>Save .pdb to my files</span>' : '<span>PDB format (.pdb)</span>') });
      const dCIF = h('button.btn.small', { type: 'button', html: MG.icon('download') + (mine ? '<span>Save .cif to my files</span>' : '<span>mmCIF (.cif)</span>') });
      const view = h('button.btn.small', { type: 'button', html: MG.icon('text') + '<span>Look inside the .pdb file</span>' });
      dPDB.addEventListener('click', () => this.download(id, 'pdb'));
      dCIF.addEventListener('click', () => this.download(id, 'cif'));
      view.addEventListener('click', () => this.fileText(id, sec4));
      let nb = null;
      if (mine) {
        nb = h('button.btn.small', { type: 'button', title: 'Add Python or R code that fetches this entry and its file to a notebook', html: MG.icon('notebook') + '<span>Send to notebook</span>' });
        nb.addEventListener('click', () => MG.apiTools.sendCode(nb, `PDB: ${id} ${MG.niceDesc(e.struct.title)}`, entryCode(id)));
      }
      sec4.appendChild(h('p', 'Structures are stored as text files listing every atom and its x, y, z coordinates. The old ', h('b', '.pdb'), ' format is read by most programs; the newer ', h('b', '.cif'), ' (mmCIF) format is needed for very large structures.'));
      sec4.appendChild(h('div.q-actions', view, dPDB, dCIF, nb));
      B.appendChild(sec4);
      B.scrollTop = 0;
    }

    async download(id, fmt) {
      const url = `https://files.rcsb.org/download/${id}.${fmt}`;
      try {
        const r = await MG.fetchWithTimeout(url, {}, 60000);
        const blob = await r.blob();
        if (MG.apiTools) {
          // (the workbench: among your files, for the 3D viewer, the terminal and notebooks)
          MG.apiTools.record({ service: 'PDB', label: `${id}.${fmt}`, url, expect: 'text' });
          await MG.apiTools.saveFile(`${id}.${fmt}`, await blob.text(), { folder: '~/structures' });
          bus.emit('pdb:download', { id, fmt });
          return;
        }
        MG.downloadBlob(new Blob([blob], { type: fmt === 'pdb' ? 'chemical/x-pdb' : 'chemical/x-cif' }), `${id}.${fmt}`);
        toast(`Saved <b>${id}.${fmt}</b>`);
        bus.emit('pdb:download', { id, fmt });
      } catch (e) {
        if (fmt === 'pdb' && e.status === 404) toast(`${id} is too large for the old PDB format – use mmCIF instead.`, 'warn', 6000);
        else toast('Download failed: ' + esc(e.message), 'error');
      }
    }

    async fileText(id, sec) {
      let box = sec.querySelector('.filebox');
      if (!box) {
        box = h('div.filebox');
        sec.appendChild(box);
      }
      box.innerHTML = '<p class="hint">Downloading ' + id + '.pdb…</p>';
      let text;
      try {
        text = await MG.fetchText(`https://files.rcsb.org/download/${id}.pdb`, {}, 60000);
      } catch (e) {
        box.innerHTML = `<p class="hint">Could not fetch the PDB-format file (${esc(e.message)}). Large entries only exist as mmCIF.</p>`;
        return;
      }
      const lines = text.split('\n');
      const pick = [];
      const want = (re, n) => {
        let k = 0;
        for (const l of lines) {
          if (re.test(l)) {
            pick.push(l);
            if (++k >= n) break;
          }
        }
      };
      want(/^HEADER/, 1); want(/^TITLE/, 3); want(/^COMPND/, 6); want(/^SOURCE/, 3); want(/^EXPDTA/, 1); want(/^REMARK   2 RESOLUTION/, 1);
      pick.push('...');
      want(/^SEQRES/, 3);
      pick.push('...');
      want(/^ATOM/, 12);
      pick.push('...');
      want(/^HETATM/, 6);
      pick.push('...');
      const colour = (l) => {
        if (!/^(ATOM  |HETATM)/.test(l)) return `<span class="c6">${esc(l.slice(0, 6))}</span>${esc(l.slice(6))}`;
        const seg = (a, b, c) => `<span class="${c}">${esc(l.slice(a, b))}</span>`;
        return seg(0, 6, 'c6') + esc(l.slice(6, 12)) + seg(12, 16, 'c1') + esc(l.slice(16, 17)) + seg(17, 20, 'c2') + esc(l.slice(20, 21)) + seg(21, 22, 'c3') + seg(22, 26, 'c4') + esc(l.slice(26, 30)) + seg(30, 54, 'c5') + esc(l.slice(54, 60)) + `<span style="color:#fff;background:#445">${esc(l.slice(60, 66))}</span>` + esc(l.slice(66));
      };
      box.innerHTML = '';
      box.appendChild(h('div.pdbline', { html: pick.map(colour).join('\n') }));
      box.appendChild(h('div.pdbline.legend', { html: 'Columns in ATOM / HETATM lines:  <span class="c1">atom name</span>  <span class="c2">residue</span>  <span class="c3">chain</span>  <span class="c4">residue number</span>  <span class="c5">x, y, z (Å)</span>  occupancy  <span style="color:#fff;background:#445">B-factor</span>' }));
      box.appendChild(h('p.hint', `The full file has ${MG.fmt(lines.length)} lines – one per atom, plus header records.`));
      bus.emit('pdb:file', { id, lines: lines.length });
    }

    /* ---------- coverage of a UniProt entry ---------- */
    async coverage(acc) {
      await MG.app.showWorkbench('uniprot');
      if (MG.app.uniprot) MG.app.uniprot.open(acc, 'structure');
    }
  }

  /** Python and R code that fetches an entry and its file */
  function entryCode(id) {
    return {
      python: [
        'import requests',
        '',
        `pdb_id = "${id}"`,
        'entry = requests.get(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}").json()',
        'print(entry["struct"]["title"])',
        'print("method:", entry["exptl"][0]["method"], "· resolution (Å):", entry["rcsb_entry_info"].get("resolution_combined"))',
        '',
        '# the structure file, saved next to the notebook (very large entries exist only as .cif: use MMCIFParser)',
        'with open(f"{pdb_id}.pdb", "w") as fh:',
        '    fh.write(requests.get(f"https://files.rcsb.org/download/{pdb_id}.pdb").text)',
        '',
        'from Bio.PDB import PDBParser',
        'structure = PDBParser(QUIET=True).get_structure(pdb_id, f"{pdb_id}.pdb")',
        'for chain in structure[0]:',
        '    print("chain", chain.id, len(chain), "residues")'
      ].join('\n'),
      r: [
        'library(jsonlite)',
        '',
        `pdb_id <- "${id}"`,
        'entry <- fromJSON(paste0("https://data.rcsb.org/rest/v1/core/entry/", pdb_id))',
        'entry$struct$title',
        'entry$exptl$method',
        '',
        '# the structure file: one line per atom',
        'pdb <- readLines(paste0("https://files.rcsb.org/download/", pdb_id, ".pdb"))',
        'atoms <- grep("^ATOM", pdb, value = TRUE)',
        'length(atoms)',
        'writeLines(pdb, paste0(pdb_id, ".pdb"))'
      ].join('\n')
    };
  }

  MG.PDBExplorer = PDBExplorer;
})();
