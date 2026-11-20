<?php
/**
 * REST API used by the cms-content-agent backend: /wp-json/content-agent/v1/…
 * Authenticated with `Authorization: Bearer <api_key>` (Settings → Content Agent). Contract: docs/SITE_API.md.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Rest {

	const NS = 'content-agent/v1';

	public static function register(): void {
		$auth = array( self::class, 'authorize' );
		$page = array(
			'page'     => array(
				'type'    => 'integer',
				'default' => 1,
				'minimum' => 1,
			),
			'per_page' => array(
				'type'    => 'integer',
				'default' => 100,
				'minimum' => 1,
				'maximum' => 100,
			),
			'include'  => array(
				'type'    => 'string',
				'default' => '',
			),
		);
		$list = static function ( callable $fn ) {
			return static function ( \WP_REST_Request $r ) use ( $fn ) {
				return rest_ensure_response( $fn( (int) $r['page'], (int) $r['per_page'], 'content' === $r['include'] ) );
			};
		};

		register_rest_route(
			self::NS,
			'/posts',
			array(
				'methods'             => 'GET',
				'callback'            => $list( array( Content::class, 'list_posts' ) ),
				'permission_callback' => $auth,
				'args'                => $page,
			)
		);
		register_rest_route(
			self::NS,
			'/products',
			array(
				'methods'             => 'GET',
				'callback'            => $list( array( Content::class, 'list_products' ) ),
				'permission_callback' => $auth,
				'args'                => $page,
			)
		);
		register_rest_route(
			self::NS,
			'/categories',
			array(
				'methods'             => 'GET',
				'callback'            => $list( array( Content::class, 'list_terms' ) ),
				'permission_callback' => $auth,
				'args'                => $page,
			)
		);
		register_rest_route(
			self::NS,
			'/seo',
			array(
				'methods'             => 'GET',
				'callback'            => static fn( \WP_REST_Request $r ) => rest_ensure_response( Audit::run( (bool) $r['fresh'] ) ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NS,
			'/keywords',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'keywords' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NS,
			'/schema',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'schema' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NS,
			'/proposals',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => static fn() => rest_ensure_response( array( 'items' => array_map( array( Proposals::class, 'public_item' ), Proposals::query( '', 1, 50 )['items'] ) ) ),
					'permission_callback' => $auth,
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'create_proposal' ),
					'permission_callback' => $auth,
				),
			)
		);
		register_rest_route(
			self::NS,
			'/ping',
			array(
				'methods'             => 'GET',
				'callback'            => static fn() => rest_ensure_response(
					array(
						'ok'       => true,
						'plugin'   => CONTENT_AGENT_VERSION,
						'site_id'  => Settings::get( 'site_id' ),
						'features' => Settings::features(),
					)
				),
				'permission_callback' => $auth,
			)
		);
	}

	/** Bearer api_key, compared in constant time. */
	public static function authorize( \WP_REST_Request $r ) {
		$key    = (string) Settings::get( 'api_key' );
		$header = (string) $r->get_header( 'authorization' );
		$given  = preg_match( '/^Bearer\s+(.+)$/i', $header, $m ) ? trim( $m[1] ) : '';
		if ( strlen( $key ) >= 32 && '' !== $given && hash_equals( $key, $given ) ) {
			return true;
		}
		return new \WP_Error( 'content_agent_unauthorized', 'Invalid or missing API key', array( 'status' => 401 ) );
	}

	public static function create_proposal( \WP_REST_Request $r ) {
		$body = $r->get_json_params();
		$res  = Proposals::create( is_array( $body ) ? $body : array() );
		if ( is_wp_error( $res ) ) {
			$data = (array) $res->get_error_data();
			return new \WP_REST_Response(
				array(
					'error' => array(
						'message' => $res->get_error_message(),
						'details' => $data['details'] ?? array(),
					),
				),
				$data['status'] ?? 422
			);
		}
		return new \WP_REST_Response(
			array(
				'data' => array(
					'id'         => $res['id'],
					'status'     => 'pending',
					'warnings'   => $res['warnings'],
					'fields'     => $res['fields'],
					'review_url' => Proposals::review_url( $res['id'] ),
				),
			),
			201
		);
	}

	/** Focus keywords already assigned to pages (the site's de-facto keyword bank). */
	public static function keywords() {
		$items = array();
		$add   = static function ( string $kw, string $slug, string $kind ) use ( &$items ) {
			foreach ( array_filter( array_map( 'trim', explode( ',', $kw ) ) ) as $i => $k ) {
				$items[] = array(
					'keyword'     => $k,
					'group'       => $kind,
					'intent'      => '',
					'target_slug' => $slug,
					'priority'    => 0 === $i ? 1 : 2,
					'status'      => 0 === $i ? 'focus' : 'secondary',
				);
			}
		};
		$posts = get_posts(
			array(
				'post_type'      => array_merge( array( 'post', 'page' ), Content::has_woo() ? array( 'product' ) : array() ),
				'post_status'    => 'publish',
				'posts_per_page' => Audit::MAX_ITEMS,
			)
		);
		foreach ( $posts as $p ) {
			$add( Seo::get_post( $p->ID )['meta_keywords'], $p->post_name, $p->post_type );
		}
		$terms = get_terms(
			array(
				'taxonomy'   => Content::taxonomies(),
				'hide_empty' => false,
			)
		);
		foreach ( is_array( $terms ) ? $terms : array() as $t ) {
			$add( Seo::get_term( $t )['meta_keywords'], $t->slug, 'category' );
		}
		return rest_ensure_response( array( 'items' => $items ) );
	}

	/** What the agent may change on this site; written to site/fields.md by the backend. */
	public static function schema() {
		return rest_ensure_response(
			array(
				'cms'          => 'wordpress',
				'version'      => get_bloginfo( 'version' ),
				'plugin'       => CONTENT_AGENT_VERSION,
				'seo_provider' => Seo::label(),
				'woocommerce'  => Content::has_woo(),
				'types'        => Content::schema(),
				'notes'        => array_values(
					array_filter(
						array(
							'New posts and pages are created as drafts; an editor publishes them.',
							'HTML bodies are converted to Gutenberg blocks (paragraph, heading, list; other elements become Custom HTML blocks).',
							Content::has_woo() ? 'Products: excerpt = short description, body = description. Prices, SKU, stock and attributes are read-only facts.' : '',
							'Categories: body = category description.',
							'yoast' === Seo::provider() ? 'Yoast SEO stores a single focus keyword: only the first keyword of meta_keywords is kept.' : '',
						)
					)
				),
			)
		);
	}
}
