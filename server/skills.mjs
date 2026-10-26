// Thư viện skill dùng chung cho mọi agent CLI: skills/<tên>/SKILL.md (front-matter: name, description, compose).
// Chat: gửi mục lục + đường dẫn, agent tự đọc khi cần. Compose: nhúng thẳng nội dung skill hợp chế độ (agent không mở file).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.mjs';

export const SKILLS_DIR = path.join(ROOT, 'skills');
const BODY_MAX = 3500;

function parse(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2].trim() };
}

/** @returns {Promise<{name, description, compose: string[], file, body}[]>} — site.skills (mảng tên) giới hạn danh sách. */
export async function loadSkills(site) {
  let dirs = [];
  try { dirs = await readdir(SKILLS_DIR, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(SKILLS_DIR, d.name, 'SKILL.md');
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    const p = parse(src);
    if (!p || !p.meta.name) continue;
    if (Array.isArray(site?.skills) && !site.skills.includes(p.meta.name)) continue;
    out.push({ name: p.meta.name, description: p.meta.description || '', compose: (p.meta.compose || '').split(/[\s,]+/).filter(Boolean), file, body: p.body });
  }
  return out;
}

/** Khối mục lục cho prompt chat. */
export async function skillsIndexBlock(site) {
  const skills = await loadSkills(site);
  if (!skills.length) return '';
  return '\n\n## Kỹ năng (skills)\nKhi yêu cầu khớp một kỹ năng dưới đây, **đọc file SKILL.md của nó trước** rồi làm theo (chỉ đọc, không sửa):\n' +
    skills.map((s) => `- \`${s.name}\` — ${s.description}\n  ${s.file}`).join('\n');
}

/** Nội dung các skill hợp chế độ compose ('new' | 'optimize' | 'sales'), nhúng thẳng vào prompt. */
export async function skillsComposeBlock(site, modes) {
  const skills = (await loadSkills(site)).filter((s) => s.compose.some((m) => modes.includes(m)));
  if (!skills.length) return '';
  return '## Kỹ năng áp dụng (làm theo; quy tắc ở trên vẫn ưu tiên khi mâu thuẫn; bỏ qua các bước "đọc file" vì dữ liệu đã nằm trong yêu cầu)\n' +
    skills.map((s) => `### ${s.name}\n${s.body.slice(0, BODY_MAX)}`).join('\n\n');
}
