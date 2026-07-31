# HANSOLL ORBIT Desktop

HANSOLL ORBIT is Hansoll Textile's work intelligence desktop application. It uses the
existing OpenCrab evidence engine behind the product interface.

## Run

From `apps/desktop`:

```powershell
npm install
npm run dev
```

Production renderer:

```powershell
npm run build
npm start
```

The desktop app expects the repository Python environment at:

```text
<repo>\.venv\Scripts\python.exe
```

Set `OPENCRAB_PYTHON` when a different Python executable should run the OpenCrab bridge.

## Verification

```powershell
npm run smoke
npm run test:e2e
```

The end-to-end test uses the configured live OpenCrab indexes and stores screenshots under
`outputs/desktop-e2e`.

## Work Agent subscriptions

Users can select ChatGPT/Codex or Claude Pro/Max under `관리 > Work Agent`. ORBIT opens the
provider's official CLI login and stores only the selected provider id. Existing Codex or Claude
credentials are not copied into ORBIT. If an authenticated token expires, Work Agent keeps the
evidence workflow available with a rules-based answer and tells the user to reopen login
management.

Gemini personal OAuth is intentionally not used by this third-party desktop app. A future Google
provider must use an approved Gemini API key, Vertex AI, or a company-managed gateway.

## Runtime Data

Work cases, tasks, milestones, decisions, and artifact jobs are stored in Electron's local
`userData` directory. Source files, mail exports, business indexes, and generated outputs remain
outside the application package.

## Microsoft 365 mail

The production desktop app uses delegated Microsoft Graph access. IT registers one single-tenant
public client in Microsoft Entra ID with both `http://localhost` and
`ms-appx-web://Microsoft.AAD.BrokerPlugin/<CLIENT_ID>` mobile/desktop redirect URIs and delegated
`Mail.Read` permission. Add `Mail.Read.Shared` only when approved shared mailboxes are configured.
The Windows redirect enables Web Account Manager (WAM), so ORBIT can reuse the employee account
already registered in Windows without asking for credentials again.

Deployment configuration belongs at:

```text
%PROGRAMDATA%\OpenCrab\desktop-config.json
```

Use `examples\desktop-config.example.json` as the shape. The file contains only public deployment
identifiers and policy values; it must not contain a client secret. Environment variables with the
same values remain available for local development:

```text
OPENCRAB_ENTRA_TENANT_ID
OPENCRAB_ENTRA_CLIENT_ID
OPENCRAB_MAIL_LOOKBACK_DAYS
OPENCRAB_MAIL_SYNC_INTERVAL_MINUTES
OPENCRAB_SHARED_MAILBOXES
```

At startup, ORBIT first asks WAM for the current Windows work account with no UI. If IT has already
granted consent, mail sync starts automatically. Only consent, Conditional Access, or expired
credentials require the employee to use the one-time Windows account approval button. Tokens are
encrypted with Electron `safeStorage` (Windows DPAPI). Mail
exports, delta state, and the search index are stored in an account-specific directory under
Electron `userData`; accounts never share one mail database.

After connection, the app syncs at startup and at the configured interval. The browser login path
remains an optional fallback for machines where WAM is unavailable. The existing Outlook COM
export is development-only and does not support New Outlook for Windows.
