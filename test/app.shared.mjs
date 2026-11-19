// End-to-end tests of the HTTP app with a fake agent CLI and a fake website API.
// Imported by app.file.test.mjs and app.sqlite.test.mjs (one process per storage driver).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmp, useFakeAgent, readSse } from './helpers.mjs';

export function runAppTests(driver) {
  const dataDir = tmp();
  const proposals = [];
  let siteApi, app, base, signToken, createRouter, createApp, store;
  const secret = 's'.repeat(32);

  before(async () => {
    // fake website API
    siteApi = http.createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer site-key') { res.writeHead(401).end(); return; }
      const url = new URL(req.url, 'http://x');
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'GET' && url.pathname === '/api/agent/posts') {
        return json(200, { items: [
          { id: 1, title: 'Post one', status: 'published', word_count: 300, meta_title: '', meta_description: 'd', categories: ['A'], updated_at: '2020-01-01T00:00:00Z' },
          { id: 2, title: 'Post two', status: 'draft', word_count: 900, meta_title: 't', meta_description: '', categories: ['B'] },
        ], next_page: null });
      }
      if (req.method === 'GET' && url.pathname === '/api/agent/proposals') return json(200, { items: proposals.map((p, i) => ({ id: i + 1, ...p, status: 'pending' })) });
      if (req.method === 'POST' && url.pathname === '/api/agent/proposals') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const p = JSON.parse(body);
          proposals.push(p);
          json(201, { data: { id: proposals.length, status: 'pending', warnings: [], review_url: `https://admin.test/review/${proposals.length}` } });
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => siteApi.listen(0, '127.0.0.1', r));
    const apiBase = `http://127.0.0.1:${siteApi.address().port}/api/agent`;

    const sitesFile = path.join(dataDir, 'sites.json');
    writeFileSync(sitesFile, JSON.stringify({
      main: { name: 'Test site', tokenSecret: secret, allowedOrigins: ['https://admin.test'], fieldMap: { meta_title: 'seo_title' },
        api: { base: apiBase, key: 'site-key', features: ['proposals'] } },
    }));
    Object.assign(process.env, { DATA_DIR: dataDir, SITES_FILE: sitesFile, STORE_DRIVER: driver, CHAT_PER_HOUR: '8', COMPOSE_PER_HOUR: '5', MAX_CONCURRENT: '4' });
    useFakeAgent({ FAKE_FORMAT: 'claude', FAKE_MODE: 'ok' });

    ({ signToken } = await import('../server/auth.mjs'));
    ({ createRouter } = await import('../bridge/index.mjs'));
    ({ createApp } = await import('../server/app.mjs'));
    store = await import('../server/store.mjs');
    const { loadSites } = await import('../server/config.mjs');
    app = createApp({ sites: loadSites(), runTurn: createRouter({ primary: 'claude', fallback: '' }).runTurn });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.address().port}`;
  });

  after(async () => {
    app?.closeAllConnections?.();
    await new Promise((r) => app.close(r));
    await new Promise((r) => siteApi.close(r));
    store.close();
  });

  const token = (uid = 'admin-1', site = 'main', exp = Math.floor(Date.now() / 1000) + 600) => signToken({ site, uid, name: 'Admin', exp }, secret);
  const api = (p, { method = 'GET', body, uid, headers = {} } = {}) => fetch(base + p, {
    method,
    headers: { Authorization: `Bearer ${token(uid)}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const chat = async (body, uid) => {
    const res = await api('/api/chat', { method: 'POST', body, uid });
    return { res, events: res.status === 200 ? await readSse(res) : [], json: res.status !== 200 ? await res.json() : null };
  };

  test('health is public, API needs a valid token', async () => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const r = await fetch(base + '/api/conversations');
    assert.equal(r.status, 401);
    assert.equal((await r.json()).reason, 'missing');
    const bad = await fetch(base + '/api/conversations', { headers: { Authorization: 'Bearer nope' } });
    assert.equal(bad.status, 401);
  });

  test('CORS: allowed origin echoed, others rejected', async () => {
    const ok = await api('/api/conversations', { headers: { Origin: 'https://admin.test' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://admin.test');
    const blocked = await api('/api/conversations', { headers: { Origin: 'https://evil.test' } });
    assert.equal(blocked.status, 403);
    const pre = await fetch(base + '/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } });
    assert.equal(pre.status, 403);
  });

  test('widget.js is served', async () => {
    const r = await fetch(base + '/widget.js');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
  });

  test('sync pulls posts into the workspace and locks them', async () => {
    const r = await api('/api/sync', { method: 'POST' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.count, 2);
    const ws = path.join(dataDir, 'sites', 'main');
    assert.match(readFileSync(path.join(ws, 'posts', 'stats.md'), 'utf8'), /Tổng số bài: \*\*2\*\*/);
    assert.ok(existsSync(path.join(ws, 'site', 'inventory.md')));
    const st = await (await api('/api/status')).json();
    assert.equal(st.posts.count, 2);
    assert.ok(st.sync.lastOkAt);
    assert.equal(st.sync.consecutiveFailures, 0);
  });

  let convId;
  test('chat: streams events, stores the conversation, resumes the CLI session', async () => {
    const { res, events } = await chat({ message: 'Xin chào' });
    assert.equal(res.status, 200);
    assert.equal(events[0].type, 'init');
    convId = events[0].conversationId;
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join('').trim(), 'echo: Xin chào');
    assert.equal(events.at(-1).type, 'result');
    assert.equal(events.at(-1).status, 'SUCCESS');

    const conv = await (await api(`/api/conversations/${convId}`)).json();
    assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant']);

    const second = await chat({ message: 'Lần hai', conversationId: convId });
    assert.equal(second.events.filter((e) => e.type === 'delta').map((e) => e.text).join('').trim(), 'echo: Lần hai');
    const stored = await store.getConversation('main', convId, 'admin-1');
    assert.equal(stored.agentSessionId, 'claude:claude-session-1');
    assert.equal(stored.messages.length, 4);
  });

  test('conversations are private to their uid', async () => {
    assert.equal((await api(`/api/conversations/${convId}`, { uid: 'someone-else' })).status, 404);
    const mine = await (await api('/api/conversations')).json();
    assert.ok(mine.conversations.some((c) => c.id === convId));
    const theirs = await (await api('/api/conversations', { uid: 'someone-else' })).json();
    assert.deepEqual(theirs.conversations, []);
    assert.equal((await api(`/api/conversations/${convId}`, { method: 'DELETE', uid: 'someone-else' })).status, 404);
  });

  test('chat: validation errors', async () => {
    assert.equal((await chat({ message: '   ' })).res.status, 400);
    assert.equal((await chat({ message: 'x'.repeat(9000) })).res.status, 413);
    assert.equal((await chat({ message: 'hi', conversationId: '00000000-0000-4000-8000-000000000000' })).res.status, 404);
  });

  test('outbox: a proposal written by the agent is sent to the website review queue', async () => {
    process.env.FAKE_MODE = 'write:outbox/fix-1.md';
    process.env.FAKE_WRITE_CONTENT = '---\naction: update\ntype: post\nid: 1\nsummary: Add meta title\nmeta_title: "Post one — guide"\n---\n';
    try {
      const { events } = await chat({ message: 'Tối ưu bài 1' });
      const p = events.find((e) => e.type === 'proposals');
      assert.ok(p, 'proposals event');
      assert.equal(p.items[0].ok, true);
      assert.equal(proposals.at(-1).id, 1);
      assert.equal(proposals.at(-1).fields.seo_title, 'Post one — guide', 'renamed with site.fieldMap');
      assert.match(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), /review\/\d/);
      const sent = readdirSync(path.join(dataDir, 'sites', 'main', 'outbox', 'sent'));
      assert.ok(sent.some((f) => f.endsWith('fix-1.md')) && sent.some((f) => f.endsWith('fix-1.md.result.json')));
    } finally {
      process.env.FAKE_MODE = 'ok';
      delete process.env.FAKE_WRITE_CONTENT;
    }
  });

  test('workspace guard: the agent cannot overwrite synced data', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    process.env.FAKE_MODE = 'write:posts/stats.md';
    try {
      const { events } = await chat({ message: 'ghi đè' });
      assert.match(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), /write failed: EACCES/);
      assert.match(readFileSync(path.join(dataDir, 'sites', 'main', 'posts', 'stats.md'), 'utf8'), /Tổng số bài/);
    } finally {
      process.env.FAKE_MODE = 'ok';
    }
  });

  test('agent failure is reported as an SSE error event', async () => {
    process.env.FAKE_MODE = 'fail';
    try {
      const { events } = await chat({ message: 'lỗi' });
      assert.equal(events.at(-1).type, 'error');
      assert.match(events.at(-1).message, /API overloaded/);
    } finally {
      process.env.FAKE_MODE = 'ok';
    }
  });

  test('usage: tokens and cost are recorded per request', async () => {
    const u = await (await api('/api/usage?days=7')).json();
    assert.ok(u.mine.requests >= 4, `requests=${u.mine.requests}`);
    assert.ok(u.mine.inputTokens >= 4 * 300);
    assert.ok(u.mine.costUsd > 0);
    assert.ok(u.site.byBackend.claude);
    const other = await (await api('/api/usage', { uid: 'nobody' })).json();
    assert.equal(other.mine.requests, 0);
    assert.equal(other.site.requests, u.site.requests);
  });

  test('compose: returns parsed sections', async () => {
    process.env.FAKE_MODE = 'write:drafts/ignored.md';
    // the fake replies "wrote …" which is not in ===SECTION=== format -> error event
    try {
      const res = await api('/api/compose', { method: 'POST', body: { mode: 'new', brief: 'Bài về SEO' } });
      const events = await readSse(res);
      assert.equal(events.at(-1).type, 'error');
      assert.match(events.at(-1).message, /===/);
    } finally {
      process.env.FAKE_MODE = 'ok';
    }
    const empty = await api('/api/compose', { method: 'POST', body: { mode: 'new' } });
    assert.equal(empty.status, 400);
  });

  test('compose: success returns fields under the site\'s own names', async () => {
    process.env.FAKE_REPLY = '===META_TITLE===\nSEO title\n===NOTES===\n- ok\n===BODY===\n<h2>Mở bài</h2><p>…</p>';
    try {
      const res = await api('/api/compose', { method: 'POST', body: { mode: 'new', brief: 'Bài về SEO', keyword: 'seo' } });
      const r = (await readSse(res)).at(-1);
      assert.equal(r.type, 'result');
      assert.equal(r.fields.seo_title, 'SEO title', 'meta_title mapped via fieldMap');
      assert.equal(r.fields.body, '<h2>Mở bài</h2><p>…</p>');
      assert.equal(r.notes, '- ok');
    } finally {
      delete process.env.FAKE_REPLY;
    }
  });

  test('rate limit: chat per user per hour', async () => {
    let last;
    for (let i = 0; i < 10; i++) {
      last = await chat({ message: `spam ${i}` }, 'spammer');
      if (last.res.status === 429) break;
    }
    assert.equal(last.res.status, 429);
    assert.equal(last.json.error, 'rate_limited');
    assert.ok(Number(last.res.headers.get('retry-after')) > 0);
    assert.equal((await chat({ message: 'still fine' }, 'polite-user')).res.status, 200, 'other users unaffected');
  });
}
