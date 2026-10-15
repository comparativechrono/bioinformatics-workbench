/* =====================================================================
   The data viewer: what View(x) shows – a table of a data frame that can
   be sorted (click a column's name), searched and filtered (a filter for
   each column), as RStudio's data viewer does. Only the rows in view are
   drawn, so that a table of 100,000 rows scrolls as easily as one of 10.

   new MG.DataGrid(root, data, opts)
     data   {title, nrow, ncol, shown, rownames, labels, columns: [{name, type, values}]} – see rsession.js (_view)
     opts   {filters: true (a filter row, as RStudio's Filter button), onCode(code): show code for what is done}
            For Spyder's viewers (data frames and arrays of Python): flavour: 'py' (missing values are nan or
            None, True and False), fmt(v) (how numbers are written), typeLabel(column) (under each name),
            colour: true (cells coloured by their value, from the column's smallest to its largest), bar: false
            (no search and no Filter button), rowLabel (the name of the index column)
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc } = MG;
  const ROW = 24; // px: the height of a row (dataview CSS: .dg-row)
  const ABBR = { numeric: 'dbl', double: 'dbl', integer: 'int', character: 'chr', factor: 'fct', ordered: 'ord', logical: 'lgl', Date: 'date', POSIXct: 'dttm', difftime: 'drtn', list: 'list', complex: 'cpl' };
  const isNA = (v) => v == null || (typeof v === 'number' && Number.isNaN(v));
  const numeric = (t) => /^(numeric|double|integer|difftime)$/.test(t);

  /** a number as R shows it in a data viewer: up to 7 significant digits, no trailing zeros */
  function fmtNum(v) {
    if (isNA(v)) return 'NA';
    if (v === Infinity) return 'Inf';
    if (v === -Infinity) return '-Inf';
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-4 || a >= 1e15)) return v.toExponential(6).replace(/\.?0+e/, 'e');
    return String(Number(v.toPrecision(7)));
  }

  class DataGrid {
    constructor(root, data, opts = {}) {
      this.root = root;
      this.opts = opts;
      this.data = data;
      this.cols = data.columns || [];
      this.n = this.cols.length ? this.cols[0].values.length : 0;
      this.order = null; // row indices after sort and filter
      this.sort = null; // {col, dir}
      this.filters = {};
      this.search = '';
      this.showFilters = !!opts.filters;
      this.py = opts.flavour === 'py';
      if (opts.colour) this._ranges();
      this._build();
      this._apply();
    }
    /** a missing value, as R or Python writes it */
    _na(c) {
      return this.py ? (numeric(c.type) ? 'nan' : 'None') : 'NA';
    }
    _num(v) {
      return this.opts.fmt ? this.opts.fmt(v) : fmtNum(v);
    }
    _bool(v) {
      return this.py ? (v ? 'True' : 'False') : v ? 'TRUE' : 'FALSE';
    }
    /** the smallest and largest value of each column of numbers (for the colours) */
    _ranges() {
      this.ranges = this.cols.map((c) => {
        if (!numeric(c.type)) return null;
        let lo = Infinity, hi = -Infinity;
        for (const v of c.values) {
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        return lo <= hi ? { lo, hi } : null;
      });
    }
    /** a cell's colour: blue for the column's largest values, through green and yellow, to red for its smallest (as
        Spyder colours its arrays and data frames) */
    _bg(j, v) {
      const r = this.ranges && this.ranges[j];
      if (!r || typeof v !== 'number' || !Number.isFinite(v)) return '';
      const f = r.hi === r.lo ? 1 : (r.hi - v) / (r.hi - r.lo);
      return `background:hsla(${Math.round((0.66 + 0.33 * f) * 360)},100%,65%,0.55)`;
    }
    _build() {
      const R = this.root;
      R.classList.add('dg');
      this.searchEl = h('input.dg-search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search the table', spellcheck: 'false' });
      this.searchEl.addEventListener('input', MG.debounce(() => {
        this.search = this.searchEl.value.trim().toLowerCase();
        this._apply();
      }, 150));
      this.filterBtn = h('button.dg-btn', { type: 'button', title: 'Filter the rows by the values of a column', html: MG.icon('filter') + '<span>Filter</span>' });
      this.filterBtn.addEventListener('click', () => {
        this.showFilters = !this.showFilters;
        if (!this.showFilters) this.filters = {};
        this._head();
        this._apply();
      });
      this.info = h('span.dg-info');
      this.bar = h('div.dg-bar', this.filterBtn, h('span.grow'), this.info, this.searchEl);
      if (this.opts.bar === false) this.bar.hidden = true;
      this.headEl = h('div.dg-head');
      this.spacer = h('div.dg-spacer');
      this.rowsEl = h('div.dg-rows');
      this.scroll = h('div.dg-scroll', { tabindex: '0', role: 'grid', 'aria-label': this.data.title || 'Data' }, this.headEl, h('div.dg-bodywrap', this.spacer, this.rowsEl));
      this.scroll.addEventListener('scroll', () => this._draw());
      R.append(this.bar, this.scroll);
      if (this.data.shown < this.data.nrow) R.appendChild(h('div.dg-note', `The first ${this.data.shown.toLocaleString('en-GB')} of ${this.data.nrow.toLocaleString('en-GB')} rows are shown.`));
      this._widths();
      this._head();
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this._draw());
        this._ro.observe(this.scroll);
      }
    }
    /** the width of each column, from its name and its first values */
    _widths() {
      const ch = 7.4; // px per character of the table's font
      const rn = this.data.rownames ? this.data.rownames.slice(0, 200).reduce((m, x) => Math.max(m, String(x).length), 3) : String(this.n).length;
      this.rnW = Math.min(240, Math.max(36, Math.round(rn * ch + 18)));
      this.widths = this.cols.map((c) => {
        let w = Math.max(String(c.name).length + 6, 5);
        const vs = c.values;
        for (let i = 0; i < Math.min(vs.length, 300); i++) {
          const s = numeric(c.type) ? (isNA(vs[i]) ? this._na(c) : this._num(vs[i])) : isNA(vs[i]) ? this._na(c) : String(vs[i]);
          if (s.length > w) w = s.length;
        }
        return Math.min(360, Math.max(64, Math.round(w * ch + 20)));
      });
      this.totalW = this.rnW + this.widths.reduce((a, b) => a + b, 0);
    }
    _head() {
      const H = this.headEl;
      H.innerHTML = '';
      H.style.width = this.totalW + 'px';
      const row = h('div.dg-hrow');
      row.appendChild(h('div.dg-cell.dg-rn', { style: { width: this.rnW + 'px' } }, this.opts.rowLabel || ''));
      this.cols.forEach((c, j) => {
        const label = this.data.labels && this.data.labels[j] ? this.data.labels[j] : '';
        const s = this.sort && this.sort.col === j ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : '';
        const tl = this.opts.typeLabel ? this.opts.typeLabel(c) : ABBR[c.type] || c.type;
        const b = h('button.dg-hcell', { type: 'button', style: { width: this.widths[j] + 'px' }, title: (label ? label + '\n' : '') + `${c.name} (${tl}) – click to sort` }, h('span.dg-hname', String(c.name)), tl ? h('span.dg-htype', tl) : null, s ? h('span.dg-hsort', s) : null);
        b.addEventListener('click', () => this._sortBy(j));
        row.appendChild(b);
      });
      H.appendChild(row);
      if (this.showFilters) {
        const fr = h('div.dg-frow');
        fr.appendChild(h('div.dg-cell.dg-rn', { style: { width: this.rnW + 'px' } }, ''));
        this.cols.forEach((c, j) => {
          const inp = h('input.dg-filter', { type: 'text', value: this.filters[j] || '', placeholder: numeric(c.type) ? 'e.g. 3-5, >40' : 'contains…', 'aria-label': 'Filter ' + c.name, style: { width: this.widths[j] - 6 + 'px' } });
          inp.addEventListener('input', MG.debounce(() => {
            if (inp.value.trim()) this.filters[j] = inp.value.trim();
            else delete this.filters[j];
            this._apply();
          }, 200));
          fr.appendChild(h('div.dg-cell', { style: { width: this.widths[j] + 'px' } }, inp));
        });
        H.appendChild(fr);
      }
      this.filterBtn.classList.toggle('on', this.showFilters);
    }
    _sortBy(j) {
      if (!this.sort || this.sort.col !== j) this.sort = { col: j, dir: 1 };
      else if (this.sort.dir === 1) this.sort.dir = -1;
      else this.sort = null;
      this._head();
      this._apply();
    }
    _match(j, i) {
      const f = this.filters[j];
      const v = this.cols[j].values[i];
      if (numeric(this.cols[j].type)) {
        if (isNA(v)) return /^na$/i.test(f);
        let m = /^\s*(-?[\d.e+]+)\s*[-–:]\s*(-?[\d.e+]+)\s*$/i.exec(f);
        if (m) return v >= Number(m[1]) && v <= Number(m[2]);
        m = /^\s*(<=|>=|<|>|=|==)\s*(-?[\d.e+]+)\s*$/.exec(f);
        if (m) {
          const x = Number(m[2]);
          return m[1] === '<' ? v < x : m[1] === '>' ? v > x : m[1] === '<=' ? v <= x : m[1] === '>=' ? v >= x : v === x;
        }
        return this._num(v).includes(f);
      }
      if (isNA(v)) return /^na$/i.test(f);
      return String(v).toLowerCase().includes(f.toLowerCase());
    }
    _apply() {
      let idx = [];
      const fs = Object.keys(this.filters).map(Number);
      const q = this.search;
      for (let i = 0; i < this.n; i++) {
        if (fs.length && !fs.every((j) => this._match(j, i))) continue;
        if (q) {
          let hit = this.data.rownames && String(this.data.rownames[i]).toLowerCase().includes(q);
          for (let j = 0; !hit && j < this.cols.length; j++) {
            const v = this.cols[j].values[i];
            if (!isNA(v) && (numeric(this.cols[j].type) ? this._num(v) : String(v)).toLowerCase().includes(q)) hit = true;
          }
          if (!hit) continue;
        }
        idx.push(i);
      }
      if (this.sort) {
        const vs = this.cols[this.sort.col].values, d = this.sort.dir, num = numeric(this.cols[this.sort.col].type);
        // (missing values last, as R's order() puts them; the rest in order, ties as they were)
        idx.sort((a, b) => {
          const x = vs[a], y = vs[b];
          if (isNA(x) || isNA(y)) return isNA(x) && isNA(y) ? a - b : isNA(x) ? 1 : -1;
          const c = num ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
          return c ? c * d : a - b;
        });
      }
      this.order = idx;
      const total = this.data.nrow, cols = this.data.ncol;
      const shown = idx.length;
      const filtered = shown !== this.n ? ` (filtered from ${this.n.toLocaleString('en-GB')} total entries)` : '';
      this.info.textContent = shown ? `Showing ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} entries${filtered}, ${cols} total column${cols === 1 ? '' : 's'}` : `No matching entries${filtered}`;
      this.spacer.style.height = shown * ROW + 'px';
      this.spacer.style.width = this.totalW + 'px';
      this._first = -1;
      this._draw(true);
    }
    _draw(force) {
      const top = this.scroll.scrollTop;
      const hh = this.headEl.offsetHeight || 0;
      const first = Math.max(0, Math.floor((top - hh) / ROW) - 10);
      const visible = Math.ceil((this.scroll.clientHeight || 600) / ROW) + 20;
      if (!force && first === this._first && visible === this._vis) return;
      this._first = first;
      this._vis = visible;
      const out = [];
      const end = Math.min(this.order.length, first + visible);
      for (let k = first; k < end; k++) {
        const i = this.order[k];
        let cells = `<div class="dg-cell dg-rn" style="width:${this.rnW}px">${esc(this.data.rownames ? this.data.rownames[i] : i + 1)}</div>`;
        this.cols.forEach((c, j) => {
          const v = c.values[i];
          const num = numeric(c.type);
          const txt = isNA(v) ? `<i class="dg-na">${this._na(c)}</i>` : esc(num ? this._num(v) : c.type === 'logical' ? this._bool(v) : String(v));
          const bg = this.ranges ? this._bg(j, v) : '';
          cells += `<div class="dg-cell${num ? ' num' : ''}" style="width:${this.widths[j]}px${bg ? ';' + bg : ''}">${txt}</div>`;
        });
        out.push(`<div class="dg-row${k % 2 ? ' odd' : ''}" role="row" style="top:${k * ROW}px;width:${this.totalW}px">${cells}</div>`);
      }
      this.rowsEl.innerHTML = out.join('');
    }
    destroy() {
      if (this._ro) this._ro.disconnect();
      this.root.innerHTML = '';
    }
  }

  MG.DataGrid = DataGrid;
  MG.fmtNum = fmtNum;
})();
