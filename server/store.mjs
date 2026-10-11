// Mặt tiền lưu trữ phía backend. Phần còn lại của code chỉ import file này.
//
// Hợp đồng (mọi driver phải đáp ứng):
//   workspaceDir(siteId)                     -> đường dẫn workspace của agy trên đĩa
//   ensureWorkspace(siteId)                  -> tạo workspace nếu chưa có, trả về đường dẫn
//   createConversation(siteId, uid)          -> hội thoại mới (đã lưu)
//   getConversation(siteId, id, uid)         -> hội thoại nếu tồn tại VÀ thuộc uid, ngược lại null
//   saveConversation(conv)                   -> ghi, cập nhật conv.updatedAt
//   listConversations(siteId, uid)           -> [{id, title, updatedAt, messageCount}] mới nhất trước
//   deleteConversation(siteId, id, uid)      -> true nếu đã xoá
//
// Lưu ý: workspace của agent LUÔN là thư mục trên đĩa (agy chỉ đọc/ghi file), dù driver là gì.
// Chỉ dữ liệu hội thoại (và sau này: nhật ký dùng, trạng thái đồng bộ) mới đổi sang DB.
//
// Chọn driver bằng STORE_DRIVER (mặc định "file"). Thêm driver mới: viết server/store/<tên>-store.mjs
// trả về đúng đối tượng ở trên rồi đăng ký vào `drivers`.
import { config } from './config.mjs';
import { createFileStore } from './store/file-store.mjs';

/**
 * @typedef {object} Store
 * @property {(siteId: string) => string} workspaceDir
 * @property {(siteId: string) => Promise<string>} ensureWorkspace
 * @property {(siteId: string, uid: string) => Promise<object>} createConversation
 * @property {(siteId: string, id: string, uid: string) => Promise<object|null>} getConversation
 * @property {(conv: object) => Promise<void>} saveConversation
 * @property {(siteId: string, uid: string) => Promise<Array<{id:string,title:string,updatedAt:string,messageCount:number}>>} listConversations
 * @property {(siteId: string, id: string, uid: string) => Promise<boolean>} deleteConversation
 */

const drivers = {
  file: () => createFileStore({ dataDir: config.dataDir }),
};

const make = drivers[config.storeDriver];
if (!make) {
  throw new Error(`STORE_DRIVER không hợp lệ: "${config.storeDriver}" (có: ${Object.keys(drivers).join(', ')})`);
}

/** @type {Store} */
const impl = make();

export const workspaceDir = impl.workspaceDir;
export const ensureWorkspace = impl.ensureWorkspace;
export const createConversation = impl.createConversation;
export const getConversation = impl.getConversation;
export const saveConversation = impl.saveConversation;
export const listConversations = impl.listConversations;
export const deleteConversation = impl.deleteConversation;
