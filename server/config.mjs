// Nạp .env, cấu hình chung và danh sách site.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const resolveFromRoot = (p) => path.resolve(ROOT, p);

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  dataDir: resolveFromRoot(process.env.DATA_DIR || './data'),
  storeDriver: process.env.STORE_DRIVER || 'file',
  sitesFile: resolveFromRoot(process.env.SITES_FILE || './config/sites.json'),
  maxConcurrent: Number(process.env.MAX_CONCURRENT || 2),
  maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS || 8000),
  syncIntervalMin: Number(process.env.SYNC_INTERVAL_MIN || 0),
  devMode: process.env.DEV_MODE === '1',
};

export function loadSites() {
  if (!existsSync(config.sitesFile)) {
    throw new Error(`Thiếu ${config.sitesFile} (sao chép từ config/sites.example.json)`);
  }
  const sites = JSON.parse(readFileSync(config.sitesFile, 'utf8'));
  for (const [id, s] of Object.entries(sites)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id)) throw new Error(`siteId không hợp lệ: ${id}`);
    if (!s.tokenSecret || s.tokenSecret.length < 16) throw new Error(`site "${id}": tokenSecret quá ngắn`);
  }
  return sites;
}
