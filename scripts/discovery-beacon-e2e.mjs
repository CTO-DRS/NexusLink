#!/usr/bin/env node
// P1: discovery beacon E2E (zero dependencies, node built-ins only)
// ============================================================
// Starts the real gateway (mini-services/gateway/index.cjs) with a temporary
// state directory, then checks:
//   · /__gw/health declares a stable pcId (32 hex)
//   · a UDP probe gets a unicast reply carrying the same pcId and the actual port
//   · the payload holds only the whitelisted fields, and the pairing token never
//     appears in its bytes
//   · the pcId survives a restart (the phone matches on it after an IP change)
//   · the periodic announcement (multicast/broadcast) reaches a listener on the
//     same machine. Soft check: some CI runners block multicast.
//   · the disabled marker (LAN access closed) = silence, and NEXUSLINK_BEACON=0 = silence
// Usage: node scripts/discovery-beacon-e2e.mjs
import { spawn } from "node:child_process"
import dgram from "node:dgram"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const GW_SCRIPT = path.join(ROOT, "mini-services", "gateway", "index.cjs")
const GW_PORT = Number(process.env.P1_GW_PORT || 8391)
const BEACON_PORT = Number(process.env.P1_BEACON_PORT || 41299)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexuslink-p1-beacon-"))
const PAIR_FILE = path.join(TMP, "state", "pair-token.json")
const PC_ID_FILE = path.join(TMP, "state", "pc-id.json")
const ALLOWED = ["name", "pcId", "port", "proto", "v"]

let pass = 0
let fail = 0
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✅ ${name}`) } else { fail++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: GW_PORT, path: "/__gw/health" }, (res) => {
      let b = ""
      res.on("data", (d) => { b += d })
      res.on("end", () => { try { resolve(JSON.parse(b)) } catch { resolve(null) } })
    })
    req.on("error", () => resolve(null))
    req.setTimeout(2000, () => { req.destroy(); resolve(null) })
  })
}

let gw = null
let gwLog = ""
async function startGateway(extraEnv = {}) {
  gwLog = ""
  gw = spawn(process.execPath, [GW_SCRIPT], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(GW_PORT), GATEWAY_FALLBACK_PORT: String(GW_PORT + 1),
      REST_PORT: "1", NEXUSLINK_PAIR_FILE: PAIR_FILE,
      NEXUSLINK_POLICY_FILE: path.join(TMP, "no-policy.json"), NEXUSLINK_OEM_PRIVACY: "",
      NEXUSLINK_BEACON_PORT: String(BEACON_PORT), NEXUSLINK_BEACON_INTERVAL_MS: "300",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  gw.stdout.on("data", (d) => { gwLog += d })
  gw.stderr.on("data", (d) => { gwLog += d })
  for (let i = 0; i < 60; i++) {
    const h = await health()
    if (h) { await sleep(300); return h }
    await sleep(100)
  }
  return null
}
async function stopGateway() {
  if (!gw) return
  const p = new Promise((r) => gw.once("exit", r))
  gw.kill("SIGTERM")
  await Promise.race([p, sleep(3000)])
  gw = null
}

/** Unicast probe → the first reply (raw bytes + parsed), or null */
function probe(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4")
    let closed = false
    const done = (v) => { if (closed) return; closed = true; clearTimeout(t); try { s.close() } catch {}; resolve(v) }
    const t = setTimeout(() => done(null), timeoutMs)
    s.on("message", (msg) => {
      try { done({ raw: msg, j: JSON.parse(msg.toString("utf8")) }) } catch { done({ raw: msg, j: null }) }
    })
    s.bind(0, "127.0.0.1", () => {
      const m = Buffer.from(JSON.stringify({ proto: "nexuslink-beacon", v: 1, probe: true }))
      s.send(m, BEACON_PORT, "127.0.0.1")
      setTimeout(() => { if (!closed) s.send(m, BEACON_PORT, "127.0.0.1") }, 400)
    })
  })
}

/** Listen for the periodic announcement on the beacon port (reuseAddr beside the gateway) */
function listenAnnouncement(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true })
    const done = (v) => { clearTimeout(t); try { s.close() } catch {}; resolve(v) }
    const t = setTimeout(() => done(null), timeoutMs)
    s.on("error", () => done(null))
    s.on("message", (msg) => {
      try {
        const j = JSON.parse(msg.toString("utf8"))
        if (j && j.proto === "nexuslink-beacon" && !j.probe) done(j)
      } catch {}
    })
    s.bind(BEACON_PORT, () => { try { s.addMembership("239.255.77.77") } catch {} })
  })
}

try {
  // 1) first run
  const h = await startGateway()
  ok("P1-0 البوابة أقلعت", !!h, gwLog.slice(-400))
  ok("P1-1 /__gw/health يعلن pcId ثابتًا (32 hex)", !!h && /^[a-f0-9]{32}$/.test(String(h.pcId)), JSON.stringify(h))
  ok("P1-2 pc-id.json محفوظ", fs.existsSync(PC_ID_FILE))
  const token = (() => { try { return JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")).token } catch { return null } })()
  ok("P1-3 رمز الاقتران موجود (المنارة لا تعمل إلا والوصول مفتوح)", !!token)

  const r = await probe()
  ok("P1-4 مسبار UDP يتلقى ردًا أحاديًا", !!(r && r.j), gwLog.slice(-400))
  if (r && r.j) {
    ok("P1-5 الرد يحمل pcId نفسه", r.j.pcId === h.pcId)
    ok("P1-6 الرد يحمل منفذ البوابة الفعلي", r.j.port === GW_PORT, String(r.j.port))
    ok("P1-7 الحقول حصرًا من القائمة البيضاء", JSON.stringify(Object.keys(r.j).sort()) === JSON.stringify(ALLOWED), Object.keys(r.j).join(","))
    ok("P1-8 الرمز لا يظهر أبدًا في بايتات المنارة", !!token && !r.raw.includes(Buffer.from(token)))
  }

  const ann = await listenAnnouncement()
  if (ann) ok("P1-9 الإعلان الدوري (بث/متعدد) يصل", ann.pcId === h.pcId)
  else console.log("⚠️ P1-9 لم يصل الإعلان الدوري على هذا المشغّل (البث/المتعدد محجوب غالبًا) — فحص ليّن")

  // 2) restart → same pcId
  await stopGateway()
  const h2 = await startGateway()
  ok("P1-10 pcId ثابت بعد إعادة الإقلاع", !!h2 && h2.pcId === h.pcId)

  // 3) disabled marker → silence
  fs.writeFileSync(`${PAIR_FILE}.disabled`, "1")
  await sleep(200)
  ok("P1-11 الوصول معطّل = المنارة صامتة (لا رد على المسبار)", (await probe(1000)) === null)
  fs.rmSync(`${PAIR_FILE}.disabled`)
  await stopGateway()

  // 4) NEXUSLINK_BEACON=0 → silence
  await startGateway({ NEXUSLINK_BEACON: "0" })
  ok("P1-12 NEXUSLINK_BEACON=0 = لا منارة", (await probe(1000)) === null)
} catch (e) {
  fail++
  console.log(`❌ استثناء: ${e && e.stack || e}`)
} finally {
  await stopGateway()
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}

console.log(`\n${pass} ✅ / ${fail} ❌`)
process.exit(fail ? 1 : 0)
