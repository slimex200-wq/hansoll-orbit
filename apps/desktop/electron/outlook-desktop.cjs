const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const OUTLOOK_SCOPES = ["mail.read.local", "mail.search-index.local"];

function accountFingerprint(account) {
  if (!account) return "";
  return crypto
    .createHash("sha256")
    .update(
      [account.profileName, account.username, account.homeAccountId]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|"),
    )
    .digest("hex");
}

function resolveOutlookScript() {
  const configured = process.env.OPENCRAB_OUTLOOK_CONNECTOR;
  const candidates = [
    configured,
    path.join(process.resourcesPath || "", "native", "outlook-desktop.ps1"),
    path.join(__dirname, "outlook-desktop.ps1"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function runOutlookScript(payload, { scriptPath = resolveOutlookScript(), timeoutMs = 900_000 } = {}) {
  if (process.platform !== "win32") {
    return Promise.resolve({
      available: false,
      state: "unavailable",
      account: null,
      error: "Classic Outlook integration is available on Windows only.",
    });
  }
  if (!scriptPath) {
    return Promise.resolve({
      available: false,
      state: "unavailable",
      account: null,
      error: "The Classic Outlook connector is missing.",
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      { windowsHide: true, shell: false },
    );
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Classic Outlook synchronization timed out.")));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => {
        const output = Buffer.concat(stdout).toString("utf8").replace(/^\uFEFF/, "").trim();
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (!output) {
          reject(new Error(errorText || `Classic Outlook connector exited with code ${code}.`));
          return;
        }
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(new Error(errorText || `Classic Outlook returned invalid data: ${error.message}`));
        }
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

class OutlookDesktopConnector {
  constructor({ userDataPath, runner = runOutlookScript } = {}) {
    this.userDataPath = userDataPath;
    this.runner = runner;
    this.optOutPath = path.join(userDataPath, "outlook-desktop-disabled.json");
    this.consentPath = path.join(userDataPath, "outlook-desktop-consent.json");
    this.lastDetectedAccount = null;
  }

  readConsent() {
    if (!fs.existsSync(this.consentPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.consentPath, "utf8"));
    } catch {
      return null;
    }
  }

  hasConsentFor(account) {
    if (!account || fs.existsSync(this.optOutPath)) return false;
    const consent = this.readConsent();
    return Boolean(
      consent?.accountFingerprint
      && consent.accountFingerprint === accountFingerprint(account),
    );
  }

  isAutoConnectEnabled(account = this.lastDetectedAccount) {
    return this.hasConsentFor(account);
  }

  connectionStatus(result) {
    const detectedAccount = result.account || null;
    if (detectedAccount) this.lastDetectedAccount = detectedAccount;
    const consentGranted = this.hasConsentFor(detectedAccount);
    if (!detectedAccount) {
      return {
        ...result,
        account: null,
        detectedAccount: null,
        authMode: "outlook_desktop",
        autoConnect: false,
        consentGranted: false,
        consentRequired: false,
      };
    }
    return {
      ...result,
      state: consentGranted ? "connected" : "consent_required",
      account: consentGranted ? detectedAccount : null,
      detectedAccount,
      authMode: "outlook_desktop",
      autoConnect: consentGranted,
      consentGranted,
      consentRequired: !consentGranted,
    };
  }

  async initialize() {
    return this.probe();
  }

  async probe() {
    const result = await this.runner({ operation: "probe" });
    return this.connectionStatus(result);
  }

  async signIn() {
    const result = await this.runner({ operation: "probe" });
    if (!result.account) return this.connectionStatus(result);
    fs.mkdirSync(this.userDataPath, { recursive: true });
    fs.writeFileSync(
      this.consentPath,
      JSON.stringify(
        {
          version: 1,
          accountFingerprint: accountFingerprint(result.account),
          username: result.account.username || "",
          profileName: result.account.profileName || result.profileName || "",
          scopes: OUTLOOK_SCOPES,
          consentedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    if (fs.existsSync(this.optOutPath)) fs.unlinkSync(this.optOutPath);
    return this.connectionStatus(result);
  }

  async signOut() {
    fs.mkdirSync(this.userDataPath, { recursive: true });
    if (fs.existsSync(this.consentPath)) fs.unlinkSync(this.consentPath);
    fs.writeFileSync(
      this.optOutPath,
      JSON.stringify({ disabledAt: new Date().toISOString() }),
      "utf8",
    );
    return {
      available: true,
      state: this.lastDetectedAccount ? "consent_required" : "signed_out",
      account: null,
      detectedAccount: this.lastDetectedAccount,
      authMode: "outlook_desktop",
      autoConnect: false,
      consentGranted: false,
      consentRequired: Boolean(this.lastDetectedAccount),
    };
  }

  async sync({ accountDirectory, lookbackDays, maxItems = 3_000 }) {
    const result = await this.runner({
      operation: "sync",
      accountDirectory,
      outputDirectory: path.join(accountDirectory, "export"),
      lookbackDays,
      maxItems,
    });
    if (!result.available || result.state !== "connected") {
      throw new Error(result.error || "Classic Outlook is not connected.");
    }
    return result;
  }

  async openMail(input = {}) {
    const result = await this.runner({
      operation: "open",
      entryId: String(input.entryId || ""),
      subject: String(input.subject || ""),
      received: String(input.received || ""),
    }, { timeoutMs: 45_000 });
    if (!result.available || result.state !== "opened") {
      throw new Error(result.error || "Classic Outlook could not open the requested mail.");
    }
    return true;
  }
}

module.exports = {
  OUTLOOK_SCOPES,
  OutlookDesktopConnector,
  accountFingerprint,
  resolveOutlookScript,
  runOutlookScript,
};
