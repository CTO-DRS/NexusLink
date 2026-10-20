#!/usr/bin/env node
// M1.4 — batch-translates web + phone UI strings to fr/es/de/ru (6-language expansion). v2
// KEY INSIGHT (lesson §31): echo-key matching breaks — the model translates Arabic
// words INSIDE mixed code+Arabic keys. Fix: INDEXED payloads ("0".."N-1") — index keys
// are immune to translation drift.
// Resumable: progress per (surface,lang) in scripts/i18n-progress-*.json
// Usage: node scripts/translate-batch-lang.mjs [--budget 500] [--only fr,es] [--only-surface web|phone] [--batch 60]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const budgetArg = process.argv.indexOf("--budget")
const BUDGET = budgetArg > -1 ? Number(process.argv[budgetArg + 1] || 500) * 1000 : Infinity
const onlyArg = process.argv.indexOf("--only")
const ONLY_LANGS = onlyArg > -1 ? process.argv[onlyArg + 1].split(",").map((s) => s.trim()) : null
const onlySurfArg = process.argv.indexOf("--only-surface")
const ONLY_SURFACE = onlySurfArg > -1 ? process.argv[onlySurfArg + 1] : null
const batchArg = process.argv.indexOf("--batch")
const BATCH = batchArg > -1 ? Number(process.argv[batchArg + 1] || 60) : 60
const T0 = Date.now()

const LANGS = [
  { code: "fr", name: "French", sysName: "Français" },
  { code: "es", name: "Spanish", sysName: "Español" },
  { code: "de", name: "German", sysName: "Deutsch" },
  { code: "ru", name: "Russian", sysName: "Русский" },
]

const webMap = JSON.parse(readFileSync("src/lib/ar-en-map.json", "utf8"))
const webKeys = Object.keys(webMap).filter((k) => /[\u0600-\u06FF]/.test(k))
// phone: NESTED easy_localization json (lesson: ar.json has 27 sections, not flat) — flatten to dotted keys
function flattenObj(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object") flattenObj(v, key, out)
    else if (typeof v === "string") out[key] = v
  }
  return out
}
function unflattenObj(flat) {
  const out = {}
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split(".")
    let cur = out
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = v
  }
  return out
}
const phoneFlat = flattenObj(JSON.parse(readFileSync("nexuslink_mobile/assets/translations/ar.json", "utf8")))
const phoneEntries = Object.entries(phoneFlat).filter(([, v]) => /[\u0600-\u06FF]/.test(v))

/** @typedef {{id: string, lang: object, surface: "web"|"phone", keys: string[], done: Record<string,string>, prog: string, out: string}} Job */

/** @type {Job[]} */
const jobs = []
for (const L of LANGS) {
  if (ONLY_LANGS && !ONLY_LANGS.includes(L.code)) continue
  if (!ONLY_SURFACE || ONLY_SURFACE === "web") {
    const prog = `scripts/i18n-progress-web-${L.code}.json`
    const out = `src/lib/i18n/${L.code}.json`
    // UNION (lesson §31): manual merges land in the OUT file — never let progress clobber them
    const done = existsSync(prog) ? JSON.parse(readFileSync(prog, "utf8")) : {}
    if (existsSync(out)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(out, "utf8")))) if (!(k in done)) done[k] = v
    jobs.push({ id: `web|${L.code}`, lang: L, surface: "web", keys: webKeys, done, prog, out })
  }
  if (!ONLY_SURFACE || ONLY_SURFACE === "phone") {
    const prog = `scripts/i18n-progress-phone-${L.code}.json`
    const out = `nexuslink_mobile/assets/translations/${L.code}.json`
    const done = existsSync(prog) ? JSON.parse(readFileSync(prog, "utf8")) : {}
    // phone out is NESTED — flatten before union (progress stores dotted keys)
    if (existsSync(out)) {
      const flat = flattenObj(JSON.parse(readFileSync(out, "utf8")))
      for (const [k, v] of Object.entries(flat)) if (!(k in done) && /[\u0600-\u06FF]/.test(v)) done[k] = v
    }
    jobs.push({ id: `phone|${L.code}`, lang: L, surface: "phone", keys: phoneEntries.map(([k]) => k), done, prog, out })
  }
}

const rem = (j) => j.keys.filter((k) => !j.done[k]).length
console.log(`jobs=${jobs.length} [${jobs.map((j) => `${j.id}:${rem(j)}`).join(" ")}]`)
mkdirSync("src/lib/i18n", { recursive: true })

const sys = (L) => `You translate UI strings of a LAN device-management app (AirDroid-like) from Arabic to ${L.name} (${L.sysName}).
Input: a JSON array of numbered Arabic UI strings. Output ONLY a JSON object mapping each index ("0","1",...) to its ${L.name} translation.
Rules:
- Keep placeholders EXACTLY: \${anything}, %s, %d, {x}, $1.
- Keep technical terms as-is: mDNS, QR, E2E, AES-GCM, X25519, Wi-Fi, PIN, SMS, DND, RAM, MB, GB, KB, ms, RTP, WebSocket, SSH, WoL, HMAC, CRC, APK, DCIM, RSSI, VBR, P2P, TTL.
- Keep numbers, symbols, ×, °, :, /, parentheses structure. No quotes/explanations around values.
- Prefer concise product-UI ${L.name} (buttons/labels short, sentences natural).
- "/ث" as speed unit = "/s". Time: "د"=min, "س"=h, "ث"=s.
- Fragments stay fragments. Code-mixed strings: translate only the Arabic words.`

function parseObj(text) {
  const a = text.indexOf("{")
  const b = text.lastIndexOf("}")
  if (a < 0 || b < 0) return null
  try {
    return JSON.parse(text.slice(a, b + 1))
  } catch {
    return null
  }
}

let zai

/** one batch unit pulled from the shared round-robin queue */
async function translateBatch(job, batch) {
  const srcs = job.surface === "web" ? batch.map((k) => k) : batch.map((k) => phoneFlat[k])
  let ok = false
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      const tB = Date.now()
      const r = await zai.chat.completions.create({
        messages: [
          { role: "system", content: sys(job.lang) },
          { role: "user", content: JSON.stringify(srcs) },
        ],
        temperature: 0.1,
      })
      const obj = parseObj(r.choices[0]?.message?.content || "")
      if (obj) {
        let n = 0
        for (let b = 0; b < batch.length; b++) {
          const v = obj[String(b)]
          if (typeof v === "string" && v.trim()) {
            job.done[batch[b]] = v
            n++
          }
        }
        if (n > 0) {
          ok = true
          console.log(`[${job.id}] +${n}/${batch.length} ${((Date.now() - tB) / 1000).toFixed(1)}s -> ${Object.keys(job.done).length}/${job.keys.length}`)
        }
      }
    } catch (e) {
      const backoff = [15000, 30000, 45000][Math.min(attempt, 2)]
      console.error(`[${job.id}] batch attempt${attempt} error: ${(e?.message || e).slice(0, 110)} — backoff ${backoff / 1000}s`)
      if (Date.now() - T0 > BUDGET) return false
      await new Promise((res) => setTimeout(res, backoff))
    }
  }
  if (!ok) {
    console.error(`[${job.id}] batch SKIPPED (clean retry next run) — cooling 20s`)
    await new Promise((res) => setTimeout(res, 20000))
  }
  writeFileSync(job.prog, JSON.stringify(job.done))
  return ok
}

function writeAndLog(job) {
  writeFileSync(job.prog, JSON.stringify(job.done))
  // phone output: nested structure with FULL key parity (non-Arabic values copied as-is)
  if (job.surface === "phone") {
    const full = { ...phoneFlat }
    for (const [k, v] of Object.entries(job.done)) full[k] = v
    writeFileSync(job.out, JSON.stringify(unflattenObj(full), null, 2) + "\n")
  } else {
    writeFileSync(job.out, JSON.stringify(job.done))
  }
  console.log(`[${job.id}] WROTE ${job.out} (${Object.keys(job.done).length}/${job.keys.length})`)
}

async function main() {
  zai = await ZAI.create()
  // Shared ROUND-ROBIN queue: phone first (small, finishes fast), then web —
  // interleaved batch units so every language advances each cycle.
  // Two workers pull from the cursor (lesson: 4 workers trip 429; sequential starves siblings).
  const queue = []
  {
    // true interleave: cycle one unit per job per round (phone jobs first finish early)
    const perJob = jobs.map((job) => {
      const todo = job.keys.filter((k) => !job.done[k])
      const units = []
      for (let i = 0; i < todo.length; i += BATCH) units.push({ job, batch: todo.slice(i, i + BATCH) })
      return units
    })
    perJob.sort((a, b) => a.length - b.length) // shortest jobs drain first into the cycle
    const maxLen = Math.max(0, ...perJob.map((u) => u.length))
    for (let r = 0; r < maxLen; r++) for (const units of perJob) if (r < units.length) queue.push(units[r])
  }
  console.log(`queue units=${queue.length} (workers=2)`)
  let cursor = 0
  const worker = async () => {
    while (Date.now() - T0 <= BUDGET) {
      if (cursor >= queue.length) return
      const unit = queue[cursor++]
      await translateBatch(unit.job, unit.batch)
    }
  }
  await Promise.all([worker(), worker()])
  for (const job of jobs) writeAndLog(job)
  console.log(`ALL DONE in ${((Date.now() - T0) / 1000).toFixed(0)}s`)
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
