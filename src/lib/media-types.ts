// NexusLink — أنواع المرحلة 7: طبقة الوسائط والكاميرا
// كاميرا الهاتف كويب كام · مراقبة · مراقبة الأطفال · ميكروفون · بث · معرض

export type MediaDeviceId = "galaxy-s24" | "redmi-note13" | "pc-office" | "nexus-tv"

export type ScreenTarget = "pc" | "tv"

export type Facing = "back" | "front"

/** حالة مصدر كاميرا (لكل جهاز لديه كاميرا) */
export interface CamSourceState {
  active: boolean
  facing: Facing
  /** هل البث من عتاد حقيقي أم مشهد محاكى (بيئة بلا كاميرا) */
  real: boolean
  label: string
  torch: boolean
  torchSupported: boolean
}

/** حالة مصدر ميكروفون */
export interface MicSourceState {
  active: boolean
  real: boolean
  label: string
}

export type LinkStatus = "idle" | "linking" | "live" | "error"

/** حالة وصلة بث (كويب كام / شاشة عرض) */
export interface LinkState {
  status: LinkStatus
  mode: "webrtc" | "direct" | null
  startedAt: number | null
  quality: string
  fps: number
}

export type MediaAlertKind = "motion" | "cry" | "capture" | "system"

export interface MediaAlert {
  id: string
  at: number
  kind: MediaAlertKind
  text: string
  level?: number
  snapshot?: string // مسار افتراضي للقطة المحفوظة
}

export interface MediaLogEntry {
  id: string
  at: number
  text: string
  kind: "in" | "ok" | "info" | "warn"
}

export interface CastMediaItem {
  id: string
  device: MediaDeviceId
  path: string
  name: string
  kind: "video" | "audio"
  size: number
}

export interface CastSession {
  media: CastMediaItem
  target: ScreenTarget
  sender: string
  playing: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  startedAt: number
}

export interface GalleryPhoto {
  id: string
  device: MediaDeviceId
  path: string
  name: string
  mtime: number
  size: number
  /** تاريخ التقاط محلي (للقطات الجديدة) */
  capturedAt?: number
}

export interface SlideshowState {
  target: ScreenTarget
  playing: boolean
  index: number
  interval: number
  shuffle: boolean
  order: number[]
}

/** حالة تطبيق مكالمة الفيديو على الكمبيوتر (اختبار النجاح) */
export interface VideoCallState {
  inCall: boolean
  contact: string
  startedAt: number | null
  micMuted: boolean
  camSource: string | null
}

/** تقرير حالة كاميرا عبر الجسر (هاتف حقيقي ↔ كمبيوتر) */
export interface CamStatePayload {
  deviceId: string
  active: boolean
  facing: Facing
  real: boolean
  label?: string
}

/** مفاتيح اختبار النجاح للمرحلة 7 */
export type MediaCheckKey =
  | "webcam"      // كاميرا الهاتف تعمل كويب كام للكمبيوتر
  | "call"        // مكالمة فيديو على الكمبيوتر تستخدم كاميرا الهاتف
  | "controls"    // تبديل أمامية/خلفية + فلاش + مؤقت تصوير عن بُعد
  | "security"    // وضع المراقبة: بث + تنبيه عند حركة
  | "baby"        // مراقبة الأطفال: بث صوت دائم من هاتف إلى آخر
  | "mic"         // الهاتف كميكروفون لاسلكي للكمبيوتر
  | "cast"        // بث موسيقى/فيديو بدون نسخ
  | "gallery"     // تصفح المعرض + عرض شرائح على الشاشة الكبيرة
