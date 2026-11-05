import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classify, createDetectionGate, toEvidence } from '../orcahello.mjs';
import { createInferenceService } from '../core.mjs';
import { loadConfig, loadHarbours, loadVessels } from '../load.mjs';
import { scenarioPositions } from '../sim.mjs';

const scenario = JSON.parse(readFileSync(new URL('../scenarios/race-rocks.json', import.meta.url)));
const T0 = 1_800_000_000_000_000_000n;
const MIN = 60_000_000_000n;
const iso = (ns) => new Date(Number(ns / 1_000_000n)).toISOString().replace('.000Z', 'Z');

/** An OrcaHello /api/detections item, shaped as the live API returned them on 2026-11-02. */
function detection(over = {}) {
  return {
    id: 'oh-1', timestamp: iso(T0), confidence: 77.1, found: 'No', reviewed: false,
    moderated: null, moderator: 'someone@example.com', comments: null, tags: '', tagList: [],
    globalPredictionLabel: 'resident',
    location: { id: 'rpi_andrews_bay', name: 'Andrews Bay', longitude: -123.166408, latitude: 48.546653 },
    audioUri: 'https://livemlaudiospecstorage.blob.core.windows.net/audiowavs/x.wav',
    spectrogramUri: 'https://livemlaudiospecstorage.blob.core.windows.net/spectrogramspng/x.png',
    ...over,
  };
}

// --- classify -------------------------------------------------------------------------------

test('an unreviewed detection is not whales yet, whatever the model guessed', () => {
  assert.deepEqual(classify(detection()), { reviewed: false, whales: false, species: null });
});

test('found yes is a moderator-confirmed Southern Resident detection', () => {
  const c = classify(detection({ reviewed: true, found: 'yes', tagList: ['srkw', 'vessel'] }));
  assert.deepEqual(c, { reviewed: true, whales: true, species: 'Southern Resident killer whales' });
});

test('transient and humpback tags count as whales though found is no (OrcaHello targets SRKW)', () => {
  assert.deepEqual(classify(detection({ reviewed: true, found: 'no', tagList: ['vessel', 'transient', 'orca', 'whale'] })),
    { reviewed: true, whales: true, species: "Bigg's killer whales" });
  assert.deepEqual(classify(detection({ reviewed: true, found: 'no', tagList: ['humpback'] })),
    { reviewed: true, whales: true, species: 'humpback whales' });
  assert.deepEqual(classify(detection({ reviewed: true, found: 'no', tagList: ['whale'] })),
    { reviewed: true, whales: true, species: null });
});

test('a reviewed detection with no whale tag is a rejection', () => {
  assert.deepEqual(classify(detection({ reviewed: true, found: 'no', tagList: ['vessel', 'bird'] })),
    { reviewed: true, whales: false, species: null });
});

// --- evidence -------------------------------------------------------------------------------

test('evidence carries the hydrophone, the audio link, and never the moderator', () => {
  const ev = toEvidence(detection(), 'ev-1');
  assert.equal(ev.source, 'hydrophones');
  assert.equal(ev.atNs, String(T0));
  assert.deepEqual([ev.lat, ev.lon], [48.546653, -123.166408]);
  assert.deepEqual(ev.raw, { kind: 'url', url: detection().audioUri });
  assert.equal(ev.counted, false);
  assert.equal(ev.reason, 'awaiting moderator review');
  assert.equal(ev.text, 'Andrews Bay hydrophone: OrcaHello flagged possible calls (77%)');
  assert.ok(!JSON.stringify(ev).includes('@'), 'no moderator e-mail');
});

test('a rejection says what the moderator heard instead', () => {
  const ev = toEvidence(detection({ reviewed: true, found: 'no', tagList: ['vessel', 'bird'] }), 'ev-1');
  assert.equal(ev.reason, 'moderator: no whales');
  assert.equal(ev.text, 'Andrews Bay hydrophone: OrcaHello flagged possible calls (77%); moderator heard vessel, bird');
});

test('a confirmation names the species the moderator gave', () => {
  const ev = toEvidence(detection({ reviewed: true, found: 'yes', tagList: ['srkw'] }), 'ev-1');
  assert.equal(ev.text, 'Andrews Bay hydrophone: moderator confirmed Southern Resident killer whales');
  assert.equal(ev.species, 'Southern Resident killer whales');
  assert.equal(ev.reason, null);
});

test('a non-https audio link is dropped', () => {
  assert.equal(toEvidence(detection({ audioUri: 'javascript:alert(1)', spectrogramUri: null }), 'e').raw, null);
});

// --- bus dedupe ----------------------------------------------------------------------------

test('the gate passes a detection once, and again when its review changes', () => {
  const pass = createDetectionGate();
  assert.equal(pass(detection()), true);
  assert.equal(pass(detection()), false); // the ingest's periodic resync
  assert.equal(pass(detection({ reviewed: true, found: 'yes', tagList: ['srkw'] })), true);
  assert.equal(pass(detection({ reviewed: true, found: 'yes', tagList: ['srkw'] })), false);
  assert.equal(pass({}), false);
});

// --- fusion with boat estimates -------------------------------------------------------------

/** `real`: replay the scenario's tracks as unsimulated boats, so they land in the real world. */
function harness({ real = false } = {}) {
  const sent = [];
  let clock = T0;
  const vessels = real
    ? new Map([...loadVessels()].map(([m, v]) => [m, { ...v, simulated: false }]))
    : loadVessels();
  const core = createInferenceService({
    config: loadConfig(), harbours: loadHarbours(), vessels,
    publish: (topic, schemaName, payload) => sent.push({ topic, schemaName, payload }),
    now: () => clock,
  });
  const replay = (untilMin) => {
    const positions = scenarioPositions(scenario, T0);
    let i = 0;
    for (let m = 1; m <= untilMin; m++) {
      clock = T0 + BigInt(m) * MIN;
      while (i < positions.length && positions[i].atNs <= clock) {
        const { simulated, simRunId, ...pos } = positions[i++].pos;
        core.onPosition(real ? pos : { ...pos, simulated, simRunId });
      }
      core.tick();
    }
  };
  return { core, sent, replay, now: () => clock };
}

/** Race Rocks' estimate, which the scenario produces by minute 45. */
const raceRocksEstimate = (h) => h.core.snapshot().estimates.find((e) => e.status === 'active');

test('a confirmed detection near an active estimate is counted on it and sets its species', () => {
  const h = harness({ real: true });
  h.replay(45);
  const est = raceRocksEstimate(h);
  // A hydrophone 2 km from the estimate, heard now.
  const d = detection({ reviewed: true, found: 'no', tagList: ['transient', 'orca'], timestamp: iso(h.now()),
    location: { id: 'x', name: 'Test Site', latitude: est.lat + 0.018, longitude: est.lon } });
  h.sent.length = 0;
  h.core.onHydrophone(d);
  const ev = h.sent.find((s) => s.topic === 'orca.evidence').payload;
  assert.equal(ev.counted, true);
  assert.equal(ev.estimateId, est.id);
  const up = h.sent.find((s) => s.topic === 'orca.estimate').payload;
  assert.equal(up.estimate.species, "Bigg's killer whales");
  assert.ok(up.estimate.evidenceIds.includes(ev.id));
  h.core.tick(); // the species survives re-clustering
  assert.equal(raceRocksEstimate(h).species, "Bigg's killer whales");
});

test('a confirmed detection far from every estimate makes its own on the hydrophone', () => {
  const h = harness({ real: true });
  h.replay(45);
  const d = detection({ reviewed: true, found: 'yes', tagList: ['srkw'], timestamp: iso(h.now()),
    location: { id: 'pt', name: 'Port Townsend', latitude: 48.1357, longitude: -122.7606 } });
  h.sent.length = 0;
  h.core.onHydrophone(d);
  const ev = h.sent.find((s) => s.topic === 'orca.evidence').payload;
  const up = h.sent.find((s) => s.topic === 'orca.estimate').payload;
  assert.equal(up.event, 'upsert');
  assert.deepEqual([up.estimate.lat, up.estimate.lon, up.estimate.boats], [48.1357, -122.7606, []]);
  assert.equal(up.estimate.species, 'Southern Resident killer whales');
  assert.deepEqual([ev.counted, ev.estimateId], [true, up.estimate.id]);
  assert.ok(h.core.snapshot().estimates.some((e) => e.id === up.estimate.id && e.status === 'active'));
});

test('a detection confirmed hours after the call shows as an ended estimate', () => {
  const h = harness({ real: true });
  h.replay(5);
  const d = detection({ reviewed: true, found: 'no', tagList: ['humpback'],
    timestamp: iso(h.now() - 180n * MIN) });
  h.sent.length = 0;
  h.core.onHydrophone(d);
  const up = h.sent.find((s) => s.topic === 'orca.estimate').payload;
  assert.deepEqual([up.event, up.estimate.status], ['ended', 'ended']);
  assert.ok(h.core.snapshot().estimates.some((e) => e.id === up.estimate.id && e.status === 'ended'));
});

test('an unreviewed detection makes no estimate', () => {
  const h = harness({ real: true });
  h.sent.length = 0;
  h.core.onHydrophone(detection({ timestamp: iso(h.now()) }));
  assert.equal(h.sent.filter((s) => s.topic === 'orca.estimate').length, 0);
  assert.equal(h.sent.at(-1).payload.reason, 'awaiting moderator review');
});

test('a simulated estimate never takes real hydrophone evidence', () => {
  const h = harness();
  h.replay(45);
  const est = raceRocksEstimate(h);
  assert.equal(est.simulated, true);
  h.core.onHydrophone(detection({ reviewed: true, found: 'yes', tagList: ['srkw'], timestamp: iso(h.now()),
    location: { id: 'x', name: 'Test Site', latitude: est.lat, longitude: est.lon } }));
  const ev = h.sent.filter((s) => s.topic === 'orca.evidence').at(-1).payload;
  assert.notEqual(ev.estimateId, est.id);
  assert.ok(!raceRocksEstimate(h).evidenceIds.includes(ev.id));
});

test('a re-reviewed detection keeps its evidence id', () => {
  const h = harness();
  h.core.onHydrophone(detection());
  h.core.onHydrophone(detection({ reviewed: true, found: 'no', tagList: ['vessel'] }));
  const ev = h.sent.filter((s) => s.topic === 'orca.evidence').map((s) => s.payload);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].id, ev[1].id);
  assert.equal(h.core.snapshot().evidence.filter((e) => e.id === ev[0].id).length, 1);
});
