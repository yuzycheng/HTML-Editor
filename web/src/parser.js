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
const HCE_DOCTYPE_ATTR = 'data-hce-original-doctype';
const HCE_PREFIX_ATTR = 'data-hce-document-prefix';
const HCE_MIDDLE_ATTR = 'data-hce-document-middle';
const HCE_SUFFIX_ATTR = 'data-hce-document-suffix';

function originalDoctype(source) {
  const text = String(source || '');
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // A document comment may legally precede the doctype. Skip whitespace and
  // complete comments here; the comments themselves are preserved separately.
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text.slice(start, start + 4) !== '<!--') break;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) break;
    start = end + 3;
  }
  if (text.slice(start, start + 9).toLowerCase() !== '<!doctype') return '';
  if (text[start + 9] && !/[\s>]/.test(text[start + 9])) return '';
  let quote = '';
  for (let i = start + 9; i < text.length; i++) {
    const char = text[i];
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return text.slice(start, i + 1);
  }
  return '';
}

function serializeForOutput(doc) {
  const marker = doc.documentElement.getAttribute(HCE_DOCTYPE_ATTR);
  let doctype = '<!DOCTYPE html>';
  if (marker != null) {
    try { doctype = decodeURIComponent(marker); } catch { doctype = ''; }
    doc.documentElement.removeAttribute(HCE_DOCTYPE_ATTR);
  }
  let prefix = '', middle = '', suffix = '';
  try { prefix = decodeURIComponent(doc.documentElement.getAttribute(HCE_PREFIX_ATTR) || ''); } catch {}
  try { middle = decodeURIComponent(doc.documentElement.getAttribute(HCE_MIDDLE_ATTR) || ''); } catch {}
  try { suffix = decodeURIComponent(doc.documentElement.getAttribute(HCE_SUFFIX_ATTR) || ''); } catch {}
  doc.documentElement.removeAttribute(HCE_PREFIX_ATTR);
  doc.documentElement.removeAttribute(HCE_MIDDLE_ATTR);
  doc.documentElement.removeAttribute(HCE_SUFFIX_ATTR);
  return prefix + (doctype ? doctype + '\n' : '') + middle + doc.documentElement.outerHTML + suffix;
}

function serializeSkeleton(doc) {
  // Internal skeletons use a standards-mode shell for stable DOMParser
  // roundtrips; HCE_DOCTYPE_ATTR preserves the user's actual/absent doctype.
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function textMapFor(blocks) {
  return new Map((blocks || []).map(block => [block.id, block.text || '']));
}

function hydrateTextLeaves(root, blocks) {
  const map = textMapFor(blocks);
  const leaves = [];
  if (root?.matches?.('[data-hce-text]')) leaves.push(root);
  root?.querySelectorAll?.('[data-hce-text]').forEach(el => leaves.push(el));
  leaves.forEach(el => {
    const id = el.getAttribute('data-block-id');
    if (map.has(id)) el.textContent = map.get(id);
  });
}

function clearTextLeaves(root) {
  const leaves = [];
  if (root?.matches?.('[data-hce-text]')) leaves.push(root);
  root?.querySelectorAll?.('[data-hce-text]').forEach(el => leaves.push(el));
  leaves.forEach(el => { el.textContent = ''; });
}

export function compactSkeleton(skeleton) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  clearTextLeaves(doc);
  return serializeSkeleton(doc);
}

// Uploaded HTML is data, not trusted application code. Keep the original
// skeleton intact for export, but remove active content from the copy rendered
// inside the editor. Our own editor script is appended after this pass.
const ACTIVE_PREVIEW_TAGS = 'script, object, embed';
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'data-hce-href',
]);

export function isSafePreviewUrl(value, attribute, tagName = '') {
  const raw = String(value || '').trim();
  if (!raw) return true;
  // Relative URLs, fragments, and protocol-relative web URLs are safe to keep.
  if (/^(?:[./?#]|\.\.)/.test(raw)) return true;

  // Browsers ignore embedded ASCII tabs/newlines in scheme names. Normalize
  // them before allow-listing so `java\nscript:` cannot bypass the check.
  const schemeProbe = raw.replace(/[\u0000-\u0020\u007f]+/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(schemeProbe);
  if (!match) return true;
  const scheme = match[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https') return true;
  if (attribute === 'href' && (scheme === 'mailto' || scheme === 'tel')) return true;
  if ((attribute === 'href' || attribute === 'xlink:href') &&
      String(tagName).toLowerCase() === 'image' && scheme === 'data') {
    return /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp)/i.test(schemeProbe);
  }
  if (attribute === 'src' && scheme === 'blob') return true;
  if (attribute === 'src' && scheme === 'data') {
    // Inline assets are supported, but HTML/SVG data URLs can execute script.
    return /^data:(?:image\/(?:png|gif|jpe?g|webp|avif|bmp)|audio\/|video\/)/i.test(schemeProbe);
  }
  return false;
}

export function sanitizeEditorDocument(doc) {
  doc.querySelectorAll(ACTIVE_PREVIEW_TAGS).forEach(el => el.remove());
  doc.querySelectorAll('base, meta[http-equiv]').forEach(el => {
    if (el.tagName === 'BASE' || /^(?:refresh|content-security-policy)$/i.test(el.getAttribute('http-equiv') || '')) {
      el.remove();
    }
  });

  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && !isSafePreviewUrl(attr.value, name, el.tagName)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'IFRAME') {
      const src = el.getAttribute('src') || '';
      // Reject data/blob/local nested documents that could inherit origin.
      if (!/^https?:\/\//i.test(src)) el.removeAttribute('src');
      el.setAttribute('sandbox', 'allow-scripts allow-forms allow-presentation');
    }
    if (el.tagName === 'A' && el.hasAttribute('href')) {
      // Keep preview navigation out of the editor frame and sever opener access.
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return doc;
}

export function sanitizeHTMLForEditor(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  sanitizeEditorDocument(doc);
  return serializeForOutput(doc);
}

// Structural operations exchange one outer element at a time. Parse the few
// context-sensitive HTML tags with the wrapper they require, then apply the
// same preview policy used for full documents.
export function sanitizeHTMLFragmentForEditor(htmlString) {
  const trimmed = String(htmlString || '').trim();
  if (!trimmed) return '';
  let wrapper = 'div';
  let selector = ':scope > *';
  if (/^<tr[\s>]/i.test(trimmed)) { wrapper = 'table'; selector = 'tbody > tr'; }
  else if (/^<t[hd][\s>]/i.test(trimmed)) { wrapper = 'table'; selector = 'tbody > tr > td, tbody > tr > th'; }
  else if (/^<li[\s>]/i.test(trimmed)) { wrapper = 'ul'; selector = ':scope > li'; }
  else if (/^<(thead|tbody|tfoot)[\s>]/i.test(trimmed)) { wrapper = 'table'; selector = 'thead, tbody, tfoot'; }
  else if (/^<(dt|dd)[\s>]/i.test(trimmed)) { wrapper = 'dl'; selector = ':scope > dt, :scope > dd'; }

  const host = document.createElement(wrapper);
  if (wrapper === 'table' && /^<t[hd][\s>]/i.test(trimmed)) {
    host.innerHTML = '<tbody><tr>' + trimmed + '</tr></tbody>';
  } else {
    host.innerHTML = trimmed;
  }
  const node = host.querySelector(selector);
  if (!node) return '';

  // sanitizeEditorDocument expects document-wide selectors, so sanitize a
  // temporary document containing only the fragment.
  const temp = document.implementation.createHTMLDocument('');
  temp.body.appendChild(temp.importNode(node, true));
  sanitizeEditorDocument(temp);
  return temp.body.firstElementChild?.outerHTML || '';
}

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
  // Never trust editor-owned attributes from imported HTML. Rebuild IDs and
  // text-leaf markers so duplicate/malicious values cannot merge blocks or make
  // clearTextLeaves remove an element subtree that was never registered.
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === 'data-block-id' || name === 'data-text-leaf' ||
          name === 'data-commented' || name.startsWith('data-hce-')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  doc.documentElement.setAttribute(HCE_DOCTYPE_ATTR, encodeURIComponent(originalDoctype(htmlString)));
  const prefixComments = [], middleComments = [], suffixComments = [];
  let seenDoctype = false;
  let seenRoot = false;
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) { seenDoctype = true; continue; }
    if (node === doc.documentElement) { seenRoot = true; continue; }
    if (node.nodeType === Node.COMMENT_NODE) {
      const bucket = seenRoot ? suffixComments : (seenDoctype ? middleComments : prefixComments);
      bucket.push('<!--' + node.data + '-->');
    }
  }
  if (prefixComments.length) doc.documentElement.setAttribute(HCE_PREFIX_ATTR, encodeURIComponent(prefixComments.join('')));
  if (middleComments.length) doc.documentElement.setAttribute(HCE_MIDDLE_ATTR, encodeURIComponent(middleComments.join('')));
  if (suffixComments.length) doc.documentElement.setAttribute(HCE_SUFFIX_ATTR, encodeURIComponent(suffixComments.join('')));
  // Keep native list markers and indentation intact. List text remains editable
  // through the <li> itself (or its existing inline children); synthesizing a
  // marker span changed list geometry and made the editor preview disagree with
  // the downloaded document. Legacy rooms are still cleaned up on export below.

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
      // Textareas must remain stateful even when initially empty; their live
      // `.value` is synchronized separately from contenteditable text.
      if (el.tagName === 'TEXTAREA') tagAsTextLeaf(el, text || '');
      else if (text && text.trim()) tagAsTextLeaf(el, text);
      return;
    }

    for (const child of childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.nodeValue;
        if (t && t.trim()) {
          const leading = /^\s+/.exec(t)?.[0] || '';
          const trailing = /\s+$/.exec(t)?.[0] || '';
          const core = t.slice(leading.length, t.length - trailing.length);
          if (leading) el.insertBefore(doc.createTextNode(leading), child);
          const span = doc.createElement('span');
          span.setAttribute('data-text-leaf', '1');
          span.textContent = core;
          el.insertBefore(span, child);
          if (trailing) el.insertBefore(doc.createTextNode(trailing), child);
          el.removeChild(child);
          tagAsTextLeaf(span, core, 'span');
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  }

  // BODY is the document container, never an editable/draggable block. Wrap
  // its direct text runs just like mixed content and walk element children.
  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.nodeValue;
      if (!t || !t.trim()) continue;
      const leading = /^\s+/.exec(t)?.[0] || '';
      const trailing = /\s+$/.exec(t)?.[0] || '';
      const core = t.slice(leading.length, t.length - trailing.length);
      if (leading) doc.body.insertBefore(doc.createTextNode(leading), child);
      const span = doc.createElement('span');
      span.setAttribute('data-text-leaf', '1');
      span.textContent = core;
      doc.body.insertBefore(span, child);
      if (trailing) doc.body.insertBefore(doc.createTextNode(trailing), child);
      child.remove();
      tagAsTextLeaf(span, core, 'span');
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child);
    }
  }

  // Text lives in blocks/Y.Text. Keeping it in the skeleton as well doubled
  // large initial syncs and made every structural skeleton rewrite expensive.
  clearTextLeaves(doc);
  const skeleton = serializeSkeleton(doc);
  return { skeleton, blocks };
}

export function renderForEditor(skeleton, blocks) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  const map = new Map(blocks.map(b => [b.id, b.text]));

  doc.querySelectorAll('[data-hce-text]').forEach(el => {
    const id = el.getAttribute('data-block-id');
    if (map.has(id)) el.textContent = map.get(id);
  });

  sanitizeEditorDocument(doc);

  return serializeForOutput(doc);
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

  // Unwrap synthetic mixed-text spans only when they are still semantically
  // neutral. If the user styled one in the editor, keep a layout-neutral span
  // so font/color changes survive export instead of silently disappearing.
  doc.querySelectorAll('span[data-text-leaf]').forEach(el => {
    const style = (el.getAttribute('style') || '').trim();
    const meaningfulAttrs = Array.from(el.attributes).filter(attr => {
      const name = attr.name.toLowerCase();
      return name !== 'data-text-leaf' && name !== 'data-block-id' &&
        name !== 'data-hce-text' && name !== 'contenteditable' && name !== 'spellcheck';
    });
    if (style || meaningfulAttrs.length) {
      // display:contents retains inheritable text styling without introducing a
      // margin/padding/flex box that can shift neighbouring text.
      el.style.setProperty('display', 'contents', 'important');
      el.removeAttribute('data-text-leaf');
      return;
    }
    el.parentNode.replaceChild(doc.createTextNode(el.textContent), el);
  });

  // Preserve whole-block links without wrapping the element in <a>. A wrapper
  // breaks selectors such as `.grid > .card` and changes flex/grid ownership,
  // which was a direct cause of downloaded layouts shifting. A tiny delegated
  // handler keeps the original DOM tree intact.
  let hasBlockLinks = false;
  doc.querySelectorAll('[data-hce-href]').forEach(el => {
    const href = el.getAttribute('data-hce-href');
    el.removeAttribute('data-hce-href');
    if (!href || href === '#') return;
    if (el.tagName === 'A') {
      if (!el.getAttribute('href')) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      return;
    }
    if (el.querySelector('a[href]')) return;
    el.setAttribute('data-html-editor-href', href);
    hasBlockLinks = true;
  });
  if (hasBlockLinks) {
    const script = doc.createElement('script');
    script.setAttribute('data-html-editor-links', '');
    script.textContent = `(function(){document.addEventListener('click',function(e){var n=e.target&&e.target.closest&&e.target.closest('[data-html-editor-href]');if(!n)return;var u=n.getAttribute('data-html-editor-href');if(!u)return;e.preventDefault();window.open(u,'_blank','noopener');});})();`;
    doc.head.appendChild(script);
  }

  // Scrub editor attributes.
  doc.querySelectorAll('[data-block-id]').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === 'data-block-id' || name === 'data-text-leaf' ||
          name === 'data-commented' || name.startsWith('data-hce-')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // The browser serializes the generated Blob as UTF-8. Make that explicit so
  // Chinese and other non-ASCII text is decoded consistently when opened from
  // disk, regardless of the source document's previous charset declaration.
  doc.querySelectorAll('meta[charset], meta[http-equiv]').forEach(meta => {
    if (meta.hasAttribute('charset') || /content-type/i.test(meta.getAttribute('http-equiv') || '')) meta.remove();
  });
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.insertBefore(charset, doc.head.firstChild);

  return serializeForOutput(doc);
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
    skeleton: serializeSkeleton(doc),
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
    skeleton: serializeSkeleton(doc),
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
    skeleton: serializeSkeleton(doc),
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
  if (idsUsedByDocumentCode(doc, target)) {
    return { skeleton, addedBlocks: [], unsupported: 'native-id-dependency' };
  }
  hydrateTextLeaves(target, existingBlocks);

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
  rewriteCloneNativeIds(clone, String(counter + 1));

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

  const clonedHTML = clone.outerHTML;
  clearTextLeaves(doc);
  return {
    skeleton: serializeSkeleton(doc),
    addedBlocks,
    // Serialized HTML of the clone — the caller injects this into the
    // live iframe DOM so the page doesn't have to be re-rendered (which
    // would lose the user's scroll position).
    clonedHTML,
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
  if (cellsOf(tr).length <= 1) return { skeleton, removedIds: [], unsupported: 'last-column' };
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) {
    return { skeleton, removedIds: [], unsupported: 'merged-cells' };
  }

  const removedIds = [];
  directTableRows(table).forEach(row => {
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
    skeleton: serializeSkeleton(doc),
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
  hydrateTextLeaves(doc, existingBlocks);
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
  if (directTableRows(table).some(row => {
    const candidate = cellsOf(row)[colIndex];
    return candidate && idsUsedByDocumentCode(doc, candidate);
  })) return { skeleton, addedBlocks: [], insertions: [], unsupported: 'native-id-dependency' };
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) {
    return { skeleton, addedBlocks: [], insertions: [], unsupported: 'merged-cells' };
  }

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

  directTableRows(table).forEach(row => {
    const rowCells = Array.from(row.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if (colIndex >= rowCells.length) return;
    const orig = rowCells[colIndex];
    if (!orig.hasAttribute('data-block-id')) return;
    const clone = orig.cloneNode(true);
    rewriteCloneNativeIds(clone, String(counter + 1));

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

  clearTextLeaves(doc);
  return {
    skeleton: serializeSkeleton(doc),
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

function directTableRows(table) {
  return Array.from(table.rows || []).filter(row => row.closest('table') === table);
}

function hasMergedCells(table) {
  return directTableRows(table).some(row => cellsOf(row).some(cell =>
    Number(cell.getAttribute('colspan') || 1) !== 1 ||
    Number(cell.getAttribute('rowspan') || 1) !== 1
  ));
}

function hasDirectColgroup(table) {
  return Array.from(table.children || []).some(child => child.tagName === 'COLGROUP');
}

function isRegularTable(table) {
  const rows = directTableRows(table);
  if (!rows.length) return false;
  const width = cellsOf(rows[0]).length;
  return width > 0 && rows.every(row => cellsOf(row).length === width);
}

function copyPresentationAttributes(source, target) {
  for (const attr of Array.from(source?.attributes || [])) {
    const name = attr.name.toLowerCase();
    if (name === 'data-block-id' || name === 'data-hce-text' ||
        name === 'rowspan' || name === 'colspan' || name === 'id' ||
        name === 'headers' || name === 'for' || name === 'name') continue;
    target.setAttribute(attr.name, attr.value);
  }
}

const IDREF_ATTRS = new Set([
  'for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
  'aria-activedescendant', 'headers', 'list', 'form', 'popovertarget', 'commandfor',
]);
function rewriteCloneNativeIds(clone, suffix) {
  const idMap = new Map();
  const elements = [clone, ...clone.querySelectorAll('*')];
  elements.forEach(el => {
    const oldId = el.getAttribute('id');
    if (!oldId) return;
    const nextId = oldId + '--copy-' + suffix;
    idMap.set(oldId, nextId);
    el.setAttribute('id', nextId);
  });
  elements.forEach(el => {
    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name.toLowerCase();
      let value = attr.value;
      if (IDREF_ATTRS.has(name)) {
        value = value.split(/\s+/).map(token => idMap.get(token) || token).join(' ');
      } else if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
        value = '#' + (idMap.get(value.slice(1)) || value.slice(1));
      } else if (name === 'style' || name === 'fill' || name === 'stroke' || name === 'filter' || name === 'clip-path' || name === 'mask') {
        value = value.replace(/url\(\s*#([^\s)]+)\s*\)/g, (match, id) => 'url(#' + (idMap.get(id) || id) + ')');
      }
      if (value !== attr.value) el.setAttribute(attr.name, value);
    }
  });
}

function idsUsedByDocumentCode(doc, root) {
  const ids = [root, ...root.querySelectorAll('[id]')]
    .map(el => el.getAttribute('id')).filter(Boolean);
  if (!ids.length) return false;
  const code = Array.from(doc.querySelectorAll('style, script')).map(el => el.textContent || '').join('\n');
  return ids.some(id => {
    const escaped = id.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    return new RegExp('#' + escaped + '(?![\\w-])').test(code) ||
      code.includes('getElementById("' + id + '"') || code.includes("getElementById('" + id + "'") ||
      code.includes('querySelector("#' + id + '"') || code.includes("querySelector('#" + id + "'");
  });
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
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) return { ...empty, unsupported: 'merged-cells' };

  let counter = nextBlockCounter(doc, existingBlocks);
  const addedBlocks = [];

  directTableRows(table).forEach(row => {
    const rowCells = cellsOf(row);
    if (!rowCells.length) return;
    const ref = rowCells[colIndex] || rowCells[rowCells.length - 1];
    const isHead = ref.tagName === 'TH';
    const nc = doc.createElement(isHead ? 'th' : 'td');
    copyPresentationAttributes(ref, nc);
    const nid = 'b' + (++counter);
    nc.setAttribute('data-block-id', nid);
    nc.setAttribute('data-hce-text', '1');
    const refStyle = ref.getAttribute('style');
    if (refStyle) nc.setAttribute('style', refStyle);
    else if (!ref.getAttribute('class')) nc.setAttribute('style', DEFAULT_CELL_CSS);
    nc.textContent = '';
    addedBlocks.push({ id: nid, tag: nc.tagName.toLowerCase(), text: '' });
    if (side === 'left') row.insertBefore(nc, ref);
    else if (ref.nextSibling) row.insertBefore(nc, ref.nextSibling);
    else row.appendChild(nc);
  });

  if (!addedBlocks.length) return empty;
  return {
    skeleton: serializeSkeleton(doc),
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
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) return { ...empty, unsupported: 'merged-cells' };

  const refCells = cellsOf(tr);
  if (!refCells.length) return empty;

  // Per-column body-style prototypes: prefer a real <td> in that column.
  const colStyle = [];
  const colPrototype = [];
  const rows = directTableRows(table);
  for (let i = 0; i < refCells.length; i++) {
    let style = '';
    let prototype = refCells[i];
    for (const row of rows) {
      const rc = cellsOf(row);
      const c = rc[i];
      if (c && c.tagName === 'TD') {
        prototype = c;
        if (c.getAttribute('style')) style = c.getAttribute('style');
        break;
      }
    }
    if (!style && refCells[i].tagName === 'TD') style = refCells[i].getAttribute('style') || '';
    if (!style && !prototype.getAttribute('class') && !refCells[i].getAttribute('class')) style = DEFAULT_CELL_CSS;
    colStyle.push(style);
    colPrototype.push(prototype);
  }

  let counter = nextBlockCounter(doc, existingBlocks);
  const addedBlocks = [];
  const newRow = doc.createElement('tr');
  const bodyRowPrototype = rows.find(row => row.parentElement?.tagName === 'TBODY');
  copyPresentationAttributes((parent.tagName === 'THEAD' || parent.tagName === 'TFOOT')
    ? bodyRowPrototype : tr, newRow);
  newRow.setAttribute('data-block-id', 'b' + (++counter));
  refCells.forEach((ref, i) => {
    const nc = doc.createElement('td');
    // Prefer a real body cell prototype for class/data-based column styling.
    copyPresentationAttributes(colPrototype[i] || ref, nc);
    const nid = 'b' + (++counter);
    nc.setAttribute('data-block-id', nid);
    nc.setAttribute('data-hce-text', '1');
    if (colStyle[i]) nc.setAttribute('style', colStyle[i]);
    else if (!(colPrototype[i] || ref).getAttribute('class')) nc.setAttribute('style', DEFAULT_CELL_CSS);
    nc.textContent = '';
    addedBlocks.push({ id: nid, tag: 'td', text: '' });
    newRow.appendChild(nc);
  });

  // Body-style rows never belong inside THEAD. Route insertion near a header
  // into TBODY (creating it if needed) so semantics and CSS remain coherent.
  if (parent.tagName === 'THEAD' || parent.tagName === 'TFOOT') {
    let body = Array.from(table.children).find(child => child.tagName === 'TBODY');
    if (!body) {
      body = doc.createElement('tbody');
      if (parent.tagName === 'TFOOT') table.insertBefore(body, parent); else table.appendChild(body);
    }
    if (parent.tagName === 'THEAD') body.insertBefore(newRow, body.firstChild);
    else body.appendChild(newRow);
  } else if (side === 'above') parent.insertBefore(newRow, tr);
  else if (tr.nextSibling) parent.insertBefore(newRow, tr.nextSibling);
  else parent.appendChild(newRow);

  if (!addedBlocks.length) return empty;
  return {
    skeleton: serializeSkeleton(doc),
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
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) return { ...empty, unsupported: 'merged-cells' };

  const rows = directTableRows(table);
  if (rows.some(row => row.parentElement !== tr.parentElement)) return { ...empty, unsupported: 'row-groups' };
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
    skeleton: serializeSkeleton(doc),
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
  if (hasMergedCells(table) || hasDirectColgroup(table) || !isRegularTable(table)) return { ...empty, unsupported: 'merged-cells' };

  const numCols = cellsOf(tr0).length;
  let to = Math.max(0, Math.min(numCols, toIndex | 0));
  if (to === fromIdx || to === fromIdx + 1) return empty;   // dropped in its own slot

  const adj = to > fromIdx ? to - 1 : to;
  directTableRows(table).forEach(row => {
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
    skeleton: serializeSkeleton(doc),
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
