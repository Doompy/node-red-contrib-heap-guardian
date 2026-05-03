"use strict";

const { estimateSize, formatBytes, readTopLevelEntries } = require("../lib/size");
const { getNodeMeta, recordProfile } = require("../lib/profiler");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getMessageValue(RED, msg, property) {
  if (!property || property === "msg") {
    return msg;
  }

  if (RED.util && typeof RED.util.getMessageProperty === "function") {
    return RED.util.getMessageProperty(msg, property);
  }

  return property.split(".").reduce((current, part) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[part];
  }, msg);
}

module.exports = function registerPayloadProfiler(RED) {
  function PayloadProfilerNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const property = config.property || "payload";
    const outputMode = config.outputMode || "annotate";
    const warnBytes = parseNumber(config.warnBytes, 1024 * 1024);
    const criticalBytes = parseNumber(config.criticalBytes, 8 * 1024 * 1024);
    const maxDepth = parseNumber(config.maxDepth, 8);
    const maxEntries = parseNumber(config.maxEntries, 10000);
    const maxKeyRecords = Math.max(0, parseNumber(config.maxKeyRecords, 10));
    const maxKeyScan = Math.max(maxKeyRecords, parseNumber(config.maxKeyScan, 50));

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const meta = getNodeMeta(RED, node, config, "payload-profiler");
        const value = getMessageValue(RED, msg, property);
        const estimate = estimateSize(value, { maxDepth, maxEntries });
        const topKeys = readTopLevelEntries(value, {
          maxDepth,
          maxEntries,
          maxKeys: maxKeyRecords,
          maxScanKeys: maxKeyScan,
          parentProperty: property
        });
        const record = recordProfile(node.context().global, meta, {
          kind: "payload",
          property,
          bytes: estimate.bytes,
          type: estimate.type,
          truncated: estimate.truncated,
          circularRefs: estimate.circularRefs
        });

        for (const entry of topKeys) {
          recordProfile(node.context().global, meta, {
            kind: "payload-key",
            property: entry.property,
            contextKey: entry.key,
            bytes: entry.bytes,
            type: entry.type,
            truncated: entry.truncated,
            circularRefs: entry.circularRefs
          });
        }

        const profile = {
          ...estimate,
          property,
          bytesFormatted: formatBytes(estimate.bytes),
          topKeys,
          flowId: meta.flowId,
          flowName: meta.flowName,
          nodeId: meta.nodeId,
          nodeName: meta.nodeName,
          record
        };

        msg.heapGuardian = {
          ...(msg.heapGuardian || {}),
          payloadProfile: profile
        };

        const statusFill = estimate.bytes >= criticalBytes
          ? "red"
          : estimate.bytes >= warnBytes
            ? "yellow"
            : "green";

        node.status({
          fill: statusFill,
          shape: estimate.truncated ? "ring" : "dot",
          text: `${property} ${profile.bytesFormatted}`
        });

        if (outputMode === "replace") {
          msg.payload = profile;
        }

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "profile failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("payload-profiler", PayloadProfilerNode);
};
