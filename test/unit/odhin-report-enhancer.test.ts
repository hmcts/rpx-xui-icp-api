import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { __test__ } from '../../playwright_tests_new/common/reporters/odhin-report-enhancer.cjs';

test('links the suite-local Perfetto timeline from the generated Odhín report', () => {
  const outputFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'icp-odhin-'));
  const testResultsFolder = path.join(outputFolder, '..', 'test-results');
  fs.mkdirSync(testResultsFolder, { recursive: true });
  fs.writeFileSync(path.join(outputFolder, 'index.html'), '<html><body><main>Results</main></body></html>');
  fs.writeFileSync(path.join(testResultsFolder, 'perfetto.json'), '{}');

  __test__.enhanceGeneratedReport(outputFolder, []);

  const report = fs.readFileSync(path.join(outputFolder, 'index.html'), 'utf8');
  assert.match(report, /id="odhin-perfetto-link"/);
  assert.match(report, /href="\.\.\/test-results\/perfetto\.json"/);
});
