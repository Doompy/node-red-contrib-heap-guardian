"use strict";

const { getMemoryState } = require("./memory");
const {
  readSnapshotState,
  recordSnapshot,
  writeHeapSnapshot
} = require("./snapshot");
const { startSnapshotDiffJob } = require("./snapshot-diff-queue");

const AUTO_SNAPSHOT_KEY = "heapGuardianAutoSnapshot";
const SEVERITY_RANK = {
  info: 1,
  warning: 2,
  critical: 3
};

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeThreshold(value) {
  const numberValue = parseNumber(value, 85);
  return numberValue > 1 ? numberValue / 100 : numberValue;
}

function getAuditState(globalContext) {
  const existing = globalContext && typeof globalContext.get === "function"
    ? globalContext.get(AUTO_SNAPSHOT_KEY)
    : null;

  if (existing && Array.isArray(existing.runs)) {
    return existing;
  }

  return {
    version: 1,
    runs: []
  };
}

function setAuditState(globalContext, state) {
  if (globalContext && typeof globalContext.set === "function") {
    globalContext.set(AUTO_SNAPSHOT_KEY, state);
  }
}

function reportAlerts(report) {
  const profiler = report && report.profiler ? report.profiler : report;
  return profiler && profiler.analysis && Array.isArray(profiler.analysis.alerts)
    ? profiler.analysis.alerts
    : [];
}

function qualifyingAlerts(report, requiredSeverity) {
  const requiredRank = SEVERITY_RANK[requiredSeverity] || SEVERITY_RANK.critical;

  return reportAlerts(report).filter((alert) => (SEVERITY_RANK[alert.severity] || 0) >= requiredRank);
}

function recentTriggeredRuns(runs, now) {
  const cutoff = now - 60 * 60 * 1000;
  return runs.filter((run) => run.triggered === true && Date.parse(run.timestamp) >= cutoff);
}

function evaluateAutoSnapshot(globalContext, report, options = {}) {
  const enabled = options.enabled === true || options.enabled === "true";
  const now = Date.now();
  const requiredSeverity = options.requiredSeverity || "critical";
  const threshold = normalizeThreshold(options.threshold ?? 85);
  const cooldownMs = Math.max(0, parseNumber(options.cooldownSeconds, 300) * 1000);
  const maxSnapshotsPerHour = Math.max(0, parseNumber(options.maxSnapshotsPerHour, 3));
  const includeSpaces = options.includeSpaces === true || options.includeSpaces === "true";
  const directory = options.directory || "";
  const label = options.label || "auto";
  const diffAfterSnapshot = options.diffAfterSnapshot === true || options.diffAfterSnapshot === "true";
  const memoryReader = typeof options.memoryReader === "function" ? options.memoryReader : getMemoryState;
  const snapshotWriter = typeof options.snapshotWriter === "function" ? options.snapshotWriter : writeHeapSnapshot;
  const state = getAuditState(globalContext);

  function finish(result) {
    state.runs = [
      ...state.runs,
      {
        timestamp: new Date(now).toISOString(),
        triggered: result.triggered === true,
        reason: result.reason || null,
        requiredSeverity,
        threshold
      }
    ].slice(-50);
    state.updatedAt = new Date(now).toISOString();
    setAuditState(globalContext, state);
    return {
      ...result,
      audit: {
        updatedAt: state.updatedAt,
        runsInLastHour: recentTriggeredRuns(state.runs, now).length
      }
    };
  }

  if (!enabled) {
    return finish({
      triggered: false,
      reason: "disabled"
    });
  }

  const alerts = qualifyingAlerts(report, requiredSeverity);

  if (alerts.length === 0) {
    return finish({
      triggered: false,
      reason: "no-qualifying-alert",
      requiredSeverity
    });
  }

  const lastTriggered = [...state.runs].reverse().find((run) => run.triggered === true);

  if (lastTriggered && Date.parse(lastTriggered.timestamp) + cooldownMs > now) {
    return finish({
      triggered: false,
      reason: "cooldown",
      nextAllowedAt: new Date(Date.parse(lastTriggered.timestamp) + cooldownMs).toISOString()
    });
  }

  if (maxSnapshotsPerHour > 0 && recentTriggeredRuns(state.runs, now).length >= maxSnapshotsPerHour) {
    return finish({
      triggered: false,
      reason: "hourly-limit"
    });
  }

  const memory = memoryReader({ includeSpaces });
  const pressure = memory.pressure.heapUsedRatio ?? 0;

  if (pressure < threshold) {
    return finish({
      triggered: false,
      reason: "below-threshold",
      threshold,
      pressure,
      memory
    });
  }

  const previous = readSnapshotState(globalContext).snapshots.slice(-1)[0] || null;
  const snapshot = snapshotWriter({
    directory,
    label
  });

  if (!snapshot || snapshot.written !== true) {
    return finish({
      triggered: false,
      reason: snapshot && snapshot.reason ? snapshot.reason : "snapshot-not-written",
      snapshot,
      memory,
      alerts
    });
  }

  const metadata = recordSnapshot(globalContext, snapshot, memory, {
    reason: "auto-snapshot",
    label
  });
  const diffJob = diffAfterSnapshot && previous && metadata
    ? startSnapshotDiffJob(globalContext, previous.path, metadata.path, options)
    : null;

  return finish({
    triggered: true,
    reason: "triggered",
    threshold,
    pressure,
    memory,
    snapshot,
    snapshotMetadata: metadata,
    diffJob,
    alerts
  });
}

module.exports = {
  AUTO_SNAPSHOT_KEY,
  evaluateAutoSnapshot,
  getAuditState,
  qualifyingAlerts
};
