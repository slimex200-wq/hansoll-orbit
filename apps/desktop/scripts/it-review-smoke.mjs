import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const explicitExecutable = process.argv[2] || process.env.ORBIT_PACKAGED_EXE;
const executablePath = explicitExecutable
  || path.join(desktopRoot, "release", "it-review-build", "win-unpacked", "HANSOLL ORBIT.exe");
const verificationDirectory = path.resolve(path.dirname(executablePath), "..", "verification");

assert.ok(fs.existsSync(executablePath), `Packaged executable not found: ${executablePath}`);

function latestModifiedAt(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(target, { withFileTypes: true }).reduce(
    (latest, entry) => Math.max(latest, latestModifiedAt(path.join(target, entry.name))),
    stat.mtimeMs,
  );
}

if (!explicitExecutable) {
  const latestSource = Math.max(
    latestModifiedAt(path.join(desktopRoot, "dist")),
    latestModifiedAt(path.join(desktopRoot, "src")),
    latestModifiedAt(path.join(desktopRoot, "electron")),
    latestModifiedAt(path.join(desktopRoot, "package.json")),
    latestModifiedAt(path.join(desktopRoot, "vite.config.ts")),
    latestModifiedAt(path.join(desktopRoot, "tsconfig.json")),
  );
  const packagedAt = fs.statSync(executablePath).mtimeMs;
  assert.ok(
    packagedAt >= latestSource,
    "IT review package is older than the current app. Run npm run package:it:dir or pass ORBIT_PACKAGED_EXE.",
  );
}
fs.mkdirSync(verificationDirectory, { recursive: true });

const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-packaged-review-"));
const application = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${userDataDirectory}`],
});

try {
  const window = await application.firstWindow();
  window.setDefaultTimeout(120_000);
  await window.locator(".desktop-frame").waitFor();
  await window.getByText("IT 검토용", { exact: true }).waitFor();
  assert.equal(
    await window.getByText(/271900010|@hansoll|shjung1|OneDrive/i).count(),
    0,
    "The packaged review UI exposed a production example or local business identifier.",
  );
  await window.screenshot({
    path: path.join(verificationDirectory, "packaged-it-review.png"),
    fullPage: true,
  });

  const state = await window.evaluate(() => window.opencrab.getState());
  assert.equal(state.cases.length, 2);
  assert.equal(state.tasks.length, 3);
  assert.ok(state.cases.every((item) => item.title.includes("DEMO-STYLE-")));

  const audit = await window.evaluate(() => window.opencrab.audit());
  assert.ok(audit.items.some((item) => item.name === "review_mode"));

  const search = await window.evaluate(() => window.opencrab.search("DEMO-STYLE-001"));
  assert.equal(search.styles[0].style_no, "DEMO-STYLE-001");

  const agent = await window.evaluate(() => window.opencrab.runAgent("오늘 업무 정리"));
  assert.equal(agent.synthesis.fallback_reason, "it_review_mode");

  const microsoft = await window.evaluate(() => window.opencrab.getMicrosoftStatus());
  assert.equal(microsoft.configured, false);
  assert.match(microsoft.machineConfigPath, /desktop-config\.json$/i);

  const { machineConfigPath: _machineConfigPath, ...microsoftWithoutLocalPath } = microsoft;
  const serialized = JSON.stringify({
    state,
    audit,
    search,
    agent,
    microsoft: microsoftWithoutLocalPath,
  });
  assert.doesNotMatch(serialized, /OneDrive|shjung1|@hansoll|271900010/i);

  console.log(JSON.stringify({
    status: "PASS",
    executablePath,
    cases: state.cases.length,
    tasks: state.tasks.length,
    outlookConfigured: microsoft.configured,
    reviewMode: true,
  }, null, 2));
} finally {
  await application.close();
}
