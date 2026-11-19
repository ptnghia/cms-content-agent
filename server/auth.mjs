// Short-lived tokens minted by the website (WordPress plugin): base64url(JSON).base64url(HMAC-SHA256(first part, tokenSecret))
// Payload: { site, uid, name?, exp }  (exp: epoch seconds)
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_TTL_SEC = 24 * 3600;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, secret) {
  const p = b64u(JSON.stringify(payload));
  const s = createHmac('sha256', secret).update(p).digest('base64url');
  return `${p}.${s}`;
}

/** @returns {{ok:true, siteId:string, uid:string, name:string} | {ok:false, reason:string}} */
export function verifyToken(token, sites) {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'token' };
  const [p, sig, extra] = token.split('.');
  if (!p || !sig || extra !== undefined) return { ok: false, reason: 'format' };

  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); }
  catch { return { ok: false, reason: 'payload' }; }

  const site = Object.hasOwn(sites, payload?.site) ? sites[payload.site] : null;
  if (!site) return { ok: false, reason: 'site' };

  const expected = createHmac('sha256', site.tokenSecret).update(p).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return { ok: false, reason: 'sig' }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'sig' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(payload.exp) || payload.exp < now) return { ok: false, reason: 'expired' };
  if (payload.exp > now + MAX_TTL_SEC) return { ok: false, reason: 'ttl' };

  const uid = String(payload.uid ?? '').slice(0, 64);
  if (!uid) return { ok: false, reason: 'uid' };
  return { ok: true, siteId: payload.site, uid, name: String(payload.name ?? '').slice(0, 80) };
}
