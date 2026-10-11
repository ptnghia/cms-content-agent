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
