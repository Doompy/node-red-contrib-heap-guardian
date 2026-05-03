"use strict";

const v8 = require("node:v8");

function ratio(used, limit) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }

  return used / limit;
}

function roundRatio(value) {
  if (value === null) {
    return null;
  }

  return Math.round(value * 10000) / 10000;
}

function getConstrainedMemory() {
  if (typeof process.constrainedMemory !== "function") {
    return 0;
  }

  return process.constrainedMemory();
}

function getHeapSpaces() {
  return v8.getHeapSpaceStatistics().map((space) => ({
    name: space.space_name,
    size: space.space_size,
    used: space.space_used_size,
    available: space.space_available_size,
    physical: space.physical_space_size,
    usedRatio: roundRatio(ratio(space.space_used_size, space.space_size))
  }));
}

function findSpace(spaces, name) {
  return spaces.find((space) => space.name === name) || null;
}

function getMemoryState(options = {}) {
  const includeSpaces = options.includeSpaces !== false;
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const spaces = getHeapSpaces();
  const oldSpace = findSpace(spaces, "old_space");
  const constrainedMemory = getConstrainedMemory();

  const state = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },
    heap: {
      totalHeapSize: heap.total_heap_size,
      totalPhysicalSize: heap.total_physical_size,
      totalAvailableSize: heap.total_available_size,
      usedHeapSize: heap.used_heap_size,
      heapSizeLimit: heap.heap_size_limit,
      mallocedMemory: heap.malloced_memory,
      peakMallocedMemory: heap.peak_malloced_memory,
      externalMemory: heap.external_memory,
      numberOfNativeContexts: heap.number_of_native_contexts,
      numberOfDetachedContexts: heap.number_of_detached_contexts
    },
    pressure: {
      heapUsedRatio: roundRatio(ratio(memory.heapUsed, heap.heap_size_limit)),
      v8UsedRatio: roundRatio(ratio(heap.used_heap_size, heap.heap_size_limit)),
      rssRatio: roundRatio(ratio(memory.rss, constrainedMemory)),
      oldSpaceUsedRatio: oldSpace ? oldSpace.usedRatio : null
    }
  };

  if (includeSpaces) {
    state.spaces = spaces;
  }

  if (constrainedMemory > 0) {
    state.constrainedMemory = constrainedMemory;
  }

  return state;
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
  formatBytes,
  getMemoryState
};
