// Lưu trữ phía backend (file JSON, ghi nguyên tử).
//   data/sites/<siteId>/            workspace của agy (cwd): posts/, plans/, drafts/, knowledge/, notes.md
//   data/conversations/<siteId>/    <conversationId>.json
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from './config.mjs';

const UUID_RE = /^[0-9a-f-]{36}$/;

export const workspaceDir = (siteId) => path.join(config.dataDir, 'sites', siteId);
const convDir = (siteId) => path.join(config.dataDir, 'conversations', siteId);
const convFile = (siteId, id) => path.join(convDir(siteId), `${id}.json`);

export async function ensureWorkspace(siteId) {
  const ws = workspaceDir(siteId);
  await Promise.all(['posts', 'plans', 'drafts', 'knowledge'].map((d) => mkdir(path.join(ws, d), { recursive: true })));
  await mkdir(convDir(siteId), { recursive: true });
  return ws;
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function createConversation(siteId, uid) {
  await ensureWorkspace(siteId);
  const now = new Date().toISOString();
  const conv = { id: randomUUID(), siteId, uid, title: '', agyConversationId: null, createdAt: now, updatedAt: now, messages: [] };
  await writeJsonAtomic(convFile(siteId, conv.id), conv);
  return conv;
}

/** Trả về hội thoại nếu tồn tại VÀ thuộc về uid; ngược lại null. */
export async function getConversation(siteId, id, uid) {
  if (!UUID_RE.test(id)) return null;
  try {
    const conv = JSON.parse(await readFile(convFile(siteId, id), 'utf8'));
    return conv.uid === uid ? conv : null;
  } catch { return null; }
}

export async function saveConversation(conv) {
  conv.updatedAt = new Date().toISOString();
  await writeJsonAtomic(convFile(conv.siteId, conv.id), conv);
}

export async function listConversations(siteId, uid) {
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

export async function deleteConversation(siteId, id, uid) {
  const conv = await getConversation(siteId, id, uid);
  if (!conv) return false;
  await rm(convFile(siteId, id), { force: true });
  return true;
}
