import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "panel.spec.mjs",
  workers: 1,
  timeout: 30000,
  reporter: "list",
  outputDir: "/tmp/omc-panel-playwright-results",
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: process.env.OMC_BROWSER_EXECUTABLE
      ? { executablePath: process.env.OMC_BROWSER_EXECUTABLE }
      : {},
  },
});
