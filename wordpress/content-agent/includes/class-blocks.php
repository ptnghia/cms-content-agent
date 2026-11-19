<?php
/**
 * HTML <-> block markup helpers.
 *
 * The agent reads and writes plain HTML. Posts edited with the block editor store block comments, so:
 *  - strip(): block markup -> clean HTML sent to the agent,
 *  - from_html(): agent HTML -> blocks (paragraph, heading, list natively; anything else as a Custom HTML
 *    block so tables, figures and embeds render exactly as written).
 *
 * @package ContentAgent
 */

namespace ContentAgent;

defined( 'ABSPATH' ) || exit;

final class Blocks {

	public static function strip( string $content ): string {
		$html = preg_replace( '/<!--\s*\/?wp:[^>]*?-->\s*/', '', $content );
		return trim( (string) preg_replace( "/\n{3,}/", "\n\n", (string) $html ) );
	}

	public static function uses_blocks( string $content ): bool {
		return false !== strpos( $content, '<!-- wp:' );
	}

	public static function from_html( string $html ): string {
		$html = trim( $html );
		if ( '' === $html ) {
			return '';
		}
		$doc = new \DOMDocument();
		$prev = libxml_use_internal_errors( true );
		$doc->loadHTML( '<?xml encoding="utf-8"?><div id="ca-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
		libxml_clear_errors();
		libxml_use_internal_errors( $prev );
		$root = $doc->getElementById( 'ca-root' );
		if ( ! $root ) {
			return "<!-- wp:html -->\n" . $html . "\n<!-- /wp:html -->";
		}

		$out    = array();
		$inline = '';
		$flush  = static function () use ( &$inline, &$out ) {
			if ( '' !== trim( $inline ) ) {
				$out[] = "<!-- wp:paragraph -->\n<p>" . trim( $inline ) . "</p>\n<!-- /wp:paragraph -->";
			}
			$inline = '';
		};

		foreach ( iterator_to_array( $root->childNodes ) as $node ) {
			if ( XML_TEXT_NODE === $node->nodeType || ( XML_ELEMENT_NODE === $node->nodeType && self::is_inline( $node->nodeName ) ) ) {
				$inline .= $doc->saveHTML( $node );
				continue;
			}
			if ( XML_ELEMENT_NODE !== $node->nodeType ) {
				continue;
			}
			$flush();
			$tag   = strtolower( $node->nodeName );
			$outer = trim( $doc->saveHTML( $node ) );
			if ( 'p' === $tag ) {
				$out[] = "<!-- wp:paragraph -->\n" . $outer . "\n<!-- /wp:paragraph -->";
			} elseif ( preg_match( '/^h([1-6])$/', $tag, $m ) ) {
				$level = (int) $m[1];
				$inner = self::inner_html( $doc, $node );
				$attrs = 2 === $level ? '' : ' {"level":' . $level . '}';
				$out[] = '<!-- wp:heading' . $attrs . " -->\n<h{$level} class=\"wp-block-heading\">" . $inner . "</h{$level}>\n<!-- /wp:heading -->";
			} elseif ( 'ul' === $tag || 'ol' === $tag ) {
				$out[] = self::list_block( $doc, $node, 'ol' === $tag );
			} else {
				$out[] = "<!-- wp:html -->\n" . $outer . "\n<!-- /wp:html -->";
			}
		}
		$flush();
		return implode( "\n\n", $out );
	}

	private static function is_inline( string $name ): bool {
		return in_array( strtolower( $name ), array( 'a', 'strong', 'b', 'em', 'i', 'span', 'code', 'br', 'img', 'small', 'sup', 'sub', 'mark' ), true );
	}

	private static function inner_html( \DOMDocument $doc, \DOMNode $node ): string {
		$html = '';
		foreach ( $node->childNodes as $c ) {
			$html .= $doc->saveHTML( $c );
		}
		return trim( $html );
	}

	private static function list_block( \DOMDocument $doc, \DOMNode $node, bool $ordered ): string {
		$items = array();
		foreach ( $node->childNodes as $li ) {
			if ( XML_ELEMENT_NODE === $li->nodeType && 'li' === strtolower( $li->nodeName ) ) {
				$items[] = "<!-- wp:list-item -->\n<li>" . self::inner_html( $doc, $li ) . "</li>\n<!-- /wp:list-item -->";
			}
		}
		$tag   = $ordered ? 'ol' : 'ul';
		$attrs = $ordered ? ' {"ordered":true}' : '';
		return '<!-- wp:list' . $attrs . " -->\n<{$tag} class=\"wp-block-list\">" . implode( "\n", $items ) . "</{$tag}>\n<!-- /wp:list -->";
	}
}
