# Triển khai backend trên VPS

## Yêu cầu
- Node.js >= 20, agy CLI đã cài và **đã đăng nhập** bằng tài khoản chạy dịch vụ (`agy -p "ping"` chạy được).
- Reverse proxy HTTPS (Caddy/nginx). Backend chỉ nghe `127.0.0.1`.

## Cài đặt
```
git clone … /opt/agent-agy && cd /opt/agent-agy
cp .env.example .env                     # HOST=127.0.0.1, DEV_MODE=0
cp config/sites.example.json config/sites.json   # điền tokenSecret (openssl rand -hex 32), allowedOrigins, api.base/key
node server/server.mjs
```
Dùng systemd (`Restart=always`, `User=agent`, `WorkingDirectory=/opt/agent-agy`) để chạy nền.
Sao lưu `data/` (hội thoại + workspace) — đó là toàn bộ trạng thái.

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

## Phía website PHP
1. Chép `php/AgyChat.php`, `php/agy-token.php` vào admin; đặt biến môi trường `AGY_TOKEN_SECRET` = `tokenSecret` của site.
2. Trong layout admin: `<?= AgyChat::embed('https://agent.example.com', '/admin/agy-token.php') ?>`
3. Thêm origin admin vào `allowedOrigins` trong `config/sites.json`.

## Bảo mật cần nhớ
- `tokenSecret` và `api.key` chỉ nằm ở server (PHP + backend), không bao giờ xuống trình duyệt.
- Token sống ngắn (mặc định 15 phút, tối đa 24 giờ); mỗi hội thoại gắn với `uid`, người khác không đọc được.
- agy chạy headless: **ghi file được, chạy lệnh/gọi mạng bị từ chối**. Dữ liệu mới do backend đồng bộ chứ agent không tự lấy.
  Muốn cho phép lệnh chỉ-đọc, thêm allow-rule trong cấu hình agy của tài khoản chạy dịch vụ (cân nhắc kỹ).
- Tài khoản chạy dịch vụ nên là user riêng, chỉ có quyền trên `/opt/agent-agy`.
