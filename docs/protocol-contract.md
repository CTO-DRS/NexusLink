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
3. إتمام: `POST /api/devices {action:"pair", name, kind, id?, ip?, battery?, storageTotal?, storageUsed?, model?}` → `{ok, device}` (idempotent عبر id/name).

**الفجوات (G) — الحالة بعد مرحلة Flutter-1:**
| # | الفجوة | الحالة | ما نُفّذ |
|---|--------|--------|----------|
| G-1 | `pair` لا يتحقق من سر QR | ⏳ مؤجلة لمرحلة الأمان | التسجيل عبر pair كما هو؛ التحقق من السر سيُضاف مع مرحلة الأمان |
| G-2 | QR يعلن `port:7420` الميت + IP ثابت | ✅ **مُصلحة** | `/api/devices/qr` يشتق host/port من ترويسة Host الواردة، ويعيد `payload` نصيًا + خريطة منافذ الجسور كاملة `ports:{rest,comms,remote,media,guard,prod,sec,gateway}` + `name:"NEXUS-PC"` |
| G-3 | لا اكتشاف تلقائي | ✅ **مُصلحة** | comms-service يعلن `NEXUS-PC._nexuslink._tcp` عبر bonjour-service (port 81) مع TXT: proto/name/gateway/rest/comms/remote/media/guard/prod/sec — best-effort بلا إيقاف الخدمة عند فشل multicast |
| G-4 | سجل الأجهزة في الذاكرة | مقبول | الوكيل يعيد التسجيل تلقائيًا (idempotent عبر `id` الثابت) |
| G-5 | دور الوكيل الحقيقي في 3003 | موثق | الوكيل مصدر ingest عبر REST ومستمع `phone:*`؛ يوقف autoMode عند التشغيل |
| G-6 | `pair` يقبل حقول الوكيل الاختيارية | ✅ **مضافة** | `{action:"pair", id?, ip?, battery?, storageTotal?, storageUsed?, model?}` — idempotent عبر `id` (Android ID)، نفس الاستجابة `{ok, device}` دون أي كسر للعميل القديم |

---

## 7. حزمة اتصال الوكيل (ما يجب أن يفعله تطبيق Flutter حرفيًا)

1. **اكتشاف/اقتران**: UDP discovery (بعد G-3) أو إدخال IP يدوي → جلب QR من الكمبيوتر أو عرض QR من الهاتف → تبادل السر → `POST /api/pair/claim` (بعد G-1) → حفظ `{serverName, ip, ports, deviceId, secret?, pub}` في drift/SQLite.
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
- الهاتف: بطاقة «شاشة الكمبيوتر» في شاشة الوسائط (حالة الطور) + شاشة العرض الكاملة بجودة قابلة للتبديل (إعادة بث فوري بـ stop→req).

### 15.هـ فجوات سيرفرية أُصلحت في هذه المرحلة
| # | الفجوة | ما نُفّذ |
|---|--------|----------|
| G-23 | جسر 3005 بلا أحداث عرض الشاشة | `screen:req/screen:stop/screen:set/screen:state` — تنقية صارمة (fps قائمة بيضاء 15..60، quality، w/h ≤ 8192، name ≤ 80، error ≤ 200) + حقن from — مضافة لا تكسر العملاء القائمين |
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
