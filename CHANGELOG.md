# Changelog

## Unreleased

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
