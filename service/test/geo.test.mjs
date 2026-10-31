import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { distanceM, pointInPolygon, centroid } from '../geo.mjs';

const harbours = JSON.parse(readFileSync(new URL('../data/harbours.json', import.meta.url))).harbours;
const inner = harbours.find((h) => h.name === 'Inner Harbour').polygon;
const RACE_ROCKS = { lat: 48.2980, lon: -123.5310 };

test('distanceM Race Rocks to the Inner Harbour is about 18.2 km', () => {
  const d = distanceM(RACE_ROCKS, { lat: 48.4220, lon: -123.3700 });
  assert.ok(Math.abs(d - 18_200) <= 300, `got ${d}`);
});

test('pointInPolygon: Fisherman\'s Wharf is in the Inner Harbour, Race Rocks is not', () => {
  assert.equal(pointInPolygon({ lat: 48.4225, lon: -123.3830 }, inner), true);
  assert.equal(pointInPolygon(RACE_ROCKS, inner), false);
});

test('centroid of two points is their midpoint', () => {
  const c = centroid([{ lat: 48.0, lon: -123.0 }, { lat: 48.2, lon: -123.4 }]);
  assert.ok(Math.abs(c.lat - 48.1) < 1e-9 && Math.abs(c.lon + 123.2) < 1e-9);
});
