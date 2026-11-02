import { test } from 'node:test';
import assert from 'node:assert/strict';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel } from '../../static/team-map/src/analysis/adapter.js';
import { relationTypeOfJira, relationDirection, RELATION_ORDER, givesContext } from '../../static/team-map/src/analysis/relationTypes.js';
import { coverageRisk, coverBadges, ranking, absenceImpact } from '../../static/team-map/src/analysis/scoring.js';
import { peopleOnWork, whoHasWorkedOn } from '../../static/team-map/src/analysis/search.js';
import { addRelation, canAdd, removeRelation, changeRelation, linksOf } from '../../static/team-map/src/analysis/relations.js';
import { suggestBuildsOn, words } from '../../static/team-map/src/analysis/suggest.js';
import { boardColumns, columnOf } from '../../static/team-map/src/analysis/board.js';
import { graphData } from '../../static/team-map/src/graph/graphData.js';
import { LINK_TYPES } from '../fixtures/build.js';

const L = buildModel(large);
const S = buildModel(small);
const id = (m, n) => m.people.find((p) => p.name === n).accountId;
const NOW = '2026-10-29T12:00:00Z';
const withRel = (rels, fx = large) => buildModel(fx, { extraRelations: rels });
const rel = (fromKey, toKey, type = 'builds_on') => ({ fromKey, toKey, type, createdBy: null, createdAt: NOW });
const cols = (m, p, o) => boardColumns(m, id(m, p), o).columns.map((c) => `${c.label}[${c.cards.map((x) => x.key + (x.kind === 'own' ? '' : `/${x.kind}`)).join(',')}]`);

// ------------------------------------------------------------------ types and Jira links
test('five relation types; four give context, "related to" does not', () => {
  assert.deepEqual(RELATION_ORDER, ['builds_on', 'follows_up', 'replaces', 'fixes', 'related']);
  assert.deepEqual(RELATION_ORDER.map(givesContext), [true, true, true, true, false]);
});

test('Jira link types classified by wording, direction from "by"', () => {
  assert.equal(relationTypeOfJira(LINK_TYPES.buildsOn), 'builds_on');
  assert.equal(relationTypeOfJira(LINK_TYPES.sequence), 'follows_up');
  assert.equal(relationTypeOfJira(LINK_TYPES.relates), 'related');
  assert.equal(relationTypeOfJira({ name: 'Fixes', outward: 'fixes', inward: 'is fixed by' }), 'fixes');
  assert.equal(relationTypeOfJira({ name: 'Supersedes', outward: 'supersedes', inward: 'is superseded by' }), 'replaces');
  assert.equal(relationTypeOfJira({ name: 'Cloners', outward: 'clones', inward: 'is cloned by' }), null);
  assert.equal(relationDirection({ outward: 'is built on by' }), 'outward-earlier');
  assert.equal(relationDirection(LINK_TYPES.buildsOn), 'outward-newer');
  assert.deepEqual(L.workLinks.map((r) => `${r.id}:${r.source}`), ['WEB-2~related~MOB-3:jira', 'MOB-2~builds_on~MOB-10:jira', 'MOB-4~builds_on~MOB-9:jira', 'MOB-8~follows_up~MOB-9:jira']);
  assert.deepEqual(S.workLinks.map((r) => r.id), ['APP-1~related~PLAT-3', 'APP-2~builds_on~PLAT-5']);
});

test('work links are never dependencies, never arrows; fixture scores unchanged', () => {
  assert.equal(L.personEdges.length, 10);
  assert.deepEqual(ranking(L).rows.map((r) => `${r.name}:${r.score}`), ['Sam:22', 'Tara:20', 'Vic:20', 'Mia:18', 'Ivy:12', 'Lea:10', 'Paula:2', 'Xan:2']);
});

// ------------------------------------------------------------------ effect of each type
test('each context type turns DES-2 warm with its own wording; "related to" changes nothing', () => {
  const expect = {
    builds_on: 'builds on',
    follows_up: 'follows up on',
    replaces: 'replaces',
    fixes: 'fixes',
  };
  for (const [type, verb] of Object.entries(expect)) {
    const m = withRel([rel('DES-2', 'DES-6', type)]);
    const mia = coverageRisk(m, id(m, 'Mia'));
    assert.equal(mia.score, 16, type);
    assert.equal(mia.components[0].text, `DES-2 warm: no one else left on it, Noah worked on DES-6, which it ${verb}`);
    assert.deepEqual(mia.components[0].keys, ['DES-2', 'DES-6']);
    assert.equal(coverBadges(m).get('u-ken>u-mia').color, 'green');
    assert.equal(coverBadges(m).get('u-ken>u-mia').pairs[0].context[0].phrase, `Noah worked on DES-6, which DES-2 ${verb}`);
    assert.ok(peopleOnWork(m, id(m, 'Mia')).find((k) => k.name === 'Noah').line.startsWith(`Noah: worked on DES-6, which DES-2 ${verb}`));
  }
  const r = withRel([rel('DES-2', 'DES-6', 'related')]);
  assert.equal(coverageRisk(r, id(r, 'Mia')).score, 18);
  assert.equal(coverBadges(r).get('u-ken>u-mia').color, 'amber');
  assert.ok(whoHasWorkedOn(r, 'DES-2').keys.includes('DES-6')); // search only
});

test('context never stops the stall; absence rings and SR text pick it up', () => {
  const m = withRel([rel('WEB-3', 'WEB-9', 'fixes')]);
  const lea = coverageRisk(m, id(m, 'Lea'));
  assert.equal(lea.score, 8);
  assert.equal(lea.covered.length, 0);
  const m2 = withRel([rel('DES-2', 'DES-6')]);
  assert.ok(absenceImpact(m2, new Set([id(m2, 'Mia')])).context[0].items.some((i) => i.key === 'DES-2' && i.how.includes('earlier work')));
  assert.match(graphData(m2).sentences.find((s) => s.edgeId === 'u-ken>u-mia').text, /Cover: Noah worked on DES-6, which DES-2 builds on\.$/);
});

test('search: work-link neighbours are tier 2, labelled with the relation', () => {
  assert.deepEqual(whoHasWorkedOn(L, 'MOB-8').people.map((p) => `${p.name}:t${p.tier}:${p.tierLabel}`), ['Yui:t1:this ticket', 'Mia:t2:linked ticket', 'Xan:t2:MOB-8 follows up on MOB-9', 'Wen:t2:MOB-8 follows up on MOB-9']);
});

// ------------------------------------------------------------------ add / change / remove
test('rules: any two tasks (no access check), no epics, self, duplicates or context loops', () => {
  assert.equal(canAdd(L, 'DES-2', 'DES-6').ok, true);
  assert.equal(canAdd(L, 'WEB-2', 'DES-6', 'fixes').ok, true); // other people's tasks, either end
  assert.equal(canAdd(L, 'DES-2', 'DES-1').reason, 'Pick a task, not an epic');
  assert.equal(canAdd(L, 'DES-3', 'DES-4').reason, 'A task cannot be linked to itself'); // sub-task rolls up
  assert.equal(canAdd(L, 'MOB-9', 'MOB-4', 'fixes').reason, 'Already linked: MOB-4 builds on MOB-9'); // either direction
  assert.equal(canAdd(L, 'DES-2', 'DES-6', 'nope').reason, 'Unknown relation type');
  const m = withRel([rel('WEB-2', 'WEB-4'), rel('WEB-4', 'WEB-6')]);
  assert.equal(canAdd(m, 'WEB-6', 'WEB-2').reason, 'WEB-2 already builds on WEB-6 through other links');
  assert.equal(canAdd(m, 'WEB-6', 'WEB-2', 'related').ok, true); // "related to" has no direction
});

test('add, change type, swap, remove', () => {
  const a = addRelation(L, [], { fromKey: 'DES-2', toKey: 'DES-6', type: 'fixes' }, 'u-mia', NOW);
  assert.deepEqual(a.added, { fromKey: 'DES-2', toKey: 'DES-6', type: 'fixes', createdBy: 'u-mia', createdAt: NOW });
  const changed = changeRelation(a.relations, a.added, { type: 'replaces' });
  assert.equal(changed[0].type, 'replaces');
  const swapped = changeRelation(changed, changed[0], { swap: true });
  assert.deepEqual([swapped[0].fromKey, swapped[0].toKey], ['DES-6', 'DES-2']);
  assert.deepEqual(removeRelation(swapped, swapped[0]), []);
  assert.deepEqual(linksOf(withRel(a.relations), 'DES-6').map((x) => `${x.sentence}|${x.other}|${x.source}`), ['DES-2 fixes DES-6|DES-2|app']);
  assert.equal(addRelation(L, [], { fromKey: 'DES-2', toKey: 'DES-1' }).reason, 'Pick a task, not an epic');
});

test('old saved relations without a type load as "builds on"; bad ones are skipped', () => {
  const m = buildModel(large, { extraRelations: [{ fromKey: 'DES-2', toKey: 'DES-6' }, { fromKey: 'NOPE-1', toKey: 'DES-6' }, { fromKey: 'DES-2', toKey: 'DES-7', type: 'x' }] });
  assert.equal(m.workLinks.find((r) => r.source === 'app').type, 'builds_on');
  assert.deepEqual(m.dataQuality.workLinks.skipped.map((s) => s.reason), ['unknown issue', 'unknown type']);
});

// ------------------------------------------------------------------ suggestions
test('suggestions: ranked with reasons, 90 days, already-linked and dismissed drop out', () => {
  const s = (n, k) => suggestBuildsOn(L, k, id(L, n)).map((x) => `${x.toKey}:${x.owner}:${x.reason}`);
  assert.deepEqual(s('Mia', 'DES-2'), ['DES-6:Noah:same component design-system']);
  assert.deepEqual(s('Lea', 'WEB-3'), ["WEB-9:Omar:same component checkout · shares 'checkout'"]);
  assert.deepEqual(s('Mia', 'DES-3'), []);
  assert.deepEqual(s('Ken', 'WEB-2'), []);
  assert.deepEqual(suggestBuildsOn(L, 'DES-2', id(L, 'Mia'), { dismissed: ['DES-2<DES-6'] }), []);
  assert.deepEqual(suggestBuildsOn(withRel([rel('DES-2', 'DES-6', 'related')]), 'DES-2', 'u-mia'), []); // any link counts
  assert.deepEqual(words('Set up the CSS files for Checkout pages'), ['css', 'file', 'checkout']);
});

// ------------------------------------------------------------------ board
test('board columns: Now, weeks, months, Older; own first then linked/pinned/ghost', () => {
  assert.deepEqual(cols(L, 'Mia'), ['Now[DES-2,DES-3]', 'September 2026[DES-6/ghost]', 'March 2026[DES-7]']);
  assert.deepEqual(cols(L, 'Xan'), ['Now[MOB-4,MOB-5,MOB-8/linked]', 'April 2026[MOB-9]']);
  assert.deepEqual(cols(L, 'Ken'), ['Now[WEB-2,WEB-4,WEB-6,MOB-3/linked]']);
  assert.deepEqual(cols(L, 'Ken', { pinned: ['DES-7'] }), ['Now[WEB-2,WEB-4,WEB-6,MOB-3/linked]', 'March 2026[DES-7/pinned]']);
  assert.deepEqual(cols(L, 'Noah'), ['Now[]', 'September 2026[DES-6]', 'January 2026[DES-9]']); // Now always shown
  assert.deepEqual(cols(L, 'Mia', { dismissed: ['DES-2<DES-6'] }), ['Now[DES-2,DES-3]', 'March 2026[DES-7]']);
  const old = withRel([rel('WEB-2', 'WEB-8')]); // WEB-8 is 14 months old: only shown because it is linked
  assert.deepEqual(cols(old, 'Ken').at(-1), 'Older[WEB-8]');
});

test('board column labels for weeks', () => {
  const at = (days) => columnOf(L, { done: true, resolved: new Date(Date.parse(NOW) - days * 864e5).toISOString() }).label;
  assert.deepEqual([at(0), at(6), at(8), at(20), at(34)], ['This week', 'This week', 'Last week', '2–4 weeks ago', '2–4 weeks ago']);
  assert.equal(at(400), 'Older');
});

test('board lines: confirmed links between cards on the board, plus ghost suggestions', () => {
  const b = boardColumns(L, 'u-xan');
  assert.deepEqual(b.lines.map((l) => l.id), ['MOB-4~builds_on~MOB-9', 'MOB-8~follows_up~MOB-9']);
  assert.deepEqual(boardColumns(L, 'u-mia').ghostLines.map((g) => `${g.id}:${g.reason}`), ['DES-2?DES-6:same component design-system']);
});

test('wording: no banned terms', () => {
  const m = withRel([rel('DES-2', 'DES-6', 'fixes')]);
  const text = [coverageRisk(m, 'u-mia').reasonText, ...peopleOnWork(m, 'u-mia').map((k) => k.line)].join(' ');
  assert.doesNotMatch(text, /\b(knows|expert|bus factor|person risk|most important|workload|capacity|hours|backup|should ask|recommend)\b/i);
});

// ------------------------------------------------------------------ board line routing
import { routeLines } from '../../static/team-map/src/graph/boardRoute.js';

test('board routing: lines that skip columns go under the cards, never through them', () => {
  // 4 columns of cards, 224 wide with 112 gaps; two cards per column
  const boxes = new Map();
  const colOf = new Map();
  ['A', 'B', 'C', 'D'].forEach((c, ci) =>
    [0, 1].forEach((r) => {
      const x = 12 + ci * 336;
      const y = 40 + r * 80;
      boxes.set(`${c}${r}`, { x, y, w: 208, h: 70, cx: x + 104, cy: y + 35 });
      colOf.set(`${c}${r}`, ci);
    }),
  );
  const list = [
    { id: 'l1', fromKey: 'A0', toKey: 'B0', type: 'builds_on' }, // neighbours
    { id: 'l2', fromKey: 'A0', toKey: 'D0', type: 'fixes' }, // skips B and C
    { id: 'l3', fromKey: 'A1', toKey: 'C1', type: 'related' }, // skips B
    { id: 'l4', fromKey: 'A0', toKey: 'A1', type: 'replaces' }, // same column
  ];
  const { routes, lanes } = routeLines(list, boxes, colOf);
  assert.equal(lanes, 2);
  // sample each path's straight segments (skip routes are made of L/Q commands) and check no point is inside a card it does not connect
  for (const l of list) {
    const nums = routes.get(l.id).d.match(/-?\d+(\.\d+)?/g).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    for (const [k, b] of boxes) {
      if (k === l.fromKey || k === l.toKey) continue;
      for (const p of pts) assert.ok(!(p.x > b.x + 1 && p.x < b.x + b.w - 1 && p.y > b.y + 1 && p.y < b.y + b.h - 1), `${l.id} passes through ${k} at ${p.x},${p.y}`);
    }
  }
  const bottom = 40 + 80 + 70;
  assert.ok(routes.get('l2').mid.y > bottom && routes.get('l3').mid.y > bottom); // labels on lanes under the cards
  assert.notEqual(routes.get('l2').mid.y, routes.get('l3').mid.y);
  assert.ok(routes.get('l1').mid.x > 220 && routes.get('l1').mid.x < 348); // neighbour label in the gap
});
