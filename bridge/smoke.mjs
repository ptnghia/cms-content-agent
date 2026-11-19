// Live check of the configured agent CLI: two turns, verifies the session is resumed.
//   npm run smoke                 (uses AGENT_BACKEND)
//   AGENT_BACKEND=claude npm run smoke
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTurn } from './index.mjs';

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-smoke-'));
const onEvent = (ev) => { if (ev.type === 'delta') process.stdout.write(ev.text); };

const a = await runTurn({ prompt: 'Remember the keyword "orange". Reply only "ok".', cwd, onEvent });
console.log(`\n--- turn 1: ${a.status} via ${a.backend}, session=${a.sessionId}`, a.usage);
const b = await runTurn({ prompt: 'Which keyword did I give you? Answer with one word.', cwd, sessionId: a.sessionId, onEvent });
console.log(`\n--- turn 2: ${b.status}`, b.usage);
console.log(/orange/i.test(b.response) ? 'OK: context kept' : 'FAIL: context lost');
process.exit(/orange/i.test(b.response) ? 0 : 1);
