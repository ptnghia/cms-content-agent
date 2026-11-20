<?php
/**
 * Plugin Name:       Content Agent
 * Plugin URI:        https://github.com/ptnghia/cms-content-agent
 * Description:       AI content & SEO assistant for wp-admin. Chat with an agent that knows your posts, pages and products, audits SEO and writes or optimises content. Every change waits in a review queue until you apply it.
 * Version:           0.6.2
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            cms-content-agent contributors
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Text Domain:       content-agent
 * Domain Path:       /languages
 */

defined( 'ABSPATH' ) || exit;

define( 'CONTENT_AGENT_VERSION', '0.6.2' );
define( 'CONTENT_AGENT_FILE', __FILE__ );
define( 'CONTENT_AGENT_DIR', plugin_dir_path( __FILE__ ) );
define( 'CONTENT_AGENT_URL', plugin_dir_url( __FILE__ ) );

// A branded build ships brand.php (CONTENT_AGENT_BRAND_NAME, CONTENT_AGENT_SERVICE_URL); see includes/class-brand.php.
if ( is_readable( CONTENT_AGENT_DIR . 'brand.php' ) ) {
	require_once CONTENT_AGENT_DIR . 'brand.php';
}
require_once CONTENT_AGENT_DIR . 'includes/class-brand.php';
require_once CONTENT_AGENT_DIR . 'includes/class-token.php';
require_once CONTENT_AGENT_DIR . 'includes/class-settings.php';
require_once CONTENT_AGENT_DIR . 'includes/class-seo.php';
require_once CONTENT_AGENT_DIR . 'includes/class-blocks.php';
require_once CONTENT_AGENT_DIR . 'includes/class-content.php';
require_once CONTENT_AGENT_DIR . 'includes/class-audit.php';
require_once CONTENT_AGENT_DIR . 'includes/class-proposals.php';
require_once CONTENT_AGENT_DIR . 'includes/class-rest.php';
require_once CONTENT_AGENT_DIR . 'includes/class-admin.php';
require_once CONTENT_AGENT_DIR . 'includes/class-connect.php';
require_once CONTENT_AGENT_DIR . 'includes/class-editor.php';

register_activation_hook( __FILE__, array( 'ContentAgent\\Settings', 'activate' ) );

// Translations from translate.wordpress.org load automatically; the bundled files cover zip installs from GitHub.
add_action(
	'init',
	static function () {
		$locale = determine_locale();
		if ( ! is_textdomain_loaded( 'content-agent' ) && is_readable( CONTENT_AGENT_DIR . "languages/content-agent-{$locale}.l10n.php" ) ) {
			load_textdomain( 'content-agent', CONTENT_AGENT_DIR . "languages/content-agent-{$locale}.mo", $locale );
		}
	},
	1
);

add_action( 'init', array( 'ContentAgent\\Proposals', 'register' ) );
add_action( 'rest_api_init', array( 'ContentAgent\\Rest', 'register' ) );
ContentAgent\Seo::hooks();
ContentAgent\Admin::hooks();
ContentAgent\Connect::hooks();
ContentAgent\Editor::hooks();
