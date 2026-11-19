/*!
 * cms-content-agent chat widget: embed in an admin page with one <script> tag.
 *
 *   <script src="https://AGENT-HOST/widget.js"
 *           data-token-url="/admin/token"     (endpoint returning {"token": "..."}; or data-token="...")
 *           data-upload-url="/admin/upload"   (optional: enables 📎 image attachments; receives images[], returns {"files":[{file,name,w,h,url?}]})
 *           data-media-url="/uploads/"        (optional: folder of uploaded images, used when the upload response has no url)
 *           data-mode="floating"              (floating | inline)
 *           data-target="#agent-chat"         (inline only)
 *           data-lang="vi"                    (optional: UI language, default <html lang> or the browser's; en and vi ship)
 *           data-title="Content assistant"></script>
 *
 * The UI lives in a Shadow DOM, so it does not clash with the admin page's CSS or JS.
 */
(function () {
  'use strict';

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.root{--bg:#fff;--panel:#f6f7f9;--text:#1d2330;--muted:#6b7280;--accent:#2563eb;--bot:#eef0f4;--border:#dfe3ea;--err:#b91c1c;',
    'font:14px/1.5 system-ui,"Segoe UI",sans-serif;color:var(--text)}',
    '@media(prefers-color-scheme:dark){.root{--bg:#1b1f27;--panel:#14171d;--text:#e6e9ef;--muted:#9aa3b2;--bot:#262b36;--border:#2f3542;--err:#f87171}}',
    '.launcher{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:var(--accent);color:#fff;font-size:24px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483000}',
    '.panel{display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden}',
    '.floating .panel{position:fixed;right:20px;bottom:88px;width:min(420px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:2147483000}',
    '.inline,.inline .panel{height:100%}',
    '.inline .panel{width:100%;min-height:420px}',
    '.m.bot:empty{display:none}',
    '.hidden{display:none!important}',
    '.head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--panel);border-bottom:1px solid var(--border)}',
    '.title{flex:1;font-weight:600;font-size:14px}',
    '.sub{font-size:11px;color:var(--muted);font-weight:400;display:block}',
    '.ibtn{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer}',
    '.ibtn:disabled{opacity:.5;cursor:default}',
    '.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
    '.m{max-width:92%;padding:8px 12px;border-radius:12px;word-wrap:break-word;overflow-wrap:anywhere}',
    '.m.user{align-self:flex-end;background:var(--accent);color:#fff;white-space:pre-wrap}',
    '.m.bot{align-self:flex-start;background:var(--bot)}',
    '.m.err{align-self:flex-start;border:1px solid var(--err);color:var(--err)}',
    '.m.note{align-self:center;color:var(--muted);font-size:12px;padding:0}',
    '.m p{margin:0 0 8px}.m p:last-child{margin:0}',
    '.m h3,.m h4,.m h5{margin:6px 0 4px;font-size:14px}',
    '.m ul,.m ol{margin:4px 0 8px;padding-left:20px}',
    '.m code{background:rgba(127,127,127,.2);padding:1px 4px;border-radius:4px;font-size:12px}',
    '.m pre{background:rgba(127,127,127,.15);padding:8px;border-radius:8px;overflow-x:auto;margin:6px 0}',
    '.m pre code{background:none;padding:0}',
    '.m table{border-collapse:collapse;margin:6px 0;font-size:12px;display:block;overflow-x:auto}',
    '.m th,.m td{border:1px solid var(--border);padding:3px 6px;text-align:left}',
    '.m a{color:var(--accent)}',
    '.form{display:flex;gap:6px;padding:8px;border-top:1px solid var(--border);background:var(--panel)}',
    'textarea{flex:1;resize:none;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;max-height:120px}',
    '.send{border:0;border-radius:8px;background:var(--accent);color:#fff;padding:0 14px;font:inherit;cursor:pointer}',
    '.send:disabled{opacity:.5;cursor:default}',
    // sent / received / replying states
    '.m.user .tick{display:block;font-size:11px;opacity:.85;text-align:right;margin-top:2px;white-space:normal}',
    '.m.user .tick.ok{opacity:1}',
    '.status{align-self:flex-start;max-width:92%;background:var(--bot);padding:8px 12px;border-radius:12px;display:flex;flex-direction:column;gap:3px}',
    '.status .line{display:flex;align-items:center;gap:8px}',
    '.status .dots{display:inline-flex;gap:3px;flex:none}',
    '.status .dots i{width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.3;animation:cabounce 1.2s infinite ease-in-out}',
    '.status .dots i:nth-child(2){animation-delay:.15s}.status .dots i:nth-child(3){animation-delay:.3s}',
    '.status small{color:var(--muted);font-size:11px;line-height:1.4}',
    '@keyframes cabounce{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '@media(prefers-reduced-motion:reduce){.status .dots i{animation:none;opacity:.7}}',
    // image attachments
    '.attach{display:flex;flex-wrap:wrap;gap:8px;padding:8px 10px 0;background:var(--panel);border-top:1px solid var(--border)}',
    '.attach:empty{display:none}',
    '.thumb{position:relative;width:62px;height:62px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--bg)}',
    '.thumb img{width:100%;height:100%;object-fit:cover;display:block}',
    '.thumb button{position:absolute;top:2px;right:2px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:20px;padding:0;cursor:pointer}',
    '.clip{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;width:38px;font-size:17px;cursor:pointer;flex:none}',
    '.clip:disabled{opacity:.5;cursor:default}',
    '.m .pics{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.m .pics a{display:block;width:84px;height:84px;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,.55)}',
    '.m .pics img{width:100%;height:100%;object-fit:cover;display:block}',
    '.drop .panel{outline:2px dashed var(--accent);outline-offset:-6px}'
  ].join('');

  // ---------- UI strings (add a language by copying the en block) ----------
  var I18N = {
    en: {
      open: 'Open assistant', sync: 'Sync', syncTitle: 'Sync content from the website', newChat: 'New', newTitle: 'New conversation', close: 'Close',
      attachments: 'Attached images', attachTitle: 'Attach images (up to 5, 8 MB each)', placeholder: 'Ask something… (Enter to send, Shift+Enter for a new line)',
      send: 'Send', stop: 'Stop', title: 'Content & SEO assistant', noTarget: 'data-target not found:', tokenFail: 'Could not get a token', tokenMissing: 'Missing data-token-url or data-token',
      removeImage: 'Remove this image', removeImageNamed: 'Remove image', onlyImages: 'Only JPG, PNG, WebP or GIF images.', tooBig: 'is larger than 8 MB.', max5: 'At most 5 images per message.',
      uploadFail: 'Could not upload images', posts: 'items', synced: 'synced', notSynced: 'Content not synced yet',
      stWrite: 'Writing content / proposals…', stSearch: 'Searching the website content…', stList: 'Scanning posts and products…', stRead: 'Reading website data…', stThink: 'Analysing the request…', stWork: 'Working…',
      slow: 'Complex requests can take 1–3 minutes. You can minimise the chat; the assistant keeps working.',
      sending: 'Sending…', sendingMsg: 'Sending message…', convBusy: 'This conversation is still busy, try again shortly.', serverBusy: 'The server is busy, try again in a few minutes.',
      convGone: 'This conversation no longer exists.', error: 'Error', sent: 'Sent', waiting: 'Sent, waiting for the assistant…', received: '✓ Received by the assistant',
      working: 'Received, working on it…', replying: 'Replying…', receivedReplying: '✓ Received · replying', proposalsSent: 'proposals sent, waiting for review in wp-admin',
      stopped: 'Stopped.', replied: '✓ Replied', syncing: 'Syncing…', syncedN: 'Synced', postsWord: 'posts and pages', products: 'products', categories: 'categories', keywords: 'keywords',
      syncFail: 'Sync failed', imagesOnly: 'I am attaching images to use in the article.', uploading: 'Uploading', imagesToSite: 'images to the website…',
      uploadFailed: 'Image upload failed', stillPending: 'the images are still attached, try sending again.', newConv: 'New conversation.'
    },
    vi: {
      open: 'Mở trợ lý', sync: 'Đồng bộ', syncTitle: 'Đồng bộ nội dung từ website', newChat: 'Mới', newTitle: 'Hội thoại mới', close: 'Đóng',
      attachments: 'Hình đính kèm', attachTitle: 'Đính kèm hình (tối đa 5, mỗi hình ≤ 8 MB)', placeholder: 'Nhập yêu cầu… (Enter gửi, Shift+Enter xuống dòng)',
      send: 'Gửi', stop: 'Dừng', title: 'Trợ lý nội dung & SEO', noTarget: 'không tìm thấy data-target:', tokenFail: 'Không lấy được token', tokenMissing: 'Thiếu data-token-url hoặc data-token',
      removeImage: 'Bỏ hình này', removeImageNamed: 'Bỏ hình', onlyImages: 'Chỉ nhận hình JPG, PNG, WebP hoặc GIF.', tooBig: 'lớn hơn 8 MB.', max5: 'Tối đa 5 hình mỗi lần gửi.',
      uploadFail: 'Không tải được hình', posts: 'bài', synced: 'đồng bộ', notSynced: 'Chưa đồng bộ bài viết',
      stWrite: 'Đang soạn nội dung / đề xuất…', stSearch: 'Đang tìm trong nội dung website…', stList: 'Đang rà danh sách bài viết, sản phẩm…', stRead: 'Đang đọc dữ liệu website…', stThink: 'Đang phân tích yêu cầu…', stWork: 'Trợ lý đang xử lý…',
      slow: 'Yêu cầu phức tạp có thể mất 1–3 phút. Bạn có thể thu nhỏ khung chat, trợ lý vẫn tiếp tục trả lời.',
      sending: 'Đang gửi…', sendingMsg: 'Đang gửi tin nhắn…', convBusy: 'Hội thoại đang xử lý, thử lại sau.', serverBusy: 'Máy chủ đang bận, thử lại sau ít phút.',
      convGone: 'Hội thoại không còn tồn tại.', error: 'Lỗi', sent: 'Đã gửi', waiting: 'Đã gửi, đang chờ trợ lý nhận…', received: '✓ Trợ lý đã nhận tin nhắn',
      working: 'Trợ lý đã nhận tin nhắn, đang xử lý…', replying: 'Đang trả lời…', receivedReplying: '✓ Đã nhận · đang trả lời', proposalsSent: 'đề xuất vừa gửi, chờ duyệt trong wp-admin',
      stopped: 'Đã dừng.', replied: '✓ Đã trả lời', syncing: 'Đang đồng bộ…', syncedN: 'Đã đồng bộ', postsWord: 'bài viết và trang', products: 'sản phẩm', categories: 'danh mục', keywords: 'từ khoá',
      syncFail: 'Đồng bộ thất bại', imagesOnly: 'Tôi gửi kèm hình ảnh để dùng cho bài viết.', uploading: 'Đang tải', imagesToSite: 'hình lên website…',
      uploadFailed: 'Tải hình thất bại', stillPending: 'hình vẫn đang chờ, bạn thử gửi lại.', newConv: 'Hội thoại mới.'
    }
  };
  function pickLang(l) {
    l = String(l || document.documentElement.lang || navigator.language || 'en').toLowerCase().split(/[-_]/)[0];
    return I18N[l] ? l : 'en';
  }

  // ---------- minimal, safe markdown (escape first, emit only whitelisted tags) ----------
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inline(s) {
    return s.split(/`([^`]+)`/).map(function (part, i) {
      if (i % 2) return '<code>' + part + '</code>';
      return part
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    }).join('');
  }
  function renderMarkdown(src) {
    var codes = [];
    function stash(_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; }
    src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, stash).replace(/```[^\n]*\n([\s\S]*)$/, stash);
    var lines = esc(src).split('\n');
    var html = '', i = 0, para = [];
    function flush() { if (para.length) { html += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; } }
    function cells(l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); }); }
    while (i < lines.length) {
      var l = lines[i], m;
      if ((m = /^\u0000(\d+)\u0000$/.exec(l.trim()))) {
        flush(); html += '<pre><code>' + codes[+m[1]].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>'; i++;
      } else if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
        flush(); var lv = Math.min(5, m[1].length + 2); html += '<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>'; i++;
      } else if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        flush();
        var head = cells(l), rows = []; i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        html += '<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table>';
      } else if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
        flush();
        var ord = /^\s*\d/.test(l), items = [];
        while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, '')) + '</li>'); i++;
        }
        html += (ord ? '<ol>' : '<ul>') + items.join('') + (ord ? '</ol>' : '</ul>');
      } else if (!l.trim()) {
        flush(); i++;
      } else {
        para.push(l); i++;
      }
    }
    flush();
    return html;
  }

  // ---------- widget ----------
  function mount(opts) {
    var scriptOrigin = opts.api || '';
    var api = scriptOrigin.replace(/\/$/, '');
    var storeKey = 'cms-agent:' + (api || location.origin);
    var host = document.createElement('div');
    var shadow = host.attachShadow({ mode: 'open' });
    var mode = opts.mode === 'inline' ? 'inline' : 'floating';
    var T = I18N[pickLang(opts.lang)];

    var target = null;
    if (mode === 'inline') {
      target = opts.target ? document.querySelector(opts.target) : null;
      if (!target) { console.error('[ContentAgent] ' + T.noTarget, opts.target); return; }
      host.style.cssText = 'display:block;width:100%;height:100%';
      target.appendChild(host);
    } else {
      document.body.appendChild(host);
    }

    shadow.innerHTML =
      '<style>' + CSS + '</style><div class="root ' + mode + '">' +
      (mode === 'floating' ? '<button class="launcher" aria-label="' + T.open + '">💬</button>' : '') +
      '<div class="panel' + (mode === 'floating' ? ' hidden' : '') + '">' +
      '<div class="head"><div class="title"><span class="t"></span><span class="sub"></span></div>' +
      '<button class="ibtn sync" title="' + T.syncTitle + '">' + T.sync + '</button>' +
      '<button class="ibtn new" title="' + T.newTitle + '">' + T.newChat + '</button>' +
      (mode === 'floating' ? '<button class="ibtn close" aria-label="' + T.close + '">✕</button>' : '') + '</div>' +
      '<div class="log" aria-live="polite"></div>' +
      '<div class="attach" aria-label="' + T.attachments + '"></div>' +
      '<form class="form">' + (opts.uploadUrl ? '<button class="clip" type="button" title="' + T.attachTitle + '" aria-label="' + T.attachments + '">📎</button><input class="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>' : '') + '<textarea rows="1" placeholder="' + T.placeholder + '"></textarea>' +
      '<button class="send" type="submit">' + T.send + '</button><button class="ibtn stop hidden" type="button">' + T.stop + '</button></form>' +
      '</div></div>';

    var $ = function (s) { return shadow.querySelector(s); };
    var panel = $('.panel'), log = $('.log'), ta = $('textarea'), sendBtn = $('.send'), stopBtn = $('.stop');
    var syncBtn = $('.sync'), sub = $('.sub');
    $('.t').textContent = opts.title || T.title;

    var conversationId = null;
    try { conversationId = localStorage.getItem(storeKey); } catch (e) { /* ignore */ }
    var controller = null, tokenCache = null, loaded = false;

    // --- token ---
    function tokenExp(t) {
      try { return JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
    }
    async function getToken(force) {
      if (!force && tokenCache && tokenExp(tokenCache) - Date.now() > 60000) return tokenCache;
      if (opts.tokenUrl) {
        var r = await fetch(opts.tokenUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(T.tokenFail + ' (' + r.status + ')');
        tokenCache = (await r.json()).token;
      } else if (opts.token) {
        tokenCache = opts.token;
      }
      if (!tokenCache) throw new Error(T.tokenMissing);
      return tokenCache;
    }
    async function call(path, init, retried) {
      init = init || {};
      var token = await getToken(!!retried);
      init.headers = Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {});
      var res = await fetch(api + path, init);
      if (res.status === 401 && !retried && opts.tokenUrl) return call(path, init, true);
      return res;
    }

    // --- image attachments ---
    // The block appended to the message is read by the agent, so it is always English ("[Hình đính kèm" = older messages).
    var ATT_MARK = '[Attached images', ATT_MARKS = [ATT_MARK, '[Hình đính kèm'];
    var pending = [];                                   // files waiting to be sent
    var attachBox = $('.attach'), fileIn = $('.file'), clipBtn = $('.clip');
    function imgUrl(name) {                              // URL of an uploaded image: data-media-url + file name
      if (!opts.mediaUrl) return '';
      try { return new URL(encodeURIComponent(name), new URL(opts.mediaUrl, location.href)).href; } catch (e) { return ''; }
    }
    function renderUser(el, text) {
      var i = -1; ATT_MARKS.forEach(function (mk) { var k = text.indexOf(mk); if (k >= 0 && (i < 0 || k < i)) i = k; });
      var body = i >= 0 ? text.slice(0, i).trim() : text;
      el.textContent = body;
      if (i < 0 || !opts.uploadUrl) return;
      // one line per image: "1. <file> (original: …, w×h) — <url>"; the url is optional
      var urls = [], re = /^\s*\d+\.\s+([A-Za-z0-9._-]+\.(?:webp|jpe?g|png|gif|avif))\b[^\n]*?(?:— (https?:\/\/\S+|\/\S+))?\s*$/gim, m;
      while ((m = re.exec(text.slice(i)))) { var u = m[2] || imgUrl(m[1]); if (/^(https?:\/\/|\/)/.test(u)) urls.push(u); }
      if (!urls.length) return;
      var box = document.createElement('div'); box.className = 'pics';
      urls.forEach(function (u) {
        var a = document.createElement('a'), im = document.createElement('img');
        a.href = u; a.target = '_blank'; a.rel = 'noopener'; im.src = a.href; im.alt = ''; im.loading = 'lazy'; a.appendChild(im); box.appendChild(a);
      });
      el.appendChild(box);
    }
    function paintAttach() {
      if (!attachBox) return;
      attachBox.textContent = '';
      pending.forEach(function (f, i) {
        var t = document.createElement('div'), im = document.createElement('img'), b = document.createElement('button');
        t.className = 'thumb'; im.src = URL.createObjectURL(f); im.alt = f.name; im.onload = function () { URL.revokeObjectURL(im.src); };
        b.type = 'button'; b.textContent = '✕'; b.title = T.removeImage; b.setAttribute('aria-label', T.removeImageNamed + ' ' + f.name);
        b.addEventListener('click', function () { pending.splice(i, 1); paintAttach(); });
        t.appendChild(im); t.appendChild(b); attachBox.appendChild(t);
      });
    }
    function addFiles(list) {
      var warn = '';
      Array.prototype.forEach.call(list || [], function (f) {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { warn = T.onlyImages; return; }
        if (f.size > 8 * 1024 * 1024) { warn = '"' + f.name + '" ' + T.tooBig; return; }
        if (pending.length >= 5) { warn = T.max5; return; }
        pending.push(f);
      });
      paintAttach();
      if (warn) add('note', warn);
    }
    async function uploadPending() {                     // -> [{file,name,w,h,url}] now on the website
      var fd = new FormData();
      pending.forEach(function (f) { fd.append('images[]', f, f.name); });
      var r = await fetch(opts.uploadUrl, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      var j = {}; try { j = await r.json(); } catch (e) { /* ignore */ }
      if (!r.ok || !j.files) throw new Error(j.error || T.uploadFail + ' (' + r.status + ')');
      return j.files;
    }
    function attachBlock(files) {
      return '\n\n' + ATT_MARK + ': ' + files.length + ' images uploaded to the website (use the file name for featured_image, insert in the body with <img src="URL">)]\n' +
        files.map(function (f, i) {
          var u = f.url || imgUrl(f.file);
          return (i + 1) + '. ' + f.file + ' (original: ' + f.name + ', ' + f.w + '×' + f.h + ')' + (u ? ' — ' + u : '');
        }).join('\n');
    }

    // --- UI ---
    function add(kind, text) {
      var el = document.createElement('div');
      el.className = 'm ' + kind;
      if (kind === 'bot') el.innerHTML = renderMarkdown(text || '');
      else if (kind === 'user') renderUser(el, text || '');
      else el.textContent = text || '';
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
    function setBusy(b) {
      sendBtn.disabled = b; ta.disabled = b; syncBtn.disabled = b; if (clipBtn) clipBtn.disabled = b;
      stopBtn.classList.toggle('hidden', !b);
      sendBtn.classList.toggle('hidden', b);
      if (!b) ta.focus();
    }
    function remember(id) {
      conversationId = id;
      try { id ? localStorage.setItem(storeKey, id) : localStorage.removeItem(storeKey); } catch (e) { /* ignore */ }
    }
    async function refreshStatus() {
      try {
        var r = await call('/api/status');
        if (!r.ok) return;
        var s = await r.json();
        sub.textContent = s.posts ? s.posts.count + ' ' + T.posts + ' · ' + T.synced + ' ' + new Date(s.posts.syncedAt).toLocaleString() : T.notSynced;
      } catch (e) { /* ignore */ }
    }
    async function loadHistory() {
      if (loaded) return; loaded = true;
      refreshStatus();
      if (!conversationId) return;
      try {
        var r = await call('/api/conversations/' + conversationId);
        if (r.status === 404) { remember(null); return; }
        if (!r.ok) return;
        (await r.json()).messages.forEach(function (m) { add(m.role === 'user' ? 'user' : 'bot', m.content); });
      } catch (e) { /* ignore */ }
    }

    // --- "received / replying" status ---
    function stepLabel(t) {
      t = String(t || '').toLowerCase();
      if (/write|edit|create|outbox|propos/.test(t)) return T.stWrite;
      if (/grep|search|find/.test(t)) return T.stSearch;
      if (/list|dir|ls/.test(t)) return T.stList;
      if (/view|read|open|file/.test(t)) return T.stRead;
      if (/think|plan|reason/.test(t)) return T.stThink;
      return T.stWork;
    }
    function addStatus() {
      var el = document.createElement('div');
      el.className = 'status';
      el.setAttribute('role', 'status');
      el.innerHTML = '<div class="line"><span class="dots"><i></i><i></i><i></i></span><span class="lbl"></span></div><small class="hint"></small>';
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      var lbl = el.querySelector('.lbl'), hint = el.querySelector('.hint');
      var t0 = Date.now(), base = '';
      function render() {
        var sec = Math.floor((Date.now() - t0) / 1000);
        var mm = Math.floor(sec / 60), ss = ('0' + (sec % 60)).slice(-2);
        lbl.textContent = base + ' (' + mm + ':' + ss + ')';
        hint.textContent = sec >= 20 ? T.slow : '';
      }
      var timer = setInterval(render, 1000);
      return {
        set: function (text) { base = text; render(); },
        remove: function () { clearInterval(timer); el.remove(); }
      };
    }

    // --- chat ---
    async function send(message, files) {
      if (files && files.length) message += attachBlock(files);
      var userEl = add('user', message);
      var tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = T.sending;
      userEl.appendChild(tick);
      var status = addStatus();
      status.set(T.sendingMsg);
      var subBefore = sub.textContent;
      var bot = add('bot', ''), acc = '', gotDelta = false;
      setBusy(true);
      controller = new AbortController();
      try {
        var res = await call('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message, conversationId: conversationId }),
          signal: controller.signal
        });
        if (!res.ok) {
          var code = ''; try { code = (await res.json()).error; } catch (e) { /* ignore */ }
          var msgs = { conversation_busy: T.convBusy, server_busy: T.serverBusy, conversation_not_found: T.convGone };
          if (code === 'conversation_not_found') remember(null);
          throw new Error(msgs[code] || T.error + ' ' + res.status + (code ? ' (' + code + ')' : ''));
        }
        tick.textContent = T.sent;
        status.set(T.waiting);
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            var block = buf.slice(0, idx); buf = buf.slice(idx + 2);
            if (block.indexOf('data: ') !== 0) continue;
            var ev = JSON.parse(block.slice(6));
            if (ev.type === 'init') {
              remember(ev.conversationId);
              tick.textContent = T.received; tick.className = 'tick ok';
              status.set(T.working);
              sub.textContent = T.replying;
            }
            else if (ev.type === 'step') { if (!gotDelta) status.set(stepLabel(ev.stepType)); }
            else if (ev.type === 'delta') {
              if (!gotDelta) { gotDelta = true; status.remove(); tick.textContent = T.receivedReplying; sub.textContent = T.replying; }
              acc += ev.text; bot.innerHTML = renderMarkdown(acc); log.scrollTop = log.scrollHeight;
            }
            else if (ev.type === 'error') add('err', ev.message);
            else if (ev.type === 'proposals') sub.textContent = ev.items.filter(function (x) { return x.ok; }).length + ' ' + T.proposalsSent;
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') add('note', T.stopped); else add('err', e.message);
      } finally {
        status.remove();
        if (tick.parentNode) { if (acc) { tick.textContent = T.replied; tick.className = 'tick ok'; } else { tick.remove(); } }
        if (sub.textContent === T.replying) sub.textContent = subBefore;
        if (!acc) bot.remove();
        controller = null;
        setBusy(false);
      }
    }

    async function sync() {
      syncBtn.disabled = true; sub.textContent = T.syncing;
      try {
        var r = await call('/api/sync', { method: 'POST' });
        var d = await r.json();
        if (!r.ok) throw new Error(d.message || T.error + ' ' + r.status);
        var extra = ['products', 'categories', 'keywords'].filter(function (k) { return d[k] !== undefined; })
          .map(function (k) { return d[k] + ' ' + T[k]; });
        add('note', T.syncedN + ' ' + d.count + ' ' + T.postsWord + (extra.length ? ', ' + extra.join(', ') : '') + '.');
      } catch (e) { add('err', T.syncFail + ': ' + e.message); }
      syncBtn.disabled = false;
      refreshStatus();
    }

    shadow.querySelector('.form').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = ta.value.trim();
      if ((!t && !pending.length) || controller) return;
      if (!t) t = T.imagesOnly;
      if (!pending.length) { ta.value = ''; send(t); return; }
      setBusy(true);
      var hint = add('note', T.uploading + ' ' + pending.length + ' ' + T.imagesToSite);
      uploadPending().then(function (files) {
        hint.remove(); ta.value = ''; pending = []; paintAttach(); setBusy(false); send(t, files);
      }).catch(function (err) {
        hint.remove(); setBusy(false); add('err', T.uploadFailed + ': ' + err.message + '; ' + T.stillPending);
      });
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); shadow.querySelector('.form').requestSubmit(); }
    });
    stopBtn.addEventListener('click', function () { if (controller) controller.abort(); });
    if (clipBtn && fileIn) {
      clipBtn.addEventListener('click', function () { fileIn.click(); });
      fileIn.addEventListener('change', function () { addFiles(fileIn.files); fileIn.value = ''; });
      ta.addEventListener('paste', function (e) {        // paste images from the clipboard
        var items = (e.clipboardData && e.clipboardData.files) || [];
        if (items.length) { e.preventDefault(); addFiles(items); }
      });
      var rootEl = $('.root');
      ['dragover', 'dragenter'].forEach(function (ev) { panel.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); rootEl.classList.add('drop'); } }); });
      ['dragleave', 'drop'].forEach(function (ev) { panel.addEventListener(ev, function () { rootEl.classList.remove('drop'); }); });
      panel.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
    }
    syncBtn.addEventListener('click', sync);
    $('.new').addEventListener('click', function () {
      if (controller) controller.abort();
      remember(null);
      pending = []; paintAttach();
      log.textContent = '';
      add('note', T.newConv);
    });
    if (mode === 'floating') {
      var launcher = $('.launcher');
      launcher.addEventListener('click', function () {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) { loadHistory(); ta.focus(); }
      });
      $('.close').addEventListener('click', function () { panel.classList.add('hidden'); });
    } else {
      loadHistory();
    }
    return { destroy: function () { host.remove(); } };
  }

  function fromScript(el) {
    var d = el.dataset;
    var origin = d.api || new URL(el.src, location.href).origin;
    return { api: origin, token: d.token, tokenUrl: d.tokenUrl, uploadUrl: d.uploadUrl, mediaUrl: d.mediaUrl, mode: d.mode, target: d.target, title: d.title, lang: d.lang };
  }

  window.ContentAgent = window.AgyChat = { mount: mount };   // AgyChat kept for older embeds
  var cs = document.currentScript;
  // Auto-mount from data-* attributes; a script tag without a token (e.g. wp_enqueue_script) calls ContentAgent.mount() itself.
  if (cs && cs.dataset.auto !== 'false' && (cs.dataset.tokenUrl || cs.dataset.token)) {
    var go = function () { mount(fromScript(cs)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
