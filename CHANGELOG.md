# Changelog

## Unreleased

## 0.4.0 — WordPress service

The project is now a service for WordPress: the backend plus a WordPress plugin. The plain-PHP helpers are removed.

### Added
- **WordPress plugin `content-agent`** (`wordpress/content-agent/`, PHP 7.4+, WP 6.2+, no dependencies):
  - REST API for the backend (`/wp-json/content-agent/v1`): posts **and pages**, categories, WooCommerce products and
    product categories, SEO audit, focus keywords, `/schema`, proposals. Authenticated with a generated API key.
  - **Review queue** in wp-admin: side-by-side diffs, Apply / Reject (with a reason the agent sees) / Revert from a backup.
    New posts and pages are created as drafts. Agent HTML is converted to valid Gutenberg blocks.
  - Validation: allowed fields per type, patches must match exactly once, and for products/categories proposals that
    change or drop a figure on the page are refused.
  - **Yoast SEO / Rank Math** support (meta written to the SEO plugin, which is then refreshed); built-in SEO fields with
    front-end output when neither is active.
  - **Chat widget** embedded in wp-admin (tokens via admin-ajax, image attachments go to the media library).
  - **"Write with AI" sidebar** in the block editor (title, content as blocks, SEO fields).
  - Settings page that generates secrets and prints the backend `config/sites.json` entry, plus a backend health check.
  - English and Vietnamese UI.
- Backend: `page` content type; `schema` feature writes `site/fields.md`, the authoritative list of editable fields for the agent;
  rejection reasons appear in `outbox/STATUS.md`.
- `npm run build:wp`, `npm run lint:php`, CI job linting the plugin on PHP 7.4 and 8.3, release workflow that attaches the plugin zip.

### Removed
- `php/` (plain-PHP token and embed helpers). The plugin replaces them.

### Changed
- **Canonical, CMS-neutral field names** everywhere the agent writes or reads content: `name`, `excerpt`, `body`,
  `body_extra`, `faq`, `meta_title`, `meta_description`, `meta_keywords`, `slug`, `category_id`, `featured_image`
  (previously the column names of the first deployment's CMS). The new per-site `fieldMap` maps them to your CMS
  columns in proposals and compose requests/results.
- Compose answer sections are `===NAME/EXCERPT/META_TITLE/META_DESCRIPTION/KEYWORDS/NOTES/BODY===`.
- Proposal statuses are `pending | applied | rejected | reverted`.
- Product `facts` are rendered generically (any keys) instead of a fixed price/promotion schema.
- Uploaded images are no longer tied to one hard-coded path. The widget uses `url` from the upload response or the
  new `data-media-url`, and compose accepts images from `mediaOrigins`.
- Prompts no longer use travel-specific wording.

## 0.3.0 — first public release

Renamed from the private *Agent-Agy* project.

### Added
- **Claude Code adapter** (`AGENT_BACKEND=claude`): token streaming, `--resume`, usage and USD cost. Shell and
  network tools are disabled by default.
- Pluggable adapter layer (`bridge/adapters/`) with a shared process runner. agy, codex and claude share one contract.
- **SQLite storage** (`STORE_DRIVER=sqlite`, built-in `node:sqlite`) and `npm run migrate:sqlite`.
- **Usage log:** tokens, cached tokens, cost, duration and retries per request, available at `GET /api/usage`.
- **Per-user rate limits** for chat (`CHAT_PER_HOUR`) and compose (`COMPOSE_PER_HOUR`), with `Retry-After`.
- **Workspace write protection:** synced data and outbox bookkeeping are read-only between syncs (`WORKSPACE_LOCK`).
- **Sync health and alerts:** `/api/status` reports failures, and `SYNC_ALERT_WEBHOOK` is notified on repeated failure and recovery.
- Test suite (`npm test`, node:test, fake CLIs and a fake website API), GitHub Actions CI, Dockerfile, docker-compose.
- English README, MIT license, contributing guide and security policy.

### Changed
- Node.js >= 22.13 is required (Node 20 is end-of-life).
- `server/server.mjs` is now a thin entry point. The app lives in `server/app.mjs` (`createApp`).
- Conversation field `agyConversationId` is now `agentSessionId`. Old data is upgraded on read.
- The PHP helper is now `ContentAgent` (`php/ContentAgent.php`, `php/token.php`, env `AGENT_TOKEN_SECRET`).
  `window.AgyChat` is still available as an alias in the widget.
- Default agent backend is `claude`. Codex no longer forces a model (CLI default unless `CODEX_MODEL` is set).
