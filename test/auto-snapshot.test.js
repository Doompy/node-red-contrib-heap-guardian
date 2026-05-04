"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateAutoSnapshot } = require("../lib/auto-snapshot");

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
          id: "context-growth|flow|node|global|cache|cache",
          severity: "critical",
          kind: "context-growth"
        }
      ]
    }
  };
}

function memoryState(ratio = 0.9) {
  return {
    memory: {
      heapUsed: 900,
      heapTotal: 1000,
      rss: 1200
    },
    pressure: {
      heapUsedRatio: ratio
    }
  };
}

test("evaluateAutoSnapshot skips when disabled", () => {
  const result = evaluateAutoSnapshot(createContext(), criticalReport(), {
    enabled: false
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "disabled");
});

test("evaluateAutoSnapshot writes snapshot on qualifying alert", () => {
  const context = createContext();
  const result = evaluateAutoSnapshot(context, criticalReport(), {
    enabled: true,
    threshold: 85,
    memoryReader: () => memoryState(0.9),
    snapshotWriter: () => ({
      written: true,
      path: "auto.heapsnapshot",
      bytes: 1024
    })
  });

  assert.equal(result.triggered, true);
  assert.equal(result.snapshotMetadata.filename, "auto.heapsnapshot");
  assert.equal(context.get("heapGuardianSnapshots").snapshots.length, 1);
});

test("evaluateAutoSnapshot enforces cooldown", () => {
  const context = createContext();
  const options = {
    enabled: true,
    threshold: 85,
    cooldownSeconds: 300,
    memoryReader: () => memoryState(0.9),
    snapshotWriter: () => ({
      written: true,
      path: "auto.heapsnapshot",
      bytes: 1024
    })
  };

  const first = evaluateAutoSnapshot(context, criticalReport(), options);
  const second = evaluateAutoSnapshot(context, criticalReport(), options);

  assert.equal(first.triggered, true);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "cooldown");
});
