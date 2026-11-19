<?php
/**
 * Short-lived widget token, verified by the backend (server/auth.mjs):
 *   base64url(JSON {site, uid, name, exp}) . "." . base64url(HMAC-SHA256(first part, tokenSecret))
 * No WordPress dependency so it can be tested from the command line.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Token {

	private static function b64u( string $bin ): string {
		return rtrim( strtr( base64_encode( $bin ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}

	/**
	 * @param string $secret  tokenSecret shared with the backend.
	 * @param string $site_id Site id in the backend's config/sites.json.
	 * @param string $uid     Stable id of the logged-in user (conversations belong to it).
	 * @param string $name    Display name.
	 * @param int    $ttl     Lifetime in seconds (backend accepts at most 24h).
	 */
	public static function sign( string $secret, string $site_id, string $uid, string $name = '', int $ttl = 900 ): string {
		$payload = self::b64u(
			(string) json_encode(
				array(
					'site' => $site_id,
					'uid'  => $uid,
					'name' => $name,
					'exp'  => time() + $ttl,
				),
				JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
			)
		);
		return $payload . '.' . self::b64u( hash_hmac( 'sha256', $payload, $secret, true ) );
	}
}
