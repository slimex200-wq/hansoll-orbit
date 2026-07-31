const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const EXCLUDED_WELL_KNOWN_FOLDERS = ["deleteditems", "junkemail", "drafts", "outbox"];
const MESSAGE_SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "parentFolderId",
  "receivedDateTime",
  "sentDateTime",
  "subject",
  "from",
  "toRecipients",
  "ccRecipients",
  "body",
  "bodyPreview",
  "hasAttachments",
  "isDraft",
].join(",");

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stableHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function emailAddress(value) {
  const item = value?.emailAddress;
  if (!item) return "";
  const name = String(item.name || "").replace(/[\r\n"]/g, " ").trim();
  const address = String(item.address || "").replace(/[\r\n<>]/g, "").trim();
  if (!address) return name;
  return name && name.toLowerCase() !== address.toLowerCase()
    ? `"${name}" <${address}>`
    : address;
}

function mimeHeader(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function messageToEml(message, mailbox, folderName) {
  const received = message.receivedDateTime || message.sentDateTime || new Date().toISOString();
  const from = emailAddress(message.from) || mailbox;
  const to = (message.toRecipients || []).map(emailAddress).filter(Boolean).join(", ");
  const cc = (message.ccRecipients || []).map(emailAddress).filter(Boolean).join(", ");
  const body = message.body?.content || message.bodyPreview || "";
  const graphEntryId = stableHash(`${mailbox}|${message.id}`, 32).toUpperCase();
  const internetMessageId = String(message.internetMessageId || "")
    .replace(/[\r\n]/g, "")
    .trim();
  const safeMessageId = /^<[^<>\s]+>$/.test(internetMessageId)
    ? internetMessageId
    : `<${graphEntryId}@opencrab.local>`;
  const headers = [
    `From: ${mimeHeader(from)}`,
    `To: ${mimeHeader(to)}`,
    ...(cc ? [`Cc: ${mimeHeader(cc)}`] : []),
    `Subject: ${mimeHeader(message.subject || "(no subject)")}`,
    `Date: ${new Date(received).toUTCString()}`,
    `Message-ID: ${safeMessageId}`,
    `X-OpenCrab-Mailbox: ${mimeHeader(mailbox)}`,
    `X-OpenCrab-Folder: ${mimeHeader(folderName)}`,
    `X-OpenCrab-Graph-Id: ${Buffer.from(String(message.id)).toString("base64")}`,
    ...(message.internetMessageId
      ? [`X-OpenCrab-Internet-Message-Id: ${mimeHeader(message.internetMessageId)}`]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return `${headers.join("\r\n")}\r\n\r\nEntryID: ${graphEntryId}\r\n\r\n${body}`;
}

function purgeMailboxFiles(exportDirectory, mailboxState) {
  let removed = 0;
  for (const item of Object.values(mailboxState?.messages || {})) {
    if (!item?.fileName) continue;
    const filePath = path.join(exportDirectory, item.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removed += 1;
    }
  }
  return removed;
}

class GraphClient {
  constructor({ accessToken, fetchImpl = globalThis.fetch } = {}) {
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  async get(url, { allowNotFound = false, retryCount = 0 } = {}) {
    const target = url.startsWith("http") ? url : `${GRAPH_ROOT}${url}`;
    const response = await this.fetchImpl(target, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        Prefer:
          'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=100',
      },
    });
    if (allowNotFound && response.status === 404) return null;
    if ([429, 502, 503, 504].includes(response.status) && retryCount < 3) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "1", 10);
      await sleep(Math.min(10, Math.max(1, retryAfter)) * 1_000);
      return this.get(url, { allowNotFound, retryCount: retryCount + 1 });
    }
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Microsoft Graph ${response.status}: ${detail.slice(0, 500)}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async pages(url, { maxPages = 100 } = {}) {
    const values = [];
    let next = url;
    let finalDeltaLink = "";
    let pages = 0;
    while (next && pages < maxPages) {
      const page = await this.get(next);
      values.push(...(page.value || []));
      next = page["@odata.nextLink"] || "";
      finalDeltaLink = page["@odata.deltaLink"] || finalDeltaLink;
      pages += 1;
    }
    if (next) throw new Error("Microsoft Graph 동기화 페이지 한도를 초과했습니다.");
    return { values, deltaLink: finalDeltaLink, pages };
  }
}

async function listFolders(client, mailboxBase) {
  const excluded = new Set();
  for (const folderName of EXCLUDED_WELL_KNOWN_FOLDERS) {
    const item = await client.get(
      `${mailboxBase}/mailFolders/${folderName}?$select=id`,
      { allowNotFound: true },
    );
    if (item?.id) excluded.add(item.id);
  }

  const folders = [];
  const seen = new Set();
  const visit = async (url) => {
    const result = await client.pages(url, { maxPages: 20 });
    for (const folder of result.values) {
      if (!folder?.id || seen.has(folder.id) || folder.isHidden || excluded.has(folder.id)) continue;
      seen.add(folder.id);
      folders.push(folder);
      if (folder.childFolderCount > 0) {
        await visit(
          `${mailboxBase}/mailFolders/${encodeURIComponent(folder.id)}/childFolders`
          + "?$select=id,displayName,parentFolderId,childFolderCount,isHidden&$top=100",
        );
      }
    }
  };
  await visit(
    `${mailboxBase}/mailFolders`
    + "?$select=id,displayName,parentFolderId,childFolderCount,isHidden&$top=100",
  );
  return folders;
}

function initialDeltaUrl(mailboxBase, folderId, lookbackDays) {
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const params = new URLSearchParams({
    "$select": MESSAGE_SELECT,
    "$filter": `receivedDateTime ge ${cutoff}`,
  });
  return `${mailboxBase}/mailFolders/${encodeURIComponent(folderId)}/messages/delta?${params}`;
}

function initialMessagesUrl(mailboxBase, folderId, lookbackDays) {
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const params = new URLSearchParams({
    "$select": MESSAGE_SELECT,
    "$filter": `receivedDateTime ge ${cutoff}`,
    "$orderby": "receivedDateTime desc",
    "$top": "100",
  });
  return `${mailboxBase}/mailFolders/${encodeURIComponent(folderId)}/messages?${params}`;
}

async function syncMailbox({
  client,
  mailbox,
  mailboxBase,
  exportDirectory,
  priorState,
  lookbackDays,
}) {
  const folders = await listFolders(client, mailboxBase);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const nextState = {
    folders: {},
    messages: { ...(priorState.messages || {}) },
  };
  const changedMessages = new Map();
  const removedIds = new Set();
  let pages = 0;

  for (const [messageId, item] of Object.entries(nextState.messages)) {
    if (item?.folderId && !folderIds.has(item.folderId)) removedIds.add(messageId);
  }

  for (const folder of folders) {
    const priorFolder = priorState.folders?.[folder.id] || {};
    const fallbackUrl = initialDeltaUrl(mailboxBase, folder.id, lookbackDays);
    const backfillUrl = initialMessagesUrl(mailboxBase, folder.id, lookbackDays);
    let result;
    let values = [];
    if (priorFolder.deltaLink) {
      try {
        result = await client.pages(priorFolder.deltaLink, { maxPages: 100 });
      } catch (error) {
        if (error.status !== 410) throw error;
        for (const [messageId, item] of Object.entries(nextState.messages)) {
          if (item?.folderId === folder.id) removedIds.add(messageId);
        }
        const backfill = await client.pages(backfillUrl, { maxPages: 200 });
        result = await client.pages(fallbackUrl, { maxPages: 100 });
        pages += backfill.pages;
        values.push(...backfill.values);
      }
    } else {
      const backfill = await client.pages(backfillUrl, { maxPages: 200 });
      result = await client.pages(fallbackUrl, { maxPages: 100 });
      pages += backfill.pages;
      values.push(...backfill.values);
    }
    pages += result.pages;
    values.push(...result.values);
    nextState.folders[folder.id] = {
      displayName: folder.displayName,
      deltaLink: result.deltaLink || priorFolder.deltaLink || "",
    };
    for (const message of values) {
      if (!message?.id) continue;
      if (message["@removed"]) {
        removedIds.add(message.id);
        changedMessages.delete(message.id);
        continue;
      }
      if (message.isDraft) continue;
      changedMessages.set(message.id, { message, folder });
      removedIds.delete(message.id);
    }
  }

  for (const [messageId, { message, folder }] of changedMessages) {
    const fileName = `${stableHash(`${mailbox}|${messageId}`, 32)}.eml`;
    atomicWrite(
      path.join(exportDirectory, fileName),
      messageToEml(message, mailbox, folder.displayName),
    );
    nextState.messages[messageId] = {
      fileName,
      folderId: folder.id,
      updatedAt: new Date().toISOString(),
    };
  }

  let removed = 0;
  for (const messageId of removedIds) {
    if (changedMessages.has(messageId)) continue;
    const item = nextState.messages[messageId];
    if (item?.fileName) {
      const filePath = path.join(exportDirectory, item.fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    if (item) removed += 1;
    delete nextState.messages[messageId];
  }

  return {
    state: nextState,
    folderCount: folders.length,
    changed: changedMessages.size,
    removed,
    pages,
    totalMessages: Object.keys(nextState.messages).length,
  };
}

async function syncGraphMail({
  accessToken,
  account,
  accountDirectory,
  lookbackDays = 180,
  sharedMailboxes = [],
  fetchImpl = globalThis.fetch,
}) {
  const exportDirectory = path.join(accountDirectory, "export");
  const statePath = path.join(accountDirectory, "graph-sync-state.json");
  fs.mkdirSync(exportDirectory, { recursive: true });
  const loadedState = readJson(statePath, { version: 2, mailboxes: {} });
  let removedFromMigration = 0;
  if (loadedState.version !== 2) {
    for (const mailboxState of Object.values(loadedState.mailboxes || {})) {
      removedFromMigration += purgeMailboxFiles(exportDirectory, mailboxState);
    }
  }
  const prior =
    loadedState.version === 2
      ? loadedState
      : { version: 2, mailboxes: {} };
  const client = new GraphClient({ accessToken, fetchImpl });
  const targets = [
    {
      key: "me",
      mailbox: account.username,
      base: "/me",
      shared: false,
    },
    ...sharedMailboxes.map((mailbox) => ({
      key: `shared:${mailbox.toLowerCase()}`,
      mailbox,
      base: `/users/${encodeURIComponent(mailbox)}`,
      shared: true,
    })),
  ];
  const targetKeys = new Set(targets.map((target) => target.key));
  let removedFromUnconfiguredMailboxes = 0;
  for (const [key, mailboxState] of Object.entries(prior.mailboxes || {})) {
    if (targetKeys.has(key)) continue;
    removedFromUnconfiguredMailboxes += purgeMailboxFiles(exportDirectory, mailboxState);
  }

  const next = { version: 2, mailboxes: {}, lastSyncAt: new Date().toISOString() };
  const results = [];
  for (const target of targets) {
    try {
      const result = await syncMailbox({
        client,
        mailbox: target.mailbox,
        mailboxBase: target.base,
        exportDirectory,
        priorState: prior.mailboxes?.[target.key] || { folders: {}, messages: {} },
        lookbackDays,
      });
      next.mailboxes[target.key] = result.state;
      results.push({
        mailbox: target.mailbox,
        shared: target.shared,
        ok: true,
        ...result,
      });
    } catch (error) {
      const priorMailbox = prior.mailboxes?.[target.key] || { folders: {}, messages: {} };
      const accessRevoked = target.shared && [403, 404].includes(Number(error.status));
      const purged = accessRevoked
        ? purgeMailboxFiles(exportDirectory, priorMailbox)
        : 0;
      next.mailboxes[target.key] = accessRevoked
        ? { folders: {}, messages: {} }
        : priorMailbox;
      results.push({
        mailbox: target.mailbox,
        shared: target.shared,
        ok: false,
        error: error.message,
        removed: purged,
        totalMessages: accessRevoked ? 0 : Object.keys(priorMailbox.messages || {}).length,
      });
      if (!target.shared) throw error;
    }
  }
  atomicWrite(statePath, JSON.stringify(next, null, 2));

  return {
    exportDirectory,
    statePath,
    syncedAt: next.lastSyncAt,
    results,
    changed: results.reduce((sum, item) => sum + (item.changed || 0), 0),
    removed:
      removedFromMigration
      +
      removedFromUnconfiguredMailboxes
      + results.reduce((sum, item) => sum + (item.removed || 0), 0),
    totalMessages: results.reduce((sum, item) => sum + (item.totalMessages || 0), 0),
  };
}

module.exports = {
  GraphClient,
  initialDeltaUrl,
  initialMessagesUrl,
  listFolders,
  messageToEml,
  stableHash,
  syncGraphMail,
};
