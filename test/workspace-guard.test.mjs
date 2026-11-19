import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmp } from './helpers.mjs';
import { lockWorkspace, withUnlocked } from '../server/workspace-guard.mjs';

const skip = process.platform === 'win32' || process.getuid?.() === 0 ? 'file modes not enforced (Windows or root)' : false;

function seed() {
  const ws = tmp();
  mkdirSync(path.join(ws, 'posts'), { recursive: true });
  mkdirSync(path.join(ws, 'content', 'posts'), { recursive: true });
  mkdirSync(path.join(ws, 'outbox', 'sent'), { recursive: true });
  mkdirSync(path.join(ws, 'drafts'), { recursive: true });
  writeFileSync(path.join(ws, 'posts', 'index.md'), 'synced');
  writeFileSync(path.join(ws, 'content', 'posts', '1.md'), 'synced');
  writeFileSync(path.join(ws, 'outbox', 'STATUS.md'), 'status');
  return ws;
}

test('locked workspace: synced data read-only, agent folders writable', { skip }, async () => {
  const ws = seed();
  await lockWorkspace(ws);
  assert.throws(() => writeFileSync(path.join(ws, 'posts', 'index.md'), 'tampered'), { code: 'EACCES' });
  assert.throws(() => writeFileSync(path.join(ws, 'posts', 'new.md'), 'x'), { code: 'EACCES' });
  assert.throws(() => writeFileSync(path.join(ws, 'content', 'posts', '1.md'), 'x'), { code: 'EACCES' });
  assert.throws(() => writeFileSync(path.join(ws, 'outbox', 'STATUS.md'), 'x'), { code: 'EACCES' });
  writeFileSync(path.join(ws, 'drafts', 'a.md'), 'ok');
  writeFileSync(path.join(ws, 'outbox', 'proposal.md'), 'ok');
  writeFileSync(path.join(ws, 'notes.md'), 'ok');
  assert.equal(readFileSync(path.join(ws, 'posts', 'index.md'), 'utf8'), 'synced', 'still readable');
  await withUnlocked(ws, async () => {});   // leave it cleanable
});

test('withUnlocked: backend can write, nested calls relock once at the end', { skip }, async () => {
  const ws = seed();
  await lockWorkspace(ws);
  await withUnlocked(ws, async () => {
    writeFileSync(path.join(ws, 'posts', 'index.md'), 'fresh');
    await withUnlocked(ws, async () => writeFileSync(path.join(ws, 'posts', 'stats.md'), 'nested'));
    writeFileSync(path.join(ws, 'content', 'posts', '2.md'), 'still unlocked after nested exit');
  });
  assert.throws(() => writeFileSync(path.join(ws, 'posts', 'stats.md'), 'x'), { code: 'EACCES' });
  await withUnlocked(ws, async () => {});
});

test('WORKSPACE_LOCK=0 disables locking', async () => {
  const ws = seed();
  process.env.WORKSPACE_LOCK = '0';
  try {
    await lockWorkspace(ws);
    writeFileSync(path.join(ws, 'posts', 'index.md'), 'allowed');
  } finally {
    delete process.env.WORKSPACE_LOCK;
  }
});
