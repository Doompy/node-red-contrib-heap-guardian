"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getAdaptiveDecision,
  normalizeConfig,
  shouldProfileNode
} = require("../lib/runtime-profiler");

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

test("normalizeConfig clamps runtime profiler sample rate", () => {
  assert.equal(normalizeConfig({ sampleRate: 250 }).sampleRate, 1);
  assert.equal(normalizeConfig({ sampleRate: -1 }).sampleRate, 0);
  assert.equal(normalizeConfig({ sampleRate: 25 }).sampleRate, 0.25);
  assert.equal(normalizeConfig({ maxKeyRecords: -1 }).maxKeyRecords, 0);
  assert.equal(normalizeConfig({ adaptiveSamplingEnabled: true }).adaptiveSamplingEnabled, true);
  assert.equal(normalizeConfig({ adaptiveWarningSampleRate: 75 }).adaptiveWarningSampleRate, 0.75);
});

test("shouldProfileNode excludes Heap Guardian nodes by default", () => {
  const config = normalizeConfig({});

  assert.equal(shouldProfileNode(config, { type: "runtime-profiler" }), false);
  assert.equal(shouldProfileNode(config, { type: "metrics-report" }), false);
  assert.equal(shouldProfileNode(config, { type: "heap-snapshot" }), false);
  assert.equal(shouldProfileNode(config, { type: "heap-dashboard" }), false);
  assert.equal(shouldProfileNode(config, { type: "auto-snapshot-guard" }), false);
  assert.equal(shouldProfileNode(config, { type: "function" }), true);
});

test("shouldProfileNode supports include and exclude regexes", () => {
  const includeConfig = normalizeConfig({ includeNodeTypes: "^function$" });
  const excludeConfig = normalizeConfig({ excludeNodeTypes: "debug" });

  assert.equal(shouldProfileNode(includeConfig, { type: "function" }), true);
  assert.equal(shouldProfileNode(includeConfig, { type: "inject" }), false);
  assert.equal(shouldProfileNode(excludeConfig, { type: "debug" }), false);
});

test("getAdaptiveDecision keeps base sample rate when disabled", () => {
  const controller = {
    config: normalizeConfig({
      sampleRate: 10,
      adaptiveSamplingEnabled: false
    }),
    globalContext: createContext()
  };
  const decision = getAdaptiveDecision(controller);

  assert.equal(decision.sampleRate, 0.1);
  assert.equal(decision.reason, "disabled");
});
