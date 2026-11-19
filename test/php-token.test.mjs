// The WordPress plugin and the Node backend must agree on the token format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyToken } from '../server/auth.mjs';

let php = true;
try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { php = false; }

test('WordPress plugin Token::sign() verifies in Node', { skip: php ? false : 'php not installed' }, () => {
  const lib = fileURLToPath(new URL('../wordpress/content-agent/includes/class-token.php', import.meta.url));
  const secret = 'p'.repeat(64);
  const code = `define('ABSPATH', '/'); require ${JSON.stringify(lib)}; echo ContentAgent\\Token::sign(${JSON.stringify(secret)}, "example-com", "42", "Lê Văn A", 600);`;
  const token = execFileSync('php', ['-r', code], { encoding: 'utf8' });
  assert.deepEqual(verifyToken(token, { 'example-com': { tokenSecret: secret } }), { ok: true, siteId: 'example-com', uid: '42', name: 'Lê Văn A' });
});
