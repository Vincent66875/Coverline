// Load one project's data from Jira Cloud in the shape the analysis code expects
// ({ name, asOf, users[], issues[] } with fields + changelog, as in the MVP fixtures).
// Pure: `request(path, { method, body })` is injected (see request.js).
//
// What it reads:
// 1. the project's issues: open, or resolved in the last 12 months (the "has worked on" window)
// 2. one hop of linked issues in other projects (so cross-team waits show), and missing parents (epics)
// 3. full changelogs where search returned only part (the new search caps them at 20 entries)
// 4. the Atlassian Team field, if the site has it, to put people in team columns
// 5. issue link types, so the app can write links people draw in My work

export const TEAM_FIELD_TYPE = 'com.atlassian.teams:rm-teams-custom-field-team';
// Jira Software's "Flagged" marker: a checkbox custom field (id varies per site) whose value is [{ value: 'Impediment' }]
const isFlaggedField = (f) => /^flagged$/i.test(f.name ?? '') && (f.custom ?? true) !== false;
export const FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'reporter', 'project', 'components', 'labels', 'duedate', 'created', 'updated', 'resolutiondate', 'parent', 'issuelinks'];
const KEEP_ITEMS = new Set(['assignee', 'status']); // the only changelog items the analysis reads
const KEY_CHUNK = 50; // keys per "key in (...)" query
const quote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

export const projectJql = (projectKey, days = 365) =>
  `project = ${quote(projectKey)} AND (statusCategory != Done OR resolved >= -${days}d) ORDER BY key ASC`;

async function searchAll(request, jql, fields, { pageSize = 100, maxIssues = 2000, onPage } = {}) {
  const issues = [];
  let nextPageToken;
  let truncated = false;
  do {
    const page = await request('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields, expand: 'changelog', maxResults: pageSize, ...(nextPageToken ? { nextPageToken } : {}) },
    });
    issues.push(...(page?.issues ?? []));
    nextPageToken = page?.nextPageToken;
    onPage?.(issues.length);
    if (issues.length >= maxIssues && nextPageToken) {
      truncated = true;
      break;
    }
  } while (nextPageToken);
  return { issues, truncated };
}

async function fullChangelog(request, key) {
  const histories = [];
  for (let startAt = 0; ; ) {
    const page = await request(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`);
    const values = page?.values ?? [];
    histories.push(...values);
    startAt += values.length;
    if (page?.isLast || values.length === 0 || (page?.total != null && startAt >= page.total)) break;
  }
  return histories;
}

async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Keep only what the analysis reads; drop other changelog items. */
function trim(issue, flaggedField) {
  const histories = (issue.changelog?.histories ?? [])
    .map((h) => ({ id: h.id, author: h.author, created: h.created, items: (h.items ?? []).filter((it) => KEEP_ITEMS.has(it.field)) }))
    .filter((h) => h.items.length);
  const fields = { ...issue.fields };
  if (flaggedField) {
    const v = fields[flaggedField];
    fields.flagged = Array.isArray(v) ? v.length > 0 : !!v;
    delete fields[flaggedField];
  }
  return { id: issue.id, key: issue.key, fields, changelog: { total: histories.length, histories } };
}

function needsChangelog(issue) {
  const c = issue.changelog;
  if (!c) return true;
  const got = c.histories?.length ?? 0;
  return c.total != null ? c.total > got : got >= 20;
}

/** People seen on issues, with a team from the Team field (their most common team as assignee). */
export function deriveUsers(issues, teamField) {
  const users = new Map();
  const teamVotes = new Map();
  const see = (u) => {
    if (!u?.accountId) return;
    const avatarUrl = u.avatarUrls?.['48x48'] ?? null; // the picture the person set in their Atlassian profile (or Atlassian's default)
    const prev = users.get(u.accountId);
    if (prev) {
      if (!prev.avatarUrl && avatarUrl) prev.avatarUrl = avatarUrl;
      return;
    }
    users.set(u.accountId, { accountId: u.accountId, displayName: u.displayName ?? u.accountId, active: u.active !== false, accountType: u.accountType ?? 'atlassian', groups: [], avatarUrl });
  };
  for (const i of issues) {
    const f = i.fields ?? {};
    see(f.assignee);
    see(f.reporter);
    for (const h of i.changelog?.histories ?? []) see(h.author);
    const team = teamField ? f[teamField] : null;
    const name = team?.name ?? team?.title;
    if (f.assignee?.accountId && name) {
      const votes = teamVotes.get(f.assignee.accountId) ?? new Map();
      votes.set(name, (votes.get(name) ?? 0) + 1);
      teamVotes.set(f.assignee.accountId, votes);
    }
  }
  for (const [id, votes] of teamVotes) {
    const [best] = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (users.has(id)) users.get(id).team = best[0];
  }
  return [...users.values()];
}

/**
 * loadProjectData(request, projectKey, { now, onProgress }) ->
 *   { name, asOf, users, issues, linkTypes, meta }
 */
export async function loadProjectData(request, projectKey, { now = new Date().toISOString(), onProgress = () => {}, maxIssues = 2000, maxChangelogFetches = 300 } = {}) {
  const meta = { projectKey, teamField: null, flaggedField: null, projectIssues: 0, linkedIssues: 0, parentIssues: 0, truncated: false, hiddenLinked: [], changelogFetched: 0, changelogIncomplete: 0, warnings: [] };

  onProgress({ step: 'fields' });
  try {
    const fields = await request('/rest/api/3/field');
    meta.teamField = (fields ?? []).find((f) => f.schema?.custom === TEAM_FIELD_TYPE)?.id ?? null;
    meta.flaggedField = (fields ?? []).find(isFlaggedField)?.id ?? null;
  } catch (e) {
    meta.warnings.push(`Could not read fields (${e.status ?? e.message}); teams come from projects.`);
  }
  const fieldList = [...FIELDS, ...(meta.teamField ? [meta.teamField] : []), ...(meta.flaggedField ? [meta.flaggedField] : [])];

  onProgress({ step: 'issues', loaded: 0 });
  const main = await searchAll(request, projectJql(projectKey), fieldList, { maxIssues, onPage: (n) => onProgress({ step: 'issues', loaded: n }) });
  meta.projectIssues = main.issues.length;
  meta.truncated = main.truncated;
  const byKey = new Map(main.issues.map((i) => [i.key, i]));

  const fetchKeys = async (keys, step) => {
    const found = [];
    for (let i = 0; i < keys.length; i += KEY_CHUNK) {
      const chunk = keys.slice(i, i + KEY_CHUNK);
      onProgress({ step, loaded: found.length, of: keys.length });
      const r = await searchAll(request, `key in (${chunk.map(quote).join(',')}) ORDER BY key ASC`, fieldList, { maxIssues });
      for (const issue of r.issues) if (!byKey.has(issue.key)) found.push(issue);
      for (const issue of r.issues) byKey.set(issue.key, issue);
    }
    return found;
  };

  // one hop of linked issues (any link type), so waits on other projects' work show up
  const linkedKeys = new Set();
  for (const i of main.issues)
    for (const l of i.fields?.issuelinks ?? []) {
      const other = (l.outwardIssue ?? l.inwardIssue)?.key;
      if (other && !byKey.has(other)) linkedKeys.add(other);
    }
  const linked = await fetchKeys([...linkedKeys].sort(), 'linked');
  meta.linkedIssues = linked.length;
  meta.hiddenLinked = [...linkedKeys].filter((k) => !byKey.has(k)).sort(); // deleted, or in projects you cannot browse

  // missing parents (e.g. an epic resolved long ago with open children)
  const parentKeys = new Set();
  for (const i of byKey.values()) {
    const p = i.fields?.parent?.key;
    if (p && !byKey.has(p)) parentKeys.add(p);
  }
  meta.parentIssues = (await fetchKeys([...parentKeys].sort(), 'parents')).length;

  // complete changelogs search cut short
  const short = [...byKey.values()].filter(needsChangelog);
  const toFetch = short.slice(0, maxChangelogFetches);
  meta.changelogIncomplete = short.length - toFetch.length;
  let done = 0;
  await pool(toFetch, 4, async (issue) => {
    try {
      const histories = await fullChangelog(request, issue.key);
      issue.changelog = { total: histories.length, histories };
      meta.changelogFetched++;
    } catch (e) {
      meta.changelogIncomplete++;
      meta.warnings.push(`Changelog for ${issue.key} not read (${e.status ?? e.message}).`);
    }
    onProgress({ step: 'history', loaded: ++done, of: toFetch.length });
  });

  onProgress({ step: 'link types' });
  let linkTypes = [];
  try {
    linkTypes = (await request('/rest/api/3/issueLinkType'))?.issueLinkTypes ?? [];
  } catch (e) {
    meta.warnings.push(`Could not read link types (${e.status ?? e.message}); links drawn in My work are saved in the app.`);
  }

  const issues = [...byKey.values()].map((i) => trim(i, meta.flaggedField));
  return { name: projectKey, asOf: now, users: deriveUsers([...byKey.values()], meta.teamField), issues, linkTypes, meta };
}

/** Re-read issue links for a few issues after a link was added or removed, and patch them in. */
export async function refreshLinks(request, data, keys) {
  const fresh = new Map();
  for (const key of new Set(keys)) {
    try {
      const issue = await request(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=issuelinks`);
      fresh.set(key, issue?.fields?.issuelinks ?? []);
    } catch {
      /* issue not visible: keep what we had */
    }
  }
  return { ...data, issues: data.issues.map((i) => (fresh.has(i.key) ? { ...i, fields: { ...i.fields, issuelinks: fresh.get(i.key) } } : i)) };
}
