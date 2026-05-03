"use strict";

const { formatBytes } = require("./size");

const SEVERITY_RANK = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3
};

function strongestSeverity(items = []) {
  return items.reduce((selected, item) => {
    const severity = item && item.severity ? item.severity : "ok";
    return (SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[selected] || 0) ? severity : selected;
  }, "ok");
}

function formatPercent(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 1000) / 10 : null;
}

function countBySeverity(alerts, severity) {
  return alerts.filter((alert) => alert.severity === severity).length;
}

function getProfiler(input = {}) {
  return input.profiler || input;
}

function getMemory(input = {}) {
  return input.memory || null;
}

function buildDashboard(input = {}) {
  const profiler = getProfiler(input);
  const memory = getMemory(input);
  const analysis = profiler.analysis || {};
  const alerts = Array.isArray(analysis.alerts) ? analysis.alerts : [];
  const suspects = Array.isArray(analysis.suspects) ? analysis.suspects : [];
  const contextTrends = Array.isArray(analysis.topContextTrends) ? analysis.topContextTrends : [];
  const status = strongestSeverity(alerts.length > 0 ? alerts : suspects);
  const heapUsedRatio = memory && memory.pressure ? memory.pressure.heapUsedRatio : null;
  const heapUsedPercent = formatPercent(heapUsedRatio);
  const topSuspect = suspects[0] ? suspects[0].summary : alerts[0] ? alerts[0].summary : null;

  return {
    status,
    alertCount: alerts.length,
    warningCount: countBySeverity(alerts, "warning"),
    criticalCount: countBySeverity(alerts, "critical"),
    topSuspect,
    heapUsedPercent,
    cards: [
      {
        title: "Heap",
        value: heapUsedPercent === null ? "n/a" : `${heapUsedPercent}%`,
        status: heapUsedPercent !== null && heapUsedPercent >= 85 ? "critical" : heapUsedPercent !== null && heapUsedPercent >= 70 ? "warning" : "ok"
      },
      {
        title: "Alerts",
        value: String(alerts.length),
        status
      },
      {
        title: "Top Context Growth",
        value: contextTrends[0] ? contextTrends[0].contextKey || contextTrends[0].property : "none",
        detail: contextTrends[0] ? contextTrends[0].totalGrowthBytesFormatted || contextTrends[0].deltaBytesFormatted : null,
        status: contextTrends.length > 0 ? "warning" : "ok"
      }
    ],
    tables: {
      alerts,
      suspects,
      contextTrends
    },
    memory: memory && memory.memory ? {
      heapUsed: memory.memory.heapUsed,
      heapUsedFormatted: formatBytes(memory.memory.heapUsed),
      rss: memory.memory.rss,
      rssFormatted: formatBytes(memory.memory.rss)
    } : null
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDashboardHtml(input = {}, options = {}) {
  const dashboard = input.dashboard || buildDashboard(input);
  const title = options.title || "Heap Guardian";
  const alertRows = dashboard.tables.alerts.map((alert) =>
    `<tr><td>${escapeHtml(alert.severity)}</td><td>${escapeHtml(alert.kind)}</td><td>${escapeHtml(alert.summary)}</td></tr>`
  ).join("");
  const suspectRows = dashboard.tables.suspects.slice(0, 10).map((suspect) =>
    `<tr><td>${escapeHtml(suspect.severity)}</td><td>${escapeHtml(suspect.category || suspect.kind)}</td><td>${escapeHtml(suspect.summary)}</td></tr>`
  ).join("");
  const contextTrendRows = dashboard.tables.contextTrends.slice(0, 10).map((trend) =>
    `<tr><td>${escapeHtml(trend.scope || "context")}</td><td>${escapeHtml(trend.contextKey || trend.property)}</td><td>${escapeHtml(trend.totalGrowthBytesFormatted)}</td><td>${escapeHtml(trend.consecutiveGrowthCount)}</td></tr>`
  ).join("");
  const cardHtml = dashboard.cards.map((card) =>
    `<section class="hg-card hg-${escapeHtml(card.status)}"><h2>${escapeHtml(card.title)}</h2><strong>${escapeHtml(card.value)}</strong>${card.detail ? `<p>${escapeHtml(card.detail)}</p>` : ""}</section>`
  ).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f6f7f9; color: #20242a; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    .hg-status { text-transform: uppercase; font-weight: 700; }
    .hg-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
    .hg-card { background: white; border-left: 6px solid #6b7280; padding: 16px; border-radius: 6px; }
    .hg-card h2 { font-size: 13px; margin: 0 0 8px; color: #4b5563; }
    .hg-card strong { font-size: 24px; }
    .hg-warning { border-color: #d97706; }
    .hg-critical { border-color: #dc2626; }
    .hg-ok { border-color: #059669; }
    table { width: 100%; border-collapse: collapse; background: white; margin: 16px 0; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { color: #4b5563; font-size: 13px; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="hg-status">${escapeHtml(dashboard.status)}</div>
  </header>
  <div class="hg-cards">${cardHtml}</div>
  <h2>Alerts</h2>
  <table><thead><tr><th>Severity</th><th>Kind</th><th>Summary</th></tr></thead><tbody>${alertRows || "<tr><td colspan=\"3\">No alerts</td></tr>"}</tbody></table>
  <h2>Suspects</h2>
  <table><thead><tr><th>Severity</th><th>Type</th><th>Summary</th></tr></thead><tbody>${suspectRows || "<tr><td colspan=\"3\">No suspects</td></tr>"}</tbody></table>
  <h2>Context Trends</h2>
  <table><thead><tr><th>Scope</th><th>Key</th><th>Total Growth</th><th>Consecutive Growth</th></tr></thead><tbody>${contextTrendRows || "<tr><td colspan=\"4\">No context trends</td></tr>"}</tbody></table>
</main>
</body>
</html>`;
}

module.exports = {
  buildDashboard,
  renderDashboardHtml,
  strongestSeverity
};
