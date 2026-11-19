// Adapter: agy CLI (`agy -p --output-format stream-json`). Streams token deltas.
// Headless agy can read/write files but refuses to run commands (reported in denied_actions).
import { runJsonLines, normalizeUsage, envNum } from '../process.mjs';

export const name = 'agy';

/** @type {import('../index.mjs').RunTurn} */
export async function runTurn({ prompt, cwd, addDirs = [], sessionId, onEvent, signal }) {
  const bin = process.env.AGY_BIN || 'agy';
  const args = ['-p', prompt, '--output-format', 'stream-json'];
  if (sessionId) args.push('--conversation', sessionId);
  for (const d of addDirs) args.push('--add-dir', d);
  if (process.env.AGY_MODEL) args.push('--model', process.env.AGY_MODEL);
  if (process.env.AGY_MODE) args.push('--mode', process.env.AGY_MODE);
  const timeout = envNum('AGY_TIMEOUT_SEC', 300);
  if (timeout > 0) args.push('--print-timeout', `${timeout}s`);

  let sid = sessionId;
  let response = '';
  let status = 'UNKNOWN';
  let denied = [];
  let usage = normalizeUsage();
  const seenSteps = new Set();

  const r = await runJsonLines({
    bin, args, cwd, signal, label: 'agy',
    // agy enforces --print-timeout itself; ours is only a safety net
    timeoutSec: timeout > 0 ? timeout + 30 : 0,
    onJson: (ev) => {
      if (ev.event === 'init') {
        sid = ev.conversation_id || sid;
        onEvent({ type: 'init', sessionId: sid });
      } else if (ev.event === 'step_update') {
        const s = ev.step_update || {};
        sid = s.conversation_id || sid;
        if (s.step_type === 'agent_response') {
          if (s.text_delta) {
            response += s.text_delta;
            onEvent({ type: 'delta', text: s.text_delta });
          }
        } else if (s.step_type !== 'user_input' && s.step_type !== 'unknown') {
          const key = `${s.step_index}:${s.state}`;
          if (!seenSteps.has(key)) {
            seenSteps.add(key);
            onEvent({ type: 'step', stepType: s.step_type, state: s.state });
          }
        }
      } else if (ev.event === 'result') {
        const res = ev.result || {};
        sid = res.conversation_id || sid;
        status = res.status || status;
        if (typeof res.response === 'string' && res.response) response = res.response;
        denied = (res.denied_actions || []).map((a) => a.display_name || a.action);
        usage = normalizeUsage(res.usage);
      }
    },
  });

  if (r.aborted) return { sessionId: sid, response, status: 'CANCELLED', denied, usage };
  if (r.timedOut) throw new Error(`agy timed out after ${timeout}s`);
  if (r.code !== 0 && status !== 'SUCCESS') {
    throw new Error(`agy exited with code ${r.code}${r.stderr ? `: ${r.stderr.slice(0, 500)}` : ''}`);
  }
  return { sessionId: sid, response, status, denied, usage };
}
