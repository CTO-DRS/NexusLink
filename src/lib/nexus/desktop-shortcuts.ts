// إعدادات سطح المكتب المشتركة (سيرفر) — قراءة خريطة الاختصارات العالمية
// المصدر: data/desktop-ui.json (يُكتب عبر /api/desktop/shortcuts PUT من جسر الواجهة)
import { promises as fs } from "fs"
import path from "path"

export const DESKTOP_SHORTCUT_DEFAULTS: Record<string, string> = {
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

// FA-clipboard-sync — إعدادات مراقب الحافظة الحية (نفس المخزن desktop-ui.json)
// · mode: auto | manual — لكن المصدر التعاقدي للوضع هو db.prodState.clipMode
//   (يديره زر التبديل في واجهة الإنتاجية عبر PATCH /api/prod/state).
// · maxAutoBytes: حد حجم الإرسال التلقائي للنص من حافظة الكمبيوتر (1KB..20MB).
export type DesktopClipCfg = { mode: "auto" | "manual"; maxAutoBytes: number }
export const DESKTOP_CLIP_DEFAULTS: DesktopClipCfg = { mode: "auto", maxAutoBytes: 1_048_576 }

export function desktopUiStorePath(): string {
  return path.join(process.cwd(), "data", "desktop-ui.json")
}

export async function readShortcuts(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(desktopUiStorePath(), "utf8")
    const j = JSON.parse(raw) as { shortcuts?: Record<string, string> }
    return { ...DESKTOP_SHORTCUT_DEFAULTS, ...(j.shortcuts || {}) }
  } catch {
    return { ...DESKTOP_SHORTCUT_DEFAULTS }
  }
}

/** قراءة إعدادات مراقب الحافظة — تخطئة آمنة للقيم الغائبة/التالفة */
export async function readDesktopClip(): Promise<DesktopClipCfg> {
  try {
    const raw = await fs.readFile(desktopUiStorePath(), "utf8")
    const j = JSON.parse(raw) as { clip?: Partial<DesktopClipCfg> }
    const c = j.clip || {}
    const mode: "auto" | "manual" = c.mode === "manual" ? "manual" : "auto"
    const max = typeof c.maxAutoBytes === "number" && c.maxAutoBytes >= 1024 && c.maxAutoBytes <= 20_971_520
      ? Math.floor(c.maxAutoBytes)
      : DESKTOP_CLIP_DEFAULTS.maxAutoBytes
    return { mode, maxAutoBytes: max }
  } catch {
    return { ...DESKTOP_CLIP_DEFAULTS }
  }
}

/** دمج تحديث إعدادات الحافظة فوق desktop-ui.json (يحفظ الاختصارات كما هي) */
export async function writeDesktopClip(patch: Partial<DesktopClipCfg>): Promise<DesktopClipCfg> {
  const cur = await readDesktopClip()
  const next: DesktopClipCfg = {
    mode: patch.mode === "manual" ? "manual" : patch.mode === "auto" ? "auto" : cur.mode,
    maxAutoBytes:
      typeof patch.maxAutoBytes === "number" && patch.maxAutoBytes >= 1024 && patch.maxAutoBytes <= 20_971_520
        ? Math.floor(patch.maxAutoBytes)
        : cur.maxAutoBytes,
  }
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(await fs.readFile(desktopUiStorePath(), "utf8")) as Record<string, unknown>
  } catch {
    /* ملف غير موجود/تالف — نبدأ نظيفًا */
  }
  await fs.mkdir(path.dirname(desktopUiStorePath()), { recursive: true })
  await fs.writeFile(
    desktopUiStorePath(),
    JSON.stringify({ ...parsed, clip: next, updatedAt: Date.now() }, null, 2),
    "utf8"
  )
  return next
}
