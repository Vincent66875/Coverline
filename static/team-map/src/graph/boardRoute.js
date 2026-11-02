// Line routing for the My work board. Pure, no React: boxes in, SVG paths + label points out.

export const LANE_GAP = 24; // vertical spacing of lanes under the cards (fits a label pill)
const PORT_GAP = 8; // spacing of lines leaving the same card edge

const bez = (s, c1, c2, e, t) => {
  const mt = 1 - t;
  return {
    x: mt ** 3 * s.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * e.x,
    y: mt ** 3 * s.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * e.y,
  };
};

/**
 * Route every line on the board. Neighbouring columns: a direct curve in the gap between them.
 * Same column: a bow out to the right. Lines that skip columns run in a lane below all cards, so
 * they never cross the cards in between; their label sits on the lane.
 */
export function routeLines(list, boxes, colOf, widthOf = () => 80) {
  const items = list.filter((l) => boxes.has(l.fromKey) && boxes.has(l.toKey));
  const bottom = Math.max(0, ...[...boxes.values()].map((b) => b.y + b.h));
  // ports: spread lines that leave/enter the same card edge
  const ports = new Map();
  const portKey = (key, side) => `${key}|${side}`;
  const plan = items.map((l) => {
    const a = boxes.get(l.fromKey);
    const b = boxes.get(l.toKey);
    const ca = colOf.get(l.fromKey);
    const cb = colOf.get(l.toKey);
    const same = ca === cb;
    const aLeft = a.cx <= b.cx;
    const sideA = same ? 'r' : aLeft ? 'r' : 'l';
    const sideB = same ? 'r' : aLeft ? 'l' : 'r';
    const skip = !same && Math.abs(ca - cb) > 1;
    for (const [k, sd] of [[l.fromKey, sideA], [l.toKey, sideB]]) ports.set(portKey(k, sd), [...(ports.get(portKey(k, sd)) ?? []), l.id]);
    return { l, a, b, sideA, sideB, same, skip };
  });
  const offset = (key, side, id) => {
    const ids = ports.get(portKey(key, side));
    const i = ids.indexOf(id);
    return (i - (ids.length - 1) / 2) * PORT_GAP;
  };
  let lane = 0;
  const out = new Map();
  const placed = []; // label boxes already placed
  const hits = (m, w) => placed.some((r) => Math.abs(r.x - m.x) < (r.w + w) / 2 + 4 && Math.abs(r.y - m.y) < 20);
  const curveLabel = (l, s, c1, c2, e) => {
    const w = widthOf(l);
    for (const t of [0.5, 0.36, 0.64, 0.26, 0.74]) {
      const m = bez(s, c1, c2, e, t);
      if (!hits(m, w)) {
        placed.push({ ...m, w });
        return m;
      }
    }
    const m = bez(s, c1, c2, e, 0.5);
    placed.push({ ...m, w });
    return m;
  };
  for (const p of plan) {
    const { l, a, b, sideA, sideB } = p;
    const s = { x: sideA === 'r' ? a.x + a.w : a.x, y: a.cy + offset(l.fromKey, sideA, l.id) };
    const e = { x: sideB === 'r' ? b.x + b.w : b.x, y: b.cy + offset(l.toKey, sideB, l.id) };
    if (p.same) {
      const bow = 40 + Math.min(50, Math.abs(s.y - e.y) / 4);
      const c1 = { x: s.x + bow, y: s.y };
      const c2 = { x: e.x + bow, y: e.y };
      out.set(l.id, { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`, mid: curveLabel(l, s, c1, c2, e) });
    } else if (!p.skip) {
      const dx = (e.x - s.x) * 0.5;
      const c1 = { x: s.x + dx, y: s.y };
      const c2 = { x: e.x - dx, y: e.y };
      out.set(l.id, { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`, mid: curveLabel(l, s, c1, c2, e) });
    } else {
      const i = lane++;
      const y = bottom + 26 + i * LANE_GAP;
      const dir = e.x > s.x ? 1 : -1;
      const r = 12;
      const step = 18 + (i % 6) * 9; // stagger the vertical risers so they don't sit on each other
      const sx = s.x + dir * step; // step out into the gap, then down to the lane
      const ex = e.x - dir * step;
      const d = [
        `M${s.x},${s.y}`,
        `L${sx - dir * r},${s.y}`,
        `Q${sx},${s.y} ${sx},${s.y + r}`,
        `L${sx},${y - r}`,
        `Q${sx},${y} ${sx + dir * r},${y}`,
        `L${ex - dir * r},${y}`,
        `Q${ex},${y} ${ex},${y - r}`,
        `L${ex},${e.y + r}`,
        `Q${ex},${e.y} ${ex + dir * r},${e.y}`,
        `L${e.x},${e.y}`,
      ].join(' ');
      out.set(l.id, { d, mid: { x: sx + (ex - sx) * (0.5 + ((i % 3) - 1) * 0.2), y } }); // stagger labels along their lane
    }
  }
  return { routes: out, lanes: lane };
}
