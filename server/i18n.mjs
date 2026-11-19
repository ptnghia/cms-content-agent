// User-facing backend strings (chat replies the backend adds, API error messages).
// Agent-facing text (prompts, workspace files) is English; the agent replies in the user's language.
// Add a language: copy the `en` block, translate the values, keep the {placeholders}.

const STRINGS = {
  en: {
    rate_limited: 'Too many requests. Try again in {min} min.',
    server_busy: 'The assistant is busy. Try again in a few minutes.',
    denied: 'The task was refused because the agent lacks permission: {tools}.',
    empty_reply: 'The agent returned nothing. Please try again.',
    empty_brief: 'Describe the article or enter a focus keyword.',
    empty_content: 'There is no content to optimise yet.',
    bad_format: 'The agent did not answer in the expected ===SECTION=== format. Please try again.',
    sent_title: 'Sent to the website (waiting for review):',
    sent_ok: '✅ `{file}` → proposal #{id} waiting for review',
    sent_review: 'open to review',
    sent_warn: 'Warning',
    sent_fail: '❌ `{file}`: {error}',
  },
  vi: {
    rate_limited: 'Bạn đã gửi quá nhiều yêu cầu, thử lại sau {min} phút.',
    server_busy: 'Hệ thống đang bận, thử lại sau ít phút.',
    denied: 'Tác vụ bị từ chối vì agent không có quyền: {tools}.',
    empty_reply: 'Agent không trả về nội dung. Hãy thử lại.',
    empty_brief: 'Hãy mô tả bài cần viết hoặc nhập từ khoá chính.',
    empty_content: 'Chưa có nội dung để tối ưu.',
    bad_format: 'Agent không trả đúng định dạng (thiếu các mục ===SECTION===). Hãy thử lại.',
    sent_title: 'Đã gửi lên website (chờ quản trị viên duyệt):',
    sent_ok: '✅ `{file}` → đề xuất #{id} chờ duyệt',
    sent_review: 'mở để duyệt',
    sent_warn: 'Cảnh báo',
    sent_fail: '❌ `{file}`: {error}',
  },
};

/** Primary subtag of the site's language ("vi-VN" -> "vi"), falling back to English. */
export function uiLang(site) {
  const l = String(site?.uiLanguage || site?.language || 'en').toLowerCase().split(/[-_]/)[0];
  return STRINGS[l] ? l : 'en';
}

export function t(site, key, vars = {}) {
  const s = STRINGS[uiLang(site)][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** English name of a language code for prompts ("vi" -> "Vietnamese"); unknown codes are returned as is. */
export function languageName(code) {
  const c = String(code || 'en');
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(c) || c; } catch { return c; }
}
