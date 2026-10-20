// Backend: API chat (SSE) + lưu hội thoại + đồng bộ dữ liệu website + phục vụ widget nhúng.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, loadSites, ROOT } from './config.mjs';
import { verifyToken, signToken } from './auth.mjs';
import * as store from './store.mjs';
import { buildFreshPrompt } from './context.mjs';
import { syncPosts, readSyncStatus } from './sync.mjs';
import { runTurn } from '../bridge/agy-client.mjs';
import { processOutbox, outboxSummary } from './outbox.mjs';
import { normalizeCompose, buildComposePrompt, parseComposeResponse } from './compose.mjs';

const sites = loadSites();
const WEB = path.join(ROOT, 'web');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

const activeConvs = new Set();
let activeCount = 0;

// ---------- helpers ----------
function corsFor(req, site) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const sameOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  const allowed = site
    ? (site.allowedOrigins || []).includes(origin)
    : Object.values(sites).some((s) => (s.allowedOrigins || []).includes(origin));
  if (!allowed && !(config.devMode && sameOrigin)) return null; // bị chặn
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
}

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

/** Xác thực Bearer token + kiểm tra Origin. Trả về auth hoặc null (đã trả lỗi). */
function authenticate(req, res) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const v = m ? verifyToken(m[1], sites) : { ok: false, reason: 'missing' };
  const baseCors = corsFor(req, null) || {};
  if (!v.ok) {
    sendJson(res, 401, { error: 'unauthorized', reason: v.reason }, baseCors);
    return null;
  }
  const cors = corsFor(req, sites[v.siteId]);
  if (cors === null) { sendJson(res, 403, { error: 'origin_not_allowed' }); return null; }
  return { ...v, site: sites[v.siteId], cors };
}

// ---------- handlers ----------
async function handleChat(req, res) {
  const auth = authenticate(req, res);
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
  } else {
    conv = await store.createConversation(siteId, uid);
  }
  if (activeConvs.has(conv.id)) return sendJson(res, 409, { error: 'conversation_busy' }, cors);
  if (activeCount >= config.maxConcurrent) return sendJson(res, 429, { error: 'server_busy' }, cors);

  activeConvs.add(conv.id);
  activeCount++;
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

  const workspace = await store.ensureWorkspace(siteId);
  const historyBefore = conv.messages.slice();
  conv.messages.push({ role: 'user', content: message, at: new Date().toISOString() });
  if (!conv.title) conv.title = message.slice(0, 60);
  await store.saveConversation(conv);
  send({ type: 'init', conversationId: conv.id, title: conv.title });

  const run = async (agyConversationId, text = message) => {
    let sawOutput = false;
    const prompt = agyConversationId
      ? text
      : await buildFreshPrompt({ site, workspace, history: historyBefore, message });
    const out = await runTurn({
      prompt,
      cwd: workspace,
      addDirs: [KNOWLEDGE_DIR],
      agyConversationId,
      signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === 'init') {
          conv.agyConversationId = ev.agyConversationId;
        } else if (ev.type === 'delta') {
          sawOutput = true;
          send(ev);
        } else if (ev.type === 'step') {
          send(ev);
        }
      },
    });
    return { out, sawOutput };
  };

  let final = null;
  try {
    let r;
    try {
      r = await run(conv.agyConversationId || undefined);
    } catch (err) {
      if (!conv.agyConversationId || ac.signal.aborted) throw err;
      // Hội thoại agy cũ không dùng được -> dựng lại từ lịch sử đã lưu ở backend.
      conv.agyConversationId = null;
      r = await run(undefined);
    }
    let { out } = r;
    if (!out.response.trim() && out.denied.length && !ac.signal.aborted) {
      // Agent cố chạy lệnh (không được phép ở chế độ headless) -> nhắc trả lời chỉ dựa trên file.
      const nudge = 'Bạn không được phép chạy lệnh hay gọi mạng. Hãy trả lời yêu cầu vừa rồi chỉ bằng cách đọc file trong workspace (ưu tiên posts/stats.md) và ngữ cảnh hội thoại.';
      ({ out } = await run(conv.agyConversationId || undefined, nudge));
    }
    if (!out.response.trim() && !out.denied.length && out.status !== 'CANCELLED' && !ac.signal.aborted && conv.agyConversationId) {
      // Agent chạy xong nhưng không viết câu trả lời nào → nhắc tóm tắt kết quả (một lần) thay vì báo lỗi ngay
      send({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
      ({ out } = await run(conv.agyConversationId, 'Bạn chưa trả lời. Hãy trả lời người dùng ngay: tóm tắt đã làm gì (file nào đã ghi trong outbox/ nếu có), thay đổi chính và điều cần lưu ý. Nếu chưa làm được việc được giao thì nói rõ lý do.'));
    }
    if (out.status === 'CANCELLED') {
      conv.messages.push({ role: 'assistant', content: out.response, aborted: true, at: new Date().toISOString() });
    } else {
      let content = out.response;
      if (!content.trim()) {
        content = out.denied.length
          ? `Tác vụ bị từ chối vì agent không có quyền: ${out.denied.join(', ')}.`
          : 'Agent không trả về nội dung. Hãy thử lại.';
        send({ type: 'delta', text: content });
      }
      // Đề xuất agent vừa ghi vào outbox/ → gửi lên website (hàng chờ duyệt), báo lại trong khung chat
      let sent = await processOutbox(siteId, site, workspace, conv.id).catch((e) => [{ file: 'outbox', ok: false, error: e.message }]);
      const failed = sent.filter((x) => !x.ok && x.error && x.file !== 'outbox');
      if (failed.length && conv.agyConversationId && !ac.signal.aborted) {
        // Website từ chối (vd đổi số giá) → đưa lỗi lại cho agent sửa file outbox/ một lần rồi gửi lại
        send({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
        try {
          const fix = 'Website đã TỪ CHỐI các đề xuất sau. Sửa lại theo đúng lý do (giữ nguyên mọi con số giá trong bảng, copy nguyên văn các <table>), ghi file mới vào outbox/ rồi trả lời ngắn gọn đã sửa gì:\n' +
            failed.map((f) => `- ${f.file}: ${f.error}${f.warnings?.length ? ' (' + f.warnings.slice(0, 3).join('; ') + ')' : ''}`).join('\n');
          const r2 = await run(conv.agyConversationId, fix);
          const sent2 = await processOutbox(siteId, site, workspace, conv.id).catch((e) => [{ file: 'outbox', ok: false, error: e.message }]);
          if (r2.out.response.trim()) { content += '\n\n' + r2.out.response; send({ type: 'delta', text: '\n\n' + r2.out.response }); }
          if (sent2.length) sent = [...sent.filter((x) => x.ok), ...sent2];   // agent không ghi file mới → giữ nguyên kết quả bị từ chối để báo đúng
        } catch { /* giữ kết quả lần đầu */ }
      }
      if (sent.length) {
        const note = outboxSummary(sent);
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
    activeConvs.delete(conv.id);
    activeCount--;
    res.end();
  }
}

// ---------- plugin CKEditor "Viết bằng AI": một lượt, không lưu hội thoại, không ghi outbox ----------
const composeLog = new Map();   // uid -> [thời điểm các lần gọi gần đây]
const COMPOSE_PER_HOUR = Number(process.env.COMPOSE_PER_HOUR || 12);

async function handleCompose(req, res) {
  const auth = authenticate(req, res);
  if (!auth) return;
  const { siteId, uid, site, cors } = auth;
  let body;
  try { body = await readJson(req, 450_000); } catch { return sendJson(res, 400, { error: 'bad_json' }, cors); }
  const r = normalizeCompose(body);
  if (r.mode === 'new' && !r.brief && !r.keyword) return sendJson(res, 400, { error: 'empty_brief', message: 'Hãy mô tả bài cần viết hoặc nhập từ khoá chính.' }, cors);
  if (r.mode === 'optimize' && !r.cur.noi_dung.replace(/<[^>]*>/g, '').trim()) return sendJson(res, 400, { error: 'empty_content', message: 'Chưa có nội dung để tối ưu.' }, cors);
  const now = Date.now();
  const recent = (composeLog.get(`${siteId}:${uid}`) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= COMPOSE_PER_HOUR) return sendJson(res, 429, { error: 'rate_limited', message: `Đã dùng ${COMPOSE_PER_HOUR} lần trong 1 giờ, vui lòng thử lại sau.` }, cors);
  if (activeCount >= config.maxConcurrent) return sendJson(res, 429, { error: 'server_busy', message: 'Hệ thống đang bận, thử lại sau ít phút.' }, cors);
  recent.push(now); composeLog.set(`${siteId}:${uid}`, recent);

  activeCount++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors });
  const send = (ev) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const workspace = await store.ensureWorkspace(siteId);
    const prompt = await buildComposePrompt(site, workspace, r);
    let chars = 0;
    let agyId;
    const turn = (text, resume) => runTurn({
      prompt: text, cwd: workspace, addDirs: [KNOWLEDGE_DIR], signal: ac.signal, agyConversationId: resume,
      onEvent: (ev) => {
        if (ev.type === 'init') agyId = ev.agyConversationId;
        else if (ev.type === 'delta') { chars += ev.text.length; send({ type: 'progress', chars }); }
        else if (ev.type === 'step') send({ type: 'step', stepType: ev.stepType, state: ev.state });
      },
    });
    let out = await turn(prompt);
    for (let i = 0; i < 2 && !out.response.trim() && out.status !== 'CANCELLED' && agyId && !ac.signal.aborted; i++) {
      // Agent cố chạy lệnh (bị chặn) nên chưa trả kết quả → nhắc dùng công cụ đọc file rồi trả đúng định dạng
      out = await turn('Lệnh shell bị từ chối. Hãy chỉ dùng công cụ đọc file (hoặc không đọc gì nếu đã đủ dữ kiện) rồi trả kết quả ĐÚNG định dạng các mục ===TÊN=== đã nêu.', agyId);
    }
    if (out.status === 'CANCELLED') return;
    const parsed = parseComposeResponse(out.response || '');
    send({ type: 'result', mode: r.mode, scope: r.scope, ...parsed });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    clearInterval(ping);
    activeCount--;
    res.end();
  }
}

async function handleList(req, res) {
  const auth = authenticate(req, res);
  if (!auth) return;
  sendJson(res, 200, { conversations: await store.listConversations(auth.siteId, auth.uid) }, auth.cors);
}

async function handleGetConversation(req, res, id) {
  const auth = authenticate(req, res);
  if (!auth) return;
  const conv = await store.getConversation(auth.siteId, id, auth.uid);
  if (!conv) return sendJson(res, 404, { error: 'conversation_not_found' }, auth.cors);
  sendJson(res, 200, { id: conv.id, title: conv.title, messages: conv.messages }, auth.cors);
}

async function handleDelete(req, res, id) {
  const auth = authenticate(req, res);
  if (!auth) return;
  const ok = await store.deleteConversation(auth.siteId, id, auth.uid);
  sendJson(res, ok ? 200 : 404, { ok }, auth.cors);
}

async function handleSync(req, res) {
  const auth = authenticate(req, res);
  if (!auth) return;
  try {
    sendJson(res, 200, await syncPosts(auth.siteId, auth.site), auth.cors);
  } catch (err) {
    sendJson(res, 502, { error: 'sync_failed', message: err.message }, auth.cors);
  }
}

async function handleStatus(req, res) {
  const auth = authenticate(req, res);
  if (!auth) return;
  const ws = await store.ensureWorkspace(auth.siteId);
  sendJson(res, 200, { site: auth.site.name, posts: await readSyncStatus(ws) }, auth.cors);
}

async function serveFile(res, file, type, extra = {}) {
  try {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
}

// ---------- router ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    const cors = corsFor(req, null);
    res.writeHead(cors ? 204 : 403, cors || {});
    return void res.end();
  }
  const fail = (e) => { if (!res.headersSent) sendJson(res, 500, { error: 'internal', message: e.message }); else res.end(); };
  const wrap = (fn) => fn().catch(fail);

  if (req.method === 'GET' && p === '/api/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' && p === '/widget.js') {
    return void serveFile(res, path.join(WEB, 'widget.js'), 'text/javascript; charset=utf-8');
  }
  if (req.method === 'POST' && p === '/api/compose') return void wrap(() => handleCompose(req, res));
  if (req.method === 'POST' && p === '/api/chat') return void wrap(() => handleChat(req, res));
  if (req.method === 'GET' && p === '/api/conversations') return void wrap(() => handleList(req, res));
  if (req.method === 'POST' && p === '/api/sync') return void wrap(() => handleSync(req, res));
  if (req.method === 'GET' && p === '/api/status') return void wrap(() => handleStatus(req, res));
  const m = /^\/api\/conversations\/([0-9a-f-]{36})$/.exec(p);
  if (m && req.method === 'GET') return void wrap(() => handleGetConversation(req, res, m[1]));
  if (m && req.method === 'DELETE') return void wrap(() => handleDelete(req, res, m[1]));

  if (config.devMode) {
    if (req.method === 'GET' && p === '/') return void serveFile(res, path.join(WEB, 'demo.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/dev/token') {
      const siteId = url.searchParams.get('site') || Object.keys(sites)[0];
      if (!Object.hasOwn(sites, siteId)) return sendJson(res, 404, { error: 'site' });
      const token = signToken(
        { site: siteId, uid: url.searchParams.get('uid') || 'dev', name: 'Dev', exp: Math.floor(Date.now() / 1000) + 3600 },
        sites[siteId].tokenSecret);
      return sendJson(res, 200, { token });
    }
  }
  res.writeHead(404).end('Not found');
});

server.listen(config.port, config.host, () => {
  console.log(`Backend: http://${config.host}:${config.port}  sites=[${Object.keys(sites).join(', ')}]  dev=${config.devMode}`);
});

if (config.syncIntervalMin > 0) {
  const tick = () => {
    for (const [id, s] of Object.entries(sites)) {
      syncPosts(id, s).then((r) => console.log(`[sync] ${id}: ${r.count} bài`)).catch((e) => console.error(`[sync] ${id}: ${e.message}`));
    }
  };
  setInterval(tick, config.syncIntervalMin * 60_000).unref();
}
