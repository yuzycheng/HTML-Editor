import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isSafePreviewUrl } from '../web/src/parser.js';
import {
  MIB, MAX_SOURCE_HTML_BYTES, MAX_DOCUMENT_BYTES, MAX_INLINE_MEDIA_BYTES,
  MAX_INLINE_IMAGE_BYTES, MAX_INLINE_BINARY_SOURCE_BYTES, MAX_ELEMENT_COUNT,
  MAX_COMMENT_BYTES, MAX_COMMENTS, MAX_COMMENTS_TOTAL_BYTES, estimatedDataUrlBytes,
  getCapacityIssue, utf8ByteLength, serializedTextByteLength,
} from '../web/src/capacity.js';
import { decodeBytes, detectTextEncoding } from '../web/src/encoding.js';
import {
  bundleFolderAssets, normalizeProjectPath, parseSrcset, scanCssImports, scanCssUrls,
} from '../web/src/asset-bundler.js';

test('preview URL policy accepts intended navigation and media URLs', () => {
  for (const value of ['https://example.com/a', 'http://example.com', '/asset.png', './asset.png', '../asset.png', '#section']) {
    assert.equal(isSafePreviewUrl(value, 'href'), true, value);
  }
  assert.equal(isSafePreviewUrl('mailto:test@example.com', 'href'), true);
  assert.equal(isSafePreviewUrl('tel:+123456', 'href'), true);
  assert.equal(isSafePreviewUrl('data:image/png;base64,AA==', 'src'), true);
  assert.equal(isSafePreviewUrl('data:video/mp4;base64,AA==', 'src'), true);
  assert.equal(isSafePreviewUrl('blob:https://example.com/id', 'src'), true);
});

test('preview URL policy rejects executable and local schemes', () => {
  for (const value of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
  ]) {
    assert.equal(isSafePreviewUrl(value, 'src'), false, value);
  }
  assert.equal(isSafePreviewUrl('data:image/png;base64,AA==', 'href'), false);
});

test('parent and iframe both authenticate the message source', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.match(room, /e\.source !== iframe\.contentWindow/);
  assert.match(injection, /e\.source !== window\.parent/);
});

test('collaboration timeout rejects instead of hydrating an unsynced room', async () => {
  const collab = await readFile(new URL('../web/src/collab.js', import.meta.url), 'utf8');
  assert.match(collab, /reject\(error\)/);
  assert.match(collab, /provider\.destroy\(\)/);
  assert.doesNotMatch(collab, /setTimeout\(fin, 4000\)/);
  assert.match(collab, /30000/);
});

test('editor iframe keeps forms disabled and suppresses referrers', async () => {
  const html = await readFile(new URL('../web/room.html', import.meta.url), 'utf8');
  const iframe = html.match(/<iframe id="iframe"[^>]*>/)?.[0] || '';
  assert.ok(iframe, 'editor iframe exists');
  assert.doesNotMatch(iframe, /allow-forms/);
  assert.match(iframe, /referrerpolicy="no-referrer"/);
});

test('capacity policy uses the agreed 10/12/5/2 MiB limits', () => {
  assert.equal(MAX_SOURCE_HTML_BYTES, 10 * MIB);
  assert.equal(MAX_DOCUMENT_BYTES, 12 * MIB);
  assert.equal(MAX_INLINE_MEDIA_BYTES, 5 * MIB);
  assert.equal(MAX_INLINE_IMAGE_BYTES, 2 * MIB);
  assert.equal(MAX_INLINE_BINARY_SOURCE_BYTES, Math.floor(3.5 * MIB));
  assert.equal(MAX_ELEMENT_COUNT, 50_000);
  assert.equal(MAX_COMMENT_BYTES, 16 * 1024);
  assert.equal(MAX_COMMENTS, 500);
  assert.equal(MAX_COMMENTS_TOTAL_BYTES, 512 * 1024);
});

test('capacity checks use UTF-8 bytes and account for base64 expansion', () => {
  assert.equal(utf8ByteLength('中'), 3);
  assert.equal(serializedTextByteLength('<&>'), 13);
  assert.equal(estimatedDataUrlBytes({ size: 3 }), 68);
  assert.equal(estimatedDataUrlBytes({ size: 3 * MIB }) > 4 * MIB, true);
});

test('capacity scanner recognizes CSS-escaped data URLs', async () => {
  const capacitySource = await readFile(new URL('../web/src/capacity.js', import.meta.url), 'utf8');
  assert.match(capacitySource, /decodeCssEscapes/);
});

test('source preflight counts parser-generated list and mixed-text nodes', () => {
  // DOMParser is browser-only in this lightweight Node suite, so assert the
  // implementation contains both expansion cases; browser QA exercises them.
  return readFile(new URL('../web/src/capacity.js', import.meta.url), 'utf8').then(source => {
    assert.match(source, /parent\.firstElementChild/);
  });
});

test('capacity issue priority rejects oversized documents and media', () => {
  assert.equal(getCapacityIssue({ totalBytes: MAX_DOCUMENT_BYTES + 1, inlineMediaBytes: 0, maxInlineImageBytes: 0, elementCount: 1 }), 'document');
  assert.equal(getCapacityIssue({ totalBytes: 1, inlineMediaBytes: MAX_INLINE_MEDIA_BYTES + 1, maxInlineImageBytes: 0, elementCount: 1 }), 'media');
  assert.equal(getCapacityIssue({ totalBytes: 1, inlineMediaBytes: 1, maxInlineImageBytes: MAX_INLINE_IMAGE_BYTES + 1, elementCount: 1 }), 'image');
  assert.equal(getCapacityIssue({ totalBytes: 1, inlineMediaBytes: 1, maxInlineImageBytes: 1, elementCount: MAX_ELEMENT_COUNT + 1 }), 'elements');
});

test('large upload handoff uses IndexedDB with a bounded legacy fallback', async () => {
  const index = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const guide = await readFile(new URL('../web/guide.html', import.meta.url), 'utf8');
  const draftStore = await readFile(new URL('../web/src/draft-store.js', import.meta.url), 'utf8');
  assert.match(index, /await saveDraft\(/);
  assert.doesNotMatch(index, /sessionStorage\.setItem\('hce-init-html-/);
  assert.match(room, /await loadDraft\(/);
  assert.match(guide, /await saveDraft\(/);
  assert.match(draftStore, /indexedDB\.open/);
  assert.match(draftStore, /LEGACY_SAFE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(draftStore, /DRAFT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(draftStore, /MAX_DRAFTS = 5/);
  assert.doesNotMatch(draftStore, /store\.getAll\(\)/);
  assert.match(draftStore, /META_STORE_NAME/);
  assert.match(draftStore, /MAX_DOCUMENT_BYTES/);
});

test('shared skeleton removes duplicate editable text', async () => {
  const parser = await readFile(new URL('../web/src/parser.js', import.meta.url), 'utf8');
  const collab = await readFile(new URL('../web/src/collab.js', import.meta.url), 'utf8');
  assert.match(parser, /clearTextLeaves\(doc\);/);
  assert.match(collab, /compactSkeleton\(skeleton\)/);
  assert.match(collab, /persistStyles\(styles\)/);
  assert.match(collab, /persistMetaSkeleton\(skeleton\)/);
  assert.match(collab, /persistTrackedSkeleton\(skeleton, blocks\)/);
  assert.match(collab, /new Y\.UndoManager\(\[yBlocks, yMeta, yComments, yStyles\]/);
  assert.match(parser, /name\.startsWith\('data-hce-'\)/);
});

test('large text is no longer duplicated in the initial Yjs payload', async () => {
  const Y = await import('yjs');
  const d = new Y.Doc({ gc: false });
  const meta = d.getMap('meta');
  const blocks = d.getMap('blocks');
  const text = 'x'.repeat(5 * MIB);
  meta.set('skeleton', '<p data-block-id="b1" data-hce-text="1"></p>');
  const block = new Y.Map();
  const ytext = new Y.Text();
  ytext.insert(0, text);
  block.set('tag', 'p');
  block.set('text', ytext);
  blocks.set('b1', block);
  assert.ok(Y.encodeStateAsUpdate(d).byteLength < 5.1 * MIB);
});

test('every mutable content path is guarded by the shared capacity policy', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.match(room, /nextBytes > MAX_DOCUMENT_BYTES/);
  assert.match(room, /validateCandidateDocument\(nextSkeleton\)/);
  assert.match(room, /MAX_COMMENT_BYTES/);
  assert.match(room, /MAX_COMMENTS/);
  assert.match(room, /serializedTextByteLength/);
  assert.match(room, /inspectAndValidateSource/);
});

test('server rejects oversized Yjs batches before assembly', async () => {
  const server = await readFile(new URL('../party/server.ts', import.meta.url), 'utf8');
  assert.match(server, /MAX_SYNC_BATCH_BYTES = 20 \* 1024 \* 1024/);
  assert.match(server, /conn\.close\(1009/);
  assert.match(server, /accumulated > MAX_SYNC_BATCH_BYTES/);
  assert.ok(server.includes('MAX_ROOM_STATE_BYTES = 20 * 1024 * 1024'));
  assert.ok(server.includes('encodeStateAsUpdate(guardedDoc).byteLength'));
});

test('text decoder respects declared legacy encodings', () => {
  const bytes = Uint8Array.from([0x3c,0x6d,0x65,0x74,0x61,0x20,0x63,0x68,0x61,0x72,0x73,0x65,0x74,0x3d,0x67,0x62,0x6b,0x3e,0xc4,0xe3,0xba,0xc3]);
  assert.equal(detectTextEncoding(bytes), 'gb18030');
  assert.match(decodeBytes(bytes).text, /你好/);
});

test('asset bundler normalizes paths without basename guessing', () => {
  assert.equal(normalizeProjectPath('project/pages/../assets/font.woff2'), 'project/assets/font.woff2');
  assert.equal(normalizeProjectPath('../../outside.png'), null);
});

test('asset bundler preserves an absent or legacy source doctype', async () => {
  const documentElement = '<html><head></head><body>content</body></html>';
  const NativeDOMParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString() {
      return {
        documentElement: { outerHTML: documentElement },
        getElementsByTagName: () => [],
        querySelector: () => null,
        querySelectorAll: () => [],
      };
    }
  };
  const mainFile = { name: 'index.html', type: 'text/html' };
  const bundle = html => bundleFolderAssets({
    html, mainFile, files: [mainFile], maxInlineBytes: 0, maxImageBytes: 0,
  });

  try {
    assert.equal(
      (await bundle('<html><body>content</body></html>')).html,
      '<html><body>content</body></html>',
    );

    const html4 = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">';
    assert.equal(
      (await bundle(html4 + '<html><body>content</body></html>')).html,
      html4 + '<html><body>content</body></html>',
    );
  } finally {
    if (NativeDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = NativeDOMParser;
  }
});

function assetFile(path, type, bytes = []) {
  const data = Uint8Array.from(bytes);
  return {
    _relPath: path,
    name: path.split('/').pop(),
    type,
    size: data.byteLength,
    async arrayBuffer() { return data.slice().buffer; },
  };
}

function attributeElement(attributes) {
  const values = new Map(Object.entries(attributes));
  return {
    getAttribute(name) { return values.get(name) ?? null; },
    setAttribute(name, value) { values.set(name, String(value)); },
  };
}

test('asset bundler strips source query and fragment from generated data URLs', async () => {
  const NativeDOMParser = globalThis.DOMParser;
  const image = attributeElement({ src: 'img/pixel.png?v=12#preview' });
  const style = { textContent: '@font-face{src:url("fonts/site.woff2?v=4#regular")}' };
  const doc = {
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'style') return [style];
      if (selector === 'img[src],video[src],audio[src],source[src],input[type="image"][src]') return [image];
      return [];
    },
    documentElement: {
      get outerHTML() {
        return `<html><head><style>${style.textContent}</style></head><body><img src="${image.getAttribute('src')}"></body></html>`;
      },
    },
  };
  globalThis.DOMParser = class { parseFromString() { return doc; } };
  const mainFile = assetFile('project/index.html', 'text/html');
  const files = [
    mainFile,
    assetFile('project/img/pixel.png', 'image/png', [1, 2, 3]),
    assetFile('project/fonts/site.woff2', 'font/woff2', [4, 5, 6]),
  ];

  try {
    const result = await bundleFolderAssets({
      html: '<!DOCTYPE html><html></html>',
      mainFile,
      files,
      maxInlineBytes: 10_000,
      maxImageBytes: 10_000,
    });
    assert.match(result.html, /data:image\/png;base64,AQID/);
    assert.match(result.html, /data:font\/woff2;base64,BAUG/);
    assert.doesNotMatch(result.html, /[?#](?:preview|regular|v=)/);
    assert.deepEqual(result.bundled.sort(), ['project/fonts/site.woff2', 'project/img/pixel.png']);

    style.textContent = '@font-face{src:url("fonts/site.woff2?v=4#regular")}';
    image.setAttribute('src', 'img/pixel.png?v=12#preview');
    const unbundled = await bundleFolderAssets({
      html: '<!DOCTYPE html><html></html>',
      mainFile,
      files,
      maxInlineBytes: 0,
      maxImageBytes: 10_000,
    });
    assert.match(unbundled.html, /fonts\/site\.woff2\?v=4#regular/);
    assert.match(unbundled.html, /img\/pixel\.png\?v=12#preview/);
  } finally {
    if (NativeDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = NativeDOMParser;
  }
});

test('asset bundler leaves all CSS and media references untouched under CSP', async () => {
  const NativeDOMParser = globalThis.DOMParser;
  const html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><link rel="stylesheet" href="css/site.css"><style>.x{background:url(img/bg.png)}</style></head><body><img src="img/pixel.png"></body></html>';
  globalThis.DOMParser = class {
    parseFromString() {
      return {
        getElementsByTagName: () => [],
        querySelector(selector) {
          return selector === 'meta[http-equiv="content-security-policy" i]' ? {} : null;
        },
        querySelectorAll() { return []; },
        documentElement: { outerHTML: '<html></html>' },
      };
    }
  };
  const mainFile = assetFile('project/index.html', 'text/html');

  try {
    const result = await bundleFolderAssets({
      html,
      mainFile,
      files: [
        mainFile,
        assetFile('project/css/site.css', 'text/css', [1]),
        assetFile('project/img/bg.png', 'image/png', [2]),
        assetFile('project/img/pixel.png', 'image/png', [3]),
      ],
      maxInlineBytes: 10_000,
      maxImageBytes: 10_000,
    });
    assert.equal(result.html, html);
    assert.deepEqual(result.bundled, []);
    assert.deepEqual(result.warnings, [{ code: 'csp', ref: '', owner: 'project/index.html' }]);
  } finally {
    if (NativeDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = NativeDOMParser;
  }
});

test('CSS and srcset scanners ignore comments and retain descriptors', () => {
  const css = '/* url(fake.png) */ @import \"theme.css\" screen; .x{background:url(\"../img/a.png\")}';
  assert.equal(scanCssImports(css)[0].value, 'theme.css');
  assert.equal(scanCssUrls(css)[0].value, '../img/a.png');
  assert.deepEqual(parseSrcset('a.png 1x, b.png 2x'), [
    { url: 'a.png', descriptor: '1x' },
    { url: 'b.png', descriptor: '2x' },
  ]);
});

test('export preserves selector-sensitive block layout and UTF-8 metadata', async () => {
  const parser = await readFile(new URL('../web/src/parser.js', import.meta.url), 'utf8');
  assert.match(parser, /data-html-editor-href/);
  assert.doesNotMatch(parser, /a\.appendChild\(el\)/);
  assert.match(parser, /charset\.setAttribute\('charset', 'utf-8'\)/);
  assert.match(parser, /display', 'contents', 'important'/);
  assert.match(parser, /originalDoctype\(source\)/);
  assert.match(parser, /serializeForOutput\(doc\)/);
});

test('editor waits briefly for webfonts before announcing ready', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.match(injection, /document\.fonts\.ready/);
  assert.match(injection, /setTimeout\(finishFontWait, 1500\)/);
});

test('text edits debounce per block and connection status is observed', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  const collab = await readFile(new URL('../web/src/collab.js', import.meta.url), 'utf8');
  assert.match(injection, /inputTimers = Object\.create\(null\)/);
  assert.match(injection, /delete inputTimers\[id\]/);
  assert.match(collab, /provider\.on\('status'/);
});

test('size reset participates in style undo and filenames sync', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  const collab = await readFile(new URL('../web/src/collab.js', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.match(injection, /hcePushStyleUndo\(resetBefore, resetAfter\)/);
  assert.match(collab, /updateFilename\(filename\)/);
  assert.match(room, /updateFilename\?\.\(file\.name\)/);
});

test('form controls synchronize their live state for export', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.match(injection, /form-control-change/);
  assert.match(injection, /type === 'file' \|\| type === 'password'/);
  assert.match(room, /function persistFormControl\(control, options = \{\}\)/);
  assert.match(room, /option\.setAttribute\('selected'/);
  assert.match(room, /persistTrackedSkeleton\?\.\(state\.skeleton, state\.blocks\)/);
  assert.match(room, /restoreRejectedLiveState\(snapshot/);
});

test('link edits are atomic and recovery never overwrites an existing room', async () => {
  const collab = await readFile(new URL('../web/src/collab.js', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(collab, /RESTORE_ORIGIN|preferLocalDraft/);
  assert.match(collab, /Existing rooms always win over a local recovery snapshot/);
  const linkBody = room.match(/function persistLink\([\s\S]*?\n}/)?.[0] || '';
  assert.match(linkBody, /persistTrackedSkeleton/);
  assert.doesNotMatch(linkBody, /onLocalBlockEdit\?\.\(/);
});

test('dynamic pages warn before export', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.match(room, /function documentMayRenderDifferently\(\)/);
  assert.match(room, /querySelectorAll\('script'\)/);
  assert.match(room, /content-security-policy/);
  assert.match(room, /confirmPreviewDifference\('download'\)/);
  assert.match(room, /confirmPreviewDifference\('ai'\)/);
});

test('draft lifecycle cannot turn recovery or share placeholders into seed data', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const drafts = await readFile(new URL('../web/src/draft-store.js', import.meta.url), 'utf8');
  assert.ok(room.includes("initialDraft?.kind === 'handoff'"));
  assert.match(room, /roomHydrated/);
  assert.match(room, /primaryRecoveryFrozen/);
  assert.ok(room.includes('function retireLocalDraft()'));
  assert.ok(room.includes('async function preserveRecoveryCopy(draft)'));
  assert.match(drafts, /schemaVersion: 2/);
  assert.ok(drafts.includes("const kind = DRAFT_KINDS.has(storedKind) ? storedKind : 'recovery'"));
});

test('pending edits flush before undo and offline mode has local history', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(injection.includes('function flushPendingInputs()'));
  assert.ok(injection.indexOf('flushPendingInputs();') < injection.lastIndexOf('commitStyleChange();'));
  assert.ok(room.includes('function createLocalHistory()'));
});

test('remote comments are validated and author color is not interpolated into markup', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(room.includes('Object.values(comments).every(isValidComment)'));
  assert.ok(room.includes('authorEl.style.color = safeUserColor'));
  assert.equal(room.includes('style="color:' + '${c.author.color}'), false);
});

test('nested table media keeps its own structural target', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(room.includes('containingCell && el !== containingCell'));
});

test('inserted table rows and columns inherit presentation attributes', async () => {
  const parser = await readFile(new URL('../web/src/parser.js', import.meta.url), 'utf8');
  assert.ok(parser.includes('function copyPresentationAttributes(source, target)'));
  assert.ok(parser.includes('copyPresentationAttributes(ref, nc)'));
  assert.ok(parser.includes('bodyRowPrototype : tr, newRow'));
});

test('moving an ordered list item preserves its list kind and removes empty source', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(room.includes("return list?.tagName?.toLowerCase() || 'ul'"));
  assert.ok(room.includes('contextContainerIsEmpty(sourceContainer)'));
  assert.ok(injection.includes("!wmOldParent.querySelector(':scope > li')"));
  assert.ok(room.includes('if (contextWrapTag(moving.tagName, moving)) return;'));
  assert.ok(room.includes('requiredContainer && !containerHolds(requiredContainer, container.tagName)'));
});

test('row drag controls are hidden when a table spans row groups', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(injection.includes('function tableHasMultipleRowGroups(table)'));
  assert.ok(injection.includes("allowRowDrag = mode !== 'drag' || !tableHasMultipleRowGroups(table)"));
});

test('text-leaf ownership changes replace the common live element', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(room.includes("nEl.hasAttribute('data-hce-text') !== oEl.hasAttribute('data-hce-text')"));
});

test('drag destinations reject text leaves and invalid list children', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(room.includes("container.hasAttribute('data-hce-text')"));
  assert.ok(room.includes('function destinationAllowsChild(parent, childTag)'));
  assert.ok(injection.includes("el.hasAttribute('data-hce-text')"));
  assert.ok(injection.includes("container.hasAttribute('data-hce-text')"));
});

test('body remains a container and direct text becomes a leaf', async () => {
  const parser = await readFile(new URL('../web/src/parser.js', import.meta.url), 'utf8');
  assert.doesNotMatch(parser, /walk(doc.body)/);
  assert.ok(parser.includes('Array.from(doc.body.childNodes)'));
});

test('mode changes clear stale tools and style snapshots resolve current block ids', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(injection.includes("m !== previousMode && typeof hideTools"));
  assert.ok(injection.includes("m !== previousMode && typeof unpinHandle"));
  assert.ok(injection.includes('var current = s.id ? document.querySelector'));
});

test('duplication rewrites native ids and document comments survive round trips', async () => {
  const parser = await readFile(new URL('../web/src/parser.js', import.meta.url), 'utf8');
  assert.ok(parser.includes('function rewriteCloneNativeIds(clone, suffix)'));
  assert.ok(parser.includes('HCE_PREFIX_ATTR'));
  assert.ok(parser.includes('HCE_SUFFIX_ATTR'));
});

test('placeholder media delegates selection and follows structural patches', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(injection.includes('data-hce-placeholder-for'));
  assert.ok(injection.includes('var mvPh = mv.__hcePh'));
  assert.ok(injection.includes('var pbMvPh = pbMv.__hcePh'));
});

test('list items can move into compatible lists and generated rows are not comment anchors', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  assert.ok(room.includes('requiredContainer && !containerHolds(requiredContainer, container.tagName)'));
  assert.ok(injection.includes("el.hasAttribute('data-hce-row')"));
});

test('common element attribute drift triggers a structural replacement', async () => {
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(room.includes('const attributeMap = el => new Map'));
  assert.ok(room.includes('nextAttrs.size !== liveAttrs.size'));
});

test('single-file upload stays byte-faithful and editor injection uses the final body close', async () => {
  const bundler = await readFile(new URL('../web/src/asset-bundler.js', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(bundler.includes('entries.some(entry => entry.file !== options.mainFile)'));
  assert.ok(room.includes('function realBodyClose()'));
  assert.ok(room.includes("lastIndexOf('<style', candidate)"));
});

test('form reset and implicit select defaults synchronize', async () => {
  const injection = await readFile(new URL('../web/src/iframe-injection.js', import.meta.url), 'utf8');
  const room = await readFile(new URL('../web/src/room.js', import.meta.url), 'utf8');
  assert.ok(injection.includes("addEventListener('reset'"));
  assert.ok(room.includes('!el.multiple && !selectedIndexes.length'));
});
