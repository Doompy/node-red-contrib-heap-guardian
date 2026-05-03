"use strict";

const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");

const { formatBytes } = require("./size");

const SNAPSHOT_KEY = "heapGuardianSnapshots";
const DEFAULT_SNAPSHOT_LIMIT = 20;

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

function readSnapshotState(globalContext) {
  const existing = globalContext && typeof globalContext.get === "function" ? globalContext.get(SNAPSHOT_KEY) : null;

  if (existing && existing.version === 1 && Array.isArray(existing.snapshots)) {
    return existing;
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    snapshots: []
  };
}

function writeSnapshotState(globalContext, state) {
  state.updatedAt = new Date().toISOString();

  if (globalContext && typeof globalContext.set === "function") {
    globalContext.set(SNAPSHOT_KEY, state);
  }
}

function createSnapshotMetadata(snapshot, memory, options = {}) {
  const filePath = snapshot && snapshot.path ? snapshot.path : "";
  const bytes = snapshot && Number.isFinite(Number(snapshot.bytes)) ? Number(snapshot.bytes) : null;
  const memoryUsage = memory && memory.memory ? memory.memory : {};

  return {
    timestamp: new Date().toISOString(),
    path: filePath,
    filename: filePath ? path.basename(filePath) : "",
    bytes,
    bytesFormatted: bytes === null ? null : formatBytes(bytes),
    heapUsed: memoryUsage.heapUsed ?? null,
    heapUsedFormatted: memoryUsage.heapUsed == null ? null : formatBytes(memoryUsage.heapUsed),
    heapTotal: memoryUsage.heapTotal ?? null,
    heapTotalFormatted: memoryUsage.heapTotal == null ? null : formatBytes(memoryUsage.heapTotal),
    rss: memoryUsage.rss ?? null,
    rssFormatted: memoryUsage.rss == null ? null : formatBytes(memoryUsage.rss),
    reason: options.reason || options.label || "snapshot"
  };
}

function recordSnapshot(globalContext, snapshot, memory, options = {}) {
  if (!snapshot || snapshot.written !== true) {
    return null;
  }

  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : DEFAULT_SNAPSHOT_LIMIT;
  const state = readSnapshotState(globalContext);
  const metadata = createSnapshotMetadata(snapshot, memory, options);

  state.snapshots = [...state.snapshots, metadata].slice(-limit);
  writeSnapshotState(globalContext, state);

  return metadata;
}

function formatDelta(value) {
  return value === null ? null : formatBytes(value);
}

function compareSnapshotMetadata(latest, baseline) {
  if (!latest || !baseline) {
    return null;
  }

  const heapUsedDelta = latest.heapUsed == null || baseline.heapUsed == null ? null : latest.heapUsed - baseline.heapUsed;
  const rssDelta = latest.rss == null || baseline.rss == null ? null : latest.rss - baseline.rss;
  const fileSizeDelta = latest.bytes == null || baseline.bytes == null ? null : latest.bytes - baseline.bytes;

  return {
    from: baseline.timestamp,
    to: latest.timestamp,
    heapUsedDelta,
    heapUsedDeltaFormatted: formatDelta(heapUsedDelta),
    rssDelta,
    rssDeltaFormatted: formatDelta(rssDelta),
    fileSizeDelta,
    fileSizeDeltaFormatted: formatDelta(fileSizeDelta)
  };
}

function getSnapshotReport(globalContext, options = {}) {
  const state = readSnapshotState(globalContext);
  const snapshots = [...state.snapshots];
  const latest = snapshots[snapshots.length - 1] || null;
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const baseline = snapshots[0] || null;
  const report = {
    totalSnapshots: snapshots.length,
    latest,
    previous,
    baseline,
    comparison: {
      previous: compareSnapshotMetadata(latest, previous),
      baseline: compareSnapshotMetadata(latest, baseline)
    },
    snapshots
  };

  if (options.snapshotDiffEnabled && latest && previous) {
    const { diffSnapshots } = require("./snapshot-diff");
    report.objectDiff = diffSnapshots(previous.path, latest.path, options);
  }

  return report;
}

module.exports = {
  SNAPSHOT_KEY,
  buildSnapshotFilePath,
  compareSnapshotMetadata,
  createSnapshotMetadata,
  getSnapshotReport,
  readSnapshotState,
  recordSnapshot,
  resolveSnapshotDirectory,
  sanitizeLabel,
  writeHeapSnapshot
};
