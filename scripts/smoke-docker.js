"use strict";

const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const nodeRedUrl = (process.env.NODE_RED_URL || "http://localhost:1880").replace(/\/$/, "");
const token = process.env.NODE_RED_TOKEN;
const containerName = process.env.NODE_RED_CONTAINER || "node-red-heap-guardian";

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });

  return typeof output === "string" ? output.trim() : "";
}

function quoteShellArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:=\\-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\\\"")}"`;
}

function runNpm(args) {
  if (process.platform !== "win32") {
    return run("npm", args);
  }

  return execSync(`npm ${args.map(quoteShellArg).join(" ")}`, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe"
  }).trim();
}

function headers(extra = {}) {
  return {
    ...extra,
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: headers()
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function getText(url) {
  const response = await fetch(url, {
    headers: headers()
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text}`);
  }

  return text;
}

async function waitForNodeRed() {
  const deadline = Date.now() + 60000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await getJson(`${nodeRedUrl}/flows`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Node-RED did not become ready: ${lastError ? lastError.message : "timeout"}`);
}

async function deleteExistingLeakLabs() {
  const flows = await getJson(`${nodeRedUrl}/flows`);
  const tabs = flows.filter((node) => node.type === "tab" && node.label === "Heap Leak Lab");

  for (const tab of tabs) {
    const response = await fetch(`${nodeRedUrl}/flow/${tab.id}`, {
      method: "DELETE",
      headers: headers()
    });

    if (!response.ok) {
      throw new Error(`Failed to delete flow ${tab.id}: ${response.status} ${await response.text()}`);
    }
  }

  return tabs.length;
}

function installCurrentPackage() {
  const packageName = runNpm(["pack", "--pack-destination", os.tmpdir()]);
  const packagePath = path.join(os.tmpdir(), packageName.split(/\r?\n/).at(-1));

  try {
    run("docker", ["cp", packagePath, `${containerName}:/tmp/heap-guardian.tgz`], { stdio: "inherit" });
    run("docker", ["compose", "exec", "-T", "-w", "/data", "node-red", "npm", "install", "--no-update-notifier", "--no-fund", "--omit=dev", "/tmp/heap-guardian.tgz"], { stdio: "inherit" });
    run("docker", ["compose", "restart", "node-red"], { stdio: "inherit" });
  } finally {
    fs.rmSync(packagePath, { force: true });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  run("docker", ["compose", "up", "-d", "--build"], { stdio: "inherit" });
  await waitForNodeRed();
  installCurrentPackage();
  await waitForNodeRed();

  const deletedFlows = await deleteExistingLeakLabs();
  run(process.execPath, ["scripts/deploy-example-flow.js", "examples/heap-leak-lab-flow.json"], { stdio: "inherit" });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await getJson(`${nodeRedUrl}/heap-guardian/payload?count=64&bytes=16384`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/payload?count=128&bytes=16384`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/payload?count=192&bytes=16384`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/leak?count=32&bytes=16384`);
  await getJson(`${nodeRedUrl}/heap-guardian/profile/context`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/leak?count=64&bytes=16384`);
  await getJson(`${nodeRedUrl}/heap-guardian/profile/context`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/leak?count=96&bytes=16384`);
  await getJson(`${nodeRedUrl}/heap-guardian/profile/context`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/snapshot`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await getJson(`${nodeRedUrl}/heap-guardian/snapshot`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const report = await getJson(`${nodeRedUrl}/heap-guardian/profile/report`);
  const filtered = await getJson(`${nodeRedUrl}/heap-guardian/profile/report?kind=runtime-payload-key&property=payload.items&limit=3`);
  const metrics = await getJson(`${nodeRedUrl}/heap-guardian/metrics?kind=payload-key&limit=5`);
  const prometheus = await getText(`${nodeRedUrl}/heap-guardian/metrics/prometheus`);
  const dashboardHtml = await getText(`${nodeRedUrl}/heap-guardian/dashboard`);

  const itemsKey = report.analysis.topPayloadKeys.find((item) => item.property === "payload.items" || item.property === "payload.items[out:0]");
  const expander = report.analysis.topExpanders.find((item) => item.nodeName === "build large payload" && item.property === "payload");
  const suspect = report.analysis.suspects[0];
  const contextTrend = report.analysis.topContextTrends.find((item) => item.contextKey === "heapGuardianLeak");

  assert(report.analysis.topGrowers.length > 0, "Expected topGrowers to contain records");
  assert(report.analysis.alerts.length > 0, "Expected alerts to contain leak warnings");
  assert(report.analysis.topTrends.length > 0, "Expected topTrends to contain records");
  assert(contextTrend, "Expected topContextTrends to include heapGuardianLeak");
  assert(report.dashboard && report.dashboard.status !== "ok", "Expected profiler dashboard status to reflect alerts");
  assert(itemsKey, "Expected topPayloadKeys to include payload.items");
  assert(expander, "Expected topExpanders to include build large payload");
  assert(expander.expansionRatio === null, "Expected small receive baseline to suppress expansion ratio");
  assert(expander.ratioStatus === "receive-below-threshold", "Expected receive-below-threshold ratio status");
  assert(suspect && suspect.summary && suspect.severity, "Expected suspects to include summary and severity");
  assert(filtered.matchedRecords >= 1, "Expected filtered report to match runtime payload key records");
  assert(metrics.profiler && metrics.profiler.analysis, "Expected metrics JSON to include profiler analysis");
  assert(metrics.dashboard && metrics.dashboard.status !== "ok", "Expected metrics dashboard status");
  assert(metrics.snapshots && metrics.snapshots.latest && metrics.snapshots.comparison.previous, "Expected snapshot metadata comparison");
  assert(/heap_guardian_profiler_alerts\{severity="warning"\}/.test(prometheus), "Expected Prometheus alert summary metrics");
  assert(/Heap Guardian Leak Lab/.test(dashboardHtml), "Expected dashboard HTML endpoint");

  console.log(JSON.stringify({
    ok: true,
    deletedFlows,
    totalRecords: report.totalRecords,
    matchedRecords: report.matchedRecords,
    topPayloadKey: {
      kind: itemsKey.kind,
      property: itemsKey.property,
      delta: itemsKey.deltaBytesFormatted
    },
    expander: {
      node: expander.nodeName,
      delta: expander.deltaBytesFormatted,
      ratioStatus: expander.ratioStatus
    },
    contextTrend: {
      key: contextTrend.contextKey,
      growth: contextTrend.totalGrowthBytesFormatted
    },
    alertCount: report.analysis.alerts.length,
    dashboardStatus: metrics.dashboard.status,
    snapshotComparison: metrics.snapshots.comparison.previous,
    suspect: {
      severity: suspect.severity,
      summary: suspect.summary
    },
    filteredMatched: filtered.matchedRecords,
    metricsMatched: metrics.profiler.matchedRecords
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
