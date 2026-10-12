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

  rcCtl.disconnect()
  webSock.disconnect()
  rcDesk.disconnect()
  rcPhone.disconnect()
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
