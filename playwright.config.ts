import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // E2E_TEST=true activates the proxy.ts auth bypass so mocked pages render
    // (never active in production — guarded by NODE_ENV in proxy.ts).
    command: "E2E_TEST=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
