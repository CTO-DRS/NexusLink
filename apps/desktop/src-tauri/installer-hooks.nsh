; NexusLink — hooks مثبّت NSIS (FA-files عقد §14)
; ============================================================
; التثبيت: التطبيق نفسه يسجّل قائمة الزر الأيمن عند أول تشغيل (HKCU بلا
; صلاحيات مدير) — لا شيء مطلوب هنا.
; إزالة التثبيت: تنظيف مفاتيح قائمة السياق حرفيًا (التنظيف التعاقدي المطلوب).
; ملاحظة: مفتاح النجمي يخص الملفات والمفتاح الثاني المجلدات.

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "NexusLink: إزالة قائمة الزر الأيمن (إرسال عبر NexusLink)…"
  DeleteRegKey HKCU "Software\Classes\*\shell\NexusLink"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NexusLink"
!macroend
