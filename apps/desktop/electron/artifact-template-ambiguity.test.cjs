const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { resolveArtifactTemplate } = require("./artifact-template-resolver.cjs");

function workbook(root, relativePath) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "workbook");
}

test("does not auto-resolve equally scored company workbooks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));
  workbook(
    root,
    path.join("Talbots", "COSTING", "SP'27 COSTING", "OUTLET", "A COSTING RECAP.xlsx"),
  );
  workbook(
    root,
    path.join("Talbots", "COSTING", "SP'27 COSTING", "OUTLET", "B COSTING RECAP.xlsx"),
  );

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "costing_recap",
    workCase: {
      title: "SP27 OUTLET costing recap",
      evidence: [],
    },
  });

  assert.equal(result.status, "suggested");
  assert.equal(result.confidence, "medium");
  assert.equal(result.candidates[0].score, result.candidates[1].score);
});
