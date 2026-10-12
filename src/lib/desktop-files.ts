// FA-files (عقد §14) — جسر الواجهة للطبقة الأصلية لدمج الملفات
// ============================================================
// · استدعاء أوامر Tauri عبر withGlobalTauri (بلا حزم npm — نفس نمط desktop-bridge)
// · إظهار في Explorer/Finder (realpath من السيرفر ثم files_reveal)
// · سحب ملف من التطبيق إلى سطح المكتب (plugin:drag عبر Channel العالمية)
// · بث فيديو الهاتف (files_stream_open)

type TauriCore = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  Channel?: new <T>() => {
    onmessage: ((m: T) => void) | null
  }
}

function core(): TauriCore | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { __TAURI__?: { core?: TauriCore } }
  return w.__TAURI__?.core ?? null
}

/** هل نحن داخل نافذة Tauri؟ */
export function isDesktopShell(): boolean {
  return core()?.invoke !== undefined
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const c = core()
  if (!c?.invoke) return null
  try {
    return (await c.invoke(cmd, args)) as T
  } catch (e) {
    console.error("[desktop-files] invoke failed:", cmd, e)
    return null
  }
}

/** المسار الفعلي على القرص لإدخال افتراضي — null إن لم يكن محليًا */
export async function realPathOf(deviceId: string, vpath: string): Promise<string | null> {
  try {
    const r = await fetch(
      `/api/fs/realpath?device=${encodeURIComponent(deviceId)}&path=${encodeURIComponent(vpath)}`,
      { cache: "no-store" }
    )
    const j = (await r.json()) as { ok?: boolean; realPath?: string }
    return j?.ok && j.realPath ? j.realPath : null
  } catch {
    return null
  }
}

/** إظهار في Explorer/Finder — يعيد رسالة خطأ عربية عند الفشل */
export async function revealEntry(deviceId: string, vpath: string): Promise<string | null> {
  if (!isDesktopShell()) return "إظهار في المستكشف يعمل في تطبيق سطح المكتب فقط"
  const real = await realPathOf(deviceId, vpath)
  if (!real) return "هذا الإدخال ليس ملفًا حقيقيًا على الكمبيوتر"
  const j = await tauriInvoke<{ ok?: boolean; error?: string }>("files_reveal", { path: real })
  if (j?.ok) return null
  return j?.error || "تعذر فتح مدير الملفات"
}

// أيقونة السحب — PNG صغير مضمّن (نفس الهوية البصرية)
const DRAG_ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAX0lEQVR4nO3XwQ2AMAwF0LcJmMAJmMAJmMAJmMAJmMAJmMAJmMAJmEDS0m3rtbtI2vXj+51TAADgj7Z2AwAATlUpPbO1GwAA8M+tXQEAgJvV2g0AALj0GgDAx0cCAIATNwAA+DkCAID8EkgAALiwVAIAwIlbAgD4LQIAgPySSAAAuHBbAgDAiVsCAPgtAgCA/JJIAAC4sFQCAMCJWwIA+C0CAID8kkgAALiwVAIAwIlbAgD4LQIAgPySSAAAePFTkwBw1Vb6AAAAAElFTkSuQmCC"

/** بدء سحب خارجي (drag-out) لملفات حقيقية من التطبيق إلى سطح المكتب.
 * paths = مسارات حقيقية على القرص (من realpath). */
export async function startDragOut(paths: string[]): Promise<boolean> {
  const c = core()
  if (!c?.invoke || !c.Channel) return false
  if (!paths.length) return false
  try {
    const ch = new (c.Channel as new <T>() => { onmessage: ((m: T) => void) | null })<unknown>()
    ch.onmessage = () => {}
    await c.invoke("plugin:drag|start_drag", {
      item: paths,
      image: DRAG_ICON_B64,
      options: { mode: "copy" },
      onEvent: ch,
    })
    return true
  } catch (e) {
    console.error("[desktop-files] drag-out failed:", e)
    return false
  }
}

/** سحب إدخال من متصفح الملفات — يجلب المسار الحقيقي أولًا */
export async function dragOutEntry(deviceId: string, vpath: string): Promise<boolean> {
  const real = await realPathOf(deviceId, vpath)
  if (!real) return false
  return startDragOut([real])
}

/** معلومات وسائط الهاتف من الحالة الموحدة */
export interface AgentMedia {
  deviceId: string | null
  lanIp: string
  port: number
  token: string
  at: number
}

export async function fetchAgentMedia(): Promise<AgentMedia | null> {
  try {
    const r = await fetch("/api/desktop/status", { cache: "no-store" })
    const j = (await r.json()) as { desktop?: { agentMedia?: AgentMedia | null } }
    const m = j?.desktop?.agentMedia
    return m && m.lanIp && m.port && m.token ? m : null
  } catch {
    return null
  }
}

/** بدء بث فيديو هاتف → مشغل الكمبيوتر الافتراضي (تنزيل تقدمي مؤقت + فتح عند العتبة) */
export async function streamPhoneVideo(
  media: AgentMedia,
  path: string,
  fileName: string,
  size: number
): Promise<string | null> {
  if (!isDesktopShell()) return "البث يعمل في تطبيق سطح المكتب فقط"
  const url = `http://${media.lanIp}:${media.port}/stream?token=${encodeURIComponent(media.token)}&path=${encodeURIComponent(path)}`
  const j = await tauriInvoke<{ ok?: boolean; streamId?: number; error?: string }>("files_stream_open", {
    url,
    fileName,
    size,
  })
  if (j?.ok) return null
  return j?.error || "تعذر بدء البث"
}

export async function cancelPhoneStream(streamId: number): Promise<void> {
  await tauriInvoke("files_stream_cancel", { streamId })
}

/** اختيار مجلد أصلي (نافذة النظام) — null خارج Tauri أو عند الإلغاء */
export async function pickFolder(): Promise<string | null> {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    __TAURI__?: { dialog?: { open?: (o: Record<string, unknown>) => Promise<string | string[] | null> } }
  }
  const d = w.__TAURI__?.dialog
  if (!d?.open) return null
  try {
    const r = await d.open({ directory: true, multiple: false, title: "اختر مجلد المزامنة" })
    return typeof r === "string" && r.trim() ? r.trim() : null
  } catch {
    return null
  }
}

/** حالة قائمة الزر الأيمن (عقد §14) — للتشخيص في الإعدادات */
export async function contextMenuStatus(): Promise<string | null> {
  const j = await tauriInvoke<{ ok?: boolean; status?: string }>("files_context_menu", { action: "status" })
  return j?.status ?? null
}
