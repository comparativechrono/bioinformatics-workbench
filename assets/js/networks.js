/* =====================================================================
   The Networks tab: networks of interacting genes, proteins or anything
   else – drawn with Cytoscape.js (MIT licence, the Cytoscape
   Consortium), with the tools of a desktop network program:

     · open SIF, GraphML, XGMML, GML, Cytoscape JSON, CX2 and tables of
       edges; networks from STRING, IntAct and NDEx; examples
     · style: colour, size, shape, labels … fixed, or mapped from the
       columns of the node and edge tables (continuous, discrete), with
       a legend; charts of several columns on the nodes
     · tables of the nodes and edges: sort, edit, import a table and join
       it to the nodes (e.g. DESeq2 results onto a protein network)
     · select: by filters, neighbours, shortest paths; subnetworks; merge
     · analyse (net-algo.js, in a worker – net-worker.js): the statistics
       of Cytoscape's Analyzer, the hub rankings of cytoHubba, clusters
       (MCODE, MCL, Louvain), components, k-cores; functional enrichment
       (STRING, g:Profiler)
     · layouts (fCoSE, CoSE, circle, concentric, grid, hierarchical –
       dagre –, tree, groups); undo
     · save: pictures (PNG, SVG), Cytoscape JSON, GraphML, SIF, tables,
       and code for a notebook (networkx, igraph)
   The networks that are open are kept in ~/.networks/session.json.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;
  const IO = MG.netIO, ALG = MG.netAlgo;
  const HOME = () => (MG.app && MG.app.HOME) || '/home/user';
  const SESSION = () => HOME() + '/.networks/session.json';
  const enc = encodeURIComponent;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const CALLER = 'bioinformatics_workbench';

  /* ------------------------------------------------------------------
     species, colours, shapes
     ------------------------------------------------------------------ */
  const SPECIES = [
    ['9606', 'Human (Homo sapiens)'], ['10090', 'Mouse (Mus musculus)'], ['10116', 'Rat (Rattus norvegicus)'], ['7955', 'Zebrafish (Danio rerio)'],
    ['7227', 'Fruit fly (Drosophila melanogaster)'], ['6239', 'Worm (Caenorhabditis elegans)'], ['4932', 'Yeast (Saccharomyces cerevisiae)'],
    ['3702', 'Arabidopsis thaliana'], ['511145', 'Escherichia coli K-12'], ['9913', 'Cow (Bos taurus)'], ['9031', 'Chicken (Gallus gallus)'], ['9823', 'Pig (Sus scrofa)']
  ];
  const SPECIES_NAME = Object.fromEntries(SPECIES);
  const GPROFILER_ORG = { 9606: 'hsapiens', 10090: 'mmusculus', 10116: 'rnorvegicus', 7955: 'drerio', 7227: 'dmelanogaster', 6239: 'celegans', 4932: 'scerevisiae', 3702: 'athaliana', 9913: 'btaurus', 9031: 'ggallus', 9823: 'sscrofa' };
  // the categorical colours: eight, in this order (checked for colour-blind readers); more values than that are grey
  const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const OTHER = '#c4c9cf', MISSING = '#e4e7eb';
  const PALETTES = {
    diverging: { label: 'blue – grey – red (down / up)', stops: ['#1c5cab', '#86b6ef', '#f0efec', '#f19a99', '#b42c2b'] },
    sequential: { label: 'light to dark blue', stops: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'] },
    reds: { label: 'light to dark red', stops: ['#fbe3e2', '#f4b1b0', '#ea7b7a', '#d84a49', '#b02d2c', '#7d1d1c'] },
    greys: { label: 'light to dark grey', stops: ['#e9ecef', '#c3c9d0', '#8e98a3', '#5c6773', '#2f3741'] }
  };
  const SHAPES = ['ellipse', 'round-rectangle', 'rectangle', 'diamond', 'triangle', 'hexagon', 'octagon', 'star', 'vee', 'barrel', 'round-triangle'];
  const LINES = ['solid', 'dashed', 'dotted'];
  const ARROWS = ['none', 'triangle', 'tee', 'vee', 'circle', 'square', 'diamond'];
  const SEL = '#eb6834';

  /* colours mixed in OKLab, so that the steps between them look even */
  const hexRgb = (x) => {
    let s = String(x).replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  };
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const LAB = new Map();
  function oklab(hex) {
    if (LAB.has(hex)) return LAB.get(hex);
    let [r, g, b] = hexRgb(hex).map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const out = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    LAB.set(hex, out);
    return out;
  }
  function labHex([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return '#' + rgb.map((c) => Math.round(clamp(fromLin(clamp(c, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  }
  function ramp(stops, t) {
    const k = stops.length - 1, x = clamp(t, 0, 1) * k, i = Math.min(k - 1, Math.floor(x)), f = x - i;
    const A = oklab(stops[i]), B = oklab(stops[i + 1]);
    return labHex([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
  }
  const TRANSFORMS = {
    none: { label: 'as it is', f: (v) => v },
    abs: { label: 'size of it (|x|)', f: (v) => Math.abs(v) },
    neglog10: { label: '−log₁₀ (for p-values)', f: (v) => (v > 0 ? -Math.log10(Math.max(v, 1e-300)) : v === 0 ? 300 : NaN) },
    log10: { label: 'log₁₀', f: (v) => (v > 0 ? Math.log10(v) : NaN) }
  };

  /* numbers in tables and legends */
  function fmt(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v);
      if (Number.isInteger(v)) return Math.abs(v) >= 1e7 ? v.toExponential(3) : v.toLocaleString('en-GB');
      const a = Math.abs(v);
      if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(2);
      return String(+v.toPrecision(4));
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }
  const plural = (n, a, b) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? a : b || a + 's'}`;
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ------------------------------------------------------------------
     the style of a network: what the mappings are; the page turns them into data fields (_f, _s …) of each element,
     which Cytoscape.js draws (see SHEET)
     ------------------------------------------------------------------ */
  const PROPS = {
    node: [
      ['fill', 'Fill colour', 'color'], ['size', 'Size', 'number', [10, 120]], ['shape', 'Shape', 'enum', SHAPES], ['label', 'Label', 'text'],
      ['labelSize', 'Label size', 'number', [4, 40]], ['border', 'Border colour', 'color'], ['borderWidth', 'Border width', 'number', [0, 12]],
      ['opacity', 'Opacity', 'number', [0.05, 1]]
    ],
    edge: [
      ['color', 'Colour', 'color'], ['width', 'Width', 'number', [0.5, 14]], ['line', 'Line', 'enum', LINES], ['arrow', 'Arrow', 'enum', ARROWS],
      ['opacity', 'Opacity', 'number', [0.05, 1]], ['label', 'Label', 'text']
    ]
  };
  function defaultStyle() {
    return {
      node: {
        fill: { mode: 'fixed', value: '#9ec5f4' }, size: { mode: 'fixed', value: 30 }, shape: { mode: 'fixed', value: 'ellipse' },
        label: { mode: 'attr', attr: 'name' }, labelSize: { mode: 'fixed', value: 10 }, border: { mode: 'fixed', value: '#256abf' },
        borderWidth: { mode: 'fixed', value: 1.5 }, opacity: { mode: 'fixed', value: 1 }, chart: { mode: 'none' }
      },
      edge: {
        color: { mode: 'fixed', value: '#a5afba' }, width: { mode: 'fixed', value: 1.6 }, line: { mode: 'fixed', value: 'solid' },
        arrow: { mode: 'fixed', value: 'none' }, opacity: { mode: 'fixed', value: 0.85 }, label: { mode: 'none' }
      },
      legend: true
    };
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const SHEET = [
    {
      selector: 'node',
      style: {
        'background-color': 'data(_f)', width: 'data(_s)', height: 'data(_s)', shape: 'data(_sh)', label: 'data(_l)', 'font-size': 'data(_fs)',
        'border-color': 'data(_bc)', 'border-width': 'data(_bw)', opacity: 'data(_o)', color: '#18212f', 'text-valign': 'bottom', 'text-halign': 'center',
        'text-margin-y': 2, 'text-outline-color': '#ffffff', 'text-outline-width': 1.6, 'text-outline-opacity': 0.9, 'min-zoomed-font-size': 5,
        'font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', 'overlay-opacity': 0
      }
    },
    {
      selector: 'node[_pn > 0]',
      style: Object.assign({ 'pie-size': '100%', 'pie-hole': 'data(_ph)' }, ...Array.from({ length: 8 }, (_, i) => ({ [`pie-${i + 1}-background-color`]: `data(_p${i + 1})`, [`pie-${i + 1}-background-size`]: `data(_q${i + 1})` })))
    },
    {
      selector: 'edge',
      style: {
        'line-color': 'data(_c)', width: 'data(_w)', 'line-style': 'data(_ls)', 'target-arrow-shape': 'data(_ta)', 'target-arrow-color': 'data(_c)',
        'arrow-scale': 0.9, 'curve-style': 'bezier', opacity: 'data(_o)', label: 'data(_l)', 'font-size': 8, color: '#52514e', 'text-rotation': 'autorotate',
        'text-outline-color': '#ffffff', 'text-outline-width': 1.2, 'min-zoomed-font-size': 6, 'overlay-opacity': 0
      }
    },
    { selector: 'node:selected', style: { 'border-color': SEL, 'border-width': 4, 'z-index': 20 } },
    { selector: 'edge:selected', style: { 'line-color': SEL, 'target-arrow-color': SEL, 'z-index': 20, opacity: 1 } },
    { selector: 'node.hit', style: { 'underlay-color': '#eda100', 'underlay-opacity': 0.55, 'underlay-padding': 7, 'underlay-shape': 'ellipse' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: '.hidden', style: { display: 'none' } }
  ];

  /** the values of a column (after a transform), finite ones */
  function rangeOf(eles, attr, tf) {
    let lo = Infinity, hi = -Infinity;
    eles.forEach((e) => {
      const v = tf(Number(e.data(attr)));
      if (e.data(attr) == null || e.data(attr) === '' || !isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    return isFinite(lo) ? [lo, hi] : null;
  }
  /** the q-quantile of the finite values of a column (after a transform) – of their distance from mid, if mid is given */
  function quantileOf(eles, attr, tf, q, mid) {
    const v = [];
    eles.forEach((e) => {
      const x = e.data(attr);
      if (x == null || x === '') return;
      const y = tf(Number(x));
      if (isFinite(y)) v.push(mid == null ? y : Math.abs(y - mid));
    });
    if (!v.length) return null;
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
  }
  /** an element → its value of one visual property */
  function evaluator(map, kind, eles, fallback) {
    if (!map || map.mode === 'fixed') {
      const v = map ? map.value : fallback;
      return () => v;
    }
    if (map.mode === 'none') return () => (kind === 'text' ? '' : fallback);
    if (map.mode === 'attr') {
      return (e) => {
        const v = e.data(map.attr);
        return v == null ? '' : kind === 'text' ? fmt(v) : v;
      };
    }
    if (map.mode === 'continuous') {
      const tf = (TRANSFORMS[map.transform || 'none'] || TRANSFORMS.none).f;
      let r = map.auto === false && isNum(map.min) && isNum(map.max) ? [map.min, map.max] : rangeOf(eles, map.attr, tf);
      if (!r) r = [0, 1];
      let [lo, hi] = r;
      const full = [lo, hi];
      const diverging = kind === 'color' && (map.palette || 'sequential') === 'diverging';
      if (diverging && map.auto !== false) {
        const mid = isNum(map.mid) ? map.mid : 0;
        let m = Math.max(Math.abs(lo - mid), Math.abs(hi - mid)) || 1;
        // (a share of the values: the rest – outliers – get the colour of the end of the scale)
        if (map.clip) m = Math.min(m, Math.max(0.5, Math.ceil((quantileOf(eles, map.attr, tf, map.clip, mid) || m) * 2) / 2));
        lo = mid - m;
        hi = mid + m;
      } else if (map.clip && map.auto !== false) {
        const qh = quantileOf(eles, map.attr, tf, map.clip);
        if (qh != null && qh > lo) hi = Math.min(hi, +qh.toPrecision(2));
      }
      map._range = [lo, hi];
      map._clipped = [full[0] < lo - 1e-12, full[1] > hi + 1e-12];
      const out = map.out || [];
      const missing = kind === 'color' ? MISSING : fallback;
      const stops = (PALETTES[map.palette || 'sequential'] || PALETTES.sequential).stops;
      return (e) => {
        const raw = e.data(map.attr);
        if (raw == null || raw === '') return missing;
        const v = tf(Number(raw));
        if (!isFinite(v)) return missing;
        const t = hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5;
        if (kind === 'color') return ramp(stops, t);
        const a = isNum(out[0]) ? out[0] : fallback, b = isNum(out[1]) ? out[1] : fallback;
        return a + t * (b - a);
      };
    }
    if (map.mode === 'discrete') {
      const assign = (map.map = map.map || {});
      // values met for the first time get the next colour (or shape …) of the list – in the order of their numbers, or
      // the most frequent first; past the end of the list: grey (or the fallback)
      const counts = new Map();
      eles.forEach((e) => {
        const v = e.data(map.attr);
        if (v == null || v === '') return;
        const k = String(v);
        counts.set(k, (counts.get(k) || 0) + 1);
      });
      const fresh = Array.from(counts.keys()).filter((k) => !(k in assign));
      if (fresh.length) {
        const nums = fresh.every((k) => isFinite(Number(k)));
        fresh.sort((a, b) => (nums ? Number(a) - Number(b) : counts.get(b) - counts.get(a) || a.localeCompare(b)));
        const list = kind === 'color' ? CAT : kind === 'enum' ? map.choices || [] : [];
        const used = new Set(Object.values(assign));
        for (const k of fresh) {
          const next = list.find((x) => !used.has(x));
          if (next != null) {
            assign[k] = next;
            used.add(next);
          }
        }
      }
      map._values = Array.from(counts.keys());
      const other = kind === 'color' ? OTHER : fallback;
      return (e) => {
        const v = e.data(map.attr);
        if (v == null || v === '') return kind === 'color' ? MISSING : fallback;
        const x = assign[String(v)];
        return x == null ? other : x;
      };
    }
    return () => fallback;
  }

  /* ------------------------------------------------------------------
     the worker that runs the analyses
     ------------------------------------------------------------------ */
  class Analyses {
    constructor() {
      this.w = null;
      this.seq = 0;
      this.pending = new Map();
    }
    _start() {
      if (this.w) return;
      this.w = new Worker('assets/js/net-worker.js');
      this.w.onmessage = (ev) => {
        const m = ev.data, p = this.pending.get(m.id);
        if (!p) return;
        if (m.progress != null) return p.progress && p.progress(m.progress);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
      };
      this.w.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'the analysis stopped'));
        this.pending.clear();
        this.w = null;
      };
    }
    run(fn, g, args, progress) {
      this._start();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, progress });
        this.w.postMessage({ id, fn, n: g.n, src: g.src, dst: g.dst, w: g.w, args: args || {} });
      });
    }
    cancel() {
      if (this.w) this.w.terminate();
      this.w = null;
      for (const p of this.pending.values()) p.reject(Object.assign(new Error('Stopped.'), { cancelled: true }));
      this.pending.clear();
    }
  }

  /* ------------------------------------------------------------------
     small pieces of the page
     ------------------------------------------------------------------ */
  function btn(icon, label, title, fn, cls) {
    const b = h('button.btn.small' + (cls || ''), { type: 'button', title: title || label, html: MG.icon(icon) + (label ? `<span class="lbl">${esc(label)}</span>` : '') });
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  function menuBtn(icon, label, title, items) {
    const b = h('button.btn.small', { type: 'button', title, 'aria-haspopup': 'menu', html: MG.icon(icon) + `<span class="lbl">${esc(label)}</span><span class="caret">▾</span>` });
    b.addEventListener('click', () => MG.popmenu(b, (typeof items === 'function' ? items() : items).filter(Boolean)));
    return b;
  }
  /** a menu at a point of the screen (right-click) */
  function menuAt(x, y, items) {
    const a = h('span', { style: { position: 'fixed', left: x + 'px', top: y + 'px', width: '1px', height: '1px' }, tabindex: '-1' });
    document.body.appendChild(a);
    MG.popmenu(a, items.filter(Boolean));
    setTimeout(() => a.remove(), 30000);
  }
  function select(options, value, attrs) {
    const s = h('select', attrs || {}, options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
    if (value != null) s.value = value;
    return s;
  }
  function field(label, input, note) {
    return h('label.fld', h('span', label), h('div', input, note ? h('p.note', note) : null));
  }
  /** a dialog with a form: build(body) adds the fields; → {m, body, acts} */
  function dialog(title, opts = {}) {
    const m = MG.modal(title, '');
    if (opts.wide) m.box.classList.add('net-wide');
    const body = h('form.net-dlg', { onsubmit: (e) => e.preventDefault() });
    m.box.querySelector('.modal-b').appendChild(body);
    const acts = h('div.acts');
    return { m, body, acts };
  }
  function previewTable(table, max = 6) {
    return h('div.preview', h('table', h('tr', table.columns.map((c) => h('th', c))), table.rows.slice(0, max).map((r) => h('tr', r.map((v) => h('td', String(v).slice(0, 40)))))));
  }
  /** the files among the user's (and the examples) whose names match re: newest first */
  function filesLike(re) {
    const fs = MG.app.fs, out = [];
    for (const [p, e] of fs.entries) {
      if (e.kind === 'dir' || !re.test(p)) continue;
      const mine = p.startsWith(HOME() + '/');
      if (!mine && !p.startsWith('/data/examples/')) continue;
      if (mine && /\/\./.test(p.slice(HOME().length))) continue;
      out.push([p, mine, e.mtime || 0]);
    }
    out.sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0].localeCompare(b[0]));
    return out.map((x) => x[0]);
  }
  /** a file named by a button or a command (~ allowed) → its full path, first in the list of files; null when there
      is no such file (with a message) */
  function preferFile(files, path) {
    if (!path) return null;
    const fs = MG.app.fs;
    const p = fs.resolve(path);
    if (!fs.exists(p)) {
      // (the RNA-seq recipe's table: there is a copy among the examples)
      const copy = /deseq2_dex_vs_untreated\.csv$/.test(p) && fs.exists('/data/examples/networks/airway_deseq2.csv');
      toast(`There is no file ${esc(fs.pretty(p))}${copy ? ' – the RNA-seq recipe writes it. Its copy among the examples is chosen instead.' : ': choose another table.'}`, 'warn', 8000);
      if (copy) {
        const c = '/data/examples/networks/airway_deseq2.csv';
        const i = files.indexOf(c);
        if (i >= 0) files.splice(i, 1);
        files.unshift(c);
        return c;
      }
      return null;
    }
    const i = files.indexOf(p);
    if (i >= 0) files.splice(i, 1);
    files.unshift(p);
    return p;
  }
  /** the key a name is matched by: without spaces around it, and without the version of an Ensembl ID
      (ENSG00000120129.5 = ENSG00000120129 – tables from GENCODE, Salmon or tximport have versions, STRING has none) */
  const ENS_VERSION = /^(ens[a-z]*[gtpe]\d{11})\.\d+$/i;
  const keyOf = (v, ci = true) => {
    const k = String(v).trim().replace(ENS_VERSION, '$1');
    return ci ? k.toLowerCase() : k;
  };
  const TABLE_RE = /\.(csv|tsv|tab|txt)$/i;
  const NET_RE = /\.(sif|graphml|xgmml|gml|cyjs|cx2)$/i;
  /** a file picked from the computer → {name, text} */
  function pickLocal(accept) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return resolve(null);
        resolve({ name: f.name, text: await f.text() });
      });
      inp.click();
    });
  }

  /* a small chart (SVG): points [[x, y]], bars or dots, linear or logarithmic axes */
  function chart(o) {
    const W = o.w || 300, H = o.h || 190, L = 44, R = 10, T = 12, B = 34;
    const pts = (o.points || []).filter(([x, y]) => isFinite(x) && isFinite(y) && (!o.logx || x > 0) && (!o.logy || y > 0));
    if (!pts.length) return h('p.net-hint', 'Nothing to draw.');
    const tx = o.logx ? Math.log10 : (v) => v, ty = o.logy ? Math.log10 : (v) => v;
    let x0 = Math.min(...pts.map((p) => tx(p[0]))), x1 = Math.max(...pts.map((p) => tx(p[0])));
    let y0 = o.logy ? Math.min(...pts.map((p) => ty(p[1]))) : Math.min(0, ...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => ty(p[1])));
    if (o.bars) {
      x0 -= 0.5;
      x1 += 0.5;
    }
    if (x1 === x0) {
      x0 -= 1;
      x1 += 1;
    }
    if (y1 === y0) y1 = y0 + 1;
    const sx = (v) => L + ((tx(v) - x0) / (x1 - x0)) * (W - L - R), sy = (v) => H - B - ((ty(v) - y0) / (y1 - y0)) * (H - T - B);
    const ticks = (a, b, log) => {
      if (log) {
        const out = [];
        for (let e = Math.floor(a); e <= Math.ceil(b); e++) if (e >= a - 1e-9 && e <= b + 1e-9) out.push(Math.pow(10, e));
        return out.length ? out : [Math.pow(10, a)];
      }
      const span = b - a, step = Math.pow(10, Math.floor(Math.log10(span / 4 || 1)));
      const st = [1, 2, 5, 10].map((k) => k * step).find((s) => span / s <= 5) || step * 10;
      const out = [];
      for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toPrecision(10));
      return out;
    };
    let s = `<svg class="net-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'chart')}">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
    for (const v of ticks(y0, y1, o.logy)) s += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="#eef1f4"/><text x="${L - 5}" y="${sy(v) + 3.5}" font-size="9.5" fill="#647086" text-anchor="end">${esc(fmt(v))}</text>`;
    for (const v of ticks(x0, x1, o.logx)) if (!o.bars || Number.isInteger(v)) s += `<text x="${sx(v)}" y="${H - B + 13}" font-size="9.5" fill="#647086" text-anchor="middle">${esc(fmt(v))}</text>`;
    s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#9aa5b1"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#9aa5b1"/>`;
    const bw = o.bars ? Math.max(2, Math.min(24, ((W - L - R) / (x1 - x0)) * 0.7)) : 0;
    for (const [x, y] of pts) {
      const tip = `<title>${esc(o.xlabel || 'x')}: ${esc(fmt(x))} – ${esc(o.ylabel || 'y')}: ${esc(fmt(y))}</title>`;
      if (o.bars) s += `<rect x="${sx(x) - bw / 2}" y="${sy(y)}" width="${bw}" height="${Math.max(0, H - B - sy(y))}" rx="${Math.min(3, bw / 3)}" fill="#2a78d6">${tip}</rect>`;
      else s += `<circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="#2a78d6" fill-opacity="0.85" stroke="#fff" stroke-width="1">${tip}</circle>`;
    }
    if (o.fit) {
      const pathPts = [];
      for (let i = 0; i <= 40; i++) {
        const lx = x0 + ((x1 - x0) * i) / 40, x = o.logx ? Math.pow(10, lx) : lx, y = o.fit.a * Math.pow(x, o.fit.b);
        if (y > 0 && (!o.logy || (ty(y) >= y0 - 0.5 && ty(y) <= y1 + 0.5))) pathPts.push(`${sx(x).toFixed(1)},${sy(y).toFixed(1)}`);
      }
      if (pathPts.length > 1) s += `<polyline points="${pathPts.join(' ')}" fill="none" stroke="#eb6834" stroke-width="2"/>`;
    }
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" font-size="10" fill="#18212f" text-anchor="middle">${esc(o.xlabel || '')}${o.logx ? ' (log scale)' : ''}</text>`;
    s += `<text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" font-size="10" fill="#18212f" text-anchor="middle">${esc(o.ylabel || '')}${o.logy ? ' (log)' : ''}</text>`;
    s += '</svg>';
    const wrap = h('div', { html: s });
    if (o.fit && o.fitLabel) wrap.appendChild(h('p.net-hint', o.fitLabel));
    return wrap;
  }

  /* ------------------------------------------------------------------
     the tab
     ------------------------------------------------------------------ */
  class NetworksPanel {
    constructor(root) {
      this.root = root;
      this.nets = [];
      this.cur = null;
      this.seq = 0;
      this.jobs = new Analyses();
      this.tableKind = 'nodes';
      this.sideTab = store.get('netSide', 'style');
      this.conds = [];
      this._build();
      MG.app.networks = this;
      this.ready = this._restore()
        .catch((e) => console.error(e))
        .then(() => {
          this._refreshAll();
          return this;
        });
    }

    /* ================= the page ================= */
    _build() {
      const R = this.root;
      R.classList.add('net-root');
      this.netBtn = h('button.btn.small.net-netbtn', { type: 'button', title: 'The networks that are open: switch, rename, close', 'aria-haspopup': 'menu' });
      this.netBtn.addEventListener('click', () => this.networksMenu(this.netBtn));
      this.searchIn = h('input', { type: 'search', placeholder: 'Find nodes', 'aria-label': 'Find nodes by name', spellcheck: 'false' });
      this.searchCount = h('small');
      this.searchIn.addEventListener('input', MG.debounce(() => this.search(this.searchIn.value, false), 150));
      this.searchIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.search(this.searchIn.value, true);
        if (e.key === 'Escape') {
          this.searchIn.value = '';
          this.search('', false);
        }
      });
      this.undoBtn = btn('reset', '', 'Undo (Ctrl+Z)', () => this.undo());
      this.redoBtn = btn('rerun', '', 'Redo (Ctrl+Shift+Z)', () => this.redo());
      this.bar = h(
        'div.net-bar',
        this.netBtn,
        menuBtn('folder', 'Open', 'Open a network: from your files, from STRING, IntAct or NDEx, or an example', () => this.openMenu()),
        menuBtn('table', 'Data', 'Add data to the network: a table of values for the nodes, more interactions, nodes and edges', () => this.dataMenu()),
        menuBtn('workflow', 'Layout', 'Arrange the nodes', () => this.layoutMenu()),
        menuBtn('boxsel', 'Select', 'Select nodes and edges: neighbours, filters, paths', () => this.selectMenu()),
        menuBtn('chart', 'Analyse', 'Network statistics, hubs, clusters, enrichment', () => this.analyseMenu()),
        menuBtn('download', 'Save', 'Save the network, a picture of it, its tables – or code for a notebook', () => this.saveMenu()),
        h('span.grow'),
        h('label.net-search', { html: MG.icon('search') }, this.searchIn, this.searchCount),
        this.undoBtn,
        this.redoBtn,
        btn('help', '', 'Help for the Networks tab', () => MG.app.showHelp && MG.app.showHelp('h-networks'))
      );
      // the network
      this.stage = h('div.net-stage', { tabindex: '0', 'aria-label': 'The network: click to select, drag to move, Shift+drag to select several, right-click for more' });
      this.status = h('div.net-status');
      this.legendEl = h('div.net-legend', { hidden: true, 'aria-label': 'Legend' });
      this.busyEl = h('div.net-busy', { hidden: true });
      this.emptyEl = h('div.net-empty');
      const zoom = h('div.net-zoom');
      [
        ['plus', 'Zoom in', () => this.zoomBy(1.25)],
        ['minus', 'Zoom out', () => this.zoomBy(0.8)],
        ['maximize', 'Fit the whole network (F)', () => this.cur && this._fit(this.cur, true)],
        ['sidebar', 'Show or hide the side panel and the tables', () => this.togglePanels()]
      ].forEach(([ic, t, fn]) => {
        const b = h('button', { type: 'button', title: t, 'aria-label': t, html: MG.icon(ic) });
        b.addEventListener('click', fn);
        zoom.appendChild(b);
      });
      this.stage.append(this.status, this.legendEl, zoom, this.emptyEl, this.busyEl);
      this.stage.addEventListener('keydown', (e) => this._keys(e));
      // the side panel
      this.side = h('div.net-side');
      const stabs = h('div.net-stabs', { role: 'tablist' });
      this.sbodies = {};
      this.stabBtns = {};
      [
        ['style', 'Style'], ['select', 'Select'], ['results', 'Results'], ['details', 'Details']
      ].forEach(([k, label]) => {
        const b = h('button.net-stab', { type: 'button', role: 'tab', dataset: { k } }, label, h('span.dot', { hidden: true }));
        b.addEventListener('click', () => this.showSide(k));
        stabs.appendChild(b);
        this.stabBtns[k] = b;
        this.sbodies[k] = h('div.net-sbody', { role: 'tabpanel', hidden: true });
      });
      this.side.append(stabs, ...Object.values(this.sbodies));
      const main = h('div.net-main', this.stage, this.side);
      // the tables
      this.split = h('div.net-split', { role: 'separator', 'aria-orientation': 'horizontal', title: 'Drag to resize the tables' });
      this.tables = h('div.net-tables');
      this.tbar = h('div.net-tbar');
      this.twrap = h('div.net-twrap');
      this.tables.append(this.tbar, this.twrap);
      R.append(this.bar, main, this.split, this.tables);
      this._splitter();
      const sh = store.get('netTablesH', null);
      if (sh) R.style.setProperty('--net-tables', sh);
      if (store.get('netPanelsOff', false)) this.togglePanels(true);
      this.showSide(this.sideTab, true);
    }
    _splitter() {
      const sp = this.split;
      let y0 = 0, h0 = 0, drag = false;
      sp.addEventListener('pointerdown', (e) => {
        drag = true;
        y0 = e.clientY;
        h0 = this.tables.getBoundingClientRect().height;
        sp.classList.add('drag');
        sp.setPointerCapture(e.pointerId);
      });
      sp.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const total = this.root.getBoundingClientRect().height;
        const v = clamp(h0 - (e.clientY - y0), 60, total - 160);
        this.root.style.setProperty('--net-tables', v + 'px');
      });
      const end = () => {
        if (!drag) return;
        drag = false;
        sp.classList.remove('drag');
        store.set('netTablesH', this.root.style.getPropertyValue('--net-tables'));
        if (this.cur) this.cur.cy.resize();
      };
      sp.addEventListener('pointerup', end);
      sp.addEventListener('pointercancel', end);
    }
    togglePanels(off) {
      const hide = off != null ? off : !this.side.hidden;
      this.side.hidden = hide;
      this.tables.hidden = hide;
      this.split.hidden = hide;
      store.set('netPanelsOff', hide);
      if (this.cur) setTimeout(() => this.cur.cy.resize(), 0);
    }
    showSide(k, quiet) {
      this.sideTab = k;
      store.set('netSide', k);
      for (const [n, b] of Object.entries(this.stabBtns)) {
        b.classList.toggle('on', n === k);
        b.setAttribute('aria-selected', String(n === k));
        if (n === k) b.querySelector('.dot').hidden = true;
      }
      for (const [n, el] of Object.entries(this.sbodies)) el.hidden = n !== k;
      if (!quiet) this._renderSide();
    }
    _dot(k) {
      if (this.sideTab !== k && this.stabBtns[k]) this.stabBtns[k].querySelector('.dot').hidden = false;
    }
    /** the whole network in view – a small one not blown up beyond 1.6× */
    _fit(net, animate) {
      const cy = net.cy, eles = cy.elements(':visible');
      if (!eles.length) return;
      if (animate) return this._view(net, eles, 30, 1.6);
      cy.fit(eles, 30);
      if (cy.zoom() > 1.6) {
        cy.zoom(1.6);
        cy.center(eles);
      }
    }
    /** zoom to some elements – but no closer than maxZoom (two nodes would fill the screen) */
    _view(net, eles, padding = 60, maxZoom = 2) {
      const cy = net.cy;
      if (!eles || !eles.length) return;
      cy.stop(true, true);
      const bb = eles.boundingBox();
      const w = cy.width(), h = cy.height();
      const z = clamp(Math.min((w - 2 * padding) / Math.max(bb.w, 1), (h - 2 * padding) / Math.max(bb.h, 1)), cy.minZoom(), Math.min(maxZoom, cy.maxZoom()));
      cy.animate({ zoom: z, pan: { x: w / 2 - ((bb.x1 + bb.x2) / 2) * z, y: h / 2 - ((bb.y1 + bb.y2) / 2) * z } }, { duration: 300 });
    }
    /** each time the tab is shown */
    shown() {
      if (this.cur) {
        this.cur.cy.resize();
        if (!this.cur.viewed) {
          this._fit(this.cur);
          this.cur.viewed = true;
        }
      }
    }

    /* ================= the networks ================= */
    /** a network (in the format of net-io.js) → a new network in the tab. opts: {name, source, style, layout, quiet,
        noLayout} */
    async addNetwork(obj, opts = {}) {
      await this.ready;
      return this._add(obj, opts);
    }
    async _add(obj, opts = {}) {
      const nodes = obj.nodes || [], edges = obj.edges || [];
      if (nodes.length > 60000 || edges.length > 300000) throw new Error(`This network is too large for the browser: ${plural(nodes.length, 'node')}, ${plural(edges.length, 'edge')} (at most 60,000 nodes and 300,000 edges here). Use a smaller part of it – or networkx in a notebook.`);
      const ids = new Map();
      const els = [];
      nodes.forEach((n, i) => {
        let id = String(n.id == null ? i : n.id);
        if (ids.has(id) || !id) id = `${id || 'node'}_${i}`;
        ids.set(String(n.id == null ? i : n.id), id);
        const data = Object.assign({}, n.data || {});
        for (const k of Object.keys(data)) if (k[0] === '_' || IO.RESERVED.has(k)) delete data[k];
        if (data.name == null) data.name = String(n.id == null ? id : n.id);
        data.id = id;
        els.push({ group: 'nodes', data, position: n.position && isFinite(n.position.x) && isFinite(n.position.y) ? { x: n.position.x, y: n.position.y } : undefined });
      });
      let dropped = 0;
      edges.forEach((e, i) => {
        const s = ids.get(String(e.source)), t = ids.get(String(e.target));
        if (s == null || t == null) {
          dropped++;
          return;
        }
        const data = Object.assign({}, e.data || {});
        for (const k of Object.keys(data)) if (k[0] === '_' || IO.RESERVED.has(k)) delete data[k];
        data.id = 'e' + i;
        data.source = s;
        data.target = t;
        els.push({ group: 'edges', data });
      });
      const hasPos = nodes.length > 0 && els.every((e) => e.group !== 'nodes' || e.position);
      const container = h('div.net-cy');
      this.stage.insertBefore(container, this.status);
      const big = nodes.length + edges.length > 8000;
      const cy = window.cytoscape({
        container,
        elements: els,
        style: SHEET,
        layout: { name: hasPos ? 'preset' : 'grid' },
        minZoom: 0.01,
        maxZoom: 12,
        boxSelectionEnabled: true,
        textureOnViewport: big,
        hideEdgesOnViewport: big,
        pixelRatio: 'auto'
      });
      let name = String(opts.name || obj.name || 'network').trim() || 'network';
      const names = new Set(this.nets.map((n) => n.name));
      if (names.has(name)) {
        let i = 2;
        while (names.has(`${name} (${i})`)) i++;
        name = `${name} (${i})`;
      }
      const wb = obj.workbench || {};
      const net = {
        id: 'net' + ++this.seq,
        name,
        cy,
        el: container,
        style: opts.style ? clone(opts.style) : wb.style ? Object.assign(defaultStyle(), clone(wb.style)) : defaultStyle(),
        directed: !!obj.directed,
        data: Object.assign({}, obj.data || {}),
        source: opts.source || wb.source || obj.data && obj.data.source || '',
        results: opts.results || wb.results || [],
        undo: [],
        redo: [],
        next: nodes.length + edges.length + 1,
        viewed: false
      };
      if (net.directed && net.style.edge.arrow.mode === 'fixed' && net.style.edge.arrow.value === 'none' && !wb.style) net.style.edge.arrow = { mode: 'fixed', value: 'triangle' };
      this.nets.push(net);
      this._wire(net);
      this.applyStyle(net);
      this.show(net);
      if (!hasPos && !opts.noLayout && nodes.length) await this.layout(net, opts.layout || (nodes.length > 4000 ? 'grid' : 'fcose'), { quiet: true, noUndo: true });
      else this._fit(net);
      net.viewed = true;
      if (wb.hidden && wb.hidden.length) cy.batch(() => wb.hidden.forEach((id) => cy.getElementById(id).addClass('hidden')));
      if (dropped) toast(`${plural(dropped, 'edge')} left out: their nodes are not in the file.`, 'warn', 6000);
      this._changed(net);
      if (!opts.quiet) toast(`<b>${esc(name)}</b>: ${plural(cy.nodes().length, 'node')}, ${plural(cy.edges().length, 'edge')}.`, 'ok', 3500);
      bus.emit('net:open', { name, nodes: cy.nodes().length, edges: cy.edges().length, source: net.source });
      return net;
    }
    _wire(net) {
      const cy = net.cy;
      const sel = MG.debounce(() => net === this.cur && this._selChanged(), 40);
      cy.on('select unselect', sel);
      cy.on('dragfree', 'node', () => this._changed(net, { positions: true }));
      cy.on('cxttap', (e) => this._context(net, e));
      cy.on('dbltap', 'node', (e) => {
        const n = e.target;
        this._view(net, n.closedNeighborhood());
      });
      cy.on('tap', () => this.stage.focus({ preventScroll: true }));
    }
    /** show a network (the others are kept, hidden) */
    show(net) {
      for (const n of this.nets) n.el.hidden = n !== net;
      this.cur = net;
      if (net) {
        net.cy.resize();
        if (!net.viewed) {
          this._fit(net);
          net.viewed = true;
        }
      }
      this._refreshAll();
    }
    close(net) {
      const i = this.nets.indexOf(net);
      if (i < 0) return;
      net.cy.destroy();
      net.el.remove();
      this.nets.splice(i, 1);
      if (this.cur === net) this.cur = null;
      this.show(this.nets[Math.min(i, this.nets.length - 1)] || null);
      this._saveSoon();
    }
    networksMenu(anchor) {
      const items = this.nets.map((n) => [n === this.cur ? 'check' : 'link', `${n.name} (${n.cy.nodes().length} · ${n.cy.edges().length})`, () => this.show(n)]);
      if (this.cur) {
        items.push(['rename', 'Rename this network…', async () => {
          const v = await MG.promptText('Rename the network', 'Its new name:', this.cur.name, 'Rename');
          if (v) {
            this.cur.name = v;
            this._changed(this.cur);
          }
        }]);
        items.push(['copy', 'Duplicate this network', () => this.duplicate(this.cur)]);
        items.push(['x', 'Close this network', () => this.close(this.cur)]);
      }
      if (this.nets.length > 1) items.push(['trash', 'Close every network', () => [...this.nets].forEach((n) => this.close(n))]);
      items.push(['plus', 'New empty network', () => this._add({ name: 'new network', nodes: [], edges: [] }, {})]);
      MG.popmenu(anchor, items);
    }
    /** the network as a network of net-io.js (positions, data without the page's own fields) */
    toObject(net, opts = {}) {
      const strip = (d) => {
        const o = {};
        for (const [k, v] of Object.entries(d)) if (k[0] !== '_' && k !== 'id' && k !== 'source' && k !== 'target') o[k] = v;
        return o;
      };
      const eles = opts.only || net.cy.elements();
      const nodes = eles.nodes().map((n) => ({ id: n.id(), data: strip(n.data()), position: Object.assign({}, n.position()) }));
      const ns = new Set(nodes.map((n) => n.id));
      const edges = eles.edges().filter((e) => ns.has(e.source().id()) && ns.has(e.target().id())).map((e) => ({ id: e.id(), source: e.source().id(), target: e.target().id(), data: strip(e.data()) }));
      return { name: net.name, directed: net.directed, data: Object.assign({}, net.data), nodes, edges };
    }
    async duplicate(net, only, name) {
      const obj = this.toObject(net, { only });
      return this._add(obj, { name: name || net.name + ' (copy)', style: net.style, source: net.source, noLayout: true });
    }

    /* ================= what has changed ================= */
    _changed(net, what = {}) {
      if (net !== this.cur) return this._saveSoon();
      this._renderStatus();
      if (!what.positions) {
        this._renderNetBtn();
        this._renderTablesSoon();
        if (this.sideTab === 'details' || this.sideTab === 'select') this._renderSide();
      }
      this._saveSoon();
    }
    _refreshAll() {
      this._renderNetBtn();
      this._renderStatus();
      this._renderEmpty();
      this._renderLegend();
      this._renderTables();
      this._renderSide();
      this.undoBtn.disabled = !(this.cur && this.cur.undo.length);
      this.redoBtn.disabled = !(this.cur && this.cur.redo.length);
    }
    _renderNetBtn() {
      const n = this.cur;
      this.netBtn.innerHTML = MG.icon('link') + `<span>${n ? esc(n.name) : 'No network'}</span><span class="caret">▾</span>`;
      this.undoBtn.disabled = !(n && n.undo.length);
      this.redoBtn.disabled = !(n && n.redo.length);
    }
    _renderStatus() {
      const n = this.cur;
      if (!n) {
        this.status.hidden = true;
        return;
      }
      const cy = n.cy, sn = cy.$('node:selected').length, se = cy.$('edge:selected').length, hid = cy.$('.hidden').nodes().length;
      this.status.hidden = false;
      this.status.innerHTML = `<b>${plural(cy.nodes().length, 'node')}</b> · <b>${plural(cy.edges().length, 'edge')}</b>` + (sn || se ? ` · selected: ${sn ? plural(sn, 'node') : ''}${sn && se ? ', ' : ''}${se ? plural(se, 'edge') : ''}` : '') + (hid ? ` · ${hid} hidden` : '');
    }
    _renderEmpty() {
      const E = this.emptyEl;
      E.hidden = !!this.cur;
      if (this.cur) return;
      E.innerHTML = '';
      const start = (icon, title, sub, fn) => {
        const b = h('button.net-start', { type: 'button', html: MG.icon(icon) }, h('span', h('b', title), h('small', sub)));
        b.addEventListener('click', async () => {
          try {
            await fn();
          } catch (e) {
            console.error(e);
            toast(esc(e.message || String(e)), 'error', 8000);
          }
        });
        return b;
      };
      E.appendChild(
        h(
          'div.net-empty-in',
          h('h3', 'Networks'),
          h('p', 'Interactions between genes and proteins – or any other network – drawn, styled with your data, and analysed: hubs, clusters, paths, enrichment.'),
          h(
            'div.net-empty-grid',
            start('flask', 'Example: a drug’s genes on STRING', 'Genes that dexamethasone switches on or off (DESeq2), on their interaction network', () => this.example('airway')),
            start('user', 'Example: a karate club', 'Zachary’s classic social network: who split from whom', () => this.example('karate')),
            start('link', 'From STRING…', 'Type genes or proteins: their interaction network', () => this.stringDialog()),
            start('table', 'From a table of genes…', 'Results of DESeq2, edgeR …: the significant genes on STRING', () => this.geneTableDialog()),
            start('folder', 'From my files…', 'SIF, GraphML, GML, XGMML, Cytoscape JSON, CX2, a table of edges', () => this.filesMenuFor(this.emptyEl.querySelector('.net-start:nth-child(5)') || this.netBtn)),
            start('globe', 'From NDEx…', 'Search public networks: pathways, interactomes, published networks', () => this.ndexDialog())
          ),
          h('p.net-hint', { style: { marginTop: '12px' } }, 'Networks open here from other tabs too: Files (⋯ → Open in Networks), the terminal (network FILE), Galaxy, and the STRING, IntAct and NDEx cards of the Databases tab.')
        )
      );
    }

    /* ================= opening ================= */
    openMenu() {
      return [
        ['folder', 'From my files…', () => this.filesMenuFor(this.bar.querySelector('.btn:nth-child(2)'))],
        ['upload', 'From my computer…', () => this.openLocal()],
        ['link', 'From STRING (genes or proteins)…', () => this.stringDialog()],
        ['table', 'From a table of genes (DESeq2, edgeR …) on STRING…', () => this.geneTableDialog()],
        ['database', 'From IntAct (molecular interactions)…', () => this.intactDialog()],
        ['globe', 'From NDEx (public networks)…', () => this.ndexDialog()],
        ['flask', 'Example: dexamethasone’s genes on STRING', () => this.example('airway')],
        ['user', 'Example: Zachary’s karate club', () => this.example('karate')],
        ['plus', 'New empty network', () => this._add({ name: 'new network', nodes: [], edges: [] }, {})]
      ];
    }
    filesMenuFor(anchor) {
      const files = filesLike(new RegExp(NET_RE.source + '|' + TABLE_RE.source, 'i'));
      if (!files.length) return toast('No network files or tables among your files yet.', 'warn');
      MG.popmenu(anchor || this.netBtn, files.slice(0, 40).map((p) => [TABLE_RE.test(p) ? 'table' : 'link', MG.app.fs.pretty(p), () => this.openPath(p).catch((e) => toast(esc(e.message), 'error', 8000))]));
    }
    async openLocal() {
      const f = await pickLocal('.sif,.graphml,.xml,.xgmml,.gml,.cyjs,.json,.cx2,.csv,.tsv,.tab,.txt');
      if (!f) return;
      try {
        await this.openText(f.name, f.text);
      } catch (e) {
        toast(esc(e.message), 'error', 8000);
      }
    }
    /** open files of the workbench (several: one network each) */
    async openPaths(paths, opts = {}) {
      await this.ready;
      const out = [];
      for (const p of paths) out.push(await this.openPath(p, opts));
      return out;
    }
    async openPath(path, opts = {}) {
      const fs = MG.app.fs;
      const p = fs.resolve(path);
      if (!fs.exists(p)) throw new Error(`${path}: no such file`);
      const text = await fs.readText(p);
      return this.openText(MG.path.basename(p), text, Object.assign({ path: p }, opts));
    }
    async openText(name, text, opts = {}) {
      const fmt0 = IO.sniff(name, text);
      if (fmt0 === 'table' || (!fmt0 && /\.(csv|tsv|tab|txt)$/i.test(name))) {
        if (opts.asEdges || opts.map) return this._add(IO.fromEdgeTable(IO.parseTable(text), opts.map || {}, name.replace(/\.[^.]+$/, '')), { source: opts.path || name });
        return this.edgeTableDialog(name, text, opts);
      }
      const obj = IO.parse(name, text);
      return this._add(obj, { source: opts.path || name, quiet: opts.quiet, name: opts.name });
    }
    /** a table: a table of edges (which columns?) – or values to add to the nodes of the network that is open */
    edgeTableDialog(name, text, opts = {}) {
      const t = IO.parseTable(text);
      if (!t.columns.length) throw new Error(`${name} is empty.`);
      const { m, body } = dialog(`Open ${name}`, { wide: true });
      const g = IO.guessEdgeColumns(t.columns);
      const cols = t.columns.map((c, i) => [String(i), c]);
      const src = select(cols, String(g.source)), dst = select(cols, String(g.target)), itn = select([['', '(none)']].concat(cols), g.interaction == null ? '' : String(g.interaction));
      const directed = h('input', { type: 'checkbox' });
      body.append(
        h('p.note', `${plural(t.rows.length, 'row')}, ${plural(t.columns.length, 'column')}. Each row is an edge: choose the columns of its two ends. The other columns become columns of the edge table.`),
        previewTable(t),
        field('First node (source)', src),
        field('Second node (target)', dst),
        field('Kind of interaction', itn),
        h('label.fld', h('span', 'Directed'), h('span', directed, ' the edges go from the first node to the second'))
      );
      const go = btn('check', 'Open as a network', null, () => {
        m.close();
        const net = IO.fromEdgeTable(t, { source: +src.value, target: +dst.value, interaction: itn.value === '' ? null : +itn.value, directed: directed.checked }, name.replace(/\.[^.]+$/, ''));
        this._add(net, { source: opts.path || name }).catch((e) => toast(esc(e.message), 'error', 8000));
      }, '.primary');
      const asData = this.cur ? btn('table', 'Add it to the nodes of “' + this.cur.name + '” instead', 'The table holds values for the nodes (e.g. DESeq2 results): join it to the network that is open', () => {
        m.close();
        this.importTableDialog({ name, text, path: opts.path });
      }) : null;
      body.appendChild(h('div.acts', asData, h('span.grow'), go));
    }
    async example(which) {
      await this.ready;
      const fs = MG.app.fs;
      if (which === 'karate') {
        const p = '/data/examples/networks/karate_club.graphml';
        const net = await this.openPath(p, { quiet: true, name: 'Karate club' });
        this.setStyle(net, 'discrete', { prop: 'fill', attr: 'club' });
        this._changed(net);
        toast('Zachary’s karate club (1977): 34 members, 78 friendships. The colours: the two clubs it split into.', 'ok', 6000);
        return net;
      }
      if (which === 'airway') {
        const t = await fs.readText('/data/examples/networks/airway_string_network.tsv');
        const nodesT = IO.parseTable(await fs.readText('/data/examples/networks/airway_string_nodes.tsv'));
        const de = IO.parseTable(await fs.readText('/data/examples/networks/airway_deseq2.csv'));
        const edgesT = IO.parseTable(t);
        const map = nodesT.rows.map((r) => Object.fromEntries(nodesT.columns.map((c, i) => [c, r[i]])));
        const edges = edgesT.rows.map((r) => {
          const o = Object.fromEntries(edgesT.columns.map((c, i) => [c, IO.value(r[i])]));
          return o;
        });
        const obj = IO.fromSTRING(map, edges, { name: 'Dexamethasone genes (STRING)', data: { source: 'STRING (an offline copy, made on 13 October 2026)', species: '9606', confidence: 0.4, 'network type': 'full' } });
        const net = await this._add(obj, { source: 'STRING (offline copy) + /data/examples/networks/airway_deseq2.csv', quiet: true, noLayout: true });
        const r = this._join(net, de, { tableKey: 0, nodeKey: 'query' });
        this.setStyle(net, 'string');
        this.setStyle(net, 'expression');
        await this.layout(net, 'fcose', { quiet: true, noUndo: true });
        this._changed(net);
        toast(`Genes changed by dexamethasone in airway cells (DESeq2: adjusted p < 0.01, |log₂ fold change| ≥ 1.5) on their STRING network: ${plural(net.cy.nodes().length, 'protein')}, ${plural(net.cy.edges().length, 'interaction')}; ${r.matched} with DESeq2's results. Red: up, blue: down; size: −log₁₀ adjusted p.`, 'ok', 9000);
        return net;
      }
      throw new Error('There is no example ' + which);
    }

    /* ---------------- STRING ---------------- */
    stringDialog(pre = {}) {
      const { m, body } = dialog('A network from STRING', { wide: true });
      const ids = h('textarea', { rows: 6, spellcheck: 'false', placeholder: 'One per line, or separated by commas: TP53, MDM2 …' }, pre.ids ? pre.ids.join('\n') : 'TP53\nMDM2\nCDKN1A\nATM\nCHEK2\nBAX');
      const sp = select(SPECIES, pre.species || (this.cur && this.cur.data.species) || '9606');
      const score = select([['150', 'low (0.15)'], ['400', 'medium (0.4)'], ['700', 'high (0.7)'], ['900', 'highest (0.9)']], String(pre.score || 400));
      const type = select([['functional', 'all associations (functional)'], ['physical', 'physical interactions only']], pre.type || 'functional');
      const add = select([['0', 'none'], ['5', '5'], ['10', '10'], ['20', '20'], ['50', '50']], String(pre.add || 0));
      body.append(
        field('Genes or proteins', ids, 'Gene names (TP53), UniProt accessions (P04637), Ensembl IDs (ENSG…, ENSP…) – STRING finds them.'),
        field('Species', sp),
        field('Minimum confidence', score, 'STRING’s combined score: how sure it is of an association (0 to 1).'),
        field('Interactions', type),
        field('Add interactors', add, 'The proteins most strongly connected to yours.'),
        h('p.note', 'The names go to string-db.org (the STRING Consortium); the network that comes back is licensed CC BY 4.0. Never send personal or patient data.')
      );
      const go = btn('search', 'Make the network', null, async () => {
        const list = ids.value.split(/[\s,;]+/).filter(Boolean);
        if (!list.length) return toast('Type at least one gene or protein.', 'warn');
        m.close();
        try {
          await this.stringNetwork({ ids: list, species: sp.value, score: +score.value, type: type.value, add: +add.value });
        } catch (e) {
          console.error(e);
          toast(esc(e.message), 'error', 9000);
        }
      }, '.primary');
      body.appendChild(h('div.acts', h('span.grow'), go));
      setTimeout(() => ids.focus(), 30);
    }
    /** STRING: identifiers → a network. opts: {ids, species, score (0-1000), type, add, name, quiet} */
    async stringNetwork(opts) {
      await this.ready;
      const ids = Array.from(new Set(opts.ids.map(String).filter(Boolean)));
      const species = String(opts.species || '9606'), score = opts.score == null ? 400 : +opts.score, type = opts.type || 'functional', add = +opts.add || 0;
      if (ids.length > 2000) throw new Error(`STRING draws networks of at most 2,000 proteins here; there are ${ids.length.toLocaleString('en-GB')}. Choose fewer (e.g. the most significant).`);
      return this._busy(`Asking STRING about ${plural(ids.length, 'name')}…`, async () => {
        const map = await this._stringIds(ids, species);
        if (!map.length) throw new Error(`STRING knows none of these names in ${SPECIES_NAME[species] || 'species ' + species}.`);
        await sleep(1000);
        const sids = Array.from(new Set(map.map((x) => x.stringId)));
        const edges = (await MG.apiCall({ method: 'POST', url: 'https://string-db.org/api/json/network', form: { identifiers: sids.join('\r'), species, required_score: score, network_type: type, add_nodes: add, caller_identity: CALLER }, service: 'STRING', label: `network of ${plural(sids.length, 'protein')}` })) || [];
        let more = [];
        if (add > 0) {
          const extra = Array.from(new Set(edges.flatMap((e) => [e.stringId_A, e.stringId_B]))).filter((s) => !sids.includes(s));
          if (extra.length) {
            await sleep(1000);
            more = (await this._stringIds(extra, species, true)) || [];
          }
        }
        const found = new Set(map.map((x) => keyOf(x.queryItem)));
        const missing = ids.filter((x) => !found.has(keyOf(x)));
        const name = opts.name || `STRING: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` and ${ids.length - 3} more` : ''}`;
        const obj = IO.fromSTRING(map, edges, { more, name, data: { source: 'STRING', species, confidence: score / 1000, 'network type': type } });
        const net = await this._add(obj, { source: `STRING (string-db.org), ${SPECIES_NAME[species] || species}, confidence ≥ ${score / 1000}`, quiet: true, noLayout: true });
        net.data.species = species;
        if (!opts.keepStyle) this.setStyle(net, 'string');
        if (opts.before) await opts.before(net);
        if (net.cy.nodes().length) await this.layout(net, net.cy.nodes().length > 4000 ? 'grid' : 'fcose', { quiet: true, noUndo: true });
        if (!opts.quiet) toast(`STRING: ${plural(net.cy.nodes().length, 'protein')}, ${plural(net.cy.edges().length, 'interaction')}.${missing.length ? ` Not found: ${esc(missing.slice(0, 8).join(', '))}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}.` : ''}`, missing.length ? 'warn' : 'ok', 8000);
        net.stringMissing = missing;
        return net;
      });
    }
    async _stringIds(ids, species, quiet) {
      ids = ids.map((x) => String(x).trim().replace(ENS_VERSION, '$1'));
      return (await MG.apiCall({ method: 'POST', url: 'https://string-db.org/api/json/get_string_ids', form: { identifiers: ids.join('\r'), species, limit: 1, echo_query: 1, caller_identity: CALLER }, service: 'STRING', label: `STRING identifiers of ${plural(ids.length, 'name')}`, quiet: !!quiet, timeout: 90000 })) || [];
    }
    /** a table of results (DESeq2 …): its significant genes → STRING → the network, with the table's columns */
    async geneTableDialog(pre = {}) {
      await this.ready;
      const files = filesLike(TABLE_RE);
      const given = preferFile(files, pre.path);
      const { m, body } = dialog('A network from a table of genes', { wide: true });
      const fileSel = select(files.map((p) => [p, MG.app.fs.pretty(p)]).concat([['__local', 'From my computer…']]), given || files.find((p) => /deseq|edger|limma|result|diff|de_/i.test(p)) || files[0]);
      const info = h('div');
      const keyCol = select([]), pCol = select([]), fcCol = select([]);
      const pMax = h('input', { type: 'number', value: pre.p || 0.01, step: 'any', min: '0' });
      const fcMin = h('input', { type: 'number', value: pre.fc || 1.5, step: 'any', min: '0' });
      const nMax = h('input', { type: 'number', value: pre.max || 500, step: '1', min: '1', max: '2000' });
      const sp = select(SPECIES, pre.species || '9606');
      const score = select([['150', 'low (0.15)'], ['400', 'medium (0.4)'], ['700', 'high (0.7)'], ['900', 'highest (0.9)']], String(pre.score || 400));
      const type = select([['functional', 'all associations (functional)'], ['physical', 'physical interactions only']], 'functional');
      const count = h('p.note');
      let table = null, local = null;
      const load = async () => {
        info.innerHTML = '';
        table = null;
        try {
          let text;
          if (fileSel.value === '__local') {
            local = local || (await pickLocal('.csv,.tsv,.txt,.tab'));
            if (!local) return;
            text = local.text;
          } else text = await MG.app.fs.readText(fileSel.value);
          table = IO.parseTable(text);
        } catch (e) {
          info.appendChild(h('p.note.warn', e.message));
          return;
        }
        const cols = table.columns.map((c, i) => [String(i), c]);
        const low = table.columns.map((c) => c.toLowerCase());
        const find = (...re) => {
          for (const r of re) {
            const i = low.findIndex((c) => r.test(c));
            if (i >= 0) return String(i);
          }
          return '';
        };
        keyCol.innerHTML = '';
        cols.forEach(([v, l]) => keyCol.appendChild(h('option', { value: v }, l)));
        keyCol.value = find(/^(symbol|gene_?name|gene_?symbol|hgnc_symbol|external_gene_name)$/, /^(gene|gene_?id|ensembl|ensembl_?gene_?id|row|id|name)$/) || '0';
        pCol.innerHTML = '';
        fcCol.innerHTML = '';
        pCol.appendChild(h('option', { value: '' }, '(no filter)'));
        fcCol.appendChild(h('option', { value: '' }, '(no filter)'));
        cols.forEach(([v, l]) => {
          pCol.appendChild(h('option', { value: v }, l));
          fcCol.appendChild(h('option', { value: v }, l));
        });
        pCol.value = find(/^padj$/, /^(fdr|adj\.p\.val|qvalue|q_value|p_adj|padj_bh|fdr_bh)$/i, /^(pvalue|p\.value|pval)$/);
        fcCol.value = find(/^log2foldchange$/, /^(logfc|log2fc|log2_fold_change|lfc)$/i);
        info.appendChild(previewTable(table, 4));
        recount();
      };
      const rows = () => {
        if (!table) return [];
        const k = +keyCol.value, pc = pCol.value === '' ? null : +pCol.value, fc = fcCol.value === '' ? null : +fcCol.value;
        const pm = Number(pMax.value), fm = Number(fcMin.value);
        let rs = table.rows.filter((r) => r[k] && (pc == null || (isNum(IO.value(r[pc])) && IO.value(r[pc]) < pm)) && (fc == null || (isNum(IO.value(r[fc])) && Math.abs(IO.value(r[fc])) >= fm)));
        if (pc != null) rs = rs.slice().sort((a, b) => IO.value(a[pc]) - IO.value(b[pc]));
        return rs.slice(0, Math.max(1, Math.min(2000, Number(nMax.value) || 500)));
      };
      const recount = () => {
        if (!table) return;
        const n = rows().length;
        count.textContent = `${plural(n, 'gene')} of ${table.rows.length.toLocaleString('en-GB')} pass the filters and go to STRING.`;
      };
      [keyCol, pCol, fcCol, pMax, fcMin, nMax].forEach((x) => x.addEventListener('input', recount));
      fileSel.addEventListener('change', () => {
        local = null;
        load();
      });
      body.append(
        field('Table', fileSel, 'CSV or TSV, with a row for each gene – e.g. DESeq2’s results (the RNA-seq recipe writes deseq2_dex_vs_untreated.csv).'),
        info,
        field('Gene names or IDs', keyCol, 'Gene names, Ensembl or UniProt IDs: STRING maps them.'),
        h('div.fld', h('span', 'Keep genes where'), h('div.net-row', pCol, h('span', '<'), pMax)),
        h('div.fld', h('span', 'and |…| ≥'), h('div.net-row', fcCol, h('span', '≥'), fcMin)),
        field('At most', nMax, 'The genes with the smallest p-values first (at most 2,000).'),
        count,
        field('Species', sp),
        field('Minimum confidence', score),
        field('Interactions', type),
        h('p.note', 'The gene names go to string-db.org; your table stays here. Every column of the table is added to the nodes.')
      );
      const go = btn('search', 'Make the network', null, async () => {
        const rs = rows();
        if (!rs.length) return toast('No gene passes the filters.', 'warn');
        m.close();
        const k = +keyCol.value;
        try {
          const label = fileSel.value === '__local' ? (local && local.name) || 'table' : MG.path.basename(fileSel.value);
          const isDE = fcCol.value !== '';
          let j = { matched: 0 };
          const net = await this.stringNetwork({
            ids: rs.map((r) => r[k]), species: sp.value, score: +score.value, type: type.value, add: 0, name: `${label.replace(/\.[^.]+$/, '')} on STRING`, quiet: true, keepStyle: true,
            before: (n) => {
              j = this._join(n, table, { tableKey: k, nodeKey: 'query' });
              this.setStyle(n, 'string');
              if (isDE) this.setStyle(n, 'expression', { fc: table.columns[+fcCol.value], p: pCol.value === '' ? null : table.columns[+pCol.value] });
            }
          });
          this._changed(net);
          toast(`${plural(rs.length, 'gene')} sent to STRING: ${plural(net.cy.nodes().length, 'protein')}, ${plural(net.cy.edges().length, 'interaction')}; the table’s columns joined to ${j.matched} of them.${net.stringMissing && net.stringMissing.length ? ` STRING did not know ${net.stringMissing.length}.` : ''}${isDE ? ' Colour: ' + esc(table.columns[+fcCol.value]) + '.' : ''}`, 'ok', 9000);
          bus.emit('net:genetable', { genes: rs.length, nodes: net.cy.nodes().length });
        } catch (e) {
          console.error(e);
          toast(esc(e.message), 'error', 9000);
        }
      }, '.primary');
      body.appendChild(h('div.acts', h('span.grow'), go));
      await load();
    }

    /* ---------------- IntAct ---------------- */
    intactDialog(pre = {}) {
      const { m, body } = dialog('A network from IntAct', { wide: true });
      const q = h('input', { type: 'text', value: pre.q || 'P04637', spellcheck: 'false' });
      const mi = select([['0', 'any'], ['0.45', '0.45 (medium)'], ['0.6', '0.6 (high)'], ['0.75', '0.75 (very high)']], String(pre.mi || 0.6));
      const max = select([['200', '200'], ['500', '500'], ['1000', '1,000'], ['2000', '2,000']], '500');
      const among = h('input', { type: 'checkbox' });
      body.append(
        field('Proteins', q, 'UniProt accessions (P04637) or names (TP53), separated by spaces. Several: their interactions together.'),
        field('Minimum MI score', mi, 'IntAct’s confidence in an interaction, from the evidence (0 to 1).'),
        field('At most', max, 'pieces of evidence (each experiment of each paper is one; they become one edge per pair).'),
        h('label.fld', h('span', 'Only between them'), h('span', among, ' keep only interactions between the proteins you typed')),
        h('p.note', 'IntAct (EMBL-EBI) collects molecular interactions from published experiments; its data is CC BY 4.0.')
      );
      const go = btn('search', 'Make the network', null, async () => {
        const terms = q.value.split(/[\s,;]+/).filter(Boolean);
        if (!terms.length) return;
        m.close();
        try {
          await this.intactNetwork({ terms, mi: +mi.value, max: +max.value, among: among.checked });
        } catch (e) {
          console.error(e);
          toast(esc(e.message), 'error', 9000);
        }
      }, '.primary');
      body.appendChild(h('div.acts', h('span.grow'), go));
    }
    async intactNetwork(o) {
      await this.ready;
      return this._busy('Asking IntAct…', async () => {
        const query = o.terms.join(' OR ');
        const size = Math.min(o.max || 500, 500);
        let content = [];
        for (let page = 0; content.length < (o.max || 500); page++) {
          const url = `https://www.ebi.ac.uk/intact/ws/interaction/findInteractions/${enc(query)}?page=${page}&pageSize=${size}${o.mi ? '&minMIScore=' + o.mi : ''}`;
          const d = await MG.apiCall({ url, service: 'IntAct', label: `interactions of ${o.terms.join(', ')}`, quiet: page > 0, timeout: 90000 });
          const c = (d && d.content) || [];
          content = content.concat(c);
          if (!c.length || d.last || page >= 9) break;
        }
        if (!content.length) throw new Error('IntAct has no interactions for that (with that MI score).');
        let obj = IO.fromIntAct(content, { name: `IntAct: ${o.terms.join(', ')}`, data: { source: 'IntAct', 'minimum MI score': o.mi } });
        // (IntAct's search also finds molecules whose other names contain what was typed: the network keeps the
        // interactions of the molecules asked for – or, with "only between them", those among them)
        const want = new Set(o.terms.map((t) => t.toUpperCase()));
        const asked = new Set(obj.nodes.filter((n) => want.has(String(n.id).toUpperCase()) || want.has(String(n.data.name).toUpperCase())).map((n) => n.id));
        if (asked.size) {
          const edges = obj.edges.filter((e) => (o.among ? asked.has(e.source) && asked.has(e.target) : asked.has(e.source) || asked.has(e.target)));
          const used = new Set(edges.flatMap((e) => [e.source, e.target]));
          obj = Object.assign({}, obj, { nodes: obj.nodes.filter((n) => used.has(n.id) || asked.has(n.id)), edges });
        }
        const net = await this._add(obj, { source: 'IntAct (EMBL-EBI)', quiet: true });
        this.setStyle(net, 'intact');
        toast(`IntAct: ${plural(net.cy.nodes().length, 'molecule')}, ${plural(net.cy.edges().length, 'interaction')} (from ${plural(content.length, 'piece')} of evidence).`, 'ok', 6000);
        return net;
      });
    }

    /* ---------------- NDEx ---------------- */
    ndexDialog(pre = {}) {
      const { m, body } = dialog('Public networks from NDEx', { wide: true });
      const q = h('input', { type: 'search', value: pre.q || 'p53 signaling', placeholder: 'e.g. apoptosis, TP53, NCI-PID, SIGNOR' });
      const hits = h('div.hits');
      const run = async () => {
        hits.innerHTML = '<p class="net-tempty"><span class="spinner small"></span> Searching NDEx…</p>';
        try {
          const d = await MG.apiCall({ method: 'POST', url: 'https://www.ndexbio.org/v2/search/network?start=0&size=25', json: { searchString: q.value.trim() }, service: 'NDEx', label: `networks: ${q.value.trim()}` });
          const list = (d && d.networks) || [];
          hits.innerHTML = '';
          if (!list.length) hits.appendChild(h('p.net-tempty', 'No public network matches.'));
          for (const n of list) {
            const prop = (k) => ((n.properties || []).find((p) => p.predicateString === k) || {}).value;
            const rights = prop('rights');
            const desc = String(n.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const open = btn('link', 'Open', `Open ${n.name} (${n.nodeCount} nodes, ${n.edgeCount} edges)`, async () => {
              m.close();
              try {
                await this.ndexNetwork(n.externalId, n.name, rights);
              } catch (e) {
                console.error(e);
                toast(esc(e.message), 'error', 9000);
              }
            });
            if (n.edgeCount > 50000) open.disabled = true;
            hits.appendChild(h('div.hit', h('div.grow', h('b', n.name), h('small', `${plural(n.nodeCount, 'node')}, ${plural(n.edgeCount, 'edge')} · ${n.owner}${rights ? ' · ' + rights : ''}`), desc ? h('small', desc.slice(0, 220) + (desc.length > 220 ? '…' : '')) : null), open));
          }
        } catch (e) {
          hits.innerHTML = '';
          hits.appendChild(h('p.net-tempty', e.message));
        }
      };
      q.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), run()));
      body.append(h('div.net-row', q, btn('search', 'Search', null, run, '.primary')), hits, h('p.note', 'NDEx (ndexbio.org) shares networks that researchers and databases publish – pathways (NCI-PID, WikiPathways, SIGNOR), interactomes, networks of papers. Each has its own licence, shown above: check it before you reuse a network.'));
      run();
    }
    async ndexNetwork(uuid, name, rights) {
      await this.ready;
      return this._busy(`Downloading ${name || 'the network'} from NDEx…`, async () => {
        const cx = await MG.apiCall({ url: `https://www.ndexbio.org/v3/networks/${enc(uuid)}`, service: 'NDEx', label: `network ${name || uuid}`, timeout: 120000 });
        const obj = IO.parseCX2(cx, name);
        if (rights) obj.data.rights = rights;
        obj.data.ndex = `https://www.ndexbio.org/viewer/networks/${uuid}`;
        const net = await this._add(obj, { source: `NDEx ${uuid}`, quiet: true });
        toast(`NDEx: <b>${esc(net.name)}</b> – ${plural(net.cy.nodes().length, 'node')}, ${plural(net.cy.edges().length, 'edge')}.${rights ? ' Licence: ' + esc(rights) + '.' : ''}`, 'ok', 7000);
        return net;
      });
    }

    /* ================= data ================= */
    dataMenu() {
      const n = this.cur;
      return [
        ['table', 'Import a table of values onto the nodes…', () => this.importTableDialog()],
        n ? ['link', 'Add interactors from STRING…', () => this.expandDialog()] : null,
        n ? ['link', 'Add STRING interactions between these nodes', () => this.stringEdges()] : null,
        n ? ['plus', 'Add a node…', () => this.addNode()] : null,
        n ? ['arrow', 'Add an edge between the two selected nodes…', () => this.addEdge()] : null,
        n ? ['trash', 'Delete what is selected', () => this.deleteSelected()] : null,
        n && this.nets.length > 1 ? ['layers', 'Merge with another network…', () => this.mergeDialog()] : null,
        n ? ['tag', n.directed ? 'Treat the edges as undirected' : 'Treat the edges as directed (arrows)', () => this.setDirected(!n.directed)] : null
      ];
    }
    /** join a table to the nodes: {name, text, path} – or choose one */
    async importTableDialog(pre = {}) {
      const net = this.cur;
      if (!net) return toast('Open a network first.', 'warn');
      let table = null;
      const files = filesLike(TABLE_RE);
      const given = pre.text ? null : preferFile(files, pre.path);
      const { m, body } = dialog(`Import a table onto the nodes of “${net.name}”`, { wide: true });
      const fileSel = select((pre.text ? [['__given', pre.name]] : []).concat(files.map((p) => [p, MG.app.fs.pretty(p)])).concat([['__local', 'From my computer…']]), pre.text ? '__given' : given || files[0]);
      const info = h('div'), keyCol = select([]), nodeKey = select([]), stat = h('p.note'), checks = h('div.checks');
      const ci = h('input', { type: 'checkbox', checked: true });
      let local = null;
      const nodeCols = this._cols(net, 'nodes').filter((c) => c.kind !== 'number' || c.key === 'name');
      nodeCols.forEach((c) => nodeKey.appendChild(h('option', { value: c.key }, c.key)));
      const load = async () => {
        info.innerHTML = '';
        checks.innerHTML = '';
        table = null;
        try {
          let text;
          if (fileSel.value === '__given') text = pre.text;
          else if (fileSel.value === '__local') {
            local = local || (await pickLocal('.csv,.tsv,.txt,.tab'));
            if (!local) return;
            text = local.text;
          } else text = await MG.app.fs.readText(fileSel.value);
          table = IO.parseTable(text);
        } catch (e) {
          info.appendChild(h('p.note.warn', e.message));
          return;
        }
        info.appendChild(previewTable(table, 4));
        keyCol.innerHTML = '';
        table.columns.forEach((c, i) => keyCol.appendChild(h('option', { value: String(i) }, c)));
        // the pair of columns that match best
        let best = [0, 'name', -1];
        for (let i = 0; i < table.columns.length; i++) {
          const vals = new Set(table.rows.map((r) => keyOf(r[i])));
          for (const c of nodeCols) {
            let hit = 0;
            net.cy.nodes().forEach((nd) => {
              const v = nd.data(c.key);
              if (v != null && String(v).split('|').some((x) => vals.has(keyOf(x)))) hit++;
            });
            if (hit > best[2]) best = [i, c.key, hit];
          }
        }
        keyCol.value = String(best[0]);
        nodeKey.value = best[1];
        table.columns.forEach((c, i) => checks.appendChild(h('label', h('input', { type: 'checkbox', checked: true, value: String(i) }), c)));
        recount();
      };
      const recount = () => {
        if (!table) return;
        const r = this._join(net, table, { tableKey: +keyCol.value, nodeKey: nodeKey.value, ci: ci.checked, dry: true });
        stat.textContent = `${r.matched} of ${plural(net.cy.nodes().length, 'node')} have a row in the table (${table.rows.length.toLocaleString('en-GB')} rows).`;
      };
      fileSel.addEventListener('change', () => {
        local = null;
        load();
      });
      [keyCol, nodeKey, ci].forEach((x) => x.addEventListener('change', recount));
      body.append(field('Table', fileSel), info, field('Its column of names', keyCol), field('matches the nodes’ column', nodeKey), h('label.fld', h('span', ''), h('span', ci, ' ignore capitals (TP53 = tp53)')), stat, h('div.fld.wide', h('span', 'Columns to add'), checks));
      const go = btn('check', 'Import', null, () => {
        if (!table) return;
        const cols = Array.from(checks.querySelectorAll('input:checked')).map((x) => +x.value).filter((i) => i !== +keyCol.value);
        m.close();
        this.checkpoint(net, 'Import a table');
        const r = this._join(net, table, { tableKey: +keyCol.value, nodeKey: nodeKey.value, ci: ci.checked, cols });
        this.applyStyle(net);
        this._changed(net);
        const fc = r.columns.find((c) => /^(log2foldchange|logfc|log2fc)$/i.test(c));
        toast(`Added ${plural(r.columns.length, 'column')} to ${r.matched} of ${plural(net.cy.nodes().length, 'node')}.` + (fc ? ` <button type="button" class="linkbtn" data-netstyle="expression">Colour the nodes by ${esc(fc)}</button>` : ''), 'ok', 9000);
        bus.emit('net:table', { matched: r.matched, columns: r.columns.length });
      }, '.primary');
      body.appendChild(h('div.acts', h('span.grow'), go));
      await load();
    }
    /** add the columns of a table to the nodes whose nodeKey matches the table's tableKey column → {matched, columns} */
    _join(net, table, o) {
      const ci = o.ci !== false;
      const norm = (v) => keyOf(v, ci);
      const index = new Map();
      for (const r of table.rows) {
        const k = norm(r[o.tableKey]);
        if (k && !index.has(k)) index.set(k, r);
      }
      const cols = (o.cols || table.columns.map((_, i) => i)).filter((i) => i !== o.tableKey);
      const taken = new Set(['id', 'source', 'target']);
      const names = cols.map((i) => {
        let c = table.columns[i];
        if (c === 'name' || IO.RESERVED.has(c) || c[0] === '_') c = IO.attrName(c === 'name' ? 'name_in_table' : c);
        if (taken.has(c)) c = IO.attrName(c, taken);
        taken.add(c);
        return c;
      });
      let matched = 0;
      const work = () =>
        net.cy.nodes().forEach((nd) => {
          const v = nd.data(o.nodeKey);
          if (v == null) return;
          let row = null;
          for (const x of String(v).split('|')) if ((row = index.get(norm(x)))) break;
          if (!row) return;
          matched++;
          if (o.dry) return;
          const d = {};
          cols.forEach((i, k) => (d[names[k]] = IO.value(row[i])));
          nd.data(d);
        });
      if (o.dry) work();
      else net.cy.batch(work);
      return { matched, columns: names };
    }
    expandDialog() {
      const net = this.cur;
      const sel = net.cy.$('node:selected');
      const { m, body } = dialog('Add interactors from STRING');
      const n = select([['5', '5'], ['10', '10'], ['20', '20'], ['50', '50']], '10');
      const score = select([['150', 'low (0.15)'], ['400', 'medium (0.4)'], ['700', 'high (0.7)'], ['900', 'highest (0.9)']], String(Math.round((net.data.confidence || 0.4) * 1000)));
      const sp = select(SPECIES, net.data.species || '9606');
      body.append(h('p.note', sel.length ? `The interactors of the ${plural(sel.length, 'selected node')}.` : 'The interactors of every node of the network (select some nodes first to expand only them).'), field('How many', n), field('Minimum confidence', score), field('Species', sp));
      body.appendChild(h('div.acts', h('span.grow'), btn('plus', 'Add them', null, async () => {
        m.close();
        try {
          await this.expand(net, { add: +n.value, score: +score.value, species: sp.value });
        } catch (e) {
          toast(esc(e.message), 'error', 8000);
        }
      }, '.primary')));
    }
    async expand(net, o) {
      const sel = net.cy.$('node:selected');
      const nodes = sel.length ? sel : net.cy.nodes();
      const ids = nodes.map((nd) => nd.data('stringId') || nd.data('name')).filter(Boolean);
      if (ids.length > 2000) throw new Error('Too many nodes to expand at once (at most 2,000): select some.');
      return this._busy('Asking STRING for interactors…', async () => {
        const species = String(o.species || net.data.species || '9606');
        const map = await this._stringIds(ids, species);
        await sleep(1000);
        const sids = Array.from(new Set(map.map((x) => x.stringId)));
        const edges = (await MG.apiCall({ method: 'POST', url: 'https://string-db.org/api/json/network', form: { identifiers: sids.join('\r'), species, required_score: o.score, add_nodes: o.add, caller_identity: CALLER }, service: 'STRING', label: `interactors of ${plural(sids.length, 'protein')}` })) || [];
        const extra = Array.from(new Set(edges.flatMap((e) => [e.stringId_A, e.stringId_B]))).filter((s) => !sids.includes(s));
        let more = [];
        if (extra.length) {
          await sleep(1000);
          more = await this._stringIds(extra, species, true);
        }
        const obj = IO.fromSTRING(map, edges, { more });
        this.checkpoint(net, 'Add interactors');
        const r = this._mergeInto(net, obj, { key: 'stringId', fallbackKey: 'name', near: true });
        if (r.nodes) await this.layout(net, 'fcose', { randomize: false, quiet: true, noUndo: true });
        this.applyStyle(net);
        this._changed(net);
        toast(`STRING added ${plural(r.nodes, 'node')} and ${plural(r.edges, 'edge')}.`, 'ok');
      });
    }
    /** STRING's interactions among the nodes of the network (a network from a list or a table, without edges) */
    async stringEdges() {
      const net = this.cur;
      const ids = net.cy.nodes().map((nd) => nd.data('stringId') || nd.data('name')).filter(Boolean);
      if (!ids.length) return;
      const species = String(net.data.species || '9606');
      try {
        await this._busy('Asking STRING…', async () => {
          const map = await this._stringIds(ids, species);
          await sleep(1000);
          const sids = Array.from(new Set(map.map((x) => x.stringId)));
          const edges = (await MG.apiCall({ method: 'POST', url: 'https://string-db.org/api/json/network', form: { identifiers: sids.join('\r'), species, required_score: Math.round((net.data.confidence || 0.4) * 1000), caller_identity: CALLER }, service: 'STRING', label: `interactions among ${plural(sids.length, 'protein')}` })) || [];
          this.checkpoint(net, 'STRING interactions');
          const r = this._mergeInto(net, IO.fromSTRING(map, edges, {}), { key: 'stringId', fallbackKey: 'name', near: true, noNewNodes: true });
          this.applyStyle(net);
          this._changed(net);
          toast(`STRING: ${plural(r.edges, 'interaction')} added${species !== '9606' ? '' : ' (human)'}.`, 'ok');
        });
      } catch (e) {
        toast(esc(e.message), 'error', 8000);
      }
    }
    /** nodes and edges of another network into this one (nodes matched by key) → {nodes, edges} added */
    _mergeInto(net, obj, o) {
      const cy = net.cy;
      const byKey = new Map();
      cy.nodes().forEach((nd) => {
        for (const k of [o.key, o.fallbackKey]) {
          const v = k && nd.data(k);
          if (v != null) byKey.set(String(v).toLowerCase(), nd.id());
        }
      });
      const idOf = new Map();
      let nAdd = 0, eAdd = 0;
      cy.batch(() => {
        for (const n of obj.nodes) {
          const k1 = n.data[o.key] != null ? String(n.data[o.key]).toLowerCase() : null, k2 = n.data[o.fallbackKey] != null ? String(n.data[o.fallbackKey]).toLowerCase() : null;
          const have = (k1 && byKey.get(k1)) || (k2 && byKey.get(k2));
          if (have) {
            idOf.set(n.id, have);
            const nd = cy.getElementById(have);
            const d = {};
            for (const [k, v] of Object.entries(n.data)) if (nd.data(k) == null && k !== 'queried') d[k] = v;
            nd.data(d);
            continue;
          }
          if (o.noNewNodes) continue;
          const id = 'n' + net.next++;
          idOf.set(n.id, id);
          cy.add({ group: 'nodes', data: Object.assign({}, n.data, { id }), position: { x: 0, y: 0 } });
          nAdd++;
        }
        const have = new Set();
        cy.edges().forEach((e) => {
          const a = e.source().id(), b = e.target().id();
          have.add(a < b ? a + '|' + b : b + '|' + a);
        });
        for (const e of obj.edges) {
          const a = idOf.get(e.source), b = idOf.get(e.target);
          if (!a || !b) continue;
          const key = a < b ? a + '|' + b : b + '|' + a;
          if (have.has(key)) continue;
          have.add(key);
          cy.add({ group: 'edges', data: Object.assign({}, e.data, { id: 'e' + net.next++, source: a, target: b }) });
          eAdd++;
        }
        // new nodes start next to a neighbour that was there
        if (o.near && nAdd) {
          cy.nodes().forEach((nd) => {
            const p = nd.position();
            if (p.x !== 0 || p.y !== 0) return;
            const old = nd.neighborhood('node').filter((x) => x.position().x !== 0 || x.position().y !== 0)[0];
            const c = old ? old.position() : { x: 0, y: 0 };
            nd.position({ x: c.x + (Math.random() - 0.5) * 80, y: c.y + (Math.random() - 0.5) * 80 });
          });
        }
      });
      return { nodes: nAdd, edges: eAdd };
    }
    async addNode() {
      const net = this.cur;
      const name = await MG.promptText('Add a node', 'The name of the new node:', '', 'Add');
      if (!name) return;
      this.checkpoint(net, 'Add a node');
      const ext = net.cy.extent();
      const nd = net.cy.add({ group: 'nodes', data: { id: 'n' + net.next++, name }, position: { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 } });
      this.applyStyle(net);
      net.cy.$(':selected').unselect();
      nd.select();
      this._changed(net);
    }
    async addEdge() {
      const net = this.cur;
      const sel = net.cy.$('node:selected');
      if (sel.length !== 2) return toast('Select exactly two nodes first (click one, then Shift+click the other).', 'warn', 5000);
      const it = await MG.promptText('Add an edge', `An edge from ${sel[0].data('name')} to ${sel[1].data('name')}. Its kind (interaction):`, 'interacts with', 'Add');
      if (!it) return;
      this.checkpoint(net, 'Add an edge');
      net.cy.add({ group: 'edges', data: { id: 'e' + net.next++, source: sel[0].id(), target: sel[1].id(), interaction: it } });
      this.applyStyle(net);
      this._changed(net);
    }
    deleteSelected() {
      const net = this.cur;
      if (!net) return;
      const sel = net.cy.$(':selected');
      if (!sel.length) return toast('Nothing is selected.', 'warn');
      this.checkpoint(net, 'Delete');
      const n = sel.nodes().length, e = sel.edges().union(sel.nodes().connectedEdges()).length;
      sel.remove();
      this._changed(net);
      toast(`Deleted ${n ? plural(n, 'node') : ''}${n && e ? ' and ' : ''}${e ? plural(e, 'edge') : ''}. Undo: Ctrl+Z.`, null, 3500);
    }
    setDirected(d) {
      const net = this.cur;
      net.directed = d;
      const a = net.style.edge.arrow;
      if (a.mode === 'fixed') a.value = d ? 'triangle' : 'none';
      this.applyStyle(net);
      this._changed(net);
    }
    mergeDialog() {
      const net = this.cur;
      const others = this.nets.filter((n) => n !== net);
      const { m, body } = dialog('Merge two networks');
      const other = select(others.map((n) => [n.id, n.name]), others[0].id);
      const op = select([['union', 'Union: the nodes and edges of both'], ['intersection', 'Intersection: what is in both'], ['difference', 'Difference: what is in this one only']], 'union');
      const key = select(['name', 'stringId', 'uniprot', 'query'].filter((k) => this._cols(net, 'nodes').some((c) => c.key === k)), 'name');
      body.append(h('p.note', `“${net.name}” and another network make a new network; the two stay as they are.`), field('The other network', other), field('Merge', op), field('Same node when the same', key));
      body.appendChild(h('div.acts', h('span.grow'), btn('layers', 'Merge', null, async () => {
        m.close();
        try {
          await this.merge(net, this.nets.find((n) => n.id === other.value), op.value, key.value);
        } catch (e) {
          toast(esc(e.message), 'error');
        }
      }, '.primary')));
    }
    async merge(a, b, op, key) {
      const A = this.toObject(a), B = this.toObject(b);
      const k = (n) => String(n.data[key] != null ? n.data[key] : n.data.name).toLowerCase();
      const ekey = (net, e) => {
        const ns = new Map(net.nodes.map((n) => [n.id, k(n)]));
        const x = ns.get(e.source), y = ns.get(e.target);
        return (x < y ? x + '|' + y : y + '|' + x) + '|' + String(e.data.interaction || '');
      };
      const bNodes = new Map(B.nodes.map((n) => [k(n), n])), aNodes = new Map(A.nodes.map((n) => [k(n), n]));
      const bEdges = new Set(B.edges.map((e) => ekey(B, e))), aEdges = new Set(A.edges.map((e) => ekey(A, e)));
      let nodes, edges;
      if (op === 'union') {
        nodes = A.nodes.map((n) => Object.assign({}, n, { data: Object.assign({}, (bNodes.get(k(n)) || {}).data || {}, n.data) }));
        const idOf = new Map(A.nodes.map((n) => [k(n), n.id]));
        for (const n of B.nodes) if (!aNodes.has(k(n))) {
          const id = 'b_' + n.id;
          idOf.set(k(n), id);
          nodes.push(Object.assign({}, n, { id }));
        }
        const bk = new Map(B.nodes.map((n) => [n.id, k(n)]));
        edges = A.edges.slice();
        for (const e of B.edges) if (!aEdges.has(ekey(B, e))) edges.push({ source: idOf.get(bk.get(e.source)), target: idOf.get(bk.get(e.target)), data: e.data });
      } else if (op === 'intersection') {
        nodes = A.nodes.filter((n) => bNodes.has(k(n)));
        edges = A.edges.filter((e) => bEdges.has(ekey(A, e)));
      } else {
        edges = A.edges.filter((e) => !bEdges.has(ekey(A, e)));
        const used = new Set(edges.flatMap((e) => [e.source, e.target]));
        nodes = A.nodes.filter((n) => !bNodes.has(k(n)) || used.has(n.id));
      }
      const net = await this._add({ name: `${a.name} ${op === 'union' ? '∪' : op === 'intersection' ? '∩' : '−'} ${b.name}`, directed: a.directed, data: Object.assign({}, a.data), nodes, edges }, { style: a.style, source: `merge of ${a.name} and ${b.name}`, noLayout: op !== 'union' });
      if (op === 'union') await this.layout(net, 'fcose', { randomize: false, quiet: true, noUndo: true });
      return net;
    }

    /* ================= style ================= */
    applyStyle(net) {
      if (!net) return;
      const st = net.style, cy = net.cy, N = cy.nodes(), E = cy.edges();
      const ev = {};
      for (const [k, , kind, rng] of PROPS.node) {
        const fb = defaultStyle().node[k].value;
        const map = st.node[k];
        if (map && map.mode === 'discrete' && kind === 'enum') map.choices = SHAPES;
        if (map && map.mode === 'continuous' && kind === 'number' && !map.out) map.out = rng;
        ev[k] = evaluator(map, kind, N, fb);
      }
      const ee = {};
      for (const [k, , kind, rng] of PROPS.edge) {
        const fb = defaultStyle().edge[k].value;
        const map = st.edge[k];
        if (map && map.mode === 'discrete' && kind === 'enum') map.choices = k === 'arrow' ? ARROWS.slice(1) : LINES;
        if (map && map.mode === 'continuous' && kind === 'number' && !map.out) map.out = rng;
        ee[k] = evaluator(map, kind, E, fb);
      }
      // charts on the nodes: one slice for each column, coloured by its value
      const ch = st.node.chart || { mode: 'none' };
      let slices = null;
      if (ch.mode === 'slices' && (ch.attrs || []).length) {
        const attrs = ch.attrs.slice(0, 8);
        let lo = Infinity, hi = -Infinity;
        N.forEach((nd) => attrs.forEach((a) => {
          const v = Number(nd.data(a));
          if (nd.data(a) != null && isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }));
        if (!isFinite(lo)) [lo, hi] = [0, 1];
        const pal = PALETTES[ch.palette || 'diverging'] || PALETTES.diverging;
        if ((ch.palette || 'diverging') === 'diverging') {
          const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
          lo = -m;
          hi = m;
        }
        if (ch.auto === false && isNum(ch.min) && isNum(ch.max)) [lo, hi] = [ch.min, ch.max];
        ch._range = [lo, hi];
        slices = (nd) => {
          const d = { _pn: attrs.length, _ph: ch.hole === false ? 0 : 45 };
          for (let i = 0; i < 8; i++) {
            const a = attrs[i];
            if (!a) {
              d[`_p${i + 1}`] = '#ffffff';
              d[`_q${i + 1}`] = 0;
              continue;
            }
            const v = Number(nd.data(a));
            d[`_p${i + 1}`] = nd.data(a) == null || !isFinite(v) ? MISSING : ramp(pal.stops, hi > lo ? (v - lo) / (hi - lo) : 0.5);
            d[`_q${i + 1}`] = 100 / attrs.length;
          }
          return d;
        };
      }
      cy.batch(() => {
        N.forEach((nd) => {
          const d = { _f: ev.fill(nd), _s: ev.size(nd), _sh: ev.shape(nd), _l: ev.label(nd), _fs: ev.labelSize(nd), _bc: ev.border(nd), _bw: ev.borderWidth(nd), _o: ev.opacity(nd) };
          Object.assign(d, slices ? slices(nd) : { _pn: 0 });
          nd.data(d);
        });
        E.forEach((e) => {
          let arrow = ee.arrow(e);
          e.data({ _c: ee.color(e), _w: ee.width(e), _ls: ee.line(e), _ta: arrow, _o: ee.opacity(e), _l: ee.label(e) });
        });
      });
      this._renderLegend();
    }
    /** a ready-made style. preset: default | string | expression | clusters | degree | intact | discrete | continuous */
    setStyle(net, preset, o = {}) {
      const st = net.style;
      const cols = this._cols(net, 'nodes');
      const has = (k) => cols.some((c) => c.key === k);
      const num = (re) => (cols.find((c) => c.kind === 'number' && re.test(c.key)) || {}).key;
      const ecols = this._cols(net, 'edges');
      if (preset === 'default') {
        const d = defaultStyle();
        st.node = d.node;
        st.edge = d.edge;
        if (net.directed) st.edge.arrow = { mode: 'fixed', value: 'triangle' };
      } else if (preset === 'string' || preset === 'intact') {
        const k = preset === 'string' ? 'score' : 'miscore';
        if (ecols.some((c) => c.key === k)) {
          st.edge.width = { mode: 'continuous', attr: k, auto: false, min: preset === 'string' ? 0.15 : 0, max: 1, out: [0.6, 6] };
          st.edge.opacity = { mode: 'continuous', attr: k, auto: false, min: preset === 'string' ? 0.15 : 0, max: 1, out: [0.35, 0.95] };
        }
        st.edge.color = { mode: 'fixed', value: '#8b97a4' };
      } else if (preset === 'expression') {
        const fc = o.fc && has(o.fc) ? o.fc : num(/^(log2foldchange|logfc|log2fc|lfc|log2_fold_change)$/i);
        const p = o.p !== undefined ? (o.p && has(o.p) ? o.p : null) : num(/^(padj|fdr|adj\.p\.val|qvalue|p_adj)$/i) || num(/^(pvalue|p\.value)$/i);
        if (!fc) {
          toast('The network has no column of fold changes (log2FoldChange, logFC …): import a table of results first.', 'warn', 7000);
          return;
        }
        st.node.fill = { mode: 'continuous', attr: fc, palette: 'diverging', mid: 0, clip: 0.95 };
        st.node.border = { mode: 'fixed', value: '#5c6773' };
        st.node.borderWidth = { mode: 'fixed', value: 1 };
        st.node.size = p ? { mode: 'continuous', attr: p, transform: 'neglog10', out: [18, 54], clip: 0.95 } : { mode: 'fixed', value: 30 };
      } else if (preset === 'clusters') {
        const c = o.attr || ['MCODE_Cluster', 'MCL_Cluster', 'Louvain_Community', 'Component'].find(has);
        if (!c) return toast('Find clusters first (Analyse → Clusters).', 'warn');
        st.node.fill = { mode: 'discrete', attr: c, map: {} };
        st.node.border = { mode: 'fixed', value: '#5c6773' };
      } else if (preset === 'degree') {
        if (!has('Degree')) this._degreeColumn(net);
        st.node.size = { mode: 'continuous', attr: 'Degree', out: [18, 70] };
        st.node.fill = { mode: 'continuous', attr: 'Degree', palette: 'sequential' };
      } else if (preset === 'discrete') {
        st.node[o.prop || 'fill'] = { mode: 'discrete', attr: o.attr, map: {} };
      } else if (preset === 'continuous') {
        const kind = (PROPS.node.find((p) => p[0] === (o.prop || 'fill')) || [])[2];
        st.node[o.prop || 'fill'] = kind === 'color' ? { mode: 'continuous', attr: o.attr, palette: o.palette || 'sequential', transform: o.transform } : { mode: 'continuous', attr: o.attr, transform: o.transform };
      }
      st.preset = preset;
      this.applyStyle(net);
      if (net === this.cur && this.sideTab === 'style') this._renderSide();
      this._saveSoon();
    }
    _degreeColumn(net) {
      net.cy.batch(() => net.cy.nodes().forEach((nd) => nd.data('Degree', nd.connectedEdges().length)));
    }
    _renderLegend() {
      const L = this.legendEl, net = this.cur;
      L.innerHTML = '';
      const items = net ? this.legendItems(net) : [];
      L.hidden = !net || !items.length || net.style.legend === false;
      if (L.hidden) return;
      const folded = !!net.legendFolded;
      L.classList.toggle('folded', folded);
      const tog = h('button.lg-toggle', { type: 'button', title: folded ? 'Show the legend' : 'Fold the legend away', 'aria-expanded': String(!folded), html: folded ? MG.icon('chevR') + '<span>Legend</span>' : MG.icon('minus') });
      tog.addEventListener('click', () => {
        net.legendFolded = !folded;
        this._renderLegend();
      });
      L.appendChild(tog);
      if (folded) return;
      for (const it of items) {
        const box = h('div.lg-item', h('h5', it.title));
        if (it.type === 'ramp') {
          box.appendChild(h('div.lg-ramp', { style: { background: `linear-gradient(to right, ${it.stops.map((s, i) => `${s} ${(i / (it.stops.length - 1)) * 100}%`).join(', ')})` } }));
          box.appendChild(h('div.lg-ticks', it.ticks.map((t) => h('span', t))));
        } else if (it.type === 'swatches') {
          it.items.forEach(([label, color]) => box.appendChild(h('div.lg-sw', h('i', { style: { background: color } }), h('span', label))));
        } else if (it.type === 'sizes') {
          box.appendChild(h('div.lg-sizes', it.items.map(([label, px]) => h('div', h('i', { style: { width: px + 'px', height: px + 'px' } }), h('span', label)))));
        } else if (it.type === 'widths') {
          it.items.forEach(([label, px]) => box.appendChild(h('div.lg-line', h('i', { style: { height: Math.max(1, px) + 'px' } }), h('span', label))));
        } else if (it.type === 'text') box.appendChild(h('div.lg-sw', h('span', it.text)));
        L.appendChild(box);
      }
    }
    /** what the legend shows: the mappings of the style */
    legendItems(net) {
      const st = net.style, out = [];
      const tfLabel = (m) => (m.transform && m.transform !== 'none' ? ` (${{ neglog10: '−log₁₀', abs: '|x|', log10: 'log₁₀' }[m.transform]})` : '');
      const sizeOf = (m, v) => {
        const [lo, hi] = m._range || [0, 1];
        const [a, b] = m.out || [10, 60];
        return a + (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (b - a);
      };
      const one = (kind, k, label, type, m) => {
        if (!m || m.mode === 'fixed' || m.mode === 'none' || m.mode === 'attr' || k === 'opacity') return;
        const title = `${kind === 'edge' ? 'Edge ' + label.toLowerCase() : label}: ${m.attr}${tfLabel(m)}`;
        if (m.mode === 'continuous') {
          const [lo, hi] = m._range || [0, 1];
          if (type === 'color') {
            const pal = (PALETTES[m.palette || 'sequential'] || PALETTES.sequential).stops;
            const mid = (lo + hi) / 2;
            const c = m._clipped || [];
            out.push({ title, type: 'ramp', stops: pal, ticks: [(c[0] ? '≤ ' : '') + fmt(+lo.toPrecision(3)), (m.palette || 'sequential') === 'diverging' ? fmt(+mid.toPrecision(3)) : '', (c[1] ? '≥ ' : '') + fmt(+hi.toPrecision(3))] });
          } else if (kind === 'node' && k === 'size') {
            const c = m._clipped || [];
            out.push({ title, type: 'sizes', items: [lo, (lo + hi) / 2, hi].map((v, i) => [(i === 2 && c[1] ? '≥ ' : '') + fmt(+v.toPrecision(3)), Math.max(4, Math.min(40, sizeOf(m, v) * 0.6))]) });
          } else if (kind === 'edge' && k === 'width') {
            out.push({ title, type: 'widths', items: [lo, (lo + hi) / 2, hi].map((v) => [fmt(+v.toPrecision(3)), sizeOf(m, v)]) });
          } else out.push({ title, type: 'text', text: `${fmt(+lo.toPrecision(3))} → ${fmt(+hi.toPrecision(3))}` });
        } else if (m.mode === 'discrete' && type === 'color') {
          const vals = (m._values || Object.keys(m.map || {})).slice();
          const nums = vals.every((v) => isFinite(Number(v)));
          vals.sort((a, b) => (nums ? Number(a) - Number(b) : 0));
          const shown = vals.filter((v) => m.map[v]).slice(0, 8);
          const items = shown.map((v) => [v, m.map[v]]);
          const rest = vals.length - shown.length;
          if (rest > 0) items.push([`${rest} more`, OTHER]);
          out.push({ title, type: 'swatches', items });
        } else if (m.mode === 'discrete') {
          const vals = (m._values || []).filter((v) => m.map[v]).slice(0, 8);
          out.push({ title, type: 'text', text: vals.map((v) => `${v}: ${m.map[v]}`).join(' · ') });
        }
      };
      for (const [k, label, type] of PROPS.node) one('node', k, label, type, st.node[k]);
      const ch = st.node.chart;
      if (ch && ch.mode === 'slices' && (ch.attrs || []).length) {
        const [lo, hi] = ch._range || [0, 1];
        out.push({ title: `Slices (clockwise from the top): ${ch.attrs.slice(0, 8).join(', ')}`, type: 'ramp', stops: (PALETTES[ch.palette || 'diverging'] || PALETTES.diverging).stops, ticks: [fmt(+lo.toPrecision(3)), '', fmt(+hi.toPrecision(3))] });
      }
      for (const [k, label, type] of PROPS.edge) one('edge', k, label, type, st.edge[k]);
      return out;
    }

    /* ================= layouts ================= */
    layoutMenu() {
      const sel = this.cur && this.cur.cy.$('node:selected').length;
      return [
        ['workflow', 'Force-directed (fCoSE)', () => this.layout(this.cur, 'fcose')],
        this.cur && this._weightCols(this.cur).length ? ['workflow', 'Force-directed, strong edges shorter', () => this.layout(this.cur, 'fcose-w')] : null,
        ['spin', 'Circle', () => this.layout(this.cur, 'circle')],
        ['target', 'Concentric: the most connected in the middle', () => this.layout(this.cur, 'concentric')],
        ['table', 'Grid', () => this.layout(this.cur, 'grid')],
        ['tree', 'Hierarchical (for directed networks: dagre)', () => this.layout(this.cur, 'dagre')],
        ['tree', sel ? 'Tree from the selected node' : 'Tree from the most connected node', () => this.layout(this.cur, 'breadthfirst')],
        ['layers', 'Groups: a circle for each value of a column…', () => this.groupLayoutDialog()],
        ['workflow', 'Spring-embedded (CoSE)', () => this.layout(this.cur, 'cose')],
        sel ? ['workflow', 'Force-directed: the selected nodes only', () => this.layout(this.cur, 'fcose', { selectedOnly: true, randomize: false })] : null,
        ['dots', 'Random', () => this.layout(this.cur, 'random')]
      ].map((x) => (x && !this.cur ? null : x));
    }
    _weightCols(net) {
      return this._cols(net, 'edges').filter((c) => c.kind === 'number' && /score|weight|confidence|miscore|strength/i.test(c.key));
    }
    async layout(net, name, o = {}) {
      if (!net) return;
      const cy = net.cy;
      if (name === 'groups') {
        // the column of the latest clusters, when none is named
        const last = net.results.find((r) => r.type === 'clusters' && cy.nodes().some((nd) => nd.data(r.column) != null));
        const attr = o.attr || (last && last.column) || ['MCODE_Cluster', 'MCL_Cluster', 'Louvain_Community', 'Component'].find((k) => cy.nodes().some((nd) => nd.data(k) != null));
        return attr ? this.groupLayout(net, attr) : this.groupLayoutDialog();
      }
      if (!o.noUndo) this.checkpoint(net, 'Layout');
      const n = cy.nodes().length;
      const animate = n <= 1500 && !o.quiet;
      const eles = o.selectedOnly ? cy.$('node:selected').union(cy.$('node:selected').edgesWith(cy.$('node:selected'))) : cy.elements(':visible');
      let opts;
      if (name === 'fcose' || name === 'fcose-w') {
        opts = { name: 'fcose', quality: n > 2000 ? 'draft' : 'default', randomize: o.randomize !== false, animate, animationDuration: 600, fit: false, padding: 30, nodeDimensionsIncludeLabels: false, packComponents: true, nodeRepulsion: () => 9000, idealEdgeLength: () => 70, edgeElasticity: () => 0.45, gravity: 0.25, gravityRange: 3.8, numIter: 2500, tile: true, tilingPaddingVertical: 16, tilingPaddingHorizontal: 16, nodeSeparation: 80 };
        if (name === 'fcose-w') {
          const k = this._weightCols(net)[0].key;
          const r = rangeOf(cy.edges(), k, (v) => v) || [0, 1];
          const t = (e) => (r[1] > r[0] ? clamp((Number(e.data(k)) - r[0]) / (r[1] - r[0]), 0, 1) : 0.5) || 0;
          opts.idealEdgeLength = (e) => 30 + 120 * (1 - t(e));
          opts.edgeElasticity = (e) => 0.15 + 0.7 * t(e);
        }
      } else if (name === 'concentric') opts = { name: 'concentric', concentric: (nd) => nd.degree(), levelWidth: (nodes) => Math.max(1, nodes.maxDegree() / 6), minNodeSpacing: 12, animate, padding: 30, fit: false };
      else if (name === 'dagre') opts = { name: 'dagre', rankDir: 'TB', nodeSep: 18, rankSep: 55, edgeSep: 6, animate, padding: 30, fit: false };
      else if (name === 'breadthfirst') {
        let roots = cy.$('node:selected');
        if (!roots.length) roots = cy.nodes().max((nd) => nd.degree()).ele;
        opts = { name: 'breadthfirst', roots, directed: net.directed, spacingFactor: 1.05, animate, padding: 30, fit: false };
      } else if (name === 'grid') opts = { name: 'grid', avoidOverlap: true, animate, padding: 30, fit: false };
      else if (name === 'circle') opts = { name: 'circle', avoidOverlap: true, animate, padding: 30, fit: false };
      else if (name === 'cose') opts = { name: 'cose', animate, padding: 30, randomize: true, nodeRepulsion: () => 400000, idealEdgeLength: () => 40, fit: false };
      else if (name === 'random') opts = { name: 'random', animate, padding: 30, fit: false };
      else throw new Error('no such layout: ' + name);
      if (name === 'dagre' && !window.cytoscapeDagre) throw new Error('The hierarchical layout did not load.');
      const lay = eles.layout(opts);
      const done = new Promise((res) => lay.one('layoutstop', res));
      try {
        lay.run();
      } catch (e) {
        console.error(e);
        toast('The layout failed: ' + esc(e.message), 'error');
        return;
      }
      await done;
      if (!o.selectedOnly) this._fit(net, animate);
      this._changed(net, { positions: true });
      bus.emit('net:layout', { name });
    }
    groupLayoutDialog() {
      const net = this.cur;
      const cols = this._cols(net, 'nodes').filter((c) => c.key !== 'name');
      const pref = ['MCODE_Cluster', 'MCL_Cluster', 'Louvain_Community', 'Component'].find((k) => cols.some((c) => c.key === k));
      const { m, body } = dialog('Lay out by groups');
      const col = select(cols.map((c) => c.key), pref || (cols[0] || {}).key);
      body.append(h('p.note', 'The nodes with the same value of a column – the same cluster, the same kind – are drawn together, in a circle; the largest groups first.'), field('Group by', col));
      body.appendChild(h('div.acts', h('span.grow'), btn('layers', 'Lay out', null, () => {
        m.close();
        this.groupLayout(net, col.value);
      }, '.primary')));
    }
    async groupLayout(net, attr) {
      const cy = net.cy;
      this.checkpoint(net, 'Layout');
      const groups = new Map();
      cy.nodes(':visible').forEach((nd) => {
        const v = nd.data(attr);
        const k = v == null || v === '' ? '\u0000' : String(v);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(nd);
      });
      const list = Array.from(groups.entries()).sort((a, b) => (a[0] === '\u0000') - (b[0] === '\u0000') || b[1].length - a[1].length);
      const pos = {};
      const gap = 50, spacing = 42;
      let x = 0, y = 0, rowH = 0;
      const rowW = Math.max(900, Math.sqrt(cy.nodes().length) * 120);
      for (const [, nodes] of list) {
        const k = nodes.length;
        const r = k === 1 ? 0 : Math.max(spacing, (k * spacing) / (2 * Math.PI));
        const d = 2 * r + spacing;
        if (x > 0 && x + d > rowW) {
          x = 0;
          y += rowH + gap;
          rowH = 0;
        }
        const cx = x + d / 2, cyy = y + d / 2;
        nodes.sort((a, b) => b.degree() - a.degree());
        nodes.forEach((nd, i) => {
          const a = (2 * Math.PI * i) / k - Math.PI / 2;
          pos[nd.id()] = { x: cx + r * Math.cos(a), y: cyy + r * Math.sin(a) };
        });
        x += d + gap;
        rowH = Math.max(rowH, d);
      }
      const lay = cy.layout({ name: 'preset', positions: (nd) => pos[nd.id()] || nd.position(), animate: cy.nodes().length <= 1500, animationDuration: 500, fit: false, padding: 30 });
      const done = new Promise((res) => lay.one('layoutstop', res));
      lay.run();
      await done;
      this._fit(net, true);
      this._changed(net, { positions: true });
    }
    zoomBy(f) {
      const net = this.cur;
      if (!net) return;
      const cy = net.cy;
      // (an animation still running – a fit, a zoom – ends first, where it was going)
      cy.stop(true, true);
      // (about the middle of the view: the point there stays where it is)
      const z = cy.zoom(), z2 = clamp(z * f, cy.minZoom(), cy.maxZoom());
      const c = { x: cy.width() / 2, y: cy.height() / 2 }, p = cy.pan();
      cy.animate({ zoom: z2, pan: { x: c.x - ((c.x - p.x) / z) * z2, y: c.y - ((c.y - p.y) / z) * z2 } }, { duration: 150 });
    }

    /* ================= selection ================= */
    selectMenu() {
      const n = this.cur;
      if (!n) return [];
      const sel = n.cy.$('node:selected').length;
      return [
        ['selectAll', 'All nodes', () => n.cy.nodes(':visible').select()],
        ['clear', 'Nothing (Esc)', () => n.cy.$(':selected').unselect()],
        ['invert', 'Invert the selection', () => {
          const s = n.cy.$('node:selected');
          n.cy.batch(() => {
            n.cy.nodes(':visible').select();
            s.unselect();
          });
        }],
        sel ? ['plus', 'Add their first neighbours', () => n.cy.$('node:selected').neighborhood('node').select()] : null,
        sel ? ['link', 'The edges between the selected nodes', () => n.cy.$('node:selected').edgesWith(n.cy.$('node:selected')).select()] : null,
        ['filter', 'Nodes without edges', () => {
          n.cy.$(':selected').unselect();
          n.cy.nodes().filter((x) => x.degree(false) === 0).select();
        }],
        ['filter', 'By the values of a column…', () => this.showSide('select')],
        sel === 2 ? ['arrow', 'The shortest path between the two', () => this.shortestPath()] : null,
        sel ? ['layers', 'A new network of the selected nodes', () => this.subnetwork()] : null,
        sel ? ['eyeOff', 'Hide the selected nodes', () => this.hideSelected()] : null,
        n.cy.$('.hidden').length ? ['eye', 'Show the hidden nodes', () => this.showAll()] : null,
        sel ? ['trash', 'Delete the selected nodes', () => this.deleteSelected()] : null,
        sel ? ['copy', 'Copy their names', () => this.copyNames()] : null
      ];
    }
    hideSelected() {
      const net = this.cur;
      const s = net.cy.$('node:selected');
      net.cy.batch(() => {
        s.addClass('hidden');
        s.connectedEdges().addClass('hidden');
        s.unselect();
      });
      this._changed(net);
    }
    showAll() {
      const net = this.cur;
      net.cy.$('.hidden').removeClass('hidden');
      this._changed(net);
    }
    async copyNames() {
      const names = this.cur.cy.$('node:selected').map((n) => n.data('name'));
      const ok = await MG.copyText(names.join('\n'));
      toast(ok ? `Copied ${plural(names.length, 'name')}.` : 'Could not copy.', ok ? null : 'warn', 2000);
    }
    async subnetwork() {
      const net = this.cur;
      const nodes = net.cy.$('node:selected');
      if (!nodes.length) return toast('Select some nodes first.', 'warn');
      const only = nodes.union(nodes.edgesWith(nodes));
      return this.duplicate(net, only, `${net.name} – ${plural(nodes.length, 'node')}`);
    }
    shortestPath() {
      const net = this.cur;
      const sel = net.cy.$('node:selected');
      if (sel.length !== 2) return toast('Select exactly two nodes first.', 'warn');
      const g = this._graph(net);
      const G = ALG.graph(g.n, Array.from(g.src, (s, i) => [s, g.dst[i]]));
      const path = ALG.shortestPath(G, g.idx.get(sel[0].id()), g.idx.get(sel[1].id()));
      if (!path) return toast(`There is no path between ${esc(sel[0].data('name'))} and ${esc(sel[1].data('name'))}: they are in different parts of the network.`, 'warn', 6000);
      const nodes = path.map((i) => g.nodes[i]);
      net.cy.batch(() => {
        net.cy.$(':selected').unselect();
        nodes.forEach((n, i) => {
          n.select();
          if (i) n.edgesWith(nodes[i - 1]).select();
        });
      });
      this.addResult(net, { type: 'path', title: `Shortest path: ${nodes[0].data('name')} → ${nodes[nodes.length - 1].data('name')}`, names: nodes.map((n) => n.data('name')), ids: nodes.map((n) => n.id()) });
    }
    /** search: highlight the nodes whose names (or other text) contain q; go: select them */
    search(q, go) {
      const net = this.cur;
      if (!net) return;
      const cy = net.cy;
      cy.$('.hit').removeClass('hit');
      q = q.trim().toLowerCase();
      if (!q) {
        this.searchCount.textContent = '';
        return;
      }
      const words = q.split(/[\s,;]+/).filter(Boolean);
      const hits = cy.nodes().filter((n) => {
        const name = String(n.data('name') || '').toLowerCase();
        return words.some((w) => name === w || name.includes(w) || (w.length > 2 && ['query', 'stringId', 'uniprot', 'description'].some((k) => String(n.data(k) || '').toLowerCase().includes(w))));
      });
      hits.addClass('hit');
      this.searchCount.textContent = hits.length ? String(hits.length) : 'none';
      if (go && hits.length) {
        cy.$(':selected').unselect();
        hits.select();
        this._view(this.cur, hits.closedNeighborhood());
      }
    }

    /* ================= the side panel ================= */
    _renderSide() {
      const k = this.sideTab;
      const B = this.sbodies[k];
      if (!B) return;
      if (k === 'style') this._renderStyle(B);
      else if (k === 'select') this._renderSelect(B);
      else if (k === 'results') this._renderResults(B);
      else if (k === 'details') this._renderDetails(B);
    }
    _renderStyle(B) {
      B.innerHTML = '';
      const net = this.cur;
      if (!net) return B.appendChild(h('p.net-hint', 'Open a network to style it.'));
      const st = net.style;
      const cols = this._cols(net, 'nodes'), ecols = this._cols(net, 'edges');
      const presets = h('div.net-presets');
      [
        ['default', 'Plain'], ['string', 'Confidence'], ['expression', 'Expression'], ['clusters', 'Clusters'], ['degree', 'Degree']
      ].forEach(([k, l]) => {
        const b = h('button.chip' + (st.preset === k ? '.on' : ''), { type: 'button', title: { default: 'One colour, one size', string: 'Edges: thicker for a higher score (STRING, IntAct)', expression: 'Fill: the fold change (blue down, red up); size: −log₁₀ adjusted p', clusters: 'Fill: the cluster of each node (after Analyse → Clusters)', degree: 'Size and colour: the number of edges of each node' }[k] }, l);
        b.addEventListener('click', () => this.setStyle(net, k));
        presets.appendChild(b);
      });
      const legend = h('input', { type: 'checkbox', checked: st.legend !== false });
      legend.addEventListener('change', () => {
        st.legend = legend.checked;
        this._renderLegend();
        this._saveSoon();
      });
      B.append(h('h4', 'Ready-made'), presets, h('div.net-row', h('label', legend, ' Show the legend')));
      B.appendChild(h('h4', 'Nodes'));
      for (const p of PROPS.node) B.appendChild(this._propEditor(net, 'node', p, cols));
      B.appendChild(this._chartEditor(net, cols));
      B.appendChild(h('h4', 'Edges'));
      for (const p of PROPS.edge) B.appendChild(this._propEditor(net, 'edge', p, ecols));
      B.appendChild(h('p.net-hint', 'A column → a property: numbers can be mapped continuously (a range of colours or sizes), any column by its values (each value its own colour or shape). Click a column’s ⋯ in the table for the same.'));
    }
    _propEditor(net, kind, [k, label, type, rng], cols) {
      const st = net.style[kind];
      const m = st[k] || { mode: 'fixed', value: defaultStyle()[kind][k].value };
      const row = h('div.net-prop');
      const src = h('select', { 'aria-label': `${label}: fixed or from a column` });
      src.appendChild(h('option', { value: '' }, type === 'text' ? '(none)' : 'the same for all'));
      cols.forEach((c) => src.appendChild(h('option', { value: c.key }, c.key + (c.kind === 'number' ? ' (number)' : ''))));
      src.value = m.mode === 'fixed' || m.mode === 'none' ? '' : m.attr || '';
      const set = (nm) => {
        st[k] = nm;
        net.style.preset = null;
        this.applyStyle(net);
        this._saveSoon();
        this._renderStyle(this.sbodies.style);
      };
      src.addEventListener('change', () => {
        const v = src.value;
        if (type === 'text') return set(v ? { mode: 'attr', attr: v } : { mode: 'none' });
        if (!v) return set({ mode: 'fixed', value: defaultStyle()[kind][k].value });
        const col = cols.find((c) => c.key === v);
        if (col && col.kind === 'number' && (type === 'color' || type === 'number')) set({ mode: 'continuous', attr: v, palette: type === 'color' ? 'sequential' : undefined, out: type === 'number' ? rng : undefined });
        else set({ mode: 'discrete', attr: v, map: {} });
      });
      row.append(h('label', label), src);
      if (m.mode === 'fixed' || (type === 'text' && m.mode !== 'attr')) {
        if (type !== 'text') {
          let input;
          if (type === 'color') input = h('input', { type: 'color', value: m.value });
          else if (type === 'number') input = h('input', { type: 'number', value: m.value, min: rng[0], max: rng[1], step: rng[1] <= 1 ? 0.05 : 0.5 });
          else input = select(type === 'enum' ? rng : [], m.value);
          input.addEventListener('change', () => {
            const v = type === 'number' ? clamp(Number(input.value), rng[0], rng[1]) : input.value;
            st[k] = { mode: 'fixed', value: v };
            net.style.preset = null;
            this.applyStyle(net);
            this._saveSoon();
          });
          row.appendChild(h('div.net-map', input));
        }
        return row;
      }
      if (m.mode === 'continuous') {
        const box = h('div.net-map');
        const apply = () => {
          net.style.preset = null;
          this.applyStyle(net);
          this._saveSoon();
        };
        const tf = select(Object.entries(TRANSFORMS).map(([a, b]) => [a, b.label]), m.transform || 'none');
        tf.addEventListener('change', () => {
          m.transform = tf.value;
          apply();
          this._renderStyle(this.sbodies.style);
        });
        box.append(h('label', 'value', tf));
        if (type === 'color') {
          const pal = select(Object.entries(PALETTES).map(([a, b]) => [a, b.label]), m.palette || 'sequential');
          pal.addEventListener('change', () => {
            m.palette = pal.value;
            apply();
            this._renderStyle(this.sbodies.style);
          });
          box.append(h('label', 'colours', pal));
        } else {
          const a = h('input', { type: 'number', value: (m.out || rng)[0], step: 'any' }), b = h('input', { type: 'number', value: (m.out || rng)[1], step: 'any' });
          const upd = () => {
            m.out = [Number(a.value), Number(b.value)];
            apply();
          };
          a.addEventListener('change', upd);
          b.addEventListener('change', upd);
          box.append(h('label', 'from', a), h('label', 'to', b));
        }
        const range = select([['all', 'all the values'], ['0.95', '95% of them (the rest at the ends)'], ['0.99', '99% of them'], ['custom', 'from … to …']], m.auto === false ? 'custom' : m.clip ? String(m.clip) : 'all');
        const lo = h('input', { type: 'number', value: m._range ? +m._range[0].toPrecision(4) : '', step: 'any', disabled: m.auto !== false });
        const hi = h('input', { type: 'number', value: m._range ? +m._range[1].toPrecision(4) : '', step: 'any', disabled: m.auto !== false });
        range.addEventListener('change', () => {
          if (range.value === 'custom') {
            m.auto = false;
            if (m._range) [m.min, m.max] = m._range;
          } else {
            m.auto = true;
            m.clip = range.value === 'all' ? null : Number(range.value);
          }
          apply();
          this._renderStyle(this.sbodies.style);
        });
        const upd2 = () => {
          m.min = Number(lo.value);
          m.max = Number(hi.value);
          apply();
        };
        lo.addEventListener('change', upd2);
        hi.addEventListener('change', upd2);
        box.append(h('label', 'range', range), h('label', 'min', lo), h('label', 'max', hi));
        row.appendChild(box);
        return row;
      }
      if (m.mode === 'discrete') {
        const box = h('div.net-disc');
        const vals = (m._values || []).slice(0, 40);
        const nums = vals.every((v) => isFinite(Number(v)));
        vals.sort((a, b) => (nums ? Number(a) - Number(b) : 0));
        for (const v of vals) {
          const cur = m.map[v];
          let input;
          if (type === 'color') input = h('input', { type: 'color', value: cur || OTHER });
          else if (type === 'enum') input = select(rng, cur || rng[0]);
          else input = h('input', { type: 'number', value: cur == null ? '' : cur, step: 'any' });
          input.addEventListener('change', () => {
            m.map[v] = type === 'number' ? Number(input.value) : input.value;
            this.applyStyle(net);
            this._saveSoon();
          });
          box.append(h('span', { title: v }, v), input);
        }
        if ((m._values || []).length > 40) box.append(h('span.net-hint', `… and ${m._values.length - 40} more values`), h('span'));
        row.appendChild(box);
        if (type === 'color' && (m._values || []).length > CAT.length) row.appendChild(h('div.net-map', h('span.net-hint', `${m._values.length} values: the first ${CAT.length} get their own colour, the others are grey – choose a colour for any of them above.`)));
        return row;
      }
      if (m.mode === 'attr') return row;
      return row;
    }
    _chartEditor(net, cols) {
      const st = net.style.node;
      const ch = (st.chart = st.chart || { mode: 'none' });
      const row = h('div.net-prop');
      const nums = cols.filter((c) => c.kind === 'number');
      const checks = h('div.net-map');
      nums.forEach((c) => {
        const i = h('input', { type: 'checkbox', checked: (ch.attrs || []).includes(c.key) });
        i.addEventListener('change', () => {
          const set = new Set(ch.attrs || []);
          if (i.checked) set.add(c.key);
          else set.delete(c.key);
          ch.attrs = nums.map((x) => x.key).filter((x) => set.has(x)).slice(0, 8);
          ch.mode = ch.attrs.length ? 'slices' : 'none';
          this.applyStyle(net);
          this._saveSoon();
        });
        checks.appendChild(h('label', i, c.key));
      });
      if (!nums.length) checks.appendChild(h('span.net-hint', 'No columns of numbers yet.'));
      row.append(h('label', 'Chart'), h('span.net-hint', 'a ring of slices, one for each column ticked (e.g. the fold changes of several experiments)'), checks);
      return row;
    }

    /* the Select tab: filters */
    _renderSelect(B) {
      B.innerHTML = '';
      const net = this.cur;
      if (!net) return B.appendChild(h('p.net-hint', 'Open a network first.'));
      const kindSel = select([['nodes', 'Nodes'], ['edges', 'Edges']], this.condKind || 'nodes');
      kindSel.addEventListener('change', () => {
        this.condKind = kindSel.value;
        this.conds = [];
        this._renderSelect(B);
      });
      const all = select([['all', 'all of these'], ['any', 'any of these']], this.condAll || 'all');
      all.addEventListener('change', () => (this.condAll = all.value));
      B.append(h('h4', 'Select by the values of columns'), h('div.net-row', kindSel, h('span', 'where'), all));
      const cols = this._cols(net, this.condKind || 'nodes').concat((this.condKind || 'nodes') === 'nodes' ? [{ key: '(degree)', kind: 'number' }] : []);
      if (!this.conds.length) this.conds.push({ col: (cols.find((c) => c.kind === 'number') || cols[0] || {}).key, op: '>=', val: '' });
      this.conds.forEach((c, i) => {
        const col = select(cols.map((x) => x.key), c.col);
        const kind = (cols.find((x) => x.key === c.col) || {}).kind || 'text';
        const ops = kind === 'number' ? [['>=', '≥'], ['>', '>'], ['<=', '≤'], ['<', '<'], ['=', '='], ['!=', '≠'], ['abs>=', '|x| ≥'], ['between', 'between'], ['missing', 'is missing'], ['present', 'is not missing']] : kind === 'boolean' ? [['true', 'is true'], ['false', 'is false']] : [['contains', 'contains'], ['=', 'is'], ['!=', 'is not'], ['starts', 'starts with'], ['regex', 'matches (regular expression)'], ['missing', 'is missing'], ['present', 'is not missing']];
        if (!ops.some((o) => o[0] === c.op)) c.op = ops[0][0];
        const op = select(ops, c.op);
        const val = h('input', { type: 'text', value: c.val, placeholder: kind === 'number' ? 'a number' : 'text', spellcheck: 'false' });
        const val2 = h('input', { type: 'text', value: c.val2 || '', placeholder: 'and', hidden: c.op !== 'between' });
        const x = h('button.net-cond-x', { type: 'button', title: 'Remove this condition', html: MG.icon('x') });
        col.addEventListener('change', () => {
          c.col = col.value;
          this._renderSelect(B);
        });
        op.addEventListener('change', () => {
          c.op = op.value;
          val2.hidden = c.op !== 'between';
        });
        val.addEventListener('input', () => (c.val = val.value));
        val2.addEventListener('input', () => (c.val2 = val2.value));
        x.addEventListener('click', () => {
          this.conds.splice(i, 1);
          this._renderSelect(B);
        });
        B.appendChild(h('div.net-cond', col, op, val, val2, x));
      });
      const addC = h('button.btn.small', { type: 'button', html: MG.icon('plus') + '<span>Another condition</span>' });
      addC.addEventListener('click', () => {
        this.conds.push({ col: (cols[0] || {}).key, op: '', val: '' });
        this._renderSelect(B);
      });
      const go = (mode) => () => {
        const hits = this._filter(net, this.condKind || 'nodes', this.conds, this.condAll || 'all');
        if (mode === 'new') {
          net.cy.$(':selected').unselect();
          hits.select();
          return this.subnetwork();
        }
        if (mode === 'replace') net.cy.$(':selected').unselect();
        hits.select();
        toast(`${plural(hits.length, (this.condKind || 'nodes') === 'nodes' ? 'node' : 'edge')} ${hits.length === 1 ? 'matches' : 'match'}.`, null, 2500);
      };
      B.append(addC, h('div.net-acts', btn('boxsel', 'Select', 'Select what matches (and nothing else)', go('replace'), '.primary'), btn('plus', 'Add to the selection', null, go('add')), (this.condKind || 'nodes') === 'nodes' ? btn('layers', 'New network', 'A new network of the nodes that match, with the edges between them', go('new')) : null));
      const sn = net.cy.$('node:selected'), se = net.cy.$('edge:selected');
      B.append(h('h4', 'What is selected'), h('p', sn.length || se.length ? `${plural(sn.length, 'node')}, ${plural(se.length, 'edge')}.` : 'Nothing. Click a node; Shift+click for more; Shift+drag a box around several.'));
      if (sn.length) {
        B.append(h('div.net-acts', btn('plus', 'Neighbours', 'Add the first neighbours of the selected nodes', () => sn.neighborhood('node').select()), btn('layers', 'New network', 'A new network of the selected nodes', () => this.subnetwork()), btn('eyeOff', 'Hide', null, () => this.hideSelected()), btn('trash', 'Delete', null, () => this.deleteSelected()), btn('copy', 'Copy names', null, () => this.copyNames()), btn('chart', 'Enrichment', 'Functional enrichment of the selected genes', () => this.enrichmentDialog({ nodes: 'selected' }))));
      }
    }
    _filter(net, kind, conds, how) {
      const eles = kind === 'nodes' ? net.cy.nodes() : net.cy.edges();
      const tests = conds.filter((c) => c.col).map((c) => {
        const get = c.col === '(degree)' ? (e) => e.degree(false) : (e) => e.data(c.col);
        const num = Number(c.val), num2 = Number(c.val2);
        const s = String(c.val || '').toLowerCase();
        let re = null;
        if (c.op === 'regex') {
          try {
            re = new RegExp(c.val, 'i');
          } catch (e) {
            re = /$^/;
          }
        }
        return (e) => {
          const v = get(e);
          const miss = v == null || v === '';
          switch (c.op) {
            case 'missing': return miss;
            case 'present': return !miss;
            case 'true': return v === true || v === 'true';
            case 'false': return v === false || v === 'false';
          }
          if (miss) return false;
          const n = Number(v);
          switch (c.op) {
            case '>=': return n >= num;
            case '>': return n > num;
            case '<=': return n <= num;
            case '<': return n < num;
            case 'abs>=': return Math.abs(n) >= num;
            case 'between': return n >= Math.min(num, num2) && n <= Math.max(num, num2);
            case '=': return isFinite(n) && c.val !== '' && isFinite(num) && typeof v === 'number' ? n === num : String(v).toLowerCase() === s;
            case '!=': return isFinite(n) && typeof v === 'number' && c.val !== '' && isFinite(num) ? n !== num : String(v).toLowerCase() !== s;
            case 'contains': return String(v).toLowerCase().includes(s);
            case 'starts': return String(v).toLowerCase().startsWith(s);
            case 'regex': return re.test(String(v));
          }
          return false;
        };
      });
      if (!tests.length) return eles.filter(() => false);
      return eles.filter((e) => (how === 'any' ? tests.some((t) => t(e)) : tests.every((t) => t(e))));
    }

    /* the Details tab: what is selected */
    _selChanged() {
      this._renderStatus();
      this._markRows();
      if (this.sideTab === 'details' || this.sideTab === 'select') this._renderSide();
      else if (this.cur && this.cur.cy.$(':selected').length) this._dot('details');
    }
    _renderDetails(B) {
      B.innerHTML = '';
      const net = this.cur;
      if (!net) return B.appendChild(h('p.net-hint', 'Open a network first.'));
      const sn = net.cy.$('node:selected'), se = net.cy.$('edge:selected');
      if (!sn.length && !se.length) {
        B.append(h('p.net-hint', 'Click a node or an edge to see its details here. Right-click a node for more.'), h('h4', 'This network'), this._kv(Object.assign({ Name: net.name, Source: net.source || '–', Nodes: net.cy.nodes().length, Edges: net.cy.edges().length, Directed: net.directed ? 'yes' : 'no' }, Object.fromEntries(Object.entries(net.data).filter(([, v]) => v != null && typeof v !== 'object')))));
        return;
      }
      if (sn.length === 1 && !se.length) return this._nodeDetails(B, net, sn[0]);
      if (se.length === 1 && !sn.length) {
        const e = se[0];
        B.append(h('div.net-det', h('h3', `${e.source().data('name')} — ${e.target().data('name')}`), h('p.sub', e.data('interaction') || 'edge')), this._kv(this._dataOf(e)));
        return;
      }
      B.append(h('div.net-det', h('h3', `${plural(sn.length, 'node')}, ${plural(se.length, 'edge')}`)), h('p', sn.map((n) => n.data('name')).slice(0, 80).join(', ') + (sn.length > 80 ? ' …' : '')), h('div.net-acts', btn('copy', 'Copy names', null, () => this.copyNames()), btn('layers', 'New network', null, () => this.subnetwork()), btn('chart', 'Enrichment', null, () => this.enrichmentDialog({ nodes: 'selected' }))));
    }
    _dataOf(ele) {
      const o = {};
      for (const [k, v] of Object.entries(ele.data())) if (k[0] !== '_' && k !== 'id' && k !== 'source' && k !== 'target') o[k] = v;
      return o;
    }
    _kv(o) {
      return h('table.net-kv', Object.entries(o).map(([k, v]) => h('tr', h('td', k), h('td', fmt(v)))));
    }
    _nodeDetails(B, net, nd) {
      const d = this._dataOf(nd);
      const name = String(d.name || nd.id());
      const species = String(net.data.species || '');
      const links = h('div.links');
      const a = (href, text) => links.appendChild(h('a', { href, target: '_blank', rel: 'noopener' }, text));
      if (d.stringId) a(`https://string-db.org/network/${enc(d.stringId)}`, 'STRING');
      if (d.uniprot) a(`https://www.uniprot.org/uniprotkb/${enc(d.uniprot)}`, 'UniProt');
      const ens = String(d.query || d.row || '').split('|').find((x) => /^ENS[A-Z]*G\d+/.test(x));
      if (ens) a(`https://www.ensembl.org/id/${enc(ens)}`, 'Ensembl');
      if (/^[A-Za-z0-9-]{2,15}$/.test(name)) a(`https://www.ncbi.nlm.nih.gov/gene/?term=${enc(name)}${species ? '%5Bsym%5D+AND+txid' + enc(species) + '%5Borgn%5D' : ''}`, 'NCBI Gene');
      B.append(h('div.net-det', h('h3', name), h('p.sub', d.description ? String(d.description).slice(0, 200) : `${nd.degree(false)} edges`), links));
      B.append(h('div.net-acts', btn('plus', 'Neighbours', 'Select its first neighbours', () => nd.closedNeighborhood('node').select()), btn('database', 'UniProt', 'Look it up in the UniProt card of the Databases tab', () => this.toUniProt(nd)), btn('cube', 'AlphaFold', 'Its predicted structure in the 3D viewer', () => this.toAlphaFold(nd).catch((e) => toast(esc(e.message), 'error', 7000))), species === '9606' || !species ? btn('genome', 'Genome', 'Its gene in the Genome browser (human, hg38)', () => this.toGenome(nd)) : null));
      B.append(h('h4', 'Columns'), this._kv(d));
    }
    _context(net, e) {
      const oe = e.originalEvent || {};
      const x = oe.clientX || 100, y = oe.clientY || 100;
      if (e.target === net.cy) {
        const p = e.position;
        return menuAt(x, y, [
          ['plus', 'Add a node here…', async () => {
            const name = await MG.promptText('Add a node', 'The name of the new node:', '', 'Add');
            if (!name) return;
            this.checkpoint(net, 'Add a node');
            net.cy.add({ group: 'nodes', data: { id: 'n' + net.next++, name }, position: { x: p.x, y: p.y } });
            this.applyStyle(net);
            this._changed(net);
          }],
          ['maximize', 'Fit the network', () => this._fit(net, true)],
          ['selectAll', 'Select all', () => net.cy.nodes(':visible').select()]
        ]);
      }
      const t = e.target;
      if (t.isNode && t.isNode()) {
        if (!t.selected()) {
          net.cy.$(':selected').unselect();
          t.select();
        }
        const species = String(net.data.species || '');
        return menuAt(x, y, [
          ['plus', 'Select its first neighbours', () => t.closedNeighborhood('node').select()],
          ['link', 'Add its interactors from STRING', () => this.expand(net, { add: 10, score: Math.round((net.data.confidence || 0.4) * 1000), species: species || '9606' }).catch((er) => toast(esc(er.message), 'error'))],
          ['database', 'Look it up in UniProt', () => this.toUniProt(t)],
          ['cube', 'Its AlphaFold structure in the 3D viewer', () => this.toAlphaFold(t).catch((er) => toast(esc(er.message), 'error', 7000))],
          species === '9606' || !species ? ['genome', 'Its gene in the Genome browser (hg38)', () => this.toGenome(t)] : null,
          ['eyeOff', 'Hide', () => this.hideSelected()],
          ['trash', 'Delete', () => this.deleteSelected()],
          ['copy', 'Copy the name', () => MG.copyText(String(t.data('name')))]
        ]);
      }
      if (t.isEdge && t.isEdge()) {
        return menuAt(x, y, [
          ['boxsel', 'Select its two nodes', () => t.connectedNodes().select()],
          ['trash', 'Delete', () => {
            if (!t.selected()) t.select();
            this.deleteSelected();
          }]
        ]);
      }
    }
    /* to the other tabs */
    async toUniProt(nd) {
      const name = String(nd.data('uniprot') || nd.data('name'));
      const species = String(this.cur && this.cur.data.species || '');
      await MG.app.showWorkbench('apis');
      const q = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/.test(name) ? name : `gene_exact:${name}${species ? ' AND organism_id:' + species : ''} AND reviewed:true`;
      if (MG.app.apis) await MG.app.apis.go('uniprot:' + q);
    }
    async uniprotOf(nd) {
      const known = nd.data('uniprot');
      if (known) return known;
      const name = String(nd.data('name'));
      const species = String((this.cur && this.cur.data.species) || '9606');
      const d = await MG.apiCall({ url: `https://rest.uniprot.org/uniprotkb/search?query=${enc(`gene_exact:${name} AND organism_id:${species} AND reviewed:true`)}&fields=accession&format=json&size=1`, service: 'UniProt', label: `accession of ${name}` });
      const acc = d && d.results && d.results[0] && d.results[0].primaryAccession;
      if (!acc) throw new Error(`UniProt has no reviewed entry for the gene ${name}${species ? ' in this species' : ''}.`);
      nd.data('uniprot', acc);
      return acc;
    }
    async toAlphaFold(nd) {
      const acc = await this.uniprotOf(nd);
      await MG.app.viewerRun('load af ' + acc);
    }
    async toGenome(nd) {
      if (MG.app.igvGoto) await MG.app.igvGoto(String(nd.data('name')), 'hg38');
    }

    /* the Results tab */
    addResult(net, r) {
      r.t = Date.now();
      net.results.unshift(r);
      if (net.results.length > 25) net.results.length = 25;
      if (net === this.cur) {
        if (this.sideTab === 'results') this._renderSide();
        else {
          this.showSide('results');
        }
      }
      this._saveSoon();
      return r;
    }
    _renderResults(B) {
      B.innerHTML = '';
      const net = this.cur;
      if (!net) return B.appendChild(h('p.net-hint', 'Open a network first.'));
      if (!net.results.length) {
        B.append(h('p.net-hint', 'The results of the analyses appear here (Analyse in the toolbar).'), h('div.net-acts', btn('chart', 'Network statistics', null, () => this.analyze()), btn('target', 'Hubs', null, () => this.hubsDialog()), btn('layers', 'Clusters (MCODE)', null, () => this.mcodeDialog()), btn('chart', 'Enrichment', null, () => this.enrichmentDialog())));
        return;
      }
      net.results.forEach((r, i) => {
        const fold = h('button', { type: 'button', title: 'Fold / unfold', html: MG.icon(r.folded ? 'chevR' : 'chevD') });
        const x = h('button', { type: 'button', title: 'Remove this result', html: MG.icon('x') });
        const card = h('section.net-card' + (r.folded ? '.folded' : ''), h('header', fold, h('b', r.title), h('small', new Date(r.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })), x));
        const body = h('div.net-card-b');
        try {
          this._resultBody(net, r, body);
        } catch (e) {
          console.error(e);
          body.appendChild(h('p.net-hint', 'This result cannot be shown: ' + e.message));
        }
        card.appendChild(body);
        fold.addEventListener('click', () => {
          r.folded = !r.folded;
          card.classList.toggle('folded', r.folded);
          fold.innerHTML = MG.icon(r.folded ? 'chevR' : 'chevD');
        });
        x.addEventListener('click', () => {
          net.results.splice(i, 1);
          this._renderResults(B);
          this._saveSoon();
        });
        B.appendChild(card);
      });
    }
    _selectNames(net, names, fit) {
      const want = new Set(names.map((x) => String(x).toLowerCase()));
      const hits = net.cy.nodes().filter((n) => want.has(String(n.data('name')).toLowerCase()) || want.has(String(n.data('stringId') || '').toLowerCase()) || want.has(n.id().toLowerCase()));
      net.cy.$(':selected').unselect();
      hits.select();
      if (fit && hits.length) this._view(net, hits);
      return hits;
    }
    _resultBody(net, r, body) {
      if (r.type === 'stats') return this._statsBody(net, r, body);
      if (r.type === 'hubs') return this._hubsBody(net, r, body);
      if (r.type === 'clusters') return this._clustersBody(net, r, body);
      if (r.type === 'enrichment') return this._enrichBody(net, r, body);
      if (r.type === 'path') {
        body.append(h('p', r.names.join(' → ')), h('p.net-hint', `${plural(r.names.length - 1, 'step')}.`), h('div.net-acts', btn('boxsel', 'Select it again', null, () => this._selectNames(net, r.ids, true))));
        return;
      }
      if (r.type === 'histogram') {
        body.append(chart({ points: r.points, bars: true, xlabel: r.column, ylabel: 'nodes' }), h('p.net-hint', r.note || ''));
        return;
      }
      body.appendChild(h('pre', JSON.stringify(r).slice(0, 2000)));
    }

    /* ================= tables ================= */
    /** the columns of the node or edge table: [{key, kind}] – name first */
    _cols(net, kind) {
      const keys = new Map();
      const eles = kind === 'nodes' ? net.cy.nodes() : net.cy.edges();
      const n = eles.length;
      const step = Math.max(1, Math.floor(n / 3000));
      for (let i = 0; i < n; i += step) {
        const d = eles[i].data();
        for (const k in d) {
          if (k[0] === '_' || k === 'id' || k === 'source' || k === 'target') continue;
          if (!keys.has(k)) keys.set(k, []);
          if (keys.get(k).length < 400) keys.get(k).push(d[k]);
        }
      }
      if (kind === 'nodes' && !keys.has('name')) keys.set('name', []);
      const out = Array.from(keys.entries()).map(([key, vals]) => ({ key, kind: IO.kindOf(vals) }));
      out.sort((a, b) => (b.key === 'name') - (a.key === 'name'));
      return out;
    }
    _renderTablesSoon() {
      clearTimeout(this._tt);
      this._tt = setTimeout(() => this._renderTables(), 120);
    }
    _renderTables() {
      const net = this.cur;
      const T = this.tbar;
      T.innerHTML = '';
      this.twrap.innerHTML = '';
      const tab = (k, label) => {
        const b = h('button.net-ttab' + (this.tableKind === k ? '.on' : ''), { type: 'button' }, label);
        b.addEventListener('click', () => {
          this.tableKind = k;
          this._renderTables();
        });
        return b;
      };
      T.append(tab('nodes', 'Node table'), tab('edges', 'Edge table'), tab('network', 'Network'));
      if (!net) {
        this.twrap.appendChild(h('p.net-tempty', 'The tables of the nodes and edges of a network appear here.'));
        return;
      }
      if (this.tableKind === 'network') {
        const s = net.results.find((r) => r.type === 'stats');
        const o = Object.assign({ name: net.name, source: net.source, nodes: net.cy.nodes().length, edges: net.cy.edges().length, directed: net.directed }, net.data);
        if (s) Object.assign(o, { diameter: s.summary.diameter, 'characteristic path length': s.summary.pathLength, 'clustering coefficient': s.summary.clustering, density: s.summary.density, 'connected components': s.summary.components });
        this.twrap.appendChild(h('table.net-table', h('tbody', Object.entries(o).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => h('tr', h('td', k), h('td' + (isNum(v) ? '.num' : ''), fmt(v)))))));
        return;
      }
      const onlySel = h('input', { type: 'checkbox', checked: !!this.onlySel });
      onlySel.addEventListener('change', () => {
        this.onlySel = onlySel.checked;
        this._renderTables();
      });
      const filt = h('input', { type: 'search', placeholder: 'Filter rows', value: this.tfilter || '' });
      filt.addEventListener('input', MG.debounce(() => {
        this.tfilter = filt.value;
        this._renderRows();
      }, 200));
      T.append(h('span.grow'), h('label', onlySel, 'only selected'), filt, btn('download', 'Save', 'Save this table (.csv) to your files', () => this.saveTable(this.tableKind)));
      this._renderRows();
    }
    _renderRows() {
      const net = this.cur;
      if (!net) return;
      const kind = this.tableKind;
      const W = this.twrap;
      W.innerHTML = '';
      let cols = this._cols(net, kind);
      if (kind === 'edges') cols = [{ key: '(source)', kind: 'text' }, { key: '(target)', kind: 'text' }].concat(cols);
      let eles = (kind === 'nodes' ? net.cy.nodes() : net.cy.edges()).toArray();
      if (this.onlySel) eles = eles.filter((e) => e.selected());
      const get = (e, k) => (k === '(source)' ? e.source().data('name') : k === '(target)' ? e.target().data('name') : e.data(k));
      const q = (this.tfilter || '').trim().toLowerCase();
      if (q) eles = eles.filter((e) => cols.some((c) => String(get(e, c.key) == null ? '' : get(e, c.key)).toLowerCase().includes(q)));
      const sort = (this.sorts = this.sorts || {})[net.id + kind];
      if (sort) {
        const c = cols.find((x) => x.key === sort.key);
        if (c) {
          eles.sort((a, b) => {
            const x = get(a, c.key), y = get(b, c.key);
            if (x == null || x === '') return 1;
            if (y == null || y === '') return -1;
            if (c.kind === 'number') return (Number(x) - Number(y)) * sort.dir;
            return String(x).localeCompare(String(y), undefined, { numeric: true }) * sort.dir;
          });
        }
      }
      if (!eles.length) {
        W.appendChild(h('p.net-tempty', this.onlySel ? 'Nothing is selected.' : q ? 'No row matches.' : kind === 'nodes' ? 'No nodes.' : 'No edges.'));
        return;
      }
      const max = this.rowsShown || 300;
      const table = h('table.net-table');
      const head = h('tr');
      cols.forEach((c) => {
        const th = h('th', { title: 'Click to sort', dataset: { k: c.key } }, c.key);
        if (sort && sort.key === c.key) th.dataset.sort = sort.dir > 0 ? '▲' : '▼';
        if (c.key[0] !== '(') {
          const mb = h('button.th-menu', { type: 'button', title: `What to do with the column ${c.key}`, html: MG.icon('dots') });
          mb.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.columnMenu(mb, kind, c);
          });
          th.appendChild(mb);
        }
        th.addEventListener('click', () => {
          const cur = this.sorts[net.id + kind];
          this.sorts[net.id + kind] = { key: c.key, dir: cur && cur.key === c.key ? -cur.dir : c.kind === 'number' ? -1 : 1 };
          this._renderRows();
        });
        head.appendChild(th);
      });
      table.appendChild(h('thead', head));
      let html = '';
      for (const e of eles.slice(0, max)) {
        html += `<tr data-id="${esc(e.id())}"${e.selected() ? ' class="sel"' : ''}>`;
        for (const c of cols) {
          const v = get(e, c.key);
          const miss = v == null || v === '';
          html += `<td${c.kind === 'number' ? ' class="num"' : miss ? ' class="miss"' : ''} data-k="${esc(c.key)}">${miss ? '–' : esc(fmt(v))}</td>`;
        }
        html += '</tr>';
      }
      const tbody = h('tbody', { html });
      table.appendChild(tbody);
      W.appendChild(table);
      if (eles.length > max) {
        const more = h('button.linkbtn', { type: 'button' }, `Show ${Math.min(500, eles.length - max)} more`);
        more.addEventListener('click', () => {
          this.rowsShown = max + 500;
          this._renderRows();
        });
        W.appendChild(h('p.net-tmore', `The first ${max.toLocaleString('en-GB')} of ${eles.length.toLocaleString('en-GB')} rows. `, more));
      }
      tbody.addEventListener('click', (ev) => {
        const tr = ev.target.closest('tr');
        if (!tr) return;
        const ele = net.cy.getElementById(tr.dataset.id);
        if (!ele || !ele.length) return;
        if (!(ev.ctrlKey || ev.metaKey || ev.shiftKey)) net.cy.$(':selected').unselect();
        ele.select();
        const target = ele.isNode() ? ele : ele.connectedNodes();
        net.cy.animate({ center: { eles: target }, zoom: Math.max(net.cy.zoom(), 0.9) }, { duration: 250 });
      });
      tbody.addEventListener('dblclick', (ev) => {
        const td = ev.target.closest('td');
        if (!td || td.dataset.k[0] === '(') return;
        const tr = td.parentElement;
        const ele = net.cy.getElementById(tr.dataset.id);
        const k = td.dataset.k;
        const col = cols.find((c) => c.key === k);
        const old = ele.data(k);
        const inp = h('input', { type: 'text', value: old == null ? '' : Array.isArray(old) ? old.join('|') : String(old) });
        td.innerHTML = '';
        td.appendChild(inp);
        inp.focus();
        inp.select();
        let done = false;
        const commit = (save) => {
          if (done) return;
          done = true;
          if (save) {
            let v = inp.value.trim();
            v = v === '' ? null : col.kind === 'number' ? (isFinite(Number(v)) ? Number(v) : v) : col.kind === 'boolean' ? /^(true|1|yes)$/i.test(v) : v;
            ele.data(k, v);
            this.applyStyle(net);
            this._changed(net);
          } else this._renderRows();
        };
        inp.addEventListener('keydown', (e2) => {
          if (e2.key === 'Enter') commit(true);
          if (e2.key === 'Escape') commit(false);
        });
        inp.addEventListener('blur', () => commit(true));
      });
    }
    _markRows() {
      const net = this.cur;
      if (!net) return;
      if (this.onlySel) return this._renderRows();
      this.twrap.querySelectorAll('tr[data-id]').forEach((tr) => {
        const e = net.cy.getElementById(tr.dataset.id);
        tr.classList.toggle('sel', !!(e && e.length && e.selected()));
      });
      const first = this.twrap.querySelector('tr.sel');
      if (first && net.cy.$(':selected').length < 5) first.scrollIntoView({ block: 'nearest' });
    }
    columnMenu(anchor, kind, c) {
      const net = this.cur;
      const items = [];
      if (kind === 'nodes') {
        if (c.kind === 'number') {
          items.push(['palette', `Colour the nodes by ${c.key}`, () => this.setStyle(net, 'continuous', { prop: 'fill', attr: c.key, palette: /fold|logfc|lfc|change|diff|score_diff|z/i.test(c.key) ? 'diverging' : 'sequential' })]);
          items.push(['maximize', `Size the nodes by ${c.key}`, () => this.setStyle(net, 'continuous', { prop: 'size', attr: c.key, transform: /^(p|padj|pvalue|fdr|q|adj)/i.test(c.key) ? 'neglog10' : 'none' })]);
          items.push(['chart', 'Histogram', () => this.histogram(net, c.key)]);
        } else {
          items.push(['palette', `Colour the nodes by ${c.key} (a colour for each value)`, () => this.setStyle(net, 'discrete', { prop: 'fill', attr: c.key })]);
          items.push(['text', `Label the nodes with ${c.key}`, () => {
            net.style.node.label = { mode: 'attr', attr: c.key };
            this.applyStyle(net);
            this._saveSoon();
          }]);
          items.push(['layers', `Lay out by groups of ${c.key}`, () => this.groupLayout(net, c.key)]);
        }
      } else if (c.kind === 'number') {
        items.push(['palette', `Edge colour by ${c.key}`, () => {
          net.style.edge.color = { mode: 'continuous', attr: c.key, palette: 'greys' };
          this.applyStyle(net);
        }]);
        items.push(['minus', `Edge width by ${c.key}`, () => {
          net.style.edge.width = { mode: 'continuous', attr: c.key, out: [0.6, 6] };
          this.applyStyle(net);
        }]);
      } else {
        items.push(['palette', `Edge colour by ${c.key} (a colour for each value)`, () => {
          net.style.edge.color = { mode: 'discrete', attr: c.key, map: {} };
          this.applyStyle(net);
        }]);
      }
      items.push(['filter', `Select by ${c.key}…`, () => {
        this.condKind = kind;
        this.conds = [{ col: c.key, op: '', val: '' }];
        this.showSide('select');
      }]);
      if (c.key !== 'name') {
        items.push(['rename', 'Rename the column…', async () => {
          const v = await MG.promptText('Rename the column', `A new name for ${c.key}:`, c.key, 'Rename');
          if (!v || v === c.key) return;
          const nn = IO.attrName(v);
          (kind === 'nodes' ? net.cy.nodes() : net.cy.edges()).forEach((e) => {
            const x = e.data(c.key);
            e.removeData(c.key);
            if (x != null) e.data(nn, x);
          });
          this._renameInStyle(net, c.key, nn);
          this.applyStyle(net);
          this._changed(net);
        }]);
        items.push(['trash', 'Delete the column', () => {
          this.checkpoint(net, 'Delete a column');
          (kind === 'nodes' ? net.cy.nodes() : net.cy.edges()).forEach((e) => e.removeData(c.key));
          this._changed(net);
        }]);
      }
      MG.popmenu(anchor, items);
    }
    _renameInStyle(net, a, b) {
      for (const part of ['node', 'edge']) for (const m of Object.values(net.style[part] || {})) if (m && m.attr === a) m.attr = b;
      const ch = net.style.node.chart;
      if (ch && ch.attrs) ch.attrs = ch.attrs.map((x) => (x === a ? b : x));
    }
    histogram(net, col) {
      const vals = net.cy.nodes().map((n) => Number(n.data(col))).filter((v) => isFinite(v));
      if (!vals.length) return;
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const bins = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
      const w = (hi - lo) / bins || 1;
      const counts = new Array(bins).fill(0);
      vals.forEach((v) => counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++);
      this.addResult(net, { type: 'histogram', title: `Histogram: ${col}`, column: col, points: counts.map((c, i) => [+(lo + (i + 0.5) * w).toPrecision(4), c]), note: `${plural(vals.length, 'value')}, from ${fmt(lo)} to ${fmt(hi)}; ${bins} bins.` });
    }
    async saveTable(kind) {
      const net = this.cur;
      let cols = this._cols(net, kind);
      const eles = kind === 'nodes' ? net.cy.nodes() : net.cy.edges();
      let header, rows;
      if (kind === 'nodes') {
        header = cols.map((c) => c.key);
        rows = eles.map((e) => cols.map((c) => e.data(c.key)));
      } else {
        header = ['source', 'target'].concat(cols.map((c) => c.key));
        rows = eles.map((e) => [e.source().data('name'), e.target().data('name')].concat(cols.map((c) => e.data(c.key))));
      }
      return this._saveText(`${this._fileStem(net)}_${kind}.csv`, IO.writeTable(header, rows, ','));
    }

    /* ================= analyses ================= */
    analyseMenu() {
      const n = this.cur;
      if (!n) return [['folder', 'Open a network first', () => this.openMenu()[0][2]()]];
      const sel = n.cy.$('node:selected').length;
      return [
        ['chart', 'Network statistics (degree, betweenness, closeness …)', () => this.analyze()],
        ['target', 'Hubs: rank the nodes (MCC, degree, betweenness …)…', () => this.hubsDialog()],
        ['layers', 'Clusters: MCODE (dense regions)…', () => this.mcodeDialog()],
        ['layers', 'Clusters: MCL (Markov clustering)…', () => this.mclDialog()],
        ['layers', 'Communities: Louvain…', () => this.louvainDialog()],
        ['link', 'Connected components', () => this.componentsAnalysis()],
        ['target', 'k-cores (core number)', () => this.coresAnalysis()],
        sel === 2 ? ['arrow', 'Shortest path between the two selected nodes', () => this.shortestPath()] : null,
        ['book', 'Functional enrichment (STRING, g:Profiler)…', () => this.enrichmentDialog()]
      ];
    }
    /** the network as flat arrays for the worker */
    _graph(net, weightAttr) {
      const nodes = net.cy.nodes().toArray();
      const idx = new Map(nodes.map((n, i) => [n.id(), i]));
      const edges = net.cy.edges().toArray();
      const src = new Int32Array(edges.length), dst = new Int32Array(edges.length);
      const w = weightAttr ? new Float64Array(edges.length) : null;
      edges.forEach((e, i) => {
        src[i] = idx.get(e.source().id());
        dst[i] = idx.get(e.target().id());
        if (w) {
          const v = Number(e.data(weightAttr));
          w[i] = isFinite(v) && v > 0 ? v : 0;
        }
      });
      return { n: nodes.length, src, dst, w, nodes, edges, idx };
    }
    async _run(label, fn, net, args, weightAttr) {
      const g = this._graph(net, weightAttr);
      return this._busy(label, (progress) => this.jobs.run(fn, g, args, progress), true).then((res) => ({ res, g }));
    }
    /** run work with the busy sign over the network (with Stop when cancellable) */
    async _busy(label, work, cancellable) {
      const B = this.busyEl;
      const prog = h('progress', { max: 1, hidden: true });
      const stop = cancellable ? h('button.btn.small', { type: 'button' }, 'Stop') : null;
      if (stop) stop.addEventListener('click', () => this.jobs.cancel());
      B.innerHTML = '';
      B.appendChild(h('div', h('span.spinner'), h('span', label), prog, stop));
      this._busyN = (this._busyN || 0) + 1;
      B.hidden = false;
      try {
        return await work((f) => {
          prog.hidden = false;
          prog.value = f;
        });
      } finally {
        this._busyN--;
        if (!this._busyN) B.hidden = true;
      }
    }
    _setColumn(net, name, vals, nodes) {
      net.cy.batch(() => nodes.forEach((n, i) => n.data(name, vals[i] == null || (typeof vals[i] === 'number' && isNaN(vals[i])) ? null : vals[i])));
    }
    async analyze() {
      const net = this.cur;
      if (!net) return;
      try {
        const { res, g } = await this._run(`Network statistics of ${plural(net.cy.nodes().length, 'node')}…`, 'networkAnalyzer', net, {});
        this.checkpoint(net, 'Network statistics');
        net.cy.batch(() => {
          for (const [k, vals] of Object.entries(res.nodes)) {
            if (k === 'IsSingleNode' || k === 'PartnerOfMultiEdgedNodePairs' || k === 'SelfLoops') continue;
            g.nodes.forEach((n, i) => n.data(k, +(+vals[i]).toPrecision(8)));
          }
          g.edges.forEach((e, i) => e.data('EdgeBetweenness', +(+res.edgeBetweenness[i]).toPrecision(8)));
        });
        const r = this.addResult(net, { type: 'stats', title: 'Network statistics', summary: res.summary, dist: res.dist, fit: res.fit });
        void r;
        this.applyStyle(net);
        this._changed(net);
        bus.emit('net:analyze', { what: 'stats' });
        toast('Network statistics: new columns in the node table (Degree, BetweennessCentrality, ClosenessCentrality …) and EdgeBetweenness in the edge table.', 'ok', 5000);
      } catch (e) {
        if (!e.cancelled) toast(esc(e.message), 'error', 8000);
      }
    }
    _statsBody(net, r, body) {
      const s = r.summary;
      const rows = [
        ['Nodes', s.nodes, 'All the nodes, with or without edges'], ['Edges', s.edges, 'All the edges (several between the same two nodes count each)'],
        ['Average number of neighbours', s.neighbours, 'The mean number of other nodes a node is joined to'],
        ['Network diameter', s.diameter, 'The longest of the shortest paths between two nodes (in edges)'],
        ['Network radius', s.radius, 'The smallest eccentricity (the largest distance from a node to the others), 0s left out'],
        ['Characteristic path length', s.pathLength, 'The mean length of the shortest paths, over every pair of nodes joined by a path'],
        ['Clustering coefficient', s.clustering, 'How often the neighbours of a node are neighbours of each other (the mean over all nodes)'],
        ['Network density', s.density, 'The edges there are, of all the edges there could be'],
        ['Network heterogeneity', s.heterogeneity, 'How much the numbers of neighbours vary: standard deviation / mean. High: there are hubs'],
        ['Network centralization', s.centralization, 'Near 1: star-like, one node holds the network together; near 0: all alike'],
        ['Connected components', s.components, 'Parts of the network that no path joins'], ['Largest component', s.largest, 'Its number of nodes'],
        ['Isolated nodes', s.isolated, 'Nodes without edges'], ['Self-loops', s.selfLoops], ['Multi-edge node pairs', s.multiPairs, 'Pairs of nodes joined by more than one edge']
      ];
      body.appendChild(h('table.net-kv', rows.map(([k, v, tip]) => h('tr', h('td', tip ? { title: tip } : {}, k), h('td', fmt(typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(4) : v))))));
      const f = r.fit;
      body.append(
        h('h4', 'Degree distribution'),
        chart({ points: r.dist.degree.filter(([k]) => k > 0), logx: true, logy: true, xlabel: 'degree (number of neighbours)', ylabel: 'nodes', fit: f, fitLabel: f ? `Power law fitted: y = ${fmt(+f.a.toPrecision(3))}·x^${fmt(+f.b.toPrecision(3))} (correlation of the logarithms ${fmt(+f.r.toPrecision(3))}, R² ${fmt(+f.r2.toPrecision(3))}). A straight line on these axes: a few hubs, many nodes with few edges.` : '' }),
        h('h4', 'Shortest path lengths'),
        chart({ points: r.dist.paths, bars: true, xlabel: 'path length (edges)', ylabel: 'pairs of nodes' }),
        h('h4', 'Clustering coefficient by degree'),
        chart({ points: r.dist.clustering, xlabel: 'degree', ylabel: 'mean clustering coefficient', logx: true }),
        h('div.net-acts', btn('maximize', 'Size by degree', null, () => this.setStyle(net, 'degree')), btn('palette', 'Colour by betweenness', null, () => this.setStyle(net, 'continuous', { prop: 'fill', attr: 'BetweennessCentrality' })))
      );
    }
    hubsDialog() {
      const net = this.cur;
      const { m, body } = dialog('Hubs: rank the nodes');
      const checks = h('div.checks');
      const desc = { MCC: 'Maximal clique centrality: in many cliques (the best at finding essential proteins, says its paper)', DMNC: 'Density of the maximum neighbourhood component', MNC: 'Maximum neighbourhood component: the largest group of neighbours joined to each other', Degree: 'Number of neighbours', EPC: 'Edge percolated component: stays connected when edges are removed at random (1,000 trials)', BottleNeck: 'On many shortest-path trees, above many nodes', EcCentricity: 'Close to the farthest node', Closeness: 'Close to all nodes (the sum of 1/distance)', Radiality: 'Close to all nodes, compared with the diameter', Betweenness: 'On many shortest paths between other nodes', Stress: 'On many shortest paths (each path counted)', ClusteringCoefficient: 'Its neighbours are neighbours of each other' };
      const want = new Set(store.get('netHubs', ['MCC', 'Degree', 'Betweenness', 'Closeness']));
      ALG.HUBS.forEach((k) => checks.appendChild(h('label', { title: desc[k] }, h('input', { type: 'checkbox', value: k, checked: want.has(k) }), k)));
      const top = h('input', { type: 'number', value: 10, min: 1, max: 100 });
      body.append(h('p.note', 'The rankings of cytoHubba (Chin et al. 2014): each scores every node; the top ones are the hubs. Hover over a name for what it measures.'), h('div.fld.wide', h('span', 'Methods'), checks), field('Top', top, 'nodes of each method to show (and to colour).'));
      body.appendChild(h('div.acts', h('span.grow'), btn('target', 'Rank', null, async () => {
        const methods = Array.from(checks.querySelectorAll('input:checked')).map((x) => x.value);
        if (!methods.length) return;
        store.set('netHubs', methods);
        m.close();
        await this.hubs(net, methods, Number(top.value) || 10);
      }, '.primary')));
    }
    async hubs(net, methods, topN = 10) {
      try {
        const { res, g } = await this._run(`Ranking ${plural(g0(net), 'node')}…`, 'hubs', net, { methods });
        this.checkpoint(net, 'Hubs');
        const tables = {};
        for (const m of methods) {
          const vals = Array.from(res[m]);
          this._setColumn(net, 'hub_' + m, vals.map((v) => +(+v).toPrecision(8)), g.nodes);
          const order = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a] || a - b);
          // ranks as cytoHubba gives them: equal scores, equal rank
          const rows = [];
          let rank = 0, prev = null;
          order.forEach((i, k) => {
            if (vals[i] !== prev) {
              rank = k + 1;
              prev = vals[i];
            }
            if (k < topN || (rows.length && rank === rows[rows.length - 1].rank && rows.length < topN * 3)) rows.push({ rank, name: g.nodes[i].data('name'), id: g.nodes[i].id(), score: vals[i] });
          });
          tables[m] = rows;
        }
        this.addResult(net, { type: 'hubs', title: `Hubs: ${methods.join(', ')}`, methods, tables, topN });
        this._changed(net);
        bus.emit('net:analyze', { what: 'hubs', methods });
      } catch (e) {
        if (!e.cancelled) toast(esc(e.message), 'error', 8000);
      }
    }
    _hubsBody(net, r, body) {
      const pick = select(r.methods, r.shown || r.methods[0]);
      const box = h('div');
      const draw = () => {
        r.shown = pick.value;
        box.innerHTML = '';
        const rows = r.tables[pick.value] || [];
        const t = h('table.net-rt', h('tr', h('th', 'Rank'), h('th', 'Node'), h('th', 'Score')));
        rows.forEach((x) => {
          const tr = h('tr.click', h('td.num', String(x.rank)), h('td', x.name), h('td.num', fmt(+(+x.score).toPrecision(5))));
          tr.addEventListener('click', () => this._selectNames(net, [x.id], true));
          t.appendChild(tr);
        });
        box.appendChild(t);
        box.appendChild(h('div.net-acts', btn('boxsel', `Select the top ${r.topN}`, null, () => this._selectNames(net, rows.filter((x) => x.rank <= r.topN).map((x) => x.id), true)), btn('layers', 'Network of the top and their neighbours', 'As cytoHubba’s “expanded subnetwork”: the top nodes and their first neighbours', () => {
          const top = this._selectNames(net, rows.filter((x) => x.rank <= r.topN).map((x) => x.id));
          top.union(top.neighborhood('node')).select();
          this.subnetwork();
        }), btn('palette', 'Colour by rank', 'The top nodes from dark red (first) to light, the others grey', () => {
          const col = 'hub_rank_' + pick.value;
          const ranks = new Map(rows.filter((x) => x.rank <= r.topN).map((x) => [x.id, x.rank]));
          net.cy.batch(() => net.cy.nodes().forEach((n) => n.data(col, ranks.has(n.id()) ? ranks.get(n.id()) : null)));
          net.style.node.fill = { mode: 'continuous', attr: col, palette: 'reds', auto: false, min: r.topN, max: 1 };
          this.applyStyle(net);
          this._changed(net);
        })));
      };
      pick.addEventListener('change', draw);
      body.append(h('div.net-row', h('span', 'Method'), pick, h('span.net-hint', `the top ${r.topN}; every score is in the node table (hub_…)`)), box);
      draw();
    }
    mcodeDialog() {
      const net = this.cur;
      const D = ALG.MCODE_DEFAULTS;
      const { m, body } = dialog('Clusters: MCODE');
      const f = {
        degreeCutoff: h('input', { type: 'number', value: D.degreeCutoff, min: 1, step: 1 }),
        nodeScoreCutoff: h('input', { type: 'number', value: D.nodeScoreCutoff, min: 0, max: 1, step: 0.05 }),
        kCore: h('input', { type: 'number', value: D.kCore, min: 1, step: 1 }),
        maxDepth: h('input', { type: 'number', value: D.maxDepth, min: 1, step: 1 }),
        haircut: h('input', { type: 'checkbox', checked: D.haircut }),
        fluff: h('input', { type: 'checkbox', checked: D.fluff }),
        fluffNodeDensityCutoff: h('input', { type: 'number', value: D.fluffNodeDensityCutoff, min: 0, max: 1, step: 0.05 })
      };
      body.append(
        h('p.note', 'MCODE (Bader & Hogue 2003) finds densely connected regions – in protein networks often complexes. It scores each node by how dense its neighbourhood is, then grows clusters from the best ones. These are its usual settings.'),
        field('Degree cutoff', f.degreeCutoff, 'Nodes with fewer neighbours are not scored.'),
        field('Node score cutoff', f.nodeScoreCutoff, 'A cluster takes nodes whose score is within this fraction of its seed’s (smaller: tighter clusters).'),
        field('k-core', f.kCore, 'A cluster must contain a k-core (each node joined to k others in it).'),
        field('Maximum depth', f.maxDepth, 'How far from its seed a cluster may grow.'),
        h('label.fld', h('span', 'Haircut'), h('span', f.haircut, ' remove the nodes joined to the cluster by a single edge')),
        h('label.fld', h('span', 'Fluff'), h('span', f.fluff, ' add the neighbours whose neighbourhoods are dense (above:'), f.fluffNodeDensityCutoff, h('span', ')'))
      );
      body.appendChild(h('div.acts', h('span.grow'), btn('layers', 'Find clusters', null, () => {
        m.close();
        const p = {};
        for (const [k, el] of Object.entries(f)) p[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
        this.clusters(net, 'mcode', p);
      }, '.primary')));
    }
    mclDialog() {
      const net = this.cur;
      const { m, body } = dialog('Clusters: MCL');
      const infl = h('input', { type: 'number', value: 2, min: 1.1, max: 10, step: 0.1 });
      const wc = this._cols(net, 'edges').filter((c) => c.kind === 'number');
      const w = select([['', 'none: every edge the same']].concat(wc.map((c) => [c.key, c.key])), (this._weightCols(net)[0] || {}).key || '');
      body.append(h('p.note', 'MCL (van Dongen 2000; Enright et al. 2002) simulates random walks: they stay within clusters. Each node ends up in exactly one cluster.'), field('Inflation', infl, 'Larger: more, smaller clusters (1.4 to 6; 2 is usual).'), field('Edge weights', w, 'Strong edges hold clusters together (e.g. STRING’s score).'));
      body.appendChild(h('div.acts', h('span.grow'), btn('layers', 'Find clusters', null, () => {
        m.close();
        this.clusters(net, 'mcl', { inflation: Number(infl.value) || 2 }, w.value || null);
      }, '.primary')));
    }
    louvainDialog() {
      const net = this.cur;
      const { m, body } = dialog('Communities: Louvain');
      const res = h('input', { type: 'number', value: 1, min: 0.05, max: 10, step: 0.1 });
      const wc = this._cols(net, 'edges').filter((c) => c.kind === 'number');
      const w = select([['', 'none: every edge the same']].concat(wc.map((c) => [c.key, c.key])), '');
      body.append(h('p.note', 'Louvain (Blondel et al. 2008) divides the network into communities with many edges inside and few between them (high modularity), as networkx does it.'), field('Resolution', res, 'Larger: more, smaller communities (1 is usual).'), field('Edge weights', w));
      body.appendChild(h('div.acts', h('span.grow'), btn('layers', 'Find communities', null, () => {
        m.close();
        this.clusters(net, 'louvain', { resolution: Number(res.value) || 1 }, w.value || null);
      }, '.primary')));
    }
    async componentsAnalysis() {
      return this.clusters(this.cur, 'components', {});
    }
    async coresAnalysis() {
      const net = this.cur;
      try {
        const { res, g } = await this._run('Core numbers…', 'coreNumber', net, {});
        this.checkpoint(net, 'k-cores');
        this._setColumn(net, 'CoreNumber', Array.from(res.core), g.nodes);
        const counts = new Map();
        res.core.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
        this.addResult(net, { type: 'histogram', title: 'k-cores', column: 'CoreNumber', points: Array.from(counts.entries()).sort((a, b) => a[0] - b[0]), note: `The core number of a node is the largest k of a k-core that holds it (a k-core: every node joined to at least k others in it). The highest: ${Math.max(...res.core)}. Column CoreNumber.` });
        this._changed(net);
      } catch (e) {
        if (!e.cancelled) toast(esc(e.message), 'error', 8000);
      }
    }
    /** MCODE, MCL, Louvain, components → a column of cluster numbers (1 = the best or largest), a result */
    async clusters(net, method, params, weightAttr) {
      if (!net) return;
      const names = { mcode: ['MCODE', 'MCODE_Cluster'], mcl: ['MCL', 'MCL_Cluster'], louvain: ['Louvain', 'Louvain_Community'], components: ['Connected components', 'Component'] };
      const [title, col] = names[method];
      try {
        const fn = method === 'components' ? 'components' : method;
        const { res, g } = await this._run(`${title}…`, fn, net, { params, weighted: !!weightAttr }, weightAttr);
        this.checkpoint(net, title);
        let clusters, extra = {};
        if (method === 'mcode') {
          clusters = res.clusters.map((c) => ({ nodes: c.nodes, score: c.score, seed: c.seed, edges: c.edges }));
          this._setColumn(net, 'MCODE_Score', Array.from(res.scores, (v) => +(+v).toPrecision(6)), g.nodes);
          extra.params = res.params;
        } else if (method === 'mcl') {
          clusters = res.clusters.map((c) => ({ nodes: c }));
          extra = { iterations: res.iterations, converged: res.converged, inflation: params.inflation, weight: weightAttr };
        } else if (method === 'louvain') {
          clusters = res.communities.map((c) => ({ nodes: c }));
          extra = { modularity: res.modularity, resolution: params.resolution, weight: weightAttr };
        } else {
          const groups = new Map();
          Array.from(res.comp).forEach((c, i) => {
            if (!groups.has(c)) groups.set(c, []);
            groups.get(c).push(i);
          });
          clusters = Array.from(groups.values()).sort((a, b) => b.length - a.length).map((c) => ({ nodes: c }));
        }
        // edges inside each cluster
        const at = new Int32Array(g.n).fill(0);
        clusters.forEach((c, k) => c.nodes.forEach((i) => (at[i] = k + 1)));
        const inside = new Array(clusters.length).fill(0);
        for (let i = 0; i < g.src.length; i++) if (at[g.src[i]] && at[g.src[i]] === at[g.dst[i]]) inside[at[g.src[i]] - 1]++;
        clusters.forEach((c, k) => (c.edges = inside[k]));
        // the column: the cluster's number (MCODE: a node in no cluster has none)
        net.cy.batch(() => {
          g.nodes.forEach((n) => n.data(col, null));
          clusters.forEach((c, k) => c.nodes.forEach((i) => g.nodes[i].data(col, k + 1)));
        });
        const list = clusters.map((c, k) => ({ n: k + 1, ids: c.nodes.map((i) => g.nodes[i].id()), names: c.nodes.map((i) => g.nodes[i].data('name')), size: c.nodes.length, edges: c.edges, score: c.score, seed: c.seed != null ? g.nodes[c.seed].data('name') : null }));
        const nBig = clusters.filter((c) => c.nodes.length > 1).length;
        this.addResult(net, Object.assign({ type: 'clusters', method, title: `${title}: ${method === 'louvain' ? plural(nBig, 'community', 'communities') : method === 'components' ? plural(clusters.length, 'component') : plural(nBig, 'cluster')}`, column: col, clusters: list }, extra));
        if (clusters.length) this.setStyle(net, 'clusters', { attr: col });
        this._changed(net);
        bus.emit('net:analyze', { what: method, clusters: clusters.length });
      } catch (e) {
        if (!e.cancelled) toast(esc(e.message), 'error', 8000);
      }
    }
    _clustersBody(net, r, body) {
      const big = r.clusters.filter((c) => c.size > 1);
      const singles = r.clusters.length - big.length;
      const notes = [];
      if (r.method === 'louvain') notes.push(`Modularity ${fmt(+r.modularity.toPrecision(4))} (above 0.3: a clear division into communities).`);
      if (r.method === 'mcl') notes.push(`Inflation ${r.inflation}${r.weight ? `, edges weighted by ${r.weight}` : ''}; ${r.converged ? `converged after ${r.iterations} iterations` : `stopped after ${r.iterations} iterations without converging`}.`);
      if (r.method === 'mcode') notes.push('Score: density × number of nodes. The node scores are in the column MCODE_Score.');
      if (singles) notes.push(`${plural(singles, 'node')} ${singles === 1 ? 'is' : 'are'} a cluster of its own (not listed).`);
      body.append(h('p.net-hint', `Column ${r.column}: the number of each node’s cluster (1 = ${r.method === 'mcode' ? 'the best' : 'the largest'}). ${notes.join(' ')}`));
      const list = h('div.net-cls');
      big.slice(0, 60).forEach((c) => {
        const b1 = h('button.linkbtn', { type: 'button', title: 'Select this cluster' }, 'select');
        b1.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this._selectNames(net, c.ids, true);
        });
        const b2 = h('button.linkbtn', { type: 'button', title: 'Functional enrichment of this cluster' }, 'enrichment');
        b2.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.enrichmentDialog({ nodes: 'ids', ids: c.ids, label: `${r.column} ${c.n}` });
        });
        const b3 = h('button.linkbtn', { type: 'button', title: 'A new network of this cluster' }, 'new network');
        b3.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this._selectNames(net, c.ids);
          this.subnetwork();
        });
        const head = h('div.net-cl-h', h('b', `${r.method === 'louvain' ? 'Community' : r.method === 'components' ? 'Component' : 'Cluster'} ${c.n}`), h('span', `${plural(c.size, 'node')}, ${plural(c.edges, 'edge')}${r.method === 'mcode' ? ` · score ${fmt(+(+c.score).toPrecision(4))}` : ''}`), h('span.grow'), b1, b2, b3);
        const item = h('div.net-cl', { title: 'Click to select' }, head, h('div.genes', c.names.slice(0, 40).join(', ') + (c.names.length > 40 ? ` … (+${c.names.length - 40})` : '')));
        item.addEventListener('click', () => this._selectNames(net, c.ids, true));
        list.appendChild(item);
      });
      if (big.length > 60) list.appendChild(h('p.net-hint', `… and ${big.length - 60} more (all of them are in the column ${r.column}).`));
      body.appendChild(list);
      body.appendChild(h('div.net-acts', btn('palette', 'Colour by cluster', null, () => this.setStyle(net, 'clusters', { attr: r.column })), btn('layers', 'Lay out by cluster', null, () => this.groupLayout(net, r.column)), big[0] ? btn('layers', 'New network of cluster 1', null, () => {
        this._selectNames(net, big[0].ids);
        this.subnetwork();
      }) : null));
    }

    /* ---------------- functional enrichment ---------------- */
    enrichmentDialog(pre = {}) {
      const net = this.cur;
      if (!net) return;
      const { m, body } = dialog('Functional enrichment', { wide: true });
      const selN = net.cy.$('node:selected').length;
      const which = select([['all', `all ${plural(net.cy.nodes().length, 'node')} of the network`]].concat(selN ? [['selected', `the ${plural(selN, 'selected node')}`]] : []).concat(pre.ids ? [['ids', `${pre.label || 'the cluster'} (${plural(pre.ids.length, 'node')})`]] : []), pre.nodes === 'ids' ? 'ids' : pre.nodes === 'selected' && selN ? 'selected' : 'all');
      const svc = select([['string', 'STRING (GO, KEGG, Reactome, WikiPathways …)'], ['gprofiler', 'g:Profiler (GO, KEGG, Reactome, WikiPathways …)']], store.get('netEnrich', 'string'));
      const sp = select(SPECIES, net.data.species || '9606');
      const bg = h('input', { type: 'checkbox' });
      body.append(
        h('p.note', 'Which functions, processes and pathways are more common among these genes than among all genes of the species (an over-representation test, with false discovery rates). Their names go to the service; nothing else does.'),
        field('Genes', which),
        field('Service', svc),
        field('Species', sp),
        h('label.fld', h('span', 'Background'), h('span', bg, ' compare with the genes of this network, not the whole genome (STRING)'))
      );
      body.appendChild(h('div.acts', h('span.grow'), btn('chart', 'Find enriched terms', null, async () => {
        m.close();
        store.set('netEnrich', svc.value);
        let nodes = which.value === 'selected' ? net.cy.$('node:selected') : which.value === 'ids' ? net.cy.collection(pre.ids.map((id) => net.cy.getElementById(id))) : net.cy.nodes();
        try {
          await this.enrichment(net, { nodes, service: svc.value, species: sp.value, background: bg.checked, label: which.value === 'ids' ? pre.label : which.value === 'selected' ? 'the selected nodes' : 'the network' });
        } catch (e) {
          console.error(e);
          toast(esc(e.message), 'error', 9000);
        }
      }, '.primary')));
    }
    async enrichment(net, o) {
      const ids = o.nodes.map((n) => (o.service === 'string' ? n.data('stringId') || n.data('name') : n.data('name'))).filter(Boolean);
      if (ids.length < 2) throw new Error('Choose at least two genes.');
      if (ids.length > 2000) throw new Error('At most 2,000 genes at once.');
      return this._busy(`Enrichment of ${plural(ids.length, 'gene')}…`, async () => {
        let terms;
        if (o.service === 'string') {
          const form = { identifiers: ids.join('\r'), species: o.species, caller_identity: CALLER };
          if (o.background) form.background_string_identifiers = net.cy.nodes().map((n) => n.data('stringId') || n.data('name')).filter(Boolean).join('\r');
          const d = (await MG.apiCall({ method: 'POST', url: 'https://string-db.org/api/json/enrichment', form, service: 'STRING', label: `enrichment of ${plural(ids.length, 'gene')}`, timeout: 120000 })) || [];
          const CAT_NAMES = { Process: 'GO Process', Function: 'GO Function', Component: 'GO Component', KEGG: 'KEGG', RCTM: 'Reactome', WikiPathways: 'WikiPathways', Pfam: 'Pfam', InterPro: 'InterPro', SMART: 'SMART', Keyword: 'UniProt keywords', PMID: 'Publications', TISSUES: 'Tissues', COMPARTMENTS: 'Compartments', DISEASES: 'Diseases', HPO: 'Phenotypes (HPO)', NetworkNeighborAL: 'STRING clusters' };
          terms = d.map((x) => ({ cat: CAT_NAMES[x.category] || x.category, term: x.term, name: x.description, k: x.number_of_genes, K: x.number_of_genes_in_background, fdr: x.fdr, p: x.p_value, genes: x.preferredNames || x.inputGenes || [] }));
        } else {
          const org = GPROFILER_ORG[o.species];
          if (!org) throw new Error('g:Profiler: choose one of the species it has (human, mouse, rat, zebrafish, fly, worm, yeast, Arabidopsis, cow, chicken, pig).');
          const d = await MG.apiCall({ method: 'POST', url: 'https://biit.cs.ut.ee/gprofiler/api/gost/profile/', json: { organism: org, query: ids, sources: ['GO:BP', 'GO:MF', 'GO:CC', 'KEGG', 'REAC', 'WP'], user_threshold: 0.05, significance_threshold_method: 'g_SCS', no_evidences: false, all_results: false }, service: 'g:Profiler', label: `enrichment of ${plural(ids.length, 'gene')}`, timeout: 120000 });
          const res = (d && d.result) || [];
          // each term's "intersections" follow the Ensembl genes the query was mapped to (meta…query_1.ensgs), not the
          // query itself (names that were not found are left out, a name may map to several genes): back to the names
          const q = (d && d.meta && d.meta.genes_metadata && d.meta.genes_metadata.query && d.meta.genes_metadata.query.query_1) || {};
          const back = new Map();
          for (const [name, ensgs] of Object.entries(q.mapping || {})) for (const e of [].concat(ensgs || [])) if (!back.has(e)) back.set(e, name);
          const names = (q.ensgs || []).map((e) => back.get(e) || e);
          terms = res.map((x) => ({ cat: { 'GO:BP': 'GO Process', 'GO:MF': 'GO Function', 'GO:CC': 'GO Component', KEGG: 'KEGG', REAC: 'Reactome', WP: 'WikiPathways' }[x.source] || x.source, term: x.native, name: x.name, k: x.intersection_size, K: x.term_size, fdr: x.p_value, p: x.p_value, genes: Array.from(new Set((x.intersections || []).map((ev, i) => (ev && ev.length ? names[i] : null)).filter(Boolean))) }));
          const failed = (d && d.meta && d.meta.genes_metadata && d.meta.genes_metadata.failed) || [];
          if (failed.length) toast(`g:Profiler did not know ${plural(failed.length, 'name')}: ${esc(failed.slice(0, 12).join(', '))}${failed.length > 12 ? ' …' : ''}`, 'warn', 6000);
        }
        terms.sort((a, b) => a.fdr - b.fdr);
        this.addResult(net, { type: 'enrichment', title: `Enrichment of ${o.label} (${o.service === 'string' ? 'STRING' : 'g:Profiler'})`, service: o.service, n: ids.length, terms: terms.slice(0, 1500), background: !!o.background });
        bus.emit('net:enrichment', { service: o.service, terms: terms.length });
        if (!terms.length) toast('No term is significantly enriched.', 'warn', 5000);
      });
    }
    _enrichBody(net, r, body) {
      const cats = Array.from(new Set(r.terms.map((t) => t.cat)));
      const pref = ['GO Process', 'KEGG', 'Reactome', 'WikiPathways', 'GO Function', 'GO Component'];
      cats.sort((a, b) => (pref.indexOf(a) < 0 ? 99 : pref.indexOf(a)) - (pref.indexOf(b) < 0 ? 99 : pref.indexOf(b)));
      r.cat = r.cat && cats.includes(r.cat) ? r.cat : cats[0];
      const chips = h('div.net-cats');
      const box = h('div');
      const draw = () => {
        chips.innerHTML = '';
        cats.forEach((c) => {
          const b = h('button.chip' + (c === r.cat ? '.on' : ''), { type: 'button' }, `${c} (${r.terms.filter((t) => t.cat === c).length})`);
          b.addEventListener('click', () => {
            r.cat = c;
            draw();
          });
          chips.appendChild(b);
        });
        box.innerHTML = '';
        const rows = r.terms.filter((t) => t.cat === r.cat).slice(0, 80);
        const t = h('table.net-rt', h('tr', h('th', 'Term'), h('th', 'Genes'), h('th', { title: r.service === 'gprofiler' ? 'p-value adjusted for the many terms tested (g:SCS, g:Profiler’s own method)' : 'False discovery rate (Benjamini–Hochberg)' }, r.service === 'gprofiler' ? 'adj. p' : 'FDR')));
        rows.forEach((x) => {
          const tr = h('tr.click', { title: `${x.term}: ${x.genes.join(', ')}` }, h('td', h('div', x.name), h('div.genes', x.term)), h('td.num', `${x.k} / ${x.K}`), h('td.num', fmt(x.fdr)));
          tr.addEventListener('click', () => {
            const hits = this._selectNames(net, x.genes, true);
            toast(`${esc(x.name)}: ${plural(hits.length, 'node')} selected.`, null, 2500);
          });
          t.appendChild(tr);
        });
        box.appendChild(t);
      };
      const gp = r.service === 'gprofiler';
      body.append(h('p.net-hint', `${plural(r.n, 'gene')}; ${plural(r.terms.length, 'term')} with ${gp ? 'adjusted p (g:SCS)' : 'FDR'} < 0.05${r.background ? ' (background: the network)' : ''}. Click a term to select its genes. Genes: in the list / annotated with the term.`), chips, box, h('div.net-acts', btn('download', 'Save the table', null, () => this._saveText(`${this._fileStem(net)}_enrichment.csv`, IO.writeTable(['category', 'term', 'description', 'genes_in_list', 'genes_with_term', gp ? 'adjusted_p_gSCS' : 'fdr', 'genes'], r.terms.map((x) => [x.cat, x.term, x.name, x.k, x.K, x.fdr, x.genes.join(';')]), ',')))));
      draw();
    }

    /* ================= saving ================= */
    saveMenu() {
      const n = this.cur;
      if (!n) return [];
      return [
        ['image', 'Picture (PNG)…', () => this.pictureDialog('png')],
        ['image', 'Picture (SVG, for papers and posters)…', () => this.pictureDialog('svg')],
        ['save', 'Network: Cytoscape JSON (.cyjs) – opens here and in Cytoscape', () => this.saveNetwork('cyjs')],
        ['save', 'Network: GraphML (networkx, igraph, Gephi, yEd)', () => this.saveNetwork('graphml')],
        ['save', 'Network: SIF (simple interaction format)', () => this.saveNetwork('sif')],
        ['table', 'Node table (.csv)', () => this.saveTable('nodes')],
        ['table', 'Edge table (.csv)', () => this.saveTable('edges')],
        ['python', 'To a notebook: Python (networkx)', () => this.toNotebook('python')],
        ['rlang', 'To a notebook: R (igraph)', () => this.toNotebook('r')]
      ];
    }
    _fileStem(net) {
      return String(net.name).replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'network';
    }
    async _saveText(name, text, opts = {}) {
      return MG.apiTools.saveFile(name, text, { folder: opts.folder || '~/networks' });
    }
    networkText(net, fmt0) {
      const obj = this.toObject(net);
      if (fmt0 === 'cyjs') return IO.writeCyjs(obj, { style: net.style, source: net.source, directed: net.directed, hidden: net.cy.$('.hidden').map((e) => e.id()) });
      if (fmt0 === 'graphml') return IO.writeGraphML(obj);
      if (fmt0 === 'sif') return IO.writeSIF(obj);
      throw new Error('no such format ' + fmt0);
    }
    async saveNetwork(fmt0) {
      const net = this.cur;
      const p = await this._saveText(`${this._fileStem(net)}.${fmt0}`, this.networkText(net, fmt0));
      if (p) bus.emit('net:save', { format: fmt0, path: p });
      return p;
    }
    /** write the network as GraphML into ~/networks and put code that reads it into a notebook */
    /** the node and edge tables for R's igraph (graph_from_data_frame): nodes with their IDs first (and "name" as
        "label": igraph keeps the first column as the name), edges from → to by ID */
    tablesForR(net) {
      const ncols = this._cols(net, 'nodes').filter((c) => c.key !== 'name' && c.key !== 'label');
      const ecols = this._cols(net, 'edges').filter((c) => c.key !== 'from' && c.key !== 'to');
      const nodes = IO.writeTable(['id', 'label'].concat(ncols.map((c) => c.key)), net.cy.nodes().map((n) => [n.id(), n.data('name')].concat(ncols.map((c) => n.data(c.key)))), ',');
      const edges = IO.writeTable(['from', 'to'].concat(ecols.map((c) => c.key)), net.cy.edges().map((e) => [e.source().id(), e.target().id()].concat(ecols.map((c) => e.data(c.key)))), ',');
      return { nodes, edges };
    }
    async toNotebook(lang) {
      const net = this.cur;
      const fs = MG.app.fs;
      const stem = `${HOME()}/networks/${this._fileStem(net)}`;
      fs.mkdirp(`${HOME()}/networks`);
      const title = String(net.name).replace(/\s+/g, ' ');
      let code, nice;
      if (lang === 'r') {
        // (igraph in the browser cannot read GraphML: it gets the two tables)
        const t = this.tablesForR(net);
        fs.writeText(`${stem}_nodes.csv`, t.nodes);
        fs.writeText(`${stem}_edges.csv`, t.edges);
        nice = `${fs.pretty(stem + '_nodes.csv')} and ${fs.pretty(stem + '_edges.csv')}`;
        code = `# The network ${title}, from the Networks tab (its tables saved as ${nice})\nlibrary(igraph)\nnodes <- read.csv("${stem}_nodes.csv", check.names = FALSE)\nedges <- read.csv("${stem}_edges.csv", check.names = FALSE)\ng <- graph_from_data_frame(edges, directed = ${net.directed ? 'TRUE' : 'FALSE'}, vertices = nodes)\ng\n# the 10 nodes with the most neighbours\ndeg <- degree(g)\nnames(deg) <- V(g)$label\nhead(sort(deg, decreasing = TRUE), 10)\n# communities (Louvain) and their sizes\ncl <- cluster_louvain(simplify(${net.directed ? 'as_undirected(g)' : 'g'}))\nsizes(cl)`;
      } else {
        const path = `${stem}.graphml`;
        fs.writeText(path, this.networkText(net, 'graphml'));
        nice = fs.pretty(path);
        code = `# The network ${title}, from the Networks tab (saved as ${nice})\nimport networkx as nx\nimport pandas as pd\n\nG = nx.read_graphml("${path}")\nprint(G.number_of_nodes(), "nodes,", G.number_of_edges(), "edges")\n# the node table, with the columns of the Networks tab\nnodes = pd.DataFrame.from_dict(dict(G.nodes(data=True)), orient="index")\n# the 10 nodes with the most neighbours\ntop = sorted(G.degree, key=lambda x: x[1], reverse=True)[:10]\n[(G.nodes[n].get("name", n), d) for n, d in top]`;
      }
      await MG.app.toNotebook(code, lang === 'r' ? 'r' : 'python', false);
      toast(`Saved ${esc(nice)} and added code that reads ${lang === 'r' ? 'them' : 'it'} to the notebook.`, 'ok', 5000);
      bus.emit('net:notebook', { lang });
    }
    pictureDialog(kind) {
      const net = this.cur;
      const { m, body } = dialog(kind === 'png' ? 'Save a picture (PNG)' : 'Save a picture (SVG)');
      const scale = select([['1', '1× (as on screen)'], ['2', '2× (sharp)'], ['4', '4× (for print)']], '2');
      const legend = h('input', { type: 'checkbox', checked: net.style.legend !== false && this.legendItems(net).length > 0 });
      const bg = h('input', { type: 'checkbox', checked: true });
      if (kind === 'png') body.appendChild(field('Size', scale));
      body.append(h('label.fld', h('span', 'Legend'), h('span', legend, ' at the right of the picture')), h('label.fld', h('span', 'Background'), h('span', bg, ' white (not transparent)')), h('p.note', 'The whole network, as it is drawn now – without the highlight of what is selected.'));
      const make = async () => (kind === 'png' ? this.pngBlob(net, { scale: Number(scale.value), legend: legend.checked, bg: bg.checked }) : new Blob([this.svgText(net, { legend: legend.checked, bg: bg.checked })], { type: 'image/svg+xml' }));
      const name = `${this._fileStem(net)}.${kind}`;
      body.appendChild(h('div.acts', h('span.grow'), btn('download', 'Download', 'Save it on your computer', async () => {
        m.close();
        MG.downloadBlob(await make(), name);
        bus.emit('net:image', { kind, to: 'download' });
      }), btn('save', 'Save to my files', null, async () => {
        m.close();
        const b = await make();
        const p = await MG.apiTools.saveFile(name, kind === 'svg' ? await b.text() : b, { folder: '~/networks' });
        if (p) bus.emit('net:image', { kind, to: 'files', path: p });
      }, '.primary')));
    }
    /** without the highlight of selection and search while fn runs */
    _plain(net, fn) {
      const sel = net.cy.$(':selected'), hits = net.cy.$('.hit');
      sel.unselect();
      hits.removeClass('hit');
      try {
        return fn();
      } finally {
        sel.select();
        hits.addClass('hit');
      }
    }
    async pngBlob(net, o = {}) {
      const blob = await this._plain(net, () => net.cy.png({ output: 'blob-promise', full: true, scale: o.scale || 2, bg: o.bg === false ? undefined : '#ffffff', maxWidth: 12000, maxHeight: 12000 }));
      const items = o.legend ? this.legendItems(net) : [];
      if (!items.length) return blob;
      // the legend, drawn at the right of the picture
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = URL.createObjectURL(blob);
      });
      const lg = this._legendSVG(items, (o.scale || 2) * 1);
      const lim = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(lg.svg);
      });
      const c = document.createElement('canvas');
      c.width = img.width + lg.w;
      c.height = Math.max(img.height, lg.h);
      const ctx = c.getContext('2d');
      if (o.bg !== false) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(lim, img.width, 0);
      URL.revokeObjectURL(img.src);
      return new Promise((res) => c.toBlob(res, 'image/png'));
    }
    /** the legend as SVG → {svg, w, h} (s: scale) */
    _legendSVG(items, s = 1, inner) {
      const W = 220 * s, pad = 12 * s;
      let y = pad, out = '';
      const t = (x, yy, text, size, color, weight) => `<text x="${x}" y="${yy}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="${size * s}" fill="${color || '#18212f'}"${weight ? ` font-weight="${weight}"` : ''}>${esc(text)}</text>`;
      items.forEach((it, gi) => {
        out += t(pad, y + 11 * s, it.title.length > 38 ? it.title.slice(0, 37) + '…' : it.title, 11, '#18212f', 600);
        y += 18 * s;
        if (it.type === 'ramp') {
          const id = `lg${gi}${Math.random().toString(36).slice(2, 6)}`;
          out += `<defs><linearGradient id="${id}">${it.stops.map((c, i) => `<stop offset="${(i / (it.stops.length - 1)) * 100}%" stop-color="${c}"/>`).join('')}</linearGradient></defs><rect x="${pad}" y="${y}" width="${W - 2 * pad}" height="${10 * s}" rx="${3 * s}" fill="url(#${id})"/>`;
          y += 22 * s;
          out += t(pad, y - 2 * s, it.ticks[0], 9.5, '#52514e');
          if (it.ticks[1]) out += `<text x="${W / 2}" y="${y - 2 * s}" text-anchor="middle" font-family="system-ui, Arial, sans-serif" font-size="${9.5 * s}" fill="#52514e">${esc(it.ticks[1])}</text>`;
          out += `<text x="${W - pad}" y="${y - 2 * s}" text-anchor="end" font-family="system-ui, Arial, sans-serif" font-size="${9.5 * s}" fill="#52514e">${esc(it.ticks[2])}</text>`;
          y += 6 * s;
        } else if (it.type === 'swatches') {
          for (const [label, color] of it.items) {
            out += `<circle cx="${pad + 5 * s}" cy="${y + 5 * s}" r="${5 * s}" fill="${color}" stroke="rgba(0,0,0,0.15)"/>` + t(pad + 16 * s, y + 9 * s, String(label).slice(0, 34), 10, '#18212f');
            y += 16 * s;
          }
          y += 4 * s;
        } else if (it.type === 'sizes') {
          let x = pad;
          const maxD = Math.max(...it.items.map((i) => i[1])) * s;
          for (const [label, d] of it.items) {
            const r = (d * s) / 2;
            out += `<circle cx="${x + maxD / 2}" cy="${y + maxD / 2}" r="${r}" fill="#c9d4df" stroke="#8c9aa8"/>`;
            out += `<text x="${x + maxD / 2}" y="${y + maxD + 12 * s}" text-anchor="middle" font-family="system-ui, Arial, sans-serif" font-size="${9.5 * s}" fill="#52514e">${esc(label)}</text>`;
            x += maxD + 14 * s;
          }
          y += maxD + 22 * s;
        } else if (it.type === 'widths') {
          for (const [label, px] of it.items) {
            out += `<line x1="${pad}" x2="${pad + 26 * s}" y1="${y + 5 * s}" y2="${y + 5 * s}" stroke="#8c98a5" stroke-width="${Math.max(1, px) * s}" stroke-linecap="round"/>` + t(pad + 34 * s, y + 9 * s, label, 10, '#52514e');
            y += 16 * s;
          }
          y += 4 * s;
        } else {
          out += t(pad, y + 9 * s, String(it.text).slice(0, 40), 10, '#52514e');
          y += 18 * s;
        }
        y += 6 * s;
      });
      const H = y + pad;
      if (inner) return { body: out, w: W, h: H };
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`, w: W, h: H };
    }
    /** the network as SVG: nodes, edges and labels as drawn now (shapes, colours, sizes, pie slices, arrows) */
    svgText(net, o = {}) {
      return this._plain(net, () => {
        const cy = net.cy;
        const vis = cy.elements(':visible');
        const bb = vis.boundingBox({ includeLabels: true, includeOverlays: false });
        const pad = 20;
        const items = o.legend ? this.legendItems(net) : [];
        const lg = items.length ? this._legendSVG(items, 1, true) : null;
        const W = Math.ceil((isFinite(bb.w) ? bb.w : 100) + 2 * pad), H = Math.ceil((isFinite(bb.h) ? bb.h : 100) + 2 * pad);
        const TW = W + (lg ? lg.w : 0), TH = Math.max(H, lg ? lg.h : 0);
        const ox = pad - (isFinite(bb.x1) ? bb.x1 : 0), oy = pad - (isFinite(bb.y1) ? bb.y1 : 0);
        const X = (x) => +(x + ox).toFixed(2), Y = (y) => +(y + oy).toFixed(2);
        const num = (v) => parseFloat(v) || 0;
        const col = (v) => {
          const s = String(v || '');
          const m = /rgba?\(([^)]+)\)/.exec(s);
          if (!m) return s;
          const p = m[1].split(',').map((x) => parseFloat(x));
          return '#' + p.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
        };
        const font = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">`;
        s += `<title>${esc(net.name)}</title>`;
        if (o.bg !== false) s += `<rect width="${TW}" height="${TH}" fill="#ffffff"/>`;
        // edges
        s += '<g>';
        vis.edges().forEach((e) => {
          const st = (k) => e.style(k);
          const a = e.sourceEndpoint(), b = e.targetEndpoint();
          if (!a || !b || !isFinite(a.x) || !isFinite(b.x)) return;
          const cps = e.controlPoints && e.controlPoints();
          let d = `M${X(a.x)} ${Y(a.y)}`;
          let last = a;
          if (cps && cps.length) {
            if (cps.length === 1) d += ` Q${X(cps[0].x)} ${Y(cps[0].y)} ${X(b.x)} ${Y(b.y)}`;
            else {
              for (let i = 0; i < cps.length; i++) {
                const c = cps[i], nx = i + 1 < cps.length ? { x: (c.x + cps[i + 1].x) / 2, y: (c.y + cps[i + 1].y) / 2 } : b;
                d += ` Q${X(c.x)} ${Y(c.y)} ${X(nx.x)} ${Y(nx.y)}`;
              }
            }
            last = cps[cps.length - 1];
          } else d += ` L${X(b.x)} ${Y(b.y)}`;
          const w = num(st('width')), stroke = col(st('line-color')), op = num(st('opacity'));
          const ls = st('line-style');
          const dash = ls === 'dashed' ? ` stroke-dasharray="${6} ${4}"` : ls === 'dotted' ? ` stroke-dasharray="1 ${3}" stroke-linecap="round"` : '';
          s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-opacity="${op}"${dash}/>`;
          const arrow = st('target-arrow-shape');
          if (arrow && arrow !== 'none') {
            const ang = Math.atan2(b.y - last.y, b.x - last.x), L = Math.max(6, w * 3.2), Wd = Math.max(4, w * 2.4);
            const p = (dx, dy) => `${X(b.x + dx * Math.cos(ang) - dy * Math.sin(ang))},${Y(b.y + dx * Math.sin(ang) + dy * Math.cos(ang))}`;
            if (arrow === 'tee') s += `<polyline points="${p(-1, -Wd)} ${p(-1, Wd)}" stroke="${stroke}" stroke-width="${Math.max(1.5, w)}" stroke-opacity="${op}" fill="none"/>`;
            else if (arrow === 'circle') s += `<circle cx="${X(b.x - (L / 2) * Math.cos(ang))}" cy="${Y(b.y - (L / 2) * Math.sin(ang))}" r="${Wd / 1.6}" fill="${stroke}" fill-opacity="${op}"/>`;
            else s += `<polygon points="${p(0, 0)} ${p(-L, -Wd / 2 - 1)} ${arrow === 'vee' ? p(-L * 0.6, 0) + ' ' : ''}${p(-L, Wd / 2 + 1)}" fill="${stroke}" fill-opacity="${op}"/>`;
          }
        });
        s += '</g><g>';
        // nodes
        const poly = (cx, cy0, w, hh, pts) => pts.map(([px, py]) => `${X(cx + (px * w) / 2)},${Y(cy0 + (py * hh) / 2)}`).join(' ');
        const reg = (n, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(rot + (2 * Math.PI * i) / n), Math.sin(rot + (2 * Math.PI * i) / n)]);
        const SH = {
          triangle: [[0, -1], [1, 1], [-1, 1]], 'round-triangle': [[0, -1], [1, 1], [-1, 1]], diamond: [[0, -1], [1, 0], [0, 1], [-1, 0]], hexagon: reg(6, 0), octagon: reg(8, Math.PI / 8),
          star: Array.from({ length: 10 }, (_, i) => {
            const r = i % 2 ? 0.45 : 1, a = -Math.PI / 2 + (Math.PI * i) / 5;
            return [r * Math.cos(a), r * Math.sin(a)];
          }),
          vee: [[-1, -1], [0, -0.33], [1, -1], [0, 1]], barrel: [[-0.9, -1], [0.9, -1], [1, -0.6], [1, 0.6], [0.9, 1], [-0.9, 1], [-1, 0.6], [-1, -0.6]]
        };
        vis.nodes().forEach((n) => {
          const p = n.position(), w = n.width(), hh = n.height();
          const shape = n.style('shape');
          const fill = col(n.style('background-color')), bc = col(n.style('border-color')), bw = num(n.style('border-width')), op = num(n.style('opacity'));
          const attrs = `fill="${fill}" fill-opacity="${op}" stroke="${bc}" stroke-width="${bw}" stroke-opacity="${op}"`;
          if (shape === 'ellipse') s += `<ellipse cx="${X(p.x)}" cy="${Y(p.y)}" rx="${w / 2}" ry="${hh / 2}" ${attrs}/>`;
          else if (shape === 'rectangle' || shape === 'round-rectangle') s += `<rect x="${X(p.x - w / 2)}" y="${Y(p.y - hh / 2)}" width="${w}" height="${hh}"${shape === 'round-rectangle' ? ` rx="${Math.min(w, hh) / 4}"` : ''} ${attrs}/>`;
          else s += `<polygon points="${poly(p.x, p.y, w, hh, SH[shape] || reg(24))}" ${attrs}/>`;
          // a ring of slices
          const pn = n.data('_pn');
          if (pn > 0) {
            const R = Math.min(w, hh) / 2, hole = parseFloat(n.data('_ph')) / 100 || 0;
            const r0 = R * hole;
            let a0 = -Math.PI / 2;
            for (let i = 1; i <= pn; i++) {
              const frac = parseFloat(n.data(`_q${i}`)) / 100 || 0;
              if (!frac) continue;
              const a1 = a0 + frac * 2 * Math.PI, large = a1 - a0 > Math.PI ? 1 : 0;
              const pt = (r, a) => `${X(p.x + r * Math.cos(a))} ${Y(p.y + r * Math.sin(a))}`;
              const dd = r0 > 0 ? `M${pt(R, a0)} A${R} ${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z` : `M${X(p.x)} ${Y(p.y)} L${pt(R, a0)} A${R} ${R} 0 ${large} 1 ${pt(R, a1)} Z`;
              s += `<path d="${dd}" fill="${n.data('_p' + i)}" fill-opacity="${op}"/>`;
              a0 = a1;
            }
          }
          const label = n.style('label');
          if (label) {
            const fs0 = num(n.style('font-size'));
            const valign = n.style('text-valign');
            const ty = valign === 'bottom' ? p.y + hh / 2 + fs0 + num(n.style('text-margin-y')) : valign === 'top' ? p.y - hh / 2 - 3 : p.y + fs0 / 3;
            s += `<text x="${X(p.x)}" y="${Y(ty)}" text-anchor="middle" font-family="${font}" font-size="${fs0}" fill="${col(n.style('color'))}" stroke="#ffffff" stroke-width="${num(n.style('text-outline-width')) * 1.6}" stroke-linejoin="round" paint-order="stroke" fill-opacity="${op}">${esc(label)}</text>`;
          }
        });
        vis.edges().forEach((e) => {
          const label = e.style('label');
          if (!label) return;
          const m = e.midpoint();
          s += `<text x="${X(m.x)}" y="${Y(m.y)}" text-anchor="middle" font-family="${font}" font-size="${num(e.style('font-size'))}" fill="#52514e" stroke="#ffffff" stroke-width="2" paint-order="stroke">${esc(label)}</text>`;
        });
        s += '</g>';
        if (lg) s += `<g transform="translate(${W} 0)">${lg.body}</g>`;
        s += '</svg>';
        return s;
      });
    }

    /* ================= undo ================= */
    checkpoint(net, label) {
      if (!net) return;
      if (net.cy.elements().length > 60000) return;
      net.undo.push(this._snapshot(net, label));
      if (net.undo.length > 12) net.undo.shift();
      net.redo = [];
      this.undoBtn.disabled = false;
      this.redoBtn.disabled = true;
    }
    _snapshot(net, label) {
      return { label, nodes: net.cy.nodes().map((n) => ({ data: Object.assign({}, n.data()), position: Object.assign({}, n.position()), classes: n.classes() })), edges: net.cy.edges().map((e) => ({ data: Object.assign({}, e.data()), classes: e.classes() })), style: clone(net.style) };
    }
    _restoreSnap(net, s) {
      const cy = net.cy;
      cy.batch(() => {
        cy.elements().remove();
        cy.add(s.nodes.map((n) => ({ group: 'nodes', data: n.data, position: n.position, classes: n.classes })));
        cy.add(s.edges.map((e) => ({ group: 'edges', data: e.data, classes: e.classes })));
      });
      net.style = clone(s.style);
      this.applyStyle(net);
      this._changed(net);
      this._refreshAll();
    }
    undo() {
      const net = this.cur;
      if (!net || !net.undo.length) return;
      const s = net.undo.pop();
      net.redo.push(this._snapshot(net, s.label));
      this._restoreSnap(net, s);
      toast(`Undone: ${esc(s.label)}.`, null, 1800);
    }
    redo() {
      const net = this.cur;
      if (!net || !net.redo.length) return;
      const s = net.redo.pop();
      net.undo.push(this._snapshot(net, s.label));
      this._restoreSnap(net, s);
      toast(`Redone: ${esc(s.label)}.`, null, 1800);
    }
    _keys(e) {
      const net = this.cur;
      if (!net || e.target !== this.stage) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && net.cy.$(':selected').length) {
        e.preventDefault();
        this.deleteSelected();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        net.cy.nodes(':visible').select();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Escape') net.cy.$(':selected').unselect();
      else if (e.key === 'f' || e.key === 'F') this._fit(net, true);
      else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-') this.zoomBy(0.8);
    }

    /* ================= keeping the networks (~/.networks/session.json) ================= */
    _saveSoon() {
      clearTimeout(this._st);
      this._st = setTimeout(() => this._save(), 1500);
    }
    _save() {
      try {
        const fs = MG.app.fs;
        const data = {
          version: 1,
          current: this.nets.indexOf(this.cur),
          networks: this.nets.map((net) => {
            const obj = this.toObject(net);
            return Object.assign(obj, { workbench: { style: net.style, source: net.source, results: net.results.slice(0, 10), hidden: net.cy.$('.hidden').map((e) => e.id()) } });
          })
        };
        const text = JSON.stringify(data);
        if (text.length > 40e6) {
          if (!this._warnedBig) toast('The networks that are open are too large to keep in this browser: save them (Save → Network) before you leave the page.', 'warn', 9000);
          this._warnedBig = true;
          return;
        }
        if (!this.nets.length && !fs.exists(SESSION())) return;
        fs.mkdirp(MG.path.dirname(SESSION()));
        fs.writeText(SESSION(), text);
      } catch (e) {
        console.error(e);
      }
    }
    async _restore() {
      const fs = MG.app.fs;
      if (!fs.exists(SESSION())) return;
      let d;
      try {
        d = JSON.parse(await fs.readText(SESSION()));
      } catch (e) {
        console.error(e);
        return;
      }
      for (const n of d.networks || []) {
        try {
          const net = await this._add(n, { quiet: true, noLayout: true, results: (n.workbench && n.workbench.results) || [] });
          net.viewed = false;
        } catch (e) {
          console.error(e);
        }
      }
      const cur = this.nets[d.current] || this.nets[0];
      if (cur) this.show(cur);
    }

    /* ================= for the help's ▶ buttons, the terminal, the AI assistant ================= */
    /** data-net="example:airway" | "example:karate" | "open:PATH" | "string:TP53,MDM2" | "genetable:PATH" | "table:PATH"
        | "analyse:stats|hubs|mcode|mcl|louvain|components" | "style:expression|clusters|…" | "layout:NAME" (groups: by the
        latest clusters) | "select:isolated" | "select:NAME,NAME…" | "hide" (the selected nodes) | "enrich[:cluster1]"
        | "picture[:png|svg]" */
    async action(spec) {
      await this.ready;
      const [what, ...rest] = String(spec).split(':');
      const arg = rest.join(':');
      if (what === 'example') return this.example(arg);
      if (what === 'open') return this.openPath(arg);
      if (what === 'string') return this.stringNetwork({ ids: arg.split(/[\s,;]+/).filter(Boolean), species: '9606', score: 400 });
      if (what === 'genetable') return this.geneTableDialog({ path: arg });
      if (what === 'table') return this.importTableDialog({ path: arg });
      if (!this.cur) throw new Error('Open a network first (Open → an example).');
      if (what === 'analyse' || what === 'analyze') {
        if (arg === 'stats') return this.analyze();
        if (arg === 'hubs') return this.hubs(this.cur, ['MCC', 'Degree', 'Betweenness', 'Closeness'], 10);
        if (arg === 'mcode') return this.clusters(this.cur, 'mcode', {});
        if (arg === 'mcl') return this.clusters(this.cur, 'mcl', { inflation: 2 }, (this._weightCols(this.cur)[0] || {}).key || null);
        if (arg === 'louvain') return this.clusters(this.cur, 'louvain', { resolution: 1 });
        if (arg === 'components') return this.clusters(this.cur, 'components', {});
      }
      if (what === 'style') return this.setStyle(this.cur, arg);
      if (what === 'layout') return this.layout(this.cur, arg);
      if (what === 'select') {
        const cy = this.cur.cy;
        if (arg === 'isolated') {
          cy.$(':selected').unselect();
          return cy.nodes(':visible').filter((x) => x.degree(false) === 0).select();
        }
        const hits = this._selectNames(this.cur, arg.split(/[\s,;]+/).filter(Boolean), true);
        toast(`${plural(hits.length, 'node')} selected.`, null, 2500);
        return hits;
      }
      if (what === 'hide') return this.hideSelected();
      if (what === 'enrich') {
        const r = this.cur.results.find((x) => x.type === 'clusters');
        const c = r && r.clusters.find((x) => x.size > 1);
        if (arg === 'cluster1' && c) return this.enrichment(this.cur, { nodes: this.cur.cy.collection(c.ids.map((id) => this.cur.cy.getElementById(id))), service: 'string', species: this.cur.data.species || '9606', label: `${r.column} 1` });
        return this.enrichmentDialog();
      }
      if (what === 'picture') return this.pictureDialog(arg || 'png');
      throw new Error('no such action: ' + spec);
    }
    /** a summary of the network that is open, for the AI assistant */
    contextText() {
      const net = this.cur;
      if (!net) return 'The Networks tab has no network open.';
      const cy = net.cy;
      const cols = this._cols(net, 'nodes').map((c) => c.key);
      const deg = cy.nodes().map((n) => [n.data('name'), n.degree(false)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const lines = [`The network open in the Networks tab: "${net.name}" (${net.source || 'source unknown'}): ${cy.nodes().length} nodes, ${cy.edges().length} edges${net.directed ? ', directed' : ''}.`, `Node table columns: ${cols.join(', ')}.`, `Most connected nodes: ${deg.map(([n, d]) => `${n} (${d})`).join(', ')}.`];
      const sel = cy.$('node:selected');
      if (sel.length) lines.push(`Selected: ${sel.map((n) => n.data('name')).slice(0, 30).join(', ')}${sel.length > 30 ? ' …' : ''}.`);
      for (const r of net.results.slice(0, 4)) {
        if (r.type === 'clusters') lines.push(`${r.title}: ${r.clusters.filter((c) => c.size > 1).slice(0, 5).map((c) => `#${c.n} (${c.size} nodes: ${c.names.slice(0, 8).join(', ')})`).join('; ')}.`);
        if (r.type === 'hubs') lines.push(`Hubs (${r.methods[0]}): ${(r.tables[r.methods[0]] || []).slice(0, 10).map((x) => x.name).join(', ')}.`);
        if (r.type === 'enrichment') lines.push(`${r.title}: ${r.terms.slice(0, 6).map((t) => `${t.name} (${t.cat}, FDR ${fmt(t.fdr)})`).join('; ')}.`);
        if (r.type === 'stats') lines.push(`Statistics: diameter ${r.summary.diameter}, characteristic path length ${fmt(+r.summary.pathLength.toPrecision(4))}, clustering coefficient ${fmt(+r.summary.clustering.toPrecision(3))}, ${r.summary.components} connected components.`);
      }
      return lines.join('\n');
    }
  }
  const g0 = (net) => net.cy.nodes().length;

  // (a button in a message: "Colour the nodes by log2FoldChange")
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-netstyle]');
    const N = MG.app && MG.app.networks;
    if (b && N && N.cur) N.setStyle(N.cur, b.dataset.netstyle);
  });

  MG.NetworksPanel = NetworksPanel;
  MG.netStyle = { defaultStyle, ramp, PALETTES, CAT, evaluator };
})();
