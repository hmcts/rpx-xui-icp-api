import { defineConfig } from "@playwright/test";
import { execSync } from "node:child_process";
import { cpus, totalmem } from "node:os";

type EnvMap = NodeJS.ProcessEnv;
const appVersion = process.env.npm_package_version ?? "0.0.1";

const resolveBranchName = (env: EnvMap): string => {
  const configured = env.PLAYWRIGHT_REPORT_BRANCH ?? env.CHANGE_BRANCH ?? env.BRANCH_NAME ?? env.GITHUB_HEAD_REF;
  if (configured) {
    return configured.replace(/^(?:refs\/heads\/|origin\/)/, "").trim();
  }

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch {
    // Keep local report generation independent of Git metadata.
  }

  return "local";
};

const resolveEnvironment = (env: EnvMap): string => {
  try {
    const hostname = new URL(env.PLAYWRIGHT_BASE_URL ?? env.TEST_URL ?? "http://localhost:8080").hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "local";
    }
    return ["aat", "ithc", "demo", "perftest"].find((environment) => hostname.includes(`.${environment}.`)) ?? hostname;
  } catch {
    return "unknown";
  }
};

const workerCount = 1;
const odhinOutputFolder = process.env.PLAYWRIGHT_REPORT_FOLDER ?? "functional-output/tests/playwright-functional/odhin-report";
const odhinIndexFilename = process.env.PLAYWRIGHT_REPORT_INDEX_FILENAME ?? "xui-playwright-functional.html";
const targetEnvironment = process.env.TEST_TYPE ?? resolveEnvironment(process.env);
const reportContext = `${targetEnvironment} | ${process.env.CI ? "ci" : "local-run"} | workers=${workerCount} | agent_cpu_cores=${cpus().length} | agent_ram_gib=${Math.round((totalmem() / 1024 ** 3) * 10) / 10}`;

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
    [process.env.CI ? "dot" : "list"],
    [
      "./playwright_tests_new/common/reporters/odhin-progress.reporter.cjs",
      { enabled: Boolean(process.env.CI), graceMs: 1_500, intervalMs: 5_000, forceExitOnCompletion: Boolean(process.env.CI) },
    ],
    [
      "./playwright_tests_new/common/reporters/odhin-adaptive.reporter.cjs",
      {
        outputFolder: odhinOutputFolder,
        indexFilename: odhinIndexFilename,
        title: process.env.PLAYWRIGHT_REPORT_TITLE ?? "RPX XUI ICP API Playwright Functional",
        testEnvironment: reportContext,
        project: process.env.PLAYWRIGHT_REPORT_PROJECT ?? "RPX XUI ICP API",
        release: process.env.PLAYWRIGHT_REPORT_RELEASE ?? `${appVersion} | branch=${resolveBranchName(process.env)}`,
        startServer: false,
        consoleLog: Boolean(process.env.CI),
        consoleError: Boolean(process.env.CI),
        testOutput: "only-on-failure",
      },
    ],
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
