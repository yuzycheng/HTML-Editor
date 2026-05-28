// ─────────────────────────────────────────────────
//  iframe-injection.js
//  Injects a <style> + <script> bundle into the iframe
//  just before </body>. Inside the iframe it manages:
//    edit    — text editing on [data-hce-text] only
//    block   — hover/click any [data-block-id] to delete it
//    comment — toggle-select any [data-block-id]; multi-select
//
//  All three modes work off the same data-block-id stamped
//  by parser.js. The parent (room.js) is the source of truth
//  for selection set and modal/sidebar UI.
// ─────────────────────────────────────────────────

export function buildIframeScript() {
  return `
<style id="__hce-style">
  /* ───── Edit mode (text) ───── */
  body[data-mode="edit"] [data-hce-text]:hover {
    outline: 1px dashed rgba(26, 26, 26, 0.35) !important;
    outline-offset: 2px;
    cursor: text;
  }
  body[data-mode="edit"] [data-hce-text][contenteditable]:focus {
    outline: 1.5px solid rgba(255, 90, 31, 0.85) !important;
    outline-offset: 2px;
    /* No background override — would clobber dark themes and make
       light-on-dark text unreadable. The outline alone signals focus. */
  }

  /* ───── Block mode ───── */
  body[data-mode="block"], body[data-mode="block"] * {
    cursor: pointer !important;
  }
  body[data-mode="block"] [data-block-id]:hover {
    outline: 1.5px solid rgba(185, 28, 28, 0.7) !important;
    outline-offset: 2px;
    background: rgba(254, 226, 226, 0.35) !important;
  }

  /* ───── Comment mode ───── */
  body[data-mode="comment"], body[data-mode="comment"] * {
    cursor: crosshair !important;
  }
  body[data-mode="comment"] [data-block-id]:hover {
    outline: 1.5px dashed rgba(255, 90, 31, 0.7) !important;
    outline-offset: 2px;
  }
  [data-hce-selected] {
    outline: 2px solid rgba(255, 90, 31, 0.9) !important;
    outline-offset: 2px;
    background: rgba(255, 241, 236, 0.5) !important;
  }

  /* ───── Flash for "scroll-to" / sidebar interaction ───── */
  [data-flash] { animation: hce-flash 1.2s ease; }
  @keyframes hce-flash {
    0%, 100% { background-color: transparent; }
    30% { background-color: rgba(255, 90, 31, 0.25); }
  }

  /* ───── Floating delete handle (legacy block mode, kept for compat) ───── */
  #__hce-handle {
    position: fixed;
    z-index: 99999;
    background: #b91c1c;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font: 600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    pointer-events: auto;
    display: none;
  }
  #__hce-handle:hover { background: #991b1b; }

  /* ───── Edit-mode selection toolbar (duplicate + delete) ───── */
  #__hce-tools {
    position: fixed;
    z-index: 99999;
    display: none;
    gap: 2px;
    background: #ffffff;
    border: 1px solid #e7e5e4;
    border-radius: 999px;
    padding: 3px;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.10), 0 2px 4px rgba(15, 23, 42, 0.06);
    pointer-events: auto;
    font: 500 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #__hce-tools button {
    background: transparent;
    border: none;
    color: #44403c;
    height: 28px;
    min-width: 28px;
    padding: 0 6px;
    border-radius: 999px;
    cursor: pointer;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
  }
  #__hce-tools button.has-label { padding: 0 10px 0 8px; }
  #__hce-tools button:hover { background: #f5f5f4; color: #1a1a1a; }
  #__hce-tools button.del:hover { background: #fee2e2; color: #991b1b; }
  #__hce-tools .sep { width: 1px; background: #e7e5e4; margin: 4px 2px; }
  body[data-mode="edit"] [data-block-id].__hce-selected-tools {
    outline: 1.5px solid rgba(26, 26, 26, 0.6) !important;
    outline-offset: 2px;
  }
</style>
<scr` + `ipt id="__hce-script">
(function() {
  var mode = 'edit';
  document.body.dataset.mode = mode;

  function applyMode(m) {
    mode = m;
    document.body.dataset.mode = m;
    // Only text leaves are contenteditable in edit mode
    document.querySelectorAll('[data-hce-text]').forEach(function(el) {
      if (m === 'edit') {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.spellcheck = false;
      } else {
        el.removeAttribute('contenteditable');
      }
    });
    if (m !== 'block') hideHandle();
    if (m !== 'edit' && typeof hideTools === 'function') hideTools();
  }

  // ─── Edit: input → parent ─────────────────────
  // NOTE: We deliberately do NOT auto-remove when text becomes empty.
  // Reason: select-all + Backspace, paste-replace, and other mid-edit
  // states would momentarily produce empty text, which previously caused
  // the whole row to disappear on every collaborator's screen — a very
  // jarring "ghost delete" bug. The marker/line stays put while empty.
  // To explicitly delete a line, the user backspaces in an already-empty
  // text leaf (the keydown handler below), or uses the row × handle.
  var inputTimer;
  var LINE_TAGS = /^(LI|TR|TD|TH|DT|DD)$/;

  function findRemovableAncestor(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      if (LINE_TAGS.test(p.tagName)) return p;
      p = p.parentElement;
    }
    return el;
  }

  function requestRemove(el) {
    var id = el.getAttribute('data-block-id');
    if (!id) return;
    window.parent.postMessage({ type: 'request-block-delete', id: id }, '*');
  }

  // Track when each block was last touched locally — used to decide whether
  // an incoming remote update would clobber an in-progress edit.
  var lastLocalInputAt = Object.create(null);

  document.addEventListener('input', function(e) {
    if (mode !== 'edit') return;
    var el = e.target.closest && e.target.closest('[data-hce-text]');
    if (!el) return;
    var id = el.getAttribute('data-block-id');
    lastLocalInputAt[id] = Date.now();
    clearTimeout(inputTimer);
    var ms = (el.textContent === '') ? 1000 : 180;
    inputTimer = setTimeout(function() {
      window.parent.postMessage({
        type: 'block-text-change',
        id: id,
        text: el.textContent
      }, '*');
      // Log this as a 'text' action in the chronological timeline.
      if (typeof logTextAction === 'function') logTextAction();
    }, ms);
  });

  // Explicit removal: Backspace/Delete inside an already-empty leaf removes
  // the containing line (or the leaf itself if no line ancestor exists).
  document.addEventListener('keydown', function(e) {
    if (mode !== 'edit') return;
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    var el = e.target.closest && e.target.closest('[data-hce-text]');
    if (!el) return;
    if (el.textContent.length === 0) {
      e.preventDefault();
      requestRemove(findRemovableAncestor(el));
    }
  });

  // [REMOVED in undo-redesign]
  //   Old forwardUndo (bubble-phase keydown + beforeinput historyUndo)
  //   handlers used to all fire on a single Cmd+Z, causing the SAME action
  //   to be popped TWICE. The new unified handler below (capture-phase
  //   keydown only, with dedupe guard) replaces all three.

  // ─── Pick the best ancestor for non-text targets ───
  function pickTarget(node) {
    if (!node || node.id === '__hce-handle' || node.id === '__hce-tools') return null;
    if (node.closest && node.closest('#__hce-tools')) return null;
    var el = node.closest && node.closest('[data-block-id]');
    if (!el) {
      var p = node.parentElement;
      while (p && !p.getAttribute('data-block-id')) p = p.parentElement;
      el = p;
    }
    // Refuse to target <body> / <html> — would nuke the whole doc.
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
  }

  // ─── Edit-mode click-selection toolbar (Duplicate / Delete) ───
  //
  // Click any element to "pin" the toolbar to it. Click outside any
  // tracked element (or press Esc) to deselect.
  //
  // In a table cell, the toolbar gains an extra button so the user can
  // duplicate a row OR a column independently.
  var tools = null;
  var toolsTarget = null;        // element receiving the toolbar visually
  var toolsCellId = null;        // data-block-id of the cell, when in a table

  function svgIcon(paths) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_PLUS = svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');
  var ICON_X    = svgIcon('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>');
  // Row icon: a small "stacked rows" mark with a plus glyph in the second row.
  var ICON_ROW  = svgIcon(
    '<rect x="3"  y="4"  width="18" height="6" rx="1.5"/>' +
    '<rect x="3"  y="14" width="18" height="6" rx="1.5"/>' +
    '<line x1="12" y1="15" x2="12" y2="19"/>' +
    '<line x1="10" y1="17" x2="14" y2="17"/>'
  );
  // Column icon: two side-by-side columns with a plus glyph in the right one.
  var ICON_COL  = svgIcon(
    '<rect x="4"  y="3"  width="6" height="18" rx="1.5"/>' +
    '<rect x="14" y="3"  width="6" height="18" rx="1.5"/>' +
    '<line x1="17" y1="10" x2="17" y2="14"/>' +
    '<line x1="15" y1="12" x2="19" y2="12"/>'
  );
  // [ADDITION] Palette icon for the Style button
  var ICON_STYLE = svgIcon(
    '<circle cx="13.5" cy="6.5" r=".5"/>' +
    '<circle cx="17.5" cy="10.5" r=".5"/>' +
    '<circle cx="8.5" cy="7.5" r=".5"/>' +
    '<circle cx="6.5" cy="12.5" r=".5"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.6 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.6-1.4 1.4-1.4H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/>'
  );

  function ensureTools() {
    if (tools) return tools;
    tools = document.createElement('div');
    tools.id = '__hce-tools';
    document.body.appendChild(tools);
    return tools;
  }
  function renderToolsContent() {
    if (!tools) return;
    if (toolsCellId) {
      tools.innerHTML =
          '<button class="dup-row has-label" title="Duplicate this row">' + ICON_ROW + '<span>Row</span></button>'
        + '<button class="dup-col has-label" title="Duplicate this column">' + ICON_COL + '<span>Col</span></button>'
        + '<span class="sep"></span>'
        + '<button class="del-row has-label" title="Delete this row">' + ICON_X + '<span>Row</span></button>'
        + '<button class="del-col has-label" title="Delete this column">' + ICON_X + '<span>Col</span></button>';
      tools.querySelector('.dup-row').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        window.parent.postMessage({
          type: 'request-block-duplicate',
          id: toolsTarget.getAttribute('data-block-id')
        }, '*');
        hideTools();
      });
      tools.querySelector('.dup-col').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsCellId) return;
        window.parent.postMessage({
          type: 'request-column-duplicate',
          id: toolsCellId
        }, '*');
        hideTools();
      });
      tools.querySelector('.del-row').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        // toolsTarget is the TR (resolved on the parent side from cellId),
        // but inside the iframe we still want to send the cell id; the
        // parent's resolveStructuralTarget will lift it to the TR.
        window.parent.postMessage({
          type: 'request-block-delete',
          id: toolsCellId || toolsTarget.getAttribute('data-block-id')
        }, '*');
        hideTools();
      });
      tools.querySelector('.del-col').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsCellId) return;
        window.parent.postMessage({
          type: 'request-column-delete',
          id: toolsCellId
        }, '*');
        hideTools();
      });
    } else {
      tools.innerHTML =
          '<button class="dup" title="Duplicate">' + ICON_PLUS + '</button>'
        + '<button class="style" title="Style (color · size · weight · align · radius · padding)">' + ICON_STYLE + '</button>'
        + '<button class="del" title="Delete">' + ICON_X + '</button>';
      tools.querySelector('.dup').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        window.parent.postMessage({
          type: 'request-block-duplicate',
          id: toolsTarget.getAttribute('data-block-id')
        }, '*');
        hideTools();
      });
      // [ADDITION] Style button — toggles the style panel
      tools.querySelector('.style').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        toggleStylePanel(toolsTarget);
      });
      tools.querySelector('.del').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        window.parent.postMessage({
          type: 'request-block-delete',
          id: toolsTarget.getAttribute('data-block-id')
        }, '*');
        hideTools();
      });
    }
  }
  function hideTools() {
    if (tools) tools.style.display = 'none';
    if (toolsTarget) toolsTarget.classList.remove('__hce-selected-tools');
    toolsTarget = null;
    toolsCellId = null;
  }
  function showToolsOn(el, cellId) {
    var t = ensureTools();
    if (toolsTarget && toolsTarget !== el) {
      toolsTarget.classList.remove('__hce-selected-tools');
    }
    toolsTarget = el;
    toolsCellId = cellId || null;
    renderToolsContent();
    el.classList.add('__hce-selected-tools');
    var r = el.getBoundingClientRect();
    t.style.display = 'flex';
    requestAnimationFrame(function() {
      var w = t.offsetWidth || 70;
      var top = Math.max(4, r.top - 36);
      var left = Math.min(window.innerWidth - w - 4, r.right - w);
      t.style.top = top + 'px';
      t.style.left = Math.max(4, left) + 'px';
    });
  }

  // Click-to-select. Listen on click (not mousedown) so contenteditable
  // focus still works naturally for text leaves.
  document.addEventListener('click', function(e) {
    if (mode !== 'edit') return;
    if (tools && tools.contains(e.target)) return;
    var el = pickTarget(e.target);
    if (!el) { hideTools(); return; }
    // Detect table-cell context for the +row/+col split.
    var rawTarget = e.target;
    var cellAncestor = rawTarget && rawTarget.closest
      ? rawTarget.closest('td, th') : null;
    var cellId = cellAncestor && cellAncestor.hasAttribute('data-block-id')
      ? cellAncestor.getAttribute('data-block-id')
      : null;
    showToolsOn(el, cellId);
  });
  // Esc deselects.
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideTools();
  });
  // ─── [ADDITION · Delete-key delete] ───
  // Backspace / Delete on the currently-selected block removes it.
  // Cmd+Backspace / Cmd+Delete always removes (even when cursor is in text).
  // Plain Backspace inside an editable text leaf is left alone so users
  // can still delete characters normally.
  document.addEventListener('keydown', function(e) {
    if (mode !== 'edit') return;
    if (!toolsTarget) return;
    var isDelKey = (e.key === 'Delete' || e.key === 'Backspace');
    if (!isDelKey) return;
    var meta = e.metaKey || e.ctrlKey;
    var inText = e.target && e.target.closest
      && e.target.closest('[data-hce-text][contenteditable]');
    if (inText && !meta) return; // let contenteditable handle char delete
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({
      type: 'request-block-delete',
      id: toolsTarget.getAttribute('data-block-id')
    }, '*');
    hideTools();
  });
  // Re-pin when the iframe scrolls so toolbar doesn't drift.
  window.addEventListener('scroll', function() {
    if (toolsTarget) showToolsOn(toolsTarget, toolsCellId);
  }, true);
  // Mouse leaves / window blur — keep selection but hide visual to be tidy.
  window.addEventListener('blur', function() { /* keep selection */ });

  function snippetOf(el) {
    var t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    if (t) return t;
    return '<' + el.tagName.toLowerCase() + '>';
  }

  // ─── Block mode: show floating × handle on hover ───
  var handle = null;
  var hoveredEl = null;
  function ensureHandle() {
    if (handle) return handle;
    handle = document.createElement('button');
    handle.id = '__hce-handle';
    handle.textContent = '× Remove';
    handle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!hoveredEl) return;
      window.parent.postMessage({
        type: 'request-block-delete',
        id: hoveredEl.getAttribute('data-block-id')
      }, '*');
      hideHandle();
    });
    document.body.appendChild(handle);
    return handle;
  }
  function hideHandle() {
    if (handle) handle.style.display = 'none';
    hoveredEl = null;
  }
  function showHandleOn(el) {
    var h = ensureHandle();
    var r = el.getBoundingClientRect();
    h.style.top = Math.max(4, r.top - 28) + 'px';
    h.style.left = Math.min(window.innerWidth - 90, r.right - 88) + 'px';
    h.style.display = 'block';
    hoveredEl = el;
  }
  document.addEventListener('mouseover', function(e) {
    if (mode !== 'block') return;
    if (e.target && e.target.id === '__hce-handle') return;  // don't lose hover when over the handle itself
    var el = pickTarget(e.target);
    if (!el) return hideHandle();
    showHandleOn(el);
  });
  document.addEventListener('mouseleave', function(e) {
    // when leaving the iframe entirely
    if (mode === 'block' && e.target === document) hideHandle();
  });

  document.addEventListener('click', function(e) {
    // Block-mode plain click → delete target (in addition to × handle)
    if (mode === 'block') {
      e.preventDefault();
      e.stopPropagation();
      var el = pickTarget(e.target);
      if (!el) return;
      window.parent.postMessage({
        type: 'request-block-delete',
        id: el.getAttribute('data-block-id')
      }, '*');
      hideHandle();
      return;
    }

    // Comment mode → toggle selection
    if (mode === 'comment') {
      e.preventDefault();
      e.stopPropagation();
      var el = pickTarget(e.target);
      if (!el) return;
      var id = el.getAttribute('data-block-id');
      window.parent.postMessage({
        type: 'comment-toggle-select',
        id: id,
        tag: el.tagName.toLowerCase(),
        snippet: snippetOf(el)
      }, '*');
    }
  }, true);

  // ─── Parent → iframe commands ─────────────────
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d._src !== 'hce') return;

    if (d.cmd === 'set-mode') applyMode(d.mode);

    // [ADDITION] Parent broadcasts Yjs UndoManager stack events so the
    // iframe-side actionLog can stay in lockstep with the real Yjs stack.
    // Each stack-item-added (when not a redo) = one new yjs undo step.
    // We push a synthetic 'text' entry so Cmd+Z handler pops it and
    // forwards undo correctly.
    if (d.cmd === 'yjs-stack-added' && !d.isRedo) {
      // Avoid double-log: if logTextAction already pushed a 'text'
      // entry within the merge window, just refresh its timestamp.
      var last = actionLog[actionLog.length - 1];
      if (last && last.type === 'text' && (Date.now() - last.ts) < TEXT_MERGE_WINDOW_MS) {
        last.ts = Date.now();
      } else {
        actionLog.push({ type: 'text', ts: Date.now() });
        redoLog.length = 0;
      }
    }

    if (d.cmd === 'mark-commented') {
      var el = document.querySelector('[data-block-id="' + d.id + '"]');
      if (el) el.setAttribute('data-commented', '1');
    }
    if (d.cmd === 'unmark-commented') {
      var el = document.querySelector('[data-block-id="' + d.id + '"]');
      if (el) el.removeAttribute('data-commented');
    }
    if (d.cmd === 'clear-commented') {
      document.querySelectorAll('[data-commented]').forEach(function(el) {
        el.removeAttribute('data-commented');
      });
    }

    if (d.cmd === 'set-selection') {
      // d.ids: full selection set
      document.querySelectorAll('[data-hce-selected]').forEach(function(el) {
        el.removeAttribute('data-hce-selected');
      });
      (d.ids || []).forEach(function(id) {
        var el = document.querySelector('[data-block-id="' + id + '"]');
        if (el) el.setAttribute('data-hce-selected', '1');
      });
    }

    if (d.cmd === 'scroll-to') {
      var el = document.querySelector('[data-block-id="' + d.id + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.setAttribute('data-flash', '1');
        setTimeout(function() { el.removeAttribute('data-flash'); }, 1200);
      }
    }

    if (d.cmd === 'flash-refs') {
      (d.ids || []).forEach(function(id) {
        var el = document.querySelector('[data-block-id="' + id + '"]');
        if (el) {
          el.setAttribute('data-flash', '1');
          setTimeout(function() { el.removeAttribute('data-flash'); }, 1600);
        }
      });
    }

    if (d.cmd === 'set-block-text') {
      var el = document.querySelector('[data-block-id="' + d.id + '"]');
      if (!el) return;
      if (el.textContent === d.text) return;
      // Only skip the update if the local user is _actively_ typing in this
      // exact element right now. Idle focus (cursor parked but no recent
      // keystrokes) MUST NOT block remote additions.
      var typing = document.activeElement === el
                && lastLocalInputAt[d.id]
                && (Date.now() - lastLocalInputAt[d.id] < 800);
      if (typing) return;
      // Preserve cursor position if the user has focus but isn't typing.
      if (document.activeElement === el && window.getSelection) {
        try {
          var sel = window.getSelection();
          var caret = sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : null;
          el.textContent = d.text;
          if (caret !== null) {
            var range = document.createRange();
            var node = el.firstChild || el;
            var pos = Math.min(caret, el.textContent.length);
            range.setStart(node, node.nodeType === 3 ? pos : 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (_) {
          el.textContent = d.text;
        }
      } else {
        el.textContent = d.text;
      }
    }

    if (d.cmd === 'remove-element') {
      var el = document.querySelector('[data-block-id="' + d.id + '"]');
      if (el) el.remove();
      hideHandle();
      hideTools();
    }

    if (d.cmd === 'insert') {
      // Generic insert: { afterId | parentId+position: 'first'|'last', html }
      var anchor, position;
      if (d.afterId) {
        anchor = document.querySelector('[data-block-id="' + d.afterId + '"]');
        position = 'afterend';
      } else if (d.parentId) {
        anchor = document.querySelector('[data-block-id="' + d.parentId + '"]');
        position = d.position === 'first' ? 'afterbegin' : 'beforeend';
      }
      if (!anchor || !d.html) return;
      // insertAdjacentHTML parses in the host's context, so <tr> inside a
      // <tbody>/<table> anchor works without manual wrapping.
      anchor.insertAdjacentHTML(position, d.html);
      // Make any newly-inserted text leaves editable if we're in edit mode.
      if (mode === 'edit') {
        document.querySelectorAll('[data-hce-text]:not([contenteditable])').forEach(function(c) {
          c.setAttribute('contenteditable', 'plaintext-only');
          c.spellcheck = false;
        });
      }
      return;
    }

    if (d.cmd === 'insert-after') {
      var anchor = document.querySelector('[data-block-id="' + d.afterId + '"]');
      if (!anchor || !d.html) return;
      // HTML fragments like <tr>/<td>/<li> can't be parsed standalone in
      // a template — the parser is context-sensitive. Wrap them so the
      // browser keeps the tag.
      var html = d.html;
      var trimmed = html.replace(/^\\s+/, '');
      var wrapStart = '', wrapEnd = '', sel = null;
      if (/^<tr[\\s>]/i.test(trimmed)) {
        wrapStart = '<table><tbody>'; wrapEnd = '</tbody></table>'; sel = 'tr';
      } else if (/^<t[hd][\\s>]/i.test(trimmed)) {
        wrapStart = '<table><tbody><tr>'; wrapEnd = '</tr></tbody></table>'; sel = 'td,th';
      } else if (/^<li[\\s>]/i.test(trimmed)) {
        wrapStart = '<ul>'; wrapEnd = '</ul>'; sel = 'li';
      } else if (/^<(thead|tbody|tfoot)[\\s>]/i.test(trimmed)) {
        wrapStart = '<table>'; wrapEnd = '</table>'; sel = 'thead,tbody,tfoot';
      } else if (/^<(dt|dd)[\\s>]/i.test(trimmed)) {
        wrapStart = '<dl>'; wrapEnd = '</dl>'; sel = 'dt,dd';
      }
      var node;
      if (sel) {
        var holder = document.createElement('div');
        holder.innerHTML = wrapStart + html + wrapEnd;
        node = holder.querySelector(sel);
      } else {
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        node = tpl.content.firstElementChild;
      }
      if (!node) return;
      // Make the inserted text-leaves immediately editable in edit mode.
      if (mode === 'edit') {
        if (node.hasAttribute('data-hce-text')) {
          node.setAttribute('contenteditable', 'plaintext-only');
          node.spellcheck = false;
        }
        node.querySelectorAll('[data-hce-text]').forEach(function(c) {
          c.setAttribute('contenteditable', 'plaintext-only');
          c.spellcheck = false;
        });
      }
      anchor.parentNode.insertBefore(node, anchor.nextSibling);
      // Brief flash to make the duplication discoverable.
      node.setAttribute('data-flash', '1');
      setTimeout(function() { node.removeAttribute('data-flash'); }, 1200);
    }
  });

  // Let the parent close popovers (Share / Export menu) on any click inside
  // the iframe — clicks here don't bubble to the parent document.
  document.addEventListener('mousedown', function() {
    window.parent.postMessage({ type: 'iframe-mousedown' }, '*');
  }, true);

  // ─── [ADDITION] Style panel ───────────────────────────────────────
  // Floating dark popover with: text color · font size · align · padding.
  // Anchored to the currently-selected element, toggled by 🎨 toolbar button.
  //
  // Defined as a function, called AFTER applyMode/ready below. Any error
  // here can't break the core editor.
  var stylePanel = null;
  var styleTarget = null;
  var hideStylePanel; // forward decl

  // ─── 样式 Undo / Redo 栈 ───
  // 独立于 Yjs UndoManager（只追踪文字）。
  // Cmd+Z 优先撤销样式；样式栈空了再 fall through 到 Yjs（撤销文字）。
  var styleHistory = [];
  var styleHistoryPtr = -1;
  var preChangeSnap = null;
  var preChangeTarget = null;
  var commitDebounceTimer = null;
  var STYLE_HISTORY_LIMIT = 100;

  function captureStyleSnap(el) {
    var snap = [{ el: el, css: el.style.cssText }];
    el.querySelectorAll('*').forEach(function(c) {
      snap.push({ el: c, css: c.style.cssText });
    });
    return snap;
  }
  function applyStyleSnap(snap) {
    snap.forEach(function(s) {
      if (s.el && s.el.style) s.el.style.cssText = s.css;
    });
  }
  function maybeStartStyleChange(target) {
    if (!target) return;
    if (preChangeSnap && preChangeTarget === target) return; // 已经在记录
    if (preChangeSnap) commitStyleChange(); // 切到新目标 — 先把前一组提交
    preChangeSnap = captureStyleSnap(target);
    preChangeTarget = target;
  }
  function debouncedCommitStyle() {
    if (commitDebounceTimer) clearTimeout(commitDebounceTimer);
    commitDebounceTimer = setTimeout(commitStyleChange, 500);
  }
  function commitStyleChange() {
    if (commitDebounceTimer) { clearTimeout(commitDebounceTimer); commitDebounceTimer = null; }
    if (!preChangeSnap || !preChangeTarget) return;
    var after = captureStyleSnap(preChangeTarget);
    // 截掉 redo 路径
    styleHistory.length = styleHistoryPtr + 1;
    styleHistory.push({ before: preChangeSnap, after: after });
    if (styleHistory.length > STYLE_HISTORY_LIMIT) {
      styleHistory.shift();
    } else {
      styleHistoryPtr++;
    }
    preChangeSnap = null;
    preChangeTarget = null;
    // Tell the chronological log a style action just happened.
    if (typeof logStyleAction === 'function') logStyleAction();
  }
  function undoStyleHistory() {
    commitStyleChange(); // 提交任何 pending
    if (styleHistoryPtr < 0) return false;
    applyStyleSnap(styleHistory[styleHistoryPtr].before);
    styleHistoryPtr--;
    return true;
  }
  function redoStyleHistory() {
    if (styleHistoryPtr >= styleHistory.length - 1) return false;
    styleHistoryPtr++;
    applyStyleSnap(styleHistory[styleHistoryPtr].after);
    return true;
  }
  // ─── Chronological action log (text + style merged) ───
  //
  // Two separate undo stacks (style vs Yjs text) used to race each other:
  // ⌘Z always tried style first, so an OLD color change would pop before a
  // RECENT text edit. Now both kinds of edits are appended to one timeline
  // and ⌘Z pops the actual most-recent one.
  var actionLog = [];   // entries: { type: 'style'|'text', ts: number }
  var redoLog   = [];
  var TEXT_MERGE_WINDOW_MS = 220;   // a touch wider than Yjs captureTimeout (150)

  function logTextAction() {
    var last = actionLog[actionLog.length - 1];
    if (last && last.type === 'text' && (Date.now() - last.ts) < TEXT_MERGE_WINDOW_MS) {
      last.ts = Date.now();   // merge into the running text burst
    } else {
      actionLog.push({ type: 'text', ts: Date.now() });
    }
    redoLog.length = 0;
  }
  function logStyleAction() {
    actionLog.push({ type: 'style', ts: Date.now() });
    redoLog.length = 0;
    // [FIX] Ask Yjs to end its current capture window so the NEXT text
    // edit (within Yjs's 150ms captureTimeout) doesn't get merged into
    // the same undo step as a previous text edit before this style change.
    try {
      window.parent.postMessage({ type: 'request-stop-capturing' }, '*');
    } catch (e) {}
  }
  // Expose for the style commit path to use.
  window.__hceLogStyleAction = logStyleAction;

  // Unified ⌘Z / ⌘⇧Z handler — peels the top of the chronological log.
  // [FIX] Dedupe guard: if same keydown fires twice in rapid succession
  // (older versions had bubble + capture + beforeinput all firing for
  // a single Cmd+Z), only the first handles. Prevents double-undo.
  var __lastUndoTs = 0;
  function __handleUndo(isRedo) {
    var now = Date.now();
    if (now - __lastUndoTs < 60) return; // already handled this keystroke
    __lastUndoTs = now;
    // [FIX] Flush any pending style changes BEFORE deciding what to undo —
    // user might have just dragged a slider and pressed Cmd+Z immediately,
    // we want that slider drag committed first so it can be undone.
    if (typeof commitStyleChange === 'function') commitStyleChange();
    // Reset typing gate so any incoming text patch from the undo lands.
    for (var k in lastLocalInputAt) delete lastLocalInputAt[k];

    if (isRedo) {
      var top = redoLog.pop();
      if (!top) return;
      if (top.type === 'style') {
        if (redoStyleHistory()) actionLog.push(top);
        else redoLog.push(top);
      } else {
        window.parent.postMessage({ type: 'request-redo' }, '*');
        actionLog.push(top);
      }
    } else {
      var top = actionLog.pop();
      if (!top) return;
      if (top.type === 'style') {
        if (undoStyleHistory()) redoLog.push(top);
        else actionLog.push(top);
      } else {
        window.parent.postMessage({ type: 'request-undo' }, '*');
        redoLog.push(top);
      }
    }
  }
  document.addEventListener('keydown', function(e) {
    var meta = e.metaKey || e.ctrlKey;
    if (!meta || !e.key || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    __handleUndo(!!e.shiftKey);
  }, true);
  // Belt-and-suspenders: some browsers fire beforeinput historyUndo
  // even when keydown is preventDefault'd. Dedupe via __lastUndoTs.
  document.addEventListener('beforeinput', function(e) {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    __handleUndo(e.inputType === 'historyRedo');
  }, true);
  function rgbToHex(c) {
    if (!c) return '#000000';
    if (c.charAt(0) === '#') return c.length === 7 ? c : '#000000';
    var m = c.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
    if (!m) return '#000000';
    function h(n){ return (+n).toString(16).padStart(2,'0'); }
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  function pxNum(s) {
    if (!s) return 0;
    var m = String(s).match(/(-?\\d+(\\.\\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }
  function ensureStylePanel() {
    if (stylePanel) return stylePanel;
    var styleEl = document.createElement('style');
    styleEl.id = '__hce-style-panel-css';
    styleEl.textContent = [
      // Wrapper — compact white panel
      '#__hce-style-panel{position:fixed;z-index:2147483647;width:248px;background:#ffffff;color:#1a1a1a;',
      'border:1px solid #e7e5e4;border-radius:12px;padding:0;',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'box-shadow:0 12px 32px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.06);display:none;}',
      // Header / drag handle
      '#__hce-style-panel .sp-head{display:flex;justify-content:space-between;align-items:center;',
      'padding:10px 12px;border-bottom:1px solid #f0efed;cursor:move;user-select:none;}',
      '#__hce-style-panel.dragging{box-shadow:0 16px 40px rgba(15,23,42,.18),0 4px 10px rgba(15,23,42,.08);}',
      '#__hce-style-panel .sp-head .ttl{font-size:12px;font-weight:600;color:#1a1a1a;display:flex;align-items:center;gap:6px;}',
      '#__hce-style-panel .sp-head .ttl::before{content:"⋮⋮";color:#a8a29e;letter-spacing:-2px;font-size:13px;}',
      '#__hce-style-panel .sp-head .close{background:none;border:none;color:#a8a29e;cursor:pointer;',
      'font-size:16px;line-height:1;padding:2px 6px;border-radius:4px;}',
      '#__hce-style-panel .sp-head .close:hover{background:#f5f5f4;color:#1a1a1a;}',
      // Body
      '#__hce-style-panel .sp-body{padding:10px 12px 12px;}',
      '#__hce-style-panel .row{margin-bottom:10px;}',
      '#__hce-style-panel .row:last-child{margin-bottom:0;}',
      '#__hce-style-panel label,#__hce-style-panel .label{display:block;color:#737373;margin-bottom:6px;',
      'font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;}',
      // Row head (label + value/action on right)
      '#__hce-style-panel .row-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}',
      '#__hce-style-panel .row-head .label{margin-bottom:0;}',
      '#__hce-style-panel .row-head .val{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:#44403c;}',
      // Format buttons (B / I / U)
      '#__hce-style-panel .biu-row{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;}',
      '#__hce-style-panel .biu-btn{background:#fafaf9;border:1px solid #e7e5e4;color:#44403c;',
      'padding:0;border-radius:6px;cursor:pointer;font-size:14px;height:30px;display:flex;',
      'align-items:center;justify-content:center;font-family:Georgia,Cambria,Times,serif;}',
      '#__hce-style-panel .biu-btn[data-prop="fontWeight"]{font-weight:700;}',
      '#__hce-style-panel .biu-btn[data-prop="fontStyle"]{font-style:italic;}',
      '#__hce-style-panel .biu-btn[data-prop="textDecoration"]{text-decoration:underline;}',
      '#__hce-style-panel .biu-btn:hover{background:#f0efed;color:#1a1a1a;}',
      '#__hce-style-panel .biu-btn.on{background:#1a1a1a;color:#fff;border-color:#1a1a1a;}',
      // Compact reset icon button (in color row head)
      '#__hce-style-panel .reset-btn{background:transparent;border:none;color:#737373;cursor:pointer;',
      'font-size:13px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;',
      'line-height:1;}',
      '#__hce-style-panel .reset-btn:hover{background:#f5f5f4;color:#1a1a1a;}',
      '#__hce-style-panel .reset-btn:disabled{opacity:.35;cursor:default;}',
      // Palette + recent — small fixed-size swatches in a flex row
      '#__hce-style-panel .palette,#__hce-style-panel .recent{display:flex;flex-wrap:wrap;gap:6px;}',
      '#__hce-style-panel .sw{width:22px;height:22px;border-radius:5px;border:1px solid #e7e5e4;',
      'cursor:pointer;padding:0;position:relative;transition:transform 80ms,box-shadow 80ms;flex-shrink:0;}',
      '#__hce-style-panel .sw:hover{transform:scale(1.12);box-shadow:0 2px 6px rgba(0,0,0,.12);z-index:1;}',
      '#__hce-style-panel .sw.on{outline:2px solid #1a1a1a;outline-offset:2px;}',
      '#__hce-style-panel .sw.original::after{content:"";position:absolute;bottom:-4px;left:50%;',
      'transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#1a1a1a;}',
      // Recent swatch × delete on hover
      '#__hce-style-panel .recent .sw .x{position:absolute;top:-5px;right:-5px;width:13px;height:13px;',
      'background:#1a1a1a;color:#fff;border-radius:50%;border:none;cursor:pointer;font-size:9px;',
      'line-height:13px;text-align:center;padding:0;display:none;}',
      '#__hce-style-panel .recent .sw:hover .x{display:block;}',
      '#__hce-style-panel .recent-label{margin-top:8px;}',
      // Number input next to size slider
      '#__hce-style-panel .num-input{width:48px;height:22px;padding:0 6px;background:#fafaf9;',
      'border:1px solid #e7e5e4;border-radius:4px;font:11px ui-monospace,SFMono-Regular,monospace;',
      'color:#1a1a1a;text-align:right;-moz-appearance:textfield;}',
      '#__hce-style-panel .num-input::-webkit-outer-spin-button,',
      '#__hce-style-panel .num-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '#__hce-style-panel .num-input:focus{outline:none;border-color:#1a1a1a;box-shadow:0 0 0 2px rgba(26,26,26,.06);}',
      // Save-to-recent button under picker
      '#__hce-style-panel .save-row{display:flex;justify-content:flex-end;}',
      '#__hce-style-panel .save-btn{background:#1a1a1a;color:#fff;border:none;border-radius:5px;',
      'padding:5px 11px;font-size:11px;font-weight:500;cursor:pointer;display:inline-flex;',
      'align-items:center;gap:4px;}',
      '#__hce-style-panel .save-btn:hover{background:#44403c;}',
      '#__hce-style-panel .save-btn:disabled{opacity:.4;cursor:default;}',
      // Custom expander
      '#__hce-style-panel .more-toggle{background:none;border:none;color:#737373;font-size:11px;',
      'cursor:pointer;padding:6px 0 0;display:flex;align-items:center;gap:4px;width:100%;text-align:left;',
      'font-weight:500;}',
      '#__hce-style-panel .more-toggle:hover{color:#1a1a1a;}',
      '#__hce-style-panel .more-toggle .chev{transition:transform 160ms;}',
      '#__hce-style-panel .more-toggle.open .chev{transform:rotate(90deg);}',
      // HSV picker — drag-only
      '#__hce-style-panel .picker{display:none;flex-direction:column;gap:8px;padding-top:8px;}',
      '#__hce-style-panel .picker.show{display:flex;}',
      '#__hce-style-panel .sv{position:relative;width:100%;height:120px;border-radius:8px;cursor:crosshair;',
      'background:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),#f00;',
      'overflow:hidden;border:1px solid #e7e5e4;}',
      '#__hce-style-panel .sv-thumb{position:absolute;width:14px;height:14px;border-radius:50%;',
      'border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.3);',
      'transform:translate(-50%,-50%);pointer-events:none;}',
      '#__hce-style-panel .hue{position:relative;width:100%;height:12px;border-radius:6px;cursor:pointer;',
      'background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);border:1px solid #e7e5e4;}',
      '#__hce-style-panel .hue-thumb{position:absolute;top:50%;width:14px;height:14px;border-radius:50%;',
      'background:#fff;border:2px solid #1a1a1a;transform:translate(-50%,-50%);pointer-events:none;}',
      // Range slider
      '#__hce-style-panel input[type=range]{width:100%;-webkit-appearance:none;appearance:none;height:4px;',
      'background:#e7e5e4;border-radius:2px;outline:none;}',
      '#__hce-style-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;',
      'width:14px;height:14px;border-radius:50%;background:#1a1a1a;cursor:pointer;border:2px solid #fff;',
      'box-shadow:0 1px 3px rgba(0,0,0,.2);}',
      '#__hce-style-panel input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;',
      'background:#1a1a1a;cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.2);}',
      // Alignment buttons
      '#__hce-style-panel .alignrow{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;}',
      '#__hce-style-panel .alignrow button{background:#fafaf9;border:1px solid #e7e5e4;color:#44403c;',
      'padding:6px 0;border-radius:6px;cursor:pointer;font-size:10px;font-weight:500;text-transform:capitalize;}',
      '#__hce-style-panel .alignrow button:hover{background:#f0efed;color:#1a1a1a;}',
      '#__hce-style-panel .alignrow button.on{background:#1a1a1a;color:#fff;border-color:#1a1a1a;}',
    ].join('');
    document.head.appendChild(styleEl);
    stylePanel = document.createElement('div');
    stylePanel.id = '__hce-style-panel';

    stylePanel.innerHTML =
        '<div class="sp-head"><span class="ttl">Style</span><button class="close" title="Close">×</button></div>'
      + '<div class="sp-body">'

      // Format: B / I / U
      + '<div class="row">'
        + '<div class="biu-row">'
          + '<button class="biu-btn" data-prop="fontWeight" title="Bold">B</button>'
          + '<button class="biu-btn" data-prop="fontStyle"  title="Italic">I</button>'
          + '<button class="biu-btn" data-prop="textDecoration" title="Underline">U</button>'
        + '</div>'
      + '</div>'

      // Alignment
      + '<div class="row">'
        + '<div class="alignrow">'
          + '<button data-align="left">Left</button>'
          + '<button data-align="center">Center</button>'
          + '<button data-align="right">Right</button>'
          + '<button data-align="justify">Justify</button>'
        + '</div>'
      + '</div>'

      // Size — slider + editable number
      + '<div class="row">'
        + '<div class="row-head"><span class="label">Size</span>'
          + '<input type="number" class="num-input sp-fs-input" min="6" max="200" step="1">'
        + '</div>'
        + '<input type="range" class="sp-fs" min="10" max="120">'
      + '</div>'

      // Color
      + '<div class="row sp-color-row">'
        + '<div class="row-head">'
          + '<span class="label">Color</span>'
          + '<button class="reset-btn sp-reset" title="Revert to original color">↶ Reset</button>'
        + '</div>'
        + '<div class="palette sp-palette"><!-- filled by renderPalette() --></div>'
        + '<div class="sp-recent-wrap" style="display:none;">'
          + '<span class="label recent-label">Recent</span>'
          + '<div class="recent sp-recent"></div>'
        + '</div>'
        + '<button class="more-toggle sp-more-toggle" type="button"><span class="chev">▸</span> More colors</button>'
        + '<div class="picker sp-picker">'
          + '<div class="sv sp-sv"><div class="sv-thumb sp-sv-thumb"></div></div>'
          + '<div class="hue sp-hue"><div class="hue-thumb sp-hue-thumb"></div></div>'
          + '<div class="save-row"><button class="save-btn sp-save" type="button">＋ Save</button></div>'
        + '</div>'
      + '</div>'

      + '</div>';
    document.body.appendChild(stylePanel);
    // [FIX] 阻止面板内的事件冒泡到 document — 否则点滑块松手时 click 事件
    // 会冒泡到 iframe-injection 的全局 click handler，触发 hideTools 把面板关了
    stylePanel.addEventListener('click', function(e) { e.stopPropagation(); });
    stylePanel.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    // ─── Drag the panel by its header ───
    (function makeDraggable() {
      var head = stylePanel.querySelector('.sp-head');
      var startX, startY, startLeft, startTop;
      head.addEventListener('mousedown', function(e) {
        // Ignore drag if user clicked the close button
        if (e.target.closest('.close')) return;
        e.preventDefault();
        var r = stylePanel.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        startLeft = r.left;  startTop = r.top;
        stylePanel.classList.add('dragging');
        function move(ev) {
          var nx = startLeft + (ev.clientX - startX);
          var ny = startTop  + (ev.clientY - startY);
          // Clamp inside viewport (leave a small margin)
          var w = stylePanel.offsetWidth, h = stylePanel.offsetHeight;
          nx = Math.max(8, Math.min(window.innerWidth  - w - 8, nx));
          ny = Math.max(8, Math.min(window.innerHeight - h - 8, ny));
          stylePanel.style.left = nx + 'px';
          stylePanel.style.top  = ny + 'px';
        }
        function up() {
          stylePanel.classList.remove('dragging');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    })();

    function apply(prop, val) {
      if (!styleTarget) return;
      // 在第一次改之前快照 before-state
      maybeStartStyleChange(styleTarget);
      // camelCase → kebab-case (fontSize → font-size 等)
      var cssProp = prop.replace(/[A-Z]/g, function(m) { return '-' + m.toLowerCase(); });
      styleTarget.style.setProperty(cssProp, val, 'important');
      // color 要无脑打给所有后代元素 — 中间层 <a><strong> 等可能也有自己的 color
      if (prop === 'color') {
        styleTarget.querySelectorAll('*').forEach(function(child) {
          child.style.setProperty('color', val, 'important');
        });
      }
      debouncedCommitStyle();
    }
    // Expose for module-level helpers (renderPalette / renderRecent etc.)
    stylePanel.__hceApply = apply;
    stylePanel.querySelector('.close').onclick = hideStylePanel;

    // Refresh reset button enabled state after a color change
    function refreshResetState(color) {
      if (!styleTarget) return;
      var hex = rgbToHex(color);
      var orig = styleTarget.__hceOriginalColor || hex;
      stylePanel.querySelector('.sp-reset').disabled = (hex.toLowerCase() === orig.toLowerCase());
    }

    // Reset button — revert to original color captured when panel opened
    stylePanel.querySelector('.sp-reset').addEventListener('click', function() {
      if (!styleTarget || !styleTarget.__hceOriginalColor) return;
      var c = styleTarget.__hceOriginalColor;
      apply('color', c);
      markActiveSwatch(c);
      refreshResetState(c);
    });

    // ─── Bold / Italic / Underline toggles ───
    function isFormatActive(prop, target) {
      var cs = getComputedStyle(target);
      if (prop === 'fontWeight') return parseInt(cs.fontWeight, 10) >= 600;
      if (prop === 'fontStyle')  return cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
      if (prop === 'textDecoration') return (cs.textDecorationLine || cs.textDecoration || '').indexOf('underline') !== -1;
      return false;
    }
    stylePanel.querySelectorAll('.biu-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!styleTarget) return;
        var prop = btn.getAttribute('data-prop');
        var active = isFormatActive(prop, styleTarget);
        if (prop === 'fontWeight')   apply('fontWeight', active ? '400' : '700');
        else if (prop === 'fontStyle')   apply('fontStyle',  active ? 'normal' : 'italic');
        else if (prop === 'textDecoration') apply('textDecoration', active ? 'none' : 'underline');
        btn.classList.toggle('on', !active);
      });
    });

    // Custom expander → reveals HSV picker
    var moreBtn = stylePanel.querySelector('.sp-more-toggle');
    var picker = stylePanel.querySelector('.sp-picker');
    moreBtn.addEventListener('click', function() {
      var open = moreBtn.classList.toggle('open');
      picker.classList.toggle('show', open);
      // When opening, sync picker thumbs to current color so it's not a fresh red square.
      if (open && styleTarget) {
        var cur = rgbToHex(getComputedStyle(styleTarget).color);
        setPickerFromHex(cur);
      }
    });

    // HSV picker — drag in SV square + hue strip
    var sv = stylePanel.querySelector('.sp-sv');
    var svThumb = stylePanel.querySelector('.sp-sv-thumb');
    var hue = stylePanel.querySelector('.sp-hue');
    var hueThumb = stylePanel.querySelector('.sp-hue-thumb');
    var hsvH = 0, hsvS = 1, hsvV = 1;   // current HSV state

    function updateSvBackground() {
      sv.style.background =
        'linear-gradient(to top,#000,transparent),'
        + 'linear-gradient(to right,#fff,transparent),'
        + 'hsl(' + hsvH + ',100%,50%)';
    }
    function currentPickerHex() { return hsvToHex(hsvH, hsvS, hsvV); }
    function applyPickerColor() {
      var hex = currentPickerHex();
      apply('color', hex);
      markActiveSwatch(hex);
      refreshResetState(hex);
      // Don't auto-push to Recent — only on explicit Save click.
    }
    function setPickerFromHex(hex) {
      var hsv = hexToHsv(hex);
      hsvH = hsv.h; hsvS = hsv.s; hsvV = hsv.v;
      updateSvBackground();
      // Position thumbs
      var svRect = sv.getBoundingClientRect();
      svThumb.style.left = (hsv.s * 100) + '%';
      svThumb.style.top = ((1 - hsv.v) * 100) + '%';
      hueThumb.style.left = ((hsv.h / 360) * 100) + '%';
    }

    function dragHandler(target, onMove) {
      function down(e) {
        e.preventDefault();
        onMove(e);
        function move(ev) { onMove(ev); }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.removeEventListener('touchmove', move);
          document.removeEventListener('touchend', up);
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', up);
      }
      target.addEventListener('mousedown', down);
      target.addEventListener('touchstart', down, { passive: false });
    }
    dragHandler(sv, function(e) {
      var r = sv.getBoundingClientRect();
      var pt = (e.touches && e.touches[0]) || e;
      var x = Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width));
      var y = Math.max(0, Math.min(1, (pt.clientY - r.top) / r.height));
      hsvS = x; hsvV = 1 - y;
      svThumb.style.left = (x * 100) + '%';
      svThumb.style.top  = (y * 100) + '%';
      applyPickerColor();
    });
    dragHandler(hue, function(e) {
      var r = hue.getBoundingClientRect();
      var pt = (e.touches && e.touches[0]) || e;
      var x = Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width));
      hsvH = x * 360;
      hueThumb.style.left = (x * 100) + '%';
      updateSvBackground();
      applyPickerColor();
    });

    // Save button — explicit "add current picker color to Recent"
    var saveBtn = stylePanel.querySelector('.sp-save');
    saveBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      pushRecent(currentPickerHex());
    });

    // Font size — slider + number input, kept in sync
    var fs = stylePanel.querySelector('.sp-fs');
    var fsInput = stylePanel.querySelector('.sp-fs-input');
    function applyFontSize(n) {
      n = Math.max(6, Math.min(200, parseInt(n, 10) || 14));
      apply('fontSize', n + 'px');
      fs.value = Math.min(parseInt(fs.max, 10), n);
      fsInput.value = n;
    }
    fs.oninput = function() { applyFontSize(fs.value); };
    fsInput.addEventListener('input',  function() { applyFontSize(fsInput.value); });
    fsInput.addEventListener('change', function() { applyFontSize(fsInput.value); });
    // Alignment
    stylePanel.querySelectorAll('.alignrow button').forEach(function(btn) {
      btn.onclick = function() {
        apply('textAlign', btn.dataset.align);
        stylePanel.querySelectorAll('.alignrow button').forEach(function(b){ b.classList.toggle('on', b === btn); });
      };
    });

    // Expose for module-level helpers (renderPalette / renderRecent)
    stylePanel.__hceSetPickerFromHex = setPickerFromHex;
    stylePanel.__hceRefreshResetState = refreshResetState;
    return stylePanel;
  }

  // ─── Current page-derived palette (regenerated each panel open) ───
  var currentPalette = [];

  // ─── Recent colors (custom picks, in-memory) ───
  var recentColors = [];
  var RECENT_LIMIT = 5;
  function pushRecent(hex) {
    hex = hex.toLowerCase();
    // skip if already in palette (would be redundant)
    if (currentPalette.map(function(c){return c.toLowerCase();}).indexOf(hex) !== -1) return;
    recentColors = [hex].concat(recentColors.filter(function(c){ return c !== hex; })).slice(0, RECENT_LIMIT);
    renderRecent();
  }
  function removeRecent(hex) {
    hex = hex.toLowerCase();
    recentColors = recentColors.filter(function(c) { return c.toLowerCase() !== hex; });
    renderRecent();
  }
  function renderRecent() {
    if (!stylePanel) return;
    var wrap = stylePanel.querySelector('.sp-recent-wrap');
    var row  = stylePanel.querySelector('.sp-recent');
    if (!recentColors.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';
    row.innerHTML = '';
    recentColors.forEach(function(c) {
      var b = document.createElement('button');
      b.className = 'sw';
      b.setAttribute('data-color', c);
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', function(ev) {
        if (ev.target && ev.target.classList && ev.target.classList.contains('x')) return; // click on × handled separately
        if (stylePanel.__hceApply) stylePanel.__hceApply('color', c);
        markActiveSwatch(c);
        if (stylePanel.__hceRefreshResetState) stylePanel.__hceRefreshResetState(c);
        if (stylePanel.__hceSetPickerFromHex) stylePanel.__hceSetPickerFromHex(c);
      });
      // × delete button
      var x = document.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.title = 'Remove from recent';
      x.addEventListener('click', function(ev) {
        ev.preventDefault(); ev.stopPropagation();
        removeRecent(c);
      });
      b.appendChild(x);
      row.appendChild(b);
    });
  }

  // ─── Extract page-derived palette ───
  // Walk the iframe body, collect distinctive colors used. If fewer than 5
  // distinct ones found, fill the rest with hue-rotated complements.
  function extractPageColors() {
    var counts = Object.create(null);
    var firstSeen = Object.create(null);
    var seq = 0;

    function consider(c) {
      if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return;
      var hex = rgbToHex(c).toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex)) return;
      var r = parseInt(hex.slice(1,3), 16);
      var g = parseInt(hex.slice(3,5), 16);
      var b = parseInt(hex.slice(5,7), 16);
      var max = Math.max(r,g,b), min = Math.min(r,g,b);
      if (max - min < 32) return;     // near-grey, skip
      if (max < 40) return;           // near-black, skip
      if (min > 230 && max - min < 50) return;   // near-white pastel, skip
      counts[hex] = (counts[hex] || 0) + 1;
      if (firstSeen[hex] === undefined) firstSeen[hex] = seq++;
    }

    document.querySelectorAll('body *').forEach(function(el) {
      // Skip our injected UI to avoid polluting the palette.
      if (el.closest && (el.closest('#__hce-style-panel') || el.closest('#__hce-tools') || el.closest('#__hce-handle'))) return;
      var cs;
      try { cs = getComputedStyle(el); } catch { return; }
      consider(cs.color);
      consider(cs.backgroundColor);
      consider(cs.borderColor);
    });

    var picked = Object.keys(counts).sort(function(a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return firstSeen[a] - firstSeen[b];
    }).slice(0, 5);

    // If empty, seed with a sensible default
    if (picked.length === 0) picked = ['#ff5a1f'];

    // Fill up to 5 with hue-rotated complementary colors of the first pick
    var i = 1;
    while (picked.length < 5 && i < 30) {
      var src = picked[i % picked.length] || picked[0];
      var hsv = hexToHsv(src);
      var step = i <= 3 ? 180 : (60 * i);
      var nh = (hsv.h + step) % 360;
      var nc = hsvToHex(nh, Math.max(0.5, hsv.s || 0.7), Math.max(0.5, hsv.v || 0.7)).toLowerCase();
      if (picked.indexOf(nc) === -1) picked.push(nc);
      i++;
    }
    currentPalette = picked.slice(0, 5);
    return currentPalette;
  }

  function renderPalette() {
    if (!stylePanel) return;
    var row = stylePanel.querySelector('.sp-palette');
    row.innerHTML = '';
    // Build display list: [original, ...5 recommended], dedupe.
    var orig = (styleTarget && styleTarget.__hceOriginalColor) ? styleTarget.__hceOriginalColor.toLowerCase() : null;
    var list = [];
    if (orig) list.push(orig);
    currentPalette.forEach(function(c) {
      if (list.indexOf(c.toLowerCase()) === -1) list.push(c);
    });
    list = list.slice(0, 6);
    list.forEach(function(c, idx) {
      var b = document.createElement('button');
      b.className = 'sw' + (orig && c.toLowerCase() === orig ? ' original' : '');
      b.setAttribute('data-color', c);
      b.style.background = c;
      b.title = (orig && c.toLowerCase() === orig) ? (c + ' (original)') : c;
      b.addEventListener('click', function() {
        if (stylePanel.__hceApply) stylePanel.__hceApply('color', c);
        markActiveSwatch(c);
        if (stylePanel.__hceRefreshResetState) stylePanel.__hceRefreshResetState(c);
        if (stylePanel.__hceSetPickerFromHex) stylePanel.__hceSetPickerFromHex(c);
      });
      row.appendChild(b);
    });
  }

  // ─── HSV ↔ HEX conversion ───
  function hsvToHex(h, s, v) {
    h = (h % 360 + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r, g, b;
    if (h < 60)      { r = c; g = x; b = 0; }
    else if (h < 120){ r = x; g = c; b = 0; }
    else if (h < 180){ r = 0; g = c; b = x; }
    else if (h < 240){ r = 0; g = x; b = c; }
    else if (h < 300){ r = x; g = 0; b = c; }
    else             { r = c; g = 0; b = x; }
    function p(n) { return Math.round((n + m) * 255).toString(16).padStart(2, '0'); }
    return '#' + p(r) + p(g) + p(b);
  }
  function hexToHsv(hex) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
    var r = parseInt(hex.slice(0,2),16)/255;
    var g = parseInt(hex.slice(2,4),16)/255;
    var b = parseInt(hex.slice(4,6),16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b);
    var d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var s = max === 0 ? 0 : d / max;
    var v = max;
    return { h: h, s: s, v: v };
  }

  function markActiveSwatch(color) {
    if (!stylePanel) return;
    var hex = rgbToHex(color).toLowerCase();
    stylePanel.querySelectorAll('.sp-palette .sw').forEach(function(sw) {
      sw.classList.toggle('on', sw.getAttribute('data-color').toLowerCase() === hex);
    });
  }
  function populateStylePanel(el) {
    var p = ensureStylePanel();
    var cs = getComputedStyle(el);
    var hexC = rgbToHex(cs.color);

    // Capture the original color ONCE per element. Reset reverts to it.
    if (!el.__hceOriginalColor) {
      el.__hceOriginalColor = hexC;
    }

    // Build the page-derived palette + render it.
    extractPageColors();
    renderPalette();
    renderRecent();

    // Reset button state (enabled if current color !== original)
    var resetBtn = p.querySelector('.sp-reset');
    resetBtn.disabled = (hexC.toLowerCase() === el.__hceOriginalColor.toLowerCase());

    // Active swatch in the palette, and HSV picker thumbs if open
    markActiveSwatch(hexC);
    if (p.__hceSetPickerFromHex && p.querySelector('.sp-picker').classList.contains('show')) {
      p.__hceSetPickerFromHex(hexC);
    }

    // B / I / U toggle state
    p.querySelectorAll('.biu-btn').forEach(function(btn) {
      var prop = btn.getAttribute('data-prop');
      var active = false;
      if (prop === 'fontWeight')   active = parseInt(cs.fontWeight, 10) >= 600;
      else if (prop === 'fontStyle')   active = (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique');
      else if (prop === 'textDecoration') active = ((cs.textDecorationLine || cs.textDecoration || '').indexOf('underline') !== -1);
      btn.classList.toggle('on', active);
    });

    // Size + alignment
    var fs = pxNum(cs.fontSize);
    p.querySelector('.sp-fs').value = Math.min(120, fs);
    var fsInput = p.querySelector('.sp-fs-input');
    if (fsInput) fsInput.value = fs;
    p.querySelectorAll('.alignrow button').forEach(function(b){
      b.classList.toggle('on', b.dataset.align === cs.textAlign);
    });
  }
  function positionStylePanel(el) {
    var p = ensureStylePanel();
    var r = el.getBoundingClientRect();
    var top = r.bottom + 10;
    var left = r.left;
    // Keep on screen
    var maxLeft = window.innerWidth - 300;
    if (left > maxLeft) left = maxLeft;
    if (top + 480 > window.innerHeight) top = Math.max(8, r.top - 488);
    p.style.top = top + 'px';
    p.style.left = Math.max(8, left) + 'px';
  }
  function showStylePanel(el) {
    styleTarget = el;
    var p = ensureStylePanel();
    populateStylePanel(el);
    positionStylePanel(el);
    p.style.display = 'block';
  }
  hideStylePanel = function() {
    if (stylePanel) stylePanel.style.display = 'none';
    styleTarget = null;
  };

  // Click anywhere outside the panel (and not on the toolbar that owns it)
  // closes the panel. Capture phase so we beat other listeners.
  document.addEventListener('mousedown', function(e) {
    if (!stylePanel || stylePanel.style.display !== 'block') return;
    if (e.target.closest && (
        e.target.closest('#__hce-style-panel') ||
        e.target.closest('#__hce-tools') ||
        e.target.closest('#__hce-handle'))) return;
    hideStylePanel();
  }, true);
  function toggleStylePanel(el) {
    if (stylePanel && stylePanel.style.display === 'block' && styleTarget === el) {
      hideStylePanel();
    } else {
      showStylePanel(el);
    }
  }
  // [defensive] 初始化样式面板的副作用（包了 try/catch，
  // 任何错误都不影响主编辑器）
  function __hceInitStylePanel() {
    try {
      // 包装 hideTools 以便也关闭样式面板（如果 hideTools 已经存在）
      if (typeof hideTools === 'function') {
        var _origHideTools = hideTools;
        hideTools = function() {
          try { _origHideTools(); } catch (e) {}
          try { hideStylePanel(); } catch (e) {}
        };
      }
      window.addEventListener('scroll', function() {
        if (styleTarget && stylePanel && stylePanel.style.display === 'block') {
          try { positionStylePanel(styleTarget); } catch (e) {}
        }
      }, true);
    } catch (e) {
      console.warn('[hce] style panel init error:', e);
    }
  }

  // ─── 主初始化（必须先跑，不能被 style panel 影响） ───
  applyMode('edit');
  window.parent.postMessage({ type: 'ready' }, '*');

  // 现在再绑 style panel 的全局事件
  __hceInitStylePanel();
})();
</scr` + `ipt>`;
}
