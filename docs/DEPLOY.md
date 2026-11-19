# Triển khai backend

Hai cách: **Docker** (nhanh nhất) hoặc **systemd trên VPS**. Cách nào cũng cần đặt một reverse proxy HTTPS phía trước,
và backend chỉ nghe `127.0.0.1`.

## Yêu cầu
- Node.js >= 22.13 (nếu không dùng Docker).
- Ít nhất một agent CLI đã cài và **đã đăng nhập** bằng đúng tài khoản chạy dịch vụ:
  - Claude Code: `npm i -g @anthropic-ai/claude-code`, rồi `claude` → `/login` (hoặc đặt `ANTHROPIC_API_KEY` trong môi trường dịch vụ).
  - Codex: `npm i -g @openai/codex`, rồi `codex login`.
  - agy: cài theo hướng dẫn của agy, kiểm tra `agy -p "ping"`.
- Kiểm tra: `AGENT_BACKEND=claude npm run smoke`.

## Cách 1 — Docker
```
git clone https://github.com/ptnghia/cms-content-agent.git /opt/cms-content-agent && cd /opt/cms-content-agent
cp .env.example .env                             # AGENT_BACKEND, giới hạn, SYNC_*…
cp config/sites.example.json config/sites.json   # tokenSecret, allowedOrigins, api.base/key
docker compose up -d --build
docker compose run --rm agent claude             # đăng nhập Claude Code một lần (lưu trong volume claude-auth)
docker compose logs -f agent
```
- Thêm Codex: sửa `INSTALL_CODEX: "1"` trong `docker-compose.yml`, build lại, rồi `docker compose run --rm agent codex login`.
- Dữ liệu (hội thoại, usage, workspace) nằm trong volume `agent-data`. Sao lưu volume này.
- Container chạy bằng user `node` (không phải root). Đây là điều kiện để khoá chỉ-đọc dữ liệu đồng bộ có tác dụng.

## Cách 2 — systemd
```
git clone https://github.com/ptnghia/cms-content-agent.git /opt/cms-content-agent && cd /opt/cms-content-agent
cp .env.example .env                             # HOST=127.0.0.1, DEV_MODE=0
cp config/sites.example.json config/sites.json
sudo useradd --system --create-home agent && sudo chown -R agent: /opt/cms-content-agent
```
`/etc/systemd/system/cms-content-agent.service`:
```
[Unit]
Description=cms-content-agent
After=network-online.target

[Service]
User=agent
WorkingDirectory=/opt/cms-content-agent
ExecStart=/usr/bin/node server/server.mjs
Restart=always
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```
Chạy `sudo systemctl enable --now cms-content-agent`, đăng nhập CLI bằng `sudo -u agent -i claude`.
Sao lưu `data/`: đó là toàn bộ trạng thái (hoặc `data/store.db` + `data/sites/` khi dùng SQLite).

## nginx (SSE: phải tắt buffering)
```
server {
  listen 443 ssl; server_name agent.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 600s;
  }
}
```

## Phía WordPress
1. Cài plugin: *Plugin → Cài mới → Tải lên* file `content-agent.zip` (tải ở Releases hoặc chạy `npm run build:wp`), rồi kích hoạt.
2. *Content Agent → Cài đặt*: nhập **URL backend** (HTTPS), lưu lại. Plugin tự tạo API key và token secret.
3. Chép khối **Backend configuration** vào `config/sites.json` của backend (gộp vào đối tượng đang có), rồi khởi động lại backend.
   Khối này đã có sẵn `allowedOrigins`, `api.base` (`/wp-json/content-agent/v1`) và `api.features` theo plugin đang bật (WooCommerce…).
4. Quay lại trang cài đặt, kiểm tra trạng thái *Kết nối được*, rồi bấm nút chat → **Đồng bộ** cho lần đầu.
5. Muốn đồng bộ tự động thì đặt `SYNC_INTERVAL_MIN` (ví dụ `60`) trong `.env` của backend.

Lưu ý:
- REST API WordPress phải truy cập được từ backend, và header `Authorization` phải đi tới PHP. Một số host Apache/CGI
  chặn header này: khi đó thêm `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` vào `.htaccess`.
- Plugin bảo mật/tường lửa (Wordfence…) có thể chặn REST API cho khách: cho phép namespace `content-agent/v1` hoặc IP của backend.
- Đổi khoá (*Cài đặt → Đổi khoá bí mật*) thì nhớ cập nhật lại `config/sites.json`.

## Lưu trữ: file hay SQLite
- `STORE_DRIVER=file` (mặc định): mỗi hội thoại một file JSON, usage ghi JSONL theo tháng. Hợp với vài người dùng.
- `STORE_DRIVER=sqlite`: `data/store.db`, nhanh hơn khi có nhiều hội thoại. Để chuyển từ file sang:
  `npm run migrate:sqlite`, sau đó đặt `STORE_DRIVER=sqlite` rồi khởi động lại (file JSON cũ được giữ nguyên).

## Giám sát
- `GET /api/health` để kiểm tra dịch vụ còn sống (Docker đã có `HEALTHCHECK`).
- `GET /api/status` trả lần đồng bộ cuối và số lần lỗi liên tiếp.
- `GET /api/usage?days=30` trả token, chi phí và số yêu cầu của người dùng và của cả site, theo từng CLI.
- `SYNC_INTERVAL_MIN=60` + `SYNC_ALERT_WEBHOOK=https://hooks.slack.com/...`: khi đồng bộ lỗi `SYNC_ALERT_AFTER` lần liên tiếp
  thì gửi cảnh báo, và gửi tiếp một tin khi đồng bộ chạy lại được.

## Bảo mật cần nhớ
- `tokenSecret` và `api.key` chỉ nằm ở server (PHP + backend), không bao giờ xuống trình duyệt.
- Token sống ngắn (mặc định 15 phút, tối đa 24 giờ). Mỗi hội thoại gắn với `uid`, người khác không đọc được.
- Agent **không có công cụ shell hay mạng**: Claude Code tắt `Bash/WebFetch/WebSearch`, Codex chạy sandbox không mạng,
  agy headless từ chối lệnh. Dữ liệu mới do backend đồng bộ, agent không tự lấy.
- Dữ liệu đồng bộ (`posts/`, `content/`, `seo/`, `site/`, `outbox/sent/`…) được đặt **chỉ-đọc** giữa các lần đồng bộ
  (`WORKSPACE_LOCK=1`), nên agent chỉ ghi được `plans/`, `drafts/`, `outbox/`, `knowledge/` và `notes.md`. Lớp này dựa
  trên quyền file: không có tác dụng khi chạy bằng root hoặc trên Windows, và không thay được việc tắt công cụ shell.
- Chạy dịch vụ bằng user riêng, chỉ có quyền trên thư mục cài đặt.
- Giới hạn tần suất (`CHAT_PER_HOUR`, `COMPOSE_PER_HOUR`) tính theo từng tiến trình. Nếu chạy nhiều instance, cần đặt
  thêm giới hạn ở reverse proxy.
