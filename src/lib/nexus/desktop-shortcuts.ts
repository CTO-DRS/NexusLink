// إعدادات سطح المكتب المشتركة (سيرفر) — قراءة خريطة الاختصارات العالمية
// المصدر: data/desktop-ui.json (يُكتب عبر /api/desktop/shortcuts PUT من جسر الواجهة)
import { promises as fs } from "fs"
import path from "path"

export const DESKTOP_SHORTCUT_DEFAULTS: Record<string, string> = {
  sendClipboard: "Ctrl+Shift+N",
  toggleWindow: "Ctrl+Shift+D",
}

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
