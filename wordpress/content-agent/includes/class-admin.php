<?php
/**
 * wp-admin: review queue, settings, chat widget embed, token and image upload endpoints for the widget.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Admin {

	/** Who sees the review queue: proposals show other users' and private content. */
	const QUEUE_CAP = 'edit_others_posts';

	const NONCE = 'content_agent';

	public static function hooks(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_content_agent_decide', array( self::class, 'handle_decide' ) );
		add_action( 'admin_post_content_agent_settings', array( self::class, 'handle_settings' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'widget' ) );
		add_action( 'wp_ajax_content_agent_token', array( self::class, 'ajax_token' ) );
		add_action( 'wp_ajax_content_agent_upload', array( self::class, 'ajax_upload' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( CONTENT_AGENT_FILE ), array( self::class, 'action_links' ) );
		add_action( 'admin_notices', array( self::class, 'setup_notice' ) );
	}

	public static function menu(): void {
		$pending = Proposals::count( 'pending' );
		$bubble  = $pending ? ' <span class="awaiting-mod"><span class="pending-count">' . (int) $pending . '</span></span>' : '';
		add_menu_page( Brand::name(), esc_html( Brand::name() ) . $bubble, self::QUEUE_CAP, 'content-agent', array( self::class, 'page_proposals' ), 'dashicons-format-chat', 26 );
		add_submenu_page( 'content-agent', __( 'Proposals', 'content-agent' ), __( 'Proposals', 'content-agent' ), self::QUEUE_CAP, 'content-agent', array( self::class, 'page_proposals' ) );
		/* translators: %s: plugin brand name */
		add_submenu_page( 'content-agent', sprintf( __( '%s settings', 'content-agent' ), Brand::name() ), __( 'Settings', 'content-agent' ), 'manage_options', 'content-agent-settings', array( self::class, 'page_settings' ) );
	}

	public static function action_links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=content-agent-settings' ) ) . '">' . esc_html__( 'Settings', 'content-agent' ) . '</a>' );
		return $links;
	}

	public static function setup_notice(): void {
		if ( Settings::is_connected() || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && false !== strpos( (string) $screen->id, 'content-agent-settings' ) ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			/* translators: %s: plugin brand name */
			esc_html( sprintf( __( '%s is installed but not connected yet.', 'content-agent' ), Brand::name() ) ),
			esc_url( admin_url( 'admin.php?page=content-agent-settings' ) ),
			'' !== Brand::service_url() ? esc_html__( 'Connect now', 'content-agent' ) : esc_html__( 'Finish setup', 'content-agent' )
		);
	}

	// ------------------------------------------------------------------ widget + ajax

	private static function can_chat(): bool {
		return current_user_can( (string) Settings::get( 'capability' ) );
	}

	public static function ajax_url( string $action ): string {
		return add_query_arg(
			array(
				'action'      => $action,
				'_ajax_nonce' => wp_create_nonce( self::NONCE ),
			),
			admin_url( 'admin-ajax.php' )
		);
	}

	/** Chat widget in wp-admin: widget.js is served by the backend (the external service configured in Settings). */
	public static function widget(): void {
		$s = Settings::get();
		if ( ! $s['widget_enabled'] || ! Settings::is_connected() || ! self::can_chat() ) {
			return;
		}
		$opts = array(
			'api'       => untrailingslashit( $s['backend_url'] ),
			'tokenUrl'  => self::ajax_url( 'content_agent_token' ),
			'title'     => '' !== $s['assistant_name'] ? $s['assistant_name'] : __( 'Content assistant', 'content-agent' ),
			'uploadUrl' => current_user_can( 'upload_files' ) ? self::ajax_url( 'content_agent_upload' ) : '',
			'lang'      => substr( get_user_locale(), 0, 2 ),
		);
		wp_enqueue_script( 'content-agent-widget', trailingslashit( $s['backend_url'] ) . 'widget.js', array(), CONTENT_AGENT_VERSION, true );
		wp_add_inline_script( 'content-agent-widget', 'window.ContentAgent && window.ContentAgent.mount(' . wp_json_encode( array_filter( $opts ) ) . ');' );
	}

	public static function ajax_token(): void {
		check_ajax_referer( self::NONCE );
		if ( ! self::can_chat() || ! Settings::is_connected() ) {
			wp_send_json( array( 'error' => 'forbidden' ), 403 );
		}
		$u = wp_get_current_user();
		nocache_headers();
		wp_send_json( array( 'token' => Token::sign( (string) Settings::get( 'token_secret' ), (string) Settings::get( 'site_id' ), (string) $u->ID, (string) $u->display_name, 900 ) ) );
	}

	/** Images attached in the chat go to the media library; the agent gets their file names and URLs. */
	public static function ajax_upload(): void {
		check_ajax_referer( self::NONCE );
		if ( ! current_user_can( 'upload_files' ) ) {
			wp_send_json( array( 'error' => __( 'You cannot upload files.', 'content-agent' ) ), 403 );
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$in    = $_FILES['images'] ?? null; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$files = array();
		if ( ! is_array( $in ) || ! isset( $in['name'] ) ) {
			wp_send_json( array( 'error' => __( 'No image received.', 'content-agent' ) ), 400 );
		}
		$count = is_array( $in['name'] ) ? count( $in['name'] ) : 1;
		for ( $i = 0; $i < min( 5, $count ); $i++ ) {
			$one = array();
			foreach ( array( 'name', 'type', 'tmp_name', 'error', 'size' ) as $k ) {
				$one[ $k ] = is_array( $in[ $k ] ) ? $in[ $k ][ $i ] : $in[ $k ];
			}
			$original    = sanitize_text_field( wp_unslash( $one['name'] ) );
			$one['name'] = strtolower( preg_replace( '/[^A-Za-z0-9._-]+/', '-', remove_accents( $original ) ) );
			$check       = wp_check_filetype_and_ext( $one['tmp_name'], $one['name'] );
			if ( empty( $check['type'] ) || 0 !== strpos( $check['type'], 'image/' ) ) {
				continue;
			}
			$att = media_handle_sideload( $one, 0 );
			if ( is_wp_error( $att ) ) {
				wp_send_json( array( 'error' => $att->get_error_message() ), 400 );
			}
			$meta    = wp_get_attachment_metadata( $att );
			$url     = wp_get_attachment_url( $att );
			$files[] = array(
				'id'   => $att,
				'file' => wp_basename( (string) $url ),
				'name' => $original,
				'w'    => (int) ( $meta['width'] ?? 0 ),
				'h'    => (int) ( $meta['height'] ?? 0 ),
				'url'  => $url,
			);
		}
		if ( ! $files ) {
			wp_send_json( array( 'error' => __( 'Only JPG, PNG, WebP or GIF images are accepted.', 'content-agent' ) ), 400 );
		}
		wp_send_json( array( 'files' => $files ) );
	}

	// ------------------------------------------------------------------ proposals UI

	private static function status_label( string $s ): string {
		$labels = array(
			'pending'  => __( 'Pending', 'content-agent' ),
			'applied'  => __( 'Applied', 'content-agent' ),
			'rejected' => __( 'Rejected', 'content-agent' ),
			'reverted' => __( 'Reverted', 'content-agent' ),
		);
		return $labels[ $s ] ?? $s;
	}

	private static function field_label( string $f ): string {
		$labels = array(
			'name'             => __( 'Title', 'content-agent' ),
			'excerpt'          => __( 'Excerpt / short description', 'content-agent' ),
			'body'             => __( 'Content', 'content-agent' ),
			'meta_title'       => __( 'SEO title', 'content-agent' ),
			'meta_description' => __( 'Meta description', 'content-agent' ),
			'meta_keywords'    => __( 'Focus keywords', 'content-agent' ),
			'slug'             => __( 'Slug', 'content-agent' ),
			'category_id'      => __( 'Category', 'content-agent' ),
			'featured_image'   => __( 'Featured image', 'content-agent' ),
		);
		return $labels[ $f ] ?? $f;
	}

	private static function target_link( array $p ): string {
		if ( 'create' === $p['action'] ) {
			if ( $p['result_id'] && get_post( $p['result_id'] ) ) {
				return '<a href="' . esc_url( get_edit_post_link( $p['result_id'] ) ) . '">' . esc_html( get_the_title( $p['result_id'] ) ) . '</a> <em>(' . esc_html__( 'draft created', 'content-agent' ) . ')</em>';
			}
			return '<em>' . esc_html__( 'New', 'content-agent' ) . ' ' . esc_html( $p['type'] ) . '</em>';
		}
		$t = $p['target_id'] ? Content::target( $p['type'], $p['target_id'] ) : null;
		if ( $t instanceof \WP_Term ) {
			return '<a href="' . esc_url( get_edit_term_link( $t ) ) . '">' . esc_html( $t->name ) . '</a>';
		}
		if ( $t instanceof \WP_Post ) {
			return '<a href="' . esc_url( get_edit_post_link( $t ) ) . '">' . esc_html( get_the_title( $t ) ) . '</a>';
		}
		return '<em>' . esc_html__( 'deleted', 'content-agent' ) . '</em>';
	}

	/** The backend's widget.js runs in wp-admin: accept only https (http only for localhost). */
	private static function backend_url( string $url ): string {
		$u = wp_parse_url( $url );
		if ( empty( $u['host'] ) ) {
			return '';
		}
		$local = in_array( $u['host'], array( 'localhost', '127.0.0.1', '::1' ), true );
		return ( 'https' === ( $u['scheme'] ?? '' ) || $local ) ? untrailingslashit( $url ) : '';
	}

	public static function page_proposals(): void {
		if ( ! current_user_can( self::QUEUE_CAP ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'content-agent' ) );
		}
		$id = isset( $_GET['proposal'] ) ? absint( $_GET['proposal'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		echo '<div class="wrap content-agent">';
		self::notice_from_query();
		if ( $id ) {
			self::render_review( $id );
		} else {
			self::render_list();
		}
		echo '</div>';
		self::styles();
	}

	private static function notice_from_query(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		if ( isset( $_GET['ca_done'] ) ) {
			$msgs = array(
				'applied'  => __( 'Proposal applied.', 'content-agent' ),
				'rejected' => __( 'Proposal rejected.', 'content-agent' ),
				'reverted' => __( 'Proposal reverted.', 'content-agent' ),
				'saved'    => __( 'Settings saved.', 'content-agent' ),
				'connected' => __( 'Connected. The assistant is ready in wp-admin; the first sync is running on the service.', 'content-agent' ),
				'disconnected' => __( 'Disconnected. The keys the service held no longer work.', 'content-agent' ),
			);
			$done = sanitize_key( wp_unslash( $_GET['ca_done'] ) );
			if ( isset( $msgs[ $done ] ) ) {
				echo '<div class="notice notice-success is-dismissible"><p>' . esc_html( $msgs[ $done ] ) . '</p></div>';
			}
		}
		if ( isset( $_GET['ca_err'] ) ) {
			$errors = Connect::error_messages();
			$err    = sanitize_key( wp_unslash( $_GET['ca_err'] ) );
			if ( isset( $errors[ $err ] ) ) {
				echo '<div class="notice notice-error"><p>' . esc_html( $errors[ $err ] ) . '</p></div>';
			}
		}
		if ( isset( $_GET['ca_error'] ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html( sanitize_text_field( wp_unslash( $_GET['ca_error'] ) ) ) . '</p></div>';
		}
		// phpcs:enable
	}

	private static function render_list(): void {
		$status = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : 'pending'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$paged  = isset( $_GET['paged'] ) ? max( 1, absint( $_GET['paged'] ) ) : 1; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$res    = Proposals::query( 'all' === $status ? '' : $status, $paged, 20 );

		echo '<h1 class="wp-heading-inline">' . esc_html__( 'Content Agent proposals', 'content-agent' ) . '</h1>';
		echo '<p class="description">' . esc_html__( 'Changes suggested by the AI assistant. Nothing changes on your site until you apply a proposal.', 'content-agent' ) . '</p>';
		echo '<ul class="subsubsub">';
		$tabs = array_merge( Proposals::STATUSES, array( 'all' ) );
		foreach ( $tabs as $i => $s ) {
			$n     = 'all' === $s ? Proposals::count( '' ) : Proposals::count( $s );
			$label = 'all' === $s ? __( 'All', 'content-agent' ) : self::status_label( $s );
			printf(
				'<li><a href="%s"%s>%s <span class="count">(%d)</span></a>%s</li>',
				esc_url( add_query_arg( array( 'page' => 'content-agent', 'status' => $s ), admin_url( 'admin.php' ) ) ),
				$s === $status ? ' class="current" aria-current="page"' : '',
				esc_html( $label ),
				(int) $n,
				$i < count( $tabs ) - 1 ? ' |' : ''
			);
		}
		echo '</ul><table class="wp-list-table widefat fixed striped"><thead><tr>';
		foreach ( array( '#', __( 'Summary', 'content-agent' ), __( 'Page', 'content-agent' ), __( 'Fields', 'content-agent' ), __( 'Status', 'content-agent' ), __( 'Received', 'content-agent' ) ) as $h ) {
			echo '<th>' . esc_html( $h ) . '</th>';
		}
		echo '</tr></thead><tbody>';
		if ( ! $res['items'] ) {
			echo '<tr><td colspan="6">' . esc_html__( 'No proposals here.', 'content-agent' ) . '</td></tr>';
		}
		foreach ( $res['items'] as $p ) {
			$fields = array_unique( array_merge( array_keys( $p['fields'] ), array_keys( $p['patches'] ) ) );
			printf(
				'<tr><td>%d</td><td><strong><a href="%s">%s</a></strong>%s</td><td>%s<br><small>%s</small></td><td>%s</td><td><span class="ca-status ca-%s">%s</span></td><td>%s</td></tr>',
				(int) $p['id'],
				esc_url( Proposals::review_url( $p['id'] ) ),
				esc_html( '' !== $p['title'] ? $p['title'] : __( '(no summary)', 'content-agent' ) ),
				$p['warnings'] ? ' <span class="dashicons dashicons-warning" title="' . esc_attr( implode( "\n", $p['warnings'] ) ) . '"></span>' : '',
				self::target_link( $p ), // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped inside.
				esc_html( $p['type'] ),
				esc_html( implode( ', ', array_map( array( self::class, 'field_label' ), $fields ) ) ),
				esc_attr( $p['status'] ),
				esc_html( self::status_label( $p['status'] ) ),
				esc_html( $p['created_at'] ? wp_date( get_option( 'date_format' ) . ' H:i', strtotime( $p['created_at'] ) ) : '' )
			);
		}
		echo '</tbody></table>';
		$pages = (int) ceil( $res['total'] / 20 );
		if ( $pages > 1 ) {
			echo '<div class="tablenav"><div class="tablenav-pages">' . wp_kses_post( paginate_links( array( 'base' => add_query_arg( 'paged', '%#%' ), 'total' => $pages, 'current' => $paged ) ) ) . '</div></div>';
		}
	}

	private static function render_review( int $id ): void {
		$p = Proposals::get( $id );
		if ( ! $p || ! Proposals::can_decide( $p ) ) {   // the diff shows the target's current content
			echo '<h1>' . esc_html__( 'Proposal not found', 'content-agent' ) . '</h1>';
			return;
		}
		$target = 'update' === $p['action'] && $p['target_id'] ? Content::target( $p['type'], $p['target_id'] ) : null;
		$back   = add_query_arg( array( 'page' => 'content-agent' ), admin_url( 'admin.php' ) );

		echo '<p><a href="' . esc_url( $back ) . '">&larr; ' . esc_html__( 'All proposals', 'content-agent' ) . '</a></p>';
		printf( '<h1>#%d %s <span class="ca-status ca-%s">%s</span></h1>', (int) $p['id'], esc_html( $p['title'] ), esc_attr( $p['status'] ), esc_html( self::status_label( $p['status'] ) ) );
		echo '<p>' . self::target_link( $p ) . ' · ' . esc_html( $p['type'] ) . ' · ' . esc_html( 'create' === $p['action'] ? __( 'new draft', 'content-agent' ) : __( 'update', 'content-agent' ) ) . '</p>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		if ( '' !== $p['note'] ) {
			echo '<div class="ca-note"><strong>' . esc_html__( 'Why', 'content-agent' ) . ':</strong> ' . esc_html( $p['note'] ) . '</div>';
		}
		foreach ( $p['warnings'] as $w ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html( $w ) . '</p></div>';
		}
		if ( '' !== $p['error'] ) {
			echo '<div class="notice notice-error inline"><p>' . esc_html( $p['error'] ) . '</p></div>';
		}
		if ( '' !== $p['reason'] ) {
			echo '<div class="notice notice-info inline"><p><strong>' . esc_html__( 'Rejection reason', 'content-agent' ) . ':</strong> ' . esc_html( $p['reason'] ) . '</p></div>';
		}

		foreach ( $p['fields'] as $f => $new ) {
			$old = 'applied' === $p['status'] || 'reverted' === $p['status'] ? (string) ( $p['backup'][ $f ] ?? '' ) : ( $target ? Content::get_field( $target, $f ) : '' );
			if ( 'category_id' === $f ) {
				$term = get_term( (int) $new );
				$new  = $term instanceof \WP_Term ? $term->name : $new;
			} elseif ( 'featured_image' === $f ) {
				$new = (string) wp_get_attachment_image( (int) $new, 'thumbnail' ) . ' ' . wp_basename( (string) wp_get_attachment_url( (int) $new ) );
			}
			self::render_field_diff( $f, $old, (string) $new, in_array( $f, Content::HTML, true ) );
		}
		foreach ( $p['patches'] as $f => $list ) {
			foreach ( $list as $n => $patch ) {
				/* translators: 1: field label, 2: patch number */
				self::render_field_diff( sprintf( __( '%1$s — edit %2$d', 'content-agent' ), self::field_label( $f ), $n + 1 ), $patch['find'], $patch['replace'], true, true );
			}
		}

		if ( ! Proposals::can_decide( $p ) ) {
			echo '<p><em>' . esc_html__( 'You do not have permission to change this page.', 'content-agent' ) . '</em></p>';
			return;
		}
		$form = static function ( string $do, string $label, string $class, string $extra = '' ) use ( $p ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" class="ca-action">';
			wp_nonce_field( 'content_agent_decide_' . $p['id'] );
			echo '<input type="hidden" name="action" value="content_agent_decide"><input type="hidden" name="proposal" value="' . (int) $p['id'] . '"><input type="hidden" name="do" value="' . esc_attr( $do ) . '">';
			echo $extra; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup.
			echo '<button type="submit" class="button ' . esc_attr( $class ) . '">' . esc_html( $label ) . '</button></form>';
		};
		echo '<div class="ca-actions">';
		if ( 'pending' === $p['status'] ) {
			$form( 'apply', 'create' === $p['action'] ? __( 'Create draft', 'content-agent' ) : __( 'Apply changes', 'content-agent' ), 'button-primary' );
			$form( 'reject', __( 'Reject', 'content-agent' ), '', '<input type="text" name="reason" class="regular-text" placeholder="' . esc_attr__( 'Reason (shown to the assistant)', 'content-agent' ) . '"> ' );
		} elseif ( 'applied' === $p['status'] ) {
			$form( 'revert', 'create' === $p['action'] ? __( 'Move the created draft to trash', 'content-agent' ) : __( 'Revert to previous version', 'content-agent' ), '' );
		}
		echo '</div>';
	}

	private static function render_field_diff( string $field, string $old, string $new, bool $html, bool $is_label = false ): void {
		$label = $is_label ? $field : self::field_label( $field );
		echo '<div class="ca-field"><h2>' . esc_html( $label ) . '</h2>';
		if ( 'featured_image' === $field ) {
			echo '<div>' . wp_kses_post( $new ) . '</div></div>';
			return;
		}
		$prep = static function ( string $s ) use ( $html ) {
			if ( ! $html ) {
				return $s;
			}
			$s = Blocks::strip( $s );
			return trim( (string) preg_replace( '#(</(?:p|h[1-6]|li|ul|ol|table|tr|blockquote|figure|div)>)#i', "$1\n", $s ) );
		};
		$diff = wp_text_diff(
			$prep( $old ),
			$prep( $new ),
			array(
				'title_left'  => __( 'Current', 'content-agent' ),
				'title_right' => __( 'Proposed', 'content-agent' ),
			)
		);
		echo $diff ? wp_kses_post( $diff ) : '<p><em>' . esc_html__( 'No change.', 'content-agent' ) . '</em></p>';
		if ( $html && '' !== trim( $new ) ) {
			echo '<details><summary>' . esc_html__( 'Preview proposed content', 'content-agent' ) . '</summary><div class="ca-preview">' . wp_kses_post( Blocks::strip( $new ) ) . '</div></details>';
		}
		echo '</div>';
	}

	public static function handle_decide(): void {
		$id = isset( $_POST['proposal'] ) ? absint( $_POST['proposal'] ) : 0;
		check_admin_referer( 'content_agent_decide_' . $id );
		$p = Proposals::get( $id );
		if ( ! $p || ! Proposals::can_decide( $p ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'content-agent' ), 403 );
		}
		$do = isset( $_POST['do'] ) ? sanitize_key( wp_unslash( $_POST['do'] ) ) : '';
		switch ( $do ) {
			case 'apply':
				$r    = Proposals::apply( $id );
				$done = 'applied';
				break;
			case 'reject':
				$r    = Proposals::reject( $id, isset( $_POST['reason'] ) ? sanitize_textarea_field( wp_unslash( $_POST['reason'] ) ) : '' );
				$done = 'rejected';
				break;
			case 'revert':
				$r    = Proposals::revert( $id );
				$done = 'reverted';
				break;
			default:
				$r    = new \WP_Error( 'content_agent', 'Unknown action' );
				$done = '';
		}
		$args = is_wp_error( $r ) ? array( 'ca_error' => rawurlencode( $r->get_error_message() ) ) : array( 'ca_done' => $done );
		wp_safe_redirect( add_query_arg( $args, Proposals::review_url( $id ) ) );
		exit;
	}

	// ------------------------------------------------------------------ settings UI

	public static function page_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'content-agent' ) );
		}
		$s      = Settings::get();
		$health = self::backend_health( (string) $s['backend_url'] );
		/* translators: %s: plugin brand name */
		echo '<div class="wrap content-agent"><h1>' . esc_html( sprintf( __( '%s settings', 'content-agent' ), Brand::name() ) ) . '</h1>';
		self::notice_from_query();
		self::render_connect( $s );
		$via_service = Settings::via_service();

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'content_agent_settings' );
		echo '<input type="hidden" name="action" value="content_agent_settings"><table class="form-table" role="presentation">';
		if ( $via_service ) {
			// Set by the service; editing them by hand would break the connection.
			self::row( __( 'Backend URL', 'content-agent' ), '<code>' . esc_html( $s['backend_url'] ) . '</code> ' . $health );
			self::row( __( 'Site ID', 'content-agent' ), '<code>' . esc_html( $s['site_id'] ) . '</code>' );
		} else {
			self::row(
				__( 'Backend URL', 'content-agent' ),
				'<input type="url" name="backend_url" class="regular-text code" value="' . esc_attr( $s['backend_url'] ) . '" placeholder="https://agent.example.com"> ' . $health . '<p class="description">' . esc_html__( 'Where the cms-content-agent service runs (HTTPS).', 'content-agent' ) . '</p>'
			);
			self::row( __( 'Site ID', 'content-agent' ), '<input type="text" name="site_id" class="regular-text code" pattern="[A-Za-z0-9_-]{1,40}" value="' . esc_attr( $s['site_id'] ) . '"><p class="description">' . esc_html__( 'Key of this site in the backend config. Letters, numbers, - and _.', 'content-agent' ) . '</p>' );
		}
		self::row( __( 'Assistant name', 'content-agent' ), '<input type="text" name="assistant_name" class="regular-text" value="' . esc_attr( $s['assistant_name'] ) . '" placeholder="' . esc_attr__( 'Content assistant', 'content-agent' ) . '">' );
		self::row( __( 'Chat widget', 'content-agent' ), '<label><input type="checkbox" name="widget_enabled" value="1"' . checked( $s['widget_enabled'], true, false ) . '> ' . esc_html__( 'Show the chat button in wp-admin', 'content-agent' ) . '</label>' );
		$caps = array(
			'edit_posts'        => __( 'Contributors and above (edit_posts)', 'content-agent' ),
			'publish_posts'     => __( 'Authors and above (publish_posts)', 'content-agent' ),
			'edit_others_posts' => __( 'Editors and above (edit_others_posts)', 'content-agent' ),
			'manage_options'    => __( 'Administrators only (manage_options)', 'content-agent' ),
		);
		$sel  = '<select name="capability">';
		foreach ( $caps as $cap => $label ) {
			$sel .= '<option value="' . esc_attr( $cap ) . '"' . selected( $s['capability'], $cap, false ) . '>' . esc_html( $label ) . '</option>';
		}
		self::row( __( 'Who can chat', 'content-agent' ), $sel . '</select><p class="description">' . esc_html__( 'Applying proposals still requires permission to edit the page concerned.', 'content-agent' ) . '</p>' );
		if ( ! $via_service ) {
			self::row( __( 'Rotate secrets', 'content-agent' ), '<label><input type="checkbox" name="rotate" value="1"> ' . esc_html__( 'Generate a new token secret and API key (update the backend config afterwards)', 'content-agent' ) . '</label>' );
		}
		echo '</table>';
		submit_button();
		echo '</form>';
		if ( $via_service ) {
			echo '</div>';
			self::styles();
			return;
		}

		$snippet = wp_json_encode( Settings::backend_snippet(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		echo '<h2>' . esc_html__( 'Backend configuration', 'content-agent' ) . '</h2>';
		echo '<p>' . esc_html__( 'Add this entry to config/sites.json on the backend (merge it into the existing object), then restart the service. It contains secrets: keep it private.', 'content-agent' ) . '</p>';
		echo '<textarea readonly rows="16" class="large-text code" onclick="this.select()">' . esc_textarea( (string) $snippet ) . '</textarea>';

		echo '<h2>' . esc_html__( 'Detected', 'content-agent' ) . '</h2><ul class="ul-disc">';
		echo '<li>' . esc_html__( 'SEO fields', 'content-agent' ) . ': <strong>' . esc_html( Seo::label() ) . '</strong></li>';
		echo '<li>WooCommerce: <strong>' . ( Content::has_woo() ? esc_html__( 'active — products are synced', 'content-agent' ) : esc_html__( 'not active', 'content-agent' ) ) . '</strong></li>';
		echo '<li>' . esc_html__( 'REST API base', 'content-agent' ) . ': <code>' . esc_html( rest_url( Rest::NS ) ) . '</code></li>';
		echo '</ul></div>';
		self::styles();
	}

	/** "Connect to <service>" box, shown only by builds that have a service (Brand::service_url()). */
	private static function render_connect( array $s ): void {
		$service = Brand::service_url();
		if ( '' === $service ) {
			return;
		}
		$host = (string) wp_parse_url( $service, PHP_URL_HOST );
		echo '<div class="card" style="max-width:720px"><h2>' . esc_html( Brand::name() ) . '</h2>';
		if ( Settings::via_service() && Settings::is_connected() ) {
			/* translators: %s: service host name */
			echo '<p><span class="ca-status ca-applied">' . esc_html__( 'Connected', 'content-agent' ) . '</span> ' . esc_html( sprintf( __( 'This site is connected to %s.', 'content-agent' ), $host ) ) . '</p>';
			$label = __( 'Connect again (new keys)', 'content-agent' );
		} else {
			/* translators: %s: service host name */
			echo '<p>' . esc_html( sprintf( __( 'Connect this site to %s in one click: sign in, choose your workspace, and you are done. No keys to copy.', 'content-agent' ), $host ) ) . '</p>';
			$label = __( 'Connect', 'content-agent' );
		}
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'content_agent_connect' );
		echo '<input type="hidden" name="action" value="content_agent_connect">';
		submit_button( $label, 'primary', 'submit', false );
		echo '</form>';
		if ( Settings::via_service() ) {
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:8px">';
			wp_nonce_field( 'content_agent_disconnect' );
			echo '<input type="hidden" name="action" value="content_agent_disconnect">';
			submit_button( __( 'Disconnect', 'content-agent' ), 'secondary', 'submit', false );
			echo '</form>';
		}
		echo '</div>';
	}

	private static function row( string $label, string $html ): void {
		echo '<tr><th scope="row">' . esc_html( $label ) . '</th><td>' . $html . '</td></tr>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts.
	}

	private static function backend_health( string $url ): string {
		if ( '' === $url ) {
			return '';
		}
		$r  = wp_remote_get( trailingslashit( $url ) . 'api/health', array( 'timeout' => 5 ) );
		$ok = ! is_wp_error( $r ) && 200 === wp_remote_retrieve_response_code( $r );
		return $ok
			? '<span class="ca-status ca-applied">' . esc_html__( 'Reachable', 'content-agent' ) . '</span>'
			: '<span class="ca-status ca-rejected">' . esc_html__( 'Not reachable', 'content-agent' ) . '</span>';
	}

	public static function handle_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'content-agent' ), 403 );
		}
		check_admin_referer( 'content_agent_settings' );
		// phpcs:disable WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$via_service = Settings::via_service();
		$caps    = array( 'edit_posts', 'publish_posts', 'edit_others_posts', 'manage_options' );
		$cap     = isset( $_POST['capability'] ) ? sanitize_key( wp_unslash( $_POST['capability'] ) ) : 'edit_others_posts';
		$site_id = isset( $_POST['site_id'] ) ? preg_replace( '/[^A-Za-z0-9_-]/', '', wp_unslash( $_POST['site_id'] ) ) : '';
		$changes = array(
			'backend_url'    => isset( $_POST['backend_url'] ) ? self::backend_url( esc_url_raw( wp_unslash( $_POST['backend_url'] ) ) ) : '',
			'site_id'        => substr( '' !== $site_id ? $site_id : Settings::default_site_id(), 0, 40 ),
			'assistant_name' => isset( $_POST['assistant_name'] ) ? sanitize_text_field( wp_unslash( $_POST['assistant_name'] ) ) : '',
			'widget_enabled' => ! empty( $_POST['widget_enabled'] ),
			'capability'     => in_array( $cap, $caps, true ) ? $cap : 'edit_others_posts',
		);
		// phpcs:enable
		if ( $via_service ) {
			// The service owns these; reconnect to change them.
			unset( $changes['backend_url'], $changes['site_id'] );
		} elseif ( ! empty( $_POST['rotate'] ) || strlen( (string) Settings::get( 'token_secret' ) ) < 32 ) {
			$changes['token_secret'] = Settings::random();
			$changes['api_key']      = Settings::random();
		}
		Settings::update( $changes );
		wp_safe_redirect( add_query_arg( array( 'page' => 'content-agent-settings', 'ca_done' => 'saved' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	private static function styles(): void {
		echo '<style>
.content-agent .ca-status{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;background:#f0f0f1;vertical-align:middle}
.content-agent .ca-pending{background:#fcf0c3;color:#6b4b00}.content-agent .ca-applied{background:#d7f0dd;color:#0a5b22}
.content-agent .ca-rejected{background:#fbdcdc;color:#8a1f1f}.content-agent .ca-reverted{background:#e5e5e5;color:#333}
.content-agent .ca-note{background:#fff;border-left:4px solid #2271b1;padding:8px 12px;margin:12px 0}
.content-agent .ca-field{background:#fff;border:1px solid #dcdcde;padding:4px 16px 12px;margin:16px 0}
.content-agent .ca-field h2{font-size:14px}
.content-agent table.diff{width:100%;table-layout:fixed}.content-agent table.diff td{word-wrap:break-word;vertical-align:top}
.content-agent .ca-preview{border:1px dashed #c3c4c7;padding:8px 16px;margin-top:8px;max-height:480px;overflow:auto}
.content-agent .ca-actions{display:flex;gap:12px;align-items:center;margin:20px 0}.content-agent .ca-action{display:flex;gap:6px;align-items:center}
</style>';
	}
}
