import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");

function resolveOutputRoot() {
  return path.resolve(
    desktopRoot,
    process.env.ORBIT_BUILD_OUTPUT || "release/production-build",
  );
}

function assertFile(root, relativePath) {
  const target = path.join(root, relativePath);
  assert.ok(fs.existsSync(target), `Missing packaged file: ${relativePath}`);
  const stats = fs.statSync(target);
  assert.ok(stats.isFile(), `Packaged path is not a file: ${relativePath}`);
  assert.ok(stats.size > 0, `Packaged file is empty: ${relativePath}`);
  return target;
}

function assertDirectory(root, relativePath) {
  const target = path.join(root, relativePath);
  assert.ok(fs.existsSync(target), `Missing packaged directory: ${relativePath}`);
  assert.ok(fs.statSync(target).isDirectory(), `Packaged path is not a directory: ${relativePath}`);
  return target;
}

function normalizeAsarPath(entry) {
  return entry.replaceAll("\\", "/").replace(/^\//, "");
}

function assertNoPackagedLeaks(entries) {
  const normalized = entries.map(normalizeAsarPath);
  const forbidden = [
    /^electron\/.*\.test\.(cjs|mjs|js)$/i,
    /^scripts\//i,
    /^src\//i,
    /^it-review\//i,
    /(^|\/)__tests__(\/|$)/i,
    /(^|\/)(fixtures?|samples?)(\/|$)/i,
    /(^|\/)\.env($|\.)/i,
  ];
  const leaked = normalized.filter((entry) => forbidden.some((pattern) => pattern.test(entry)));
  assert.deepEqual(leaked, [], `Production app.asar contains non-production files: ${leaked.join(", ")}`);
}

function verifyProductionDirectory() {
  const outputRoot = resolveOutputRoot();
  const unpackedRoot = assertDirectory(outputRoot, "win-unpacked");
  const resourcesRoot = assertDirectory(unpackedRoot, "resources");

  assertFile(unpackedRoot, "HANSOLL ORBIT.exe");
  assertFile(resourcesRoot, "app.asar");
  assertFile(resourcesRoot, path.join("native", "opencrab-backend.exe"));
  assertFile(resourcesRoot, path.join("native", "opencrab-wam-broker.exe"));
  assertFile(resourcesRoot, path.join("native", "outlook-desktop.ps1"));
  assertDirectory(resourcesRoot, path.join("runtime", "knowledge", "buyers"));
  assertFile(resourcesRoot, path.join("runtime", "knowledge", "talbots_workflow_rules.md"));
  assertFile(resourcesRoot, path.join("runtime", "knowledge", "opencrab_9spaces_grammar.md"));
  assertFile(resourcesRoot, path.join("runtime", "knowledge", "work_agent_quality.schema.json"));
  assertFile(resourcesRoot, path.join("runtime", "knowledge", "work_agent_synthesis.schema.json"));
  assertDirectory(resourcesRoot, path.join("runtime", "knowledge", "workbook_layout_specs"));

  const asarPath = path.join(resourcesRoot, "app.asar");
  const asarEntries = listPackage(asarPath);
  const asarEntrySet = new Set(asarEntries.map(normalizeAsarPath));
  for (const required of [
    "dist/index.html",
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/domain-store.cjs",
    "electron/local-state-io.cjs",
    "electron/domain-backup.cjs",
    "package.json",
  ]) {
    assert.ok(asarEntrySet.has(required), `Production app.asar is missing ${required}`);
  }
  assertNoPackagedLeaks(asarEntries);

  const packagedPackage = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
  assert.equal(packagedPackage.name, "hansoll-orbit-desktop");
  assert.equal(packagedPackage.productName, "HANSOLL ORBIT");
  assert.equal(packagedPackage.private, true);
  assert.ok(!packagedPackage.devDependencies, "Production package metadata must not include devDependencies");

  return {
    status: "PASS",
    outputRoot,
    executable: path.join(unpackedRoot, "HANSOLL ORBIT.exe"),
    checked: {
      asarEntries: asarEntries.length,
      nativeResources: 3,
      runtimeKnowledge: 5,
    },
  };
}

try {
  console.log(JSON.stringify(verifyProductionDirectory(), null, 2));
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
