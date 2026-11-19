---
name: content-translation
description: Dịch và bản địa hoá nội dung website sang ngôn ngữ khác, giữ nguyên HTML và tối ưu SEO cho ngôn ngữ đích (title, description, từ khoá, slug, hreflang). Dùng cho website đa ngôn ngữ khi yêu cầu "dịch bài / sản phẩm / danh mục sang …".
---
# Dịch & bản địa hoá nội dung

**Trước khi dịch** xác định: ngôn ngữ nguồn (thường là ngôn ngữ chính của site), ngôn ngữ đích (người dùng không nói rõ → hỏi lại, đừng đoán), và trang nguồn (đọc `content/<loại>/<id>.md`). Kiểm tra `notes.md` xem site đã có bảng thuật ngữ / quy ước dịch chưa và dùng lại cho nhất quán.

## Quy tắc dịch
1. **Dịch ý, không dịch từng chữ**: câu văn tự nhiên như người bản ngữ viết; điều chỉnh thành ngữ, ví dụ, cách xưng hô, độ trang trọng theo thị trường đích.
2. **Giữ nguyên cấu trúc HTML**: mọi thẻ, thuộc tính, `<img src>`, `<iframe>`, bảng, class, thứ tự H2/H3. Chỉ dịch phần chữ nhìn thấy, cùng `alt` và `title` của ảnh / liên kết.
3. **Không đổi dữ kiện**: con số, giá, đơn vị tiền tệ, ngày tháng, số điện thoại, địa chỉ, tên riêng, tên thương hiệu / sản phẩm giữ nguyên. Không tự quy đổi tiền tệ hay đơn vị; nếu cần định dạng lại (dấu phân cách số, thứ tự ngày) thì chỉ đổi cách viết, không đổi giá trị.
4. **Không thêm, không bớt** ý so với bản gốc; không bịa nội dung cho đủ độ dài. Đoạn nào không chắc nghĩa → giữ gần nghĩa nhất và liệt kê trong ghi chú.
5. **Thuật ngữ nhất quán**: cùng một khái niệm dùng cùng một từ xuyên suốt; thuật ngữ mới đáng nhớ ghi thêm vào `notes.md` (bảng nguồn → đích).

## SEO cho ngôn ngữ đích
- Không dịch máy móc từ khoá: tìm cách người dùng ở ngôn ngữ đích thực sự gọi nó (ưu tiên từ khoá đã có trong `seo/keywords.md`). Chưa có dữ liệu thì chọn cách gọi phổ biến nhất bạn chắc chắn và **nói rõ là chưa kiểm chứng lượng tìm kiếm**; không bịa volume.
- Title và Description viết lại cho ngôn ngữ đích, vẫn trong giới hạn ký tự (title ≈ 30–60, description ≈ 120–160; ngôn ngữ CJK ngắn hơn khoảng một nửa), có từ khoá chính ở ngôn ngữ đích. KEYWORD: từ khoá chính trước, rồi 3–6 từ khoá phụ.
- Slug đích: đề xuất slug không dấu / ASCII (hoặc đúng quy ước site) theo từ khoá đích; **không đổi slug** của trang nguồn.
- Liên kết nội bộ: trỏ tới bản đã dịch của trang đích nếu có trong `site/inventory.md`; chưa có thì giữ liên kết tới trang gốc và ghi chú "chưa có bản dịch".
- hreflang: nếu website tự sinh (xem mục Đầu ra A) thì bỏ qua; nếu không, liệt kê cặp trang nguồn ↔ đích (URL / ID) để quản trị viên cấu hình, đừng tự thêm thẻ.

## Đầu ra
**A. Site là bản dịch của site khác** (system prompt có mục "Bản gốc để dịch"; vd. trợ lý tiếng Anh của một website tiếng Việt): bản gốc đọc ở workspace bản gốc, bản dịch là dòng cùng ID của ngôn ngữ đích trên cùng website.
- Đọc `<workspace bản gốc>/content/<loại>/<id>.md` và bản hiện có `content/<loại>/<id>.md` (có thể là bản dịch máy sơ bộ — viết lại cho tự nhiên, đừng chắp vá).
- Ghi MỘT file `outbox/` cho mỗi trang: `action: update`, cùng `type` và `id`, các trường `meta_title`, `meta_description`, `meta_keywords` và phần thân đã dịch (theo định dạng và trường được phép ở hướng dẫn outbox; sản phẩm: `excerpt`, `body`, `body_extra`, `faq` nếu có). Không tạo trang mới (`create`), không sửa slug.
- Trang chưa có bản của ngôn ngữ đích thì báo quản trị viên tạo ở tab ngôn ngữ trong admin, rồi mới dịch.
- hreflang / canonical do website tự sinh theo cặp ID — không cần làm; chỉ báo nếu thấy bất thường.

**B. Site không có bản gốc liên kết**: ghi `drafts/<slug-nguồn>.<mã-ngôn-ngữ>.md`, front-matter: `title`, `slug` (đề xuất), `meta_description`, `keywords`, `source_id`, `source_lang`, `target_lang`; thân là HTML đã dịch. Chỉ ghi `outbox/` khi người dùng cho biết website lưu mỗi ngôn ngữ ở đâu; không đè nội dung ngôn ngữ nguồn. Việc hreflang để quản trị viên cấu hình.

Cả hai trường hợp, trả lời ngắn: trang đã xử lý, từ khoá đích đã chọn, chỗ không chắc, thuật ngữ mới (đã ghi vào `notes.md`), việc quản trị viên cần làm. Nhiều trang: dịch lần lượt, tóm tắt trạng thái từng trang, không dịch quá ~5 trang một lượt.
