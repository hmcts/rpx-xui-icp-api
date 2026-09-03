import { defineConfig } from "@playwright/test";

const functionalSpecPattern = "playwright_tests/functional/**/*.spec.ts";

export default defineConfig({
  testDir: ".",
  testMatch: [functionalSpecPattern],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: process.env.PLAYWRIGHT_TEST_OUTPUT_DIR ?? "functional-output/tests/playwright-functional/test-results",
  reporter: [
    ["list"],
    [
      "junit",
      {
        outputFile:
          process.env.PLAYWRIGHT_JUNIT_OUTPUT ??
          "functional-output/tests/playwright-functional/playwright-functional-result.xml",
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.TEST_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "functional", testMatch: [functionalSpecPattern] }],
});
