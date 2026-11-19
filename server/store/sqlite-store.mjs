// SQLite driver (STORE_DRIVER=sqlite) using the built-in node:sqlite module (Node >= 22.13, no dependency).
//   data/store.db      conversations + usage
//   data/sites/<id>/   agent workspace (always on disk)
// Migrate existing JSON data: npm run migrate:sqlite
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UUID_RE, workspacePath, ensureWorkspaceDirs, upgradeConversation, summarize, normalizeUsageEntry } from './common.mjs';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  throw new Error('STORE_DRIVER=sqlite needs Node.js >= 22.13 (built-in node:sqlite)');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL,
  uid         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  msg_count   INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(site_id, uid, updated_at DESC);
CREATE TABLE IF NOT EXISTS usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  site_id         TEXT NOT NULL,
  uid             TEXT NOT NULL,
  kind            TEXT NOT NULL,
  conversation_id TEXT,
  backend         TEXT NOT NULL,
  status          TEXT NOT NULL,
  turns           INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cached_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  model           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS usage_site_at ON usage(site_id, at);
`;

/**
 * @param {{dataDir: string, file?: string}} opts
 * @returns {import('../store.mjs').Store}
 */
export function createSqliteStore({ dataDir, file }) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file || path.join(dataDir, 'store.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // v0.4.1: per-request model; older databases lack the column.
  if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === 'model')) {
    db.exec("ALTER TABLE usage ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }

  const q = {
    insert: db.prepare(`INSERT INTO conversations (id, site_id, uid, title, created_at, updated_at, msg_count, data)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    upsert: db.prepare(`INSERT INTO conversations (id, site_id, uid, title, created_at, updated_at, msg_count, data)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at,
                          msg_count = excluded.msg_count, data = excluded.data`),
    get: db.prepare('SELECT data FROM conversations WHERE id = ? AND site_id = ? AND uid = ?'),
    list: db.prepare(`SELECT id, title, updated_at AS updatedAt, msg_count AS messageCount FROM conversations
                      WHERE site_id = ? AND uid = ? ORDER BY updated_at DESC`),
    del: db.prepare('DELETE FROM conversations WHERE id = ? AND site_id = ? AND uid = ?'),
    usage: db.prepare(`INSERT INTO usage (at, site_id, uid, kind, conversation_id, backend, status, turns,
                         input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, model)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    usageSite: db.prepare(`SELECT backend, model, input_tokens AS inputTokens, output_tokens AS outputTokens,
                             cached_tokens AS cachedTokens, cost_usd AS costUsd FROM usage WHERE site_id = ? AND at >= ?`),
    usageUid: db.prepare(`SELECT backend, model, input_tokens AS inputTokens, output_tokens AS outputTokens,
                            cached_tokens AS cachedTokens, cost_usd AS costUsd FROM usage WHERE site_id = ? AND at >= ? AND uid = ?`),
  };

  const row = (c) => [c.id, c.siteId, c.uid, c.title || '', c.createdAt, c.updatedAt, c.messages.length, JSON.stringify(c)];

  const workspaceDir = (siteId) => workspacePath(dataDir, siteId);
  const ensureWorkspace = (siteId) => ensureWorkspaceDirs(dataDir, siteId);

  async function createConversation(siteId, uid) {
    await ensureWorkspace(siteId);
    const now = new Date().toISOString();
    const conv = { id: randomUUID(), siteId, uid, title: '', agentSessionId: null, createdAt: now, updatedAt: now, messages: [] };
    q.insert.run(...row(conv));
    return conv;
  }

  async function getConversation(siteId, id, uid) {
    if (!UUID_RE.test(id)) return null;
    const r = q.get.get(id, siteId, uid);
    if (!r) return null;
    try { return upgradeConversation(JSON.parse(r.data)); } catch { return null; }
  }

  async function saveConversation(conv) {
    conv.updatedAt = new Date().toISOString();
    q.upsert.run(...row(conv));
  }

  async function listConversations(siteId, uid) {
    return q.list.all(siteId, uid).map((r) => ({ ...r }));
  }

  async function deleteConversation(siteId, id, uid) {
    return Number(q.del.run(id, siteId, uid).changes) > 0;
  }

  async function recordUsage(entry) {
    const e = normalizeUsageEntry(entry);
    q.usage.run(e.at, e.siteId, e.uid, e.kind, e.conversationId, e.backend, e.status, e.turns,
      e.inputTokens, e.outputTokens, e.cachedTokens, e.costUsd, e.durationMs, e.model);
  }

  async function usageSummary(siteId, { uid, since }) {
    return summarize(uid ? q.usageUid.all(siteId, since, uid) : q.usageSite.all(siteId, since));
  }

  /** Bulk import used by the migration script (keeps ids and timestamps). */
  function importConversation(conv) {
    q.upsert.run(...row(upgradeConversation(conv)));
  }

  return {
    workspaceDir, ensureWorkspace, createConversation, getConversation, saveConversation, listConversations, deleteConversation,
    recordUsage, usageSummary, importConversation, close: () => db.close(),
  };
}
