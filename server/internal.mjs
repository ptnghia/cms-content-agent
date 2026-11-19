// Optional service-to-service routes for a hosting layer (e.g. a SaaS web app). Off unless
// createApp({ internal: { token } }) is given; never expose /internal/* publicly (keep it on a
// private network and/or block it in the reverse proxy).
//
//   POST /internal/sites/:id/sync               run a full sync of one site      -> sync result
//   PUT  /internal/sites/:id/knowledge/:name    write knowledge/<name>.md        {content} -> {ok}
//   POST /internal/sites/:id/tasks/:task        one AI turn that answers JSON     {input, uid?} -> {result, usage}
//
// Every request needs `Authorization: Bearer <token>`. Task turns go through beforeTurn / afterTurn
// like chat turns, with kind "task:<name>", share the concurrency limit, are cancelled when the
// caller disconnects, and may not leave proposals behind: any file a task writes to outbox/ is removed.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { syncPosts } from './sync.mjs';

/**
 * @typedef {object} InternalTask
 * @property {(input: any, ctx: {site: object, siteId: string}) => string} prompt   prompt for the agent
 * @property {number} [maxInputChars]   JSON size limit for `input` (default 50 000)
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_KNOWLEDGE_BYTES = 64 * 1024;

const jsonOnly = (shape) =>
  `\n\nAnswer with ONLY one JSON value, no prose and no code fence, exactly in this shape:\n${shape}\n` +
  'Read workspace files as needed, but do not write any file and do not create proposals in outbox/.';

/** Tasks shipped with the core. A host can replace or add tasks through createApp({ internal: { tasks } }). */
export const DEFAULT_TASKS = {
  'keyword-clusters': {
    prompt: (input, { site }) =>
      `Follow skills/keyword-clustering/SKILL.md. Group these keywords for the website "${site.name}" ` +
      `(content language: ${site.language || 'en'}). Use site/inventory.md to suggest an existing page as targetPath ` +
      '(a relative path from its Link column) when one already covers the group.\n\nKeywords (JSON):\n' +
      JSON.stringify(input?.keywords ?? []) +
      jsonOnly('{"groups":[{"name":"string","intent":"informational|commercial|transactional|navigational","keywords":["string"],"targetPath":"string or null"}]}'),
  },
  'seo-plan': {
    prompt: (input, { site }) =>
      `Follow skills/content-plan/SKILL.md. Build an SEO content plan for the website "${site.name}" ` +
      `(content language: ${site.language || 'en'}) from these keywords and the synced content (site/inventory.md, ` +
      `seo/ and posts/). Period: ${input?.periodStart ?? 'next 3 months'} to ${input?.periodEnd ?? ''}. ` +
      `At most ${Math.min(Number(input?.maxItems) || 30, 100)} items. Prefer optimising an existing page over writing a ` +
      'competing new one.\n\nKeywords (JSON):\n' +
      JSON.stringify(input?.keywords ?? []) +
      jsonOnly('{"items":[{"keyword":"string","secondaryKeywords":["string"],"kind":"new|optimize","targetPath":"string or null","title":"string","notes":"string","dueDate":"YYYY-MM-DD or null"}]}'),
  },
};

/** First JSON object or array in a model answer (bare, inside a ```json fence, or between the outer brackets). */
export function extractJson(text) {
  const t = String(text || '').trim();
  const candidates = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) candidates.push(fence[1].trim());
  const first = t.search(/[[{]/);
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      if (value !== null && typeof value === 'object') return { ok: true, value };
    } catch { /* try the next form */ }
  }
  return { ok: false };
}

/** Constant-time comparison that does not leak the token length either. */
function safeEqual(a, b) {
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function listDir(dir) {
  try { return new Set(await readdir(dir)); } catch { return new Set(); }
}

export function createInternalRouter({ token, tasks, provider, store, runTurn, gateTurn, finishTurn, sendJson, readJson, slots, clientGone, logUsage, addDirs }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('internal.token must be at least 32 characters');
  const allTasks = { ...DEFAULT_TASKS, ...(tasks || {}) };

  async function siteOr404(res, siteId) {
    const site = await provider.get(siteId);
    if (!site) sendJson(res, 404, { error: 'site_not_found' });
    return site;
  }

  async function handleTask(req, res, siteId, name) {
    const task = Object.hasOwn(allTasks, name) ? allTasks[name] : null;
    if (!task) return sendJson(res, 404, { error: 'task_not_found' });
    const site = await siteOr404(res, siteId);
    if (!site) return;
    let body;
    try { body = await readJson(req, (task.maxInputChars ?? 50_000) + 1_000); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
    if (!isObject(body)) return sendJson(res, 400, { error: 'bad_json' });
    const uid = typeof body.uid === 'string' && body.uid ? body.uid.slice(0, 64) : 'internal';
    if (!slots.take()) return sendJson(res, 429, { error: 'server_busy' });

    const ctx = { site, siteId, uid, kind: `task:${name}`, requestId: randomUUID() };
    const usage = { turns: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, backend: '', model: '', status: 'UNKNOWN' };
    let status = 'ERROR';
    let gated = false;
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const startedAt = Date.now();
    try {
      const gate = await gateTurn(ctx);
      if (!gate.ok) return sendJson(res, gate.status, gate.body);
      gated = true;
      if (clientGone(req, res)) { status = 'CANCELLED'; return; }

      const workspace = await store.ensureWorkspace(siteId);
      const outbox = path.join(workspace, 'outbox');
      const before = await listDir(outbox);
      let out;
      try {
        out = await runTurn({ prompt: task.prompt(body.input, { site, siteId }), cwd: workspace, addDirs, signal: ac.signal });
      } finally {
        // Tasks answer in JSON only; a proposal written anyway (e.g. prompted by injected input) is dropped.
        for (const f of await listDir(outbox)) if (!before.has(f)) await rm(path.join(outbox, f), { recursive: true, force: true });
      }
      usage.turns = 1;
      usage.backend = out.backend || '';
      usage.model = out.usage?.model || '';
      usage.status = out.status || 'UNKNOWN';
      for (const k of ['inputTokens', 'outputTokens', 'cachedTokens', 'costUsd']) usage[k] = Number(out.usage?.[k]) || 0;
      if (ac.signal.aborted) { status = 'CANCELLED'; return; }
      const parsed = extractJson(out.response);
      if (!parsed.ok) {
        status = 'BAD_OUTPUT'; // tokens were spent: hosts should charge by usage, not by status
        return sendJson(res, 502, { error: 'bad_task_output', usage });
      }
      status = usage.status;
      sendJson(res, 200, { result: parsed.value, usage });
    } catch (e) {
      status = ac.signal.aborted ? 'CANCELLED' : 'ERROR';
      console.error(`[internal] task ${name} ${siteId}: ${e.message}`);
      if (!res.headersSent) sendJson(res, 502, { error: 'task_failed' });
    } finally {
      slots.release();
      if (!res.writableEnded) res.end();
      if (usage.turns) await logUsage({ siteId, uid, kind: ctx.kind, ...usage, status }, startedAt);
      if (gated) await finishTurn({ ...ctx, usage, status });
    }
  }

  async function handleKnowledge(req, res, siteId, name) {
    if (!NAME_RE.test(name)) return sendJson(res, 400, { error: 'bad_name' });
    if (!(await siteOr404(res, siteId))) return;
    let body;
    try { body = await readJson(req, MAX_KNOWLEDGE_BYTES * 2); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
    if (!isObject(body) || typeof body.content !== 'string' || Buffer.byteLength(body.content) > MAX_KNOWLEDGE_BYTES) {
      return sendJson(res, 400, { error: 'bad_content' });
    }
    const dir = path.join(await store.ensureWorkspace(siteId), 'knowledge');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.md`);
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, body.content, 'utf8');
    await rename(tmp, file);
    sendJson(res, 200, { ok: true });
  }

  async function handleSync(res, siteId) {
    const site = await siteOr404(res, siteId);
    if (!site) return;
    try {
      sendJson(res, 200, await syncPosts(siteId, site));
    } catch (e) {
      sendJson(res, 502, { error: 'sync_failed', message: e.message });
    }
  }

  return async function internalRouter(req, res, p) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m || !safeEqual(m[1], token)) return sendJson(res, 401, { error: 'unauthorized' });
    const route = /^\/internal\/sites\/([a-z0-9_-]{1,40})\/(sync|knowledge|tasks)(?:\/([a-z0-9-]{1,40}))?$/i.exec(p);
    if (!route) return sendJson(res, 404, { error: 'not_found' });
    const [, siteId, kind, name] = route;
    if (kind === 'sync' && !name && req.method === 'POST') return handleSync(res, siteId);
    if (kind === 'knowledge' && name && req.method === 'PUT') return handleKnowledge(req, res, siteId, name);
    if (kind === 'tasks' && name && req.method === 'POST') return handleTask(req, res, siteId, name);
    return sendJson(res, 405, { error: 'method_not_allowed' });
  };
}
