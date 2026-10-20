#!/usr/bin/env node
// debug3: codepoint diff between requested key and returned key
import { readFileSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const webMap = JSON.parse(readFileSync("src/lib/ar-en-map.json", "utf8"))
const keys = Object.keys(webMap).filter((k) => /[\u0600-\u06FF]/.test(k))
const batch = keys.slice(0, 45)
const payload = batch.reduce((o, k) => ((o[k] = k), o), {})

const SYS = `You translate UI strings of a LAN device-management app from Arabic to French. Output ONLY a JSON object mapping each input string to its French translation. Copy input keys EXACTLY, character for character.`
const zai = await ZAI.create()
const r = await zai.chat.completions.create({
  messages: [
    { role: "system", content: SYS },
    { role: "user", content: JSON.stringify(payload) },
  ],
  temperature: 0.1,
})
const raw = r.choices[0]?.message?.content || ""
const a = raw.indexOf("{")
const b = raw.lastIndexOf("}")
const obj = JSON.parse(raw.slice(a, b + 1))
const retKey0 = Object.keys(obj)[0]
const reqKey0 = batch[0]
console.log("len req/ret:", reqKey0.length, retKey0.length)
for (let i = 0; i < Math.max(reqKey0.length, retKey0.length); i++) {
  const c1 = reqKey0.codePointAt(i)
  const c2 = retKey0.codePointAt(i)
  if (c1 !== c2) {
    console.log(`first diff @${i}: req U+${c1?.toString(16).padStart(4, "0")} (${reqKey0[i]}) vs ret U+${c2?.toString(16).padStart(4, "0")} (${retKey0[i]})`)
    console.log("req ctx:", JSON.stringify(reqKey0.slice(Math.max(0, i - 12), i + 12)))
    console.log("ret ctx:", JSON.stringify(retKey0.slice(Math.max(0, i - 12), i + 12)))
    break
  }
}
// count special chars in the first 45 keys
const specials = {}
for (const k of batch) for (const ch of k) {
  const cp = ch.codePointAt(0)
  if ((cp >= 0x2000 && cp <= 0x206f) || cp === 0xfeff || cp === 0xa0) specials[`U+${cp.toString(16)}`] = (specials[`U+${cp.toString(16)}`] || 0) + 1
}
console.log("special chars in first 45 keys:", specials)
