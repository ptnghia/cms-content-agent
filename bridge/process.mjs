// Shared plumbing for CLI adapters: spawn one process, feed stdin, split stdout into JSON lines,
// honour AbortSignal + timeout, collect stderr. Each adapter only has to interpret the JSON events.
import { spawn } from 'node:child_process';

/**
 * @param {object} o
 * @param {string} o.bin                 executable
 * @param {string[]} o.args
 * @param {string} o.cwd
 * @param {string} [o.stdin]             written to stdin then closed (omit = stdin closed immediately)
 * @param {AbortSignal} [o.signal]       abort => kill the child, resolves with aborted=true
 * @param {number} [o.timeoutSec]        >0 => kill the child, resolves with timedOut=true
 * @param {(ev: any) => void} o.onJson   called for every stdout line that parses as JSON
 * @param {string} o.label               used in error messages
 * @returns {Promise<{code: number|null, stderr: string, aborted: boolean, timedOut: boolean}>}
 */
export function runJsonLines({ bin, args, cwd, stdin, signal, timeoutSec = 0, onJson, label }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`Cannot start ${label} (${bin}): ${err.message}`));
      return;
    }
    let buf = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const kill = () => { try { child.kill(); } catch { /* already gone */ } };
    const onAbort = () => kill();
    if (signal) {
      if (signal.aborted) kill();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = timeoutSec > 0 ? setTimeout(() => { timedOut = true; kill(); }, timeoutSec * 1000) : null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };

    const handleLine = (line) => {
      line = line.trim();
      if (!line || line[0] !== '{') return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      try { onJson(ev); } catch (err) { stderr += `\n[adapter] ${err.message}`; }
    };

    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (stderr.length < 20_000) stderr += d; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Cannot start ${label} (${bin}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      handleLine(buf);
      resolve({ code, stderr: stderr.trim(), aborted: !!signal?.aborted, timedOut });
    });
  });
}

/** Normalise the many usage shapes CLIs report into one record. Unknown fields are ignored. */
export function normalizeUsage(u = {}, costUsd) {
  const num = (...keys) => {
    for (const k of keys) {
      const v = Number(u?.[k]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  };
  const cost = Number(costUsd ?? u?.total_cost_usd ?? u?.cost_usd ?? u?.costUsd);
  return {
    inputTokens: num('input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'),
    outputTokens: num('output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'),
    cachedTokens: num('cached_input_tokens', 'cache_read_input_tokens', 'cachedTokens', 'cached_tokens'),
    costUsd: Number.isFinite(cost) && cost > 0 ? cost : 0,
  };
}

export const envNum = (name, def = 0) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : def;
};
