"use strict";

const { formatBytes } = require("./size");

const PROFILER_KEY = "heapGuardianProfiler";
const DEFAULT_MIN_EXPANSION_DELTA_BYTES = 1024;
const DEFAULT_MIN_RECEIVE_BYTES_FOR_RATIO = 1024;

function getFlowMeta(RED, config) {
  const flowId = config.z || "";
  let flowName = flowId || "unknown";

  try {
    const activeConfig = RED.nodes && typeof RED.nodes.getFlows === "function"
      ? RED.nodes.getFlows()
      : null;
    const tabConfig = activeConfig && Array.isArray(activeConfig.flows)
      ? activeConfig.flows.find((entry) => entry.id === flowId && entry.type === "tab")
      : null;

    if (tabConfig && tabConfig.label) {
      flowName = tabConfig.label;
      return {
        flowId,
        flowName
      };
    }

    const flowNode = RED.nodes && typeof RED.nodes.getNode === "function"
      ? RED.nodes.getNode(flowId)
      : null;

    if (flowNode && (flowNode.label || flowNode.name)) {
      flowName = flowNode.label || flowNode.name;
    }
  } catch (error) {
    flowName = flowId || "unknown";
  }

  return {
    flowId,
    flowName
  };
}

function getNodeMeta(RED, node, config, nodeType) {
  const flowMeta = getFlowMeta(RED, config);

  try {
    if (node._flow && node._flow.flow) {
      flowMeta.flowId = node._flow.flow.id || flowMeta.flowId;
      flowMeta.flowName = node._flow.flow.label || flowMeta.flowName;
    }
  } catch (error) {
    // Keep the metadata gathered from RED.nodes.
  }

  return {
    ...flowMeta,
    nodeId: node.id,
    nodeName: config.name || node.name || nodeType,
    nodeType
  };
}

function getState(globalContext) {
  const existing = globalContext.get(PROFILER_KEY);

  if (existing && existing.version === 1 && existing.records && typeof existing.records === "object") {
    return existing;
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    records: {}
  };
}

function setState(globalContext, state) {
  state.updatedAt = new Date().toISOString();
  globalContext.set(PROFILER_KEY, state);
}

function makeRecordKey(meta, sample) {
  return [
    sample.kind,
    meta.flowId || "global",
    meta.nodeId || "unknown-node",
    sample.scope || "",
    sample.property || sample.key || ""
  ].join("|");
}

function normalizeBytes(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function baseProperty(property) {
  return String(property || "").replace(/\[out:\d+\]$/, "");
}

function formatRecordGrowth(record) {
  return {
    key: record.key,
    kind: record.kind,
    scope: record.scope,
    property: record.property,
    contextKey: record.contextKey,
    direction: record.direction,
    port: record.port,
    flowId: record.flowId,
    flowName: record.flowName,
    nodeId: record.nodeId,
    nodeName: record.nodeName,
    nodeType: record.nodeType,
    previousBytes: record.previousBytes,
    previousBytesFormatted: record.previousBytes == null ? null : formatBytes(record.previousBytes),
    lastBytes: record.lastBytes,
    lastBytesFormatted: formatBytes(record.lastBytes),
    deltaBytes: record.deltaBytes,
    deltaBytesFormatted: formatBytes(record.deltaBytes),
    deltaPercent: record.deltaPercent,
    sampleIntervalMs: record.sampleIntervalMs,
    growthRateBytesPerMinute: record.growthRateBytesPerMinute,
    growthRateFormatted: record.growthRateBytesPerMinute == null
      ? null
      : `${formatBytes(record.growthRateBytesPerMinute)}/min`,
    lastSeenAt: record.lastSeenAt
  };
}

function buildTopGrowers(records, limit) {
  return records
    .filter((record) => Number(record.deltaBytes) > 0)
    .sort((left, right) => (right.deltaBytes || 0) - (left.deltaBytes || 0))
    .slice(0, limit)
    .map(formatRecordGrowth);
}

function buildTopContextGrowers(records, limit) {
  return records
    .filter((record) => record.kind === "context")
    .filter((record) => normalizeBytes(record.deltaBytes) > 0)
    .sort((left, right) => normalizeBytes(right.deltaBytes) - normalizeBytes(left.deltaBytes))
    .slice(0, limit)
    .map(formatRecordGrowth);
}

function buildTopPayloadKeys(records, limit) {
  return records
    .filter((record) => record.kind === "payload-key" || record.kind === "runtime-payload-key")
    .filter((record) => normalizeBytes(record.deltaBytes) > 0 || normalizeBytes(record.lastBytes) >= 1024)
    .sort((left, right) => {
      const deltaDiff = Math.max(0, normalizeBytes(right.deltaBytes)) - Math.max(0, normalizeBytes(left.deltaBytes));

      if (deltaDiff !== 0) {
        return deltaDiff;
      }

      return normalizeBytes(right.lastBytes) - normalizeBytes(left.lastBytes);
    })
    .slice(0, limit)
    .map(formatRecordGrowth);
}

function selectLargerRecord(current, candidate) {
  if (!current) {
    return candidate;
  }

  return (candidate.lastBytes || 0) > (current.lastBytes || 0) ? candidate : current;
}

function normalizeAnalysisOptions(options = {}) {
  return {
    minExpansionDeltaBytes: Number.isFinite(Number(options.minExpansionDeltaBytes))
      ? Math.max(0, Number(options.minExpansionDeltaBytes))
      : DEFAULT_MIN_EXPANSION_DELTA_BYTES,
    minReceiveBytesForRatio: Number.isFinite(Number(options.minReceiveBytesForRatio))
      ? Math.max(0, Number(options.minReceiveBytesForRatio))
      : DEFAULT_MIN_RECEIVE_BYTES_FOR_RATIO
  };
}

function buildTopExpanders(records, limit, options = {}) {
  const analysisOptions = normalizeAnalysisOptions(options);
  const groups = new Map();

  for (const record of records) {
    if (record.kind !== "runtime-payload") {
      continue;
    }

    const property = baseProperty(record.property);
    const groupKey = [
      record.flowId || "",
      record.nodeId || "",
      property
    ].join("|");
    const group = groups.get(groupKey) || {
      flowId: record.flowId,
      flowName: record.flowName,
      nodeId: record.nodeId,
      nodeName: record.nodeName,
      nodeType: record.nodeType,
      property,
      receive: null,
      send: null
    };

    if (record.scope === "receive" || record.direction === "receive") {
      group.receive = selectLargerRecord(group.receive, record);
    } else if (record.scope === "send" || record.direction === "send") {
      group.send = selectLargerRecord(group.send, record);
    }

    groups.set(groupKey, group);
  }

  return Array.from(groups.values())
    .filter((group) => group.send)
    .map((group) => {
      const receiveBytes = group.receive ? normalizeBytes(group.receive.lastBytes) : null;
      const sendBytes = normalizeBytes(group.send.lastBytes);
      const compareBytes = receiveBytes || 0;
      const deltaBytes = sendBytes - compareBytes;
      const canCalculateRatio = receiveBytes !== null
        && receiveBytes > 0
        && receiveBytes >= analysisOptions.minReceiveBytesForRatio;
      const expansionRatio = canCalculateRatio
        ? round(sendBytes / receiveBytes)
        : null;

      return {
        flowId: group.flowId,
        flowName: group.flowName,
        nodeId: group.nodeId,
        nodeName: group.nodeName,
        nodeType: group.nodeType,
        property: group.property,
        sendProperty: group.send.property,
        receiveBytes,
        receiveBytesFormatted: receiveBytes === null ? null : formatBytes(receiveBytes),
        sendBytes,
        sendBytesFormatted: formatBytes(sendBytes),
        deltaBytes,
        deltaBytesFormatted: formatBytes(deltaBytes),
        expansionRatio,
        minReceiveBytesForRatio: analysisOptions.minReceiveBytesForRatio,
        ratioStatus: receiveBytes === null
          ? "missing-receive"
          : canCalculateRatio
            ? "calculated"
            : "receive-below-threshold",
        sendLastSeenAt: group.send.lastSeenAt,
        receiveLastSeenAt: group.receive ? group.receive.lastSeenAt : null
      };
    })
    .filter((item) => item.deltaBytes >= analysisOptions.minExpansionDeltaBytes)
    .sort((left, right) => right.deltaBytes - left.deltaBytes)
    .slice(0, limit);
}

function sizeScore(bytes) {
  const value = Math.max(0, normalizeBytes(bytes));
  return value > 0 ? Math.log2(value + 1) : 0;
}

function severityFromScore(score) {
  if (score >= 250) {
    return "critical";
  }

  if (score >= 150) {
    return "warning";
  }

  return "info";
}

function recordTarget(record) {
  if (record.kind === "context") {
    return `${record.scope || "context"} context ${record.contextKey || record.property || "value"}`;
  }

  return record.property || record.contextKey || "payload";
}

function summarizeRecordSuspect(record) {
  const target = recordTarget(record);
  const nodeName = record.nodeName || record.nodeType || "unknown node";
  const deltaBytes = Math.max(0, normalizeBytes(record.deltaBytes));
  const lastBytes = normalizeBytes(record.lastBytes);

  if (deltaBytes > 0) {
    return `${target} grew by ${formatBytes(deltaBytes)} to ${formatBytes(lastBytes)} in ${nodeName}.`;
  }

  return `${target} is ${formatBytes(lastBytes)} in ${nodeName}.`;
}

function buildRecordSuspect(record) {
  const lastBytes = normalizeBytes(record.lastBytes);
  const deltaBytes = Math.max(0, normalizeBytes(record.deltaBytes));
  const growthRate = Math.max(0, normalizeBytes(record.growthRateBytesPerMinute));
  const reasons = [];

  if (deltaBytes > 0) {
    reasons.push("growing");
  }

  if (growthRate > 0) {
    reasons.push("rapid-growth");
  }

  if (lastBytes >= 1024 * 1024) {
    reasons.push("large");
  }

  if (record.kind === "context") {
    reasons.push("context-retention");
  }

  if (record.kind === "payload-key" || record.kind === "runtime-payload-key") {
    reasons.push("payload-key");
  }

  if (record.truncated) {
    reasons.push("truncated");
  }

  if (reasons.length === 0) {
    return null;
  }

  const score = round(
    sizeScore(lastBytes) * 3
    + sizeScore(deltaBytes) * 8
    + sizeScore(growthRate) * 2
    + (record.deltaPercent && record.deltaPercent > 50 ? 10 : 0)
    + (record.kind === "context" ? 8 : 0)
    + (record.kind === "payload-key" || record.kind === "runtime-payload-key" ? 6 : 0),
    2
  );

  return {
    category: "record",
    score,
    severity: severityFromScore(score),
    summary: summarizeRecordSuspect(record),
    reasons,
    ...formatRecordGrowth(record)
  };
}

function summarizeExpansionSuspect(expander) {
  const nodeName = expander.nodeName || expander.nodeType || "unknown node";
  const ratioText = expander.expansionRatio === null
    ? "without a reliable receive ratio"
    : `at ${expander.expansionRatio}x`;

  return `${nodeName} sends ${expander.property} ${formatBytes(expander.deltaBytes)} larger than receive ${ratioText}.`;
}

function buildExpansionSuspect(expander) {
  const reasons = ["runtime-expansion"];

  if (expander.ratioStatus === "missing-receive") {
    reasons.push("missing-receive-baseline");
  } else if (expander.ratioStatus === "receive-below-threshold") {
    reasons.push("small-receive-baseline");
  }

  const score = round(
    sizeScore(expander.deltaBytes) * 9
    + (expander.expansionRatio ? Math.min(expander.expansionRatio, 20) * 4 : 0),
    2
  );

  return {
    category: "runtime-expansion",
    score,
    severity: severityFromScore(score),
    summary: summarizeExpansionSuspect(expander),
    reasons,
    ...expander
  };
}

function buildSuspects(records, expanders, limit) {
  const recordSuspects = records
    .map(buildRecordSuspect)
    .filter(Boolean);
  const expansionSuspects = expanders.map(buildExpansionSuspect);

  return [...recordSuspects, ...expansionSuspects]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function buildAnalysis(records, limit, options = {}) {
  const analysisOptions = normalizeAnalysisOptions(options);
  const topExpanders = buildTopExpanders(records, limit, analysisOptions);

  return {
    topGrowers: buildTopGrowers(records, limit),
    topContextGrowers: buildTopContextGrowers(records, limit),
    topPayloadKeys: buildTopPayloadKeys(records, limit),
    topExpanders,
    suspects: buildSuspects(records, topExpanders, limit),
    options: analysisOptions
  };
}

function splitFilterValue(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeFilter(options = {}) {
  const source = {
    ...(options.filter || {}),
    kind: options.kind ?? (options.filter && options.filter.kind),
    flowId: options.flowId ?? (options.filter && options.filter.flowId),
    nodeId: options.nodeId ?? (options.filter && options.filter.nodeId),
    nodeType: options.nodeType ?? (options.filter && options.filter.nodeType),
    property: options.property ?? (options.filter && options.filter.property),
    minBytes: options.minBytes ?? (options.filter && options.filter.minBytes),
    minDeltaBytes: options.minDeltaBytes ?? (options.filter && options.filter.minDeltaBytes)
  };

  return {
    kinds: splitFilterValue(source.kind),
    flowIds: splitFilterValue(source.flowId),
    nodeIds: splitFilterValue(source.nodeId),
    nodeTypes: splitFilterValue(source.nodeType),
    properties: splitFilterValue(source.property),
    minBytes: optionalNumber(source.minBytes),
    minDeltaBytes: optionalNumber(source.minDeltaBytes)
  };
}

function hasActiveFilter(filter) {
  return filter.kinds.length > 0
    || filter.flowIds.length > 0
    || filter.nodeIds.length > 0
    || filter.nodeTypes.length > 0
    || filter.properties.length > 0
    || filter.minBytes !== null
    || filter.minDeltaBytes !== null;
}

function matchesAny(value, filters) {
  return filters.length === 0 || filters.includes(String(value || ""));
}

function matchesProperty(record, properties) {
  if (properties.length === 0) {
    return true;
  }

  const property = String(record.property || "");
  const base = baseProperty(property);

  return properties.some((candidate) => candidate === property || candidate === base);
}

function filterRecords(records, filter) {
  return records.filter((record) => matchesAny(record.kind, filter.kinds)
    && matchesAny(record.flowId, filter.flowIds)
    && matchesAny(record.nodeId, filter.nodeIds)
    && matchesAny(record.nodeType, filter.nodeTypes)
    && matchesProperty(record, filter.properties)
    && (filter.minBytes === null || normalizeBytes(record.lastBytes) >= filter.minBytes)
    && (filter.minDeltaBytes === null || normalizeBytes(record.deltaBytes) >= filter.minDeltaBytes));
}

function trimRecords(state, maxRecords) {
  const entries = Object.entries(state.records);

  if (entries.length <= maxRecords) {
    return;
  }

  entries
    .sort((left, right) => {
      const leftRecord = left[1];
      const rightRecord = right[1];
      return (rightRecord.lastBytes || 0) - (leftRecord.lastBytes || 0);
    })
    .slice(maxRecords)
    .forEach(([key]) => {
      delete state.records[key];
    });
}

function recordProfile(globalContext, meta, sample, options = {}) {
  const maxRecords = Number.isFinite(Number(options.maxRecords)) ? Number(options.maxRecords) : 500;
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const now = nowDate.toISOString();
  const state = getState(globalContext);
  const recordKey = makeRecordKey(meta, sample);
  const sampleBytes = normalizeBytes(sample.bytes);
  const current = state.records[recordKey] || {
    key: recordKey,
    kind: sample.kind,
    scope: sample.scope || null,
    property: sample.property || null,
    contextKey: sample.contextKey || null,
    direction: sample.direction || null,
    port: Number.isFinite(Number(sample.port)) ? Number(sample.port) : null,
    flowId: meta.flowId,
    flowName: meta.flowName,
    nodeId: meta.nodeId,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
    firstSeenAt: now,
    count: 0,
    totalBytes: 0,
    maxBytes: 0,
    lastBytes: 0,
    lastType: null,
    previousBytes: null,
    deltaBytes: 0,
    deltaPercent: null,
    sampleIntervalMs: null,
    growthRateBytesPerMinute: null,
    truncated: false,
    circularRefs: 0
  };

  const previousBytes = current.count > 0 ? normalizeBytes(current.lastBytes) : null;
  const previousSeenAt = current.lastSeenAt || null;
  const previousTimestamp = parseTimestamp(previousSeenAt);
  const nowTimestamp = nowDate.getTime();
  const sampleIntervalMs = previousTimestamp === null ? null : Math.max(0, nowTimestamp - previousTimestamp);
  const deltaBytes = previousBytes === null ? 0 : sampleBytes - previousBytes;
  const deltaPercent = previousBytes && previousBytes > 0 ? round((deltaBytes / previousBytes) * 100) : null;
  const growthRateBytesPerMinute = sampleIntervalMs && sampleIntervalMs > 0
    ? round((deltaBytes / sampleIntervalMs) * 60000)
    : null;

  current.count += 1;
  current.totalBytes = normalizeBytes(current.totalBytes) + sampleBytes;
  current.previousBytes = previousBytes;
  current.deltaBytes = deltaBytes;
  current.deltaPercent = deltaPercent;
  current.sampleIntervalMs = sampleIntervalMs;
  current.growthRateBytesPerMinute = growthRateBytesPerMinute;
  current.lastBytes = sampleBytes;
  current.maxBytes = Math.max(normalizeBytes(current.maxBytes), sampleBytes);
  current.lastType = sample.type || null;
  current.truncated = current.truncated || sample.truncated === true;
  current.circularRefs += normalizeBytes(sample.circularRefs);
  current.lastSeenAt = now;

  state.records[recordKey] = current;
  trimRecords(state, maxRecords);
  setState(globalContext, state);

  return current;
}

function getProfilerReport(globalContext, options = {}) {
  const state = getState(globalContext);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 20;
  const sortBy = options.sortBy || "lastBytes";
  const filter = normalizeFilter(options);
  const unfilteredRecords = Object.values(state.records);
  const allRecords = hasActiveFilter(filter)
    ? filterRecords(unfilteredRecords, filter)
    : unfilteredRecords;
  const records = allRecords
    .sort((left, right) => (right[sortBy] || 0) - (left[sortBy] || 0))
    .slice(0, limit);

  return {
    timestamp: new Date().toISOString(),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    totalRecords: Object.keys(state.records).length,
    matchedRecords: allRecords.length,
    sortBy,
    filter,
    records,
    analysis: buildAnalysis(allRecords, limit, options.analysis || options)
  };
}

function clearProfilerReport(globalContext) {
  globalContext.set(PROFILER_KEY, {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    records: {}
  });
}

module.exports = {
  PROFILER_KEY,
  DEFAULT_MIN_EXPANSION_DELTA_BYTES,
  DEFAULT_MIN_RECEIVE_BYTES_FOR_RATIO,
  baseProperty,
  buildAnalysis,
  filterRecords,
  clearProfilerReport,
  getNodeMeta,
  getProfilerReport,
  recordProfile
};
