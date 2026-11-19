// Write protection for synced data inside an agent workspace.
//
// The agent may write plans/, drafts/, outbox/, knowledge/ and notes.md. Everything the backend
// syncs from the website (posts/, content/, seo/, ...) and the outbox bookkeeping (outbox/sent/,
// outbox/STATUS.md) is made read-only on disk between syncs, so a file-editing agent gets EACCES
// instead of silently corrupting the source of truth. The backend unlocks around its own writes.
//
// This is defence in depth, not a sandbox: a CLI allowed to run shell commands as the same OS user
// could chmod the files back. Keep shell tools disabled (default for every adapter) and run the
// service as a dedicated non-root user (root ignores file modes). No-op on Windows or WORKSPACE_LOCK=0.
import { chmod, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

export const PROTECTED_PATHS = ['posts', 'content', 'products', 'categories', 'site', 'seo', 'outbox/sent', 'outbox/STATUS.md'];

const enabled = () => process.platform !== 'win32' && process.env.WORKSPACE_LOCK !== '0';

async function walk(p, dirMode, fileMode) {
  let st;
  try { st = await lstat(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    // make the directory traversable/writable before descending when unlocking
    if (dirMode & 0o200) await chmod(p, dirMode);
    for (const e of await readdir(p)) await walk(path.join(p, e), dirMode, fileMode);
    if (!(dirMode & 0o200)) await chmod(p, dirMode);
  } else if (st.isFile()) {
    await chmod(p, fileMode);
  }
}

export async function lockWorkspace(ws) {
  if (!enabled()) return;
  for (const rel of PROTECTED_PATHS) await walk(path.join(ws, rel), 0o555, 0o444);
}

export async function unlockWorkspace(ws) {
  if (!enabled()) return;
  for (const rel of PROTECTED_PATHS) await walk(path.join(ws, rel), 0o755, 0o644);
}

// Nested/concurrent backend writers (sync + outbox) share one unlock: the last one out locks again.
const holders = new Map();
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

/** Run fn with the workspace's protected paths writable. */
export async function withUnlocked(ws, fn) {
  await serial(async () => {
    const n = holders.get(ws) || 0;
    holders.set(ws, n + 1);
    if (n === 0) await unlockWorkspace(ws);
  });
  try {
    return await fn();
  } finally {
    await serial(async () => {
      const n = (holders.get(ws) || 1) - 1;
      if (n > 0) holders.set(ws, n);
      else {
        holders.delete(ws);
        await lockWorkspace(ws).catch((e) => console.warn(`[guard] lock ${ws}: ${e.message}`));
      }
    });
  }
}
