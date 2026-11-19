# cms-content-agent

**A self-hosted AI content & SEO assistant for your CMS admin panel.**
Drop one `<script>` tag into the admin of any website (PHP helpers included), and editors get a chat
assistant that knows every post, product and category on the site, audits SEO, plans content, writes and
optimises pages, and **sends every change to a human review queue instead of publishing it.**

The agent runs on coding-agent CLIs you already have (**Claude Code**, **OpenAI Codex**, or **agy**) with an
automatic fallback between them. There are no npm dependencies: you only need Node.js 22.13+.

[Tiếng Việt](README.vi.md) · [Deploy](docs/DEPLOY.md) · [Website API contract](docs/SITE_API.md) · [Roadmap](docs/PLAN.md) · [Contributing](CONTRIBUTING.md)

> The default prompts, skills and widget UI are written in **Vietnamese** (the project's first users).
> Everything is plain Markdown in `agent/` and `skills/`, so you can translate it. Contributions for other languages are welcome.

---

## Features

- **Embeddable chat widget.** One script tag, Shadow DOM (no CSS clashes), floating or inline. It supports streaming
  answers, stop, conversation history, sync button and image attachments.
- **Knows the website.** The backend pulls posts, products, categories, keywords and SEO audit results from your
  site's API into a per-site workspace, with pre-computed stats (missing meta, thin content, stale posts…).
- **Review before publish.** The agent never writes to the CMS. It drops proposals into `outbox/`, the backend
  posts them to the site's review queue (`POST /proposals`), and an admin applies or rejects them. If the site
  rejects a proposal (for example because a price changed), the agent gets the reason and fixes it once.
- **Editor plugin endpoint.** `/api/compose` returns a new or optimised article plus SEO meta in one shot for a
  "write with AI" button in CKEditor or a similar editor.
- **Pluggable agent CLIs.** `claude`, `codex` and `agy` adapters share one interface. Fallback to a second CLI uses a
  cooldown, and every session resumes on the CLI that created it.
- **Skills library.** Add `skills/<name>/SKILL.md` and both chat and compose pick it up. Skills included: SEO on-page,
  content plan, writing, internal linking, keyword clustering, marketing copy, translation.
- **Multi-site & multilingual.** One backend serves many sites. A translated site can read its source site's workspace.
- **Operations built in.** Per-user rate limits, token and cost usage log (`/api/usage`), file or SQLite storage,
  periodic sync with webhook alerts, and read-only protection of synced data in the agent workspace.

## How it works

```
 CMS admin (any stack)                     cms-content-agent (Node, no deps)               Agent CLI
┌──────────────────────┐  SSE + Bearer   ┌─────────────────────────────────────┐  spawn  ┌──────────────┐
│ <script widget.js>   │ ───────────────►│ /api/chat  /api/compose             │ ──────► │ claude -p    │
│ token endpoint (PHP) │  short-lived    │ conversations, usage  (file|sqlite) │         │ codex exec   │
└──────────┬───────────┘  HMAC token     │ data/sites/<id>/  = agent workspace │ ◄────── │ agy -p       │
           │                             │   posts/ content/ seo/   (read-only)│  JSONL  └──────────────┘
           │ Website API (docs/SITE_API) │   plans/ drafts/ outbox/ notes.md   │
           └────────────────────────────►│ sync ◄── GET /posts /products …     │
             review queue  ◄─────────────│ outbox ──► POST /proposals          │
                                         └─────────────────────────────────────┘
```

The agent works **only on files** in its workspace. It reads synced data and writes plans, drafts and proposals.
The backend handles network access, sync and delivery, so the agent never needs shell or network tools, and they
are disabled by default.

## Quick start (local)

```bash
git clone https://github.com/ptnghia/cms-content-agent.git && cd cms-content-agent
cp .env.example .env                                   # AGENT_BACKEND=claude by default
cp config/sites.example.json config/sites.json
# in config/sites.json set: "tokenSecret" (openssl rand -hex 32),
#   "api": { "base": "http://127.0.0.1:4000/api/agent", "key": "dev-key" }

npm run mock-site      # terminal 1: fake website API with 235 posts on :4000
npm run dev            # terminal 2: backend on http://127.0.0.1:3000 with a demo admin page
```

Open http://127.0.0.1:3000, press **Đồng bộ** (sync), and ask, for example, *"Bài nào thiếu meta description?"*
("Which posts are missing a meta description?").
You need one agent CLI installed and logged in (for example `claude`, then `/login`, or `ANTHROPIC_API_KEY` in the environment).
Check it with `npm run smoke`.

## Docker

```bash
cp config/sites.example.json config/sites.json   # edit it
docker compose up -d --build                     # backend on 127.0.0.1:3000 (Claude Code preinstalled)
docker compose run --rm agent claude             # one-time login, stored in a volume
docker compose --profile dev up                  # optionally also start the mock website API
```

Build with `--build-arg INSTALL_CODEX=1` to add Codex. The container runs as a non-root user (required for the
read-only workspace protection). Production setup (systemd, nginx with SSE): [docs/DEPLOY.md](docs/DEPLOY.md).

## Agent backends

| `AGENT_BACKEND` | CLI | Streaming | Resume | Usage / cost | Notes |
|---|---|---|---|---|---|
| `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | tokens | `--resume` | tokens + USD | `Bash`, `WebFetch`, `WebSearch` disabled by default (`CLAUDE_DISALLOWED_TOOLS`) |
| `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) | final message | `exec resume` | tokens | sandbox `workspace-write`, no network |
| `agy` | agy | tokens | `--conversation` | as reported | headless mode refuses commands |

Set `AGENT_FALLBACK=codex` (for example) to retry a failed turn on another CLI. After a failure the backup is
preferred for `AGENT_FALLBACK_COOLDOWN_SEC`. Text that was already streamed is never replayed on another CLI.

**Adding a CLI:** create `bridge/adapters/<name>.mjs` exporting `name` and `runTurn(opts)`, which returns
`{sessionId, response, status, denied, usage}` and emits `init` / `delta` / `step` events. Register it in
`bridge/index.mjs` and add a test with `test/fixtures/fake-agent.mjs`.

## Configuration

**`config/sites.json`**: one entry per website:

```jsonc
{
  "main": {
    "name": "My website",
    "language": "vi",
    "tokenSecret": "<openssl rand -hex 32>",        // shared with the site's token endpoint
    "allowedOrigins": ["https://admin.example.com"],
    "api": {
      "base": "https://example.com/api/agent",       // see docs/SITE_API.md
      "key": "<site API key>",
      "features": ["content", "products", "categories", "keywords", "seo", "proposals"]   // optional
    },
    "skills": ["seo-onpage", "content-writing"],     // optional: limit skills for this site
    "translationOf": "main-vi"                       // optional: this site is a translation of another
  }
}
```

**Environment** (`.env`): see [.env.example](.env.example) for every option. The main ones:

| Variable | Default | |
|---|---|---|
| `AGENT_BACKEND` / `AGENT_FALLBACK` | `claude` / – | primary and backup CLI |
| `STORE_DRIVER` | `file` | `sqlite` uses built-in `node:sqlite`; migrate with `npm run migrate:sqlite` |
| `MAX_CONCURRENT` | `2` | agent processes at once |
| `CHAT_PER_HOUR` / `COMPOSE_PER_HOUR` | `60` / `12` | per-user rate limits (`0` = off) |
| `SYNC_INTERVAL_MIN` | `0` | periodic sync of every site |
| `SYNC_ALERT_WEBHOOK` | – | POST alert when sync fails `SYNC_ALERT_AFTER` times in a row (Slack/Discord-compatible) |
| `WORKSPACE_LOCK` | `1` | synced data is read-only for the agent between syncs |

## HTTP API

All endpoints except health and widget need `Authorization: Bearer <token>`. The token is minted by your site:
`base64url(payload).base64url(HMAC-SHA256)`, with payload `{site, uid, name, exp}` and a maximum TTL of 24h.
See `php/ContentAgent.php`.

| Method | Path | |
|---|---|---|
| POST | `/api/chat` | `{message, conversationId?}` → SSE: `init`, `step`, `delta`, `proposals`, `result`, `error` |
| POST | `/api/compose` | editor plugin: `{mode: new\|optimize, brief, keyword, …}` → SSE `progress`, `result {fields, notes}` |
| GET | `/api/conversations` | the user's conversations |
| GET / DELETE | `/api/conversations/:id` | read / delete one |
| POST | `/api/sync` | sync the site now |
| GET | `/api/status` | last sync, sync health |
| GET | `/api/usage?days=30` | tokens, cost and requests for the user and the whole site, by backend |
| GET | `/api/health`, `/widget.js` | public |

## Embedding in your admin

```php
<?php require 'php/ContentAgent.php'; ?>
<?= ContentAgent::embed('https://agent.example.com', '/admin/token.php', ['title' => 'Content assistant']) ?>
```

`php/token.php` is a minimal token endpoint. Replace its session check with your admin auth.
Other stacks only need to reproduce the ~10-line HMAC token in `php/ContentAgent.php`.

## Security model

- Secrets (`tokenSecret`, `api.key`) stay on servers. The browser only holds a short-lived token bound to one site and user.
- Conversations are private to the `uid` that created them, and CORS is limited to `allowedOrigins`.
- The agent cannot publish. Website changes are proposals that a human approves.
- The agent has no shell or network tools, and synced data is read-only on disk (`WORKSPACE_LOCK`). Run the
  service as a dedicated non-root user.
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Development

```bash
npm test          # node:test, no dependencies. Fake CLIs + fake website, runs against file and sqlite stores
npm run check     # syntax check
npm run smoke     # live 2-turn check against your real CLI
```

## License

[MIT](LICENSE)
