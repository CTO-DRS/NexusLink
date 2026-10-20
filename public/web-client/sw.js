// NexusLink — عامل الخدمة للعميل الوِب المستقل (عقد §36)
// ============================================================
// التخزين المؤقت للصدفة حصرًا (ملفات /web-client/) — مسارات /api/*
// تمر شبكيًا حصرًا بلا أي تخزين (البيانات حية دائمًا، ولا بقاء لآثار).
// صفر طلبات خارجية: أي مصدر غير نفس الأصل يُرفض فورًا.
const CACHE = "nexus-web-v2"
const SHELL = [
  "/web-client/index.html",
  "/web-client/style.css",
  "/web-client/app.js",
  "/web-client/manifest.webmanifest",
  "/web-client/icon.svg",
]

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url)
  if (ev.request.method !== "GET") return
  if (url.origin !== self.location.origin) return // صفر خارجي — صدق لا استثناء
  if (url.pathname.startsWith("/api/")) return // البيانات حية دائمًا — بلا تخزين
  if (!url.pathname.startsWith("/web-client/")) return
  ev.respondWith(
    caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((res) => {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(ev.request, copy)).catch(() => {})
      return res
    })),
  )
})
