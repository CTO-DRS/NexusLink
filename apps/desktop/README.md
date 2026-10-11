# NexusLink Desktop (Tauri 2)

تطبيق سطح المكتب الرسمي — يغلّف منصة NexusLink كاملة في مثبّت واحد: **السيرفر يعمل داخله**، والهاتف يكتشفه عبر mDNS **بدون متصفح نهائيًا**.

## المعمارية

```
┌────────────────────────── NexusLink.exe (Tauri 2) ──────────────────────────┐
│                                                                             │
│  procman (Rust) ── يدير ويراقب ويعيد التشغيل عند الانهيار (backoff أسّي)    │
│   ├─ next    : node resources/server/server.js      → :3000                │
│   │            (الواجهة + REST /api/* + الجسور الداخلية 3004/3005/3006/3007/3009)
│   ├─ gateway : node resources/gateway/gateway.cjs   → :81 (أو 8180 تلقائيًا)│
│   │            (بديل Caddy — نفس العقد: ?XTransformPort=<port> + WS)        │
│   └─ comms   : node resources/comms/comms.cjs       → :3003                │
│                (جسر الاتصالات + إعلان mDNS _nexuslink._tcp بمنفذ البوابة)   │
│                                                                             │
│  System Tray: متصل/منتظر/موقوف/خطأ + قائمة (فتح/إيقاف مؤقت/إغلاق-إلى-Tray/إنهاء)
│  Close-to-Tray (قابل للتعطيل) · Single Instance · شاشة تحميل حتى الجاهزية    │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **الهاتف** يكتشف `_nexuslink._tcp` (bonsoir) → يتصل بوضع gateway عبر المنفذ المعلن → نفس مسار الويب حرفيًا (`?XTransformPort`).
- **إشارة «متصل»** في الـ Tray تأتي من `phoneGuardOnline` في `/api/desktop/status` (منارة القرب الحقيقية كل 5ث) — مصدر حقيقة واحد مع محرك الحماية.
- **تراجع المنفذ**: المنافذ <1024 تتطلب صلاحيات على Linux/macOS — البوابة تجرّب 81 ثم تهبط إلى 8180 وتعلن المنفذ الفعلي في mDNS (`PORT=` سطر آلي يقرؤه procman ويُمرَّر لـ comms).
- **الإصدار**: 1.0.0 — متزامن مع وسم v1.0.0 (لا يُرفع إلا مع قرار إصدار).

## بناء محلي (تطوير)

```bash
# 1) جهّز موارد السيرفر (يتطلب bun run build في الجذر أولًا)
bun run build
bash apps/desktop/build-resources.sh

# 2) شغّل/ابنِ التطبيق (يتطلب Rust + tauri-cli)
cd apps/desktop
bunx @tauri-apps/cli@^2 dev     # تطوير
bunx @tauri-apps/cli@^2 build   # حزم التثبيت
```

بلا Rust محليًا: CI (`.github/workflows/desktop.yml`) يبني حزم win/linux/mac حقيقية على كل وسم `v*` أو تشغيل يدوي — بما فيها sidecar Node v20 وNext standalone وcomms وgateway.

## وضع التطوير بلا sidecar

`resolve_node()` يبحث عن `node` بجوار التنفيذي (sidecar)، وإلا يستخدم `node` من PATH — لذا التطوير المحلي لا يحتاج تنزيل ثنائيات Node.

## الاختبار (بدون واجهة)

`node scripts/desktop-e2e.mjs` يشغّل **نفس ما يديره procman حرفيًا** (نفس الأوامر/المنافذ/البيئة) ويتحقق من 18 فحصًا: جاهزية next، إقلاع الجسور الخمسة، تراجع البوابة، تمرير XTransformPort وWS عبرها، إعلان mDNS بالمنفذ الفعلي، وتسجيل هاتف محاكى يقلب حالة الـ Tray إلى «متصل».
