const DEFAULT_MAX_DIMENSION = 2560;
const MIN_DIMENSION = 320;
export const MAX_IMAGE_SOURCE_BYTES = 64 * 1024 * 1024;
export const MIN_USEFUL_IMAGE_DATA_URL_BYTES = 48 * 1024;

const IMAGE_MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp',
};

export function estimatedImageDataUrlBytes(blobBytes, mimeType = '') {
  const headerBytes = String(mimeType || '').startsWith('image/')
    ? 'data:'.length + String(mimeType).length + ';base64,'.length
    : 64;
  return headerBytes + 4 * Math.ceil(Math.max(0, Number(blobBytes) || 0) / 3);
}

export function isInlineRasterImage(value) {
  return /^data:image\/(?:png|jpe?g|webp|avif|gif|bmp)(?:;|,)/i.test(String(value || '').trim());
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read compressed image'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const source = String(dataUrl || '');
  const comma = source.indexOf(',');
  if (comma < 0) throw new Error('Could not decode image data');
  const header = source.slice(0, comma);
  const payloadLength = source.length - comma - 1;
  let estimatedBytes;
  if (/;base64(?:;|$)/i.test(header)) {
    let padding = 0;
    if (source.endsWith('==')) padding = 2;
    else if (source.endsWith('=')) padding = 1;
    estimatedBytes = Math.max(0, Math.floor(payloadLength * 3 / 4) - padding);
  } else {
    // Percent-encoded data can only decode smaller than its source text.
    estimatedBytes = payloadLength;
  }
  if (estimatedBytes > MAX_IMAGE_SOURCE_BYTES) {
    const error = new Error('Image source is too large to decode safely');
    error.code = 'IMAGE_SOURCE_TOO_LARGE';
    throw error;
  }
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Could not decode image data');
  return response.blob();
}

async function loadImageSource(blob) {
  if (globalThis.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function mimeFromImageName(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').split(/[?#]/)[0]);
  return IMAGE_MIME_BY_EXT[(match?.[1] || '').toLowerCase()] || '';
}

function ascii(bytes, start, length) {
  let value = '';
  for (let index = start; index < Math.min(bytes.length, start + length); index++) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function includesAscii(bytes, needle) {
  if (!needle || bytes.length < needle.length) return false;
  outer: for (let start = 0; start <= bytes.length - needle.length; start++) {
    for (let index = 0; index < needle.length; index++) {
      if (bytes[start + index] !== needle.charCodeAt(index)) continue outer;
    }
    return true;
  }
  return false;
}

function gifAnimationState(bytes) {
  if (bytes.length < 13 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return null;
  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 0x07) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames > 1;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      offset++;
      while (offset < bytes.length) {
        const size = bytes[offset++];
        if (!size) break;
        offset += size;
      }
      if (offset > bytes.length) return null;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return null;
    frames++;
    if (frames > 1) return true;
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
    if (offset >= bytes.length) return null;
    offset++; // LZW minimum code size
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) break;
      offset += size;
    }
    if (offset > bytes.length) return null;
  }
  return null;
}

function webpAnimationState(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let offset = 12;
  let extendedAnimation = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    if (size < 0) return null;
    if (type === 'ANIM' || type === 'ANMF') return true;
    if (type === 'VP8X' && size >= 1 && offset + 8 < bytes.length) {
      extendedAnimation = !!(bytes[offset + 8] & 0x02);
    }
    offset += 8 + size + (size & 1);
  }
  return extendedAnimation;
}

async function animationState(blob, type) {
  if (type === 'image/gif') {
    return gifAnimationState(new Uint8Array(await blob.arrayBuffer()));
  }
  if (type === 'image/webp') {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer());
    return webpAnimationState(bytes);
  }
  if (type === 'image/avif') {
    const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer());
    // The AVIF image-sequence brand is `avis`; canvas export would otherwise
    // keep only one frame. This conservative check protects animated AVIFs.
    return includesAscii(bytes, 'avis');
  }
  return false;
}

function drawImage(source, width, height, fillWhite = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: !fillWhite });
  if (!context) throw new Error('Canvas is unavailable');
  if (fillWhite) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function bestCandidateAtSize(source, width, height, targetBytes, type, fallbackType) {
  let canvas = drawImage(source, width, height, type === 'image/jpeg');
  let smallest = null;
  let bestFit = null;
  let low = 0.34;
  let high = 0.92;
  for (let attempt = 0; attempt < 7; attempt++) {
    const quality = attempt === 0 ? high : (low + high) / 2;
    let blob = await canvasBlob(canvas, type, quality);
    // Some browsers return a PNG when the requested encoder is unavailable.
    // Treat a mismatched MIME as an unsupported encoder instead of running a
    // fake WebP quality search over the same PNG bytes.
    if (!blob || String(blob.type || '').toLowerCase() !== type) {
      type = fallbackType;
      canvas = drawImage(source, width, height, type === 'image/jpeg');
      blob = await canvasBlob(canvas, type, quality);
    }
    if (!blob || String(blob.type || '').toLowerCase() !== type) break;
    const bytes = estimatedImageDataUrlBytes(blob.size, blob.type);
    if (!smallest || bytes < smallest.bytes) smallest = { blob, bytes, quality, width, height };
    if (bytes <= targetBytes) {
      if (!bestFit || quality > bestFit.quality) bestFit = { blob, bytes, quality, width, height };
      low = quality;
    } else {
      high = quality;
    }
    if (type === 'image/png') break; // PNG ignores the quality argument.
  }
  return { bestFit, smallest };
}

export async function compressImageBlob(blob, options = {}) {
  const originalType = String(blob?.type || '').split(';', 1)[0].trim().toLowerCase();
  if (!blob || !originalType.startsWith('image/')) throw new Error('Not an image file');
  if (blob.size > MAX_IMAGE_SOURCE_BYTES) {
    const error = new Error('Image source is too large to decode safely');
    error.code = 'IMAGE_SOURCE_TOO_LARGE';
    throw error;
  }
  const targetBytes = Math.max(0, Number(options.maxDataUrlBytes) || 0);
  const originalBytes = estimatedImageDataUrlBytes(blob.size, originalType);
  if (/^image\/(?:png|jpe?g|webp|avif|gif|bmp)$/.test(originalType)) {
    // For very small remaining budgets the exact header matters, so verify the
    // real URL before deciding that a fitting icon needs recompression. For
    // larger over-budget photos, avoid allocating the extra Base64 copy.
    const shouldVerifyOriginal = originalBytes <= targetBytes ||
      (targetBytes < MIN_USEFUL_IMAGE_DATA_URL_BYTES && blob.size <= targetBytes);
    if (shouldVerifyOriginal) {
      const dataUrl = await blobToDataUrl(blob);
      const dataUrlBytes = new TextEncoder().encode(dataUrl).byteLength;
      if (dataUrlBytes <= targetBytes) {
        return { dataUrl, dataUrlBytes, compressed: false, originalBytes, type: originalType };
      }
    }
  }
  // The minimum only applies when re-encoding is required. A 1 KB icon must
  // still be accepted when the document has, for example, 20 KB left.
  if (targetBytes < MIN_USEFUL_IMAGE_DATA_URL_BYTES && options.allowTinyTarget !== true) {
    const error = new Error('Not enough document capacity for this image');
    error.code = 'IMAGE_CAPACITY_TOO_SMALL';
    throw error;
  }
  // Preserve animation instead of silently turning it into a still image.
  const animated = await animationState(blob, originalType);
  if (animated !== false && /image\/(?:gif|webp|avif)/.test(originalType)) {
    const error = new Error('Animated image cannot be compressed without losing animation');
    error.code = 'ANIMATED_IMAGE_TOO_LARGE';
    throw error;
  }

  const loaded = await loadImageSource(blob);
  try {
    if (!loaded.width || !loaded.height) throw new Error('Image has no dimensions');
    const maxDimension = Math.max(MIN_DIMENSION, Number(options.maxDimension) || DEFAULT_MAX_DIMENSION);
    const fallbackType = /image\/(?:png|gif|bmp)/.test(originalType) ? 'image/png' : 'image/jpeg';
    let scale = Math.min(1, maxDimension / Math.max(loaded.width, loaded.height));
    let smallest = null;
    for (let sizeAttempt = 0; sizeAttempt < 8; sizeAttempt++) {
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));
      const result = await bestCandidateAtSize(loaded.source, width, height, targetBytes, 'image/webp', fallbackType);
      if (result.bestFit) {
        const dataUrl = await blobToDataUrl(result.bestFit.blob);
        return {
          dataUrl,
          dataUrlBytes: new TextEncoder().encode(dataUrl).byteLength,
          compressed: true,
          originalBytes,
          width,
          height,
          type: result.bestFit.blob.type,
        };
      }
      if (result.smallest && (!smallest || result.smallest.bytes < smallest.bytes)) smallest = result.smallest;
      const ratio = result.smallest ? Math.sqrt(targetBytes / result.smallest.bytes) * 0.92 : 0.72;
      const nextScale = scale * Math.max(0.5, Math.min(0.8, ratio));
      const nextMax = Math.max(loaded.width * nextScale, loaded.height * nextScale);
      if (nextMax < MIN_DIMENSION && Math.max(width, height) <= MIN_DIMENSION) break;
      scale = Math.max(MIN_DIMENSION / Math.max(loaded.width, loaded.height), nextScale);
    }
    const error = new Error('Image could not be compressed enough');
    error.code = 'IMAGE_CANNOT_FIT';
    error.smallestBytes = smallest?.bytes || null;
    throw error;
  } finally {
    loaded.close();
  }
}

export async function compressImageFile(file, options = {}) {
  let source = file;
  if (source && !source.type) {
    const inferredType = mimeFromImageName(source.name || source._relPath);
    if (inferredType) {
      source = typeof source.slice === 'function'
        ? source.slice(0, source.size, inferredType)
        : new Blob([await source.arrayBuffer()], { type: inferredType });
    }
  }
  return compressImageBlob(source, options);
}

export async function compressImageDataUrl(dataUrl, options = {}) {
  if (!isInlineRasterImage(dataUrl)) return {
    dataUrl,
    dataUrlBytes: new TextEncoder().encode(String(dataUrl || '')).byteLength,
    compressed: false,
  };
  return compressImageBlob(await dataUrlToBlob(dataUrl), options);
}
