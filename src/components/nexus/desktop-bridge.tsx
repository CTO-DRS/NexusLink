"use client"
// NexusLink — جسر سطح المكتب (يعمل داخل نافذة Tauri فقط)
// ============================================================
// حارس واحد لكل ما يخص وضع سطح المكتب في الواجهة المشتركة:
// 1) كتم إشعارات المتصفح (Notification API) — الطبقة الأصلية في Rust تتولى
//    إشعارات النظام بأزرارها التفاعلية (متطلب تعاقدي: «بدل إشعارات المتصفح»).
// 2) مزامنة اختصارات سطح المكتب: نفس المخزن (zustand/localStorage) يُدفع إلى
//    /api/desktop/shortcuts عند كل تغيير — وRust يستطلعه ويُسجّله عالميًا.
// 3) تنفيذ داخل التطبيق لإجراء sendClipboard (عند تركيز النافذة، حيث الاختصار
//    العالمي غير مسجّل عمدًا — راجع تعاقد التركيز في shortcuts.rs).
// 4) تفسير معاملات ?view= القادمة من deep-link/الإشعارات الأصلية.
// كل ذلك معطّل خارج وضع سطح المكتب (?desktop=1 — تضبطه procman عند فتح النافذة).
import { useEffect } from "react"
import { getProdSocket } from "@/lib/prod-socket"
import { useProd } from "@/lib/prod-store"
import { useNexus, type ShortcutAction, type ViewId } from "@/lib/store"
import { tauriInvoke } from "@/lib/tauri"

const DESKTOP_DEFAULTS: Partial<Record<ShortcutAction, string>> = {
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

export function DesktopBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return
    const sp = new URLSearchParams(window.location.search)
    if (!sp.has("desktop")) return // متصفح/هاتف — لا شيء يخص سطح المكتب هنا

    // 0) علم وضع سطح المكتب — تقرأه بقية الطبقات (use-prod-bridge: Rust يملك الحافظة)
    ;(window as unknown as { __NEXUS_DESKTOP__?: boolean }).__NEXUS_DESKTOP__ = true

    // 1) كتم إشعارات المتصفح داخل الويبفيو (المصدر الأصلي يتولاه Rust)
    try {
      Object.defineProperty(window, "Notification", { value: undefined, configurable: true })
    } catch {
      /* بيئة لا تسمح — تُتجاهل بهدوء */
    }

    // 2) مزامنة خريطة الاختصارات إلى السيرفر (المخزن نفسه — صفر تكرار حقيقة)
    const putShortcuts = (map: Record<string, string>) => {
      const payload: Record<string, string> = { ...DESKTOP_DEFAULTS }
      for (const [k, v] of Object.entries(DESKTOP_DEFAULTS)) {
        if (map[k]) payload[k] = map[k]
      }
      void fetch("/api/desktop/shortcuts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcuts: payload }),
      }).catch(() => null)
    }
    putShortcuts(useNexus.getState().shortcuts)
    const unsub = useNexus.subscribe((state, prev) => {
      if (state.shortcuts !== prev.shortcuts) putShortcuts(state.shortcuts)
    })

    // 3) داخل التركيز: تنفيذ sendClipboard محليًا (السلوك العالمي غير مسجّل حينها)
    const comboOf = (e: KeyboardEvent): string => {
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
      if (e.altKey) parts.push("Alt")
      if (e.shiftKey) parts.push("Shift")
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (k && k !== "Control" && k !== "Shift" && k !== "Alt" && k !== "Meta") parts.push(k)
      return parts.join("+")
    }
    const sendClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text?.trim()) return
        const r = await fetch("/api/prod/clipboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: "pc-office",
            deviceName: "هذا الكمبيوتر",
            kind: "text",
            content: text,
            mode: "auto",
          }),
        })
        if (!r.ok) throw new Error(String(r.status))
      } catch {
        /* الحافظة مرفوضة/فارغة — هدوء (المسار العالمي هو التعاقدي) */
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const sc = useNexus.getState().shortcuts
      const combo = comboOf(e)
      // الإجراء الجديد مُنمذج في المخزن المشترك — الافتراضي احتياط لو استخدم عميل قديم
      const target = sc.sendClipboard ?? DESKTOP_DEFAULTS.sendClipboard
      if (combo && combo === target) void sendClipboard()
    }
    window.addEventListener("keydown", onKey)

    // 4) ?view= — تنقل تعمّق الروابط/الإشعارات الأصلية إلى شاشة محددة
    const v = sp.get("view")
    if (v) {
      const views: ViewId[] = [
        "devices", "files", "transfers", "storage", "comms", "simulator",
        "remote", "media", "guard", "prod", "security", "tools", "settings",
      ]
      if (views.includes(v as ViewId)) useNexus.getState().setView(v as ViewId)
    }

    // 4) FA-clipboard-sync — استقبال حافظة الهاتف → حافظة النظام (عقد §11.ب):
    //    clip:new من جهاز غريب + وضع تلقائي → clip_apply (arboard) — يعمل والنافذة
    //    مخفية في الـ Tray. حرس الصدى: deviceId === pc-office يُتجاهل (إرسالنا نحن).
    //    إعادة الاشتراك عند تغيّر وضع الحافظة (التبديل في واجهة الإنتاجية).
    const applyIncoming = (item: { deviceId?: string; kind?: string; content?: string }) => {
      if (!item || item.deviceId === "pc-office") return
      const clipAllowed = useProd.getState().state.clipMode === "auto"
      if (!clipAllowed) return
      if (item.kind === "text" && item.content) {
        void tauriInvoke("clip_apply", { kind: "text", content: item.content }).catch(() => null)
      } else if (item.kind === "image" && item.content?.startsWith("data:image/png;base64,")) {
        void tauriInvoke("clip_apply", { kind: "image", content: item.content }).catch(() => null)
      }
    }
    const sock = getProdSocket()
    sock.on("clip:new", applyIncoming)

    return () => {
      unsub()
      window.removeEventListener("keydown", onKey)
      sock.off("clip:new", applyIncoming)
    }
  }, [])

  return null
}
