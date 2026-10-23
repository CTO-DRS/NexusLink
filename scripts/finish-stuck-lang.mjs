#!/usr/bin/env node
// LANG-CLOSE helper — finishes keys the batch generator kept skipping (code-fragment keys).
// Same system prompt + same union semantics as scripts/translate-batch-lang.mjs (§31.د.1):
// writes results into BOTH the progress file and the dict, so the generator's own
// writeAndLog stays consistent on any future run.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const LANGS = [
  { code: "es", name: "Spanish", sysName: "Español" },
  { code: "de", name: "German", sysName: "Deutsch" },
]

const webMap = JSON.parse(readFileSync("src/lib/ar-en-map.json", "utf8"))
const webKeys = Object.keys(webMap).filter((k) => /[\u0600-\u06FF]/.test(k))

const sys = (L) => `You translate UI strings of a LAN device-management app (AirDroid-like) from Arabic to ${L.name} (${L.sysName}).
Input: a JSON array of numbered Arabic UI strings. Output ONLY a JSON object mapping each index ("0","1",...) to its ${L.name} translation.
Rules:
- Keep placeholders EXACTLY: \${anything}, %s, %d, {x}, $1.
- Keep technical terms as-is: mDNS, QR, E2E, AES-GCM, X25519, Wi-Fi, PIN, SMS, DND, RAM, MB, GB, KB, ms, RTP, WebSocket, SSH, WoL, HMAC, CRC, APK, DCIM, RSSI, VBR, P2P, TTL.
- Keep numbers, symbols, ×, °, :, /, parentheses structure. No quotes/explanations around values.
- Prefer concise product-UI ${L.name} (buttons/labels short, sentences natural).
- "/ث" as speed unit = "/s". Time: "د"=min, "س"=h, "ث"=s.
- Fragments stay fragments. Code-mixed strings: translate only the Arabic words. Keep all code characters EXACTLY as-is.`

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

const zai = await ZAI.create()

for (const L of LANGS) {
  const progPath = `scripts/i18n-progress-web-${L.code}.json`
  const outPath = `src/lib/i18n/${L.code}.json`
  const prog = JSON.parse(readFileSync(progPath, "utf8"))
  const dict = JSON.parse(readFileSync(outPath, "utf8"))
  const missing = webKeys.filter((k) => !prog[k] && !dict[k])
  console.log(`[${L.code}] missing=${missing.length}`)
  for (const key of missing) {
    let ok = false
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      try {
        const r = await zai.chat.completions.create({
          messages: [
            { role: "system", content: sys(L) },
            { role: "user", content: JSON.stringify([key]) },
          ],
          temperature: 0.1,
        })
        const obj = parseObj(r.choices[0]?.message?.content || "")
        const v = obj?.["0"]
        if (typeof v === "string" && v.trim()) {
          prog[key] = v
          dict[key] = v
          ok = true
          console.log(`  OK (${attempt + 1}): ${key.slice(0, 40).replace(/\n/g, "\\n")} -> ${v.slice(0, 50)}`)
        }
      } catch (e) {
        if (attempt === 5) console.error(`  FAIL ${key.slice(0, 40).replace(/\n/g, "\\n")}: ${(e?.message || e).slice(0, 90)}`)
        await new Promise((res) => setTimeout(res, 8000))
      }
    }
    if (!ok) console.error(`  UNRESOLVED: ${JSON.stringify(key.slice(0, 60))}`)
  }
  writeFileSync(progPath, JSON.stringify(prog))
  writeFileSync(outPath, JSON.stringify(dict))
  console.log(`[${L.code}] WROTE ${outPath}`)
}
console.log("HELPER DONE")
