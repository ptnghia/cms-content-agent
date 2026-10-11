// Driver lưu trữ bằng file JSON (ghi nguyên tử).
//   data/sites/<siteId>/            workspace của agy (cwd): posts/, plans/, drafts/, knowledge/, notes.md
//   data/conversations/<siteId>/    <conversationId>.json
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const UUID_RE = /^[0-9a-f-]{36}$/;

/**
 * @param {{dataDir: string}} opts
 * @returns {import('../store.mjs').Store}
 */
export function createFileStore({ dataDir }) {
  const workspaceDir = (siteId) => path.join(dataDir, 'sites', siteId);
  const convDir = (siteId) => path.join(dataDir, 'conversations', siteId);
  const convFile = (siteId, id) => path.join(convDir(siteId), `${id}.json`);

  async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  async function ensureWorkspace(siteId) {
    const ws = workspaceDir(siteId);
    await Promise.all(['posts', 'plans', 'drafts', 'knowledge'].map((d) => mkdir(path.join(ws, d), { recursive: true })));
    await mkdir(convDir(siteId), { recursive: true });
    return ws;
  }

  async function createConversation(siteId, uid) {
    await ensureWorkspace(siteId);
    const now = new Date().toISOString();
    const conv = { id: randomUUID(), siteId, uid, title: '', agyConversationId: null, createdAt: now, updatedAt: now, messages: [] };
    await writeJsonAtomic(convFile(siteId, conv.id), conv);
    return conv;
  }

  async function getConversation(siteId, id, uid) {
    if (!UUID_RE.test(id)) return null;
    try {
      const conv = JSON.parse(await readFile(convFile(siteId, id), 'utf8'));
      return conv.uid === uid ? conv : null;
    } catch { return null; }
  }

  async function saveConversation(conv) {
    conv.updatedAt = new Date().toISOString();
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
      } catch { /* bỏ qua file hỏng */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function deleteConversation(siteId, id, uid) {
    const conv = await getConversation(siteId, id, uid);
    if (!conv) return false;
    await rm(convFile(siteId, id), { force: true });
    return true;
  }

  return { workspaceDir, ensureWorkspace, createConversation, getConversation, saveConversation, listConversations, deleteConversation };
}
