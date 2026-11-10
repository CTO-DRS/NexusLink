// SPDX-License-Identifier: MIT
// NexusLink SDK 2.0 — العميل العام الرسمي (عقد §34 — M3.1)
// ============================================================
// عميل صفر-اعتماد (ESM خالص، node:crypto حصرًا) فوق API المحلي.
// النموذج الأمني: **محلي حصرًا** — كل عنوان خارج 127.0.0.1/localhost/[::1]
// يُرفض في البناء (نفس حرس §33.ب للمحول المحلي). لا رمز ولا حساب:
// الجهاز هو الحدود (contract 2.0 — «الأجهزة والنقل والأتمتة»).
// النقل: REST عادي على المنفذ المحلي — لا socket.io من الطرف الثالث.

const LOCALHOST_RE = /^(https?:\/\/)?(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?\/?$/i
const DEFAULT_TIMEOUT_MS = 10_000 // عقد §34.هـ: مهلة افتراضية معلنة — بلا تعليق أبدي

/** خطأ موحد للطرف الثالث: status رقم وmessage واضح */
export class NexusError extends Error {
  constructor(status, message, path) {
    super(message)
    this.name = "NexusError"
    this.status = status
    this.path = path
  }
}

/**
 * NexusLink — العميل المحلي (عقد 2.0).
 * كل الطرق تعيد JSON محلولًا أو ترمي NexusError.
 * @example
 *   import { NexusLink } from "./sdk/index.mjs"
 *   const nx = new NexusLink({ port: 3000 })
 *   const v = await nx.version()          // { current, ... }
 *   const rules = await nx.automation.list()
 */
export class NexusLink {
  constructor({ port = 3000, url, timeoutMs } = {}) {
    const base = url || `http://127.0.0.1:${port}`
    if (!LOCALHOST_RE.test(base)) {
      // الحرس التعاقدي: الـSDK لا يتحدث إلا مع الجهاز المحلي
      // (يقبل شريحة مائلة وحيدة زائدة — يرفض أي مسار أعمق أو مضيف خارجي أو مخطط آخر)
      throw new NexusError(0, `NexusLink SDK محلي حصرًا — رفض العنوان: ${base}`, "constructor")
    }
    this.base = base.replace(/\/$/, "")
    const t = Number(timeoutMs)
    this.timeoutMs = Number.isFinite(t) && t > 0 && t <= 120_000 ? Math.floor(t) : DEFAULT_TIMEOUT_MS
  }

  async #req(path, { method = "GET", body } = {}) {
    let res
    const ctl =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(this.timeoutMs)
        : undefined
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        // عقد النقل الحرفي: الجهاز هو الحدود — أي تحويل (redirect) يُرفض بدل اتباعه
        // لوجهة قد تكون خارج الجهاز (307/308 يُعيدان الجسم والرمز إلى الغريب)
        redirect: "error",
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl,
      })
    } catch (e) {
      const name = e?.name || ctl?.reason?.name || ""
      if (name === "TimeoutError" || name === "AbortError") {
        throw new NexusError(0, `انتهت مهلة الطلب (${this.timeoutMs}ms) — ${path}`, path)
      }
      throw new NexusError(0, `لا اتصال بالخادم المحلي (${this.base}) — ${e.message}`, path)
    }
    const text = await res.text().catch(() => "")
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* غير JSON يبقى null */ }
    if (!res.ok) {
      const msg = json?.error || json?.message || text.slice(0, 140) || `HTTP ${res.status}`
      throw new NexusError(res.status, String(msg), path)
    }
    return json
  }

  // ————— الهوية والصحة —————
  /** إصدار التطبيق وسجل الإصدارات (عقد §16) */
  version() { return this.#req("/api/version") }
  /** فحص صحة الخادم المضمن */
  health() { return this.#req("/api/health") }

  // ————— الأجهزة (عقد 2.0: الأجهزة) —————
  /** قائمة الأجهزة المرتبطة مع الحالة الحية */
  devices() { return this.#req("/api/devices") }
  /** جهاز واحد بالمعرف (تصفية محلية) */
  async device(id) {
    const j = await this.devices()
    const list = Array.isArray(j?.devices) ? j.devices : Array.isArray(j) ? j : []
    return list.find((d) => d?.id === id) ?? null
  }

  // ————— النقل والمزامنة —————
  /** حالة سجل العمليات القابل للاستئناف (offline-first — عقد §32) — قراءة حصرًا
   *  since عدد صحيح ≥ 0 حصرًا — غير الصالح NexusError ‏400 مسببًا (لا since=NaN صامت) */
  ops(since) {
    if (since !== undefined) {
      const n = Number(since)
      if (!Number.isInteger(n) || n < 0) {
        throw new NexusError(400, `since يجب أن يكون عددًا صحيحًا ≥ 0 — وصل: ${String(since)}`, "/api/sync/ops")
      }
      return this.#req(`/api/sync/ops?since=${n}`)
    }
    return this.#req("/api/sync/ops")
  }
  /** قوائم النقل النشطة */
  transfers() { return this.#req("/api/transfer") }

  // ————— الذكاء المحلي (عقد §33) —————
  /** البحث الموحد فوق المخازن المحلية الثمانية */
  search(q, opts = {}) {
    const qs = new URLSearchParams({ q: String(q ?? "") })
    for (const k of ["kind", "limit"]) if (opts[k] !== undefined) qs.set(k, String(opts[k]))
    return this.#req(`/api/search?${qs}`)
  }
  /** المساعد المحلي (خمس نوايا حتمية) */
  ask(q) { return this.#req("/api/assistant", { method: "POST", body: { q: String(q ?? "") } }) }
  /** لوحة الرؤى (14 يومًا — أرقام حصرًا) */
  insights() { return this.#req("/api/insights") }

  // ————— الأتمتة (عقد 2.0: الأتمتة — REST فوق نفس تحقق الجسر §26.ي) —————
  automation = {
    /** قواعد الروتين الحالية + الإحصاءات */
    list: () => this.#req("/api/automation/rules"),
    /** إنشاء/تحديث قاعدة (payload تصريحي — نفس تعقيم الجسر حرفيًا) */
    upsert: (rule) => this.#req("/api/automation/rules", { method: "POST", body: { action: "upsert", rule } }),
    /** حذف قاعدة بالمعرف */
    remove: (id) => this.#req("/api/automation/rules", { method: "POST", body: { action: "delete", id } }),
    /** آخر الإطلاقات المرسوخة (§26.ح — من SQLite) */
    fires: () => this.#req("/api/automation/rules", { method: "POST", body: { action: "fires" } }),
  }

  // ————— سوق التكاملات (عقد §34.ب) —————
  market = {
    /** القناة الموقعة + المثبت محليًا + بصمة المفتاح */
    list: () => this.#req("/api/marketplace"),
    /** تثبيت تكامل: توقيع HMAC-SHA256 إلزامي + قدرات ضمن الكتالوج حصرًا */
    install: (manifest, sig) =>
      this.#req("/api/marketplace", { method: "POST", body: { action: "install", manifest, sig } }),
    /** إزالة تكامل بالمعرف */
    uninstall: (id) =>
      this.#req("/api/marketplace", { method: "POST", body: { action: "uninstall", id } }),
    /** توقيع تجريبي بمفتاح القناة المحلية (للمؤلفين — محلي حصرًا) */
    sign: (manifest) =>
      this.#req("/api/marketplace", { method: "POST", body: { action: "sign", manifest } }),
  }
}

export default NexusLink
