// Suggest earlier work a current task may build on. Pure, no React.
// Never applied automatically: the person confirms or dismisses each suggestion.
import { toMs, DAY_MS, agoText } from './dates.js';

export const SUGGEST_DAYS = 90;
export const SUGGEST_MAX = 5;
const MIN_SCORE = 2;

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'at', 'by', 'from', 'set', 'up', 'new', 'add', 'update', 'fix', 'v1', 'v2', 'page', 'task', 'story']);

/** Lower-case words, light stemming, no stop words or numbers. */
export function words(text) {
  return [
    ...new Set(
      String(text ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
        .map((w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
        .filter((w) => !STOP.has(w)),
    ),
  ];
}

/** Candidate pool: Done work items in the last `days` by the person or their team. */
export function candidatePool(model, personId, { days = SUGGEST_DAYS, scope = 'team' } = {}) {
  const me = model.personById.get(personId);
  const team = me?.team;
  const nowMs = toMs(model.asOf);
  const inScope = (id) => id === personId || (scope === 'team' && team && model.personById.get(id)?.team === team);
  return model.issues.filter(
    (i) => i.done && !i.isEpic && !i.isSubtask && i.ownerId && inScope(i.ownerId) && nowMs - toMs(i.resolved ?? i.updated) <= days * DAY_MS,
  );
}

/** Ranked suggestions for one current task. */
export function suggestBuildsOn(model, taskKey, personId, { dismissed = [], days = SUGGEST_DAYS, max = SUGGEST_MAX, scope = 'team' } = {}) {
  const task = model.issueByKey.get(taskKey);
  if (!task) return [];
  const linked = new Set((model.linksByKey.get(taskKey) ?? []).map((r) => (r.fromKey === taskKey ? r.toKey : r.fromKey)));
  const no = new Set(dismissed);
  const tw = words(task.summary);
  const nowMs = toMs(model.asOf);
  const out = [];
  for (const c of candidatePool(model, personId, { days, scope })) {
    if (c.key === taskKey || linked.has(c.key) || no.has(`${taskKey}<${c.key}`)) continue;
    let score = 0;
    const why = [];
    if (task.epicKey && c.epicKey === task.epicKey) {
      score += 3;
      why.push('same epic');
    }
    const comp = c.components.filter((x) => task.components.includes(x));
    if (comp.length) {
      score += 2;
      why.push(`same component ${comp.join(', ')}`);
    }
    const lab = c.labels.filter((x) => task.labels.includes(x));
    if (lab.length) {
      score += 2;
      why.push(`same label ${lab.join(', ')}`);
    }
    const shared = words(c.summary).filter((w) => tw.includes(w));
    if (shared.length) {
      score += Math.min(3, shared.length * 1.5);
      why.push(`shares ${shared.map((w) => `'${w}'`).join(', ')}`);
    }
    if (score < MIN_SCORE) continue; // ownership and recency alone are not a reason
    if (c.ownerId === personId) score += 0.5;
    const ageDays = (nowMs - toMs(c.resolved ?? c.updated)) / DAY_MS;
    score += Math.max(0, 1 - ageDays / days);
    out.push({
      fromKey: taskKey,
      toKey: c.key,
      summary: c.summary,
      ownerId: c.ownerId,
      owner: model.nameOf(c.ownerId),
      mine: c.ownerId === personId,
      done: c.resolved ?? c.updated,
      ago: agoText(c.resolved ?? c.updated, model.asOf),
      score: Math.round(score * 100) / 100,
      reason: why.join(' · '),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.toKey.localeCompare(b.toKey)).slice(0, max);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Recent Done work, newest first: by week for 8 weeks, then by month (12 months, the "has worked on" window). */
export function recentByWeek(model, personId, { days = 365, scope = 'mine' } = {}) {
  const nowMs = toMs(model.asOf);
  const at = (i) => toMs(i.resolved ?? i.updated);
  const items = candidatePool(model, personId, { days, scope }).sort((a, b) => at(b) - at(a));
  const groups = new Map();
  for (const i of items) {
    const w = Math.floor((nowMs - at(i)) / (7 * DAY_MS));
    const d = new Date(at(i));
    const label = w === 0 ? 'This week' : w === 1 ? 'Last week' : w < 8 ? `${w} weeks ago` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    groups.set(label, [...(groups.get(label) ?? []), i]);
  }
  return [...groups].map(([label, list]) => ({ label, items: list }));
}
