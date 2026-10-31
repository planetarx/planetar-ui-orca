import { test, expect } from './fixtures';

test('loads the shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle('planetar-ui-orca');
  expect(errors).toEqual([]);
});

test('three panes visible by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pane-sources')).toBeVisible();
  await expect(page.locator('.pane-stream')).toBeVisible();
  await expect(page.locator('.pane-map')).toBeVisible();
  await expect(page.locator('.pane-inspector')).toBeVisible();
});

test('collapse handles hide and restore each left pane', async ({ page }) => {
  await page.goto('/');
  for (const pane of ['sources', 'stream']) {
    await page.getByRole('button', { name: `Collapse ${pane}` }).click();
    await expect(page.locator(`.pane-${pane}`)).toHaveCount(0);
    await page.getByRole('button', { name: `Expand ${pane}` }).click();
    await expect(page.locator(`.pane-${pane}`)).toBeVisible();
  }
});

test('keyboard shortcuts toggle panes', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.pane-sources')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+C');
  await expect(page.locator('.pane-stream')).toHaveCount(0);
  await expect(page.locator('.pane-map')).toBeVisible();
  await page.keyboard.press('Control+Shift+0');
  await expect(page.locator('.pane-sources')).toBeVisible();
  await expect(page.locator('.pane-stream')).toBeVisible();
});

test('help overlay opens and closes', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+Shift+?');
  await expect(page.locator('.help-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-panel')).toHaveCount(0);
});

test('collapsed state survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sources' }).click();
  await page.reload();
  await expect(page.locator('.pane-sources')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand sources' })).toBeVisible();
});

test('map stays mounted when a pane collapses', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.evaluate((el) => el.setAttribute('data-probe', 'same'));
  await page.getByRole('button', { name: 'Collapse sources' }).click();
  await expect(page.locator('.maplibregl-canvas[data-probe="same"]')).toHaveCount(1);
});
