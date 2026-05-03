"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classify,
  estimateSize,
  formatChildProperty,
  readTopLevelEntries
} = require("../lib/size");

test("estimateSize measures common payload types", () => {
  assert.equal(estimateSize("abcd").bytes, 4);
  assert.equal(estimateSize(Buffer.alloc(16)).bytes, 16);
  assert.equal(classify([1, 2, 3]), "array");
});

test("estimateSize handles circular objects", () => {
  const value = { name: "root" };
  value.self = value;

  const estimate = estimateSize(value);

  assert.equal(estimate.circularRefs, 1);
  assert.ok(estimate.bytes > 0);
});

test("estimateSize marks deep objects as truncated", () => {
  const value = { a: { b: { c: { d: "value" } } } };
  const estimate = estimateSize(value, { maxDepth: 2 });

  assert.equal(estimate.truncated, true);
});

test("readTopLevelEntries returns largest immediate child properties", () => {
  const entries = readTopLevelEntries({
    id: "a",
    items: ["x".repeat(100), "y".repeat(100)],
    "odd key": "z".repeat(50)
  }, {
    parentProperty: "payload",
    maxKeys: 2
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].property, "payload.items");
  assert.equal(entries[1].property, "payload[\"odd key\"]");
  assert.equal(formatChildProperty("payload", "items"), "payload.items");
});
