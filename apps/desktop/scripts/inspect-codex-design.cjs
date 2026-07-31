const fs = require("node:fs");
const path = require("node:path");

const asarPath = process.argv.find((value) => value.toLowerCase().endsWith("app.asar"));
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputRoot = outputArg
  ? path.resolve(outputArg.slice("--output=".length))
  : path.resolve(process.cwd(), "outputs", "codex-design-evidence");

if (!asarPath) {
  console.error("Usage: electron inspect-codex-design.cjs <path-to-app.asar> [--output=<directory>]");
  process.exit(1);
}

const designTerms =
  /(settings|appearance|theme|token|sidebar|navigation|oauth|connector|account|preferences|dialog|modal)/i;

function walk(directory, relativeRoot = "") {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(absolutePath, relativePath));
    } else {
      const stats = fs.statSync(absolutePath);
      results.push({ relativePath, absolutePath, size: stats.size });
    }
  }
  return results;
}

function copyEvidence(file, reason) {
  const destination = path.join(outputRoot, "extracted", ...file.relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file.absolutePath, destination);
  return {
    path: file.relativePath,
    size: file.size,
    reason,
    extractedPath: path.relative(outputRoot, destination).replaceAll("\\", "/"),
  };
}

function inspectFile(file) {
  const extension = path.extname(file.relativePath).toLowerCase();

  if (file.relativePath === "package.json") {
    return copyEvidence(file, "package metadata");
  }

  if (
    file.relativePath.startsWith("webview/")
    && (extension === ".css" || extension === ".html")
  ) {
    return copyEvidence(file, `${extension.slice(1)} design surface`);
  }

  if (/^webview\/assets\/app-initial-[^/]+\.js$/i.test(file.relativePath)) {
    return copyEvidence(file, "renderer component bundle");
  }

  if (
    file.relativePath.startsWith("webview/assets/")
    && extension === ".js"
    && (
      designTerms.test(file.relativePath)
      || /^webview\/assets\/codex-(?:light|dark)-[^/]+\.js$/i.test(file.relativePath)
    )
  ) {
    return copyEvidence(file, "design-related filename");
  }

  return null;
}

fs.mkdirSync(outputRoot, { recursive: true });
const files = walk(asarPath);
const evidence = [];

for (const file of files) {
  const inspected = inspectFile(file);
  if (inspected) {
    evidence.push(inspected);
  }
}

const manifest = {
  inspectedAt: new Date().toISOString(),
  source: asarPath,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  evidence,
  allFiles: files.map(({ relativePath, size }) => ({ path: relativePath, size })),
};

fs.writeFileSync(
  path.join(outputRoot, "asar-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      outputRoot,
      fileCount: manifest.fileCount,
      evidenceCount: evidence.length,
      evidence: evidence.map(({ path: filePath, size, reason }) => ({
        path: filePath,
        size,
        reason,
      })),
    },
    null,
    2,
  ),
);

process.exit(0);
