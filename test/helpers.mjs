import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_AGENT = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
chmodSync(FAKE_AGENT, 0o755);

export const tmp = (prefix = 'cca-test-') => mkdtempSync(path.join(tmpdir(), prefix));

/** Point every adapter at the fake CLI. */
export function useFakeAgent(env = {}) {
  Object.assign(process.env, { AGY_BIN: FAKE_AGENT, CODEX_BIN: FAKE_AGENT, CLAUDE_BIN: FAKE_AGENT, ...env });
}

/** Parse an SSE response body into the list of `data:` events. */
export async function readSse(res) {
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));
}
