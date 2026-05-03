"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(projectRoot, filePath), "utf8");
}

test("new 0.2.0 numeric editor fields are optional for imported flows", () => {
  const metricsHtml = readProjectFile(path.join("nodes", "metrics-report.html"));
  const autoGcHtml = readProjectFile(path.join("nodes", "auto-gc-guard.html"));

  [
    "maxPrometheusRecords",
    "maxSnapshotDiffBytes",
    "snapshotDiffTimeoutMs"
  ].forEach((field) => {
    assert.match(
      metricsHtml,
      new RegExp(`${field}: \\{ value: .*validate: RED\\.validators\\.number\\(true\\) \\}`)
    );
  });

  [
    "threshold",
    "cooldownSeconds",
    "maxRunsPerHour"
  ].forEach((field) => {
    assert.match(
      autoGcHtml,
      new RegExp(`${field}: \\{ value: .*validate: RED\\.validators\\.number\\(true\\) \\}`)
    );
  });
});

test("leak lab metrics nodes include 0.2.0 default fields", () => {
  const flow = JSON.parse(readProjectFile(path.join("examples", "heap-leak-lab-flow.json")));
  const metricsNodes = flow.filter((node) => node.type === "metrics-report");

  assert.ok(metricsNodes.length >= 3);

  metricsNodes.forEach((node) => {
    assert.equal(node.includeProfilerRecordMetrics, true);
    assert.equal(node.maxPrometheusRecords, 20);
    assert.equal(node.snapshotDiffEnabled, false);
    assert.equal(node.maxSnapshotDiffBytes, 134217728);
    assert.equal(node.snapshotDiffTimeoutMs, 30000);
  });
});
