// Extended sync (per site): full content, products, categories, keywords, SEO audit, proposal status.
// Runs for the features listed in config/sites.json: "api": { ..., "features": ["content", "products", "categories", "keywords", "seo", "proposals", "schema"] }
// API contract: docs/SITE_API.md. Workspace files are agent-facing and written in English; the agent replies in the user's language.
//
// Output in the workspace (read-only for the agent):
//   content/posts/<id>.md, content/products/<id>.md, content/categories/<id>.md   front-matter + current HTML
//   products/index.md, categories/index.md                                        compact tables
//   site/inventory.md      EVERY page (type, id, title, link, focus keyword, SEO score): read before writing a new article
//   seo/audit.md           SEO score + issues per page
//   seo/keywords.md        keyword bank (target page, priority, manually entered volumes)
//   site/fields.md         fields the agent may propose per page type ("schema" feature)
//   outbox/STATUS.md       proposals already sent and their review status
import { mkdir, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const hasFeature = (site, f) => Array.isArray(site?.api?.features) && site.api.features.includes(f);

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

export async function apiGet(site, pathAndQuery) {
  const res = await fetch(`${site.api.base.replace(/\/$/, '')}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${site.api.key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Site API ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json();
}

async function getAll(site, endpoint, withContent) {
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const d = await apiGet(site, `${endpoint}?page=${page}&per_page=100${withContent ? '&include=content' : ''}`);
    if (!Array.isArray(d.items)) throw new Error(`Site API ${endpoint}: missing "items"`);
    out.push(...d.items);
    if (!d.next_page) break;
  }
  return out;
}

/** Root-relative link for internal linking: path of the public URL ("/my-post/"), or "" when unknown. */
export const linkOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return ''; } };
const TERM_KIND = { post: 'post category', product: 'product category' };
/** Heading of the read-only facts block in content files (compose.mjs parses it). */
export const FACTS_HEADING = 'Read-only facts (facts)';
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const yaml = (v) => (v === null || v === undefined || v === '' ? '' : JSON.stringify(v));

/** One content file: front-matter (JSON-quoted values) + HTML blocks */
function contentFile(item, blocks) {
  const meta = ['id', 'kind', 'title', 'slug', 'url', 'status', 'type', 'category', 'category_id', 'meta_title', 'meta_description', 'keywords',
    'focus_keyword', 'seo_score', 'word_count', 'price', 'updated_at', 'admin_url'];
  const fm = meta.filter((k) => item[k] !== undefined && item[k] !== null && item[k] !== '').map((k) => `${k}: ${yaml(item[k])}`);
  if (Array.isArray(item.categories) && item.categories.length) fm.push(`categories: ${yaml(item.categories)}`);
  if (Array.isArray(item.seo_issues) && item.seo_issues.length) fm.push('seo_issues:', ...item.seo_issues.map((s) => `  - ${yaml(s)}`));
  const body = blocks.filter(([, v]) => v && String(v).trim()).map(([h, v]) => `## ${h}\n\n${String(v).trim()}\n`).join('\n');
  return `---\n${fm.join('\n')}\n---\n\n${body || '(no content)\n'}`;
}

/** READ-ONLY product facts (specs, price options, promotions, policies…) — the agent writes from them, never changes them.
 *  Rendered generically: scalars as "key: value", arrays as one bullet per item, objects as "k: v; k2: v2". */
const factValue = (v) => (v && typeof v === 'object'
  ? Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== '').map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join('; ')
  : String(v));
const factsText = (f) => {
  if (!f || typeof f !== 'object' || !Object.keys(f).length) return '';
  const lines = [];
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v)) lines.push(...v.map((o) => `- ${k}: ${factValue(o).replace(/\s+/g, ' ').slice(0, 300)}`));
    else lines.push(`- ${k}: ${factValue(v).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return '(READ-ONLY: the source of truth for figures and policies; never change them or add new ones)\n' + lines.join('\n');
};

const faqText = (faq) => (Array.isArray(faq) && faq.length ? faq.map((q) => `- **Q:** ${q.question}\n  **A:** ${q.answer}`).join('\n') : '');

async function writeCollection(ws, kind, items, blocksOf) {
  const dir = path.join(ws, 'content', kind);
  await rm(dir, { recursive: true, force: true });   // drop the old copy so pages deleted on the website disappear
  await mkdir(dir, { recursive: true });
  // ids come from the website and become file names: numbers only (no "../")
  for (const it of items) if (/^\d{1,12}$/.test(String(it.id))) await atomicWrite(path.join(dir, `${it.id}.md`), contentFile(it, blocksOf(it)));
}

/** Compact table for products/index.md, categories/index.md */
function indexTable(title, items, extraCols = []) {
  const head = ['ID', 'Title', 'Status', 'SEO score', 'Focus keyword', 'Words', ...extraCols.map((c) => c[0]), 'Slug'];
  const rows = items.map((p) => [p.id, p.title, p.status, p.seo_score, p.focus_keyword, p.word_count, ...extraCols.map((c) => c[1](p)), p.slug].map(cell).join(' | '));
  return `# ${title} (${items.length})\n\nFull content: \`content/<type>/<id>.md\`.\n\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`;
}

/**
 * Called by sync.mjs after /posts. postsWithContent: the /posts items (with content_html when "content" is on).
 * @returns {Promise<object>} counts per part (reported to the user)
 */
export async function syncExtended(site, ws, postsWithContent) {
  const report = {};
  const all = [...postsWithContent.map((p) => ({ ...p, kind: p.kind || 'post' }))];

  if (hasFeature(site, 'content')) {
    await writeCollection(ws, 'posts', postsWithContent, (p) => [['Excerpt (excerpt)', p.excerpt], ['Content (body)', p.content_html]]);
    report.content = postsWithContent.length;
  }
  if (hasFeature(site, 'products')) {
    const items = await getAll(site, '/products', hasFeature(site, 'content'));
    all.push(...items);
    await atomicWrite(path.join(ws, 'products', 'index.md'),
      indexTable('Products', items, [['Type', (p) => p.type], ['Category', (p) => p.category], ['Price (read-only)', (p) => p.price]]));
    if (hasFeature(site, 'content')) {
      await writeCollection(ws, 'products', items, (p) => [['Excerpt (excerpt)', p.excerpt], ['Main info / price table (body)', p.content_html],
        ['Long description (body_extra)', p.article_html], ['FAQ (faq)', faqText(p.faq)], [FACTS_HEADING, factsText(p.facts)]]);
    }
    report.products = items.length;
  }
  if (hasFeature(site, 'categories')) {
    const items = await getAll(site, '/categories', hasFeature(site, 'content'));
    all.push(...items);
    await atomicWrite(path.join(ws, 'categories', 'index.md'),
      indexTable('Categories', items, [['Kind', (c) => TERM_KIND[c.module ?? c.type] ?? c.module ?? c.type ?? ''], ['Parent', (c) => c.parent_id ?? '']]));
    if (hasFeature(site, 'content')) {
      await writeCollection(ws, 'categories', items, (c) => [['Excerpt (excerpt)', c.excerpt_html], ['Content (body)', c.content_html],
        ['FAQ (faq)', faqText(c.faq)]]);
    }
    report.categories = items.length;
  }

  // Inventory: one table for every type, used to check for duplicate topics / keywords before writing
  const inv = all.map((p) => [p.kind === 'category' && TERM_KIND[p.module ?? p.type] ? TERM_KIND[p.module ?? p.type] : p.kind, p.id, p.title, linkOf(p.url) || p.slug, p.focus_keyword, p.seo_score, p.status].map(cell).join(' | '));
  await atomicWrite(path.join(ws, 'site', 'inventory.md'),
    `# Website inventory (${all.length} pages)\n\nBefore proposing a NEW article, look here for a similar topic or focus keyword. If a page already covers it, propose OPTIMISING that page instead of writing a duplicate.\n\nThe **Link** column is the path to use for internal links: copy it verbatim into \`href\` (e.g. \`<a href="/my-post/">\`). Never build links from slugs and never add \`.html\`.\n\n` +
    `| Type | ID | Title | Link | Focus keyword | SEO score | Status |\n|---|---|---|---|---|---|---|\n${inv.map((r) => `| ${r} |`).join('\n')}\n`);

  if (hasFeature(site, 'keywords')) {
    const d = await apiGet(site, '/keywords');
    const rows = (d.items || []).map((k) => [k.keyword, k.group, k.intent, k.target_slug ?? '', k.priority, k.status, k.monthly_searches ?? '', k.position ?? ''].map(cell).join(' | '));
    await atomicWrite(path.join(ws, 'seo', 'keywords.md'),
      `# Keyword bank (${rows.length})\n\nSearch volumes and positions are entered by hand; when missing, never invent numbers.\n\n` +
      `| Keyword | Group | Intent | Target page (slug) | Priority (1 = high) | Status | Searches/month | Position |\n|---|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`);
    report.keywords = rows.length;
  }
  if (hasFeature(site, 'seo')) {
    const s = await apiGet(site, '/seo');
    const byPage = new Map();
    for (const i of s.issues || []) {
      const k = `${i.kind} #${i.id} ${i.title}`;
      if (!byPage.has(k)) byPage.set(k, []);
      byPage.get(k).push(`${i.level === 'error' ? 'ERROR' : i.level === 'warning' ? 'warning' : 'note'}: ${i.message}`);
    }
    const low = (s.scores || []).slice(0, 60).map((p) => [p.kind, p.id, p.title, p.score, p.focus_keyword, p.words].map(cell).join(' | '));
    await atomicWrite(path.join(ws, 'seo', 'audit.md'), [
      `# Website SEO audit — ${s.generated_at}`, '',
      `- Pages: **${s.pages}** · average score: **${s.avg_score}/100** · errors: **${s.summary?.error ?? 0}** · warnings: **${s.summary?.warning ?? 0}**`,
      `- Rules: title ${s.rules?.title?.join('–')} characters, description ${s.rules?.description?.join('–')} characters, minimum words ${JSON.stringify(s.rules?.min_words)}`, '',
      '## 60 lowest-scoring pages', '| Type | ID | Title | Score | Focus keyword | Words |', '|---|---|---|---|---|---|', ...low.map((r) => `| ${r} |`), '',
      '## Issues per page', ...[...byPage].map(([k, v]) => `### ${k}\n${v.map((x) => `- ${x}`).join('\n')}`), '',
    ].join('\n'));
    // Per-type audits for working through one group at a time: seo/audit-products.md, seo/audit-categories.md
    for (const [kind, file] of [['product', 'audit-products.md'], ['category', 'audit-categories.md']]) {
      const sc = (s.scores || []).filter((p) => p.kind === kind).sort((x, y) => x.score - y.score);
      const iss = new Map();
      for (const i of (s.issues || []).filter((x) => x.kind === kind)) {
        const k = `${i.id} ${i.title}`;
        if (!iss.has(k)) iss.set(k, []);
        iss.get(k).push(`${i.level === 'error' ? 'ERROR' : i.level === 'warning' ? 'warning' : 'note'}: ${i.message}`);
      }
      await atomicWrite(path.join(ws, 'seo', file), [
        `# SEO audit — ${kind === 'product' ? 'products' : 'categories'} (${sc.length} pages, ${s.generated_at})`, '',
        'Work from the lowest score up. Change only text, meta and structure: NEVER prices, figures or slugs.', '',
        '| ID | Title | Score | Focus keyword | Words | Issues |', '|---|---|---|---|---|---|',
        ...sc.map((p) => `| ${[p.id, p.title, p.score, p.focus_keyword, p.words, (iss.get(`${p.id} ${p.title}`) || []).length].map(cell).join(' | ')} |`), '',
        '## Details per page', ...[...iss].map(([k, v]) => `### #${k}\n${v.map((x) => `- ${x}`).join('\n')}`), '',
      ].join('\n'));
    }
    report.seo = s.pages;
  }
  if (hasFeature(site, 'schema')) {
    // What this website lets the agent change (fields per page type, notes) — authoritative over the generic prompt.
    const d = await apiGet(site, '/schema');
    const types = Object.entries(d.types || {}).map(([t, v]) =>
      `| \`${t}\` | ${cell(v.label || t)} | ${(v.editable || []).map((f) => `\`${f}\``).join(', ')} | ${(v.create || []).length ? (v.create || []).map((f) => `\`${f}\``).join(', ') : '— (update only)'} |`);
    await atomicWrite(path.join(ws, 'site', 'fields.md'), [
      `# Fields you may propose on this website${d.cms ? ` (${d.cms}${d.version ? ' ' + d.version : ''})` : ''}`, '',
      'This table is **authoritative** for outbox/ files: use only these `type`s and fields; the website refuses anything else.', '',
      d.seo_provider ? `- SEO fields are stored in: **${cell(d.seo_provider)}**` : '',
      '', '| type | Page type | Editable fields (update) | Extra fields on create |', '|---|---|---|---|', ...types, '',
      ...(Array.isArray(d.notes) && d.notes.length ? ['## Notes', ...d.notes.map((n) => `- ${n}`), ''] : []),
    ].join('\n'));
    report.schema = Object.keys(d.types || {}).length;
  }
  if (hasFeature(site, 'proposals')) await writeProposalStatus(site, ws).catch(() => {});
  return report;
}

/** outbox/STATUS.md: proposals already sent and their review status (so the agent does not send duplicates) */
export async function writeProposalStatus(site, ws) {
  const d = await apiGet(site, '/proposals');
  const label = { pending: 'pending', applied: 'APPLIED', rejected: 'rejected', reverted: 'reverted' };   // see docs/SITE_API.md
  const rows = (d.items || []).map((p) => [p.id, p.action, p.type, p.target_id ?? '(new)', p.title, label[p.status] || p.status, (p.fields || []).join(', '), p.reason || '', p.created_at?.slice(0, 10)].map(cell).join(' | '));
  await atomicWrite(path.join(ws, 'outbox', 'STATUS.md'),
    `# Proposals sent to the website (${rows.length} most recent)\n\nDo not send another proposal for a page that has one "pending"; for "rejected" ones, read the reason (ask the user if unclear) before redoing.\n\n` +
    `| # | Action | Type | Page | Summary | Status | Fields | Rejection reason | Date |\n|---|---|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`);
}
