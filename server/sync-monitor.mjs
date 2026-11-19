// Tracks sync health per site and sends an alert when syncing keeps failing (and when it recovers).
//   SYNC_ALERT_WEBHOOK   URL that receives POST JSON {event, site, siteName, failures, error, at}
//                        (Slack/Discord/Teams-compatible "text" field included)
//   SYNC_ALERT_AFTER     consecutive failures before alerting (default 2)

const state = new Map();   // siteId -> {lastOkAt, lastError, lastErrorAt, failures, alerted}

async function notify(payload) {
  const url = process.env.SYNC_ALERT_WEBHOOK;
  const text = payload.event === 'sync_failed'
    ? `[cms-content-agent] Sync failing for "${payload.siteName}" (${payload.failures}x): ${payload.error}`
    : `[cms-content-agent] Sync recovered for "${payload.siteName}"`;
  console[payload.event === 'sync_failed' ? 'error' : 'log'](text);
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error(`[sync] alert webhook failed: ${e.message}`);
  }
}

export async function recordSyncResult(siteId, site, error) {
  const s = state.get(siteId) || { lastOkAt: null, lastError: null, lastErrorAt: null, failures: 0, alerted: false };
  const at = new Date().toISOString();
  const threshold = Math.max(1, Number(process.env.SYNC_ALERT_AFTER || 2));
  if (error) {
    s.failures += 1;
    s.lastError = String(error.message || error).slice(0, 500);
    s.lastErrorAt = at;
    if (s.failures >= threshold && !s.alerted) {
      s.alerted = true;
      state.set(siteId, s);
      await notify({ event: 'sync_failed', site: siteId, siteName: site?.name || siteId, failures: s.failures, error: s.lastError, at });
    }
  } else {
    if (s.alerted) await notify({ event: 'sync_recovered', site: siteId, siteName: site?.name || siteId, failures: s.failures, at });
    Object.assign(s, { lastOkAt: at, failures: 0, alerted: false });
  }
  state.set(siteId, s);
  return s;
}

export function syncHealth(siteId) {
  const s = state.get(siteId);
  return s ? { lastOkAt: s.lastOkAt, lastError: s.lastError, lastErrorAt: s.lastErrorAt, consecutiveFailures: s.failures } : null;
}

export function _resetSyncMonitor() { state.clear(); }
