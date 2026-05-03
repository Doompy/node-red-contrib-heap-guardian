"use strict";

const { formatBytes, getMemoryState } = require("../lib/memory");

module.exports = function registerHeapMonitor(RED) {
  function HeapMonitorNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const includeSpaces = config.includeSpaces !== false && config.includeSpaces !== "false";

    node.on("input", (msg, send, done) => {
      const nodeSend = send || ((message) => node.send(message));
      const nodeDone = done || ((error) => {
        if (error) {
          node.error(error, msg);
        }
      });

      try {
        const state = getMemoryState({ includeSpaces });
        msg.payload = state;
        msg.heapGuardian = state;

        const pressure = state.pressure.heapUsedRatio;
        const percent = pressure === null ? "n/a" : `${Math.round(pressure * 100)}%`;
        node.status({
          fill: pressure !== null && pressure >= 0.8 ? "yellow" : "green",
          shape: "dot",
          text: `heap ${formatBytes(state.memory.heapUsed)} / ${percent}`
        });

        nodeSend(msg);
        nodeDone();
      } catch (error) {
        node.status({ fill: "red", shape: "ring", text: "memory read failed" });
        nodeDone(error);
      }
    });
  }

  RED.nodes.registerType("heap-monitor", HeapMonitorNode);
};
