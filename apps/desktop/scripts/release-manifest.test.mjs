import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createManifest,
  readManifest,
  verifyManifest,
  writeManifest,
} from "./release-manifest.mjs";

const VERSION = "1.2.3";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function withTempRelease(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-release-manifest-"));
  try {
    const installerPath = path.join(dir, "HANSOLL-ORBIT-1.2.3-x64.exe");
    fs.writeFileSync(installerPath, "signed installer bytes");
    const manifestPath = path.join(dir, "release-manifest.json");
    return fn({ dir, installerPath, manifestPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validManifest(installerPath) {
  return createManifest({
    installerPath,
    channel: "stable",
    appVersion: VERSION,
    gitCommit: COMMIT,
    createdAt: "2026-08-05T00:00:00.000Z",
  });
}

function writeValidManifest(installerPath, manifestPath, mutate = (manifest) => manifest) {
  const manifest = mutate(validManifest(installerPath));
  writeManifest(manifest, manifestPath);
  return manifest;
}

function verifyOk(installerPath, manifestPath) {
  return verifyManifest({
    installerPath,
    manifestPath,
    channel: "stable",
    appVersion: VERSION,
    gitCommit: COMMIT,
    signatureVerifier: () => {},
  });
}

test("create writes the expected release metadata beside the installer", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    const manifest = validManifest(installerPath);
    writeManifest(manifest, manifestPath);
    const saved = readManifest(manifestPath);

    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.appVersion, VERSION);
    assert.equal(saved.channel, "stable");
    assert.equal(saved.installer.fileName, "HANSOLL-ORBIT-1.2.3-x64.exe");
    assert.equal(saved.installer.byteSize, fs.statSync(installerPath).size);
    assert.match(saved.installer.sha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.gitCommit, COMMIT);
    assert.equal(saved.createdAt, "2026-08-05T00:00:00.000Z");
  },
));

test("verify accepts exact version, channel, commit, filename, size, hash, and signature", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath);
    assert.equal(verifyOk(installerPath, manifestPath).installer.fileName, path.basename(installerPath));
  },
));

test("verify rejects a wrong installer hash", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({
      ...manifest,
      installer: { ...manifest.installer, sha256: "0".repeat(64) },
    }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /SHA-256 does not match/);
  },
));

test("verify rejects a wrong app version", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({ ...manifest, appVersion: "9.9.9" }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /appVersion 9\.9\.9 does not match/);
  },
));

test("verify rejects a wrong channel", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({ ...manifest, channel: "beta" }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /channel beta does not match stable/);
  },
));

test("verify rejects a wrong installer filename", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({
      ...manifest,
      installer: { ...manifest.installer, fileName: "other.exe" },
    }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /filename other\.exe does not match/);
  },
));

test("verify rejects a wrong installer size", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({
      ...manifest,
      installer: { ...manifest.installer, byteSize: manifest.installer.byteSize + 1 },
    }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /installer size .* does not match/);
  },
));

test("verify rejects a wrong Git commit", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath, (manifest) => ({
      ...manifest,
      gitCommit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    }));
    assert.throws(() => verifyOk(installerPath, manifestPath), /gitCommit .* does not match/);
  },
));

test("verify rejects a missing installer", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath);
    fs.rmSync(installerPath);
    assert.throws(() => verifyOk(installerPath, manifestPath), /no such file|cannot find/i);
  },
));

test("verify rejects a malformed manifest", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    fs.writeFileSync(manifestPath, "{", "utf8");
    assert.throws(() => verifyOk(installerPath, manifestPath), /missing or malformed/);
  },
));

test("verify rejects a missing manifest", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    assert.throws(() => verifyOk(installerPath, manifestPath), /missing or malformed/);
  },
));

test("verify rejects an unsigned installer", () => withTempRelease(
  ({ installerPath, manifestPath }) => {
    writeValidManifest(installerPath, manifestPath);
    assert.throws(
      () => verifyManifest({
        installerPath,
        manifestPath,
        channel: "stable",
        appVersion: VERSION,
        gitCommit: COMMIT,
        signatureVerifier: () => {
          throw new Error("Production installer signing failed: NotSigned");
        },
      }),
      /Production installer signing failed/,
    );
  },
));
