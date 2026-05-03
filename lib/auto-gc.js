"use strict";

const { runGuardedGc } = require("./gc");
const { getMemoryState } = require("./memory");

const AUTO_GC_KEY = "heapGuardianAutoGc";
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
  const existing = globalContext && typeof globalContext.get === "function" ? globalContext.get(AUTO_GC_KEY) : null;

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
    globalContext.set(AUTO_GC_KEY, state);
  }
}

function qualifyingAlerts(report, requiredSeverity) {
  const requiredRank = SEVERITY_RANK[requiredSeverity] || SEVERITY_RANK.critical;
  const alerts = report && report.analysis && Array.isArray(report.analysis.alerts)
    ? report.analysis.alerts
    : [];

  return alerts.filter((alert) => (SEVERITY_RANK[alert.severity] || 0) >= requiredRank);
}

function recentTriggeredRuns(runs, now) {
  const cutoff = now - 60 * 60 * 1000;
  return runs.filter((run) => run.triggered === true && Date.parse(run.timestamp) >= cutoff);
}

function evaluateAutoGc(globalContext, report, options = {}) {
  const enabled = options.enabled === true || options.enabled === "true";
  const now = Date.now();
  const requiredSeverity = options.requiredSeverity || "critical";
  const threshold = normalizeThreshold(options.threshold ?? 85);
  const cooldownMs = Math.max(0, parseNumber(options.cooldownSeconds, 300) * 1000);
  const maxRunsPerHour = Math.max(0, parseNumber(options.maxRunsPerHour, 3));
  const includeSpaces = options.includeSpaces === true || options.includeSpaces === "true";
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

  if (maxRunsPerHour > 0 && recentTriggeredRuns(state.runs, now).length >= maxRunsPerHour) {
    return finish({
      triggered: false,
      reason: "hourly-limit"
    });
  }

  const memory = getMemoryState({ includeSpaces });
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

  const gc = runGuardedGc({
    threshold,
    minIntervalMs: cooldownMs,
    force: false,
    includeSpaces
  });

  return finish({
    ...gc,
    reason: gc.triggered ? "triggered" : gc.reason,
    alerts
  });
}

module.exports = {
  AUTO_GC_KEY,
  evaluateAutoGc,
  getAuditState,
  qualifyingAlerts
};
