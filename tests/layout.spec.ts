import { test, expect } from './fixtures';

test('loads the shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle('planetar-ui-orca');
  expect(errors).toEqual([]);
});
