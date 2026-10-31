import { create } from 'zustand';

/** The fields of a vessel.ais.position payload the orca UI uses. */
export interface BoatPosition {
  mmsi: number;
  name?: string;
  lat: number;
  lon: number;
  sog: number;
  cog?: number;
  lastSeenNs: string;
  serverId?: string;
  simulated?: boolean;
}

export interface BoatRecord {
  pos: BoatPosition;
  track: { lat: number; lon: number; atNs: string }[];
}

const TRACK_KEEP_NS = 2n * 3_600_000_000_000n; // last 2 h

interface BoatsState {
  byMmsi: Record<number, BoatRecord>;
  ingest: (p: BoatPosition) => void;
  /** Merge recorded positions (from the service's /track) into a boat's track. */
  mergeTrack: (mmsi: number, points: { lat: number; lon: number; atNs: string }[]) => void;
}

export const useBoatsStore = create<BoatsState>((set) => ({
  byMmsi: {},
  ingest: (p) => {
    if (p.serverId !== 'orca' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
    set((s) => {
      const prev = s.byMmsi[p.mmsi];
      const cutoff = BigInt(p.lastSeenNs) - TRACK_KEEP_NS;
      const track = [...(prev?.track ?? []), { lat: p.lat, lon: p.lon, atNs: p.lastSeenNs }]
        .filter((t) => BigInt(t.atNs) >= cutoff);
      return { byMmsi: { ...s.byMmsi, [p.mmsi]: { pos: p, track } } };
    });
  },
  mergeTrack: (mmsi, points) => set((s) => {
    const prev = s.byMmsi[mmsi];
    const seen = new Set((prev?.track ?? []).map((t) => t.atNs));
    const track = [...(prev?.track ?? []), ...points.filter((p) => !seen.has(p.atNs))
      .map(({ lat, lon, atNs }) => ({ lat, lon, atNs }))]
      .sort((a, b) => (BigInt(a.atNs) < BigInt(b.atNs) ? -1 : 1));
    const last = points[points.length - 1];
    const pos = prev?.pos ?? (last && { mmsi, lat: last.lat, lon: last.lon, sog: NaN, lastSeenNs: last.atNs, serverId: 'orca' });
    return pos ? { byMmsi: { ...s.byMmsi, [mmsi]: { pos, track } } } : {};
  }),
}));
