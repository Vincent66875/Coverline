import { test } from 'node:test';
import assert from 'node:assert/strict';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel } from '../../static/team-map/src/analysis/adapter.js';
import { whoHasWorkedOn, resolveQuery } from '../../static/team-map/src/analysis/search.js';
import { teamSentences, edgeLabels, wrapLabel } from '../../static/team-map/src/analysis/labels.js';

const S = buildModel(small);
const L = buildModel(large);
const list = (m, q, opts) => whoHasWorkedOn(m, q, opts).people.map((p) => `${p.name}:t${p.tier}`);
const ev = (m, q, name) => whoHasWorkedOn(m, q).people.find((p) => p.name === name).evidence.map((e) => `${e.how}|${e.issueKey}|${e.via}|${e.current ? 'now' : 'before'}`);

test('resolveQuery', () => {
  assert.deepEqual(resolveQuery(L, 'des-2'), { kind: 'issue', value: 'DES-2' });
  assert.deepEqual(resolveQuery(L, 'DES-1'), { kind: 'epic', value: 'DES-1' });
  assert.deepEqual(resolveQuery(L, 'component:Payments'), { kind: 'component', value: 'payments' });
  assert.deepEqual(resolveQuery(L, 'tokens'), { kind: 'label', value: 'tokens' });
  assert.deepEqual(resolveQuery(L, 'Mobile wallet'), { kind: 'epic', value: 'MOB-1' });
  assert.equal(resolveQuery(L, 'nope'), null);
  assert.deepEqual(whoHasWorkedOn(L, 'nope').people, []);
});

// ---------------------------------------------------------- tickets (large)
test('DES-2: tier 1 owner, then linked tickets most recent first, capped at 5', () => {
  const r = whoHasWorkedOn(L, 'DES-2');
  assert.deepEqual(list(L, 'DES-2'), ['Mia:t1', 'Yui:t2', 'Ken:t2', 'Lea:t2', 'Noah:t2']);
  assert.equal(r.more, 1); // Ivy (same component) cut by the cap
  assert.deepEqual(ev(L, 'DES-2', 'Noah'), ['assignee|DES-6|DES-6|before', 'sub-task|DES-3|DES-4|now']); // resolved link counts
});

test('API-2: sub-task helper in tier 1, deactivated and >12-month work dropped', () => {
  const r = whoHasWorkedOn(L, 'API-2');
  assert.deepEqual(list(L, 'API-2'), ['Sam:t1', 'Vic:t1', 'Lea:t2', 'Tara:t2', 'Xan:t2']);
  assert.equal(r.dropped, 1); // API-9 (Sam, 13 months)
  assert.ok(!r.people.some((p) => p.name === 'Dan'));
  assert.deepEqual(ev(L, 'API-2', 'Vic')[0], 'sub-task|API-2|API-6|now');
});

test('WEB-3: links in both directions', () => {
  assert.deepEqual(list(L, 'WEB-3'), ['Lea:t1', 'Sam:t2', 'Ivy:t2', 'Vic:t2', 'Omar:t2']);
  assert.equal(whoHasWorkedOn(L, 'WEB-3').dropped, 2); // API-9, WEB-8
});

test('MOB-3: tier 3 by component, after linked', () => {
  // WEB-2 "is related to" MOB-3 (Jira Relates link) brings Ken in at tier 2
  assert.deepEqual(list(L, 'MOB-3'), ['Wen:t1', 'Ken:t2', 'Mia:t2', 'Noah:t2', 'Xan:t3']);
});

test('API-7: deactivated owner yields no tier-1 people', () => {
  assert.deepEqual(list(L, 'API-7'), ['Ken:t2', 'Sam:t3', 'Vic:t3']);
});

test('sub-task key searches its parent', () => {
  assert.deepEqual(list(L, 'API-6'), list(L, 'API-2'));
});

test('marked-out people are marked, not hidden', () => {
  const r = whoHasWorkedOn(L, 'DES-3', { absent: new Set(['u-mia']) });
  const mia = r.people.find((p) => p.name === 'Mia');
  assert.equal(mia.out, true);
  assert.match(mia.line, /^Mia \(marked out\):/);
});

// ---------------------------------------------------------- areas (large)
test('component and label areas', () => {
  assert.deepEqual(list(L, 'component:design-system'), ['Mia:t1', 'Ivy:t1', 'Noah:t1', 'Lea:t2', 'Yui:t2']);
  assert.deepEqual(list(L, 'label:checkout-2026'), ['Lea:t1', 'Sam:t1', 'Ivy:t1', 'Vic:t1', 'Omar:t1']); // spans DES, WEB, API
  assert.deepEqual(list(L, 'epic:MOB-1'), ['Xan:t1', 'Yui:t1', 'Wen:t1', 'Mia:t2', 'Sam:t2']);
});

// ---------------------------------------------------------- small: exact
test('small: tickets and areas', () => {
  assert.deepEqual(list(S, 'PLAT-1'), ['Ana:t1', 'Ben:t1', 'Cy:t2', 'Dee:t2']);
  assert.deepEqual(list(S, 'PLAT-3'), ['Ben:t1', 'Cy:t2', 'Dee:t2']);
  assert.deepEqual(list(S, 'component:auth'), ['Cy:t1', 'Ana:t1', 'Ben:t1', 'Dee:t1']);
  assert.equal(
    whoHasWorkedOn(S, 'PLAT-1').people[1].line,
    'Ben: sub-task PLAT-1 via PLAT-2 (now, 9 days ago) · past assignee PLAT-1 (before, 58 days ago)',
  );
  for (const q of ['PLAT-1', 'APP-1', 'PLAT-3', 'component:auth', 'label:login'])
    for (const p of whoHasWorkedOn(S, q).people) assert.ok(!['Pam', 'Eli', 'Automation for Jira'].includes(p.name));
});

test('search output never recommends anyone', () => {
  const banned = /\b(should|backup|ask|recommend|best|expert|knows)\b/i;
  for (const q of ['DES-2', 'API-2', 'WEB-3', 'component:payments', 'label:checkout-2026'])
    for (const p of whoHasWorkedOn(L, q).people) assert.doesNotMatch(p.line, banned);
});

// ---------------------------------------------------------- team + zoom sentences
test('team sentences', () => {
  assert.deepEqual(teamSentences(L).map((s) => s.sentence), [
    'Frontend waits on Backend, through Sam only',
    'Frontend waits on Design, through Ivy and Mia',
    'Mobile waits on Backend, through Sam only',
    'Mobile waits on Design, through Mia only',
  ]);
  assert.deepEqual(teamSentences(S).map((s) => s.sentence), ['App waits on Platform, through Ana and Ben', 'Platform waits on App, through Dee only']);
  // with Ivy out, Frontend reaches Design only through Mia
  assert.ok(teamSentences(L, new Set(['u-ivy'])).some((s) => s.sentence === 'Frontend waits on Design, through Mia only'));
});

test('edge labels at three zooms', () => {
  const t = edgeLabels(L, 'ticket');
  assert.equal(t.get('u-ken>u-mia').text, 'Design tokens ×2');
  assert.equal(t.get('u-wen>u-mia').text, 'Icon set');
  assert.equal(edgeLabels(L, 'theme').get('u-ken>u-mia').text, 'Design system 2.0 ×2');
  assert.equal(edgeLabels(L, 'theme').get('u-lea>u-ivy').text, 'No epic');
  assert.equal(edgeLabels(L, 'team').get('u-yui>u-mia').text, 'Mobile waits on Design, through Mia only');
  assert.equal(edgeLabels(L, 'team').get('u-sam>u-tara').text, 'Within Backend');
});

test('wrapLabel: max 2 lines, ellipsis', () => {
  assert.deepEqual(wrapLabel('Design tokens ×2', 22), ['Design tokens ×2']);
  assert.deepEqual(wrapLabel('Mobile waits on Design, through Mia only', 22), ['Mobile waits on', 'Design, through Mia…']);
  for (const s of ['Frontend waits on Design, through Ivy and Mia', 'a'.repeat(60), 'Push notification certs and more words here'])
    for (const l of wrapLabel(s, 22)) assert.ok(l.length <= 22, l);
});
