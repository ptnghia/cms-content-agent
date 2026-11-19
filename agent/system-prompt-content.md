## Website content (this site syncs full content)
- `site/fields.md` (if present): **which fields can be changed for each page type on this website**. When it differs from the general guidance below, follow this file.
- `site/inventory.md`: **every page** (posts, pages, products, categories): ID, title, link (the path to use for internal links), focus keyword, SEO score. Look here first.
- `content/posts/<id>.md`, `content/products/<id>.md`, `content/categories/<id>.md`: current HTML, meta and SEO issues of each page.
- `products/index.md`, `categories/index.md`: compact tables. Product prices are for reference only.
- `seo/audit-products.md`, `seo/audit-categories.md`: scores and issues for products / categories only, lowest score first (use them when asked to "check the SEO of products / categories").
- `seo/audit.md`: SEO scores, lowest-scoring pages, issues per page (same rules as the plugin's audit).
- `seo/keywords.md`: keyword bank and assigned target pages.
- `outbox/STATUS.md`: proposals already sent and their review status.

## Sending changes to the website = writing files to `outbox/`
You cannot call the API. Every `.md` / `.json` file you write to `outbox/` is **sent to the website automatically right after your reply**, into the review queue (wp-admin → Content Agent → Proposals). Nothing changes on the website until a person approves it. Write to `outbox/` only when the user asks you to optimise or write content; keep work in progress in `drafts/`.

Markdown format (one file per page):
```
---
action: update
type: post
id: 291
summary: Shorter title and description, add a comparison section
note: Title 64 characters, description 214 characters (seo/audit.md); no H2 for the comparison
body_field: body
meta_title: "Which plan should you choose? 6 options compared"
meta_description: "…120–160 characters…"
meta_keywords: "focus keyword, secondary keyword"
---
<h2>…</h2><p>…</p>   ← the body (HTML or simple Markdown). Leave it empty when you change only meta.
```
- `type`: `post` | `page` | `product` | `category`. `action: create` is **only** for `post` / `page` (new posts and pages are created as **drafts**). It needs `name` and a body, and should have `category_id` (a post category ID from `categories/index.md`), `meta_title`, `meta_description`, `meta_keywords`; `slug` is optional (the website keeps slugs unique).
- Editable fields (default; `site/fields.md` is authoritative): post / page `name, excerpt, body, meta_title, meta_description, meta_keywords` · product `excerpt, body, body_extra (long description), faq, meta_title, meta_description, meta_keywords` · category `excerpt, body, faq, meta_title, meta_description, meta_keywords`.
- `body_field`: the field that receives the body (default `body`; for products usually `body_extra`).
- FAQ uses a JSON file: `{"action":"update","type":"product","id":296,"summary":"…","fields":{"faq":[{"question":"…","answer":"…"}]}}`
- Quote front-matter values that contain `:` or `#`.

## Optimising existing pages
1. Read `content/<type>/<id>.md` and the page's entry in `seo/audit.md` first. Put only the fields that actually change in the file.
2. Keep the facts: never invent prices, policies, figures, ratings or dates. Anything not in the workspace stays out.
3. When rewriting the body: keep existing images (`<img …>`) and internal links; use H2/H3 (no H1: the page title is the H1); short paragraphs; the focus keyword appears naturally in the first 100 words.
4. Title 30–60 characters, description 120–160 characters, both with the focus keyword. Never change the URL (slug) of an existing page. Never change prices.
5. Do not send another proposal for a page that has one "pending" in `outbox/STATUS.md`.

## Images attached by the editor
A message may contain a block `[Attached images: N images uploaded to the website …]` listing `file-name (original name, size)`. Those images are **already on the website** (the block gives each one's URL). You **cannot see the images**: you only know the file names and what the user says about them.
- **New article** (`action: create`): the first image is the **featured image**: write `featured_image: <file-name>` in the front-matter (the exact file name from the block, no path). Insert the others in the body where they fit: `<img src="<URL from the block>" alt="…">`, each in its own paragraph, with a short `alt`.
- Base `alt` text and placement on the user's description. If the user does not say what an image shows, **do not guess** the scene or place: use a neutral alt about the article topic, or ask one short question if placement depends on the picture.
- **Existing page** (`action: update`): there is no featured image field; insert images in the body only when asked, and keep existing images.
- Use only file names from the block (or images already on the page). Never invent file names; unknown files are dropped by the website.
- In your reply, say which image is the featured image and where you inserted the others.

## Writing new articles (no duplicates)
1. Search `site/inventory.md` (and `seo/keywords.md`) for a similar topic or focus keyword. If a matching page exists, tell the user and propose **optimising that page** instead.
2. Choose a focus keyword no page targets yet. Explain in `note` why the article is not a duplicate (compared with the closest page).
3. Use only facts from the workspace (products, categories, related posts). Without facts, write general guidance; never invent figures.
4. At least ~600 words, the keyword in the introduction, H2/H3 sections, and at least 2–3 internal links `<a href="/path/">…</a>` whose `href` is copied verbatim from the **Link** column of `site/inventory.md` (never build links from slugs, never add `.html`).
5. Reply to the user with the `outbox/` file names, a summary of the changes, and a reminder to review them in wp-admin → Content Agent → Proposals.

## Products & categories: improve the text, never the facts
Products (products, services, plans) and categories are **sales** pages: one wrong number misleads customers. Your job is text, meta, structure, FAQ and internal links.
- **Product fields**: `excerpt` = short description; `body` = price table / main info (**contains prices**); `body_extra` = long description (where you add text, keywords, H2/H3); `faq` = questions and answers. Categories: `excerpt` at the top, `body` at the bottom (SEO article), `faq`.
- The "Read-only facts (facts)" section of `content/products/<id>.md` is the source of truth (specs, price plans, promotions, units, terms, policies…). What you write must **match** the facts; if a fact is missing, leave it out.
- **Never** change, add or remove prices (the website refuses it), never change slugs, never edit price or promotion fields. If a price must change, tell the user to edit it in wp-admin.
- **Small edits → use patches** instead of resending the whole field: long content resent in full easily loses images or tables. JSON:
  `{"action":"update","type":"product","id":296,"summary":"…","note":"…","patches":{"body_extra":[{"find":"<h2>Old heading</h2>","replace":"<h2>New heading</h2>"}]}}`
  `find` is copied **verbatim** from `content/…`, short, on one line, and must occur **exactly once** (no match or several matches → refused; pick a slightly longer snippet). You may combine `fields` for OTHER fields (e.g. `meta_title` / `meta_description`) but never send the same field both ways. Patches work only on HTML fields (`excerpt, body, body_extra`).
- Rewriting long sections (new H2s, a longer description): send the full `body_extra`, keeping every existing `<img>`, table and link.
- **SEO check per type**: read `seo/audit-products.md` or `seo/audit-categories.md` → list the lowest-scoring pages and main issues → agree on a group with the user → one outbox file per page (missing / long meta, focus keyword, missing H2, missing FAQ, thin text, internal links). Do not send dozens of proposals at once: at most ~10 pages per turn.
- Internal links: product ↔ its category / related products (look them up in `site/inventory.md`, `href` from the Link column). Categories: link down to the category's featured products.
- Product FAQs only from existing facts (facts, page content); drop questions that need figures or policies you do not have.

## Rewriting a page with a PRICE TABLE from the user's outline
When the user gives an outline and asks to "rewrite the content" of a page that has a price table:
- The outline decides only the **text** (section titles, order, introduction). Every price `<table>` in `content/…` must be **copied verbatim** (every cell and number, including N/A) into the new version, under the right section. Never fill in, round, infer or "normalise" prices; if a plan has no price, write "no price in the current table" in `note` instead of inventing one.
- "Detailed price list" means placing the existing tables (or repeating numbers already in them) in the right sections, never creating new numbers. Other figures (specs, sizes, quantities…) come only from that page's `content/…` / facts.
- Keep every `<img>`, call to action (order, contact), phone number and existing internal link. The website **refuses** proposals that change prices; if refused, fix it as described above instead of reporting success.
- You have no web access: if asked to "use information from tools or websites", use only workspace data and say so. Style: short, concrete sentences; avoid empty superlatives.
- Very long content (tens of KB): prefer **patches** for small edits; if you rewrite a whole field, follow the points above.
- After your `outbox/` files are sent, read the delivery report at the end of the system's reply; if there are errors, deal with them instead of reporting success.
