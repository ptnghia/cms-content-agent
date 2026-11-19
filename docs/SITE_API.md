# Hợp đồng API của website (để backend đồng bộ dữ liệu)

Website PHP cần cung cấp các endpoint dưới đây, xác thực bằng `Authorization: Bearer <api.key>`
(khoá khai báo trong `config/sites.json` → `api.base`, `api.key`). Chỉ cần HTTPS + đọc.

## GET {base}/posts?page=1&per_page=100   (CÓ — đang được dùng)
```json
{
  "items": [
    {
      "id": 123, "title": "…", "slug": "…", "url": "https://…",
      "status": "published",            // published | draft | pending | scheduled
      "published_at": "2025-01-31T08:00:00Z", "updated_at": "2025-06-01T09:00:00Z",
      "word_count": 1250,
      "meta_title": "…", "meta_description": "…",
      "categories": ["SEO cơ bản"], "tags": ["seo"]
    }
  ],
  "next_page": 2                          // null khi hết
}
```
Tối đa `per_page=100`. Trả **tất cả** trạng thái (kể cả draft) để agent lập kế hoạch tránh trùng.

## Mở rộng — bật theo site bằng `api.features` trong `config/sites.json` (ĐÃ CÓ, server/content-sync.mjs + server/outbox.mjs)
```json
"api": { "base": "https://site/api/agent", "key": "…", "features": ["content", "products", "categories", "keywords", "seo", "proposals"] }
```
| feature | Endpoint website | Ghi vào workspace |
|---|---|---|
| `content` | `GET /posts?include=content` (thêm `excerpt`, `content_html`) | `content/posts/<id>.md` |
| `products` | `GET /products?page&per_page[&include=content]` (`content_html`, `article_html`, `faq[]`) | `products/index.md`, `content/products/<id>.md` |
| `categories` | `GET /categories[?include=content]` | `categories/index.md`, `content/categories/<id>.md` |
| (luôn khi có features) | — | `site/inventory.md` (mọi trang + từ khoá chính, để tránh viết trùng) |
| `keywords` | `GET /keywords` → `items[{keyword, group, intent, target_slug, priority, status, monthly_searches, position}]` | `seo/keywords.md` |
| `seo` | `GET /seo` → `{pages, avg_score, summary, rules, scores[], issues[]}` | `seo/audit.md` |
| `proposals` | `POST /proposals` `{action: update\|create, type: post\|product\|category, id?, title, note, fields{}, source}` → `201 {data:{id,status,warnings[],review_url}}`; `GET /proposals` | đọc `outbox/*.md\|json` sau mỗi lượt chat → gửi → `outbox/sent/`, `outbox/STATUS.md` |

Mỗi mục nên có thêm: `kind`, `focus_keyword`, `seo_score`, `seo_issues[]`, `admin_url`. Website **không áp dụng** đề xuất ngay — đưa vào hàng chờ duyệt;
lọc cột được phép, làm sạch HTML, cảnh báo trùng tiêu đề / từ khoá / bài gần giống.

## Dự kiến (giai đoạn sau)
- `GET  {base}/posts/{id}` — nội dung đầy đủ (HTML/Markdown) để agent rà soát chi tiết.
- `POST {base}/drafts` — đẩy bản nháp do agent viết lên CMS **ở trạng thái draft**, không bao giờ publish.
- `GET  {base}/categories` — cây chuyên mục.

## Gợi ý PHP tối thiểu
```php
$key = getenv('AGENT_API_KEY');
if (!hash_equals($key, preg_replace('/^Bearer /', '', $_SERVER['HTTP_AUTHORIZATION'] ?? ''))) { http_response_code(401); exit; }
```
Thử nhanh phía backend bằng website giả lập: `npm run mock-site` (cổng 4000, key `dev-key`).
Test tự động dùng một website giả lập đầy đủ hơn (có `/proposals`): xem `test/app.shared.mjs`.
