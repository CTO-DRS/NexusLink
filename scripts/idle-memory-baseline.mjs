#!/usr/bin/env node
// NexusLink — قياس ذاكرة الخمول (FA-harden — عقد §16 بند 4)
// ============================================================
// الجزء القابل للتنفيذ في الحاوية: سيرفر Next standalone (نفس sidecar الذي
// يشغله تطبيق سطح المكتب) بلا أي نشاط — عينات RSS كل 20ث لمدة 6 دقائق،
// ثم تقرير (min/max/last/ميل) وتاكيد الاستقرار (ميل ≤ 0.5 MB/دقيقة ونمو ≤ 15%).
// الجزء الذي يستحيل في الحاوية (استنزاف بطارية 24 ساعة بنافذة Rust حقيقية)
// بروتوكول يدوي موثق في العقد §16.ز وعقد العمل worklog.
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { readFileSync } from "node:fs"

const ROOT = new URL("..", import.meta.url).pathname
const PORT = 3100
const SAMPLES = 18
const EVERY_MS = 20_000

const results = []
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
}

function rssMB(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/status`, "utf8")
    const m = stat.match(/VmRSS:\s+(\d+) kB/)
    return m ? Math.round(Number(m[1]) / 1024) : null
  } catch {
    return null
  }
}

console.log("== FA-harden idle-memory-baseline — سيرفر standalone خامل ==")
const child = spawn("node", [`${ROOT}.next/standalone/server.js`], {
  cwd: `${ROOT}.next/standalone`,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})
const lines = (buf) => String(buf).split("\n").filter(Boolean).forEach((l) => console.log(`[next] ${l}`))
child.stdout.on("data", lines)
child.stderr.on("data", lines)

let up = false
for (let i = 0; i < 40 && !up; i++) {
  await sleep(500)
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    up = r.ok
  } catch { /* الإقلاع */ }
}
check("السيرفر قام واستجاب /api/health", up, `pid=${child.pid}`)

if (up) {
  // إحماء (JIT/تجمعات) قبل بدء القياس — 20ث
  await sleep(20_000)
  const samples = []
  for (let i = 0; i < SAMPLES; i++) {
    const mb = rssMB(child.pid)
    if (mb != null) samples.push(mb)
    if (i < SAMPLES - 1) await sleep(EVERY_MS)
  }
  const first = samples[0]
  const last = samples[samples.length - 1]
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const mins = ((SAMPLES - 1) * EVERY_MS) / 60000
  const slopePerMin = (last - first) / mins
  const growthPct = ((last - first) / first) * 100
  console.log(`\nالعينات (${samples.length} خلال ${mins.toFixed(1)} دقيقة): ${samples.join(", ")} MB`)
  console.log(`min=${min} max=${max} last=${last} · الميل=${slopePerMin.toFixed(3)} MB/د · النمو=${growthPct.toFixed(2)}%`)
  check("ذاكرة الخمول مستقرة (ميل ≤ 0.5 MB/دقيقة)", slopePerMin <= 0.5, `${slopePerMin.toFixed(3)} MB/min`)
  check("لا نمو متسرب (نمو ≤ 15%)", growthPct <= 15, `${growthPct.toFixed(2)}%`)
  check("الهدف التعاقدي: RSS السيرفر الخامل < 150MB", last < 150, `${last} MB — هذا سيرفر standalone وحده؛ الهدف الكلي <150MB للتطبيق كاملًا يقاس على أجهزة حقيقية`)
} else {
  check("السيرفر لم يقلع", false, "لا قياس")
}

child.kill("SIGKILL")
await sleep(400)

const failed = results.filter((r) => !r.ok)
console.log(`\n===== IDLE-MEMORY-BASELINE: ${results.length - failed.length}/${results.length} passed =====`)
process.exit(failed.length ? 1 : 0)
