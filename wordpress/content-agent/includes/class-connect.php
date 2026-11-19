<?php
/**
 * "Connect to <service>": one click instead of copying secrets by hand (needs Brand::service_url()).
 *
 *   1. The admin clicks Connect: a random state is stored for 10 minutes and the browser goes to
 *      <service>/connect?site_url&rest_url&return_url&state.
 *   2. The admin signs in to the service and approves; the service redirects back to return_url
 *      with ?code&state.
 *   3. This site checks the state, then exchanges the one-time code server-to-server:
 *      POST <service>/api/connect/exchange {code, site_url}
 *      -> {site_id, agent_url, api_key, token_secret}
 *   4. The settings are saved (as if pasted by hand) and the chat widget turns on.
 *
 * No secret ever travels in a URL: the code is single-use and short-lived, the secrets come back
 * only in the server-to-server response.
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Connect {

	const STATE_TTL = 600;

	public static function hooks(): void {
		add_action( 'admin_post_content_agent_connect', array( self::class, 'start' ) );
		add_action( 'admin_post_content_agent_connect_return', array( self::class, 'finish' ) );
		add_action( 'admin_post_content_agent_disconnect', array( self::class, 'disconnect' ) );
	}

	/** Error codes shown on the settings page (Admin::notice_from_query); never free text from the URL. */
	public static function error_messages(): array {
		return array(
			'no_service'  => __( 'This build has no service to connect to.', 'content-agent' ),
			'expired'     => __( 'The connection request expired or was not started from this site. Please click Connect again.', 'content-agent' ),
			'cancelled'   => __( 'The connection was cancelled.', 'content-agent' ),
			'unreachable' => __( 'Could not reach the service. Please try again.', 'content-agent' ),
			'rejected'    => __( 'The service refused the connection code (expired or already used). Please click Connect again.', 'content-agent' ),
			'invalid'     => __( 'The service sent an invalid response.', 'content-agent' ),
		);
	}

	public static function return_url(): string {
		return admin_url( 'admin-post.php?action=content_agent_connect_return' );
	}

	private static function state_key( string $state ): string {
		return 'content_agent_connect_' . substr( hash( 'sha256', $state ), 0, 40 );
	}

	private static function back( array $args ): void {
		wp_safe_redirect( add_query_arg( array_merge( array( 'page' => 'content-agent-settings' ), $args ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** Step 1: POST from the settings page. */
	public static function start(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'content-agent' ), 403 );
		}
		check_admin_referer( 'content_agent_connect' );
		$service = Brand::service_url();
		if ( '' === $service ) {
			self::back( array( 'ca_err' => 'no_service' ) );
		}
		$state = Settings::random();
		set_transient( self::state_key( $state ), get_current_user_id(), self::STATE_TTL );
		$url = add_query_arg(
			array(
				'site_url'   => rawurlencode( home_url() ),
				'rest_url'   => rawurlencode( rest_url( Rest::NS ) ),
				'return_url' => rawurlencode( self::return_url() ),
				'state'      => $state,
				'name'       => rawurlencode( get_bloginfo( 'name' ) ),
				'language'   => rawurlencode( substr( get_locale(), 0, 2 ) ),
			),
			$service . '/connect'
		);
		// The service is a different host on purpose; wp_safe_redirect would refuse it.
		wp_redirect( $url ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
		exit;
	}

	/** Step 3: GET back from the service with ?code&state. */
	public static function finish(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'content-agent' ), 403 );
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- the one-time state is the CSRF check.
		$state = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( $_GET['state'] ) ) : '';
		$code  = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( $_GET['code'] ) ) : '';
		$error = isset( $_GET['error'] ) ? sanitize_key( wp_unslash( $_GET['error'] ) ) : '';
		// phpcs:enable

		$owner = '' !== $state ? get_transient( self::state_key( $state ) ) : false;
		if ( '' !== $state ) {
			delete_transient( self::state_key( $state ) ); // single use, whatever happens next
		}
		if ( false === $owner || (int) $owner !== get_current_user_id() ) {
			self::back( array( 'ca_err' => 'expired' ) );
		}
		if ( '' !== $error || '' === $code ) {
			self::back( array( 'ca_err' => 'cancelled' ) );
		}

		$result = self::exchange( $code );
		if ( is_wp_error( $result ) ) {
			self::back( array( 'ca_err' => $result->get_error_code() ) );
		}
		Settings::update( $result );
		self::back( array( 'ca_done' => 'connected' ) );
	}

	/**
	 * Forgets the service: the agent URL is cleared and the site's own secrets are regenerated, so
	 * the keys the service holds stop working. Settings return to manual mode.
	 */
	public static function disconnect(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'content-agent' ), 403 );
		}
		check_admin_referer( 'content_agent_disconnect' );
		Settings::update(
			array(
				'backend_url'       => '',
				'site_id'           => Settings::default_site_id(),
				'api_key'           => Settings::random(),
				'token_secret'      => Settings::random(),
				'connected_service' => '',
				'connected_at'      => '',
			)
		);
		self::back( array( 'ca_done' => 'disconnected' ) );
	}

	/**
	 * Trades the one-time code for the site's settings.
	 *
	 * @return array|\WP_Error Settings changes, or an error with a message for the admin.
	 */
	public static function exchange( string $code ) {
		$service = Brand::service_url();
		if ( '' === $service ) {
			return new \WP_Error( 'no_service', __( 'This build has no service to connect to.', 'content-agent' ) );
		}
		$r = wp_remote_post(
			$service . '/api/connect/exchange',
			array(
				'timeout'     => 20,
				'redirection' => 0,
				'headers'     => array(
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
				),
				'body'        => wp_json_encode(
					array(
						'code'     => $code,
						'site_url' => home_url(),
					)
				),
			)
		);
		if ( is_wp_error( $r ) ) {
			return new \WP_Error( 'unreachable', __( 'Could not reach the service. Please try again.', 'content-agent' ) );
		}
		$status = (int) wp_remote_retrieve_response_code( $r );
		$data   = json_decode( (string) wp_remote_retrieve_body( $r ), true );
		if ( 200 !== $status || ! is_array( $data ) ) {
			return new \WP_Error( 'rejected', __( 'The service refused the connection code (expired or already used). Please click Connect again.', 'content-agent' ) );
		}
		return self::validate( $data, $service );
	}

	/**
	 * Checks the exchange response; never trust it blindly (it becomes a script URL in wp-admin).
	 *
	 * @return array|\WP_Error
	 */
	public static function validate( array $data, string $service ) {
		$site_id   = (string) ( $data['site_id'] ?? '' );
		$agent_url = Brand::secure_url( (string) ( $data['agent_url'] ?? '' ) );
		$api_key   = (string) ( $data['api_key'] ?? '' );
		$secret    = (string) ( $data['token_secret'] ?? '' );
		$valid     = preg_match( '/^[A-Za-z0-9_-]{1,40}$/', $site_id )
			&& '' !== $agent_url
			&& preg_match( '/^[A-Za-z0-9_-]{32,256}$/', $api_key )
			&& preg_match( '/^[A-Za-z0-9_-]{32,256}$/', $secret );
		if ( ! $valid ) {
			return new \WP_Error( 'invalid', __( 'The service sent an invalid response.', 'content-agent' ) );
		}
		return array(
			'backend_url'       => $agent_url,
			'site_id'           => $site_id,
			'api_key'           => $api_key,
			'token_secret'      => $secret,
			'connected_service' => $service,
			'connected_at'      => gmdate( 'c' ),
		);
	}
}
