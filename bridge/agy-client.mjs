// Cầu nối tới agy CLI: chạy MỘT lượt ở chế độ print + stream-json, phát sự kiện đã chuẩn hoá.
import { spawn } from 'node:child_process';

/**
 * @param {object} opts
 * @param {string} opts.prompt                 Prompt đầy đủ gửi cho agy
 * @param {string} opts.cwd                    Workspace của agent
 * @param {string[]} [opts.addDirs]            Thư mục bổ sung (--add-dir)
 * @param {string} [opts.agyConversationId]    Có thì nối tiếp hội thoại agy cũ
 * @param {(ev: object) => void} opts.onEvent
 * @param {AbortSignal} [opts.signal]          Huỷ => kill tiến trình agy
 * @returns {Promise<{agyConversationId?: string, response: string, status: string, denied: string[]}>}
 *
 * Sự kiện:
 *   {type:'init', agyConversationId}
 *   {type:'delta', text}
 *   {type:'step', stepType, state}
 *   {type:'result', status, response, denied, usage, durationSec}
 *   {type:'error', message}
 */
export function runTurn({ prompt, cwd, addDirs = [], agyConversationId, onEvent, signal }) {
  const bin = process.env.AGY_BIN || 'agy';
  const args = ['-p', prompt, '--output-format', 'stream-json'];
  if (agyConversationId) args.push('--conversation', agyConversationId);
  for (const d of addDirs) args.push('--add-dir', d);
  if (process.env.AGY_MODEL) args.push('--model', process.env.AGY_MODEL);
  if (process.env.AGY_MODE) args.push('--mode', process.env.AGY_MODE);
  const timeout = Number(process.env.AGY_TIMEOUT_SEC || 0);
  if (timeout > 0) args.push('--print-timeout', `${timeout}s`);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let convId = agyConversationId;
    let response = '';
    let status = 'UNKNOWN';
    let denied = [];
    let buf = '';
    let stderr = '';
    const seenSteps = new Set();

    const abort = () => child.kill();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    const handle = (line) => {
      line = line.trim();
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }

      if (ev.event === 'init') {
        convId = ev.conversation_id || convId;
        onEvent({ type: 'init', agyConversationId: convId });
      } else if (ev.event === 'step_update') {
        const s = ev.step_update || {};
        convId = s.conversation_id || convId;
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
        const r = ev.result || {};
        convId = r.conversation_id || convId;
        status = r.status || status;
        if (typeof r.response === 'string' && r.response) response = r.response;
        denied = (r.denied_actions || []).map((a) => a.display_name || a.action);
        onEvent({ type: 'result', status, response, denied, usage: r.usage, durationSec: r.duration_seconds });
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => reject(new Error(`Không chạy được agy (${bin}): ${err.message}`)));
    child.on('close', (code) => {
      handle(buf);
      if (signal?.aborted) return resolve({ agyConversationId: convId, response, status: 'CANCELLED', denied });
      if (code !== 0 && status !== 'SUCCESS') {
        return reject(new Error(`agy thoát với mã ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`));
      }
      resolve({ agyConversationId: convId, response, status, denied });
    });
  });
}
