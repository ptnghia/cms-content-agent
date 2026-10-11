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
