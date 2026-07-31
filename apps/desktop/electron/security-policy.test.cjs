const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  isAllowedExternalUrl,
  isAllowedTemplatePath,
  resolveDevelopmentRendererUrl,
} = require("./security-policy.cjs");

test("packaged builds ignore renderer URLs from the environment", () => {
  assert.equal(
    resolveDevelopmentRendererUrl({
      configuredUrl: "https://attacker.example/app",
      isPackaged: true,
    }),
    "",
  );
});

test("development renderer is restricted to loopback HTTP origins", () => {
  assert.equal(
    resolveDevelopmentRendererUrl({
      configuredUrl: "http://127.0.0.1:5173",
      isPackaged: false,
    }),
    "http://127.0.0.1:5173/",
  );
  assert.equal(
    resolveDevelopmentRendererUrl({
      configuredUrl: "https://localhost:5173/app",
      isPackaged: false,
    }),
    "https://localhost:5173/app",
  );
  assert.equal(
    resolveDevelopmentRendererUrl({
      configuredUrl: "https://attacker.example/app",
      isPackaged: false,
    }),
    "",
  );
});

test("external navigation permits HTTPS only", () => {
  assert.equal(isAllowedExternalUrl("https://login.microsoftonline.com/"), true);
  assert.equal(isAllowedExternalUrl("http://example.com/"), false);
  assert.equal(isAllowedExternalUrl("file:///C:/secret.txt"), false);
  assert.equal(isAllowedExternalUrl("not-a-url"), false);
});

test("template paths require a safe workbook under a trusted or approved root", () => {
  const trustedRoot = path.join("C:", "Business");
  const approved = path.join("D:", "Reviewed", "manual.xlsx");
  assert.equal(
    isAllowedTemplatePath(path.join(trustedRoot, "SP27", "costing.xlsx"), {
      trustedRoots: [trustedRoot],
      approvedPaths: new Set(),
    }),
    true,
  );
  assert.equal(
    isAllowedTemplatePath(path.join(trustedRoot, "legacy.xls"), {
      trustedRoots: [trustedRoot],
      approvedPaths: new Set(),
    }),
    false,
  );
  assert.equal(
    isAllowedTemplatePath(path.join("C:", "Windows", "secret.xlsx"), {
      trustedRoots: [trustedRoot],
      approvedPaths: new Set([approved.toLowerCase()]),
    }),
    false,
  );
  assert.equal(
    isAllowedTemplatePath(approved, {
      trustedRoots: [trustedRoot],
      approvedPaths: new Set([path.resolve(approved).toLowerCase()]),
    }),
    true,
  );
});
