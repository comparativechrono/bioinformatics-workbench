/* =====================================================================
   The Genome browser tab: igv.js (Broad Institute / UC San Diego, MIT
   licence).
   Genomes: the example reference of the workbench (the two CYP2C slices
   that the example reads come from, with its genes) – or a genome hosted
   by the IGV team (human hg38/hg19, mouse, zebrafish, fly, worm, yeast) –
   or any FASTA file of yours (with its .fai index).
   Tracks: BAM (+ .bai), VCF (+ .tbi), BED, GFF/GTF, bedGraph, wig and
   bigWig files from your files or your computer.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, bus, toast, store } = MG;

  const EX = '/data/examples';
  const HOSTED = [
    ['hg38', 'Human GRCh38 (hg38)'], ['hg19', 'Human GRCh37 (hg19)'], ['mm39', 'Mouse GRCm39 (mm39)'], ['mm10', 'Mouse GRCm38 (mm10)'],
    ['danRer11', 'Zebrafish (danRer11)'], ['dm6', 'Fruit fly (dm6)'], ['ce11', 'C. elegans (ce11)'], ['sacCer3', 'Yeast (sacCer3)']
  ];
  const TRACK = /\.(bam|cram|vcf|vcf\.gz|bcf|bed|bed\.gz|gff3?|gff3?\.gz|gtf|gtf\.gz|bedgraph|bedgraph\.gz|wig|bw|bigwig|bb|bigbed|seg)$/i;
  const abs = (u) => new URL(u, location.href).href;
  const LOAD_MS = 60000; // the longest a genome may take to load

  /* There is one igv.js browser at a time. It is made for a genome, and a change of genome makes a new one in place of
     the old one (igv.js can change the genome of a browser, but when that is under way while it is still drawing it
     can stop half-way). Making and changing go one at a time, in turn (see _serial); of several changes asked for
     while one is under way, only the last one is carried out. */
  class IGVPanel {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      this.browser = null;
      this.genomeId = store.get('igvGenome', 'examples');
      // the tracks shown on the genome (their configurations): if a change of genome fails, the genome that was shown
      // comes back with them
      this.tracks = [];
      this._queue = Promise.resolve();
      this._waiting = 0; // changes of genome asked for and not yet done
      this._latest = 0;
      this._local = null; // a genome from the computer (FASTA + .fai picked with "From my computer…")
      this._build();
      MG.app.igv = this;
      this.ensure().catch((e) => console.error(e));
    }
    _build() {
      this.root.classList.add('igv-root');
      this.genomeSel = h('select.igv-genome', { 'aria-label': 'Genome', title: 'The genome (reference sequence) to show' });
      this._fillGenomes();
      this.genomeSel.addEventListener('change', () => this.setGenome(this.genomeSel.value));
      const btn = (icon, label, title, fn) => {
        const b = h('button.btn.small', { type: 'button', title, html: MG.icon(icon) + '<span>' + esc(label) + '</span>' });
        b.addEventListener('click', fn);
        return b;
      };
      const pick = h('input', { type: 'file', multiple: true, hidden: true, accept: '.bam,.bai,.cram,.crai,.vcf,.gz,.tbi,.csi,.bed,.gff,.gff3,.gtf,.bedgraph,.wig,.bw,.bigwig,.bb,.fa,.fasta,.fna,.fai' });
      pick.addEventListener('change', () => {
        this.loadLocalFiles(Array.from(pick.files));
        pick.value = '';
      });
      this.bar = h(
        'div.igv-bar',
        h('label.igv-gl', h('span', 'Genome'), this.genomeSel),
        btn('folder', 'Add my files…', 'Show BAM, VCF, BED or GFF files from your files (the Files tab)', (e) => this.filesMenu(e.currentTarget)),
        btn('upload', 'From my computer…', 'Show files that are on your computer (they are not copied into your files)', () => pick.click()),
        h('span.grow'),
        btn('camera', 'Save image', 'Download the current view as a PNG picture', () => this.savePNG()),
        btn('help', '', 'Help for the genome browser', () => MG.app.showHelp && MG.app.showHelp('h-genome')),
        pick
      );
      this.host = h('div.igv-host');
      this.help = h('p.igv-help', { html: 'Type a gene or a position (chr10:96,541,616) in the box to go there; drag sideways to move; + / − to zoom. Click a read or a variant for details.' });
      this.root.append(this.bar, this.host, this.help);
    }
    _fillGenomes() {
      const S = this.genomeSel;
      S.innerHTML = '';
      S.appendChild(h('option', { value: 'examples' }, 'Example: CYP2C19 / CYP2C9 slices (the example reads)'));
      const og = h('optgroup', { label: 'Hosted by the IGV team (needs the internet)' });
      HOSTED.forEach(([id, label]) => og.appendChild(h('option', { value: id }, label)));
      S.appendChild(og);
      const mine = h('optgroup', { label: 'A FASTA file of yours' });
      for (const [p, e] of MG.app.fs.entries) {
        if (e.kind === 'dir' || !/\.(fa|fasta|fna)$/i.test(p) || !p.startsWith(MG.app.HOME + '/')) continue;
        mine.appendChild(h('option', { value: 'file:' + p }, MG.app.fs.pretty(p)));
      }
      if (this.genomeId && this.genomeId.startsWith('file:') && !Array.from(mine.children).some((o) => o.value === this.genomeId)) mine.appendChild(h('option', { value: this.genomeId }, MG.app.fs.pretty(this.genomeId.slice(5))));
      if (this.genomeId && this.genomeId.startsWith('local:')) mine.appendChild(h('option', { value: this.genomeId }, this.genomeId.slice(6) + ' (from your computer)'));
      mine.appendChild(h('option', { value: 'pick' }, 'Choose a FASTA file…'));
      S.appendChild(mine);
      S.value = this.genomeId;
      if (S.value !== this.genomeId) S.value = 'examples';
    }
    /** the igv.js configuration of a genome */
    async _genomeConfig(id) {
      if (id === 'examples') {
        return {
          reference: { id: 'cyp2c_slices', name: 'CYP2C19 / CYP2C9 slices of GRCh37 (example)', fastaURL: abs('data/examples/reads/reference.fa'), indexURL: abs('data/examples/reads/reference.fa.fai') },
          locus: 'human_CYP2C19:11,560-11,680',
          tracks: [{ name: 'Genes (Ensembl, GRCh37)', type: 'annotation', format: 'gff3', url: abs('data/examples/annotation/cyp2c_slices.gff3'), displayMode: 'EXPANDED', height: 120, order: 1e6 }]
        };
      }
      if (id.startsWith('file:')) {
        const fs = MG.app.fs;
        const p = id.slice(5);
        if (!fs.exists(p)) throw new Error(`${fs.pretty(p)} is not there any more.`);
        const fai = fs.get(p + '.fai');
        if (!fai) {
          // (the example data is read-only: the index can only be made next to a copy)
          const locked = fs.lockedDir && fs.lockedDir(MG.path.dirname(p));
          throw new Error(locked
            ? `The genome browser needs an index of the FASTA file, and the example data is read-only: copy it first –  cp ${fs.pretty(p)} ~/  – then run  samtools faidx ~/${MG.path.basename(p)}  in the Terminal and use the copy.`
            : `The genome browser needs an index of the FASTA file: run  samtools faidx ${fs.pretty(p)}  in the Terminal first.`);
        }
        return { reference: { id: 'my_' + MG.path.basename(p), name: fs.pretty(p), fastaURL: await this._urlOf(fs, p), indexURL: await this._urlOf(fs, p + '.fai') } };
      }
      if (id.startsWith('local:')) {
        if (this._local && this._local.id === id) return { reference: this._local.reference };
        throw new Error('That genome came from your computer: choose its FASTA file and its .fai again with “From my computer…”.');
      }
      return { genome: id };
    }
    /** fn runs when what was asked before it has finished (making the browser, changing the genome) */
    _serial(fn) {
      const run = this._queue.then(fn, fn);
      this._queue = run.catch(() => {});
      return run;
    }
    /** the igv.js browser – made the first time it is needed; after a change of genome, the new one */
    async ensure() {
      if (this.browser && !this._waiting) return this.browser;
      return this._serial(async () => {
        if (!this.browser) await this._show(this.genomeId);
        if (!this.browser) throw new Error('The genome browser could not start.');
        return this.browser;
      });
    }
    /** change the genome: a new browser shows it, in place of the old one (the tracks of the old genome go). If the
        genome cannot be loaded, the one that was shown comes back, with its tracks. → true: changed */
    async setGenome(id) {
      if (id === 'pick') {
        this.genomeSel.value = this.genomeId;
        const fastas = Array.from(MG.app.fs.entries).filter(([p, e]) => e.kind !== 'dir' && /\.(fa|fasta|fna)$/i.test(p)).map(([p]) => p);
        if (!fastas.length) {
          toast('There are no FASTA files among your files yet (upload one, or copy /data/examples/reads/reference.fa).', 'warn', 7000);
          return false;
        }
        MG.popmenu(this.genomeSel, fastas.slice(0, 30).map((p) => ['dna', MG.app.fs.pretty(p), () => this.setGenome('file:' + p)]));
        return false;
      }
      const ticket = ++this._latest;
      this._wanted = id;
      this._waiting++;
      try {
        return await this._serial(async () => {
          // (a later choice has been made in the meantime: that one counts)
          if (ticket !== this._latest) return false;
          if (this.browser && id === this.genomeId) return true;
          return this._show(id);
        });
      } finally {
        this._waiting--;
      }
    }
    /** make the browser for the genome id. When that fails: the genome that was shown before, with its tracks – or, if
        there was none, the example genome. → true: id is shown */
    async _show(id) {
      if (typeof window.igv === 'undefined') {
        this._failed(new Error('igv.js did not load. Reload the page to try again.'));
        return false;
      }
      const before = this.browser ? { id: this.genomeId, tracks: this.tracks.slice() } : null;
      let g;
      try {
        g = await this._genomeConfig(id);
      } catch (e) {
        toast(esc(e.message), 'warn', 9000);
        if (before) {
          this._fillGenomes();
          return false;
        }
        id = 'examples';
        g = await this._genomeConfig(id);
      }
      try {
        await this._make(g);
        this._settle(id);
        return true;
      } catch (e) {
        console.error(e);
        const back = before ? before.id : id !== 'examples' ? 'examples' : null;
        const name = (x) => (x === 'examples' ? 'the example genome' : (HOSTED.find(([k]) => k === x) || [x, x.replace(/^(file|local):/, '')])[1]);
        toast(`That genome could not be loaded: ${esc(e.message || e)}${g.genome ? ' (the hosted genomes need the internet)' : ''}.${back ? ` The genome browser shows ${esc(name(back))} again.` : ''}`, 'error', 9000);
        if (!back) {
          this._failed(e);
          return false;
        }
        try {
          await this._make(await this._genomeConfig(back));
          for (const t of before ? before.tracks : []) await this._loadTrack(t).catch(() => {});
          this._settle(back);
        } catch (e2) {
          console.error(e2);
          this._failed(e2);
        }
        return false;
      }
    }
    /** a new browser for the genome configuration g (see _genomeConfig), in place of whatever was there. Its own tracks
        (the genes of the example genome) are added afterwards: one that cannot be loaded does not take the browser
        with it. */
    async _make(g) {
      this._dispose();
      const cfg = Object.assign({ showSVGButton: false, showCenterGuide: true, showCursorGuide: false, showNavigation: true, showTrackLabelButton: true }, g.genome ? { genome: g.genome } : { reference: g.reference });
      if (g.locus) cfg.locus = g.locus;
      let b;
      try {
        // (a download that never ends – a network that holds the request – must not hold up the tab for good)
        let timer;
        const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('it took more than a minute')), LOAD_MS)));
        try {
          b = await Promise.race([window.igv.createBrowser(this.host, cfg), late]);
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        // (igv.js may have drawn part of a browser before it failed: it goes too)
        this._dispose();
        throw e;
      }
      this.browser = b;
      this.tracks = [];
      b.on('locuschange', (ref) => bus.emit('igv:locus', { locus: Array.isArray(ref) ? ref[0] && ref[0].locusSearchString : '' }));
      b.on('trackclick', (track, data) => {
        bus.emit('igv:click', { track: track && track.name, data });
        return undefined; // keep the default popup
      });
      // (a track that the user removes is not brought back with the genome – see _show)
      b.on('trackremoved', (tracks) => {
        const gone = new Set((tracks || []).map((t) => t && t.name));
        this.tracks = this.tracks.filter((t) => !gone.has(t.name));
      });
      for (const t of g.tracks || []) {
        try {
          await b.loadTrack(t);
        } catch (e) {
          console.error(e);
          toast(`The track <b>${esc(t.name)}</b> could not be loaded: ${esc(e.message || e)}`, 'warn', 8000);
        }
      }
      return b;
    }
    /** no browser: every igv.js browser of the page goes (there is only this one), and the element it was drawn in is
        replaced by a fresh one – nothing that igv.js drew can stay behind */
    _dispose() {
      try {
        if (window.igv && window.igv.removeAllBrowsers) window.igv.removeAllBrowsers();
      } catch (e) {
        console.error(e);
      }
      this.browser = null;
      this.tracks = [];
      const fresh = h('div.igv-host');
      this.host.replaceWith(fresh);
      this.host = fresh;
    }
    /** the browser could not be made: say so where it would be, with a way to try again */
    _failed(e) {
      this._dispose();
      const again = h('button.btn', { type: 'button' }, 'Try again');
      again.addEventListener('click', () => this.ensure().catch((x) => console.error(x)));
      this.host.appendChild(h('div.ex-empty', h('h3', 'The genome browser could not start'), h('p', (e && e.message) || String(e)), again));
    }
    /** the genome id is shown: remember it (a genome picked from the computer cannot come back after a reload) */
    _settle(id) {
      this.genomeId = id;
      store.set('igvGenome', id.startsWith('local:') ? 'examples' : id);
      this._fillGenomes();
      bus.emit('igv:genome', { id });
    }
    /** → true: the genome is shown and the place found */
    async goto(locus, genome) {
      // (a place on the example genome – human_CYP2C19:…, human_CYP2C9:… – while another genome is shown: that one first)
      if (!genome && /^human_CYP2C(19|9)\b/.test(String(locus).trim())) genome = 'examples';
      // (compared with the genome asked for last: a change may be under way)
      const shown = this._waiting ? this._wanted : this.genomeId;
      if (genome && genome !== shown && !(await this.setGenome(genome))) return false;
      const b = await this.ensure();
      await b.search(locus);
      bus.emit('igv:goto', { locus });
      return true;
    }
    async _loadTrack(cfg) {
      const b = this.browser;
      const old = b.trackViews && b.trackViews.find((tv) => tv.track && tv.track.name === cfg.name);
      if (old) b.removeTrack(old.track);
      const t = await b.loadTrack(Object.assign({ removable: true }, cfg));
      this.tracks = this.tracks.filter((x) => x.name !== cfg.name).concat([cfg]);
      return t;
    }
    async addTrack(cfg) {
      await this.ensure();
      const t = await this._loadTrack(cfg);
      bus.emit('igv:track', { name: cfg.name, type: cfg.type, format: cfg.format });
      return t;
    }
    /** a menu of the files that can be shown */
    filesMenu(anchor) {
      const fs = MG.app.fs;
      const files = Array.from(fs.entries)
        .filter(([p, e]) => e.kind !== 'dir' && TRACK.test(p) && (p.startsWith(MG.app.HOME + '/') || p.startsWith(EX + '/')))
        .sort((a, b) => (b[1].mtime || 0) - (a[1].mtime || 0))
        .map(([p]) => p);
      if (!files.length) return toast('No BAM, VCF, BED or GFF files among your files yet.', 'warn');
      MG.popmenu(anchor, files.slice(0, 40).map((p) => [/\.(bam|cram)$/i.test(p) ? 'layers' : /vcf|bcf/i.test(p) ? 'tag' : 'genome', fs.pretty(p), () => this.loadPaths(fs, [p])]));
    }
    /** files of the workbench → tracks */
    async loadPaths(fs, paths) {
      await this.ensure();
      for (const p0 of paths) {
        const p = fs.resolve(p0);
        const e = fs.get(p);
        if (!e) {
          toast(`${esc(p0)}: no such file`, 'error');
          continue;
        }
        const name = MG.path.basename(p);
        try {
          if (/\.(bam|cram)$/i.test(name)) {
            const ext = /\.cram$/i.test(name) ? '.crai' : '.bai';
            const ip = [p + ext, p.replace(/\.(bam|cram)$/i, ext)].find((x) => fs.exists(x));
            if (!ip) {
              toast(`The genome browser needs the index <b>${esc(name)}${ext}</b> – run <code>samtools index ${esc(fs.pretty(p))}</code> in the Terminal first.`, 'warn', 9000);
              continue;
            }
            await this.addTrack({ type: 'alignment', format: /\.cram$/i.test(name) ? 'cram' : 'bam', name, url: await this._urlOf(fs, p), indexURL: await this._urlOf(fs, ip), height: 360, colorBy: 'strand', displayMode: 'EXPANDED' });
          } else if (/\.(vcf|vcf\.gz|bcf)$/i.test(name)) {
            if (/\.bcf$/i.test(name)) {
              toast('The genome browser reads VCF, not BCF: convert it with  bcftools view -Oz -o FILE.vcf.gz FILE.bcf', 'warn', 8000);
              continue;
            }
            const cfg = { type: 'variant', format: 'vcf', name, url: await this._urlOf(fs, p), displayMode: 'EXPANDED', height: 80 };
            if (/\.gz$/i.test(name)) {
              const ip = [p + '.tbi', p + '.csi'].find((x) => fs.exists(x));
              if (ip) cfg.indexURL = await this._urlOf(fs, ip);
              else cfg.indexed = false;
            }
            await this.addTrack(cfg);
          } else if (/\.(bw|bigwig)$/i.test(name)) await this.addTrack({ type: 'wig', format: 'bigwig', name, url: await this._urlOf(fs, p) });
          else if (/\.(bb|bigbed)$/i.test(name)) await this.addTrack({ type: 'annotation', format: 'bigbed', name, url: await this._urlOf(fs, p) });
          else if (/\.(bedgraph|wig)(\.gz)?$/i.test(name)) await this.addTrack({ type: 'wig', format: /wig/i.test(name) && !/bedgraph/i.test(name) ? 'wig' : 'bedgraph', name, url: await this._urlOf(fs, p) });
          else if (/\.seg$/i.test(name)) await this.addTrack({ type: 'seg', format: 'seg', name, url: await this._urlOf(fs, p) });
          else {
            const fmt = /\.gtf(\.gz)?$/i.test(name) ? 'gtf' : /\.gff3?(\.gz)?$/i.test(name) ? 'gff3' : 'bed';
            await this.addTrack({ type: 'annotation', format: fmt, name, url: await this._urlOf(fs, p), displayMode: 'EXPANDED', indexed: false });
          }
        } catch (err) {
          console.error(err);
          toast(`${esc(name)} could not be shown: ${esc(err.message || err)}. Do its chromosome names match the genome (${esc(this.genomeSel.selectedOptions[0] ? this.genomeSel.selectedOptions[0].textContent : this.genomeId)})?`, 'error', 9000);
        }
      }
    }
    async loadGenomeFromFiles(fs, p) {
      await this.setGenome('file:' + fs.resolve(p));
    }
    async _urlOf(fs, p) {
      const e = fs.get(p);
      if (e.kind === 'url') return abs(e.url);
      if (e.kind === 'blob') return e.blob instanceof File ? e.blob : new File([e.blob], MG.path.basename(p));
      const blob = await fs.toBlob(p);
      return new File([blob], MG.path.basename(fs.resolve(p)));
    }
    /** files picked from the computer */
    async loadLocalFiles(files) {
      const byName = (n) => files.find((f) => f.name === n);
      let n = 0;
      // a FASTA file (with its .fai) is the genome: it comes first – a change of genome removes the tracks shown
      const fasta = files.find((f) => /\.(fa|fasta|fna)$/i.test(f.name) && byName(f.name + '.fai'));
      if (fasta) {
        this._local = { id: 'local:' + fasta.name, reference: { id: fasta.name, name: fasta.name, fastaURL: fasta, indexURL: byName(fasta.name + '.fai') } };
        if (await this.setGenome(this._local.id)) n++;
      }
      await this.ensure();
      for (const f of files) {
        if (f === fasta) continue;
        if (/\.(bam|cram)$/i.test(f.name)) {
          const idx = byName(f.name + '.bai') || byName(f.name.replace(/\.bam$/i, '.bai')) || byName(f.name + '.crai');
          if (!idx) {
            toast(`Choose the index <b>${esc(f.name)}.bai</b> together with ${esc(f.name)} (hold Ctrl or ⌘ to pick both).`, 'warn', 8000);
            continue;
          }
          await this.addTrack({ type: 'alignment', format: /\.cram$/i.test(f.name) ? 'cram' : 'bam', name: f.name, url: f, indexURL: idx, height: 360, colorBy: 'strand', displayMode: 'EXPANDED' });
          n++;
        } else if (/\.vcf(\.gz)?$/i.test(f.name)) {
          const idx = byName(f.name + '.tbi') || byName(f.name + '.csi');
          const cfg = { type: 'variant', format: 'vcf', name: f.name, url: f, displayMode: 'EXPANDED' };
          if (idx) cfg.indexURL = idx;
          else cfg.indexed = false;
          await this.addTrack(cfg);
          n++;
        } else if (/\.(bed|gff3?|gtf|bedgraph|wig|bw|bigwig|bb)(\.gz)?$/i.test(f.name)) {
          const fmt = /\.gtf/i.test(f.name) ? 'gtf' : /\.gff/i.test(f.name) ? 'gff3' : /\.(bw|bigwig)$/i.test(f.name) ? 'bigwig' : /\.bb$/i.test(f.name) ? 'bigbed' : /bedgraph/i.test(f.name) ? 'bedgraph' : /\.wig/i.test(f.name) ? 'wig' : 'bed';
          await this.addTrack({ type: /wig|bedgraph/.test(fmt) ? 'wig' : 'annotation', format: fmt, name: f.name, url: f, indexed: false });
          n++;
        } else if (/\.(fa|fasta|fna)$/i.test(f.name)) {
          // (one with its .fai is the genome already – see above; there is one genome at a time)
          toast(byName(f.name + '.fai') ? `One genome at a time: ${esc(fasta.name)} is shown, not ${esc(f.name)}.` : `To use ${esc(f.name)} as the genome, choose its index ${esc(f.name)}.fai too (samtools faidx makes it).`, 'warn', 8000);
        }
      }
      if (!n) toast('Choose a .bam file with its .bai, a .vcf(.gz), .bed or .gff file – or a FASTA file with its .fai to use as the genome.', 'warn', 8000);
    }
    async savePNG() {
      try {
        const b = await this.ensure();
        const svg = await b.toSVG();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = url;
        });
        const scale = 2;
        const c = document.createElement('canvas');
        c.width = img.width * scale;
        c.height = img.height * scale;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        c.toBlob((png) => {
          MG.downloadBlob(png, 'igv-' + (b.currentLoci ? String(b.currentLoci()).replace(/[^A-Za-z0-9]+/g, '_') : 'view') + '.png');
          bus.emit('igv:image', {});
        });
      } catch (e) {
        console.error(e);
        toast('Could not make the picture: ' + esc(e.message || e), 'error');
      }
    }
    shown() {
      this._fillGenomes();
    }
  }

  MG.IGVPanel = IGVPanel;
  MG.app = MG.app || {};
  /** go to a place (optionally on another genome): opens the tab */
  MG.app.igvGoto = async (locus, genome) => {
    await MG.app.showWorkbench('igv');
    for (let i = 0; i < 300 && !MG.app.igv; i++) await new Promise((r) => setTimeout(r, 50));
    if (MG.app.igv) await MG.app.igv.goto(locus, genome);
  };
  /** use a FASTA file of the workbench as the genome */
  MG.app.igvGenome = async (path) => {
    await MG.app.showWorkbench('igv');
    for (let i = 0; i < 300 && !MG.app.igv; i++) await new Promise((r) => setTimeout(r, 50));
    if (MG.app.igv) await MG.app.igv.loadGenomeFromFiles(MG.app.fs, path);
  };
})();
