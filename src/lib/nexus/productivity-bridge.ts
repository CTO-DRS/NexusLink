// NexusLink — جسر الإنتاجية (المرحلة 9) — يعمل داخل عملية Next.js
// ============================================================
// الحافظة الموحدة · تسليم الروابط (أكمل من حيث توقفت) · مزامنة الصور
// · ملفات تعريف الشبكة — منفذ 3007 · نفس نمط guard-bridge (idempotent).
import { createServer } from "http"
import { Server as SocketServer } from "socket.io"
import { db } from "@/lib/db"
import { runPairSync, photoSyncTick, generatePhonePhoto, syncDeviceName } from "./sync-engine"
import { emitAutomationFact } from "./automation-facts"
import { socketCors } from "./socket-security" // SEC (M0.3 F4)

const PORT = 3007

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

function log(io2: SocketServer, text: string, kind: "in" | "ok" | "info" | "warn" = "info") {
  io2.emit("prod:log", { id: uid(), text, kind, at: Date.now() })
}

const g = globalThis as unknown as { __nexusProdBooted?: boolean }
const BOOT_KEY = "__nexusProdBooted"

let io: SocketServer | null = null

export function getProdIo(): SocketServer | null {
  return io
}

export function prodEmit(event: string, payload: Record<string, unknown>) {
  try {
    io?.emit(event, payload)
  } catch { /* ignore */ }
}

export function prodBridgeStatus() {
  return { booted: !!g[BOOT_KEY], port: PORT }
}

export function ensureProdBridge() {
  if (g[BOOT_KEY]) return prodBridgeStatus()
  g[BOOT_KEY] = true

  try {
    const httpServer = createServer()
    const io2 = new SocketServer(httpServer, {
      path: "/",
      cors: socketCors(), // SEC (M0.3 F4): بديل السماح المفتوح — Origin خارجي يُرفض عند المصافحة
      pingTimeout: 60000,
      pingInterval: 25000,
    })
    io = io2

    io2.on("connection", (socket) => {
      socket.emit("prod:hello", { at: Date.now() })

      // ==== الحافظة الموحدة ====
      socket.on("clip:push", async (d: {
        deviceId?: string; deviceName?: string; kind?: string
        content?: string; fileName?: string; filePath?: string; size?: number; mode?: string
      }) => {
        try {
          const item = await db.prodClip.create({
            data: {
              deviceId: d?.deviceId || "galaxy-s24",
              deviceName: d?.deviceName || syncDeviceName(d?.deviceId || "galaxy-s24"),
              kind: d?.kind || "text",
              content: (d?.content || "").slice(0, 4_000_000),
              fileName: d?.fileName || null,
              filePath: d?.filePath || null,
              size: d?.size || (d?.content?.length ?? 0),
              mode: d?.mode || "manual",
            },
          })
          const payload = { ...item, createdAt: item.createdAt.getTime() }
          io2.emit("clip:new", payload)
          // §26 — نشر الحقيقة لمحرك الروتينات (ناقل داخل العملية — بلا تغيير سلكي)
          emitAutomationFact({ kind: "clip.received", deviceId: payload.deviceId, deviceName: payload.deviceName, clipKind: payload.kind, at: Date.now() })
          log(io2, `حافظة موحدة: ${d?.kind === "image" ? "صورة" : d?.kind === "file" ? `ملف ${d?.fileName ?? ""}` : "نص"} من ${payload.deviceName}${d?.mode === "auto" ? " (تلقائي)" : ""}`, "in")
        } catch { /* ignore */ }
      })

      socket.on("clip:clear", () => {
        void db.prodClip.deleteMany({}).then(() => io2.emit("clip:cleared", { at: Date.now() }))
      })

      // ==== تسليم الروابط (أكمل من حيث توقفت) ====
      socket.on("hand:push", async (d: {
        id?: string; deviceId?: string; deviceName?: string; kind?: string
        title?: string; url?: string; position?: number
      }) => {
        try {
          let item = d?.id
            ? await db.handoffItem.findUnique({ where: { id: d.id } }).catch(() => null)
            : null
          if (!item) {
            item = await db.handoffItem.create({
              data: {
                deviceId: d?.deviceId || "galaxy-s24",
                deviceName: d?.deviceName || syncDeviceName(d?.deviceId || "galaxy-s24"),
                kind: d?.kind || "link",
                title: d?.title || d?.url || "رابط",
                url: d?.url || "",
                position: d?.position || 0,
              },
            })
          }
          io2.emit("hand:new", { ...item, createdAt: item.createdAt.getTime() })
          log(io2, `تسليم: «${item.title.slice(0, 40)}» من ${item.deviceName} — جاهز للفتح على الكمبيوتر`, "in")
        } catch { /* ignore */ }
      })

      socket.on("hand:opened", async (d: { id?: string; openedOn?: string }) => {
        if (!d?.id) return
        try {
          const item = await db.handoffItem.update({
            where: { id: d.id },
            data: { status: "opened", openedOn: d.openedOn || "PC-OFFICE", openedAt: new Date() },
          })
          io2.emit("hand:opened", { id: item.id, openedOn: item.openedOn, at: Date.now() })
          log(io2, `أُكمل على ${item.openedOn}: «${item.title.slice(0, 36)}»`, "ok")
        } catch { /* ignore */ }
      })

      // ==== الصور ====
      socket.on("photo:new-request", async () => {
        try {
          const ph = await generatePhonePhoto()
          io2.emit("photo:new", { name: ph.name, bytes: ph.bytes, device: "Galaxy-S24", at: Date.now() })
          log(io2, `صورة جديدة على الهاتف: ${ph.name} — المزامنة التلقائية ستنسخها`, "info")
          // نبضة مزامنة سريعة (واقعية: التقط ثم تزامن خلال ثوانٍ)
          setTimeout(() => {
            void photoSyncTick(emitBridge(io2)).then((r) => {
              if (r.copied > 0) {
                log(io2, `نُسخت ${r.copied} صورة تلقائياً إلى مجلد الصور على الكمبيوتر (${Math.round(r.bytes / 1024)}KB)`, "ok")
              }
            })
          }, 1800)
        } catch { /* ignore */ }
      })

      // ==== تغيير الشبكة (محاكاة انتقال بين الشبكات) ====
      socket.on("net:set", async (d: { network?: string }) => {
        if (!d?.network) return
        try {
          const st = await applyNetwork(d.network)
          io2.emit("net:changed", { network: st.network, profile: st.profile, auto: st.auto, at: Date.now() })
        } catch { /* ignore */ }
      })
    })

    httpServer.on("error", () => {
      // المنفذ مشغول (الخدمة المستقلة تعمل) — لا شيء يحدث
    })

    // ==== محرك المزامنة الدوري ====
    const emitB = emitBridge(io2)

    // أزواج المزامنة: نبضة كل 12 ثانية
    setInterval(() => {
      void (async () => {
        try {
          const state = await db.prodState.findUnique({ where: { id: "main" } })
          if (!state?.activeProfileId) return
          const prof = await db.netProfile.findUnique({ where: { id: state.activeProfileId } })
          if (prof && !prof.folderSync) return // (العمل) يوقف مزامنة المجلدات
          const pairs = await db.syncPair.findMany({ where: { active: true, autoSync: true, running: false } })
          for (const p of pairs) {
            await runPairSync(p.id, emitB)
          }
        } catch { /* ignore */ }
      })()
    }, 12_000)

    // مزامنة الصور: نبضة كل 5 ثوانٍ
    setInterval(() => {
      void photoSyncTick(emitB).then((r) => {
        if (r.copied > 0) {
          log(io2, `مزامنة الصور: ${r.names.join("، ")} → مجلد الصور على الكمبيوتر`, "ok")
        }
      }).catch(() => {})
    }, 5_000)

    httpServer.listen(PORT, () => {
      log(io2, "جسر الإنتاجية يعمل — الحافظة الموحدة والتسليم والمزامنة جاهزة", "ok")
      console.log(`[nexus] Productivity Bridge on port ${PORT}`)
    })
  } catch {
    // تجاهل — قد يكون المنفذ مشغولاً
  }
  return prodBridgeStatus()
}

function emitBridge(io2: SocketServer) {
  return (event: string, payload: Record<string, unknown>) => {
    try { io2.emit(event, payload) } catch { /* ignore */ }
  }
}

/** §26 — دفع نص إلى الحافظة الموحدة من محرك الروتينات (نفس قناة clip:new القائمة حرفيًا). */
export async function prodInjectClip(content: string, deviceName = "PC-OFFICE"): Promise<boolean> {
  try {
    const item = await db.prodClip.create({
      data: {
        deviceId: "pc-office",
        deviceName,
        kind: "text",
        content: content.slice(0, 4_000_000),
        fileName: null,
        filePath: null,
        size: content.length,
        mode: "auto",
      },
    })
    io?.emit("clip:new", { ...item, createdAt: item.createdAt.getTime() })
    return true
  } catch {
    return false
  }
}

/** تطبيق الشبكة: إيجاد الملف الشخصي المطابق وتنشيطه (أو إلغاء التنشيط) */
export async function applyNetwork(network: string) {
  const prev = await db.prodState.findUnique({ where: { id: "main" } })
  const prof = await db.netProfile.findFirst({ where: { networkName: network } })
  const state = await db.prodState.update({
    where: { id: "main" },
    data: {
      network,
      activeProfileId: prof?.id ?? null,
      notifsPaused: prof ? !prof.notifs : false,
      // مزامنة الصور اليدوية تُعطّل بملف العمل — المزامنة الفعلية تفحص الملف بنفسها
    },
  })
  const auto = !!prev && prev.network !== network
  const logText = prof
    ? `الشبكة «${network}» ← الملف الشخصي «${prof.name}» ${auto ? "انطبق تلقائياً" : "مفعّل"}`
    : `الشبكة «${network}» — لا ملف تعريف مطابق (الوضع اليدوي)`
  if (io && auto) log(io, logText, prof ? "ok" : "warn")
  return { network: state.network, profile: prof, auto }
}
