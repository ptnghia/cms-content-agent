// Đồng bộ dữ liệu website -> workspace của agent, qua API của website (xem docs/SITE_API.md).
// Agent chỉ ĐỌC kết quả (posts/index.json, posts/index.md); không tự gọi mạng hay chạy lệnh.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspace } from './store.mjs';
import { syncExtended, hasFeature } from './content-sync.mjs';
import { withUnlocked } from './workspace-guard.mjs';
import { recordSyncResult } from './sync-monitor.mjs';

const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const inflight = new Map();

async function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

async function apiGet(site, pathAndQuery) {
  const res = await fetch(`${site.api.base.replace(/\/$/, '')}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${site.api.key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Site API ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json();
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const STALE_DAYS = 180;
const THIN_WORDS = 600;
const LIST_LIMIT = 50;

/** Thống kê tính sẵn để agent không phải chạy lệnh/đếm thủ công. */
function buildStats(posts, syncedAt) {
  const now = Date.parse(syncedAt);
  const by = (fn) => posts.reduce((m, p) => { const k = fn(p) || '(trống)'; m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const table = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${esc(k)} | ${v} |`).join('\n');
  const list = (arr) => arr.length
    ? arr.slice(0, LIST_LIMIT).map((p) => `#${p.id} ${esc(p.title)}`).join('; ') + (arr.length > LIST_LIMIT ? `; … (+${arr.length - LIST_LIMIT})` : '')
    : '(không có)';
  const published = posts.filter((p) => p.status === 'published');
  const missingTitle = posts.filter((p) => !p.meta_title);
  const missingDesc = posts.filter((p) => !p.meta_description);
  const thin = published.filter((p) => Number(p.word_count) < THIN_WORDS);
  const stale = published.filter((p) => p.updated_at && now - Date.parse(p.updated_at) > STALE_DAYS * 86400_000);
  const words = posts.map((p) => Number(p.word_count) || 0);
  const avg = words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0;

  return [
    `# Thống kê bài viết — đồng bộ ${syncedAt}`,
    '',
    `- Tổng số bài: **${posts.length}**`,
    `- Số từ trung bình: **${avg}**`,
    `- Thiếu meta_title: **${missingTitle.length}**`,
    `- Thiếu meta_description: **${missingDesc.length}**`,
    `- Bài đã đăng nội dung mỏng (< ${THIN_WORDS} từ): **${thin.length}**`,
    `- Bài đã đăng chưa cập nhật > ${STALE_DAYS} ngày: **${stale.length}**`,
    '',
    '## Theo trạng thái', '| Trạng thái | Số bài |', '|---|---|', table(by((p) => p.status)),
    '',
    '## Theo chuyên mục', '| Chuyên mục | Số bài |', '|---|---|',
    table(by((p) => (Array.isArray(p.categories) ? p.categories[0] : p.categories))),
    '',
    '## Danh sách cần xử lý',
    `- Thiếu meta_title: ${list(missingTitle)}`,
    `- Thiếu meta_description: ${list(missingDesc)}`,
    `- Nội dung mỏng: ${list(thin)}`,
    `- Lâu chưa cập nhật: ${list(stale)}`,
    '',
  ].join('\n');
}

export function syncPosts(siteId, site) {
  if (inflight.has(siteId)) return inflight.get(siteId);
  const p = doSync(siteId, site)
    .then(async (r) => { await recordSyncResult(siteId, site, null); return r; },
      async (e) => { await recordSyncResult(siteId, site, e); throw e; })
    .finally(() => inflight.delete(siteId));
  inflight.set(siteId, p);
  return p;
}

async function doSync(siteId, site) {
  if (!site.api?.base || !site.api?.key) throw new Error('Site chưa cấu hình api.base/api.key');
  const ws = await ensureWorkspace(siteId);
  return withUnlocked(ws, () => syncInto(ws, site));
}

async function syncInto(ws, site) {
  const full = [];
  const withContent = hasFeature(site, 'content');   // lấy luôn nội dung trong cùng lượt (site hỗ trợ ?include=content)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await apiGet(site, `/posts?page=${page}&per_page=${PAGE_SIZE}${withContent ? '&include=content' : ''}`);
    if (!Array.isArray(data.items)) throw new Error('Site API /posts: thiếu "items"');
    full.push(...data.items);
    if (!data.next_page) break;
  }
  // index.json chỉ giữ siêu dữ liệu; nội dung đầy đủ ghi riêng ở content/posts/<id>.md (content-sync.mjs)
  const posts = full.map(({ content_html, excerpt, ...meta }) => meta);
  const syncedAt = new Date().toISOString();
  const dir = path.join(ws, 'posts');
  await atomicWrite(path.join(dir, 'index.json'), JSON.stringify({ syncedAt, count: posts.length, items: posts }, null, 2));

  const rows = posts.map((p) =>
    `| ${esc(p.id)} | ${esc(p.title)} | ${esc(p.status)} | ${esc(p.published_at?.slice(0, 10))} | ${esc(p.updated_at?.slice(0, 10))} | ${esc(p.word_count)} | ${esc(p.url)} |`);
  await atomicWrite(path.join(dir, 'index.md'),
    `# Danh sách bài viết (${posts.length}) — đồng bộ ${syncedAt}\n\n` +
    `| ID | Tiêu đề | Trạng thái | Đăng | Cập nhật | Số từ | URL |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
  await atomicWrite(path.join(dir, 'stats.md'), buildStats(posts, syncedAt));
  const extended = Array.isArray(site.api.features) && site.api.features.length ? await syncExtended(site, ws, full) : {};
  return { syncedAt, count: posts.length, ...extended };
}

export async function readSyncStatus(ws) {
  try {
    const d = JSON.parse(await readFile(path.join(ws, 'posts', 'index.json'), 'utf8'));
    return { syncedAt: d.syncedAt, count: d.count };
  } catch { return null; }
}
