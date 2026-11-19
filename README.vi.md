# cms-content-agent: trợ lý AI nội dung & SEO cho WordPress

**Trợ lý AI trong wp-admin, biết mọi bài viết, trang và sản phẩm của website.** Nó rà soát SEO, lập kế hoạch nội dung, viết
và tối ưu trang. **Mọi thay đổi đều vào hàng chờ duyệt, không bao giờ tự đăng.**

Dự án gồm hai phần:

| | Là gì | Chạy ở đâu |
|---|---|---|
| **Backend** (`server/`, `bridge/`) | Dịch vụ Node.js điều khiển agent AI: **Claude Code**, **OpenAI Codex** hoặc **agy**, tự chuyển sang CLI dự phòng khi lỗi | VPS hoặc máy có Docker |
| **Plugin WordPress** (`wordpress/content-agent/`) | Chat trong wp-admin, hàng chờ duyệt, thanh bên "Viết bằng AI" trong Gutenberg, kiểm tra SEO, REST API cho backend | website WordPress (6.2+, PHP 7.4+) |

Hỗ trợ bài viết, trang, chuyên mục, sản phẩm và danh mục **WooCommerce**, cùng **Yoast SEO** hoặc **Rank Math**. Khi không
có plugin SEO, plugin dùng trường SEO riêng của nó.

[English](README.md) · [Triển khai](docs/DEPLOY.md) · [API plugin ↔ backend](docs/SITE_API.md) · [Lộ trình](docs/PLAN.md) · [Đóng góp](CONTRIBUTING.md)

## Biên tập viên nhận được gì

- **Nút chat trong wp-admin.** Ví dụ hỏi: "Bài nào thiếu meta description?", "Lập kế hoạch 10 bài quanh từ khoá X",
  "Viết lại phần mở đầu trang Giới thiệu". Có thể đính kèm ảnh, ảnh được lưu vào thư viện media.
- **Hàng chờ duyệt (Content Agent → Đề xuất).** Mỗi đề xuất hiển thị so sánh hai cột cho tiêu đề, nội dung, tóm tắt và
  trường SEO. Bạn có thể áp dụng, từ chối kèm lý do (trợ lý sẽ đọc được) hoặc hoàn tác sau. Bài và trang mới luôn được tạo ở dạng **nháp**.
- **Viết bằng AI trong Gutenberg.** Thanh bên viết mới hoặc tối ưu bài đang soạn, điền tiêu đề, nội dung (thành block thật)
  và tiêu đề / mô tả / từ khoá SEO.
- **Kiểm tra SEO** toàn bộ nội dung đã đăng, có dùng điểm của Yoast hoặc Rank Math nếu có.
- **WooCommerce an toàn.** Trợ lý chỉ sửa mô tả sản phẩm. Giá, SKU, kho và thuộc tính là dữ kiện chỉ đọc, và đề xuất nào làm
  đổi hoặc mất một con số trên trang đều bị plugin từ chối.

## Cài đặt (khoảng 10 phút)

1. **Chạy backend** trên máy chủ của bạn (cần URL HTTPS công khai):
   ```bash
   git clone https://github.com/ptnghia/cms-content-agent.git && cd cms-content-agent
   cp .env.example .env && echo '{}' > config/sites.json
   docker compose up -d --build            # có sẵn Claude Code; hoặc npm start (Node 22.13+)
   docker compose run --rm agent claude    # đăng nhập một lần (hoặc đặt ANTHROPIC_API_KEY trong .env)
   ```
   Đặt sau reverse proxy HTTPS, nhớ tắt buffering cho SSE (xem [docs/DEPLOY.md](docs/DEPLOY.md)).
2. **Cài plugin:** tải `content-agent.zip` ở [Releases](https://github.com/ptnghia/cms-content-agent/releases) (hoặc
   `npm run build:wp`), rồi vào *Plugin → Cài mới → Tải lên* và kích hoạt.
3. **Kết nối:** vào *Content Agent → Cài đặt*, nhập URL backend rồi lưu. Chép khối **Backend configuration** vào
   `config/sites.json` trên backend, sau đó chạy `docker compose restart`. Trang cài đặt sẽ báo *Kết nối được*.
4. **Dùng thử:** bấm nút chat ở góc phải dưới wp-admin, bấm **Đồng bộ** cho lần đầu.

## Agent CLI

| `AGENT_BACKEND` | Stream | Nối tiếp | Usage / chi phí | Ghi chú |
|---|---|---|---|---|
| `claude` (mặc định) | từng token | `--resume` | token + USD | mặc định tắt `Bash`, `WebFetch`, `WebSearch` |
| `codex` | câu cuối | `exec resume` | token | sandbox `workspace-write`, không mạng |
| `agy` | từng token | `--conversation` | theo CLI | headless từ chối chạy lệnh |

## Cấu hình backend (`.env`)

| Biến | Mặc định | |
|---|---|---|
| `AGENT_BACKEND` / `AGENT_FALLBACK` | `claude` / – | CLI chính / dự phòng |
| `CHAT_PER_HOUR` / `COMPOSE_PER_HOUR` | `60` / `12` | giới hạn theo người dùng (`0` = tắt) |
| `STORE_DRIVER` | `file` | `sqlite` khi có nhiều hội thoại (`npm run migrate:sqlite`) |
| `SYNC_INTERVAL_MIN` | `0` | đồng bộ định kỳ |
| `SYNC_ALERT_WEBHOOK` | – | cảnh báo khi đồng bộ lỗi liên tiếp |

Xem đủ trong [.env.example](.env.example). Mô hình bảo mật và API: xem [README.md](README.md).

## Phát triển

```bash
npm test            # test backend (CLI giả lập + API WordPress giả lập), store file và sqlite, kiểm tra token PHP ↔ Node
npm run lint:php    # php -l plugin
npm run build:wp    # dist/content-agent.zip
```

Giấy phép [MIT](LICENSE).
