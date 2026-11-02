// Pure SVG layout for the people graph: team columns, node order, curved arrows,
// cover badges and 2-line labels placed off people nodes. No React, testable in node.
import { wrapLabel } from '../analysis/labels.js';

export const LAYOUT = {
  colWidth: 215,
  rowGap: 132,
  marginX: 64,
  top: 108,
  bottom: 50,
  minR: 16,
  rPerSqrt: 3,
  charW: 6.4,
  lineH: 14,
  padX: 7,
  padY: 4,
  badgeR: 7,
  arrowGap: 5,
};
export const LABEL_CHARS = { ticket: 22, theme: 22, team: 28 };
const NO_TEAM = 'No team';

export const nodeRadius = (score) => LAYOUT.minR + LAYOUT.rPerSqrt * Math.sqrt(Math.max(0, score));

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  const out = [];
  xs.forEach((x, i) => {
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/** Team column order minimising sum(weight × column distance) of cross-team edges. */
export function orderTeams(teams, crossWeights) {
  const linked = teams.filter((t) => teams.some((u) => (crossWeights.get(pairId(t, u)) ?? 0) > 0));
  const isolated = teams.filter((t) => !linked.includes(t)).sort((a, b) => (a === NO_TEAM) - (b === NO_TEAM) || a.localeCompare(b));
  const base = [...linked].sort();
  const cost = (order) => {
    let c = 0;
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++) c += (crossWeights.get(pairId(order[i], order[j])) ?? 0) * (j - i);
    return c;
  };
  let best = base;
  let bestCost = cost(base);
  const cands = base.length <= 7 ? permutations(base) : [base];
  for (const p of cands) {
    const c = cost(p);
    if (c < bestCost) {
      best = p;
      bestCost = c;
    }
  }
  return { order: [...best, ...isolated], cost: bestCost };
}
const pairId = (a, b) => [a, b].sort().join('|');

// ------------------------------------------------------------- geometry helpers
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const quad = (p0, c, p1, t) => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t ** 2 * p1.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t ** 2 * p1.y,
});
const quadTangent = (p0, c, p1, t) => norm({
  x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
  y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y),
});

export function rectCircleOverlap(r, c, margin = 0) {
  const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(c.x - cx, c.y - cy) < c.r + margin;
}
export function rectsOverlap(a, b, margin = 0) {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

/**
 * input: { people:[{id,name,team,score}], edges:[{id, from(waiter), to(blocker), label}] , zoom }
 * output: { width, height, columns, nodes, edges }
 */
export function computeLayout({ people, edges, zoom = 'ticket' }) {
  const L = LAYOUT;
  const teamOf = new Map(people.map((p) => [p.id, p.team ?? NO_TEAM]));
  const teams = [...new Set(people.map((p) => p.team ?? NO_TEAM))];
  const cross = new Map();
  for (const e of edges) {
    const a = teamOf.get(e.from);
    const b = teamOf.get(e.to);
    if (a !== b) cross.set(pairId(a, b), (cross.get(pairId(a, b)) ?? 0) + (e.weight ?? 1));
  }
  const { order } = orderTeams(teams, cross);
  const colIndex = new Map(order.map((t, i) => [t, i]));

  // within-column order: connected people first, then barycentre sweeps
  const degree = new Map(people.map((p) => [p.id, 0]));
  const nbrs = new Map(people.map((p) => [p.id, []]));
  for (const e of edges) {
    degree.set(e.from, degree.get(e.from) + 1);
    degree.set(e.to, degree.get(e.to) + 1);
    nbrs.get(e.from).push(e.to);
    nbrs.get(e.to).push(e.from);
  }
  const cols = order.map((t) =>
    people.filter((p) => (p.team ?? NO_TEAM) === t).sort((a, b) => (degree.get(b.id) > 0) - (degree.get(a.id) > 0) || b.score - a.score || a.name.localeCompare(b.name)),
  );
  const rowOf = new Map();
  const reindex = () => cols.forEach((c) => c.forEach((p, i) => rowOf.set(p.id, i)));
  reindex();
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const c of cols) {
      const bary = new Map(
        c.map((p) => {
          const ns = nbrs.get(p.id).filter((n) => teamOf.get(n) !== teamOf.get(p.id));
          return [p.id, ns.length ? ns.reduce((s, n) => s + rowOf.get(n), 0) / ns.length : rowOf.get(p.id)];
        }),
      );
      c.sort((a, b) => bary.get(a.id) - bary.get(b.id) || rowOf.get(a.id) - rowOf.get(b.id));
      reindex();
    }
  }

  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const width = L.marginX * 2 + order.length * L.colWidth;
  const height = L.top + (maxRows - 1) * L.rowGap + L.bottom + 40;
  const nodes = [];
  cols.forEach((c, ci) => {
    const offset = ((maxRows - c.length) * L.rowGap) / 2;
    c.forEach((p, ri) => {
      nodes.push({
        id: p.id,
        name: p.name,
        team: p.team ?? NO_TEAM,
        score: p.score,
        col: ci,
        row: ri,
        x: L.marginX + ci * L.colWidth + L.colWidth / 2,
        y: L.top + 20 + offset + ri * L.rowGap,
        r: nodeRadius(p.score),
      });
      const n = nodes[nodes.length - 1];
      n.textBox = { x: n.x - 48, y: n.y + n.r + 3, w: 96, h: 31 }; // name + score text under the node
    });
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const columns = order.map((t, i) => ({ team: t, x: L.marginX + i * L.colWidth + L.colWidth / 2, x0: L.marginX + i * L.colWidth, w: L.colWidth }));

  // ----------------------------------------------------------- edges
  const hitsNode = (p0, c, p1, ignore) => {
    let hits = 0;
    for (let t = 0.08; t < 0.95; t += 0.04) {
      const q = quad(p0, c, p1, t);
      for (const n of nodes) {
        if (!ignore.includes(n.id) && Math.hypot(q.x - n.x, q.y - n.y) < n.r + 10) hits++;
        const tb = n.textBox;
        if (!ignore.includes(n.id) && q.x > tb.x - 3 && q.x < tb.x + tb.w + 3 && q.y > tb.y - 3 && q.y < tb.y + tb.h + 3) hits++; // other people's name/score text
      }
    }
    return hits;
  };
  const maxChars = LABEL_CHARS[zoom] ?? 22;
  // 1) curves
  const geoms = edges.map((e) => {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    const d = sub(b, a);
    const dist = len(d);
    const nrm = norm({ x: -d.y, y: d.x }); // left of travel direction
    const sameCol = a.col === b.col;
    const base = sameCol ? Math.max(48, dist * 0.32) : Math.max(24, dist * 0.12);
    let best = null;
    for (const k of [1, 1.8, 2.6, -1, -1.8, -2.6, 3.4, -3.4, 0.4, -0.4, 4.2, -4.2]) {
      const c = add(mul(add(a, b), 0.5), mul(nrm, base * k));
      const h = hitsNode(a, c, b, [a.id, b.id]);
      if (!best || h < best.h) best = { c, h, k };
      if (h === 0) break;
    }
    const c = best.c;
    const start = add(a, mul(norm(sub(c, a)), a.r + 2));
    const end = add(b, mul(norm(sub(c, b)), b.r + L.arrowGap));
    const lines = wrapLabel(e.label ?? '', maxChars, 2);
    const w = lines.length ? Math.max(...lines.map((l) => l.length)) * L.charW + L.padX * 2 : 0;
    const h = lines.length ? lines.length * L.lineH + L.padY * 2 : 0;
    return { e, c, start, end, best, lines, w, h, placed: null };
  });

  // 2) label + badge placement; second pass re-places each against all others
  const place = (g, others) => {
    const { start, c, end, w, h, best } = g;
    let bestLabel = null;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const p = quad(start, c, end, t);
      const tan = quadTangent(start, c, end, t);
      const side = { x: -tan.y, y: tan.x };
      const outward = Math.sign(best.k) || 1;
      for (const s of [outward, -outward])
        for (const dd of [10, 22, 36, 52, 70, 90]) {
          const centre = add(p, mul(side, s * (dd + Math.abs(side.x) * w / 2 + Math.abs(side.y) * h / 2)));
          const rect = { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
          const badge = { x: p.x, y: p.y, r: L.badgeR };
          let pen = 0;
          const has = w > 0;
          for (const n of nodes) {
            if (has && rectCircleOverlap(rect, n, 6)) pen += 100;
            if (Math.hypot(badge.x - n.x, badge.y - n.y) < n.r + badge.r + 3) pen += 100;
            if (has && rectsOverlap(rect, n.textBox, 2)) pen += 100;
            if (rectCircleOverlap(n.textBox, badge, 2)) pen += 100;
          }
          for (const o of others) {
            if (Math.hypot(badge.x - o.badge.x, badge.y - o.badge.y) < badge.r * 2 + 2) pen += 10;
            if (o.rect.w > 0 && rectCircleOverlap(o.rect, badge, 2)) pen += 10;
            if (has && o.rect.w > 0 && rectsOverlap(rect, o.rect, 3)) pen += 10;
            if (has && rectCircleOverlap(rect, o.badge, 2)) pen += 10;
          }
          if (has && rect.x < 2 || rect.x + rect.w > width - 2 || rect.y < 56 || rect.y + rect.h > height - 2) pen += 50;
          const score = pen + dd / 100 + Math.abs(t - 0.5);
          if (!bestLabel || score < bestLabel.score) bestLabel = { score, pen, rect, badge, t };
        }
      if (bestLabel.pen === 0) break;
    }
    return bestLabel;
  };
  for (const g of geoms) g.placed = place(g, geoms.filter((o) => o !== g && o.placed).map((o) => o.placed));
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const g of geoms) {
      if (g.placed.pen === 0) continue;
      const next = place(g, geoms.filter((o) => o !== g).map((o) => o.placed));
      if (next.score < g.placed.score - 1e-9) {
        g.placed = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // recompute final collision counts against final positions
  const outEdges = geoms.map((g) => {
    const final = place({ ...g }, geoms.filter((o) => o !== g).map((o) => o.placed));
    const pen = final.rect.x === g.placed.rect.x && final.rect.y === g.placed.rect.y ? final.pen : penaltyAt(g.placed);
    return {
      id: g.e.id,
      from: g.e.from,
      to: g.e.to,
      d: `M${r1(g.start.x)},${r1(g.start.y)} Q${r1(g.c.x)},${r1(g.c.y)} ${r1(g.end.x)},${r1(g.end.y)}`,
      control: g.c,
      start: g.start,
      end: g.end,
      mid: quad(g.start, g.c, g.end, 0.5),
      nodeHits: g.best.h,
      badge: g.placed.badge,
      label: { lines: g.lines, ...g.placed.rect, collisions: pen },
    };
  });
  function penaltyAt(pl) {
    let pen = 0;
    for (const o of geoms.map((x) => x.placed)) {
      if (o === pl) continue;
      const a = pl.rect.w > 0;
      const b = o.rect.w > 0;
      if ((a && b && rectsOverlap(pl.rect, o.rect, 3)) || (a && rectCircleOverlap(pl.rect, o.badge, 2)) || (b && rectCircleOverlap(o.rect, pl.badge, 2))) pen += 10;
    }
    if (pl.rect.w > 0) for (const n of nodes) if (rectCircleOverlap(pl.rect, n, 6) || rectsOverlap(pl.rect, n.textBox, 2)) pen += 100;
    return pen;
  }
  return { width, height, columns, nodes, edges: outEdges, order };
}
const r1 = (v) => Math.round(v * 10) / 10;

/** Keyboard neighbour: direction in 'left'|'right'|'up'|'down'. */
export function neighbour(layout, fromId, direction) {
  const n = layout.nodes.find((x) => x.id === fromId);
  if (!n) return layout.nodes[0]?.id ?? null;
  if (direction === 'up' || direction === 'down') {
    const col = layout.nodes.filter((x) => x.col === n.col).sort((a, b) => a.row - b.row);
    const i = col.findIndex((x) => x.id === n.id) + (direction === 'down' ? 1 : -1);
    return col[Math.max(0, Math.min(col.length - 1, i))].id;
  }
  const step = direction === 'right' ? 1 : -1;
  const cols = Math.max(...layout.nodes.map((x) => x.col)) + 1;
  for (let c = n.col + step; c >= 0 && c < cols; c += step) {
    const cand = layout.nodes.filter((x) => x.col === c);
    if (cand.length) return cand.sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0].id;
  }
  return n.id;
}
