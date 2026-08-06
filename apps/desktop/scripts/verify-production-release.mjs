import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(desktopRoot, "../..");

export function buildSignatureScript(paths) {
  // `powershell.exe -Command <string>` does not bind trailing arguments to
  // `$args`; they are appended to the command text instead. Passing the
  // installer paths that way leaves `$items` empty, produces no stdout and
  // makes the whole check fail with a JSON parse error regardless of the real
  // signature status. The file list therefore has to be embedded in the script.
  const literals = paths.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(",");
  return [
    // Loaded explicitly so a broken module path fails with a clear error
    // instead of a confusing autoload failure inside ForEach-Object.
    "Import-Module Microsoft.PowerShell.Security",
    "$ErrorActionPreference = 'Stop'",
    `$items = @(@(${literals}) | ForEach-Object {`,
    "  $signature = Get-AuthenticodeSignature -LiteralPath $_",
    "  [pscustomobject]@{ Path = $_; Status = [string]$signature.Status }",
    "})",
    "$items | ConvertTo-Json -Compress -Depth 3",
  ].join("; ");
}

export function powershellEnvironment(base = process.env) {
  // When this script is launched from PowerShell 7 (the default GitHub
  // Actions shell), the inherited PSModulePath points at PS7 module
  // directories. Windows PowerShell 5.1 then resolves
  // Microsoft.PowerShell.Security to the incompatible PS7 copy and
  // Get-AuthenticodeSignature fails to load. Dropping the variable lets
  // 5.1 rebuild its own default module path.
  const environment = { ...base };
  delete environment.PSModulePath;
  return environment;
}

export function parseSignatureOutput(raw, expectedCount) {
  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("Authenticode verification returned no result.");
  }
  const parsed = JSON.parse(text);
  const signatures = Array.isArray(parsed) ? parsed : [parsed];
  if (signatures.length !== expectedCount) {
    throw new Error(
      `Authenticode verification covered ${signatures.length} of ${expectedCount} installers.`,
    );
  }
  return signatures;
}

export function assertSigned(signatures) {
  const unsigned = signatures.filter((item) => item.Status !== "Valid");
  if (!unsigned.length) return signatures;
  throw new Error(
    `Production installer signing failed: ${unsigned
      .map((item) => `${path.basename(item.Path)} (${item.Status})`)
      .join(", ")}. `
    + "Set the signing certificate before release: WIN_CSC_LINK and "
    + "WIN_CSC_KEY_PASSWORD, or win.certificateSubjectName in "
    + "electron-builder.production.cjs.",
  );
}

function main() {
  const outputRoot = path.resolve(
    desktopRoot,
    process.env.ORBIT_BUILD_OUTPUT || "release/production-build",
  );

  const sourceStatus = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  if (sourceStatus) {
    throw new Error(
      "Production packaging requires a clean committed repository because the installer includes "
      + "desktop, Python backend, scripts, and knowledge resources. Commit or intentionally restore "
      + "all listed changes before release.",
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

  const raw = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", buildSignatureScript(executables)],
    { encoding: "utf8", env: powershellEnvironment() },
  );
  const signatures = assertSigned(parseSignatureOutput(raw, executables.length));

  console.log(JSON.stringify({ status: "valid", executables: signatures }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
