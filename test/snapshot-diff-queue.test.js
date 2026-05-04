"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  getSnapshotDiffQueueReport,
  maybeStartSnapshotDiffJob,
  startSnapshotDiffJob
} = require("../lib/snapshot-diff-queue");

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

function snapshot(nodes) {
  const strings = [...new Set(nodes.map((node) => node.name))];
  const typeNames = ["hidden", "array", "object"];

  return {
    snapshot: {
      meta: {
        node_fields: ["type", "name", "id", "self_size"],
        node_types: [typeNames, "string", "number", "number"]
      }
    },
    nodes: nodes.flatMap((node, index) => [
      typeNames.indexOf(node.type),
      strings.indexOf(node.name),
      index + 1,
      node.selfSize
    ]),
    strings
  };
}

function writePair(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "heap-guardian-diff-queue-"));
  const previousPath = path.join(directory, "a.heapsnapshot");
  const latestPath = path.join(directory, "b.heapsnapshot");

  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  fs.writeFileSync(previousPath, JSON.stringify(snapshot([
    { type: "array", name: "Array", selfSize: 64 }
  ])), "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(snapshot([
    { type: "array", name: "Array", selfSize: 256 }
  ])), "utf8");

  return {
    previousPath,
    latestPath
  };
}

async function waitForResult(context) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3000) {
    const report = getSnapshotDiffQueueReport(context);

    if (report.latestResult) {
      return report.latestResult;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for snapshot diff queue result");
}

test("maybeStartSnapshotDiffJob is disabled by default", (t) => {
  const context = createContext();
  const { previousPath, latestPath } = writePair(t);
  const result = maybeStartSnapshotDiffJob(context, {
    previous: {
      path: previousPath
    },
    latest: {
      path: latestPath
    }
  }, {});

  assert.equal(result.started, false);
  assert.equal(result.reason, "async-diff-disabled");
});

test("startSnapshotDiffJob completes asynchronously", async (t) => {
  const context = createContext();
  const { previousPath, latestPath } = writePair(t);
  const started = startSnapshotDiffJob(context, previousPath, latestPath, {
    maxSnapshotDiffBytes: 1024 * 1024,
    snapshotDiffTimeoutMs: 3000
  });

  assert.equal(started.started, true);
  assert.equal(started.status, "running");

  const result = await waitForResult(context);

  assert.equal(result.previousPath, previousPath);
  assert.ok(result.topGrowing.some((row) => row.name === "Array" && row.selfSizeDelta > 0));
});
