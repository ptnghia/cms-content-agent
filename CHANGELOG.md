# Changelog

## Unreleased

## 0.6.2 — Host-owned synced files

### Added
- `PUT /internal/sites/:id/seo/:name` writes `seo/<name>.md` with the workspace unlocked around the write, so a
  host can own synced data such as the keyword bank (`seo/keywords.md`) while the agent still only reads it.

### Fixed
- A failed unlock of a workspace (e.g. `chmod` error) left a holder behind, so the workspace was never locked again.

## 0.6.1 — Turn context for hosts

### Added
- `runTurn` receives `site`, `siteId`, `kind` and `requestId`, so a host's runTurn wrapper can pick the model per
  customer; the `api` adapter takes `model` per turn (falls back to `API_MODEL`).
- Usage records carry the turn's `requestId` (the same id as the hooks) and chat `afterTurn` gets `conversationId`.
- `beforeTurn` refusal codes `rate_limited` and `server_busy` answer HTTP 429.
- Plugin: `/ping` reports the site's `features` (e.g. `products` only with WooCommerce).

### Fixed
- Internal JSON tasks crashed with the real `api` adapter (no `onEvent` was passed); `onEvent` is now optional there.
- A turn that failed after spending tokens (e.g. "prompt is too long" at the tenth tool round) reported no usage, so it
  was neither recorded nor charged: the `api` adapter now attaches the usage spent to its error and the app meters it
  (chat, compose, tasks).
- A `beforeTurn` that answered after `hookTimeoutMs` could keep what it reserved: when it later says yes, `afterTurn` is
  called with `status: 'CANCELLED'` and zero usage so the host releases it.

## 0.6.0 — Extension points for hosted services

Lets a hosting layer (e.g. a SaaS) run the backend as a dependency without forking it. Self-hosting is unchanged.
Guide: [docs/EMBEDDING.md](docs/EMBEDDING.md).

### Added
- Package `exports`: `cms-content-agent` (createApp and helpers), `cms-content-agent/bridge`,
  `cms-content-agent/store/sqlite`, `cms-content-agent/testing/store-contract`. Deep imports are no longer supported.
- `createApp({ siteProvider })`: async site lookup (`get`, `allowsOrigin`, `list`); `createApp({ sites })` still works
  through `staticSiteProvider`.
- `createApp({ store })`: any store that passes the shared contract (`storeContract`); the default store is created
  only when none is injected.
- `beforeTurn` / `afterTurn` hooks around every AI turn (chat, compose, internal task): refuse with a code
  (402 / 423 / 403), and get usage exactly once per turn with a unique `requestId`, also on errors and disconnects.
- Optional `/internal/*` routes behind a token: sync one site, write `knowledge/<name>.md`, and JSON tasks
  (`keyword-clusters`, `seo-plan`, or your own).
- Plugin: **Connect** to a hosted service in one click (state + single-use code + server-to-server exchange, no secret
  in a URL); brand name and service URL through constants / filters; branded zips with
  `BRAND_NAME` / `BRAND_SERVICE_URL` / `BRAND_ZIP` (or `LIFETECH_BRAND=1`).

- Plugin: **Disconnect** from the service (regenerates the site's own keys); a build without that service falls back
  to the manual settings.
- Widget: shows the `message` a host returns with a refused turn.

### Changed
- `server/sync.mjs` creates workspace folders directly instead of going through the store.
- Turn hooks time out (`hookTimeoutMs`, default 10 s); `afterTurn` runs after the response and slot are released; a
  client that leaves while `beforeTurn` runs never starts a turn.

## 0.5.0 — Any language, Claude API backend, security review

Reviewed before release (plugin and backend); every fix below was verified in WordPress Playground or against the real
Claude Code CLI.

### Security
- Plugin: **stored XSS** through the built-in SEO title (a Contributor could set `_content_agent_meta_title` over the
  REST API and core prints `pre_get_document_title` unescaped). The meta is now sanitised on write and escaped on output.
- Plugin: proposal **patches cannot edit inside an HTML tag** (an injected `onmouseover` was invisible to `wp_kses_post`).
- Plugin: the "Write with AI" preview sanitises model HTML (`wp.dom.safeHTML`).
- Plugin: reverting a created post requires `delete_post` on it; the review queue and diffs (which show the current,
  possibly private content) require `edit_others_posts` and permission on the target; the chat now defaults to
  `edit_others_posts` (it reads drafts and private content through the API key); proposals cannot be created through
  core UIs; the backend URL must be https (http only for localhost).
- Backend: the Claude Code agent cannot write to the shared skills / knowledge folders or plant `CLAUDE.md` /
  `.claude/` in a workspace, and runs without the operator's MCP servers or project settings
  (`--strict-mcp-config --setting-sources user` + deny rules). The Docker image's `/app` is root-owned.
- Backend: content ids from the site API must be numeric before they become file names (path traversal across sites).
- Backend: the concurrent-run limit can no longer be bypassed with parallel requests; the `api` agent's `search` is a
  literal match (no model-controlled regex on the event loop); Markdown proposal links escape quotes; internal errors
  are logged instead of returned; `DEV_MODE` refuses to start on a non-loopback host and serves dev routes only to a
  loopback `Host`.
- Docs: Codex and agy can read any file the service user can read; run them as a separate user (docs/DEPLOY.md).

### Added
- **`AGENT_BACKEND=api`**: Claude through the Messages API (`@anthropic-ai/sdk`, the project's only npm dependency),
  no CLI process. The agent loop runs in the backend with file tools (`list_files`, `read_file`, `search`,
  `write_file`, `edit_file`) confined in code: reads stay inside the workspace and the extra folders (symlinks
  resolved), writes only to `plans/`, `drafts/`, `outbox/` and `notes.md`. Streaming text, prompt caching, server-side
  refusal fallback, stored history for resume, cost from a price table (`API_PRICES` to override). Model: `API_MODEL`
  (default `claude-opus-5-5`), effort: `API_EFFORT`.
- Docker image installs npm dependencies.


### Changed
- **Prompts, skills and workspace files are English**; the agent writes website content in the site's `language`
  (the plugin sets it from the WordPress locale) and replies in the language the editor writes in. Verified with Claude
  Code on a Vietnamese and an English site.
- Backend chat messages and errors are localised (`server/i18n.mjs`, English + Vietnamese, chosen by `site.language`
  or `site.uiLanguage`). The chat widget has an `I18N` table (English + Vietnamese) and a `data-lang` attribute; the
  plugin passes the user's WordPress locale.
- Compose `length` values are `short | medium | long` (the old `ngan | vua | dai` are still accepted).
- Plugin: the widget is loaded with `wp_enqueue_script`; bundled translations load with `load_textdomain` (no
  `load_plugin_textdomain`); readme documents the external services. **Plugin Check: no errors** (general, plugin_repo,
  security, performance, accessibility).

### Field test
First run against a real agent (Claude Code) on a WordPress + WooCommerce + Yoast test site; see
[docs/FIELD_TEST.md](docs/FIELD_TEST.md).

#### Fixed
- **Internal links**: prompts and the internal-linking skill still told the agent to write `slug.html` links (a leftover
  from the first CMS), which produce broken links on WordPress. The workspace now lists a root-relative **Link** for every
  page (`site/inventory.md`, compose page list) and the agent is told to copy it verbatim.
- Category tables say "post category" / "product category" instead of `post` / `product`, so the agent no longer
  reports a post category and a product category with the same name as duplicates.
- The agent pointed editors to a menu that does not exist; it now says wp-admin → Content Agent → Proposals.

#### Added
- Plugin: proposals warn about **same-site links that match no post, page, product or term** (relative `*.html`
  links included). The warning shows in the review queue and in the agent's delivery report.
- Usage log records the **model** of each request; `/api/usage` returns `byModel`. SQLite stores add the column on start.

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
