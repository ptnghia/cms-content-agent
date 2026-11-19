// Fake website API for local testing: npm run mock-site  (port 4000, key "dev-key", 235 posts)
import http from 'node:http';

const topics = ['SEO cơ bản', 'Từ khoá dài', 'Backlink', 'Tốc độ trang', 'Schema markup', 'Content cluster'];
const items = Array.from({ length: 235 }, (_, i) => ({
  id: i + 1,
  title: `${topics[i % topics.length]} — phần ${Math.floor(i / topics.length) + 1}`,
  slug: `bai-${i + 1}`,
  url: `https://example.com/bai-${i + 1}`,
  status: i % 9 === 0 ? 'draft' : 'published',
  published_at: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
  updated_at: new Date(Date.UTC(2025, 6, 1 + (i % 120))).toISOString(),
  word_count: 400 + ((i * 37) % 1800),
  meta_title: i % 7 === 0 ? '' : `Meta title ${i + 1}`,
  meta_description: i % 5 === 0 ? '' : `Mô tả bài ${i + 1}`,
  categories: [topics[i % topics.length]],
}));

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer dev-key') { res.writeHead(401).end(); return; }
  if (url.pathname === '/api/agent/posts') {
    const per = Math.min(100, Number(url.searchParams.get('per_page') || 50));
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const slice = items.slice((page - 1) * per, page * per);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: slice, next_page: page * per < items.length ? page + 1 : null }));
    return;
  }
  res.writeHead(404).end();
}).listen(Number(process.env.MOCK_PORT || 4000), process.env.MOCK_HOST || '127.0.0.1', () => console.log(`mock site: http://${process.env.MOCK_HOST || '127.0.0.1'}:${process.env.MOCK_PORT || 4000}`));
