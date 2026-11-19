// Agent CLI router. AGENT_BACKEND picks the primary adapter, AGENT_FALLBACK an optional backup that
// takes over when the primary fails (cannot start, exits with an error, times out).
//
// Session ids are stored as "<adapter>:<id>" so a conversation always resumes on the CLI that created
// it (a bare id without prefix is legacy agy data).
//
// Adding a CLI = add bridge/adapters/<name>.mjs exporting `name` and `runTurn` (see RunTurn below)
// and list it in ADAPTERS. Nothing else in the server needs to change.

/**
 * @typedef {{inputTokens:number, outputTokens:number, cachedTokens:number, costUsd:number}} Usage
 * @typedef {object} TurnOptions
 * @property {string} prompt
 * @property {string} cwd                     agent workspace
 * @property {string[]} [addDirs]             extra read-only folders (knowledge/, skills/, ...)
 * @property {string} [sessionId]             resume this CLI session
 * @property {(ev: object) => void} onEvent   {type:'init',sessionId} | {type:'delta',text} | {type:'step',stepType,state}
 * @property {AbortSignal} [signal]
 * @typedef {{sessionId?:string, response:string, status:string, denied:string[], usage:Usage}} TurnResult
 * @typedef {(opts: TurnOptions) => Promise<TurnResult>} RunTurn
 */

export const ADAPTERS = {
  agy: () => import('./adapters/agy.mjs'),
  codex: () => import('./adapters/codex.mjs'),
  claude: () => import('./adapters/claude.mjs'),
  api: () => import('./adapters/api.mjs'),   // Messages API, no CLI (needs ANTHROPIC_API_KEY)
};

export function parseSessionId(id) {
  if (!id) return {};
  const m = /^([a-z][a-z0-9_-]*):(.+)$/.exec(id);
  if (m && Object.hasOwn(ADAPTERS, m[1])) return { backend: m[1], raw: m[2] };
  return { backend: 'agy', raw: id };
}

const checkName = (v, label) => {
  const b = String(v || '').trim().toLowerCase();
  if (b && !Object.hasOwn(ADAPTERS, b)) throw new Error(`${label}: unknown agent backend "${b}" (${Object.keys(ADAPTERS).join(' | ')})`);
  return b;
};

/**
 * @param {{primary?:string, fallback?:string, cooldownMs?:number, adapters?:Record<string, () => Promise<{runTurn: RunTurn}>>, log?:(msg:string)=>void}} [o]
 */
export function createRouter(o = {}) {
  const adapters = o.adapters || ADAPTERS;
  const primary = checkName(o.primary ?? process.env.AGENT_BACKEND ?? 'claude', 'AGENT_BACKEND') || 'claude';
  let fallback = checkName(o.fallback ?? process.env.AGENT_FALLBACK ?? '', 'AGENT_FALLBACK');
  if (fallback === primary) fallback = '';
  const cooldownMs = o.cooldownMs ?? Number(process.env.AGENT_FALLBACK_COOLDOWN_SEC || 300) * 1000;
  const log = o.log || ((m) => console.warn(m));
  const loaded = {};
  const downUntil = {};   // adapter -> timestamp until which it is skipped (simple circuit breaker)
  const load = async (n) => (loaded[n] ??= (await adapters[n]()).runTurn);

  /** @param {TurnOptions} opts @returns {Promise<TurnResult & {backend:string}>} */
  async function runTurn(opts) {
    const { backend: resumeWith, raw } = parseSessionId(opts.sessionId);
    let order;
    if (resumeWith) order = [resumeWith];   // resume must use the same CLI; the server rebuilds context on failure
    else {
      order = fallback ? [primary, fallback] : [primary];
      if (fallback && Date.now() < (downUntil[primary] || 0)) order.reverse();
    }

    let lastErr;
    for (const n of order) {
      let sawDelta = false;
      const onEvent = (ev) => {
        if (ev.type === 'delta') sawDelta = true;
        if (ev.type === 'init') ev = { ...ev, sessionId: ev.sessionId ? `${n}:${ev.sessionId}` : ev.sessionId };
        opts.onEvent?.(ev);
      };
      try {
        const run = await load(n);
        const out = await run({ ...opts, sessionId: raw, onEvent });
        downUntil[n] = 0;
        return { ...out, sessionId: out.sessionId ? `${n}:${out.sessionId}` : out.sessionId, backend: n };
      } catch (err) {
        lastErr = err;
        if (opts.signal?.aborted) throw err;
        if (fallback) downUntil[n] = Date.now() + cooldownMs;
        // Text already streamed to the user cannot be replayed by another CLI without duplicating it.
        if (sawDelta || n === order[order.length - 1]) break;
        log(`[agent] ${n} failed (${err.message}) -> switching to ${order[order.indexOf(n) + 1]}`);
        opts.onEvent?.({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
      }
    }
    if (order.length > 1) lastErr.message += ` (tried: ${order.join(' -> ')})`;
    throw lastErr;
  }

  return { runTurn, primary, fallback };
}

let defaultRouter;
/** Router configured from the environment (created on first use). */
export function runTurn(opts) {
  defaultRouter ??= createRouter();
  return defaultRouter.runTurn(opts);
}
