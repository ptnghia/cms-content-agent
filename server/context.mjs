// Dựng prompt cho một hội thoại agy MỚI: system prompt + trạng thái workspace + lịch sử đã lưu.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { readSyncStatus } from './sync.mjs';
import { hasFeature } from './content-sync.mjs';

const HISTORY_MAX_MESSAGES = 20;
const HISTORY_MAX_CHARS = 1500;
const LISTING_MAX = 60;
const LISTING_SKIP = new Set(['content', 'sent']);   // hàng trăm file nội dung / đề xuất đã gửi: chỉ mô tả, không liệt kê

async function listTree(ws, rel = '', depth = 0, out = []) {
  if (out.length >= LISTING_MAX) return out;
  let entries = [];
  try { entries = await readdir(path.join(ws, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= LISTING_MAX) break;
    const r = path.join(rel, e.name).replaceAll('\\', '/');
    if (e.isDirectory()) {
      if (LISTING_SKIP.has(e.name)) out.push(`${r}/ (thư mục, xem mô tả ở trên)`);
      else if (depth < 2) await listTree(ws, r, depth + 1, out);
    }
    else out.push(r);
  }
  return out;
}

export async function buildFreshPrompt({ site, workspace, history, message }) {
  let tpl = await readFile(path.join(ROOT, 'agent', 'system-prompt.md'), 'utf8');
  // Site bật đồng bộ nội dung + đề xuất (api.features) → thêm hướng dẫn tối ưu bài cũ / viết bài mới qua outbox
  if (hasFeature(site, 'proposals') || hasFeature(site, 'content')) {
    tpl += '\n' + await readFile(path.join(ROOT, 'agent', 'system-prompt-content.md'), 'utf8');
  }
  const status = await readSyncStatus(workspace);
  const files = await listTree(workspace);
  const system = tpl
    .replaceAll('{{SITE_NAME}}', site.name || 'website')
    .replaceAll('{{LANGUAGE}}', site.language || 'vi')
    .replaceAll('{{SYNC_STATUS}}', status ? `(${status.count} bài, đồng bộ lúc ${status.syncedAt})` : '(CHƯA đồng bộ)')
    .replaceAll('{{WORKSPACE_LISTING}}', files.length ? files.map((f) => `- ${f}`).join('\n') : '(workspace trống)');

  const recent = history.slice(-HISTORY_MAX_MESSAGES);
  const transcript = recent.length
    ? '\n\n## Lịch sử hội thoại trước đó (để bạn nắm ngữ cảnh)\n' +
      recent.map((m) => `**${m.role === 'user' ? 'Người dùng' : 'Trợ lý'}:** ${String(m.content).slice(0, HISTORY_MAX_CHARS)}`).join('\n\n')
    : '';
  return `${system}${transcript}\n\n---\nYêu cầu mới của người dùng:\n${message}`;
}
