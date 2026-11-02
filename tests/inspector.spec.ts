import { spawn } from 'node:child_process';
import { test, expect } from './fixtures';
import { estimate, evidence, ns, publish, publishUntil } from './bus';

const pubEvidence = (e: Record<string, unknown>) => () => publish('orca.evidence', 'orca.Evidence.v1', e);
const pubEstimate = (e: Record<string, unknown>) => () =>
  publish('orca.estimate', 'orca.Estimate.v1', { event: 'upsert', estimate: e });

test('selecting an estimate fills the inspector with its evidence', async ({ page }) => {
  await page.goto('/');
  const ev = evidence({ counted: true });
  const est = estimate({ confidence: 0.83, evidenceIds: [ev.id], operators: ['Op A', 'Op B'] });
  await publishUntil(page, page.getByText(ev.text as string), pubEvidence(ev));
  const row = page.locator('.estimate-row', { hasText: '83%' }).first();
  await publishUntil(page, row, pubEstimate(est));
  await row.click();
  const insp = page.locator('.pane-inspector');
  await expect(insp.locator('.insp-title')).toHaveText('Whales');
  await expect(insp).toContainText('83%');
  await expect(insp).toContainText('2 boats · 2 operators');
  await expect(insp.getByText(ev.text as string)).toBeVisible();
});

test('an estimate near a hydrophone with no confirmed detection says so', async ({ page }) => {
  await page.goto('/');
  const est = estimate({ confidence: 0.67, lat: 48.55, lon: -123.18 }); // beside Orcasound Lab
  const row = page.locator('.estimate-row', { hasText: '67%' }).first();
  await publishUntil(page, row, pubEstimate(est));
  await row.click();
  await expect(page.locator('.pane-inspector')).toContainText('Orcasound Lab');
  await expect(page.locator('.pane-inspector')).toContainText('no confirmed call detection');
});

test('a confirmed hydrophone detection names the species and links its audio', async ({ page }) => {
  await page.goto('/');
  const ev = evidence({ source: 'hydrophones', mmsi: null, counted: true, lat: 48.5467, lon: -123.1664,
    text: `Andrews Bay hydrophone: moderator confirmed Bigg's killer whales ${Date.now()}`,
    species: "Bigg's killer whales",
    raw: { kind: 'url', url: 'https://livemlaudiospecstorage.blob.core.windows.net/audiowavs/x.wav' } });
  const est = estimate({ confidence: 0.71, lat: 48.55, lon: -123.18, species: "Bigg's killer whales",
    evidenceIds: [ev.id] });
  await page.locator('.source-row', { hasText: 'Hydrophones' }).click(); // so the evidence is on screen
  await publishUntil(page, page.getByText(ev.text as string), pubEvidence(ev));
  const row = page.locator('.estimate-row', { hasText: '71%' }).first();
  await publishUntil(page, row, pubEstimate(est));
  await row.click();
  const insp = page.locator('.pane-inspector');
  await expect(insp.locator('.insp-title')).toHaveText("Bigg's killer whales");
  await expect(insp).toContainText('1 confirmed call detection');
  await expect(insp.getByRole('link', { name: 'Listen' }).first())
    .toHaveAttribute('href', 'https://livemlaudiospecstorage.blob.core.windows.net/audiowavs/x.wav');
});

test('clicking boat evidence drills down to the boat', async ({ page }) => {
  await page.goto('/');
  const mmsi = 999000777;
  const pos = { mmsi, name: 'TEST BOAT', lat: 48.3, lon: -123.5, sog: 2.1, cog: 90,
    lastSeenNs: ns(), simulated: true, serverId: 'orca' };
  const ev = evidence({ mmsi, raw: { kind: 'ais-track', mmsi, fromNs: ns(), toNs: ns() } });
  await publishUntil(page, page.getByText(ev.text as string), pubEvidence(ev));
  await page.getByText(ev.text as string).click();
  const insp = page.locator('.pane-inspector');
  await publishUntil(page, insp.getByText('TEST BOAT'),
    () => publish('sim.vessel.ais.position', 'vessel.ais.Position.v1', { ...pos, lastSeenNs: ns() }));
  await expect(insp).toContainText(`MMSI ${mmsi}`);
  await expect(insp).toContainText('2.1 kn');
});

test('service offline shows the banner', async ({ page }) => {
  await page.route('http://127.0.0.1:9410/**', (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('.offline-banner')).toContainText('Inference service offline');
});

test('reload restores estimates from the snapshot', async ({ page }) => {
  test.setTimeout(150_000);
  const sim = spawn(process.execPath, ['service/simulate.mjs', 'service/scenarios/race-rocks.json', '--speed', '60'],
    { stdio: 'ignore' });
  try {
    await expect(async () => {
      const snap = await (await fetch('http://127.0.0.1:9410/snapshot')).json();
      expect(snap.estimates.some((e: { status: string; simulated: boolean }) => e.status === 'active' && e.simulated)).toBe(true);
    }).toPass({ timeout: 120_000, intervals: [2000] });
    await page.goto('/');
    await page.reload();
    await expect(page.locator('.estimate-row', { hasText: 'SIMULATED' }).first()).toBeVisible({ timeout: 2000 });
  } finally {
    sim.kill();
  }
});

test('evidence links open only http(s) URLs', async ({ page }) => {
  await page.goto('/');
  const bad = evidence({ counted: true, raw: { kind: 'url', url: 'javascript:alert(1)' }, mmsi: null });
  const good = evidence({ counted: true, raw: { kind: 'url', url: 'https://example.org/post' }, mmsi: null });
  const est = estimate({ confidence: 0.71, evidenceIds: [bad.id, good.id] });
  await publishUntil(page, page.getByText(bad.text as string), pubEvidence(bad));
  await publishUntil(page, page.getByText(good.text as string), pubEvidence(good));
  const row = page.locator('.estimate-row', { hasText: '71%' }).first();
  await publishUntil(page, row, pubEstimate(est));
  await row.click();
  const insp = page.locator('.pane-inspector');
  await expect(insp.locator('.ev-item', { hasText: bad.text as string })).not.toHaveAttribute('role', 'button');
  await expect(insp.locator('.ev-item', { hasText: good.text as string })).toHaveAttribute('role', 'button');
});
