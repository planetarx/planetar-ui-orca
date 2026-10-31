// Simulated encounters with a known answer: turns a scenario file into the
// AIS positions planetar-ais would publish, plus the true whale track.
// Everything it makes is marked simulated.

const M_PER_DEG = 111_320;
const KN_MS = 1852 / 3600;
const NS_PER_S = 1_000_000_000n;

function offset(p, distM, bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: p.lat + (distM * Math.cos(b)) / M_PER_DEG,
    lon: p.lon + (distM * Math.sin(b)) / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)),
  };
}

function metres(a, b) {
  const dy = (b.lat - a.lat) * M_PER_DEG;
  const dx = (b.lon - a.lon) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return { dx, dy, d: Math.hypot(dx, dy) };
}

/** mulberry32 — a small seeded PRNG, so a scenario always replays the same. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function whaleAt(sc, tS) {
  const w = sc.whales;
  return offset({ lat: w.start[0], lon: w.start[1] }, w.speedKn * KN_MS * tS, w.headingDeg);
}

/** → [{atNs: bigint, pos}] sorted by time; pos is a vessel.ais.position payload. */
export function scenarioPositions(sc, startNs) {
  const rand = rng(sc.seed);
  const out = [];
  const steps = Math.floor((sc.durationMin * 60) / sc.intervalS);
  for (const v of sc.vessels) {
    let p = { lat: v.start[0], lon: v.start[1] };
    let phase = 0;
    for (let k = 0; k <= steps; k++) {
      const tS = k * sc.intervalS;
      if (tS < v.startMin * 60) continue;
      let sog = 0;
      let cog = 0;
      const ph = v.phases[phase];
      if (ph?.kind === 'idle') {
        sog = ph.sogKn;
        if (tS >= ph.untilMin * 60) phase++;
      } else if (ph?.kind === 'hold') {
        const target = offset(whaleAt(sc, tS), ph.offsetM, ph.bearingDeg);
        p = target;
        sog = sc.whales.speedKn;
        cog = sc.whales.headingDeg;
        if (tS >= ph.untilMin * 60) phase++;
      } else if (ph?.kind === 'goto') {
        const dest = ph.to === 'whales'
          ? offset(whaleAt(sc, tS), ph.offsetM, ph.bearingDeg)
          : { lat: ph.to[0], lon: ph.to[1] };
        const { dx, dy, d } = metres(p, dest);
        const stepM = ph.speedKn * KN_MS * sc.intervalS;
        if (d <= stepM) {
          p = dest;
          phase++;
        } else {
          p = { lat: p.lat + (dy / d) * stepM / M_PER_DEG,
            lon: p.lon + (dx / d) * stepM / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)) };
        }
        sog = ph.speedKn;
        cog = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      } else {
        continue; // schedule finished: the vessel stops reporting
      }
      const j = offset(p, rand() * sc.jitterM, rand() * 360);
      const atNs = startNs + BigInt(tS) * NS_PER_S;
      out.push({ atNs, pos: { mmsi: v.mmsi, name: v.name, lat: j.lat, lon: j.lon, sog, cog,
        lastSeenNs: String(atNs), simulated: true, serverId: 'orca' } });
    }
  }
  return out.sort((a, b) => (a.atNs < b.atNs ? -1 : a.atNs > b.atNs ? 1 : a.pos.mmsi - b.pos.mmsi));
}

/** The true whale position at every interval. */
export function scenarioTruth(sc, startNs) {
  const whale = [];
  for (let tS = 0; tS <= sc.durationMin * 60; tS += sc.intervalS) {
    whale.push({ atNs: startNs + BigInt(tS) * NS_PER_S, ...whaleAt(sc, tS) });
  }
  return { whale };
}
