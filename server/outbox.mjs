// OUTBOX: the agent (no network) writes proposals into workspace/outbox/; after each chat turn the backend
// posts them to the website. Only for sites with "proposals" in api.features. The website does NOT apply
// them: they land in the admin review queue.
//
// Format 1 — Markdown  outbox/<name>.md
//   ---
//   action: update            (update | create — create only for type post)
//   type: post                (post | product | category)
//   id: 291                   (required for update)
//   summary: Shorten meta title/description, add an H2 section
//   note: Reason / evidence (e.g. from seo/audit.md)
//   body_field: body          (field that receives the body below; default body — products: body_extra is the long article)
//   meta_title: …   meta_description: …   meta_keywords: …   name: …   excerpt: …
//   slug: …   category_id: …   featured_image: …        (create only)
//   ---
//   <HTML or Markdown body — leave empty when only meta changes>
//
// Format 2 — JSON  outbox/<name>.json   {"action","type","id","summary","note","fields":{…}}   (FAQ: fields.faq = [{question, answer}])
// JSON also accepts "patches": {"body_extra":[{"find":"…","replace":"…"}]} — in-place edits of an HTML field (update only).
//
// Field names are canonical (server/fields.mjs) and renamed to the site's own columns with site.fieldMap
// just before sending. After sending, the file moves to outbox/sent/<time>-<name> next to <…>.result.json.
import { t } from './i18n.mjs';
import { readdir, readFile, mkdir, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { hasFeature, writeProposalStatus } from './content-sync.mjs';
import { withUnlocked } from './workspace-guard.mjs';
import { toCms } from './fields.mjs';

const MAX_FILES = 20;
const MAX_BYTES = 600_000;
const META_KEYS = new Set(['action', 'type', 'id', 'summary', 'note', 'body_field']);

function parseValue(v) {
  v = v.trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1);
  return v;
}

/** Front-matter "key: value" (one line per value) + body */
export function parseMarkdownProposal(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('Missing front-matter (--- … ---) at the top of the file');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = parseValue(kv[2]);
  }
  const fields = {};
  for (const [k, v] of Object.entries(meta)) if (!META_KEYS.has(k)) fields[k] = v;
  const body = m[2].trim();
  if (body) fields[meta.body_field || 'body'] = /<(p|h[1-6]|ul|ol|table|div|figure|img|blockquote)\b/i.test(body) ? body : markdownToHtml(body);
  return { action: meta.action || 'update', type: meta.type, id: meta.id ? Number(meta.id) : undefined, title: meta.summary || '', note: meta.note || '', fields };
}

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function inlineMd(s) {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+|[a-z0-9-]+\.html)\)/gi, '<a href="$2">$1</a>');
}
/** Minimal Markdown -> HTML (H1 becomes H2: the page already has its title as H1) */
export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const lv = Math.max(2, m[1].length); out.push(`<h${lv}>${inlineMd(m[2])}</h${lv}>`); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {   // table
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|\s*$/.test(r));
      if (body.length) {
        out.push('<table><thead><tr>' + cells(body[0]).map((c) => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>' +
          body.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      }
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<blockquote><p>${inlineMd(m[1])}</p></blockquote>`); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

async function postProposal(site, payload) {
  const res = await fetch(`${site.api.base.replace(/\/$/, '')}/proposals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${site.api.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = body.error || {};
    return { ok: false, error: e.message || `HTTP ${res.status}`, warnings: e.details || [] };
  }
  const d = body.data || {};
  return { ok: true, id: d.id, status: d.status, warnings: d.warnings || [], review_url: d.review_url, fields: d.fields || [] };
}

/**
 * Send every file in outbox/ (not recursive). Returns one result per file (empty when there is nothing or the feature is off).
 * @returns {Promise<Array<{file:string, ok:boolean, id?:number, warnings?:string[], review_url?:string, error?:string}>>}
 */
export async function processOutbox(siteId, site, ws, source = '') {
  if (!hasFeature(site, 'proposals')) return [];
  return withUnlocked(ws, () => sendOutbox(siteId, site, ws, source));
}

async function sendOutbox(siteId, site, ws, source) {
  const dir = path.join(ws, 'outbox');
  const sent = path.join(dir, 'sent');
  let names = [];
  try { names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; }
  names = names.filter((n) => /\.(md|json)$/i.test(n) && !/^(STATUS|README)\.md$/i.test(n) && !/^[._]/.test(n)).sort().slice(0, MAX_FILES);
  if (!names.length) return [];
  await mkdir(sent, { recursive: true });
  const results = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let r;
    try {
      if ((await stat(file)).size > MAX_BYTES) throw new Error(`File larger than ${MAX_BYTES / 1000} KB`);
      const text = await readFile(file, 'utf8');
      const p = name.toLowerCase().endsWith('.json') ? (() => { const j = JSON.parse(text); return { ...j, title: j.summary || j.title || '' }; })() : parseMarkdownProposal(text);
      r = await postProposal(site, { action: p.action, type: p.type, id: p.id, title: p.title, note: p.note,
        fields: toCms(site, p.fields), patches: p.patches ? toCms(site, p.patches) : undefined,
        source: `agent:${siteId}:${name}${source ? ':' + source : ''}`.slice(0, 100) });
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.join(sent, `${stamp}-${name}`);
    await rename(file, target).catch(() => {});
    await writeFile(`${target}.result.json`, JSON.stringify(r, null, 2), 'utf8').catch(() => {});
    results.push({ file: name, ...r });
  }
  await writeProposalStatus(site, ws).catch(() => {});
  return results;
}

/** Delivery report appended to the chat answer (Markdown, in the site's UI language). */
export function outboxSummary(results, site) {
  if (!results.length) return '';
  const lines = results.map((r) => r.ok
    ? `- ${t(site, 'sent_ok', { file: r.file, id: r.id })}${r.review_url ? ` — [${t(site, 'sent_review')}](${r.review_url})` : ''}${r.warnings?.length ? `\n  - ${t(site, 'sent_warn')}: ${r.warnings.join('; ')}` : ''}`
    : `- ${t(site, 'sent_fail', { file: r.file, error: r.error })}${r.warnings?.length ? ` (${r.warnings.join('; ')})` : ''}`);
  return `\n\n---\n**${t(site, 'sent_title')}**\n${lines.join('\n')}`;
}
