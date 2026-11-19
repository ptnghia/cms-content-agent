// Contract tests run against every storage driver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmp } from './helpers.mjs';
import { createFileStore } from '../server/store/file-store.mjs';
import { createSqliteStore } from '../server/store/sqlite-store.mjs';
import { storeContract } from '../server/testing/store-contract.mjs';

const drivers = {
  file: (dataDir) => createFileStore({ dataDir }),
  sqlite: (dataDir) => createSqliteStore({ dataDir }),
};

for (const [name, make] of Object.entries(drivers)) {
  for (const c of storeContract) test(`${name} store: ${c.name}`, () => c.run(make));
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
