<?php
/**
 * cms-content-agent integration for a PHP admin. No Composer needed, PHP >= 7.4.
 *
 * Token = base64url(JSON payload) . "." . base64url(HMAC-SHA256(phần đầu, secret))
 * Secret là `tokenSecret` của site trong config/sites.json trên backend; KHÔNG bao giờ gửi xuống trình duyệt.
 */
final class ContentAgent
{
    private static function b64u(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    /**
     * @param string $secret   tokenSecret của site
     * @param string $siteId   khoá site trong sites.json (vd "main")
     * @param string $uid      ID ổn định của quản trị viên đang đăng nhập (hội thoại gắn với uid này)
     * @param string $name     tên hiển thị (tuỳ chọn)
     * @param int    $ttl      thời hạn token (giây), nên 300–3600
     */
    public static function token(string $secret, string $siteId, string $uid, string $name = '', int $ttl = 900): string
    {
        $payload = self::b64u(json_encode(
            ['site' => $siteId, 'uid' => $uid, 'name' => $name, 'exp' => time() + $ttl],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));
        return $payload . '.' . self::b64u(hash_hmac('sha256', $payload, $secret, true));
    }

    /** Thẻ <script> nhúng widget. $tokenUrl là endpoint PHP trả {"token": "..."} (xem token.php). */
    public static function embed(string $agentBaseUrl, string $tokenUrl, array $opts = []): string
    {
        $attr = static fn(string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
        $html = '<script src="' . $attr(rtrim($agentBaseUrl, '/') . '/widget.js') . '"'
              . ' data-token-url="' . $attr($tokenUrl) . '"';
        foreach (['mode', 'target', 'title'] as $k) {
            if (isset($opts[$k])) {
                $html .= ' data-' . $k . '="' . $attr((string) $opts[$k]) . '"';
            }
        }
        return $html . '></script>';
    }
}
