# Lộ trình (roadmap)

Trạng thái: [x] xong · [ ] chưa làm

## Giai đoạn 0 — Cầu nối chat ↔ agent ↔ agy (XONG)
- [x] `agy -p --output-format stream-json`, nối tiếp bằng `--conversation`

## Giai đoạn 1 — Backend VPS + widget nhúng (XONG, đã kiểm thử trên máy dev)
- [x] Xác thực token HMAC ngắn hạn do PHP cấp (PHP ↔ Node đã kiểm tra tương thích), CORS theo `allowedOrigins`
- [x] Lưu hội thoại phía backend; tự dựng lại ngữ cảnh từ lịch sử khi mất hội thoại agy
- [x] Workspace theo site: `posts/`, `plans/`, `drafts/`, `knowledge/`, `notes.md`
- [x] Đồng bộ bài viết qua API website (phân trang) + `posts/stats.md` tính sẵn
- [x] Widget Shadow DOM (floating / inline), markdown an toàn, Dừng, Hội thoại mới, nút Đồng bộ, khôi phục lịch sử
- [x] Tích hợp website (nay là plugin WordPress), tài liệu `SITE_API.md`, `DEPLOY.md`
- [x] Giới hạn: 1 lượt/hội thoại, `MAX_CONCURRENT` lượt toàn máy, độ dài tin nhắn

**Phát hiện kỹ thuật:** agy headless ghi file được nhưng **tự từ chối chạy lệnh** (phản hồi rỗng, vẫn `SUCCESS`).
→ Backend đồng bộ & tính thống kê; agent chỉ đọc/ghi file; có tự nhắc lại một lần khi agent cố chạy lệnh.

## Giai đoạn 2 — Triển khai thật (CẦN BẠN)
- [ ] Viết endpoint `GET /posts` phía website PHP theo `docs/SITE_API.md`
- [ ] Cài agy trên VPS, đăng nhập, chạy dịch vụ (systemd + nginx, xem `docs/DEPLOY.md`)
- [ ] Nhúng widget vào admin, cấu hình `tokenSecret`, `allowedOrigins`
- [ ] Viết `knowledge/` thật: style guide, checklist SEO, brand voice

## Giai đoạn 3 — Dữ liệu SEO & kế hoạch nội dung
- [ ] `GET /posts/{id}` (nội dung đầy đủ) → rà soát từng bài (heading, liên kết nội bộ, ảnh alt, trùng chủ đề)
- [ ] Kết nối Google Search Console → `data/sites/<id>/seo/queries.md` (đồng bộ như bài viết)
- [ ] Quy trình lập kế hoạch: cụm chủ đề, lịch đăng, khoảng trống từ khoá → `plans/`

## Giai đoạn 4 — Viết bài & đẩy nháp
- [ ] Quy trình brief → outline → bản nháp → QA checklist → duyệt
- [ ] Endpoint `POST /drafts` phía website; nút "Gửi lên CMS (nháp)" trong widget cho từng file `drafts/*.md`
- [ ] Panel xem `plans/` và `drafts/` trong widget

## Giai đoạn 3b/4b — Nội dung đầy đủ + đề xuất qua outbox (XONG cho site có `api.features`)
- [x] Đồng bộ nội dung đầy đủ bài viết / sản phẩm / danh mục, từ khoá, kết quả kiểm tra SEO, `site/inventory.md` chống trùng
- [x] `agent/system-prompt-content.md`: quy trình tối ưu bài cũ & viết bài mới không trùng, định dạng file đề xuất
- [x] `outbox/` → backend `POST /proposals` sau mỗi lượt, báo kết quả + link duyệt trong khung chat; `outbox/STATUS.md`
- [x] Website duyệt (Áp dụng / Từ chối / Hoàn tác) — agent không bao giờ ghi thẳng nội dung

## Giai đoạn 5 — Vận hành & bảo mật (XONG, v0.3.0)
- [x] Giới hạn tần suất theo uid (`CHAT_PER_HOUR`, `COMPOSE_PER_HOUR`, trả `429` + `Retry-After`)
- [x] Nhật ký sử dụng mỗi yêu cầu: token, token cache, chi phí USD (Claude Code), thời gian, số lượt CLI → `GET /api/usage`
- [x] Lưu trữ SQLite (`STORE_DRIVER=sqlite`, `node:sqlite`) + `npm run migrate:sqlite`
- [x] Đồng bộ định kỳ + cảnh báo webhook khi lỗi liên tiếp / khi hồi phục; `/api/status` báo tình trạng đồng bộ
- [x] Giới hạn quyền ghi: dữ liệu đồng bộ và sổ sách outbox chỉ-đọc giữa các lần đồng bộ (`WORKSPACE_LOCK`)
- [x] Adapter Claude Code; tắt công cụ shell/mạng mặc định cho mọi CLI

## Giai đoạn 6 — Dịch vụ cho WordPress (XONG, v0.4.0)
- [x] Plugin WordPress `content-agent`: REST API đồng bộ (bài, trang, chuyên mục, WooCommerce), kiểm tra SEO, `/schema`
- [x] Hàng chờ đề xuất trong wp-admin: diff, áp dụng / từ chối có lý do / hoàn tác; bài mới luôn là nháp; HTML → block Gutenberg
- [x] Yoast SEO, Rank Math hoặc trường SEO riêng; chặn đề xuất làm đổi con số trên sản phẩm / danh mục
- [x] Widget chat nhúng sẵn trong wp-admin (token qua admin-ajax, ảnh vào thư viện media); thanh bên "Viết bằng AI" trong Gutenberg
- [x] Giao diện tiếng Anh + tiếng Việt

## Giai đoạn 7 — Mở rộng (đang mở, xem issues)
- [ ] Phát hành plugin lên wordpress.org (WP coding standards, Plugin Check)
- [ ] Hỗ trợ trình soạn thảo cổ điển và trang sản phẩm WooCommerce cho "Viết bằng AI"
- [ ] FAQ có cấu trúc (schema FAQPage) cho sản phẩm / trang
- [ ] Quốc tế hoá: prompt, skill và chuỗi giao diện widget theo `site.language` (hiện chỉ có tiếng Việt)
- [ ] Panel trong widget: xem `plans/`, `drafts/`, usage
- [ ] Kết nối Google Search Console → `seo/queries.md`
- [ ] Giới hạn tần suất dùng chung khi chạy nhiều instance (SQLite / Redis)
- [ ] Ngân sách chi phí theo site (chặn khi vượt `costUsd` tháng)

## Rủi ro đã biết
- Mỗi lượt mất khoảng 10–60 giây. Widget hiển thị stream và trạng thái.
- Mỗi lượt là một tiến trình CLI riêng, tốn RAM/CPU, nên đặt `MAX_CONCURRENT` theo cấu hình máy.
- Khoá chỉ-đọc dựa trên quyền file: không có tác dụng khi chạy bằng root hoặc trên Windows, và một CLI được phép chạy lệnh shell có thể gỡ khoá. Vì vậy giữ công cụ shell ở trạng thái tắt.
- Nội dung do mô hình sinh ra phải được người duyệt trước khi đăng (đã bắt buộc qua hàng chờ đề xuất).
