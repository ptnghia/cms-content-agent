// Contract every storage driver must satisfy (the interface is documented in server/store.mjs).
// Runner-agnostic: each case throws on failure. Use it for a driver that lives outside this repo:
//
//   import { storeContract } from 'cms-content-agent/testing/store-contract';
//   for (const c of storeContract) test(c.name, () => c.run((dataDir) => createMyStore({ dataDir })));
//
// `make(dataDir)` must return a fresh store whose agent workspaces live under <dataDir>/sites/<id>.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'cca-store-'));

/** @type {{name: string, run: (make: (dataDir: string) => any) => Promise<void>}[]} */
export const storeContract = [
  {
    name: 'conversation lifecycle is scoped to site + uid',
    async run(make) {
    const dataDir = tempDir();
    const s = await make(dataDir);
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
    await s.close?.();
    },
  },
  {
    name: 'usage records and summary',
    async run(make) {
    const s = await make(tempDir());
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
    await s.close?.();
    },
  },
];
