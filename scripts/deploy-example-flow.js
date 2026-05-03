"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const examplePath = path.resolve(projectRoot, process.argv[2] || "examples/heap-leak-lab-flow.json");
const nodeRedUrl = (process.env.NODE_RED_URL || "http://localhost:1880").replace(/\/$/, "");
const token = process.env.NODE_RED_TOKEN;

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function rewriteNodeIds(nodes) {
  const idMap = new Map(nodes.map((node) => [node.id, makeId()]));

  return nodes.map((node) => {
    const next = structuredClone(node);
    next.id = idMap.get(node.id);

    if (Array.isArray(next.wires)) {
      next.wires = next.wires.map((wireSet) =>
        wireSet.map((targetId) => idMap.get(targetId) || targetId)
      );
    }

    return next;
  });
}

async function main() {
  const exportedFlow = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const tab = exportedFlow.find((node) => node.type === "tab");

  if (!tab) {
    throw new Error(`No tab node found in ${examplePath}`);
  }

  const nodes = rewriteNodeIds(exportedFlow.filter((node) => node.type !== "tab"));
  const response = await fetch(`${nodeRedUrl}/flow`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      label: tab.label,
      nodes,
      configs: []
    })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Node-RED returned ${response.status}: ${text}`);
  }

  console.log(`Deployed ${tab.label} to ${nodeRedUrl}`);
  if (text) {
    console.log(text);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
