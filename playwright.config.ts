// End-to-end tests in a real browser (D38). Uses the installed Microsoft Edge, so no browser download is
// needed; set PW_CHANNEL=chrome (or "chromium" after `npx playwright install chromium`) to use another.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    viewport: { width: 1100, height: 800 },
    serviceWorkers: 'block', // test the app itself, not the offline cache
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
