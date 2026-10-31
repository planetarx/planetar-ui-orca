// The inference service minus its I/O: AIS positions in, evidence and
// estimates out through `publish`, a snapshot for page reloads.
//
// Simulated and real boats live in separate "worlds" (own tracker, estimator
// and clock), so a simulated boat can never join a real estimate, and a fast
// simulation replay, stamped ahead of the wall clock, can't make real boats
// look stale.

import { BoatTracker } from './tracker.mjs';
import { Estimator } from './estimator.mjs';
import { uuidv7 } from './ids.mjs';

const NS_PER_MIN = 60_000_000_000n;
const wallNs = () => BigInt(Date.now()) * 1_000_000n;

export function createInferenceService({ config, harbours, vessels, publish, now = wallNs }) {
  const worlds = new Map();
  const evidence = [];
  const ended = []; // {estimate, atNs}
  const lastIgnored = new Map(); // mmsi → ns of the last ignored event published
  const startedNs = String(now());

  function world(simulated) {
    const key = simulated ? 'sim' : 'real';
    if (!worlds.has(key)) {
      worlds.set(key, { simulated, tracker: new BoatTracker(config, harbours, vessels),
        estimator: new Estimator(config), dataNs: null, wallAtData: null,
        lastWatching: new Map() }); // mmsi → its latest 'watching' evidence
    }
    return worlds.get(key);
  }

  // Real boats run on the wall clock; simulated ones on the replay's own
  // time, carried forward by wall time once the replay stops.
  function clock(w) {
    const t = now();
    if (!w.simulated || w.dataNs == null) return t;
    const data = w.dataNs + (t - w.wallAtData);
    return data > t ? data : t;
  }

  function step(w) {
    const t = clock(w);
    const r = w.estimator.step(w.tracker.watching(t), t);
    // A boat that started watching alone was "below minimum" then; once it is
    // part of an estimate, its watching evidence is part of the why.
    for (const estimate of r.upserts) {
      for (const mmsi of estimate.boats) {
        const ev = w.lastWatching.get(mmsi);
        if (!ev || estimate.evidenceIds.includes(ev.id)) continue;
        const linked = w.estimator.attach({ ...ev, reason: null });
        w.lastWatching.set(mmsi, linked);
        const i = evidence.findIndex((x) => x.id === linked.id);
        if (i >= 0) evidence[i] = linked;
        publish('orca.evidence', 'orca.Evidence.v1', linked);
      }
    }
    for (const estimate of r.upserts) publish('orca.estimate', 'orca.Estimate.v1', { event: 'upsert', estimate });
    for (const estimate of r.ended) {
      ended.push({ estimate, atNs: now() });
      publish('orca.estimate', 'orca.Estimate.v1', { event: 'ended', estimate });
    }
  }

  function onPosition(pos) {
    const w = world(Boolean(pos.simulated));
    if (w.simulated) {
      const t = BigInt(pos.lastSeenNs);
      if (w.dataNs == null || t > w.dataNs) w.dataNs = t;
      w.wallAtData = now();
    }
    for (const e of w.tracker.update(pos)) {
      const t = BigInt(e.atNs);
      if (e.kind === 'ignored') {
        const last = lastIgnored.get(e.mmsi);
        if (last != null && t - last < BigInt(config.ignoredEveryMin) * NS_PER_MIN) continue;
        lastIgnored.set(e.mmsi, t);
      }
      if (e.kind === 'watching' || e.kind === 'left') step(w); // so attach sees the new clusters
      const ev = w.estimator.attach({
        id: uuidv7(Number(t / 1_000_000n)), source: 'boats', atNs: e.atNs, text: e.text,
        counted: false, reason: e.reason, estimateId: null, mmsi: e.mmsi, lat: e.lat, lon: e.lon,
        raw: { kind: 'ais-track', mmsi: e.mmsi,
          fromNs: String(t - BigInt(config.trackWindowMin) * NS_PER_MIN), toNs: e.atNs },
        simulated: e.simulated,
      });
      if (e.kind === 'watching') w.lastWatching.set(e.mmsi, ev);
      evidence.push(ev);
      if (evidence.length > config.evidenceKeep) evidence.shift();
      publish('orca.evidence', 'orca.Evidence.v1', ev);
    }
  }

  function tick() {
    for (const w of worlds.values()) step(w);
  }

  function snapshot() {
    const keepNs = BigInt(config.snapshotEndedMin) * NS_PER_MIN;
    const t = now();
    while (ended.length && t - ended[0].atNs > keepNs) ended.shift();
    return {
      estimates: [...[...worlds.values()].flatMap((w) => w.estimator.current()), ...ended.map((e) => e.estimate)],
      evidence: [...evidence],
      startedNs,
    };
  }

  return { onPosition, tick, snapshot };
}
