// Temporary handoff storage between the landing/guide page and room.html.
// IndexedDB avoids sessionStorage's ~5 MiB per-origin ceiling.
const {
  MAX_DOCUMENT_BYTES, MAX_COMMENTS, MAX_COMMENTS_TOTAL_BYTES,
  commentsByteLength, draftPayloadByteLength, utf8ByteLength,
} = await import('./capacity.js' + new URL(import.meta.url).search);

const DB_NAME = 'hce-local-drafts';
const DB_VERSION = 2;
const STORE_NAME = 'drafts';
const META_STORE_NAME = 'draft-meta';
const LEGACY_HTML_PREFIX = 'hce-init-html-';
const LEGACY_NAME_PREFIX = 'hce-init-name-';
const LEGACY_EXPIRY_PREFIX = 'hce-init-expiry-';
const LEGACY_COMMENTS_PREFIX = 'hce-init-comments-';
const LEGACY_SAFE_BYTES = 4 * 1024 * 1024;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 5;
const DRAFT_KINDS = new Set(['handoff', 'recovery']);

function storageError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function openDraftDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('Draft storage timed out')), 4000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: 'roomId' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error || new Error('Could not open draft storage'));
    request.onblocked = () => fail(new Error('Draft storage upgrade is blocked'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Draft storage transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Draft storage transaction aborted'));
  });
}

function saveLegacyDraft(draft) {
  sessionStorage.setItem(LEGACY_HTML_PREFIX + draft.roomId, draft.html);
  sessionStorage.setItem(LEGACY_NAME_PREFIX + draft.roomId, draft.filename);
  sessionStorage.setItem(LEGACY_EXPIRY_PREFIX + draft.roomId, String(draft.expiresAt || 0));
  sessionStorage.setItem(LEGACY_COMMENTS_PREFIX + draft.roomId, JSON.stringify(draft.comments || {}));
  sessionStorage.setItem(LEGACY_COMMENTS_PREFIX + draft.roomId + '-kind', draft.kind || '');
}

function loadLegacyDraft(roomId) {
  const htmlKey = LEGACY_HTML_PREFIX + roomId;
  const nameKey = LEGACY_NAME_PREFIX + roomId;
  const expiryKey = LEGACY_EXPIRY_PREFIX + roomId;
  const commentsKey = LEGACY_COMMENTS_PREFIX + roomId;
  const html = sessionStorage.getItem(htmlKey);
  if (html == null) return null;
  const expiresAt = Number(sessionStorage.getItem(expiryKey) || 0);
  if (expiresAt && expiresAt <= Date.now()) {
    sessionStorage.removeItem(htmlKey);
    sessionStorage.removeItem(nameKey);
    sessionStorage.removeItem(expiryKey);
    sessionStorage.removeItem(commentsKey);
    sessionStorage.removeItem(commentsKey + '-kind');
    return null;
  }
  const filename = sessionStorage.getItem(nameKey) || 'document.html';
  let comments = {};
  try { comments = JSON.parse(sessionStorage.getItem(commentsKey) || '{}'); } catch {}
  const storedKind = sessionStorage.getItem(LEGACY_COMMENTS_PREFIX + roomId + '-kind');
  // Untyped legacy records may also be an old room autosave. Conservatively
  // treat them as recovery instead of granting stale content seed authority.
  const kind = DRAFT_KINDS.has(storedKind) ? storedKind : 'recovery';
  return { roomId, html, filename, comments, kind, createdAt: Date.now(), storage: 'sessionStorage' };
}

export async function saveDraft({ roomId, html, filename, comments, editorState, kind = 'recovery' }) {
  if (!DRAFT_KINDS.has(kind)) throw storageError('INVALID_DRAFT', 'Unknown draft kind');
  const byteLength = utf8ByteLength(html);
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw storageError('DOCUMENT_TOO_LARGE', 'Document exceeds the local draft capacity');
  }
  if (Object.keys(comments || {}).length > MAX_COMMENTS ||
      commentsByteLength(comments) > MAX_COMMENTS_TOTAL_BYTES) {
    throw storageError('COMMENTS_TOO_LARGE', 'Comments exceed the local draft capacity');
  }
  const payloadBytes = draftPayloadByteLength({ html, comments, editorState });
  // Offline recovery may include compact skeleton + blocks in addition to the
  // reconstructed HTML. Bound the stored clone to a small multiple of the live
  // collaboration document to avoid unexpected origin-storage growth.
  if (payloadBytes > Math.floor(MAX_DOCUMENT_BYTES * 2.5) + MAX_COMMENTS_TOTAL_BYTES) {
    throw storageError('DRAFT_TOO_LARGE', 'Local recovery draft exceeds capacity');
  }
  const createdAt = Date.now();
  const draft = {
    roomId, html, filename: filename || 'document.html', comments: comments || {}, kind,
    editorState: editorState || null, byteLength, payloadBytes, createdAt,
    expiresAt: createdAt + DRAFT_TTL_MS, schemaVersion: 2,
  };
  let db;
  try {
    db = await openDraftDB();
    const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE_NAME);
    store.put(draft);
    metaStore.put({ roomId, createdAt, expiresAt: draft.expiresAt });
    // Metadata is tiny; never clone every stored 12 MiB HTML document merely
    // to enforce TTL/count cleanup.
    const allRequest = metaStore.getAll();
    allRequest.onsuccess = () => {
      const metadata = (allRequest.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      metadata.forEach((item, index) => {
        if ((item.expiresAt || 0) < createdAt || index >= MAX_DRAFTS) {
          store.delete(item.roomId);
          metaStore.delete(item.roomId);
        }
      });
    };
    await transactionDone(transaction);
    if (byteLength <= LEGACY_SAFE_BYTES) {
      try { saveLegacyDraft(draft); } catch {}
    }
    return 'indexedDB';
  } catch (idbError) {
    // Small files keep working in older/private browser contexts. Large files
    // will fail clearly here rather than navigating to an empty room.
    if (byteLength > LEGACY_SAFE_BYTES) {
      throw storageError('STORAGE_UNAVAILABLE', 'Large-file storage is unavailable in this browser', idbError);
    }
    try {
      saveLegacyDraft(draft);
      return 'sessionStorage';
    } catch {
      throw storageError('QUOTA_EXCEEDED', 'Browser storage quota was exceeded', idbError);
    }
  } finally {
    db?.close();
  }
}

export async function loadDraft(roomId) {
  let db;
  try {
    db = await openDraftDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(roomId);
    const draft = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read draft'));
    });
    await transactionDone(transaction);
    if (draft && (!draft.expiresAt || draft.expiresAt > Date.now())) {
      // v1 records predate the explicit kind. An editorState can only have
      // come from room autosave; a plain HTML record came from upload/guide.
      if (draft.schemaVersion >= 2 && !DRAFT_KINDS.has(draft.kind)) {
        db.close();
        db = await openDraftDB();
        const cleanup = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
        cleanup.objectStore(STORE_NAME).delete(roomId);
        cleanup.objectStore(META_STORE_NAME).delete(roomId);
        await transactionDone(cleanup);
        return null;
      }
      const kind = DRAFT_KINDS.has(draft.kind) ? draft.kind : 'recovery';
      return { ...draft, kind, storage: 'indexedDB' };
    }
    if (draft) {
      db.close();
      db = await openDraftDB();
      const cleanup = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      cleanup.objectStore(STORE_NAME).delete(roomId);
      cleanup.objectStore(META_STORE_NAME).delete(roomId);
      await transactionDone(cleanup);
      try {
        sessionStorage.removeItem(LEGACY_HTML_PREFIX + roomId);
        sessionStorage.removeItem(LEGACY_NAME_PREFIX + roomId);
        sessionStorage.removeItem(LEGACY_EXPIRY_PREFIX + roomId);
        sessionStorage.removeItem(LEGACY_COMMENTS_PREFIX + roomId);
        sessionStorage.removeItem(LEGACY_COMMENTS_PREFIX + roomId + '-kind');
      } catch {}
      return null;
    }
  } catch {
    // Fall through to legacy storage for rooms created by previous versions.
  } finally {
    db?.close();
  }
  try {
    return loadLegacyDraft(roomId);
  } catch {
    return null;
  }
}

export async function deleteDraft(roomId) {
  try {
    sessionStorage.removeItem(LEGACY_HTML_PREFIX + roomId);
    sessionStorage.removeItem(LEGACY_NAME_PREFIX + roomId);
    sessionStorage.removeItem(LEGACY_EXPIRY_PREFIX + roomId);
    sessionStorage.removeItem(LEGACY_COMMENTS_PREFIX + roomId);
    sessionStorage.removeItem(LEGACY_COMMENTS_PREFIX + roomId + '-kind');
  } catch {}
  let db;
  try {
    db = await openDraftDB();
    const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
    transaction.objectStore(STORE_NAME).delete(roomId);
    transaction.objectStore(META_STORE_NAME).delete(roomId);
    await transactionDone(transaction);
  } finally {
    db?.close();
  }
}
