const LABELS = new Map([
  ['utf8', 'utf-8'], ['utf-8', 'utf-8'],
  ['gb2312', 'gb18030'], ['gbk', 'gb18030'], ['x-gbk', 'gb18030'], ['gb18030', 'gb18030'],
  ['big5', 'big5'], ['big5-hkscs', 'big5'],
  ['utf-16', 'utf-16le'], ['utf-16le', 'utf-16le'], ['utf-16be', 'utf-16be'],
]);

export function detectTextEncoding(bytes, kind = 'html') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return 'utf-8';
  if (data[0] === 0xff && data[1] === 0xfe) return 'utf-16le';
  if (data[0] === 0xfe && data[1] === 0xff) return 'utf-16be';
  let head = '';
  for (let i = 0; i < Math.min(data.length, 8192); i++) head += String.fromCharCode(data[i]);
  const match = kind === 'css'
    ? /^\s*@charset\s+["']([^"']+)["']/i.exec(head)
    : /<meta[^>]+charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(head)
      || /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i.exec(head);
  return LABELS.get((match?.[1] || '').toLowerCase()) || 'utf-8';
}

export function decodeBytes(bytes, kind = 'html') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const encoding = detectTextEncoding(data, kind);
  try { return { text: new TextDecoder(encoding).decode(data), encoding }; }
  catch { return { text: new TextDecoder('utf-8').decode(data), encoding: 'utf-8' }; }
}

export async function readTextFile(file, kind = 'html') {
  return decodeBytes(await file.arrayBuffer(), kind);
}
