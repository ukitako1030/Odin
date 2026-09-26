import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKnowledgeGraph } from '../src/lib/knowledge-graph';
import type { Entry } from '../src/lib/types';

function entry(id: string, changes: Partial<Entry> = {}): Entry {
  return {
    id, title: id, kind: 'knowledge', body: '', tags: [], status: 'active',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1, ...changes,
  };
}

test('deduplicates symmetric links, ignores self and missing targets, and merges evidence', () => {
  const graph = buildKnowledgeGraph([
    entry('a', { relatedIds: ['b', 'b', 'a', 'missing'], tags: ['  ＯＤＩＮ ', 'odin'] }),
    entry('b', { relatedIds: ['a'], tags: ['Odin'] }),
  ]);
  assert.equal(graph.total, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.edges[0], {
    source: 'a', target: 'b', reasons: ['関連する記録', '共通タグ: odin'], explicit: true,
  });
  assert.deepEqual(graph.nodes.map(({ degree }) => degree), [1, 1]);
});

test('project links only connect the direct project and exclude deleted or archived entries by default', () => {
  const entries = [
    entry('project', { kind: 'project' }),
    entry('one', { projectId: 'project' }),
    entry('two', { projectId: 'project' }),
    entry('deleted', { projectId: 'project', deletedAt: '2026-02-01' }),
    entry('archived', { projectId: 'project', status: 'archived' }),
  ];
  const graph = buildKnowledgeGraph(entries);
  assert.equal(graph.total, 3);
  assert.deepEqual(graph.edges.map(({ source, target, reasons }) => [source, target, reasons]), [
    ['one', 'project', ['所属プロジェクト']],
    ['project', 'two', ['所属プロジェクト']],
  ]);
  assert.equal(buildKnowledgeGraph(entries, { includeArchived: true }).total, 4);
  assert.equal(buildKnowledgeGraph(entries, { includeArchived: true }).edges.length, 3);
});

test('shared tags can be disabled and do not create inferred semantic links', () => {
  const entries = [entry('a', { tags: ['設計'], body: '知識' }), entry('b', { tags: ['設計'], body: '知識' })];
  assert.equal(buildKnowledgeGraph(entries).edges.length, 1);
  assert.equal(buildKnowledgeGraph(entries, { sharedTags: false }).edges.length, 0);
});

test('cap selects linked records, and focus includes an old record and its immediate neighbors', () => {
  const entries = [entry('old', { relatedIds: ['neighbor'], updatedAt: '2020-01-01' }),
    entry('neighbor', { updatedAt: '2020-01-02' })];
  for (let i = 0; i < 140; i += 1) {
    entries.push(entry(`recent-${i}`, { updatedAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}` }));
  }
  const graph = buildKnowledgeGraph(entries, { focusId: 'old', limit: 2 });
  assert.equal(graph.total, 142);
  assert.equal(graph.truncated, true);
  assert.deepEqual(graph.nodes.map((node) => node.entry.id), ['neighbor', 'old']);
  assert.equal(graph.edges.length, 1);
  assert.equal(buildKnowledgeGraph(entries).nodes.length, 100);
  assert.equal(buildKnowledgeGraph(entries, { limit: 1000 }).nodes.length, 120);
});

test('layout is deterministic, finite and inside the viewBox for connected and isolated nodes', () => {
  const entries = Array.from({ length: 24 }, (_, index) => entry(`id-${index}`, {
    relatedIds: index < 12 ? [`id-${(index + 1) % 12}`] : [],
  }));
  const first = buildKnowledgeGraph(entries);
  const second = buildKnowledgeGraph([...entries].reverse());
  assert.deepEqual(first, second);
  for (const node of first.nodes) {
    assert.ok(Number.isFinite(node.x) && node.x >= 90 && node.x <= 910);
    assert.ok(Number.isFinite(node.y) && node.y >= 75 && node.y <= 625);
  }
});
