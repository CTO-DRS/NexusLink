#!/usr/bin/env node
// Batch-translates extracted Arabic UI strings to English using z-ai-web-dev-sdk.
// Resumable: keeps progress in scripts/ar-en-progress.json, final map -> src/lib/ar-en-map.json
// Usage: node scripts/translate-batch.mjs [--budget 100]  (budget = seconds, then save & exit)
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const budgetArg = process.argv.indexOf("--budget")
const BUDGET = budgetArg > -1 ? Number(process.argv[budgetArg + 1] || 100) : Infinity
const T0 = Date.now()

const SRC = "scripts/ar-strings.json"
const PROG = "scripts/ar-en-progress.json"
const OUT = "src/lib/ar-en-map.json"

const { strings, attrs } = JSON.parse(readFileSync(SRC, "utf8"))
const all = [...new Set([...strings, ...attrs])].filter((s) => /[\u0600-\u06FF]/.test(s))
let map = {}
if (existsSync(PROG)) map = JSON.parse(readFileSync(PROG, "utf8"))
const todo = all.filter((s) => !map[s])
console.log(`total=${all.length} done=${Object.keys(map).length} todo=${todo.length}`)

const BATCH = 45
const sys = `You translate UI strings of a LAN device-management app (AirDroid-like) from Arabic to English.
Rules:
- Output ONLY a JSON object mapping each input string to its English translation.
- Keep placeholders EXACTLY: \${anything}, %s, %d, {x}.
- Keep technical terms/units as-is: mDNS, QR, E2E, AES-GCM, X25519, Wi-Fi, PIN, SMS, DND, RAM, MB, GB, KB, ms, RTP, WebSocket, SSH, WoL, HMAC, CRC, APK, DCIM, RSSI, VBR, P2P, TTL.
- Keep numbers, symbols, ×, °, :, /, parentheses structure. Do not add quotes or explanations.
- Prefer concise product-UI English (buttons/labels short, sentences natural).
- "ث" as speed unit means "/s". Time: "د"=m, "س"=h, "ث"=s.
- If a string is a fragment, translate as a fragment.`

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

async function main() {
  const zai = await ZAI.create()
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() - T0 > BUDGET * 1000) {
      console.log(`budget reached — saving ${Object.keys(map).length}/${all.length}`)
      break
    }
    const batch = todo.slice(i, i + BATCH)
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const r = await zai.chat.completions.create({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: JSON.stringify(batch) },
          ],
          temperature: 0.1,
        })
        const obj = parseObj(r.choices[0]?.message?.content || "")
        if (obj) {
          let n = 0
          for (const k of batch) {
            const v = obj[k]
            if (typeof v === "string" && v.trim()) {
              map[k] = v
              n++
            }
          }
          if (n > 0) ok = true
        }
      } catch (e) {
        console.error("batch error", i, e?.message || e)
        await new Promise((res) => setTimeout(res, 1500))
      }
    }
    if (!ok) map[batch[0]] = map[batch[0]] || batch[0] // keep original on hard failure
    writeFileSync(PROG, JSON.stringify(map))
    console.log(`+${batch.length} -> ${Object.keys(map).length}/${all.length}`)
  }
  writeFileSync(PROG, JSON.stringify(map))
  writeFileSync(OUT, JSON.stringify(map, null, 0))
  const missing = all.filter((s) => !map[s])
  console.log(`DONE. mapped=${Object.keys(map).length} missing=${missing.length}`)
  if (missing.length) console.log(missing.slice(0, 20))
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
