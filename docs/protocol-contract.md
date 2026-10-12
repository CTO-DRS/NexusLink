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
- تسجيل: `rc:hello-controller {name}` · `desktop:register {name, mac}` (للكمبيوتر)
- `desktop:state {power}` · `desktop:clipboard {text, at?}`
- `rc:ping {t}`
- أحداث الإدخال (تُرحَّل broadcast مع بوابة الطاقة): `rc:move {dx, dy}` · `rc:click {button: "left"|"right"}` · `rc:scroll {dy}` · `rc:pinch {scale}` · `rc:key {key?, special?, modifiers?}` · `rc:gamepad {kind: "button"|"axis", button?, action?, ...}` · `rc:presenter {action: "next"|"prev"|"black"|"laser-on"|"laser-off", value?}` · `rc:media {action: "toggle"|"play"|"pause"|"next"|"prev"|"mute"|"unmute"|"volume", value?}` · `rc:clipboard {direction: "toPc"|"pull", text?}`
- `rc:power {action: "shutdown"|"restart"|"sleep"|"hibernate"|"lock"|"unlock"}`
- `rc:wol {mac}` — تحقق صارم من MAC وإعادة صياغة الحزمة 6×FF+MAC×16

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
