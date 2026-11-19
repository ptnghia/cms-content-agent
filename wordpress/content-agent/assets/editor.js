/* Content Agent — "Write with AI" sidebar for the block editor. No build step: uses the wp.* globals. */
(function (wp, cfg) {
  'use strict';
  if (!wp || !cfg || !wp.plugins) return;

  var el = wp.element;
  var h = el.createElement;
  var useState = el.useState;
  var useRef = el.useRef;
  var C = wp.components;
  var data = wp.data;
  var PluginSidebar = (wp.editor && wp.editor.PluginSidebar) || (wp.editPost && wp.editPost.PluginSidebar);
  var MoreMenuItem = (wp.editor && wp.editor.PluginSidebarMoreMenuItem) || (wp.editPost && wp.editPost.PluginSidebarMoreMenuItem);
  var t = cfg.i18n;
  if (!PluginSidebar) return;

  var stripBlocks = function (s) { return String(s || '').replace(/<!--\s*\/?wp:[^>]*?-->\s*/g, '').trim(); };

  function getToken() {
    return fetch(cfg.tokenUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('token ' + r.status); return r.json(); })
      .then(function (j) { if (!j.token) throw new Error('token'); return j.token; });
  }

  /** POST /api/compose and read the SSE stream. Resolves with the result event. */
  async function compose(body, onProgress, signal) {
    var token = await getToken();
    var res = await fetch(cfg.backend + '/api/compose', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal,
    });
    if (!res.ok) {
      var j = {};
      try { j = await res.json(); } catch (e) { /* not JSON */ }
      throw new Error(j.message || j.error || ('HTTP ' + res.status));
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var result = null;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        var block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.indexOf('data: ') !== 0) continue;
        var ev = JSON.parse(block.slice(6));
        if (ev.type === 'progress') onProgress(ev.chars);
        else if (ev.type === 'error') throw new Error(ev.message);
        else if (ev.type === 'result') result = ev;
      }
    }
    if (!result) throw new Error('No result');
    return result;
  }

  function CopyField(props) {
    var s = useState(false);
    if (!props.value) return null;
    return h('div', { className: 'content-agent-copy' },
      h(C.TextareaControl, { label: props.label, value: props.value, readOnly: true, rows: props.rows || 2, onChange: function () {} }),
      h(C.Button, {
        variant: 'secondary', size: 'small',
        onClick: function () { navigator.clipboard.writeText(props.value).then(function () { s[1](true); setTimeout(function () { s[1](false); }, 1500); }); },
      }, s[0] ? t.copied : t.copy));
  }

  function Sidebar() {
    var post = data.useSelect(function (select) {
      var e = select('core/editor');
      return {
        id: e.getCurrentPostId(),
        type: e.getCurrentPostType(),
        title: e.getEditedPostAttribute('title') || '',
        excerpt: e.getEditedPostAttribute('excerpt') || '',
        content: e.getEditedPostContent() || '',
      };
    }, []);
    var editor = data.useDispatch('core/editor');
    var blockEditor = data.useDispatch('core/block-editor');

    var hasContent = stripBlocks(post.content).replace(/<[^>]*>/g, '').trim().length > 0;
    var mode = useState(hasContent ? 'optimize' : 'new');
    var brief = useState('');
    var keyword = useState('');
    var length = useState('medium');
    var scope = useState('all');
    var busy = useState(false);
    var chars = useState(0);
    var error = useState('');
    var notice = useState('');
    var result = useState(null);
    var abort = useRef(null);

    function run() {
      error[1](''); notice[1](''); result[1](null);
      if (mode[0] === 'new' && !brief[0].trim() && !keyword[0].trim()) return error[1](t.needBrief);
      if (mode[0] === 'optimize' && !hasContent) return error[1](t.needContent);
      busy[1](true); chars[1](0);
      abort.current = new AbortController();
      compose({
        mode: mode[0], type: post.type === 'page' ? 'page' : 'post', brief: brief[0], keyword: keyword[0],
        length: length[0], scope: scope[0], itemId: post.id,
        cur: { name: post.title, excerpt: post.excerpt, body: stripBlocks(post.content) },
      }, chars[1], abort.current.signal)
        .then(function (r) { result[1](r); })
        .catch(function (e) { if (e.name !== 'AbortError') error[1](e.message); })
        .then(function () { busy[1](false); });
    }

    function toBlocks(html) { return wp.blocks.rawHandler({ HTML: html }); }
    function done() { notice[1](t.applied); }

    var f = result[0] && result[0].fields;
    var seoNative = cfg.seoProvider === 'native';

    return h('div', { className: 'content-agent-sidebar', style: { padding: '0 16px 16px' } },
      h(C.PanelBody, { initialOpen: true, title: t.title },
        h(C.RadioControl, {
          selected: mode[0], onChange: mode[1],
          options: [{ label: t.modeNew, value: 'new' }, { label: t.modeOptimize, value: 'optimize' }],
        }),
        h(C.TextareaControl, { label: t.brief, help: t.briefHelp, value: brief[0], onChange: brief[1], rows: 4 }),
        h(C.TextControl, { label: t.keyword, value: keyword[0], onChange: keyword[1] }),
        mode[0] === 'new'
          ? h(C.SelectControl, { label: t.length, value: length[0], onChange: length[1],
              options: [{ label: t.short, value: 'short' }, { label: t.medium, value: 'medium' }, { label: t.long, value: 'long' }] })
          : h(C.SelectControl, { label: t.scope, value: scope[0], onChange: scope[1],
              options: [{ label: t.scopeAll, value: 'all' }, { label: t.scopeSeo, value: 'seo' }, { label: t.scopeContent, value: 'content' }] }),
        busy[0]
          ? h('div', null, h(C.Spinner), ' ', t.working, ' ', chars[0] ? chars[0] + ' ' + t.chars : '', ' ',
              h(C.Button, { variant: 'link', onClick: function () { abort.current && abort.current.abort(); } }, t.stop))
          : h(C.Button, { variant: 'primary', onClick: run }, t.run),
        error[0] && h(C.Notice, { status: 'error', isDismissible: false }, error[0]),
        notice[0] && h(C.Notice, { status: 'success', isDismissible: false }, notice[0])),
      f && h(C.PanelBody, { initialOpen: true, title: t.title + ' ✓' },
        result[0].notes && h('div', { style: { whiteSpace: 'pre-wrap', marginBottom: '12px' } }, h('strong', null, t.notes), '\n', result[0].notes),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } },
          f.name && h(C.Button, { variant: 'secondary', onClick: function () { editor.editPost({ title: f.name }); done(); } }, t.useTitle),
          f.excerpt && h(C.Button, { variant: 'secondary', onClick: function () { editor.editPost({ excerpt: f.excerpt.replace(/<[^>]*>/g, '') }); done(); } }, t.useExcerpt),
          f.body && h(C.Button, { variant: 'primary', onClick: function () { blockEditor.resetBlocks(toBlocks(f.body)); done(); } }, t.replace),
          f.body && h(C.Button, { variant: 'secondary', onClick: function () { blockEditor.insertBlocks(toBlocks(f.body)); done(); } }, t.append)),
        f.body && h('details', null, h('summary', null, 'HTML'), h('div', { className: 'content-agent-preview', style: { maxHeight: '320px', overflow: 'auto', fontSize: '12px' }, dangerouslySetInnerHTML: { __html: f.body } })),
        (f.meta_title || f.meta_description || f.meta_keywords) && h('div', { style: { marginTop: '12px' } },
          h('strong', null, t.seo),
          !seoNative && h('p', { className: 'description' }, t.seoPlugin),
          h(CopyField, { label: t.metaTitle, value: f.meta_title }),
          h(CopyField, { label: t.metaDesc, value: f.meta_description, rows: 3 }),
          h(CopyField, { label: t.metaKeywords, value: f.meta_keywords }),
          seoNative && h(C.Button, {
            variant: 'secondary',
            onClick: function () {
              var meta = {};
              if (f.meta_title) meta[cfg.seoKeys.meta_title] = f.meta_title;
              if (f.meta_description) meta[cfg.seoKeys.meta_description] = f.meta_description;
              if (f.meta_keywords) meta[cfg.seoKeys.meta_keywords] = f.meta_keywords;
              editor.editPost({ meta: meta }); done();
            },
          }, t.applySeo))));
  }

  wp.plugins.registerPlugin('content-agent', {
    icon: 'format-chat',
    render: function () {
      return h(el.Fragment, null,
        MoreMenuItem && h(MoreMenuItem, { target: 'content-agent-sidebar', icon: 'format-chat' }, t.title),
        h(PluginSidebar, { name: 'content-agent-sidebar', title: t.title, icon: 'format-chat' }, h(Sidebar)));
    },
  });
})(window.wp, window.contentAgentEditor);
