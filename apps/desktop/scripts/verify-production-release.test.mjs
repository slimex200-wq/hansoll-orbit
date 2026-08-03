import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  assertSigned,
  buildSignatureScript,
  parseSignatureOutput,
} from "./verify-production-release.mjs";

test("signature script embeds installer paths instead of relying on $args", () => {
  const script = buildSignatureScript(["C:\\out\\ORBIT it's.exe"]);
  assert.doesNotMatch(script, /\$args/);
  assert.match(script, /'C:\\out\\ORBIT it''s\.exe'/);
});

test("empty PowerShell output fails with an actionable message", () => {
  assert.throws(
    () => parseSignatureOutput("", 1),
    /Authenticode verification returned no result/,
  );
  assert.throws(
    () => parseSignatureOutput('{"Path":"a.exe","Status":"Valid"}', 2),
    /covered 1 of 2 installers/,
  );
});

test("unsigned installers report the signing configuration to set", () => {
  assert.throws(
    () => assertSigned([{ Path: "C:\\out\\ORBIT.exe", Status: "NotSigned" }]),
    /ORBIT\.exe \(NotSigned\).*WIN_CSC_LINK/s,
  );
  assert.deepEqual(
    assertSigned([{ Path: "C:\\out\\ORBIT.exe", Status: "Valid" }]),
    [{ Path: "C:\\out\\ORBIT.exe", Status: "Valid" }],
  );
});

test(
  "PowerShell returns a parseable status for a real executable",
  { skip: process.platform !== "win32" ? "Windows only" : false },
  () => {
    const target = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\notepad.exe`;
    const raw = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", buildSignatureScript([target])],
      { encoding: "utf8" },
    );
    const [signature] = parseSignatureOutput(raw, 1);
    assert.equal(signature.Path.toLowerCase(), target.toLowerCase());
    assert.ok(signature.Status, "Get-AuthenticodeSignature returned no status");
  },
);
