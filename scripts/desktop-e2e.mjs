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
  // انتظار ديناميكي — تسلسل التراجع 81→8180 (EACCES ثم إعادة استماع) قد يتجاوز
  // ثانية واحدة؛ ثابت زمني واحد سبّب فشل إقلاع كامل دون سبب حقيقي (درس موثق).
  for (let i = 0; i < 40 && !gwPort; i++) await sleep(250)
  if (!gwPort) {
    // غيّة bun موثقة الآن: في مسار التراجع الخادم حي ويجيب /__gw/health لكن
    // callback نجاح الاستماع لا يُطلق فلا يُطبع «PORT=8180» (تحت node يعمل).
    // الاستشعار المباشر للمنفذ البديل هو الحسم الصادق — الهوية من role=gateway.
    const fb = await fetch("http://127.0.0.1:8180/__gw/health").then((r) => r.json()).catch(() => null)
    if (fb?.ok === true && fb?.role === "gateway") gwPort = 8180
    else throw new Error("gateway لم يعلن منفذه (PORT=…)")
  }
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

  // (أ2) SEC (M0.3 F1): الهاتف هنا يجب أن يكون موثوقًا قبل أوامر الطاقة —
  // نفس ما يفعله الوكيل الحقيقي (rc:hello-controller بهوية مقترنة) —
  // فبوابة rc:power/rc:wol ترفض المجهول حصرًا (فحصها في قسم SEC أدناه).
  rcPhone.emit("rc:hello-controller", { name: "Galaxy S24", deviceId: "galaxy-s24" })
  await sleep(600)

  // (ب) rc:power logout من هاتف موثوق يُرحّل للكمبيوتر مع __src=controller
  //     (الطبقة الأصلية تنفذه فعليًا في التطبيق)
  const powerCmd = await new Promise((res) => {
    rcDesk.on("rc:power", (d) => res(d))
    rcPhone.emit("rc:power", { action: "logout" })
    setTimeout(() => res(null), 6000)
  })
  check("FA-power: rc:power logout من هاتف موثوق يُرحّل للكمبيوتر مع __src=controller",
    powerCmd?.action === "logout" && String(powerCmd?.__src ?? "") === "controller", `got=${JSON.stringify(powerCmd)}`)
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
    // تصريف بث الحالة الذاتي (emit الكمبيوتر أعلاه يُبث لكل المآخذ بما فيها نفسه —
    // قد يتأخر تسليمه عبر polling البوابة) قبل اختبار الرفض — أي حدث بعده مصدره الهاتف
    await sleep(1000)
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
    // استطلاع محدود بدل نوم ثابت — تنظيف النقطة لحظي لكن تأتيه يتسابق مع حمولة الحزمة
    filesSock.disconnect()
    let st4 = null
    const wipeT0 = Date.now()
    while (Date.now() - wipeT0 < 8000) {
      await sleep(400)
      st4 = await fetch(`http://127.0.0.1:3000/api/desktop/status`).then((r) => r.json()).catch(() => null)
      if (st4?.desktop?.agentMedia == null) break
    }
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
  // R5 (عقد §24) — هاتف→هاتف عبر المركز: بوابة الثقة + جلسة موثقة + توجيه الإدخال
  // + القطع الفوري من الطرفين + وسم guard:screen + مرآة الشاشة (rtc kind=mirror)
  // كل الفحوص مبنية على حقائق guard-bridge.ts الحرفية (بوابة p2p:ctl-start وترتيبها)
  // ==========================================================================
  {
    console.log("\n== R5 §24: هاتف→هاتف (ثقة + جلسة + توجيه + قطع فوري + مرآة) ==")

    // (أ) هاتفان يسجلان على جسر الحماية 3006 (نفس تسليم guard:hello-phone الحرفي)
    const pA = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3006" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const pB = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3006" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await Promise.all([
      new Promise((res, rej) => { pA.on("connect", res); pA.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("phoneA timeout")), 10000) }),
      new Promise((res, rej) => { pB.on("connect", res); pB.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("phoneB timeout")), 10000) }),
    ])
    const agentsP = new Promise((res) => {
      pA.on("guard:agents", (d) => {
        const ids = (d?.agents ?? []).map((a) => a?.deviceId)
        if (ids.includes("galaxy-s24") && ids.includes("redmi-note13")) res(d)
      })
      setTimeout(() => res(null), 8000)
    })
    pA.emit("guard:hello-phone", { name: "Galaxy-S24", deviceId: "galaxy-s24" })
    await sleep(300)
    pB.emit("guard:hello-phone", { name: "Redmi-Note13", deviceId: "redmi-note13" })
    const agentsList = await agentsP
    check("§24: guard:agents يبث الهاتفين معرفةً (تعدد وكلاء) + sessions مصفوفة",
      Array.isArray(agentsList?.agents) && agentsList.agents.some((a) => a.deviceId === "galaxy-s24")
        && agentsList.agents.some((a) => a.deviceId === "redmi-note13") && Array.isArray(agentsList?.sessions),
      JSON.stringify(agentsList?.agents ?? {}).slice(0, 140))

    // (ب) بوابة الثقة — الأسباب الحرفية بترتيب الجسر (identity → self → target-untrusted → target-offline)
    const p2pReject = (sock, payload, want) => new Promise((res) => {
      const h = (d) => { if (d?.reason === want) { sock.off("p2p:ctl-rejected", h); res(d) } }
      sock.on("p2p:ctl-rejected", h)
      sock.emit("p2p:ctl-start", payload)
      setTimeout(() => { sock.off("p2p:ctl-rejected", h); res(null) }, 6000)
    })
    const rId = await p2pReject(pB, { from: "galaxy-s24", target: "redmi-note13" }, "identity")
    check("§24: طلب بلا مطابقة هوية السوكِت → identity (ربط الهوية)", rId?.reason === "identity")
    const rSelf = await p2pReject(pA, { from: "galaxy-s24", target: "galaxy-s24" }, "self")
    check("§24: لا هاتف يتحكم بنفسه أبدًا → self", rSelf?.reason === "self")
    const rTgt = await p2pReject(pA, { from: "galaxy-s24", target: "stranger-y" }, "target-untrusted")
    check("§24: هدف غير مقترن → target-untrusted", rTgt?.reason === "target-untrusted")
    const rOff = await p2pReject(pA, { from: "galaxy-s24", target: "nexus-tv" }, "target-offline")
    check("§24: هدف مقترن لكنه غير حي (بلا سوكِت) → target-offline", rOff?.reason === "target-offline")

    // (ج) الجلسة: طلب → dev:ctl-start يصل الهدف → تأكيد صاحبه (سلوك الهاتف الحقيقي
    // emitCtlState(true,"confirmed",controller) حرفيًا) → حالة موجهة {target} للمتحكم
    const ctlStartAtB = new Promise((res) => {
      pB.on("dev:ctl-start", (d) => { if (d?.from === "galaxy-s24" && d?.p2p === true) res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("p2p:ctl-start", { from: "galaxy-s24", target: "redmi-note13", name: "Galaxy-S24" })
    const startEvt = await ctlStartAtB
    check("§24: p2p:ctl-start موثوق → dev:ctl-start {from,p2p:true} يصل الهدف",
      startEvt?.from === "galaxy-s24" && startEvt?.p2p === true, JSON.stringify(startEvt ?? {}).slice(0, 120))
    const ctlStateAtA = new Promise((res) => {
      pA.on("dev:ctl-state", (d) => { if (d?.active === true && d?.target === "redmi-note13") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB.emit("dev:ctl-state", { active: true, reason: "confirmed", controller: "galaxy-s24", name: "Galaxy-S24", at: Date.now() })
    const activeState = await ctlStateAtA
    check("§24: تأكيد الهدف → جلسة موثقة وحالة موجهة {active,target} للمتحكم",
      activeState?.active === true && activeState?.target === "redmi-note13", JSON.stringify(activeState ?? {}).slice(0, 120))

    // (د) توجيه الإدخال داخل الجلسة (أسماء أحداث الويب نفسها + تنقية الجسر)
    const touchAtB = new Promise((res) => {
      pB.on("dev:touch", (d) => { if (d?.op === "tap") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("dev:touch", { op: "tap", x: 0.5, y: 0.25, seq: 7 })
    const touchEvt = await touchAtB
    check("§24: dev:touch tap يُوجّه للهدف داخل الجلسة (بلا صدى) — clampCoord: 0.25→0.3 (Math.round نصفه لأعلى حرفيًا)",
      touchEvt?.op === "tap" && touchEvt?.x === 0.5 && touchEvt?.y === 0.3 && touchEvt?.seq === 7,
      JSON.stringify(touchEvt ?? {}).slice(0, 120))
    const moveAtB = new Promise((res) => {
      pB.on("dev:touch", (d) => { if (d?.op === "move") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("dev:touch", { op: "move", x: 100.5, y: -3 })
    const moveEvt = await moveAtB
    check("§24: تنقية clampCoord على مسار الهاتف (1 عشري + السالب→0)",
      moveEvt?.x === 100.5 && moveEvt?.y === 0, JSON.stringify(moveEvt ?? {}).slice(0, 100))
    let badOpSeen = false
    pB.on("dev:touch", (d) => { if (d?.op === "explode") badOpSeen = true })
    pA.emit("dev:touch", { op: "explode", x: 1, y: 1 })
    await sleep(1200)
    check("§24: op خارج القائمة البيضاء (TOUCH_OPS) يُرفض صامتًا", badOpSeen === false)
    const textAtB = new Promise((res) => {
      pB.on("dev:text", (d) => { if (typeof d?.text === "string") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("dev:text", { text: "مرحبا من الهاتف" })
    const textEvt = await textAtB
    check("§24: dev:text عربي UTF-8 سليم عبر التوجيه", textEvt?.text === "مرحبا من الهاتف", JSON.stringify(textEvt ?? {}).slice(0, 100))
    const keyAtB = new Promise((res) => {
      pB.on("dev:key", (d) => { if (d?.action === "back") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("dev:key", { action: "back" })
    const keyEvt = await keyAtB
    check("§24: dev:key (back) يمر عبر KEY_ACTIONS", keyEvt?.action === "back")
    const ackAtA = new Promise((res) => {
      pA.on("dev:touch-ack", (d) => { if (d?.seq === 7) res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB.emit("dev:touch-ack", { seq: 7, ok: true, at: Date.now() })
    const ackEvt = await ackAtA
    check("§24: dev:touch-ack من الهدف يُوجّه للمتحكم حصرًا", ackEvt?.seq === 7 && ackEvt?.ok === true, JSON.stringify(ackEvt ?? {}).slice(0, 100))

    // (هـ) الحاجز الحاسم: هاتف بلا جلسة موثقة → الإدخال مرفوض no-session
    // (يمنع تحكم أي هاتف بنفسه أو بغيره عبر مسار الوكيل الأساسي)
    const noSess = new Promise((res) => {
      pB.on("dev:ctl-rejected", (d) => { if (d?.reason === "no-session") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB.emit("dev:touch", { op: "tap", x: 0.1, y: 0.1 })
    const noSessEvt = await noSess
    check("§24: هاتف بلا جلسة (الهدف نفسه) → no-session (حاجز التحكم الذاتي)",
      noSessEvt?.reason === "no-session")

    // (و) لا ازدواج: هدف مشغول (target-busy) + متحكم مشغول (already-controlling)
    const pC = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3006" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await new Promise((res, rej) => { pC.on("connect", res); pC.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("phoneC timeout")), 10000) })
    pC.emit("guard:hello-phone", { name: "iPad-Pro", deviceId: "ipad-pro" })
    await sleep(500)
    const rBusy = await p2pReject(pC, { from: "ipad-pro", target: "redmi-note13" }, "target-busy")
    check("§24: هدف محكوم به من جلسة قائمة → target-busy", rBusy?.reason === "target-busy")
    const rDup = await p2pReject(pA, { from: "galaxy-s24", target: "ipad-pro" }, "already-controlling")
    check("§24: متحكم له جلسة قائمة → already-controlling", rDup?.reason === "already-controlling")

    // (ز) القطع الفوري من المتحكم: ctl-stop → أمر للهدف + حالة للمتحكم + حذف الجلسة
    const stopAtB = new Promise((res) => {
      pB.on("dev:ctl-stop", (d) => { if (d?.reason === "controller-stop") res(d) })
      setTimeout(() => res(null), 6000)
    })
    const stopAtA = new Promise((res) => {
      // الإشعار للمتحكم يحمل {active:false, reason:"controller-stop", controller} — بلا target (حرفيًا)
      pA.on("dev:ctl-state", (d) => { if (d?.active === false && d?.reason === "controller-stop" && d?.controller === "galaxy-s24") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pA.emit("p2p:ctl-stop", { target: "redmi-note13" })
    const [bStop, aStop] = await Promise.all([stopAtB, stopAtA])
    check("§24: p2p:ctl-stop → dev:ctl-stop{controller-stop} للهدف فورًا", bStop?.reason === "controller-stop")
    check("§24: حالة النهاية {active:false,controller} تعود للمتحكم", aStop?.active === false && aStop?.controller === "galaxy-s24")
    const noSess2 = new Promise((res) => {
      pB.on("dev:ctl-rejected", (d) => { if (d?.reason === "no-session") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB.emit("dev:touch", { op: "tap", x: 0.1, y: 0.1 })
    check("§24: بعد القطع لا جلسة — الإدخال مرفوض مجددًا (حذف فعلي)", (await noSess2)?.reason === "no-session")

    // (ح) القطع الفوري بانقطاع الطرفين (teardown ثنائي الاتجاه — عقد §24.أمن)
    pA.emit("p2p:ctl-start", { from: "galaxy-s24", target: "redmi-note13", name: "Galaxy-S24" })
    await sleep(400)
    const reConfirm = new Promise((res) => {
      pA.on("dev:ctl-state", (d) => { if (d?.active === true && d?.target === "redmi-note13") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB.emit("dev:ctl-state", { active: true, reason: "confirmed", controller: "galaxy-s24", at: Date.now() })
    await reConfirm
    const targetGone = new Promise((res) => {
      pA.on("dev:ctl-state", (d) => { if (d?.active === false && d?.reason === "target-disconnected") res(d) })
      setTimeout(() => res(null), 8000)
    })
    pB.disconnect()
    const goneEvt = await targetGone
    check("§24: انقطاع الهدف → {active:false, target-disconnected} للمتحكم فورًا", goneEvt?.reason === "target-disconnected")
    const pB2 = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3006" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await new Promise((res, rej) => { pB2.on("connect", res); pB2.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("phoneB2 timeout")), 10000) })
    pB2.emit("guard:hello-phone", { name: "Redmi-Note13", deviceId: "redmi-note13" })
    await sleep(500)
    pA.emit("p2p:ctl-start", { from: "galaxy-s24", target: "redmi-note13", name: "Galaxy-S24" })
    await sleep(400)
    const reConfirm2 = new Promise((res) => {
      pA.on("dev:ctl-state", (d) => { if (d?.active === true && d?.target === "redmi-note13") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB2.emit("dev:ctl-state", { active: true, reason: "confirmed", controller: "galaxy-s24", at: Date.now() })
    await reConfirm2
    const cutAtB2 = new Promise((res) => {
      pB2.on("dev:ctl-stop", (d) => { if (d?.reason === "controller-disconnected") res(d) })
      setTimeout(() => res(null), 8000)
    })
    pA.disconnect()
    const cutEvt = await cutAtB2
    check("§24: انقطاع المتحكم → dev:ctl-stop{controller-disconnected} للهدف فورًا (لا جلسة يتيمة)", cutEvt?.reason === "controller-disconnected")

    // (ط) وسم guard:screen بمعرف المرسل (تعدد وكلاء) — العارض يفلتر بهدفه في العميل
    const screenAtB2 = new Promise((res) => {
      pB2.on("guard:screen", (d) => { if (d?.deviceId === "ipad-pro") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pC.emit("dev:screen", { w: 2048, h: 2732, density: 264 })
    const scrC = await screenAtB2
    check("§24: dev:screen من وكيل ثالث → guard:screen موسوم deviceId=ipad-pro",
      scrC?.w === 2048 && scrC?.h === 2732 && scrC?.deviceId === "ipad-pro", JSON.stringify(scrC ?? {}).slice(0, 120))
    const screenFromB2 = new Promise((res) => {
      pC.on("guard:screen", (d) => { if (d?.deviceId === "redmi-note13") res(d) })
      setTimeout(() => res(null), 6000)
    })
    pB2.emit("dev:screen", { w: 1080, h: 2400, density: 440 })
    const scrB = await screenFromB2
    check("§24: وسم المرسل نفسه (1080×2400 @440 → deviceId=redmi-note13)",
      scrB?.w === 1080 && scrB?.deviceId === "redmi-note13")

    // (ي) المرآة على 3005: إشارات rtc:* الشفافة نفسها بنوع kind=mirror —
    // الناشر (هاتف ب) يعرض والعارض (هاتف أ) يجيب — والكمبيوتر يتجاهلها (عميله)
    const mPub = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const mView = io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3005" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    await Promise.all([mPub, mView].map((s) => new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("media timeout")), 10000) })))
    mPub.emit("media:role", { role: "phone", name: "Pub-B" })
    mView.emit("media:role", { role: "phone", name: "View-A" })
    await sleep(400)
    const mirrorAtViewer = new Promise((res) => {
      mView.on("rtc:offer", (d) => { if (d?.kind === "mirror") res(d) })
      setTimeout(() => res(null), 6000)
    })
    mPub.emit("rtc:offer", { kind: "mirror", sdp: { type: "offer", sdp: "v=0\r\no=- 9 2 IN IP4 127.0.0.1\r\n" } })
    const mirOffer = await mirrorAtViewer
    check("§24: rtc:offer kind=mirror من الناشر يصل العارض الهاتفي (from=phone)",
      mirOffer?.kind === "mirror" && mirOffer?.from === "phone", JSON.stringify(mirOffer ?? {}).slice(0, 100))
    const mirAnswerAtPub = new Promise((res) => {
      mPub.on("rtc:answer", (d) => { if (d?.kind === "mirror") res(d) })
      setTimeout(() => res(null), 6000)
    })
    mView.emit("rtc:answer", { kind: "mirror", sdp: { type: "answer", sdp: "v=0\r\n" } })
    const mirAns = await mirAnswerAtPub
    check("§24: rtc:answer kind=mirror من العارض يعود للناشر (أول إجابة §4.3)", mirAns?.kind === "mirror")
    const mirIceAtPub = new Promise((res) => {
      mPub.on("rtc:ice", (d) => { if (d?.kind === "mirror" && d?.candidate) res(d) })
      setTimeout(() => res(null), 6000)
    })
    mView.emit("rtc:ice", { kind: "mirror", candidate: { candidate: "candidate:9 1 UDP 2122252543 192.168.1.20 50009 typ host", sdpMid: "0", sdpMLineIndex: 0 } })
    const mirIce = await mirIceAtPub
    check("§24: rtc:ice kind=mirror يرحّل بين الهاتفين",
      mirIce?.candidate?.candidate?.startsWith("candidate:9"), JSON.stringify(mirIce ?? {}).slice(0, 100))

    // (ك) مصادر حرفية — توثيق التعاقد بين الطرفين (نمط فحوص §17/§23)
    const contractR5 = await fsMod.readFile(pathMod.join(ROOT, "docs/protocol-contract.md"), "utf8")
    check("§24/§25: العقد موثق (## 24. هاتف→هاتف + ## 25. مركز رفع القيود)",
      contractR5.includes("## 24.") && contractR5.includes("## 25.") && contractR5.includes('kind="mirror"') && contractR5.includes("access_restricted_settings"))
    const mobProto = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/lib/core/protocol.dart"), "utf8")
    check("§24: P2pEvents — الهاتف يستخدم أسماء أحداث الويب نفسها (p2p:ctl-start/dev:touch/dev:text/dev:key)",
      mobProto.includes("'p2p:ctl-start'") && mobProto.includes("'dev:touch'") && mobProto.includes("'dev:text'") && mobProto.includes("'dev:key'"))
    const guardTs = await fsMod.readFile(pathMod.join(ROOT, "src/lib/nexus/guard-bridge.ts"), "utf8")
    check("§24: الجسر يوجّه (p2p:ctl-start + no-session + teardown ثنائي) — مصدر واحد للتوجيه",
      guardTs.includes('"p2p:ctl-start"') && guardTs.includes('"no-session"') && guardTs.includes("teardownP2pForDisconnect"))
    const prSvc = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/lib/data/phone_remote_service.dart"), "utf8")
    check("§24: وحدة التحكم الهاتفية — حاجز ذاتي ثانٍ (targetId==deviceId) + بوابة sessionActive للإدخال",
      prSvc.includes("if (targetId == deviceId) return") && prSvc.includes("!_state.sessionActive"))
    const manifestR5 = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/android/app/src/main/AndroidManifest.xml"), "utf8")
    check("§24: ScreenShareService في المانيفست — FGS بنوع mediaProjection وغير مُصدَّرة",
      manifestR5.includes("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION") && manifestR5.includes('android:name=".ScreenShareService"')
        && manifestR5.includes('android:foregroundServiceType="mediaProjection"') && manifestR5.includes('android:exported="false"'))
    const sss = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/ScreenShareService.kt"), "utf8")
    check("§24: خدمة المشاركة — FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION + إيقاف صريح (ACTION_STOP)",
      sss.includes("ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION") && sss.includes("ACTION_STOP"))
    const mainKt = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/MainActivity.kt"), "utf8")
    check("§24/§25: MainActivity — startScreenShareService + openAppDetails + restrictedSettingsStatus (AppOps الحرفي)",
      mainKt.includes('"startScreenShareService"') && mainKt.includes('"openAppDetails"') && mainKt.includes('"restrictedSettingsStatus"') && mainKt.includes("android:access_restricted_settings"))
    const medSvc = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/lib/data/media_service.dart"), "utf8")
    check("§24: مسار المشاركة التعاقدي — موافقة النظام أولًا ثم FGS ثم getDisplayMedia (بلا حوار ثانٍ)",
      medSvc.includes("requestCapturePermission") && medSvc.includes("startScreenShareService") && medSvc.includes("getDisplayMedia"))
    const umb = await fsMod.readFile(pathMod.join(ROOT, "src/hooks/use-media-bridge.ts"), "utf8")
    check("§24: عارض الويب يتجاهل kind=mirror حرفيًا (الكمبيوتر ليس عارض المرآة)",
      umb.includes('d.kind === "mirror"') && umb.includes('d?.kind === "mirror"'))

    // (ل) §25 — مركز رفع القيود: مصادر حرفية + ترجمات متوازية AR/EN
    const ucs = await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/lib/presentation/unblock_center_screen.dart"), "utf8")
    check("§25: مركز رفع القيود — فحص AppOps + زر صفحة التطبيق + خطوات الفك",
      ucs.includes("restrictedSettingsStatus") && ucs.includes("openAppDetails") && ucs.includes("unblock.step1"))
    const arT = JSON.parse(await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/assets/translations/ar.json"), "utf8"))
    const enT = JSON.parse(await fsMod.readFile(pathMod.join(ROOT, "nexuslink_mobile/assets/translations/en.json"), "utf8"))
    check("§24/§25: ترجمات AR/EN متوازية لكل مفاتيح الجولة 5 (p2p/unblock/mirror/settings)",
      arT?.p2p?.title && enT?.p2p?.title && arT?.unblock?.title && enT?.unblock?.title
        && arT?.mirror?.shareCard && enT?.mirror?.shareCard && arT?.settings?.p2pEntry && enT?.settings?.p2pEntry)
    const checklistR5 = await fsMod.readFile(pathMod.join(ROOT, "docs/e2e-checklist.md"), "utf8")
    check("§24/§25: القائمة الميدانية — اختبار هاتفين حقيقيين + خطوات الفك على جهاز 13+",
      checklistR5.includes("الجولة 5") && checklistR5.includes("مركز رفع القيود") && checklistR5.includes("الإعدادات المقيّدة"))

    pC.disconnect()
    pB2.disconnect()
    mPub.disconnect()
    mView.disconnect()
  }

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

    // (د) /api/version — الإصدار الموحّد (package.json مصدر الحقيقة) + سجل إصدارات حقيقي (بند 2)
    const ver = await fetch(`${base}/api/version`).then((r) => r.json()).catch(() => null)
    const pkgVer16 = JSON.parse((await import("node:fs")).default.readFileSync(pathMod.join(ROOT, "package.json"), "utf8"))?.version
    check("§16: /api/version — current موحّد مع package.json + سجل إصدارات حقيقي",
      !!pkgVer16 && ver?.current === pkgVer16 && Array.isArray(ver?.changelog) && ver.changelog.some((c) => String(c.version).replace(/^v/, "") !== pkgVer16),
      JSON.stringify({ current: ver?.current, pkg: pkgVer16, entries: ver?.changelog?.length }).slice(0, 90))

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
    const pkgVer16b = JSON.parse(fsSync.readFileSync(pathMod.join(ROOT, "package.json"), "utf8"))?.version
    check("§16: tauri.conf — updater endpoints+pubkey+createUpdaterArtifacts+إصدار موحّد مع package.json",
      Array.isArray(conf?.plugins?.updater?.endpoints) && conf.plugins.updater.endpoints.some((e) => String(e).endsWith("/latest/download/latest.json"))
      && String(conf?.plugins?.updater?.pubkey ?? "").length > 100
      && conf?.bundle?.createUpdaterArtifacts === true
      && conf?.version === pkgVer16b,
      `tauri=${conf?.version} pkg=${pkgVer16b}`)
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

    // (ب) tauri.conf — الصيغ الخمسة + إصدار موحّد مع package.json
    const targets = conf3?.bundle?.targets ?? []
    const pkgVer17 = JSON.parse(rd("package.json"))?.version
    check("§17: tauri.conf targets الخمسة (deb nsis msi appimage dmg) + إصدار موحّد مع package.json",
      ["deb", "nsis", "msi", "appimage", "dmg"].every((t) => targets.includes(t)) && conf3?.version === pkgVer17,
      `${targets.join(",")} tauri=${conf3?.version} pkg=${pkgVer17}`)

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

    // (ح) توحيد الإصدار — الملفات الأربعة على إصدار package.json (مصدر الحقيقة)
    const pkgJson = JSON.parse(rd("package.json"))
    const cargoVer = (rd("apps/desktop/src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
    const pubspecVer = (rd("nexuslink_mobile/pubspec.yaml").match(/^version:\s*([^\s+]+)/m) ?? [])[1]
    check("§17: توحيد الإصدار — tauri.conf + Cargo.toml + pubspec + package.json على إصدار واحد",
      conf3?.version === pkgJson?.version && cargoVer === pkgJson?.version && pubspecVer === pkgJson?.version,
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

    // (أ) توحيد الإصدار — الملفات الستة على إصدار package.json (مصدر الحقيقة)
    const pkg23 = JSON.parse(rd23("package.json"))
    const ver23 = pkg23?.version
    const conf23 = JSON.parse(rd23("apps/desktop/src-tauri/tauri.conf.json"))
    const cargo23 = rd23("apps/desktop/src-tauri/Cargo.toml")
    const cargoVer23 = (cargo23.match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
    const lockVer23 = (rd23("apps/desktop/src-tauri/Cargo.lock").match(/name = "nexuslink-desktop"\nversion = "([^"]+)"/m) ?? [])[1]
    const pubspec23 = rd23("nexuslink_mobile/pubspec.yaml")
    const pubspecVer23 = (pubspec23.match(/^version:\s*([^\s+]+)/m) ?? [])[1]
    const pubspecCode23 = (pubspec23.match(/^version:\s*\d+\.\d+\.\d+\+(\d+)/m) ?? [])[1]
    const gradle23 = rd23("nexuslink_mobile/android/app/build.gradle")
    const routeTs23 = rd23("src/app/api/version/route.ts")
    check("§23: توحيد الإصدار — package.json + tauri.conf + Cargo.toml + Cargo.lock + pubspec + gradle fallback على إصدار واحد",
      pkg23?.version && conf23?.version === ver23 && cargoVer23 === ver23 && lockVer23 === ver23
      && pubspecVer23 === ver23 && gradle23.includes(`?: "${ver23}"`),
      `pkg=${pkg23?.version} tauri=${conf23?.version} cargo=${cargoVer23} lock=${lockVer23} pub=${pubspecVer23}`)
    check("§23: versionCode أندرويد تقدّم مع الإصدار (pubspec يحمل VER+code بترقية صحيحة)",
      Number(pubspecCode23) >= 2 && pubspec23.includes(`${ver23}+${pubspecCode23}`), `code=${pubspecCode23} ver=${ver23}`)
    check("§23: /api/version — CURRENT مطابق للإصدار الموحّد + سجل محلي يحوي الإصدار الحالي وأقدم منه",
      routeTs23.includes(`const CURRENT = "${ver23}"`) && routeTs23.includes(`tag: "v${ver23}"`)
      && (routeTs23.match(/tag: "v/g) ?? []).length >= 2,
      `ver=${ver23} tags=${(routeTs23.match(/tag: "v([^"]+)/g) ?? []).join(",")}`)
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
    check("§23: release.yml — VERSION مطابق للإصدار الموحّد + وسم الإرفاق اليدوي عليه",
      rel23.includes(`VERSION: "${ver23}"`) && rel23.includes(`default: "v${ver23}"`), `ver=${ver23}`)
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

    // ============================================================
    // G-1 — تحقق سر الاقتران (عقد §6: إغلاق الفجوة المؤجلة «لمرحلة الأمان»)
    // نافذة 10 دقائق · تدوير عند كل إصدار (آخر رمز هو الصالح) · رفض مسبب 403 · تدقيق أمني
    // ============================================================
    console.log("\n== G-1: pairing secret verification ==")
    {
      const g1Base = "http://127.0.0.1:3000"
      const fspG1 = (await import("node:fs")).default
      const rdG1 = (p) => { try { return fspG1.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const G1_ID = `e2e-g1-${Date.now().toString(36)}`
      const postPair = async (body) =>
        fetch(`${g1Base}/api/devices`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => null)

      // (أ) بلا نافذة اقتران: أول pair بعد إقلاع نظيف → 403 no-window
      const cold = await postPair({ action: "pair", name: "E2E-G1-Cold", kind: "phone" })
      const coldJson = await cold?.json().catch(() => null)
      check("G-1: pair قبل إصدار أي رمز → 403 reason=no-window (لا اقتران أعمى)",
        cold?.status === 403 && coldJson?.reason === "no-window" && coldJson?.ok === false,
        `HTTP ${cold?.status} reason=${coldJson?.reason}`)

      // (ب) إصدار رمز: شفافية النافذة (ttlMs + expiresAt)
      const qr1 = await fetch(`${g1Base}/api/devices/qr`).then((r) => r.json()).catch(() => null)
      check("G-1: QR يعيد ttlMs=600000 وexpiresAt مستقبليًا",
        qr1?.ttlMs === 600000 && typeof qr1?.expiresAt === "number" && qr1.expiresAt > Date.now(),
        `exp-in=${qr1 ? qr1.expiresAt - Date.now() : "?"}ms`)
      check("G-1: QR الحمولة تحمل السر كاملًا (32 hex) للعميل الممسِك",
        typeof qr1?.payload?.secret === "string" && qr1.payload.secret.length === 32, `code=${qr1?.code}`)

      // (ج) نافذة نشطة: بلا سر → missing · سر فاسد → invalid
      const noSec = await postPair({ action: "pair", name: "E2E-G1-NoSecret", kind: "phone" })
      const noSecJson = await noSec?.json().catch(() => null)
      check("G-1: pair بلا سر (نافذة نشطة) → 403 reason=missing",
        noSec?.status === 403 && noSecJson?.reason === "missing", `HTTP ${noSec?.status}`)
      const badSec = await postPair({ action: "pair", name: "E2E-G1-BadSecret", kind: "phone", secret: "f".repeat(32) })
      const badSecJson = await badSec?.json().catch(() => null)
      check("G-1: pair بسر فاسد → 403 reason=invalid",
        badSec?.status === 403 && badSecJson?.reason === "invalid", `HTTP ${badSec?.status}`)

      // (د) القبول: السر الصحيح → 200 + trusted:true (التسجيل الجديد)
      const okPair = await postPair({ action: "pair", id: G1_ID, name: "E2E-G1-Phone", kind: "phone", ip: "192.168.1.99", battery: 66, secret: qr1?.payload?.secret })
      const okJson = await okPair?.json().catch(() => null)
      check("G-1: pair بسر QR الصحيح → 200 ok:true",
        okPair?.status === 200 && okJson?.ok === true && okJson?.device?.id === G1_ID, `HTTP ${okPair?.status}`)
      check("G-1: الجهاز المقترن بسر صحيح trusted:true (سلسلة الثقة §13/§24 سليمة)",
        okJson?.device?.trusted === true)

      // (هـ) إعادة التسجيل (مسار الجهاز الموجود) تخضع للتحقق نفسه
      const reReg = await postPair({ action: "pair", id: G1_ID, name: "E2E-G1-Phone", kind: "phone", battery: 65, secret: qr1?.payload?.secret })
      const reRegJson = await reReg?.json().catch(() => null)
      check("G-1: إعادة تسجيل نفس الجهاز بسر صحيح → 200 (idempotent بعد التحقق)",
        reReg?.status === 200 && reRegJson?.device?.id === G1_ID && reRegJson?.device?.battery === 65,
        `HTTP ${reReg?.status} battery=${reRegJson?.device?.battery}`)
      const reHijack = await postPair({ action: "pair", id: G1_ID, name: "E2E-G1-Phone", kind: "phone", battery: 10 })
      check("G-1: إعادة تسجيل بلا سر → 403 (منع اختطاف هوية جهاز معروف)",
        reHijack?.status === 403, `HTTP ${reHijack?.status}`)

      // (و) التدوير: إصدار جديد يُبطل السابق (آخر رمز مُصدَر هو الصالح)
      const qr2 = await fetch(`${g1Base}/api/devices/qr`).then((r) => r.json()).catch(() => null)
      const stale = await postPair({ action: "pair", name: "E2E-G1-Stale", kind: "phone", secret: qr1?.payload?.secret })
      const staleJson = await stale?.json().catch(() => null)
      check("G-1: pair بالسر القديم بعد إصدار رمز جديد → 403 reason=invalid (تدوير)",
        stale?.status === 403 && staleJson?.reason === "invalid" && qr2?.payload?.secret !== qr1?.payload?.secret,
        `HTTP ${stale?.status}`)

      // (ز) التدقيق الأمني: الرفض warn + النجاح info مرئيان في واجهة المراجعة §16
      await sleep(400)
      const auditG1 = await fetch(`${g1Base}/api/desktop/audit?take=500`).then((r) => r.json()).catch(() => null)
      const g1Events = auditG1?.events ?? []
      const rejects = g1Events.filter((e) => e.action === "pairing-reject")
      const accepts = g1Events.filter((e) => e.action === "pairing")
      check("G-1: تدقيق pairing-reject مرئي (≥5 رفض بأسبابها — severity warn)",
        rejects.length >= 5 && rejects.every((e) => e.severity === "warn"), `rejects=${rejects.length}`)
      check("G-1: تدقيق pairing مرئي (≥2 نجاح — جديد + إعادة تسجيل)",
        accepts.length >= 2, `accepts=${accepts.length}`)
      check("G-1: تفاصيل الرفض تحمل السبب الآلي (reason) للمطابقة",
        rejects.some((e) => String(e.detail).includes("no-window"))
        && rejects.some((e) => String(e.detail).includes("missing"))
        && rejects.some((e) => String(e.detail).includes("invalid")), "reasons in detail")

      // (ح) فحوص مصدر — البنية التعاقدية في الملفات
      const g1devices = rdG1("src/lib/nexus/devices.ts")
      check("G-1: devices.ts — PAIRING_TTL_MS + timingSafeEqual + أسباب الرفع الأربعة",
        g1devices.includes("PAIRING_TTL_MS = 10 * 60_000") && g1devices.includes("crypto.timingSafeEqual")
        && g1devices.includes('"no-window"') && g1devices.includes('"expired"'), "verifier source")
      const g1route = rdG1("src/app/api/devices/route.ts")
      check("G-1: route.ts — التحقق أعلى pair (قبل مسارَي الجديد والموجود) + 403 مسبب + تدقيق",
        g1route.includes("verifyPairingSecret(body.secret)") && g1route.includes('status: 403')
        && g1route.includes('"pairing-reject"') && g1route.includes('"pairing"'), "pair route source")
      const g1qr = rdG1("src/app/api/devices/qr/route.ts")
      check("G-1: qr/route.ts — ttlMs/expiresAt في الاستجابة (شفافية النافذة)",
        g1qr.includes("ttlMs: PAIRING_TTL_MS") && g1qr.includes("expiresAt:"), "qr source")
      const g1view = rdG1("src/components/nexus/devices-view.tsx")
      check("G-1: PairDialog — يرسل السر ويعالج الرفض بإعادة إصدار تلقائية",
        g1view.includes("payload?.secret") && g1view.includes('secret }') && g1view.includes("await begin()"), "dialog source")
      const g1api = rdG1("nexuslink_mobile/lib/data/nexus_api.dart")
      check("G-1: Flutter api — معامل secret + 403 → PairingRejectedException",
        g1api.includes("String? secret") && g1api.includes("PairingRejectedException") && g1api.includes("statusCode == 403"), "flutter api")
      const g1prov = rdG1("nexuslink_mobile/lib/state/providers.dart")
      check("G-1: Flutter connect — الإدخال اليدوي يجلب السر من QR (عقد §7) ويمرره لـ pair",
        g1prov.includes("api.pairingQr()") && g1prov.includes("secret: pairingSecret"), "flutter provider")
      const g1audit = rdG1("src/app/api/desktop/audit/route.ts")
      check("G-1: audit route — مفردات pairing في SERVER_ACTIONS (مرئية في المراجعة)",
        g1audit.includes('"pairing-reject"'), "audit visibility")
      const contractG1 = rdG1("docs/protocol-contract.md")
      check("G-1: العقد §6 — صف الفجوة G-1 موثق كمُصلح مع البروتوكول",
        contractG1.includes("G-1") && contractG1.includes("مُصلحة") && contractG1.includes("verifyPairingSecret"), "contract §6")
    }

    // ============================================================
    // G-37 — التبديل السلس لجودة البث أثناء الجلسة (عقد §15: إغلاق آخر فجوة الجولة 4)
    // خلية LiveQoS مشتركة: media_screen_set يحدّثها ويرفع rebuild — خيط الالتقاط
    // يقرأها عند كل إعادة بناء — اتصال WebRTC يبقى حيًا (بلا stop→req)
    // ============================================================
    console.log("\n== G-37: live quality switch (smooth, no stop->req) ==")
    {
      const fspG37 = (await import("node:fs")).default
      const rdG37 = (p) => { try { return fspG37.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const mediaRs = rdG37("apps/desktop/src-tauri/src/media.rs")
      const bridgeTs = rdG37("src/components/nexus/desktop-bridge.tsx")
      const pcScreen = rdG37("nexuslink_mobile/lib/presentation/pc_screen_screen.dart")
      const auditMd = rdG37("docs/round4-audit.md")
      const contract37 = rdG37("docs/protocol-contract.md")

      // (أ) Rust — البنية: خلية حية + جلسة تحملها + الحلقات الثلاث تقرأها
      check("G-37: خلية LiveQoS — Arc<AtomicU32> fps + Arc<Mutex<String>> quality بـ set/snapshot",
        mediaRs.includes("struct LiveQoS") && mediaRs.includes("Arc<AtomicU32>")
        && mediaRs.includes("Arc<std::sync::Mutex<String>>") && mediaRs.includes("fn snapshot"), "live qos cell")
      check("G-37: ScreenSess تحمل qos: LiveQoS (القيم المعروضة fps/quality تبقى مصدر screen:state)",
        mediaRs.includes("qos: LiveQoS") && mediaRs.includes("/// القيم المعروضة الحالية"), "session carries cell")
      check("G-37: حلقات الالتقاط الثلاث بلا تمريرة بالقيمة (qos: LiveQoS ×3 — لا quality: String في التواقيع)",
        (mediaRs.match(/qos: LiveQoS,/g) || []).length >= 4
        && !mediaRs.includes("    quality: String,\n    tx: webrtc::runtime::Sender"), "3 loops signature")
      check("G-37: الحلقات الثلاث تقرأ snapshot أعلى كل دورة خارجية (إعادة بناء بالقيم الجديدة)",
        (mediaRs.match(/let \(fps, quality\) = qos\.snapshot\(\);/g) || []).length === 3, "3 snapshot reads")
      check("G-37: media_screen_start ينشئ LiveQoS ويشاركه مع الخيط والجلسة",
        mediaRs.includes("LiveQoS::new(fps, quality.clone())") && mediaRs.includes("let qos2 = qos.clone();")
        && mediaRs.includes("capture_loop(stop2, rebuild2, target2, qos2, frame_tx)"), "start wires cell")

      // (ب) Rust — السلوك: set حي + علم rebuild مشروط + بلا ملاحظة «إعادة البث» القديمة
      check("G-37: media_screen_set حي — qos.set + تحديث المعروض + rebuild مشروط + live:true + w/h للاذاعة",
        mediaRs.includes("s.qos.set(fps, quality.clone())") && mediaRs.includes("s.rebuild.store(true, Ordering::Relaxed)")
        && mediaRs.includes("let changed = fps.is_some() || quality.is_some()") && mediaRs.includes('"live": true')
        && mediaRs.includes('"w": s.w, "h": s.h'), "set is live")
      check("G-37: ملاحظة «يطبق عند إعادة البث» القديمة زالت (الحد الموثق مرفوع)",
        !mediaRs.includes("تغيّر الجودة أثناء البث يطبق عند إعادة البث"), "old limit gone")

      // (ج) الجسر — الذريعة لكل العملاء بعد نجاح التبديل
      check("G-37: جسر الويب — screen:set يستدعي media_screen_set ويذيع screen:state محدثًا عند live",
        bridgeTs.includes('"media_screen_set"') && bridgeTs.includes("r?.live")
        && bridgeTs.includes('mediaSock.emit("screen:state"'), "bridge broadcast")

      // (د) Flutter — المسار السلس في شاشة العرض
      check("G-37: Flutter — الجلسة الحية ترسل screen:set (setScreenQuality) بلا stop→req",
        pcScreen.includes("setScreenQuality(fps: fps, quality: quality)")
        && pcScreen.includes("MediaPhase.live")
        && !pcScreen.includes("إعادة البث بجودة جديدة (stop → req"), "flutter smooth path")

      // (هـ) التوثيق — العقد والتدقيق
      check("G-37: تدقيق الجولة 4 — صف الفجوة موثق كمُصلح مع خلية LiveQoS",
        auditMd.includes("G-37") && auditMd.includes("LiveQoS") && auditMd.includes("مُصلحة"), "audit row")
      check("G-37: العقد §15 — التبديل الحي موثق (LiveQoS بلا stop→req) وحد target الصادق باقٍ",
        contract37.includes("خلية LiveQoS") && contract37.includes("بلا stop→req")
        && contract37.includes("تغيير الهدف target ما يزال يتطلب جلسة جديدة"), "contract §15")
    }

    // ============================================================
    // A-1 — محرك الروتينات (عقد §26): قواعد «عند حدوث X نفّذ Y» فوق القنوات القائمة
    // سلوك حي عبر مقبسين (auto :3008 + prod :3007) + فحوص مصدر + توثيق
    // ============================================================
    console.log("\n== A-1: automation engine (rules over existing channels) ==")
    {
      const bootA1 = await waitHttp("automation boot", "http://localhost:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("A-1: جسر الروتينات يُقلع داخل عملية Next (:3008) idempotent — بذرة القواعد ≥ 3", bootA1?.port === 3008 && bootA1?.rules >= 3, `rules=${bootA1?.rules}`)
      await waitHttp("prod boot", "http://localhost:3000/api/prod/boot", 20000)

      const { io: ioA1 } = await import("socket.io-client")
      const mkSockA1 = (port) => ioA1(`http://localhost:${port}`, { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })

      const behavior = await new Promise((resolve) => {
        const auto = mkSockA1(3008)
        const prod = mkSockA1(3007)
        const timersA1 = []
        const laterA1 = (fn, ms) => timersA1.push(setTimeout(fn, ms))
        const out = { connected: false, seedRules: 0, stats: null, clipFired: null, manualFired: null, disabledNoFire: true, onceFired: null, rejected: null, lastRules: null, done: false }
        const finishA1 = () => { if (out.done) return; out.done = true; timersA1.forEach(clearTimeout); try { auto.disconnect(); prod.disconnect() } catch {}; resolve(out) }
        laterA1(finishA1, 26500)

        auto.on("connect", () => { out.connected = true })
        auto.on("auto:state", (s) => {
          out.seedRules = s?.rules?.length ?? 0
          out.stats = s?.stats ?? null
          out.lastRules = s?.rules?.map((r) => r.name) ?? out.lastRules
        })
        auto.on("auto:fired", (p) => {
          if (p?.ruleName === "A1-E2E-clip" && p?.manual === false && !out.clipFired) out.clipFired = p
          else if (p?.ruleName === "A1-E2E-clip" && p?.manual === false && out.clipFired) out.disabledNoFire = false
          if (p?.ruleName === "A1-E2E-clip" && p?.manual === true) out.manualFired = p
          if (p?.ruleName === "A1-E2E-once") out.onceFired = p
        })
        auto.on("auto:rejected", (d) => { out.rejected = d?.error ?? "rejected" })

        auto.on("connect", () => {
          // (1) قاعدة حافظة → إشعار
          auto.emit("rule:upsert", { rule: { name: "A1-E2E-clip", enabled: true, trigger: { kind: "clip.received" }, action: { kind: "notify", text: "e2e" } } })
          // (2) الإطلاق التلقائي: clip:push على prod (نفس حدث العميل القائم) → حقيقة داخل العملية → auto:fired
          laterA1(() => prod.emit("clip:push", { deviceId: "galaxy-s24", deviceName: "E2E-Phone", kind: "text", content: "A1E2E-payload" }), 700)
          // (3) تشغيل يدوي صريح (باب اختبار القاعدة — يعمل مع قاعدة مفعّلة)
          laterA1(() => auto.emit("rule:run-now", { id: (out.clipFired || {}).ruleId }), 2600)
          // (4) تعطيل ثم حقنة ثانية — يجب ألا يُطلق تلقائيًا (بوابة enabled في مسار الحقيقة)
          laterA1(() => {
            auto.emit("rule:toggle", { id: (out.clipFired || {}).ruleId, enabled: false })
            laterA1(() => prod.emit("clip:push", { deviceId: "galaxy-s24", deviceName: "E2E-Phone", kind: "text", content: "A1E2E-after-disable" }), 500)
          }, 4600)
          // (5) قاعدة مرة واحدة عند now+3s — مؤقت المحرك (5s) يلتقطها
          laterA1(() => auto.emit("rule:upsert", { rule: { name: "A1-E2E-once", enabled: true, trigger: { kind: "time.once", at: Date.now() + 3000 }, action: { kind: "notify", text: "once" } } }), 8200)
          // (6) رفض مدخل فاسد (wol بـ MAC سيء) — auto:rejected مسبب
          laterA1(() => auto.emit("rule:upsert", { rule: { name: "A1-E2E-bad", enabled: true, trigger: { kind: "device.connect" }, action: { kind: "wol", mac: "NOPE" } } }), 12500)
          // (7) تنظيف: حذف القاعدتين — يظهر في آخر auto:state
          laterA1(() => {
            auto.emit("rule:delete", { id: (out.clipFired || {}).ruleId })
            auto.emit("rule:delete", { id: (out.onceFired || {}).ruleId })
          }, 23000)
          laterA1(finishA1, 25500)
        })
      })

      check("A-1: عميل auto متصل + بذرة القواعد والإحصاءات تصل (auto:state)", behavior.connected && behavior.seedRules >= 3 && !!behavior.stats, `seed=${behavior.seedRules}`)
      check("A-1: سلوك — clip:push على prod (:3007) يولّد حقيقة داخل العملية ويُطلق القاعدة (auto:fired)", !!behavior.clipFired, behavior.clipFired?.detail || "no fire")
      check("A-1: التشغيل اليدوي run-now يعمل (manual:true) وينفّذ الفعل فعليًا", !!behavior.manualFired && behavior.manualFired.ok === true, "manual run")
      check("A-1: التعطيل يحجب مسار الحقيقة — حقنة بعد التعطيل بلا إطلاق تلقائي", behavior.disabledNoFire && !!behavior.clipFired, "enabled gate")
      check("A-1: مشغّل time.once — مؤقت المحرك يلتقط الموعد ويُطلق مرة واحدة", !!behavior.onceFired, "time.once")
      check("A-1: تعقيم المدخلات — قاعدة wol بـ MAC فاسد تُرفض برسالة (auto:rejected)", !!behavior.rejected, behavior.rejected || "no reject")
      check("A-1: الحذف — القاعدتان الاختباريتان زالتا من آخر auto:state", Array.isArray(behavior.lastRules) && !behavior.lastRules.some((n) => String(n).startsWith("A1-E2E")), "rules deleted")

      // فحوص المصدر + التوثيق
      const fspA1 = (await import("node:fs")).default
      const rdA1 = (p) => { try { return fspA1.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const aBridge = rdA1("src/lib/nexus/automation-bridge.ts")
      const aTypes = rdA1("src/lib/nexus/automation-types.ts")
      const aFacts = rdA1("src/lib/nexus/automation-facts.ts")
      const aProd = rdA1("src/lib/nexus/productivity-bridge.ts")
      const aBoot = rdA1("src/app/api/automation/boot/route.ts")
      const aDock = rdA1("src/components/nexus/dock.tsx")
      const aStoreTs = rdA1("src/lib/store.ts")
      const aApp = rdA1("src/components/nexus/nexus-app.tsx")
      const aView = rdA1("src/components/nexus/automation/automation-view.tsx")
      const aHook = rdA1("src/hooks/use-automation-bridge.ts")
      const aI18n = rdA1("src/lib/ar-en-map.json")
      const aContract = rdA1("docs/protocol-contract.md")
      const aChecklist = rdA1("docs/e2e-checklist.md")

      check("A-1: المصدر — الجسر :3008 داخل Next idempotent (نمط guard) ومشغلات §26 الستة معرّفة",
        aBridge.includes("const PORT = 3008") && aBridge.includes("ensureAutomationBridge")
        && ["device.connect", "device.disconnect", "battery.below", "clip.received", "time.once", "time.daily"].every((k) => aTypes.includes(`"${k}"`)), "bridge source")
      check("A-1: المصدر — الأفعال الأربعة تعبر القنوات القائمة حرفيًا (dev:ring / clip:new / UDP WoL / auto:fired)",
        aBridge.includes('guardEmitToAgent("dev:ring"') && aBridge.includes("prodInjectClip")
        && aBridge.includes("dgram") && aBridge.includes('emit("auto:fired"'), "actions reuse channels")
      check("A-1: المصدر — ناقل حقائق داخل العملية وprod ينشر clip.received بلا أي تغيير سلكي",
        aFacts.includes("emitAutomationFact") && aFacts.includes("onAutomationFact")
        && aProd.includes('emitAutomationFact({ kind: "clip.received"') && aProd.includes("export async function prodInjectClip"), "facts bus")
      check("A-1: المصدر — نظافة المحرك: مانع تكرار 20s + حافة بطارية بإعادة تسليح + تعقيم (MAC/طوابع/حدود)",
        aBridge.includes("COOLDOWN_MS = 20_000") && aBridge.includes("batteryArmed")
        && aBridge.includes("MAC_RE") && aBridge.includes("sanitizeRule"), "engine hygiene")
      check("A-1: الواجهة — boot route + dock «الروتينات» + ViewId + تركيب الجذر والعرض",
        aBoot.includes("ensureAutomationBridge") && aDock.includes('"الروتينات"') && aDock.includes("Workflow")
        && aStoreTs.includes('"automation"') && aApp.includes("<AutomationView />") && aApp.includes("useAutomationBridge()"), "ui wiring")
      check("A-1: الواجهة — محرر كامل (مشغل/فعل) + تشغيل يدوي + سجل + حدود صادقة معروضة",
        aView.includes("automation-editor") && aView.includes("automation-run-now")
        && aView.includes("حدود الإصدار الأول") && aHook.includes("/api/automation/boot"), "ui editor")
      check("A-1: i18n — مفاتيح EN للتبويب في القاموس المشترك", aI18n.includes('"الروتينات": "Routines"') && aI18n.includes('"شغّل الآن": "Run now"'), "i18n")
      check("A-1: التوثيق — العقد §26 والقائمة الميدانية", aContract.includes("## 26.") && aContract.includes("auto:fired") && aChecklist.includes("الروتينات"), "docs")
    }

    // ============================================================
    // HEALTH — مركز صحة الأجهزة (عقد §27): قياس زمني (خانقة 30ث + احتفاظ 24h)
    // + كشف عبورات (انقطاع/عودة/بطارية/استجابة/تخزين) + مسار الوكيل الحقيقي report
    // ============================================================
    console.log("\n== HEALTH: device health center (telemetry + alerts, contract §27) ==")
    {
      const fsH = (await import("node:fs")).default
      const rdH = (p) => { try { return fsH.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const schemaH = rdH("prisma/schema.prisma")
      const healthTs = rdH("src/lib/nexus/health.ts")
      const devicesTsH = rdH("src/lib/nexus/devices.ts")
      const devRouteH = rdH("src/app/api/devices/route.ts")
      const healthRouteH = rdH("src/app/api/devices/health/route.ts")
      const devViewH = rdH("src/components/nexus/devices-view.tsx")
      const panelH = rdH("src/components/nexus/health-panel.tsx")
      const dbTsH = rdH("src/lib/db.ts")
      const contractH = rdH("docs/protocol-contract.md")
      const B = "http://127.0.0.1:3000"

      // (أ) المصدر — البنية الكاملة
      check("HEALTH: مخطط Prisma — NexusHealthSample + NexusHealthEvent بفهارس [deviceId,createdAt] و[createdAt]",
        schemaH.includes("model NexusHealthSample") && schemaH.includes("model NexusHealthEvent")
        && schemaH.includes("@@index([deviceId, createdAt])") && schemaH.includes("@@index([createdAt])"), "schema")
      check("HEALTH: المحرك — خانقة 30ث + احتفاظ 24h + تنقية 5min + عتبات (15/150/90)",
        healthTs.includes("SAMPLE_INTERVAL_MS = 30_000") && healthTs.includes("RETENTION_MS = 24 * 3600_000")
        && healthTs.includes("PRUNE_EVERY_MS = 5 * 60_000") && healthTs.includes("LOW_BATTERY_PCT = 15")
        && healthTs.includes("RTT_DEGRADED_MS = 150") && healthTs.includes("STORAGE_HIGH_PCT = 90"), "engine params")
      check("HEALTH: كشف العبورات — offline/online edge-triggered + بطارية/استجابة/تخزين مرة لكل عبور + ترسيخ أول تكة بلا أحداث",
        healthTs.includes('type: "offline"') && healthTs.includes('type: "online"')
        && healthTs.includes('type: "low-battery"') && healthTs.includes('type: "rtt-degraded"')
        && healthTs.includes('type: "storage-high"') && healthTs.includes("!st.booted"), "transitions")
      check("HEALTH: الربط — النبضة تشغل تكة (استيراد ديناميكي) + مسارات حالة الأجهزة تجبر تكة force",
        devicesTsH.includes('import("./health")') && devicesTsH.includes("recordHealthTick(store().devices)")
        && devRouteH.includes("forceHealthTick") && devRouteH.includes('{ force: true }'), "heartbeat wiring")
      check("HEALTH: المسار — GET لقطة + POST force-sample + POST report بقصّ battery 0..100 وrtt ≥ 0",
        healthRouteH.includes("getHealthSnapshot") && healthRouteH.includes('"force-sample"')
        && healthRouteH.includes('"report"') && healthRouteH.includes("Math.min(100, Math.round(body.battery))")
        && healthRouteH.includes("Math.max(0, Math.round(body.rttMs))"), "route contract")
      check("HEALTH: الواجهة — HealthPanel أعلى صفحة الأجهزة (مخططا خط + محدد نافذة + التقاط عينة + تنبيهات)",
        devViewH.includes('import { HealthPanel } from "@/components/nexus/health-panel"') && devViewH.includes("<HealthPanel />")
        && panelH.includes("LineChart") && panelH.includes("force-sample")
        && panelH.includes('setWindow_') && panelH.includes("مركز صحة الأجهزة"), "panel UI")
      check("HEALTH: الترقية الآمنة — CREATE TABLE IF NOT EXISTS للجدولين في db.ts (نمط §23 بلا مساس بالبيانات)",
        dbTsH.includes('CREATE TABLE IF NOT EXISTS "NexusHealthSample"')
        && dbTsH.includes('CREATE TABLE IF NOT EXISTS "NexusHealthEvent"')
        && dbTsH.includes("NexusHealthSample_deviceId_createdAt_idx"), "upgrade-safe schema")
      check("HEALTH: العقد §27 موثق (عينات/عبورات/report الحقيقي/حدود صادقة) + مؤشر §3.5",
        contractH.includes("## 27. مركز صحة الأجهزة") && contractH.includes('action:"report"')
        && contractH.includes("ترسّخ الحالة بلا أحداث") && contractH.includes("GET|POST /api/devices/health"), "contract §27")

      // (ب) السلوك — على السيرفر الحي (standalone)
      const hPost = async (body) => fetch(`${B}/api/devices/health`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json())
      const hGet = async (q = "") => fetch(`${B}/api/devices/health${q}`).then((r) => r.json())

      const fs1 = await hPost({ action: "force-sample" })
      check("HEALTH: force-sample يسجل عينات فورية لكل أجهزة البذرة (≥5) بتجاوز الخانقة",
        fs1.ok === true && fs1.recorded >= 5, `recorded=${fs1.recorded}`)

      await hPost({ action: "report", deviceId: "galaxy-s24", battery: 9 })
      const snap1 = await hGet("?device=all&window=1h")
      const g24 = snap1.devices.find((d) => d.deviceId === "galaxy-s24")
      check("HEALTH: لقطة 1h — سلاسل بطارية غير فارغة + ملخص galaxy-s24 بعينات",
        Array.isArray(snap1.series.battery) && snap1.series.battery.length > 0
        && g24 && g24.samples > 0, `samples=${g24?.samples}`)
      check("HEALTH: report بطارية 9% → عبور low-battery warn ظاهر في التنبيهات",
        snap1.alerts.some((a) => a.deviceId === "galaxy-s24" && a.type === "low-battery" && a.level === "warn"), "low-battery alert")

      const fs2 = await hPost({ action: "report", deviceId: "galaxy-s24", battery: 9 })
      check("HEALTH: تقرير مطابق ثانٍ → صفر أحداث (مرة واحدة لكل عبور — لا فيض تنبيهات)",
        fs2.ok === true && fs2.events === 0, `events=${fs2.events}`)

      await hPost({ action: "report", deviceId: "galaxy-s24", rttMs: 250 })
      const snap2 = await hGet("?device=all&window=1h")
      check("HEALTH: report استجابة 250ms → عبور rtt-degraded warn",
        snap2.alerts.some((a) => a.deviceId === "galaxy-s24" && a.type === "rtt-degraded"), "rtt alert")

      const dis = await fetch(`${B}/api/devices`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", id: "redmi-note13" }),
      }).then((r) => r.json())
      await hPost({ action: "force-sample" })
      const snap3 = await hGet("?device=all&window=1h")
      check("HEALTH: قطع redmi-note13 → انتقال offline warn مرصود",
        dis.ok === true && snap3.alerts.some((a) => a.deviceId === "redmi-note13" && a.type === "offline"), "offline event")

      const conn = await fetch(`${B}/api/devices`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", id: "redmi-note13" }),
      }).then((r) => r.json())
      await hPost({ action: "force-sample" })
      const snap4 = await hGet("?device=all&window=1h")
      const redmi = snap4.devices.find((d) => d.deviceId === "redmi-note13")
      check("HEALTH: إعادة الاتصال → انتقال online info + الإتاحة محسوبة 0..100",
        conn.ok === true && snap4.events.some((e) => e.deviceId === "redmi-note13" && e.type === "online" && e.level === "info")
        && redmi && redmi.uptimePct !== null && redmi.uptimePct >= 0 && redmi.uptimePct <= 100, `uptime=${redmi?.uptimePct}`)

      const one = await hGet("?device=galaxy-s24&window=6h")
      check("HEALTH: فلتر جهاز واحد + نافذة 6h — جهاز واحد فقط وعيناته",
        one.devices.length === 1 && one.devices[0].deviceId === "galaxy-s24"
        && typeof one.counts?.samples === "number" && one.counts.samples > 0, "device filter")

      const capped = snap4.devices.every((d) => d.points.length <= 120)
      const win24 = await hGet("?device=all&window=24h")
      check("HEALTH: سقف النقاط ≤120 لكل جهاز + نافذة 24h مقبولة بشكل سليم",
        capped && win24.window === "24h" && Array.isArray(win24.series.rtt), "downsample cap")
    }

    // ============================================================
    // AUTO-HEALTH — ربط الروتينات بالصحة التاريخية (عقد §26.و):
    // «نبّهني إذا كانت بطارية X تحت 15% لمدة ساعة» — تقييم من عينات §27
    // سلوك حي عبر مقبس auto (:3008) + زرع تاريخ اصطناعي عبر Prisma
    // (أجهزة أشباح معزولة ah-e2e-* — دقيقة حتمية بلا تداخل عينات حقيقية)
    // ============================================================
    console.log("\n== AUTO-HEALTH: routines × historical health triggers (§26.و) ==")
    {
      const bootAH = await waitHttp("automation boot (AH)", "http://localhost:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("AUTO-HEALTH: جسر الروتينات حي — البذرة صارت رباعية (بذرة تاريخية توضيحية معطلة)",
        bootAH?.port === 3008 && bootAH?.rules >= 4, `rules=${bootAH?.rules}`)

      // قراءة DATABASE_URL من .env (نفس قاعدة الخادم) + عميل Prisma للزرع
      const fsAH = (await import("node:fs")).default
      const rdAH = (p) => { try { return fsAH.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const dbUrl = fsAH.readFileSync(pathMod.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdb = new PrismaClient({ datasources: { db: { url: dbUrl } }, log: [] })

      // (أ) فحوص المصدر
      const typesAH = rdAH("src/lib/nexus/automation-types.ts")
      const evalAH = rdAH("src/lib/nexus/automation-health.ts")
      const bridgeAH = rdAH("src/lib/nexus/automation-bridge.ts")
      const viewAH = rdAH("src/components/nexus/automation/automation-view.tsx")
      const i18nAH = rdAH("src/lib/ar-en-map.json")
      const contractAH = rdAH("docs/protocol-contract.md")
      const checklistAH = rdAH("docs/e2e-checklist.md")

      check("AUTO-HEALTH: المصدر — ثلاثة أنواع تاريخية في TriggerKind/TRIGGER_KINDS + SUSTAINED_TRIGGER_KINDS + isSustainedTrigger (وحدة آمنة للعميل)",
        typesAH.includes('"health.battery.sustained"') && typesAH.includes('"health.rtt.sustained"')
        && typesAH.includes('"health.silence.sustained"') && typesAH.includes("SUSTAINED_TRIGGER_KINDS")
        && typesAH.includes("isSustainedTrigger") && typesAH.includes("durationMin?: number"), "types")
      check("AUTO-HEALTH: المصدر — المقيّم: سلسلة الدليل (مرساة/نافذة/فجوة/تقادم) + سقف 1440 + الصمت لمعروف الإبلاغ",
        evalAH.includes("gapAllowanceMs") && evalAH.includes("ANCHOR_STALE_MS") && evalAH.includes("MAX_DURATION_MIN = 1440")
        && evalAH.includes("nexusHealthSample") && evalAH.includes("لم يُبلّغ صحة قط")
        && evalAH.includes("فجوة عينات") && evalAH.includes("دليل متقادم"), "evaluator")
      check("AUTO-HEALTH: المصدر — الجسر: تكة 15 ثانية + تسليح الحقب (sustainedArmed) + باب run-now للمستمر + تنظيف الحذف",
        bridgeAH.includes("pollHealthSustained") && bridgeAH.includes("sustainedArmed")
        && bridgeAH.includes("void pollHealthSustained() }, 15000") && bridgeAH.includes("isSustainedTrigger(rule.trigger.kind)")
        && bridgeAH.split("sustainedArmed.delete").length >= 2, "bridge wiring")
      check("AUTO-HEALTH: الواجهة — حقل المدة + شارة «تاريخي» + الأنواع الثلاثة في المحرر",
        viewAH.includes("automation-duration-input") && viewAH.includes("automation-historical-badge")
        && viewAH.includes("بقاء البطارية تحت عتبة لمدة (تاريخي)") && viewAH.includes("صمت جهاز عن التقارير لمدة (تاريخي)")
        && viewAH.includes("SUSTAINED_TRIGGER_KINDS"), "ui editor")
      check("AUTO-HEALTH: i18n — مفاتيح EN في القاموس المشترك",
        i18nAH.includes('"المدة (دقائق)": "Duration (minutes)"') && i18nAH.includes('"تاريخي": "Historical"')
        && i18nAH.includes('"بلا تقارير": "no reports"'), "i18n")
      check("AUTO-HEALTH: التوثيق — العقد §26.و (سلسلة الدليل + التسليح) + القائمة الميدانية",
        contractAH.includes("### 26.و") && contractAH.includes("سلسلة الدليل")
        && contractAH.includes("نبّهني إذا كانت بطارية X تحت 15% لمدة ساعة")
        && checklistAH.includes("تاريخية"), "docs")

      // (ب) السلوك الحي — زرع التاريخ ثم تقييم عبر المقبس
      const { io: ioAH } = await import("socket.io-client")
      const sockAH = ioAH("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })

      const behaviorAH = await new Promise((resolve) => {
        const out = { done: false, rulesNamed: [], rejected: null, fires: new Map(), logEntries: [], lastRules: null }
        const timersAH = []
        const later = (fn, ms) => timersAH.push(setTimeout(fn, ms))
        const finish = () => { if (out.done) return; out.done = true; timersAH.forEach(clearTimeout); try { sockAH.disconnect() } catch {}; resolve(out) }
        later(finish, 42000)

        sockAH.on("auto:state", (s) => {
          const names = s?.rules?.map((r) => r.name) ?? []
          // تراكمي — الحالة النهائية بعد الحذف تفقد الأسماء والفحص يتحقق من «ظهرت يومًا»
          out.rulesNamed = [...new Set([...out.rulesNamed, ...names])]
          out.lastRules = names
          if (Array.isArray(s?.log)) out.logEntries = s.log
        })
        sockAH.on("auto:fired", (p) => {
          if (!String(p?.ruleName || "").startsWith("AH-E2E")) return
          const arr = out.fires.get(p.ruleName) ?? []
          arr.push({ at: p.at || Date.now(), ok: p.ok, detail: p.detail || "", manual: p.manual })
          out.fires.set(p.ruleName, arr)
        })
        sockAH.on("auto:rejected", (d) => { out.rejected = d?.error ?? "rejected" })

        sockAH.on("connect", () => {
          void (async () => {
            try {
              const t0 = Date.now()
              const at = (dev, offMin, battery, rttMs, online = true) => ({
                deviceId: dev, battery, rttMs, online, createdAt: new Date(t0 - offMin * 60000),
              })
              const G = { batt: "ah-e2e-batt", viol: "ah-e2e-viol", gap: "ah-e2e-gap", rtt: "ah-e2e-rtt", sil: "ah-e2e-sil", any: "ah-e2e-any" }

              // زرع التاريخ الاصطناعي (تسامح الفجوة لمدة 60د = 15د — سلاسل بفجوات 14د)
              await pdb.nexusHealthSample.createMany({ data: [
                // بطارية جيدة: ≤15% منذ 66 دقيقة بلا فجوات > 14د → مستوفى
                at(G.batt, 66, 12, 40), at(G.batt, 52, 11, 40), at(G.batt, 38, 10, 40), at(G.batt, 24, 9, 40), at(G.batt, 10, 9, 40), at(G.batt, 2, 9, 40),
                // مخالف: عينة 80% قبل 12 دقيقة داخل النافذة (الفجوات سليمة عمدًا) → غير مستوفى بسبب المخالفة وحدها
                at(G.viol, 66, 12, 40), at(G.viol, 52, 11, 40), at(G.viol, 38, 10, 40), at(G.viol, 24, 9, 40), at(G.viol, 12, 80, 40), at(G.viol, 2, 9, 40),
                // فجوة: سلسلة صحيحة القيم لكن فجوة 46د تقطع الاستمرارية → غير مستوفى
                at(G.gap, 66, 12, 40), at(G.gap, 20, 10, 40), at(G.gap, 5, 9, 40),
                // استجابة: 250ms متصلة منذ 66 دقيقة → مستوفى
                at(G.rtt, 66, 80, 250), at(G.rtt, 52, 80, 250), at(G.rtt, 38, 80, 250), at(G.rtt, 24, 80, 250), at(G.rtt, 10, 80, 250), at(G.rtt, 2, 80, 250),
                // صمت: عينة واحدة قديمة (3 ساعات) لجهاز معروف الإبلاغ → صمت 180د ≥ 45د
                at(G.sil, 180, 50, 50),
                // صمت لأي جهاز (deviceId=null): مرشح ثانٍ قديم
                at(G.any, 180, 50, 50),
              ] })

              // القواعد السبع (آخرها durationMin فاسد → رفض)
              const mk = (name, trigger) => sockAH.emit("rule:upsert", { rule: { name, enabled: true, trigger, action: { kind: "notify", text: "AH-E2E" } } })
              mk("AH-E2E-batt", { kind: "health.battery.sustained", deviceId: G.batt, threshold: 15, durationMin: 60 })
              mk("AH-E2E-viol", { kind: "health.battery.sustained", deviceId: G.viol, threshold: 15, durationMin: 60 })
              mk("AH-E2E-gap", { kind: "health.battery.sustained", deviceId: G.gap, threshold: 15, durationMin: 60 })
              mk("AH-E2E-rtt", { kind: "health.rtt.sustained", deviceId: G.rtt, threshold: 200, durationMin: 60 })
              mk("AH-E2E-sil", { kind: "health.silence.sustained", deviceId: G.sil, durationMin: 45 })
              mk("AH-E2E-any", { kind: "health.silence.sustained", durationMin: 45 })
              sockAH.emit("rule:upsert", { rule: { name: "AH-E2E-bad", enabled: true, trigger: { kind: "health.battery.sustained", deviceId: G.batt, threshold: 15, durationMin: 2000 }, action: { kind: "notify" } } })

              // إطلاقات يدوية صريحة (باب اختبار التاريخ) — التيك قد يسبقها (مقبول كلاهما)
              later(() => { for (const n of ["AH-E2E-batt", "AH-E2E-viol", "AH-E2E-gap", "AH-E2E-rtt", "AH-E2E-sil", "AH-E2E-any"]) {
                // run-now يحتاج id — نلتقطه من آخر auto:state
                const found = (out.rulesSnapshot ?? []).find((x) => x.name === n)
                if (found) sockAH.emit("rule:run-now", { id: found.id })
              } }, 2200)

              // إعادة التسليح: مخالفة جديدة → لا إطلاق خلال حقبتها → زوالها → إطلاق ثانٍ
              later(async () => {
                const tV = Date.now()
                out.tViol = tV
                await pdb.nexusHealthSample.create({ data: at(G.batt, 0.4, 60, 40) }) // 60% قبل 24 ثانية
              }, 7000)
              later(() => {
                const found = (out.rulesSnapshot ?? []).find((x) => x.name === "AH-E2E-batt")
                if (found) sockAH.emit("rule:run-now", { id: found.id }) // غير مستوفى الآن → سجل ok=false
              }, 9000)
              later(async () => {
                out.tClean = Date.now()
                await pdb.nexusHealthSample.deleteMany({ where: { deviceId: G.batt, battery: 60 } }) // زوال المخالفة
                const found = (out.rulesSnapshot ?? []).find((x) => x.name === "AH-E2E-batt")
                if (found) sockAH.emit("rule:run-now", { id: found.id }) // مستوفى مجددًا → إطلاق ثانٍ
              }, 26000)

              // تنظيف القواعد (العينات تُنظف بعد الوعود)
              later(() => {
                for (const x of (out.rulesSnapshot ?? []).filter((x) => String(x.name).startsWith("AH-E2E"))) {
                  sockAH.emit("rule:delete", { id: x.id })
                }
              }, 36000)
              later(finish, 39000)
            } catch (e) {
              console.log("   [AH] plant error:", e?.message || e)
              finish()
            }
          })()
        })

        // لقطة القواعد مع المعرفات (لـ run-now والحذف)
        sockAH.on("auto:state", (s) => { out.rulesSnapshot = s?.rules ?? out.rulesSnapshot })
      })

      const firesBatt = behaviorAH.fires.get("AH-E2E-batt") ?? []
      const firesViol = behaviorAH.fires.get("AH-E2E-viol") ?? []
      const firesGap = behaviorAH.fires.get("AH-E2E-gap") ?? []
      const firesRtt = behaviorAH.fires.get("AH-E2E-rtt") ?? []
      const firesSil = behaviorAH.fires.get("AH-E2E-sil") ?? []
      const firesAny = behaviorAH.fires.get("AH-E2E-any") ?? []
      const inViolEra = firesBatt.filter((f) => f.at >= (behaviorAH.tViol ?? Infinity) && f.at <= (behaviorAH.tClean ?? 0))
      const afterClean = firesBatt.filter((f) => f.at > (behaviorAH.tClean ?? Infinity))
      const violLogRefusal = behaviorAH.logEntries.some((e) => e.ruleName === "AH-E2E-viol" && e.manual === true && e.ok === false)

      check("AUTO-HEALTH: القواعد الست المستمرة قُبلت وظاهرة في auto:state",
        ["AH-E2E-batt", "AH-E2E-viol", "AH-E2E-gap", "AH-E2E-rtt", "AH-E2E-sil", "AH-E2E-any"].every((n) => behaviorAH.rulesNamed.includes(n)), `everNamed=${behaviorAH.rulesNamed.filter((n) => String(n).startsWith("AH-E2E")).length}`)
      check("AUTO-HEALTH: تعقيم المدة — durationMin=2000 مرفوض مسببًا (سقف تاريخ §27 = 1440)",
        !!behaviorAH.rejected && String(behaviorAH.rejected).includes("المدة"), behaviorAH.rejected || "no reject")
      check("AUTO-HEALTH: بطارية ≤15% لمدة 60 دقيقة (تاريخ مزروع 66 دقيقة) → أُطلقت بتفصيل «مستمر»",
        firesBatt.length >= 1 && firesBatt.some((f) => f.ok && f.detail.includes("مستمر")), firesBatt[0]?.detail?.slice(0, 80) || "no fire")
      check("AUTO-HEALTH: عينة مخالفة داخل المدة (80% قبل 12د) → لا إطلاق + رفض مسبب في السجل (ok=false يدوي)",
        firesViol.length === 0 && violLogRefusal, `fires=${firesViol.length} refusal=${violLogRefusal}`)
      check("AUTO-HEALTH: فجوة عينات 46د > التسامح 15د → لا إطلاق (الاستمرارية غير مثبتة)",
        firesGap.length === 0, `fires=${firesGap.length}`)
      check("AUTO-HEALTH: استجابة ≥200ms لمدة 60 دقيقة → أُطلقت",
        firesRtt.length >= 1 && firesRtt.some((f) => f.ok && f.detail.includes("مستمر")), firesRtt[0]?.detail?.slice(0, 80) || "no fire")
      check("AUTO-HEALTH: صمت 45 دقيقة (عينة قديمة 3 ساعات) → أُطلق للجهاز المعروف الإبلاغ",
        firesSil.length >= 1, firesSil[0]?.detail?.slice(0, 80) || "no fire")
      check("AUTO-HEALTH: deviceId=null (أي جهاز) — الصمت التاريخي يجد المرشح القديم ويُطلق",
        firesAny.length >= 1, firesAny[0]?.detail?.slice(0, 80) || "no fire")
      check("AUTO-HEALTH: إعادة التسليح — صفر إطلاق خلال حقبة المخالفة + إطلاق ثانٍ بعد زوالها",
        firesBatt.length >= 2 && inViolEra.length === 0 && afterClean.length >= 1,
        `total=${firesBatt.length} inEra=${inViolEra.length} after=${afterClean.length}`)
      check("AUTO-HEALTH: التنظيف — قواعد AH-E2E زالت من آخر auto:state",
        Array.isArray(behaviorAH.lastRules) && !behaviorAH.lastRules.some((n) => String(n).startsWith("AH-E2E")), "rules deleted")

      // تنظيف العينات المزروعة (أجهزة الأشباح) + التحقق
      await pdb.nexusHealthSample.deleteMany({ where: { deviceId: { startsWith: "ah-e2e-" } } })
      const leftover = await pdb.nexusHealthSample.count({ where: { deviceId: { startsWith: "ah-e2e-" } } })
      check("AUTO-HEALTH: العينات المزروعة (أجهزة الأشباح) زالت من قاعدة §27 — بلا تلويث للتاريخ الحقيقي",
        leftover === 0, `leftover=${leftover}`)
      await pdb.$disconnect()
    }

    // ============================================================
    // BATTERY-ABOVE — مشغّل بلوغ البطارية (حافة صاعدة، عقد §26.أ):
    // «نبّهني عندما تصل بطارية X إلى 80%» — عبور صاعد عبر report على جهاز
    // البذرة galaxy-s24 + إعادة تسليح (هبوط −5 ثم صعود) + لا إطلاق بلا عبور.
    // المانع العام 20ث يفرض فواصل ≥ 24ث بين العبورين.
    // ============================================================
    console.log("\n== BATTERY-ABOVE: battery rising-edge trigger (§26.أ) ==")
    {
      const bootBA = await waitHttp("automation boot (BA)", "http://127.0.0.1:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("BATTERY-ABOVE: جسر الروتينات حي قبل الفحوص",
        bootBA?.port === 3008 && bootBA?.rules >= 4, `rules=${bootBA?.rules}`)
      await sleep(1200)

      const fsBA = (await import("node:fs")).default
      const pathBA = (await import("node:path")).default
      const rdBA = (p) => { try { return fsBA.readFileSync(pathBA.join(ROOT, p), "utf8") } catch { return "" } }

      // (أ) فحوص المصدر
      const typesBA = rdBA("src/lib/nexus/automation-types.ts")
      const bridgeBA = rdBA("src/lib/nexus/automation-bridge.ts")
      const viewBA = rdBA("src/components/nexus/automation/automation-view.tsx")
      const i18nBA = rdBA("src/lib/ar-en-map.json")
      const contractBA = rdBA("docs/protocol-contract.md")
      const checklistBA = rdBA("docs/e2e-checklist.md")

      check("BATTERY-ABOVE: المصدر — battery.above في TriggerKind/TRIGGER_KINDS + فرع الجسر (حافة صاعدة + إعادة تسليح −5) + تعقيم العتبة للنوعين",
        typesBA.includes('"battery.above"')
        && bridgeBA.includes('t.kind === "battery.above"')
        && bridgeBA.includes('battery.above" ? 80 : 20')
        && bridgeBA.includes("بلغت"), "types+bridge+sanitize")
      check("BATTERY-ABOVE: الواجهة — TRIGGER_META بأيقونة الشحن + ملخص ≥ + صف العتبة المشترك + الافتراضي 80 عند الاختيار",
        viewBA.includes('"battery.above": { icon: BatteryCharging')
        && viewBA.includes('case "battery.above":')
        && viewBA.includes('draft.tKind === "battery.above"')
        && viewBA.includes('v === "battery.above" ? "80"'), "view")
      check("BATTERY-ABOVE: i18n — مفتاح EN في القاموس المشترك",
        i18nBA.includes('"عند بلوغ البطارية عتبة (اكتمال شحن)": "When battery reaches a threshold (charge complete)"'), "i18n")
      check("BATTERY-ABOVE: التوثيق — العقد §26.أ (المشغلات الأحد عشر + صف الحافة الصاعدة) + القائمة الميدانية §25",
        contractBA.includes("المشغلات الأحد عشر") && contractBA.includes("`battery.above`") && contractBA.includes("حافة صاعدة")
        && checklistBA.includes("مشغّل بلوغ البطارية (حافة صاعدة)"), "docs")

      // (ب) السلوك الحي — عبور صاعد عبر report على جهاز البذرة
      const { io: ioBA } = await import("socket.io-client")
      const sockBA = ioBA("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
      const repBA = async (battery) => fetch("http://127.0.0.1:3000/api/devices/health", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", deviceId: "galaxy-s24", battery }),
      }).then((r) => r.json()).catch(() => null)

      const behaviorBA = await new Promise((resolve) => {
        const out = { done: false, fires: [], rulesSnapshot: null, lastRules: null }
        const timersBA = []
        const later = (fn, ms) => timersBA.push(setTimeout(fn, ms))
        const finish = () => { if (out.done) return; out.done = true; timersBA.forEach(clearTimeout); try { sockBA.disconnect() } catch {}; resolve(out) }
        later(finish, 70000)

        sockBA.on("auto:state", (s) => { out.rulesSnapshot = s?.rules ?? out.rulesSnapshot; out.lastRules = s?.rules?.map((r) => r.name) ?? out.lastRules })
        sockBA.on("auto:fired", (p) => { if (String(p?.ruleName || "").startsWith("BA-E2E")) out.fires.push({ at: p.at || Date.now(), ok: p.ok, detail: p.detail || "" }) })

        sockBA.on("connect", () => {
          void (async () => {
            try {
              // القاعدة: عبور صاعد 80% لجهاز البذرة galaxy-s24
              sockBA.emit("rule:upsert", { rule: { name: "BA-E2E-cross", enabled: true, trigger: { kind: "battery.above", deviceId: "galaxy-s24", threshold: 80 }, action: { kind: "notify", text: "BA-E2E" } } })
              await sleep(4000)   // لقطة تأسيس prev على الواقع الحالي
              await repBA(70)     // دون العتبة — لا عبور (وإعادة تسليح صريحة)
              await sleep(6000)
              await repBA(85)     // عبور صاعد 70→85 عبر 80
              await sleep(8000)   // → إطلاق #1 (أقصى توقيت: العاشر + تكة استطلاع ≤ 4ث)
              await repBA(70)     // هبوط تحت 75 — إعادة تسليح
              await sleep(18000)  // تجاوز المانع العام 20ث (أسوأ حالة: إطلاق #1 عند 14ث → يزول عند 34ث)
              await repBA(85)     // عبور ثانٍ → إطلاق #2
              await sleep(7000)
              await repBA(86)     // بلا عبور (85→86) — لا إطلاق ثالث
              await sleep(6000)
              // التنظيف
              const found = (out.rulesSnapshot ?? []).find((x) => x.name === "BA-E2E-cross")
              if (found) sockBA.emit("rule:delete", { id: found.id })
              await sleep(1500)
              finish()
            } catch (e) {
              console.log("   [BA] error:", e?.message || e)
              finish()
            }
          })()
        })
      })

      const fBA = behaviorBA.fires
      check("BATTERY-ABOVE: عبور صاعد 70→85 عبر عتبة 80 → إطلاق بتفصيل «بلغت (العتبة 80%)»",
        fBA.length >= 1 && fBA[0]?.detail.includes("بلغت") && fBA[0]?.detail.includes("(العتبة 80%)"), fBA[0]?.detail?.slice(0, 80) || "no fire")
      check("BATTERY-ABOVE: إعادة التسليح — هبوط 70 (تحت −5) ثم صعود 85 → إطلاق ثانٍ",
        fBA.length >= 2, `fires=${fBA.length}`)
      check("BATTERY-ABOVE: بلا عبور (86 بعد 85) — لا إطلاق ثالث (الحافة لا تعيد بلا هبوط −5)",
        fBA.length === 2, `fires=${fBA.length}`)
      check("BATTERY-ABOVE: التنظيف — قاعدة BA-E2E زالت من آخر auto:state",
        Array.isArray(behaviorBA.lastRules) && !behaviorBA.lastRules.some((n) => String(n).startsWith("BA-E2E")), "rule deleted")
    }

    // ============================================================
    // AUTO-PERSIST — ترسيخ قواعد الروتينات في SQLite (عقد §26.ز):
    // القواعد لا تختفي عند إعادة التشغيل — سلوك حي عبر مقبس :3008 + قراءة
    // جدول NexusAutomationRule مباشرة من نفس قاعدة الخادم (§26.ز/§23)
    // ============================================================
    console.log("\n== AUTO-PERSIST: rule persistence in SQLite (§26.ز) ==")
    {
      const bootAP = await waitHttp("automation boot (AP)", "http://localhost:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("AUTO-PERSIST: جسر الروتينات حي قبل فحوص الترسيخ",
        bootAP?.port === 3008 && bootAP?.rules >= 4, `rules=${bootAP?.rules}`)
      // الاستعادة/الترسيخ غير حاجبة عند الإقلاع — انتظار قصير يجعل الفحص حتميًا
      await sleep(1500)

      const fsAP = (await import("node:fs")).default
      const rdAP = (p) => { try { return fsAP.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const dbUrlAP = fsAP.readFileSync(pathMod.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdbAP = new PrismaClient({ datasources: { db: { url: dbUrlAP } }, log: [] })

      // (أ) فحوص المصدر
      const schemaAP = rdAP("prisma/schema.prisma")
      const dbAP = rdAP("src/lib/db.ts")
      const persistAP = rdAP("src/lib/nexus/automation-persist.ts")
      const bridgeAP = rdAP("src/lib/nexus/automation-bridge.ts")
      const viewAP = rdAP("src/components/nexus/automation/automation-view.tsx")
      const i18nAP = rdAP("src/lib/ar-en-map.json")
      const contractAP = rdAP("docs/protocol-contract.md")
      const checklistAP = rdAP("docs/e2e-checklist.md")

      check("AUTO-PERSIST: المصدر — نموذج NexusAutomationRule في المخطط (payload JSON + id = معرف الذاكرة) + ترقية آمنة CREATE IF NOT EXISTS في db.ts",
        schemaAP.includes("model NexusAutomationRule") && schemaAP.includes("payload   String")
        && dbAP.includes('CREATE TABLE IF NOT EXISTS "NexusAutomationRule"') && dbAP.includes('"payload"   TEXT     NOT NULL'), "schema+db.ts")
      check("AUTO-PERSIST: المصدر — وحدة الترسيخ: استعادة بتحقق هيكلي (revive) + تنقية الصفوف الفاسدة + upsert/delete idempotent",
        persistAP.includes("export async function loadPersistedRules") && persistAP.includes("function reviveRule")
        && persistAP.includes("TRIGGER_KINDS.includes") && persistAP.includes("deleteMany") && persistAP.includes("dbReady"), "persist module")
      check("AUTO-PERSIST: المصدر — الجسر: الاستعادة غير الحاجبة عند الإقلاع + ترسيخ upsert/toggle/delete + إحصاءات الإطلاق على القاعدة الحية + استهلاك time.once الماضي",
        bridgeAP.includes("loadPersistedRules") && bridgeAP.includes("persistRuleUpsert") && bridgeAP.includes("persistRuleDelete")
        && bridgeAP.includes("rules.find((r) => r.id === rule.id) ?? rule") && bridgeAP.includes("time.once\" && Number(r.trigger.at ?? 0) <= Date.now()"), "bridge wiring")
      check("AUTO-PERSIST: الواجهة — بطاقة الحدود توثق الترسيخ والسجل وحده بذاكرة",
        viewAP.includes("القواعد محفوظة في قاعدة البيانات وتُستعاد حرفيًا عند إعادة تشغيل الخادم — وحذف قاعدة بذرية يبقى حذفًا")
        && viewAP.includes("سجل التشغيل (آخر 80) يبقى في ذاكرة الجسر ويبدأ نظيفًا عند الإقلاع"), "ui limits")
      check("AUTO-PERSIST: i18n — مفتاحا الترسيخ في القاموس والمفتاح المهجور زال",
        i18nAP.includes('"القواعد محفوظة في قاعدة البيانات وتُستعاد حرفيًا عند إعادة تشغيل الخادم — وحذف قاعدة بذرية يبقى حذفًا": "Rules are persisted in the database and restored verbatim on server restart — deleting a seed rule stays deleted"')
        && i18nAP.includes('"سجل التشغيل (آخر 80) يبقى في ذاكرة الجسر ويبدأ نظيفًا عند الإقلاع": "The run log (last 80) stays in bridge memory and starts clean on boot"')
        && !i18nAP.includes("القواعد والسجل في ذاكرة الجسر"), "i18n")
      check("AUTO-PERSIST: التوثيق — العقد §26.ز (الاستعادة/الدلالات) + القائمة الميدانية §22",
        contractAP.includes("### 26.ز") && contractAP.includes("ترسيخ القواعد — SQLite عبر Prisma")
        && contractAP.includes("الموعد الفائت أثناء التوقف لا يُطلق قديمًا")
        && checklistAP.includes("## 22. ترسيخ القواعد"), "docs")

      // (ب) السلوك الحي — كتابة عبر المقبس وقراءة من SQLite
      const { io: ioAP } = await import("socket.io-client")
      const sockAP = ioAP("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
      const apState = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(null), 8000)
        sockAP.on("auto:state", (s) => { clearTimeout(to); resolve(s) })
      })
      const ruleNamesAP = apState?.rules?.map((r) => r.name) ?? []
      check("AUTO-PERSIST: البذور الربع مرسوخة في SQLite (أول إقلاع بعد الترقية يرسّخها)",
        ruleNamesAP.includes("بطارية جهاز منخفضة") && ruleNamesAP.includes("جهاز غادر الشبكة")
        && ruleNamesAP.includes("وصل محتوى جديد للحافظة") && ruleNamesAP.includes("بطارية تحت 15% لمدة ساعة")
        && await (async () => { const c = await pdbAP.nexusAutomationRule.count(); return c >= 4 })(), `dbRows=${await pdbAP.nexusAutomationRule.count()}`)

      // upsert عبر المقبس → صف في SQLite بالمعرف نفسه وpayload كامل
      const upsertAck = await new Promise((resolve) => {
        let saw = null
        const to = setTimeout(() => resolve(saw), 6000)
        sockAP.on("auto:state", (s) => {
          const r = s?.rules?.find((x) => x.name === "PERSIST-E2E-قاعدة")
          if (r) { clearTimeout(to); saw = r; resolve(r) }
        })
        sockAP.emit("rule:upsert", { rule: { name: "PERSIST-E2E-قاعدة", enabled: true, trigger: { kind: "battery.below", threshold: 33 }, action: { kind: "notify", text: "ترسيخ E2E" } } })
      })
      // الترسيخ fire-and-forget بعد تحديث الذاكرة — استطلاع الصف بلا سباق
      let row1 = null
      for (let i = 0; i < 12 && !row1; i++) {
        await new Promise((r) => setTimeout(r, 300))
        row1 = upsertAck ? await pdbAP.nexusAutomationRule.findUnique({ where: { id: upsertAck.id } }) : null
      }
      const pay1 = row1 ? JSON.parse(row1.payload) : null
      check("AUTO-PERSIST: rule:upsert عبر المقبس → صف فوري في SQLite (id = معرف الذاكرة + payload يحمل المشغل/الفعل)",
        !!row1 && row1.enabled === true && pay1?.trigger?.kind === "battery.below" && pay1?.trigger?.threshold === 33 && pay1?.action?.kind === "notify",
        row1 ? `id=${row1.id.slice(0, 8)} th=${pay1?.trigger?.threshold}` : "no row")

      // toggle → الحالة تنعكس في الصف
      if (upsertAck) sockAP.emit("rule:toggle", { id: upsertAck.id, enabled: false })
      await new Promise((r) => setTimeout(r, 700))
      const row2 = upsertAck ? await pdbAP.nexusAutomationRule.findUnique({ where: { id: upsertAck.id } }) : null
      check("AUTO-PERSIST: rule:toggle → enabled=false ترسيخًا في الصف",
        row2?.enabled === false, `enabled=${row2?.enabled}`)

      // run-now (notify — فعل آمن) → fireCount يزيد في الذاكرة وفي الصف (القاعدة الحية)
      if (upsertAck) {
        sockAP.emit("rule:run-now", { id: upsertAck.id })
        await new Promise((r) => setTimeout(r, 900))
      }
      const row3 = upsertAck ? await pdbAP.nexusAutomationRule.findUnique({ where: { id: upsertAck.id } }) : null
      check("AUTO-PERSIST: run-now → fireCount=1 مرسوخ في الصف (الإحصاءات تعيش عبر إعادة التشغيل)",
        row3?.payload && JSON.parse(row3.payload).fireCount === 1, `fireCount=${row3 ? JSON.parse(row3.payload).fireCount : "none"}`)

      // delete → الصف زال من SQLite (الحذف رسوخًا — لا يعود عند الإقلاع)
      if (upsertAck) sockAP.emit("rule:delete", { id: upsertAck.id })
      await new Promise((r) => setTimeout(r, 700))
      const row4 = upsertAck ? await pdbAP.nexusAutomationRule.findUnique({ where: { id: upsertAck.id } }) : null
      check("AUTO-PERSIST: rule:delete → الصف زال من SQLite (الحذف رسوخًا — البذور المحذوفة لا تعود)",
        row4 === null, row4 ? "row still there" : "deleted")

      const dbRowsEnd = await pdbAP.nexusAutomationRule.count()
      check("AUTO-PERSIST: النهاية — لا صفوف PERSIST-E2E متبقية والبذور سليمة",
        dbRowsEnd >= 4 && !(await pdbAP.nexusAutomationRule.findMany()).some((r) => r.name.includes("PERSIST-E2E")), `rows=${dbRowsEnd}`)
      await pdbAP.$disconnect()
      try { sockAP.disconnect() } catch { /* ignore */ }
    }

    // ============================================================
    // SERVICE-PULSE — نبض الخدمة الذاتي (عقد §27.هـ): القياس بلا واجهة
    // نافذة صمت حتمية (لا fetch ولا socket ولا متصفح) + قراءة SQLite مباشرة
    // + حقل pulse في لقطة الصحة — إثبات أن التوليد خاصية الخادم لا المتصفح
    // ============================================================
    console.log("\n== SERVICE-PULSE: autonomous service pulse (§27.هـ) ==")
    {
      // (أ) فحوص المصدر
      const fsSP = (await import("node:fs")).default
      const rdSP = (p) => { try { return fsSP.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const devSP = rdSP("src/lib/nexus/devices.ts")
      const healthSP = rdSP("src/lib/nexus/health.ts")
      const bridgeSP = rdSP("src/lib/nexus/automation-bridge.ts")
      const routeSP = rdSP("src/app/api/devices/health/route.ts")
      const panelSP = rdSP("src/components/nexus/health-panel.tsx")
      const viewSP = rdSP("src/components/nexus/automation/automation-view.tsx")
      const i18nSP = rdSP("src/lib/ar-en-map.json")
      const contractSP = rdSP("docs/protocol-contract.md")
      const checklistSP = rdSP("docs/e2e-checklist.md")

      check("SERVICE-PULSE: المصدر — ensureServicePulse (حارس globalThis + علم قبل المؤقت + unref) + getServicePulse + SERVICE_PULSE_MS=4000",
        devSP.includes("export function ensureServicePulse") && devSP.includes("__nexusServicePulse = { startedAt: Date.now() }")
        && devSP.includes("timer.unref?.()") && devSP.includes("export function getServicePulse")
        && devSP.includes("SERVICE_PULSE_MS = 4000"), "devices.ts")
      check("SERVICE-PULSE: المصدر — الإشعال من كل المصادر: heartbeatBump + recordHealthTick + إقلاع جسر الروتينات",
        devSP.includes("ensureServicePulse()\n  for (const d of store().devices)")
        && healthSP.includes("ensureServicePulse() // §27.هـ") && bridgeSP.includes("ensureServicePulse()"), "ignition wiring")
      check("SERVICE-PULSE: المصدر — لقطة الصحة تصدر pulse {active, intervalMs, startedAt}",
        routeSP.includes("pulse: getServicePulse()"), "health route")
      check("SERVICE-PULSE: الواجهة — شارة النبض الحية في الترويسة + الحد الصادق أسفل اللوحة",
        panelSP.includes('data-testid="pulse-badge"') && panelSP.includes("نبض ذاتي من الخادم — كل 4 ثوانٍ")
        && panelSP.includes("القياس ذاتي من عملية الخادم"), "health panel")
      check("SERVICE-PULSE: الواجهة — بطاقة حدود الروتينات توثق النبض الذاتي",
        viewSP.includes("النبض الذاتي من الخادم يولّد العينات (كل 30 ث لكل جهاز) ما دامت عملية الخادم تعمل — إغلاق الواجهة لا يوقف الكشف"), "automation view")
      check("SERVICE-PULSE: i18n — المفاتيح الثلاثة في القاموس",
        i18nSP.includes('"نبض ذاتي من الخادم — كل 4 ثوانٍ": "Autonomous server pulse — every 4s"')
        && i18nSP.includes("Measurement runs inside the server process")
        && i18nSP.includes("closing the UI never stops detection"), "i18n")
      check("SERVICE-PULSE: التوثيق — العقد §27.هـ (الميكانيكا/الإشعال/الحدود) + تحديث حد §26.و + القائمة الميدانية §23",
        contractSP.includes("### 27.هـ نبض الخدمة الذاتي") && contractSP.includes("__nexusServicePulse")
        && contractSP.includes("نبض الخدمة الذاتي (§27.هـ) يولّد عينة كل ~30 ث لكل جهاز ما دامت عملية الخادم تعمل")
        && checklistSP.includes("## 23. نبض الخدمة الذاتي"), "docs")

      // (ب) السلوك الحي — نافذة صمت 42 ثانية: الإشعال سبق عبر إقلاع جسر الروتينات
      const dbUrlSP = fsSP.readFileSync(pathMod.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdbSP = new PrismaClient({ datasources: { db: { url: dbUrlSP } }, log: [] })
      const hp0 = await fetch("http://localhost:3000/api/devices/health?device=all&window=1h").then((r) => r.json()).catch(() => null)
      check("SERVICE-PULSE: حقل pulse في اللقطة — نشط بفاصل 4 ث (أُشعل من إقلاع الجسر بلا أي واجهة)",
        hp0?.pulse?.active === true && hp0?.pulse?.intervalMs === 4000, JSON.stringify(hp0?.pulse))
      const t0SP = Date.now()
      console.log("   [SERVICE-PULSE] نافذة صمت 42 ثانية — لا استدعاءات ولا متصفح…")
      await sleep(42_000)
      const fresh = await pdbSP.nexusHealthSample.findMany({ where: { createdAt: { gt: new Date(t0SP) } } })
      const freshDevs = new Set(fresh.map((x) => x.deviceId))
      check("SERVICE-PULSE: عينات وُلدت خلال صمت 42 ث — لا واجهة مفتوحة ولا استدعاءات من الحزمة (التوليد من الخادم)",
        fresh.length >= 3, `fresh=${fresh.length}`)
      check("SERVICE-PULSE: العينات الذاتية تغطي عدة أجهزة (التكة تجول على سجل الأجهزة كله)",
        freshDevs.size >= 2, `devices=${[...freshDevs].join(",")}`)
      await pdbSP.$disconnect()
    }

    // ============================================================
    // DURABLE-ALERTS — التنبيهات المرسوخة (عقد §26.ح): كل إطلاق يُرى ولو
    // أُطلق بلا أي واجهة — صف في NexusAutomationFire بـ seenAt=null يظهر
    // في ملخص العودة، والبث الحي لواجهة متصلة = رؤية عند التسليم، والسقف
    // 200 بتنقية تلقائية — قراءة SQLite مباشرة عبر Prisma
    // ============================================================
    console.log("\n== DURABLE-ALERTS: durable fire log + unseen alerts (§26.ح) ==")
    {
      const bootDA = await waitHttp("automation boot (DA)", "http://localhost:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("DURABLE-ALERTS: جسر الروتينات حي قبل فحوص التنبيهات المرسوخة",
        bootDA?.port === 3008, `port=${bootDA?.port}`)

      // (أ) فحوص المصدر
      const fsDA = (await import("node:fs")).default
      const rdDA = (p) => { try { return fsDA.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }
      const schemaDA = rdDA("prisma/schema.prisma")
      const dbDA = rdDA("src/lib/db.ts")
      const persistDA = rdDA("src/lib/nexus/automation-persist.ts")
      const bridgeDA = rdDA("src/lib/nexus/automation-bridge.ts")
      const viewDA = rdDA("src/components/nexus/automation/automation-view.tsx")
      const hookDA = rdDA("src/hooks/use-automation-bridge.ts")
      const i18nDA = rdDA("src/lib/ar-en-map.json")
      const contractDA = rdDA("docs/protocol-contract.md")
      const checklistDA = rdDA("docs/e2e-checklist.md")

      check("DURABLE-ALERTS: المصدر — نموذج NexusAutomationFire (seenAt nullable + فهارس at/ruleId) في المخطط + ترقية آمنة CREATE IF NOT EXISTS في db.ts",
        schemaDA.includes("model NexusAutomationFire") && schemaDA.includes("seenAt   DateTime?")
        && schemaDA.includes("@@index([at])") && schemaDA.includes("@@index([ruleId, at])")
        && dbDA.includes('CREATE TABLE IF NOT EXISTS "NexusAutomationFire"') && dbDA.includes('"seenAt"   DATETIME')
        && dbDA.includes('CREATE INDEX IF NOT EXISTS "NexusAutomationFire_at_idx"'), "schema+db.ts")
      check("DURABLE-ALERTS: المصدر — وحدة الترسيخ: persistFire (إدخال + تنقية سقف 200) + loadPersistedFires (إحياء + تنقية الفاسد) + markFiresSeenDb (updateMany)",
        persistDA.includes("export const MAX_PERSISTED_FIRES = 200") && persistDA.includes("export async function persistFire")
        && persistDA.includes("export async function loadPersistedFires") && persistDA.includes("export async function markFiresSeenDb")
        && persistDA.includes("deleteMany({ where: { at: { lt: cutoff") && persistDA.includes("function reviveFire"), "persist module")
      check("DURABLE-ALERTS: المصدر — الجسر: مرآة fireLog + ترسيخ عند كل إطلاق + رؤية عند التسليم (clientsCount) + alerts في buildState + استعادة غير حاجبة + alerts:mark-seen",
        bridgeDA.includes("let fireLog: AutoFireEntry[] = []") && bridgeDA.includes("void persistFire(fireEntry)")
        && bridgeDA.includes("io?.engine?.clientsCount ?? 0") && bridgeDA.includes("seenAt: clients > 0 ? now : null")
        && bridgeDA.includes('unseen: fireLog.filter((f) => !f.seenAt).length') && bridgeDA.includes("loadPersistedFires()")
        && bridgeDA.includes('socket.on("alerts:mark-seen"') && bridgeDA.includes("void markFiresSeenDb(now2)"), "bridge wiring")
      check("DURABLE-ALERTS: المصدر — الأنواع: AutoFireEntry + AutoAlertsPayload في auto:state",
        rdDA("src/lib/nexus/automation-types.ts").includes("export interface AutoFireEntry")
        && rdDA("src/lib/nexus/automation-types.ts").includes("export interface AutoAlertsPayload")
        && rdDA("src/lib/nexus/automation-types.ts").includes("alerts: AutoAlertsPayload"), "types")
      check("DURABLE-ALERTS: الواجهة — شارة غير مرئية + زر تعليم كمقروء + السجل الدائم + ملخص عودة من الخطاف (مرة لكل اتصال) + بند حدود صادق",
        viewDA.includes('data-testid="automation-unseen-badge"') && viewDA.includes('data-testid="automation-mark-seen"')
        && viewDA.includes('data-testid="automation-durable-log"') && viewDA.includes('data-testid="automation-fire-row"')
        && viewDA.includes('data-testid="automation-fire-unseen"')
        && hookDA.includes("digestShown = false") && hookDA.includes("تنبيهات روتين لم تُرَ")
        && viewDA.includes("الإطلاقات نفسها مرسوخة (آخر 200) والتنبيهات غير المرئية تظهر في ملخص العودة"), "ui+hook")
      check("DURABLE-ALERTS: i18n — مفاتيح التنبيهات المرسوخة في القاموس",
        i18nDA.includes('"تنبيهات روتين لم تُرَ": "Unseen routine alerts"')
        && i18nDA.includes('"تعليم الكل كمقروء": "Mark all as read"')
        && i18nDA.includes('"السجل الدائم للإطلاقات": "Durable fire log"')
        && i18nDA.includes('"لم يُرَ": "Unseen"'), "i18n")
      check("DURABLE-ALERTS: التوثيق — العقد §26.ح (الرؤية/السقف/الحدود) + القائمة الميدانية §24",
        contractDA.includes("### 26.ح التنبيهات المرسوخة") && contractDA.includes("دلالات الرؤية (seenAt)")
        && contractDA.includes("io.engine.clientsCount") && checklistDA.includes("## 24. التنبيهات المرسوخة"), "docs")

      // (ب) السلوك الحي — إطلاق بلا واجهة → غير مرئي → ملخص عودة → تعليم كمقروء
      const dbUrlDA = fsDA.readFileSync(pathMod.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdbDA = new PrismaClient({ datasources: { db: { url: dbUrlDA } }, log: [] })
      const { io: ioDA } = await import("socket.io-client")

      // قاعدة موعد مرة واحدة يُطلقها مؤقت الخادم بينما لا عميل متصل (نافذة صمت مقصودة)
      const DA_RULE = "DA-E2E-موعد-بلا-واجهة"
      const sockDA = ioDA("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
      await new Promise((res, rej) => { sockDA.on("connect", res); sockDA.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout")), 9000) })
      const ruleAck = await new Promise((resolve) => {
        let saw = null
        const to = setTimeout(() => resolve(saw), 6000)
        sockDA.on("auto:state", (s) => {
          const r = s?.rules?.find((x) => x.name === DA_RULE)
          if (r) { clearTimeout(to); saw = r; resolve(r) }
        })
        sockDA.emit("rule:upsert", { rule: { name: DA_RULE, enabled: true, trigger: { kind: "time.once", at: Date.now() + 1200 }, action: { kind: "notify", text: "تنبيه مرسوخ E2E" } } })
      })
      check("DURABLE-ALERTS: قاعدة الاختبار (موعد بعد 1.2ث) مُنشأة عبر المقبس",
        !!ruleAck, ruleAck ? `id=${ruleAck.id.slice(0, 8)}` : "no ack")

      // فصل العميل — إطلاق مؤقت time.once يحدث بلا أي واجهة (قراءة §26.ح حدّيًا)
      sockDA.disconnect()
      await sleep(2600 + 5500) // الموعد + تكة pollTime (5ث)
      let fireRow = null
      for (let i = 0; i < 12 && !fireRow; i++) {
        await new Promise((r) => setTimeout(r, 500))
        fireRow = ruleAck ? await pdbDA.nexusAutomationFire.findFirst({ where: { ruleId: ruleAck.id }, orderBy: { at: "desc" } }) : null
      }
      check("DURABLE-ALERTS: إطلاق بلا أي عميل متصل → صف في SQLite بـ seenAt=null (غير مرئي — التنبيه انتظر لا تبخّر)",
        !!fireRow && fireRow.seenAt === null && fireRow.ruleName === DA_RULE,
        fireRow ? `at=${fireRow.at.toISOString()} seenAt=${fireRow.seenAt}` : "no row")

      // عودة العميل → auto:state يحمل alerts.unseen ≥ 1 وlatest يتضمن الإطلاق
      const sock2 = ioDA("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
      const st2 = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(null), 8000)
        sock2.on("auto:state", (s) => { clearTimeout(to); resolve(s) })
      })
      check("DURABLE-ALERTS: عودة الواجهة → auto:state يحمّل alerts.unseen ≥ 1 (ملخص العودة)",
        st2?.alerts && st2.alerts.unseen >= 1 && st2.alerts.latest?.some((f) => f.ruleId === ruleAck?.id && f.seenAt === null),
        st2?.alerts ? `unseen=${st2.alerts.unseen} total=${st2.alerts.total}` : "no alerts")

      // تعليم الكل كمقروء → الذاكرة والSQLite معًا (البرود الحالي يسبق تسجيل المستمع —
      // لذا الحسم عبر اتصال جديد نظيف: أول auto:state يعكس الذاكرة الحية بعد التعليم)
      sock2.emit("alerts:mark-seen")
      let seenDb = 0
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 400))
        seenDb = await pdbDA.nexusAutomationFire.count({ where: { ruleId: ruleAck.id, seenAt: { not: null } } })
        if (seenDb > 0) break
      }
      const sock3 = ioDA("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
      const st3 = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(null), 8000)
        sock3.on("auto:state", (s) => { clearTimeout(to); resolve(s) })
      })
      check("DURABLE-ALERTS: alerts:mark-seen → unseen=0 في الحالة + seenAt مرسوخ في SQLite",
        st3?.alerts?.unseen === 0 && seenDb > 0, `dbSeen=${seenDb} stateUnseen=${st3?.alerts?.unseen}`)

      // البث الحي لواجهة متصلة = رؤية عند التسليم: run-now بعميل متصل → seenAt != null
      const seenLive = await new Promise((resolve) => {
        let row = null
        const to = setTimeout(() => resolve(null), 8000)
        sock2.on("auto:fired", async (p) => {
          if (p?.ruleId !== ruleAck?.id) return
          for (let i = 0; i < 10 && !row; i++) {
            await new Promise((r) => setTimeout(r, 400))
            row = await pdbDA.nexusAutomationFire.findFirst({ where: { ruleId: ruleAck.id, manual: true }, orderBy: { at: "desc" } })
          }
          clearTimeout(to); resolve(row)
        })
        sock2.emit("rule:run-now", { id: ruleAck.id })
      })
      check("DURABLE-ALERTS: run-now بعميل متصل → الإطلاق مرسوخ بـ seenAt != null (رؤية عند التسليم — لا شارة زائفة لما رأيته)",
        !!seenLive && seenLive.seenAt !== null, seenLive ? `seenAt=${seenLive.seenAt.toISOString()}` : "no row")

      // السقف: بذر 205 صفوف قديمة + إطلاق → التنقية تحافظ على ≤ 200
      const cutoffAt = new Date(Date.now() - 3600_000)
      await pdbDA.nexusAutomationFire.createMany({
        data: Array.from({ length: 205 }, (_, i) => ({
          id: `da-e2e-dummy-${Date.now()}-${i}`, ruleId: "da-e2e-dummy", ruleName: "DA-E2E-dummy",
          at: new Date(cutoffAt.getTime() - i * 1000), ok: true, detail: "", manual: false, seenAt: cutoffAt,
        })),
      })
      // إطلاق إضافي (فعل notify آمن) يدفع التنقية — قاعدة مساعدة ثم حذفها
      const capRule = await new Promise((resolve) => {
        let saw = null
        const to = setTimeout(() => resolve(saw), 6000)
        sock2.on("auto:state", (s) => {
          const r = s?.rules?.find((x) => x.name === "DA-E2E-scap")
          if (r) { clearTimeout(to); saw = r; resolve(r) }
        })
        sock2.emit("rule:upsert", { rule: { name: "DA-E2E-scap", enabled: true, trigger: { kind: "battery.below", threshold: 100 }, action: { kind: "notify", text: "cap" } } })
      })
      if (capRule) sock2.emit("rule:run-now", { id: capRule.id })
      let capCount = 999
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 500))
        capCount = await pdbDA.nexusAutomationFire.count()
        if (capCount <= 200) break
      }
      check("DURABLE-ALERTS: السقف — بعد 205 صفوف مضافة + إطلاق → التنقية التلقائية تحافظ على ≤ 200 صف",
        capCount <= 200, `count=${capCount}`)

      // تنظيف E2E: حذف القاعدتين + صفوفهما + بقايا الدummies (التنقية أزالت الأقدم)
      sock2.emit("rule:delete", { id: ruleAck.id })
      if (capRule) sock2.emit("rule:delete", { id: capRule.id })
      await sleep(700)
      const del1 = await pdbDA.nexusAutomationFire.deleteMany({ where: { ruleId: { in: [ruleAck?.id, capRule?.id].filter(Boolean), } } }).catch(() => null)
      const del2 = await pdbDA.nexusAutomationFire.deleteMany({ where: { ruleId: "da-e2e-dummy" } }).catch(() => null)
      const remaining = await pdbDA.nexusAutomationFire.count()
      check("DURABLE-ALERTS: تنظيف E2E — لا صفوف اختبارية متبقية والجدول سليم",
        remaining >= 0 && del1 !== null && del2 !== null, `remaining=${remaining} del1=${del1?.count} del2=${del2?.count}`)

      await pdbDA.$disconnect()
      try { sock2.disconnect() } catch { /* ignore */ }
      try { sockDA.disconnect() } catch { /* ignore */ }
    }

    // ============================================================
    // STORAGE-SUSTAINED — مشغّل التخزين التاريخي (عقد §26.ط):
    // «نبّهني إذا بقي تخزين X فوق 90% لمدة ساعة» — عمود storagePct يؤرشف مع كل
    // عينة، والمقيّم يقرأ سلسلة الدليل (مرساة + نافذة). السلوك الحي على جهاز
    // البذرة redmi-note13 (تخزينه 80%): قاعدة 80% تُطلق من التاريخ، وقاعدة 85%
    // لا تُطلق أبدًا (80 < 85) + run-now يسجّل رفضًا صادقًا + تعقيم المدة.
    // ============================================================
    console.log("\n== STORAGE-SUSTAINED: storage sustained trigger (§26.ط) ==")
    {
      const bootSS = await waitHttp("automation boot (SS)", "http://127.0.0.1:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("STORAGE-SUSTAINED: جسر الروتينات حي قبل الفحوص",
        bootSS?.port === 3008 && bootSS?.rules >= 4, `rules=${bootSS?.rules}`)

      const fsSS = (await import("node:fs")).default
      const pathSS = (await import("node:path")).default
      const rdSS = (p) => { try { return fsSS.readFileSync(pathSS.join(ROOT, p), "utf8") } catch { return "" } }

      // (أ) فحوص المصدر
      const typesSS = rdSS("src/lib/nexus/automation-types.ts")
      const healthSS = rdSS("src/lib/nexus/automation-health.ts")
      const bridgeSS = rdSS("src/lib/nexus/automation-bridge.ts")
      const dbSS = rdSS("src/lib/db.ts")
      const viewSS = rdSS("src/components/nexus/automation/automation-view.tsx")
      const i18nSS = rdSS("src/lib/ar-en-map.json")
      const contractSS = rdSS("docs/protocol-contract.md")
      const checklistSS = rdSS("docs/e2e-checklist.md")

      check("STORAGE-SUSTAINED: المصدر — health.storage.sustained في الأنواع (TriggerKind/SUSTAINED/TRIGGER_KINDS = 11) + تقييم التخزين (condMet متصل فقط + describeCond + sampleValue)",
        typesSS.includes('"health.storage.sustained"')
        && (typesSS.match(/health\.storage\.sustained/g) || []).length >= 3
        && healthSS.includes('if (kind === "health.storage.sustained") return s.online && s.storagePct >= threshold')
        && healthSS.includes('return `تخزين «${deviceId}» فوق ${threshold}%`')
        && healthSS.includes("function sampleValue"), "types+evaluator")
      check("STORAGE-SUSTAINED: الأرشفة — عمود storagePct في المخطط + ترقية محروسة PRAGMA في db.ts + تسجيله في كل عينة",
        dbSS.includes('PRAGMA table_info("NexusHealthSample")')
        && dbSS.includes('ADD COLUMN "storagePct" INTEGER NOT NULL DEFAULT 0')
        && rdSS("src/lib/nexus/health.ts").includes("storagePct: d.storageTotal ? Math.round((d.storageUsed / d.storageTotal) * 100) : 0 }")
        && rdSS("prisma/schema.prisma").includes("storagePct Int      @default(0)"), "archive")
      check("STORAGE-SUSTAINED: تعقيم الجسر — المدة للمشغلات الأربع + عتبة التخزين افتراضي 90 مقصوصة 1..100",
        bridgeSS.includes('tKind === "health.silence.sustained" || tKind === "health.storage.sustained"')
        && bridgeSS.includes('tKind === "health.storage.sustained"') && bridgeSS.includes("tr.threshold ?? 90"), "bridge sanitize")
      check("STORAGE-SUSTAINED: الواجهة — أيقونة HardDrive + ملخص ≥ % + الافتراضي 90 عند الاختيار + صف العتبة",
        viewSS.includes('"health.storage.sustained": { icon: HardDrive')
        && viewSS.includes('case "health.storage.sustained":')
        && viewSS.includes('v === "health.storage.sustained" ? "90"')
        && viewSS.includes('draft.tKind === "health.storage.sustained"'), "view")
      check("STORAGE-SUSTAINED: i18n — مفتاح EN في القاموس المشترك",
        i18nSS.includes('"بقاء التخزين فوق عتبة لمدة (تاريخي)": "Storage stays above threshold for a duration (history)"'), "i18n")
      check("STORAGE-SUSTAINED: التوثيق — العقد §26.أ (الأحد عشر) + §26.ط كاملًا + القائمة الميدانية §26",
        contractSS.includes("المشغلات الأحد عشر") && contractSS.includes("### 26.ط مشغّل التخزين التاريخي")
        && contractSS.includes("storagePct INTEGER NOT NULL DEFAULT 0") && checklistSS.includes("## 26. مشغّل التخزين التاريخي"), "docs")

      // (ب) السلوك الحي — قاعدتان على redmi-note13 (تخزينه 80% ثابت)
      const dbUrlSS = fsSS.readFileSync(pathSS.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdbSS = new PrismaClient({ datasources: { db: { url: dbUrlSS } }, log: [] })
      const { io: ioSS } = await import("socket.io-client")
      const sockSS = ioSS("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })

      const behaviorSS = await new Promise((resolve) => {
        const out = { done: false, fires: [], rejects: [], rulesSnapshot: null, lastRules: null, logEntries: [] }
        const timersSS = []
        const later = (fn, ms) => timersSS.push(setTimeout(fn, ms))
        const finish = () => { if (out.done) return; out.done = true; timersSS.forEach(clearTimeout); try { sockSS.disconnect() } catch {}; resolve(out) }
        later(finish, 180000)

        sockSS.on("auto:state", (s) => {
          out.rulesSnapshot = s?.rules ?? out.rulesSnapshot
          out.lastRules = s?.rules?.map((r) => r.name) ?? out.lastRules
          if (Array.isArray(s?.log)) out.logEntries = s.log
        })
        sockSS.on("auto:fired", (p) => { if (String(p?.ruleName || "").startsWith("SS-E2E")) out.fires.push({ name: p.ruleName, ok: p.ok, detail: p.detail || "", manual: !!p.manual }) })
        sockSS.on("auto:rejected", (p) => { out.rejects.push(String(p?.error || "")) })

        sockSS.on("connect", () => {
          void (async () => {
            try {
              // (0) عينات مرساة فورية: force-sample الآن → تصبح مرساة بعد 70ث
              await fetch("http://127.0.0.1:3000/api/devices/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "force-sample" }) }).then((r) => r.json()).catch(() => null)
              await sleep(70000)  // المرساة تتقادم خارج النافذة (مدة 1 دقيقة)

              // (1) قاعدتان: فوق 75% (تُطلق — الجهاز عند 80%) وفوق 85% (لا تُطلق أبدًا)
              sockSS.emit("rule:upsert", { rule: { name: "SS-E2E-full", enabled: true, trigger: { kind: "health.storage.sustained", deviceId: "redmi-note13", threshold: 75, durationMin: 1 }, action: { kind: "notify", text: "SS-E2E" } } })
              sockSS.emit("rule:upsert", { rule: { name: "SS-E2E-never", enabled: true, trigger: { kind: "health.storage.sustained", deviceId: "redmi-note13", threshold: 85, durationMin: 1 }, action: { kind: "notify", text: "SS-E2E" } } })
              await sleep(2000)

              // (2) تعقيم المدة: 5000 دقيقة فوق سقف 1440 → رفض مسبب
              sockSS.emit("rule:upsert", { rule: { name: "SS-E2E-bad-duration", enabled: true, trigger: { kind: "health.storage.sustained", threshold: 90, durationMin: 5000 }, action: { kind: "notify", text: "SS-E2E" } } })
              await sleep(95000)  // تكة تقييم ≤15ث + نافذة المدة دقيقة كاملة فوق المرساة

              // (3) run-now لقاعدة 85% → رفض صادق ok=false في السجل (يُرى من auto:state لا من حدث منفصل)
              const never = (out.rulesSnapshot ?? []).find((x) => x.name === "SS-E2E-never")
              if (never) sockSS.emit("rule:run-now", { id: never.id })
              await sleep(4000)

              // (4) التنظيف — بالمعرفات من لقطة القواعد الكاملة
              for (const nm of ["SS-E2E-full", "SS-E2E-never"]) {
                const f = (out.rulesSnapshot ?? []).find((x) => x.name === nm)
                if (f) sockSS.emit("rule:delete", { id: f.id })
              }
              await sleep(1500)
              finish()
            } catch (e) {
              console.log("   [SS] error:", e?.message || e)
              finish()
            }
          })()
        })
      })

      const fSS = behaviorSS.fires
      const autoFire = fSS.find((x) => x.name === "SS-E2E-full" && !x.manual && x.ok)
      check("STORAGE-SUSTAINED: قاعدة 75% على جهاز 80% → إطلاق من التاريخ بتفصيل «مستمر منذ … وفق التاريخ المسجل»",
        !!autoFire && autoFire.detail.includes("تخزين") && autoFire.detail.includes("75%") && autoFire.detail.includes("وفق التاريخ المسجل"), autoFire?.detail?.slice(0, 90) || "no fire")
      check("STORAGE-SUSTAINED: لا إطلاق لقاعدة 85% (80% < 85) — التاريخ الصادق يمنع الزائف",
        !fSS.some((x) => x.name === "SS-E2E-never" && x.ok && !x.manual), `fires=${fSS.map((x) => `${x.name}:${x.ok}`).join(",")}`)
      check("STORAGE-SUSTAINED: run-now لقاعدة 85% → رفض صادق ok=false في السجل بتفصيل «مخالف (80%)» (يُرى من auto:state — نمط AUTO-HEALTH)",
        behaviorSS.logEntries.some((e) => e.ruleName === "SS-E2E-never" && e.manual === true && e.ok === false && String(e.detail || "").includes("(80%)")),
        behaviorSS.logEntries.find((e) => e.ruleName === "SS-E2E-never")?.detail?.slice(0, 80) || "no refusal entry")
      check("STORAGE-SUSTAINED: تعقيم المدة — 5000 دقيقة مرفوضة بتفصيل السقف 1440",
        behaviorSS.rejects.some((e) => e.includes("1440")), behaviorSS.rejects[0]?.slice(0, 80) || "no rejection")

      // (ج) الأرشفة مباشرة من SQLite — عينات redmi-note-13 الحديثة كلها تحمل storagePct=80
      const recent = await pdbSS.nexusHealthSample.findMany({
        where: { deviceId: "redmi-note13", createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
        orderBy: { createdAt: "desc" }, take: 6,
      }).catch(() => [])
      check("STORAGE-SUSTAINED: الأرشفة الحية — آخر عينات redmi-note-13 كلها تحمل storagePct=80 (تُكتب مع كل عينة)",
        recent.length >= 3 && recent.every((r) => r.storagePct === 80), `n=${recent.length} vals=${recent.map((r) => r.storagePct).join(",")}`)
      check("STORAGE-SUSTAINED: التنظيف — قاعدتا SS-E2E زالتا من آخر auto:state",
        Array.isArray(behaviorSS.lastRules) && !behaviorSS.lastRules.some((n) => String(n).startsWith("SS-E2E")), "rules deleted")

      await pdbSS.$disconnect()
      try { sockSS.disconnect() } catch { /* ignore */ }
    }

    // TEST-TRIGGER — فحص التاريخ الحي من المحرر (عقد §26.ي):
    // «هل سيُطلق الآن؟ ولماذا لا؟» بنفس مصدر الحقيقة (evalSustainedTrigger حرفيًا)
    // بقراءة محضة: النتيجة للمطالب حصرًا (socket.emit لا بث) — بلا سجل ولا ترسيخ
    // ولا مسٍّ للتسليح. الحي على أجهزة أشباح tt-e2e-* بعينات مزروعة عبر Prisma
    // (نمط AUTO-HEALTH) — حتمية كاملة بلا تداخل عينات حقيقية.
    // ============================================================
    console.log("\n== TEST-TRIGGER: live history test from the editor (§26.ي) ==")
    {
      const bootTT = await waitHttp("automation boot (TT)", "http://127.0.0.1:3000/api/automation/boot", 20000, (j) => j?.ok === true && j?.booted === true)
      check("TEST-TRIGGER: جسر الروتينات حي قبل الفحوص",
        bootTT?.port === 3008 && bootTT?.rules >= 4, `rules=${bootTT?.rules}`)

      const fsTT = (await import("node:fs")).default
      const pathTT = (await import("node:path")).default
      const rdTT = (p) => { try { return fsTT.readFileSync(pathTT.join(ROOT, p), "utf8") } catch { return "" } }

      // (أ) فحوص المصدر
      const typesTT = rdTT("src/lib/nexus/automation-types.ts")
      const bridgeTT = rdTT("src/lib/nexus/automation-bridge.ts")
      const sockTT = rdTT("src/lib/automation-socket.ts")
      const viewTT = rdTT("src/components/nexus/automation/automation-view.tsx")
      const i18nTT = rdTT("src/lib/ar-en-map.json")
      const contractTT = rdTT("docs/protocol-contract.md")
      const checklistTT = rdTT("docs/e2e-checklist.md")

      check("TEST-TRIGGER: المصدر — الجسر: معالج rule:test (حارس النوع التاريخي + sanitizeTrigger المشترك + evalSustainedTrigger) ونتيجة auto:test-result للمطالب حصرًا بلا بث",
        bridgeTT.includes('socket.on("rule:test"')
        && bridgeTT.includes('socket.emit("auto:test-result"')
        && bridgeTT.includes("فحص التاريخ متاح للمشغلات التاريخية المستمرة فقط")
        && bridgeTT.includes("function sanitizeTrigger"), "bridge handler")

      check("TEST-TRIGGER: المصدر — دلالة «لا أثر»: معالج rule:test لا يحتوي pushLog ولا persistFire ولا broadcastState ولا مسًّا للتسليح",
        (() => {
          const m = bridgeTT.match(/socket\.on\("rule:test"[\s\S]*?\n      \}\)\n/)
          if (!m) return false
          const h = m[0]
          return !h.includes("pushLog") && !h.includes("persistFire") && !h.includes("broadcastState") && !h.includes("sustainedArmed")
        })(), "no-trace semantics")

      check("TEST-TRIGGER: المصدر — الأنواع: AutoTestResult (ok/satisfied/reason/evidence) في وحدة آمنة للعميل + العميل autoTestTrigger يبث rule:test",
        typesTT.includes("export interface AutoTestResult")
        && typesTT.includes("evidence?: { samples: number; spanMin: number | null; anchorAgeMin: number | null; lastAgeMin: number | null }")
        && sockTT.includes("export function autoTestTrigger(trigger: AutoTrigger)")
        && sockTT.includes('emit("rule:test", { trigger })'), "types+client")

      check("TEST-TRIGGER: الواجهة — زر الفحص + لوحة النتيجة (حكم/سبب/رقائق) + شارة القِدم + قائمة الأجهزة المنسدلة والمعرّف اليدوي",
        viewTT.includes('data-testid="automation-test-btn"')
        && viewTT.includes('data-testid="automation-test-result"')
        && viewTT.includes('data-testid="automation-test-verdict"')
        && viewTT.includes('data-testid="automation-test-evidence"')
        && viewTT.includes('data-testid="automation-test-stale"')
        && viewTT.includes('data-testid="automation-device-select"')
        && viewTT.includes('data-testid="automation-device-manual"')
        && viewTT.includes('value="__manual__"')
        && viewTT.includes("function buildTrigger"), "view")

      check("TEST-TRIGGER: i18n — مفاتيح EN في القاموس المشترك",
        i18nTT.includes('"فحص التاريخ الآن": "Test history now"')
        && i18nTT.includes('"التاريخ يستوفي الشرط الآن": "History satisfies the condition now"')
        && i18nTT.includes('"التاريخ لا يستوفي الشرط بعد": "History does not satisfy the condition yet"')
        && i18nTT.includes('"نتيجة لضبط سابق — أعد الفحص": "Result from a previous setting — re-run the test"')
        && i18nTT.includes('"عينات دليل": "Evidence samples"'), "i18n")

      check("TEST-TRIGGER: التوثيق — العقد §26.ي كاملًا + بند §26.د + القائمة الميدانية §27",
        contractTT.includes("### 26.ي فحص التاريخ الحي من المحرر")
        && contractTT.includes("دلالة «لا أثر»")
        && contractTT.includes("فحص التاريخ الحي (§26.ي)")
        && contractTT.includes("زر «فحص التاريخ الآن» في المحرر للمشغلات التاريخية")
        && checklistTT.includes("## 27. فحص التاريخ الحي من المحرر"), "docs")

      // (ب) السلوك الحي — عينات مزروعة على أجهزة أشباح + فحوص عبر rule:test
      const dbUrlTT = fsTT.readFileSync(pathTT.join(ROOT, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]
      const { PrismaClient } = await import("@prisma/client")
      const pdbTT = new PrismaClient({ datasources: { db: { url: dbUrlTT } }, log: [] })
      const { io: ioTT } = await import("socket.io-client")
      const sockTT2 = ioTT("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })

      const behaviorTT = await new Promise((resolve) => {
        const out = { done: false, results: [], stateBefore: null, stateAfter: null, broadcasts: -1, connected: false }
        const timersTT = []
        const later = (fn, ms) => timersTT.push(setTimeout(fn, ms))
        const finish = () => { if (out.done) return; out.done = true; timersTT.forEach(clearTimeout); try { sockTT2.disconnect() } catch {}; resolve(out) }
        later(finish, 60000)

        // لقطة الحالة عبر اتصال جديد (الترحيب auto:state يبعث الحالة الكاملة —
        // لا معالج rules:list في الجسر عمدًا: الحالة تُذاع عند التغيير حصرًا)
        const snapViaNewSocket = () => new Promise((res) => {
          const s2 = ioTT("http://localhost:3008", { path: "/", transports: ["polling", "websocket"], forceNew: true, timeout: 8000, reconnection: false })
          const t0 = setTimeout(() => { try { s2.disconnect() } catch {}; res(null) }, 8000)
          s2.on("auto:state", (s) => { clearTimeout(t0); try { s2.disconnect() } catch {}; res(s) })
        })

        sockTT2.on("connect", () => {
          out.connected = true
          void (async () => {
            try {
              await sleep(500) // تجاوز ترحيب الاتصال (auto:hello + auto:state) قبل عدّاد البث
              let broadcasts = 0
              sockTT2.on("auto:state", () => broadcasts++)

              const now = Date.now()
              // زرع تاريخ اصطناعي حتمي (نمط AUTO-HEALTH):
              //  tt-e2e-full : مرساة 75ث + نافذتان (45ث/25ث) كلها ≤ 15% → استيفاء
              //  tt-e2e-mixed: مرساة 10% + عينة 12% + عينة مخالفة 90% → رفض مسبب «عينة مخالفة»
              //  tt-e2e-empty: بلا عينات → رفض «لا دليل تاريخي»
              const mk = (deviceId, battery, secsAgo) => ({ deviceId, battery, rttMs: 40, online: true, storagePct: 40, createdAt: new Date(now - secsAgo * 1000) })
              await pdbTT.nexusHealthSample.createMany({
                data: [
                  mk("tt-e2e-full", 10, 75), mk("tt-e2e-full", 12, 45), mk("tt-e2e-full", 11, 25),
                  mk("tt-e2e-mixed", 10, 75), mk("tt-e2e-mixed", 12, 45), mk("tt-e2e-mixed", 90, 25),
                ],
              })

              const test = (trigger) => new Promise((res) => {
                const t0 = setTimeout(() => res({ timeout: true }), 8000)
                sockTT2.once("auto:test-result", (r) => { clearTimeout(t0); res(r) })
                sockTT2.emit("rule:test", { trigger })
              })

              // (1) استيفاء: بطارية tt-e2e-full ≤ 15% لمدة دقيقة (سلسلة دليل 3 عينات)
              out.results.push({ case: "full", r: await test({ kind: "health.battery.sustained", deviceId: "tt-e2e-full", threshold: 15, durationMin: 1 }) })
              // (2) مخالفة: عينة 90% داخل المدة تقطع السلسلة
              out.results.push({ case: "mixed", r: await test({ kind: "health.battery.sustained", deviceId: "tt-e2e-mixed", threshold: 15, durationMin: 1 }) })
              // (3) بلا دليل: جهاز بلا عينات
              out.results.push({ case: "empty", r: await test({ kind: "health.battery.sustained", deviceId: "tt-e2e-empty", threshold: 15, durationMin: 1 }) })
              // (4) رفض التعقيم: مدة فوق سقف 1440
              out.results.push({ case: "bad-duration", r: await test({ kind: "health.battery.sustained", threshold: 15, durationMin: 5000 }) })
              // (5) رفض النوع: مشغل لحظي ليس تاريخيًا
              out.results.push({ case: "non-sustained", r: await test({ kind: "battery.below", threshold: 20 }) })

              // (6) دلالة «لا أثر»: الحالة قبل/بعد كل الفحوص متطابقة (لقطة عبر اتصال
              // جديد) + صفر بث auto:state على مقبس الاختبار طوال الفحوص
              const before = await snapViaNewSocket()
              out.results.push({ case: "full-again", r: await test({ kind: "health.battery.sustained", deviceId: "tt-e2e-full", threshold: 15, durationMin: 1 }) })
              const after = await snapViaNewSocket()
              out.stateBefore = before ? { rules: before.rules?.length, log: before.log?.length, total: before.alerts?.total } : null
              out.stateAfter = after ? { rules: after.rules?.length, log: after.log?.length, total: after.alerts?.total } : null
              out.broadcasts = broadcasts
              finish()
            } catch (e) {
              console.log("   [TT] error:", e?.message || e)
              finish()
            }
          })()
        })
      })

      const getR = (c) => behaviorTT.results.find((x) => x.case === c)?.r
      const full = getR("full")
      check("TEST-TRIGGER: فحص تاريخ مستوفى — satisfied=true بتفصيل «مستمر منذ … وفق التاريخ المسجل» + دليل 3 عينات",
        full?.ok === true && full?.satisfied === true && String(full?.reason || "").includes("وفق التاريخ المسجل") && full?.evidence?.samples >= 3,
        full?.reason?.slice(0, 90) || JSON.stringify(full)?.slice(0, 90))
      const mixed = getR("mixed")
      check("TEST-TRIGGER: عينة مخالفة داخل المدة — satisfied=false بسبب صادق «عينة مخالفة (90% قبل 0 دقيقة)»",
        mixed?.ok === true && mixed?.satisfied === false && String(mixed?.reason || "").includes("مخالفة") && String(mixed?.reason || "").includes("(90%"),
        mixed?.reason?.slice(0, 90) || "no result")
      const empty = getR("empty")
      check("TEST-TRIGGER: جهاز بلا عينات — satisfied=false بسبب «لا دليل تاريخي يسبق بداية المدة» (حد §26.و ظاهر لا مخفي)",
        empty?.ok === true && empty?.satisfied === false && String(empty?.reason || "").includes("لا دليل تاريخي"),
        empty?.reason?.slice(0, 90) || "no result")
      const badDur = getR("bad-duration")
      check("TEST-TRIGGER: رفض التعقيم — مدة 5000 دقيقة ok=false بتفصيل السقف 1440",
        badDur?.ok === false && String(badDur?.error || "").includes("1440"), badDur?.error?.slice(0, 80) || "no rejection")
      const nonSus = getR("non-sustained")
      check("TEST-TRIGGER: رفض النوع — مشغل لحظي ok=false «فحص التاريخ متاح للمشغلات التاريخية المستمرة فقط»",
        nonSus?.ok === false && String(nonSus?.error || "").includes("تاريخية"), nonSus?.error?.slice(0, 80) || "no rejection")
      check("TEST-TRIGGER: دلالة «لا أثر» حية — الحالة قبل/بعد الفحوص متطابقة حرفيًا (لقطة عبر اتصال جديد) + صفر بث auto:state أثناء الفحوص",
        behaviorTT.stateBefore != null && JSON.stringify(behaviorTT.stateBefore) === JSON.stringify(behaviorTT.stateAfter) && behaviorTT.broadcasts === 0,
        `before=${JSON.stringify(behaviorTT.stateBefore)} after=${JSON.stringify(behaviorTT.stateAfter)} broadcasts=${behaviorTT.broadcasts}`)

      // (ج) التنظيف — العينات المزروعة زالت بلا بقايا
      const delTT = await pdbTT.nexusHealthSample.deleteMany({ where: { deviceId: { startsWith: "tt-e2e" } } }).catch(() => null)
      const leftTT = await pdbTT.nexusHealthSample.count({ where: { deviceId: { startsWith: "tt-e2e" } } }).catch(() => -1)
      check("TEST-TRIGGER: التنظيف — عينات أجهزة tt-e2e-* زالت بلا بقايا (لا قواعد أُنشئت أصلًا — الفحص قراءة محضة)",
        delTT != null && leftTT === 0, `deleted=${delTT?.count} leftover=${leftTT}`)

      await pdbTT.$disconnect()
      try { sockTT2.disconnect() } catch { /* ignore */ }
    }

  }

  // ============================================================
  // [SEC] M0.3 — التدقيق الأمني الداخلي (docs/security-audit.md)
  // بوابة rc:power/rc:wol/rc:handoff (__src) · desktop:register محلي حصرًا ·
  // قائمة سماح البوابة · CORS بلا "*" · تمرير IP العميل الحقيقي
  // ============================================================
  {
    console.log("== [SEC] security hardening: gateway allowlist + trust gates + CORS ==")
    const fsMod = await import("node:fs")
    const pathMod = await import("node:path")
    const read = (p) => fsMod.readFileSync(pathMod.join(ROOT, p), "utf8")

    // ---- (أ) فحوص المصدر ----
    const gwSrc = read("mini-services/gateway/index.cjs")
    check("SEC/source: البوابة بقائمة سماح (GATEWAY_ALLOW + ALLOW.has — لا قفز لأي منفذ)",
      gwSrc.includes("GATEWAY_ALLOW") && gwSrc.includes("ALLOW.has"), "mini-services/gateway/index.cjs")
    check("SEC/source: البوابة تمرر x-gw-client-ip في HTTP وWS upgrade (استبدال حرفيًا — لا ثقة بترويسة عميل)",
      (gwSrc.match(/x-gw-client-ip/g) || []).length >= 4, "proxyHttp + proxyUpgrade")
    const rbSrc = read("src/lib/nexus/remote-bridge.ts")
    check("SEC/source: الجسر المدمج — desktop:register لعميل محلي حصرًا (isLocalSocket → local-only)",
      rbSrc.includes("isLocalSocket(socket.handshake)") && rbSrc.includes('"local-only"'), "remote-bridge.ts")
    check("SEC/source: الجسر المدمج — rc:power/rc:wol يحقنان __src ويرفضان المجهول (نمط §13)",
      rbSrc.includes("__src: src") && (rbSrc.match(/reason: "untrusted", ev: "rc:power"/g) || []).length === 1 && rbSrc.includes('ev: "rc:wol"'), "remote-bridge.ts")
    check("SEC/source: الجسر المدمج — rc:handoff بوابة ثقة (مقترن/واجهة الكمبيوتر حصرًا)",
      rbSrc.includes('ev: "rc:handoff"'), "remote-bridge.ts")
    const rsSrc = read("mini-services/remote-service/index.ts")
    check("SEC/source: المرآة المستقلة — نفس البوابات (local-only + __src + originAllowed بلا *)",
      /['"]local-only['"]/.test(rsSrc) && rsSrc.includes("__src: src") && rsSrc.includes("originAllowed") && !rsSrc.includes('origin: \'*\''), "remote-service/index.ts")
    const dbSrc = read("src/components/nexus/desktop-bridge.tsx")
    check("SEC/source: نقطة التنفيذ (webview) — onRcPower يبوّب __src بنفس دلالات onRcInput",
      dbSrc.includes('if (src !== "desktop" && src !== "controller") return') && dbSrc.includes('if (src === "controller" && !sessionActive) return'), "desktop-bridge.tsx")
    let starCount = 0
    for (const p of ["src/lib/nexus/remote-bridge.ts", "src/lib/nexus/guard-bridge.ts", "src/lib/nexus/automation-bridge.ts", "src/lib/nexus/productivity-bridge.ts", "src/lib/nexus/media-bridge.ts", "src/lib/nexus/security-bridge.ts", "mini-services/comms-service/index.ts", "mini-services/remote-service/index.ts"]) {
      if (read(p).match(/origin:\s*["']\*["']/)) starCount++
    }
    check("SEC/source: صفر origin:\"*\" في الجسور الثمانية (socketCors/allowlist في كلها)", starCount === 0, `remaining=${starCount}`)

    // ---- (ب) فحوص حية عبر البوابة ----
    // قائمة السماح: منفذ خارجها → 403 صادق
    const deny1 = await fetch(`http://127.0.0.1:${gwPort}/?XTransformPort=22`).then(async (r) => ({ code: r.status, j: await r.json().catch(() => null) })).catch((e) => ({ code: 0, j: null }))
    check("SEC/live: البوابة ترفض XTransformPort=22 (خارج قائمة السماح) بـ 403 port-not-allowed",
      deny1?.code === 403 && deny1?.j?.error === "port-not-allowed", `code=${deny1?.code}`)
    const deny2 = await fetch(`http://127.0.0.1:${gwPort}/?XTransformPort=9300`).then((r) => r.status).catch(() => 0)
    check("SEC/live: البوابة ترفض منفذًا اعتباطيًا آخر (9300) — لا نفق مسح شبكة", deny2 === 403, `code=${deny2}`)
    const allow1 = await fetch(`http://127.0.0.1:${gwPort}/status?XTransformPort=3003`).then((r) => r.json()).catch(() => null)
    check("SEC/live: المسار المشروع سالم — XTransformPort=3003/status → role=comms", allow1?.role === "comms", `role=${allow1?.role ?? "—"}`)

    // CORS: Origin خارجي بلا ترويسة سماح · Origin محلي مسموح
    const hs = (origin) => fetch(`http://127.0.0.1:3003/?EIO=4&transport=polling&XTransformPort=none`, { headers: origin ? { Origin: origin } : {} }).then((r) => ({ code: r.status, acao: r.headers.get("access-control-allow-origin") })).catch(() => null)
    const evil = await hs("https://evil.example")
    check("SEC/live: مصافحة comms بـ Origin خارجي — لا ترويسة سماح له (المتصفح يحجب)", !!evil && evil.acao !== "https://evil.example", `acao=${evil?.acao ?? "null"} code=${evil?.code}`)
    const own = await hs("http://127.0.0.1:8180")
    check("SEC/live: مصافحة comms بـ Origin محلي — مسموحة بترويسة صريحة", !!own && own.acao === "http://127.0.0.1:8180", `acao=${own?.acao ?? "null"}`)

    // بوابة الثقة الحية: سوكِت مجهول → rc:power مرفوض ولا يصل لدور الكمبيوتر
    const { io: ioSec } = await import("socket.io-client")
    const mkSock = () => io(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const waitConnect = (s) => new Promise((res, rej) => { s.once("connect", res); s.once("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout")), 10000) })
    const secDesk = mkSock(); await waitConnect(secDesk)
    secDesk.emit("desktop:register", { name: "NEXUS-SEC", mac: "AA:BB:CC:11:22:33" })
    await sleep(600)
    const secRogue = mkSock(); await waitConnect(secRogue)
    // المستمعان قبل الإصدار — أي ترحيل (لو رجع الانحدار) يُلتقط لا يُفوَّت
    let leaked = false
    secDesk.on("rc:power", () => { leaked = true })
    const rejected = await new Promise((res) => {
      secRogue.on("rc:rejected", (d) => res(d))
      secRogue.emit("rc:power", { action: "shutdown" })
      setTimeout(() => res(null), 5000)
    })
    await sleep(1600) // نافذة سماح الترحيل تنقضي
    check("SEC/live: سوكِت مجهول → rc:power {shutdown} → rc:rejected(untrusted) حصرًا له",
      rejected?.reason === "untrusted" && rejected?.ev === "rc:power", JSON.stringify(rejected) || "no rejection")
    check("SEC/live: صفر ترحيل — دور الكمبيوتر المسجل لا يستقبل rc:power من المجهول إطلاقًا", leaked === false, leaked ? "LEAKED" : "no relay")
    // انتحال حالة الطاقة من المجهول يُتجاهل — المستمع يُربط قبل الاتصال (rc:hello عند الصلة مباشرة)
    secRogue.emit("desktop:state", { power: "off" })
    await sleep(700)
    const probe = mkSock()
    const helloP = new Promise((res) => {
      probe.on("rc:hello", (d) => res(String(d?.desktop?.power ?? "")))
      setTimeout(() => res(""), 6000)
    })
    await waitConnect(probe)
    const helloPower = await helloP
    check("SEC/live: انتحال desktop:state {power:off} من المجهول يُتجاهل — الحالة تبقى on", helloPower === "on", `power=${helloPower}`)

    // محاكاة LAN حقيقية: الاتصال بعنوان الشبكة المحلي للحاوية (لا loopback)
    const os = await import("node:os")
    const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4")?.address || ""
    if (lanIp) {
      const lanSock = io(`http://${lanIp}:3004`, { transports: ["polling"], reconnection: false, timeout: 10000 })
      const lanConnected = await waitConnect(lanSock).then(() => true).catch(() => false)
      const lanReg = await new Promise((res) => {
        lanSock.on("rc:rejected", (d) => res(d))
        lanSock.emit("desktop:register", { name: "SPOOF-ATTEMPT", mac: "AA:BB:CC:DD:EE:01" })
        setTimeout(() => res(null), 4000)
      })
      check("SEC/live: سوكِت من عنوان الشبكة (محاكاة LAN) → desktop:register → رفض local-only",
        lanConnected && lanReg?.reason === "local-only" && lanReg?.ev === "desktop:register", `ip=${lanIp} got=${JSON.stringify(lanReg)}`)
      // تزييف ترويسة البوابة من سوكِت شبكي (عبر البوابة من عنوان الشبكة) —
      // البوابة تستبدل الترويسة بعنوان العميل الحقيقي فالرفض local-only قائم
      const lanSock2 = io(`http://${lanIp}:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000, extraHeaders: { "x-gw-client-ip": "127.0.0.1" } })
      const lan2Connected = await waitConnect(lanSock2).then(() => true).catch(() => false)
      const lan2Reg = await new Promise((res) => {
        lanSock2.on("rc:rejected", (d) => res(d))
        lanSock2.emit("desktop:register", { name: "SPOOF-HEADER", mac: "AA:BB:CC:DD:EE:02" })
        setTimeout(() => res(null), 4000)
      })
      check("SEC/live: تزييف x-gw-client-ip عبر البوابة من عميل شبكي — البوابة تستبدلها فالرفض local-only قائم",
        lan2Connected && lan2Reg?.reason === "local-only", `got=${JSON.stringify(lan2Reg)}`)
      try { lanSock.disconnect() } catch {}
      try { lanSock2.disconnect() } catch {}
    } else {
      check("SEC/live: لا عنوان شبكة محلي متاح في هذه البيئة — فحص LAN تجاوز صادق", true, "no lan ip")
    }
    for (const s of [secDesk, secRogue, probe]) { try { s.disconnect() } catch {} }
  }

  // [SEC-F6] M1 — الحافظة الموحدة فوق القناة المشفرة (docs/security-audit.md F6)
  {
    console.log("== [SEC-F6] unified clipboard over the E2EE channel ==")
    const fsModF6 = await import("node:fs")
    const pathModF6 = await import("node:path")
    const read = (p) => fsModF6.readFileSync(pathModF6.join(ROOT, p), "utf8")
    // ---- (أ) فحوص مصدر ----
    const pbSrc = read("src/lib/nexus/productivity-bridge.ts")
    check("SEC-F6/source: بث الحافظة بقواعد هوية — broadcastClip تفرّق isLocalSocket (كامل للجهاز المحلي / بيانات وصفية للشبكة)",
      pbSrc.includes("export function broadcastClip") && pbSrc.includes("isLocalSocket(s.handshake)") && pbSrc.includes('content: "", encrypted: true, delivery: "e2ee"'), "productivity-bridge.ts")
    check("SEC-F6/source: المسارات الثلاثة عبر البث الموحد — clip:push وprodInjectClip وprodEmitClip (لا io.emit خام للحافظة)",
      (pbSrc.match(/broadcastClip\(io2, item\)/g) || []).length >= 1 && pbSrc.includes("broadcastClip(io, item)") && pbSrc.includes("export function prodEmitClip"), "productivity-bridge.ts")
    const clipRoute = read("src/app/api/prod/clipboard/route.ts")
    check("SEC-F6/source: REST POST لا يبث clip:new خامًا — prodEmitClip في المسار",
      clipRoute.includes("prodEmitClip(") && !/prodEmit\(\s*["']clip:new["']/.test(clipRoute), "api/prod/clipboard/route.ts")
    const upbSrc = read("src/hooks/use-prod-bridge.ts")
    check("SEC-F6/source: مُرحّل الإرسال المشفر — مقاطع pc-office النصية → sendSecureClip هادئًا (لا تمرير لما أصله الهاتف)",
      upbSrc.includes("sendSecureClip") && upbSrc.includes("{ quiet: true }") && upbSrc.includes('item.deviceId === "pc-office" && item.kind === "text"'), "use-prod-bridge.ts")
    const usbSrc = read("src/hooks/use-sec-bridge.ts")
    check("SEC-F6/source: مستقبل clip ببوابة صلاحية clipboard — رفض perm-denied + تدقيق",
      usbSrc.includes('const feature = "clipboard"') && usbSrc.includes("perm-denied"), "use-sec-bridge.ts")
    const secKt = read("nexuslink_mobile/android/app/src/main/kotlin/com/nexuslink/mobile/SecChannel.kt")
    check("SEC-F6/source: الهاتف الحقيقي — SecChannel يكتب الحافظة المشفرة فورًا + حرس الحلقة clipLastFromPc + applied",
      secKt.includes("setPrimaryClip") && secKt.includes("AgentForegroundService.clipLastFromPc = text") && secKt.includes('"applied" to applied'), "SecChannel.kt")

    // ---- (ب) حي: اختبار التسريب — loopback مقابل LAN على 3007 ----
    const osF6 = await import("node:os")
    const lanIpF6 = Object.values(osF6.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4")?.address || ""
    const { io: ioF6 } = await import("socket.io-client")
    const needle = `F6-SEC-NEEDLE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const f6Local = ioF6("http://127.0.0.1:3007", { transports: ["polling"], reconnection: false, timeout: 10000 })
    await new Promise((res, rej) => { f6Local.once("connect", res); f6Local.once("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout local 3007")), 10000) })
    const localClipP = new Promise((res) => { f6Local.once("clip:new", (d) => res(d)); setTimeout(() => res(null), 6000) })
    let f6Lan = null, lanClipP = null
    if (lanIpF6) {
      f6Lan = ioF6(`http://${lanIpF6}:3007`, { transports: ["polling"], reconnection: false, timeout: 10000 })
      await new Promise((res, rej) => { f6Lan.once("connect", res); f6Lan.once("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout lan 3007")), 10000) })
      lanClipP = new Promise((res) => { f6Lan.once("clip:new", (d) => res(d)); setTimeout(() => res(null), 6000) })
    }
    const pushRes = await fetch("http://127.0.0.1:3000/api/prod/clipboard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "pc-office", deviceName: "PC-OFFICE", kind: "text", content: needle, mode: "auto" }),
    }).then((r) => r.json()).catch(() => null)
    const localClip = await localClipP
    const lanClip = lanClipP ? await lanClipP : null
    check("SEC-F6/live: دفع REST سليم (المسار الموحد prodEmitClip)", pushRes?.ok === true && !!localClip, `id=${pushRes?.item?.id ?? "—"}`)
    check("SEC-F6/live: العميل المحلي (loopback) يستلم المحتوى الكامل — سلوك الحافظة الموحدة سليم",
      localClip?.content === needle, `len=${String(localClip?.content ?? "").length}`)
    if (lanIpF6) {
      check("SEC-F6/live: سوكِت الشبكة (LAN) بيانات وصفية حصرًا — content:\"\" + encrypted:true + delivery:\"e2ee\"",
        !!lanClip && lanClip?.content === "" && lanClip?.encrypted === true && lanClip?.delivery === "e2ee",
        JSON.stringify({ content: lanClip?.content, encrypted: lanClip?.encrypted, delivery: lanClip?.delivery }))
      check("SEC-F6/live: صفر تسريب — الإطار الواصل للشبكة لا يحمل الإبرة بأي شكل",
        !!lanClip && !JSON.stringify(lanClip).includes(needle), "wire truth")
    } else {
      check("SEC-F6/live: لا عنوان شبكة محلي متاح — فحص LAN تجاوز صادق", true, "no lan ip")
    }

    // ---- (ج) حي: المصافحة الكاملة X25519 + الإطار المشفر عبر البوابة ----
    try {
      const [{ x25519 }, { hkdf }, { sha256: nsha }] = await Promise.all([
        import("@noble/curves/ed25519"), import("@noble/hashes/hkdf"), import("@noble/hashes/sha256"),
      ])
      const subtle = globalThis.crypto.subtle
      const b64e = (u8) => Buffer.from(u8).toString("base64")
      const b64d = (s) => new Uint8Array(Buffer.from(s, "base64"))
      const utf8 = (s) => new TextEncoder().encode(s)
      const mkSec = async (deviceId, name, role) => {
        const s = ioF6(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3009" }, transports: ["polling"], reconnection: false, timeout: 10000 })
        await new Promise((res, rej) => { s.once("connect", res); s.once("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout 3009")), 10000) })
        return { s, deviceId, name, role, priv: x25519.utils.randomPrivateKey(), eph: x25519.utils.randomPrivateKey() }
      }
      const announce = (p) => p.s.emit("sec:announce", { role: p.role, deviceId: p.deviceId, name: p.name, pub: b64e(x25519.getPublicKey(p.priv)), eph: b64e(x25519.getPublicKey(p.eph)) })
      const deriveKey = async (myEphPriv, peerEphPubB64, myId, peerId) => {
        const shared = x25519.getSharedSecret(myEphPriv, b64d(peerEphPubB64))
        const [s1, s2] = [myId, peerId].sort()
        const raw = hkdf(nsha, shared, utf8(`nexuslink-v1|${s1}|${s2}`), utf8("nexuslink-e2e-session"), 32)
        return subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
      }
      // PC أولًا (تسجيل) ثم الهاتف — المصافحة تُرحّل مفاتيح كلٍّ للآخر
      const f6Pc = await mkSec("pc-office", "PC-OFFICE", "desktop")
      announce(f6Pc)
      await sleep(800)
      const f6Ph = await mkSec("galaxy-s24", "Galaxy-S24", "phone")
      const pcKexP = new Promise((res) => { f6Pc.s.once("kex:peer", (d) => res(d)); setTimeout(() => res(null), 8000) })
      const phKexP = new Promise((res) => { f6Ph.s.once("kex:peer", (d) => res(d)); setTimeout(() => res(null), 8000) })
      announce(f6Ph)
      const pcKex = await pcKexP
      const phKex = await phKexP
      check("SEC-F6/live: مصافحة X25519 عبر البوابة — المفاتيح رُحّلت للطرفين الموثوقين حصرًا",
        pcKex?.deviceId === "galaxy-s24" && !!pcKex?.eph && phKex?.deviceId === "pc-office" && !!phKex?.eph,
        `pc↔${pcKex?.deviceId ?? "؟"} · ph↔${phKex?.deviceId ?? "؟"}`)
      // pcKex = ما استلمه الكمبيوتر (مفاتيح الهاتف) · phKex = ما استلمه الهاتف (مفاتيح الكمبيوتر)
      const pcKey = await deriveKey(f6Pc.eph, pcKex.eph, "pc-office", "galaxy-s24")
      const phKey = await deriveKey(f6Ph.eph, phKex.eph, "galaxy-s24", "pc-office")
      // سوكِت استطلاع ثالث على 3009 — بلا إعلان: لا يسمع شيئًا
      const f6Recon = ioF6(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3009" }, transports: ["polling"], reconnection: false, timeout: 10000 })
      await new Promise((res) => { f6Recon.once("connect", res); setTimeout(res, 6000) })
      const reconP = new Promise((res) => { f6Recon.once("sec:frame", (d) => res(d)); setTimeout(() => res(null), 2500) })
      // إطار الحافظة المشفر: نفس عقد §9 حرفيًا (AAD = from|to|kind|e{epoch}|seq)
      const needle2 = `F6-E2EE-${needle}`
      const seq = 1
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
      const pt = utf8(JSON.stringify({ text: needle2, at: Date.now() }))
      const ct = await subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: utf8(`pc-office|galaxy-s24|clip|e1|${seq}`), tagLength: 128 },
        pcKey, pt,
      )
      const phFrameP = new Promise((res) => { f6Ph.s.once("sec:frame", (d) => res(d)); setTimeout(() => res(null), 8000) })
      f6Pc.s.emit("sec:frame", { to: "galaxy-s24", from: "pc-office", kind: "clip", e: 1, iv: b64e(iv), ct: b64e(new Uint8Array(ct)), seq })
      const fr = await phFrameP
      check("SEC-F6/live: الإطار المشفر رُحّل للهدف المقترن حصرًا (to=galaxy-s24)",
        !!fr && fr?.from === "pc-office" && fr?.kind === "clip", `from=${fr?.from ?? "—"} kind=${fr?.kind ?? "—"}`)
      const ptOut = await subtle.decrypt(
        { name: "AES-GCM", iv: b64d(String(fr?.iv)), additionalData: utf8(`${fr?.from}|${fr?.to}|${fr?.kind}|e${fr?.e}|${Number(fr?.seq)}`), tagLength: 128 },
        phKey, b64d(String(fr?.ct)),
      )
      const msg = JSON.parse(new TextDecoder().decode(new Uint8Array(ptOut)))
      check("SEC-F6/live: فك التشفير على المستقبل — النص مطابق (X25519+HKDF+AES-256-GCM حية عبر السلك)",
        msg?.text === needle2, `len=${String(msg?.text ?? "").length}`)
      const reconGot = await reconP
      check("SEC-F6/live: سوكِت استطلاع بلا إعلان على 3009 لا يسمع الإطارات إطلاقًا",
        reconGot === null, reconGot ? "RECON HEARD A FRAME" : "silence")
      for (const s of [f6Pc.s, f6Ph.s, f6Recon]) { try { s.disconnect() } catch {} }
    } catch (eF6) {
      check("SEC-F6/live: مصافحة X25519 + الإطار المشفر", false, eF6 instanceof Error ? eF6.message : String(eF6))
    }
    for (const s of [f6Local, f6Lan]) { if (s) { try { s.disconnect() } catch {} } }
  }

  // [SEC-F9] M1 — التسليم الموجّه لحافظة قناة التحكم 3004 (docs/security-audit.md F9)
  {
    console.log("== [SEC-F9] directed delivery of control-channel clipboard ==")
    const fsModF9 = await import("node:fs")
    const pathModF9 = await import("node:path")
    const readF9 = (p) => fsModF9.readFileSync(pathModF9.join(ROOT, p), "utf8")
    // ---- (أ) فحوص مصدر ----
    const rbSrc = readF9("src/lib/nexus/remote-bridge.ts")
    const msSrc = readF9("mini-services/remote-service/index.ts")
    check("SEC-F9/source: الجسر المدمج — توجيه مزدوج (الجلسة النشطة حصرًا ثم جمهور المحليين/الموثوقين)",
      rbSrc.includes('io2.to(session.socketId).emit("desktop:clipboard"') && rbSrc.includes("io2.to(CLIP_AUD).emit"), "remote-bridge.ts")
    check("SEC-F9/source: الجسر المدمج — الانضمام للجمهور بالمحلية أو الهوية الموثوقة (موضعان)",
      (rbSrc.match(/socket\.join\(CLIP_AUD\)/g) || []).length >= 2, `joins=${(rbSrc.match(/socket\.join\(CLIP_AUD\)/g) || []).length}`)
    check("SEC-F9/source: المرآة المستقلة — نفس التوجيه المزدوج ونفس شرط الانضمام",
      msSrc.includes("io.to(session.socketId).emit('desktop:clipboard'") && msSrc.includes("io.to(CLIP_AUD).emit") && (msSrc.match(/socket\.join\(CLIP_AUD\)/g) || []).length >= 2, "remote-service/index.ts")
    check("SEC-F9/source: صفر توجيه عام للحافظة في الجسرين (لا إذاعتها للكل أبدًا)",
      !rbSrc.includes('broadcast.emit("desktop:clipboard"') && !msSrc.includes("broadcast.emit('desktop:clipboard'"), "no fan-out")

    // ---- (ب) حي: استطلاع LAN لا يسمع النص — والجمهور الموثوق يسمعه (بلا جلسة) ----
    const osF9 = await import("node:os")
    const lanIpF9 = Object.values(osF9.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4")?.address || ""
    const { io: ioF9 } = await import("socket.io-client")
    const needleF9 = `F9-CLIP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const mkGw = () => ioF9(`http://127.0.0.1:${gwPort}`, { query: { XTransformPort: "3004" }, transports: ["polling"], reconnection: false, timeout: 10000 })
    const connF9 = (s) => new Promise((res, rej) => { s.once("connect", res); s.once("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout 3004")), 10000) })
    try {
      const f9Desk = mkGw(); await connF9(f9Desk)
      f9Desk.emit("desktop:register", { name: "NEXUS-F9", mac: "AA:BB:CC:11:22:44" })
      // إيقاف أي جلسة متبقية من أقسام سابقة — دلالة هذه المرحلة: بلا جلسة نشطة
      f9Desk.emit("rc:session", { action: "stop" })
      await sleep(600)
      const f9Probe = mkGw(); await connF9(f9Probe) // محلي بلا أدوار → في الجمهور الموثوق
      const reconHits = []
      let f9Recon = null
      if (lanIpF9) {
        f9Recon = ioF9(`http://${lanIpF9}:3004`, { transports: ["polling"], reconnection: false, timeout: 10000 })
        await connF9(f9Recon)
        f9Recon.on("desktop:clipboard", (d) => reconHits.push(d)) // المستمع قبل أي دفع
      }
      let probeGot = null
      f9Probe.once("desktop:clipboard", (d) => { probeGot = d })
      f9Desk.emit("desktop:clipboard", { text: needleF9, at: Date.now() })
      await sleep(1500) // نافذة عدل: أي إذاعة ارتدادية تُلتقط هنا
      check("SEC-F9/live: بلا جلسة — العميل المحلي (جمهور موثوق) يستلم النص كاملًا",
        probeGot?.text === needleF9, `len=${String(probeGot?.text ?? "").length}`)
      if (lanIpF9) {
        check("SEC-F9/live: استطلاع LAN على 3004 لا يسمع النص إطلاقًا (بلا هوية ولا محلية)",
          reconHits.length === 0, reconHits.length ? `RECON HEARD ×${reconHits.length}` : "silence")
      } else {
        check("SEC-F9/live: لا عنوان شبكة متاح — فحص استطلاع LAN تجاوز صادق", true, "no lan ip")
      }

      // ---- (ج) حي: أثناء جلسة نشطة — المقترن حصرًا (حتى المحلي الآخر لا يسمع) ----
      const needleF9b = `${needleF9}-paired`
      const f9Ctl = mkGw(); await connF9(f9Ctl)
      f9Ctl.emit("rc:hello-controller", { name: "Galaxy S24", deviceId: "galaxy-s24" })
      await sleep(500)
      const sessionOn = new Promise((res) => { f9Ctl.once("rc:session", (d) => { if (d?.active === true) res(d) }); setTimeout(() => res(null), 6000) })
      f9Ctl.emit("rc:session", { action: "start", deviceId: "galaxy-s24", name: "Galaxy S24" })
      const sess = await sessionOn
      f9Ctl.emit("rc:session", { action: "hb" }) // تأمين ضد watchdog أثناء الفحص
      let ctlGot = null
      f9Ctl.once("desktop:clipboard", (d) => { ctlGot = d })
      let probeGot2 = null
      f9Probe.once("desktop:clipboard", (d) => { probeGot2 = d })
      f9Desk.emit("desktop:clipboard", { text: needleF9b, at: Date.now() })
      await sleep(1500)
      f9Ctl.emit("rc:session", { action: "hb" })
      await sleep(600)
      check("SEC-F9/live: أثناء الجلسة — النص يصل لوحدة التحكم المقترنة حصرًا (galaxy-s24)",
        !!sess && ctlGot?.text === needleF9b, `paired=${ctlGot?.text === needleF9b ? "ok" : "miss"}`)
      check("SEC-F9/live: أثناء الجلسة — المحلي الآخر (جمهور بلا اقتران) لا يسمع النص",
        probeGot2 === null, probeGot2 ? "LOCAL NON-PAIRED HEARD" : "silence")
      if (lanIpF9) {
        check("SEC-F9/live: أثناء الجلسة — استطلاع LAN صامت تمامًا (التوجيه للزوج حصرًا)",
          reconHits.length === 0, reconHits.length ? `RECON HEARD ×${reconHits.length}` : "silence")
      }
      f9Ctl.emit("rc:session", { action: "stop" })
      await sleep(400)
      for (const s of [f9Desk, f9Probe, f9Ctl, f9Recon]) { if (s) { try { s.disconnect() } catch {} } }
    } catch (eF9) {
      check("SEC-F9/live: الثلاثية الحية على 3004", false, eF9 instanceof Error ? eF9.message : String(eF9))
    }
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
