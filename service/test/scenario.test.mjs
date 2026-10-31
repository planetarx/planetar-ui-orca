import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BoatTracker } from '../tracker.mjs';
import { Estimator } from '../estimator.mjs';
import { distanceM } from '../geo.mjs';
import { loadConfig, loadHarbours, loadVessels } from '../load.mjs';
import { scenarioPositions, scenarioTruth } from '../sim.mjs';

const scenario = JSON.parse(readFileSync(new URL('../scenarios/race-rocks.json', import.meta.url)));
const T0 = 1_800_000_000_000_000_000n;
const MIN = 60_000_000_000n;

test('race rocks scenario yields one whale estimate near the truth', () => {
  const config = loadConfig();
  const tracker = new BoatTracker(config, loadHarbours(), loadVessels());
  const est = new Estimator(config);
  const positions = scenarioPositions(scenario, T0);
  const truth = scenarioTruth(scenario, T0).whale;
  assert.ok(positions.every((p) => p.pos.simulated === true && p.pos.serverId === 'orca'));

  const ids = new Set();
  const seenBoats = new Set();
  let at45 = null;
  let endedAt = null;
  let i = 0;
  for (let m = 1; m <= scenario.durationMin + 30; m++) {
    const now = T0 + BigInt(m) * MIN;
    while (i < positions.length && positions[i].atNs <= now) tracker.update(positions[i++].pos);
    const { upserts, ended } = est.step(tracker.watching(now), now);
    for (const e of upserts) {
      ids.add(e.id);
      e.boats.forEach((b) => seenBoats.add(b));
      if (m === 45) at45 = e;
    }
    if (ended.length) endedAt ??= m;
  }

  assert.equal(ids.size, 1, `estimate ids: ${[...ids]}`);
  assert.ok(at45, 'an estimate exists at minute 45');
  const whale45 = truth.find((w) => w.atNs === T0 + 45n * MIN);
  const off = distanceM(at45, whale45);
  assert.ok(off <= 1000, `centre ${Math.round(off)} m from the whales`);
  assert.ok(off <= at45.radiusM, 'the whales are inside the estimate');
  assert.ok(at45.confidence > 0.8, `confidence ${at45.confidence}`);
  assert.ok(endedAt >= 70 && endedAt <= 90, `ended at minute ${endedAt}`);
  assert.ok(!seenBoats.has(999000005) && !seenBoats.has(999000006));
  assert.equal(at45.simulated, true);
});

test('scenario positions are deterministic', () => {
  const a = scenarioPositions(scenario, T0);
  const b = scenarioPositions(scenario, T0);
  assert.deepEqual(a.slice(0, 50), b.slice(0, 50));
});
