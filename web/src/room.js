// ─────────────────────────────────────────────────
//  room.js  ·  controller for the editor room
//
//  Modes:
//    edit    — text editing on text leaves; emptying a list-row's text
//              removes the row (bullet/number marker goes with it)
//    comment — toggle-select one or many elements, then write a note in
//              the sidebar composer. Also supports unanchored comments
//              for whole-document notes.
// ─────────────────────────────────────────────────

// Cache-busting version, propagated from room.html (?v=<build>) to every
// editor module below so a fresh deploy is never served from a stale browser
// cache. Empty string when loaded without a query (falls back to normal cache).
const __V = new URL(import.meta.url).search;

// Load an editor module with the deploy version, falling back to the plain
// (cacheable) URL if the versioned fetch is dropped — so a single failed
// request on a slow / flaky / cross-border network can't leave this top-level
// await pending forever, which would freeze the page on the loading overlay.
// Total failure rejects room.js's module promise, which room.html's loader
// .catch surfaces as a "refresh to retry" hint instead of an endless spinner.
function __loadMod(path) {
  return import(path + __V).catch(() => import(path));
}

const [
  {
    parseHTML, renderForEditor, reassembleHTML, compactSkeleton, sanitizeHTMLForEditor,
    sanitizeHTMLFragmentForEditor, isSafePreviewUrl,
    removeElementFromSkeleton, duplicateElementInSkeleton, moveElementInSkeleton,
    moveIntoContainer,
    duplicateColumnInSkeleton, removeColumnFromSkeleton, describeElement,
    insertColumnInSkeleton, insertRowInSkeleton,
    moveColumnInSkeleton, moveRowInSkeleton,
  },
  { buildIframeScript },
  { buildExportPrompt },
  capacity,
  { saveDraft, loadDraft, deleteDraft },
  { readTextFile },
  { compressImageDataUrl, compressImageFile, isInlineRasterImage, MAX_IMAGE_SOURCE_BYTES },
] = await Promise.all([
  __loadMod('./parser.js'),
  __loadMod('./iframe-injection.js'),
  __loadMod('./export.js'),
  __loadMod('./capacity.js'),
  __loadMod('./draft-store.js'),
  __loadMod('./encoding.js'),
  __loadMod('./image-compression.js'),
]);
const {
  MAX_SOURCE_HTML_BYTES, LARGE_SOURCE_WARNING_BYTES, MAX_DOCUMENT_BYTES, ELEMENT_WARNING_COUNT,
  MAX_INLINE_BINARY_SOURCE_BYTES, MAX_INLINE_IMAGE_BYTES, MAX_INLINE_MEDIA_BYTES,
  MAX_COMMENT_BYTES, MAX_COMMENTS,
  MAX_COMMENTS_TOTAL_BYTES, commentsByteLength,
  inspectDocumentCapacity, inspectAndValidateDocument, inspectAndValidateSource, utf8ByteLength, serializedTextByteLength,
} = capacity;

let imageMutationQueue = Promise.resolve();
function enqueueImageMutation(task) {
  const run = imageMutationQueue.catch(() => {}).then(task);
  imageMutationQueue = run.catch(() => {});
  return run;
}

const USER_COLORS = [
  '#ff5a1f', '#0891b2', '#65a30d', '#c026d3',
  '#dc2626', '#2563eb', '#d97706', '#7c3aed',
];

const DEMO_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Demo</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 24px; line-height: 1.7; color: #1c1917; }
  h1 { font-size: 32px; margin-bottom: 12px; letter-spacing: -0.01em; }
  h2 { font-size: 20px; margin-top: 36px; margin-bottom: 8px; }
  p { margin-bottom: 14px; color: #374151; }
  ul { margin-bottom: 18px; padding-left: 22px; }
  li { margin-bottom: 6px; }
  .tag { display: inline-block; background: #fff1ec; color: #b34100; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
  .card { background: #f5f5f4; padding: 16px 18px; border-radius: 8px; margin: 16px 0; }
</style></head>
<body>
  <div class="tag">DEMO DOCUMENT</div>
  <h1>HTML Editor</h1>
  <p>Beautiful HTML is easy to generate now. Revising it is the hard part. This tool sits in the middle: humans edit and comment, then hand the package back to the AI.</p>

  <h2>Try it</h2>
  <ol>
    <li>Click any text on this page and rewrite it.</li>
    <li>Delete a whole bullet by erasing its text — the marker disappears with it.</li>
    <li>Switch to Comment mode and click any element (text or styled box) to leave a note.</li>
    <li>This 4th item is here so you can try deleting it. Backspace through the text and watch the "4." vanish.</li>
  </ol>

  <div class="card">
    <p>Comments can also be left on a styled box like this one — switch to Comment, click anywhere in this card, then write what should change.</p>
  </div>

  <h2>Export</h2>
  <p>When you're done, hit Export. You can download a clean .html, or copy a prompt bundling your edits + comments for the next AI pass.</p>
</body></html>`;

const STARTER_ROOM_ID = 'starter-guide-v12';

// ─── State ──────────────────────────────────────
const state = {
  roomId: null,
  filename: 'document.html',
  skeleton: null,
  blocks: [],
  comments: {},
  mode: 'edit',
  user: null,
  collab: null,
  collabConnected: false,
  documentBytes: 0,
  keepLocalDraft: false,
  // Handoffs may seed a new room. Recovery drafts are local safety copies and
  // never gain authority to overwrite an existing shared room.
  draftMode: 'none',
  roomHydrated: false,
  primaryRecoveryFrozen: false,
  standaloneRecovery: false,
  // Pending comment composer state
  composer: {
    open: false,
    general: false,     // not anchored to any element
    refs: [],           // [{ id, tag, snippet }] — order = click order
  },
};

// A block id guaranteed unique against the CURRENT document. The old
// `Date.now()+3-random-chars` scheme collided when two blocks were inserted in
// the same millisecond (e.g. two videos), producing duplicate data-block-ids —
// which then broke drag / move / style because querySelector only ever finds
// the first match. `doc` is optional: pass the parsed skeleton being edited so
// the check also sees blocks added earlier in the same transaction.
let __idSeq = 0;
function freshBlockId(prefix, doc) {
  for (let tries = 0; tries < 50; tries++) {
    const id = (prefix || 'b') + Date.now().toString(36)
      + Math.random().toString(36).slice(2, 8) + (__idSeq++).toString(36);
    const inState = state.blocks.some(b => b.id === id);
    const inSkeleton = state.skeleton && state.skeleton.indexOf('data-block-id="' + id + '"') >= 0;
    const inDoc = doc && doc.querySelector && doc.querySelector(`[data-block-id="${id}"]`);
    if (!inState && !inSkeleton && !inDoc) return id;
  }
  return (prefix || 'b') + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}


// ─── Recent files (shared with index.html via localStorage) ──
const RECENT_KEY = 'hce-recent-files';
const RECENT_MAX = 12;
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {}
}
function touchRecent(roomId, filename) {
  if (!roomId) return;
  const now = Date.now();
  const list = loadRecent();
  const ix = list.findIndex(x => x.roomId === roomId);
  if (ix >= 0) {
    list[ix].lastOpenedAt = now;
    if (filename) list[ix].filename = filename;
    list.unshift(list.splice(ix, 1)[0]);
  } else {
    list.unshift({ roomId, filename: filename || 'document.html', createdAt: now, lastOpenedAt: now });
  }
  saveRecent(list);
}

// ─── i18n (shares the hce-lang choice with the landing page) ───────────
const I18N = {
  upload:{en:'↑ Upload',zh:'↑ 上传'}, upload_t:{en:'Upload a new file to replace the current document',zh:'上传新文件替换当前文档'},
  view:{en:'View',zh:'阅读'}, edit:{en:'Edit',zh:'编辑'}, drag:{en:'Move',zh:'拖拽'}, comment:{en:'Comment',zh:'批注'},
  share:{en:'Share',zh:'分享'}, share_head:{en:'Anyone with this link can view and edit',zh:'拿到链接的人都能查看和编辑'},
  copy:{en:'Copy',zh:'复制'}, copied:{en:'Copied',zh:'已复制'}, export:{en:'Export ▾',zh:'导出 ▾'},
  add_t:{en:'Insert content',zh:'插入内容'},
  ins_image:{en:'Image',zh:'图片'}, ins_video:{en:'Video',zh:'视频'}, ins_audio:{en:'Audio',zh:'音频'}, ins_shape:{en:'Shape',zh:'图形'}, ins_link:{en:'Link',zh:'链接'},
  t_shape_added:{en:'Shape added',zh:'已插入图形'}, t_audio_added:{en:'Audio added',zh:'已插入音频'}, t_link_added:{en:'Link added',zh:'已插入链接'},
  exp_dl:{en:'Download HTML',zh:'下载 HTML'}, exp_dl_sub:{en:'Clean .html file — no comments. For sharing or final use.',zh:'干净的 .html 文件，不含批注。用于分享或定稿。'},
  exp_ai:{en:'Hand off to AI',zh:'交给 AI'}, exp_ai_sub:{en:'HTML + comments as a Markdown prompt — copy or download .md.',zh:'把 HTML + 批注导成 Markdown 提示词，可复制或下载 .md。'},
  loading:{en:'Loading document…',zh:'正在载入文档…'}, loading_sub:{en:'This can take a few seconds for large files.',zh:'文件较大时可能需要几秒。'},
  comments:{en:'Comments',zh:'批注'}, general_t:{en:'Add a comment without anchoring to an element',zh:'添加一条不绑定具体元素的批注'},
  cmt_ph:{en:'Write your comment…',zh:'写下你的批注…'}, save_hint:{en:'⌘ / Ctrl + ↵ to save',zh:'⌘ / Ctrl + ↵ 保存'},
  cancel:{en:'Cancel',zh:'取消'}, save:{en:'Save',zh:'保存'}, close:{en:'Close',zh:'关闭'}, dl_md:{en:'↓ Download .md',zh:'↓ 下载 .md'},
  cmt_empty:{en:'Click any element in the document to leave a comment, or use <b>+ General</b> for a note that isn\'t tied to one spot.',zh:'点击文档中任意元素留下批注，或用 <b>+ 通用</b> 添加不绑定具体位置的备注。'},
  solo:{en:'Solo',zh:'单人'}, live:{en:'Live',zh:'协作中'}, saved:{en:'Saved',zh:'已保存'}, saving:{en:'Saving…',zh:'保存中…'}, local_only:{en:'Local only',zh:'仅本地'},
  user_unit_one:{en:' user',zh:' 位用户'}, user_unit:{en:' users',zh:' 位用户'}, you_hint:{en:' (you — click to change)',zh:'（你——点击修改）'},
  nick_title:{en:'Editing together',zh:'一起编辑'}, nick_h:{en:'Pick a nickname',zh:'取个昵称'}, nick_sub:{en:'So others know who edited and commented. No account needed.',zh:'让协作者知道是谁在编辑和批注。无需注册账号。'},
  nick_name:{en:'Name',zh:'昵称'}, nick_name_ph:{en:'Your name',zh:'你的名字'}, nick_color:{en:'Color',zh:'颜色'},
  exp_modal_hint:{en:'Paste into a chat for the next revision pass, or download as a Markdown file to attach in Claude Projects, NotebookLM, email, etc.',zh:'粘贴到对话里进行下一轮修订，或下载为 Markdown 文件，附到 Claude Projects、NotebookLM、邮件等处。'},
  t_bad_file:{en:'Please drop an .html or .htm file',zh:'请拖入 .html 或 .htm 文件'}, t_too_big:{en:'HTML file too large (max 10 MB)',zh:'HTML 文件过大（上限 10 MB）'},
  t_doc_too_big:{en:'Document exceeds the 12 MB collaboration limit',zh:'文档超过 12 MB 协作容量上限'},
  t_media_too_big:{en:'Inline media exceeds the 5 MB total limit',zh:'内联媒体超过 5 MB 累计上限'},
  t_image_too_big:{en:'Image remains over 2 MB after processing',zh:'图片处理后仍超过 2 MB'},
  t_image_compressed:{en:'Image compressed automatically',zh:'图片已自动压缩'},
  t_image_no_room:{en:'The document has no room for another image. Use a hosted image link instead.',zh:'当前文档已没有足够图片容量，请改用网络图片链接'},
  t_image_compress_failed:{en:'This image could not be compressed enough. Try a hosted image link.',zh:'图片自动压缩后仍然过大，请尝试使用网络图片链接'},
  t_image_source_too_large:{en:'This photo is over 64 MB. Resize it first or use a hosted image link.',zh:'这张照片超过 64 MB，请先缩小图片或使用网络图片链接'},
  t_image_animation_link:{en:'This animated image is too large to preserve its animation. Use a hosted link instead.',zh:'动图过大且压缩会丢失动画，请改用网络链接'},
  t_too_many_elements:{en:'Document has too many elements (max 50,000)',zh:'文档元素过多（上限 50,000 个）'},
  t_large_confirm:{en:'This large file may be slower on mobile devices. Continue?',zh:'这个大文件在移动设备上可能较慢，仍要继续吗？'},
  t_comment_too_big:{en:'Comment limit reached (500 comments, 16 KiB each)',zh:'批注已达到上限（500 条，每条 16 KiB）'},
  t_remote_too_big:{en:'A collaborator sent data beyond this room’s capacity. Reconnect after reducing the document.',zh:'协作者发送的数据超过房间容量，请缩减文档后重新连接。'},
  t_replaced:{en:'Replaced with ',zh:'已替换为 '}, t_cmt_saved:{en:'Comment saved',zh:'批注已保存'}, t_cmt_updated:{en:'Comment updated',zh:'批注已更新'},
  t_col_removed:{en:'Column removed',zh:'已删除该列'}, t_col_dup:{en:'Column duplicated',zh:'已复制该列'}, t_col_added:{en:'Column added',zh:'已添加列'}, t_row_added:{en:'Row added',zh:'已添加行'}, t_dup:{en:'Duplicated',zh:'已复制'}, t_removed:{en:'Removed',zh:'已删除'}, t_downloaded:{en:'Downloaded ',zh:'已下载 '}, t_moved:{en:'Moved',zh:'已移动'}, t_beside:{en:'Placed side by side',zh:'已并排放置'}, t_img_added:{en:'Image frame added',zh:'已插入图片框'}, t_video_added:{en:'Video frame added',zh:'已插入视频框'},
  t_table_added:{en:'Table added',zh:'已插入表格'}, tbl_col:{en:'Column',zh:'列'},
  t_merged_table:{en:'This operation is unavailable for merged-cell tables',zh:'合并单元格表格暂不支持此操作'},
  t_row_groups:{en:'Row reordering is unavailable when a table has separate header/body sections',zh:'包含独立表头和表体区域的表格暂不支持行重排'},
  t_last_row:{en:'A table must keep at least one row',zh:'表格至少需要保留一行'},
  t_last_col:{en:'A table must keep at least one column',zh:'表格至少需要保留一列'},
  t_dup_id_dependency:{en:'This block uses ID-based CSS or scripts and cannot be duplicated safely',zh:'该模块依赖 ID 选择器或脚本，无法安全复制'},
  t_dynamic_download:{en:'This page contains active content that is disabled in the editor for safety. The downloaded page may look or behave differently when it runs. Download anyway?',zh:'此页面包含在编辑器中因安全原因被停用的动态内容。下载后运行时，页面外观或行为可能不同。仍要下载吗？'},
  t_dynamic_ai:{en:'This page contains active content that is disabled in the editor for safety. The HTML handed to AI may include behavior that is not visible in the preview. Continue?',zh:'此页面包含在编辑器中因安全原因被停用的动态内容。交给 AI 的 HTML 可能包含预览中不可见的行为。仍要继续吗？'},
  t_export_sync_failed:{en:'Could not capture the latest edits. Please try exporting again.',zh:'未能获取最新编辑状态，请重新导出。'},
  tb_move:{en:'Drag to reorder',zh:'拖动重排'},
  lang_label:{en:'EN',zh:'CN'},
  slide_prev:{en:'Previous slide (←)',zh:'上一页（←）'}, slide_next:{en:'Next slide (→)',zh:'下一页（→）'},
};
let hceLang = localStorage.getItem('hce-lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
function t(key) { const e = I18N[key]; if (!e) return key; return e[hceLang] != null ? e[hceLang] : (e.en || key); }
function applyStaticI18n() {
  document.documentElement.lang = hceLang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (I18N[k]) el.innerHTML = t(k); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.getAttribute('data-i18n-ph'); if (I18N[k]) el.placeholder = t(k); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const k = el.getAttribute('data-i18n-title'); if (I18N[k]) el.title = t(k); });
}

// Replace the browser's slow native title bubble with one consistent tooltip.
// Event delegation also covers comment buttons created after initial render.
function installFastTooltips() {
  if (document.getElementById('hce-fast-tooltip')) return;
  const tip = document.createElement('div');
  tip.id = 'hce-fast-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  const selector = '[title], [data-hce-tooltip]';
  let active = null;
  let timer = null;

  function targetFrom(node) {
    return node?.closest?.(selector) || null;
  }

  function labelFor(el) {
    const nativeTitle = el.getAttribute('title');
    if (nativeTitle != null) {
      const label = nativeTitle.trim();
      if (label) {
        el.setAttribute('data-hce-tooltip', label);
        if (el.matches('button, label, [role="button"], [role="menuitem"]')) {
          el.setAttribute('aria-label', label);
        }
      }
      el.removeAttribute('title');
    }
    return (el.getAttribute('data-hce-tooltip') || '').trim();
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    active = null;
    tip.style.display = 'none';
  }

  function show(el, label) {
    if (active !== el || !document.contains(el)) return;
    tip.textContent = label;
    tip.style.display = 'block';
    const anchor = el.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const gap = 8;
    let top = anchor.bottom + gap;
    if (top + box.height > window.innerHeight - gap) top = anchor.top - box.height - gap;
    let left = anchor.left + (anchor.width - box.width) / 2;
    left = Math.max(gap, Math.min(window.innerWidth - box.width - gap, left));
    tip.style.top = Math.max(gap, top) + 'px';
    tip.style.left = left + 'px';
  }

  function schedule(el, immediate) {
    const label = labelFor(el);
    if (!label) return;
    clearTimeout(timer);
    tip.style.display = 'none';
    active = el;
    timer = setTimeout(() => show(el, label), immediate ? 0 : 80);
  }

  document.addEventListener('pointerover', e => {
    const el = targetFrom(e.target);
    if (el && el !== active) schedule(el, false);
  }, true);
  document.addEventListener('pointerout', e => {
    if (!active) return;
    if (e.relatedTarget && active.contains(e.relatedTarget)) return;
    if (targetFrom(e.target) === active) hide();
  }, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', e => {
    const el = targetFrom(e.target);
    if (el?.matches?.(':focus-visible')) schedule(el, true);
  });
  document.addEventListener('focusout', e => {
    if (active && e.target === active) hide();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

let lastUsers = null;
function applyUsers(users) {
  lastUsers = users;
  renderUsers(users);
  const n = users.length || 1;
  const uc = document.getElementById('user-count');
  if (uc) uc.textContent = n + t(n === 1 ? 'user_unit_one' : 'user_unit');
  const sl = document.getElementById('sync-label');
  if (sl) sl.textContent = n > 1 ? t('live') : t('solo');
}
function setLang(lang) {
  hceLang = (lang === 'zh') ? 'zh' : 'en';
  try { localStorage.setItem('hce-lang', hceLang); } catch (e) {}
  applyStaticI18n();
  if (lastUsers) applyUsers(lastUsers);
  markSaved();
  renderComments();
  sendToIframe({ cmd: 'set-lang', lang: hceLang });   // translate the in-iframe panel
}

// ─── Init ───────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  state.roomId = params.get('room') || 'local-' + Math.random().toString(36).slice(2, 8);
  state.standaloneRecovery = state.roomId.includes('--recovered-');

  installFastTooltips();

  // Apply the saved language (chosen on the homepage) to the static chrome.
  applyStaticI18n();

  // Slide-deck pager buttons (work even while editing text — unlike the keys).
  document.getElementById('slide-prev')?.addEventListener('click', () => sendToIframe({ cmd: 'nav-slide', dir: 'left' }));
  document.getElementById('slide-next')?.addEventListener('click', () => sendToIframe({ cmd: 'nav-slide', dir: 'right' }));

  // Identity
  state.user = loadUser() || await promptForNickname({ allowCancel: false });
  saveUser(state.user);
  document.getElementById('nick-modal-bg').classList.remove('show');
  applyUsers([state.user]);

  // Initial HTML
  // Load the upload from IndexedDB. Keep it until collaboration confirms the
  // room state, so a refresh during a failed/slow connection cannot lose it.
  // loadDraft also reads the old sessionStorage handoff for compatibility.
  let initialDraft = await loadDraft(state.roomId);
  if (initialDraft?.html && inspectAndValidateSource(initialDraft.html).issue) {
    await deleteDraft(state.roomId).catch(() => {});
    initialDraft = null;
    toast(t('t_doc_too_big'));
  }
  if (initialDraft && (Object.keys(initialDraft.comments || {}).length > MAX_COMMENTS ||
      commentsByteLength(initialDraft.comments) > MAX_COMMENTS_TOTAL_BYTES)) {
    await deleteDraft(state.roomId).catch(() => {});
    initialDraft = null;
    toast(t('t_comment_too_big'));
  }
  state.draftMode = initialDraft?.kind === 'handoff' ? 'handoff'
    : initialDraft?.kind === 'recovery' ? 'recovery' : 'none';
  // Recovery is frozen until the server state is known. This prevents the
  // initial hydration callbacks from overwriting the only offline copy.
  state.keepLocalDraft = state.draftMode === 'handoff';
  let initialHTML = typeof initialDraft?.html === 'string' ? initialDraft.html : null;
  state.filename = initialDraft?.filename || 'demo.html';
  if (initialHTML == null && state.roomId === STARTER_ROOM_ID) {
    try {
      const resp = await fetch('./assets/starter-guide.html', { cache: 'no-store' });
      if (resp.ok) {
        initialHTML = await resp.text();
        state.filename = (hceLang === 'zh') ? '新手上手说明书.html' : 'Starter Guide.html';
      }
    } catch (e) {}
  }
  if (initialHTML == null) initialHTML = DEMO_HTML;
  // Only a locally-created room (or the built-in starter) may initialize an
  // empty collaborative document. Following an unknown share URL must never
  // publish the demo merely because the local draft is unavailable.
  state.canSeedCollab = initialDraft?.kind === 'handoff' || !params.has('room') ||
    state.roomId === STARTER_ROOM_ID || params.get('collab') === 'off';
  document.getElementById('fname').textContent = state.filename;

  // Bump this room to the top of the user's "recent files" list.
  touchRecent(state.roomId, state.filename);

  const savedEditorState = initialDraft?.editorState;
  if (savedEditorState?.skeleton && Array.isArray(savedEditorState.blocks)) {
    state.skeleton = savedEditorState.skeleton;
    state.blocks = savedEditorState.blocks;
  } else {
    const parsed = parseHTML(initialHTML);
    state.skeleton = parsed.skeleton;
    state.blocks = parsed.blocks;
  }
  const parsedCapacity = inspectAndValidateDocument(reassembleHTML(state.skeleton, state.blocks));
  if (!reportCapacityIssue(parsedCapacity)) {
    if (initialDraft) await deleteDraft(state.roomId).catch(() => {});
    state.skeleton = null;
    state.blocks = [];
    showRoomLoadError();
    return;
  }
  state.documentBytes = parsedCapacity.totalBytes;
  if (initialDraft?.comments) state.comments = initialDraft.comments;

  // Is this an interactive slide deck? If so we enable keyboard ←/→ flipping
  // and show on-screen pager buttons. Detect known frameworks, or any page
  // whose own scripts react to the Arrow keys (a strong "keyboard-navigable
  // deck" signal), or a run of full-page <section>s.
  setSlidesMode(detectSlides(initialHTML));

  // If we have the file locally (uploader's tab), render immediately.
  // Otherwise (joined a shared room link) DEFER the initial render until
  // collab connects — that way late joiners see the actual document, not
  // a flash of DEMO content before it's replaced.
  // A recovery draft must not be editable while the server is still loading:
  // successful hydration replaces state, so edits made in that window would
  // otherwise vanish. Handoffs are safe because they are the source to seed.
  const collaborationDisabled = params.get('collab') === 'off';
  const hasLocalFile = (collaborationDisabled && initialDraft?.kind === 'handoff') ||
    (state.standaloneRecovery && initialDraft?.kind === 'recovery');
  // Explicit local mode and recovered copies are editable immediately and use
  // local history. Online handoffs wait for sync so pre-connection edits cannot
  // become history entries that the later Yjs manager does not own.
  if (hasLocalFile) {
    state.collab = createLocalHistory();
    wireUndoToCollab();
  }
  let initialRendered = false;
  function doInitialRender() {
    if (initialRendered) return;
    initialRendered = true;
    renderIframe();
    renderComments();
  }
  if (hasLocalFile) doInitialRender();

  // Local uploads can always render immediately/offline. Share-link visitors
  // must wait for the real room; showing the demo would falsely look like the
  // shared document and could invite edits to the wrong content.
  const renderWatchdog = null;

  window.addEventListener('message', handleIframeMessage);
  // Try collab (best-effort). Bounded by a timeout so a blocked CDN
  // (esm.sh) or firewalled WebSocket can't leave this await pending forever
  // and stall the rest of init — we fall through to single-user editing.
  if (params.get('collab') !== 'off' && !state.standaloneRecovery) {
    let localFallbackHistory = state.collab;
    try {
      let importTimer;
      const importTimeout = new Promise((_, reject) => {
        importTimer = setTimeout(() => reject(new Error('collab module load timed out')), 8000);
      });
      const { connectCollab } = await Promise.race([__loadMod('./collab.js'), importTimeout]);
      clearTimeout(importTimer);
      state.collab = await connectCollab(state, {
        validateState: () => {
          const content = inspectAndValidateDocument(reassembleHTML(state.skeleton, state.blocks));
          if (!reportCapacityIssue(content)) return false;
          if (Object.keys(state.comments).length > MAX_COMMENTS ||
              commentsByteLength(state.comments) > MAX_COMMENTS_TOTAL_BYTES) {
            toast(t('t_comment_too_big'));
            return false;
          }
          state.documentBytes = content.totalBytes;
          return true;
        },
        validateRemoteTextChanges: (changes) => {
          let nextBytes = state.documentBytes;
          changes.forEach(({ id, text }) => {
            const current = state.blocks.find(block => block.id === id);
            if (current) nextBytes += serializedTextByteLength(text) - serializedTextByteLength(current.text);
          });
          if (nextBytes > MAX_DOCUMENT_BYTES) { toast(t('t_remote_too_big')); return false; }
          return true;
        },
        validateRemoteStructure: (skeleton, blocks) => {
          const result = inspectAndValidateDocument(reassembleHTML(skeleton, blocks));
          if (result.issue) { toast(t('t_remote_too_big')); return false; }
          return true;
        },
        validateRemoteComments: (comments) => {
          const valid = Object.keys(comments).length <= MAX_COMMENTS &&
            commentsByteLength(comments) <= MAX_COMMENTS_TOTAL_BYTES &&
            Object.values(comments).every(isValidComment);
          if (!valid) toast(t('t_remote_too_big'));
          return valid;
        },
        onCapacityExceeded: () => { state.collab = null; markSaved(); },
        onBlockTextChange: (id, text) => {
          stateRevision++;
          // While the iframe is being rebuilt due to a structural change,
          // its DOM is mid-flight — update state but defer the iframe message.
          // Text no longer lives in the compact skeleton, so dropping the state
          // update here would lose a concurrent collaborator edit.
          const b = state.blocks.find(x => x.id === id);
          if (!b) return;
          if (b.text !== text) {
            const nextBytes = state.documentBytes + serializedTextByteLength(text) - serializedTextByteLength(b.text);
            state.documentBytes = nextBytes;
            b.text = text;
            if (!rebuildingIframe) sendToIframe({ cmd: 'set-block-text', id, text });
          }
          markSaved();
        },
        onCommentsChange: () => {
          stateRevision++;
          renderComments();
          scheduleLocalDraftSave();
          markSaved();
        },
        onStylesChange: (styles) => {
          stateRevision++;
          if (!applyRemoteStyles(styles)) return false;
          scheduleLocalDraftSave();
          markSaved();
          return true;
        },
        onUsersChange: (users) => { applyUsers(users); },
        onConnectionStatus: (status) => {
          state.collabConnected = status === 'connected';
          // A pre-sync connecting/disconnected event is not a real document;
          // never turn the DEMO placeholder behind an unknown share URL into
          // a recovery draft. Only a previously hydrated room may autosave.
          if (status === 'disconnected' && state.roomHydrated && !state.primaryRecoveryFrozen) {
            state.draftMode = 'recovery';
            state.keepLocalDraft = true;
            scheduleLocalDraftSave();
          }
          markSaved();
        },
        onSkeletonChanged: () => {
          stateRevision++;
          const remoteCapacity = inspectAndValidateDocument(reassembleHTML(state.skeleton, state.blocks));
          if (remoteCapacity.issue) {
            state.collab?.disconnect?.();
            state.collab = null;
            toast(t('t_remote_too_big'));
            return;
          }
          state.documentBytes = remoteCapacity.totalBytes;
          refreshSlidesFromContent();   // late joiners: detect from synced doc
          if (!initialRendered) {
            // Late joiner first render — go straight to full render so the
            // user sees the actual room contents, not a flash of DEMO.
            initialRendered = true;
            renderIframe();
            renderComments();
            markSaved();
            return;
          }
          // Subsequent skeleton changes: try surgical patch first.
          const patched = applyStructuralPatch();
          if (!patched) renderIframe();
          renderComments();
          markSaved();
        },
        onFilenameChanged: (filename) => {
          state.filename = filename;
          document.getElementById('fname').textContent = filename;
          touchRecent(state.roomId, filename);
        },
      });
      wireUndoToCollab();
      state.collabConnected = state.collab.isConnected?.() !== false;
      state.roomHydrated = true;
      markSaved();
      if (initialDraft && !state.collab.seeded) {
        // Existing server state won. Retire a consumed upload handoff. Keep a
        // recovery copy because it can contain offline work requiring manual
        // reconciliation; it is never auto-applied by collab.js.
        if (initialDraft.kind === 'handoff') retireLocalDraft();
        else if (initialDraft.kind === 'recovery') {
          const serverHTML = reassembleHTML(state.skeleton, state.blocks);
          const recoveryDiffers = initialDraft.html !== serverHTML ||
            initialDraft.filename !== state.filename ||
            JSON.stringify(initialDraft.comments || {}) !== JSON.stringify(state.comments || {});
          let preserved = !recoveryDiffers;
          try {
            if (recoveryDiffers) await preserveRecoveryCopy(initialDraft);
            preserved = true;
          } catch (copyError) {
            // Keep the original key frozen. Deleting it after a failed copy
            // would permanently lose offline-only comments/filename/content.
            console.warn('[hce] could not preserve recovery copy:', copyError.message);
            state.keepLocalDraft = false;
            state.primaryRecoveryFrozen = true;
            clearTimeout(localDraftTimer);
            localDraftEpoch++;
          }
          if (preserved) retireLocalDraft();
        }
      } else if (initialDraft) {
        // Keep the source draft through the initial seed. A later successful
        // revisit adopts the server copy and removes this fallback.
        // Seeding consumes the one-time handoff authority. Every later local
        // save is a recovery copy and can never initialize a room.
        state.draftMode = 'recovery';
        state.keepLocalDraft = true;
      }
      console.log('[hce] collab connected');
    } catch (err) {
      console.warn('[hce] collab disabled (single-user mode):', err.message);
      if (state.canSeedCollab || initialDraft?.kind === 'recovery') {
        // Keep the current in-memory document: it may include edits made while
        // the connection attempt was pending.
        if (!state.collab || state.collabConnected) state.collab = localFallbackHistory || createLocalHistory();
        if (!initialRendered) doInitialRender();
        renderComments();
        state.draftMode = initialDraft?.kind === 'handoff' ? 'handoff' : 'recovery';
        state.keepLocalDraft = true;
        scheduleLocalDraftSave();
      } else {
        showRoomLoadError();
      }
    }
  }
  if (!state.collab && initialDraft) state.keepLocalDraft = true;
  if (!state.collab && (state.canSeedCollab || state.standaloneRecovery)) {
    if (state.draftMode === 'none') state.draftMode = 'recovery';
    state.keepLocalDraft = true;
    state.collab = createLocalHistory();
    state.collabConnected = false;
    wireUndoToCollab();
  }

  // Safety net — if collab failed (no server) or the room was empty, we
  // never rendered. Fall back to whatever we parsed locally (DEMO or file).
  if (renderWatchdog) clearTimeout(renderWatchdog);
  if (state.canSeedCollab || initialRendered) doInitialRender();

  // Keyboard: ⌘Z / ⌘⇧Z
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.key.toLowerCase() !== 'z') return;
    // Don't hijack if user is typing inside our composer/inputs
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) performRedo(); else performUndo();
  });

  // Slide decks: ←/→ flips pages. This fires when the top page has focus
  // (clicked a toolbar/sidebar); when the canvas iframe has focus, the
  // injected script handles it there instead.
  window.addEventListener('keydown', (e) => {
    if (!state.isSlides) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    e.preventDefault();
    sendToIframe({ cmd: 'nav-slide', dir: e.key === 'ArrowRight' ? 'right' : 'left' });
  });

  // Outside click closes export / share menus
  document.addEventListener('click', (e) => {
    [
      ['export-menu', '#export-btn'],
      ['share-menu',  '#share-btn'],
    ].forEach(([menuId, btnSel]) => {
      const menu = document.getElementById(menuId);
      if (!menu || !menu.classList.contains('show')) return;
      if (e.target.closest('#' + menuId) || e.target.closest(btnSel)) return;
      menu.classList.remove('show');
    });
  });

  // Re-upload (replaces current document)
  const reupload = document.getElementById('reupload-input');
  reupload.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) replaceDocument(f);
    reupload.value = '';   // allow re-uploading the same file
  });

}

async function replaceDocument(file) {
  if (!/\.html?$/i.test(file.name)) { toast(t('t_bad_file')); return; }
  if (file.size > MAX_SOURCE_HTML_BYTES) { toast(t('t_too_big')); return; }
  if (file.size > LARGE_SOURCE_WARNING_BYTES && !confirm(t('t_large_confirm'))) return;
  let decoded;
  try { decoded = await readTextFile(file, 'html'); }
  catch { toast(t('t_bad_file')); return; }
  {
    const sourceText = decoded.text;
    const capacityResult = inspectAndValidateSource(sourceText);
    if (!reportCapacityIssue(capacityResult)) return;
    if (capacityResult.elementCount > ELEMENT_WARNING_COUNT) {
      console.warn('[hce] large DOM:', capacityResult.elementCount, 'elements');
    }
    const parsed = parseHTML(sourceText);
    const parsedCapacity = inspectAndValidateDocument(reassembleHTML(parsed.skeleton, parsed.blocks));
    if (!reportCapacityIssue(parsedCapacity)) return;
    state.skeleton = parsed.skeleton;
    state.blocks = parsed.blocks;
    state.documentBytes = parsedCapacity.totalBytes;
    setSlidesMode(detectSlides(sourceText));   // re-detect for the new doc
    state.filename = file.name;
    state.collab?.updateFilename?.(file.name);
    document.getElementById('fname').textContent = file.name;
    touchRecent(state.roomId, file.name);
    // Clear comments since they were anchored to the previous doc.
    Object.keys(state.comments).forEach(cid => {
      state.collab?.onLocalCommentDelete?.(cid);
      delete state.comments[cid];
    });
    closeComposer();
    // A replacement is a new document identity. Old style snapshots point at
    // unrelated block ids and must not consume the first undo in the new file.
    undoStack.length = 0;
    redoStack.length = 0;
    showCanvasLoading();    // re-upload: show the spinner until the new doc renders
    renderIframe();
    renderComments();
    state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
    markSaving();
    toast(t('t_replaced') + file.name);
  }
}

// ─── User identity ──────────────────────────────
function detectSlides(html) {
  if (!html) return false;
  // Known deck frameworks.
  if (/\b(reveal\.js|Reveal\.initialize|impress\.js|impress\(\)|id\s*=\s*["']impress["']|remark\.create|deck\.js|fullpage|swiper|webslides)\b/i.test(html)) return true;
  // class="reveal" / "slide" / "slides" — the common hand-made-deck markers.
  if (/class\s*=\s*["'][^"']*\b(reveal|slides?)\b/i.test(html)) return true;
  // Any page that wires its own Arrow-key navigation = keyboard-driven deck.
  if (/Arrow(Left|Right)|keyCode\s*(===?|==)\s*3[79]\b|which\s*(===?|==)\s*3[79]\b|\.key\s*(===?|==)\s*["']Arrow/i.test(html)) return true;
  // NOTE: deliberately NOT treating "3+ <section>s" as a deck — semantic
  // landing pages use <section> normally, and that heuristic mis-flagged
  // them (showing a pager + forcing section{min-height:100vh}).
  return false;
}

// Turn slide mode on/off: body class, the pager buttons' enabled state, and
// tell the injected script. Kept idempotent so it's safe to call repeatedly.
function setSlidesMode(on) {
  state.isSlides = !!on;
  document.body.classList.toggle('is-slides', state.isSlides);
  const prev = document.getElementById('slide-prev');
  const next = document.getElementById('slide-next');
  if (prev) prev.disabled = !state.isSlides;
  if (next) next.disabled = !state.isSlides;
  sendToIframe({ cmd: 'set-slides', on: state.isSlides });
}

// One-way: enable slide mode once the (possibly collab-synced) content looks
// like a deck. Used for people who JOIN a shared link — they have no local
// file, so the deck only shows up after collab delivers the document.
function refreshSlidesFromContent() {
  if (state.isSlides) return;
  if (detectSlides(state.skeleton)) setSlidesMode(true);
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem('hce-user') || ''); } catch { return null; }
}
function saveUser(u) { localStorage.setItem('hce-user', JSON.stringify(u)); }

function promptForNickname({ allowCancel = true, initial = null } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('nick-modal-bg');
    const nameInput = document.getElementById('nick-name');
    const colorsEl = document.getElementById('nick-colors');
    const submit = document.getElementById('nick-submit');
    const cancel = document.getElementById('nick-cancel');

    let selectedColor = initial?.color || USER_COLORS[0];
    nameInput.value = initial?.name || '';

    colorsEl.innerHTML = '';
    USER_COLORS.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'color-chip' + (c === selectedColor ? ' selected' : '');
      chip.style.background = c;
      chip.onclick = () => {
        selectedColor = c;
        colorsEl.querySelectorAll('.color-chip').forEach(el => el.classList.remove('selected'));
        chip.classList.add('selected');
      };
      colorsEl.appendChild(chip);
    });

    cancel.style.display = allowCancel ? 'inline-flex' : 'none';
    modal.classList.add('show');
    setTimeout(() => nameInput.focus(), 50);

    function finish() {
      const name = nameInput.value.trim() || 'Anon';
      modal.classList.remove('show');
      resolve({
        id: initial?.id || ('u' + Math.random().toString(36).slice(2, 10)),
        name,
        color: selectedColor,
      });
    }
    function dismiss() {
      modal.classList.remove('show');
      resolve(initial);   // keep existing
    }
    submit.onclick = finish;
    cancel.onclick = dismiss;
    nameInput.onkeydown = e => {
      if (e.key === 'Enter') finish();
      if (e.key === 'Escape' && allowCancel) dismiss();
    };
  });
}

function renderUsers(users) {
  const el = document.getElementById('users');
  el.innerHTML = '';
  (users || []).slice(0, 6).forEach(u => {
    const av = document.createElement('div');
    av.className = 'avatar' + (u.id === state.user.id ? ' me' : '');
    av.style.background = safeUserColor(u.color);
    av.style.color = '#fff';
    const safeName = typeof u.name === 'string' ? u.name.slice(0, 160) : '?';
    av.textContent = safeName.slice(0, 2);
    av.title = safeName + (u.id === state.user.id ? t('you_hint') : '');
    if (u.id === state.user.id) av.onclick = openIdentityEdit;
    el.appendChild(av);
  });
}

async function openIdentityEdit() {
  const next = await promptForNickname({ allowCancel: true, initial: state.user });
  if (!next || (next.name === state.user.name && next.color === state.user.color)) return;
  state.user = next;
  saveUser(next);
  state.collab?.updateUser?.(next);
  // Local re-render; if collab is on, awareness change will refresh remote.
  renderUsers([state.user, ...currentOtherUsers()]);
}

function currentOtherUsers() {
  // best-effort fallback when no collab
  return [];
}

// ─── Iframe ─────────────────────────────────────
let pendingScroll = null;
let rebuildingIframe = false;     // guard: suppress block-text echoes during full rebuild

// Upload/import loading overlay over the canvas. Visible by default in the
// markup (so it shows instantly, even while a big file is parsing); we fade it
// out once the document iframe reports 'ready'.
function hideCanvasLoading() {
  document.getElementById('canvas-loading')?.classList.add('hide');
}
function showCanvasLoading() {
  document.getElementById('canvas-loading')?.classList.remove('hide');
}
function showRoomLoadError() {
  const loading = document.getElementById('canvas-loading');
  if (!loading) return;
  loading.classList.remove('hide');
  const spinner = loading.querySelector('.cl-spin');
  if (spinner) spinner.style.display = 'none';
  const title = loading.querySelector('.cl-text');
  const detail = loading.querySelector('.cl-sub');
  if (title) title.textContent = hceLang === 'zh' ? '无法载入协作文档' : 'Could not load the shared document';
  if (detail) detail.textContent = hceLang === 'zh' ? '请检查网络或分享链接后重试。' : 'Check the connection or share link, then try again.';
}

function reportCapacityIssue(result) {
  if (!result?.issue) return true;
  const key = result.issue === 'document' ? 't_doc_too_big'
    : result.issue === 'media' ? 't_media_too_big'
    : result.issue === 'image' ? 't_image_too_big'
    : 't_too_many_elements';
  toast(t(key));
  return false;
}

function validateCandidateDocument(skeleton, blocks = state.blocks) {
  const result = inspectAndValidateDocument(reassembleHTML(skeleton, blocks));
  if (!reportCapacityIssue(result)) return false;
  state.documentBytes = result.totalBytes;
  return true;
}

function refreshDocumentCapacity() {
  state.documentBytes = inspectAndValidateDocument(reassembleHTML(state.skeleton, state.blocks)).totalBytes;
}

function refreshCapacityAndLocalDraft() {
  refreshDocumentCapacity();
  scheduleLocalDraftSave();
}

function renderIframe() {
  // Never render a blank/"undefined" document. A falsy skeleton means an undo
  // wiped it (or state isn't ready) — keep the current iframe untouched. Still
  // clear the loading overlay so we never leave the user staring at a spinner.
  if (!state.skeleton) { hideCanvasLoading(); return; }
  rebuildingIframe = true;
  const iframe = document.getElementById('iframe');
  // Capture scroll so we can restore it once the new doc loads.
  try {
    if (iframe.contentWindow) {
      pendingScroll = {
        x: iframe.contentWindow.scrollX || 0,
        y: iframe.contentWindow.scrollY || 0,
      };
    }
  } catch {}

  // Hide the iframe during the reload so the user doesn't see the
  // "scroll-jump-to-top-then-back" flicker. The 'ready' handler shows it
  // again after the scroll is restored.
  iframe.style.visibility = 'hidden';

  const html = renderForEditor(state.skeleton, state.blocks);
  const injection = buildIframeScript({
    maxInlineBinarySourceBytes: MAX_INLINE_BINARY_SOURCE_BYTES,
    maxImageSourceBytes: MAX_IMAGE_SOURCE_BYTES,
  });
  const lowerHTML = html.toLowerCase();
  const htmlClose = lowerHTML.lastIndexOf('</html>');
  function realBodyClose() {
    let searchEnd = htmlClose >= 0 ? htmlClose : lowerHTML.length;
    while (searchEnd > 0) {
      const candidate = lowerHTML.lastIndexOf('</body>', searchEnd);
      if (candidate < 0) return -1;
      const commentStart = lowerHTML.lastIndexOf('<!--', candidate);
      const commentEnd = lowerHTML.lastIndexOf('-->', candidate);
      if (commentStart > commentEnd) { searchEnd = commentStart - 1; continue; }
      const styleStart = lowerHTML.lastIndexOf('<style', candidate);
      const styleEnd = lowerHTML.lastIndexOf('</style>', candidate);
      if (styleStart > styleEnd) { searchEnd = styleStart - 1; continue; }
      return candidate;
    }
    return -1;
  }
  const bodyClose = realBodyClose();
  const patched = bodyClose >= 0
    ? html.slice(0, bodyClose) + injection + html.slice(bodyClose)
    : html + injection;
  iframe.srcdoc = patched;

  // Safety net: if 'ready' never fires (rare; JS error in iframe), make
  // sure the iframe becomes visible again so the user isn't stuck staring
  // at a blank rectangle.
  setTimeout(() => {
    if (iframe.style.visibility === 'hidden') {
      iframe.style.visibility = 'visible';
      rebuildingIframe = false;
    }
    hideCanvasLoading();
  }, 2500);
}

/**
 * Try to apply a skeleton change as a surgical patch on the existing
 * iframe DOM. Returns true on success. Returns false if the change is
 * complex enough that a full reload is safer (caller falls back to
 * renderIframe in that case).
 *
 * This is the heart of stable undo/redo: we keep the iframe alive,
 * preserving scroll, contenteditable focus, and event state, and only
 * mutate the elements that actually changed.
 */
function applyStructuralPatch() {
  if (!state.skeleton) return false;     // nothing valid to patch toward
  const iframe = document.getElementById('iframe');
  let iframeDoc;
  try { iframeDoc = iframe.contentDocument; } catch { return false; }
  if (!iframeDoc || !iframeDoc.body) return false;

  // Remote/undo patches cross the same security boundary as a full render.
  // This prevents newly-added active markup from bypassing renderForEditor.
  const safeSkeleton = sanitizeHTMLForEditor(state.skeleton);
  const newDoc = new DOMParser().parseFromString(safeSkeleton, 'text/html');
  if (!newDoc.body) return false;

  const newIds = new Set();
  newDoc.querySelectorAll('[data-block-id]').forEach(el => {
    newIds.add(el.getAttribute('data-block-id'));
  });
  const oldIds = new Set();
  iframeDoc.querySelectorAll('[data-block-id]').forEach(el => {
    oldIds.add(el.getAttribute('data-block-id'));
  });

  // Sanity check: if too many elements have to move, fall back to full reload.
  // Catches cases like document-replace (re-upload) where almost everything
  // is new — surgical patches would be slower and more error-prone.
  const removedCount = [...oldIds].filter(id => !newIds.has(id)).length;
  const addedCount = [...newIds].filter(id => !oldIds.has(id)).length;
  if (removedCount > Math.max(oldIds.size * 0.6, 50) ||
      addedCount > Math.max(newIds.size * 0.6, 50)) {
    return false;
  }

  // ── Surgical move / reorder ───────────────────────────────────────────
  // An undo of a drag changes an element's parent or sibling order. This used
  // to bail to renderIframe() (a full srcdoc reload) which discarded scroll —
  // the "undo scrolls the page" bug. Instead, when the element SET is unchanged
  // (a pure move/reorder with no adds or removes), we reposition the live nodes
  // in place via move-element / move-into below, so scroll, focus and text
  // selection all survive. A move tangled up with adds/removes (e.g. undoing a
  // column wrap) is too intricate to express safely in place, so that still
  // falls back to a full reload.
  const blockParentId = (el, doc) => {
    let p = el.parentElement;
    while (p && !(p.getAttribute && p.getAttribute('data-block-id')) && p !== doc.body) p = p.parentElement;
    return (p && p.getAttribute && p.getAttribute('data-block-id')) || null;
  };
  const prevBlockId = (el) => {
    let s = el.previousElementSibling;
    while (s && !s.hasAttribute('data-block-id')) s = s.previousElementSibling;
    return s ? s.getAttribute('data-block-id') : null;
  };
  let movedOrReordered = false;
  for (const id of newIds) {
    if (!oldIds.has(id)) continue;
    const nEl = newDoc.querySelector(`[data-block-id="${id}"]`);
    const oEl = iframeDoc.querySelector(`[data-block-id="${id}"]`);
    if (!nEl || !oEl) continue;
    if (blockParentId(nEl, newDoc) !== blockParentId(oEl, iframeDoc) ||
        prevBlockId(nEl) !== prevBlockId(oEl)) { movedOrReordered = true; break; }
  }
  const pureMoveReorder = (removedCount === 0 && addedCount === 0);
  if (movedOrReordered && !pureMoveReorder) return false;

  // 1. Remove elements no longer present.
  oldIds.forEach(id => {
    if (newIds.has(id)) return;
    sendToIframe({ cmd: 'remove-element', id });
  });
  // Reflect removals in our local set so the add-pass below uses the right state.
  const liveIds = new Set([...oldIds].filter(id => newIds.has(id)));

  // 2. Add elements that are new. Walk new doc in order so insertions are stable.
  const processed = new Set();
  const allNew = Array.from(newDoc.querySelectorAll('[data-block-id]'));
  for (const newEl of allNew) {
    const id = newEl.getAttribute('data-block-id');
    if (liveIds.has(id) || processed.has(id)) continue;

    // Find an existing ancestor (any element already in the iframe DOM).
    let parent = newEl.parentElement;
    let parentId = null;
    while (parent) {
      const pid = parent.getAttribute && parent.getAttribute('data-block-id');
      if (pid && liveIds.has(pid)) { parentId = pid; break; }
      if (pid && !liveIds.has(pid)) { parent = null; break; }   // parent is also new — defer
      if (parent === newDoc.body) break;
      parent = parent.parentElement;
    }
    if (!parentId) {
      // A new top-level body child has no block-id parent and cannot be
      // expressed by the current surgical protocol. Fall back to a full render
      // instead of claiming success while silently omitting the remote block.
      return false;
    }

    // Find the nearest previous sibling that exists in the iframe DOM.
    let prev = newEl.previousElementSibling;
    while (prev) {
      const pid = prev.getAttribute('data-block-id');
      if (pid && liveIds.has(pid)) break;
      prev = prev.previousElementSibling;
    }

    const html = newEl.outerHTML;
    if (prev) {
      sendToIframe({ cmd: 'insert', afterId: prev.getAttribute('data-block-id'), html });
    } else {
      sendToIframe({ cmd: 'insert', parentId, position: 'first', html });
    }

    // Mark this and all nested IDs as processed/live so we don't try to insert
    // children of an element we already inserted.
    const mark = (el) => {
      const i = el.getAttribute('data-block-id');
      if (i) { processed.add(i); liveIds.add(i); }
    };
    mark(newEl);
    newEl.querySelectorAll('[data-block-id]').forEach(mark);
  }

  // 2.5 Reposition moved / reordered blocks in place (scroll-preserving).
  // Walk the target document in order; for any block whose parent or previous
  // sibling differs from the live DOM, emit a move so the live iframe matches.
  // Processing in document order with "place after previous block" rebuilds the
  // exact target order without a reload.
  if (movedOrReordered) {
    const targetBlocks = [...newDoc.querySelectorAll('[data-block-id]')];
    for (const nEl of targetBlocks) {
      const id = nEl.getAttribute('data-block-id');
      const oEl = iframeDoc.querySelector(`[data-block-id="${id}"]`);
      if (!oEl) continue;
      const wantParent = blockParentId(nEl, newDoc);
      const wantPrev = prevBlockId(nEl);
      if (wantParent === blockParentId(oEl, iframeDoc) && wantPrev === prevBlockId(oEl)) continue;
      if (wantPrev) {
        sendToIframe({ cmd: 'move-element', id, targetId: wantPrev, before: false });
      } else if (wantParent) {
        sendToIframe({ cmd: 'move-into', id, containerId: wantParent, atStart: true });
      } else {
        // First block at body level — anchor before the next block sibling.
        let nx = nEl.nextElementSibling;
        while (nx && !nx.hasAttribute('data-block-id')) nx = nx.nextElementSibling;
        if (nx) sendToIframe({ cmd: 'move-element', id, targetId: nx.getAttribute('data-block-id'), before: true });
      }
    }
  }

  // 3. Pick up any text content that diverged inside elements that stayed put.
  // (Rare but possible: skeleton's stored text could differ from yBlocks during
  // an undo. The block observer will fire too, but eager-syncing here avoids
  // brief mismatches.)
  state.blocks.forEach(b => {
    sendToIframe({ cmd: 'set-block-text', id: b.id, text: b.text });
  });

  // 4. Reconcile inline styles for elements present in both — this is how a
  // remote style change (or a refresh restoring saved styles) reaches the view,
  // since steps 1–2 only handle added/removed elements.
  newIds.forEach(id => {
    if (!oldIds.has(id)) return;
    const nEl = newDoc.querySelector(`[data-block-id="${id}"]`);
    const oEl = iframeDoc.querySelector(`[data-block-id="${id}"]`);
    if (!nEl || !oEl) return;
    // Tag changed for the same id (e.g. image ↔ video swap) — replace wholesale
    // and skip the style/src reconcile below (the new element already carries them).
    if (nEl.tagName !== oEl.tagName) {
      const replacementHTML = tableHTMLWithLiveText(nEl.outerHTML);
      sendToIframe({ cmd: 'replace-element', id, html: replacementHTML });
      return;
    }
    // A text leaf becoming a container (notably a table cell gaining a caption
    // plus media) changes editability and block ownership even when its tag/id
    // stay the same. Surgical child inserts leave stale outer text and a dead
    // contenteditable binding; replace the common element atomically instead.
    if (nEl.hasAttribute('data-hce-text') !== oEl.hasAttribute('data-hce-text')) {
      const replacementHTML = tableHTMLWithLiveText(nEl.outerHTML);
      sendToIframe({ cmd: 'replace-element', id, html: replacementHTML });
      return;
    }
    const managedAttrs = new Set(['style', 'src', 'href', 'data-hce-href', 'value', 'checked', 'selected',
      'contenteditable', 'spellcheck', 'data-flash', 'data-commented']);
    const attributeMap = el => new Map(Array.from(el.attributes)
      .filter(attr => !attr.name.startsWith('data-hce-') && !managedAttrs.has(attr.name))
      .map(attr => [attr.name, attr.name === 'class'
        ? attr.value.split(/\s+/).filter(name => !name.startsWith('__hce-')).sort().join(' ')
        : attr.value]));
    const nextAttrs = attributeMap(nEl);
    const liveAttrs = attributeMap(oEl);
    if (nextAttrs.size !== liveAttrs.size ||
        Array.from(nextAttrs).some(([name, value]) => liveAttrs.get(name) !== value)) {
      const replacementHTML = tableHTMLWithLiveText(nEl.outerHTML);
      sendToIframe({ cmd: 'replace-element', id, html: replacementHTML });
      return;
    }
    const nStyle = nEl.getAttribute('style') || '';
    if (nStyle !== (oEl.getAttribute('style') || '')) {
      sendToIframe({ cmd: 'set-style', id, style: nStyle });
    }
    // Reconcile media sources too — so a collaborator's just-added image/video
    // appears without a full iframe reload.
    if (nEl.tagName === 'IMG' || nEl.tagName === 'VIDEO' || nEl.tagName === 'AUDIO') {
      const nSrc = nEl.getAttribute('src') || '';
      if (nSrc !== (oEl.getAttribute('src') || '')) {
        sendToIframe({ cmd: 'set-media-src', id, src: nSrc });
      }
    }
    // Reconcile text links (href + visible text).
    if (nEl.tagName === 'A' && nEl.hasAttribute('data-hce-link')) {
      const nHref = nEl.getAttribute('href') || '';
      const nText = state.blocks.find(b => b.id === id)?.text || '';
      if (nHref !== (oEl.getAttribute('href') || '') || nText !== oEl.textContent) {
        sendToIframe({ cmd: 'set-link', id, href: nHref, text: nText });
      }
    }
    // Reconcile whole-block links too. Without this, a collaborator receiving
    // the saved skeleton could keep a stale/missing data-hce-href in the live
    // iframe, so reopening the link popover incorrectly offered "Add".
    const nBlockHref = nEl.getAttribute('data-hce-href') || '';
    const oBlockHref = oEl.getAttribute('data-hce-href') || '';
    if (nBlockHref !== oBlockHref) {
      sendToIframe({ cmd: 'set-block-link', id, href: nBlockHref });
    }
    if (nEl.tagName === 'INPUT' || nEl.tagName === 'TEXTAREA' || nEl.tagName === 'SELECT') {
      const control = formControlStateFromElement(nEl);
      const live = formControlStateFromElement(oEl, iframeDoc);
      if (control && JSON.stringify(control) !== JSON.stringify(live)) {
        sendToIframe({ cmd: 'set-form-control', id, control });
      }
    }
  });

  return true;
}

function sendToIframe(data) {
  const iframe = document.getElementById('iframe');
  const message = { _src: 'hce', ...data };
  if (typeof message.html === 'string') {
    message.html = sanitizeHTMLFragmentForEditor(message.html);
    if (!message.html) return;
  }
  if (typeof message.src === 'string' && !isSafePreviewUrl(message.src, 'src')) return;
  if (typeof message.href === 'string' && message.href && !isSafePreviewUrl(message.href, 'href')) return;
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage(message, '*');
  }
}

async function handleIframeMessage(e) {
  const iframe = document.getElementById('iframe');
  // Only the active editor iframe may mutate room state. This rejects messages
  // from unrelated windows, browser extensions, and nested document frames.
  if (!iframe || e.source !== iframe.contentWindow) return;
  const d = e.data;
  if (!d || !d.type) return;
  if (d.type === 'live-state-snapshot') {
    resolveLiveStateSnapshot(d);
    return;
  }

  if (d.type === 'block-text-change') {
    const block = state.blocks.find(b => b.id === d.id);
    if (block && block.text !== d.text) {
      const nextBytes = state.documentBytes + serializedTextByteLength(d.text) - serializedTextByteLength(block.text);
      if (nextBytes > MAX_DOCUMENT_BYTES) {
        toast(t('t_doc_too_big'));
        sendToIframe({ cmd: 'set-block-text', id: d.id, text: block.text, force: true });
        return;
      }
      state.documentBytes = nextBytes;
      block.text = d.text;
      state.collab?.onLocalBlockEdit?.(d.id, d.text);
      markSaving();
    }
  }

  if (d.type === 'form-control-change') persistFormControl(d.control);

  if (d.type === 'style-committed') {
    if (persistStyleChanges(d.styles)) logStyleAction();
  }

  // Style undo/redo re-applied styles in the iframe — persist, but don't log
  // a new undo step (the style history already moved).
  if (d.type === 'style-persist') {
    persistStyleChanges(d.styles);
  }

  // A missing image/video got a source (uploaded inline or pasted link) —
  // write it into the skeleton so it syncs to collaborators and downloads.
  if (d.type === 'media-committed') {
    await enqueueImageMutation(async () => {
      const incoming = d.file instanceof Blob ? d.file : d.src;
      if (!incoming || (!(incoming instanceof Blob) && !isSafePreviewUrl(incoming, 'src'))) return;
      const prepared = await fitIncomingImage(incoming, d.id);
      if (prepared && persistMediaSrc(d.id, prepared)) {
        if (incoming instanceof Blob || prepared !== d.src) {
          sendToIframe({ cmd: 'set-media-src', id: d.id, src: prepared });
        }
      } else {
        const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
        const currentSrc = doc.querySelector(`[data-block-id="${d.id}"]`)?.getAttribute('src') || '';
        if (currentSrc) sendToIframe({ cmd: 'set-media-src', id: d.id, src: currentSrc });
        else sendToIframe({ cmd: 'revert-media-src', id: d.id });
      }
    });
  }

  if (d.type === 'link-committed') {
    if (!persistLink(d.id, d.href, d.text)) {
      const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
      const current = doc.querySelector(`[data-block-id="${d.id}"]`);
      const currentText = state.blocks.find(b => b.id === d.id)?.text || '';
      sendToIframe({ cmd: 'set-link', id: d.id, href: current?.getAttribute('href') || '#', text: currentText });
    }
  }

  if (d.type === 'block-link-committed') {
    if (!persistBlockLink(d.id, d.href)) {
      const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
      const current = doc.querySelector(`[data-block-id="${d.id}"]`);
      sendToIframe({ cmd: 'set-block-link', id: d.id, href: current?.getAttribute('data-hce-href') || '' });
    }
  }

  if (d.type === 'request-unlink') {
    unlinkInline(d.id);
  }

  if (d.type === 'comment-toggle-select') {
    toggleCommentSelection({ id: d.id, tag: d.tag, snippet: d.snippet });
  }

  if (d.type === 'request-block-delete') {
    deleteBlock(d.id);
  }

  if (d.type === 'request-block-duplicate') {
    duplicateBlock(d.id, d.afterId, d.layout);
  }

  if (d.type === 'request-move') {
    moveBlock(d.id, d.targetId, d.before);
  }

  if (d.type === 'request-place-beside') {
    placeBeside(d.id, d.targetId, d.side);
  }

  if (d.type === 'request-swap-media') {
    const incoming = d.file instanceof Blob ? d.file : d.src;
    if (!incoming || (!(incoming instanceof Blob) && !isSafePreviewUrl(incoming, 'src'))) return;
    await enqueueImageMutation(async () => {
      const prepared = d.kind === 'image' ? await fitIncomingImage(incoming, d.id) : incoming;
      if (prepared) swapMediaType(d.id, d.kind, prepared, d.embed);
    });
  }

  if (d.type === 'request-move-into') {
    moveBlockInto(d.id, d.containerId, d.atStart);
  }

  if (d.type === 'request-insert-image') {
    insertMediaBlock(d.afterId, 'image', d.into);
  }

  if (d.type === 'request-insert-video') {
    insertMediaBlock(d.afterId, 'video', d.into);
  }

  if (d.type === 'request-insert-table') {
    insertTableBlock(d.afterId, d.into);
  }

  if (d.type === 'request-insert-media-at') {
    const incoming = d.file instanceof Blob ? d.file : d.src;
    if (!incoming || (!(incoming instanceof Blob) && !isSafePreviewUrl(incoming, 'src'))) return;
    await enqueueImageMutation(async () => {
      const prepared = d.kind === 'image' ? await fitIncomingImage(incoming) : incoming;
      if (prepared) insertMediaAt(d.targetId, d.before, d.kind, prepared);
    });
  }

  if (d.type === 'request-column-duplicate') {
    duplicateColumn(d.id);
  }

  if (d.type === 'request-column-delete') {
    deleteColumn(d.id);
  }

  if (d.type === 'request-col-insert') {
    insertColumn(d.id, d.right);
  }

  if (d.type === 'request-row-insert') {
    insertRow(d.id, d.below);
  }

  if (d.type === 'request-col-move') {
    moveColumn(d.id, d.toIndex);
  }

  if (d.type === 'request-row-move') {
    moveRow(d.id, d.toIndex);
  }

  if (d.type === 'ready') {
    sendToIframe({ cmd: 'set-lang', lang: hceLang });   // localize the in-iframe panel
    // Re-assert the current mode. A freshly (re)loaded iframe boots in its
    // default 'edit' mode and makes every text leaf contenteditable; without
    // this, a full reload while the user is in drag / view / comment mode would
    // silently leave text editable (mode button says "drag", text still edits).
    sendToIframe({ cmd: 'set-mode', mode: state.mode });
    if (state.isSlides) sendToIframe({ cmd: 'set-slides', on: true });  // enable ←/→ flipping
    pushSelectionToIframe();
    const iframe = document.getElementById('iframe');
    if (pendingScroll) {
      try { iframe.contentWindow?.scrollTo(pendingScroll.x, pendingScroll.y); } catch {}
      pendingScroll = null;
    }
    // Reveal the iframe (we hid it during the reload to suppress flicker).
    iframe.style.visibility = 'visible';
    rebuildingIframe = false;
    hideCanvasLoading();    // document is on screen — drop the import spinner
  }

  if (d.type === 'request-undo') performUndo();
  if (d.type === 'request-redo') performRedo();

  // [ADDITION] Iframe asks us to end the current Yjs capture window —
  // sent after every style change so style ≠ text are not merged into
  // the same undo step.
  if (d.type === 'request-stop-capturing') state.collab?.stopCapturing?.();

  if (d.type === 'iframe-mousedown') {
    document.getElementById('export-menu')?.classList.remove('show');
    document.getElementById('share-menu')?.classList.remove('show');
  }
}

// ─── Mode switching ─────────────────────────────
//   edit    → sidebar hidden
//   block   → sidebar hidden
//   comment → sidebar visible (composer appears when selection exists)
window.setMode = function (m) {
  state.mode = m;
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m)
  );
  document.getElementById('canvas').className = 'canvas mode-' + m;
  document.getElementById('sidebar').classList.toggle('hide', m !== 'comment');

  // Leaving comment mode clears pending selection.
  if (m !== 'comment') closeComposer();

  sendToIframe({ cmd: 'set-mode', mode: m });
};

// ─── Comment selection / composer ───────────────
function toggleCommentSelection(ref) {
  // If a general-comment is being composed, switch to anchored on this click.
  if (state.composer.general) {
    state.composer.general = false;
    state.composer.refs = [];
  }
  const ix = state.composer.refs.findIndex(r => r.id === ref.id);
  if (ix >= 0) {
    state.composer.refs.splice(ix, 1);
    if (state.composer.refs.length === 0) {
      closeComposer();
      return;
    }
  } else {
    state.composer.refs.push(ref);
  }
  state.composer.open = true;
  renderComposer();
  pushSelectionToIframe();
}

window.startGeneralComment = function () {
  if (state.mode !== 'comment') window.setMode('comment');
  state.composer.open = true;
  state.composer.general = true;
  state.composer.refs = [];
  renderComposer();
  pushSelectionToIframe();
  setTimeout(() => document.getElementById('cmt-input')?.focus(), 30);
};

window.cancelComposer = function () { closeComposer(); };

function closeComposer() {
  state.composer.open = false;
  state.composer.general = false;
  state.composer.refs = [];
  renderComposer();
  pushSelectionToIframe();
}

function pushSelectionToIframe() {
  sendToIframe({
    cmd: 'set-selection',
    ids: state.composer.refs.map(r => r.id),
  });
}

function renderComposer() {
  const composer = document.getElementById('composer');
  const targets = document.getElementById('composer-targets');
  const input = document.getElementById('cmt-input');

  if (!state.composer.open) {
    composer.style.display = 'none';
    input.value = '';
    return;
  }

  composer.style.display = 'block';
  targets.innerHTML = '';

  if (state.composer.general) {
    // No chip, no explanatory hint — just the empty composer with a placeholder.
    targets.style.display = 'none';
  } else {
    targets.style.display = 'flex';
    state.composer.refs.forEach(ref => {
      const chip = document.createElement('span');
      chip.className = 'target-chip';
      chip.innerHTML = `<span class="snip">${escapeHTML(ref.snippet)}</span>
        <button class="x" title="Remove from selection">×</button>`;
      chip.querySelector('.x').onclick = () => {
        toggleCommentSelection(ref);   // toggles off
      };
      targets.appendChild(chip);
    });
  }

  // Wire keyboard once
  input.onkeydown = e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); window.saveComposer(); }
    if (e.key === 'Escape') closeComposer();
  };
}

window.saveComposer = function () {
  const input = document.getElementById('cmt-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  if (utf8ByteLength(text) > MAX_COMMENT_BYTES || Object.keys(state.comments).length >= MAX_COMMENTS) {
    toast(t('t_comment_too_big'));
    return;
  }

  const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
  const comment = {
    id,
    refs: state.composer.general ? [] : state.composer.refs.map(r => ({
      id: r.id, tag: r.tag, snippet: r.snippet,
    })),
    general: state.composer.general,
    text,
    author: { id: state.user.id, name: state.user.name, color: state.user.color },
    createdAt: Date.now(),
  };
  if (commentsByteLength({ ...state.comments, [id]: comment }) > MAX_COMMENTS_TOTAL_BYTES) {
    toast(t('t_comment_too_big'));
    return;
  }
  state.comments[id] = comment;
  state.collab?.onLocalCommentAdd?.(comment);
  markSaving();

  closeComposer();
  renderComments();
  toast(t('t_cmt_saved'));
};

window.deleteComment = function (id) {
  const c = state.comments[id];
  if (!c) return;
  delete state.comments[id];
  state.collab?.onLocalCommentDelete?.(id);
  if (editingCommentId === id) editingCommentId = null;
  renderComments();
  scheduleLocalDraftSave();
};

// ─── Edit a comment (only your own) ─────────────
let editingCommentId = null;
window.editComment = function (id) {
  const c = state.comments[id];
  if (!c || !c.author || c.author.id !== state.user.id) return;   // own only
  editingCommentId = id;
  renderComments();
  const ta = document.querySelector('.sb-item .cmt-edit-input');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
};
function saveCommentEdit(id, text) {
  const c = state.comments[id];
  if (!c || !c.author || c.author.id !== state.user.id) return;
  const next = (text || '').trim();
  if (!next) return;                       // empty → keep old (use delete to remove)
  if (utf8ByteLength(next) > MAX_COMMENT_BYTES) { toast(t('t_comment_too_big')); return; }
  const updated = { ...c, text: next, editedAt: Date.now() };
  if (commentsByteLength({ ...state.comments, [id]: updated }) > MAX_COMMENTS_TOTAL_BYTES) {
    toast(t('t_comment_too_big'));
    return;
  }
  // Y.Map stores this as a plain object. Mutating the object returned by get()
  // also mutates the value held by UndoManager's old item, so undo would keep
  // the edited text. Always replace it with a fresh immutable value.
  state.comments[id] = updated;
  editingCommentId = null;
  state.collab?.onLocalCommentAdd?.(updated);     // upsert over collab
  markSaving();
  renderComments();
  toast(t('t_cmt_updated'));
}
function cancelCommentEdit() { editingCommentId = null; renderComments(); }

function renderComments() {
  const list = document.getElementById('cmt-list');
  const all = Object.values(state.comments).filter(isValidComment).sort((a, b) => a.createdAt - b.createdAt);
  document.getElementById('cmt-count').textContent = all.length;

  if (all.length === 0 && !state.composer.open) {
    list.innerHTML = '<div class="sb-empty">' + t('cmt_empty') + '</div>';
    return;
  }

  list.innerHTML = '';
  all.forEach(c => {
    const item = document.createElement('div');
    item.className = 'sb-item';
    const isGeneral = c.general || (c.refs || []).length === 0;

    const tagsHTML = isGeneral
      ? ''
      : `<div class="ref-tags">${
          c.refs.map(r => `<span class="ref-tag" title="${escapeHTML(r.snippet)}">${escapeHTML(r.snippet)}</span>`).join('')
        }</div>`;

    const isOwn = c.author && c.author.id === state.user.id;
    const editing = editingCommentId === c.id;
    const editedHTML = c.editedAt ? '<span class="edited">· edited</span>' : '';

    const bodyHTML = editing
      ? `<div class="cmt-edit">
           <textarea class="cmt-edit-input" rows="3">${escapeHTML(c.text)}</textarea>
           <div class="cmt-edit-actions">
             <button class="cmt-cancel">Cancel</button>
             <button class="cmt-save">Save</button>
           </div>
         </div>`
      : `<div class="body">${escapeHTML(c.text)}</div>`;

    item.innerHTML = `
      ${isOwn && !editing ? '<button class="edit" title="Edit">✎</button>' : ''}
      <button class="del" title="Delete">×</button>
      <div class="meta">
        <span class="author">${escapeHTML(c.author.name)}</span>
        ${editedHTML}
      </div>
      ${tagsHTML}
      ${bodyHTML}
    `;
    const authorEl = item.querySelector('.author');
    if (authorEl) authorEl.style.color = safeUserColor(c.author.color);
    item.onclick = () => {
      if (editing || isGeneral) return;
      const ids = c.refs.map(r => r.id);
      sendToIframe({ cmd: 'flash-refs', ids });
      sendToIframe({ cmd: 'scroll-to', id: ids[0] });
    };
    item.querySelector('.del').onclick = e => {
      e.stopPropagation();
      window.deleteComment(c.id);
    };
    const editBtn = item.querySelector('.edit');
    if (editBtn) editBtn.onclick = e => { e.stopPropagation(); window.editComment(c.id); };
    if (editing) {
      const ta = item.querySelector('.cmt-edit-input');
      item.querySelector('.cmt-save').onclick = e => { e.stopPropagation(); saveCommentEdit(c.id, ta.value); };
      item.querySelector('.cmt-cancel').onclick = e => { e.stopPropagation(); cancelCommentEdit(); };
      ta.onclick = e => e.stopPropagation();
      ta.onkeydown = e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveCommentEdit(c.id, ta.value); }
        if (e.key === 'Escape') { e.preventDefault(); cancelCommentEdit(); }
      };
    }
    list.appendChild(item);
  });
}

// ─── Structural ops (delete / duplicate) ───────
//
// Tables need a special rule: duplicating a single <td> would add an
// extra cell to one row and break the column layout. So if the user
// targeted a cell (or anything inside a cell), we silently retarget to
// the containing <tr> — same row, sibling-inserted, table stays valid.
function resolveStructuralTarget(elementId) {
  if (!state.skeleton) return elementId;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!el) return elementId;
  const containingCell = el.closest('td, th');
  // Media and nested blocks inside a cell expose their own toolbar. Preserve
  // that explicit target; only selecting the cell/text cell itself maps to its
  // containing row to keep table width regular.
  if (containingCell && el !== containingCell) {
    return elementId;
  }
  let cur = el;
  while (cur && cur !== doc.body) {
    const t = cur.tagName;
    if (t === 'TR' && cur.hasAttribute('data-block-id')) {
      return cur.getAttribute('data-block-id');
    }
    if (t === 'TABLE') break;       // clicked the table itself — leave it alone
    cur = cur.parentElement;
  }
  // A lone text leaf inside a styling wrapper — e.g. <blockquote><p>…</p>,
  // <div class="callout"><p>…</p>, <figure><img>… — visually reads as ONE
  // block, so selecting it (a single click lands on the inner leaf, not the
  // wrapper) and duplicating should copy the WHOLE wrapper, not just the text.
  // Climb while the element is the ONLY block child of its parent (i.e. the
  // parent exists solely to contain/style it). Lists and tables are excluded
  // so their own duplicate rules keep working.
  const SKIP_WRAP = new Set(['TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','UL','OL','LI','DL','DT','DD']);
  let node = el;
  while (
    node.parentElement &&
    node.parentElement !== doc.body &&
    node.parentElement !== doc.documentElement &&
    node.parentElement.hasAttribute('data-block-id') &&
    !SKIP_WRAP.has(node.parentElement.tagName)
  ) {
    const parent = node.parentElement;
    let blockChildren = 0;
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c.hasAttribute && c.hasAttribute('data-block-id')) blockChildren++;
    }
    if (blockChildren !== 1) break;   // parent holds more than just this → keep the leaf
    node = parent;
  }
  return node.getAttribute('data-block-id') || elementId;
}

function deleteColumn(cellId) {
  const result = removeColumnFromSkeleton(state.skeleton, cellId);
  if (result.unsupported) { toast(t(result.unsupported === 'last-column' ? 't_last_col' : 't_merged_table')); return; }
  const { skeleton, removedIds } = result;
  if (!removedIds.length) return;
  state.skeleton = skeleton;
  const gone = new Set(removedIds);
  state.blocks = state.blocks.filter(b => !gone.has(b.id));
  refreshCapacityAndLocalDraft();

  // Drop comments anchored solely to removed elements.
  Object.entries(state.comments).forEach(([cid, c]) => {
    const refs = (c.refs || []).filter(r => !gone.has(r.id));
    if (refs.length === 0 && !c.general) {
      delete state.comments[cid];
      state.collab?.onLocalCommentDelete?.(cid);
    } else if (refs.length !== (c.refs || []).length) {
      c.refs = refs;
      state.collab?.onLocalCommentAdd?.(c);
    }
  });

  // Surgical removes — iframe DOM stays alive, no scroll jump.
  removedIds.forEach(id => sendToIframe({ cmd: 'remove-element', id }));

  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  renderComments();
  markSaving();
  toast(t('t_col_removed'));
}

function duplicateColumn(cellId) {
  const result = duplicateColumnInSkeleton(state.skeleton, cellId, state.blocks);
  if (result.unsupported) { toast(t(result.unsupported === 'native-id-dependency' ? 't_dup_id_dependency' : 't_merged_table')); return; }
  if (!result.insertions || result.insertions.length === 0) return;
  const nextBlocks = state.blocks.concat(result.addedBlocks);
  if (!validateCandidateDocument(result.skeleton, nextBlocks)) return;
  state.skeleton = result.skeleton;
  state.blocks = nextBlocks;

  // Surgical insert into each row so we don't reload the iframe.
  result.insertions.forEach(ins => {
    sendToIframe({ cmd: 'insert-after', afterId: ins.afterId, html: ins.html });
  });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_col_dup'));
}

// Re-apply live text from state.blocks onto a freshly built table HTML string,
// so the swapped-in table shows current content (not stale skeleton text).
function tableHTMLWithLiveText(tableHTML) {
  if (!tableHTML) return tableHTML;
  const tpl = document.createElement('template');
  tpl.innerHTML = tableHTML;
  const table = tpl.content.firstElementChild;
  if (!table) return tableHTML;
  const map = new Map(state.blocks.map(b => [b.id, b.text]));
  if (table.matches?.('[data-hce-text]')) {
    const rootId = table.getAttribute('data-block-id');
    if (map.has(rootId)) table.textContent = map.get(rootId);
  }
  table.querySelectorAll('[data-hce-text]').forEach(el => {
    const id = el.getAttribute('data-block-id');
    if (map.has(id)) el.textContent = map.get(id);
  });
  return table.outerHTML;
}

// Insert a blank column left/right of `cellId`'s column. Swaps the whole
// (small) table into the iframe with one replace-element so cell geometry and
// contenteditable are rebuilt cleanly.
function insertColumn(cellId, right) {
  const res = insertColumnInSkeleton(state.skeleton, cellId, right ? 'right' : 'left', state.blocks);
  if (res.unsupported) { toast(t('t_merged_table')); return; }
  if (!res.addedBlocks.length || !res.tableId) return;
  const nextBlocks = state.blocks.concat(res.addedBlocks);
  if (!validateCandidateDocument(res.skeleton, nextBlocks)) return;
  state.skeleton = res.skeleton;
  state.blocks = nextBlocks;
  sendToIframe({ cmd: 'replace-element', id: res.tableId, html: tableHTMLWithLiveText(res.tableHTML) });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_col_added'));
}

// Insert a blank row above/below `cellId`'s row (same single-swap approach).
function insertRow(cellId, below) {
  const res = insertRowInSkeleton(state.skeleton, cellId, below ? 'below' : 'above', state.blocks);
  if (res.unsupported) { toast(t('t_merged_table')); return; }
  if (!res.addedBlocks.length || !res.tableId) return;
  const nextBlocks = state.blocks.concat(res.addedBlocks);
  if (!validateCandidateDocument(res.skeleton, nextBlocks)) return;
  state.skeleton = res.skeleton;
  state.blocks = nextBlocks;
  sendToIframe({ cmd: 'replace-element', id: res.tableId, html: tableHTMLWithLiveText(res.tableHTML) });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_row_added'));
}

// Move a whole table column by insertion-gap index (0..colCount).
function moveColumn(cellId, toIndex) {
  const res = moveColumnInSkeleton(state.skeleton, cellId, toIndex);
  if (res.unsupported) { toast(t('t_merged_table')); return; }
  if (!res.moved || !res.tableId) return;
  state.skeleton = res.skeleton;
  sendToIframe({ cmd: 'replace-element', id: res.tableId, html: tableHTMLWithLiveText(res.tableHTML) });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_moved'));
}

// Move a whole table row by insertion-gap index (0..rowCount).
function moveRow(cellId, toIndex) {
  const res = moveRowInSkeleton(state.skeleton, cellId, toIndex);
  if (res.unsupported) { toast(t(res.unsupported === 'row-groups' ? 't_row_groups' : 't_merged_table')); return; }
  if (!res.moved || !res.tableId) return;
  state.skeleton = res.skeleton;
  sendToIframe({ cmd: 'replace-element', id: res.tableId, html: tableHTMLWithLiveText(res.tableHTML) });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_moved'));
}

function duplicateBlock(rawId, afterId, layout) {
  const elementId = resolveStructuralTarget(rawId);
  if (isUnsafeMergedTableRow(elementId)) { toast(t('t_merged_table')); return; }
  const result = duplicateElementInSkeleton(
    state.skeleton, elementId, state.blocks, afterId, layout
  );
  if (result.unsupported === 'native-id-dependency') { toast(t('t_dup_id_dependency')); return; }
  if (result.skeleton === state.skeleton) return;
  const nextBlocks = state.blocks.concat(result.addedBlocks);
  if (!validateCandidateDocument(result.skeleton, nextBlocks)) return;
  state.skeleton = result.skeleton;
  state.blocks = nextBlocks;

  // Surgical DOM insert — avoids reloading the iframe (no scroll jump).
  sendToIframe({
    cmd: 'insert-after',
    afterId: result.originalId,
    html: result.clonedHTML,
  });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_dup'));
}

// Insert a fresh, empty image/video frame right after `afterId`. It renders as
// an upload placeholder (via the iframe's missing-media detection); the user
// then drops/uploads/links media, and can drag the frame wherever they want.
function insertMediaBlock(afterId, kind, into) {
  if (!state.skeleton || !afterId) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  let anchor = doc.querySelector(`[data-block-id="${afterId}"]`);
  if (!anchor || !anchor.parentNode) return;
  // Inserting from a table cell's "+" keeps the media INSIDE that cell rather
  // than climbing out into the row. A pure-text cell is upgraded to a container
  // so an editable caption span and the image can coexist.
  const cell = anchor.closest('td, th');
  if (cell) { insertMediaIntoCell(doc, cell, kind); return; }
  // Adding from a filled card / section's "+" → drop the media INSIDE it.
  if (into) {
    const id2 = freshBlockId('m', doc);
    const e2 = doc.createElement(kind === 'video' ? 'video' : 'img');
    e2.setAttribute('data-block-id', id2);
    e2.setAttribute('style', 'display:block;width:100%;max-width:100%;height:auto;border-radius:8px;margin:12px 0;');
    if (kind === 'video') e2.setAttribute('controls', '');
    anchor.appendChild(e2);
    const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    if (!validateCandidateDocument(nextSkeleton)) return;
    state.skeleton = nextSkeleton;
    sendToIframe({ cmd: 'insert-into', containerId: afterId, html: e2.outerHTML });
    state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
    markSaving();
    toast(t(kind === 'video' ? 't_video_added' : 't_img_added'));
    return;
  }
  // Drop the new media as a full-width block: climb out of any column row so it
  // lands BELOW the whole row instead of squeezing in as another skinny column.
  let rowAnc = anchor.closest('[data-hce-row]');
  while (rowAnc) { anchor = rowAnc; rowAnc = anchor.parentElement && anchor.parentElement.closest('[data-hce-row]'); }
  const insAfterId = anchor.getAttribute('data-block-id');
  const id = freshBlockId('m', doc);
  const el = doc.createElement(kind === 'video' ? 'video' : 'img');
  el.setAttribute('data-block-id', id);
  el.setAttribute('style', 'display:block;width:100%;max-width:560px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin:12px 0;');
  if (kind === 'video') el.setAttribute('controls', '');
  anchor.parentNode.insertBefore(el, anchor.nextSibling);
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const collapsed = collapseSparseRows(nextSkeleton);
  if (!validateCandidateDocument(collapsed.skeleton)) return;
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  if (collapsed.changed) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'insert-after', afterId: insAfterId, html: el.outerHTML });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t(kind === 'video' ? 't_video_added' : 't_img_added'));
}

// Place a fresh media element INSIDE a table cell. Upgrades a pure-text cell to
// a container (its text becomes an editable caption span) so text + image live
// together; the cell is re-rendered surgically via replace-element.
function insertMediaIntoCell(doc, cell, kind) {
  const cellId = cell.getAttribute('data-block-id');
  const mkId = (p) => freshBlockId(p, doc);
  const removedIds = [];
  const addedBlocks = [];
  if (cell.hasAttribute('data-hce-text')) {
    const txt = state.blocks.find(b => b.id === cellId)?.text || '';
    cell.removeAttribute('data-hce-text');
    cell.textContent = '';
    removedIds.push(cellId);
    if (txt && txt.trim()) {
      const span = doc.createElement('span');
      const sid = mkId('s');
      span.setAttribute('data-block-id', sid);
      span.setAttribute('data-hce-text', '1');
      span.textContent = txt;
      cell.appendChild(span);
      addedBlocks.push({ id: sid, tag: 'span', text: txt });
    }
  }
  const cm = doc.createElement(kind === 'video' ? 'video' : 'img');
  cm.setAttribute('data-block-id', mkId('m'));
  cm.setAttribute('style', 'display:block;width:100%;max-width:100%;height:auto;border-radius:6px;margin:6px 0 0;');
  if (kind === 'video') cm.setAttribute('controls', '');
  cell.appendChild(cm);
  const nextBlocks = state.blocks.filter(b => !removedIds.includes(b.id)).concat(addedBlocks);
  const liveHTML = cell.outerHTML;
  const nextSkeleton = compactSkeleton('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
  if (!validateCandidateDocument(nextSkeleton, nextBlocks)) return;
  state.blocks = nextBlocks;
  state.skeleton = nextSkeleton;
  sendToIframe({ cmd: 'replace-element', id: cellId, html: liveHTML });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t(kind === 'video' ? 't_video_added' : 't_img_added'));
}

// Insert a fresh 3×3 table (a header row + two body rows) after `afterId`. Cells
// are editable text leaves, registered as blocks so they sync + persist; an
// image can later be dropped into any cell via that cell's "+" menu.
function insertTableBlock(afterId, into) {
  if (!state.skeleton || !afterId) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  let anchor = doc.querySelector(`[data-block-id="${afterId}"]`);
  if (!anchor || !anchor.parentNode) return;
  // Never nest inside another table, nor squeeze into a column row — land it as
  // a full-width block below. (Skip that climb when dropping INTO a card.)
  if (!into) {
    const inTable = anchor.closest('table');
    if (inTable && inTable.parentNode) anchor = inTable;
    let rowAnc = anchor.closest('[data-hce-row]');
    while (rowAnc) { anchor = rowAnc; rowAnc = anchor.parentElement && anchor.parentElement.closest('[data-hce-row]'); }
  }
  const insAfterId = anchor.getAttribute('data-block-id');

  const base = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let seq = 0;
  const uid = () => 'k' + base + (seq++).toString(36);

  const ROWS = 3, COLS = 3;
  const cellCss = 'border:1px solid #e7e5e4;padding:8px 12px;text-align:left;vertical-align:top;min-width:64px;';
  const headCss = cellCss + 'background:#f5f5f4;font-weight:600;';
  const addedBlocks = [];

  const table = doc.createElement('table');
  table.setAttribute('data-block-id', uid());
  table.setAttribute('style', 'border-collapse:collapse;width:560px;max-width:100%;margin:14px 0;font-size:14px;line-height:1.5;color:#1a1a1a;');
  const tbody = doc.createElement('tbody');
  tbody.setAttribute('data-block-id', uid());
  for (let r = 0; r < ROWS; r++) {
    const tr = doc.createElement('tr');
    tr.setAttribute('data-block-id', uid());
    for (let c = 0; c < COLS; c++) {
      const head = r === 0;
      const elCell = doc.createElement(head ? 'th' : 'td');
      const cid = uid();
      elCell.setAttribute('data-block-id', cid);
      elCell.setAttribute('data-hce-text', '1');
      elCell.setAttribute('style', head ? headCss : cellCss);
      const text = head ? (t('tbl_col') + ' ' + (c + 1)) : '';
      elCell.textContent = text;
      addedBlocks.push({ id: cid, tag: head ? 'th' : 'td', text });
      tr.appendChild(elCell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const liveTableHTML = table.outerHTML;
  const nextBlocks = state.blocks.concat(addedBlocks);

  if (into) {
    anchor.appendChild(table);
    const nextSkeleton = compactSkeleton('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
    if (!validateCandidateDocument(nextSkeleton, nextBlocks)) return;
    state.skeleton = nextSkeleton;
    state.blocks = nextBlocks;
    sendToIframe({ cmd: 'insert-into', containerId: afterId, html: liveTableHTML });
  } else {
    anchor.parentNode.insertBefore(table, anchor.nextSibling);
    const nextSkeleton = compactSkeleton('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
    if (!validateCandidateDocument(nextSkeleton, nextBlocks)) return;
    state.skeleton = nextSkeleton;
    state.blocks = nextBlocks;
    sendToIframe({ cmd: 'insert-after', afterId: insAfterId, html: liveTableHTML });
  }
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_table_added'));
}

// Insert a media element with a source already set, before/after `targetId`
// (used by drag-a-file-in and paste). Inlined data-URI → downloads + syncs.
function insertMediaAt(targetId, before, kind, src) {
  if (!state.skeleton || !targetId || !src) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  let target = doc.querySelector(`[data-block-id="${targetId}"]`);
  if (!target || !target.parentNode) return;
  // Keep dropped/pasted media as a full-width block: climb out of any column row.
  let rowAnc = target.closest('[data-hce-row]');
  while (rowAnc) { target = rowAnc; rowAnc = target.parentElement && target.parentElement.closest('[data-hce-row]'); }
  const relId = target.getAttribute('data-block-id');
  const id = freshBlockId('m', doc);
  const el = doc.createElement(kind === 'video' ? 'video' : 'img');
  el.setAttribute('data-block-id', id);
  el.setAttribute('style', 'display:block;width:100%;max-width:560px;height:auto;border-radius:8px;margin:12px 0;');
  if (kind === 'video') el.setAttribute('controls', '');
  el.setAttribute('src', src);
  if (before) target.parentNode.insertBefore(el, target);
  else target.parentNode.insertBefore(el, target.nextSibling);
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const collapsed = collapseSparseRows(nextSkeleton);
  if (!validateCandidateDocument(collapsed.skeleton)) return;
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  if (collapsed.changed) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'insert-rel', targetId: relId, before: !!before, html: el.outerHTML });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t(kind === 'video' ? 't_video_added' : 't_img_added'));
}

function moveBlock(movingId, targetId, before) {
  if (!state.skeleton || !movingId || !targetId || movingId === targetId) return;
  // A plain reorder must never squeeze the mover INTO a column row it isn't
  // already part of — aim at the whole row (drop above/below it) instead.
  try {
    const probe = new DOMParser().parseFromString(state.skeleton, 'text/html');
    const mv = probe.querySelector(`[data-block-id="${movingId}"]`);
    const tg = probe.querySelector(`[data-block-id="${targetId}"]`);
    if (mv && tg) {
      const dest = tg.parentElement;
      if (!destinationAllowsChild(dest, mv.tagName)) return;
      if (dest?.tagName === 'DETAILS' && tg.tagName === 'SUMMARY' && before && mv.tagName !== 'SUMMARY') return;
      let tgRow = tg.closest('[data-hce-row]');
      while (tgRow && tgRow.parentElement) {
        const outer = tgRow.parentElement.closest('[data-hce-row]');
        if (!outer) break;
        tgRow = outer;
      }
      if (tgRow && !tgRow.contains(mv)) targetId = tgRow.getAttribute('data-block-id');
    }
  } catch {}

  // A context-sensitive element (a list item, dt/dd, …) dragged next to a block
  // OUTSIDE its kind of container would become a broken orphan (a bare <li> at
  // whatever level the target sits — often the document root). Instead of
  // refusing the drag (which felt like "can't move it"), wrap the mover in a
  // fresh list / dl / figure / details at the drop point so it stays valid and
  // still lands exactly where the user aimed.
  const wrap = wrappedMoveIfNeeded(movingId, targetId, before);
  if (wrap === 'handled') return;

  const result = moveElementInSkeleton(state.skeleton, movingId, targetId, !!before);
  if (!result.moved || result.skeleton === state.skeleton) return;   // no-op (same spot)
  const collapsed = collapseSparseRows(result.skeleton);
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  // Surgical DOM move — keep the iframe alive (no scroll jump) for the mover.
  if (collapsed.changed) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'move-element', id: movingId, targetId, before: !!before });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_moved'));
}

// The container tag a context-sensitive element needs, or null if it can live
// anywhere. Keeps the drag free (anything can be dropped anywhere) while never
// leaving an element in a parent that would render it broken.
function contextWrapTag(tag, element) {
  if (tag === 'LI') {
    const list = element?.closest?.('ol, ul, menu');
    return list?.tagName?.toLowerCase() || 'ul';
  }
  if (tag === 'DT' || tag === 'DD') return 'dl';
  if (tag === 'FIGCAPTION') return 'figure';
  if (tag === 'SUMMARY') return 'details';
  return null;
}
function containerHolds(wrapTag, parentTag) {
  if (wrapTag === 'ul' || wrapTag === 'ol' || wrapTag === 'menu') return parentTag === 'UL' || parentTag === 'OL' || parentTag === 'MENU';
  if (wrapTag === 'dl') return parentTag === 'DL';
  if (wrapTag === 'figure') return parentTag === 'FIGURE';
  if (wrapTag === 'details') return parentTag === 'DETAILS';
  return true;
}
function destinationAllowsChild(parent, childTag) {
  if (!parent) return false;
  const tag = parent.tagName;
  if (tag === 'UL' || tag === 'OL' || tag === 'MENU') return childTag === 'LI';
  if (tag === 'DL') return childTag === 'DT' || childTag === 'DD';
  if (tag === 'TABLE' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT' || tag === 'TR' || tag === 'COLGROUP') return false;
  if (tag === 'DETAILS' && childTag === 'SUMMARY') return !parent.querySelector(':scope > summary');
  if (tag === 'FIGURE' && childTag === 'FIGCAPTION') return !parent.querySelector(':scope > figcaption');
  return true;
}
function contextContainerIsEmpty(container) {
  if (!container) return false;
  if (container.tagName === 'UL' || container.tagName === 'OL' || container.tagName === 'MENU') return !container.querySelector(':scope > li');
  if (container.tagName === 'DL') return !container.querySelector(':scope > dt, :scope > dd');
  if (container.tagName === 'FIGURE' || container.tagName === 'DETAILS') return !container.children.length;
  return false;
}

// If the mover is a context element landing outside its container, perform the
// move by wrapping it in a fresh container placed at the drop point. Updates the
// skeleton and mirrors it surgically in the iframe (scroll-preserving). Returns
// 'handled' when it did the move, or null when no wrapping was needed.
function wrappedMoveIfNeeded(movingId, targetId, before) {
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const moving = doc.querySelector(`[data-block-id="${movingId}"]`);
  const target = doc.querySelector(`[data-block-id="${targetId}"]`);
  if (!moving || !target || moving.contains(target)) return null;
  const sourceContainer = moving.parentElement;
  const sourceContainerId = sourceContainer?.getAttribute('data-block-id') || '';
  const wrapTag = contextWrapTag(moving.tagName, moving);
  if (!wrapTag) return null;                       // unconstrained — normal path
  const destParent = target.parentNode;
  if (!destParent) return null;
  if (containerHolds(wrapTag, destParent.tagName)) return null;   // target already in a valid list → normal reorder
  // If the mover is the only child of its own list, and that list is what we'd
  // be dropping beside, moving+rewrapping is a no-op churn — skip.
  const wrapId = freshBlockId('w', doc);
  const wrapper = doc.createElement(wrapTag);
  wrapper.setAttribute('data-block-id', wrapId);
  target.parentNode.insertBefore(wrapper, before ? target : target.nextSibling);
  wrapper.appendChild(moving);
  const emptySource = contextContainerIsEmpty(sourceContainer);
  if (emptySource) { sourceContainer.remove(); dropCommentRefs([sourceContainerId]); }
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton)) return null;
  state.skeleton = nextSkeleton;
  if (emptySource) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'wrap-move', id: movingId, targetId, before: !!before, wrapTag, wrapId, removeEmptyParent: true });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_moved'));
  return 'handled';
}

// Move a block INTO an empty container (cross-container drag). Surgical so the
// initiator keeps their scroll position (no full reload). Remote peers receive
// the structural change and reconcile via applyStructuralPatch.
function moveBlockInto(movingId, containerId, atStart) {
  if (!state.skeleton || !movingId || !containerId || movingId === containerId) return;
  const probe = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const moving = probe.querySelector(`[data-block-id="${movingId}"]`);
  const container = probe.querySelector(`[data-block-id="${containerId}"]`);
  if (!moving || !container) return;
  const requiredContainer = contextWrapTag(moving.tagName, moving);
  if (requiredContainer && !containerHolds(requiredContainer, container.tagName)) return;
  if (container.hasAttribute('data-hce-text')) return;
  if (!destinationAllowsChild(container, moving.tagName)) return;
  const sourceContainer = moving.parentElement;
  const sourceContainerId = sourceContainer?.getAttribute('data-block-id') || '';
  let removedEmptySource = false;
  const result = moveIntoContainer(state.skeleton, movingId, containerId, !!atStart);
  if (!result.moved || result.skeleton === state.skeleton) return;
  state.skeleton = result.skeleton;
  if (sourceContainer && contextWrapTag(moving.tagName, moving)) {
    const movedDoc = new DOMParser().parseFromString(state.skeleton, 'text/html');
    const oldSource = movedDoc.querySelector(`[data-block-id="${sourceContainerId}"]`);
    if (oldSource && contextContainerIsEmpty(oldSource)) { oldSource.remove(); removedEmptySource = true; dropCommentRefs([sourceContainerId]); }
    state.skeleton = '<!DOCTYPE html>\n' + movedDoc.documentElement.outerHTML;
  }
  const collapsed = collapseSparseRows(state.skeleton);
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  if (collapsed.changed || removedEmptySource) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'move-into', id: movingId, containerId, atStart: !!atStart });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_moved'));
}

// Drag a block to another block's left/right edge → place them side by side.
// If the target already sits in a row we created, the mover just joins it;
// otherwise we wrap target + mover in a new flex row. Block ids stay stable
// (only the new row gets a fresh id), so comments/undo keep working.
function placeBeside(movingId, targetId, side) {
  if (!state.skeleton || !movingId || !targetId || movingId === targetId) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const moving = doc.querySelector(`[data-block-id="${movingId}"]`);
  const target = doc.querySelector(`[data-block-id="${targetId}"]`);
  if (!moving || !target) return;
  if (moving.contains(target) || target.contains(moving)) return;   // would nest into itself
  // A flex row cannot legally contain bare context-sensitive elements such
  // as li/dt/dd/figcaption/summary. Their regular move path wraps them in the
  // required semantic container; ignore this alternate edge-drop path.
  if (contextWrapTag(moving.tagName, moving)) return;
  const destinationParent = target.parentElement;
  if (!destinationAllowsChild(destinationParent, 'DIV')) return;
  let row;
  let newRow = false;
  if (target.parentElement && target.parentElement.hasAttribute('data-hce-row')) {
    row = target.parentElement;
    if (side === 'left') row.insertBefore(moving, target);
    else row.insertBefore(moving, target.nextSibling);
  } else {
    newRow = true;
    row = doc.createElement('div');
    row.setAttribute('data-block-id', freshBlockId('r', doc));
    row.setAttribute('data-hce-row', '1');
    row.setAttribute('style', 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin:12px 0;');
    target.parentNode.insertBefore(row, target);
    if (side === 'left') { row.appendChild(moving); row.appendChild(target); }
    else { row.appendChild(target); row.appendChild(moving); }
  }

  row.style.display = 'flex';
  row.style.gap = '16px';
  row.style.alignItems = 'flex-start';
  row.style.flexWrap = 'wrap';
  row.style.margin = '12px 0';

  // Make all row children share width as adaptive columns.
  const rowKids = Array.from(row.children || []).filter(c => c && c.nodeType === 1 && c.hasAttribute('data-block-id'));
  rowKids.forEach(c => {
    if (!c.hasAttribute('data-hce-row-original-style')) {
      const originalLayout = {
        flex: c.style.flex, minWidth: c.style.minWidth, width: c.style.width,
        maxWidth: c.style.maxWidth, marginLeft: c.style.marginLeft,
        height: c.style.height, aspectRatio: c.style.aspectRatio, objectFit: c.style.objectFit,
      };
      c.setAttribute('data-hce-row-original-style', encodeURIComponent(JSON.stringify(originalLayout)));
    }
    c.style.flex = '1 1 260px';
    c.style.minWidth = '0';
    c.style.width = 'auto';
    c.style.maxWidth = 'none';
    c.style.marginLeft = '';
    if (c.tagName === 'IMG' || c.tagName === 'VIDEO') {
      c.style.width = '100%'; c.style.height = 'auto'; c.style.maxWidth = '100%';
      c.style.aspectRatio = ''; c.style.objectFit = '';
    }
  });

  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const collapsed = collapseSparseRows(nextSkeleton);
  if (!validateCandidateDocument(collapsed.skeleton)) return;
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  // Surgical: move the LIVE nodes (keeps scroll + contenteditable bindings).
  if (!collapsed.changed) sendToIframe({
    cmd: 'place-beside', newRow,
    rowId: row.getAttribute('data-block-id'),
    rowStyle: row.getAttribute('style') || '',
    movingId, targetId, side,
    movingStyle: moving.getAttribute('style') || '',
    targetStyle: target.getAttribute('style') || '',
    rowChildren: rowKids.map(c => ({
      id: c.getAttribute('data-block-id'),
      style: c.getAttribute('style') || '',
    })),
  });
  else { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_beside'));
}

function collapseSparseRows(skeleton) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  let changed = false;
  const removedIds = [];
  doc.querySelectorAll('[data-hce-row]').forEach(row => {
    const children = Array.from(row.children).filter(child => child.hasAttribute?.('data-block-id'));
    if (children.length > 1) return;
    if (children.length === 1) {
      const child = children[0];
      const stored = child.getAttribute('data-hce-row-original-style');
      let original = null;
      try { original = JSON.parse(decodeURIComponent(stored || '')); } catch {}
      if (original) {
        const isMedia = child.tagName === 'IMG' || child.tagName === 'VIDEO';
        const systemWidth = isMedia ? '100%' : 'auto';
        const userResized = child.style.width !== systemWidth ||
          (isMedia && child.style.height !== 'auto');
        // Flex/min-width are always row-owned. Size-related fields are restored
        // only while they still equal our system values; a user resize made
        // while side-by-side must survive the later unwrap.
        child.style.flex = original.flex || '';
        child.style.minWidth = original.minWidth || '';
        if (!userResized) {
          for (const property of ['width', 'maxWidth', 'marginLeft', 'height', 'aspectRatio', 'objectFit']) {
            child.style[property] = original[property] || '';
          }
        }
      }
      child.removeAttribute('data-hce-row-original-style');
      row.parentNode?.insertBefore(child, row);
    }
    const rowId = row.getAttribute('data-block-id');
    if (rowId) removedIds.push(rowId);
    row.remove();
    changed = true;
  });
  return {
    skeleton: changed ? '<!DOCTYPE html>\n' + doc.documentElement.outerHTML : skeleton,
    changed,
    removedIds,
  };
}

function dropCommentRefs(ids) {
  if (!ids?.length) return;
  const removed = new Set(ids);
  let changed = false;
  Object.entries(state.comments).forEach(([id, comment]) => {
    const refs = (comment.refs || []).filter(ref => !removed.has(ref.id));
    if (refs.length === (comment.refs || []).length) return;
    changed = true;
    if (!refs.length && !comment.general) {
      delete state.comments[id];
      state.collab?.onLocalCommentDelete?.(id);
    } else {
      const updated = { ...comment, refs };
      state.comments[id] = updated;
      state.collab?.onLocalCommentAdd?.(updated);
    }
  });
  if (changed) renderComments();
}

// Switch a media block between image and video. Same tag → just set the source;
// otherwise build a fresh <img>/<video>, carry over the block id + inline style
// (minus aspect-ratio, which was tied to the old kind), and swap it in place.
// Surgical for the initiator (replace-element); applyStructuralPatch detects the
// tag change so remote collaborators swap too.
function swapMediaType(id, kind, src, embed) {
  if (!state.skeleton || !id || !src) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${id}"]`);
  if (!el) return;
  // A hosted video (YouTube / Vimeo / Bilibili) plays only in an <iframe> embed,
  // not a <video>. Replace the placeholder with a responsive 16:9 embed. It's
  // stored in the skeleton, so it syncs, survives refresh, and rides along in
  // the downloaded HTML — the video plays wherever the file is opened.
  if (embed) {
    const frame = doc.createElement('iframe');
    frame.setAttribute('data-block-id', id);
    frame.setAttribute('data-hce-video', 'embed');
    frame.setAttribute('src', src);
    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('loading', 'lazy');
    const base = (el.getAttribute('style') || '').replace(/aspect-ratio\s*:[^;]*;?/gi, '').trim();
    frame.setAttribute('style', (base ? base + ';' : '') + 'display:block;width:100%;max-width:560px;aspect-ratio:16/9;height:auto;border:0;border-radius:8px;margin:12px 0;');
    el.replaceWith(frame);
    const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    if (!validateCandidateDocument(nextSkeleton)) return;
    state.skeleton = nextSkeleton;
    sendToIframe({ cmd: 'replace-element', id, html: frame.outerHTML });
    state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
    markSaving();
    toast(t('t_video_added'));
    return;
  }
  const newTag = kind === 'video' ? 'video' : 'img';
  if (el.tagName.toLowerCase() === newTag) {   // same kind — reuse the source path
    if (persistMediaSrc(id, src)) sendToIframe({ cmd: 'set-media-src', id, src });
    return;
  }
  const nu = doc.createElement(newTag);
  nu.setAttribute('data-block-id', id);
  const style = (el.getAttribute('style') || '').replace(/aspect-ratio\s*:[^;]*;?/gi, '').trim();
  if (style) nu.setAttribute('style', style);
  if (newTag === 'video') { nu.setAttribute('controls', ''); nu.setAttribute('playsinline', ''); }
  nu.setAttribute('src', src);
  el.replaceWith(nu);
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton)) return;
  state.skeleton = nextSkeleton;
  sendToIframe({ cmd: 'replace-element', id, html: nu.outerHTML });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t(kind === 'video' ? 't_video_added' : 't_img_added'));
}

function deleteBlock(rawId) {
  const elementId = resolveStructuralTarget(rawId);
  if (isLastTableRow(elementId)) { toast(t('t_last_row')); return; }
  if (isUnsafeMergedTableRow(elementId)) { toast(t('t_merged_table')); return; }
  const { skeleton, removedIds } = removeElementFromSkeleton(state.skeleton, elementId);
  state.skeleton = skeleton;
  const collapsed = collapseSparseRows(state.skeleton);
  state.skeleton = collapsed.skeleton;
  dropCommentRefs(collapsed.removedIds);
  const removedSet = new Set(removedIds);
  state.blocks = state.blocks.filter(b => !removedSet.has(b.id));
  refreshCapacityAndLocalDraft();

  // Drop comments anchored solely to removed elements
  Object.entries(state.comments).forEach(([cid, c]) => {
    const refs = (c.refs || []).filter(r => !removedSet.has(r.id));
    if (refs.length === 0 && !c.general) {
      delete state.comments[cid];
      state.collab?.onLocalCommentDelete?.(cid);
    } else if (refs.length !== (c.refs || []).length) {
      c.refs = refs;
      state.collab?.onLocalCommentAdd?.(c);   // upsert
    }
  });

  // Tell the iframe to drop the node immediately (no full re-render flash)
  if (collapsed.changed) { clearStyleChronologyAfterIframeReload(); renderIframe(); }
  else sendToIframe({ cmd: 'remove-element', id: elementId });

  // Sync skeleton over collab if we have it
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);

  renderComments();
  toast(t('t_removed'));
}

function isLastTableRow(elementId) {
  if (!state.skeleton || !elementId) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const row = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!row || row.tagName !== 'TR') return false;
  const table = row.closest('table');
  return !!table && Array.from(table.rows).filter(item => item.closest('table') === table).length <= 1;
}

function isUnsafeMergedTableRow(elementId) {
  if (!state.skeleton || !elementId) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const target = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!target || target.tagName !== 'TR') return false;
  const table = target.closest('table');
  if (!table) return false;
  if (table.querySelector('colgroup')) return true;
  return Array.from(table.rows || []).some(row => row.closest('table') === table &&
    Array.from(row.cells || []).some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1));
}

// ─── Share + Export ─────────────────────────────
window.toggleShareMenu = function (e) {
  e.stopPropagation();
  const menu = document.getElementById('share-menu');
  const willShow = !menu.classList.contains('show');
  // close other popovers
  document.getElementById('export-menu')?.classList.remove('show');
  menu.classList.toggle('show', willShow);
  if (willShow) {
    const input = document.getElementById('share-url');
    input.value = location.href;
    setTimeout(() => { input.select(); }, 30);
    const copy = document.getElementById('share-copy');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(input.value); }
      catch { input.select(); document.execCommand('copy'); }
      copy.textContent = t('copied');
      setTimeout(() => { copy.textContent = t('copy'); }, 1400);
    };
  }
};

window.toggleExportMenu = function (e) {
  e.stopPropagation();
  document.getElementById('export-menu').classList.toggle('show');
};

const liveStateRequests = new Map();
let liveStateSeq = 0;
let stateRevision = 0;
function formOwnerKey(el) {
  const owner = el?.form || el?.closest?.('form');
  return owner?.getAttribute('data-block-id') || owner?.getAttribute('id') || '';
}
function collectLiveState(attempt = 0) {
  const requestId = 'live-' + Date.now() + '-' + (++liveStateSeq);
  return new Promise(resolve => {
    // A remote Yjs transaction can land between request and response. Keep a
    // revision token and retry instead of writing an older iframe snapshot
    // back over the collaborator's newer state.
    const request = { revision: stateRevision, resolve, timer: null, attempt };
    request.timer = setTimeout(() => {
      if (liveStateRequests.get(requestId) !== request) return;
      liveStateRequests.delete(requestId);
      resolve(false);
    }, 2000);
    liveStateRequests.set(requestId, request);
    sendToIframe({ cmd: 'collect-live-state', requestId });
  });
}
function restoreRejectedLiveState(snapshot, skeleton, blocks) {
  const previousDoc = new DOMParser().parseFromString(skeleton, 'text/html');
  const previousTexts = new Map(blocks.map(block => [block.id, block.text || '']));
  (snapshot.texts || []).forEach(item => {
    const el = previousDoc.querySelector(`[data-block-id=\"${item.id}\"]`);
    if (el?.tagName === 'TEXTAREA' || !previousTexts.has(item.id)) return;
    sendToIframe({ cmd: 'set-block-text', id: item.id, text: previousTexts.get(item.id), force: true });
  });
  (snapshot.controls || []).forEach(control => {
    const el = previousDoc.querySelector(`[data-block-id=\"${control.id}\"]`);
    if (!el) return;
    const previous = formControlStateFromElement(el, previousDoc);
    if (!previous) return;
    if (el.tagName === 'TEXTAREA') previous.value = previousTexts.get(control.id) || '';
    sendToIframe({ cmd: 'set-form-control', id: control.id, control: previous });
  });
}
function mergeLiveFormControl(doc, blocks, control) {
  if (!control?.id) return false;
  const el = doc.querySelector(`[data-block-id=\"${control.id}\"]`);
  if (!el) return false;
  if (control.tag === 'textarea' && el.tagName === 'TEXTAREA') {
    const block = blocks.find(item => item.id === control.id);
    const value = String(control.value ?? '');
    if (!block || block.text === value) return false;
    block.text = value;
    return true;
  }
  if (control.tag === 'input' && el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'file' || type === 'password') return false;
    let changed = false;
    if (type === 'checkbox' || type === 'radio') {
      if (type === 'radio' && control.checked && el.name) {
        const owner = formOwnerKey(el);
        doc.querySelectorAll('input[type=\"radio\"]').forEach(other => {
          const otherOwner = formOwnerKey(other);
          if (other !== el && other.name === el.name && otherOwner === owner && other.hasAttribute('checked')) {
            other.removeAttribute('checked');
            changed = true;
          }
        });
      }
      if (!!control.checked !== el.hasAttribute('checked')) {
        if (control.checked) el.setAttribute('checked', ''); else el.removeAttribute('checked');
        changed = true;
      }
    } else {
      const value = String(control.value ?? '');
      // Compare the reflected property so an untouched empty input does not
      // gain value=\"\" and create a phantom undo step merely by exporting.
      const currentValue = el.getAttribute('value') || '';
      if (currentValue !== value) { el.setAttribute('value', value); changed = true; }
    }
    return changed;
  }
  if (control.tag === 'select' && el.tagName === 'SELECT') {
    const selected = new Set((control.selected || []).filter(index =>
      Number.isInteger(index) && index >= 0 && index < el.options.length
    ));
    // Compare effective selection, including the browser's implicit first
    // option for a single-select with no selected attribute. This keeps a
    // plain export of an untouched select from creating a ghost undo item.
    const current = Array.from(el.options).map((option, index) =>
      option.selected ? index : -1
    ).filter(index => index >= 0);
    if (current.length === selected.size && current.every(index => selected.has(index))) return false;
    Array.from(el.options).forEach((option, index) => {
      if (selected.has(index)) option.setAttribute('selected', ''); else option.removeAttribute('selected');
    });
    return true;
  }
  return false;
}
function resolveLiveStateSnapshot(snapshot) {
  const request = liveStateRequests.get(snapshot.requestId);
  if (!request) return;
  liveStateRequests.delete(snapshot.requestId);
  clearTimeout(request.timer);
  if (request.revision !== stateRevision) {
    if (request.attempt >= 3) request.resolve(false);
    else collectLiveState(request.attempt + 1).then(request.resolve);
    return;
  }
  const previousSkeleton = state.skeleton;
  const previousBlocks = state.blocks.map(block => ({ ...block }));
  const nextBlocks = previousBlocks.map(block => ({ ...block }));
  const textMap = new Map((snapshot.texts || []).map(item => [item.id, item.text]));
  let changed = false;
  nextBlocks.forEach(block => {
    if (!textMap.has(block.id)) return;
    const text = String(textMap.get(block.id) ?? '');
    if (block.text !== text) { block.text = text; changed = true; }
  });
  const doc = new DOMParser().parseFromString(previousSkeleton, 'text/html');
  (snapshot.controls || []).forEach(control => {
    if (mergeLiveFormControl(doc, nextBlocks, control)) changed = true;
  });
  // The original/absent doctype is carried by the root marker installed by
  // parser.js. Re-serializing the DOM keeps that marker; export restores the
  // exact source declaration.
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const result = inspectAndValidateDocument(reassembleHTML(nextSkeleton, nextBlocks));
  if (result.issue) {
    reportCapacityIssue(result);
    restoreRejectedLiveState(snapshot, previousSkeleton, previousBlocks);
    request.resolve(false);
    return;
  }
  state.skeleton = nextSkeleton;
  state.blocks = nextBlocks;
  state.documentBytes = result.totalBytes;
  if (changed) {
    // Export must not swallow the pending 180 ms debounce. Publish every text
    // and control value as one tracked transaction, then persist the same
    // snapshot locally. One Cmd/Ctrl+Z reverts the complete captured action.
    state.collab?.persistTrackedSkeleton?.(state.skeleton, state.blocks);
    markSaving();
  }
  request.resolve(true);
}
function documentMayRenderDifferently() {
  if (!state.skeleton) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const executableScript = Array.from(doc.querySelectorAll('script')).some(script => {
    const type = (script.getAttribute('type') || '').trim().split(';', 1)[0].toLowerCase();
    return !type || type === 'module' || /^(?:application|text)\/(?:java|ecma)script$/.test(type);
  });
  if (executableScript || doc.querySelector('object, embed, base, iframe[srcdoc]')) return true;
  if (Array.from(doc.querySelectorAll('meta[http-equiv]')).some(meta =>
    /^(?:refresh|content-security-policy)$/i.test(meta.getAttribute('http-equiv') || '')
  )) return true;
  return Array.from(doc.querySelectorAll('*')).some(el => {
    if (el.tagName === 'IFRAME') {
      const src = el.getAttribute('src') || '';
      if (src && !/^https?:\/\//i.test(src)) return true;
    }
    return Array.from(el.attributes).some(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') && name in el) return true;
      if (name === 'srcdoc') return true;
      if (['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'].includes(name)) {
        return !isSafePreviewUrl(attr.value, name, el.tagName);
      }
      return false;
    });
  });
}
function confirmPreviewDifference(kind) {
  return !documentMayRenderDifferently() || window.confirm(t(kind === 'ai' ? 't_dynamic_ai' : 't_dynamic_download'));
}

window.exportHTML = async function () {
  document.getElementById('export-menu').classList.remove('show');
  if (!await collectLiveState()) { toast(t('t_export_sync_failed')); return; }
  if (!confirmPreviewDifference('download')) return;
  const html = reassembleHTML(state.skeleton, state.blocks);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = state.filename || 'document.html'; a.click();
  URL.revokeObjectURL(url);
  toast(t('t_downloaded') + (state.filename || 'document.html'));
};

window.exportForAI = async function () {
  document.getElementById('export-menu').classList.remove('show');
  if (!await collectLiveState()) { toast(t('t_export_sync_failed')); return; }
  if (!confirmPreviewDifference('ai')) return;
  const html = reassembleHTML(state.skeleton, state.blocks);
  const prompt = buildExportPrompt(html, Object.values(state.comments));
  document.getElementById('export-text').value = prompt;
  document.getElementById('export-modal-bg').classList.add('show');
};
window.closeExport = function () {
  document.getElementById('export-modal-bg').classList.remove('show');
};
window.copyExport = function () {
  const ta = document.getElementById('export-text');
  ta.select();
  navigator.clipboard.writeText(ta.value)
    .then(() => toast(t('copied')))
    .catch(() => { document.execCommand('copy'); toast(t('copied')); });
};

window.downloadExportMd = function () {
  const text = document.getElementById('export-text').value;
  // Filename: strip .html and append a date stamp so repeated exports don't
  // collide on disk.
  const base = (state.filename || 'document').replace(/\.html?$/i, '');
  const stamp = new Date().toISOString().slice(0, 10);    // YYYY-MM-DD
  const name = `${base}--for-ai-${stamp}.md`;
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  toast(t('t_downloaded') + name);
};

// ─── Undo / redo — chronological log of ALL local actions ─────────────
//
//   undoStack mirrors the Yjs UndoManager 1:1 for text / structural /
//   comment actions: we push exactly one entry whenever Yjs adds a new
//   undo stack-item (see wireUndoToCollab). On top of that we add 'style'
//   entries for in-iframe style changes (which never touch Yjs).
//   ⌘Z pops the top and dispatches:
//     - 'style' → asks the iframe to undo its style-history stack
//     - 'yjs'   → delegates to the Yjs UndoManager via state.collab
//   Empty stack is a no-op (the page DOES NOT go blank).
//   Per-user — collaborators only undo their own changes.
//
//   Why mirror Yjs instead of counting actions ourselves: the old approach
//   guessed action boundaries with a time window that didn't match Yjs's
//   captureTimeout, so the two stacks drifted apart — most visibly for a
//   collaborator whose edit timing is jittery — and a single ⌘Z would only
//   partially undo. Mirroring keeps them exactly aligned.
const undoStack = [];
const redoStack = [];
let applyingUndoRedo = false;       // true while we drive collab.undo/redo

function clearStyleChronologyAfterIframeReload() {
  // Style history stores live iframe element references. A full iframe reload
  // invalidates those references; keeping their parent entries would create
  // ghost undos. Drop only style entries, preserving text/structure history.
  for (let i = undoStack.length - 1; i >= 0; i--) if (undoStack[i].type === 'style') undoStack.splice(i, 1);
  for (let i = redoStack.length - 1; i >= 0; i--) if (redoStack[i].type === 'style') redoStack.splice(i, 1);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
function localHistorySnapshot() {
  return {
    skeleton: state.skeleton,
    blocks: state.blocks.map(block => ({ ...block })),
    comments: clonePlain(state.comments || {}),
    filename: state.filename,
  };
}
function sameLocalSnapshot(a, b) {
  if (!a || !b || a.skeleton !== b.skeleton || a.filename !== b.filename ||
      a.blocks.length !== b.blocks.length) return false;
  for (let i = 0; i < a.blocks.length; i++) {
    const x = a.blocks[i], y = b.blocks[i];
    if (x.id !== y.id || x.tag !== y.tag || x.text !== y.text) return false;
  }
  return JSON.stringify(a.comments) === JSON.stringify(b.comments);
}
function createLocalHistory() {
  let current = localHistorySnapshot();
  const localUndo = [];
  const localRedo = [];
  const addedListeners = [];
  const changeListeners = [];
  let lastRecordAt = 0;
  let pendingRecord = false;
  let pendingBoundary = false;
  let droppedUndoItems = 0;

  const historyLimit = () => Math.max(2, Math.min(50,
    Math.floor((24 * 1024 * 1024) / Math.max(1, state.documentBytes || 1))));
  function notifyAdded() {
    addedListeners.forEach(callback => callback({ type: 'undo' }));
    changeListeners.forEach(callback => callback());
  }
  function record(boundary) {
    pendingRecord = false;
    const next = localHistorySnapshot();
    if (sameLocalSnapshot(current, next)) { current = next; pendingBoundary = false; return; }
    const now = Date.now();
    const merge = !boundary && lastRecordAt && now - lastRecordAt <= 750 && localUndo.length;
    if (!merge) {
      localUndo.push(current);
      while (localUndo.length > historyLimit()) { localUndo.shift(); droppedUndoItems++; }
      notifyAdded();
    }
    current = next;
    localRedo.length = 0;
    lastRecordAt = boundary ? 0 : now;
    pendingBoundary = false;
  }
  function scheduleRecord(boundary = false) {
    pendingBoundary ||= boundary;
    if (pendingRecord) return;
    pendingRecord = true;
    queueMicrotask(() => record(pendingBoundary));
  }
  function updateBaseline() {
    queueMicrotask(() => { if (!pendingRecord) current = localHistorySnapshot(); });
  }
  function apply(snapshot) {
    state.skeleton = snapshot.skeleton;
    state.blocks = snapshot.blocks.map(block => ({ ...block }));
    state.comments = clonePlain(snapshot.comments);
    state.filename = snapshot.filename;
    document.getElementById('fname').textContent = state.filename;
    refreshDocumentCapacity();
    setSlidesMode(detectSlides(reassembleHTML(state.skeleton, state.blocks)));
    clearStyleChronologyAfterIframeReload();
    renderIframe();
    renderComments();
    stateRevision++;
    scheduleLocalDraftSave();
  }
  return {
    seeded: false,
    onLocalBlockEdit() { scheduleRecord(false); },
    onLocalStructureChange() { scheduleRecord(true); },
    persistTrackedSkeleton() { scheduleRecord(true); },
    persistStyles() { updateBaseline(); },
    persistMetaSkeleton() { updateBaseline(); },
    onLocalCommentAdd() { scheduleRecord(true); },
    onLocalCommentDelete() { scheduleRecord(true); },
    updateFilename() { scheduleRecord(false); },
    updateUser() {},
    undo() {
      if (!localUndo.length) return;
      localRedo.push(current);
      current = localUndo.pop();
      apply(current);
      changeListeners.forEach(callback => callback());
    },
    redo() {
      if (!localRedo.length) return;
      localUndo.push(current);
      current = localRedo.pop();
      apply(current);
      changeListeners.forEach(callback => callback());
    },
    canUndo() { return localUndo.length > 0; },
    canRedo() { return localRedo.length > 0; },
    stopCapturing() { lastRecordAt = 0; pendingBoundary = true; },
    onYjsStackAdded(callback) { addedListeners.push(callback); },
    onYjsStackPopped() {},
    onStackChange(callback) { changeListeners.push(callback); },
    takeDroppedUndoItems() { const count = droppedUndoItems; droppedUndoItems = 0; return count; },
    isConnected() { return false; },
    disconnect() {},
  };
}

// Wire the chronological stack to the real Yjs UndoManager. Called once,
// right after collab connects.
function wireUndoToCollab() {
  state.collab?.onYjsStackAdded?.(({ type }) => {
    // Ignore items our own undo/redo produces (e.g. the redo item created
    // while undoing). Only brand-new user actions — added to the UNDO stack
    // outside an undo/redo — get logged.
    if (applyingUndoRedo) return;
    if (type !== 'undo') return;
    undoStack.push({ type: 'yjs' });
    const dropped = state.collab?.takeDroppedUndoItems?.() || 0;
    for (let i = 0; i < dropped; i++) {
      const index = undoStack.findIndex(item => item.type === 'yjs');
      if (index >= 0) undoStack.splice(index, 1);
    }
    redoStack.length = 0;
  });
}

// Write the iframe's inline-style changes back into state.skeleton and persist
// them over collab (STYLE_ORIGIN) so they survive a refresh and reach others.
function persistStyleChanges(styles) {
  if (!state.skeleton || !styles || !styles.length) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  let changed = false;
  styles.forEach(({ id, style }) => {
    const el = doc.querySelector(`[data-block-id="${id}"]`);
    if (!el) return;
    const cur = el.getAttribute('style') || '';
    const next = style || '';
    if (next) {
      if (cur !== next) { el.setAttribute('style', next); changed = true; }
    } else if (el.hasAttribute('style')) {
      el.removeAttribute('style'); changed = true;
    }
  });
  if (!changed) return false;
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton)) { renderIframe(); return false; }
  state.skeleton = nextSkeleton;
  state.collab?.persistStyles?.(styles);
  markSaving();
  return true;
}

function formControlStateFromElement(el, sourceDoc) {
  if (!el) return null;
  if (el.tagName === 'INPUT') {
    return {
      tag: 'input',
      value: sourceDoc ? el.value : (el.getAttribute('value') || ''),
      checked: sourceDoc ? !!el.checked : el.hasAttribute('checked'),
    };
  }
  if (el.tagName === 'TEXTAREA') {
    const id = el.getAttribute('data-block-id');
    const liveValue = sourceDoc ? el.value : null;
    return { tag: 'textarea', value: liveValue != null ? liveValue : (state.blocks.find(b => b.id === id)?.text || '') };
  }
  if (el.tagName === 'SELECT') {
    const selectedIndexes = Array.from(el.options).map((option, index) =>
      (sourceDoc ? option.selected : option.hasAttribute('selected')) ? index : -1
    ).filter(index => index >= 0);
    if (!sourceDoc && !el.multiple && !selectedIndexes.length && el.options.length) selectedIndexes.push(0);
    return {
      tag: 'select',
      selected: selectedIndexes,
    };
  }
  return null;
}
function persistFormControl(control, options = {}) {
  if (!control?.id || !state.skeleton) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const nextBlocks = state.blocks.map(block => ({ ...block }));
  // Debounced input/change events may arrive after an export snapshot already
  // persisted the same value. Treat exact repeats as no-ops; Y.Map.set with an
  // identical string still creates an UndoManager item.
  if (!mergeLiveFormControl(doc, nextBlocks, control)) return;
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (options.validate !== false && !validateCandidateDocument(nextSkeleton, nextBlocks)) {
    sendToIframe({ cmd: 'set-form-control', id: control.id, control: formControlStateFromElement(
      new DOMParser().parseFromString(state.skeleton, 'text/html').querySelector(`[data-block-id="${control.id}"]`)
    ) });
    return;
  }
  state.skeleton = nextSkeleton;
  state.blocks = nextBlocks;
  if (options.sync !== false) {
    state.collab?.persistTrackedSkeleton?.(state.skeleton, state.blocks);
  }
  if (options.notify !== false) markSaving();
}

function applyRemoteStyles(styles) {
  if (!state.skeleton || !Array.isArray(styles)) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const applied = [];
  styles.forEach(({ id, style }) => {
    const el = doc.querySelector(`[data-block-id="${id}"]`);
    if (!el) return;
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
    applied.push({ id, style: style || '' });
  });
  if (!applied.length) return true;
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const result = inspectAndValidateDocument(reassembleHTML(nextSkeleton, state.blocks));
  if (result.issue) {
    toast(t('t_remote_too_big'));
    return false;
  }
  state.skeleton = nextSkeleton;
  state.documentBytes = result.totalBytes;
  applied.forEach(({ id, style }) => sendToIframe({ cmd: 'set-style', id, style }));
  return true;
}

function imageCapacityBudget(replacingId = null) {
  const html = reassembleHTML(state.skeleton, state.blocks);
  const stats = inspectDocumentCapacity(html);
  let replacedBytes = 0;
  if (replacingId) {
    const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
    const current = doc.querySelector(`[data-block-id="${replacingId}"]`)?.getAttribute('src') || '';
    if (isInlineRasterImage(current)) replacedBytes = utf8ByteLength(current);
  }
  const mediaRoom = MAX_INLINE_MEDIA_BYTES - stats.inlineMediaBytes + replacedBytes;
  const documentRoom = MAX_DOCUMENT_BYTES - stats.totalBytes + replacedBytes;
  return Math.floor(Math.max(0, Math.min(MAX_INLINE_IMAGE_BYTES, mediaRoom, documentRoom)));
}

function imageCompressionToast(error) {
  const key = error?.code === 'ANIMATED_IMAGE_TOO_LARGE' ? 't_image_animation_link'
    : error?.code === 'IMAGE_SOURCE_TOO_LARGE' ? 't_image_source_too_large'
    : error?.code === 'IMAGE_CAPACITY_TOO_SMALL' ? 't_image_no_room'
    : 't_image_compress_failed';
  toast(t(key));
}

async function fitIncomingImage(source, replacingId = null) {
  const isFile = typeof Blob !== 'undefined' && source instanceof Blob;
  if (!isFile && !isInlineRasterImage(source)) return source;
  const budget = imageCapacityBudget(replacingId);
  try {
    const result = isFile
      ? await compressImageFile(source, { maxDataUrlBytes: budget })
      : await compressImageDataUrl(source, { maxDataUrlBytes: budget });
    if (result.compressed) toast(t('t_image_compressed'));
    return result.dataUrl;
  } catch (error) {
    imageCompressionToast(error);
    return null;
  }
}

// Write a newly-supplied media source (data-URI or URL) into the skeleton so
// it persists across refresh, syncs to collaborators, and exports with the doc.
function persistMediaSrc(id, src) {
  if (!state.skeleton || !id || !src || !isSafePreviewUrl(src, 'src')) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${id}"]`);
  if (!el) return false;
  if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') el.querySelectorAll('source').forEach(s => s.removeAttribute('src'));
  el.setAttribute('src', src);
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton)) return false;
  state.skeleton = nextSkeleton;
  // Route through the TRACKED structural path (LOCAL_ORIGIN) — NOT
  // persistSkeleton (STYLE_ORIGIN, invisible to the UndoManager) — so an
  // uploaded or replaced image/video is a discrete, undoable step. blocks are
  // unchanged (same text leaves); only the src attribute moved. stopCapturing
  // makes it its own undo entry instead of merging with an adjacent edit.
  state.collab?.stopCapturing?.();
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  return true;
}

// Write a text link's href + visible text into the skeleton (persist/sync/export).
function persistLink(id, href, text) {
  if (!state.skeleton || !id || !href || !isSafePreviewUrl(href, 'href')) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${id}"]`);
  if (!el || el.tagName !== 'A') return false;
  el.setAttribute('href', href);
  const nextText = (typeof text === 'string' && text) ? text : href;
  el.textContent = '';
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const nextBlocks = state.blocks.map(b => b.id === id ? { ...b, text: nextText } : b);
  if (!validateCandidateDocument(nextSkeleton, nextBlocks)) return false;
  state.skeleton = nextSkeleton;
  // Commit href + visible text through one Yjs transaction. Sending the text
      // through a separate text transaction first created another stack item, so one link
  // edit needed two undos and briefly exposed a mismatched href/text to peers.
  state.blocks = nextBlocks;
  state.collab?.persistTrackedSkeleton?.(state.skeleton, state.blocks);
  markSaving();
  return true;
}

// Write (or clear) a whole-block link (data-hce-href) into the skeleton so a
// link bound to a card / cell / heading survives refresh, syncs to peers, and
// exports with the doc. An empty href removes the binding.
function persistBlockLink(id, href) {
  if (!state.skeleton || !id) return false;
  if (href && !isSafePreviewUrl(href, 'href')) return false;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${id}"]`);
  if (!el) return false;
  if (href) el.setAttribute('data-hce-href', href);
  else el.removeAttribute('data-hce-href');
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton)) return false;
  state.skeleton = nextSkeleton;
  state.collab?.persistTrackedSkeleton?.(state.skeleton, state.blocks);
  markSaving();
  return true;
}

// Turn an inline text link (<a data-hce-link>) back into plain text, in place.
// Links now live only on whole elements (data-hce-href); this lets users cancel
// a leftover inline link by unwrapping it into an ordinary editable text span.
function unlinkInline(id) {
  if (!state.skeleton || !id) return;
  const doc = new DOMParser().parseFromString(state.skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${id}"]`);
  if (!el || el.tagName !== 'A') return;
  const text = state.blocks.find(b => b.id === id)?.text || el.textContent || '';
  const span = doc.createElement('span');
  const sid = freshBlockId('s', doc);
  span.setAttribute('data-block-id', sid);
  span.setAttribute('data-hce-text', '1');
  span.textContent = text;
  el.parentNode.replaceChild(span, el);
  const nextBlocks = state.blocks.filter(b => b.id !== id).concat([{ id: sid, tag: 'span', text }]);
  const liveHTML = span.outerHTML;
  span.textContent = '';
  const nextSkeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  if (!validateCandidateDocument(nextSkeleton, nextBlocks)) return;
  state.blocks = nextBlocks;
  state.skeleton = nextSkeleton;
  sendToIframe({ cmd: 'replace-element', id, html: liveHTML });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast(t('t_removed'));
}

function logStyleAction() {
  // A style change is its own undo step; break Yjs's capture window so a
  // text edit can't merge across it and scramble the chronological order.
  state.collab?.stopCapturing?.();
  undoStack.push({ type: 'style' });
  redoStack.length = 0;
}
function performUndo() {
  // Fallback: if our chronological mirror missed an entry (race/timing),
  // still honor Yjs undo so local structural edits remain undoable.
  if (!undoStack.length) {
    if (state.collab?.canUndo?.()) {
      applyingUndoRedo = true;
      state.collab?.undo?.();
      applyingUndoRedo = false;
    }
    return;
  }
  const top = undoStack.pop();
  if (top.type === 'style') {
    sendToIframe({ cmd: 'undo-style' });
  } else {
    applyingUndoRedo = true;
    state.collab?.undo?.();
    applyingUndoRedo = false;
  }
  redoStack.push(top);
}
function performRedo() {
  // Symmetric fallback for redo in case mirror entries were missed.
  if (!redoStack.length) {
    if (state.collab?.canRedo?.()) {
      applyingUndoRedo = true;
      state.collab?.redo?.();
      applyingUndoRedo = false;
    }
    return;
  }
  const top = redoStack.pop();
  if (top.type === 'style') {
    sendToIframe({ cmd: 'redo-style' });
  } else {
    applyingUndoRedo = true;
    state.collab?.redo?.();
    applyingUndoRedo = false;
  }
  undoStack.push(top);
}

window.doUndo = function () { performUndo(); };
window.doRedo = function () { performRedo(); };

// ─── Save indicator ─────────────────────────────
let saveStateTimer;
function markSaved() {
  const el = document.getElementById('save-state');
  if (!el) return;
  if (state.collab && state.collabConnected) {
    el.innerHTML = '<span class="dot ok"></span>' + t('saved');
  } else {
    el.innerHTML = '<span class="dot offline"></span>' + t('local_only');
  }
  clearTimeout(saveStateTimer);
}
window.__hceMarkSaved = markSaved;

// Local edits → "Saving…" until next remote echo or short delay.
function markSaving() {
  stateRevision++;
  const el = document.getElementById('save-state');
  if (!el) return;
  el.innerHTML = '<span class="dot live"></span>' + t('saving');
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(markSaved, 900);
  scheduleLocalDraftSave();
}

let localDraftTimer;
let localDraftEpoch = 0;
let localDraftQueue = Promise.resolve();

function draftSnapshot() {
  if (!state.keepLocalDraft || state.draftMode === 'none' || !state.roomId || !state.skeleton) return null;
  return {
    roomId: state.roomId,
    html: reassembleHTML(state.skeleton, state.blocks),
    filename: state.filename,
    comments: state.comments,
    kind: state.draftMode === 'handoff' ? 'handoff' : 'recovery',
    editorState: {
      skeleton: state.skeleton,
      blocks: state.blocks,
      // This is descriptive only; recovery drafts never auto-overwrite a room.
      offline: !state.collabConnected,
      roomHydrated: state.roomHydrated,
    },
  };
}

function enqueueDraftSave(snapshot, epoch) {
  if (!snapshot) return;
  localDraftQueue = localDraftQueue
    .catch(() => {})
    .then(() => {
      if (epoch !== localDraftEpoch || !state.keepLocalDraft || state.draftMode === 'none') return;
      return saveDraft(snapshot);
    })
    .catch(() => {});
}

function retireLocalDraft() {
  state.keepLocalDraft = false;
  state.draftMode = 'none';
  clearTimeout(localDraftTimer);
  const epoch = ++localDraftEpoch;
  const roomId = state.roomId;
  // Serialize delete after an already-running save, and invalidate every
  // scheduled callback so an old draft cannot be resurrected afterward.
  localDraftQueue = localDraftQueue
    .catch(() => {})
    .then(() => epoch === localDraftEpoch ? deleteDraft(roomId) : undefined)
    .catch(() => {});
}

async function preserveRecoveryCopy(draft) {
  if (!draft?.html) return null;
  const createdAt = Number(draft.createdAt) || Date.now();
  const recoveredRoomId = state.roomId + '--recovered-' + createdAt;
  const recoveredName = 'Recovered ' + (draft.filename || 'document.html');
  await saveDraft({
    roomId: recoveredRoomId,
    html: draft.html,
    filename: recoveredName,
    comments: draft.comments || {},
    editorState: draft.editorState || null,
    kind: 'recovery',
  });
  touchRecent(recoveredRoomId, recoveredName);
  return recoveredRoomId;
}

function scheduleLocalDraftSave() {
  const epoch = localDraftEpoch;
  if (!draftSnapshot()) return;
  clearTimeout(localDraftTimer);
  localDraftTimer = setTimeout(() => {
    if (epoch !== localDraftEpoch) return;
    enqueueDraftSave(draftSnapshot(), epoch);
  }, 700);
}

window.addEventListener('pagehide', () => {
  clearTimeout(localDraftTimer);
  const epoch = localDraftEpoch;
  enqueueDraftSave(draftSnapshot(), epoch);
});

// ─── Helpers ────────────────────────────────────
function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUserColor(value) {
  const color = String(value || '').toLowerCase();
  return USER_COLORS.includes(color) ? color : USER_COLORS[0];
}

function isValidComment(comment) {
  if (!comment || typeof comment !== 'object') return false;
  if (typeof comment.id !== 'string' || comment.id.length < 1 || comment.id.length > 160) return false;
  if (typeof comment.text !== 'string' || utf8ByteLength(comment.text) > MAX_COMMENT_BYTES) return false;
  if (!comment.author || typeof comment.author !== 'object' ||
      typeof comment.author.id !== 'string' || comment.author.id.length > 160 ||
      typeof comment.author.name !== 'string' || utf8ByteLength(comment.author.name) > 1024 ||
      typeof comment.author.color !== 'string') return false;
  if (!Array.isArray(comment.refs) || comment.refs.length > 500) return false;
  return comment.refs.every(ref => ref && typeof ref === 'object' &&
    typeof ref.id === 'string' && ref.id.length <= 160 &&
    typeof ref.tag === 'string' && ref.tag.length <= 80 &&
    typeof ref.snippet === 'string' && utf8ByteLength(ref.snippet) <= 4096);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(8px)';
  }, 1800);
}

// ─── Expose for collab module ───────────────────
window.__hce = {
  state,
  renderComments,
  sendToIframe,
};

init();
