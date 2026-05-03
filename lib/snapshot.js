"use strict";

const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");

const { formatBytes } = require("./size");

function sanitizeLabel(value) {
  return String(value || "snapshot")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

function makeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function resolveSnapshotDirectory(directory) {
  const selected = directory || process.env.HEAP_GUARDIAN_SNAPSHOT_DIR || path.join(process.cwd(), "heap-snapshots");
  return path.resolve(selected);
}

function buildSnapshotFilePath(options = {}) {
  const directory = resolveSnapshotDirectory(options.directory);
  const label = sanitizeLabel(options.label);
  const timestamp = makeTimestamp(options.date);
  const pid = Number.isFinite(Number(options.pid)) ? Number(options.pid) : process.pid;

  return path.join(directory, `heap-guardian-${label}-${timestamp}-${pid}.heapsnapshot`);
}

function writeHeapSnapshot(options = {}) {
  if (typeof v8.writeHeapSnapshot !== "function") {
    return {
      written: false,
      reason: "writeHeapSnapshot-unavailable"
    };
  }

  const filePath = buildSnapshotFilePath(options);
  const directory = path.dirname(filePath);
  const startedAt = Date.now();

  fs.mkdirSync(directory, { recursive: true });

  const writtenPath = v8.writeHeapSnapshot(filePath);
  const stats = fs.statSync(writtenPath);

  return {
    written: true,
    path: writtenPath,
    directory,
    bytes: stats.size,
    bytesFormatted: formatBytes(stats.size),
    durationMs: Date.now() - startedAt
  };
}

module.exports = {
  buildSnapshotFilePath,
  resolveSnapshotDirectory,
  sanitizeLabel,
  writeHeapSnapshot
};
