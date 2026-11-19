import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { recordSyncResult, syncHealth, _resetSyncMonitor } from '../server/sync-monitor.mjs';

test('alerts once after N consecutive failures, then on recovery', async () => {
  const got = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); });
  });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { SYNC_ALERT_WEBHOOK: `http://127.0.0.1:${hook.address().port}/`, SYNC_ALERT_AFTER: '2' });
  const quiet = console.error; const quietLog = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    _resetSyncMonitor();
    const site = { name: 'Shop' };
    await recordSyncResult('shop', site, new Error('HTTP 500'));
    assert.equal(got.length, 0, 'below threshold');
    await recordSyncResult('shop', site, new Error('HTTP 502'));
    await recordSyncResult('shop', site, new Error('HTTP 503'));
    assert.equal(got.length, 1, 'alerted once');
    assert.equal(got[0].event, 'sync_failed');
    assert.equal(got[0].failures, 2);
    assert.match(got[0].text, /Shop.*HTTP 502/);
    assert.equal(syncHealth('shop').consecutiveFailures, 3);

    await recordSyncResult('shop', site, null);
    assert.equal(got.length, 2);
    assert.equal(got[1].event, 'sync_recovered');
    assert.equal(syncHealth('shop').consecutiveFailures, 0);
    assert.ok(syncHealth('shop').lastOkAt);
  } finally {
    console.error = quiet; console.log = quietLog;
    delete process.env.SYNC_ALERT_WEBHOOK;
    await new Promise((r) => hook.close(r));
  }
});
