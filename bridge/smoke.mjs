// Kiểm tra nhanh cầu nối agy: 2 lượt, xác nhận hội thoại được nối tiếp.  npm run smoke
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTurn } from './agy-client.mjs';

const cwd = mkdtempSync(path.join(tmpdir(), 'agy-smoke-'));
const onEvent = (ev) => {
  if (ev.type === 'delta') process.stdout.write(ev.text);
};

const a = await runTurn({ prompt: 'Hãy nhớ từ khoá: "cam". Chỉ trả lời "đã nhớ".', cwd, onEvent });
console.log(`\n--- lượt 1: ${a.status}, agy=${a.agyConversationId}`);
const b = await runTurn({
  prompt: 'Từ khoá tôi vừa đưa là gì? Trả lời đúng một từ.',
  cwd,
  agyConversationId: a.agyConversationId,
  onEvent,
});
console.log(`\n--- lượt 2: ${b.status}`);
console.log(/cam/i.test(b.response) ? 'OK: giữ ngữ cảnh' : 'FAIL: mất ngữ cảnh');
