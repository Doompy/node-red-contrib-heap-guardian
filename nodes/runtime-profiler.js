"use strict";

const {
  getRuntimeProfilerStatus,
  registerRuntimeProfiler,
  unregisterRuntimeProfiler
} = require("../lib/runtime-profiler");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerRuntimeProfilerNode(RED) {
  function RuntimeProfilerNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    let lastStatusAt = 0;

    function updateStatus(sample) {
      const now = Date.now();

      if (now - lastStatusAt < 2000) {
        return;
      }

      lastStatusAt = now;
      node.status({
        fill: "blue",
        shape: "dot",
        text: `${sample.direction} ${sample.nodeType} ${sample.bytesFormatted}`
      });
    }

    const registration = registerRuntimeProfiler(node.id, {
      globalContext: node.context().global,
      config: {
        enabled: config.enabled !== false && config.enabled !== "false",
        direction: config.direction || "both",
        property: config.property || "payload",
        sampleRate: parseNumber(config.sampleRate, 10),
        minBytes: parseNumber(config.minBytes, 0),
        maxDepth: parseNumber(config.maxDepth, 6),
        maxEntries: parseNumber(config.maxEntries, 5000),
        maxKeyRecords: parseNumber(config.maxKeyRecords, 10),
        maxKeyScan: parseNumber(config.maxKeyScan, 50),
        maxRecords: parseNumber(config.maxRecords, 1000),
        excludePackageNodes: config.excludePackageNodes !== false && config.excludePackageNodes !== "false",
        includeNodeTypes: config.includeNodeTypes || "",
        excludeNodeTypes: config.excludeNodeTypes || ""
      },
      onSample: updateStatus
    });

    if (registration.ok) {
      node.status({ fill: "blue", shape: "ring", text: "runtime profiling" });
    } else {
      node.status({ fill: "red", shape: "ring", text: registration.reason });
      node.warn(`Heap Guardian runtime profiler could not start: ${registration.reason}`);
    }

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        msg.payload = getRuntimeProfilerStatus(node.id) || {
          active: false
        };

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        nodeDone(error);
      }
    });

    node.on("close", (removed, done) => {
      unregisterRuntimeProfiler(node.id);
      node.status({});

      if (typeof done === "function") {
        done();
      }
    });
  }

  RED.nodes.registerType("runtime-profiler", RuntimeProfilerNode);
};
