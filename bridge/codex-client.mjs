// Cầu nối tới Codex CLI: chạy MỘT lượt bằng `codex exec --json`, phát cùng bộ sự kiện chuẩn hoá như agy-client.
// Khác agy: Codex không stream từng token — câu trả lời cuối đến một lần ở cuối lượt;
// các đoạn "đang làm gì" xen giữa các lệnh (commentary) bị bỏ, chỉ giữ tin nhắn cuối.
import { spawn } from 'node:child_process';

const DEFAULT_MODEL = 'gpt-5.6-terra';

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

/** Cùng chữ ký với agy-client.runTurn (agyConversationId = thread_id của Codex). */
export function runTurn({ prompt, cwd, addDirs = [], agyConversationId, onEvent, signal }) {
  const bin = process.env.CODEX_BIN || 'codex';
  const model = process.env.CODEX_MODEL || DEFAULT_MODEL;
  const common = [
    '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '-m', model,
    '-c', `sandbox_mode="${process.env.CODEX_SANDBOX || 'workspace-write'}"`,
    '-c', 'approval_policy="never"',
  ];
  if (process.env.CODEX_EFFORT) common.push('-c', `model_reasoning_effort="${process.env.CODEX_EFFORT}"`);
  // Codex không có --add-dir chỉ-đọc (thư mục thêm sẽ GHI được); nhưng sandbox vốn cho đọc cả đĩa,
  // nên chỉ cần báo đường dẫn tuyệt đối trong prompt lượt đầu.
  let text = prompt;
  if (!agyConversationId && addDirs.length) {
    text += `\n\n(Thư mục dùng chung, CHỈ ĐỌC: ${addDirs.join(', ')})`;
  }
  const args = agyConversationId
    ? ['exec', 'resume', ...common, agyConversationId, '-']
    : ['exec', ...common, '-'];
  const timeout = Number(process.env.CODEX_TIMEOUT_SEC || process.env.AGY_TIMEOUT_SEC || 0);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    child.stdin.end(text);

    let convId = agyConversationId;
    let status = 'UNKNOWN';
    let pending = '';          // tin nhắn agent gần nhất; thành câu trả lời nếu không có việc gì theo sau
    let response = '';
    let failure = '';
    let timedOut = false;
    let usage;
    const denied = [];
    const startedAt = Date.now();
    let buf = '';
    let stderr = '';

    const abort = () => child.kill();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; child.kill(); }, timeout * 1000) : null;

    const handle = (line) => {
      line = line.trim();
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }

      if (ev.type === 'thread.started') {
        convId = ev.thread_id || convId;
        onEvent({ type: 'init', agyConversationId: convId });
      } else if (ev.type === 'item.started') {
        const it = ev.item || {};
        if (it.type === 'command_execution' || it.type === 'file_change') {
          pending = '';   // đoạn trước đó chỉ là lời dẫn
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
        usage = ev.usage;
      } else if (ev.type === 'turn.failed') {
        status = 'FAILED';
        failure = errorMessage(ev.error?.message || 'turn.failed');
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

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Không chạy được codex (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      handle(buf);
      if (signal?.aborted) return resolve({ agyConversationId: convId, response: pending, status: 'CANCELLED', denied });
      if (timedOut) return reject(new Error(`codex quá thời gian ${timeout}s`));
      if (status === 'FAILED') return reject(new Error(`codex lỗi: ${failure.slice(0, 500)}`));
      if (code !== 0 && status !== 'SUCCESS') {
        return reject(new Error(`codex thoát với mã ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ''}`));
      }
      response = pending;
      if (response) onEvent({ type: 'delta', text: response });
      onEvent({ type: 'result', status, response, denied, usage, durationSec: (Date.now() - startedAt) / 1000 });
      resolve({ agyConversationId: convId, response, status, denied });
    });
  });
}
