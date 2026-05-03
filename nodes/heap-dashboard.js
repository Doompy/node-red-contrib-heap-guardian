"use strict";

const { renderDashboardHtml } = require("../lib/dashboard");

module.exports = function registerHeapDashboard(RED) {
  function HeapDashboardNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const title = config.title || config.name || "Heap Guardian";

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        msg.payload = renderDashboardHtml(msg.payload || {}, { title });
        msg.headers = {
          ...(msg.headers || {}),
          "content-type": "text/html; charset=utf-8"
        };

        node.status({ fill: "blue", shape: "dot", text: "dashboard html" });
        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "dashboard failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("heap-dashboard", HeapDashboardNode);
};
