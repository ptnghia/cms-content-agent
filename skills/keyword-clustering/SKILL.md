---
name: keyword-clustering
description: Gom nhóm danh sách từ khoá theo chủ đề và gán trang đích, phát hiện từ khoá cạnh tranh nội bộ (cannibalization). Dùng khi người dùng đưa danh sách từ khoá hoặc hỏi về phân bổ từ khoá.
---
# Gom nhóm từ khoá

1. Chuẩn hoá: bỏ trùng, gộp biến thể (dấu, số ít / nhiều, thứ tự từ).
2. Gom theo **ý định tìm kiếm** chung (cùng một trang trả lời được), không chỉ theo từ giống nhau. Mỗi cụm: từ khoá chính (đại diện, ngắn và tự nhiên nhất) + từ khoá phụ.
3. Phân loại cụm: thông tin (bài viết) · so sánh / cân nhắc (bài so sánh, danh mục) · mua hàng (sản phẩm, danh mục).
4. Gán trang đích: đối chiếu `seo/keywords.md` và `site/inventory.md`. Cụm đã có trang → ghi ID trang; chưa có → đề xuất loại trang mới. Hai trang cùng nhắm một từ khoá chính → cảnh báo cannibalization và đề xuất giữ trang nào, chuyển trang kia sang từ khoá khác.
5. Kết quả dạng bảng: cụm | từ khoá chính | từ khoá phụ | loại ý định | trang đích (ID / đề xuất mới) | ghi chú. Không đưa volume / độ khó nếu người dùng không cung cấp.
