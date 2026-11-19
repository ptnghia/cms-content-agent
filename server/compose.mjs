// Editor plugin "write with AI" (POST /api/compose): builds the prompt (new article / optimise an existing page)
// and parses the answer, which is split into ===SECTION=== blocks. No outbox here: the plugin fills the form
// and the admin reviews before saving. Field names are canonical (server/fields.mjs); the request may also use
// the site's own names (site.fieldMap) and the response is mapped back to them in app.mjs.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { skillsComposeBlock } from './skills.mjs';
import { fromCms, canonicalName } from './fields.mjs';
import { linkOf, FACTS_HEADING } from './content-sync.mjs';
import { languageName } from './i18n.mjs';

const LENGTHS = { short: 'about 600–800 words', medium: 'about 1000–1300 words', long: 'about 1500–2000 words' };
const LENGTH_ALIASES = { ngan: 'short', vua: 'medium', dai: 'long' };   // values sent by plugin versions <= 0.4
const SCOPES = {
  all: 'Optimise BOTH content and SEO: keep the main points, improve structure, wording, keywords and internal links; rewrite the meta.',
  seo: 'Optimise SEO ONLY: keep the CONTENT as is (do not return BODY); return only NAME, EXCERPT, META_TITLE, META_DESCRIPTION, KEYWORDS.',
  content: 'Optimise CONTENT ONLY (structure, wording, keywords, internal links): do not return META_TITLE, META_DESCRIPTION, KEYWORDS.',
};
const TYPES = {
  post: 'blog post',
  page: 'static PAGE (about, services, contact…)',
  product: 'PRODUCT (a page selling one product or service)',
  category: 'CATEGORY (a page grouping products or topics)',
};
const TARGETS = { excerpt: 'Excerpt (excerpt)', body: 'Content (body)', body_extra: 'Long description (body_extra)' };
const SALES = new Set(['product', 'category']);   // sales pages: facts are read-only, no name/excerpt rewrite
const clip = (s, n) => String(s ?? '').slice(0, n);

export function normalizeCompose(b, site) {
  const mode = b.mode === 'optimize' ? 'optimize' : 'new';
  const cur = fromCms(site, b.cur && typeof b.cur === 'object' ? b.cur : {});
  const target = b.target ? canonicalName(site, String(b.target)) : '';
  return {
    mode,
    brief: clip(b.brief, 3000).trim(),
    keyword: clip(b.keyword, 200).trim(),
    length: LENGTHS[LENGTH_ALIASES[b.length] || b.length] ? (LENGTH_ALIASES[b.length] || b.length) : 'medium',
    scope: SCOPES[b.scope] ? b.scope : 'all',
    type: TYPES[b.type] ? b.type : 'post',
    target: TARGETS[target] ? target : 'body',
    postId: Number(b.itemId || b.postId) > 0 ? Number(b.itemId || b.postId) : 0,
    images: {
      featured: b.images?.featured && typeof b.images.featured === 'object' ? { name: clip(b.images.featured.name, 100), file: clip(b.images.featured.file, 200), url: clip(b.images.featured.url, 500) } : null,
      inline: (Array.isArray(b.images?.inline) ? b.images.inline : []).slice(0, 8).map((x) => ({ name: clip(x?.name, 100), url: clip(x?.url, 500), alt: clip(x?.alt, 160).trim() })),
    },
    others: Object.fromEntries(Object.entries(fromCms(site, b.others && typeof b.others === 'object' ? b.others : {})).filter(([k]) => TARGETS[k]).map(([k, v]) => [k, clip(v, 20000)])),
    cur: { name: clip(cur.name, 300), excerpt: clip(cur.excerpt, 2000), body: clip(cur.body, 300000),
           meta_title: clip(cur.meta_title, 300), meta_description: clip(cur.meta_description, 600), meta_keywords: clip(cur.meta_keywords, 500) },
  };
}


// ---------- Pick the relevant data up front (the agent does not open files in compose) ----------
// Stop words (accent-folded) for the languages we ship; extend for others.
const STOP = new Set(('la va cua cho cac nhung mot co khong duoc trong tai voi den tu khi nay do the nao gi bai viet ve nen can muon hay thi se da dang ' +
  'nhu theo cung nhieu rat nhat hon so tren duoi ra vao lai ma neu thay vi nhung boi ' +
  'the a an and or of to in on for with is are be by at as from it this that how what why your you our we best guide').split(' '));
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const tokens = (s) => [...new Set(fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)))];
const plainText = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const fmVal = (fm, k) => { const m = new RegExp('^' + k + ':\\s*(.*)$', 'm').exec(fm); if (!m) return ''; try { return JSON.parse(m[1]); } catch { return m[1]; } };

let cache = { at: 0, items: [] };
async function loadItems(ws) {
  if (Date.now() - cache.at < 60_000 && cache.ws === ws) return cache.items;
  const items = [];
  for (const kind of ['posts', 'products', 'categories']) {
    let names = [];
    try { names = await readdir(path.join(ws, 'content', kind)); } catch { continue; }
    for (const n of names.filter((x) => x.endsWith('.md'))) {
      let txt = '';
      try { txt = await readFile(path.join(ws, 'content', kind, n), 'utf8'); } catch { continue; }
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(txt);
      if (!m) continue;
      const fm = m[1], body = m[2];
      const fi = body.indexOf(`## ${FACTS_HEADING}`);
      const facts = fi >= 0 ? /\n([\s\S]*?)(?=\n## |$)/.exec(body.slice(fi + FACTS_HEADING.length + 3)) : null;
      const main = plainText(fi >= 0 ? body.slice(0, fi) : body).replace(/^\(no content\)$/, '');
      const issues = (/^seo_issues:\n((?:  - .*\n?)+)/m.exec(fm) || [])[1] || '';
      items.push({
        kind: fmVal(fm, 'kind') || { posts: 'post', products: 'product', categories: 'category' }[kind], id: Number(fmVal(fm, 'id')), title: fmVal(fm, 'title'), slug: fmVal(fm, 'slug'), url: fmVal(fm, 'url'), kw: fmVal(fm, 'focus_keyword'),
        keywords: fmVal(fm, 'keywords'), score: fmVal(fm, 'seo_score'), status: fmVal(fm, 'status'), text: main,
        facts: facts ? facts[1].trim().slice(0, 600) : '', factsFull: facts ? facts[1].trim().slice(0, 1800) : '', issues: issues.split('\n').map((l) => l.replace(/^  - /, '').replace(/^"|"$/g, '')).filter(Boolean),
      });
    }
  }
  cache = { at: Date.now(), ws, items };
  return items;
}

function rank(items, query, skip) {
  const q = tokens(query);
  if (!q.length) return [];
  return items.filter((it) => it.slug && !(skip && it.kind === skip.kind && it.id === skip.id) && it.status !== 'hidden').map((it) => {
    const t = new Set(tokens(`${it.title} ${it.slug.replace(/-/g, ' ')}`)), k = new Set(tokens(`${it.kw} ${it.keywords}`)), b = new Set(tokens(it.text.slice(0, 2500)));
    let sc = 0;
    for (const w of q) sc += (t.has(w) ? 3 : 0) + (k.has(w) ? 3 : 0) + (b.has(w) ? 1 : 0);
    return { it, sc: sc / Math.sqrt(q.length) };
  }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
}

const line = (it) => `[${it.kind} #${it.id}] ${it.title} | link: ${linkOf(it.url) || it.slug} | keyword: ${it.kw || '-'}`;
const rel = (it, n) => `### ${line(it)}\nSummary: ${it.text.slice(0, n)}${it.facts ? `\nRead-only facts:\n${it.facts}` : ''}`;

/** Data block for the prompt: page list (duplicates + internal links) + the 3–5 most relevant pages */
export async function buildContextBlock(ws, r) {
  const items = await loadItems(ws);
  const query = `${r.brief} ${r.keyword} ${r.cur.name} ${r.mode === 'optimize' ? `${r.cur.meta_keywords} ${plainText(r.cur.body).slice(0, 600)}` : ''}`;
  const self = r.postId ? { kind: r.type, id: r.postId } : null;
  const top = rank(items, query, self).slice(0, 5).map((x) => x.it);
  const parts = [];
  parts.push(`## Website data (preselected: you do NOT need to and must NOT open files)\n\n### All pages (to avoid duplicate topics and to take internal links from)\n` +
    items.filter((it) => it.slug && it.status !== 'hidden').map((it) => `- ${line(it)}`).join('\n'));
  const me = self ? items.find((it) => it.kind === self.kind && it.id === self.id) : null;
  if (SALES.has(r.type) && me?.factsFull) parts.push(`### Read-only facts of THIS ${r.type} (the source of truth for figures and policies; never change them or add new ones)\n${me.factsFull}`);
  if (r.mode === 'new') {
    parts.push(`### Pages most related to the request (sources of facts; possible duplicate topics)\n` + (top.length ? top.map((it) => rel(it, 900)).join('\n\n') : '(no clearly related page)'));
  } else {
    if (me) parts.push(`### Current SEO score of the page being optimised: ${me.score}/100\n` + (me.issues.length ? me.issues.map((x) => `- ${x}`).join('\n') : '(no recorded issues)'));
    parts.push(`### Related pages (internal link ideas / facts to cross-check)\n` + (top.length ? top.map((it) => rel(it, 450)).join('\n\n') : '(none)'));
  }
  return parts.join('\n\n');
}

/** Only images hosted by the website itself: URL under site.mediaOrigins (default: allowedOrigins), image extension. */
function safeImages(site, imgs) {
  const origins = (site.mediaOrigins || site.allowedOrigins || []).map((o) => o.replace(/\/$/, ''));
  const ok = (u) => origins.some((o) => u.startsWith(`${o}/`)) && /^[^?#"'<>\s]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(u);
  return { featured: imgs.featured && ok(imgs.featured.url) ? imgs.featured : null, inline: imgs.inline.filter((x) => ok(x.url)) };
}

function imagesBlock(im, r) {
  if (!im.inline.length && !im.featured) return '';
  const out = ['## Images uploaded by the editor (already on the website: use these exact URLs)'];
  if (im.featured) out.push(`Featured image: ${im.featured.name}. It is set automatically; do NOT insert it in the body.`);
  if (im.inline.length) {
    out.push(`Images for the content: insert ALL ${im.inline.length}, each in its own paragraph, where they fit (after the paragraph about that topic; not before the introduction):`);
    im.inline.forEach((x, i) => out.push(`${i + 1}. URL: ${x.url} — original name: ${x.name}${x.alt ? ` — editor's description: "${x.alt}"` : ' — (no description)'}`));
    out.push('Insert as `<p><img src="URL" alt="short description"></p>`. You CANNOT see the images: base alt text only on the editor\'s description and the topic of that paragraph (without a description, use a neutral alt about the article topic; never guess what is in the picture). Never invent URLs; if an image does not fit anywhere, put it at the end of the closest section and say so in NOTES.');
    if (r.mode === 'optimize') out.push('The article already has images: KEEP them all and only add the new ones above.');
  }
  return out.join('\n');
}

export async function buildComposePrompt(site, workspace, r) {
  const tpl = await readFile(path.join(ROOT, 'agent', 'compose-prompt.md'), 'utf8');
  const parts = [tpl.replaceAll('{{SITE_NAME}}', site.name || 'website').replaceAll('{{LANGUAGE}}', `${languageName(site.language || 'en')} (${site.language || 'en'})`), await buildContextBlock(workspace, r)];
  if (r.mode === 'new') {
    parts.push(`## Task: WRITE A NEW ARTICLE\nLength: ${LENGTHS[r.length]}.\nEditor's brief:\n${r.brief || '(no brief: infer it from the keyword)'}\n${r.keyword ? `Suggested focus keyword: ${r.keyword}\n` : ''}`);
    if (r.cur.body.trim()) parts.push(`The editor already has a draft (for reference, you may reuse ideas):\n${clip(r.cur.body, 8000)}`);
  } else {
    parts.push(`## Task: OPTIMISE AN EXISTING ARTICLE\nScope: ${SCOPES[r.scope]}${SALES.has(r.type) ? ' (sales page: do not return NAME, EXCERPT)' : ''}\nEditor's notes:\n${r.brief || '(none: assess it against the SEO checklist)'}\n${r.keyword ? `Focus keyword: ${r.keyword}\n` : ''}${r.postId ? `Post ID on the website: ${r.postId} (its SEO score and issues are in the data section above)\n` : 'Not saved yet, so it is not in the synced data.\n'}`);
    const c = r.cur;
    parts.push(`### Current article (source of truth: keep images, tables, links and every figure)\nNAME: ${c.name}\nEXCERPT: ${c.excerpt}\nMETA_TITLE: ${c.meta_title}\nMETA_DESCRIPTION: ${c.meta_description}\nKEYWORDS: ${c.meta_keywords}\nBODY (HTML):\n${c.body}`);
  }
  if (SALES.has(r.type)) {
    const prod = r.type === 'product';
    const others = Object.entries(r.others).filter(([k, v]) => k !== r.target && plainText(v)).map(([k, v]) => `- ${TARGETS[k]}: ${clip(plainText(v), 1800)}`).join('\n');
    parts.push(`## Page type: ${TYPES[r.type]}; target field: ${TARGETS[r.target]}\n` +
      `This is a SALES page, not a blog post: return only BODY (for the target field), META_TITLE, META_DESCRIPTION, KEYWORDS, NOTES. Do NOT return NAME or EXCERPT (the name and URL stay).\n` +
      `- NEVER invent, change or add prices, offers, dates, policies, specs, quantities or sizes. Figures come only from the read-only facts or the current content; when unsure, leave them out. Never add new prices to the content.\n` +
      (prod ? `- Product: \`body\` is the price table / main info (do not write there), \`body_extra\` is the long description below it, \`excerpt\` is the short description at the top. Write for the target field's role; you may add an FAQ section (H2 + H3 questions) using only existing facts.\n- Internal links: to the product's category and related products that exist in the page list.\n` :
        `- Category: \`excerpt\` is the short intro at the top (60–120 words, 1–2 <p>); \`body\` is the SEO article at the bottom (introduce the group or topic, help choose, link down to products that exist in this category).\n`) +
      (r.target === 'excerpt' ? '- The target field is the SHORT DESCRIPTION: 60–120 words, 1–2 <p>, no H2; ignore the length above.\n' : '') +
      (others ? `\nOther fields of this page (only to cross-check facts; do NOT rewrite or change them):\n${others}` : ''));
  }
  const imBlock = imagesBlock(safeImages(site, r.images), { mode: r.mode });
  if (imBlock) parts.push(imBlock);
  const skillsBlock = await skillsComposeBlock(site, [r.mode, ...(SALES.has(r.type) ? ['sales'] : [])]);
  if (skillsBlock) parts.push(skillsBlock);
  parts.push('Start now: all the data you need is above; do NOT open files or run commands. Answer immediately in EXACTLY the ===SECTION=== format above, with no preamble.');
  return parts.join('\n\n');
}

const KEYS = ['NAME', 'EXCERPT', 'META_TITLE', 'META_DESCRIPTION', 'KEYWORDS', 'NOTES', 'BODY'];

/** Parse ===SECTION=== blocks (the last one, BODY, takes the rest). Returns {fields, notes} with canonical names, or throws. */
export function parseComposeResponse(text, formatError = 'The agent did not answer in the expected ===SECTION=== format. Please try again.') {
  const out = {};
  const re = /^===\s*([A-Z_]+)\s*===[ \t]*\r?\n?/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) if (KEYS.includes(m[1])) marks.push({ k: m[1], start: m.index, body: m.index + m[0].length });
  if (!marks.length) throw new Error(formatError);
  marks.forEach((mk, i) => { out[mk.k] = text.slice(mk.body, i + 1 < marks.length ? marks[i + 1].start : text.length).trim(); });
  let html = out.BODY || '';
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return {
    fields: { name: out.NAME || '', excerpt: out.EXCERPT || '', body: html, meta_title: out.META_TITLE || '', meta_description: out.META_DESCRIPTION || '', meta_keywords: out.KEYWORDS || '' },
    notes: out.NOTES || '',
  };
}
