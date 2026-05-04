"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMetricsReport,
  createPrometheusMetrics,
  escapeLabelValue
} = require("../lib/metrics");
const { recordProfile } = require("../lib/profiler");

function createContext() {
  const store = new Map();

  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
    }
  };
}

test("escapeLabelValue escapes Prometheus label values", () => {
  assert.equal(escapeLabelValue("a\"b\\c\n"), "a\\\"b\\\\c\\n");
});

test("createPrometheusMetrics includes memory and profiler metrics", () => {
  const context = createContext();

  recordProfile(context, {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "big node",
    nodeType: "function"
  }, {
    kind: "runtime-payload",
    scope: "send",
    property: "payload",
    bytes: 1024,
    type: "object"
  });

  const report = createMetricsReport(context, { limit: 10 });
  const text = createPrometheusMetrics(report);

  assert.equal(report.profiler.analysis.topGrowers.length, 0);
  assert.equal(report.dashboard.status, "info");
  assert.equal(report.summary.profiler.overhead.recordCount, 1);
  assert.equal(report.snapshots.diffStatus, "idle");
  assert.match(text, /heap_guardian_memory_bytes\{type="heap_used"\}/);
  assert.match(text, /heap_guardian_profiler_records 1/);
  assert.match(text, /heap_guardian_profiler_alerts\{severity="warning"\} 0/);
  assert.match(text, /heap_guardian_profiler_suspects /);
  assert.match(text, /heap_guardian_profiler_trends /);
  assert.match(text, /heap_guardian_profiler_record_bytes\{.*flow="Flow 1"/);
});

test("createPrometheusMetrics can omit labeled profiler record metrics", () => {
  const context = createContext();

  recordProfile(context, {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "big node",
    nodeType: "function"
  }, {
    kind: "runtime-payload",
    scope: "send",
    property: "payload",
    bytes: 1024,
    type: "object"
  });

  const report = createMetricsReport(context, { limit: 10 });
  const text = createPrometheusMetrics(report, { includeProfilerRecordMetrics: false });

  assert.match(text, /heap_guardian_profiler_alerts/);
  assert.doesNotMatch(text, /heap_guardian_profiler_record_bytes/);
});
