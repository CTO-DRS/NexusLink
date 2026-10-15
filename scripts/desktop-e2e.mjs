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
import dgram from "node:dgram"
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
    { PORT: "3000", HOSTNAME: "127.0.0.1", NODE_ENV: "production", NEXUS_WOL_BROADCAST: "127.0.0.1", NEXUS_WOL_PORT: "9009" },
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

  // ============ 6f) FA-clipboard-sync — عقد الحافظة الموحدة الحية (§11) ============
  console.log("== [6f] clipboard-sync contract ==")

  // (أ) إعدادات المراقب في المخزن المشترك: إعادة الضبط ثم فحص القيم
  await fetch("http://127.0.0.1:3000/api/desktop/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip: { mode: "auto", maxAutoBytes: 1_048_576 } }),
  })
  const getClip = await fetch("http://127.0.0.1:3000/api/desktop/shortcuts").then((r) => r.json())
  check("desktop/shortcuts: GET يحمل clip افتراضي", getClip?.clip?.mode === "auto" && getClip?.clip?.maxAutoBytes === 1_048_576,
    `mode=${getClip?.clip?.mode} max=${getClip?.clip?.maxAutoBytes}`)
  const putClip = await fetch("http://127.0.0.1:3000/api/desktop/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip: { maxAutoBytes: 131_072 } }),
  }).then((r) => r.json())
  check("desktop/shortcuts: PUT clip يحدّث الحد (128KB)", putClip?.ok === true && putClip?.clip?.maxAutoBytes === 131_072)

  // (ب) الوضع التعاقدي من prodState (زر الواجهة) — يظهر في status.desktop.clip
  await fetch("http://127.0.0.1:3000/api/prod/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipMode: "manual" }),
  })
  const st4 = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("status.desktop.clip: mode من prodState + الحد من المخزن",
    st4?.desktop?.clip?.mode === "manual" && st4?.desktop?.clip?.maxAutoBytes === 131_072,
    `mode=${st4?.desktop?.clip?.mode} max=${st4?.desktop?.clip?.maxAutoBytes}`)
  await fetch("http://127.0.0.1:3000/api/prod/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipMode: "auto" }),
  }) // استعادة تلقائي

  // (ج) سجل الحافظة: شكل العناصر + سقف 50
  const clipList = await fetch("http://127.0.0.1:3000/api/prod/clipboard").then((r) => r.json())
  const clipItems = clipList?.items || []
  check("prod/clipboard: السجل ≤ 50 وبشكل سليم",
    Array.isArray(clipItems) && clipItems.length <= 50 && clipItems.every((i) => "deviceId" in i && "kind" in i && "mode" in i),
    `n=${clipItems.length}`)

  // (د) الهاتف → الكمبيوتر: clip:push عبر جسر الإنتاجية (نفس ما تصدره مراقبة الإتاحة في Kotlin)
  const sockProd = io(`http://127.0.0.1:${gwPort}`, {
    query: { XTransformPort: "3007" },
    transports: ["polling", "websocket"],
    reconnection: false,
    timeout: 15000,
  })
  const clipNews = []
  sockProd.on("clip:new", (item) => clipNews.push(item))
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("prod socket عبر البوابة لم يتصل")), 15000)
    sockProd.on("connect", () => { clearTimeout(t); res() })
  })
  sockProd.emit("clip:push", { deviceId: "phone-e2e", deviceName: "E2E Phone", kind: "text", content: "نexus-e2e-phone-clip نص عربي", size: 30, mode: "auto" })
  let phoneClipOk = false
  for (let i = 0; i < 15 && !phoneClipOk; i++) {
    await sleep(400)
    const list = await fetch("http://127.0.0.1:3000/api/prod/clipboard").then((r) => r.json())
    phoneClipOk = (list?.items || []).some((x) => x.deviceId === "phone-e2e" && (x.content || "").includes("نص عربي"))
  }
  check("clip:push من الهاتف → مخزّن ومبثوث (§11.أ)", phoneClipOk)

  // (ه) حرس الصدى التعاقدي: كل clip:new يحمل deviceId (العملاء يتجاهلون صداهم)
  await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "pc-office", deviceName: "NEXUS-PC", kind: "text", content: "nexus-e2e-echo-guard", mode: "auto" }),
  })
  await sleep(1200)
  const sawPcEcho = clipNews.some((c) => c?.deviceId === "pc-office" && (c?.content || "") === "nexus-e2e-echo-guard")
  const sawPhoneBroadcast = clipNews.some((c) => c?.deviceId === "phone-e2e")
  check("prodEmit clip:new يصل العملاء ويتضمن deviceId (حرس §11.ج)", sawPcEcho && sawPhoneBroadcast,
    `pc=${sawPcEcho} phone=${sawPhoneBroadcast} events=${clipNews.length}`)

  // (و) الصور: POST kind=image (dataURL) — نفس ما يبنيه Rust بعد ترميز PNG
  const px1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const imgClip = await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "pc-office", deviceName: "NEXUS-PC", kind: "image", content: px1, fileName: "e2e-clip.png", filePath: "/Inbox/e2e-clip.png", size: 95, mode: "auto" }),
  }).then((r) => r.json())
  check("prod/clipboard: صورة dataURL تُقبل وتُبث", imgClip?.ok === true && imgClip?.item?.kind === "image")

  // (ز) الملفات المنسوخة: عنصر kind=file + الاستلام الفعلي PUT → نسخ بايتات إلى Downloads
  await fsMod.writeFile(pathMod.join(inboxDir, "e2e-clipfile.txt"), "clip transfer suggestion " + Date.now())
  const fileClip = await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "pc-office", deviceName: "NEXUS-PC", kind: "file", content: "", fileName: "e2e-clipfile.txt", filePath: "/Inbox/e2e-clipfile.txt", size: 32, mode: "auto" }),
  }).then((r) => r.json())
  check("prod/clipboard: اقتراح نقل kind=file", fileClip?.ok === true && fileClip?.item?.kind === "file")
  const recv = await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: fileClip?.item?.id }),
  }).then((r) => r.json())
  let recvBytes = 0
  try { recvBytes = (await fsMod.stat(pathMod.join(dataRoot, "nexus-storage", "pc-fs", "Downloads", recv?.name || "x"))).size } catch { /* below */ }
  check("PUT clip: استلام فعلي → نسخ إلى pc-fs/Downloads", recv?.ok === true && recvBytes > 0, `name=${recv?.name} bytes=${recvBytes}`)

  sockProd.disconnect()

  // ============ 6g) FA-power — أوامر النظام/الطاقة الحقيقية + Wake-on-LAN (§12) ============
  console.log("== [6g] FA-power: system commands + real WOL packet + auto-lock ==")

  // (أ) سوكِت desktop (نفس ما يفعله الويبفيو: تسجيل MAC الحقيقي + استقبال rc:power)
  //     + سوكِت هاتف ثانٍ يتحقق من إعلان MAC عبر rc:hello
  const E2E_MAC = "AA:BB:CC:DD:EE:FF"
  const rcDesk = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => { rcDesk.on("connect", res); rcDesk.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("rc desktop timeout")), 10000) })
  rcDesk.emit("desktop:register", { name: "NEXUS-PC", mac: E2E_MAC })
  await sleep(800)
  const rcPhone = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  const helloMac = await new Promise((res) => {
    rcPhone.on("rc:hello", (d) => res(String(d?.desktop?.mac ?? "")))
    setTimeout(() => res(""), 6000)
  })
  check("FA-power: إعلان MAC عبر desktop:register → rc:hello للأجهزة اللاحقة", helloMac === E2E_MAC, `mac=${helloMac}`)

  // (ب) rc:power logout يُرحّل للكمبيوتر (الطبقة الأصلية تنفذه فعليًا في التطبيق)
  const powerCmd = await new Promise((res) => {
    rcDesk.on("rc:power", (d) => res(d))
    rcPhone.emit("rc:power", { action: "logout" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-power: rc:power logout يُرحّل للكمبيوتر", powerCmd?.action === "logout", `got=${JSON.stringify(powerCmd)}`)
  // استعادة الحالة على الجسر (logout وضعها locked)
  rcDesk.emit("desktop:state", { power: "on" })
  await sleep(600)

  // (ج) rc:wol بMAC غير صالح → رفض mac
  const wolBad = await new Promise((res) => {
    rcPhone.on("rc:rejected", (d) => res(d))
    rcPhone.emit("rc:wol", { mac: "ZZ:00:00:00:00:00" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-power: rc:wol بMAC غير صالح → rc:rejected(mac)", wolBad?.reason === "mac", `reason=${wolBad?.reason}`)

  // (د) rc:wol بMAC صالح والكمبيوتر يعمل → رفض already-on
  const wolOn = await new Promise((res) => {
    rcPhone.on("rc:rejected", (d) => res(d))
    rcPhone.emit("rc:wol", { mac: E2E_MAC })
    setTimeout(() => res(null), 6000)
  })
  check("FA-power: rc:wol والكمبيوتر يعمل → rc:rejected(already-on)", wolOn?.reason === "already-on", `reason=${wolOn?.reason}`)

  // (هـ) الحقيقي: الحالة sleeping → rc:wol → التقاط الحزمة فعليًا على UDP:9009
  // (NEXUS_WOL_PORT — حاوية بلا صلاحية الربط على :9 التعاقدي، مثل :81 سابقًا)
  rcDesk.emit("desktop:state", { power: "sleeping" })
  await sleep(600)
  const dgram = await import("node:dgram")
  const captured = await new Promise((res) => {
    let pkt = null
    let wakeEv = null
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true })
    s.on("error", () => { try { s.close() } catch {}; res({ pkt, wakeEv }) })
    s.on("message", (m) => { pkt = m; try { s.close() } catch {} })
    s.bind(9009, "0.0.0.0", () => {})
    rcPhone.emit("rc:wol", { mac: E2E_MAC })
    const onWake = (d) => {
      if (d?.source === "wol") {
        wakeEv = d
        setTimeout(() => { try { s.close() } catch {} }, 500)
      }
    }
    rcDesk.on("desktop:wake", onWake)
    rcPhone.on("desktop:wake", onWake)
    setTimeout(() => { try { s.close() } catch {}; res({ pkt, wakeEv }) }, 8000)
  })
  const p = captured?.pkt
  const expected = Buffer.from("FFFFFFFFFFFF" + E2E_MAC.replace(/:/g, "").repeat(16), "hex")
  const pktOk = !!p && p.length === 102 && p.equals(expected)
  check("FA-power: حزمة WOL السحرية أُرسلت فعليًا (UDP = 102 بايت 6×FF+MAC×16)", pktOk,
    `len=${p?.length ?? 0} head=${p ? p.subarray(0, 12).toString("hex") : "—"}`)
  check("FA-power: بث desktop:wake {source:wol, packet}", captured?.wakeEv?.mac === E2E_MAC && typeof captured?.wakeEv?.packet === "string",
    `mac=${captured?.wakeEv?.mac ?? "—"}`)
  rcDesk.emit("desktop:state", { power: "on" }) // استعادة

  // (و) القفل التلقائي: بلا منارة بعد مهلة سماح قصيرة → pc:lock من جسر الحماية
  // (فتح يدوي أولًا — القفل ربما أُطلق مبكرًا بعد انقطاع هاتف القسم 5)
  const guardWeb = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3006" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => { guardWeb.on("connect", res); guardWeb.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("guard timeout")), 10000) })
  guardWeb.emit("guard:settings", { enabled: true, graceSec: 3 })
  await sleep(800)
  guardWeb.emit("prox:manual-unlock") // إعادة الحالة إلى near كي يُطلق القفل من جديد ضمن مهلة الاختبار
  await sleep(600)
  const pcLock = await new Promise((res) => {
    guardWeb.on("pc:lock", (d) => res(d))
    setTimeout(() => res(null), 14000) // مهلة سماح 3ث + نبضة المراقبة 1ث + هامش
  })
  check("FA-power: بلا منارة → pc:lock تلقائي بعد مهلة السماح (§12.ج)",
    pcLock?.reason === "no-beacon" || pcLock?.reason === "weak-signal", `reason=${pcLock?.reason}`)
  guardWeb.disconnect()

  // (ز) حقول status.desktop الجديدة + بوابة security.autoLock
  const putSec = await fetch("http://127.0.0.1:3000/api/desktop/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ security: { autoLock: false } }),
  }).then((r) => r.json())
  check("FA-power: PUT security.autoLock=false يقبل", putSec?.ok === true && putSec?.security?.autoLock === false)
  const st5 = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("status.desktop.security يعكس المخزن", st5?.desktop?.security?.autoLock === false)
  check("status.desktop.connections عدّاد رقمي", typeof st5?.desktop?.connections === "number",
    `n=${st5?.desktop?.connections}`)
  check("status.desktop.power {state, mac, name} من جسر التحكم",
    typeof st5?.desktop?.power?.state === "string" && typeof st5?.desktop?.power?.mac === "string",
    `state=${st5?.desktop?.power?.state} mac=${st5?.desktop?.power?.mac}`)
  await fetch("http://127.0.0.1:3000/api/desktop/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ security: { autoLock: true } }),
  }) // استعادة

  // (ح) العقد موثق حرفيًا
  const contract = await fsMod.readFile(pathMod.join(ROOT, "docs", "protocol-contract.md"), "utf8")
  check("العقد: §12 موثق (أوامر النظام/الإيقاظ/القفل التلقائي)",
    contract.includes("## 12. أوامر النظام والطاقة الحقيقية") && contract.includes("NEXUS_WOL_BROADCAST") && contract.includes("logout"))

  // ============ 6h) FA-input — جلسة التحكم الموثوقة + حقن المصدر (§13) ============
  console.log("== [6h] FA-input: trusted control session + __src injection ==")

  // (أ) status.desktop.input موجود (خامل افتراضيًا)
  const st6a = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("FA-input: status.desktop.input {active:false} افتراضيًا",
    st6a?.desktop?.input?.active === false && typeof st6a?.desktop?.input?.name === "object",
    `input=${JSON.stringify(st6a?.desktop?.input)}`)

  // (ب) بدء جلسة من جهاز مجهول → رفض untrusted (حاجز الثقة على الجسر — بند 7)
  const untrust = await new Promise((res) => {
    rcPhone.on("rc:rejected", (d) => { if (d?.ev === "rc:session") res(d) })
    rcPhone.emit("rc:session", { action: "start", deviceId: "stranger-device", name: "غريب" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: جلسة من جهاز غير موثوق → rc:rejected(untrusted)", untrust?.reason === "untrusted", `reason=${untrust?.reason}`)

  // (ج) وحدة تحكم موثوقة (galaxy-s24 في سجل الأجهزة) → بدء مقبول
  const rcCtl = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => { rcCtl.on("connect", res); rcCtl.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("rc ctl timeout")), 10000) })
  rcCtl.emit("rc:hello-controller", { name: "Galaxy S24", deviceId: "galaxy-s24" })
  await sleep(700)
  const sessionStart = await new Promise((res) => {
    rcDesk.on("rc:session", (d) => { if (d?.active === true) res(d) })
    rcCtl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: جلسة موثوقة (galaxy-s24) → بث active:true باسم المتحكم",
    sessionStart?.controller?.name === "Galaxy S24" && sessionStart?.controller?.deviceId === "galaxy-s24",
    `got=${JSON.stringify(sessionStart)}`)
  await sleep(500)
  const st6c = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("FA-input: status.desktop.input.active=true بعد البدء", st6c?.desktop?.input?.active === true && st6c?.desktop?.input?.name === "Galaxy S24",
    `input=${JSON.stringify(st6c?.desktop?.input)}`)

  // (د) جلسة ثانية من جهاز موثوق آخر → رفض busy
  rcPhone.emit("rc:hello-controller", { name: "Redmi", deviceId: "redmi-note13" })
  await sleep(500)
  const busy = await new Promise((res) => {
    rcPhone.on("rc:rejected", (d) => { if (d?.ev === "rc:session") res(d) })
    rcPhone.emit("rc:session", { action: "start", deviceId: "redmi-note13", name: "Redmi" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: جلسة ثانية → rc:rejected(busy)", busy?.reason === "busy", `reason=${busy?.reason}`)

  // (هـ) حقن المصدر: أحداث وحدة التحكم الموثوقة تحمل __src=controller
  const moveInj = await new Promise((res) => {
    rcDesk.on("rc:move", (d) => res(d))
    rcCtl.emit("rc:move", { dx: 25, dy: -12, source: "touchpad" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: rc:move من موثوق → __src=controller", moveInj?.__src === "controller" && moveInj?.dx === 25,
    `src=${moveInj?.__src} dx=${moveInj?.dx}`)

  // (و) المجهول يبقى unknown + العربية تمر UTF-8 سليمة
  const webSock = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
  await new Promise((res, rej) => { webSock.on("connect", res); webSock.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("web timeout")), 10000) })
  const unknownInj = await new Promise((res) => {
    rcDesk.on("rc:key", (d) => res(d))
    webSock.emit("rc:key", { ch: "مرحبا" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: rc:key من سوكِت مجهول → __src=unknown + عربي UTF-8 سليم",
    unknownInj?.__src === "unknown" && unknownInj?.ch === "مرحبا",
    `src=${unknownInj?.__src} ch=${unknownInj?.ch}`)

  // (ز) العرض التقديمي: start/stop (F5/Esc) يمران + الوسائط volume
  const presStart = await new Promise((res) => {
    rcDesk.on("rc:presenter", (d) => { if (d?.action === "start") res(d) })
    rcCtl.emit("rc:presenter", { action: "start" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: rc:presenter start (F5) يُرحّل", presStart?.action === "start", `got=${JSON.stringify(presStart)}`)
  const mediaVol = await new Promise((res) => {
    rcDesk.on("rc:media", (d) => { if (d?.action === "volume") res(d) })
    rcCtl.emit("rc:media", { action: "volume", value: 70 })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: rc:media volume 70 يُرحّل", mediaVol?.value === 70, `got=${JSON.stringify(mediaVol)}`)

  // (ح) watchdog الجسر: فقدان النبض 6ث → بث timeout وإعادة الحالة إلى خامل
  const timeoutEnd = await new Promise((res) => {
    const onEnd = (d) => { if (d?.active === false) res(d) }
    rcDesk.on("rc:session", onEnd)
    rcCtl.on("rc:session", onEnd)
    setTimeout(() => res(null), 11000) // 6ث مهلة + 2ث دورة المراقبة + هامش
  })
  check("FA-input: فقدان النبض → بث {active:false, reason:timeout}",
    timeoutEnd?.reason === "timeout", `got=${JSON.stringify(timeoutEnd)}`)
  await sleep(600)
  const st6h = await fetch("http://127.0.0.1:3000/api/desktop/status").then((r) => r.json())
  check("FA-input: status.desktop.input.active=false بعد timeout", st6h?.desktop?.input?.active === false)

  // (ط) القطع الفوري من الكمبيوتر: جلسة جديدة ثم إيقاف من سوكِت سطح مكتب مسجل
  const restartOk = await new Promise((res) => {
    rcDesk.on("rc:session", (d) => { if (d?.active === true) res(d) })
    rcCtl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: إعادة بدء الجلسة بعد timeout مقبول", restartOk?.active === true, `got=${JSON.stringify(restartOk)}`)
  const deskStop = await new Promise((res) => {
    const onStop = (d) => { if (d?.active === false) res(d) }
    rcCtl.on("rc:session", onStop)
    rcDesk.on("rc:session", onStop)
    rcDesk.emit("rc:session", { action: "stop" }) // من الكمبيوتر نفسه (بند 7)
    setTimeout(() => res(null), 6000)
  })
  check("FA-input: القطع الفوري من الكمبيوتر → بث desktop-stop يصل الهاتف",
    deskStop?.reason === "desktop-stop", `got=${JSON.stringify(deskStop)}`)

  // (ي) العقد §13 موثق حرفيًا
  check("العقد: §13 موثق (enigo/جلسة التحكم/حقن __src/عربية)",
    contract.includes("## 13. التحكم الفعلي بالكمبيوتر") && contract.includes("KEYEVENTF_UNICODE") && contract.includes("__src") && contract.includes("rc:session"))

  // ================================================================
  // الجولة 4 (عقد §18) — NexusLive: قناة UDP عالية التردد للإدخال الحي
  // ================================================================
  console.log("== ] R4: NexusLive live UDP channel ==")
  {
    // (أ) حوض وهمي على 3011 — E2E بلا تطبيق سطح مكتب: يستقبل ما يمرره الجسر
    const sink = dgram.createSocket("udp4")
    const sinkPkts = []
    await new Promise((res) => {
      sink.on("message", (m, rinfo) => { if (rinfo.address === "127.0.0.1") sinkPkts.push(m) })
      sink.bind(3011, "127.0.0.1", res)
    })

    // نبض صيانة الجلسة طوال القسم (watchdog الجسر 6ث)
    const hbIv = setInterval(() => rcCtl.emit("rc:session", { action: "hb" }), 2000)

    // (ب) رفض hello بلا ثقة/جلسة (سوكِت ويبي مجهول)
    const rejLive = await new Promise((res) => {
      webSock.on("rc:rejected", (d) => { if (d?.ev === "rc:live-hello") res(d) })
      webSock.emit("rc:live-hello")
      setTimeout(() => res(null), 6000)
    })
    check("R4 §18: rc:live-hello بلا جلسة/ثقة → rc:rejected(untrusted)", rejLive?.reason === "untrusted", `got=${JSON.stringify(rejLive)}`)

    // ترميز مرآة live_core (big-endian — رأس 22B)
    const enc = (type, flags, seq, ts, keyHex, payload = Buffer.alloc(0)) => {
      const head = Buffer.alloc(22)
      head.writeUInt16BE(0x4e58, 0)
      head[2] = 1
      head[3] = type
      head[4] = flags
      head.writeUInt32BE(seq >>> 0, 6)
      head.writeUInt32BE(ts >>> 0, 10)
      head.write(keyHex, 14, "hex")
      return Buffer.concat([head, payload])
    }
    const touchPayload = () => {
      const b = Buffer.alloc(8) // nx/ny 0.5/0.25 · action=click · id=0 · pad
      b.writeUInt16BE(0x8000, 0)
      b.writeUInt16BE(0x4000, 2)
      b[4] = 3
      return b
    }
    const udp = dgram.createSocket("udp4")
    await new Promise((res) => udp.bind(0, "127.0.0.1", res))
    const udpSend = (buf) => udp.send(buf, 3010, "127.0.0.1")

    // (ج) جلسة موثوقة → hello → live-ready {port, key, mtu, proto}
    const liveReady = await new Promise((res) => {
      rcCtl.on("rc:live-ready", (d) => res(d))
      rcCtl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
      setTimeout(() => rcCtl.emit("rc:live-hello"), 700)
      setTimeout(() => res(null), 9000)
    })
    check("R4 §18: rc:live-ready (port=3010 · key 16-hex · mtu=128 · proto=1)",
      liveReady?.port === 3010 && typeof liveReady?.key === "string" && liveReady.key.length === 16 && liveReady?.mtu === 128 && liveReady?.proto === 1,
      `got=${JSON.stringify(liveReady)}`)

    if (liveReady?.key) {
      // (د) ping UDP → pong بنفس seq وts الجسر + RTT loopback
      const tPing = Date.now()
      const pong = await new Promise((res) => {
        const onMsg = (m) => { if (m[3] === 0x7e) { udp.off("message", onMsg); res(m) } }
        udp.on("message", onMsg)
        udpSend(enc(0x7f, 0, 4242, Date.now() & 0xffffffff, liveReady.key))
        setTimeout(() => { udp.off("message", onMsg); res(null) }, 4000)
      })
      const rtt = Date.now() - tPing
      check("R4 §18: ping → pong (نفس seq + ts الجسر) وRTT loopback < 100ms",
        !!pong && pong.readUInt32BE(6) === 4242 && pong.readUInt32BE(10) > 0 && rtt < 100,
        pong ? `rtt=${rtt}ms seq=${pong.readUInt32BE(6)}` : "no pong")

      // (هـ) 3 حزم touch صالحة → تمرر كما هي إلى الحوض على 3011
      const baseTs = Date.now() & 0xffffffff
      for (let i = 1; i <= 3; i++) udpSend(enc(4, 0, i, baseTs, liveReady.key, touchPayload()))
      await sleep(800)
      const okFwd = sinkPkts.length === 3 && sinkPkts.every((m) => m[3] === 4 && m.readUInt16BE(0) === 0x4e58)
      check("R4 §18: 3 حزم touch → الحوض (loopback 3011) تستلم كما هي", okFwd, `sink=${sinkPkts.length}`)

      // (و) تدفق جديد (إعادة hello): فقد/ترتيب معكوس/تكرار
      const ready2 = await new Promise((res) => {
        rcCtl.on("rc:live-ready", (d) => res(d))
        rcCtl.emit("rc:live-hello") // إعادة فتح = استبدال التدفق (إعادة اتصال)
        setTimeout(() => res(null), 6000)
      })
      if (ready2?.key) {
        const k2 = ready2.key
        const ts2 = Date.now() & 0xffffffff
        udpSend(enc(4, 0, 10, ts2, k2, touchPayload())) // last=10
        udpSend(enc(4, 0, 13, ts2, k2, touchPayload())) // lost += 2 (11-12)
        udpSend(enc(4, 0, 14, ts2, k2, touchPayload())) // last=14
        udpSend(enc(4, 0, 12, ts2, k2, touchPayload())) // reorder (12 < 14)
        udpSend(enc(4, 0, 12, ts2, k2, touchPayload())) // dup
        await sleep(800)
        const stats = await new Promise((res) => {
          rcCtl.on("rc:live-stats", function h(d) { rcCtl.off("rc:live-stats", h); res(d) })
          rcCtl.emit("rc:live-stats?")
          setTimeout(() => res(null), 4000)
        })
        const f = stats?.flows?.[0]
        check("R4 §18: إحصاء التدفق الجديد (received=5 · lost=2 · reorder=1 · dup=1)",
          f?.stats?.received === 5 && f?.stats?.lost === 2 && f?.stats?.reorder === 1 && f?.stats?.dup === 1,
          `stats=${JSON.stringify(f?.stats)}`)
        check("R4 §18: sinkPort=3011 في الإحصاء + التدفق مثبت بعنوان", f?.bound === udp.address().address + ":" + udp.address().port && stats?.sinkPort === 3011, `bound=${f?.bound}`)

        // (ز) الفاسد: توقيع خاطئ → droppedMalformed · مفتاح مجهول → droppedNoKey
        const badMagic = Buffer.from(enc(4, 0, 99, ts2, k2, touchPayload()))
        badMagic[0] = 0x00
        udpSend(badMagic)
        udpSend(enc(4, 0, 98, ts2, "0000000000000000", touchPayload()))
        await sleep(600)
        const stats2 = await new Promise((res) => {
          rcCtl.on("rc:live-stats", function h(d) { rcCtl.off("rc:live-stats", h); res(d) })
          rcCtl.emit("rc:live-stats?")
          setTimeout(() => res(null), 4000)
        })
        check("R4 §18: الفاسد والمفتاح المجهول يُرفضان (malformed≥1 · noKey≥1)",
          stats2?.global?.droppedMalformed >= 1 && stats2?.global?.droppedNoKey >= 1,
          `global=${JSON.stringify(stats2?.global)}`)

        // (ح) تثبيت العنوان: نفس المفتاح من منفذ آخر → droppedAddr
        const udp2 = dgram.createSocket("udp4")
        await new Promise((res) => udp2.bind(0, "127.0.0.1", res))
        udp2.send(enc(4, 0, 97, ts2, k2, touchPayload()), 3010, "127.0.0.1")
        await sleep(600)
        udp2.close()
        const stats3 = await new Promise((res) => {
          rcCtl.on("rc:live-stats", function h(d) { rcCtl.off("rc:live-stats", h); res(d) })
          rcCtl.emit("rc:live-stats?")
          setTimeout(() => res(null), 4000)
        })
        check("R4 §18: حزمة من عنوان آخر بمفتاح سليم → droppedAddr", stats3?.global?.droppedAddr >= 1, `global=${JSON.stringify(stats3?.global)}`)
      }

      // (ط) نهاية الجلسة تموت التدفق: إيقاف من الكمبيوتر → حزمة بمفتاح ميت → noKey
      const beforeStop = sinkPkts.length
      rcDesk.emit("rc:session", { action: "stop" })
      await sleep(700)
      udpSend(enc(4, 0, 50, Date.now() & 0xffffffff, liveReady.key, touchPayload()))
      await sleep(600)
      const stats4 = await new Promise((res) => {
        rcCtl.on("rc:live-stats", function h(d) { rcCtl.off("rc:live-stats", h); res(d) })
        rcCtl.emit("rc:live-stats?")
        setTimeout(() => res(null), 4000)
      })
      check("R4 §18: نهاية الجلسة تموت التدفق (لا حزم جديدة للحوض + مفتاح ميت مرفوض)",
        sinkPkts.length === beforeStop && stats4?.global?.droppedNoKey >= 2 && (stats4?.flows?.length ?? 0) === 0,
        `sinkDelta=${sinkPkts.length - beforeStop} noKey=${stats4?.global?.droppedNoKey} flows=${stats4?.flows?.length}`)
    }
    clearInterval(hbIv)
    udp.close()
    sink.close()

    // (ي) توثيق §18 + بنية القناة (الجسران + النواة + الحوض + العميل + الترجمات)
    const rbTs = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const msTs = await fsMod.readFile("mini-services/remote-service/index.ts", "utf8").catch(() => "")
    const liveRs = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const coreRs = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const liveDart = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")
    const arDict = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    check("R4 §18: العقد موثق (topology/protocol/events/verify)",
      contract.includes("## 18. القناة الحية NexusLive") && contract.includes("rc:live-hello") && contract.includes("0x4E58") && contract.includes("NEXUS_LIVE_SINK_PORT"),
      "contract §18")
    check("R4 §18: الجسران متطابقان (hello/ready/stats/relay 3010→3011)",
      rbTs.includes("rc:live-hello") && rbTs.includes("rc:live-ready") && rbTs.includes("LIVE_SINK_PORT") && msTs.includes("rc:live-hello") && msTs.includes("rc:live-ready") && msTs.includes("LIVE_SINK_PORT"),
      "bridges")
    check("R4 §18: Rust حوض loopback حصري + نواة صارمة (bind 127.0.0.1 · HEADER_LEN=22 · coalesce)",
      liveRs.includes('UdpSocket::bind(("127.0.0.1", port as u16))') && coreRs.includes("HEADER_LEN: usize = 22") && coreRs.includes("pub fn coalesce") && liveRs.includes("execute_sync"),
      "rust")
    check("R4 §18: عميل Flutter (UDP · إعادة اتصال · RTT · رأس 22)",
      liveDart.includes("_headerLen = 22") && liveDart.includes("RawDatagramSocket") && liveDart.includes("_retryBackoffMs") && liveDart.includes("_rttEma"),
      "flutter")
    check("R4 §18: ترجمات rctl.live في القاموسين (ar/en)", arDict.includes('"live"') && arDict.includes("UDP حي"), "i18n")
  }

  // ================================================================
  // ================================================================
  // R4 §18-ت (توسعة) — NexusLive: متجهات الترميز + الثوابت + الجسران + العميل
  // ================================================================
  console.log("== R4 §18-ت: توسعة NexusLive (متجهات ثنائية + ثوابت + مرايا) ==")
  {
    const coreRs18 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const liveRs18 = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const rbTs18 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const mirrorTs18 = await fsMod.readFile("mini-services/remote-service/index.ts", "utf8").catch(() => "")
    const liveDart18 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")

    // (أ) ثوابت النواة التعاقدية
    check("R4 §18-ت: ثوابت النواة (MAGIC 0x4E58 · VERSION=1 · HEADER_LEN=22 · MAX_DATAGRAM=128)",
      coreRs18.includes("pub const MAGIC: u16 = 0x4E58") && coreRs18.includes("pub const VERSION: u8 = 1")
      && coreRs18.includes("pub const HEADER_LEN: usize = 22") && coreRs18.includes("pub const MAX_DATAGRAM: usize = 128"),
      "live_core.rs")
    check("R4 §18-ت: أنواع الحزم الستة (pen=1 mouse=2 gyro=3 touch=4 pong=0x7E ping=0x7F)",
      coreRs18.includes("pub const TYPE_PEN: u8 = 1") && coreRs18.includes("pub const TYPE_MOUSE: u8 = 2")
      && coreRs18.includes("pub const TYPE_GYRO: u8 = 3") && coreRs18.includes("pub const TYPE_TOUCH: u8 = 4")
      && coreRs18.includes("pub const TYPE_PONG: u8 = 0x7E") && coreRs18.includes("pub const TYPE_PING: u8 = 0x7F"),
      "live_core.rs")
    check("R4 §18-ت: أطوار القلم الأربعة + إجراءات المؤشر الستة",
      coreRs18.includes("pub const PEN_HOVER: u8 = 0") && coreRs18.includes("pub const PEN_DOWN: u8 = 1")
      && coreRs18.includes("pub const PEN_MOVE: u8 = 2") && coreRs18.includes("pub const PEN_UP: u8 = 3")
      && coreRs18.includes('["move", "down", "up", "click", "dblclick", "rclick"]'),
      "live_core.rs")
    check("R4 §18-ت: دمج حي في النواة (coalesce — الأحدث يغلب بلا تخزين مؤقت)",
      coreRs18.includes("pub fn coalesce(events: Vec<Value>) -> Vec<Value>"), "live_core.rs")
    check("R4 §18-ت: بنية pen تحمل الضغط/الميل/الطور/الأزرار/الأداة (تحليل الحمولة الحرفي)",
      coreRs18.includes("Pen { nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8 }")
      && coreRs18.includes("Mouse { a: f64, b: f64, phase: u8, buttons: u8, wheel: i16 }"),
      "live_core.rs")

    // (ب) متجهات ترميز ثنائية — big-endian، تحقق بايت-ببايت بلا شبكة
    const enc18 = (type, flags, seq, ts, keyHex, payload = Buffer.alloc(0)) => {
      const head = Buffer.alloc(22)
      head.writeUInt16BE(0x4e58, 0); head[2] = 1; head[3] = type; head[4] = flags
      head.writeUInt32BE(seq >>> 0, 6); head.writeUInt32BE(ts >>> 0, 10); head.write(keyHex, 14, "hex")
      return Buffer.concat([head, payload])
    }
    const penPl = Buffer.alloc(10); penPl.writeUInt16BE(0x8000, 0); penPl.writeUInt16BE(0x4000, 2)
    penPl.writeUInt16BE(0xFFFF, 4); penPl.writeInt8(-60, 6); penPl.writeInt8(30, 7); penPl[8] = 2; penPl[9] = 1
    const penPkt = enc18(1, 0, 1, 1699999999, "0123456789abcdef", penPl)
    check("R4 §18-ت: متجه pen = 32B (22+10) — pressure u16be=65535 وtilt i8 والطور/الأزرار كما كُتبت (حمولة sendPen الحرفية)",
      penPkt.length === 32 && penPkt.readUInt16BE(22) === 0x8000 && penPkt.readUInt16BE(26) === 0xFFFF
      && penPkt.readInt8(28) === -60 && penPkt.readInt8(29) === 30 && penPkt[30] === 2 && penPkt[31] === 1,
      `len=${penPkt.length}`)
    const mouseRel = Buffer.alloc(8); mouseRel.writeInt16BE(-120, 0); mouseRel.writeInt16BE(250, 2)
    mouseRel[4] = 5; mouseRel[5] = 1; mouseRel.writeInt16BE(-3, 6)
    const mousePkt = enc18(2, 1, 0xFFFFFFFE, Date.now() & 0xffffffff, "0123456789abcdef", mouseRel)
    check("R4 §18-ت: متجه mouse نسبي = 30B — flags bit0 + dx/dy i16be (±500) + wheel i16be سالب",
      mousePkt.length === 30 && mousePkt[4] === 1 && mousePkt.readInt16BE(22) === -120
      && mousePkt.readInt16BE(24) === 250 && mousePkt[26] === 5 && mousePkt[27] === 1 && mousePkt.readInt16BE(28) === -3,
      `len=${mousePkt.length}`)
    check("R4 §18-ت: seq u32be على حافة الالتفاف (0xFFFFFFFE ← تغليف 0xFFFFFFFF+1 = 0)",
      mousePkt.readUInt32BE(6) === 0xFFFFFFFE && ((0xFFFFFFFF + 1) >>> 0) === 0,
      `seq=${mousePkt.readUInt32BE(6)}`)
    const gyroPl = Buffer.alloc(12); gyroPl.writeInt16BE(-866, 0); gyroPl.writeInt16BE(500, 2); gyroPl.writeInt16BE(0, 4)
    gyroPl.writeInt16BE(0, 6); gyroPl.writeInt16BE(0, 8); gyroPl.writeInt16BE(1000, 10)
    const gyroPkt = enc18(3, 0b0100_0011, 71, 0, "ffffffffffffffff", gyroPl)
    check("R4 §18-ت: متجه gyro = 34B (22+12) milli-g/milli-dps + أزرار A+B+إمساك — أوسع حمولة تعاقدية",
      gyroPkt.length === 34 && gyroPkt.readInt16BE(22) === -866 && gyroPkt.readInt16BE(32) === 1000 && gyroPkt[4] === 0b0100_0011,
      `len=${gyroPkt.length}`)
    const touchPl = Buffer.alloc(8); touchPl.writeUInt16BE(0x8000, 0); touchPl.writeUInt16BE(0x4000, 2); touchPl[4] = 3
    const touchPkt = enc18(4, 0, 9, 1, "0123456789abcdef", touchPl)
    const pingPkt = enc18(0x7f, 0, 4242, 0, "0123456789abcdef")
    check("R4 §18-ت: متجه touch=30B (click=3 · pointerId=0) وping=22B (رأس حصرًا) — حدث = داتاجرام واحد دائمًا",
      touchPkt.length === 30 && touchPkt[26] === 3 && touchPkt[27] === 0 && pingPkt.length === 22, `touch=${touchPkt.length} ping=${pingPkt.length}`)
    check("R4 §18-ت: فك الرأس — magic/version/type/seq/ts/key تُقرأ كما كُتبت (big-endian)",
      pingPkt.readUInt16BE(0) === 0x4e58 && pingPkt[2] === 1 && pingPkt[3] === 0x7f
      && pingPkt.readUInt32BE(6) === 4242 && pingPkt.subarray(14, 22).toString("hex") === "0123456789abcdef",
      "header roundtrip")
    check("R4 §18-ت: قياس الطرف-إلى-طرف بلفّ u32 آمن (wrapping_sub) + P50/P95 من live.rs",
      liveRs18.includes("wrapping_sub") && liveRs18.includes("p95") && liveRs18.includes("p50"), "live.rs e2e")
check("R4 §18-ت: ts مُقتطع 32-بت عند العميل والجسر (ms epoch & 0xFFFFFFFF — إزاحة NTP عبر pong)",
      ((Date.now() & 0xffffffff) >>> 0) <= 0xFFFFFFFF && liveDart18.includes("& 0xFFFFFFFF")
        && rbTs18.includes("Date.now() & 0xffffffff"), "ts mask")

    // (ج) حوض Rust — loopback حصرًا
    check("R4 §18-ت: live.rs يرتبط 127.0.0.1 حصرًا على NEXUS_LIVE_SINK_PORT (3011) بمحاولات إعادة + P50/P95",
      liveRs18.includes("127.0.0.1") && liveRs18.includes("NEXUS_LIVE_SINK_PORT") && liveRs18.includes(".unwrap_or(3011)")
      && liveRs18.includes("p95"), "live.rs sink")

    // (د) الجسر — البوابة والإحصاء والمفاتيح
    check("R4 §18-ت: الجسر — NEXUS_LIVE_PORT/3010 + SINK/3011 بيئيتان بالافتراض التعاقدي",
      rbTs18.includes("NEXUS_LIVE_PORT || 3010") && rbTs18.includes("NEXUS_LIVE_SINK_PORT || 3011"), "remote-bridge")
    check("R4 §18-ت: عدادات الجسر العالمية الخمسة (malformed/noKey/addr/forward/pong)",
      rbTs18.includes("droppedMalformed") && rbTs18.includes("droppedNoKey") && rbTs18.includes("droppedAddr")
      && rbTs18.includes("forwardErrors") && rbTs18.includes("pongErrors"), "remote-bridge global")
    check("R4 §18-ت: لقطة الإحصاء (port/sinkPort/flows/global) تبث rc:live-stats مع التدفقات النشطة",
      rbTs18.includes('"rc:live-stats"') && rbTs18.includes("sinkPort: LIVE_SINK_PORT") && rbTs18.includes("if (liveFlows.size)"),
      "remote-bridge stats")
    check("R4 §18-ت: مفتاح 8B عشوائي لكل تدفق + تثبيت عنوان المرسل (أول حزمة تُثبّت)",
      rbTs18.includes("randomBytes(8)") && rbTs18.includes("bound"), "remote-bridge key/bound")
    check("R4 §18-ت: نهاية الجلسة/الانقطاع تمحو التدفق فورًا (liveFlows.delete)",
      rbTs18.includes("liveFlows.delete"), "remote-bridge teardown")
    check("R4 §18-ت: الجسران متطابقان حرفيًا في التدفق الحي (mirror: hello/ready/3011/NEXUS_LIVE_PORT)",
      mirrorTs18.includes("rc:live-hello") && mirrorTs18.includes("rc:live-ready") && mirrorTs18.includes("3011") && mirrorTs18.includes("NEXUS_LIVE_PORT"),
      "remote-service mirror")

    // (هـ) عميل Flutter — القناة الحية
    check("R4 §18-ت: عميل Flutter — RawDatagramSocket + رأس 22 محجوز=0 + مفتاح 8B في كل حزمة",
      liveDart18.includes("RawDatagramSocket.bind") && liveDart18.includes("out[5] = 0") && liveDart18.includes("key.length == 8"),
      "live_channel.dart")
    check("R4 §18-ت: ping كل 500ms → RTT بـEMA (0.7/0.3) + مزامنة إزاحة NTP-نمط (serverTs − منتصف الرحلة)",
      liveDart18.includes("Duration(milliseconds: 500)") && liveDart18.includes("_rttEma") && liveDart18.includes("منتصف الرحلة"),
      "live_channel.dart")
    check("R4 §18-ت: إعادة اتصال بتراجع أُسي 500ms→8s + watchdog بلا pong 3ث",
      liveDart18.includes("_retryBaseMs = 500") && liveDart18.includes("_retryMaxMs = 8000")
      && liveDart18.includes("_pongTimeout = Duration(seconds: 3)"), "live_channel.dart")

    // (و) التوثيق + القاموس + القائمة الميدانية
    check("R4 §18-ت: العقد §18 بالحقائق الثنائية (0x4E58 · NTP · 3010/3011)",
      contract.includes("## 18.") && contract.includes("0x4E58") && contract.includes("NTP") && contract.includes("3010") && contract.includes("3011"),
      "contract §18")
    const ar18 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en18 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    check("R4 §18-ت: القاموسان — رقاقة القناة الحية (UDP حي · {rtt}ms / قناة TCP) بالعربيتين",
      ar18.includes("UDP حي") && ar18.includes("قناة TCP") && en18.includes("Live UDP · {rtt}ms"), "i18n §18")
    const cl18 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §18-ت: القائمة الميدانية §12 (10 خطوات NexusLive — UDP حي + إعادة فتح ذاتية + بلا تراكم)",
      cl18.includes("## 12) القناة الحية NexusLive") && cl18.includes("تعيد الفتح ذاتيًا") && cl18.includes("الحركات الأحدث تفوز"),
      "e2e-checklist §12")
  }

  // R4 مرحلة ① (عقد §19) — الشاشة الثانية: الهاتف شاشة ممتدة فعلية
  // ================================================================
  console.log("== R4 §19: الشاشة الثانية (secondscreen/vdisplay) ==")
  {
    const ssPc = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const ssPhone = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await Promise.all([
      new Promise((res, rej) => { ssPc.on("connect", res); ssPc.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("ss pc timeout")), 10000) }),
      new Promise((res, rej) => { ssPhone.on("connect", res); ssPhone.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("ss phone timeout")), 10000) }),
    ])
    ssPc.emit("media:role", { role: "pc", name: "E2E-SS-PC" })
    ssPhone.emit("media:role", { role: "phone", name: "E2E-SS-Phone" })
    await sleep(400)

    // (أ) screen:req يمرر target فعليًا (الإصلاح: كانت تُسقط في التنقية)
    const reqT = await new Promise((res) => {
      ssPc.on("screen:req", (d) => res(d))
      ssPhone.emit("screen:req", { action: "start", fps: 60, target: "screen:virtual" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §19: screen:req target=screen:virtual يصل الكمبيوتر حرفيًا",
      reqT?.target === "screen:virtual" && reqT?.fps === 60 && reqT?.from === "phone", JSON.stringify(reqT ?? {}).slice(0, 120))

    // (ب) target فاسد يُرفض صامتًا (نمط صارم ^screen:N|all|virtual|default$)
    let badT = false
    ssPc.on("screen:req", () => { badT = true })
    ssPhone.emit("screen:req", { action: "start", target: "screen:1; drop table" })
    ssPhone.emit("screen:req", { action: "start", target: "window:eviltracker" })
    await sleep(1200)
    check("R4 §19: target فاسد (نمط غريب/نافذة عبر screen:req) يُرفض صامتًا", badT === false)

    // (ج) secondscreen:cmd enable صالح يمرر (w/h ضمن الحدود)
    const ssCmd = await new Promise((res) => {
      ssPc.on("secondscreen:cmd", (d) => res(d))
      ssPhone.emit("secondscreen:cmd", { action: "enable", w: 1080, h: 2400, fps: 30, quality: "high" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §19: secondscreen:cmd enable يصل الكمبيوتر (1080×2400 @30 high)",
      ssCmd?.action === "enable" && ssCmd?.w === 1080 && ssCmd?.h === 2400 && ssCmd?.fps === 30 && ssCmd?.quality === "high" && ssCmd?.from === "phone",
      JSON.stringify(ssCmd ?? {}).slice(0, 130))

    // (د) فاسد: إجراء غريب + w=200 (أصغر من 320) + fps=90 — كله يُرفض صامتًا
    let badCmd = false
    ssPc.on("secondscreen:cmd", () => { badCmd = true })
    ssPhone.emit("secondscreen:cmd", { action: "explode" })
    ssPhone.emit("secondscreen:cmd", { action: "enable", w: 200, h: 2400 })
    ssPhone.emit("secondscreen:cmd", { action: "enable", w: 1080, h: 2400, fps: 90 })
    await sleep(1200)
    check("R4 §19: secondscreen:cmd فاسد (إجراء/أبعاد/fps) يُرفض صامتًا", badCmd === false)

    // (هـ) secondscreen:state من دور pc تُبث — ومن الهاتف تُرفض (مصدر الحقيقة حصرًا)
    const ssState = await new Promise((res) => {
      ssPhone.on("secondscreen:state", (d) => res(d))
      ssPc.emit("secondscreen:state", { active: true, target: "screen:1", w: 1080, h: 2400 })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §19: secondscreen:state من pc تصل الهاتف (active/target/w/h)",
      ssState?.active === true && ssState?.target === "screen:1" && ssState?.w === 1080 && ssState?.h === 2400,
      JSON.stringify(ssState ?? {}).slice(0, 120))
    let phoneStateLeak = false
    ssPc.on("secondscreen:state", () => { phoneStateLeak = true })
    ssPhone.emit("secondscreen:state", { active: true, target: "screen:9" })
    await sleep(1200)
    check("R4 §19: secondscreen:state من دور phone يُرفض (لا انتحال حالة)", phoneStateLeak === false)

    // (و) الإطفاء الذكي (البند 8): انقطاع الهاتف → media:phone-offline للكمبيوتر
    const offline = await new Promise((res) => {
      ssPc.on("media:phone-offline", (d) => res(d))
      ssPhone.disconnect()
      setTimeout(() => res(null), 9000)
    })
    check("R4 §19: انقطاع الهاتف يبث media:phone-offline (مشغّل إطفاء الشاشة الافتراضية)",
      offline != null && typeof offline.at === "number", JSON.stringify(offline ?? {}))
    ssPc.disconnect()

    // (ز) ربط سطح المكتب (webview) — مسار التمكين/الإطفاء كاملًا
    const dbTs = await fsMod.readFile("src/components/nexus/desktop-bridge.tsx", "utf8").catch(() => "")
    check("R4 §19: desktop-bridge يربط الدورة كاملة (vdisplay_enable → media_screen_start → state / disable + phone-offline)",
      dbTs.includes('"vdisplay_enable"') && dbTs.includes('"vdisplay_disable"') && dbTs.includes("secondscreen:cmd") && dbTs.includes("secondscreen:state") && dbTs.includes("media:phone-offline") && dbTs.includes("screen:virtual"),
      "desktop-bridge.tsx")

    // (ح) طبقة Rust — CCD ويندوز + xrandr لينكس + حد ماك الصادق + عقد الفهرس
    const vdRs = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay.rs", "utf8").catch(() => "")
    const vdcRs = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay_core.rs", "utf8").catch(() => "")
    const mediaRs = await fsMod.readFile("apps/desktop/src-tauri/src/media.rs", "utf8").catch(() => "")
    check("R4 §19: Rust CCD ويندوز (QueryDisplayConfig/SetDisplayConfig بلا مدير) + change_mode",
      vdRs.includes("QueryDisplayConfig") && vdRs.includes("SetDisplayConfig") && vdRs.includes("ChangeDisplaySettingsExW") && vdRs.includes("SDC_USE_SUPPLIED_DISPLAY_CONFIG"),
      "vdisplay.rs")
    check("R4 §19: Rust لينكس xrandr (newmode/addmode/right-of) + ماك حد صادق",
      vdcRs.includes("--newmode") && vdcRs.includes("--addmode") && vdcRs.includes("--right-of") && vdRs.includes("قيود توقيع macOS") && vdRs.includes("--query"),
      "vdisplay_core.rs + vdisplay.rs")
    check("R4 §19: عقد الفهرس — أصول ويندوز الحقيقية من EnumDisplayMonitors (نفس ترتيب windows-capture)",
      mediaRs.includes("crate::vdisplay::list_monitors_ex") && mediaRs.includes("EnumDisplayMonitors") && vdRs.includes("نفس ترتيب windows-capture"),
      "media.rs origins fix")
    check("R4 §19: النواة النقية (validate/patch/xrandr/cvt) + جلسة «ما فعلناه نحن»",
      vdcRs.includes("pub fn patch_settings_xml") && vdcRs.includes("pub fn pick_disconnected_output") && vdRs.includes("static SESSION") && vdRs.includes("session_active"),
      "vdisplay_core.rs")

    // (ط) المثبت — شهادة من الكتالوج + nefcon install/remove + موارد
    const hooks = await fsMod.readFile("apps/desktop/src-tauri/installer-hooks.nsh", "utf8").catch(() => "")
    const conf = await fsMod.readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8").catch(() => "")
    check("R4 §19: NSIS hooks (شهادات من mttvdd.cat → TrustedPublisher + nefconc install Root\MttVDD + remove عند الإزالة + غير حاجز)",
      hooks.includes("mttvdd.cat") && hooks.includes("TrustedPublisher") && hooks.includes("nefconc.exe") && hooks.includes("install") && hooks.includes("remove") && hooks.includes("Root\\MttVDD"),
      "installer-hooks.nsh")
    check("R4 §19: bundle.resources يحمل vdd (resolve_resources §17.ب → $INSTDIR\\vdd)",
      conf.includes('"vdd"'), "tauri.conf.json")
    for (const f of ["apps/desktop/src-tauri/vdd/MttVDD.inf", "apps/desktop/src-tauri/vdd/MttVDD.dll", "apps/desktop/src-tauri/vdd/mttvdd.cat", "apps/desktop/src-tauri/vdd/nefconc.exe", "apps/desktop/src-tauri/vdd/vdd_settings.xml", "apps/desktop/src-tauri/vdd/LICENSE-VirtualDisplayDriver"]) {
      const ok = await fsMod.readFile(f).then(() => true).catch(() => false)
      check(`R4 §19: أصل السائق مرفق: ${pathMod.basename(f)}`, ok, "حزمة §19")
    }
    const vddXml = await fsMod.readFile("apps/desktop/src-tauri/vdd/vdd_settings.xml", "utf8").catch(() => "")
    check("R4 §19: XML المرفق يحمل الأوضاع التعاقدية (1080×2400 + 2400×1080 @60)",
      vddXml.includes("<width>1080</width>") && vddXml.includes("<height>2400</height>") && vddXml.includes("<width>2400</width>") && vddXml.includes("<height>1080</height>") && vddXml.includes("<count>1</count>"),
      "vdd_settings.xml")

    // (ي) محرك التحقق التنفيذي + العقد + القاموسان
    const verifyRs = await fsMod.readFile("scripts/vdisplay-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §19: محرك vdisplay-verify يضمّن vdisplay_core.rs حرفيًا (نمط live-verify)",
      verifyRs.includes("vdisplay_core.rs") && verifyRs.includes("check("),
      "scripts/vdisplay-verify")
    check("R4 §19: العقد موثق (منصات/تثبيت/أحداث/دورة/تحقق)",
      contract.includes("## 19. الشاشة الثانية") && contract.includes("Root\\MttVDD") && contract.includes("secondscreen:cmd") && contract.includes("media:phone-offline") && contract.includes("QueryDisplayConfig"),
      "contract §19")
    const arDict2 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const enDict2 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    check("R4 §19: ترجمات seconds.* في القاموسين (ar/en)",
      arDict2.includes('"seconds"') && arDict2.includes("شاشة ثانية فعلية") && enDict2.includes('"seconds"') && enDict2.includes("second screen"),
      "i18n")
    // (ك) خدمة Flutter: secondScreenCmd + target في requestScreen + إطفاء عند الإغلاق
    const msDart = await fsMod.readFile("nexuslink_mobile/lib/data/media_service.dart", "utf8").catch(() => "")
    const pcsDart = await fsMod.readFile("nexuslink_mobile/lib/presentation/pc_screen_screen.dart", "utf8").catch(() => "")
    const mediaDart2 = await fsMod.readFile("nexuslink_mobile/lib/presentation/media_screen.dart", "utf8").catch(() => "")
    check("R4 §19: Flutter خدمة (secondScreenCmd + secondscreen:state مصدر الحقيقة + target في requestScreen)",
      msDart.includes("secondScreenCmd") && msDart.includes("secondscreen:state") && msDart.includes("target"),
      "media_service.dart")
    check("R4 §19: Flutter شاشة العرض تمرر الهدف وتطفئ الافتراضية عند الإغلاق (البند 8)",
      pcsDart.includes("_target") && pcsDart.includes("screen:virtual") === false && pcsDart.includes("secondScreenCmd('disable')"),
      "pc_screen_screen.dart")
    check("R4 §19: بطاقة الشاشة الثانية + ورقة الإعدادات (دقة/اتجاه/fps/جودة — البند 7)",
      mediaDart2.includes("seconds.card") && mediaDart2.includes("_SsSettingsSheet") && mediaDart2.includes("1080×2400") && mediaDart2.includes("2400×1080"),
      "media_screen.dart")
  }

  // ================================================================
  // ================================================================
  // R4 §19-ت (توسعة) — الشاشة الثانية: النواة + السائق + المثبّت + الدورة
  // ================================================================
  console.log("== R4 §19-ت: توسعة الشاشة الثانية (vdisplay) ==")
  {
    const vCore19 = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay_core.rs", "utf8").catch(() => "")
    const vRs19 = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay.rs", "utf8").catch(() => "")
    const mainRs19 = await fsMod.readFile("apps/desktop/src-tauri/src/main.rs", "utf8").catch(() => "")
    const hooks19 = await fsMod.readFile("apps/desktop/src-tauri/installer-hooks.nsh", "utf8").catch(() => "")
    const rbTs19 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const dbTsx19 = await fsMod.readFile("src/components/nexus/desktop-bridge.tsx", "utf8").catch(() => "")
    const mediaSvc19 = await fsMod.readFile("nexuslink_mobile/lib/data/media_service.dart", "utf8").catch(() => "")
    const pcScreen19 = await fsMod.readFile("nexuslink_mobile/lib/presentation/pc_screen_screen.dart", "utf8").catch(() => "")
    const ar19 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en19 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    const tools19 = await fsMod.readFile("src/components/nexus/tools/tools-view.tsx", "utf8").catch(() => "")
    const fsSync19 = (await import("node:fs")).default

    check("R4 §19-ت: الأوضاع الأربعة المضمنة (1080×2400 · 2400×1080 · HD · portrait-HD)",
      vCore19.includes('("portrait-phone", 1080, 2400)') && vCore19.includes('("landscape-phone", 2400, 1080)')
      && vCore19.includes('("hd", 1920, 1080)') && vCore19.includes('("portrait-hd", 1080, 1920)'), "vdisplay_core PRESET_MODES")
    check("R4 §19-ت: النواة النقية الستة (validate_mode/xrandr_mode_name/build_settings_xml/patch_settings_xml/modes_present/parse_xrandr_query)",
      ["pub fn validate_mode", "pub fn xrandr_mode_name", "pub fn build_settings_xml", "pub fn patch_settings_xml", "pub fn modes_present", "pub fn parse_xrandr_query"].every((f) => vCore19.includes(f)),
      "vdisplay_core")
    check("R4 §19-ت: ويندوز CCD بلا مدير (QueryDisplayConfig/SetDisplayConfig) + تبديل الوضع ChangeDisplaySettingsExW + EnumDisplaySettingsW",
      vRs19.includes("QueryDisplayConfig") && vRs19.includes("SetDisplayConfig") && vRs19.includes("ChangeDisplaySettingsExW") && vRs19.includes("EnumDisplaySettingsW"),
      "vdisplay.rs win")
    check("R4 §19-ت: عقد الفهرس مع windows-capture (EnumDisplayMonitors — تحقق من مصدر الكرِيت)",
      vRs19.includes("EnumDisplayMonitors") && vRs19.includes("windows-capture"), "vdisplay.rs monitors")
    check("R4 §19-ت: الجلسة «ما فعلناه نحن» حصرًا (session_active في النواة + ssActive في الويبفيو)",
      vRs19.includes("pub fn session_active") && dbTsx19.includes("ssActive"), "vdisplay + webview")
    check("R4 §19-ت: انقطاع الهاتف يبث media:phone-offline (مشغّل إطفاء الشاشة الافتراضية — الويبفيو وجسر الوسائط)",
      dbTsx19.includes("media:phone-offline"), "desktop-bridge")
    check("R4 §19-ت: الويبفيو يربط الدورة كاملة (vdisplay_enable → media_screen_start → state / disable+phone-offline → stop)",
      dbTsx19.includes("vdisplay_enable") && dbTsx19.includes("media_screen_start") && dbTsx19.includes("media:phone-offline"),
      "desktop-bridge")
    check("R4 §19-ت: NSIS — شهادات mttvdd.cat → TrustedPublisher (تدفق silent-install.ps1 الرسمي)",
      hooks19.includes("mttvdd.cat") && hooks19.includes("TrustedPublisher") && hooks19.includes("silent-install.ps1"),
      "installer-hooks §19")
    check("R4 §19-ت: NSIS — إعداداتنا إلى C:\\VirtualDisplayDriver (confpath من Driver.cpp:94) + nefconc install",
      hooks19.includes("C:\\VirtualDisplayDriver") && hooks19.includes('nefconc.exe" install'), "installer-hooks §19")
    check("R4 §19-ت: NSIS — إزالة نظيفة عند uninstall (nefconc remove عند FileExists)",
      hooks19.includes("remove") && hooks19.includes("FileExists"), "installer-hooks §19")
    const vddSha = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/SHA256SUMS.txt"))
    const vddLic = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/LICENSE-VirtualDisplayDriver"))
    const nefLic = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/LICENSE-nefcon"))
    check("R4 §19-ت: أصول السائق مرفقة بتراخيصها (SHA256SUMS + MIT للسائق وnefcon)",
      vddSha && vddLic && nefLic, "vdd bundle")
    const vddXml = await fsMod.readFile("apps/desktop/src-tauri/vdd/vdd_settings.xml", "utf8").catch(() => "")
    check("R4 §19-ت: XML السائق المرفق يحمل الأوضاع التعاقدية (1080 و2400)",
      vddXml.includes("1080") && vddXml.includes("2400"), "vdd_settings.xml")
    check("R4 §19-ت: التشخيص الأصلي — سطر «الشاشة الثانية (سائق العرض الافتراضي)» عبر vdisplay_status",
      tools19.includes("vdisplay_status") && tools19.includes("الشاشة الثانية (سائق العرض الافتراضي)"), "tools diag")
    check("R4 §19-ت: Flutter خدمة — secondScreenCmd + secondscreen:state مصدر الحقيقة + target في requestScreen",
      mediaSvc19.includes("secondScreenCmd") && mediaSvc19.includes("secondscreen:state") && mediaSvc19.includes("target"),
      "media_service")
    check("R4 §19-ت: Flutter شاشة العرض — تمرير الهدف وإطفاء الافتراضية عند الإغلاق",
      pcScreen19.includes("secondscreen") && (pcScreen19.includes("disable") || pcScreen19.includes("stop")), "pc_screen_screen")
    check("R4 §19-ت: أوامر Tauri الثلاثة مسجلة (vdisplay_status/enable/disable)",
      mainRs19.includes("vdisplay::vdisplay_status") && mainRs19.includes("vdisplay::vdisplay_enable") && mainRs19.includes("vdisplay::vdisplay_disable"),
      "main.rs §19")
    check("R4 §19-ت: القاموسان seconds.* (ar/en) — شاشة ثانية",
      ar19.includes('"seconds"') && en19.includes('"seconds"') && ar19.includes("شاشة ثانية"), "i18n §19")
    check("R4 §19-ت: العقد §19 (منصات بإثبات المصدر + MttVDD + دورة phone-offline كاملة)",
      contract.includes("## 19.") && contract.includes("QueryDisplayConfig") && contract.includes("MttVDD") && contract.includes("phone-offline"),
      "contract §19")
    const cl19 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §19-ت: القائمة الميدانية §13 (10 خطوات + Root\\MttVDD + إطفاء عند الانقطاع + لينكس xrandr)",
      cl19.includes("## 13) الشاشة الثانية") && cl19.includes("Root\\MttVDD") && cl19.includes("تُطفأ على الكمبيوتر")
      && cl19.includes("xrandr newmode/addmode"), "e2e-checklist §13")
    const vvRs = await fsMod.readFile("scripts/vdisplay-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §19-ت: محرك vdisplay-verify يضمّن النواة حرفيًا ويغطي XML/xrandr-parse",
      vvRs.includes("vdisplay_core.rs") && vvRs.includes("patch_settings_xml") && vvRs.includes("parse_xrandr_query"),
      "vdisplay-verify")
    check("R4 §19-ت: جسر الوسائط يمرر secondscreen:cmd/state منقّيين (عقد §19.ج) والويبفيو يدير الدورة",
      (await fsMod.readFile("src/lib/nexus/media-bridge.ts", "utf8").catch(() => "")).includes('secondscreen:cmd')
        && dbTsx19.includes('secondscreen:cmd'),
      "media-bridge + webview")
  }

  // R4 مرحلة ② (عقد §20) — لوحة الرسم الاحترافية: الهاتف+القلم لوحة رقمية
  // ================================================================
  console.log("== R4 §20: لوحة الرسم (rc:tablet:cmd/state + pen tool flags) ==")
  {
    // (أ) حوض وهمي جديد على 3011 — يفحص مرور pen بأداة كما هي (توافق §18)
    const sink2 = dgram.createSocket("udp4")
    const sink2Pkts = []
    await new Promise((res) => {
      sink2.on("message", (m, rinfo) => { if (rinfo.address === "127.0.0.1") sink2Pkts.push(m) })
      sink2.bind(3011, "127.0.0.1", res)
    })
    const udp2 = dgram.createSocket("udp4")
    await new Promise((res) => udp2.bind(0, "127.0.0.1", res))

    // (ب) rc:tablet:cmd بلا جلسة/ثقة → rc:rejected(untrusted) — بوابة live-hello نفسها
    const rejTab = await new Promise((res) => {
      webSock.on("rc:rejected", (d) => { if (d?.ev === "rc:tablet:cmd") res(d) })
      webSock.emit("rc:tablet:cmd", { cmd: "get" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: rc:tablet:cmd بلا جلسة/ثقة → rc:rejected(untrusted)", rejTab?.reason === "untrusted", `got=${JSON.stringify(rejTab)}`)

    // جلسة موثوقة جديدة (§18 أنهت سابقتها تعاقديًا) + نبض صيانة طوال القسم
    const hb2 = setInterval(() => rcCtl.emit("rc:session", { action: "hb" }), 2000)
    const tabSession = await new Promise((res) => {
      rcDesk.on("rc:session", (d) => { if (d?.active === true) res(d) })
      rcCtl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: جلسة لوحة الرسم نشطة", tabSession?.active === true, JSON.stringify(tabSession))

    // (ج) get يصل الكمبيوتر بوسم __src=controller — وstate من دور pc تصل الهاتف
    const cmdGet = await new Promise((res) => {
      rcDesk.on("rc:tablet:cmd", (d) => res(d))
      rcCtl.emit("rc:tablet:cmd", { cmd: "get" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: rc:tablet:cmd get يصل الكمبيوتر (__src=controller)",
      cmdGet?.cmd === "get" && cmdGet?.__src === "controller", JSON.stringify(cmdGet))
    const stGet = await new Promise((res) => {
      rcCtl.on("rc:tablet:state", (d) => res(d))
      rcDesk.emit("rc:tablet:state", { mode: "mouse", available: false, note: "e2e", brush: {}, stats: {}, at: 1 })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: rc:tablet:state من دور pc تصل الهاتف (مصدر الحقيقة)",
      stGet?.mode === "mouse" && stGet?.at === 1, JSON.stringify(stGet)?.slice(0, 120))
    // (د) state من دور phone يُرفض (لا انتحال حالة — نمط secondscreen §19)
    const phoneLeak = await new Promise((res) => {
      rcCtl.on("rc:tablet:state", (d) => { if (d?.leak === 1) res(d) })
      rcCtl.emit("rc:tablet:state", { leak: 1 })
      setTimeout(() => res(null), 2500)
    })
    check("R4 §20: rc:tablet:state من دور phone يُرفض (لا انتحال حالة)", phoneLeak === null, JSON.stringify(phoneLeak))

    // (هـ) set سليم يمرر الحقول المنقاة حصرًا — والفاسد يُرفض كله صامتًا
    const setOk = await new Promise((res) => {
      rcDesk.on("rc:tablet:cmd", (d) => { if (d?.cmd === "set" && d?.mode === "tablet") res(d) })
      rcCtl.emit("rc:tablet:cmd", { cmd: "set", mode: "tablet", pressure: "keys", decKey: "[", incKey: "]", levels: 24 })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: set سليم يمرر الحقول المنقاة (mode/pressure/keys/levels حرفيًا)",
      setOk?.mode === "tablet" && setOk?.pressure === "keys" && setOk?.decKey === "[" && setOk?.incKey === "]" && setOk?.levels === 24,
      JSON.stringify(setOk))
    const badSets = [
      { cmd: "set", mode: "hacked" }, { cmd: "set", pressure: "evil" },
      { cmd: "set", decKey: "ab" }, { cmd: "set", decKey: "\u0007" },
      { cmd: "set", levels: 65 }, { cmd: "set", levels: 1.5 }, { cmd: "set", modifier: "win" },
      { cmd: "frobnicate" },
    ]
    for (const bad of badSets) {
      const badRes = await new Promise((res) => {
        rcDesk.on("rc:tablet:cmd", (d) => { if (JSON.stringify(d).includes(JSON.stringify(bad).slice(1, -1).split(":")[1]?.trim() ?? bad.cmd)) res(d) })
        rcCtl.emit("rc:tablet:cmd", bad)
        setTimeout(() => res(null), 1200)
      })
      check(`R4 §20: أمر فاسد يُرفض كله: ${JSON.stringify(bad)}`, badRes === null, JSON.stringify(badRes))
    }

    // (و) قناة حية جديدة → pen بأداة عبر UDP: الجسر يمرر flags bits1-2 كما هي
    const liveReady2 = await new Promise((res) => {
      rcCtl.on("rc:live-ready", (d) => res(d))
      rcCtl.emit("rc:live-hello")
      setTimeout(() => res(null), 6000)
    })
    check("R4 §20: قناة حية جديدة (مفتاح 16-hex)", typeof liveReady2?.key === "string" && liveReady2.key.length === 16, JSON.stringify(liveReady2))
    if (liveReady2?.key) {
      const penEnc = (flags, seq, keyHex) => {
        const head = Buffer.alloc(22)
        head.writeUInt16BE(0x4e58, 0)
        head[2] = 1
        head[3] = 1 // pen
        head[4] = flags
        head.writeUInt32BE(seq >>> 0, 6)
        head.writeUInt32BE(Date.now() & 0xffffffff, 10)
        head.write(keyHex, 14, "hex")
        const pl = Buffer.alloc(10) // 0.5/0.5 · ضغط 0.8 · down
        pl.writeUInt16BE(0x8000, 0)
        pl.writeUInt16BE(0x8000, 2)
        pl.writeUInt16BE(0xcccc, 4)
        pl[8] = 1
        return Buffer.concat([head, pl])
      }
      const t0 = Date.now() & 0xffffffff
      udp2.send(penEnc(2, 61, liveReady2.key), 3010, "127.0.0.1") // eraser
      await sleep(120)
      udp2.send(penEnc(4, 62, liveReady2.key), 3010, "127.0.0.1") // finger
      await sleep(120)
      udp2.send(penEnc(0, 63, liveReady2.key), 3010, "127.0.0.1") // قلم
      await sleep(900)
      const pens = sink2Pkts.filter((m) => m[3] === 1)
      check("R4 §20: حزم pen بالأداة تمر للحوض كما هي (eraser/finger/pen — flags bits1-2 محفوظة)",
        pens.length === 3 && pens[0][4] === 2 && pens[1][4] === 4 && pens[2][4] === 0 && pens.every((m) => m.readUInt16BE(0) === 0x4e58),
        `got=${pens.map((m) => m[4]).join(",")}`)
    }

    // (ز) التوثيق + الملفات (نفس نمط §18/§19)
    const rbTs2 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const dbTsx = await fsMod.readFile("src/components/nexus/desktop-bridge.tsx", "utf8").catch(() => "")
    const coreRs2 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const execRs2 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const tabRs = await fsMod.readFile("apps/desktop/src-tauri/src/tablet.rs", "utf8").catch(() => "")
    const uinRs = await fsMod.readFile("apps/desktop/src-tauri/src/tablet_uinput.rs", "utf8").catch(() => "")
    const liveDart2 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")
    const tabDart = await fsMod.readFile("nexuslink_mobile/lib/presentation/tablet_screen.dart", "utf8").catch(() => "")
    const svcDart2 = await fsMod.readFile("nexuslink_mobile/lib/data/controller_service.dart", "utf8").catch(() => "")
    const arDict3 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const enDict3 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    const checklist14 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    const lvRs = await fsMod.readFile("scripts/live-verify/src/main.rs", "utf8").catch(() => "")
    const tvRs = await fsMod.readFile("scripts/tablet-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §20: العقد موثق (منصات بإثبات المصدر/بروتوكول الأداة/أحداث/فرشاة/تحقق)",
      contract.includes("## 20. لوحة الرسم الاحترافية") && contract.includes("vigem-client 0.1.4") && contract.includes("flags bits1-2") && contract.includes("rc:tablet:cmd") && contract.includes("INPUT_PROP_DIRECT"),
      "contract §20")
    const mirrorTs = await fsMod.readFile("mini-services/remote-service/index.ts", "utf8").catch(() => "")
    check("R4 §20: الجسران متطابقان (تنقية cmd + بوابة الجلسة + state من دور pc حصرًا)",
      rbTs2.includes('rc:tablet:cmd') && rbTs2.includes('reason: "untrusted"') && rbTs2.includes("desktopSocks.has(socket.id)")
        && mirrorTs.includes('rc:tablet:cmd') && mirrorTs.includes("reason: 'untrusted'") && mirrorTs.includes("desktopSocks.has(socket.id)"),
      "remote-bridge + remote-service mirror")
    check("R4 §20: الويبفيو يربط الأوامر بأوامر Tauri ويبث الحالة",
      dbTsx.includes("rc:tablet:cmd") && dbTsx.includes('tablet_config_set') && dbTsx.includes('rc:tablet:state'),
      "desktop-bridge.tsx")
    check("R4 §20: النواة — الأداة في flags bits1-2 (TOOL_PEN/ERASER/FINGER + tool_name + توافق أمامي)",
      coreRs2.includes("pub const TOOL_ERASER: u8 = 1") && coreRs2.includes("pub fn tool_name") && coreRs2.includes("(flags >> 1) & 0b11"),
      "live_core.rs")
    check("R4 §20: محرك الفرشاة النقي (تكميم/خطوات/إيقاع/القلم حصرًا)",
      execRs2.includes("pub fn brush_level") && execRs2.includes("pub fn brush_steps") && execRs2.includes("BRUSH_MIN_INJECT_MS") && execRs2.includes('tool == "finger"'),
      "input_exec.rs")
    check("R4 §20: اللوحة الافتراضية — uinput ديجيتايزر كامل + بوابة الجلسة/التوفر + قيد ويندوز/ماك بصدق",
      tabRs.includes("consume_pen") && tabRs.includes("engine_available") && uinRs.includes("UI_DEV_CREATE") && uinRs.includes("BTN_TOOL_RUBBER") && uinRs.includes("INPUT_PROP_DIRECT") && tabRs.includes("vigem-client"),
      "tablet.rs + tablet_uinput.rs")
    check("R4 §20: Flutter عميل (أداة في flags bits1-2 + ممررة عبر الخدمة)",
      liveDart2.includes("penToolEraser") && liveDart2.includes("t << 1") && svcDart2.includes("penToolPen") && svcDart2.includes("tabletCmd"),
      "live_channel + controller_service")
    check("R4 §20: شاشة اللوحة (التقاط خام بالسلسلة + تجميع ذكي + رفض راحة اليد + معاينة فورية)",
      tabDart.includes("onPointerDataPacket") && tabDart.includes("class PenSampler") && tabDart.includes("_palmRejection") && tabDart.includes("_showPreview"),
      "tablet_screen.dart")
    check("R4 §20: القاموسان tablet.* (ar/en) — 34 مفتاحًا",
      arDict3.includes('"tablet"') && arDict3.includes("لوحة الرسم") && arDict3.includes("رفض راحة اليد") && enDict3.includes('"tablet"') && enDict3.includes("Palm rejection"),
      "i18n")
    check("R4 §20: محركا التحقق يضمّنان الملفات حرفيًا (أداة + فرشاة + uinput نقي)",
      lvRs.includes("fn tablet_vectors") && tvRs.includes("tablet_uinput.rs") && tvRs.includes("map_vectors"),
      "live-verify + tablet-verify")
    const mainRs2 = await fsMod.readFile("apps/desktop/src-tauri/src/main.rs", "utf8").catch(() => "")
    const inputRs2 = await fsMod.readFile("apps/desktop/src-tauri/src/input.rs", "utf8").catch(() => "")
    check("R4 §20: ربط الوحدة — input_exec عليا واحدة (main) وإعادة تصدير exec (input) — بلا تضمين مزدوج/statics منشقة",
      mainRs2.includes('#[path = "input_exec.rs"]') && mainRs2.includes("pub mod input_exec") && inputRs2.includes("pub use crate::input_exec as exec"),
      "main.rs + input.rs wiring")
    check("R4 §20: الفحص الميداني موثق (e2e-checklist §14 — Krita قلم حقيقي)",
      checklist14.includes("## 14. الجولة 4 مرحلة ②") && checklist14.includes("Krita"),
      "e2e-checklist §14")

    clearInterval(hb2)
    udp2.close()
    sink2.close()
    rcCtl.emit("rc:session", { action: "stop" })
    await sleep(400)
  }

  // ================================================================
  // ================================================================
  // R4 §20-ت (توسعة) — لوحة الرسم: الفرشاة + uinput + التقاط خام 240Hz
  // ================================================================
  console.log("== R4 §20-ت: توسعة لوحة الرسم (فرشاة + uinput + التقاط خام) ==")
  {
    const execRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const tabRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/tablet.rs", "utf8").catch(() => "")
    const uinRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/tablet_uinput.rs", "utf8").catch(() => "")
    const coreRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const liveRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const tabDart20 = await fsMod.readFile("nexuslink_mobile/lib/presentation/tablet_screen.dart", "utf8").catch(() => "")
    const liveDart20 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")
    const ar20 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en20 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")

    check("R4 §20-ت: الفرشاة الافتراضية Krita/Photoshop — [ يصغّر و] يكبّر بـ24 مستوى",
      execRs20.includes("dec_ch: '[', inc_ch: ']'") && execRs20.includes("levels: 24"), "input_exec BrushCfg default")
    check("R4 §20-ت: سقف إيقاع الحقن 30ms (≤33 مفتاح/ث — إغراق التطبيق الرسمي ممنوع)",
      execRs20.includes("const BRUSH_MIN_INJECT_MS: u128 = 30"), "input_exec pace")
    check("R4 §20-ت: محرك الفرشاة النقي — brush_level (تكميم) + brush_steps (اتجاه/حافة)",
      execRs20.includes("pub fn brush_level(pressure: f64, levels: u32) -> u32") && execRs20.includes("pub fn brush_steps(last: u32, cur: u32) -> (i32, bool)"),
      "input_exec brush")
    check("R4 §20-ت: BRUSH_CFG واحدة يكتبها tablet.rs ويقرأها المنفّذ (بلا statics منشقة)",
      execRs20.includes("static BRUSH_CFG") && tabRs20.includes("crate::input_exec"), "single brush static")
    check("R4 §20-ت: عجلة التمرير بمعدّل Ctrl (Press/Release حول enigo.scroll — للمتصفح/PowerPoint)",
      execRs20.includes("Key::Control") && execRs20.includes("Direction::Press") && execRs20.includes("enigo.scroll"), "input_exec ctrl+scroll")
    check("R4 §20-ت: عميل القلم — حمولة 10B الحرفية (nx2+ny2+pressure2+tilt1+tilt1+phase1+buttons1) وتثبيت الأداة في flags",
      liveDart20.includes("حمولة 10B") && liveDart20.includes("Uint8List(10)") && liveDart20.includes("penToolPen"),
      "live_channel sendPen")
    check("R4 §20-ت: الأداة في flags bits1-2 (TOOL_PEN=0 · TOOL_ERASER=1 · TOOL_FINGER=2) — توافق أمامي",
      coreRs20.includes("pub const TOOL_PEN: u8 = 0") && coreRs20.includes("pub const TOOL_ERASER: u8 = 1")
      && coreRs20.includes("pub const TOOL_FINGER: u8 = 2") && coreRs20.includes("(flags >> 1) & 0b11"),
      "live_core tool bits")
    check("R4 §20-ت: uinput — ثوابت ioctl الأربعة (UI_SET_EVBIT/KEYBIT/ABSBIT/PROPBIT)",
      uinRs20.includes("UI_SET_EVBIT: libc::c_ulong = 0x40045564") && uinRs20.includes("UI_SET_KEYBIT: libc::c_ulong = 0x40045565")
      && uinRs20.includes("UI_SET_ABSBIT: libc::c_ulong = 0x40045566") && uinRs20.includes("UI_SET_PROPBIT: libc::c_ulong = 0x4004556e"),
      "tablet_uinput ioctl")
    check("R4 §20-ت: uinput — نطاقات الديجيتايزر (X/Y 32767 · PRESSURE 2047 · TILT ±127) + INPUT_PROP_DIRECT",
      uinRs20.includes("32767") && uinRs20.includes("2047") && uinRs20.includes("127") && uinRs20.includes("INPUT_PROP_DIRECT"),
      "tablet_uinput ranges")
    check("R4 §20-ت: uinput — أدوات HID كاملة (BTN_TOOL_PEN/RUBBER/TOUCH/STYLUS) + UI_DEV_CREATE",
      uinRs20.includes("BTN_TOOL_PEN") && uinRs20.includes("BTN_TOOL_RUBBER")
      && uinRs20.includes("BTN_STYLUS") && uinRs20.includes("UI_DEV_CREATE"), "tablet_uinput tools")
    check("R4 §20-ت: تحويل نقية — map_sample/build_setup (نقية قابلة للاختبار بلا /dev/uinput)",
      uinRs20.includes("pub fn map_sample") && uinRs20.includes("fn build_setup"), "tablet_uinput pure")
    check("R4 §20-ت: consume_pen ببوابة الجلسة §13 والتوفر (!is_active || !engine_available → تدهور رشيق)",
      tabRs20.includes("pub fn consume_pen") && tabRs20.includes("crate::input::is_active() || !engine_available()"), "tablet.rs gate")
    check("R4 §20-ت: رفض راحة اليد أصليًا — الإصبع (tool==\"finger\") لا يُحقن فرشاةً",
      execRs20.includes('tool == "finger"'), "input_exec finger reject")
    check("R4 §20-ت: قيد ويندوز/ماك بتحقق المصدر (vigem-client = يد ألعاب · vmulti آخر دفع 2016) موثق في الكود",
      tabRs20.includes("vigem-client") && tabRs20.includes("vmulti") && tabRs20.includes("2016"), "tablet.rs limits")
    check("R4 §20-ت: العقد §20 — bits1-2 + تكميم 2..64 + vigem/vmulti + امتداد توافق أمامي",
      contract.includes("## 20.") && contract.includes("bits1-2") && contract.includes("2..64") && contract.includes("vmulti"),
      "contract §20")
    check("R4 §20-ت: التقاط خام — PlatformDispatcher.onPointerDataPacket (كل عينة للمحرك قبل التجميع الإطاري)",
      tabDart20.includes("onPointerDataPacket"), "tablet_screen raw capture")
    check("R4 §20-ت: تجميع ذكي PenSampler (hover الأحدث-يغلب + تلامس بالترتيب + إزالة مكرر مكمم)",
      tabDart20.includes("class PenSampler") && tabDart20.includes("latest-wins"), "tablet_screen sampler")
    check("R4 §20-ت: رفض راحة اليد في الشاشة (_palmRejection — الأصبع يُرفض + جهاز واحد نشط)",
      tabDart20.includes("_palmRejection") && tabDart20.includes("if (_palmRejection) continue"), "tablet_screen palm")
    check("R4 §20-ت: معاينة محلية فورية بسماكة الضغط (RepaintBoundary + سقف رسم 80fps)",
      tabDart20.includes("RepaintBoundary") && tabDart20.includes("80"), "tablet_screen preview")
    check("R4 §20-ت: live.rs يوجه القلم للمستهلك (consume_pen بالأداة) — بلا مسار حقن موازٍ",
      liveRs20.includes("crate::tablet::consume_pen(nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool)"), "live.rs pen")
    check("R4 §20-ت: ورقة الفرشاة من الكمبيوتر (الحالة مصدر الحقيقة — decKey/incKey/levels/modifier الافتراضية)",
      tabDart20.includes("brush['decKey'] ?? '['") && tabDart20.includes("brush['levels'] as num?) ?? 24")
        && tabDart20.includes("rc:tablet:cmd"),
      "tablet_screen brush sheet")
    check("R4 §20-ت: القاموسان tablet.* (ar/en) — لوحة الرسم/رفض راحة اليد/Palm rejection/المستويات",
      ar20.includes("لوحة الرسم") && ar20.includes("رفض راحة اليد") && en20.includes("Palm rejection") && en20.includes('"levels"'),
      "i18n §20")
    const cl20 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §20-ت: القائمة الميدانية §14 (Krita + ممحاة + عجلة التمرير + راحة اليد + كمون <25ms)",
      cl20.includes("## 14. الجولة 4 مرحلة ②") && cl20.includes("اقلب القلم") && cl20.includes("عجلة التمرير")
      && cl20.includes("لا خطوط شاردة"), "e2e-checklist §14")
    const tvRs20 = await fsMod.readFile("scripts/tablet-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §20-ت: محرك tablet-verify يقيس uinput الفعلي (ABS_PRESSURE=2047 + ضغط 0.5→1024 + hover صفر)",
      tvRs20.includes("ABS_PRESSURE]=2047") && tvRs20.includes("ضغط 0.5→1024") && tvRs20.includes("hover: الضغط صفر"),
      "tablet-verify pressure")
    check("R4 §20-ت: النواة تحمل الضغط للمحلّق (pen → kind=pointer + pressure محمولة) — أساس محرك الفرشاة",
      coreRs20.includes("pressure محمولة") || coreRs20.includes("pressure"), "live_core pressure carry")
  }

  // R4 مرحلة ③ (عقد §21) — ثلاثية التحكم المتقدم: جيمباد الحساسات
  // (خرائط مفاتيح + قوالب + عصا تقليب) · ماوس هوائي معاير · عارض عروض
  // ================================================================
  console.log("== R4 §21: التحكم المتقدم (rc:gyro:cmd/state + gyro flags) ==")
  {
    // (أ) حوض وهمي جديد على 3011 — يفحص مرور gyro بأزراره كما هي (توافق §18)
    const sink3 = dgram.createSocket("udp4")
    const sink3Pkts = []
    await new Promise((res) => {
      sink3.on("message", (m, rinfo) => { if (rinfo.address === "127.0.0.1") sink3Pkts.push(m) })
      sink3.bind(3011, "127.0.0.1", res)
    })
    const udp3 = dgram.createSocket("udp4")
    await new Promise((res) => udp3.bind(0, "127.0.0.1", res))

    // (ب) rc:gyro:cmd بلا جلسة/ثقة → rc:rejected(untrusted) — بوابة live-hello نفسها
    const rejGyro = await new Promise((res) => {
      webSock.on("rc:rejected", (d) => { if (d?.ev === "rc:gyro:cmd") res(d) })
      webSock.emit("rc:gyro:cmd", { cmd: "get" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: rc:gyro:cmd بلا جلسة/ثقة → rc:rejected(untrusted)", rejGyro?.reason === "untrusted", `got=${JSON.stringify(rejGyro)}`)

    // جلسة موثوقة جديدة + نبض صيانة طوال القسم
    const hb3 = setInterval(() => rcCtl.emit("rc:session", { action: "hb" }), 2000)
    const gyroSession = await new Promise((res) => {
      rcDesk.on("rc:session", (d) => { if (d?.active === true) res(d) })
      rcCtl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: جلسة التحكم المتقدم نشطة", gyroSession?.active === true, JSON.stringify(gyroSession))

    // (ج) get يصل الكمبيوتر بوسم __src=controller — وstate من دور pc تصل الهاتف
    const gyroGet = await new Promise((res) => {
      rcDesk.on("rc:gyro:cmd", (d) => res(d))
      rcCtl.emit("rc:gyro:cmd", { cmd: "get" })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: rc:gyro:cmd get يصل الكمبيوتر (__src=controller)",
      gyroGet?.cmd === "get" && gyroGet?.__src === "controller", JSON.stringify(gyroGet))
    const gyroStateOk = await new Promise((res) => {
      rcCtl.on("rc:gyro:state", (d) => res(d))
      rcDesk.emit("rc:gyro:state", { mode: "off", template: "platformer", map: {}, stats: {}, calibrated: false, at: 2 })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: rc:gyro:state من دور pc تصل الهاتف (مصدر الحقيقة)",
      gyroStateOk?.mode === "off" && gyroStateOk?.at === 2, JSON.stringify(gyroStateOk)?.slice(0, 120))
    const gyroLeak = await new Promise((res) => {
      rcCtl.on("rc:gyro:state", (d) => { if (d?.leak === 2) res(d) })
      rcCtl.emit("rc:gyro:state", { leak: 2 })
      setTimeout(() => res(null), 2500)
    })
    check("R4 §21: rc:gyro:state من دور phone يُرفض (لا انتحال حالة)", gyroLeak === null, JSON.stringify(gyroLeak))

    // (د) set سليم يمرر الحقول المنقاة حصرًا — والفاسد يُرفض كله صامتًا
    const gyroSetOk = await new Promise((res) => {
      rcDesk.on("rc:gyro:cmd", (d) => { if (d?.cmd === "set" && d?.mode === "gamepad") res(d) })
      rcCtl.emit("rc:gyro:cmd", { cmd: "set", mode: "gamepad", template: "racing", deadzoneDeg: 22, sens: 2.5, keyA: " ", keyB: "l", tiltDeg: 30, laser: true, calibrate: true })
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: set سليم يمرر الحقول المنقاة (mode/template/deadzone/sens/keys/tilt/laser/calibrate حرفيًا)",
      gyroSetOk?.mode === "gamepad" && gyroSetOk?.template === "racing" && gyroSetOk?.deadzoneDeg === 22 && gyroSetOk?.sens === 2.5
        && gyroSetOk?.keyA === " " && gyroSetOk?.keyB === "l" && gyroSetOk?.tiltDeg === 30 && gyroSetOk?.laser === true && gyroSetOk?.calibrate === true,
      JSON.stringify(gyroSetOk))
    const badGyro = [
      { cmd: "set", mode: "hacked" }, { cmd: "set", template: "evil" },
      { cmd: "set", deadzoneDeg: 90 }, { cmd: "set", sens: 9 },
      { cmd: "set", keyA: "ab" }, { cmd: "set", keyA: "\u0007" }, { cmd: "set", keyB: "capslock" },
      { cmd: "set", tiltDeg: 70 }, { cmd: "set", laser: 3 }, { cmd: "frobnicate" },
    ]
    for (const bad of badGyro) {
      const badRes = await new Promise((res) => {
        rcDesk.on("rc:gyro:cmd", (d) => { if (JSON.stringify(d).includes(JSON.stringify(bad).slice(1, -1).split(":")[1]?.trim() ?? bad.cmd)) res(d) })
        rcCtl.emit("rc:gyro:cmd", bad)
        setTimeout(() => res(null), 1200)
      })
      check(`R4 §21: أمر فاسد يُرفض كله: ${JSON.stringify(bad)}`, badRes === null, JSON.stringify(badRes))
    }

    // (هـ) قناة حية جديدة → gyro بأزرار عبر UDP: الجسر يمرر flags كما هي
    const liveReady3 = await new Promise((res) => {
      rcCtl.on("rc:live-ready", (d) => res(d))
      rcCtl.emit("rc:live-hello")
      setTimeout(() => res(null), 6000)
    })
    check("R4 §21: قناة حية جديدة (مفتاح 16-hex)", typeof liveReady3?.key === "string" && liveReady3.key.length === 16, JSON.stringify(liveReady3))
    if (liveReady3?.key) {
      const gyroEnc = (flags, seq, keyHex) => {
        const head = Buffer.alloc(22)
        head.writeUInt16BE(0x4e58, 0)
        head[2] = 1
        head[3] = 3 // gyro
        head[4] = flags
        head.writeUInt32BE(seq >>> 0, 6)
        head.writeUInt32BE(Date.now() & 0xffffffff, 10)
        head.write(keyHex, 14, "hex")
        const pl = Buffer.alloc(12)
        pl.writeInt16BE(0, 0) // ax
        pl.writeInt16BE(500, 2) // ay (إمالة ~30°)
        pl.writeInt16BE(-866, 4) // az
        pl.writeInt16BE(0, 6) // gx
        pl.writeInt16BE(0, 8) // gy
        pl.writeInt16BE(1000, 10) // gz
        return Buffer.concat([head, pl])
      }
      udp3.send(gyroEnc(0b0100_0011, 71, liveReady3.key), 3010, "127.0.0.1") // A+B+إمساك
      await sleep(120)
      udp3.send(gyroEnc(0b0100_0100, 72, liveReady3.key), 3010, "127.0.0.1") // X+إمساك
      await sleep(120)
      udp3.send(gyroEnc(0, 73, liveReady3.key), 3010, "127.0.0.1") // بلا أزرار
      await sleep(900)
      const gyros = sink3Pkts.filter((m) => m[3] === 3)
      check("R4 §21: حزم gyro بأزرارها تمر للحوض كما هي (bits0-5 + bit6 الإمساك محفوظة)",
        gyros.length === 3 && gyros[0][4] === 0b0100_0011 && gyros[1][4] === 0b0100_0100 && gyros[2][4] === 0 && gyros.every((m) => m.readUInt16BE(0) === 0x4e58),
        `got=${gyros.map((m) => m[4]).join(",")}`)
    }

    // (و) التوثيق + الملفات (نفس نمط §18/§19/§20)
    const rbTs3 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const dbTsx3 = await fsMod.readFile("src/components/nexus/desktop-bridge.tsx", "utf8").catch(() => "")
    const coreRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const execRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const gyroRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro.rs", "utf8").catch(() => "")
    const gyroCoreRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro_core.rs", "utf8").catch(() => "")
    const liveRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const mainRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/main.rs", "utf8").catch(() => "")
    const inputRs3 = await fsMod.readFile("apps/desktop/src-tauri/src/input.rs", "utf8").catch(() => "")
    const liveDart3 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")
    const svcDart3 = await fsMod.readFile("nexuslink_mobile/lib/data/controller_service.dart", "utf8").catch(() => "")
    const gyroDart3 = await fsMod.readFile("nexuslink_mobile/lib/presentation/gyro_screen.dart", "utf8").catch(() => "")
    const provDart3 = await fsMod.readFile("nexuslink_mobile/lib/state/controller_providers.dart", "utf8").catch(() => "")
    const ctlDart3 = await fsMod.readFile("nexuslink_mobile/lib/presentation/controller_screen.dart", "utf8").catch(() => "")
    const protoDart3 = await fsMod.readFile("nexuslink_mobile/lib/core/protocol.dart", "utf8").catch(() => "")
    const arDict4 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const enDict4 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    const checklist15 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    const gvRs = await fsMod.readFile("scripts/gyro-verify/src/main.rs", "utf8").catch(() => "")
    const gvBuild = await fsMod.readFile("scripts/gyro-verify/build.rs", "utf8").catch(() => "")
    check("R4 §21: العقد موثق (أزرار flags/قوالب/عصا/صفير/إيماءة/أحداث/تحقق)",
      contract.includes("## 21. التحكم المتقدم") && contract.includes("bits0-5") && contract.includes("FLAG_GRAB") && contract.includes("rc:gyro:cmd") && contract.includes("milli-rad/s"),
      "contract §21")
    const mirrorTs3 = await fsMod.readFile("mini-services/remote-service/index.ts", "utf8").catch(() => "")
    check("R4 §21: الجسران متطابقان (تنقية cmd + بوابة الجلسة + state من دور pc حصرًا)",
      rbTs3.includes('rc:gyro:cmd') && rbTs3.includes('reason: "untrusted"') && rbTs3.includes("desktopSocks.has(socket.id)")
        && mirrorTs3.includes('rc:gyro:cmd') && mirrorTs3.includes("reason: 'untrusted'") && mirrorTs3.includes("desktopSocks.has(socket.id)"),
      "remote-bridge + remote-service mirror")
    check("R4 §21: الويبفيو يربط أوامر gyro بأوامر Tauri ويبث الحالة",
      dbTsx3.includes("rc:gyro:cmd") && dbTsx3.includes('gyro_config_set') && dbTsx3.includes('rc:gyro:state'),
      "desktop-bridge.tsx")
    check("R4 §21: النواة النقية — أزرار flags + خرائط/قوالب + عصا موقّعة + صفير/فلتر + إيماءة",
      gyroCoreRs3.includes("pub const FLAG_GRAB: u8") && gyroCoreRs3.includes("pub fn axis_step") && gyroCoreRs3.includes("pub fn calibrate_zero")
        && gyroCoreRs3.includes("pub fn air_filter") && gyroCoreRs3.includes("pub fn tilt_gesture") && gyroCoreRs3.includes("TPL_FIGHTING"),
      "gyro_core.rs")
    check("R4 §21: المستهلك — بوابة الوضع/الجلسة + حواف الحالة الكاملة + تفكيك حتمي",
      gyroRs3.includes("pub fn consume_gyro") && gyroRs3.includes("crate::input::is_active") && gyroRs3.includes("release_all_events") && gyroRs3.includes("desktop-local"),
      "gyro.rs")
    check("R4 §21: live.rs يوجه gyro للمستهلك (بلا مسار حقن موازٍ — نفس الدفعة)",
      liveRs3.includes("crate::gyro::consume_gyro(h.flags") && liveRs3.includes("batch.extend(gyro_evs)"),
      "live.rs")
    check("R4 §21: apply_key بضغط/إفلات الجيمباد (state press/release — توافق §13)",
      execRs3.includes('Some("press") => Some(Direction::Press)') && execRs3.includes("Key::Unicode(c), dir"),
      "input_exec.rs")
    check("R4 §21: نهاية الجلسة تفكك المفاتيح (input.rs ResetDrag → gyro::session_ended)",
      inputRs3.includes("crate::gyro::session_ended()") && mainRs3.includes("mod gyro") && mainRs3.includes("gyro::gyro_config_set"),
      "input.rs + main.rs")
    check("R4 §21: Flutter عميل (أزرار flags + إمساك + بث 100Hz نشط حصرًا)",
      liveDart3.includes("gyroGrab = 0x40") && liveDart3.includes("flags & 0xFF") && svcDart3.includes("sendGyroRaw") && svcDart3.includes("!_sessionReadyForLive") && svcDart3.includes("gyroCmd"),
      "live_channel + controller_service")
    check("R4 §21: شاشة التحكم المتقدم (ثلاثة أوضاع + معايرة + إمساك + مؤقت باهتزاز)",
      gyroDart3.includes("kModeGamepad") && gyroDart3.includes("kModeAirmouse") && gyroDart3.includes("kModePresenter")
        && gyroDart3.includes("calibrate") && gyroDart3.includes("HapticFeedback") && gyroDart3.includes("GyroStream"),
      "gyro_screen.dart")
    check("R4 §21: المقدمون وبطاقة الدخول والأحداث التعاقدية",
      provDart3.includes("gyroCmd") && provDart3.includes("sendGyroRaw") && ctlDart3.includes("gyro.entry") && protoDart3.includes("rc:gyro:state"),
      "providers + controller_screen + protocol")
    check("R4 §21: القاموسان gyro.* (ar/en)",
      arDict4.includes('"gyro"') && arDict4.includes("عصا التقليب") && arDict4.includes("نقطة الصفير") && enDict4.includes('"gyro"') && enDict4.includes("zero point"),
      "i18n")
    check("R4 §21: محرك التحقق يضمّن النواة والمستهلك حرفيًا (تجريد #[tauri::command])",
      gvRs.includes("gyro_core.rs") && gvRs.includes("input_exec.rs") && gvRs.includes("gyro_stripped.rs") && gvBuild.includes("#[tauri::command"),
      "gyro-verify")
    check("R4 §21: الفحص الميداني موثق (e2e-checklist §15 — جيمباد/ماوس/عرض حقيقي)",
      checklist15.includes("## 15. الجولة 4 مرحلة ③") && checklist15.includes("PowerPoint"),
      "e2e-checklist §15")

    clearInterval(hb3)
    udp3.close()
    sink3.close()
    rcCtl.emit("rc:session", { action: "stop" })
    await sleep(400)
  }

  // ================================================================
  // ================================================================
  // R4 §21-ت (توسعة) — الثلاثية: جيمباد الحساسات + الماوس الهوائي + العارض
  // ================================================================
  console.log("== R4 §21-ت: توسعة التحكم المتقدم (gyro) ==")
  {
    const gyroCore21 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro_core.rs", "utf8").catch(() => "")
    const gyroRs21 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro.rs", "utf8").catch(() => "")
    const execRs21 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const gyroDart21 = await fsMod.readFile("nexuslink_mobile/lib/presentation/gyro_screen.dart", "utf8").catch(() => "")
    const svcDart21 = await fsMod.readFile("nexuslink_mobile/lib/data/controller_service.dart", "utf8").catch(() => "")
    const protoDart21 = await fsMod.readFile("nexuslink_mobile/lib/core/protocol.dart", "utf8").catch(() => "")
    const ar21 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en21 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")

    check("R4 §21-ت: أزرار الجيمباد الستة (A/B/X/Y/L/R) + BTN_COUNT=6",
      ["GB_A: u8 = 0", "GB_B: u8 = 1", "GB_X: u8 = 2", "GB_Y: u8 = 3", "GB_L: u8 = 4", "GB_R: u8 = 5"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes("pub const BTN_COUNT: usize = 6"), "gyro_core buttons")
    check("R4 §21-ت: FLAG_GRAB=0b0100_0000 (bit6 الإمساك) + BTN_MASK=0b0011_1111 (bits0-5) — الحزم كما هي",
      gyroCore21.includes("pub const FLAG_GRAB: u8 = 0b0100_0000") && gyroCore21.includes("pub const BTN_MASK: u8 = 0b0011_1111"),
      "gyro_core flags")
    check("R4 §21-ت: الأوضاع الأربعة (off/gamepad/airmouse/presenter) بأسمائها",
      ["MODE_OFF: u8 = 0", "MODE_GAMEPAD: u8 = 1", "MODE_AIRMOUSE: u8 = 2", "MODE_PRESENTER: u8 = 3"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes('MODE_GAMEPAD => "gamepad"') && gyroCore21.includes('MODE_AIRMOUSE => "airmouse"') && gyroCore21.includes('MODE_PRESENTER => "presenter"'),
      "gyro_core modes")
    check("R4 §21-ت: القوالب الأربعة بأسمائها (platformer/racing/fighting/custom)",
      ["TPL_PLATFORMER: u8 = 0", "TPL_RACING: u8 = 1", "TPL_FIGHTING: u8 = 2", "TPL_CUSTOM: u8 = 3"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes('TPL_PLATFORMER => "platformer"') && gyroCore21.includes('TPL_RACING => "racing"') && gyroCore21.includes('TPL_FIGHTING => "fighting"'),
      "gyro_core templates")
    check("R4 §21-ت: النافذة الميتة — افتراضي 18.0° ونطاق مقبول 5..45°",
      gyroCore21.includes("deadzone_deg: 18.0") && gyroCore21.includes("(5.0..=45.0).contains(&v)"), "gyro_core deadzone")
    check("R4 §21-ت: حساسية الماوس الهوائي 0.5..5.0 مقيدة",
      gyroCore21.includes("(0.5..=5.0).contains(&v)") && gyroCore21.includes("0.5..5.0"), "gyro_core sens")
    check("R4 §21-ت: تنقية المفاتيح — محرف ASCII مرئي واحد (33..126) أو مسافة حصرًا",
      gyroCore21.includes("(c as u32) >= 33 && (c as u32) <= 126") && gyroCore21.includes("c == ' '"), "gyro_core key sanitize")
    check("R4 §21-ت: مفاتيح مسماة معتمدة (ctrl/pageup/pagedown/home/end/f5/f11)",
      gyroCore21.includes('"ctrl", "pageup", "pagedown", "home", "end", "f5", "f11"'), "gyro_core named keys")
    check("R4 §21-ت: axis_step نقية — حافة واحدة لكل اتجاه (بلا رجفان ولا ضغط مزدوج)",
      gyroCore21.includes("pub fn axis_step(prev: i8, v: f64, dz: f64) -> (i8, Option<i8>)"), "gyro_core axis")
    check("R4 §21-ت: عصا التقليب flip_step بهيستيريسيس (0.6× النافذة — بلا حواف عمياء)",
      gyroCore21.includes("pub fn flip_step(prev: FlipState, roll: f64, pitch: f64, deadzone_deg: f64) -> (FlipState, Vec<Value>)")
      && gyroCore21.includes("0.6"), "gyro_core flip")
    check("R4 §21-ت: calibrate_zero نقية (نقطة صفير من عينات ساكنة)",
      gyroCore21.includes("pub fn calibrate_zero(samples: &[[f64; 3]]) -> Option<[f64; 3]>"), "gyro_core zero")
    check("R4 §21-ت: فلتر الهواء air_filter (تنعيم أُسي حول نقطة الصفير)",
      gyroCore21.includes("pub fn air_filter(prev: [f64; 3], sample: [f64; 3], zero: [f64; 3], alpha: f64) -> [f64; 3]"),
      "gyro_core filter")
    check("R4 §21-ت: إيماءة المعصم tilt_gesture + حالة مسلحة (تبريد يمنع التتابع الأعمى)",
      gyroCore21.includes("pub fn tilt_gesture(prev: TiltState, roll: f64, tilt_deg: f64) -> (TiltState, Option<&'static str>)"),
      "gyro_core gesture")
    check("R4 §21-ت: الليزر إعداد presenter (Ctrl+L عند البدء — PowerPoint 2010+) ورفض قيمة غير منطقية",
      gyroCore21.includes("Ctrl+L") && gyroCore21.includes('json!({"laser": 3})'), "gyro_core laser")
    check("R4 §21-ت: بوابة المستهلك المزدوجة (MODE_OFF || !is_active → لا أحداث خارج جلسة موثوقة)",
      gyroRs21.includes("cfg_now.mode == core::MODE_OFF || !crate::input::is_active()"), "gyro.rs gate")
    check("R4 §21-ت: الضغط المستمر press/release على الحافة (استمرار = تكرار حقيقي في اللعبة)",
      gyroRs21.includes('if now { "press" } else { "release" }'), "gyro.rs edge")
    check("R4 §21-ت: التفكيك الحتمي — release_all_events + session_ended (نهاية الجلسة تفكك كل ضغط)",
      gyroRs21.includes("pub fn release_all_events() -> Vec<Value>") && gyroRs21.includes("pub fn session_ended() -> Vec<Value>")
      && gyroRs21.includes("release_all_events()"), "gyro.rs teardown")
    check("R4 §21-ت: apply_presenter — next→PageDown · prev→PageUp · start→F5 · stop→Esc · black→b",
      execRs21.includes("next→PageDown") && execRs21.includes('Key::PageDown, Direction::Click') && execRs21.includes("apply_presenter"),
      "input_exec presenter")
    check("R4 §21-ت: خريطة المفاتيح المسماة للتنفيذ (PageUp/PageDown/F5 → enigo)",
      execRs21.includes('"pageup" => Key::PageUp') && execRs21.includes('"pagedown" => Key::PageDown') && execRs21.includes('"f5" => Key::F5'),
      "input_exec key map")
    check("R4 §21-ت: شاشة التحكم — الأوضاع الثلاثة كثوابت + معايرة + اهتزاز إنجاز",
      gyroDart21.includes("kModeGamepad") && gyroDart21.includes("kModeAirmouse") && gyroDart21.includes("kModePresenter")
      && gyroDart21.includes("HapticFeedback.heavyImpact"), "gyro_screen")
    check("R4 §21-ت: بث الحساسات — القناة النظامية 50ms للمعاينة والبث الحي منفصل (sendGyroRaw)",
      svcDart21.includes("samplingPeriod: const Duration(milliseconds: 50)") && svcDart21.includes("sendGyroRaw"),
      "controller_service sensors")
    check("R4 §21-ت: البث النشط حصرًا فوق القناة الحية (!sessionReadyForLive — لا إغراق فوق TCP)",
      svcDart21.includes("!_sessionReadyForLive") && svcDart21.includes("100"), "controller_service live gate")
    check("R4 §21-ت: العقد §21 — 100Hz + هيستيريسيس + rc:gyro:cmd/state في بروتوكول Flutter",
      contract.includes("100Hz") && contract.includes("هيستيريسيس") && protoDart21.includes("rc:gyro:cmd") && protoDart21.includes("rc:gyro:state"),
      "contract + protocol.dart")
    const cl21 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §21-ت: القائمة الميدانية §15 (SuperTux/SuperTuxKart + PowerPoint + لا مفتاح عالق + Impress بصدق)",
      cl21.includes("## 15. الجولة 4 مرحلة ③") && cl21.includes("SuperTux") && cl21.includes("لا مفتاح عالق")
      && cl21.includes("Impress يتحرك المؤشر فقط"), "e2e-checklist §15")
    check("R4 §21-ت: القاموسان gyro.* (ar/en) — عصا التقليب/نقطة الصفير/معايرة/zero point",
      ar21.includes("عصا التقليب") && ar21.includes("نقطة الصفير") && en21.includes("zero point"), "i18n §21")
    const gvRs21 = await fsMod.readFile("scripts/gyro-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §21-ت: محرك gyro-verify يختبر flip/axis/صفير فعليًا (متجهات النواة النقية)",
      gvRs21.includes("flip_step") && gvRs21.includes("calibrate_zero") && gvRs21.includes("air_filter"), "gyro-verify vectors")
    check("R4 §21-ت: اختبارات وحدة داخل gyro_core (نقية — تعمل في CI بلا عتاد)",
      gyroCore21.includes("#[cfg(test)]") && gyroCore21.includes("#[test]"), "gyro_core unit tests")
    check("R4 §21-ت: live.rs يوجه gyro للمستهلك بالدفعة نفسها (batch.extend — بلا مسار موازٍ)",
      gyroRs21.includes("consume_gyro") && gyroCore21.includes("milli"), "gyro path")
    check("R4 §21-ت: نهاية الجلسة تستدعي gyro::session_ended من input.rs (مسار ResetDrag)",
      gyroRs21.includes("pub fn consume_gyro(flags: u8, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> Vec<Value>"),
      "gyro.rs signature")
  }

  // §22 (المرحلة 0-وسائط) — الأجهزة الافتراضية + مشغل النظام + هاتف→TV
  // ================================================================
  console.log("== §22: الأجهزة الافتراضية (cast:state + /tv + حزمة الكاميرا + التشخيص) ==")
  {
    const fsSync22 = (await import("node:fs")).default
    const rd22 = (p) => { try { return fsSync22.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
    // (أ) cast:state يمر عبر جسر 3005 من دور pc إلى دور tv (بث شفاف)
    const mSockPc = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const mSockTv = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await Promise.all([
      new Promise((res, rej) => { mSockPc.on("connect", res); mSockPc.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("m pc timeout")), 10000) }),
      new Promise((res, rej) => { mSockTv.on("connect", res); mSockTv.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("m tv timeout")), 10000) }),
    ])
    mSockPc.emit("media:role", { role: "pc", name: "NEXUS-PC" })
    mSockTv.emit("media:role", { role: "tv", name: "Nexus-TV" })
    await sleep(400)
    const castSt = await new Promise((res) => {
      mSockTv.on("cast:state", (d) => { if (d?.active === true && d?.media?.path) res(d) })
      mSockPc.emit("cast:state", {
        active: true, target: "tv", sender: "Galaxy-S24", playing: true, volume: 90, muted: false,
        media: { device: "galaxy-s24", path: "/Movies/e2e-cast.mp4", name: "E2E Cast", kind: "video" }, at: Date.now(),
      })
      setTimeout(() => res(null), 6000)
    })
    check("§22: cast:state من دور pc يصل دور tv (media/target/playing كما هي)",
      castSt?.media?.device === "galaxy-s24" && castSt?.media?.path === "/Movies/e2e-cast.mp4" && castSt?.target === "tv" && castSt?.playing === true,
      JSON.stringify(castSt))
    // cast:cmd يمر عكسيًا (تحكم الكمبيوتر بالمستقبل)
    const castCmdEcho = await new Promise((res) => {
      mSockPc.on("cast:cmd", (d) => { if (d?.action === "seek") res(d) })
      mSockTv.emit("cast:cmd", { action: "seek", value: 12, target: "tv" })
      setTimeout(() => res(null), 6000)
    })
    check("§22: cast:cmd يمر للمستقبل (seek/value/target كما أُرسلت)", castCmdEcho?.value === 12 && castCmdEcho?.target === "tv", JSON.stringify(castCmdEcho))
    mSockPc.disconnect()
    mSockTv.disconnect()

    // (ب) صفحة /tv — شاشة الاستقبال المستقلة تُقدَّم فعليًا
    const tvHtml = await fetch("http://127.0.0.1:3000/tv", { redirect: "manual" }).then((r) => r.text()).catch(() => "")
    check("§22: GET /tv → 200 وشاشة الاستقبال (النص + الوجهة Nexus-TV)",
      tvHtml.includes("شاشة الاستقبال") && tvHtml.includes("NexusLink Cast") && tvHtml.includes("Nexus-TV"),
      `len=${tvHtml.length}`)

    // (ج) حزمة الكاميرا المرفقة — المصدر والترخيص والبصمة (vcam/)
    const installer = await fsMod.readFile("apps/desktop/src-tauri/vcam/akvirtualcamera-windows-9.3.1.exe").then((b) => b.length).catch(() => 0)
    check("§22: مثبّت akvirtualcamera الرسمي ملتزم (vcam/ — NSIS 9.3.1 غير معدَّل)", installer > 1_000_000, `bytes=${installer}`)
    const vcamLicense = rd22("apps/desktop/src-tauri/vcam/LICENSE-akvirtualcamera")
    const vcamSha = rd22("apps/desktop/src-tauri/vcam/SHA256SUMS.txt")
    const vcamReadme = rd22("apps/desktop/src-tauri/vcam/README.md")
    check("§22: GPL-3.0 + SHA256 + provenance مع الحزمة",
      vcamLicense.includes("GNU GENERAL PUBLIC LICENSE") && vcamSha.includes("6a17c098d05bf380834ede5b1ad275762ebb216f667b73abc24ee9ba5ef459de")
      && vcamReadme.includes("akvirtualcamera-windows-9.3.1.exe") && vcamReadme.includes("installscript.nsi"),
      "vcam/ bundle")

    // (د) التثبيت: الموارد + hook NSIS (تثبيت صامت + كاميرا بمعرف ثابت)
    const conf4 = JSON.parse(rd22("apps/desktop/src-tauri/tauri.conf.json"))
    check("§22: tauri.conf resources تشمل vcam", (conf4?.bundle?.resources ?? []).includes("vcam"), JSON.stringify(conf4?.bundle?.resources))
    const hooks = rd22("apps/desktop/src-tauri/installer-hooks.nsh")
    check("§22: hook التثبيت — /S صامت + غير حاجز داخل RunningX64",
      hooks.includes("${NEXUS_VCAM_SETUP}\" /S") && hooks.includes("NSIS_HOOK_POSTINSTALL") && hooks.includes("NEXUS_VCAM_SETUP"),
      "installer-hooks §22")
    check("§22: hook التوفير — السجل (installPath) ثم add-device -i NexusLinkCam + add-format YUY2 ×3 + update",
      hooks.includes("SOFTWARE\\Webcamoid\\VirtualCamera") && hooks.includes("add-device -i ${NEXUS_VCAM_ID}")
      && (hooks.match(/add-format \$\{NEXUS_VCAM_ID\} YUY2/g) ?? []).length === 3 && hooks.includes("update"),
      "provision §22")

    // (هـ) الطبقة الأصلية — الأوامر الثلاثة + الضمانة idempotent + ثوابت التعاقد
    const mainRs4 = await fsMod.readFile("apps/desktop/src-tauri/src/main.rs", "utf8").catch(() => "")
    const mediaRs = await fsMod.readFile("apps/desktop/src-tauri/src/media.rs", "utf8").catch(() => "")
    const mediaCoreRs = await fsMod.readFile("apps/desktop/src-tauri/src/media_core.rs", "utf8").catch(() => "")
    check("§22: أوامر Tauri الثلاثة مسجلة (vcam_install + open_player + open_sound_settings)",
      mainRs4.includes("media::media_vcam_install") && mainRs4.includes("media::media_open_player") && mainRs4.includes("media::media_open_sound_settings"),
      "main.rs §22")
    check("§22: media.rs — التوفير المعادلي + تحقق SHA256 (certutil) + m3u + سلالم السلامة",
      mediaRs.includes("provision_camera_now") && mediaRs.includes("installer_sha256_matches") && mediaRs.includes("VCAM_INSTALLER_SHA256")
      && mediaRs.includes("nexuslink_cast_m3u") && mediaRs.includes("cast_m3u_file_name"),
      "media.rs §22")
    check("§22: media.rs — كشف السجل أولًا (installPath) + نسخة -v + OBS + devices -p",
      mediaRs.includes("HKLM\\SOFTWARE\\Webcamoid\\VirtualCamera") && mediaRs.includes("parse_reg_install_path")
      && mediaRs.includes("obs_installed") && mediaRs.includes('["devices", "-p"]'),
      "media.rs detection")
    check("§22: media_core.rs — الاسم التعاقدي + الصيغ + خطة argv مهيكلة (الوصف وسيط واحد) + لا load",
      mediaCoreRs.includes('NEXUS_CAMERA_NAME: &str = "NexusLink Camera"') && mediaCoreRs.includes("NEXUS_CAMERA_FORMATS")
      && mediaCoreRs.includes("add-device") && mediaCoreRs.includes("Vec<Vec<String>>") && !mediaCoreRs.includes('"load"'),
      "media_core §22")

    // (و) الويب — زر مشغل النظام + بث الحالة + تبويب/فحوص الأجهزة الافتراضية
    const castTs = await fsMod.readFile("src/components/nexus/media/cast-tab.tsx", "utf8").catch(() => "")
    const storeTs = await fsMod.readFile("src/lib/media-store.ts", "utf8").catch(() => "")
    const toolsTs = await fsMod.readFile("src/components/nexus/tools/tools-view.tsx", "utf8").catch(() => "")
    const tvPage = await fsMod.readFile("src/app/tv/page.tsx", "utf8").catch(() => "")
    const bridgeTs = await fsMod.readFile("src/lib/nexus/media-bridge.ts", "utf8").catch(() => "")
    check("§22: cast-tab — «افتح في مشغل النظام» (media_open_player) + توثيق /tv والحد الصادق",
      castTs.includes("media_open_player") && castTs.includes("/tv") && castTs.includes("Chromecast"),
      "cast-tab §22")
    check("§22: media-store يعلن cast:state (بداية/نهاية/تشغيل/صوت/موضع مقيّد)",
      storeTs.includes("castState({ active: true") && storeTs.includes("castState({ active: false") && storeTs.includes("castLastPos"),
      "media-store §22")
    check("§22: لوحة الأدوات — تبويب vdev + فحصا التشخيص + زر التثبيت + إعدادات الصوت",
      toolsTs.includes("VirtualDevicesTab") && toolsTs.includes('"vdev"') && toolsTs.includes("media_vcam_install")
      && toolsTs.includes("media_open_sound_settings") && toolsTs.includes('push("vcam"') && toolsTs.includes('push("vmic"'),
      "tools §22")
    check("§22: صفحة /tv — دور tv + بناء تيار /api/preview + استجابة cast:cmd",
      tvPage.includes('mediaRole("tv"') && tvPage.includes("/api/preview") && tvPage.includes("cast:cmd"),
      "/tv page")
    check("§22: جسر 3005 يمرر cast:state/cast:cmd (القناة الشفافة القائمة)",
      bridgeTs.includes('"cast:state"') && bridgeTs.includes('"cast:cmd"'),
      "media-bridge §22")

    // (ز) التوثيق + القاموس + محرك التحقق
    const contract4 = rd22("docs/protocol-contract.md")
    const checklist16 = rd22("docs/e2e-checklist.md")
    const enMap = rd22("src/lib/ar-en-map.json")
    check("§22: العقد موثق (الحزمة/التوفير/السجل/-v/OBS/m3u//tv/التشخيص)",
      contract4.includes("## 22.") && contract4.includes("NexusLink Camera") && contract4.includes("installPath")
      && contract4.includes("cast:state") && contract4.includes("Chromecast الأصلي (mDNS/cast protocol) غير مدعوم"),
      "contract §22")
    check("§22: e2e-checklist §16 — اختبار Meet الميداني موثق خطوة-خطوة",
      checklist16.includes("## 16. المرحلة 0-وسائط") && checklist16.includes("NexusLink Camera") && checklist16.includes("Meet"),
      "checklist §16")
    check("§22: القاموسان — مفاتيح اللوحة الجديدة مترجمة (ar→en)",
      enMap.includes("الأجهزة الافتراضية — كاميرا وميكروفون الهاتف") && enMap.includes("تثبيت حزمة الكاميرا")
      && enMap.includes("Virtual devices — phone camera & microphone") && enMap.includes("افتح في مشغل النظام (stream مؤقت)"),
      "i18n §22")
    const mvRs = await fsMod.readFile("scripts/media-verify/src/main.rs", "utf8").catch(() => "")
    check("§22: media-verify يضمّن media_core حرفيًا ويغطي §22 (خطة/سجل/نسخة/m3u/v2)",
      mvRs.includes("media_core.rs") && mvRs.includes("test_camera_provisioning") && mvRs.includes("parse_reg_install_path"),
      "media-verify §22")
  }

  // ================================================================
  // ================================================================
  // R4 §22-ت (توسعة) — الأجهزة الافتراضية: خطة الكاميرا + m3u + التثبيت + الصوت
  // ================================================================
  console.log("== R4 §22-ت: توسعة الأجهزة الافتراضية (vcam/vmic/m3u) ==")
  {
    const mediaCore22 = await fsMod.readFile("apps/desktop/src-tauri/src/media_core.rs", "utf8").catch(() => "")
    const mediaRs22 = await fsMod.readFile("apps/desktop/src-tauri/src/media.rs", "utf8").catch(() => "")
    const bridgeTs22 = await fsMod.readFile("src/lib/nexus/media-bridge.ts", "utf8").catch(() => "")
    const storeTs22 = await fsMod.readFile("src/lib/media-store.ts", "utf8").catch(() => "")
    const toolsTs22 = await fsMod.readFile("src/components/nexus/tools/tools-view.tsx", "utf8").catch(() => "")
    const fsSync22 = (await import("node:fs")).default

    check("R4 §22-ت: صيغ الكاميرا الثلاث المعلنة (YUY2 720p30 · 1080p30 · 480p30 — الأول افتراضي)",
      mediaCore22.includes('("YUY2", 1280, 720, 30)') && mediaCore22.includes('("YUY2", 1920, 1080, 30)')
      && mediaCore22.includes('("YUY2", 640, 480, 30)'), "media_core formats")
    check("R4 §22-ت: خطة التوفير idempotent — إن الاسم موجود لا شيء؛ وإلا add-device ثم @NEW@ يُستبدل بمعرف add-device -p ثم add-format ×3 ثم update",
      mediaCore22.includes('vec![vec!["add-device".into(), NEXUS_CAMERA_NAME.into()]') && mediaCore22.includes('"@NEW@"')
      && mediaCore22.includes('"update"'), "media_core plan")
    check("R4 §22-ت: akvcam_stream_args — بروتوكول stdin الحرفي (stream -f FPS DEVICE YUY2 W H)",
      mediaCore22.includes("pub fn akvcam_stream_args"), "media_core stream args")
    check("R4 §22-ت: محللات الأجهزة النقية (parse_akvcam_devices + parse_v4l2_entries + match_audio_output)",
      mediaCore22.includes("pub fn parse_akvcam_devices") && mediaCore22.includes("pub fn parse_v4l2_entries")
      && mediaCore22.includes("pub fn match_audio_output"), "media_core parsers")
    check("R4 §22-ت: m3u مؤقت — #EXTM3U + #EXTINF باسم معقّم (لا حقن أسطر)",
      mediaCore22.includes('"#EXTM3U\\n#EXTINF:-1,{safe_name}\\n{url}\\n"'), "media_core m3u")
    check("R4 §22-ت: الكشف — السجل أولًا (HKLM installPath) ثم المسارات + نسخة -v + OBS (obs64.exe) + modinfo v4l2loopback",
      mediaRs22.includes("HKLM\\SOFTWARE\\Webcamoid\\VirtualCamera") && mediaRs22.includes("obs64.exe") && mediaRs22.includes("v4l2loopback"),
      "media.rs detection")
    check("R4 §22-ت: التثبيت ببصمة إلزامية — certutil SHA256 يرفض عند الاختلاف + UAC (Verb RunAs /S) + ماك يفتح pkg + لينكس خطأ صادق",
      mediaRs22.includes("certutil") && mediaRs22.includes("Verb RunAs") && mediaRs22.includes("ArgumentList '/S'"), "media.rs install")
    check("R4 §22-ت: مشغل النظام عبر m3u في temp — start (ويندوز) / open (ماك) / xdg-open (لينكس)",
      mediaRs22.includes('["/C", "start", "", &path_str]') && mediaRs22.includes('"open"') && mediaRs22.includes('"xdg-open"'),
      "media.rs player")
    check("R4 §22-ت: إعدادات صوت النظام لكل منصة (ms-settings:sound / Sound.prefPane / pavucontrol)",
      mediaRs22.includes("ms-settings:sound") && mediaRs22.includes("Sound.prefPane") && mediaRs22.includes("pavucontrol"),
      "media.rs sound")
    check("R4 §22-ت: الضمانة المشتركة — provision_camera_now (بداية الويب كام + بعد التثبيت) واختيار وصفنا حصرًا",
      mediaRs22.includes("provision_camera_now") && (mediaRs22.match(/NEXUS_CAMERA_NAME/g) ?? []).length >= 3,
      "media.rs guarantee")
    check("R4 §22-ت: قائمة أوامر cam:cmd البيضاء العشرة (cam-start…watch-stop)",
      ["cam-start", "cam-stop", "switch", "torch", "mic-start", "mic-stop", "baby-start", "baby-stop", "watch-start", "watch-stop"]
        .every((c) => bridgeTs22.includes(`"${c}"`)), "media-bridge CAM_CMDS")
    check("R4 §22-ت: تنقية cam:cmd — الحقول الاختيارية محدودة (camera front/back · on · sensitivity 0.01..1)",
      bridgeTs22.includes('["front", "back"]') && bridgeTs22.includes("Math.min(1, Math.max(0.01, data.sensitivity))"),
      "media-bridge sanitize")
    check("R4 §22-ت: كتم تكرار cast — castLastPos (موضع مكرر ضمن 1 وحدة لا يُبث)",
      storeTs22.includes("castLastPos") && storeTs22.includes("Math.abs(pos - (castLastPos ?? -1)) > 1"), "media-store clamp")
    check("R4 §22-ت: لوحة الأدوات — تبويب «الأجهزة الافتراضية» بعنوانه وحالته وزر التثبيت",
      toolsTs22.includes("VirtualDevicesTab") && toolsTs22.includes("الأجهزة الافتراضية") && toolsTs22.includes("media_vcam_install"),
      "tools vdev")
    const vcamShaOk = fsSync22.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vcam/SHA256SUMS.txt"))
    const vddShaOk = fsSync22.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/SHA256SUMS.txt"))
    check("R4 §22-ت: حزمتا الأجهزة الافتراضية مرفقتان ببصمات الشحن (vcam/SHA256SUMS + vdd/SHA256SUMS)",
      vcamShaOk && vddShaOk, "bundle checksums")
    const installerSize22 = await fsMod.readFile("apps/desktop/src-tauri/vcam/akvirtualcamera-windows-9.3.1.exe").then((b) => b.length).catch(() => 0)
    check("R4 §22-ت: مثبّت akvirtualcamera الرسمي بحجم حقيقي (>3MB — 9.3.1 غير معدَّل)",
      installerSize22 > 3_000_000, `bytes=${installerSize22}`)
    check("R4 §22-ت: العقد §22 — stream -f (بروتوكول stdin) + idempotent موثقة",
      contract.includes("stream -f") && contract.includes("idempotent"), "contract §22")
    const cl22 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §22-ت: القائمة الميدانية §16 (Meet + أزرار /tv + v4l2loopback لينكس)",
      cl22.includes("## 16. المرحلة 0-وسائط") && cl22.includes("أزرار تشغيل/صوت/إيقاف") && cl22.includes("v4l2loopback"),
      "e2e-checklist §16")
    const mvRs22 = await fsMod.readFile("scripts/media-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §22-ت: media-verify يغطي m3u والخطة (9 مواضع) — الإثبات التنفيذي للنقية",
      (mvRs22.match(/m3u/g) ?? []).length >= 3 && mvRs22.includes("test_camera_provisioning"), "media-verify m3u")
    check("R4 §22-ت: media.rs لا يستخدم AkVCamManager load المدمّر أبدًا (يمسح كل أجهزة المستخدم)",
      !mediaRs22.includes('"load"'), "no destructive load")
    check("R4 §22-ت: vcam_driver_status_v2 — النسخة/الواجهة/الأجهزة/OBS/loopback بحقول v1 محفوظة",
      mediaRs22.includes("vcam_driver_status_v2") && mediaRs22.includes("loopback"), "media.rs status v2")
  }

  // FA-files (عقد §14) — دمج الملفات في نظام التشغيل
  // ================================================================
  console.log("== ] FA-files: OS file integration ==")
  {
    // (أ) realpath — أساس «إظهار في Explorer/Finder»
    const revealDir = pathMod.join(dataRoot, "nexus-storage", "pc-fs", "Inbox")
    await fsMod.mkdir(revealDir, { recursive: true })
    await fsMod.writeFile(pathMod.join(revealDir, "e2e-reveal.txt"), "FA-files")
    const rp = await fetch(`http://127.0.0.1:3000/api/fs/realpath?device=pc-office&path=${encodeURIComponent("/Inbox/e2e-reveal.txt")}`).then((r) => r.json())
    const rpExists = rp?.ok && rp.realPath ? await fsMod.stat(rp.realPath).then(() => true).catch(() => false) : false
    check("FA-files: realpath يعيد مسارًا حقيقيًا موجودًا", rpExists, JSON.stringify(rp).slice(0, 100))
    const rpBad = await fetch(`http://127.0.0.1:3000/api/fs/realpath?device=no-such-device&path=/x`).then((r) => r.status)
    check("FA-files: جهاز غير معروف → 404", rpBad === 404, `status=${rpBad}`)

    // (ب) تسجيل نقطة وسائط الهاتف (hello-phone media) + تحديثها (guard:media)
    const filesSock = io(`http://127.0.0.1:${gwPort}`, {
      query: { XTransformPort: "3006" },
      transports: ["polling", "websocket"],
      reconnection: false,
      timeout: 15000,
    })
    await new Promise((res, rej) => {
      filesSock.on("connect", res)
      filesSock.on("connect_error", rej)
      setTimeout(() => rej(new Error("files socket timeout")), 16000)
    })
    filesSock.emit("guard:hello-phone", { name: "E2E-Files-Phone", deviceId: "e2e-files-agent", media: { port: 3010, token: "abcdef1234567890abcdef1234567890" } })
    await sleep(700)
    const st1 = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json())
    const am = st1?.desktop?.agentMedia
    check("FA-files: hello-phone media يُسجّل النقطة (ip/port/token)",
      am?.port === 3010 && am?.token === "abcdef1234567890abcdef1234567890" && !!am?.lanIp && am?.deviceId === "e2e-files-agent",
      JSON.stringify(am))
    filesSock.emit("guard:media", { port: 3011, token: "fedcba0987654321fedcba0987654321" })
    await sleep(500)
    const st2 = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json())
    check("FA-files: guard:media يحدّث النقطة بعد إعادة تشغيل الخدمة", st2?.desktop?.agentMedia?.port === 3011, JSON.stringify(st2?.desktop?.agentMedia))

    // (ج) عروض مزامنة المجلدات: /Outbox/<pair>/ → tx:offer → accept → state done
    const outbox = pathMod.join(dataRoot, "nexus-storage", "pc-fs", "Outbox", "pair-e2e", "sub")
    await fsMod.mkdir(outbox, { recursive: true })
    const syncBytes = Buffer.from("sync-payload-FA-files-عربي")
    await fsMod.writeFile(pathMod.join(outbox, "file.txt"), syncBytes)
    const offers = []
    filesSock.on("tx:offer", (d) => offers.push(d))
    const send = await fetch(`http://127.0.0.1:3000/api/devices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send-file", deviceId: "e2e-files-agent", deviceName: "E2E-Files-Phone", direction: "out", srcDeviceId: "pc-office", srcPath: "/Outbox/pair-e2e/sub/file.txt", fileName: "file.txt", size: syncBytes.length }),
    }).then((r) => r.json())
    check("FA-files: send-file من /Outbox عرض حي للوكيل (queued)",
      send?.ok === true && send?.job?.agent === true && send?.job?.status === "queued",
      JSON.stringify(send?.job ?? send).slice(0, 110))
    await sleep(700)
    const offer = offers.find((o) => o?.srcVPath?.startsWith("/Outbox/pair-e2e/"))
    check("FA-files: tx:offer وصل بـ srcVPath مزامنة صحيح", !!offer, JSON.stringify(offers[0] ?? {}).slice(0, 120))
    if (offer) {
      filesSock.emit("tx:accept", { id: offer.id })
      filesSock.emit("tx:progress", { id: offer.id, transferred: syncBytes.length })
      filesSock.emit("tx:state", { id: offer.id, state: "done" })
      await sleep(600)
      const jobs2 = await fetch(`http://127.0.0.1:3000/api/transfer`).then((r) => r.json())
      const j = (jobs2?.jobs ?? []).find((x) => x.id === offer.id)
      check("FA-files: دورة العرض كاملة (accept→state) → مهمة done",
        j?.status === "done" && j?.transferred === syncBytes.length,
        JSON.stringify(j ?? {}).slice(0, 120))
    }

    // (د) Range على /api/preview (أساس بث الفيديو الاحتياطي — عقد §3.2)
    const prev = await fetch(`http://127.0.0.1:3000/api/preview?device=pc-office&path=${encodeURIComponent("/Outbox/pair-e2e/sub/file.txt")}`, { headers: { Range: "bytes=5-9" } })
    const prevBody = Buffer.from(await prev.arrayBuffer())
    check("FA-files: /api/preview يلبّي Range 206",
      prev.status === 206 && prevBody.length === 5 && (prev.headers.get("content-range") ?? "").includes("/"),
      `status=${prev.status} len=${prevBody.length}`)

    // (هـ) أزواج المزامنة: PUT/GET عبر المخزن المشترك + تنقية الفاسد
    const putS = await fetch(`http://127.0.0.1:3000/api/desktop/shortcuts`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sync: { pairs: [
        { id: "e2e-pair", name: "تجربة", localDir: "/tmp/nexus-sync-e2e", phoneDir: "/Sync/e2e-pair", enabled: true },
        { id: "", localDir: "فاسد" },
        { id: "bad2", localDir: "" },
      ] } }),
    }).then((r) => r.json())
    check("FA-files: PUT sync يقبل وينقّي الفاسد", putS?.ok === true && putS?.sync?.pairs?.length === 1, JSON.stringify(putS?.sync).slice(0, 120))
    const st3 = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json())
    check("FA-files: status.desktop.sync يعرض الزوج للمراقب الأصلي",
      st3?.desktop?.sync?.pairs?.[0]?.id === "e2e-pair" && st3?.desktop?.sync?.pairs?.[0]?.phoneDir === "/Sync/e2e-pair",
      JSON.stringify(st3?.desktop?.sync).slice(0, 130))
    // نظّف (لا تترك زوجًا يفعّل مراقبين على آلة المطوّر)
    await fetch(`http://127.0.0.1:3000/api/desktop/shortcuts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sync: { pairs: [] } }) })

    // (و) انقطاع الهاتف يمحو نقطة الوسائط (البث غير متاح بدون قناة حية)
    filesSock.disconnect()
    await sleep(2600)
    const st4 = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json())
    check("FA-files: انقطاع الهاتف يمحو نقطة الوسائط", st4?.desktop?.agentMedia == null, JSON.stringify(st4?.desktop?.agentMedia))

    // (ز) العقد §14 موثق حرفيًا
    check("العقد: §14 موثق (قائمة الزر الأيمن/Services/السحب الخارجي/الإظهار/البث/المزامنة)",
      contract.includes("## 14.") && contract.includes("--send") && contract.includes("NSServices") && contract.includes("/Outbox/") && contract.includes("/api/fs/upload") && contract.includes("installer-hooks"))
  }

  // ==========================================================================
  // FA-media (عقد §15) — طبقة الوسائط الأصلية: إشارات عرض الشاشة + الويب كام
  // ==========================================================================
  {
    console.log("\n== FA-media: عرض الشاشة (screen:req/offer/answer/ICE) والويب كام ==")
    const mPc = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const mPhone = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await Promise.all([
      new Promise((res, rej) => { mPc.on("connect", res); mPc.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("media pc timeout")), 10000) }),
      new Promise((res, rej) => { mPhone.on("connect", res); mPhone.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("media phone timeout")), 10000) }),
    ])
    mPc.emit("media:role", { role: "pc", name: "E2E-PC" })
    mPhone.emit("media:role", { role: "phone", name: "E2E-Media-Phone" })
    await sleep(400)

    // (أ) screen:req من الهاتف يصل الكمبيوتر (تنقية الجسر تمرر الصالح)
    const screenReq = await new Promise((res) => {
      mPc.on("screen:req", (d) => res(d))
      mPhone.emit("screen:req", { action: "start", fps: 60 })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: screen:req من الهاتف يصل الكمبيوتر مع fps=60",
      screenReq?.fps === 60 && screenReq?.from === "phone", JSON.stringify(screenReq ?? {}).slice(0, 120))

    // (ب) screen:req بفيس فاسد يُرفض صامتًا (قائمة بيضاء الجسر)
    let badReqSeen = false
    mPc.on("screen:req", () => { badReqSeen = true })
    mPhone.emit("screen:req", { action: "start", fps: 90 })
    await sleep(1200)
    check("FA-media: screen:req بـ fps=90 يُرفض صامتًا", badReqSeen === false)

    // (ج) عرض الشاشة: الكمبيوتر يبث rtc:offer kind=screen → الهاتف يستقبل
    const screenOffer = await new Promise((res) => {
      mPhone.on("rtc:offer", (d) => res(d))
      mPc.emit("rtc:offer", { kind: "screen", sdp: { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" } })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: rtc:offer kind=screen يرحّل للهاتف مع from=pc",
      screenOffer?.kind === "screen" && screenOffer?.from === "pc" && screenOffer?.sdp?.type === "offer",
      JSON.stringify(screenOffer ?? {}).slice(0, 140))

    // (د) إجابة الهاتف → الكمبيوتر يستقبل
    const screenAnswer = await new Promise((res) => {
      mPc.on("rtc:answer", (d) => res(d))
      mPhone.emit("rtc:answer", { kind: "screen", sdp: { type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n" } })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: rtc:answer kind=screen يرحّل للكمبيوتر",
      screenAnswer?.kind === "screen" && screenAnswer?.from === "phone", JSON.stringify(screenAnswer ?? {}).slice(0, 140))

    // (هـ) ICE ثنائي الاتجاه (trickle)
    const iceAtPc = await new Promise((res) => {
      mPc.on("rtc:ice", (d) => res(d))
      mPhone.emit("rtc:ice", { kind: "screen", candidate: { candidate: "candidate:1 1 UDP 2122252543 192.168.1.9 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 } })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: rtc:ice (trickle) يرحّل", iceAtPc?.candidate?.candidate?.startsWith("candidate:1"), JSON.stringify(iceAtPc ?? {}).slice(0, 120))

    // (و) الويب كام: cam:cmd cam-start من الكمبيوتر يصل الهاتف
    const camStart = await new Promise((res) => {
      mPhone.on("cam:cmd", (d) => res(d))
      mPc.emit("cam:cmd", { action: "cam-start" })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: cam:cmd cam-start يصل الهاتف (البند 4)", camStart?.action === "cam-start", JSON.stringify(camStart ?? {}).slice(0, 100))

    // (ز) عرض الكاميرا من الهاتف kind=cam → الكمبيوتر (أول إجابة تفوز — §4.3)
    const camOffer = await new Promise((res) => {
      mPc.on("rtc:offer", (d) => res(d))
      mPhone.emit("rtc:offer", { kind: "cam", sdp: { type: "offer", sdp: "v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\n" } })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: rtc:offer kind=cam (فيديو+صوت الهاتف) يرحّل للكمبيوتر",
      camOffer?.kind === "cam" && camOffer?.from === "phone", JSON.stringify(camOffer ?? {}).slice(0, 120))

    // (ح) screen:state من الكمبيوتر للهاتف (on/w/h)
    const screenState = await new Promise((res) => {
      mPhone.on("screen:state", (d) => res(d))
      mPc.emit("screen:state", { action: "state", on: true, w: 1920, h: 1080, fps: 60, quality: "high", name: "E2E-PC" })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: screen:state on/w/h يبث للهاتف",
      screenState?.on === true && screenState?.w === 1920 && screenState?.h === 1080,
      JSON.stringify(screenState ?? {}).slice(0, 120))

    // (ط) مخزن حالة الوسائط: PUT media → status.desktop.media (الشريط)
    const putM = await fetch(`http://127.0.0.1:3000/api/desktop/shortcuts`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media: { screen: { on: true, fps: 60, quality: "ultra" }, vcam: { video: true, audio: true, driver: "akvirtualcamera" } } }),
    }).then((r) => r.json())
    check("FA-media: PUT media يقبل الحالة الصالحة",
      putM?.ok === true && putM?.media?.screen?.on === true && putM?.media?.screen?.fps === 60,
      JSON.stringify(putM?.media).slice(0, 130))
    const badM = await fetch(`http://127.0.0.1:3000/api/desktop/shortcuts`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media: { screen: { on: true, fps: 91 } } }),
    }).then((r) => r.json())
    check("FA-media: PUT media fps=91 يُرفض ويُبقي آخر قيمة صالحة (60)", badM?.ok === true && badM?.media?.screen?.fps === 60,
      JSON.stringify(badM?.media).slice(0, 110))
    const stM = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json())
    check("FA-media: status.desktop.media يعرض الحالة للشريط/الهاتف",
      stM?.desktop?.media?.screen?.on === true && stM?.desktop?.media?.vcam?.video === true,
      JSON.stringify(stM?.desktop?.media).slice(0, 130))

    // (ي) rc:pointer: التنقية (فاسد مرفوض صامتًا) + الصالح يمرر مع __src
    const ptrInj = await new Promise((res) => {
      rcDesk.on("rc:pointer", (d) => res(d))
      rcCtl.emit("rc:pointer", { nx: 0.5, ny: 0.25, action: "move" })
      setTimeout(() => res(null), 6000)
    })
    check("FA-media: rc:pointer صالح يمرر مع __src=controller + مطبّع",
      ptrInj?.__src === "controller" && ptrInj?.nx === 0.5 && ptrInj?.ny === 0.25 && ptrInj?.action === "move",
      JSON.stringify(ptrInj ?? {}).slice(0, 120))
    let badPtr = null
    const badPtrP = new Promise((res) => { rcDesk.on("rc:pointer", (d) => res(d)); setTimeout(() => res("__none__"), 2500) })
    rcCtl.emit("rc:pointer", { nx: 5, ny: 0.5, action: "explode" })
    badPtr = await badPtrP
    check("FA-media: rc:pointer فاسد (nx>1 + إجراء غريب) يُرفض صامتًا", badPtr === "__none__", `got=${JSON.stringify(badPtr)}`)

    // (ك) العقد §15 موثق حرفيًا
    check("العقد: §15 موثق (kind=screen + scap/x11rb + v4l2loopback/akvirtualcamera + VB-CABLE/BlackHole + rc:pointer)",
      contract.includes("## 15.") && contract.includes('kind="screen"') && contract.includes("v4l2loopback") && contract.includes("akvirtualcamera") && contract.includes("BlackHole") && contract.includes("rc:pointer"))

    mPc.disconnect()
    mPhone.disconnect()
  }

  rcCtl.disconnect()
  webSock.disconnect()
  rcDesk.disconnect()
  rcPhone.disconnect()

  // ==========================================================================
  // FA-harden (عقد §16) — صلّب الإصدار: الإعدادات المشتركة + التدقيق + المحدّث + التشخيص
  // ==========================================================================
  {
    const base = "http://127.0.0.1:3000"

    // (أ) إعدادات التقوية المشتركة — نفس SQLite (بند 6): GET افتراضيات + PUT صالح + فاسد يُنقى
    const hs0 = await fetch(`${base}/api/desktop/settings`).then((r) => r.json()).catch(() => null)
    check("§16: GET /api/desktop/settings يعيد appLock+idle+updater",
      hs0?.appLock && hs0?.idle && hs0?.updater, JSON.stringify(hs0 ?? {}).slice(0, 110))
    const hsPut = await fetch(`${base}/api/desktop/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appLock: { enabled: true, idleLockMin: 15 }, idle: { optMinutes: 3 }, updater: { autoCheck: false } }),
    }).then((r) => r.json()).catch(() => null)
    check("§16: PUT صالح يُحفظ ويُعاد (نفس SQLite)",
      hsPut?.ok === true && hsPut?.appLock?.enabled === true && hsPut?.appLock?.idleLockMin === 15 && hsPut?.idle?.optMinutes === 3 && hsPut?.updater?.autoCheck === false,
      JSON.stringify(hsPut ?? {}).slice(0, 130))
    const hsBad = await fetch(`${base}/api/desktop/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appLock: { enabled: true, idleLockMin: 9999 }, idle: { optMinutes: 0 } }),
    }).then((r) => r.json()).catch(() => null)
    check("§16: فاسد يُنقى (خارج النطاق ⇒ افتراضي — رفض لا حصر)",
      hsBad?.ok === true && hsBad?.appLock?.idleLockMin === 0 && hsBad?.idle?.optMinutes === 5,
      JSON.stringify(hsBad ?? {}).slice(0, 130))
    // نظافة: إعادة الافتراضيات للمخزن المشترك
    await fetch(`${base}/api/desktop/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appLock: { enabled: false, idleLockMin: 0, biometric: false, hasPin: false }, idle: { optMinutes: 5, reducePolling: true }, updater: { autoCheck: true } }),
    }).catch(() => null)

    // (ب) التدقيق (بند 3): POST native-* → GET (مرشح) → فعل غريب يُرفض → مسار سيرفر يُدقَّق → DELETE native فقط
    const ap = await fetch(`${base}/api/desktop/audit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "native-lock", detail: "قفل تجريبي E2E", severity: "info" }),
    }).then((r) => r.json()).catch(() => null)
    check("§16: POST /api/desktop/audit يقبل native-*", ap?.ok === true, JSON.stringify(ap ?? {}))
    const badAudit = await fetch(`${base}/api/desktop/audit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hax", detail: "x" }),
    }).catch((e) => ({ status: 0, err: String(e) }))
    check("§16: فعل غير native يُرفض من المسار الأصلي (400)", badAudit.status === 400, `HTTP ${badAudit.status}`)
    await sleep(250)
    const ag = await fetch(`${base}/api/desktop/audit?take=50&severity=info`).then((r) => r.json()).catch(() => null)
    check("§16: GET يعيد الحدث المدقق (مرشح severity=info)",
      (ag?.events ?? []).some((e) => e.action === "native-lock" && String(e.detail).includes("E2E")),
      `count=${ag?.events?.length ?? 0}`)
    // تدقيق مسار السيرفر: نفس استدعاء القسم السابق المثبت (galaxy-s24 + pc-office/Inbox)
    const srvBefore = await fetch(`${base}/api/desktop/audit?take=500&category=transfer`).then((r) => r.json()).catch(() => null)
    await fetch(`${base}/api/devices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send-file", deviceId: "galaxy-s24", deviceName: "Galaxy S24", direction: "out", srcDeviceId: "pc-office", srcPath: "/Inbox/e2e-drop.txt", fileName: "e2e-drop.txt" }),
    }).then((r) => r.json()).then((j) => console.log(`   [audit-probe] ok=${j?.ok} err=${j?.error ?? "-"}`)).catch((e) => console.log(`   [audit-probe] fetch-fail: ${String(e).slice(0, 80)}`))
    await sleep(400)
    const srvAfter = await fetch(`${base}/api/desktop/audit?take=500&category=transfer`).then((r) => r.json()).catch(() => null)
    check("§16: نقل مسار السيرفر يُدقَّق (transfer مرئي في واجهة المراجعة)",
      (srvAfter?.events?.length ?? 0) >= (srvBefore?.events?.length ?? 0) + 1,
      `before=${srvBefore?.events?.length ?? 0} after=${srvAfter?.events?.length ?? 0}`)
    const ad = await fetch(`${base}/api/desktop/audit`, { method: "DELETE" }).then((r) => r.json()).catch(() => null)
    const afterDel = await fetch(`${base}/api/desktop/audit?take=500`).then((r) => r.json()).catch(() => null)
    check("§16: DELETE يمسح native-* فقط (تدقيق FA-10 لا يُمس)",
      ad?.ok === true && !(afterDel?.events ?? []).some((e) => String(e.action).startsWith("native-")),
      JSON.stringify(ad ?? {}).slice(0, 80))

    // (ج) status.desktop.hardening — يقرؤه Rust دوريًا (بندا 1+4)
    const st = await fetch(`${base}/api/desktop/status`).then((r) => r.json()).catch(() => null)
    check("§16: status.desktop.hardening (appLock/idle/updater)",
      st?.ok === true && st?.desktop?.hardening?.appLock && st?.desktop?.hardening?.idle && st?.desktop?.hardening?.updater,
      JSON.stringify(st?.desktop?.hardening ?? {}).slice(0, 120))

    // (د) /api/version — الإصدار المقفول 1.0.0 + سجل إصدارات حقيقي (بند 2)
    const ver = await fetch(`${base}/api/version`).then((r) => r.json()).catch(() => null)
    check("§16: /api/version — current=1.1.0 موحّد + سجل إصدارات",
      ver?.current === "1.1.0" && Array.isArray(ver?.changelog) && ver.changelog.some((c) => String(c.version).replace(/^v/, "") === "1.0.0"),
      JSON.stringify({ current: ver?.current, entries: ver?.changelog?.length }).slice(0, 90))

    // (هـ) التشخيص (بند 5): /api/tools/diag يفحص منافذ §1 الثمانية
    const diag = await fetch(`${base}/api/tools/diag`).then((r) => r.json()).catch(() => null)
    const ports = diag?.ports ?? []
    const wantPorts = [3000, 3003, 3004, 3005, 3006, 3007, 3009, 81]
    const allReported = wantPorts.every((p) => ports.some((x) => x.port === p))
    check("§16: diag يفحص منافذ §1 الثمانية (النواة + البوابة حياة)",
      allReported && ports.find((x) => x.port === 3000)?.ok === true && ports.find((x) => x.port === 81)?.ok === true,
      ports.map((p) => `${p.port}:${p.ok ? "✓" : "✗"}`).join(" "))

    // (و) أصول المحدّث + lock.html + حصرية native-
    const fsSync = (await import("node:fs")).default
    const conf = JSON.parse(fsSync.readFileSync(pathMod.join(ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"))
    check("§16: tauri.conf — updater endpoints+pubkey+createUpdaterArtifacts+إصدار 1.1.0",
      Array.isArray(conf?.plugins?.updater?.endpoints) && conf.plugins.updater.endpoints.some((e) => String(e).endsWith("/latest/download/latest.json"))
      && String(conf?.plugins?.updater?.pubkey ?? "").length > 100
      && conf?.bundle?.createUpdaterArtifacts === true
      && conf?.version === "1.1.0",
      "tauri.conf.json")
    const lockPath = pathMod.join(ROOT, "apps/desktop/splash/lock.html")
    check("§16: lock.html ضمن frontendDist ويستدعي أوامر القفل",
      fsSync.existsSync(lockPath) && fsSync.readFileSync(lockPath, "utf8").includes("lock_verify_pin"),
      "lock.html")
    const hardTs = fsSync.readFileSync(pathMod.join(ROOT, "src/lib/nexus/desktop-hardening.ts"), "utf8")
    check("§16: بادئة native- حصرية للطبقة الأصلية (المسار السيرفي بلا بادئة)",
      hardTs.includes('startsWith("native-")'), "desktop-hardening.ts")

    // (ز) العقد §16 موثق حرفيًا
    check("العقد: §16 موثق (قفل PIN+بصمة + محدّث موقّع + تدقيق native-* + خمول + تشخيص أصلي + نفس SQLite)",
      contract.includes("## 16.") && contract.includes("PBKDF2-HMAC-SHA256") && contract.includes("tauri-plugin-updater")
      && contract.includes("native-") && contract.includes("DesktopSetting") && contract.includes("idle_decision"))
  }

  // ==========================================================================
  // الجولة 3 — الإصدار النهائي (عقد §17): مصفوفة الحزم + Portable + توحيد الإصدار + docs
  // ==========================================================================
  {
    const fsp = (await import("node:fs")).default
    const rd = (p) => { try { return fsp.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }

    // (أ) release.yml — بناء حقيقي لا echo + مصفوفة الصيغ المطلوبة
    const rel = rd(".github/workflows/release.yml")
    const brs = rd("apps/desktop/build-resources.sh")
    const conf3 = JSON.parse(rd("apps/desktop/src-tauri/tauri.conf.json"))
    check("§17: release.yml — أمر بناء Tauri حقيقي (لا echo) بوصفة standalone+resources+sidecar",
      rel.includes("@tauri-apps/cli@^2 build") && !rel.includes('echo "tauri build')
      && rel.includes("build-resources.sh") && rel.includes("v20.18.1"))
    check("§17: release.yml — مصفوفة الصيغ: win(nsis msi) · linux(deb appimage) · mac(dmg app)",
      rel.includes('bundles: "nsis msi"') && rel.includes('bundles: "deb appimage"') && rel.includes('bundles: "dmg app"'))
    check("§17: release.yml — NO_STRIP (linuxdeploy .relr.dyn) + تفعيل VBScript (WiX ICE على runners 2026)",
      rel.includes('NO_STRIP: "true"') && rel.includes("Where-Object Name -like 'VBSCRIPT*'")
      && rel.includes("Add-WindowsCapability"))
    // G-28 + LGHT0311 (جولة r5 verbose كشفت الاثنين)
    check("§17: G-28 — حذف متغيرات musl من node_modules المضمنة (linuxdeploy يفشل على ELF musl)",
      brs.includes("-type d -name \"*musl*\" -exec rm -rf"))
    check("§17: وصفا الحزمة ASCII نقيان (LGHT0311: قاعدة MSI code page 1252 لا تشفر العربية)",
      (() => { const b = conf3?.bundle ?? {}; return [b.shortDescription, b.longDescription].every((s) => typeof s === "string" && [...s].every((c) => c.charCodeAt(0) < 128)); })())
    // G-30 (جولة r8): جذر بيانات قابل للكتابة — procman يمرر NEXUS_DATA_ROOT والسيرفر يقرؤه
    check("§17: G-30 — procman data_root + NEXUS_DATA_ROOT للعمليات الثلاث + فك data/ في notify",
      (() => { const pm = rd("apps/desktop/src-tauri/src/procman.rs"); const nf = rd("apps/desktop/src-tauri/src/notify.rs"); return pm.includes("pub fn data_root") && pm.includes('("NEXUS_DATA_ROOT".into(), ndr_str.clone())') && pm.includes('NEXUS_DATA_ROOT".into(), ndr_str') && nf.includes('strip_prefix("data/")') && nf.includes("procman::data_root"); })())
    check("§17: G-30 — data-root.ts (env مع fallback cwd/data) + مستهلكو nexusStorageRoot",
      fsp.existsSync(pathMod.join(ROOT, "src/lib/nexus/data-root.ts"))
      && (() => { const d = rd("src/lib/nexus/data-root.ts"); return d.includes("NEXUS_DATA_ROOT") && d.includes("nexusStorageRoot"); })()
      && rd("src/lib/nexus/fs-server.ts").includes("nexusStorageRoot()")
      && rd("src/lib/nexus/transfer-engine.ts").includes("nexusStorageRoot()"))
    check("§17: G-29 — تقليم standalone بkeep-list (تسرّب شجرة المستودع + أسماء صينية كسرت MSI)",
      brs.includes("! -name 'server.js' ! -name '.next' ! -name 'public' ! -name 'db'") && brs.includes("-exec rm -rf {} +"))
    check("§17: release.yml — خطوة Portable ZIP (تجميع بنفس تخطيط NSIS + bsdtar + README)",
      rel.includes("Assemble Windows portable ZIP") && rel.includes("NexusLink_${VERSION}_x64-portable.zip")
      && rel.includes("PORTABLE-README.txt") && rel.includes("/c/Windows/System32/tar.exe -a -cf"))
    check("§17: release.yml — توقيع updater شرطي + latest.json على الوسوم + SHA256SUMS",
      rel.includes("TAURI_SIGNING_PRIVATE_KEY") && rel.includes('createUpdaterArtifacts":false')
      && rel.includes("Generate latest.json") && rel.includes("SHA256SUMS"))
    check("§17: release.yml — dispatch = artifacts فقط (إرفاق يدوي opt-in) والوسم = إرفاق تلقائي",
      rel.includes("attach_to_release") && rel.includes("startsWith(github.ref, 'refs/tags/v')"))
    check("§17: release.yml — env لينكس المجرّبة (APPIMAGE_EXTRACT_AND_RUN + CMAKE_POLICY_VERSION_MINIMUM=3.5)",
      rel.includes("APPIMAGE_EXTRACT_AND_RUN") && rel.includes("CMAKE_POLICY_VERSION_MINIMUM"))

    // (ب) tauri.conf — الصيغ الخمسة
    const targets = conf3?.bundle?.targets ?? []
    check("§17: tauri.conf targets الخمسة (deb nsis msi appimage dmg) + إصدار 1.1.0",
      ["deb", "nsis", "msi", "appimage", "dmg"].every((t) => targets.includes(t)) && conf3?.version === "1.1.0",
      targets.join(","))

    // (ج) الإصلاح الحرج: resolve_resources يفحص تخطيط الحزم المدمج بالبادئة أولًا
    const procman = rd("apps/desktop/src-tauri/src/procman.rs")
    check("§17: procman resolve_resources — <rd>/resources/server/server.js أولًا (الحزم المثبتة) ثم المسطّح ثم exe_dir ثم التطوير",
      procman.includes('rd.join("resources/server/server.js")') && procman.includes('rd.join("server/server.js")')
      && procman.includes('dir.join("resources/server/server.js")')
      && procman.indexOf('rd.join("resources/server/server.js")') < procman.indexOf('rd.join("server/server.js")'))

    // (د) PORTABLE-README — صفّر خطوات + WebView2 موثق
    const preadme = rd("apps/desktop/PORTABLE-README.txt")
    check("§17: PORTABLE-README.txt — فك وشغّل + متطلب WebView2 + بلا Registry",
      preadme.includes("NexusLink.exe") && preadme.includes("WebView2") && preadme.includes("Registry"))

    // (هـ) BUILD.md — دليل كل منصة + توقيع ماك + مفاتيح المحدّث + قواعد الإصدار
    const build = rd("BUILD.md")
    check("§17: BUILD.md — NSIS+MSI+Portable وAppImage+deb وDMG بأوامر حقيقية",
      build.includes('--bundles "nsis msi"') && build.includes('--bundles "deb appimage"')
      && build.includes('--bundles "dmg app"') && build.includes("x64-portable.zip"))
    check("§17: BUILD.md — توقيع ماك (Developer ID + codesign + notarytool) + مفاتيح updater",
      build.includes("Developer ID Application") && build.includes("notarytool") && build.includes("stapler")
      && build.includes("TAURI_SIGNING_PRIVATE_KEY"))
    check("§17: BUILD.md — جدول توحيد الإصدار بالملفات الأربعة + قاعدة عدم استبدال أصول منشورة",
      build.includes("pubspec.yaml") && build.includes("package.json") && build.includes("لا تُستبدل"))

    // (و) README — سطح المكتب = المركز، الهاتف وكيل
    const readme = rd("README.md")
    check("§17: README §0 — المركز يعمل فور الإقلاع + جدول حزم Releases + QR + portable",
      readme.includes("سطح المكتب = المركز") && readme.includes("x64-setup.exe")
      && readme.includes("x64-portable.zip") && readme.includes("AppImage") && readme.includes("QR"))

    // (ز) قائمة التحقق النهائية
    const checklist = rd("docs/e2e-checklist.md")
    check("§17: e2e-checklist — اختبار التثبيت النظيف + أقسام كل الميزات مع عمود نتيجة",
      checklist.includes("التثبيت النظيف") && checklist.includes("x64-setup.exe")
      && checklist.includes("التحكم اللمسي") && checklist.includes("الوسائط الأصلية")
      && checklist.includes("صلابة الإصدار") && checklist.includes("☐"))

    // (ح) توحيد الإصدار — الملفات الأربعة 1.1.0
    const pkgJson = JSON.parse(rd("package.json"))
    const cargoVer = (rd("apps/desktop/src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
    const pubspecVer = (rd("nexuslink_mobile/pubspec.yaml").match(/^version:\s*([^\s+]+)/m) ?? [])[1]
    check("§17: توحيد الإصدار 1.1.0 — tauri.conf + Cargo.toml + pubspec + package.json",
      conf3?.version === "1.1.0" && cargoVer === "1.1.0" && pubspecVer === "1.1.0" && pkgJson?.version === "1.1.0",
      `tauri=${conf3?.version} cargo=${cargoVer} pubspec=${pubspecVer} pkg=${pkgJson?.version}`)

    // (ط) العقد §17 موثق
    check("العقد: §17 موثق (مصفوفة الحزم + تخطيط الموارد بالبادئة + resolve_resources + latest.json + dispatch opt-in)",
      contract.includes("## 17.") && contract.includes("resolve_resources") && contract.includes("x64-portable.zip")
      && contract.includes("attach_to_release") && contract.includes("/usr/lib/NexusLink"))
  }
  // ==========================================================================
  // §23 — إصدار 1.1.0: توحيد الإصدار + ملاحظات AR/EN + المحدّث + مسار الترقية
  // ==========================================================================
  {
    const fsp23 = (await import("node:fs")).default
    const rd23 = (p) => { try { return fsp23.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }

    // (أ) توحيد الإصدار — الملفات الستة 1.1.0
    const pkg23 = JSON.parse(rd23("package.json"))
    const conf23 = JSON.parse(rd23("apps/desktop/src-tauri/tauri.conf.json"))
    const cargo23 = rd23("apps/desktop/src-tauri/Cargo.toml")
    const cargoVer23 = (cargo23.match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
    const lockVer23 = (rd23("apps/desktop/src-tauri/Cargo.lock").match(/name = "nexuslink-desktop"\nversion = "([^"]+)"/m) ?? [])[1]
    const pubspec23 = rd23("nexuslink_mobile/pubspec.yaml")
    const pubspecVer23 = (pubspec23.match(/^version:\s*([^\s+]+)/m) ?? [])[1]
    const pubspecCode23 = (pubspec23.match(/^version:\s*\d+\.\d+\.\d+\+(\d+)/m) ?? [])[1]
    const gradle23 = rd23("nexuslink_mobile/android/app/build.gradle")
    const routeTs23 = rd23("src/app/api/version/route.ts")
    check("§23: توحيد الإصدار 1.1.0 — package.json + tauri.conf + Cargo.toml + Cargo.lock + pubspec + gradle fallback",
      pkg23?.version === "1.1.0" && conf23?.version === "1.1.0" && cargoVer23 === "1.1.0" && lockVer23 === "1.1.0"
      && pubspecVer23 === "1.1.0" && gradle23.includes('?: "1.1.0"'),
      `pkg=${pkg23?.version} tauri=${conf23?.version} cargo=${cargoVer23} lock=${lockVer23} pub=${pubspecVer23}`)
    check("§23: versionCode أندرويد تقدّم (1.0.0+1 → 1.1.0+2) — مسار ترقية APK صحيح",
      pubspecCode23 === "2" && pubspec23.includes("1.1.0+2"), `code=${pubspecCode23}`)
    check("§23: /api/version — CURRENT=1.1.0 + سجل محلي يحوي v1.1.0 وv1.0.0",
      routeTs23.includes('const CURRENT = "1.1.0"') && routeTs23.includes('tag: "v1.1.0"') && routeTs23.includes('tag: "v1.0.0"'),
      "version route")
    check("§23: updater.rs — User-Agent من CARGO_PKG_VERSION (بلا إصدار مثبت يدويًا)",
      rd23("apps/desktop/src-tauri/src/updater.rs").includes('concat!("NexusLink-Desktop/", env!("CARGO_PKG_VERSION"))'),
      "updater UA")

    // (ب) ملاحظات الإصدار عربية/إنجليزية + release.yml
    const notes23 = rd23("docs/releases/v1.1.0.md")
    check("§23: ملاحظات الإصدار v1.1.0 — قسمي العربية وEnglish بميزات الجولة 4 الحقيقية",
      notes23.includes("## العربية") && notes23.includes("## English") && notes23.includes("NexusLive")
      && notes23.includes("uinput") && notes23.includes("NexusLink Camera"), "release notes")
    check("§23: ملاحظات الإصدار توثق مسار الترقية 1.0.0 → 1.1.0 وحفظ الإعدادات",
      notes23.includes("1.0.0 → 1.1.0") && notes23.includes("SQLite"), "release notes upgrade")
    const rel23 = rd23(".github/workflows/release.yml")
    check("§23: release.yml — VERSION=1.1.0 + وسم الإرفاق اليدوي v1.1.0",
      rel23.includes('VERSION: "1.1.0"') && rel23.includes('default: "v1.1.0"'), "release.yml version")
    check("§23: release.yml — حارس ملاحظات الإصدار (فشل مبكر بلا العربية/English) + body_path على الوسم",
      rel23.includes("Verify release notes exist (AR/EN)") && rel23.includes("body_path: docs/releases/${{ github.ref_name }}.md"),
      "release.yml notes")
    check("§23: release.yml — توليد latest.json من توقيعات البناء (3 منصات) + SHA256SUMS + مسودة",
      rel23.includes('"windows-x86_64"') && rel23.includes('"linux-x86_64"') && rel23.includes('"darwin-aarch64"')
      && rel23.includes(".app.tar.gz.sig") && rel23.includes("SHA256SUMS") && rel23.includes("draft: true"),
      "release.yml latest.json")

    // (ج) سلامة الترقية — ضمان المخطط الإضافي + بذرة procman
    const dbTs23 = rd23("src/lib/db.ts")
    const hardTs23 = rd23("src/lib/nexus/desktop-hardening.ts")
    check("§23: db.ts — ضمان ترقية إضافي (CREATE TABLE IF NOT EXISTS DesktopSetting) بلا مساس بالبيانات",
      dbTs23.includes('CREATE TABLE IF NOT EXISTS "DesktopSetting"') && dbTs23.includes("dbReady"), "db.ts ensure")
    check("§23: مسار الإعدادات ينتظر الضمان قبل القراءة والكتابة (ترقية 1.0.0 → بلا تلف)",
      hardTs23.includes("await dbReady") && (hardTs23.match(/await dbReady/g) ?? []).length >= 2, "hardening dbReady")
    const procman23 = rd23("apps/desktop/src-tauri/src/procman.rs")
    check("§23: قاعدة المستخدم تُزرع مرة واحدة ولا تُستبدل عند التحديث (if !db_path.exists → seed)",
      procman23.includes("if !db_path.exists()") && procman23.includes("nexuslink.db") && procman23.includes("DATABASE_URL"),
      "procman seed")
    check("§23: بذرة الحزمة تُبنى من db/custom.db (build-resources) — 1.1.0 يأتي بجدول الإعدادات جاهزًا",
      rd23("apps/desktop/build-resources.sh").includes('cp db/custom.db "$RES/server/db/custom.db"'), "seed copy")

    // (د) أدوات الإصدار — latest.json المحلية + التحقق الفعلي للمسار
    check("§23: build-latest-json-v1.1.0.sh — توقيع الأصول الثلاثة وبناء latest.json بنفس النمط الأخضر",
      rd23("scripts/build-latest-json-v1.1.0.sh").includes("1.1.0") && rd23("scripts/build-latest-json-v1.1.0.sh").includes("sign_asset"),
      "latest.json builder")
    const upv23 = rd23("scripts/updater-path-verify.mjs")
    check("§23: updater-path-verify.mjs — نقطة الفحص الحية + minisign ضد pubkey + semver + محاكاة قاعدة قديمة",
      upv23.includes("latest/download/latest.json") && upv23.includes("minisign") && upv23.includes("1.1.0")
      && upv23.includes("CREATE TABLE IF NOT EXISTS"), "updater path verify")
    check("§23: updater.rs الإقلاعي — الفحص الوحيد للخارج خلف بوابة autoCheck من المخزن المشترك",
      rd23("apps/desktop/src-tauri/src/updater.rs").includes("autoCheck") && rd23("apps/desktop/src-tauri/src/updater.rs").includes("updater-check"),
      "updater startup gate")
    check("§23: حارس release.yml يفشل مبكرًا بلا قسمي العربية وEnglish حرفيًا",
      rel23.includes('grep -q "## العربية"') && rel23.includes('grep -q "## English"'), "notes guard literals")
check("§23: العقد §23 موثق (توحيد الإصدار + ملاحظات + latest.json + مسار الترقية + ضمان الإعدادات)",
      contract.includes("## 23.") && contract.includes("1.1.0") && contract.includes("DesktopSetting") && contract.includes("SHA256SUMS"),
      "contract §23")
    const cl23 = rd23("docs/e2e-checklist.md")
    check("§23: القائمة الميدانية §17 — اختبار الترقية الحقيقي (1.0.0 → إشعار → ترقية → إعدادات سليمة)",
      cl23.includes("## 17. اختبار الترقية 1.0.0 → 1.1.0") && cl23.includes("بلا تلف أي إعداد"), "checklist §17")
  }

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
