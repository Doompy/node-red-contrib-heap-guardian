"use strict";

const PROFILER_KEY = "heapGuardianProfiler";

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
  const now = new Date().toISOString();
  const state = getState(globalContext);
  const recordKey = makeRecordKey(meta, sample);
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
    truncated: false,
    circularRefs: 0
  };

  current.count += 1;
  current.totalBytes += sample.bytes;
  current.lastBytes = sample.bytes;
  current.maxBytes = Math.max(current.maxBytes, sample.bytes);
  current.lastType = sample.type || null;
  current.truncated = current.truncated || sample.truncated === true;
  current.circularRefs += sample.circularRefs || 0;
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
  const records = Object.values(state.records)
    .sort((left, right) => (right[sortBy] || 0) - (left[sortBy] || 0))
    .slice(0, limit);

  return {
    timestamp: new Date().toISOString(),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    totalRecords: Object.keys(state.records).length,
    sortBy,
    records
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
  clearProfilerReport,
  getNodeMeta,
  getProfilerReport,
  recordProfile
};
