// NexusLink — P1 transfer protocol v2 (contract §8.6): index-addressed pieces in parallel.
//
// v1 (§8.2) uploads in sequence: each PUT waits for the one before it, so the round-trip
// time over Wi-Fi is added per piece. v2:
// · init {proto:2} → the file is pre-allocated to its full size, and the client sends ~4 pieces at once
// · PUT ?upload=&piece=i + header x-nexus-sha256 → verify the hash then write at i*pieceSize
// · a persisted record (.nexuspart.v2.json) of the received pieces → resume after the server restarts
// · complete {root} → root = sha256(digests of all pieces in index order). No second read of the file.
//
// Why SHA-256 and not BLAKE3 (as the roadmap said): BLAKE3 in JS (@noble/hashes) measured
// 27MB/s on the arm64 sandbox, slower than v1 itself, while native SHA-256 (node:crypto)
// measured 314MB/s. Android computes SHA-256 natively too. The algorithm is in the "hash" field and can change later.
import path from "path"
import { promises as fs } from "fs"
import { createHash } from "crypto"

export const V2_DEFAULT_PIECE = 4 * 1024 * 1024
export const V2_MIN_PIECE = 1024 * 1024
export const V2_MAX_PIECE = 8 * 1024 * 1024
export const V2_MAX_INFLIGHT = 8
export const V2_HASH = "sha256"

export interface V2State {
  pieceSize: number
  pieces: number
  have: Uint8Array // 0/1 per piece
  digests: (string | null)[] // hex for each received piece (to compute the root)
  metaAbs: string
  saving: Promise<void>
  dirty: boolean
}

export function clampPiece(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return V2_DEFAULT_PIECE
  return Math.min(V2_MAX_PIECE, Math.max(V2_MIN_PIECE, Math.floor(v)))
}

export function pieceCount(size: number, pieceSize: number): number {
  return Math.max(1, Math.ceil(size / pieceSize))
}

export function pieceLength(size: number, pieceSize: number, i: number): number {
  if (size === 0) return 0
  const start = i * pieceSize
  return Math.max(0, Math.min(pieceSize, size - start))
}

export function haveList(st: V2State): number[] {
  const out: number[] = []
  for (let i = 0; i < st.pieces; i++) if (st.have[i]) out.push(i)
  return out
}

export function receivedBytes(st: V2State, size: number): number {
  let n = 0
  for (let i = 0; i < st.pieces; i++) if (st.have[i]) n += pieceLength(size, st.pieceSize, i)
  return n
}

export function isComplete(st: V2State): boolean {
  for (let i = 0; i < st.pieces; i++) if (!st.have[i]) return false
  return true
}

export function rootHash(st: V2State): string {
  const h = createHash(V2_HASH)
  for (const d of st.digests) h.update(Buffer.from(d ?? "", "hex"))
  return h.digest("hex")
}

/** Load or create the v2 state. A record that does not match (size/piece) = start over. */
export async function openV2(partialAbs: string, size: number, pieceSize: number): Promise<V2State> {
  const metaAbs = `${partialAbs}.v2.json`
  const pieces = pieceCount(size, pieceSize)
  const st: V2State = {
    pieceSize, pieces, have: new Uint8Array(pieces), digests: new Array(pieces).fill(null),
    metaAbs, saving: Promise.resolve(), dirty: false,
  }
  let resumed = false
  try {
    const raw = JSON.parse(await fs.readFile(metaAbs, "utf8")) as {
      v?: number; size?: number; pieceSize?: number; digests?: (string | null)[]
    }
    const pst = await fs.stat(partialAbs)
    if (raw.v === 2 && raw.size === size && raw.pieceSize === pieceSize &&
        Array.isArray(raw.digests) && raw.digests.length === pieces && pst.size === size) {
      raw.digests.forEach((d, i) => {
        if (typeof d === "string" && /^[a-f0-9]{64}$/.test(d)) { st.have[i] = 1; st.digests[i] = d }
      })
      resumed = true
    }
  } catch { /* no record → new */ }
  if (!resumed) {
    await fs.mkdir(path.dirname(partialAbs), { recursive: true })
    const fh = await fs.open(partialAbs, "w")
    try { await fh.truncate(size) } finally { await fh.close() }
    await persist(st, size)
  }
  return st
}

/** Persist the record, serialized: one write at a time, the latest wins. */
export function persist(st: V2State, size: number): Promise<void> {
  st.dirty = true
  st.saving = st.saving.then(async () => {
    if (!st.dirty) return
    st.dirty = false
    const tmp = `${st.metaAbs}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ v: 2, size, pieceSize: st.pieceSize, digests: st.digests }))
    await fs.rename(tmp, st.metaAbs)
  }).catch(() => { /* the next write retries */ })
  return st.saving
}

export type PieceResult =
  | { ok: true; dup: boolean }
  | { ok: false; status: number; error: string; code: string }

/** Write a piece after verifying its index, length and hash. Idempotent: a duplicate piece = success without writing. */
export async function writePiece(
  st: V2State, partialAbs: string, size: number, i: number, body: Buffer, claimed: string | null,
): Promise<PieceResult> {
  if (!Number.isInteger(i) || i < 0 || i >= st.pieces) {
    return { ok: false, status: 400, code: "bad_index", error: "رقم القطعة خارج المدى" }
  }
  const want = pieceLength(size, st.pieceSize, i)
  if (body.length !== want) {
    return { ok: false, status: 400, code: "bad_length", error: `طول القطعة ${body.length} والمتوقع ${want}` }
  }
  const digest = createHash(V2_HASH).update(body).digest("hex")
  if (!claimed || claimed.toLowerCase() !== digest) {
    return { ok: false, status: 422, code: "hash_mismatch", error: "هاش القطعة لا يطابق — أعد إرسالها" }
  }
  if (st.have[i]) return { ok: true, dup: true }
  const fh = await fs.open(partialAbs, "r+")
  try {
    let off = 0
    while (off < body.length) {
      const { bytesWritten } = await fh.write(body, off, body.length - off, i * st.pieceSize + off)
      off += bytesWritten
    }
  } finally {
    await fh.close()
  }
  st.have[i] = 1
  st.digests[i] = digest
  void persist(st, size)
  return { ok: true, dup: false }
}

export async function dropV2(st: V2State | undefined, partialAbs: string): Promise<void> {
  const meta = st?.metaAbs ?? `${partialAbs}.v2.json`
  if (st) await st.saving
  await fs.rm(meta, { force: true }).catch(() => {})
  await fs.rm(`${meta}.tmp`, { force: true }).catch(() => {})
}
