#!/usr/bin/env node
// Stand-in for the agy / codex / claude CLIs in tests. Emits each CLI's stream-json format.
//   FAKE_FORMAT   agy | codex | claude          (which CLI to imitate)
//   FAKE_MODE     ok | fail | crash | hang | empty | write:<relpath>
//   FAKE_REPLY    fixed answer text (default: "echo: <last prompt line>")
//   FAKE_ARGS_FILE  if set, argv + stdin are appended there as one JSON line
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const format = process.env.FAKE_FORMAT || 'claude';
const mode = process.env.FAKE_MODE || 'ok';
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', main);

function argAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  if (process.env.FAKE_ARGS_FILE) appendFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({ format, args, stdin, cwd: process.cwd() }) + '\n');
  if (mode === 'crash') { process.stderr.write('boom'); process.exit(3); }
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }

  const prompt = format === 'agy' ? argAfter('-p') : stdin;
  const lastLine = String(prompt || '').trim().split('\n').pop();
  let reply = mode === 'empty' ? '' : (process.env.FAKE_REPLY || `echo: ${lastLine}`);

  if (mode.startsWith('write:')) {
    const rel = mode.slice(6);
    try {
      mkdirSync(path.dirname(path.join(process.cwd(), rel)), { recursive: true });
      writeFileSync(path.join(process.cwd(), rel), process.env.FAKE_WRITE_CONTENT || 'written by agent');
      reply = `wrote ${rel}`;
    } catch (e) {
      reply = `write failed: ${e.code}`;
    }
  }

  if (format === 'agy') {
    const id = argAfter('--conversation') || 'agy-session-1';
    out({ event: 'init', conversation_id: id });
    out({ event: 'step_update', step_update: { conversation_id: id, step_type: 'view_file', step_index: 1, state: 'ACTIVE' } });
    if (mode === 'fail') { out({ event: 'result', result: { conversation_id: id, status: 'ERROR' } }); process.exit(1); }
    for (const part of reply.match(/.{1,5}/gs) || []) out({ event: 'step_update', step_update: { conversation_id: id, step_type: 'agent_response', text_delta: part } });
    out({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: reply, usage: { input_tokens: 100, output_tokens: 20 } } });
  } else if (format === 'codex') {
    const resumed = args[0] === 'exec' && args[1] === 'resume';
    const id = resumed ? args[args.length - 2] : 'codex-thread-1';
    out({ type: 'thread.started', thread_id: id });
    out({ type: 'item.started', item: { type: 'command_execution', command: 'cat posts/stats.md' } });
    out({ type: 'item.completed', item: { type: 'agent_message', text: 'reading…' } });
    out({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } });
    if (mode === 'fail') { out({ type: 'turn.failed', error: { message: '{"error":{"message":"quota exceeded"}}' } }); process.exit(1); }
    out({ type: 'item.completed', item: { type: 'agent_message', text: reply } });
    out({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 30 } });
  } else {
    const id = argAfter('--resume') || 'claude-session-1';
    out({ type: 'system', subtype: 'init', session_id: id, tools: ['Read', 'Write'] });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'posts/stats.md' } }] } });
    if (mode === 'fail') {
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API overloaded', session_id: id });
      process.exit(1);
    }
    out({ type: 'stream_event', event: { type: 'message_start' } });
    for (const part of reply.match(/.{1,5}/gs) || []) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: id,
      usage: { input_tokens: 300, cache_read_input_tokens: 120, output_tokens: 40 }, total_cost_usd: 0.0123, permission_denials: [] });
  }
}
