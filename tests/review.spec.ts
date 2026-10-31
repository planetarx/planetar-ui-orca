// Regression tests for the final review's findings (C1, I5–I8).
import { test, expect } from './fixtures';
import { estimate, evidence, ns, publish, publishUntil } from './bus';
import { boatFeatures, estimateFeatures } from '../src/lib/mapData';
import type { BoatRecord } from '../src/store/boatsStore';
import type { OrcaEstimate } from '../src/types/orca';

const pubEstimate = (e: Record<string, unknown>) => () =>
  publish('orca.estimate', 'orca.Estimate.v1', { event: 'upsert', estimate: e });

test('C1: test fixtures are labelled simulated', () => {
  expect(estimate().simulated).toBe(true);
  expect(evidence().simulated).toBe(true);
});

test('I6: simulated estimates and boats are marked in the map data', () => {
  const est = estimate({ simulated: true }) as unknown as OrcaEstimate;
  expect(estimateFeatures([est], null, false)[0].properties).toMatchObject({ simulated: true });
  const now = BigInt(Date.now()) * 1_000_000n;
  const boats: Record<number, BoatRecord> = {
    1: { pos: { mmsi: 1, lat: 48.3, lon: -123.5, sog: 2, lastSeenNs: String(now), simulated: true, serverId: 'orca' }, track: [] },
  };
  expect(boatFeatures(boats, new Set(), now, 30)[0].properties).toMatchObject({ simulated: true });
});

test('I7: boats with no fix for 30 min drop off the map', () => {
  const now = BigInt(Date.now()) * 1_000_000n;
  const old = now - 31n * 60_000_000_000n;
  const boats: Record<number, BoatRecord> = {
    1: { pos: { mmsi: 1, lat: 48.3, lon: -123.5, sog: 2, lastSeenNs: String(now), serverId: 'orca' }, track: [] },
    2: { pos: { mmsi: 2, lat: 48.3, lon: -123.5, sog: 2, lastSeenNs: String(old), serverId: 'orca' }, track: [] },
  };
  expect(boatFeatures(boats, new Set(), now, 30).map((f) => f.properties.mmsi)).toEqual([1]);
});

test('I5: status line shows the bus and inference state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status-line')).toContainText('bus live');
  await expect(page.locator('.status-line')).toContainText('inference online');
});

test('I5: when offline, estimates in the list and inspector are marked stale', async ({ page }) => {
  await page.route('http://127.0.0.1:9410/**', (r) => r.abort());
  await page.goto('/');
  const row = page.locator('.estimate-row', { hasText: '57%' }).first();
  await publishUntil(page, row, pubEstimate(estimate({ confidence: 0.57 })));
  await expect(row).toContainText('stale');
  await row.click();
  await expect(page.locator('.pane-inspector')).toContainText('stale');
});

test('I5: a service restart reloads the snapshot', async ({ page }) => {
  test.setTimeout(60_000);
  let started = '1';
  const before = estimate({ confidence: 0.44, simulated: true });
  const after = estimate({ confidence: 0.46, simulated: true });
  await page.route('http://127.0.0.1:9410/health', (r) => r.fulfill({ json: { ok: true, startedNs: started } }));
  await page.route('http://127.0.0.1:9410/snapshot', (r) => r.fulfill({
    json: { estimates: [started === '1' ? before : after], evidence: [], startedNs: started } }));
  await page.goto('/');
  await expect(page.locator('.estimate-row', { hasText: '44%' })).toBeVisible();
  started = '2';
  await expect(page.locator('.estimate-row', { hasText: '46%' })).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.estimate-row', { hasText: '44%' })).toHaveCount(0);
});

test('I8: selecting a boat loads its recorded track from the service', async ({ page }) => {
  const mmsi = 999000888;
  const t = BigInt(Date.now()) * 1_000_000n;
  const points = [0n, 1n, 2n].map((i) => ({ lat: 48.3, lon: -123.5 + Number(i) * 0.001, sog: 2,
    atNs: String(t - (3n - i) * 60_000_000_000n) }));
  await page.route(`http://127.0.0.1:9410/track?*`, (r) => r.fulfill({ json: { mmsi, points } }));
  await page.goto('/');
  const ev = evidence({ mmsi, raw: { kind: 'ais-track', mmsi, fromNs: ns(), toNs: ns() } });
  await publishUntil(page, page.getByText(ev.text as string),
    () => publish('orca.evidence', 'orca.Evidence.v1', ev));
  await page.getByText(ev.text as string).click();
  await expect(page.locator('.pane-inspector')).toContainText('3 positions');
});
