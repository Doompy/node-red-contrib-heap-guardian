"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_HISTORY_MAX_BYTES = 50 * 1024 * 1024;

function parseBytes(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback;
}

function getHistoryConfig(env = process.env) {
  return {
    file: env.HEAP_GUARDIAN_HISTORY_FILE || "",
    maxBytes: parseBytes(env.HEAP_GUARDIAN_HISTORY_MAX_BYTES, DEFAULT_HISTORY_MAX_BYTES)
  };
}

function rotateIfNeeded(filePath, maxBytes) {
  if (!filePath || maxBytes <= 0 || !fs.existsSync(filePath)) {
    return;
  }

  const stats = fs.statSync(filePath);

  if (stats.size < maxBytes) {
    return;
  }

  const rotatedPath = `${filePath}.1`;
  fs.rmSync(rotatedPath, { force: true });
  fs.renameSync(filePath, rotatedPath);
}

function appendHistoryEntry(entry, options = {}) {
  const config = {
    ...getHistoryConfig(options.env),
    ...options
  };

  if (!config.file) {
    return {
      written: false,
      reason: "history-file-disabled"
    };
  }

  const filePath = path.resolve(config.file);
  const directory = path.dirname(filePath);

  fs.mkdirSync(directory, { recursive: true });
  rotateIfNeeded(filePath, config.maxBytes);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");

  return {
    written: true,
    path: filePath
  };
}

module.exports = {
  DEFAULT_HISTORY_MAX_BYTES,
  appendHistoryEntry,
  getHistoryConfig,
  rotateIfNeeded
};
