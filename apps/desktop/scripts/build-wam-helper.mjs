import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");
const pythonCandidates = [
  process.env.OPENCRAB_PYTHON,
  path.join(repoRoot, ".venv", "Scripts", "python.exe"),
  "python.exe",
].filter(Boolean);
const python = pythonCandidates.find((candidate) =>
  candidate === "python.exe" || fs.existsSync(candidate),
);

if (!python) throw new Error("Python runtime for the WAM helper build was not found.");

const outputRoot = path.join(appRoot, "native", "wam-broker");
const output = path.join(outputRoot, "dist", "opencrab-wam-broker.exe");
const args = [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name",
  "opencrab-wam-broker",
  "--distpath",
  path.join(outputRoot, "dist"),
  "--workpath",
  path.join(outputRoot, "build"),
  "--specpath",
  path.join(outputRoot, "spec"),
  "--collect-all",
  "pymsalruntime",
  "--hidden-import",
  "msal.broker",
  path.join(repoRoot, "opencrab_starter", "wam_broker.py"),
];

await new Promise((resolve, reject) => {
  const child = spawn(python, args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`WAM helper build exited with code ${code}.`));
  });
});

if (!fs.existsSync(output)) throw new Error("WAM helper build did not produce an executable.");
console.log(`WAM helper ready: ${output}`);
