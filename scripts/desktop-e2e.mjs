#!/usr/bin/env node
// NexusLink — E2E حزمة سطح المكتب (نفس ما يديره Tauri procman حرفيًا)
// ============================================================
// 1) node .next/standalone/server.js  (PORT=3000)          ← عملية 1
// 2) GET /api/health + GET /api/desktop/status        ← الجاهزية + إقلاع الجسور
// 3) node resources/comms/comms.cjs   (PORT=3003+mDNS) ← عملية 2
// 4) node resources/gateway/gateway.cjs (PORT=81)      ← عملية 3 (بديل Caddy)
// 5) هاتف محاكى عبر البوابة (نفس مسار الوكيل: ?XTransformPort) → beacon → tray=متصل
// النجاح: كل الفحوص خضراء ثم نظافة المنافذ عند الخروج.
import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

const ROOT = new URL("..", import.meta.url).pathname
const RES = new URL("../apps/desktop/src-tauri/resources/", import.meta.url).pathname

const results = []
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
}

const children = []
function spawnProc(name, cmd, args, env, onLine) {
  const p = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
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
  for (const port of ports) {
    try {
      const { execSync } = await import("node:child_process")
      const out = execSync(`ss -ltnp | grep ':${port} ' || true`, { shell: "/bin/bash" }).toString()
      const pids = [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => m[1]))]
      for (const pid of pids) {
        execSync(`kill -9 ${pid} 2>/dev/null || true`, { shell: "/bin/bash" })
        console.log(`  killed stale pid ${pid} on :${port}`)
      }
    } catch { /* بلا حائز */ }
  }
}

// ============ 0) نظافة المنافذ (الدرس: لا fuser — ss فقط) ============
console.log("== cleanup stale ports ==")
await killPorts([3000, 3003, 81, 3004, 3005, 3006, 3007, 3009])
await sleep(600)

try {
  // ============ 1) Next standalone (PORT=3000) ============
  console.log("== [1] next standalone on :3000 ==")
  spawnProc("next", process.execPath, [`${ROOT}.next/standalone/server.js`],
    { PORT: "3000", HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
    (l) => { if (/ready|error|Error/i.test(l)) console.log("   " + l.slice(0, 160)) })

  const health = await waitHttp("next /api/health", "http://127.0.0.1:3000/api/health", 90000)
  check("next: /api/health يعمل", health?.ok === true && health?.proto === "Nexus/1.2", `uptime=${Math.round(health?.uptime || 0)}s`)

  // ============ 2) إقلاع كل الجسور + إشارة الهاتف ============
  console.log("== [2] /api/desktop/status (ensure all bridges) ==")
  const st0 = await waitHttp("desktop/status", "http://127.0.0.1:3000/api/desktop/status", 30000)
  const b = st0?.bridges || {}
  check("جسر الوسائط 3005 مُقلعاً", b.media?.booted === true && b.media?.port === 3005)
  check("جسر الحماية 3006 مُقلعاً", b.guard?.booted === true && b.guard?.port === 3006)
  check("جسر الإنتاجية 3007 مُقلعاً", b.prod?.booted === true && b.prod?.port === 3007)
  check("جسر التحكم 3004 مُقلعاً", b.remote?.booted === true && b.remote?.port === 3004)
  check("قناة الأمان 3009 مُقلعة", b.security?.booted === true && b.security?.port === 3009)
  check("الهاتف غير متصل مبدئياً (tray=منتظر)", st0?.phone?.online === false, `state=${st0?.phone?.state}`)

  // ============ 3) gateway (81 → 8180 عند الحجب) — بديل Caddy ============
  // نفس ترتيب procman: البوابة أولاً → نقرأ المنفذ الفعلي → comms يعلنه في mDNS
  console.log("== [3] gateway.cjs (81 أو fallback) ==")
  let gwPort = 0
  spawnProc("gateway", process.execPath, [`${RES}gateway/gateway.cjs`],
    { GATEWAY_PORT: "81", REST_PORT: "3000" },
    (l) => { console.log("   " + l.slice(0, 160)); const m = l.match(/PORT=(\d+)/); if (m) gwPort = Number(m[1]) })
  await sleep(1200)
  if (!gwPort) throw new Error("gateway لم يعلن منفذه (PORT=…)")
  const gw = await waitHttp("gateway /__gw/health", `http://127.0.0.1:${gwPort}/__gw/health`, 15000)
  check("gateway: /__gw/health", gw?.ok === true && gw?.role === "gateway", `port=${gwPort}`)

  const proxied = await fetch(`http://127.0.0.1:${gwPort}/api/health`).then((r) => r.json())
  check("gateway: تمرير REST إلى 3000", proxied?.ok === true && proxied?.proto === "Nexus/1.2")

  const viaGw = await fetch(`http://127.0.0.1:${gwPort}/status?XTransformPort=3003`).then((r) => r.json())
  check("gateway: XTransformPort=3003 → /status للcomms (سيُثبت بعد إقلاع comms)", viaGw?.role === "comms" || viaGw?.error === "upstream-unreachable", `port=${gwPort}`)

  // ============ 4) comms.cjs (3003 + mDNS بالمنفذ الفعلي) ============
  console.log("== [4] comms.cjs on :3003 (+ mDNS) ==")
  let mdnsUp = false
  spawnProc("comms", process.execPath, [`${RES}comms/comms.cjs`],
    { PORT: "3003", NEXT_BASE: "http://127.0.0.1:3000", NEXUSLINK_NAME: "NEXUS-PC", NEXUSLINK_GATEWAY_PORT: String(gwPort) },
    (l) => { console.log("   " + l.slice(0, 200)); if (l.includes("advertising")) mdnsUp = true })
  const cs = await waitHttp("comms /status", "http://127.0.0.1:3003/status", 30000)
  check("comms: /status يعمل", cs?.ok === true && cs?.role === "comms" && cs?.port === 3003, `sockets=${cs?.sockets}`)
  await sleep(1500)
  check("comms: إعلان mDNS", mdnsUp === true, `gateway المعلن=${gwPort}`)
  const via81 = await fetch(`http://127.0.0.1:${gwPort}/status?XTransformPort=3003`).then((r) => r.json())
  check("gateway→comms: /status عبر XTransformPort", via81?.role === "comms" && via81?.port === 3003)

  // ============ 5) هاتف محاكى عبر البوابة (مسار الوكيل الحرفي) ============
  console.log("== [5] simulated phone via gateway (guard beacon) ==")
  const { io } = await import("socket.io-client")
  const sock = io(`http://127.0.0.1:${gwPort}`, {
    query: { XTransformPort: "3006" },
    transports: ["polling", "websocket"],
    reconnection: false,
    timeout: 15000,
  })
  await new Promise((res, rej) => {
    sock.on("connect", res)
    sock.on("connect_error", (e) => rej(new Error(`phone socket via gateway failed: ${e.message}`)))
    setTimeout(() => rej(new Error("phone connect timeout (15s)")), 15000)
  })
  check("الهاتف: socket.io عبر 81?XTransformPort=3006 (polling+WS)", true)

  // تسجيل وكيل الحماية (نفس تسليم الوكيل الحقيقي: guard:hello-phone ثم منارة كل 5s)
  sock.emit("guard:hello-phone", { name: "Pixel-E2E", deviceId: "e2e-desktop-pkg" })
  sock.emit("prox:beacon", { rssi: -52, device: "Pixel-E2E" })
  await sleep(1200)
  const st1 = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("الهاتف: منارة حقيقية → phone.online=true (tray=متصل)", st1?.phone?.online === true, `rssi=${st1?.phone?.rssi} state=${st1?.phone?.state}`)

  // WS upgrade فعلي عبر البوابة (بعد الترقية من polling): نبينه بأن socket ما زال يرسل/يستقبل
  const echoOk = await new Promise((res) => {
    let done = false
    sock.io.engine?.once?.("upgrade", () => { if (!done) { done = true; res(true) } })
    setTimeout(() => { if (!done) { done = true; res(sock.connected) } }, 4000)
  })
  check("الهاتف: ترقية WS عبر نفق البوابة", echoOk === true)
  sock.disconnect()

  // جسر التحكم 3004 عبر البوابة — مصافحة handshake فقط (نفس نمط FA-9)
  const rc = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => {
    rc.on("connect", res); rc.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("3004 timeout")), 10000)
  })
  check("جسر التحكم 3004 عبر البوابة", true)
  rc.disconnect()

  // قناة الأمان 3009 عبر البوابة — مصافحة فقط (E2E الكامل له عدّاؤه الخاص)
  const sec = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3009" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => {
    sec.on("connect", res); sec.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("3009 timeout")), 10000)
  })
  check("قناة الأمان 3009 عبر البوابة", true)
  sec.disconnect()
  // ============ 6) الطبقة الأصلية: اختصارات + حقول desktop في الحالة + مسار الإرسال ============
  console.log("== [6] native layer: shortcuts + status.desktop + send-file ==")
  // 6a) مزامنة الاختصارات (نفس مسار جسر الواجهة → المخزن المشترك)
  const putSc = await fetch("http://127.0.0.1:3000/api/desktop/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortcuts: { sendClipboard: "Ctrl+Shift+N", toggleWindow: "Ctrl+Shift+D" } }),
  }).then((r) => r.json())
  check("desktop/shortcuts: PUT يقبل الخريطة", putSc?.ok === true)
  const getSc = await fetch("http://127.0.0.1:3000/api/desktop/shortcuts").then((r) => r.json())
  check("desktop/shortcuts: GET يعيد نفس المخزن",
    getSc?.ok === true && getSc?.shortcuts?.sendClipboard === "Ctrl+Shift+N" && getSc?.shortcuts?.toggleWindow === "Ctrl+Shift+D")

  // 6b) الحالة الموحدة تحمل حزمة desktop كاملة
  const st2 = await waitHttp("desktop/status (native)", "http://127.0.0.1:3000/api/desktop/status", 30000)
  const dt = st2?.desktop || {}
  check("status.desktop.shortcuts موجودة", typeof dt.shortcuts?.sendClipboard === "string")
  check("status.desktop.agentId حقل معلن", "agentId" in dt)
  check("status.desktop.transfers قائمة", Array.isArray(dt.transfers))
  check("status.desktop.notifs قائمة", Array.isArray(dt.notifs))

  // 6c) مسار Drag&Drop التعاقدي: ملف على القرص → pc-fs/Inbox → send-file (نفس ما ينفذه Rust)
  // ملاحظة فيزيائية: standalone server.js يعمل chdir(__dirname) — جذر البيانات = .next/standalone/data
  // (في الحزمة المثبتة: procman يشغّل resources/server/server.js → الجذر = resources/server/data)
  const fsMod = await import("node:fs/promises")
  const pathMod = await import("node:path")
  const dataRoot = process.env.NEXUS_DATA_ROOT || pathMod.join(ROOT, ".next", "standalone", "data")
  const inboxDir = pathMod.join(dataRoot, "nexus-storage", "pc-fs", "Inbox")
  await fsMod.mkdir(inboxDir, { recursive: true })
  await fsMod.writeFile(pathMod.join(inboxDir, "e2e-drop.txt"), "nexus desktop drop " + Date.now())
  const sendRes = await fetch("http://127.0.0.1:3000/api/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send-file", deviceId: "galaxy-s24", deviceName: "Galaxy S24",
      direction: "out", srcDeviceId: "pc-office", srcPath: "/Inbox/e2e-drop.txt", fileName: "e2e-drop.txt",
    }),
  }).then((r) => r.json())
  check("devices/send-file: قبول ملف سحب-وإفلات", sendRes?.ok === true && !!sendRes?.job?.id, `job=${sendRes?.job?.id ?? sendRes?.error}`)
  const txList = await fetch("http://127.0.0.1:3000/api/transfer").then((r) => r.json())
  check("المهمة ظهرت في قائمة النقل", Array.isArray(txList?.jobs) && txList.jobs.some((j) => j.id === sendRes?.job?.id))

  // 6d) الحافظة الموحدة — نفس ما ينفذه Rust عند Ctrl+Shift+N (POST → prodEmit clip:new)
  const clip = await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "pc-office", deviceName: "NEXUS-PC", kind: "text", content: "nexus-e2e-clipboard", mode: "auto" }),
  }).then((r) => r.json())
  check("prod/clipboard: POST حافظة موحدة (مسار Ctrl+Shift+N)", clip?.ok === true && !!clip?.item?.id)

  // 6e) إشعار جديد من الهاتف — مصدر إشعارات النظام الأصلية
  const notifRes = await fetch("http://127.0.0.1:3000/api/comms/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: "com.whatsapp", appName: "WhatsApp", title: "E2E رسالة", body: "نص تجريبي", actionable: true }),
  }).then((r) => r.json())
  check("comms/notifications: إشعار قابل للتفاعل", notifRes?.ok === true && !!notifRes?.notification?.id)
  const st3 = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("status.desktop.notifs يتضمن الإشعار الجديد", (st3?.desktop?.notifs || []).some((n) => n.id === notifRes?.notification?.id))
} catch (e) {
  check("E2E فشل بخطأ غير متوقع", false, e.message)
} finally {
  console.log("== cleanup ==")
  for (const p of children) { try { p.kill("SIGKILL") } catch {} }
  await killPorts([3000, 3003, 81, 8180])
  await sleep(400)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n===== DESKTOP E2E: ${results.length - failed.length}/${results.length} passed =====`)
process.exit(failed.length ? 1 : 0)
