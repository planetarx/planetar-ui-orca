// Per-boat behaviour: is a listed whale-watch boat in port, under way,
// slowing, or watching something? Whale-watch boats run fast to the whales,
// then slow and stay put near them; that loiter is the signal.

import { distanceM, pointInPolygon } from './geo.mjs';

const NS_PER_MIN = 60_000_000_000n;
const kn = (v) => `${Number(v).toFixed(1)} kn`;

export class BoatTracker {
  constructor(config, harbours, vessels) {
    this.c = config;
    this.harbours = harbours;
    this.vessels = vessels;
    this.state = new Map(); // mmsi → {phase, anchor, slowSinceNs, lastNs, lat, lon, name}
  }

  /** One AIS position → the events it triggers (none for unlisted vessels). */
  update(pos) {
    const v = this.vessels.get(pos.mmsi);
    if (!v) return [];
    const t = BigInt(pos.lastSeenNs);
    const staleNs = BigInt(this.c.staleMin) * NS_PER_MIN;
    let s = this.state.get(pos.mmsi);
    if (!s || t - s.lastNs > staleNs) s = { phase: 'transit', anchor: null, slowSinceNs: null };
    const prev = s.phase;
    s.lastNs = t;
    s.lat = pos.lat;
    s.lon = pos.lon;
    s.name = v.name ?? pos.name;
    this.state.set(pos.mmsi, s);

    const ev = (kind, text, reason = null) => ({
      kind, mmsi: pos.mmsi, atNs: String(t), lat: pos.lat, lon: pos.lon, text, reason,
      simulated: Boolean(pos.simulated || v.simulated),
    });
    const out = [];

    const harbour = this.harbours.find((h) => pointInPolygon(pos, h.polygon));
    if (harbour) {
      if (prev === 'watching') out.push(ev('left', `${s.name} returned to ${harbour.name}`));
      Object.assign(s, { phase: 'harbour', anchor: null, slowSinceNs: null });
      out.push(ev('ignored', `${s.name} in ${harbour.name} at ${kn(pos.sog)}`, `in harbour: ${harbour.name}`));
      return out;
    }

    if (pos.sog >= this.c.slowKn) {
      if (prev === 'watching') {
        const mins = Number((t - s.slowSinceNs) / NS_PER_MIN);
        out.push(ev('left', `${s.name} left at ${kn(pos.sog)} after watching ${mins} min`));
      } else if (prev !== 'transit') {
        out.push(ev('transit', `${s.name} under way at ${kn(pos.sog)}`));
      }
      Object.assign(s, { phase: 'transit', anchor: null, slowSinceNs: null });
      return out;
    }

    // Slow. A watching boat follows slow-moving whales, so its anchor drifts
    // with it; a boat not yet watching restarts its clock when it moves off.
    const away = s.anchor && distanceM(s.anchor, pos) > this.c.loiterRadiusM;
    if (prev === 'watching') {
      if (away) s.anchor = { lat: pos.lat, lon: pos.lon };
      return out;
    }
    if (prev !== 'slow' || away) {
      if (prev !== 'slow') out.push(ev('arrived-slow', `${s.name} slowed to ${kn(pos.sog)}`));
      Object.assign(s, { phase: 'slow', anchor: { lat: pos.lat, lon: pos.lon }, slowSinceNs: t });
    }
    if (t - s.slowSinceNs >= BigInt(this.c.loiterMin) * NS_PER_MIN) {
      s.phase = 'watching';
      out.push(ev('watching',
        `${s.name} has stayed within ${this.c.loiterRadiusM} m at ${kn(pos.sog)} for ${this.c.loiterMin} min`));
    }
    return out;
  }

  /** Boats watching now: phase watching and heard from within staleMin. */
  watching(nowNs) {
    const staleNs = BigInt(this.c.staleMin) * NS_PER_MIN;
    const out = [];
    for (const [mmsi, s] of this.state) {
      if (s.phase !== 'watching' || nowNs - s.lastNs > staleNs) continue;
      const v = this.vessels.get(mmsi);
      out.push({ mmsi, name: s.name, operator: v.operator, lat: s.lat, lon: s.lon,
        sinceNs: s.slowSinceNs, lastNs: s.lastNs, simulated: Boolean(v.simulated) });
    }
    return out;
  }
}
