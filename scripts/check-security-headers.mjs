#!/usr/bin/env node
// G7 — فحص آلي لترويسات الأمان وصفحات الخطأ على الخادم المبني (next build)
// ---------------------------------------------------------------------------
// يشغّل .next/standalone/server.js (NODE_ENV=production) على منفذ محلي — أو يفحص
// خادمًا قائمًا عبر BASE_URL — ثم يطلب عينة مسارات: مستندات HTML، حمولة بلا Accept،
// مسارات API، 404 للصفحات وللـAPI، أصول ساكنة، ورفض أصل خارجي (403).
// يؤكد على كل استجابة:
//   · Content-Security-Policy موجودة، بلا 'unsafe-eval'، ومعها frame-ancestors
//   · X-Frame-Options (SAMEORIGIN/DENY) · Referrer-Policy · X-Content-Type-Options: nosniff
//   · Permissions-Policy · غياب X-Powered-By
// ويؤكد أن أجسام 404 لا تكشف مسارات داخلية أو آثار مكدس.
// قاعدة البيانات: نسخة مؤقتة من db/custom.db في مجلد مؤقت — الأصل لا يُمس.
// الاستخدام: node scripts/check-security-headers.mjs   (بعد bun run build)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const PORT = Number(process.env.PORT_CHECK ?? 3917)
let BASE = process.env.BASE_URL ?? ""
let child = null

const LEAK_PATTERNS = [
  /\/home\/[^\s"'<]+/, /\/Users\/[^\s"'<]+/, /[A-Za-z]:\\\\/, /node_modules/, /\.next\/server/,
  /\n\s+at\s+\S+\s+\(/, /webpack-internal:/, /\bENOENT\b/, /PrismaClient/,
]

const failures = []
function fail(msg) {
  failures.push(msg)
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

async function waitUp(url, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: "manual" })
      if (r.status > 0) return true
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function boot() {
  const server = path.join(ROOT, ".next/standalone/server.js")
  if (!fs.existsSync(server)) throw new Error("لا يوجد .next/standalone/server.js — شغّل bun run build أولًا")
  const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1" }
  if (!env.DATABASE_URL) {
    const src = path.join(ROOT, "db/custom.db")
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nl-headers-"))
    const dst = path.join(tmp, "check.db")
    if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    env.DATABASE_URL = `file:${dst}`
  }
  child = spawn(process.execPath, [server], { env, cwd: path.dirname(server), stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout.on("data", (d) => { log += d })
  child.stderr.on("data", (d) => { log += d })
  BASE = `http://127.0.0.1:${PORT}`
  if (!(await waitUp(`${BASE}/api/health`, 60000))) {
    console.error(log.slice(-3000))
    throw new Error("الخادم لم يبدأ خلال 60 ثانية")
  }
}

function firstStaticAsset() {
  const dir = path.join(ROOT, ".next/static/chunks")
  if (!fs.existsSync(dir)) return null
  const f = fs.readdirSync(dir).find((n) => n.endsWith(".js"))
  return f ? `/_next/static/chunks/${f}` : null
}

function checkHeaders(name, res, { html = false } = {}) {
  const h = res.headers
  const csp = h.get("content-security-policy")
  if (!csp) fail(`${name}: Content-Security-Policy مفقودة`)
  else {
    if (csp.includes("'unsafe-eval'")) fail(`${name}: CSP تحتوي 'unsafe-eval'`)
    if (!/frame-ancestors\s/.test(csp)) fail(`${name}: CSP بلا frame-ancestors`)
    if (html && !/script-src[^;]*'nonce-/.test(csp)) fail(`${name}: CSP المستند بلا nonce في script-src`)
    if (/,/.test(csp) && /default-src[^;]*,/.test(csp)) fail(`${name}: CSP مكررة (ترويستان مدمجتان)`)
  }
  const xfo = (h.get("x-frame-options") ?? "").toUpperCase()
  if (xfo !== "SAMEORIGIN" && xfo !== "DENY") fail(`${name}: X-Frame-Options = "${xfo}"`)
  if (!h.get("referrer-policy")) fail(`${name}: Referrer-Policy مفقودة`)
  if ((h.get("x-content-type-options") ?? "").toLowerCase() !== "nosniff") fail(`${name}: X-Content-Type-Options ليست nosniff`)
  if (!h.get("permissions-policy")) fail(`${name}: Permissions-Policy مفقودة`)
  if (h.get("x-powered-by")) fail(`${name}: X-Powered-By مكشوفة (${h.get("x-powered-by")})`)
}

function checkNoLeak(name, body) {
  for (const re of LEAK_PATTERNS) {
    const m = re.exec(body)
    if (m) fail(`${name}: الجسم يكشف تفصيلًا داخليًا (${m[0].slice(0, 60)})`)
  }
}

async function main() {
  if (!BASE) await boot()
  const HTML = { accept: "text/html,application/xhtml+xml" }
  const asset = firstStaticAsset()
  const cases = [
    { name: "GET / (HTML)", url: "/", headers: HTML, html: true, status: [200] },
    { name: "GET / (Accept */*)", url: "/", headers: { accept: "*/*" }, status: [200] },
    { name: "GET /download (HTML)", url: "/download", headers: HTML, html: true, status: [200] },
    { name: "GET /phone (HTML)", url: "/phone", headers: HTML, html: true, status: [200] },
    { name: "GET /api/health", url: "/api/health", status: [200, 503] },
    { name: "GET /api/version", url: "/api/version", status: [200] },
    { name: "GET /api (404 API)", url: "/api/__g7_missing__", status: [404], leak: true },
    { name: "GET 404 page (HTML)", url: "/__g7_missing__/deep/path", headers: HTML, html: true, status: [404], leak: true },
    { name: "GET 404 page (Accept */*)", url: "/__g7_missing__", headers: { accept: "*/*" }, status: [404], leak: true },
    { name: "GET /logo.svg (static)", url: "/logo.svg", status: [200] },
    { name: "POST /api/fs cross-origin (403)", url: "/api/fs", method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}", status: [403] },
  ]
  if (asset) cases.push({ name: "GET _next/static chunk", url: asset, status: [200] })
  else fail("لا أصل ساكن في .next/static/chunks للفحص")

  for (const c of cases) {
    const before = failures.length
    let res
    try {
      res = await fetch(BASE + c.url, { method: c.method ?? "GET", headers: c.headers, body: c.body, redirect: "manual" })
    } catch (e) {
      fail(`${c.name}: فشل الطلب (${e})`)
      continue
    }
    const body = await res.text()
    if (c.status && !c.status.includes(res.status)) fail(`${c.name}: الحالة ${res.status} (المتوقع ${c.status.join("/")})`)
    checkHeaders(c.name, res, { html: c.html })
    if (c.leak) checkNoLeak(c.name, body)
    if (failures.length === before) console.log(`✓ ${c.name} → ${res.status}`)
  }
  console.log(failures.length ? `\nG7 header check: FAILED (${failures.length})` : `\nG7 header check: ${cases.length} routes OK`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => { if (child) child.kill("SIGTERM") })
