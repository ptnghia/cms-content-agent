<?php
/**
 * Block editor sidebar "Write with AI": calls the backend's /api/compose for the post being edited and
 * lets the author apply the title, excerpt, content and SEO fields. Nothing is saved until they save the post.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Editor {

	public static function hooks(): void {
		add_action( 'enqueue_block_editor_assets', array( self::class, 'enqueue' ) );
		add_action( 'init', array( self::class, 'register_meta' ) );
	}

	/** Built-in SEO fields are editable from the sidebar when no SEO plugin is active. */
	public static function register_meta(): void {
		if ( 'native' !== Seo::provider() ) {
			return;
		}
		foreach ( array( 'post', 'page' ) as $type ) {
			foreach ( Seo::NATIVE as $key ) {
				register_post_meta(
					$type,
					$key,
					array(
						'type'          => 'string',
						'single'        => true,
						'show_in_rest'  => true,
						'auth_callback' => static fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', $post_id ),
					)
				);
			}
		}
	}

	public static function enqueue(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! Settings::is_connected() || ! current_user_can( (string) Settings::get( 'capability' ) ) ) {
			return;
		}
		if ( $screen && ! in_array( $screen->post_type, array( 'post', 'page' ), true ) ) {
			return;
		}
		wp_enqueue_script(
			'content-agent-editor',
			CONTENT_AGENT_URL . 'assets/editor.js',
			array( 'wp-plugins', 'wp-edit-post', 'wp-editor', 'wp-element', 'wp-components', 'wp-data', 'wp-blocks' ),
			CONTENT_AGENT_VERSION,
			true
		);
		wp_localize_script(
			'content-agent-editor',
			'contentAgentEditor',
			array(
				'backend'     => untrailingslashit( (string) Settings::get( 'backend_url' ) ),
				'tokenUrl'    => Admin::ajax_url( 'content_agent_token' ),
				'seoProvider' => Seo::provider(),
				'seoKeys'     => Seo::NATIVE,
				'i18n'        => array(
					'title'        => __( 'Write with AI', 'content-agent' ),
					'modeNew'      => __( 'Write new content', 'content-agent' ),
					'modeOptimize' => __( 'Optimise this content', 'content-agent' ),
					'brief'        => __( 'What should it cover?', 'content-agent' ),
					'briefHelp'    => __( 'Topic, audience, points to include, tone…', 'content-agent' ),
					'keyword'      => __( 'Focus keyword', 'content-agent' ),
					'length'       => __( 'Length', 'content-agent' ),
					'short'        => __( 'Short (600–800 words)', 'content-agent' ),
					'medium'       => __( 'Medium (1000–1300 words)', 'content-agent' ),
					'long'         => __( 'Long (1500–2000 words)', 'content-agent' ),
					'scope'        => __( 'What to optimise', 'content-agent' ),
					'scopeAll'     => __( 'Content and SEO', 'content-agent' ),
					'scopeSeo'     => __( 'SEO fields only', 'content-agent' ),
					'scopeContent' => __( 'Content only', 'content-agent' ),
					'run'          => __( 'Generate', 'content-agent' ),
					'stop'         => __( 'Stop', 'content-agent' ),
					'working'      => __( 'Writing…', 'content-agent' ),
					'chars'        => __( 'characters', 'content-agent' ),
					'notes'        => __( 'Notes from the assistant', 'content-agent' ),
					'useTitle'     => __( 'Use title', 'content-agent' ),
					'useExcerpt'   => __( 'Use excerpt', 'content-agent' ),
					'replace'      => __( 'Replace content', 'content-agent' ),
					'append'       => __( 'Insert at the end', 'content-agent' ),
					'seo'          => __( 'SEO', 'content-agent' ),
					'metaTitle'    => __( 'SEO title', 'content-agent' ),
					'metaDesc'     => __( 'Meta description', 'content-agent' ),
					'metaKeywords' => __( 'Focus keywords', 'content-agent' ),
					'copy'         => __( 'Copy', 'content-agent' ),
					'copied'       => __( 'Copied', 'content-agent' ),
					'applySeo'     => __( 'Use SEO fields', 'content-agent' ),
					'seoPlugin'    => __( 'Copy these into your SEO plugin panel.', 'content-agent' ),
					'applied'      => __( 'Applied. Review and save the post when you are happy.', 'content-agent' ),
					'needBrief'    => __( 'Describe the content or enter a focus keyword.', 'content-agent' ),
					'needContent'  => __( 'There is no content to optimise yet.', 'content-agent' ),
				),
			)
		);
	}
}
