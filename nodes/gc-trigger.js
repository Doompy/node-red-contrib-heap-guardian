"use strict";

const { formatBytes } = require("../lib/memory");
const { runGuardedGc } = require("../lib/gc");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerGcTrigger(RED) {
  function GcTriggerNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const threshold = parseNumber(config.threshold, 80);
    const minIntervalSeconds = parseNumber(config.minInterval, 60);
    const force = config.force === true || config.force === "true";
    const includeSpaces = config.includeSpaces === true || config.includeSpaces === "true";

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const result = runGuardedGc({
          threshold,
          minIntervalMs: minIntervalSeconds * 1000,
          force,
          includeSpaces
        });

        msg.payload = result;
        msg.heapGuardian = {
          gc: result
        };

        if (result.triggered) {
          node.status({
            fill: "green",
            shape: "dot",
            text: `freed ${formatBytes(result.freedBytes)}`
          });
        } else {
          node.status({
            fill: result.reason === "gc-not-exposed" ? "red" : "grey",
            shape: "ring",
            text: result.reason
          });
        }

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "gc failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("gc-trigger", GcTriggerNode);
};
