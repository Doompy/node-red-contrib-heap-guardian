"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildSnapshotFilePath,
  sanitizeLabel
} = require("../lib/snapshot");

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
