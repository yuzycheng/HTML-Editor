import assert from 'node:assert/strict';
import test from 'node:test';

import { bundleFolderAssets } from '../web/src/asset-bundler.js';
import {
  compressImageBlob,
  estimatedImageDataUrlBytes,
  MIN_USEFUL_IMAGE_DATA_URL_BYTES,
} from '../web/src/image-compression.js';
import {
  MAX_DOCUMENT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_MEDIA_BYTES,
  MIB,
  utf8ByteLength,
} from '../web/src/capacity.js';

function fakeImageFile({ name = 'photo.jpg', type = 'image/jpeg', size }) {
  return { name, type, size };
}

async function withBrowserImageMocks(run, dimensions = { width: 6000, height: 4000 }) {
  const originals = {
    FileReader: globalThis.FileReader,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  let closeCalls = 0;

  class MockFileReader {
    readAsDataURL(blob) {
      const payloadLength = 4 * Math.ceil(blob.size / 3);
      this.result = `data:${blob.type};base64,${'A'.repeat(payloadLength)}`;
      queueMicrotask(() => this.onload?.());
    }
  }

  globalThis.FileReader = MockFileReader;
  globalThis.createImageBitmap = async () => ({
    ...dimensions,
    close() { closeCalls++; },
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return { fillRect() {}, drawImage() {} };
        },
        toBlob(callback, type, quality) {
          // Approximate a noisy photo: quality materially affects its encoded
          // size, while resizing reduces it in proportion to pixel count.
          const size = Math.max(1024, Math.round(this.width * this.height * 0.5 * quality));
          callback({ size, type });
        },
      };
    },
  };

  try {
    return await run(() => closeCalls);
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

test('an already-fitting image passes through even when its budget is below 48 KiB', async () => {
  await withBrowserImageMocks(async () => {
    const image = fakeImageFile({ type: 'image/png', size: 300 });
    const budget = estimatedImageDataUrlBytes(image.size);
    assert.ok(budget < MIN_USEFUL_IMAGE_DATA_URL_BYTES);

    const result = await compressImageBlob(image, { maxDataUrlBytes: budget });

    assert.equal(result.compressed, false);
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'));
    assert.ok(result.dataUrlBytes <= budget);
  });
});

test('a static photo larger than 5 MB is compressed into the requested inline-image budget', async () => {
  await withBrowserImageMocks(async getCloseCalls => {
    const photo = fakeImageFile({ size: 6 * MIB });
    assert.ok(photo.size > 5 * MIB);

    const result = await compressImageBlob(photo, { maxDataUrlBytes: MAX_INLINE_IMAGE_BYTES });

    assert.equal(result.compressed, true);
    assert.equal(result.type, 'image/webp');
    assert.ok(result.width <= 2560);
    assert.ok(result.height <= 2560);
    assert.ok(result.dataUrlBytes <= MAX_INLINE_IMAGE_BYTES);
    assert.equal(utf8ByteLength(result.dataUrl), result.dataUrlBytes);
    assert.equal(getCloseCalls(), 1);
  });
});

test('a single HTML file compresses an oversized embedded data image', async () => {
  await withBrowserImageMocks(async () => {
    const originalDOMParser = globalThis.DOMParser;
    const sourceDataUrl = `data:image/jpeg;base64,${'A'.repeat(96 * 1024)}`;
    const attributes = new Map([['src', sourceDataUrl]]);
    const image = {
      tagName: 'IMG',
      get attributes() {
        return Array.from(attributes, ([name, value]) => ({ name, value }));
      },
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, String(value)); },
    };
    const doc = {
      childNodes: null,
      getElementsByTagName: () => [image],
      querySelector: () => null,
      querySelectorAll(selector) {
        if (selector === '*') return [image];
        if (selector === 'img[src],video[src],audio[src],source[src],input[type="image"][src]') return [image];
        return [];
      },
      documentElement: {
        get outerHTML() { return `<html><head></head><body><img src="${image.getAttribute('src')}"></body></html>`; },
      },
    };
    globalThis.DOMParser = class { parseFromString() { return doc; } };
    const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    const maxImageBytes = 64 * 1024;

    try {
      const result = await bundleFolderAssets({
        html,
        mainFile: assetFile('index.html', 'text/html'),
        files: [],
        maxInlineBytes: 256 * 1024,
        maxImageBytes,
        maxDocumentBytes: 512 * 1024,
      });

      assert.equal(result.compressedEmbedded, 1);
      assert.equal(result.warnings.length, 0);
      assert.ok(image.getAttribute('src').startsWith('data:image/webp;base64,'));
      assert.ok(utf8ByteLength(image.getAttribute('src')) <= maxImageBytes);
      assert.notEqual(image.getAttribute('src'), sourceDataUrl);
    } finally {
      if (originalDOMParser === undefined) delete globalThis.DOMParser;
      else globalThis.DOMParser = originalDOMParser;
    }
  });
});

test('an oversized GIF is rejected with a structured animation-preserving reason', async () => {
  // Minimal parser-valid GIF structure with two image descriptors, padded to
  // represent the large animated uploads that must not become a still frame.
  const bytes = new Uint8Array(6 * MIB);
  bytes.set(new TextEncoder().encode('GIF89a'), 0);
  bytes[6] = 1;
  bytes[8] = 1;
  bytes[13] = 0x2c;
  bytes[23] = 2;
  bytes[24] = 0;
  bytes[25] = 0x2c;
  const gif = {
    name: 'animation.gif',
    type: 'image/gif',
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.slice().buffer; },
  };

  await assert.rejects(
    compressImageBlob(gif, { maxDataUrlBytes: MAX_INLINE_IMAGE_BYTES }),
    error => {
      assert.equal(error.code, 'ANIMATED_IMAGE_TOO_LARGE');
      assert.match(error.message, /animation/i);
      return true;
    },
  );
});

test('GIF MIME parameters do not bypass animation preservation', async () => {
  const bytes = new Uint8Array(6 * MIB);
  bytes.set(new TextEncoder().encode('GIF89a'), 0);
  bytes[6] = 1;
  bytes[8] = 1;
  bytes[13] = 0x2c;
  bytes[23] = 2;
  bytes[24] = 0;
  bytes[25] = 0x2c;
  const gif = {
    type: 'image/gif;charset=utf-8',
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.slice().buffer; },
  };

  await assert.rejects(
    compressImageBlob(gif, { maxDataUrlBytes: MAX_INLINE_IMAGE_BYTES }),
    error => error?.code === 'ANIMATED_IMAGE_TOO_LARGE',
  );
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

test('folder bundling does not exceed the 12 MB document budget', async () => {
  const originalDOMParser = globalThis.DOMParser;
  const prefix = '<html><body>';
  const suffix = '<img src="photo.png"></body></html>';
  const headroom = 256;
  const filler = 'x'.repeat(MAX_DOCUMENT_BYTES - utf8ByteLength(prefix + suffix) - headroom);
  const html = prefix + filler + suffix;
  const image = attributeElement({ src: 'photo.png' });

  globalThis.DOMParser = class {
    parseFromString() {
      return {
        getElementsByTagName: () => [],
        querySelector: () => null,
        querySelectorAll(selector) {
          if (selector === 'img[src],video[src],audio[src],source[src],input[type="image"][src]') return [image];
          return [];
        },
        documentElement: {
          get outerHTML() {
            return `${prefix}${filler}<img src="${image.getAttribute('src')}"></body></html>`;
          },
        },
      };
    }
  };

  const mainFile = assetFile('project/index.html', 'text/html');
  const photo = assetFile('project/photo.png', 'image/png', new Array(300).fill(42));
  try {
    assert.equal(utf8ByteLength(html), MAX_DOCUMENT_BYTES - headroom);
    const result = await bundleFolderAssets({
      html,
      mainFile,
      files: [mainFile, photo],
      maxInlineBytes: MAX_INLINE_MEDIA_BYTES,
      maxImageBytes: MAX_INLINE_IMAGE_BYTES,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
    });

    assert.ok(utf8ByteLength(result.html) <= MAX_DOCUMENT_BYTES);
    assert.match(result.html, /src="photo\.png"/);
    assert.equal(result.bundled.includes('project/photo.png'), false);
  } finally {
    if (originalDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = originalDOMParser;
  }
});
