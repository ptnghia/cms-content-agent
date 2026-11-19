// Entry point: load sites, lock synced data in every workspace, start HTTP, schedule periodic sync.
import { config, loadSites } from './config.mjs';
import * as store from './store.mjs';
import { createApp } from './app.mjs';
import { syncPosts } from './sync.mjs';
import { lockWorkspace } from './workspace-guard.mjs';
import { createRouter } from '../bridge/index.mjs';

const sites = loadSites();
const router = createRouter();   // validates AGENT_BACKEND / AGENT_FALLBACK at startup

for (const id of Object.keys(sites)) {
  await lockWorkspace(await store.ensureWorkspace(id)).catch((e) => console.warn(`[guard] ${id}: ${e.message}`));
}

const server = createApp({ sites, runTurn: router.runTurn });
server.listen(config.port, config.host, () => {
  console.log(`cms-content-agent: http://${config.host}:${config.port}  sites=[${Object.keys(sites).join(', ')}]  ` +
    `agent=${router.primary}${router.fallback ? `->${router.fallback}` : ''}  store=${config.storeDriver}  dev=${config.devMode}`);
});

if (config.syncIntervalMin > 0) {
  const tick = () => {
    for (const [id, s] of Object.entries(sites)) {
      if (!s.api?.base) continue;
      syncPosts(id, s).then((r) => console.log(`[sync] ${id}: ${r.count} posts`)).catch((e) => console.error(`[sync] ${id}: ${e.message}`));
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, config.syncIntervalMin * 60_000).unref();
}

const shutdown = (sig) => {
  console.log(`${sig}: shutting down`);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5_000).unref();   // open SSE streams should not block a restart
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
