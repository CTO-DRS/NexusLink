// NexusLink — G2: بوابة بيانات العرض التوضيحي (demo)
// كل زرع بيانات وهمية وقت التشغيل (أجهزة galaxy-s24/pc-office… · جهات اتصال
// ورسائل comms · أزواج مزامنة/عناصر handoff · صلاحيات الهاتف المزروع) يمر من هنا.
// الافتراضي: مطفأ — الحزمة المكتبية والإنتاج يبدآن بقائمة أجهزة فارغة صادقة.
// التشغيل: NEXUSLINK_DEMO=1 (سكربتات E2E و`bun run dev` تضبطه صراحةً).
// الإعدادات المدمجة غير الوهمية (ملفات تعريف الشبكات، قواعد الروتينات الافتراضية) تبقى.

export function isDemoMode(): boolean {
  const v = (process.env.NEXUSLINK_DEMO ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}
