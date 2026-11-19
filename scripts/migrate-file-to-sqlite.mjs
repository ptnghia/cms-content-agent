// Copy conversations and usage records from the file driver into data/store.db.
//   npm run migrate:sqlite            (then set STORE_DRIVER=sqlite)
// Safe to run more than once: conversations are upserted by id; a site's usage is skipped if already imported.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.mjs';
import { createSqliteStore } from '../server/store/sqlite-store.mjs';

const db = createSqliteStore({ dataDir: config.dataDir });
const ls = async (d) => { try { return await readdir(d, { withFileTypes: true }); } catch { return []; } };

let convs = 0;
for (const site of (await ls(path.join(config.dataDir, 'conversations'))).filter((e) => e.isDirectory())) {
  const dir = path.join(config.dataDir, 'conversations', site.name);
  for (const f of (await ls(dir)).filter((e) => e.isFile() && e.name.endsWith('.json'))) {
    try {
      db.importConversation(JSON.parse(await readFile(path.join(dir, f.name), 'utf8')));
      convs++;
    } catch (e) { console.warn(`skip ${site.name}/${f.name}: ${e.message}`); }
  }
}

let usage = 0;
for (const site of (await ls(path.join(config.dataDir, 'usage'))).filter((e) => e.isDirectory())) {
  const before = await db.usageSummary(site.name, { since: '0000' });
  if (before.requests > 0) { console.log(`usage for ${site.name} already imported, skipping`); continue; }
  const dir = path.join(config.dataDir, 'usage', site.name);
  for (const f of (await ls(dir)).filter((e) => e.name.endsWith('.jsonl'))) {
    for (const line of (await readFile(path.join(dir, f.name), 'utf8')).split('\n')) {
      if (!line) continue;
      try { await db.recordUsage(JSON.parse(line)); usage++; } catch { /* skip */ }
    }
  }
}
db.close();
console.log(`Imported ${convs} conversations and ${usage} usage records into ${path.join(config.dataDir, 'store.db')}`);
console.log('Now set STORE_DRIVER=sqlite and restart. The JSON files are left untouched.');
