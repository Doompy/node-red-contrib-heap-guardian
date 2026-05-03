"use strict";

const { createMetricsReport, createPrometheusMetrics } = require("../lib/metrics");

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

module.exports = function registerMetricsReport(RED) {
  function MetricsReportNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const format = config.format || "json";
    const limit = parseNumber(config.limit, 20);
    const sortBy = config.sortBy || "lastBytes";
    const includeSpaces = config.includeSpaces === true || config.includeSpaces === "true";

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const report = createMetricsReport(node.context().global, {
          includeSpaces,
          limit,
          sortBy
        });

        if (format === "prometheus") {
          msg.payload = createPrometheusMetrics(report);
          msg.headers = {
            ...(msg.headers || {}),
            "content-type": "text/plain; version=0.0.4; charset=utf-8"
          };
        } else {
          msg.payload = report;
          msg.headers = {
            ...(msg.headers || {}),
            "content-type": "application/json"
          };
        }

        node.status({
          fill: "blue",
          shape: "dot",
          text: `${format} ${report.profiler.records.length}/${report.profiler.totalRecords}`
        });

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "metrics failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("metrics-report", MetricsReportNode);
};
