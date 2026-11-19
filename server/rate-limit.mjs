// In-memory sliding-window rate limiter (per process). Keys are usually "<siteId>:<uid>".
// Enough for a single backend instance; put a shared limiter in front if you run several.

/**
 * @param {{limit: number, windowMs: number, now?: () => number}} o   limit <= 0 disables the limiter
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();   // key -> sorted timestamps inside the window

  const prune = (key, t) => {
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length) hits.set(key, arr); else hits.delete(key);
    return arr;
  };

  return {
    /** Records a hit when allowed. @returns {{ok: true, remaining: number} | {ok: false, retryAfterSec: number}} */
    take(key) {
      if (!(limit > 0)) return { ok: true, remaining: Infinity };
      const t = now();
      const arr = prune(key, t);
      if (arr.length >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
      arr.push(t);
      hits.set(key, arr);
      return { ok: true, remaining: limit - arr.length };
    },
    /** Drop empty keys; call periodically. */
    sweep() {
      const t = now();
      for (const key of [...hits.keys()]) prune(key, t);
    },
    size: () => hits.size,
  };
}
