<?php
/**
 * SEO audit of every published post, page, product and category (GET /seo).
 * Uses the SEO plugin's score when there is one, otherwise a score derived from the issues found.
 * Cached for 10 minutes; the cache is dropped whenever a proposal is applied or reverted.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Audit {

	const CACHE     = 'content_agent_audit';
	const TITLE     = array( 30, 60 );
	const DESC      = array( 120, 160 );
	const MIN_WORDS = array(
		'post'     => 600,
		'page'     => 300,
		'product'  => 150,
		'category' => 80,
	);
	const MAX_ITEMS = 3000;

	public static function flush(): void {
		delete_transient( self::CACHE );
	}

	/** Cached score of one item, or null when no audit has run yet (listings must stay cheap). */
	public static function score_for( string $kind, int $id ): ?int {
		$cached = get_transient( self::CACHE );
		if ( ! is_array( $cached ) ) {
			return null;
		}
		foreach ( $cached['scores'] as $s ) {
			if ( $s['id'] === $id && $s['kind'] === $kind ) {
				return $s['score'];
			}
		}
		return null;
	}

	public static function run( bool $fresh = false ): array {
		$cached = $fresh ? false : get_transient( self::CACHE );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$scores = array();
		$issues = array();
		$add    = static function ( array $page, array $found, ?int $plugin_score ) use ( &$scores, &$issues ) {
			$penalty = 0;
			foreach ( $found as $f ) {
				$issues[] = array(
					'kind'    => $page['kind'],
					'id'      => $page['id'],
					'title'   => $page['title'],
					'level'   => $f[0],
					'message' => $f[1],
				);
				$penalty += array(
					'error'   => 15,
					'warning' => 7,
					'info'    => 2,
				)[ $f[0] ];
			}
			$scores[] = array(
				'kind'          => $page['kind'],
				'id'            => $page['id'],
				'title'         => $page['title'],
				'score'         => null !== $plugin_score ? $plugin_score : max( 0, 100 - $penalty ),
				'focus_keyword' => $page['focus_keyword'],
				'words'         => $page['words'],
			);
		};

		$posts = get_posts(
			array(
				'post_type'      => array_merge( array( 'post', 'page' ), Content::has_woo() ? array( 'product' ) : array() ),
				'post_status'    => 'publish',
				'posts_per_page' => self::MAX_ITEMS,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		foreach ( $posts as $p ) {
			$seo   = Seo::get_post( $p->ID );
			$html  = $p->post_content . ( 'product' === $p->post_type ? ' ' . $p->post_excerpt : '' );
			$words = Content::word_count( $html );
			$page  = array(
				'kind'          => $p->post_type,
				'id'            => $p->ID,
				'title'         => get_the_title( $p ),
				'focus_keyword' => $seo['focus_keyword'],
				'words'         => $words,
			);
			$add( $page, self::check( $p->post_type, get_the_title( $p ), Blocks::strip( $html ), $words, $seo ), $seo['score'] );
		}

		$terms = get_terms(
			array(
				'taxonomy'   => Content::taxonomies(),
				'hide_empty' => true,
				'number'     => self::MAX_ITEMS,
			)
		);
		foreach ( is_array( $terms ) ? $terms : array() as $t ) {
			$seo   = Seo::get_term( $t );
			$words = Content::word_count( $t->description );
			$page  = array(
				'kind'          => 'category',
				'id'            => $t->term_id,
				'title'         => $t->name,
				'focus_keyword' => $seo['focus_keyword'],
				'words'         => $words,
			);
			$add( $page, self::check( 'category', $t->name, $t->description, $words, $seo ), $seo['score'] );
		}

		usort( $scores, static fn( $a, $b ) => $a['score'] <=> $b['score'] );
		$summary = array(
			'error'   => 0,
			'warning' => 0,
			'info'    => 0,
		);
		foreach ( $issues as $i ) {
			++$summary[ $i['level'] ];
		}
		$result = array(
			'generated_at' => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'provider'     => Seo::provider(),
			'pages'        => count( $scores ),
			'avg_score'    => $scores ? (int) round( array_sum( array_column( $scores, 'score' ) ) / count( $scores ) ) : 0,
			'summary'      => $summary,
			'rules'        => array(
				'title'       => self::TITLE,
				'description' => self::DESC,
				'min_words'   => self::MIN_WORDS,
			),
			'scores'       => $scores,
			'issues'       => $issues,
		);
		set_transient( self::CACHE, $result, 10 * MINUTE_IN_SECONDS );
		return $result;
	}

	/** @return array<int, array{0:string,1:string}> [level, message] */
	public static function check( string $kind, string $name, string $html, int $words, array $seo ): array {
		$out   = array();
		$len   = static fn( $s ) => function_exists( 'mb_strlen' ) ? mb_strlen( $s ) : strlen( $s );
		$title = trim( $seo['meta_title'] );
		$desc  = trim( $seo['meta_description'] );
		$kw    = trim( $seo['focus_keyword'] );

		if ( '' === $title ) {
			$out[] = array( 'warning', 'No SEO title (the page name is used)' );
		} elseif ( false === strpos( $title, '%%' ) && ( $len( $title ) < self::TITLE[0] || $len( $title ) > self::TITLE[1] ) ) {
			$out[] = array( 'warning', sprintf( 'SEO title is %d characters (recommended %d–%d)', $len( $title ), self::TITLE[0], self::TITLE[1] ) );
		}
		if ( '' === $desc ) {
			$out[] = array( 'error', 'No meta description' );
		} elseif ( false === strpos( $desc, '%%' ) && ( $len( $desc ) < self::DESC[0] || $len( $desc ) > self::DESC[1] ) ) {
			$out[] = array( 'warning', sprintf( 'Meta description is %d characters (recommended %d–%d)', $len( $desc ), self::DESC[0], self::DESC[1] ) );
		}
		if ( '' === $kw ) {
			$out[] = array( 'warning', 'No focus keyword' );
		} else {
			$haystack = function_exists( 'mb_strtolower' ) ? mb_strtolower( ( '' !== $title ? $title : $name ) . ' ' . wp_strip_all_tags( $html ) ) : strtolower( $title . ' ' . $html );
			$needle   = function_exists( 'mb_strtolower' ) ? mb_strtolower( $kw ) : strtolower( $kw );
			if ( false === strpos( $haystack, $needle ) ) {
				$out[] = array( 'warning', sprintf( 'Focus keyword "%s" does not appear in the title or content', $kw ) );
			}
		}
		$min = self::MIN_WORDS[ $kind ] ?? 300;
		if ( $words < $min ) {
			$out[] = array( 'warning', sprintf( 'Thin content: %d words (minimum %d)', $words, $min ) );
		}
		if ( in_array( $kind, array( 'post', 'page' ), true ) && $words >= 300 && ! preg_match( '/<h2[\s>]/i', $html ) ) {
			$out[] = array( 'info', 'No H2 headings' );
		}
		if ( preg_match( '/<h1[\s>]/i', $html ) ) {
			$out[] = array( 'info', 'Content contains an H1 (the page title is already the H1)' );
		}
		$no_alt = preg_match_all( '/<img(?![^>]*\balt="[^"]+")[^>]*>/i', $html );
		if ( $no_alt ) {
			$out[] = array( 'warning', sprintf( '%d image(s) without alt text', $no_alt ) );
		}
		return $out;
	}
}
