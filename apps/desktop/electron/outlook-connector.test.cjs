const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

// The connector is executed with `powershell.exe -File` (Windows PowerShell
// 5.1). A construct 5.1 cannot parse — for example a continuation line that
// starts with a binary operator — disables Classic Outlook mail sync entirely,
// and nothing else in the suite executes this script. Parse it with the real
// 5.1 parser so CI rejects such an edit before it ships.
test(
  "classic Outlook connector parses under Windows PowerShell 5.1",
  { skip: process.platform !== "win32" ? "Windows only" : false },
  () => {
    const script = path
      .join(__dirname, "outlook-desktop.ps1")
      .replace(/'/g, "''");
    const command = [
      "$tokens = $null; $errors = $null",
      `[void][System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$tokens, [ref]$errors)`,
      "if ($errors.Count) {",
      "  $errors | ForEach-Object { Write-Output $_.Message }",
      "  exit 1",
      "}",
      "'PARSE_OK'",
    ].join("; ");
    const output = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8" },
    );
    assert.match(output, /PARSE_OK/, `connector failed to parse: ${output}`);
  },
);
