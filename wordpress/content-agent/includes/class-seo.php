<?php
/**
 * SEO meta adapter: Yoast SEO, Rank Math, or the plugin's own fields when neither is active.
 * Canonical names: meta_title, meta_description, meta_keywords (focus keyword first, comma separated).
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Seo {

	const NATIVE = array(
		'meta_title'       => '_content_agent_meta_title',
		'meta_description' => '_content_agent_meta_description',
		'meta_keywords'    => '_content_agent_meta_keywords',
	);

	public static function provider(): string {
		if ( defined( 'WPSEO_VERSION' ) ) {
			return 'yoast';
		}
		if ( defined( 'RANK_MATH_VERSION' ) ) {
			return 'rankmath';
		}
		return 'native';
	}

	public static function label(): string {
		$labels = array(
			'yoast'    => 'Yoast SEO',
			'rankmath' => 'Rank Math',
			'native'   => __( 'Content Agent (built-in SEO fields)', 'content-agent' ),
		);
		return $labels[ self::provider() ];
	}

	/** @return array{meta_title:string,meta_description:string,meta_keywords:string,focus_keyword:string,score:?int} */
	public static function get_post( int $id ): array {
		switch ( self::provider() ) {
			case 'yoast':
				$kw    = (string) get_post_meta( $id, '_yoast_wpseo_focuskw', true );
				$score = get_post_meta( $id, '_yoast_wpseo_linkdex', true );
				return self::pack( get_post_meta( $id, '_yoast_wpseo_title', true ), get_post_meta( $id, '_yoast_wpseo_metadesc', true ), $kw, $score );
			case 'rankmath':
				$score = get_post_meta( $id, 'rank_math_seo_score', true );
				return self::pack( get_post_meta( $id, 'rank_math_title', true ), get_post_meta( $id, 'rank_math_description', true ), get_post_meta( $id, 'rank_math_focus_keyword', true ), $score );
			default:
				return self::pack( get_post_meta( $id, self::NATIVE['meta_title'], true ), get_post_meta( $id, self::NATIVE['meta_description'], true ), get_post_meta( $id, self::NATIVE['meta_keywords'], true ), null );
		}
	}

	public static function set_post( int $id, array $vals ): void {
		$map = self::post_keys();
		foreach ( $map as $field => $key ) {
			if ( ! array_key_exists( $field, $vals ) ) {
				continue;
			}
			$value = (string) $vals[ $field ];
			if ( 'meta_keywords' === $field && 'yoast' === self::provider() ) {
				$value = self::first_keyword( $value ); // Yoast (free) has a single focus keyword.
			}
			if ( '' === $value ) {
				delete_post_meta( $id, $key );
			} else {
				update_post_meta( $id, $key, $value );
			}
		}
	}

	/** @return array{meta_title:string,meta_description:string,meta_keywords:string,focus_keyword:string,score:?int} */
	public static function get_term( \WP_Term $t ): array {
		switch ( self::provider() ) {
			case 'yoast':
				$all = get_option( 'wpseo_taxonomy_meta', array() );
				$m   = isset( $all[ $t->taxonomy ][ $t->term_id ] ) ? (array) $all[ $t->taxonomy ][ $t->term_id ] : array();
				return self::pack( $m['wpseo_title'] ?? '', $m['wpseo_desc'] ?? '', $m['wpseo_focuskw'] ?? '', $m['wpseo_linkdex'] ?? null );
			case 'rankmath':
				return self::pack( get_term_meta( $t->term_id, 'rank_math_title', true ), get_term_meta( $t->term_id, 'rank_math_description', true ), get_term_meta( $t->term_id, 'rank_math_focus_keyword', true ), get_term_meta( $t->term_id, 'rank_math_seo_score', true ) );
			default:
				return self::pack( get_term_meta( $t->term_id, self::NATIVE['meta_title'], true ), get_term_meta( $t->term_id, self::NATIVE['meta_description'], true ), get_term_meta( $t->term_id, self::NATIVE['meta_keywords'], true ), null );
		}
	}

	public static function set_term( \WP_Term $t, array $vals ): void {
		if ( 'yoast' === self::provider() ) {
			$all  = get_option( 'wpseo_taxonomy_meta', array() );
			$all  = is_array( $all ) ? $all : array();
			$cur  = isset( $all[ $t->taxonomy ][ $t->term_id ] ) ? (array) $all[ $t->taxonomy ][ $t->term_id ] : array();
			$keys = array(
				'meta_title'       => 'wpseo_title',
				'meta_description' => 'wpseo_desc',
				'meta_keywords'    => 'wpseo_focuskw',
			);
			foreach ( $keys as $field => $key ) {
				if ( array_key_exists( $field, $vals ) ) {
					$cur[ $key ] = 'meta_keywords' === $field ? self::first_keyword( (string) $vals[ $field ] ) : (string) $vals[ $field ];
				}
			}
			$all[ $t->taxonomy ][ $t->term_id ] = $cur;
			update_option( 'wpseo_taxonomy_meta', $all );
			return;
		}
		$keys = 'rankmath' === self::provider()
			? array(
				'meta_title'       => 'rank_math_title',
				'meta_description' => 'rank_math_description',
				'meta_keywords'    => 'rank_math_focus_keyword',
			)
			: self::NATIVE;
		foreach ( $keys as $field => $key ) {
			if ( array_key_exists( $field, $vals ) ) {
				update_term_meta( $t->term_id, $key, (string) $vals[ $field ] );
			}
		}
	}

	private static function post_keys(): array {
		switch ( self::provider() ) {
			case 'yoast':
				return array(
					'meta_title'       => '_yoast_wpseo_title',
					'meta_description' => '_yoast_wpseo_metadesc',
					'meta_keywords'    => '_yoast_wpseo_focuskw',
				);
			case 'rankmath':
				return array(
					'meta_title'       => 'rank_math_title',
					'meta_description' => 'rank_math_description',
					'meta_keywords'    => 'rank_math_focus_keyword',
				);
			default:
				return self::NATIVE;
		}
	}

	private static function pack( $title, $desc, $keywords, $score ): array {
		$keywords = trim( (string) $keywords );
		return array(
			'meta_title'       => (string) $title,
			'meta_description' => (string) $desc,
			'meta_keywords'    => $keywords,
			'focus_keyword'    => self::first_keyword( $keywords ),
			'score'            => ( '' === $score || null === $score || false === $score ) ? null : max( 0, min( 100, (int) $score ) ),
		);
	}

	public static function first_keyword( string $keywords ): string {
		$parts = array_filter( array_map( 'trim', explode( ',', $keywords ) ) );
		return $parts ? (string) reset( $parts ) : '';
	}

	/** Without an SEO plugin, print the built-in fields on the front end. */
	public static function hooks(): void {
		add_action(
			'wp',
			static function () {
				if ( 'native' !== self::provider() || is_admin() ) {
					return;
				}
				$meta = self::current_meta();
				if ( ! $meta ) {
					return;
				}
				if ( '' !== $meta['meta_title'] ) {
					// pre_get_document_title output is printed without escaping by core.
					add_filter( 'pre_get_document_title', static fn() => esc_html( $meta['meta_title'] ), 20 );
				}
				if ( '' !== $meta['meta_description'] ) {
					add_action(
						'wp_head',
						static function () use ( $meta ) {
							echo '<meta name="description" content="' . esc_attr( $meta['meta_description'] ) . '">' . "\n";
						},
						1
					);
				}
			}
		);
	}

	private static function current_meta(): ?array {
		if ( is_singular() ) {
			return self::get_post( (int) get_queried_object_id() );
		}
		if ( is_category() || is_tag() || is_tax() ) {
			$t = get_queried_object();
			return $t instanceof \WP_Term ? self::get_term( $t ) : null;
		}
		return null;
	}
}
