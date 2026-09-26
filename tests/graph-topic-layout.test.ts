import assert from 'node:assert/strict';
import test from 'node:test';
import { placeGraphTopics } from '../src/lib/graph-topic-layout';

test('topic labels avoid star centers and each other in a dense graph', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    x: 150 + (i % 10) * 66,
    y: 105 + Math.floor(i / 10) * 52,
  }));
  const topics = [
    { tag: 'デザイン', x: 300, y: 240, count: 15 },
    { tag: 'アイデア', x: 505, y: 340, count: 12 },
    { tag: '開発', x: 705, y: 440, count: 9 },
  ];
  const scale = 0.8;
  const labels = placeGraphTopics(topics, nodes, scale, { width: 1000, height: 700 });
  assert.ok(labels.length >= 2, 'dense graph should retain useful topic navigation');
  for (const label of labels) {
    assert.deepEqual({ x: label.x, y: label.y }, { x: topics.find(topic => topic.tag === label.tag)!.x, y: topics.find(topic => topic.tag === label.tag)!.y });
    assert.ok(label.labelX - label.width / (2 * scale) >= 0);
    assert.ok(label.labelX + label.width / (2 * scale) <= 1000);
    assert.ok(label.labelY - label.height / (2 * scale) >= 0);
    assert.ok(label.labelY + label.height / (2 * scale) <= 700);
    for (const node of nodes) {
      assert.ok(Math.abs(node.x - label.labelX) >= (label.width / 2 + 8) / scale
        || Math.abs(node.y - label.labelY) >= (label.height / 2 + 8) / scale,
      `${label.tag} covers a star center`);
    }
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    assert.ok(Math.abs(a.labelX - b.labelX) >= (a.width + b.width + 16) / (2 * scale)
      || Math.abs(a.labelY - b.labelY) >= (a.height + b.height + 16) / (2 * scale), 'topic pills overlap');
  }
  assert.deepEqual(labels, placeGraphTopics(topics, nodes, scale, { width: 1000, height: 700 }));
});

test('an entirely occupied viewport omits a label instead of covering stars', () => {
  const nodes = Array.from({ length: 31 * 21 }, (_, i) => ({ x: (i % 31) * 10, y: Math.floor(i / 31) * 10 }));
  assert.deepEqual(placeGraphTopics([{ tag: '密集', x: 150, y: 100, count: 10 }], nodes, 1, { width: 300, height: 200 }), []);
});

test('label dimensions respond to text length and invalid scale yields no labels', () => {
  const topics = [{ tag: '長い日本語のタグです', x: 250, y: 250, count: 4 }];
  const label = placeGraphTopics(topics, [], 1, { width: 500, height: 500 })[0];
  assert.ok(label.width >= 110 && label.width <= 170);
  assert.equal(label.height, 32);
  assert.deepEqual(placeGraphTopics(topics, [], 0), []);
});

test('reserved interface bands keep labels clear while preserving zoom centroids', () => {
  const topic = { tag: '星の集まり', x: 160, y: 150, count: 12 };
  const reserved = [
    { x: 0, y: 0, width: 320, height: 64 },
    { x: 0, y: 256, width: 320, height: 64 },
  ];
  const [label] = placeGraphTopics([topic], [], 1, { width: 320, height: 320 }, reserved);
  assert.ok(label);
  assert.equal(label.x, topic.x);
  assert.equal(label.y, topic.y);
  assert.ok(label.labelY - label.height / 2 >= 68);
  assert.ok(label.labelY + label.height / 2 <= 252);

  const blocked = placeGraphTopics([topic], [], 1, { width: 320, height: 320 }, [
    { x: 0, y: 0, width: 320, height: 320 },
  ]);
  assert.deepEqual(blocked, []);
});
