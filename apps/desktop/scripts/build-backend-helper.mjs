import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const buildRoot = path.join(desktopRoot, "native", "backend");
const specRoot = path.join(buildRoot, "spec");
const entry = path.join(buildRoot, "opencrab-backend.py");
const pythonCandidates = [
  process.env.OPENCRAB_PYTHON,
  path.join(repoRoot, ".venv", "Scripts", "python.exe"),
  "python.exe",
].filter(Boolean);
const python = pythonCandidates.find((candidate) =>
  candidate === "python.exe" || fs.existsSync(candidate),
);

if (!python) throw new Error("Python runtime for the desktop backend build was not found.");
fs.mkdirSync(specRoot, { recursive: true });

const hiddenImports = [
  "scripts.ingest_business_style_index",
  "scripts.ingest_mail_thin_index",
  "scripts.visual_sketch_index",
  "scripts.export_outlook_recent_mail",
  "scripts.validate_workbook_layout",
  "opencrab_starter.agent_synthesis",
  "opencrab_starter.buyer_signals",
  "opencrab_starter.decision_engine",
  "opencrab_starter.sbd_validator",
  "opencrab_starter.work_agent",
  "opencrab_starter.workbook_prepare",
  "opencrab_starter.workflow_control",
];
const dataFiles = [
  [path.join(repoRoot, "scripts", "run_codex_synthesis.mjs"), "scripts"],
  [
    path.join(repoRoot, "knowledge", "work_agent_synthesis.schema.json"),
    "knowledge",
  ],
];
const args = [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name",
  "opencrab-backend",
  "--distpath",
  path.join(buildRoot, "dist"),
  "--workpath",
  path.join(buildRoot, "build"),
  "--specpath",
  specRoot,
  "--paths",
  repoRoot,
  ...hiddenImports.flatMap((name) => ["--hidden-import", name]),
  ...dataFiles.flatMap(([source, destination]) => [
    "--add-data",
    `${source}${path.delimiter}${destination}`,
  ]),
  entry,
];

await new Promise((resolve, reject) => {
  const child = spawn(python, args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Desktop backend build failed with exit code ${code}.`));
  });
});
