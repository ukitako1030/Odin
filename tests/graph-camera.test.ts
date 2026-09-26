import assert from 'node:assert/strict';
import test from 'node:test';
import { zoomGraphCamera } from '../src/components/useGraphCamera';

test('zoom keeps the world point beneath an arbitrary anchor fixed', () => {
  const camera = { x: -180, y: 75, zoom: 1.4 };
  const anchor = { x: 245, y: 410 };
  const world = { x: (anchor.x - camera.x) / camera.zoom, y: (anchor.y - camera.y) / camera.zoom };
  const next = zoomGraphCamera(camera, 1.7, anchor);
  assert.equal(next.zoom, 2.38);
  assert.ok(Math.abs(next.x + world.x * next.zoom - anchor.x) < 1e-9);
  assert.ok(Math.abs(next.y + world.y * next.zoom - anchor.y) < 1e-9);
});

test('zoom clamps at both ends without moving the point under the anchor', () => {
  const anchor = { x: 310, y: 120 };
  const high = zoomGraphCamera({ x: 20, y: -15, zoom: 2 }, 100, anchor);
  const low = zoomGraphCamera(high, 0.001, anchor);
  assert.equal(high.zoom, 6);
  assert.equal(low.zoom, 0.65);
  assert.ok(Math.abs((anchor.x - high.x) / high.zoom - (anchor.x - low.x) / low.zoom) < 1e-9);
  assert.ok(Math.abs((anchor.y - high.y) / high.zoom - (anchor.y - low.y) / low.zoom) < 1e-9);
  assert.equal(zoomGraphCamera(low, Number.NaN, anchor), low);
});
