#!/usr/bin/env node
// NexusLink — P1 transfer benchmark (phone → PC over /api/fs/upload).
//
// Measures the current upload path (contract §8.2, v1: sequential PUTs with
// offsets, no hashing), so protocol v2 (parallel pieces + BLAKE3) can be compared
// against a fixed number on the same machine and network.
//
// Usage (against a running server, `next build && next start`, or the gateway):
//   node scripts/xfer-bench.mjs [--base http://127.0.0.1:3000] [--mb 256] [--chunk-mb 4] [--runs 3] [--pair <token>]
// Output: one JSON line per run + a summary {mbps_median, ...}. It verifies the
// stored file's sha256 equals the source, or exits 1.
//
// Honest limit: loopback measures server overhead (HTTP, disk, JS), not Wi-Fi.
// The real number (≥90% of the link) needs the device lab (G10).
import http from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BASE = opt("base", process.env.NEXUS_BASE || "http://127.0.0.1:3000")
const MB = Number(opt("mb", "256"))
const CHUNK = Math.round(Number(opt("chunk-mb", "4")) * 1024 * 1024)
const RUNS = Number(opt("runs", "3"))
const PAIR = opt("pair", process.env.NEXUS_PAIR || "")
const DEVICE = opt("device", "benchdev")
const DATA_ROOT = opt("data-root", "")

const agent = new http.Agent({ keepAlive: true, maxSockets: 8 })

function url(p, q = {}) {
  const u = new URL(p, BASE)
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v))
  if (PAIR) u.searchParams.set("pair", PAIR)
  return u
}

function request(method, u, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(u, { method, agent, headers }, (res) => {
      const parts = []
      res.on("data", (d) => parts.push(d))
      res.on("end", () => {
        const text = Buffer.concat(parts).toString("utf8")
        let json = null
        try { json = JSON.parse(text) } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text })
      })
    })
    req.on("error", reject)
    if (body) req.end(body)
    else req.end()
  })
}

const post = (p, obj) =>
  request("POST", url(p), Buffer.from(JSON.stringify(obj)), { "Content-Type": "application/json" })

async function runOnce(n, data, sha) {
  const name = `bench-${Date.now()}-${n}.bin`
  const init = await post("/api/fs/upload", {
    op: "init", deviceId: DEVICE, path: "/Downloads", name, size: data.length, chunkSize: CHUNK,
    taskId: `bench-${process.pid}-${Date.now()}-${n}`,
  })
  if (init.status !== 200 || !init.json?.ok) throw new Error(`init failed: ${init.status} ${init.text.slice(0, 200)}`)
  const { uploadId } = init.json
  const chunk = init.json.chunkSize || CHUNK
  const t0 = process.hrtime.bigint()
  let offset = 0
  let puts = 0
  while (offset < data.length) {
    const piece = data.subarray(offset, Math.min(offset + chunk, data.length))
    const r = await request("PUT", url("/api/fs/upload", { upload: uploadId, offset }), piece, {
      "Content-Type": "application/octet-stream", "Content-Length": piece.length,
    })
    if (r.status !== 200 || !r.json?.ok) throw new Error(`PUT @${offset} failed: ${r.status} ${r.text.slice(0, 200)}`)
    offset = r.json.received
    puts++
  }
  const done = await post("/api/fs/upload", { op: "complete", uploadId })
  const t1 = process.hrtime.bigint()
  if (done.status !== 200 || !done.json?.ok) throw new Error(`complete failed: ${done.status} ${done.text.slice(0, 200)}`)
  const secs = Number(t1 - t0) / 1e9
  const out = { run: n, bytes: data.length, chunk, puts, secs: +secs.toFixed(3), mbps: +((data.length / 1048576) / secs).toFixed(1) }
  // integrity: read the stored file directly when its path is known
  const dest = done.json.job?.destPath
  if (DATA_ROOT || dest) {
    const abs = path.isAbsolute(dest) ? dest : path.join(DATA_ROOT || process.cwd(), dest)
    try {
      const got = createHash("sha256").update(await readFile(abs)).digest("hex")
      out.integrity = got === sha ? "ok" : "MISMATCH"
    } catch {
      out.integrity = "unread"
    }
  }
  return out
}

const data = randomBytes(MB * 1024 * 1024)
const sha = createHash("sha256").update(data).digest("hex")
const results = []
for (let n = 1; n <= RUNS; n++) {
  const r = await runOnce(n, data, sha)
  console.log(JSON.stringify(r))
  results.push(r)
}
const sorted = results.map((r) => r.mbps).sort((a, b) => a - b)
const summary = {
  protocol: "v1-sequential",
  base: BASE,
  mb: MB,
  chunk_mb: CHUNK / 1048576,
  runs: RUNS,
  mbps_median: sorted[Math.floor(sorted.length / 2)],
  mbps_min: sorted[0],
  mbps_max: sorted[sorted.length - 1],
  integrity: results.every((r) => r.integrity !== "MISMATCH") ? "ok" : "MISMATCH",
}
console.log(JSON.stringify({ summary }))
agent.destroy()
if (summary.integrity !== "ok") process.exit(1)
