<?php
/**
 * Plugin settings (one option) and the matching backend config snippet.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Settings {

	const OPTION = 'content_agent_settings';

	public static function defaults(): array {
		return array(
			'backend_url'    => '',
			'site_id'        => self::default_site_id(),
			'token_secret'   => '',
			'api_key'        => '',
			'widget_enabled' => true,
			'capability'     => 'edit_posts',
			'assistant_name' => '',
		);
	}

	public static function get( ?string $key = null ) {
		$s = wp_parse_args( (array) get_option( self::OPTION, array() ), self::defaults() );
		return null === $key ? $s : ( $s[ $key ] ?? null );
	}

	public static function update( array $changes ): void {
		update_option( self::OPTION, array_merge( self::get(), $changes ), false );
	}

	/** Secrets are generated on activation and can be rotated from the settings page. */
	public static function activate(): void {
		$s = self::get();
		if ( strlen( (string) $s['token_secret'] ) < 32 ) {
			$s['token_secret'] = self::random();
		}
		if ( strlen( (string) $s['api_key'] ) < 32 ) {
			$s['api_key'] = self::random();
		}
		update_option( self::OPTION, $s, false );
		Proposals::register();
		flush_rewrite_rules();
	}

	public static function random(): string {
		return bin2hex( random_bytes( 32 ) );
	}

	public static function default_site_id(): string {
		$host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$id   = trim( preg_replace( '/[^a-z0-9_-]+/', '-', strtolower( $host ) ), '-' );
		return substr( $id ? $id : 'wordpress', 0, 40 );
	}

	public static function is_connected(): bool {
		$s = self::get();
		return '' !== $s['backend_url'] && strlen( $s['token_secret'] ) >= 32 && strlen( $s['api_key'] ) >= 32;
	}

	/** Features this site's API offers, given the active plugins. */
	public static function features(): array {
		$f = array( 'content', 'categories', 'keywords', 'seo', 'proposals', 'schema' );
		if ( class_exists( 'WooCommerce' ) ) {
			array_splice( $f, 1, 0, 'products' );
		}
		return $f;
	}

	/** Entry for the backend's config/sites.json. */
	public static function backend_snippet(): array {
		$s       = self::get();
		$origin  = self::origin( admin_url() );
		$origins = array_values( array_unique( array_filter( array( $origin, self::origin( home_url() ) ) ) ) );
		$lang    = substr( get_locale(), 0, 2 );
		return array(
			$s['site_id'] => array(
				'name'           => get_bloginfo( 'name' ),
				'language'       => $lang ? $lang : 'en',
				'tokenSecret'    => $s['token_secret'],
				'allowedOrigins' => $origins,
				'api'            => array(
					'base'     => rest_url( 'content-agent/v1' ),
					'key'      => $s['api_key'],
					'features' => self::features(),
				),
			),
		);
	}

	public static function origin( string $url ): string {
		$p = wp_parse_url( $url );
		if ( empty( $p['scheme'] ) || empty( $p['host'] ) ) {
			return '';
		}
		return $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . $p['port'] : '' );
	}
}
