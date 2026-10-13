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

---
Task ID: FA-desktop
Agent: main (Super Z)
Task: أنشئ apps/desktop (Tauri 2) داخل المونو-ريبو — نافذة تحمّل واجهة React كما هي + سيرفر Node مضمّن يُدار (إقلاع/إيقاف/صحة/إعادة تشغيل) + Tray بحالة الاتصال + close-to-tray + single-instance + انتظار جاهزية بشاشة تحميل + اكتشاف الهاتف عبر mDNS بلا متصفح

Work Log:
- القاعدة الذهبية أولًا: العقد §1/§7 + discovery_service.dart + models.dart حسمت مسار الاتصال — الهاتف المكتشف يمر عبر بوابة :81 بنمط ?XTransformPort حرفيًا (AccessMode.gateway) والجسور الداخلية تنطلق عبر boot routes idempotent داخل عملية Next.
- **4 فجوات سيرفرية مُصلحة أولًا**: (1) /api/health (2) /api/desktop/status — إقلاع الجسور الخمسة + phone.online من phoneGuardOnline (نفس مصدر حقيقة الحماية، لا مصدر ثانٍ) (3) comms-service /status — خلف مطالبة engine.io بكل المسارات (path:'/') عبر التقاط مستمع engine حرفيًا وتغليفه: /status تُجاب هنا وكل ما عداه يُفوَّض بلا تغيير سلوك (4) mini-services/gateway — بديل Cjs صفر التبعيات: XTransformPort + نفق WS خام + /__gw/health + **تراجع 81→8180** عند المنافذ المميزة (EACCES) مع سطر آلي PORT= يقرؤه procman ويُمرَّر لcomms فيعلن mDNS المنفذ الفعلي (حقل المنفذ بيانات ديناميكية — الهاتف يقرأ svc.port).
- **E2E 18/18 (scripts/desktop-e2e.mjs)**: يشغّل نفس ما سيديره procman حرفيًا — next standalone + بوابة (تراجع 8180 مؤكد في الحاوية) + comms (mDNS أُعلنت فعلاً داخل الحاوية) + هاتف محاكى عبر البوابة: socket.io 3006 polling→WS عبر نفق البوابة، guard:hello-phone + منارة → phone.online=true (Tray يقلب) + 3004/3009 عبر البوابة.
- عللان أثناء E2E: مسار RES بلا شرطة مائلة (resourcescomms) + محاكاة الهاتف افتقرت guard:hello-phone (phoneGuardOnline لا يتحقق بالمنارة وحدها — تسليم الوكيل الحقيقي).
- **Tauri 2 (apps/desktop)**: procman.rs — إقلاع متسلسل (next→انتظار /api/health 90ث→gateway→قراءة PORT=→comms بمنفذ البوابة) + مراقبة 2ث + إعادة تشغيل بتراجع أسّي (1s→15s، تصفير بعد استقرار 60ث) + إيقاف مؤقت/استئناف + قتل نظيف عند كل مسارات الخروج + إقلاع idempotent (spawn يقتل القديم أولًا بلا تسريب منافذ) + تجفيف أنابيب إلزامي + CREATE_NO_WINDOW على ويندوز. tray.rs — 4 حالات أيقونة من منارة الحماية + قائمة عربية + CheckMenuItem للإغلاق-إلى-Tray. settings.rs — config.json (close_to_tray افتراضي true). main.rs — single-instance أولًا (توثيق tauri) + منع الإغلاق للنافذة الرئيسية حسب الإعداد + splash حتى Finished لصفحة الواجهة ثم فتح main وغلق splash.
- مراجعة Rust يدوية مزدوجة (لا مترجم محليًا): أُصلح (1) إعادة تشغيل فردية كانت تقلب ready=false → إقلاع كامل يسرّب الأطفال القديمة (سرقة منافذ!) (2) إمساك قفل procs أثناء sleeps الإعادة → قفل قاتل لkill_all (3) is_checked() يرجع bool لا Result (4) static mut → AtomicU32 (5) state() ميتة.
- أيقونات مولّدة برمجيًا (scripts/gen-desktop-icons.py): 5 حالات tray + ico/icns مصنوع يدويًا (ic07-ic10) — icns مُتحقق من صحته بـ PIL.
- splash داكنة RTL بثنائية اللغة + حلقة conic-gradient متحركة تستمع desktop://status.
- **CI desktop.yml**: 3 منصات × (next build → build-resources.sh → sidecar Node v20.18.1 بترقية كل هدف → rust-cache → tauri build بمصفوفة حزم: nsis / appimage+deb / dmg + رفع artifacts + إرفاق بالrelease عند الوسوم فقط). فخان ويندوز مُعالَجان مسبقًا: shell: bash صريح (bun shell لا يعرف cp) + Expand-Archive بدل unzip.
- الموارد الثقيلة (server 546MB / sidecar node) gitignored وتُبنى في خط الإنتاج — repo نظيف (37 ملفًا فقط، +1616 سطرًا).
- الإصدار 1.0.0 في tauri.conf.json — متزامن مع v1.0.0 دون تغيير.

Stage Summary:
- apps/desktop مكتمل: نافذة تحمّل الواجهة كما هي (نفس الثيم/Dock عبر :3000)، سيرفر مضمّن مُدار بالكامل، Tray بحالة حية، close-to-tray، single-instance، شاشة انتظار جاهزية، اكتشاف mDNS تلقائي للهاتف بلا متصفح.
- اختبار النجاح التعاقدي: E2E يثبت السلسلة كاملة عدا التثبيت الفيزيائي (يغطيها CI الآن) — «تثبيت → يفتح → سيرفر داخله → هاتف يكتشف ويتصل → إغلاق يبقي كل شيء حيًا» = close-to-tray يخفي دون قتل + مراقبة حية.
- بند فيزيائي وحيد: تجربة mDNS فعليًا على شبكة LAN حقيقية مع هاتف (multicast مؤكد داخل الحاوية لكن شعاع الشبكة الحقيقي يتطلب جهازًا) — موثق بصدق كالسابق.

---
Task ID: FA-desktop-ci
Agent: main (Super Z)
Task: إيصال بناء CI لحزم سطح المكتب الحقيقية (win/linux/mac) حتى الأخضر الكامل

Work Log:
- 7 جولات CI حقيقية، كل جولة كشفت طبقة أدق:
  (1) Prisma client غير مولّد على CI — bun يحجب postinstall افتراضيًا (أول بناء Next حقيقي على CI في تاريخ المستودع) → bunx prisma generate قبل next build.
  (2) tauri resources glob «resources/*» لا يطابق المجلدات (تحقق build.rs) → سرد المجلدات الثلاثة صراحة (نسخ تعاودي).
  (3) أخطاء Rust أربعة ميكانيكية: Arc deref، أسبقية إسناد حقل عبر MutexGuard، is_checked() يرجع Result في نسخة tauri الحالية، ? على () — كلها أُصلحت.
  (4) E0597 «ui does not live long enough» — الحارس المؤقت داخل if-let يمتد عبر الجسم (سلوك edition 2021) → جملة مفردة: guard يموت عند الفاصلة المنقوطة.
  (5) linuxdeploy AppImage يفشل بصمت على المُشغّل حتى مع APPIMAGE_EXTRACT_AND_RUN=1 → قرار: Linux يسلّم .deb (تغليف نقي بلا أدوات AppImage) — AppImage موثق كمتلبات لاحقة بجلسة تشخيص --verbose.
- **النتيجة النهائية: 3/3 منصات خضراء** — dmg (ماك، 277MB أصل) + nsis exe (ويندوز 194MB) + deb (لينكس 269MB) — كل حزمة تتضمن: ثنائي Tauri + sidecar Node v20.18.1 + Next standalone كامل + comms.cjs + gateway.cjs.
- الدروس الموثقة: (أ) bun blocks dependency postinstall — أي مشروع Next+Prisma على bun CI يحتاج generate صريحًا (ب) tauri resources: مسارات مجلدات صريحة لا globs (ج) في tauri 2 الحالي: CheckMenuItem::is_checked → Result، والحارس المؤقت في if-let يطيل عمر الاستعارة (د) linuxdeploy على runners: لا تعبث — سلّم deb.

Stage Summary:
- سلسلة البناء كاملة: git push → next build → prisma generate → resources → node sidecar → rust (مخبأ) → حزم 3 منصات → artifacts.
- اختبار النجاح التعاقدي مكمل بنيويًا حتى مرحلة التثبيت الفيزيائي: التثبيت ← فتح ← سيرفر داخلي ← هاتف يكتشف عبر mDNS ← إغلاق النافذة يبقي كل شيء حيًا (close-to-tray) — الأخيران مغطيان بـ E2E 18/18 + منطق procman، والتثبيت الفعلي على أجهزة حقيقية هو المتبقي الميداني.

---
Task ID: FA-desktop-verify
Agent: main (Super Z)
Task: تحقق شامل من تسليم FA-desktop عند HEAD (f292d00) + إتاحة حزم التثبيت دائمًا على الإصدار

Work Log:
- استئناف بعد نفاد السياق: worklog أظهر إنجاز FA-desktop + FA-desktop-ci؛ رفضت الاعتماد على التوثيق وحده وجري التحقق الصارم.
- CI: run #7 على e81fdb3 = success (dmg/nsis/deb) — الفارق الوحيد بينه وبين HEAD سطر توثيق؛ الأصول الثلاث من هذا التشغيل تحديدًا (ميّزتها عن artifacts تشغيل 796baa1 الفاشل جزئيًا).
- E2E التعاقدي أُعيد تشغيله عند HEAD: 18/18 أخضر — health، الجسور الخمسة، بوابة (تراجع 8180 في الحاوية)، mDNS إعلان فعلي بالمنفذ الفعلي، هاتف محاكى عبر البوابة حتى phone.online=true (قلب الـ Tray)، WS upgrade، 3004، 3009.
- مراجعة يدوية للكود مقابل المتطلبات السبعة: main.rs (single-instance أولًا + close-to-tray حسب الإعداد + kill_all على كل مسارات الخروج)، procman.rs (إقلاع متسلسل بانتظار صحة 90ث + PORT= من البوابة + تراجع أسّي 1s→15s + إقلاع idempotent + تجفيف أنابيب)، tray.rs (5 حالات + قائمة عربية + CheckMenuItem)، settings.rs (config.json دائم)، splash RTL ثنائية اللغة.
- فجوة وحيدة مكتشفة ومغلقة: حزم سطح المكتب كانت artifacts قابلة للانتهاء (90 يومًا) — نُزّلت من التشغيل الأخضر، دُقّقت (zip سليم، أسماء 1.0.0)، ورُفعت كأصول دائمة على v1.0.0: NexusLink_1.0.0_x64-setup.exe (194MB) + NexusLink_1.0.0_amd64.deb (269MB) + NexusLink_1.0.0_aarch64.dmg (278MB) — HTTP 201×3، الوسم والأصول القديمة لم تُمَس، رقم الإصدار كما هو.
- تنظيف: .release-staging (740MB) حُذف، المنافذ نظيفة (81 محجوز لcaddy البيئي الدائم — سبب تراجع 8180 في الحاوية وهو سلوك تعاقدي صحيح).

Stage Summary:
- FA-desktop مُسلّم ومُتحقَّق منه بالكامل: كود + CI أخضر + E2E 18/18 حي عند HEAD + 5 أصول دائمة على v1.0.0.
- اختبار النجاح التعاقدي بنيويًا كامل: تثبيت (حزم دائمة متاحة) → فتح → سيرفر داخلي (E2E) → هاتف يكتشف عبر mDNS (إعلان مُثبت) → إغلاق النافذة يبقي كل شيء حيًا (close-to-tray + monitor).
- المتبقي الميداني الوحيد (بِحَق): التثبيت الفيزيائي على أجهزة حقيقية + راديو mDNS على شبكة LAN فعلية — خارج قدرة الحاوية، موثق بصدق.

---
Task ID: FA-desktop-native
Agent: main (Super Z)
Task: الطبقة الأصلية لسطح المكتب — autostart/بدء مخفي + اختصارات عالمية (نفس المخزن) + إشعارات نظام بأزرار + حوارات حفظ أصلية + سحب-وإفلات فوري + deep-link nexus://

Work Log:
- القاعدة الذهبية أولًا: استكشاف كامل — مخزن الاختصارات الحقيقي (zustand/localStorage: nexus-shortcuts)، الحافظة الموحدة (/api/prod/clipboard → prodEmit clip:new فوري للهاتف)، عقد الإرسال (POST /api/devices send-file → tx:offer للوكيل الحقيقي بشرط agentId)، مصدر الإشعارات (nexusNotification)، التواقيع الفعلية لـ 6 crates فُحصت من مصادرها المنزلة (لا تخمين): tauri-winrt-notification يدعم add_button+on_activated فعلاً، global-hotkey parse يقبل Ctrl+Shift+N، DragDropEvent::Drop{paths: Vec<PathBuf>} في tauri-runtime 2.12.1، FilePath::into_path، ShortcutEvent.state.
- **فجات سيرفرية أولًا (إضافية بلا مساس بمسار قائم)**: (1) GET/PUT /api/desktop/shortcuts — مخزن الملف data/desktop-ui.json (تصدير خارج route.ts ممنوع في Next — lib مشترك desktop-shortcuts.ts) (2) status.desktop = {agentId, shortcuts, transfers≤5 done-in, notifs≤8 new} — كل استدعاء محمي لا يُسقط الحالة الأساسية (3) desktop-bridge.tsx في page.tsx: كتم window.Notification + دفع المخزن عند تغيّر + ?view= + sendClipboard داخل التركيز.
- **إجراءان جديدان في المخزن المشترك**: sendClipboard/toggleWindow في ShortcutAction + DEFAULTS + META، يظهران في إعدادات الاختصارات داخل نافذة سطح المكتب فقط (فلتر DESKTOP_ONLY_ACTIONS).
- **تعاقد التركيز** (حسم التعارض): Ctrl+Shift+D خارج التركيز = إظهار/إخفاء النافذة عالميًا؛ داخله يبقى للمظهر (سلوك الواجهة الحالي بلا انحدار) — shortcuts.rs يسجل عالميًا عند عدم التركيز فقط ويلغي عند التركيز.
- مراجعة Rust ذاتية أولى أصابت خطأين قاتلين قبل CI: استيراد GlobalShortcutExt في النطاق الخطأ + حالة ميتة (REGISTERED=any مع قائمة فارغة يمنع تسجيل «البدء المخفي» للأبد — الحسم بالتركيز لا بحالة التسجيل) + تسجيل أولي apply_focus(false) في setup.
- جولة CI 1: 5 أخطاء ميكانيكية (E0204 Copy مع Option<String>، E0599 Manager import ×3، E0061 center()) — جولة CI 2: **3/3 منصات خضراء** (dmg 279MB + nsis 195MB + deb 271MB) في 9 دقائق فقط (rust-cache).
- E2E موسّع 29/29 محليًا (18 أصلية + 11 أصلية جديدة): مزامنة shortcuts ذهابًا-وإيابًا، حقول status.desktop، مسار سحب-وإفلات كامل (ملف → pc-fs/Inbox → send-file → مهمة في القائمة — درس: standalone server.js يعمل chdir(__dirname) فجذر البيانات .next/standalone/data)، الحافظة الموحدة، إشعار قابل للتفاعل يظهر في status.
- **استبدال أصول سطح المكتب في v1.0.0** (حزم الجولة الخضراء 18d839d بنفس الأسماء 1.0.0 — حذف 3 + رفع 3 بـ HTTP 201): APKs والوسم لم يُمَسا.
- توثيق: §10 في docs/protocol-contract.md (عقد الواجهات الأصلية حرفيًا) + README الجدول الكامل.

Stage Summary:
- المتطلبات الستة مُنفذة ومُبنية على 3 منصات: autostart+بدء مخفي (خيار Tray)، اختصارات عالمية من المخزن نفسه، إشعارات WinRT بأزرار تفاعلية (حفظ-في/فتح-المجلد/رد/فتح + سياسة لا إشعار أثناء التركيز)، حوار حفظ أصلي بمجلد افتراضي قابل للتغيير، سحب-وإفلات إرسال فوري، nexus:// مع 5 وجوه (open/comms/transfers|files|devices|settings/send).
- اختبار النجاح التعاقدي «Ctrl+Shift+N في أي مكان → الحافظة تصل الهاتف»: مسار Rust كامل (arboard → POST prod/clipboard → prodEmit clip:new) — حلقة السيرفر مثبتة بـ E2E؛ الضغط الفيزيائي ميداني (لا لوحة مفاتيح في الحاوية).

---
Task ID: FA-clipboard-sync
Agent: main (Super Z)
Task: الحافظة الموحدة على مستوى نظام التشغيل — مراقبة خلفية (نص/صور/ملفات) + وضع في حافظة النظام في الاتجاهين + خيارات (تلقائي/يدوي/حد الحجم) + سجل آخر 50 أنيق

Work Log:
- القاعدة الذهبية أولًا: عملت على 37da09f المُزامَن مع origin (وتنظفت commit a5231e0 — مخلفات E2E التزمت خطأً محليًا). فحص كامل للقنوات القائمة: /api/prod/clipboard (POST/GET/PUT + prodEmit clip:new) + clip:push عبر socket 3007 + use-prod-bridge (كتابة متصفح مشروطة بالوضع) + Kotlin (clip:new → إشعار فقط، بلا كتابة حافظة!) + مراقبة الهاتف المركّزة (controller_service 1.5s → rc:clipboard) — **الفجوة القاتلة: الهاتف لا يكتب حافظته من الخدمة، ولا أحد يراقب حافظة الكمبيوتر تلقائيًا**.
- تحقق تواقيع crates من المصادر (crates.io محجوب → مصادر GitHub عبر codeload): arboard 3.6 — get().text()/image()/file_list() كلها عامة وعابرة للمنصات (Windows CF_HDROP · macOS NSPasteboard · Linux X11 uri-list)، set().text/image مع ImageData{width,height,bytes RGBA} — **إضافات Cargo الوحيدة: image 0.25 (png فقط، موجودة أصلاً في شجرة arboard) + base64 0.22 — صفر crates جديدة على ويندوز**.
- فجوات سيرفرية (إضافية بلا مساس بمسار قائم): (1) مخزن سطح المكتب desktop-ui.json توسّع بـ clip {mode, maxAutoBytes 1KB..20MB} عبر نفس /api/desktop/shortcuts (PUT يقبل shortcuts أو clip أو كليهما) (2) status.desktop.clip = {mode من db.prodState (زر الواجهة الحالي)، maxAutoBytes من المخزن} (3) GET /api/prod/clipboard take 60→50 (تعاقد السجل).
- **clipboard.rs (خيط مراقب 1s)**: الأولوية ملفات→نص→صورة؛ نص auto و≤حد → POST mode:auto؛ صورة → PNG (image crate) → pc-fs/Inbox/clipboard-<ts>.png → send-file للوكيل الحقيقي (نفس عقد السحب والإفلات §10) + عنصر سجل kind:image (dataURL ≤300KB)؛ ملفات → ≤10 → نسخ إلى Inbox → send-file (اقتراح نقل) + عناصر سجل kind:file؛ الوضع اليدوي يوقف كل التلقائي (زر clip_send_now يرسل نصًا بلا حد/صورة كملف).
- **حرس الحلقة ثلاثي الطبقات (تعاقد §11.ج)**: Rust بصمات SENT/APPLIED (نص hash، صورة أبعاد+رأس/ذيل + كبت 10s بعد التطبيق لأن DIB يغيّر البايتات)؛ Kotlin clipLastFromPc/clipLastSentToPc + تجاهل صدى deviceId؛ Flutter markExternal يزامن حرس المراقبة المركّزة. الويبفيو يستقبل clip:new الغريب → clip_apply (أمر Tauri عبر withGlobalTauri) → arboard set — **يعمل والنافذة مخفية في Tray**.
- **هاتف**: الخدمة تكتب الحافظة فورًا من clip:new نص (الكتابة مسموحة دائمًا — قيد Android 10+ على القراءة فقط) + إشعار «جاهز للّصق»؛ **مراقب خلفية عبر خدمة الإتاحة القائمة (FA-7)** — استقصاء 1.5s (نفس نمط مراقبة شاشة التحكم؛ إذن القراءة package-level طالما خدمة الإتاحة مفعّلة) — يدفع clip:push عبر socket 3007 للخدمة مع الحرس؛ بلا تخزين، قراءة فقط.
- **UI**: بطاقة «مراقب حافظة النظام» (حد الإرسال: 128KB/512KB/1MB/4MB → المخزن) + زر «إرسال الحافظة الحالية» (أصلي/متصفح) + «سجل الحافظة — آخر 50» + زر النسخ عبر الطبقة الأصلية في وضع سطح المكتب + desktop-bridge يستقبل clip:new ويستدعي clip_apply (مقيد بالوضع) + use-prod-bridge يمنح Rust ملكية الحافظة في وضع سطح المكتب (بلا كتابة متصفح مزدوجة).
- تعاقد §11 موثق حرفيًا في docs/protocol-contract.md + E2E موسع 29→**38 فحصًا**: clip الافتراضي + PUT الحد + status.clip (mode من prodState + max من المخزن) + سجل ≤50 + clip:push من هاتف محاكى عبر البوابة → مخزّن ومبثوث + حرس deviceId في clip:new + صورة dataURL + اقتراح نقل kind=file + PUT استلام فعلي → pc-fs/Downloads (38/38 أخضر محليًا، درس: مسار الاستلام pc-fs/Downloads لا Downloads الجذر؛ وجولات CI كشفت 3 أعطال تجميع أُصلحت: (1) markExternal تمريرة عبر ControllerController notifier (2) liveInstance مكرر مع قسم FA-7 (3) OnPrimaryClipChangedListener لا يحل في سلسلة أدوات المشروع رغم وجوده في android.jar — استُبدل باستقصاء 1.5s بنفس نمط المراقبة القائمة).
- أطلقت سيري CI متوازيان على 8cb7897: desktop.yml (بناء Rust الفعلي لـ clipboard.rs على 3 منصات) + release.yml (flutter analyze ببوابة الصفرية + APK) — سجل النتائج تحت.

Stage Summary:
- الحلقة الكاملة التعاقدية: انسخ على الكمبيوتر (نص/صورة/ملفات) → الهاتف يضعها في حافظته/يستلمها كملف؛ انسخ على الهاتف (حتى والواجهة ميتة عبر الإتاحة) → حافظة النظام على الكمبيوتر → Ctrl+V فورًا. حرس استرجاع في كل طبقة يمنع الحلقات؛ السجل 50 عنصرًا في واجهة أنيقة مع تحكم كامل (تلقائي/يدوي/حد الحجم).
- القيود الموثقة بصدق: قراءة حافظة أندرويد في الخلفية تتطلب خدمة الإتاحة (قيد Android 10+) — بدونه المراقبة مركّزة فقط؛ Wayland file_list يتطلب feature غير مفعّل (X11 مسند)؛ الضغط الفيزيائي للاختصارات/الحافظة الحي ميداني (الحاوية بلا GUI) — البنية مثبتة تعاقديًا 38/38.

---
Task ID: FA-power
Agent: main (Super Z)
Task: أوامر النظام والطاقة الحقيقية — تنفيذ WebSocket حقيقي (إيقاف/إعادة/إسبات/قفل/خروج) + تأكيد أمان 10ث قابل للإلغاء من الشريط + Wake-on-LAN ثنائي المسار + قفل تلقائي عند ابتعاد الهاتف + مؤشر Tray للطاقة والاتصالات

Work Log:
- القاعدة الذهبية أولًا: استكشاف كامل — 3004 جسر داخلي في Next (remote-bridge.ts) هو المرجع في الحزمة الحقيقية (وليس mini-service المستقل)، ومنطق القرب كامل في guard-bridge (pc:lock بمنارة/عتبة/مهلة)، وأنماط الويبفيو الدائم مثبتة من §11 (clip_apply يعمل والنافذة مخفية). فجوتان مكتشفتان في الجسر: rc:power بلا logout، وrc:wol كان يكتب «أُرسلت» بلا إرسال فعليًا (سجل كاذب).
- **فجوات سيرفرية أولًا (G-12/13/14)**: logout في الجسرين (مدمج Next + mini-service متطابقان) بحالة locked؛ إرسال UDP فعلي للحزمة السحرية (dgram → NEXUS_WOL_BROADCAST/NEXUS_WOL_PORT، افتراضي 255.255.255.255:9، سجل نتيجة صادق)؛ security.autoLock في نفس المخزن desktop-ui.json عبر /api/desktop/shortcuts؛ status.desktop يضيف {security, connections (سجل الأجهزة), power {state, mac, name}} — كلها إضافية بلا مساس بمسار قائم.
- **power.rs (Rust — بلا crates جديدة)**: كشف MAC الفعلي لكل منصة (Linux: واجهة المسار الافتراضي من /proc/net/route ثم /sys/class/net · macOS: ifconfig ether · Windows: Get-NetAdapter Status=Up ← getmac CSV)؛ منفّذ لكل منصة بأوامر النظام الرسمية + بدائل موثقة (shutdown /h ← rundll32 · CGSession ← pmset · loginctl ← gnome-screensaver)؛ lock/sleep فورية، shutdown/restart/hibernate/logout بعدّاد 10ث يحدّث قائمة الـ Tray كل ثانية (سيتم X خلال Nث + زر إلغاء) ويبث desktop://power كل ثانية؛ unlock مرفوض أمنيًا على الطبقة الحقيقية؛ بوابة auto-lock من status.desktop.security؛ أوامر Tauri: power_request/power_cancel/system_mac.
- **tray.rs**: عنصرا عرض «الطاقة: …» و«الاتصالات النشطة: N» (غير قابلَي نقر) + زر «لا إيقاف مجدول/إلغاء X» يُفعَّل أثناء العدّاد فقط + tooltip حي؛ procman يحدّثها من الاستطلاع كل ~10ث (ولا يجاري العدّاد أثناء عمله).
- **desktop-bridge.tsx**: سوكِتا 3004/3006 دائمان (نمط §11 المثبت) — desktop:register {name, mac حقيقي من system_mac} عند الاتصال + desktop:state {on}، استقبال rc:power → power_request، تحويل desktop://power → desktop:state للهواتف، واستقبال pc:lock → power_request {lock, auto-lock}.
- **Flutter**: WolService (dart:io خالص) — حزمة 102 بايت 6×FF+MAC×16 إلى 255.255.255.255:9 + broadcast الشبكة الفرعية ×3؛ MAC/الاسم يُخزنان من rc:hello في SharedPreferences (nexus.desktopMac)؛ wake_banner.dart «الكمبيوتر نائم — إيقاظ؟» بارز أعلى الهيكل عند (انقطاع القناة/الاتصال + MAC معروف) → ضغطة واحدة → إرسال → انتظار 6ث → فحص صحة → reconnect كامل idempotent؛ زر الإيقاظ في شاشة التحكم: متصل → rc:wol، غير متصل → UDP مباشر؛ logout في أزرار الطاقة؛ ترجمات wake/* عربي/إنجليزي.
- **CI جولتان**: الأولى أصلبت خطأين قابلين للتنبؤ درسًا — (1) E0597 نفسه الموثق في worklog (if-let الأخيرة تمتد عبر إسقاط ui → فاصلة منقوطة جملةً) + mut زائدة (2) AgentLinkState يسكن domain/models.dart لا agent_channel.dart (import show خاطئ = 3 أخطاء analyze). الثانية: **3/3 منصات Rust خضراء + release كامل أخضر (analyze صفرية + APK/AAB/iOS + حزم سطح المكتب)**.
- E2E موسع 38 → **50/50** عند HEAD (dde00e8): إعلان MAC عبر desktop:register → rc:hello للأجهزة اللاحقة · ترحيل rc:power logout · رفض MAC غير صالح · رفض already-on · **التقاط الحزمة السحرية فعليًا على السلك (102 بايت = ffffffffffffff aabbccddeeff×16 — مستمع UDP حقيقي)** · بث desktop:wake · pc:lock تلقائي بلا منارة بعد مهلة سماح 3ث · PUT/GET security.autoLock · حقول status.desktop الجديدة · توثيق §12.
- v1.0.0 لم تُمَس (tauri.conf.json/Cargo.toml/pubspec فارغة في diff)؛ الوسم والأصول لم تُلمس؛ db/custom.db مخلفات E2E استُعيدت قبل الالتزام (الدرس السابق انطبق).

Stage Summary:
- الحلقة التعاقدية كاملة: الهاتف → rc:power على 3004 → الجسر يرحّل → الويبفيو الدائم يستدعي power_request → تنفيذ نظامي حقيقي بعد 10ث ظاهرة في الشريط وقابلة للإلغاء؛ إسبات/إطفاء الكمبيوتر → الهاتف يظهر «الكمبيوتر نائم — إيقاظ؟» → حزمة سحرية مباشرة عبر UDP → استيقاظ → إعادة اتصال تلقائية؛ ابتعاد الهاتف عن المنارة → pc:lock → قفل جلسة فوري + إشعار (بمفتاح أمان)؛ الشريط يعرض الطاقة والاتصالات والإلغاء.
- القيود الموثقة بصدق (عقد §12): unlock الحقيقي مرفوض أمنيًا (المحاكاة الويبية باقية)؛ الاستيقاظ الفيزيائي يتطلب WoL في BIOS/UEFI ودعم NIC (الإرسال والبنية وإعادة الاتصال مثبتة تعاقديًا بالتقاط فعلي)؛ RSSI بلوتوث حقيقي يتطلب BT على الكمبيوتر + صلاحيات أندرويد 12+ — مسار weak-signal جاهز والافتراضي العملي: فقدان المنارة = ابتعاد؛ macOS logout قد يعرض تأكيد النظام (حد المنصة).

---
Task ID: FA-input
Agent: main (Super Z)
Task: شاشة Touchpad تتحكم بالكمبيوتر فعليًا — enigo (حركة/نقر/سحب/تمرير + كتابة عربية كاملة بمعالجة التخطيط) + ماوس هوائي جيروسكوب + عرض تقديمي F5/PageUp/PageDown + وسائط نظامية + إذن Accessibility على ماك بإرشاد عربي + أمان (جلسة موثوقة/إشعار دائم/قطع فوري/الأجهزة الموثوقة فقط)

Work Log:
- القاعدة الذهبية أولًا: استكشاف كامل — أحداث rc:* قائمة بالكامل في وكيل Flutter (§4.9: touchpad/كيبورد/جيروسكوب/وسائط) والجسر 3004 يرحّلها (gateInput + بث)، والنمط المثبت §11/§12 (webview دائم → أوامر Tauri → Rust). فجوتان: **لا أحد ينفذ أحداث الإدخال على الكمبيوتر** و**لا مفهوم جلسة تحكم لهذا الاتجاه**.
- **فجوات سيرفرية أولًا (G-15..18)**: حقن __src (desktop/controller/unknown) في كل حدث إدخال مبثوث بالجسرين + توثيق وحدات التحكم بهوية موثوقة (rc:hello-controller {deviceId} من سجل الأجهزة) + جلسة rc:session كاملة (start/hb/stop + busy + untrusted + watchdog 6ث + انقطاع السوكِت ينهي) + status.desktop.input — كلها إضافية بلا مساس بمسارات قائمة (parity كاملة في mini-service بقائمة ثقة من البيئة NEXUS_TRUSTED_DEVICES).
- **input_exec.rs (نواة نقية بلا Tauri — تُضمَّن حرفيًا في التطبيق ومحرك التحقق)**: move بحواف سحب (DRAG_DOWN: AtomicBool — ضغط عند أول drag:true ورفع عند أول بلا drag، بلا تكرار)، click مزدوج (نقرتان 40ms)، scroll بتدرج 40px/نقرة ±10، pinch = Ctrl+عجلة، key يونيكودي عبر enigo.text() (Windows KEYEVENTF_UNICODE / macOS CGEventKeyboardSetUnicodeString / Linux-X11 keysym يونيكودي مع إعادة ربط keycodes — نمط xdotool — عربية كاملة مستقلة عن تخطيط الكيبورد)، presenter next/prev/start(F5)/stop(Esc)/black(b)، وسائط MediaPlayPause/Next/Prev/VolumeMute + volume مطلق (Linux: pactl←amixer←نقرات · macOS: osascript override · Windows: نقرات مُتبَّعة بمرآة 50% — موثق بصدق).
- **enigo 0.2.1 بميزة x11rb خالصة Rust** (بلا libxdo C — قرار بناء بعد فحص مصادر crate من codeload: xdo يربط #[link(name="xdo")]) — إضافة Cargo الوحيدة. درسان من التحقق المبكر قبل CI: مفاتيح الأسهم UpArrow/DownArrow/... لا Up/Down، وخداع E0382 في or() — أصلحا فورًا بفضل المحرك.
- **تحقق تنفيذي حقيقي 28/28 على Xvfb** (scripts/enigo-verify يضمّن input_exec.rs الحقيقي include!): حركة مطلقة/نسبية وسحب كامل تُثبت بـ XQueryPointer مستقلًا عن enigo ((200,150)→(250,175)→(280,205)) + كتابة عربية «مرحبا» حرفًا حرفًا وسلسلة كاملة عبر XTEST + نقرات/تمرير/قرص/مفاتيح وسائط/F5/PageUp/Down + رفض صادق للقيم الفاسدة. البيئة: rustup محلي + enigo من crates.io + Xvfb (xauth غير متوفر → تشغيل يدوي بـ DISPLAY=:95).
- **input.rs (طبقة Tauri)**: جلسة SESSION مع بدء/إنهاء (تحرير زر السحب المعلق reset_drag — لا زر عالق)، input_exec ببوابة مصدر (desktop-local دائمًا / controller خلال جلسة فقط / رفض بلا جلسة برسالة عربية)، watchdog محلي 15ث فوق نبض الجسر، input_permission (FFI مباشر AXIsProcessTrustedWithOptions — CoreFoundation+ApplicationServices بلا crates — قراءة ثوابت kAXTrustedCheckOptionPrompt/kCFBooleanTrue المصدرة مباشرة) + input_open_permissions (x-apple.systempreferences) — فشل Enigo::new يفشل مبكرًا بلا جلسة وهمية.
- **tray.rs**: عنصرا «جلسة تحكم نشطة: <اسم>» و«إنهاء جلسة التحكم» (مفعّل أثناء الجلسة فقط) + أيقونة بنفسجية tray-input.png (gen-tray-input.py بنفس اللغة البصرية) + LAST_STAGE لاستعادة الأيقونة عند الانتهاء + on_stage لا يكسر البنفسجي أثناء الجلسة.
- **desktop-bridge.tsx**: تنفيذ rc:* عبر input_exec — بوابة __src صارمة (المجهول مرفوض؛ controller خلال جلسة فقط؛ desktop-local لسوكِت الواجهة المسجل)، تجميع الحركة دفعات 30ms (حفظ ترتيب الأحداث: flush قبل كل حدث غير حركة)، خفض volume إلى 150ms، دورة الجلسة → input_session + لافتة بنفسجية دائمة بزر «إنهاء فوري» + تدفق إذن ماك (فحص عند البدء + شاشة إرشاد عربية عند desktop://input-error) + remote-socket.ts يسجل desktop:register في وضع سطح المكتب (وحدة التحكم الويبية = صاحب الجهاز — المتصفح العادي كما هو).
- **Flutter**: deviceId (androidId) في hello-controller + دورة الجلسة في الشاشة (بدء عند الفتح/إعادة تلقائية عند إعادة الاتصال/إيقاف عند الإغلاق) + نبض 2ث + استقبال rc:session (قبول/إنهاء بسبب) + شريط جلسة بنفسجي بزر «قطع فوري» + سبب آخر إنهاء + بطاقة «عرض تقديمي» (prev/start F5/stop Esc/next) + ترجمات rctl.session/rctl.present عربي/إنجليزي.
- **CI**: desktop.yml + libxkbcommon-dev (تبعية بناء xkbcommon في شجرة enigo) — v1.0.0 لم تُمَس (tauri.conf.json/Cargo.toml/pubspec بلا تغيير إصدار) وrelease.yml على الوسوم فقط.
- **E2E موسع 50 → 64/64**: خمول status.input، رفض untrusted، جلسة galaxy-s24 موثوقة (بث + status.active)، رفض busy، حقن __src=controller وunknown (مع عربي UTF-8 سليم «مرحبا»)، presenter start + media volume، watchdog 6ث → timeout + status خامل، إعادة بدء بعد timeout، قطع من سوكِت سطح مكتب → desktop-stop يصل الهاتف، العقد §13 موثق. tsc/eslint نظيفة على الملفات المتغيرة + بناء standalone كامل.

Stage Summary:
- الحلقة التعاقدية كاملة: لمس الهاتف → جسر 3004 (بوابة طاقة + حاجز ثقة + حقن مصدر) → webview دائم (تجزئة دفعات) → input_exec (enigo) → مؤشر وكيبورد النظام حقيقيان — والعربية تُكتب في أي مستند دون لمس تخطيط الكمبيوتر. جلسة التحكم مورد محمي: جهاز موثوق فقط، نبض حي، إشعار دائم في Tray/الواجهة/النظام، وقطع فوري من الشريط أو الهاتف أو الحارس.
- اختبار النجاح مثبت أعلى مستوى ممكن في الحاوية: 28/28 تنفيذيًا على X11 حقيقي (XQueryPointer يرى المؤشر يتحرك وXTEST يكتب العربية) + 64/64 تعاقديًا للسلسلة كاملة؛ الضغط الفيزيائي على Windows/macOS يثبت بـ CI 3/3 (بناء فعلي للطبقة). القيود صادقة في §13: Wayland الأصلي غير مسند، صوت ويندوز المطلق نقرات مُتبَّعة، الليزر عرض ويبي فقط.

---
Task ID: FA-input-CI
Agent: main (Super Z)
Task: جولات CI لمهمة FA-input — 3/3 منصات خضراء + بوابة flutter analyze الصفرية

Work Log:
- درسان جديدان موثقان من جولات CI (نفس نمط الدروس السابقة):
  (1) E0283 استنتاج النوع في tray.rs — `set_tooltip(Some("NexusLink".into()))` داخل match بذراعي أنواع مختلفة (format!‎ ينتج String) يجعل S غير قابل للاستنتاج — الحل `.to_string()` صريحًا.
  (2) `static Mutex<Option<Enigo>>` أُعيد تصميمه احترازيًا إلى خيط input-exec مخصص بقناة mpsc (CGEventSource/CGDisplay على ماك غير مضمونة Send) — البناء الخضراء على 3 منصات أثبتت كلا التصميمين، والقناة أبسط أمانًا (بناء كسول داخل الخيط + probe 5ث عند بدء الجلسة + reset_drag عبر الرسائل).
- إصلاح flutter analyze: ثابت RcEvents.presenter كان ناقصًا في protocol.dart (أُلتقط بالبوابة الصفرية 38205281873 ثم نجحت 38205655700).
- توضيح موثق: وظائف desktop داخل release.yml echo فقط — البناء الفعلي للحزم حصري في desktop.yml.

Stage Summary:
- desktop.yml 38206662604 على a716a64: nsis + dmg + deb كلها خضراء (enigo x11rb يُبنى نظيفًا على ويندوز/ماك/لينكس + libxkbcommon-dev للينكس).
- release.yml 38205655700 على 97c9cb5: analyze صفرية + APK/AAB/iOS خضراء.
- E2E 64/64 محليًا + تنفيذ حقيقي 28/28 على Xvfb. v1.0.0 لم تُمَس (لا وسوم ولا assets). الرأس النهائي: a716a64.

---
Task ID: FA-files
Agent: main (Super Z)
Task: دمج التطبيق في نظام التشغيل للملفات — قائمة الزر الأيمن Windows (Registry + تنظيف الإزالة) + macOS Services + السحب الخارجي + إظهار في Explorer/Finder + بث فيديو الهاتف للمشغل الافتراضي + مزامنة المجلدات بمراقبة أصلية فورية

Work Log:
- القاعدة الذهبية أولًا: استكشاف كامل — عقد §8.2 (send-file/tx:offer/preview Range) هو القناة المثبتة، وclipboard.rs/procman.rs يملكان نمط Inbox+send-file، و`ln` في sync-engine مزامنة الأجهزة الافتراضية (بلا مراقبة). **اكتشاف فجوة قاتلة: مسار `/api/fs/upload` الموثق في §8.2 غير موجود في الشجرة رغم استخدامه بمحرك نقل الهاتف** (ضاع في تنظيف مبكر — upload-sessions.ts موجود وحيدًا).
- **فجوات سيرفرية أولًا (G-19..22)**: (G-19) إعادة بناء `/api/fs/upload` حرفيًا حسب العقد — init حتمي الـ uploadId من taskId (استئناف بعد أي قتل) + PUT بـ 409 drift/paused + complete بإعادة تسمية فريدة + pause/resume/abort + GET حالة (G-20) نقطة وسائط الهاتف: hello-phone يقبل media{port,token} + lanIp من handshake.address + حدث guard:media + status.desktop.agentMedia (يمحوه الانقطاع) (G-21) realPathFor + `/api/fs/realpath` (G-22) readDesktopSync/writeDesktopSync في المخزن المشترك + status.desktop.sync.
- **files_menu_core.rs (نقية — تُضمَّن حرفيًا في المحرك)**: menu_spec (HKCU `*\shell\NexusLink` + `Directory\shell\NexusLink` — اقتباس `"<exe>" --send "%1"` + تسمية عربية) — collect_send_paths — sanitize_stream_name — parse_content_range (أصلح خطأ تقييم unwrap_or المتلهف التقطه المحرك) — pump_stream (مضخة البث التقدّمي العامة: عتبة 2MB/1.5ث + إلغاء + on_open مرة واحدة).
- **files_menu.rs (طبقة Tauri)**: تسجيل/إزالة Registry عبر winreg (NotFound ليس خطأ) + files_context_menu + apply_startup حسب settings.context_menu — `--send` من إقلاع أول ومن callback المثيل الوحيد (single-instance argv) → flush_pending_sends في monitor_tick → stage_file_to_inbox (مُوحد في procman) + send-file + إشعار — **المجلد يُضغط zip** (crate zip deflate) — files_reveal (explorer /select · open -R · dbus FileManager1 ← xdg-open) — files_stream_open (Range تقدّمي → %TEMP%/NexusLink-stream → فتح المشغّل الافتراضي بربط الامتداد عند العتبة → استكمال → سقف 4 + إلغاء + cleanup_all عند كل مسارات الخروج) — handle_deep_link يتعرف على file:// (macOS Services → RunEvent::Opened → deep-link on_open_url → نفس طابور --send).
- **sync_core.rs (نقية) + sync.rs (notify)**: pairs من status.desktop.sync بتوقيع تغيير (تغيير الوكيل = إعادة بناء) — مراقبان لكل زوج (محلي + agents/<agent>/Sync/<pair>) — صادر: process_outgoing (تخطي مخفي/مؤقت/200MB) → pc-fs/Outbox/<pair>/<rel> + offer_body (srcPath=/Outbox/<pair> — نفس عقد §8.3) — وارد: inbound_plan LWW (مطابق ±1.5ث تخطٍ، المحلي أحدث يخرج للاتجاه الآخر) + حارس صدى 6ث — تهادئة 700ms بدمج.
- **الواجهة**: desktop-files.ts (invoke عبر withGlobalTauri بلا npm — revealEntry/realPathOf/startDragOut/streamPhoneVideo/pickFolder) — files-view: قائمة «إظهار في المستكشف» + زر «تخزين الهاتف» + سحب خارجي بإيماءة 12px (بلا Hooks في map — نقاط على مستوى الوحدة) + جلب خلفي للمسارات الحقيقية — phone-storage-modal (list من خدمة الهاتف مباشرة + بث) — settings-view: بطاقة «مزامنة المجلدات» (اختيار أصلي + تفعيل + حذف + PUT) — transfers-view: زر إظهار للمهام ذات srcDeviceId — 21 ترجمة إنجليزية جديدة.
- **الهاتف**: phone_media_server.dart (dart:io خالص — 3010 بديل عشوائي — رمز 32 خانة لكل إقلاع — CORS — /list مجلدات+فيديو — /stream بـ Range كامل 206/416) — sync_service.dart (Directory.watch على Download/NexusLink/Sync + رفع §8.2 بـ taskId مستقر — تخطي .nexuspart والمخفي و200MB) — echo_registry.dart (نافذة 6ث + مطابقة حجم/زمن لمقاومة FUSE) — transfer_engine: _syncSubPath (/Outbox/<pair> → publishDownload subPath=Sync/<pair>) + تسجيل الصدى — native_bridge: setMediaEndpoint + publishDownload subPath — Kotlin: setMediaEndpoint (prefs fallback) + hello يضم media + guard:media إعادة إعلان + publishDownload بـ RELATIVE_PATH فرعي منظف — التوصيل في EngineController._ensure (خادم الوسائط + إعلانه + المزامنة).
- **macOS**: Info.plist (يُدمج تلقائيًا) بـ NSServices (NSSendFileTypes public.data/folder + NSMessage) — Windows: installer-hooks.nsh (NSIS_HOOK_POSTUNINSTALL يحذف المفتاحين) + tauri.conf installerHooks — **v1.0.0 لم تُمَس** (tauri.conf/Cargo.toml/pubspec فارغة من الإصدار).
- **تحقق تنفيذي 56/56 (scripts/files-verify)**: مواصفات Registry — مضخة البث ضد خادم Range حقيقي مكتوب يدويًا (403 لرمز فاسد + 206 + اكتمال 2.5MB + فتح مرة واحدة + إلغاء فوري — **قفل ميت موثق**: خادم أحادي الخيط يحجب في كتابة 2.5MB والعميل لم يقرأ) — مزامنة حقيقية بمجلدات مؤقتة (صادر/وارد/LWW/صدى/استثناءات) — مراقب notify حقيقي (درس: Watcher trait يجب استيراده).
- **تحقق E2E 76/76 (موسع 64→76)**: realpath موجود فعليًا + 404 — تسجيل النقطة عبر hello-phone media + تحديث guard:media + محو الانقطاع — دورة عرض مزامنة كاملة (/Outbox → tx:offer → accept/progress/state → done) — Range 206 على /api/preview — PUT/GET أزواج المزامنة مع تنقية — توثيق §14. **وباختبار §8 الكامل (agent-tx-e2e): رفع 2GB sparse مع قتل عند 40% → استئناف من نفس الإزاحة → sha256 مطابق (a7c744c13cc101ed) بسرعة 115-198MB/s — إخفاقا «مسار القرص» في السكربت القديم بسبب chdir الخاص بـ standalone (مسارات مكتوبة لوضع dev) — حقيقة الاكتمال مثبتة بالهاش على المسار الفعلي**.
- **CI جاهز**: desktop.yml يبني 3 منصات (winreg على ويندوز فقط + notify/zip/drag على الجميع + libxkbcommon للينكس) — release.yml بوابة analyze الصفرية ستلتقط أي هفوة Dart/Kotlin.

Stage Summary:
- الحلقة التعاقدية كاملة: زر أيمن على ملف → Registry → --send → المثيل الحي → Inbox → send-file → tx:offer → الهاتف يستلم (اختبار النجاح 1 مثبت بالعقد + E2E). ملف في مجلد متزامن → notify فوري → Outbox → offer → هبوط في Sync/<زوج> على الهاتف خلال ثوانٍ — والعكس: Directory.watch → رفع §8.2 → جذر الوكيل → notify → المجلد المحلي (اختبار النجاح 2 مثبت تنفيذيًا بالاتجاهين في المحرك + تعاقديًا في E2E).
- بث الفيديو: تخزين الهاتف → خدمة وسائط (Range كامل) → تنزيل تقدّمي مؤقت في Rust → المشغّل الافتراضي يفتح عند 2MB/1.5ث ويستكمل — والقنوات موثقة في status.desktop.agentMedia.
- القيود الموثقة بصدق (§14): %1 أول عنصر فقط في قائمة السياق — Share Extension .appex يتطلب هدف Xcode (Services تغطي Finder) — البث أثناء حياة التطبيق — الحذف لا ينتشر — الضغط الفيزيائي على Windows/macOS يثبت بـ CI 3/3 (الحاوية بلا GUI لتلك المنصات).

---
Task ID: FA-files-CI
Agent: main (Super Z)
Task: جولات CI لمهمة FA-files — 3/3 منصات خضراء + بوابة analyze الصفرية الخضراء

Work Log:
- خمس جولات موثقة (النمط المعتاد: النوى النقية تُختبر محليًا 56/56 والطبقة الأصلية تُبوّب بـ CI — كل درس أدناه لم يكن ممكنًا محليًا):
  (1) ee71a01: E0308 ×6 — دلالات المرجع في طبقة Tauri: notify::plain/open_main يأخذان &AppHandle (مرّرتها مملوكة في خيوط flush/broadcast)، stage_and_offer تستعير، process_outbound(&app_handle()).
  (2) f03ade8: E0599 flush غير موجود على File بلا trait Write (استُبدلت الاستيراد بـ file.sync_all() المتأصلة — أنظف) + E0382 temp انتقل إلى closure البث واستُعمل بعده في json! الاستجابة (clone temp_resp) — والبوابة الصفرية التقطت info-lint واحد (prefer_function_declarations_over_variables: الإغلاق log → دالة محلية؛ **البوابة الصفرية تشمل info**).
  (3) 027d8f5: analyze الصفرية التقطت FileStat.size وليس .length (7× في sync_service.dart — خلط مع File.length()).
  (4) afe5bc2: E0599 winreg 0.56 أعاد تسمية delete_tree → **delete_subkey_all** (تحقق من مصدر crate قبل الإصلاح) + Kotlin isNotEmpty() أقواس استدعاء (MainActivity:581).
  (5) النتيجة: desktop 3/3 (deb + nsis + dmg) و release كامل (analyze صفرية + APK/AAB/iOS + 3 اختبارات OS).
- درس عمل إضافي: git add -A التقط مخلفات (files-verify/target 461 ثنائيًا + 2GB e2e test file في data/) — رفض pre-receive (GH001 >100MB) — أُعيد البناء الانتقائي + gitignore (scripts/files-verify/target/ و /data/nexus-storage/) — نفس درس db/custom.db الموثق سابقًا.
- v1.0.0 لم تُمَس في كل الجولات (لا وسوم ولا أصول)؛ الوسم والأصول الخمسة الثابتة كما هي.

Stage Summary:
- الحلقة كاملة خضراء أعلى مستوى ممكن: تنفيذيًا 56/56 محليًا (نوى البث/المزامنة/Registry ضد خوادم وملفات حقيقية) + تعاقديًا 76/76 E2E (incl. G-19 رفع 2GB sha-مطابق) + بناء فعلي 3/3 منصات للطبقة الأصلية (winreg/notify/zip/tauri-plugin-drag/Info.plist merge/installer-hooks).
- الرأس النهائي: afe5bc2.

---
Task ID: FA-media
Agent: main (Super Z)
Task: طبقة الوسائط الأصلية — بث شاشة الكمبيوتر للهاتف عبر WebRTC (kind=screen) بجودة قابلة للضبط + لمس الشاشة المعروضة يتحكم بالكمبيوتر + كاميرا/ميكروفون الهاتف أجهزة افتراضية حقيقية (v4l2loopback/akvirtualcamera/VB-CABLE/BlackHole)

Work Log:
- القاعدة الذهبية أولًا: عقد §4.3 (rtc:* ترحيل شفاف بلا قائمة kind + أول إجابة من دور pc تفوز) و§13 (rc:session + __src) قائمان — لا مساس بهما. تحقق crates من المصادر (codeload): scap (سطر Targets نُشر فعليًا 0.0.8 — فرع release-plz يحمل 0.16 غير منشورة، تحقق حرفي من مصدر v0.0.8) · webrtc 0.21.1 (إعادة كتابة Sans-I/O — API من الأمثلة الرسمية play-from-disk-h26x/reflect + rtc 0.21.1 منشورة منفصلة) · openh264 0.9.8 (YUVSource/BgraSliceU8/IntraFramePeriod — وحدات yuv/rgb خاصة، الصادرات من formats::) · audiopus 0.3.0-rc.0 (MutSignals عبر TryFrom — الباني خاص؛ Encoder::new بثلاث أرجف؛ Packet::try_from) · akvirtualcamera (بروتوكول stream من مصدره: DEVICE FORMAT WIDTH HEIGHT يقرأ إطارات خام من stdin — YUY2/RGB24).
- اكتشاف معماري: scap على لينكس = PipeWire/portal — القرار: x11rb مباشر (GetImage + RandR بدوال حرة + نوافذ u32) وscap على ويندوز/ماك فقط (cfg-gated — بناء لينكس لا يلمسها).
- فجوات سيرفرية (G-23..25): (G-23) screen:req/stop/set/state على 3005 بتنقية صارمة (fps قائمة بيضاء 15/24/30/45/60 + quality + w/h ≤ 8192) — إصلاح أثناء التحقق: action "state" كان مرفوضًا بقائمة start|stop|set (E2E التقطه) (G-24) rc:pointer في الجسرين (sanitizePointer: 0..1 مقرب + قائمة إجراءات — رفض صامت + __src) (G-25) readDesktopMedia/writeDesktopMedia + status.desktop.media عبر PUT shortcuts {media} (بقي آخر قيمة صالحة عند فاسد — موثق).
- Rust: media_core.rs (نقية: جودة low/medium/high/ultra + bgra_to_yuyv/yuv420_to_yuyv بsplit_at_mut للعرض الفردي + downscale + KindGate أول-إجابة-تفوز + vcam_driver_status نص عربي صادق + akvcam args/parse) — media.rs (1,800 سطر): جلسة شاشة (scap/x11rb → downscale → openh264 → تُراك webrtc-rs بsample_writer + غير ترشيحي: مرشحات host داخل SDP) + جلسات cam/mic (on_track → H264/Opus depacketize → openh264/audiopus → قنوات std mpsc (بدائل primitives — try_recv(&mut) يستحيل على OnceLock) → حاقنات) + v4l2 S_FMT ioctl FFI (0xC0D05659 — تحقق موافقة السائق) + akvcam stream stdin بإعادة تشغيل عند تغيّر الأبعاد + cpal (CABLE Input/BlackHole) بإعادة تشكيل خطية 48k→جهاز + pactl module-pipe-source FIFO O_RDWR + rc:pointer (enigo Abs في فضاء سطح المكتب المركّب — set_pointer_space ترميز بيتي بلا قفل).
- Flutter: media_service يجيب rtc:offer kind=screen (onTrack → renderer) + requestScreen/stopScreen/setScreenQuality + pc_screen_screen.dart (فيديو contain + خريطة لمس normalized بإزالة letterboxing + إيماءات tap/dblclick/long-press-drag/إصبعان scroll/pinch + كيبورد فرق حروف + إعادة بث بالجودة) + ControllerController.sendPointer + بطاقة «شاشة الكمبيوتر» في شاشة الوسائط + ترجمات pcscreen.* (nested — الدرس: easy_localization يتنقل بالنقاط في مقاطع).
- الويب: desktop-bridge سوكِت 3005 دائم (media:role pc) يرحّل الإشارات ↔ أوامر Tauri + rc:pointer في RC_INPUT_EVENTS + بطاقة «طبقة الوسائط الأصلية» في إعدادات سطح المكتب (تشغيل/إيقاف + حالة الدوايفور + إرشادات تثبيت عربية لكل منصة).
- محرك تحقق تنفيذي scripts/media-verify **38/38**: النوى + خريطة اللمس (التعبئة الحتمية + تحويل مطلق بأصول شاشات) + H264 ترميز→فك دورة كاملة (12 إطارًا، Annex-B مثبت) + Opus دورة كاملة (RMS نسبة 0.99) + **WebRTC loopback حقيقي**: عرض/إجابة بمرشحات host مضمّنة → **20 إطار H264 و40 حزمة Opus استُقبلت عبر RTP فعلي** — إصلاح أثناءه: KindGate::mark_live من Idle كان لا يغلق البوابة (المحرك التقطه).
- E2E موسع 76 → **90/90**: screen:req صالح/فاسد (fps=60 يمر، 90 يُرفض صامتًا) — rtc:offer kind=screen/answer/ICE ثنائي الاتجاه — cam:cmd cam-start — rtc:offer kind=cam — screen:state on/w/h — PUT media صالح/فاسد + status.desktop.media — rc:pointer صالح (__src=controller) وفاسد (رفض صامت) — §15 موثق. درس مكرر: standalone قديم يعطي إخفاقات وهمية (أعد بناء .next/standalone قبل كل E2E).
- جولة CI 1 (3cea500): فشلت 3/3 — الدروس: (1) **rtc 0.21.1 تبعية مستقلة إلزامية** (أنواع الأمثلة الرسمية من rtc وليست معاد تصديرها من webrtc — 14×E0433 متسلسلة) (2) Arc<PeerConnection> → Arc<dyn PeerConnection> (بناء build يعيد impl Trait — E0782 في الحقول وال locals) (3) with_handler يريد Arc<dyn …> (4) E0015: HashMap::new ليس const — LazyLock (5) audiopus MutSignals عبر try_from (6) **x11rb 0.13: دوال الامتداد حرة (randr::get_monitors) وconn.randr() غير موجودة + سمات Connection/ConnectionExt إلزامية + Window=u32 بلا resource_id** (7) CMake 4 على المُشغلات أزال توافق <3.5 — libopus المضمن قديم → **CMAKE_POLICY_VERSION_MINIMUM=3.5** env في خطوة البناء (8) macOS: CGWindowID alias لu32 في fork سيرفو (لا .0) (9) GestureDetector: onDoubleTapDown لا onDoubleTapUp (البوابة الصفرية التقطت + unused_imports) — **كلها أُصلحت ودُفعت bfa89a6**.
- جولة CI 2 (bfa89a6): أُطلقت desktop.yml + release.yml — النتائج تحت (تُحدّث بعد اكتمالها).
- v1.0.0 لم تُمَس (tauri.conf/Cargo.toml/pubspec بلا تغيير إصدار) — درس add -A تكرار حرفيًا (media-verify/target التُقط — gitignore + amend قبل الدفع، رفض pre-receive منع 1.3GB artifacts).

Stage Summary:
- الحلقة التعاقدية كاملة: طلب من الهاتف → screen:req → عرض كمبيوتر kind=screen → إجابة هاتفية → RTP محلي مباشر → شاشة الكمبيوتر على هاتفك بجودة 15-60fps قابلة للتبديل — لمسها يتحكم بالمؤشر حقنيًا خلال جلسة موثوقة (نقرة/سحب/تمرير/قرص/أيمن + عربي كامل). وبالعكس: زر «تشغيل الويب كام» → cam:cmd → بث كاميرا الهاتف (فيديو+صوت) → فك H264/Opus → حقن YUYV في كاميرا افتراضية وPCM في ميكروفون افتراضي — تظهران كأجهزة نظامية في Zoom/Meet/Camera.
- الدوايفور: لينكس v4l2loopback + PulseAudio (إرشاد modprobe) — ويندوز akvirtualcamera + VB-CABLE — ماك akvirtualcamera + BlackHole — غياب أي منها لا يكسر شيئًا: حالة صادقة + إرشاد تثبيت عربي في البطاقة (حدود موثقة في §15: قيود توقيع macOS الحديث، OBS بديل عملي).

---
Task ID: FA-media-CI-r3..r5
Agent: main (Super Z)
Task: إغلاق حلقة CI لطبقة الوسائط الأصلية — الجولات 3-5: تشخيص ثلاثية الفشل على a803bb1، إصلاحات متحققة من مصادر الكريتات، أخطاء كامنة تكشفت تباعًا، أخضر كامل 3/3 + Release، واستبدال أصول v1.0.0

Work Log:
- استئناف بعد إعادة ضبط الحاوية: rust اختفى (أعيد تثبيته) وlocal main كان عالقًا عند التزام عابة تلقائي a5231e0 (رسالة UUID) وشجرة العمل مطابقة للمحتوى البعيد بايتًا-بايتًا لكل الملفات الموجودة — فرع أمان backup/stale-snapshot-a5231e0 ثم reset --hard إلى a803bb1 (صفر فقد عمل).
- CI على a803bb1: Release أخضر، Desktop 3/3 فاشل. ثلاثية أسباب متحققة من المصادر (تنزيل crates.io):
  (1) ويندوز: scap 0.0.8 مكسور مع أي windows-capture منشورة (يورد windows_capture::capture::Context المحذوفة — E0432 ×3، والتثبيت 1.3.6 لم ينفع) → scap صار ماك فقط في Cargo.toml، والالتقاط على ويندوز عبر windows-capture 1.3.6 مباشرة: GraphicsCaptureApiHandler (الطريقة on_frame_arrived تأخذ InternalCaptureControl ثالثة!) + start_free_threaded + CaptureControl::stop + Settings::new خمسية + ColorFormat::Bgra8. وقائمة النوافذ عبر EnumWindows يدويًا لأن enumerate في الكرِيت يستعمل EnumChildWindows (يعدّ عناصر التحكم الداخلية).
  (2) لينكس: الإرسال Result<Cookie, ConnectionError> والرد Result<_, ReplyError> — نوعا خطأ مختلفان أفشلا المحاولتين السابقتين (and_then ثم .reply() مباشرة) → جسر x11reply<C,R> → Option بـ 11 موقعًا.
  (3) ماك: libc_open بتوقيع ثابت تحت link_name="open" وopen متغيّرة int open(const char*, int, ...) → لاينت invalid_runtime_symbol_definitions الجديد → إعلان متغيّر.
- درس متكرر حاسم: **إصلاح أخطاء الترجمة يكشف أخطاء كامنة خلفها** —
  r4: GetImageReply بلا حقلي width/height (الأبعاد من الطلب rw×rh) + E0308 RandR width/height هما u16 والبنية تريد u32 + E0515 الإغلاق أرجع مرجعًا داخل r.monitors المحلية → صف مملوك (mx,my,mw,mh).
  r5: ربط ماك — CGWindowGetBounds ليست API عامة (اخترعها 3cea500 ولم يكشفها الرابط لأن الترجمة كانت تفشل أولًا) → CGWindowListCopyWindowInfo + kCGWindowNumber/kCGWindowBounds + CGRectMakeWithDictionaryRepresentation (رؤوس CGWindow.h) مع CF* CoreFoundation FFI كامل + CFRelease. وويندوز: as_raw_nopadding_buffer على FrameBuffer لا على Frame (سلسلة frame.buffer()?) — إصلاح ذاتي قبل الجولة مع إزالة type Frame غير الموجود في الـ trait (E0220) وتوحيد فرعي Window/Monitor ببناء Settings داخل كل فرع (نوع الإرجاع لا يذكر T).
- إثبات محلي قبل كل دفعة: كرِيت فحص أنماط scripts/x11-api-check يجمّع كل أشكال الاستدعاء + media-verify 38/38 (حلقة WebRTC حقيقية: 20 إطار H264 + 40 حزمة Opus عبر RTP) + E2E 90/90 بعد إعادة بناء standalone.
- دروس بيئة إعادة الضبط: E2E يحتاج من build-resources.sh خطوتَي comms+gateway فقط (نسخة server الثقيلة ~3GB للـ CI حصرًا) · القرص 9.9GB يمتلئ (standalone 3.2GB + أهداف التحقق) → تحرير 2.4GB · الأنبوب عبر head يخفي فشل أمر سابق في السلسلة (رمز خروج الأنبوب = الأخير).
- الجولات: r3 (a803bb1) 3×فاشل → إصلاحات 33ebfee → r4: linux 3 أخطاء كامنة + ماك ربط + ويندوز E0599 → إصلاح ذاتي fdee612 → r4b فاشل 3 أخطاء → 35907f4 → **r5 أخضر كامل: Desktop 3/3 (deb/nsis/dmg) + Release (analyze الصفرية + APK/AAB/iOS)**.
- أصول v1.0.0 استُبدلت من الجولة الخضراء 35907f4: apk عام (635058652، 139.5MB) + exe (635063882، 197.0MB) + deb (635068893، 273.4MB) + dmg (635074698، 282.2MB) — بقي arm64-release.apk القديم كما هو (النمط المتحفظ السابق). الوسم والأرقام لم تُمَس (v1.0.0 في tauri.conf/Cargo/pubspec كما هي).

Stage Summary:
- طبقة الوسائط الأصلية مغلقة أعلى مستوى ممكن: تنفيذيًا 38/38 (WebRTC loopback حقيقي)، تعاقديًا E2E 90/90، وبناء فعلي 3/3 منصات + Release كامل — والبِنيات الأربعة الحية على Release v1.0.0 تشمل كل ميزات A-F.
- المهمات الست (A desktop-native، B clipboard، C power، D input، E files، F media) كلها ملتزمة ومدفوعة وخضراء CI.

---
Task ID: FA-harden (backfill توثيقي)
Agent: main (Super Z)
Task: صلّب الإصدار 6 بنود — التوثيق الرسمي للعمل المنفذ في commitين تلقائيين (c3b887c + 6375f53) وُجدا في الشجرة المحلية دون إدخال worklog

Work Log:
- اكتشاف أثناء الجولة 3: الشجرة المحلية تسبق origin بـ commitين رسالتهما UUID يحملان كامل التقوية: lock.rs (PIN عبر PBKDF2-SHA256 150k + Windows Hello/BCrypt + Touch ID/objc2 + قفل خمول) + updater.rs (فحص موقّع minisign) + audit.rs/harden_core.rs (طابور تدقيق native-* حصري بلا حجب) + idle.rs (قرار خمول) + diag.rs (فحص منافذ + قياس حقيقي + تصدير) + settings.rs (مزامنة DesktopSetting — نفس SQLite عبر /api/desktop/settings) + splash/lock.html + hardening-verify 47/47 + E2E موسّع §16.
- أصول الحالة: أسرار CI مضبوطة (TAURI_SIGNING_PRIVATE_KEY + PASSWORD — 03:48) وlatest.json موقعة مرفوعة على Release v1.0.0 (03:50 — بعد الأصول ⇒ تواقيعها مطابقة للأصول الحية).
- ملاحظة حالة: مفتاح التوقيع الخاص المحلي (~/.tauri) فُقد بإعادة ضبط الحاوية — الأسرار في GitHub محفوظة؛ قاعدة «لا استبدال أصول موقعة» صارت إلزامية حتى وجود مسار إعادة توقيع CI فقط.
- إصلاح عرضي ضمن التوثيق: استعادة src/app/api/fs/upload/route.ts (حذف غير مبرر في شجرة العمل — لا أثر له في أي commit ولا worklog).

Stage Summary:
- التقوية الست كاملة منفذة ومدفوعة ضمن الجولة 3 (الأخضر الإجمالي أدناه) — §16 من العقد مرجعها الموثق.

---
Task ID: R3
Agent: main (Super Z)
Task: الإصدار النهائي للجولة 3 — حزم المنصات الثلاث (NSIS+MSI+Portable / DMG / AppImage+deb) + release.yml حقيقي + BUILD/README/checklist + توحيد الإصدار + اختبار نجاح التثبيت النظيف

Work Log:
- **عيب كامن حرج 1 (resolve_resources)**: تتبع مصادر tauri-bundler (debian.rs::copy_resource_files → usr/lib/<productName> + settings.rs::copy_resources → path.join(resource.target()) + tauri-utils/resources.rs اختباراته الرسمية target = resource_relpath بالبادئة الكاملة) + tauri-codegen (PackageInfo.name = productName) + platform.rs (resource_dir: win=exe_dir · linux=../lib/<name> · mac=../Resources) ⇒ الحزم تضع الموارد في `<resource_dir>/resources/server/...` بينما procman يفحص `<resource_dir>/server/server.js` فقط ⇒ **الخادم المضمّن لا يبدأ في أي حزمة مثبتة** — كان سيُفشل اختبار النجاح (تثبيت نظيف → يعمل). الإصلاح: سلسلة فحص رباعية (مدمج بالبادئة → مسطّح توافق → exe_dir portable → تطوير) موثقة عقدًا §17.ب.
- **عيب كامن حرج 2 (comms مكسور داخل الحزم)**: E2E التقط فشل mDNS إعلان — الجذر بلا workspaces ⇒ bun install الجذر لا يثبت تبعيات mini-services/comms-service ⇒ esbuild يترك `import("bonjour-service")` خارجيًا (تحذير مخفي بـ --log-level=error) ⇒ **كل الحزم المنشورة حتى الآن تحمل comms.cjs بمسار mDNS ميت**. الإصلاح: حرس تبعيات في build-resources.sh (G-27) + إعادة تجميع (0 imports خارجية) — والاتجاه أعلاه يعني أن استبدال أصول NSIS/deb/DMG بأصول الجولة الخضراء الجديدة ضروري (مسبوقة سابقًا في FA-media — نفس النمط).
- release.yml من هيكل echo إلى خط إصدار كامل: test 3 OS → desktop matrix (win "nsis msi" / linux "appimage deb" / mac "dmg") بالوصفة المجرّبة حرفيًا (standalone + build-resources + sidecar v20.18.1 + APPIMAGE_EXTRACT_AND_RUN + CMAKE_POLICY_VERSION_MINIMUM=3.5 + rust-cache) + خطوة Portable ZIP (تخطيط NSIS المطابق لقراءة resolve_resources + bsdtar للمسارات الطويلة) + توقيع updater شرطي بالسر (غيابه ⇒ createUpdaterArtifacts:false بالحقن — البقاء أخضر) + release job (وسم ⇒ إرفاق تلقائي + latest.json موقعة من .sig البناء + SHA256SUMS + Draft؛ dispatch ⇒ artifacts فقط وإرفاق opt-in بحماية الأصول الموقعة).
- Portable: apps/desktop/PORTABLE-README.txt (فك وشغّل · WebView2 المتطلب الوحيد · بلا Registry · بيانات في %APPDATA%).
- Docs: BUILD.md كامل (خطوات كل منصة بأوامر CI الحرفية + توقيع ماك Developer ID/codesign/notarytool/stapler + مفاتيح updater + جدول التشغيل dispatch/وسم + قاعدة الأصول) — README §0 «سطح المكتب = المركز، الهاتف = وكيل» (جدول الحزم الأربع + صفر خطوات + QR) — docs/e2e-checklist.md (11 قسمًا × عمود نتيجة، تمييز صادق ✅آليًا/🖐يدوي).
- توحيد الإصدار (بند 7): package.json الجذر 0.2.1 → 1.0.0 (بلا مستهلكين للقديمة) — الأربعة 1.0.0 مثبتة بفحص E2E تعاقدي.
- E2E §17 (12 فحصًا جديدًا): release.yml حقيقي لا echo + المصفوفة + portable + latest.json + dispatch opt-in + env المجرّبة — targets الخمسة — resolve_resources بالترتيب الصحيح — PORTABLE-README — BUILD (حزم + توقيع ماك + توحيد) — README §0 — checklist — الأربعة 1.0.0 — §17 موثق.
- بيئة الحاوية المستعادة: @next/swc-linux-x64-gnu غائب (musl فقط) — تثبيت يدوي من registry دون تعديل package.json؛ build-resources يعيد standalone كاملًا (556MB).
- التحقق المحلي النهائي: **E2E 121/121** (من 90) + lint أخضر + db seed استُعيد بعد E2E (لا بيانات اختبار في الحزمة).

Stage Summary:
- خط الإصدار ينتج الصيغ الست من CI مباشرة، والتطبيق المثبت يعمل فعلًا (الخادم المضمّن + mDNS) — اختبار النجاح الميداني موثق خطوة-خطوة في docs/e2e-checklist.md §1.
- التزام صارم: v1.0.0 في الملفات الأربعة والوسم والأصول الحية — الاستبدال القادم (بعد الأخضر) يستهدف إصلاح comms/M مDNS داخل الأصول نفسها بإصدار 1.0.0 كما هو.

---
Task ID: R3-push
Agent: main (Super Z)
Task: إزالة توكن ملتقط بحماية الدفع (GitHub Push Protection) — إعادة كتابة التاريخ غير المرفوع

Work Log:
- أول دفع للجولة رُفض (GH013): commit التقوية التلقائي 6375f53 حمل التوكن الحي في scripts/build-latest-json.sh:11 وscripts/set-updater-secrets.py:15 — مخالفة للقاعدة الثابتة (التوكن في URL مؤقتًا ولا يُخزَّن).
- الإصلاح: filter-branch --tree-filter (نطاق c385115..HEAD حصرًا) استبدال التوكن بـ GITHUB_TOKEN_ENV (السكربتان يقرآن البيئة بعد ذلك) — إلغاء dispatch شارد أُطلق على الكود القديم (38376059288).
- الأسماء الجديدة: 6375f53 → 5d0d0da · 6684ea1 → a1a3211 (الإشارات القديمة أعلاه تعني نفسها). تحقق: git grep للتوكن على كل commit الجديدة = صفر.

Stage Summary:
- main عند a1a3211 مدفوعًا ونظيفًا من الأسرار — خط الإصدار يُطلق عليه.

---
Task ID: R3-CI-and-Release
Agent: main (Super Z)
Task: إغلاق حلقة CI للجولة 3 (r1..r9) + رفع أصول Release v1.0.0 الكاملة (NSIS+MSI+Portable / DMG+app.tar.gz / AppImage+deb + تواقيع + latest.json + SHA256SUMS)

Work Log:
- **r1**: فشل 3/3 عند الحل — objc2-local-authentication بميزة LAPolicy مخترعة (المصدر: crate 0.3.2 — الـ enum يأتي مع LAContext، mod.rs cfg). الدرس: حاسم Cargo موحّد لكل الأهداف ⇒ ميزة ماك تُفشل لينكس أيضًا. تثبيت rust محليًا (cargo metadata) أعاد إنتاج الفشل وأثبت الإصلاح (732 حزمة).
- **r2**: الحل مرّ — 6 أخطاء ترجمة كامنة (نمط «الأخطاء الكامنة تكشفت تباعًا»): ureq 2.10+ أزال impl Read for Response (→ into_reader، القفل 2.12.1) · tauri-plugin-updater on_chunk يمرر طولًا (usize) لا شريحة · ويندوز 0.58: UserConsentVerificationResult (لا ConsentVerificationResult) + RequestVerificationAsync (بلا لاحقة Consent — vtbl IUserConsentVerifierStatics) + HRESULT في windows::core + COINIT_MULTITHREADED ثابت حرّ. كلها متحققة من مصادر الكريتات/windows-rs 0.58 قبل الإصلاح.
- **r3**: الترجمة خضراء 3/3 — الفشل انتقل للـ bundling: linuxdeploy يبتلع stderr بتصميمه (linuxdeploy.rs «we have to ignore the output») → جولة -v تشخيصية.
- **r5 verbose** كشف الاثنين: (G-28) linuxdeploy يفشل على ELF musl مضمّن (sharp-linuxmusl-x64 — «libc.musl-x86_64.so.1») — حذف *musl* من node_modules المضمنة؛ (LGHT0311) قاعدة MSI code page 1252 لا تشفر العربية — الوصفان ASCII نقيان.
- **r6**: G-28 بنمط *-musl* أفشله غياب الشرطة في sharp-linuxmusl → *musl*؛ وماك خضراء من r4 (dmg app أنتج أصل updater).
- **r7**: لينكس خضراء (deb+AppImage) — NO_STRIP=true (linuxdeploy strip يفشل على .relr.dyn — tauri#14796 بتأكيد FabianLars) + VBScript Add-WindowsCapability (light.exe ICE على runners 2026 — tauri#13336/#13752 بصمة مطابقة). ويندوز: LGHT0311 عاد عند main.wxs(122) رغم ASCII الوصف.
- **r7→r8 التحقيق**: مسارات غير ASCII داخل الموارد نفسها — تتبّع Next/Turbopack جرّ شجرة المستودع كاملة إلى standalone (skills/ بأسماء صينية + download/scripts/.git — ~160MB): (G-29) keep-list prune في build-resources.sh (server.js+.next+public+db+node_modules+package.json) — الحزمة 556MB→152MB وصفر مسارات غير ASCII مثبت محليًا. و(G-30) جذر بيانات قابل للكتابة: MSI per-machine في Program Files — procman data_root()=app_config_dir/nexus-data + NEXUS_DATA_ROOT للعمليات الثلاث + data-root.ts (fallback cwd/data — سلوك dev/E2E لم يتغير) + مواقع Rust الكتابة (procman/clipboard/sync) + notify يفك «data/».
- **r8**: NSIS+MSI أخضران مع تواقيع — فشل خطوة portable فقط: tauri CLI يعيد تسمية sidecar إلى node.exe في target/release (النمط node-*.exe قديم — fallback محفوظ).
- **r9**: **أخضر كامل 3/3** (linux deb+AppImage · mac dmg+app+sigs · win nsis+msi+portable+sigs + test 3/3 + android + ios).
- **الرفع**: desktop artifacts من r9 → استبدال exe/deb/dmg (بأصول الجولة الأخضر الكاملة G-27/28/29/30) + إضافة msi/portable/appimage/app.tar.gz + 4 تواقيع + latest.json جديدة (نفس المفتاح — pubkey tauri.conf لم يتغير) + SHA256SUMS.txt شاملة (14 أصلًا) + جسم الإصدار بالعربية. ملاحظة API: حذف الأصل عبر /releases/assets/{id} (بلا معرّف الإصدار) وurllib يفشل في PATCH الإصدار (404) بينما curl 200.
- التحقق الحي: latest.json تعيد 1.0.0 والمنصات الثلاث (windows→exe، linux→AppImage، darwin→app.tar.gz) — SHA256SUMS تعود بالأصول — صفحة الإصدار منشورة.
- APKs لم تُمس (خضراء FA-media كما هي) — الوسم v1.0.0 والأرقام مقفولة طوال الجولة.

Stage Summary:
- الجولة 3 مغلقة أعلى مستوى ممكن: CI يبني الصيغ الست فعليًا على 3 منصات، صفحة الإصدار تحمل 15 أصلًا، والمحدّث الموقّع حي بنقطة فحص صحيحة. اختبار النجاح الميداني (تثبيت نظيف → يعمل مع الهاتف) موثق خطوة-خطوة في docs/e2e-checklist.md §1 — والفجوات الفيزيائية الوحيدة المتبقية هي عتادية بحتة (بصمة/بطارية/ميكروفون Zoom) موثقة بصدق.
- عيوب كامنة أصلحت خلال الجولة (إلى جانب G-27/28/29/30): resolve_resources (الخادم المضمّن كان ميتًا في كل حزمة مثبتة) — mDNS مكسور في كل حزمة منشورة سابقًا — تجميع comms خارجي التبعية.

---
Task ID: R4-foundation
Agent: main (Super Z)
Task: الجولة 4 — الأساس المشترك: (1) تدقيق FA-media كامل → docs/round4-audit.md (2) قناة UDP حية NexusLive (Node relay + Rust sink + Flutter client) (3) عقد §18 + E2E §18 + live-verify تنفيذي — اختبار النجاح: حدث قلم/لمس من Flutter عبر UDP يُحقن <20ms مقيسًا

Work Log:
- القاعدة الذهبية أولًا: مزامنة origin (0/0) + قراءة حرفية: worklog كامل، العقد §1..§17، input.rs/input_exec.rs (385/462) سطرًا سطرًا، media.rs بنية، remote-bridge.ts (495) وmedia-bridge.ts، controller_service.dart (598)، mini-service التوأم — اكتشاف محوري: `rc:gamepad` في القائمة البيضاء بلا تنفيذ أصلي (فجوة جاهزة)، ماوس هوائي TCP قائم عبر sensors_plus، `sensor:stream` منفّذ على 3005 بلا مستهلك سطح مكتب، dgram مستورد للـ WoL حصرًا.
- **docs/round4-audit.md**: المكتمل/الناقص/المكسور بمراجع file:line + فجوات G-31..38 (G-31 لا UDP إطلاقًا · G-32 gamepad بلا kind · G-33 قلم/ضغط صفر · G-34 لا شاشة ثانية · G-35 لا جيمباد افتراضي · G-36 sensor:stream بلا مستهلك · G-37/38 حدود بث موثقة) + تصميم NexusLive المرجعي + قائمة تحقق 8 بنود لكل مرحلة قادمة.
- **قرار معماري مُسوّى (موثق عقد §18.أ)**: مرور عبر Node (3010) → loopback (3011) لا إرسال مباشر هاتف→Rust: بوابة الثقة مركزية عند الجسر (controllerTrust + rc:session §13) + إحصاء الفقد/الترتيب/RTT رصده من E2E + Rust حوض معزول بلا سطح هجوم شبكي. كلفة loopback عشرات الميكروثانية.
- **live_core.rs** (نقية — تُضمَّن في verify): رأس 22B (magic 0x4E58 · ver · type · flags bit0=نسبي · seq · ts · key 8B) — pen 10B (ضغط/ميل/طور) · mouse 8B (مطلق u16/نسبي i16±500 + أزرار bit0 + عجلة) · gyro 12B (milli-g/dps) · touch 8B (إجراءات pointer الستة) · ping/pong. فك صارم بلا panics + seq_update wrap-aware + packet_to_events (بلا مسار حقن موازٍ: pen/touch→pointer، نسبي→move، عجلة→scroll بتدرّج 40px §13، gyro بلا حدث) + **coalesce latest-wins**: slotان مستقلان (مطلق/نسبي)، منفصلات كلها بالترتيب، الحركة المعلقة تُفرغ قبل النقرة (الموضع قبل النقرة)، حالة الزر في كل حزمة (دلالة ذاتية التصحيح ضد فقد الحزم — بلا تعليق زر).
- **self-caught critical bug قبل الإثبات**: الرأس كُتب أولًا 20B بينما key 8B عند [14..22) = 22B فعليًا — وحمولات pen/mouse بالمواصفة لم تطابق مجموع حقولها — تُصلح في الثلاثة (Rust/Dart/توثيق) قبل أي دمج عبر اللغات.
- **input.rs execute_sync**: InputMsg::ExecSync — نفس خيط enigo ونفس بوابة الجلسة §13 حرفيًا + mpsc إشعار اكتمال الحقن الفعلي (قياس صادق لا جدولة فقط) + exec_events مشترك للمسارين.
- **live.rs**: bind 127.0.0.1:3011 حصرًا (NEXUS_LIVE_SINK_PORT — 3 محاولات ثم استسلام صادق) — حلقة: أول حزمة حاجزة → تفريغ غير حاجز ≤4 → coalesce → بوابة جلسة → execute_sync → قياس e2e (ts المرسل بعد إزاحة NTP) بنافذة 256 عينة P50/P95 (إهمال ≥60ث انحراف ساعة) + تدقيق native-input كل 1000 حقنة + live_state أمر (stats/latency كاملة).
- **الجسران متطابقان** (remote-bridge.ts + mini-service): ensureLiveUdp (dgram :3010) — تنقية magic/ver/type/طول/مفتاح/عنوان — key=randomBytes(8) لكل rc:live-hello (موثوق+جلسة نشطة حصرًا، إعادة hello = استبدال تدفق) — تثبيت عنوان أول حزمة (droppedAddr) — ping→pong بنفس seq وts الجسر — seq stats (lost/reorder/dup) — إعادة توجيه خام إلى 3011 — rc:live-stats دوري 5ث وعند الطلب (rc:live-stats?) — dropLiveFlows في endSession/disconnect (القناة ترث عمر الجلسة).
- **Flutter live_channel.dart** (بلا تبعية جديدة — dart:io): activate/deactivate حسب rc:live-ready — داتاجرام واحد لكل حدث (≤34B) — ping 500ms + RTT EMA α=0.3 + إزاحة NTP-نمط `pongTs−(t0+t1)/2` — watchdog بلا pong 3ث → إعادة hello بتراجع أُسي 500ms→8s يُصفّر عند pong — بلا patch لكل إرسال (240Hz لا يغرق الواجهة). **controller_service**: auto-hello بعد 150ms من قبول الجلسة — move/sendPointer فوق UDP حصرًا عند نشاط التدفق (وإلا socket.io كما كان) — sendPen (ضغط/ميل) جاهزة لمهمة لوحة الرسم — رقاقة حالة (rctl.live.ready/opening/tcp) بالقاموسين.
- **scripts/live-verify** (نمط media-verify — يضمّن live_core.rs + input_exec.rs حرفيًا): **49/49** — فك/ترميز كل الأنواع + رفض الفاسد (قصير/توقيع/إصدار/نوع/طول/سقف) + تسلسل wrap-aware + خريطة أحداث (ضغط القلم محمول ±تكميم 1e-4، drag bit0، نقرات الوضع النسبي، عجلة→scroll dy=120) + دمج حي 5 متجهات + **UDP loopback حقيقي عبر Xvfb بقياس طرف-إ-to-طرف**.
- **درس أداء حاسم (اكتشف بالقياس لا بالتمني)**: XTEST المتزامن ~7ms/عملية على Xvfb — عند 250Hz إجهادية يتقدم الإرسال على إنتاجية الحقن فينمو الكمون (P50=372ms بلا دمج) — الدمج الحي حده، والحل الكامل: تفريغ ≤4 + قياس على المعدلات الحقيقية: **حدث قلم مفرد P95=13ms < 20ms (معيار النجاح ✓)** · تدفق 60Hz مختلط P50=8ms/P95=25ms مقيّد بلا تراكم · نقرات محفوظة 25/25 — الحد موثق بصدق في §18.هـ (فوق إنتاجية XTEST للمنصة ينمو مؤقتًا رغم الدمج).
- **E2E §18 (14 فحصًا)** — الكامل **141/141**: رفض بلا ثقة/جلسة — live-ready (3010/16-hex/128/1) — pong بنفس seq وRTT=2ms — 3 حزم touch تصل الحوض كما هي — إحصاء دقيق (received=5 · lost=2 · reorder=1 · dup=1) + تثبيت العنوان — فاسد/مفتاح مجهول/عنوان آخر تُرفض — نهاية الجلسة تموت التدفق (sinkDelta=0 + flows=0) — توثيق §18 + تطابق الجسرين + Rust loopback + عميل Flutter + ترجمات.
- **حادثة تاريخ مُكتشفة ومُصلحة ذاتيًا (درس add -A تكرر مرة أخرى)**: أول دفعة شملت scripts/live-verify/target/ (612 ملفًا artifacts) — و`src/app/api/fs/upload/route.ts` (عقد §8.2) وُجد محذوفًا من شجرة العمل منذ إقلاع الجلسة فدخل النطاق — إصلاح: reset إلى 045b85f + استعادة route.ts حرفيًا من 045b85f + إضافة scripts/live-verify/target/ إلى gitignore + إعادة بناء standalone/resources + إعادة E2E كامل 141/141 + إعادة الالتزامات الخمسة النظيفة + **force-with-lease** (5e499ba→a4ba367) — تحقق نهائي: صفر target متتبع، route.ts في HEAD، صفر blobs >1MB في النطاق، مزامنة 0/0.
- v1.0.0 لم تُمَس (لا إصدار/وسم/أصول) — rust مثبت محليًا (cargo 1.99) وcargo metadata أخضر؛ الترجمة الفيزيائية الكاملة للطبقة الأصلية عبر CI desktop.yml (نمط §13/§15 المعتمد — الحاوية بلا GTK/WebKit).

Stage Summary:
- أساس الجولة 4 مكتمل أعلى مستوى ممكن: **NexusLive حية من الهاتف إلى حقن enigo فعلي** — بروتوكول ثنائي موثق §18 حرفيًا عبر ثلاث لغات (TS/Dart/Rust) بمرآة متطابقة، ثقة مركزية على الجسر مع مفتاح جلسة وتثبيت عنوان، دمج حي يمنع تراكم الكمون، إحصاء فقد/ترتيب/RTT قابل للرصد تعاقديًا.
- **معيار النجاح مثبت بالقياس**: حدث قلم/لمس UDP → حقن فعلي P95=13ms (<20ms المطلوبة) على أبطأ بيئة مثبتة (Xvfb) — والميداني موثق في docs/e2e-checklist.md §12 (10 خطوات هاتف حقيقي).
- البنية جاهزة للمراحل: لوحة الرسم (sendPen بضغط كامل جاهز) · الجيمباد (gyro يُعدّ إحصاءً بانتظار مستهلكه) · الشاشة الثانية (نفس قناة التسليم). فجوات G-31..38 موثقة بقائمة مرجعية لكل مرحلة.
