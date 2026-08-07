const assert = require("node:assert/strict");
const test = require("node:test");

const { encodeBackupBundle, validateBackupBundle } = require("./domain-backup.cjs");

const state = {
  schemaVersion: 6,
  cases: [],
  tasks: [],
  milestones: [],
  decisions: [],
  artifactJobs: [],
  auditEvents: [],
};

function validBundle() {
  return encodeBackupBundle({ state, appVersion: "1.2.3", profileKey: "legacy" });
}

const validationOptions = {
  currentSchemaVersion: 6,
  validateDomainState(candidate) {
    assert.equal(candidate.schemaVersion, 6);
  },
};

test("backup validation rejects malformed and unsupported bundles before restore", () => {
  assert.throws(() => validateBackupBundle("{", validationOptions), SyntaxError);

  const future = JSON.parse(validBundle());
  future.stateSchemaVersion = 7;
  assert.throws(
    () => validateBackupBundle(future, validationOptions),
    /backup_state_schema_unsupported/,
  );

  const wrongProfile = JSON.parse(validBundle());
  wrongProfile.profileKey = "..\\another-user";
  assert.throws(
    () => validateBackupBundle(wrongProfile, validationOptions),
    /backup_profile_key_invalid/,
  );
});

test("backup validation rejects traversal, duplicate, missing and oversized entry sets", () => {
  const traversal = JSON.parse(validBundle());
  traversal.entries[0].name = "../domain-state";
  assert.throws(
    () => validateBackupBundle(traversal, validationOptions),
    /backup_entry_name_rejected/,
  );

  const duplicate = JSON.parse(validBundle());
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assert.throws(
    () => validateBackupBundle(duplicate, validationOptions),
    /backup_entry_duplicate/,
  );

  const missing = JSON.parse(validBundle());
  missing.entries = [{ ...missing.entries[0], name: "app-preferences" }];
  assert.throws(
    () => validateBackupBundle(missing, validationOptions),
    /backup_domain_state_missing/,
  );

  const tooMany = JSON.parse(validBundle());
  tooMany.entries = Array.from({ length: 201 }, () => structuredClone(tooMany.entries[0]));
  assert.throws(
    () => validateBackupBundle(tooMany, validationOptions),
    /backup_entries_invalid/,
  );
});

test("backup validation rejects entry length and hash tampering", () => {
  const wrongLength = JSON.parse(validBundle());
  wrongLength.entries[0].byteLength += 1;
  assert.throws(
    () => validateBackupBundle(wrongLength, validationOptions),
    /backup_entry_length_mismatch/,
  );

  const wrongHash = JSON.parse(validBundle());
  wrongHash.entries[0].sha256 = "0".repeat(64);
  assert.throws(
    () => validateBackupBundle(wrongHash, validationOptions),
    /backup_entry_hash_mismatch/,
  );
});
