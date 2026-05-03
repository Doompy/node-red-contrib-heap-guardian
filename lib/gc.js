"use strict";

const { getMemoryState } = require("./memory");

let lastGcAt = 0;

function normalizeThreshold(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 0.8;
  }

  if (numberValue > 1) {
    return numberValue / 100;
  }

  return numberValue;
}

function normalizeIntervalMs(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return 60000;
  }

  return numberValue;
}

function runGuardedGc(options = {}) {
  const threshold = normalizeThreshold(options.threshold ?? 0.8);
  const minIntervalMs = normalizeIntervalMs(options.minIntervalMs ?? 60000);
  const force = options.force === true;
  const now = Date.now();
  const before = getMemoryState({ includeSpaces: options.includeSpaces });
  const pressure = before.pressure.heapUsedRatio ?? 0;

  if (typeof globalThis.gc !== "function") {
    return {
      triggered: false,
      reason: "gc-not-exposed",
      message: "Start Node-RED with --expose-gc to enable manual GC.",
      before
    };
  }

  if (!force && pressure < threshold) {
    return {
      triggered: false,
      reason: "below-threshold",
      threshold,
      pressure,
      before
    };
  }

  if (!force && lastGcAt > 0 && now - lastGcAt < minIntervalMs) {
    return {
      triggered: false,
      reason: "throttled",
      threshold,
      pressure,
      nextAllowedAt: new Date(lastGcAt + minIntervalMs).toISOString(),
      before
    };
  }

  const startedAt = Date.now();
  globalThis.gc();
  lastGcAt = Date.now();

  const after = getMemoryState({ includeSpaces: options.includeSpaces });

  return {
    triggered: true,
    threshold,
    pressure,
    durationMs: lastGcAt - startedAt,
    freedBytes: before.memory.heapUsed - after.memory.heapUsed,
    before,
    after
  };
}

function getLastGcAt() {
  return lastGcAt;
}

function resetGcState() {
  lastGcAt = 0;
}

module.exports = {
  getLastGcAt,
  resetGcState,
  runGuardedGc
};
