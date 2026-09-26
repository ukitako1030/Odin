import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConstellations } from '../src/lib/graph-constellations';
import { buildKnowledgeGraph } from '../src/lib/knowledge-graph';
import type { Entry } from '../src/lib/types';

function entry(id: string, changes: Partial<Entry> = {}): Entry {
  return {
    id, title: id, kind: 'knowledge', body: '', tags: [], status: 'active',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1, ...changes,
  };
}

test('three real tag themes become separated constellations with sparse real paths', () => {
  const entries = ['想起', '探究', '創作'].flatMap((theme, group) => Array.from({ length: 12 }, (_, index) =>
    entry(`${group}-${String(index).padStart(2, '0')}`, {
      tags: ['共通', theme],
      relatedIds: index ? [`${group}-${String(index - 1).padStart(2, '0')}`] : [],
    })));
  const graph = buildKnowledgeGraph(entries);
  const first = buildConstellations(graph.nodes, graph.edges, { width: 1000, height: 700, groupTags: true });
  const reversed = buildConstellations([...graph.nodes].reverse(), [...graph.edges].reverse(), { width: 1000, height: 700, groupTags: true });
  assert.deepEqual(first, reversed);
  assert.deepEqual(first.groups.map(group => group.label).sort(), ['創作', '想起', '探究'].sort());
  assert.equal(first.positions.size, 36);
  assert.deepEqual(first.groups.flatMap(group => group.nodeIds).sort(), graph.nodes.map(node => node.entry.id).sort());
  for (const group of first.groups) assert.equal(group.nodeIds.length, 12);
  for (const point of first.positions.values()) {
    assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= 1000);
    assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= 700);
  }
  const centers = first.groups.map(group => group.x).sort((a, b) => a - b);
  assert.ok(centers[1] - centers[0] > 200 && centers[2] - centers[1] > 200);
  const mobile = buildConstellations(graph.nodes, graph.edges, { width: 600, height: 700, groupTags: true });
  const byRow = [...mobile.groups].sort((a, b) => a.y - b.y);
  assert.ok(Math.abs(byRow[0].y - byRow[1].y) < 40, 'first two groups share a row');
  assert.ok(byRow[1].y + 100 < byRow[2].y, 'third group has its own row');
  assert.ok(Math.abs(byRow[0].x - byRow[1].x) > 150, 'mobile groups use two columns');
  assert.ok(Math.abs(byRow[2].x - 300) < 15, 'incomplete final row is centered');
  for (const group of mobile.groups) {
    assert.ok(group.x - group.rx > 0 && group.x + group.rx < 600);
    assert.ok(group.y - group.ry > 0 && group.y + group.ry < 700);
  }
  const realEdges = new Set(graph.edges.map(edge => `${edge.source}:${edge.target}`));
  assert.ok(first.backbone.length > 0 && first.backbone.length < graph.edges.length / 2);
  for (const edge of first.backbone) assert.ok(realEdges.has(`${edge.source}:${edge.target}`));
});

test('project membership wins over tags and unassigned stars keep an honest label', () => {
  const graph = buildKnowledgeGraph([
    entry('project', { title: '北の航路', kind: 'project' }),
    entry('a', { projectId: 'project', tags: ['旅'] }),
    entry('b', { projectId: 'project', tags: ['旅'] }),
    entry('c', { tags: ['旅'] }),
    entry('d', { tags: ['旅'] }),
    entry('loose'),
  ]);
  const layout = buildConstellations(graph.nodes, graph.edges, { width: 600, height: 700, groupTags: true });
  const project = layout.groups.find(group => group.id === 'project:project');
  assert.deepEqual(project?.nodeIds, ['a', 'b', 'project']);
  assert.deepEqual(layout.groups.find(group => group.id === 'tag:旅')?.nodeIds, ['c', 'd']);
  assert.deepEqual(layout.groups.find(group => group.id === 'other')?.nodeIds, ['loose']);
  assert.equal(layout.positions.size, 6);
  for (const point of layout.positions.values()) assert.ok(point.x >= 0 && point.x <= 600 && point.y >= 0 && point.y <= 700);
  const noTags = buildConstellations(graph.nodes, graph.edges, { width: 600, height: 700, groupTags: false });
  assert.ok(noTags.groups.every(group => !group.id.startsWith('tag:')));
  assert.equal(noTags.positions.size, 6);
});

test('no relationships means no invented backbone', () => {
  const graph = buildKnowledgeGraph([entry('a'), entry('b'), entry('c')]);
  const layout = buildConstellations(graph.nodes, graph.edges, { width: 600, height: 700, groupTags: true });
  assert.deepEqual(layout.backbone, []);
  assert.deepEqual(layout.groups.map(group => group.label), ['その他の記憶']);
});

test('overlapping higher-ranked tags do not consume slots needed by distinct themes', () => {
  const overlap = Array.from({ length: 6 }, (_, index) => `a${index}`);
  const graph = buildKnowledgeGraph([
    entry('a', { tags: overlap }), entry('b', { tags: overlap }),
    entry('c', { tags: ['zeta'] }), entry('d', { tags: ['zeta'] }), entry('e'),
  ]);
  const layout = buildConstellations(graph.nodes, graph.edges, { width: 600, height: 700, groupTags: true });
  assert.deepEqual(layout.groups.map(group => group.id), ['tag:a0', 'tag:zeta', 'other']);
  assert.deepEqual(layout.groups.find(group => group.id === 'tag:zeta')?.nodeIds, ['c', 'd']);
  assert.equal(layout.positions.size, 5);
});
