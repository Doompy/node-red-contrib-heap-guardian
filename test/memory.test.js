"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { formatBytes, getMemoryState } = require("../lib/memory");

test("getMemoryState returns process and V8 memory data", () => {
  const state = getMemoryState();

  assert.equal(typeof state.timestamp, "string");
  assert.equal(typeof state.pid, "number");
  assert.equal(typeof state.memory.heapUsed, "number");
  assert.equal(typeof state.heap.heapSizeLimit, "number");
  assert.ok(Array.isArray(state.spaces));
  assert.ok(state.memory.heapUsed > 0);
  assert.ok(state.heap.heapSizeLimit > 0);
});

test("getMemoryState can omit heap space details", () => {
  const state = getMemoryState({ includeSpaces: false });

  assert.equal(Object.hasOwn(state, "spaces"), false);
});

test("formatBytes formats byte counts", () => {
  assert.equal(formatBytes(1024), "1KB");
  assert.equal(formatBytes(1536), "1.5KB");
});
