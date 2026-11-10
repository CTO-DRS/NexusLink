// perf-e2e — بوابة الأداء الحية (تكليف 49 — M1 PERF p95)
// =====================================================================================================
// العقيدة: أداء الواجهة ليس رأيًا بل ميزانية مقيسة. هذه البوابة تقيس حيًا بمتصفح Chromium حقيقي:
//   أ) 7 مسارات (الموقع · تطبيق سطح المكتب · المتصفح · جهاز التحكم · الهاتف · التلفاز · التنزيل)
//      بمقياس p50/p95 لـ TTFB/FCP/Load + بايتات JS الفعلية المنقولة لكل تحميل (أدق مقياس أوليّ).
//   ب) زمن استجابة API المقيس (devices/transfer/status) — نبضات الواجهة الدورية.
//   ج) ميزانيات معلنة: بايتات JS لكل مسار + p95 زمني بسقوف متسعة (الآلات تختلف — البايتات لا).
// الاكتشاف المفتاحي قبل الإصلاح: nexus-app.tsx كان يستورد 15 وحدة (~5,900 سطر) وrecharts كله
// (1.3MB في القطعة الأكبر) دفعة واحدة رغم أن وحدة واحدة تُعرض في كل لحظة.
// الاستخدام: node scripts/perf-e2e.mjs        — قياس + ميزانيات
//            PERF_SAMPLES=9 PERF_BUDGETS=0   — قياس حرة بلا ميزانيات (وضع المعايرة)
// البيئة: يفترض بناء إنتاجي (.next/standalone) — يفطّع المكدس ويفحصه ذاتيًا (نمط desktop-e2e).
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const require2 = createRequire(import.meta.url)

// درس desktop-e2e (CAT3): تثبيت DATABASE_URL من .env في مقدمة العملية — لا وراثة بيئة ملوثة
{
  const envUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
  if (envUrl) process.env.DATABASE_URL = envUrl
}

const results = []
let failed = 0
function check(name, ok, detail = "") {
  results.push({ name, ok })
  if (!ok) failed++
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
}

const children = []
function spawnProc(name, cmd, args, env, onLine) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
  const line = (buf) => String(buf).split("\n").filter(Boolean).forEach((l) => onLine?.(`[${name}] ${l}`))
  p.stdout.on("data", line)
  p.stderr.on("data", line)
  p.on("exit", (c) => onLine?.(`[${name}] exited code=${c}`))
  children.push(p)
  return p
}

async function waitHttp(name, url, timeoutMs, okFn = (j) => j?.ok === true) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url)
      const j = await r.json().catch(() => null)
      if (r.status === 200 && okFn(j)) return j
    } catch { /* لم تجهز */ }
    await sleep(400)
  }
  throw new Error(`timeout waiting ${name} at ${url}`)
}

async function killPorts(ports) {
  const { execSync } = await import("node:child_process")
  for (const pat of ["my-project/.next/standalone/server.js", "gateway/index.cjs", "next-server"]) {
    try { execSync(`pkill -9 -f '${pat}' 2>/dev/null || true`, { shell: "/bin/bash" }) } catch { /* لا شيء */ }
  }
  for (const port of ports) {
    try {
      const out = execSync(`ss -ltnp | grep ':${port} ' || true`, { shell: "/bin/bash" }).toString()
      for (const pid of [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => m[1]))]) {
        try { execSync(`kill -9 ${pid} 2>/dev/null || true`, { shell: "/bin/bash" }) } catch { /* بلا حائز */ }
      }
    } catch { /* بلا حائز */ }
  }
}

// ---- إحصاء p50/p95 (أقرب-رتبة الخطية — لا استيفاء) ----
function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return s[idx]
}
const round1 = (x) => Math.round(x * 10) / 10

// ---- قياس مسار واحد داخل المتصفح ----
// درس المعايرة: إعادة استخدام الصفحة تُراكم مصادر performance عبر التنقلات —
// فكل مسار يُقاس بصفحة جديدة (مخزن الأداء صفر) ودخول التنقّل الأخير لا الأول.
async function measureRoute(ctx, url, samples) {
  const runs = []
  for (let i = 0; i < samples; i++) {
    const page = await ctx.newPage()
    const t0 = Date.now()
    await page.goto(url, { waitUntil: "load", timeout: 30000 })
    const nav = await page.evaluate(() => {
      const navs = performance.getEntriesByType("navigation")
      const nav0 = navs[navs.length - 1]
      const start = nav0?.startTime ?? 0
      const fcp = performance.getEntriesByType("paint").filter((p) => p.startTime >= start && p.name === "first-contentful-paint")[0]?.startTime ?? 0
      const res = performance.getEntriesByType("resource")
      let jsBytes = 0, cssBytes = 0, fontBytes = 0, reqs = 0
      for (const r of res) {
        if (r.name.endsWith(".woff2")) { fontBytes += r.transferSize || 0; continue }
        if (r.transferSize === 0 && r.decodedBodySize === 0) continue // الكاش المدمج
        reqs++
        if (r.initiatorType === "script" || r.name.includes("/chunks/") || r.name.endsWith(".js")) jsBytes += r.transferSize || r.decodedBodySize
        else if (r.name.endsWith(".css")) cssBytes += r.transferSize || r.decodedBodySize
      }
      return {
        ttfb: nav0 ? nav0.responseStart - nav0.requestStart : 0,
        dom: nav0 ? nav0.domContentLoadedEventEnd - nav0.requestStart : 0,
        load: nav0 ? nav0.loadEventEnd - nav0.requestStart : 0,
        fcp, jsBytes, cssBytes, fontBytes, reqs,
      }
    })
    runs.push({ ...nav, wall: Date.now() - t0 })
    await page.close()
    await sleep(350)
  }
  return {
    ttfb: runs.map((r) => r.ttfb), dom: runs.map((r) => r.dom), load: runs.map((r) => r.load),
    fcp: runs.map((r) => r.fcp), wall: runs.map((r) => r.wall),
    js: runs.map((r) => r.jsBytes), css: runs.map((r) => r.cssBytes), font: runs.map((r) => r.fontBytes),
  }
}

// ---- الميزانيات (تكليف 49 — مثبتة على قياس ما بعد الإصلاح + هامش ~10%) ----
// بايتات JS عند حدث load حصرًا (نافذة الإنتاج الحقيقي — منطقي ومستقر عبر الآلات)
// قبل الإصلاح: desktop/app 2977K · / 2977K · download 1354K · phone 993K · tv 802K
// بعد الإصلاح: 1147K · 1147K · 839K · 879K · 802K — الميزانية تحفظ المكسب فأي
// تراجع مستقبلي (استيراد ثابت جديد) يفشل هنا بأول جولة.
const JS_BUDGETS = {
  "الموقع /": 1_260_000,
  "تطبيق سطح المكتب /?desktop=1": 1_260_000,
  "المتصفح /?app=1": 1_260_000,
  "جهاز التحكم /controller": 1_045_000,
  "الهاتف /phone": 970_000,
  "التلفاز /tv": 880_000,
  "التنزيل /download": 925_000,
}
// سقوف زمنية متسعة عمدًا (p95 بالمللي ثانية — الآلات المحلية متفاوتة)
const TIME_BUDGETS = { ttfbP95: 400, fcpP95: 2500, loadP95: 4000 }
// نبضات API — p95 بالمللي ثانية (محلية صرفة)
const API_BUDGETS = { "/api/devices": 120, "/api/transfer": 120, "/api/desktop/status": 400 }

async function main() {
  const SAMPLES = Number(process.env.PERF_SAMPLES) || 7
  const BUDGETS = process.env.PERF_BUDGETS !== "0"

  console.log("== نظافة المنافذ ==")
  await killPorts([3000, 8207, 3003, 3004, 3005, 3006, 3007, 3008, 3009])
  await sleep(700)

  try {
    console.log("== [1] next standalone :3000 ==")
    spawnProc("next", process.execPath, [path.join(ROOT, ".next/standalone/server.js")],
      { PORT: "3000", HOSTNAME: "127.0.0.1", NODE_ENV: "production", NEXUS_WOL_BROADCAST: "127.0.0.1", NEXUS_WOL_PORT: "9009" },
      (l) => { if (/exited|Error|EADDRINUSE/.test(l)) console.log(" ", l) })
    await waitHttp("next /api/health", "http://127.0.0.1:3000/api/health", 90000)

    console.log("== [2] إشعال الجسور عبر desktop/status ==")
    const st0 = await waitHttp("desktop/status", "http://127.0.0.1:3000/api/desktop/status", 45000)
    check("الجسور الخمسة عامرة", !!st0, `bridges=${JSON.stringify(st0.bridges ?? st0.ok)}`)

    console.log("== [3] بوابة 8207 ==")
    spawnProc("gateway", process.execPath, [path.join(ROOT, "mini-services/gateway/index.cjs")],
      { GATEWAY_PORT: "8207", REST_PORT: "3000" }, (l) => { if (/exited|Error/.test(l)) console.log(" ", l) })
    await waitHttp("gateway health", "http://127.0.0.1:8207/__gw/health", 20000)

    // المتصفح
    console.log("== [4] Chromium — القياس الحي ==")
    const { chromium } = require2("playwright")
    const browser = await chromium.launch({ headless: true })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })

    const ROUTES = [
      ["الموقع /", "http://127.0.0.1:3000/"],
      ["تطبيق سطح المكتب /?desktop=1", "http://127.0.0.1:3000/?desktop=1"],
      ["المتصفح /?app=1", "http://127.0.0.1:3000/?app=1"],
      ["جهاز التحكم /controller", "http://127.0.0.1:3000/controller"],
      ["الهاتف /phone", "http://127.0.0.1:3000/phone"],
      ["التلفاز /tv", "http://127.0.0.1:3000/tv"],
      ["التنزيل /download", "http://127.0.0.1:3000/download"],
    ]

    console.log(`\n-- تسخين أول تحميل لكل مسار (بارد) ثم ${SAMPLES} عينات دافئة --`)
    const m = {}
    for (const [label, url] of ROUTES) {
      {
        const warm = await ctx.newPage()
        await warm.goto(url, { waitUntil: "load", timeout: 30000 }).catch(() => {})
        await sleep(250)
        await warm.close()
      }
      m[label] = await measureRoute(ctx, url, SAMPLES)
      const r = m[label]
      console.log(`  ${label.padEnd(30)} js_med=${Math.round(pct(r.js, 50) / 1024)}KB fcp_p95=${Math.round(pct(r.fcp, 95))}ms load_p95=${Math.round(pct(r.load, 95))}ms`)
    }

    // نبضات API
    console.log("\n-- نبضات API ×15 --")
    const apiLat = {}
    for (const ep of ["/api/devices", "/api/transfer", "/api/desktop/status"]) {
      const xs = []
      for (let i = 0; i < 15; i++) {
        const t0 = Date.now()
        try { const r = await fetch("http://127.0.0.1:3000" + ep); await r.arrayBuffer(); xs.push(Date.now() - t0) } catch { /* تجاهل */ }
        await sleep(60)
      }
      apiLat[ep] = xs
      console.log(`  ${ep.padEnd(24)} p50=${pct(xs, 50)}ms p95=${pct(xs, 95)}ms`)
    }

    await browser.close()

    // الجدول الختامي
    console.log("\n================ تقرير p50/p95 ================")
    console.log("المسار".padEnd(30), "js_p50".padStart(8), "js_p95".padStart(8), "ttfb95".padStart(7), "fcp95".padStart(6), "load95".padStart(7))
    for (const [label] of ROUTES) {
      const r = m[label]
      console.log(
        label.padEnd(30),
        `${Math.round(pct(r.js, 50) / 1024)}K`.padStart(8),
        `${Math.round(pct(r.js, 95) / 1024)}K`.padStart(8),
        `${Math.round(pct(r.ttfb, 95))}ms`.padStart(7),
        `${Math.round(pct(r.fcp, 95))}ms`.padStart(6),
        `${Math.round(pct(r.load, 95))}ms`.padStart(7),
      )
    }

    // الميزانيات
    if (BUDGETS) {
      console.log("\n================ بوابة الميزانيات ================")
      for (const [label] of ROUTES) {
        const p95js = pct(m[label].js, 95)
        const bud = JS_BUDGETS[label]
        check(`ميزانية JS: ${label} ≤ ${Math.round(bud / 1024)}KB`, p95js <= bud, `p95=${Math.round(p95js / 1024)}KB`)
      }
      for (const [label] of ROUTES) {
        const ttfb95 = pct(m[label].ttfb, 95), fcp95 = pct(m[label].fcp, 95), load95 = pct(m[label].load, 95)
        check(`زمن p95: ${label}`, ttfb95 <= TIME_BUDGETS.ttfbP95 && fcp95 <= TIME_BUDGETS.fcpP95 && load95 <= TIME_BUDGETS.loadP95,
          `ttfb=${Math.round(ttfb95)} fcp=${Math.round(fcp95)} load=${Math.round(load95)}`)
      }
      for (const [ep, bud] of Object.entries(API_BUDGETS)) {
        const p95 = pct(apiLat[ep], 95)
        check(`API p95: ${ep} ≤ ${bud}ms`, p95 <= bud, `p95=${p95}ms`)
      }
    } else {
      console.log("\n(وضع المعايرة — بلا ميزانيات)")
    }
  } finally {
    console.log("\n== تنظيف ==")
    for (const c of children) { try { c.kill("SIGKILL") } catch { /* لا شيء */ } }
    await killPorts([3000, 8207])
  }

  if (failed) { console.log(`\nالنتيجة: فشل ${failed} فحصًا من ${results.length}`); process.exit(1) }
  console.log(`\nالنتيجة: أخضر ${results.length}/${results.length}`)
  process.exit(0)
}

main().catch((e) => { console.error("فادح:", e); for (const c of children) { try { c.kill("SIGKILL") } catch { /* لا شيء */ } } process.exit(1) })
