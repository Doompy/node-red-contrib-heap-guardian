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
    includeProfilerRecordMetrics: query.includeProfilerRecordMetrics === undefined
      ? defaults.includeProfilerRecordMetrics
      : query.includeProfilerRecordMetrics !== "false",
    maxPrometheusRecords: parseNumber(query.maxPrometheusRecords, defaults.maxPrometheusRecords),
    warningGrowthSamples: parseNumber(query.warningGrowthSamples, defaults.warningGrowthSamples),
    criticalGrowthSamples: parseNumber(query.criticalGrowthSamples, defaults.criticalGrowthSamples),
    warningGrowthBytes: parseNumber(query.warningGrowthBytes, defaults.warningGrowthBytes),
    criticalGrowthBytes: parseNumber(query.criticalGrowthBytes, defaults.criticalGrowthBytes),
    warningExpansionBytes: parseNumber(query.warningExpansionBytes, defaults.warningExpansionBytes),
    criticalExpansionBytes: parseNumber(query.criticalExpansionBytes, defaults.criticalExpansionBytes),
    snapshotDiffEnabled: query.snapshotDiffEnabled === undefined
      ? defaults.snapshotDiffEnabled
      : query.snapshotDiffEnabled === "true",
    snapshotDiffAsyncEnabled: query.snapshotDiffAsyncEnabled === undefined
      ? defaults.snapshotDiffAsyncEnabled
      : query.snapshotDiffAsyncEnabled === "true",
    maxSnapshotDiffBytes: parseNumber(query.maxSnapshotDiffBytes, defaults.maxSnapshotDiffBytes),
    snapshotDiffTimeoutMs: parseNumber(query.snapshotDiffTimeoutMs, defaults.snapshotDiffTimeoutMs),
    snapshotDiffLimit: parseNumber(query.snapshotDiffLimit, defaults.snapshotDiffLimit),
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
    const includeProfilerRecordMetrics = config.includeProfilerRecordMetrics !== false && config.includeProfilerRecordMetrics !== "false";
    const maxPrometheusRecords = parseNumber(config.maxPrometheusRecords, limit);
    const warningGrowthSamples = parseNumber(config.warningGrowthSamples, undefined);
    const criticalGrowthSamples = parseNumber(config.criticalGrowthSamples, undefined);
    const warningGrowthBytes = parseNumber(config.warningGrowthBytes, undefined);
    const criticalGrowthBytes = parseNumber(config.criticalGrowthBytes, undefined);
    const warningExpansionBytes = parseNumber(config.warningExpansionBytes, undefined);
    const criticalExpansionBytes = parseNumber(config.criticalExpansionBytes, undefined);
    const snapshotDiffEnabled = config.snapshotDiffEnabled === true || config.snapshotDiffEnabled === "true";
    const snapshotDiffAsyncEnabled = config.snapshotDiffAsyncEnabled === true || config.snapshotDiffAsyncEnabled === "true";
    const maxSnapshotDiffBytes = parseNumber(config.maxSnapshotDiffBytes, 128 * 1024 * 1024);
    const snapshotDiffTimeoutMs = parseNumber(config.snapshotDiffTimeoutMs, 30000);
    const snapshotDiffLimit = parseNumber(config.snapshotDiffLimit, 20);

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const reportOptions = readReportOptions(msg, {
          includeSpaces,
          limit,
          sortBy,
          includeProfilerRecordMetrics,
          maxPrometheusRecords,
          warningGrowthSamples,
          criticalGrowthSamples,
          warningGrowthBytes,
          criticalGrowthBytes,
          warningExpansionBytes,
          criticalExpansionBytes,
          snapshotDiffEnabled,
          snapshotDiffAsyncEnabled,
          maxSnapshotDiffBytes,
          snapshotDiffTimeoutMs,
          snapshotDiffLimit
        });
        const report = createMetricsReport(
          node.context().global,
          reportOptions
        );

        if (format === "prometheus") {
          msg.payload = createPrometheusMetrics(report, reportOptions);
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
