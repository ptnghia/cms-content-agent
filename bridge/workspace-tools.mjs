// File tools for API-based agents (bridge/adapters/api.mjs). The agent reads the workspace and the extra
// read-only folders (knowledge, skills, a source workspace) and writes ONLY to its own folders.
// Paths are untrusted model output: they are resolved, symlinks followed, and checked against the roots.
import { readFile, writeFile, readdir, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Workspace paths the agent may write (everything else is synced data or the backend's). */
const WRITABLE_DIRS = ['plans', 'drafts', 'outbox'];
const WRITABLE_FILES = ['notes.md'];
const NOT_WRITABLE = ['outbox/sent', 'outbox/STATUS.md'];
const MAX_READ = 200_000;      // characters per read_file call
const MAX_WRITE = 2_000_000;   // characters per written file
const MAX_LIST = 300;
const MAX_MATCHES = 100;

export const TOOL_DEFS = [
  {
    name: 'list_files',
    description: 'List files and folders. Folders end with "/". Use "." for the workspace root, or an absolute path of an extra folder named in the instructions.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Folder to list (default ".")' },
      depth: { type: 'integer', description: 'How many levels to descend, 1–3 (default 1)' } }, required: [], additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a text file. Long files are returned in parts: pass offset (first line, 1-based) and limit (number of lines) to read more.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
      required: ['path'], additionalProperties: false },
  },
  {
    name: 'search',
    description: 'Search file contents (case-insensitive regular expression, or plain text). Returns "file:line: text" for up to 100 matches.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder to search (default ".")' } },
      required: ['pattern'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Create or replace a file. Only plans/, drafts/, outbox/ and notes.md in the workspace are writable.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
  },
  {
    name: 'edit_file',
    description: 'Replace one exact snippet in a writable file. old_text must occur exactly once.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
      required: ['path', 'old_text', 'new_text'], additionalProperties: false },
  },
];

const STEP = { list_files: 'list_dir', read_file: 'view_file', search: 'grep', write_file: 'write_file', edit_file: 'write_file' };
export const stepTypeOf = (name) => STEP[name] || 'tool';

class ToolError extends Error {}
const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Canonical path of the deepest existing ancestor + the rest (so new files resolve through symlinked folders too). */
async function canonical(p) {
  let cur = p; const rest = [];
  for (;;) {
    try { return path.join(await realpath(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const parent = path.dirname(cur);
    if (parent === cur) return p;
    rest.push(path.basename(cur)); cur = parent;
  }
}

/** Validate an input object against a tool's JSON schema (types + required + no extra keys). */
export function validateInput(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return `unknown tool "${name}"`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const props = def.input_schema.properties;
  for (const k of def.input_schema.required) if (!(k in input)) return `missing "${k}"`;
  for (const [k, v] of Object.entries(input)) {
    if (!props[k]) return `unexpected "${k}"`;
    const want = props[k].type;
    if (want === 'string' && typeof v !== 'string') return `"${k}" must be a string`;
    if (want === 'integer' && !Number.isInteger(v)) return `"${k}" must be an integer`;
  }
  return '';
}

/**
 * @param {{cwd:string, addDirs?:string[]}} o
 * @returns {{run:(name:string, input:object) => Promise<string>}}   run() throws ToolError for the agent to see
 */
export function createWorkspaceTools({ cwd, addDirs = [] }) {
  const rootsP = Promise.all([cwd, ...addDirs].map((d) => canonical(path.resolve(d))));

  async function resolve(p, { write = false } = {}) {
    const [ws, ...extra] = await rootsP;
    const raw = String(p ?? '.').trim() || '.';
    const abs = await canonical(path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(ws, raw));
    if (write) {
      if (!inside(ws, abs)) throw new ToolError('only workspace files can be written');
      const rel = path.relative(ws, abs).split(path.sep).join('/');
      const ok = (WRITABLE_DIRS.some((d) => rel.startsWith(`${d}/`)) || WRITABLE_FILES.includes(rel))
        && !NOT_WRITABLE.some((d) => rel === d || rel.startsWith(`${d}/`));
      if (!ok) throw new ToolError(`"${rel}" is read-only; write only to ${WRITABLE_DIRS.map((d) => d + '/').join(', ')} or ${WRITABLE_FILES.join(', ')}`);
      return abs;
    }
    if (![ws, ...extra].some((r) => inside(r, abs))) throw new ToolError('path is outside the workspace and the extra folders');
    return abs;
  }
  const show = async (abs) => { const ws = (await rootsP)[0]; return inside(ws, abs) ? path.relative(ws, abs) || '.' : abs; };

  async function list(dir, depth, out) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { throw new ToolError(`cannot list: ${e.code || e.message}`); }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_LIST) return;
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      out.push((await show(p)) + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory() && depth > 1) await list(p, depth - 1, out);
    }
  }

  async function walk(dir, files) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length > 5000 || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, files); else if (/\.(md|json|txt|html|csv|ya?ml)$/i.test(e.name)) files.push(p);
    }
  }

  const tools = {
    async list_files({ path: p = '.', depth = 1 }) {
      const abs = await resolve(p);
      const out = [];
      await list(abs, Math.min(Math.max(depth, 1), 3), out);
      return out.length ? out.join('\n') + (out.length >= MAX_LIST ? `\n… (first ${MAX_LIST} entries)` : '') : '(empty)';
    },
    async read_file({ path: p, offset = 1, limit }) {
      const abs = await resolve(p);
      let text;
      try { text = await readFile(abs, 'utf8'); } catch (e) { throw new ToolError(`cannot read: ${e.code || e.message}`); }
      const lines = text.split('\n');
      const start = Math.max(1, offset);
      let end = limit ? Math.min(lines.length, start + limit - 1) : lines.length;
      let body = lines.slice(start - 1, end).join('\n');
      if (body.length > MAX_READ) {
        body = body.slice(0, MAX_READ);
        end = start + body.split('\n').length - 1;
      }
      const more = end < lines.length ? `\n[lines ${start}–${end} of ${lines.length}; read more with offset=${end + 1}]` : '';
      return body + more;
    },
    async search({ pattern, path: p = '.' }) {
      const abs = await resolve(p);
      let re;
      try { re = new RegExp(pattern, 'i'); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      const files = [];
      if ((await stat(abs)).isDirectory()) await walk(abs, files); else files.push(abs);
      const hits = [];
      for (const f of files.sort()) {
        let text; try { text = await readFile(f, 'utf8'); } catch { continue; }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits.length < MAX_MATCHES; i++) {
          if (re.test(lines[i])) hits.push(`${await show(f)}:${i + 1}: ${lines[i].slice(0, 300)}`);
        }
        if (hits.length >= MAX_MATCHES) break;
      }
      return hits.length ? hits.join('\n') + (hits.length >= MAX_MATCHES ? `\n… (first ${MAX_MATCHES} matches)` : '') : 'no matches';
    },
    async write_file({ path: p, content }) {
      if (content.length > MAX_WRITE) throw new ToolError(`content larger than ${MAX_WRITE} characters`);
      const abs = await resolve(p, { write: true });
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return `wrote ${await show(abs)} (${content.length} characters)`;
    },
    async edit_file({ path: p, old_text: oldText, new_text: newText }) {
      const abs = await resolve(p, { write: true });
      let text;
      try { text = await readFile(abs, 'utf8'); } catch (e) { throw new ToolError(`cannot read: ${e.code || e.message}`); }
      const n = oldText ? text.split(oldText).length - 1 : 0;
      if (n !== 1) throw new ToolError(`old_text occurs ${n} times (must be exactly once)`);
      await writeFile(abs, text.replace(oldText, () => newText), 'utf8');
      return `edited ${await show(abs)}`;
    },
  };

  return {
    /** @returns {Promise<{content:string, isError:boolean}>} */
    async run(name, input) {
      const bad = validateInput(name, input);
      if (bad) return { content: `invalid input: ${bad}`, isError: true };
      try { return { content: await tools[name](input), isError: false }; }
      catch (e) {
        if (e instanceof ToolError) return { content: e.message, isError: true };
        return { content: `error: ${e.code || e.message}`, isError: true };
      }
    },
  };
}
