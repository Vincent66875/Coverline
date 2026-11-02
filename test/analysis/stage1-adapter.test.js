import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel, linkDirection, teamFromGroup, provenance } from '../../static/team-map/src/analysis/adapter.js';
import { LINK_TYPES } from '../fixtures/build.js';

const S = buildModel(small);
const L = buildModel(large);
const names = (m, ids) => ids.map(m.nameOf);
const edgeList = (m) => m.personEdges.map((e) => `${m.nameOf(e.waiterId)}>${m.nameOf(e.blockerId)}:${e.weight}`).sort();
const kn = (m, key) =>
  (m.knowledgeByIssue.get(key) ?? []).map((k) => `${m.nameOf(k.person)}|${k.how}|${k.via}|${k.current ? 'now' : 'before'}`).sort();

// ---------------------------------------------------------------- fixtures
test('fixtures: every link is written on both issues with the same id', () => {
  for (const fx of [small, large]) {
    const sides = new Map();
    for (const i of fx.issues)
      for (const l of i.fields.issuelinks) {
        const s = sides.get(l.id) ?? [];
        s.push({ on: i.key, other: (l.outwardIssue ?? l.inwardIssue).key, dir: l.outwardIssue ? 'out' : 'in' });
        sides.set(l.id, s);
      }
    for (const [id, s] of sides) {
      assert.equal(s.length, 2, `link ${id} on ${s.length} issues`);
      assert.equal(s[0].on, s[1].other);
      assert.notEqual(s[0].dir, s[1].dir);
    }
  }
});

test('fixtures: Jira REST shape', () => {
  const i = large.issues.find((x) => x.key === 'DES-2');
  for (const f of ['summary', 'status', 'issuetype', 'assignee', 'reporter', 'project', 'components', 'labels', 'duedate', 'created', 'updated', 'resolutiondate', 'customfield_10016', 'parent', 'issuelinks'])
    assert.ok(f in i.fields, f);
  assert.equal(i.fields.status.statusCategory.key, 'indeterminate');
  assert.ok(Array.isArray(i.changelog.histories));
  const u = large.users[0];
  for (const f of ['accountId', 'displayName', 'active', 'accountType', 'groups']) assert.ok(f in u, f);
});

test('large fixture: size and history coverage', () => {
  assert.equal(large.issues.length, 40);
  const humans = L.people.filter((p) => !p.reporterOnly);
  const teams = new Map();
  for (const p of humans) teams.set(p.team, (teams.get(p.team) ?? 0) + 1);
  assert.deepEqual([...teams.keys()].sort(), ['Backend', 'Design', 'Frontend', 'Mobile']);
  for (const n of teams.values()) assert.ok(n >= 3 && n <= 4);
  assert.deepEqual(L.people.filter((p) => p.reporterOnly).map((p) => p.name), ['Paula']);
  const asOf = Date.parse('2026-10-29T12:00:00Z');
  const done = L.issues.filter((i) => i.done && !i.isEpic);
  const old = done.filter((i) => asOf - Date.parse(i.resolved.replace('+0000', 'Z')) > 365 * 864e5).map((i) => i.key);
  assert.deepEqual(old.sort(), ['API-9', 'WEB-8']);
  assert.ok(done.length >= 10);
  const labelProjects = new Set(L.issues.filter((i) => i.labels.includes('checkout-2026')).map((i) => i.project));
  assert.deepEqual([...labelProjects].sort(), ['API', 'DES', 'WEB']);
  for (const p of ['DES', 'WEB', 'API', 'MOB'])
    assert.ok(new Set(L.issues.filter((i) => i.project === p).flatMap((i) => i.components)).size >= 2, p);
});

// ---------------------------------------------------------------- adapter units
test('link direction comes from wording, not type name', () => {
  assert.equal(linkDirection(LINK_TYPES.blocks), 'outward-blocks');
  assert.equal(linkDirection(LINK_TYPES.depends), 'outward-waits');
  assert.equal(linkDirection({ name: 'Blocker', outward: 'is blocked by', inward: 'blocks' }), 'outward-waits');
  assert.equal(teamFromGroup('platform-team'), 'Platform');
  assert.equal(teamFromGroup('team-design_ops'), 'Design Ops');
});

test('analysis modules import nothing from React', () => {
  for (const f of readdirSync(new URL('../../static/team-map/src/analysis/', import.meta.url)))
    assert.doesNotMatch(readFileSync(new URL(`../../static/team-map/src/analysis/${f}`, import.meta.url), 'utf8'), /from ['"]react/);
});

// ---------------------------------------------------------------- small: exact values
test('small: people, teams and team sources', () => {
  assert.deepEqual(
    S.people.map((p) => `${p.name}:${p.team}:${p.teamSource}`),
    ['Cy:App:project key', 'Dee:App:team field', 'Ana:Platform:team field', 'Ben:Platform:jira group', 'Pam:Product:team field'],
  );
  assert.deepEqual(S.excluded.map((e) => `${e.displayName}:${e.reason}`), ['Eli:deactivated', 'Automation for Jira:bot or app']);
});

test('small: issue-level fields (owner, lead, stale, rollup)', () => {
  const i = (k) => S.issueByKey.get(k);
  assert.equal(i('PLAT-2').workKey, 'PLAT-1');
  assert.equal(i('APP-4').workKey, 'APP-2');
  assert.equal(i('APP-1').epicKey, 'APP-5');
  assert.equal(i('PLAT-6').ownerId, null); // deactivated assignee
  assert.equal(i('PLAT-6').leadId, 'u-ana'); // fallback human reporter
  assert.equal(i('PLAT-6').leadSource, 'reporter');
  assert.equal(i('PLAT-4').leadId, 'u-pam');
  assert.equal(i('PLAT-3').leadId, 'u-ben');
  assert.equal(i('PLAT-3').reporterId, 'u-bot');
  assert.deepEqual(S.dataQuality.stale, ['PLAT-3']);
  assert.equal(i('APP-3').overdue, true);
  assert.equal(i('PLAT-3').blocked, true);
});

test('small: dependencies (rollup, dedupe, depends-on, resolved, relates ignored)', () => {
  assert.deepEqual(
    S.dependencies.map((d) => `${d.waiterKey}<${d.blockerKey}:${d.open ? 'open' : 'resolved'}:${d.linkIds.join('+')}`).sort(),
    [
      'APP-1<PLAT-1:open:1001+1005',
      'APP-2<PLAT-3:open:1002',
      'APP-3<APP-1:open:1003',
      'APP-3<PLAT-4:open:1004',
      'PLAT-1<PLAT-5:resolved:1008',
      'PLAT-3<APP-2:open:1006',
    ],
  );
  const dup = S.dependencies.find((d) => d.id === 'APP-1<PLAT-1');
  assert.deepEqual(dup.sourcePairs, [{ waiterKey: 'APP-1', blockerKey: 'PLAT-1' }, { waiterKey: 'APP-1', blockerKey: 'PLAT-2' }]);
  const dq = S.dataQuality.links;
  assert.equal(dq.total, 9); // 8 + one 'Builds on' link (1009), which is not ignored
  assert.deepEqual(dq.ignored.map((x) => x.linkId), []); // Relates (1007) is now a "related to" work link, still never a dependency
  assert.ok(S.workLinks.some((r) => r.linkId === '1007' && r.type === 'related'));
  assert.ok(!S.dependencies.some((d) => d.linkIds.includes('1007')));
  assert.deepEqual(dq.duplicatesMerged.map((x) => x.linkId), ['1005']);
  assert.equal(dq.oneSided.length, 0);
  assert.equal(dq.mismatched, 0);
});

test('small: person edges and sentences', () => {
  assert.deepEqual(edgeList(S), ['Ben>Dee:1', 'Cy>Ana:1', 'Dee>Ben:1', 'Dee>Cy:1']);
  const s = S.personEdges.flatMap((e) => e.pairs.map((p) => p.sentence)).sort();
  assert.deepEqual(s, [
    "Ben waits on Dee: Dee's 'Session handling' [APP-2] (To Do) blocks Ben's 'Rate limiter' [PLAT-3].",
    "Cy waits on Ana: Ana's 'Auth service' [PLAT-1] (In Progress, due in 3 days) blocks Cy's 'Login screen' [APP-1].",
    "Dee waits on Ben: Ben's 'Rate limiter' [PLAT-3] (Blocked) blocks Dee's 'Session handling' [APP-2].",
    "Dee waits on Cy: Cy's 'Login screen' [APP-1] (To Do, due in 12 days) blocks Dee's 'Checkout' [APP-3].",
  ]);
  assert.deepEqual(S.personEdges.filter((e) => e.red).map((e) => e.id), ['u-dee>u-ben']);
});

test('small: knowledge records', () => {
  assert.equal(S.knowledge.length, 11);
  assert.deepEqual(kn(S, 'PLAT-1'), ['Ana|assignee|PLAT-1|now', 'Ben|past assignee|PLAT-1|before', 'Ben|sub-task|PLAT-2|now']);
  assert.deepEqual(kn(S, 'APP-1'), ['Cy|assignee|APP-1|now', 'Dee|past assignee|APP-1|before']); // bounce: no Cy past
  assert.deepEqual(kn(S, 'APP-2'), ['Cy|sub-task|APP-4|now', 'Dee|assignee|APP-2|now', 'Dee|past assignee|APP-4|before']);
  assert.deepEqual(kn(S, 'PLAT-3'), ['Ben|assignee|PLAT-3|now']); // from-unassigned, status-only ignored
  assert.deepEqual(kn(S, 'PLAT-5'), ['Ana|assignee|PLAT-5|before']);
  assert.deepEqual(kn(S, 'PLAT-6'), []); // deactivated
  assert.deepEqual(kn(S, 'APP-5'), []); // epic
  assert.deepEqual(kn(S, 'PLAT-2'), []); // credited to parent
  assert.ok(S.knowledge.every((k) => k.person !== 'u-pam' && k.person !== 'u-bot' && k.person !== 'u-eli'));
});

test('small: data quality report', () => {
  const dq = S.dataQuality;
  assert.equal(dq.issues.total, 11);
  assert.equal(dq.issues.openWork.length, 7);
  assert.equal(dq.openWorkAssigned.pct, 71);
  assert.deepEqual(dq.openWorkAssigned.unassigned, ['PLAT-4']);
  assert.deepEqual(dq.openWorkAssigned.assignedToExcluded, ['PLAT-6']);
  assert.equal(dq.dependencies.open.length, 5);
  assert.deepEqual(dq.blockersWithoutAssignee.map((b) => `${b.blockerKey}:${b.reason}`), ['PLAT-4:unassigned']);
  assert.deepEqual(Object.fromEntries(Object.entries(dq.teamSources).map(([k, v]) => [k, v.length])), { 'project key': 1, 'team field': 3, 'jira group': 1 });
  assert.deepEqual(dq.secondPerson, { pct: 43, keys: ['APP-1', 'APP-2', 'PLAT-1'] });
  assert.deepEqual(
    { ...dq.changelog },
    { issuesWithChangelog: 5, histories: 7, items: 7, assigneeChanges: 6, otherFieldItems: 1, statusOnlyHistories: 1, fromUnassigned: 1, fromExcluded: 1, supersededByCurrent: 1, duplicatePast: 0, used: 3, epicSkipped: 0 },
  );
  assert.equal(provenance(S).text, 'Built from 11 Jira issues with no manual input · 71% assigned · 5 dependency links');
});

// ---------------------------------------------------------------- large: edge cases
test('large: person edges incl. weight 2 and cycle through sub-task', () => {
  assert.deepEqual(edgeList(L), [
    'Ken>Mia:2', 'Lea>Ivy:1', 'Lea>Sam:1', 'Omar>Lea:1', 'Sam>Tara:1', 'Sam>Vic:1', 'Vic>Sam:1', 'Wen>Mia:1', 'Xan>Sam:1', 'Yui>Mia:1',
  ]);
  const ken = L.personEdges.find((e) => e.id === 'u-ken>u-mia');
  assert.equal(ken.pairs[0].sentence, "Ken waits on Mia: Mia's 'Design tokens' [DES-2] (In Progress, due in 3 days) blocks Ken's 'Token migration' [WEB-2].");
  assert.deepEqual(L.personEdges.filter((e) => e.red).map((e) => L.nameOf(e.waiterId)).sort(), ['Lea', 'Vic', 'Xan']);
  // cycle: API-5 -> API-6 (sub-task of API-2) rolled up
  assert.deepEqual(L.dependencies.find((d) => d.id === 'API-2<API-5').sourcePairs, [{ waiterKey: 'API-6', blockerKey: 'API-5' }]);
});

test('large: depends-on reversed wording, duplicate, self-rollup, resolved, relates', () => {
  assert.ok(L.dependencies.some((d) => d.id === 'MOB-5<API-2' && d.linkTypes[0] === 'Dependency'));
  assert.ok(!L.dependencies.some((d) => d.id === 'API-2<MOB-5'));
  const dq = L.dataQuality;
  assert.deepEqual(dq.links.duplicatesMerged.map((x) => x.linkId), ['2009']);
  assert.deepEqual(dq.links.selfAfterRollup.map((x) => `${x.linkId}:${x.rolledTo}`), ['2016:DES-3']);
  assert.deepEqual(dq.dependencies.resolved.sort(), ['DES-2<DES-6', 'WEB-3<WEB-7']);
  assert.deepEqual(dq.links.ignored, []); // Relates (2015) is now a "related to" work link, never a dependency
  assert.ok(L.workLinks.some((r) => r.linkId === '2015' && r.type === 'related'));
  assert.deepEqual(dq.blockersWithoutAssignee.map((b) => `${b.blockerKey}:${b.reason}`).sort(), ['API-7:assignee excluded', 'MOB-6:unassigned']);
});

test('large: teams from team field / non-default group / project key', () => {
  const t = (n) => L.people.find((p) => p.name === n);
  assert.deepEqual([t('Tara').team, t('Tara').teamSource], ['Backend', 'jira group']); // site-admins skipped
  assert.deepEqual([t('Ivy').team, t('Ivy').teamSource], ['Design', 'jira group']);
  assert.deepEqual([t('Omar').team, t('Omar').teamSource], ['Frontend', 'project key']);
  assert.deepEqual([t('Yui').team, t('Yui').teamSource], ['Mobile', 'project key']);
  assert.deepEqual([t('Mia').team, t('Mia').teamSource], ['Design', 'team field']);
});

test('large: knowledge edge cases', () => {
  assert.deepEqual(kn(L, 'WEB-4'), ['Ken|assignee|WEB-4|now', 'Lea|past assignee|WEB-4|before']); // handoff
  assert.deepEqual(kn(L, 'API-10'), ['Sam|sub-task|API-11|before', 'Tara|assignee|API-10|before', 'Uri|past assignee|API-11|before']); // sub-task reassignment
  assert.deepEqual(kn(L, 'API-9'), ['Sam|assignee|API-9|before']); // deactivated past assignee dropped
  assert.deepEqual(kn(L, 'MOB-9'), ['Wen|past assignee|MOB-9|before', 'Xan|assignee|MOB-9|before']); // bounce
  assert.deepEqual(kn(L, 'API-12'), ['Vic|assignee|API-12|before']); // from-unassigned + status-only
  assert.deepEqual(kn(L, 'API-7'), []); // deactivated assignee
  assert.deepEqual(kn(L, 'API-8'), ['Uri|assignee|API-8|now']); // bot reporter not credited
  assert.deepEqual(kn(L, 'API-2'), ['Sam|assignee|API-2|now', 'Vic|sub-task|API-6|now']);
  for (const e of ['DES-1', 'WEB-1', 'API-1', 'MOB-1']) assert.deepEqual(kn(L, e), []);
  const ids = new Set(L.knowledge.map((k) => k.person));
  for (const x of ['u-paula', 'u-dan', 'u-bot']) assert.ok(!ids.has(x), x);
  assert.deepEqual(L.dataQuality.stale, ['MOB-6', 'WEB-5']);
  assert.deepEqual(names(L, L.dataQuality.teamSources['project key']), ['Omar', 'Yui']);
});

test('large: data quality headline numbers', () => {
  const dq = L.dataQuality;
  assert.equal(dq.openWorkAssigned.pct, 90);
  assert.equal(dq.dependencies.open.length, 13);
  assert.deepEqual(dq.secondPerson, { pct: 20, keys: ['API-2', 'API-3', 'DES-3', 'WEB-4'] });
  assert.equal(dq.changelog.used, 5);
  assert.equal(dq.changelog.fromExcluded, 1);
});
