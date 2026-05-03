"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateAutoGc } = require("../lib/auto-gc");
const { resetGcState } = require("../lib/gc");

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

function criticalReport() {
  return {
    analysis: {
      alerts: [
        {
          severity: "critical",
          kind: "context-growth",
          summary: "global.heapGuardianLeak grew"
        }
      ]
    }
  };
}

test("evaluateAutoGc skips when disabled", () => {
  const result = evaluateAutoGc(createContext(), criticalReport(), {
    enabled: false
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "disabled");
});

test("evaluateAutoGc skips without qualifying alerts", () => {
  const result = evaluateAutoGc(createContext(), {
    analysis: {
      alerts: []
    }
  }, {
    enabled: true
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "no-qualifying-alert");
});

test("evaluateAutoGc can trigger guarded gc", () => {
  resetGcState();
  const context = createContext();
  const originalGc = globalThis.gc;
  let called = false;

  globalThis.gc = () => {
    called = true;
  };

  try {
    const result = evaluateAutoGc(context, criticalReport(), {
      enabled: true,
      threshold: 0,
      cooldownSeconds: 0,
      maxRunsPerHour: 3
    });

    assert.equal(result.triggered, true);
    assert.equal(result.reason, "triggered");
    assert.equal(called, true);
  } finally {
    if (originalGc) {
      globalThis.gc = originalGc;
    } else {
      delete globalThis.gc;
    }
    resetGcState();
  }
});

test("evaluateAutoGc enforces hourly limit", () => {
  resetGcState();
  const context = createContext();
  const originalGc = globalThis.gc;

  globalThis.gc = () => {};

  try {
    evaluateAutoGc(context, criticalReport(), {
      enabled: true,
      threshold: 0,
      cooldownSeconds: 0,
      maxRunsPerHour: 1
    });
    const second = evaluateAutoGc(context, criticalReport(), {
      enabled: true,
      threshold: 0,
      cooldownSeconds: 0,
      maxRunsPerHour: 1
    });

    assert.equal(second.triggered, false);
    assert.equal(second.reason, "hourly-limit");
  } finally {
    if (originalGc) {
      globalThis.gc = originalGc;
    } else {
      delete globalThis.gc;
    }
    resetGcState();
  }
});
