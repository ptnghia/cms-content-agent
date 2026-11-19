// The PHP helper and the Node backend must agree on the token format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyToken } from '../server/auth.mjs';

let php = true;
try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { php = false; }

test('PHP ContentAgent::token() verifies in Node', { skip: php ? false : 'php not installed' }, () => {
  const lib = fileURLToPath(new URL('../php/ContentAgent.php', import.meta.url));
  const secret = 'p'.repeat(32);
  const token = execFileSync('php', ['-r', `require ${JSON.stringify(lib)}; echo ContentAgent::token(${JSON.stringify(secret)}, "main", "42", "Lê Văn A", 600);`], { encoding: 'utf8' });
  assert.deepEqual(verifyToken(token, { main: { tokenSecret: secret } }), { ok: true, siteId: 'main', uid: '42', name: 'Lê Văn A' });
});
