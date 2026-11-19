// File driver (default): JSON files, atomic writes.
//   data/sites/<siteId>/                    agent workspace (cwd): posts/, plans/, drafts/, knowledge/, notes.md
//   data/conversations/<siteId>/<id>.json   one conversation per file
//   data/usage/<siteId>/<YYYY-MM>.jsonl     one usage record per line
import { mkdir, readFile, writeFile, rename, readdir, rm, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UUID_RE, workspacePath, ensureWorkspaceDirs, upgradeConversation, summarize, normalizeUsageEntry } from './common.mjs';

/**
 * @param {{dataDir: string}} opts
 * @returns {import('../store.mjs').Store}
 */
export function createFileStore({ dataDir }) {
  const workspaceDir = (siteId) => workspacePath(dataDir, siteId);
  const convDir = (siteId) => path.join(dataDir, 'conversations', siteId);
  const convFile = (siteId, id) => path.join(convDir(siteId), `${id}.json`);
  const usageDir = (siteId) => path.join(dataDir, 'usage', siteId);
  let tmpSeq = 0;

  async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  async function ensureWorkspace(siteId) {
    const ws = await ensureWorkspaceDirs(dataDir, siteId);
    await mkdir(convDir(siteId), { recursive: true });
    return ws;
  }

  async function createConversation(siteId, uid) {
    await ensureWorkspace(siteId);
    const now = new Date().toISOString();
    const conv = { id: randomUUID(), siteId, uid, title: '', agentSessionId: null, createdAt: now, updatedAt: now, messages: [] };
    await writeJsonAtomic(convFile(siteId, conv.id), conv);
    return conv;
  }

  async function getConversation(siteId, id, uid) {
    if (!UUID_RE.test(id)) return null;
    try {
      const conv = JSON.parse(await readFile(convFile(siteId, id), 'utf8'));
      return conv.uid === uid ? upgradeConversation(conv) : null;
    } catch { return null; }
  }

  async function saveConversation(conv) {
    conv.updatedAt = new Date().toISOString();
    await mkdir(convDir(conv.siteId), { recursive: true });
    await writeJsonAtomic(convFile(conv.siteId, conv.id), conv);
  }

  async function listConversations(siteId, uid) {
    let files = [];
    try { files = await readdir(convDir(siteId)); } catch { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(await readFile(path.join(convDir(siteId), f), 'utf8'));
        if (c.uid === uid) out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length });
      } catch { /* skip corrupt file */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function deleteConversation(siteId, id, uid) {
    const conv = await getConversation(siteId, id, uid);
    if (!conv) return false;
    await rm(convFile(siteId, id), { force: true });
    return true;
  }

  async function recordUsage(entry) {
    const e = normalizeUsageEntry(entry);
    await mkdir(usageDir(e.siteId), { recursive: true });
    await appendFile(path.join(usageDir(e.siteId), `${e.at.slice(0, 7)}.jsonl`), JSON.stringify(e) + '\n', 'utf8');
  }

  async function usageSummary(siteId, { uid, since }) {
    let files = [];
    try { files = (await readdir(usageDir(siteId))).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)); } catch { /* none yet */ }
    const month = since.slice(0, 7);
    const entries = [];
    for (const f of files.filter((x) => x.slice(0, 7) >= month)) {
      const text = await readFile(path.join(usageDir(siteId), f), 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.at >= since && (!uid || e.uid === uid)) entries.push(e);
        } catch { /* skip */ }
      }
    }
    return summarize(entries);
  }

  return { workspaceDir, ensureWorkspace, createConversation, getConversation, saveConversation, listConversations, deleteConversation, recordUsage, usageSummary };
}
