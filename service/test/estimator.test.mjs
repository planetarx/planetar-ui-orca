import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Estimator } from '../estimator.mjs';
import { loadConfig } from '../load.mjs';

const config = loadConfig();
const MIN = 60_000_000_000n;
const T0 = 1_800_000_000_000_000_000n;
const at = (m) => T0 + BigInt(m) * MIN;
const BASE = { lat: 48.29, lon: -123.53 };
/** A watching boat `dEastM` metres east of BASE (1° lon ≈ 74 km here). */
const boat = (mmsi, dEastM, operator = 'Op A', sinceMin = 0) => ({
  mmsi, name: `B${mmsi}`, operator, lat: BASE.lat, lon: BASE.lon + dEastM / 74_000,
  sinceNs: at(sinceMin), lastNs: at(sinceMin), simulated: true,
});
const evidence = (mmsi, extra = {}) => ({
  id: `ev-${mmsi}-${Math.random()}`, source: 'boats', atNs: String(T0), text: 't', counted: false,
  reason: null, estimateId: null, mmsi, lat: null, lon: null, raw: null, simulated: true, ...extra,
});

test('two boats 600 m apart make one estimate', () => {
  const e = new Estimator(config);
  const { upserts } = e.step([boat(1, 0), boat(2, 600)], at(10));
  assert.equal(upserts.length, 1);
  const [est] = upserts;
  assert.equal(est.label, 'whales');
  assert.equal(est.species, null);
  assert.equal(est.status, 'active');
  assert.ok(est.radiusM >= 700 && est.radiusM <= 1100, `radiusM ${est.radiusM}`);
  assert.ok(est.confidence > 0 && est.confidence < 1);
  assert.deepEqual(est.boats.sort(), [1, 2]);
  assert.equal(est.simulated, true);
});

test('one boat makes no estimate and attach marks it below minimum', () => {
  const e = new Estimator(config);
  assert.deepEqual(e.step([boat(1, 0)], at(10)).upserts, []);
  const ev = e.attach(evidence(1));
  assert.equal(ev.counted, false);
  assert.equal(ev.reason, '1 boat, below minimum of 2');
});

test('attach links a watching boat\'s evidence to its estimate', () => {
  const e = new Estimator(config);
  const [est] = e.step([boat(1, 0), boat(2, 600)], at(10)).upserts;
  const ev = e.attach(evidence(2));
  assert.equal(ev.counted, true);
  assert.equal(ev.estimateId, est.id);
  assert.ok(e.current()[0].evidenceIds.includes(ev.id));
});

test('attach keeps a reason the tracker already gave', () => {
  const e = new Estimator(config);
  const ev = e.attach(evidence(9, { reason: 'in harbour: Inner Harbour' }));
  assert.equal(ev.counted, false);
  assert.equal(ev.reason, 'in harbour: Inner Harbour');
});

test('more boats and operators raise confidence', () => {
  const two = new Estimator(config).step([boat(1, 0), boat(2, 300)], at(10)).upserts[0];
  const four = new Estimator(config).step(
    [boat(1, 0, 'Op A'), boat(2, 300, 'Op B'), boat(3, 600, 'Op C'), boat(4, 900, 'Op A')], at(10)).upserts[0];
  assert.ok(four.confidence > two.confidence, `${four.confidence} vs ${two.confidence}`);
});

test('id is stable as boats join and leave', () => {
  const e = new Estimator(config);
  const a = e.step([boat(1, 0), boat(2, 300)], at(1)).upserts[0].id;
  const b = e.step([boat(1, 0), boat(2, 300), boat(3, 600)], at(2)).upserts[0].id;
  const c = e.step([boat(2, 300), boat(3, 600)], at(3)).upserts[0].id;
  assert.equal(a, b);
  assert.equal(b, c);
});

test('estimate ends endAfterMin after the last cluster, once', () => {
  const e = new Estimator(config);
  e.step([boat(1, 0), boat(2, 300)], at(0));
  assert.deepEqual(e.step([], at(14)).ended, []);
  const { ended } = e.step([], at(15));
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, 'ended');
  assert.deepEqual(e.step([], at(16)).ended, []);
  assert.deepEqual(e.current(), []);
});

test('two clusters 10 km apart make two estimates', () => {
  const e = new Estimator(config);
  const { upserts } = e.step([boat(1, 0), boat(2, 300), boat(3, 10_000), boat(4, 10_300)], at(5));
  assert.equal(upserts.length, 2);
  assert.notEqual(upserts[0].id, upserts[1].id);
});

test('when two estimates merge, the absorbed one ends at once', () => {
  const e = new Estimator(config);
  const first = e.step([boat(1, 0), boat(2, 300), boat(3, 6000), boat(4, 6300)], at(1)).upserts;
  assert.equal(first.length, 2);
  // The two groups drift together into one cluster.
  const { upserts, ended } = e.step([boat(1, 0), boat(2, 300), boat(3, 900), boat(4, 1200)], at(2));
  assert.equal(upserts.length, 1);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, 'ended');
  assert.equal(ended[0].mergedInto, upserts[0].id);
  assert.equal(e.current().length, 1);
});

// --- hydrophone-only estimates --------------------------------------------------------------

/** A confirmed call heard at BASE + dEastM, `min` minutes after T0. */
const call = (dEastM, min, extra = {}) => ({
  id: `call-${dEastM}-${min}-${Math.random()}`, source: 'hydrophones', atNs: String(at(min)), text: 't',
  counted: false, reason: null, estimateId: null, mmsi: null, lat: BASE.lat, lon: BASE.lon + dEastM / 74_000,
  raw: null, simulated: false, species: null, ...extra,
});

test('a confirmed call with no estimate nearby makes one on the hydrophone', () => {
  const e = new Estimator(config);
  const r = e.hear(call(0, 0, { species: "Bigg's killer whales" }), at(5));
  assert.equal(r.upserts.length, 1);
  const [est] = r.upserts;
  assert.deepEqual([est.lat, est.lon, est.radiusM], [BASE.lat, BASE.lon, config.hydrophoneHearingM]);
  assert.deepEqual([est.boats, est.operators], [[], []]);
  assert.equal(est.species, "Bigg's killer whales");
  assert.equal(est.status, 'active');
  assert.equal(est.simulated, false);
  assert.ok(Math.abs(est.confidence - (1 - Math.exp(-config.confidence.perCall))) < 1e-9);
  assert.deepEqual([r.evidence.counted, r.evidence.estimateId, r.evidence.reason], [true, est.id, null]);
  assert.deepEqual(est.evidenceIds, [r.evidence.id]);
});

test('more calls from the same place join it, extend it and raise confidence', () => {
  const e = new Estimator(config);
  const first = e.hear(call(0, 0), at(1)).upserts[0];
  const c1 = first.confidence;
  const r = e.hear(call(300, 70), at(71)); // 70 min later: past hydrophoneWithinMin, inside the estimate's life
  assert.equal(r.upserts[0].id, first.id);
  assert.equal(r.upserts[0].updatedNs, String(at(70)));
  assert.ok(r.upserts[0].confidence > c1);
  assert.equal(e.current().length, 1);
});

test('a call prefers a boat estimate in range over a nearer hydrophone-only one', () => {
  const e = new Estimator(config);
  const heard = e.hear(call(0, 0), at(1)).upserts[0];
  // Boats 14 km off: too far to absorb the hydrophone estimate; the call between them is 5 km
  // from the hydrophone and 9 km from the boats.
  const boatEst = e.step([boat(1, 14000, 'Op A', 0), boat(2, 14400, 'Op B', 0)], at(2)).upserts
    .find((x) => x.boats.length);
  const r = e.hear(call(5000, 3), at(3));
  assert.equal(r.evidence.estimateId, boatEst.id);
  assert.notEqual(r.evidence.estimateId, heard.id);
});

test('a hydrophone-only estimate ends hydrophoneEstimateMin after its latest call', () => {
  const e = new Estimator(config);
  e.hear(call(0, 0), at(1));
  assert.equal(e.step([], at(config.hydrophoneEstimateMin - 1)).ended.length, 0);
  const { ended } = e.step([], at(config.hydrophoneEstimateMin));
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, 'ended');
  assert.equal(e.current().length, 0);
});

test('a call confirmed after its estimate would have ended arrives already ended', () => {
  const e = new Estimator(config);
  const r = e.hear(call(0, 0), at(config.hydrophoneEstimateMin + 60));
  assert.equal(r.upserts.length, 0);
  assert.equal(r.ended.length, 1);
  assert.equal(r.ended[0].status, 'ended');
  assert.equal(r.evidence.estimateId, r.ended[0].id);
  assert.equal(e.current().length, 0);
});

test('boats gathering near a hydrophone-only estimate absorb it', () => {
  const e = new Estimator(config);
  const heard = e.hear(call(0, 0, { species: 'humpback whales' }), at(1)).upserts[0];
  const { upserts, ended } = e.step([boat(1, 1000, 'Op A', 0), boat(2, 1400, 'Op B', 0)], at(10));
  const est = upserts.find((x) => x.boats.length);
  assert.equal(est.species, 'humpback whales');
  assert.ok(heard.evidenceIds.every((id) => est.evidenceIds.includes(id)));
  assert.equal(ended.length, 1);
  assert.deepEqual([ended[0].id, ended[0].mergedInto], [heard.id, est.id]);
  assert.deepEqual(e.current().map((x) => x.id), [est.id]);
});

test('the same call re-reviewed does not count twice', () => {
  const e = new Estimator(config);
  const c = call(0, 0);
  const first = e.hear(c, at(1)).upserts[0].confidence;
  assert.equal(e.hear({ ...c, species: 'humpback whales' }, at(2)).upserts[0].confidence, first);
});
