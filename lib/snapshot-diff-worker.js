"use strict";

const fs = require("node:fs");

function indexByName(values) {
  return Object.fromEntries(values.map((value, index) => [value, index]));
}

function readSnapshot(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function summarizeSnapshot(snapshot) {
  const meta = snapshot.snapshot && snapshot.snapshot.meta ? snapshot.snapshot.meta : {};
  const fields = meta.node_fields || [];
  const types = meta.node_types || [];
  const fieldIndex = indexByName(fields);
  const nodeFieldCount = fields.length;
  const nodeTypes = types[fieldIndex.type] || [];
  const nodes = snapshot.nodes || [];
  const strings = snapshot.strings || [];
  const groups = new Map();

  for (let offset = 0; offset < nodes.length; offset += nodeFieldCount) {
    const type = nodeTypes[nodes[offset + fieldIndex.type]] || "unknown";
    const name = strings[nodes[offset + fieldIndex.name]] || "";
    const selfSize = Number(nodes[offset + fieldIndex.self_size]) || 0;
    const key = `${type}:${name}`;
    const current = groups.get(key) || {
      type,
      name,
      count: 0,
      selfSize: 0
    };

    current.count += 1;
    current.selfSize += selfSize;
    groups.set(key, current);
  }

  return groups;
}

function diffGroups(previous, latest) {
  const rows = [];
  const keys = new Set([...previous.keys(), ...latest.keys()]);

  for (const key of keys) {
    const before = previous.get(key) || { type: key.split(":")[0], name: key.split(":").slice(1).join(":"), count: 0, selfSize: 0 };
    const after = latest.get(key) || { type: before.type, name: before.name, count: 0, selfSize: 0 };
    rows.push({
      type: after.type || before.type,
      name: after.name || before.name,
      previousCount: before.count,
      latestCount: after.count,
      countDelta: after.count - before.count,
      previousSelfSize: before.selfSize,
      latestSelfSize: after.selfSize,
      selfSizeDelta: after.selfSize - before.selfSize
    });
  }

  return rows;
}

function topRows(rows, predicate, sortField, limit) {
  return rows
    .filter(predicate)
    .sort((left, right) => Math.abs(right[sortField]) - Math.abs(left[sortField]))
    .slice(0, limit);
}

function main() {
  const previousPath = process.argv[2];
  const latestPath = process.argv[3];
  const limit = Number.isFinite(Number(process.argv[4])) ? Number(process.argv[4]) : 20;

  if (!previousPath || !latestPath) {
    throw new Error("Usage: node snapshot-diff-worker.js <previous> <latest> [limit]");
  }

  const previous = summarizeSnapshot(readSnapshot(previousPath));
  const latest = summarizeSnapshot(readSnapshot(latestPath));
  const rows = diffGroups(previous, latest);
  const result = {
    previousPath,
    latestPath,
    topAdded: topRows(rows, (row) => row.countDelta > 0 || row.selfSizeDelta > 0, "selfSizeDelta", limit),
    topGrowing: topRows(rows, (row) => row.selfSizeDelta > 0, "selfSizeDelta", limit),
    topRemoved: topRows(rows, (row) => row.countDelta < 0 || row.selfSizeDelta < 0, "selfSizeDelta", limit)
  };

  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  diffGroups,
  summarizeSnapshot
};
