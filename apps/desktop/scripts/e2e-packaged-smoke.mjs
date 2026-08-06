import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const executablePath = path.resolve(
  process.env.ORBIT_E2E_EXECUTABLE
    || path.join(desktopRoot, "release", "production-build", "win-unpacked", "HANSOLL ORBIT.exe"),
);
assert.ok(fs.existsSync(executablePath), `Packaged executable is missing: ${executablePath}`);
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-packaged-e2e-"));

async function launch() {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`],
    env: {
      ...process.env,
      OPENCRAB_E2E_MODE: "1",
      OPENCRAB_E2E_EMPTY_STATE: "1",
      OPENCRAB_DESKTOP_CONFIG_PATH: path.join(userDataDirectory, "no-microsoft-config.json"),
    },
  });
  const window = await application.firstWindow();
  window.setDefaultTimeout(60_000);
  await window.waitForFunction(() => Boolean(window.opencrab?.getState));
  return { application, window };
}

let session = await launch();
try {
  assert.equal(await session.window.title(), "HANSOLL ORBIT");
  assert.equal(
    await session.window.getByTestId("desktop-titlebar").getByText("IT 검토용", { exact: true }).count(),
    0,
    "A production package must not expose synthetic review mode.",
  );
  const initial = await session.window.evaluate(() => window.opencrab.getState());
  assert.equal(initial.cases.length, 0);
  await session.window.evaluate(() => window.opencrab.createCase({
    title: "PACKAGED-OFFLINE-SMOKE",
    summary: "Sanitized packaged persistence evidence.",
  }));
} finally {
  await session.application.close();
}

session = await launch();
try {
  const restarted = await session.window.evaluate(() => window.opencrab.getState());
  assert.equal(restarted.cases.length, 1);
  assert.equal(restarted.cases[0].title, "PACKAGED-OFFLINE-SMOKE");
  assert.equal(restarted.cases[0].fieldOrigins.summary.origin, "manual");
  const health = await session.window.evaluate(() => window.opencrab.getLocalStateHealth());
  assert.equal(health.status, "healthy");
} finally {
  await session.application.close();
}

console.log(JSON.stringify({
  status: "PASS",
  executablePath,
  scenarios: ["packaged-startup", "production-mode", "offline-local-write", "packaged-restart"],
}, null, 2));
