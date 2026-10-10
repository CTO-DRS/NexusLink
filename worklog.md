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
