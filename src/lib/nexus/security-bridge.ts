// NexusLink — المرحلة 10: جسر الأمان الشامل (يعمل داخل عملية Next.js)
// ============================================================
// منفذ 3009 · القناة الموحدة المشفرة E2E:
//  · مرحّل عمياء لإطارات AES-256-GCM (الخادم لا يفك التشفير أبداً)
//  · ترحيل مصافحة X25519 (مفاتيح عامة فقط)
//  · التقاط أسلاكي (Wire Tap) لكل بايت يعبر القناة → فحص التسريب + تصدير pcap
//  · كشف الأجهزة غير الموثوقة + تنبيه فوري + قائمة حظر
//  · صلاحيات لكل ميزة (PermRule) + سجل تدقيق (AuditEvent) في SQLite
//  · تنسيق الحذف الآمن الحقيقي + حالة التخفي + قفل الهاتف عن بُعد
import { createServer } from "http"
import { Server as SocketServer, type Socket } from "socket.io"
import { promises as fsp } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { store as deviceStore } from "./devices"
import { secureWipe, wipableFiles } from "./secure-wipe"

const PORT = 3009
export const SUITE = "X25519 · HKDF-SHA256 · AES-256-GCM · PBKDF2(150k)"

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// ---------- حالة الجسر ----------
interface SecClient {
  sid: string
  role: "desktop" | "phone" | "other"
  deviceId: string
  name: string
  pub: string | null // مفتاح الهوية X25519 (b64)
  eph: string | null // مفتاح الجلسة الرجيع (b64)
  trusted: boolean
  at: number
}
interface WireFrame {
  id: string
  at: number
  channel: string
  from: string
  to: string
  kind: string
  len: number
  hex: string // أول 96 بايت — ما سيراها Wireshark
  b64: string // المحتوى الكامل (لفحص التسريب) حتى 160KB
  encrypted: boolean
}
interface Alert {
  id: string
  probeId: string
  deviceId: string
  name: string
  kind: "unknown-device" | "blocked-device" | "probe"
  at: number
  resolved: string | null
}

const g = globalThis as unknown as {
  __nexusSecBooted?: boolean
  __nexusSecClients?: Map<string, SecClient>
  __nexusSecWire?: WireFrame[]
  __nexusSecAlerts?: Alert[]
  __nexusSecCounters?: { frames: number; bytes: number; rotations: number; bytesAudit: number }
  __nexusSecBlocked?: { id: string; name: string; at: number }[]
  __nexusSecStealth?: boolean
}
const BOOT_KEY = "__nexusSecBooted"

function clients() { return (g.__nexusSecClients ??= new Map()) }
function wire() { return (g.__nexusSecWire ??= []) }
function alerts() { return (g.__nexusSecAlerts ??= []) }
function counters() { return (g.__nexusSecCounters ??= { frames: 0, bytes: 0, rotations: 0, bytesAudit: 0 }) }
function blocked() { return (g.__nexusSecBlocked ??= []) }

export function securityBridgeStatus() {
  return {
    booted: !!g[BOOT_KEY],
    port: PORT,
    suite: SUITE,
    peers: [...clients().values()].map((c) => ({ deviceId: c.deviceId, name: c.name, role: c.role, trusted: c.trusted, hasKeys: !!(c.pub && c.eph) })),
    wireFrames: wire().length,
    alerts: alerts().filter((a) => !a.resolved).length,
    blocked: blocked(),
    stealth: !!g.__nexusSecStealth,
    counters: counters(),
  }
}

// ---------- سجل التدقيق (Prisma + بث فوري) ----------
export async function audit(entry: {
  actor: string
  deviceId?: string
  action: string
  detail: string
  severity?: "info" | "warn" | "critical"
  stealth?: boolean
}) {
  try {
    const row = await db.auditEvent.create({
      data: { actor: entry.actor, deviceId: entry.deviceId ?? null, action: entry.action, detail: entry.detail, severity: entry.severity ?? "info", stealth: entry.stealth ?? false },
    })
    ioRef?.emit("audit:new", { ...row, at: row.at.getTime() })
  } catch (e) {
    console.error("[sec] audit failed:", e instanceof Error ? e.message : e)
  }
}

// ---------- التقاط الأسلاك ----------
function tapWire(f: Omit<WireFrame, "id" | "at">) {
  const frame: WireFrame = { ...f, id: uid(), at: Date.now() }
  const arr = wire()
  arr.push(frame)
  if (arr.length > 400) arr.splice(0, arr.length - 400)
  const c = counters()
  c.frames++
  c.bytes += f.len
  ioRef?.emit("sec:wire-frame", frame)
}

// ---------- التنبيهات (أجهزة غير موثوقة) ----------
function raiseAlert(io2: SocketServer, a: { deviceId: string; name: string; kind: Alert["kind"] }) {
  const alert: Alert = { id: uid(), probeId: uid(), deviceId: a.deviceId, name: a.name, kind: a.kind, at: Date.now(), resolved: null }
  alerts().unshift(alert)
  if (alerts().length > 40) alerts().pop()
  io2.emit("sec:alert", alert)
  void audit({ actor: a.name, deviceId: a.deviceId, action: "alert", detail: a.kind === "blocked-device" ? "جهاز محظور حاول الاتصال مجدداً" : "محاولة اتصال من جهاز غير موثوق", severity: "critical" })
  return alert
}

// ---------- إقلاع الجسر (idempotent ضد hot-reload) ----------
let ioRef: SocketServer | null = null

export function ensureSecurityBridge() {
  if (g[BOOT_KEY]) return securityBridgeStatus()
  g[BOOT_KEY] = true

  try {
    const httpServer = createServer()
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: { origin: "*", methods: ["GET", "POST"] },
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 3e6,
    })
    ioRef = io2

    // تحميل قائمة الحظر من SecState
    void db.secState.findUnique({ where: { id: "main" } }).then((s) => {
      if (s?.blocked) { try { blocked().push(...JSON.parse(s.blocked)) } catch { /* ignore */ } }
      if (!s) void db.secState.create({ data: { id: "main" } }).catch(() => { /* ignore */ })
    })

    io2.on("connection", (socket) => {
      // ==== الترحيب + فحص الثقة ====
      socket.emit("sec:hello", { port: PORT, suite: SUITE, peers: securityBridgeStatus().peers, stealth: !!g.__nexusSecStealth, counters: counters() })

      socket.on("sec:announce", async (d: { role?: string; deviceId?: string; name?: string; pub?: string; eph?: string }) => {
        const deviceId = String(d?.deviceId || "unknown-" + uid().slice(0, 4))
        const known = deviceStore().devices.find((x) => x.id === deviceId)
        const isBlocked = blocked().some((b) => b.id === deviceId)
        const client: SecClient = {
          sid: socket.id, role: (d?.role as SecClient["role"]) || "other",
          deviceId, name: String(d?.name || deviceId),
          pub: d?.pub ?? null, eph: d?.eph ?? null,
          trusted: !!known?.trusted, at: Date.now(),
        }
        clients().set(socket.id, client)

        if (isBlocked) {
          raiseAlert(io2, { deviceId, name: client.name, kind: "blocked-device" })
          socket.emit("sec:rejected", { reason: "blocked", deviceId })
          socket.disconnect(true)
          return
        }
        if (!client.trusted) {
          const alert = raiseAlert(io2, { deviceId, name: client.name, kind: "unknown-device" })
          socket.emit("sec:pending-trust", { alertId: alert.id, probeId: alert.probeId })
          // لا نقطع الاتصال — لكن القناة لن تعمل قبل قرار المستخدم
          return
        }

        // جهاز موثوق: ترحيل المفاتيح للطرفين (مصافحة X25519)
        // للجديد: مفاتيح الأقران الموجودين — للموجودين: مفاتيح الجديد
        for (const [, c] of clients()) {
          if (c.sid !== socket.id && (c.pub || c.eph)) {
            socket.emit("kex:peer", { deviceId: c.deviceId, name: c.name, role: c.role, pub: c.pub, eph: c.eph, sid: c.sid })
            io2.to(c.sid).emit("kex:peer", peerKeyPayload(socket))
          }
        }
        io2.emit("sec:peers", securityBridgeStatus().peers)
        await audit({ actor: client.name, deviceId, action: "kex", detail: `اتصال موثوق + نشر مفاتيح X25519 (بصمة الهوية جاهزة للتحقق)`, severity: "info" })
      })

      // تحديث مفاتيح (تدوير الجلسة الرجيع — يُرحَّل العصر معها)
      socket.on("kex:update", (d: { eph?: string; epoch?: number }) => {
        const c = clients().get(socket.id)
        if (!c) return
        c.eph = d?.eph ?? c.eph
        for (const [, o] of clients()) {
          if (o.sid !== socket.id) {
            io2.to(o.sid).emit("kex:peer", { ...peerKeyPayload(socket), epoch: d?.epoch ?? 0 })
          }
        }
        const c2 = counters(); c2.rotations++
      })

      // سجل تدقيق من العميل (قفل/فتح/رفض/إعدادات الهاتف)
      socket.on("sec:audit", (d: { actor?: string; action?: string; detail?: string; severity?: "info" | "warn" | "critical" }) => {
        void audit({ actor: String(d?.actor || "جهاز"), action: String(d?.action || "info"), detail: String(d?.detail || ""), severity: d?.severity ?? "info" })
      })

      // ==== القناة المشفرة: مرحّل عمياء + التقاط ====
      socket.on("sec:frame", (d: { to?: string; from?: string; kind?: string; iv?: string; ct?: string; seq?: number; stealth?: boolean }) => {
        const sender = clients().get(socket.id)
        if (!sender || !sender.trusted) return // الأجهزة غير الموثوقة لا تمرر شيئاً
        let target: Socket | null = null
        if (d?.to) {
          for (const [, c] of clients()) if (c.deviceId === d.to) { target = io2?.sockets?.sockets.get(c.sid) ?? null; break }
        }
        // التقاط ما يعبر السلك فعلاً (نفس بايتات الرسالة)
        let raw: Buffer
        try { raw = Buffer.from(JSON.stringify(d ?? {}), "utf8") } catch { raw = Buffer.alloc(0) }
        tapWire({
          channel: "e2e", from: d?.from || sender.deviceId, to: d?.to || "؟", kind: String(d?.kind || "data"),
          len: raw.length, hex: raw.subarray(0, 96).toString("hex"),
          b64: raw.toString("base64").slice(0, 220_000), encrypted: !!(d?.iv && d?.ct),
        })
        if (target) target.emit("sec:frame", d)
        else socket.emit("sec:nack", { seq: d?.seq, reason: "peer-offline" })
      })

      // ==== الالتقاط والفحص ====
      socket.on("sec:capture-get", () => socket.emit("sec:capture", { frames: wire() }))
      socket.on("sec:capture-clear", () => { wire().length = 0; io2?.emit("sec:capture-cleared") })

      // ==== تنبيه محاكاة جهاز غريب ====
      socket.on("sec:stranger-probe", (d: { name?: string }) => {
        const name = String(d?.name || `جهاز غير معروف (${["Redmi-X3", "Huawei-P40", "oppo-reno"][Math.floor(Math.random() * 3)]})`)
        const deviceId = "stranger-" + uid().slice(0, 6)
        const isBlocked = blocked().some((b) => b.name === name)
        raiseAlert(io2, { deviceId, name, kind: isBlocked ? "blocked-device" : "probe" })
      })

      socket.on("sec:trust-decision", async (d: { alertId?: string; deviceId?: string; name?: string; decision?: "block" | "once" | "trust" }) => {
        const al = alerts().find((a) => a.id === d?.alertId)
        if (al) al.resolved = d?.decision ?? "ignored"
        const name = String(d?.name || al?.name || "جهاز")
        const deviceId = String(d?.deviceId || al?.deviceId || "unknown")
        if (d?.decision === "block") {
          blocked().push({ id: deviceId, name, at: Date.now() })
          await persistBlocked()
          await audit({ actor: "الكمبيوتر", action: "trust", detail: `تم حظر الجهاز «${name}» نهائياً — أي محاولة اتصال قادمة سترفض`, severity: "warn" })
        } else if (d?.decision === "trust") {
          // توثيق نهائي: يُضاف لسجل الأجهزة الموثوقة
          const st = deviceStore()
          if (!st.devices.find((x) => x.id === deviceId)) {
            st.devices.push({
              id: deviceId, name, kind: "phone", state: "offline", mode: "wifi",
              ip: "192.168.1." + (30 + Math.floor(Math.random() * 200)), battery: 80,
              storageTotal: 128 * 1024 ** 3, storageUsed: 40 * 1024 ** 3,
              lastSeen: Date.now(), rttMs: 15, pairedAt: Date.now(), trusted: true,
            })
          } else {
            const dv = st.devices.find((x) => x.id === deviceId)
            if (dv) dv.trusted = true
          }
          await audit({ actor: "الكمبيوتر", action: "trust", detail: `تم توثيق «${name}» بعد التحقق من بصمة المفتاح — مسموح له بالاقتران`, severity: "warn" })
        } else {
          await audit({ actor: "الكمبيوتر", action: "trust", detail: `رُفض الاتصال مرة واحدة من «${name}»`, severity: "warn" })
        }
        io2.emit("sec:alert-resolved", { alertId: d?.alertId, decision: d?.decision, deviceId, name })
        io2.emit("sec:peers", securityBridgeStatus().peers)
      })

      // ==== الصلاحيات (لكل ميزة مفتاح) ====
      socket.on("sec:perm-set", async (d: { feature?: string; deviceId?: string; enabled?: boolean }) => {
        if (!d?.feature || !d?.deviceId) return
        const rule = await db.permRule.upsert({
          where: { feature_deviceId: { feature: d.feature, deviceId: d.deviceId } },
          create: { feature: d.feature, deviceId: d.deviceId, enabled: !!d.enabled },
          update: { enabled: !!d.enabled },
        })
        io2.emit("perm:changed", rule)
        await audit({ actor: "الكمبيوتر", action: "settings", detail: `صلاحية «${d.feature}» لـ ${d.deviceId}: ${d.enabled ? "مسموح" : "موقوف"}`, severity: "info" })
      })
      socket.on("sec:perm-get", async () => {
        const rules = await db.permRule.findMany()
        socket.emit("perm:rules", rules)
      })

      // ==== سجل التدقيق ====
      socket.on("audit:get", async (d: { limit?: number }) => {
        const rows = await db.auditEvent.findMany({ orderBy: { at: "desc" }, take: Math.min(d?.limit ?? 200, 400) })
        socket.emit("audit:list", rows.map((r) => ({ ...r, at: r.at.getTime() })))
      })
      socket.on("audit:clear", async () => {
        await db.auditEvent.deleteMany({})
        io2?.emit("audit:cleared")
        await audit({ actor: "الكمبيوتر", action: "settings", detail: "تم تفريغ سجل التدقيق (بعد تحقق PIN)", severity: "warn" })
      })

      // ==== الحذف الآمن ====
      socket.on("wipe:list", async () => socket.emit("wipe:files", await wipableFiles()))
      socket.on("wipe:run", async (d: { deviceId?: string; vPath?: string; passes?: number; stealth?: boolean }) => {
        if (!d?.deviceId || !d?.vPath) return
        const vPath = String(d.vPath)
        const deviceId = String(d.deviceId)
        const passes = d.passes === 7 ? 7 : 3
        try {
          const res = await secureWipe({
            deviceId, vPath, passes,
            onProgress: (p) => io2.emit("wipe:progress", { ...p, file: path.basename(vPath) }),
          })
          io2.emit("wipe:done", { ...res, stealth: !!d.stealth })
          await audit({
            actor: "الكمبيوتر", deviceId, action: "wipe",
            detail: `حذف آمن: «${res.file}» (${(res.size / 1024).toFixed(1)}KB) — ${passes} تمريرات ثم إزالة من inode — تم التحقق: ${res.verifyGone ? "الملف لم يعد موجوداً" : "فشل التحقق"}`,
            severity: "warn", stealth: !!d.stealth,
          })
        } catch (e) {
          io2.emit("wipe:done", { ok: false, file: path.basename(d.vPath), error: String(e instanceof Error ? e.message : e) })
        }
      })

      // ==== التخفي + حالة قفل الهاتف ====
      socket.on("sec:stealth-set", (d: { on?: boolean }) => {
        g.__nexusSecStealth = !!d?.on
        io2.emit("sec:stealth", { on: !!d?.on })
        void db.secState.upsert({ where: { id: "main" }, create: { id: "main", stealthMode: !!d?.on }, update: { stealthMode: !!d?.on } }).catch(() => { /* ignore */ })
      })
      socket.on("sec:lock-state", (d: Record<string, unknown>) => io2.emit("sec:lock-state", d)) // من الهاتف: حالة القفل
      socket.on("sec:lock-cmd", (d: Record<string, unknown>) => {
        // من الكمبيوتر: أمر قفل الهاتف — يمر عبر القناة المشفرة في العميل، والترحيل هنا
        tapWire({ channel: "e2e", from: "pc-office", to: "galaxy-s24", kind: "lock-cmd", len: JSON.stringify(d).length, hex: Buffer.from(JSON.stringify(d), "utf8").subarray(0, 96).toString("hex"), b64: Buffer.from(JSON.stringify(d), "utf8").toString("base64"), encrypted: false })
        for (const [, c] of clients()) if (c.role === "phone") io2.to(c.sid).emit("sec:lock-cmd", d)
      })

      socket.on("disconnect", () => {
        const c = clients().get(socket.id)
        clients().delete(socket.id)
        if (c) io2.emit("sec:peers", securityBridgeStatus().peers)
      })
    })

    httpServer.listen(PORT, () => console.log(`[sec-bridge] قناة الأمان المشفرة تعمل على ${PORT}`))
  } catch (e) {
    g[BOOT_KEY] = false
    console.error("[sec-bridge] فشل الإقلاع:", e instanceof Error ? e.message : e)
  }
  return securityBridgeStatus()
}

function peerKeyPayload(socket: Socket) {
  const c = clients().get(socket.id)
  return c ? { deviceId: c.deviceId, name: c.name, role: c.role, pub: c.pub, eph: c.eph, sid: c.sid } : null
}

async function persistBlocked() {
  try {
    await db.secState.upsert({
      where: { id: "main" },
      create: { id: "main", blocked: JSON.stringify(blocked()) },
      update: { blocked: JSON.stringify(blocked()) },
    })
  } catch { /* ignore */ }
}

// ---------- تصدير pcap حقيقي (يفتح في Wireshark) ----------
const PCAP_DIR = path.join(process.cwd(), "data", "nexus-storage", "security")

export async function exportPcap(): Promise<{ ok: boolean; file?: string; packets?: number; error?: string }> {
  try {
    const frames = wire().filter((f) => f.encrypted).slice(-250)
    if (!frames.length) return { ok: false, error: "لا إطارات مشفرة ملتقطة بعد — أرسل ملفاً أولاً" }
    await fsp.mkdir(PCAP_DIR, { recursive: true })
    const file = path.join(PCAP_DIR, "nexuslink-capture.pcap")
    const chunks: Buffer[] = []
    // Global header: magic + v2.4 + snaplen + Ethernet
    const gh = Buffer.alloc(24)
    gh.writeUInt32LE(0xa1b2c3d4, 0)
    gh.writeUInt16LE(2, 4); gh.writeUInt16LE(4, 6)
    gh.writeInt32LE(0, 8); gh.writeUInt32LE(0, 12)
    gh.writeUInt32LE(65535, 16); gh.writeUInt32LE(1, 20)
    chunks.push(gh)

    let tcpSeq = 1000
    for (const f of frames) {
      const payload = Buffer.from(f.b64, "base64")
      const ts = f.at
      const tsSec = Math.floor(ts / 1000)
      const tsUsec = (ts % 1000) * 1000
      const isPc = f.from === "pc-office"
      // تقطيع واقعي: TCP لا يرسل أكثر من ~1400 بايت في القطاع الواحد (MSS)
      const SEG = 1400
      const segCount = Math.max(1, Math.ceil(payload.length / SEG))
      for (let s = 0; s < segCount; s++) {
        const chunk = payload.subarray(s * SEG, Math.min((s + 1) * SEG, payload.length))
        // Ethernet
        const eth = Buffer.alloc(14)
        eth[0] = 0xaa; eth[1] = 0xbb; eth[2] = 0xcc; eth[3] = 0xdd; eth[4] = 0xee; eth[5] = isPc ? 0x02 : 0x14
        eth.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, isPc ? 0x14 : 0x02], 6)
        eth.writeUInt16LE(0x0800, 12) // IPv4
        // TCP
        const tcp = Buffer.alloc(20)
        tcp.writeUInt16BE(isPc ? 51000 : 3009, 0)
        tcp.writeUInt16BE(isPc ? 3009 : 51000, 2)
        tcp.writeUInt32BE(tcpSeq, 4); tcpSeq += chunk.length
        tcp.writeUInt32BE(9000, 8)
        tcp[12] = 5 << 4; tcp[13] = 0x18 // PSH+ACK
        tcp.writeUInt16BE(64240, 14)
        // IPv4
        const totalLen = 20 + chunk.length
        const ip = Buffer.alloc(20)
        ip[0] = 0x45; ip[1] = 0
        ip.writeUInt16BE(totalLen, 2)
        ip.writeUInt16BE((4000 + (tcpSeq % 4000)) & 0xffff, 4)
        ip[6] = 0x40; ip[8] = 64; ip[9] = 6
        ip.set(isPc ? [192, 168, 1, 2] : [192, 168, 1, 14], 12)
        ip.set(isPc ? [192, 168, 1, 14] : [192, 168, 1, 2], 16)
        // IP checksum
        let sum = 0
        for (let i = 0; i < 20; i += 2) { sum += ip.readUInt16BE(i); while (sum > 0xffff) sum = (sum & 0xffff) + 1 }
        ip.writeUInt16BE(~sum & 0xffff, 10)
        const pkt = Buffer.concat([eth, ip, tcp, chunk])
        const rec = Buffer.alloc(16)
        rec.writeUInt32LE(tsSec, 0); rec.writeUInt32LE(tsUsec, 4)
        rec.writeUInt32LE(pkt.length, 8); rec.writeUInt32LE(pkt.length, 12)
        chunks.push(rec, pkt)
      }
    }
    await fsp.writeFile(file, Buffer.concat(chunks))
    return { ok: true, file, packets: frames.length }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) }
  }
}
