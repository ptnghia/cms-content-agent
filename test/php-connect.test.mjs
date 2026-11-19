// The plugin's "Connect" flow must refuse anything but a well-formed exchange response: it becomes the
// script URL loaded in wp-admin and the secrets used for every request. Runs the PHP with tiny WordPress stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let php = true;
try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { php = false; }
const skip = php ? false : 'php not installed';

const inc = (f) => JSON.stringify(fileURLToPath(new URL(`../wordpress/content-agent/includes/${f}`, import.meta.url)));
const STUBS = `
namespace { define('ABSPATH', '/');
  function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
  function untrailingslashit($s) { return rtrim($s, '/\\\\'); }
  function apply_filters($h, $v) { return $v; }
  function __($s) { return $s; }
  class WP_Error { public $c; function __construct($c, $m) { $this->c = $c; } }
  require ${inc('class-brand.php')}; require ${inc('class-connect.php')}; }
`;

function runPhp(body) {
  return JSON.parse(execFileSync('php', ['-r', `${STUBS} namespace { ${body} }`], { encoding: 'utf8' }));
}

test('Brand::secure_url accepts https (and http only on localhost)', { skip }, () => {
  const out = runPhp(`echo json_encode(array_map(['ContentAgent\\\\Brand', 'secure_url'], [
    'https://svc.example.com/', 'http://svc.example.com', 'http://localhost:3000', 'http://127.0.0.1:9601/',
    'javascript:alert(1)', 'https://user:pw@svc.example.com', '//svc.example.com', 'ftp://svc.example.com']));`);
  assert.deepEqual(out, ['https://svc.example.com', '', 'http://localhost:3000', 'http://127.0.0.1:9601', '', '', '', '']);
});

test('Connect::validate keeps only a well-formed exchange response', { skip }, () => {
  const good = { site_id: 'site_ab12', agent_url: 'https://agent.example.com/', api_key: 'k'.repeat(64), token_secret: 's'.repeat(64) };
  const cases = [
    good,
    { ...good, agent_url: 'http://evil.example.com' },
    { ...good, agent_url: 'javascript:alert(1)' },
    { ...good, site_id: '../x' },
    { ...good, api_key: 'short' },
    { ...good, token_secret: `${'s'.repeat(40)}"><script>` },
    { ...good, api_key: undefined },
  ];
  const out = runPhp(`
    $cases = json_decode(${JSON.stringify(JSON.stringify(cases))}, true);
    $r = array();
    foreach ($cases as $c) { $v = ContentAgent\\Connect::validate($c, 'https://svc.example.com'); $r[] = is_array($v) ? $v : 'error'; }
    echo json_encode($r);`);
  assert.deepEqual(
    { ...out[0], connected_at: 'x' },
    { backend_url: 'https://agent.example.com', site_id: 'site_ab12', api_key: good.api_key, token_secret: good.token_secret,
      connected_service: 'https://svc.example.com', connected_at: 'x' },
  );
  assert.deepEqual(out.slice(1), ['error', 'error', 'error', 'error', 'error', 'error']);
});
