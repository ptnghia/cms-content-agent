// Editor plugin "write with AI" (POST /api/compose): builds the prompt (new article / optimise an existing page)
// and parses the answer, which is split into ===SECTION=== blocks. No outbox here: the plugin fills the form
// and the admin reviews before saving. Field names are canonical (server/fields.mjs); the request may also use
// the site's own names (site.fieldMap) and the response is mapped back to them in app.mjs.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { skillsComposeBlock } from './skills.mjs';
import { fromCms, canonicalName } from './fields.mjs';

const LENGTHS = { ngan: 'khoảng 600–800 từ', vua: 'khoảng 1000–1300 từ', dai: 'khoảng 1500–2000 từ' };
const SCOPES = {
  all: 'Tối ưu CẢ nội dung và SEO: giữ ý chính, sửa cấu trúc, diễn đạt, từ khoá, liên kết nội bộ; viết lại meta.',
  seo: 'CHỈ tối ưu SEO: giữ nguyên NỘI DUNG (không trả mục BODY), chỉ trả NAME, EXCERPT, META_TITLE, META_DESCRIPTION, KEYWORDS.',
  content: 'CHỈ tối ưu NỘI DUNG (cấu trúc, diễn đạt, từ khoá, liên kết nội bộ): không trả META_TITLE, META_DESCRIPTION, KEYWORDS.',
};
const TYPES = {
  post: 'bài viết tin tức',
  product: 'SẢN PHẨM (trang bán một sản phẩm / dịch vụ)',
  category: 'DANH MỤC (trang nhóm sản phẩm / chủ đề)',
};
const TARGETS = { excerpt: 'Mô tả ngắn (excerpt)', body: 'Nội dung (body)', body_extra: 'Bài viết chi tiết (body_extra)' };
const clip = (s, n) => String(s ?? '').slice(0, n);

export function normalizeCompose(b, site) {
  const mode = b.mode === 'optimize' ? 'optimize' : 'new';
  const cur = fromCms(site, b.cur && typeof b.cur === 'object' ? b.cur : {});
  const target = b.target ? canonicalName(site, String(b.target)) : '';
  return {
    mode,
    brief: clip(b.brief, 3000).trim(),
    keyword: clip(b.keyword, 200).trim(),
    length: LENGTHS[b.length] ? b.length : 'vua',
    scope: SCOPES[b.scope] ? b.scope : 'all',
    type: TYPES[b.type] ? b.type : 'post',
    target: TARGETS[target] ? target : 'body',
    postId: Number(b.itemId || b.postId) > 0 ? Number(b.itemId || b.postId) : 0,
    images: {
      featured: b.images?.featured && typeof b.images.featured === 'object' ? { name: clip(b.images.featured.name, 100), file: clip(b.images.featured.file, 200), url: clip(b.images.featured.url, 500) } : null,
      inline: (Array.isArray(b.images?.inline) ? b.images.inline : []).slice(0, 8).map((x) => ({ name: clip(x?.name, 100), url: clip(x?.url, 500), alt: clip(x?.alt, 160).trim() })),
    },
    others: Object.fromEntries(Object.entries(fromCms(site, b.others && typeof b.others === 'object' ? b.others : {})).filter(([k]) => TARGETS[k]).map(([k, v]) => [k, clip(v, 20000)])),
    cur: { name: clip(cur.name, 300), excerpt: clip(cur.excerpt, 2000), body: clip(cur.body, 300000),
           meta_title: clip(cur.meta_title, 300), meta_description: clip(cur.meta_description, 600), meta_keywords: clip(cur.meta_keywords, 500) },
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
        facts: facts ? facts[1].trim().slice(0, 600) : '', factsFull: facts ? facts[1].trim().slice(0, 1800) : '', issues: issues.split('\n').map((l) => l.replace(/^  - /, '').replace(/^"|"$/g, '')).filter(Boolean),
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
  const query = `${r.brief} ${r.keyword} ${r.cur.name} ${r.mode === 'optimize' ? `${r.cur.meta_keywords} ${plainText(r.cur.body).slice(0, 600)}` : ''}`;
  const self = r.postId ? { kind: r.type, id: r.postId } : null;
  const top = rank(items, query, self).slice(0, 5).map((x) => x.it);
  const parts = [];
  parts.push(`## Dữ liệu website (đã chọn sẵn — KHÔNG cần và KHÔNG được mở file)\n\n### Danh mục toàn bộ trang (dùng để chống trùng chủ đề và lấy slug liên kết nội bộ)\n` +
    items.filter((it) => it.slug && it.status !== 'hidden').map((it) => `- ${line(it)}`).join('\n'));
  const me = self ? items.find((it) => it.kind === self.kind && it.id === self.id) : null;
  if (r.type !== 'post' && me?.factsFull) parts.push(`### Dữ kiện chỉ đọc của CHÍNH ${r.type === 'product' ? 'sản phẩm' : 'danh mục'} này (nguồn sự thật cho con số / chính sách; không đổi, không bịa thêm)\n${me.factsFull}`);
  if (r.mode === 'new') {
    parts.push(`### Các trang liên quan nhất tới yêu cầu (nguồn dữ kiện; có thể trùng chủ đề)\n` + (top.length ? top.map((it) => rel(it, 900)).join('\n\n') : '(không có trang nào liên quan rõ ràng)'));
  } else {
    if (me) parts.push(`### Điểm SEO hiện tại của trang đang tối ưu: ${me.score}/100\n` + (me.issues.length ? me.issues.map((x) => `- ${x}`).join('\n') : '(không có lỗi ghi nhận)'));
    parts.push(`### Trang liên quan (gợi ý liên kết nội bộ / đối chiếu dữ kiện)\n` + (top.length ? top.map((it) => rel(it, 450)).join('\n\n') : '(không có)'));
  }
  return parts.join('\n\n');
}

/** Only images hosted by the website itself: URL under site.mediaOrigins (default: allowedOrigins), image extension. */
function safeImages(site, imgs) {
  const origins = (site.mediaOrigins || site.allowedOrigins || []).map((o) => o.replace(/\/$/, ''));
  const ok = (u) => origins.some((o) => u.startsWith(`${o}/`)) && /^[^?#"'<>\s]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(u);
  return { featured: imgs.featured && ok(imgs.featured.url) ? imgs.featured : null, inline: imgs.inline.filter((x) => ok(x.url)) };
}

function imagesBlock(im, r) {
  if (!im.inline.length && !im.featured) return '';
  const out = ['## Hình ảnh quản trị viên đã tải lên (đã nằm sẵn trên website — dùng đúng đường dẫn, không đổi)'];
  if (im.featured) out.push(`Ảnh đại diện: ${im.featured.name} — hệ thống tự gán vào ô Hình ảnh; KHÔNG chèn vào thân bài.`);
  if (im.inline.length) {
    out.push(`Ảnh dùng trong nội dung — chèn ĐỦ ${im.inline.length} ảnh, mỗi ảnh một đoạn riêng, đặt ở chỗ hợp lý (sau đoạn nói về nội dung đó; không đặt trước đoạn mở đầu):`);
    im.inline.forEach((x, i) => out.push(`${i + 1}. URL: ${x.url} — tên gốc: ${x.name}${x.alt ? ` — quản trị viên mô tả ảnh: "${x.alt}"` : ' — (không có mô tả)'}`));
    out.push('Cách chèn: `<p><img src="URL" alt="mô tả ngắn"></p>`. Bạn KHÔNG xem được nội dung ảnh: alt chỉ dựa vào mô tả của quản trị viên và chủ đề đoạn đó (không có mô tả thì dùng alt trung tính theo chủ đề bài, đừng đoán cảnh vật). Không bịa URL; ảnh nào không hợp thì vẫn chèn ở cuối mục gần nhất và nêu trong NOTES.');
    if (r.mode === 'optimize') out.push('Bài đang tối ưu đã có ảnh riêng: GIỮ NGUYÊN các ảnh cũ, chỉ thêm các ảnh mới ở trên.');
  }
  return out.join('\n');
}

export async function buildComposePrompt(site, workspace, r) {
  const tpl = await readFile(path.join(ROOT, 'agent', 'compose-prompt.md'), 'utf8');
  const parts = [tpl.replaceAll('{{SITE_NAME}}', site.name || 'website'), await buildContextBlock(workspace, r)];
  if (r.mode === 'new') {
    parts.push(`## Yêu cầu: VIẾT BÀI MỚI\nĐộ dài: ${LENGTHS[r.length]}.\nMô tả của quản trị viên:\n${r.brief || '(không mô tả — suy ra từ từ khoá)'}\n${r.keyword ? `Từ khoá chính đề xuất: ${r.keyword}\n` : ''}`);
    if (r.cur.body.trim()) parts.push(`Ô nội dung hiện có nháp (tham khảo, có thể dùng lại ý):\n${clip(r.cur.body, 8000)}`);
  } else {
    parts.push(`## Yêu cầu: TỐI ƯU BÀI CÓ SẴN\nPhạm vi: ${SCOPES[r.scope]}${r.type !== 'post' ? ' (trang bán hàng: không trả NAME, EXCERPT)' : ''}\nGợi ý của quản trị viên:\n${r.brief || '(không có — tự đánh giá theo checklist SEO)'}\n${r.keyword ? `Từ khoá chính: ${r.keyword}\n` : ''}${r.postId ? `ID bài viết trên website: ${r.postId} (điểm và lỗi SEO của bài nằm ở mục dữ liệu bên trên)\n` : 'Bài chưa lưu — chưa có trong kho đồng bộ.\n'}`);
    const c = r.cur;
    parts.push(`### Bài hiện tại (nguồn sự thật — giữ nguyên ảnh, bảng, liên kết, mọi con số)\nNAME: ${c.name}\nEXCERPT: ${c.excerpt}\nMETA_TITLE: ${c.meta_title}\nMETA_DESCRIPTION: ${c.meta_description}\nKEYWORDS: ${c.meta_keywords}\nBODY (HTML):\n${c.body}`);
  }
  if (r.type !== 'post') {
    const prod = r.type === 'product';
    const others = Object.entries(r.others).filter(([k, v]) => k !== r.target && plainText(v)).map(([k, v]) => `- ${TARGETS[k]}: ${clip(plainText(v), 1800)}`).join('\n');
    parts.push(`## Loại trang: ${TYPES[r.type]} — trường đích: ${TARGETS[r.target]}\n` +
      `Đây là trang BÁN HÀNG, không phải bài tin tức: chỉ trả các mục BODY (cho trường đích), META_TITLE, META_DESCRIPTION, KEYWORDS, NOTES — KHÔNG trả NAME, EXCERPT (tên và đường dẫn giữ nguyên).\n` +
      `- TUYỆT ĐỐI không bịa / đổi / thêm con số giá, ưu đãi, thời hạn, chính sách, thông số, số lượng, kích thước. Con số chỉ lấy từ dữ kiện chỉ đọc hoặc từ nội dung hiện có; không chắc → bỏ, không viết. Không chèn con số giá mới vào nội dung.\n` +
      (prod ? `- Sản phẩm: \`body\` là bảng giá / thông tin chính (không viết ở đây), \`body_extra\` là bài chi tiết hiện dưới trang, \`excerpt\` là mô tả ngắn đầu trang. Viết đúng vai trò của trường đích; có thể thêm mục hỏi đáp (H2 + câu hỏi H3) chỉ từ dữ kiện có sẵn.\n- Liên kết nội bộ: tới danh mục chứa sản phẩm / sản phẩm liên quan có thật trong danh mục trang.\n` :
        `- Danh mục: \`excerpt\` là đoạn mở đầu ngắn đầu trang (60–120 từ, 1–2 đoạn <p>); \`body\` là bài SEO cuối trang (giới thiệu nhóm sản phẩm / chủ đề, gợi ý chọn, liên kết xuống các sản phẩm thuộc danh mục có thật).\n`) +
      (r.target === 'excerpt' ? '- Trường đích là MÔ TẢ NGẮN: chỉ 60–120 từ, 1–2 đoạn <p>, không H2, bỏ qua độ dài ở trên.\n' : '') +
      (others ? `\nNội dung các trường khác của trang này (chỉ để đối chiếu dữ kiện, KHÔNG viết lại, KHÔNG đổi):\n${others}` : ''));
  }
  const imBlock = imagesBlock(safeImages(site, r.images), { mode: r.mode });
  if (imBlock) parts.push(imBlock);
  const skillsBlock = await skillsComposeBlock(site, [r.mode, ...(r.type !== 'post' ? ['sales'] : [])]);
  if (skillsBlock) parts.push(skillsBlock);
  parts.push('Bắt đầu: mọi dữ liệu cần thiết đã có ở trên, KHÔNG mở file / chạy lệnh. Trả lời ngay ĐÚNG định dạng các mục ===SECTION=== ở trên, không thêm lời dẫn.');
  return parts.join('\n\n');
}

const KEYS = ['NAME', 'EXCERPT', 'META_TITLE', 'META_DESCRIPTION', 'KEYWORDS', 'NOTES', 'BODY'];

/** Parse ===SECTION=== blocks (the last one, BODY, takes the rest). Returns {fields, notes} with canonical names, or throws. */
export function parseComposeResponse(text) {
  const out = {};
  const re = /^===\s*([A-Z_]+)\s*===[ \t]*\r?\n?/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) if (KEYS.includes(m[1])) marks.push({ k: m[1], start: m.index, body: m.index + m[0].length });
  if (!marks.length) throw new Error('Agent không trả đúng định dạng (thiếu các mục ===SECTION===). Hãy thử lại.');
  marks.forEach((mk, i) => { out[mk.k] = text.slice(mk.body, i + 1 < marks.length ? marks[i + 1].start : text.length).trim(); });
  let html = out.BODY || '';
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return {
    fields: { name: out.NAME || '', excerpt: out.EXCERPT || '', body: html, meta_title: out.META_TITLE || '', meta_description: out.META_DESCRIPTION || '', meta_keywords: out.KEYWORDS || '' },
    notes: out.NOTES || '',
  };
}
