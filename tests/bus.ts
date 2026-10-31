// Publish test envelopes through the dev bridge (ws://127.0.0.1:9400), as the
// UI's own broker client does. The bridge only relays live traffic, so
// `publishUntil` re-publishes until the page shows the result.

import WebSocket from 'ws';
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

const BRIDGE = 'ws://127.0.0.1:9400';

export function publish(topic: string, schemaName: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE);
    ws.on('error', reject);
    ws.on('open', () => {
      const now = String(BigInt(Date.now()) * 1_000_000n);
      ws.send(JSON.stringify({ type: 'publish', envelope: {
        magic: 'ZMSG', version: 1, flags: 0, headerLen: 66, id: crypto.randomUUID(),
        createdAtNs: now, storedAtNs: now, publishedAtNs: now, schemaVersion: 1,
        topic, source: 'planetar-ui-orca/test', schemaName, correlationId: '', causationId: '',
        payloadLen: 0, payload,
      } }));
      setTimeout(() => { ws.close(); resolve(); }, 100);
    });
  });
}

export async function publishUntil(page: Page, target: Locator, send: () => Promise<void>) {
  await expect(async () => {
    await send();
    await expect(target).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 15_000 });
}

export const ns = () => String(BigInt(Date.now()) * 1_000_000n);
const uid = () => crypto.randomUUID();

export function evidence(over: Record<string, unknown> = {}) {
  return { id: uid(), source: 'boats', atNs: ns(), text: `test evidence ${uid().slice(0, 8)}`,
    counted: false, reason: null, estimateId: null, mmsi: 999000001, lat: 48.29, lon: -123.53,
    raw: { kind: 'ais-track', mmsi: 999000001, fromNs: ns(), toNs: ns() }, simulated: false, ...over };
}

export function estimate(over: Record<string, unknown> = {}) {
  return { id: uid(), label: 'whales', species: null, lat: 48.29, lon: -123.53, radiusM: 900,
    confidence: 0.78, status: 'active', firstNs: ns(), updatedNs: ns(), boats: [999000001, 999000002],
    operators: ['Op A'], evidenceIds: [], simulated: false, ...over };
}
