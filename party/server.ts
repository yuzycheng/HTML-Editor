// ─────────────────────────────────────────────────
//  PartyKit server  ·  one Durable Object per room.
//  y-partykit handles the Yjs sync protocol over WebSocket.
//  Doc state persists via snapshot to room storage.
// ─────────────────────────────────────────────────

import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import { applyUpdate, encodeStateAsUpdate, Doc } from "yjs";
import * as decoding from "lib0/decoding";

// Client updates above 1 MB are sent as y-partykit batches. Keep a little
// headroom above the 12 MiB document policy for Yjs metadata while rejecting
// accidental oversized payloads before they are assembled in the room isolate.
const MAX_SYNC_BATCH_BYTES = 20 * 1024 * 1024;
const BATCH_PREFIX = "y-pk-batch#";
const MAX_ROOM_STATE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_CHUNKS = 64;
const MAX_AWARENESS_MESSAGE_BYTES = 64 * 1024;
const PERSIST_OPTIONS = { persist: { mode: "snapshot" as const } };

export default class CollabServer implements Party.Server {
  private readonly batchBytes = new WeakMap<Party.Connection, number>();
  private readonly batchParts = new WeakMap<Party.Connection, Uint8Array[]>();
  private readonly batchExpected = new WeakMap<Party.Connection, { id: string; count: number; size: number }>();
  private docPromise: ReturnType<typeof unstable_getYDoc> | null = null;

  constructor(readonly room: Party.Room) {}

  private async getSharedDoc() {
    // unstable_getYDoc itself has no in-flight de-duplication. Serializing the
    // first load avoids two concurrent handshakes creating different docs that
    // write the same storage. Once resolved, y-partykit's module cache owns it.
    if (!this.docPromise) this.docPromise = unstable_getYDoc(this.room, PERSIST_OPTIONS);
    const pending = this.docPromise;
    try { return await pending; }
    finally { if (this.docPromise === pending) this.docPromise = null; }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    let guardedDoc: Awaited<ReturnType<typeof unstable_getYDoc>> | null = null;
    const updateWouldOverflow = (message: Uint8Array) => {
      try {
        if (!guardedDoc) return true;
        const decoder = decoding.createDecoder(message);
        if (decoding.readVarUint(decoder) !== 0) {
          // Presence is ephemeral UI metadata, never document content. Keep it
          // tiny to prevent one client from amplifying megabytes to every peer.
          if (message.byteLength > MAX_AWARENESS_MESSAGE_BYTES) return true;
          const controlled = (guardedDoc as any).conns?.get(conn) as Set<number> | undefined;
          return !!controlled && controlled.size >= 4;
        }
        const syncType = decoding.readVarUint(decoder);
        if (syncType !== 1 && syncType !== 2) return false; // step1 has no update
        const update = decoding.readVarUint8Array(decoder);
        const probe = new Doc({ gc: false });
        applyUpdate(probe, encodeStateAsUpdate(guardedDoc));
        applyUpdate(probe, update);
        const tooLarge = encodeStateAsUpdate(probe).byteLength > MAX_ROOM_STATE_BYTES;
        probe.destroy();
        return tooLarge;
      } catch {
        return true;
      }
    };
    conn.addEventListener("message", (event: any) => {
      const data = event.data;
      // The guard is registered synchronously, before y-partykit's listener.
      // Fail closed if a client races the async persisted-document load.
      if (!guardedDoc) {
        event.stopImmediatePropagation?.();
        conn.close(1013, "Collaborative room is initializing");
        return;
      }
      const directBytes = typeof data === "string"
        ? new TextEncoder().encode(data).byteLength
        : (data?.byteLength || 0);
      let declaredBytes = 0;
      if (typeof data === "string" && data.startsWith(BATCH_PREFIX)) {
        try {
          const marker = JSON.parse(data.slice(BATCH_PREFIX.length));
          if (marker.type === "start") {
            const count = Number(marker.count);
            const size = Number(marker.size);
            if (this.batchExpected.has(conn) || !Number.isInteger(count) || count < 1 || count > MAX_BATCH_CHUNKS ||
                !Number.isSafeInteger(size) || size < 1 || size > MAX_SYNC_BATCH_BYTES || typeof marker.id !== "string") {
              throw new Error("invalid batch start");
            }
            declaredBytes = size;
            this.batchBytes.set(conn, 0);
            this.batchParts.set(conn, []);
            this.batchExpected.set(conn, { id: marker.id, count, size });
          } else if (marker.type === "end") {
            const parts = this.batchParts.get(conn) || [];
            const expected = this.batchExpected.get(conn);
            if (!expected || marker.id !== expected.id || marker.count !== expected.count || marker.size !== expected.size ||
                parts.length !== expected.count) throw new Error("invalid batch end");
            const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
            let offset = 0;
            for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
            if (updateWouldOverflow(bytes)) declaredBytes = MAX_SYNC_BATCH_BYTES + 1;
            this.batchBytes.delete(conn);
            this.batchParts.delete(conn);
            this.batchExpected.delete(conn);
          }
        } catch {
          declaredBytes = MAX_SYNC_BATCH_BYTES + 1;
        }
      }
      const pending = this.batchBytes.get(conn);
      if (typeof data === "string" && pending != null && !data.startsWith(BATCH_PREFIX)) {
        event.stopImmediatePropagation?.();
        this.batchBytes.delete(conn);
        this.batchParts.delete(conn);
        this.batchExpected.delete(conn);
        conn.close(1009, "Invalid collaboration batch");
        return;
      }
      const accumulated = typeof data !== "string" && pending != null ? pending + directBytes : pending || 0;
      if (pending != null && typeof data !== "string") {
        this.batchBytes.set(conn, accumulated);
        const parts = this.batchParts.get(conn);
        if (parts && parts.length >= MAX_BATCH_CHUNKS) declaredBytes = MAX_SYNC_BATCH_BYTES + 1;
        else parts?.push(new Uint8Array(data));
      }
      const directOverflow = typeof data !== "string" && pending == null && updateWouldOverflow(new Uint8Array(data));
      if (directBytes > MAX_SYNC_BATCH_BYTES || declaredBytes > MAX_SYNC_BATCH_BYTES || accumulated > MAX_SYNC_BATCH_BYTES || directOverflow) {
        event.stopImmediatePropagation?.();
        this.batchBytes.delete(conn);
        this.batchParts.delete(conn);
        this.batchExpected.delete(conn);
        conn.close(1009, "Collaborative document is too large");
      }
    });
    // Load through one in-flight promise. unstable_getYDoc installs this exact
    // instance in y-partykit's module cache, so the later onConnect call binds
    // its protocol listener to the same document the guard validates.
    guardedDoc = await this.getSharedDoc();
    if (encodeStateAsUpdate(guardedDoc).byteLength > MAX_ROOM_STATE_BYTES) {
      conn.close(1009, "Collaborative room is too large");
      return;
    }
    return onConnect(conn, this.room, PERSIST_OPTIONS);
  }
}

CollabServer satisfies Party.Worker;
