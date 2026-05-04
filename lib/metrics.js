"use strict";

const { getMemoryState } = require("./memory");
const { buildDashboard } = require("./dashboard");
const { getProfilerReport } = require("./profiler");
const { getSnapshotReport } = require("./snapshot");

function escapeLabelValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function labels(values) {
  const entries = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);

  return entries.length > 0 ? `{${entries.join(",")}}` : "";
}

function metricLine(name, labelValues, value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return `${name}${labels(labelValues)} ${numberValue}`;
}

function createMetricsReport(globalContext, options = {}) {
  const includeSpaces = options.includeSpaces === true;
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 20;
  const sortBy = options.sortBy || "lastBytes";
  const memory = getMemoryState({ includeSpaces });
  const profiler = getProfilerReport(globalContext, {
    ...options,
    limit,
    sortBy
  });
  const snapshots = getSnapshotReport(globalContext, options);
  const dashboard = buildDashboard({
    memory,
    profiler
  });

  const summary = {
    timestamp: new Date().toISOString(),
    memory: {
      rss: memory.memory.rss,
      heapUsed: memory.memory.heapUsed,
      heapTotal: memory.memory.heapTotal,
      heapLimit: memory.heap.heapSizeLimit,
      heapUsedRatio: memory.pressure.heapUsedRatio,
      oldSpaceUsedRatio: memory.pressure.oldSpaceUsedRatio
    },
    profiler: {
      totalRecords: profiler.totalRecords,
      matchedRecords: profiler.matchedRecords,
      returnedRecords: profiler.records.length,
      sortBy,
      alertCount: profiler.analysis.alerts.length,
      suspectCount: profiler.analysis.suspects.length,
      trendCount: profiler.analysis.topTrends.length,
      overhead: profiler.overhead
    }
  };

  return {
    timestamp: summary.timestamp,
    summary,
    memory,
    profiler,
    snapshots,
    dashboard
  };
}

function countAlertsBySeverity(alerts, severity) {
  return alerts.filter((alert) => alert.severity === severity).length;
}

function createPrometheusMetrics(report, options = {}) {
  const includeProfilerRecordMetrics = options.includeProfilerRecordMetrics !== false;
  const maxPrometheusRecords = Number.isFinite(Number(options.maxPrometheusRecords))
    ? Math.max(0, Number(options.maxPrometheusRecords))
    : report.profiler.records.length;
  const lines = [
    "# HELP heap_guardian_memory_bytes Node.js memory usage by type.",
    "# TYPE heap_guardian_memory_bytes gauge"
  ];

  [
    ["rss", report.memory.memory.rss],
    ["heap_total", report.memory.memory.heapTotal],
    ["heap_used", report.memory.memory.heapUsed],
    ["external", report.memory.memory.external],
    ["array_buffers", report.memory.memory.arrayBuffers],
    ["heap_limit", report.memory.heap.heapSizeLimit]
  ].forEach(([type, value]) => {
    const line = metricLine("heap_guardian_memory_bytes", { type }, value);
    if (line) {
      lines.push(line);
    }
  });

  lines.push("# HELP heap_guardian_heap_pressure_ratio Heap pressure ratios.");
  lines.push("# TYPE heap_guardian_heap_pressure_ratio gauge");

  [
    ["heap_used", report.memory.pressure.heapUsedRatio],
    ["v8_used", report.memory.pressure.v8UsedRatio],
    ["rss", report.memory.pressure.rssRatio],
    ["old_space", report.memory.pressure.oldSpaceUsedRatio]
  ].forEach(([type, value]) => {
    const line = metricLine("heap_guardian_heap_pressure_ratio", { type }, value);
    if (line) {
      lines.push(line);
    }
  });

  lines.push("# HELP heap_guardian_profiler_records Number of profiler records.");
  lines.push("# TYPE heap_guardian_profiler_records gauge");
  lines.push(metricLine("heap_guardian_profiler_records", {}, report.profiler.totalRecords));

  lines.push("# HELP heap_guardian_profiler_alerts Number of profiler alerts by severity.");
  lines.push("# TYPE heap_guardian_profiler_alerts gauge");

  ["info", "warning", "critical"].forEach((severity) => {
    lines.push(metricLine("heap_guardian_profiler_alerts", { severity }, countAlertsBySeverity(report.profiler.analysis.alerts, severity)));
  });

  lines.push("# HELP heap_guardian_profiler_suspects Number of profiler suspects.");
  lines.push("# TYPE heap_guardian_profiler_suspects gauge");
  lines.push(metricLine("heap_guardian_profiler_suspects", {}, report.profiler.analysis.suspects.length));

  lines.push("# HELP heap_guardian_profiler_trends Number of profiler growth trends.");
  lines.push("# TYPE heap_guardian_profiler_trends gauge");
  lines.push(metricLine("heap_guardian_profiler_trends", {}, report.profiler.analysis.topTrends.length));

  if (!includeProfilerRecordMetrics) {
    return `${lines.filter(Boolean).join("\n")}\n`;
  }

  lines.push("# HELP heap_guardian_profiler_record_bytes Profiler record byte sizes.");
  lines.push("# TYPE heap_guardian_profiler_record_bytes gauge");

  for (const record of report.profiler.records.slice(0, maxPrometheusRecords)) {
    const baseLabels = {
      kind: record.kind,
      scope: record.scope,
      flow: record.flowName,
      node: record.nodeName,
      node_type: record.nodeType,
      property: record.property
    };

    [
      ["last", record.lastBytes],
      ["max", record.maxBytes],
      ["total", record.totalBytes]
    ].forEach(([metric, value]) => {
      const line = metricLine("heap_guardian_profiler_record_bytes", {
        ...baseLabels,
        metric
      }, value);

      if (line) {
        lines.push(line);
      }
    });
  }

  return `${lines.filter(Boolean).join("\n")}\n`;
}

module.exports = {
  countAlertsBySeverity,
  createMetricsReport,
  createPrometheusMetrics,
  escapeLabelValue
};
