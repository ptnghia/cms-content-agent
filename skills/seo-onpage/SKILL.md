---
name: seo-onpage
description: On-page SEO optimisation for ONE existing page (title, description, headings, keywords, opening paragraph, image alt). Use when asked to "optimise / fix SEO / improve rankings" for a post, product or category.
compose: optimize
---
# On-page SEO for one page

Process:
1. Read the page (`content/<type>/<id>.md`) and the page's entry in `seo/audit.md`; identify the main keyword (prefer `seo/keywords.md`; if there is none, infer it from the title and say clearly that it is inferred).
2. Score against the checklist, and fix only what is actually wrong:
   - Title 30–60 characters, main keyword in the first half, has a differentiator (not just a repeat of the page name).
   - Description 120–160 characters, includes the main keyword, ends with a benefit or a call to action; not the same as the title.
   - A single H1 (already the page name); the body uses only H2/H3; the main keyword or a variant appears in at least one H2.
   - Main keyword within the first 100 words; natural density, no stuffing.
   - Short paragraphs (≤ 4 sentences), lists for enumerations; an FAQ section if the page has real frequently asked questions.
   - Image `alt` accurately describes the content; keep `src` unchanged.
   - 2–4 internal links with descriptive anchors (see the `internal-linking` skill).
3. Keep all existing facts, price figures, tables, images and links. Do not change the alias.
4. State the reason for each change (which audit issue, why) in `summary` / `note`.
