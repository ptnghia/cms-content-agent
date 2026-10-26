# Agent-Agy — Trợ lý quản trị nội dung & SEO

Backend chạy trên VPS, điều khiển **agy CLI**; website PHP nhúng một widget chat vào trang admin.

```
Admin PHP ──<script widget.js>──► Widget (Shadow DOM)
   │ cấp token (HMAC)                    │ SSE /api/chat  (Bearer token)
   ▼                                      ▼
agy-token.php                    Backend Node (server/)
                                   ├─ data/conversations/  lịch sử hội thoại (nguồn sự thật)
                                   ├─ data/sites/<id>/     workspace của agent: posts/, plans/, drafts/, notes.md
                                   ├─ sync  ◄── API website (docs/SITE_API.md)
                                   └─ spawn agy -p --output-format stream-json (cwd = workspace)
```

Điểm thiết kế chính
- **Backend giữ toàn bộ dữ liệu**: hội thoại lưu ở `data/`. Mất hội thoại agy thì tự dựng lại ngữ cảnh từ lịch sử đã lưu.
- **Agent chỉ làm việc trên file** trong workspace (agy headless không chạy được lệnh). Backend đồng bộ bài viết từ website và tính sẵn `posts/stats.md`.
- **Không tự đăng bài**: agent chỉ ghi `plans/` và `drafts/`.
- **Đề xuất lên website (tuỳ site)**: site khai báo `api.features` → đồng bộ thêm nội dung đầy đủ / sản phẩm / danh mục / SEO, và mọi file agent ghi vào `outbox/` được backend gửi `POST /proposals` vào hàng chờ duyệt của website (xem `docs/SITE_API.md` phần "Mở rộng").

## Chạy thử (máy dev)
```
npm run mock-site                 # website giả lập, cổng 4000
copy config\sites.example.json config\sites.json   # rồi sửa api.base=http://127.0.0.1:4000/api/agent, key=dev-key
set DEV_MODE=1 && npm start       # http://127.0.0.1:3000  (trang demo + /dev/token)
```
Không cần `npm install`.

## API (Bearer token)
| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/chat` | `{message, conversationId?}` → SSE: `init`, `delta`, `step`, `result`, `error` |
| GET | `/api/conversations` | Danh sách hội thoại của người dùng |
| GET / DELETE | `/api/conversations/:id` | Xem / xoá hội thoại |
| POST | `/api/sync` | Đồng bộ bài viết từ website |
| GET | `/api/status` | Tình trạng đồng bộ |
| GET | `/api/health` | Kiểm tra sống (không cần token) |

## Tài liệu
[docs/PLAN.md](docs/PLAN.md) · [docs/SITE_API.md](docs/SITE_API.md) · [docs/DEPLOY.md](docs/DEPLOY.md)

## Agent CLI (agy / codex) và skill

- `AGENT_BACKEND=agy|codex` chọn CLI chính; `AGENT_FALLBACK=codex` bật dự phòng: nếu CLI chính lỗi (không chạy được, thoát lỗi, quá giờ) lượt đó chạy lại bằng CLI dự phòng, và trong `AGENT_FALLBACK_COOLDOWN_SEC` giây các lượt mới dùng dự phòng trước. Hội thoại luôn nối tiếp đúng CLI đã tạo ra nó (id lưu dạng `codex:<id>`); nếu CLI đó lỗi, hội thoại được dựng lại từ lịch sử. Không chuyển CLI khi đã stream chữ cho người dùng.
- Codex cần `codex login` và model tài khoản có quyền dùng (`CODEX_MODEL`, xem `codex debug models`). Codex không stream từng token.
- `skills/<tên>/SKILL.md` (front-matter `name`, `description`, `compose`) dùng chung cho cả hai CLI: chat nhận mục lục + đường dẫn để agent tự đọc; `/api/compose` nhúng sẵn các skill có `compose: new|optimize|sales` hợp chế độ. Giới hạn skill theo site bằng `"skills": ["seo-onpage", ...]` trong `config/sites.json`. Thêm skill = thêm thư mục, không cần sửa mã.
- Website đa ngôn ngữ chạy mỗi ngôn ngữ là một site agent (vd. `shop` + `shop-en`, cùng ID trang, `api.base` có `/api/en/agent`): đặt `"translationOf": "<id site gốc>"` ở site bản dịch. Chat của site đó được chỉ tới workspace bản gốc (chỉ đọc) để skill `content-translation` đọc bản tiếng Việt và ghi đề xuất `update` cùng ID vào `outbox/` của chính nó.
