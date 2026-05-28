// ─────────────────────────────────────────────────
//  collab.js  ·  Yjs + y-partykit integration
//
//  Y.Doc shape:
//    meta:     Y.Map { skeleton: string, filename: string }
//    blocks:   Y.Map<blockId, Y.Map { tag: string, text: Y.Text }>
//    comments: Y.Map<commentId, plain Comment object>
//
//  Awareness state per client:
//    { user: { id, name, color } }
// ─────────────────────────────────────────────────

import * as Y from 'https://esm.sh/yjs@13.6.20';
import YPartyKitProvider from 'https://esm.sh/y-partykit@0.0.32/provider';

// Decide which PartyKit host to talk to.
//
// Three deploy targets coexist:
//   1. Local dev    — partykit dev serves frontend + ws on localhost:1999
//   2. PartyKit URL — frontend + ws on html-collab-editor.yuzycheng.partykit.dev
//   3. GitHub Pages — frontend on yuzycheng.github.io, ws still has to go to
//                     the PartyKit deployment
//
// For (1) and (2) we use `location.host` (same-origin). For (3) and any
// future custom domain we hardcode the PartyKit prod URL.
const PARTYKIT_PROD = 'html-collab-editor.yuzycheng.partykit.dev';
const PARTYKIT_HOST = (() => {
  const h = location.hostname;
  const sameOrigin =
    h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
    /^192\.168\./.test(h) || /^10\./.test(h) ||
    h.endsWith('.partykit.dev');
  return sameOrigin ? location.host : PARTYKIT_PROD;
})();

export async function connectCollab(state, handlers) {
  const yDoc = new Y.Doc();
  const yMeta = yDoc.getMap('meta');
  const yBlocks = yDoc.getMap('blocks');
  const yComments = yDoc.getMap('comments');

  const provider = new YPartyKitProvider(PARTYKIT_HOST, state.roomId, yDoc, {
    party: 'main',
    connect: true,
  });

  provider.awareness.setLocalStateField('user', state.user);

  // Tag every routine local write with this origin. Observers use it
  // to ignore self-echo, and the UndoManager tracks only edits with
  // this origin so it doesn't try to undo remote collaborators.
  const LOCAL_ORIGIN = 'hce-local';

  // ── Undo manager: tracks our own edits across blocks/meta/comments ──
  const undoMgr = new Y.UndoManager([yBlocks, yMeta, yComments], {
    captureTimeout: 150,
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  // ── Awareness → users ────────────────────────
  const emitUsers = () => {
    const users = [];
    provider.awareness.getStates().forEach(s => {
      if (s.user) users.push(s.user);
    });
    handlers.onUsersChange?.(users);
  };
  provider.awareness.on('change', emitUsers);

  // ── Wait for initial sync ────────────────────
  await new Promise(resolve => {
    if (provider.synced) return resolve();
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    provider.once('synced', fin);
    setTimeout(fin, 4000);    // safety timeout for first connection
  });

  // ── Hydration ────────────────────────────────
  const docHasBlocks = yBlocks.size > 0;
  const docHasMeta = yMeta.has('skeleton');

  if (docHasMeta && docHasBlocks) {
    // Late joiner — adopt doc state
    state.skeleton = yMeta.get('skeleton');
    state.filename = yMeta.get('filename') || state.filename;
    state.blocks = [];
    yBlocks.forEach((blockMap, id) => {
      state.blocks.push({
        id,
        tag: blockMap.get('tag'),
        text: blockMap.get('text').toString(),
      });
    });
    handlers.onSkeletonChanged?.();
    document.getElementById('fname').textContent = state.filename;
  } else {
    // First user — push local state into doc
    yDoc.transact(() => {
      yMeta.set('skeleton', state.skeleton);
      yMeta.set('filename', state.filename);
      state.blocks.forEach(b => {
        const blockMap = new Y.Map();
        const ytext = new Y.Text();
        ytext.insert(0, b.text || '');
        blockMap.set('tag', b.tag);
        blockMap.set('text', ytext);
        yBlocks.set(b.id, blockMap);
      });
    });
  }

  // Hydrate comments from doc (for late joiners)
  yComments.forEach((c, id) => {
    state.comments[id] = c;
  });
  handlers.onCommentsChange?.();

  // ── Observe text changes deep inside blocks ──
  //
  // We deliberately recompute from yBlocks on every observed event rather
  // than relying on `event.target instanceof Y.Text`. That instanceof check
  // is brittle: an ESM import duplicated across modules (which happens with
  // CDN imports + dynamic import) makes `event.target` an instance of a
  // *different* Y.Text constructor than the one this module sees, so the
  // check silently returns false and the remote update is dropped on the
  // floor — the exact symptom of "the other side has to refresh to see my
  // edit". Structural read is bulletproof.
  //
  // Cost: O(n) blocks per remote transaction. Fine for v0.1 sizes.
  let lastSeenTexts = new Map();
  function snapshotAndDiff() {
    yBlocks.forEach((blockMap, id) => {
      const ytext = blockMap.get('text');
      if (!ytext) return;
      const next = ytext.toString();
      if (lastSeenTexts.get(id) !== next) {
        lastSeenTexts.set(id, next);
        handlers.onBlockTextChange?.(id, next);
      }
    });
    // Drop entries for removed blocks so stale strings don't accumulate.
    for (const id of Array.from(lastSeenTexts.keys())) {
      if (!yBlocks.has(id)) lastSeenTexts.delete(id);
    }
  }
  // Prime the diff baseline with whatever we just hydrated.
  yBlocks.forEach((bm, id) => {
    const yt = bm.get('text');
    if (yt) lastSeenTexts.set(id, yt.toString());
  });

  // ── Observe meta FIRST (skeleton) ─────────────
  //
  // Registration order matters here: when an undo runs, Yjs fires the
  // observers it registered in the order they were attached, all inside
  // the same transaction. We want the skeleton path to run BEFORE the
  // per-block diff, so we can:
  //   1. rebuild state.blocks from the freshly-restored yBlocks
  //   2. re-baseline lastSeenTexts so the upcoming yBlocks observer
  //      sees a clean slate (and doesn't spam stale block updates at
  //      an iframe that's just been told to fully re-render)
  // Skipping this caused the "blank screen / scroll jumps on undo"
  // instability.
  yMeta.observe((event, tx) => {
    if (tx.origin === LOCAL_ORIGIN) return;
    if (!event.keysChanged.has('skeleton')) return;
    state.skeleton = yMeta.get('skeleton');
    state.blocks = [];
    yBlocks.forEach((blockMap, id) => {
      state.blocks.push({
        id,
        tag: blockMap.get('tag'),
        text: blockMap.get('text').toString(),
      });
    });
    // Re-prime the diff baseline so the soon-to-fire yBlocks observer
    // doesn't generate spurious per-block updates against a moving
    // target. Anything still out of sync would be repaired by the full
    // re-render that onSkeletonChanged triggers downstream.
    lastSeenTexts.clear();
    yBlocks.forEach((bm, id) => {
      const yt = bm.get('text');
      if (yt) lastSeenTexts.set(id, yt.toString());
    });
    handlers.onSkeletonChanged?.();
  });

  // ── Observe text changes deep inside blocks ──
  yBlocks.observeDeep((events, tx) => {
    if (tx.origin === LOCAL_ORIGIN) return;
    snapshotAndDiff();
  });

  // ── Observe comments ─────────────────────────
  yComments.observe((event, tx) => {
    if (tx.origin === LOCAL_ORIGIN) return;
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'add' || change.action === 'update') {
        state.comments[key] = yComments.get(key);
      } else if (change.action === 'delete') {
        delete state.comments[key];
      }
    });
    handlers.onCommentsChange?.();
  });

  emitUsers();

  // ── Local-edit handlers (called by room.js) ─
  return {
    onLocalBlockEdit(id, text) {
      const blockMap = yBlocks.get(id);
      if (!blockMap) return;
      const ytext = blockMap.get('text');
      if (!ytext) return;
      const oldText = ytext.toString();
      if (oldText === text) return;

      // Smallest-diff splice. Compute common prefix/suffix and only
      // replace the middle that actually changed. This avoids briefly
      // emptying the Y.Text — which was previously letting remote
      // clients see a flash of empty content during edits, and in
      // bad timing, miss the follow-up insert entirely.
      let prefix = 0;
      const maxPrefix = Math.min(oldText.length, text.length);
      while (prefix < maxPrefix && oldText.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
      let suffix = 0;
      const maxSuffix = Math.min(oldText.length - prefix, text.length - prefix);
      while (
        suffix < maxSuffix &&
        oldText.charCodeAt(oldText.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
      ) suffix++;
      const removeLen = oldText.length - prefix - suffix;
      const insertStr = text.slice(prefix, text.length - suffix);

      yDoc.transact(() => {
        if (removeLen > 0) ytext.delete(prefix, removeLen);
        if (insertStr) ytext.insert(prefix, insertStr);
      }, LOCAL_ORIGIN);
      lastSeenTexts.set(id, text);
    },
    onLocalStructureChange(skeleton, blocks) {
      // Wholesale replace skeleton + blocks. Coarse but correct for v0.1.
      yDoc.transact(() => { /* tagged local origin below */
        yMeta.set('skeleton', skeleton);
        const keepIds = new Set(blocks.map(b => b.id));
        Array.from(yBlocks.keys()).forEach(id => {
          if (!keepIds.has(id)) {
            yBlocks.delete(id);
            lastSeenTexts.delete(id);
          }
        });
        blocks.forEach(b => {
          if (!yBlocks.has(b.id)) {
            const bm = new Y.Map();
            const yt = new Y.Text();
            yt.insert(0, b.text || '');
            bm.set('tag', b.tag);
            bm.set('text', yt);
            yBlocks.set(b.id, bm);
          } else {
            // ID reused after re-upload — refresh text/tag in place.
            const bm = yBlocks.get(b.id);
            const yt = bm.get('text');
            bm.set('tag', b.tag);
            const old = yt.toString();
            const next = b.text || '';
            if (old !== next) {
              yt.delete(0, old.length);
              yt.insert(0, next);
            }
          }
          lastSeenTexts.set(b.id, b.text || '');
        });
      }, LOCAL_ORIGIN);
    },
    onLocalCommentAdd(comment) {
      yDoc.transact(() => { yComments.set(comment.id, comment); }, LOCAL_ORIGIN);
    },
    onLocalCommentDelete(id) {
      yDoc.transact(() => { yComments.delete(id); }, LOCAL_ORIGIN);
    },
    updateUser(user) {
      provider.awareness.setLocalStateField('user', user);
    },
    undo() { undoMgr.undo(); },
    redo() { undoMgr.redo(); },
    canUndo() { return undoMgr.canUndo(); },
    canRedo() { return undoMgr.canRedo(); },
    // [ADDITION] Forcibly end the current capture window so the next
    // local edit becomes its own undo step (used after style changes).
    stopCapturing() { undoMgr.stopCapturing(); },
    // [ADDITION] Subscribe to stack-item-added — iframe uses this as the
    // authoritative "a Yjs action just happened" signal so its own
    // actionLog can stay in sync with the real Yjs stack.
    onYjsStackAdded(cb) {
      undoMgr.on('stack-item-added', (event) => {
        // event.type is 'undo' (new action) or 'redo' (after a redo)
        cb({ type: event.type });
      });
    },
    onYjsStackPopped(cb) {
      undoMgr.on('stack-item-popped', (event) => {
        cb({ type: event.type });
      });
    },
    onStackChange(cb) {
      undoMgr.on('stack-item-added', cb);
      undoMgr.on('stack-item-popped', cb);
      undoMgr.on('stack-cleared', cb);
    },
    disconnect() {
      provider.destroy();
    },
  };
}
