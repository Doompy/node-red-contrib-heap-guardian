"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeConfig,
  shouldProfileNode
} = require("../lib/runtime-profiler");

test("normalizeConfig clamps runtime profiler sample rate", () => {
  assert.equal(normalizeConfig({ sampleRate: 250 }).sampleRate, 1);
  assert.equal(normalizeConfig({ sampleRate: -1 }).sampleRate, 0);
  assert.equal(normalizeConfig({ sampleRate: 25 }).sampleRate, 0.25);
  assert.equal(normalizeConfig({ maxKeyRecords: -1 }).maxKeyRecords, 0);
});

test("shouldProfileNode excludes Heap Guardian nodes by default", () => {
  const config = normalizeConfig({});

  assert.equal(shouldProfileNode(config, { type: "runtime-profiler" }), false);
  assert.equal(shouldProfileNode(config, { type: "metrics-report" }), false);
  assert.equal(shouldProfileNode(config, { type: "heap-snapshot" }), false);
  assert.equal(shouldProfileNode(config, { type: "function" }), true);
});

test("shouldProfileNode supports include and exclude regexes", () => {
  const includeConfig = normalizeConfig({ includeNodeTypes: "^function$" });
  const excludeConfig = normalizeConfig({ excludeNodeTypes: "debug" });

  assert.equal(shouldProfileNode(includeConfig, { type: "function" }), true);
  assert.equal(shouldProfileNode(includeConfig, { type: "inject" }), false);
  assert.equal(shouldProfileNode(excludeConfig, { type: "debug" }), false);
});
