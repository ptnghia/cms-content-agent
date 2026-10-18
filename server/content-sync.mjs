// Đồng bộ MỞ RỘNG (tuỳ site): nội dung đầy đủ, sản phẩm, danh mục, từ khoá, kết quả kiểm tra SEO, trạng thái đề xuất.
// Chỉ chạy khi site khai báo trong config/sites.json:  "api": { ..., "features": ["content", "products", "categories", "keywords", "seo", "proposals"] }
// Site không khai báo → giữ nguyên hành vi cũ (chỉ GET /posts). Hợp đồng API: docs/SITE_API.md (phần "Mở rộng").
//
// Kết quả trong workspace (agent chỉ ĐỌC):
//   content/posts/<id>.md, content/products/<id>.md, content/categories/<id>.md   front-matter + HTML hiện tại
//   products/index.md, categories/index.md                                        bảng gọn
//   site/inventory.md      MỌI trang (loại, id, tiêu đề, slug, từ khoá chính, điểm SEO) — đọc trước khi viết bài mới để tránh trùng
//   seo/audit.md           điểm SEO + lỗi theo trang (từ trang "Kiểm tra SEO" của website)
//   seo/keywords.md        ngân hàng từ khoá (trang đích, ưu tiên, lượt tìm nhập tay)
//   outbox/STATUS.md       các đề xuất đã gửi và trạng thái duyệt
import { mkdir, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const hasFeature = (site, f) => Array.isArray(site?.api?.features) && site.api.features.includes(f);

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

export async function apiGet(site, pathAndQuery) {
  const res = await fetch(`${site.api.base.replace(/\/$/, '')}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${site.api.key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Site API ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json();
}

async function getAll(site, endpoint, withContent) {
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const d = await apiGet(site, `${endpoint}?page=${page}&per_page=100${withContent ? '&include=content' : ''}`);
    if (!Array.isArray(d.items)) throw new Error(`Site API ${endpoint}: thiếu "items"`);
    out.push(...d.items);
    if (!d.next_page) break;
  }
  return out;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const yaml = (v) => (v === null || v === undefined || v === '' ? '' : JSON.stringify(v));

/** Một file nội dung: front-matter (JSON-quoted cho an toàn) + các khối HTML */
function contentFile(item, blocks) {
  const meta = ['id', 'kind', 'title', 'slug', 'url', 'status', 'type', 'category', 'category_id', 'meta_title', 'meta_description', 'keywords',
    'focus_keyword', 'seo_score', 'word_count', 'price', 'updated_at', 'admin_url'];
  const fm = meta.filter((k) => item[k] !== undefined && item[k] !== null && item[k] !== '').map((k) => `${k}: ${yaml(item[k])}`);
  if (Array.isArray(item.categories) && item.categories.length) fm.push(`categories: ${yaml(item.categories)}`);
  if (Array.isArray(item.seo_issues) && item.seo_issues.length) fm.push('seo_issues:', ...item.seo_issues.map((s) => `  - ${yaml(s)}`));
  const body = blocks.filter(([, v]) => v && String(v).trim()).map(([h, v]) => `## ${h}\n\n${String(v).trim()}\n`).join('\n');
  return `---\n${fm.join('\n')}\n---\n\n${body || '(không có nội dung)\n'}`;
}

/** Dữ kiện CHỈ ĐỌC của sản phẩm (thông số, gói giá, khuyến mãi) — để viết đúng, không được đổi */
const factsText = (f) => {
  if (!f || typeof f !== 'object' || !Object.keys(f).length) return '';
  const lines = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'tuy_chon_gia') lines.push(...v.map((o) => `- Gói/tuỳ chọn: ${o.ten} — ${o.gia} đ / ${o.don_vi || '?'}${o.khuyen_mai ? ` (KM ${o.khuyen_mai})` : ''}`));
    else if (k === 'khuyen_mai') lines.push(`- Khuyến mãi: ${v.gia_khuyen_mai} đ${v.ten_chuong_trinh ? ' — ' + v.ten_chuong_trinh : ''}`);
    else lines.push(`- ${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return '(CHỈ ĐỌC — nguồn sự thật cho con số/chính sách; không đổi, không bịa thêm)\n' + lines.join('\n');
};

const faqText = (faq) => (Array.isArray(faq) && faq.length ? faq.map((q) => `- **H:** ${q.question}\n  **Đ:** ${q.answer}`).join('\n') : '');

async function writeCollection(ws, kind, items, blocksOf) {
  const dir = path.join(ws, 'content', kind);
  await rm(dir, { recursive: true, force: true });   // xoá bản cũ: trang đã xoá trên website không còn sót
  await mkdir(dir, { recursive: true });
  for (const it of items) await atomicWrite(path.join(dir, `${it.id}.md`), contentFile(it, blocksOf(it)));
}

/** Bảng gọn cho products/index.md, categories/index.md */
function indexTable(title, items, extraCols = []) {
  const head = ['ID', 'Tiêu đề', 'Trạng thái', 'Điểm SEO', 'Từ khoá chính', 'Số từ', ...extraCols.map((c) => c[0]), 'Slug'];
  const rows = items.map((p) => [p.id, p.title, p.status, p.seo_score, p.focus_keyword, p.word_count, ...extraCols.map((c) => c[1](p)), p.slug].map(cell).join(' | '));
  return `# ${title} (${items.length})\n\nNội dung đầy đủ: \`content/<loại>/<id>.md\`.\n\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`;
}

/**
 * Gọi từ sync.mjs sau khi đã lấy /posts. postsWithContent: items của /posts (có content_html nếu feature "content").
 * @returns {Promise<object>} số lượng từng phần (để báo lại người dùng)
 */
export async function syncExtended(site, ws, postsWithContent) {
  const report = {};
  const all = [...postsWithContent.map((p) => ({ ...p, kind: p.kind || 'post' }))];

  if (hasFeature(site, 'content')) {
    await writeCollection(ws, 'posts', postsWithContent, (p) => [['Mô tả ngắn (mo_ta)', p.excerpt], ['Nội dung (noi_dung)', p.content_html]]);
    report.content = postsWithContent.length;
  }
  if (hasFeature(site, 'products')) {
    const items = await getAll(site, '/products', hasFeature(site, 'content'));
    all.push(...items);
    await atomicWrite(path.join(ws, 'products', 'index.md'),
      indexTable('Sản phẩm', items, [['Loại', (p) => p.type], ['Danh mục', (p) => p.category], ['Giá (chỉ xem)', (p) => p.price]]));
    if (hasFeature(site, 'content')) {
      await writeCollection(ws, 'products', items, (p) => [['Mô tả ngắn (mo_ta)', p.excerpt], ['Chi tiết / bảng giá (noi_dung)', p.content_html],
        ['Bài viết chi tiết (noi_dung_1)', p.article_html], ['Hỏi đáp (thong_so_kt)', faqText(p.faq)], ['Dữ kiện chỉ đọc (facts)', factsText(p.facts)]]);
    }
    report.products = items.length;
  }
  if (hasFeature(site, 'categories')) {
    const items = await getAll(site, '/categories', hasFeature(site, 'content'));
    all.push(...items);
    await atomicWrite(path.join(ws, 'categories', 'index.md'),
      indexTable('Danh mục', items, [['Module', (c) => c.module], ['Cha', (c) => c.parent_id ?? '']]));
    if (hasFeature(site, 'content')) {
      await writeCollection(ws, 'categories', items, (c) => [['Mô tả ngắn (mo_ta)', c.excerpt_html], ['Nội dung (noi_dung)', c.content_html],
        ['Hỏi đáp (thong_so_kt)', faqText(c.faq)]]);
    }
    report.categories = items.length;
  }

  // Kho nội dung: một bảng cho mọi loại — tra trùng chủ đề / từ khoá trước khi viết bài mới
  const inv = all.map((p) => [p.kind, p.id, p.title, p.slug, p.focus_keyword, p.seo_score, p.status].map(cell).join(' | '));
  await atomicWrite(path.join(ws, 'site', 'inventory.md'),
    `# Kho nội dung website (${all.length} trang)\n\nTrước khi đề xuất BÀI MỚI: tìm trong bảng này chủ đề / từ khoá chính tương tự. Đã có trang → đề xuất TỐI ƯU trang đó thay vì viết bài trùng.\n\n` +
    `| Loại | ID | Tiêu đề | Slug | Từ khoá chính | Điểm SEO | Trạng thái |\n|---|---|---|---|---|---|---|\n${inv.map((r) => `| ${r} |`).join('\n')}\n`);

  if (hasFeature(site, 'keywords')) {
    const d = await apiGet(site, '/keywords');
    const rows = (d.items || []).map((k) => [k.keyword, k.group, k.intent, k.target_slug ?? '', k.priority, k.status, k.monthly_searches ?? '', k.position ?? ''].map(cell).join(' | '));
    await atomicWrite(path.join(ws, 'seo', 'keywords.md'),
      `# Ngân hàng từ khoá (${rows.length})\n\nLượt tìm / vị trí do người nhập tay — không có thì đừng tự bịa số.\n\n` +
      `| Từ khoá | Nhóm | Ý định | Trang đích (slug) | Ưu tiên (1 cao) | Trạng thái | Lượt tìm/tháng | Vị trí |\n|---|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`);
    report.keywords = rows.length;
  }
  if (hasFeature(site, 'seo')) {
    const s = await apiGet(site, '/seo');
    const byPage = new Map();
    for (const i of s.issues || []) {
      const k = `${i.kind} #${i.id} ${i.title}`;
      if (!byPage.has(k)) byPage.set(k, []);
      byPage.get(k).push(`${i.level === 'error' ? 'LỖI' : i.level === 'warning' ? 'cảnh báo' : 'lưu ý'}: ${i.message}`);
    }
    const low = (s.scores || []).slice(0, 60).map((p) => [p.kind, p.id, p.title, p.score, p.focus_keyword, p.words].map(cell).join(' | '));
    await atomicWrite(path.join(ws, 'seo', 'audit.md'), [
      `# Kiểm tra SEO website — ${s.generated_at}`, '',
      `- Số trang: **${s.pages}** · điểm trung bình: **${s.avg_score}/100** · lỗi: **${s.summary?.error ?? 0}** · cảnh báo: **${s.summary?.warning ?? 0}**`,
      `- Quy tắc: Title ${s.rules?.title?.join('–')} ký tự, Description ${s.rules?.description?.join('–')} ký tự, số từ tối thiểu ${JSON.stringify(s.rules?.min_words)}`, '',
      '## 60 trang điểm thấp nhất', '| Loại | ID | Tiêu đề | Điểm | Từ khoá chính | Số từ |', '|---|---|---|---|---|---|', ...low.map((r) => `| ${r} |`), '',
      '## Vấn đề theo trang', ...[...byPage].map(([k, v]) => `### ${k}\n${v.map((x) => `- ${x}`).join('\n')}`), '',
    ].join('\n'));
    // Tách theo loại để làm từng nhóm: seo/audit-products.md, seo/audit-categories.md
    for (const [kind, file] of [['product', 'audit-products.md'], ['category', 'audit-categories.md']]) {
      const sc = (s.scores || []).filter((p) => p.kind === kind).sort((x, y) => x.score - y.score);
      const iss = new Map();
      for (const i of (s.issues || []).filter((x) => x.kind === kind)) {
        const k = `${i.id} ${i.title}`;
        if (!iss.has(k)) iss.set(k, []);
        iss.get(k).push(`${i.level === 'error' ? 'LỖI' : i.level === 'warning' ? 'cảnh báo' : 'lưu ý'}: ${i.message}`);
      }
      await atomicWrite(path.join(ws, 'seo', file), [
        `# Kiểm tra SEO — ${kind === 'product' ? 'sản phẩm' : 'danh mục'} (${sc.length} trang, ${s.generated_at})`, '',
        'Làm từ trang điểm thấp lên. Chỉ sửa chữ / meta / cấu trúc — KHÔNG đổi giá, con số, alias.', '',
        '| ID | Tiêu đề | Điểm | Từ khoá chính | Số từ | Số lỗi |', '|---|---|---|---|---|---|',
        ...sc.map((p) => `| ${[p.id, p.title, p.score, p.focus_keyword, p.words, (iss.get(`${p.id} ${p.title}`) || []).length].map(cell).join(' | ')} |`), '',
        '## Chi tiết theo trang', ...[...iss].map(([k, v]) => `### #${k}\n${v.map((x) => `- ${x}`).join('\n')}`), '',
      ].join('\n'));
    }
    report.seo = s.pages;
  }
  if (hasFeature(site, 'proposals')) await writeProposalStatus(site, ws).catch(() => {});
  return report;
}

/** outbox/STATUS.md — đề xuất đã gửi + trạng thái duyệt (để agent không gửi trùng) */
export async function writeProposalStatus(site, ws) {
  const d = await apiGet(site, '/proposals');
  const label = { cho_duyet: 'chờ duyệt', da_ap_dung: 'ĐÃ ÁP DỤNG', tu_choi: 'bị từ chối', hoan_tac: 'đã hoàn tác' };
  const rows = (d.items || []).map((p) => [p.id, p.action, p.type, p.target_id ?? '(mới)', p.title, label[p.status] || p.status, (p.fields || []).join(', '), p.created_at?.slice(0, 10)].map(cell).join(' | '));
  await atomicWrite(path.join(ws, 'outbox', 'STATUS.md'),
    `# Đề xuất đã gửi lên website (${rows.length} gần nhất)\n\nĐừng gửi lại đề xuất đang "chờ duyệt" cho cùng trang; "bị từ chối" thì hỏi lại người dùng lý do trước khi làm lại.\n\n` +
    `| # | Hành động | Loại | Trang | Tóm tắt | Trạng thái | Trường | Ngày |\n|---|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r} |`).join('\n')}\n`);
}
