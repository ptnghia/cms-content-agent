// Prompt for a NEW agent session: system prompt + workspace state + saved history.
// Prompts are English; {{LANGUAGE}} tells the agent which language to write website content in.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { readSyncStatus } from './sync.mjs';
import { hasFeature } from './content-sync.mjs';
import { skillsIndexBlock } from './skills.mjs';
import { languageName } from './i18n.mjs';

const HISTORY_MAX_MESSAGES = 20;
const HISTORY_MAX_CHARS = 1500;
const LISTING_MAX = 60;
const LISTING_SKIP = new Set(['content', 'sent']);   // hundreds of content files / sent proposals: described, not listed

async function listTree(ws, rel = '', depth = 0, out = []) {
  if (out.length >= LISTING_MAX) return out;
  let entries = [];
  try { entries = await readdir(path.join(ws, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= LISTING_MAX) break;
    const r = path.join(rel, e.name).replaceAll('\\', '/');
    if (e.isDirectory()) {
      if (LISTING_SKIP.has(e.name)) out.push(`${r}/ (folder, see the description above)`);
      else if (depth < 2) await listTree(ws, r, depth + 1, out);
    }
    else out.push(r);
  }
  return out;
}

export async function buildFreshPrompt({ site, workspace, history, message, sourceWorkspace, sourceName }) {
  let tpl = await readFile(path.join(ROOT, 'agent', 'system-prompt.md'), 'utf8');
  // Content sync + proposals enabled (api.features): add the instructions for optimising / writing through outbox/
  if (hasFeature(site, 'proposals') || hasFeature(site, 'content')) {
    tpl += '\n' + await readFile(path.join(ROOT, 'agent', 'system-prompt-content.md'), 'utf8');
  }
  if (sourceWorkspace) {
    // This site is a TRANSLATION of another site (same website, other language): point to the source workspace
    tpl += `\n## Source for translation (read-only, NEVER write here)\nThis website has a source site "${sourceName || 'source'}" with workspace: ${sourceWorkspace}\nEvery page has the **same ID** on both sides: the source is \`${sourceWorkspace}/content/<type>/<id>.md\`, yours is \`content/<type>/<id>.md\`. When asked to translate or update a translation, read the source, translate with the \`content-translation\` skill, then write an \`action: update\` proposal with the same \`id\` to this workspace's \`outbox/\` (update the existing translation, never create a new page).\n`;
  }
  const status = await readSyncStatus(workspace);
  const files = await listTree(workspace);
  const system = tpl
    .replaceAll('{{SITE_NAME}}', site.name || 'website')
    .replaceAll('{{LANGUAGE}}', `${languageName(site.language || 'en')} (${site.language || 'en'})` + (Array.isArray(site.languages) && site.languages.length ? `; multilingual website, languages: ${site.languages.join(', ')}; use the content-translation skill to translate` : ''))
    .replaceAll('{{SYNC_STATUS}}', status ? `(${status.count} items, synced ${status.syncedAt})` : '(NOT synced yet)')
    .replaceAll('{{WORKSPACE_LISTING}}', files.length ? files.map((f) => `- ${f}`).join('\n') : '(empty workspace)');

  const recent = history.slice(-HISTORY_MAX_MESSAGES);
  const transcript = recent.length
    ? '\n\n## Earlier conversation (for context)\n' +
      recent.map((m) => `**${m.role === 'user' ? 'User' : 'Assistant'}:** ${String(m.content).slice(0, HISTORY_MAX_CHARS)}`).join('\n\n')
    : '';
  return `${system}${await skillsIndexBlock(site)}${transcript}\n\n---\nNew request from the user:\n${message}`;
}
