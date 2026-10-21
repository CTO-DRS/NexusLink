# دليل مطور NexusLink 2.0 — SDK · API عام · سوق التكاملات · CLI

> **عقد 2.0** (المصدر التعاقدي: `docs/protocol-contract.md` §34). هذا الدليل هو «دليل مطور 2.0
> كامل» — معيار خروج M3. كل ما يلي **محلي حصرًا**: الجهاز هو الحدود، لا حساب ولا سحابة ولا
> مفاتيح API. أي عنوان خارج 127.0.0.1/localhost/[::1] يُرفض في البناء.

---

## 1. البدء السريع — SDK

الـSDK عميل ESM **صفر اعتماد** (فقط `fetch` القياسي) في `sdk/index.mjs`:

```js
import { NexusLink, NexusError } from "./sdk/index.mjs"

const nx = new NexusLink({ port: 3000 })        // أو { url: "http://127.0.0.1:3000" }

const v = await nx.version()                     // { current: "2.0.0", history: [...] }
const { devices } = await nx.devices()           // [{ id, name, state, battery… }]
const r = await nx.search("ملاحظات")             // { ok, total, groups:[{kind,label,items}] }
const a = await nx.ask("ما حالة أجهزتي؟")        // { ok, intent, answer, sources[] }
const i = await nx.insights()                    // رؤى 14 يومًا — أرقام حصرًا
```

كل الطرق تعيد JSON محلولًا أو ترمي `NexusError` ‏`{ status, message, path }` — بلا قيم `undefined`
غامضة. حرس النطاق في البناء:

```js
new NexusLink({ url: "https://example.com" })   // ✗ NexusError: SDK محلي حصرًا
```

## 2. الأسطح العامة (عقد §34.أ)

| المستوى | الطريقة | المسار | ملاحظات تعاقدية |
|---------|---------|--------|------------------|
| الهوية | `version()` | `GET /api/version` | الإصدار + السجل (كاش 10 دقائق) |
| | `health()` | `GET /api/health` | صحة الخادم المضمن |
| الأجهزة | `devices()` | `GET /api/devices` | `{devices:[…]}` — الحالة الحية |
| | `device(id)` | — | تصفية محلية، `null` إن غاب |
| النقل | `ops(since?)` | `GET /api/sync/ops` | **قراءة حصرًا** — حمولات الحافظة لا تغادر (F6: `payload:{}` + علم `hasPayload`) |
| | `transfers()` | `GET /api/transfer` | `{jobs:[…]}` النقل النشط |
| الذكاء | `search(q, {kind?, limit?})` | `GET /api/search` | 8 مخازن محلية — فارغ 400، >80 حرفًا مقصوص |
| | `ask(q)` | `POST /api/assistant` | خمس نوايا حتمية + تصريح مصادر |
| | `insights()` | `GET /api/insights` | أرقام وأزمنة حصرًا |
| الأتمتة | `automation.list()` | `GET /api/automation/rules` | فوق مقبس الجسر — نفس حالة المحرر حرفيًا |
| | `automation.upsert(rule)` | `POST …/rules` | تعقيم الجسر نفسه؛ الرفض 400 مسببًا |
| | `automation.remove(id)` | `POST …/rules` | حذف بالمعرف |
| | `automation.fires()` | `POST …/rules` | آخر 200 إطلاق مرسوخ من SQLite |
| السوق | `market.list()` | `GET /api/marketplace` | القناة الموقعة + المثبت + بصمة المفتاح |
| | `market.install(m, sig)` | `POST …/marketplace` | توقيع إلزامي + قدرات ضمن الكتالوج |
| | `market.uninstall(id)` | `POST …/marketplace` | غير المثبت → 404 |
| | `market.sign(m)` | `POST …/marketplace` | توقيع بمفتاح القناة المحلية (للمؤلفين) |

### مثال: إنشاء قاعدة روتين من SDK

```js
await nx.automation.upsert({
  name: "بطارية الهاتف منخفضة",
  enabled: true,
  trigger: { kind: "battery.below", threshold: 20 },
  action: { kind: "notify", text: "الهاتف يحتاج شحنًا" },
})
// رفض ممكن بنفس سبب واجهة المحرر حرفيًا — مثلاً:
// NexusError 400: نوع مشغّل غير معروف: xyz
```

## 3. سوق التكاملات — كتابة تكامل (عقد §34.ب)

التكامل **manifest تصريحي** — لا كود تنفيذي يُثبَّت أبدًا:

```json
{
  "id": "battery-warden",
  "name": "Battery Warden",
  "description": "تنبيهات بطارية مركبة عبر الروتينات",
  "version": "1.0.0",
  "author": "you@example",
  "capabilities": ["read.devices", "invoke.automation", "notify.user"],
  "entry": {
    "kind": "automation-rule",
    "template": { "trigger": { "kind": "battery.below", "threshold": 20 },
                   "action": { "kind": "notify", "text": "بطارية منخفضة" } }
  }
}
```

**القدرات المغلقة (الكتالوج)**: `read.devices · read.search · read.insights · read.ops ·
invoke.automation · invoke.transfer · notify.user` — أي قدرة أخرى **ترفض** (لا توسيع صامت).
نوعا الدخول: `automation-rule` (قالب يمر بتعقيم الجسر عند إنشائه) أو `local-open` (رابط يبدأ
بـ`/` حصرًا).

### التوقيع

HMAC-SHA256 فوق **الشكل المتعارف** (JSON بمفاتيح مرتبة — نفس البايتات على أي جهاز). أسهل مسار:
دع الخادم يوقع لك بمفتاح القناة المحلية:

```bash
node cli/nexus.mjs market sign my-integration.json
# → { ok: true, sig: "…64 hex…", keyFp: "…16 hex…" }
```

ثم التثبيت بنقرة من بطاقة «سوق التكاملات» في الإعدادات، أو:

```bash
node cli/nexus.mjs market list
node cli/nexus.mjs market install battery-warden
```

> **بصم القناة**: أول استدعاء يولّد مفتاح قناة محلي (32 بايت) يرسخ محليًا — بصمته تظهر في كل
> رد `keyFp`. القناة الافتتاحية (10 تكاملات) موقعة بنفس المفتاح — قناة موقعة ذاتيًا موثقة بصدق.

## 4. CLI — الأتمتة من الطرفية (عقد §34.ج)

```bash
node cli/nexus.mjs status                 # ملخص: إصدار + أجهزة + رأس المزامنة
node cli/nexus.mjs devices --json         # JSON خام لأي سكربت
node cli/nexus.mjs ops 120                # نافذة سجل العمليات منذ seq=120
node cli/nexus.mjs search ملفات
node cli/nexus.mjs automation list
node cli/nexus.mjs automation add "تنبيه" '{"trigger":{"kind":"time.daily","hh":9,"mm":0},"action":{"kind":"notify","text":"ابدأ"}}'
node cli/nexus.mjs market install focus-timer
node cli/nexus.mjs --url http://127.0.0.1:3000 health   # منفذ/عنوان صريح — محلي حصرًا
```

الـCLI يعيد استخدام الـSDK مباشرة — وهو **أول تكامل فعلي فوق الـSDK**: أي سلوك تراه هنا هو
سلوك الـSDK نفسه بلا طبقات وسيطة.

## 5. الاختبار قبل النشر (توصية للمؤلفين)

1. `node cli/nexus.mjs market sign manifest.json` ثم ثبت يدويًا من الإعدادات — تحقق أن القالب
   يخلق القاعدة بلا رفض (تعقيم الجسر هو المرجع).
2. تأكد أن كل قدرة مصرّحة ضرورية فعلًا — الكتالوج مغلق والإفراط يُضعف ثقة المستخدم.
3. أوصاف ≤240 حرفًا، معرف ثابت `^[a-z0-9][a-z0-9-]{1,39}$` — التكرار يرفض.

## 6. حدود موثقة بصدق (عقد §34.هـ)

- القناة موقعة ذاتيًا محليًا — توقيع ناشر مركزي (PKI + مراجعة بشرية) بند ما بعد M3.
- القدرات تُتحقق عند التثبيت؛ «الفرض لحظة الاستدعاء» بند لاحق عند تعدد التكاملات النشطة.
- `ops()` قراءة حصرًا بالتصميم — الكتابة على سجل المزامنة بلا مسار عام عمدًا.
- مهلة واجهة الأتمتة تتبع الجسر (سقف 6ث؛ غير الجاهز → 503 مسببًا).

## قناة الناشر والفرض اللحظي (عقد §35 — DEEP)

- **غلاف الناشر**: كل بند قناة يحمل `pub: { id, kv, sig }` — توقيع ناشر المالك
  على الشكل المتعارف نفسه. التثبيت يقبل مسارين: غلاف ناشر (يُتحقق أولًا) أو
  توقيع القناة المحلية كما في M3. إدارة الناشر عبر REST: `pub-list` /
  `pub-rotate` / `pub-revoke` / `pub-restore` / `pub-sign` / `pub-verify`
  — والعرض العام بصمات حصرًا، لا مفاتيح.
- **الفرض اللحظي**: قاعدة بولادة تكامل تحمل `origin: { plugin }` — لا تُقبل
  إلا والتكامل حيًا ويصرّح بـ`invoke.automation`، ولا تُطلق إلا وهو حي لحظة
  الإطلاق (إزالة التكامل أو إبطال ناشره يوقفها بمدخل مسبب، وعودته يحييها).
- **التشغيل اليدوي عبر REST**: `POST /api/automation/rules` بـ`{ action: "run", id }`
  — ينتظر إقرار الجسر بعد الحسم (لا يلتقط الحالة الابتدائية — درس §35.ب موثق).
- **التنبؤ الاستباقي**: `GET /api/predictions` — توقعات إطلاق الروتينات
  واقتراحات مسبّبة بالدليل، قراءة حصرًا (حدود §35.د: حتمي من 14 يومًا،
  ≥3 إطلاقات تبني نمطًا، الإنشاء بيد المستخدم حصرًا).
