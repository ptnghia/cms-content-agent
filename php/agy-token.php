<?php
/**
 * Endpoint cấp token cho widget. Đặt trong khu vực admin (đã đăng nhập), vd /admin/agy-token.php
 * Widget gọi endpoint này (cùng origin, kèm cookie phiên) để lấy token ngắn hạn.
 */
require __DIR__ . '/AgyChat.php';

// TODO: thay bằng cơ chế xác thực admin thực tế của bạn.
session_start();
if (empty($_SESSION['admin_id'])) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$secret = getenv('AGY_TOKEN_SECRET');   // = tokenSecret của site trong config/sites.json
if (!$secret) {
    http_response_code(500);
    exit;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['token' => AgyChat::token(
    $secret,
    'main',                                    // siteId
    (string) $_SESSION['admin_id'],            // uid
    (string) ($_SESSION['admin_name'] ?? ''),  // tên hiển thị
    900                                        // TTL giây
)]);
