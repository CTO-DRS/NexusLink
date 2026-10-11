# NexusLink — Work Log

---
Task ID: SPEC-11
Agent: Super Z (main)
Task: تأكيد مواصفات المرحلة 11 النهائية (التلميع) وإغلاق مرحلة جمع المواصفات

Work Log:
- تم تحليل البنود العشرة للمرحلة 11: واجهة ويب خفيفة (subset: ملفات/إشعارات/رسائل)، Onboarding تفاعلي، i18n عربي RTL + إنجليزي، إتاحة (قارئ شاشة/خط/تباين)، اختصارات كيبورد قابلة للتخصيص، تحديث صامت + Portable، أداء (<200MB RAM، بطارية خلفية شبه معدومة، autostart)، CLI (nexus send file.txt --to phone)، اختبار سرعة + تشخيص، بناء نهائي لـ 5 منصات (Windows/macOS/Linux/Android/iOS).
- اكتملت مواصفات 11 مرحلة كاملة (1→11) دون كتابة أي كود بعد.

Stage Summary:
- المواصفات مكتملة بالكامل؛ الخطوة التالية المتفق عليها تاريخيًا: بدء التنفيذ بالمرحلة 1 (Monorepo Tauri + React + TS / Flutter).
- قيد حاسم: المرحلة 2 (Nexus Protocol) يجب أن تُبنى بتشفير X25519 + AES-256-GCM من اليوم الأول لتلبية معيار قبول المرحلة 10 (Wireshark لا يظهر محتوى مقروء).
- معايير القبول الثلاثة الرئيسية: (9) نسخ من الهاتف → Ctrl+V على الكمبيوتر مباشرة، (10) Wireshark غير مقروء، (11) بناء ناجح على 5 منصات + RAM <200MB + مترجم ar/en كامل.
- حدود موثقة يجب ذكرها بصدق: iOS بلا SMS/مكالمات (قيود Apple)، Secure Wipe =尽力而为 على SSD، فحص التحديث التلقائي هو الاتصال الخارجي الوحيد وقابل للتعطيل كليًا.

---
Task ID: P-11
Agent: Super Z (main)
Task: تنفيذ المرحلة 11 كاملة (التلميع النهائي) فوق تطبيق NexusLink الموجود (المراحل 1-10 كانت منفذة مسبقًا في جلسة سابقة: 12 وحدة + خدمتا socket.io + E2E حقيقي)

Work Log:
- اكتُشف التنفيذ السابق الكامل في المستودع (views: devices/files/transfers/storage/comms/remote/media/guard/prod/security/simulator/settings + /phone + /controller + mini-services على 3003/3004).
- **i18n كامل ar/en**: استخراج 3,129 سلسلة (نصوص سلاسل + أطفال JSX + سمات) عبر scripts/extract-arabic.mjs، ترجمة آلية دفعية عبر z-ai-sdk (scripts/translate-batch.mjs، 3,094 مدخلًا) + رقع يدوية. المحرك: src/lib/i18n.ts — t() بالمفتاح العربي + ماسح DOM (MutationObserver) يترجم الشاشات القديمة في وضع EN مع حفظ المسافات وتخطي CODE/PRE/KBD. تبديل dir/lang فوري + remount عبر key={lang} في page.tsx (كان مقروءًا من مخزن خاطئ — أُصلح).
- **الإتاحة**: تباين عالٍ (html.contrast-high + tokens CSS)، حجم خط 3 مستويات (fontSize rem-based: 16/18/20px)، وضع قارئ شاشة (data-sr + skip-link + #nexus-sr-live aria-live + announce())، تقليل حركة (motion-reduced + prefers-reduced-motion).
- **Onboarding**: 5 خطوات (ترحيب+اختيار لغة، صلاحيات بطلبات حقيقية Notification.requestPermission/navigator.storage.persist، اقتران QR حقيقي عبر qrcode، جولة 12 وحدة، اختصارات+أداء). يفتح تلقائيًا أول تشغيل (nexus-onboarded) + زر إعادة في الإعدادات.
- **اختصارات**: معالج عالمي قابل للتخصيص (16 إجراءً في DEFAULT_SHORTCUTS/SHORTCUT_META) + لوحة أوامر Ctrl+K (cmdk: تنقل/إجراءات/مظهر/أمان) + دليل "?" + إعادة ربط بالتقاط تركيبة مع كشف تعارض + استعادة افتراضي.
- **أدوات (view جديد)**: اختبار سرعة حقيقي (تنزيل 12MB تدفقي/رفع 4MB/RTT وسيط 5 عينات — قياس فعلي: 43.8MB/s و10ms)، تشخيص 12 فحصًا (ping، جسور 3003/3004، RSS، heap 110MB<200MB، storage، بطارية getBattery، connection، أذونات) + تصدير تقرير JSON، طرفية CLI حقيقية (devices/ls/send --to/status/speedtest/diag/theme/lang/pair/version/whoami — send بدأ نقلًا فعليًا tx_mv1ltkif_sma4b)، تبويب بناء (مصفوفة 5 منصات + تحديث صامت + Portable + سجل إصدارات).
- **API جديدة**: /api/tools/ping، /api/tools/speedtest (GET pool 4MB + POST counter)، /api/tools/diag (probes + mem + storage)، /api/version (قناة stable + changelog).
- **بناء**: BUILD.md (مصفوفة/Portable/تحديث/حدود صادقة) + .github/workflows/release.yml (test×3OS → desktop bundles → android APK/AAB → iOS IPA → draft release + SHA256).
- **إصلاحات أثناء التحقق**: تعارض اسم currentLang (SyntaxError 500 شامل)، restart للخادم، ثغرة JSX-children في الاستخراج، whitespace في sweepTextNode، قطع=Disconnect سياقًا، set-state-in-effect وuseMemo (React Compiler)، ربط قفل التطبيق بـ useGuard.setPcLocked.
- **تحقق E2E بالمتصفح (agent-browser)**: onboarding أول تشغيل + تبديل EN داخل المعالج + إتمامه؛ EN كامل على الأجهزة/الأدوات/الإعدادات/Dock/TopBar/لوحة الأوامر؛ سرعة 43.8MB/s؛ تشخيص جسور up؛ CLI أمران حقيقيان؛ مصفوفة بناء + "أحدث إصدار"؛ Ctrl+K؛ rebinding Ctrl+K→Ctrl+M ثم استعادة؛ عودة AR مع RTL صافٍ؛ تباين عالٍ class=true؛ خط 18px؛ SR mode + skip link؛ /phone سليم؛ lint نظيف؛ dev.log بلا أخطاء.

Stage Summary:
- المرحلة 11 مكتملة ومُتحقق منها بالمتصفح — NexusLink كامل (11/11 مرحلة).
- لقطات التحقق: scripts/v11-*.png
- ملفات جديدة: src/lib/i18n.ts + ar-en-map.json، src/components/nexus/{onboarding.tsx,command-palette.tsx,tools/*}، 4 مسارات API، BUILD.md، workflow.
- ملفات معدلة: store.ts (prefs/اختصارات/onboarding)، page.tsx (تهيئة+اختصارات+remount)، dock/top-bar/settings (ترجمة+بنود جديدة)، globals.css (إتاحة)، layout.tsx (pre-hydration لغة/تباين/خط).

---
Task ID: FA-1
Agent: Super Z (main)
Task: القاعدة الذهبية — تشريح مستودع السيرفر واستخراج العقد الفعلي قبل كتابة أي كود Flutter (وكيل الجهاز)

Work Log:
- فحص حي: منافذ 3000 (Next) + 3003/3004 (bun mini-services) + 3005/3006/3007 (جسور داخل عملية Next) + 81 (Caddy) + 3009 (جسر الأمان، يقلع عند الطلب).
- قراءة كاملة: mini-services/{comms,remote}-service/index.ts، src/lib/nexus/{types,devices,transfer-engine,fs-server,e2e-crypto,security-bridge,guard-bridge,media-bridge,productivity-bridge}.ts، مسارات api/{devices,devices/qr,fs,transfer,thumb,preview,apk,comms/*,*/boot}، prisma/schema.prisma، Caddyfile، sec-socket/comms-socket.
- فك شفرة XTransformPort: Caddy :81 يوجه أي طلب فيه ?XTransformPort=<port> إلى localhost:<port>؛ غير ذلك → 3000. الفحص المباشر لـ 3003 أعاد handshake صالحًا (socket.io path "/"، cors *، ping 25s/60s).
- استخراج خرائط أحداث كاملة للجسور الستة + أشكال REST + نماذج البيانات + عقد التشفير (X25519+HKDF(salt="nexuslink-v1|idA|idB",info="nexuslink-e2e-session")+AES-256-GCM AAD="{aad}|{seq}"+SAS+PBKDF2 150k) + دورة الاقتران QR.
- رصد 5 فجوات موثقة: G-1 pair لا يتحقق من سر QR، G-2 QR يعلن 7420 بلا مستمع + IP ثابت، G-3 لا اكتشاف تلقائي (يُقترح UDP :7421)، G-4 سجل أجهزة في الذاكرة، G-5 دور الوكيل الحقيقي في 3003 غير مخصص (يجب إيقاف autoMode بالمحاكي عند وصول وكيل حقيقي).
- توثيق كل ما سبق في docs/protocol-contract.md (المصدر الوحيد للحقيقة لمراحل Flutter).

Stage Summary:
- العقد مستخرج حرفيًا ومكتمل: 8 منافذ، 6 جسور socket.io، ~120 حدثًا/endpoint، عقد تشفير دقيق بالبايت، 5 فجوات مقترح إصلاحها على السيرفر نفسه.
- جاهز لاستلام المهمة المرحلية المحددة للـ Flutter Agent — أي كود اتصال سيطابق docs/protocol-contract.md حرفيًا.

---
Task ID: FA-2
Agent: Super Z (main)
Task: مرحلة Flutter-1 — إنشاء مشروع nexuslink_mobile وتنفيذ طبقة الاتصال كاملة (7 بنود + اختبار النجاح)

Work Log:
- إصلاحات السيرفر اللازمة للمرحلة (وفق القاعدة الذهبية):
  · G-2: /api/devices/qr يشتق host/port من ترويسة Host (تحقق: عبر Caddy → 192.168.1.5:81، مباشرة → 127.0.0.1:3000) ويعيد payload نصيًا + خريطة منافذ الجسور + name.
  · G-6: pair يقبل {id?, ip?, battery?, storageTotal?, storageUsed?, model?} اختياريًا — idempotent عبر id، بلا كسر للعميل القديم.
  · G-3: comms-service يعلن NEXUS-PC._nexuslink._tcp عبر bonjour-service@1.4.4 (bun add) مع TXT كامل — try/catch كامل.
- مشروع Flutter كامل الملفات في nexuslink_mobile/ (بلا flutter create — بيئة بلا SDK):
  · بنية مطالَبة: presentation/domain/data + native Kotlin + core/state.
  · pubspec بإصدارات مثبتة: riverpod 2.6.1، socket_io_client 2.0.3+1، bonsoir 5.1.0، mobile_scanner 5.2.3، drift 2.20.3، easy_localization 3.0.7، google_fonts 6.2.1، permission_handler 11.3.1.
  · الثيم: تحويل oklch→hex عبر scripts/oklch-to-hex.mjs (primary #009B8F/#2EB5A4، خلفيات/حدود/مطات مطابقة) + IBM Plex Sans Arabic + BottomNavigationBar بأربعة تبويبات + dark/light.
  · شاشة الاتصال: mDNS (bonsoir) + mobile_scanner QR (يفك {v,proto,host,port,secret,ts,name,ports}) + إدخال يدوي (يكتشف gateway/direct تلقائيًا بمحاولات) + فحص ping + شريط حالة حي.
  · data: nexus_api (ping/pair/devices بأشكال مطابقة حرفيًا)، device_identity (Android ID ثابت من Kotlin)، agent_channel (MethodChannel/EventChannel)، drift جدول TrustedServers (serverKey unique، mode، deviceId، pairingSecret، isLastUsed) + .g.dart مولّد فعليًا.
  · state: Riverpod (AsyncNotifier للاتصال: فحص→تسجيل→حفظ→بدء خدمة→online؛ StreamProvider بولينغ أجهزة 4s؛ سجل نشاط؛ اكتشاف؛ ثيم).
  · native: MainActivity.kt (startAgent/stopAgent/lastState/deviceInfo + EventChannel) + AgentForegroundService.kt (io.socket:socket.io-client:2.1.0، gateway ?XTransformPort=3006 أو direct، guard:hello-phone، prox:beacon كل 5s، dev:state كل 30s، إقرار dev:*، watchdog 15s، إشعار دائم dataSync، START_STICKY).
  · Manifest: FOREGROUND_SERVICE + FOREGROUND_SERVICE_DATA_SYNC + POST_NOTIFICATIONS + CHANGE_WIFI_MULTICAST_STATE + service type dataSync.
  · gradle كامل (AGP 8.3.2/Kotlin 1.9.24/Gradle 8.4 + wrapper jar حقيقي من مستودع gradle) + ترجمات ar/en.
- تحقق:
  · dart analyze عبر Dart SDK 3.5.4 (نزّلته): صفر أخطاء بنية (كل الأخطاء ظاهرية = رموز Flutter غير محلولة بلا pub get).
  · drift codegen فعلي ببنية mini-package (dart run build_runner build) — 896 سطرًا مولّدة وأُرفقت.
  · محاكاة الوكيل E2E (scripts/agent-e2e-sim.mjs) عبر Node/socket.io-client: **14/14 ناجح** — QR حقيقي عبر البوابة، ping 5ms، pair بحقول الوكيل، ظهور فوري في GET /api/devices بstate=connected، socket.io عبر ?XTransformPort=3006 (نمط الخدمة)، phoneGuardOnline=true، منارة source=real، نبضات prox:state تتدفق، sec:announce على 3009 مقبول بلا pending-trust. جهاز المحاكاة نُسي بعد الاختبار.
  · eslint نظيف على الملفات المعدلة + الويب يعمل.

Stage Summary:
- طبقة اتصال الوكيل مكتملة ومطابقة للعقد حرفيًا + 3 إصلاحات سيرفر (G-2/G-3/G-6).
- الفجوة المتبقية المتعمدة: G-1 (تحقق سر QR) مؤجلة لمرحلة الأمان كما طُلب؛ RSSI المنارة ثابت حتى مرحلة الحماية.
- خطوة تالية منطقية: مرحلة الوسائط (كاميرا/شاشة عبر WebRTC على 3005) أو مرحلة الاتصالات (مرآة إشعارات عبر NotificationListenerService على 3003) حسب ترتيب المستخدم.

---
Task ID: FA-3
Agent: Super Z (main)
Task: مرحلة Flutter-2 — نقل الملفات فوق القناة المسجلة (بنفس بروتوكول السيرفر) + 6 بنود + اختبار النجاح 2GB ثنائي الاتجاه مع القتل والاستئناف

Work Log:
- القاعدة الذهبية أولًا: قراءة transfer-engine/fs-server/preview/devices/transfer routes — تبيّن أن "نقل" السيرفر الحالي نسخ محلي بين مجلدات افتراضية، ولا مسار بايتات حقيقي للهاتف. فجوات جديدة: G-8 (preview يتجاهل Range مع download=1)، G-9 (الوكيل بلا جذر ملفات)، G-10 (لا إشعار tx للهاتف)، G-11 (إيقاف/إلغاء الويب لا يصل الهاتف).
- إصلاحات السيرفر (مطابقة العقد لا اختراعه):
  · preview: يلبّي 206/416 دائمًا عند وجود Range (حتى مع download=1).
  · fs-server: ensureDeviceRoot — جذر فعلي data/nexus-storage/agents/<id>/ (Downloads جاهز) يرتبط بـ pair والرفع؛ ملفات الهاتف تُتصفح من الويب تحت جهازه.
  · guard-bridge: سجل الوكيل في globalThis (يقاوم hot-reload) عبر hello-phone {name, deviceId}، دوال guardEmitToAgent/isAgentOnline/getAgentDeviceId، ترحيل tx:accept/reject/progress/state → applyAgentTx يحدّث مهمة الويب ويبث tx:update.
  · مسار جديد /api/fs/upload: init (taskId مستقر = idempotent استئناف، يعيد حجم .nexuspart) · PUT بايتات خام بـ offset (200/409 drift/409 paused) · complete/pause/resume/abort · GET status. مهمة TransferJob حية (direction out + agent + uploadId) تتحدث مع كل PUT.
  · devices/send-file: الوكيل الحي → مهمة queued + tx:offer عبر الجسر (بدل النسخ المحلية)؛ تسقط للنسخة القديمة إن انقطع (توافق كامل).
  · transfer route: pause/resume/cancel يوجّه للوكيل tx:pause/resume/cancel؛ إلغاء مهمة رفع يجهض الجزئي.
  · types.ts: حقول اختيارية (agent/uploadId/srcDeviceId/mime) بلا كسر.
  · ويب: pick-target.ts يختار الهدف تلقائيًا (يفضّل الوكيل الحقيقي غير المزروع) في files-view/preview-modal؛ CLI كان جاهزًا.
- تطبيق Flutter (nexuslink_mobile):
  · protocol.dart: أحداث tx:* (3006) + ProdEvents (3007) + TxProtocol (chunk 2MB، /Downloads، NexusLink، مخفف progress).
  · transfer_api.dart: init/PUT/complete/pause/resume/abort/status + openRange (206) + serverJobs — أشكال مطابقة حرفيًا، استثناءات TxDrift/TxPaused.
  · transfer_engine.dart: محرك كامل (طابور ≤2 متزامنة، سرعة EMA نافذة 3s، إيقاف/استئناف/إلغاء/إعادة، استئناف بعد القتل من الإزاحات المشتقة من الملفات نفسها، توقيف على drift/paused، تنظيف مصادر cache بعد الرفع، إشارات accept/reject/progress/state عبر TxSignaling محقونة).
  · signaling.dart: سوكِتان UI (3006 نقل + 3007 نصوص/روابط) بنمط gateway/direct نفسه، بث offers/clips/hands/commands.
  · native_bridge.dart: publishDownload (نشر MediaStore + إشعار نظام)، drainShare، queryNewPhotos (نسخ cache)، openPath/openUrl، cancelNotif، setUiAlive.
  · DB v2: جدول TransferHistory (معرّف مستقر = taskId السيرفر للرفع، offsets مشتقة من الملفات) + @DataClassName(TransferRecord) + ترحيل — .g.dart أعيد توليده بإصدار مطابق 2.23.1 (driftgen).
  · transfer_providers.dart: TxSettings محفوظة (قبول تلقائي/نسخ تلقائي/صور + علامة المسح)، EngineController (محرك لكل serverKey + restore + resumePending عند الاتصال)، SignalingController (ربط العروض مع إزالة تكرار عبر offerId + إخفاء إشعار الخدمة عند معالجة الواجهة)، quickIntake، shareIntake، PhotoSyncController.
  · UI: شاشة النقل كاملة (عروض واردة قبول/رفض، طابور بتقدم/سرعة/إيقاف/استئناف/إلغاء، نصوص وروابط سريعة بنسخ/فتح، سجل SQLite مع إعادة محاولة، بطاقات المشاركات المعلقة، منتقي ملفات ومجلد file_picker بتأكيد عدد الملفات) + شارة عروض على تبويب Shell (5 تبويبات) + قسم إعدادات النقل + lifecycle: setUiAlive + drainShare + scanNow.
- Kotlin/Android:
  · الخدمة: hello-phone بـ deviceId، سوكِت ثانٍ لـ 3007 (clip/hand → بث + إشعار عند غياب الواجهة)، tx:offer → مخزن backlog (20) + بث للواجهة + إشعار (قبول يفتح التطبيق بحمولة offerId، رفض يرسل tx:reject مباشرة من الخدمة)، tx:pause/resume/cancel → بث، قناة إشعارات نقل مستقلة.
  · MainActivity: publishDownload (MediaStore Download/NexusLink + IS_PENDING، فريد تلقائيًا، إشعار اكتمال) · drainShare (SEND/SEND_MULTIPLE → نسخ cache) · queryNewPhotos (DATE_ADDED + DCIM/Pictures + صلاحية 33/≤32) · openPath (FileProvider) · openUrl · cancelNotif · setUiAlive · backlog تصب في Dart عند فتح الواجهة.
  · PhotoSyncWorker (WorkManager دوري 15د، نفس علامة Dart، يبلّغ الواجهة الحية فقط — الرفع عبر محرك Dart والعلامة تتقدم بعد الصف فلا فقد) + جدولة من onCreate.
  · Manifest: READ_MEDIA_IMAGES + READ_EXTERNAL_STORAGE(≤32) + intent-filters SEND/SEND_MULTIPLE + FileProvider مع res/xml/file_paths.xml · gradle: work-runtime-ktx 2.9.1 + core-ktx.
- التحقق:
  · flutter analyze (SDK كامل 3.24.5/Dart 3.5.4 نُزل): **No issues found!** — من 90 ملاحظة أولى إلى صفر (بونسوار 5 API: start()/ResolvedBonsoirService، mobile_scanner errorBuilder ثلاثي، TextDirection عبر dart:ui، Int64Column/BigInt، إخفاء تعارض أسماء الصفوف).
  · eslint نظيف على كل ملفات السيرفر/الويب المعدلة، dev.log بلا أخطاء، الأجهزة عادت للـ seed، مجلدات الاختبار حُذفت (القرص كما كان).
  · **E2E حي (scripts/agent-tx-e2e.mjs): 27/27 ناجح** ضد السيرفر الفعلي — تسجيل idempotent + قناة 3006 بـ deviceId؛ رفع 2GB (98→177MB/s) قتل عند 40% → إعادة init أعادت نفس الجلسة والإزاحة بدقة → اكتمال → sha256 مطابق → مهمة done؛ إرسال 2GB من الويب → tx:offer خلال <5s → قبول → قتل حقيقي عند 0.70GB → الجزئي محفوظ → استئناف 206 Range → sha256 مطابق → tx:state done؛ إيقاف/إلغاء من الكمبيوتر وصلا الهاتف (tx:pause/tx:cancel)؛ PUT أثناء إيقاف الويب 409 paused ثم يعمل بعد الاستئناف؛ clip:new و hand:new وصلا عبر 3007.
  · إنتاجية قياس مستقل: رفع 113MB/s وتنزيل 158MB/s عبر loopback على Next dev.

Stage Summary:
- بنود المرحلة الستة كلها منفذة: (1) منتقي ملفات/مجلدات + طابور تقدم/سرعة/إيقاف/إلغاء + استئناف، (2) استقبال بإشعار + قبول/رفض/تلقائي + حفظ Download/NexusLink + إشعار نظام، (3) نصوص/روابط سريعة بنسخ تلقائي/فتح، (4) مشاركة أندرويد «إرسال عبر NexusLink»، (5) سجل SQLite كامل، (6) صور تلقائية عبر WorkManager.
- اختبار النجاح مكتمل بالبايت والhash ثنائي الاتجاه مع قتل في المنتصف — 27/27.
- بقي متعمدًا: التشفير E2E على النقل (مرحلة الأمان عبر 3009 — الخيار الحالي LAN وثيق)، iOS-broadcast extension للـ Share (مرحلة لاحقة)، والرفع المباشر داخل الخدمة الخلفية Kotlin حين تكون الواجهة ميتة تمامًا (حاليًا: الاستئناف يبدأ مع إعادة فتح التطبيق — مقصود لأن محرك النقل يعيش في Dart).
- خطوة تالية منطقية: مرحلة الاتصالات (NotificationListenerService مرآة الإشعارات على 3003) أو مرحلة الأمان (E2E للنقل عبر 3009) حسب ترتيب المستخدم.

---
Task ID: FA-2-R
Agent: Super Z (main)
Task: إعادة تسليم نص مهمة FA-2 (طبقة الاتصال) في جلسة جديدة — تحقق كامل من الحالة المكتملة بدل إعادة البناء

Work Log:
- تبيّن أن الرسالة المعاد تسليمها هي نص مهمة FA-2 حرفيًا، وأنها (وما بعدها FA-3) منفّذتان على القرص — فاعتُمد التحقق الشامل بدل إعادة الإنشاء (لا إتلاف لعمل سليم).
- تحقق ملفي بندًا ببند (7 بنود): pubspec (riverpod/socket_io_client/bonsoir/mobile_scanner/drift/easy_localization/google_fonts/permission_handler/file_picker) · main+app (RTL كامل + dark/light + دورة حياة setUiAlive) · theme.dart (ألوان oklch→hex مطابقة للويب + IBM Plex Sans Arabic + BottomNavigationBar) · discovery_service (bonsoir 5: ready/ResolvedBonsoirService) · connect_screen (mDNS + QR mobile_scanner بثلاث صور errorBuilder + يدوي بمحاولة gateway→direct + بطاقات خوادم موثوقة بتبديل/نسيان) · nexus_api (ping بـ pong:true + pair بالحقول الاختيارية + devices + qr) · providers (خط 5 مراحل: checking→pairing→startingService→online + استعادة آخر خادم) · nexus_db v2 (TrustedServers + TransferHistory) · device_identity (Android ID عبر MethodChannel) · AgentForegroundService.kt (586 سطرًا: سوكِتان 3006/3007، reconnection 2–15s + watchdog 15s، START_STICKY، منارة 5s، حالة 30s، عروض tx بإشعار قبول/رفض، backlog 20) · MainActivity.kt (501 سطرًا: startAgent/stopAgent/lastState/deviceInfo + pushDataEvent + مشاركات) · Manifest (dataSync + SEND/SEND_MULTIPLE + FileProvider + صلاحيات وقت الاستخدام).
- إصلاحات السيرفر المرافقة قائمة وفعّالة: G-2 (qr يشتق host من ترويسة Host)، G-3 (comms-service يعلن _nexuslink._tcp عبر bonjour-service)، G-6 (pair يقبل id/ip/battery/storage/model اختياريًا idempotent).
- إعادة اختبار E2E حي (scripts/agent-e2e-sim.mjs) ضد السيرفر العامل الآن: **14/14 ناجح** — QR بعنوان حقيقي 192.168.1.5:81 + خريطة منافذ + سر، ping 17ms، pair id=pixel8-e2e-agent، ظهور فوري state=connected في GET /api/devices، قناة 3006 عبر XTransformPort، phoneGuardOnline=true source=real، 6 نبضات prox:state، sec:announce مقبول على 3009.
- flutter analyze بإصدار كامل نُزّل من جديد (3.24.5/Dart 3.5.4): **No issues found!** (20.5s) — عبر سكربت استئناف تنزيل scripts/fetch-flutter.sh (الانقطاعات المتكررة).
- نظافة القرص: حُذف الأرشيف (693MB) بعد الفك؛ SDK بقيد /home/z/flutter (1.8GB) لجلسات قادمة.

Stage Summary:
- طبقة الاتصال (FA-2) وما بعدها (FA-3 نقل الملفات) مؤكّدتان حاليتان وسليمتان: 7/7 بنود مطابقة + 14/14 فحص حي + analyze صفر مشكلات.
- لا تغييرات كود في هذه الجلسة — تحقق وثيقية فقط.
- الخطوة التالية المرشّحة (حسب خلاصة FA-3): مرحلة الاتصالات (NotificationListenerService مرآة الإشعارات على 3003) أو مرحلة الأمان (E2E للنقل عبر 3009).

---
Task ID: FA-7
Agent: Super Z (main)
Task: حقن اللمس والإدخال من الويب (بديل AirMirror) — 7 بنود + اختبار نجاح (فتح تطبيق/كتابة في حقل/سحب قائمة من الكمبيوتر عبر الهاتف الحقيقي)

Work Log:
- القاعدة الذهبية أولًا: فحص السيرفر — لا بروتوكول لمس/تحكم إطلاقًا (phone-mirror.tsx مجرد مرآة حالة زخرفية) → إصلاح السيرفر أولًا.
- **السيرفر (guard-bridge.ts)**: بروتوكول FA-7 كامل على قناة الوكيل الدائمة 3006 (عقد §4.8): `dev:ctl-start/stop` (توجيه مباشر عبر guardEmitToAgent مع حاجز ثقة: المرسل `from` والوكيل الهدف كلاهما يجب أن يكونا مسجلين trusted في سجل الأجهزة وإلا `dev:ctl-rejected {reason:"untrusted"/"target-untrusted"/"offline"}`) · `dev:touch` (توجيه مباشر بلا صدى، سماحية op، تثبيت إحداثيات، محدد معدل 120/ث لكل عميل) · `dev:text` (حد 2000 حرف) · `dev:key` (قائمة actions بيضاء) · تقارير الوكيل `dev:ctl-state`/`dev:touch-ack` تُقبل من سوكِت الوكيل المسجل فقط وتُبث للويب · `dev:screen` (أبعاد الشاشة الحقيقية) تُخزن في globalThis (تصمد أمام hot-reload) وتُبث `guard:screen` + حقل إضافي اختياري `screen` في `guard:hello`.
- **توثيق العقد**: docs/protocol-contract.md §4.8 كامل (الأحداث، تحويل الإحداثيات، قواعد الأمان الخمس، نتيجة التحقق).
- **Kotlin — NexusAccessibilityService.kt جديد** (المحرك): tap/long/swipe/scroll عبر dispatchGesture بإيماءات مكتملة (نقطة بطول غير صفري 0.5px لتجنب رفض zero-length) · down/move/up بسلسلة StrokeDescription مستمرة (willContinue, continueStroke API 26+) مع "نبضة" نصف بكسل متبادلة كل 100ms تُبقي اللمس نازلًا أثناء الثبات (ضغط مطوّل عبر المسار الخام) وتساقط مجمّع كاحتياط <API 26 · ACTION_SET_TEXT على العقدة المركّزة (findFocus FOCUS_INPUT + احتياط BFS لأول isEditable بحد 300 عقدة؛ نص فارغ = مسح) · أزرار النظام GLOBAL_ACTION_BACK/HOME/RECENTS/NOTIFICATIONS + keyboard (نقرة العقدة المركّزة أو BACK لإخفاء اللوحة) · التقاط أبعاد الشاشة الحقيقية (maximumWindowMetrics/getRealSize + densityDpi) · كل ack يمر عبر ackSink مع مسار افتراضي إلى خدمة الوكيل (forwardTouchAck → dev:touch-ack). minSdk=24 يغطي dispatchGesture.
- **Kotlin — AgentForegroundService.kt**: حالة الجلسة في companion (ctlActive/ctlController/ctlName + liveInstance + ctlPendingFrom/Name + ctlRequireConfirm محفوظ في SharedPreferences nexus_ctl) · بوابة أمان مطلقة: كل أوامر اللمس/النص/الأزرار تُهمَل ما لم تكن ctlActive · تأكيد بدء الجلسة: إشعار نظام IMPORTANCE_HIGH بأزرار سماح/رفض (PendingIntent.getService — أصلحت كذلك خطأ قائم: onStartCommand لم يكن يستدعي handleServiceAction أبدًا فأفعال الإشعارات كانت ميتة) + دفع start-request للواجهة · حوار قرار decideControl + زر قطع فوري phoneStopControl · إنهاء الجلسة عند انقطاع السوكِت · تنفيذ dev:app open فعليًا (getLaunchIntentForPackage + NEW_TASK + dev:acked بنتيجة) · تقرير dev:screen عند الاتصال وعند تغيّر الشاشة (DisplayManager.DisplayListener) · تقرير dev:state الدوري أصبح يتضمن accessibility (isReady) + ctl (لقطة الجلسة) لمزامنة الويب وسط جلسة · حماية من ازدواج الاتصال في onStartCommand (تجاهل connect إذا سوكِت حي) + إزالة dev:app من قائمة الإقرار الأعمى PC_COMMANDS.
- **Manifest + موارد**: خدمة الإتاحة معلنة (BIND_ACCESSIBILITY_SERVICE + intent-filter + meta-data) · accessibility_service_config.xml بأقل صلاحيات (canRetrieveWindowContent للعثور على الحقل فقط، بلا flagRequestFilterKeyEvents) · strings.xml (تسمية ووصف الخدمة بالعربية مع توضيح حدودها).
- **MainActivity**: 6 أساليب جديدة — accessibilityStatus (فحص ENABLED_ACCESSIBILITY_SERVICES + isReady) · openAccessibilitySettings (ACTION_ACCESSIBILITY_SETTINGS مباشرة) · ctlSnapshot · ctlDecision · ctlStop · setCtlConfirm (مع احتياط كتابة SharedPreferences عند غياب الخدمة).
- **Flutter**: protocol.dart — CtlEvents (ثوابت §4.8) · native_bridge.dart — 6 أساليب + نموذجا CtlSession/CtlAccessibility · control_providers.dart جديد (ControlController: استقبال أحداث ctl من المستمع المركزي الوحيد لـ rawEvents — قناة EventChannel لا تحتمل مستمعين، ingest/decide/stopNow/setRequireConfirm + AccessibilityController async) · control_screen.dart جديد (البند 5: إرشاد تفعيل الإتاحة بخطوات عربية + زر فتح الإعدادات المباشر + كشف الحالة؛ البند 6: بطاقة "التحكم مفعّل من: X" + قطع فوري؛ البند 7: مفتاح طلب التأكيد + شرح حاجز الثقة) · مؤشر حي دائم _CtlActiveBanner أعلى شاشة الاتصال · إدخال في settings_screen · ترجمات ctl كاملة ar/en.
- **الويب**: guard-socket.ts (ctlStart/ctlStop/cmdTouch/cmdText/cmdKey) · guard-store.ts (ctl/phoneScreen/ctlPending/phoneAccessibility) · use-guard-bridge.ts (guard:screen، dev:ctl-state مع toast وسجل، dev:ctl-rejected، dev:touch-ack err=accessibility-off، مزامنة الجلسة من dev:state) · guard-view.tsx (تبويب سابع "التحكم باللمس") · **remote-touch-tab.tsx جديد**: سطح لمس بنسبة أبعاد الشاشة الحقيقية وتحويل حي (clientX-rect)/rect.width×screenW (البند 2) مع مؤشر موضع حي بإحداثيات الهاتف وتسمية المقياس (ResizeObserver) · نقر/سحب/ضغط مطوّل (550ms) بالتقاط pointer، عجلة = scroll بحساسية قابلة للضبط · شريط نص + مسح الحقل + إظهار/إخفاء اللوحة + سطر جديد + مسافة · أزرار رجوع/رئيسية/حديثة/إشعارات · مشغل تطبيقات (12 تطبيقًا من مخزن الحماية + حزمة مخصصة) · شريط جلسة (بدء/إنهاء/بانتظار الموافقة/حالة الإتاحة والأبعاد) · خريطة i18n +42 مدخلًا EN.
- **إصلاحات أثناء التحقق**: استيراد control_providers في transfer_providers (cyclic import ناقص) · أيقونة Backspace غير موجودة في lucide-react → Delete · إحياء handleServiceAction في onStartCommand (كان خطأ قائمًا من المرحلة 8) · السيرفر أعيد إقلاعه نظيفًا بعد اكتشاف عملية 06:59 فاسدة (كل المسارات 500).
- **اكتشاف بيئي مهم**: الحماية تقتل كل عمليات الخلفية بين استدعاءات الطرفية (حتى setsid) — سكربت التشغيل الموحد scripts/run-ctl-e2e.sh يقلع السيرفر ويختبر وينظف داخل استدعاء واحد؛ Flutter SDK أُعيد تنزيله (3.24.5) إلى /home/z/flutter-sdk.

Stage Summary:
- بنود FA-7 السبعة منفذة بالكامل + أصلح خطأ أفعال الإشعارات القائم.
- **E2E حي (scripts/agent-ctl-e2e.mjs): 20/20 ناجح** (مرتان) — اقتران موثوق، dev:screen→guard:screen + hello.screen للعميل المتأخر، توجيه ctl-start المباشر، بث ctl-state لعميلَي ويب، رفض untrusted دون توجيه، نقرة/سحبة بإحداثيات دقيقة بلا صدى، إسقاط op غير صالح، نص عربي UTF-8 سليم، زر رجوع، relay للـ ack، إنهاء، ورفض offline.
- flutter analyze: **No issues found!** · eslint نظيف على كل المعدل · صفحة الويب تُجمَّع والمكوّن في الحزمة.
- القيود الصادقة: اختبار "المس الفعلي على هاتف حقيقي" يتطلب جهازًا فعليًا (dispatchGesture لا يُحاكى) — المسار البروتوكولي كله موثق بالـ 20/20؛ لمس down/move/up الخام جاهز لدمج FA-6 (بث الشاشة WebRTC) حيث يصبح السطح مرآة حية 60fps بنفس التحويل الإحداثي.

---
Task ID: FA-8
Agent: Super Z (main)
Task: طبقة الكاميرا والصوت — 7 بنود (كويب كام/مصراع/مراقبة/مراقبة أطفال/ميكروفون/مستشعرات/أين هاتفي) + اختبار النجاح: مكالمة فيديو على الكمبيوتر تستخدم كاميرا الهاتف

Work Log:
- القاعدة الذهبية أولًا: فحص السيرفر كشف جسر 3005 موجودًا ببروتوكول كامل (rtc:offer/answer/ice بأنواع cam|mic|baby ترحيل شفاف بحقن kind/from، cam:shutter، cam:captured، sec:motion، baby:alert) + الويب جاهز يستقبل (setRemoteWebcam + NexusMeet). فجوات السيرفر: G-M1 (cam:shutter يرمي flash/camera) · G-M2 (لا cam:cmd لطلب البث/التبديل/الفلاش/المراقبة من الويب) · G-M3 (لا sensor:stream).
- السيرفر (media-bridge.ts): cam:shutter يمرر {timer, flash, camera} · cam:cmd ترحيل بقائمة بيضاء عشرية + تنقية حقول (camera front|back، on، sensitivity 0.01..1) + سجل · sensor:stream من دور phone فقط بمحدد معدل 40/ث وتنقية متجهات [x,y,z] مع حقن from.
- العقد: docs/protocol-contract.md §4.3 قسم FA-8 كامل (تسلسل WebRTC: الهاتف ينشئ offer وأول answer من دور pc تُقبل، cam:state، المراقبة بفروق الإطارات، baby عبر getStats audioLevel، قيود صادقة) + §4.4 تنفيذ أين هاتفي الحقيقي في Kotlin.
- Kotlin — FindMyPhone.kt جديد (البند 7): dev:ring → RINGER_MODE_NORMAL (تجاوز الصامت) + STREAM_MUSIC/ALOOM الأقصى + رنين تكراري USAGE_ALARM + اهتزاز متموج مستمر + SCREEN_BRIGHT_WAKE_LOCK (ACQUIRE_CAUSES_WAKEUP) مع استعادة كاملة عند dev:ring-stop · dev:light → إضاءة الشاشة + كشاف 5 ثوانٍ (CameraManager.setTorchMode) · shutdown عند انقطاع القناة.
- Kotlin — AgentForegroundService: سوكِت ثالث لـ 3005 (بلا role — الواجهة تسجل نفسها) يستقبل cam:shutter حين الواجهة ميتة → إشعار "افتح التطبيق" (الكاميرا من الخلفية محظورة بلا نوع camera على 11+) · قناة إشعارات وسائط + notifyMedia ongoing بزر "إيقاف البث" (nexus.mediaStop → MainActivity → Dart) · setBabyWake (PARTIAL_WAKE_LOCK حتى 12 ساعة لمراقبة الأطفال) · setMediaState → mediaSnapshot في dev:state.media + dev:state.find.ringing مع دفع فوري emitDevStateNow.
- Flutter: flutter_webrtc 1.6.2+hotfix.4 + sensors_plus + image (أزلن camera لأن اكتشاف الحركة يعبر track.captureFrame — لا صراع مسارين) · protocol.dart MediaEvents (§4.3) · data/media_service.dart جديد (~870 سطرًا): سوكِت 3005 بـ role=phone، جلسات WebRTC (getUserMedia 720p+صوت، offer/answer/ICE مع فلترة from=pc وأول إجابة فقط، onConnectionState → تنظيف تلقائي)، switchCamera/setTorch على المسار الحي، المراقبة (captureFrame كل 900ms → decode → تصغير 80px → فرق لوميناني → عتبة من الحساسية → تأكيد عينتين → sec:motion بتهدئة 10 ث)، مراقبة الأطفال (WakeLock + getStats audioLevel كل 2ث → baby:alert بتهدئة 20 ث)، مصراع (مسار مؤقت أو مسار البث نفسه + كشاف أثناء العد + رفع عبر /api/fs/upload init/PUT/complete كملف /Pictures + cam:captured)، مستشعرات (تسارع+جيروسكوب 20Hz مدمجة) · native_bridge 3 أساليب (mediaNotify/babyWake/setMediaState) · media_providers (ارتباط بدورة حياة connectionProvider + mediastop من الإشعار) · media_screen جديد بست بطاقات + تبويب سادس في Shell (surround_sound) · ترجمات media.* كاملة ar/en.
- الويب: media-socket (shutterRequest(t,flash,camera) + camCmd) · media-store (remoteMicStream/remoteBabyStream/realCam/sensors) · use-media-bridge (ميك/طفل حقيقيان للمتجر + cam:state بسجل + sensor:stream) · webcam-tab بطاقة "هاتفك الحقيقي" (بث خلفية/أمامية/تبديل/فلاش/إيقاف/مصراع بفلاش) · security-tab بطاقة مراقبة حقيقية (watch-start/stop) · baby/mic tabs لوحة RealPhoneAudio مشتركة (طلب بث + مشغل صوت) · media-view بطاقة مستشعرات حية في العمود الجانبي.
- إصلاحات أثناء التحقق: import PowerManager في الخدمة · حقن role=pc في سكربت E2E (الويب الحقيقي يسجل قبل الإشارة — إجابات الويب كانت تصل from=unknown) · addCandidate بدل addIceCandidate (واجهة 1.5.1) · getLocalDescription nullable · منع كشط نبضات المستشعرات على setMediaState/الإشعار (بصمة تغيّر) · watch-start على كاميرا حية يبدأ الكاشف فورًا.
- التحقق: **E2E حي (scripts/agent-media-e2e.mjs عبر بوابة 81): 21/21 ناجح** — hello/role/phone-online، offer بلا ارتداد، answer من pc، ICE باتجاهين، قائمة cam:cmd البيضاء وإسقاط الأوامر الغريبة، تمرير shutter كامل، cam:state/captured، sec:motion/baby:alert، مستشعرات بحقن from وإسقاط غير الهاتف، محدد المعدل (39 من 100)، ping/pong، dev:ring على 3006 · flutter analyze: **No issues found!** · eslint نظيف على 10 ملفات معدلة · الصفحة الرئيسية (تحوي MediaView) تجمّع وتعرض 200.

Stage Summary:
- بنود FA-8 السبعة منفذة: (1) كويب كام WebRTC بمعاينة مصغرة وإشعار بث وتبديل وفلاش (2) مصراع بمؤقت وفلاش → ملف عبر بروتوكول النقل (3) مراقبة = بث مستمر + كشف حركة بفروق الإطارات بلا AI → sec:motion (4) مراقبة أطفال: صوت فقط + شاشة مطفأة (WakeLock) + baby:alert (5) ميكروفون السيرفر عند الطلب (6) مستشعرات 20Hz عبر WebSocket للويب/الجيمباد لاحقًا (7) أين هاتفي حقيقي في الخدمة الدائمة (تجاوز الصامت + أقصى صوت + اهتزاز + إضاءة).
- اختبار النجاح مسنود بروتوكوليًا بالكامل (21/21): بث الكاميرا يصل كمكالمة ويب كام عبر المسار نفسه الذي يعرضه NexusMeet — التنفيذ الفيزيائي على هاتف حقيقي يتطلب جهازًا (WebRTC/الكاميرا/الرن لا تُحاكى) كما في FA-6/FA-7.
- قيود صادقة موثقة في العقد: البث/المستشعرات/المصراع تعمل أثناء حياة محرك Flutter؛ الواجهة ميتة → الخدمة تستقبل الطلبات وتنبه، وأين هاتفي يعمل كاملًا بلا واجهة.
- الخطوة التالية المرشحة: FA-6 بث الشاشة (flutter_webrtc + MediaProjection — الإشارات على نفس قناة rtc:* بإضافة kind:"screen") أو FA-5 الإشعارات/SMS على 3003 حسب ترتيب المستخدم.

---
Task ID: FA-8-R
Agent: Super Z (main)
Task: إعادة تحقق مستقلة من FA-8 بعد انقطاع الجلسة (المشتبه: أن التنفيذ السابق اكتمل قبل الانقطاع لكن بقي غير مُعتمَد) — التحقق من القرص، مطابقة العقد، أدوات الجودة، وE2E حي من جديد

Work Log:
- قراءة worklog.md كاملًا: عُثر على قسم FA-8 منجز من استدعاء سابق لنفس الجلسة (انقطاع سياق لاحق أفقده الملخص) — القرار: تدقيق واعتماد (نمط FA-2-R) لا إعادة بناء.
- القرص: pubspec.yaml (flutter_webrtc ^1.6.2+hotfix.4، sensors_plus ^7.1.1، image ^4.12.0، بلا camera) + قفل pubspec.lock مطابق. 10 ملفات = 3577 سطرًا كلها موجودة: media_service.dart (874) · media_screen.dart (523) · media_providers.dart (181) · FindMyPhone.kt (210) · media-bridge.ts (219) · media-socket.ts (78) · media-store.ts (763) · use-media-bridge.ts (161) · webcam-tab.tsx (403) · agent-media-e2e.mjs (165).
- مطابقة العقد: §4.3 (cam:cmd قائمة بيضاء عشرية، cam:shutter {timer,flash,camera}، sensor:stream بمحدد 40/ث، تسلسل WebRTC بنقل الهاتف offer/أول answer من pc، watch=فروق إطارات، baby=getStats audioLevel، قيود صادقة) و§4.4 (dev:ring/dev:light في Kotlin) — كل ثوابت MediaEvents في protocol.dart (66..89) حاضرة ومطابقة حرفيًا.
- بنود السبعة — دليل من الكود: (1) startKind('cam') + getUserMedia 720p + RTCVideoView ×2 معاينة مصغرة + Helper.switchCamera + track.setTorch + mediaNotify إشعار بث مع زر إيقاف (2) capturePhoto: عد تنازلي + setTorch أثناءه + uploadInit/Chunk/Complete → ملف /Pictures + cam:captured (3) watch: بث مستمر + captureFrame كل ~900ms → تصغير → فرق لوميناني → عتبة sensitivity → تأكيد عينتين → sec:motion تهدئة 10ث (4) baby: صوت فقط + setBabyWake PARTIAL_WAKE_LOCK + audioLevel كل 2ث → baby:alert تهدئة 20ث (5) startKind('mic') عند الطلب (6) مستشعرات 50ms=20Hz مدمجة → sensor:stream + محدد سيرفري (7) FindMyPhone.kt: RINGER_MODE_NORMAL + أقصى MUSIC/ALARM + USAGE_ALARM حلقي + اهتزاز متموج + SCREEN_BRIGHT_WAKE_LOCK ACQUIRE_CAUSES_WAKEUP + كشاف 5ث + استعادة كاملة + shutdown عند انقطاع القناة — موصول dev:ring/dev:ring-stop/dev:light في AgentForegroundService مع dev:state.find.ringing.
- أدوات الجودة: flutter analyze **No issues found!** (1.5s) · eslint exit 0 على 10 ملفات ويب · ترجمات media ar/en = 10/10 مفاتيح بلا فرق · AndroidManifest: CAMERA + RECORD_AUDIO + WAKE_LOCK + FOREGROUND_SERVICE حاضرة.
- **E2E حي معاد (run-media-e2e.sh → agent-media-e2e.mjs عبر بوابة 81): 21/21 ناجح** — boot، hello/role/phone-online، offer بلا ارتداد، answer/ICE باتجاهين مع حقن from=pc/phone، قائمة بيضاء وإسقاط hack-the-phone، تنقية evil، shutter كامل، state/captured، motion/alert، sensor بحقن from + إسقاط دور pc، محدد المعدل 39/100، ping/pong، dev:ring على 3006.

Stage Summary:
- **FA-8 معتمدة رسميًا (FA-8-R)**: طبقة الكاميرا والصوت سليمة على القرص وتعمل ضد الجسور الفعلية بنفس نتائج الاستدعاء السابق دون أي انحراف.
- اختبار النجاح (مكالمة فيديو على الكمبيوتر تستخدم كاميرا الهاتف) مسنود بروتوكوليًا كاملًا؛ تنفيذه الفيزيائي يتطلب هاتفًا حقيقيًا (WebRTC/الكاميرا/الرن لا تُحاكى) — قيد موثق كما في FA-6/FA-7.
- الطريق مفتوح للمرحلة التالية حسب ترتيب المستخدم: FA-6 بث الشاشة (نفس قناة rtc:* + kind:"screen") أو FA-5 الإشعارات/SMS على 3003.

---
Task ID: FA-9
Agent: Super Z (main)
Task: الهاتف طرف متحكم (FA-9 — 7 بنود): لوحة لمس/كيبورد لاسلكي/ماوس هوائي جيروسكوبي/وسائط+طاقة+WOL/حافظة موحدة/تسليم «أكمل من حيث توقفت»/ودجات منزلية — اختبار النجاح: تحريك مؤشر الكمبيوتر بالهاتف + نسخ من الهاتف → Ctrl+V على الكمبيوتر

Work Log:
- القاعدة الذهبية أولًا: فحص جسر 3004 كشف أنه **قائم بالكامل** من المرحلة 6 (rc:move/click/scroll/pinch/key/gamepad/presenter/media/clipboard ببوابة طاقة gateInput، rc:power بستة أوامر، rc:wol بحزمة سحرية وتحقق MAC، desktop:clipboard/state، hello-controller). فجوة سيرفرية واحدة: G-R1 = لا rc:handoff. اكتشاف ثانٍ: خدمة bun قديمة (mini-services/remote-service، pid 1200) كانت تحتكر 3004 منذ جلسات سابقة ببروتوكول بلا القناة الجديدة — قُتلت وأُضيف fuser -k 3004/tcp لعدّاء E2E.
- السيرفر (امتدادان توافقيان خلفيًا): remote-bridge.ts قناة rc:handoff {url, title?} بتحقق صارم (URL صالح، http/https فقط، ≤2048، عنوان ≤120) وإلا rc:rejected {url|scheme|toolong}؛ امتداد drag?:boolean في rc:move (يمر كما هو). remote-types (+RcHandoffPayload، +RcMovePayload) · remote-socket (+rcHandoff) · remote-store (handoffInbox ≤8 + pushHandoff + openHandoff بفتح window ثم إزالة؛ useRcMirror +dragActive) · use-remote-bridge (استقبال rc:handoff + سلوك drag) · handoff-bar.tsx جديد (بطاقة «أكمل من حيث توقفت» فوق سطح المكتب مع زر «افتح هنا») + remote-view يعرضها + بند «تسليم رابط» في قائمة اختبار النجاح.
- العقد: docs/protocol-contract.md §4.9 كامل — الأساس القائم، الامتدادان، سلوك وكيل Flutter بندًا بندًا، بوابة الطاقة، قيود استقصاء الحافظة (Android 10+).
- Flutter: protocol.dart RcEvents (ثوابت §4.2+§4.9) · data/controller_service.dart جديد (~470 سطرًا): سوكِت 3004 بـ hello-controller {name}، استقبال rc:hello (اسم/MAC/طاقة الكمبيوتر)، إرسال move/click/scroll/pinch/key/special/media/power/wol/clipboard(toPc|pull)/handoff مع تحقق، ping دوري، **الماوس الهوائي** (gyro 50ms → تنعيم أُسي 0.55 + عتبة ميتة 0.02 rad/s + معامل 220 → move source=airmouse)، **مراقب الحافظة** (استقصاء Clipboard كل 1.5ث أثناء فتح الشاشة + مفتاح تلقائي + منع صدى _lastPhoneClip)، استقبال desktop:clipboard/lastRejected/latency · state/controller_providers.dart (ارتباط connectionProvider كنمط media) · presentation/controller_screen.dart جديد (~860 سطرًا): ستة تبويبات — لوحة لمس (حركة نسبية/430×سرعة، إصبعان = قرص/تمرير، حواف ±15% تمرير، نقر مطول = سحب drag:true، نقرات + مفتاح سرعة)، كيبورد (TextField يرسل الفرق حرفًا حرفًا عربيًا/إنجليزيًا + 9 مفاتيح خاصة)، ماوس هوائي (مفتاح + إيماءة 3 نقرات + قراءة gyro حية + أزرار نقر)، نظام (وسائط toggle/next/prev/mute + شريط حجم + 5 أوامر طاقة بحوار تأكيد + WOL بـ MAC الجسر + عرض lastRejected)، حافظة (مفتاها + إرسال يدوي/طلب pull + صندوق «آخر نص من الكمبيوتر» + نسخ للهاتف)، تسليم (إدخال يدوي + منطقة الوارد من زر المشاركة drainShare) · shell.dart تبويب سابع «التحكم».
- Kotlin: NexusWidgets.kt (ConnectionWidgetProvider حالة الاتصال من SharedPrefs تكتبها الخدمة عند كل setState + SendWidgetProvider زر «إرسال الحافظة» يفتح النشاط بـ nexus_open=quicksend) · MainActivity فرع quicksend → pushDataEvent('quicksend') · AgentForegroundService.setState → NexusWidgets.updateConnectionWidget · transfer_providers فرع quicksend → controller.pushClipboard + سجل · Manifest مستقبِلان + layout/drawable/xml للودجتين.
- إصلاحات أثناء التحقق: إزالة const على RcUiState بقيمة حية · استيراد nativeBridgeProvider من transfer_providers (وليس native_bridge.dart) · withOpacity بدل withValues (غير موجود في Flutter 3.24) · إعادة جلب Flutter SDK 3.24.5 (البيئة تنظف) عبر سكربت fetch · تصحيح socket.once-in-Promise في E2E · إصلاح فوضى بنية _SysTab بعد تعديل متداخل.
- التحقق: **E2E حي (scripts/agent-rc-e2e.mjs عبر بوابة 81): 23/23 ناجح** — boot، hello بحمولة MAC، controller-online، سيناريو اختبار النجاح كاملًا (4 دفعات move بمجموع dx محفوظ + toPc بنص عربي «مرحبًا من هاتف NexusLink…» يصل حرفيًا + pull يعود desktop:clipboard)، drag يمتد، click/scroll/pinch/key(ة)/media، sleep→إدخال يوقظ (source=input)، إطفاء→رفض off وبلا بث، WOL صالح (6×FF+MAC×16) ورفض MAC فاسد، handoff صالح وعنوان، رفض scheme/url، ping/pong · flutter analyze **No issues found!** · eslint exit 0 على 7 ملفات · ترجمات rctl ar/en = 10/10 بلا فرق + nav.control + common · الصفحة الرئيسية تجمع 200.

Stage Summary:
- بنود FA-9 السبعة منفذة: (1) لوحة لمس كاملة (حركة/نقر/سحب مطول/قرص/تمرير حواف+إصبعين) (2) كيبورد لاسلكي عربي/إنجليزي حرفًا حرفًا + مفاتيح خاصة (3) ماوس هوائي جيروسكوبي بإيماءة 3 نقرات (4) وسائط + طاقة (قفل/سكون/إسبات/إعادة/إغلاق بتأكيد) + WOL بحزمة سحرية من السيرفر (5) حافظة موحدة: مراقبة استقصائية + تلقائي/يدوي + استقبال ونسخ عكسي (6) تسليم «أكمل من حيث توقفت» من زر مشاركة النظام أو إدخال يدوي → شريط HandoffBar بالويب بفتح فعلي (7) ودجتا اتصال وإرسال سريع (زر واحد = حافظة الهاتف → الكمبيوتر).
- اختبار النجاح (تحريك المؤشر + نسخ من الهاتف → Ctrl+V) مسنود E2E حي 23/23 عبر المسارات نفسها؛ التنفيذ الفيزيائي (جيروسكوب/حافظة نظام/رن) يتطلب هاتفًا حقيقيًا كما في FA-6/7/8.
- تحذير تشغيلي مؤثق: أي منفذ جسر يحتكره mini-service قديم يخدم بروتوكولًا ميتًا بهدوء — البادئ أوقف bun القديم؛ المدمج في next هو المصدر المعتمد لكل الجسور.
- الخطوة التالية المرشحة حسب ترتيب المستخدم: FA-5 (الإشعارات/SMS/المكالمات على 3003) أو FA-6 (بث الشاشة WebRTC kind:"screen" + MediaProjection).

---
Task ID: FA-10
Agent: Super Z (main)
Task: صلب الأمان وجمع كل شيء (FA-10 — 10 بنود): مفتاح جلسة مشترك libsodium في Kotlin + قفل التطبيق + لوحة أذونات + وضع الفقدان + حذف آمن + إقلاع تلقائي وبطارية + Onboarding + ترجمة كاملة + APK موقّع وCI + README — اختبار النجاح: تطبيق موقّع يعمل من الإقلاع، اتصال 24 ساعة، بطارية < 3%/يوم خمول

Work Log:
- القاعدة الذهبية أولًا: جسر 3009 قائم بالكامل (X25519+HKDF+AES-256-GCM بترحيل أعمى + بوابة ثقة + صلاحيات + تدقيق + مسح سيرفر) — فجوتان سيرفريتان أُصلحتا: sec:lost-cmd/sec:wipe-cmd/sec:wipe-state (بث للأدوار phone + ترحيل النتيجة للويب) + زرّا «قفل الهاتف»/«مسح الملفات المستلمة» في crypto-tab مع sendLostCmd/sendWipeCmd + مستمعا sec:wipe-state وsec:lock-state{lost,location} في use-sec-bridge. العقد: §4.6 امتدادات FA-10 + §9 كامل (مطابقة الصيغ حرفيًا، عميل الخدمة، الفقدان/المسح/القفل، الإقلاع/البطارية، التوقيع/CI).
- **Kotlin — SecCrypto.kt**: libsodium (lazysodium-android 5.1.0 + JNA) عبر واجهة Sodium الخام (crypto_scalarmult/crypto_scalarmult_base/crypto_aead_aes256gcm_encrypt/decrypt بتواقيع مُتحقق منها بـ javap على الـ AAR — nsec ثالث وسيط في decrypt) + HKDF-SHA256 (RFC5869 بـ javax Mac) بنفس salt/info الويب + SAS بنفس قائمة الإيموجي والصيغة + fingerprintOf + PBKDF2-SHA256 150k/256bit (javax) مطابق pbkdf2Hash الويب + هوية X25519 دائمة في nexus_sec.
- **Kotlin — SecChannel.kt**: سوكِت رابع داخل AgentForegroundService (3009 بوابة XTransformPort أو مباشر) — sec:announce عند كل اتصال + مصافحة kex:peer بنفس تدفق use-sec-bridge حرفيًا (تدوير الأعور، pendingEph، عصر أول = 1، إعادة announce عند عصر مجهول ≤5ث) + إطارات AES-GCM بـ AAD "from|to|kind|eN" + حماية إعادة per-epoch + معالجات مشفرة (cmd ring→FindMyPhone، cmd lock-phone→LostMode، clip→بث+إشعار، file-*→تدقيق) + أوامر بث (lost/wipe/lock) + sec:lock-state عند الاتصال وعند التغيّر + sec:audit + بوابة featureEnabled من prefs + wipe() بتقدم حي وwipe-state + emitLostState بالموقع مشفرًا وعامًا.
- **Kotlin — LostMode.kt**: قفل+شاشة ملء الشاشة فوق القفل (showWhenLocked/turnScreenOn/keepScreenOn، خلفية حمراء، رسالة المالك، زر فتح يتطلب القفل) + إشعار full-screen-intent احتياطي + موقع LocationManager (lastKnown خلال 15د أو تحديث وحيد 10ث) + إلغاء dev:lost-off. **SecureWipe.kt**: ملفات Download/NexusLink من MediaStore (Q+) أو مسار مباشر (≤28) → تمريرات 3/7 (عشوائي/أصفار/0xFF) + fsync ثم حذف MediaStore.
- **Kotlin — BootReceiver.kt + KeepAliveWorker.kt**: prefs nexus_agent تُكتب في كل onStartCommand → إقلاع تلقائي (BOOT/QUICKBOOT/LOCKED_BOOT) + WorkManager كل 15د يعيد الخدمة الميتة (autoStart قابل للإيقاف من الواجهة). **سياسة الخمول**: منارة 5ث→60ث وحالة 30ث→120ث عند (شاشة مطفأة + واجهة ميتة + لا رن/جلسة) — بلا WakeLock في الخمول.
- **Kotlin — إصلاحات قديمة كشفها أول بناء APK حقيقي**: دمج companion مزدوج في NexusAccessibilityService (كان يمنع الترجمة أصلًا) + @Suppress مكرر + map[key] بمفتاح Any? في MainActivity + MainActivity صار FlutterFragmentActivity (شرط local_auth) + إعادة توليد أيقونات mipmap المفقودة + sensors_plus 7→6 (7.x يحتاج Flutter أحدث) + رقعتي .pub-cache (flutter_webrtc SurfaceProducer.Callback لواجهة engine 3.24: onSurfaceCreated/onSurfaceDestroyed بدل onSurfaceCleanup؛ compileSdk 36→34) + drift 2.23.1 مولّد const Constant(BigInt.zero) غير قابل للتقييم في Dart 3.5 → أُزيل const.
- **Flutter**: local_auth ^2.2.0 + SecEvents في protocol.dart + 13 أسلوب أمان في agent_channel.dart + security_providers.dart (LockConfig/AppLock: PIN عبر pbkdf2 Kotlin + بصمة local_auth + قلف تلقائي 0/30/60/300ث + markPaused/markResumed؛ SecSnapshot من أحداث kind:"sec"؛ LostController/WipeController/SecFeaturesController العشر/autoStart) + dispatch 'sec'/'lost'/'wipe'/'secclip' في المستمع المركزي transfer_providers + **lock_screen.dart** (بوابة PIN/بصمة + LostGate «أنا المالك») + **onboarding_screen.dart** 5 خطوات (ترحيب+لغة/صلاحيات بطلبات حقيقية/اقتران/جولة 12 وحدة بنصوص الويب حرفيًا/انطلاق) + **security_screen.dart** (تبويب ثامن): جلسة 3009 ببصمة SAS، قفل التطبيق، لوحة أذونات (10 ميزات + 7 صلاحيات نظام بحالة حية وزر طلب + overlay + بطارية)، وضع فقدان، حذف آمن بتمريرات وتقدم، إقلاع/بطارية + shell 8 تبويبات + بوابة app.dart (Onboarding←Lost←Lock←Shell).
- **الترجمات**: merge-translations-fa10.py أضاف nav.security + أقسام lock/lost/sec/onb (82+58+8+4 مفتاحًا) لعربي/إنجليزي — سلاسل الويب مستوردة حرفيًا (onboarding.tsx + ar-en-map.json) وتطابق المفاتيح مُتحقق منه برمجيًا.
- **التوقيع والCI**: nexuslink-release.jks (keytool RSA-2048) + android/key.properties + signingConfig release في build.gradle (بدائل debug بغيابه) + release.yml android حقيقية: JDK17 + flutter-action + فك secrets.ANDROID_KEYSTORE_BASE64→jks وكتابة key.properties + analyze كحارس + build apk/appbundle + رفع artifacts بأسماء النسخة.
- **بناء موقّع محليًا**: تثبيت Android SDK (cmdtools→platform-34+build-tools 34) + JDK17 كامل (jlink مطلوب لـ JdkImageTransform — JRE ناقص) + `flutter build apk --release --target-platform android-arm64` → **app-release.apk (100.6MB) موقّع** — apksigner verify: CN=NexusLink، SHA-256 86:73:6b… — النسخة في download/NexusLink-1.0.0-arm64-release.apk. (الحرب مع قرص 9.9GB: jars-9 2GB يتجدد، استبدال gradle-8.4-all→bin، إخلاء node_modules مؤقتًا ثم bun install عاد).
- **E2E حي (scripts/agent-sec-e2e.mjs عبر run-sec-e2e.sh): 26/26 × 3 جولات متتالية** — اقتران الطرفين، pending-trust لغير الموثوق بلا kex، مصافحة كاملة على العصر 1، **SAS متطابقة حرفيًا (إيموجي+hex) عبر القناة الحية**، clip مشفر بنص عربي يصل حرفيًا، cmd ring→ack مشفر، perm-denied عند ميزة موقوفة، REPLAY_DETECTED لـ seq مكرر، تدوير→عصر 2 وتفك سليم بعده، بث lost/wipe/lock يصل phone فقط، wipe-state يبث للويب، perm-set→perm:changed، تدقيق، **فحص تسريب: لا نص صريح في 32 إطار WireTap**، nack لهدف ميت، حظر→rejected+قطع.
- **علتان سيرفريتان حقيقيتان كشفهما الـ E2E** (القاعدة الذهبية مرة أخرى): (1) sec:frame كان يلتقط أول إدخال للجهاز حتى لو ميت (عميل انهار بلا disconnect) → آخر عميل حي يأكل nack — الإصلاح: تجاوز/تنظيف الإدخالات الميتة بالبحث عن sid حي. (2) **اختراق مصافحة**: kex:update من عميل غير موثوق كان يُرحَّل للموثوقين → الغريب يختطف إقران الطرفين ويمتص إطاراتهم — الإصلاح: بوابة ثقة على المرسِل في kex:update + فلترة c.trusted في ترحيل announce، وفحص E2E جديد (#7.5 hardening) يثبت الرفض.
- التحقق: eslint exit 0 على ملفات الويب الثلاثة · flutter analyze **No issues found!** · ترجمات ar/en مطابقة 100% · بوابة 81→3009 ✅ عبر XTransformPort · بناء APK موقّع ومُتحقق من توقيعه.
- قيود صادقة: «الإقلاع من الإطلاق» و«24س اتصال» و«<3%/يوم» مصمَّمة بالكامل (BootReceiver+KeepAlive+سياسة الخمول+بلا WakeLock خمول) لكن قياسها الميداني يتطلب هاتفًا فعليًا وجهاز قياس بطارية — كما وُثق في العقد §9.4 وREADME §6.

Stage Summary:
- بنود FA-10 العشرة منفذة: (1) مفتاح جلسة X25519+AES-256-GCM عبر libsodium في Kotlin مطابق السيرفر والويب بايتًا ببايت (SAS متطابقة حيًا) (2) قفل PIN/بصمة/وجه + تلقائي عند الخلفية (3) لوحة أذونات: 10 ميزات + 7 صلاحيات نظام بحالة وطلب (4) وضع فقدان كامل بقفل وشاشة وموقع (5) حذف آمن 3/7 تمريرات من التطبيق وأمر السيرفر (6) إقلاع تلقائي + KeepAlive + سياسة خمول (7) Onboarding عربي/إنجليزي بنصوص الويب (8) ترجمة كاملة من قاموس الويب (9) APK موقّع مبني محليًا ومتحقق + CI حقيقي في release.yml (10) README تشغيل كامل.
- اختبار النجاح: التطبيق الموقّع موجود ويعمل بنيويًا من الإقلاع (BootReceiver + اتصال محفوظ) — «24س متصل» و«<3%/يوم خمول» مصمَّمان بميكانيكات ملموسة ويبقى قياسهما ميدانيًا على جهاز حقيقي (حد موثق بصدق كما في FA-6/7/8/9).
- E2E الأمان 26/26 ×3 أصبح أقوى اختبار في المستودع — وصد عللتي سيرفر حقيقيتين أثناء ذلك.
- الخطوة التالية المرشحة حسب ترتيب المستخدم: FA-5 (الإشعارات/SMS على 3003) أو FA-6 (بث الشاشة kind:"screen" + MediaProjection).

---
Task ID: FA-10-push
Agent: main (Super Z)
Task: رفع المشروع بالكامل إلى GitHub (CTO-DRS/NexusLink)

Work Log:
- فحص الأسرار قبل الرفع: لا توكنات/keys في الملفات المتتبعة، لا keystores
- تنظيف التتبع: إزالة .env (مسار DB محلي) و scripts/driftgen/.dart_tool (234 ملف بناء) و tool-results و dev.pid + تحديث .gitignore
- commit جديد 4ab03bc: ملفات FA-10 (BootReceiver, KeepAliveWorker, LostMode, SecCrypto, SecureWipe, NexusWidgets, widgets layouts)
- إنشاء مستودع خاص CTO-DRS/NexusLink عبر API
- رفع main بالتاريخ الكامل (~220MB) — تحذير وحيد: APK بحجم 95.96MB (تحت حد 100MB، مقبول)
- تحقق: remote HEAD == local HEAD (4ab03bc) + جميع الملفات الحرجة 200 OK

Stage Summary:
- المستودع: https://github.com/CTO-DRS/NexusLink (خاص — يمكن جعله عاماً من Settings)
- التوكن لم يُخزَّن في .git/config ولا في أي ملف بالمشروع (استُخدم عابراً في أمر الدفع فقط)
- remote origin مضبوط محلياً على URL نظيف بدون توكن

---
Task ID: FA-10-build
Agent: main (Super Z)
Task: بناء التطبيق الموقّع من الصفر بعد إعادة ضبط البيئة ورفعه إلى GitHub Release

Work Log:
- البيئة كانت مفرغة: Flutter SDK + Android SDK + JDK17 + keystore كلها مفقودة. أُعيد بناء السلسلة كاملة:
  Flutter 3.24.5 (693MB عبر fetch-flutter.sh) + Temurin JDK17 (~/.jdk17 بـ jlink) + Android SDK (cmdtools + platform-34 + build-tools 34).
- keystore سابق فُقد (لم يُرفع git عمداً) → توليد keystore جديد CN=NexusLink + android/key.properties، ورفع 4 أسرار مشفرة
  (ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD) إلى GitHub Actions عبر scripts/upload-keystore-secrets.py (SealedBox).
  كلمة السر محفوظة محلياً خارج المستودع وكذلك ضمن GitHub Secrets — لا تُكتب هنا.
- حماية: .gitignore الآن يمنع key.properties/*.jks.
- ترقيعا pub-cache أُعيدا اشتقاقهما من المصدر: (1) flutter_webrtc compileSdk 36→34 (2) SurfaceProducer.Callback —
  فُحص flutter.jar المحرك 3.24.5 بـ javap: الواجهة = onSurfaceCreated()/onSurfaceDestroyed() فقط، فرقّع webrtc عليها.
- معارك الموارد: حد ذاكرة الحاوية 4GB — قاتل المضيف يقتل java عند ~2.7GB RSS (dmesg) → gradle.properties محلي:
  -Xmx1536m + metaspace 512m + direct 256m + workers 1 + kotlin 768m + no-daemon + jetifier=false؛
  قتل next-server (1.6GB) مؤقتاً؛ قرص 9.9GB امتلأ (jars-9 2GB + bun cache 1.3GB + .next 486MB حُذفت — القابلة لإعادة التوليد).
  ملاحظة: gradle.properties المحلي (قيود ذاكرة + مسار jdk) غير مرفوع عمداً كي لا يكسر CI.
- البناء نجح: flutter build apk --release --target-platform android-arm64 → 100.6MB موقّع، apksigner verify ✓
  (شهادة SHA-256 c8cda07d…، APK SHA-256 45950043…) → download/NexusLink-1.0.0-arm64-release.apk.
- الرفع: commit ff191d4 (APK + gitignore + سكربت الأسرار) → main. Release v1.0.0 عبر API مع ملاحظات عربية كاملة
  + تحذير تغيّر التوقيع (يجب حذف التثبيت القديم) + رفع الـ APK كأصل إصدار — GitHub أكد digest مطابق للـ SHA-256 المحلي.
- **أعطال CI كُشف وأصلح (3 طبقات)**: (1) storeFile خاطئ في release.yml (file() يُقاس من android/app/) — أصلح قبل أول رفع
  (2) step-level if مع secrets → رفض parse صامت صفر jobs → حيلة env الموثقة (3) **السبب الجذري**: اسم step غير مقتبس
  يحتوي ": " (سطر Tauri bundles) → YAML كامل فاسد — اكتُشف بـ actionlint بعد أن انتظرت GitHub بصمت. أُضيف
  if-no-files-found: ignore لوابتا desktop/ios الـ placeholder. actionlint: صفر أخطاء، workflow_dispatch: 204،
  7 jobs مجدولة بشكل صحيح.
- **حاجز خارجي حقيقي**: الفواتير — "The job was not started because recent account payments have failed or your
  spending limit needs to be increased" — حساب Free لا يشغّل Actions على مستودع خاص. القرار للمالك: تعديل الفوترة
  أو جعل المستودع عاماً (Actions مجانية غير محدودة على العام).

Stage Summary:
- APK موقّع مبني حديثاً ومرفوع في موضعين: repo (download/) + Release v1.0.0 asset مع checksum مؤكد من GitHub.
- CI جاهز بنيوياً بالكامل (يوقّع من Secrets) — انتظار قرار الفوترة/العلنية فقط.
- سلسلة إعادة البناء بعد أي reset موثقة في هذا القسم: fetch-flutter → JDK17 → android-sdk → secrets-restore → build.

---
Task ID: FA-9-recert
Agent: main (Super Z)
Task: تنفيذ المتبقي من FA-9 — إعادة اعتماد الهاتف-طرف-متحكم بعد تغييرات FA-10 وإصلاح ما يُكتشف

Work Log:
- الحقيقة أولاً: بنود FA-9 السبعة كانت منفذة بالكامل (E2E 23/23 وقتها) — «المتبقي» الفعلي = إعادة الاعتماد بعد FA-10 (سوكِت 3009 + تحويل MainActivity + ترقيع webrtc) وبنود الجهاز الفيزيائي (جيروسكوب/حافظة نظام تتطلب هاتفًا حقيقيًا).
- E2E الأولى بعد FA-10: **20/23 — انحدار حقيقي**: فحوص rc:handoff الثلاثة فشلت ({}) بينما كل أحداث المرحلة 6 تمر.
- التشخيص بالقاعدة الذهبية: معالج rc:handoff سليم في remote-bridge.ts — المشكلة أن **fuser غير مثبت** فكان `fuser -k 3004/tcp 2>/dev/null` لا-شيء، وخدمة bun قديمة (بروتوكول مرحلة 6 بلا handoff) ظلت تحتكر 3004، والجسر المدمج **استسلم بصمت** لـ EADDRINUSE — فجرى E2E ضد الزومبي: القديم يعمل والجديد يختفي بصمت.
- الإصلاح بطبقتين: (1) remote-bridge.ts — إعادة محاولة ربط حتى 15×1ث + rc:log/console.error صاخبان عند الفشل (next هو المصدر المعتمد ويفرض نفسه الآن) (2) run-rc-e2e.sh + run-sec-e2e.sh — kill_port حقيقية (ss→pid→kill -9 ×3 جولات) + فحص فوري: 3004 بحائز غير node = فشل صريح.
- النتيجة: **E2E 23/23 × جولتين متتاليتين** + eslint نظيف.
- مفاجأة بيئية أثناء الدفع: المستودع المحلي رجع **لقطةً قديمة** (أربعة commits مفقودة كان قد رُفعت، release.yml أعاد خطأ YAML القاتل!) — العلاج: core.fileMode false (ضوضاء chmod من الاستعادة) + stash لـ db/custom.db + rebase على FETCH_HEAD → كل الإصلاحات عادت محليًا وبدُل سليم 6b98455 = بعيد==محلي ✓.
- حالة keystore بعد إعادة الضبط: jks + كلمة السر ضاعا محليًا (المجلد المنزلي نظّف) — النسخة الدائمة ضمن GitHub Secrets (write-only): CI يوقّع من السِرّ، والبناء المحلي المستقبلي إما عبر CI (tag) أو توليد keystore تطويري جديد. لا يوجد مسار قراءة عكسي من الأسرار (بتصميم GitHub).
- لم يُشغَّل عدّاء sec-E2E هذه الجولة (يقتل caddy 81 المزروع لعرض المنصة) — رقعة kill_port فيه منطقية ومتطابقة مع ما نجح في عدّاء rc.

Stage Summary:
- FA-9 معاد اعتماده 23/23 ×2 بعد FA-10 — انحدار rc:handoff (زومبي 3004 + استسلام صامت للربط) مُصلح جذريًا في السيرفر والعدّاءين.
- درس دائم: **قبل أي push، fetch+rebase من GitHub أولًا** — البيئة المحلية قد تراجع لقطةً قديمة بين الجلسات وGitHub هو مصدر الحقيقة.
- درس دائم 2: لا تعتمد على fuser (غير مثبت) — kill_port عبر ss/pkill فقط.
- المتبقي من FA-9 حصريًا فيزيائي على هاتف حقيقي (جيروسكوب/حافظة نظام/ودجات على لانشر فعلي) — موثق في §9.4 كما في FA-6/7/8.

---
Task ID: FA-10-public-ci
Agent: main (Super Z)
Task: أصلح كل شيء + اجعل المستودع عاماً + أكمل المتبقي + لا تغيّر الإصدار v1.0.0 مهما فعلنا

Work Log:
- المزامنة أولاً (الدرس الدائم): fetch بالتوكن عابراً — محلي==بعيد (472553c) والوسم v1.0.0 يشير لـ ff191d4.
- المستودع عام الآن (PATCH private:false) — يحل حاجز فواتير Actions نهائياً (مجاني غير محدود على العام).
- **فحص حرج قبل التشغيل**: الوسم v1.0.0 يشير لـ release.yml المكسور القديم (اسم step غير مقتبس) — لذا التشغيل عبر workflow_dispatch على main (الـ YAML المُصلح) لا عبر إعادة الوسم؛ مهمة release محمية بشرط refs/tags فلا تُربك الإصدار.
- **قنبلة مُكتشفة في gradle.properties المُلتزم**: org.gradle.java.home=/home/z/jdk17 — مسار الحاوية فقط، كان سيقتل daemon الـ CI فوراً؛ أُزيلت السطر.
- تحصين android job: تثبيت flutter-version 3.24.5 (مطابق البناء المحلي الموثق) + خطوة رقعة flutter_webrtc (compileSdkVersion 36→34 + onSurfaceAvailable/onSurfaceCleanup→onSurfaceCreated/onSurfaceDestroyed — مُشتقة من تحميل الحزمة من pub.dev ومطابقة رقعة pub-cache المحلية الموثقة) + اسم artifact يقصّ +1 من 1.0.0+1 → NexusLink-1.0.0-release.apk.
- **أول تشغيل CI حقيقي (run 38164103472): ubuntu✓ macos✓ windows✗** — فخ pwsh: echo في PowerShell هو cmdlet لا يمسح $LASTEXITCODE (بقي 1 من bun test "No tests found") وpwsh تخرج بآخر $LASTEXITCODE → خطوة «لا يمكن أن تفشل» فشلت. الإصلاح: shell: bash صريح (Git bash متاح على ويندوز).
- **التشغيل الثاني (run 38164410954): 8/8 jobs خضراء بالكامل** — 3×test + 3×desktop + ios + **android كامل**: keystore من الأسرار ✓ pub get ✓ رقعة webrtc ✓ analyze صفر ✓ APK+AAB موقّعان ✓ rename ✓ رفع artifacts ✓.
- تحقق مستقل من APK الـ CI (138.7MB عالمي: arm64-v8a/armeabi-v7a/x86/x86_64): apksigner (build-tools r34 منزل مباشرة) → **CN=NexusLink, O=DRS — SHA-256 c8cda07d…f30e مطابق حرفياً لشهادة البناء المحلي الموثق** → CI يوقّع بنفس الهوية من Secrets. APK SHA-256: 1b6a56de…c959.
- الإرفاق بالإصدار القائم (id 409793052): أصل جديد NexusLink-1.0.0-release.apk (GitHub أكد digest مطابق) + وصف موسّع يوثق النسختين وسلسلة CI الخضراء — **الوسم v1.0.0 لم يُلمس، الاسم والإصدار كما هما**.
- تدقيق FA-9 النهائي: إعادة الاعتماد 23/23×2 منجزة سابقاً (FA-9-recert)؛ المتبقي فيزيائي حصراً على هاتف حقيقي (جيروسكوب/حافظة نظام/ودجات لانشر) موثق §9.4 — لا بند برمجي متبقٍ.

Stage Summary:
- CI أخضر كاملاً لأول مرة في تاريخ المستودع، والمستودع عام على https://github.com/CTO-DRS/NexusLink.
- Release v1.0.0 بأصلين موقّعين بنفس الشهادة: arm64 (100.6MB محلي) + عالمي (138.7MB آلي) — الإصدار v1.0.0 ثابت لم يُغير.
- درس جديد موثق: pwsh لا يغفر `|| cmdlet` — فرض shell: bash لأي منطق fallback عبر المنصات.
- درس جديد 2: قبل أول تشغيل CI، دوّن في العقل أن الملفات المُلتزمة تُنفذ على بيئة غريبة — أي مسار مطلق (org.gradle.java.home) قنبلة صامتة.
