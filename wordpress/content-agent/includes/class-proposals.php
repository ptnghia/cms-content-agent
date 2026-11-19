<?php
/**
 * Review queue. The agent's changes arrive here (POST /proposals) and are only written to the site when
 * an editor presses "Apply". Applied proposals keep a backup of the previous values and can be reverted.
 *
 * Stored as a private post type `ca_proposal`:
 *   post_title = summary, post_content = note, meta _ca_* (status, action, type, target, fields, patches…)
 * Statuses: pending | applied | rejected | reverted.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Proposals {

	const CPT      = 'ca_proposal';
	const STATUSES = array( 'pending', 'applied', 'rejected', 'reverted' );

	public static function register(): void {
		register_post_type(
			self::CPT,
			array(
				'label'           => __( 'Content Agent proposals', 'content-agent' ),
				'public'          => false,
				'show_ui'         => false,
				'show_in_rest'    => false,
				'rewrite'         => false,
				'query_var'       => false,
				'supports'        => array( 'title', 'editor' ),
				'capability_type' => 'post',
			)
		);
	}

	public static function review_url( int $id ): string {
		return admin_url( 'admin.php?page=content-agent&proposal=' . $id );
	}

	// ------------------------------------------------------------------ create

	/**
	 * Validate and queue a proposal.
	 *
	 * @return array{id:int,warnings:string[],fields:string[]}|\WP_Error  WP_Error carries 'details' (string[]) and status 422/404
	 */
	public static function create( array $req ) {
		$schema  = Content::schema();
		$action  = isset( $req['action'] ) ? (string) $req['action'] : 'update';
		$type    = isset( $req['type'] ) ? (string) $req['type'] : '';
		$fields  = isset( $req['fields'] ) && is_array( $req['fields'] ) ? $req['fields'] : array();
		$patches = isset( $req['patches'] ) && is_array( $req['patches'] ) ? $req['patches'] : array();
		$errors  = array();
		$warn    = array();

		if ( ! in_array( $action, array( 'update', 'create' ), true ) ) {
			return self::fail( 'action must be "update" or "create"' );
		}
		if ( ! isset( $schema[ $type ] ) ) {
			return self::fail( sprintf( 'type must be one of: %s', implode( ', ', array_keys( $schema ) ) ) );
		}
		if ( 'create' === $action && ! $schema[ $type ]['create'] ) {
			return self::fail( sprintf( 'Only %s can be created; %s can only be updated', implode( '/', self::creatable() ), $type ) );
		}
		if ( ! $fields && ! $patches ) {
			return self::fail( 'Nothing to change: send "fields" or "patches"' );
		}

		$allowed = $schema[ $type ]['editable'];
		if ( 'create' === $action ) {
			$allowed = array_merge( $allowed, $schema[ $type ]['create'] );
		}
		foreach ( array_keys( $fields ) as $f ) {
			if ( ! in_array( $f, $allowed, true ) ) {
				$errors[] = sprintf( 'Field "%s" cannot be set on a %s. Allowed fields: %s', $f, $type, implode( ', ', $allowed ) );
			}
		}

		$target = null;
		if ( 'update' === $action ) {
			$id     = isset( $req['id'] ) ? (int) $req['id'] : 0;
			$target = $id > 0 ? Content::target( $type, $id ) : null;
			if ( ! $target ) {
				return self::fail( sprintf( '%s #%d not found', $type, $id ), array(), 404 );
			}
		} else {
			if ( empty( $fields['name'] ) || empty( $fields['body'] ) ) {
				$errors[] = sprintf( 'A new %s needs at least "name" and "body"', $type );
			}
			if ( $patches ) {
				$errors[] = '"patches" only work with action "update"';
			}
		}

		// Patches: in-place edits of HTML fields, checked against the current content now and again on apply.
		$clean_patches = array();
		foreach ( $patches as $field => $list ) {
			if ( ! in_array( $field, Content::HTML, true ) || ! in_array( $field, $allowed, true ) ) {
				$errors[] = sprintf( 'Patches are not supported for field "%s" on a %s', $field, $type );
				continue;
			}
			if ( array_key_exists( $field, $fields ) ) {
				$errors[] = sprintf( 'Field "%s" is sent both in "fields" and "patches"', $field );
				continue;
			}
			$current = $target ? Content::get_field( $target, $field ) : '';
			foreach ( array_values( (array) $list ) as $n => $p ) {
				$find    = is_array( $p ) && isset( $p['find'] ) ? (string) $p['find'] : '';
				$replace = is_array( $p ) && isset( $p['replace'] ) ? wp_kses_post( (string) $p['replace'] ) : '';
				$count   = '' === $find ? 0 : substr_count( $current, $find );
				if ( 1 !== $count ) {
					$errors[] = sprintf( 'Patch %d on "%s": the text to find occurs %d times (must be exactly once; copy it verbatim and make it longer if needed)', $n + 1, $field, $count );
					continue;
				}
				$number_change = self::numbers_removed( $type, $find, $replace );
				if ( $number_change ) {
					$errors[] = sprintf( 'Patch %d on "%s" changes or removes numbers (%s). Prices and figures cannot be edited by the agent', $n + 1, $field, implode( ', ', $number_change ) );
				}
				$clean_patches[ $field ][] = array(
					'find'    => $find,
					'replace' => $replace,
				);
			}
		}

		$clean = self::sanitize_fields( $fields, $type, $warn, $errors );
		if ( $target ) {
			foreach ( Content::HTML as $f ) {
				if ( isset( $clean[ $f ] ) ) {
					$removed = self::numbers_removed( $type, Blocks::strip( Content::get_field( $target, $f ) ), $clean[ $f ] );
					if ( $removed ) {
						$errors[] = sprintf( 'New "%s" drops or changes numbers that exist on the page (%s). Keep every price and figure exactly as it is', $f, implode( ', ', array_slice( $removed, 0, 8 ) ) );
					}
				}
			}
		}
		if ( $errors ) {
			return self::fail( 'Proposal rejected: ' . $errors[0], $errors );
		}

		self::collect_warnings( $action, $type, $target, $clean, $warn );

		$post_id = wp_insert_post(
			wp_slash(
				array(
					'post_type'    => self::CPT,
					'post_status'  => 'publish',
					'post_title'   => sanitize_text_field( (string) ( $req['title'] ?? $req['summary'] ?? '' ) ),
					'post_content' => sanitize_textarea_field( (string) ( $req['note'] ?? '' ) ),
				)
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}
		$meta = array(
			'_ca_status'   => 'pending',
			'_ca_action'   => $action,
			'_ca_type'     => $type,
			'_ca_target'   => $target ? ( $target instanceof \WP_Term ? $target->term_id : $target->ID ) : 0,
			'_ca_fields'   => $clean,
			'_ca_patches'  => $clean_patches,
			'_ca_source'   => substr( sanitize_text_field( (string) ( $req['source'] ?? '' ) ), 0, 120 ),
			'_ca_warnings' => $warn,
		);
		foreach ( $meta as $k => $v ) {
			update_post_meta( $post_id, $k, wp_slash( $v ) );
		}
		return array(
			'id'       => $post_id,
			'warnings' => $warn,
			'fields'   => array_values( array_unique( array_merge( array_keys( $clean ), array_keys( $clean_patches ) ) ) ),
		);
	}

	public static function creatable(): array {
		return array_keys( array_filter( Content::schema(), static fn( $t ) => ! empty( $t['create'] ) ) );
	}

	private static function fail( string $message, array $details = array(), int $status = 422 ): \WP_Error {
		return new \WP_Error(
			'content_agent_invalid',
			$message,
			array(
				'status'  => $status,
				'details' => $details ? $details : array( $message ),
			)
		);
	}

	private static function sanitize_fields( array $fields, string $type, array &$warn, array &$errors ): array {
		$out = array();
		foreach ( $fields as $f => $v ) {
			if ( is_array( $v ) || is_object( $v ) ) {
				$errors[] = sprintf( 'Field "%s" must be a string', $f );
				continue;
			}
			$v = (string) $v;
			switch ( $f ) {
				case 'excerpt':
				case 'body':
					$out[ $f ] = wp_kses_post( $v );
					break;
				case 'slug':
					$out[ $f ] = sanitize_title( $v );
					break;
				case 'category_id':
					$term = get_term( (int) $v, 'category' );
					if ( $term instanceof \WP_Term ) {
						$out[ $f ] = (string) $term->term_id;
					} else {
						$warn[] = sprintf( 'Category #%d does not exist; the post will use the default category', (int) $v );
					}
					break;
				case 'featured_image':
					$att = self::find_attachment( $v );
					if ( $att ) {
						$out[ $f ] = (string) $att;
					} else {
						$warn[] = sprintf( 'Featured image "%s" was not found in the media library and will be skipped', $v );
					}
					break;
				default:
					$out[ $f ] = sanitize_text_field( $v );
			}
		}
		return $out;
	}

	/** Attachment id from an id, URL or file name in the media library. */
	public static function find_attachment( string $ref ): int {
		$ref = trim( $ref );
		if ( ctype_digit( $ref ) && 'attachment' === get_post_type( (int) $ref ) ) {
			return (int) $ref;
		}
		if ( preg_match( '#^https?://#', $ref ) ) {
			$id = attachment_url_to_postid( $ref );
			if ( $id ) {
				return $id;
			}
		}
		$name = sanitize_file_name( wp_basename( $ref ) );
		if ( '' === $name ) {
			return 0;
		}
		$q = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => '_wp_attached_file',
						'value'   => '/' . $name,
						'compare' => 'LIKE',
					),
				),
			)
		);
		if ( $q ) {
			return (int) $q[0];
		}
		$q = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_key'       => '_wp_attached_file', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'     => $name, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);
		return $q ? (int) $q[0] : 0;
	}

	/**
	 * Prices and figures on products and categories are facts the agent must not touch.
	 * Returns numbers (with thousands separators or 4+ digits) present in $before but missing in $after.
	 */
	public static function numbers_removed( string $type, string $before, string $after ): array {
		if ( ! in_array( $type, array( 'product', 'category' ), true ) ) {
			return array();
		}
		$re  = '/(?<![\d.,])\d{1,3}(?:[.,\x{00A0} ]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\d.,])\d{4,}(?![\d])/u';
		$get = static function ( $s ) use ( $re ) {
			preg_match_all( $re, wp_strip_all_tags( $s ), $m );
			return array_unique( $m[0] );
		};
		return array_values( array_diff( $get( $before ), $get( $after ) ) );
	}

	private static function collect_warnings( string $action, string $type, $target, array $fields, array &$warn ): void {
		$len = static fn( $s ) => function_exists( 'mb_strlen' ) ? mb_strlen( $s ) : strlen( $s );
		if ( isset( $fields['meta_title'] ) && ( $len( $fields['meta_title'] ) < Audit::TITLE[0] || $len( $fields['meta_title'] ) > Audit::TITLE[1] ) ) {
			$warn[] = sprintf( 'SEO title is %d characters (recommended %d–%d)', $len( $fields['meta_title'] ), Audit::TITLE[0], Audit::TITLE[1] );
		}
		if ( isset( $fields['meta_description'] ) && ( $len( $fields['meta_description'] ) < Audit::DESC[0] || $len( $fields['meta_description'] ) > Audit::DESC[1] ) ) {
			$warn[] = sprintf( 'Meta description is %d characters (recommended %d–%d)', $len( $fields['meta_description'] ), Audit::DESC[0], Audit::DESC[1] );
		}
		if ( 'create' === $action && ! empty( $fields['name'] ) ) {
			$same = get_posts(
				array(
					'post_type'      => $type,
					'post_status'    => array( 'publish', 'draft', 'pending', 'future', 'private' ),
					'title'          => $fields['name'],
					'posts_per_page' => 1,
					'fields'         => 'ids',
				)
			);
			if ( $same ) {
				$warn[] = sprintf( 'A %s with the same title already exists (#%d)', $type, $same[0] );
			}
		}
		if ( $target ) {
			$tid  = $target instanceof \WP_Term ? $target->term_id : $target->ID;
			$open = get_posts(
				array(
					'post_type'      => self::CPT,
					'posts_per_page' => 1,
					'fields'         => 'ids',
					'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
						array(
							'key'   => '_ca_status',
							'value' => 'pending',
						),
						array(
							'key'   => '_ca_type',
							'value' => $type,
						),
						array(
							'key'   => '_ca_target',
							'value' => $tid,
						),
					),
				)
			);
			if ( $open ) {
				$warn[] = sprintf( 'Proposal #%d for the same %s is still waiting for review', $open[0], $type );
			}
		}
	}

	// ------------------------------------------------------------------ read

	public static function get( int $id ): ?array {
		$p = get_post( $id );
		if ( ! $p || self::CPT !== $p->post_type ) {
			return null;
		}
		$m = static fn( $k, $def = '' ) => ( '' !== get_post_meta( $id, $k, true ) ? get_post_meta( $id, $k, true ) : $def );
		return array(
			'id'         => $id,
			'title'      => $p->post_title,
			'note'       => $p->post_content,
			'status'     => (string) $m( '_ca_status', 'pending' ),
			'action'     => (string) $m( '_ca_action', 'update' ),
			'type'       => (string) $m( '_ca_type', 'post' ),
			'target_id'  => (int) $m( '_ca_target', 0 ) ? (int) $m( '_ca_target', 0 ) : null,
			'fields'     => (array) $m( '_ca_fields', array() ),
			'patches'    => (array) $m( '_ca_patches', array() ),
			'warnings'   => (array) $m( '_ca_warnings', array() ),
			'source'     => (string) $m( '_ca_source' ),
			'reason'     => (string) $m( '_ca_reason' ),
			'backup'     => (array) $m( '_ca_backup', array() ),
			'result_id'  => (int) $m( '_ca_result', 0 ),
			'error'      => (string) $m( '_ca_error' ),
			'created_at' => Content::iso( $p->post_date_gmt ),
			'decided_at' => (string) $m( '_ca_decided_at' ),
			'decided_by' => (int) $m( '_ca_decided_by', 0 ),
		);
	}

	/** @return array{items: array[], total: int} */
	public static function query( string $status = '', int $page = 1, int $per_page = 20 ): array {
		$args = array(
			'post_type'      => self::CPT,
			'post_status'    => 'publish',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'ID',
			'order'          => 'DESC',
			'fields'         => 'ids',
		);
		if ( in_array( $status, self::STATUSES, true ) ) {
			$args['meta_key']   = '_ca_status'; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			$args['meta_value'] = $status; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		}
		$q = new \WP_Query( $args );
		return array(
			'items' => array_values( array_filter( array_map( array( self::class, 'get' ), $q->posts ) ) ),
			'total' => (int) $q->found_posts,
		);
	}

	public static function count( string $status ): int {
		return self::query( $status, 1, 1 )['total'];
	}

	// ------------------------------------------------------------------ decide

	public static function can_decide( array $p ): bool {
		if ( 'create' === $p['action'] ) {
			return current_user_can( 'page' === $p['type'] ? 'edit_pages' : 'edit_posts' );
		}
		if ( 'category' === $p['type'] ) {
			$t = $p['target_id'] ? get_term( $p['target_id'] ) : null;
			$tax = $t instanceof \WP_Term ? get_taxonomy( $t->taxonomy ) : null;
			return $tax ? current_user_can( $tax->cap->edit_terms ) : current_user_can( 'manage_categories' );
		}
		return $p['target_id'] ? current_user_can( 'edit_post', $p['target_id'] ) : false;
	}

	/** @return true|\WP_Error */
	public static function apply( int $id ) {
		$p = self::get( $id );
		if ( ! $p || 'pending' !== $p['status'] ) {
			return new \WP_Error( 'content_agent_state', __( 'Only pending proposals can be applied.', 'content-agent' ) );
		}
		if ( 'create' === $p['action'] ) {
			$r = self::apply_create( $p );
		} else {
			$r = self::apply_update( $p );
		}
		if ( is_wp_error( $r ) ) {
			update_post_meta( $id, '_ca_error', wp_slash( $r->get_error_message() ) );
			return $r;
		}
		delete_post_meta( $id, '_ca_error' );
		self::decide( $id, 'applied' );
		Audit::flush();
		return true;
	}

	private static function apply_create( array $p ) {
		$f    = $p['fields'];
		$type = $p['type'];
		$new  = wp_insert_post(
			wp_slash(
				array(
					'post_type'     => $type,
					'post_status'   => 'draft', // never published by the agent.
					'post_title'    => $f['name'] ?? '',
					'post_excerpt'  => $f['excerpt'] ?? '',
					'post_content'  => Content::prepare_body( (string) ( $f['body'] ?? '' ), '', $type ),
					'post_name'     => $f['slug'] ?? '',
					'post_author'   => get_current_user_id(),
					'post_category' => isset( $f['category_id'] ) ? array( (int) $f['category_id'] ) : array(),
				)
			),
			true
		);
		if ( is_wp_error( $new ) ) {
			return $new;
		}
		Seo::set_post( $new, array_intersect_key( $f, array_flip( Content::META ) ) );
		if ( ! empty( $f['featured_image'] ) ) {
			set_post_thumbnail( $new, (int) $f['featured_image'] );
		}
		update_post_meta( $p['id'], '_ca_result', $new );
		return true;
	}

	private static function apply_update( array $p ) {
		$target = $p['target_id'] ? Content::target( $p['type'], $p['target_id'] ) : null;
		if ( ! $target ) {
			return new \WP_Error( 'content_agent_target', __( 'The page this proposal targets no longer exists.', 'content-agent' ) );
		}
		$touched = array_unique( array_merge( array_keys( $p['fields'] ), array_keys( $p['patches'] ) ) );
		$backup  = Content::snapshot( $target, $touched );

		// Patches are re-checked against the content as it is now: it may have changed since the proposal arrived.
		$patched = array();
		foreach ( $p['patches'] as $field => $list ) {
			$value = Content::get_field( $target, $field );
			foreach ( $list as $n => $patch ) {
				if ( 1 !== substr_count( $value, $patch['find'] ) ) {
					/* translators: 1: patch number, 2: field name */
					return new \WP_Error( 'content_agent_patch', sprintf( __( 'Patch %1$d on "%2$s" no longer matches the current content (it was edited after the proposal was made).', 'content-agent' ), $n + 1, $field ) );
				}
				$pos   = strpos( $value, $patch['find'] );
				$value = substr_replace( $value, $patch['replace'], $pos, strlen( $patch['find'] ) );
			}
			$patched[ $field ] = $value;
		}

		update_post_meta( $p['id'], '_ca_backup', wp_slash( $backup ) );
		if ( $p['fields'] ) {
			$r = Content::set_fields( $target, $p['fields'] );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
		}
		if ( $patched ) {
			$fresh = Content::target( $p['type'], $p['target_id'] );
			$r     = Content::set_fields( $fresh, $patched, true );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
		}
		return true;
	}

	/** @return true|\WP_Error */
	public static function reject( int $id, string $reason = '' ) {
		$p = self::get( $id );
		if ( ! $p || 'pending' !== $p['status'] ) {
			return new \WP_Error( 'content_agent_state', __( 'Only pending proposals can be rejected.', 'content-agent' ) );
		}
		update_post_meta( $id, '_ca_reason', wp_slash( sanitize_textarea_field( $reason ) ) );
		self::decide( $id, 'rejected' );
		return true;
	}

	/** @return true|\WP_Error */
	public static function revert( int $id ) {
		$p = self::get( $id );
		if ( ! $p || 'applied' !== $p['status'] ) {
			return new \WP_Error( 'content_agent_state', __( 'Only applied proposals can be reverted.', 'content-agent' ) );
		}
		if ( 'create' === $p['action'] ) {
			if ( $p['result_id'] && get_post( $p['result_id'] ) ) {
				wp_trash_post( $p['result_id'] );
			}
		} else {
			$target = Content::target( $p['type'], (int) $p['target_id'] );
			if ( ! $target ) {
				return new \WP_Error( 'content_agent_target', __( 'The page this proposal targets no longer exists.', 'content-agent' ) );
			}
			$r = Content::set_fields( $target, $p['backup'], true );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
		}
		self::decide( $id, 'reverted' );
		Audit::flush();
		return true;
	}

	private static function decide( int $id, string $status ): void {
		update_post_meta( $id, '_ca_status', $status );
		update_post_meta( $id, '_ca_decided_at', gmdate( 'Y-m-d\TH:i:s\Z' ) );
		update_post_meta( $id, '_ca_decided_by', get_current_user_id() );
	}

	/** Shape returned by GET /proposals (read by the backend into outbox/STATUS.md). */
	public static function public_item( array $p ): array {
		return array(
			'id'         => $p['id'],
			'action'     => $p['action'],
			'type'       => $p['type'],
			'target_id'  => $p['target_id'],
			'title'      => $p['title'],
			'status'     => $p['status'],
			'fields'     => array_values( array_unique( array_merge( array_keys( $p['fields'] ), array_keys( $p['patches'] ) ) ) ),
			'reason'     => $p['reason'],
			'created_at' => $p['created_at'],
			'review_url' => self::review_url( $p['id'] ),
		);
	}
}
