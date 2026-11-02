// A small in-memory Jira Cloud for tests: just the endpoints the app calls, built from an MVP fixture.
import { LINK_TYPES } from '../fixtures/build.js';

export const TEAM_FIELD = 'customfield_10001';
export const FLAGGED_FIELD = 'customfield_10021';
const TEAM_TYPE = 'com.atlassian.teams:rm-teams-custom-field-team';
const DAY = 864e5;

const res = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (h) => headers[h] ?? null },
  json: async () => body,
  text: async () => (body == null ? '' : JSON.stringify(body)),
});

/**
 * options:
 *  pageSize: search page size the mock enforces
 *  changelogCap: histories embedded in search results (Jira's is 20)
 *  teamField: true to expose the Atlassian Team field (values from fixture users' team)
 *  hidden: keys the caller cannot see
 *  extraLinkTypes: more link types on the site (e.g. 'Builds on' created by an admin)
 *  postConvention: 'inward-is-subject' (inwardIssue carries the outward wording) or 'outward-is-subject'
 *  throttle: { [pathPrefix]: n } first n calls return 429
 */
export function mockJira(fixture, opts = {}) {
  const { pageSize = 100, changelogCap = 20, teamField = true, flaggedField = true, flagged = [], noLinks = false, hidden = [], extraLinkTypes = [], postConvention = 'inward-is-subject', throttle = {} } = opts;
  const asOf = Date.parse(fixture.asOf.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  const teamOf = new Map(fixture.users.filter((u) => u.team).map((u) => [u.accountId, u.team]));
  const issues = new Map(
    structuredClone(fixture.issues).map((i) => {
      if (teamField && i.fields.assignee && teamOf.has(i.fields.assignee.accountId)) {
        const name = teamOf.get(i.fields.assignee.accountId);
        i.fields[TEAM_FIELD] = { id: `team-${name}`, name, title: name, isShared: true, isVisible: true, avatarUrl: '' };
      }
      if (flaggedField) i.fields[FLAGGED_FIELD] = flagged.includes(i.key) ? [{ self: 'x', value: 'Impediment', id: '10019' }] : null;
      if (noLinks) i.fields.issuelinks = i.fields.issuelinks.filter((l) => !/block|depend/i.test(l.type.name));
      return [i.key, i];
    }),
  );
  const linkTypes = [...Object.values(LINK_TYPES).filter((t) => ['Blocks', 'Dependency', 'Relates', 'Sequence'].includes(t.name)), ...extraLinkTypes];
  const calls = [];
  const throttled = { ...throttle };
  let nextLinkId = 9000;
  const visible = (k) => issues.has(k) && !hidden.includes(k);
  const brief = (i) => ({ id: i.id, key: i.key, fields: { summary: i.fields.summary, status: i.fields.status, issuetype: i.fields.issuetype } });
  const parseTime = (s) => Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));

  function select(jql) {
    let m = jql.match(/^project = "([^"]+)" AND \(statusCategory != Done OR resolved >= -(\d+)d\)/);
    if (m) {
      const [, key, days] = m;
      return [...issues.values()].filter((i) => i.fields.project.key === key && (i.fields.status.statusCategory.key !== 'done' || asOf - parseTime(i.fields.resolutiondate) <= Number(days) * DAY));
    }
    m = jql.match(/^key in \(([^)]*)\)/);
    if (m) {
      const keys = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      return keys.filter((k) => issues.has(k)).map((k) => issues.get(k));
    }
    throw new Error(`mock cannot parse JQL: ${jql}`);
  }

  function shape(i, fields) {
    const f = {};
    for (const name of fields) if (name in i.fields) f[name] = i.fields[name];
    const all = i.changelog.histories;
    return { id: i.id, key: i.key, fields: f, changelog: { startAt: 0, maxResults: changelogCap, total: all.length, histories: all.slice(0, changelogCap) } };
  }

  function linkBetween(a, b, type, id) {
    a.fields.issuelinks.push({ id, type: { ...type }, outwardIssue: brief(b) }); // a <outward> b
    b.fields.issuelinks.push({ id, type: { ...type }, inwardIssue: brief(a) });
  }

  async function fetcher(path, init = {}) {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    for (const p of Object.keys(throttled))
      if (path.startsWith(p) && throttled[p] > 0) {
        throttled[p]--;
        return res(429, { errorMessages: ['Rate limited'] }, { 'Retry-After': '0' });
      }
    const url = new URL(path, 'https://site.example');
    const p = url.pathname;
    if (method === 'GET' && p === '/rest/api/3/field')
      return res(200, [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
        ...(teamField ? [{ id: TEAM_FIELD, name: 'Team', custom: true, schema: { type: 'any', custom: TEAM_TYPE, customId: 10001 } }] : []),
        ...(flaggedField ? [{ id: FLAGGED_FIELD, name: 'Flagged', custom: true, schema: { type: 'array', items: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes', customId: 10021 } }] : []),
      ]);
    if (method === 'POST' && p === '/rest/api/3/search/jql') {
      if (!body.jql || /^\s*order by/i.test(body.jql)) return res(400, { errorMessages: ['Unbounded JQL'] });
      const all = select(body.jql).filter((i) => !hidden.includes(i.key));
      const start = Number(body.nextPageToken ?? 0);
      const size = Math.min(body.maxResults ?? 50, pageSize);
      const page = all.slice(start, start + size).map((i) => shape(i, body.fields ?? []));
      return res(200, { issues: page, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    let m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/);
    if (method === 'GET' && m) {
      const key = decodeURIComponent(m[1]);
      if (!visible(key)) return res(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      const all = issues.get(key).changelog.histories;
      const startAt = Number(url.searchParams.get('startAt') ?? 0);
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      const values = all.slice(startAt, startAt + max);
      return res(200, { startAt, maxResults: max, total: all.length, isLast: startAt + values.length >= all.length, values });
    }
    m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)$/);
    if (method === 'GET' && m) {
      const key = decodeURIComponent(m[1]);
      if (!visible(key)) return res(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      return res(200, { id: issues.get(key).id, key, fields: { issuelinks: structuredClone(issues.get(key).fields.issuelinks) } });
    }
    if (method === 'GET' && p === '/rest/api/3/issueLinkType') return res(200, { issueLinkTypes: linkTypes });
    if (method === 'POST' && p === '/rest/api/3/issueLink') {
      const type = linkTypes.find((t) => t.id === body.type?.id || t.name === body.type?.name);
      const inward = issues.get(body.inwardIssue?.key);
      const outward = issues.get(body.outwardIssue?.key);
      if (!type || !inward || !outward) return res(404, { errorMessages: ['No such issue or link type'] });
      const id = String(nextLinkId++);
      if (postConvention === 'inward-is-subject') linkBetween(inward, outward, type, id);
      else linkBetween(outward, inward, type, id);
      return res(201, null);
    }
    m = p.match(/^\/rest\/api\/3\/issueLink\/(\d+)$/);
    if (method === 'DELETE' && m) {
      let found = false;
      for (const i of issues.values()) {
        const before = i.fields.issuelinks.length;
        i.fields.issuelinks = i.fields.issuelinks.filter((l) => l.id !== m[1]);
        found ||= i.fields.issuelinks.length !== before;
      }
      return found ? res(204, null) : res(404, { errorMessages: ['No link'] });
    }
    return res(404, { errorMessages: [`mock: no route ${method} ${path}`] });
  }

  return { fetcher, calls, issues, linkTypes };
}

/** In-memory stand-in for @forge/kvs. */
export function fakeKvs() {
  const m = new Map();
  const WhereConditions = { beginsWith: (prefix) => ({ prefix }) };
  const kvs = {
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: async (k, v) => {
      if (!/^[a-zA-Z0-9:._\s\-#]+$/.test(k)) throw new Error(`invalid key ${k}`);
      m.set(k, structuredClone(v));
    },
    delete: async (k) => {
      m.delete(k);
    },
    query() {
      const q = { prefix: '', lim: 20, cur: 0 };
      const api = {
        where: (_f, c) => ((q.prefix = c.prefix), api),
        limit: (n) => ((q.lim = n), api),
        cursor: (c) => ((q.cur = Number(c)), api),
        getMany: async () => {
          const keys = [...m.keys()].filter((k) => k.startsWith(q.prefix)).sort();
          const slice = keys.slice(q.cur, q.cur + q.lim);
          return { results: slice.map((key) => ({ key, value: structuredClone(m.get(key)) })), nextCursor: q.cur + q.lim < keys.length ? String(q.cur + q.lim) : undefined };
        },
      };
      return api;
    },
  };
  return { kvs, WhereConditions, map: m };
}
