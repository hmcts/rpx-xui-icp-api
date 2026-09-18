import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const commonJsRequire = createRequire(`${process.cwd()}/test/unit/odhin-report-enhancer.test.ts`);
const { __test__ } = commonJsRequire("../../playwright_tests_new/common/reporters/odhin-report-enhancer.cjs");
const OdhinAdaptiveReporter = commonJsRequire("../../playwright_tests_new/common/reporters/odhin-adaptive.reporter.cjs");

test("links the suite-local Perfetto timeline from the generated Odhín report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "icp-odhin-"));
  const outputFolder = path.join(root, "odhin-report");
  const testResultsFolder = path.join(root, "test-results");
  fs.mkdirSync(outputFolder, { recursive: true });
  fs.mkdirSync(testResultsFolder, { recursive: true });
  fs.writeFileSync(path.join(outputFolder, "index.html"), "<html><body><div class=\"tab\"><button class=\"main-tablinks\">Tests</button></div><main>Results</main></body></html>");
  fs.writeFileSync(path.join(testResultsFolder, "perfetto.json"), "{}");

  const buildUrl = process.env.BUILD_URL;
  const artifactBaseUrl = process.env.PLAYWRIGHT_PERFETTO_ARTIFACT_BASE_URL;
  delete process.env.BUILD_URL;
  delete process.env.PLAYWRIGHT_PERFETTO_ARTIFACT_BASE_URL;
  let report = "";
  try {
    __test__.enhanceGeneratedReport(outputFolder, []);
    report = fs.readFileSync(path.join(outputFolder, "index.html"), "utf8");
  } finally {
    if (buildUrl === undefined) delete process.env.BUILD_URL;
    else process.env.BUILD_URL = buildUrl;
    if (artifactBaseUrl === undefined) delete process.env.PLAYWRIGHT_PERFETTO_ARTIFACT_BASE_URL;
    else process.env.PLAYWRIGHT_PERFETTO_ARTIFACT_BASE_URL = artifactBaseUrl;
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.match(report, /class="main-tablinks" onclick="openMainTab\(event, 'TabPerfetto'\)">Perfetto Results/);
  assert.match(report, /id="TabPerfetto" style="display: none" class="main-tabcontent"/);
  assert.match(report, /href="\.\.\/test-results\/perfetto\.json"/);
});

test("always keeps Odhín attachments external", () => {
  let receivedOptions: Record<string, unknown> | undefined;
  new OdhinAdaptiveReporter({
    embedAttachments: true,
    createInnerReporter: (options: Record<string, unknown>) => {
      receivedOptions = options;
      return {};
    },
  });

  assert.equal(receivedOptions?.embedAttachments, false);
});
