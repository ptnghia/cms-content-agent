<?php
/**
 * Remove settings and the review queue when the plugin is deleted (not on deactivation).
 * Content already applied to posts stays; built-in SEO fields (_content_agent_meta_*) are kept so pages keep their meta.
 *
 * @package ContentAgent
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'content_agent_settings' );
delete_transient( 'content_agent_audit' );

$content_agent_ids = get_posts(
	array(
		'post_type'      => 'ca_proposal',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);
foreach ( $content_agent_ids as $content_agent_id ) {
	wp_delete_post( $content_agent_id, true );
}
