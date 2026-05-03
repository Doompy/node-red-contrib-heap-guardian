"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_SNAPSHOT_DIFF_BYTES = 128 * 1024 * 1024;
const DEFAULT_SNAPSHOT_DIFF_TIMEOUT_MS = 30000;

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

function diffSnapshots(previousPath, latestPath, options = {}) {
  const maxSnapshotDiffBytes = Number.isFinite(Number(options.maxSnapshotDiffBytes))
    ? Math.max(0, Number(options.maxSnapshotDiffBytes))
    : DEFAULT_MAX_SNAPSHOT_DIFF_BYTES;
  const timeoutMs = Number.isFinite(Number(options.snapshotDiffTimeoutMs))
    ? Math.max(1, Number(options.snapshotDiffTimeoutMs))
    : DEFAULT_SNAPSHOT_DIFF_TIMEOUT_MS;
  const limit = Number.isFinite(Number(options.snapshotDiffLimit)) ? Math.max(1, Number(options.snapshotDiffLimit)) : 20;

  if (!previousPath || !latestPath) {
    return {
      enabled: false,
      reason: "missing-snapshot-path"
    };
  }

  if (!fs.existsSync(previousPath) || !fs.existsSync(latestPath)) {
    return {
      enabled: false,
      reason: "snapshot-file-missing"
    };
  }

  const previousBytes = fileSize(previousPath);
  const latestBytes = fileSize(latestPath);

  if (previousBytes > maxSnapshotDiffBytes || latestBytes > maxSnapshotDiffBytes) {
    return {
      enabled: false,
      reason: "snapshot-too-large",
      maxSnapshotDiffBytes,
      previousBytes,
      latestBytes
    };
  }

  const workerPath = path.join(__dirname, "snapshot-diff-worker.js");
  let output;

  try {
    output = execFileSync(process.execPath, [workerPath, previousPath, latestPath, String(limit)], {
      encoding: "utf8",
      timeout: timeoutMs
    });
  } catch (error) {
    return {
      enabled: false,
      reason: error.killed || error.signal === "SIGTERM" ? "snapshot-diff-timeout" : "snapshot-diff-failed",
      error: error.message
    };
  }

  try {
    return {
      enabled: true,
      ...JSON.parse(output)
    };
  } catch (error) {
    return {
      enabled: false,
      reason: "snapshot-diff-parse-failed",
      error: error.message
    };
  }
}

module.exports = {
  DEFAULT_MAX_SNAPSHOT_DIFF_BYTES,
  DEFAULT_SNAPSHOT_DIFF_TIMEOUT_MS,
  diffSnapshots
};
