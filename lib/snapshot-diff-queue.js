"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_MAX_SNAPSHOT_DIFF_BYTES,
  DEFAULT_SNAPSHOT_DIFF_TIMEOUT_MS
} = require("./snapshot-diff");

const SNAPSHOT_DIFF_QUEUE_KEY = "heapGuardianSnapshotDiffQueue";

function readQueueState(globalContext) {
  const existing = globalContext && typeof globalContext.get === "function"
    ? globalContext.get(SNAPSHOT_DIFF_QUEUE_KEY)
    : null;

  if (existing && existing.version === 1) {
    return existing;
  }

  return {
    version: 1,
    updatedAt: null,
    currentJob: null,
    latestResult: null,
    jobs: []
  };
}

function writeQueueState(globalContext, state) {
  state.updatedAt = new Date().toISOString();

  if (globalContext && typeof globalContext.set === "function") {
    globalContext.set(SNAPSHOT_DIFF_QUEUE_KEY, state);
  }
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

function makeJobId() {
  return `diff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeState(state) {
  return {
    updatedAt: state.updatedAt,
    currentJob: state.currentJob,
    latestResult: state.latestResult,
    jobs: Array.isArray(state.jobs) ? state.jobs.slice(-10) : []
  };
}

function skipResult(reason, extra = {}) {
  return {
    started: false,
    status: "skipped",
    reason,
    ...extra
  };
}

function startSnapshotDiffJob(globalContext, previousPath, latestPath, options = {}) {
  const state = readQueueState(globalContext);
  const maxSnapshotDiffBytes = Number.isFinite(Number(options.maxSnapshotDiffBytes))
    ? Math.max(0, Number(options.maxSnapshotDiffBytes))
    : DEFAULT_MAX_SNAPSHOT_DIFF_BYTES;
  const timeoutMs = Number.isFinite(Number(options.snapshotDiffTimeoutMs))
    ? Math.max(1, Number(options.snapshotDiffTimeoutMs))
    : DEFAULT_SNAPSHOT_DIFF_TIMEOUT_MS;
  const limit = Number.isFinite(Number(options.snapshotDiffLimit))
    ? Math.max(1, Number(options.snapshotDiffLimit))
    : 20;

  if (!previousPath || !latestPath) {
    return skipResult("missing-snapshot-path");
  }

  if (!fs.existsSync(previousPath) || !fs.existsSync(latestPath)) {
    return skipResult("snapshot-file-missing");
  }

  const previousBytes = fileSize(previousPath);
  const latestBytes = fileSize(latestPath);

  if (previousBytes > maxSnapshotDiffBytes || latestBytes > maxSnapshotDiffBytes) {
    return skipResult("snapshot-too-large", {
      maxSnapshotDiffBytes,
      previousBytes,
      latestBytes
    });
  }

  if (state.currentJob && state.currentJob.status === "running") {
    return {
      started: false,
      status: "running",
      reason: "job-already-running",
      job: state.currentJob
    };
  }

  if (
    state.latestResult
    && state.latestResult.previousPath === previousPath
    && state.latestResult.latestPath === latestPath
  ) {
    return {
      started: false,
      status: "completed",
      reason: "diff-already-current",
      result: state.latestResult
    };
  }

  const job = {
    id: makeJobId(),
    status: "running",
    previousPath,
    latestPath,
    startedAt: new Date().toISOString()
  };
  const workerPath = path.join(__dirname, "snapshot-diff-worker.js");
  const child = spawn(process.execPath, [workerPath, previousPath, latestPath, String(limit)], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let completed = false;
  const timer = setTimeout(() => {
    if (!completed) {
      child.kill("SIGTERM");
    }
  }, timeoutMs);

  state.currentJob = job;
  state.jobs = [...(Array.isArray(state.jobs) ? state.jobs : []), job].slice(-20);
  writeQueueState(globalContext, state);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("close", (code, signal) => {
    completed = true;
    clearTimeout(timer);

    const nextState = readQueueState(globalContext);
    const finishedJob = {
      ...job,
      status: code === 0 ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      code,
      signal
    };

    if (code === 0) {
      try {
        nextState.latestResult = {
          jobId: job.id,
          completedAt: finishedJob.completedAt,
          ...JSON.parse(stdout)
        };
      } catch (error) {
        finishedJob.status = "failed";
        finishedJob.error = error.message;
      }
    } else {
      finishedJob.error = signal === "SIGTERM" ? "snapshot-diff-timeout" : stderr || `exit-${code}`;
    }

    nextState.currentJob = null;
    nextState.jobs = [
      ...(Array.isArray(nextState.jobs) ? nextState.jobs.filter((item) => item.id !== job.id) : []),
      finishedJob
    ].slice(-20);
    writeQueueState(globalContext, nextState);
  });

  return {
    started: true,
    status: "running",
    job
  };
}

function maybeStartSnapshotDiffJob(globalContext, snapshots, options = {}) {
  if (options.snapshotDiffAsyncEnabled !== true) {
    return skipResult("async-diff-disabled");
  }

  const latest = snapshots && snapshots.latest;
  const previous = snapshots && snapshots.previous;

  return startSnapshotDiffJob(
    globalContext,
    previous && previous.path,
    latest && latest.path,
    options
  );
}

function getSnapshotDiffQueueReport(globalContext) {
  const state = readQueueState(globalContext);
  const latestResult = state.latestResult || null;
  const currentJob = state.currentJob || null;

  return {
    status: currentJob ? currentJob.status : latestResult ? "completed" : "idle",
    currentJob,
    latestResult,
    state: summarizeState(state)
  };
}

module.exports = {
  SNAPSHOT_DIFF_QUEUE_KEY,
  getSnapshotDiffQueueReport,
  maybeStartSnapshotDiffJob,
  readQueueState,
  startSnapshotDiffJob
};
