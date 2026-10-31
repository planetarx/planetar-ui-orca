// Watching boats → whale estimates. Boats close together are watching the
// same thing; the whales are near them but not on them (boats keep a
// regulated standoff), so the estimate is an area around the cluster.

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
    this.active = new Map(); // id → {estimate, lastClusterNs}
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
        id, label: 'whales', species: null,
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
      upserts.push(estimate);
    }

    const ended = [];
    const endNs = BigInt(this.c.endAfterMin) * NS_PER_MIN;
    for (const [id, a] of this.active) {
      if (claimed.has(id) || nowNs - a.lastClusterNs < endNs) continue;
      const estimate = { ...a.estimate, status: 'ended', updatedNs: String(nowNs) };
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

  current() {
    return [...this.active.values()].map((a) => a.estimate);
  }
}
