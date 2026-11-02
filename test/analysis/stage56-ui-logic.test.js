import { test } from 'node:test';
import assert from 'node:assert/strict';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel } from '../../static/team-map/src/analysis/adapter.js';
import { peopleOnWork, workedNear } from '../../static/team-map/src/analysis/search.js';
import { graphData } from '../../static/team-map/src/graph/graphData.js';

const S = buildModel(small);
const L = buildModel(large);
const id = (m, n) => m.people.find((p) => p.name === n).accountId;
const out = (m, ...ns) => new Set(ns.map((n) => id(m, n)));

test('knowledge lines: others who have worked on the selected person\'s open work', () => {
  assert.deepEqual(peopleOnWork(L, id(L, 'Mia')).map((k) => k.line), ['Noah: sub-task DES-3 via DES-4 (now, 7 days ago)']);
  assert.deepEqual(peopleOnWork(L, id(L, 'Ken')).map((k) => k.line), ['Lea: past assignee WEB-4 (before, 27 days ago)']);
  assert.deepEqual(peopleOnWork(L, id(L, 'Sam')).map((k) => k.name), ['Vic']);
  assert.deepEqual(peopleOnWork(S, id(S, 'Ana')).map((k) => k.line), ['Ben: sub-task PLAT-1 via PLAT-2 (now, 9 days ago) · past assignee PLAT-1 (before, 58 days ago)']);
  assert.deepEqual(peopleOnWork(L, id(L, 'Paula')), []); // reporter-only: no work
  assert.equal(peopleOnWork(L, id(L, 'Mia'), { absent: out(L, 'Noah') })[0].out, true); // marked, not hidden
});

test('worked near: per open task, excluding the person, max 3', () => {
  assert.deepEqual(workedNear(L, id(L, 'Mia')).map((w) => `${w.issueKey}:${w.people.map((p) => p.name).join('/')}`), ['DES-2:Yui/Ken/Lea', 'DES-3:Noah/Wen']);
  for (const p of L.people) for (const w of workedNear(L, p.accountId)) {
    assert.ok(w.people.length <= 3);
    assert.ok(!w.people.some((x) => x.personId === p.accountId));
  }
});

test('absence: positions stay put, sizes and scores are live', () => {
  const base = graphData(L).layout;
  const sam = graphData(L, { absent: out(L, 'Sam') }).layout;
  for (const n of base.nodes) {
    const m = sam.nodes.find((x) => x.id === n.id);
    assert.equal(m.x, n.x);
    assert.equal(m.y, n.y);
  }
  const r = (lay, n) => lay.nodes.find((x) => x.id === id(L, n)).r;
  assert.ok(r(sam, 'Tara') < r(base, 'Tara')); // 20 -> 16
  assert.ok(r(sam, 'Paula') > r(base, 'Paula')); // 2 -> 4
});

test('absence: rings (red = left waiting, green = has worked on stalled work, both allowed)', () => {
  const d = graphData(L, { absent: out(L, 'Sam') });
  const rings = Object.fromEntries([...d.rings].map(([k, v]) => [L.nameOf(k), v.join('+')]));
  assert.deepEqual(rings, { Lea: 'waiting', Vic: 'waiting+context', Xan: 'waiting', Omar: 'waiting' });
  const m = graphData(L, { absent: out(L, 'Mia') });
  assert.deepEqual(Object.fromEntries([...m.rings].map(([k, v]) => [L.nameOf(k), v.join('+')])), { Ken: 'waiting', Wen: 'waiting', Yui: 'waiting', Noah: 'context' });
  assert.ok(graphData(L).rings.size === 0);
});

test('absence: screen-reader sentences say which work stalls', () => {
  const d = graphData(L, { absent: out(L, 'Mia') });
  const stalled = d.sentences.filter((s) => s.text.includes('Mia is marked out, so this work stalls.'));
  assert.equal(stalled.length, 4); // Ken x2, Wen, Yui
});

test('absence: badges re-colour when the only other person is out', () => {
  assert.equal(graphData(L).badges.get('u-wen>u-mia').color, 'green');
  assert.equal(graphData(L, { absent: out(L, 'Noah') }).badges.get('u-wen>u-mia').color, 'amber');
});

test('absence: layout stays collision-free at every zoom', () => {
  for (const zoom of ['ticket', 'theme', 'team'])
    for (const absent of [out(L, 'Sam'), out(L, 'Mia'), out(L, 'Sam', 'Mia', 'Ivy')]) {
      const { layout } = graphData(L, { zoom, absent });
      for (const e of layout.edges) {
        assert.equal(e.label.collisions, 0, `${zoom} ${e.id}`);
        assert.equal(e.nodeHits, 0, `${zoom} ${e.id}`);
      }
      for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r + 10);
    }
});

test('selection: knowledge only for the selected person', () => {
  assert.deepEqual(graphData(L, { selectedId: id(L, 'Mia') }).knowledge.map((k) => k.name), ['Noah']);
  assert.deepEqual(graphData(L).knowledge, []);
});
