# NexusLink — عقد بروتوكول الوكيل (Device Agent Contract)

> **هذا المستند هو المصدر الوحيد للحقيقة** لبناء تطبيق Flutter (وكيل الجهاز).
> استُخرج حرفيًا من كود السيرفر الفعلي (المراحل 1–11) بتاريخ 2026-10-10.
> القاعدة: Flutter يطابق هذا العقد **حرفيًا** — أي فجوة تُضاف إلى السيرفر لا لعميل جديد.

---

## 1. طوبولوجيا السيرفر الفعلية (مؤكدة بالفحص الحي)

| المنفذ | العملية | الدور | بروتوكول |
|--------|---------|-------|----------|
| **81** | caddy | المدخل العام: أي طلب يحمل `?XTransformPort=<port>` يُحوَّل إلى `localhost:<port>`؛ غير ذلك → 3000 | HTTP/WS proxy |
| **3000** | next dev | واجهة الويب + كل REST APIs تحت `/api/*` | HTTP |
| **3003** | bun `mini-services/comms-service` | جسر الاتصالات (هاتف افتراضي + انعكاس إشعارات/SMS/مكالمات/DND) | socket.io v4 |
| **3004** | bun `mini-services/remote-service` | جسر التحكم عن بُعد (إدخال/طاقة/WOL/حافظة) | socket.io v4 |
| **3005** | داخل عملية Next (`ensureMediaBridge`) | الوسائط والكاميرا: إشارات WebRTC، مصراع، بث، مراقبة | socket.io v4 |
| **3006** | داخل عملية Next (`ensureGuardBridge`) | الحماية: منارة القرب، رن/فقدان/مسح/منبهات/إعدادات سريعة | socket.io v4 |
| **3007** | داخل عملية Next (`ensureProdBridge`) | الإنتاجية: الحافظة الموحدة، تسليم الروابط، مزامنة الصور | socket.io v4 |
| **3009** | داخل عملية Next (`ensureSecurityBridge`) | قناة E2E المشفرة: ترحيل إطارات AES-GCM عمياء + صلاحيات + تدقيق + مسح آمن + قفل عن بُعد | socket.io v4 |
| **3008** | داخل عملية Next (`ensureAutomationBridge`) | محرك الروتينات §26: قواعد «عند حدوث X نفّذ Y» فوق القنوات القائمة | socket.io v4 |

**خصائص socket.io الموحدة في كل الجسور:**
- `path: "/"` (يقبل أي مسار بما فيه `/socket.io/` — مؤكد بالفحص: `GET :3003/socket.io/?EIO=4&transport=polling` أعاد handshake صالحًا)
- `cors: { origin: "*", methods: ["GET","POST"] }` — لا توكن، لا مصادقة على مستوى socket (الثقة تُدار عبر سجل الأجهزة في جسر 3009 فقط)
- `pingInterval: 25000, pingTimeout: 60000`

**للـ Flutter Agent:** اتصل **مباشرة** بمنافذ الجسور `ws://<SERVER_IP>:<port>/` (بدون Caddy) — هذا مطابق لطريقة استماع السيرفر. `SERVER_IP` يأتي من الاقتران/mDNS/الإدخال اليدوي.

---

## 2. نماذج البيانات الأساسية (من `src/lib/nexus/types.ts`)

```ts
interface NexusDevice {
  id: string            // "galaxy-s24" — slug من الاسم عند الاقتران
  name: string          // "Galaxy-S24"
  kind: "phone" | "tablet" | "desktop" | "tv"
  state: "connected" | "offline" | "pairing"
  mode: "wifi" | "hotspot" | "usb"
  ip: string
  battery: number
  storageTotal: number; storageUsed: number
  lastSeen: number; rttMs: number; pairedAt: number
  trusted: boolean
}

interface FsEntry {
  name: string
  path: string          // مسار افتراضي يبدأ بـ "/" دائمًا
  type: "dir" | "file"
  size: number          // dirs = 0
  mtime: number         // epoch ms
  ext: string           // بدون نقطة، "" للمجلدات
  category: "image"|"video"|"audio"|"pdf"|"text"|"apk"|"zip"|"other"
  mime?: string
}

interface TransferJob {
  id: string            // "tx_<ts36>_<rand5>"
  deviceId: string; deviceName: string
  direction: "out" | "in"   // out: هذا الجهاز → عن بُعد، in: العكس
  fileName: string; srcPath: string; destPath: string
  totalBytes: number; transferred: number
  status: "queued"|"active"|"paused"|"done"|"error"
  speedBps: number
  chunksTotal: number; chunksDone: number; chunkSize: number  // 256KB
  startedAt: number; error?: string
}
```

**سجل الأجهزة الحالي (seed v3):** `pc-office`, `galaxy-s24`, `ipad-pro`, `redmi-note13`, `nexus-tv`.
**الجذر الافتراضي للأجهزة:** `galaxy-s24` و`redmi-note13` → `data/nexus-storage/media`، `pc-office` → `pc-fs`، `ipad-pro` → `tab-fs`.
**الاستقبال:** اتجاه `in` يكتب في `pc-fs/Downloads`، اتجاه `out` يكتب في `media/Download` (نقل حقيقي بايتات مع `.nexuspart` + resume).

---

## 3. REST APIs (على :3000 — أو عبر Caddy :81)

### 3.1 الأجهزة والاقتران
| Endpoint | الشكل الفعلي |
|----------|--------------|
| `GET /api/devices` | → `{ devices: NexusDevice[] }` (مع heartbeatBump: تحديث lastSeen/rtt/battery للمتصل) |
| `POST /api/devices` | body `{action: "connect"|"disconnect"|"forget", id}` → `{ok, device?}` |
| `POST /api/devices` | body `{action: "pair", name, kind?}` → يسجّل جهازًا جديدًا: `id = name→slug`، `ip = 192.168.1.{50+rand100}`، `trusted: true` → `{ok, device}`. **ملاحظة: لا يتحقق من سر QR إطلاقًا (فجوة G-1)** |
| `POST /api/devices` | body `{action: "send-file", deviceId, deviceName?, direction: "out"|"in", srcDeviceId, srcPath, fileName}` → `{ok, job: TransferJob}` أو `{error}` 400 |
| `GET /api/devices/qr` | → `{qr: dataURL-PNG, code: "<6 أحرف من السر>"}`؛ حمولة QR نص JSON: `{v:1, proto:"Nexus/1.2", host:"192.168.1.2", port:7420, secret:<32hex>, ts}` (**فجوة G-2: لا مستمع على 7420، والسر لا يُتحقق منه في pair**) |

### 3.2 الملفات (نظام الملفات الافتراضي الحقيقي)
| Endpoint | الشكل الفعلي |
|----------|--------------|
| `GET /api/fs?device=<id>&path=/<vp>&q=<بحث>` | → `{entries: FsEntry[], path}` (الاستعلام `q` يبحث تعاوديًا حتى 200 نتيجة) |
| `POST /api/fs` | `{op: "mkdir"|"rename"|"delete"|"copy"|"move"|"zip"|"extract", deviceId, path?, name?, paths?, dest?, zipName?}` → `{ok, message}` (رسائل بالعربية) |
| `PUT /api/fs` | `{deviceId, path}` → `{bytes, count, dirs}` (إحصاء تعاودي) |
| `GET /api/thumb?device=&path=` | → صورة `image/webp` 420×420 (sharp، cache داخلي) — للمصغرات |
| `GET /api/preview?device=&path=&download=1` | → بث الملف الكامل مع دعم `Range` كامل (فيديو/صوت seek) |
| `POST /api/apk` | `{deviceId, path}` → فحص APK حقيقي (unzip -l) → `{ok, fileName, entries, files[], manifest?}` |

### 3.3 النقل
| Endpoint | الشكل الفعلي |
|----------|--------------|
| `GET /api/transfer` | → `{jobs: TransferJob[]}` (الأحدث أولًا) |
| `POST /api/transfer` | `{action: "pause"|"resume"|"cancel"|"verify", id}` → `{ok, job?}` / verify → `{ok, hash?}` (MD5 مبتور 8 خانات) |

### 3.4 الاتصالات الشخصية (Persistence عبر Prisma/SQLite)
| Endpoint | الشكل الفعلي |
|----------|--------------|
| `GET /api/comms/bootstrap` | → `{notifications[], filter, conversations[], contacts[], calllog[], phone:{dnd,dndSource}}` — تحميل أولي كامل |
| `POST /api/comms/notifications` | **هذا هو ingest من الهاتف**: `{appId, appName?, title, body, actionable?}` → يمر عبر قواعد الفلترة (`evaluateIngest`) → `{ok, notification}` (status: new/hidden/...) |
| `GET /api/comms/notifications` | → `{notifications[]}` آخر 60 |
| `POST /api/comms/sms` | `{op:"incoming", address, body}` → إنشاء محادثة/رسالة → `{conversation, message}`؛ `{op:"status", messageId, status}` → تحديث الحالة |
| `POST /api/comms/calls` | `{op:"missed", number, contactName?}` → سجل مكالمات |
| `POST /api/comms/phone` | `{dnd, dndSource}` → مزامنة DND |
| `/api/comms/contacts`, `/api/comms/filter`, `/api/comms/notifications/action` | قراءة/تحديث جهات الاتصال والفلترة واتخاذ إجراء على إشعار |

### 3.5 أخرى
- `GET /api/tools/ping` · `GET /api/tools/speedtest` (pool 4MB) · `GET /api/tools/diag` · `GET /api/version`
- `POST /api/security/wipe` · `GET /api/security/audit` · `GET /api/security/pcap` · `GET /api/security/recv`
- `GET /api/prod/state|pairs|photos|profiles|network|clipboard|handoff|backup` + POST نظيراتها
- `GET|POST /api/{guard,media,remote,prod,security}/boot` — إقلاع الجسور idempotent داخل عملية Next (هاتف يستطيع استدعاءها لضمان عمل الجسور)
- `GET|POST /api/devices/health` — مركز صحة الأجهزة (قياس زمني + تنبيهات + مسار الوكيل الحقيقي report) — التفاصيل في §27

---

## 4. خريطة أحداث socket.io الكاملة (العقد الحرفي)

### 4.1 جسر 3003 — الاتصالات
**Server → Client (الهاتف يستمع):**
| الحدث | الحمولة |
|-------|---------|
| `bridge:hello` | `{phone:{name, dnd, autoMode, battery}, at}` |
| `phone:log` | `{id, text, kind: "info"|"in"|"out"|"ok", at}` |
| `notif:mirror` | `{notification:{id, appId, appName, title, body, actionable, status, replyText, createdAt}}` (يُبث بعد ingest واجتياز الفلترة فقط) |
| `sms:incoming` | `{conversation:{id,address,contactName,unread}, message:{id,body,direction:"in",status,createdAt}}` |
| `sms:status` | `{messageId, status: "sent"|"delivered"}` |
| `call:incoming` | `{callId, number, contactName?, at}` (timeout 20s → missed) |
| `call:state` | `{callId, state: "ringing"|"active"|"ended", missed?/busy?/rejected?, durationSec?}` |
| `dnd:state` | `{enabled, source: "phone"|"pc"}` |

**Client → Server (أحداث تراقب سلوك "الهاتف"):**
| الحدث | الحمولة | ملاحظة للوكيل الحقيقي |
|-------|---------|------------------------|
| `phone:reply-action` | `{notifId, appId, appName?, text}` | رد سريع على إشعار — الوكيل ينفذه عبر Notification Action |
| `phone:sms-send` | `{messageId, address, body, contactName?}` | إرسال SMS من الكمبيوتر — الوكيل يستخدم SmsManager ثم يبث `sms:status` بنفس التوقيت |
| `phone:call-dial` | `{callId, number, contactName?}` | الاتصال من الكمبيوتر |
| `phone:call-answer` / `phone:call-reject` | `{callId}` | الرد/الرفض من الكمبيوتر |
| `phone:call-end` | `{callId, durationSec, direction, number, contactName?}` | إنهاء مكالمة جارية |
| `phone:dnd-set` | `{enabled}` | مزامنة DND من الكمبيوتر |
| `phone:simulate` | `{kind: "whatsapp"|...|"sms"|"call"|"dnd"}` | خاص بالمحاكي — الوكيل الحقيقي لا يستخدمه |
| `phone:auto-mode` | `{enabled}` | خاص بالمحاكي |

### 4.2 جسر 3004 — التحكم عن بُعد (الهاتف = controller، الكمبيوتر = desktop)
**Server → Client:**
| الحدث | الحمولة |
|-------|---------|
| `rc:hello` | `{desktop:{name, mac, power}, at}` — عند الاتصال |
| `rc:log` | `{id, text, kind, at}` |
| `rc:controller-online` | `{name, at}` — broadcast عند تسجيل هاتف |
| `desktop:state` | `{power}` (relay) |
| `desktop:clipboard` | `{text, at?}` — دفع حافظة PC→هاتف (الهاتف ينسخها محليًا) |
| `desktop:wake` | `{source: "input"|"wol", ev?/mac?/packet?}` |
| `rc:pong` | `{t}` — قياس RTT |
| `rc:rejected` | `{reason: "off"|"hibernating"|"mac"|"already-on", ev}` |

**Client → Server (الهاتف يرسل):**
- تسجيل: `rc:hello-controller {name}` · `desktop:register {name, mac}` (للكمبيوتر — **FA-power: MAC الحقيقي المعلن من الطبقة الأصلية عند كل اتصال، ويُخزّن في الهاتف للإيقاظ دون اتصال**)
- `desktop:state {power}` · `desktop:clipboard {text, at?}`
- `rc:ping {t}`
- أحداث الإدخال (تُرحَّل broadcast مع بوابة الطاقة): `rc:move {dx, dy}` · `rc:click {button: "left"|"right"}` · `rc:scroll {dy}` · `rc:pinch {scale}` · `rc:key {key?, special?, modifiers?}` · `rc:gamepad {kind: "button"|"axis", button?, action?, ...}` · `rc:presenter {action: "next"|"prev"|"black"|"laser-on"|"laser-off", value?}` · `rc:media {action: "toggle"|"play"|"pause"|"next"|"prev"|"mute"|"unmute"|"volume", value?}` · `rc:clipboard {direction: "toPc"|"pull", text?}`
  - **FA-input (§13) امتدادات خلفية لا تكسر القائم**: كل حدث إدخال مبثوث يحقن `__src: "desktop"|"controller"|"unknown"` (تمييز المصدر) · `rc:presenter` يضيف `start`|`stop` (F5/Esc) · جلسة التحكم الموثوقة `rc:session` (start/hb/stop) — التفاصيل في §13.
- `rc:power {action: "shutdown"|"restart"|"sleep"|"hibernate"|"lock"|"unlock"|"logout"}` — **FA-power: logout إضافي (شاشة الدخول = حالة locked)؛ التنفيذ الحقيقي في الطبقة الأصلية (§12) بتأكيد أمان 10ث قابل للإلغاء للأوامر المدمرة**
- `rc:wol {mac}` — تحقق صارم من MAC وإعادة صياغة الحزمة 6×FF+MAC×16 — **FA-power: إرسال فعلي عبر UDP broadcast إلى المنفذ 9 (NEXUS_WOL_BROADCAST يبدّل الوجهات للاختبار) + سجل نتيجة الإرسال الحقيقي**

### 4.3 جسر 3005 — الوسائط والكاميرا
**Client → Server:** `media:role {role: "pc"|"phone"|"tv", name?}` (الهاتف يسجل role=phone) · `rtc:offer/rtc:answer/rtc:ice` `{kind: "cam"|"mic"|"baby", ...SDP/ICE}` (ترحيل شفاف broadcast مع حقن kind وfrom) · `cam:state` · `cam:shutter {timer 0..30}` · `cam:captured {name, device}` · `sec:motion {source?, level?}` · `baby:alert {from?, level?}` · `cast:cmd {...}` · `cast:state {...}` · `slideshow:cmd {...}` · `media:ping {t}`
**Server → Client:** `media:hello {at, port}` · `media:role-ack {role, at}` · `media:log {id,text,kind,at}` · `media:phone-online {name, at}` · نفس أحداث الترحيل أعلاه · `media:pong {t}`

**FA-8 — إضافات وكيل الجهاز الحقيقي (2026-10-11):**
- `cam:shutter {timer 0..30, flash?: boolean, camera?: "front"|"back"}` — يمرّر الجسر حقلي `flash` (كشاف أثناء العد التنازلي ثم التقاط) و`camera` (الكاميرا المطلوبة) للهاتف. الهاتف الحقيقي بعد الالتقاط يرفع الصورة كملف عبر `/api/fs/upload` إلى جذر جهازه ثم يبث `cam:captured {name, device}`.
- `cam:cmd {action, camera?, on?, sensitivity?}` — طلبات الكمبيوتر للهاتف الحقيقي، ترحيل broadcast بقائمة بيضاء صارمة: `cam-start|cam-stop|switch|torch|mic-start|mic-stop|baby-start|baby-stop|watch-start|watch-stop` مع حقول اختيارية منقاة (`camera: front|back`، `on: boolean` للفلاش، `sensitivity: 0.01..1` لحساسية كشف الحركة).
- `sensor:stream {a?: [x,y,z], g?: [x,y,z], ts}` — بث المستشعرات من الهاتف (role=phone فقط) إلى بقية العملاء بحد 40 رسالة/ثانية لكل مقبس؛ تستخدمه واجهة الويب لاحقًا كجيمباد. `from` يُحقن من اسم الهاتف المسجل.
- **تسلسل WebRTC للهاتف الحقيقي**: الهاتف (صاحب الوسائط) ينشئ `rtc:offer {kind, sdp:{type,sdp}}` عند `cam:cmd {action:"cam-start"|"mic-start"|"baby-start"}`، الكمبيوتر يجيب `rtc:answer {kind, sdp}` ويتبادلان `rtc:ice {kind, candidate}` (trickle). أول إجابة من دور `pc` تُقبل لكل kind وتُتجاهل ما بعدها. `cam:state {deviceId, active, facing, torch, real, mode}` يعلنه الهاتف عند كل تغيير حالة.
- **المراقبة (watch)**: `watch-start` = بث كاميرا مستمر (نفس مسار cam) + كشف حركة على الهاتف بفروق الإطارات (captureFrame كل ~800ms → تصغير 80×60 → فرق لوميناني متوسط → عتبة sensitivity) → عند حركة يبث `sec:motion {source: <اسم الجهاز>, level: 0..100}` مع تهدئة 10 ثوانٍ.
- **مراقبة الأطفال (baby)**: بث صوت الميكروفون فقط مع شاشة مطفأة (WakeLock جزئي) + كشف ارتفاع مستوى الصوت عبر WebRTC getStats (audioLevel) → `baby:alert {from, level}` بتهدئة 20 ثانية.
- **قيود صادقة**: البث/المستشعرات تعمل أثناء حياة واجهة التطبيق (محرّك Flutter). عند انطفاء التطبيق يظل بند «أين هاتفي» (`dev:ring`/`dev:light` على 3006) يعمل لأنه مُنفّذ في خدمة Kotlin الدائمة، ويُظهر `cam:shutter` إشعارًا يطلب فتح التطبيق (لا كاميرا من الخلفية — قيد Android 11+ لخدمة بلا نوع camera).

### 4.4 جسر 3006 — الحماية
**Server → Client:** `guard:hello {prox:{enabled,thresholdRssi,graceSec,autoUnlock,state,rssi,source}, phoneGuardOnline, at}` · `guard:phone-online {online}` · `guard:settings {enabled, thresholdRssi, graceSec, autoUnlock}` · `prox:state {state: "near"|"grace"|"locked"|"disabled", rssi, source, leftMs?, settings}` (نبضة كل 1s) · `pc:lock {reason: "manual"|"weak-signal"|"no-beacon", at}` · `pc:unlock {reason}` · `dev:log {id, text, kind, at}`
**Client → Server:**
- الهاتف يسجّل: `guard:hello-phone {name}` → يبث `guard:phone-online {online:true}`
- منارة القرب الحقيقية: `prox:beacon {rssi, device?}` — **كل ≤ 8 ثوانٍ** (REAL_FRESH_MS=8000) وإلا تُعتبر المنارة ميتة (grace → lock). `prox:sim {rssi}` من الكمبيوتر فقط ولا يعمل عند وجود هاتف حقيقي
- أوامر PC→هاتف (الوكيل يستمع وينفذ ثم يبث `dev:state`/`dev:acked`): `dev:ring` / `dev:ring-stop` / `dev:light {on}` / `dev:lost {on, message}` / `dev:lost-off` / `dev:wipe` / `dev:alarm {action:"add"|"toggle", time, label?, enabled?}` / `dev:qs {key, value}` (wifi/bluetooth/sound/...) / `dev:app {...}`
- **FA-8 — تنفيذ حقيقي في خدمة Kotlin (يعمل حتى مع انطفاء التطبيق)**: `dev:ring` → وضع الرنين NORMAL (تجاوز الصامت) + مستوى صوت الأعلى + رنين تكراري (نغمة ALARM عبر MediaPlayer) + اهتزاز مستمر + إضاءة الشاشة (WakeLock) حتى `dev:ring-stop`؛ `dev:light {on:true}` → إضاءة الشاشة + وميض الكشاف 5 ثوانٍ (CameraManager.setTorchMode عند توفره)، `{on:false}` → إطفاء الكشاف. باقي الأوامر تبقى إقرار استلام (مراحل لاحقة).
- تقارير الهاتف: `dev:state {...}` (relay) · `dev:sync-request` · `dev:acked {text}`

### 4.5 جسر 3007 — الإنتاجية
**Server → Client:** `prod:hello {at}` · `prod:log {id,text,kind,at}` · `clip:new {id, deviceId, deviceName, kind, content, fileName?, filePath?, size, mode, received, createdAt(ms)}` · `clip:cleared {at}` · `hand:new {id, deviceId, deviceName, kind, title, url, position, status, createdAt}` · `hand:opened {id, openedOn, at}` · `photo:new {name, bytes, device, at}` · `net:changed {network, profile, auto, at}`
**Client → Server:**
- `clip:push {deviceId, deviceName, kind: "text"|"image"|"file", content (نص أو dataURL مصغر للصور ≤4MB), fileName?, filePath?, size?, mode: "auto"|"manual"}` → يُخزن في Prisma ويبث `clip:new` للجميع — **هذه هي الحافظة الموحدة؛ الهاتف يراقب نظام الحافظة (mode=auto) ويدفع هنا**
- `clip:clear`
- `hand:push {id?, deviceId, deviceName, kind: "link"|"video"|"article", title, url, position?}` → `hand:new`؛ الفتح على الكمبيوتر: `hand:opened {id, openedOn}`
- `photo:new-request` — يولّد صورة على "الهاتف" (محاكاة) ويزامنها
- `net:set {network}` — تغيير الشبكة وتطبيق ملف التعريف

### 4.6 جسر 3009 — قناة الأمان E2E (الأهم للوكيل)
**دورة حياة العميل (هاتف):**
1. الاتصال → `sec:hello {port, suite, peers, stealth, counters}`
2. إعلان الهوية: `sec:announce {role: "phone", deviceId, name, pub: <b64 X25519>, eph: <b64 ephemeral>}`
   - جهاز **محظور** → `sec:rejected {reason:"blocked"}` + قطع
   - جهاز **غير معروف في السجل** → `sec:pending-trust {alertId, probeId}` + تنبيه على الكمبيوتر (القناة لا تعمل قبل قرار المستخدم)
   - جهاز **موثوق** → تبادل `kex:peer {deviceId, name, role, pub, eph, sid}` بين كل الأطراف + `sec:peers`
3. تدوير الجلسة: `kex:update {eph, epoch}` → ترحيل للأقران
4. إرسال مشفر: `sec:frame {to: <deviceId>, from, kind, iv, ct, seq, stealth?}` — **ترحيل عمياء**؛ السيرفر لا يفك أبدًا؛ يُسجل بايت الإطار في WireTap
   - الهدف غير متصل → `sec:nack {seq, reason:"peer-offline"}`
5. القفل عن بُعد: الكمبيوتر يبث `sec:lock-cmd` لكل الأدوار phone — الهاتف ينفذ ويُبلغ `sec:lock-state`
6. الهاتف يسجل تدقيقًا: `sec:audit {actor, action, detail, severity}`

**أحداث إضافية:** `sec:capture-get/clear` + `sec:capture {frames[]}` (WireTap) · `sec:stranger-probe {name}` · `sec:trust-decision {alertId, deviceId, name, decision: "block"|"once"|"trust"}` · `sec:perm-set {feature, deviceId, enabled}` / `sec:perm-get` → `perm:rules` (الميزات: file_transfer, clipboard, notifications, remote_input, media, camera, microphone, system_commands, contacts, screen_mirror) · `audit:get/clear` → `audit:list` · `wipe:list` → `wipe:files` · `wipe:run {deviceId, vPath, passes: 3|7, stealth}` → `wipe:progress {…, file}` ثم `wipe:done` · `sec:stealth-set {on}` → `sec:stealth`

**امتدادات FA-10 (طبقة أمان الهاتف — نفس الجسر):**
- `sec:lost-cmd {message?, locate?}` — من الكمبيوتر (بث للأدوار phone): تفعيل وضع الفقدان على الهاتف = قفل التطبيق + رسالة ملء الشاشة + جمع إحداثيات الموقع. الهاتف يردّ `sec:lock-state {deviceId, lost: true, message, location?: {lat, lng, accuracy, at}}` (غير مشفر — حالة عمومية) وإطاري `lost-state`/`ack` مشفرين عبر `sec:frame`.
- `sec:wipe-cmd {passes: 3|7}` — من الكمبيوتر: أمر مسح آمن لملفات `Download/NexusLink` المستلمة على الهاتف (كتابة فوق + حذف من MediaStore). الهاتف يردّ `sec:wipe-state {deviceId, ok, count, bytes, error?}` ويُبث للويب مع toast وسطر تدقيق.
- `sec:lock-state` من الهاتف عند الاتصال وعند كل تغيّر: `{deviceId, locked, lost, message?, hasPin, hasBiometric, autoLockSec}`.
- `sec:audit` من الهاتف عند kex/قفل/فتح/مسح — يدخل سجل التدقيق الموحد.

### 4.7 جسر 3006 — أحداث نقل الملفات الحقيقية (أُضيفت في مرحلة Flutter-2)

**على نفس القناة الدائمة للوكيل** (الخدمة الخلفية + واجهة Flutter). تسجيل الوكيل تم عبر `guard:hello-phone {name, deviceId}` — الحقل `deviceId` الجديد يجعل السيرفر يوجّه العروض للجهاز الصحيح.

**Server → Client (الهاتف يستمع):**
| الحدث | الحمولة | الغرض |
|-------|---------|-------|
| `tx:offer` | `{id, fileName, size, mime?, from, srcDeviceId, srcVPath, device, at}` | الكمبيوتر أرسل ملفًا للهاتف (`POST /api/devices {action:"send-file"}`) — يظهر إشعار قبول/رفض (أو قبول تلقائي من موثوق) |
| `tx:pause` | `{id}` | إيقاف تنزيل جارٍ من الكمبيوتر (`POST /api/transfer {action:"pause"}`) |
| `tx:resume` | `{id}` | استئناف من الكمبيوتر |
| `tx:cancel` | `{id}` | إلغاء من الكمبيوتر (المهمة تُحذف لدى السيرفر) |

**Client → Server (الهاتف يرسل؛ السيرفر يحدّث مهمة web عبر applyAgentTx ويبث `tx:update {ev, job}` لعملاء الويب):**
| الحدث | الحمولة |
|-------|---------|
| `tx:accept` | `{id}` — المهمة queued/paused → active |
| `tx:reject` | `{id}` — المهمة → error "رفض الجهاز الاستلام" |
| `tx:progress` | `{id, transferred}` — تقدّم التنزيل (مُخفّف ≤800ms)؛ السرعة تُحسب بسلاسة EMA لدى السيرفر |
| `tx:state` | `{id, state: "done"\|"failed"\|"cancelled"\|"paused", error?}` — done: transferred=total؛ cancelled: تُحذف المهمة |

**بيانات الملف نفسها لا تمر عبر socket.io** — التنزيل عبر `GET /api/preview` بترويسة `Range` (السيرفر يلبّي 206 حتى مع `download=1` بعد إصلاح G-8)، والرفع عبر `/api/fs/upload` المجزّأ.

---

## 4.8 جسر 3006 — التحكم باللمس والحقن (FA-7 — بديل AirMirror)

**القناة:** نفس القناة الدائمة للوكيل (3006). أوامر التحكم تُوجَّه **مباشرة** إلى سوكِت الوكيل (`guardEmitToAgent`) — **بلا بث وبلا صدى لمرسل الويب** (اللمس عالي التكرار). تقارير الوكيل تُبَث لعملاء الويب بعد التحقق أن المرسل هو سوكِت الوكيل المسجل.

### أحداث جلسة التحكم
| الحدث | الاتجاه | الحمولة | ملاحظات |
|-------|---------|---------|---------|
| `dev:ctl-start` | ويب → جسر → وكيل (مباشر) | `{from, name, at}` | `from` = معرّف جهاز الكمبيوتر المُتحكم. الجسر يرفض قبل التوجيه إن لم يكن `from` مسجلًا **وموثوقًا** في سجل الأجهزة (`trusted:true`)، أو إن كان جهاز الوكيل الهدف غير موثوق → `dev:ctl-rejected {reason:"untrusted"\|"target-untrusted"\|"offline", from}` للمرسل فقط |
| `dev:ctl-stop` | ويب → وكيل (مباشر) | `{at}` | إنهاء الجلسة من الكمبيوتر |
| `dev:ctl-state` | وكيل → جسر → بث للويب | `{active, controller?, name?, reason?, at}` | الحالة الرسمية للجلسة من الهاتف: بدء/رفض/إيقاف/انقطاع. `reason`: "confirmed"\|"denied"\|"stopped"\|"phone-stop"\|"disconnected"\|"busy" |
| `dev:touch-ack` | وكيل → جسر → بث للويب | `{seq?, op, ok, err?}` | إقرار تنفيذ الأوامر المنفصلة (tap/long/swipe/scroll/text/key) — `err` مثل "accessibility-off" أو "no-editable-focus" |

### أحداث الإدخال (كلها ويب → وكيل مباشر، تُنَفَّذ على الهاتف فقط إذا كانت جلسة تحكم نشطة)
| الحدث | الحمولة | التنفيذ على الهاتف (Kotlin AccessibilityService) |
|-------|---------|--------------------------------------------------|
| `dev:touch` | `{op, seq?, x, y, x2?, y2?, durationMs?}` | `op`: `tap` · `long` · `swipe` · `scroll` · `down` · `move` · `up` — إحداثيات مطلقة **بالبكسل الفعلي لشاشة الهاتف** (أصل أعلى-يسار). tap/long/swipe/scroll = إيماءات مكتملة عبر `dispatchGesture`؛ down/move/up = سلسلة `StrokeDescription` مستمرة (`willContinue`, API 26+ مع تساقط كامل كاحتياط). محدد معدل على الجسر: 120 حدثًا/ثانية لكل عميل |
| `dev:text` | `{text, at}` | حقن نص في الحقل المركّز: `rootInActiveWindow.findFocus(FOCUS_INPUT)` → `ACTION_SET_TEXT` (مع احتياط BFS لأول `isEditable`)؛ نص فارغ = مسح الحقل. الحد 2000 حرف |
| `dev:key` | `{action, at}` | `back`/`home`/`recents`/`notifications` = `performGlobalAction(GLOBAL_ACTION_*)`؛ `keyboard` = نقر العقدة المركّزة لفتح لوحة المفاتيح أو `GLOBAL_ACTION_BACK` لإخفائها |
| `dev:app` | `{action:"open", pkg, name?}` | (حدث قائم من المرحلة 8 — أصبح يُنفَّذ الآن) `getPackageManager().getLaunchIntentForPackage(pkg)` + `FLAG_ACTIVITY_NEW_TASK`؛ ثم `dev:acked` بنتيجة الفتح |

### أبعاد الشاشة (أساس تحويل إحداثيات الويب)
| الحدث | الاتجاه | الحمولة |
|-------|---------|---------|
| `dev:screen` | وكيل → جسر (يُخزن في globalThis) | `{w, h, density}` — الأبعاد الحقيقية الفعلية (maximumWindowMetrics/getRealSize) + كثافة DPI. يُعاد الإرسال عند تغيّر الشاشة (DisplayListener) |
| `guard:screen` | جسر → بث للويب | نفس الحمولة + `{deviceId, at}` |
| `guard:hello.screen` | جسر → كل عميل جديد | حقل إضافي اختياري: آخر أبعاد معروفة (`null` إن لا شيء) — **إضافي لا يكسر العملاء الحاليين** |

**تحويل الإحداثيات (جانب الويب):** `screenX = (clientX - rect.left) / rect.width × screenW` — والسطح المعروض يحافظ على نسبة أبعاد شاشة الهاتف الحقيقية. عند غياب التقرير يُستخدم افتراض 1080×2340 مع تنبيه.

### قواعد الأمان
1. **حاجز الثقة على الجسر**: `dev:ctl-start` يُوجَّه فقط إذا كان الجهاز المرسل (`from`) والجهاز الهدف (وكيل) كلاهما مسجلين في سجل الأجهزة (`store()`) بـ `trusted:true` — جهاز مجهول أو غير موثوق → `dev:ctl-rejected {reason:"untrusted"}` + سجل تحذير.
2. **بوابة الجلسة على الهاتف**: أوامر `dev:touch/dev:text/dev:key` تُهمَل كليًا ما لم تكن جلسة تحكم نشطة (`ctlActive`) — لا جلسة، لا حقن.
3. **تأكيد بدء الجلسة** (إعداد في تطبيق الهاتف، الافتراضي **مفعّل**): `dev:ctl-start` يظهر إشعارًا نظاميًا بأزرار «سماح/رفض» + حوارًا داخل التطبيق إن كانت الواجهة حية؛ الجلسة لا تبدأ إلا بقرار المستخدم. عند التعطيل: القبول تلقائي (يبقى حاجز الثقة على الجسر قائمًا).
4. **قطع فوري من الهاتف**: زر داخل التطبيق → `dev:ctl-state {active:false, reason:"phone-stop"}` + إلغاء الجلسة محليًا. انقطاع سوكِت الوكيل يُنهي الجلسة دائمًا.
5. تقارير الجلسة (`dev:ctl-state`, `dev:touch-ack`) وأبعاد الشاشة (`dev:screen`) تُقبل من سوكِت الوكيل المسجل فقط (`agentReg().socketId`).

**تحقق E2E (scripts/agent-ctl-e2e.mjs): 20/20 ناجح** — اقتران وكيل موثوق، تقرير dev:screen وبث guard:screen + hello.screen للعميل المتأخر، بدء جلسة من موثوق (توجيه مباشر)، بث dev:ctl-state لعميلَي ويب، رفض المجهول (untrusted) دون توجيه، نقرة/سحبة بإحداثيات دقيقة بلا صدى للمرسل، إسقاط op غير صالح، نص عربي سليم UTF-8، زر رجوع، relay لـ dev:touch-ack، إنهاء الجلسة، ورفض offline عند فقدان الوكيل.

---

## 4.9 جسر 3004 — الهاتف طرف متحكم حقيقي (FA-9 — وكيل Flutter يتحكم بالكمبيوتر، 2026-10-11)

**الأساس**: قسم 4.2 قائم بالكامل على الجسر (rc:* مع بوابة الطاقة gateInput، rc:wol بحزمة سحرية، desktop:clipboard). FA-9 يربط **وكيل Flutter الحقيقي** بدور المتحكم ويضيف امتدادين توافقيين خلفيًا فقط:

**امتدادات FA-9 (الجسر يمررها كما هي — لا كسر للعملاء الحاليين):**
- `rc:move {dx, dy, source?, drag?: boolean}` — حقل `drag:true` اختياري يعلن وضع السحب (نقر مطول على لوحة اللمس الهاتفية)؛ العرض الويبي يظهر أثر سحب عليه دون تغيير سلوك المؤشر. الحقل غير الموجود = السلوك القائم تمامًا.
- `rc:handoff {url, title?}` — «أكمل من حيث توقفت»: من الهاتف إلى الكمبيوتر. تحقق الجسر: URL صالح بنظام http/https فقط وطول ≤ 2048، وإلا `rc:rejected {reason: "url"|"scheme"|"toolong", ev:"rc:handoff"}`. عند القبول: بث `rc:handoff {url, title? (≤120 حرفًا), at}` + سجل. الكمبيوتر يعرضه في شريط التسليم (HandoffBar) وزر «افتح هنا» يفتحه ثم يزيله.

**سلوك وكيل Flutter (المتحكم):**
- يسجل `rc:hello-controller {name}` عند اتصال سوكِت 3004 ويستقبل `rc:hello {desktop:{name,mac,power}}` لعرض اسم الكمبيوتر وMAC لـ WOL.
- لوحة اللمس: `onScaleUpdate` إصبع واحد → `rc:move {dx,dy}` (نسبية/430×سرعة) · إصبعان عمودي أو سحب من الحواف (±15%) → `rc:scroll {dy}` · تفرق الإصبعين → `rc:pinch {scale}` · tap → `rc:click {button:"left"}` · doubleTap → `{type:"double"}` · زر أيمن → `{button:"right"}` · نقر مطول → وضع سحب ثم `rc:move {..., drag:true}`.
- كيبورد: كل حرف من TextField (عربي/إنجليزي حسب لوحة النظام) → `rc:key {ch}` · صف خاص → `{special: "enter"|"backspace"|"up"|"down"|"left"|"right"|"esc"|"tab"|"space"}`.
- ماوس هوائي: زر تفعيل (مفتاح + عتبة حركة) ثم تكامل الجيروسكوب (gyroEventStream 50ms، تنعيم أُسّي، قتلة ما تحت العتبة) → `rc:move {dx,dy,source:"airmouse"}`.
- وسائط/طاقة: `rc:media {action,...}` مباشرة · أوامر الطاقة بحوار تأكيد → `rc:power {action}` · WOL → `rc:wol {mac}` (الافتراضي MAC من rc:hello).
- الحافظة الموحدة: استقصاء `Clipboard.getData` كل 1.5 ثانية أثناء فتح الشاشة (بدون خدمات خلفية — قيد Android 10+) → تغيّر + وضع تلقائي مفعّل → `rc:clipboard {direction:"toPc", text}`؛ زر يدوي دائمًا متاح · استقبال `desktop:clipboard {text}` → عرض + زر نسخ محلي · طلب حافظة الكمبيوتر → `{direction:"pull"}` فيرد الكمبيوتر بـ `desktop:clipboard`.
- تسليم: زر مشاركة نظام (ACTION_SEND نص/رابط) يصل عبر `drainShare` القائم + إدخال يدوي داخل الشاشة → `rc:handoff {url, title}`.
- الودجات: ودجت اتصال (تقرأ حالة من SharedPrefs تكتبها خدمة الوكيل الدائمة عند تغيّرها) + ودجت إرسال سريع (يفتح التطبيق على شاشة الحافظة/التسليم) — AppWidgetProvider بلا سوكت مستقل.
- بوابة الطاقة تبقى سارية: الكمبيوتر off/hibernating يرفض كل الإدخال (`rc:rejected`).

**تحقق E2E (scripts/agent-rc-e2e.mjs):** سيناريو اختبار النجاح (rc:move يصل عميل الويب ثم rc:clipboard toPc) + قائمة فحص الطاقة/WOL/handoff + عربي UTF-8 — النتيجة أسفل worklog.

---

## 5. عقد التشفير E2E (من `src/lib/nexus/e2e-crypto.ts` — مطابق للـ Dart)

| العنصر | القيمة الدقيقة |
|--------|----------------|
| المجموعة | `X25519 · HKDF-SHA256 · AES-256-GCM` (SUITE) + `PBKDF2(150k)` للـ PIN |
| الهوية | X25519 keypair؛ `pub` 32B يُبث b64 |
| مفتاح الجلسة | `HKDF-SHA256(ikm=ECDH(shared), salt="nexuslink-v1\|{idA}\|{idB}" بترتيب معجمي، info="nexuslink-e2e-session", L=32)` |
| الإطار | `{iv: b64(12B عشوائي), ct: b64, seq}` مع `AAD = "{aad}\|{seq}"` وtagLength=128 |
| الإعادة | `seq` يرفع حصراً؛ `seq <= lastSeq` → `REPLAY_DETECTED` |
| SAS | `sha256("{idA-مفروز}\|{hex(pubA)}\|{idB-مفروز}\|{hex(pubB)}")` → 4 إيموجي (من مصفوفة 32) + 6 hex بأنيق `xxx-xxx` |
| البصمة | `sha256(pub)` أول 8 بايت → hex UPPER مجمّعة `XXXX XXXX XXXX XXXX` |
| PIN/النمط | PBKDF2-SHA256 بـ 150,000 تكرار، salt 16B عشوائي، مقارنة زمن-ثابت |

---

## 6. دورة الاقتران الحالية والفجوات المرصودة

**الموجود فعليًا (بعد إصلاح Flutter-1):**
1. الكمبيوتر يولّد QR: `GET /api/devices/qr` → `secret` عشوائي 32-hex + `code` أول 6 أحرف + `payload` نصي.
2. حمولة QR: `{v:1, proto:"Nexus/1.2", host:<IP حقيقي من ترويسة الطلب>, port:<81 أو 3000>, secret, ts, name:"NEXUS-PC", ports:{rest:3000, comms:3003, remote:3004, media:3005, guard:3006, prod:3007, sec:3009, gateway:81}}`.
3. إتمام: `POST /api/devices {action:"pair", name, kind, id?, ip?, battery?, storageTotal?, storageUsed?, model?, secret?}` → `{ok, device}` (idempotent عبر id/name) — **`secret` إلزامي بعد G-1 (أدناه)**.

**الفجوات (G) — الحالة بعد مرحلة Flutter-1:**
| # | الفجوة | الحالة | ما نُفّذ |
|---|--------|--------|----------|
| G-1 | `pair` لا يتحقق من سر QR | ✅ **مُصلحة** (مرحلة الأمان) | `verifyPairingSecret()` في `src/lib/nexus/devices.ts`: كل `pair` (جديد وإعادة تسجيل) يتطلب سر آخر رمز QR مُصدَر داخل نافذة 10 دقائق (`PAIRING_TTL_MS`) — مقارنة `crypto.timingSafeEqual` بعد فحص الطول. الرفض 403 مسبب (`reason ∈ {no-window, missing, expired, invalid}`) + رسالة عربية واضحة + تدقيق أمني `pairing-reject` (severity warn) والنجاح `pairing` (info) في سجل §16 (أُضيفت للمفردات المرئية في audit route + شاراتها في audit-tab). `GET /api/devices/qr` يُدوّر السر عند كل إصدار (آخر رمز هو الصالح) ويعيد `ttlMs/expiresAt` للشفافية. العملاء: PairDialog (ويب) يرسل السر ويعالج الرفض بإعادة إصدار تلقائية؛ Flutter `api.pair(secret)` مع `PairingRejectedException` — والإدخال اليدوي يجلب السر من `/api/devices/qr` (نمط §1 أدناه، بلا نقطة `/api/pair/claim` موازية — قرار «لا بروتوكول موازٍ»). **حد صادق**: البوتستراب من نفس قناة REST (الإدخال اليدوي) لا يضيف قربًا فعليًا — الإثبات الأقوى يبقى مسح الكاميرا لرمز معروض على شاشة الكمبيوتر؛ والأجهزة المزروعة في البذرة تظل موثوقة مسبقًا (سجل محاكاة الجولة الأولى). E2E: قسم G-1 في desktop-e2e.mjs (no-window/missing/invalid/قبول/إعادة تسجيل/تدوير/تدقيق/فحوص مصدر). |
| G-2 | QR يعلن `port:7420` الميت + IP ثابت | ✅ **مُصلحة** | `/api/devices/qr` يشتق host/port من ترويسة Host الواردة، ويعيد `payload` نصيًا + خريطة منافذ الجسور كاملة `ports:{rest,comms,remote,media,guard,prod,sec,gateway}` + `name:"NEXUS-PC"` |
| G-3 | لا اكتشاف تلقائي | ✅ **مُصلحة** | comms-service يعلن `NEXUS-PC._nexuslink._tcp` عبر bonjour-service (port 81) مع TXT: proto/name/gateway/rest/comms/remote/media/guard/prod/sec — best-effort بلا إيقاف الخدمة عند فشل multicast |
| G-4 | سجل الأجهزة في الذاكرة | مقبول | الوكيل يعيد التسجيل تلقائيًا (idempotent عبر `id` الثابت) |
| G-5 | دور الوكيل الحقيقي في 3003 | موثق | الوكيل مصدر ingest عبر REST ومستمع `phone:*`؛ يوقف autoMode عند التشغيل |
| G-6 | `pair` يقبل حقول الوكيل الاختيارية | ✅ **مضافة** | `{action:"pair", id?, ip?, battery?, storageTotal?, storageUsed?, model?}` — idempotent عبر `id` (Android ID)، نفس الاستجابة `{ok, device}` دون أي كسر للعميل القديم |

---

## 7. حزمة اتصال الوكيل (ما يجب أن يفعله تطبيق Flutter حرفيًا)

1. **اكتشاف/اقتران**: UDP discovery (بعد G-3) أو إدخال IP يدوي → جلب QR من الكمبيوتر أو عرض QR من الهاتف → تبادل السر → `POST /api/devices {action:"pair", secret}` (**G-1 مُغلقة**: نفس نقطة pair، لا `/api/pair/claim` موازية) → حفظ `{serverName, ip, ports, deviceId, secret?, pub}` في drift/SQLite.
2. **طبقة الاتصالات**: 3 اتصالات socket.io دائمة (إعادة اتصال تلقائي):
   - `:3003` كمصدر ingest عبر REST + مستمع `phone:*` (رد سريع/SMS/مكالمات/DND).
   - `:3006` كمنارة قرب (`prox:beacon` كل 5s) + منفذ أوامر `dev:*`.
   - `:3009` كطرف E2E (`sec:announce` → `kex:peer` → `sec:frame`) — مستمع `sec:lock-cmd`.
   - حسب المرحلة: `:3004` (تحكم)، `:3005` (كاميرا WebRTC)، `:3007` (حافظة/تسليم).
3. **الصلاحيات**: كل أذونات Android تُطلب وقت الاستخدام بشرح ar/en؛ Foreground Service دائم للمنارة والمراقبة.
4. **المرآة**: الإشعارات (NotificationListenerService) → `POST /api/comms/notifications`؛ الرسائل/SMS → `POST /api/comms/sms {op:"incoming"}`؛ المكالمات → `POST /api/comms/calls {op:"missed"|"in"|"out"}`.
5. **تقرير الحالة**: بطارية/تخزين/RTT → عبر `dev:state` (3006) وتحديثات REST عند الاقتران.

---

## 8. نقل الملفات الحقيقي للوكيل (أُضيف في مرحلة Flutter-2 — المصدر: `/api/fs/upload` + guard-bridge)

### 8.1 جذر الجهاز الحقيقي (إصلاح G-9)
كل جهاز وكيل حقيقي يحصل تلقائيًا على جذر فعلي `data/nexus-storage/agents/<deviceId>/` (يُنشأ عند `pair` وعند أول رفع عبر `ensureDeviceRoot`) — ملفات الهاتف المرفوعة **تظهر وتتصفح من واجهة الويب** تحت جهازه عبر `GET /api/fs?device=<deviceId>`.

### 8.2 الرفع المجزّأ القابل للاستئناف (هاتف → سيرفر)
| الطلب | الشكل |
|-------|-------|
| `POST /api/fs/upload` | `{op:"init", deviceId, path?="/Downloads", name, size, mime?, localPath?, chunkSize?, taskId?}` → `{ok, uploadId, received, jobId, chunkSize}` — `taskId` معرّف مستقر من الهاتف: **إعادة init بعد أي قتل تعيد نفس الجلسة** و`received` = حجم `.nexuspart` الموجود (استئناف) |
| `PUT /api/fs/upload?upload=<id>&offset=<n>` | جسم = بايتات خام (2–8MB) → `200 {ok, received}` · `409 {ok:false, drift:true, received}` (انزياح — أعِد الضبط) · `409 {ok:false, paused:true, received}` (موقوفة من الكمبيوتر) |
| `POST /api/fs/upload` | `{op:"complete", uploadId}` → `{ok, job}` (rename `.nexuspart` → الاسم النهائي الفريد؛ مهمة done) |
| `POST /api/fs/upload` | `{op:"pause"\|"resume"\|"abort", uploadId}` — abort يحذف الجزئي ويقفل المهمة |
| `GET /api/fs/upload?upload=<id>` | `{ok, received, size, name, status, jobId}` — للاستئناف بعد إعادة تشغيل أي طرف |

مهمة الرفع تُنشأ بـ `direction:"out"` (من منظور الهاتف) + `agent:true` + `uploadId` — تظهر حية في شاشة نقل الويب (progress تتحدث مع كل PUT).

### 8.3 التنزيل إلى الهاتف (كمبيوتر → هاتف)
1. الويب: `POST /api/devices {action:"send-file", deviceId:<وكيل حي>, direction:"out", srcDeviceId, srcPath, fileName}` → إن كان الوكيل متصلًا: **لا نسخة محلية** — تُنشأ مهمة `queued` بـ `agent:true` ويُبث `tx:offer` للهاتف. إن لم يكن متصلًا: النسخ المحلية القديمة كما هي (توافق كامل).
2. الهاتف: إشعار نظام (قبول يفتح التطبيق) أو بطاقة داخلية → `tx:accept` → يبدأ التنزيل: `GET /api/preview?device=<srcDevice>&path=<srcVPath>&download=1` + `Range: bytes=<offset>-` → **206** دائمًا مع offset>0 (إصلاح G-8).
3. الجزئي يُكتب في ملف `.nexuspart` محلي يبقى بعد قتل التطبيق → إعادة الفتح = قراءة حجمه = استئناف من نفس الإزاحة.
4. التقدّم: `tx:progress {id, transferred}` (مُخفّف) → الويب يرى حيًّا. الاكتمال: `tx:state {id, state:"done"}` → المهمة done.
5. النشر المحلي: بعد الاكتمال يُنقل الملف إلى **Download/NexusLink** (MediaStore على Android 10+، مسار مباشر قبله) + إشعار نظام «اكتمل استلام الملف».

### 8.4 القرارات المؤتمتة والإعدادات
- **قبول تلقائي من موثوق**: إعداد في الهاتف (افتراضي: مفعّل) — `tx:offer` يبدأ التنزيل فورًا.
- **نسخ تلقائي للنصوص/الروابط**: `clip:new` (نص) و`hand:new` (رابط) من 3007 → حافظة الهاتف مباشرة (عند تشغيل الواجهة) + إشعار عند غيابها.
- **الصور التلقائية**: WorkManager كل 15 دقيقة يرصد DCIM/Pictures (نفس علامة `nexus.tx.photoSyncMarker` في SharedPreferences) — الرفع عبر محرك النقل عند الاتصال، والعلامة تتقدم بعد صفّ الصور في الطابور فقط (لا فقد أبدًا).
- **سجل النقل**: SQLite (drift v2 جدول `TransferHistory`) — طابور + تاريخ مكتمل/فاشل/ملغى قابل للاستئناف، معرّف المهمة المحلي = `taskId` السيرفر للرفع.

### 8.5 فجوات أُصلحت في هذه المرحلة
| # | الفجوة | الحالة | ما نُفّذ |
|---|--------|--------|----------|
| G-8 | `preview` تجاهل Range مع `download=1` | ✅ مُصلحة | يلبّي 206/416 دائمًا عند وجود Range |
| G-9 | الوكيل الحقيقي بلا جذر ملفات | ✅ مُصلحة | `ensureDeviceRoot` → `agents/<id>/` (مع Downloads) وربطه بـ pair/الرفع |
| G-10 | لا قناة نقل حقيقية للوكيل | ✅ مُصلحة | أحداث tx:* على 3006 + `/api/fs/upload` + send-file يوجّه للوكيل الحي |
| G-11 | إيقاف/إلغاء الويب لا يصل الهاتف | ✅ مُصلحة | `POST /api/transfer` يبث tx:pause/resume/cancel، وPUT الرفع يُرفض 409 paused |

## 9. طبقة أمان الهاتف — FA-10 (المصدر: e2e-crypto.ts + use-sec-bridge.ts + security-bridge.ts)

### 9.1 مطابقة التشفير حرفيًا (Kotlin/lazysodium ⇄ Web/@noble)
- **الهوية**: X25519 keypair يُولَّد مرة ويُحفظ b64 في SharedPreferences `nexus_sec` (identity/eph). توليد: 32 بايت عشوائية + `crypto_scalarmult_base`.
- **الاشتقاق (لكل عصر epoch)**: `shared = X25519(myEph.priv, peerEph.pub)` ثم HKDF-SHA256 — `salt = "nexuslink-v1|" + join("|", sort([myDeviceId, peerDeviceId]))`، `info = "nexuslink-e2e-session"`، L=32. مفتاح AES-256-GCM للعصر.
- **مصافحة العصور**: على `kex:peer {deviceId, name, pub, eph, epoch?}`: إن كان `pEpoch > myEpoch && pEpoch != awaitingEpoch` → الطرف الآخر بدأ تدويرًا: وُلِّد eph جديد، أُرسل `kex:update {eph, epoch: pEpoch}` واشتُق فورًا. وإلا: `epoch = pEpoch > 0 ? pEpoch : 1` (اتصال أول = عصر 1 دائمًا).
- **ختم إطار**: `iv` عشوائي 12B، `AAD = "${from}|${to}|${kind}|e${epoch}"`، `seq` تصاعدي لكل عصر، بث `sec:frame {to, from, kind, e, iv, ct, seq}`. الفتح يرفض `seq <= lastSeq[epoch]` (REPLAY_DETECTED). عصر غير معروف → إعادة `sec:announce` (resync، ≤ مرة كل 5 ثوانٍ).
- **SAS**: `sha256("${x}|${hex(pubX)}|${y}|${hex(pubY)}")` بالمعرّفين مرتّبين (المفاتيح تتبع الترتيب) → 4 إيموجي من قائمة الويب نفسها (b % 32) + 6 hex من البايتات 8..13 (b % 16) مجمّعة 3-3. **البصمة الطويلة**: sha256(pub)[0..7] hex مقصوصtoUpperCase مجمّعة 4-4.
- **PIN**: PBKDF2-SHA256 بـ 150,000 دورة و256 بت وملح 16B (نفس معاملات الويب) — عبر javax.crypto على الهاتف، مطابقة إخراج الويب {salt, hash, iters}.

### 9.2 عميل 3009 داخل الخدمة (يعمل بلا واجهة)
- سوكِت رابع socket.io (بوابة 81 عبر `XTransformPort=3009` أو مباشر) — `sec:announce {role:"phone", deviceId, name, pub, eph}` عند كل اتصال، مع `sec:lock-state` فورًا بعده.
- معالجات مشفرة: `cmd` (op: `ring` → أين هاتفي + ack، `lock-phone` → وضع الفقدان + ack)، `clip` → بث للواجهة + إشعار عند غيابها، `file-*` → سطر تدقيق (نقل الملفات المشفرة مسار ويب/مستقبلات).
- أوامر بث غير مشفرة: `sec:lost-cmd` و`sec:wipe-cmd` و`sec:lock-cmd` (احتياطي) — تُنفَّذ في الخدمة مباشرة.
- تدقيق: `sec:audit {actor: <اسم الجهاز>, action, detail, severity}` عند kex/قفل/فتح/مسح.
- السياسة الصارمة: جهاز غير موثوق → `sec:pending-trust` ولا اشتقاق ولا إطارات؛ محظور → `sec:rejected` + قطع.

### 9.3 وضع الفقدان والمسح الآمن والقفل
- **وضع الفقدان** (`dev:lost {on, message}` على 3006 أو `sec:lost-cmd`/`cmd lock-phone` على 3009): قفل التطبيق + `LostModeActivity` ملء الشاشة (showWhenLocked + turnScreenOn + keepScreenOn، رسالة حمراء + اسم الجهاز) + موقع من LocationManager (lastKnown مع تحديث وحيد احتياطي 10 ثوانٍ، صلاحيات وقت الاستخدام) → `sec:lock-state` و`lost-state` مشفر. إلغاء عبر `dev:lost-off`/`sec:lock-state {lost:false}`. بدء نشاط من الخدمة على Android 10+ محظور عمومًا — الاعتماد على إذن النظام SYSTEM_ALERT_WINDOW (يُطلب في لوحة الأذونات) وإشعار full-screen-intent احتياطيًا.
- **المسح الآمن**: ملفات `Download/NexusLink` (MediaStore، ملكية التطبيق) → فتح "rw" وكتابة فوق بـ N تمريرات (عشوائي/أصفار/0xFF) + flush/fsync ثم حذف من MediaStore — من زر داخل التطبيق أو `sec:wipe-cmd`/`dev:wipe` مع تقدم حي للواجهة و`sec:wipe-state` للويب.
- **قفل التطبيق**: PIN (PBKDF2 أعلاه) + بصمة/وجه (local_auth/BiometricPrompt — يتطلب FlutterFragmentActivity) + قفل تلقائي عند الخلفية بعد `autoLockSec` (0 = فوري) — بوابة LockScreen قبل Shell.

### 9.4 الإقلاع والبطارية
- `BootReceiver` (BOOT_COMPLETED/QUICKBOOT_POWERON): يقرأ آخر اتصال محفوظ من SharedPreferences `nexus_agent` (تُكتب في كل onStartCommand) ومفتاح autoStart → `startForegroundService`. `KeepAliveWorker` (WorkManager كل 15 دقيقة) يُعيد الخدمة إن قتلها النظام.
- **الخمول**: عندما الشاشة مطفأة والواجهة ميتة → المنارة 5ث→60ث وتقرير الحالة 30ث→120ث تلقائيًا (isInteractive)؛ بلا WakeLockات في الخمول (سوى مراقبة الأطفال النشطة)؛ socket.io pingInterval 25ث خفيف. بلا استشعارات/بث في الخمول أصلًا.

### 9.5 التوقيع والCI
- `android/key.properties` (مُتجاهَل git) + `app/nexuslink-release.jks` (مُتجاهَل) — signingConfig release عند وجوده وإلا debug (جري سريع).
- CI: وظيفة android في release.yml تبني `flutter build apk --release` + appbundle داخل nexuslink_mobile، تفكّ `secrets.ANDROID_KEYSTORE_BASE64` → keystore وتكتب key.properties عند توفرها، وترفع الأثرية.

---

*مصادر الاستخراج: mini-services/comms-service/index.ts · mini-services/remote-service/index.ts · src/lib/nexus/{types,devices,transfer-engine,fs-server,e2e-crypto,security-bridge,guard-bridge,media-bridge,productivity-bridge}.ts · src/app/api/**/route.ts · prisma/schema.prisma · Caddyfile · فحص حي بالمنافذ.*

## 10. واجهات سطح المكتب الأصلية (FA-desktop-native — مصدر: desktop-bridge.tsx + procman.rs)

نقاط سيرفرية يستهلكها تطبيق سطح المكتب (Tauri) — كلها إضافية ولا تغيّر أي مسار قائم:

| الواجهة | الطرف | العقد الحرفي |
|---|---|---|
| `GET /api/desktop/shortcuts` | Rust يستطلعها (كل ~10ث عبر status) | `{ok, shortcuts: {sendClipboard, toggleWindow}}` — الافتراضي: `Ctrl+Shift+N` / `Ctrl+Shift+D` |
| `PUT /api/desktop/shortcuts` | جسر الواجهة (desktop-bridge) يدفع المخزن المشترك | body `{shortcuts: Record<action,combo>}` — يُدمج فوق القائم ويُخزن في `data/desktop-ui.json` |
| `GET /api/desktop/status` | Rust يستطلعها كل ~10ث | حقل `desktop` الإضافي: `{agentId, shortcuts, transfers[≤5 done-in], notifs[≤8 new]}` |
| `POST /api/prod/clipboard` | Rust (Ctrl+Shift+N + nexus://send) + جسر الواجهة (داخل التركيز) | `{deviceId:"pc-office", deviceName, kind:"text", content, mode:"auto"}` → `prodEmit("clip:new")` للهاتف فورًا |
| `POST /api/devices` (send-file) | Rust (سحب وإفلات النافذة) | ملف مُنسوخ إلى `pc-fs/Inbox/` ثم `{action:"send-file", deviceId:<agentId>, direction:"out", srcDeviceId:"pc-office", srcPath:"/Inbox/<name>", fileName}` → `tx:offer` للوكيل الحقيقي |

**تعاقد التركيز للاختصارات**: الاختصارات العالمية مسجلة **فقط عندما نافذة الواجهة غير مركّزة** — داخل التركيز تعمل combos الواجهة الحالية من المخزن نفسه (Ctrl+Shift+D = المظهر داخل النافذة، إظهار/إخفاء خارجها). المخزن واحد: `nexus-shortcuts` (localStorage) يُدفع للسيرفر ويستطلعه Rust.

**إشعارات النظام**: مصدرها `desktop.transfers` (اتجاه in منتهية → «وصل ملف» بأزرار حفظ-في/فتح-المجلد) و`desktop.notifs` (جديدة → أزرار رد/فتح). التنقية بـ id (زرع أول جلب بلا إشعارات). لا إشعار نظام بينما النافذة مركّزة (نسخة داخل التطبيق تعرض حينها).

**deep-link**: `nexus://open` (فتح/تركيز) · `nexus://comms|transfers|files|devices|settings` (تنقل) · `nexus://send?text=…` (إرسال نص للحافظة الموحدة). النمط مسجل عبر `plugins.deep-link.schemes` + `register_all()` وقت التشغيل (ويندوز).

**Drag & Drop**: إفلات على النافذة الرئيسية → نسخ إلى `pc-fs/Inbox/` (باسم فريد) → send-file أعلاه. **الإشعارات أصلية**: WinRT Toast بأزرار على ويندوز (AUMID = identifier)؛ ماك/لينكس عبر إضافة الإشعارات الرسمية بلا أزرار (حد منصة موثق).

## 11. الحافظة الموحدة الحية على مستوى النظام (FA-clipboard-sync — مصدر: clipboard.rs + AgentForegroundService.kt + NexusAccessibilityService.kt + desktop-bridge.tsx)

«انسخ في أي طرف → الصق في الآخر فورًا» — حافظة نظام حقيقية في الاتجاهين، بلا حلقات.

### 11.أ الكمبيوتر → الهاتف (مراقب Rust خلفي — `clipboard.rs`)
- استقصاء كل 1 ثانية عبر arboard بالأولوية: **ملفات** (`get().file_list()`: CF_HDROP/NSPasteboard/text-uri-list) ← **نص** (`get().text()`) ← **صورة** (`get().image()` RGBA).
- **نص**: في الوضع `auto` وحده وبشرط `len ≤ maxAutoBytes` → `POST /api/prod/clipboard {deviceId:"pc-office", kind:"text", content, mode:"auto"}` → `prodEmit("clip:new")` → الهاتف يكتب حافظته (§11.ب).
- **صورة**: ترميز PNG (image 0.25) → ملف في `pc-fs/Inbox/clipboard-<ts>.png` → `POST /api/devices send-file` (عقد §10 — tx:offer للوكيل الحقيقي) + عنصر سجل `kind:"image"` بـ dataURL إن سَع (≤300KB).
- **ملفات (Ctrl+C على ملف)**: حتى 10 ملفات/حدث → نسخ إلى `pc-fs/Inbox/` → send-file (اقتراح نقل) + عنصر سجل `kind:"file"`.
- **الوضع اليدوي**: كل التدفقات التلقائية متوقفة — الإرسال صراحة فقط (Ctrl+Shift+N / زر «إرسال الحافظة الحالية» عبر أمر `clip_send_now`، بلا حد الحجم).

### 11.ب استقبال الهاتف (Kotlin `AgentForegroundService` — يعمل والواجهة ميتة)
- على `clip:new` بـ `deviceId ≠ هويتي` و`kind="text"`: `ClipboardManager.setPrimaryClip()` **فورًا من الخدمة** (الكتابة مسموحة دائمًا على Android 10+ — القيد على القراءة فقط) + `pushDataEvent("clip")` للواجهة + إشعار «جاهز للّصق» إن كانت الواجهة ميتة.
- الصور/الملفات تصل عبر مسار النقل الحقيقي (tx:offer قائم) — لا تُكتب في الحافظة.

### 11.ج الهاتف → الكمبيوتر (حرس الحلقة في الطرفين)
- **مراقب الإتاحة** (`NexusAccessibilityService` — التطبيق كله يحصل على إذن القراءة بلا تركيز طالما خدمة إتاحة فعّالة مفعّلة — مفعّل مسبقًا بموافقة المستخدم لجلسات التحكم FA-7): استقصاء 1.5s (نفس نمط مراقبة شاشة التحكم) → نص غيّر → `clip:push {deviceId, kind:"text", mode:"auto"}` عبر socket 3007 لخدمة الوكيل.
- بدون خدمة الإتاحة: مراقبة مركّزة قائمة في شاشة التحكم (استقصاء 1.5s عبر Flutter) — قيد موثق منذ FA-9.
- **حرس الحلقة (تعاقدي)**: كل `clip:new` يحمل `deviceId` حرفيًا؛ الهاتف يتجاهل صداه (`deviceId == هويتي`)؛ الحرس الثلاثي: `clipLastFromPc` / `clipLastSentToPc` (Kotlin) + `markExternal` (Flutter) + بصمات `APPLIED_*` (Rust) — النص الذي وضعه الكمبيوتر لا يعود، والعكس.
- استقبال الكمبيوتر: الويبفيو (حتى والنافذة مخفية في الـ Tray) يستقبل `clip:new` غريبًا + وضع auto → `clip_apply` (أمر Tauri) → `arboard set_text/set_image` — تعمل Ctrl+V في أي تطبيق.

### 11.د الإعدادات والسجل (مخازن قائمة — بلا مخزن جديد)
- **الوضع** (تلقائي/يدوي): `db.prodState.clipMode` — زر التبديل القائم في واجهة الإنتاجية (PATCH /api/prod/state) هو المصدر.
- **حد الإرسال التلقائي**: `data/desktop-ui.json → clip.maxAutoBytes` (1KB..20MB، افتراضي 1MB) عبر `PUT /api/desktop/shortcuts {clip:{...}}`.
- يقرأهما Rust من `status.desktop.clip = {mode (من prodState), maxAutoBytes (من المخزن)}` — فشلها لا يُسقط الحالة.
- **السجل**: `GET /api/prod/clipboard` = آخر **50** عنصرًا (`kind: text|image|file` + `mode` + `deviceId`) — عرضه في واجهة الإنتاجية «سجل الحافظة — آخر 50».

## 12. أوامر النظام والطاقة الحقيقية (FA-power — مصدر: power.rs + remote-bridge.ts + wol_service.dart + desktop-bridge.tsx)

«أوامر النظام حقيقية لا محاكاة: إيقاف/إعادة تشغيل/إسبات/قفل/خروج من الهاتف، إيقاظ الكمبيوتر النائم من الهاتف، وقفل تلقائي عند ابتعاد الهاتف» — البنية القائمة (§4.2 و§4.4) تُعاد استخدامها **حرفيًا** بلا مساس، والجديد هو ربطها بالطبقة الأصلية (Tauri) وبالهاتف دون اتصال.

### 12.أ أوامر النظام عبر WebSocket — التنفيذ الأصلي (Rust `power.rs`)
- **المسار**: الهاتف → `rc:power {action}` على 3004 → الجسر يرحّل broadcast (سلوك §4.2 كما هو) → **الويبفيو دائمًا حي (حتى مع النافذة مخفية في الـ Tray) يستقبل `rc:power` ويستدعي أمر Tauri `power_request {action, source:"phone"}`** → `power.rs` ينفّذ على النظام فعليًا.
- **الأوامر الفورية** (غير مدمرة): `lock` · `sleep` — تنفيذ مباشر.
- **الأوامر المدمرة** (تأكيد أمان 10 ثوانٍ **قابل للإلغاء من الشريط**): `shutdown` · `restart` · `hibernate` · `logout` — عدّاد ظاهر في قائمة الـ Tray (`سيتم {الأمر} خلال Nث…` + زر `إلغاء {الأمر}`) وتُبث الحالة كل ثانية عبر حدث Tauri داخلي `desktop://power {phase:"pending", action, secondsLeft}` → الجسر الواجهي يحوّلها `desktop:state {power:"shutting-down"}` للهواتف.
- **لكل منصة الطريقة الرسمية** (+ بديل احتياطي موثق):
  | الأمر | Windows | macOS | Linux |
  |---|---|---|---|
  | shutdown | `shutdown /s /t 0` | osascript System Events `shut down` | `systemctl poweroff` |
  | restart | `shutdown /r /t 0` | osascript `restart` | `systemctl reboot` |
  | hibernate | `shutdown /h` ← `rundll32 powrprof.dll,SetSuspendState 0,1,0` | `pmset sleepnow` (Safe Sleep) | `systemctl hibernate` ← `suspend` |
  | sleep | `rundll32 powrprof.dll,SetSuspendState 0,1,0` | `pmset sleepnow` | `systemctl suspend` |
  | lock | `rundll32 user32.dll,LockWorkStation` | `CGSession -suspend` ← `pmset displaysleepnow` | `loginctl lock-session` ← `gnome-screensaver-command -l` |
  | logout | `shutdown /l` | osascript `log out` (قد يعرض تأكيد النظام — حد موثق) | `loginctl terminate-session self` ← `gnome-session-quit --logout --no-prompt` |
- **`unlock` يُرفض أمنيًا على الطبقة الحقيقية** (`power_request` يرد خطأ «فتح القفل عن بُعد غير مسموح») — المحاكاة الويبية ل§4.2 تبقى مسموحة كما هي.
- إبلاغ الهواتف: بعد التنفيذ يبث الجسر الواجهي `desktop:state {power}` (locked/sleeping/shutting-down) — بوابة الطاقة §4.2 تعمل كالمعتاد.

### 12.ب إعلان MAC والتنبيه دون اتصال (Wake-on-LAN)
- **إعلان MAC للأجهزة الموثوقة**: عند اتصال سوكِت 3004 في الجسر الواجهي → `system_mac` (Tauri) يكشف MAC المحوّل النشط فعليًا (Linux: واجهة المسار الافتراضي من `/proc/net/route` ثم `/sys/class/net` · macOS: `ifconfig ether` · Windows: `Get-NetAdapter Status=Up` ← `getmac`) → `desktop:register {name, mac}` — فيصل لكل عميل لاحق عبر `rc:hello {desktop:{name, mac}}` (§4.2) ويُخزّن في الهاتف (SharedPreferences `nexus.desktopMac`).
- **الإيقاظ عبر القناة الحية**: `rc:wol {mac}` → الجسر يتحقق ويصوغ الحزمة **ويرسلها فعليًا** UDP broadcast منفذ 9 (102 بايت = 6×FF + MAC×16) ويبث `desktop:wake {source:"wol", mac, packet}` + يسجل نتيجة الإرسال الحقيقية (`NEXUS_WOL_BROADCAST` env يبدّل الوجهات — للاختبار فقط).
- **الإيقاظ دون اتصال (المسار التعاقدي)**: السيرفر غير قابل للوصول = الكمبيوتر نائم → Flutter يرسل الحزمة **مباشرة** عبر `RawDatagramSocket` (WolService: 255.255.255.255:9 + broadcast الشبكة الفرعية للخادم المحفوظ ×3 محاولات) — بلا أي اتصال مسبق.
- **شاشة الإيقاظ** (`wake_banner.dart`): تظهر بارزة أعلى التطبيق عندما (القناة الخلفية/الاتصال غير متاح) **و** MAC محفوظ — «الكمبيوتر نائم — إيقاظ؟» بضغطة واحدة → إرسال → انتظار 6ث → فحص صحة → اتصال كامل idempotent (`reconnect`) — **اختبار النجاح: تسبت الكمبيوتر → من الهاتف تضغط «إيقاظ» → يستيقظ ويتصل تلقائيًا** (الاستيقاظ الفيزيائي ميداني — يحتاج BIOS/UEFI + دعم NIC؛ إرسال الحزمة وبنيتها ومسار إعادة الاتصال مثبتة تعاقديًا).

### 12.ج القفل التلقائي عند ابتعاد الهاتف (منارة القرب §4.4 كما هي — التنفيذ الحقيقي)
- **لا تغيير على العقد القائم**: الهاتف يرسل `prox:beacon {rssi, device}` كل 5ث على 3006 (§7)، ومحرك القرب يدير العتبة/مهلة السماح ويبث `pc:lock {reason: "manual"|"weak-signal"|"no-beacon", rssi?, at}` و`pc:unlock {reason}` (§4.4). فقدان المنارة = انقطاع الهاتف عن الشبكة (ابتعاد فعلي) → `no-beacon` بعد مهلة السماح.
- **التنفيذ الأصلي**: الويبفيو يستقبل `pc:lock` → `power_request {action:"lock", source:"auto-lock"}` → قفل فوري للجلسة + إشعار نظام «قفل تلقائي: ابتعد هاتفك عن النطاق».
- **بوابة الإعداد**: `data/desktop-ui.json → security.autoLock` (افتراضي `true`) عبر `PUT /api/desktop/shortcuts {security:{autoLock}}` — مفتاح «القفل التلقائي عند ابتعاد الهاتف» في إعدادات الأمان (نافذة سطح المكتب فقط) — يقرأها Rust من `status.desktop.security` ويرفض `auto-lock` حين تُعطّل (القفل اليدوي من الهاتف غير متأثر).
- **حد صادق**: RSSI البلوتوث الحقيقي يتطلب محوّل BT على الكمبيوتر + صلاحيات موقع على أندرويد 12+ — مسار `weak-signal` جاهز كاملًا في المحرك (عتبة thresholdRssi)، والافتراضي العملي اليوم هو فقدان المنارة عبر الشبكة (ابتعاد = انقطاع). القيود موثقة هنا لا في التسويق.

### 12.د مؤشرات الشريط (Tray) والواجهات
- قائمة الـ Tray تضيف: `الطاقة: تعمل|مقفل|سكون|جارٍ الإيقاف|…` (عرض) · `الاتصالات النشطة: N` (عدّاد الأجهزة connected من سجل الأجهزة) · `لا إيقاف مجدول / إلغاء {الأمر}` (زر الإلغاء أثناء العدّاد فقط) — التحديث من استطلاع `status.desktop` كل ~10ث + من خيط العدّاد كل ثانية.
- `status.desktop` يضيف (إضافي لا يكسر): `security: {autoLock}` · `connections: <number>` · `power: {state, mac, name}` (من `remoteBridgeStatus`).

### 12.هـ فجوات سيرفرية أُصلحت في هذه المرحلة
| # | الفجوة | ما نُفّذ |
|---|--------|----------|
| G-12 | `rc:power` لا يدعم `logout` | إضافة الأمر في الجسرين (مدمج Next + mini-service) بحالة `locked` + ترجمة عربية |
| G-13 | `rc:wol` كان يصوغ الحزمة ويكتب «أُرسلت» **بلا إرسال فعلي** | إرسال UDP broadcast حقيقي (dgram → :9) + سجل نتيجة الإرسال الصادق |
| G-14 | لا إعدادات أمان لسطح المكتب | `security.autoLock` في نفس المخزن desktop-ui.json + بطاقة إعدادات الأمان |

**تحقق E2E**: قسم جديد في scripts/desktop-e2e.mjs — تسجيل desktop:register بMAC حقيقي الشكل → rc:power logout يصل للكمبيوتر → rc:wol بعد تعيين الحالة sleeping → **التقاط الحزمة فعليًا على مستمع UDP :9 (102 بايت = 6×FF + MAC×16)** → رفض already-on → pc:lock بلا منارة بعد مهلة سماح → حقول status.desktop الجديدة.

---

## 13. التحكم الفعلي بالكمبيوتر: enigo وجلسة التحكم الموثوقة (FA-input — مصدر: input.rs + input_exec.rs + desktop-bridge.tsx + remote-bridge.ts + controller_service.dart)

**الاختبار الناجح التعاقدي**: تحرك مؤشر كمبيوترك من شاشة Touchpad بالهاتف + اكتب نصًا عربيًا من كيبورد الهاتف في مستند — **مثبت تنفيذيًا 28/28** (scripts/enigo-verify على Xvfb: حركة المؤشر تُثبت بـ XQueryPointer مستقلًا عن enigo، والعربية تُحقن حرفًا حرفًا عبر XTEST).

### 13.أ حقن الإدخال الأصلي (Rust `input_exec.rs` — نواة نقية بلا Tauri)
| الحدث | التنفيذ الأصلي |
|-------|----------------|
| `move {dx,dy,drag?}` | `move_mouse(dx,dy,Rel)` — قصّ دفاعي ±500؛ **السحب بحواف**: أول `drag:true` يضغط الزر الأيسر وأول حدث بلا drag يرفعه (`DRAG_DOWN: AtomicBool` — بلا تكرار ضغط/رفع) — يحوّل «نقر مطول + تحريك» في الهاتف إلى سحب حقيقي |
| `click {button,type?}` | Left/Right/Middle؛ `double` = نقرتان متتاليتان (40ms بينهما — عتبة النقر المزدوج للنظام تفسرهما) |
| `scroll {dy}` | عجلة عمودية — تدرّج 40 بكسل = نقرة واحدة، قصّ ±10 نقرات/حدث (موجب = لأسفل) |
| `pinch {scale}` | Ctrl + عجلة (تكبير/تصغير شائع): `n = ⌈|scale−1|×3⌉` مقصوص 1..6 |
| `key {ch\|special\|key, modifiers?}` | نص/حرف عبر `enigo.text()` يونيكوديًا — انظر 13.ب؛ special: enter/backspace/space/arrows/esc/tab/delete/home/end/pageup/pagedown؛ مسماة: f5/f11؛ modifiers اختيارية (ctrl/alt/shift) تُضغط قبل المفتاح وتُحل دائمًا حتى عند الفشل |
| `presenter {action}` | next→PageDown · prev→PageUp · **start→F5 · stop→Esc** (إضافة FA-input) · black→b (شاشة PowerPoint السوداء) · laser-*: عرض ويبي فقط — لا مقابل نظامي (موثق بصدق) |
| `media {action,value?}` | toggle/play/pause→MediaPlayPause · next/prev→MediaNext/PrevTrack · mute/unmute→VolumeMute · volume→مستوى مطلق 0..100 (انظر 13.د) |

### 13.ب كتابة نص عربي كامل — معالجة تخطيط الكيبورد (بند 1)
- **الضمان**: حقن يونيكودي **مستقل تمامًا عن التخطيط النشط** — لا حاجة لتبديل لغة الكمبيوتر ولا توقع أحرف:
  - **Windows**: `SendInput` مع `KEYEVENTF_UNICODE` — الحرف يمر كما هو مهما كان تخطيط النظام (عربي/إنجليزي/أي لوحة).
  - **macOS**: `CGEventKeyboardSetUnicodeString` — نفس الضمان.
  - **Linux/X11**: `Key::Unicode(c)` → keysym يونيكودي (0x1000000+codepoint) عبر XTEST مع إعادة ربط keycodes غير مستخدمة مؤقتًا (نمط xdotool) — يعمل مع أي تطبيق يستقبل إدخال X11 (يشمل XWayland). **Wayland الأصلي غير مسند** في enigo 0.2.1 (موثق) — البديل Wayland (libei) غير مفعّل.
- الهاتف يرسل حرفًا حرفًا (`rc:key {ch}` من onChanged — كل rune منفصل) والسلاسل الكاملة مسموحة (لصق متعدد الأحرف يمر كاملًا).
- الاعتماد: `enigo 0.2.1` بميزة `x11rb` الخالصة Rust على لينكس (**بلا libxdo C** — إعادة ربط المفاتيح مدمجة في الخلفية) — إضافة Cargo الوحيدة لهذه المرحلة؛ بناء لينكس في CI يحتاج `libxkbcommon-dev` (تبعية xkbcommon للاختبارات فقط في شجرة enigo).

### 13.ج جلسة التحكم الموثوقة — الأمان (بند 7)
- **دورة الحياة** (حدث جديد `rc:session` على 3004): الهاتف → `{action:"start", deviceId, name}` عند فتح شاشة التحكم، `{action:"hb"}` نبض **كل 2ث**، `{action:"stop"}` عند الإغلاق/القطع. الجسر يبث `rc:session {active:true, controller:{deviceId,name}, at}` أو `{active:false, reason:"phone-stop"|"desktop-stop"|"timeout"|"disconnected", at}`.
- **حاجز الثقة على الجسر (قبل التوجيه)**: `deviceId` يجب أن يكون في سجل الأجهزة بـ `trusted:true` (نفس منطق `dev:ctl-start` §4.8) — وإلا `rc:rejected {reason:"untrusted", ev:"rc:session"}` + سجل. جلسة واحدة فقط (`busy` لغيرها). تسجيل وحدة التحكم `rc:hello-controller {name, deviceId}` يوثق السوكِت فقط للهوية الموثوقة (بلا هوية = متحكم ويبي محاكي بلا جلسة).
- **تمييز المصدر على الإدخال**: الجسر يحقن `__src` في كل حدث rc:* مبثوث: `"desktop"` (سوكِت واجهة الكمبيوتر — صاحب الجهاز) / `"controller"` (هاتف موثوق) / `"unknown"` (حقل إضافي لا يكسر العملاء القائمين). **الطبقة الأصلية ترفض unknown ولا تنفذ controller إلا خلال جلسة نشطة**؛ desktop = واجهة الكمبيوتر نفسها (صاحب الجهاز — عرض ويب داخل التطبيق) تنفَّذ دائمًا عبر `source:"desktop-local"`.
- **watchdog مزدوج**: الجسر ينهي الجلسة بعد فقدان النبض 6ث (بث `timeout`)؛ وRust محليًا ينهيها بلا أي أحداث 15ث (حارس السلامة — يغطي انقطاع الويبفيو نفسه). انقطاع سوكِت الهاتف ينهيها فورًا (`disconnected`).
- **القطع الفوري من الطرفين**: زر «قطع فوري» في شريط الجلسة بالهاتف (`phone-stop`) + زر «إنهاء جلسة التحكم» في قائمة Tray الكمبيوتر (`desktop-stop` — يبث للهاتف عبر `rc:session stop` من الويبفيو) + لافتة حمراء داخل واجهة سطح المكتب بزر «إنهاء فوري». نهاية الجلسة تحرر زر السحب إن كان معلقًا (`reset_drag` — لا زر عالق على المستخدم).
- **الإشعار المرئي الدائم (بند 7)**: أثناء الجلسة — أيقونة Tray تتحول **بنفسجيًا** (tray-input.png) + عنصر قائمة «جلسة تحكم نشطة: <اسم>» + tooltip حي + لافتة بنفسجية داخل الواجهة + إشعار نظام عند البدء والانتهاء (timeout/disconnected). `status.desktop` يضيف `input: {active, deviceId, name, at}` (إضافي لا يكسر).

### 13.د ضبط الصوت المطلق — لكل منصة طريقها الصحيح
- **macOS**: `osascript -e "set volume output volume N"` — دقيق ومطلق.
- **Linux**: `pactl set-sink-volume @DEFAULT_SINK@ N%` (PulseAudio/PipeWire) ← `amixer -q set Master N%` (ALSA) ← نقرات مفاتيح الصوت (تقريبي — موثق).
- **Windows**: نقرات `VK_VOLUME_UP/DOWN` (كل نقرة 2%) مع **مرآة مستوى مُتبَّعة** (`VOL_MIRROR` تبدأ 50) — انزياح ممكن إن غيّر المستخدم الصوت فعليًا ويُصحح عند 0/100؛ ضبط مطلق حقيقي يتطلب COM `IAudioEndpointVolume` — تُرك لتقل الاعتمادات (موثق بصدق).
- المفوّض `set_volume_override` في `input_exec.rs` يُضبط من `input.rs` عند الإقلاع؛ نواة لينكس تفعل سلسلتها مباشرة.

### 13.هـ تدفق إذن Accessibility على macOS (بند 6)
- `input_permission` (Tauri): فحص `AXIsProcessTrustedWithOptions` بـ **FFI مباشر** (CoreFoundation + ApplicationServices — بلا crates جديدة؛ قاموس فارغ = فحص قراءة فقط). ويندوز/لينكس ترد `{granted:true}` دائمًا.
- عند بدء جلسة (أو فشل حقن `desktop://input-error`): الويبفيو يستدعي `input_permission` → بلا إذن → يفتح `input_open_permissions` (فتح `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`) + **شاشة إرشادية عربية** (غلاف داكن): خطوات التفعيل (إعدادات النظام ← الخصوصية والأمان ← Accessibility ← NexusLink) + زرّا «فتح إعدادات النظام» و«حسنًا».
- فشل `Enigo::new` في `input::start` يفشل مبكرًا برسالة عربية واضحة (مثال: بلا X11/بلا إذن) — لا جلسة وهمية.

### 13.و فجوات سيرفرية أُصلحت في هذه المرحلة
| # | الفجوة | ما نُفّذ |
|---|--------|----------|
| G-15 | أحداث rc:* تُبث بلا هوية مصدر — الكمبيوتر لا يستطيع تمييز هاتف موثوق من مجهول | حقن `__src` (desktop/controller/unknown) في الجسرين + توثيق وحدات التحكم بالهوية |
| G-16 | لا مفهوم جلسة تحكم للاتجاه هاتف→كمبيوتر (الجلسة القديمة §4.8 عكس الاتجاه) | `rc:session` كامل (start/hb/stop + busy + untrusted) + watchdog 6ث + انقطاع السوكِت ينهي |
| G-17 | presenter بلا بدء/إنهاء عرض | إجراءا `start`/`stop` (F5/Esc) في الجسرين + العقد |
| G-18 | `status.desktop` بلا حالة جلسة التحكم | `input: {active, deviceId, name, at}` من `remoteBridgeStatus` |

**تحقق E2E**: قسم [6h] في scripts/desktop-e2e.mjs — جلسة موثوقة (galaxy-s24 عبر hello-controller بالهوية) → بث rc:session active + status.desktop.input.active — رفض جهاز غير موثوق (untrusted) — حقن __src: controller للأموثوق وunknown للمجهول — عربي UTF-8 عبر rc:key — presenter start/stop يمران — heartbeat 6ث → بث timeout — إيقاف من سوكِت سطح مكتب مسجل → desktop-stop.

**قيود موثقة بصدق**: Wayland الأصلي غير مسند (XWayland يعمل) — ضبط الصوت المطلق على ويندوز بنقرات مُتبَّعة (انزياح ممكن) — المؤشر الليزري عرض ويبي فقط — التنفيذ الفيزيائي على Windows/macOS يثبت بـ CI 3/3 (الحاوية بلا GUI على تلك المنصات) بينما لينكس **مثبت تنفيذيًا 28/28 على Xvfb** (حركة مؤشر حقيقية بـ XQueryPointer + عربية حقيقية عبر XTEST).

---

## 14. دمج الملفات في نظام التشغيل (FA-files — مصدر: files_menu.rs + files_menu_core.rs + sync.rs + sync_core.rs + phone_media_server.dart + sync_service.dart + desktop-files.ts)

### 14.أ قائمة الزر الأيمن Windows — «إرسال عبر NexusLink» (بند 1)
- **تسجيل HKCU** (بلا صلاحيات مدير): `Software\Classes\*\shell\NexusLink` لكل الملفات + `Software\Classes\Directory\shell\NexusLink` للمجلدات — قيم: الافتراضي = «إرسال عبر NexusLink»، `Icon` = التنفيذي، المفتاح الفرعي `command` = `"<exe>" --send "%1"`.
- **مصدر الحقيقة للنص**: `files_menu_core::menu_spec()` — دالة نقية تُضمَّن حرفيًا في محرك التحقق (56/56 تشمل اقتباس المسافات والعربية).
- **الدورة**: قائمة السياق → مثيل ثانٍ بـ `--send <path>` → إضافة single-instance تمرر الأرجف للمثيل الأول (`queue_send_args`) → بعد جاهزية السيرفر (`flush_pending_sends` في monitor_tick) → تجهيز في `pc-fs/Inbox` + `POST /api/devices send-file` (نفس عقد §8.3 حرفيًا) → tx:offer للهاتف → إشعار أصلي + فتح النافذة. **المجلد** يُضغط zip مؤقتًا قبل التجهيز (crate zip، deflate).
- **إزالة التثبيت**: `installer-hooks.nsh` → `NSIS_HOOK_POSTUNINSTALL` يحذف المفتاحين (`DeleteRegKey HKCU`) — مسجّل في tauri.conf.json عبر `bundle.windows.nsis.installerHooks`. تعطيل الإعداد من `settings.context_menu` يزيلها فوريًا (`set_context_menu`).
- **حد موثق**: `%1` يمرر أول عنصر محدد فقط — تعدد التحديد الحقيقي يتطلب COM `DelegateExecute` (خارج النطاق).

### 14.ب macOS Services (بند 2)
- `src-tauri/Info.plist` يُدمج تلقائيًا مع الافتراضي (`bundle.macOS.infoPlist`): `NSServices` بـ `NSSendFileTypes [public.data, public.folder]` + `NSMessage sendViaNexusLink` — «إرسال عبر NexusLink» تظهر في قائمة Services (Finder على رأسها).
- التسليم: macOS يفتح التطبيق بالملفات → tao → `RunEvent::Opened { urls }` → إضافة deep-link تعيد توجيهها إلى `on_open_url` → `handle_deep_link` يتعرف على `file://` ويدفعها إلى طابور `--send` نفسه (مسار واحد لكلا النظامين).
- **حد موثق**: Share Extension كـ .appex يتطلب هدف Xcode مستقلًا — Services هي مسار المشاركة من Finder (نفس الإجراء من قائمة الزر الأيمن).

### 14.ج السحب الخارجي Drag-Out (بند 3)
- `tauri-plugin-drag 2.1.1` (Builder `drag`) — الواجهة تستدعي `plugin:drag|start_drag` عبر `__TAURI__.core` مباشرة (Channel + أيقونة base64 مضمّنة) — **بلا حزم npm جديدة**.
- files-view: جلب خلفي للمسارات الحقيقية لكل إدخالات المجلد (ذاكرة `realPaths`) → إيماءة mousedown+12px → `dragOutEntry` → OLE/NSFilePromise/XDND حسب المنصة.

### 14.د إظهار في Explorer/Finder (بند 4)
- **جديد**: `GET /api/fs/realpath?device=&path=` → `{ok, realPath}` (كل الجذور حقيقية على قرص الكمبيوتر: pc-fs/agents/…) — فشل = 404.
- أمر Tauri `files_reveal(path)`: Windows `explorer /select,<abs>` · macOS `open -R` · Linux `FileManager1.ShowItems` عبر dbus-send ← fallback `xdg-open` المجلد.
- الواجهة: عنصر قائمة السياق في متصفح الملفات + زر «إظهار» في شاشة النقل للمهام ذات `srcDeviceId`.

### 14.هـ بث فيديو الهاتف → مشغل الكمبيوتر (بند 5)
- **الهاتف**: `phone_media_server.dart` (dart:io خالص) — منفذ 3010 (بديل عشوائي عند الانشغال)، رمز 32 خانة لكل إقلاع، CORS مفتوح:
  - `GET /health?token=` · `GET /list?token=&dir=` (مجلدات + فيديو فقط) · `GET /stream?token=&path=` — **Range كامل**: 206 + `Content-Range bytes s-e/total` + `Accept-Ranges` + 416 خارج النطاق.
- **الإعلان**: Dart → MethodChannel `setMediaEndpoint(port, token)` → `AgentForegroundService` يضمّنها في `guard:hello-phone {media:{port,token}}` وأي تحديث لاحق عبر `guard:media`. **السيرفر** يلتقط `socket.handshake.address` (lanIp حقيقي) ويخزن في سجل الوكيل → `status.desktop.agentMedia {deviceId, lanIp, port, token, at}` — **انقطاع السوكِت يمحوها**.
- **الكمبيوتر**: `files_stream_open(url, fileName, size)` — تنزيل تقدّمي (Range) إلى `%TEMP%/NexusLink-stream/<id>-<اسم>` → **عند العتبة (2MB أو 1.5ث — `pump_stream` نقية)** يُفتح بالمشغّل الافتراضي عبر ربط الامتداد (ShellExecute/open/xdg-open — يعمل مع كل المشغلات لأنه ملف حقيقي) → استكمال حتى الاكتمال → `files_stream_cancel(id)` فوري → تنظيف المجلد عند الخروج (`cleanup_all` مع kill_all). سقف 4 بثوث متوازية.
- **حد موثق**: البث أثناء حياة التطبيق/الخدمة فقط؛ التقديم السريع للنهايات البعيدة يتوفر بعد وصول التنزيل إليها (ملف تقدّمي لا HTTP-Range-Proxy).

### 14.و مزامنة المجلدات — مراقبة أصلية فورية (بند 6)
- **الزوج**: مجلد حقيقي على الكمبيوتر ↔ `Download/NexusLink/Sync/<pairId>/` على الهاتف (مرآة السيرفر: `agents/<agent>/Sync/<pairId>/`).
- **الإدارة**: بطاقة «مزامنة المجلدات» في إعدادات نافذة سطح المكتب → اختيار مجلد أصلي (`__TAURI__.dialog`) → PUT `/api/desktop/shortcuts {sync:{pairs[]}}` (تنقية صارمة، حد 12) → Rust يقرأ من `status.desktop.sync` ويدير دورة حياة مراقبي **notify 8** (inotify/FSEvents/ReadDirectoryChangesW) بتوقيع تغيير (الأزواج أو الوكيل تغيّر = إعادة بناء).
- **صادر (كمبيوتر → هاتف)**: حدث محلي → تهادئة 700ms → `process_outgoing` (نقية: تخطي مخفي/مؤقت/أكبر من 200MB) → نسخ إلى `pc-fs/Outbox/<pair>/<rel>` → **send-file offer** بـ `srcPath=/Outbox/<pair>/<rel>` → الهاتف يهبطها بـ `publishDownload(subPath="Sync/<pair>")` → `Download/NexusLink/Sync/<pair>/<rel>`.
- **وارد (هاتف → كمبيوتر)**: `sync_service.dart` يراقب جذر Sync بـ `Directory.watch` → رفع مجزّأ عبر §8.2 إلى `/Sync/<rel-dir>` (taskId مستقر للاستئناف) → يهبط في `agents/<agent>/Sync/` → مراقب Rust ينسخه للمجلد المحلي وفق **LWW** (متطابق ±1.5ث → تخطٍ؛ المحلي أحدث → يخرج في الاتجاه الآخر).
- **حارس الصدى**: `EchoRegistry` (هاتف: نافذة 6ث بعد publishDownload، مطابقة حجم+زمن لمقاومة اختلاف مسارات FUSE) + `recent_out` (كمبيوتر) — لا حلقة رفع/تنزيل.
- **حدود موثقة**: الحذف لا ينتشر (كلا الاتجاهين) — المزامنة أثناء حياة التطبيق (الهاتف) — التعارض: الأحدث يفوز.

### 14.ز فجوات سيرفرية أُصلحت في هذه المرحلة
| # | الفجوة | ما نُفّذ |
|---|--------|----------|
| G-19 | **`/api/fs/upload` غير موجود في الشجرة رغم توثيقه في §8.2 واستخدامه بمحرك الهاتف** (ضاع في تنظيف مبكر) | أُعيد بناؤه حرفيًا: init حتمي الـ uploadId من taskId + PUT مع 409 drift/paused + complete بإعادة تسمية فريدة + pause/resume/abort + GET حالة — **مثبت: 2GB sparse مع قتل عند 40% → استئناف → sha256 مطابق (a7c744c13cc101ed) بسرعة 115-198MB/s** |
| G-20 | لا نقطة وسائط للهاتف الحقيقي (الجذور الافتراضية مرايا رفع فقط) | تسجيل media{port,token} + lanIp من handshake في guard-bridge + `status.desktop.agentMedia` + حدث `guard:media` للتحديث الديناميكي |
| G-21 | لا مسار فعلي لإدخالات الجذر (أساس «إظهار في المستكشف») | `realPathFor` + `/api/fs/realpath` |
| G-22 | المخزن المشترك بلا أزواج مزامنة | `readDesktopSync/writeDesktopSync` (نفس desktop-ui.json) + `status.desktop.sync` |

**تحقق E2E**: قسم ] في scripts/desktop-e2e.mjs — realpath موجود فعليًا + 404 لجهاز فاسد — تسجيل نقطة الوسائط عبر hello-phone media + تحديث guard:media + محوها عند الانقطاع — دورة عرض مزامنة كاملة (send-file /Outbox → tx:offer بـ srcVPath → accept/progress/state → مهمة done) — Range 206 على /api/preview — PUT/GET أزواج المزامنة مع تنقية الفاسد — توثيق §14. محرك تنفيذي إضافي: **scripts/files-verify (56/56)** — مواصفات Registry (اقتباس/عربية) — pump_stream ضد خادم Range محلي (403 لرمز فاسد، 206، اكتمال 2.5MB، فتح مرة واحدة عند العتبة، إلغاء فوري) — مزامنة حقيقية بمجلدات مؤقتة (صادر/وارد/LWW/صدى/استثناءات) — مراقب notify حقيقي.

**قيود موثقة بصدق**: تعدد تحديد قائمة السياق يمرر أول عنصر (%1) — Share Extension .appex يتطلب هدف Xcode (Services تغطي Finder) — البث أثناء حياة التطبيق — الحذف لا ينتشر — الضغط الفيزيائي لقائمة السياق/Services/Drag يثبت بـ CI 3/3 (بناء فعلي بالطبقات) بينما النواة مثبتة تنفيذيًا 56/56 محليًا.

---

## 15. طبقة الوسائط الأصلية (FA-media — مصدر: media.rs + media_core.rs + media-bridge.ts + remote-bridge.ts + media_service.dart + pc_screen_screen.dart + desktop-bridge.tsx)

«شاشة الكمبيوتر على الهاتف عبر WebRTC بجودة قابلة للضبط + لمس الشاشة المعروضة يتحكم بالكمبيوتر + كاميرا الهاتف وميكروفونها أجهزة افتراضية حقيقية على الكمبيوتر (Zoom/Meet/Camera)» — كل الاتجاهات أعلى القنوات القائمة (جسر 3005 §4.3 + جلسة التحكم §13) بلا مساس.

**تحقق تنفيذي 38/38 (scripts/media-verify — يضمّن media_core.rs/input_exec.rs حرفيًا)**: النوى (جودة/YUYV/تصغير/بوابة/دوايفور/SDP/ICE) + خريطة اللمس + **H264 ترميز→فك دورة كاملة (OpenH264)** + **Opus ترميز→فك (audiopus، نسبة RMS 0.99)** + **WebRTC loopback حقيقي (webrtc-rs 0.21): عرض/إجابة بمرشحات host مضمّنة، 20 إطار H264 و40 حزمة Opus استُقبلت عبر RTP فعلي**. والطبقة الأصلية (media.rs) تُبوّب بـ CI على المنصات الثلاث (الحاوية بلا GUI — نفس نمط §13/§14).

### 15.أ شاشة الكمبيوتر → الهاتف (بند 1 و2 و3 — kind="screen" — الكمبيوتر صاحب الوسائط)
- **الالتقاط**: `scap 0.0.8` على ويندوز/ماك (Windows.Graphics.Capture / ScreenCaptureKit — اختيار شاشة/نافذة عبر `get_all_targets()`، FrameType BGRAFrame) — وعلى لينكس `x11rb` مباشرة (GetImage على الجذر + RandR للشاشات بأصولها الدقيقة + اقتصاص النوافذ). **حد موثق**: scap على لينكس يعتمد PipeWire/portal وغير صالح للالتقاط المباشر؛ الأصول على ويندوز/ماك للشاشة الأساسية (0,0) وتعدد الشاشات الدقيق بFFI على ماك (CGDisplayBounds) وويندوز (GetSystemMetrics سطح المكتب المركب).
- **الترميز**: OpenH264 (مضمن C++ عبر `openh264 0.9`) — BGRA→YUV→H264 Annex-B، packetization-mode=1 + `profile-level-id=42e01f` (baseline) يطابق fmtp المعلن.
- **الجودة (بند 1)**: مستويات `low/medium/high/ultra` (مقياس 0.4/0.6/0.8/1.0 + bitrate 0.8/1.5/3/6 Mbps) وfps من قائمة بيضاء **15/24/30/45/60** (sanitize_fps — افتراضي 30). التغيير أثناء البث: `media_screen_set` يضبط الإعدادات وتُطبق عند إعادة البث (حد موثق — الخيط يعيد بناء المشفر عند إشارة rebuild).
- **الإشارات (على جسر 3005 — ترحيل شفاف قائم §4.3 لا يُمس)**:
  1. الهاتف يفتح شاشة «كمبيوترك» → `screen:req {action:"start", fps?, quality?}` (حدث جديد — الجسر ينقّي: fps ∈ القائمة، quality ∈ المستويات، وإلا رفض صامت).
  2. الويبفيو الدائم يستقبل → أمر Tauri `media_screen_start` → **webrtc-rs يبني PeerConnection (MediaEngine بH264 فقط)** + تراك إرسال → `create_offer` → `set_local_description` → **انتظار اكتمال الترشيح (غير ترشيحي: كل مرشحات host داخل SDP نفسها — بلا STUN/TURN، اتصال LAN مباشر)** → يعيد `{offer:{type,sdp}, w, h, fps, quality}`.
  3. الويبفيو يبث `rtc:offer {kind:"screen", sdp}` + `screen:state {on:true, w, h, fps, quality}` — **kind=screen يمر عبر مسار rtc:* الشفاف كما هو (بلا قائمة بيضاء على kind)**.
  4. الهاتف (flutter_webrtc): `setRemoteDescription(offer)` → `createAnswer` → `rtc:answer {kind:"screen", sdp}` + مرشحاته `rtc:ice {kind:"screen"}` (trickle).
  5. الويبفيو يرحّل الإجابة/المرشحات → `media_screen_answer` / `media_screen_ice` → **«أول إجابة فقط» بوابة KindGate (media_core — الحارس الثاني بعد الجسر §4.3)**.
- **الإيقاف**: `screen:stop` من الهاتف أو `media_screen_stop` أو فشل PeerConnection (Failed/Closed → تنظيف ذاتي + `screen:state {on:false}`) — كل المسارات توقف خيط الالتقاط وتغلق الاتصال.

### 15.ب اللمس على الشاشة المعروضة = تحكم حقيقي (البند 3 — فوق جلسة §13)
- **حدث جديد `rc:pointer {nx, ny, action}`** على 3004 (مضاف لا يكسر): nx/ny مُطبّعة 0..1 على إطار البث المعروض؛ action ∈ `move|down|up|click|dblclick|rclick` (قائمة بيضاء — الجسران يرفضان الفاسد صامتًا ويحقنان `__src` كأي حدث إدخال — بوابة الطاقة سارية §4.2).
- **التنفيذ الأصلي** (input_exec.rs — kind:"pointer"): `pointer_map(nx,ny,w,h,ox,oy)` → بكسل مطلق في **فضاء سطح المكتب المركّب** (الأصل + الأبعاد يضبطهما media.rs عند بدء البث عبر `set_pointer_space` — ترميز بيتي بلا قفل) → `enigo.move_mouse(x, y, Coordinate::Abs)` + ضغط/رفع/نقر حسب الإجراء. **خلال جلسة تحكم نشطة فقط** (بوابة §13 نفسها: __src=controller + جلسة موثوقة + القطع الفوري من الطرفين).
- **إيماءات الهاتف** (pc_screen_screen.dart): نقرة = click · نقر مزدوج = dblclick · ضغط مطول + تحريك = down→move→up (سحب) · إصبعان عمودي = rc:scroll · تفريق = rc:pinch · نقر بإصبعين/زر ثانوي = rclick · حقل نصي = rc:key حرفًا حرفًا (عربي كامل — مسار §13.ب يونيكوديًا).
- **الجلسة**: فتح الشاشة يبدأ rc:session (نبض 2ث) ويقفلها إغلاقه — نفس الدورة الموثوقة من §13 (إشعار دائم في الشريط + لافتة بنفسجية + قطع فوري من الطرفين).

### 15.ج كاميرا الهاتف → ويب كام حقيقية (البند 4 — kind="cam" كما هو §4.3)
- **المسار**: بطاقة «طبقة الوسائط» (إعدادات نافذة سطح المكتب) → `media_vcam_start {video, audio}` → كشف الدوايفور + إطلاق الحاقنات → الويبفيو يبث `cam:cmd {action:"cam-start"}` (+`mic-start` للصوت) → **الهاتف (خدمة الوسائط القائمة) يبث `rtc:offer {kind:"cam", sdp}` بفيديو+صوت معًا (getUserMedia audio:true — عقد §4.3 حرفيًا)** → الويبفيو يستقبل العرض → `media_answer {kind, sdp}` → webrtc-rs (MediaEngine: H264+Opus للكام، Opus فقط للميك) يجيب `rtc:answer {kind:"cam"}` — **«أول إجابة من دور pc تُقبل لكل kind وتُتجاهل ما بعدها» (§4.3 حرفيًا + KindGate محليًا)** — والصوت يعالج عبر onTrack.
- **الفك**: مسار الفيديو — `TrackRemote.poll()` → `H264Packet::depacketize` (Annex-B) → `openh264::Decoder` → YUV420 → **`yuv420_to_yuyv`** → قناة الحاقن. مسار الصوت — `OpusPacket::depacketize` → `audiopus::Decoder` (48k ستيريو i16) → قناة الصوت. PLI كل 2ث (طلب إطارات مفتاحية للمنضمّ الجديد).
- **الحقن الفعلي (لكل منصة طريقها — البند 4 حرفيًا)**:
  | المنصة | الكاميرا الافتراضية | الميكروفون الافتراضي |
  |---|---|---|
  | **Linux** | **v4l2loopback**: كشف من /sys/class/video4linux (اسم الدرايفور "v4l2 loopback") → فتح الجهاز → `VIDIOC_S_FMT` YUYV W×H (ioctl FFI مباشر — تحقق من موافقة السائق) → كتابة الإطارات خامًا. غيابها = إرشاد (apt v4l2loopback-dkms + modprobe card_label="NexusLink") | **pactl module-pipe-source** (source_name=NexusLinkMic، FIFO s16le 48k ستيريو على /tmp/nexuslink-mic.pcm — كتابة O_RDWR بلا انسداد) — يعمل مع PulseAudio/PipeWire-pulse |
  | **Windows** | **akvirtualcamera** (DirectShow/Media Foundation): كشف AkVCamManager في المسارات المعروفة → `devices` → `stream -f FPS DEVICE YUY2 W H` (البروتوكول متحقق من مصدره: يقرأ إطارات خام من stdin بحجم VideoFrame) — غيابه = إرشاد تنزيل + ذكر بديل OBS (Media Source ثم Start Virtual Camera) | **VB-CABLE** عبر cpal: كشف "CABLE Input" في أجهزة الإخراج → stream F32/I16 من مخزن حلقي — غيابه = إرشاد vb-audio.com/Cable |
  | **macOS** | **akvirtualcamera** (CMIO) — نفس المسار — **حد صادق موثق**: macOS الحديث يقيد إضافات الكاميرا غير الموقعة (Gatekeeper)؛ إن ظهرت الكاميرا بلا صورة فهذا قيد النظام، والحل العملي OBS | **BlackHole** عبر cpal (نفس نمط VB-CABLE) — غيابه = إرشاد existential.audio |
- **الأبعاد الديناميكية**: أول إطار مفكوك يحدد W×H (VCAM_DIMS) — الحاقن يعيد فتح الجهاز/تشغيل stream بالأبعاد الجديدة (إطارات الويب كام 1280×720 نمطيًا كما تطلب خدمة الهاتف).
- **الإيقاف**: `media_vcam_stop` يبث `cam:cmd cam-stop/mic-stop` ويجمع جلسات cam/mic.

### 15.د حالة الوسائط (الشريط والهاتف)
- `status.desktop.media {screen:{on,fps,quality}, vcam:{video,audio,driver}}` — من نفس المخزن desktop-ui.json عبر `PUT /api/desktop/shortcuts {media:{...}}` (نمط clip/security/sync حرفيًا — readDesktopMedia/writeDesktopMedia + تنقية fps/quality).
- Tray: عنصر «الوسائط: خاملة/بث الشاشة نشط/كاميرا الهاتف تعمل/شاشة + كاميرا» — يحدثه media.rs عند كل تغيّر (push_tray_media) + حدث Tauri داخلي `media://state`.
- الهاتف: بطاقة «شاشة الكمبيوتر» في شاشة الوسائط (حالة الطور) + شاشة العرض الكاملة بجودة قابلة للتبديل **حيًا** (G-37: `screen:set` → خلية LiveQoS مشتركة — خيط الالتقاط يقرأها عند كل إعادة بناء فيعيد بناء الالتقاط/المشفّر فقط ويبقي اتصال WebRTC والتراك حيّين — بلا stop→req؛ الجسر يذيع `screen:state` محدّثًا لكل العملاء. حدّ سابق موثق بصدق: تغيير الهدف target ما يزال يتطلب جلسة جديدة — أعاد بناء مصدر التقاط مختلف جوهريًا).

### 15.هـ فجوات سيرفرية أُصلحت في هذه المرحلة
| # | الفجوة | ما نُفّذ |
|---|--------|----------|
| G-23 | جسر 3005 بلا أحداث عرض الشاشة | `screen:req/screen:stop/screen:set/screen:state` — تنقية صارمة (fps قائمة بيضاء 15..60، quality، w/h ≤ 8192، name ≤ 80، error ≤ 200) + حقن from — مضافة لا تكسر العملاء القائمين — **G-37: screen:set صار تبديلًا حيًا (LiveQoS + rebuild بلا قطع اتصال) والجسر يذيع screen:state بعد النجاح** |
| G-24 | لا مؤشر مطلق في أحداث الإدخال | `rc:pointer` في RC_INPUT بالجسرين (مدمج + mini-service متطابقان) + `sanitizePointer` (0..1 مقرب 4 خانات + قائمة إجراءات) — الرفض الصامت للفاسد |
| G-25 | status.desktop بلا حالة الوسائط | readDesktopMedia/writeDesktopMedia + `status.desktop.media` + PUT media |

**تحقق E2E**: قسم جديد في scripts/desktop-e2e.mjs — screen:req صالح/فاسد (fps=60 يمر، 90 يُرفض) — rtc:offer kind=screen/answer/ICE ثنائي — cam:cmd cam-start — rtc:offer kind=cam — screen:state on/w/h — PUT media صالح/فاسد + status.desktop.media — rc:pointer صالح (__src=controller + مطبّع) وفاسد (رفض صامت) — توثيق §15.

**قيود موثقة بصدق**: البث أثناء حياة التطبيق (الهاتف) وحياة الطبقة الأصلية (الكمبيوتر) — تغيير الجودة أثناء البث يُطبق عند إعادة البث — توقيع akvirtualcamera على macOS الحديث قد يمنع ظهور الصورة (حد النظام — OBS بديل عملي) — تعدد تحديد شاشة ماك/ويندوز بأصل الشاشة الأساسية للنقر المطلق (الأصول الدقيقة لكل شاشة: لينكس RandR كامل، ماك CGDisplayBounds للرئيسية، ويندوز سطح المكتب المركب) — البناء الفيزيائي للطبقة يثبت بـ CI 3/3 بينما النواة مثبتة تنفيذيًا 38/38 (incl. loopback WebRTC حقيقي).

## 16. صلّب الإصدار — التقوية الأصلية (FA-harden — مصدر: harden_core.rs + lock.rs + idle.rs + audit.rs + updater.rs + diag.rs + desktop-hardening.ts + /api/desktop/{settings,audit})

### 16.أ قفل التطبيق (بند 1)
- **وسيلتا فتح**: PIN (4..32 محرفًا) و/أو بصمة النظام. قفل بلا أي وسيلة يُتجاهل بصدق (`lock_now` يعيد LOCKED=false ويطبع سببًا).
- **PIN — أسرار محلية حصرًا**: `PBKDF2-HMAC-SHA256` بعشرة آلاف جولة (تنفيذ يدوي في harden_core.rs — متحقق بمتجهات معيارية في scripts/hardening-verify: c=1/2/4096 كلاسيكية + RFC 7914 (كما scrypt) c=1 + متجه جولات الإنتاج 10_000 محسوب مستقلًا بـ Python hashlib). الملح 16 بايت من مصدر النظام (`/dev/urandom` أو `BCryptGenRandom`) — **الهاش والملح في config.json المحلي ولا يغادران الجهاز أبدًا**؛ المخزن المشترك يحمل مرآة `hasPin` للعرض فقط (يدفعها Rust عبر push_shared).
- **البصمة**: ويندوز `UserConsentVerifier` (Windows.Security.Credentials.UI — CheckAvailabilityAsync/RequestConsentVerificationAsync عبر windows 0.58) · ماك `LAContext` (objc2-local-authentication 0.3 — canEvaluatePolicy_error + evaluatePolicy_localizedReason_reply ببلوك `Fn(Bool, *mut NSError)` — تواقيع متحققة من مصدر الكرِيت) · **لينكس: غير مدعوم بصدق — PIN فقط**.
- **دورة القفل**: `lock_now(reason)` يعرض نافذة `lock.html` (ضمن frontendDist splash — نفس CSP، مقفولة الأبعاد وalways_on_top). فكّ الرمز: `lock_verify_pin` (مقارنة هاش بثابت الزمن عبر مقارنة hex) → إغلاق النافذة. فكّ البصمة: `lock_biometric` → Some(true/false)/None (غير متاح). كل محاولات فك فاشلة تُدقَّق warn.
- **أوامر الطبقة**: `lock_state/lock_set_pin/lock_clear_pin/lock_verify_pin/lock_biometric/lock_now_cmd` — lock_state يعيد {locked, hasPin, biometric, appLockEnabled, idleLockMin, platform}.
- **قفل الخمول**: من مراقب واحد مع بند 4 (idle.rs، دورة 15ث): `appLock.enabled && idleLockMin>0 && idle_secs ≥ idleLockMin*60` ⇒ قفل (reason=idle). عنصر Tray «قفل التطبيق» (reason=tray).
- **كشف الخمول لكل منصة**: ويندوز `GetLastInputInfo` (فرق ملفوف حول GetTickCount — صحيح حسابيًا) · ماك `CGEventSourceSecondsSinceLastEventType(0, -1)` · لينكس X11 `screensaver_query_info` (Wayland: بلا معيار موحد ⇒ None بصدق وتتعطل ميزتا الخمول بأمان).

### 16.ب المحدّث الموقّع (بند 2)
- **tauri-plugin-updater** مع `plugins.updater.endpoints = ["https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json"]` و`pubkey` (minisign/Ed25519 — base64 في tauri.conf.json) و`bundle.createUpdaterArtifacts = true`.
- **مفاتيح التوقيع**: يولدها `tauri signer generate`؛ الخاص في سر CI `TAURI_SIGNING_PRIVATE_KEY` (وكلمة المرور الفارغة في `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — **لا يُلتزم الخاص إطلاقًا**؛ العام موثق في tauri.conf.json. CI desktop.yml ينتج أصولًا موقعة تلقائيًا مع كل إصدار جديد.
- **الإصدار مقفول 1.0.0** (المطلوب الصارم): latest.json على Release v1.0.0 يعلن version=1.0.0 بتواقيع الأصول الثلاثة الموجودة — الفحص يعيد «أنت على الأحدث» فلا حلقة ترقية/تخفيض. عند صدور إصدار مستقبلي يبني CI latest.json موقعة جديدة تلقائيًا.
- **فحص الإقلاع**: updater.rs::startup_check — ينتظر جاهزية السيرفر المضمّن (حتى 90ث)، يقرأ `updater.autoCheck` من المخزن المشترك (افتراضي مفعّل؛ تعطيله = تخطٍ بلا اتصال خارجي)، ثم فحص واحد. نتيجة «يتوفر تحديث» ⇒ حدث `desktop://update` + إشعار نظام + تدقيق warn. **الفحص هو الاتصال الخارجي الوحيد للتطبيق** (سجل GitHub API 10 دقائق كاش لسجل الإصدارات).
- **أوامر**: `updater_state` (إصدار + autoCheck + endpoint + history) · `updater_check_now` (فحص يدوي + تدقيق) · `updater_install` (تنزيل-تثبيت موقّع — لن يُستدعى عمليًا طالما 1.0.0 مقفول؛ المسار مكتمل لأول إصدار مستقبلي).

### 16.ج سجل التدقيق الأصلي (بند 3)
- **جدول واحد مشترك** `db.AuditEvent` (نفس SQLite) — أفعال الطبقة الأصلية **ببادئة `native-*` حصرية لنا**: native-transfer/clipboard/power/input/screen/vcam/files/sync/lock/updater/diag. مسارات السيرفر تكتب مفرداتها القائمة (transfer/clipboard/settings/screen) عبر `writeServerAudit` — و`GET /api/desktop/audit` يرجع الاثنين (مرشح category/severity، take ≤ 500).
- **الكتابة من Rust**: طابور fire-and-forget (audit.rs) — `audit(action, severity, detail)` لا يحجب المتصل أبدًا ولا يُسقط العملية الأصلية؛ دفعة كل 1.5ث عبر `POST /api/desktop/audit`؛ امتلأ الطابور (سيرفر مطفأ) ⇒ إسقاط الأقدم بلا ضجيج (سعة 200). القائمة البيضاء/بتر التفاصيل 400/الطابور في harden_core (مُختبر تنفيذيًا).
- **واجهة المراجعة**: بطاقة «سجل التدقيق الأصلي» في الإعدادات (ظاهرة للويب والتطبيق — نفس البيانات): تصفية فئة/خطورة + قائمة آخر 50 + تحديث + مسح (DELETE يحذف native-* فقط — تدقيق أمان الهاتف FA-10 لا يُمس).
- **تدقيق مسارات السيرفر**: نقل من الويب/السحب (`POST /api/devices` action=transfer) + حافظة prod (`POST /api/prod/clipboard` action=clipboard) — فشل التدقيق محمي ولا يُسقط المسار الأصلي.

### 16.د تحسين الخمول (بند 4)
- مصدر حقيقة واحد: idle.rs (دورة 15ث، استدعاء نظام واحد/دورة) + القرار الخالص `harden_core::idle_decision(idle_secs, opt_minutes, lock_minutes, enabled) → (idle_on, lock_on)` — مُختبر بمتجهات صريحة (Wayland/عتبات/تعطيلات).
- دخول الخمول (idle.optMinutes من المشترك، 1..120) ⇒ حدث `desktop://idle {idle:true, ts}` — الواجهة تخفف استطلاعاتها، ومراقب الحافظة يتوقف عن الاستطلاع (تنفيذ الواجهة عبر الحدث؛ المراقب الأصلي يستمر في توفير الحالة فقط). الخروج ⇒ استئناف. الهدف: دوران CPU أدنى وذاكرة مستقرة <150MB (قياس قصير قابل للتنفيذ محليًا + بروتوكول 24 ساعة يدوي على أجهزة حقيقية موثق في worklog).
- السياسات تُسحب من المخزن المشترك كل 10ث إلى كاش محلي (config.json) — تعمل أوفلاين.

### 16.هـ التشخيص الأصلي (بند 5 — أدوات المرحلة 11 تعمل أصلًا)
- `diag_sidecar_ports`: فحص TCP فعلي من الطبقة الأصلية لكل منافذ §1 (3000/3003/3004/3005/3006/3007/3009/81) بزمن استجابة.
- `diag_speed_test`: قياس نقل حقيقي من محرك Rust (تنزيل 24MB + رفع 8MB عبر /api/tools/speedtest نفس مسار المتصفح) — MB/s حقيقية لا وهمية.
- `diag_idle_state`: حالة الخمول/القفل الحقيقية (لعرضها في التشخيص).
- `diag_export(path, content)`: تصدير التقرير إلى ملف عبر حوار حفظ أصلي (صلاحية `dialog:allow-save` في capabilities/hardening.json — الوحيدة الممنوحة؛ أقل سطح هجوم) — خارج التطبيق: تنزيل blob كما كان.
- `/api/tools/diag` موسع: services تضم mediaBridge/guardBridge/prodBridge/secBridge/gateway + مصفوفة ports (8 منافذ بتحديد دورها). واجهة التشخيص تعرض كلها + «فحص أصلي» + «قياس أصلي» (زر).
- **تقرير التشخيص** يحمل الإصدار الحقيقي من /api/version (لا القيمة القديمة 2.4.1 — أُصلحت إلى 1.0.0 المقفول).

### 16.و مزامنة الإعدادات — نفس SQLite (بند 6)
- **المخزن المصدر**: `db.DesktopSetting {key, value(JSON), updatedAt}` — نسخة الويب (متصفح) ونسخة التطبيق (Tauri) يقرآن ويكتبان الكائن نفسه عبر `GET/PUT /api/desktop/settings` (دمج جزئي — آخر كاتب يفوز، تنقية صارمة فاسد ⇒ افتراضي: appLock{enabled,idleLockMin 0..120,biometric,hasPin} · idle{optMinutes 1..120,reducePolling} · updater{autoCheck}).
- **قاعدة الحزمة الموزعة (G-26)**: Next ينسخ .env مع DATABASE_URL مطلق لآلة البناء (مكسور على أجهزة المستخدمين) — build-resources.sh يحذفها، procman.rs يضبط `DATABASE_URL=file:<app_config_dir>/nexuslink.db` (قيمة env تتفوق على .env) ويزرع seed من resources/server/db/custom.db عند أول إقلاع (prisma db push قبل الحزم).
- **طبقة Rust**: سحب دوري 10ث (settings.rs::spawn_hardening_sync) يطبّق السياسات على كاش محلي عبر `harden_core::policy_from_shared` (مرآة تنقية السيرفر حرفيًا — خارج النطاق ⇒ الافتراضي رفضًا لا حصرًا)؛ دفع مرآة hasPin/biometric بعد ضبط/مسح PIN (put_json قراءة-تعديل-كتابة لا يمس الحقول المُدارة من الواجهات).
- **بطاقة الإعدادات**: «قفل وحماية التطبيق» (نافذة سطح المكتب — تقرأ/تكتب المشترك كله؛ PIN/البصمة/قفل-الآن عبر أوامر Rust) — وسياسات المشترك قابلة للكتابة من أي نسخة ويب أيضًا (نفس نقاط النهاية).

### 16.ز التحقق
- **تنفيذيًا (scripts/hardening-verify)**: نواة نقية واحدة تُضمَّن حرفيًا (نمط media_core) — متجهات PBKDF2 معيارية (4) + حتمية/ملح + hex + متجهات قرار الخمول (7) + طابور التدقيق (8: FIFO/إسقاط-أقدم/قائمة بيضاء/بتر) + تنقية السياسة (4: صالح/خارج-نطاق/فارغ/غير-عددي) + أصول المحدّث (conf/pubkey/endpoints/createUpdaterArtifacts/lock.html/أوامر مسجلة/حصرية native-). **47/47**.
- **تعاقديًا (E2E §16)**: settings GET/PUT (صالح/فاسد يُنقى) — audit POST→GET→مرشحات→DELETE — status.desktop.hardening — تدقيق نقل المسار السيرفي — /api/version current=1.0.0 + changelog — /api/tools/diag ports الثمانية.
- **بنائيًا (CI)**: desktop.yml يبني 3 منصات مع tauri-plugin-updater + windows 0.58 (Hello/BCrypt/GetLastInputInfo) + objc2-local-authentication (Touch ID) + x11rb screensaver — والبناء الفيزيائي للحزم الموقعة إثبات CI.
- **بروتوكول اختبار النجاح (يدوي على أجهزة حقيقية — الحاوية بلا GUI/بطارية)**: 1) ضبط PIN ثم القفل من الشريط والفتح بالرمز ثم بالبصمة 2) ضبط قفل خمول 1 دقيقة وترك الجهاز ⇒ قفل تلقائي 3) خمول 24 ساعة ⇒ استنزاف بطارية <3% وذاكرة مستقرة (طابور التدقيق وسحب السياسات بلا نشاط شبكة خارج محلي) 4) تغيير إعداد من متصفح الويب ⇒ ظهوره في التطبيق خلال ≤10ث والعكس.

**قيود موثقة بصدق**: البصمة على لينكس غير مدعومة (PIN فقط) — Wayland بلا كشف خمول (ميزتا الخمول/التوفير تتعطلان بأمان) — الإصدار مقفول 1.0.0 فلا تنفيذ فعلي للتحديث (المسار مكتمل وموقع) — استنزاف البطارية 24 ساعة لا يمكن قياسه في حاوية بلا GUI (بروتوكول يدوي موثق أعلاه) — التدقيق يتطلب السيرفر المضمّن حيًا (الطابور يمتص الانقطاع حتى 200 حدث ثم يسقط الأقدم بصدق).

## 17. التغليف والإصدار النهائي (الجولة 3 — مصدر: .github/workflows/release.yml + tauri.conf.json + procman.rs::resolve_resources + BUILD.md)

**مبدأ الإصدار**: رقم إصدار موحّد **1.0.0** مقفول عبر الأربعة (tauri.conf.json / Cargo.toml / pubspec.yaml / package.json الجذر) — أي اختلاف = فشل تعاقدي. أصول إصدار منشور **لا تُستبدل** (تواقيع latest.json مبنية على محتواها)؛ الإصدار الجديد = وسم v* جديد فقط.

### 17.أ مصفوفة الحزم (job desktop — matrix ثلاث منصات)
- **Windows**: `NexusLink_<v>_x64-setup.exe` (NSIS — webviewInstallMode downloadBootstrapper: يثبّت WebView2 تلقائيًا إن غاب) + `NexusLink_<v>_x64_en-US.msi` (WiX — **يتطلب تفعيل VBScript** على runners 2026 بلا VBSCRIPT: `Add-WindowsCapability` لأن ICE validation في light.exe يعتمده) + **`NexusLink_<v>_x64-portable.zip`** (بلا تثبيت).
- **macOS**: `NexusLink_<v>_aarch64.dmg` — البناء بـ `--bundles "dmg app"` لأن أصل updater (`.app.tar.gz` + `.sig`) يُنتج فقط عند bundling التطبيق نفسه. غير موقّع افتراضيًا — دليل Developer ID + Notarization في BUILD.md §3.
- **Linux**: `NexusLink_<v>_amd64.deb` أولاً ثم `*.AppImage` — الأخير يتطلب `NO_STRIP=true` (linuxdeploy يفشل صامتًا على strip لمكتبات `.relr.dyn` — tauri#14796) و`APPIMAGE_EXTRACT_AND_RUN=1` (بلا FUSE).

### 17.ب تخطيط الحزمة المدمجة (مصدر الحقيقة: tauri-bundler debian.rs + settings.rs::copy_resources + tauri-utils resources.rs اختباراته الرسمية)
- الموارد تُنسخ **بالمسار النسبي الكامل من src-tauri محفوظًا**: `<resource_dir>/resources/server/...` (+ comms/ + gateway/) — البادئة `resources/` جزء من الهدف.
- `<resource_dir>`: ويندوز = مجلد التنفيذي · لينكس = `/usr/lib/NexusLink` (اسم productName من tauri-codegen) · ماك = `Contents/Resources`.
- **resolve_resources (procman.rs)** يفحص بالترتيب: `<rd>/resources/server/server.js` (المدمج) → `<rd>/server/server.js` (مسطّح — توافق) → `<exe_dir>/resources/server/server.js` (portable) → `CARGO_MANIFEST_DIR/resources` (تطوير). قبل الجولة 3 كان الفحص الأول وحده مسطّحًا ⇒ الخادم المضمّن لا يبدأ في أي حزمة مثبتة (عيب كامن أُصلح — جوهر اختبار نجاح التثبيت النظيف).
- **resolve_node**: `node.exe`/`node` بجوار التنفيذي (الحزم تُسقط اللاحقة الثلاثية) — Portable يعيد تسمية sidecar إلى node.exe يدويًا.
- **G-28 (r5 verbose)**: متغيرات musl في node_modules المضمّن (`@img/sharp-linuxmusl-*` و`@next/swc-linux-x64-musl`) غير مستعملة على أي منصة مستهدفة — وlinuxdeploy يفشل عليها صامتًا (`Could not find dependency: libc.musl-x86_64.so.1`) — build-resources.sh يحذف كل `*-musl*` من resources/server.
- **G-29 — تقليم standalone (keep-list)**: تتبع Next يضمّن شجرة المستودع كاملة (skills/download/scripts/.git/…) — تسرّب ~160MB وأسماء صينية كسرت MSI (LGHT0311 خارج code page 1252). build-resources.sh يحفظ حصرًا: server.js + .next + public + db + node_modules + package.json (صفر مسارات غير ASCII في الحزمة — مثبت محليًا).
- **G-30 — جذر بيانات قابل للكتابة**: التثبيت per-machine (MSI) يضع الحزمة في Program Files غير القابل للكتابة — كل مسارات nexus-storage/desktop-ui.json كانت نسبيّة لcwd. procman يعرّف `data_root(app) = app_config_dir/nexus-data` ويمرر `NEXUS_DATA_ROOT` لعمليات node الثلاث؛ جانب السيرفر عبر `src/lib/nexus/data-root.ts` (بلا env: cwd/data كما في التطوير — سلوك E2E لم يتغير)، وجانب Rust (procman/clipboard/sync) يكتب في `data_root/nexus-storage` مباشرة، و`notify::server_file_abs` يفك «data/» ⇒ data_root. destPath التعاقدي يحافظ على شكله «data/nexus-storage/...».
- **LGHT0311 (r5 verbose)**: قاعدة بيانات MSI مقيّدة بصفحة الشفرة 1252 — وصفا الحزمة في tauri.conf.json **ASCII نقيان إلزامًا** (العربية فشلت light.exe صامتة). و-`-v` لبناء لينكس/ويندوز يكشف مخرجات البندر (output_ok يطبع عند debug فقط).
- **سلامة تجميع comms (G-27)**: تبعيات mini-services/comms-service حصرية في ملفها (الجذر بلا workspaces) — build-resources.sh يضمن تثبيتها قبل esbuild وإلا تُرك `import("bonjour-service")` خارجيًا ⇒ mDNS مكسور صامتًا داخل الحزم (كان CI يبنيه كذلك حتى هذه الجولة). الفحص: لا `await import("<pkg>")` لتبعية خارجية داخل comms.cjs.
- **Portable ZIP**: نفس تخطيط NSINS حرفيًا (exe + node.exe + resources/) + README.txt (PORTABLE-README.txt) — تُجمَّع بعد البناء بـ bsdtar (`tar -a -cf`) تفاديًا لمشاكل المسارات الطويلة في Compress-Archive.

### 17.ج المحدّث والإرفاق (release.yml)
- بناء `desktop` matrix: win `--bundles "nsis msi"` / linux `"appimage deb"` / mac `"dmg"` — بوصفة desktop.yml المجرّبة حرفيًا (standalone + build-resources.sh + sidecar v20.18.1 + APPIMAGE_EXTRACT_AND_RUN + CMAKE_POLICY_VERSION_MINIMUM=3.5).
- `TAURI_SIGNING_PRIVATE_KEY`+`_PASSWORD` سرّان: وجودهما ⇒ updater artifacts (.sig بجوار كل حزمة)؛ غيابهما ⇒ `createUpdaterArtifacts:false` بالحقن (البقاء أخضر بلا توقيع).
- **الإرفاق**: وسم `v*` ⇒ إرفاق تلقائي + `latest.json` موقعة (windows-x86_64→x64-setup.exe · linux-x86_64→AppImage · darwin-aarch64→.app.tar.gz) + SHA256SUMS + Draft Release. `workflow_dispatch` ⇒ artifacts فقط ما لم تُفعَّل مدخل `attach_to_release` صراحة (حماية أصول v1.0.0 الموقعة).
- نقطة فحص المحدّث: `releases/latest/download/latest.json` — يجب أن ترد `version = 1.0.0` (أنت على الأحدث).

### 17.د التحقق (الجولة 3)
- **تعاقديًا (E2E §17)**: release.yml بناء حقيقي بلا echo + مصفوفة الصيغ + خطوة portable + latest.json + dispatch inputs — tauri.conf targets الخمسة — procman resolve_resources بالبادئة — PORTABLE-README — BUILD.md (NSIS/MSI/Portable/AppImage/notarization/مفاتيح) — README §0 (المركز/الوكيل + جدول الحزم) — e2e-checklist (اختبار التثبيت النظيف) — توحيد الإصدار بالملفات الأربعة.
- **بنائيًا (CI)**: release.yml على 3 منصات ينتج الصيغ الست فعليًا — NSIS/MSI/ZIP وDMG وAppImage+deb.
- **يدويًا**: اختبار النجاح — تنزيل المثبت على ويندوز نظيف ⇒ تثبيت ⇒ كل شيء يعمل مع الهاتف **بلا أي خطوة يدوية إضافية** (docs/e2e-checklist.md §1).

---

## 18. القناة الحية NexusLive — UDP للإدخال الحي (الجولة 4 — مصدر: live.rs + live_core.rs + remote-bridge.ts + mini-services/remote-service + live_channel.dart)

«كل ميزة حساسة للأداء تعمل فوق قناة UDP عالية التردد — لا TCP للإدخال الحي»: قلم/ماوس/جيروسكوب/لمس من الهاتف إلى سطح المكتب بداتاجرام واحد لكل حدث، بلا تجزئة ولا إعادة إرسال (دلالة حية — أحدث حالة تفوز، الفقد يُعدّ إحصاءً فقط). القنوات القائمة (§4.2/§13 rc:* و§15 rtc:*) قائمة كما هي — NexusLive مضافة لا تمس شيئًا.

### 18.أ الطوبولوجيا والثقة
- **المنافذ الجديدة**: `3010/udp` هاتف→جسر (`NEXUS_LIVE_PORT`) · `3011/udp` جسر→Rust على **127.0.0.1 حصرًا** (`NEXUS_LIVE_SINK_PORT`) — لا سطح هجوم شبكي على الطبقة الأصلية.
- **لماذا مرور عبر الجسر لا إرسال مباشر للهاتف→Rust؟** بوابة الثقة مركزية عند جسر 3004 (controllerTrust + rc:session §13) — إحصاء الفقد/الترتيب/RTT رصده من E2E (فحوص Node-side) — Rust حوض معزول يثق بـ loopback فقط. كلفة الحلقة المحلية عشرات الميكروثانية (لا تهدد أهداف 20/30ms).
- **دورة الثقة**: هاتف موثوق + جلسة نشطة → `rc:live-hello` (socket.io) → الجسر يولد مفتاح **8B عشوائي** (crypto.randomBytes) لكل تدفق → `rc:live-ready {port, key (16-hex), mtu:128, proto:1}` → أول حزمة UDP تحمل المفتاح **تُثبّت عنوان المرسل** (رفض ما بعده من عنوان آخر — droppedAddr) → نهاية الجلسة/انقطاع السوكِت/إعادة hello تحذف التدفق فورًا (القناة الحية ترث عمر الجلسة حرفيًا).
- **حاجزان متتاليان**: الجسر يتحقق (توقيع/إصدار/نوع/طول/مفتاح/عنوان) ثم Rust يفك صارمًا (live_core) — الفاسد يُرفض صامتًا مع إحصاء (نفس سياسة الجسور القائمة).
- Flutter: الجلسة النشطة تفتح التدفق تلقائيًا (rc:live-hello بعد 150ms من قبول rc:session)، وعند نشاط القناة تتحول `move`/`sendPointer` فوق UDP حصرًا (socket.io للبقية) — رقاقة حالة في شاشة التحكم (rctl.live.*).

### 18.ب البروتوكول الثنائي (v1 — big-endian — مرآة حرفية live_core.rs ↔ live_channel.dart)
```
رأس 22B: [0..2) magic u16be=0x4E58 ("NX") · [2] ver=1 · [3] type · [4] flags (bit0=نسبي للماوس)
         [5] محجوز · [6..10) seq u32be · [10..14) ts u32be (ms epoch مقتطعة) · [14..22) key 8B
حمولات:  pen 10B  = nx·ny u16 (0..65535) · pressure u16 · tiltX·tiltY i8 · phase u8 (0=hover 1=down 2=move 3=up) · buttons u8
         mouse 8B = nx|dx · ny|dy (مطلق u16 / نسبي i16 ±500) · phase u8 (0=move 1=down 2=up 3=click 4=dblclick 5=rclick) · buttons u8 (bit0=أيسر) · wheel i16
         gyro 12B = ax·ay·az i16 (milli-g) · gx·gy·gz i16 (milli-dps)
         touch 8B = nx·ny u16 · action u8 (إجراءات pointer الستة) · pointerId u8 · pad u16
         ping 0B  → يرد الجسر pong (type=0x7E) بنفس seq وts=زمن الجسر (مزامنة إزاحة NTP-نمط)
```
- ping كل 500ms من الهاتف → RTT (EMA α=0.3) + إزاحة ساعة: `offset ≈ pongTs − (t0+t1)/2` — ts حزم البيانات = ساعة الهاتف + الإزاحة ⇒ Rust يقيس **الكمون طرف-إ-to-طرف** (`now−ts`) ويحسب P50/P95 (نافذة 256 عينة، العينات ≥60ث تُهمل انحراف ساعة).
- watchdog الهاتف: بلا pong 3ث → إعادة `rc:live-hello` بتراجع أُسي 500ms→8s (يُصفّر عند أول pong).

### 18.ج التحويل إلى محلّل الإدخال القائم (بلا مسار حقن موازٍ)
- pen (hover/move/down/up) → `kind=pointer {nx, ny, action, pressure}` — الضغط محمول في الحدث استعدادًا لمهمة لوحة الرسم (لا يفسده apply_pointer القائم).
- touch/mouse-مطلق → `kind=pointer` بالإجراءات الستة نفسها (§15) · wheel≠0 → `kind=scroll {dy = wheel×40}` (تدرّج §13).
- mouse-نسبي (flags bit0) → `kind=move {dx, dy, drag: buttons.bit0}` — **حالة الزر في كل حزمة**: حافة السحب تُحسب في set_drag، وفقد حزمة up يصححه أول حزمة تالية (دلالة حية ذاتية التصحيح) + حدث click إضافي عند phase=click/dblclick/rclick.
- gyro → بلا حقن في هذه المرحلة — يُعدّ إحصاءً (مستهلكه مهمة الجيمباد القادمة).
- **الدمج الحي (latest-wins — live_core::coalesce)**: يستقبل live.rs دفعة (أول حزمة حاجزة ثم تفريغ غير حاجز حتى **4 حزم**) ويدمجها قبل الحقن: حركات المؤشر (pointer-move المطلق / move النسبي) تُستبدل بأحدثها في slotين مستقلين، والأحداث المنفصلة (نقر/ضغط/رفع/عجلة) تُحفظ كلها بالترتيب، والحركة المعلقة تُفرغ قبل أول حدث منفصل بعده (الموضع قبل النقرة). هذا يمنع نمو الكمون خطيًا تحت التحميل (كان 700ms بلا دمج عند 250Hz إجهادية) — دلالة حية بلا تراكم.
- الحقن: `input::execute_sync` — نفس خيط enigo ونفس بوابة الجلسة §13 (رفض بلا جلسة) + انتظار اكتمال الحقن الفعلي (قياس صادق لا جدولة فقط) — أمر Tauri `live_state` يعيد {listening, sinkPort, sessionActive, stats{rx, injected, droppedMalformed, droppedNoSession, injectErrors, gyro, clockSkew}, latency{p50Ms, p95Ms, samples, lastInjectUs}}.

### 18.د أحداث socket.io المضافة (الجسران متطابقان — المدمج والمرجع)
| الحدث | الاتجاه | الحمولة |
|---|---|---|
| `rc:live-hello` | هاتف→جسر | — (يتطلب ثقة + جلسة) |
| `rc:live-ready` | جسر→هاتف | `{port, key, mtu, proto, at}` |
| `rc:live-stats` | جسر→الجميع | `{port, sinkPort, flows:[{deviceId,name,bound,stats}], global{droppedMalformed,droppedNoKey,droppedAddr,forwardErrors,pongErrors}, at}` — بث دوري 5ث عند نشاط تدفق + عند الطلب `rc:live-stats?` |
| `rc:rejected` | جسر→هاتف | `{reason:"untrusted", ev:"rc:live-hello"}` — بلا جلسة/ثقة |

### 18.هـ التحقق
- **تنفيذيًا (scripts/live-verify — نمط media-verify — النتيجة الفعلية 49/49)**: يضمّن live_core.rs + input_exec.rs حرفيًا — متجهات فك/ترميز لكل الأنواع + رفض الفاسد (قصير/توقيع/إصدار/نوع/طول/سقف) + متجهات التسلسل (ok/lost/reorder/dup/wrap) + خريطة الأحداث (ضغط القلم محمول، drag الذاتي التصحيح، العجلة→scroll، النقر المزدوج) + متجهات الدمج الحي (5) + **UDP loopback حقيقي عبر Xvfb**: حقن enigo فعلي بقياس طرف-إ-to-طرف — **معيار النجاح: حدث قلم مفرد P95=13ms < 20ms ✓** + تدفق مستمر 60Hz مختلط P50=8ms/P95=25ms مقيّد بلا تراكم + النقرات المنفصلة محفوظة 25/25 رغم الدمج. حد موثق بصدق: فوق إنتاجية XTEST المتزامنة (~7ms/عملية — تختلف بالمنصة) ينمو الكمون مؤقتًا رغم الدمج؛ المعدلات الحقيقية (60-120Hz) تحت الهدف.
- **تعاقديًا (E2E §18)**: رفض hello بلا جلسة/ثقة — hello مع جلسة موثوقة → live-ready — ping→pong بنفس seq — تمرير touch إلى حوض loopback (مستمع E2E) — فقد (فجوة seq) → lost — ترتيب معكوس → reorder — تكرار → dup — فاسد → droppedMalformed — مفتاح مجهول → droppedNoKey — عنوان آخر → droppedAddr — نهاية الجلسة تموت التدفق — RTT loopback < 100ms — توثيق §18 + البنية (الجسران + live_core/live.rs/live_channel + الترجمات).
- **بنائيًا (CI)**: desktop.yml يبني live.rs/main.rs على المنصات الثلاث (الترجمة الفيزيائية للطبقة الأصلية).
- **قيود صادقة**: ts الهاتف يعتمد جودة مزامنة الإزاحة (انحراف الساعة المفرط يُهمل إحصائيًا) — لا ضمان تسليم (هذه هي الدلالة الحية المقصودة) — Wayland بلا حقن إدخال (نفس حد §13) — الحاوية بلا هاتف حقيقي: بروتوكول الاختبار الميداني موثق في docs/e2e-checklist.md (قسم جديد §2).

## 19. الشاشة الثانية — الهاتف شاشة ممتدة فعلية (الجولة 4 مرحلة ① — مصدر: vdisplay.rs + vdisplay_core.rs + media.rs + media-bridge.ts + desktop-bridge.tsx + media_service.dart + media_screen.dart + installer-hooks.nsh)

«لا بروتوكول موازٍ»: الشاشة الافتراضية شاشة نظام عادية في نظر كل شيء — تُبث عبر مسار §15 حرفيًا (rtc:offer kind=screen)، ويُحقن لمسها عبر مسار §15.ب/§18 حرفيًا (فضاء المؤشر = أصل/أبعاد الهدف الملتقط). الجديد فقط: **إنشاء العرض وإطفاؤه** واختيار الهدف من قائمة الأهداف القائمة.

### 19.أ المنصات — حقيقة من المصادر لا تمنيات
| المنصة | التنفيذ | الإثبات من المصدر |
|---|---|---|
| ويندوز | سائق **Virtual-Display-Driver** (VirtualDrivers — MIT، توقيع SignPath) HWID `Root\MttVDD`، صنف Display | إصدار 25.7.23 `VirtualDisplayDriver-x86.Driver.Only.zip` (mttvdd.cat + MttVDD.dll + MttVDD.inf) — مسار الإعدادات `C:\VirtualDisplayDriver\vdd_settings.xml` مثبت من مصدر السائق (Driver.cpp:94 `confpath`) |
| التشغيل/الإطفاء | **CCD** (QueryDisplayConfig/SetDisplayConfig) — **بلا صلاحيات مدير** — نفس آلية Win+P | واجهات user32 قياسية؛ بنية 48B لـ DISPLAYCONFIG_MODE_INFO و220B لـ DEVMODEW متحققة من windows-rs 0.58 حرفيًا |
| الدقة/الاتجاه | ChangeDisplaySettingsExW على جهاز العرض الافتراضي (مستخدم-level) — الأوضاع المتاحة من XML عند التثبيت | سكربتات المجتمع الرسمية (changeres/toggle) + واجهة قياسية |
| لينكس | xrandr: `cvt → --newmode nxWxH_60 → --addmode <مخرج غير متصل> → --right-of الأساسية` — بلا صلاحيات، جلسة X11 حصرًا | بند المهمة حرفيًا؛ Wayland غير مسند (موثق) |
| ماك | **غير مسند بصدق**: لا شاشات افتراضية بدون سائق موقّع (قيود توقيع macOS) | البديل العملي الجاهز: «بث نافذة محددة» — أهداف `window:*` قائمة أصلًا في media_targets على ماك (§15) |

### 19.ب تثبيت السائق (NSIS — installer-hooks.nsh) واختياري غير حاجز
1. **الشهادات**: استخراج من `mttvdd.cat` → `Cert:\LocalMachine\TrustedPublisher` — نفس تدفق `silent-install.ps1` الرسمي للمشروع (تحقق حرفي). 
2. **الإعدادات**: نسخ `vdd_settings.xml` المعدّ مسبقًا (count=1 + الأوضاع التعاقدية 1080×2400/2400×1080/1080×1920/1920×1080 @60) إلى `C:\VirtualDisplayDriver\`.
3. **الجهاز**: `nefconc.exe install MttVDD.inf "Root\MttVDD"` (nefarius/nefcon v1.21.0 — MIT — أمر `install` المتوافق مع devcon، نفس أمر سكربت التثبيت الصامت الرسمي). فشل أي خطوة **لا يفشل التثبيت** — الحالة تعود صادقة من التشخيص (vdisplay_status).
4. **الإزالة**: PREUNINSTALL `nefconc.exe remove "Root\MttVDD"` (الجهاز فقط — الحزمة تبقى في مخزن السائقين، دلالة `remove` الموثقة). إعدادات `C:\VirtualDisplayDriver` تُترك إن كان الطرف الآخر يملكها.
5. **الأصول**: `apps/desktop/src-tauri/vdd/` (INF/DLL/CAT/nefconc.exe + ترخيصا MIT للطرفين) ضمن bundle.resources → `$INSTDIR\vdd` (نفس دقة resolve_resources §17.ب). Portable ZIP بلا NSIS → لا تثبيت سائق تلقائي (التشخيص يرشد) — موثق.
- **بعد إعادة تشغيل النظام**: العرض الافتراضي يظهر نشطًا (سلوك السائق المثبت) — NexusLink لا يطفئه تلقائيًا عند الإقلاع (احترام استخدام الطرف الآخر المحتمل)؛ الإطفاء عند انقطاع الهاتف يخص جلساتنا حصرًا (19.د) — والبطاقة/التشخيص يعرضان الحالة.

### 19.ج أحداث socket.io (جسر 3005 — تنقية جديدة)
| الحدث | الاتجاه | الحمولة (بعد التنقية) |
|---|---|---|
| `screen:req` | هاتف→الجميع | **`target` يمر الآن فعليًا** (كان يُسقط في التنقية): `^(screen:\d{1,3}\|screen:all\|screen:virtual\|default)$` |
| `secondscreen:cmd` | هاتف→الكمبيوتر | `{action: enable\|disable, w? 320..8192, h? 320..8192, fps? ∈ §15, quality? ∈ §15, at}` |
| `secondscreen:state` | الكمبيوتر→الجميع (دور pc حصرًا — الهاتف لا يصدر حالة) | `{active: bool, target?, w?, h?, error? ≤200, at}` — مصدر الحقيقة للهاتف |
| `media:phone-offline` | الجسر→الجميع | يصدر عند `disconnect` لدور phone — مشغّل الإطفاء الذكي |

### 19.د دورة الجلسة (الكمبيوتر — desktop-bridge.tsx)
- `secondscreen:cmd enable {w,h,fps,quality}` → `vdisplay_enable` (ويندوز: CCD تنشيط المسار الخامل + استنساخ وضع مصدر بموضع يمين أقصى حافة نشطة + `change_mode` للدقة/الاتجاه؛ لينكس: xrandr كما 19.أ) → هندسة الشاشة الجديدة → `media_screen_start {target:"screen:N"}` → `rtc:offer` + `screen:state` + `secondscreen:state {active:true, target, w, h}`.
- **إعادة الظهور قسرًا**: تنشيط مسار CCD خامل يستنسخ وضع المصدر من المسار الأساسي مع `modeInfoIdx` صريحين (مصدر+هدف) — الفشل يعلن نفسه عربيًا (بلا وضع مصدر للاستنساخ/الوضع غير متاح).
- `secondscreen:cmd disable` أو **`media:phone-offline`** (انقطاع الهاتف) أو إغلاق شاشة العرض في الهاتف وهو هدف افتراضي → `media_screen_stop` + `vdisplay_disable` → إطفاء مسار العرض الافتراضي من التهيئة — **النوافذ تعود للشاشات الباقية سلوك النظام تلقائيًا** (البند 8). الحارس: الإطفاء إن تسببت شاشاتنا فقط (`SESSION` — لا نمس شاشات الطرف الآخر أبدًا) ورفض إذا ستتبقى صفر شاشات.
- `screen:req {target:"screen:virtual"}` (اختيار من القائمة) → تمكين تلقائي ثم بث — نفس المسار.
- **عقد الفهرس**: `screen:N` = ترتيب EnumDisplayMonitors على ويندوز — نفس ترتيب windows-capture::Monitor::from_index (تحقق حرفي من مصدر الكرِيت 1.3.6: from_index = enumerate() = EnumDisplayMonitors) ⇒ الالتقاط واللمس والقائمة متطابقة الفهرس. **إصلاح مرفق (§15)**: أصول الشاشات على ويندوز صارت حقيقية من EnumDisplayMonitors (كانت 0,0 للجميع — حد G-38 مرفوع جزئيًا) — أساس خريطة لمس صحيحة للشاشة الافتراضية (أصلها في المركّب).
- **اللمس**: فضاء المؤشر يضبطه media_screen_start من أبعاد/أصل الهدف (§15.ب حرفيًا) → لمس الهاتف على بث الشاشة الافتراضية = مؤشر مطلق داخلها — عبر NexusLive UDP عند الجلسة النشطة (§18 حرفيًا، `sendTouch` 8B) وإلا socket.io.

### 19.هـ التحقق
- **تنفيذيًا (scripts/vdisplay-verify — النتيجة الفعلية 49/49)**: يضمّن vdisplay_core.rs حرفيًا — تحقق الأوضاع (حدود/تعاقد/أسماء حتمية) + XML بناء/ترقيع محافظ (بقاء إعدادات الطرف الآخر حرفيًا + idempotent + رفض جذر غريب) + **حزمة السائق المرفقة فعليًا** توافق النواة (count/الأوضاع/60Hz + الأصول الستة + INF بفك UTF-16 يحمل Root\MttVDD وDisplay) + محلل xrandr على ثابتين واقعيين (أربعة مخرجات/أساسية/متصلة ثانية/اختيار المخرج الفارغ/وضعنا محمول) + بناء newmode/addmode/attach/teardown حتمي + cvt Modeline. المحرك التقط ذاتيًا أثناء الكتابة: مطابقة سطر الوضع كانت على السطر كاملًا لا الوسم الأول — أُصلح في النواة قبل الإثبات.
- **تعاقديًا (E2E §19)**: تمرير target في screen:req + رفض الأشكال الفاسدة — secondscreen:cmd تنقية (enable/disable/w/h/fps/quality + رفض الفاسد) — secondscreen:state من دور pc حصرًا — media:phone-offline عند انقطاع الهاتف — ربط desktop-bridge (enable → vdisplay_enable → media_screen_start → state) — عقد الفهرس في media.rs (EnumDisplayMonitors) — حزمة vdd + installer-hooks (شهادة/nefcon install/remove) — resources — §19 موثق — القاموسان seconds.*.
- **بنائيًا (CI)**: desktop.yml يبني vdisplay.rs/main.rs/media.rs على المنصات الثلاث — FFI ويندوز (CCD/DEVMODEW/EnumDisplayMonitors) يُترجم فيزيائيًا على runner ويندوز.
- **قيود صادقة**: اختبار النجاح الميداني (سحب نافذة → تظهر في الهاتف → لمس <100ms محسوسًا) يحتاج ويندوز حقيقيًا بسائق — الحاوية بلا GUI: البروتوكول الميداني موثق في docs/e2e-checklist.md، والقياس الأصلي المتاح هو كمون الإدخال (§18: P95=13ms) + كمون البث (WebRTC RTP محلي مباشر — §15) — مجموعهما يحتمل هدف 100ms بهامش، والإثبات النهائي ميداني. لينكس: مخرج فارغ شرط (سائق dummy/VIRTUAL عند غيابه — موثق في الحالة). ماك: البديل نافذة. التنشيط البارد (مسار خامل بلا modeInfoIdx) يفشل بصدق مع رسالة عربية إن لم يتوفر وضع مصدر للاستنساخ.

## 20. لوحة الرسم الاحترافية — الهاتف+القلم لوحة رقمية (الجولة 4 مرحلة ② — مصدر: tablet.rs + tablet_uinput.rs + live_core.rs + input_exec.rs + remote-bridge.ts + desktop-bridge.tsx + live_channel.dart + tablet_screen.dart + controller_service.dart)

> «حوّل الهاتف+القلم إلى لوحة رسم احترافية». القلم عبر NexusLive UDP حصرًا (§18 حرفيًا — لا بروتوكول موازٍ)، وضعان على الكمبيوتر، والضغط يصل لبرنامج الرسم عبر تقنية متوافقة قابلة للتعيين.

### 20.أ المنصات بإثبات المصدر (تحقق 2026-10-14)
- **«وضع الماوس المطلق» — الكل**: القلم يحرك مؤشر النظام بموضع مطلق (مسار apply_pointer §15 حرفيًا) — يعمل مع أي برنامج رسم (Krita/Photoshop/IbisPaint). الضغط→السماكة عبر محرك الفرشاة (20.د). **هذا وضع الإنتاج الافتراضي على كل المنصات.**
- **«وضع اللوحة الافتراضية» — Linux فقط**: `/dev/uinput` — أساس النواة الرسمي (Documentation/input/uinput.rst): جهاز ديجيتايزر HID كامل (ABS_X/Y + ABS_PRESSURE + ABS_TILT_X/Y + BTN_TOOL_PEN/RUBBER/TOUCH/STYLUS + INPUT_PROP_DIRECT) بلا أي سائق خارجي ولا توقيع — libinput يلتقطه (X11: XInput بضغط كامل؛ Wayland: أصيلًا).
- **قيد موثق بصدق — Windows/macOS**: بلا أساس HID افتراضي موثوق مفتوح المصدر — التحقق الحرفي: `vigem-client 0.1.4` (crates.io API حرفيًا: «ViGEm client API in pure Rust» — محاكاة يد ألعاب XBOX/DS4 حصرًا، آخر نشر 2022-08، **لا ديجيتايزر ولا قلم**)؛ `vmulti` (djpnewton/vmulti — «Virtual Multiple HID Driver» — آخر دفع **2016-05**) سائق KMDF مهجور يتطلب توقيعًا اختباريًا ⇒ غير قابل للشحن. طلب الوضع على هذه المنصات يُصحّح إلى الماوس المطلق، والحالة تعرض القيد نصًا (`available:false` + note). (OpenTabletDriver لم يُستشهد — فشل التحقق الحرفي من مصدره في هذه الجلسة: حدود API).

### 20.ب البروتوكول — امتداد حزمة pen (توافق أمامي كامل مع §18)
- **flags bits1-2 = الأداة** (كانت صفرًا لحزمة pen): `0=قلم · 1=ممحاة (طرف مقلوب) · 2=إصبع` — أداة خارج التعاقد (>2) تُطبع قلمًا عند الترميز والفك معًا (توافق أمامي؛ bit0 للماوس النسبي لم يمس).
- الحمولة 10B كما هي (nx·ny·pressure u16be + tiltX·tiltY i8 ±60° + phase + buttons bit0=زر خلفي). الجسر لا يفكك flags للقلم — يمرر خامًا (لا تغيير عند 3004/3010).
- **تعيين uinput (لينكس)**: X/Y `0..32767` · PRESSURE `0..2047` (تلامس حصرًا — صفر في hover) · TILT `±127` (من i8 ±60° بتحجيم 127/60) · الطور: hover=أداة في المدى بلا BTN_TOUCH · down/move=تلامس+ضغط · up=خروج الأداة — دلالة أقلام Wacom الفعلية. انتقالات الأدوات/الأزرار حصرًا + SYN_REPORT واحد لكل عينة. `map_sample`/`build_setup` نقيّتان (uinput_user_setup حرفية من linux/uinput.h — 1116B).

### 20.ج أحداث socket.io (جسر 3004 — تنقية جديدة)
| الحدث | الاتجاه | الحمولة (بعد التنقية) |
|---|---|---|
| `rc:tablet:cmd` | هاتف→الكمبيوتر | `{cmd: get\|set, mode?, pressure?, decKey?, incKey?, levels?, modifier?}` — جلسة نشطة من هاتف موثوق حصرًا (بوابة live-hello نفسها). set: `mode ∈ mouse\|tablet` · `pressure ∈ off\|keys\|scroll` · مفاتيح محرف ASCII مرئي واحد (33..126) · `levels 2..64` صحيح · `modifier ∈ none\|ctrl\|alt\|shift` — **الفاسد يُرفض كله لا جزئيات** |
| `rc:tablet:state` | الكمبيوتر→الجميع (دور pc حصرًا) | `{mode, available, note, brush{pressure,decKey,incKey,levels,modifier}, stats{samples,consumed,errors}, at}` — مصدر الحقيقة للهاتف |
- الويبفيو (desktop-bridge): `get/set → tauriInvoke("tablet_config"/"tablet_config_set")` ثم بث الحالة. أوامر Tauri مسجّلة في main.rs. الإعدادات تشغيلية (بلا تخزين — تُضبط من الهاتف في كل جلسة، موثق).

### 20.د الضغط→الفرشاة (وضع الماوس المطلق) — محرك input_exec النقي
- تكميم الضغط إلى `levels` مستوى (افتراضي 24) — تغيّر المستوى أثناء الضربة يُحقن عبر التقنية المهيأة: **keys** (افتراضي: `[` تصغير `]` تكبير — Krita/Photoshop) أو **scroll** (عجلة ±نقرة مع معدّل اختياري none/ctrl/alt/shift) أو off.
- ضمانات: أول عينة تُرسي المستوى المرجعي بلا حقن · سقف 4 خطوات لكل عينة · إيقاع ≤33 حقنة/ث (الإيقاع الممتلئ لا يهمل الخطوة — العينة التالية تعيد بأحدث مستوى latest-wins) · الضغط للقلم/الممحاة حصرًا (ضغط الإصبع بلا معنى فيض) · hover لا يغيّر السماكة · نهاية الجلسة تفرغ الحالة (بلا أثر معلق).
- وضع اللوحة الافتراضية (لينكس): الضغط أصيل للتطبيق عبر ABS_PRESSURE — بلا تقنية مفاتيح.

### 20.هـ الالتقاط في الهاتف + التحقق
- **خام 240Hz**: `PlatformDispatcher.onPointerDataPacket` بسلسلة فوق callback إطار العمل (يُعاد عند الإغلاق) — كل عينة ينتجها المحرك قبل أي تجميع إطاري، بضغط/ميل/اتجاه كاملة. تجميع ذكي (PenSampler): hover الأحدث-يغلب، تلامس بالترتيب، إزالة المكرر المكمم — تفريغ كل 4ms، **داتاجرام واحد لكل حدث (§18 حرفيًا)**.
- **رفض راحة اليد**: الأصبع يُرفض افتراضيًا (خيار معاكس)، وجهاز واحد نشط (قلم ثانٍ مرفوض) — والأصبع بلا ضغط فرشاة عند تمريره. المعاينة المحلية فورية (قبل الشبكة) بسماكة = الضغط، سقف رسم 80fps، وطبقة معاينة قابلة للإطفاء.
- **تنفيذيًا**: live-verify **64/64** (أداة flags بكل القيم + توافق §18 bit0 + الفرشاة النقية: تكميم/خطوات/دخان ضربة كامل على Xvfb) — tablet-verify **55/55** (تخطيط uinput_user_setup بالإزاحات + دفعة كل طور + انتقالات الأداة بالترتيب + الميل/الضغط/المواضع + NaN/∞ + تنقية الإعدادات بالرفض الكامل + بوابة الجلسة/التوفر/التدهور الرشيق — build.rs يجرد #[tauri::command]) — enigo-verify **28/28** بلا انحدار.
- **تعاقديًا**: E2E §20 (قسم 14 أدناه) + القاموسان tablet.* (34×2). **القيود الصادقة**: هدف <25ms يقاس بمعيار §18 (حدث قلم مفرد P95=13ms على أبطأ بيئة مثبتة — الهامش يغطي التجمع 4ms والحقن)؛ المعاينة المحلية فورية لا تقاس بالشبكة. الحقن الفيزيائي على /dev/uinput واختبار النجاح الميداني (Krita من هاتف حقيقي بقلم) موثق خطوة-خطوة في e2e-checklist §14 — الحاوية بلا جهاز.

## 21. التحكم المتقدم — جيمباد الحساسات + الماوس الهوائي المعاير + عارض العروض (الجولة 4 مرحلة ③ — مصدر: gyro.rs + gyro_core.rs + live_core.rs + input_exec.rs + remote-bridge.ts + desktop-bridge.tsx + live_channel.dart + gyro_screen.dart + controller_service.dart)

> «أكمل ثلاثية التحكم المتقدم فوق NexusLive»: تلعب بجيروسكوب هاتفك بمفاتيح قابلة للتعيين وقوالب جاهزة، وتشير بماوس هوائي معاير بفلتر بسيط بلا AI، وتقلّب عرض PowerPoint بإيماءة المعصم الكلاسيكية مع مؤقت يهتز عند الانتهاء. كل شيء فوق حزم TYPE_GYRO التعاقدية (§18 حرفيًا — لا بروتوكول موازٍ) وعبر محرك الإدخال القائم حصرًا (القاعدة الذهبية).

### 21.أ الطرق العملية الموثقة (اختيار حقن «أسهل طريق موثق»)
- **الجيمباد = حقن كيبورد** (ليس ViGEm): أزرار افتراضية A·B·X·Y·L·R تُحقن ضغط/إفلات مفاتيح كيبورد حقيقية عبر apply_key (§13) — يعمل مع كل الألعاب بلا سائق ولا توقيع. ضغط مستمر حقيقي (state=press/release — يوسّع apply_key توافقًا أماميًا: الغياب = click كما كان)، لأن النقرة السريعة تُفقد بين إطارات استطلاع الألعاب. خرائط مفاتيح قابلة للتعيين لكل زر (حرف ASCII مرئي 33..126 أو مفتاح مسمّى من بياض: up/down/left/right/space/enter/esc/tab/shift/ctrl/pageup/pagedown/home/end/f5/f11) + **قوالب جاهزة**: platformer (A=مسافة قفز · Y=shift ركض · ZXCV) · racing (A=مسافة فرامل يد · rcqv e) · fighting (ZXCV + أسهم من العصا) — نقاط انطلاق، وكل مفتاح يُعاد تعيينه (القالب يصير custom).
- **عصا التقليب = زاوية الجاذبية لا معدل الدوران** (ملاحظة ميدانية): معدل الجيروسكوب يعود صفرًا مع ثبات الإمالة فتنطلق المفاتيح؛ الزاوية المطلقة من التسارع (atan2) هي المرجع الكلاسيكي المستقر. محاور موقّعة (axis_step): roll→يمين/يسار · pitch→أسفل/أعلى، **نافذة ميتة قابلة للضبط** (5..45°، افتراضي 18°) بهيستيريسيس (دخول > عتبة · خروج < 0.6×عتبة — بلا رجفان)، أرضية استواء 81 milli-g (الاستواء لا يحدد الاتجاه — قيد موثق).
- **الماوس الهوائي = دمج معدل الدوران** (المعكوس الصحيح): صفير معاير (متوسط 12 عينة ≈ 120ms أثناء سكون اليد — يزيل انحياز المستشعر ووضع اليد) + فلتر EMA α=0.55 (تجاهل الاهتزاز — بسيط بلا AI) + نافذة ميتة للهز (3..30°/s، افتراضي 8) + حساسية 0.5..5× (بكسل/درجة 18×حساسية) + قص ±500 بكسل (حاجز §18 طرفين) + dt مقصوص 1..50ms (العينات المفقودة لا تُضخّم). **بوابة الإمساك**: لا حركة إلا والزر مضغوط (تحريره يجمد المؤشر وينسى المعدل — لا قفزة عند العودة).
- **المؤشر الليزر = Ctrl+L الأصلي في PowerPoint** (أسهل طريق موثق): زر الليزر في الهاتف يحقن rc:key {ch:'l', modifiers:['ctrl']} عبر المسار القائم (§13) — في وضع العرض يبدّل PowerPoint مؤشر النظام إلى نقطة ليزر حمراء تتبع حركة الماوس (الإمساك=أشر أثناء العرض). العارضات الأخرى: يتحرك المؤشر فقط (موثق بصدق).
- **المؤقت + الاهتزاز = هاتف بالكامل**: عدّ تنازلي مرئي (دقائق ±60ث، بدء/إيقاف/تصفير) بلا أي اعتماد شبكي، وعند الصفر نمط HapticFeedback (3 دفعات قوية + نبضة) — بلا حزم ولا حزم رد.
- **إيماءة العارض = إمالة معصم موقّعة**: roll يتجاوز العتبة (10..60°، افتراضي 28°) ثم يعود لنصفها → next/prev (PageDown/PageUp عبر apply_presenter §13 حرفيًا) بتبريد 650ms ضد الإيماءات المتلاحقة؛ التسليح قبل الإطلاق يمنع الطلقات العرضية.

### 21.ب البروتوكول — امتداد flags لحزمة gyro (توافق أمامي كامل مع §18)
- **flags bits0-5 = أزرار الجيمباد** `A·B·X·Y·L·R` (bit0=A … bit5=R — مضغوط=1) · **bit6 = الإمساك (`FLAG_GRAB` 0x40)** (بوابة حركة الماوس/الليزر) · bit7 محجوز. **الحالة الكاملة كل عينة** (دلالة حية ذاتية التصحيح ضد فقد حزمة — عقد §18 نفسه): حواف الضغط/الإفلات تحسب عند المستهلك من مقارنة الحالات.
- الحمولة 12B كما هي عقد §18: ax·ay·az (milli-g) · gx·gy·gz — **الوحدة الفعلية milli-rad/s** (rad/s × 1000 كما تنتجها sensors_plus؛ مدى ±32.7 rad/s يغطي أسرع دوران معصم بلا قص). تصحيح توثيقي: كانت §18 تكتب «milli-dps» خطأً — الرقم المرسل دائمًا rad/s×1000 (تعارض توثيقي خام كان نائمًا ولا يظهر إلا عند أول مستهلك رقمي — صُحح هنا؛ 100Hz هدف البث، الوضع النشط حصرًا).
- الجسر لا يفكك flags للجيروسكوب — يمرر خامًا (لا تغيير عند 3004/3010). encode_gyro_flags مضافة في live_core (القديمة encode_gyro تفوض بـ flags=0 — توافق محركات التحقق القائمة).

### 21.ج أحداث socket.io (جسر 3004 — تنقية جديدة، نمط §20.ج حرفيًا)
| الحدث | الاتجاه | الحمولة (بعد التنقية) |
|---|---|---|
| `rc:gyro:cmd` | هاتف→الكمبيوتر | `{cmd: get\|set, mode?, template?, deadzoneDeg?, sens?, shakeDegS?, tiltDeg?, laser?, calibrate?, keyA?..keyR?}` — جلسة نشطة من هاتف موثوق حصرًا (بوابة live-hello نفسها). set: `mode ∈ off\|gamepad\|airmouse\|presenter` · `template ∈ platformer\|racing\|fighting\|custom` · أرقام محدودة المدى · مفاتيح ASCII مرئي واحد أو مسمّى من البياض · `laser/calibrate` منطقيان — **الفاسد يُرفض كله لا جزئيات** |
| `rc:gyro:state` | الكمبيوتر→الجميع (دور pc حصرًا) | `{mode, template, deadzoneDeg, sens, shakeDegS, tiltDeg, laser, map{A,B,X,Y,L,R}, stats{samples,packets,keyEdges,moves,gestures,calibrations}, calibrated, calibrating, at}` — مصدر الحقيقة للهاتف |
- الويبفيو (desktop-bridge): `get/set → tauriInvoke("gyro_config"/"gyro_config_set")` ثم بث الحالة. أوامر Tauri مسجلة في main.rs.
- **الدمج الجزئي فوق القاعدة الحالية**: المرسل فقط يُرقّع — بما فيها خريطة القالب المخصص (تحفظ عبر الدمج؛ probe يحمل مفاتيحه حصرًا حين يكون القالب custom). قالب صريح يعيد بناء الخريطة من قالبِه ثم يرقّع المفاتيح الصريحة.

### 21.د المستهلك على القناة الحية — بلا مسار حقن موازٍ
- `live.rs absorb → gyro::consume_gyro(flags, ax..gz)`: وضع off/بلا جلسة → إحصاء فقط (سلوك §18). وضع نشط → ترجمة لأحداث قياسية (key press/release · move · presenter) تُلحق **بنفس الدفعة** → coalesce (latest-wins للحركة — لا نمو كمون) → input::execute_sync (بوابة §13 + التدقيق + قياس الكمون §18 كاملان).
- **لا مفتاح عالق أبدًا**: نهاية الجلسة (input.rs ResetDrag) تستدعي gyro::session_ended() وتحقن الإفلاتات داخل خيط enigo؛ تغيير الوضع أثناء ضغط يفكك عبر المسار القائم (desktop-local — المالك) حتمًا.
- الأوضاع: gamepad (أزرار بحواف + عصا) · airmouse (إمساك+صفير+فلتر) · presenter (إيماءة بتبريد + ليزر بالإمساك).

### 21.هـ الالتقاط في الهاتف + التحقق
- **بث 100Hz نشط حصرًا**: `GyroStream` يدمج آخر تسارع مع كل نبضة جيروسكوب (samplingPeriod 10ms) ويرسل عبر sendGyro بالأزرار الحية — فقط حين (وضع مفعل من الكمبيوتر + جلسة نشطة + قناة حية). مغادرة الشاشة تطفئ الوضع على الكمبيوتر (لا مستهلك معلق).
- **واجهة الأوضاع الثلاثة**: رقائق حالة (جلسة/قناة/RTT/معايرة) + اختيار الوضع (مصدر الحقيقة يعود من الكمبيوتر) + أزرار جيمباد مستمرة الضغط بمفتاحها المعروض + ورقة مفاتيح لكل زر + زر إمساك كبير + زر معايرة + أزرار عرض (F5/Esc/تنقل/شاشة سوداء/ليزر) + مؤقت بصري يهتز. أزرار القوالب الثلاثة بلمسة واحدة.
- **تنفيذيًا**: gyro-verify **70/70** (تعاقد flags دائرة كاملة عبر encode_gyro_flags/parse · القوالب والتنقية بالرفض الكامل والدمج الجزئي فوق القاعدة المخصصة · عصا axis_step بالهيستيريسيس بلا رجفان ولا مزدوج · رياضيات الهواء صفير/فلتر NaN-حصين/إشارات/قص/dt · إيماءة تسليح-إطلاق بالاتجاهين · المستهلك الزمني الكامل: بوابتان، حواف، فقد حزمة يصححه التالي، معايرة 12 عينة، إمساك بوابة، تبريد، تفكيك حتمي عند نهاية الجلسة وتغيير الوضع عبر desktop-local) + اختبارات الوحدة **12/12** + دخان Xvfb (apply_key press/release حقيقي عبر enigo) — enigo-verify **28/28** · live-verify **64/64** · tablet-verify **56/56** بلا انحدار.
- **تعاقديًا**: E2E §21 + القاموسان gyro.* (52×2). **القيود الصادقة**: الماوس الهوائي من معدل مدمج ينحرف ببطء في الجلسات الطويلة جدًا (المعايرة + الإمساك المتقطع تحكمه — واقع كل ماوس هوائي بلا تصحيح بصري)؛ عصا التقليب تشبع قرب ±85° عند الاستواء؛ الليزر Ctrl+L خاص بـ PowerPoint (2010+) — بقية العارضات مؤشر فقط؛ حقن الكيبورد لا يغطي ألعاب تقرأ DirectInput الخام حصريًا (نادرة — قيد موثق). اختبار النجاح الميداني (لعبة بقوالب الجيمباد من هاتف حقيقي + PowerPoint بإيماءة المعصم) موثق خطوة-خطوة في e2e-checklist §15 — الحاوية بلا جهاز.

---

## 22. الأجهزة الافتراضية الكاملة + بث الوسائط + سلسلة الهاتف→TV (المرحلة 0-وسائط — مصدر: media.rs + media_core.rs + media-bridge.ts + media-store.ts + cast-tab.tsx + src/app/tv/page.tsx + tools-view.tsx + installer-hooks.nsh + vcam/)

> الهدف التعاقدي: Zoom/Meet يرى «NexusLink Camera» بلا أي خطوة يدوية، والميكروفون الافتراضي له إعدادات وتشخيص، وفيديو الهاتف يعمل في مشغل سطح المكتب الافتراضي، وسلسلة هاتف→TV موثقة بالوضع المدعوم فعليًا، وحالة كل جهاز افتراضي (مثبت/غير مثبت/نسخته) في لوحة الأدوات والتشخيص. **كل الحقائق أسفلها متحققة من مصدر akvirtualcamera 9.3.1 الحرفي** (cmdparser.cpp + installscript.nsi + preferences.cpp + package_info.conf.in) وwin-dshow من OBS — لا حقائق مُختلقة.

### 22.أ الكاميرا الافتراضية — أساس مفتوح قابل للتوزيع مع المثبّت
- **الحزمة**: مثبّت akvirtualcamera الرسمي **غير المعدَّل 9.3.1** (GPL-3.0 — NSIS رسمي، `requiresAdminRights=true`) ملتزم في `apps/desktop/src-tauri/vcam/` مع `LICENSE-akvirtualcamera` (COPYING حرفي) + `README.md` (المصدر + SHA256 + الأسباب) + `SHA256SUMS.txt`. توزيع النسخة الرسمية مع رخصتها ورابط مصدرها = توزيع GPL سليم (نمط vdd/MIT في §19).
- **تثبيت وقت تثبيت NexusLink** (installer-hooks.nsh — غير حاجز، ويندوز 64-بت حصرًا): `POSTINSTALL` يشغّل المثبّت بصمت `/S` (NSIS معياري)، ثم **يُنشئ كاميرا «NexusLink Camera» بمعرف ثابت** `NexusLinkCam`: مسار AkVCamManager يُقرأ من السجل `HKLM\SOFTWARE\Webcamoid\VirtualCamera\installPath` (المثبّت الرسمي يكتبه — installscript.nsi حرفيًا) ثم `add-device -i NexusLinkCam "NexusLink Camera"` + `add-format NexusLinkCam YUY2 1280 720 30` ×3 صيغ (1280×720/1920×1080/640×480 @30 — YUY2 الأوسع دعمًا وتطابق مسار stream القائم) + `update`. إزالة التثبيت تترك الكاميرا (جهاز نظام — مثبّت akvirtualcamera هو من يزيلها عند إزالته؛ موثق بصدق).
- **ضمانة وقت التشغيل (idempotent)**: `provision_camera_now()` قبل كل بدء ويب كام — تقرأ `devices -p` (معرف لكل سطر — cmdparser.cpp parseable) + `description ID` لكل معرف؛ إن لم يوجد وصف «NexusLink Camera» تُنفّذ خطة `ensure_camera_plan` (أوامر argv مهيكلة — **الوصف وسيط واحد لأن addDevice يقرأ args[1] حصرًا** — خلل مقسوم-بمسافات اكتُشف قبل الدفع) عبر `add-device -p` (يرد المعرف) → `add-format @NEW@ …` → `update`. لا `load` المدمر (يمسح كل أجهزة المستخدم) — إضافة فقط بجانب أجهزته.
- **كشف المسار**: السجل أولًا (`reg query … installPath` → `$DIR\x64\AkVCamManager.exe`) ثم المسارات المعروفة (أُضيف `C:\Program Files\AkVirtualCamera\x64\` تخطيط المثبّت الرسمي — installscript.nsi: `$INSTDIR\$arch\AkVCamManager.exe`). **النسخة من `-v`** (يطبع COMMONS_VERSION) والواجهة من `system-api`.
- **`media_vcam_install`** (Tauri): للمثبتات/الحزم التي فاتها التثبيت — يتحقق من بصمة المثبّت عبر `certutil -hashfile SHA256` (مطابقة `VCAM_INSTALLER_SHA256` — رفض عند الاختلاف)، يشغّله عبر `powershell Start-Process -Verb RunAs -Wait` (موجة UAC واحدة)، ثم يوفّر الكاميرا فورًا ويعيد الحالة. ماك: يفتح pkg الرسمي (المستخدم يكمل — قيود توقيع CoreMediaIO §3 round4-audit). لينكس: خطأ صادق (v4l2loopback من مستودعات النظام).
- **بديل OBS مكتشف تلقائيًا**: `obs_installed()` بوجود obs64.exe (`Program Files\obs-studio\bin\64bit\` / ماك: `/Applications/OBS.app`) — الحالة تعرض ملاحظة التوجيه (Media Source → Start Virtual Camera). **CLSID كاميرا OBS لا يصلح علامة كشف**: يُحقن وقت بناء OBS (virtualcam-guid.h.in VIRTUALCAM_GUID من cmake — حرفي) — موثق بصدق.

### 22.ب الميكروفون الافتراضي — منهجية الكاميرا نفسها + إعدادات
- كشف VB-CABLE (ويندوز «CABLE Input») / BlackHole (ماك) / module-pipe-source (لينكس) القائم (§15) بلا تغيير. **صادق**: لا يوجد درايفر صوت افتراضي مفتوح قابل للتوزيع على ويندوز يُتحقق منه حرفيًا — VB-CABLE (مجاني) يبقى البديل المكتشف، ويوثق ذلك في اللوحة.
- **إعدادات في لوحة الأدوات**: تبويب «الأجهزة الافتراضية» — حالة الميكروفون + إرشاد التثبيت + `media_open_sound_settings` (ويندوز `ms-settings:sound` معياري · ماك Sound.prefPane · لينكس pavucontrol أفضل مجهود).

### 22.ج التشخيص — حالة كل جهاز افتراضي
- `media_vcam_status` → JSON موسع (v2): `video{driver,ok,guide,version,api,devices[],obs{installed,note}}` + `audio{driver,ok,guide}` + `loopback{devices,version}` (لينكس — النسخة من `modinfo -F version v4l2loopback`) — **لا نسخة إلا المقروءة من الأداة فعلًا** (بلا اختراع). حقول v1 محفوظة (settings-view).
- لوحة الأدوات: تبويب «الأجهزة الافتراضية» (كاميرا: مثبت/غير مثبت + نسخة + واجهة + الأجهزة المسجلة + OBS + زر تثبيت الحزمة · ميكروفون: حالة + إرشاد + إعدادات الصوت). تبويب التشخيص: فحصا `vcam`/`vmic` مضيفان إلى قائمة الفحوص (نمط vdisplay §19 حرفيًا).

### 22.د بث الوسائط — «stream مؤقت» في مشغل سطح المكتب الافتراضي
- **`media_open_player(url, name)`**: تنقية صارمة (http حصرًا — محلي/شبكة · طول ≤2048 · بلا أسطر/محارف خطرة) → كتابة `nexuslink_cast_m3u(name,url)` إلى `%TEMP%\nexuslink-cast.m3u` (تعقيم أسطر الاسم — 3 أسطر حصرًا: #EXTM3U/#EXTINF/-url) → فتح بالمعالج النظامي (`cmd /C start ""` / `open` / `xdg-open`). m3u ملف معياري تدعمه VLC/WMP/mpv كتيار HTTP — **بلا نسخ بايتات** (نفس تيار /api/preview ذي HTTP Range).
- زر «افتح في مشغل النظام (stream مؤقت)» في بطاقة مشغل NEXUS-PC (cast-tab — نافذة Tauri حصرًا).

### 22.هـ سلسلة الهاتف→TV — الوضع المدعوم فعليًا (بصدق)
- **`cast:state`** (جسر 3005 — بث شفاف قائم): مرسل الكمبيوتر (media-store) يعلن عند كل تغيّر: `{active, media{device,path,name,kind}, target, sender, playing, position?, volume, muted, at}` — الموضع مقيّد (فقط >1 ثانية فرق). `active:false` عند النهاية.
- **صفحة `/tv`** (`src/app/tv/page.tsx` — مستقلة بلا مخزن): تسجل دور `tv`، تبني `GET /api/preview?device&path` من الحالة، تطبّق playing/position/volume/muted، وتستجيب لـ `cast:cmd` {toggle/seek/volume/mute/stop} الموجه لهدف `tv`. **السلسلة المدعومة**: هاتف (مكتبته عبر الحاسوب) → جسر → أي شاشة بمتصفح على الشبكة المحلية تفتح `http://<ip-الكمبيوتر>:3000/tv`. نافذة Nexus-TV داخل التطبيق معاينة دائمة. **Chromecast الأصلي (mDNS/cast protocol) غير مدعوم** — قيد موثق، و/tv هو البديل المكافئ عمليًا.

### 22.و التحقق
- **media-verify 78/78** (كان 38): +40 فحصًا — خطة التوفير (idempotent/وسيط-الوصس-واحد/@NEW@/لا-load) · فك installPath من reg (حالات/فاسد/فاضي) · تخطيط المسارات الرسمي أولًا · النسخة -v (سليمة/بادئة/فاسدة) · OBS (موجود/غائب) · m3u (ترويسة/اسم معقّم/رابط/3 أسطر) · الحالة v2 كاملة (نسخة/واجهة/أجهزة/OBS/v1 محفوظة/loopback لينكس-عن وغيره-null/إرشاد ماك) · ثوابت التعاقد (الاسم/3 صيغ YUY2/افتراضي 720p30). محرك التطبيق الكامل (media.rs) ترجمة CI حصرًا (نمط R4-s2).
- **E2E §22**: تمرير cast:state عبر الجسر (pc→tv) + صفحة /tv (200 + علامات الاستقبال) + vcam/ في الموارد + hook §22 في installer-hooks.nsh + أوامر §22 الثلاثة في main.rs + media_open_player في cast-tab + تبويب/فحوص الأجهزة الافتراضية + توثيق العقد + القاموس.
- **اختبار النجاح التعاقدي** (e2e-checklist §16): مكالمة Meet على كمبيوتر بكاميرا حقيقية → «NexusLink Camera» من قائمة Meet مباشرة — الخطوات الميدانية موثقة؛ الحاوية بلا ويندوز/هاتف (نمط §14/§15/§16).

## 23. إصدار 1.1.0 — توحيد الإصدار + ملاحظات AR/EN + المحدّث + مسار الترقية (مصدر: release.yml + docs/releases/v1.1.0.md + src/lib/db.ts + procman.rs + updater.rs)

> الجولة 4 اكتملت فوق 1.0.0 (§18..§22) — هذا القسم عقد إطلاق الإصدار: رقم موحّد،
> ملاحظات ثنائية اللغة، أصول موقّعة من الخط الأخضر نفسه، ومسار ترقية يحفظ كل إعداد.

### 23.أ توحيد الإصدار — الملفات الستة
- **1.1.0** في: `package.json` (الجذر) · `apps/desktop/src-tauri/tauri.conf.json` (`version`) ·
  `apps/desktop/src-tauri/Cargo.toml` (+Cargo.lock للكرِيت نفسه) · `nexuslink_mobile/pubspec.yaml`
  (`1.1.0+2` — versionCode تقدّم 1→2 لمسار ترقية APK صحيح) ·
  `nexuslink_mobile/android/app/build.gradle` (fallback `flutterVersionName`).
- `src/app/api/version/route.ts`: `CURRENT = "1.1.0"` + سجل محلي يحوي v1.1.0 وv1.0.0 (أوفلاين بصدق).
- `updater.rs`: User-Agent من `concat!("NexusLink-Desktop/", env!("CARGO_PKG_VERSION"))` —
  بلا إصدار مثبت يدويًا (توحيد وقت الترجمة).
- `release.yml`: `env.VERSION = "1.1.0"` + وسم الإرفاق اليدوي الافتراضي `v1.1.0`.
- قاعدة §3 round4-audit (قفل v1.0.0) كانت حصرًا أثناء تطوير الجولة — الإطلاق أمر المستخدم الصريح.

### 23.ب ملاحظات الإصدار — عربية/إنجليزية إلزاميتان لكل وسم
- **`docs/releases/<tag>.md`** — قسم `## العربية` ثم `## English` (يقرؤه حارس release.yml).
- **حارس مبكر** في مهمة `release`: وسم بلا ملف ملاحظات أو بلا أحد القسمين = فشل قبل أي رفع.
- `softprops/action-gh-release` مع `body_path: docs/releases/${{ github.ref_name }}.md` —
  ملاحظاتنا تُسبق ملاحظات الوسوم المولّدة (`generate_release_notes: true` يبقى للسجل).
- محتوى v1.1.0 = ميزات §18..§22 الحرفية + هندسة الإصدار + الحدود الصادقة (ماك pkg يدوي،
  Chromecast غير مدعوم → /tv، Wayland، SmartScreen، iOS) — بلا ميزة غير مشحونة.

### 23.ج latest.json + SHA256SUMS — الخط الأخضر نفسه (بلا تغيير بنيوي)
- على وسوم `v*`: مهمة `release` تبني `latest.json` من توقيعات البناء (`*.sig`) للمنصات
  الثلاث (`windows-x86_64` ← x64-setup.exe · `linux-x86_64` ← AppImage · `darwin-aarch64` ← .app.tar.gz)
  + `SHA256SUMS.txt` (sha256sum *) → **Release مسودة** بأصول كل المنصات (APK/AAB أندرويد منها).
- **نشر المسودة شرط ظهور التحديث**: نقطة الفحص `releases/latest/download/latest.json` لا تحسم
  إلا إصدارًا **منشورًا** (المسودات والمسبقات مستبعدة من GitHub) — وُثّق في runbook §23.هـ.
- مسار توقيع محلي بديل (لأزمات CI): `scripts/build-latest-json-v1.1.0.sh` — نمط v1.0.0
  (minisign عبر tauri CLI، معرف الإصدار يُكتشف من الوسم عبر API، حذف الأصل فور التوقيع).

### 23.د مسار الترقية 1.0.0 → 1.1.0 — «بلا تلف أي إعداد»
- **قاعدة المستخدم لا تُمس**: `procman.rs` يزرع `app_config_dir/nexuslink.db` عند أول إقلاع
  حصرًا (`if !db_path.exists()`) — التحديث يستبدل ملفات التطبيق لا قاعدة المستخدم.
- **المخطط إضافي حصرًا منذ v1.0.0**: `git diff v1.0.0..HEAD -- prisma/` = إضافة `DesktopSetting`
  (11 سطرًا) بلا أي حذف/تعديل؛ مخطط drift المحمول (`nexuslink_mobile/lib/data/database/`) ثابت.
- **ضمان وقت الإقلاع** (`src/lib/db.ts` — `ensureUpgradeSchema`): `CREATE TABLE IF NOT EXISTS
  "DesktopSetting"` إضافيًا بلا DROP/ALTER — ومسار الإعدادات (`desktop-hardening.ts`) ينتظر
  `dbReady` قبل أول قراءة/كتابة. قاعدة 1.0.0 الفعلية تعمل بعد الترقية بإعداداتها القديمة سليمة.
- **قرار الفحص**: `tauri-plugin-updater` يقارن semver — 1.0.0 < 1.1.0 → إشعار «يتوفر تحديث موقّع»
  من الإعدادات/الإقلاع؛ التساوي → «أنت على الأحدث» (لا حلقة ترقية ولا تخفيض).
- **التحقق الفعلي**: `scripts/updater-path-verify.mjs` — نقطة الفحص الحية + فك توقيعات latest.json
  المنشورة ومطابقة keynum مع pubkey tauri.conf + تنزيل أصل حقيقي وتدقيق Ed25519 + SHA256SUMS
  على البايتات + جرد أصول v1.0.0 + **محاكاة ترقية قاعدة v1.0.0 الحرفية** (من مخطط الوسم بـ
  `prisma db push` + صف بيانات قديم) ثم إقلاع سيرفر 1.1.0 عليها: الإعدادات تعمل والصف سليم.
- **الاختبار الميداني** (e2e-checklist §17): تثبيت 1.0.0 → إشعار التحديث → ترقية موقّعة إلى
  1.1.0 → كل الإعدادات والأجهزة المقترنة والسجلات كما كانت.

### 23.هـ Runbook إطلاق v1.1.0 (بترتيب صارم)
1. دمج الجولة على main + انتظار desktop.yml الأخضر (3/3 منصات).
2. `git tag v1.1.0 && git push origin v1.1.0` → release.yml يبني 5 منصات وينشئ **مسودة** Release
   بأصولها + latest.json الموقعة + SHA256SUMS + ملاحظات docs/releases/v1.1.0.md.
3. مراجعة المسودة: الأصول الثمانية العشرة + التوقيعات — ثم **Publish** (النشر شرط ظهور التحديث).
4. التحقق بعد النشر: `releases/latest/download/latest.json` تعيد `1.1.0` (updater-path-verify
   يفحص هذا تلقائيًا) — مستخدمو 1.0.0 يرون إشعار التحديث عند إقلاعهم التالي.

---

## 24. هاتف→هاتف عبر المركز — التحكم عن بُعد بين هاتفين (الجولة 5 — مصدر: guard-bridge.ts + nexuslink_mobile/lib/core/protocol.dart + phone_remote_service.dart + phone_remote_screen.dart + phone_remote_providers.dart + media_service.dart (المرآة) + native_bridge.dart + ScreenShareService.kt + MainActivity.kt + use-media-bridge.ts)

### 24.أ الأدوار والمسار — بروتوكول واحد لا بروتوكول موازٍ
- **الهاتف أ (المتحكم)** و**الهاتف ب (الهدف)** كلاهما وكيل على جسر الحماية 3006 بنفس تسليم
  `guard:hello-phone` الحرفي (via gateway `?XTransformPort=3006` أو مباشر) — المركز (سيرفر سطح
  المكتب) **يوجّه حصرًا** ولا ينفذ شيئًا بنفسه. أسماء أحداث FA-7 على الويب هي نفسها على الهاتف:
  `p2p:ctl-start/ctl-stop` للجلسة، و`dev:touch/dev:text/dev:key/dev:touch-ack/dev:ctl-state/dev:ctl-stop` للتنفيذ —
  فكل تنفيذ قائم على الهاتف ب (NexusAccessibilityService::dispatchGesture) يبقى كما هو حرفيًا.
- `P2pEvents` (protocol.dart) يوثق الأسماء ثنائية الاتجاه — حاجز ثانٍ في وحدة التحكم:
  `if (targetId == deviceId) return` قبل أي إرسال، وبوابة `_state.sessionActive` على كل إدخال.

### 24.ب بوابة الثقة على الجسر (p2p:ctl-start — ترتيب الرفض الحرفي)
1. `identity` — المرسل يجب أن يكون الوكيل صاحب `from` نفسه (ربط هوية السوكِت بسجل agentsReg).
2. `untrusted` — الهاتف الطالب غير مقترن/غير موثوق في مخزن الأجهزة.
3. `target-untrusted` — الهدف غير مقترن/غير موثوق.
4. `self` — **لا هاتف يتحكم بنفسه أبدًا** (حاجز مزدوج: على الجسر وفي وحدة التحكم).
5. `target-offline` — الهدف مقترن لكن لا سوكِت حيًا له.
6. `already-controlling` — للطالب جلسة قائمة (متحكم واحد = جلسة واحدة).
7. `target-busy` — الهدف محكوم به من جلسة أخرى (لا تحكم مزدوج أبدًا).
الرفض يصل الطالب `p2p:ctl-rejected {reason, from, target}` — والواجهة تعرضه مترجمًا (p2p.rejectedReason).

### 24.ج دورة الجلسة الموثقة
- طلب موثوق → الهدف يستقبل `dev:ctl-start {from, name, p2p:true}` — **حوار «سماح» القائم في
  Kotlin يبقى كما هو حرفيًا** (لا شاشة تأكيد جديدة ولا بروتوكول موازٍ).
- موافقة صاحب الهدف = `dev:ctl-state {active:true, reason:"confirmed", controller, name}`
  (نفس emitCtlState الحرفية في AgentForegroundService؛ الرفض = active:false "denied").
- الجسر يبث الحالة للويب (مراقبة) **ويوجهها مستهدفًا للمتحكم** مضافةً `target` — الهاتف أ
  يرى `{active:true, target:<هدفه>}` ويقفل مرحلة session في واجهته.
- تسجيل الجلسة `p2pSessions[controller] = {targetDeviceId, controllerSocketId, targetSocketId}` —
  مصدر وحيد للتوجيه. `guard:agents {agents[], sessions[]}` يُبث بعد كل تسجيل/مغادرة للاختيار في الواجهات.

### 24.د توجيه الإدخال — الجلسة الموثقة حصرًا
- سوكِت **هاتف** (وكيل مسجل) يرسل `dev:touch/text/key` → مسار هاتف→هاتف حصرًا: جلسة موثقة
  مطلوبة وإلا `dev:ctl-rejected {reason:"no-session"}` — هذا ما يمنع تحكم الهاتف بنفسه أو بغيره
  عبر مسار الوكيل الأساسي. سوكِت **الويب** → المسار القائم إلى الوكيل الأساسي كما كان (سطح
  المكتب→هاتف لم يُمس).
- التنقية نفسها على المسارين: `TOUCH_OPS` (tap/long/swipe/scroll/down/move/up) · `KEY_ACTIONS`
  (back/home/recents/notifications/keyboard) · `clampCoord` (0..20000 بعُشر واحد) · حد معدل
  120 حدثًا/ثانية لكل عميل · نص ≤2000 حرف.
- `dev:touch-ack` من الهدف يبث للويب ويُوجّه للمتحكم الهاتفي حصرًا (عدادات الإقرارات في الواجهة).

### 24.هـ القطع الفوري من الطرفين (عقد الأمان)
- **من المتحكم**: `p2p:ctl-stop {target}` → `dev:ctl-stop {reason:"controller-stop"}` للهدف فورًا
  + حالة نهاية `{active:false, target}` للمتحكم + حذف الجلسة (الإدخال اللاحق مرفوض no-session).
- **انقطاع أي طرف** (teardownP2pForDisconnect): انقطاع الهدف → حالة `{active:false,
  reason:"target-disconnected"}` للمتحكم؛ انقطاع المتحكم → `dev:ctl-stop
  {reason:"controller-disconnected"}` للهدف — **لا جلسة يتيمة أبدًا**، والواجهة على الهاتفين
  تعيد الحالة الخاملة فورًا (disconnect الـ socket = نهاية الجلسة دائمًا).

### 24.و أبعاد الشاشة موسومة بمعرف المرسل (تعدد الوكلاء)
- `dev:screen {w,h,density}` من أي وكيل → الجسر يوسم `deviceId` (معرف المرسل نفسه) ويبث
  `guard:screen` — الهاتف أ يستقبل أبعاد **هدفه حصرًا** (فلترة deviceId في phone_remote_service)
  لتحويل الإحداثيات، والويب يقرأ الوكيل الأساسي كما كان.

### 24.ز المرآة — بث شاشة الهاتف ب إلى الهاتف أ (نفس إشارات §4.3/§15)
- على قناة الوسائط 3005: الناشر (هاتف ب) يعرض `rtc:offer {kind="mirror"}` والعارض (هاتف أ)
  يجيب `rtc:answer` — **أول إجابة تُقبل لكل جلسة (§4.3)** وICE يرحّل شفافًا (from="phone").
- الترتيب التعاقدي على أندرويد 14+ (targetSdk 34): **1)** `Helper.requestCapturePermission` —
  حوار موافقة النظام (شرط بدء FGS، بيانات الموافقة تُخزَّن داخل المكوّن) **2)** `startScreenShareService`
  — خدمة أمامية بنوع `mediaProjection` (ScreenShareService — `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`
  صريح، غير مُصدَّرة، إشعار دائم مع إيقاف صريح ACTION_STOP) **3)** `getDisplayMedia` يستخدم بيانات
  الموافقة المخزنة (بلا حوار ثانٍ). إيقاف المشاركة = تفكيك PeerConnection + إطفاء الخدمة.
- **الكمبيوتر ليس عارض المرآة إطلاقًا**: عارض الويب (use-media-bridge) يتجاهل `kind:"mirror"`
  في rtc:offer/rtc:ice حرفيًا — والكمبيوتر يقبل دور phone في الإشارات فقط كمرحّل شفاف.

### 24.ح حدود صادقة
- فيديو المرآة يمر ببث §4.3 القائم على الشبكة المحلية عبر المركز (نمط الكاميرا/الميكروفون نفسه
  — بلا تشفير جلسة إضافي)؛ **التحكم** هو ما يخضع لبوابة الثقة والتأكيد والقطع الفوري.
- الجلسة عبر المركز حصرًا (السيرفر حي) — بلا مسار P2P مباشر بين الهاتفين، وهذا مقصود: نقطة
  واحدة للثقة والتدقيق والقطع.
- عارض الهاتف أ يعرض الفيديو فقط؛ الإدخال يعمل حتى بلا فيديو بالإحداثيات المعروفة من
  guard:screen الموسومة (توثيق الواجهة الصادق: p2p.noMirrorHint).

## 25. مركز رفع القيود (Unblock Center) — «الإعدادات المقيّدة» أندرويد 13+ (الجولة 5 — مصدر: nexuslink_mobile/lib/presentation/unblock_center_screen.dart + MainActivity.kt (openAppDetails/restrictedSettingsStatus) + native_bridge.dart + control_screen.dart/settings_screen.dart (المسارُن))

### 25.أ المشكلة — سلوك نظام لا عطل
- منذ أندرويد 13 يحمي النظام خدمة الإتاحة القوية: التطبيقات المثبتة يدويًا (APK من خارج متجر)
  توضع في قيد **«الإعدادات المقيّدة»** فيصبح خيار تفعيلها رماديًا برسالة «الإجراء غير مسموح».
  NexusLink يُوزَّع APK — لذا أول تفعيل للتحكم اللمسي (FA-7/§13) قد يصطدم بالقيد على 13+.

### 25.ب الفحص — أفضل جهد صادق من مصدر AOSP الحرفي
- `AppOpsManager.checkOpNoThrow("android:access_restricted_settings", myUid, packageName)` —
  السلسلة الحرفية من AOSP `AppOpsManager.OPSTR_ACCESS_RESTRICTED_SETTINGS` (أندرويد 13+ حصرًا).
- الحكم بنفس منطق AOSP RestrictedPreferenceHelper: `restricted = mode != null && mode !=
  MODE_ALLOWED && mode != MODE_DEFAULT`. السلسلة `@SystemApi` غير متاحة على بعض النسخ →
  **checked=false بلا ادعاء** — والواجهة تعرض ملاحظة صادقة (unblock.detectLimitation) تفيد
  برسالة النظام «الإجراء غير مسموح» كدليل بديل.

### 25.ج الفك — خطوات مرة واحدة + أزرار مباشرة
1. **صفحة التطبيق**: زر يفتح `Settings.ACTION_APPLICATION_DETAILS_SETTINGS` مع `package:`
   مباشرة (openAppDetails) — أو يدويًا: الإعدادات ← التطبيقات ← NexusLink.
2. **قائمة ⋮** أعلى صفحة التطبيق → **«السماح بالإعدادات المقيّدة»** (قد يُطلب تحقق بصمة/وجه/PIN).
3. **تفعيل الخدمة**: الإتاحة ← NexusLink ← تفعيل + «سماح» — والواجهة تعيد فحص الحالة
   (restrictedSettingsStatus) فتصبح خضراء إن فُكّ القيد.

### 25.د الواجهة — نفس القاموس ونظام الاتجاهات
- `unblock.*` مفاتيح عربية/إنجليزية متوازية (نفس ملفات الترجمة — RTL تلقائي من نظام التطبيق) —
  مدخلان: شاشة التحكم (بعد رفض التفعيل) والإعدادات (إدخال دائم p2pEntry/unblock.title).
- الشرح يفسر **لماذا** (حماية النظام من التطبيقات الخبيثة المثبتة عنك) قبل **كيف** — والفك يدوي
  مقصود من النظام (لا يوجد مسار برمجي لإلغاء القيد — ذلك سلوك أمني أندرويد موثق).

---

## 26. محرك الروتينات — قواعد «عند حدوث X نفّذ Y» (الجولة 6 — مصدر: src/lib/nexus/automation-bridge.ts + automation-types.ts + automation-facts.ts + automation-persist.ts + productivity-bridge.ts (prodInjectClip + نشر الحقيقة) + src/app/api/automation/boot + src/lib/automation-socket.ts + src/lib/automation-store.ts + src/hooks/use-automation-bridge.ts + src/components/nexus/automation/automation-view.tsx)

> المنفذ **3008** داخل عملية Next (نمط guard-bridge، idempotent) — آخر منفذ فارغ في طوبولوجيا §1.
> المبدأ الحاكم: **لا بروتوكول موازٍ إطلاقًا** — كل الحقائق من مصادر قائمة، وكل الأفعال تعبر قنوات قائمة حرفيًا.

### 26.أ المشغلات التسعة (مصادر الحقائق) — الست اللحظية + الثلاثة التاريخية (§26.و)
| المشغّل | المصدر | الدلالة |
|---|---|---|
| `device.connect` / `device.disconnect` | سجل الأجهزة `store()` — استطلاع كل 4 ثوانٍ | انتقال حالة (متصل ↔ غير متصل) — حدّي بلا إطلاق مزدوج |
| `battery.below` | نفس الاستطلاع | حافة نازلة (الهبوط تحت العتبة) + إعادة تسليح تلقائية عند بلوغ العتبة +5 |
| `clip.received` | ناقل حقائق داخل العملية (`automation-facts.ts`) — جسر prod ينشرها في معالج `clip:push` القائم | وصول محتوى للحافظة الموحدة — **بلا أي تغيير سلكي** |
| `time.once` | مؤقت المحرك (كل 5 ثوانٍ) | طابع زمني epoch ms — يُطلق مرة واحدة |
| `time.daily` | نفس المؤقت | ساعة:دقيقة محلية — مرة واحدة يوميًا (تدوين اليوم المُطلق) |

- مرشّح الجهاز (`deviceId`) اختياري في المشغلات الجهازية — فارغ = أي جهاز.
- الإطلاق كله خاضع لمانع تكرار 20 ثانية لكل قاعدة (`COOLDOWN_MS`) في المسارين التلقائي واليدوي.
- المشغلات التاريخية الثلاثة (`health.battery.sustained` / `health.rtt.sustained` / `health.silence.sustained`) موثقة في §26.و — تقييمها من عينات مركز الصحة (§27) لا من اللحظة الحالية.

### 26.ب الأفعال الأربعة (كلها قنوات قائمة حرفيًا)
| الفعل | القناة المستعارة | ملاحظات |
|---|---|---|
| `notify` | حدث `auto:fired` لعملاء الواجهة | تنبيه فوري (toast) + سجل تشغيل — لا يلمس الهاتف |
| `clipboard.push` | `prodInjectClip()` → صف `prodClip` + حدث `clip:new` القائم | نفس مسار الحافظة الموحدة حرفيًا (mode=auto)؛ يقلع جسر prod عند الحاجة |
| `phone.ring` | `guardEmitToAgent("dev:ring", {at})` القائمة | يتطلب وكيل هاتف متصلًا بقناة الحماية — عدم الاتصال يُسجَّل فشلًا صادقًا؛ يقلع جسر guard عند الحاجة |
| `wol` | حزمة سحرية UDP بث `255.255.255.255:9` (6×0xFF + MAC ×16) | محلي الشبكة فقط؛ MAC يُعقَّم بنمط `XX:XX:XX:XX:XX:XX` صرامةً |

### 26.ج واجهة socket.io على :3008 (العملاء = واجهة الويب)
- عند الاتصال: `auto:hello` ثم `auto:state {rules, log, stats, bootedAt}` — وكل تغيير يعيد بث `auto:state` للجميع.
- `rule:upsert {rule, id?}` — تعقيم كامل: الاسم 1..80، أنواع المشغل/الفعل من القوائم المغلقة، العتبة 1..100، الطابع ≤ +366 يومًا، الساعة 0-23 والدقيقة 0-59، النص ≤300 حرفًا، MAC بنمط صارم — الرفض `auto:rejected {error}` مسبب.
- `rule:toggle {id, enabled}` · `rule:delete {id}` (ينظف حالات التسليح/اليوم/المرة/التسليح التاريخي) · `rule:run-now {id}` — تنفيذ يدوي صريح يُنفّذ حتى لقاعدة معطّلة (باب اختبار موثق)؛ **للمشغلات التاريخية**: run-now = قيّم من التاريخ الحالي — الاستيفاء يُطلق يدويًا **ويستهلك الحقبة** (منع إشعار مزدوج مع التيك)، وعدمه يسجّل رفضًا مسببًا (ok=false) في السجل · `log:clear`.
- الإطلاق يذيع `auto:fired {ruleId, ruleName, ok, detail, manual, at}` — تفصيل النتيجة لكل فعل مسجّل في `detail` بصدق (نجاح القناة أو سبب الفشل).

### 26.د الواجهة
- تبويب «الروتينات» في الـ dock (`ViewId=automation`، أيقونة Workflow) — وخطافه مركّب في جذر nexus-app فتعمل الروتينات وتظهر تنبيهاتها من أي تبويب.
- كارت لكل قاعدة (ملخص المشغل/الفعل + مفتاح تفعيل + تشغيل الآن + تعديل + حذف) + محرر Dialog (المشغل ثم حقوله الشرطية، الفعل ثم حقوله) + سجل تشغيل + إحصاءات (مفعّلة/تشغيلات اليوم/آخر تشغيل) + بطاقة حدود صادقة.
- المقبس `/?XTransformPort=3008` عبر البوابة (نمط كل الجسور §1) — وi18n مفاتيح عربية → EN في القاموس المشترك ar-en-map.json.

### 26.هـ حدود صادقة (موثقة بصدق)
1. **سجل التشغيل في ذاكرة الجسر** (آخر 80) — يبدأ نظيفًا عند الإقلاع؛ **القواعد نفسها مرسوخة في SQLite وتُستعاد حرفيًا (§26.ز)** — حذف قاعدة بذرية يبقى حذفًا وإحصاءات الإطلاق تعيش عبر إعادة التشغيل.
2. **مشغلات الأجهزة تقرأ سجل الأجهزة** (pair/forget/تغير الحالة المسجل) — لا نبض الوكيل الحي؛ حالة الوكيل الفعلية على قناة الحماية ليست مصدر هذا المشغل.
3. **أفعال الهاتف** تتطلب وكيلًا متصلًا، و**WoL** محلي الشبكة — كلاهما يفشل بسجل صادق لا بصمت.
4. لا قفل هاتف ولا مسح من الروتينات عمدًا — قناة FA-10 المشفرة لها بوابة ثقتها الخاصة ولا تُستدعى أتمتةً (قرار أمني متعمد).

### 26.و مشغلات الصحة التاريخية — «شرط مستمر لمدة» من عينات §27
> الربط بين المحركين: الروتينات (هذا القسم) تقرأ العينات المؤرشفة في `NexusHealthSample` (قسم §27) — مثال المالك المرجعي: **«نبّهني إذا كانت بطارية X تحت 15% لمدة ساعة»**.

| المشغّل | الحقول | الدلالة التاريخية |
|---|---|---|
| `health.battery.sustained` | `threshold` (1..100) · `durationMin` (1..1440) · `deviceId?` | البطارية ≤ العتبة **طوال المدة** وفق العينات المسجلة (كل العينات — آخر قيمة معروفة حتى أثناء الانقطاع) |
| `health.rtt.sustained` | `threshold` (10..60000ms) · `durationMin` · `deviceId?` | الاستجابة ≥ العتبة طوال المدة — **للعينات المتصلة فقط** (نمط §27: rtt المقطوع قيمة باقية) |
| `health.silence.sustained` | `durationMin` · `deviceId?` | لا عينات صحة خلال المدة لجهاز **معروف الإبلاغ** (له عينة داخل آخر 24 ساعة) — من لم يُبلّغ قط لا يُطلق صمتًا زائفًا |

- **سلسلة الدليل (البطارية/الاستجابة)**: المرساة = آخر عينة قبل بداية المدة (تثبت الشرط عند البداية) + كل عينات النافذة `[الآن − المدة، الآن]` مستوفية وعيناتها ≥ 2 + أطول فجوة بين عينات متتالية (ومن آخر عينة إلى الآن) ≤ التسامح `max(5 دقائق، المدة/4)` بسقف 60 دقيقة + المرساة ليست متقادمة (أقدم من المدة + 10 دقائق = دليل متقادم — الجهاز توقف عن الإبلاغ). أي خرق يمنع الإطلاق بتفصيل صادق في السجل.
- **التقييم**: تكة كل 15 ثانية داخل الجسر (`pollHealthSustained`) على القواعد المستمرة المفعّلة + باب `rule:run-now` (أعلاه). الاستعلام مفهرس `[deviceId, createdAt]` (فهارس §27) — بلا أي تغيير على مسار §27.
- **التسليح وإعادة التسليح**: القاعدة تُطلق **مرة لكل حقبة استمرارية** (`sustainedArmed` لكل قاعدة) — يظهر الشرط مستوفى والمسلّحة والمانع 20ث قد انتهى → إطلاق وتسليح؛ يظهر مخالف/غير مثبت → إعادة تسليح تلقائية، فلا فيض إشعارات أثناء استمرار الحالة نفسها.
- **التعقيم الإضافي**: `durationMin` 1..1440 (سقف الاحتفاظ 24h في §27) — خارج الحدود رفض `auto:rejected` مسبب.
- **الواجهة**: ثلاثة خيارات جديدة في محرر القاعدة بحقل «المدة (دقائق)» + شارة «تاريخي» على كارت القاعدة + بند في الحدود الصادقة.
- **حدود صادقة (إضافية على §26.هـ)**: (1) الدليل عينات §27 — جهاز لا يُبلّغ صحة (لا نبض ولا report) لا يمكن إثبات شرطه المستمر أبدًا؛ (2) المدة > 1440 دقيقة مرفوضة (تاريخ متاح 24 ساعة فقط)؛ (3) حساسية الكشف مرتبطة بكثافة العينات — **نبض الخدمة الذاتي (§27.هـ) يولّد عينة كل ~30 ث لكل جهاز ما دامت عملية الخادم تعمل** (إغلاق الواجهة لا يوقف التوليد)؛ إيقاف عملية الخادم نفسها يوقف التوليد مؤقتًا، والسلاسل تُقيَّم من التاريخ المحفوظ عند العودة (تسامح الفجوة هو الحكم)؛ (4) القواعد مرسوخة في SQLite وتُستعاد عند الإقلاع (§26.ز) — التاريخ والإحصاءات دائمة.

### 26.ز ترسيخ القواعد — SQLite عبر Prisma (مصدر: src/lib/nexus/automation-persist.ts + جدول NexusAutomationRule)
> إغلاق الحد السابق «القواعد بذاكرة الجسر»: نفس قاعدة §27 الحية (db/custom.db) بلا أي مخزن موازٍ — جدول `NexusAutomationRule` يُنشأ بنمط الترقية الآمنة §23 (`CREATE TABLE IF NOT EXISTS` في db.ts) فتعمل على أي قاعدة قديمة 1.0.0/1.1.0 بلا مساس بالبيانات.

- **التخزين**: صف لكل قاعدة — `id` = معرف القاعدة في الذاكرة نفسه (uid) + `name` + `enabled` + **`payload` = JSON كامل للقاعدة** (تسامح مستقبلي مع حقول مشغلات/أفعال جديدة بلا ترقية مخطط).
- **الكتابة (fire-and-forget)**: `rule:upsert` → upsert فور قبول التعقيم · `rule:toggle` → upsert بالحالة الجديدة · `rule:delete` → deleteMany (idempotent) · **كل إطلاق يرسي الإحصاءات** (`lastFiredAt`/`fireCount`) — فتعيش عبر إعادة التشغيل. فشل الترسيخ يُسجَّل في سجل الخادم بصدق ولا يمنع عمل القاعدة في الذاكرة.
- **الاستعادة عند الإقلاع (غير حاجبة)**: الجسر يقلع بالبذور فورًا ثم تستبدل الاستعادة غير المتزامنة القواعد حرفيًا عند جاهزية القراءة وتعيد بث `auto:state` — جدول فارغ (أول إقلاع) → البذور الحالية تُرسَّخ مرة واحدة (معرفاتها نفسها تُحفظ). إحياء كل صف بتحقق هيكلي خفيف (أنواع مغلقة/حقول أساسية) والصف التالف يُنقّى من القاعدة — صف فاسد واحد لا يُهلِك الإقلاع.
- **دلالات ما بعد الترسيخ**: (1) حذف قاعدة (حتى بذرية) يبقى حذفًا — البذور المحذوفة لا تعود عند الإقلاع؛ (2) موعد `time.once` طابعه في الماضي لحظة الإقلاع يُستهلك ولا يُعاد — الموعد الفائت أثناء التوقف لا يُطلق قديمًا؛ (3) مواعيد `time.daily` تعيد التسليح من التاريخ المحلي (إطلاق واحد يوميًا كحد أقصى كما قبل الترسيخ)؛ (4) حالات التسليح (البطارية/الاستمرارية) ذاكرة تُهيأ مسلّحة عند الإقلاع — أول تقييم يصححها من الواقع الحالي (حقبة استمرارية قائمة قبل التشغيل قد تُطلق مرة واحدة عند الإقلاع — سلوك موثق لا خفي).
- **الواجهة**: بند الحدود الصادقة يوثق الترسيخ + السجل وحده بذاكرة — بلا أي عناصر جديدة (الترسيخ شفاف للمستخدم).

## 27. مركز صحة الأجهزة — قياس زمني + تنبيهات (مصدر: src/lib/nexus/health.ts + src/app/api/devices/health/route.ts + src/components/nexus/health-panel.tsx)

> طبقة قياس **إضافية بحتة** — لا تعدل أي بروتوكول قائم: نبض `GET /api/devices`
> يظل كما هو حرفيًا، ومركز الصحة يقرأ حالته ويؤرشفها. أي وكيل قائم يعمل
> دون أي تغيير.

### 27.أ ما يُقاس ولماذا
- **العينات**: `NexusHealthSample {deviceId, battery, rttMs, online, createdAt}` — خانقة
  `SAMPLE_INTERVAL_MS = 30_000` لكل جهاز (النبضات الأسرع لا تضاعف العينات).
- **الاحتفاظ**: `RETENTION_MS = 24h` — تنقية دورية كل `PRUNE_EVERY_MS = 5min`
  (عينات + أحداث فوق 24 ساعة تُحذف) — تُغطي نوافذ العرض 1h/6h/24h.
- **العبورات (أحداث `NexusHealthEvent`)** — تُكتشف على كل نبضة/تكة force:
  | النوع | المستوى | شرط العبور | الصفاء |
  |-------|---------|------------|--------|
  | `offline` | warn | connected → غير connected | كل انتقال (edge-triggered) |
  | `online` | info | غير connected → connected | كل انتقال |
  | `low-battery` | warn | battery ≤ `LOW_BATTERY_PCT` (15) | مرة لكل عبور، صفاء عند الصعود |
  | `rtt-degraded` | warn | متصل + rtt > `RTT_DEGRADED_MS` (150) | مرة لكل عبور، صفاء عند النزول |
  | `storage-high` | warn | used/total ≥ `STORAGE_HIGH_PCT` (90) | مرة لكل عبور، صفاء عند النزول |
- أول تكة بعد إقلاع السيرفر **ترسّخ الحالة بلا أحداث** — منع فيض «عودة» زائف
  عند كل إقلاع (تكة force عند الإقلاع تسجل العينات فقط).

### 27.ب REST (على :3000 أو عبر البوابة :81)
| Endpoint | الشكل الفعلي |
|----------|--------------|
| `GET /api/devices/health?device=<id\|all>&window=<1h\|6h\|24h>` | `{window, since, devices[], series:{battery[],rtt[]}, events[], alerts[], counts, limits}` — `devices[]` = ملخص لكل جهاز `{deviceId,name,kind,online,uptimePct|null,avgRttMs|null,minBattery|null,samples,points[]}`؛ `series` = صفوف دلو زمني موحّد (60 دلوًا عبر النافذة، قيمة الجهاز = متوسط دلوِه؛ **rtt من العينات المتصلة فقط** — قيمة الجهاز المقطوع باقية ولا تُضلّل المخطط)؛ `alerts` = أحداث warn (الأحدث أولًا، ≤12) |
| `POST /api/devices/health {action:"force-sample"}` | `{ok, recorded, events}` — يجبر تكة قياس فورية (تجاوز الخانقة) — زر «التقاط عينة الآن» وأدوات التحقق |
| `POST /api/devices/health {action:"report", deviceId, battery?, rttMs?}` | **مسار الوكيل الحقيقي**: قيم فعلية من الجهاز — تحقق صارم (`battery` رقم 0..100 يُقصّ، `rttMs` رقم ≥ 0) → تحديث سجل الأجهزة → تكة force تسجل العينة وتقيّم العبورات → `{ok, device:{id,name,battery,rttMs}, recorded, events}`؛ 404 جهاز غير موجود، 400 بلا قيم/قيم فاسدة |

### 27.ج الربط بالنبض القائم
- `heartbeatBump()` (devices.ts) تُشغّل تكة قياس بعد الجيتر — استيراد ديناميكي
  يكسر دورة الوحدات (health.ts يقرأ `store()` من devices.ts) — fire-and-forget
  لا يبطئ النبضة ولا يُهلِكها عند فشل SQLite (خطأ يُسجَّل ويعود `{ok:false}`).
- `POST /api/devices` (connect/disconnect/forget/pair) يجبر تكة force بعد كل
  نجاح — فتُرصد الانتقالات لحظيًا دون انتظار النبضة التالية.
- **نبض الخدمة الذاتي (§27.هـ)**: `heartbeatBump()` نفسها تشعل نبض الخدمة الدائم
  عند أول لمسة (`ensureServicePulse`) — بعدها لا تحتاج المنظومة أي واجهة مفتوحة
  لتوليد العينات (التفصيل في 27.هـ).

### 27.د الواجهة والحدود الصادقة
- `HealthPanel` أعلى صفحة الأجهزة: شرائح ملخص (متصل/متوسط استجابة/أدنى بطارية/
  تنبيهات) + مخططا خط (بطارية %، استجابة ms) بلون لكل جهاز (جدول الإتاحة هو
  مفتاح الألوان) + قائمة تنبيهات بصياغة مركبة من النوع + اسم الجهاز (ترجمة EN
  كاملة — رسائل الخادم العربية تبقى في DB كسجل).
- **حدود موثقة**: قيم الأجهزة المحاكاة (بذرة v3) مشتقة من جيتر النبض — الوكيل
  الحقيقي يدفع قيمه الفعلية عبر `report` (27.ب)؛ سجل حذف الاقتران لا يمحو
  تاريخ عيناته (يظهر في `device=all` بلا اسم حي)؛ عينات EN: النوافذ الثلاث
  داخل حد الاحتفاظ 24h — لا تاريخ أقدم من ذلك.
- **شارة النبض**: لقطة الصحة تتضمن `pulse {active, intervalMs, startedAt}` من
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
