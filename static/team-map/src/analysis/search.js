// "Who has worked on this?" for a ticket key or an area (epic, component, label).
// Candidates only: this lists people who have worked on related work, nothing more.
import { toMs, DAY_MS, agoText } from './dates.js';
import { KNOWLEDGE_WINDOW_DAYS } from './scoring.js';
import { relationLabel } from './relationTypes.js';

export const MAX_PEOPLE = 5;
const TIER_NAMES = { 1: 'this ticket', 2: 'linked ticket', 3: 'related work' };

const byKeyOrder = (a, b) => {
  const [pa, na] = a.split('-');
  const [pb, nb] = b.split('-');
  return pa === pb ? Number(na) - Number(nb) : pa < pb ? -1 : 1;
};
const isWork = (i) => !i.isEpic && !i.isSubtask;

/** Lists of areas for the search box. */
export function areas(model) {
  const comps = new Set();
  const labels = new Set();
  for (const i of model.issues) {
    i.components.forEach((c) => comps.add(c));
    i.labels.forEach((l) => labels.add(l));
  }
  return {
    epics: model.issues.filter((i) => i.isEpic).map((i) => ({ key: i.key, summary: i.summary })),
    components: [...comps].sort(),
    labels: [...labels].sort(),
  };
}

/**
 * Parse search input. Accepts "DES-2", "epic:DES-1", "component:payments", "label:tokens",
 * or a bare component / label / epic name.
 */
export function resolveQuery(model, input) {
  if (input == null) return null;
  if (typeof input === 'object') return input;
  const s = String(input).trim();
  if (!s) return null;
  const pref = s.match(/^(epic|component|label)\s*:\s*(.+)$/i);
  const a = areas(model);
  if (pref) {
    const kind = pref[1].toLowerCase();
    const v = pref[2].trim();
    if (kind === 'epic') {
      const e = a.epics.find((x) => x.key.toLowerCase() === v.toLowerCase() || x.summary.toLowerCase() === v.toLowerCase());
      return e ? { kind: 'epic', value: e.key } : null;
    }
    const list = kind === 'component' ? a.components : a.labels;
    const hit = list.find((x) => x.toLowerCase() === v.toLowerCase());
    return hit ? { kind, value: hit } : null;
  }
  const issue = model.issues.find((i) => i.key.toLowerCase() === s.toLowerCase());
  if (issue) return issue.isEpic ? { kind: 'epic', value: issue.key } : { kind: 'issue', value: issue.key };
  const comp = a.components.find((x) => x.toLowerCase() === s.toLowerCase());
  if (comp) return { kind: 'component', value: comp };
  const label = a.labels.find((x) => x.toLowerCase() === s.toLowerCase());
  if (label) return { kind: 'label', value: label };
  const epic = a.epics.find((x) => x.summary.toLowerCase() === s.toLowerCase());
  if (epic) return { kind: 'epic', value: epic.key };
  return null;
}

function linkedKeys(model, keys) {
  const set = new Set(keys);
  const out = new Set();
  for (const d of model.dependencies) {
    // all dependency links, open or resolved
    if (set.has(d.waiterKey) && !set.has(d.blockerKey)) out.add(d.blockerKey);
    if (set.has(d.blockerKey) && !set.has(d.waiterKey)) out.add(d.waiterKey);
  }
  return [...out].sort(byKeyOrder);
}

/** Work-link neighbours (both directions, every relation type): key -> reason. */
function workLinkKeys(model, keys) {
  const set = new Set(keys);
  const out = new Map();
  for (const r of model.workLinks ?? []) {
    const why = `${r.fromKey} ${relationLabel(r.type)} ${r.toKey}`;
    if (set.has(r.fromKey) && !set.has(r.toKey)) out.set(r.toKey, why);
    if (set.has(r.toKey) && !set.has(r.fromKey)) out.set(r.fromKey, why);
  }
  return out;
}

/** Tiered keys with the reason each key is related. */
export function relatedWork(model, query) {
  const q = query;
  const tiers = new Map(); // key -> { tier, reason }
  const put = (key, tier, reason) => {
    if (!tiers.has(key)) tiers.set(key, { tier, reason });
  };
  let label;
  if (q.kind === 'issue') {
    const i0 = model.issueByKey.get(q.value);
    const i = model.issueByKey.get(i0.workKey); // a sub-task searches its parent's work
    label = `${i.key} ${i.summary}`;
    put(i.key, 1, i.subtaskKeys.length ? `this ticket and its sub-tasks` : 'this ticket');
    for (const [k, why] of workLinkKeys(model, [i.key])) put(k, 2, why);
    for (const k of linkedKeys(model, [i.key])) put(k, 2, `linked to ${i.key}`);
    for (const o of model.issues) {
      if (!isWork(o) || tiers.has(o.key)) continue;
      const why = [];
      if (i.epicKey && o.epicKey === i.epicKey) why.push(`same epic ${i.epicKey}`);
      const c = o.components.filter((x) => i.components.includes(x));
      if (c.length) why.push(`same component ${c.join(', ')}`);
      const l = o.labels.filter((x) => i.labels.includes(x));
      if (l.length) why.push(`same label ${l.join(', ')}`);
      if (why.length) put(o.key, 3, why.join('; '));
    }
  } else {
    const match =
      q.kind === 'epic' ? (i) => i.epicKey === q.value
        : q.kind === 'component' ? (i) => i.components.includes(q.value)
          : (i) => i.labels.includes(q.value);
    const inArea = model.issues.filter((i) => isWork(i) && match(i)).map((i) => i.key).sort(byKeyOrder);
    const epic = q.kind === 'epic' ? model.issueByKey.get(q.value) : null;
    label = q.kind === 'epic' ? `epic ${epic.key} ${epic.summary}` : `${q.kind} ${q.value}`;
    for (const k of inArea) put(k, 1, `in ${label}`);
    for (const [k, why] of workLinkKeys(model, inArea)) put(k, 2, why);
    for (const k of linkedKeys(model, inArea)) put(k, 2, `linked to ${label}`);
  }
  return { label, tiers };
}

/**
 * Returns up to MAX_PEOPLE people, closest tier first, most recent first within a tier.
 * Each person: one line with all evidence. Work older than 12 months is dropped.
 */
export function whoHasWorkedOn(model, input, { absent = new Set(), max = MAX_PEOPLE, windowDays = KNOWLEDGE_WINDOW_DAYS } = {}) {
  const query = resolveQuery(model, input);
  if (!query) return { query: null, input, label: null, people: [], more: 0, dropped: 0, keys: [] };
  const { label, tiers } = relatedWork(model, query);
  const nowMs = toMs(model.asOf);
  const persons = new Map();
  let dropped = 0;
  for (const [key, { tier, reason }] of tiers) {
    for (const k of model.knowledgeByIssue.get(key) ?? []) {
      if (!k.current && nowMs - toMs(k.when) > windowDays * DAY_MS) {
        dropped++;
        continue;
      }
      const p = persons.get(k.person) ?? { personId: k.person, name: model.nameOf(k.person), out: absent.has(k.person), tier, latest: 0, evidence: [] };
      const whenMs = toMs(k.when);
      p.evidence.push({ tier, tierName: TIER_NAMES[tier], reason, how: k.how, issueKey: key, via: k.via, current: k.current, when: k.when, ago: agoText(k.when, model.asOf) });
      if (tier < p.tier) {
        p.tier = tier;
        p.latest = 0;
      }
      if (tier === p.tier) p.latest = Math.max(p.latest, whenMs);
      persons.set(k.person, p);
    }
  }
  const all = [...persons.values()].sort((a, b) => a.tier - b.tier || b.latest - a.latest || a.name.localeCompare(b.name));
  for (const p of all) {
    p.evidence.sort((a, b) => a.tier - b.tier || toMs(b.when) - toMs(a.when));
    p.line = `${p.name}${p.out ? ' (marked out)' : ''}: ${p.evidence.map(evidenceText).join(' · ')}`;
    const t2 = p.evidence.find((e) => e.tier === 2)?.reason ?? '';
    p.tierLabel = p.tier === 1 ? 'this ticket' : p.tier === 3 ? 'related work' : t2.startsWith('linked to') ? 'linked ticket' : t2;
  }
  return {
    query,
    input,
    label,
    people: all.slice(0, max),
    more: Math.max(0, all.length - max),
    dropped,
    keys: [...tiers.keys()].sort(byKeyOrder),
    tiers: Object.fromEntries([...tiers].map(([k, v]) => [k, v.tier])),
  };
}

/**
 * Knowledge lines for a selected person: other people who have worked on this person's
 * open work (assignee/sub-task/past assignee, last 12 months).
 */
export function peopleOnWork(model, personId, { absent = new Set(), windowDays = KNOWLEDGE_WINDOW_DAYS } = {}) {
  const person = model.personById.get(personId);
  if (!person) return [];
  const nowMs = toMs(model.asOf);
  const out = new Map();
  for (const key of person.openKeys) {
    for (const k of [...(model.knowledgeByIssue.get(key) ?? []), ...(model.contextByIssue?.get(key) ?? [])]) {
      if (k.person === personId) continue;
      if (!k.current && nowMs - toMs(k.when) > windowDays * DAY_MS) continue;
      const e = out.get(k.person) ?? { personId: k.person, name: model.nameOf(k.person), out: absent.has(k.person), items: [] };
      e.items.push({ issueKey: key, how: k.how, via: k.via, relType: k.relType, current: k.current, ago: agoText(k.when, model.asOf) });
      out.set(k.person, e);
    }
  }
  for (const e of out.values()) e.line = `${e.name}${e.out ? ' (marked out)' : ''}: ${e.items.map((i) => evidenceText({ ...i })).join(' · ')}`;
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "Who has worked near this": per open task of the person, others from whoHasWorkedOn (top 3). */
export function workedNear(model, personId, { absent = new Set(), perTask = 3 } = {}) {
  const person = model.personById.get(personId);
  if (!person) return [];
  return person.openKeys.map((key) => {
    const r = whoHasWorkedOn(model, key, { absent, max: perTask + 1 });
    const people = r.people.filter((p) => p.personId !== personId).slice(0, perTask);
    return { issueKey: key, summary: model.issueByKey.get(key).summary, people: people.map((p) => ({ personId: p.personId, name: p.name, out: p.out, tier: p.tier })) };
  });
}

export function evidenceText(e) {
  if (e.how === 'earlier work') return `worked on ${e.via}, which ${e.issueKey} ${relationLabel(e.relType)} (${e.ago})`;
  const via = e.via !== e.issueKey ? ` via ${e.via}` : '';
  return `${e.how} ${e.issueKey}${via} (${e.current ? 'now' : 'before'}, ${e.ago})`;
}
