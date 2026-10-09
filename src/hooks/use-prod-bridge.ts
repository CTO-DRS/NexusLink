"use client"
// NexusLink — خطاف جهة الكمبيوتر لطبقة الإنتاجية (المرحلة 9)
// الحافظة الموحدة (كتابة حافظة النظام تلقائياً) · التسليم · المزامنة · الشبكات
import { useEffect } from "react"
import { toast } from "sonner"
import { useProd } from "@/lib/prod-store"
import { getProdSocket } from "@/lib/prod-socket"

const LS_CLIP_MODE = "nexus-clip-mode"

/** آخر نص وصل من جهاز آخر — يستخدم لاختبار Ctrl+V المباشر */
export function lastPhoneText(): string {
  const clip = useProd.getState().clips.find((c) => c.kind === "text" && c.deviceId !== "pc-office")
  return clip?.content ?? ""
}

export function useProdBridge() {
  useEffect(() => {
    fetch("/api/prod/boot").catch(() => { /* ignore */ })
    const socket = getProdSocket()
    const st = () => useProd.getState()

    const refreshAll = async () => {
      try {
        const [clipsR, pairsR, handR, profR, photosR, snapR] = await Promise.all([
          fetch("/api/prod/clipboard").then((r) => r.json()),
          fetch("/api/prod/pairs").then((r) => r.json()),
          fetch("/api/prod/handoff").then((r) => r.json()),
          fetch("/api/prod/network").then((r) => r.json()),
          fetch("/api/prod/photos").then((r) => r.json()),
          fetch("/api/prod/backup").then((r) => r.json()),
        ])
        if (clipsR.items) st().setClips(clipsR.items)
        if (pairsR.pairs) st().setPairs(pairsR.pairs)
        if (handR.items) st().setHandoff(handR.items)
        if (profR.profiles) st().setProfiles(profR.profiles)
        if (profR.network) {
          st().setState({ network: profR.network, activeProfileId: profR.profile?.id ?? null, notifsPaused: profR.state?.notifsPaused ?? false, clipMode: profR.state?.clipMode ?? "auto", photoSync: profR.state?.photoSync ?? true, photoTarget: profR.state?.photoTarget ?? "/Pictures/FromPhone" })
          st().setProfile(profR.profile ?? null)
        }
        if (photosR.photos) st().setPhotos(photosR.photos)
        if (snapR.snapshots) st().setSnapshots(snapR.snapshots)
      } catch { /* ignore */ }
    }

    socket.on("connect", () => {
      st().setBridgeOnline(true)
      // استعادة وضع الحافظة المحفوظ ثم سحب كل البيانات (داخل callback لتفادي setState-in-effect)
      try {
        const saved = localStorage.getItem(LS_CLIP_MODE)
        if (saved === "manual" || saved === "auto") st().setState({ clipMode: saved })
      } catch { /* ignore */ }
      void refreshAll()
    })
    socket.on("disconnect", () => st().setBridgeOnline(false))

    // ==== الحافظة الموحدة — القلب ====
    socket.on("clip:new", (item: import("@/lib/prod-store").ProdClipItem) => {
      st().addClip(item)
      const mine = item.deviceId === "pc-office"
      if (mine) return

      if (item.kind === "text") {
        st().setCheck("copy")
        const auto = st().state.clipMode === "auto"
        const clipAllowed = st().profile ? st().profile.clipboard : true
        if (auto && clipAllowed) {
          // النص يدخل حافظة النظام فعلياً — Ctrl+V يعمل في أي مكان
          navigator.clipboard.writeText(item.content).then(
            () => {
              st().setSysClipboardArmed(true)
              toast("نسخة من هاتفك جاهزة — اضغط Ctrl+V الآن", {
                description: `من ${item.deviceName} · وُضع النص في حافظة النظام تلقائياً (وضع تلقائي)`,
              })
            },
            () => {
              st().setSysClipboardArmed(false)
              toast(`وصل نص من ${item.deviceName}`, {
                description: "وضع تلقائي — المتصفح منع الكتابة المباشرة، الصقه من منطقة اللصق بالأسفل",
              })
            },
          )
        } else if (clipAllowed) {
          toast(`وصل نص من ${item.deviceName}`, { description: "الوضع اليدوي — افتح الإنتاجية والصقه بزر واحد" })
        }
      } else if (item.kind === "image") {
        toast(`وصلت صورة من ${item.deviceName}`, { description: "معاينتها في الحافظة الموحدة" })
      } else if (item.kind === "file") {
        toast(`ملف من ${item.deviceName}: ${item.fileName ?? ""}`, { description: "استلمه بنسخ حقيقي إلى تنزيلات الكمبيوتر" })
      }
    })

    socket.on("clip:cleared", () => st().setClips([]))

    socket.on("clip:received", (d: { name?: string; bytes?: number }) => {
      st().pushLog(`استُلم الملف ${d?.name ?? ""} في تنزيلات الكمبيوتر (نسخ حقيقي ${Math.round((d?.bytes ?? 0) / 1024)}KB)`, "ok")
      toast(`استُلم الملف: ${d?.name ?? ""}`, { description: "حُفظ في /Downloads على الكمبيوتر" })
      fetch("/api/prod/clipboard").then((r) => r.json()).then((j) => j.items && st().setClips(j.items)).catch(() => {})
    })

    // ==== التسليم ====
    socket.on("hand:new", (item: import("@/lib/prod-store").HandoffItemT) => {
      const exists = st().handoff.some((h) => h.id === item.id)
      if (!exists) st().setHandoff([item, ...st().handoff])
      if (item.deviceId !== "pc-office") {
        toast(`أكمل من حيث توقفت — ${item.deviceName}`, {
          description: item.kind === "video" ? `${item.title} (من الدقيقة ${Math.floor(item.position / 60)}:${String(item.position % 60).padStart(2, "0")})` : item.title,
        })
      }
    })

    socket.on("hand:opened", (d: { id?: string; openedOn?: string }) => {
      if (d?.id) st().patchHandoff(d.id, { status: "opened", openedOn: d.openedOn ?? null })
    })

    // ==== الصور ====
    socket.on("photo:new", (d: { name?: string }) => {
      toast("صورة جديدة على الهاتف", { description: `${d?.name ?? ""} — المزامنة التلقائية ستنسخها خلال ثوانٍ` })
    })
    socket.on("photo:synced", (d: { name?: string; bytes?: number; target?: string }) => {
      st().setCheck("photo")
      st().pushLog(`نُسخت تلقائياً: ${d?.name ?? ""} → ${d?.target ?? ""} على الكمبيوتر`, "ok")
      fetch("/api/prod/photos").then((r) => r.json()).then((j) => j.photos && st().setPhotos(j.photos)).catch(() => {})
    })

    // ==== مزامنة المجلدات ====
    socket.on("sync:progress", (d: { pairId?: string; copied?: number; bytes?: number; current?: string }) => {
      if (!d?.pairId) return
      st().patchPair(d.pairId, { running: true, progress: Math.min(95, (d.copied ?? 0) * 10 + 8) })
    })
    socket.on("sync:done", (d: { pairId?: string; copied?: number; bytes?: number; skipped?: boolean; reason?: string }) => {
      if (!d?.pairId) return
      st().patchPair(d.pairId, { running: false, progress: d.copied ? 100 : 0, lastCount: d.copied ?? 0, lastBytes: d.bytes ?? 0, lastSyncAt: Date.now() })
      if (d.skipped) return
      if ((d.copied ?? 0) > 0) {
        st().setCheck("folders")
        st().pushLog(`مزامنة ثنائية: ${d.copied} ملف (${Math.round((d.bytes ?? 0) / 1024)}KB) نُسخت فعلياً`, "ok")
      }
      fetch("/api/prod/pairs").then((r) => r.json()).then((j) => j.pairs && st().setPairs(j.pairs)).catch(() => {})
    })

    // ==== الشبكة والملفات الشخصية ====
    socket.on("net:changed", (d: { network?: string; profile?: import("@/lib/prod-store").NetProfileT | null; auto?: boolean }) => {
      st().setState({ network: d.network ?? "", activeProfileId: d.profile?.id ?? null, notifsPaused: d.profile ? !d.profile.notifs : false })
      st().setProfile(d.profile ?? null)
      if (d.auto) {
        st().setCheck("profile")
        if (d.profile) {
          toast(`انتقلت إلى «${d.network}» — الملف الشخصي «${d.profile.name}» انطبق تلقائياً`, {
            description: d.profile.photoSync ? "كل الميزات مفعّلة" : "مزامنة الصور متوقفة — الإشعارات فقط",
          })
        } else {
          toast(`انتقلت إلى «${d.network}»`, { description: "لا ملف تعريف لهذه الشبكة — الوضع اليدوي" })
        }
      }
    })

    // ==== الاستعادة ====
    socket.on("prod:restored", () => {
      void refreshAll()
      toast("اكتملت الاستعادة", { description: "الإعدادات والأجهزة الموثوقة عادت كما كانت" })
    })

    // ==== السجل ====
    socket.on("prod:log", (e: { text?: string; kind?: "in" | "ok" | "info" | "warn" }) => {
      if (e?.text) st().pushLog(e.text, e.kind ?? "info")
    })

    // ==== التقاط Ctrl+V في أي مكان بالتطبيق — اختبار النجاح المباشر ====
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? ""
      if (!text) return
      const phoneText = lastPhoneText()
      if (phoneText && (text === phoneText || (text.includes(phoneText) && phoneText.length > 3))) {
        st().setCheck("paste")
        st().pushLog("لُصق نص الهاتف مباشرة بـ Ctrl+V — الحافظة الموحدة تعمل", "ok")
        toast.success("نجح الاختبار! لُصق نص هاتفك بـ Ctrl+V مباشرة")
      }
    }
    document.addEventListener("paste", onPaste)

    return () => {
      socket.off()
      document.removeEventListener("paste", onPaste)
    }
  }, [])
}

/** حفظ وضع الحافظة وتطبيقه */
export async function setClipMode(mode: "auto" | "manual") {
  useProd.getState().setState({ clipMode: mode })
  try { localStorage.setItem(LS_CLIP_MODE, mode) } catch { /* ignore */ }
  await fetch("/api/prod/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipMode: mode }),
  }).catch(() => {})
}
