"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { diffSnapshots } = require("../lib/snapshot-diff");
const {
  buildSnapshotFilePath,
  compareSnapshotMetadata,
  getSnapshotReport,
  recordSnapshot,
  sanitizeLabel
} = require("../lib/snapshot");

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

test("sanitizeLabel creates filesystem-friendly labels", () => {
  assert.equal(sanitizeLabel("heap leak / flow:1"), "heap-leak-flow-1");
  assert.equal(sanitizeLabel(""), "snapshot");
});

test("buildSnapshotFilePath creates a heapsnapshot path", () => {
  const filePath = buildSnapshotFilePath({
    directory: "snapshots",
    label: "test label",
    date: new Date("2026-05-03T00:00:00.000Z"),
    pid: 123
  });

  assert.equal(path.basename(filePath), "heap-guardian-test-label-2026-05-03T00-00-00-000Z-123.heapsnapshot");
  assert.equal(path.extname(filePath), ".heapsnapshot");
});

test("recordSnapshot stores metadata and comparisons", () => {
  const context = createContext();

  recordSnapshot(context, {
    written: true,
    path: path.join("tmp", "a.heapsnapshot"),
    bytes: 1000
  }, {
    memory: {
      heapUsed: 100,
      heapTotal: 200,
      rss: 300
    }
  }, {
    reason: "baseline"
  });

  recordSnapshot(context, {
    written: true,
    path: path.join("tmp", "b.heapsnapshot"),
    bytes: 1600
  }, {
    memory: {
      heapUsed: 250,
      heapTotal: 300,
      rss: 450
    }
  }, {
    reason: "latest"
  });

  const report = getSnapshotReport(context);

  assert.equal(report.totalSnapshots, 2);
  assert.equal(report.latest.filename, "b.heapsnapshot");
  assert.equal(report.comparison.previous.heapUsedDelta, 150);
  assert.equal(report.comparison.baseline.fileSizeDelta, 600);
});

test("compareSnapshotMetadata returns null without two snapshots", () => {
  assert.equal(compareSnapshotMetadata(null, null), null);
});

test("diffSnapshots returns constructor self-size deltas", () => {
  const previousPath = path.join(__dirname, "fixtures", "snapshot-a.heapsnapshot");
  const latestPath = path.join(__dirname, "fixtures", "snapshot-b.heapsnapshot");
  const diff = diffSnapshots(previousPath, latestPath, {
    maxSnapshotDiffBytes: 1024 * 1024,
    snapshotDiffLimit: 5
  });

  assert.equal(diff.enabled, true);
  assert.ok(diff.topGrowing.some((row) => row.name === "Array" && row.selfSizeDelta > 0));
});

test("diffSnapshots returns structured skip results", () => {
  const previousPath = path.join(__dirname, "fixtures", "snapshot-a.heapsnapshot");
  const latestPath = path.join(__dirname, "fixtures", "snapshot-b.heapsnapshot");
  const missing = diffSnapshots("missing-a.heapsnapshot", "missing-b.heapsnapshot");
  const tooLarge = diffSnapshots(previousPath, latestPath, {
    maxSnapshotDiffBytes: 1
  });

  assert.equal(missing.enabled, false);
  assert.equal(missing.reason, "snapshot-file-missing");
  assert.equal(tooLarge.enabled, false);
  assert.equal(tooLarge.reason, "snapshot-too-large");
});
