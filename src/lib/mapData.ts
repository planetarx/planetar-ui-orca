// GeoJSON for the map's layers, kept apart from MapLibre so it can be tested.
// Relative imports (no `@/`), so Node-side tests can load it directly.
import type { Feature, Point, Polygon } from 'geojson';
import { circleRing } from './geo';
import type { BoatRecord } from '../store/boatsStore';
import type { OrcaEstimate } from '../types/orca';

const NS_PER_MIN = 60_000_000_000n;

export function estimateFeatures(ests: OrcaEstimate[], selectedId: string | null, offline: boolean): Feature<Polygon>[] {
  return ests.map((e) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [circleRing(e, e.radiusM)] },
    properties: { id: e.id, opacity: e.confidence * (offline ? 0.25 : 0.6), selected: e.id === selectedId,
      simulated: e.simulated },
  }));
}

/**
 * Boats heard from within staleMin. Real boats are aged against the wall
 * clock; simulated ones against the newest simulated fix (a --speed replay
 * stamps ahead of the wall clock).
 */
export function boatFeatures(byMmsi: Record<number, BoatRecord>, inEstimate: Set<number>, nowNs: bigint,
  staleMin: number): Feature<Point>[] {
  const recs = Object.values(byMmsi);
  const simNow = recs.filter((b) => b.pos.simulated)
    .reduce((m, b) => (BigInt(b.pos.lastSeenNs) > m ? BigInt(b.pos.lastSeenNs) : m), 0n);
  const stale = BigInt(staleMin) * NS_PER_MIN;
  return recs
    .filter((b) => (b.pos.simulated ? simNow : nowNs) - BigInt(b.pos.lastSeenNs) <= stale)
    .map((b) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.pos.lon, b.pos.lat] },
      properties: { mmsi: b.pos.mmsi, inEstimate: inEstimate.has(b.pos.mmsi), simulated: Boolean(b.pos.simulated) },
    }));
}
