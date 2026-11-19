<?php
/**
 * Display name and hosted service of this build. The open-source plugin has no default service
 * (self-hosters paste the backend config); a branded build (see scripts/build-wp-plugin.mjs) ships
 * a brand.php that defines both constants. Both can also be changed with filters:
 *
 *   define( 'CONTENT_AGENT_BRAND_NAME', 'My Content Agent' );
 *   define( 'CONTENT_AGENT_SERVICE_URL', 'https://agent-service.example.com' );
 *   add_filter( 'content_agent_service_url', fn () => 'https://staging.example.com' );
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Brand {

	public static function name(): string {
		$name = defined( 'CONTENT_AGENT_BRAND_NAME' ) ? (string) CONTENT_AGENT_BRAND_NAME : 'Content Agent';
		$name = (string) apply_filters( 'content_agent_brand_name', $name );
		return '' !== trim( $name ) ? $name : 'Content Agent';
	}

	/**
	 * Base URL of the hosted service that offers "Connect" (its web app, not the agent backend),
	 * or '' when this build has none. Only https (http for localhost while developing).
	 */
	public static function service_url(): string {
		$url = defined( 'CONTENT_AGENT_SERVICE_URL' ) ? (string) CONTENT_AGENT_SERVICE_URL : '';
		$url = (string) apply_filters( 'content_agent_service_url', $url );
		return self::secure_url( $url );
	}

	/** $url without trailing slash when it is https (or http on localhost), else ''. */
	public static function secure_url( string $url ): string {
		$u = wp_parse_url( $url );
		if ( empty( $u['host'] ) || ! empty( $u['user'] ) || ! empty( $u['pass'] ) ) {
			return '';
		}
		$local = in_array( $u['host'], array( 'localhost', '127.0.0.1', '::1', '[::1]' ), true );
		return ( 'https' === ( $u['scheme'] ?? '' ) || ( $local && 'http' === ( $u['scheme'] ?? '' ) ) ) ? untrailingslashit( $url ) : '';
	}
}
