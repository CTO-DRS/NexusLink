// NexusLink — أنواع المرحلة 6: التحكم عن بُعد (الهاتف → الكمبيوتر)
export type RcSource =
  | "touchpad" | "airmouse" | "keyboard" | "gamepad"
  | "presenter" | "media" | "system" | "clipboard"

/** FA-9: حركة المؤشر مع وضع السحب (نقر مطول) */
export interface RcMovePayload {
  dx: number
  dy: number
  source?: RcSource
  drag?: boolean
}

export type PowerState =
  | "on" | "shutting-down" | "off" | "booting"
  | "sleeping" | "hibernating" | "locked"

export type AppId = "presentation" | "media" | "notepad" | "game"

export interface RcLogEntry {
  id: string
  text: string
  kind: "in" | "ok" | "info"
  at: number
}

export interface RcClickPayload {
  button: "left" | "right"
  type: "tap" | "double"
}

export interface RcKeyPayload {
  ch?: string
  special?: "backspace" | "enter" | "space" | "up" | "down" | "left" | "right" | "esc" | "tab"
}

export interface RcGamepadPayload {
  kind: "stick" | "button"
  x?: number
  y?: number
  button?: string
  action?: string
}

/** FA-input (عقد §13): أوامر العرض — start/stop إضافة الطبقة الأصلية (F5/Esc) */
export interface RcPresenterPayload {
  action: "next" | "prev" | "black" | "laser-on" | "laser-off" | "laser-move" | "start" | "stop"
  value?: boolean
  x?: number
  y?: number
}

export interface RcMediaPayload {
  action: "toggle" | "play" | "pause" | "next" | "prev" | "volume" | "mute"
  value?: number
  target?: string
}

export interface RcPowerPayload {
  action: "shutdown" | "restart" | "sleep" | "hibernate" | "lock" | "unlock"
}

export interface RcClipboardPayload {
  direction: "toPc" | "pull"
  text?: string
}

/** FA-9: "أكمل من حيث توقفت" — رابط مشترك من الهاتف يُفتح على الكمبيوتر */
export interface RcHandoffPayload {
  url: string
  title?: string
}

/** تقرير حالة الكمبيوتر يُبَث للهواتف */
export interface DesktopStateReport {
  power: PowerState
  activeApp: AppId
  presenter: { index: number; total: number; black: boolean }
  media: {
    playing: boolean
    track: number
    trackTitle: string
    trackArtist: string
    trackLen: number
    position: number
    volume: number
    muted: boolean
    target: string
  }
  gameScore: number
  clipboardLen: number
  notepadLen: number
  at: number
}

/** FA-input (عقد §13) — دورة حياة جلسة التحكم الموثوقة */
export interface RcSessionBroadcast {
  active: boolean
  controller?: { deviceId: string | null; name: string }
  reason?: "phone-stop" | "desktop-stop" | "timeout" | "disconnected"
  at: number
}

/** معلومات الجسر عند الاتصال */
export interface RcHello {
  desktop: { name: string; mac: string; power: PowerState }
  at: number
}
