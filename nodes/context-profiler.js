"use strict";

const { estimateSize, formatBytes } = require("../lib/size");
const { getNodeMeta, recordProfile, PROFILER_KEY } = require("../lib/profiler");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function makeExcludeMatcher(pattern) {
  if (!pattern) {
    return () => false;
  }

  try {
    const regex = new RegExp(pattern);
    return (key) => regex.test(key);
  } catch (error) {
    return (key) => key === pattern;
  }
}

function readContextKeys(scopeApi) {
  if (!scopeApi || typeof scopeApi.keys !== "function") {
    return [];
  }

  const keys = scopeApi.keys();
  return Array.isArray(keys) ? keys : [];
}

function readContextValue(scopeApi, key) {
  if (!scopeApi || typeof scopeApi.get !== "function") {
    return undefined;
  }

  return scopeApi.get(key);
}

module.exports = function registerContextProfiler(RED) {
  function ContextProfilerNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const scope = config.scope || "both";
    const outputMode = config.outputMode || "replace";
    const maxKeys = parseNumber(config.maxKeys, 25);
    const maxDepth = parseNumber(config.maxDepth, 8);
    const maxEntries = parseNumber(config.maxEntries, 10000);
    const excludePattern = config.excludePattern || `^${PROFILER_KEY}$`;
    const shouldExclude = makeExcludeMatcher(excludePattern);

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const meta = getNodeMeta(RED, node, config, "context-profiler");
        const context = node.context();
        const scopes = [];

        if (scope === "flow" || scope === "both") {
          scopes.push(["flow", context.flow]);
        }

        if (scope === "global" || scope === "both") {
          scopes.push(["global", context.global]);
        }

        const reports = scopes.map(([scopeName, scopeApi]) => {
          const entries = [];
          const keys = readContextKeys(scopeApi).filter((key) => !shouldExclude(key));

          for (const key of keys) {
            const value = readContextValue(scopeApi, key);
            const estimate = estimateSize(value, { maxDepth, maxEntries });

            recordProfile(context.global, meta, {
              kind: "context",
              scope: scopeName,
              contextKey: key,
              property: key,
              bytes: estimate.bytes,
              type: estimate.type,
              truncated: estimate.truncated,
              circularRefs: estimate.circularRefs
            });

            entries.push({
              key,
              bytes: estimate.bytes,
              bytesFormatted: formatBytes(estimate.bytes),
              type: estimate.type,
              truncated: estimate.truncated,
              circularRefs: estimate.circularRefs
            });
          }

          entries.sort((left, right) => right.bytes - left.bytes);

          return {
            scope: scopeName,
            flowId: scopeName === "flow" ? meta.flowId : null,
            flowName: scopeName === "flow" ? meta.flowName : null,
            totalKeys: entries.length,
            totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
            totalBytesFormatted: formatBytes(entries.reduce((sum, entry) => sum + entry.bytes, 0)),
            topKeys: entries.slice(0, maxKeys)
          };
        });

        const totalBytes = reports.reduce((sum, report) => sum + report.totalBytes, 0);
        const profile = {
          timestamp: new Date().toISOString(),
          flowId: meta.flowId,
          flowName: meta.flowName,
          nodeId: meta.nodeId,
          nodeName: meta.nodeName,
          totalBytes,
          totalBytesFormatted: formatBytes(totalBytes),
          reports
        };

        msg.heapGuardian = {
          ...(msg.heapGuardian || {}),
          contextProfile: profile
        };

        node.status({
          fill: totalBytes > 0 ? "blue" : "grey",
          shape: "dot",
          text: `context ${profile.totalBytesFormatted}`
        });

        if (outputMode === "replace") {
          msg.payload = profile;
        }

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "context profile failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("context-profiler", ContextProfilerNode);
};
