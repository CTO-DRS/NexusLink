#!/usr/bin/env node
// P1 — transfer protocol v2 E2E (contract §8.6) against the built server (next build).
// Boots .next/standalone/server.js on a local port with a temporary copy of the DB
// (the original is never touched), or tests a running server via BASE_URL.
// Checks:
//  1. init {proto:2} → v:2 with pieceSize/pieces/have/hash
//  2. out-of-order parallel pieces + a duplicate piece (idempotent)
//  3. wrong hash → 422 hash_mismatch, and the piece is not recorded
//  4. wrong length / index out of range → 400
//  5. v1 PUT (offset) on a v2 session → 400 v2_session
//  6. complete before every piece → 400 incomplete
//  7. resume: re-init with the same taskId → have = the pieces received
//  8. wrong root → 422, correct root → 200, and the stored file matches the source byte for byte
//  9. the v2 record is deleted after completion
// 10. v1 still works (init without proto → v:1, offset upload, complete)
// 11. abort deletes the partial file and the record
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const PORT = Number(process.env.PORT_CHECK ?? 3918)
let BASE = process.env.BASE_URL ?? ""
let child = null
let serverCwd = ROOT
let pass = 0
let failN = 0

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✓ ${name}`) }
  else { failN++; console.error(`✗ ${name} ${extra}`); process.exitCode = 1 }
}

async function waitUp(url, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status > 0) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function boot() {
  const server = path.join(ROOT, ".next/standalone/server.js")
  if (!fs.existsSync(server)) throw new Error("no .next/standalone/server.js — run bun run build first")
  const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1" }
  if (!env.DATABASE_URL) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nl-xfer2-"))
    const dst = path.join(tmp, "check.db")
    const src = path.join(ROOT, "db/custom.db")
    if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    env.DATABASE_URL = `file:${dst}`
  }
  serverCwd = path.dirname(server)
  child = spawn(process.execPath, [server], { env, cwd: serverCwd, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout.on("data", (d) => { log += d })
  child.stderr.on("data", (d) => { log += d })
  BASE = `http://127.0.0.1:${PORT}`
  if (!(await waitUp(`${BASE}/api/tools/ping`, 60000))) {
    console.error(log.slice(-3000))
    throw new Error("server did not start within 60 seconds")
  }
}

const sha = (b) => createHash("sha256").update(b).digest("hex")
const post = async (obj) => {
  const r = await fetch(`${BASE}/api/fs/upload`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj),
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const putPiece = async (id, i, body, hash = sha(body)) => {
  const r = await fetch(`${BASE}/api/fs/upload?upload=${id}&piece=${i}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-nexus-sha256": hash }, body,
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

async function main() {
  if (!BASE) await boot()
  const PIECE = 1024 * 1024
  const size = 5 * PIECE + 12345 // 6 pieces, the last one partial
  const data = randomBytes(size)
  const pieces = (i) => data.subarray(i * PIECE, Math.min((i + 1) * PIECE, size))
  const taskId = `xfer2-${Date.now()}`
  const name = `${taskId}.bin`
  const dev = "xfer2dev"

  // 1
  let init = await post({ op: "init", proto: 2, pieceSize: PIECE, deviceId: dev, path: "/Downloads", name, size, taskId })
  check("init v2", init.status === 200 && init.json.v === 2 && init.json.pieceSize === PIECE &&
    init.json.pieces === 6 && Array.isArray(init.json.have) && init.json.have.length === 0 &&
    init.json.hash === "sha256", JSON.stringify(init.json))
  const id = init.json.uploadId

  // 2 — out of order and in parallel (5, 1, 3 together) + duplicate
  const rs = await Promise.all([5, 1, 3].map((i) => putPiece(id, i, pieces(i))))
  check("parallel out-of-order pieces", rs.every((r) => r.status === 200 && r.json.ok))
  const dup = await putPiece(id, 3, pieces(3))
  check("duplicate piece idempotent", dup.status === 200 && dup.json.dup === true)

  // 3
  const bad = await putPiece(id, 0, pieces(0), sha(Buffer.from("not this")))
  check("wrong hash → 422", bad.status === 422 && bad.json.code === "hash_mismatch")

  // 4
  const short = await putPiece(id, 0, pieces(0).subarray(0, 100))
  check("wrong length → 400", short.status === 400 && short.json.code === "bad_length")
  const oob = await putPiece(id, 99, pieces(0))
  check("index out of range → 400", oob.status === 400 && oob.json.code === "bad_index")

  // 5
  const v1put = await fetch(`${BASE}/api/fs/upload?upload=${id}&offset=0`, { method: "PUT", body: pieces(0) })
  check("v1 PUT on a v2 session → 400", v1put.status === 400)

  // 6
  const early = await post({ op: "complete", uploadId: id, root: "00" })
  check("complete before every piece → 400 incomplete", early.status === 400 && early.json.code === "incomplete")

  // 7 — resume with the same taskId
  init = await post({ op: "init", proto: 2, pieceSize: PIECE, deviceId: dev, path: "/Downloads", name, size, taskId })
  const have = (init.json.have || []).slice().sort()
  check("resume returns the received pieces", init.json.uploadId === id && JSON.stringify(have) === "[1,3,5]", JSON.stringify(init.json.have))
  check("received counts only the recorded pieces",
    init.json.received === pieces(1).length + pieces(3).length + pieces(5).length)

  for (const i of [0, 2, 4]) await putPiece(id, i, pieces(i))

  // 8
  const digests = Buffer.concat(Array.from({ length: 6 }, (_, i) => createHash("sha256").update(pieces(i)).digest()))
  const root = sha(digests)
  const wrong = await post({ op: "complete", uploadId: id, root: sha(Buffer.from("x")) })
  check("wrong root → 422", wrong.status === 422 && wrong.json.code === "root_mismatch")
  const done = await post({ op: "complete", uploadId: id, root })
  check("correct root → done", done.status === 200 && done.json.ok && done.json.job?.status === "done", JSON.stringify(done.json))
  const dest = done.json.job?.destPath
  const abs = dest && (path.isAbsolute(dest) ? dest : path.join(serverCwd, dest))
  let got = null
  try { got = fs.readFileSync(abs) } catch { /* unreadable */ }
  check("stored file matches the source", got !== null && got.length === size && sha(got) === sha(data), String(abs))

  // 9
  check("v2 record deleted after completion", abs && !fs.existsSync(`${path.join(path.dirname(abs), name)}.nexuspart.v2.json`))

  // 10 — v1 unchanged
  const small = randomBytes(3 * 1024 * 1024 + 7)
  const i1 = await post({ op: "init", deviceId: dev, path: "/Downloads", name: `v1-${name}`, size: small.length })
  check("init without proto → v1", i1.status === 200 && i1.json.v === 1)
  let off = 0
  while (off < small.length) {
    const part = small.subarray(off, off + i1.json.chunkSize)
    const r = await fetch(`${BASE}/api/fs/upload?upload=${i1.json.uploadId}&offset=${off}`, { method: "PUT", body: part })
    const j = await r.json()
    if (!j.ok) break
    off = j.received
  }
  const d1 = await post({ op: "complete", uploadId: i1.json.uploadId })
  check("v1 complete", d1.status === 200 && d1.json.ok && off === small.length)

  // 11 — abort
  const ia = await post({ op: "init", proto: 2, pieceSize: PIECE, deviceId: dev, path: "/Downloads", name: `ab-${name}`, size: PIECE * 2 })
  await putPiece(ia.json.uploadId, 0, randomBytes(PIECE))
  const partial = abs && path.join(path.dirname(abs), `ab-${name}.nexuspart`)
  const existedBefore = partial && fs.existsSync(partial) && fs.existsSync(`${partial}.v2.json`)
  await post({ op: "abort", uploadId: ia.json.uploadId })
  check("abort deletes the partial file and the record", existedBefore && !fs.existsSync(partial) && !fs.existsSync(`${partial}.v2.json`))

  console.log(`\n${pass}/${pass + failN} passed`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => { if (child) child.kill() })
