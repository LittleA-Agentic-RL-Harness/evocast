import { defineConfig, devices } from "@playwright/test";

// Browser tests in demo mode (no keys, no database): the whole path from a dropped PDF to a
// finished episode, and every screen's layout, on three engines and two phones. Run
// `npm run build` first; CI does.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: { command: "npm run start -- -p 3100", url: "http://localhost:3100", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  // Chrome, Safari's engine and Firefox on a desktop; an Android phone and an iPhone.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "safari", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});
