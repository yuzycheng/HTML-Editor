const { readTextFile } = await import('./encoding.js' + new URL(import.meta.url).search);
const { inspectDocumentCapacity, estimatedDataUrlBytes } = await import('./capacity.js' + new URL(import.meta.url).search);
const {
  compressImageDataUrl, compressImageFile, isInlineRasterImage,
} = await import('./image-compression.js' + new URL(import.meta.url).search);

const DOCUMENT_STRUCTURE_RESERVE_BYTES = 16 * 1024;

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', woff2: 'font/woff2',
  woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
};

function originalDoctype(source) {
  const text = String(source || '');
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text.slice(start, start + 4) !== '<!--') break;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) break;
    start = end + 3;
  }
  if (text.slice(start, start + 9).toLowerCase() !== '<!doctype') return '';
  const boundary = text[start + 9];
  if (boundary && !/[\s>]/.test(boundary)) return '';

  // Keep the source declaration byte-for-byte (case, PUBLIC/SYSTEM ids, and
  // quoting). A plain `[^>]*` match would stop at a `>` inside a quoted id.
  let quote = '';
  for (let cursor = start + 9; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return text.slice(start, cursor + 1);
    }
  }
  return '';
}

function serializeBundledHTML(source, doc) {
  const doctype = originalDoctype(source);
  if (!doc?.childNodes) {
    const elementHTML = typeof doc === 'string' ? doc : (doc?.documentElement?.outerHTML || '');
    return (doctype ? doctype + '\n' : '') + elementHTML;
  }
  const output = [];
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 10) { if (doctype) output.push(doctype); }
    else if (node.nodeType === 8) output.push('<!--' + node.data + '-->');
    else if (node === doc.documentElement) output.push(doc.documentElement.outerHTML);
  }
  if (!output.includes(doc.documentElement.outerHTML)) output.push(doc.documentElement.outerHTML);
  return output.join('\n');
}

export function projectPath(file) {
  return String(file?._relPath || file?.webkitRelativePath || file?.name || '')
    .replace(/\\/g, '/').replace(/^\/+/, '');
}

export function normalizeProjectPath(path) {
  const out = [];
  for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index + 1);
}

function basename(path) {
  const clean = String(path || '').split('?')[0].split('#')[0];
  const index = clean.lastIndexOf('/');
  return index < 0 ? clean : clean.slice(index + 1);
}

function extension(path) {
  const match = /\.([a-z0-9]+)$/i.exec(String(path || '').split(/[?#]/)[0]);
  return (match?.[1] || '').toLowerCase();
}

function mimeFor(file, path) {
  return file?.type || MIME_BY_EXT[extension(path)] || 'application/octet-stream';
}

function isExternalReference(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(value || '').trim());
}

function relativePath(fromFile, toFile) {
  const from = dirname(fromFile).split('/').filter(Boolean);
  const to = String(toFile || '').split('/').filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return '../'.repeat(from.length) + to.join('/');
}

function splitReference(value) {
  const match = /^([^?#]*)(.*)$/.exec(String(value || '').trim());
  return { path: match?.[1] || '', suffix: match?.[2] || '' };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function readStringEnd(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') index += 2;
    else if (text[index] === quote) return index + 1;
    else index++;
  }
  return text.length;
}

function parseUrlAt(css, start) {
  let index = start + 4;
  while (/\s/.test(css[index] || '')) index++;
  let valueStart = index;
  let valueEnd;
  if (css[index] === '"' || css[index] === "'") {
    const quote = css[index];
    valueStart = index + 1;
    const end = readStringEnd(css, index);
    valueEnd = Math.max(valueStart, end - 1);
    index = end;
    while (/\s/.test(css[index] || '')) index++;
    if (css[index] === ')') index++;
    return { start: valueStart, end: valueEnd, value: css.slice(valueStart, valueEnd), next: index, quote };
  }
  while (index < css.length && css[index] !== ')') index++;
  valueEnd = index;
  while (valueEnd > valueStart && /\s/.test(css[valueEnd - 1])) valueEnd--;
  return { start: valueStart, end: valueEnd, value: css.slice(valueStart, valueEnd), next: Math.min(css.length, index + 1), quote: '' };
}

export function scanCssUrls(css) {
  const refs = [];
  const lower = css.toLowerCase();
  let index = 0;
  while (index < css.length) {
    if (css.slice(index, index + 2) === '/*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (css[index] === '"' || css[index] === "'") {
      index = readStringEnd(css, index);
      continue;
    }
    if (lower.startsWith('url(', index)) {
      const parsed = parseUrlAt(css, index);
      refs.push(parsed);
      index = parsed.next;
      continue;
    }
    index++;
  }
  return refs;
}

export function scanCssImports(css) {
  const imports = [];
  const lower = css.toLowerCase();
  let index = 0;
  while (index < css.length) {
    if (css.slice(index, index + 2) === '/*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (css[index] === '"' || css[index] === "'") {
      index = readStringEnd(css, index);
      continue;
    }
    if (!lower.startsWith('@import', index)) { index++; continue; }
    const start = index;
    let cursor = index + 7;
    while (/\s/.test(css[cursor] || '')) cursor++;
    let value = '';
    let afterReference = cursor;
    if (lower.startsWith('url(', cursor)) {
      const parsed = parseUrlAt(css, cursor);
      value = parsed.value;
      afterReference = parsed.next;
    } else if (css[cursor] === '"' || css[cursor] === "'") {
      const end = readStringEnd(css, cursor);
      value = css.slice(cursor + 1, Math.max(cursor + 1, end - 1));
      afterReference = end;
    } else { index += 7; continue; }
    let end = afterReference;
    let depth = 0;
    while (end < css.length) {
      if (css[end] === '"' || css[end] === "'") { end = readStringEnd(css, end); continue; }
      if (css[end] === '(') depth++;
      if (css[end] === ')') depth = Math.max(0, depth - 1);
      if (css[end] === ';' && depth === 0) { end++; break; }
      end++;
    }
    imports.push({ start, end, value, qualifiers: css.slice(afterReference, Math.max(afterReference, end - 1)).trim() });
    index = end;
  }
  return imports;
}

export function parseSrcset(value) {
  const source = String(value || '');
  const candidates = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index++;
    if (index >= source.length) break;
    const start = index;
    const isData = source.slice(index, index + 5).toLowerCase() === 'data:';
    while (index < source.length && !/\s/.test(source[index]) && (isData || source[index] !== ',')) index++;
    let url = source.slice(start, index);
    while (!isData && url.endsWith(',')) url = url.slice(0, -1);
    while (index < source.length && /\s/.test(source[index])) index++;
    const descriptorStart = index;
    while (index < source.length && source[index] !== ',') index++;
    candidates.push({ url, descriptor: source.slice(descriptorStart, index).trim() });
    if (index < source.length) index++;
  }
  return candidates;
}

export async function bundleFolderAssets(options) {
  const html = String(options.html || '');
  const files = Array.from(options.files || []);
  const entries = files.map(file => ({ file, path: normalizeProjectPath(projectPath(file)) })).filter(entry => entry.path);
  const maxInlineBytes = Math.max(0, Number(options.maxInlineBytes) || 0);
  const maxImageBytes = Math.max(0, Number(options.maxImageBytes) || 0);
  const requestedDocumentBytes = Number(options.maxDocumentBytes);
  const maxDocumentBytes = Number.isFinite(requestedDocumentBytes) && requestedDocumentBytes >= 0
    ? requestedDocumentBytes : Number.POSITIVE_INFINITY;
  const documentReserveBytes = Number.isFinite(maxDocumentBytes)
    ? Math.min(DOCUMENT_STRUCTURE_RESERVE_BYTES, maxDocumentBytes) : 0;
  const hasExternalAssets = entries.some(entry => entry.file !== options.mainFile);
  const sourceStats = inspectDocumentCapacity(html);
  const hasEmbeddedRaster = /data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;|,)/i.test(html);
  const embeddedImagesNeedWork = hasEmbeddedRaster && (
    sourceStats.maxInlineImageBytes > maxImageBytes ||
    sourceStats.inlineMediaBytes > maxInlineBytes ||
    sourceStats.totalBytes + documentReserveBytes > maxDocumentBytes
  );
  if (!hasExternalAssets && !embeddedImagesNeedWork) {
    return { html, bundled: [], compressed: [], compressedEmbedded: 0, skipped: [], warnings: [] };
  }
  const exact = new Map(entries.map(entry => [entry.path, entry.file]));
  const folded = new Map();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (!folded.has(key)) folded.set(key, []);
    folded.get(key).push(entry);
  }
  const mainPath = normalizeProjectPath(projectPath(options.mainFile)) || options.mainFile?.name || 'index.html';
  const firstParts = entries.map(entry => entry.path.split('/')[0]);
  const commonRoot = firstParts.length && firstParts.every(part => part === firstParts[0]) && entries.some(entry => entry.path.includes('/')) ? firstParts[0] + '/' : '';
  const warnings = [];
  const bundled = [];
  const compressed = [];
  const dataCache = new Map();
  const compressedCache = new Map();
  const embeddedCompressionCache = new Map();
  const rawCssCache = new Map();
  const warningKeys = new Set();
  let compressedEmbedded = 0;
  let currentInlineBytes = sourceStats.inlineMediaBytes;
  let currentDocumentBytes = sourceStats.totalBytes;
  let remainingMedia = Math.max(0, maxInlineBytes - currentInlineBytes);
  let remainingDocument = Math.max(0, maxDocumentBytes - documentReserveBytes - currentDocumentBytes);

  function textBytes(value) {
    return new TextEncoder().encode(String(value || '')).byteLength;
  }

  function pushWarning(code, ref, owner) {
    const key = code + '\n' + ref + '\n' + owner;
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push({ code, ref, owner });
  }

  function resolveReference(ref, ownerPath) {
    if (!ref || isExternalReference(ref)) return { external: true, value: ref };
    const parts = splitReference(ref);
    let decoded = parts.path;
    try { decoded = decodeURIComponent(decoded); } catch {}
    const candidate = normalizeProjectPath(decoded.startsWith('/') ? commonRoot + decoded.slice(1) : dirname(ownerPath) + decoded);
    if (!candidate || (commonRoot && !candidate.startsWith(commonRoot))) return { invalid: true, value: ref };
    let file = exact.get(candidate);
    let actualPath = candidate;
    if (!file) {
      const hits = folded.get(candidate.toLowerCase()) || [];
      if (hits.length === 1) { file = hits[0].file; actualPath = hits[0].path; }
      else if (hits.length > 1) return { ambiguous: true, value: ref, path: candidate };
    }
    return file ? { file, path: actualPath, suffix: parts.suffix } : { missing: true, value: ref, path: candidate };
  }

  function rebaseReference(ref, ownerPath) {
    if (!ref || isExternalReference(ref)) return ref;
    const parts = splitReference(ref);
    let decoded = parts.path;
    try { decoded = decodeURIComponent(decoded); } catch {}
    const target = normalizeProjectPath(decoded.startsWith('/') ? commonRoot + decoded.slice(1) : dirname(ownerPath) + decoded);
    return target ? (relativePath(mainPath, target) || basename(target)) + parts.suffix : ref;
  }

  async function asDataUrl(file, path) {
    if (!dataCache.has(path)) {
      dataCache.set(path, file.arrayBuffer().then(buffer => 'data:' + mimeFor(file, path) + ';base64,' + bytesToBase64(new Uint8Array(buffer))));
    }
    return dataCache.get(path);
  }

  async function imageAsDataUrl(file, path, maxBytes) {
    const estimate = estimatedDataUrlBytes(file);
    if (estimate <= maxBytes) return { value: await asDataUrl(file, path), compressed: false };
    const key = path + ':' + maxBytes;
    if (!compressedCache.has(key)) {
      compressedCache.set(key, compressImageFile(file, { maxDataUrlBytes: maxBytes }));
    }
    const result = await compressedCache.get(key);
    return { value: result.dataUrl, compressed: !!result.compressed };
  }

  function refreshBudgetsFromDocument(doc) {
    const serialized = serializeBundledHTML(html, doc);
    const stats = inspectDocumentCapacity(serialized);
    currentInlineBytes = stats.inlineMediaBytes;
    currentDocumentBytes = stats.totalBytes;
    remainingMedia = Math.max(0, maxInlineBytes - currentInlineBytes);
    remainingDocument = Math.max(0, maxDocumentBytes - documentReserveBytes - currentDocumentBytes);
  }

  function embeddedImageOccurrences(doc, includeCss) {
    const occurrences = [];
    let sequence = 0;
    const add = (dataUrl, replace) => {
      const value = String(dataUrl || '').trim();
      if (!isInlineRasterImage(value)) return;
      occurrences.push({ value, bytes: textBytes(value), replace, ref: 'embedded-image-' + (++sequence) });
    };
    const replaceOnce = (current, before, after) => {
      const index = String(current || '').indexOf(before);
      if (index < 0) return current;
      return current.slice(0, index) + after + current.slice(index + before.length);
    };

    doc.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (name === 'style') {
          if (!includeCss) continue;
          for (const item of scanCssUrls(attr.value || '')) {
            add(item.value, next => {
              const current = el.getAttribute(attr.name) || '';
              el.setAttribute(attr.name, replaceOnce(current, item.value, next));
            });
          }
          continue;
        }
        if (name === 'srcset') {
          for (const candidate of parseSrcset(attr.value || '')) {
            add(candidate.url, next => {
              const current = el.getAttribute(attr.name) || '';
              el.setAttribute(attr.name, replaceOnce(current, candidate.url, next));
            });
          }
          continue;
        }
        const tag = String(el.tagName || '').toUpperCase();
        const isDirectImageUrl = name === 'poster' ||
          (name === 'src' && (tag === 'IMG' || tag === 'SOURCE' ||
            (tag === 'INPUT' && String(el.getAttribute('type') || '').toLowerCase() === 'image'))) ||
          ((name === 'href' || name === 'xlink:href') && tag === 'IMAGE') ||
          (name === 'href' && tag === 'LINK' && /(?:^|\s)icon(?:\s|$)/i.test(el.getAttribute('rel') || ''));
        if (isDirectImageUrl) add(attr.value, next => el.setAttribute(attr.name, next));
      }
    });
    if (includeCss) {
      doc.querySelectorAll('style').forEach(style => {
        for (const item of scanCssUrls(style.textContent || '')) {
          add(item.value, next => {
            style.textContent = replaceOnce(style.textContent || '', item.value, next);
          });
        }
      });
    }
    return occurrences.sort((a, b) => b.bytes - a.bytes);
  }

  async function compressEmbeddedImages(doc, includeCss = true) {
    for (const occurrence of embeddedImageOccurrences(doc, includeCss)) {
      const requiredReduction = Math.max(
        Math.max(0, occurrence.bytes - maxImageBytes),
        Math.max(0, currentInlineBytes - maxInlineBytes),
        Math.max(0, currentDocumentBytes + documentReserveBytes - maxDocumentBytes),
      );
      if (!requiredReduction) continue;

      const targetBytes = Math.min(maxImageBytes, occurrence.bytes - requiredReduction);
      if (targetBytes <= 0 || targetBytes >= occurrence.bytes) continue;
      try {
        const cacheKey = occurrence.value + '\n' + targetBytes;
        if (!embeddedCompressionCache.has(cacheKey)) {
          embeddedCompressionCache.set(cacheKey, compressImageDataUrl(occurrence.value, {
            maxDataUrlBytes: targetBytes,
            // Existing media may need an aggressively small result to rescue
            // an otherwise rejected document. Prefer a small usable thumbnail
            // over rejecting the user's whole HTML file.
            allowTinyTarget: true,
          }));
        }
        const result = await embeddedCompressionCache.get(cacheKey);
        const next = result.dataUrl;
        const nextBytes = textBytes(next);
        if (!result.compressed || !next || nextBytes >= occurrence.bytes) continue;
        occurrence.replace(next);
        currentInlineBytes += nextBytes - occurrence.bytes;
        currentDocumentBytes += nextBytes - occurrence.bytes;
        compressedEmbedded++;
      } catch (error) {
        pushWarning(
          error?.code === 'ANIMATED_IMAGE_TOO_LARGE' ? 'animated-image-too-large' : 'embedded-image-too-large',
          occurrence.ref, mainPath,
        );
      }
    }
    refreshBudgetsFromDocument(doc);
  }

  async function bundleReference(ref, ownerPath, stack) {
    const found = resolveReference(ref, ownerPath);
    if (found.external) return { ok: true, value: ref };
    if (!found.file) {
      pushWarning(found.ambiguous ? 'ambiguous' : found.invalid ? 'invalid-path' : 'missing', ref, ownerPath);
      return { ok: false, value: ref };
    }
    if (extension(found.path) === 'svg') {
      pushWarning('svg-not-inlined', ref, ownerPath);
      return { ok: false, value: ref };
    }
    // Reject certain over-budget files by metadata before arrayBuffer/base64.
    // Reading a multi-gigabyte referenced file just to discover it cannot fit
    // in the 5 MiB inline budget can freeze or OOM the browser.
    const mime = mimeFor(found.file, found.path);
    const isRasterImage = /^image\/(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(mime);
    const estimated = estimatedDataUrlBytes(found.file);
    if (!isRasterImage && (estimated > remainingMedia || estimated > remainingDocument)) {
      pushWarning('inline-budget', ref, ownerPath);
      return { ok: false, value: ref };
    }
    let value;
    if (isRasterImage) {
      const targetBytes = Math.min(maxImageBytes, remainingMedia, remainingDocument);
      try {
        const image = await imageAsDataUrl(found.file, found.path, targetBytes);
        value = image.value;
        if (image.compressed) compressed.push(found.path);
      } catch (error) {
        pushWarning(error?.code === 'ANIMATED_IMAGE_TOO_LARGE' ? 'animated-image-too-large' : 'image-too-large', ref, ownerPath);
        return { ok: false, value: ref };
      }
    } else {
      value = await asDataUrl(found.file, found.path);
    }
    const bytes = new TextEncoder().encode(value).byteLength;
    if (isRasterImage && bytes > maxImageBytes) {
      pushWarning('image-too-large', ref, ownerPath);
      return { ok: false, value: ref };
    }
    if (bytes > remainingMedia || bytes > remainingDocument) {
      pushWarning('inline-budget', ref, ownerPath);
      return { ok: false, value: ref };
    }
    remainingMedia -= bytes;
    remainingDocument -= bytes;
    bundled.push(found.path);
    // Query strings and fragments identify the source resource, but they are
    // not part of its bytes. Appending either to a generated data URL can make
    // the URL undecodable (notably `?v=...` on fonts and images).
    return { ok: true, value };
  }

  async function rewriteCss(css, ownerPath, stack) {
    const imports = scanCssImports(css);
    const replacements = [];
    // Resolve ordinary url() tokens in the directory of THIS stylesheet. URL
    // tokens belonging to @import are handled by the import pass below.
    for (const item of scanCssUrls(css)) {
      if (imports.some(imp => item.start >= imp.start && item.start < imp.end)) continue;
      const result = await bundleReference(item.value, ownerPath, stack);
      const value = result.ok ? result.value : rebaseReference(item.value, ownerPath);
      if (value !== item.value) replacements.push({ start: item.start, end: item.end, value });
    }
    for (const item of imports) {
      const found = resolveReference(item.value, ownerPath);
      if (!found.file || extension(found.path) !== 'css') {
        if (!found.external) warnings.push({ code: 'missing-import', ref: item.value, owner: ownerPath });
        const rebased = rebaseReference(item.value, ownerPath);
        if (rebased !== item.value) {
          const qualifier = item.qualifiers ? ' ' + item.qualifiers : '';
          replacements.push({ start: item.start, end: item.end, value: '@import url("' + rebased + '")' + qualifier + ';' });
        }
        continue;
      }
      if (stack.includes(found.path)) { warnings.push({ code: 'css-cycle', ref: item.value, owner: ownerPath }); continue; }
      const imported = await processCss(found.file, found.path, stack.concat(found.path));
      let replacement = imported;
      if (item.qualifiers) {
        if (/^(?:screen|print|all|\(|not\b|only\b)/i.test(item.qualifiers)) replacement = '@media ' + item.qualifiers + '{' + imported + '}';
        else { warnings.push({ code: 'unsupported-import-qualifier', ref: item.value, owner: ownerPath }); continue; }
      }
      replacements.push({ start: item.start, end: item.end, value: replacement });
      bundled.push(found.path);
    }
    replacements.sort((a, b) => b.start - a.start);
    for (const change of replacements) {
      css = css.slice(0, change.start) + change.value + css.slice(change.end);
    }
    return css;
  }

  async function processCss(file, ownerPath, stack) {
    if (!rawCssCache.has(ownerPath)) rawCssCache.set(ownerPath, readTextFile(file, 'css').then(result => result.text));
    return rewriteCss(await rawCssCache.get(ownerPath), ownerPath, stack);
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hasCsp = !!doc.querySelector('meta[http-equiv="content-security-policy" i]');
  if (hasCsp) {
    // The editor removes CSP from its sandboxed preview, but export restores the
    // source policy. Do not create data: URLs that the exported policy may then
    // block; preserve every original CSS/media reference instead.
    pushWarning('csp', '', mainPath);
    return {
      html,
      bundled: [],
      compressed: [],
      compressedEmbedded: 0,
      warnings,
      skipped: warnings.map(warning => basename(warning.ref || warning.owner)).filter(Boolean),
    };
  }
  refreshBudgetsFromDocument(doc);
  // Existing inline image bytes are part of the user's document already. Shrink
  // them before adding any project assets, while preserving over-budget GIFs.
  await compressEmbeddedImages(doc, true);
  for (const style of Array.from(doc.querySelectorAll('style'))) style.textContent = await rewriteCss(style.textContent || '', mainPath, [mainPath]);
  for (const el of Array.from(doc.querySelectorAll('[style]'))) el.setAttribute('style', await rewriteCss(el.getAttribute('style') || '', mainPath, [mainPath]));
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    if (link.hasAttribute('integrity')) { warnings.push({ code: 'integrity', ref: link.getAttribute('href'), owner: mainPath }); continue; }
    const found = resolveReference(link.getAttribute('href'), mainPath);
    if (!found.file || extension(found.path) !== 'css') {
      if (!found.external) warnings.push({ code: 'missing-stylesheet', ref: link.getAttribute('href'), owner: mainPath });
      continue;
    }
    const style = doc.createElement('style');
    for (const name of ['media', 'title', 'nonce']) if (link.hasAttribute(name)) style.setAttribute(name, link.getAttribute(name));
    style.setAttribute('data-bundled-from', found.path);
    style.textContent = (await processCss(found.file, found.path, [found.path])).replace(/<\/style/gi, '<\\/style');
    link.replaceWith(style);
    bundled.push(found.path);
  }
  // Imported CSS changes the exact document size and can introduce more inline
  // data images. Recalculate before markup assets consume the remaining budget.
  refreshBudgetsFromDocument(doc);
  await compressEmbeddedImages(doc, true);

  const attrTargets = [];
  doc.querySelectorAll('img[src],video[src],audio[src],source[src],input[type="image"][src]').forEach(el => attrTargets.push([el, 'src']));
  doc.querySelectorAll('video[poster]').forEach(el => attrTargets.push([el, 'poster']));
  doc.querySelectorAll('svg image[href]').forEach(el => attrTargets.push([el, 'href']));
  doc.querySelectorAll('svg image[xlink\\:href]').forEach(el => attrTargets.push([el, 'xlink:href']));
  for (const pair of attrTargets) {
    const el = pair[0], attr = pair[1], original = el.getAttribute(attr) || '';
    const found = resolveReference(original, mainPath);
    if ((attr === 'href' || attr === 'xlink:href') && found.file &&
        !/^image\/(?:png|jpeg|gif|webp|avif)$/i.test(mimeFor(found.file, found.path))) {
      warnings.push({ code: 'svg-image-unsupported', ref: original, owner: mainPath });
      continue;
    }
    const result = await bundleReference(original, mainPath, [mainPath]);
    if (result.ok && result.value !== original) el.setAttribute(attr, result.value);
  }
  for (const el of Array.from(doc.querySelectorAll('img[srcset],source[srcset]'))) {
    const original = el.getAttribute('srcset') || '';
    const candidates = parseSrcset(original);
    const beforeMediaBudget = remainingMedia;
    const beforeDocumentBudget = remainingDocument;
    const beforeCount = bundled.length;
    const beforeCompressedCount = compressed.length;
    const resolved = [];
    let ok = true;
    for (const candidate of candidates) {
      const result = await bundleReference(candidate.url, mainPath, [mainPath]);
      if (!result.ok) { ok = false; break; }
      resolved.push(result.value + (candidate.descriptor ? ' ' + candidate.descriptor : ''));
    }
    if (ok) el.setAttribute('srcset', resolved.join(', '));
    else {
      remainingMedia = beforeMediaBudget;
      remainingDocument = beforeDocumentBudget;
      bundled.length = beforeCount;
      compressed.length = beforeCompressedCount;
    }
  }
  return {
    html: serializeBundledHTML(html, doc),
    bundled: Array.from(new Set(bundled)),
    compressed: Array.from(new Set(compressed)),
    compressedEmbedded,
    warnings,
    skipped: warnings.map(warning => basename(warning.ref || warning.owner)).filter(Boolean),
  };
}
