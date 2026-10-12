/*!
 * Agy Chat widget — nhúng vào trang admin bằng một thẻ <script>.
 *
 *   <script src="https://AGENT-HOST/widget.js"
 *           data-token-url="/admin/agy-token.php"   (endpoint PHP trả {"token": "..."} ; hoặc data-token="...")
 *           data-mode="floating"                    (floating | inline)
 *           data-target="#agy-chat"                 (chỉ khi inline)
 *           data-title="Trợ lý nội dung"></script>
 *
 * Toàn bộ UI nằm trong Shadow DOM nên không xung đột CSS/JS với trang admin.
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
    // trạng thái gửi / nhận / đang trả lời
    '.m.user .tick{display:block;font-size:11px;opacity:.85;text-align:right;margin-top:2px;white-space:normal}',
    '.m.user .tick.ok{opacity:1}',
    '.status{align-self:flex-start;max-width:92%;background:var(--bot);padding:8px 12px;border-radius:12px;display:flex;flex-direction:column;gap:3px}',
    '.status .line{display:flex;align-items:center;gap:8px}',
    '.status .dots{display:inline-flex;gap:3px;flex:none}',
    '.status .dots i{width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.3;animation:agyb 1.2s infinite ease-in-out}',
    '.status .dots i:nth-child(2){animation-delay:.15s}.status .dots i:nth-child(3){animation-delay:.3s}',
    '.status small{color:var(--muted);font-size:11px;line-height:1.4}',
    '@keyframes agyb{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
    '@media(prefers-reduced-motion:reduce){.status .dots i{animation:none;opacity:.7}}'
  ].join('');

  // ---------- markdown tối giản, an toàn (escape trước, chỉ sinh thẻ trong danh sách trắng) ----------
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
    var storeKey = 'agychat:' + (api || location.origin);
    var host = document.createElement('div');
    var shadow = host.attachShadow({ mode: 'open' });
    var mode = opts.mode === 'inline' ? 'inline' : 'floating';

    var target = null;
    if (mode === 'inline') {
      target = opts.target ? document.querySelector(opts.target) : null;
      if (!target) { console.error('[AgyChat] không tìm thấy data-target:', opts.target); return; }
      host.style.cssText = 'display:block;width:100%;height:100%';
      target.appendChild(host);
    } else {
      document.body.appendChild(host);
    }

    shadow.innerHTML =
      '<style>' + CSS + '</style><div class="root ' + mode + '">' +
      (mode === 'floating' ? '<button class="launcher" aria-label="Mở trợ lý">💬</button>' : '') +
      '<div class="panel' + (mode === 'floating' ? ' hidden' : '') + '">' +
      '<div class="head"><div class="title"><span class="t"></span><span class="sub"></span></div>' +
      '<button class="ibtn sync" title="Đồng bộ bài viết từ website">Đồng bộ</button>' +
      '<button class="ibtn new" title="Hội thoại mới">Mới</button>' +
      (mode === 'floating' ? '<button class="ibtn close" aria-label="Đóng">✕</button>' : '') + '</div>' +
      '<div class="log" aria-live="polite"></div>' +
      '<form class="form"><textarea rows="1" placeholder="Nhập yêu cầu… (Enter gửi, Shift+Enter xuống dòng)"></textarea>' +
      '<button class="send" type="submit">Gửi</button><button class="ibtn stop hidden" type="button">Dừng</button></form>' +
      '</div></div>';

    var $ = function (s) { return shadow.querySelector(s); };
    var panel = $('.panel'), log = $('.log'), ta = $('textarea'), sendBtn = $('.send'), stopBtn = $('.stop');
    var syncBtn = $('.sync'), sub = $('.sub');
    $('.t').textContent = opts.title || 'Trợ lý nội dung & SEO';

    var conversationId = null;
    try { conversationId = localStorage.getItem(storeKey); } catch (e) { /* bỏ qua */ }
    var controller = null, tokenCache = null, loaded = false;

    // --- token ---
    function tokenExp(t) {
      try { return JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
    }
    async function getToken(force) {
      if (!force && tokenCache && tokenExp(tokenCache) - Date.now() > 60000) return tokenCache;
      if (opts.tokenUrl) {
        var r = await fetch(opts.tokenUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('Không lấy được token (' + r.status + ')');
        tokenCache = (await r.json()).token;
      } else if (opts.token) {
        tokenCache = opts.token;
      }
      if (!tokenCache) throw new Error('Thiếu data-token-url hoặc data-token');
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

    // --- UI ---
    function add(kind, text) {
      var el = document.createElement('div');
      el.className = 'm ' + kind;
      if (kind === 'bot') el.innerHTML = renderMarkdown(text || ''); else el.textContent = text || '';
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
    function setBusy(b) {
      sendBtn.disabled = b; ta.disabled = b; syncBtn.disabled = b;
      stopBtn.classList.toggle('hidden', !b);
      sendBtn.classList.toggle('hidden', b);
      if (!b) ta.focus();
    }
    function remember(id) {
      conversationId = id;
      try { id ? localStorage.setItem(storeKey, id) : localStorage.removeItem(storeKey); } catch (e) { /* bỏ qua */ }
    }
    async function refreshStatus() {
      try {
        var r = await call('/api/status');
        if (!r.ok) return;
        var s = await r.json();
        sub.textContent = s.posts ? s.posts.count + ' bài · đồng bộ ' + new Date(s.posts.syncedAt).toLocaleString() : 'Chưa đồng bộ bài viết';
      } catch (e) { /* bỏ qua */ }
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
      } catch (e) { /* bỏ qua */ }
    }

    // --- trạng thái "đã nhận / đang trả lời" ---
    function stepLabel(t) {
      t = String(t || '').toLowerCase();
      if (/write|edit|create|outbox|propos/.test(t)) return 'Đang soạn nội dung / đề xuất…';
      if (/grep|search|find/.test(t)) return 'Đang tìm trong nội dung website…';
      if (/list|dir|ls/.test(t)) return 'Đang rà danh sách bài viết, sản phẩm…';
      if (/view|read|open|file/.test(t)) return 'Đang đọc dữ liệu website…';
      if (/think|plan|reason/.test(t)) return 'Đang phân tích yêu cầu…';
      return 'Trợ lý đang xử lý…';
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
        hint.textContent = sec >= 20 ? 'Yêu cầu phức tạp có thể mất 1–3 phút. Bạn có thể thu nhỏ khung chat — trợ lý vẫn tiếp tục trả lời.' : '';
      }
      var timer = setInterval(render, 1000);
      return {
        set: function (text) { base = text; render(); },
        remove: function () { clearInterval(timer); el.remove(); }
      };
    }

    // --- chat ---
    async function send(message) {
      var userEl = add('user', message);
      var tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = 'Đang gửi…';
      userEl.appendChild(tick);
      var status = addStatus();
      status.set('Đang gửi tin nhắn…');
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
          var code = ''; try { code = (await res.json()).error; } catch (e) { /* bỏ qua */ }
          var msgs = { conversation_busy: 'Hội thoại đang xử lý, thử lại sau.', server_busy: 'Máy chủ đang bận, thử lại sau ít phút.', conversation_not_found: 'Hội thoại không còn tồn tại.' };
          if (code === 'conversation_not_found') remember(null);
          throw new Error(msgs[code] || 'Lỗi ' + res.status + (code ? ' (' + code + ')' : ''));
        }
        tick.textContent = 'Đã gửi';
        status.set('Đã gửi, đang chờ trợ lý nhận…');
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
              tick.textContent = '✓ Trợ lý đã nhận tin nhắn'; tick.className = 'tick ok';
              status.set('Trợ lý đã nhận tin nhắn, đang xử lý…');
              sub.textContent = 'Đang trả lời…';
            }
            else if (ev.type === 'step') { if (!gotDelta) status.set(stepLabel(ev.stepType)); }
            else if (ev.type === 'delta') {
              if (!gotDelta) { gotDelta = true; status.remove(); tick.textContent = '✓ Đã nhận · đang trả lời'; sub.textContent = 'Đang trả lời…'; }
              acc += ev.text; bot.innerHTML = renderMarkdown(acc); log.scrollTop = log.scrollHeight;
            }
            else if (ev.type === 'error') add('err', ev.message);
            else if (ev.type === 'proposals') sub.textContent = ev.items.filter(function (x) { return x.ok; }).length + ' đề xuất vừa gửi — chờ duyệt trong admin';
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') add('note', 'Đã dừng.'); else add('err', e.message);
      } finally {
        status.remove();
        if (tick.parentNode) { if (acc) { tick.textContent = '✓ Đã trả lời'; tick.className = 'tick ok'; } else { tick.remove(); } }
        if (sub.textContent === 'Đang trả lời…') sub.textContent = subBefore;
        if (!acc) bot.remove();
        controller = null;
        setBusy(false);
      }
    }

    async function sync() {
      syncBtn.disabled = true; sub.textContent = 'Đang đồng bộ…';
      try {
        var r = await call('/api/sync', { method: 'POST' });
        var d = await r.json();
        if (!r.ok) throw new Error(d.message || 'Lỗi ' + r.status);
        var extra = ['products', 'categories', 'keywords'].filter(function (k) { return d[k] !== undefined; })
          .map(function (k) { return d[k] + ' ' + { products: 'sản phẩm', categories: 'danh mục', keywords: 'từ khoá' }[k]; });
        add('note', 'Đã đồng bộ ' + d.count + ' bài viết' + (extra.length ? ', ' + extra.join(', ') : '') + '.');
      } catch (e) { add('err', 'Đồng bộ thất bại: ' + e.message); }
      syncBtn.disabled = false;
      refreshStatus();
    }

    shadow.querySelector('.form').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = ta.value.trim();
      if (!t || controller) return;
      ta.value = '';
      send(t);
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); shadow.querySelector('.form').requestSubmit(); }
    });
    stopBtn.addEventListener('click', function () { if (controller) controller.abort(); });
    syncBtn.addEventListener('click', sync);
    $('.new').addEventListener('click', function () {
      if (controller) controller.abort();
      remember(null);
      log.textContent = '';
      add('note', 'Hội thoại mới.');
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
    return { api: origin, token: d.token, tokenUrl: d.tokenUrl, mode: d.mode, target: d.target, title: d.title };
  }

  window.AgyChat = { mount: mount };
  var cs = document.currentScript;
  if (cs && cs.dataset.auto !== 'false') {
    var go = function () { mount(fromScript(cs)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
