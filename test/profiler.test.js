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
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });

  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 20,
    type: "string"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });

  const report = getProfilerReport(context);

  assert.equal(report.totalRecords, 1);
  assert.equal(report.records[0].count, 2);
  assert.equal(report.records[0].previousBytes, 10);
  assert.equal(report.records[0].lastBytes, 20);
  assert.equal(report.records[0].maxBytes, 20);
  assert.equal(report.records[0].totalBytes, 30);
  assert.equal(report.records[0].deltaBytes, 10);
  assert.equal(report.records[0].deltaPercent, 100);
  assert.equal(report.records[0].sampleIntervalMs, 60000);
  assert.equal(report.records[0].growthRateBytesPerMinute, 10);
});

test("recordProfile uses null-safe growth values for the first sample", () => {
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
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });

  const [record] = getProfilerReport(context).records;

  assert.equal(record.previousBytes, null);
  assert.equal(record.deltaBytes, 0);
  assert.equal(record.deltaPercent, null);
  assert.equal(record.sampleIntervalMs, null);
  assert.equal(record.growthRateBytesPerMinute, null);
});

test("recordProfile keeps bounded history", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profiler",
    nodeType: "payload-profiler"
  };

  [10, 20, 40].forEach((bytes, index) => {
    recordProfile(context, meta, {
      kind: "payload",
      property: "payload",
      bytes,
      type: "object"
    }, {
      historyLimit: 2,
      now: new Date(`2026-05-03T00:0${index}:00.000Z`)
    });
  });

  const [record] = getProfilerReport(context).records;

  assert.equal(record.history.length, 2);
  assert.equal(record.history[0].bytes, 20);
  assert.equal(record.history[1].bytes, 40);
});

test("getProfilerReport analysis returns top growers sorted by delta", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "node one",
    nodeType: "function"
  };
  const secondMeta = {
    ...meta,
    nodeId: "node-2",
    nodeName: "node two"
  };

  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 10,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 30,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });
  recordProfile(context, secondMeta, {
    kind: "payload",
    property: "payload",
    bytes: 10,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  recordProfile(context, secondMeta, {
    kind: "payload",
    property: "payload",
    bytes: 50,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });

  const report = getProfilerReport(context, { limit: 10 });

  assert.equal(report.analysis.topGrowers.length, 2);
  assert.equal(report.analysis.topGrowers[0].nodeName, "node two");
  assert.equal(report.analysis.topGrowers[0].deltaBytes, 40);
  assert.equal(report.analysis.topGrowers[1].nodeName, "node one");
  assert.equal(report.analysis.topGrowers[1].deltaBytes, 20);
});

test("getProfilerReport analysis returns top payload keys and suspects", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profile payload",
    nodeType: "payload-profiler"
  };

  recordProfile(context, meta, {
    kind: "payload-key",
    property: "payload.items",
    contextKey: "items",
    bytes: 100,
    type: "array"
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  recordProfile(context, meta, {
    kind: "payload-key",
    property: "payload.items",
    contextKey: "items",
    bytes: 1000,
    type: "array"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });

  const report = getProfilerReport(context, { limit: 10 });

  assert.equal(report.analysis.topPayloadKeys.length, 1);
  assert.equal(report.analysis.topPayloadKeys[0].property, "payload.items");
  assert.equal(report.analysis.topPayloadKeys[0].deltaBytes, 900);
  assert.equal(report.analysis.suspects[0].property, "payload.items");
  assert.match(report.analysis.suspects[0].summary, /payload\.items grew by/);
  assert.ok(["info", "warning", "critical"].includes(report.analysis.suspects[0].severity));
  assert.ok(report.analysis.suspects[0].reasons.includes("payload-key"));
});

test("getProfilerReport analysis returns context growers", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profile context",
    nodeType: "context-profiler"
  };

  recordProfile(context, meta, {
    kind: "context",
    scope: "global",
    property: "cache",
    contextKey: "cache",
    bytes: 1024,
    type: "array"
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  recordProfile(context, meta, {
    kind: "context",
    scope: "global",
    property: "cache",
    contextKey: "cache",
    bytes: 4096,
    type: "array"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });

  const report = getProfilerReport(context, { limit: 10 });
  const [grower] = report.analysis.topContextGrowers;
  const [trend] = report.analysis.topContextTrends;

  assert.equal(grower.kind, "context");
  assert.equal(grower.contextKey, "cache");
  assert.equal(grower.deltaBytes, 3072);
  assert.equal(trend.contextKey, "cache");
  assert.equal(report.dashboard.tables.contextTrends[0].contextKey, "cache");
});

test("getProfilerReport analysis returns trends and alerts", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profile context",
    nodeType: "context-profiler"
  };

  [1, 2, 3, 4].forEach((mb, index) => {
    recordProfile(context, meta, {
      kind: "context",
      scope: "global",
      property: "heapGuardianLeak",
      contextKey: "heapGuardianLeak",
      bytes: mb * 1024 * 1024,
      type: "array"
    }, {
      now: new Date(`2026-05-03T00:0${index}:00.000Z`)
    });
  });

  const report = getProfilerReport(context, { limit: 10 });
  const [trend] = report.analysis.topTrends;
  const [alert] = report.analysis.alerts;

  assert.equal(trend.contextKey, "heapGuardianLeak");
  assert.equal(trend.consecutiveGrowthCount, 3);
  assert.equal(trend.totalGrowthBytes, 3 * 1024 * 1024);
  assert.equal(alert.severity, "warning");
  assert.equal(alert.kind, "context-growth");
  assert.match(alert.summary, /heapGuardianLeak grew by 3MB/);
  assert.equal(report.dashboard.status, "warning");
});

test("getProfilerReport analysis compares runtime send and receive payload sizes", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "expanding function",
    nodeType: "function"
  };

  recordProfile(context, meta, {
    kind: "runtime-payload",
    scope: "receive",
    direction: "receive",
    property: "payload",
    bytes: 2048,
    type: "object"
  });
  recordProfile(context, meta, {
    kind: "runtime-payload",
    scope: "send",
    direction: "send",
    property: "payload[out:0]",
    port: 0,
    bytes: 8192,
    type: "object"
  });

  const report = getProfilerReport(context, { limit: 10 });
  const [expander] = report.analysis.topExpanders;

  assert.equal(expander.nodeName, "expanding function");
  assert.equal(expander.property, "payload");
  assert.equal(expander.sendProperty, "payload[out:0]");
  assert.equal(expander.receiveBytes, 2048);
  assert.equal(expander.sendBytes, 8192);
  assert.equal(expander.deltaBytes, 6144);
  assert.equal(expander.expansionRatio, 4);
  assert.equal(expander.ratioStatus, "calculated");
  assert.equal(report.analysis.suspects[0].category, "runtime-expansion");
  assert.match(report.analysis.suspects[0].summary, /sends payload/);
});

test("getProfilerReport suppresses unreliable expander ratios", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "expanding function",
    nodeType: "function"
  };

  recordProfile(context, meta, {
    kind: "runtime-payload",
    scope: "receive",
    direction: "receive",
    property: "payload",
    bytes: 42,
    type: "object"
  });
  recordProfile(context, meta, {
    kind: "runtime-payload",
    scope: "send",
    direction: "send",
    property: "payload[out:0]",
    port: 0,
    bytes: 4096,
    type: "object"
  });

  const [expander] = getProfilerReport(context, { limit: 10 }).analysis.topExpanders;

  assert.equal(expander.receiveBytes, 42);
  assert.equal(expander.expansionRatio, null);
  assert.equal(expander.ratioStatus, "receive-below-threshold");
});

test("getProfilerReport analysis keeps ratio null when receive is missing", () => {
  const context = createContext();

  recordProfile(context, {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "inject",
    nodeType: "inject"
  }, {
    kind: "runtime-payload",
    scope: "send",
    direction: "send",
    property: "payload[out:0]",
    port: 0,
    bytes: 5000,
    type: "object"
  });

  const [expander] = getProfilerReport(context, { limit: 10 }).analysis.topExpanders;

  assert.equal(expander.receiveBytes, null);
  assert.equal(expander.deltaBytes, 5000);
  assert.equal(expander.expansionRatio, null);
  assert.equal(expander.ratioStatus, "missing-receive");
});

test("getProfilerReport filters small runtime expanders", () => {
  const context = createContext();

  recordProfile(context, {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "inject",
    nodeType: "inject"
  }, {
    kind: "runtime-payload",
    scope: "send",
    direction: "send",
    property: "payload[out:0]",
    port: 0,
    bytes: 512,
    type: "object"
  });

  assert.equal(getProfilerReport(context, { limit: 10 }).analysis.topExpanders.length, 0);
});

test("getProfilerReport supports record filters", () => {
  const context = createContext();
  const meta = {
    flowId: "flow-1",
    flowName: "Flow 1",
    nodeId: "node-1",
    nodeName: "profile payload",
    nodeType: "payload-profiler"
  };

  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 100,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:00:00.000Z")
  });
  recordProfile(context, meta, {
    kind: "payload",
    property: "payload",
    bytes: 500,
    type: "object"
  }, {
    now: new Date("2026-05-03T00:01:00.000Z")
  });
  recordProfile(context, meta, {
    kind: "context",
    scope: "global",
    property: "cache",
    contextKey: "cache",
    bytes: 1000,
    type: "array"
  });

  const report = getProfilerReport(context, {
    kind: "payload",
    minDeltaBytes: 200,
    limit: 10
  });

  assert.equal(report.totalRecords, 2);
  assert.equal(report.matchedRecords, 1);
  assert.equal(report.records[0].kind, "payload");
  assert.equal(report.records[0].deltaBytes, 400);
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
