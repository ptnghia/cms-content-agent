// Minimal Messages API stand-in for tests: answers POST /v1/messages with scripted SSE streams.
// Each script entry is the list of content blocks of one assistant response.
import http from 'node:http';

const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

export function startFakeMessagesApi(script) {
  const requests = [];
  let i = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      const blocks = script[Math.min(i++, script.length - 1)];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000 };
      sse(res, 'message_start', { message: { id: `msg_${i}`, type: 'message', role: 'assistant', model: parsed.model, content: [],
        stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
      blocks.forEach((b, idx) => {
        if (b.type === 'text') {
          sse(res, 'content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
          for (const part of b.text.match(/.{1,4}/gs) || []) sse(res, 'content_block_delta', { index: idx, delta: { type: 'text_delta', text: part } });
        } else {
          sse(res, 'content_block_start', { index: idx, content_block: { type: 'tool_use', id: `tu_${i}_${idx}`, name: b.name, input: {} } });
          sse(res, 'content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
        }
        sse(res, 'content_block_stop', { index: idx });
      });
      const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
      sse(res, 'message_stop', {});
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)),
  })));
}
