"use strict";

const { estimateSize, formatBytes } = require("./size");
const { recordProfile } = require("./profiler");

const HOOK_LABEL = "heapGuardianRuntimeProfiler";
const PACKAGE_NODE_TYPES = new Set([
  "heap-monitor",
  "gc-trigger",
  "payload-profiler",
  "context-profiler",
  "profiler-report",
  "runtime-profiler",
  "heap-snapshot",
  "metrics-report"
]);

const controllers = new Map();

let hooks = null;
let hooksRegistered = false;

function parseNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function parseRegex(pattern) {
  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(pattern);
  } catch (error) {
    return null;
  }
}

function getMessageProperty(msg, property) {
  if (!property || property === "msg") {
    return msg;
  }

  return property.split(".").reduce((current, part) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[part];
  }, msg);
}

function getRuntimeHooks() {
  if (hooks) {
    return hooks;
  }

  try {
    hooks = require("@node-red/util").hooks;
  } catch (error) {
    hooks = null;
  }

  return hooks;
}

function getFlowMetaFromNode(node) {
  const flow = node && node._flow && node._flow.flow ? node._flow.flow : null;

  return {
    flowId: flow && flow.id ? flow.id : node && node.z ? node.z : "",
    flowName: flow && flow.label ? flow.label : node && node.z ? node.z : "unknown"
  };
}

function getNodeMeta(node) {
  const flow = getFlowMetaFromNode(node);

  return {
    flowId: flow.flowId,
    flowName: flow.flowName,
    nodeId: node && node.id ? node.id : "unknown-node",
    nodeName: node && node.name ? node.name : node && node.type ? node.type : "unknown",
    nodeType: node && node.type ? node.type : "unknown"
  };
}

function normalizeConfig(config = {}) {
  const sampleRate = Math.max(0, Math.min(1, parseNumber(config.sampleRate, 10) / 100));

  return {
    enabled: config.enabled !== false && config.enabled !== "false",
    direction: config.direction || "both",
    property: config.property || "payload",
    sampleRate,
    minBytes: Math.max(0, parseNumber(config.minBytes, 0)),
    maxDepth: Math.max(1, parseNumber(config.maxDepth, 6)),
    maxEntries: Math.max(1, parseNumber(config.maxEntries, 5000)),
    maxRecords: Math.max(1, parseNumber(config.maxRecords, 1000)),
    excludePackageNodes: config.excludePackageNodes !== false && config.excludePackageNodes !== "false",
    includeNodeTypes: parseRegex(config.includeNodeTypes || ""),
    excludeNodeTypes: parseRegex(config.excludeNodeTypes || "")
  };
}

function directionEnabled(config, direction) {
  return config.direction === "both" || config.direction === direction;
}

function shouldProfileNode(config, node) {
  if (!node || !node.type) {
    return false;
  }

  if (config.excludePackageNodes && PACKAGE_NODE_TYPES.has(node.type)) {
    return false;
  }

  if (config.includeNodeTypes && !config.includeNodeTypes.test(node.type)) {
    return false;
  }

  if (config.excludeNodeTypes && config.excludeNodeTypes.test(node.type)) {
    return false;
  }

  return true;
}

function shouldSample(config) {
  return config.sampleRate >= 1 || Math.random() < config.sampleRate;
}

function sampleMessage(controller, direction, node, msg, port) {
  const config = controller.config;

  if (!config.enabled || !directionEnabled(config, direction) || !shouldProfileNode(config, node) || !shouldSample(config)) {
    return;
  }

  const value = getMessageProperty(msg, config.property);
  const estimate = estimateSize(value, {
    maxDepth: config.maxDepth,
    maxEntries: config.maxEntries
  });

  if (estimate.bytes < config.minBytes) {
    return;
  }

  const meta = getNodeMeta(node);
  const property = port === undefined || port === null
    ? config.property
    : `${config.property}[out:${port}]`;

  recordProfile(controller.globalContext, meta, {
    kind: "runtime-payload",
    scope: direction,
    property,
    direction,
    port,
    bytes: estimate.bytes,
    type: estimate.type,
    truncated: estimate.truncated,
    circularRefs: estimate.circularRefs
  }, {
    maxRecords: config.maxRecords
  });

  controller.sampleCount += 1;
  controller.lastSample = {
    direction,
    flowName: meta.flowName,
    nodeName: meta.nodeName,
    nodeType: meta.nodeType,
    property,
    bytes: estimate.bytes,
    bytesFormatted: formatBytes(estimate.bytes),
    timestamp: new Date().toISOString()
  };

  controller.onSample(controller.lastSample);
}

function handleOnSend(sendEvents) {
  if (controllers.size === 0 || !Array.isArray(sendEvents)) {
    return;
  }

  const seen = new Set();

  for (const event of sendEvents) {
    const sourceNode = event && event.source ? event.source.node : null;
    const sourceId = event && event.source ? event.source.id : "";
    const port = event && event.source ? event.source.port : undefined;
    const msg = event ? event.msg : null;

    if (!msg || typeof msg !== "object") {
      continue;
    }

    const messageId = msg._msgid || "no-msgid";
    const seenKey = `${sourceId}|${port ?? ""}|${messageId}`;

    if (seen.has(seenKey)) {
      continue;
    }

    seen.add(seenKey);

    for (const controller of controllers.values()) {
      sampleMessage(controller, "send", sourceNode, msg, port);
    }
  }
}

function handleOnReceive(receiveEvent) {
  if (controllers.size === 0 || !receiveEvent || !receiveEvent.msg) {
    return;
  }

  const destinationNode = receiveEvent.destination ? receiveEvent.destination.node : null;

  for (const controller of controllers.values()) {
    sampleMessage(controller, "receive", destinationNode, receiveEvent.msg);
  }
}

function ensureHooks() {
  if (hooksRegistered) {
    return true;
  }

  const runtimeHooks = getRuntimeHooks();

  if (!runtimeHooks || typeof runtimeHooks.add !== "function") {
    return false;
  }

  runtimeHooks.add(`onSend.${HOOK_LABEL}`, handleOnSend);
  runtimeHooks.add(`onReceive.${HOOK_LABEL}`, handleOnReceive);
  hooksRegistered = true;
  return true;
}

function removeHooksIfIdle() {
  if (!hooksRegistered || controllers.size > 0) {
    return;
  }

  const runtimeHooks = getRuntimeHooks();

  if (runtimeHooks && typeof runtimeHooks.remove === "function") {
    runtimeHooks.remove(`*.${HOOK_LABEL}`);
  }

  hooksRegistered = false;
}

function registerRuntimeProfiler(id, options) {
  if (!ensureHooks()) {
    return {
      ok: false,
      reason: "runtime-hooks-unavailable"
    };
  }

  controllers.set(id, {
    id,
    config: normalizeConfig(options.config),
    globalContext: options.globalContext,
    onSample: typeof options.onSample === "function" ? options.onSample : () => {},
    sampleCount: 0,
    lastSample: null,
    registeredAt: new Date().toISOString()
  });

  return {
    ok: true
  };
}

function unregisterRuntimeProfiler(id) {
  controllers.delete(id);
  removeHooksIfIdle();
}

function getRuntimeProfilerStatus(id) {
  const controller = controllers.get(id);

  if (!controller) {
    return null;
  }

  return {
    id,
    registeredAt: controller.registeredAt,
    sampleCount: controller.sampleCount,
    lastSample: controller.lastSample,
    config: {
      ...controller.config,
      sampleRate: Math.round(controller.config.sampleRate * 10000) / 100
    }
  };
}

module.exports = {
  HOOK_LABEL,
  getRuntimeProfilerStatus,
  normalizeConfig,
  registerRuntimeProfiler,
  shouldProfileNode,
  unregisterRuntimeProfiler
};
