"use strict";

const { evaluateAutoGc } = require("../lib/auto-gc");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerAutoGcGuard(RED) {
  function AutoGcGuardNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const options = {
      enabled: config.enabled === true || config.enabled === "true",
      requiredSeverity: config.requiredSeverity || "critical",
      threshold: parseNumber(config.threshold, 85),
      cooldownSeconds: parseNumber(config.cooldownSeconds, 300),
      maxRunsPerHour: parseNumber(config.maxRunsPerHour, 3),
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
        const result = evaluateAutoGc(node.context().global, report, options);

        msg.heapGuardian = {
          ...(msg.heapGuardian || {}),
          autoGc: result
        };
        msg.payload = {
          report,
          autoGc: result
        };

        node.status({
          fill: result.triggered ? "green" : result.reason === "disabled" ? "grey" : "yellow",
          shape: result.triggered ? "dot" : "ring",
          text: result.reason || "auto gc"
        });

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "auto gc failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("auto-gc-guard", AutoGcGuardNode);
};
