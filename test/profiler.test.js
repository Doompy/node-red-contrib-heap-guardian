"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProfilerReport,
  getProfilerReport,
  recordProfile
} = require("../lib/profiler");

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

test("recordProfile aggregates profiler records", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profiler",
    nodeType: "payload-profiler"
  };

  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 10,
    type: "string"
  });

  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 20,
    type: "string"
  });

  const report = getProfilerReport(context);

  assert.equal(report.totalRecords, 1);
  assert.equal(report.records[0].count, 2);
  assert.equal(report.records[0].lastBytes, 20);
  assert.equal(report.records[0].maxBytes, 20);
  assert.equal(report.records[0].totalBytes, 30);
});

test("clearProfilerReport removes records", () => {
  const context = createContext();

  recordProfile(context, {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profiler",
    nodeType: "payload-profiler"
  }, {
    kind: "payload",
    property: "payload",
    bytes: 10,
    type: "string"
  });

  clearProfilerReport(context);

  assert.equal(getProfilerReport(context).totalRecords, 0);
});
