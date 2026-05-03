"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDashboard, renderDashboardHtml } = require("../lib/dashboard");

test("buildDashboard summarizes alerts and suspects", () => {
  const dashboard = buildDashboard({
    memory: {
      memory: {
        heapUsed: 1024,
        rss: 2048
      },
      pressure: {
        heapUsedRatio: 0.75
      }
    },
    profiler: {
      analysis: {
        alerts: [
          {
            severity: "warning",
            kind: "context-growth",
            summary: "global.cache grew"
          }
        ],
        suspects: [
          {
            severity: "warning",
            summary: "global.cache is large"
          }
        ],
        topContextTrends: []
      }
    }
  });

  assert.equal(dashboard.status, "warning");
  assert.equal(dashboard.alertCount, 1);
  assert.equal(dashboard.heapUsedPercent, 75);
  assert.equal(dashboard.topSuspect, "global.cache is large");
});

test("renderDashboardHtml returns standalone HTML", () => {
  const html = renderDashboardHtml({
    dashboard: {
      status: "ok",
      cards: [],
      tables: {
        alerts: [],
        suspects: [],
        contextTrends: [
          {
            scope: "global",
            contextKey: "cache",
            totalGrowthBytesFormatted: "1MB",
            consecutiveGrowthCount: 3
          }
        ]
      }
    }
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /Heap Guardian/);
  assert.match(html, /Context Trends/);
  assert.match(html, /cache/);
});
