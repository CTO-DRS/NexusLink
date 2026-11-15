#!/usr/bin/env node
// G8 — مصدر واحد لعدد فحوص E2E المعلن (README + صفحة الإصدار).
// العدد الرسمي = آخر «أساس E2E: **قبل → بعد**» في worklog.md (سجل الأساس التراكمي
// الذي يُحدَّث مع كل فحص جديد في scripts/*-e2e.mjs).
// الاستخدام:
//   node scripts/e2e-count.mjs           → يطبع العدد
//   node scripts/e2e-count.mjs --check   → يفشل (exit 1) إن خالف README أو صفحة الإصدار العدد
import { readFileSync } from "node:fs"

const ROOT = new URL("..", import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), "utf8")

const ledger = [...read("worklog.md").matchAll(/أساس E2E:\s*\*\*(\d+)\s*→\s*(\d+)/g)]
if (ledger.length === 0) {
  console.error("لا سطر «أساس E2E: **A → B**» في worklog.md")
  process.exit(2)
}
const count = Number(ledger[ledger.length - 1][2])

if (!process.argv.includes("--check")) {
  console.log(count)
  process.exit(0)
}

const readme = read("README.md").match(/(\d+) فحص E2E/)?.[1]
const site = read("public/NexusLink-Release-Page.html").match(/<b>(\d+)<\/b><span data-i="stat4">/)?.[1]
const bad = []
if (Number(readme) !== count) bad.push(`README.md=${readme}`)
if (Number(site) !== count) bad.push(`NexusLink-Release-Page.html stat4=${site}`)
if (bad.length) {
  console.error(`E2E count mismatch — ledger=${count} · ${bad.join(" · ")}`)
  process.exit(1)
}
console.log(`E2E count consistent: ${count} (README + release page)`)
