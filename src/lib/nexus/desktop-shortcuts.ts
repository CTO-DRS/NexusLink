// إعدادات سطح المكتب المشتركة (سيرفر) — قراءة خريطة الاختصارات العالمية
// المصدر: data/desktop-ui.json (يُكتب عبر /api/desktop/shortcuts PUT من جسر الواجهة)
import { promises as fs } from "fs"
import path from "path"
import { nexusDataRoot } from "./data-root"

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

// FA-power (عقد §12) — إعدادات أمان سطح المكتب (نفس المخزن desktop-ui.json)
// · autoLock: تنفيذ القفل فعليًا على الطبقة الأصلية عند pc:lock من جسر الحماية
//   (القرب/الابتعاد). الافتراضي مفعّل — يديره مفتاح «القفل التلقائي» في إعدادات الأمان.
export type DesktopSecurityCfg = { autoLock: boolean }
export const DESKTOP_SECURITY_DEFAULTS: DesktopSecurityCfg = { autoLock: true }

export function desktopUiStorePath(): string {
  return path.join(nexusDataRoot(), "desktop-ui.json")
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

/** قراءة إعدادات أمان سطح المكتب — تخطئة آمنة للقيم الغائبة/التالفة */
export async function readDesktopSecurity(): Promise<DesktopSecurityCfg> {
  try {
    const raw = await fs.readFile(desktopUiStorePath(), "utf8")
    const j = JSON.parse(raw) as { security?: Partial<DesktopSecurityCfg> }
    const s = j.security || {}
    return { autoLock: typeof s.autoLock === "boolean" ? s.autoLock : DESKTOP_SECURITY_DEFAULTS.autoLock }
  } catch {
    return { ...DESKTOP_SECURITY_DEFAULTS }
  }
}

/** دمج تحديث إعدادات الأمان فوق desktop-ui.json (يحفظ البقية كما هي) */
export async function writeDesktopSecurity(patch: Partial<DesktopSecurityCfg>): Promise<DesktopSecurityCfg> {
  const cur = await readDesktopSecurity()
  const next: DesktopSecurityCfg = {
    autoLock: typeof patch.autoLock === "boolean" ? patch.autoLock : cur.autoLock,
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
    JSON.stringify({ ...parsed, security: next, updatedAt: Date.now() }, null, 2),
    "utf8"
  )
  return next
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

// FA-files (عقد §14) — أزواج مزامنة المجلدات لسطح المكتب (نفس المخزن desktop-ui.json)
// · كل زوج: مجلد حقيقي على الكمبيوتر ↔ مجلد فرعي هاتفي (/Sync/<pairId>).
// · تقرؤها الطبقة الأصلية من status.desktop.sync وتدير مراقبي notify الأصليين.
export interface DesktopSyncPair {
  id: string
  name: string
  localDir: string
  phoneDir: string // دائماً /Sync/<id> — يبقى في العقد للتوسع مستقبلاً
  enabled: boolean
}
export type DesktopSyncCfg = { pairs: DesktopSyncPair[] }
export const DESKTOP_SYNC_DEFAULTS: DesktopSyncCfg = { pairs: [] }

function sanitizePairs(raw: unknown): DesktopSyncPair[] {
  if (!Array.isArray(raw)) return []
  const out: DesktopSyncPair[] = []
  for (const p of raw) {
    if (!p || typeof p !== "object") continue
    const o = p as Record<string, unknown>
    const id = String(o.id ?? "").replace(/[^a-z0-9-]+/gi, "-").slice(0, 48)
    const localDir = String(o.localDir ?? "").trim()
    if (!id || !localDir) continue
    out.push({
      id,
      name: String(o.name ?? id).slice(0, 60),
      localDir,
      phoneDir: "/Sync/" + id,
      enabled: o.enabled !== false,
    })
  }
  return out.slice(0, 12) // حد معقول — 12 زوجًا
}

/** قراءة أزواج المزامنة — تخطئة آمنة للقيم الغائبة/التالفة */
export async function readDesktopSync(): Promise<DesktopSyncCfg> {
  try {
    const raw = await fs.readFile(desktopUiStorePath(), "utf8")
    const j = JSON.parse(raw) as { sync?: Partial<DesktopSyncCfg> }
    return { pairs: sanitizePairs(j.sync?.pairs) }
  } catch {
    return { pairs: [] }
  }
}

/** كتابة أزواج المزامنة فوق desktop-ui.json (يحفظ البقية كما هي) */
export async function writeDesktopSync(patch: Partial<DesktopSyncCfg>): Promise<DesktopSyncCfg> {
  const next: DesktopSyncCfg = {
    pairs: patch.pairs !== undefined ? sanitizePairs(patch.pairs) : (await readDesktopSync()).pairs,
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
    JSON.stringify({ ...parsed, sync: next, updatedAt: Date.now() }, null, 2),
    "utf8"
  )
  return next
}

// FA-media (عقد §15) — حالة طبقة الوسائط الأصلية (نفس المخزن desktop-ui.json)
// · screen: بث شاشة الكمبيوتر إلى الهاتف (on + الجودة الحالية) — تكتبه الطبقة
//   الأصلية عبر الويبفيو عند بدء/إيقاف البث، وتقرؤه الشريط وstatus.desktop.
// · vcam: كاميرا/ميكروفون الهاتف كأجهزة افتراضية (تشغيل الفيديو/الصوت).
// · driver: حالة درايفر الويب كام المكتشف (مسار عملي لكل منصة — موثق بصدق).
export interface DesktopMediaCfg {
  screen: { on: boolean; fps: number; quality: string }
  vcam: { video: boolean; audio: boolean; driver: string }
}
export const DESKTOP_MEDIA_DEFAULTS: DesktopMediaCfg = {
  screen: { on: false, fps: 30, quality: "high" },
  vcam: { video: false, audio: false, driver: "none" },
}

const SCREEN_QUALITY_SET = new Set(["low", "medium", "high", "ultra"])
const SCREEN_FPS_SET = new Set([15, 24, 30, 45, 60])

/** قراءة حالة الوسائط — تخطئة آمنة للقيم الغائبة/التالفة */
export async function readDesktopMedia(): Promise<DesktopMediaCfg> {
  try {
    const raw = await fs.readFile(desktopUiStorePath(), "utf8")
    const j = JSON.parse(raw) as { media?: Partial<DesktopMediaCfg> }
    const m = j.media || {}
    const fps = typeof m.screen?.fps === "number" && SCREEN_FPS_SET.has(m.screen.fps) ? m.screen.fps : 30
    const quality = m.screen?.quality && SCREEN_QUALITY_SET.has(m.screen.quality) ? m.screen.quality : "high"
    const driver = typeof m.vcam?.driver === "string" ? m.vcam.driver.slice(0, 40) : "none"
    return {
      screen: { on: m.screen?.on === true, fps, quality },
      vcam: { video: m.vcam?.video === true, audio: m.vcam?.audio === true, driver },
    }
  } catch {
    return { screen: { ...DESKTOP_MEDIA_DEFAULTS.screen }, vcam: { ...DESKTOP_MEDIA_DEFAULTS.vcam } }
  }
}

/** كتابة حالة الوسائط فوق desktop-ui.json (يحفظ البقية كما هي) */
export async function writeDesktopMedia(patch: Partial<DesktopMediaCfg>): Promise<DesktopMediaCfg> {
  const cur = await readDesktopMedia()
  const fps =
    typeof patch.screen?.fps === "number" && SCREEN_FPS_SET.has(patch.screen.fps)
      ? patch.screen.fps
      : cur.screen.fps
  const quality =
    patch.screen?.quality && SCREEN_QUALITY_SET.has(patch.screen.quality) ? patch.screen.quality : cur.screen.quality
  const next: DesktopMediaCfg = {
    screen: {
      on: typeof patch.screen?.on === "boolean" ? patch.screen.on : cur.screen.on,
      fps,
      quality,
    },
    vcam: {
      video: typeof patch.vcam?.video === "boolean" ? patch.vcam.video : cur.vcam.video,
      audio: typeof patch.vcam?.audio === "boolean" ? patch.vcam.audio : cur.vcam.audio,
      driver: typeof patch.vcam?.driver === "string" ? patch.vcam.driver.slice(0, 40) : cur.vcam.driver,
    },
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
    JSON.stringify({ ...parsed, media: next, updatedAt: Date.now() }, null, 2),
    "utf8"
  )
  return next
}
