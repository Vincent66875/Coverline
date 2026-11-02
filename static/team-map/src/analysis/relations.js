// Work links added in the app (My work). Pure, no React.
// A relation { fromKey, toKey, type } reads "fromKey <type label> toKey", e.g. "DES-2 builds on DES-6".
// Access is not checked yet: anyone may link any two tasks.
import { RELATION_TYPES, givesContext } from './relationTypes.js';

/** Context links reachable from `key` (for cycle checks: A builds on B builds on A makes no sense). */
function contextClosure(model, key) {
  const seen = new Set();
  const stack = [key];
  while (stack.length) {
    const k = stack.pop();
    for (const r of model.linksByKey.get(k) ?? []) {
      if (r.fromKey !== k || !givesContext(r.type) || seen.has(r.toKey)) continue;
      seen.add(r.toKey);
      stack.push(r.toKey);
    }
  }
  return seen;
}

/** Existing work link between two tasks, either direction, any type. */
export function linkBetween(model, a, b) {
  return (model.linksByKey.get(a) ?? []).find((r) => (r.fromKey === a && r.toKey === b) || (r.fromKey === b && r.toKey === a)) ?? null;
}

/** Can fromKey be linked to toKey with this type? */
export function canAdd(model, fromKey, toKey, type = 'builds_on') {
  const a = model.issueByKey.get(fromKey);
  const b = model.issueByKey.get(toKey);
  if (!a || !b) return { ok: false, reason: 'Unknown ticket' };
  if (!RELATION_TYPES[type]) return { ok: false, reason: 'Unknown relation type' };
  if (a.isEpic || b.isEpic) return { ok: false, reason: 'Pick a task, not an epic' };
  const from = a.workKey;
  const to = b.workKey;
  if (from === to) return { ok: false, reason: 'A task cannot be linked to itself' };
  const existing = linkBetween(model, from, to);
  if (existing) return { ok: false, reason: `Already linked: ${existing.fromKey} ${RELATION_TYPES[existing.type].label} ${existing.toKey}` };
  if (givesContext(type) && contextClosure(model, to).has(from)) return { ok: false, reason: `${to} already builds on ${from} through other links` };
  return { ok: true, fromKey: from, toKey: to, type };
}

/** New relation list with the relation added (or the same list + reason when refused). */
export function addRelation(model, relations, { fromKey, toKey, type = 'builds_on' }, by = null, now = new Date().toISOString()) {
  const c = canAdd(model, fromKey, toKey, type);
  if (!c.ok) return { relations, added: null, reason: c.reason };
  const added = { fromKey: c.fromKey, toKey: c.toKey, type, createdBy: by, createdAt: now };
  return { relations: [...relations, added], added, reason: null };
}

const same = (r, x) => r.fromKey === x.fromKey && r.toKey === x.toKey && (r.type ?? 'builds_on') === x.type;

/** Remove a relation added in the app. Jira links are removed in Jira. */
export function removeRelation(relations, { fromKey, toKey, type }) {
  return relations.filter((r) => !same(r, { fromKey, toKey, type }));
}

/** Change an app relation's type (or flip its direction with swap). */
export function changeRelation(relations, link, { type = link.type, swap = false } = {}) {
  return relations.map((r) => (same(r, link) ? { ...r, type, ...(swap ? { fromKey: r.toKey, toKey: r.fromKey } : {}) } : r));
}

/** Work links touching a task, with the other end and the sentence. */
export function linksOf(model, key) {
  return (model.linksByKey.get(key) ?? []).map((r) => ({
    ...r,
    other: r.fromKey === key ? r.toKey : r.fromKey,
    sentence: `${r.fromKey} ${RELATION_TYPES[r.type].label} ${r.toKey}`,
  }));
}

// ------------------------------------------------------------------ per-viewer storage (MVP only)
// In the Forge version these become Jira issue links (Builds on, Follows up, Replaces, Fixes, Relates).
const storeKey = (fixtureName, what) => `jtm:${fixtureName}:${what}`;

export function loadList(fixtureName, what) {
  try {
    const raw = globalThis.localStorage?.getItem(storeKey(fixtureName, what));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveList(fixtureName, what, list) {
  try {
    globalThis.localStorage?.setItem(storeKey(fixtureName, what), JSON.stringify(list));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}
