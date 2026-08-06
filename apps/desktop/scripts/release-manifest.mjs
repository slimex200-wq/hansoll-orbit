import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertSigned,
  buildSignatureScript,
  parseSignatureOutput,
  powershellEnvironment,
} from "./verify-production-release.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const MANIFEST_NAME = "release-manifest.json";
const SCHEMA_VERSION = 1;
const CHANNELS = new Set(["stable", "beta"]);

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function readPackageVersion(packagePath = path.join(desktopRoot, "package.json")) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (!pkg.version || typeof pkg.version !== "string") {
    throw new Error(`No package version was found in ${packagePath}.`);
  }
  return pkg.version;
}

export function currentGitCommit(cwd = repoRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

export function findInstaller(outputRoot) {
  const installers = fs.existsSync(outputRoot)
    ? fs.readdirSync(outputRoot)
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .filter((name) => !name.toLowerCase().includes("uninstall"))
      .sort()
    : [];
  if (installers.length !== 1) {
    throw new Error(
      `Expected exactly one production installer in ${outputRoot}, found ${installers.length}.`,
    );
  }
  return path.join(outputRoot, installers[0]);
}

export function validateChannel(channel) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`Release channel must be stable or beta, received "${channel}".`);
  }
  return channel;
}

export function createManifest({
  installerPath,
  channel,
  appVersion = readPackageVersion(),
  gitCommit = currentGitCommit(),
  createdAt = new Date().toISOString(),
} = {}) {
  if (!installerPath) throw new Error("An installer path is required.");
  validateChannel(channel);
  const stat = fs.statSync(installerPath);
  if (!stat.isFile()) throw new Error(`Installer is not a file: ${installerPath}.`);
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    channel,
    installer: {
      fileName: path.basename(installerPath),
      byteSize: stat.size,
      sha256: sha256File(installerPath),
    },
    createdAt,
    gitCommit,
  };
}

export function writeManifest(manifest, manifestPath) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

export function readManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Release manifest is missing or malformed: ${error.message}`);
  }
  return manifest;
}

export function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Release manifest must be a JSON object.");
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Release manifest schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (typeof manifest.appVersion !== "string" || !manifest.appVersion) {
    throw new Error("Release manifest appVersion is required.");
  }
  validateChannel(manifest.channel);
  if (!manifest.installer || typeof manifest.installer !== "object") {
    throw new Error("Release manifest installer object is required.");
  }
  if (typeof manifest.installer.fileName !== "string" || !manifest.installer.fileName) {
    throw new Error("Release manifest installer.fileName is required.");
  }
  if (!Number.isSafeInteger(manifest.installer.byteSize) || manifest.installer.byteSize <= 0) {
    throw new Error("Release manifest installer.byteSize must be a positive integer.");
  }
  if (
    typeof manifest.installer.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.installer.sha256)
  ) {
    throw new Error("Release manifest installer.sha256 must be a lowercase SHA-256 hex digest.");
  }
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("Release manifest createdAt must be an ISO timestamp.");
  }
  if (typeof manifest.gitCommit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.gitCommit)) {
    throw new Error("Release manifest gitCommit must be a 40-character lowercase Git commit.");
  }
}

export function verifyInstallerSignature(installerPath) {
  const raw = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", buildSignatureScript([installerPath])],
    { encoding: "utf8", env: powershellEnvironment() },
  );
  assertSigned(parseSignatureOutput(raw, 1));
}

export function verifyManifest({
  installerPath,
  manifestPath = path.join(path.dirname(installerPath || "."), MANIFEST_NAME),
  channel,
  appVersion = readPackageVersion(),
  gitCommit = currentGitCommit(),
  signatureVerifier = verifyInstallerSignature,
} = {}) {
  if (!installerPath) throw new Error("An installer path is required.");
  validateChannel(channel);
  const manifest = readManifest(manifestPath);
  assertManifestShape(manifest);

  if (manifest.appVersion !== appVersion) {
    throw new Error(`Release manifest appVersion ${manifest.appVersion} does not match ${appVersion}.`);
  }
  if (manifest.channel !== channel) {
    throw new Error(`Release manifest channel ${manifest.channel} does not match ${channel}.`);
  }
  if (manifest.gitCommit !== gitCommit) {
    throw new Error(`Release manifest gitCommit ${manifest.gitCommit} does not match ${gitCommit}.`);
  }
  if (manifest.installer.fileName !== path.basename(installerPath)) {
    throw new Error(
      `Release manifest installer filename ${manifest.installer.fileName} does not match ${path.basename(installerPath)}.`,
    );
  }
  const stat = fs.statSync(installerPath);
  if (!stat.isFile()) throw new Error(`Installer is not a file: ${installerPath}.`);
  if (manifest.installer.byteSize !== stat.size) {
    throw new Error(
      `Release manifest installer size ${manifest.installer.byteSize} does not match ${stat.size}.`,
    );
  }
  const digest = sha256File(installerPath);
  if (manifest.installer.sha256 !== digest) {
    throw new Error("Release manifest installer SHA-256 does not match the installer bytes.");
  }
  signatureVerifier(installerPath);
  return manifest;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function resolveCliPaths(options) {
  const outputRoot = path.resolve(
    desktopRoot,
    options.output || process.env.ORBIT_BUILD_OUTPUT || "release/production-build",
  );
  const installerPath = path.resolve(options.installer || findInstaller(outputRoot));
  const manifestPath = path.resolve(options.manifest || path.join(path.dirname(installerPath), MANIFEST_NAME));
  return { outputRoot, installerPath, manifestPath };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!["create", "verify"].includes(command)) {
    throw new Error(
      "Usage: node scripts/release-manifest.mjs <create|verify> --channel <stable|beta> "
      + "[--installer <path>] [--manifest <path>] [--output <dir>]",
    );
  }
  const channel = validateChannel(options.channel || "stable");
  const { installerPath, manifestPath } = resolveCliPaths(options);

  if (command === "create") {
    const manifest = createManifest({ installerPath, channel });
    writeManifest(manifest, manifestPath);
    console.log(JSON.stringify({ status: "created", manifestPath, installerPath }, null, 2));
    return;
  }

  const manifest = verifyManifest({ installerPath, manifestPath, channel });
  console.log(JSON.stringify({ status: "valid", manifestPath, installer: manifest.installer }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
