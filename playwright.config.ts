import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:5199" },
  // the dev server is needed (not preview): the test hook window.__bb only exists in dev builds
  webServer: { command: "npx vite --port 5199 --strictPort", url: "http://localhost:5199", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
