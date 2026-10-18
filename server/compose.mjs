// Plugin CKEditor "Viết bằng AI": dựng prompt (viết mới / tối ưu bài có sẵn) và đọc kết quả có dấu phân cách.
// Agent KHÔNG ghi outbox ở luồng này: trả thẳng văn bản có các mục ===TÊN=== để plugin điền vào form; admin xem lại rồi mới lưu.
import { readFile } from 'node:fs/promises';
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

export async function buildComposePrompt(site, workspace, r) {
  const tpl = await readFile(path.join(ROOT, 'agent', 'compose-prompt.md'), 'utf8');
  const parts = [tpl.replaceAll('{{SITE_NAME}}', site.name || 'website')];
  if (r.mode === 'new') {
    parts.push(`## Yêu cầu: VIẾT BÀI MỚI\nĐộ dài: ${LENGTHS[r.length]}.\nMô tả của quản trị viên:\n${r.brief || '(không mô tả — suy ra từ từ khoá)'}\n${r.keyword ? `Từ khoá chính đề xuất: ${r.keyword}\n` : ''}`);
    if (r.cur.noi_dung.trim()) parts.push(`Ô nội dung hiện có nháp (tham khảo, có thể dùng lại ý):\n${clip(r.cur.noi_dung, 8000)}`);
  } else {
    parts.push(`## Yêu cầu: TỐI ƯU BÀI CÓ SẴN\nPhạm vi: ${SCOPES[r.scope]}\nGợi ý của quản trị viên:\n${r.brief || '(không có — tự đánh giá theo checklist SEO)'}\n${r.keyword ? `Từ khoá chính: ${r.keyword}\n` : ''}${r.postId ? `ID bài viết trên website: ${r.postId} (có thể xem điểm/lỗi của bài trong content/posts/${r.postId}.md và seo/audit.md)\n` : 'Bài chưa lưu — chưa có trong kho đồng bộ.\n'}`);
    const c = r.cur;
    parts.push(`### Bài hiện tại (nguồn sự thật — giữ nguyên ảnh, bảng, liên kết, mọi con số)\nTEN: ${c.ten}\nMO_TA: ${c.mo_ta}\nTITLE: ${c.title}\nDES: ${c.des}\nKEYWORD: ${c.keyword}\nNOI_DUNG (HTML):\n${c.noi_dung}`);
  }
  parts.push('Bắt đầu: đọc các file cần thiết trong workspace rồi trả lời ĐÚNG định dạng các mục ===TÊN=== ở trên, không thêm lời dẫn.');
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
