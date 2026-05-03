"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const roots = ["lib", "nodes", "scripts", "test"];

function listJavaScriptFiles(directory) {
  const absoluteDirectory = path.join(projectRoot, directory);

  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(absoluteDirectory, entry.name);

    if (entry.isDirectory()) {
      return listJavaScriptFiles(path.relative(projectRoot, fullPath));
    }

    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

const files = roots.flatMap(listJavaScriptFiles);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
