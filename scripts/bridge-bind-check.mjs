#!/usr/bin/env node
// P0 — الجسور 3003–3009 لا تُفتح على الشبكة: كل httpServer.listen في الجسور يجب أن يربط 127.0.0.1
// (افتراضيًا عبر BRIDGE_HOST). الوصول من الهاتف يمر فقط عبر البوابة (رمز الاقتران إلزامي — G1).
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const files = [
  ...readdirSync("src/lib/nexus").filter((f) => f.endsWith("-bridge.ts")).map((f) => join("src/lib/nexus", f)),
  "mini-services/comms-service/index.ts",
  "mini-services/remote-service/index.ts",
]
let bad = 0
let seen = 0
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (!/\bhttpServer\.listen\(/.test(line)) return
    seen++
    if (!/listen\(PORT,\s*process\.env\.BRIDGE_HOST \|\| "127\.0\.0\.1"/.test(line)) {
      console.error(`✗ ${f}:${i + 1} يستمع على كل الواجهات: ${line.trim()}`)
      bad++
    }
  })
}
const caddy = readFileSync("Caddyfile", "utf8")
if (/reverse_proxy\s+localhost/.test(caddy)) {
  console.error("✗ Caddyfile: reverse_proxy localhost — استخدم 127.0.0.1")
  bad++
}
if (seen === 0) { console.error("✗ لم يُعثر على أي listen — تغيّر هيكل الجسور؟"); process.exit(1) }
if (bad) process.exit(1)
console.log(`✓ ${seen} listen في ${files.length} ملفات كلها على 127.0.0.1`)
