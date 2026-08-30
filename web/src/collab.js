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

// These come from locally-vendored bundles (web/vendor/) resolved via the
// import map in room.html — NOT a CDN. Self-hosting avoids esm.sh hanging on
// networks where it's slow/blocked (corporate firewalls, mainland China),
// which would otherwise stall the whole editor on a loading spinner.
//
// IMPORTANT: y-partykit (and its y-protocols dependency) must share the EXACT
// SAME yjs module instance as the `Y` we import here. The provider bundle was
// built with yjs marked external, so its internal `import 'yjs'` resolves —
// via the same import map — to the one vendor/yjs.js the app uses. One yjs
// instance keeps UndoManager's constructor/scope checks valid; two instances
// give the "Yjs was already imported" breakage where late joiners can't undo.
// (Rebuild: esbuild entry-yjs.js --bundle --format=esm; provider with --external:yjs.)
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';

function compactSkeleton(skeleton) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  doc.querySelectorAll('[data-hce-text]').forEach(el => { el.textContent = ''; });
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function applyStylesToSkeleton(skeleton, styles) {
  const doc = new DOMParser().parseFromString(skeleton, 'text/html');
  styles.forEach(({ id, style }) => {
    const el = doc.querySelector(`[data-block-id="${id}"]`);
    if (!el) return;
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
  });
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

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
  const yStyles = yDoc.getMap('styles');
  let rejectedRemoteState = false;
  const rejectRemoteState = () => {
    if (rejectedRemoteState) return;
    rejectedRemoteState = true;
    provider.destroy();
    handlers.onCapacityExceeded?.();
  };

  const provider = new YPartyKitProvider(PARTYKIT_HOST, state.roomId, yDoc, {
    party: 'main',
    connect: true,
  });

  provider.awareness.setLocalStateField('user', state.user);

  // Tag every routine local write with this origin. Observers use it
  // to ignore self-echo, and the UndoManager tracks only edits with
  // this origin so it doesn't try to undo remote collaborators.
  const LOCAL_ORIGIN = 'hce-local';
  // Style changes persist the skeleton under their OWN origin. Like LOCAL it's
  // skipped by our observers (so it never triggers a local re-render that would
  // wipe the live styling), but unlike LOCAL it is NOT tracked by the
  // UndoManager — style undo/redo is owned by the iframe's own style history,
  // and we don't want a duplicate Yjs undo step for the same change.
  const STYLE_ORIGIN = 'hce-style';
  // ── Undo manager: tracks our own edits across blocks/meta/comments ──
  const undoMgr = new Y.UndoManager([yBlocks, yMeta, yComments, yStyles], {
    // Longer than the iframe's 180 ms input debounce so one continuous typing
    // session undoes as a natural unit. Structural/form actions explicitly call
    // stopCapturing(), so they remain isolated.
    captureTimeout: 750,
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
  provider.on('status', event => handlers.onConnectionStatus?.(event.status));
  provider.on('connection-error', () => handlers.onConnectionStatus?.('disconnected'));
  provider.on('synced', synced => {
    if (synced) handlers.onConnectionStatus?.('connected');
  });

  // ── Wait for initial sync ────────────────────
  // A timeout is a connection failure, not evidence that the room is empty.
  // Resolving here used to let a slow joiner publish its local demo document
  // into an existing room before the server snapshot arrived.
  try {
    await new Promise((resolve, reject) => {
      if (provider.synced) return resolve();
      let done = false;
      let timer;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      provider.once('synced', () => finish());
      // Initial documents can approach 12 MiB and y-partykit chunks updates
      // above 1 MB, so allow slow/mobile links enough time to complete.
      timer = setTimeout(() => finish(new Error('collaboration sync timed out')), 30000);
    });
  } catch (error) {
    provider.destroy();
    yDoc.destroy();
    throw error;
  }
  // Ignore transient disconnect callbacks emitted during initial handshake;
  // only the fully-returned collaboration object represents a hydrated room.
  handlers.onConnectionStatus?.('connected');

  // ── Hydration ────────────────────────────────
  const docHasMeta = yMeta.has('skeleton');

  if (docHasMeta) {
      // Existing rooms always win over a local recovery snapshot. Automatically
      // overwriting an LWW skeleton would erase collaborators' work whenever
      // both sides changed while this client was offline. room.js keeps the
      // recovery copy locally for an explicit/manual reconciliation flow.
      state.skeleton = yMeta.get('skeleton');
      state.filename = yMeta.get('filename') || state.filename;
      state.blocks = [];
      state.comments = {};
      yBlocks.forEach((blockMap, id) => {
        state.blocks.push({
          id,
          tag: blockMap.get('tag'),
          text: blockMap.get('text').toString(),
        });
      });
      const hydratedStyles = [];
      yStyles.forEach((style, id) => hydratedStyles.push({ id, style }));
      if (hydratedStyles.length) state.skeleton = applyStylesToSkeleton(state.skeleton, hydratedStyles);
      document.getElementById('fname').textContent = state.filename;
  } else if (state.canSeedCollab) {
    // First user — push local state into doc
    yDoc.transact(() => {
      yMeta.set('skeleton', compactSkeleton(state.skeleton));
      yMeta.set('filename', state.filename);
      state.blocks.forEach(b => {
        const blockMap = new Y.Map();
        const ytext = new Y.Text();
        ytext.insert(0, b.text || '');
        blockMap.set('tag', b.tag);
        blockMap.set('text', ytext);
        yBlocks.set(b.id, blockMap);
      });
      Object.entries(state.comments || {}).forEach(([id, comment]) => {
        yComments.set(id, comment);
      });
    });
  } else {
    provider.destroy();
    yDoc.destroy();
    throw new Error('room has no collaborative document');
  }

  // Hydrate comments from doc (for late joiners)
  yComments.forEach((c, id) => {
    state.comments[id] = c;
  });
  if (handlers.validateState && !handlers.validateState()) {
    provider.destroy();
    yDoc.destroy();
    throw new Error('collaborative document exceeds capacity');
  }
  if (docHasMeta) handlers.onSkeletonChanged?.();
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
    const changes = [];
    yBlocks.forEach((blockMap, id) => {
      const ytext = blockMap.get('text');
      if (!ytext) return;
      const next = ytext.toString();
      if (lastSeenTexts.get(id) !== next) {
        changes.push({ id, text: next });
      }
    });
    if (changes.length && handlers.validateRemoteTextChanges &&
        !handlers.validateRemoteTextChanges(changes)) {
      rejectRemoteState();
      return;
    }
    changes.forEach(({ id, text }) => {
      lastSeenTexts.set(id, text);
      handlers.onBlockTextChange?.(id, text);
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
    if (tx.origin === LOCAL_ORIGIN || tx.origin === STYLE_ORIGIN) return;
    if (event.keysChanged.has('filename')) {
      state.filename = yMeta.get('filename') || state.filename;
      const filenameEl = document.getElementById('fname');
      if (filenameEl) filenameEl.textContent = state.filename;
      handlers.onFilenameChanged?.(state.filename);
    }
    if (!event.keysChanged.has('skeleton')) return;
    const nextSkeleton = yMeta.get('skeleton');
    // Never blank the document. If an undo deleted the skeleton key (this
    // happens when the key was first *created* by a tracked transaction, so
    // its inverse is a deletion), yMeta.get returns undefined. Keep whatever
    // is on screen and bail — "no more to undo" must leave the page put, not
    // render a literal "undefined" body.
    if (nextSkeleton == null || nextSkeleton === '') return;
    let candidateSkeleton = nextSkeleton;
    const currentStyles = [];
    yStyles.forEach((style, id) => currentStyles.push({ id, style }));
    if (currentStyles.length) candidateSkeleton = applyStylesToSkeleton(candidateSkeleton, currentStyles);
    const candidateBlocks = [];
    yBlocks.forEach((blockMap, id) => {
      candidateBlocks.push({
        id,
        tag: blockMap.get('tag'),
        text: blockMap.get('text').toString(),
      });
    });
    if (handlers.validateRemoteStructure &&
        !handlers.validateRemoteStructure(candidateSkeleton, candidateBlocks)) {
      rejectRemoteState();
      return;
    }
    state.skeleton = candidateSkeleton;
    state.blocks = candidateBlocks;
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
    const candidateComments = {};
    yComments.forEach((comment, id) => { candidateComments[id] = comment; });
    if (handlers.validateRemoteComments && !handlers.validateRemoteComments(candidateComments)) {
      rejectRemoteState();
      return;
    }
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'add' || change.action === 'update') {
        state.comments[key] = yComments.get(key);
      } else if (change.action === 'delete') {
        delete state.comments[key];
      }
    });
    handlers.onCommentsChange?.();
  });

  yStyles.observe((event, tx) => {
    if (tx.origin === STYLE_ORIGIN) return;
    const styles = [];
    event.changes.keys.forEach((change, id) => {
      // A structural transaction embeds current styles in the skeleton and
      // clears patch entries. Ignore those deletions so we do not erase styles
      // from the freshly-applied skeleton on remote clients. Explicit clearing
      // is represented by an empty string value instead.
      if (change.action !== 'delete') styles.push({ id, style: yStyles.get(id) || '' });
    });
    if (styles.length && handlers.onStylesChange?.(styles) === false) rejectRemoteState();
  });

  emitUsers();

  // ── Local-edit handlers (called by room.js) ─
  return {
    // A freshly-seeded room has not yet acknowledged durable persistence. The
    // caller keeps its IndexedDB draft until a later visit adopts server state.
    seeded: !docHasMeta,
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
    // Persist a skeleton whose ONLY change is inline styling (colour, size,
    // bold…). Uses STYLE_ORIGIN so it survives refresh + reaches collaborators,
    // without a local re-render or a duplicate Yjs undo step.
    persistStyles(styles) {
      yDoc.transact(() => {
        styles.forEach(({ id, style }) => {
          yStyles.set(id, style || '');
        });
      }, STYLE_ORIGIN);
    },
    persistMetaSkeleton(skeleton) {
      yDoc.transact(() => { yMeta.set('skeleton', compactSkeleton(skeleton)); }, STYLE_ORIGIN);
    },
    persistTrackedSkeleton(skeleton, blocks) {
      // Attribute-only changes such as links belong in the chronological Yjs
      // history. Reuse the structural path so one undo restores href + text.
      this.stopCapturing();
      this.onLocalStructureChange(skeleton, blocks);
      this.stopCapturing();
    },
    onLocalStructureChange(skeleton, blocks) {
      const sharedSkeleton = compactSkeleton(skeleton);
      // Guarantee the skeleton key already exists from an UNtagged write. If
      // it were first created inside the tracked transaction below, undoing
      // that transaction would *delete* the key (its inverse), blanking the
      // doc to "undefined". Seeding it untagged first makes the tracked set
      // an UPDATE, so undo restores the prior value instead of removing it.
      if (!yMeta.has('skeleton')) {
        yDoc.transact(() => { yMeta.set('skeleton', sharedSkeleton); });
      }
      // Wholesale replace skeleton + blocks. Coarse but correct for v0.1.
      yDoc.transact(() => { /* tagged local origin below */
        yMeta.set('skeleton', sharedSkeleton);
        const keepIds = new Set(blocks.map(b => b.id));
        Array.from(yBlocks.keys()).forEach(id => {
          if (!keepIds.has(id)) {
            yBlocks.delete(id);
            lastSeenTexts.delete(id);
          }
        });
        Array.from(yStyles.keys()).forEach(id => {
          yStyles.delete(id);
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
    updateFilename(filename) {
      yDoc.transact(() => { yMeta.set('filename', filename); }, LOCAL_ORIGIN);
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
    isConnected() { return !!provider.wsconnected; },
    disconnect() {
      provider.destroy();
    },
  };
}
