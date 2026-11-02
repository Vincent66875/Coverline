// Where links drawn in My work are saved.
// A real Jira issue link when the site has a link type for that relation (e.g. an admin created "Builds on"),
// otherwise the app's Forge storage (through the resolver), marked "saved in app".
// Pure: request (Jira REST) and invoke (Forge resolver) are injected.
import { relationDirection, relationTypeOfJira } from '../analysis/relationTypes.js';

/** Site link type for a relation, by its wording; null when the site has none. "Relates" exists by default. */
export function jiraTypeFor(linkTypes, relType) {
  return (linkTypes ?? []).find((t) => relationTypeOfJira(t) === relType) ?? null;
}

/** Which relations the site can store as Jira links. */
export function jiraCoverage(linkTypes, relTypes) {
  return Object.fromEntries(relTypes.map((t) => [t, jiraTypeFor(linkTypes, t)?.name ?? null]));
}

async function linksOn(request, key) {
  const issue = await request(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=issuelinks`);
  return issue?.fields?.issuelinks ?? [];
}

/**
 * Create "fromKey <relation> toKey" as a Jira issue link and return its id.
 * Jira's POST body names the two ends inwardIssue/outwardIssue, and which one the outward wording
 * applies to is easy to get backwards, so the result is read back from fromKey and fixed if reversed.
 */
export async function createJiraLink(request, linkType, fromKey, toKey) {
  const fromIsOutwardSubject = relationDirection(linkType) === 'outward-newer'; // "A builds on B": A carries the outward wording
  const subject = fromIsOutwardSubject ? fromKey : toKey;
  const object = fromIsOutwardSubject ? toKey : fromKey;
  const post = (inward, outward) =>
    request('/rest/api/3/issueLink', { method: 'POST', body: { type: { id: linkType.id }, inwardIssue: { key: inward }, outwardIssue: { key: outward } } });
  // Seen from `subject`, the link must show the other issue as outwardIssue ("subject <outward> object").
  const find = async () => (await linksOn(request, subject)).find((l) => l.type?.id === linkType.id && ((l.outwardIssue ?? l.inwardIssue)?.key === object));
  await post(subject, object);
  let link = await find();
  if (!link) throw new Error(`Link ${fromKey} → ${toKey} was not found after creating it.`);
  const symmetric = (linkType.inward ?? '').toLowerCase() === (linkType.outward ?? '').toLowerCase();
  if (!symmetric && !link.outwardIssue) {
    // came out reversed: recreate with the ends swapped
    await request(`/rest/api/3/issueLink/${link.id}`, { method: 'DELETE' });
    await post(object, subject);
    link = await find();
    if (!link?.outwardIssue) throw new Error(`Could not create ${fromKey} → ${toKey} in the right direction.`);
  }
  return link.id;
}

/**
 * makeLinkStore({ request, invoke, linkTypes }) ->
 *   add(link) / remove(link) / change(link, { type, swap }), each resolving to
 *   { saved: 'jira' | 'app', keys: [issue keys whose Jira links changed] }.
 * link: { fromKey, toKey, type, source?, linkId? } (source/linkId come from the model's workLinks)
 */
export function makeLinkStore({ request, invoke, linkTypes }) {
  const add = async (link) => {
    const jt = jiraTypeFor(linkTypes, link.type);
    if (jt) {
      await createJiraLink(request, jt, link.fromKey, link.toKey);
      return { saved: 'jira', keys: [link.fromKey, link.toKey] };
    }
    await invoke('addAppLink', { fromKey: link.fromKey, toKey: link.toKey, type: link.type });
    return { saved: 'app', keys: [] };
  };
  const remove = async (link) => {
    if (link.source === 'jira') {
      await request(`/rest/api/3/issueLink/${link.linkId}`, { method: 'DELETE' });
      return { saved: 'jira', keys: [link.fromKey, link.toKey] };
    }
    await invoke('removeAppLink', { fromKey: link.fromKey, toKey: link.toKey, type: link.type });
    return { saved: 'app', keys: [] };
  };
  const change = async (link, { type = link.type, swap = false } = {}) => {
    const next = { fromKey: swap ? link.toKey : link.fromKey, toKey: swap ? link.fromKey : link.toKey, type };
    const r1 = await remove(link);
    const r2 = await add(next);
    return { saved: r2.saved, keys: [...r1.keys, ...r2.keys], next };
  };
  return { add, remove, change, coverage: (types) => jiraCoverage(linkTypes, types) };
}
