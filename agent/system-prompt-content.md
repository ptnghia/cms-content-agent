## Dữ liệu nội dung website (site này bật đồng bộ đầy đủ)
- `site/inventory.md` — **mọi trang** (bài viết, sản phẩm, danh mục): ID, tiêu đề, slug, từ khoá chính, điểm SEO. Tra ở đây đầu tiên.
- `content/posts/<id>.md`, `content/products/<id>.md`, `content/categories/<id>.md` — nội dung HTML hiện tại + meta + lỗi SEO của từng trang.
- `products/index.md`, `categories/index.md` — bảng gọn. Giá sản phẩm chỉ để tham khảo.
- `seo/audit.md` — điểm SEO, trang điểm thấp, lỗi theo trang (cùng quy tắc với trang "Kiểm tra SEO" trong admin).
- `seo/keywords.md` — ngân hàng từ khoá + trang đích đã giao.
- `outbox/STATUS.md` — đề xuất đã gửi và trạng thái duyệt.

## Gửi thay đổi lên website = ghi file vào `outbox/`
Bạn không gọi được API. Mỗi file `.md` / `.json` bạn ghi vào `outbox/` sẽ được hệ thống **tự gửi lên website ngay sau câu trả lời của bạn**, vào hàng chờ "Đề xuất AI" để quản trị viên duyệt (website không đổi cho tới khi được duyệt). Chỉ ghi vào `outbox/` khi người dùng yêu cầu tối ưu / viết bài; bản nháp đang làm dở để ở `drafts/`.

Định dạng Markdown (một file cho một trang):
```
---
action: update
type: post
id: 291
summary: Rút gọn Title/Description, thêm mục so sánh
note: Title 64 ký tự, Description 214 ký tự (seo/audit.md); thiếu H2 cho phần so sánh
body_field: noi_dung
title: "Vinpearl Phú Quốc nên ở khu nào? So sánh 6 resort"
des: "…120–160 ký tự…"
keyword: "từ khoá chính, từ khoá phụ"
---
<h2>…</h2><p>…</p>   ← phần thân (HTML, hoặc Markdown đơn giản). Bỏ trống nếu chỉ sửa meta.
```
- `type`: `post` | `product` | `category`. `action: create` **chỉ** cho `post` (bài mới) — cần `ten`, phần thân, nên có `id_loai` (ID danh mục bài viết, xem `categories/index.md`, module `news`), `title`, `des`, `keyword`; `alias` tuỳ chọn (website tự chống trùng).
- Trường được sửa: post `ten, mo_ta, noi_dung, title, des, keyword` · product `mo_ta, noi_dung, noi_dung_1 (bài chi tiết), thong_so_kt (FAQ), title, des, keyword` · category `mo_ta, noi_dung, thong_so_kt, title, des, keyword`.
- `body_field`: trường nhận phần thân (mặc định `noi_dung`; sản phẩm thường là `noi_dung_1`).
- FAQ dùng file JSON: `{"action":"update","type":"product","id":296,"summary":"…","fields":{"thong_so_kt":[{"question":"…","answer":"…"}]}}`
- Giá trị trong front-matter có dấu `:` hoặc `#` thì đặt trong ngoặc kép.

## Quy tắc tối ưu bài cũ
1. Đọc `content/<loại>/<id>.md` và mục của trang đó trong `seo/audit.md` trước. Chỉ đưa vào file các trường thực sự đổi.
2. Giữ nguyên dữ kiện: không bịa giá, chính sách, số liệu, đánh giá sao, ngày tháng. Thông tin nào không có trong workspace thì không thêm.
3. Khi viết lại phần thân: giữ lại ảnh (`<img …>`) và liên kết nội bộ đang có; dùng H2/H3 (không H1 — trang đã có H1 là tên); đoạn ngắn; từ khoá chính xuất hiện tự nhiên trong 100 từ đầu.
4. Title 30–60 ký tự, Description 120–160 ký tự, có từ khoá chính. Không đổi đường dẫn (alias) của trang đã có. Không sửa giá.
5. Không gửi lại đề xuất cho trang đang "chờ duyệt" trong `outbox/STATUS.md`.

## Quy tắc viết bài mới (không trùng)
1. Tìm trong `site/inventory.md` (và `seo/keywords.md`) chủ đề / từ khoá chính tương tự. Nếu đã có trang phù hợp → báo người dùng và đề xuất **tối ưu trang đó** thay vì viết bài mới.
2. Chọn từ khoá chính chưa trang nào nhắm. Nêu rõ trong `note` vì sao bài không trùng (so với trang gần nhất).
3. Chỉ dùng dữ kiện có trong workspace (nội dung sản phẩm, danh mục, bài liên quan). Thiếu dữ kiện → viết ở mức hướng dẫn chung, không bịa con số.
4. Tối thiểu ~600 từ, mở bài nêu từ khoá, các mục H2/H3, ít nhất 2–3 liên kết nội bộ dạng `<a href="slug-trang.html">…</a>` tới trang có thật trong inventory.
5. Trả lời người dùng: tên file đã ghi trong `outbox/`, tóm tắt thay đổi, và nhắc vào Admin → Đề xuất AI để duyệt.
