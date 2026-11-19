// Storage facade. The rest of the server only imports this file.
//
// Contract (every driver must implement):
//   workspaceDir(siteId)                     -> agent workspace path on disk
//   ensureWorkspace(siteId)                  -> create the workspace if missing, return its path
//   createConversation(siteId, uid)          -> new (persisted) conversation
//   getConversation(siteId, id, uid)         -> conversation if it exists AND belongs to uid, else null
//   saveConversation(conv)                   -> persist, bumps conv.updatedAt
//   listConversations(siteId, uid)           -> [{id, title, updatedAt, messageCount}] newest first
//   deleteConversation(siteId, id, uid)      -> true if deleted
//   recordUsage(entry)                       -> append one usage record (see UsageEntry)
//   usageSummary(siteId, {uid?, since})      -> totals since an ISO date, overall + by backend
//   close()                                  -> release resources (optional for file driver)
//
// The agent workspace is ALWAYS a directory on disk (agent CLIs work on files) whatever the driver;
// only conversations and usage records move into a database.
//
// Pick a driver with STORE_DRIVER (default "file"). New driver: write server/store/<name>-store.mjs
// returning the object above and register it in `drivers`.
import { config } from './config.mjs';
import { createFileStore } from './store/file-store.mjs';

/**
 * @typedef {object} UsageEntry
 * @property {string} siteId
 * @property {string} uid
 * @property {'chat'|'compose'} kind
 * @property {string} [conversationId]
 * @property {string} backend
 * @property {string} status
 * @property {number} turns          CLI invocations in this request (retries/nudges included)
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cachedTokens
 * @property {number} costUsd        0 when the CLI does not report cost
 * @property {number} durationMs
 * @property {string} [at]           ISO time, filled in by the driver when missing
 *
 * @typedef {{requests:number, inputTokens:number, outputTokens:number, cachedTokens:number, costUsd:number}} UsageTotals
 * @typedef {UsageTotals & {byBackend: Record<string, UsageTotals>}} UsageSummary
 *
 * @typedef {object} Store
 * @property {(siteId: string) => string} workspaceDir
 * @property {(siteId: string) => Promise<string>} ensureWorkspace
 * @property {(siteId: string, uid: string) => Promise<object>} createConversation
 * @property {(siteId: string, id: string, uid: string) => Promise<object|null>} getConversation
 * @property {(conv: object) => Promise<void>} saveConversation
 * @property {(siteId: string, uid: string) => Promise<Array<{id:string,title:string,updatedAt:string,messageCount:number}>>} listConversations
 * @property {(siteId: string, id: string, uid: string) => Promise<boolean>} deleteConversation
 * @property {(entry: UsageEntry) => Promise<void>} recordUsage
 * @property {(siteId: string, opts: {uid?: string, since: string}) => Promise<UsageSummary>} usageSummary
 * @property {() => void} [close]
 */

const drivers = {
  file: async () => createFileStore({ dataDir: config.dataDir }),
  sqlite: async () => (await import('./store/sqlite-store.mjs')).createSqliteStore({ dataDir: config.dataDir }),
};

const make = drivers[config.storeDriver];
if (!make) {
  throw new Error(`Invalid STORE_DRIVER "${config.storeDriver}" (available: ${Object.keys(drivers).join(', ')})`);
}

/** @type {Store} */
const impl = await make();

export const workspaceDir = impl.workspaceDir;
export const ensureWorkspace = impl.ensureWorkspace;
export const createConversation = impl.createConversation;
export const getConversation = impl.getConversation;
export const saveConversation = impl.saveConversation;
export const listConversations = impl.listConversations;
export const deleteConversation = impl.deleteConversation;
export const recordUsage = impl.recordUsage;
export const usageSummary = impl.usageSummary;
export const close = () => impl.close?.();
