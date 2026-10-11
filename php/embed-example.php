<?php
// Dán đoạn này vào layout/footer của trang admin (chỉ render cho người đã đăng nhập).
require __DIR__ . '/AgyChat.php';
?>
<!-- Chế độ nổi (nút chat góc phải dưới) -->
<?= AgyChat::embed('https://agent.example.com', '/admin/agy-token.php', ['title' => 'Trợ lý nội dung']) ?>

<!-- Hoặc nhúng cố định vào một khung:
<div id="agy-chat" style="height:600px"></div>
<?= AgyChat::embed('https://agent.example.com', '/admin/agy-token.php', ['mode' => 'inline', 'target' => '#agy-chat']) ?>
-->
