# Kế hoạch triển khai

Trạng thái: [x] xong · [ ] chưa làm

## Giai đoạn 0 — Cầu nối chat ↔ agent ↔ agy (XONG)
- [x] `agy -p --output-format stream-json`, nối tiếp bằng `--conversation`

## Giai đoạn 1 — Backend VPS + widget nhúng (XONG, đã kiểm thử trên máy dev)
- [x] Xác thực token HMAC ngắn hạn do PHP cấp (PHP ↔ Node đã kiểm tra tương thích), CORS theo `allowedOrigins`
- [x] Lưu hội thoại phía backend; tự dựng lại ngữ cảnh từ lịch sử khi mất hội thoại agy
- [x] Workspace theo site: `posts/`, `plans/`, `drafts/`, `knowledge/`, `notes.md`
- [x] Đồng bộ bài viết qua API website (phân trang) + `posts/stats.md` tính sẵn
- [x] Widget Shadow DOM (floating / inline), markdown an toàn, Dừng, Hội thoại mới, nút Đồng bộ, khôi phục lịch sử
- [x] Mẫu PHP: `AgyChat.php`, `agy-token.php`, `embed-example.php`; tài liệu `SITE_API.md`, `DEPLOY.md`
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

## Giai đoạn 3b/4b — Nội dung đầy đủ + đề xuất qua outbox (XONG cho site có `api.features`, thử trên hethongvinpearlresort)
- [x] Đồng bộ nội dung đầy đủ bài viết / sản phẩm / danh mục, từ khoá, kết quả kiểm tra SEO, `site/inventory.md` chống trùng
- [x] `agent/system-prompt-content.md`: quy trình tối ưu bài cũ & viết bài mới không trùng, định dạng file đề xuất
- [x] `outbox/` → backend `POST /proposals` sau mỗi lượt, báo kết quả + link duyệt trong khung chat; `outbox/STATUS.md`
- [x] Website duyệt (Áp dụng / Từ chối / Hoàn tác) — agent không bao giờ ghi thẳng nội dung

## Giai đoạn 5 — Vận hành & bảo mật
- [ ] Giới hạn tần suất theo uid, nhật ký sử dụng + chi phí token mỗi lượt
- [ ] Chuyển lưu trữ sang SQLite khi số hội thoại lớn (hiện: file JSON)
- [ ] Rà soát quyền: allow-rule chỉ-đọc cho agy nếu cần phân tích nặng
- [ ] Đồng bộ định kỳ (`SYNC_INTERVAL_MIN`), cảnh báo khi đồng bộ lỗi
- [ ] Hủy/giới hạn quyền ghi: chỉ `plans/`, `drafts/`, `notes.md` (hiện agent có thể ghi cả workspace)

## Rủi ro đã biết
- Mỗi lượt ~10–60 giây; widget hiển thị stream và trạng thái.
- agy là tiến trình riêng mỗi lượt: tốn RAM/CPU, nên đặt `MAX_CONCURRENT` hợp lý theo cấu hình VPS.
- Agent có quyền ghi trong workspace site (kể cả `posts/`): dữ liệu đồng bộ bị ghi đè ở lần sync sau, nhưng cần siết quyền ở Giai đoạn 5.
- Nội dung do mô hình sinh ra phải được người duyệt trước khi đăng.
