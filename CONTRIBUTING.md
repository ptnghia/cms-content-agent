# Contributing

Thanks for helping! Issues and pull requests are welcome in English or Vietnamese.

## Ground rules

- **No runtime dependencies.** The backend uses only Node.js built-ins (`node:http`, `node:test`, `node:sqlite`, …).
  Please keep it that way. Dev tooling that is not needed at runtime can be discussed in an issue first.
- **The agent never publishes.** Changes to a website go through `outbox/` and the site's review queue. PRs that let
  the agent write to a CMS directly will not be merged.
- **Agents work on files only.** New features that need data should sync it into the workspace on the backend,
  not give the agent network or shell access.

## Setup

```bash
git clone https://github.com/ptnghia/cms-content-agent.git && cd cms-content-agent
npm test            # Node >= 22.13; no install step
npm run check && npm run lint:php
```

Working on the plugin: run WordPress Playground with it mounted (no MySQL or Docker needed):

```bash
npx @wp-playground/cli server --mount=./wordpress/content-agent:/wordpress/wp-content/plugins/content-agent --login
```

Plugin code follows the WordPress coding standards (tabs, `array()`, escaping on output, nonces and capability checks
on every action). Keep PHP 7.4 compatibility and no Composer dependencies. User-facing strings go through `__()` with
the `content-agent` text domain; add Vietnamese translations to `languages/content-agent-vi.l10n.php`. Backend chat messages
live in `server/i18n.mjs` and widget strings in the `I18N` table of `web/widget.js`: add a language by copying the `en` block.

Tests use a fake CLI (`test/fixtures/fake-agent.mjs`) and a fake website API, so they need no API keys.
For a live check against a real CLI: `AGENT_BACKEND=claude npm run smoke`.

## Where things live

| Path | |
|---|---|
| `bridge/adapters/*.mjs` | one file per agent CLI (`runTurn` contract in `bridge/index.mjs`) |
| `server/app.mjs` | HTTP routes, chat / compose flows |
| `server/store/*.mjs` | storage drivers (file, sqlite), contract in `server/store.mjs` |
| `server/sync.mjs`, `server/content-sync.mjs` | website → workspace sync |
| `server/outbox.mjs` | proposals → website review queue |
| `agent/*.md` | system prompts (English; the agent writes in the site's language) |
| `skills/<name>/SKILL.md` | skills shared by every CLI |
| `web/widget.js` | the embeddable widget (vanilla JS, Shadow DOM) |
| `wordpress/content-agent/` | the WordPress plugin (REST API, review queue, chat embed, block-editor sidebar) |

## Common contributions

- **A new agent CLI:** add `bridge/adapters/<name>.mjs`, register it in `ADAPTERS`, and teach
  `test/fixtures/fake-agent.mjs` its output format so `test/adapters.test.mjs` covers it.
- **A new skill:** add `skills/<name>/SKILL.md` with front-matter `name`, `description` and optional
  `compose: new|optimize|sales`. No code change needed.
- **A new storage driver:** implement the contract in `server/store.mjs` and add it to `test/store.test.mjs`.
- **Translations:** prompts in `agent/`, skills, widget strings in `web/widget.js`, plugin strings in `wordpress/content-agent/languages/`.

## Pull requests

- Keep PRs focused. Add or update tests for behaviour changes and make sure `npm test` passes.
- Write commit messages in the imperative ("add X", "fix Y"). English or Vietnamese is fine.
- Update `CHANGELOG.md` under *Unreleased* and docs when behaviour or configuration changes.
