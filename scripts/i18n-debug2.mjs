#!/usr/bin/env node
// debug2: reproduce the failing batch (45 keys, full sys prompt)
import { readFileSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const webMap = JSON.parse(readFileSync("src/lib/ar-en-map.json", "utf8"))
const keys = Object.keys(webMap).filter((k) => /[\u0600-\u06FF]/.test(k))
const todo = keys // same order as the script
const batch = todo.slice(0, 45)
const payload = batch.reduce((o, k) => ((o[k] = k), o), {})
console.log("payload bytes:", JSON.stringify(payload).length)

const SYS = `You translate UI strings of a LAN device-management app (AirDroid-like) from Arabic to French (Français).
Rules:
- Output ONLY a JSON object mapping each input string to its French translation.
- Keep placeholders EXACTLY: \${anything}, %s, %d, {x}, $1.
- Keep technical terms/units as-is: mDNS, QR, E2E, AES-GCM, X25519, Wi-Fi, PIN, SMS, DND, RAM, MB, GB, KB, ms, RTP, WebSocket, SSH, WoL, HMAC, CRC, APK, DCIM, RSSI, VBR, P2P, TTL.
- Keep numbers, symbols, ×, °, :, /, parentheses structure. Do not add quotes or explanations.
- Prefer concise product-UI French (buttons/labels short, sentences natural).
- Speed unit "/ث" becomes "/s". Time: "د"=m/min, "س"=h, "ث"=s.
- If a string is a fragment, translate as a fragment. If a string looks like code/JSON fragments mixed with Arabic, translate only the Arabic words.`

const zai = await ZAI.create()
const t0 = Date.now()
const r = await zai.chat.completions.create({
  messages: [
    { role: "system", content: SYS },
    { role: "user", content: JSON.stringify(payload) },
  ],
  temperature: 0.1,
})
const raw = r.choices[0]?.message?.content || ""
console.log("elapsed:", ((Date.now() - t0) / 1000).toFixed(1), "s; response bytes:", raw.length)
const a = raw.indexOf("{")
const b = raw.lastIndexOf("}")
try {
  const obj = JSON.parse(raw.slice(a, b + 1))
  const okN = batch.filter((k) => typeof obj[k] === "string" && obj[k].trim()).length
  console.log("EXACT MATCH:", okN, "/", batch.length)
  console.log("first obj key (40):", JSON.stringify(Object.keys(obj)[0]?.slice(0, 40)))
  const firstReq = batch[0]
  console.log("first req key (40):", JSON.stringify(firstReq?.slice(0, 40)))
} catch (e) {
  console.log("PARSE FAIL:", e.message)
  console.log("RAW TAIL:", raw.slice(-300))
}
