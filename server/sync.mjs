// Sync website data into the agent's workspace through the website API (docs/SITE_API.md).
// The agent only READS the result (posts/index.json, posts/index.md, ...); it never calls the network itself.
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

/** Precomputed stats so the agent does not have to count by hand. */
function buildStats(posts, syncedAt) {
  const now = Date.parse(syncedAt);
  const by = (fn) => posts.reduce((m, p) => { const k = fn(p) || '(empty)'; m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const table = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${esc(k)} | ${v} |`).join('\n');
  const list = (arr) => arr.length
    ? arr.slice(0, LIST_LIMIT).map((p) => `#${p.id} ${esc(p.title)}`).join('; ') + (arr.length > LIST_LIMIT ? `; … (+${arr.length - LIST_LIMIT})` : '')
    : '(none)';
  const published = posts.filter((p) => p.status === 'published');
  const missingTitle = posts.filter((p) => !p.meta_title);
  const missingDesc = posts.filter((p) => !p.meta_description);
  const thin = published.filter((p) => Number(p.word_count) < THIN_WORDS);
  const stale = published.filter((p) => p.updated_at && now - Date.parse(p.updated_at) > STALE_DAYS * 86400_000);
  const words = posts.map((p) => Number(p.word_count) || 0);
  const avg = words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0;

  return [
    `# Post statistics — synced ${syncedAt}`,
    '',
    `- Total posts and pages: **${posts.length}**`,
    `- Average words: **${avg}**`,
    `- Missing meta_title: **${missingTitle.length}**`,
    `- Missing meta_description: **${missingDesc.length}**`,
    `- Published with thin content (< ${THIN_WORDS} words): **${thin.length}**`,
    `- Published and not updated for > ${STALE_DAYS} days: **${stale.length}**`,
    '',
    '## By status', '| Status | Count |', '|---|---|', table(by((p) => p.status)),
    '',
    '## By category', '| Category | Count |', '|---|---|',
    table(by((p) => (Array.isArray(p.categories) ? p.categories[0] : p.categories))),
    '',
    '## To fix',
    `- Missing meta_title: ${list(missingTitle)}`,
    `- Missing meta_description: ${list(missingDesc)}`,
    `- Thin content: ${list(thin)}`,
    `- Not updated for a long time: ${list(stale)}`,
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
  if (!site.api?.base || !site.api?.key) throw new Error('Site has no api.base / api.key');
  const ws = await ensureWorkspace(siteId);
  return withUnlocked(ws, () => syncInto(ws, site));
}

async function syncInto(ws, site) {
  const full = [];
  const withContent = hasFeature(site, 'content');   // fetch content in the same pass (?include=content)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await apiGet(site, `/posts?page=${page}&per_page=${PAGE_SIZE}${withContent ? '&include=content' : ''}`);
    if (!Array.isArray(data.items)) throw new Error('Site API /posts: missing "items"');
    full.push(...data.items);
    if (!data.next_page) break;
  }
  // index.json keeps metadata only; full content goes to content/posts/<id>.md (content-sync.mjs)
  const posts = full.map(({ content_html, excerpt, ...meta }) => meta);
  const syncedAt = new Date().toISOString();
  const dir = path.join(ws, 'posts');
  await atomicWrite(path.join(dir, 'index.json'), JSON.stringify({ syncedAt, count: posts.length, items: posts }, null, 2));

  const rows = posts.map((p) =>
    `| ${esc(p.id)} | ${esc(p.title)} | ${esc(p.status)} | ${esc(p.published_at?.slice(0, 10))} | ${esc(p.updated_at?.slice(0, 10))} | ${esc(p.word_count)} | ${esc(p.url)} |`);
  await atomicWrite(path.join(dir, 'index.md'),
    `# Posts and pages (${posts.length}) — synced ${syncedAt}\n\n` +
    `| ID | Title | Status | Published | Updated | Words | URL |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
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
