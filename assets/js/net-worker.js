/* =====================================================================
   The analyses of the Networks tab, off the page's thread: the page
   sends the graph (n nodes, the edges as flat arrays) and the name of a
   function of net-algo.js; the worker answers with its result.
   ===================================================================== */
/* global importScripts */
importScripts('net-algo.js');
const A = self.MG.netAlgo;

self.onmessage = (ev) => {
  const { id, fn, n, src, dst, w, args } = ev.data;
  try {
    const edges = new Array(src.length);
    for (let i = 0; i < src.length; i++) edges[i] = [src[i], dst[i], w ? w[i] : 1];
    const G = A.graph(n, edges);
    const progress = (f) => self.postMessage({ id, progress: f });
    let out;
    const weights = args && args.weighted ? (p) => p[2] : null;
    switch (fn) {
      case 'networkAnalyzer': {
        const r = A.networkAnalyzer(G, { progress });
        out = { nodes: r.nodes, summary: r.summary, dist: r.dist, fit: r.fit, edgeBetweenness: pairsToEdges(G, src, dst, r.pairs.EdgeBetweenness) };
        break;
      }
      case 'hubs':
        out = A.hubs(G, args.methods, { progress, seed: args.seed || 1 });
        break;
      case 'mcode':
        out = A.mcode(G, args.params);
        break;
      case 'mcl':
        out = A.mcl(G, args.params, weights);
        break;
      case 'louvain':
        out = A.louvain(G, args.params, weights);
        break;
      case 'components':
        out = A.components(G);
        break;
      case 'coreNumber':
        out = { core: A.coreNumber(G) };
        break;
      case 'shortestPath':
        out = { path: A.shortestPath(G, args.s, args.t, weights ? (p) => (p[2] > 0 ? 1 / p[2] : Infinity) : null) };
        break;
      default:
        throw new Error('no such analysis: ' + fn);
    }
    self.postMessage({ id, result: out });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};

/** a value for each pair of nodes → one for each edge as given (edges of the same pair share it) */
function pairsToEdges(G, src, dst, vals) {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) {
    if (src[i] === dst[i]) {
      out[i] = 0;
      continue;
    }
    const p = G.pairOf(src[i], dst[i]);
    out[i] = p == null ? 0 : vals[p];
  }
  return out;
}
