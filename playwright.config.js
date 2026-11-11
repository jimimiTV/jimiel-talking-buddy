import { defineConfig } from '@playwright/test';

const remote = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: 'tests',
  timeout: 20000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
    hasTouch: true,
  },
  webServer: remote
    ? undefined
    : {
        command: 'python3 -m http.server 4173 --bind 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
      },
});
