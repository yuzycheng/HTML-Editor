// ─────────────────────────────────────────────────
//  parser.js  ·  HTML ↔ skeleton + blocks
//
//  Two attributes are stamped onto the DOM:
//    data-block-id="bN"     — every meaningful element in <body>
//    data-hce-text="1"      — only on text-leaf elements (editable)
//    data-hce-marker="1"    — on list-marker spans we synthesize
//    data-hce-li-styled="1" — on the <ol>/<ul> we restyled
//
//  For ordered/unordered lists, the marker ("1. ", "•") is browser-rendered
//  and not a real text node, so users can't edit or collaboratively change
//  it. We preprocess such lists: strip the default list rendering and
//  prepend a marker <span> inside each <li>. The marker then becomes a
//  normal editable text leaf, syncable like any other piece of text.
// ─────────────────────────────────────────────────

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'HEAD', 'META', 'LINK', 'TITLE', 'BASE',
]);

const VOID_TAGS = new Set([
  'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT',
  'KEYGEN', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR',
]);

const HCE_LIST_STYLE = 'list-style: none; padding-left: 1.4em;';

function preprocessLists(doc) {
  doc.querySelectorAll('ol, ul').forEach(list => {
    if (list.hasAttribute('data-hce-li-styled')) return;   // already done
    const ordered = list.tagName === 'OL';
    const start = parseInt(list.getAttribute('start') || '1', 10);

    // Apply our styling so the browser stops drawing its own marker.
    const existing = list.getAttribute('style') || '';
    const sep = existing && !/;\s*$/.test(existing) ? '; ' : '';
    list.setAttribute('style', existing + sep + HCE_LIST_STYLE);
    list.setAttribute('data-hce-li-styled', '1');

    let n = start - 1;
    Array.from(list.children).forEach(li => {
      if (li.tagName !== 'LI') return;
      n++;
      // Skip if we've already preprocessed this <li>.
      if (li.firstElementChild && li.firstElementChild.hasAttribute('data-hce-marker')) return;
      const marker = doc.createElement('span');
      marker.setAttribute('data-hce-marker', '1');
      // A trailing space so cursor lands naturally after the marker text.
      marker.textContent = ordered ? `${n}. ` : '• ';
      li.insertBefore(marker, li.firstChild);
    });
  });
}

export function parseHTML(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  preprocessLists(doc);

  const blocks = [];
  let counter = 0;
  const nextId = () => 'b' + (++counter);

  function tagAsElement(el) {
    if (!el.hasAttribute('data-block-id')) el.setAttribute('data-block-id', nextId());
    return el.getAttribute('data-block-id');
  }

  function tagAsTextLeaf(el, text, tagName) {
    const id = tagAsElement(el);
    el.setAttribute('data-hce-text', '1');
    blocks.push({ id, tag: (tagName || el.tagName).toLowerCase(), text });
    return id;
  }

  function walk(el) {
    if (!el || SKIP_TAGS.has(el.tagName)) return;
    if (VOID_TAGS.has(el.tagName)) { tagAsElement(el); return; }

    tagAsElement(el);

    const childNodes = Array.from(el.childNodes);
    const hasElementChild = childNodes.some(n => n.nodeType === Node.ELEMENT_NODE);

    if (!hasElementChild) {
      const text = el.textContent;
      if (text && text.trim()) tagAsTextLeaf(el, text);
      return;
    }

    for (const child of childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.nodeValue;
        if (t && t.trim()) {
          const span = doc.createElement('span');
          span.setAttribute('data-text-leaf', '1');
          span.textContent = t;
          el.insertBefore(span, child);
          el.removeChild(child);
          tagAsTextLeaf(span, t, 'span');
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  }

  walk(doc.body);

  const skeleton = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  return { skeleton, blocks };
}

export function renderForEditor(skeleton, blocks) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const map = new Map(blocks.map(b => [b.id, b.text]));

  doc.querySelectorAll('[data-hce-text]').forEach(el => {
    const id = el.getAttribute('data-block-id');
    if (map.has(id)) el.textContent = map.get(id);
  });

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

export function reassembleHTML(skeleton, blocks) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const map = new Map(blocks.map(b => [b.id, b.text]));

  doc.querySelectorAll('[data-hce-text]').forEach(el => {
    const id = el.getAttribute('data-block-id');
    if (map.has(id)) el.textContent = map.get(id);
  });

  // Strip our synthetic list markers.
  doc.querySelectorAll('[data-hce-marker]').forEach(el => el.remove());

  // Strip the inline list-styling we added (best-effort: remove our exact
  // declaration; leave any other inline style the user had).
  doc.querySelectorAll('[data-hce-li-styled]').forEach(list => {
    const s = (list.getAttribute('style') || '').replace(HCE_LIST_STYLE, '').replace(/;\s*;/g, ';').trim();
    if (s) list.setAttribute('style', s);
    else list.removeAttribute('style');
    list.removeAttribute('data-hce-li-styled');
  });

  // Unwrap our text-leaf spans.
  doc.querySelectorAll('span[data-text-leaf]').forEach(el => {
    const text = doc.createTextNode(el.textContent);
    el.parentNode.replaceChild(text, el);
  });

  // Turn whole-block links into REAL, clickable <a> wrappers. In the editor a
  // block bound to a URL carries data-hce-href and only navigates in View mode
  // (via a JS click handler that isn't shipped in the exported file). So the
  // downloaded HTML would look linked but do nothing on click. Wrapping the
  // block in <a href> makes it a genuine link that works anywhere the file is
  // opened — no editor, no JS needed. display:contents keeps layout identical
  // (the <a> produces no box of its own); color:inherit/text-decoration:none
  // avoid the default blue-underline on the wrapped content.
  doc.querySelectorAll('[data-hce-href]').forEach(el => {
    const href = el.getAttribute('data-hce-href');
    el.removeAttribute('data-hce-href');
    if (!href || href === '#') return;
    // If the block IS or CONTAINS a link already, don't create an illegal
    // nested <a>. Put the href on the element itself if it's an <a> without one;
    // otherwise leave the block's existing links to do the navigating.
    if (el.tagName === 'A') {
      if (!el.getAttribute('href')) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (el.querySelector('a[href]')) return;
    if (!el.parentNode) return;
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('style', 'display:contents;color:inherit;text-decoration:none;cursor:pointer');
    el.parentNode.insertBefore(a, el);
    a.appendChild(el);
  });

  // Scrub editor attributes.
  doc.querySelectorAll('[data-block-id]').forEach(el => {
    el.removeAttribute('data-block-id');
    el.removeAttribute('data-hce-text');
    el.removeAttribute('data-commented');
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    el.removeAttribute('data-mode');
  });

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

export function removeElementFromSkeleton(skeleton, elementId) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const target = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!target) return { skeleton, removedIds: [] };

  const removedIds = [elementId];
  target.querySelectorAll('[data-block-id]').forEach(el => {
    removedIds.push(el.getAttribute('data-block-id'));
  });
  target.remove();

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    removedIds,
  };
}

/**
 * Move an element to before/after another element (drag-to-reorder).
 * `before` = true inserts the moving element right before the target,
 * false inserts it right after. Returns the new skeleton and a `moved`
 * flag (false if ids are missing, identical, or it would nest into itself).
 */
export function moveElementInSkeleton(skeleton, movingId, targetId, before) {
  if (!movingId || !targetId || movingId === targetId) return { skeleton, moved: false };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const moving = doc.querySelector(`[data-block-id="${movingId}"]`);
  const target = doc.querySelector(`[data-block-id="${targetId}"]`);
  if (!moving || !target) return { skeleton, moved: false };
  if (moving.contains(target)) return { skeleton, moved: false };  // can't move into its own subtree
  const parent = target.parentNode;
  if (!parent) return { skeleton, moved: false };
  if (before) parent.insertBefore(moving, target);
  else parent.insertBefore(moving, target.nextSibling);
  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    moved: true,
  };
}

/**
 * Move an element INTO a container (used by cross-container drag-drop when the
 * drop target is an empty container). Inserts at the very start when `atStart`,
 * otherwise appends. Refuses to move a node into its own subtree.
 */
export function moveIntoContainer(skeleton, movingId, containerId, atStart) {
  if (!movingId || !containerId || movingId === containerId) return { skeleton, moved: false };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const moving = doc.querySelector(`[data-block-id="${movingId}"]`);
  const container = doc.querySelector(`[data-block-id="${containerId}"]`);
  if (!moving || !container) return { skeleton, moved: false };
  if (moving === container || moving.contains(container)) return { skeleton, moved: false };
  if (atStart) container.insertBefore(moving, container.firstChild);
  else container.appendChild(moving);
  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    moved: true,
  };
}

/**
 * Deep-clone an element in the skeleton, assign fresh data-block-ids to
 * the clone (and all data-block-id descendants), insert it directly after
 * the original. Returns the new skeleton plus an `addedBlocks` array
 * (the new text-leaf blocks to push into collab/state).
 *
 * `nextCounter` is the integer the caller should use to keep new IDs
 * unique across the doc — we accept it because the parser counter is
 * local. Callers can pass `state.blocks.length` or compute from existing
 * IDs; we just need monotonically increasing values that don't collide.
 */
export function duplicateElementInSkeleton(skeleton, elementId, existingBlocks, afterId, layout) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const target = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!target) return { skeleton, addedBlocks: [] };

  // Compute next free integer ID.
  const usedNums = new Set();
  doc.querySelectorAll('[data-block-id]').forEach(el => {
    const m = /^b(\d+)$/.exec(el.getAttribute('data-block-id') || '');
    if (m) usedNums.add(+m[1]);
  });
  (existingBlocks || []).forEach(b => {
    const m = /^b(\d+)$/.exec(b.id || '');
    if (m) usedNums.add(+m[1]);
  });
  let counter = 0;
  for (const n of usedNums) if (n > counter) counter = n;

  const clone = target.cloneNode(true);

  // When a direct child must leave a non-wrapping flex row, preserve the
  // rendered width it had in that row. This prevents the detached copy from
  // expanding to its new parent's full width and keeps later drags stable.
  if (layout && layout.sourceId === elementId) {
    const width = Number(layout.width);
    if (Number.isFinite(width) && width > 0) {
      clone.style.setProperty('box-sizing', 'border-box');
      clone.style.setProperty('width', `${width}px`);
      clone.style.setProperty('max-width', '100%');
    }
  }

  // Rewrite IDs on the clone itself + every descendant with data-block-id.
  const addedBlocks = [];
  const reassign = (el) => {
    const newId = 'b' + (++counter);
    el.setAttribute('data-block-id', newId);
    if (el.hasAttribute('data-hce-text')) {
      addedBlocks.push({
        id: newId,
        tag: el.tagName.toLowerCase(),
        text: el.textContent,
      });
    }
  };
  if (clone.hasAttribute('data-block-id')) reassign(clone);
  clone.querySelectorAll('[data-block-id]').forEach(reassign);

  // Insert immediately after the original — or, when the caller passes an
  // anchor (e.g. the horizontal row that holds a duplicated column, so the
  // copy lands BELOW the row instead of overflowing off to the right), after
  // that anchor instead.
  let anchor = target;
  if (afterId) {
    const a = doc.querySelector(`[data-block-id="${afterId}"]`);
    if (a) anchor = a;
  }
  if (anchor.nextSibling) {
    anchor.parentNode.insertBefore(clone, anchor.nextSibling);
  } else {
    anchor.parentNode.appendChild(clone);
  }

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    addedBlocks,
    // Serialized HTML of the clone — the caller injects this into the
    // live iframe DOM so the page doesn't have to be re-rendered (which
    // would lose the user's scroll position).
    clonedHTML: clone.outerHTML,
    // The block-id the clone was inserted after — the iframe uses this as the
    // insert-after anchor so its live-DOM copy lands in the same spot.
    originalId: anchor.getAttribute('data-block-id') || elementId,
  };
}

/**
 * Remove the column containing `cellId`. Walks every <tr> in the
 * cell's <table>, deletes the cell at the same index.
 * Returns the new skeleton + removedIds (every block-id removed).
 */
export function removeColumnFromSkeleton(skeleton, cellId) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return { skeleton, removedIds: [] };

  // Climb to the enclosing TD/TH if click landed on a descendant.
  let targetCell = cell;
  while (targetCell && targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH') {
    if (targetCell.tagName === 'TABLE' || !targetCell.parentElement) return { skeleton, removedIds: [] };
    targetCell = targetCell.parentElement;
  }
  if (!targetCell || (targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH')) {
    return { skeleton, removedIds: [] };
  }

  const tr = targetCell.parentElement;
  if (!tr) return { skeleton, removedIds: [] };
  const colIndex = Array.from(tr.children).indexOf(targetCell);

  let table = tr.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return { skeleton, removedIds: [] };

  const removedIds = [];
  table.querySelectorAll('tr').forEach(row => {
    const rowCells = Array.from(row.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if (colIndex >= rowCells.length) return;
    const victim = rowCells[colIndex];
    if (victim.hasAttribute('data-block-id')) {
      removedIds.push(victim.getAttribute('data-block-id'));
    }
    victim.querySelectorAll('[data-block-id]').forEach(el => {
      removedIds.push(el.getAttribute('data-block-id'));
    });
    victim.remove();
  });

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    removedIds,
  };
}

/**
 * Duplicate the column containing `cellId`. Walks every <tr> in the
 * cell's <table>, clones the cell at the same index, and inserts after.
 * Returns the new skeleton, added blocks, and a list of insertions
 * (so the caller can patch the live iframe DOM surgically).
 */
export function duplicateColumnInSkeleton(skeleton, cellId, existingBlocks) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return { skeleton, addedBlocks: [], insertions: [] };

  // Climb to the enclosing TD/TH if the click was on a descendant.
  let targetCell = cell;
  while (targetCell && targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH') {
    if (targetCell.tagName === 'TABLE' || !targetCell.parentElement) return { skeleton, addedBlocks: [], insertions: [] };
    targetCell = targetCell.parentElement;
  }
  if (!targetCell || (targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH')) {
    return { skeleton, addedBlocks: [], insertions: [] };
  }

  const tr = targetCell.parentElement;
  if (!tr) return { skeleton, addedBlocks: [], insertions: [] };
  const colIndex = Array.from(tr.children).indexOf(targetCell);

  let table = tr.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return { skeleton, addedBlocks: [], insertions: [] };

  // ID counter, primed from existing usage.
  const used = new Set();
  doc.querySelectorAll('[data-block-id]').forEach(el => {
    const m = /^b(\d+)$/.exec(el.getAttribute('data-block-id') || '');
    if (m) used.add(+m[1]);
  });
  (existingBlocks || []).forEach(b => {
    const m = /^b(\d+)$/.exec(b.id || '');
    if (m) used.add(+m[1]);
  });
  let counter = 0;
  for (const n of used) if (n > counter) counter = n;

  const addedBlocks = [];
  const insertions = [];

  table.querySelectorAll('tr').forEach(row => {
    const rowCells = Array.from(row.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if (colIndex >= rowCells.length) return;
    const orig = rowCells[colIndex];
    if (!orig.hasAttribute('data-block-id')) return;
    const clone = orig.cloneNode(true);

    const reassign = (el) => {
      const newId = 'b' + (++counter);
      el.setAttribute('data-block-id', newId);
      if (el.hasAttribute('data-hce-text')) {
        addedBlocks.push({ id: newId, tag: el.tagName.toLowerCase(), text: el.textContent });
      }
    };
    if (clone.hasAttribute('data-block-id')) reassign(clone);
    clone.querySelectorAll('[data-block-id]').forEach(reassign);

    if (orig.nextSibling) row.insertBefore(clone, orig.nextSibling);
    else row.appendChild(clone);

    insertions.push({
      afterId: orig.getAttribute('data-block-id'),
      html: clone.outerHTML,
    });
  });

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    addedBlocks,
    insertions,
  };
}

const DEFAULT_CELL_CSS =
  'border:1px solid #e7e5e4;padding:8px 12px;text-align:left;vertical-align:top;min-width:64px;';

// Prime a fresh integer ID counter from every `b<n>` id already in play.
function nextBlockCounter(doc, existingBlocks) {
  const used = new Set();
  doc.querySelectorAll('[data-block-id]').forEach(el => {
    const m = /^b(\d+)$/.exec(el.getAttribute('data-block-id') || '');
    if (m) used.add(+m[1]);
  });
  (existingBlocks || []).forEach(b => {
    const m = /^b(\d+)$/.exec(b.id || '');
    if (m) used.add(+m[1]);
  });
  let counter = 0;
  for (const n of used) if (n > counter) counter = n;
  return counter;
}

function cellsOf(row) {
  return Array.from(row.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
}

/**
 * Insert a BLANK column beside the column containing `cellId`.
 * `side` is 'left' or 'right'. Every <tr> gets one new empty cell whose
 * tag (td/th) and style match that row's cell in the reference column, so a
 * header row still gets a header cell. Returns the rebuilt table so the caller
 * can swap it into the live iframe with a single `replace-element`.
 */
export function insertColumnInSkeleton(skeleton, cellId, side, existingBlocks) {
  const empty = { skeleton, addedBlocks: [], tableId: null, tableHTML: '' };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return empty;

  let targetCell = cell;
  while (targetCell && targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH') {
    if (targetCell.tagName === 'TABLE' || !targetCell.parentElement) return empty;
    targetCell = targetCell.parentElement;
  }
  if (!targetCell) return empty;

  const tr = targetCell.parentElement;
  if (!tr) return empty;
  const colIndex = cellsOf(tr).indexOf(targetCell);
  if (colIndex < 0) return empty;

  let table = tr.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return empty;

  let counter = nextBlockCounter(doc, existingBlocks);
  const addedBlocks = [];

  table.querySelectorAll('tr').forEach(row => {
    const rowCells = cellsOf(row);
    if (!rowCells.length) return;
    const ref = rowCells[colIndex] || rowCells[rowCells.length - 1];
    const isHead = ref.tagName === 'TH';
    const nc = doc.createElement(isHead ? 'th' : 'td');
    const nid = 'b' + (++counter);
    nc.setAttribute('data-block-id', nid);
    nc.setAttribute('data-hce-text', '1');
    nc.setAttribute('style', ref.getAttribute('style') || DEFAULT_CELL_CSS);
    nc.textContent = '';
    addedBlocks.push({ id: nid, tag: nc.tagName.toLowerCase(), text: '' });
    if (side === 'left') row.insertBefore(nc, ref);
    else if (ref.nextSibling) row.insertBefore(nc, ref.nextSibling);
    else row.appendChild(nc);
  });

  if (!addedBlocks.length) return empty;
  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    addedBlocks,
    tableId: table.getAttribute('data-block-id'),
    tableHTML: table.outerHTML,
  };
}

/**
 * Insert a BLANK row above/below the row containing `cellId`.
 * `side` is 'above' or 'below'. New cells are always body cells (td); their
 * per-column style is copied from an existing body cell in that column (so a
 * new row matches the table's body styling rather than the header). Returns
 * the rebuilt table for a single `replace-element` swap.
 */
export function insertRowInSkeleton(skeleton, cellId, side, existingBlocks) {
  const empty = { skeleton, addedBlocks: [], tableId: null, tableHTML: '' };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return empty;

  let tr = cell;
  while (tr && tr.tagName !== 'TR') {
    if (tr.tagName === 'TABLE' || !tr.parentElement) return empty;
    tr = tr.parentElement;
  }
  if (!tr) return empty;
  const parent = tr.parentElement;
  if (!parent) return empty;

  let table = tr.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return empty;

  const refCells = cellsOf(tr);
  if (!refCells.length) return empty;

  // Per-column body-style prototypes: prefer a real <td> in that column.
  const colStyle = [];
  const rows = Array.from(table.querySelectorAll('tr'));
  for (let i = 0; i < refCells.length; i++) {
    let style = '';
    for (const row of rows) {
      const rc = cellsOf(row);
      const c = rc[i];
      if (c && c.tagName === 'TD' && c.getAttribute('style')) { style = c.getAttribute('style'); break; }
    }
    if (!style) style = (refCells[i].tagName === 'TD' && refCells[i].getAttribute('style')) || DEFAULT_CELL_CSS;
    colStyle.push(style);
  }

  let counter = nextBlockCounter(doc, existingBlocks);
  const addedBlocks = [];
  const newRow = doc.createElement('tr');
  newRow.setAttribute('data-block-id', 'b' + (++counter));
  refCells.forEach((ref, i) => {
    const nc = doc.createElement('td');
    const nid = 'b' + (++counter);
    nc.setAttribute('data-block-id', nid);
    nc.setAttribute('data-hce-text', '1');
    nc.setAttribute('style', colStyle[i] || DEFAULT_CELL_CSS);
    nc.textContent = '';
    addedBlocks.push({ id: nid, tag: 'td', text: '' });
    newRow.appendChild(nc);
  });

  if (side === 'above') parent.insertBefore(newRow, tr);
  else if (tr.nextSibling) parent.insertBefore(newRow, tr.nextSibling);
  else parent.appendChild(newRow);

  if (!addedBlocks.length) return empty;
  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    addedBlocks,
    tableId: table.getAttribute('data-block-id'),
    tableHTML: table.outerHTML,
  };
}

/**
 * Reorder the row containing `cellId` to gap position `toIndex` (0..rowCount).
 * `toIndex` is an insertion gap in the ORIGINAL row order, so dropping just
 * before/after the row's own slot is a no-op. No blocks are added or removed —
 * the cells keep their ids, only their document order changes. Returns the
 * rebuilt table for a single `replace-element` swap.
 */
export function moveRowInSkeleton(skeleton, cellId, toIndex) {
  const empty = { skeleton, tableId: null, tableHTML: '', moved: false };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return empty;

  let tr = cell;
  while (tr && tr.tagName !== 'TR') {
    if (tr.tagName === 'TABLE' || !tr.parentElement) return empty;
    tr = tr.parentElement;
  }
  if (!tr) return empty;

  let table = tr.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return empty;

  const rows = Array.from(table.querySelectorAll('tr'));
  const fromIdx = rows.indexOf(tr);
  if (fromIdx < 0) return empty;

  let to = Math.max(0, Math.min(rows.length, toIndex | 0));
  if (to === fromIdx || to === fromIdx + 1) return empty;   // dropped in its own slot

  const adj = to > fromIdx ? to - 1 : to;
  const remaining = rows.filter((_, i) => i !== fromIdx);
  const refNode = remaining[adj] || null;
  const parent = tr.parentElement;
  tr.remove();
  if (refNode && refNode.parentElement) refNode.parentElement.insertBefore(tr, refNode);
  else parent.appendChild(tr);

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    tableId: table.getAttribute('data-block-id'),
    tableHTML: table.outerHTML,
    moved: true,
  };
}

/**
 * Reorder the column containing `cellId` to gap position `toIndex`
 * (0..colCount). Every <tr> has its cell at the source index pulled out and
 * re-inserted at the adjusted target index, so the whole column moves as one.
 * No blocks added/removed. Returns the rebuilt table for one `replace-element`.
 */
export function moveColumnInSkeleton(skeleton, cellId, toIndex) {
  const empty = { skeleton, tableId: null, tableHTML: '', moved: false };
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const cell = doc.querySelector(`[data-block-id="${cellId}"]`);
  if (!cell) return empty;

  let targetCell = cell;
  while (targetCell && targetCell.tagName !== 'TD' && targetCell.tagName !== 'TH') {
    if (targetCell.tagName === 'TABLE' || !targetCell.parentElement) return empty;
    targetCell = targetCell.parentElement;
  }
  if (!targetCell) return empty;

  const tr0 = targetCell.parentElement;
  if (!tr0) return empty;
  const fromIdx = cellsOf(tr0).indexOf(targetCell);
  if (fromIdx < 0) return empty;

  let table = tr0.parentElement;
  while (table && table.tagName !== 'TABLE') table = table.parentElement;
  if (!table) return empty;

  const numCols = cellsOf(tr0).length;
  let to = Math.max(0, Math.min(numCols, toIndex | 0));
  if (to === fromIdx || to === fromIdx + 1) return empty;   // dropped in its own slot

  const adj = to > fromIdx ? to - 1 : to;
  table.querySelectorAll('tr').forEach(row => {
    const rc = cellsOf(row);
    if (fromIdx >= rc.length) return;
    const moving = rc[fromIdx];
    const remaining = rc.filter((_, i) => i !== fromIdx);
    const refNode = remaining[adj] || null;
    moving.remove();
    if (refNode) row.insertBefore(moving, refNode);
    else row.appendChild(moving);
  });

  return {
    skeleton: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    tableId: table.getAttribute('data-block-id'),
    tableHTML: table.outerHTML,
    moved: true,
  };
}

export function snippetForBlock(block, maxLen = 60) {
  const t = (block.text || '').trim().replace(/\s+/g, ' ');
  if (!t) return `[${block.tag}]`;
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

export function describeElement(skeleton, elementId) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const el = doc.querySelector(`[data-block-id="${elementId}"]`);
  if (!el) return { tag: '?', snippet: '' };
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
  const snippet = text ? (text.length > 60 ? text.slice(0, 60) + '…' : text) : `<${tag}>`;
  return { tag, snippet };
}
