"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { resetGcState, runGuardedGc } = require("../lib/gc");

test("runGuardedGc returns a structured result", () => {
  resetGcState();

  const result = runGuardedGc({
    threshold: 0,
    minIntervalMs: 0,
    includeSpaces: false
  });

  assert.equal(typeof result.triggered, "boolean");

  if (typeof globalThis.gc !== "function") {
    assert.equal(result.triggered, false);
    assert.equal(result.reason, "gc-not-exposed");
    assert.equal(typeof result.before.memory.heapUsed, "number");
  } else {
    assert.equal(result.triggered, true);
    assert.equal(typeof result.freedBytes, "number");
    assert.equal(typeof result.durationMs, "number");
  }
});

test("runGuardedGc skips when pressure is below threshold", () => {
  resetGcState();

  if (typeof globalThis.gc !== "function") {
    return;
  }

  const result = runGuardedGc({
    threshold: 2,
    minIntervalMs: 0,
    includeSpaces: false
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "below-threshold");
});
