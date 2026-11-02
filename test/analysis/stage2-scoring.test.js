import { test } from 'node:test';
import assert from 'node:assert/strict';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel } from '../../static/team-map/src/analysis/adapter.js';
import { coverageRisk, ranking, absenceImpact, coverBadges, unblock, FORMULA, WEIGHTS } from '../../static/team-map/src/analysis/scoring.js';

const S = buildModel(small);
const L = buildModel(large);
const id = (m, n) => m.people.find((p) => p.name === n).accountId;
const out = (m, ...ns) => new Set(ns.map((n) => id(m, n)));
const risk = (m, n, absent) => coverageRisk(m, id(m, n), absent);
const parts = (r) => r.components.map((c) => `${c.kind}:${c.points}:${c.keys.join(',')}`);
const chains = (r) => r.waiting.map((w) => `${w.chainText} [${w.keysText}]`);
const table = (m, absent) => ranking(m, absent).rows.map((r) => `${r.name}:${r.score}${absent ? `:${r.delta}` : ''}`);

test('formula is the spec formula', () => {
  assert.deepEqual(WEIGHTS, { cold: 4, warm: 2, blockedOrOverdue: 2, waiting: 4, soleTeamLink: 2, leadChange: 2 });
  assert.equal(FORMULA.length, 6);
});

test('every score equals the sum of its listed reasons, and every reason has keys', () => {
  for (const m of [S, L])
    for (const p of m.people) {
      const r = coverageRisk(m, p.accountId);
      assert.equal(r.score, r.components.reduce((s, c) => s + c.points, 0));
      for (const c of r.components) assert.ok(c.keys.length > 0, `${p.name} ${c.kind}`);
    }
});

// ------------------------------------------------------------------ small: exact
test('small: ranking', () => {
  assert.deepEqual(table(S), ['Ben:10', 'Ana:8', 'Cy:6', 'Dee:4', 'Pam:2']);
});

test('small: per-person components', () => {
  assert.deepEqual(parts(risk(S, 'Ben')), ['cold:4:PLAT-3', 'blockedOrOverdue:2:PLAT-3', 'waiting:4:APP-2,PLAT-3']);
  assert.deepEqual(parts(risk(S, 'Ana')), ['waiting:8:APP-1,APP-3,PLAT-1']); // PLAT-1 covered by Ben's sub-task
  assert.deepEqual(parts(risk(S, 'Cy')), ['warm:2:APP-1', 'waiting:4:APP-1,APP-3']); // Dee was past assignee
  assert.deepEqual(parts(risk(S, 'Dee')), ['waiting:4:APP-2,PLAT-3']); // APP-2 covered by Cy's sub-task
  assert.deepEqual(parts(risk(S, 'Pam')), ['leadChange:2:APP-3,PLAT-4']); // reporter-lead of unassigned blocker, with the task waiting on it
  assert.deepEqual(risk(S, 'Ana').covered.map((c) => `${c.key}:${c.leftOn}`), ['PLAT-1:Ben']);
  assert.deepEqual(risk(S, 'Ana').leadOnly.map((l) => l.key), ['PLAT-6']); // listed, not scored
  assert.deepEqual(risk(S, 'Dee').solo, ['APP-3']);
  assert.deepEqual(risk(S, 'Ben').stale, ['PLAT-3']);
});

test('small: full chains, cycle guarded', () => {
  assert.deepEqual(chains(risk(S, 'Ana')), ['Cy → Ana [APP-1 → PLAT-1]', 'Dee → Cy → Ana [APP-3 → APP-1 → PLAT-1]']);
  assert.deepEqual(chains(risk(S, 'Ben')), ['Dee → Ben [APP-2 → PLAT-3]']); // cycle PLAT-3 <-> APP-2 ends
  assert.deepEqual(chains(risk(S, 'Dee')), ['Ben → Dee [PLAT-3 → APP-2]']);
});

test('small: unblock sentences', () => {
  assert.equal(unblock(S, id(S, 'Ana')).sentence, "1 task starts once Ana's blocking work is done.");
  assert.equal(unblock(S, id(S, 'Cy')).sentence, "0 tasks start once Cy's blocking work is done; 1 more also waits on other work.");
  assert.deepEqual(unblock(S, id(S, 'Cy')).alsoWaitKeys, ['APP-3']); // also waits on unassigned PLAT-4
});

test('small: Ben out', () => {
  const A = out(S, 'Ben');
  assert.deepEqual(table(S, A), ['Ana:14:6', 'Ben:10:0', 'Cy:8:2', 'Pam:2:0', 'Dee:0:-4']);
  assert.deepEqual(parts(risk(S, 'Ana', A)), ['cold:4:PLAT-1', 'waiting:8:APP-1,APP-3,PLAT-1', 'soleTeamLink:2:APP-1,PLAT-1']);
  const a = absenceImpact(S, A);
  assert.deepEqual(a.stalledKeys, ['PLAT-3']);
  assert.deepEqual(a.brokenEdges, ['u-dee>u-ben']);
  assert.deepEqual(a.leftWaiting.map((w) => w.chainText), ['Dee → Ben']);
  assert.deepEqual(a.context, []);
});

test('small: cover badges', () => {
  const b = coverBadges(S);
  assert.deepEqual(Object.fromEntries([...b].map(([k, v]) => [k, v.color])), {
    'u-cy>u-ana': 'green', 'u-dee>u-ben': 'amber', 'u-dee>u-cy': 'green', 'u-ben>u-dee': 'green',
  });
  assert.equal(coverBadges(S, out(S, 'Ben')).get('u-cy>u-ana').color, 'amber'); // only other person is out
});

// ------------------------------------------------------------------ large
test('large: ranking with reasons', () => {
  assert.deepEqual(table(L), ['Sam:22', 'Tara:20', 'Vic:20', 'Mia:18', 'Ivy:12', 'Lea:10', 'Paula:2', 'Xan:2']);
  assert.deepEqual(parts(risk(L, 'Mia')), ['cold:4:DES-2', 'waiting:12:DES-2,DES-3,MOB-3,MOB-8,WEB-2', 'soleTeamLink:2:DES-2,DES-3,MOB-3,MOB-8']);
  assert.deepEqual(parts(risk(L, 'Sam')).map((p) => p.split(':').slice(0, 2).join(':')), ['waiting:16', 'soleTeamLink:2', 'soleTeamLink:2', 'leadChange:2']);
  assert.deepEqual(risk(L, 'Sam').soleTeamLinks.map((s) => s.id), ['Backend – Frontend', 'Backend – Mobile']);
  assert.deepEqual(risk(L, 'Sam').leadChanges.map((l) => `${l.key}:${l.why}`), ['API-7:assignee Dan deactivated']);
  assert.deepEqual(risk(L, 'Sam').covered.map((c) => `${c.key}:${c.leftOn}`), ['API-2:Vic']);
  assert.deepEqual(parts(risk(L, 'Vic')).map((p) => p.split(':').slice(0, 2).join(':')), ['cold:4', 'waiting:16']);
  assert.deepEqual(risk(L, 'Mia').covered.map((c) => c.key), ['DES-3']); // Noah's sub-task
  for (const n of ['Ken', 'Wen', 'Yui', 'Omar', 'Uri', 'Noah']) assert.equal(risk(L, n).score, 0, n);
  assert.deepEqual(risk(L, 'Ken').solo, ['WEB-2', 'WEB-4', 'WEB-6']);
});

test('large: chains all the way, through the Sam/Vic cycle', () => {
  assert.deepEqual(chains(risk(L, 'Tara')), [
    'Sam → Tara [API-2 → API-3]',
    'Lea → Sam → Tara [WEB-3 → API-2 → API-3]',
    'Vic → Sam → Tara [API-5 → API-2 → API-3]',
    'Xan → Sam → Tara [MOB-5 → API-2 → API-3]',
    'Omar → Lea → Sam → Tara [WEB-5 → WEB-3 → API-2 → API-3]',
  ]);
  assert.deepEqual(chains(risk(L, 'Vic')), [
    'Sam → Vic [API-2 → API-5]',
    'Lea → Sam → Vic [WEB-3 → API-2 → API-5]',
    'Xan → Sam → Vic [MOB-5 → API-2 → API-5]',
    'Omar → Lea → Sam → Vic [WEB-5 → WEB-3 → API-2 → API-5]',
  ]);
  assert.ok(!risk(L, 'Vic').waiting.some((w) => w.name === 'Vic'));
});

test('large: unblock sentences', () => {
  assert.equal(unblock(L, id(L, 'Mia')).sentence, "4 tasks start once Mia's blocking work is done.");
  assert.deepEqual(unblock(L, id(L, 'Mia')).startKeys, ['MOB-3', 'MOB-8', 'WEB-2', 'WEB-4']);
  assert.equal(unblock(L, id(L, 'Sam')).sentence, "2 tasks start once Sam's blocking work is done; 1 more also waits on other work.");
  assert.deepEqual(unblock(L, id(L, 'Sam')).alsoWaitKeys, ['WEB-3']);
  assert.equal(unblock(L, id(L, 'Lea')).sentence, "1 task starts once Lea's blocking work is done.");
});

test('large: Mia out', () => {
  const A = out(L, 'Mia');
  const a = absenceImpact(L, A);
  assert.deepEqual(a.stalledKeys, ['DES-2', 'DES-3']);
  assert.deepEqual(a.brokenEdges.sort(), ['u-ken>u-mia', 'u-wen>u-mia', 'u-yui>u-mia']);
  assert.deepEqual(a.leftWaiting.map((w) => w.name), ['Ken', 'Wen', 'Yui']);
  assert.deepEqual(a.context.map((c) => `${c.name}:${c.items.map((i) => `${i.key}/${i.how}`)}`), ['Noah:DES-3/sub-task']);
  const t = Object.fromEntries(a.ranking.map((r) => [r.name, [r.score, r.delta]]));
  assert.deepEqual(t.Ivy, [14, 2]); // now sole Design–Frontend link
  assert.deepEqual(t.Lea, [12, 2]);
  assert.deepEqual(t.Paula, [6, 4]); // lead of DES-2, DES-3 falls back to reporter Paula
  assert.equal(a.ranking.find((r) => r.name === 'Mia').out, true);
});

test('large: Sam out', () => {
  const a = absenceImpact(L, out(L, 'Sam'));
  assert.deepEqual(a.stalledKeys, ['API-2']);
  assert.deepEqual(a.leftWaiting.map((w) => w.chainText), ['Lea → Sam', 'Vic → Sam', 'Xan → Sam', 'Omar → Lea → Sam']);
  assert.deepEqual(a.context.map((c) => c.name), ['Vic']);
  const t = Object.fromEntries(a.ranking.map((r) => [r.name, [r.score, r.delta]]));
  assert.deepEqual(t.Tara, [16, -4]);
  assert.deepEqual(t.Vic, [16, -4]);
  assert.deepEqual(t.Lea, [8, -2]);
  assert.deepEqual(t.Xan, [0, -2]);
});

test('large: two people out compose', () => {
  const a = absenceImpact(L, out(L, 'Sam', 'Mia'));
  assert.deepEqual(a.stalledKeys, ['API-2', 'DES-2', 'DES-3']);
  assert.deepEqual(a.leftWaiting.map((w) => w.name).sort(), ['Ken', 'Lea', 'Omar', 'Vic', 'Wen', 'Xan', 'Yui']);
  assert.deepEqual(a.context.map((c) => c.name), ['Noah', 'Vic']);
});

test('large: cover badges', () => {
  const b = Object.fromEntries([...coverBadges(L)].map(([k, v]) => [k, v.color]));
  assert.deepEqual(b, {
    'u-lea>u-ivy': 'amber', 'u-omar>u-lea': 'amber', 'u-ken>u-mia': 'amber', 'u-wen>u-mia': 'green', 'u-yui>u-mia': 'amber',
    'u-lea>u-sam': 'green', 'u-vic>u-sam': 'green', 'u-xan>u-sam': 'green', 'u-sam>u-tara': 'green', 'u-sam>u-vic': 'amber',
  });
});

test('wording: no banned terms in generated text', () => {
  const banned = /\b(knows|expert|bus factor|person risk|most important|workload|capacity|hours|backup|should ask)\b/i;
  for (const m of [S, L]) {
    for (const p of m.people) {
      const r = coverageRisk(m, p.accountId);
      assert.doesNotMatch(`${r.reasonText} ${r.unblock.sentence} ${chains(r).join(' ')}`, banned);
    }
  }
  assert.doesNotMatch(FORMULA.map((f) => f.text).join(' '), banned);
});
