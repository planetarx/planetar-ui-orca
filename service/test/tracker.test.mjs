import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BoatTracker } from '../tracker.mjs';
import { loadConfig, loadHarbours, loadVessels } from '../load.mjs';

const config = loadConfig();
const T0 = 1_800_000_000_000_000_000n; // ns
const MIN = 60_000_000_000n;
const RACE_ROCKS = { lat: 48.2900, lon: -123.5300 };
const WHARF = { lat: 48.4225, lon: -123.3830 };
const LISTED = 999000001;

const tracker = () => new BoatTracker(config, loadHarbours(), loadVessels());

/** points: [{lat, lon, sog, tMin}] → every event the tracker emitted. */
function feed(tr, mmsi, points) {
  const events = [];
  for (const p of points) {
    events.push(...tr.update({
      mmsi, name: `BOAT ${mmsi}`, lat: p.lat, lon: p.lon, sog: p.sog,
      lastSeenNs: String(T0 + BigInt(Math.round(p.tMin * 60)) * 1_000_000_000n), simulated: true,
    }));
  }
  return events;
}
const at = (tMin) => T0 + BigInt(Math.round(tMin * 60)) * 1_000_000_000n;
/** n fixes every 30 s from tStart, all at one spot. */
const hold = (pos, sog, tStart, minutes) =>
  Array.from({ length: minutes * 2 + 1 }, (_, i) => ({ ...pos, sog, tMin: tStart + i / 2 }));
/** A transit: n fixes every 30 s moving east ~ 300 m per fix. */
const run = (from, sog, tStart, minutes) =>
  Array.from({ length: minutes * 2 }, (_, i) => ({ lat: from.lat, lon: from.lon - 0.004 * (minutes * 2 - i), sog, tMin: tStart + i / 2 }));

test('in harbour all day is never watching', () => {
  const tr = tracker();
  const ev = feed(tr, LISTED, hold(WHARF, 0.5, 0, 8 * 60));
  assert.deepEqual(tr.watching(at(8 * 60)), []);
  assert.ok(ev.length > 0 && ev.every((e) => e.kind === 'ignored' && e.reason.startsWith('in harbour:')));
});

test('transit then slow loiter becomes watching after loiterMin', () => {
  const tr = tracker();
  feed(tr, LISTED, run(RACE_ROCKS, 20, 0, 20));
  const before = feed(tr, LISTED, hold(RACE_ROCKS, 2, 20, 4.5).slice(0, 9)); // t = 20 .. 24
  assert.equal(tr.watching(at(24)).length, 0);
  assert.ok(!before.some((e) => e.kind === 'watching'));
  const after = feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 2, tMin: 25 }]);
  assert.deepEqual(after.map((e) => e.kind), ['watching']);
  const [w] = tr.watching(at(25));
  assert.equal(w.mmsi, LISTED);
  assert.equal(w.sinceNs, at(20));
});

test('unlisted vessel produces no events', () => {
  const tr = tracker();
  assert.deepEqual(feed(tr, 123456789, hold(RACE_ROCKS, 1, 0, 20)), []);
  assert.deepEqual(tr.watching(at(20)), []);
});

test('gap under staleMin keeps watching', () => {
  const tr = tracker();
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 6));
  feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 2, tMin: 16 }]); // 10 min silent
  const [w] = tr.watching(at(16));
  assert.equal(w?.sinceNs, at(0));
});

test('gap over staleMin drops the boat', () => {
  const tr = tracker();
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 6));
  assert.equal(tr.watching(at(6)).length, 1);
  assert.equal(tr.watching(at(6 + 16)).length, 0);
});

test('speeding away after watching emits left', () => {
  const tr = tracker();
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 6));
  const ev = feed(tr, LISTED, [
    { lat: 48.295, lon: -123.52, sog: 18, tMin: 6.5 },
    { lat: 48.300, lon: -123.51, sog: 18, tMin: 7 },
  ]);
  assert.deepEqual(ev.map((e) => e.kind).filter((k) => k === 'left'), ['left']);
  assert.equal(tr.watching(at(7)).length, 0);
});

test('a watching boat drifting with slow whales stays watching', () => {
  const tr = tracker();
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 6));
  // 40 min drifting east at ~3 kn: ~3.7 km, well past loiterRadiusM.
  const drift = Array.from({ length: 80 }, (_, i) => ({ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.00062 * i, sog: 3, tMin: 6.5 + i / 2 }));
  feed(tr, LISTED, drift);
  const [w] = tr.watching(at(46));
  assert.equal(w?.sinceNs, at(0));
});
