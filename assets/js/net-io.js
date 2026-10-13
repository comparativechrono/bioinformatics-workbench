/* =====================================================================
   Network files for the Networks tab: reading and writing, with nothing
   of the page in them (the tests run them in Node too).

   A network here: {name, directed, data: {network attributes},
     nodes: [{id, data: {name, …}, position?: {x, y}}],
     edges: [{source, target, data: {interaction, …}}]}

   Read:  SIF, tables of edges (CSV/TSV, with a choice of columns),
          GraphML, XGMML, GML, Cytoscape JSON (.cyjs), CX2 (NDEx),
          STRING's and IntAct's answers
   Write: Cytoscape JSON, GraphML, SIF, tables (CSV/TSV)
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MG = root.MG || {};
    root.MG.netIO = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------
     values and attribute names
     ------------------------------------------------------------------ */
  // names that Cytoscape.js reads itself (parent makes compound nodes) – an attribute with one of them is renamed
  const RESERVED = new Set(['id', 'source', 'target', 'parent']);
  /** a safe attribute name: not one of the reserved names, not beginning with _ (the page's own) */
  function attrName(k, taken) {
    let x = String(k == null ? '' : k).trim() || 'attribute';
    x = x.replace(/^_+/, '') || 'attribute';
    if (RESERVED.has(x)) x = x + '_attribute';
    if (taken) {
      const base = x;
      for (let i = 2; taken.has(x); i++) x = `${base}_${i}`;
      taken.add(x);
    }
    return x;
  }
  const MISSING = new Set(['', 'na', 'nan', 'null', 'none', '-', 'n/a', '#n/a']);
  /** text from a file → a number, true/false, or the text (null for NA and empty) */
  function value(s) {
    if (s == null) return null;
    if (typeof s !== 'string') return s;
    const t = s.trim();
    if (MISSING.has(t.toLowerCase())) return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    if (/^[+-]?inf(inity)?$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    return t;
  }
  /** the kind of a column of values: number, boolean, list or text */
  function kindOf(vals) {
    let num = 0, bool = 0, list = 0, other = 0;
    for (const v of vals) {
      if (v == null || v === '') continue;
      if (typeof v === 'number') num++;
      else if (typeof v === 'boolean') bool++;
      else if (Array.isArray(v)) list++;
      else other++;
    }
    if (other) return 'text';
    if (list) return 'list';
    if (bool && !num) return 'boolean';
    if (num) return 'number';
    return 'text';
  }

  /* ------------------------------------------------------------------
     tables (CSV, TSV)
     ------------------------------------------------------------------ */
  /** the separator of a table: a tab, a comma or a semicolon (the one in the first lines, and the same number of
      times in each) */
  function separatorOf(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^#(?!\w)/.test(l)).slice(0, 20);
    if (!lines.length) return '\t';
    const count = (l, c) => {
      let n = 0, q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === c && !q) n++;
      }
      return n;
    };
    for (const c of ['\t', ',', ';']) {
      const n = count(lines[0], c);
      if (n && lines.every((l) => count(l, c) === n || count(l, c) === n - 1 || count(l, c) === n + 1)) return c;
    }
    for (const c of ['\t', ',', ';']) if (count(lines[0], c)) return c;
    return /\s/.test(lines[0].trim()) ? 'space' : '\t';
  }
  /** a table (with a first line of column names) → {columns, rows: [[text]]}. Quotes as in CSV files; a first
      column without a name (R's row names) is called "row" */
  function parseTable(text, opts = {}) {
    text = String(text).replace(/^﻿/, '');
    const sep = opts.sep || separatorOf(text);
    const rows = [];
    if (sep === 'space') {
      for (const l of text.split(/\r?\n/)) if (l.trim()) rows.push(l.trim().split(/\s+/));
    } else {
      let row = [], cell = '', q = false, i = 0;
      const n = text.length;
      while (i < n) {
        const ch = text[i];
        if (q) {
          if (ch === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i++;
            } else q = false;
          } else cell += ch;
        } else if (ch === '"' && cell === '') q = true;
        else if (ch === sep) {
          row.push(cell);
          cell = '';
        } else if (ch === '\n' || ch === '\r') {
          row.push(cell);
          cell = '';
          if (row.length > 1 || row[0] !== '') rows.push(row);
          row = [];
          if (ch === '\r' && text[i + 1] === '\n') i++;
        } else cell += ch;
        i++;
      }
      if (cell !== '' || row.length) {
        row.push(cell);
        if (row.length > 1 || row[0] !== '') rows.push(row);
      }
    }
    // comment lines (but "#node1 …" is the header of STRING's files)
    while (rows.length > 1 && /^#/.test(rows[0][0]) && rows[0].length === 1) rows.shift();
    if (!rows.length) return { columns: [], rows: [], sep };
    let header = rows.shift().map((c) => c.trim());
    if (opts.noHeader) {
      rows.unshift(header);
      header = header.map((_, i) => `column ${i + 1}`);
    }
    header = header.map((c, i) => (i === 0 ? c.replace(/^#\s*/, '') : c));
    // (R's write.csv: a first column without a name, and one value more in each row than names in the header)
    if (rows.length && rows[0].length === header.length + 1) header.unshift('row');
    if (header[0] === '') header[0] = 'row';
    const taken = new Set();
    const columns = header.map((c, i) => {
      let x = c || `column ${i + 1}`;
      for (let k = 2; taken.has(x); k++) x = `${c || 'column'} ${k}`;
      taken.add(x);
      return x;
    });
    const width = columns.length;
    return { columns, rows: rows.map((r) => (r.length >= width ? r.slice(0, width) : r.concat(new Array(width - r.length).fill('')))), sep };
  }
  /** rows → CSV or TSV text */
  function writeTable(columns, rows, sep = '\t') {
    const cell = (v) => {
      if (v == null || (typeof v === 'number' && isNaN(v))) return sep === ',' ? 'NA' : '';
      const s = Array.isArray(v) ? v.join('|') : String(v);
      if (sep === ',') return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      return s.replace(/[\t\n\r]+/g, ' ');
    };
    return [columns.map(cell).join(sep)].concat(rows.map((r) => r.map(cell).join(sep))).join('\n') + '\n';
  }

  /** which columns of a table hold the two ends of the edges, and their interaction: a guess from the names
      (source/target, node1/node2, protein1/protein2, preferredName_A/B, interactor A/B …) */
  function guessEdgeColumns(columns) {
    const low = columns.map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const pairs = [
      ['preferrednamea', 'preferrednameb'], ['node1', 'node2'], ['source', 'target'], ['from', 'to'], ['protein1', 'protein2'], ['gene1', 'gene2'],
      ['genea', 'geneb'], ['proteina', 'proteinb'], ['interactora', 'interactorb'], ['ida', 'idb'], ['symbola', 'symbolb'], ['nodea', 'nodeb'],
      ['officialsymbolinteractora', 'officialsymbolinteractorb'], ['uniqueida', 'uniqueidb'], ['moleculea', 'moleculeb'], ['stringida', 'stringidb'], ['sourcenode', 'targetnode']
    ];
    for (const [a, b] of pairs) {
      const i = low.indexOf(a), j = low.indexOf(b);
      if (i >= 0 && j >= 0) {
        const k = low.findIndex((x) => /^(interaction|interactiontype|type|relation|edgetype|effect|sign)$/.test(x));
        return { source: i, target: j, interaction: k >= 0 ? k : null };
      }
    }
    return { source: 0, target: columns.length > 1 ? 1 : 0, interaction: null };
  }
  /** a table of edges → a network. map: {source, target, interaction (column index or null), attrs: [column
      indices] (default: the others), directed} */
  function fromEdgeTable(table, map = {}, name) {
    const m = Object.assign(guessEdgeColumns(table.columns), map);
    const attrs = m.attrs || table.columns.map((_, i) => i).filter((i) => i !== m.source && i !== m.target && i !== m.interaction);
    const taken = new Set(['name', 'interaction']);
    const names = attrs.map((i) => attrName(table.columns[i], taken));
    const nodes = new Map();
    const edges = [];
    const node = (id) => {
      if (!nodes.has(id)) nodes.set(id, { id, data: { name: id } });
    };
    for (const r of table.rows) {
      const s = String(r[m.source] == null ? '' : r[m.source]).trim(), t = String(r[m.target] == null ? '' : r[m.target]).trim();
      if (!s) continue;
      node(s);
      if (!t) continue;
      node(t);
      const data = {};
      if (m.interaction != null) data.interaction = String(r[m.interaction] || '').trim() || 'interacts with';
      attrs.forEach((i, k) => {
        const v = value(r[i]);
        if (v != null) data[names[k]] = v;
      });
      edges.push({ source: s, target: t, data });
    }
    return { name: name || 'network', directed: !!m.directed, data: {}, nodes: Array.from(nodes.values()), edges };
  }

  /* ------------------------------------------------------------------
     SIF: "A pp B C" – a node, the kind of interaction, the nodes it is joined to; or a node on its own
     ------------------------------------------------------------------ */
  function parseSIF(text, name) {
    const nodes = new Map(), edges = [];
    const node = (id) => {
      if (!nodes.has(id)) nodes.set(id, { id, data: { name: id } });
    };
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const parts = line.includes('\t') ? line.split('\t').map((x) => x.trim()).filter((x) => x !== '') : line.trim().split(/\s+/);
      node(parts[0]);
      if (parts.length === 2) throw new Error(`this line of the SIF file has two words, not one or three or more: “${line.trim().slice(0, 80)}”`);
      for (let i = 2; i < parts.length; i++) {
        node(parts[i]);
        edges.push({ source: parts[0], target: parts[i], data: { interaction: parts[1] } });
      }
    }
    return { name: name || 'network', directed: false, data: {}, nodes: Array.from(nodes.values()), edges };
  }
  function writeSIF(net) {
    const named = new Map(net.nodes.map((n) => [n.id, String(n.data.name == null ? n.id : n.data.name)]));
    const lines = [];
    const used = new Set();
    for (const e of net.edges) {
      const it = String(e.data.interaction || 'interacts_with').replace(/\s+/g, '_');
      lines.push(`${named.get(e.source)}\t${it}\t${named.get(e.target)}`);
      used.add(e.source);
      used.add(e.target);
    }
    for (const n of net.nodes) if (!used.has(n.id)) lines.push(named.get(n.id));
    return lines.join('\n') + '\n';
  }

  /* ------------------------------------------------------------------
     a small XML reader (GraphML, XGMML): elements, attributes, text
     ------------------------------------------------------------------ */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] != null ? ENT[e] : m));
  function parseXML(text) {
    const root = { name: '#root', attrs: {}, kids: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) top.text += m[1];
      else if (m[2]) {
        const local = m[2].replace(/^.*:/, '');
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === local) {
            stack.length = i;
            break;
          }
        }
      } else if (m[3]) {
        const el = { name: m[3].replace(/^.*:/, ''), attrs: {}, kids: [], text: '' };
        const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ar.exec(m[4] || ''))) el.attrs[a[1].replace(/^.*:/, '')] = unent(a[3] != null ? a[3] : a[4]);
        top.kids.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] != null) top.text += unent(m[6]);
    }
    return root;
  }
  const kids = (el, name) => el.kids.filter((k) => k.name === name);
  const find = (el, name) => {
    if (el.name === name) return el;
    for (const k of el.kids) {
      const f = find(k, name);
      if (f) return f;
    }
    return null;
  };
  const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* GraphML (networkx, igraph, Gephi, yEd, Cytoscape) */
  function parseGraphML(text, name) {
    const doc = parseXML(text);
    const g = find(doc, 'graph');
    if (!g) throw new Error('no <graph> in this GraphML file');
    const keys = {};
    const top = find(doc, 'graphml') || doc;
    for (const k of kids(top, 'key')) keys[k.attrs.id] = { name: k.attrs['attr.name'] || k.attrs.id, type: (k.attrs['attr.type'] || 'string').toLowerCase(), for: k.attrs.for || 'all', def: (kids(k, 'default')[0] || {}).text };
    const conv = (key, raw) => {
      const t = (keys[key] || {}).type || 'string';
      if (/int|long|float|double/.test(t)) return value(raw);
      if (t === 'boolean') return /^(true|1)$/i.test(String(raw).trim());
      return String(raw);
    };
    const dataOf = (el, kind) => {
      const out = {}, taken = new Set(['name']);
      for (const [id, k] of Object.entries(keys)) if ((k.for === kind || k.for === 'all') && k.def != null && k.def !== '') out[attrName(k.name, taken)] = conv(id, k.def);
      for (const d of kids(el, 'data')) {
        const k = keys[d.attrs.key];
        const nm = k ? k.name : d.attrs.key;
        const v = conv(d.attrs.key, d.text);
        if (nm === 'name' || nm === 'label') {
          if (nm === 'name' || out.name == null) out.name = String(v);
          if (nm === 'label') out.label = String(v);
        } else out[attrName(nm, taken)] = v;
      }
      return out;
    };
    const nodes = [], edges = [];
    const ids = new Set();
    const walk = (el) => {
      for (const n of kids(el, 'node')) {
        const data = dataOf(n, 'node');
        const position = data.x != null && data.y != null && typeof data.x === 'number' ? { x: data.x, y: data.y } : undefined;
        if (data.name == null) data.name = n.attrs.id;
        nodes.push({ id: n.attrs.id, data, position });
        ids.add(n.attrs.id);
        for (const sub of kids(n, 'graph')) walk(sub);
      }
      for (const e of kids(el, 'edge')) {
        const data = dataOf(e, 'edge');
        if (data.name != null && data.interaction == null && !/\(.*\)/.test(data.name)) data.label = data.name;
        delete data.name;
        edges.push({ source: e.attrs.source, target: e.attrs.target, data, directed: e.attrs.directed });
      }
    };
    walk(g);
    for (const e of edges) for (const id of [e.source, e.target]) if (!ids.has(id)) {
      ids.add(id);
      nodes.push({ id, data: { name: id } });
    }
    const gdata = dataOf(g, 'graph');
    const directed = g.attrs.edgedefault === 'directed';
    return { name: gdata.name || name || 'network', directed, data: gdata, nodes, edges: edges.map(({ source, target, data }) => ({ source, target, data })) };
  }
  function writeGraphML(net) {
    const typeOf = (vals) => {
      const k = kindOf(vals);
      if (k === 'number') return vals.every((v) => v == null || Number.isInteger(v)) ? 'long' : 'double';
      if (k === 'boolean') return 'boolean';
      return 'string';
    };
    const keyset = (items, kind, prefix) => {
      const names = new Set();
      items.forEach((x) => Object.keys(x.data || {}).forEach((k) => names.add(k)));
      return Array.from(names).map((k, i) => ({ id: prefix + i, name: k, kind, type: typeOf(items.map((x) => (x.data || {})[k])) }));
    };
    const nk = keyset(net.nodes, 'node', 'v'), ek = keyset(net.edges, 'edge', 'e');
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">'];
    for (const k of nk.concat(ek)) out.push(`  <key id="${k.id}" for="${k.kind}" attr.name="${xesc(k.name)}" attr.type="${k.type}"/>`);
    out.push(`  <graph id="${xesc(net.name || 'network')}" edgedefault="${net.directed ? 'directed' : 'undirected'}">`);
    const cell = (v) => (Array.isArray(v) ? v.join('|') : typeof v === 'boolean' ? String(v) : v);
    for (const n of net.nodes) {
      out.push(`    <node id="${xesc(n.id)}">`);
      for (const k of nk) {
        const v = n.data[k.name];
        if (v != null && !(typeof v === 'number' && !isFinite(v))) out.push(`      <data key="${k.id}">${xesc(cell(v))}</data>`);
      }
      out.push('    </node>');
    }
    net.edges.forEach((e) => {
      out.push(`    <edge source="${xesc(e.source)}" target="${xesc(e.target)}">`);
      for (const k of ek) {
        const v = e.data[k.name];
        if (v != null && !(typeof v === 'number' && !isFinite(v))) out.push(`      <data key="${k.id}">${xesc(cell(v))}</data>`);
      }
      out.push('    </edge>');
    });
    out.push('  </graph>', '</graphml>');
    return out.join('\n') + '\n';
  }

  /* XGMML (Cytoscape's XML): <node id label><att name value type/><graphics x y/></node> */
  function parseXGMML(text, name) {
    const doc = parseXML(text);
    const g = find(doc, 'graph');
    if (!g) throw new Error('no <graph> in this XGMML file');
    const att = (el) => {
      const out = {}, taken = new Set(['name']);
      for (const a of kids(el, 'att')) {
        const nm = a.attrs.name;
        if (!nm) continue;
        const t = (a.attrs.type || 'string').toLowerCase();
        let v;
        if (t === 'list') v = kids(a, 'att').map((x) => value(x.attrs.value));
        else if (/real|integer|double|long/.test(t)) v = value(a.attrs.value);
        else if (t === 'boolean') v = /^(true|1)$/i.test(a.attrs.value || '');
        else v = a.attrs.value;
        if (nm === 'name' || nm === 'shared name') {
          if (nm === 'name' || out.name == null) out.name = v;
        } else if (!/^(selected|SUID|shared interaction)$/.test(nm)) out[attrName(nm, taken)] = v;
      }
      return out;
    };
    const nodes = [], edges = [], ids = new Set();
    for (const n of kids(g, 'node')) {
      const data = att(n);
      if (data.name == null) data.name = n.attrs.label || n.attrs.id;
      const gr = kids(n, 'graphics')[0];
      const position = gr && gr.attrs.x != null ? { x: +gr.attrs.x, y: +gr.attrs.y } : undefined;
      nodes.push({ id: n.attrs.id, data, position });
      ids.add(n.attrs.id);
    }
    for (const e of kids(g, 'edge')) {
      const data = att(e);
      delete data.name;
      edges.push({ source: e.attrs.source, target: e.attrs.target, data });
    }
    for (const e of edges) for (const id of [e.source, e.target]) if (!ids.has(id)) {
      ids.add(id);
      nodes.push({ id, data: { name: id } });
    }
    return { name: g.attrs.label || name || 'network', directed: g.attrs.directed === '1', data: att(g), nodes, edges };
  }

  /* ------------------------------------------------------------------
     GML: graph [ directed 0 node [ id 1 label "A" ] edge [ source 1 target 2 ] ]
     ------------------------------------------------------------------ */
  function parseGML(text, name) {
    const tok = [];
    const re = /\s*(?:#[^\n]*|("(?:[^"\\]|\\.)*")|(\[)|(\])|([^\s\[\]"]+))/g;
    let m;
    while ((m = re.exec(text)) && m[0] !== '') {
      if (m[1] != null) tok.push({ s: unent(m[1].slice(1, -1).replace(/\\"/g, '"')) });
      else if (m[2]) tok.push('[');
      else if (m[3]) tok.push(']');
      else if (m[4] != null) tok.push(m[4]);
    }
    let i = 0;
    const list = () => {
      const out = [];
      while (i < tok.length && tok[i] !== ']') {
        const key = tok[i++];
        const v = tok[i++];
        if (v === '[') {
          out.push([key, list()]);
          i++;
        } else out.push([key, typeof v === 'object' ? v.s : value(v)]);
      }
      return out;
    };
    const top = list();
    const graph = (top.find(([k]) => k === 'graph') || [null, top])[1];
    const taken0 = () => new Set(['name']);
    const nodes = [], edges = [], ids = new Map();
    let directed = false, gname = null;
    for (const [k, v] of graph) {
      if (k === 'directed') directed = !!v;
      if (k === 'label' || k === 'name') gname = String(v);
      if (k === 'node') {
        const data = {}, taken = taken0();
        let id = null, pos;
        for (const [a, b] of v) {
          if (a === 'id') id = String(b);
          else if (a === 'name') data.name = String(b);
          else if (a === 'label') data.label = String(b);
          else if (a === 'graphics' && Array.isArray(b)) {
            const x = b.find(([q]) => q === 'x'), y = b.find(([q]) => q === 'y');
            if (x && y) pos = { x: +x[1], y: +y[1] };
          } else if (!Array.isArray(b)) data[attrName(a, taken)] = b;
        }
        if (id == null) id = String(nodes.length);
        if (data.name == null) data.name = data.label != null ? data.label : id;
        if (data.label === data.name) delete data.label;
        ids.set(id, true);
        nodes.push({ id, data, position: pos });
      }
      if (k === 'edge') {
        const data = {}, taken = taken0();
        let s = null, t = null;
        for (const [a, b] of v) {
          if (a === 'source') s = String(b);
          else if (a === 'target') t = String(b);
          else if (a === 'label') data.interaction = String(b);
          else if (!Array.isArray(b)) data[attrName(a, taken)] = b;
        }
        if (s != null && t != null) edges.push({ source: s, target: t, data });
      }
    }
    for (const e of edges) for (const id of [e.source, e.target]) if (!ids.has(id)) {
      ids.set(id, true);
      nodes.push({ id, data: { name: id } });
    }
    return { name: gname || name || 'network', directed, data: {}, nodes, edges };
  }

  /* ------------------------------------------------------------------
     Cytoscape JSON (.cyjs): Cytoscape's and Cytoscape.js's
     ------------------------------------------------------------------ */
  function parseCyjs(json, name) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    let els = d.elements || d;
    let N = [], E = [];
    if (Array.isArray(els)) {
      for (const el of els) ((el.group === 'edges' || (el.data && el.data.source != null && el.data.target != null)) ? E : N).push(el);
    } else {
      N = els.nodes || [];
      E = els.edges || [];
    }
    const clean = (data, keepName) => {
      const out = {}, taken = new Set(['name', 'interaction']);
      for (const [k, v] of Object.entries(data || {})) {
        if (k === 'id' || k === 'source' || k === 'target' || k === 'SUID' || k === 'selected' || k === 'shared_name' || k === 'shared_interaction' || k === 'parent') continue;
        if (k === 'name' || k === 'interaction') {
          if (keepName || k === 'interaction') out[k] = v;
          continue;
        }
        out[attrName(k, taken)] = v;
      }
      return out;
    };
    const nodes = N.map((el) => {
      const data = clean(el.data, true);
      const id = String(el.data.id);
      if (data.name == null) data.name = el.data.shared_name || el.data.label || id;
      return { id, data, position: el.position && isFinite(el.position.x) ? { x: +el.position.x, y: +el.position.y } : undefined };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = E.map((el) => ({ source: String(el.data.source), target: String(el.data.target), data: clean(el.data, false) }));
    for (const e of edges) for (const id of [e.source, e.target]) if (!ids.has(id)) {
      ids.add(id);
      nodes.push({ id, data: { name: id } });
    }
    const gd = Object.assign({}, d.data || {});
    delete gd.SUID;
    delete gd.selected;
    delete gd.__Annotations;
    const net = { name: gd.name || gd.shared_name || name || 'network', directed: !!(d.workbench && d.workbench.directed), data: gd, nodes, edges };
    if (d.workbench) net.workbench = d.workbench;
    return net;
  }
  /** → Cytoscape JSON: opens in Cytoscape (File → Import → Network from file) and in Cytoscape.js. The style of the
      workbench goes with it, under "workbench" (others leave it alone). */
  function writeCyjs(net, extra) {
    const nodes = net.nodes.map((n) => {
      const data = Object.assign({ id: String(n.id) }, n.data);
      if (data.name == null) data.name = String(n.id);
      data.shared_name = data.name;
      const el = { data };
      if (n.position) el.position = { x: +n.position.x.toFixed(3), y: +n.position.y.toFixed(3) };
      return el;
    });
    const named = new Map(net.nodes.map((n) => [n.id, String(n.data.name == null ? n.id : n.data.name)]));
    const edges = net.edges.map((e, i) => {
      const it = e.data.interaction || 'interacts with';
      const data = Object.assign({ id: e.id || 'e' + i, source: String(e.source), target: String(e.target) }, e.data);
      data.interaction = it;
      data.shared_interaction = it;
      data.name = data.shared_name = `${named.get(e.source)} (${it}) ${named.get(e.target)}`;
      return { data };
    });
    const out = { format_version: '1.0', generated_by: 'Bioinformatics workbench', target_cytoscapejs_version: '~3.0', data: Object.assign({ name: net.name, shared_name: net.name }, net.data || {}), elements: { nodes, edges } };
    if (extra) out.workbench = extra;
    return JSON.stringify(out, null, 1);
  }

  /* ------------------------------------------------------------------
     CX2 (NDEx 3): an array of aspects – attributeDeclarations, networkAttributes, nodes, edges …
     ------------------------------------------------------------------ */
  function parseCX2(json, name) {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) throw new Error('not a CX2 network (an array of aspects)');
    const aspect = (k) => [].concat(...arr.filter((a) => a && a[k]).map((a) => a[k]));
    const decl = (aspect('attributeDeclarations')[0]) || {};
    // values may use short aliases ("a") and defaults ("v")
    const expand = (kind, v) => {
      const D = decl[kind] || {};
      const alias = {};
      for (const [k, d] of Object.entries(D)) if (d && d.a) alias[d.a] = k;
      const out = {};
      for (const [k, d] of Object.entries(D)) if (d && d.v !== undefined) out[k] = d.v;
      for (const [k, x] of Object.entries(v || {})) out[alias[k] || k] = x;
      return out;
    };
    const tidy = (o, keepName) => {
      const out = {}, taken = new Set(['name', 'interaction']);
      for (const [k, v] of Object.entries(o)) {
        if (k === 'name' || k === 'interaction') {
          if (keepName || k === 'interaction') out[k] = v;
          continue;
        }
        out[attrName(k, taken)] = v;
      }
      return out;
    };
    const na = expand('networkAttributes', aspect('networkAttributes')[0] || {});
    const nodes = aspect('nodes').map((n) => {
      const data = tidy(expand('nodes', n.v), true);
      if (data.name == null) data.name = String(n.id);
      return { id: String(n.id), data, position: n.x != null && n.y != null ? { x: +n.x, y: +n.y } : undefined };
    });
    const edges = aspect('edges').map((e) => ({ source: String(e.s), target: String(e.t), data: tidy(expand('edges', e.v), false) }));
    const data = {};
    for (const [k, v] of Object.entries(na)) if (k !== 'name') data[attrName(k)] = v;
    return { name: na.name || name || 'network', directed: false, data, nodes, edges };
  }

  /* ------------------------------------------------------------------
     the answers of web services
     ------------------------------------------------------------------ */
  const STRING_CHANNELS = { score: 'score', nscore: 'neighborhood', fscore: 'fusion', pscore: 'cooccurrence', ascore: 'coexpression', escore: 'experiments', dscore: 'databases', tscore: 'textmining' };
  /** STRING: map – the answer of get_string_ids (queryItem → stringId, preferredName, annotation); edges – that of
      network; more – get_string_ids of nodes STRING added. Every node mapped is a node, with or without edges. */
  function fromSTRING(map, edges, opts = {}) {
    const nodes = new Map();
    const add = (sid, x) => {
      if (!nodes.has(sid)) nodes.set(sid, { id: sid, data: { name: x.preferredName || sid, stringId: sid } });
      const d = nodes.get(sid).data;
      if (x.annotation && d.description == null) d.description = String(x.annotation).replace(/;\s*$/, '');
      if (x.queryItem != null) {
        d.query = d.query ? `${d.query}|${x.queryItem}` : String(x.queryItem);
        d.queried = true;
      }
      if (x.taxonName && !d.species) d.species = x.taxonName;
      return d;
    };
    for (const x of map || []) add(x.stringId, x);
    for (const x of opts.more || []) add(x.stringId, Object.assign({}, x, { queryItem: null }));
    const out = [];
    const seen = new Set();
    for (const e of edges || []) {
      const a = e.stringId_A, b = e.stringId_B;
      const key = a < b ? a + '|' + b : b + '|' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const [sid, nm] of [[a, e.preferredName_A], [b, e.preferredName_B]]) if (!nodes.has(sid)) nodes.set(sid, { id: sid, data: { name: nm || sid, stringId: sid, queried: false } });
      const data = { interaction: 'string' };
      for (const [k, nm] of Object.entries(STRING_CHANNELS)) if (e[k] != null) data[nm] = +e[k];
      out.push({ source: a, target: b, data });
    }
    for (const n of nodes.values()) if (n.data.queried == null) n.data.queried = false;
    return { name: opts.name || 'STRING network', directed: false, data: opts.data || {}, nodes: Array.from(nodes.values()), edges: out };
  }

  /** IntAct (its web service: interactions/findInteractions): one edge for each pair of molecules, with the best MI
      score, the number of pieces of evidence, the detection methods and the PubMed IDs */
  function fromIntAct(content, opts = {}) {
    const nodes = new Map(), pairs = new Map();
    const node = (id, nm, desc, species, type) => {
      if (!nodes.has(id)) nodes.set(id, { id, data: { name: nm || id, uniprot: /^[OPQ][0-9][A-Z0-9]{3}[0-9]|^[A-NR-Z][0-9]/.test(id) ? id : null, description: desc || null, species: species || null, molecule: type || null } });
    };
    // (isoforms and chains of a protein – P04637-2, P04637-PRO_0000185703 – are the protein: one node)
    const canon = (id) => String(id || '').replace(/-(\d+|PRO_\d+)$/, '');
    for (const x of content || []) {
      const a = canon(x.uniqueIdA), b = canon(x.uniqueIdB);
      if (!a || !b || x.negative) continue;
      node(a, x.moleculeA, x.descriptionA, x.speciesA, x.typeA);
      node(b, x.moleculeB, x.descriptionB, x.speciesB, x.typeB);
      const key = a < b ? a + '|' + b : b + '|' + a;
      let p = pairs.get(key);
      if (!p) pairs.set(key, (p = { source: a, target: b, data: { interaction: x.type || 'interacts with', miscore: 0, evidence: 0, methods: new Set(), pubmed: new Set() } }));
      p.data.miscore = Math.max(p.data.miscore, Number(x.intactMiscore) || 0);
      p.data.evidence++;
      if (x.detectionMethod) p.data.methods.add(x.detectionMethod);
      if (x.publicationPubmedIdentifier) p.data.pubmed.add(String(x.publicationPubmedIdentifier));
    }
    const edges = Array.from(pairs.values()).map((e) => ({ source: e.source, target: e.target, data: Object.assign({}, e.data, { methods: Array.from(e.data.methods).join('; '), pubmed: Array.from(e.data.pubmed).join('; ') }) }));
    for (const n of nodes.values()) for (const k of Object.keys(n.data)) if (n.data[k] == null) delete n.data[k];
    return { name: opts.name || 'IntAct network', directed: false, data: opts.data || {}, nodes: Array.from(nodes.values()), edges };
  }

  /* ------------------------------------------------------------------
     which format a file is
     ------------------------------------------------------------------ */
  const NET_EXT = /\.(sif|graphml|xml|xgmml|gml|cyjs|cx2|json)$/i;
  /** name and text → the format: sif, graphml, xgmml, gml, cyjs, cx2, table – or null */
  function sniff(name, text) {
    const n = String(name || '').toLowerCase();
    const t = String(text || '').slice(0, 4000).replace(/^﻿/, '').trimStart();
    if (/\.sif$/.test(n)) return 'sif';
    if (/\.graphml$/.test(n) || /<graphml[\s>]/.test(t)) return 'graphml';
    if (/\.xgmml$/.test(n) || (/<graph[\s>]/.test(t) && /cytoscape|xgmml|<att\s/i.test(t))) return 'xgmml';
    if (/\.gml$/.test(n) || /^(creator\s+"[^"]*"\s+)?graph\s*\[/i.test(t)) return 'gml';
    if (/\.cx2$/.test(n) || /^\[\s*\{\s*"CXVersion"/.test(t)) return 'cx2';
    if (/\.cyjs$/.test(n) || (/^\{/.test(t) && /"elements"\s*:/.test(t))) return 'cyjs';
    if (/\.(csv|tsv|tab|txt)$/.test(n)) return 'table';
    return null;
  }
  /** a file's text → a network (tables of edges: the columns guessed – see guessEdgeColumns) */
  function parse(name, text, opts = {}) {
    const base = String(name || 'network').split('/').pop().replace(/\.(sif|graphml|xml|xgmml|gml|cyjs|cx2|json|csv|tsv|tab|txt)$/i, '');
    const fmt = opts.format || sniff(name, text);
    if (fmt === 'sif') return parseSIF(text, base);
    if (fmt === 'graphml') return parseGraphML(text, base);
    if (fmt === 'xgmml') return parseXGMML(text, base);
    if (fmt === 'gml') return parseGML(text, base);
    if (fmt === 'cyjs') return parseCyjs(text, base);
    if (fmt === 'cx2') return parseCX2(text, base);
    if (fmt === 'table') return fromEdgeTable(parseTable(text), opts.map || {}, base);
    throw new Error('this does not look like a network file (SIF, GraphML, XGMML, GML, Cytoscape JSON, CX2, or a table of edges)');
  }

  return { RESERVED, attrName, value, kindOf, separatorOf, parseTable, writeTable, guessEdgeColumns, fromEdgeTable, parseSIF, writeSIF, parseXML, parseGraphML, writeGraphML, parseXGMML, parseGML, parseCyjs, writeCyjs, parseCX2, fromSTRING, fromIntAct, NET_EXT, sniff, parse };
});
