---
name: keyword-clustering
description: Group a keyword list by topic and assign target pages, detecting internal keyword competition (cannibalization). Use when the user provides a keyword list or asks about keyword allocation.
---
# Keyword clustering

1. Normalise: remove duplicates, merge variants (diacritics / accents, singular / plural, word order).
2. Group by shared **search intent** (one page can answer them all), not only by similar words. Each cluster: a main keyword (the representative one, shortest and most natural) + secondary keywords.
3. Classify clusters: informational (blog post) · comparison / consideration (comparison post, category) · purchase (product, category).
4. Assign target pages: check `seo/keywords.md` and `site/inventory.md`. If the cluster already has a page, give the page ID; if not, suggest a new page type. If two pages target the same main keyword, warn about cannibalization and suggest which page to keep and which to move to another keyword.
5. Output as a table: cluster | main keyword | secondary keywords | intent type | target page (ID / new suggestion) | notes. Do not give volume / difficulty unless the user provides them.
