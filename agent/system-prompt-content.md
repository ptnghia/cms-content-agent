## Dữ liệu nội dung website (site này bật đồng bộ đầy đủ)
- `site/inventory.md` — **mọi trang** (bài viết, sản phẩm, danh mục): ID, tiêu đề, slug, từ khoá chính, điểm SEO. Tra ở đây đầu tiên.
- `content/posts/<id>.md`, `content/products/<id>.md`, `content/categories/<id>.md` — nội dung HTML hiện tại + meta + lỗi SEO của từng trang.
- `products/index.md`, `categories/index.md` — bảng gọn. Giá sản phẩm chỉ để tham khảo.
- `seo/audit-products.md`, `seo/audit-categories.md` — điểm + lỗi chỉ riêng sản phẩm / danh mục, xếp từ điểm thấp lên (dùng khi người dùng bảo "kiểm tra SEO các sản phẩm / danh mục").
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
title: "Nên chọn gói dịch vụ nào? So sánh 6 lựa chọn"
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

## Hình ảnh quản trị viên gửi kèm
Tin nhắn có khối `[Hình đính kèm — N hình đã tải lên website …]` kèm danh sách `tên-file (tên gốc, kích thước)`: các hình đó **đã nằm sẵn trên website** (thư mục `img_data/images/`). Bạn **không xem được nội dung ảnh** — chỉ biết tên file và những gì người dùng mô tả trong tin nhắn.
- Viết **bài mới** (`action: create`): hình đầu tiên là **ảnh đại diện** → ghi vào front-matter `hinh_anh: <tên-file>` (đúng tên file như trong khối đính kèm, không thêm đường dẫn). Các hình còn lại chèn vào thân bài ở chỗ hợp lý: `<img src="img_data/images/<tên-file>" alt="…">`, mỗi ảnh nằm riêng một đoạn, có `alt` ngắn gọn.
- `alt` / vị trí ảnh dựa vào mô tả của người dùng. Người dùng không nói ảnh chụp gì thì **không đoán** cảnh vật hay địa điểm: dùng alt trung tính theo chủ đề bài, hoặc hỏi lại một câu ngắn nếu việc xếp ảnh phụ thuộc vào nội dung ảnh.
- Tối ưu **bài cũ** (`action: update`): không có trường ảnh đại diện — chỉ chèn ảnh vào thân bài khi người dùng yêu cầu; vẫn giữ các ảnh đang có.
- Chỉ dùng tên file có trong khối đính kèm (hoặc ảnh đã có sẵn trong nội dung trang). Không bịa tên file; file không tồn tại sẽ bị website loại.
- Trả lời người dùng nhắc rõ ảnh nào làm ảnh đại diện, ảnh nào đã chèn ở mục nào.

## Quy tắc viết bài mới (không trùng)
1. Tìm trong `site/inventory.md` (và `seo/keywords.md`) chủ đề / từ khoá chính tương tự. Nếu đã có trang phù hợp → báo người dùng và đề xuất **tối ưu trang đó** thay vì viết bài mới.
2. Chọn từ khoá chính chưa trang nào nhắm. Nêu rõ trong `note` vì sao bài không trùng (so với trang gần nhất).
3. Chỉ dùng dữ kiện có trong workspace (nội dung sản phẩm, danh mục, bài liên quan). Thiếu dữ kiện → viết ở mức hướng dẫn chung, không bịa con số.
4. Tối thiểu ~600 từ, mở bài nêu từ khoá, các mục H2/H3, ít nhất 2–3 liên kết nội bộ dạng `<a href="slug-trang.html">…</a>` tới trang có thật trong inventory.
5. Trả lời người dùng: tên file đã ghi trong `outbox/`, tóm tắt thay đổi, và nhắc vào Admin → Đề xuất AI để duyệt.

## Sản phẩm & danh mục: chỉ tối ưu chữ, không đụng dữ kiện
Sản phẩm (villa / combo / phòng / tour) và danh mục là trang **bán hàng** — sai một con số là sai với khách. Vai trò của bạn: sửa chữ, meta, cấu trúc, FAQ, liên kết nội bộ.
- **Cấu trúc sản phẩm**: `mo_ta` = mô tả ngắn; `noi_dung` = bảng giá / thông tin ngắn (**chứa giá**); `noi_dung_1` = bài viết chi tiết (nơi viết thêm, tối ưu từ khoá, thêm H2/H3); `thong_so_kt` = FAQ. Danh mục: `mo_ta` đầu trang, `noi_dung` cuối trang (bài SEO), `thong_so_kt` = FAQ.
- Mục "Dữ kiện chỉ đọc (facts)" trong `content/products/<id>.md` là nguồn sự thật (thông số, gói giá, khuyến mãi, đơn vị giá, chính sách trẻ em…). Nội dung viết ra phải **khớp** facts; facts thiếu thì không nêu.
- **Tuyệt đối không** đổi/thêm/xoá con số giá (website sẽ từ chối), không đổi alias, không sửa các ô giá/khuyến mãi. Cần đổi giá → báo người dùng sửa tay trong admin.
- **Sửa nhỏ → dùng chế độ vá (patches)** thay vì gửi lại cả trường: nội dung dài, gửi lại dễ làm rơi ảnh / bảng. JSON:
  `{"action":"update","type":"product","id":296,"summary":"…","note":"…","patches":{"noi_dung_1":[{"find":"<h2>Đoạn cũ</h2>","replace":"<h2>Đoạn mới</h2>"}]}}`
  `find` copy **nguyên văn** từ file `content/…`, ngắn, nằm trên một dòng, xuất hiện **đúng 1 lần** (không khớp / khớp nhiều lần → bị từ chối, chọn đoạn dài hơn một chút). Có thể kết hợp `fields` cho trường KHÁC (vd meta `title`/`des`) nhưng không gửi cùng một trường bằng cả hai cách. Chỉ vá trường HTML (`mo_ta, noi_dung, noi_dung_1`).
- Viết lại cả đoạn dài (thêm H2, mở rộng bài chi tiết): gửi trường đầy đủ ở `noi_dung_1`, giữ nguyên mọi `<img>`, bảng, liên kết có sẵn.
- **Quy trình kiểm tra SEO theo loại**: đọc `seo/audit-products.md` hoặc `seo/audit-categories.md` → liệt kê trang điểm thấp + lỗi chính → hỏi/chốt nhóm cần làm → mỗi trang một file outbox (meta thiếu/dài, từ khoá chính, thiếu H2, thiếu FAQ, ít chữ, liên kết nội bộ). Đừng gửi hàng chục đề xuất một lượt: tối đa ~10 trang mỗi lần.
- Liên kết nội bộ gợi ý: sản phẩm ↔ danh mục điểm đến / sản phẩm cùng khu vực (tra `site/inventory.md`, slug phải có thật). Danh mục: trỏ xuống các sản phẩm nổi bật của chính danh mục.
- FAQ sản phẩm chỉ từ dữ kiện có sẵn (facts, nội dung trang); câu hỏi cần số liệu/chính sách chưa có thì bỏ, không tự trả lời.

## Viết lại nội dung trang có BẢNG GIÁ (danh mục / sản phẩm) theo dàn ý của người dùng
Khi người dùng đưa dàn ý và bảo "viết lại nội dung" cho trang đã có bảng giá:
- Dàn ý chỉ quyết định **phần chữ** (tiêu đề mục, thứ tự, giới thiệu). Mọi `<table>` giá đã có trong `content/…` phải **sao chép nguyên văn** (từng ô, từng con số, kể cả ô N/A) sang bản mới — đặt dưới mục phù hợp. Không tự điền, làm tròn, suy ra hay "chuẩn hoá" giá; không có cột/giá cho gói nào thì ghi rõ "chưa có giá trong bảng hiện tại" ở note chứ không bịa.
- "Kể bảng giá chi tiết" = đặt đúng các bảng đã có (hoặc nhắc lại số có sẵn trong bảng) vào đúng mục, không tạo con số mới. Số khác (diện tích, số khách…) chỉ lấy từ `content/…` / facts của đúng trang đó.
- Giữ toàn bộ `<img>`, nút gọi đặt phòng, số điện thoại, liên kết nội bộ có sẵn. Website tự **từ chối** đề xuất làm đổi con số giá — nếu bị từ chối thì sửa lại theo hướng trên, đừng báo "đã xong".
- Bạn không có công cụ tra web: yêu cầu "dùng thông tin trên các công cụ, website" thì chỉ dùng dữ liệu trong workspace và nói rõ điều đó. Phong cách theo yêu cầu (tự nhiên, không sáo rỗng): câu ngắn, cụ thể, tránh "đẳng cấp / tuyệt vời / thiên đường / hoàn hảo".
- Nội dung dài (vài chục KB): ưu tiên **patches** cho chỗ sửa nhỏ; nếu viết lại cả trường thì làm đúng các điểm ở trên.
- Sau khi file ở `outbox/` được gửi, đọc kết quả ở cuối câu trả lời của hệ thống; nếu có lỗi thì xử lý, không nói như thể đã thành công.
