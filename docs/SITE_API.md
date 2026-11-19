# API giữa plugin WordPress và backend

Plugin **Content Agent** (`wordpress/content-agent/`) cung cấp toàn bộ các endpoint dưới đây tại
`/wp-json/content-agent/v1`. Backend gọi vào với `Authorization: Bearer <api.key>`; `api.base` và `api.key` lấy từ khối
"Backend configuration" trong trang cài đặt của plugin. Tài liệu này dành cho người phát triển plugin, hoặc cho ai muốn
nối backend với một hệ thống khác WordPress.

| Endpoint (plugin) | Mã nguồn |
|---|---|
| `GET /posts` (bài viết **và trang**, `kind: post\|page`), `/products`, `/categories` | `includes/class-content.php` |
| `GET /seo` | `includes/class-audit.php` |
| `GET /keywords`, `GET /schema`, `GET /ping` | `includes/class-rest.php` |
| `GET/POST /proposals` | `includes/class-proposals.php` |

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
| `schema` | `GET /schema` → `{cms, seo_provider, types: {<type>: {label, editable[], create[]}}, notes[]}` | `site/fields.md` (agent làm theo bảng này) |
| `proposals` | `POST /proposals` `{action: update\|create, type: post\|page\|product\|category, id?, title, note, fields{}, patches{}, source}` → `201 {data:{id,status,warnings[],review_url}}`; `GET /proposals` | đọc `outbox/*.md\|json` sau mỗi lượt chat → gửi → `outbox/sent/`, `outbox/STATUS.md` |

Mỗi mục nên có thêm: `kind`, `focus_keyword`, `seo_score`, `seo_issues[]`, `admin_url`. Website **không áp dụng** đề xuất ngay — đưa vào hàng chờ duyệt;
lọc cột được phép, làm sạch HTML, cảnh báo trùng tiêu đề / từ khoá / bài gần giống.

Sản phẩm có thể kèm `facts` (đối tượng tuỳ ý: thông số, gói giá, khuyến mãi, chính sách…). Agent coi đây là dữ kiện
**chỉ đọc**: viết theo, không bao giờ sửa. Giá trị dạng mảng được ghi thành mỗi phần tử một dòng.

### Tên trường trong đề xuất (`fields`, `patches`)
Agent luôn dùng **tên trường chung** dưới đây. Nếu CSDL website đặt tên khác, khai báo `fieldMap` cho site trong
`config/sites.json` và backend sẽ đổi tên ngay trước khi gửi `POST /proposals`. API compose cũng dùng cùng bảng ánh xạ.

| Trường chung | Ý nghĩa | Loại trang |
|---|---|---|
| `name` | tên trang / H1 | post, page |
| `excerpt` | mô tả ngắn (HTML) | post, product, category |
| `body` | nội dung chính (HTML); với sản phẩm là bảng giá / thông tin chính | post, product, category |
| `body_extra` | bài viết chi tiết bên dưới trang sản phẩm (HTML) | product |
| `faq` | `[{question, answer}]` | product, category |
| `meta_title`, `meta_description`, `meta_keywords` | SEO (từ khoá chính đứng đầu, cách nhau bằng dấu phẩy) | tất cả |
| `slug`, `category_id`, `featured_image` | chỉ khi `action: create` | post, page (`category_id` chỉ post) |

```jsonc
"fieldMap": { "name": "title", "excerpt": "summary_html", "body": "content", "meta_title": "seo_title" }   // chỉ ghi những trường khác tên
```
`patches` (`{"body_extra": [{"find": "…", "replace": "…"}]}`) chỉ áp dụng cho trường HTML. Website thay đúng một chỗ
khớp và từ chối nếu không khớp hoặc khớp nhiều chỗ.

### Trạng thái đề xuất (`GET /proposals` → `items[].status`)
`pending` (chờ duyệt) · `applied` (đã áp dụng) · `rejected` (bị từ chối, kèm `reason`) · `reverted` (đã hoàn tác).
Mỗi mục còn có `fields[]`, `target_id`, `created_at`, `review_url`.

Lỗi kiểm tra trả `422 {error: {message, details[]}}` (trang không tồn tại: `404`). Backend đưa lỗi này lại cho agent sửa
một lần. Plugin từ chối: trường không có trong `schema`, bản vá không khớp đúng một chỗ, và với sản phẩm/danh mục,
mọi thay đổi làm mất hoặc đổi một con số (giá, thông số) đang có trên trang.

## API compose (cho plugin soạn thảo của website)
`POST /api/compose` (Bearer token như widget) → SSE `progress {chars}`, `step`, rồi `result {mode, scope, fields, notes}` hoặc `error`.
```jsonc
{
  "mode": "new",                 // new | optimize
  "type": "post",                // post | product | category
  "target": "body",              // trường đích cho product/category: excerpt | body | body_extra
  "brief": "…", "keyword": "…", "length": "vua",   // ngan | vua | dai
  "scope": "all",                // optimize: all | seo | content
  "itemId": 12,                  // id trang đang sửa (nếu đã lưu)
  "cur": { "name": "…", "excerpt": "…", "body": "<p>…</p>", "meta_title": "…", "meta_description": "…", "meta_keywords": "…" },
  "others": { "body_extra": "…" },               // nội dung các trường khác của trang, để đối chiếu
  "images": { "featured": {"name","file","url"}, "inline": [{"name","url","alt"}] }
}
```
`cur`, `others` và `target` nhận cả tên chung lẫn tên riêng của site (theo `fieldMap`). `result.fields` trả về theo tên
riêng của site. Chỉ nhận ảnh có URL thuộc `mediaOrigins` của site (mặc định là `allowedOrigins`).


Thử nhanh phía backend bằng website giả lập: `npm run mock-site` (cổng 4000, key `dev-key`).
Test tự động dùng một website giả lập đầy đủ hơn (có `/proposals`): xem `test/app.shared.mjs`.
