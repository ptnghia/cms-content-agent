// Public API of the cms-content-agent package, for hosting it inside another service
// (see docs/EMBEDDING.md). Self-hosting needs none of this: `npm start` runs server/server.mjs.
//
// Importing this module reads the environment (DATA_DIR, STORE_DRIVER, rate limits…) once, so set
// it before the first import.
export { createApp } from './app.mjs';
export { staticSiteProvider } from './site-provider.mjs';
export { signToken, verifyToken, tokenSiteId } from './auth.mjs';
export { parseSites } from './config.mjs';
export { createFileStore } from './store/file-store.mjs';
export { workspacePath, ensureWorkspaceDirs, WORKSPACE_DIRS } from './store/common.mjs';
export { lockWorkspace, unlockWorkspace } from './workspace-guard.mjs';
export { DEFAULT_TASKS, extractJson } from './internal.mjs';
