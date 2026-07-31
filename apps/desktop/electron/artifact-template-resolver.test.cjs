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
  return filePath;
}

test("resolves registered company templates without case input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));
  const expected = workbook(
    root,
    path.join("Talbots", "Submit form", "SOLID SUBMIT FORM.xlsx"),
  );

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "submit_solid",
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.confidence, "high");
  assert.equal(result.path, expected);
});

test("selects costing source by style season and division", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));
  const expected = workbook(
    root,
    path.join(
      "Talbots",
      "COSTING",
      "SP'27 COSTING",
      "OUTLET",
      "SP'27 OUTLET COSTING SHEET 271900010.xlsx",
    ),
  );
  workbook(
    root,
    path.join(
      "Talbots",
      "COSTING",
      "HO'26 COSTING",
      "KNIT TOP",
      "HO'26 KT COSTING SHEET 264900010.xlsx",
    ),
  );

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "costing_sheet",
    workCase: {
      title: "271900010 costing 확인",
      summary: "SP27 Outlet 기준",
      businessKeys: [{ kind: "style", value: "271900010" }],
      evidence: [],
    },
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.path, expected);
  assert.match(result.reason, /Style 271900010/);
});

test("uses work case evidence to recommend the development workbook", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));
  const expected = workbook(
    root,
    path.join(
      "Talbots",
      "Development",
      "SP27",
      "OUTLET",
      "SP27_Outlet_FEB_MAR_APR.xlsx",
    ),
  );
  workbook(
    root,
    path.join(
      "Talbots",
      "Development",
      "HO26",
      "OUTLET",
      "HO26_Outlet_NOV_DEC.xlsx",
    ),
  );

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "ceo_recap",
    workCase: {
      title: "271900010 메일 후속 조치",
      summary: "SP27 Outlet 업무",
      businessKeys: [{ kind: "style", value: "271900010" }],
      evidence: [
        {
          relative_path: "Talbots\\Development\\SP27\\OUTLET\\SP27_Outlet_FEB_MAR_APR.xlsx",
        },
      ],
    },
  });

  assert.equal(result.path, expected);
  assert.notEqual(result.status, "not_found");
});

test("resolves TP photo work to a development recap source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));
  const expected = workbook(
    root,
    path.join("Talbots", "Development", "SP27", "OUTLET", "SP27_OUTLET_TP_PHOTOS_RECAP.xlsx"),
  );

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "tp_photo",
    workCase: {
      title: "SP27 OUTLET 271952230 TP photos",
      businessKeys: [{ kind: "style", value: "271952230" }],
      evidence: [],
    },
  });

  assert.equal(result.path, expected);
  assert.equal(result.status, "resolved");
});

test("returns a manual fallback only when no company source is found", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-template-"));

  const result = resolveArtifactTemplate({
    sourceRoot: root,
    artifactType: "tna",
    workCase: { title: "SP27 TNA" },
  });

  assert.equal(result.status, "not_found");
  assert.equal(result.path, "");
  assert.match(result.reason, /이 경우에만/);
});
