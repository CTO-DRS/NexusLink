# Flathub — بروفة الإرسال الكاملة (عقد §44.ج — جاهزية X3)

> هذا المستند هو **البروفة الحرفية لطلب الإرسال**: كل نص ستجري لصقه في نماذج
> Flathub ووصف طلب الدمج وأجوبة المراجعة — مكتوبًا مسبقًا ومتسقًا مع الملفات
> الفعلية. المصادر: `packaging/flathub/` (الملفات الثلاثة) + `LICENSE` (عقد
> §45) + `docs/enterprise-deploy.md` §14. ما عدا بريد المالك لا شيء يُكتب
> لحظة الإرسال — كل شيء هنا.

---

## 0) قائمة ما قبل الإرسال (على جهاز المالك حصرًا)

- [ ] حساب Flathub مُنشأ ومُفعّل (GitHub OAuth مقبول).
- [ ] `flatpak-builder --user --install --force-clean build sa.drs.nexuslink.yml` ينجح محليًا (خطوة 1 من `packaging/flathub/README.md`).
- [ ] `flatpak run sa.drs.nexuslink` يقلع ويقترن ويبثّ شاشة وينقل ملفًا — تحقق يدوي موثق (§44.د.3).
- [ ] إقرار `update_contact`: أضف سطر البريد في `sa.drs.nexuslink.metainfo.xml` قبل `<releases>` (البوابة تفحص غيابه عمدًا — حد §44.د.5؛ لحظة الإرسال يُضاف).
- [ ] `node scripts/flathub-e2e.mjs` مرتين متتاليتين أخضرتين (61/61).
- [ ] `node scripts/license-e2e.mjs` مرتين متتاليتين أخضرتين (44/44) — بيان المتجر بلا انجراف عن الترخيص الجذري.
- [ ] آخر إصدار منشور على GitHub = آخر `<release>` في الميتا (التزامن مفروض آليًا).

## 1) نموذج إرسال التطبيق الجديد — الأجوبة حرفيًا

| الحقل | الجواب (انسخ حرفيًا) |
|---|---|
| **App ID** | `sa.drs.nexuslink` |
| **Name** | `NexusLink` |
| **Summary** | `Bridge your devices over your own LAN — screen, input, files, media, routines` |
| **Summary (ar)** | `جسر أجهزتك عبر شبكتك المحلية — شاشة وتحكم وملفات ووسائط وروتينات` |
| **Categories** | `Network` · `Utility` |
| **Project License** | `LicenseRef-proprietary` (شرح المراجع أدناه في §3) |
| **Metadata License** | `CC0-1.0` |
| **Homepage** | `https://github.com/CTO-DRS/NexusLink` |
| **Bug tracker** | `https://github.com/CTO-DRS/NexusLink/issues` |
| **Screenshots** | الأربع المضمنة في الميتا (روابط raw.githubusercontent حية — لا تحميل يدوي) |

**وصف طويل (إنجليزي)** — كما في `<description>` حرفيًا:

```text
NexusLink is a local-first device bridge: control your computer from your phone (or
another computer) over your own network — no cloud account, no relay, no telemetry.
Live screen streaming over WebRTC with low-latency input, system clipboard, touch
control, file transfer, media control, and a self-hosted update channel.

Highlights: NexusLive second-screen over UDP (P95 ≈ 13ms stylus), local smart
routines with historical health triggers, offline unified search, an on-device
assistant, an SDK and public REST APIs, enterprise policy management (MDM),
tamper-evident audit logging, and an OEM privacy-by-default mode.

Sandbox note: some deeper layers (second-screen driver on Windows, uinput, virtual
camera on the host) are limited inside any sandbox — the core of sync, streaming,
files, clipboard, and routines works fully.
```

## 2) نص طلب الدمج (PR إلى `flathub/flathub`)

**العنوان**: `Add NexusLink (sa.drs.nexuslink) — local-first device bridge`

```text
What: NexusLink — a local-first device bridge (phone ⇄ desktop) over the user's
own LAN. Screen streaming (WebRTC + NexusLive UDP second-screen), remote input,
clipboard sync, file transfer, media control, smart local routines.

How it ships: self-contained AppImage release from the project repository
(webkit2gtk 4.1 / GTK3 / GStreamer bundled in usr/lib). The manifest is the
established extract-wrapper pattern used by other proprietary AppImage apps
(e.g. Obsidian): full usr/ copy + a wrapper reproducing the AppImage GTK hook
with APPDIR=/app verbatim. only-arches: [x86_64] — honest: no aarch64 Linux
build exists and the metainfo does not claim one.

Updates: x-checker-data (github-releases, *.AppImage) — the external data
checker will open upgrade PRs automatically per release; maintainers sync the
metainfo <release> log with the in-app version API via a CI gate.

Licensing: project_license = LicenseRef-proprietary (closed core,
Copyright (c) 2026 CTO-DRS), metadata_license = CC0-1.0. A declared open-set
of six files (pairing math, oplog semantics, SDK, CLI, docs) is MIT-licensed
with SPDX headers — root LICENSE and LICENSES/MIT.txt in the repo. This is the
same dual model as other accepted proprietary apps.

Checks: local flatpak-builder build + live run verified on x86_64
(pairing, streaming, transfer). AppStream metainfo validated (appstreamcli).
```

## 3) أجوبة مراجعة متوقعة (مكتوبة مسبقًا)

**س: Flathub للتطبيقات الحرة — كيف يقبل تطبيقًا مملوكًا؟**
ج: Flathub يستضيف تطبيقات مملوكة بشرط بيانها الصادق — `project_license =
LicenseRef-proprietary` نمط معتمد (Obsidian وغيرها). ميتاداتنا CC0-1.0
(شرط حرة البيانات الوصفية)، ومجموعة مفتوحة مصرَّح بها (MIT + SPDX) داخل
المستودع العام نفسه — الازدواجية الصادقة موثقة في `LICENSE` جذريًا.

**س: لماذا غلاف AppImage لا بناء من مصدر؟**
ج: المستودع مغلق النواة والثنائي ذاتي الاكتفاء عمدًا (المكتبات داخل
`usr/lib`) — نمط الاستخراج المثبت. البناء المحلي بـflatpak-builder موثق
في `packaging/flathub/README.md` ونجح قبل الإرسال (قائمة §0).

**س: صلاحيات الصندوق الرملي مطلوبة لأي شيء؟**
ج: الغلاف يعمل داخل الصندوق الافتراضي بلا بوابات خاصة — والحد المعروف
موثق في وصف التطبيق نفسه (طبقات عميقة محدودة داخل أي صندوق —
نواة المزامنة والبث والملفات والحافظة كاملة).

**س: كيف تُدار الترقيات؟**
ج: `x-checker-data` يفتح PR ترقية آليًا عند كل إصدار — وبوابة
`flathub-e2e.mjs` المحلية تمنع دفع ميتا غير متزامن مع سجل الإصدارات.

**س: update_contact؟**
ج: يُضاف (سطر بريد واحد) لحظة الإرسال — غيابه الآن مقصود ومفحوص.

## 4) بعد القبول

1. مراقبة PR الترقية الآلية (x-checker-data) — الدمج يدويًا من المالك.
2. كل إصدار: حدّث `url`/`sha256` + مدخل `<release>` + `node scripts/flathub-e2e.mjs` مرتين.
3. انجراف المتجر عن `LICENSE` يفشل في `license-e2e.mjs` (الطور 4) قبل أن يصل للمتجر.
