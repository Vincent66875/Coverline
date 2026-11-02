// Runs scripts/seed-jira.mjs against an in-memory Jira that accepts writes, then loads the result with the app's loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, clean, foldPeople, SEED_LABEL } from '../scripts/seed-jira.mjs';
import { spec } from './fixtures/large.js';
import { makeRequest } from '../static/team-map/src/jira/request.js';
import { loadProjectData } from '../static/team-map/src/jira/loadData.js';
import { buildModel } from '../static/team-map/src/analysis/adapter.js';

const STATUSES = { 'To Do': 'new', 'In Progress': 'indeterminate', Done: 'done' }; // simplified Kanban: no "Blocked", no "In Review"
const FLAGGED = 'customfield_10021';
const noWait = { wait: async () => {} };

/** Minimal writable Jira. reversedLinks: POST /issueLink stores the ends swapped (forces the read-back fix). */
function fakeJira({ users, reversedLinks = true, refuse = [], linkTypes } = {}) {
  const projects = new Map();
  const issues = new Map();
  const links = [];
  let nextIssue = 1;
  let nextLink = 1;
  const me = { accountId: 'me', displayName: 'Vincent', accountType: 'atlassian', active: true };
  const userBy = new Map([...users, me].map((u) => [u.accountId, u]));
  const types = linkTypes ?? [
    { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' },
    { id: '3', name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
  ];
  const ISSUE_TYPES = [
    { id: '10', name: 'Epic', subtask: false },
    { id: '11', name: 'Story', subtask: false },
    { id: '12', name: 'Task', subtask: false },
    { id: '13', name: 'Subtask', subtask: true },
  ];
  const now = () => new Date().toISOString().replace('Z', '+0000');
  const ref = (id) => (id ? { accountId: id, displayName: userBy.get(id).displayName, active: true, accountType: 'atlassian' } : null);
  const json = (status, body) => ({ status, ok: status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body ?? '') });
  const err = (status, msg) => json(status, { errorMessages: [msg] });
  const brief = (i) => ({ id: i.id, key: i.key, fields: { summary: i.fields.summary, status: i.fields.status, issuetype: i.fields.issuetype, assignee: i.fields.assignee } });
  const linksOf = (key) =>
    links
      .filter((l) => l.a === key || l.b === key)
      .map((l) => ({ id: l.id, type: types.find((t) => t.id === l.type), ...(l.a === key ? { outwardIssue: brief(issues.get(l.b)) } : { inwardIssue: brief(issues.get(l.a)) }) }));
  const view = (i) => {
    const subtasks = [...issues.values()].filter((x) => x.fields.parent?.key === i.key && x.fields.issuetype.subtask).map(brief);
    return { ...i, fields: { ...i.fields, issuelinks: linksOf(i.key), subtasks }, changelog: { startAt: 0, maxResults: i.histories.length, total: i.histories.length, histories: i.histories } };
  };
  const setAssignee = (i, id) => {
    const from = i.fields.assignee?.accountId ?? null;
    if (from === id) return;
    i.histories.push({ id: String(i.histories.length + 1), author: ref('me'), created: now(), items: [{ field: 'assignee', fieldtype: 'jira', fieldId: 'assignee', from, fromString: from && userBy.get(from).displayName, to: id, toString: id && userBy.get(id).displayName }] });
    i.fields.assignee = ref(id);
  };
  const jqlMatch = (jql, i) => {
    if (/labels = /.test(jql)) return i.fields.labels.includes(jql.match(/labels = ([\w-]+)/)[1]);
    if (/issuekey in/.test(jql)) return jql.match(/\(([^)]*)\)/)[1].split(',').map((s) => s.trim()).includes(i.key);
    const p = jql.match(/project = "?(\w+)"?/);
    if (p && i.fields.project.key !== p[1]) return false;
    return !(/resolved >=/.test(jql) && i.fields.status.statusCategory.key === 'done' && false);
  };

  async function fetcher(path, init = {}) {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const url = new URL(`https://x${path}`);
    const p = url.pathname;
    let m;
    if (p === '/rest/api/3/myself') return json(200, me);
    if (p === '/rest/api/3/user/search') return json(200, users.filter((u) => u.emailAddress === url.searchParams.get('query')).map((u) => ({ ...u, emailAddress: undefined })));
    if (p === '/rest/api/3/field') return json(200, [{ id: FLAGGED, name: 'Flagged', custom: true, schema: { type: 'array', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes' } }, { id: 'summary', name: 'Summary', custom: false }]);
    if (p === '/rest/api/3/issueLinkType') return json(200, { issueLinkTypes: types });
    if ((m = p.match(/^\/rest\/api\/3\/project\/(\w+)$/))) return projects.has(m[1]) ? json(200, projects.get(m[1])) : err(404, 'No project');
    if (p === '/rest/api/3/project' && method === 'POST') {
      const pr = { id: String(projects.size + 1), key: body.key, name: body.name, components: [] };
      projects.set(body.key, pr);
      return json(201, pr);
    }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/createmeta\/(\w+)\/issuetypes$/))) return json(200, { issueTypes: ISSUE_TYPES });
    if ((m = p.match(/^\/rest\/api\/3\/project\/(\w+)\/components$/))) return json(200, projects.get(m[1]).components);
    if (p === '/rest/api/3/component' && method === 'POST') {
      projects.get(body.project).components.push({ id: String(Math.random()), name: body.name });
      return json(201, {});
    }
    if (p === '/rest/api/3/issue' && method === 'POST') {
      const f = body.fields;
      for (const r of refuse) if (f[r] !== undefined) return json(400, { errors: { [r]: `Field '${r}' cannot be set. It is not on the appropriate screen, or unknown.` } });
      const pr = projects.get(f.project.key);
      const key = `${pr.key}-${[...issues.values()].filter((i) => i.fields.project.key === pr.key).length + 1}`;
      const type = ISSUE_TYPES.find((t) => t.id === f.issuetype.id);
      for (const c of f.components ?? []) if (!pr.components.some((x) => x.name === c.name)) return err(400, `Component ${c.name} is not valid`);
      const i = {
        id: String(nextIssue++),
        key,
        histories: [],
        fields: {
          summary: f.summary, issuetype: { ...type, hierarchyLevel: type.name === 'Epic' ? 1 : type.subtask ? -1 : 0 },
          status: { name: 'To Do', statusCategory: { key: 'new' } }, project: { id: pr.id, key: pr.key, name: pr.name },
          assignee: ref(f.assignee?.accountId ?? null), reporter: ref(f.reporter?.accountId ?? 'me'),
          labels: f.labels ?? [], components: f.components ?? [], duedate: f.duedate ?? null,
          created: now(), updated: now(), resolutiondate: null, parent: f.parent ? brief(issues.get(f.parent.key)) : null, [FLAGGED]: null,
        },
      };
      issues.set(key, i);
      return json(201, { id: i.id, key });
    }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([\w-]+)\/assignee$/))) {
      setAssignee(issues.get(m[1]), body.accountId);
      return json(204, null);
    }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([\w-]+)\/transitions$/))) {
      const i = issues.get(m[1]);
      if (method === 'GET') return json(200, { transitions: Object.entries(STATUSES).filter(([n]) => n !== i.fields.status.name).map(([name, key], k) => ({ id: String(k + 1), to: { name, statusCategory: { key } } })) });
      const [name, key] = Object.entries(STATUSES).filter(([n]) => n !== i.fields.status.name)[Number(body.transition.id) - 1];
      i.fields.status = { name, statusCategory: { key } };
      i.fields.resolutiondate = key === 'done' ? now() : null;
      return json(204, null);
    }
    if ((m = p.match(/^\/rest\/api\/3\/issue\/([\w-]+)$/))) {
      const i = issues.get(m[1]);
      if (!i) return err(404, 'Issue does not exist');
      if (method === 'GET') return json(200, view(i));
      if (method === 'PUT') { Object.assign(i.fields, body.fields); return json(204, null); }
      if (method === 'DELETE') {
        for (const [k, x] of issues) if (k === i.key || (url.searchParams.get('deleteSubtasks') && x.fields.parent?.key === i.key && x.fields.issuetype.subtask)) issues.delete(k);
        return json(204, null);
      }
    }
    if (p === '/rest/api/3/issueLink' && method === 'POST') {
      const [a, b] = reversedLinks ? [body.inwardIssue.key, body.outwardIssue.key] : [body.outwardIssue.key, body.inwardIssue.key];
      links.push({ id: String(nextLink++), type: body.type.id, a, b }); // a <outward> b
      return json(201, null);
    }
    if ((m = p.match(/^\/rest\/api\/3\/issueLink\/(\w+)$/)) && method === 'DELETE') {
      links.splice(links.findIndex((l) => l.id === m[1]), 1);
      return json(204, null);
    }
    if (p === '/rest/api/3/search/jql') {
      const hits = [...issues.values()].filter((i) => jqlMatch(body.jql, i));
      return json(200, { issues: hits.map(view), isLast: true });
    }
    return err(404, `fake Jira: no route ${method} ${p}`);
  }
  return { fetcher, issues, links, projects };
}

const SEVEN = ['mia', 'ivy', 'ken', 'lea', 'sam', 'wen', 'xan'];
const users = SEVEN.map((p) => ({ accountId: `acc-${p}`, displayName: p[0].toUpperCase() + p.slice(1), emailAddress: `vincent+jtm-${p}@gmail.com`, accountType: 'atlassian', active: true }));
const people = Object.fromEntries(SEVEN.map((p) => [p, `vincent+jtm-${p}@gmail.com`]));

test('fold: 7 accounts cover all 15 demo people, teammates first', () => {
  const f = foldPeople(Object.fromEntries(SEVEN.map((p) => [p, `acc-${p}`])), 'me');
  assert.deepEqual(Object.fromEntries(Object.entries(f).map(([p, x]) => [p, x.as])), {
    mia: 'mia', noah: 'mia', ivy: 'ivy', ken: 'ken', lea: 'lea', omar: 'lea', sam: 'sam', tara: 'sam', uri: 'sam', vic: 'sam', wen: 'wen', xan: 'xan', yui: 'xan', paula: 'you', dan: 'sam', bot: 'you',
  });
});

test('seed: creates projects, issues, history, statuses, flags and links; the app reads it back', async () => {
  const jira = fakeJira({ users });
  const request = makeRequest(jira.fetcher, noWait);
  const out = [];
  const state = {};
  await seed({ request, people, state, log: (l) => out.push(l), today: new Date('2026-11-02T12:00:00Z') });

  assert.deepEqual([...jira.projects.keys()], ['DES', 'WEB', 'API', 'MOB']);
  assert.equal(jira.issues.size, spec.issues.length);
  const get = (demo) => jira.issues.get(state.keys[demo]).fields;
  // types, parents, labels, due dates moved +4 days
  assert.equal(get('DES-4').issuetype.subtask, true);
  assert.equal(get('DES-4').parent.key, state.keys['DES-3']);
  assert.equal(get('DES-2').parent.key, state.keys['DES-1']);
  assert.ok(get('DES-2').labels.includes(SEED_LABEL) && get('DES-2').labels.includes('tokens'));
  assert.equal(get('DES-2').duedate, '2026-11-05');
  // folded people
  assert.equal(get('DES-4').assignee.accountId, 'acc-mia'); // Noah → Mia
  assert.equal(get('API-5').assignee.accountId, 'acc-sam'); // Vic → Sam
  assert.equal(get('DES-2').reporter.accountId, 'me'); // Paula → you
  // history replayed: WEB-4 Lea → Ken; MOB-9 Xan → Wen → Xan
  const moves = (demo) => jira.issues.get(state.keys[demo]).histories.map((h) => `${h.items[0].from}>${h.items[0].to}`);
  assert.deepEqual(moves('WEB-4'), ['acc-lea>acc-ken']);
  assert.deepEqual(moves('MOB-9'), ['acc-xan>acc-wen', 'acc-wen>acc-xan']);
  assert.deepEqual(moves('API-12'), ['null>acc-sam']);
  // statuses: Done, In Review → In Progress, Blocked → In Progress + flagged
  assert.equal(get('DES-6').status.name, 'Done');
  assert.equal(get('DES-5').status.name, 'In Progress');
  assert.equal(get('API-2').status.name, 'In Progress');
  assert.deepEqual(get('API-2')[FLAGGED], [{ value: 'Impediment' }]);
  assert.deepEqual(get('MOB-2')[FLAGGED], [{ value: 'Impediment' }]);
  assert.equal(get('MOB-6').assignee, null);
  // links: every blocks/depends link stored as "blocker blocks waiter" despite the reversed POST convention
  const blocks = jira.links.filter((l) => l.type === '1').map((l) => `${l.a}>${l.b}`);
  assert.ok(blocks.includes(`${state.keys['DES-2']}>${state.keys['WEB-2']}`));
  assert.ok(blocks.includes(`${state.keys['API-2']}>${state.keys['MOB-5']}`)); // "MOB-5 depends on API-2", no Dependency type
  assert.equal(blocks.length, 17);
  assert.ok(out.some((l) => /skipped .* builds on .*no such link type/.test(l)));

  // the app's own loader + model on the seeded site
  const data = await loadProjectData(request, 'DES', { now: new Date('2026-11-02T12:00:00Z') });
  const m = buildModel(data);
  assert.equal(data.meta.flaggedField, FLAGGED);
  const edge = m.personEdges.find((e) => e.id === 'acc-ken>acc-mia');
  assert.ok(edge, 'Ken waits on Mia');
  assert.equal(edge.weight, 2);
  assert.ok(m.personEdges.some((e) => e.id === 'acc-lea>acc-ivy'));
});

test('seed re-run skips finished work; Jira refusing reporter/components does not stop it', async () => {
  const jira = fakeJira({ users, refuse: ['reporter', 'components'], reversedLinks: false });
  const request = makeRequest(jira.fetcher, noWait);
  const state = {};
  const out = [];
  await seed({ request, people, state, log: (l) => out.push(l) });
  assert.equal(jira.issues.size, spec.issues.length);
  assert.ok(out.some((l) => /refused reporter/.test(l)) && out.some((l) => /refused components/.test(l)));
  const before = jira.links.length;
  await seed({ request, people, state, log: () => {} });
  assert.equal(jira.issues.size, spec.issues.length);
  assert.equal(jira.links.length, before);
});

test('seed: unknown email stops with a clear message; dry run writes nothing', async () => {
  const jira = fakeJira({ users });
  const request = makeRequest(jira.fetcher, noWait);
  await assert.rejects(seed({ request, people: { mia: 'nobody@x.com' }, log: () => {} }), /No single active Jira user found for mia/);
  await seed({ request, people, dryRun: true, log: () => {} });
  assert.equal(jira.projects.size, 0);
  assert.equal(jira.issues.size, 0);
});

test('clean deletes every seeded issue', async () => {
  const jira = fakeJira({ users });
  const request = makeRequest(jira.fetcher, noWait);
  const state = {};
  await seed({ request, people, state, log: () => {} });
  await clean({ request, keys: Object.values(state.keys).reverse(), log: () => {} });
  assert.equal(jira.issues.size, 0);
});
