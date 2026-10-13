/* =====================================================================
   Network analysis for the Networks tab. Pure functions on a graph of
   n nodes (0 … n-1) and a list of edges, with nothing of the page in
   them, so that they run in a worker (net-worker.js), in the page and
   in Node (the tests compare them with networkx).

   Every analysis treats the network as undirected. Several edges
   between the same two nodes count as one (with the weight of the last
   of them); self-loops are counted, and otherwise left out.

     graph(n, edges)            the graph the functions below use
     components                 connected components
     paths                      every shortest path (Brandes 2001): distances, betweenness, stress, edge
                                betweenness, bottlenecks, the distribution of path lengths
     networkAnalyzer            the node, edge and network statistics of Cytoscape's Analyzer
                                (NetworkAnalyzer: Assenov et al. 2008, Doncheva et al. 2012)
     hubs                       the 12 rankings of cytoHubba (Chin et al. 2014)
     mcode                      MCODE (Bader & Hogue 2003), as clusterMaker2 runs it
     mcl                        Markov clustering (van Dongen 2000), as the Python package markov_clustering runs it
     louvain                    Louvain communities (Blondel et al. 2008), as networkx runs them
     coreNumber, maximalCliques, clustering, shortestPath, enrichment (hypergeometric, Benjamini–Hochberg)
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MG = root.MG || {};
    root.MG.netAlgo = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------
     the graph
     ------------------------------------------------------------------ */
  /** n nodes and edges [[s, t, w], …] (w optional: 1) →
      adj[v]    the neighbours of v, each once, in the order of the edges (v itself is not among them)
      off, nbr, pid  the same as flat arrays: the neighbours of v are nbr[off[v] … off[v+1]-1], and pid[i] is the
                     index of the pair of nodes of that entry in pairs
      pairs     [[a, b, w]] each pair of nodes joined by an edge (a < b), with the weight of its last edge
      count     the number of edges of each pair; loops[v] the self-loops of v; edges[v] the edges at v (a
                self-loop once) */
  function graph(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    const index = new Map();
    const pairs = [], count = [];
    const loops = new Int32Array(n), deg = new Int32Array(n);
    for (const e of edges) {
      const s = e[0], t = e[1];
      const w = e.length > 2 && e[2] != null && isFinite(e[2]) ? +e[2] : 1;
      if (s < 0 || t < 0 || s >= n || t >= n) continue;
      deg[s]++;
      if (s === t) {
        loops[s]++;
        continue;
      }
      deg[t]++;
      const a = s < t ? s : t, b = s < t ? t : s, key = a * n + b;
      let p = index.get(key);
      if (p === undefined) {
        p = pairs.length;
        index.set(key, p);
        pairs.push([a, b, w]);
        count.push(1);
        adj[s].push(t);
        adj[t].push(s);
      } else {
        pairs[p][2] = w;
        count[p]++;
      }
    }
    const off = new Int32Array(n + 1);
    for (let v = 0; v < n; v++) off[v + 1] = off[v] + adj[v].length;
    const nbr = new Int32Array(off[n]), pid = new Int32Array(off[n]);
    for (let v = 0; v < n; v++) {
      const a = adj[v];
      for (let i = 0; i < a.length; i++) {
        nbr[off[v] + i] = a[i];
        const x = v < a[i] ? v : a[i], y = v < a[i] ? a[i] : v;
        pid[off[v] + i] = index.get(x * n + y);
      }
    }
    return { n, adj, off, nbr, pid, pairs, count, loops, edges: deg, pairOf: (s, t) => index.get((s < t ? s : t) * n + (s < t ? t : s)) };
  }

  /** a random number generator that gives the same numbers for the same seed (mulberry32) */
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------
     components, cores, cliques, clustering
     ------------------------------------------------------------------ */
  /** → {comp: the component of each node (0 = the first met), sizes, count} */
  function components(G) {
    const { n, off, nbr } = G;
    const comp = new Int32Array(n).fill(-1), q = new Int32Array(n), sizes = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const c = sizes.length;
      let head = 0, tail = 0;
      q[tail++] = s;
      comp[s] = c;
      while (head < tail) {
        const v = q[head++];
        for (let i = off[v]; i < off[v + 1]; i++) {
          const w = nbr[i];
          if (comp[w] < 0) {
            comp[w] = c;
            q[tail++] = w;
          }
        }
      }
      sizes.push(tail);
    }
    return { comp, sizes, count: sizes.length };
  }

  /** the core number of each node: the largest k of a k-core that holds it (Batagelj & Zaversnik 2003) */
  function coreNumber(G) {
    const { n, adj } = G;
    const deg = new Int32Array(n);
    let md = 0;
    for (let v = 0; v < n; v++) md = Math.max(md, (deg[v] = adj[v].length));
    const bin = new Int32Array(md + 1), pos = new Int32Array(n), vert = new Int32Array(n);
    for (let v = 0; v < n; v++) bin[deg[v]]++;
    for (let d = 0, start = 0; d <= md; d++) {
      const num = bin[d];
      bin[d] = start;
      start += num;
    }
    for (let v = 0; v < n; v++) {
      pos[v] = bin[deg[v]];
      vert[pos[v]] = v;
      bin[deg[v]]++;
    }
    for (let d = md; d > 0; d--) bin[d] = bin[d - 1];
    bin[0] = 0;
    for (let i = 0; i < n; i++) {
      const v = vert[i];
      for (const u of adj[v]) {
        if (deg[u] > deg[v]) {
          const du = deg[u], pu = pos[u], pw = bin[du], w = vert[pw];
          if (u !== w) {
            pos[u] = pw;
            vert[pu] = w;
            pos[w] = pu;
            vert[pw] = u;
          }
          bin[du]++;
          deg[u]--;
        }
      }
    }
    return deg;
  }

  /** every maximal clique (Bron–Kerbosch with a pivot, Tomita et al. 2006, in the degeneracy order of Eppstein
      et al. 2010). A node without neighbours is a clique of its own. → arrays of node indices.
      More than `limit` cliques: an error (dense networks can have very many). */
  function maximalCliques(G, limit = 500000) {
    const { n, adj } = G;
    const sets = adj.map((a) => new Set(a));
    const cliques = [];
    const core = coreNumber(G);
    // the degeneracy order: by core number, then as given
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => core[a] - core[b] || adj[a].length - adj[b].length || a - b);
    const rank = new Int32Array(n);
    order.forEach((v, i) => (rank[v] = i));
    const R = [];
    const expand = (P, X) => {
      if (!P.length) {
        if (!X.length) {
          cliques.push(R.slice());
          if (cliques.length > limit) throw new Error(`more than ${limit.toLocaleString('en-GB')} maximal cliques – the network is too dense for this`);
        }
        return;
      }
      let u = -1, best = -1;
      for (const list of [P, X]) {
        for (const x of list) {
          const S = sets[x];
          let c = 0;
          for (const p of P) if (S.has(p)) c++;
          if (c > best) {
            best = c;
            u = x;
          }
        }
      }
      const Su = sets[u];
      const cand = P.filter((p) => !Su.has(p));
      for (const v of cand) {
        const Sv = sets[v];
        R.push(v);
        expand(P.filter((p) => Sv.has(p)), X.filter((x) => Sv.has(x)));
        R.pop();
        P = P.filter((p) => p !== v);
        X = X.concat([v]);
      }
    };
    for (const v of order) {
      R.push(v);
      expand(adj[v].filter((u) => rank[u] > rank[v]), adj[v].filter((u) => rank[u] < rank[v]));
      R.pop();
    }
    return cliques;
  }

  /** the clustering coefficient of each node, 2e/(k(k-1)) (0 with fewer than two neighbours); and the number of
      links among the neighbours */
  function clustering(G) {
    const { n, adj } = G;
    const cc = new Float64Array(n), links = new Float64Array(n), mark = new Int32Array(n).fill(-1);
    for (let v = 0; v < n; v++) {
      const k = adj[v].length;
      for (const u of adj[v]) mark[u] = v;
      let e = 0;
      for (const u of adj[v]) for (const w of adj[u]) if (mark[w] === v) e++;
      e /= 2;
      links[v] = e;
      cc[v] = k > 1 ? (2 * e) / (k * (k - 1)) : 0;
    }
    return { cc, links };
  }

  /* ------------------------------------------------------------------
     shortest paths (Brandes 2001)
     ------------------------------------------------------------------ */
  /** a breadth-first search from every node. → per node: the sum of the distances to the nodes it reaches (sumD),
      how many it reaches (reach), the longest of those distances (ecc), the sum of 1/distance (harm), betweenness
      (bc) and stress – each pair of nodes counted once –, bottleneck counts (bn, see hubs); per pair of nodes joined
      by an edge: edge betweenness (ebc); and hist[d]: the number of pairs of nodes at distance d */
  function paths(G, opts = {}) {
    const { n, off, nbr, pid } = G;
    const P = G.pairs.length;
    const dist = new Int32Array(n), sigma = new Float64Array(n), delta = new Float64Array(n), phi = new Float64Array(n);
    const order = new Int32Array(n), parent = new Int32Array(n), sub = new Float64Array(n);
    const sumD = new Float64Array(n), reach = new Int32Array(n), ecc = new Int32Array(n), harm = new Float64Array(n);
    const bc = new Float64Array(n), stress = new Float64Array(n), bn = new Float64Array(n), ebc = new Float64Array(P);
    const hist = [0];
    const tick = opts.progress || null;
    for (let s = 0; s < n; s++) {
      dist.fill(-1);
      sigma.fill(0);
      delta.fill(0);
      phi.fill(0);
      dist[s] = 0;
      sigma[s] = 1;
      parent[s] = -1;
      let head = 0, tail = 0;
      order[tail++] = s;
      while (head < tail) {
        const v = order[head++];
        const dv = dist[v] + 1;
        for (let i = off[v]; i < off[v + 1]; i++) {
          const w = nbr[i];
          if (dist[w] < 0) {
            dist[w] = dv;
            parent[w] = v;
            order[tail++] = w;
          }
          if (dist[w] === dv) sigma[w] += sigma[v];
        }
      }
      let sd = 0, h = 0, mx = 0;
      for (let i = 1; i < tail; i++) {
        const d = dist[order[i]];
        sd += d;
        h += 1 / d;
        if (d > mx) mx = d;
        hist[d] = (hist[d] || 0) + 1;
      }
      sumD[s] = sd;
      harm[s] = h;
      ecc[s] = mx;
      reach[s] = tail - 1;
      // the tree of the search (each node under the node that found it first): bottlenecks
      for (let i = 0; i < tail; i++) sub[order[i]] = 1;
      for (let i = tail - 1; i > 0; i--) {
        const w = order[i];
        sub[parent[w]] += sub[w];
        if (sub[w] > tail / 4) bn[w]++;
      }
      // the paths back from the farthest nodes
      for (let i = tail - 1; i > 0; i--) {
        const w = order[i];
        const dw = dist[w] - 1;
        const cw = (1 + delta[w]) / sigma[w];
        for (let j = off[w]; j < off[w + 1]; j++) {
          const v = nbr[j];
          if (dist[v] !== dw) continue;
          const c = sigma[v] * cw;
          delta[v] += c;
          ebc[pid[j]] += c;
          phi[v] += 1 + phi[w];
        }
        bc[w] += delta[w];
        stress[w] += sigma[w] * phi[w];
      }
      if (tick && (s & 63) === 63) tick(s / n);
    }
    // (each pair was met from both of its ends)
    for (let v = 0; v < n; v++) {
      bc[v] /= 2;
      stress[v] /= 2;
    }
    for (let p = 0; p < P; p++) ebc[p] /= 2;
    for (let d = 1; d < hist.length; d++) hist[d] = (hist[d] || 0) / 2;
    return { sumD, reach, ecc, harm, bc, stress, bn, ebc, hist };
  }

  /** one shortest path from s to t (fewest edges; with weights: the smallest sum of weights, Dijkstra) → node
      indices, or null when t cannot be reached */
  function shortestPath(G, s, t, weights) {
    const { n, off, nbr, pid, pairs } = G;
    const prev = new Int32Array(n).fill(-1);
    if (!weights) {
      const seen = new Uint8Array(n), q = new Int32Array(n);
      let head = 0, tail = 0;
      q[tail++] = s;
      seen[s] = 1;
      while (head < tail && !seen[t]) {
        const v = q[head++];
        for (let i = off[v]; i < off[v + 1]; i++) {
          const w = nbr[i];
          if (!seen[w]) {
            seen[w] = 1;
            prev[w] = v;
            q[tail++] = w;
          }
        }
      }
      if (!seen[t]) return null;
    } else {
      const d = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
      d[s] = 0;
      // (a binary heap of [distance, node])
      const heap = [[0, s]];
      const push = (x) => {
        heap.push(x);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top;
      };
      while (heap.length) {
        const [dv, v] = pop();
        if (done[v]) continue;
        done[v] = 1;
        if (v === t) break;
        for (let i = off[v]; i < off[v + 1]; i++) {
          const w = nbr[i];
          const c = weights(pairs[pid[i]]);
          if (!(c >= 0)) continue;
          if (dv + c < d[w]) {
            d[w] = dv + c;
            prev[w] = v;
            push([d[w], w]);
          }
        }
      }
      if (!isFinite(d[t])) return null;
    }
    const path = [t];
    while (path[path.length - 1] !== s) path.push(prev[path[path.length - 1]]);
    return path.reverse();
  }

  /* ------------------------------------------------------------------
     the statistics of Cytoscape's Analyzer (undirected)
     ------------------------------------------------------------------ */
  /** → {nodes: {column: Float64Array}, pairs: {EdgeBetweenness}, summary: {…}, dist: {degree, paths, cc, nc, …}} */
  function networkAnalyzer(G, opts = {}) {
    const { n, adj, pairs, count, loops } = G;
    const sp = opts.paths || paths(G, opts);
    const { comp, sizes } = components(G);
    const { cc } = clustering(G);
    const k = adj.map((a) => a.length);
    // the diameter of each component
    const cdiam = new Int32Array(sizes.length);
    for (let v = 0; v < n; v++) if (sp.ecc[v] > cdiam[comp[v]]) cdiam[comp[v]] = sp.ecc[v];
    const aspl = new Float64Array(n), close = new Float64Array(n), btw = new Float64Array(n), rad = new Float64Array(n);
    const nconn = new Float64Array(n), topo = new Float64Array(n), partners = new Float64Array(n), single = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      const r = sp.reach[v];
      aspl[v] = r ? sp.sumD[v] / r : 0;
      close[v] = r ? r / sp.sumD[v] : 0;
      const N = sizes[comp[v]];
      btw[v] = N > 2 ? sp.bc[v] / (((N - 1) * (N - 2)) / 2) : 0;
      const D = cdiam[comp[v]];
      rad[v] = D > 0 ? (D + 1 - aspl[v]) / D : 0;
      let s = 0;
      for (const u of adj[v]) s += k[u];
      nconn[v] = k[v] ? s / k[v] : 0;
      single[v] = k[v] === 0 ? 1 : 0;
    }
    // topological coefficient: the mean, over the nodes m that share a neighbour with n, of the neighbours they
    // share (+1 if they are neighbours themselves) – divided by the number of neighbours of n
    const shared = new Int32Array(n), isNb = new Int32Array(n).fill(-1);
    for (let v = 0; v < n; v++) {
      if (k[v] < 2) continue;
      for (const u of adj[v]) isNb[u] = v;
      const touched = [];
      for (const u of adj[v]) {
        for (const m of adj[u]) {
          if (m === v) continue;
          if (shared[m] === 0) touched.push(m);
          shared[m]++;
        }
      }
      let sum = 0;
      for (const m of touched) {
        sum += shared[m] + (isNb[m] === v ? 1 : 0);
        shared[m] = 0;
      }
      topo[v] = touched.length ? sum / touched.length / k[v] : 0;
    }
    pairs.forEach(([a, b], p) => {
      if (count[p] > 1) {
        partners[a]++;
        partners[b]++;
      }
    });
    const nodes = {
      AverageShortestPathLength: aspl,
      BetweennessCentrality: btw,
      ClosenessCentrality: close,
      ClusteringCoefficient: cc,
      Degree: Float64Array.from(G.edges),
      Eccentricity: Float64Array.from(sp.ecc),
      IsSingleNode: single,
      NeighborhoodConnectivity: nconn,
      NumberOfUndirectedEdges: Float64Array.from(G.edges),
      PartnerOfMultiEdgedNodePairs: partners,
      Radiality: rad,
      SelfLoops: Float64Array.from(loops),
      Stress: Float64Array.from(sp.stress),
      TopologicalCoefficient: topo
    };
    // the network
    const E = pairs.length;
    let kmax = 0, ksum = 0, k2 = 0, isolated = 0, ccsum = 0, diam = 0, radius = Infinity, dsum = 0, rsum = 0, nloops = 0;
    for (let v = 0; v < n; v++) {
      kmax = Math.max(kmax, k[v]);
      ksum += k[v];
      k2 += k[v] * k[v];
      if (!k[v]) isolated++;
      ccsum += cc[v];
      diam = Math.max(diam, sp.ecc[v]);
      if (sp.ecc[v] > 0) radius = Math.min(radius, sp.ecc[v]);
      dsum += sp.sumD[v];
      rsum += sp.reach[v];
      nloops += loops[v];
    }
    const mean = n ? ksum / n : 0;
    const density = n > 1 ? (2 * E) / (n * (n - 1)) : 0;
    const sd = n ? Math.sqrt(Math.max(0, k2 / n - mean * mean)) : 0;
    const summary = {
      nodes: n,
      edges: count.reduce((a, b) => a + b, 0) + nloops,
      neighbours: mean,
      diameter: diam,
      radius: isFinite(radius) ? radius : 0,
      pathLength: rsum ? dsum / rsum : 0,
      clustering: n ? ccsum / n : 0,
      density,
      heterogeneity: mean ? sd / mean : 0,
      centralization: n > 2 ? (n / (n - 2)) * (kmax / (n - 1) - density) : 0,
      components: sizes.length,
      largest: sizes.length ? Math.max(...sizes) : 0,
      connectedPairs: rsum / 2,
      allPairs: (n * (n - 1)) / 2,
      isolated,
      selfLoops: nloops,
      multiPairs: count.filter((c) => c > 1).length
    };
    // distributions
    const byK = (vals) => {
      const acc = new Map();
      for (let v = 0; v < n; v++) {
        if (!k[v]) continue;
        const a = acc.get(k[v]) || [0, 0];
        a[0] += vals[v];
        a[1]++;
        acc.set(k[v], a);
      }
      return Array.from(acc.entries()).sort((a, b) => a[0] - b[0]).map(([x, [s, c]]) => [x, s / c]);
    };
    const degree = new Map();
    for (let v = 0; v < n; v++) degree.set(k[v], (degree.get(k[v]) || 0) + 1);
    const dist = {
      degree: Array.from(degree.entries()).sort((a, b) => a[0] - b[0]),
      paths: sp.hist.map((c, d) => [d, c]).filter(([d, c]) => d > 0 && c > 0),
      clustering: byK(cc),
      connectivity: byK(nconn),
      topological: byK(topo),
      closeness: byK(close),
      betweenness: byK(btw)
    };
    const fit = powerLaw(dist.degree.filter(([x]) => x > 0));
    return { nodes, pairs: { EdgeBetweenness: sp.ebc }, summary, dist, fit };
  }

  /** a fit of y = a·x^b by least squares on the logarithms (as Cytoscape's Analyzer fits degree distributions) →
      {a, b, r (the correlation of the logarithms), r2, points} */
  function powerLaw(pts) {
    const P = pts.filter(([x, y]) => x > 0 && y > 0);
    if (P.length < 2) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of P) {
      const lx = Math.log(x), ly = Math.log(y);
      sx += lx;
      sy += ly;
      sxx += lx * lx;
      syy += ly * ly;
      sxy += lx * ly;
    }
    const m = P.length;
    const vx = sxx - (sx * sx) / m, vy = syy - (sy * sy) / m, cxy = sxy - (sx * sy) / m;
    if (vx <= 0) return null;
    const b = cxy / vx, a = Math.exp((sy - b * sx) / m);
    const r = vy > 0 ? cxy / Math.sqrt(vx * vy) : 0;
    return { a, b, r, r2: r * r, points: m };
  }

  /* ------------------------------------------------------------------
     hubs: the rankings of cytoHubba (Chin et al. 2014)
     ------------------------------------------------------------------ */
  const HUBS = ['MCC', 'DMNC', 'MNC', 'Degree', 'EPC', 'BottleNeck', 'EcCentricity', 'Closeness', 'Radiality', 'Betweenness', 'Stress', 'ClusteringCoefficient'];
  /** the scores of one method (or of several: methods is a list) → {METHOD: Float64Array}. The definitions are
      those of the cytoHubba paper; where it leaves a choice open, see the help page of the Networks tab. */
  function hubs(G, methods, opts = {}) {
    const { n, adj } = G;
    const want = new Set([].concat(methods));
    const out = {};
    let sp = null, comps = null, cl = null;
    const SP = () => (sp = sp || opts.paths || paths(G, opts));
    const CO = () => (comps = comps || components(G));
    const CL = () => (cl = cl || clustering(G));
    if (want.has('Degree')) out.Degree = Float64Array.from(adj, (a) => a.length);
    if (want.has('ClusteringCoefficient')) out.ClusteringCoefficient = CL().cc;
    if (want.has('MCC')) {
      const mcc = new Float64Array(n);
      const fact = [1];
      for (const c of maximalCliques(G, opts.cliqueLimit)) {
        const f = c.length - 1;
        while (fact.length <= f) fact.push(fact[fact.length - 1] * fact.length);
        for (const v of c) mcc[v] += fact[f];
      }
      // "If there is no edge between the neighbors of the node v, MCC(v) is equal to its degree."
      const { links } = CL();
      for (let v = 0; v < n; v++) if (!links[v]) mcc[v] = adj[v].length;
      out.MCC = mcc;
    }
    if (want.has('MNC') || want.has('DMNC')) {
      const mnc = new Float64Array(n), dmnc = new Float64Array(n);
      const mark = new Int32Array(n).fill(-1), seen = new Int32Array(n).fill(-1);
      for (let v = 0; v < n; v++) {
        const N = adj[v];
        if (!N.length) continue;
        for (const u of N) mark[u] = v;
        let bestV = 0, bestE = 0;
        for (const s of N) {
          if (seen[s] === v) continue;
          // a component of the graph of the neighbours of v (v left out)
          const stack = [s];
          seen[s] = v;
          let nv = 0, ne = 0;
          while (stack.length) {
            const x = stack.pop();
            nv++;
            for (const y of adj[x]) {
              if (mark[y] !== v) continue;
              ne++;
              if (seen[y] !== v) {
                seen[y] = v;
                stack.push(y);
              }
            }
          }
          ne /= 2;
          if (nv > bestV || (nv === bestV && ne > bestE)) {
            bestV = nv;
            bestE = ne;
          }
        }
        mnc[v] = bestV;
        dmnc[v] = bestV ? bestE / Math.pow(bestV, 1.7) : 0;
      }
      out.MNC = mnc;
      out.DMNC = dmnc;
    }
    if (want.has('EPC')) {
      // 1000 networks with each edge removed with probability `threshold`; EPC(v) = the sum, over them, of the
      // number of nodes v is connected to (itself included) – divided by the number of nodes, as the paper defines it
      // (EPC(v) = 1/|V| · Σ_k Σ_t δ_vt^k: so up to 1000)
      const iters = opts.epcIterations || 1000, thr = opts.epcThreshold == null ? 0.5 : opts.epcThreshold;
      const rand = rng(opts.seed || 1);
      const parent = new Int32Array(n), size = new Int32Array(n), acc = new Float64Array(n);
      const find = (x) => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      for (let it = 0; it < iters; it++) {
        for (let v = 0; v < n; v++) {
          parent[v] = v;
          size[v] = 1;
        }
        for (const [a, b] of G.pairs) {
          if (rand() < thr) continue;
          let x = find(a), y = find(b);
          if (x === y) continue;
          if (size[x] < size[y]) [x, y] = [y, x];
          parent[y] = x;
          size[x] += size[y];
        }
        for (let v = 0; v < n; v++) acc[v] += size[find(v)];
      }
      out.EPC = acc.map((x) => (n ? x / n : 0));
    }
    if (['BottleNeck', 'EcCentricity', 'Closeness', 'Radiality', 'Betweenness', 'Stress'].some((m) => want.has(m))) {
      const S = SP(), C = CO();
      const cdiam = new Int32Array(C.count);
      for (let v = 0; v < n; v++) cdiam[C.comp[v]] = Math.max(cdiam[C.comp[v]], S.ecc[v]);
      if (want.has('BottleNeck')) out.BottleNeck = Float64Array.from(S.bn);
      if (want.has('Closeness')) out.Closeness = Float64Array.from(S.harm);
      if (want.has('Betweenness')) out.Betweenness = Float64Array.from(S.bc);
      if (want.has('Stress')) out.Stress = Float64Array.from(S.stress);
      if (want.has('EcCentricity')) out.EcCentricity = Float64Array.from({ length: n }, (_, v) => (S.ecc[v] ? (C.sizes[C.comp[v]] / n) * (1 / S.ecc[v]) : 0));
      if (want.has('Radiality'))
        out.Radiality = Float64Array.from({ length: n }, (_, v) => {
          const N = C.sizes[C.comp[v]];
          if (N < 2) return 0;
          // Σ over the other nodes w of the component of (Δ + 1 − dist(v, w)), over N − 1
          return (N / n) * ((S.reach[v] * (cdiam[C.comp[v]] + 1) - S.sumD[v]) / (N - 1));
        });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     MCODE (Bader & Hogue 2003), step by step as clusterMaker2's MCODEAlgorithm
     ------------------------------------------------------------------ */
  const MCODE_DEFAULTS = { degreeCutoff: 2, haircut: true, fluff: false, nodeScoreCutoff: 0.2, kCore: 2, maxDepth: 100, fluffNodeDensityCutoff: 0.1, includeLoops: false };
  /** → {scores: Float64Array, clusters: [{nodes, seed, score, edges}] (best first)} */
  function mcode(G, params) {
    const p = Object.assign({}, MCODE_DEFAULTS, params || {});
    const { n, adj, loops } = G;
    const mark = new Int32Array(n).fill(-1);
    let stamp = 0;
    // edges among a set of nodes (each pair once; a self-loop counts when includeLoops)
    const edgesIn = (nodes) => {
      stamp++;
      for (const v of nodes) mark[v] = stamp;
      let e = 0;
      for (const v of nodes) {
        for (const u of adj[v]) if (u > v && mark[u] === stamp) e++;
        if (p.includeLoops && loops[v]) e++;
      }
      return e;
    };
    const density = (nodes) => {
      const k = nodes.length;
      const possible = p.includeLoops ? (k * (k + 1)) / 2 : (k * (k - 1)) / 2;
      return possible ? edgesIn(nodes) / possible : 0;
    };
    // the k-core of the graph of a set of nodes: null when it is empty
    const kCore = (nodes, k) => {
      let S = nodes;
      for (;;) {
        stamp++;
        for (const v of S) mark[v] = stamp;
        const kept = [];
        for (const v of S) {
          let d = 0;
          for (const u of adj[v]) if (mark[u] === stamp) d++;
          if (p.includeLoops && loops[v]) d++;
          if (d >= k) kept.push(v);
        }
        if (!kept.length) return null;
        if (kept.length === S.length) return S;
        S = kept;
      }
    };
    const highestCore = (nodes) => {
      let i = 1, cur = nodes, prev = null;
      for (;;) {
        const c = kCore(cur, i);
        if (!c) break;
        cur = c;
        prev = c;
        i++;
      }
      return [i - 1, prev];
    };
    // 1. weight each node
    const info = new Array(n);
    for (let v = 0; v < n; v++) {
      const N = adj[v];
      if (N.length < 2) {
        const one = N.length === 1 ? 1 : 0;
        info[v] = { density: one, coreLevel: one, coreDensity: one, num: 0, nbrs: [], score: 0 };
        continue;
      }
      const hood = N.concat([v]);
      const x = { density: density(hood), num: hood.length, nbrs: hood };
      const [k, core] = highestCore(hood);
      x.coreLevel = k;
      x.coreDensity = core ? density(core) : 0;
      x.score = x.num > p.degreeCutoff ? x.coreDensity * x.coreLevel : 0;
      info[v] = x;
    }
    const scores = Float64Array.from(info, (x) => x.score);
    // 2. grow a cluster from each node not yet in one, the best first
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
    const seen = new Uint8Array(n);
    const clusters = [];
    for (const start of order) {
      if (seen[start]) continue;
      const cluster = [], inC = new Set();
      const limit = scores[start] - scores[start] * p.nodeScoreCutoff;
      const grow = (v, depth) => {
        if (seen[v]) return;
        seen[v] = 1;
        if (depth > p.maxDepth) return;
        for (const u of info[v].nbrs) {
          if (!seen[u] && info[u].score >= limit) {
            if (!inC.has(u)) {
              inC.add(u);
              cluster.push(u);
            }
            grow(u, depth + 1);
          }
        }
      };
      grow(start, 1);
      if (!cluster.length) continue;
      if (!inC.has(start)) cluster.push(start);
      // 3. keep it if it has a k-core; cut its hair (what is not in its 2-core); fluff it
      if (!kCore(cluster, p.kCore)) continue;
      let nodes = cluster;
      if (p.haircut) nodes = kCore(cluster, 2) || cluster;
      if (p.fluff) {
        const add = [], inside = new Set(nodes), added = new Set();
        for (const v of nodes)
          for (const u of info[v].nbrs)
            if (!seen[u] && !added.has(u) && !inside.has(u) && info[u].density > p.fluffNodeDensityCutoff) {
              added.add(u);
              add.push(u);
            }
        nodes = nodes.concat(add);
      }
      clusters.push({ nodes: nodes.slice(), seed: start, score: density(nodes) * nodes.length, edges: edgesIn(nodes) });
    }
    // (best first; the same score: in the order found)
    clusters.forEach((c, i) => (c.found = i));
    clusters.sort((a, b) => b.score - a.score || a.found - b.found);
    return { scores, clusters, params: p };
  }

  /* ------------------------------------------------------------------
     MCL: Markov clustering (van Dongen 2000; Enright et al. 2002), step by step as the Python package
     markov_clustering runs it: self-loops, then expansion (the matrix squared) and inflation (each value to the power
     r, columns normalised) until the matrix stops changing, small values pruned. Sparse columns.
     ------------------------------------------------------------------ */
  const MCL_DEFAULTS = { inflation: 2, loops: 'max', pruning: 0.001, iterations: 100 };
  /** weights(pair) → the weight of a pair of nodes (default: 1). loops: 'max' – the largest weight at each node (as
      the program mcl and clusterMaker2 add them) – or a number. → {clusters: [[nodes]] (largest first; single nodes
      too), iterations, converged} */
  function mcl(G, params, weights) {
    const p = Object.assign({}, MCL_DEFAULTS, params || {});
    const { n, pairs } = G;
    const cols = Array.from({ length: n }, () => new Map());
    for (const pr of pairs) {
      const w = weights ? weights(pr) : 1;
      if (!(w > 0)) continue;
      cols[pr[1]].set(pr[0], w);
      cols[pr[0]].set(pr[1], w);
    }
    for (let v = 0; v < n; v++) {
      let loop = p.loops;
      if (loop === 'max') {
        loop = 0;
        for (const x of cols[v].values()) if (x > loop) loop = x;
      }
      if (loop > 0) cols[v].set(v, +loop);
    }
    let M = cols.map((m) => {
      const e = Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
      return { i: Int32Array.from(e, (x) => x[0]), x: Float64Array.from(e, (x) => x[1]) };
    });
    const normalize = (M) => {
      for (let j = 0; j < n; j++) {
        const c = M[j];
        let s = 0;
        for (let k = 0; k < c.x.length; k++) s += c.x[k];
        if (s === 0) M[j] = { i: Int32Array.of(j), x: Float64Array.of(1) };
        else for (let k = 0; k < c.x.length; k++) c.x[k] /= s;
      }
    };
    // (values below the threshold go – but never the largest value of a column)
    const prune = (M) => {
      for (let j = 0; j < n; j++) {
        const c = M[j];
        let mx = -1, at = -1, keep = 0;
        for (let k = 0; k < c.x.length; k++) {
          if (c.x[k] > mx) {
            mx = c.x[k];
            at = k;
          }
          if (c.x[k] >= p.pruning) keep++;
        }
        if (keep === c.x.length) continue;
        const i2 = [], x2 = [];
        for (let k = 0; k < c.x.length; k++)
          if (c.x[k] >= p.pruning || k === at) {
            i2.push(c.i[k]);
            x2.push(c.x[k]);
          }
        M[j] = { i: Int32Array.from(i2), x: Float64Array.from(x2) };
      }
    };
    const acc = new Float64Array(n), used = new Uint8Array(n);
    const square = (M) => {
      const out = new Array(n);
      for (let j = 0; j < n; j++) {
        const cj = M[j], touched = [];
        for (let a = 0; a < cj.i.length; a++) {
          const k = cj.i[a], v = cj.x[a], ck = M[k];
          for (let b = 0; b < ck.i.length; b++) {
            const r = ck.i[b];
            if (!used[r]) {
              used[r] = 1;
              touched.push(r);
            }
            acc[r] += ck.x[b] * v;
          }
        }
        touched.sort((a, b) => a - b);
        const i2 = new Int32Array(touched.length), x2 = new Float64Array(touched.length);
        touched.forEach((r, q) => {
          i2[q] = r;
          x2[q] = acc[r];
          acc[r] = 0;
          used[r] = 0;
        });
        out[j] = { i: i2, x: x2 };
      }
      return out;
    };
    // (numpy's allclose: |a - b| <= 1e-8 + 1e-5 |b|, everywhere)
    const same = (A, B) => {
      for (let j = 0; j < n; j++) {
        const a = A[j], b = B[j];
        let x = 0, y = 0;
        while (x < a.i.length || y < b.i.length) {
          const ra = x < a.i.length ? a.i[x] : Infinity, rb = y < b.i.length ? b.i[y] : Infinity;
          const va = ra <= rb ? a.x[x] : 0, vb = rb <= ra ? b.x[y] : 0;
          if (Math.abs(va - vb) > 1e-8 + 1e-5 * Math.abs(vb)) return false;
          if (ra <= rb) x++;
          if (rb <= ra) y++;
        }
      }
      return true;
    };
    normalize(M);
    let it = 0, converged = false;
    while (it < p.iterations) {
      const last = M;
      M = square(M);
      for (const c of M) for (let k = 0; k < c.x.length; k++) c.x[k] = Math.pow(c.x[k], p.inflation);
      normalize(M);
      if (p.pruning > 0) prune(M);
      it++;
      if (same(M, last)) {
        converged = true;
        break;
      }
    }
    // the clusters: nodes joined by a value that is not 0 (an attractor and the nodes it attracts – and clusters that
    // share a node, as one)
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let j = 0; j < n; j++) {
      const c = M[j];
      for (let k = 0; k < c.i.length; k++) {
        if (c.i[k] === j || !(c.x[k] > 0)) continue;
        const a = find(c.i[k]), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
    const groups = new Map();
    for (let v = 0; v < n; v++) {
      const r = find(v);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(v);
    }
    const clusters = Array.from(groups.values()).sort((a, b) => b.length - a.length || a[0] - b[0]);
    return { clusters, iterations: it, converged, params: p };
  }

  /* ------------------------------------------------------------------
     Louvain communities (Blondel et al. 2008), as networkx's louvain_communities – with the nodes taken in their
     order, or shuffled when a seed is given
     ------------------------------------------------------------------ */
  function louvain(G, params, weights) {
    const p = Object.assign({ resolution: 1, threshold: 1e-7, seed: null }, params || {});
    const { n } = G;
    // a level: nodes 0 … N-1; nbrs[u]: Map(v → weight) without u; self[u]: the weight of u's self-loop
    let N = n;
    let nbrs = Array.from({ length: n }, () => new Map());
    let self = new Float64Array(n);
    let m = 0;
    for (const pr of G.pairs) {
      const w = weights ? weights(pr) : 1;
      if (!(w > 0)) continue;
      nbrs[pr[0]].set(pr[1], w);
      nbrs[pr[1]].set(pr[0], w);
      m += w;
    }
    if (m === 0) return { membership: Int32Array.from({ length: n }, (_, i) => i), communities: Array.from({ length: n }, (_, i) => [i]), modularity: 0, levels: 0 };
    let members = Array.from({ length: n }, (_, i) => [i]); // the original nodes of each node of the level
    const rand = p.seed != null ? rng(p.seed) : null;
    const gamma = p.resolution;
    const modularityOf = (comm) => {
      // (on the current level: comm[u] = the community of node u)
      const L = new Map(), D = new Map();
      for (let u = 0; u < N; u++) {
        const c = comm[u];
        let deg = 2 * self[u];
        for (const [v, w] of nbrs[u]) {
          deg += w;
          if (comm[v] === c && v > u) L.set(c, (L.get(c) || 0) + w);
        }
        if (self[u]) L.set(c, (L.get(c) || 0) + self[u]);
        D.set(c, (D.get(c) || 0) + deg);
      }
      let q = 0;
      for (const [c, d] of D) q += (L.get(c) || 0) / m - gamma * Math.pow(d / (2 * m), 2);
      return q;
    };
    let mod = modularityOf(Int32Array.from({ length: N }, (_, i) => i));
    let levels = 0;
    for (;;) {
      // one level: move nodes between communities while that raises the modularity
      const comm = Int32Array.from({ length: N }, (_, i) => i);
      const degree = new Float64Array(N);
      for (let u = 0; u < N; u++) {
        let d = 2 * self[u];
        for (const w of nbrs[u].values()) d += w;
        degree[u] = d;
      }
      const Stot = Float64Array.from(degree);
      const nodes = Array.from({ length: N }, (_, i) => i);
      if (rand)
        for (let i = N - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }
      let improved = false, moves = 1;
      while (moves > 0) {
        moves = 0;
        for (const u of nodes) {
          let best = 0, bestCom = comm[u];
          const w2c = new Map();
          for (const [v, w] of nbrs[u]) w2c.set(comm[v], (w2c.get(comm[v]) || 0) + w);
          const d = degree[u];
          Stot[bestCom] -= d;
          const removeCost = -(w2c.get(bestCom) || 0) / m + (gamma * (Stot[bestCom] * d)) / (2 * m * m);
          for (const [c, wt] of w2c) {
            const gain = removeCost + wt / m - (gamma * (Stot[c] * d)) / (2 * m * m);
            if (gain > best) {
              best = gain;
              bestCom = c;
            }
          }
          Stot[bestCom] += d;
          if (bestCom !== comm[u]) {
            comm[u] = bestCom;
            improved = true;
            moves++;
          }
        }
      }
      levels++;
      // the communities of this level, in the order of their labels (as networkx numbers the nodes of the next level)
      const ids = new Map(Array.from(new Set(comm)).sort((a, b) => a - b).map((c, i) => [c, i]));
      const newMod = modularityOf(comm);
      const K = ids.size;
      const nextMembers = Array.from({ length: K }, () => []);
      for (let u = 0; u < N; u++) for (const x of members[u]) nextMembers[ids.get(comm[u])].push(x);
      members = nextMembers;
      if (!improved || newMod - mod <= p.threshold) {
        mod = newMod;
        break;
      }
      mod = newMod;
      // the next level: one node per community
      const nb2 = Array.from({ length: K }, () => new Map());
      const self2 = new Float64Array(K);
      for (let u = 0; u < N; u++) {
        const cu = ids.get(comm[u]);
        self2[cu] += self[u];
        for (const [v, w] of nbrs[u]) {
          if (v < u) continue;
          const cv = ids.get(comm[v]);
          if (cu === cv) self2[cu] += w;
          else {
            nb2[cu].set(cv, (nb2[cu].get(cv) || 0) + w);
            nb2[cv].set(cu, (nb2[cv].get(cu) || 0) + w);
          }
        }
      }
      N = K;
      nbrs = nb2;
      self = self2;
    }
    const communities = members.map((c) => c.sort((a, b) => a - b)).sort((a, b) => b.length - a.length || a[0] - b[0]);
    const membership = new Int32Array(n);
    communities.forEach((c, i) => c.forEach((v) => (membership[v] = i)));
    return { membership, communities, modularity: modularity(G, membership, gamma, weights), levels };
  }

  /** the modularity of a division of the nodes (Newman 2006; with a resolution, Reichardt & Bornholdt 2006) */
  function modularity(G, membership, resolution = 1, weights) {
    const { n } = G;
    const deg = new Float64Array(n);
    const inside = new Map(), tot = new Map();
    let m = 0;
    for (const pr of G.pairs) {
      const w = weights ? weights(pr) : 1;
      if (!(w > 0)) continue;
      m += w;
      deg[pr[0]] += w;
      deg[pr[1]] += w;
      if (membership[pr[0]] === membership[pr[1]]) inside.set(membership[pr[0]], (inside.get(membership[pr[0]]) || 0) + w);
    }
    if (!m) return 0;
    for (let v = 0; v < n; v++) tot.set(membership[v], (tot.get(membership[v]) || 0) + deg[v]);
    let q = 0;
    for (const [c, d] of tot) q += (inside.get(c) || 0) / m - resolution * Math.pow(d / (2 * m), 2);
    return q;
  }

  /* ------------------------------------------------------------------
     enrichment of a list of genes in gene sets (a .gmt file): the hypergeometric test, Benjamini–Hochberg
     ------------------------------------------------------------------ */
  function logGamma(x) {
    // (Lanczos, g = 7)
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  const logChoose = (n, k) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  /** P(X ≥ k) for X hypergeometric: N things, K of them marked, n drawn */
  function hyperTail(k, N, K, n) {
    const hi = Math.min(K, n);
    if (k > hi) return 0;
    const base = logChoose(N, n);
    let s = 0;
    for (let i = Math.max(k, 0); i <= hi; i++) s += Math.exp(logChoose(K, i) + logChoose(N - K, n - i) - base);
    return Math.min(1, s);
  }
  /** Benjamini–Hochberg adjusted p-values (in the order given) */
  function bh(ps) {
    const m = ps.length;
    const idx = ps.map((p, i) => i).sort((a, b) => ps[b] - ps[a]);
    const out = new Array(m);
    let min = 1;
    idx.forEach((i, r) => {
      const rank = m - r;
      min = Math.min(min, (ps[i] * m) / rank);
      out[i] = min;
    });
    return out;
  }
  /** genes: the list; sets: [{id, name, genes: [...]}]; universe: the genes that could have been in the list (default:
      every gene of every set, and the list). → [{id, name, k, K, n, N, p, fdr, genes}] sorted by p */
  function enrichment(genes, sets, universe, opts = {}) {
    const minSize = opts.minSize || 3, maxSize = opts.maxSize || 2000;
    const U = new Set(universe || []);
    if (!universe) {
      sets.forEach((s) => s.genes.forEach((g) => U.add(g)));
      genes.forEach((g) => U.add(g));
    }
    const list = Array.from(new Set(genes.filter((g) => U.has(g))));
    const L = new Set(list);
    const N = U.size, n = list.length;
    const rows = [];
    for (const s of sets) {
      const members = Array.from(new Set(s.genes.filter((g) => U.has(g))));
      const K = members.length;
      if (K < minSize || K > maxSize) continue;
      const hit = members.filter((g) => L.has(g));
      if (!hit.length) continue;
      rows.push({ id: s.id, name: s.name, k: hit.length, K, n, N, p: hyperTail(hit.length, N, K, n), genes: hit });
    }
    const adj = bh(rows.map((r) => r.p));
    rows.forEach((r, i) => (r.fdr = adj[i]));
    return rows.sort((a, b) => a.p - b.p || b.k - a.k);
  }

  return { graph, rng, components, coreNumber, maximalCliques, clustering, paths, shortestPath, networkAnalyzer, powerLaw, HUBS, hubs, MCODE_DEFAULTS, mcode, MCL_DEFAULTS, mcl, louvain, modularity, hyperTail, bh, enrichment };
});
