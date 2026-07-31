import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputRoot = path.resolve(
  desktopRoot,
  process.env.ORBIT_BUILD_OUTPUT || "release/production-build",
);

const sourceStatus = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", "apps/desktop"],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
if (sourceStatus) {
  throw new Error(
    "Production packaging requires committed ORBIT desktop source. "
    + "Commit or intentionally restore the listed app changes before release.",
  );
}

const executables = fs.existsSync(outputRoot)
  ? fs.readdirSync(outputRoot)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .map((name) => path.join(outputRoot, name))
  : [];
if (!executables.length) {
  throw new Error(`No production installer was found in ${outputRoot}.`);
}

const signatureScript = [
  "$ErrorActionPreference = 'Stop'",
  "$items = @($args | ForEach-Object {",
  "  $signature = Get-AuthenticodeSignature -LiteralPath $_",
  "  [pscustomobject]@{ Path = $_; Status = [string]$signature.Status }",
  "})",
  "$items | ConvertTo-Json -Compress",
].join("; ");
const raw = execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", signatureScript, ...executables],
  { encoding: "utf8" },
).trim();
const parsed = JSON.parse(raw);
const signatures = Array.isArray(parsed) ? parsed : [parsed];
const unsigned = signatures.filter((item) => item.Status !== "Valid");
if (unsigned.length) {
  throw new Error(
    `Production installer signing failed: ${unsigned
      .map((item) => `${path.basename(item.Path)} (${item.Status})`)
      .join(", ")}`,
  );
}

console.log(JSON.stringify({ status: "valid", executables: signatures }, null, 2));
