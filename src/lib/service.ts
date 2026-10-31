import type { Snapshot } from '@/types/orca';

// Build-time override, like VITE_WS_URL. The inference service's HTTP side.
export const SERVICE_URL: string = import.meta.env.VITE_ORCA_SERVICE_URL ?? 'http://127.0.0.1:9410';

export async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch(`${SERVICE_URL}/snapshot`);
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  return r.json();
}

/** → the service's start stamp (it changes on restart), or null if unreachable. */
export async function fetchHealth(): Promise<string | null> {
  try {
    const r = await fetch(`${SERVICE_URL}/health`);
    if (!r.ok) return null;
    return String((await r.json()).startedNs ?? '');
  } catch {
    return null;
  }
}

export interface TrackPoint { lat: number; lon: number; sog: number; atNs: string }

/** A listed boat's recorded positions (the service keeps the last 2 h). */
export async function fetchTrack(mmsi: number): Promise<TrackPoint[]> {
  // `to` is open-ended: a --speed replay stamps ahead of the wall clock.
  const r = await fetch(`${SERVICE_URL}/track?mmsi=${mmsi}&from=0&to=9223372036854775807`);
  if (!r.ok) return [];
  return (await r.json()).points ?? [];
}
