import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { tmp } from './helpers.mjs';
import { startFakeMessagesApi } from './fixtures/fake-messages-api.mjs';
import { createWorkspaceTools, validateInput } from '../bridge/workspace-tools.mjs';
import { runTurn, _setClient, costOf } from '../bridge/adapters/api.mjs';

function workspace() {
  const ws = tmp();
  for (const d of ['posts', 'outbox', 'drafts']) mkdirSync(path.join(ws, d), { recursive: true });
  writeFileSync(path.join(ws, 'posts', 'stats.md'), '# Stats\n- Total posts and pages: **2**\n');
  return ws;
}

test('workspace tools: read anywhere allowed, write only to agent folders', async () => {
  const ws = workspace(), extra = tmp();
  writeFileSync(path.join(extra, 'guide.md'), 'style guide');
  const outside = tmp();
  writeFileSync(path.join(outside, 'secret.txt'), 'nope');
  symlinkSync(outside, path.join(ws, 'drafts', 'link'));
  const t = createWorkspaceTools({ cwd: ws, addDirs: [extra] });

  assert.match((await t.run('read_file', { path: 'posts/stats.md' })).content, /Total posts/);
  assert.equal((await t.run('read_file', { path: path.join(extra, 'guide.md') })).content, 'style guide');
  assert.equal((await t.run('read_file', { path: '../x' })).isError, true);
  assert.equal((await t.run('read_file', { path: path.join(outside, 'secret.txt') })).isError, true);
  assert.equal((await t.run('read_file', { path: 'drafts/link/secret.txt' })).isError, true, 'symlink escape');

  assert.equal((await t.run('write_file', { path: 'outbox/a.md', content: 'x' })).isError, false);
  assert.equal(readFileSync(path.join(ws, 'outbox', 'a.md'), 'utf8'), 'x');
  for (const p of ['posts/stats.md', 'outbox/STATUS.md', 'outbox/sent/a.md', 'site/x.md', path.join(extra, 'g.md'), 'drafts/link/secret.txt']) {
    assert.equal((await t.run('write_file', { path: p, content: 'x' })).isError, true, p);
  }
  assert.equal(readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'nope');

  await t.run('write_file', { path: 'drafts/d.md', content: 'one two two' });
  assert.equal((await t.run('edit_file', { path: 'drafts/d.md', old_text: 'two', new_text: '2' })).isError, true, 'ambiguous');
  assert.equal((await t.run('edit_file', { path: 'drafts/d.md', old_text: 'one', new_text: '1' })).isError, false);
  assert.match((await t.run('search', { pattern: 'total posts' })).content, /posts\/stats\.md:2:/);
  assert.equal((await t.run('search', { pattern: '(a+)+$' })).content, 'no matches', 'pattern is literal, not a regex');
  assert.match((await t.run('list_files', { depth: 2 })).content, /posts\/stats\.md/);
  assert.equal(validateInput('write_file', { path: 'a' }), 'missing "content"');
  assert.equal(validateInput('read_file', { path: 1 }), '"path" must be a string');
});

test('api adapter: tool loop, streaming, caching, cost, resume', async () => {
  const api = await startFakeMessagesApi([
    [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', name: 'read_file', input: { path: 'posts/stats.md' } }],
    [{ type: 'tool_use', name: 'write_file', input: { path: 'outbox/p.md', content: '---\naction: update\n---\n' } },
      { type: 'tool_use', name: 'write_file', input: { path: 'posts/stats.md', content: 'hacked' } }],
    [{ type: 'text', text: 'Done: wrote outbox/p.md.' }],
  ]);
  process.env.API_SESSIONS_DIR = tmp();
  process.env.API_MODEL = 'claude-sonnet-5-5';
  _setClient(new Anthropic({ apiKey: 'test', baseURL: api.url, maxRetries: 0 }));
  const ws = workspace();
  const events = [];
  try {
    const out = await runTurn({ prompt: 'Optimise post 1', cwd: ws, onEvent: (e) => events.push(e) });
    assert.equal(out.status, 'SUCCESS');
    assert.match(out.response, /^Reading\.\n\nDone: wrote outbox\/p\.md\.$/);
    assert.ok(events.some((e) => e.type === 'init' && e.sessionId === out.sessionId));
    assert.deepEqual(events.filter((e) => e.type === 'step').map((e) => e.stepType), ['view_file', 'write_file', 'write_file']);
    assert.ok(existsSync(path.join(ws, 'outbox', 'p.md')));
    assert.match(readFileSync(path.join(ws, 'posts', 'stats.md'), 'utf8'), /Total posts/, 'synced data untouched');

    // requests: caching on, fallbacks on, tool results returned in one user message
    const [r1, r2, r3] = api.requests;
    assert.deepEqual(r1.body.cache_control, { type: 'ephemeral' });
    assert.equal(r1.body.fallbacks, 'default');
    assert.match(r1.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(r1.body.model, 'claude-sonnet-5-5');
    assert.match(JSON.stringify(r2.body.messages.at(-1)), /Total posts/);
    const results = r3.body.messages.at(-1).content;
    assert.equal(results.length, 2);
    assert.equal(results[1].is_error, true);

    // usage: 3 responses × (100 input + 50 cache write), 20 output, 1000 cache read
    assert.equal(out.usage.inputTokens, 450);
    assert.equal(out.usage.outputTokens, 60);
    assert.equal(out.usage.cachedTokens, 3000);
    assert.equal(out.usage.model, 'claude-sonnet-5-5');
    assert.ok(Math.abs(out.usage.costUsd - 3 * costOf('claude-sonnet-5-5', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000 })) < 1e-9);

    // resume: the stored history is sent again, followed by the new message
    api.requests.length = 0;
    const again = await runTurn({ prompt: 'Thanks', cwd: ws, sessionId: out.sessionId, onEvent: () => {} });
    assert.equal(again.sessionId, out.sessionId);
    const msgs = api.requests[0].body.messages;
    assert.equal(msgs[0].content, 'Optimise post 1');
    assert.equal(msgs.at(-1).content, 'Thanks');
    await assert.rejects(runTurn({ prompt: 'x', cwd: ws, sessionId: 'missing', onEvent: () => {} }), /not found/);
  } finally {
    await api.close();
    delete process.env.API_MODEL;
  }
});

test('api adapter: per-turn model wins over API_MODEL, and onEvent is optional', async () => {
  const api = await startFakeMessagesApi([[{ type: 'text', text: '{"ok":true}' }]]);
  process.env.API_SESSIONS_DIR = tmp();
  process.env.API_MODEL = 'claude-sonnet-5-5';
  _setClient(new Anthropic({ apiKey: 'test', baseURL: api.url, maxRetries: 0 }));
  try {
    const out = await runTurn({ prompt: 'JSON please', cwd: workspace(), model: 'claude-opus-5-5' });
    assert.equal(out.status, 'SUCCESS');
    assert.equal(api.requests[0].body.model, 'claude-opus-5-5');
  } finally {
    await api.close();
    delete process.env.API_MODEL;
  }
});

test('api adapter: cost table', () => {
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(costOf('claude-opus-5-5', { cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }), 0.2 + 5);
  assert.equal(costOf('unknown-model', { input_tokens: 1e6 }), 0);
});
