// Adapter: Claude through the Messages API (@anthropic-ai/sdk), no CLI process.
// The agent loop runs here with file tools confined to the workspace (bridge/workspace-tools.mjs):
// read anywhere in the workspace and the extra folders, write only to plans/, drafts/, outbox/ and notes.md.
//
// - Streaming: text deltas go to the chat as they arrive.
// - Prompt caching: top-level cache_control, so the cached prefix (tools, system, the large first message
//   and the history) grows with the conversation and every tool round reads it from cache.
// - Sessions: the full message history (content blocks unchanged, thinking blocks included) is stored in
//   API_SESSIONS_DIR/<id>.json and resumed by id.
// - Refusal fallback: server-side fallbacks ("default") are on; API_FALLBACKS=0 turns them off.
// - Cost: computed from response.usage and the price table below (estimate; set API_PRICES to override).
//
// Credentials: ANTHROPIC_API_KEY (or any credential the SDK resolves). Model: API_MODEL (default claude-opus-5-5).
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { TOOL_DEFS, createWorkspaceTools, stepTypeOf } from '../workspace-tools.mjs';
import { envNum } from '../process.mjs';

export const name = 'api';

/** USD per million tokens. cacheWrite defaults to 1.25 × input (5-minute TTL). */
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
};

const SYSTEM = [
  'You work only through the file tools provided: list_files, read_file, search, write_file, edit_file.',
  'There is no shell and no network. The workspace is the current folder; extra read-only folders are given as absolute paths in the instructions.',
  'Read only what you need (start with the index and stats files the instructions name), then answer.',
  'Write files only where the instructions say (plans/, drafts/, outbox/, notes.md). Your final message is shown to the user.',
].join('\n');

let client;
const getClient = () => (client ??= new Anthropic({ maxRetries: envNum('API_MAX_RETRIES', 2) }));
/** Tests inject a client pointed at a fake server. */
export function _setClient(c) { client = c; }

const sessionsDir = () => process.env.API_SESSIONS_DIR || path.join(process.env.DATA_DIR || './data', 'api-sessions');
const sessionFile = (id) => path.join(sessionsDir(), `${id.replace(/[^\w-]/g, '')}.json`);

async function loadSession(id) {
  try { return JSON.parse(await readFile(sessionFile(id), 'utf8')); } catch { return null; }
}
async function saveSession(id, s) {
  await mkdir(sessionsDir(), { recursive: true });
  const f = sessionFile(id), tmp = `${f}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s), 'utf8');
  await rename(tmp, f);
}

function prices(model) {
  let table = PRICES;
  if (process.env.API_PRICES) { try { table = { ...PRICES, ...JSON.parse(process.env.API_PRICES) }; } catch { /* keep defaults */ } }
  const key = Object.keys(table).find((k) => model === k || model?.startsWith(`${k}-`)) || '';
  return table[key] || null;
}

/** Cost of one response from its usage block, in USD (0 when the model has no known price). */
export function costOf(model, u = {}) {
  const p = prices(model);
  if (!p) return 0;
  const write = p.cacheWrite ?? p.input * 1.25;
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output
    + (u.cache_creation_input_tokens || 0) * write + (u.cache_read_input_tokens || 0) * p.cacheRead) / 1e6;
}

/** Every tool_use in the last assistant message needs a tool_result, or the history cannot be resumed. */
function closeDanglingToolUses(messages, reason) {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant' || !Array.isArray(last.content)) return;
  const uses = last.content.filter((b) => b.type === 'tool_use');
  if (uses.length) messages.push({ role: 'user', content: uses.map((b) => ({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: reason })) });
}

/** @type {import('../index.mjs').RunTurn} */
export async function runTurn({ prompt, cwd, addDirs = [], sessionId, onEvent, signal }) {
  const model = process.env.API_MODEL || 'claude-opus-5-5';
  const effort = process.env.API_EFFORT || 'medium';
  const maxRounds = envNum('API_MAX_TOOL_ROUNDS', 40);
  const maxTokens = envNum('API_MAX_TOKENS', 64000);
  const fallbacks = process.env.API_FALLBACKS !== '0';
  const tools = createWorkspaceTools({ cwd, addDirs });

  let sid = sessionId;
  let session = sid ? await loadSession(sid) : null;
  if (sid && !session) throw new Error(`api session ${sid} not found`);   // the server rebuilds the context and starts over
  if (!session) { sid = randomUUID(); session = { model, messages: [] }; }
  const messages = session.messages;
  messages.push({ role: 'user', content: prompt });
  onEvent({ type: 'init', sessionId: sid });

  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, model: '' };
  let response = '';
  let status = 'SUCCESS';
  let jsonRetries = 0;
  const emit = (text) => { if (text) { response += text; onEvent({ type: 'delta', text }); } };

  try {
    for (let round = 0; ; round++) {
      if (round >= maxRounds) { status = 'SUCCESS'; break; }   // like the CLIs' max-turns: keep what was said
      if (response && !response.endsWith('\n')) emit('\n\n');
      const params = {
        model, max_tokens: maxTokens, system: SYSTEM, tools: TOOL_DEFS, messages,
        cache_control: { type: 'ephemeral' },
        output_config: { effort },
      };
      if (fallbacks) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      const stream = getClient().beta.messages.stream(params, { signal });
      stream.on('text', emit);

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (signal?.aborted) throw err;
        // An unparseable streamed tool input or a dropped connection: re-issue the turn (API errors are rethrown).
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        continue;
      }

      const u = message.usage || {};
      usage.inputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      usage.outputTokens += u.output_tokens || 0;
      usage.cachedTokens += u.cache_read_input_tokens || 0;
      usage.costUsd += costOf(message.model, u);
      usage.model = message.model || model;
      messages.push({ role: 'assistant', content: message.content });

      if (message.stop_reason === 'refusal') {
        status = 'SUCCESS';
        if (!response.trim()) emit('The model declined this request. Please rephrase it.');
        break;
      }
      if (message.stop_reason === 'pause_turn') continue;
      const uses = message.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) break;   // end_turn (or max_tokens without a tool call): done
      if (message.stop_reason === 'max_tokens') {
        closeDanglingToolUses(messages, 'tool input truncated (max_tokens); write a shorter file or split it');
        continue;
      }

      const results = [];
      for (const b of uses) {
        onEvent({ type: 'step', stepType: stepTypeOf(b.name), state: 'ACTIVE' });
        const r = await tools.run(b.name, b.input);
        results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });   // all results of one turn in a single message
      await saveSession(sid, session);
    }
  } catch (err) {
    closeDanglingToolUses(messages, signal?.aborted ? 'cancelled by the user' : 'interrupted');
    await saveSession(sid, session).catch(() => {});
    if (signal?.aborted) return { sessionId: sid, response, status: 'CANCELLED', denied: [], usage };
    throw new Error(`api: ${err.message}`);
  }
  await saveSession(sid, session);
  return { sessionId: sid, response, status, denied: [], usage };
}
