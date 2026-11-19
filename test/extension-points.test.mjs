// Extension points for hosting the core inside another service: siteProvider, injected store,
// beforeTurn / afterTurn hooks and the /internal/* router. Uses a fake runTurn (no CLI, no API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmp, readSse } from './helpers.mjs';

const defaultDataDir = tmp();
process.env.DATA_DIR = defaultDataDir;
process.env.STORE_DRIVER = 'file';

const { createApp, signToken, createFileStore, extractJson } = await import('../server/index.mjs');

const SECRET = 'x'.repeat(32);
const INTERNAL = 'i'.repeat(40);
const USAGE = { inputTokens: 10, outputTokens: 5, cachedTokens: 0, costUsd: 0.002, model: 'claude-test' };

function fakeRunTurn(behaviour = {}) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    if (behaviour.throws) throw new Error('adapter down');
    if (behaviour.waitForAbort) {
      if (!opts.signal?.aborted) await new Promise((resolve) => opts.signal?.addEventListener('abort', resolve));
      return { response: '', denied: [], status: 'CANCELLED', usage: USAGE, backend: 'api' };
    }
    const response = behaviour.response ?? 'Xin chào';
    opts.onEvent?.({ type: 'delta', text: response });
    return { response, denied: [], status: 'SUCCESS', usage: USAGE, backend: 'api', sessionId: 's1' };
  };
  fn.calls = calls;
  return fn;
}

/** A site API that answers the /posts sync with one post. */
let siteApi;
let apiBase;
before(async () => {
  siteApi = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer site-key') return void res.writeHead(401).end();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [{ id: 7, title: 'Bài một', status: 'published', word_count: 10 }], next_page: null }));
  });
  await new Promise((r) => siteApi.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${siteApi.address().port}/api/agent`;
});
after(() => siteApi.close());

const site = () => ({ name: 'Site A', language: 'vi', tokenSecret: SECRET, allowedOrigins: ['https://a.test'], api: { base: apiBase, key: 'site-key', features: [] } });

async function start(options) {
  const app = createApp(options);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  return { app, base: `http://127.0.0.1:${app.address().port}`, close: () => new Promise((r) => app.close(r)) };
}

/** afterTurn runs after the response is sent: wait for it. */
const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

const token = (siteId = 'a', secret = SECRET, uid = 'u1') =>
  signToken({ site: siteId, uid, name: 'Tester', exp: Math.floor(Date.now() / 1000) + 300 }, secret);

const chat = (base, t = token(), message = 'Chào') =>
  fetch(`${base}/api/chat`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });

test('siteProvider: sites are looked up asynchronously per request', async () => {
  const lookups = [];
  const siteProvider = {
    get: async (id) => { lookups.push(id); await new Promise((r) => setTimeout(r, 2)); return id === 'a' ? site() : null; },
    allowsOrigin: async (origin) => origin === 'https://a.test',
  };
  const { base, close } = await start({ siteProvider, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn() });
  try {
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token()}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token('zz')}` } })).status, 401, 'unknown site');
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token('a', 'y'.repeat(32))}` } })).status, 401, 'wrong secret');
    assert.deepEqual(lookups, ['a', 'zz', 'a']);

    const pre = (origin) => fetch(`${base}/api/chat`, { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal((await pre('https://a.test')).status, 204);
    assert.equal((await pre('https://evil.test')).status, 403);
  } finally { await close(); }
});

test('siteProvider: a failing lookup answers 503 without details', async () => {
  const siteProvider = { get: async () => { throw new Error('db down: secret details'); } };
  const { base, close } = await start({ siteProvider, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn() });
  try {
    const res = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token()}` } });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'site_unavailable' });
  } finally { await close(); }
});

test('sites option still works and keeps the old behaviour', async () => {
  const { base, close } = await start({ sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn() });
  try {
    assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token()}` } })).status, 200);
  } finally { await close(); }
});

test('store: an injected store receives conversations and usage; the default store is never created', async () => {
  const dataDir = tmp();
  const inner = createFileStore({ dataDir });
  const usage = [];
  const store = { ...inner, recordUsage: async (e) => { usage.push(e); return inner.recordUsage(e); } };
  const { base, close } = await start({ sites: { a: site() }, store, runTurn: fakeRunTurn() });
  try {
    const events = await readSse(await chat(base));
    assert.equal(events.at(-1).type, 'result');
    assert.equal(usage.length, 1);
    assert.equal(usage[0].siteId, 'a');
    assert.equal(usage[0].costUsd, 0.002);
    assert.ok(existsSync(path.join(dataDir, 'conversations', 'a')), 'conversation stored by the injected store');
    assert.equal(existsSync(path.join(defaultDataDir, 'conversations')), false, 'default store untouched');
  } finally { await close(); }
});

test('beforeTurn: a refusal is answered without calling the agent or afterTurn', async () => {
  const runTurn = fakeRunTurn();
  const after = [];
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn,
    beforeTurn: async (ctx) => (ctx.kind === 'chat'
      ? { ok: false, code: 'insufficient_credits', message: 'Hết credit' }
      : { ok: false, code: 'site_locked' }),
    afterTurn: async (ctx) => { after.push(ctx); },
  });
  try {
    const res = await chat(base);
    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), { error: 'insufficient_credits', message: 'Hết credit' });
    const comp = await fetch(`${base}/api/compose`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'new', brief: 'Viết bài' }),
    });
    assert.equal(comp.status, 423);
    assert.equal(runTurn.calls.length, 0);
    assert.equal(after.length, 0);
  } finally { await close(); }
});

test('beforeTurn: a hook error answers 503', async () => {
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn(),
    beforeTurn: async () => { throw new Error('redis down'); },
  });
  try {
    const res = await chat(base);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'turn_check_failed' });
  } finally { await close(); }
});

test('afterTurn: called exactly once per turn with usage, status and the same requestId', async () => {
  const seen = [];
  const hooks = {
    beforeTurn: async (ctx) => { seen.push(['before', ctx.kind, ctx.requestId, ctx.uid]); return { ok: true }; },
    afterTurn: async (ctx) => { seen.push(['after', ctx.kind, ctx.requestId, ctx.status, ctx.usage.costUsd]); },
  };
  const ok = await start({ sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn(), ...hooks });
  try {
    await readSse(await chat(ok.base));
    const comp = await fetch(`${ok.base}/api/compose`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'new', brief: 'Viết bài' }),
    });
    await readSse(comp);
  } finally { await ok.close(); }
  assert.equal(seen.length, 4);
  const [b1, a1, b2, a2] = seen;
  assert.deepEqual([b1[0], b1[1], b1[3]], ['before', 'chat', 'u1']);
  assert.deepEqual([a1[0], a1[1], a1[2], a1[3], a1[4]], ['after', 'chat', b1[2], 'SUCCESS', 0.002]);
  assert.equal(b2[1], 'compose');
  assert.equal(a2[2], b2[2]);
  assert.notEqual(b1[2], b2[2], 'one requestId per turn');
});

test('afterTurn: still called when the adapter fails or the client goes away', async () => {
  const after = [];
  const failing = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn({ throws: true }),
    afterTurn: async (ctx) => { after.push(ctx.status); },
  });
  try {
    const events = await readSse(await chat(failing.base));
    assert.equal(events.at(-1).type, 'error');
  } finally { await failing.close(); }

  const slow = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn({ waitForAbort: true }),
    afterTurn: async (ctx) => { after.push(ctx.status); },
  });
  try {
    // Open the SSE stream, wait for the first event, then drop the connection like a closed tab.
    await new Promise((resolve, reject) => {
      const req = http.request(`${slow.base}/api/chat`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      }, (res) => { res.once('data', () => { req.destroy(); resolve(); }); });
      req.on('error', (e) => (e.code === 'ECONNRESET' ? resolve() : reject(e)));
      req.end(JSON.stringify({ message: 'Chào' }));
    });
    for (let i = 0; i < 50 && after.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  } finally { await slow.close(); }
  assert.deepEqual(after, ['ERROR', 'CANCELLED']);
});

test('internal router: off by default, token required', async () => {
  const off = await start({ sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn() });
  try {
    assert.equal((await fetch(`${off.base}/internal/sites/a/sync`, { method: 'POST', headers: { Authorization: `Bearer ${INTERNAL}` } })).status, 404);
  } finally { await off.close(); }
  assert.throws(() => createApp({ sites: {}, internal: { token: 'short' } }), /at least 32/);

  const on = await start({ sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn(), internal: { token: INTERNAL } });
  try {
    assert.equal((await fetch(`${on.base}/internal/sites/a/sync`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${on.base}/internal/sites/a/sync`, { method: 'POST', headers: { Authorization: `Bearer ${'j'.repeat(40)}` } })).status, 401);
    // A widget token is not an internal token.
    assert.equal((await fetch(`${on.base}/internal/sites/a/sync`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })).status, 401);
  } finally { await on.close(); }
});

test('internal router: sync one site and write a knowledge file', async () => {
  const dataDir = tmp();
  const { base, close } = await start({ sites: { a: site() }, store: createFileStore({ dataDir }), runTurn: fakeRunTurn(), internal: { token: INTERNAL } });
  const auth = { Authorization: `Bearer ${INTERNAL}`, 'Content-Type': 'application/json' };
  try {
    const sync = await fetch(`${base}/internal/sites/a/sync`, { method: 'POST', headers: auth });
    assert.equal(sync.status, 200);
    assert.equal((await sync.json()).count, 1);
    assert.equal((await fetch(`${base}/internal/sites/nope/sync`, { method: 'POST', headers: auth })).status, 404);

    const put = (name, content) => fetch(`${base}/internal/sites/a/knowledge/${name}`, { method: 'PUT', headers: auth, body: JSON.stringify({ content }) });
    assert.equal((await put('site-profile', '# Hồ sơ\nGiọng văn thân thiện.')).status, 200);
    assert.equal(readFileSync(path.join(dataDir, 'sites', 'a', 'knowledge', 'site-profile.md'), 'utf8'), '# Hồ sơ\nGiọng văn thân thiện.');
    assert.equal((await put('..', 'x')).status, 404, 'path traversal never reaches a handler');
    assert.equal((await put('Bad_Name', 'x')).status, 404, 'not a valid route segment');
    assert.equal((await put('-lead', 'x')).status, 400);
    assert.equal((await put('big', 'x'.repeat(70 * 1024))).status, 400);
    assert.equal((await fetch(`${base}/internal/sites/a/knowledge/site-profile`, { method: 'POST', headers: auth, body: '{}' })).status, 405);
  } finally { await close(); }
});

test('internal router: JSON tasks run through the hooks and return parsed JSON', async () => {
  const runTurn = fakeRunTurn({ response: 'Đây là kết quả:\n```json\n{"groups":[{"name":"giày","keywords":["giày chạy"]}]}\n```' });
  const after = [];
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn, internal: { token: INTERNAL },
    beforeTurn: async (ctx) => (ctx.uid === 'broke' ? { ok: false, code: 'insufficient_credits' } : { ok: true }),
    afterTurn: async (ctx) => { after.push([ctx.kind, ctx.status, ctx.usage.costUsd]); },
  });
  const call = (task, body) => fetch(`${base}/internal/sites/a/tasks/${task}`, {
    method: 'POST', headers: { Authorization: `Bearer ${INTERNAL}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const res = await call('keyword-clusters', { input: { keywords: [{ keyword: 'giày chạy' }] }, uid: 'u9' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.result, { groups: [{ name: 'giày', keywords: ['giày chạy'] }] });
    assert.equal(body.usage.costUsd, 0.002);
    assert.match(runTurn.calls[0].prompt, /keyword-clustering/);
    assert.match(runTurn.calls[0].prompt, /giày chạy/);
    await until(() => after.length);
    assert.deepEqual(after, [['task:keyword-clusters', 'SUCCESS', 0.002]]);

    assert.equal((await call('keyword-clusters', { input: {}, uid: 'broke' })).status, 402);
    assert.equal((await call('nope', { input: {} })).status, 404);
  } finally { await close(); }
});

test('internal router: unparseable task output is a 502 and still reaches afterTurn', async () => {
  const after = [];
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn({ response: 'Không có JSON ở đây' }),
    internal: { token: INTERNAL }, afterTurn: async (ctx) => { after.push(ctx.status); },
  });
  try {
    const res = await fetch(`${base}/internal/sites/a/tasks/seo-plan`, {
      method: 'POST', headers: { Authorization: `Bearer ${INTERNAL}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { keywords: [] } }),
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'bad_task_output');
    await until(() => after.length);
    assert.deepEqual(after, ['BAD_OUTPUT'], 'tokens were spent, so the host can still charge');
  } finally { await close(); }
});

test('extractJson handles bare JSON, fenced JSON and surrounding prose', () => {
  assert.equal(extractJson('null').ok, false, 'objects and arrays only');
  assert.equal(extractJson('42').ok, false);
  assert.deepEqual(extractJson('{"a":1}').value, { a: 1 });
  assert.deepEqual(extractJson('```json\n[1,2]\n```').value, [1, 2]);
  assert.deepEqual(extractJson('Kết quả: {"a":{"b":2}} xong.').value, { a: { b: 2 } });
  assert.equal(extractJson('không có').ok, false);
});

test('hooks: a hanging beforeTurn times out with 503 and frees the slot', async () => {
  let calls = 0;
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn(), hookTimeoutMs: 50,
    beforeTurn: async () => { calls++; if (calls <= 3) await new Promise(() => {}); return { ok: true }; },
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await chat(base)).status, 503); // more than MAX_CONCURRENT (2)
    const events = await readSse(await chat(base));
    assert.equal(events.at(-1).type, 'result', 'slots were released');
  } finally { await close(); }
});

test('hooks: a slow afterTurn does not hold the response or the slot', async () => {
  const releases = [];
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: fakeRunTurn(),
    afterTurn: () => new Promise((r) => { releases.push(r); }),
  });
  try {
    const t0 = Date.now();
    const events = await readSse(await chat(base));
    assert.equal(events.at(-1).type, 'result');
    assert.ok(Date.now() - t0 < 1000, 'stream ended before afterTurn finished');
    assert.equal((await readSse(await chat(base))).at(-1).type, 'result', 'slot free');
  } finally { releases.forEach((r) => r()); await close(); }
});

test('hooks: a client that leaves during beforeTurn is not charged for a turn', async () => {
  const runTurn = fakeRunTurn();
  const after = [];
  let unblock;
  const { base, close } = await start({
    sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn,
    beforeTurn: () => new Promise((r) => { unblock = () => r({ ok: true }); }),
    afterTurn: async (ctx) => { after.push([ctx.status, ctx.usage.turns]); },
  });
  try {
    const req = http.request(`${base}/api/chat`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ message: 'Chào' }));
    for (let i = 0; i < 50 && !unblock; i++) await new Promise((r) => setTimeout(r, 10));
    req.destroy();
    await new Promise((r) => setTimeout(r, 50));
    unblock();
    for (let i = 0; i < 50 && !after.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(after, [['CANCELLED', 0]]);
    assert.equal(runTurn.calls.length, 0, 'the agent never ran');
  } finally { await close(); }
});

test('internal tasks share the concurrency limit, drop outbox files and reject non-object bodies', async () => {
  const dataDir = tmp();
  const releases = [];
  const blocking = async (opts) => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.join(opts.cwd, 'outbox'), { recursive: true });
    writeFileSync(path.join(opts.cwd, 'outbox', 'injected.json'), '{}');
    if (!opts.prompt.includes('fast')) await new Promise((r) => { releases.push(r); });
    return { response: '{"ok":true}', denied: [], status: 'SUCCESS', usage: USAGE, backend: 'api' };
  };
  const store = createFileStore({ dataDir });
  const { base, close } = await start({
    sites: { a: site() }, store, runTurn: blocking, internal: { token: INTERNAL, tasks: { probe: { prompt: (input) => String(input) } } },
  });
  const call = (body) => fetch(`${base}/internal/sites/a/tasks/probe`, {
    method: 'POST', headers: { Authorization: `Bearer ${INTERNAL}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await call(null)).status, 400);
    assert.equal((await call('x')).status, 400);
    const a = call({ input: 'slow-1' });
    const b = call({ input: 'slow-2' });
    await until(() => releases.length === 2);
    assert.equal((await call({ input: 'fast' })).status, 429, 'MAX_CONCURRENT (2) reached');
    releases.forEach((rel) => rel());
    assert.equal((await a).status, 200);
    assert.equal((await b).status, 200);
    assert.equal(existsSync(path.join(dataDir, 'sites', 'a', 'outbox', 'injected.json')), false, 'proposal from a task removed');
    let usage;
    for (let i = 0; i < 50; i++) {
      usage = await store.usageSummary('a', { since: '2000-01-01T00:00:00.000Z' });
      if (usage.requests >= 2) break;
      await new Promise((r) => setTimeout(r, 10)); // recorded after the response is sent
    }
    assert.ok(usage.requests >= 2, 'task usage is recorded');
  } finally { await close(); }
});

test('turn context reaches runTurn and usage records, and limits answer 429', async () => {
  const runTurn = fakeRunTurn();
  const usage = [];
  const after = [];
  const inner = createFileStore({ dataDir: tmp() });
  const store = { ...inner, recordUsage: async (e) => { usage.push(e); return inner.recordUsage(e); } };
  let refuse = false;
  const { base, close } = await start({
    sites: { a: site() }, store, runTurn,
    beforeTurn: async () => (refuse ? { ok: false, code: 'rate_limited', message: 'Chậm lại' } : { ok: true }),
    afterTurn: async (ctx) => { after.push(ctx); },
  });
  try {
    await readSse(await chat(base));
    await until(() => after.length);
    const [call] = runTurn.calls;
    assert.equal(call.siteId, 'a');
    assert.equal(call.kind, 'chat');
    assert.equal(call.site.name, 'Site A');
    assert.equal(call.requestId, after[0].requestId);
    assert.equal(usage[0].requestId, after[0].requestId, 'usage row and charge share the request id');
    assert.ok(after[0].conversationId, 'chat afterTurn knows the conversation');

    refuse = true;
    const res = await chat(base);
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'rate_limited', message: 'Chậm lại' });
  } finally { await close(); }
});

test('internal tasks pass onEvent and the turn context to runTurn', async () => {
  const strict = async (opts) => {
    opts.onEvent({ type: 'init', sessionId: 'x' }); // the api adapter calls it unconditionally
    return { response: `{"kind":"${opts.kind}","site":"${opts.siteId}"}`, denied: [], status: 'SUCCESS', usage: USAGE, backend: 'api' };
  };
  const { base, close } = await start({ sites: { a: site() }, store: createFileStore({ dataDir: tmp() }), runTurn: strict, internal: { token: INTERNAL } });
  try {
    const res = await fetch(`${base}/internal/sites/a/tasks/seo-plan`, {
      method: 'POST', headers: { Authorization: `Bearer ${INTERNAL}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: {} }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).result, { kind: 'task:seo-plan', site: 'a' });
  } finally { await close(); }
});
