"use strict";

const { clearProfilerReport, getProfilerReport } = require("../lib/profiler");
const { formatBytes } = require("../lib/size");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function readQuery(msg) {
  return msg && msg.req && msg.req.query && typeof msg.req.query === "object"
    ? msg.req.query
    : {};
}

function readReportOptions(msg, defaults) {
  const query = readQuery(msg);
  const messageFilter = (msg.heapGuardian && msg.heapGuardian.profilerFilter) || msg.profilerFilter || {};
  const filter = {
    ...(defaults.filter || {}),
    ...messageFilter
  };

  [
    "kind",
    "flowId",
    "nodeId",
    "nodeType",
    "property",
    "minBytes",
    "minDeltaBytes"
  ].forEach((key) => {
    if (query[key] !== undefined) {
      filter[key] = query[key];
    }
  });

  return {
    limit: parseNumber(query.limit, defaults.limit),
    sortBy: query.sortBy || defaults.sortBy,
    filter
  };
}

module.exports = function registerProfilerReport(RED) {
  function ProfilerReportNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const limit = parseNumber(config.limit, 20);
    const sortBy = config.sortBy || "lastBytes";
    const filter = {
      kind: config.kind || "",
      flowId: config.flowId || "",
      nodeId: config.nodeId || "",
      nodeType: config.nodeType || "",
      property: config.property || "",
      minBytes: config.minBytes ?? "",
      minDeltaBytes: config.minDeltaBytes ?? ""
    };
    const clearAfterRead = config.clearAfterRead === true || config.clearAfterRead === "true";

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const globalContext = node.context().global;
        const report = getProfilerReport(globalContext, readReportOptions(msg, { limit, sortBy, filter }));

        report.records = report.records.map((record) => ({
          ...record,
          previousBytesFormatted: record.previousBytes == null ? null : formatBytes(record.previousBytes),
          lastBytesFormatted: formatBytes(record.lastBytes),
          maxBytesFormatted: formatBytes(record.maxBytes),
          totalBytesFormatted: formatBytes(record.totalBytes),
          deltaBytesFormatted: formatBytes(record.deltaBytes || 0),
          growthRateFormatted: record.growthRateBytesPerMinute == null
            ? null
            : `${formatBytes(record.growthRateBytesPerMinute)}/min`
        }));

        msg.payload = report;
        msg.heapGuardian = {
          ...(msg.heapGuardian || {}),
          profilerReport: report
        };

        node.status({
          fill: report.records.length > 0 ? "blue" : "grey",
          shape: "dot",
          text: `${report.records.length}/${report.totalRecords} records`
        });

        if (clearAfterRead) {
          clearProfilerReport(globalContext);
        }

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "report failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("profiler-report", ProfilerReportNode);
};
