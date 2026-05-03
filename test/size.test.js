"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { classify, estimateSize } = require("../lib/size");

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
