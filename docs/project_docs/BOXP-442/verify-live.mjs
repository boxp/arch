// From repository root after promotion: npm install --prefix apps/portfolio --no-save --package-lock=false playwright
// node docs/project_docs/BOXP-442/verify-live.mjs (NODE_PATH is not used by ESM).
// Set PLAYWRIGHT_MODULE to the absolute path to playwright/index.mjs if installed elsewhere.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const modulePath = process.env.PLAYWRIGHT_MODULE || resolve('apps/portfolio/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const base = 'https://b0xp.io/';
let failed = false;
try {
  for (const [label, viewport] of [['PC', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, colorScheme: 'light', isMobile: label === 'mobile', hasTouch: label === 'mobile' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    try {
      assert.equal((await page.goto(base, { waitUntil: 'networkidle' })).status(), 200);
      assert.ok(await page.locator('#experience').isVisible());
      const trigger = page.locator('[data-theme-trigger]');
      await trigger.focus(); await page.keyboard.press('Enter');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('End'); await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'dark');
      await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await trigger.click(); await page.locator('[data-theme-choice="system"]').click();
      assert.equal(await page.evaluate(() => localStorage.getItem('theme')), null);
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await trigger.click(); await page.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('a[href="https://lolice-lineage.b0xp.io/"]').count(), 1);
      const architecture = await page.locator('a[href="https://lolice-architecture.b0xp.io/"]').count();
      assert.equal(architecture, 1, 'Both accepted diagram cards must be public');
      for (const img of await page.locator('img').all()) {
        // Lazy images load after entering the viewport, especially on mobile.
        await img.scrollIntoViewIfNeeded();
        await page.waitForFunction(src => Array.from(document.images).some(el => el.getAttribute('src') === src && el.complete && el.naturalWidth > 0), await img.getAttribute('src'));
      }
      assert.deepEqual(errors, []);
      console.log(`${label}: OK`);
    } catch (e) { failed = true; console.error(`${label}:`, e); }
    await context.close();
  }
  for (const url of ['https://lolice-lineage.b0xp.io/', 'https://lolice-architecture.b0xp.io/']) {
    const response = await fetch(url, { redirect: 'follow' });
    console.log(`${url} HTTP ${response.status}`);
    if (!response.ok) failed = true;
  }
} finally { await browser.close(); }
if (failed) process.exitCode = 1;
