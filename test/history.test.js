"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { appendHistoryEntry, rotateIfNeeded } = require("../lib/history");

test("appendHistoryEntry is disabled without a file", () => {
  const result = appendHistoryEntry({ bytes: 1 }, { file: "" });

  assert.equal(result.written, false);
  assert.equal(result.reason, "history-file-disabled");
});

test("appendHistoryEntry writes JSONL and rotates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "heap-guardian-history-"));
  const file = path.join(directory, "history.jsonl");

  try {
    appendHistoryEntry({ bytes: 1 }, { file, maxBytes: 1024 });
    assert.match(fs.readFileSync(file, "utf8"), /"bytes":1/);

    fs.writeFileSync(file, "x".repeat(20), "utf8");
    rotateIfNeeded(file, 10);

    assert.equal(fs.existsSync(`${file}.1`), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
