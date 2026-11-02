// Watching boats → whale estimates. Boats close together are watching the
// same thing; the whales are near them but not on them (boats keep a
// regulated standoff), so the estimate is an area around the cluster.
// A moderator-confirmed hydrophone call with no boat estimate near it makes
// its own estimate on the hydrophone, which boats gathering nearby absorb.

import { centroid, distanceM } from './geo.mjs';
import { uuidv7 } from './ids.mjs';

const NS_PER_MIN = 60_000_000_000n;

/** Single-linkage clusters: boats within radiusM of any member join it. */
function clusters(boats, radiusM) {
  const groups = [];
  const seen = new Set();
  for (const b of boats) {
    if (seen.has(b.mmsi)) continue;
    const group = [b];
    seen.add(b.mmsi);
    for (let i = 0; i < group.length; i++) {
      for (const o of boats) {
        if (!seen.has(o.mmsi) && distanceM(group[i], o) <= radiusM) {
          seen.add(o.mmsi);
          group.push(o);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export class Estimator {
  constructor(config) {
    this.c = config;
    this.active = new Map(); // id → {estimate, lastClusterNs} or, heard only, {estimate, heard: {calls, untilNs}}
    this.boatEstimate = new Map(); // mmsi → estimate id (kept until that estimate ends)
    this.boatClusterSize = new Map(); // mmsi → size of its cluster at the last step
  }

  confidence(group, nowNs) {
    const k = this.c.confidence;
    const operators = new Set(group.map((b) => b.operator)).size;
    const earliest = group.reduce((m, b) => (b.sinceNs < m ? b.sinceNs : m), group[0].sinceNs);
    const loiterMin = Math.min(k.loiterCapMin, Number(nowNs - earliest) / Number(NS_PER_MIN));
    const s = k.perBoat * group.length + k.perExtraOperator * (operators - 1) + k.perLoiterMin * loiterMin;
    return 1 - Math.exp(-s);
  }

  /** Re-cluster the boats watching now → estimates to publish and ones that ended. */
  step(watching, nowNs) {
    this.boatClusterSize = new Map();
    const upserts = [];
    const claimed = new Set();
    const absorbed = new Map(); // heard-only estimate id → the boat estimate that took it
    for (const group of clusters(watching, this.c.clusterRadiusM)) {
      for (const b of group) this.boatClusterSize.set(b.mmsi, group.length);
      if (group.length < this.c.minBoats) continue;

      // Reuse the active estimate sharing the most boats, so the id is stable.
      let best = null;
      let bestShared = 0;
      for (const [id, a] of this.active) {
        if (claimed.has(id)) continue;
        const shared = group.filter((b) => a.estimate.boats.includes(b.mmsi)).length;
        if (shared > bestShared) [best, bestShared] = [id, shared];
      }
      const prev = best ? this.active.get(best).estimate : null;
      const id = best ?? uuidv7(Number(nowNs / 1_000_000n));
      claimed.add(id);

      const c = centroid(group);
      const spread = Math.max(...group.map((b) => distanceM(c, b)));
      const estimate = {
        id, label: 'whales', species: prev?.species ?? null, // only a source that states it sets it
        lat: c.lat, lon: c.lon, radiusM: Math.round(spread + this.c.whaleStandoffM),
        confidence: this.confidence(group, nowNs),
        status: 'active',
        firstNs: prev?.firstNs ?? String(nowNs), updatedNs: String(nowNs),
        boats: group.map((b) => b.mmsi), operators: [...new Set(group.map((b) => b.operator))],
        evidenceIds: prev?.evidenceIds ?? [],
        simulated: group.some((b) => b.simulated),
      };
      this.active.set(id, { estimate, lastClusterNs: nowNs });
      for (const b of group) this.boatEstimate.set(b.mmsi, id);
      for (const [hid, a] of this.active) {
        if (!a.heard || absorbed.has(hid) || distanceM(a.estimate, estimate) > this.c.hydrophoneRangeM) continue;
        absorbed.set(hid, id);
        estimate.evidenceIds = [...new Set([...estimate.evidenceIds, ...a.estimate.evidenceIds])];
        estimate.species ??= a.estimate.species;
      }
      upserts.push(estimate);
    }

    const ended = [];
    const endNs = BigInt(this.c.endAfterMin) * NS_PER_MIN;
    const boatTo = new Map(upserts.flatMap((u) => u.boats.map((m) => [m, u.id])));
    for (const [id, a] of this.active) {
      if (claimed.has(id)) continue;
      if (a.heard) {
        const into = absorbed.get(id);
        if (!into && nowNs < a.heard.untilNs) continue;
        this.active.delete(id);
        ended.push({ ...a.estimate, status: 'ended', updatedNs: String(nowNs), ...(into && { mergedInto: into }) });
        continue;
      }
      // Every boat now belongs to another estimate: it merged, so end it now
      // rather than leave a frozen ghost for endAfterMin.
      const into = a.estimate.boats.length && a.estimate.boats.every((m) => boatTo.has(m))
        ? boatTo.get(a.estimate.boats[0]) : null;
      if (!into && nowNs - a.lastClusterNs < endNs) continue;
      const estimate = { ...a.estimate, status: 'ended', updatedNs: String(nowNs), ...(into && { mergedInto: into }) };
      this.active.delete(id);
      for (const [mmsi, eid] of this.boatEstimate) if (eid === id) this.boatEstimate.delete(mmsi);
      ended.push(estimate);
    }
    return { upserts, ended };
  }

  /** Fill in counted / estimateId / reason for one boat evidence item. */
  attach(evidence) {
    if (evidence.reason) return { ...evidence, counted: false };
    const id = evidence.mmsi == null ? undefined : this.boatEstimate.get(evidence.mmsi);
    const a = id && this.active.get(id);
    if (a) {
      a.estimate.evidenceIds = [...a.estimate.evidenceIds, evidence.id];
      return { ...evidence, counted: true, estimateId: id, reason: null };
    }
    const size = this.boatClusterSize.get(evidence.mmsi);
    const reason = size && size < this.c.minBoats
      ? `${size} boat, below minimum of ${this.c.minBoats}`
      : 'not watching';
    return { ...evidence, counted: false, estimateId: null, reason };
  }

  /**
   * One moderator-confirmed hydrophone call. It counts on the nearest active boat estimate
   * within hydrophoneRangeM whose span, widened by hydrophoneWithinMin, covers its time;
   * failing that, on the nearest hydrophone-only estimate still alive at that time; failing
   * that, it makes a hydrophone-only estimate centred on the hydrophone, alive until
   * hydrophoneEstimateMin after its latest call (already ended if the call was confirmed
   * later than that). A species it states becomes the estimate's.
   * → { evidence, upserts, ended }
   */
  hear(evidence, nowNs) {
    const t = BigInt(evidence.atNs);
    const withinNs = BigInt(this.c.hydrophoneWithinMin) * NS_PER_MIN;
    const lifeNs = BigInt(this.c.hydrophoneEstimateMin) * NS_PER_MIN;
    const nearest = (heard) => {
      let best = null;
      let bestD = Infinity;
      for (const a of this.active.values()) {
        if (Boolean(a.heard) !== heard) continue;
        const e = a.estimate;
        const until = heard ? a.heard.untilNs : BigInt(e.updatedNs) + withinNs;
        if (t < BigInt(e.firstNs) - withinNs || t > until) continue;
        const d = distanceM(e, evidence);
        if (d <= this.c.hydrophoneRangeM && d < bestD) [best, bestD] = [a, d];
      }
      return best;
    };
    const counted = (e) => ({ ...evidence, counted: true, estimateId: e.id, reason: null });

    const a = nearest(false) ?? nearest(true);
    if (a) {
      const e = a.estimate;
      const isNew = !e.evidenceIds.includes(evidence.id); // a re-review of a call already counted
      if (isNew) e.evidenceIds = [...e.evidenceIds, evidence.id];
      if (evidence.species && !e.species) e.species = evidence.species;
      if (a.heard && isNew) {
        a.heard.calls += 1;
        if (t > BigInt(e.updatedNs)) e.updatedNs = String(t);
        if (t < BigInt(e.firstNs)) e.firstNs = String(t);
        a.heard.untilNs = BigInt(e.updatedNs) + lifeNs;
        e.confidence = 1 - Math.exp(-this.c.confidence.perCall * a.heard.calls);
      }
      return { evidence: counted(e), upserts: [e], ended: [] };
    }

    const estimate = {
      id: uuidv7(Number(t / 1_000_000n)), label: 'whales', species: evidence.species ?? null,
      lat: evidence.lat, lon: evidence.lon, radiusM: this.c.hydrophoneHearingM,
      confidence: 1 - Math.exp(-this.c.confidence.perCall),
      status: 'active', firstNs: evidence.atNs, updatedNs: evidence.atNs,
      boats: [], operators: [], evidenceIds: [evidence.id], simulated: Boolean(evidence.simulated),
    };
    const untilNs = t + lifeNs;
    if (nowNs >= untilNs) {
      return { evidence: counted(estimate), upserts: [], ended: [{ ...estimate, status: 'ended' }] };
    }
    this.active.set(estimate.id, { estimate, heard: { calls: 1, untilNs } });
    return { evidence: counted(estimate), upserts: [estimate], ended: [] };
  }

  current() {
    return [...this.active.values()].map((a) => a.estimate);
  }
}
