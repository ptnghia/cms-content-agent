// Adapter: Claude Code CLI (`claude -p --output-format stream-json --verbose --include-partial-messages`).
// Streams token deltas, resumes with --resume <session_id>, reports usage + total_cost_usd.
// Shell and network tools are disabled by default so the agent only works on workspace files,
// matching the other adapters.
import path from 'node:path';
import { runJsonLines, normalizeUsage, envNum } from '../process.mjs';

export const name = 'claude';

const DEFAULT_DISALLOWED = 'Bash,WebFetch,WebSearch,NotebookEdit';

function stepTypeOf(tool) {
  const t = String(tool || '');
  if (/^(Write|Edit|MultiEdit)$/.test(t)) return 'write_file';
  if (t === 'Read') return 'view_file';
  if (t === 'Grep') return 'grep';
  if (t === 'Glob' || t === 'LS') return 'list_dir';
  if (t === 'Bash') return 'run_command';
  return t || 'tool';
}

/** @type {import('../index.mjs').RunTurn} */
export async function runTurn({ prompt, cwd, addDirs = [], sessionId, onEvent, signal }) {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits'];
  const disallowed = process.env.CLAUDE_DISALLOWED_TOOLS ?? DEFAULT_DISALLOWED;
  if (disallowed) args.push('--disallowedTools', ...disallowed.split(/[\s,]+/).filter(Boolean));
  // Containment (verified with Claude Code 2.1): reads outside the working dirs are already refused; also
  //  - no MCP servers from the operator's config, no project settings or CLAUDE.md written by the agent,
  //  - extra dirs (knowledge, skills, a source site) are read-only, and the agent cannot create
  //    CLAUDE.md / .claude/ in the workspace to plant instructions for later sessions.
  args.push('--strict-mcp-config', '--setting-sources', 'user');
  const deny = ['./CLAUDE.md', './CLAUDE.local.md', './.claude/**', ...addDirs.map((d) => `/${path.resolve(d)}/**`)];
  args.push('--disallowedTools', ...deny.flatMap((p) => [`Edit(${p})`, `Write(${p})`]));
  if (sessionId) args.push('--resume', sessionId);
  for (const d of addDirs) args.push('--add-dir', d);
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
  const maxTurns = envNum('CLAUDE_MAX_TURNS', 0);
  if (maxTurns > 0) args.push('--max-turns', String(maxTurns));
  const timeout = envNum('CLAUDE_TIMEOUT_SEC', envNum('AGY_TIMEOUT_SEC', 300));

  let sid = sessionId;
  let response = '';
  let status = 'UNKNOWN';
  let resultText = '';
  let errorText = '';
  let usage = normalizeUsage();
  let model = '';
  const denied = [];

  const emit = (text) => {
    if (!text) return;
    response += text;
    onEvent({ type: 'delta', text });
  };

  const r = await runJsonLines({
    bin, args, cwd, stdin: prompt, signal, timeoutSec: timeout, label: 'claude',
    onJson: (ev) => {
      if (ev.type === 'system' && ev.subtype === 'init') {
        sid = ev.session_id || sid;
        model = ev.model || model;
        onEvent({ type: 'init', sessionId: sid });
      } else if (ev.type === 'stream_event') {
        const e = ev.event || {};
        // a new assistant message after earlier text: keep paragraphs apart
        if (e.type === 'message_start' && response && !response.endsWith('\n')) emit('\n\n');
        else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') emit(e.delta.text);
      } else if (ev.type === 'assistant') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'tool_use') onEvent({ type: 'step', stepType: stepTypeOf(block.name), state: 'ACTIVE' });
        }
      } else if (ev.type === 'result') {
        sid = ev.session_id || sid;
        resultText = typeof ev.result === 'string' ? ev.result : '';
        usage = { ...normalizeUsage(ev.usage, ev.total_cost_usd), model: model || Object.keys(ev.modelUsage || {})[0] || '' };
        for (const d of ev.permission_denials || []) denied.push(d.tool_name || 'tool');
        if (ev.subtype === 'success' && !ev.is_error) status = 'SUCCESS';
        else if (ev.subtype === 'error_max_turns') status = 'MAX_TURNS';
        else { status = 'FAILED'; errorText = resultText || ev.subtype || 'error'; }
      }
    },
  });

  if (r.aborted) return { sessionId: sid, response, status: 'CANCELLED', denied, usage };
  if (r.timedOut) throw new Error(`claude timed out after ${timeout}s`);
  if (status === 'FAILED') throw new Error(`claude failed: ${String(errorText).slice(0, 500)}`);
  if (r.code !== 0 && status !== 'SUCCESS' && status !== 'MAX_TURNS') {
    throw new Error(`claude exited with code ${r.code}${r.stderr ? `: ${r.stderr.slice(0, 500)}` : ''}`);
  }
  // CLI builds without partial-message streaming: deliver the final text in one piece
  if (!response.trim() && resultText) emit(resultText);
  return { sessionId: sid, response, status: status === 'MAX_TURNS' ? 'SUCCESS' : status, denied, usage };
}
