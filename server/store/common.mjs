// Helpers shared by storage drivers.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const WORKSPACE_DIRS = ['posts', 'plans', 'drafts', 'knowledge', 'outbox'];

export const workspacePath = (dataDir, siteId) => path.join(dataDir, 'sites', siteId);

export async function ensureWorkspaceDirs(dataDir, siteId) {
  const ws = workspacePath(dataDir, siteId);
  await Promise.all(WORKSPACE_DIRS.map((d) => mkdir(path.join(ws, d), { recursive: true })));
  return ws;
}

/** Older data stored the CLI session as agyConversationId. */
export function upgradeConversation(conv) {
  if (conv && conv.agentSessionId === undefined) {
    conv.agentSessionId = conv.agyConversationId ?? null;
    delete conv.agyConversationId;
  }
  return conv;
}

const zero = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 });

/** Fold usage entries into {totals..., byBackend, byModel}. */
export function summarize(entries) {
  const out = { ...zero(), byBackend: {}, byModel: {} };
  for (const e of entries) {
    for (const t of [out, (out.byBackend[e.backend || 'unknown'] ??= zero()), (out.byModel[e.model || 'default'] ??= zero())]) {
      t.requests += 1;
      t.inputTokens += Number(e.inputTokens) || 0;
      t.outputTokens += Number(e.outputTokens) || 0;
      t.cachedTokens += Number(e.cachedTokens) || 0;
      t.costUsd += Number(e.costUsd) || 0;
    }
  }
  const round = (t) => { t.costUsd = Math.round(t.costUsd * 1e6) / 1e6; };
  round(out);
  Object.values(out.byBackend).forEach(round);
  Object.values(out.byModel).forEach(round);
  return out;
}

export function normalizeUsageEntry(e) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    at: e.at || new Date().toISOString(),
    siteId: String(e.siteId),
    uid: String(e.uid),
    kind: e.kind === 'compose' ? 'compose' : 'chat',
    conversationId: e.conversationId || null,
    backend: e.backend || 'unknown',
    model: String(e.model || '').slice(0, 100),
    status: e.status || 'UNKNOWN',
    turns: n(e.turns),
    inputTokens: n(e.inputTokens),
    outputTokens: n(e.outputTokens),
    cachedTokens: n(e.cachedTokens),
    costUsd: n(e.costUsd),
    durationMs: n(e.durationMs),
  };
}
