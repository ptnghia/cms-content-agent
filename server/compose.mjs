// Plugin CKEditor "Viết bằng AI": dựng prompt (viết mới / tối ưu bài có sẵn) và đọc kết quả có dấu phân cách.
// Agent KHÔNG ghi outbox ở luồng này: trả thẳng văn bản có các mục ===TÊN=== để plugin điền vào form; admin xem lại rồi mới lưu.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';

const LENGTHS = { ngan: 'khoảng 600–800 từ', vua: 'khoảng 1000–1300 từ', dai: 'khoảng 1500–2000 từ' };
const SCOPES = {
  all: 'Tối ưu CẢ nội dung và SEO: giữ ý chính, sửa cấu trúc, diễn đạt, từ khoá, liên kết nội bộ; viết lại meta.',
  seo: 'CHỈ tối ưu SEO: giữ nguyên NỘI DUNG (không trả mục NOI_DUNG), chỉ trả TEN, MO_TA, TITLE, DES, KEYWORD.',
  content: 'CHỈ tối ưu NỘI DUNG (cấu trúc, diễn đạt, từ khoá, liên kết nội bộ): không trả TITLE, DES, KEYWORD.',
};
const clip = (s, n) => String(s ?? '').slice(0, n);

export function normalizeCompose(b) {
  const mode = b.mode === 'optimize' ? 'optimize' : 'new';
  return {
    mode,
    brief: clip(b.brief, 3000).trim(),
    keyword: clip(b.keyword, 200).trim(),
    length: LENGTHS[b.length] ? b.length : 'vua',
    scope: SCOPES[b.scope] ? b.scope : 'all',
    postId: Number(b.postId) > 0 ? Number(b.postId) : 0,
    cur: { ten: clip(b.cur?.ten, 300), mo_ta: clip(b.cur?.mo_ta, 2000), noi_dung: clip(b.cur?.noi_dung, 300000),
           title: clip(b.cur?.title, 300), des: clip(b.cur?.des, 600), keyword: clip(b.cur?.keyword, 500) },
  };
}


// ---------- Chọn sẵn dữ liệu liên quan (máy chủ làm, agent không phải mở file) ----------
const STOP = new Set(('la va cua cho cac nhung mot co khong duoc trong tai voi den tu khi nay do the nao gi bai viet ve nen can muon hay thi se da dang ' +
  'nhu theo cung nhieu rat nhat hon so tren duoi ra vao lai ma neu thay vi nhung boi').split(' '));
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const tokens = (s) => [...new Set(fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)))];
const plainText = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const fmVal = (fm, k) => { const m = new RegExp('^' + k + ':\\s*(.*)$', 'm').exec(fm); if (!m) return ''; try { return JSON.parse(m[1]); } catch { return m[1]; } };

let cache = { at: 0, items: [] };
async function loadItems(ws) {
  if (Date.now() - cache.at < 60_000 && cache.ws === ws) return cache.items;
  const items = [];
  for (const kind of ['posts', 'products', 'categories']) {
    let names = [];
    try { names = await readdir(path.join(ws, 'content', kind)); } catch { continue; }
    for (const n of names.filter((x) => x.endsWith('.md'))) {
      let txt = '';
      try { txt = await readFile(path.join(ws, 'content', kind, n), 'utf8'); } catch { continue; }
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(txt);
      if (!m) continue;
      const fm = m[1], body = m[2];
      const facts = /## Dữ kiện chỉ đọc \(facts\)\s*\n([\s\S]*?)(?=\n## |$)/.exec(body);
      const main = plainText(body.replace(/## Dữ kiện chỉ đọc \(facts\)[\s\S]*$/, '')).replace(/^\(không có nội dung\)$/, '');
      const issues = (/^seo_issues:\n((?:  - .*\n?)+)/m.exec(fm) || [])[1] || '';
      items.push({
        kind: { posts: 'post', products: 'product', categories: 'category' }[kind], id: Number(fmVal(fm, 'id')), title: fmVal(fm, 'title'), slug: fmVal(fm, 'slug'), kw: fmVal(fm, 'focus_keyword'),
        keywords: fmVal(fm, 'keywords'), score: fmVal(fm, 'seo_score'), status: fmVal(fm, 'status'), text: main,
        facts: facts ? facts[1].trim().slice(0, 600) : '', issues: issues.split('\n').map((l) => l.replace(/^  - /, '').replace(/^"|"$/g, '')).filter(Boolean),
      });
    }
  }
  cache = { at: Date.now(), ws, items };
  return items;
}

function rank(items, query, skip) {
  const q = tokens(query);
  if (!q.length) return [];
  return items.filter((it) => it.slug && !(skip && it.kind === skip.kind && it.id === skip.id) && it.status !== 'hidden').map((it) => {
    const t = new Set(tokens(`${it.title} ${it.slug.replace(/-/g, ' ')}`)), k = new Set(tokens(`${it.kw} ${it.keywords}`)), b = new Set(tokens(it.text.slice(0, 2500)));
    let sc = 0;
    for (const w of q) sc += (t.has(w) ? 3 : 0) + (k.has(w) ? 3 : 0) + (b.has(w) ? 1 : 0);
    return { it, sc: sc / Math.sqrt(q.length) };
  }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
}

const line = (it) => `[${it.kind} #${it.id}] ${it.title} | slug: ${it.slug} | từ khoá: ${it.kw || '-'}`;
const rel = (it, n) => `### ${line(it)}\nTóm tắt: ${it.text.slice(0, n)}${it.facts ? `\nDữ kiện chỉ đọc:\n${it.facts}` : ''}`;

/** Khối dữ liệu đưa thẳng vào prompt: danh mục trang (chống trùng + liên kết nội bộ) + 3–5 trang liên quan nhất */
export async function buildContextBlock(ws, r) {
  const items = await loadItems(ws);
  const query = `${r.brief} ${r.keyword} ${r.mode === 'optimize' ? `${r.cur.ten} ${r.cur.keyword} ${plainText(r.cur.noi_dung).slice(0, 600)}` : ''}`;
  const self = r.mode === 'optimize' && r.postId ? { kind: 'post', id: r.postId } : null;
  const top = rank(items, query, self).slice(0, 5).map((x) => x.it);
  const parts = [];
  parts.push(`## Dữ liệu website (đã chọn sẵn — KHÔNG cần và KHÔNG được mở file)\n\n### Danh mục toàn bộ trang (dùng để chống trùng chủ đề và lấy slug liên kết nội bộ)\n` +
    items.filter((it) => it.slug && it.status !== 'hidden').map((it) => `- ${line(it)}`).join('\n'));
  if (r.mode === 'new') {
    parts.push(`### Các trang liên quan nhất tới yêu cầu (nguồn dữ kiện; có thể trùng chủ đề)\n` + (top.length ? top.map((it) => rel(it, 900)).join('\n\n') : '(không có trang nào liên quan rõ ràng)'));
  } else {
    const me = self ? items.find((it) => it.kind === 'post' && it.id === self.id) : null;
    if (me) parts.push(`### Điểm SEO hiện tại của bài đang tối ưu: ${me.score}/100\n` + (me.issues.length ? me.issues.map((x) => `- ${x}`).join('\n') : '(không có lỗi ghi nhận)'));
    parts.push(`### Trang liên quan (gợi ý liên kết nội bộ / đối chiếu dữ kiện)\n` + (top.length ? top.map((it) => rel(it, 450)).join('\n\n') : '(không có)'));
  }
  return parts.join('\n\n');
}

export async function buildComposePrompt(site, workspace, r) {
  const tpl = await readFile(path.join(ROOT, 'agent', 'compose-prompt.md'), 'utf8');
  const parts = [tpl.replaceAll('{{SITE_NAME}}', site.name || 'website'), await buildContextBlock(workspace, r)];
  if (r.mode === 'new') {
    parts.push(`## Yêu cầu: VIẾT BÀI MỚI\nĐộ dài: ${LENGTHS[r.length]}.\nMô tả của quản trị viên:\n${r.brief || '(không mô tả — suy ra từ từ khoá)'}\n${r.keyword ? `Từ khoá chính đề xuất: ${r.keyword}\n` : ''}`);
    if (r.cur.noi_dung.trim()) parts.push(`Ô nội dung hiện có nháp (tham khảo, có thể dùng lại ý):\n${clip(r.cur.noi_dung, 8000)}`);
  } else {
    parts.push(`## Yêu cầu: TỐI ƯU BÀI CÓ SẴN\nPhạm vi: ${SCOPES[r.scope]}\nGợi ý của quản trị viên:\n${r.brief || '(không có — tự đánh giá theo checklist SEO)'}\n${r.keyword ? `Từ khoá chính: ${r.keyword}\n` : ''}${r.postId ? `ID bài viết trên website: ${r.postId} (điểm và lỗi SEO của bài nằm ở mục dữ liệu bên trên)\n` : 'Bài chưa lưu — chưa có trong kho đồng bộ.\n'}`);
    const c = r.cur;
    parts.push(`### Bài hiện tại (nguồn sự thật — giữ nguyên ảnh, bảng, liên kết, mọi con số)\nTEN: ${c.ten}\nMO_TA: ${c.mo_ta}\nTITLE: ${c.title}\nDES: ${c.des}\nKEYWORD: ${c.keyword}\nNOI_DUNG (HTML):\n${c.noi_dung}`);
  }
  parts.push('Bắt đầu: mọi dữ liệu cần thiết đã có ở trên, KHÔNG mở file / chạy lệnh. Trả lời ngay ĐÚNG định dạng các mục ===TÊN=== ở trên, không thêm lời dẫn.');
  return parts.join('\n\n');
}

const KEYS = ['TEN', 'MO_TA', 'TITLE', 'DES', 'KEYWORD', 'GHI_CHU', 'NOI_DUNG'];

/** Đọc các mục ===TÊN=== ... (mục cuối NOI_DUNG chiếm phần còn lại). Trả {fields, notes} hoặc ném lỗi. */
export function parseComposeResponse(text) {
  const out = {};
  const re = /^===\s*([A-Z_]+)\s*===[ \t]*\r?\n?/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) if (KEYS.includes(m[1])) marks.push({ k: m[1], start: m.index, body: m.index + m[0].length });
  if (!marks.length) throw new Error('Agent không trả đúng định dạng (thiếu các mục ===TÊN===). Hãy thử lại.');
  marks.forEach((mk, i) => { out[mk.k] = text.slice(mk.body, i + 1 < marks.length ? marks[i + 1].start : text.length).trim(); });
  let html = out.NOI_DUNG || '';
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return {
    fields: { ten: out.TEN || '', mo_ta: out.MO_TA || '', noi_dung: html, title: out.TITLE || '', des: out.DES || '', keyword: out.KEYWORD || '' },
    notes: out.GHI_CHU || '',
  };
}
