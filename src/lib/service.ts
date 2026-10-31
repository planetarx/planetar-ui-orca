import type { Snapshot } from '@/types/orca';

// Build-time override, like VITE_WS_URL. The inference service's HTTP side.
export const SERVICE_URL: string = import.meta.env.VITE_ORCA_SERVICE_URL ?? 'http://127.0.0.1:9410';

export async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch(`${SERVICE_URL}/snapshot`);
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  return r.json();
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${SERVICE_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
}
