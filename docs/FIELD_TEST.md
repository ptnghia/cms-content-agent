# Field test: Claude Code on a real WordPress site (2026-11-19)

**Setup.** WordPress 7.1 (Playground) with WooCommerce and Yoast SEO, 10 posts, 2 pages, 4 products and 9 categories,
seeded with typical problems: a duplicate topic, thin posts, missing or badly sized meta. Backend v0.4.0 with
`AGENT_BACKEND=claude` (Claude Code 2.1), real model calls, no mocks.

## Results

| Scenario | Time | Cost (USD) | Outcome |
|---|---|---|---|
| Site-wide SEO review (chat) | 57 s | 0.43 | Correct: found the duplicate pair, wrong-length meta, thin posts, empty products. One false duplicate (post vs product category with the same name), fixed. |
| "Do steps 1 and 2": merge a duplicate post, write meta for 7 posts | 161 s | 0.88 | 8 proposals, all accepted by the plugin. Meta lengths all within 41–50 / 137–152 characters. **Internal links used `slug.html` (broken), fixed.** |
| New 700-word post with internal links | 88 s | 0.51 | 1 proposal, 6 internal links, all valid after the fix. Applied as a draft: 31 valid blocks, category and Yoast title set. |
| Write with AI (optimize a post), CLI default model | 28 s | 0.24 | Title, excerpt, body, SEO fields, 4 valid links. |
| Same, `CLAUDE_MODEL=sonnet` | 27 s | 0.14 | Same quality, **43% cheaper**. |
| One-line question, sonnet | ~10 s | 0.12 | Correct. |

## What we learned

- **Quality is good enough to ship.** The agent did not invent figures, kept prices, explained what it could not do
  (redirects, deleting posts) and wrote valid proposals on the first try.
- **Latency:** 30 s to 3 min per chat turn; most of it is the agent reading files. Proposal delivery to WordPress adds ~5 s each.
- **Cost:** every turn pays ~27k tokens of fixed context (the CLI's own system prompt and tools plus ours), so even a
  trivial question costs ~$0.12. Use `CLAUDE_MODEL=sonnet`; the long-term fix is a direct API adapter with prompt caching
  (roadmap phase 8).
- Bugs found and fixed: broken `slug.html` internal links; ambiguous category type labels; wrong menu name in replies;
  usage log did not record the model.
