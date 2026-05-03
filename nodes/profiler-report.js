"use strict";

const { clearProfilerReport, getProfilerReport } = require("../lib/profiler");
const { formatBytes } = require("../lib/size");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerProfilerReport(RED) {
  function ProfilerReportNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const limit = parseNumber(config.limit, 20);
    const sortBy = config.sortBy || "lastBytes";
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
        const report = getProfilerReport(globalContext, { limit, sortBy });

        report.records = report.records.map((record) => ({
          ...record,
          lastBytesFormatted: formatBytes(record.lastBytes),
          maxBytesFormatted: formatBytes(record.maxBytes),
          totalBytesFormatted: formatBytes(record.totalBytes)
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
