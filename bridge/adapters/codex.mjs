// Adapter: OpenAI Codex CLI (`codex exec --json`). Codex does not stream tokens: the final agent
// message arrives at the end of the turn; interim "what I'm doing" messages between commands are dropped.
import { runJsonLines, normalizeUsage, envNum } from '../process.mjs';

export const name = 'codex';

function stepTypeOf(item) {
  if (item.type === 'file_change') return 'write_file';
  if (item.type === 'command_execution') {
    const c = String(item.command || '');
    if (/\b(rg|grep)\b/.test(c)) return 'grep';
    if (/\b(ls|find|tree)\b/.test(c)) return 'list_dir';
    if (/\b(cat|sed|head|tail|nl)\b/.test(c)) return 'view_file';
    return 'run_command';
  }
  return item.type || 'unknown';
}

function errorMessage(raw) {
  try { return JSON.parse(raw)?.error?.message || raw; } catch { return raw; }
}

/** @type {import('../index.mjs').RunTurn} */
export async function runTurn({ prompt, cwd, addDirs = [], sessionId, onEvent, signal }) {
  const bin = process.env.CODEX_BIN || 'codex';
  const common = [
    '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '-c', `sandbox_mode="${process.env.CODEX_SANDBOX || 'workspace-write'}"`,
    '-c', 'approval_policy="never"',
  ];
  if (process.env.CODEX_MODEL) common.push('-m', process.env.CODEX_MODEL);
  if (process.env.CODEX_EFFORT) common.push('-c', `model_reasoning_effort="${process.env.CODEX_EFFORT}"`);
  // Codex has no read-only --add-dir (extra dirs become writable), but its sandbox can read the whole
  // disk, so on the first turn we just tell it the absolute paths.
  let text = prompt;
  if (!sessionId && addDirs.length) text += `\n\n(Shared folders, READ ONLY: ${addDirs.join(', ')})`;
  const args = sessionId ? ['exec', 'resume', ...common, sessionId, '-'] : ['exec', ...common, '-'];
  const timeout = envNum('CODEX_TIMEOUT_SEC', envNum('AGY_TIMEOUT_SEC', 300));

  let sid = sessionId;
  let status = 'UNKNOWN';
  let pending = '';   // latest agent message; becomes the answer if nothing follows it
  let failure = '';
  let usage = normalizeUsage();
  const denied = [];

  const r = await runJsonLines({
    bin, args, cwd, stdin: text, signal, timeoutSec: timeout, label: 'codex',
    onJson: (ev) => {
      if (ev.type === 'thread.started') {
        sid = ev.thread_id || sid;
        onEvent({ type: 'init', sessionId: sid });
      } else if (ev.type === 'item.started') {
        const it = ev.item || {};
        if (it.type === 'command_execution' || it.type === 'file_change') {
          pending = '';   // the previous message was only narration
          onEvent({ type: 'step', stepType: stepTypeOf(it), state: 'ACTIVE' });
        }
      } else if (ev.type === 'item.completed') {
        const it = ev.item || {};
        if (it.type === 'agent_message' && it.text) pending = it.text;
        else if ((it.type === 'command_execution' || it.type === 'file_change') && it.status === 'failed') {
          denied.push(it.command || it.type);
        }
      } else if (ev.type === 'turn.completed') {
        status = 'SUCCESS';
        usage = normalizeUsage(ev.usage);
      } else if (ev.type === 'turn.failed') {
        status = 'FAILED';
        failure = errorMessage(ev.error?.message || 'turn.failed');
      }
    },
  });

  if (r.aborted) return { sessionId: sid, response: pending, status: 'CANCELLED', denied, usage };
  if (r.timedOut) throw new Error(`codex timed out after ${timeout}s`);
  if (status === 'FAILED') throw new Error(`codex failed: ${failure.slice(0, 500)}`);
  if (r.code !== 0 && status !== 'SUCCESS') {
    throw new Error(`codex exited with code ${r.code}${r.stderr ? `: ${r.stderr.slice(0, 500)}` : ''}`);
  }
  if (pending) onEvent({ type: 'delta', text: pending });
  return { sessionId: sid, response: pending, status, denied, usage };
}
