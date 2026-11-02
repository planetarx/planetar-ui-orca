import { test, expect } from './fixtures';
import { estimate, evidence, publish, publishUntil } from './bus';

const pubEvidence = (e: Record<string, unknown>) => () => publish('orca.evidence', 'orca.Evidence.v1', e);
const pubEstimate = (e: Record<string, unknown>) => () =>
  publish('orca.estimate', 'orca.Estimate.v1', { event: 'upsert', estimate: e });

test('boat evidence appears in the boats stream', async ({ page }) => {
  await page.goto('/');
  const ev = evidence();
  await publishUntil(page, page.locator('.pane-stream').getByText(ev.text as string), pubEvidence(ev));
});

test('uncounted evidence shows its reason', async ({ page }) => {
  await page.goto('/');
  const ev = evidence({ reason: 'in harbour: Inner Harbour' });
  const item = page.locator('.ev-item', { hasText: ev.text as string });
  await publishUntil(page, item, pubEvidence(ev));
  await expect(item).toContainText('in harbour: Inner Harbour');
  await expect(item).toHaveClass(/ev-ignored/);
});

test('selecting an estimate shows only its evidence', async ({ page }) => {
  await page.goto('/');
  const mine = evidence({ counted: true });
  const other = evidence();
  const est = estimate({ evidenceIds: [mine.id] });
  await publishUntil(page, page.getByText(other.text as string), pubEvidence(other));
  await publishUntil(page, page.getByText(mine.text as string), pubEvidence(mine));
  const row = page.locator('.estimate-row', { hasText: '78%' }).first();
  await publishUntil(page, row, pubEstimate(est));
  await row.click();
  await expect(page.locator('.pane-stream').getByText(mine.text as string)).toBeVisible();
  await expect(page.locator('.pane-stream').getByText(other.text as string)).toHaveCount(0);
});

test('disconnected source shows not connected', async ({ page }) => {
  await page.goto('/');
  await page.locator('.source-row', { hasText: 'VHF radio' }).click();
  await expect(page.locator('.pane-stream')).toContainText('Not connected yet');
  await expect(page.locator('.source-row', { hasText: 'VHF radio' })).toHaveClass(/source-off/);
});

test('hydrophones list sites with live audio links', async ({ page }) => {
  await page.goto('/');
  await page.locator('.source-row', { hasText: 'Hydrophones' }).click();
  const link = page.getByRole('link', { name: /Orcasound Lab/ });
  await expect(link).toHaveAttribute('href', 'https://live.orcasound.net/listen/orcasound-lab');
});

test('hydrophone detections list above the sites', async ({ page }) => {
  await page.goto('/');
  const text = `Bush Point hydrophone: OrcaHello flagged possible calls (81%) ${Date.now()}`;
  const ev = evidence({ source: 'hydrophones', mmsi: null, text, reason: 'awaiting moderator review' });
  await page.locator('.source-row', { hasText: 'Hydrophones' }).click();
  const stream = page.locator('.pane-stream');
  await publishUntil(page, stream.getByText(text), () => publish('orca.evidence', 'orca.Evidence.v1', ev));
  await expect(stream).toContainText('awaiting moderator review');
  await expect(stream.getByRole('link', { name: /Orcasound Lab/ })).toBeVisible();
});

test('simulated evidence is tagged', async ({ page }) => {
  await page.goto('/');
  const ev = evidence({ simulated: true });
  const item = page.locator('.ev-item', { hasText: ev.text as string });
  await publishUntil(page, item, pubEvidence(ev));
  await expect(item.locator('.tag-sim')).toHaveText('SIMULATED');
});

test('a boat-only estimate is labelled Whales, never Orca', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.estimate-row', { hasText: '61%' }).first();
  await publishUntil(page, row, pubEstimate(estimate({ confidence: 0.61 })));
  await expect(row).toContainText('Whales');
  await expect(row).not.toContainText(/orca/i);
});

test('a republished evidence item replaces the earlier one', async ({ page }) => {
  await page.goto('/');
  const ev = evidence({ reason: '1 boat, below minimum of 2' });
  const item = page.locator('.pane-stream .ev-item', { hasText: ev.text as string });
  await publishUntil(page, item, pubEvidence(ev));
  await expect(item).toHaveClass(/ev-ignored/);
  await publishUntil(page, item.locator('.tag-est'), pubEvidence({ ...ev, counted: true, reason: null }));
  await expect(item).toHaveCount(1);
  await expect(item).not.toHaveClass(/ev-ignored/);
});
