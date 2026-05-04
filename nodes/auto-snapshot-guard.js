"use strict";

const { evaluateAutoSnapshot } = require("../lib/auto-snapshot");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerAutoSnapshotGuard(RED) {
  function AutoSnapshotGuardNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const options = {
      enabled: config.enabled === true || config.enabled === "true",
      requiredSeverity: config.requiredSeverity || "critical",
      threshold: parseNumber(config.threshold, 85),
      cooldownSeconds: parseNumber(config.cooldownSeconds, 300),
      maxSnapshotsPerHour: parseNumber(config.maxSnapshotsPerHour, 3),
      directory: config.directory || "/data/heap-snapshots",
      label: config.label || "auto",
      diffAfterSnapshot: config.diffAfterSnapshot === true || config.diffAfterSnapshot === "true",
      includeSpaces: config.includeSpaces === true || config.includeSpaces === "true"
    };

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const report = msg.payload && msg.payload.profiler ? msg.payload.profiler : msg.payload;
        const result = evaluateAutoSnapshot(node.context().global, report, options);

        msg.heapGuardian = {
          ...(msg.heapGuardian || {}),
          autoSnapshot: result
        };
        msg.payload = {
          report,
          autoSnapshot: result
        };

        node.status({
          fill: result.triggered ? "green" : result.reason === "disabled" ? "grey" : "yellow",
          shape: result.triggered ? "dot" : "ring",
          text: result.reason || "auto snapshot"
        });

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "auto snapshot failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("auto-snapshot-guard", AutoSnapshotGuardNode);
};
