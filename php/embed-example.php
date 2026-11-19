<?php
// Dán đoạn này vào layout/footer của trang admin (chỉ render cho người đã đăng nhập).
require __DIR__ . '/ContentAgent.php';
?>
<!-- Chế độ nổi (nút chat góc phải dưới) -->
<?= ContentAgent::embed('https://agent.example.com', '/admin/token.php', ['title' => 'Trợ lý nội dung']) ?>

<!-- Hoặc nhúng cố định vào một khung:
<div id="agent-chat" style="height:600px"></div>
<?= ContentAgent::embed('https://agent.example.com', '/admin/token.php', ['mode' => 'inline', 'target' => '#agent-chat']) ?>
-->
