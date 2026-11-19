// HTTP app: chat API (SSE), compose API (SSE), conversations, sync, status, usage, widget.
// createApp() builds the server without listening so tests can drive it; server/server.mjs runs it.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, ROOT } from './config.mjs';
import { verifyToken, signToken, tokenSiteId } from './auth.mjs';
import { staticSiteProvider } from './site-provider.mjs';
import { createInternalRouter } from './internal.mjs';
import { buildFreshPrompt } from './context.mjs';
import { syncPosts, readSyncStatus } from './sync.mjs';
import { syncHealth } from './sync-monitor.mjs';
import { runTurn as defaultRunTurn } from '../bridge/index.mjs';
import { processOutbox, outboxSummary } from './outbox.mjs';
import { SKILLS_DIR } from './skills.mjs';
import { normalizeCompose, buildComposePrompt, parseComposeResponse } from './compose.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { toCms } from './fields.mjs';
import { t } from './i18n.mjs';

const WEB = path.join(ROOT, 'web');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
const HOUR = 3_600_000;

/** Sums usage over every CLI invocation of one request (retries and nudges included). */
function usageMeter() {
  const t = { turns: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, backend: '', model: '', status: 'UNKNOWN' };
  return {
    add(out) {
      if (!out) return;
      t.turns += 1;
      t.backend = out.backend || t.backend;
      t.model = out.usage?.model || t.model;
      t.status = out.status || t.status;
      for (const k of ['inputTokens', 'outputTokens', 'cachedTokens', 'costUsd']) t[k] += Number(out.usage?.[k]) || 0;
    },
    get: () => t,
  };
}

/** The default store (file or sqlite, from STORE_DRIVER) loads on first use, so an injected store never creates it. */
function lazyDefaultStore() {
  let impl;
  const load = () => (impl ??= import('./store.mjs'));
  const method = (name) => async (...args) => (await load())[name](...args);
  return {
    workspaceDir: () => { throw new Error('workspaceDir() needs the store to be loaded; use ensureWorkspace()'); },
    ...Object.fromEntries(['ensureWorkspace', 'createConversation', 'getConversation', 'saveConversation',
      'listConversations', 'deleteConversation', 'recordUsage', 'usageSummary'].map((n) => [n, method(n)])),
    close: async () => { if (impl) (await impl).close(); },
  };
}

/** HTTP status for the codes a beforeTurn hook may refuse with. */
const REFUSAL_STATUS = { insufficient_credits: 402, plan_expired: 402, site_locked: 423, site_inactive: 423, rate_limited: 429, server_busy: 429 };

/**
 * @param {object} o
 * @param {Record<string, object>} [o.sites]   fixed site map (config/sites.json); ignored when siteProvider is given
 * @param {import('./site-provider.mjs').SiteProvider} [o.siteProvider]   async site lookup (see site-provider.mjs)
 * @param {import('./store.mjs').Store} [o.store]   storage for conversations and usage (default: STORE_DRIVER)
 * @param {import('../bridge/index.mjs').RunTurn & ((opts:any)=>Promise<any>)} [o.runTurn]   injectable for tests
 * @param {(ctx: TurnContext) => Promise<{ok: true} | {ok: false, code?: string, message?: string}>} [o.beforeTurn]
 *   runs before every AI turn (chat, compose, internal task); a refusal is answered without calling the agent
 * @param {(ctx: TurnContext & {usage: object, status: string}) => Promise<void>} [o.afterTurn]
 *   runs once after every turn that passed beforeTurn, also when it failed or the client went away
 * @param {{token: string, tasks?: Record<string, import('./internal.mjs').InternalTask>}} [o.internal]
 *   enables the /internal/* routes (see internal.mjs)
 * @param {number} [o.hookTimeoutMs]   beforeTurn / afterTurn give up after this long (default 10 s)
 *
 * @typedef {{site: object, siteId: string, uid: string, kind: string, requestId: string}} TurnContext
 */
export function createApp({ sites, siteProvider, store: injectedStore, runTurn = defaultRunTurn, beforeTurn, afterTurn, internal, hookTimeoutMs = 10_000 } = {}) {
  const provider = siteProvider ?? staticSiteProvider(sites);
  const store = injectedStore ?? lazyDefaultStore();
  const activeConvs = new Set();
  let activeCount = 0;
  const chatLimiter = createRateLimiter({ limit: config.chatPerHour, windowMs: HOUR });
  const composeLimiter = createRateLimiter({ limit: config.composePerHour, windowMs: HOUR });
  const sweeper = setInterval(() => { chatLimiter.sweep(); composeLimiter.sweep(); }, 10 * 60_000);
  sweeper.unref();

  // ---------- helpers ----------
  function corsHeaders(req, allowed) {
    const origin = req.headers.origin;
    if (!origin) return {};
    const sameOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
    if (!allowed && !(config.devMode && sameOrigin)) return null; // blocked
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    };
  }

  /** CORS for a known site. */
  function corsFor(req, site) {
    return corsHeaders(req, (site.allowedOrigins || []).includes(req.headers.origin));
  }

  /** CORS before the site is known (preflight, auth errors): any site allowing the Origin. */
  async function corsForAny(req) {
    const origin = req.headers.origin;
    if (!origin) return {};
    let allowed = false;
    try { allowed = Boolean(await provider.allowsOrigin?.(origin)); } catch (e) { console.warn(`[sites] allowsOrigin: ${e.message}`); }
    return corsHeaders(req, allowed);
  }

  /** A hook that hangs must not hold a concurrency slot forever. */
  function withTimeout(promise, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${hookTimeoutMs} ms`)), hookTimeoutMs); }),
    ]).finally(() => clearTimeout(timer));
  }

  /** beforeTurn wrapper: {ok:true} or the HTTP answer for a refusal. */
  async function gateTurn(ctx) {
    if (!beforeTurn) return { ok: true };
    try {
      const r = await withTimeout(Promise.resolve(beforeTurn(ctx)), 'beforeTurn');
      if (r && r.ok === false) {
        const code = r.code || 'turn_refused';
        return { ok: false, status: REFUSAL_STATUS[code] ?? 403, body: { error: code, ...(r.message ? { message: r.message } : {}) } };
      }
      return { ok: true };
    } catch (e) {
      console.error(`[beforeTurn] ${ctx.siteId}: ${e.message}`);
      return { ok: false, status: 503, body: { error: 'turn_check_failed' } };
    }
  }

  /** afterTurn wrapper: never throws, so the response is never broken by the hook. */
  async function finishTurn(ctx) {
    if (!afterTurn) return;
    try { await withTimeout(Promise.resolve(afterTurn(ctx)), 'afterTurn'); } catch (e) { console.error(`[afterTurn] ${ctx.siteId}: ${e.message}`); }
  }

  /** True once the client has gone away (closed tab, timeout), even before an SSE stream was opened. */
  // (req.destroyed is not a signal: Node destroys the request once its body has been read.)
  const clientGone = (req, res) => Boolean(res.destroyed || req.socket?.destroyed);

  /** Concurrency slots shared by chat, compose and internal tasks. */
  const slots = {
    take() { if (activeCount >= config.maxConcurrent) return false; activeCount++; return true; },
    release() { activeCount--; },
  };

  function sendJson(res, status, obj, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(obj));
  }

  function readJson(req, limit = 100_000) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  /** Bearer token + Origin check. Returns auth or null (response already sent). */
  async function authenticate(req, res) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const siteId = m ? tokenSiteId(m[1]) : null;
    let site = null;
    if (siteId) {
      try {
        site = (await provider.get(siteId)) ?? null;
      } catch (e) {
        console.error(`[sites] ${siteId}: ${e.message}`);
        sendJson(res, 503, { error: 'site_unavailable' }, (await corsForAny(req)) || {});
        return null;
      }
    }
    const v = m ? verifyToken(m[1], site ? { [siteId]: site } : {}) : { ok: false, reason: 'missing' };
    if (!v.ok) {
      sendJson(res, 401, { error: 'unauthorized', reason: v.reason }, (await corsForAny(req)) || {});
      return null;
    }
    const cors = corsFor(req, site);
    if (cors === null) { sendJson(res, 403, { error: 'origin_not_allowed' }); return null; }
    return { ...v, site, cors };
  }

  function rateLimited(res, cors, r, site) {
    sendJson(res, 429, { error: 'rate_limited', retryAfterSec: r.retryAfterSec,
      message: t(site, 'rate_limited', { min: Math.ceil(r.retryAfterSec / 60) }) },
    { ...cors, 'Retry-After': String(r.retryAfterSec) });
  }

  function openSse(res, cors) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...cors,
    });
    const send = (ev) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    if (res.destroyed || res.socket?.destroyed) ac.abort(); // closed before the stream opened
    return { send, ping, ac };
  }

  async function logUsage(entry, startedAt) {
    try {
      await store.recordUsage({ ...entry, durationMs: Date.now() - startedAt });
    } catch (e) {
      console.warn(`[usage] ${e.message}`);
    }
  }

  // ---------- handlers ----------
  async function handleChat(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { siteId, uid, site, cors } = auth;

    let body;
    try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'bad_json' }, cors); }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return sendJson(res, 400, { error: 'empty_message' }, cors);
    if (message.length > config.maxMessageChars) return sendJson(res, 413, { error: 'message_too_long' }, cors);

    let conv;
    if (body.conversationId) {
      conv = await store.getConversation(siteId, String(body.conversationId), uid);
      if (!conv) return sendJson(res, 404, { error: 'conversation_not_found' }, cors);
    }
    if (conv && activeConvs.has(conv.id)) return sendJson(res, 409, { error: 'conversation_busy' }, cors);
    if (activeCount >= config.maxConcurrent) return sendJson(res, 429, { error: 'server_busy', message: t(site, 'server_busy') }, cors);
    const rl = chatLimiter.take(`${siteId}:${uid}`);
    if (!rl.ok) return rateLimited(res, cors, rl, site);
    activeCount++;   // reserve the slot before awaiting, so parallel requests cannot all pass the check
    if (conv) activeConvs.add(conv.id);
    const turn = { site, siteId, uid, kind: 'chat', requestId: randomUUID() };
    const gate = await gateTurn(turn);
    if (!gate.ok) { activeCount--; if (conv) activeConvs.delete(conv.id); return sendJson(res, gate.status, gate.body, cors); }
    if (clientGone(req, res)) {
      // The user left while the hook ran: do not start (and pay for) a turn nobody will read.
      activeCount--; if (conv) activeConvs.delete(conv.id);
      return void (await finishTurn({ ...turn, usage: usageMeter().get(), status: 'CANCELLED' }));
    }
    try { conv ??= await store.createConversation(siteId, uid); } catch (e) {
      activeCount--; if (conv) activeConvs.delete(conv.id);
      await finishTurn({ ...turn, usage: usageMeter().get(), status: 'ERROR' });
      throw e;
    }
    activeConvs.add(conv.id);
    const startedAt = Date.now();
    const meter = usageMeter();
    const { send, ping, ac } = openSse(res, cors);

    let final = null;
    try {
      const workspace = await store.ensureWorkspace(siteId);
      const srcId = site.translationOf;
      const sourceWorkspace = srcId && (await provider.get(srcId)) ? await store.ensureWorkspace(srcId) : null;
      const historyBefore = conv.messages.slice();
      conv.messages.push({ role: 'user', content: message, at: new Date().toISOString() });
      if (!conv.title) conv.title = message.slice(0, 60);
      await store.saveConversation(conv);
      send({ type: 'init', conversationId: conv.id, title: conv.title });

      const run = async (sessionId, text = message) => {
        const prompt = sessionId
          ? text
          : await buildFreshPrompt({ site, workspace, history: historyBefore, message, sourceWorkspace, sourceName: srcId });
        const out = await runTurn({
          prompt,
          cwd: workspace,
          site, siteId, kind: 'chat', requestId: turn.requestId,
          addDirs: [KNOWLEDGE_DIR, SKILLS_DIR, ...(sourceWorkspace ? [sourceWorkspace] : [])],
          sessionId,
          signal: ac.signal,
          onEvent: (ev) => {
            if (ev.type === 'init') conv.agentSessionId = ev.sessionId;
            else if (ev.type === 'delta' || ev.type === 'step') send(ev);
          },
        });
        meter.add(out);
        if (out.sessionId) conv.agentSessionId = out.sessionId;
        return { out };
      };

      let r;
      try {
        r = await run(conv.agentSessionId || undefined);
      } catch (err) {
        if (!conv.agentSessionId || ac.signal.aborted) throw err;
        // The CLI session is gone or broken -> rebuild context from the stored history.
        conv.agentSessionId = null;
        r = await run(undefined);
      }
      let { out } = r;
      if (!out.response.trim() && out.denied.length && !ac.signal.aborted) {
        // The agent tried to run a command (not allowed headless) -> ask it to answer from files only.
        const nudge = 'You cannot run commands or use the network. Answer the last request only by reading workspace files (start with posts/stats.md) and the conversation so far.';
        ({ out } = await run(conv.agentSessionId || undefined, nudge));
      }
      if (!out.response.trim() && !out.denied.length && out.status !== 'CANCELLED' && !ac.signal.aborted && conv.agentSessionId) {
        // Finished without writing an answer -> ask once for a summary instead of failing straight away.
        send({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
        ({ out } = await run(conv.agentSessionId, 'You have not replied yet. Reply to the user now: what you did (which outbox/ files you wrote, if any), the main changes and anything to watch out for. If you could not do the task, say why.'));
      }
      if (out.status === 'CANCELLED') {
        conv.messages.push({ role: 'assistant', content: out.response, aborted: true, at: new Date().toISOString() });
      } else {
        let content = out.response;
        if (!content.trim()) {
          content = out.denied.length
            ? t(site, 'denied', { tools: out.denied.join(', ') })
            : t(site, 'empty_reply');
          send({ type: 'delta', text: content });
        }
        // Proposals the agent wrote into outbox/ -> send to the website review queue, report back in chat.
        let sent = await processOutbox(siteId, site, workspace, conv.id).catch((e) => [{ file: 'outbox', ok: false, error: e.message }]);
        const failed = sent.filter((x) => !x.ok && x.error && x.file !== 'outbox');
        if (failed.length && conv.agentSessionId && !ac.signal.aborted) {
          // Website rejected something (e.g. a changed price) -> give the errors back to the agent once.
          send({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
          try {
            const fix = 'The website REJECTED these proposals. Fix them according to the reasons (keep every price and figure, copy existing <table>s verbatim), write new files to outbox/, then reply briefly with what you fixed:\n' +
              failed.map((f) => `- ${f.file}: ${f.error}${f.warnings?.length ? ' (' + f.warnings.slice(0, 3).join('; ') + ')' : ''}`).join('\n');
            const r2 = await run(conv.agentSessionId, fix);
            const sent2 = await processOutbox(siteId, site, workspace, conv.id).catch((e) => [{ file: 'outbox', ok: false, error: e.message }]);
            if (r2.out.response.trim()) { content += '\n\n' + r2.out.response; send({ type: 'delta', text: '\n\n' + r2.out.response }); }
            if (sent2.length) sent = [...sent.filter((x) => x.ok), ...sent2];   // no new file -> keep the rejected results so the report stays accurate
          } catch { /* keep the first result */ }
        }
        if (sent.length) {
          const note = outboxSummary(sent, site);
          content += note;
          send({ type: 'delta', text: note });
          send({ type: 'proposals', items: sent });
        }
        conv.messages.push({ role: 'assistant', content, at: new Date().toISOString() });
        final = { type: 'result', status: out.status, denied: out.denied, proposals: sent.length };
      }
    } catch (err) {
      send({ type: 'error', message: err.message });
    } finally {
      clearInterval(ping);
      if (final) send(final);
      await store.saveConversation(conv).catch(() => {});
      const u = meter.get();
      const status = final ? u.status : (ac.signal.aborted ? 'CANCELLED' : 'ERROR');
      if (u.turns) await logUsage({ siteId, uid, kind: 'chat', conversationId: conv.id, requestId: turn.requestId, ...u, status }, startedAt);
      activeConvs.delete(conv.id);
      activeCount--;
      res.end();
      await finishTurn({ ...turn, conversationId: conv.id, usage: u, status }); // after the slot and the stream are released
    }
  }

  // ---------- CKEditor "write with AI": single shot, no conversation stored, no outbox ----------
  async function handleCompose(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { siteId, uid, site, cors } = auth;
    let body;
    try { body = await readJson(req, 450_000); } catch { return sendJson(res, 400, { error: 'bad_json' }, cors); }
    const r = normalizeCompose(body, site);
    if (r.mode === 'new' && !r.brief && !r.keyword) return sendJson(res, 400, { error: 'empty_brief', message: t(site, 'empty_brief') }, cors);
    if (r.mode === 'optimize' && !r.cur.body.replace(/<[^>]*>/g, '').trim()) return sendJson(res, 400, { error: 'empty_content', message: t(site, 'empty_content') }, cors);
    if (activeCount >= config.maxConcurrent) return sendJson(res, 429, { error: 'server_busy', message: t(site, 'server_busy') }, cors);
    const rl = composeLimiter.take(`${siteId}:${uid}`);
    if (!rl.ok) return rateLimited(res, cors, rl, site);

    activeCount++;
    const gateCtx = { site, siteId, uid, kind: 'compose', requestId: randomUUID() };
    const gate = await gateTurn(gateCtx);
    if (!gate.ok) { activeCount--; return sendJson(res, gate.status, gate.body, cors); }
    if (clientGone(req, res)) {
      activeCount--;
      return void (await finishTurn({ ...gateCtx, usage: usageMeter().get(), status: 'CANCELLED' }));
    }
    const startedAt = Date.now();
    const meter = usageMeter();
    const { send, ping, ac } = openSse(res, cors);
    let ok = false;
    try {
      const workspace = await store.ensureWorkspace(siteId);
      const prompt = await buildComposePrompt(site, workspace, r);
      let chars = 0;
      let sid;
      const turn = async (text, resume) => {
        const out = await runTurn({
          prompt: text, cwd: workspace, addDirs: [KNOWLEDGE_DIR, SKILLS_DIR], signal: ac.signal, sessionId: resume,
          site, siteId, kind: 'compose', requestId: gateCtx.requestId,
          onEvent: (ev) => {
            if (ev.type === 'init') sid = ev.sessionId;
            else if (ev.type === 'delta') { chars += ev.text.length; send({ type: 'progress', chars }); }
            else if (ev.type === 'step') send({ type: 'step', stepType: ev.stepType, state: ev.state });
          },
        });
        meter.add(out);
        sid = out.sessionId || sid;
        return out;
      };
      let out = await turn(prompt);
      for (let i = 0; i < 2 && !out.response.trim() && out.status !== 'CANCELLED' && sid && !ac.signal.aborted; i++) {
        // The agent tried a blocked shell command and returned nothing -> ask for the formatted answer.
        out = await turn('Shell commands are refused. Use only file reading (or nothing if you already have the data), then answer in EXACTLY the ===SECTION=== format given.', sid);
      }
      if (out.status === 'CANCELLED') return;
      const parsed = parseComposeResponse(out.response || '', t(site, 'bad_format'));
      send({ type: 'result', mode: r.mode, scope: r.scope, fields: toCms(site, parsed.fields), notes: parsed.notes });
      ok = true;
    } catch (err) {
      send({ type: 'error', message: err.message });
    } finally {
      clearInterval(ping);
      const u = meter.get();
      const status = ok ? u.status : (ac.signal.aborted ? 'CANCELLED' : 'ERROR');
      if (u.turns) await logUsage({ siteId, uid, kind: 'compose', requestId: gateCtx.requestId, ...u, status }, startedAt);
      activeCount--;
      res.end();
      await finishTurn({ ...gateCtx, usage: u, status }); // after the slot and the stream are released
    }
  }

  async function handleList(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    sendJson(res, 200, { conversations: await store.listConversations(auth.siteId, auth.uid) }, auth.cors);
  }

  async function handleGetConversation(req, res, id) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const conv = await store.getConversation(auth.siteId, id, auth.uid);
    if (!conv) return sendJson(res, 404, { error: 'conversation_not_found' }, auth.cors);
    sendJson(res, 200, { id: conv.id, title: conv.title, messages: conv.messages }, auth.cors);
  }

  async function handleDelete(req, res, id) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const ok = await store.deleteConversation(auth.siteId, id, auth.uid);
    sendJson(res, ok ? 200 : 404, { ok }, auth.cors);
  }

  async function handleSync(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      sendJson(res, 200, await syncPosts(auth.siteId, auth.site), auth.cors);
    } catch (err) {
      sendJson(res, 502, { error: 'sync_failed', message: err.message }, auth.cors);
    }
  }

  async function handleStatus(req, res) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const ws = await store.ensureWorkspace(auth.siteId);
    sendJson(res, 200, { site: auth.site.name, posts: await readSyncStatus(ws), sync: syncHealth(auth.siteId) }, auth.cors);
  }

  /** GET /api/usage?days=30 -> this user's and the whole site's usage over the period. */
  async function handleUsage(req, res, url) {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const days = Math.min(366, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [mine, site] = await Promise.all([
      store.usageSummary(auth.siteId, { uid: auth.uid, since }),
      store.usageSummary(auth.siteId, { since }),
    ]);
    sendJson(res, 200, { since, days, mine, site }, auth.cors);
  }

  async function serveFile(res, file, type, extra = {}) {
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
      res.end(data);
    } catch { res.writeHead(404).end('Not found'); }
  }

  const internalRouter = internal
    ? createInternalRouter({ ...internal, provider, store, runTurn, gateTurn, finishTurn, sendJson, readJson, slots, clientGone,
      logUsage, addDirs: [KNOWLEDGE_DIR, SKILLS_DIR] })
    : null;

  // ---------- router ----------
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    const fail = (e) => { console.error(`[http] ${req.method} ${p}: ${e.stack || e.message}`); if (!res.headersSent) sendJson(res, 500, { error: 'internal' }); else res.end(); };
    const wrap = (fn) => fn().catch(fail);

    if (req.method === 'OPTIONS') {
      return void wrap(async () => {
        const cors = await corsForAny(req);
        res.writeHead(cors ? 204 : 403, cors || {});
        res.end();
      });
    }
    if (internalRouter && p.startsWith('/internal/')) return void wrap(() => internalRouter(req, res, p));

    if (req.method === 'GET' && p === '/api/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/widget.js') {
      return void serveFile(res, path.join(WEB, 'widget.js'), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'POST' && p === '/api/compose') return void wrap(() => handleCompose(req, res));
    if (req.method === 'POST' && p === '/api/chat') return void wrap(() => handleChat(req, res));
    if (req.method === 'GET' && p === '/api/conversations') return void wrap(() => handleList(req, res));
    if (req.method === 'POST' && p === '/api/sync') return void wrap(() => handleSync(req, res));
    if (req.method === 'GET' && p === '/api/status') return void wrap(() => handleStatus(req, res));
    if (req.method === 'GET' && p === '/api/usage') return void wrap(() => handleUsage(req, res, url));
    const m = /^\/api\/conversations\/([0-9a-f-]{36})$/.exec(p);
    if (m && req.method === 'GET') return void wrap(() => handleGetConversation(req, res, m[1]));
    if (m && req.method === 'DELETE') return void wrap(() => handleDelete(req, res, m[1]));

    // Dev routes mint tokens without auth: loopback Host only (also blocks DNS rebinding).
    if (config.devMode && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) {
      if (req.method === 'GET' && p === '/') return void serveFile(res, path.join(WEB, 'demo.html'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/dev/token') {
        return void wrap(async () => {
          const siteId = url.searchParams.get('site') || (await provider.list?.())?.[0];
          const site = siteId ? await provider.get(siteId) : null;
          if (!site) return sendJson(res, 404, { error: 'site' });
          const token = signToken(
            { site: siteId, uid: url.searchParams.get('uid') || 'dev', name: 'Dev', exp: Math.floor(Date.now() / 1000) + 3600 },
            site.tokenSecret);
          sendJson(res, 200, { token });
        });
      }
    }
    res.writeHead(404).end('Not found');
  });
  server.on('close', () => clearInterval(sweeper));
  /** Releases the store when createApp created it (an injected store is closed by its owner). */
  server.closeStore = () => (injectedStore ? undefined : store.close());
  return server;
}
