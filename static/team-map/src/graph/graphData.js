// Everything the graph component needs, from the model. Pure, no React.
import { coverageRisk, coverBadges, absenceImpact, coverText } from '../analysis/scoring.js';
import { edgeLabels } from '../analysis/labels.js';
import { peopleOnWork } from '../analysis/search.js';
import { computeLayout, nodeRadius } from './layout.js';

/**
 * Positions come from baseline scores (nobody out) so people don't jump when someone is
 * marked out; node size, score, badges, labels and rings are live.
 */
export function graphData(model, { zoom = 'ticket', absent = new Set(), selectedId = null } = {}) {
  const baseline = new Map(model.people.map((p) => [p.accountId, coverageRisk(model, p.accountId).score]));
  const risk = new Map(model.people.map((p) => [p.accountId, coverageRisk(model, p.accountId, absent)]));
  const labels = edgeLabels(model, zoom, absent);
  const badges = coverBadges(model, absent);
  // team zoom: each team sentence is written once, on the heaviest arrow of that team pair
  const shown = new Set();
  const edgeText = new Map();
  const byWeight = [...model.personEdges].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  for (const e of byWeight) {
    const t = labels.get(e.id).text;
    if (zoom === 'team' && shown.has(t)) edgeText.set(e.id, '');
    else {
      shown.add(t);
      edgeText.set(e.id, t);
    }
  }
  const layout = computeLayout({
    zoom,
    people: model.people.map((p) => ({ id: p.accountId, name: p.name, team: p.team, score: baseline.get(p.accountId) })),
    edges: model.personEdges.map((e) => ({ id: e.id, from: e.waiterId, to: e.blockerId, weight: e.weight, label: edgeText.get(e.id) })),
  });
  for (const n of layout.nodes) {
    n.r0 = n.r; // baseline radius: text and routing stay put
    n.r = nodeRadius(risk.get(n.id).score);
  }

  const impact = absent.size ? absenceImpact(model, absent) : null;
  const rings = new Map();
  if (impact) {
    const add = (id, kind) => rings.set(id, [...(rings.get(id) ?? []), kind]);
    for (const w of impact.leftWaiting) add(w.personId, 'waiting');
    for (const c of impact.context) if (!absent.has(c.personId)) add(c.personId, 'context');
  }
  const knowledge = selectedId ? peopleOnWork(model, selectedId, { absent }) : [];

  const edgeById = new Map(model.personEdges.map((e) => [e.id, e]));
  const sentences = model.personEdges.flatMap((e) =>
    e.pairs.map((p) => {
      const b = badges.get(e.id).pairs.find((x) => x.blockerKey === p.blockerKey);
      const cover = coverText(model, b, e.blockerId);
      const broken = absent.has(e.blockerId) ? ` ${model.nameOf(e.blockerId)} is marked out, so this work stalls.` : '';
      return { edgeId: e.id, text: `${p.sentence} Cover: ${cover}.${broken}` };
    }),
  );
  return { layout, risk, baseline, labels, badges, edgeById, sentences, zoom, impact, rings, knowledge };
}
