// Per-boat behaviour: is a listed whale-watch boat in port, under way,
// slowing, watching something, or moored? Whale-watch boats run fast to the
// whales, then slow and stay near them; that run-out-then-loiter is the signal.
//
// - A boat counts as watching only after a fast run (≥ transitKn) within
//   transitWithinMin before it slowed — a boat idling at a berth that no
//   harbour polygon covers never qualifies.
// - It counts as watching once it has been below slowKn for loiterMin of the
//   last loiterWindowMin. Bursts between slowKn and transitKn don't restart
//   that clock: boats stop and go around whales (real track, 2026-10-31).
// - Once slowed or watching, only a fast run (≥ transitKn), a harbour, or a
//   silence over resumeWithinMin ends it (AIS from aisstream often drops out
//   for 10–30 min). The boat still only counts while heard within staleMin.
// - Watching longer than maxWatchMin → probably moored; it stops counting
//   until its next fast run.
// - sog ≥ 102.2 is AIS "not available": position and time update, nothing else.

import { distanceM, pointInPolygon } from './geo.mjs';

const NS_PER_MIN = 60_000_000_000n;
const SOG_NOT_AVAILABLE = 102.2;
const kn = (v) => `${Number(v).toFixed(1)} kn`;

export class BoatTracker {
  constructor(config, harbours, vessels) {
    this.c = config;
    this.harbours = harbours;
    this.vessels = vessels;
    // mmsi → {phase, anchor, slowSinceNs, slowLog, lastNs, lastSog, lastFastNs, gateNoted, lat, lon, name}
    this.state = new Map();
  }

  min(n) {
    return BigInt(n) * NS_PER_MIN;
  }

  /** One AIS position → the events it triggers (none for unlisted vessels). */
  update(pos) {
    const v = this.vessels.get(pos.mmsi);
    if (!v) return [];
    const t = BigInt(pos.lastSeenNs);
    let s = this.state.get(pos.mmsi);
    if (!s || t - s.lastNs > this.min(this.c.resumeWithinMin)) {
      // New or silent too long: start over, but remember its last fast run.
      s = { phase: 'transit', anchor: null, slowSinceNs: null, slowLog: [], lastFastNs: s?.lastFastNs ?? null, gateNoted: false };
    }
    const prev = s.phase;
    const prevNs = s.lastNs;
    const prevSog = s.lastSog;
    s.lastNs = t;
    s.lat = pos.lat;
    s.lon = pos.lon;
    s.name = v.name ?? pos.name;
    this.state.set(pos.mmsi, s);

    const sog = Number(pos.sog);
    if (!Number.isFinite(sog) || sog >= SOG_NOT_AVAILABLE) return [];
    s.lastSog = sog;

    const ev = (kind, text, reason = null) => ({
      kind, mmsi: pos.mmsi, atNs: String(t), lat: pos.lat, lon: pos.lon, text, reason,
      simulated: Boolean(pos.simulated || v.simulated),
    });
    const out = [];
    const minsSince = (ns) => Number((t - ns) / NS_PER_MIN);

    const harbour = this.harbours.find((h) => pointInPolygon(pos, h.polygon));
    if (harbour) {
      if (prev === 'watching') out.push(ev('left', `${s.name} returned to ${harbour.name}`));
      Object.assign(s, { phase: 'harbour', anchor: null, slowSinceNs: null, slowLog: [], gateNoted: false });
      out.push(ev('ignored', `${s.name} in ${harbour.name} at ${kn(sog)}`, `in harbour: ${harbour.name}`));
      return out;
    }

    if (sog >= this.c.transitKn) {
      s.lastFastNs = t;
      if (prev === 'watching') out.push(ev('left', `${s.name} left at ${kn(sog)} after watching ${minsSince(s.slowSinceNs)} min`));
      else if (prev !== 'transit') out.push(ev('transit', `${s.name} under way at ${kn(sog)}`));
      Object.assign(s, { phase: 'transit', anchor: null, slowSinceNs: null, slowLog: [], gateNoted: false });
      return out;
    }

    if (prev === 'moored') {
      out.push(ev('ignored', `${s.name} stationary at ${kn(sog)}`,
        `stationary over ${this.c.maxWatchMin} min: probably moored`));
      return out;
    }

    if (prev === 'watching') {
      // Follows the whales: the anchor drifts with the boat.
      if (distanceM(s.anchor, pos) > this.c.loiterRadiusM) s.anchor = { lat: pos.lat, lon: pos.lon };
      if (t - s.slowSinceNs >= this.min(this.c.maxWatchMin)) {
        s.phase = 'moored';
        out.push(ev('ignored', `${s.name} has been still for ${minsSince(s.slowSinceNs)} min`,
          `stationary over ${this.c.maxWatchMin} min: probably moored`));
      }
      return out;
    }

    if (prev !== 'slow') {
      if (sog >= this.c.slowKn) {
        // Under way, not fast, and not yet slowed: no encounter.
        if (prev !== 'transit') out.push(ev('transit', `${s.name} under way at ${kn(sog)}`));
        Object.assign(s, { phase: 'transit', anchor: null, slowSinceNs: null, slowLog: [], gateNoted: false });
        return out;
      }
      out.push(ev('arrived-slow', `${s.name} slowed to ${kn(sog)}`));
      Object.assign(s, { phase: 'slow', anchor: { lat: pos.lat, lon: pos.lon }, slowSinceNs: t, slowLog: [], gateNoted: false });
    } else if (prevSog < this.c.slowKn && t - prevNs <= this.min(this.c.staleMin)) {
      s.slowLog.push([t, t - prevNs]); // the interval since a slow fix counts as slow time
    }
    const windowStart = t - this.min(this.c.loiterWindowMin);
    s.slowLog = s.slowLog.filter(([end]) => end > windowStart);
    const slowNs = s.slowLog.reduce((a, [, d]) => a + d, 0n);
    if (slowNs < this.min(this.c.loiterMin)) return out;

    const ranOut = s.lastFastNs != null && s.slowSinceNs - s.lastFastNs <= this.min(this.c.transitWithinMin);
    if (!ranOut) {
      if (!s.gateNoted) {
        s.gateNoted = true;
        out.push(ev('ignored', `${s.name} slow for ${this.c.loiterMin} of ${this.c.loiterWindowMin} min at ${kn(sog)}`,
          `no fast run out first (≥ ${this.c.transitKn} kn within ${this.c.transitWithinMin} min): moored or idling?`));
      }
      return out;
    }
    s.phase = 'watching';
    out.push(ev('watching',
      `${s.name} ran out fast, then was below ${kn(this.c.slowKn)} for ${this.c.loiterMin} of ${this.c.loiterWindowMin} min`));
    return out;
  }

  /** Boats watching now: phase watching and heard from within staleMin. */
  watching(nowNs) {
    const out = [];
    for (const [mmsi, s] of this.state) {
      if (s.phase !== 'watching' || nowNs - s.lastNs > this.min(this.c.staleMin)) continue;
      const v = this.vessels.get(mmsi);
      out.push({ mmsi, name: s.name, operator: v.operator, lat: s.lat, lon: s.lon,
        sinceNs: s.slowSinceNs, lastNs: s.lastNs, simulated: Boolean(v.simulated) });
    }
    return out;
  }
}
