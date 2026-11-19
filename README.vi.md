# cms-content-agent

**Trợ lý nội dung & SEO bằng AI, tự host, nhúng vào trang quản trị website.**
Chỉ cần một thẻ `<script>` trong admin (có sẵn mẫu PHP) là quản trị viên có một trợ lý chat. Trợ lý biết mọi bài viết,
sản phẩm, danh mục của website, rà soát SEO, lập kế hoạch nội dung, viết và tối ưu trang. **Mọi thay đổi đều vào hàng
chờ duyệt, không bao giờ tự đăng.**

Agent chạy trên các CLI bạn đã có (**Claude Code**, **OpenAI Codex** hoặc **agy**), tự chuyển sang CLI dự phòng khi
CLI chính lỗi. Không có thư viện npm nào, chỉ cần Node.js 22.13+.

[English](README.md) · [Triển khai](docs/DEPLOY.md) · [Hợp đồng API website](docs/SITE_API.md) · [Lộ trình](docs/PLAN.md) · [Đóng góp](CONTRIBUTING.md)

## Tính năng

- **Widget chat nhúng.** Shadow DOM (không đụng CSS admin), dạng nổi hoặc cố định. Có stream câu trả lời, nút Dừng,
  lịch sử hội thoại, nút Đồng bộ và đính kèm ảnh.
- **Hiểu website.** Backend đồng bộ bài viết, sản phẩm, danh mục, từ khoá và kết quả kiểm tra SEO qua API của
  website vào workspace riêng từng site, kèm thống kê tính sẵn (thiếu meta, nội dung mỏng, lâu chưa cập nhật…).
- **Duyệt trước khi đăng.** Agent chỉ ghi đề xuất vào `outbox/`. Backend gửi `POST /proposals` vào hàng chờ duyệt
  của website. Website từ chối (ví dụ đổi giá) thì agent nhận lý do và tự sửa một lần.
- **API cho plugin soạn thảo.** `/api/compose` trả bài mới hoặc bài đã tối ưu kèm meta SEO cho nút "Viết bằng AI"
  trong CKEditor.
- **Nhiều agent CLI.** Các adapter `claude`, `codex`, `agy` dùng chung một giao diện. Có cơ chế dự phòng kèm thời
  gian chờ, và hội thoại luôn nối tiếp đúng CLI đã tạo ra nó.
- **Thư viện skill.** Thêm `skills/<tên>/SKILL.md` là dùng được ngay cho cả chat và compose.
- **Nhiều site, nhiều ngôn ngữ.** Một backend phục vụ nhiều website. Site bản dịch đọc được workspace của site gốc.
- **Vận hành.** Giới hạn tần suất theo người dùng, nhật ký token và chi phí (`/api/usage`), lưu trữ file hoặc
  SQLite, đồng bộ định kỳ kèm cảnh báo webhook, và khoá chỉ-đọc dữ liệu đồng bộ trong workspace của agent.

## Chạy thử trên máy

```bash
git clone https://github.com/ptnghia/cms-content-agent.git && cd cms-content-agent
cp .env.example .env
cp config/sites.example.json config/sites.json
# sửa config/sites.json: tokenSecret (openssl rand -hex 32),
#   "api": { "base": "http://127.0.0.1:4000/api/agent", "key": "dev-key" }
npm run mock-site      # cửa sổ 1: website giả lập, 235 bài, cổng 4000
npm run dev            # cửa sổ 2: http://127.0.0.1:3000 (trang admin demo)
```

Cần cài và đăng nhập một agent CLI (ví dụ `claude`, hoặc đặt `ANTHROPIC_API_KEY`). Kiểm tra bằng `npm run smoke`.

## Docker

```bash
docker compose up -d --build              # backend 127.0.0.1:3000, có sẵn Claude Code
docker compose run --rm agent claude      # đăng nhập một lần (lưu trong volume)
docker compose --profile dev up           # kèm website giả lập
```

## Agent CLI

| `AGENT_BACKEND` | Stream | Nối tiếp | Usage / chi phí | Ghi chú |
|---|---|---|---|---|
| `claude` | từng token | `--resume` | token + USD | mặc định tắt `Bash`, `WebFetch`, `WebSearch` |
| `codex` | câu cuối | `exec resume` | token | sandbox `workspace-write`, không mạng |
| `agy` | từng token | `--conversation` | theo CLI | headless từ chối chạy lệnh |

Đặt `AGENT_FALLBACK=codex` để chạy lại lượt lỗi bằng CLI khác. Thêm CLI mới: viết `bridge/adapters/<tên>.mjs`
(xuất `name` và `runTurn`), đăng ký trong `bridge/index.mjs`.

## Cấu hình chính (`.env`)

| Biến | Mặc định | |
|---|---|---|
| `AGENT_BACKEND` / `AGENT_FALLBACK` | `claude` / – | CLI chính / dự phòng |
| `STORE_DRIVER` | `file` | `sqlite`: dùng `node:sqlite`; chuyển dữ liệu bằng `npm run migrate:sqlite` |
| `CHAT_PER_HOUR` / `COMPOSE_PER_HOUR` | `60` / `12` | giới hạn theo người dùng (`0` = tắt) |
| `SYNC_INTERVAL_MIN` | `0` | đồng bộ định kỳ |
| `SYNC_ALERT_WEBHOOK` | – | gửi cảnh báo khi đồng bộ lỗi liên tiếp `SYNC_ALERT_AFTER` lần |
| `WORKSPACE_LOCK` | `1` | dữ liệu đồng bộ chỉ-đọc với agent |

Xem đủ trong [.env.example](.env.example). Cấu hình site (`config/sites.json`), API và mô hình bảo mật: xem [README.md](README.md).

## Nhúng vào admin PHP

```php
<?php require 'php/ContentAgent.php'; ?>
<?= ContentAgent::embed('https://agent.example.com', '/admin/token.php', ['title' => 'Trợ lý nội dung']) ?>
```

## Phát triển

```bash
npm test         # node:test, không phụ thuộc: CLI giả lập + website giả lập, chạy trên cả store file và sqlite
npm run check
```

Giấy phép [MIT](LICENSE).
