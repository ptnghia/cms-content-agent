# Embedding cms-content-agent in a hosted service

Self-hosting needs none of this: `npm start` reads `config/sites.json` and stores data on disk. This page is for
running the backend **inside another service** (for example a SaaS that manages many customer sites), without
forking it. Everything below keeps the default behaviour unchanged.

```js
// Set DATA_DIR (and other env) before the first import: the config is read once.
import { createApp } from 'cms-content-agent';
import { createRouter } from 'cms-content-agent/bridge';

const app = createApp({
  siteProvider,                 // where sites come from
  store,                        // where conversations and usage go
  runTurn: createRouter({ primary: 'api', fallback: '' }).runTurn,
  beforeTurn, afterTurn,        // billing, quotas, locks
  internal: { token: process.env.INTERNAL_API_TOKEN },   // /internal/* routes
});
app.listen(8787, '0.0.0.0');
```

Public entry points (`package.json` `exports`):

| Import | What |
|---|---|
| `cms-content-agent` | `createApp`, `staticSiteProvider`, `signToken`, `verifyToken`, `tokenSiteId`, `parseSites`, `createFileStore`, `workspacePath`, `ensureWorkspaceDirs`, `lockWorkspace`, `unlockWorkspace`, `DEFAULT_TASKS`, `extractJson` |
| `cms-content-agent/bridge` | `createRouter`, `ADAPTERS`, `parseSessionId`, `runTurn` |
| `cms-content-agent/store/sqlite` | `createSqliteStore` (needs `node:sqlite`) |
| `cms-content-agent/testing/store-contract` | `storeContract`: test cases every store must pass |

Deep imports (`cms-content-agent/server/...`) are not part of the API.

## Site provider

```js
const siteProvider = {
  async get(siteId) { /* site object (same shape as a config/sites.json entry) or null */ },
  async allowsOrigin(origin) { /* true if some site lists it in allowedOrigins */ },
  async list() { /* optional: site ids, used by DEV_MODE routes */ },
};
```

`get` runs on every authenticated request, before the token signature is checked (the site holds the secret), and
`allowsOrigin` runs on every CORS preflight and auth error with any Origin. Anyone can make those calls with made-up
ids, so cache **both hits and misses** (negative cache) and invalidate when a secret changes. A thrown error answers
`503 {"error":"site_unavailable"}` without details. `createApp({ sites })` still works and wraps the map in
`staticSiteProvider(sites)`.

## Store

Any object with the contract documented in `server/store.mjs` (`ensureWorkspace`, `createConversation`,
`getConversation`, `saveConversation`, `listConversations`, `deleteConversation`, `recordUsage`, `usageSummary`,
optional `close`). Agent workspaces are always directories on disk (`<DATA_DIR>/sites/<siteId>`): use
`ensureWorkspaceDirs(dataDir, siteId)` for that part. Check a store with the shared cases:

```js
import { storeContract } from 'cms-content-agent/testing/store-contract';
for (const c of storeContract) test(c.name, () => c.run((dataDir) => createMyStore({ dataDir })));
```

When a store is injected, the default file / sqlite store is never created. Workspaces must live under the same
`DATA_DIR` the core was started with: sync writes there directly.

## Turn hooks

Every AI turn (chat, compose, internal task) calls:

- `beforeTurn({ site, siteId, uid, kind, requestId })` before the agent runs. Return `{ ok: true }`, or
  `{ ok: false, code, message }` to refuse: the client gets the code and message, with HTTP 402 for
  `insufficient_credits` / `plan_expired`, 423 for `site_locked` / `site_inactive`, 403 otherwise. A thrown error
  answers 503 `turn_check_failed`.
- `afterTurn({ ...sameContext, usage, status })` **exactly once** after every turn that passed `beforeTurn`, also when
  the adapter failed (`'ERROR'`), the client disconnected (`'CANCELLED'`, also when it left while `beforeTurn` was
  running: the agent is then not started and `usage.turns` is 0) or a task answered something that is not JSON
  (`'BAD_OUTPUT'`). `usage` has `inputTokens`, `outputTokens`, `cachedTokens`, `costUsd`, `model`, `backend`, `turns`.
  **Charge by `usage`, not by `status`**: tokens may have been spent whatever the status. `requestId` is unique per
  turn: use it to charge idempotently. `afterTurn` runs after the response is finished and the concurrency slot is
  released; its errors are logged and never break the response.
- Both hooks give up after `hookTimeoutMs` (default 10 s): a hanging `beforeTurn` answers 503 `turn_check_failed`, so
  a stuck billing store cannot hold the server's concurrency slots.
- The built-in per-user rate limit (`CHAT_PER_HOUR`, `COMPOSE_PER_HOUR`) is taken before `beforeTurn`, so refused turns
  count towards it.

Typical uses: check the balance and a shared (Redis) semaphore in `beforeTurn`, charge and release it in `afterTurn`.

## Internal routes

Enabled by `internal: { token }` (at least 32 characters). Every call needs `Authorization: Bearer <token>`. Keep
`/internal/*` on a private network and block it in the reverse proxy.

| Route | Body | Answer |
|---|---|---|
| `POST /internal/sites/:id/sync` | – | the sync result (`{count, …}`), 502 `sync_failed` |
| `PUT /internal/sites/:id/knowledge/:name` | `{content}` (≤ 64 KB) | writes `knowledge/<name>.md` in the site workspace (e.g. a site profile) |
| `POST /internal/sites/:id/tasks/:task` | `{input, uid?}` | `{result, usage}`: one AI turn whose answer is parsed as JSON; 502 `bad_task_output` |

Tasks share the server's concurrency limit (`MAX_CONCURRENT`, 429 `server_busy` when full), are cancelled when the
caller disconnects, are recorded in usage as `kind: 'task:<name>'`, and may not create proposals: any file a task
writes to `outbox/` is deleted when it ends (task input comes from end users and could ask for one). Only a JSON
object or array is accepted as the answer.

Built-in tasks (`DEFAULT_TASKS`): `keyword-clusters` (`input.keywords`) and `seo-plan` (`input.keywords`,
`periodStart`, `periodEnd`, `maxItems`). Pass `internal.tasks` to add or replace tasks
(`{ name: { prompt(input, { site, siteId }) => string, maxInputChars? } }`). The core only parses JSON: validate the
shape on your side.

## WordPress plugin: "Connect" and branded builds

A build can ship a hosted service so admins connect with one click instead of pasting secrets
(`wordpress/content-agent/includes/class-connect.php`):

1. Settings → **Connect** stores a random `state` (10 minutes) and redirects to
   `<service>/connect?site_url&rest_url&return_url&state&name&language`.
2. The service signs the admin in, creates the site and redirects to `return_url?code&state` (`code` single use,
   short-lived; `error=…` when cancelled).
3. The plugin checks `state`, then calls `POST <service>/api/connect/exchange` with `{code, site_url}` server to
   server. The service answers `{site_id, agent_url, api_key, token_secret}`. `agent_url` must be https (http only
   on localhost); keys are 32–256 characters of `[A-Za-z0-9_-]`.
4. The settings are saved; backend URL and site id become read-only (connect again to rotate keys).
   **Disconnect** clears the agent URL and regenerates the site's own API key and token secret, so the keys the
   service held stop working. A build without that service (e.g. the open-source plugin installed over a branded one)
   shows the manual settings again.

Errors come back as `?ca_err=<code>` (`no_service`, `expired`, `cancelled`, `unreachable`, `rejected`, `invalid`) and
are shown from a fixed list, never as text from the URL. The service side must check that `return_url` is on the
same host as `site_url`, bind the code to that `site_url`, and revoke the previous keys when a site connects again.

The service is configured with constants or filters: `CONTENT_AGENT_BRAND_NAME`, `CONTENT_AGENT_SERVICE_URL`,
`content_agent_brand_name`, `content_agent_service_url`. Without a service the plugin works exactly as before.

Build a branded zip (the plugin folder stays `content-agent`):

```bash
BRAND_NAME="My Agent" BRAND_SERVICE_URL=https://service.example.com BRAND_ZIP=my-agent npm run build:wp
LIFETECH_BRAND=1 npm run build:wp   # preset in scripts/brands/lifetech.json
```
