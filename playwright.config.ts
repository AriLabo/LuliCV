import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-studio',
  fullyParallel: false,
  ...(process.env.CI ? { snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{platform}-ci{ext}' } : {}),
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5177',
    viewport: { width: 1600, height: 1000 },
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5177',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: true,
  },
});
