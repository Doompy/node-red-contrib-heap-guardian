"use strict";

const { createMetricsReport, createPrometheusMetrics } = require("../lib/metrics");

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
    includeSpaces: defaults.includeSpaces,
    limit: parseNumber(query.limit, defaults.limit),
    sortBy: query.sortBy || defaults.sortBy,
    filter
  };
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
        const report = createMetricsReport(
          node.context().global,
          readReportOptions(msg, { includeSpaces, limit, sortBy })
        );

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
