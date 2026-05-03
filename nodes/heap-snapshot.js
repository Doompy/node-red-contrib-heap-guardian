"use strict";

const { getMemoryState } = require("../lib/memory");
const { formatBytes } = require("../lib/size");
const { writeHeapSnapshot } = require("../lib/snapshot");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeThreshold(value) {
  const numberValue = parseNumber(value, 80);
  return numberValue > 1 ? numberValue / 100 : numberValue;
}

module.exports = function registerHeapSnapshot(RED) {
  function HeapSnapshotNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const directory = config.directory || "/data/heap-snapshots";
    const label = config.label || config.name || "manual";
    const threshold = normalizeThreshold(config.threshold);
    const minIntervalSeconds = Math.max(0, parseNumber(config.minInterval, 300));
    const force = config.force === true || config.force === "true";
    let lastSnapshotAt = 0;

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const now = Date.now();
        const memory = getMemoryState({ includeSpaces: false });
        const pressure = memory.pressure.heapUsedRatio ?? 0;

        if (!force && pressure < threshold) {
          msg.payload = {
            triggered: false,
            reason: "below-threshold",
            threshold,
            pressure,
            memory
          };
          node.status({
            fill: "grey",
            shape: "ring",
            text: `heap ${Math.round(pressure * 100)}%`
          });
          nodeSend(msg);
          nodeDone();
          return;
        }

        if (!force && lastSnapshotAt > 0 && now - lastSnapshotAt < minIntervalSeconds * 1000) {
          msg.payload = {
            triggered: false,
            reason: "throttled",
            threshold,
            pressure,
            nextAllowedAt: new Date(lastSnapshotAt + minIntervalSeconds * 1000).toISOString(),
            memory
          };
          node.status({ fill: "grey", shape: "ring", text: "snapshot throttled" });
          nodeSend(msg);
          nodeDone();
          return;
        }

        const snapshot = writeHeapSnapshot({
          directory,
          label
        });

        lastSnapshotAt = Date.now();
        msg.payload = {
          triggered: snapshot.written === true,
          threshold,
          pressure,
          snapshot,
          memory
        };

        node.status({
          fill: snapshot.written ? "green" : "red",
          shape: snapshot.written ? "dot" : "ring",
          text: snapshot.written ? `snapshot ${formatBytes(snapshot.bytes)}` : snapshot.reason
        });

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "snapshot failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("heap-snapshot", HeapSnapshotNode);
};
