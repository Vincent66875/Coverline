// Coverage risk per person ("if this person is also out"), chains, absence impact, cover badges.
// Pure module: no React. Input is the model from adapter.buildModel().
import { toMs, DAY_MS } from './dates.js';
import { relationLabel } from './relationTypes.js';

export const WEIGHTS = { cold: 4, warm: 2, blockedOrOverdue: 2, waiting: 4, soleTeamLink: 2, leadChange: 2 };
export const KNOWLEDGE_WINDOW_DAYS = 365;

/** Shown verbatim in the UI. */
export const FORMULA = [
  { kind: 'cold', points: WEIGHTS.cold, text: 'Open task others depend on, no one else left on it, no one else has worked on it (cold)', unit: 'each' },
  { kind: 'warm', points: WEIGHTS.warm, text: 'Open task others depend on, no one else left on it, someone else has worked on it before (warm)', unit: 'each' },
  { kind: 'blockedOrOverdue', points: WEIGHTS.blockedOrOverdue, text: '…and that task is Blocked, flagged or overdue', unit: 'extra' },
  { kind: 'waiting', points: WEIGHTS.waiting, text: 'Each distinct person left waiting, following chains all the way', unit: 'each' },
  { kind: 'soleTeamLink', points: WEIGHTS.soleTeamLink, text: 'Team pair connected only through this person', unit: 'each' },
  { kind: 'leadChange', points: WEIGHTS.leadChange, text: 'Task others depend on whose lead would change (lead via reporter fallback)', unit: 'each' },
];
export const FORMULA_NOTES = [
  'Solo tasks nothing depends on are listed, never scored.',
  'Stale (not Done, no update in 14 days) is a separate flag, never scored.',
  '"Has worked on" means assignee, sub-task assignee or past assignee in the last 12 months.',
  'Someone who worked on a task this one builds on, follows up on, replaces or fixes makes it warm (context), but never counts as still on it.',
  'People already marked out are not counted as left waiting, left on a task, or as having worked on it.',
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = (xs) => [...new Set(xs)];
const byKeyOrder = (a, b) => {
  const [pa, na] = a.split('-');
  const [pb, nb] = b.split('-');
  return pa === pb ? Number(na) - Number(nb) : pa < pb ? -1 : 1;
};
const sortKeys = (keys) => uniq(keys).sort(byKeyOrder);
const toSet = (x) => (x instanceof Set ? x : new Set(x ?? []));

/** Graph indexes, cached on the model. */
export function graph(model) {
  if (model._graph) return model._graph;
  const dependents = new Map(); // blockerKey -> [waiterKey]
  const blockers = new Map(); // waiterKey -> [blockerKey]
  for (const d of model.dependencies) {
    if (!d.open) continue;
    (dependents.get(d.blockerKey) ?? dependents.set(d.blockerKey, []).get(d.blockerKey)).push(d.waiterKey);
    (blockers.get(d.waiterKey) ?? blockers.set(d.waiterKey, []).get(d.waiterKey)).push(d.blockerKey);
  }
  const ownedOpen = new Map(); // personId -> open top-level work keys
  for (const p of model.people) ownedOpen.set(p.accountId, p.openKeys);
  const teamOf = new Map(model.people.map((p) => [p.accountId, p.team]));
  model._graph = { dependents, blockers, ownedOpen, teamOf };
  return model._graph;
}

/** People who have worked on an issue (records credited to it), within the window. */
export function workedOn(model, issueKey, { absent = new Set(), windowDays = KNOWLEDGE_WINDOW_DAYS, earlierWork = true } = {}) {
  const nowMs = toMs(model.asOf);
  const keep = (k) => !absent.has(k.person) && (k.current || nowMs - toMs(k.when) <= windowDays * DAY_MS);
  const recs = (model.knowledgeByIssue.get(issueKey) ?? []).filter(keep);
  // People who worked on earlier work this task builds on: context, never "still on it" (current is false).
  if (earlierWork) recs.push(...(model.contextByIssue?.get(issueKey) ?? []).filter(keep));
  const byPerson = new Map();
  for (const k of recs) {
    const e = byPerson.get(k.person) ?? { personId: k.person, current: false, records: [] };
    e.current ||= k.current;
    e.records.push(k);
    byPerson.set(k.person, e);
  }
  for (const e of byPerson.values()) {
    e.onlyEarlier = e.records.every((r) => r.how === 'earlier work');
    e.earlierKeys = uniq(e.records.filter((r) => r.how === 'earlier work').map((r) => r.via));
    const seen = new Set();
    e.earlier = e.records
      .filter((r) => r.how === 'earlier work' && !seen.has(`${r.via}|${r.relType}`) && seen.add(`${r.via}|${r.relType}`))
      .map((r) => ({ key: r.via, type: r.relType }));
  }
  return [...byPerson.values()];
}

/** "Noah also worked on DES-3" / "Noah worked on DES-6, which DES-2 builds on". */
export function contextPhrase(model, w, issueKey) {
  const name = model.nameOf(w.personId);
  if (!w.onlyEarlier) return `${name} also worked on ${issueKey}`;
  return w.earlier.map((e) => `${name} worked on ${e.key}, which ${issueKey} ${relationLabel(e.type)}`).join('; ');
}

function warmWhy(entry) {
  const parts = [];
  if (entry.workedBefore.length) parts.push(`${entry.workedBefore.join(', ')} worked on it before`);
  for (const e of entry.earlierWork) parts.push(e.earlier.map((x) => `${e.name} worked on ${x.key}, which it ${relationLabel(x.type)}`).join('; '));
  return parts.join('; ');
}

/** Cover sentence for one blocking task of a badge. */
export function coverText(model, pair, blockerOwnerId) {
  return pair.color === 'green' ? pair.context.map((c) => c.phrase).join('; ') : `only ${model.nameOf(blockerOwnerId)} has worked on ${pair.blockerKey}`;
}

/**
 * BFS over open task dependencies, from `roots` to everything that waits on them.
 * Returns per reached task its parent (toward the root) and root.
 */
function reach(model, roots) {
  const { dependents } = graph(model);
  const parent = new Map();
  const rootOf = new Map();
  const queue = [];
  for (const r of roots) {
    parent.set(r, null);
    rootOf.set(r, r);
    queue.push(r);
  }
  while (queue.length) {
    const t = queue.shift();
    for (const w of dependents.get(t) ?? []) {
      if (parent.has(w)) continue; // cycle / already reached
      parent.set(w, t);
      rootOf.set(w, rootOf.get(t));
      queue.push(w);
    }
  }
  return { parent, rootOf };
}

function taskPath(parent, key) {
  const path = [];
  for (let k = key; k != null; k = parent.get(k)) path.push(k);
  return path; // waiter ... root(blocker)
}

/** People left waiting if `stalled` tasks stop, with the shortest chain for each. */
export function peopleLeftWaiting(model, stalledKeys, exclude) {
  const { parent } = reach(model, stalledKeys);
  const out = new Map();
  for (const key of parent.keys()) {
    if (stalledKeys.includes(key)) continue;
    const owner = model.issueByKey.get(key).ownerId;
    if (!owner || exclude.has(owner) || out.has(owner)) continue;
    const keys = taskPath(parent, key);
    const people = [];
    for (const k of keys) {
      const o = model.issueByKey.get(k).ownerId;
      if (people[people.length - 1] !== o) people.push(o);
    }
    out.set(owner, {
      personId: owner,
      name: model.nameOf(owner),
      keys,
      chain: people.map(model.nameOf),
      chainText: people.map(model.nameOf).join(' → '),
      keysText: keys.join(' → '),
    });
  }
  // BFS order already gives shortest chains; sort for stable output
  return [...out.values()].sort((a, b) => a.keys.length - b.keys.length || a.name.localeCompare(b.name));
}

function teamPairs(model, absent) {
  const { teamOf } = graph(model);
  const pairs = new Map();
  for (const e of model.personEdges) {
    if (absent.has(e.waiterId) || absent.has(e.blockerId)) continue;
    const a = teamOf.get(e.waiterId);
    const b = teamOf.get(e.blockerId);
    if (!a || !b || a === b) continue;
    const id = [a, b].sort().join(' – ');
    const entry = pairs.get(id) ?? { id, teams: [a, b].sort(), edges: [] };
    entry.edges.push(e);
    pairs.set(id, entry);
  }
  return [...pairs.values()];
}

/** Lead = assignee if present and not out, else human reporter if not out. */
function effectiveLead(model, issue, absent) {
  if (issue.ownerId && !absent.has(issue.ownerId)) return { id: issue.ownerId, source: 'assignee' };
  const r = issue.reporterId;
  if (r && model.personById.has(r) && !absent.has(r)) return { id: r, source: 'reporter' };
  return { id: null, source: null };
}

function waitingOwners(model, key, exclude) {
  const { dependents } = graph(model);
  return (dependents.get(key) ?? [])
    .map((w) => model.issueByKey.get(w).ownerId)
    .filter((o) => o && !exclude.has(o));
}

/** Headline: tasks that start once this person's blocking work is done. */
export function unblock(model, personId) {
  const { dependents, blockers, ownedOpen } = graph(model);
  const mine = new Set(ownedOpen.get(personId) ?? []);
  const waiters = sortKeys(
    [...mine].flatMap((k) => dependents.get(k) ?? []).filter((w) => model.issueByKey.get(w).ownerId !== personId),
  );
  const startKeys = waiters.filter((w) => (blockers.get(w) ?? []).every((b) => mine.has(b)));
  const alsoWaitKeys = waiters.filter((w) => !startKeys.includes(w));
  const name = model.nameOf(personId);
  let sentence = `${plural(startKeys.length, 'task')} ${startKeys.length === 1 ? 'starts' : 'start'} once ${name}'s blocking work is done.`;
  if (alsoWaitKeys.length) sentence = sentence.slice(0, -1) + `; ${alsoWaitKeys.length} more also ${alsoWaitKeys.length === 1 ? 'waits' : 'wait'} on other work.`;
  return { sentence, startKeys, alsoWaitKeys, blockingKeys: sortKeys([...mine].filter((k) => (dependents.get(k) ?? []).length)) };
}

/**
 * Coverage risk for one person, "if this person is also out".
 * absent: people already marked out (the person themself is ignored if included).
 */
export function coverageRisk(model, personId, absentIn = new Set()) {
  const absent = new Set(toSet(absentIn));
  absent.delete(personId);
  const out = new Set([...absent, personId]); // everyone gone in this hypothesis
  const { ownedOpen } = graph(model);
  const name = model.nameOf(personId);
  const mine = ownedOpen.get(personId) ?? [];
  const components = [];
  const issue = (k) => model.issueByKey.get(k);

  // people left waiting (chains)
  const waiting = peopleLeftWaiting(model, mine, out);
  const reachedFrom = new Map(mine.map((k) => [k, peopleLeftWaiting(model, [k], out).length > 0]));

  // 1. open tasks others depend on with no one else left
  const noOneLeft = [];
  const covered = [];
  const solo = [];
  for (const k of mine) {
    const i = issue(k);
    if (!reachedFrom.get(k)) {
      solo.push(k);
      continue;
    }
    const others = workedOn(model, k, { absent: out });
    const left = others.filter((o) => o.current);
    if (left.length) {
      covered.push({ key: k, leftOn: left.map((o) => model.nameOf(o.personId)), personIds: left.map((o) => o.personId) });
      continue;
    }
    const warm = others.length > 0;
    const bo = i.blocked || i.overdue;
    const points = (warm ? WEIGHTS.warm : WEIGHTS.cold) + (bo ? WEIGHTS.blockedOrOverdue : 0);
    const entry = {
      key: k,
      summary: i.summary,
      warm,
      workedBefore: others.filter((o) => !o.onlyEarlier).map((o) => model.nameOf(o.personId)),
      earlierWork: others.filter((o) => o.onlyEarlier).map((o) => ({ name: model.nameOf(o.personId), keys: o.earlierKeys, earlier: o.earlier })),
      blocked: i.blocked,
      statusBlocked: i.statusBlocked,
      flagged: i.flagged,
      overdue: i.overdue,
      points,
    };
    noOneLeft.push(entry);
    const flags = [i.statusBlocked && 'Blocked', i.flagged && 'flagged', i.overdue && 'overdue'].filter(Boolean).join(', ');
    components.push({
      kind: warm ? 'warm' : 'cold',
      points: warm ? WEIGHTS.warm : WEIGHTS.cold,
      text: `${k} ${warm ? 'warm' : 'cold'}: no one else left on it${warm ? `, ${warmWhy(entry)}` : ''}`,
      keys: uniq([k, ...entry.earlierWork.flatMap((x) => x.keys)]),
    });
    if (bo) components.push({ kind: 'blockedOrOverdue', points: WEIGHTS.blockedOrOverdue, text: `${k} is ${flags}`, keys: [k] });
  }

  if (waiting.length) {
    components.push({
      kind: 'waiting',
      points: WEIGHTS.waiting * waiting.length,
      text: `${plural(waiting.length, 'person', 'people')} left waiting: ${waiting.map((w) => w.name).join(', ')}`,
      keys: sortKeys(waiting.flatMap((w) => w.keys)),
    });
  }

  // 3. sole team links
  const soleTeamLinks = [];
  for (const p of teamPairs(model, absent)) {
    const involves = (e) => e.waiterId === personId || e.blockerId === personId;
    if (p.edges.some(involves) && p.edges.every(involves)) {
      const keys = sortKeys(p.edges.flatMap((e) => e.pairs.flatMap((x) => [x.waiterKey, x.blockerKey])));
      soleTeamLinks.push({ id: p.id, teams: p.teams, keys });
      components.push({ kind: 'soleTeamLink', points: WEIGHTS.soleTeamLink, text: `only link between ${p.id}`, keys });
    }
  }

  // 4. lead changes: tasks others depend on where this person is lead by reporter fallback
  const leadChanges = [];
  const leadOnly = [];
  for (const i of model.issues) {
    if (i.done || i.isEpic || i.isSubtask) continue;
    const lead = effectiveLead(model, i, absent);
    if (lead.id !== personId || lead.source !== 'reporter') continue;
    const why = !i.assigneeId ? 'unassigned' : i.assigneeExcluded ? `assignee ${model.nameOf(i.assigneeId)} ${model.excluded.find((e) => e.accountId === i.assigneeId)?.reason ?? 'excluded'}` : `assignee ${model.nameOf(i.assigneeId)} out`;
    if (!waitingOwners(model, i.key, out).length) {
      leadOnly.push({ key: i.key, why });
      continue;
    }
    const next = effectiveLead(model, i, out);
    const entry = { key: i.key, summary: i.summary, why, nextLead: next.id ? model.nameOf(next.id) : null };
    leadChanges.push(entry);
    components.push({
      kind: 'leadChange',
      points: WEIGHTS.leadChange,
      text: `${i.key} lead would change (${name} is lead as reporter, ${why}; next: ${entry.nextLead ?? 'no lead'})`,
      keys: sortKeys([i.key, ...(graph(model).dependents.get(i.key) ?? [])]),
    });
  }

  const score = components.reduce((s, c) => s + c.points, 0);
  return {
    personId,
    name,
    team: model.personById.get(personId)?.team ?? null,
    score,
    components,
    reasonText: components.map((c) => `${c.text} (+${c.points})`).join(' · '),
    noOneLeft,
    covered,
    waiting,
    soleTeamLinks,
    leadChanges,
    solo: sortKeys(solo),
    leadOnly,
    stale: mine.filter((k) => issue(k).stale),
    unblock: unblock(model, personId),
  };
}

/** Everyone with score > 0, highest first. `out` people are flagged, scored as if others are out. */
export function ranking(model, absentIn = new Set()) {
  const absent = toSet(absentIn);
  const base = absent.size ? ranking(model, new Set()) : null;
  const baseById = new Map((base?.all ?? []).map((r) => [r.personId, r.score]));
  const all = model.people.map((p) => {
    const r = coverageRisk(model, p.accountId, absent);
    const baseline = base ? baseById.get(p.accountId) : r.score;
    return { ...r, out: absent.has(p.accountId), baseline, delta: r.score - baseline };
  });
  all.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { rows: all.filter((r) => r.score > 0 || r.delta !== 0), all };
}

/** What stalls when `absent` people are out. */
export function absenceImpact(model, absentIn) {
  const absent = toSet(absentIn);
  const { ownedOpen } = graph(model);
  const stalled = sortKeys([...absent].flatMap((id) => ownedOpen.get(id) ?? []));
  const brokenEdges = model.personEdges.filter((e) => absent.has(e.blockerId)).map((e) => e.id);
  const waiting = peopleLeftWaiting(model, stalled, absent);
  const context = new Map();
  for (const k of stalled) {
    const owner = model.issueByKey.get(k).ownerId;
    for (const w of workedOn(model, k, { absent })) {
      if (w.personId === owner) continue;
      const e = context.get(w.personId) ?? { personId: w.personId, name: model.nameOf(w.personId), items: [] };
      e.items.push({ key: k, current: w.current, how: uniq(w.records.map((r) => r.how)), via: uniq(w.records.map((r) => r.via)) });
      context.set(w.personId, e);
    }
  }
  const r = ranking(model, absent);
  return {
    absent: [...absent],
    stalledKeys: stalled,
    brokenEdges,
    leftWaiting: waiting,
    context: [...context.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ranking: r.rows,
  };
}

/** Cover badge per pair and per person edge: green if someone other than the blocker's owner has worked on the blocking task. */
export function coverBadges(model, absentIn = new Set()) {
  const absent = toSet(absentIn);
  const badges = new Map();
  for (const e of model.personEdges) {
    const pairs = uniq(e.pairs.map((p) => p.blockerKey)).map((blockerKey) => ({ blockerKey })).map((p) => {
      const others = workedOn(model, p.blockerKey, { absent }).filter((w) => w.personId !== e.blockerId);
      return {
        blockerKey: p.blockerKey,
        color: others.length ? 'green' : 'amber',
        others: others.map((o) => model.nameOf(o.personId)),
        context: others.map((o) => ({ personId: o.personId, name: model.nameOf(o.personId), onlyEarlier: o.onlyEarlier, phrase: contextPhrase(model, o, p.blockerKey) })),
      };
    });
    badges.set(e.id, { edgeId: e.id, color: pairs.every((p) => p.color === 'green') ? 'green' : 'amber', pairs });
  }
  return badges;
}
