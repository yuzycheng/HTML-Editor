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

import {
  parseHTML, renderForEditor, reassembleHTML,
  removeElementFromSkeleton, duplicateElementInSkeleton,
  duplicateColumnInSkeleton, removeColumnFromSkeleton, describeElement,
} from './parser.js';
import { buildIframeScript } from './iframe-injection.js';
import { buildExportPrompt } from './export.js';

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
  // Pending comment composer state
  composer: {
    open: false,
    general: false,     // not anchored to any element
    refs: [],           // [{ id, tag, snippet }] — order = click order
  },
};

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

// ─── Init ───────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  state.roomId = params.get('room') || 'local-' + Math.random().toString(36).slice(2, 8);

  // Identity
  state.user = loadUser() || await promptForNickname({ allowCancel: false });
  saveUser(state.user);
  document.getElementById('nick-modal-bg').classList.remove('show');
  renderUsers([state.user]);

  // Initial HTML
  let initialHTML = sessionStorage.getItem('hce-init-html-' + state.roomId);
  state.filename = sessionStorage.getItem('hce-init-name-' + state.roomId) || 'demo.html';
  if (!initialHTML) initialHTML = DEMO_HTML;
  document.getElementById('fname').textContent = state.filename;

  // Bump this room to the top of the user's "recent files" list.
  touchRecent(state.roomId, state.filename);

  const parsed = parseHTML(initialHTML);
  state.skeleton = parsed.skeleton;
  state.blocks = parsed.blocks;
  renderIframe();
  renderComments();

  window.addEventListener('message', handleIframeMessage);

  // Try collab (best-effort)
  if (params.get('collab') !== 'off') {
    try {
      const { connectCollab } = await import('./collab.js');
      state.collab = await connectCollab(state, {
        onBlockTextChange: (id, text) => {
          // While the iframe is being rebuilt due to a structural change,
          // its DOM is mid-flight — sending set-block-text would race with
          // load. The skeleton path delivered the correct end state anyway.
          if (rebuildingIframe) return;
          const b = state.blocks.find(x => x.id === id);
          if (!b) return;
          if (b.text !== text) {
            b.text = text;
            sendToIframe({ cmd: 'set-block-text', id, text });
          }
          markSaved();
        },
        onCommentsChange: () => { renderComments(); markSaved(); },
        onUsersChange: (users) => {
          renderUsers(users);
          const n = users.length || 1;
          document.getElementById('user-count').textContent = n + (n === 1 ? ' user' : ' users');
          document.getElementById('sync-label').textContent = n > 1 ? 'Live' : 'Solo';
        },
        onSkeletonChanged: () => {
          // Try surgical patch first; only full-reload as last resort.
          // The patch preserves scroll, contenteditable, and iframe state —
          // so undo/redo no longer flashes white or scrolls to top.
          const patched = applyStructuralPatch();
          if (!patched) renderIframe();
          renderComments();
          markSaved();
        },
      });
      console.log('[hce] collab connected');
      // [ADDITION] Bridge Yjs UndoManager events into iframe so its actionLog
      // can stay in lockstep with the real Yjs stack (no more guess-timing).
      try {
        state.collab?.onYjsStackAdded?.((event) => {
          sendToIframe({ cmd: 'yjs-stack-added', isRedo: event.type === 'redo' });
        });
        state.collab?.onYjsStackPopped?.((event) => {
          sendToIframe({ cmd: 'yjs-stack-popped', isRedo: event.type === 'redo' });
        });
      } catch (e) {}
    } catch (err) {
      console.warn('[hce] collab disabled (single-user mode):', err.message);
    }
  }

  // Keyboard: ⌘Z / ⌘⇧Z
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.key.toLowerCase() !== 'z') return;
    // Don't hijack if user is typing inside our composer/inputs
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
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

function replaceDocument(file) {
  if (!/\.html?$/i.test(file.name)) { toast('Please drop an .html or .htm file'); return; }
  if (file.size > 2 * 1024 * 1024) { toast('File too large (max 2 MB)'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseHTML(e.target.result);
    state.skeleton = parsed.skeleton;
    state.blocks = parsed.blocks;
    state.filename = file.name;
    document.getElementById('fname').textContent = file.name;
    touchRecent(state.roomId, file.name);
    // Clear comments since they were anchored to the previous doc.
    Object.keys(state.comments).forEach(cid => {
      state.collab?.onLocalCommentDelete?.(cid);
      delete state.comments[cid];
    });
    closeComposer();
    renderIframe();
    renderComments();
    state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
    toast('Replaced with ' + file.name);
  };
  reader.readAsText(file);
}

// ─── User identity ──────────────────────────────
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
    av.style.background = u.color;
    av.style.color = '#fff';
    av.textContent = (u.name || '?').slice(0, 2);
    av.title = u.name + (u.id === state.user.id ? ' (you — click to change)' : '');
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

function renderIframe() {
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
  const injection = buildIframeScript();
  const patched = html.includes('</body>')
    ? html.replace(/<\/body>/i, injection + '</body>')
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
  const iframe = document.getElementById('iframe');
  let iframeDoc;
  try { iframeDoc = iframe.contentDocument; } catch { return false; }
  if (!iframeDoc || !iframeDoc.body) return false;

  const newDoc = new DOMParser().parseFromString(state.skeleton, 'text/html');
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

  // Move detection: if an element's parent ID changed, surgical patch is risky.
  for (const id of newIds) {
    if (!oldIds.has(id)) continue;
    const newEl = newDoc.querySelector(`[data-block-id="${id}"]`);
    const oldEl = iframeDoc.querySelector(`[data-block-id="${id}"]`);
    if (!newEl || !oldEl) continue;
    const newParent = newEl.parentElement && newEl.parentElement.getAttribute('data-block-id');
    const oldParent = oldEl.parentElement && oldEl.parentElement.getAttribute('data-block-id');
    if (newParent && oldParent && newParent !== oldParent) return false;
  }

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
      // Parent is also new — will be inserted later as part of its own ancestor.
      continue;
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

  // 3. Pick up any text content that diverged inside elements that stayed put.
  // (Rare but possible: skeleton's stored text could differ from yBlocks during
  // an undo. The block observer will fire too, but eager-syncing here avoids
  // brief mismatches.)
  state.blocks.forEach(b => {
    sendToIframe({ cmd: 'set-block-text', id: b.id, text: b.text });
  });

  return true;
}

function sendToIframe(data) {
  const iframe = document.getElementById('iframe');
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ _src: 'hce', ...data }, '*');
  }
}

function handleIframeMessage(e) {
  const d = e.data;
  if (!d || !d.type) return;

  if (d.type === 'block-text-change') {
    const block = state.blocks.find(b => b.id === d.id);
    if (block && block.text !== d.text) {
      block.text = d.text;
      state.collab?.onLocalBlockEdit?.(d.id, d.text);
      markSaving();
    }
  }

  if (d.type === 'comment-toggle-select') {
    toggleCommentSelection({ id: d.id, tag: d.tag, snippet: d.snippet });
  }

  if (d.type === 'request-block-delete') {
    deleteBlock(d.id);
  }

  if (d.type === 'request-block-duplicate') {
    duplicateBlock(d.id);
  }

  if (d.type === 'request-column-duplicate') {
    duplicateColumn(d.id);
  }

  if (d.type === 'request-column-delete') {
    deleteColumn(d.id);
  }

  if (d.type === 'ready') {
    pushSelectionToIframe();
    const iframe = document.getElementById('iframe');
    if (pendingScroll) {
      try { iframe.contentWindow?.scrollTo(pendingScroll.x, pendingScroll.y); } catch {}
      pendingScroll = null;
    }
    // Reveal the iframe (we hid it during the reload to suppress flicker).
    iframe.style.visibility = 'visible';
    rebuildingIframe = false;
  }

  if (d.type === 'request-undo') state.collab?.undo?.();
  if (d.type === 'request-redo') state.collab?.redo?.();

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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveComposer(); }
    if (e.key === 'Escape') closeComposer();
  };
}

window.saveComposer = function () {
  const input = document.getElementById('cmt-input');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

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
  state.comments[id] = comment;
  state.collab?.onLocalCommentAdd?.(comment);
  markSaving();

  closeComposer();
  renderComments();
  toast('Comment saved');
};

window.deleteComment = function (id) {
  const c = state.comments[id];
  if (!c) return;
  delete state.comments[id];
  state.collab?.onLocalCommentDelete?.(id);
  renderComments();
};

function renderComments() {
  const list = document.getElementById('cmt-list');
  const all = Object.values(state.comments).sort((a, b) => a.createdAt - b.createdAt);
  document.getElementById('cmt-count').textContent = all.length;

  if (all.length === 0 && !state.composer.open) {
    list.innerHTML = '<div class="sb-empty">Click any element in the document to leave a comment, or use <b>+ General</b> for a note that isn\'t tied to one spot.</div>';
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

    item.innerHTML = `
      <button class="del" title="Delete">×</button>
      <div class="meta">
        <span class="author" style="color:${c.author.color};">${escapeHTML(c.author.name)}</span>
      </div>
      ${tagsHTML}
      <div class="body">${escapeHTML(c.text)}</div>
    `;
    item.onclick = () => {
      if (isGeneral) return;
      const ids = c.refs.map(r => r.id);
      sendToIframe({ cmd: 'flash-refs', ids });
      sendToIframe({ cmd: 'scroll-to', id: ids[0] });
    };
    item.querySelector('.del').onclick = e => {
      e.stopPropagation();
      window.deleteComment(c.id);
    };
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
  let cur = el;
  while (cur && cur !== doc.body) {
    const t = cur.tagName;
    if (t === 'TR' && cur.hasAttribute('data-block-id')) {
      return cur.getAttribute('data-block-id');
    }
    if (t === 'TABLE') break;       // clicked the table itself — leave it alone
    cur = cur.parentElement;
  }
  return elementId;
}

function deleteColumn(cellId) {
  const { skeleton, removedIds } = removeColumnFromSkeleton(state.skeleton, cellId);
  if (!removedIds.length) return;
  state.skeleton = skeleton;
  const gone = new Set(removedIds);
  state.blocks = state.blocks.filter(b => !gone.has(b.id));

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
  toast('Column removed');
}

function duplicateColumn(cellId) {
  const result = duplicateColumnInSkeleton(state.skeleton, cellId, state.blocks);
  if (!result.insertions || result.insertions.length === 0) return;
  state.skeleton = result.skeleton;
  state.blocks = state.blocks.concat(result.addedBlocks);

  // Surgical insert into each row so we don't reload the iframe.
  result.insertions.forEach(ins => {
    sendToIframe({ cmd: 'insert-after', afterId: ins.afterId, html: ins.html });
  });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast('Column duplicated');
}

function duplicateBlock(rawId) {
  const elementId = resolveStructuralTarget(rawId);
  const result = duplicateElementInSkeleton(
    state.skeleton, elementId, state.blocks
  );
  if (result.skeleton === state.skeleton) return;
  state.skeleton = result.skeleton;
  state.blocks = state.blocks.concat(result.addedBlocks);

  // Surgical DOM insert — avoids reloading the iframe (no scroll jump).
  sendToIframe({
    cmd: 'insert-after',
    afterId: result.originalId,
    html: result.clonedHTML,
  });
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);
  markSaving();
  toast('Duplicated');
}

function deleteBlock(rawId) {
  const elementId = resolveStructuralTarget(rawId);
  const { skeleton, removedIds } = removeElementFromSkeleton(state.skeleton, elementId);
  state.skeleton = skeleton;
  const removedSet = new Set(removedIds);
  state.blocks = state.blocks.filter(b => !removedSet.has(b.id));

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
  sendToIframe({ cmd: 'remove-element', id: elementId });

  // Sync skeleton over collab if we have it
  state.collab?.onLocalStructureChange?.(state.skeleton, state.blocks);

  renderComments();
  toast('Removed');
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
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    };
  }
};

window.toggleExportMenu = function (e) {
  e.stopPropagation();
  document.getElementById('export-menu').classList.toggle('show');
};

window.exportHTML = function () {
  document.getElementById('export-menu').classList.remove('show');
  const html = reassembleHTML(state.skeleton, state.blocks);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = state.filename || 'document.html'; a.click();
  URL.revokeObjectURL(url);
  toast('Downloaded ' + (state.filename || 'document.html'));
};

window.exportForAI = function () {
  document.getElementById('export-menu').classList.remove('show');
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
    .then(() => toast('Copied'))
    .catch(() => { document.execCommand('copy'); toast('Copied'); });
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
  toast('Downloaded ' + name);
};

// ─── Undo / redo (keyboard only) ───────────────
window.doUndo = function () { state.collab?.undo?.(); };
window.doRedo = function () { state.collab?.redo?.(); };

// ─── Save indicator ─────────────────────────────
let saveStateTimer;
function markSaved() {
  const el = document.getElementById('save-state');
  if (!el) return;
  if (state.collab) {
    el.innerHTML = '<span class="dot ok"></span>Saved';
  } else {
    el.innerHTML = '<span class="dot offline"></span>Local only';
  }
  clearTimeout(saveStateTimer);
}
window.__hceMarkSaved = markSaved;

// Local edits → "Saving…" until next remote echo or short delay.
function markSaving() {
  const el = document.getElementById('save-state');
  if (!el) return;
  el.innerHTML = '<span class="dot live"></span>Saving…';
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(markSaved, 900);
}

// ─── Helpers ────────────────────────────────────
function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
