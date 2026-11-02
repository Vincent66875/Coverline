import { test } from 'node:test';
import assert from 'node:assert/strict';
import small from '../fixtures/small.js';
import large from '../fixtures/large.js';
import { buildModel } from '../../static/team-map/src/analysis/adapter.js';
import { graphData } from '../../static/team-map/src/graph/graphData.js';
import { orderTeams, neighbour, rectCircleOverlap, rectsOverlap, nodeRadius } from '../../static/team-map/src/graph/layout.js';
import { readFileSync, readdirSync } from 'node:fs';

const S = buildModel(small);
const L = buildModel(large);

for (const [name, m] of [['small', S], ['large', L]])
  for (const zoom of ['ticket', 'theme', 'team']) {
    test(`${name} @${zoom}: geometry is clean`, () => {
      const { layout } = graphData(m, { zoom });
      assert.equal(layout.nodes.length, m.people.length);
      assert.equal(layout.edges.length, m.personEdges.length);
      for (const e of layout.edges) {
        assert.equal(e.nodeHits, 0, `${e.id} curve passes through another node or its text`);
        assert.equal(e.label.collisions, 0, `${e.id} label/badge collision`);
        assert.ok(e.label.lines.length <= 2);
        const box = { x: e.label.x, y: e.label.y, w: e.label.w, h: e.label.h };
        for (const n of layout.nodes) {
          if (box.w) assert.ok(!rectCircleOverlap(box, n), `${e.id} label on ${n.name}`);
          if (box.w) assert.ok(!rectsOverlap(box, n.textBox), `${e.id} label on ${n.name} text`);
          assert.ok(Math.hypot(e.badge.x - n.x, e.badge.y - n.y) > n.r + e.badge.r, `${e.id} badge on ${n.name}`);
        }
      }
      for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r);
    });
  }

test('node size = coverage risk', () => {
  const { layout, risk } = graphData(L);
  for (const n of layout.nodes) assert.equal(n.r, nodeRadius(risk.get(n.id).score));
  const r = (nm) => layout.nodes.find((n) => n.name === nm).r;
  assert.ok(r('Sam') > r('Mia') && r('Mia') > r('Ivy') && r('Ivy') > r('Ken'));
});

test('team columns ordered to keep cross-team arrows short; isolated team last', () => {
  const { layout } = graphData(L);
  assert.deepEqual(layout.order, ['Backend', 'Frontend', 'Design', 'Mobile', 'Product']);
  const w = new Map([['Design|Frontend', 3], ['Design|Mobile', 2], ['Backend|Frontend', 1], ['Backend|Mobile', 1]]);
  const { cost } = orderTeams(['Backend', 'Design', 'Frontend', 'Mobile'], w);
  assert.equal(cost, 9); // brute-force optimum
  // Design sits next to both teams that wait on it
  const i = (t) => layout.order.indexOf(t);
  assert.equal(Math.abs(i('Design') - i('Frontend')), 1);
  assert.equal(Math.abs(i('Design') - i('Mobile')), 1);
  assert.equal(graphData(S).layout.order.at(-1), 'Product');
});

test('team zoom: each team sentence written once', () => {
  const { layout } = graphData(L, { zoom: 'team' });
  const texts = layout.edges.map((e) => e.label.lines.join(' ')).filter(Boolean);
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(texts.includes('Mobile waits on Design, through Mia only'));
  assert.equal(layout.edges.filter((e) => e.badge).length, 10); // every arrow keeps its badge
});

test('keyboard neighbours', () => {
  const { layout } = graphData(L);
  const id = (n) => L.people.find((p) => p.name === n).accountId;
  const col = (n) => layout.nodes.find((x) => x.id === id(n)).col;
  const down = neighbour(layout, id('Sam'), 'down');
  assert.equal(col(L.nameOf(down)), col('Sam'));
  assert.notEqual(down, id('Sam'));
  assert.equal(col(L.nameOf(neighbour(layout, id('Sam'), 'right'))), col('Sam') + 1);
  assert.equal(neighbour(layout, id('Sam'), 'left'), id('Sam')); // first column: stays
});

test('screen-reader list covers every ticket pair with cover info', () => {
  const { sentences } = graphData(L);
  assert.equal(sentences.length, L.personEdges.reduce((s, e) => s + e.pairs.length, 0));
  assert.ok(sentences.every((s) => / Cover: /.test(s.text)));
});

test('no chart or component library; graph module has no React', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../static/team-map/package.json', import.meta.url)));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@forge/bridge', 'react', 'react-dom']); // no chart or component library
  for (const f of readdirSync(new URL('../../static/team-map/src/graph/', import.meta.url)))
    assert.doesNotMatch(readFileSync(new URL(`../../static/team-map/src/graph/${f}`, import.meta.url), 'utf8'), /from ['"]react/);
});

test('CSS is scoped under .jtm', () => {
  const css = readFileSync(new URL('../../static/team-map/src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.replace(/@keyframes[^{]+\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '').replace(/@(media|container)[^{]+\{/g, '').split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(',')) assert.match(part.trim(), /^\.jtm\b/, part);
});
