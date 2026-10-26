---
name: seo-onpage
description: Tối ưu SEO on-page cho MỘT trang có sẵn (title, description, heading, từ khoá, đoạn mở đầu, ảnh alt). Dùng khi yêu cầu "tối ưu / sửa SEO / cải thiện thứ hạng" một bài, sản phẩm hoặc danh mục.
compose: optimize
---
# SEO on-page cho một trang

Quy trình:
1. Đọc trang (`content/<loại>/<id>.md`) và mục của trang trong `seo/audit.md`; xác định từ khoá chính (ưu tiên `seo/keywords.md`, nếu chưa có thì suy từ tiêu đề và nói rõ là suy đoán).
2. Chấm theo checklist, chỉ sửa chỗ thực sự lỗi:
   - Title 30–60 ký tự, từ khoá chính ở nửa đầu, có điểm khác biệt (không chỉ lặp tên trang).
   - Description 120–160 ký tự, có từ khoá chính, kết bằng lợi ích hoặc lời kêu gọi hành động; không trùng title.
   - Một H1 duy nhất (đã là tên trang) — thân bài chỉ dùng H2/H3; từ khoá chính hoặc biến thể trong ít nhất một H2.
   - Từ khoá chính trong 100 từ đầu; mật độ tự nhiên, không nhồi.
   - Đoạn ngắn (≤ 4 câu), danh sách khi liệt kê; có phần hỏi đáp nếu trang có câu hỏi thường gặp thật.
   - `alt` ảnh mô tả đúng nội dung; giữ nguyên `src`.
   - 2–4 liên kết nội bộ có anchor mô tả (xem skill `internal-linking`).
3. Giữ nguyên mọi dữ kiện, con số giá, bảng, ảnh, liên kết sẵn có. Không đổi alias.
4. Nêu căn cứ cho từng thay đổi (lỗi nào trong audit, vì sao) trong `summary` / `note`.
