# add-pulse-docs.py — إدراج §27.هـ وتحديث §27.ج في العقد (أسطر — مقاوم للتشكيل الخفي)
PATH = "/home/z/my-project/docs/protocol-contract.md"
with open(PATH, encoding="utf-8") as f:
    lines = f.readlines()

anchor_27g = "نجاح — فتُرصد الانتقالات لحظيًا دون انتظار النبضة التالية."
anchor_27d = "داخل حد الاحتفاظ 24h — لا تاريخ أقدم من ذلك."

block_g = """- **نبض الخدمة الذاتي (§27.هـ)**: `heartbeatBump()` نفسها تشعل نبض الخدمة الدائم
  عند أول لمسة (`ensureServicePulse`) — بعدها لا تحتاج المنظومة أي واجهة مفتوحة
  لتوليد العينات (التفصيل في 27.هـ).
"""

block_h = """- **شارة النبض**: لقطة الصحة تتضمن `pulse {active, intervalMs, startedAt}` من
  `getServicePulse()` — والواجهة تعرض شارة حية «نبض ذاتي من الخادم» في ترويسة
  اللوحة مع سطر الحد الصادق أسفلها (القياس داخل عملية الخادم لا جلسة المتصفح).

### 27.هـ نبض الخدمة الذاتي — القياس بلا واجهة (مصدر: devices.ts::ensureServicePulse + getServicePulse)
> كان توليد العينات مربوطًا حصرًا بفتح صفحة (نبض الواجهة كل 4ث) — إغلاق كل
> الصفحات كان يوقف التوليد ويقطع سلاسل الدليل للمشغلات التاريخية (§26.و).
> النبض الذاتي يجعل القياس خاصية للخادم لا للمتصفح.
- **الميكانيكا**: `ensureServicePulse()` (devices.ts) يبدأ `setInterval` كل
  `SERVICE_PULSE_MS = 4000` — نفس إيقاع نبضة الواجهة حرفيًا — يستدعي
  `heartbeatBump()`: الجيتر نفسه، نفس معدل الاستنزاف المحاكى، نفس تكة القياس
  (خانقة 30ث/جهاز بلا تغيير) — فسلوك «الواجهة مفتوحة» صار السلوك الدائم للخادم.
- **الإشعال (ignition)**: أي لمسة أولى تشعل النبض مدى عمر العملية: نبضة واجهة
  (`GET /api/devices`)، تكة force (تغيير حالة/force-sample)، تقرير وكيل
  (`report`)، إقلاع جسر الروتينات (`ensureAutomationBridge`)، أو تكة صحة داخل
  `recordHealthTick` نفسها. الحارس `globalThis.__nexusServicePulse` بعلم يُضبط
  **قبل** بدء المؤقت (idempotent — آمن مع HMR، لا تكرار أبدًا)، والمؤقت
  `unref()` فلا يحجز عملية قصيرة العمر (سكربتات تستورد الوحدة).
- **الظهور**: `getServicePulse()` يُصدَّر في لقطة `GET /api/devices/health` كحقل
  `pulse` — شارة الواجهة (§27.د) وفحوص E2E تقرأ منه؛ ولا يُكشف أي مسار جديد.
- **حدود صادقة**: (1) إيقاف عملية الخادم يوقف كل شيء — القواعد (§26.ز) والتاريخ
  (§27) يُستعادان عند الإقلاع والنبض يُشعَل مجددًا بأول لمسة؛ (2) أجهزة البذرة
  تستمر بالاستنزاف المحاكى (أرضية 5%) ما دام الخادم يعمل — نفس دلالات «الواجهة
  مفتوحة» السابقة صارت دائمة، والوكيل الحقيقي يتجاوز المحاكاة عبر `report`؛
  (3) النبض يعني تكة قياس كل 4ث لكل الأجهزة المتصلة — حمل CPU مهمل (حلقة على
  5 أجهزة) وكتابة SQLite كما كانت مع واجهة مفتوحة (عينة/جهاز/30ث + تنقية 24h).
"""

out, g_done, h_done = [], False, False
for ln in lines:
    out.append(ln)
    if not g_done and anchor_27g in ln:
        out.append(block_g)
        g_done = True
    if not h_done and anchor_27d in ln:
        out.append(block_h)
        h_done = True

if not (g_done and h_done):
    raise SystemExit(f"anchors missing: g={g_done} h={h_done}")

with open(PATH, "w", encoding="utf-8") as f:
    f.writelines(out)
print(f"ok: 27.ج bullet + 27.هـ section inserted ({len(lines)} -> {len(out)} lines)")
