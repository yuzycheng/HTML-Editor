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
  /* Editor scroll fix — many uploaded pages (esp. slide decks) set
     overflow:hidden on html/body; in the editor the iframe is short, so the
     bottom gets clipped with no way to scroll. Force the document scrollable
     so users can reach and edit all of it. (Editor-only; not exported.) */
  html, body { overflow: auto !important; }
  /* Safety net for stray list items. A <li> that (via a drag, a paste, or a
     bad edit) ends up as a direct child of something that ISN'T a list still
     has display:list-item, so the browser paints a native disc marker the user
     can't select or delete — the "•·" double-bullet bug. Neutralise any li that
     isn't inside a real list so it renders as a plain block with no phantom
     marker. Real lists (ul/ol/menu) are unaffected. */
  :not(ul):not(ol):not(menu) > li {
    display: block !important;
    list-style: none !important;
  }
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

  /* ───── Block bound to a URL: dashed badge while editing / dragging ───── */
  body[data-mode="edit"] [data-hce-href], body[data-mode="drag"] [data-hce-href] {
    outline: 1px dashed rgba(255, 90, 31, 0.55) !important;
    outline-offset: 3px;
    cursor: pointer;
  }

  /* ───── Drag mode: blocks are grabbable, text isn't selectable ───── */
  body[data-mode="drag"] { user-select: none; -webkit-user-select: none; }
  body[data-mode="drag"] [data-hce-draggable="1"] { cursor: grab; }
  body[data-mode="drag"] [data-hce-draggable="1"]:hover { outline: 1.5px dashed rgba(255, 90, 31, 0.55) !important; outline-offset: 2px; }
  /* Only the innermost hovered unit keeps its outline, so a card and the
     heading/body inside it never draw stacked (nested) dashed boxes. */
  body[data-mode="drag"] [data-hce-draggable="1"]:has([data-hce-draggable="1"]:hover) { outline: none !important; }
  #__hce-tools .blink.bound { color: #ff5a1f; }

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

  /* ───── Notion-style table controls: row/column bars + drag grip ───── */
  #__hce-tablectl { position: fixed; z-index: 99990; top: 0; left: 0; display: none; pointer-events: none; }
  #__hce-tablectl.on { display: block; }
  #__hce-tablectl .tc-seg {
    position: fixed; pointer-events: auto; box-sizing: border-box;
    background: #f1f0ee; border: 1px solid #e2ded9; border-radius: 3px;
    cursor: grab; display: flex; align-items: center; justify-content: center;
    color: #b3ada6; transition: background .12s ease, color .12s ease, border-color .12s ease;
  }
  body[data-mode="edit"] #__hce-tablectl .tc-seg { cursor: pointer; }
  #__hce-tablectl .tc-seg:hover { background: #ff5a1f; border-color: #ff5a1f; color: #fff; }
  #__hce-tablectl .tc-seg.active { background: #ff5a1f; border-color: #ff5a1f; color: #fff; }
  #__hce-tablectl .tc-seg.dragging { background: #ff5a1f; border-color: #ff5a1f; color: #fff; cursor: grabbing; opacity: .92; }
  #__hce-tablectl .tc-seg svg { width: 12px; height: 12px; display: block; }
  #__hce-tablectl .tc-grip {
    position: fixed; pointer-events: auto; box-sizing: border-box;
    background: #ffffff; border: 1px solid #e2ded9; border-radius: 4px;
    cursor: grab; display: flex; align-items: center; justify-content: center;
    color: #a8a29e; box-shadow: 0 1px 3px rgba(15,23,42,.12);
    transition: color .12s ease, border-color .12s ease;
  }
  #__hce-tablectl .tc-grip:hover { color: #ff5a1f; border-color: #ff5a1f; }
  #__hce-tablectl .tc-grip:active { cursor: grabbing; }
  #__hce-tablectl .tc-grip svg { width: 14px; height: 14px; display: block; }
  #__hce-tablectl .tc-add {
    position: fixed; pointer-events: auto; box-sizing: border-box;
    background: #ffffff; border: 1px dashed #d6d3d0; border-radius: 3px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: #b3ada6; transition: background .12s ease, color .12s ease, border-color .12s ease;
  }
  #__hce-tablectl .tc-add:hover { background: #fff4ee; border-color: #ff5a1f; color: #ff5a1f; }
  #__hce-tablectl .tc-add svg { width: 12px; height: 12px; display: block; }

  /* Popover menu shown when a row/column segment is clicked */
  #__hce-table-menu {
    position: fixed; z-index: 99999; display: none; min-width: 156px;
    background: #ffffff; border: 1px solid #e7e5e4; border-radius: 11px;
    padding: 5px; box-shadow: 0 12px 30px rgba(15,23,42,.14), 0 3px 8px rgba(15,23,42,.08);
    font: 500 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #__hce-table-menu button {
    display: flex; align-items: center; gap: 9px; width: 100%;
    background: transparent; border: none; color: #44403c;
    padding: 8px 10px; border-radius: 7px; cursor: pointer; font-size: 13px; text-align: left;
  }
  #__hce-table-menu button svg { width: 15px; height: 15px; flex: 0 0 auto; color: #78716c; }
  #__hce-table-menu button:hover { background: #f5f5f4; color: #1a1a1a; }
  #__hce-table-menu button.danger:hover { background: #fee2e2; color: #991b1b; }
  #__hce-table-menu button.danger svg { color: #b91c1c; }
  #__hce-table-menu .m-sep { height: 1px; background: #f0efec; margin: 4px 6px; }
  body[data-mode="edit"] [data-block-id].__hce-selected-tools {
    /* Orange so it's clearly visible on both light and dark backgrounds
       (the previous dark outline vanished on dark slide decks). This is the
       single selection box; the JS hover overlay is suppressed for it. */
    outline: 1.5px solid rgba(255, 90, 31, 0.9) !important;
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
    if (typeof hideTableMenu === 'function') hideTableMenu();
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
    if (m !== 'edit' && m !== 'drag' && typeof hideTools === 'function') hideTools();
    if (typeof sweepDragStyles === 'function') sweepDragStyles();   // recover any stranded dimmed block
    if (typeof refreshDragEligibilityMarks === 'function') refreshDragEligibilityMarks();
    // Blocks bound to a URL show a pointer cursor in edit/view; in view mode a
    // click navigates (handled below). Keep the cursor in sync on every switch.
    document.querySelectorAll('[data-hce-href]').forEach(function (el) { el.style.cursor = 'pointer'; });
    // Videos play only in View — freeze them to selectable posters elsewhere.
    if (typeof refreshVideoState === 'function') refreshVideoState();
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
    }, ms);
  });

  // Explicit removal: Backspace/Delete inside an already-empty leaf removes
  // the containing line (or the leaf itself if no line ancestor exists).
  document.addEventListener('keydown', function(e) {
    if (mode !== 'edit') return;
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    var el = e.target.closest && e.target.closest('[data-hce-text]');
    if (!el) return;
    // Inside a table cell, Backspace/Delete must only clear that cell's own
    // text (normal contenteditable behavior) — never delete the row or cell.
    // Removing rows/columns is done explicitly via the table control menu.
    if (el.closest('td, th')) return;
    if (el.textContent.length === 0) {
      e.preventDefault();
      requestRemove(findRemovableAncestor(el));
    }
  });

  // Thin forwarder used by the beforeinput historyUndo fallback (some
  // browsers fire historyUndo without going through keydown). The main
  // ⌘Z / ⌘⇧Z path is the capture-phase keydown handler defined later.
  function forwardUndo(isRedo) {
    for (var k in lastLocalInputAt) delete lastLocalInputAt[k];
    window.parent.postMessage({
      type: isRedo ? 'request-redo' : 'request-undo'
    }, '*');
  }
  document.addEventListener('beforeinput', function(e) {
    if (e.inputType === 'historyUndo') { e.preventDefault(); forwardUndo(false); }
    if (e.inputType === 'historyRedo') { e.preventDefault(); forwardUndo(true); }
  });

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
    // Climb past inline-level text runs (the marker "1." span, <strong>, <em>,
    // <a>, plain <span>) to the block they live in — a list item / paragraph is
    // the unit people mean to grab, so the marker never splits off on its own.
    // Exception: in drag mode an inline run that is itself a stack unit (a card's
    // body line) IS the grab target, so inner card reordering works.
    while (el && el !== document.body && el !== document.documentElement) {
      if (mode === 'drag' && isDraggableUnit(el)) break;
      if (getComputedStyle(el).display !== 'inline') break;
      var par = el.parentElement && el.parentElement.closest('[data-block-id]');
      if (!par || par === document.body || par === document.documentElement) break;
      el = par;
    }
    // Refuse to target <body> / <html> — would nuke the whole doc.
    // In edit mode a cell must remain the target so text colour / weight /
    // alignment applies to that cell only and the dedicated row/column bars
    // can use its id. Other modes keep the historical table-level target for
    // whole-table delete, comment and drag behaviour.
    if (mode !== 'edit' && el && (el.tagName === 'TD' || el.tagName === 'TH')) {
      var tbl = el.closest && el.closest('table[data-block-id], table');
      if (tbl && tbl.getAttribute && tbl.getAttribute('data-block-id')) el = tbl;
    }
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
  }

  // Only blocks that can produce a meaningful structural move should show drag
  // affordances. Table internals (td/tr/th/thead/...) are edited via dedicated
  // table tools and are intentionally excluded from generic drag mode.
  function isDragMovableBlock(el) {
    if (!el || !el.hasAttribute || !el.hasAttribute('data-block-id')) return false;
    if (el === document.body || el === document.documentElement) return false;
    var t = el.tagName;
    if (t === 'TD' || t === 'TH' || t === 'TR' || t === 'TBODY' || t === 'THEAD' || t === 'TFOOT' || t === 'CAPTION' || t === 'COLGROUP' || t === 'COL') return false;
    return true;
  }

  function computedDisplay(el) {
    try { return getComputedStyle(el).display; } catch (e) { return ''; }
  }

  // A horizontally-laid-out card — a grid with 2+ columns, or a flex row — packs
  // its children side by side as ONE composite (e.g. a "label | content" card).
  // Those columns must move together: dragging one out on its own tears the card
  // apart and scrambles the layout. So we treat the whole container as a single
  // drag unit and never its individual columns. Excluded: our own place-beside
  // rows (data-hce-row), which are meant to stay individually reorderable; and
  // page-height shells (taller than the viewport), which are layout wrappers,
  // not cards.
  function isHorizontalContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && el.hasAttribute('data-hce-row')) return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    var disp = cs.display, horiz = false;
    if (disp === 'flex' || disp === 'inline-flex') {
      horiz = (cs.flexDirection || '').indexOf('row') === 0;   // row / row-reverse
    } else if (disp === 'grid' || disp === 'inline-grid') {
      var cols = (cs.gridTemplateColumns || '').trim();
      horiz = !!cols && cols !== 'none' && cols.split(/\\s+/).length >= 2;
    }
    if (!horiz) return false;
    var vh = window.innerHeight || 600;
    return el.getBoundingClientRect().height <= vh;   // a card is short; a shell isn't
  }

  // Walk an element's block ancestors: if any is a horizontal card, this element
  // is one of its bound columns / contents and must not drag on its own.
  function insideHorizontalCard(el) {
    var p = el && el.parentElement ? el.parentElement.closest('[data-block-id]') : null;
    while (p && p !== document.body && p !== document.documentElement) {
      if (isHorizontalContainer(p)) return p;
      p = p.parentElement ? p.parentElement.closest('[data-block-id]') : null;
    }
    return null;
  }

  // A column of a horizontal card that CAN be reordered — but only among its
  // sibling columns in the SAME row (so cards swap places without being torn
  // out of the row). True when el's DIRECT block parent is a horizontal card and
  // that card has >= 2 column children. (insideHorizontalCard walks all
  // ancestors and is used to forbid pulling a column OUT; this one, stricter,
  // asks "is el itself a directly-reorderable column of its row?".)
  function horizontalRowParent(el) {
    if (!el || !el.parentElement) return null;
    var p = el.parentElement.closest('[data-block-id]');
    if (!p || !isHorizontalContainer(p)) return null;
    var cols = 0;
    for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c.nodeType === 1 && c.hasAttribute('data-block-id') && isDragMovableBlock(c)) cols++;
    }
    return cols >= 2 ? p : null;
  }
  function isHorizontalColumn(el) {
    return !!horizontalRowParent(el);
  }
  // Decide how a direct child of a horizontal layout should be duplicated.
  // Grids and wrapping flex rows can safely keep the clone beside the source:
  // the original CSS then gives it exactly the same column geometry and drag
  // semantics. A non-wrapping flex row may shrink or overflow, so only that
  // case detaches the clone below the row and carries its current width along.
  function horizontalDuplicatePlan(el) {
    var row = horizontalRowParent(el);
    if (!row) return null;
    var cs = getComputedStyle(row);
    var isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
    var gridFlowsByColumn = isGrid && (cs.gridAutoFlow || '').indexOf('column') !== -1;
    var flexCanWrap = (cs.display === 'flex' || cs.display === 'inline-flex') && cs.flexWrap !== 'nowrap';
    if ((isGrid && !gridFlowsByColumn) || flexCanWrap) return { inPlace: true };
    var r = el.getBoundingClientRect();
    return {
      inPlace: false,
      afterId: row.getAttribute('data-block-id'),
      width: Math.round(r.width * 1000) / 1000
    };
  }

  // A "stack" container holds several stacked child blocks meant to be reordered
  // among themselves — e.g. a quick card <div class=q><b>title</b><span>body
  // </span></div>, where heading and body are two lines the user may want to
  // swap. We treat a parent as a stack only when it holds >= 2 child blocks AND
  // at least one renders on its own line (display != inline). That is what tells
  // a real card apart from a plain sentence whose words happen to be wrapped in
  // inline <span>/<b> runs. List items / paragraphs / headings / links are never
  // stacks: their inline children are fragments of one sentence, so only the
  // whole line should move, and no nested dashed box is drawn inside it.
  function isReorderableStack(parent) {
    if (!parent || parent.nodeType !== 1) return false;
    var pt = parent.tagName;
    if (pt === 'LI' || pt === 'P' || pt === 'A' || pt === 'H1' || pt === 'H2' ||
        pt === 'H3' || pt === 'H4' || pt === 'H5' || pt === 'H6') return false;
    var count = 0, hasBlockLine = false;
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (!c.hasAttribute || !c.hasAttribute('data-block-id')) continue;
      if (!isDragMovableBlock(c)) continue;
      count++;
      if (computedDisplay(c) !== 'inline') hasBlockLine = true;
    }
    return count >= 2 && hasBlockLine;
  }

  // The unit a drag actually grabs. A normal block is its own unit. An inline
  // text run is a unit ONLY when it lives in a stack (a card's heading/body) —
  // so cards allow inner reordering, while a sentence's inline emphasis never
  // splits off on its own and never draws a confusing nested dashed box.
  function isDraggableUnit(el) {
    if (!isDragMovableBlock(el)) return false;
    // A column of a horizontal card MAY reorder among its sibling columns in the
    // same row (so two cards can swap places), but it must not be pulled out of
    // the row on its own. So: if el is itself a direct column of its row, it IS
    // a drag unit (sibling reorder is allowed, constrained later in the drop
    // logic). If el is nested DEEPER inside a column (a heading/body within it),
    // it is not — the whole column/card moves together.
    if (isHorizontalColumn(el)) return true;
    if (insideHorizontalCard(el)) return false;
    if (computedDisplay(el) !== 'inline') return true;
    return isReorderableStack(el.parentElement);
  }

  function draggableAncestor(el) {
    var cur = el;
    while (cur && !isDraggableUnit(cur)) {
      cur = cur.parentElement ? cur.parentElement.closest('[data-block-id]') : null;
    }
    return cur;
  }

  // Find the nearest draggable ancestor block from any node.
  function dragTargetFromNode(node) {
    return draggableAncestor(pickTarget(node));
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
  var lastClickDeepest = null;   // for click-to-climb: the deepest block last clicked

  function svgIcon(paths) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_PLUS = svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');
  var ICON_X    = svgIcon('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>');
  var ICON_IMG  = svgIcon('<rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M21 14l-4.5-4.5L5 18"/>');
  var ICON_COPY = svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
  var ICON_VIDEO = svgIcon('<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>');
  var ICON_SWAP = svgIcon('<path d="M16 3l4 4-4 4"/><path d="M20 7H8"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h12"/>');
  var ICON_CROP = svgIcon('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>');
  var ICON_CHECK = svgIcon('<polyline points="20 6 9 17 4 12"/>');
  // Drag grip — 2×3 dots (filled).
  var ICON_GRIP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
  // Horizontal grip — 3 dots in a row, for the thin column bar segments.
  var ICON_GRIP_H = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>';
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
  // Table icon: a framed 3×3 grid.
  var ICON_TABLE = svgIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>');
  // Link icon: two interlocking chain links.
  var ICON_LINK = svgIcon('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>');

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
      // Table cells: the row / column controls now live on the Notion-style
      // bars that hug the table (see showTableControls). The cell toolbar keeps
      // only what's cell-local: insert media/link INTO the cell, bind a link on
      // the whole cell, and style it.
      var cellLinkTarget = blockLinkTarget(toolsTarget);
      var cellHasLink = !!cellLinkTarget;
      tools.innerHTML =
          '<button class="add" title="' + pt('tb_add') + '">' + ICON_PLUS + '</button>'
        + '<span class="sep"></span>'
        + '<button class="blink' + (cellHasLink ? ' bound' : '') + '" title="' + pt(cellHasLink ? 'tb_blink_on' : 'tb_blink') + '">' + ICON_LINK + '</button>'
        + '<button class="style" title="' + pt('tb_cell_style_t') + '">' + ICON_STYLE + '</button>';
      tools.querySelector('.add').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        // Insert image / video / link INTO this cell (not below the table).
        if (toolsTarget) openAddMenu(toolsTarget, e.currentTarget, true);
      });
      tools.querySelector('.blink').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (toolsTarget) openBlockLinkMenu(cellLinkTarget || toolsTarget, e.currentTarget);
      });
      tools.querySelector('.style').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        toggleStylePanel(toolsTarget, e.currentTarget);   // toolsTarget is the td/th cell
      });
    } else {
      var tIsEmbedVideo = toolsTarget && toolsTarget.tagName === 'IFRAME' && toolsTarget.getAttribute('data-hce-video') === 'embed';
      var tIsMedia = toolsTarget && (toolsTarget.tagName === 'IMG' || toolsTarget.tagName === 'VIDEO' || toolsTarget.tagName === 'AUDIO' || tIsEmbedVideo);
      var tIsImage = toolsTarget && toolsTarget.tagName === 'IMG';
      var tIsLink = toolsTarget && toolsTarget.tagName === 'A' && toolsTarget.hasAttribute('data-hce-link');
      var tBlockLinkTarget = blockLinkTarget(toolsTarget);
      var tHasLink = !!tBlockLinkTarget;
      // "+" inserts a new image / video frame right BELOW this block (the
      // audio-visual-document flow). Media blocks additionally get a "replace"
      // button; existing media can also be swapped image↔video from its menu.
      // An <img> also gets a "crop" button to frame which part of it shows.
      tools.innerHTML =
          '<button class="add" title="' + pt('tb_add') + '">' + ICON_PLUS + '</button>'
        + '<span class="sep"></span>'
        + '<button class="dup" title="' + pt('tb_dup') + '">' + ICON_COPY + '</button>'
        + (tIsMedia ? '<button class="replace" title="' + pt('tb_replace') + '">' + ICON_IMG + '</button>' : '')
        + (tIsLink ? '<button class="link-edit" title="' + pt('tb_link_edit') + '">' + ICON_LINK + '</button>' : '')
        + (tIsImage ? '<button class="crop" title="' + pt('tb_crop') + '">' + ICON_CROP + '</button>' : '')
        + (!tIsMedia && !tIsLink ? '<button class="blink' + (tHasLink ? ' bound' : '') + '" title="' + pt(tHasLink ? 'tb_blink_on' : 'tb_blink') + '">' + ICON_LINK + '</button>' : '')
        + (!tIsMedia ? '<button class="style" title="' + pt('tb_style_t') + '">' + ICON_STYLE + '</button>' : '')
        + '<button class="del" title="' + pt('tb_del') + '">' + ICON_X + '</button>';
      tools.querySelector('.add').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (toolsTarget) openAddMenu(toolsTarget, e.currentTarget);
      });
      if (tIsMedia) {
        tools.querySelector('.replace').addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          if (toolsTarget) openMediaMenu(toolsTarget, e.currentTarget, mediaKindOf(toolsTarget));
        });
      }
      if (tIsLink) {
        tools.querySelector('.link-edit').addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          if (toolsTarget) openMediaMenu(toolsTarget, e.currentTarget, 'link');
        });
      }
      if (!tIsMedia && !tIsLink) {
        tools.querySelector('.blink').addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          if (toolsTarget) openBlockLinkMenu(tBlockLinkTarget || toolsTarget, e.currentTarget);
        });
      }
      if (tIsImage) {
        tools.querySelector('.crop').addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          var img = toolsTarget;
          if (!img) return;
          if (tools) tools.style.display = 'none';
          startCrop(img);
        });
      }
      tools.querySelector('.dup').addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        var dupMsg = {
          type: 'request-block-duplicate',
          id: toolsTarget.getAttribute('data-block-id')
        };
        // Keep grid/wrapping-layout copies in their original CSS context so the
        // clone stays proportional and remains a normal sibling drag target.
        // Only a nowrap row detaches; preserve its rendered width in that case.
        var dupPlan = horizontalDuplicatePlan(toolsTarget);
        if (dupPlan && !dupPlan.inPlace && dupPlan.afterId) {
          dupMsg.afterId = dupPlan.afterId;
          dupMsg.layout = {
            sourceId: toolsTarget.getAttribute('data-block-id'),
            width: dupPlan.width
          };
        }
        window.parent.postMessage(dupMsg, '*');
        hideTools();
      });
      // [ADDITION] Style button — toggles the style panel. Media (image/video)
      // has no color palette, so the button isn't rendered for it.
      var styleBtn = tools.querySelector('.style');
      if (styleBtn) styleBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (!toolsTarget) return;
        toggleStylePanel(toolsTarget, e.currentTarget);
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
    unpinHandle();
    hideTableControls();
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
    // Cells use the dedicated row/column controls; generic resize grips on a
    // single td/th would distort the table while the user is styling text.
    if (cellId) unpinHandle();
    else pinHandleTo(el);   // keep resize grips pinned to normal blocks
    var r = el.getBoundingClientRect();
    t.style.display = 'flex';
    requestAnimationFrame(function() {
      var w = t.offsetWidth || 70;
      var vh = window.innerHeight || 800;
      var top = Math.max(4, Math.min(vh - 36, r.top - 36));
      var left = Math.min(window.innerWidth - w - 4, r.right - w);
      t.style.top = top + 'px';
      t.style.left = Math.max(4, left) + 'px';
    });
    // Selecting a table cell reveals the Notion-style row/column bars + grip.
    if (cellId) {
      var tbl = el.closest ? el.closest('table[data-block-id]') : null;
      if (tbl) showTableControls(tbl); else hideTableControls();
    } else {
      hideTableControls();
    }
  }

  // ─── Notion / Feishu-style table controls ───
  // A floating overlay that hugs a table: a column bar on top, a row bar on the
  // left, a drag grip at the corner, and "+" strips to append a column / row.
  // Clicking a segment opens a compact insert/delete menu. This replaces the
  // old cramped cell toolbar buttons and gives tables a clear drag affordance.
  var tableCtl = null;          // overlay container
  var tableMenu = null;         // segment popover
  var tableCtlId = null;        // data-block-id of the table currently shown
  var tableCtlReshow = null;    // table id to re-show after a replace-element swap

  function cellsInRow(row) {
    var out = [];
    for (var c = row.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === 'TD' || c.tagName === 'TH') out.push(c);
    }
    return out;
  }
  function tableRows(table) {
    var out = [];
    var all = table.querySelectorAll('tr');
    for (var i = 0; i < all.length; i++) if (cellsInRow(all[i]).length) out.push(all[i]);
    return out;
  }
  // True when a table has something to reorder INSIDE it — more than one column
  // or more than one row. Used to decide whether to show the row/column bars in
  // drag mode, independent of whether the whole table can be moved elsewhere.
  function tableHasReorderableParts(table) {
    if (!table) return false;
    var rows = tableRows(table);
    if (!rows.length) return false;
    var cols = cellsInRow(rows[0]).length;
    return rows.length >= 2 || cols >= 2;
  }
  function ensureTableCtl() {
    if (tableCtl) return tableCtl;
    tableCtl = document.createElement('div');
    tableCtl.id = '__hce-tablectl';
    tableCtl.setAttribute('contenteditable', 'false');
    document.body.appendChild(tableCtl);
    tableMenu = document.createElement('div');
    tableMenu.id = '__hce-table-menu';
    tableMenu.setAttribute('contenteditable', 'false');
    document.body.appendChild(tableMenu);
    return tableCtl;
  }
  function hideTableMenu() {
    if (tableMenu) { tableMenu.style.display = 'none'; tableMenu.innerHTML = ''; }
    if (tableCtl) {
      var a = tableCtl.querySelector('.tc-seg.active');
      if (a) a.classList.remove('active');
    }
  }
  function hideTableControls() {
    hideTableMenu();
    if (tableCtl) {
      tableCtl.classList.remove('on');
      tableCtl.style.display = 'none';
      tableCtl.innerHTML = '';
      tableCtl._mode = null;
    }
    tableCtlId = null;
  }
  // Build (or rebuild) the bars for the table and position everything.
  function showTableControls(table) {
    if (!table || !table.getAttribute) return;
    if (mode !== 'edit' && mode !== 'drag') { hideTableControls(); return; }
    var rows = tableRows(table);
    if (!rows.length) { hideTableControls(); return; }
    // Already showing this exact table → just reposition (cheap; scroll path).
    if (tableCtl && tableCtlId === table.getAttribute('data-block-id') &&
        tableCtl._table === table && tableCtl._mode === mode &&
        tableCtl.classList.contains('on')) {
      positionTableControls();
      return;
    }
    ensureTableCtl();
    tableCtlId = table.getAttribute('data-block-id');
    tableCtl.innerHTML = '';
    tableCtl._table = table;
    tableCtl._mode = mode;

    // Drag grip — the clear affordance for moving the whole table. Drag mode
    // only: in edit mode the overlay is for editing rows / columns, not moving.
    if (mode === 'drag') {
      var grip = document.createElement('div');
      grip.className = 'tc-grip';
      grip.title = pt('ti_drag');
      grip.innerHTML = ICON_GRIP;
      grip.addEventListener('mousedown', function (e) {
        e.preventDefault(); e.stopPropagation();
        hideTableMenu();
        hideTableControls();
        startBlockDrag(table, e);
      });
      grip.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      tableCtl.appendChild(grip);
    }

    // Column segments — one per column, using the first row's cells for extent.
    var headCells = cellsInRow(rows[0]);
    var ci;
    for (ci = 0; ci < headCells.length; ci++) {
      (function (idx) {
        var repId = headCells[idx].getAttribute('data-block-id');
        var seg = document.createElement('div');
        seg.className = 'tc-seg tc-col';
        seg.setAttribute('data-idx', String(idx));
        seg.title = pt(mode === 'drag' ? 'ti_col_drag' : 'ti_col_menu');
        seg.innerHTML = ICON_GRIP_H;
        seg.addEventListener('mousedown', function (e) {
          if (mode !== 'drag') { e.preventDefault(); e.stopPropagation(); return; }
          startSegInteraction(e, seg, 'col', idx, repId, idx === headCells.length - 1);
        });
        seg.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (mode !== 'drag') openColMenu(seg, repId, idx === headCells.length - 1);
        });
        tableCtl.appendChild(seg);
      })(ci);
    }

    // Row segments — one per row, using each row's first cell.
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      (function (idx) {
        var first = cellsInRow(rows[idx])[0];
        var repId = first.getAttribute('data-block-id');
        var seg = document.createElement('div');
        seg.className = 'tc-seg tc-row';
        seg.setAttribute('data-idx', String(idx));
        seg.title = pt(mode === 'drag' ? 'ti_row_drag' : 'ti_row_menu');
        seg.innerHTML = ICON_GRIP;
        seg.addEventListener('mousedown', function (e) {
          if (mode !== 'drag') { e.preventDefault(); e.stopPropagation(); return; }
          startSegInteraction(e, seg, 'row', idx, repId, idx === rows.length - 1);
        });
        seg.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (mode !== 'drag') openRowMenu(seg, repId, idx === rows.length - 1);
        });
        tableCtl.appendChild(seg);
      })(ri);
    }

    // "+" strips are edit-only controls.
    if (mode === 'edit') {
      var lastColId = headCells.length ? headCells[headCells.length - 1].getAttribute('data-block-id') : null;
      var lastRowId = cellsInRow(rows[rows.length - 1])[0].getAttribute('data-block-id');
      var addCol = document.createElement('div');
      addCol.className = 'tc-add tc-add-col';
      addCol.title = pt('ti_add_col');
      addCol.innerHTML = ICON_PLUS;
      addCol.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
      addCol.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!lastColId) return;
        tableCtlReshow = tableCtlId;
        hideTools();
        window.parent.postMessage({ type: 'request-col-insert', id: lastColId, right: true }, '*');
      });
      tableCtl.appendChild(addCol);
      var addRow = document.createElement('div');
      addRow.className = 'tc-add tc-add-row';
      addRow.title = pt('ti_add_row');
      addRow.innerHTML = ICON_PLUS;
      addRow.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
      addRow.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        tableCtlReshow = tableCtlId;
        hideTools();
        window.parent.postMessage({ type: 'request-row-insert', id: lastRowId, below: true }, '*');
      });
      tableCtl.appendChild(addRow);
    }

    tableCtl.classList.add('on');
    tableCtl.style.display = 'block';
    positionTableControls();
  }
  // Position the bars from the live table + cell rects (called on scroll too).
  function positionTableControls() {
    if (!tableCtl || tableCtlId == null) return;
    var table = tableCtl._table;
    if (!table || !document.contains(table)) { hideTableControls(); return; }
    var rows = tableRows(table);
    if (!rows.length) { hideTableControls(); return; }
    var tr = table.getBoundingClientRect();
    var BAR = 15, GAP = 3;
    var barTop = tr.top - GAP - BAR;
    var barLeft = tr.left - GAP - BAR;

    var grip = tableCtl.querySelector('.tc-grip');
    if (grip) { grip.style.left = barLeft + 'px'; grip.style.top = barTop + 'px'; grip.style.width = BAR + 'px'; grip.style.height = BAR + 'px'; }

    var headCells = cellsInRow(rows[0]);
    var cols = tableCtl.querySelectorAll('.tc-seg.tc-col');
    var i;
    for (i = 0; i < cols.length; i++) {
      var hc = headCells[i];
      if (!hc) { cols[i].style.display = 'none'; continue; }
      var cr = hc.getBoundingClientRect();
      cols[i].style.display = 'flex';
      cols[i].style.left = (cr.left + 1) + 'px';
      cols[i].style.top = barTop + 'px';
      cols[i].style.width = Math.max(8, cr.width - 2) + 'px';
      cols[i].style.height = BAR + 'px';
    }
    var rowSegs = tableCtl.querySelectorAll('.tc-seg.tc-row');
    for (i = 0; i < rowSegs.length; i++) {
      var rw = rows[i];
      if (!rw) { rowSegs[i].style.display = 'none'; continue; }
      var rr = rw.getBoundingClientRect();
      rowSegs[i].style.display = 'flex';
      rowSegs[i].style.left = barLeft + 'px';
      rowSegs[i].style.top = (rr.top + 1) + 'px';
      rowSegs[i].style.width = BAR + 'px';
      rowSegs[i].style.height = Math.max(8, rr.height - 2) + 'px';
    }
    var addCol = tableCtl.querySelector('.tc-add-col');
    if (addCol) { addCol.style.left = (tr.right + GAP) + 'px'; addCol.style.top = tr.top + 'px'; addCol.style.width = BAR + 'px'; addCol.style.height = Math.max(BAR, tr.height) + 'px'; }
    var addRow = tableCtl.querySelector('.tc-add-row');
    if (addRow) { addRow.style.left = tr.left + 'px'; addRow.style.top = (tr.bottom + GAP) + 'px'; addRow.style.width = Math.max(BAR, tr.width) + 'px'; addRow.style.height = BAR + 'px'; }
  }
  function tableMenuButton(cls, icon, label) {
    return '<button class="' + cls + '">' + icon + '<span>' + label + '</span></button>';
  }
  function placeTableMenu(anchorSeg) {
    var r = anchorSeg.getBoundingClientRect();
    tableMenu.style.display = 'block';
    var mw = tableMenu.offsetWidth || 160, mh = tableMenu.offsetHeight || 120;
    var vw = window.innerWidth || 800, vh = window.innerHeight || 600;
    var left = Math.min(r.left, vw - mw - 6);
    var top = r.bottom + 6;
    if (top + mh > vh - 6) top = Math.max(6, r.top - mh - 6);
    tableMenu.style.left = Math.max(6, left) + 'px';
    tableMenu.style.top = Math.max(6, top) + 'px';
  }
  function openColMenu(seg, cellId, isLast) {
    hideTableMenu();
    seg.classList.add('active');
    tableMenu.innerHTML =
        tableMenuButton('ins-left', ICON_PLUS, pt('ti_col_left'))
      + tableMenuButton('ins-right', ICON_PLUS, pt('ti_col_right'))
      + '<div class="m-sep"></div>'
      + tableMenuButton('del danger', ICON_X, pt('ti_col_del'));
    tableMenu.querySelector('.ins-left').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      tableCtlReshow = tableCtlId; hideTools();
      window.parent.postMessage({ type: 'request-col-insert', id: cellId, right: false }, '*');
    });
    tableMenu.querySelector('.ins-right').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      tableCtlReshow = tableCtlId; hideTools();
      window.parent.postMessage({ type: 'request-col-insert', id: cellId, right: true }, '*');
    });
    tableMenu.querySelector('.del').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      hideTools();
      window.parent.postMessage({ type: 'request-column-delete', id: cellId }, '*');
    });
    placeTableMenu(seg);
  }
  function openRowMenu(seg, cellId, isLast) {
    hideTableMenu();
    seg.classList.add('active');
    tableMenu.innerHTML =
        tableMenuButton('ins-above', ICON_PLUS, pt('ti_row_above'))
      + tableMenuButton('ins-below', ICON_PLUS, pt('ti_row_below'))
      + '<div class="m-sep"></div>'
      + tableMenuButton('del danger', ICON_X, pt('ti_row_del'));
    tableMenu.querySelector('.ins-above').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      tableCtlReshow = tableCtlId; hideTools();
      window.parent.postMessage({ type: 'request-row-insert', id: cellId, below: false }, '*');
    });
    tableMenu.querySelector('.ins-below').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      tableCtlReshow = tableCtlId; hideTools();
      window.parent.postMessage({ type: 'request-row-insert', id: cellId, below: true }, '*');
    });
    tableMenu.querySelector('.del').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      hideTools();
      // The parent's resolveStructuralTarget lifts this cell id to its TR.
      window.parent.postMessage({ type: 'request-block-delete', id: cellId }, '*');
    });
    placeTableMenu(seg);
  }

  // ─── Drag a row / column segment to REORDER it (Notion / Feishu style) ───
  // A press that stays put is a click (opens the insert/delete menu); a press
  // that moves past a small threshold becomes a reorder drag with an orange
  // drop line, and releasing drops the whole row/column at that gap.
  var segDrag = null;           // active segment interaction
  var segDropLine = null;       // orange insertion indicator
  function startSegInteraction(e, seg, type, idx, cellId, isLast) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    hideTableMenu();
    segDrag = { seg: seg, type: type, idx: idx, cellId: cellId, isLast: isLast,
      startX: e.clientX, startY: e.clientY, dragging: false, toIndex: null };
    document.addEventListener('mousemove', onSegMove, true);
    document.addEventListener('mouseup', onSegUp, true);
    document.addEventListener('keydown', onSegKey, true);
  }
  function onSegMove(e) {
    if (!segDrag) return;
    if (!segDrag.dragging) {
      if (Math.abs(e.clientX - segDrag.startX) < 5 && Math.abs(e.clientY - segDrag.startY) < 5) return;
      segDrag.dragging = true;
      segDrag.seg.classList.add('dragging');
      ensureSegDropLine();
    }
    updateSegDrop(e);
  }
  function onSegUp() { endSegDrag(true); }
  function onSegKey(e) { if (e.key === 'Escape' && segDrag) { e.preventDefault(); endSegDrag(false); } }
  function endSegDrag(commit) {
    document.removeEventListener('mousemove', onSegMove, true);
    document.removeEventListener('mouseup', onSegUp, true);
    document.removeEventListener('keydown', onSegKey, true);
    var sd = segDrag; segDrag = null;
    hideSegDropLine();
    if (!sd) return;
    if (sd.seg) sd.seg.classList.remove('dragging');
    if (!sd.dragging) {
      // Never moved: only edit mode opens insert/delete menus.
      if (commit && mode === 'edit') {
        if (sd.type === 'col') openColMenu(sd.seg, sd.cellId, sd.isLast);
        else openRowMenu(sd.seg, sd.cellId, sd.isLast);
      }
        return;
    }
    if (!commit) return;                                   // Esc cancelled the drag
    if (sd.toIndex == null || sd.toIndex === sd.idx || sd.toIndex === sd.idx + 1) return;   // no-op
    tableCtlReshow = tableCtlId;
    hideTools();
    var msg = (sd.type === 'col') ? 'request-col-move' : 'request-row-move';
    window.parent.postMessage({ type: msg, id: sd.cellId, toIndex: sd.toIndex }, '*');
  }
  // Given the current cursor, work out which gap the row/column would drop into
  // and draw the orange line there.
  function updateSegDrop(e) {
    if (!segDrag || !segDrag.dragging || !tableCtl || !tableCtl._table) return;
    var table = tableCtl._table;
    if (!document.contains(table)) return;
    var tr = table.getBoundingClientRect();
    if (segDrag.type === 'col') {
      var rows = tableRows(table);
      if (!rows.length) return;
      var heads = cellsInRow(rows[0]);
      var x = e.clientX, ins = heads.length, i;
      for (i = 0; i < heads.length; i++) {
        var cr = heads[i].getBoundingClientRect();
        if (x < cr.left + cr.width / 2) { ins = i; break; }
      }
      segDrag.toIndex = ins;
      var lineX;
      if (ins <= 0) lineX = heads[0].getBoundingClientRect().left;
      else if (ins >= heads.length) lineX = heads[heads.length - 1].getBoundingClientRect().right;
      else lineX = heads[ins].getBoundingClientRect().left;
      showSegDropV(lineX, tr.top, tr.height);
    } else {
      var rws = tableRows(table);
      if (!rws.length) return;
      var y = e.clientY, insR = rws.length, j;
      for (j = 0; j < rws.length; j++) {
        var rr = rws[j].getBoundingClientRect();
        if (y < rr.top + rr.height / 2) { insR = j; break; }
      }
      segDrag.toIndex = insR;
      var lineY;
      if (insR <= 0) lineY = rws[0].getBoundingClientRect().top;
      else if (insR >= rws.length) lineY = rws[rws.length - 1].getBoundingClientRect().bottom;
      else lineY = rws[insR].getBoundingClientRect().top;
      showSegDropH(lineY, tr.left, tr.width);
    }
  }
  function ensureSegDropLine() {
    if (segDropLine) return segDropLine;
    segDropLine = document.createElement('div');
    segDropLine.id = '__hce-seg-drop';
    segDropLine.setAttribute('contenteditable', 'false');
    segDropLine.style.cssText = 'position:fixed;z-index:99998;display:none;background:#ff5a1f;'
      + 'border-radius:2px;pointer-events:none;box-shadow:0 0 0 1px rgba(255,255,255,.65);';
    document.body.appendChild(segDropLine);
    return segDropLine;
  }
  function showSegDropV(x, top, h) {
    ensureSegDropLine();
    segDropLine.style.display = 'block';
    segDropLine.style.left = Math.round(x - 1.5) + 'px';
    segDropLine.style.top = Math.round(top) + 'px';
    segDropLine.style.width = '3px';
    segDropLine.style.height = Math.round(h) + 'px';
  }
  function showSegDropH(y, left, w) {
    ensureSegDropLine();
    segDropLine.style.display = 'block';
    segDropLine.style.left = Math.round(left) + 'px';
    segDropLine.style.top = Math.round(y - 1.5) + 'px';
    segDropLine.style.width = Math.round(w) + 'px';
    segDropLine.style.height = '3px';
  }
  function hideSegDropLine() { if (segDropLine) segDropLine.style.display = 'none'; }


  // Click-to-select. Listen on click (not mousedown) so contenteditable
  // focus still works naturally for text leaves.
  document.addEventListener('click', function(e) {
    if (mode !== 'edit') return;
    if (croppingEl) {
      // While cropping: a real click on empty space (off the image and its crop
      // UI) CONFIRMS; a click that is the tail of a drag is ignored.
      if (cropSuppressClick) { cropSuppressClick = false; return; }
      var ct = e.target;
      var inside = ct === croppingEl || (ct.closest && ct.closest('#__hce-crop-bar, #__hce-crop-overlay'));
      if (!inside) endCrop(true);
      return;
    }
    // Alt / Option-click an image → jump straight into crop.
    if (e.altKey && e.target && e.target.tagName === 'IMG' && e.target.getAttribute('data-block-id')) {
      e.preventDefault(); e.stopPropagation();
      startCrop(e.target);
      return;
    }
    if (e.target.closest && e.target.closest('a')) e.preventDefault();   // don't navigate while editing
    if (tools && tools.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#__hce-tablectl,#__hce-table-menu')) return;   // controls handle their own clicks
    // A click on a frozen-video cover already selected the video on mousedown —
    // don't let this handler run pickTarget (which returns null for the cover
    // overlay) and immediately hideTools(), which is why the toolbar vanished
    // the instant the mouse came up.
    if (e.target.closest && e.target.closest('.__hce-video-cover')) return;
    hideTableMenu();   // any other click closes an open row/column popover
    if (e.target.closest && e.target.closest('#__hce-hover-handle')) return;   // grabbing the handle isn't a selection click
    // A browser double-click emits two click events. The second one used to
    // trigger click-to-climb (cell → row → table), replacing the intended word
    // selection with an unexpectedly large orange frame. Keep the first click's
    // target pinned and let native double/triple-click text selection proceed.
    if (e.detail > 1 && e.target.closest && e.target.closest('[data-hce-text][contenteditable]')) return;
    var deepest = pickTarget(e.target);
    if (!deepest) { hideTools(); lastClickDeepest = null; return; }
    // Click-to-climb: a fresh click selects the deepest block under the cursor;
    // clicking the SAME spot again steps up one level (deepest → card → grid →
    // …). Clicking a different spot resets to that spot's deepest block. This
    // keeps normal clicks predictable while still letting you reach big outer
    // containers by clicking again.
    var el = deepest;
    var deepestCell = deepest && deepest.closest ? deepest.closest('td, th') : null;
    if (!deepestCell && toolsTarget && deepest === lastClickDeepest && toolsTarget !== document.body) {
      var up = toolsTarget.parentElement && toolsTarget.parentElement.closest('[data-block-id]');
      if (up && up !== document.body && up !== document.documentElement) el = up;
      else el = toolsTarget;   // already at the top — stay
    }
    lastClickDeepest = deepest;
    // Detect table-cell context for the +row/+col split — but ONLY when the cell
    // itself is the selected block. Clicking media (image/video) or a caption
    // inside a cell selects THAT element and gives it its normal tools (crop,
    // replace, …); the row/column toolbar shows only when the cell is selected.
    var cellAncestor = el && el.closest ? el.closest('td, th') : null;
    var cellId = (cellAncestor && el === cellAncestor && cellAncestor.hasAttribute('data-block-id'))
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
    else if (tableCtlId != null) positionTableControls();
    if (typeof positionVideoCovers === 'function') positionVideoCovers();
  }, true);
  // Keep the frozen-video overlays glued to their elements on window resize too.
  window.addEventListener('resize', function () { if (typeof positionVideoCovers === 'function') positionVideoCovers(); }, true);
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
    // Link navigation is a VIEW-mode-only affordance. In every other mode
    // (edit / drag / block / comment) a click must never navigate — not via a
    // native <a href> and not via a whole-block data-hce-href. Killing the
    // default here, at the very top of the capture-phase handler, closes every
    // leak at once (e.g. clicking a linked image in drag mode used to open the
    // URL because nothing cancelled the browser's native anchor navigation).
    if (mode !== 'view') {
      if (e.target.closest && (e.target.closest('a[href]') || e.target.closest('[data-hce-href]'))) {
        e.preventDefault();
      }
    }
    // View / read mode → no editing. Plain text links and link-bound blocks
    // navigate; everything else is inert so users can read without changing.
    if (mode === 'view') {
      var lnk = e.target.closest && e.target.closest('a[href]');
      if (lnk && lnk.getAttribute('href') && lnk.getAttribute('href') !== '#') return;  // let it navigate
      var bl = e.target.closest && e.target.closest('[data-hce-href]');
      if (bl) {
        var href = bl.getAttribute('data-hce-href');
        if (href && href !== '#') { e.preventDefault(); e.stopPropagation(); window.open(href, '_blank', 'noopener'); }
      }
      return;
    }
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

  // ─── [ADDITION · slide-deck navigation] ───
  // Uploaded interactive decks (reveal.js, impress.js, or custom pages that
  // listen for Arrow keys) need to flip slides even while being edited. Try a
  // known API first, then fall back to dispatching a real Arrow keydown so the
  // deck's own handler runs (synthetic events default keyCode/which to 0, so
  // we redefine them — many decks branch on keyCode 37/39).
  var slidesMode = false;
  var dispatchingNav = false;
  // Slide decks pin slides to height:100vh; in the short editor iframe that
  // clips tall slides with no scroll. When slide mode is on, relax the slide
  // containers so they grow and the doc scrolls (editor-only; not exported).
  function ensureSlideScrollFix(on) {
    var id = '__hce-slide-scrollfix';
    var ex = document.getElementById(id);
    if (!on) { if (ex && ex.parentNode) ex.parentNode.removeChild(ex); return; }
    if (ex) return;
    var st = document.createElement('style');
    st.id = id;
    st.textContent = 'html,body{height:auto !important;min-height:100% !important}' +
      '.slide,section,.step{height:auto !important;min-height:100vh;overflow:visible !important}';
    (document.head || document.documentElement).appendChild(st);
  }
  function navSlide(dir) {
    var right = (dir !== 'left');
    try {
      if (window.Reveal && typeof window.Reveal.right === 'function') {
        right ? window.Reveal.right() : window.Reveal.left();
        return;
      }
    } catch (err) {}
    try {
      if (typeof window.impress === 'function') {
        var api = window.impress();
        if (api && right && api.next) { api.next(); return; }
        if (api && !right && api.prev) { api.prev(); return; }
      }
    } catch (err) {}
    var key = right ? 'ArrowRight' : 'ArrowLeft';
    var code = right ? 39 : 37;
    dispatchingNav = true;
    try {
      ['keydown', 'keyup'].forEach(function(type) {
        var ev;
        try { ev = new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true }); }
        catch (err2) { ev = document.createEvent('Event'); ev.initEvent(type, true, true); }
        try {
          Object.defineProperty(ev, 'keyCode', { get: function() { return code; } });
          Object.defineProperty(ev, 'which', { get: function() { return code; } });
          Object.defineProperty(ev, 'key', { get: function() { return key; } });
        } catch (err3) {}
        // Dispatch on document only — it bubbles to window, and dispatching
        // on body too would bubble back to document and double-fire the deck.
        document.dispatchEvent(ev);
      });
    } finally { dispatchingNav = false; }
  }
  // Keyboard flip: in slides mode, Left/Right flips — unless the user is
  // actively editing text (then arrows move the caret; use the on-screen
  // buttons to flip mid-edit). Capture phase + stop so the deck doesn't also
  // fire on the original key (we drive it ourselves to avoid double-advance).
  document.addEventListener('keydown', function(e) {
    if (!slidesMode || dispatchingNav) return;
    var ae = document.activeElement;
    var editing = ae && ae.closest && ae.closest('[contenteditable=""],[contenteditable="true"],[data-hce-text]');
    if (editing) {
      // Editing text: stop the deck from hijacking the keys it uses to flip
      // slides — ESPECIALLY Space (most decks advance on it), plus arrows and
      // page keys. We only stop propagation (not the default), so the space is
      // still typed and the caret still moves; the deck just doesn't navigate.
      // (Use the on-screen ‹ › buttons to flip while editing.)
      var k = e.key;
      if (k === ' ' || k === 'Spacebar' || k === 'ArrowLeft' || k === 'ArrowRight' ||
          k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' ||
          k === 'Home' || k === 'End') {
        e.stopImmediatePropagation();
      }
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    navSlide(e.key === 'ArrowRight' ? 'right' : 'left');
  }, true);

  // ─── [ADDITION · missing-media placeholders] ───
  // Uploaded HTML often points <img>/<video> at local/relative paths; those
  // files don't travel with the single .html, and srcdoc has no base URL — so
  // they render broken. Replace each broken one with an in-place "drop / upload
  // / paste link" block (Notion-style empty media block). When a source is
  // given we set it and tell the parent to persist it into the skeleton, so it
  // syncs to every collaborator and is included on download.
  function mediaKindOf(el) {
    if (el.tagName === 'A') return 'link';
    if (el.tagName === 'VIDEO') return 'video';
    if (el.tagName === 'IFRAME' && el.getAttribute('data-hce-video') === 'embed') return 'video';
    if (el.tagName === 'AUDIO') return 'audio';
    return 'image';
  }
  function mediaSrcOf(el) {
    if (el.tagName === 'A') { var h = el.getAttribute('href') || ''; return (h === '#') ? '' : h; }
    var s = el.getAttribute('src') || '';
    if (!s && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) { var sc = el.querySelector('source[src]'); if (sc) s = sc.getAttribute('src') || ''; }
    return s;
  }
  function isAbsSrc(s) { return /^(https?:|data:|blob:)/i.test(s); }
  function isBrokenMedia(el) {
    if (el.tagName === 'A') return !mediaSrcOf(el);   // our link, until a URL is set
    var s = mediaSrcOf(el);
    if (!s) return true;
    if (isAbsSrc(s)) {
      if (el.tagName === 'IMG') return !!(el.complete && el.naturalWidth === 0);
      return false;   // assume a remote video URL is fine (can't cheaply verify)
    }
    return true;      // relative / local path → unresolvable here
  }
  function applyMediaSrc(el, src) {
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') { var sc = el.querySelectorAll('source'); for (var i = 0; i < sc.length; i++) sc[i].removeAttribute('src'); }
    if (src) el.setAttribute('src', src);
    el.style.display = el.__hcePrevDisplay || '';
    if (el.__hcePh && el.__hcePh.parentNode) { el.__hcePh.parentNode.removeChild(el.__hcePh); }
    el.__hcePh = null;
    el.__hcePhDone = false;
  }
  function setMediaSrc(el, src) {
    if (!src) return;
    applyMediaSrc(el, src);
    window.parent.postMessage({ type: 'media-committed', id: el.getAttribute('data-block-id'), src: src }, '*');
  }
  function inlineImageFile(file, cb) {
    if (!file || file.type.indexOf('image/') !== 0) { cb(null); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, max / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      var mime = /png|gif|webp/.test(file.type) ? 'image/png' : 'image/jpeg';
      try { cb(c.toDataURL(mime, 0.85)); } catch (err) { cb(null); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }
  function pickFile(accept, cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) cb(f); if (inp.parentNode) inp.parentNode.removeChild(inp); };
    document.body.appendChild(inp); inp.click();
  }
  // Pick a local file and attach it: images get downscaled + inlined; small
  // videos get inlined as a data-URI, large ones nudge toward a link.
  function chooseLocalFor(el, kind) {
    var accept = kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : 'image/*';
    pickFile(accept, function (f) {
      if (!f) return;
      if (kind === 'image') {
        inlineImageFile(f, function (data) { if (data) setMediaSrc(el, data); else alert(pt('err_img_read')); });
      } else {
        var cap = kind === 'audio' ? 10 : 6;
        if (f.size > cap * 1024 * 1024) { alert(pt('err_file_large')); return; }
        var rd = new FileReader();
        rd.onload = function () { setMediaSrc(el, rd.result); };
        rd.readAsDataURL(f);
      }
    });
  }
  // Commit a source as a possibly-different kind. Same kind → set in place;
  // a different kind (photo ↔ video) → ask the parent to swap the element's tag.
  function commitMedia(el, targetKind, src) {
    if (!src) return;
    // A video hosted on YouTube / Vimeo / Bilibili can't play in a <video> tag —
    // it needs an <iframe> embed. Detect those and ask the parent to swap the
    // block to an embed iframe (which also travels in the downloaded HTML, so
    // the video plays anywhere the file is opened — no upload, no size limit).
    var embed = (targetKind === 'video') ? videoEmbedUrl(src) : null;
    if (embed) {
      window.parent.postMessage({ type: 'request-swap-media', id: el.getAttribute('data-block-id'), kind: 'video', src: embed, embed: true }, '*');
      return;
    }
    if (targetKind === mediaKindOf(el)) { setMediaSrc(el, src); return; }
    window.parent.postMessage({ type: 'request-swap-media', id: el.getAttribute('data-block-id'), kind: targetKind, src: src }, '*');
  }
  // Pick a local file and attach it AS targetKind (drives the photo/video
  // switch). Images are downscaled + inlined; small videos inlined as a data-URI.
  function chooseLocalAs(el, targetKind) {
    var accept = targetKind === 'video' ? 'video/*' : 'image/*';
    pickFile(accept, function (f) {
      if (!f) return;
      if (targetKind === 'image') {
        inlineImageFile(f, function (data) { if (data) commitMedia(el, 'image', data); else alert(pt('err_img_read')); });
      } else {
        if (f.size > 6 * 1024 * 1024) { alert(pt('err_video_large')); return; }
        var rd = new FileReader(); rd.onload = function () { commitMedia(el, 'video', rd.result); }; rd.readAsDataURL(f);
      }
    });
  }
  // Image & video are the same "media" to the user — detect the kind from the
  // chosen / dropped file or pasted URL so nobody has to pre-pick a type.
  function mediaKindFromFile(f) {
    var t = (f && f.type) || '';
    if (t.indexOf('video/') === 0) return 'video';
    if (t.indexOf('audio/') === 0) return 'audio';
    return 'image';
  }
  // Turn a YouTube / Vimeo / Bilibili watch URL into its <iframe> embed URL, so
  // pasting a normal video link actually plays (those hosts can't stream into a
  // <video> tag). Returns null for anything that isn't a known embeddable host.
  // No heavy regex (backslashes are fragile in this injected template string) —
  // parse with plain string ops.
  function videoEmbedUrl(u) {
    if (!u) return null;
    var s = String(u).trim();
    var low = s.toLowerCase();
    function qparam(url, key) {
      var qi = url.indexOf('?'); if (qi < 0) return null;
      var parts = url.slice(qi + 1).split('#')[0].split('&');
      for (var i = 0; i < parts.length; i++) { var kv = parts[i].split('='); if (kv[0] === key) return decodeURIComponent(kv[1] || ''); }
      return null;
    }
    function lastSeg(url) {
      var clean = url.split('?')[0].split('#')[0];
      var segs = clean.split('/');
      for (var i = segs.length - 1; i >= 0; i--) { if (segs[i]) return segs[i]; }
      return '';
    }
    function isDigits(x) { for (var i = 0; i < x.length; i++) { var c = x.charCodeAt(i); if (c < 48 || c > 57) return false; } return x.length > 0; }
    if (low.indexOf('youtube.com') >= 0 || low.indexOf('youtu.be') >= 0) {
      var yid = null;
      if (low.indexOf('youtu.be/') >= 0) yid = lastSeg(s);
      else if (low.indexOf('/watch') >= 0) yid = qparam(s, 'v');
      else if (low.indexOf('/embed/') >= 0) yid = lastSeg(s);
      else if (low.indexOf('/shorts/') >= 0) yid = lastSeg(s);
      if (yid) return 'https://www.youtube.com/embed/' + yid;
    }
    if (low.indexOf('vimeo.com') >= 0) {
      var vid = lastSeg(s);
      if (isDigits(vid)) return 'https://player.vimeo.com/video/' + vid;
    }
    if (low.indexOf('bilibili.com') >= 0) {
      var segs = s.split('?')[0].split('#')[0].split('/');
      for (var i = 0; i < segs.length; i++) { if (segs[i].toLowerCase().indexOf('bv') === 0) return 'https://player.bilibili.com/player.html?bvid=' + segs[i] + '&autoplay=0'; }
    }
    return null;
  }
  function mediaKindFromUrl(u) {
    if (videoEmbedUrl(u)) return 'video';   // YouTube/Vimeo/Bilibili → embeddable video
    var lo = (u || '').toLowerCase(), i = lo.indexOf('?'); if (i >= 0) lo = lo.slice(0, i);
    i = lo.indexOf('#'); if (i >= 0) lo = lo.slice(0, i);
    var vid = ['.mp4', '.webm', '.ogv', '.mov', '.m4v'];
    for (var k = 0; k < vid.length; k++) { var e = vid[k]; if (lo.length >= e.length && lo.slice(-e.length) === e) return 'video'; }
    return 'image';
  }
  // Pick a local file (image OR video) and attach it, detecting + swapping kind.
  function pickMediaFile(el, accept) {
    pickFile(accept, function (f) {
      if (!f) return;
      var k = mediaKindFromFile(f);
      if (k === 'image') { inlineImageFile(f, function (data) { if (data) commitMedia(el, 'image', data); else alert(pt('err_img_read')); }); return; }
      var cap = (k === 'audio') ? 10 : 6;
      if (f.size > cap * 1024 * 1024) { alert(pt('err_file_large')); return; }
      var rd = new FileReader(); rd.onload = function () { commitMedia(el, k, rd.result); }; rd.readAsDataURL(f);
    });
  }
  function lightMediaIcon(kind) {
    var common = 'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c2c4c9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
    if (kind === 'video') return '<svg ' + common + '><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></svg>';
    if (kind === 'audio') return '<svg ' + common + '><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';
    if (kind === 'link') return '<svg ' + common + '><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
    return '<svg ' + common + '><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  }
  function closeMediaMenu() {
    var m = document.getElementById('__hce-media-menu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener('mousedown', onMediaMenuOutside, true);
    if (pinnedBlock && document.contains(pinnedBlock)) positionPins(pinnedBlock);
  }
  function onMediaMenuOutside(e) {
    if (e.target.closest && e.target.closest('#__hce-media-menu')) return;
    closeMediaMenu();
  }
  function openMediaMenu(el, box, kind) {
    closeMediaMenu();
    // Keep the resize grips from poking through the popup (they sit above it).
    hideAllGrips(); if (hoverHandle) hoverHandle.style.display = 'none';
    var r = box.getBoundingClientRect();
    var m = document.createElement('div');
    m.id = '__hce-media-menu';
    m.setAttribute('contenteditable', 'false');
    m.style.cssText = 'position:fixed;z-index:2147483000;background:#fff;border:1px solid #e6e6e9;border-radius:11px;' +
      'box-shadow:0 12px 34px rgba(20,24,34,.16);padding:6px;width:248px;box-sizing:border-box;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937;';
    var top = Math.min(r.bottom + 6, (window.innerHeight || 800) - 130);
    var left = Math.min(Math.max(8, r.left), (window.innerWidth || 800) - 256);
    m.style.left = Math.round(left) + 'px';
    m.style.top = Math.round(top) + 'px';
    var inStyle = 'flex:1;min-width:0;border:1px solid #e2e2e6;border-radius:7px;padding:7px 9px;font-size:12px;outline:none;color:#1f2937;';
    var addStyle = 'border:none;background:#15161a;color:#fff;border-radius:7px;padding:0 12px;font-size:12px;font-weight:600;cursor:pointer;';
    if (kind === 'link') {
      // A text link: display text + URL, no local-file option.
      m.innerHTML =
        '<div style="padding:4px 6px 6px;display:flex;flex-direction:column;gap:6px;">' +
        '<input type="text" data-fld="text" placeholder="' + pt('link_text_ph') + '" style="' + inStyle + '">' +
        '<div style="display:flex;gap:6px;"><input type="text" data-fld="url" placeholder="' + pt('link_url_ph') + '" style="' + inStyle + '">' +
        '<button type="button" data-act="add" style="' + addStyle + '">' + pt('add') + '</button></div></div>';
      document.body.appendChild(m);
      var txtIn = m.querySelector('[data-fld="text"]');
      var urlIn = m.querySelector('[data-fld="url"]');
      var addB = m.querySelector('[data-act="add"]');
      // Pre-fill from the existing link so editing tweaks it instead of
      // starting over. '#' is our placeholder href (not yet set) → leave blank.
      var curHref = el.getAttribute('href') || '';
      if (curHref && curHref !== '#') urlIn.value = curHref;
      var curText = (el.textContent || '').trim();
      if (curText && curText !== curHref) txtIn.value = curText;
      addB.textContent = (curHref && curHref !== '#') ? pt('save') : pt('add');
      function submitLnk() {
        var u = (urlIn.value || '').trim(); if (!u) return;
        // Be forgiving about scheme (no regex — backslashes are eaten in this
        // template-literal file). Prepend https:// unless it already has one.
        var lo = u.toLowerCase(), c0 = u.charAt(0);
        var hasScheme = lo.indexOf('http:') === 0 || lo.indexOf('https:') === 0 ||
          lo.indexOf('mailto:') === 0 || lo.indexOf('tel:') === 0 || c0 === '/' || c0 === '#';
        if (!hasScheme) u = 'https://' + u;
        closeMediaMenu(); setLink(el, u, (txtIn.value || '').trim());
      }
      addB.addEventListener('click', submitLnk);
      m.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitLnk(); } });
      setTimeout(function () { urlIn.focus(); document.addEventListener('mousedown', onMediaMenuOutside, true); }, 0);
      return;
    }
    // image / video / audio — to the user an image and a video are the same
    // kind of "media", so there's no pre-pick and no tabs: choose a file or
    // paste a link and we detect the kind (swapping the element's tag when it
    // differs). Audio stays single-type. A file can also just be dropped on the
    // placeholder behind this menu.
    var isAudio = (kind === 'audio');
    var pickAccept = isAudio ? 'audio/*' : 'image/*,video/*';
    var lbl = isAudio ? pt('add_audio') : pt('add_media');
    var pastePh = (panelLang === 'zh') ? ('粘贴' + lbl + '链接…') : ('Paste ' + lbl + ' URL…');
    m.innerHTML = '<div data-body=""></div>';
    document.body.appendChild(m);
    var bodyEl = m.querySelector('[data-body]');
    bodyEl.innerHTML =
      '<button type="button" data-act="local" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:none;padding:9px 10px;border-radius:7px;cursor:pointer;color:#1f2937;font-size:13px;font-weight:500;">' + pt('media_pick_local') + '</button>' +
      '<div style="display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:11px;padding:2px 10px 4px;"><span style="flex:1;height:1px;background:#eee;"></span>' + pt('media_or') + '<span style="flex:1;height:1px;background:#eee;"></span></div>' +
      '<div style="display:flex;gap:6px;padding:2px 6px 4px;"><input type="text" placeholder="' + pastePh + '" style="' + inStyle + '">' +
      '<button type="button" data-act="add" style="' + addStyle + '">' + pt('add') + '</button></div>';
    var localBtn = bodyEl.querySelector('[data-act="local"]');
    var input = bodyEl.querySelector('input');
    var addBtn = bodyEl.querySelector('[data-act="add"]');
    localBtn.addEventListener('mouseenter', function () { localBtn.style.background = '#f4f4f5'; });
    localBtn.addEventListener('mouseleave', function () { localBtn.style.background = 'none'; });
    localBtn.addEventListener('click', function () { closeMediaMenu(); pickMediaFile(el, pickAccept); });
    function submitLink() { var u = (input.value || '').trim(); if (!u) return; closeMediaMenu(); commitMedia(el, isAudio ? 'audio' : mediaKindFromUrl(u), u); }
    addBtn.addEventListener('click', submitLink);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitLink(); } });
    setTimeout(function () { input.focus(); document.addEventListener('mousedown', onMediaMenuOutside, true); }, 0);
  }
  // Set a text link's href + visible text, reveal it, and persist to the parent.
  function setLink(el, href, text) {
    if (!href) return;
    el.setAttribute('href', href);
    el.textContent = text || href;
    el.style.display = el.__hcePrevDisplay || '';
    if (el.__hcePh && el.__hcePh.parentNode) el.__hcePh.parentNode.removeChild(el.__hcePh);
    el.__hcePh = null; el.__hcePhDone = false;
    window.parent.postMessage({ type: 'link-committed', id: el.getAttribute('data-block-id'), href: href, text: el.textContent }, '*');
  }
  // Make a whole block (card / section / heading / …) act as a clickable link
  // to a URL. Stored as data-hce-href so it survives in the skeleton; the
  // outline only shows in edit/view, the jump only fires in view / preview.
  function applyBlockLink(el, href) {
    if (!el) return;
    if (href) { el.setAttribute('data-hce-href', href); el.style.cursor = 'pointer'; }
    else { el.removeAttribute('data-hce-href'); el.style.cursor = ''; }
  }
  // Resolve the element that owns an existing whole-block link. Selection can
  // land on a child inside the linked card, or click-to-climb can select a
  // wrapper around a previously linked child. Prefer self/ancestor; when the
  // selected wrapper contains exactly one bound block, edit that binding too.
  function blockLinkTarget(el) {
    if (!el) return null;
    if (el.hasAttribute && el.hasAttribute('data-hce-href')) return el;
    var ancestor = el.closest && el.closest('[data-hce-href]');
    if (ancestor) return ancestor;
    if (!el.querySelectorAll) return null;
    var descendants = el.querySelectorAll('[data-hce-href]');
    return descendants.length === 1 ? descendants[0] : null;
  }
  // Popover to bind / edit / remove a link on the selected block. Mirrors the
  // text-link menu but writes data-hce-href on the block and tells the parent
  // to persist it.
  function openBlockLinkMenu(el, box) {
    // Re-open the existing binding even when selection landed inside it or
    // click-to-climb selected its outer wrapper.
    var bound = blockLinkTarget(el);
    if (bound) el = bound;
    closeMediaMenu();
    hideAllGrips(); if (hoverHandle) hoverHandle.style.display = 'none';
    var r = box.getBoundingClientRect();
    var m = document.createElement('div');
    m.id = '__hce-media-menu';
    m.setAttribute('contenteditable', 'false');
    m.style.cssText = 'position:fixed;z-index:2147483000;background:#fff;border:1px solid #e6e6e9;border-radius:11px;' +
      'box-shadow:0 12px 34px rgba(20,24,34,.16);padding:6px;width:248px;box-sizing:border-box;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937;';
    var top = Math.min(r.bottom + 6, (window.innerHeight || 800) - 130);
    var left = Math.min(Math.max(8, r.left), (window.innerWidth || 800) - 256);
    m.style.left = Math.round(left) + 'px'; m.style.top = Math.round(top) + 'px';
    var inStyle = 'flex:1;min-width:0;border:1px solid #e2e2e6;border-radius:7px;padding:7px 9px;font-size:12px;outline:none;color:#1f2937;';
    var addStyle = 'border:none;background:#15161a;color:#fff;border-radius:7px;padding:0 12px;font-size:12px;font-weight:600;cursor:pointer;';
    var rmStyle = 'border:none;background:none;color:#dc2626;border-radius:7px;padding:0 8px;font-size:12px;cursor:pointer;';
    var cur = el.getAttribute('data-hce-href') || '';
    m.innerHTML =
      '<div style="padding:4px 6px 6px;display:flex;flex-direction:column;gap:6px;">' +
      '<div style="font-size:11px;color:#9aa0a6;padding:0 1px;">' + pt('blink_hint') + '</div>' +
      '<div style="display:flex;gap:6px;"><input type="text" data-fld="url" placeholder="' + pt('blink_ph') + '" style="' + inStyle + '">' +
      '<button type="button" data-act="add" style="' + addStyle + '">' + (cur ? pt('save') : pt('add')) + '</button></div>' +
      (cur ? '<div style="text-align:right;"><button type="button" data-act="rm" style="' + rmStyle + '">' + pt('remove') + '</button></div>' : '') +
      '</div>';
    document.body.appendChild(m);
    var urlIn = m.querySelector('[data-fld="url"]'); if (cur) urlIn.value = cur;
    function submit() {
      var u = (urlIn.value || '').trim(); if (!u) return;
      var lo = u.toLowerCase(), c0 = u.charAt(0);
      var hasScheme = lo.indexOf('http:') === 0 || lo.indexOf('https:') === 0 ||
        lo.indexOf('mailto:') === 0 || lo.indexOf('tel:') === 0 || c0 === '/' || c0 === '#';
      if (!hasScheme) u = 'https://' + u;
      applyBlockLink(el, u); closeMediaMenu();
      window.parent.postMessage({ type: 'block-link-committed', id: el.getAttribute('data-block-id'), href: u }, '*');
    }
    m.querySelector('[data-act="add"]').addEventListener('click', submit);
    var rmB = m.querySelector('[data-act="rm"]');
    if (rmB) rmB.addEventListener('click', function () {
      applyBlockLink(el, null); closeMediaMenu();
      window.parent.postMessage({ type: 'block-link-committed', id: el.getAttribute('data-block-id'), href: '' }, '*');
    });
    m.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(function () { urlIn.focus(); document.addEventListener('mousedown', onMediaMenuOutside, true); }, 0);
  }
  function makeMediaPlaceholder(el) {
    if (el.__hcePhDone) return;
    el.__hcePhDone = true;
    var kind = mediaKindOf(el);
    var isVideo = kind === 'video';
    var isLink = kind === 'link';
    // An empty <img> placeholder actually accepts an image OR a video (pasting a
    // video URL auto-swaps the tag), so label it "Image / Video" to match the
    // "+" menu — not just "Image". A <video> placeholder stays video-specific.
    var kindLabel = kind === 'video' ? pt('add_video') : kind === 'audio' ? pt('add_audio') : kind === 'link' ? pt('add_link') : pt('add_media');
    var phPrompt = isLink ? pt('link_click_to_set') : ((panelLang === 'zh') ? ('点击或拖入' + kindLabel) : ('Click or drop ' + kindLabel));
    var box = document.createElement('div');
    box.className = '__hce-media-ph';
    box.setAttribute('contenteditable', 'false');
    // Transfer the original element's data-block-id to the placeholder so it's draggable
    if (el.hasAttribute('data-block-id')) {
      box.setAttribute('data-block-id', el.getAttribute('data-block-id'));
    }
    // Size the box to roughly where the image would sit, so layout doesn't
    // collapse. Prefer width/height attrs; otherwise read the element's
    // rendered/computed size (captured while it's still laid out). Many imgs
    // are sized purely by CSS (e.g. width:100%) with no attributes.
    var w = el.getAttribute('width'), h = el.getAttribute('height');
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle ? getComputedStyle(el) : null;
    var tw = 0, th = 0;
    if (w && !isNaN(w)) tw = parseFloat(w);
    else if (rect.width > 40) tw = rect.width;
    else if (cs && parseFloat(cs.width) > 40) tw = parseFloat(cs.width);
    if (h && !isNaN(h)) th = parseFloat(h);
    else if (rect.height > 60) th = rect.height;
    if (tw > 40 && th < 60) th = Math.min(Math.max(Math.round(tw * 0.5), 120), 360);
    var sizeCss = '';
    if (w && isNaN(w)) sizeCss += 'width:' + w + ';';
    else if (tw > 40) sizeCss += 'width:' + Math.round(tw) + 'px;';
    if (h && isNaN(h)) sizeCss += 'min-height:' + h + ';';
    else if (th >= 60) sizeCss += 'min-height:' + Math.round(th) + 'px;';
    box.style.cssText = 'box-sizing:border-box;position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;' +
      'min-width:150px;min-height:84px;max-width:100%;padding:14px;margin:1px;vertical-align:middle;' +
      'border:1px dashed #d6d8de;border-radius:10px;background:#fafafa;color:#a1a5ad;' +
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;cursor:pointer;transition:border-color .1s,background .1s;' + sizeCss;
    if (isLink) {   // a text link needs only a small inline pill, not a media box
      box.style.flexDirection = 'row'; box.style.minWidth = '0'; box.style.minHeight = '0';
      box.style.width = 'auto'; box.style.padding = '3px 9px'; box.style.gap = '5px';
      box.style.maxWidth = '100%'; box.style.margin = '2px 2px 2px 6px';
    }
    var phIcon = isLink
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c2c4c9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
      : lightMediaIcon(kind);
    var delCss = isLink
      ? 'margin-left:2px;width:16px;height:16px;display:none;align-items:center;justify-content:center;border:none;border-radius:5px;background:rgba(20,24,34,.06);color:#6b7280;cursor:pointer;font-size:11px;line-height:1;padding:0;flex:0 0 auto;'
      : 'position:absolute;top:5px;right:5px;width:20px;height:20px;display:none;align-items:center;justify-content:center;border:none;border-radius:6px;background:rgba(20,24,34,.06);color:#6b7280;cursor:pointer;font-size:13px;line-height:1;padding:0;';
    box.innerHTML = phIcon + '<div>' + phPrompt + '</div>' +
      '<button type="button" class="__hce-ph-del" title="' + pt('remove') + '" style="' + delCss + '">✕</button>';
    var phDel = box.querySelector('.__hce-ph-del');
    box.addEventListener('mouseenter', function () { phDel.style.display = 'flex'; });
    box.addEventListener('mouseleave', function () { phDel.style.display = 'none'; });
    phDel.addEventListener('mouseenter', function () { phDel.style.background = 'rgba(220,38,38,.12)'; phDel.style.color = '#dc2626'; });
    phDel.addEventListener('mouseleave', function () { phDel.style.background = 'rgba(20,24,34,.06)'; phDel.style.color = '#6b7280'; });
    phDel.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var id = el.getAttribute('data-block-id');
      if (id) window.parent.postMessage({ type: 'request-block-delete', id: id }, '*');
    });
    el.__hcePrevDisplay = el.style.display;
    el.style.display = 'none';
    el.__hcePh = box;
    if (el.parentNode) el.parentNode.insertBefore(box, el);
    box.addEventListener('click', function (e) { e.stopPropagation(); openMediaMenu(el, box, kind); });
    box.addEventListener('mouseenter', function () { box.style.borderColor = '#c4c7cf'; });
    box.addEventListener('mouseleave', function () { box.style.borderColor = '#d6d8de'; });
    box.addEventListener('dragover', function (e) { e.preventDefault(); box.style.borderColor = '#ff5a1f'; box.style.background = '#fff7ed'; });
    box.addEventListener('dragleave', function () { box.style.borderColor = '#d6d8de'; box.style.background = '#fafafa'; });
    box.addEventListener('drop', function (e) {
      e.preventDefault(); box.style.borderColor = '#d6d8de'; box.style.background = '#fafafa';
      if (isLink) return;   // links are set via the URL menu, not file drops
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
      var k = mediaKindFromFile(f);
      if (k === 'image') { inlineImageFile(f, function (data) { if (data) commitMedia(el, 'image', data); }); return; }
      var cap = (k === 'audio') ? 10 : 6;
      if (f.size > cap * 1024 * 1024) { alert(pt('err_file_large')); return; }
      var rd = new FileReader(); rd.onload = function () { commitMedia(el, k, rd.result); }; rd.readAsDataURL(f);
    });
  }
  function scanBrokenMedia() {
    var els = document.querySelectorAll('img, video, audio, a[data-hce-link]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest && el.closest('#__hce-style-panel')) continue;
      if (el.__hcePhDone) continue;
      if (isBrokenMedia(el)) makeMediaPlaceholder(el);
    }
  }
  function initMediaPlaceholders() {
    scanBrokenMedia();
    window.addEventListener('load', scanBrokenMedia);
    setTimeout(scanBrokenMedia, 600);
    setTimeout(scanBrokenMedia, 1800);
    document.addEventListener('error', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO') && !t.__hcePhDone) makeMediaPlaceholder(t);
    }, true);
  }

  // ─── [ADDITION · videos are edit-safe posters, play ONLY in View] ───
  // A <video> or a hosted-video <iframe> (YouTube / Vimeo / Bilibili) plays
  // only in View mode. In every editing mode it shows its poster / first frame
  // under a translucent play badge: you can select, move, resize and (for a
  // <video>) crop it like an image, but it never plays, never steals clicks,
  // and never z-stacks over the editor UI. The badge is a fixed-position
  // overlay tracked to the element's rect (like the toolbar) — nothing is
  // injected into the document itself, so export / sync are untouched.
  var videoCovers = [];   // [{ el, cover }]
  function isHostedVideoFrame(el) {
    return el && el.tagName === 'IFRAME' && el.getAttribute('data-hce-video') === 'embed';
  }
  function editableVideos() {
    var out = [];
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v.closest && v.closest('#__hce-style-panel')) continue;
      // Skip a hidden shell <video> left behind an upload placeholder or a
      // link→embed swap (display:none / zero-size): it isn't the visible media,
      // and binding a cover to it would place the badge at 0×0 (invisible).
      if (v.__hcePh) continue;
      var cs = window.getComputedStyle ? getComputedStyle(v) : null;
      if (cs && cs.display === 'none') continue;
      var r = v.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push(v);
    }
    var frames = document.querySelectorAll('iframe[data-hce-video="embed"]');
    for (var j = 0; j < frames.length; j++) out.push(frames[j]);
    return out;
  }
  function coverRecFor(el) {
    for (var i = 0; i < videoCovers.length; i++) if (videoCovers[i].el === el) return videoCovers[i];
    return null;
  }
  function ensureVideoCover(el) {
    var rec = coverRecFor(el);
    if (rec) return rec;
    var cover = document.createElement('div');
    cover.className = '__hce-video-cover';
    cover.setAttribute('contenteditable', 'false');
    cover.style.cssText = 'position:fixed;z-index:2147483530;display:none;box-sizing:border-box;'
      + 'align-items:center;justify-content:center;background:rgba(17,24,39,.12);';
    var badge = document.createElement('div');
    badge.style.cssText = 'width:48px;height:48px;border-radius:999px;background:rgba(17,24,39,.6);'
      + 'display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.25);';
    badge.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    cover.appendChild(badge);
    cover.addEventListener('mousedown', function (e) {
      var target = cover.__hceFor;
      if (!target || !document.contains(target)) return;
      if (mode === 'edit') {
        e.preventDefault(); e.stopPropagation();
        showToolsOn(target, null);
      } else if (mode === 'drag') {
        e.preventDefault(); e.stopPropagation();
        var unit = (typeof draggableAncestor === 'function' && draggableAncestor(target)) || target;
        startBlockDrag(unit, e);
      } else if (mode === 'comment') {
        e.preventDefault(); e.stopPropagation();
        var id = target.getAttribute('data-block-id');
        if (id) window.parent.postMessage({ type: 'comment-toggle-select', id: id, tag: target.tagName.toLowerCase(), snippet: pt('add_video') }, '*');
      }
    }, true);
    document.body.appendChild(cover);
    rec = { el: el, cover: cover };
    videoCovers.push(rec);
    return rec;
  }
  function removeVideoCover(el) {
    for (var i = videoCovers.length - 1; i >= 0; i--) {
      if (videoCovers[i].el === el) {
        if (videoCovers[i].cover && videoCovers[i].cover.parentNode) videoCovers[i].cover.parentNode.removeChild(videoCovers[i].cover);
        videoCovers.splice(i, 1);
      }
    }
  }
  function positionOneCover(rec) {
    var el = rec.el, cover = rec.cover;
    if (!el || !document.contains(el)) { cover.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { cover.style.display = 'none'; return; }
    cover.style.display = 'flex';
    cover.style.left = Math.round(r.left) + 'px';
    cover.style.top = Math.round(r.top) + 'px';
    cover.style.width = Math.round(r.width) + 'px';
    cover.style.height = Math.round(r.height) + 'px';
    try { var br = getComputedStyle(el).borderRadius; if (br && br !== '0px') cover.style.borderRadius = br; else cover.style.borderRadius = '8px'; } catch (e) { cover.style.borderRadius = '8px'; }
  }
  function positionVideoCovers() {
    for (var i = 0; i < videoCovers.length; i++) positionOneCover(videoCovers[i]);
  }
  function refreshVideoState() {
    var list = editableVideos();
    for (var k = videoCovers.length - 1; k >= 0; k--) {
      if (list.indexOf(videoCovers[k].el) < 0) removeVideoCover(videoCovers[k].el);
    }
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var isFrame = isHostedVideoFrame(el);
      if (mode === 'view') {
        removeVideoCover(el);
        if (!isFrame) {
          if (el.__hceHadControls !== false) el.setAttribute('controls', '');
          el.style.pointerEvents = '';
        } else {
          el.style.pointerEvents = '';
        }
      } else {
        if (!isFrame) {
          if (el.__hceHadControls === undefined) el.__hceHadControls = el.hasAttribute('controls');
          el.removeAttribute('controls');
          try { if (el.pause) el.pause(); } catch (e) {}
          el.style.pointerEvents = '';   // no controls → a click selects the <video>, never plays
        } else {
          el.style.pointerEvents = 'none';   // block the platform's own UI; the cover proxies selection
        }
        var rec = ensureVideoCover(el);
        rec.cover.__hceFor = el;
        rec.cover.style.pointerEvents = isFrame ? 'auto' : 'none';
        positionOneCover(rec);
      }
    }
  }

  // ─── [ADDITION · drag to reorder] ───
  // Reorder a block among its siblings (Notion-style). The drag handle lives
  // on the selection toolbar; we draw an orange drop line and, on release, ask
  // the parent to move the element in the skeleton (synced + undoable).
  var blockDrag = null;
  function blockSiblings(el) {
    var parent = el.parentNode;
    if (!parent) return [];
    var out = [];
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (c.nodeType === 1 && c.hasAttribute('data-block-id')) out.push(c);
    }
    return out;
  }
  // Find the block under the cursor anywhere in the document (cross-container).
  // The moving element is pointer-events:none so elementFromPoint sees through
  // it; we still climb out of its own subtree and skip our UI overlays.
  function blockUnderPoint(x, y, exclude) {
    var n = document.elementFromPoint(x, y);
    if (!n || !n.closest) return null;
    if (n.closest('#__hce-tools,#__hce-style-panel,#__hce-hover-handle,#__hce-hover-outline,.__hce-rsz,#__hce-media-menu,#__hce-add-menu,#__hce-drop-line')) return null;
    var b = dragTargetFromNode(n);
    while (b && exclude && (b === exclude || exclude.contains(b))) {
      b = b.parentElement ? b.parentElement.closest('[data-block-id]') : null;
      while (b && !isDragMovableBlock(b)) {
        b = b.parentElement ? b.parentElement.closest('[data-block-id]') : null;
      }
    }
    return b;
  }
  // Resolve a raw hovered block to a clean, predictable drop target so dragging
  // feels like Notion / Feishu instead of burrowing into inline leaves or
  // foreign nesting. Rule: if the cursor's block chain passes through a block
  // that shares the dragged element's own container, snap there (a tidy sibling
  // reorder). Otherwise snap to the OUTERMOST top-level block under the cursor —
  // so a paragraph never lands inside a list item's text span, and the level a
  // drop lands on is always obvious.
  function resolveDropTarget(node, dragged) {
    if (!node) return null;
    var dragParent = dragged && dragged.parentNode;
    var chain = [], b = node;
    while (b && b !== document.body) {
      if (b.nodeType === 1 && b.hasAttribute('data-block-id') && isDragMovableBlock(b)) chain.push(b);
      b = b.parentElement;
    }
    if (!chain.length) return null;
    // Prefer a block that shares the dragged element's own parent — a clean
    // same-container reorder.
    for (var i = 0; i < chain.length; i++) {
      if (chain[i] !== dragged && chain[i].parentNode === dragParent) return chain[i];
    }
    // Otherwise land next to the INNERMOST block actually under the cursor — not
    // the outermost wrapper. Snapping to the wrapper is exactly what threw the
    // element out to the document's top level. Skip the dragged element itself
    // and any ancestor of it (can't reorder against a block that contains you).
    for (var j = 0; j < chain.length; j++) {
      if (chain[j] !== dragged && !chain[j].contains(dragged)) return chain[j];
    }
    return null;
  }
  // Every top-level block in normal flow (a direct block child of the body, not
  // nested inside another block). Used as the fallback drop targets so a drag
  // anywhere on the page — including the empty margins beside the centred
  // content column — always has something to aim at.
  function topLevelBlocks(exclude) {
    var all = document.querySelectorAll('[data-block-id]'), out = [];
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (b === document.body || b === document.documentElement) continue;
      if (!isDragMovableBlock(b)) continue;
      if (exclude && (b === exclude || exclude.contains(b) || b.contains(exclude))) continue;
      var p = b.parentElement ? b.parentElement.closest('[data-block-id]') : null;
      if (p && p !== document.body) continue;                 // only outermost blocks
      var r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 2) continue;
      out.push(b);
    }
    return out;
  }
  // The block nearest the cursor by VERTICAL position (horizontal only breaks
  // ties). Lets the user drag loosely anywhere down the page and still get a
  // precise drop line, instead of having to hover the narrow content column.
  function nearestTopBlock(cx, cy, exclude) {
    var list = topLevelBlocks(exclude), best = null, bestD = Infinity, bestDy = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      var dy = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
      var dx = cx < r.left ? r.left - cx : (cx > r.right ? cx - r.right : 0);
      var d = dy * 1000 + dx;                                 // vertical dominates
      if (d < bestD) { bestD = d; best = list[i]; bestDy = dy; }
    }
    // Only fall back to a block the cursor is vertically NEAR (or inside). In the
    // big empty space above the first block or below the last one, return null
    // instead of blindly snapping to the first / last block — that blind snap is
    // what flung dragged elements to the very top / bottom of the document.
    if (bestDy > 40) return null;
    return best;
  }
  // The nearest block-level sibling on one side of a target — used to centre the
  // drop line in the GAP between two blocks (Notion / Feishu feel) instead of
  // hugging one block's edge. Skips the block being dragged and any hidden /
  // zero-size shadow sibling (e.g. the display:none <img> behind a media
  // placeholder) — those have bogus rects that used to pull the gap midpoint
  // INTO the target, drawing the guide line straight through it.
  function adjBlockSibling(target, before) {
    var s = before ? target.previousElementSibling : target.nextElementSibling;
    while (s) {
      if (s.nodeType === 1 && s.hasAttribute('data-block-id') && !(blockDrag && s === blockDrag.el)) {
        var r = s.getBoundingClientRect();
        var vis = !window.getComputedStyle || getComputedStyle(s).display !== 'none';
        if (vis && (r.width > 0 || r.height > 0)) return s;
      }
      s = before ? s.previousElementSibling : s.nextElementSibling;
    }
    return null;
  }
  // Resolve where a brand-new block (the "+" add-media) should land so it drops
  // as a full-width block in normal flow — never squeezed INTO a column row or
  // an inline run. We climb out of any horizontal flex row (our columns carry
  // data-hce-row) or inline-level wrapper to the outermost block-level anchor.
  function resolveInsertAnchor(el) {
    var cur = el;
    for (var guard = 0; cur && cur !== document.body && guard < 12; guard++) {
      var p = cur.parentElement;
      if (!p || p === document.body) break;
      var pcs = window.getComputedStyle ? getComputedStyle(p) : null;
      var rowish = (p.hasAttribute && p.hasAttribute('data-hce-row')) ||
        (pcs && (pcs.display === 'flex' || pcs.display === 'inline-flex') && pcs.flexDirection.indexOf('row') === 0);
      var scs = window.getComputedStyle ? getComputedStyle(cur) : null;
      var inlineSelf = scs && scs.display.indexOf('inline') === 0;
      if (!rowish && !inlineSelf) break;
      var up = p;
      while (up && up !== document.body && !(up.hasAttribute && up.hasAttribute('data-block-id'))) up = up.parentElement;
      if (!up || up === document.body) break;
      cur = up;
    }
    return cur;
  }
  // Container blocks that should receive + inserts INSIDE themselves when
  // selected (cards/sections/modules), instead of always inserting below.
  function canInsertIntoBlock(el) {
    if (!el || !el.tagName) return false;
    if (el.hasAttribute && el.hasAttribute('data-hce-text')) return false;
    var t = el.tagName;
    if (t === 'TABLE' || t === 'TBODY' || t === 'THEAD' || t === 'TFOOT' || t === 'TR' || t === 'TD' || t === 'TH') return false;
    if (t === 'IMG' || t === 'VIDEO' || t === 'AUDIO' || t === 'IFRAME' || t === 'CANVAS' || t === 'SVG') return false;
    if (t === 'A' && el.hasAttribute && el.hasAttribute('data-hce-link')) return false;
    return t === 'DIV' || t === 'SECTION' || t === 'ARTICLE' || t === 'MAIN' || t === 'ASIDE'
      || t === 'HEADER' || t === 'FOOTER' || t === 'NAV' || t === 'LI';
  }
  // Is this block laid out horizontally vs its block siblings? Drives whether
  // the drop line is vertical (columns) or horizontal (stacked rows).
  function siblingAxisHorizontal(el) {
    var p = el.parentElement; if (!p) return false;
    var sibs = [];
    for (var i = 0; i < p.children.length; i++) { var c = p.children[i]; if (c.nodeType === 1 && c.hasAttribute('data-block-id')) sibs.push(c); }
    if (sibs.length >= 2) {
      var idx = sibs.indexOf(el);
      var other = sibs[idx <= 0 ? 1 : idx - 1];
      var ra = el.getBoundingClientRect(), rb = other.getBoundingClientRect();
      // Genuinely side-by-side = their vertical ranges OVERLAP (share a row) AND
      // they are separated horizontally (one clearly left of the other).
      // Comparing only the top edge proximity wrongly flagged short STACKED
      // blocks as a row, so a vertical drop line got drawn straight THROUGH them.
      var vOverlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      var minH = Math.min(ra.height, rb.height) || 1;
      var hSeparated = (ra.right <= rb.left + 1) || (rb.right <= ra.left + 1);
      return vOverlap > minH * 0.5 && hSeparated;
    }
    var cs = window.getComputedStyle ? getComputedStyle(p) : null;
    return !!(cs && cs.display.indexOf('flex') >= 0 && cs.flexDirection.indexOf('row') === 0);
  }
  // An empty, sizeable container we can drop a block INTO (has an id but no
  // block children of its own) — lets users move blocks into empty cards/cells.
  function isEmptyContainerEl(el) {
    if (!el) return false;
    var t = el.tagName;
    if (t !== 'DIV' && t !== 'SECTION' && t !== 'ARTICLE' && t !== 'MAIN' && t !== 'ASIDE' && t !== 'LI' && t !== 'TD' && t !== 'HEADER' && t !== 'FOOTER' && t !== 'NAV') return false;
    if (el.querySelector('[data-block-id]')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 24 && r.height > 24;
  }
  // A block-level container the user can nest blocks INTO — a card / section /
  // cell, whether empty or already holding content. Used so an image dragged
  // deep inside a filled, highlighted box drops there instead of just above /
  // below it. Rows we build for columns are excluded (those reorder normally).
  function isNestContainerEl(el, dragged) {
    if (!el) return false;
    if (el === dragged || (dragged && dragged.contains(el))) return false;
    if (el.hasAttribute && el.hasAttribute('data-hce-row')) return false;
    var t = el.tagName;
    if (t !== 'DIV' && t !== 'SECTION' && t !== 'ARTICLE' && t !== 'MAIN' && t !== 'ASIDE' && t !== 'LI' && t !== 'TD' && t !== 'TH' && t !== 'HEADER' && t !== 'FOOTER' && t !== 'NAV' && t !== 'UL' && t !== 'OL') return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 80 || r.height <= 60) return false;
    // Never treat the page shell / a very tall wrapper as a nest target — that's
    // what made dropping highlight the whole document and bury the block out of
    // view. A card can be full-width (a hero / banner is wide but SHORT), so we
    // only reject by HEIGHT: anything taller than the viewport is a wrapper, not
    // a card. It must also be genuinely nested (its closest block ancestor
    // exists), never the outermost shell.
    var vh = window.innerHeight || 600;
    if (r.height > vh) return false;
    var p = el.parentElement ? el.parentElement.closest('[data-block-id]') : null;
    if (!p) return false;
    return true;
  }

  // Show drop cues only when releasing now would actually change structure.
  function canMoveRelative(moving, target, before) {
    if (!moving || !target) return false;
    if (moving === target || moving.contains(target)) return false;
    var parent = target.parentNode;
    if (!parent) return false;
    if (moving.parentNode !== parent) return true;
    if (before) return moving.nextElementSibling !== target;
    return target.nextElementSibling !== moving;
  }

  function canMoveInto(moving, container, atStart) {
    if (!moving || !container) return false;
    if (moving === container || moving.contains(container)) return false;
    if (moving.parentNode !== container) return true;
    return atStart ? (moving !== container.firstElementChild) : (moving !== container.lastElementChild);
  }

  function siblingReorderTargets(moving) {
    if (!moving || !moving.parentNode) return [];
    var out = [];
    var kids = moving.parentNode.children || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c === moving) continue;
      if (c.nodeType !== 1 || !c.hasAttribute('data-block-id')) continue;
      if (!isDraggableUnit(c)) continue;
      out.push(c);
    }
    return out;
  }

  function nearestSiblingTarget(moving, cx, cy) {
    var sibs = siblingReorderTargets(moving);
    var best = null, bestD = Infinity;
    for (var i = 0; i < sibs.length; i++) {
      var r = sibs[i].getBoundingClientRect();
      var dy = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
      var dx = cx < r.left ? r.left - cx : (cx > r.right ? cx - r.right : 0);
      var d = dy * 1000 + dx;
      if (d < bestD) { bestD = d; best = sibs[i]; }
    }
    return best;
  }

  function hasEffectiveMoveTarget(moving) {
    if (!moving || !isDraggableUnit(moving)) return false;
    var all = document.querySelectorAll('[data-block-id]');
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (!isDragMovableBlock(t)) continue;
      if (t === moving || moving.contains(t) || t.contains(moving)) continue;
      if (canMoveRelative(moving, t, true) || canMoveRelative(moving, t, false)) return true;
      if (canMoveInto(moving, t, false)) return true;
    }
    if (mode === 'drag' && siblingReorderTargets(moving).length > 0) return true;
    return false;
  }

  // In drag mode, clicking deep inside a component should either resolve to an
  // ancestor that can actually move, or resolve to null (no drag affordance).
  function resolveDragStartBlock(node) {
    var el = dragTargetFromNode(node);
    while (el && !hasEffectiveMoveTarget(el)) {
      el = draggableAncestor(el.parentElement ? el.parentElement.closest('[data-block-id]') : null);
    }
    return el;
  }

  function refreshDragEligibilityMarks() {
    var all = document.querySelectorAll('[data-block-id]');
    for (var i = 0; i < all.length; i++) {
      all[i].removeAttribute('data-hce-draggable');
    }
    if (mode !== 'drag') return;
    for (var j = 0; j < all.length; j++) {
      var b = all[j];
      if (isDraggableUnit(b) && hasEffectiveMoveTarget(b)) b.setAttribute('data-hce-draggable', '1');
    }
  }

  function startBlockDrag(el, ev) {
    if (mode !== 'drag') return;                // dragging is exclusive to drag mode
    if (!el) return;
    if (!isDragMovableBlock(el)) return;
    if (document.querySelectorAll('[data-block-id]').length < 2) return;   // nothing to move toward
    sweepDragStyles();                          // clear any leftovers from a bad prior drag
    hideTools();
    unpinHandle();                              // hide resize grips while dragging
    var line = document.createElement('div');
    line.id = '__hce-drop-line';
    line.style.cssText = 'position:fixed;z-index:2147483600;background:#ff5a1f;border-radius:2px;pointer-events:none;box-sizing:border-box;';
    document.body.appendChild(line);
    // A dot on the left end of the drop line (Notion-style) makes the exact
    // insertion point — and which column / nesting level it lands in — obvious.
    var dot = document.createElement('div');
    dot.id = '__hce-drop-dot';
    dot.style.cssText = 'position:fixed;z-index:2147483601;display:none;pointer-events:none;width:9px;height:9px;'
      + 'border-radius:999px;background:#ff5a1f;box-shadow:0 0 0 2px #fff;box-sizing:border-box;';
    document.body.appendChild(dot);
    // Highlight box shown when the cursor is deep inside a container: dropping
    // here nests the block INTO that card / section instead of reordering.
    var nest = document.createElement('div');
    nest.id = '__hce-drop-nest';
    nest.style.cssText = 'position:fixed;z-index:2147483599;display:none;pointer-events:none;box-sizing:border-box;'
      + 'border:2px solid #ff5a1f;border-radius:8px;background:rgba(255,90,31,.08);';
    document.body.appendChild(nest);
    el.style.outline = '2px solid rgba(255,90,31,.55)';
    el.style.outlineOffset = '1px';
    el.style.opacity = '0.65';
    el.style.pointerEvents = 'none';            // let elementFromPoint see through the mover
    document.body.style.cursor = 'grabbing';
    blockDrag = { el: el, line: line, dot: dot, nest: nest, target: null, before: true, mode: 'move', side: null };
    document.addEventListener('mousemove', onBlockDragMove, true);
    document.addEventListener('mouseup', onBlockDragEnd, true);
    document.addEventListener('keydown', onBlockDragKey, true);
    onBlockDragMove(ev);
  }
  // Esc aborts a drag in flight — a needed escape hatch now that releasing the
  // mouse anywhere always drops at the (always-visible) line.
  function onBlockDragKey(e) {
    if (!blockDrag) return;
    if (e.key === 'Escape') { e.preventDefault(); blockDrag.mode = 'none'; blockDrag.target = null; onBlockDragEnd(); }
  }
  function onBlockDragMove(e) {
    if (!blockDrag) return;
    if (e && e.preventDefault) e.preventDefault();
    var cx = e.clientX, cy = e.clientY, line = blockDrag.line, dot = blockDrag.dot, el = blockDrag.el;
    var nest = blockDrag.nest;
    // Auto-scroll when hovering near the top / bottom edge so far-away targets
    // are reachable without letting go (keeps the drag within clear bounds).
    var vh = window.innerHeight || 600, EDGE = 56;
    if (cy < EDGE) window.scrollBy(0, -Math.ceil((EDGE - cy) / 4));
    else if (cy > vh - EDGE) window.scrollBy(0, Math.ceil((cy - (vh - EDGE)) / 4));
    // ── Horizontal card column: constrained sibling-swap ──────────────────
    // A column of a horizontal row may reorder ONLY among its sibling columns
    // in the SAME row — so cards swap places, but a column is never dropped
    // out of its row (which would tear the layout apart) or nested elsewhere.
    var rowParent = horizontalRowParent(el);
    if (rowParent) {
      nest.style.display = 'none';
      var cols = [];
      for (var rc = rowParent.firstElementChild; rc; rc = rc.nextElementSibling) {
        if (rc.nodeType === 1 && rc.hasAttribute('data-block-id') && isDragMovableBlock(rc)) cols.push(rc);
      }
      // Find the sibling cell the cursor is over (or nearest). A grid can wrap
      // onto MULTIPLE rows (a 3×3 九宫格): matching by X alone collapses every
      // card in a column to its topmost one, so only 2-3 targets are reachable
      // and drops onto lower cards scramble the order. Match by 2D distance so
      // every cell is a valid target — the cursor's card (distance 0, cells
      // don't overlap) wins, and between cells the nearest by X+Y wins.
      var tgt = null, bestD = Infinity;
      for (var ci = 0; ci < cols.length; ci++) {
        if (cols[ci] === el) continue;
        var cr = cols[ci].getBoundingClientRect();
        var dx = cx < cr.left ? cr.left - cx : (cx > cr.right ? cx - cr.right : 0);
        var dy = cy < cr.top ? cr.top - cy : (cy > cr.bottom ? cy - cr.bottom : 0);
        var d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; tgt = cols[ci]; }
      }
      if (!tgt) { blockDrag.mode = 'none'; blockDrag.target = null; line.style.display = 'none'; dot.style.display = 'none'; return; }
      var tr = tgt.getBoundingClientRect();
      var beforeCol = cx < (tr.left + tr.right) / 2;   // left half → before, right half → after
      if (!canMoveRelative(el, tgt, beforeCol)) {
        if (canMoveRelative(el, tgt, !beforeCol)) beforeCol = !beforeCol;
        else { blockDrag.mode = 'none'; blockDrag.target = null; line.style.display = 'none'; dot.style.display = 'none'; return; }
      }
      blockDrag.mode = 'move'; blockDrag.side = null; blockDrag.target = tgt; blockDrag.before = beforeCol;
      // Vertical line drawn in the GAP on the chosen side — clamped so it sits
      // between columns, never through one.
      var nbCol = adjBlockSibling(tgt, beforeCol);
      var gx;
      if (beforeCol) {
        var nbR = nbCol ? nbCol.getBoundingClientRect().right : -1e9;
        gx = (nbCol && nbR <= tr.left + 1) ? (nbR + tr.left) / 2 : tr.left - 6;
      } else {
        var nbL = nbCol ? nbCol.getBoundingClientRect().left : 1e9;
        gx = (nbCol && nbL >= tr.right - 1) ? (tr.right + nbL) / 2 : tr.right + 6;
      }
      line.style.display = 'block';
      line.style.left = Math.round(gx - 1) + 'px';
      line.style.top = Math.round(tr.top) + 'px';
      line.style.width = '3px';
      line.style.height = Math.round(tr.height) + 'px';
      dot.style.display = 'none';
      return;
    }
    // ── nest: drop INTO a card / section when the cursor sits comfortably
    // inside its interior (away from the edges, which stay free for reorder).
    // Lets an image land inside a filled, highlighted box, not only above it. ──
    var raw = document.elementFromPoint(cx, cy);
    var rawBlock = raw && raw.closest ? raw.closest('[data-block-id]') : null;
    var box = rawBlock;
    while (box && !isNestContainerEl(box, el)) box = box.parentElement ? box.parentElement.closest('[data-block-id]') : null;
    if (box) {
      // Only nest when the cursor is over the container's OWN area — its own
      // whitespace / padding (rawBlock === box) or a genuinely empty container.
      // If the cursor is over one of the container's CHILD blocks, we must NOT
      // climb up and swallow the small mover into the big parent group: that is
      // exactly the "small element gets linked to a bigger group" bug. In that
      // case fall through to the reorder pass, which lines it up next to the
      // specific child under the cursor instead.
      var overOwnArea = (rawBlock === box) || isEmptyContainerEl(box);
      var rb = box.getBoundingClientRect(), pad = 24;
      if (overOwnArea && (mode === 'edit' || mode === 'drag') && cx > rb.left + pad && cx < rb.right - pad && cy > rb.top + pad && cy < rb.bottom - pad && canMoveInto(el, box, false)) {
        blockDrag.mode = 'into'; blockDrag.target = box; blockDrag.side = null;
        line.style.display = 'none'; dot.style.display = 'none';
        nest.style.display = 'block';
        nest.style.left = Math.round(rb.left) + 'px'; nest.style.top = Math.round(rb.top) + 'px';
        nest.style.width = Math.round(rb.width) + 'px'; nest.style.height = Math.round(rb.height) + 'px';
        return;
      }
    }
    nest.style.display = 'none';
    var hovered = blockUnderPoint(cx, cy, el);
    hovered = resolveDropTarget(hovered, el);
    // If the cursor isn't over any block (the wide empty margins beside the
    // centred content, the gap between blocks, …) fall back to the nearest
    // block by vertical position — so a drop line is ALWAYS shown and the user
    // can drag loosely instead of hunting for the narrow content column.
    if (!hovered || hovered === el) hovered = nearestTopBlock(cx, cy, el);
    if (!hovered || hovered === el) { blockDrag.mode = 'none'; blockDrag.target = null; line.style.display = 'none'; dot.style.display = 'none'; return; }
    line.style.display = 'block';
    var hb = hovered.getBoundingClientRect();
    var horizontal = siblingAxisHorizontal(hovered);
    // ── beside (make a column): deliberate only. The cursor must sit near the
    // block's far left/right edge. We allow this in both edit + drag modes and
    // use a slightly wider magnetic zone so side placement feels natural.
    if ((mode === 'edit' || mode === 'drag') && !horizontal && hb.width > 180) {
      var edge = Math.min(hb.width * 0.18, 72);
      var nearLeft = cx >= hb.left - 18 && cx < hb.left + edge;
      var nearRight = cx <= hb.right + 18 && cx > hb.right - edge;
      if (nearLeft || nearRight) {
        var side = nearLeft ? 'left' : 'right';
        blockDrag.mode = 'beside'; blockDrag.target = hovered; blockDrag.side = side;
        dot.style.display = 'none';
        line.style.left = (side === 'left' ? hb.left - 3 : hb.right) + 'px';
        line.style.top = hb.top + 'px'; line.style.width = '3px'; line.style.height = hb.height + 'px';
        return;
      }
    }
    // ── reorder: drop above / below (or left / right inside an existing row) ──
    blockDrag.mode = 'move'; blockDrag.side = null;
    var before = horizontal ? (cx < (hb.left + hb.right) / 2) : (cy < (hb.top + hb.bottom) / 2);
    if (!canMoveRelative(el, hovered, before)) {
      if (canMoveRelative(el, hovered, !before)) before = !before;
      else {
        blockDrag.mode = 'none'; blockDrag.target = null;
        line.style.display = 'none'; dot.style.display = 'none';
        return;
      }
    }
    blockDrag.target = hovered; blockDrag.before = before;
    // The line sits in the MIDDLE of the gap between the target and its neighbour
    // on the drop side — so it always reads as "between these two", never glued
    // to one edge. With no neighbour, it nudges just past the target's margin.
    var nb = adjBlockSibling(hovered, before);
    if (horizontal) {
      dot.style.display = 'none';
      // Clamp the vertical line to the REAL gap: only use the midpoint between
      // target and neighbour when the neighbour is genuinely on the drop side
      // (its far edge is past the target's near edge). Otherwise hug the
      // target's own edge. This guarantees the line never crosses THROUGH the
      // target — the misleading "line passes through the element" bug.
      var lineX;
      if (before) {
        var nbR = nb ? nb.getBoundingClientRect().right : -1e9;
        lineX = (nb && nbR <= hb.left + 1) ? (nbR + hb.left) / 2 : hb.left - 5;
      } else {
        var nbL = nb ? nb.getBoundingClientRect().left : 1e9;
        lineX = (nb && nbL >= hb.right - 1) ? (hb.right + nbL) / 2 : hb.right + 5;
      }
      line.style.left = Math.round(lineX - 1) + 'px';
      line.style.top = Math.round(hb.top) + 'px'; line.style.width = '3px'; line.style.height = Math.round(hb.height) + 'px';
    } else {
      // Full-width line centred in the gap, with a dot on the left end so the
      // insertion point and its nesting level are obvious at a glance. Same
      // clamp as above so the line stays in the gap, never through the target.
      var lineY;
      if (before) {
        var nbB = nb ? nb.getBoundingClientRect().bottom : -1e9;
        lineY = (nb && nbB <= hb.top + 1) ? (nbB + hb.top) / 2 : hb.top - 5;
      } else {
        var nbT = nb ? nb.getBoundingClientRect().top : 1e9;
        lineY = (nb && nbT >= hb.bottom - 1) ? (hb.bottom + nbT) / 2 : hb.bottom + 5;
      }
      lineY = Math.round(lineY);
      line.style.left = Math.round(hb.left) + 'px';
      line.style.top = (lineY - 1) + 'px'; line.style.width = Math.round(hb.width) + 'px'; line.style.height = '3px';
      dot.style.display = 'block';
      dot.style.left = Math.round(hb.left - 3) + 'px';
      dot.style.top = (lineY - 4) + 'px';
    }
  }
  // Wipe every transient inline style the drag put on a block, so a drop never
  // leaves it dimmed, click-through, or visually floating on top of the page.
  function clearDragStyles(el) {
    if (!el || !el.style) return;
    el.style.outline = ''; el.style.outlineOffset = ''; el.style.opacity = ''; el.style.pointerEvents = '';
  }
  // Belt-and-braces: if any earlier drag was interrupted (lost mouseup, error),
  // a block can be stranded at opacity .55 / pointer-events:none. Clear them.
  function sweepDragStyles() {
    var all = document.querySelectorAll('[data-block-id]');
    for (var i = 0; i < all.length; i++) {
      var s = all[i].style;
      if (s && (s.pointerEvents === 'none' || s.opacity === '0.55')) clearDragStyles(all[i]);
    }
  }
  function onBlockDragEnd() {
    document.removeEventListener('mousemove', onBlockDragMove, true);
    document.removeEventListener('mouseup', onBlockDragEnd, true);
    document.removeEventListener('keydown', onBlockDragKey, true);
    var ds = blockDrag; blockDrag = null;
    if (!ds) return;
    if (ds.line && ds.line.parentNode) ds.line.parentNode.removeChild(ds.line);
    if (ds.dot && ds.dot.parentNode) ds.dot.parentNode.removeChild(ds.dot);
    if (ds.nest && ds.nest.parentNode) ds.nest.parentNode.removeChild(ds.nest);
    clearDragStyles(ds.el);
    document.body.style.cursor = '';
    refreshDragEligibilityMarks();
    if (!ds.target || ds.target === ds.el || ds.mode === 'none') return;
    var movingId = ds.el.getAttribute('data-block-id');
    var targetId = ds.target.getAttribute('data-block-id');
    if (!movingId || !targetId) return;
    if (ds.mode === 'beside') {
      window.parent.postMessage({ type: 'request-place-beside', id: movingId, targetId: targetId, side: ds.side }, '*');
    } else if (ds.mode === 'into') {
      window.parent.postMessage({ type: 'request-move-into', id: movingId, containerId: targetId, atStart: false }, '*');
    } else {
      window.parent.postMessage({ type: 'request-move', id: movingId, targetId: targetId, before: ds.before }, '*');
    }
  }

  // After a surgical drop, bring the block into view + flash it so it never
  // looks like it vanished — vital when it lands far down a long document.
  function revealMoved(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    el.setAttribute('data-flash', '1');
    setTimeout(function () { if (el) el.removeAttribute('data-flash'); }, 1200);
  }

  // ─── [ADDITION · add-media menu (the "+" button) ] ───
  // The "+" on the selection toolbar opens a small menu to insert a new image
  // or video frame right after the selected block.
  function closeAddMenu() {
    var m = document.getElementById('__hce-add-menu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener('mousedown', onAddMenuOutside, true);
    if (pinnedBlock && document.contains(pinnedBlock)) positionPins(pinnedBlock);
  }
  function onAddMenuOutside(e) {
    if (e.target.closest && e.target.closest('#__hce-add-menu')) return;
    closeAddMenu();
  }
  function openAddMenu(afterEl, btn, inCell) {
    closeAddMenu();
    // Normally the new block lands as a full-width block BELOW the selection,
    // climbing out of any column row. When inserting from a cell's "+", target
    // the cell itself so media / links land INSIDE that cell. For container
    // modules (card/section/etc.), also insert INSIDE that module.
    var into = !inCell && canInsertIntoBlock(afterEl);
    var aid = (inCell || into) ? afterEl.getAttribute('data-block-id')
      : resolveInsertAnchor(afterEl).getAttribute('data-block-id');
    var r = btn.getBoundingClientRect();
    var m = document.createElement('div');
    m.id = '__hce-add-menu';
    m.setAttribute('contenteditable', 'false');
    m.style.cssText = 'position:fixed;z-index:2147483600;background:#fff;border:1px solid #e6e6e9;border-radius:10px;' +
      'box-shadow:0 12px 30px rgba(20,24,34,.18);padding:5px;min-width:140px;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937;';
    m.style.left = Math.round(Math.min(r.left, (window.innerWidth || 800) - 152)) + 'px';
    m.style.top = Math.round(r.bottom + 6) + 'px';
    function item(label, icon, kind) {
      return '<button type="button" data-kind="' + kind + '" style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:none;padding:8px 10px;border-radius:7px;cursor:pointer;color:#1f2937;font-size:13px;">' +
        '<span style="display:inline-flex;color:#6b7280">' + icon + '</span><span>' + label + '</span></button>';
    }
    // Image / video share one entry (the placeholder takes either). A table
    // is only offered at top level — never inside a cell (no nested tables).
    m.innerHTML = item(pt('add_media'), ICON_IMG, 'image')
      + (inCell ? '' : item(pt('add_table'), ICON_TABLE, 'table'));
    document.body.appendChild(m);
    // Keep the add menu fully inside the viewport on short screens.
    var mr = m.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    if (mr.bottom > vh - 4) {
      var flipTop = Math.max(4, Math.round(r.top - mr.height - 6));
      m.style.top = flipTop + 'px';
    }
    hideAllGrips(); if (hoverHandle) hoverHandle.style.display = 'none';
    [].forEach.call(m.querySelectorAll('button'), function (b) {
      b.addEventListener('mouseenter', function () { b.style.background = '#f4f4f5'; });
      b.addEventListener('mouseleave', function () { b.style.background = 'none'; });
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-kind');
        var type = kind === 'table' ? 'request-insert-table'
          : kind === 'video' ? 'request-insert-video'
          : 'request-insert-image';
        window.parent.postMessage({ type: type, afterId: aid, into: into }, '*');
        closeAddMenu(); hideTools();
      });
    });
    setTimeout(function () { document.addEventListener('mousedown', onAddMenuOutside, true); }, 0);
  }

  // ─── [ADDITION · drag handle + resize grip, shown on selection] ───
  // The drag handle (top-left) and resize grip (bottom-right) appear only once
  // a block is SELECTED (clicked) and stay pinned to it — so they're stable and
  // easy to grab. Hovering just shows a faint dashed outline as a click preview.
  var hoverHandle = null, hoverOutline = null, sizeTip = null;
  var resizeSE = null, resizeE = null, resizeS = null, resizeN = null, resizeW = null, resizeNW = null, resizeNE = null, resizeSW = null;
  var lastHoverTs = 0, pinnedBlock = null;
  var croppingEl = null, cropPrevStyle = '', cropBar = null;   // image-crop mode state
  function ensureHoverUI() {
    if (hoverHandle) return;
    hoverHandle = document.createElement('div');
    hoverHandle.id = '__hce-hover-handle';
    hoverHandle.setAttribute('contenteditable', 'false');
    hoverHandle.style.cssText = 'position:fixed;z-index:2147483550;display:none;align-items:center;justify-content:center;' +
      'width:18px;height:22px;border-radius:5px;background:#fff;border:1px solid #e6e6e9;box-shadow:0 1px 3px rgba(20,24,34,.14);color:#9aa0a6;cursor:grab;';
    hoverHandle.innerHTML = ICON_GRIP;
    hoverHandle.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (pinnedBlock) startBlockDrag(pinnedBlock, e);
    });
    document.body.appendChild(hoverHandle);
    function mkGrip(id, extra, dir) {
      var g = document.createElement('div');
      g.id = id;
      g.className = '__hce-rsz';
      g.setAttribute('contenteditable', 'false');
      g.style.cssText = 'position:fixed;z-index:2147483551;display:none;background:#fff;box-sizing:border-box;' +
        'border:1.5px solid #ff5a1f;box-shadow:0 1px 3px rgba(20,24,34,.2);transition:background .12s,transform .12s;' + extra;
      g.addEventListener('mouseenter', function () { g.style.background = '#ff5a1f'; });
      g.addEventListener('mouseleave', function () { g.style.background = '#fff'; });
      g.addEventListener('mousedown', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (pinnedBlock) startResize(pinnedBlock, e, dir);
      });
      // Double-click any grip → snap back to the standard size.
      g.addEventListener('dblclick', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (pinnedBlock) resetSize(pinnedBlock);
      });
      document.body.appendChild(g);
      return g;
    }
    // Eight handles: four corners (proportional for media) + four edges
    // (single-axis). Small, consistent white knobs — corners are rounded
    // squares, edges are short pills — so they read as one control set.
    var GC = 'width:10px;height:10px;border-radius:3px;';     // corner squares
    var GV = 'width:6px;height:28px;border-radius:999px;';    // left / right edge pills
    var GH = 'width:20px;height:5px;border-radius:999px;';    // top / bottom edge pills
    resizeSE = mkGrip('__hce-resize-se', GC + 'cursor:nwse-resize;', 'se');
    resizeNW = mkGrip('__hce-resize-nw', GC + 'cursor:nwse-resize;', 'nw');
    resizeNE = mkGrip('__hce-resize-ne', GC + 'cursor:nesw-resize;', 'ne');
    resizeSW = mkGrip('__hce-resize-sw', GC + 'cursor:nesw-resize;', 'sw');
    resizeE = mkGrip('__hce-resize-e', GV + 'cursor:ew-resize;', 'e');
    resizeW = mkGrip('__hce-resize-w', GV + 'cursor:ew-resize;', 'w');
    resizeS = mkGrip('__hce-resize-s', GH + 'cursor:ns-resize;', 's');
    resizeN = mkGrip('__hce-resize-n', GH + 'cursor:ns-resize;', 'n');
    hoverOutline = document.createElement('div');
    hoverOutline.id = '__hce-hover-outline';
    hoverOutline.style.cssText = 'position:fixed;z-index:2147483540;display:none;pointer-events:none;' +
      'border:1.5px dashed rgba(255,90,31,.4);border-radius:3px;';
    document.body.appendChild(hoverOutline);
  }
  function hideHoverOutline() { if (hoverOutline) hoverOutline.style.display = 'none'; }
  function showHoverOutline(el) {
    ensureHoverUI();
    var r = el.getBoundingClientRect();
    hoverOutline.style.display = 'block';
    hoverOutline.style.left = Math.round(r.left) + 'px';
    hoverOutline.style.top = Math.round(r.top) + 'px';
    hoverOutline.style.width = Math.round(r.width) + 'px';
    hoverOutline.style.height = Math.round(r.height) + 'px';
  }
  // True while a media / add-media picker popup is open. The grips sit above the
  // popup (higher z-index), so we keep them hidden while one is open instead of
  // letting them poke through it.
  function anyPickerOpen() {
    return !!(document.getElementById('__hce-media-menu') || document.getElementById('__hce-add-menu'));
  }
  function hideAllGrips() {
    [resizeSE, resizeE, resizeS, resizeN, resizeW, resizeNW, resizeNE, resizeSW].forEach(function (g) { if (g) g.style.display = 'none'; });
  }
  function positionPins(el) {
    ensureHoverUI();
    if (anyPickerOpen()) { hideAllGrips(); if (hoverHandle) hoverHandle.style.display = 'none'; return; }
    if (croppingEl === el) { hideAllGrips(); hoverHandle.style.display = 'none'; return; }   // the crop overlay owns its own handles
    var r = el.getBoundingClientRect();
    var isMedia = el.tagName === 'IMG' || el.tagName === 'VIDEO' || (el.tagName === 'IFRAME' && el.getAttribute('data-hce-video') === 'embed');
    // A committed crop shrinks what's VISIBLE; place the handles on that visible
    // rectangle (read from the inline clip-path) rather than the full image box.
    var crop = isMedia ? readCropFrac(el) : null;
    var er = r;
    if (crop) {
      var vl = r.left + crop.l * r.width, vt = r.top + crop.t * r.height;
      var vw = (1 - crop.l - crop.r) * r.width, vh = (1 - crop.t - crop.b) * r.height;
      er = { left: vl, top: vt, width: vw, height: vh, right: vl + vw, bottom: vt + vh };
    }
    // The drag handle is a drag-mode affordance only — edit mode edits blocks,
    // it never moves them, so the grip stays hidden there.
    hoverHandle.style.display = (mode === 'drag') ? 'flex' : 'none';
    hoverHandle.style.top = Math.round(er.top + 3) + 'px';
    hoverHandle.style.left = Math.round(Math.max(2, er.left - 24)) + 'px';
    var midX = er.left + er.width / 2, midY = er.top + er.height / 2;
    function placeCorners() {
      resizeNW.style.display = 'block'; resizeNW.style.left = Math.round(er.left - 5) + 'px'; resizeNW.style.top = Math.round(er.top - 5) + 'px';
      resizeNE.style.display = 'block'; resizeNE.style.left = Math.round(er.right - 5) + 'px'; resizeNE.style.top = Math.round(er.top - 5) + 'px';
      resizeSW.style.display = 'block'; resizeSW.style.left = Math.round(er.left - 5) + 'px'; resizeSW.style.top = Math.round(er.bottom - 5) + 'px';
      resizeSE.style.display = 'block'; resizeSE.style.left = Math.round(er.right - 5) + 'px'; resizeSE.style.top = Math.round(er.bottom - 5) + 'px';
    }
    function placeEdges() {
      resizeE.style.display = 'block'; resizeE.style.top = Math.round(midY - 14) + 'px'; resizeE.style.left = Math.round(er.right - 3) + 'px';
      resizeW.style.display = 'block'; resizeW.style.top = Math.round(midY - 14) + 'px'; resizeW.style.left = Math.round(er.left - 3) + 'px';
      resizeN.style.display = 'block'; resizeN.style.left = Math.round(midX - 10) + 'px'; resizeN.style.top = Math.round(er.top - 3) + 'px';
      resizeS.style.display = 'block'; resizeS.style.left = Math.round(midX - 10) + 'px'; resizeS.style.top = Math.round(er.bottom - 3) + 'px';
    }
    if (isMedia) {
      // Media → four CORNERS (proportional scale) + four EDGES (single-axis
      // stretch), like a real image editor: drag a corner to keep the ratio,
      // drag an edge pill to adjust just that one side.
      placeCorners();
      placeEdges();
    } else {
      // Text / other blocks → four EDGES only; corners would distort a text box.
      [resizeNW, resizeNE, resizeSW, resizeSE].forEach(function (g) { if (g) g.style.display = 'none'; });
      placeEdges();
    }
  }
  // Show the handle + resize grip on the selected element (the element's own
  // selection outline already marks it, so no extra preview box here).
  function pinHandleTo(el) {
    pinnedBlock = el;
    hideHoverOutline();
    positionPins(el);
  }
  function unpinHandle() {
    pinnedBlock = null;
    if (hoverHandle) hoverHandle.style.display = 'none';
    [resizeSE, resizeE, resizeS, resizeN, resizeW, resizeNW, resizeNE, resizeSW].forEach(function (g) { if (g) g.style.display = 'none'; });
    if (sizeTip) sizeTip.style.display = 'none';
    hideHoverOutline();
  }
  function resolveCandidate(x, y, alt) {
    var t = document.elementFromPoint(x, y);
    if (!t || !t.closest) return null;
    if (t.closest('#__hce-tools,#__hce-style-panel,#__hce-hover-handle,#__hce-hover-outline,.__hce-rsz,#__hce-media-menu,#__hce-add-menu,.__hce-media-ph,#__hce-drop-line')) return null;
    var el = t.closest('[data-block-id]');
    // Climb past inline-level runs (strong / em / a / span text) to the nearest
    // block — that's the unit people actually mean to grab, not a single word.
    while (el && el !== document.body) {
      var disp = getComputedStyle(el).display;
      if (disp !== 'inline') break;
      el = el.parentElement && el.parentElement.closest('[data-block-id]');
    }
    if (!el || el === document.body || el === document.documentElement) return null;
    if (alt) {
      var p = el.parentElement && el.parentElement.closest('[data-block-id]');
      if (p && p !== document.body) el = p;
    }
    return el;
  }
  // Hover just previews what a click would select — a faint outline, no handle.
  function onHoverMove(e) {
    if (!e) return;
    if ((mode !== 'edit' && mode !== 'drag') || blockDrag || croppingEl || segDrag) { hideHoverOutline(); return; }
    var over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && over.closest && over.closest('#__hce-hover-handle,.__hce-rsz')) return;
    // Never steal hover while the pointer is on the table controls / their menu.
    if (over && over.closest && over.closest('#__hce-tablectl,#__hce-table-menu')) return;
    var cand = resolveCandidate(e.clientX, e.clientY, e.altKey);
    if (mode === 'drag') {
      var tblHover = over && over.closest ? over.closest('table[data-block-id]') : null;
      // Show the row/column bars whenever the table has something to reorder
      // INSIDE it (>= 2 columns or >= 2 rows) — internal row/column dragging
      // must NOT depend on whether the whole table can be moved elsewhere. A
      // table that's the only block on the page (no move target) still needs its
      // internal controls. Whole-table dragging via the corner grip is still
      // gated on data-hce-draggable inside showTableControls.
      if (tblHover && tableHasReorderableParts(tblHover)) {
        showTableControls(tblHover);
      } else if (tableCtlId != null && tableCtl && tableCtl._table && document.contains(tableCtl._table)) {
        // The handles live in bars OUTSIDE the table (above / left, with a small
        // gap, plus the "+" strips on the right / bottom). Moving the cursor
        // from inside the table toward a handle briefly crosses that gap where
        // the cursor is over neither the table nor a handle — if we hid the
        // controls there, the handle would vanish exactly as you reach for it.
        // Keep them shown while the cursor stays within the table's expanded
        // control region; only hide once it clearly leaves.
        var ctr = tableCtl._table.getBoundingClientRect();
        var M = 26;   // covers the 18px bar + gap, with a little slack
        var inRegion = e.clientX >= ctr.left - M && e.clientX <= ctr.right + M &&
                       e.clientY >= ctr.top - M && e.clientY <= ctr.bottom + M;
        if (!inRegion) hideTableControls();
      }
      cand = resolveDragStartBlock(over);
    }
    if (!cand || cand === pinnedBlock) { hideHoverOutline(); return; }
    showHoverOutline(cand);
  }
  function scheduleHover(e) {
    var now = Date.now();
    if (now - lastHoverTs < 16) return;
    lastHoverTs = now;
    onHoverMove(e);
  }
  function initHoverHandle() {
    ensureHoverUI();
    document.addEventListener('mousemove', scheduleHover, true);
    // Drag mode: the whole block is grabbable — press anywhere on it to drag,
    // no grip needed (text isn't editable here, so there's no conflict). A drag
    // only begins once the pointer moves past a small threshold, so a plain
    // click never nudges anything (the #1 "everything moves" complaint).
    var pend = null;
    document.addEventListener('mousedown', function (e) {
      if (mode !== 'drag' || e.button !== 0 || blockDrag) return;
      if (e.target.closest && e.target.closest('#__hce-tools,#__hce-hover-handle,.__hce-rsz,#__hce-media-menu,#__hce-add-menu,#__hce-tablectl,#__hce-table-menu')) return;
      var el = resolveDragStartBlock(e.target);
      if (!el) return;
      pend = { el: el, x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (!pend || blockDrag) return;
      if (Math.abs(e.clientX - pend.x) < 6 && Math.abs(e.clientY - pend.y) < 6) return;
      var el = pend.el; pend = null;
      startBlockDrag(el, e);
    }, true);
    document.addEventListener('mouseup', function () { pend = null; }, true);
    // Kill the browser's NATIVE HTML5 drag for links & images while editing.
    // <a href> and <img> default to draggable=true, so grabbing a linked block
    // (or any image) starts the browser's own "drag the URL / picture out"
    // gesture — the ghost of the page/link/image — instead of our block-drag
    // engine, and on release can even navigate. In every interactive mode
    // (anything but read-only View) we cancel dragstart so only our own drag
    // logic runs. View keeps native behaviour (nothing to protect there).
    document.addEventListener('dragstart', function (e) {
      if (mode !== 'view') e.preventDefault();
    }, true);
    window.addEventListener('scroll', function () {
      if (pinnedBlock && document.contains(pinnedBlock)) positionPins(pinnedBlock);
      if (tableCtlId != null) positionTableControls();
      hideHoverOutline();
    }, true);
  }
  // ─── [ADDITION · resize via grips, 8 directions] ───
  // Four corners + four edges. Corner on media = proportional (no distortion);
  // corner on other elements = width + min-height. Edge = single axis. The
  // 'w' / 'n' directions anchor the opposite edge by compensating margin, so
  // dragging the left/top edge keeps the right/bottom put. While dragging we
  // show a size readout and magnetically snap the width to 25/50/75/100% of the
  // container (and an image's native width) so there's always a sane reference
  // — release away from those points for a fully custom size. Persisted via the
  // style path so it syncs, survives refresh, and is undoable.
  function ensureSizeTip() {
    if (sizeTip) return sizeTip;
    sizeTip = document.createElement('div');
    sizeTip.id = '__hce-size-tip';
    sizeTip.setAttribute('contenteditable', 'false');
    sizeTip.style.cssText = 'position:fixed;z-index:2147483560;display:none;pointer-events:none;'
      + 'background:#1f2937;color:#fff;font:600 11px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;'
      + 'padding:3px 7px;border-radius:6px;box-shadow:0 2px 8px rgba(20,24,34,.25);white-space:nowrap;';
    document.body.appendChild(sizeTip);
    return sizeTip;
  }
  function showSizeTip(x, y, text, snapped) {
    ensureSizeTip();
    sizeTip.textContent = text;
    sizeTip.style.background = snapped ? '#ff5a1f' : '#1f2937';
    sizeTip.style.display = 'block';
    sizeTip.style.left = Math.round(Math.min(x + 14, (window.innerWidth || 800) - 96)) + 'px';
    sizeTip.style.top = Math.round(Math.max(6, y + 16)) + 'px';
  }
  function hideSizeTip() { if (sizeTip) sizeTip.style.display = 'none'; }
  // Double-click a grip → revert to the standard size: media fills its column
  // (100% wide, auto height); other blocks drop the explicit sizing overrides.
  function resetSize(el) {
    if (!el) return;
    if ((el.tagName === 'TD' || el.tagName === 'TH') && el.closest) {
      var cellTbl = el.closest('table[data-block-id], table');
      if (cellTbl && cellTbl.getAttribute && cellTbl.getAttribute('data-block-id')) el = cellTbl;
    }
    var media = el.tagName === 'IMG' || el.tagName === 'VIDEO' || (el.tagName === 'IFRAME' && el.getAttribute('data-hce-video') === 'embed');
    ['width', 'height', 'min-height', 'max-width', 'aspect-ratio', 'object-fit', 'margin-left', 'margin-top'].forEach(function (p) { el.style.removeProperty(p); });
    if (media) { el.style.setProperty('width', '100%'); el.style.setProperty('height', 'auto'); el.style.setProperty('max-width', '100%'); }
    positionPins(el);
    hideSizeTip();
    window.parent.postMessage({ type: 'style-committed',
      styles: [{ id: el.getAttribute('data-block-id'), style: el.getAttribute('style') || '' }] }, '*');
  }
  function startResize(el, ev, dir) {
    if ((el.tagName === 'TD' || el.tagName === 'TH') && el.closest) {
      var cellTbl = el.closest('table[data-block-id], table');
      if (cellTbl && cellTbl.getAttribute && cellTbl.getAttribute('data-block-id')) el = cellTbl;
    }
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle ? getComputedStyle(el) : null;
    var startW = r.width || 1, startH = r.height || 1, sx = ev.clientX, sy = ev.clientY;
    var startML = cs ? (parseFloat(cs.marginLeft) || 0) : 0;
    var startMT = cs ? (parseFloat(cs.marginTop) || 0) : 0;
    // getBoundingClientRect() is the BORDER box, but the width / height CSS
    // properties set the CONTENT box under the default box-sizing:content-box.
    // That gap (padding + border) is why a snapped edge — and its guide line —
    // used to land INSIDE the element. Measure it so we size in border-box terms.
    var boxExtraW = 0, boxExtraH = 0;
    if (cs && cs.boxSizing !== 'border-box') {
      boxExtraW = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
      boxExtraH = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    var isMedia = el.tagName === 'IMG' || el.tagName === 'VIDEO' || (el.tagName === 'IFRAME' && el.getAttribute('data-hce-video') === 'embed');
    var isTable = el.tagName === 'TABLE';
    // Table cells: resize by column / row (not by box center scaling).
    var isCell = el.tagName === 'TD' || el.tagName === 'TH';
    var vProp = isCell ? 'height' : 'min-height';
    var inCrop = (croppingEl === el);
    var cropF = isMedia ? readCropFrac(el) : null, cropBaseMR = 0, cropBaseMB = 0;
    var tableEl = isCell ? (el.closest && el.closest('table')) : null;
    var rowEl = isCell ? el.parentElement : null;
    var colIndex = -1;
    if (isCell && rowEl) {
      var kids = rowEl.children || [];
      for (var ci = 0; ci < kids.length; ci++) { if (kids[ci] === el) { colIndex = ci; break; } }
    }
    var colCells = [];
    var rowCells = [];
    // Per-column initial rendered widths, so a cell resize only changes the
    // dragged column and leaves every other column exactly where it was.
    var colWidths = [];       // rendered width of each column (index-aligned to header row)
    var headerRowCells = [];  // one cell per column, used to pin every column's width
    var tableStartW = 0;
    var startTableML = 0;     // table's own margin-left, for left-edge drags
    if (isCell && tableEl && rowEl && colIndex >= 0) {
      var trs = tableEl.querySelectorAll('tr');
      for (var ti = 0; ti < trs.length; ti++) {
        var tc = trs[ti].children[colIndex];
        if (tc && (tc.tagName === 'TD' || tc.tagName === 'TH')) colCells.push(tc);
      }
      for (var ri = 0; ri < rowEl.children.length; ri++) {
        var rc = rowEl.children[ri];
        if (rc && (rc.tagName === 'TD' || rc.tagName === 'TH')) rowCells.push(rc);
      }
      // Sample every column's CURRENT rendered width from the dragged cell's own
      // row (so the numbers are mutually consistent and nothing jumps when we
      // pin them). Pin the table to fixed layout with an explicit total width so
      // the dragged edge grows / shrinks the table instead of re-flowing columns.
      var sampleRow = (rowEl && rowEl.children.length) ? rowEl : null;
      if (!sampleRow) { var mc = 0; for (var si = 0; si < trs.length; si++) { var n = trs[si].children.length; if (n > mc) { mc = n; sampleRow = trs[si]; } } }
      if (sampleRow) {
        for (var hi = 0; hi < sampleRow.children.length; hi++) {
          var hc = sampleRow.children[hi];
          headerRowCells.push(hc);
          colWidths.push(Math.round(hc.getBoundingClientRect().width));
        }
      }
      tableStartW = Math.round(tableEl.getBoundingClientRect().width);
      var tcsm = getComputedStyle(tableEl);
      startTableML = parseFloat(tcsm.marginLeft) || 0;
    }
    // Snapshot the affected elements BEFORE any style mutation so this resize is
    // undoable (it posts style-committed directly; the local history must hold
    // the matching before/after or Cmd+Z would revert nothing).
    var resizeUndoEls = [el];
    if (isCell) {
      [colCells, rowCells, headerRowCells].forEach(function (list) {
        list.forEach(function (c) { if (resizeUndoEls.indexOf(c) < 0) resizeUndoEls.push(c); });
      });
      if (tableEl && resizeUndoEls.indexOf(tableEl) < 0) resizeUndoEls.push(tableEl);
    }
    var resizeUndoBefore = hceSnapList(resizeUndoEls);
    var resizeCommitStyles = null;
    function addResizeCommit(list, node) {
      if (!node || !node.getAttribute) return;
      var id = node.getAttribute('data-block-id');
      if (!id) return;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return;
      list.push({ id: id, style: node.getAttribute('style') || '' });
    }
    if (cropF) {
      var csc = getComputedStyle(el);
      cropBaseMR = (parseFloat(csc.marginRight) || 0) + (cropF.l + cropF.r) * (r.width || 1);
      cropBaseMB = (parseFloat(csc.marginBottom) || 0) + (cropF.t + cropF.b) * (r.height || 1);
    }
    // Inline elements ignore width — promote them so resizing actually works
    // (keeps behaviour consistent across every kind of block).
    if (cs && cs.display === 'inline') el.style.setProperty('display', 'inline-block', 'important');
    var ratio = startH / startW;
    var hasE = dir.indexOf('e') >= 0, hasW = dir.indexOf('w') >= 0;
    var hasS = dir.indexOf('s') >= 0, hasN = dir.indexOf('n') >= 0;
    var isCorner = (hasE || hasW) && (hasS || hasN);
    var parentEl = el.parentNode;
    var pr = (parentEl && parentEl.getBoundingClientRect) ? parentEl.getBoundingClientRect() : null;
    var cw = pr ? pr.width : (window.innerWidth || startW);
    var startLeft = r.left, startRight = r.right, startTop = r.top, startBottom = r.bottom;

    // The lowest edge directly ABOVE this element (bottom of the nearest block
    // that overlaps it horizontally, otherwise the container top). Dragging the
    // top edge / top corners up is clamped to this so the image grows to fill
    // the gap above and then stops, instead of sliding under — and visually
    // covering — the previous element.
    var ceilingY = pr ? pr.top : 0;
    (function () {
      var bl = document.querySelectorAll('[data-block-id]');
      for (var ci = 0; ci < bl.length; ci++) {
        var cb = bl[ci];
        if (cb === el || cb.contains(el) || el.contains(cb)) continue;
        var cr = cb.getBoundingClientRect();
        if (cr.bottom <= startTop + 1 && cr.right > startLeft + 4 && cr.left < startRight - 4 && cr.bottom > ceilingY) ceilingY = cr.bottom;
      }
    })();

    // Collect alignment lines from the OTHER blocks (and the container content
    // box) so a resize can snap to line up with the rest of the document, not
    // only to 25 / 50 / 75 / 100% of the column.
    function collectEdges(axis) {
      var list = [];
      function push(v, a, b) {
        for (var k = 0; k < list.length; k++) if (Math.abs(list[k].v - v) <= 2) { list[k].a = Math.min(list[k].a, a); list[k].b = Math.max(list[k].b, b); return; }
        list.push({ v: v, a: a, b: b });
      }
      var blocks = document.querySelectorAll('[data-block-id]');
      var vh = window.innerHeight || 9999, vw = window.innerWidth || 9999;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b === el || b.contains(el) || el.contains(b)) continue;
        var rb = b.getBoundingClientRect();
        if (rb.width < 8 || rb.height < 4) continue;
        if (rb.bottom < -40 || rb.top > vh + 40 || rb.right < -40 || rb.left > vw + 40) continue;
        if (axis === 'x') { push(Math.round(rb.left), rb.top, rb.bottom); push(Math.round(rb.right), rb.top, rb.bottom); }
        else { push(Math.round(rb.top), rb.left, rb.right); push(Math.round(rb.bottom), rb.left, rb.right); }
      }
      if (pr) {
        if (axis === 'x') { push(Math.round(pr.left), pr.top, pr.bottom); push(Math.round(pr.right), pr.top, pr.bottom); }
        else { push(Math.round(pr.top), pr.left, pr.right); push(Math.round(pr.bottom), pr.left, pr.right); }
      }
      return list;
    }
    var edgesX = collectEdges('x'), edgesY = collectEdges('y');

    // Snap a width: element alignment first (tight), then the column fractions.
    function snapW(rawW, side) {
      rawW = Math.max(40, rawW);
      var fixedX = side === 'w' ? startRight : startLeft, sgn = side === 'w' ? -1 : 1;
      var edgeX = fixedX + sgn * rawW, bd = 10, best = null, lab = null, guide = null;
      for (var j = 0; j < edgesX.length; j++) { var d = Math.abs(edgeX - edgesX[j].v); if (d < bd) { bd = d; best = sgn * (edgesX[j].v - fixedX); lab = pt('rs_align'); guide = { x: edgesX[j].v, a: edgesX[j].a, b: edgesX[j].b }; } }
      var fr = [[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']];
      for (var i = 0; i < fr.length; i++) { var pw = cw * fr[i][0], pxx = fixedX + sgn * pw, d2 = Math.abs(edgeX - pxx); if (d2 < bd) { bd = d2; best = pw; lab = fr[i][1]; guide = { x: pxx, full: true }; } }
      if (isMedia && el.naturalWidth) { var nxx = fixedX + sgn * el.naturalWidth, dn = Math.abs(edgeX - nxx); if (dn < bd) { bd = dn; best = el.naturalWidth; lab = pt('rs_native'); guide = { x: nxx, full: true }; } }
      if (best === null || best < 40) return { w: Math.round(rawW), label: null, guide: null };
      return { w: Math.round(best), label: lab, guide: guide };
    }
    // Snap a height to other blocks' top / bottom edges.
    function snapH(rawH, side) {
      rawH = Math.max(24, rawH);
      var fixedY = side === 'n' ? startBottom : startTop, sgn = side === 'n' ? -1 : 1;
      var edgeY = fixedY + sgn * rawH, bd = 10, best = null, guide = null;
      for (var j = 0; j < edgesY.length; j++) { var d = Math.abs(edgeY - edgesY[j].v); if (d < bd) { bd = d; best = sgn * (edgesY[j].v - fixedY); guide = { y: edgesY[j].v, a: edgesY[j].a, b: edgesY[j].b }; } }
      if (best === null || best < 24) return { h: Math.round(rawH), guide: null };
      return { h: Math.round(best), guide: guide };
    }
    function showGuide(gx, gy) {
      if (gx) {
        var rr = el.getBoundingClientRect();
        if (gx.full) showSnapV(gx.x, pr ? pr.top : rr.top, pr ? pr.height : rr.height);
        else { var t = Math.min(gx.a, rr.top); showSnapV(gx.x, t, Math.max(gx.b, rr.bottom) - t); }
      } else hideSnapV();
      if (gy) { var r2 = el.getBoundingClientRect(); var l = Math.min(gy.a, r2.left); showSnapH(gy.y, l, Math.max(gy.b, r2.right) - l); } else hideSnapH();
    }
    document.body.style.cursor = isCorner
      ? (((hasE && hasS) || (hasW && hasN)) ? 'nwse-resize' : 'nesw-resize')
      : ((hasE || hasW) ? 'ew-resize' : 'ns-resize');
    // For a table cell: pin the table to fixed layout with an explicit total
    // width, and pin every column to its current rendered width. Now changing
    // one column's width only moves that column's far edge — the rest of the
    // table holds still (no proportional re-flow, no center-mirror effect).
    if (isCell && tableEl && colWidths.length) {
      tableEl.style.setProperty('table-layout', 'fixed', 'important');
      tableEl.style.setProperty('width', tableStartW + 'px', 'important');
      tableEl.style.setProperty('max-width', 'none', 'important');
      for (var pc = 0; pc < headerRowCells.length; pc++) {
        var w = colWidths[pc];
        headerRowCells[pc].style.setProperty('width', w + 'px', 'important');
      }
    }
    function move(e) {
      if (e.preventDefault) e.preventDefault();
      var dx = e.clientX - sx, dy = e.clientY - sy;
      var curW = startW, curH = startH, label = null, gx = null, gy = null;
      if (isCell) {
        var nextW = startW, nextH = startH, commits = [];
        if (hasE || hasW) {
          // The dragged edge follows the cursor. Only THIS column's width
          // changes; the table's explicit total width absorbs the delta so no
          // other column re-flows. For a left-edge drag we also shift the whole
          // table right by the growth so the cell's RIGHT edge stays put and the
          // LEFT edge is the one that tracks the cursor.
          nextW = Math.max(24, Math.round(hasE ? (startW + dx) : (startW - dx)));
          var delta = nextW - startW;
          for (var cc = 0; cc < colCells.length; cc++) {
            colCells[cc].style.setProperty('width', nextW + 'px', 'important');
            addResizeCommit(commits, colCells[cc]);
          }
          if (tableEl) {
            tableEl.style.setProperty('width', (tableStartW + delta) + 'px', 'important');
            if (hasW) tableEl.style.setProperty('margin-left', Math.round(startTableML - delta) + 'px', 'important');
            addResizeCommit(commits, tableEl);
          }
          // Guide line sits exactly on the edge being dragged.
          var guideEdgeX = hasE ? (startLeft + nextW) : (startRight - nextW);
          gx = { x: guideEdgeX, a: startTop, b: startBottom };
          curW = nextW;
        }
        if (hasS || hasN) {
          nextH = Math.max(16, Math.round(hasS ? (startH + dy) : (startH - dy)));
          // Row height: set on every cell in the row so the whole row grows
          // downward (top edge fixed) or, for a north drag, we also lift via a
          // negative margin is not possible on cells — so north simply grows the
          // row too, anchored at the top. Bottom edge tracks the cursor.
          if (rowEl) rowEl.style.setProperty('height', nextH + 'px', 'important');
          for (var rc = 0; rc < rowCells.length; rc++) {
            rowCells[rc].style.setProperty('height', nextH + 'px', 'important');
            addResizeCommit(commits, rowCells[rc]);
          }
          var guideEdgeY = hasN ? (startBottom - nextH) : (startTop + nextH);
          gy = { y: guideEdgeY, a: startLeft, b: startLeft + curW };
          curH = nextH;
        }
        resizeCommitStyles = commits;
        positionPins(el);
        showGuide(gx, gy);
        var h2 = hasE || hasW, v2 = hasS || hasN, txt2;
        if (h2 && v2) txt2 = Math.round(curW) + ' × ' + Math.round(curH);
        else if (h2) txt2 = Math.round(curW) + ' px';
        else txt2 = Math.round(curH) + ' px';
        showSizeTip(e.clientX, e.clientY, txt2, false);
        return;
      }
      if (inCrop) {
        // Free rectangular framing for crop: width from the horizontal edges,
        // height from the vertical edges, fully independent; the image stays
        // object-fit:cover so the box clips it. Each side anchors its opposite.
        var nw = startW, nh = startH, newCropML = startML, newCropMT = startMT;
        if (hasE || hasW) { var sc = snapW(hasE ? startW + dx : startW - dx, hasE ? 'e' : 'w'); nw = sc.w; label = sc.label; }
        if (hasS || hasN) { var shc = snapH(hasS ? startH + dy : startH - dy, hasS ? 's' : 'n'); nh = shc.h; }
        el.style.setProperty('width', Math.round(nw) + 'px', 'important');
        el.style.setProperty('height', Math.round(nh) + 'px', 'important');
        el.style.setProperty('object-fit', 'cover', 'important');
        el.style.setProperty('aspect-ratio', 'auto', 'important');
        el.style.setProperty('max-width', 'none', 'important');
        if (hasW) { newCropML = Math.round(startML + (startW - nw)); el.style.setProperty('margin-left', newCropML + 'px', 'important'); }
        if (hasN) { newCropMT = Math.round(startMT + (startH - nh)); el.style.setProperty('margin-top', newCropMT + 'px', 'important'); }
        // Guide lines at actual dragged edges
        if (hasE) gx = { x: startLeft + nw, a: startTop, b: startTop + nh };
        if (hasW) gx = { x: startLeft + newCropML, a: startTop, b: startTop + nh };
        if (hasS) gy = { y: startTop + nh, a: startLeft, b: startLeft + nw };
        if (hasN) gy = { y: startTop + newCropMT, a: startLeft, b: startLeft + nw };
        curW = nw; curH = nh;
      } else if (isCorner && isMedia) {
        // Proportional scale for media, driven by the LARGER of the horizontal
        // and vertical drag so the corner follows the cursor in both directions
        // (the bottom-right grip now resizes when pulled down, not just side-
        // ways). Anchor the opposite edge via margin.
        var dW = hasE ? dx : -dx;
        var dHw = (hasS ? dy : -dy) / (ratio || 1);
        var deltaW = Math.abs(dW) >= Math.abs(dHw) ? dW : dHw;
        var sn = snapW(Math.max(40, startW + deltaW), hasE ? 'e' : 'w');
        var pw = sn.w; label = sn.label;
        var ph = Math.round(pw * ratio);
        var newCornerML = startML, newCornerMT = startMT;
        // A top-corner drag may not slide the image up over the block above.
        if (hasN && ph > startBottom - ceilingY) { ph = Math.max(40, Math.round(startBottom - ceilingY)); pw = Math.round(ph / (ratio || 1)); label = null; gx = null; gy = null; }
        else {
          el.style.setProperty('width', pw + 'px', 'important');
          el.style.setProperty('height', ph + 'px', 'important');
          el.style.setProperty('aspect-ratio', 'auto', 'important');
          el.style.setProperty('max-width', 'none', 'important');
          if (hasW) { newCornerML = Math.round(startML + (startW - pw)); el.style.setProperty('margin-left', newCornerML + 'px', 'important'); }
          if (hasN) { newCornerMT = Math.round(startMT + (startH - ph)); el.style.setProperty('margin-top', newCornerMT + 'px', 'important'); }
          if (cropF) {   // keep the crop's gap-closing margins in step with the new size
            el.style.setProperty('margin-right', Math.round(cropBaseMR - (cropF.l + cropF.r) * pw) + 'px', 'important');
            el.style.setProperty('margin-bottom', Math.round(cropBaseMB - (cropF.t + cropF.b) * ph) + 'px', 'important');
          }
          // Guide lines at actual dragged edges
          if (hasE) gx = { x: startLeft + pw, a: startTop + newCornerMT, b: startTop + newCornerMT + ph };
          if (hasW) gx = { x: startLeft + newCornerML, a: startTop + newCornerMT, b: startTop + newCornerMT + ph };
          if (hasS) gy = { y: startTop + ph, a: startLeft + newCornerML, b: startLeft + newCornerML + pw };
          if (hasN) gy = { y: startTop + newCornerMT, a: startLeft + newCornerML, b: startLeft + newCornerML + pw };
        }
        curW = pw; curH = ph;
      } else {
        if (hasE) {
          var se = snapW(startW + dx, 'e');
          label = se.label; curW = se.w;
          if (isTable) el.style.setProperty('table-layout', 'fixed', 'important');
          el.style.setProperty('width', Math.round(se.w - boxExtraW) + 'px', 'important');
          el.style.setProperty('max-width', 'none', 'important');
          // Guide line at actual right edge being dragged
          gx = { x: startLeft + curW, a: startTop, b: startBottom };
          if (isMedia) { curH = Math.round(startH); el.style.setProperty('height', curH + 'px', 'important'); el.style.setProperty('aspect-ratio', 'auto', 'important'); el.style.setProperty('object-fit', 'cover', 'important'); }
        }
        if (hasW) {
          var sw2 = snapW(startW - dx, 'w');
          label = sw2.label; curW = sw2.w;
          if (isTable) el.style.setProperty('table-layout', 'fixed', 'important');
          el.style.setProperty('width', Math.round(sw2.w - boxExtraW) + 'px', 'important');
          el.style.setProperty('max-width', 'none', 'important');
          var newML = Math.round(startML + (startW - sw2.w));
          el.style.setProperty('margin-left', newML + 'px', 'important');
          // Guide line at actual left edge being dragged
          gx = { x: startLeft + newML, a: startTop, b: startBottom };
          if (isMedia) { curH = Math.round(startH); el.style.setProperty('height', curH + 'px', 'important'); el.style.setProperty('aspect-ratio', 'auto', 'important'); el.style.setProperty('object-fit', 'cover', 'important'); }
        }
        if (hasS) {
          var hs2 = snapH(startH + dy, 's'); curH = hs2.h;
          if (isMedia) { el.style.setProperty('height', curH + 'px', 'important'); el.style.setProperty('aspect-ratio', 'auto', 'important'); }
          else el.style.setProperty(vProp, Math.round(curH - boxExtraH) + 'px', 'important');
          // Guide line at actual bottom edge being dragged
          gy = { y: startTop + curH, a: startLeft, b: startLeft + curW };
        }
        if (hasN) {
          var hn2 = snapH(startH - dy, 'n'); curH = hn2.h;
          // Don't let an upward drag slide the top edge under the block above.
          if (curH > startBottom - ceilingY) { curH = Math.max(24, Math.round(startBottom - ceilingY)); gy = null; }
          else {
            var newMT = Math.round(startMT + (startH - curH));
            // Guide line at actual top edge being dragged
            gy = { y: startTop + newMT, a: startLeft, b: startLeft + curW };
          }
          if (isMedia) { el.style.setProperty('height', curH + 'px', 'important'); el.style.setProperty('aspect-ratio', 'auto', 'important'); }
          else el.style.setProperty(vProp, Math.round(curH - boxExtraH) + 'px', 'important');
          if (!isCell) el.style.setProperty('margin-top', Math.round(startMT + (startH - curH)) + 'px', 'important');
        }
        if (isMedia && (hasS || hasN) && !(hasE || hasW)) el.style.setProperty('object-fit', 'cover', 'important');
        if (cropF) {   // a cropped image: keep the gap-closing margins in step with the new size
          if (hasE || hasW) el.style.setProperty('margin-right', Math.round(cropBaseMR - (cropF.l + cropF.r) * curW) + 'px', 'important');
          if (hasS || hasN) el.style.setProperty('margin-bottom', Math.round(cropBaseMB - (cropF.t + cropF.b) * curH) + 'px', 'important');
        }
      }
      // Belt-and-suspenders: pin every guide to the element's ACTUAL rendered
      // edge after layout, so padding / border / box-sizing / clamping can never
      // leave the line floating inside the box.
      if (!isCell) {
        var liveR = el.getBoundingClientRect();
        if (gx && !gx.full) { if (hasE) gx.x = liveR.right; else if (hasW) gx.x = liveR.left; }
        if (gy) { if (hasS) gy.y = liveR.bottom; else if (hasN) gy.y = liveR.top; }
      }
      positionPins(el);
      showGuide(gx, gy);
      var horiz = hasE || hasW, vert = hasS || hasN, txt;
      if (horiz && vert) txt = Math.round(curW) + ' × ' + Math.round(curH);
      else if (horiz) txt = Math.round(curW) + ' px' + (cw ? '  ·  ' + Math.round(curW / cw * 100) + '%' : '');
      else txt = Math.round(curH) + ' px';
      if (label) txt += '  ⋯ ' + label;
      showSizeTip(e.clientX, e.clientY, txt, !!label);
    }
    function up() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      document.body.style.cursor = '';
      hideSizeTip();
      hideSnapGuides();
      // Record before/after into the style history and persist — but only if the
      // resize actually changed something, so a no-op click on a grip doesn't
      // create a dead undo step.
      var resizeUndoAfter = hceSnapList(resizeUndoEls);
      if (hceListsDiffer(resizeUndoBefore, resizeUndoAfter)) {
        hcePushStyleUndo(resizeUndoBefore, resizeUndoAfter);
        var styles = resizeCommitStyles && resizeCommitStyles.length
          ? resizeCommitStyles
          : [{ id: el.getAttribute('data-block-id'), style: el.getAttribute('style') || '' }];
        window.parent.postMessage({ type: 'style-committed', styles: styles }, '*');
      }
      resizeCommitStyles = null;
    }
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
  }

  // ─── [ADDITION · magnetic snap guide line] ───
  // A thin orange line down the edge an element snaps to while resizing, so
  // alignment to 25 / 50 / 75 / 100% of the container reads clearly.
  var snapGuideV = null, snapGuideH = null;
  function ensureSnapGuides() {
    if (snapGuideV) return;
    snapGuideV = document.createElement('div');
    snapGuideV.id = '__hce-snap-guide';
    snapGuideV.setAttribute('contenteditable', 'false');
    snapGuideV.style.cssText = 'position:fixed;z-index:2147483545;display:none;pointer-events:none;width:0;border-left:1px dashed #ff5a1f;';
    document.body.appendChild(snapGuideV);
    snapGuideH = document.createElement('div');
    snapGuideH.id = '__hce-snap-guide-h';
    snapGuideH.setAttribute('contenteditable', 'false');
    snapGuideH.style.cssText = 'position:fixed;z-index:2147483545;display:none;pointer-events:none;height:0;border-top:1px dashed #ff5a1f;';
    document.body.appendChild(snapGuideH);
  }
  function showSnapV(x, top, height) {
    ensureSnapGuides();
    snapGuideV.style.display = 'block';
    snapGuideV.style.left = Math.round(x) + 'px';
    snapGuideV.style.top = Math.round(top) + 'px';
    snapGuideV.style.height = Math.round(height) + 'px';
  }
  function hideSnapV() { if (snapGuideV) snapGuideV.style.display = 'none'; }
  function showSnapH(y, left, width) {
    ensureSnapGuides();
    snapGuideH.style.display = 'block';
    snapGuideH.style.top = Math.round(y) + 'px';
    snapGuideH.style.left = Math.round(left) + 'px';
    snapGuideH.style.width = Math.round(width) + 'px';
  }
  function hideSnapH() { if (snapGuideH) snapGuideH.style.display = 'none'; }
  function hideSnapGuides() { hideSnapV(); hideSnapH(); }

  // ─── [ADDITION · image crop (overlay)] ───
  // A real crop: the full image stays put while a bright rectangle — rule-of-
  // thirds grid + 8 handles — is drawn over it and everything outside is dimmed,
  // so you see exactly what gets cut away. Confirm bakes the rectangle into the
  // single <img> with clip-path + transform + negative margins (all inline
  // style, so it syncs / exports / undoes and survives a later resize); cancel
  // restores the snapshot. Shortcuts: Alt-click an image to start, click empty
  // space (or Enter) to confirm, Esc to cancel. The crop fractions live in the
  // clip-path itself — the persisted source of truth (data attrs don't sync).
  var cropOverlay = null, cropRectEl = null, cropHandleEls = [], cropScrim = {}, cropPanLayer = null;
  var cropFrac = { t: 0, r: 0, b: 0, l: 0 }, cropSuppressClick = false;

  function cropClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function readCropFrac(el) {
    var st = el && el.style && (el.style.clipPath || el.style.webkitClipPath || '');
    if (!st || st.indexOf('inset(') < 0) return null;
    var m = st.match(/inset\\(([^)]+)\\)/);
    if (!m) return null;
    var n = m[1].trim().split(/\\s+/).map(function (s) { return (parseFloat(s) || 0) / 100; });
    if (!n.length) return null;
    var t = n[0], r = n.length > 1 ? n[1] : t, b = n.length > 2 ? n[2] : t, l = n.length > 3 ? n[3] : r;
    if (!(t || r || b || l)) return null;
    return { t: t, r: r, b: b, l: l };
  }
  function applyCropStyle(el, f, baseMR, baseMB) {
    var r = el.getBoundingClientRect(), W = r.width, H = r.height;
    var pT = Math.round(f.t * 1e4) / 100, pR = Math.round(f.r * 1e4) / 100, pB = Math.round(f.b * 1e4) / 100, pL = Math.round(f.l * 1e4) / 100;
    var ins = 'inset(' + pT + '% ' + pR + '% ' + pB + '% ' + pL + '%)';
    el.style.setProperty('clip-path', ins, 'important');
    el.style.setProperty('-webkit-clip-path', ins, 'important');
    el.style.setProperty('transform', 'translate(' + (-pL) + '%, ' + (-pT) + '%)', 'important');
    el.style.setProperty('margin-right', Math.round(baseMR - (f.l + f.r) * W) + 'px', 'important');
    el.style.setProperty('margin-bottom', Math.round(baseMB - (f.t + f.b) * H) + 'px', 'important');
  }

  function startCrop(el) {
    if (!el || el.tagName !== 'IMG') return;
    if (!el.getAttribute('src') || (el.complete && el.naturalWidth === 0)) return;
    closeMediaMenu(); closeAddMenu();
    croppingEl = el;
    cropPrevStyle = el.getAttribute('style') || '';
    // Remember the pre-crop style so the crop is undoable (endCrop posts
    // style-committed; the local history needs the matching before/after).
    el._hceCropUndoBefore = [{ el: el, css: el.style.cssText }];
    // Reveal the FULL image for the session (so the rectangle can sweep the whole
    // picture, even when re-cropping) and remember the true uncropped margins.
    var prevF = readCropFrac(el), cs = getComputedStyle(el), r0 = el.getBoundingClientRect();
    var baseMR = parseFloat(cs.marginRight) || 0, baseMB = parseFloat(cs.marginBottom) || 0;
    if (prevF) { baseMR += (prevF.l + prevF.r) * r0.width; baseMB += (prevF.t + prevF.b) * r0.height; }
    el._hceCropBase = { mr: baseMR, mb: baseMB };
    ['clip-path', '-webkit-clip-path', 'transform'].forEach(function (p) { el.style.removeProperty(p); });
    el.style.setProperty('margin-right', Math.round(baseMR) + 'px', 'important');
    el.style.setProperty('margin-bottom', Math.round(baseMB) + 'px', 'important');
    el.setAttribute('draggable', 'false');
    cropFrac = prevF ? { t: prevF.t, r: prevF.r, b: prevF.b, l: prevF.l } : { t: 0, r: 0, b: 0, l: 0 };
    pinnedBlock = el;
    el.addEventListener('dragstart', cropPreventDrag, true);
    document.addEventListener('keydown', cropKeydown, true);
    window.addEventListener('scroll', updateCropOverlay, true);
    window.addEventListener('resize', updateCropOverlay, true);
    buildCropOverlay();
    showCropBar();
    positionPins(el);
    updateCropOverlay();
  }
  function cropPreventDrag(e) { if (croppingEl) e.preventDefault(); }   // kill the native <img> drag ghost
  function cropKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); endCrop(false); }
    else if (e.key === 'Enter') { e.preventDefault(); endCrop(true); }
  }

  function mkCropDiv(parent, css) { var d = document.createElement('div'); d.setAttribute('contenteditable', 'false'); d.style.cssText = css; (parent || document.body).appendChild(d); return d; }
  function cropSetBox(d, x, y, w, h) { d.style.left = Math.round(x) + 'px'; d.style.top = Math.round(y) + 'px'; d.style.width = Math.max(0, Math.round(w)) + 'px'; d.style.height = Math.max(0, Math.round(h)) + 'px'; }
  function buildCropOverlay() {
    removeCropOverlay();
    cropOverlay = document.createElement('div');
    cropOverlay.id = '__hce-crop-overlay';
    cropOverlay.setAttribute('contenteditable', 'false');
    cropOverlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483599;pointer-events:none;';
    document.body.appendChild(cropOverlay);
    var scrim = 'position:fixed;background:rgba(17,24,39,.55);pointer-events:none;';
    cropScrim = { t: mkCropDiv(cropOverlay, scrim), b: mkCropDiv(cropOverlay, scrim), l: mkCropDiv(cropOverlay, scrim), r: mkCropDiv(cropOverlay, scrim) };
    // Full-image pan layer: dragging ANYWHERE on the image scrolls the crop
    // selection, so the visible region isn't stuck in one spot — the user can
    // slide the picture under the frame at any time. It sits above the dim scrim
    // but below the bright rectangle + resize handles, so those still work.
    cropPanLayer = mkCropDiv(cropOverlay, 'position:fixed;pointer-events:auto;cursor:move;background:transparent;');
    cropPanLayer.addEventListener('mousedown', function (e) { cropDragStart(e, 'move'); });
    // The bright rectangle is now purely visual (panning is owned by the layer
    // above); pointer-events:none lets drags on it fall through to the pan layer.
    cropRectEl = mkCropDiv(cropOverlay, 'position:fixed;box-sizing:border-box;border:1px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none;cursor:move;');
    var gl = 'position:absolute;background:rgba(255,255,255,.45);pointer-events:none;';
    mkCropDiv(cropRectEl, gl + 'left:33.33%;top:0;width:1px;height:100%;');
    mkCropDiv(cropRectEl, gl + 'left:66.66%;top:0;width:1px;height:100%;');
    mkCropDiv(cropRectEl, gl + 'top:33.33%;left:0;height:1px;width:100%;');
    mkCropDiv(cropRectEl, gl + 'top:66.66%;left:0;height:1px;width:100%;');
    cropHandleEls = [];
    ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].forEach(function (dir) {
      var corner = dir.length === 2;
      var css = 'position:fixed;z-index:2147483600;pointer-events:auto;background:#fff;border:1.5px solid #ff5a1f;box-shadow:0 1px 3px rgba(20,24,34,.2);box-sizing:border-box;';
      css += corner ? 'width:12px;height:12px;border-radius:3px;' : ((dir === 'e' || dir === 'w') ? 'width:6px;height:26px;border-radius:999px;' : 'width:26px;height:6px;border-radius:999px;');
      css += 'cursor:' + ((dir === 'n' || dir === 's') ? 'ns-resize' : (dir === 'e' || dir === 'w') ? 'ew-resize' : ((dir === 'nw' || dir === 'se') ? 'nwse-resize' : 'nesw-resize')) + ';';
      var hd = mkCropDiv(cropOverlay, css);
      hd._dir = dir;
      hd.addEventListener('mousedown', function (e) { cropDragStart(e, dir); });
      cropHandleEls.push(hd);
    });
  }
  function updateCropOverlay() {
    if (!cropOverlay || !croppingEl) return;
    var r = croppingEl.getBoundingClientRect();
    var L = r.left + cropFrac.l * r.width, T = r.top + cropFrac.t * r.height;
    var R = r.right - cropFrac.r * r.width, B = r.bottom - cropFrac.b * r.height;
    var w = R - L, h = B - T;
    cropSetBox(cropScrim.t, r.left, r.top, r.width, T - r.top);
    cropSetBox(cropScrim.b, r.left, B, r.width, r.bottom - B);
    cropSetBox(cropScrim.l, r.left, T, L - r.left, h);
    cropSetBox(cropScrim.r, R, T, r.right - R, h);
    if (cropPanLayer) cropSetBox(cropPanLayer, r.left, r.top, r.width, r.height);
    cropSetBox(cropRectEl, L, T, w, h);
    var mid = { nw: [L, T], ne: [R, T], sw: [L, B], se: [R, B], n: [(L + R) / 2, T], s: [(L + R) / 2, B], e: [R, (T + B) / 2], w: [L, (T + B) / 2] };
    cropHandleEls.forEach(function (hd) {
      var m = mid[hd._dir], hw = hd.offsetWidth || 12, hh = hd.offsetHeight || 12;
      hd.style.left = Math.round(m[0] - hw / 2) + 'px';
      hd.style.top = Math.round(m[1] - hh / 2) + 'px';
    });
    if (cropBar) {
      var bw = cropBar.offsetWidth || 64;
      cropBar.style.left = Math.round(cropClamp(L + w / 2 - bw / 2, 6, (window.innerWidth || 800) - bw - 6)) + 'px';
      cropBar.style.top = Math.round((T - 40 < 6) ? (B + 8) : (T - 40)) + 'px';
    }
  }
  function cropDragStart(e, dir) {
    e.preventDefault(); e.stopPropagation();
    var r = croppingEl.getBoundingClientRect();
    var s = { x: e.clientX, y: e.clientY, t: cropFrac.t, r: cropFrac.r, b: cropFrac.b, l: cropFrac.l };
    var minWf = 28 / Math.max(40, r.width), minHf = 28 / Math.max(40, r.height), moved = false;
    function mv(ev) {
      moved = true;
      var dx = (ev.clientX - s.x) / r.width, dy = (ev.clientY - s.y) / r.height;
      var f = { t: s.t, r: s.r, b: s.b, l: s.l };
      if (dir === 'move') {
        var bw = 1 - s.l - s.r, bh = 1 - s.t - s.b;
        var nl = cropClamp(s.l + dx, 0, 1 - bw), nt = cropClamp(s.t + dy, 0, 1 - bh);
        f.l = nl; f.r = 1 - bw - nl; f.t = nt; f.b = 1 - bh - nt;
      } else {
        if (dir.indexOf('w') >= 0) f.l = cropClamp(s.l + dx, 0, 1 - s.r - minWf);
        if (dir.indexOf('e') >= 0) f.r = cropClamp(s.r - dx, 0, 1 - s.l - minWf);
        if (dir.indexOf('n') >= 0) f.t = cropClamp(s.t + dy, 0, 1 - s.b - minHf);
        if (dir.indexOf('s') >= 0) f.b = cropClamp(s.b - dy, 0, 1 - s.t - minHf);
      }
      cropFrac = f;
      updateCropOverlay();
    }
    function up() {
      document.removeEventListener('mousemove', mv, true);
      document.removeEventListener('mouseup', up, true);
      if (moved) { cropSuppressClick = true; setTimeout(function () { cropSuppressClick = false; }, 0); }
    }
    document.addEventListener('mousemove', mv, true);
    document.addEventListener('mouseup', up, true);
  }
  function showCropBar() {
    removeCropBar();
    cropBar = document.createElement('div');
    cropBar.id = '__hce-crop-bar';
    cropBar.setAttribute('contenteditable', 'false');
    // Match the white pill toolbar — just a confirm (✓) and cancel (✗).
    cropBar.style.cssText = 'position:fixed;z-index:2147483601;display:flex;gap:2px;align-items:center;'
      + 'background:#fff;border:1px solid #e7e5e4;border-radius:999px;padding:3px;'
      + 'box-shadow:0 8px 20px rgba(15,23,42,.10),0 2px 4px rgba(15,23,42,.06);';
    var btn = 'border:none;background:transparent;height:28px;min-width:28px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
    cropBar.innerHTML = '<button data-act="done" title="' + pt('crop_done') + '" style="' + btn + 'color:#16a34a;">' + ICON_CHECK + '</button>'
      + '<button data-act="cancel" title="' + pt('crop_cancel') + '" style="' + btn + 'color:#dc2626;">' + ICON_X + '</button>';
    document.body.appendChild(cropBar);
    var bD = cropBar.querySelector('[data-act="done"]'), bC = cropBar.querySelector('[data-act="cancel"]');
    bD.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    bC.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    bD.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); endCrop(true); });
    bC.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); endCrop(false); });
    bD.addEventListener('mouseenter', function () { bD.style.background = '#dcfce7'; });
    bD.addEventListener('mouseleave', function () { bD.style.background = 'transparent'; });
    bC.addEventListener('mouseenter', function () { bC.style.background = '#fee2e2'; });
    bC.addEventListener('mouseleave', function () { bC.style.background = 'transparent'; });
  }
  function removeCropBar() { if (cropBar && cropBar.parentNode) cropBar.parentNode.removeChild(cropBar); cropBar = null; }
  function removeCropOverlay() {
    if (cropOverlay && cropOverlay.parentNode) cropOverlay.parentNode.removeChild(cropOverlay);
    cropOverlay = null; cropRectEl = null; cropHandleEls = []; cropScrim = {}; cropPanLayer = null;
  }
  function endCrop(commit) {
    var el = croppingEl; if (!el) return;
    el.removeEventListener('dragstart', cropPreventDrag, true);
    el.removeAttribute('draggable');
    document.removeEventListener('keydown', cropKeydown, true);
    window.removeEventListener('scroll', updateCropOverlay, true);
    window.removeEventListener('resize', updateCropOverlay, true);
    removeCropOverlay();
    removeCropBar();
    hideSnapGuides();
    croppingEl = null;
    if (commit) {
      var any = cropFrac.t > 0.002 || cropFrac.r > 0.002 || cropFrac.b > 0.002 || cropFrac.l > 0.002;
      var base = el._hceCropBase || { mr: 0, mb: 0 };
      if (any) applyCropStyle(el, cropFrac, base.mr, base.mb);
      else { ['clip-path', '-webkit-clip-path', 'transform'].forEach(function (p) { el.style.removeProperty(p); }); }
      // Record the crop as one undoable style change (paired with the parent's
      // undo-log post) so Cmd+Z restores the pre-crop image.
      var cropBefore = el._hceCropUndoBefore || [{ el: el, css: cropPrevStyle }];
      var cropAfter = [{ el: el, css: el.style.cssText }];
      if (hceListsDiffer(cropBefore, cropAfter)) {
        hcePushStyleUndo(cropBefore, cropAfter);
        window.parent.postMessage({ type: 'style-committed',
          styles: [{ id: el.getAttribute('data-block-id'), style: el.getAttribute('style') || '' }] }, '*');
      }
    } else {
      el.setAttribute('style', cropPrevStyle);
    }
    el._hceCropUndoBefore = null;
    el._hceCropBase = null;
    if (document.contains(el)) showToolsOn(el, null);
  }

  // ─── [ADDITION · drag a file in / paste an image to add media] ───
  // The most natural way to add a photo: drag the file into the doc (a drop
  // line shows where it lands) or paste it from the clipboard. Images are
  // inlined (downscaled) and inserted as a new block — so they download and
  // sync like everything else. Small videos inline too; large ones nudge to
  // the link/replace flow.
  var fileDropLine = null, fileDropTarget = null, fileDropBefore = true;
  function bodyBlocks() {
    var out = [], kids = document.body.children;
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 1 && kids[i].hasAttribute('data-block-id')) out.push(kids[i]);
    return out;
  }
  function dragHasFiles(e) {
    var dt = e.dataTransfer; if (!dt || !dt.types) return false;
    for (var i = 0; i < dt.types.length; i++) if (dt.types[i] === 'Files') return true;
    return false;
  }
  function showFileDropLine(target, before) {
    if (!fileDropLine) {
      fileDropLine = document.createElement('div');
      fileDropLine.id = '__hce-file-dropline';
      fileDropLine.style.cssText = 'position:fixed;z-index:2147483600;background:#ff5a1f;border-radius:2px;pointer-events:none;height:3px;';
      document.body.appendChild(fileDropLine);
    }
    var r = target.getBoundingClientRect();
    fileDropLine.style.display = 'block';
    fileDropLine.style.left = Math.round(r.left) + 'px';
    fileDropLine.style.width = Math.round(r.width) + 'px';
    fileDropLine.style.top = Math.round(before ? r.top - 2 : r.bottom - 1) + 'px';
  }
  function hideFileDropLine() { if (fileDropLine) fileDropLine.style.display = 'none'; }
  function postInsertMedia(targetId, before, kind, src) {
    window.parent.postMessage({ type: 'request-insert-media-at', targetId: targetId, before: before, kind: kind, src: src }, '*');
  }
  function acceptMediaFile(f, targetId, before) {
    if (!f) return;
    if (f.type.indexOf('image/') === 0) {
      inlineImageFile(f, function (data) { if (data) postInsertMedia(targetId, before, 'image', data); else alert('无法读取为图片'); });
    } else if (f.type.indexOf('video/') === 0) {
      if (f.size > 6 * 1024 * 1024) { alert('视频较大，建议用「替换」粘贴链接'); return; }
      var rd = new FileReader(); rd.onload = function () { postInsertMedia(targetId, before, 'video', rd.result); }; rd.readAsDataURL(f);
    } else { alert('请拖入图片或视频文件'); }
  }
  document.addEventListener('dragover', function (e) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();                       // allow drop + stop the browser opening the file
    if (mode !== 'edit') { hideFileDropLine(); return; }
    if (e.target.closest && e.target.closest('.__hce-media-ph')) { hideFileDropLine(); return; }  // placeholder handles its own
    var cand = resolveCandidate(e.clientX, e.clientY, false);
    if (!cand) { var kids = bodyBlocks(); cand = kids[kids.length - 1]; }
    if (!cand) { hideFileDropLine(); return; }
    var r = cand.getBoundingClientRect();
    fileDropTarget = cand; fileDropBefore = e.clientY < (r.top + r.bottom) / 2;
    showFileDropLine(cand, fileDropBefore);
  }, true);
  document.addEventListener('dragleave', function (e) {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) hideFileDropLine();
  }, true);
  document.addEventListener('drop', function (e) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    hideFileDropLine();
    if (mode !== 'edit') return;
    if (e.target.closest && e.target.closest('.__hce-media-ph')) return;   // placeholder handles its own drop
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !fileDropTarget) return;
    acceptMediaFile(f, fileDropTarget.getAttribute('data-block-id'), fileDropBefore);
  }, true);
  document.addEventListener('paste', function (e) {
    if (mode !== 'edit') return;
    var items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile(); if (!f) continue;
        e.preventDefault();
        var anchor = pinnedBlock ||
          (document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-block-id]'));
        if (!anchor) { var kids = bodyBlocks(); anchor = kids[kids.length - 1]; }
        if (!anchor) return;
        inlineImageFile(f, function (data) { if (data) postInsertMedia(anchor.getAttribute('data-block-id'), false, 'image', data); });
        return;
      }
    }
  }, true);

  // ─── Parent → iframe commands ─────────────────
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d._src !== 'hce') return;

    if (d.cmd === 'set-mode') applyMode(d.mode);

    if (d.cmd === 'set-block-link') {
      var blEl = document.querySelector('[data-block-id="' + d.id + '"]');
      if (blEl) applyBlockLink(blEl, d.href || null);
    }

    if (d.cmd === 'set-slides') { slidesMode = !!d.on; ensureSlideScrollFix(slidesMode); }
    if (d.cmd === 'nav-slide') { navSlide(d.dir); }

    if (d.cmd === 'move-element') {
      var mv = document.querySelector('[data-block-id="' + d.id + '"]');
      var tg = document.querySelector('[data-block-id="' + d.targetId + '"]');
      if (mv && tg && tg.parentNode) {
        if (d.before) tg.parentNode.insertBefore(mv, tg);
        else tg.parentNode.insertBefore(mv, tg.nextSibling);
        revealMoved(mv);
      }
    }

    // Move a context element (a list item, dt/dd, …) next to a target that sits
    // OUTSIDE its container, by wrapping it in a fresh list / dl / figure at the
    // drop point. Mirrors room.js so the live DOM matches the persisted skeleton
    // without a reload — the mover keeps its contenteditable bindings.
    if (d.cmd === 'wrap-move') {
      var wmMv = document.querySelector('[data-block-id="' + d.id + '"]');
      var wmTg = document.querySelector('[data-block-id="' + d.targetId + '"]');
      if (wmMv && wmTg && wmTg.parentNode && !wmMv.contains(wmTg)) {
        var wrapEl = document.createElement(d.wrapTag || 'ul');
        wrapEl.setAttribute('data-block-id', d.wrapId);
        wmTg.parentNode.insertBefore(wrapEl, d.before ? wmTg : wmTg.nextSibling);
        wrapEl.appendChild(wmMv);
        revealMoved(wmMv);
      }
    }

    // Move a block INTO a container, surgically (no reload → scroll stays put).
    if (d.cmd === 'move-into') {
      var miMv = document.querySelector('[data-block-id="' + d.id + '"]');
      var miBox = document.querySelector('[data-block-id="' + d.containerId + '"]');
      if (miMv && miBox && miMv !== miBox && !miMv.contains(miBox)) {
        if (d.atStart && miBox.firstChild) miBox.insertBefore(miMv, miBox.firstChild);
        else miBox.appendChild(miMv);
        revealMoved(miMv);
      }
    }

    // Place two blocks side by side, surgically. The live moving / target nodes
    // are MOVED (not recreated) so their contenteditable bindings survive; only
    // a brand-new wrapper row is created when d.newRow is set.
    if (d.cmd === 'place-beside') {
      var pbMv = document.querySelector('[data-block-id="' + d.movingId + '"]');
      var pbTg = document.querySelector('[data-block-id="' + d.targetId + '"]');
      if (pbMv && pbTg && pbMv !== pbTg && !pbMv.contains(pbTg) && pbTg.parentNode) {
        var pbRow;
        if (d.newRow) {
          pbRow = document.createElement('div');
          pbRow.setAttribute('data-block-id', d.rowId);
          pbRow.setAttribute('data-hce-row', '1');
          if (d.rowStyle) pbRow.setAttribute('style', d.rowStyle);
          pbTg.parentNode.insertBefore(pbRow, pbTg);
          if (d.side === 'left') { pbRow.appendChild(pbMv); pbRow.appendChild(pbTg); }
          else { pbRow.appendChild(pbTg); pbRow.appendChild(pbMv); }
        } else {
          pbRow = pbTg.parentNode;   // target already sits in a row
          if (d.side === 'left') pbRow.insertBefore(pbMv, pbTg);
          else pbRow.insertBefore(pbMv, pbTg.nextSibling);
        }
        if (pbRow && typeof d.rowStyle === 'string' && d.rowStyle) pbRow.setAttribute('style', d.rowStyle);
        if (typeof d.movingStyle === 'string') pbMv.setAttribute('style', d.movingStyle);
        if (typeof d.targetStyle === 'string') pbTg.setAttribute('style', d.targetStyle);
        if (Array.isArray(d.rowChildren)) {
          for (var ci = 0; ci < d.rowChildren.length; ci++) {
            var it = d.rowChildren[ci];
            if (!it || !it.id) continue;
            var child = document.querySelector('[data-block-id="' + it.id + '"]');
            if (child && typeof it.style === 'string') child.setAttribute('style', it.style);
          }
        }
        revealMoved(pbMv);
      }
    }

    if (d.cmd === 'set-media-src') {
      var mel = document.querySelector('[data-block-id="' + d.id + '"]');
      if (mel && (mel.tagName === 'IMG' || mel.tagName === 'VIDEO' || mel.tagName === 'AUDIO')) applyMediaSrc(mel, d.src);
      if (typeof refreshVideoState === 'function') refreshVideoState();
    }

    // Replace an element wholesale (e.g. image ↔ video type swap). Keeps the
    // same data-block-id + position; drops any attached upload placeholder and
    // re-scans so a still-missing source becomes a placeholder again.
    if (d.cmd === 'replace-element') {
      var rOld = document.querySelector('[data-block-id="' + d.id + '"]');
      if (rOld && d.html) {
        var rTpl = document.createElement('template');
        rTpl.innerHTML = d.html;
        var rNew = rTpl.content.firstElementChild;
        if (rNew) {
          if (rOld.__hcePh && rOld.__hcePh.parentNode) rOld.__hcePh.parentNode.removeChild(rOld.__hcePh);
          var rWasPinned = (pinnedBlock === rOld), rWasTooled = (toolsTarget === rOld);
          rOld.replaceWith(rNew);
          // Make any text leaves inside the replacement editable (e.g. a table
          // cell that gained an image still keeps an editable caption span).
          if (mode === 'edit') {
            if (rNew.hasAttribute('data-hce-text')) { rNew.setAttribute('contenteditable', 'plaintext-only'); rNew.spellcheck = false; }
            rNew.querySelectorAll('[data-hce-text]:not([contenteditable])').forEach(function (c) { c.setAttribute('contenteditable', 'plaintext-only'); c.spellcheck = false; });
          }
          if (rWasPinned) unpinHandle();
          if (rWasTooled) hideTools();
          scanBrokenMedia();
          if (typeof refreshVideoState === 'function') refreshVideoState();
          // After a table row/column insert (whole-table swap), bring the
          // Notion-style controls back on the fresh table so repeated inserts
          // stay fluid without a re-click.
          if (tableCtlReshow && rNew.tagName === 'TABLE' && rNew.getAttribute('data-block-id') === tableCtlReshow) {
            tableCtlReshow = null;
            showTableControls(rNew);
          }
        }
      }
    }

    if (d.cmd === 'set-link') {
      var lel = document.querySelector('[data-block-id="' + d.id + '"]');
      if (lel && lel.tagName === 'A') {
        lel.setAttribute('href', d.href || '#');
        if (typeof d.text === 'string') lel.textContent = d.text;
        lel.style.display = lel.__hcePrevDisplay || '';
        if (lel.__hcePh && lel.__hcePh.parentNode) lel.__hcePh.parentNode.removeChild(lel.__hcePh);
        lel.__hcePh = null; lel.__hcePhDone = false;
      }
    }

    if (d.cmd === 'set-lang') {
      panelLang = (d.lang === 'zh') ? 'zh' : 'en';
      applyPanelI18n();
      // Re-render the toolbar if it's currently showing (labels are baked in).
      if (tools && tools.style.display !== 'none' && toolsTarget) renderToolsContent();
    }

    if (d.cmd === 'undo-style') { undoStyleHistory(); }
    if (d.cmd === 'redo-style') { redoStyleHistory(); }

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
      if (el) {
        if (el.__hcePh && el.__hcePh.parentNode) el.__hcePh.remove();   // drop its placeholder too
        el.remove();
      }
      hideHandle();
      hideTools();
      // A deleted video leaves its floating cover overlay orphaned on the body
      // (it isn't a child of the element). Rebuild video state so covers whose
      // element is gone get removed.
      if (typeof refreshVideoState === 'function') refreshVideoState();
    }

    // Apply a persisted inline style to an element (remote style change, or a
    // refresh re-applying styles the structural patch wouldn't otherwise sync).
    if (d.cmd === 'set-style') {
      var sel = document.querySelector('[data-block-id="' + d.id + '"]');
      if (sel) sel.style.cssText = d.style || '';
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

    if (d.cmd === 'insert-rel') {
      // Insert a standalone media node before/after a target (for dropped /
      // pasted images). Media tags parse fine standalone, no wrapping needed.
      var relAnchor = document.querySelector('[data-block-id="' + d.targetId + '"]');
      if (!relAnchor || !relAnchor.parentNode || !d.html) return;
      var relTpl = document.createElement('template');
      relTpl.innerHTML = d.html;
      var relNode = relTpl.content.firstElementChild;
      if (!relNode) return;
      if (d.before) relAnchor.parentNode.insertBefore(relNode, relAnchor);
      else relAnchor.parentNode.insertBefore(relNode, relAnchor.nextSibling);
      relNode.setAttribute('data-flash', '1');
      setTimeout(function () { relNode.removeAttribute('data-flash'); }, 1200);
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
      // A freshly-inserted <img> (or a duplicated broken one) becomes an
      // upload placeholder.
      scanBrokenMedia();
      // A duplicated/inserted embed video (or <video>) needs its selection
      // cover built for the current mode — without it the embed iframe eats
      // clicks and can't be selected, edited or deleted.
      if (typeof refreshVideoState === 'function') refreshVideoState();
    }

    // Append a fresh block INSIDE a container (card / section) — used when "+"
    // is fired on a filled box so the new media/link lands within it.
    if (d.cmd === 'insert-into') {
      var box = document.querySelector('[data-block-id="' + d.containerId + '"]');
      if (!box || !d.html) return;
      var itpl = document.createElement('template');
      itpl.innerHTML = d.html;
      var inode = itpl.content.firstElementChild;
      if (!inode) return;
      if (mode === 'edit' && inode.hasAttribute('data-hce-text')) { inode.setAttribute('contenteditable', 'plaintext-only'); inode.spellcheck = false; }
      inode.querySelectorAll && inode.querySelectorAll('[data-hce-text]').forEach(function (c) { if (mode === 'edit') { c.setAttribute('contenteditable', 'plaintext-only'); c.spellcheck = false; } });
      box.appendChild(inode);
      inode.setAttribute('data-flash', '1');
      setTimeout(function () { inode.removeAttribute('data-flash'); }, 1200);
      scanBrokenMedia();
      if (typeof refreshVideoState === 'function') refreshVideoState();
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

  // ─── Panel i18n (language pushed from the parent via 'set-lang') ───
  var panelLang = 'en';
  var PANEL_I18N = {
    style:{en:'Style',zh:'样式'}, close_t:{en:'Close',zh:'关闭'},
    bold_t:{en:'Bold',zh:'加粗'}, italic_t:{en:'Italic',zh:'斜体'}, underline_t:{en:'Underline',zh:'下划线'},
    align_left:{en:'Left',zh:'左对齐'}, align_center:{en:'Center',zh:'居中'}, align_right:{en:'Right',zh:'右对齐'}, align_justify:{en:'Justify',zh:'两端对齐'},
    size:{en:'Size',zh:'字号'}, color:{en:'Color',zh:'颜色'},
    kind_text:{en:'Text',zh:'文字'},
    parent_t:{en:'Select parent element',zh:'选择父级元素'},
    reset:{en:'Reset',zh:'重置'}, reset_t:{en:'Revert to original color',zh:'还原为初始颜色'},
    text_mode:{en:'Text',zh:'文字'}, fill:{en:'Fill',zh:'填充'}, border:{en:'Border',zh:'描边'},
    sw_clear:{en:'None (transparent)',zh:'透明（无填充）'},
    sw_clear_border:{en:'None (transparent)',zh:'透明（无描边）'},
    text_content:{en:'Text content',zh:'文字内容'},
    more_colors:{en:'More colors',zh:'更多颜色'}, save_recent:{en:'Save',zh:'保存'},
    tb_dup:{en:'Duplicate',zh:'复制'}, tb_del:{en:'Delete',zh:'删除'}, tb_move:{en:'Drag to reorder',zh:'拖动重排'},
    tb_add:{en:'Add image / video',zh:'添加图片 / 视频'}, tb_replace:{en:'Replace',zh:'替换'}, tb_link_edit:{en:'Edit link',zh:'编辑链接'},
    tb_blink:{en:'Set block jump link',zh:'设置整块跳转链接'}, tb_blink_on:{en:'Jump link set — click to edit',zh:'已设置跳转链接（点击编辑）'}, blink_hint:{en:'Make this whole block clickable in View mode',zh:'让整个模块可点击跳转网页'}, blink_ph:{en:'Paste a URL…',zh:'粘贴网址…'},
    add:{en:'Add',zh:'添加'}, save:{en:'Save',zh:'保存'}, remove:{en:'Remove',zh:'移除'},
    rs_native:{en:'Native',zh:'原始尺寸'}, rs_align:{en:'Align',zh:'对齐'},
    dl_into:{en:'Drop inside',zh:'放入容器'}, dl_beside:{en:'Place side by side',zh:'并排放置'},
    dl_above:{en:'Move above',zh:'移到上方'}, dl_below:{en:'Move below',zh:'移到下方'},
    dl_left:{en:'Move left',zh:'移到左侧'}, dl_right:{en:'Move right',zh:'移到右侧'},
    add_image:{en:'Image',zh:'图片'}, add_video:{en:'Video',zh:'视频'}, add_audio:{en:'Audio',zh:'音频'}, add_media:{en:'Image / Video',zh:'图片 / 视频'}, add_table:{en:'Table',zh:'表格'}, add_link:{en:'Link',zh:'链接'}, tb_crop:{en:'Crop',zh:'裁切'},
    media_pick_local:{en:'Choose local file',zh:'选择本地文件'}, media_or:{en:'or',zh:'或'},
    link_text_ph:{en:'Display text (optional)',zh:'显示文字（可留空）'}, link_url_ph:{en:'Paste URL…',zh:'粘贴网址…'}, link_click_to_set:{en:'Click to set link',zh:'点击设置链接'},
    err_img_read:{en:'Could not read as image',zh:'无法读取为图片'}, err_file_large:{en:'File is large. Consider using a pasted URL.',zh:'文件较大，建议用「粘贴链接」'}, err_video_large:{en:'Video is large. Consider using a pasted URL.',zh:'视频较大，建议用「粘贴链接」'},
    crop_hint:{en:'Drag the image to reposition',zh:'拖动图片调整裁切位置'}, crop_done:{en:'Done',zh:'完成'}, crop_cancel:{en:'Cancel',zh:'取消'},
    tb_style_t:{en:'Style (color, size, weight, align)',zh:'样式（颜色·字号·粗细·对齐）'},
    tb_row:{en:'Row',zh:'行'}, tb_col:{en:'Col',zh:'列'},
    tb_dup_row:{en:'Duplicate this row',zh:'复制此行'}, tb_dup_col:{en:'Duplicate this column',zh:'复制此列'},
    tb_del_row:{en:'Delete this row',zh:'删除此行'}, tb_del_col:{en:'Delete this column',zh:'删除此列'},
    tb_cell_style_t:{en:'Style this cell (color, fill, border)',zh:'设置此单元格（颜色·填充·描边）'},
    ti_drag:{en:'Drag to move table',zh:'拖动移动表格'},
    ti_col_drag:{en:'Drag to reorder column',zh:'拖动重排列'}, ti_row_drag:{en:'Drag to reorder row',zh:'拖动重排行'},
    ti_add_col:{en:'Add column',zh:'添加一列'}, ti_add_row:{en:'Add row',zh:'添加一行'},
    ti_col_menu:{en:'Column options',zh:'列操作'}, ti_row_menu:{en:'Row options',zh:'行操作'},
    ti_col_left:{en:'Insert column left',zh:'在左侧插入列'}, ti_col_right:{en:'Insert column right',zh:'在右侧插入列'}, ti_col_del:{en:'Delete column',zh:'删除此列'},
    ti_row_above:{en:'Insert row above',zh:'在上方插入行'}, ti_row_below:{en:'Insert row below',zh:'在下方插入行'}, ti_row_del:{en:'Delete row',zh:'删除此行'}
  };
  function pt(k) { var e = PANEL_I18N[k]; if (!e) return k; return e[panelLang] != null ? e[panelLang] : e.en; }
  function applyPanelI18n() {
    if (!stylePanel) return;
    stylePanel.querySelectorAll('[data-pi]').forEach(function(el) { el.textContent = pt(el.getAttribute('data-pi')); });
    stylePanel.querySelectorAll('[data-pi-title]').forEach(function(el) { el.title = pt(el.getAttribute('data-pi-title')); });
    if (styleTarget) {
      var kl = stylePanel.querySelector('.sp-kind-label');
      if (kl) kl.textContent = styleTargetIsText ? pt('kind_text') : styleTarget.tagName.toLowerCase();
    }
  }

  // ─── Target kind + which color property the panel edits ───
  //   Text leaf  → font color (the "color" property).
  //   Shape/box  → fill (background-color) or border (border-color).
  var styleTargetIsText = true;           // HTML text leaf → show B/I/U/size
  var styleTargetIsSvg = false;           // SVG element → paint via fill/stroke
  var styleColorMode = 'text';            // 'text' | 'fill' | 'border'
  function activeColorProp() {
    if (styleColorMode === 'border') return styleTargetIsSvg ? 'stroke' : 'borderColor';
    if (styleColorMode === 'fill')   return styleTargetIsSvg ? 'fill'   : 'backgroundColor';
    return styleTargetIsSvg ? 'fill' : 'color';   // 'text' → font colour (or svg fill)
  }
  function currentTargetColorHex() {
    if (!styleTarget) return '#000000';
    return rgbToHex(getComputedStyle(styleTarget)[activeColorProp()]);
  }
  function origColorKey() { return '__hceOrig_' + activeColorProp(); }

  // Collapsed tables resolve every shared border by conflict rules. Merely
  // changing a td/th's border-color can therefore lose one or more sides to
  // its neighbours. Draw a matching inset outline inside the selected cell so
  // all four sides stay visible without changing table geometry. Preserve any
  // pre-existing inline box-shadow and restore it on Clear / Reset.
  var CELL_OUTLINE_BASE = '--hce-cell-outline-base';
  var CELL_OUTLINE_VISUAL = '--hce-cell-outline-visual';
  var CELL_OUTLINE_PRIORITY = '--hce-cell-outline-priority';
  var CELL_OUTLINE_COLOR = '--hce-cell-outline-color';
  var CELL_OUTLINE_NONE = '__hce_none__';
  function isTableCell(el) {
    return !!el && (el.tagName === 'TD' || el.tagName === 'TH');
  }
  function cellOutlineBase(el) {
    var stored = el.style.getPropertyValue(CELL_OUTLINE_BASE).trim();
    if (!stored) {
      var original = el.style.getPropertyValue('box-shadow').trim();
      var computed = getComputedStyle(el).boxShadow;
      var visual = original || ((computed && computed !== 'none') ? computed : '');
      var priority = el.style.getPropertyPriority('box-shadow') || 'normal';
      el.style.setProperty(CELL_OUTLINE_BASE, original || CELL_OUTLINE_NONE);
      el.style.setProperty(CELL_OUTLINE_VISUAL, visual || CELL_OUTLINE_NONE);
      el.style.setProperty(CELL_OUTLINE_PRIORITY, priority);
      return visual;
    }
    var visualStored = el.style.getPropertyValue(CELL_OUTLINE_VISUAL).trim();
    if (visualStored) return visualStored === CELL_OUTLINE_NONE ? '' : visualStored;
    return stored === CELL_OUTLINE_NONE ? '' : stored;
  }
  function applyCellOutline(el, color) {
    var base = cellOutlineBase(el);
    var inset = 'inset 0 0 0 2px ' + color;
    el.style.setProperty(CELL_OUTLINE_COLOR, color);
    el.style.setProperty('box-shadow', (base && base !== 'none') ? (base + ', ' + inset) : inset, 'important');
  }
  function clearCellOutline(el) {
    var stored = el.style.getPropertyValue(CELL_OUTLINE_BASE).trim();
    if (!stored) return;
    var priority = el.style.getPropertyValue(CELL_OUTLINE_PRIORITY).trim();
    if (stored === CELL_OUTLINE_NONE) el.style.removeProperty('box-shadow');
    else el.style.setProperty('box-shadow', stored, priority === 'important' ? 'important' : '');
    el.style.removeProperty(CELL_OUTLINE_BASE);
    el.style.removeProperty(CELL_OUTLINE_VISUAL);
    el.style.removeProperty(CELL_OUTLINE_PRIORITY);
    el.style.removeProperty(CELL_OUTLINE_COLOR);
  }

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
  // ─── Make resize & crop undoable ───
  // Resize and crop mutate inline style directly and post 'style-committed'
  // (which makes the parent log ONE undo step). But they used to skip the local
  // style history, so Cmd+Z had nothing to revert → "changing image size / crop
  // can't be undone". These helpers let those flows record a matching
  // before/after snapshot into the SAME styleHistory the style panel uses.
  function hceSnapList(els) {
    var out = [];
    for (var i = 0; i < els.length; i++) { var el = els[i]; if (el && el.style) out.push({ el: el, css: el.style.cssText }); }
    return out;
  }
  function hceListsDiffer(a, b) {
    if (!a || !b || a.length !== b.length) return true;
    for (var i = 0; i < a.length; i++) { if (!b[i] || a[i].el !== b[i].el || a[i].css !== b[i].css) return true; }
    return false;
  }
  function hcePushStyleUndo(before, after) {
    styleHistory.length = styleHistoryPtr + 1;
    styleHistory.push({ before: before, after: after });
    if (styleHistory.length > STYLE_HISTORY_LIMIT) styleHistory.shift();
    else styleHistoryPtr++;
  }
  // Collect { id, style } for every affected element so the parent can write
  // the inline styles back into the skeleton (→ persists across refresh).
  function stylesPayloadFrom(snap) {
    var out = [];
    snap.forEach(function(s) {
      if (s.el && s.el.getAttribute) {
        var id = s.el.getAttribute('data-block-id');
        if (id) out.push({ id: id, style: s.el.style.cssText });
      }
    });
    return out;
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
    // Tell the parent: log it for undo AND persist the inline styles.
    window.parent.postMessage({ type: 'style-committed', styles: stylesPayloadFrom(after) }, '*');
  }
  function undoStyleHistory() {
    commitStyleChange(); // 提交任何 pending
    if (styleHistoryPtr < 0) return false;
    var snap = styleHistory[styleHistoryPtr].before;
    applyStyleSnap(snap);
    styleHistoryPtr--;
    // Persist the reverted styles (no new undo entry).
    window.parent.postMessage({ type: 'style-persist', styles: stylesPayloadFrom(snap) }, '*');
    return true;
  }
  function redoStyleHistory() {
    if (styleHistoryPtr >= styleHistory.length - 1) return false;
    styleHistoryPtr++;
    var snap = styleHistory[styleHistoryPtr].after;
    applyStyleSnap(snap);
    window.parent.postMessage({ type: 'style-persist', styles: stylesPayloadFrom(snap) }, '*');
    return true;
  }
  // ⌘Z / ⌘⇧Z — just forward to the parent. The parent (room.js) owns the
  // chronological undo log because it's the only place that sees every kind
  // of action (text / structural / comment / style). The parent decides
  // whether to call its own collab.undo() or to send us an undo-style cmd.
  function forwardUndo(isRedo) {
    for (var k in lastLocalInputAt) delete lastLocalInputAt[k];
    window.parent.postMessage({
      type: isRedo ? 'request-redo' : 'request-undo'
    }, '*');
  }
  document.addEventListener('keydown', function(e) {
    var meta = e.metaKey || e.ctrlKey;
    if (!meta || !e.key || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    forwardUndo(!!e.shiftKey);
  }, true);
  // Belt-and-suspenders: some browsers fire beforeinput historyUndo
  // even when the keydown is preventDefault'd above.
  document.addEventListener('beforeinput', function(e) {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    forwardUndo(e.inputType === 'historyRedo');
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
      // Palette + recent — clean fixed 8-column grid (presets = exactly one row)
      '#__hce-style-panel .palette,#__hce-style-panel .recent{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;justify-items:start;}',
      '#__hce-style-panel .sw{width:22px;height:22px;border-radius:5px;border:1px solid #e7e5e4;',
      'cursor:pointer;padding:0;position:relative;transition:transform 80ms,box-shadow 80ms;flex-shrink:0;}',
      '#__hce-style-panel .sw:hover{transform:scale(1.12);box-shadow:0 2px 6px rgba(0,0,0,.12);z-index:1;}',
      '#__hce-style-panel .sw.on{outline:2px solid #1a1a1a;outline-offset:2px;}',
      // Transparent / "none" chip — checkerboard + red slash (universal clear).
      '#__hce-style-panel .sw.sw-clear{background-color:#fff;background-image:',
      'linear-gradient(45deg,#dcdad7 25%,transparent 25%,transparent 75%,#dcdad7 75%),',
      'linear-gradient(45deg,#dcdad7 25%,#fff 25%,#fff 75%,#dcdad7 75%);',
      'background-size:10px 10px;background-position:0 0,5px 5px;}',
      '#__hce-style-panel .sw.sw-clear::after{content:"";position:absolute;left:1px;right:1px;top:50%;',
      'height:2px;margin-top:-1px;background:#ef4444;border-radius:2px;transform:rotate(-45deg);}',
      // Recent swatch × delete on hover
      '#__hce-style-panel .recent .sw .x{position:absolute;top:-5px;right:-5px;width:13px;height:13px;',
      'background:#1a1a1a;color:#fff;border-radius:50%;border:none;cursor:pointer;font-size:9px;',
      'line-height:13px;text-align:center;padding:0;display:none;}',
      '#__hce-style-panel .recent .sw:hover .x{display:block;}',
      '#__hce-style-panel .sp-recent{margin-top:6px;}',
      // Number input next to size slider
      '#__hce-style-panel .num-input{width:48px;height:22px;padding:0 6px;background:#fafaf9;',
      'border:1px solid #e7e5e4;border-radius:4px;font:11px ui-monospace,SFMono-Regular,monospace;',
      'color:#1a1a1a;text-align:right;-moz-appearance:textfield;}',
      '#__hce-style-panel .num-input::-webkit-outer-spin-button,',
      '#__hce-style-panel .num-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '#__hce-style-panel .num-input:focus{outline:none;border-color:#1a1a1a;box-shadow:0 0 0 2px rgba(26,26,26,.06);}',
      // Save-to-recent button under picker + hex input on the left
      '#__hce-style-panel .save-row{display:flex;justify-content:space-between;align-items:center;gap:8px;}',
      '#__hce-style-panel .hex-wrap{display:flex;align-items:center;gap:4px;}',
      '#__hce-style-panel .hex-hash{color:#a8a29e;font:11px ui-monospace,SFMono-Regular,monospace;}',
      '#__hce-style-panel .hex-input{width:64px;height:24px;padding:0 6px;background:#fafaf9;',
      'border:1px solid #e7e5e4;border-radius:5px;font:11px ui-monospace,SFMono-Regular,monospace;',
      'color:#1a1a1a;text-transform:uppercase;letter-spacing:.02em;}',
      '#__hce-style-panel .hex-input:focus{outline:none;border-color:#1a1a1a;box-shadow:0 0 0 2px rgba(26,26,26,.06);}',
      // Target breadcrumb (kind + parent-select) in color row head
      '#__hce-style-panel .sp-kind{display:flex;align-items:center;gap:5px;font-size:10px;color:#a8a29e;',
      'letter-spacing:.04em;text-transform:uppercase;font-weight:600;}',
      '#__hce-style-panel .sp-kind .up{background:#fafaf9;border:1px solid #e7e5e4;border-radius:4px;',
      'cursor:pointer;color:#737373;font-size:11px;line-height:1;padding:2px 5px;}',
      '#__hce-style-panel .sp-kind .up:hover{background:#f0efed;color:#1a1a1a;}',
      // Text / Fill / Border toggle — shown only when the target has color modes
      '#__hce-style-panel .fillrow{display:none;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin-bottom:8px;}',
      '#__hce-style-panel[data-colormodes="1"] .fillrow{display:grid;}',
      '#__hce-style-panel .fillrow button{background:#fafaf9;border:1px solid #e7e5e4;color:#44403c;',
      'padding:5px 0;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}',
      '#__hce-style-panel .fillrow button:hover{background:#f0efed;color:#1a1a1a;}',
      '#__hce-style-panel .fillrow button.on{background:#1a1a1a;color:#fff;border-color:#1a1a1a;}',
      // Hide text-only controls (B/I/U, align, size) when not an HTML text leaf
      '#__hce-style-panel[data-kind="shape"] .text-only{display:none;}',
      // SVG text-content editor — only for svg <text> targets
      '#__hce-style-panel .svgtext-row{display:none;}',
      '#__hce-style-panel[data-svgtext="1"] .svgtext-row{display:block;}',
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
      '#__hce-style-panel .sv{position:relative;width:100%;height:84px;border-radius:8px;cursor:crosshair;',
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
        '<div class="sp-head"><span class="ttl" data-pi="style">Style</span><button class="close" data-pi-title="close_t" title="Close">×</button></div>'
      + '<div class="sp-body">'

      // SVG text content editor — Chrome can't place a caret in <text>, so we
      // edit the label here and write it back. Shown only for svg <text>.
      + '<div class="row svgtext-row">'
        + '<div class="row-head"><span class="label" data-pi="text_content">Text content</span></div>'
        + '<input type="text" class="num-input sp-svgtext" style="width:100%;text-align:left;padding:0 10px;" spellcheck="false">'
      + '</div>'

      // Format: B / I / U  (text targets only)
      + '<div class="row text-only">'
        + '<div class="biu-row">'
          + '<button class="biu-btn" data-prop="fontWeight" data-pi-title="bold_t" title="Bold">B</button>'
          + '<button class="biu-btn" data-prop="fontStyle" data-pi-title="italic_t" title="Italic">I</button>'
          + '<button class="biu-btn" data-prop="textDecoration" data-pi-title="underline_t" title="Underline">U</button>'
        + '</div>'
      + '</div>'

      // Alignment  (text targets only)
      + '<div class="row text-only">'
        + '<div class="alignrow">'
          + '<button data-align="left" data-pi="align_left">Left</button>'
          + '<button data-align="center" data-pi="align_center">Center</button>'
          + '<button data-align="right" data-pi="align_right">Right</button>'
          + '<button data-align="justify" data-pi="align_justify">Justify</button>'
        + '</div>'
      + '</div>'

      // Size — slider + editable number  (text targets only)
      + '<div class="row text-only">'
        + '<div class="row-head"><span class="label" data-pi="size">Size</span>'
          + '<input type="number" class="num-input sp-fs-input" min="6" max="200" step="1">'
        + '</div>'
        + '<input type="range" class="sp-fs" min="10" max="120">'
      + '</div>'

      // Color
      + '<div class="row sp-color-row">'
        + '<div class="row-head">'
          + '<span class="label" data-pi="color">Color</span>'
          + '<span class="sp-kind"><button class="up sp-parent" data-pi-title="parent_t" title="Select parent element">↑</button><span class="sp-kind-label">Text</span></span>'
          + '<button class="reset-btn sp-reset" data-pi-title="reset_t" title="Revert to original color">↶ <span data-pi="reset">Reset</span></button>'
        + '</div>'
        // Text / Fill / Border toggle. Shown (via data-colormodes) for shapes,
        // svg, and text that also has a box. "Text" only when there's text.
        + '<div class="fillrow">'
          + '<button class="sp-fill sp-fill-text" data-fill="text" data-pi="text_mode">Text</button>'
          + '<button class="sp-fill on" data-fill="fill" data-pi="fill">Fill</button>'
          + '<button class="sp-fill" data-fill="border" data-pi="border">Border</button>'
        + '</div>'
        + '<div class="palette sp-palette"><!-- filled by renderPalette() --></div>'
        + '<div class="sp-recent-wrap" style="display:none;">'
          + '<div class="recent sp-recent"></div>'
        + '</div>'
        + '<button class="more-toggle sp-more-toggle" type="button"><span class="chev">▸</span> <span data-pi="more_colors">More colors</span></button>'
        + '<div class="picker sp-picker">'
          + '<div class="sv sp-sv"><div class="sv-thumb sp-sv-thumb"></div></div>'
          + '<div class="hue sp-hue"><div class="hue-thumb sp-hue-thumb"></div></div>'
          + '<div class="save-row">'
            + '<span class="hex-wrap"><span class="hex-hash">#</span><input type="text" class="hex-input sp-hex" maxlength="6" spellcheck="false" autocomplete="off" placeholder="RRGGBB"></span>'
            + '<button class="save-btn sp-save" type="button">＋ <span data-pi="save_recent">Save</span></button>'
          + '</div>'
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
      // A cell may contain nested <span>/<strong>/<a> runs with their own
      // formatting. Apply cell-wide text properties to descendants inside
      // THIS cell so they cannot override the requested value; never cross
      // into sibling cells.
      var isCellTextProp = (styleTarget.tagName === 'TD' || styleTarget.tagName === 'TH') &&
        (prop === 'fontWeight' || prop === 'fontStyle' || prop === 'textDecoration' || prop === 'fontSize');
      // color also needs descendant propagation because intermediate links /
      // strong runs may carry an explicit colour.
      if (prop === 'color' || isCellTextProp) {
        styleTarget.querySelectorAll('*').forEach(function(child) {
          child.style.setProperty(cssProp, val, 'important');
        });
      }
      debouncedCommitStyle();
    }

    // Apply a color to whichever property is active (font / fill / border).
    // The sentinel 'transparent' clears the surface (e.g. a table cell fill
    // back to see-through) instead of painting a hex.
    function applyColor(hex, restoringOriginal) {
      if (!styleTarget) return;
      maybeStartStyleChange(styleTarget);
      var prop = activeColorProp();
      var cssProp = prop.replace(/[A-Z]/g, function(m) { return '-' + m.toLowerCase(); });
      var isClear = (hex === 'transparent');
      var val = isClear ? 'transparent' : hex;
      styleTarget.style.setProperty(cssProp, val, 'important');
      if (prop === 'color') {
        // HTML text: push to descendants too — intermediate <a>/<strong> carry their own.
        styleTarget.querySelectorAll('*').forEach(function(child) {
          child.style.setProperty('color', val, 'important');
        });
      } else if (prop === 'borderColor') {
        // A border-color is invisible without a width + style — ensure both.
        // (Skip when clearing: a transparent border shouldn't sprout width.)
        if (!isClear) {
          var cs = getComputedStyle(styleTarget);
          if (parseFloat(cs.borderTopWidth) === 0) styleTarget.style.setProperty('border-width', '2px', 'important');
          if (cs.borderTopStyle === 'none') styleTarget.style.setProperty('border-style', 'solid', 'important');
        }
        // border-collapse can hide shared td/th borders behind a neighbour.
        // The inset outline is independent of that conflict and shows all four
        // sides. Clear/Reset restores the cell's original box-shadow exactly.
        if (isTableCell(styleTarget)) {
          if (isClear || restoringOriginal) clearCellOutline(styleTarget);
          else applyCellOutline(styleTarget, val);
        }
      } else if (prop === 'fill') {
        // SVG: selecting a whole <svg>/<g> container should recolour the shapes
        // inside it (the text often sits ON TOP of a shape, so the shape can't
        // be clicked directly). Skip <text> so filling shapes doesn't recolour
        // the labels. A lone shape has no descendants, so this is a no-op there.
        styleTarget.querySelectorAll('*').forEach(function(child) {
          if (child.tagName && String(child.tagName).toLowerCase() === 'text') return;
          child.style.setProperty('fill', val, 'important');
        });
      } else if (prop === 'stroke') {
        // SVG outline needs a stroke-width to show; propagate to inner shapes too.
        var cs2 = getComputedStyle(styleTarget);
        if (!isClear && !parseFloat(cs2.strokeWidth)) styleTarget.style.setProperty('stroke-width', '2', 'important');
        styleTarget.querySelectorAll('*').forEach(function(child) {
          child.style.setProperty('stroke', val, 'important');
        });
      }
      debouncedCommitStyle();
    }
    // Expose for module-level helpers (renderPalette / renderRecent etc.)
    stylePanel.__hceApply = apply;
    stylePanel.__hceApplyColor = applyColor;
    stylePanel.querySelector('.close').onclick = hideStylePanel;

    // Refresh reset button enabled state after a color change
    function refreshResetState(color) {
      if (!styleTarget) return;
      var orig = styleTarget[origColorKey()];
      if (color === 'transparent') {
        // Cleared to see-through: reset is meaningful unless it was already so.
        stylePanel.querySelector('.sp-reset').disabled = !orig || orig === 'transparent';
        return;
      }
      var hex = rgbToHex(color);
      orig = orig || hex;
      stylePanel.querySelector('.sp-reset').disabled = (hex.toLowerCase() === orig.toLowerCase());
    }

    // Reset button — revert active color (font/fill/border) to its original
    stylePanel.querySelector('.sp-reset').addEventListener('click', function() {
      if (!styleTarget) return;
      var c = styleTarget[origColorKey()];
      if (!c) return;
      applyColor(c, true);
      markActiveSwatch(c);
      refreshResetState(c);
      var hexEl = stylePanel.querySelector('.sp-hex');
      if (hexEl) hexEl.value = c.replace('#', '').toUpperCase();
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
        setPickerFromHex(currentTargetColorHex());
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
      applyColor(hex);
      markActiveSwatch(hex);
      refreshResetState(hex);
      var hexEl = stylePanel.querySelector('.sp-hex');
      if (hexEl) hexEl.value = hex.replace('#', '').toUpperCase();
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

    // Hex input — type a #RRGGBB (or RGB) and it applies live.
    var hexInput = stylePanel.querySelector('.sp-hex');
    function commitHex() {
      if (!styleTarget) return;
      var v = (hexInput.value || '').trim().replace(/^#/, '');
      if (v.length === 3) v = v.split('').map(function(c){ return c + c; }).join('');
      if (!/^[0-9a-fA-F]{6}$/.test(v)) return;
      var hex = '#' + v.toLowerCase();
      applyColor(hex);
      markActiveSwatch(hex);
      refreshResetState(hex);
      setPickerFromHex(hex);
    }
    hexInput.addEventListener('input', commitHex);
    hexInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commitHex(); }
    });

    // SVG text-content editor — write the field back into the <text> element
    // and fire 'input' so the normal text-sync path picks it up.
    var svgTextInput = stylePanel.querySelector('.sp-svgtext');
    if (svgTextInput) {
      svgTextInput.addEventListener('input', function() {
        if (!styleTarget) return;
        styleTarget.textContent = svgTextInput.value;
        styleTarget.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
    }

    // Text / Fill / Border toggle — switches which color prop is edited.
    stylePanel.querySelectorAll('.sp-fill').forEach(function(btn) {
      btn.addEventListener('click', function() {
        styleColorMode = btn.getAttribute('data-fill');
        stylePanel.querySelectorAll('.sp-fill').forEach(function(b) {
          b.classList.toggle('on', b === btn);
        });
        // Capture original for the newly-active prop, then re-sync the UI.
        if (styleTarget[origColorKey()] === undefined) {
          styleTarget[origColorKey()] = currentTargetColorHex();
        }
        var cur = currentTargetColorHex();
        renderPalette();
        markActiveSwatch(cur);
        refreshResetState(cur);
        setPickerFromHex(cur);
        if (hexInput) hexInput.value = cur.replace('#', '').toUpperCase();
      });
    });

    // Parent-select — step up to the containing block (text often covers its box).
    stylePanel.querySelector('.sp-parent').addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (!styleTarget) return;
      var parent = styleTarget.parentElement;
      while (parent && !parent.getAttribute('data-block-id')) parent = parent.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return;
      showStylePanel(parent);
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
    stylePanel.__hceSetHex = function(hex) {
      if (hexInput) hexInput.value = rgbToHex(hex).replace('#', '').toUpperCase();
    };
    applyPanelI18n();
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
        if (stylePanel.__hceApplyColor) stylePanel.__hceApplyColor(c);
        markActiveSwatch(c);
        if (stylePanel.__hceRefreshResetState) stylePanel.__hceRefreshResetState(c);
        if (stylePanel.__hceSetPickerFromHex) stylePanel.__hceSetPickerFromHex(c);
        if (stylePanel.__hceSetHex) stylePanel.__hceSetHex(c);
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

    // Prioritise colours actually used in the document (most frequent first).
    var TARGET = 8;
    var picked = Object.keys(counts).sort(function(a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return firstSeen[a] - firstSeen[b];
    }).slice(0, TARGET);

    // If empty, seed with a sensible default
    if (picked.length === 0) picked = ['#ff5a1f'];

    // Fill the rest with harmonious colours derived from what's on the page:
    // complement (+180), then split-complements and analogues around each pick.
    var STEPS = [180, 30, -30, 150, -150, 90, -90, 60];
    var i = 0;
    while (picked.length < TARGET && i < 60) {
      var src = picked[i % picked.length] || picked[0];
      var hsv = hexToHsv(src);
      var step = STEPS[i % STEPS.length];
      var nh = (hsv.h + step + 360) % 360;
      var nc = hsvToHex(nh, Math.max(0.45, hsv.s || 0.7), Math.max(0.5, hsv.v || 0.7)).toLowerCase();
      if (picked.indexOf(nc) === -1) picked.push(nc);
      i++;
    }
    currentPalette = picked.slice(0, TARGET);
    return currentPalette;
  }

  // Perceptual lightness (0 dark → 1 light) for ordering swatches sensibly.
  function perceptualLum(hex) {
    var h = hex.replace('#', '');
    if (h.length !== 6) return 0;
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  // Sort key that makes the palette read predictably instead of by raw page
  // frequency: neutrals (greys) lead, then chromatic colours grouped by hue.
  // lightFirst flips the lightness direction per mode — Fill wants pale,
  // subtle tints up front (you rarely paint a cell pure red); Text / Border
  // want strong, dark colours up front (readable ink / crisp edges).
  function paletteRank(hex, lightFirst) {
    var hsv = hexToHsv(hex);
    var lum = perceptualLum(hex);
    var isNeutral = hsv.s < 0.12;
    var group = isNeutral ? 0 : 1;                     // greys first, colours after
    var hue = isNeutral ? 0 : hsv.h;                   // colours ordered by hue family
    var lightKey = lightFirst ? (1 - lum) : lum;       // light-first vs dark-first
    return group * 1000000 + Math.round(hue) * 1000 + Math.round(lightKey * 999);
  }

  function makeColorSwatch(c, orig) {
    var b = document.createElement('button');
    b.className = 'sw' + (orig && c.toLowerCase() === orig ? ' original' : '');
    b.setAttribute('data-color', c);
    b.style.background = c;
    b.title = (orig && c.toLowerCase() === orig) ? (c + ' (original)') : c;
    b.addEventListener('click', function() {
      if (stylePanel.__hceApplyColor) stylePanel.__hceApplyColor(c);
      markActiveSwatch(c);
      if (stylePanel.__hceRefreshResetState) stylePanel.__hceRefreshResetState(c);
      if (stylePanel.__hceSetPickerFromHex) stylePanel.__hceSetPickerFromHex(c);
      if (stylePanel.__hceSetHex) stylePanel.__hceSetHex(c);
    });
    return b;
  }
  // The "None / transparent" chip that leads the Fill / Border palette.
  function makeClearSwatch() {
    var b = document.createElement('button');
    b.className = 'sw sw-clear';
    b.setAttribute('data-color', 'transparent');
    b.title = pt(styleColorMode === 'border' ? 'sw_clear_border' : 'sw_clear');
    b.addEventListener('click', function() {
      if (stylePanel.__hceApplyColor) stylePanel.__hceApplyColor('transparent');
      markActiveSwatch('transparent');
      if (stylePanel.__hceRefreshResetState) stylePanel.__hceRefreshResetState('transparent');
    });
    return b;
  }

  function renderPalette() {
    if (!stylePanel) return;
    var row = stylePanel.querySelector('.sp-palette');
    row.innerHTML = '';
    // Gather candidates: the target's original/current colour + page-derived set.
    var orig = (styleTarget && styleTarget[origColorKey()]) ? styleTarget[origColorKey()].toLowerCase() : null;
    var cand = [];
    function add(c) {
      if (!c) return;
      c = c.toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(c) && cand.indexOf(c) === -1) cand.push(c);
    }
    if (orig && orig !== 'transparent') add(orig);
    currentPalette.forEach(add);

    // Order by the mode-aware rank so the arrangement is deliberate.
    var lightFirst = (styleColorMode === 'fill');
    cand.sort(function(a, b) { return paletteRank(a, lightFirst) - paletteRank(b, lightFirst); });

    // Fill & border lead with a transparent chip (clear the surface back to
    // see-through — no cell background / no cell outline).
    var showClear = (styleColorMode === 'fill' || styleColorMode === 'border');
    var list = cand.slice(0, showClear ? 7 : 8);   // keep exactly one 8-wide row

    if (showClear) row.appendChild(makeClearSwatch());
    list.forEach(function(c) { row.appendChild(makeColorSwatch(c, orig)); });

    // Reflect the current state (a fresh cell is already transparent).
    if (showClear && targetColorIsTransparent()) markActiveSwatch('transparent');
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

  // Is the ACTIVE colour property currently see-through? A table cell with no
  // background reads as rgba(0,0,0,0) / transparent — that's the "None" state.
  function targetColorIsTransparent() {
    if (!styleTarget) return false;
    var v = getComputedStyle(styleTarget)[activeColorProp()];
    if (!v) return false;
    if (v === 'transparent') return true;
    var m = v.match(/rgba\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*([\\d.]+)\\s*\\)/);
    return !!(m && parseFloat(m[1]) === 0);
  }

  function markActiveSwatch(color) {
    if (!stylePanel) return;
    var isClear = (color === 'transparent') || (color == null && targetColorIsTransparent());
    var hex = isClear ? 'transparent' : rgbToHex(color).toLowerCase();
    stylePanel.querySelectorAll('.sp-palette .sw').forEach(function(sw) {
      sw.classList.toggle('on', sw.getAttribute('data-color').toLowerCase() === hex);
    });
  }
  function populateStylePanel(el) {
    var p = ensureStylePanel();
    var cs = getComputedStyle(el);

    // ── Decide what kind of target this is ──
    //   Text leaf  → font color + B/I/U + align + size.
    //   Shape/box  → fill / border color, no text-format controls.
    // ── Classify the target ──
    styleTargetIsSvg = !!(el.namespaceURI && el.namespaceURI.indexOf('svg') !== -1);
    var isTextLeaf = el.hasAttribute('data-hce-text');
    var elHasText = !!(el.textContent && el.textContent.trim());
    var isTextCell = (el.tagName === 'TD' || el.tagName === 'TH') && elHasText;
    // B/I/U + size apply to HTML text leaves and to a whole table cell whose
    // text is split across nested spans/strong tags.
    styleTargetIsText = (isTextLeaf || isTextCell) && !styleTargetIsSvg;

    // Does the element have a paintable surface (so Fill / Border are useful)?
    var hasFill, hasBorder;
    if (styleTargetIsSvg) {
      hasFill = true; hasBorder = true;                 // svg shapes: fill + stroke
    } else {
      var bg = cs.backgroundColor;
      hasFill = !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
      hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderRightWidth) > 0
               || parseFloat(cs.borderBottomWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    }
    // Show the Text/Fill/Border toggle for anything that isn't a *plain* text
    // leaf — i.e. shapes, svg, and text that ALSO has a box (badge / cell /
    // button). A plain paragraph keeps just the font-colour swatches.
    var showModes = !styleTargetIsText || hasFill || hasBorder;

    // Default mode: svg → fill; html with text → text; otherwise → fill.
    if (styleTargetIsSvg) styleColorMode = 'fill';
    else if (elHasText) styleColorMode = 'text';
    else styleColorMode = 'fill';

    p.setAttribute('data-kind', styleTargetIsText ? 'text' : 'shape');
    p.setAttribute('data-colormodes', showModes ? '1' : '0');
    // SVG <text> gets an editable content field (Chrome can't caret into it).
    var isSvgText = styleTargetIsSvg && el.tagName && String(el.tagName).toLowerCase() === 'text';
    p.setAttribute('data-svgtext', isSvgText ? '1' : '0');
    var svgTextEl = p.querySelector('.sp-svgtext');
    if (svgTextEl && isSvgText) svgTextEl.value = el.textContent || '';
    // "Text" mode button only when there's HTML text to recolour.
    var textBtn = p.querySelector('.sp-fill-text');
    if (textBtn) textBtn.style.display = (!styleTargetIsSvg && elHasText) ? '' : 'none';
    var kindLabel = p.querySelector('.sp-kind-label');
    if (kindLabel) kindLabel.textContent = styleTargetIsText ? pt('kind_text') : (el.tagName.toLowerCase());
    p.querySelectorAll('.sp-fill').forEach(function(b) {
      b.classList.toggle('on', b.getAttribute('data-fill') === styleColorMode);
    });

    // Current value + original of the ACTIVE color property.
    var hexC = currentTargetColorHex();
    if (el[origColorKey()] === undefined) el[origColorKey()] = hexC;

    // Build the page-derived palette + render it.
    extractPageColors();
    renderPalette();
    renderRecent();

    // Reset button state (enabled if current color !== original)
    var resetBtn = p.querySelector('.sp-reset');
    resetBtn.disabled = (hexC.toLowerCase() === (el[origColorKey()] || hexC).toLowerCase());

    // Sync the hex input
    var hexEl = p.querySelector('.sp-hex');
    if (hexEl) hexEl.value = hexC.replace('#', '').toUpperCase();

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
  function positionStylePanel(el, anchorEl) {
    var p = ensureStylePanel();
    var r = el.getBoundingClientRect();
    var ar = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : r;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = p.offsetWidth || 248, ph = p.offsetHeight || 420;
    // Prefer anchoring to the clicked style button (toolbar) so the panel feels
    // physically attached to the operation point; fall back to the target block.
    var top = Math.max(8, Math.min(ar.top - 2, vh - ph - 8));
    var left = ar.right + 10;
    if (left + pw > vw - 8) left = ar.left - pw - 10;
    if (left < 8) left = Math.min(Math.max(8, r.left), vw - pw - 8);
    p.style.top = Math.round(top) + 'px';
    p.style.left = Math.round(left) + 'px';
  }
  function showStylePanel(el, anchorEl) {
    styleTarget = el;
    var p = ensureStylePanel();
    populateStylePanel(el);
    positionStylePanel(el, anchorEl);
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
  function toggleStylePanel(el, anchorEl) {
    if (stylePanel && stylePanel.style.display === 'block' && styleTarget === el) {
      hideStylePanel();
    } else {
      showStylePanel(el, anchorEl);
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

  // 检测缺失的图片/视频，原地放一个可上传的占位
  initMediaPlaceholders();

  // 视频只在阅读模式可播放；其余模式冻结为可选中的封面。初始渲染后再刷新一次，
  // 因为视频 / 嵌入 iframe 的布局尺寸可能晚于首帧脚本才稳定。
  refreshVideoState();
  setTimeout(refreshVideoState, 400);
  setTimeout(refreshVideoState, 1200);

  // 悬停即出现拖拽手柄（Notion 式）
  initHoverHandle();
})();
</scr` + `ipt>`;
}
