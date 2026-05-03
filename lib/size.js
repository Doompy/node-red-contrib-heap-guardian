"use strict";

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function classify(value) {
  if (value === null) {
    return "null";
  }

  if (Buffer.isBuffer(value)) {
    return "buffer";
  }

  if (ArrayBuffer.isView(value)) {
    return value.constructor && value.constructor.name ? value.constructor.name : "typed-array";
  }

  if (value instanceof ArrayBuffer) {
    return "array-buffer";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (value instanceof Date) {
    return "date";
  }

  if (value instanceof Map) {
    return "map";
  }

  if (value instanceof Set) {
    return "set";
  }

  return typeof value;
}

function estimateSize(value, options = {}) {
  const seen = new WeakSet();
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 8;
  const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Number(options.maxEntries) : 10000;
  let truncated = false;
  let circularRefs = 0;

  function visit(current, depth) {
    if (current === null || current === undefined) {
      return 0;
    }

    const valueType = typeof current;

    if (valueType === "string") {
      return byteLength(current);
    }

    if (valueType === "number") {
      return 8;
    }

    if (valueType === "bigint") {
      return byteLength(current.toString());
    }

    if (valueType === "boolean") {
      return 4;
    }

    if (valueType === "symbol" || valueType === "function") {
      return 0;
    }

    if (Buffer.isBuffer(current)) {
      return current.length;
    }

    if (ArrayBuffer.isView(current)) {
      return current.byteLength;
    }

    if (current instanceof ArrayBuffer) {
      return current.byteLength;
    }

    if (current instanceof Date) {
      return 8;
    }

    if (depth >= maxDepth) {
      truncated = true;
      return 0;
    }

    if (seen.has(current)) {
      circularRefs += 1;
      return 0;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      return estimateArray(current, depth);
    }

    if (current instanceof Map) {
      return estimateMap(current, depth);
    }

    if (current instanceof Set) {
      return estimateSet(current, depth);
    }

    return estimateObject(current, depth);
  }

  function estimateArray(array, depth) {
    const limit = Math.min(array.length, maxEntries);
    let bytes = 24;

    for (let index = 0; index < limit; index += 1) {
      bytes += visit(array[index], depth + 1);
    }

    if (array.length > limit) {
      truncated = true;
      const sampledAverage = limit > 0 ? (bytes - 24) / limit : 0;
      bytes += Math.round(sampledAverage * (array.length - limit));
    }

    return bytes;
  }

  function estimateMap(map, depth) {
    let bytes = 24;
    let index = 0;
    let sampledBytes = 0;

    for (const [key, item] of map.entries()) {
      if (index >= maxEntries) {
        truncated = true;
        break;
      }

      const entryBytes = visit(key, depth + 1) + visit(item, depth + 1);
      sampledBytes += entryBytes;
      bytes += entryBytes;
      index += 1;
    }

    if (map.size > index && index > 0) {
      bytes += Math.round((sampledBytes / index) * (map.size - index));
    }

    return bytes;
  }

  function estimateSet(set, depth) {
    let bytes = 24;
    let index = 0;
    let sampledBytes = 0;

    for (const item of set.values()) {
      if (index >= maxEntries) {
        truncated = true;
        break;
      }

      const itemBytes = visit(item, depth + 1);
      sampledBytes += itemBytes;
      bytes += itemBytes;
      index += 1;
    }

    if (set.size > index && index > 0) {
      bytes += Math.round((sampledBytes / index) * (set.size - index));
    }

    return bytes;
  }

  function estimateObject(object, depth) {
    let keys;

    try {
      keys = Object.keys(object);
    } catch (error) {
      truncated = true;
      return 0;
    }

    const limit = Math.min(keys.length, maxEntries);
    let bytes = 24;

    for (let index = 0; index < limit; index += 1) {
      const key = keys[index];
      bytes += byteLength(key);

      try {
        bytes += visit(object[key], depth + 1);
      } catch (error) {
        truncated = true;
      }
    }

    if (keys.length > limit) {
      truncated = true;
      const sampledAverage = limit > 0 ? (bytes - 24) / limit : 0;
      bytes += Math.round(sampledAverage * (keys.length - limit));
    }

    return bytes;
  }

  return {
    bytes: visit(value, 0),
    type: classify(value),
    truncated,
    circularRefs
  };
}

function formatChildProperty(parentProperty, key) {
  const parent = parentProperty || "payload";

  if (typeof key === "number") {
    return `${parent}[${key}]`;
  }

  const keyText = String(key);

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyText)) {
    return `${parent}.${keyText}`;
  }

  return `${parent}[${JSON.stringify(keyText)}]`;
}

function readTopLevelEntries(value, options = {}) {
  const maxKeys = Math.max(0, Number.isFinite(Number(options.maxKeys)) ? Number(options.maxKeys) : 10);
  const maxScanKeys = Math.max(maxKeys, Number.isFinite(Number(options.maxScanKeys)) ? Number(options.maxScanKeys) : 50);

  if (maxKeys === 0 || value === null || value === undefined || typeof value !== "object") {
    return [];
  }

  let entries;

  if (Array.isArray(value)) {
    entries = value.slice(0, maxScanKeys).map((item, index) => [index, item]);
  } else if (value instanceof Map) {
    entries = Array.from(value.entries()).slice(0, maxScanKeys);
  } else if (value instanceof Set) {
    entries = Array.from(value.values()).slice(0, maxScanKeys).map((item, index) => [index, item]);
  } else if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) {
    return [];
  } else {
    let keys;

    try {
      keys = Object.keys(value).slice(0, maxScanKeys);
    } catch (error) {
      return [];
    }

    entries = keys.map((key) => [key, value[key]]);
  }

  return entries
    .map(([key, item]) => {
      const estimate = estimateSize(item, options);

      return {
        key: String(key),
        property: formatChildProperty(options.parentProperty, key),
        bytes: estimate.bytes,
        bytesFormatted: formatBytes(estimate.bytes),
        type: estimate.type,
        truncated: estimate.truncated,
        circularRefs: estimate.circularRefs
      };
    })
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, maxKeys);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "n/a";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${Math.round(value * 10) / 10}${units[unitIndex]}`;
}

module.exports = {
  classify,
  estimateSize,
  formatChildProperty,
  readTopLevelEntries,
  formatBytes
};
