=== Content Agent ===
Contributors: cms-content-agent
Tags: ai, seo, content, chatbot, woocommerce
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.4.0
License: MIT
License URI: https://opensource.org/licenses/MIT

An AI content & SEO assistant inside wp-admin. Every change it suggests waits in a review queue until you apply it.

== Description ==

Content Agent connects your site to a self-hosted [cms-content-agent](https://github.com/ptnghia/cms-content-agent) backend. The backend runs an AI coding agent (Claude Code, OpenAI Codex or agy).

* **Chat in wp-admin.** Ask "which posts have no meta description?", "plan 10 articles around keyword X" or "optimise product #42". The assistant knows every post, page, product and category on the site.
* **Review queue.** The assistant never edits your site. Its changes arrive under *Content Agent → Proposals* with a side-by-side diff. You apply, reject (with a reason the assistant sees) or revert them later.
* **Write with AI in the block editor.** A sidebar drafts or optimises the post you are editing, including SEO title, description and keywords.
* **SEO audit** of all published content (meta length, focus keyword, thin content, headings, image alt). It uses Yoast SEO or Rank Math scores when available.
* **WooCommerce.** Product descriptions and short descriptions can be optimised. Prices, SKU, stock and attributes are read-only facts, and proposals that change figures are refused.
* **No SEO plugin?** Built-in SEO title, description and keyword fields are printed in the page head.

New posts are always created as **drafts**.

== Installation ==

1. Run the backend (Docker or Node.js 22+) on a server you control. See the project README.
2. Install and activate this plugin.
3. Open *Content Agent → Settings*, enter the backend URL and save.
4. Copy the *Backend configuration* block into the backend's `config/sites.json` and restart the backend.
5. Click the chat button at the bottom right of wp-admin.

== Frequently Asked Questions ==

= Does my content leave my site? =
Yes: the backend syncs posts, pages, products and categories so the agent can read them, and the agent CLI sends prompts to its model provider. Host the backend yourself and review the provider's data policy.

= Can the assistant publish or delete content? =
No. It can only create proposals. Applying a proposal needs a logged-in user with permission to edit that page, and new posts are created as drafts.

== Changelog ==

= 0.4.0 =
* First release.
