import { test } from 'node:test';
import assert from 'node:assert/strict';
import large from './fixtures/large.js';
import { mockJira, fakeKvs, TEAM_FIELD } from './mocks/jira.js';
import { makeRequest, JiraError } from '../static/team-map/src/jira/request.js';
import { loadProjectData, projectJql, deriveUsers, refreshLinks } from '../static/team-map/src/jira/loadData.js';
import { makeLinkStore, createJiraLink, jiraTypeFor } from '../static/team-map/src/jira/linkStore.js';
import { makeStore } from '../src/storage.js';
import { buildModel } from '../static/team-map/src/analysis/adapter.js';
import { coverageRisk } from '../static/team-map/src/analysis/scoring.js';

const ASOF = large.asOf;
const noWait = { wait: async () => {} };
const BUILDS_ON = { id: '20000', name: 'Builds on', inward: 'is built on by', outward: 'builds on' };
const FIXES = { id: '20001', name: 'Fixes', inward: 'is fixed by', outward: 'fixes' };
const setup = (opts) => {
  const jira = mockJira(large, opts);
  return { jira, request: makeRequest(jira.fetcher, noWait) };
};

// ------------------------------------------------------------------ request
test('request: JSON, 204, errors with Jira messages, retry on 429', async () => {
  const { jira, request } = setup({ throttle: { '/rest/api/3/issueLinkType': 2 } });
  const types = await request('/rest/api/3/issueLinkType');
  assert.ok(types.issueLinkTypes.length >= 3);
  assert.equal(jira.calls.filter((c) => c.path === '/rest/api/3/issueLinkType').length, 3); // 2 x 429, then 200
  await assert.rejects(request('/rest/api/3/issue/NOPE-1?fields=issuelinks'), (e) => e instanceof JiraError && e.status === 404 && /permission/.test(e.message));
  const gaveUp = makeRequest(mockJira(large, { throttle: { '/rest/api/3/field': 9 } }).fetcher, { retries: 2, ...noWait });
  await assert.rejects(gaveUp('/rest/api/3/field'), (e) => e.status === 429);
});

// ------------------------------------------------------------------ loading a project
test('JQL is bounded and quoted', () => {
  assert.equal(projectJql('DES'), 'project = "DES" AND (statusCategory != Done OR resolved >= -365d) ORDER BY key ASC');
  assert.equal(projectJql('A"B'), 'project = "A\\"B" AND (statusCategory != Done OR resolved >= -365d) ORDER BY key ASC');
});

test('loads project issues across pages, one hop of linked issues, missing parents', async () => {
  const { jira, request } = setup({ pageSize: 4 });
  const steps = [];
  const data = await loadProjectData(request, 'DES', { now: ASOF, onProgress: (p) => steps.push(p.step) });
  const keys = data.issues.map((i) => i.key).sort();
  assert.deepEqual(keys, ['DES-1', 'DES-2', 'DES-3', 'DES-4', 'DES-5', 'DES-6', 'DES-7', 'DES-8', 'DES-9', 'MOB-1', 'MOB-3', 'MOB-8', 'WEB-1', 'WEB-2', 'WEB-3', 'WEB-4'].sort());
  assert.equal(data.meta.projectIssues, 9);
  assert.equal(data.meta.linkedIssues, 5); // WEB-2, WEB-3, WEB-4, MOB-3, MOB-8
  assert.equal(data.meta.parentIssues, 2); // WEB-1, MOB-1 (epics of linked issues)
  assert.equal(data.meta.teamField, TEAM_FIELD);
  assert.ok(jira.calls.filter((c) => c.path === '/rest/api/3/search/jql').length >= 3); // paged
  assert.ok(jira.calls.every((c) => c.path !== '/rest/api/3/search')); // never the retired endpoint
  for (const s of ['fields', 'issues', 'linked', 'parents', 'link types']) assert.ok(steps.includes(s), s);
});

test('old Done work (> 12 months) is not loaded', async () => {
  const { request } = setup();
  const data = await loadProjectData(request, 'API', { now: ASOF });
  assert.ok(!data.issues.some((i) => i.key === 'API-9')); // resolved 13 months ago
  assert.ok(data.issues.some((i) => i.key === 'API-10'));
});

test('changelogs cut short by search are read in full', async () => {
  const { jira, request } = setup({ changelogCap: 1 });
  const data = await loadProjectData(request, 'MOB', { now: ASOF });
  const mob9 = data.issues.find((i) => i.key === 'MOB-9');
  assert.equal(mob9.changelog.histories.length, 2); // bounce A->B->A needs both entries
  assert.ok(jira.calls.some((c) => c.path.startsWith('/rest/api/3/issue/MOB-9/changelog')));
  assert.ok(data.meta.changelogFetched >= 1);
  const m = buildModel(data);
  assert.ok(m.knowledgeByIssue.get('MOB-9').some((k) => m.nameOf(k.person) === 'Wen' && k.how === 'past assignee'));
});

test('teams: Team field first, then most common project', async () => {
  const { request } = setup();
  const data = await loadProjectData(request, 'DES', { now: ASOF });
  const m = buildModel(data);
  const t = (n) => m.people.find((p) => p.name === n);
  assert.deepEqual([t('Mia').team, t('Mia').teamSource], ['Design', 'team field']);
  assert.deepEqual([t('Ivy').team, t('Ivy').teamSource], ['Design', 'project key']); // no Team value
  assert.deepEqual([t('Yui').team, t('Yui').teamSource], ['Mobile', 'project key']);
  const noTeam = await loadProjectData(setup({ teamField: false }).request, 'DES', { now: ASOF });
  assert.equal(noTeam.meta.teamField, null);
  assert.equal(buildModel(noTeam).people.find((p) => p.name === 'Mia').teamSource, 'project key');
});

test('the loaded project drives the same analysis as the MVP (Mia 18)', async () => {
  const { request } = setup();
  const m = buildModel(await loadProjectData(request, 'DES', { now: ASOF }));
  const mia = coverageRisk(m, m.people.find((p) => p.name === 'Mia').accountId);
  assert.equal(mia.score, 18);
  assert.deepEqual(mia.waiting.map((w) => w.name), ['Ken', 'Wen', 'Yui']);
  assert.equal(m.personEdges.filter((e) => m.nameOf(e.blockerId) === 'Mia').length, 3);
});

test('linked issues you cannot see are reported, not fatal', async () => {
  const { request } = setup({ hidden: ['MOB-8'] });
  const data = await loadProjectData(request, 'DES', { now: ASOF });
  assert.deepEqual(data.meta.hiddenLinked, ['MOB-8']);
  assert.ok(!data.issues.some((i) => i.key === 'MOB-8'));
  buildModel(data); // a link to an issue we could not load must not crash the analysis
});

test('users come from issues; deactivated and app accounts kept for exclusion', async () => {
  const users = deriveUsers(large.issues, null);
  const dan = users.find((u) => u.displayName === 'Dan');
  assert.equal(dan.active, false);
  assert.equal(users.find((u) => u.displayName === 'Automation for Jira').accountType, 'app');
});

// ------------------------------------------------------------------ links
for (const convention of ['inward-is-subject', 'outward-is-subject']) {
  test(`create Jira link in the right direction (${convention})`, async () => {
    const { jira, request } = setup({ extraLinkTypes: [BUILDS_ON], postConvention: convention });
    const id = await createJiraLink(request, BUILDS_ON, 'DES-2', 'DES-6');
    const onDes2 = jira.issues.get('DES-2').fields.issuelinks.find((l) => l.id === id);
    assert.equal(onDes2.outwardIssue.key, 'DES-6'); // DES-2 "builds on" DES-6
    assert.equal(jira.issues.get('DES-6').fields.issuelinks.find((l) => l.id === id).inwardIssue.key, 'DES-2');
    assert.equal(jira.issues.get('DES-2').fields.issuelinks.filter((l) => l.type.id === BUILDS_ON.id).length, 1); // no leftover reversed link
  });
}

test('link store: Jira link when the site has the type, app storage otherwise', async () => {
  const { jira, request } = setup({ extraLinkTypes: [BUILDS_ON] });
  const { kvs, WhereConditions, map } = fakeKvs();
  const store = makeStore(kvs, WhereConditions);
  const invoke = async (fn, payload) => ({ addAppLink: () => store.addLink(payload, 'u-mia', ASOF), removeAppLink: () => store.removeLink(payload) })[fn]();
  const links = makeLinkStore({ request, invoke, linkTypes: jira.linkTypes });
  assert.deepEqual(links.coverage(['builds_on', 'fixes', 'related']), { builds_on: 'Builds on', fixes: null, related: 'Relates' });

  const a = await links.add({ fromKey: 'DES-2', toKey: 'DES-6', type: 'builds_on' });
  assert.deepEqual(a, { saved: 'jira', keys: ['DES-2', 'DES-6'] });
  const b = await links.add({ fromKey: 'WEB-3', toKey: 'WEB-9', type: 'fixes' });
  assert.equal(b.saved, 'app');
  assert.deepEqual([...map.keys()], ['wl:WEB-3:fixes:WEB-9']);

  // the model sees both: Jira link from issue data, app link from storage
  let data = await loadProjectData(request, 'DES', { now: ASOF });
  data = await refreshLinks(request, data, a.keys);
  const m = buildModel(data, { extraRelations: await store.listLinks() });
  const jl = m.workLinks.find((l) => l.id === 'DES-2~builds_on~DES-6');
  assert.equal(jl.source, 'jira');
  assert.equal(coverageRisk(m, m.people.find((p) => p.name === 'Mia').accountId).score, 16); // warm through Noah

  // change type: Jira "builds on" -> "fixes" (no Jira type) moves it to app storage
  const c = await links.change(jl, { type: 'fixes' });
  assert.equal(c.saved, 'app');
  assert.ok(!jira.issues.get('DES-2').fields.issuelinks.some((l) => l.type.id === BUILDS_ON.id));
  assert.ok(map.has('wl:DES-2:fixes:DES-6'));
  // remove app link
  await links.remove({ fromKey: 'DES-2', toKey: 'DES-6', type: 'fixes', source: 'app' });
  assert.ok(!map.has('wl:DES-2:fixes:DES-6'));
});

test('jiraTypeFor: by wording; "Relates" for related; none for unknown relations', () => {
  const types = [...mockJira(large).linkTypes, FIXES];
  assert.equal(jiraTypeFor(types, 'related').name, 'Relates');
  assert.equal(jiraTypeFor(types, 'fixes').name, 'Fixes');
  assert.equal(jiraTypeFor(types, 'follows_up').name, 'Sequence'); // "follows"
  assert.equal(jiraTypeFor(types, 'replaces'), null);
});

// ------------------------------------------------------------------ storage
test('storage: valid keys only, listing pages, per-user dismissed', async () => {
  const { kvs, WhereConditions } = fakeKvs();
  const store = makeStore(kvs, WhereConditions);
  for (let i = 1; i <= 130; i++) await store.addLink({ fromKey: 'DES-2', toKey: `WEB-${i}`, type: 'related' }, 'u-mia');
  assert.equal((await store.listLinks()).length, 130); // more than one page
  await assert.rejects(store.addLink({ fromKey: 'DES-2', toKey: 'DES-2', type: 'related' }), /Invalid/);
  await assert.rejects(store.addLink({ fromKey: 'x', toKey: 'DES-2', type: 'related' }), /Invalid/);
  await assert.rejects(store.addLink({ fromKey: 'DES-1', toKey: 'DES-2', type: 'blocks' }), /Invalid/);
  assert.deepEqual(await store.setDismissed('u-mia', ['DES-2<DES-6', 'DES-2<DES-6', 7]), ['DES-2<DES-6']);
  assert.deepEqual(await store.getDismissed('u-mia'), ['DES-2<DES-6']);
  assert.deepEqual(await store.getDismissed('u-ken'), []);
});
