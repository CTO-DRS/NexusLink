# NexusLink Mobile — Device Agent (Flutter)

وكيل الجهاز لمنصة **NexusLink**: يتصل بسيرفر النسخة الويب/الكمبيوتر عبر بروتوكول Nexus
(Foreground Service دائم + إعادة اتصال تلقائي)، ويسجّل نفسه فورًا في قائمة الأجهزة.

> **القاعدة الذهبية محفوظة**: هذا التطبيق يطابق عقد البروتوكول المستخرج من السيرفر
> حرفيًا — المرجع الحاكم: `../docs/protocol-contract.md`.
> أي فجوة وُجدت أثناء البناء أُصلحت **في السيرفر نفسه** (QR بعنوان حقيقي + حقول
> pair اختيارية + إعلان mDNS `_nexuslink._tcp`).

---

## 1) التشغيل السريع

المتطلبات: Flutter 3.22+ / Dart 3.4+ / Android SDK 34 (تطبيق أندرويد فقط في هذه المرحلة).

```bash
cd nexuslink_mobile
flutter pub get
# ملف drift مولّد ومرفق؛ لإعادة توليده بعد أي تعديل على الجداول:
dart run build_runner build --delete-conflicting-outputs

flutter run            # على جهاز/محاكي على نفس شبكة الكمبيوتر
flutter build apk      # إصدار
```

## 2) اختبار النجاح (خطوة بخطوة)

1. شغّل نسخة الويب على الكمبيوتر (سيرفر NexusLink قائم: REST :3000 + جسور socket.io + بوابة :81).
2. افتح تطبيق NexusLink على الهاتف → تبويب **الاتصال**.
3. اختر طريقة واحدة من الثلاث:
   - **اكتشاف تلقائي mDNS**: سيظهر السيرفر `NEXUS-PC` تلقائيًا (خدمة `_nexuslink._tcp` عبر bonsoir).
   - **مسح QR**: افتح شاشة الأجهزة في الويب ← «عرض QR» ← امسحه (mobile_scanner) — الحمولة
     تحتوي العنوان الحقيقي + السر + خريطة المنافذ.
   - **إدخال يدوي**: IP الكمبيوتر والمنفذ (81 عبر البوابة أو 3000 مباشرة).
4. يفحص التطبيق الصحة أولًا (`GET /api/tools/ping` + قياس RTT)، ثم يسجّل الجهاز
   (`POST /api/devices {action:"pair", id:<Android-ID-ثابت>, name, kind:"phone", …}` —
   شكل البيانات مطابق للسيرفر بالضبط).
5. تُحفظ الثقة محليًا في SQLite (drift) مع إمكانية التبديل بين خوادم متعددة.
6. **النتيجة على الويب**: الجهاز يظهر فورًا في قائمة الأجهزة كـ `connected`،
   وفي لوحة الحماية «هاتف الحماية متصل» + منارة القرب حية (`prox:beacon` كل 5 ثوانٍ).
7. **القناة تبقى حية بعد إغلاق التطبيق**: `AgentForegroundService` (Kotlin) يملك
   اتصال socket.io داخل خدمة أمامية `dataSync` مع إشعار دائم، حارس watchdog كل 15 ثانية،
   وإعادة اتصال تدريجية (2s→15s).

## 3) البنية (كما طُلب في المهمة)

```
lib/
├── main.dart / app.dart            التهيئة + الثيمان + RTL كامل
├── core/
│   ├── protocol.dart               ثوابت بروتوكول Nexus (منافذ/أحداث) — مرآة العقد
│   └── theme.dart                  نفس ألوان الويب (oklch→hex) + IBM Plex Sans Arabic
├── domain/
│   ├── models.dart                 QrPayload/ServerEndpoint/NexusDevice/AgentEvent…
│   └── discovery_service.dart      mDNS عبر bonsoir (_nexuslink._tcp)
├── data/
│   ├── nexus_api.dart              REST: ping/pair/devices — أشكال مطابقة حرفيًا
│   ├── agent_channel.dart          MethodChannel/EventChannel نحو الخدمة الأصلية
│   ├── device_identity.dart        المعرّف الثابت + الاسم/الموديل/النظام/البطارية
│   └── database/nexus_db.dart      drift: جدول الخوادم الموثوقة (+ .g.dart مولّد)
├── state/providers.dart            Riverpod: اتصال/اكتشاف/خوادم/سجل/ثيم/أجهزة حية
└── presentation/
    ├── shell.dart                  BottomNavigationBar (بديل الـ Dock)
    ├── connect_screen.dart         mDNS + QR + يدوي + فحص الصحة + الاقتران + الخوادم الموثوقة
    ├── devices_screen.dart         قائمة الأجهزة الحية (بولينغ 4s)
    ├── log_screen.dart             سجل النشاط الحي
    └── settings_screen.dart        المظهر/اللغة/الهوية/حالة الخدمة
android/app/src/main/kotlin/com/nexuslink/mobile/
├── MainActivity.kt                 MethodChannel: startAgent/stopAgent/deviceInfo + EventChannel
└── AgentForegroundService.kt       socket.io دائم (io.socket:socket.io-client) + beacon + watchdog
```

## 4) نمطا الوصول للسيرفر (من عقد البروتوكول)

| النمط | REST | socket.io | متى |
|-------|------|-----------|-----|
| `gateway` | `http://host:81/api/*` | `ws://host:81` + `?XTransformPort=3006` | QR عبر الويب / mDNS (بوابة Caddy) |
| `direct` | `http://host:3000/api/*` | `ws://host:3006` | إدخال يدوي على 3000 |

القناة الدائمة للوكيل هي **جسر الحماية 3006** (قناة الحضور في بروتوكول Nexus):
`guard:hello-phone` ثم `prox:beacon` كل 5s ثم `dev:state` كل 30s، مع الاستماع لأوامر `dev:*`.

## 5) الأذونات (طلب وقت الاستخدام + شرح ar/en)

- `POST_NOTIFICATIONS`: يُطلب عند بدء الوكيل الأول — الإشعار الدائم يمنع النظام
  من قتل القناة في الخلفية (شرح عربي/إنجليزي داخل التطبيق).
- `INTERNET/ACCESS_NETWORK_STATE/ACCESS_WIFI_STATE/CHANGE_WIFI_MULTICAST_STATE`:
  صلاحيات عادية (لا حوار) — الشبكة المحلية والـ multicast لاكتشاف mDNS.

## 6) حدود صادقة في هذه المرحلة

- RSSI المنارة ثابت (-52 dBm) — القرب الحقيقي بالبلوتوث يأتي في مرحلة الحماية
  (قراءة RSSI عبر Wi-Fi تتطلب صلاحية موقع؛ أُجّلت عمدًا).
- إبطال الاقتران بسرّ QR الجديد (G-1: التحقق من السر جانب السيرفر) يُفعَّل في مرحلة الأمان —
  التسجيل حاليًا عبر واجهة pair الموجودة كما طلبت المهمة حرفيًا.
- سجل أجهزة السيرفر في الذاكرة (G-4) — الجهاز يعيد التسجيل تلقائيًا عند أي فشل/إعادة تشغيل
  لأن معرّفه ثابت والإجراء idempotent.
- `flutter analyze`/البناء الفعلي يجريان على جهاز المطوّر — بيئة هذا المستودع بلا Flutter SDK
  (كل الملفات مكتوبة وفق الإصدارات المثبتة في pubspec ووُلّد ملف drift بـ build_runner فعلي).
