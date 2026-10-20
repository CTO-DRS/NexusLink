#!/usr/bin/env node
// debug: one small batch, dump raw response
import { readFileSync } from "node:fs"
import ZAI from "z-ai-web-dev-sdk"

const webMap = JSON.parse(readFileSync("src/lib/ar-en-map.json", "utf8"))
const keys = Object.keys(webMap).filter((k) => /[\u0600-\u06FF]/.test(k)).slice(0, 5)
const payload = keys.reduce((o, k) => ((o[k] = k), o), {})
console.log("PAYLOAD:", JSON.stringify(payload).slice(0, 400))

const zai = await ZAI.create()
const r = await zai.chat.completions.create({
  messages: [
    { role: "system", content: "You translate Arabic UI strings to French. Output ONLY a JSON object mapping each input string to its French translation." },
    { role: "user", content: JSON.stringify(payload) },
  ],
  temperature: 0.1,
})
const raw = r.choices[0]?.message?.content || ""
console.log("RAW RESPONSE (first 900):")
console.log(raw.slice(0, 900))
const a = raw.indexOf("{")
const b = raw.lastIndexOf("}")
if (a > -1) {
  const obj = JSON.parse(raw.slice(a, b + 1))
  console.log("OBJ KEYS:", Object.keys(obj).map((k) => k.slice(0, 40)))
  console.log("EXACT MATCH:", keys.filter((k) => obj[k]).length, "/", keys.length)
}
