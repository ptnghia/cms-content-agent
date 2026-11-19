<?php
/**
 * Content model: posts, pages, WooCommerce products and categories as the backend expects them
 * (docs/SITE_API.md), plus reading/writing canonical fields on a single item.
 *
 * Canonical fields per type (what the agent may propose):
 *   post, page : name, excerpt, body, meta_title, meta_description, meta_keywords
 *                create only: slug, featured_image (+ category_id for posts)
 *   product    : excerpt (short description), body (description), meta_*
 *   category   : body (description), meta_*          — post categories and WooCommerce product categories
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Content {

	const META   = array( 'meta_title', 'meta_description', 'meta_keywords' );
	const HTML   = array( 'excerpt', 'body' );
	const STATUS = array(
		'publish' => 'published',
		'future'  => 'scheduled',
		'draft'   => 'draft',
		'pending' => 'pending',
		'private' => 'private',
	);

	public static function schema(): array {
		$meta = self::META;
		$s    = array(
			'post'     => array(
				'label'    => __( 'Post', 'content-agent' ),
				'editable' => array_merge( array( 'name', 'excerpt', 'body' ), $meta ),
				'create'   => array( 'slug', 'category_id', 'featured_image' ),
			),
			'page'     => array(
				'label'    => __( 'Page', 'content-agent' ),
				'editable' => array_merge( array( 'name', 'excerpt', 'body' ), $meta ),
				'create'   => array( 'slug', 'featured_image' ),
			),
			'category' => array(
				'label'    => __( 'Category', 'content-agent' ),
				'editable' => array_merge( array( 'body' ), $meta ),
				'create'   => array(),
			),
		);
		if ( self::has_woo() ) {
			$s['product'] = array(
				'label'    => __( 'Product', 'content-agent' ),
				'editable' => array_merge( array( 'excerpt', 'body' ), $meta ),
				'create'   => array(),
			);
		}
		return $s;
	}

	public static function has_woo(): bool {
		return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_product' );
	}

	public static function iso( string $gmt ): ?string {
		return ( '' === $gmt || 0 === strpos( $gmt, '0000' ) ) ? null : gmdate( 'Y-m-d\TH:i:s\Z', strtotime( $gmt . ' UTC' ) );
	}

	public static function word_count( string $html ): int {
		$text = wp_strip_all_tags( Blocks::strip( $html ) );
		return (int) preg_match_all( '/[\p{L}\p{N}][\p{L}\p{N}\'’-]*/u', $text );
	}

	// ---------------------------------------------------------------- listings

	/** Posts and pages, all statuses the agent should know about. */
	public static function list_posts( int $page, int $per_page, bool $with_content ): array {
		$q = new \WP_Query(
			array(
				'post_type'              => array( 'post', 'page' ),
				'post_status'            => array_keys( self::STATUS ),
				'posts_per_page'         => $per_page,
				'paged'                  => $page,
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'ignore_sticky_posts'    => true,
				'update_post_term_cache' => true,
			)
		);
		$items = array_map( static fn( $p ) => self::post_item( $p, $with_content ), $q->posts );
		return array(
			'items'     => $items,
			'next_page' => $page < (int) $q->max_num_pages ? $page + 1 : null,
		);
	}

	public static function post_item( \WP_Post $p, bool $with_content ): array {
		$seo  = Seo::get_post( $p->ID );
		$item = array(
			'id'               => $p->ID,
			'kind'             => 'page' === $p->post_type ? 'page' : 'post',
			'title'            => get_the_title( $p ),
			'slug'             => $p->post_name,
			'url'              => get_permalink( $p ),
			'status'           => self::STATUS[ $p->post_status ] ?? $p->post_status,
			'published_at'     => self::iso( $p->post_date_gmt ),
			'updated_at'       => self::iso( $p->post_modified_gmt ),
			'word_count'       => self::word_count( $p->post_content ),
			'meta_title'       => $seo['meta_title'],
			'meta_description' => $seo['meta_description'],
			'keywords'         => $seo['meta_keywords'],
			'focus_keyword'    => $seo['focus_keyword'],
			'seo_score'        => $seo['score'] ?? Audit::score_for( $p->post_type, $p->ID ),
			'admin_url'        => admin_url( 'post.php?post=' . $p->ID . '&action=edit' ),
		);
		if ( 'post' === $p->post_type ) {
			$item['categories'] = wp_list_pluck( get_the_category( $p->ID ), 'name' );
			$item['tags']       = wp_list_pluck( (array) get_the_tags( $p->ID ), 'name' );
		}
		if ( $with_content ) {
			$item['excerpt']      = $p->post_excerpt;
			$item['content_html'] = Blocks::strip( $p->post_content );
		}
		return $item;
	}

	public static function list_products( int $page, int $per_page, bool $with_content ): array {
		if ( ! self::has_woo() ) {
			return array(
				'items'     => array(),
				'next_page' => null,
			);
		}
		$r     = wc_get_products(
			array(
				'status'   => array( 'publish', 'draft', 'pending', 'private' ),
				'limit'    => $per_page,
				'page'     => $page,
				'orderby'  => 'ID',
				'order'    => 'ASC',
				'paginate' => true,
			)
		);
		$items = array_map( static fn( $p ) => self::product_item( $p, $with_content ), $r->products );
		return array(
			'items'     => $items,
			'next_page' => $page < (int) $r->max_num_pages ? $page + 1 : null,
		);
	}

	/** @param \WC_Product $p */
	public static function product_item( $p, bool $with_content ): array {
		$id   = $p->get_id();
		$post = get_post( $id );
		$seo  = Seo::get_post( $id );
		$cats = get_the_terms( $id, 'product_cat' );
		$cat  = is_array( $cats ) && $cats ? $cats[0] : null;
		$item = array(
			'id'               => $id,
			'kind'             => 'product',
			'title'            => $p->get_name(),
			'slug'             => $p->get_slug(),
			'url'              => get_permalink( $id ),
			'status'           => self::STATUS[ $p->get_status() ] ?? $p->get_status(),
			'type'             => $p->get_type(),
			'category'         => $cat ? $cat->name : '',
			'category_id'      => $cat ? $cat->term_id : null,
			'price'            => self::price_text( $p ),
			'updated_at'       => $post ? self::iso( $post->post_modified_gmt ) : null,
			'word_count'       => self::word_count( $p->get_description() . ' ' . $p->get_short_description() ),
			'meta_title'       => $seo['meta_title'],
			'meta_description' => $seo['meta_description'],
			'keywords'         => $seo['meta_keywords'],
			'focus_keyword'    => $seo['focus_keyword'],
			'seo_score'        => $seo['score'] ?? Audit::score_for( 'product', $id ),
			'admin_url'        => admin_url( 'post.php?post=' . $id . '&action=edit' ),
		);
		if ( $with_content ) {
			$item['excerpt']      = $p->get_short_description();
			$item['content_html'] = Blocks::strip( $p->get_description() );
			$item['facts']        = self::product_facts( $p );
		}
		return $item;
	}

	/** "2890000 → 2490000 VND" when on sale, otherwise "2490000 VND" (variable products: lowest price). */
	private static function price_text( $p ): string {
		$cur = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '';
		if ( $p->is_on_sale() && '' !== (string) $p->get_regular_price() ) {
			return trim( $p->get_regular_price() . ' → ' . $p->get_sale_price() . ' ' . $cur );
		}
		return '' === (string) $p->get_price() ? '' : trim( $p->get_price() . ' ' . $cur );
	}

	/** Read-only facts the agent must not change or invent (prices, stock, attributes). */
	private static function product_facts( $p ): array {
		$facts = array(
			'sku'           => $p->get_sku(),
			'price'         => $p->get_price(),
			'regular_price' => $p->get_regular_price(),
			'sale_price'    => $p->get_sale_price(),
			'currency'      => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '',
			'stock_status'  => $p->get_stock_status(),
		);
		foreach ( $p->get_attributes() as $attr ) {
			if ( is_object( $attr ) && method_exists( $attr, 'get_name' ) ) {
				$name                       = wc_attribute_label( $attr->get_name() );
				$values                     = $attr->is_taxonomy() ? wc_get_product_terms( $p->get_id(), $attr->get_name(), array( 'fields' => 'names' ) ) : $attr->get_options();
				$facts[ 'attr: ' . $name ] = implode( ', ', (array) $values );
			}
		}
		return array_filter( $facts, static fn( $v ) => '' !== $v && null !== $v );
	}

	public static function taxonomies(): array {
		return self::has_woo() ? array( 'category', 'product_cat' ) : array( 'category' );
	}

	public static function list_terms( int $page, int $per_page, bool $with_content ): array {
		$args  = array(
			'taxonomy'   => self::taxonomies(),
			'hide_empty' => false,
			'orderby'    => 'term_id',
			'order'      => 'ASC',
		);
		$total = (int) wp_count_terms( $args );
		$terms = get_terms( $args + array( 'number' => $per_page, 'offset' => ( $page - 1 ) * $per_page ) );
		$items = is_array( $terms ) ? array_map( static fn( $t ) => self::term_item( $t, $with_content ), $terms ) : array();
		return array(
			'items'     => $items,
			'next_page' => $page * $per_page < $total ? $page + 1 : null,
		);
	}

	public static function term_item( \WP_Term $t, bool $with_content ): array {
		$seo  = Seo::get_term( $t );
		$link = get_term_link( $t );
		$item = array(
			'id'               => $t->term_id,
			'kind'             => 'category',
			'title'            => $t->name,
			'slug'             => $t->slug,
			'url'              => is_wp_error( $link ) ? '' : $link,
			'status'           => 'published',
			'module'           => 'product_cat' === $t->taxonomy ? 'product' : 'post',
			'parent_id'        => $t->parent ? $t->parent : null,
			'count'            => $t->count,
			'word_count'       => self::word_count( $t->description ),
			'meta_title'       => $seo['meta_title'],
			'meta_description' => $seo['meta_description'],
			'keywords'         => $seo['meta_keywords'],
			'focus_keyword'    => $seo['focus_keyword'],
			'seo_score'        => $seo['score'] ?? Audit::score_for( 'category', $t->term_id ),
			'admin_url'        => admin_url( 'term.php?taxonomy=' . $t->taxonomy . '&tag_ID=' . $t->term_id ),
		);
		if ( $with_content ) {
			$item['content_html'] = $t->description;
		}
		return $item;
	}

	// ---------------------------------------------------------------- single item

	/** @return \WP_Post|\WP_Term|null the object a proposal targets, if it exists and matches the type */
	public static function target( string $type, int $id ) {
		if ( 'category' === $type ) {
			$t = get_term( $id );
			return ( $t instanceof \WP_Term && in_array( $t->taxonomy, self::taxonomies(), true ) ) ? $t : null;
		}
		$p = get_post( $id );
		if ( ! $p instanceof \WP_Post || 'trash' === $p->post_status ) {
			return null;
		}
		$expected = array(
			'post'    => 'post',
			'page'    => 'page',
			'product' => 'product',
		);
		return ( $expected[ $type ] ?? '' ) === $p->post_type ? $p : null;
	}

	/** Current raw value of a canonical field (block markup kept, so patches match what is stored). */
	public static function get_field( $obj, string $field ): string {
		if ( in_array( $field, self::META, true ) ) {
			$seo = $obj instanceof \WP_Term ? Seo::get_term( $obj ) : Seo::get_post( $obj->ID );
			return (string) $seo[ $field ];
		}
		if ( $obj instanceof \WP_Term ) {
			return 'body' === $field ? (string) $obj->description : '';
		}
		$map = array(
			'name'    => 'post_title',
			'excerpt' => 'post_excerpt',
			'body'    => 'post_content',
			'slug'    => 'post_name',
		);
		return isset( $map[ $field ] ) ? (string) $obj->{$map[ $field ]} : '';
	}

	/**
	 * Write canonical fields to an existing item. HTML bodies are converted to blocks when the item
	 * already uses the block editor, unless $raw (values restored from a backup are written as-is).
	 *
	 * @return true|\WP_Error
	 */
	public static function set_fields( $obj, array $vals, bool $raw = false ) {
		$meta = array_intersect_key( $vals, array_flip( self::META ) );
		// SEO meta is written first: updating the post/term afterwards fires the hooks SEO plugins use to
		// refresh their caches (Yoast indexables), so the new meta shows up on the front end immediately.
		$refresh = $meta && 'native' !== Seo::provider();
		if ( $obj instanceof \WP_Term ) {
			if ( $meta ) {
				Seo::set_term( $obj, $meta );
			}
			if ( array_key_exists( 'body', $vals ) || $refresh ) {
				$args = array_key_exists( 'body', $vals ) ? array( 'description' => $vals['body'] ) : array();
				$r    = wp_update_term( $obj->term_id, $obj->taxonomy, $args );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
			}
			return true;
		}

		$post = array( 'ID' => $obj->ID );
		if ( array_key_exists( 'name', $vals ) ) {
			$post['post_title'] = $vals['name'];
		}
		if ( array_key_exists( 'excerpt', $vals ) ) {
			$post['post_excerpt'] = $vals['excerpt'];
		}
		if ( array_key_exists( 'slug', $vals ) ) {
			$post['post_name'] = $vals['slug'];
		}
		if ( array_key_exists( 'body', $vals ) ) {
			$post['post_content'] = $raw ? (string) $vals['body'] : self::prepare_body( (string) $vals['body'], (string) $obj->post_content, $obj->post_type );
		}
		if ( $meta ) {
			Seo::set_post( $obj->ID, $meta );
		}
		if ( count( $post ) > 1 || $refresh ) {
			$r = wp_update_post( wp_slash( $post ), true );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
		}
		if ( 'product' === $obj->post_type && function_exists( 'wc_delete_product_transients' ) ) {
			wc_delete_product_transients( $obj->ID );
		}
		clean_post_cache( $obj->ID );
		return true;
	}

	/** Agent HTML becomes blocks when the post (or, for a new post, its editor) uses blocks. */
	public static function prepare_body( string $html, string $current, string $post_type ): string {
		if ( Blocks::uses_blocks( $html ) ) {
			return $html;
		}
		$blocks = Blocks::uses_blocks( $current ) || ( '' === trim( $current ) && function_exists( 'use_block_editor_for_post_type' ) && use_block_editor_for_post_type( $post_type ) );
		return $blocks ? Blocks::from_html( $html ) : $html;
	}

	/** Raw field values for a backup taken before a proposal is applied. */
	public static function snapshot( $obj, array $fields ): array {
		$out = array();
		foreach ( $fields as $f ) {
			$out[ $f ] = self::get_field( $obj, $f );
		}
		return $out;
	}
}
