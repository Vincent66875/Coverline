import { test } from 'node:test';
import assert from 'node:assert/strict';
import large from './fixtures/large.js';
import small from './fixtures/small.js';
import { mockJira, fakeKvs, FLAGGED_FIELD } from './mocks/jira.js';
import { makeRequest } from '../static/team-map/src/jira/request.js';
import { loadProjectData } from '../static/team-map/src/jira/loadData.js';
import { makeStore } from '../src/storage.js';
import { buildModel } from '../static/team-map/src/analysis/adapter.js';
import { coverageRisk, coverBadges } from '../static/team-map/src/analysis/scoring.js';
import { singlePersonWork, blockedWithoutBlocker, setupStatus, teamRoster, teamNames } from '../static/team-map/src/analysis/coverage.js';
import { graphData } from '../static/team-map/src/graph/graphData.js';

const ASOF = large.asOf;
const noWait = { wait: async () => {} };
const load = async (project, opts = {}) => loadProjectData(makeRequest(mockJira(large, opts).fetcher, noWait), project, { now: ASOF });
const id = (m, n) => m.people.find((p) => p.name === n).accountId;

// ------------------------------------------------------------------ Flagged
test('Flagged field found by name, normalised to fields.flagged, raw field dropped', async () => {
  const data = await load('DES', { flagged: ['DES-3'] });
  assert.equal(data.meta.flaggedField, FLAGGED_FIELD);
  const des3 = data.issues.find((i) => i.key === 'DES-3');
  assert.equal(des3.fields.flagged, true);
  assert.ok(!(FLAGGED_FIELD in des3.fields));
  assert.equal(data.issues.find((i) => i.key === 'DES-2').fields.flagged, false);
});

test('flagged blocker: red arrow, "flagged" in sentence, +2 when no one else is left on it', async () => {
  const m = buildModel(await load('DES', { flagged: ['DES-2'] }));
  const des2 = m.issueByKey.get('DES-2');
  assert.deepEqual([des2.flagged, des2.statusBlocked, des2.blocked], [true, false, true]);
  const e = m.personEdges.find((x) => x.id === 'u-ken>u-mia');
  assert.equal(e.red, true);
  assert.match(e.pairs[0].sentence, /\(In Progress, flagged, due in 3 days\)/);
  const mia = coverageRisk(m, id(m, 'Mia'));
  assert.equal(mia.score, 20); // 18 + 2
  assert.ok(mia.components.some((c) => c.text === 'DES-2 is flagged'));
});

test('no Flagged field on the site: nothing breaks, nothing flagged', async () => {
  const data = await load('DES', { flaggedField: false, flagged: ['DES-2'] });
  assert.equal(data.meta.flaggedField, null);
  assert.equal(buildModel(data).issueByKey.get('DES-2').blocked, false);
});

// ------------------------------------------------------------------ one-person work
test('one-person work: open tasks no one else has worked on, waited-on first', () => {
  const m = buildModel(large);
  const r = singlePersonWork(m);
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x.tasks.map((t) => t.key)]));
  assert.deepEqual(by.Mia, ['DES-2']); // DES-3 has Noah's sub-task
  assert.deepEqual(by.Sam, undefined); // API-2 has Vic's sub-task
  assert.deepEqual(by.Ken, ['WEB-2', 'WEB-6']); // WEB-4: Lea was past assignee
  assert.ok(!r.keys.includes('MOB-6')); // unassigned: no "one person"
  assert.equal(r.rows[0].waitedOn >= 1, true);
  assert.deepEqual(r.rows.find((x) => x.name === 'Mia').tasks[0].waitingKeys.sort(), ['MOB-8', 'WEB-2', 'WEB-4']);
  assert.equal(r.count, r.keys.length);
  assert.equal(r.openWork, 20);
});

test('one-person work needs no links: same list with every blocks link removed', async () => {
  // compare DES's own tasks: without links the loader has no reason to fetch other projects' issues
  const des = (keys) => keys.filter((k) => k.startsWith('DES-')).sort();
  const withLinks = des(singlePersonWork(buildModel(await load('DES'))).keys);
  const m = buildModel(await load('DES', { noLinks: true }));
  assert.equal(m.personEdges.length, 0);
  assert.deepEqual(des(singlePersonWork(m).keys), withLinks);
  assert.ok(withLinks.length > 0);
});

test('blocked or flagged with nothing linked as the blocker', async () => {
  const m = buildModel(await load('MOB', { flagged: ['MOB-2', 'MOB-7'] }));
  // MOB-7 waits on MOB-6; API-2 (Blocked, loaded as a linked issue) waits on API-3/API-5 in a project not loaded
  assert.deepEqual(blockedWithoutBlocker(m).map((x) => x.key), ['MOB-2']);
});

// ------------------------------------------------------------------ teams
test('teams set in the app win over Team field and project; derived team kept for the editor', () => {
  const m = buildModel(large, { teamOverrides: { 'u-ivy': 'Checkout squad', 'u-paula': 'Product' } });
  const ivy = m.people.find((p) => p.name === 'Ivy');
  assert.deepEqual([ivy.team, ivy.teamSource, ivy.derivedTeam, ivy.derivedSource], ['Checkout squad', 'set in app', 'Design', 'jira group']);
  const paula = m.people.find((p) => p.name === 'Paula');
  assert.equal(paula.teamSource, 'set in app');
  assert.ok(teamNames(m).includes('Checkout squad'));
  // the map's columns follow
  assert.ok(graphData(m).layout.order.includes('Checkout squad'));
  // sole team link now involves the new team: Lea waits on Ivy across Frontend - Checkout squad
  assert.ok(coverageRisk(m, 'u-ivy').soleTeamLinks.some((s) => s.id === 'Checkout squad – Frontend'));
});

test('team roster lists everyone with current and suggested team', () => {
  const m = buildModel(large, { teamOverrides: { 'u-omar': 'Frontend' } });
  const omar = teamRoster(m).find((r) => r.name === 'Omar');
  assert.deepEqual([omar.team, omar.source, omar.suggested, omar.suggestedSource], ['Frontend', 'set in app', 'Frontend', 'project key']);
  assert.equal(teamRoster(m).length, m.people.length);
});

test('team storage: set, clear, rename-by-batch, bad ids refused', async () => {
  const { kvs, WhereConditions } = fakeKvs();
  const s = makeStore(kvs, WhereConditions);
  await s.setTeam('u-ivy', '  Checkout   squad ', 'u-mia');
  assert.deepEqual(await s.getTeams(), { 'u-ivy': 'Checkout squad' });
  assert.deepEqual(await s.setTeams({ 'u-ivy': 'Payments', 'u-sam': 'Payments', '712020:5f-ab_c': 'Ops' }, 'u-mia'), { '712020:5f-ab_c': 'Ops', 'u-ivy': 'Payments', 'u-sam': 'Payments' });
  await s.setTeam('u-sam', '');
  assert.equal((await s.getTeams())['u-sam'], undefined);
  await assert.rejects(s.setTeam('bad id!', 'X'), /Invalid person/);
  assert.equal(await s.setTeam('u-x', 'y'.repeat(200)), 'y'.repeat(60));
  assert.deepEqual(await s.setPrefs('u-mia', { setupBannerDismissed: 1, junk: 'x' }), { setupBannerDismissed: true });
  assert.deepEqual(await s.getPrefs('u-ken'), {});
});

// ------------------------------------------------------------------ setup checklist
test('setup checklist on the demo data', async () => {
  const data = await load('DES', { flagged: ['DES-5'] });
  const m = buildModel(data);
  const s = setupStatus(m, { meta: data.meta, linkCoverage: { builds_on: null, follows_up: 'Sequence', replaces: null, fixes: null, related: 'Relates' } });
  const by = Object.fromEntries(s.items.map((i) => [i.id, i]));
  assert.equal(by.teams.status, 'todo'); // Ivy, Omar, Yui guessed from project
  assert.match(by.teams.detail, /guessed from their main project/);
  assert.equal(by.dependencies.status, 'ok');
  assert.equal(by.flagged.status, 'todo'); // DES-5 is flagged and nothing is linked as what it waits on
  assert.deepEqual(by.flagged.keys, ['DES-5']);
  assert.equal(by.linktypes.detail.startsWith('2 of 5 relations'), true);
  assert.deepEqual(by.linktypes.missing, ['builds_on', 'replaces', 'fixes']);
  assert.equal(by.single.status, 'info');
  assert.ok(!by.flaggedField); // site has the field
  assert.equal(s.todo, s.items.filter((i) => i.status === 'todo').length);
});

test('setup checklist: no links → dependencies todo; flagged without blocker → todo; teams set → ok', async () => {
  const data = await load('MOB', { noLinks: true, flagged: ['MOB-2'] });
  const people = buildModel(data).people.map((p) => p.accountId);
  const m = buildModel(data, { teamOverrides: Object.fromEntries(people.map((p) => [p, 'Mobile'])) });
  const by = Object.fromEntries(setupStatus(m, { meta: data.meta }).items.map((i) => [i.id, i]));
  assert.equal(by.dependencies.status, 'todo');
  assert.match(by.dependencies.detail, /^0 of \d+ open tasks/);
  assert.equal(by.flagged.status, 'todo');
  assert.deepEqual(by.flagged.keys, ['MOB-2']);
  assert.equal(by.teams.status, 'ok');
});

test('setup checklist works on the MVP data without loader meta', () => {
  const s = setupStatus(buildModel(small));
  assert.ok(s.items.length >= 4);
  assert.ok(!s.items.some((i) => i.id === 'linktypes'));
});

test('wording: no banned terms in the new text', () => {
  const m = buildModel(large);
  const text = [...setupStatus(m, { linkCoverage: {} }).items.map((i) => `${i.title} ${i.detail}`), ...singlePersonWork(m).rows.map((r) => r.name)].join(' ');
  assert.doesNotMatch(text, /\b(knows|expert|bus factor|person risk|most important|workload|capacity|hours|backup|should ask|recommend)\b/i);
});
