import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

/** A fast run out to RACE_ROCKS ending at minute 0, then a 6-min loiter: watching from minute 5. */
function watchingAtRaceRocks(tr) {
  feed(tr, LISTED, run(RACE_ROCKS, 20, -10, 10));
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 6));
}

test('gap under staleMin keeps watching', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 2, tMin: 16 }]); // 10 min silent
  const [w] = tr.watching(at(16));
  assert.equal(w?.sinceNs, at(0));
});

test('gap over staleMin drops the boat', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  assert.equal(tr.watching(at(6)).length, 1);
  assert.equal(tr.watching(at(6 + 16)).length, 0);
});

test('speeding away after watching emits left', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  const ev = feed(tr, LISTED, [
    { lat: 48.295, lon: -123.52, sog: 18, tMin: 6.5 },
    { lat: 48.300, lon: -123.51, sog: 18, tMin: 7 },
  ]);
  assert.deepEqual(ev.map((e) => e.kind).filter((k) => k === 'left'), ['left']);
  assert.equal(tr.watching(at(7)).length, 0);
});

test('a watching boat drifting with slow whales stays watching', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  // 40 min drifting east at ~3 kn: ~3.7 km, well past loiterRadiusM.
  const drift = Array.from({ length: 80 }, (_, i) => ({ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.00062 * i, sog: 3, tMin: 6.5 + i / 2 }));
  feed(tr, LISTED, drift);
  const [w] = tr.watching(at(46));
  assert.equal(w?.sinceNs, at(0));
});

test('a boat at a berth outside the harbour polygons never watches without a fast run out', () => {
  const tr = tracker();
  const SNUG = { lat: 48.5717, lon: -123.163 };
  const ev = feed(tr, LISTED, hold(SNUG, 0.1, 0, 8 * 60));
  assert.deepEqual(tr.watching(at(8 * 60)), []);
  assert.ok(ev.some((e) => e.kind === 'ignored' && /no fast run out/.test(e.reason)));
});

test('a boat that runs in and ties up at an unlisted berth stops counting after maxWatchMin', () => {
  const tr = tracker();
  const SNUG = { lat: 48.5717, lon: -123.163 };
  feed(tr, LISTED, run(SNUG, 20, -10, 10));
  feed(tr, LISTED, hold(SNUG, 0.1, 0, 149));
  assert.equal(tr.watching(at(149)).length, 1);
  const ev = feed(tr, LISTED, hold(SNUG, 0.1, 150, 60));
  assert.deepEqual(tr.watching(at(210)), []);
  assert.ok(ev.some((e) => e.kind === 'ignored' && /probably moored/.test(e.reason)));
});

test('sog 102.3 (not available) keeps the phase and emits nothing', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  const ev = feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 102.3, tMin: 7 }]);
  assert.deepEqual(ev, []);
  const [w] = tr.watching(at(7));
  assert.equal(w?.sinceNs, at(0));
});

test('a watching boat moving between slowKn and transitKn stays watching (no flapping)', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  const ev = feed(tr, LISTED, [4.2, 3.8, 4.4, 3.9, 6].map((sog, i) => ({ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.001 * i, sog, tMin: 6.5 + i / 2 })));
  assert.deepEqual(ev.filter((e) => e.kind === 'left' || e.kind === 'transit'), []);
  assert.equal(tr.watching(at(9)).length, 1);
  const out = feed(tr, LISTED, [{ lat: 48.30, lon: -123.50, sog: 13, tMin: 9.5 }]);
  assert.deepEqual(out.map((e) => e.kind), ['left']);
});

test('a boat cruising slowly without a fast run out never watches', () => {
  const tr = tracker();
  const cruise = Array.from({ length: 30 }, (_, i) => ({ lat: 48.3, lon: -123.6 + 0.00073 * i, sog: 3.5, tMin: i / 2 }));
  feed(tr, LISTED, cruise);
  assert.deepEqual(tr.watching(at(15)), []);
});

// --- Real AIS, 2026-10-31 (planetar:ais-orca): ISLAND_EXPLORER 5 (Island Adventures) east of
// Lopez. After a 21–24 kn run it stops and goes for 40 min (0–4 kn, bursts of 5–7 kn), then
// runs at 16 kn. The old rule restarted the loiter clock at every burst ≥ slowKn, so the boat
// never counted as watching during that encounter.
const ISLAND_EXPLORER = 369264000;
const realTrack = () => readFileSync(new URL('./fixtures/island-explorer-5-2026-10-31.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const utc = (hhmm) => BigInt(Date.parse(`2026-10-31T${hhmm}:00Z`)) * 1_000_000n;

test('real track: a boat stopping and going around whales counts as watching', () => {
  const tr = new BoatTracker(config, loadHarbours(),
    new Map([[ISLAND_EXPLORER, { mmsi: ISLAND_EXPLORER, operator: 'Island Adventures' }]]));
  const watchStarts = [];
  for (const p of realTrack()) {
    for (const e of tr.update(p)) if (e.kind === 'watching') watchStarts.push(BigInt(e.atNs));
    const t = BigInt(p.lastSeenNs);
    if (t >= utc('21:50') && t < utc('22:15')) assert.equal(tr.watching(t).length, 1, `not watching at ${t}`);
  }
  assert.ok(watchStarts[0] >= utc('21:38') && watchStarts[0] <= utc('21:48'), `first watch at ${watchStarts[0]}`);
  assert.equal(watchStarts.length, 2); // the 3-min stop at 22:30 is too short; 23:13–23:42 counts
});

test('a short burst between slowKn and transitKn before watching keeps the slow clock', () => {
  const tr = tracker();
  feed(tr, LISTED, run(RACE_ROCKS, 20, -10, 10));
  feed(tr, LISTED, hold(RACE_ROCKS, 2, 0, 3));
  feed(tr, LISTED, [{ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.004, sog: 6, tMin: 3.5 }]);
  feed(tr, LISTED, hold({ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.005 }, 2, 4, 3));
  assert.equal(tr.watching(at(7)).length, 1);
});

test('cruising at 6–8 kn after a fast run, with only a brief slow-down, never watches', () => {
  const tr = tracker();
  feed(tr, LISTED, run(RACE_ROCKS, 20, -10, 10));
  const cruise = Array.from({ length: 120 }, (_, i) => ({ lat: RACE_ROCKS.lat, lon: RACE_ROCKS.lon + 0.0012 * i,
    sog: i % 40 < 4 ? 3 : 7, tMin: i / 2 })); // 2 slow minutes in every 20
  feed(tr, LISTED, cruise);
  assert.deepEqual(tr.watching(at(60)), []);
});

test('a watching boat silent for 20 min (AIS gap) resumes watching with its original start', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  assert.equal(tr.watching(at(26)).length, 0); // stale while silent
  const ev = feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 2, tMin: 26 }]);
  assert.deepEqual(ev.filter((e) => e.kind === 'watching'), []);
  const [w] = tr.watching(at(26));
  assert.equal(w?.sinceNs, at(0));
});

test('a boat silent longer than resumeWithinMin starts over', () => {
  const tr = tracker();
  watchingAtRaceRocks(tr);
  feed(tr, LISTED, [{ ...RACE_ROCKS, sog: 2, tMin: 6 + config.resumeWithinMin + 1 }]);
  assert.deepEqual(tr.watching(at(6 + config.resumeWithinMin + 1)), []);
});
