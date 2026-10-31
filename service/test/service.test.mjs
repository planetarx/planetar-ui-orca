import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createInferenceService } from '../core.mjs';
import { startHttp } from '../http.mjs';
import { loadConfig, loadHarbours, loadVessels } from '../load.mjs';
import { scenarioPositions } from '../sim.mjs';

const scenario = JSON.parse(readFileSync(new URL('../scenarios/race-rocks.json', import.meta.url)));
const T0 = 1_800_000_000_000_000_000n;
const MIN = 60_000_000_000n;

/** A core with a recording publisher and a clock the test moves. */
function harness() {
  const sent = [];
  let clock = T0;
  const core = createInferenceService({
    config: loadConfig(), harbours: loadHarbours(), vessels: loadVessels(),
    publish: (topic, schemaName, payload) => sent.push({ topic, schemaName, payload }),
    now: () => clock,
  });
  return { core, sent, setNow: (ns) => { clock = ns; } };
}

/** Feed the whole scenario minute by minute, ticking as the service does. */
function replay(h, untilMin) {
  const positions = scenarioPositions(scenario, T0);
  let i = 0;
  for (let m = 1; m <= untilMin; m++) {
    const now = T0 + BigInt(m) * MIN;
    h.setNow(now);
    while (i < positions.length && positions[i].atNs <= now) h.core.onPosition(positions[i++].pos);
    h.core.tick();
  }
}

test('publishes evidence for a harbour idler with counted false', () => {
  const h = harness();
  h.core.onPosition({ mmsi: 999000005, name: 'SIM HARBOUR IDLER', lat: 48.4225, lon: -123.383, sog: 0.2,
    lastSeenNs: String(T0), simulated: true, serverId: 'orca' });
  const ev = h.sent.filter((s) => s.topic === 'orca.evidence').map((s) => s.payload);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].counted, false);
  assert.equal(ev[0].reason, 'in harbour: Inner Harbour');
  assert.equal(ev[0].source, 'boats');
  assert.equal(ev[0].simulated, true);
  assert.equal(h.sent[0].schemaName, 'orca.Evidence.v1');
});

test('harbour idling is reported at most once per boat per 30 min', () => {
  const h = harness();
  for (let s = 0; s <= 40 * 60; s += 30) {
    h.core.onPosition({ mmsi: 999000005, name: 'IDLER', lat: 48.4225, lon: -123.383, sog: 0.2,
      lastSeenNs: String(T0 + BigInt(s) * 1_000_000_000n), simulated: true, serverId: 'orca' });
  }
  assert.equal(h.sent.filter((s) => s.topic === 'orca.evidence').length, 2);
});

test('replaying race-rocks publishes upserts then one ended on orca.estimate', () => {
  const h = harness();
  replay(h, 120);
  const ev = h.sent.filter((s) => s.topic === 'orca.estimate').map((s) => s.payload);
  assert.ok(ev.some((e) => e.event === 'upsert'));
  const ended = ev.filter((e) => e.event === 'ended');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].estimate.status, 'ended');
  assert.equal(h.sent.find((s) => s.topic === 'orca.estimate').schemaName, 'orca.Estimate.v1');
  const ids = new Set(ev.map((e) => e.estimate.id));
  assert.equal(ids.size, 1);
});

test('snapshot after minute 45 holds the estimate and its evidence resolves', () => {
  const h = harness();
  replay(h, 45);
  const snap = h.core.snapshot();
  assert.equal(snap.estimates.length, 1);
  const [est] = snap.estimates;
  assert.ok(est.evidenceIds.length > 0);
  const byId = new Set(snap.evidence.map((e) => e.id));
  assert.ok(est.evidenceIds.every((id) => byId.has(id)));
  assert.ok(snap.evidence.every((e) => e.simulated));
});

test('every boat in an estimate has its watching evidence linked, including the first to arrive', () => {
  const h = harness();
  replay(h, 45);
  const snap = h.core.snapshot();
  const [est] = snap.estimates;
  const linked = snap.evidence.filter((e) => est.evidenceIds.includes(e.id));
  for (const mmsi of est.boats) {
    assert.ok(linked.some((e) => e.mmsi === mmsi && e.counted), `boat ${mmsi} has no linked evidence`);
  }
  // The re-linked item is republished so live clients see it counted.
  const first = h.sent.filter((m) => m.topic === 'orca.evidence' && m.payload.mmsi === 999000001 && m.payload.counted);
  assert.ok(first.length >= 1);
});

test('a second replay still forms an estimate after an earlier one ran ahead', () => {
  const sent = [];
  let wall = T0;
  const core = createInferenceService({ config: loadConfig(), harbours: loadHarbours(), vessels: loadVessels(),
    publish: (topic, schemaName, payload) => sent.push({ topic, payload }), now: () => wall });
  // Two replays at 10x, the second starting when the first finishes (9 min of
  // wall time later) — so the first one's stamps run 80 min ahead of the second's.
  for (const startNs of [T0, T0 + 9n * MIN]) {
    for (const { atNs, pos } of scenarioPositions(scenario, startNs)) {
      wall = startNs + (atNs - startNs) / 10n;
      core.onPosition(pos);
    }
  }
  const runs = new Set(sent.filter((m) => m.topic === 'orca.estimate' && m.payload.event === 'upsert')
    .map((m) => m.payload.estimate.id));
  assert.equal(runs.size, 2, 'each replay forms its own estimate');
});

test('a simulated boat never joins a real estimate', () => {
  const vessels = loadVessels();
  vessels.set(111, { mmsi: 111, name: 'REAL ONE', operator: 'Real Co', verified: true, simulated: false });
  vessels.set(112, { mmsi: 112, name: 'REAL TWO', operator: 'Real Co', verified: true, simulated: false });
  const sent = [];
  let clock = T0;
  const core = createInferenceService({ config: loadConfig(), harbours: loadHarbours(), vessels,
    publish: (topic, schemaName, payload) => sent.push({ topic, payload }), now: () => clock });
  const positions = scenarioPositions(scenario, T0);
  let i = 0;
  for (let m = 1; m <= 50; m++) {
    clock = T0 + BigInt(m) * MIN;
    while (i < positions.length && positions[i].atNs <= clock) core.onPosition(positions[i++].pos);
    // Two real boats loiter right beside the simulated encounter from minute 35.
    if (m >= 35) {
      for (const [mmsi, dLon] of [[111, 0], [112, 0.004]]) {
        core.onPosition({ mmsi, name: `R${mmsi}`, lat: 48.29, lon: -123.505 + dLon, sog: 1,
          lastSeenNs: String(clock), simulated: false, serverId: 'orca' });
      }
    }
    core.tick();
  }
  const ests = core.snapshot().estimates;
  assert.equal(ests.length, 2);
  const sim = ests.find((e) => e.simulated);
  const real = ests.find((e) => !e.simulated);
  assert.ok(sim.boats.every((m) => m >= 999000001 && m <= 999000004));
  assert.deepEqual(real.boats.sort(), [111, 112]);
});

test('HTTP /snapshot and /health respond', async () => {
  const h = harness();
  replay(h, 45);
  const server = await startHttp(h.core, 0);
  const { port } = server.address();
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, { ok: true });
    const res = await fetch(`http://127.0.0.1:${port}/snapshot`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const snap = await res.json();
    assert.equal(snap.estimates.length, 1);
    assert.equal(typeof snap.startedNs, 'string');
  } finally {
    server.close();
  }
});
