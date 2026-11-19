// Contract tests run against every storage driver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmp } from './helpers.mjs';
import { createFileStore } from '../server/store/file-store.mjs';
import { createSqliteStore } from '../server/store/sqlite-store.mjs';

const drivers = {
  file: (dataDir) => createFileStore({ dataDir }),
  sqlite: (dataDir) => createSqliteStore({ dataDir }),
};

for (const [name, make] of Object.entries(drivers)) {
  test(`${name} store: conversation lifecycle is scoped to site + uid`, async () => {
    const dataDir = tmp();
    const s = make(dataDir);
    const c = await s.createConversation('main', 'u1');
    assert.match(c.id, /^[0-9a-f-]{36}$/);
    assert.ok(existsSync(path.join(dataDir, 'sites', 'main', 'outbox')), 'workspace created');

    c.title = 'Hello';
    c.messages.push({ role: 'user', content: 'hi' });
    c.agentSessionId = 'claude:abc';
    await s.saveConversation(c);

    const got = await s.getConversation('main', c.id, 'u1');
    assert.equal(got.title, 'Hello');
    assert.equal(got.agentSessionId, 'claude:abc');
    assert.equal(got.messages.length, 1);
    assert.equal(await s.getConversation('main', c.id, 'u2'), null, 'other user');
    assert.equal(await s.getConversation('other', c.id, 'u1'), null, 'other site');
    assert.equal(await s.getConversation('main', '../../etc/passwd', 'u1'), null, 'bad id');

    await new Promise((r) => setTimeout(r, 5));
    const c2 = await s.createConversation('main', 'u1');
    await s.saveConversation(c2);
    const list = await s.listConversations('main', 'u1');
    assert.deepEqual(list.map((x) => x.id), [c2.id, c.id], 'newest first');
    assert.equal(list[1].messageCount, 1);
    assert.deepEqual(await s.listConversations('main', 'u2'), []);

    assert.equal(await s.deleteConversation('main', c.id, 'u2'), false);
    assert.equal(await s.deleteConversation('main', c.id, 'u1'), true);
    assert.equal(await s.getConversation('main', c.id, 'u1'), null);
    s.close?.();
  });

  test(`${name} store: usage records and summary`, async () => {
    const s = make(tmp());
    const base = { siteId: 'main', kind: 'chat', backend: 'claude', status: 'SUCCESS', turns: 1, inputTokens: 100, outputTokens: 10, cachedTokens: 0, durationMs: 5 };
    await s.recordUsage({ ...base, uid: 'u1', costUsd: 0.01 });
    await s.recordUsage({ ...base, uid: 'u1', backend: 'codex', costUsd: 0 });
    await s.recordUsage({ ...base, uid: 'u2', costUsd: 0.02, model: 'sonnet' });
    await s.recordUsage({ ...base, uid: 'u1', costUsd: 5, at: '2020-01-01T00:00:00.000Z' });
    await s.recordUsage({ ...base, siteId: 'other', uid: 'u1', costUsd: 9 });

    const since = new Date(Date.now() - 86400_000).toISOString();
    const siteSum = await s.usageSummary('main', { since });
    assert.equal(siteSum.requests, 3);
    assert.equal(siteSum.costUsd, 0.03);
    assert.equal(siteSum.byBackend.codex.requests, 1);
    assert.equal(siteSum.byModel.sonnet.costUsd, 0.02);
    assert.equal(siteSum.byModel.default.requests, 2);
    const mine = await s.usageSummary('main', { uid: 'u1', since });
    assert.equal(mine.requests, 2);
    assert.equal(mine.inputTokens, 200);
    const all = await s.usageSummary('main', { uid: 'u1', since: '2019-01-01T00:00:00.000Z' });
    assert.equal(all.requests, 3);
    s.close?.();
  });
}

test('sqlite store: reads legacy conversations imported from files', async () => {
  const s = createSqliteStore({ dataDir: tmp() });
  const legacy = { id: '11111111-2222-4333-8444-555555555555', siteId: 'main', uid: 'u', title: 't', agyConversationId: 'old',
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', messages: [] };
  s.importConversation(legacy);
  const got = await s.getConversation('main', legacy.id, 'u');
  assert.equal(got.agentSessionId, 'old');
  s.close();
});

test('sqlite store: adds the usage.model column to an older database', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = tmp();
  const old = new DatabaseSync(path.join(dir, 'store.db'));
  old.exec(`CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, site_id TEXT NOT NULL, uid TEXT NOT NULL,
    kind TEXT NOT NULL, conversation_id TEXT, backend TEXT NOT NULL, status TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0)`);
  old.close();
  const s = createSqliteStore({ dataDir: dir });
  await s.recordUsage({ siteId: 'main', uid: 'u1', kind: 'chat', backend: 'claude', status: 'SUCCESS', model: 'opus', costUsd: 1 });
  const sum = await s.usageSummary('main', { since: '2000-01-01T00:00:00.000Z' });
  assert.equal(sum.byModel.opus.requests, 1);
  s.close();
});
