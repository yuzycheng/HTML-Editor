// Shared capacity policy for every import/edit entry point. Values are binary
// MiB because browser memory/storage limits are normally discussed that way.
export const MIB = 1024 * 1024;
export const MAX_SOURCE_HTML_BYTES = 10 * MIB;
export const LARGE_SOURCE_WARNING_BYTES = 5 * MIB;
export const MAX_DOCUMENT_BYTES = 12 * MIB;
export const MAX_INLINE_MEDIA_BYTES = 5 * MIB;
export const MAX_INLINE_IMAGE_BYTES = 2 * MIB;
// Raw audio/video is converted to Base64 (~4/3 expansion). 3.5 MiB stays
// below the 5 MiB aggregate inline-media budget after conversion.
export const MAX_INLINE_BINARY_SOURCE_BYTES = Math.floor(3.5 * MIB);
export const ELEMENT_WARNING_COUNT = 20_000;
export const MAX_ELEMENT_COUNT = 50_000;
export const MAX_COMMENT_BYTES = 16 * 1024;
export const MAX_COMMENTS = 500;
export const MAX_COMMENTS_TOTAL_BYTES = 512 * 1024;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

export function serializedTextByteLength(value) {
  const text = String(value || '');
  // textContent is serialized into HTML entities for these delimiters. Counting
  // the escaped representation keeps incremental edit checks conservative.
  return utf8ByteLength(text)
    + (text.match(/&/g)?.length || 0) * 4
    + (text.match(/</g)?.length || 0) * 3
    + (text.match(/>/g)?.length || 0) * 3;
}

export function formatMiB(bytes, digits = 1) {
  return (Number(bytes || 0) / MIB).toFixed(digits) + ' MiB';
}

export function isInlineDataUrl(value) {
  return /^data:/i.test(String(value || '').trim());
}

// CSS escapes can hide the data: scheme from a plain substring scan. Decode
// them before capacity checks so browser-loaded media cannot evade limits.
function decodeCssEscapes(value) {
  return String(value || '').replace(/\\([0-9a-f]{1,6})(?:\s)?|\\(.)/gi, (_, hex, char) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return code && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
    }
    return char || '';
  });
}

export function inspectDocumentCapacity(html) {
  const source = String(html || '');
  const result = {
    totalBytes: utf8ByteLength(source),
    inlineMediaBytes: 0,
    maxInlineImageBytes: 0,
    elementCount: 0,
  };
  if (typeof DOMParser === 'undefined') return result;

  const doc = new DOMParser().parseFromString(source, 'text/html');
  result.elementCount = doc.getElementsByTagName('*').length;
  function dataUrls(value) {
    const text = decodeCssEscapes(value);
    const values = [];
    const lower = text.toLowerCase();
    let start = 0;
    while ((start = lower.indexOf('data:', start)) >= 0) {
      let end = start + 5;
      while (end < text.length && !/[\s"'<>)]/.test(text[end])) end++;
      values.push(text.slice(start, end));
      start = end;
    }
    return values;
  }
  // Count inline data URLs on DOM attributes. Each attribute is independent,
  // so video src + poster are both included rather than one masking the other.
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes || [])) {
      for (const value of dataUrls(attr.value)) {
        const bytes = utf8ByteLength(value);
        result.inlineMediaBytes += bytes;
        if (/^data:image\//i.test(value)) result.maxInlineImageBytes = Math.max(result.maxInlineImageBytes, bytes);
      }
    }
  });
  // Also account for inline CSS url(data:...) payloads. Avoid recounting style
  // attributes because they were included by the attribute pass above.
  doc.querySelectorAll('style').forEach(el => {
    for (const value of dataUrls(el.textContent)) {
      const bytes = utf8ByteLength(value);
      result.inlineMediaBytes += bytes;
      if (/^data:image\//i.test(value)) result.maxInlineImageBytes = Math.max(result.maxInlineImageBytes, bytes);
    }
  });
  return result;
}

// Import preflight mirrors the extra list markers and mixed-content wrappers
// that parser.js adds, so the element limit cannot be bypassed by a small raw
// DOM that expands during parsing.
export function inspectSourceCapacity(html) {
  const result = inspectDocumentCapacity(html);
  if (typeof DOMParser === 'undefined') return result;
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  let generated = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let parent;
  while ((parent = walker.nextNode())) {
    if (!parent.firstElementChild) continue;
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim()) generated++;
    }
  }
  result.elementCount += generated;
  return result;
}

export function getCapacityIssue(stats) {
  if (stats.totalBytes > MAX_DOCUMENT_BYTES) return 'document';
  if (stats.inlineMediaBytes > MAX_INLINE_MEDIA_BYTES) return 'media';
  if (stats.maxInlineImageBytes > MAX_INLINE_IMAGE_BYTES) return 'image';
  if (stats.elementCount > MAX_ELEMENT_COUNT) return 'elements';
  return null;
}

export function inspectAndValidateDocument(html) {
  const stats = inspectDocumentCapacity(html);
  return { ...stats, issue: getCapacityIssue(stats) };
}

export function inspectAndValidateSource(html) {
  const stats = inspectSourceCapacity(html);
  return { ...stats, issue: getCapacityIssue(stats) };
}

export function estimatedDataUrlBytes(file) {
  if (!file) return 0;
  // Base64 occupies four bytes for every three source bytes, plus a short
  // `data:<mime>;base64,` header. Round up so preflight never underestimates.
  return 64 + (4 * Math.ceil(Number(file.size || 0) / 3));
}

export function commentsByteLength(comments) {
  try { return utf8ByteLength(JSON.stringify(comments || {})); }
  catch { return Number.POSITIVE_INFINITY; }
}

export function draftPayloadByteLength({ html, comments, editorState }) {
  return utf8ByteLength(html)
    + commentsByteLength(comments)
    + (editorState ? utf8ByteLength(JSON.stringify(editorState)) : 0);
}
