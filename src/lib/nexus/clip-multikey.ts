// عقد §59 — خزنة الحافظة للأجهزة المتعددة (CLIP-MULTI-KEY) — النواة النقية
// ============================================================
// إغلاق الحد المعلن من §58 حرفيًا: «خزنة §50 للأجهزة المتعددة (مفتاح لكل
// جهاز بدل مفتاح الجهاز الواحد)» — كل جهاز يقفصه بمفتاحه الخاص:
// حافظة الهاتف تُختم بمفتاح الهاتف وحافظة الكمبيوتر بمفتاح الكمبيوتر —
// فتسريب مفتاح جهاز (أو صفوفه) لا يفتح بايتًا واحدًا من بقية الأجهزة.
//
// مقابل المنافسين مباشرة:
//  - Win+V / سجل حافظة النظام: مخزن واحد بنص عاري بلا عزل بين المصادر.
//  - Pushbullet/KDE: المحتوى عند وسيط بحساب واحد — هنا عزل مفاتيح محلي
//    لكل مصدر بلا حساب ولا وسيط (الخندق #1: الخصوصية المعمارية).
//
// القرارات المعمارية (موثقة):
//  - kid مشتق حتميًا من المفتاح (sha256 أول 16 hex) — لا تخزين منفصل له
//    فلا تضاد ممكنة، ويُعلن داخل المغلف بلا كشف المفتاح (نمط بصمة §35/§54).
//  - مفتاح الجهاز DesktopSetting ‹clip.at-rest-key:<deviceId› صفر-مخطط
//    (نمط §34.ب/§54/§57/§58) — لا يعود في أي API ولا يُعرض أبدًا.
//  - المفتاح الموحد القديم (§58) يبقى مفتاح الترحيل: مغلفات v1 بلا kid
//    تفتح به حتى إعادة الختم (ترحيل صامت/ختم السجل/تدوير) — لا إجبار ولا فقدان.
//  - deviceId الشارد (خارج [A-Za-z0-9._-] أو فوق 64) يرجع للمفتاح الموحد —
//    سلوك معلن يحمي مساحة مفاتيح الإعدادات من الحقن.
//
// حدود صادقة (§59.حدود):
//  - المفاتيح كلها على الجهاز المضيف نفسه (DesktopSetting) — من يملك القرص
//    كله مع جلسة حية يفتح كل شيء (حد §58 الموروث). الفائدة: عزل سرقة
//    مفتاح مفرد أو صفوف جهاز مفرد لا أكثر — نعلنها بصدق.
//  - kid معلن بالمغلف يكشف «تساوي مفتاح» مغلفين — وهذا مقصود: هو عنوان
//    الحلقة وأداة التحقق من العزل، وليس سرًّا.
//  - صفوف قديمة بلا kid (v1) لا يمكن نسبتها لجهاز من المغلف وحده — تُنسب
//    بعمود الصف deviceId عند إعادة الختم الموجّه وتبقى على المفتاح الموحد
//    حتى أول إعادة ختم تشملها.

import crypto from "node:crypto"
import { isValidKid } from "./at-rest-cage"

/** بادئة إعدادات مفاتيح الأجهزة في DesktopSetting (صفر مخطط) */
export const CLIP_DEV_KEY_PREFIX = "clip.at-rest-key:"

/** §59 — معرّف المفتاح: مشتق حتمي (sha256 أول 16 hex) — يعلن بلا كشف المفتاح.
 *  نفس المفتاح يعيد نفس kid دائمًا ومختلف المفاتيح مختلفون عمليًا. */
export function kidForKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16)
}

/** §59 — مفتاح إعداد جهاز سالم: deviceId ∈ [A-Za-z0-9._-] بحد 64 —
 *  الشارد يعود null فيرجع صاحبه للمفتاح الموحد (سلوك معلن) */
export function deviceSettingKey(deviceId: unknown): string | null {
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(deviceId)) return null
  return CLIP_DEV_KEY_PREFIX + deviceId
}

/** مدخل حلقة: جهاز + معرّفه + مفتاحه (المفتاح لا يغادر هذه البنية للعرض) */
export interface ClipKeyEntry {
  device: string
  kid: string
  key: string
}

/** حلقة مفاتيح الخزنة: المفتاح الموحد القديم + مفاتيح الأجهزة المرسوخة */
export interface ClipKeyRing {
  legacy: string | null
  /** معرّف المفتاح الموحد إن وُجد — للعرض والتقارير حصرًا */
  legacyKid: string | null
  byKid: Map<string, ClipKeyEntry>
  byDevice: Map<string, ClipKeyEntry>
  /** الحلال التعاقدي: kid ← مفتاحه، وkid الغائب (مغلفات v1) ← المفتاح الموحد */
  resolver: (kid: string | null) => string | null
}

/** حلال الحلقة (نقي): kid معروف ← مفتاحه · kid غائب/null ← المفتاح الموحد */
export function ringResolver(
  legacy: string | null,
  byKid: Map<string, ClipKeyEntry>,
): (kid: string | null) => string | null {
  return (kid) => {
    if (kid === null) return legacy
    if (!isValidKid(kid)) return null
    return byKid.get(kid)?.key ?? null
  }
}

/** عدد أقفال الحلقة (الموحد + الأجهزة) — للعرض والتقارير حصرًا (رقم F6) */
export function ringKeyCount(ring: ClipKeyRing): number {
  return (ring.legacy ? 1 : 0) + ring.byKid.size
}

/** أجهزة الحلقة مرتبة بالاسم — للعرض (أسماء لا مفاتيح ولا kid؟ kid معلن أصلًا) */
export function ringDevices(ring: ClipKeyRing): Array<{ device: string; kid: string }> {
  return Array.from(ring.byDevice.values())
    .map((e) => ({ device: e.device, kid: e.kid }))
    .sort((a, b) => a.device.localeCompare(b.device))
}
