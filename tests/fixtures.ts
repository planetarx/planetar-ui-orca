// Playwright fixtures: bundled Chromium only (never attach to the founder's
// own Chrome). Each test starts with the persisted layout cleared.

import { test as base, expect } from '@playwright/test';
import { endPublished } from './bus';

export const LAYOUT_KEY = 'planetar-ui-orca-layout';

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.goto('/');
    await page.evaluate((k) => localStorage.removeItem(k), LAYOUT_KEY);
    await provide(page);
    await endPublished();
  },
});

export { expect };
