import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../server/auth.mjs';
import { parseMarkdownProposal, markdownToHtml, outboxSummary } from '../server/outbox.mjs';
import { parseComposeResponse, normalizeCompose } from '../server/compose.mjs';
import { createRateLimiter } from '../server/rate-limit.mjs';
import { normalizeUsage } from '../bridge/process.mjs';
import { toCms, fromCms, canonicalName } from '../server/fields.mjs';
import { parseSites } from '../server/config.mjs';
import { readFileSync } from 'node:fs';
import { summarize, upgradeConversation } from '../server/store/common.mjs';

const sites = { main: { tokenSecret: 'x'.repeat(32) } };
const exp = () => Math.floor(Date.now() / 1000) + 600;

test('auth: valid token', () => {
  const t = signToken({ site: 'main', uid: '7', name: 'An', exp: exp() }, sites.main.tokenSecret);
  assert.deepEqual(verifyToken(t, sites), { ok: true, siteId: 'main', uid: '7', name: 'An' });
});

test('auth: rejects bad signature, expiry, long TTL, unknown site, missing uid', () => {
  const ok = { site: 'main', uid: '7', exp: exp() };
  assert.equal(verifyToken(signToken(ok, 'y'.repeat(32)), sites).reason, 'sig');
  assert.equal(verifyToken(signToken({ ...ok, exp: 1 }, sites.main.tokenSecret), sites).reason, 'expired');
  assert.equal(verifyToken(signToken({ ...ok, exp: exp() + 2 * 86400 }, sites.main.tokenSecret), sites).reason, 'ttl');
  assert.equal(verifyToken(signToken({ ...ok, site: 'other' }, sites.main.tokenSecret), sites).reason, 'site');
  assert.equal(verifyToken(signToken({ ...ok, site: '__proto__' }, sites.main.tokenSecret), sites).reason, 'site');
  assert.equal(verifyToken(signToken({ ...ok, uid: '' }, sites.main.tokenSecret), sites).reason, 'uid');
  assert.equal(verifyToken('a.b.c', sites).reason, 'format');
  assert.equal(verifyToken(42, sites).reason, 'token');
});

test('outbox: markdown proposal with front-matter and markdown body', () => {
  const p = parseMarkdownProposal('---\naction: update\ntype: post\nid: 12\nsummary: Shorter title\nmeta_title: "A: B"\n---\n# Heading\n\nSome **bold** text.\n\n- one\n- two\n');
  assert.equal(p.action, 'update');
  assert.equal(p.type, 'post');
  assert.equal(p.id, 12);
  assert.equal(p.title, 'Shorter title');
  assert.equal(p.fields.meta_title, 'A: B');
  assert.equal(p.fields.body, '<h2>Heading</h2>\n<p>Some <strong>bold</strong> text.</p>\n<ul><li>one</li><li>two</li></ul>');
});

test('outbox: HTML body kept as-is, body_field honoured', () => {
  const p = parseMarkdownProposal('---\ntype: product\nid: 3\nbody_field: body_extra\n---\n<p>x</p>');
  assert.deepEqual(p.fields, { body_extra: '<p>x</p>' });
});

test('outbox: missing front-matter throws', () => {
  assert.throws(() => parseMarkdownProposal('no header'), /front-matter/);
});

test('markdownToHtml: escapes HTML, tables, safe links only', () => {
  assert.equal(markdownToHtml('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.match(markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |'), /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.equal(markdownToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(markdownToHtml('[x](/a.html)'), '<p><a href="/a.html">x</a></p>');
});

test('outboxSummary: ok and failed lines', () => {
  const s = outboxSummary([{ file: 'a.md', ok: true, id: 5, review_url: 'https://x/5' }, { file: 'b.md', ok: false, error: 'bad' }]);
  assert.match(s, /a\.md.*#5.*https:\/\/x\/5/);
  assert.match(s, /b\.md`: bad/);
  assert.equal(outboxSummary([]), '');
});

test('compose: parse sections, strip code fence', () => {
  const r = parseComposeResponse('===META_TITLE===\nT\n===NOTES===\n- n\n===BODY===\n```html\n<h2>H</h2>\n```');
  assert.equal(r.fields.meta_title, 'T');
  assert.equal(r.fields.body, '<h2>H</h2>');
  assert.equal(r.notes, '- n');
  assert.throws(() => parseComposeResponse('plain text'), /===/);
});

test('compose: normalize clamps unknown values', () => {
  const r = normalizeCompose({ mode: 'weird', length: 'huge', type: 'x', brief: 'b'.repeat(5000), images: { inline: new Array(20).fill({ url: 'u' }) } });
  assert.equal(r.mode, 'new');
  assert.equal(r.length, 'vua');
  assert.equal(r.type, 'post');
  assert.equal(r.brief.length, 3000);
  assert.equal(r.images.inline.length, 8);
});

test('rate limiter: sliding window', () => {
  let now = 0;
  const l = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.ok(l.take('a').ok);
  assert.ok(l.take('a').ok);
  const r = l.take('a');
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterSec, 1);
  assert.ok(l.take('b').ok, 'keys are independent');
  now = 1001;
  assert.ok(l.take('a').ok);
  now = 5000;
  l.sweep();
  assert.equal(l.size(), 0);
});

test('rate limiter: limit 0 disables', () => {
  const l = createRateLimiter({ limit: 0, windowMs: 1000 });
  for (let i = 0; i < 100; i++) assert.ok(l.take('a').ok);
});

test('normalizeUsage: maps CLI field names', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 }, 0.5),
    { inputTokens: 10, outputTokens: 2, cachedTokens: 5, costUsd: 0.5 });
  assert.deepEqual(normalizeUsage({ prompt_tokens: 3, completion_tokens: 4 }), { inputTokens: 3, outputTokens: 4, cachedTokens: 0, costUsd: 0 });
  assert.deepEqual(normalizeUsage(undefined), { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 });
  assert.equal(normalizeUsage({ input_tokens: 2, cache_creation_input_tokens: 1000 }).inputTokens, 1002);
});

test('summarize usage by backend', () => {
  const s = summarize([
    { backend: 'claude', inputTokens: 10, outputTokens: 1, costUsd: 0.1 },
    { backend: 'claude', inputTokens: 5, outputTokens: 1, costUsd: 0.2 },
    { backend: 'codex', inputTokens: 1, outputTokens: 1 },
  ]);
  assert.equal(s.requests, 3);
  assert.equal(s.inputTokens, 16);
  assert.equal(s.costUsd, 0.3);
  assert.equal(s.byBackend.claude.requests, 2);
  assert.equal(s.byBackend.codex.costUsd, 0);
});

test('upgradeConversation: legacy agyConversationId', () => {
  assert.deepEqual(upgradeConversation({ agyConversationId: 'x' }), { agentSessionId: 'x' });
  assert.deepEqual(upgradeConversation({ agentSessionId: 'y' }), { agentSessionId: 'y' });
});

test('fieldMap: canonical <-> CMS names', () => {
  const site = { fieldMap: { name: 'title', body: 'content', faq: 'qa_items' } };
  assert.deepEqual(toCms(site, { name: 'A', body: 'B', meta_title: 'C' }), { title: 'A', content: 'B', meta_title: 'C' });
  assert.deepEqual(fromCms(site, { title: 'A', content: 'B', excerpt: 'E' }), { name: 'A', body: 'B', excerpt: 'E' });
  assert.equal(canonicalName(site, 'qa_items'), 'faq');
  assert.equal(canonicalName(site, 'body_extra'), 'body_extra');
  assert.deepEqual(toCms({}, { body: 1 }), { body: 1 }, 'no map = canonical names');
});

test('compose: request accepts the site\'s own field names', () => {
  const site = { fieldMap: { body: 'content', excerpt: 'summary_html' } };
  const r = normalizeCompose({ mode: 'optimize', target: 'summary_html', cur: { content: '<p>x</p>' }, others: { content: 'y' } }, site);
  assert.equal(r.target, 'excerpt');
  assert.equal(r.cur.body, '<p>x</p>');
  assert.deepEqual(r.others, { body: 'y' });
});

test('parseSites: comments dropped, example file valid, bad entries rejected', () => {
  assert.deepEqual(parseSites({}), {});
  const ex = parseSites(JSON.parse(readFileSync(new URL('../config/sites.example.json', import.meta.url), 'utf8')));
  assert.deepEqual(Object.keys(ex), ['example-com']);
  assert.throws(() => parseSites({ a: { tokenSecret: 'short' } }), /tokenSecret/);
  assert.throws(() => parseSites({ 'bad id!': { tokenSecret: 'x'.repeat(32) } }), /Invalid siteId/);
  assert.throws(() => parseSites({ a: { tokenSecret: 'x'.repeat(32), translationOf: 'nope' } }), /translationOf/);
});
