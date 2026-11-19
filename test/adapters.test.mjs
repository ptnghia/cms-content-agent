import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tmp, useFakeAgent } from './helpers.mjs';
import { createRouter, parseSessionId } from '../bridge/index.mjs';

const cwd = tmp();
const argsFile = path.join(cwd, 'args.jsonl');
useFakeAgent({ FAKE_ARGS_FILE: argsFile });
const lastCall = () => JSON.parse(readFileSync(argsFile, 'utf8').trim().split('\n').pop());

async function turn(adapter, extra = {}, env = {}) {
  process.env.FAKE_FORMAT = adapter;
  process.env.FAKE_MODE = env.mode || 'ok';
  const { runTurn } = await import(`../bridge/adapters/${adapter}.mjs`);
  const events = [];
  const out = await runTurn({ prompt: 'line one\nhello agent', cwd, addDirs: ['/kb'], onEvent: (e) => events.push(e), ...extra });
  return { out, events };
}

for (const adapter of ['agy', 'codex', 'claude']) {
  test(`${adapter}: streams the answer, returns session + usage`, async () => {
    const { out, events } = await turn(adapter, adapter === 'codex' ? { addDirs: [] } : {});
    assert.equal(out.status, 'SUCCESS');
    assert.equal(out.response.trim(), 'echo: hello agent');
    assert.ok(out.sessionId, 'session id');
    assert.ok(out.usage.inputTokens > 0 && out.usage.outputTokens > 0);
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join('').trim(), 'echo: hello agent');
    assert.ok(events.some((e) => e.type === 'init' && e.sessionId === out.sessionId));
    assert.ok(events.some((e) => e.type === 'step'));
  });

  test(`${adapter}: resumes the given session`, async () => {
    const { out } = await turn(adapter, { sessionId: 'sess-42' });
    assert.equal(out.sessionId, 'sess-42');
  });

  test(`${adapter}: failure rejects`, async () => {
    await assert.rejects(turn(adapter, {}, { mode: 'fail' }));
  });

  test(`${adapter}: abort returns CANCELLED`, async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const { out } = await turn(adapter, { signal: ac.signal }, { mode: 'hang' });
    assert.equal(out.status, 'CANCELLED');
  });
}

test('claude: passes safe defaults and prompt on stdin', async () => {
  await turn('claude');
  const c = lastCall();
  assert.equal(c.stdin, 'line one\nhello agent');
  assert.ok(c.args.includes('--verbose') && c.args.includes('stream-json'));
  assert.deepEqual(c.args.slice(c.args.indexOf('--permission-mode'), c.args.indexOf('--permission-mode') + 2), ['--permission-mode', 'acceptEdits']);
  assert.ok(c.args.includes('Bash'), 'Bash disallowed by default');
  assert.equal(c.args[c.args.indexOf('--add-dir') + 1], '/kb');
  // containment: no operator MCP servers / project settings, extra dirs and CLAUDE.md / .claude not writable
  assert.ok(c.args.includes('--strict-mcp-config'));
  assert.equal(c.args[c.args.indexOf('--setting-sources') + 1], 'user');
  for (const r of ['Edit(//kb/**)', 'Write(//kb/**)', 'Write(./CLAUDE.md)', 'Edit(./.claude/**)']) assert.ok(c.args.includes(r), r);
});

test('claude: reports cost', async () => {
  const { out } = await turn('claude');
  assert.equal(out.usage.costUsd, 0.0123);
  assert.equal(out.usage.cachedTokens, 120);
});

test('codex: keeps only the final message, mentions shared dirs on first turn', async () => {
  const { out } = await turn('codex');
  assert.equal(out.response, 'echo: (Shared folders, READ ONLY: /kb)');
  assert.match(lastCall().stdin, /READ ONLY: \/kb/);
});

test('crash surfaces stderr', async () => {
  await assert.rejects(turn('claude', {}, { mode: 'crash' }), /code 3: boom/);
});

test('missing binary rejects with a clear message', async () => {
  process.env.CLAUDE_BIN = '/nonexistent/claude';
  try {
    await assert.rejects(turn('claude'), /Cannot start claude/);
  } finally {
    useFakeAgent();
  }
});

test('parseSessionId: prefixed, legacy and empty', () => {
  assert.deepEqual(parseSessionId('claude:abc'), { backend: 'claude', raw: 'abc' });
  assert.deepEqual(parseSessionId('codex:t:1'), { backend: 'codex', raw: 't:1' });
  assert.deepEqual(parseSessionId('plain-id'), { backend: 'agy', raw: 'plain-id' });
  assert.deepEqual(parseSessionId(''), {});
});

test('router: prefixes session ids and resumes on the same adapter', async () => {
  process.env.FAKE_FORMAT = 'claude';
  process.env.FAKE_MODE = 'ok';
  const r = createRouter({ primary: 'claude', fallback: '' });
  const a = await r.runTurn({ prompt: 'hi', cwd, onEvent: () => {} });
  assert.equal(a.sessionId, 'claude:claude-session-1');
  assert.equal(a.backend, 'claude');
  const b = await r.runTurn({ prompt: 'again', cwd, sessionId: a.sessionId, onEvent: () => {} });
  assert.equal(b.sessionId, 'claude:claude-session-1');
});

test('router: falls back when the primary fails, then prefers the fallback during cooldown', async () => {
  const calls = [];
  const fake = (name, fail) => async () => ({
    runTurn: async () => { calls.push(name); if (fail) throw new Error(`${name} down`); return { sessionId: 's', response: name, status: 'SUCCESS', denied: [], usage: {} }; },
  });
  const r = createRouter({ primary: 'agy', fallback: 'codex', cooldownMs: 60_000, log: () => {},
    adapters: { agy: fake('agy', true), codex: fake('codex', false), claude: fake('claude', false) } });
  const steps = [];
  const out = await r.runTurn({ prompt: 'x', cwd, onEvent: (e) => steps.push(e) });
  assert.equal(out.backend, 'codex');
  assert.equal(out.sessionId, 'codex:s');
  assert.ok(steps.some((e) => e.stepType === 'retry'));
  calls.length = 0;
  await r.runTurn({ prompt: 'y', cwd, onEvent: () => {} });
  assert.deepEqual(calls, ['codex'], 'fallback tried first during cooldown');
});

test('router: does not fall back after text was streamed', async () => {
  const r = createRouter({ primary: 'agy', fallback: 'codex', log: () => {}, adapters: {
    agy: async () => ({ runTurn: async ({ onEvent }) => { onEvent({ type: 'delta', text: 'partial' }); throw new Error('died'); } }),
    codex: async () => ({ runTurn: async () => assert.fail('must not run') }),
    claude: async () => ({}),
  } });
  await assert.rejects(r.runTurn({ prompt: 'x', cwd, onEvent: () => {} }), /died/);
});

test('router: rejects unknown backend names', () => {
  assert.throws(() => createRouter({ primary: 'gpt' }), /unknown agent backend/);
});
