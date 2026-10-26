// Điều phối agent CLI: AGENT_BACKEND (agy | codex) là chính, AGENT_FALLBACK là dự phòng khi chính lỗi.
// id hội thoại trả ra có tiền tố "<backend>:" để lượt sau nối tiếp đúng CLI (id không tiền tố = agy, dữ liệu cũ).
const NAMES = ['agy', 'codex'];
const pick = (v, def) => {
  const b = (v || def || '').toLowerCase();
  if (b && !NAMES.includes(b)) throw new Error(`Backend không hợp lệ: ${b} (${NAMES.join(' | ')})`);
  return b;
};
const primary = pick(process.env.AGENT_BACKEND, 'agy');
const fallback = pick(process.env.AGENT_FALLBACK, '') === primary ? '' : pick(process.env.AGENT_FALLBACK, '');
const cooldownMs = Number(process.env.AGENT_FALLBACK_COOLDOWN_SEC || 300) * 1000;

export const AGENT_BACKEND = primary;
export const AGENT_FALLBACK = fallback;

const mods = {};
const load = async (name) => (mods[name] ??= (await import(`./${name}-client.mjs`)).runTurn);
const downUntil = {};   // backend -> thời điểm được thử lại (circuit breaker đơn giản)

function splitId(id) {
  const m = /^(agy|codex):(.+)$/.exec(id || '');
  return m ? { backend: m[1], raw: m[2] } : id ? { backend: 'agy', raw: id } : {};
}

export async function runTurn(opts) {
  const { backend: resumeBackend, raw } = splitId(opts.agyConversationId);
  // Nối tiếp hội thoại: bắt buộc đúng CLI đã tạo ra nó (lỗi → server tự dựng lại hội thoại mới từ lịch sử).
  let order;
  if (resumeBackend) order = [resumeBackend];
  else {
    order = fallback ? [primary, fallback] : [primary];
    if (fallback && Date.now() < (downUntil[primary] || 0)) order.reverse();   // chính vừa lỗi → dùng dự phòng trước
  }

  let lastErr;
  for (const name of order) {
    let sawDelta = false;
    const onEvent = (ev) => {
      if (ev.type === 'delta') sawDelta = true;
      if (ev.type === 'init') ev = { ...ev, agyConversationId: `${name}:${ev.agyConversationId}` };
      opts.onEvent(ev);
    };
    try {
      const run = await load(name);
      const out = await run({ ...opts, agyConversationId: raw, onEvent });
      downUntil[name] = 0;
      return { ...out, agyConversationId: out.agyConversationId ? `${name}:${out.agyConversationId}` : out.agyConversationId, backend: name };
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw err;
      if (fallback) downUntil[name] = Date.now() + cooldownMs;
      // Đã stream chữ cho người dùng thì không thể chạy lại bằng CLI khác (trùng nội dung).
      if (sawDelta || name === order[order.length - 1]) break;
      console.warn(`[agent] ${name} lỗi (${err.message}) → chuyển sang ${order[order.indexOf(name) + 1]}`);
      opts.onEvent({ type: 'step', stepType: 'retry', state: 'ACTIVE' });
    }
  }
  if (order.length > 1) lastErr.message += ` (đã thử: ${order.join(' → ')})`;
  throw lastErr;
}
