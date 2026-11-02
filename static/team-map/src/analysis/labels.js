// Edge label text per zoom level (ticket / theme / team) and team sentences.
// Pure module: no React.

export const ZOOMS = ['ticket', 'theme', 'team'];
const uniq = (xs) => [...new Set(xs)];

function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Cross-team "waits on" sentences derived from person edges. */
export function teamSentences(model, absent = new Set()) {
  const teamOf = new Map(model.people.map((p) => [p.accountId, p.team]));
  const groups = new Map();
  for (const e of model.personEdges) {
    if (absent.has(e.waiterId) || absent.has(e.blockerId)) continue;
    const wt = teamOf.get(e.waiterId);
    const bt = teamOf.get(e.blockerId);
    if (!wt || !bt || wt === bt) continue;
    const id = `${wt}>${bt}`;
    const g = groups.get(id) ?? { id, waiterTeam: wt, blockerTeam: bt, blockers: [], waiters: [], edges: [], keys: [] };
    g.blockers = uniq([...g.blockers, e.blockerId]);
    g.waiters = uniq([...g.waiters, e.waiterId]);
    g.edges.push(e.id);
    g.keys = uniq([...g.keys, ...e.pairs.flatMap((p) => [p.waiterKey, p.blockerKey])]);
    groups.set(id, g);
  }
  return [...groups.values()]
    .map((g) => {
      const names = g.blockers.map(model.nameOf).sort();
      return { ...g, sentence: `${g.waiterTeam} waits on ${g.blockerTeam}, through ${joinNames(names)}${names.length === 1 ? ' only' : ''}` };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Label text for one person edge at a zoom level. */
export function edgeLabel(model, edge, zoom = 'ticket', teamSentenceById = null) {
  const blockers = uniq(edge.pairs.map((p) => p.blockerKey)).map((k) => model.issueByKey.get(k));
  const weight = edge.weight > 1 ? ` ×${edge.weight}` : '';
  const keys = uniq(edge.pairs.flatMap((p) => [p.blockerKey, p.waiterKey]));
  if (zoom === 'theme') {
    const epics = uniq(blockers.map((b) => b.epicKey)).map((k) => (k ? model.issueByKey.get(k).summary : 'No epic'));
    return { text: `${epics.join(', ')}${weight}`, keys: uniq([...keys, ...blockers.map((b) => b.epicKey).filter(Boolean)]) };
  }
  if (zoom === 'team') {
    const teamOf = (id) => model.personById.get(id)?.team;
    const wt = teamOf(edge.waiterId);
    const bt = teamOf(edge.blockerId);
    if (!wt || !bt || wt === bt) return { text: `Within ${bt ?? 'no team'}`, keys };
    const map = teamSentenceById ?? new Map(teamSentences(model).map((s) => [s.id, s]));
    const s = map.get(`${wt}>${bt}`);
    return { text: s.sentence, keys: s.keys };
  }
  return { text: `${blockers.map((b) => b.summary).join(', ')}${weight}`, keys };
}

/** Labels for every edge at a zoom level. */
export function edgeLabels(model, zoom = 'ticket', absent = new Set()) {
  const ts = new Map(teamSentences(model, absent).map((s) => [s.id, s]));
  // fall back to full set so edges touching an absent person still get a label
  const full = new Map(teamSentences(model).map((s) => [s.id, s]));
  return new Map(model.personEdges.map((e) => [e.id, edgeLabel(model, e, zoom, zoom === 'team' ? new Map([...full, ...ts]) : null)]));
}

/** Word-wrap into at most `maxLines` lines of `maxChars`, ellipsis on overflow. */
export function wrapLabel(text, maxChars = 22, maxLines = 2) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) {
    lines.push(cur);
    cur = '';
    i = words.length;
  }
  const truncated = i < words.length || cur !== '';
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
    lines[lines.length - 1] = `${last.replace(/[\s,]+$/, '')}…`;
  }
  return lines.slice(0, maxLines);
}
