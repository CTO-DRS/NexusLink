// NexusLink — العميل الوِب المستقل (عقد §36 — M4.4 «عمق منصي»)
// ============================================================
// أثر ثابت صفر-بناء صفر-اعتماد: منظرة فوق أسطح REST الثمانية القائمة
// حصرًا — **منظرٌ لا باب**: صفر مسار API جديد وصفر تغيير في نموذج الأمن
// (الجهاز هي الحدود — عقد 2.0). كل الطلبات نفس الأصل (مسارات نسبية) —
// **صفر بايت يغادر الجهاز بالتصميم** (مفحوص E2E: لا عنوان مطلق خارجي في
// الأثر كله). النواة النقية مُصدَّرة لتُفحص حيًا بلا متصفح، وسلك الواجهة
// مبني خلف حارس document (نمط «النواة بلا أي fetch» الموثق §33).

/** سجل الترجمة المضمن — توازن ar/en إلزامي (مفحوص E2E مفتاحًا بمفتاح). */
export const I18N = {
  ar: {
    brand_tag: "مزامنة خاصة بلا سحابة",
    foot_zero: "صفر بايت يغادر جهازك — كل الطلبات نفس الأصل",
    boot_note: "جارٍ الإقلاع…",
    loading: "جارٍ التحميل…",
    empty: "لا شيء هنا بعد",
    err_generic: "تعذر الإكمال",
    retry: "إعادة",
    refresh: "تحديث",
    t_devices: "الأجهزة", t_auto: "الروتينات", t_search: "البحث", t_ask: "المساعد",
    t_ins: "الرؤى", t_pred: "التنبؤ", t_market: "السوق", t_ops: "العمليات",
    health_ok: "الجهاز حي", health_off: "لا استجابة",
    d_title: "الأجهزة", d_none: "لا أجهزة مقترنة بعد",
    d_battery: "البطارية", d_storage: "التخزين", d_seen: "آخر ظهور",
    d_rtt: "الاستجابة", d_ip: "العنوان", d_trusted: "موثوق",
    d_connect: "اتصال", d_disconnect: "فصل",
    a_title: "الروتينات", a_none: "لا روتينات بعد — أنشئ أولها",
    a_run: "تشغيل الآن", a_delete: "حذف", a_confirm: "حذف هذا الروتين؟",
    a_create: "إنشاء روتين", a_name: "الاسم", a_trigger: "المشغل", a_action: "الفعل",
    a_text: "النص", a_hh: "الساعة", a_mm: "الدقيقة", a_thresh: "العتبة %",
    a_at: "الموعد (epoch ms)", a_mac: "عنوان MAC", a_dev: "معرف الجهاز",
    a_enabled: "مفعلة", a_disabled: "معطلة", a_create_btn: "إنشاء",
    a_origin: "أصل التكامل", a_ok: "تم", a_fail: "رُفض",
    trg_device_connect: "اتصال جهاز", trg_device_disconnect: "انقطاع جهاز",
    trg_battery_below: "هبوط البطارية تحت", trg_battery_above: "ارتفاع البطارية فوق",
    trg_clip_received: "وصول مقطع حافظة", trg_time_once: "مرة واحدة عند",
    trg_time_daily: "يوميًا عند", trg_health_batt: "بطارية مستمرة تحت",
    trg_health_rtt: "استجابة مستمرة فوق", trg_health_sil: "صمت مستمر فوق",
    trg_health_sto: "تخزين مستمر فوق",
    act_notify: "إشعار", act_clip: "دفع إلى الحافظة", act_ring: "رنين الهاتف", act_wol: "إيقاظ شبكي",
    s_ph: "ابحث في جهازك…", s_btn: "بحث", s_took: "خلال {n} مللي", s_total: "{n} نتيجة",
    g_device: "أجهزة", g_routine: "روتينات", g_clip: "حافظة", g_message: "رسائل",
    g_contact: "جهات اتصال", g_call: "نداءات", g_delivery: "تسليم متصل", g_path: "مسارات متزامنة",
    k_ph: "اسأل جهازك…", k_btn: "اسأل", k_evidence: "الدليل",
    i_title: "لوحة الرؤى المحلية", i_gen: "توليد",
    p_title: "التنبؤ الاستباقي", p_window: "نافذة {n} يومًا", p_f: "التوقعات", p_s: "الاقتراحات",
    p_next: "الموعد القادم", p_stale: "متأخر", p_none: "لا توقعات بعد",
    p_daily: "نمط يومي", p_interval: "وسيط فترات", p_create: "إنشاء روتين من الاقتراح",
    p_created: "أُنشئ الروتين",
    m_title: "سوق التكاملات", m_install: "تثبيت", m_remove: "إزالة", m_installed: "مثبت",
    m_pub: "الناشر", m_fp: "بصمة القناة", m_caps: "القدرات", m_none: "القناة فارغة",
    o_title: "سجل العمليات", o_head: "رأس السجل", o_count: "المعروض",
    o_trunc: "مقصوص", o_empty: "النافذة فارغة", o_has: "بحمولة", o_nop: "بلا حمولة",
    tv_health: "حالة الجهاز", tv_devs: "الأجهزة", tv_next: "التوقع القادم",
    tv_uptime: "زمن التشغيل", tv_online: "متصل",
    tv_readonly: "وضع التلفاز: قراءة حصرًا (عقد §36.د)",
  },
  en: {
    brand_tag: "Private sync, zero cloud",
    foot_zero: "Zero bytes leave your device — same-origin requests only",
    boot_note: "Booting…",
    loading: "Loading…",
    empty: "Nothing here yet",
    err_generic: "Could not complete",
    retry: "Retry",
    refresh: "Refresh",
    t_devices: "Devices", t_auto: "Routines", t_search: "Search", t_ask: "Assistant",
    t_ins: "Insights", t_pred: "Predict", t_market: "Market", t_ops: "Ops",
    health_ok: "Device live", health_off: "No response",
    d_title: "Devices", d_none: "No paired devices yet",
    d_battery: "Battery", d_storage: "Storage", d_seen: "Last seen",
    d_rtt: "RTT", d_ip: "IP", d_trusted: "Trusted",
    d_connect: "Connect", d_disconnect: "Disconnect",
    a_title: "Routines", a_none: "No routines yet — create the first",
    a_run: "Run now", a_delete: "Delete", a_confirm: "Delete this routine?",
    a_create: "Create routine", a_name: "Name", a_trigger: "Trigger", a_action: "Action",
    a_text: "Text", a_hh: "Hour", a_mm: "Minute", a_thresh: "Threshold %",
    a_at: "When (epoch ms)", a_mac: "MAC address", a_dev: "Device ID",
    a_enabled: "Enabled", a_disabled: "Disabled", a_create_btn: "Create",
    a_origin: "Plugin origin", a_ok: "Done", a_fail: "Rejected",
    trg_device_connect: "Device connects", trg_device_disconnect: "Device disconnects",
    trg_battery_below: "Battery drops below", trg_battery_above: "Battery rises above",
    trg_clip_received: "Clipboard clip arrives", trg_time_once: "Once at",
    trg_time_daily: "Daily at", trg_health_batt: "Sustained battery below",
    trg_health_rtt: "Sustained RTT above", trg_health_sil: "Sustained silence above",
    trg_health_sto: "Sustained storage above",
    act_notify: "Notify", act_clip: "Push to clipboard", act_ring: "Ring phone", act_wol: "Wake-on-LAN",
    s_ph: "Search your device…", s_btn: "Search", s_took: "in {n} ms", s_total: "{n} results",
    g_device: "Devices", g_routine: "Routines", g_clip: "Clips", g_message: "Messages",
    g_contact: "Contacts", g_call: "Calls", g_delivery: "Delivery", g_path: "Synced paths",
    k_ph: "Ask your device…", k_btn: "Ask", k_evidence: "Evidence",
    i_title: "Local insights", i_gen: "Generated",
    p_title: "Proactive predictions", p_window: "{n}-day window", p_f: "Forecasts", p_s: "Suggestions",
    p_next: "Next predicted", p_stale: "overdue", p_none: "No forecasts yet",
    p_daily: "Daily pattern", p_interval: "Interval median", p_create: "Create routine from suggestion",
    p_created: "Routine created",
    m_title: "Integration market", m_install: "Install", m_remove: "Remove", m_installed: "Installed",
    m_pub: "Publisher", m_fp: "Channel fingerprint", m_caps: "Capabilities", m_none: "Empty channel",
    o_title: "Ops log", o_head: "Log head", o_count: "Shown",
    o_trunc: "truncated", o_empty: "Empty window", o_has: "has payload", o_nop: "no payload",
    tv_health: "Device health", tv_devs: "Devices", tv_next: "Next predicted",
    tv_uptime: "Uptime", tv_online: "online",
    tv_readonly: "TV mode: read-only (contract §36.د)",
  },
}

/** لوحة التبويبات الثمانية — نفس أسطح REST القائمة بلا أي إضافة. */
export const TABS = [
  { id: "devices", key: "t_devices" },
  { id: "automation", key: "t_auto" },
  { id: "search", key: "t_search" },
  { id: "ask", key: "t_ask" },
  { id: "insights", key: "t_ins" },
  { id: "predictions", key: "t_pred" },
  { id: "market", key: "t_market" },
  { id: "ops", key: "t_ops" },
]

/** ترجمة بمتغيرات {n} — مفتاح غائب يعود بالمفتاح نفسه (صدق لا اختراع). */
export function t(lang, key, vars) {
  const s = I18N[lang]?.[key] ?? I18N.ar[key] ?? key
  if (!vars) return s
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s)
}

/** اتجاه اللغة — عربي RTL افتراضيًا. */
export function dirOf(lang) {
  return lang === "ar" ? "rtl" : "ltr"
}

/** وقت نسبي حتمي (now قابل للحقن للفحص). */
export function fmtRel(ms, lang, now = Date.now()) {
  if (ms == null) return "—"
  const diff = Math.max(0, now - ms)
  const m = Math.floor(diff / 60000)
  if (m < 1) return lang === "ar" ? "الآن" : "now"
  if (m < 60) return lang === "ar" ? `قبل ${m} د` : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === "ar" ? `قبل ${h} س` : `${h}h ago`
  const d = Math.floor(h / 24)
  return lang === "ar" ? `قبل ${d} يوم` : `${d}d ago`
}

/** بايت مقروء. */
export function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return "—"
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

const pad2 = (n) => String(n).padStart(2, "0")

const TRG_MAP = {
  "device.connect": "trg_device_connect", "device.disconnect": "trg_device_disconnect",
  "battery.below": "trg_battery_below", "battery.above": "trg_battery_above",
  "clip.received": "trg_clip_received", "time.once": "trg_time_once", "time.daily": "trg_time_daily",
  "health.battery.sustained": "trg_health_batt", "health.rtt.sustained": "trg_health_rtt",
  "health.silence.sustained": "trg_health_sil", "health.storage.sustained": "trg_health_sto",
}

/** خلاصة المشغل بلغة القارئ — مركّب «∧» للشرط الثانوي (عقد §33.ج). */
export function sumTrigger(tr, lang) {
  if (!tr?.kind) return "?"
  const label = t(lang, TRG_MAP[tr.kind] ?? tr.kind)
  let detail = ""
  if (tr.kind === "time.daily") detail = ` ${pad2(tr.hh)}:${pad2(tr.mm)}`
  else if (tr.kind === "time.once") detail = ` ${new Date(tr.at ?? 0).toISOString().slice(0, 16).replace("T", " ")}`
  else if (tr.kind === "battery.below" || tr.kind === "battery.above") detail = ` ${tr.threshold ?? "?"}%`
  else if (tr.kind.startsWith("health.")) detail = ` ${tr.threshold ?? "?"} · ${tr.durationMin ?? "?"}m`
  const and = tr.and?.kind ? ` ∧ ${sumTrigger(tr.and, lang)}` : ""
  return `${label}${detail}${and}`
}

/** خلاصة الفعل. */
export function sumAction(ac, lang) {
  if (!ac?.kind) return "?"
  const map = { "notify": "act_notify", "clipboard.push": "act_clip", "phone.ring": "act_ring", "wol": "act_wol" }
  const label = t(lang, map[ac.kind] ?? ac.kind)
  const arg = ac.kind === "wol" ? (ac.mac ?? "") : (ac.text ?? ac.deviceId ?? "")
  return arg ? `${label}: ${arg}` : label
}

/**
 * غلاف الجلب المُحرس — وضع التلفاز قراءة حصرًا بعقد §36.د: أي فعل غير GET
 * يُرفض قبل مغادرة العميل (الفرض في العميل نفسه لا في السيرفر فقط).
 */
export function makeGuardedFetch(impl, isTv) {
  return function guarded(path, init) {
    const method = String(init?.method ?? "GET").toUpperCase()
    if (isTv && method !== "GET") {
      return Promise.reject(new Error("TV read-only (§36.د)"))
    }
    return impl(path, init)
  }
}

// ---------------------------------------------------------------------------
// سلك الواجهة — خلف حارس document (الاستيراد النقي في Node بلا متصفح يعبر)
// ---------------------------------------------------------------------------
if (typeof document !== "undefined") {
  const TV = new URLSearchParams(location.search).get("tv") === "1"
  // §37: رمز الوصول البعيد — يُقرأ من رابط الفتح مرة واحدة ويُمرّر ترويسة
  // x-pair-token حصرًا (لا تخزين — الخصوصية أولًا §36.هـ.3). النواة المصدّرة
  // نفسها بلا تغيير — التركيب في السلك حصرًا، وSW يمرر الترويسة كما تمر كلها.
  const PAIR = new URLSearchParams(location.search).get("pair") || ""
  const api = makeGuardedFetch((p, init) => {
    if (!PAIR) return fetch(p, init)
    return fetch(p, { ...init, headers: { ...(init?.headers || {}), "x-pair-token": PAIR } })
  }, TV)

  const state = {
    lang: localStorage.getItem("nexus-web-lang") === "en" ? "en" : "ar",
    tab: "devices",
  }

  const $id = (id) => document.getElementById(id)
  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  const applyLang = () => {
    document.documentElement.lang = state.lang
    document.documentElement.dir = dirOf(state.lang)
    localStorage.setItem("nexus-web-lang", state.lang)
    const langBtn = $id("lang-btn")
    if (langBtn) langBtn.textContent = state.lang === "ar" ? "EN" : "ع"
    const tag = $id("brand-tag")
    if (tag) tag.textContent = t(state.lang, "brand_tag")
    const foot = $id("foot-zero")
    if (foot) foot.textContent = t(state.lang, "foot_zero")
    const boot = $id("boot-note")
    if (boot) boot.textContent = t(state.lang, "boot_note")
    buildTabs()
  }

  const buildTabs = () => {
    const nav = $id("tabs")
    if (!nav) return
    nav.replaceChildren()
    for (const tb of TABS) {
      const b = el("button", "tab", t(state.lang, tb.key))
      b.type = "button"
      b.setAttribute("role", "tab")
      b.setAttribute("aria-selected", state.tab === tb.id ? "true" : "false")
      b.addEventListener("click", () => goto(tb.id))
      nav.appendChild(b)
    }
  }

  const busy = (view) => {
    view.replaceChildren()
    const p = el("p", "muted")
    p.appendChild(el("span", "spin"))
    p.appendChild(document.createTextNode(" " + t(state.lang, "loading")))
    view.appendChild(p)
    return view
  }

  const fail = (view, e) => {
    const box = el("div", "err", `${t(state.lang, "err_generic")}\n${e instanceof Error ? e.message : String(e)}`)
    view.replaceChildren(box)
  }

  const kvRow = (k, v) => {
    const row = el("div", "row")
    row.appendChild(el("span", "k muted", k))
    row.appendChild(el("span", "v", v))
    return row
  }

  async function json(path, init) {
    const res = await api(path, init)
    let j = null
    try { j = await res.json() } catch { /* بلا جسم */ }
    return { status: res.status, j }
  }

  // ---- الأجهزة ----
  async function renderDevices(view) {
    busy(view)
    const { j } = await json("/api/devices")
    const devs = Array.isArray(j?.devices) ? j.devices : []
    view.replaceChildren(el("h2", "section-title", t(state.lang, "d_title")))
    if (!devs.length) { view.appendChild(el("p", "empty", t(state.lang, "d_none"))); return }
    const grid = el("div", "cards")
    for (const d of devs) {
      const c = el("div", "card")
      const head = el("div", "head")
      head.appendChild(el("h3", null, d?.name ?? d?.id ?? "?"))
      head.appendChild(el("span", `state ${d?.state ?? "offline"}`, d?.state ?? "?"))
      c.appendChild(head)
      const kv = el("div", "kv")
      kv.appendChild(kvRow(t(state.lang, "d_battery"), `${d?.battery ?? "?"}%`))
      kv.appendChild(kvRow(t(state.lang, "d_storage"), `${fmtBytes(d?.storageUsed)} / ${fmtBytes(d?.storageTotal)}`))
      kv.appendChild(kvRow(t(state.lang, "d_rtt"), `${d?.rttMs ?? "?"} ms`))
      kv.appendChild(kvRow(t(state.lang, "d_ip"), d?.ip ?? "—"))
      kv.appendChild(kvRow(t(state.lang, "d_seen"), fmtRel(d?.lastSeen, state.lang)))
      c.appendChild(kv)
      if (d?.trusted) c.appendChild(el("span", "chip inst", t(state.lang, "d_trusted")))
      const acts = el("div", "actions-row")
      const mkBtn = (label, action) => {
        const b = el("button", "btn", label)
        b.type = "button"
        b.addEventListener("click", async () => {
          b.disabled = true
          try {
            await json("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id: d.id }) })
            await renderDevices(view)
          } catch (e) { fail(view, e) }
        })
        return b
      }
      acts.appendChild(mkBtn(t(state.lang, d?.state === "connected" ? "d_disconnect" : "d_connect"), d?.state === "connected" ? "disconnect" : "connect"))
      c.appendChild(acts)
      grid.appendChild(c)
    }
    view.appendChild(grid)
  }

  // ---- الروتينات ----
  async function renderAutomation(view) {
    busy(view)
    const { j } = await json("/api/automation/rules")
    const rules = Array.isArray(j?.rules) ? j.rules : []
    view.replaceChildren(el("h2", "section-title", t(state.lang, "a_title")))

    // نموذج الإنشاء — أنواع بسيطة موثوقة فقط، والرفض المسبب يُعرض بصدق
    const det = el("details", "card")
    det.appendChild(el("summary", null, t(state.lang, "a_create")))
    const form = el("div", "form")
    const mkField = (label, input) => {
      const w = el("label")
      w.appendChild(el("span", null, label))
      w.appendChild(input)
      return w
    }
    const nameIn = el("input"); nameIn.type = "text"; nameIn.placeholder = t(state.lang, "a_name")
    const trigSel = el("select")
    for (const k of ["time.daily", "time.once", "battery.below", "battery.above", "device.connect", "device.disconnect", "clip.received"]) {
      const o = el("option", null, t(state.lang, `trg_${k.replace(/\./g, "_")}`))
      o.value = k
      trigSel.appendChild(o)
    }
    const hhIn = el("input"); hhIn.type = "number"; hhIn.value = "9"; hhIn.min = "0"; hhIn.max = "23"
    const mmIn = el("input"); mmIn.type = "number"; mmIn.value = "30"; mmIn.min = "0"; mmIn.max = "59"
    const atIn = el("input"); atIn.type = "text"; atIn.placeholder = t(state.lang, "a_at")
    const thIn = el("input"); thIn.type = "number"; thIn.value = "20"; thIn.min = "1"; thIn.max = "100"
    const actSel = el("select")
    for (const k of ["notify", "clipboard.push", "phone.ring", "wol"]) {
      const o = el("option", null, t(state.lang, `act_${k.replace(".", "_")}`))
      o.value = k
      actSel.appendChild(o)
    }
    const txtIn = el("input"); txtIn.type = "text"; txtIn.placeholder = t(state.lang, "a_text")
    form.appendChild(mkField(t(state.lang, "a_name"), nameIn))
    form.appendChild(mkField(t(state.lang, "a_trigger"), trigSel))
    form.appendChild(mkField(t(state.lang, "a_hh"), hhIn))
    form.appendChild(mkField(t(state.lang, "a_mm"), mmIn))
    form.appendChild(mkField(t(state.lang, "a_thresh"), thIn))
    form.appendChild(mkField(t(state.lang, "a_at"), atIn))
    form.appendChild(mkField(t(state.lang, "a_action"), actSel))
    form.appendChild(mkField(t(state.lang, "a_text"), txtIn))
    const msg = el("span", "muted")
    const createBtn = el("button", "btn primary", t(state.lang, "a_create_btn"))
    createBtn.type = "button"
    createBtn.addEventListener("click", async () => {
      msg.textContent = "…"
      const kind = trigSel.value
      const trigger = { kind }
      if (kind === "time.daily") { trigger.hh = Number(hhIn.value); trigger.mm = Number(mmIn.value) }
      else if (kind === "time.once") { trigger.at = Number(atIn.value) }
      else if (kind === "battery.below" || kind === "battery.above") { trigger.threshold = Number(thIn.value) }
      const action = { kind: actSel.value }
      if (actSel.value === "notify" || actSel.value === "clipboard.push") action.text = txtIn.value
      else if (actSel.value === "phone.ring" && txtIn.value) action.deviceId = txtIn.value
      else if (actSel.value === "wol" && txtIn.value) action.mac = txtIn.value
      try {
        const r = await json("/api/automation/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upsert", rule: { name: nameIn.value, trigger, action } }) })
        if (r.j?.ok) { msg.textContent = t(state.lang, "a_ok"); await renderAutomation(view) }
        else msg.textContent = `${t(state.lang, "a_fail")}: ${r.j?.error ?? r.status}`
      } catch (e) { msg.textContent = String(e instanceof Error ? e.message : e) }
    })
    form.appendChild(createBtn)
    form.appendChild(msg)
    det.appendChild(form)
    view.appendChild(det)

    const list = el("div", "list")
    if (!rules.length) { view.appendChild(el("p", "empty", t(state.lang, "a_none"))); return }
    for (const r of rules) {
      const item = el("div", "list-item")
      const head = el("div", "head")
      head.appendChild(el("h3", null, r?.name ?? "?"))
      const chips = el("div", "chips")
      chips.appendChild(el("span", `chip ${r?.enabled ? "inst" : ""}`, r?.enabled ? t(state.lang, "a_enabled") : t(state.lang, "a_disabled")))
      if (r?.origin?.plugin) chips.appendChild(el("span", "chip", `${t(state.lang, "a_origin")}: ${r.origin.plugin}`))
      head.appendChild(chips)
      item.appendChild(head)
      item.appendChild(el("div", "snippet", `${sumTrigger(r?.trigger, state.lang)} → ${sumAction(r?.action, state.lang)}`))
      const acts = el("div", "actions-row")
      const runB = el("button", "btn", t(state.lang, "a_run"))
      runB.type = "button"
      runB.addEventListener("click", async () => {
        runB.disabled = true
        try { await json("/api/automation/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run", id: r.id }) }); runB.disabled = false }
        catch (e) { fail(view, e) }
      })
      const delB = el("button", "btn danger", t(state.lang, "a_delete"))
      delB.type = "button"
      delB.addEventListener("click", async () => {
        if (!confirm(t(state.lang, "a_confirm"))) return
        try {
          await json("/api/automation/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: r.id }) })
          await renderAutomation(view)
        } catch (e) { fail(view, e) }
      })
      acts.appendChild(runB); acts.appendChild(delB)
      item.appendChild(acts)
      list.appendChild(item)
    }
    view.appendChild(list)
  }

  // ---- البحث ----
  function renderSearch(view) {
    view.replaceChildren(el("h2", "section-title", t(state.lang, "t_search")))
    const f = el("form")
    const qIn = el("input")
    qIn.type = "search"; qIn.placeholder = t(state.lang, "s_ph")
    const go = el("button", "btn primary", t(state.lang, "s_btn"))
    go.type = "submit"
    f.appendChild(qIn); f.appendChild(go)
    const res = el("div", "list")
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault()
      res.replaceChildren(el("p", "muted", "…"))
      try {
        const { j } = await json(`/api/search?q=${encodeURIComponent(qIn.value.slice(0, 80))}`)
        res.replaceChildren()
        res.appendChild(el("p", "muted", `${t(state.lang, "s_total", { n: j?.total ?? 0 })} · ${t(state.lang, "s_took", { n: j?.took ?? 0 })}`))
        for (const g of j?.groups ?? []) {
          const items = Array.isArray(g?.items) ? g.items : []
          if (!items.length) continue
          const box = el("div", "card")
          box.appendChild(el("h3", null, t(state.lang, `g_${g?.kind ?? ""}`)))
          for (const it of items.slice(0, 12)) {
            const row = el("div", "row")
            const left = el("div")
            left.appendChild(el("div", null, it?.title ?? "?"))
            left.appendChild(el("div", "snippet", it?.snippet ?? ""))
            row.appendChild(left)
            row.appendChild(el("span", "score", String(it?.score ?? "")))
            box.appendChild(row)
          }
          res.appendChild(box)
        }
        if (!res.childNodes.length) res.appendChild(el("p", "empty", t(state.lang, "empty")))
      } catch (e) { fail(res, e) }
    })
    view.appendChild(f)
    view.appendChild(res)
  }

  // ---- المساعد ----
  function renderAsk(view) {
    view.replaceChildren(el("h2", "section-title", t(state.lang, "t_ask")))
    const f = el("form")
    const qIn = el("input")
    qIn.type = "search"; qIn.placeholder = t(state.lang, "k_ph")
    const go = el("button", "btn primary", t(state.lang, "k_btn"))
    go.type = "submit"
    f.appendChild(qIn); f.appendChild(go)
    const res = el("div", "list")
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault()
      res.replaceChildren(el("p", "muted", "…"))
      try {
        const { j } = await json("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: qIn.value.slice(0, 300) }) })
        res.replaceChildren()
        const box = el("div", "card")
        box.appendChild(el("div", null, String(j?.answer ?? t(state.lang, "err_generic"))))
        if (j?.intent) box.appendChild(el("span", "chip", String(j.intent)))
        res.appendChild(box)
        const evList = Array.isArray(j?.evidence) ? j.evidence : []
        for (const evLine of evList.slice(0, 8)) {
          res.appendChild(el("div", "evidence", `${t(state.lang, "k_evidence")}: ${typeof evLine === "string" ? evLine : JSON.stringify(evLine)}`))
        }
      } catch (e) { fail(res, e) }
    })
    view.appendChild(f)
    view.appendChild(res)
  }

  // ---- الرؤى (توليد عام — كل الخلايا العددية بعمق ≤2) ----
  async function renderInsights(view) {
    busy(view)
    const { j } = await json("/api/insights")
    view.replaceChildren(el("h2", "section-title", t(state.lang, "i_title")))
    const grid = el("div", "cards")
    const flat = []
    const walk = (obj, pre) => {
      for (const [k, v] of Object.entries(obj ?? {})) {
        const key = pre ? `${pre}.${k}` : k
        if (v != null && typeof v === "object") walk(v, key)
        else flat.push([key, String(v)])
      }
    }
    walk(j)
    for (const [k, v] of flat) {
      const c = el("div", "card")
      c.appendChild(kvRow(k, v))
      grid.appendChild(c)
    }
    view.appendChild(grid)
  }

  // ---- التنبؤ ----
  async function renderPredictions(view) {
    busy(view)
    const { j } = await json("/api/predictions")
    view.replaceChildren(el("h2", "section-title", t(state.lang, "p_title")))
    view.appendChild(el("span", "badge", t(state.lang, "p_window", { n: j?.windowDays ?? 14 })))
    const list = el("div", "list")
    const forecasts = Array.isArray(j?.forecasts) ? j.forecasts : []
    const suggestions = Array.isArray(j?.suggestions) ? j.suggestions : []
    if (!forecasts.length && !suggestions.length) list.appendChild(el("p", "empty", t(state.lang, "p_none")))
    if (forecasts.length) list.appendChild(el("h3", null, t(state.lang, "p_f")))
    for (const f of forecasts) {
      const item = el("div", "list-item")
      const head = el("div", "head")
      head.appendChild(el("h3", null, f?.ruleName ?? f?.ruleId ?? "?"))
      if (f?.stale) head.appendChild(el("span", "stale-tag", t(state.lang, "p_stale")))
      item.appendChild(head)
      const basisBits = []
      if (f?.pattern) basisBits.push(f.pattern === "daily" ? t(state.lang, "p_daily") : t(state.lang, "p_interval"))
      if (f?.basis?.hhmm) basisBits.push(f.basis.hhmm)
      if (typeof f?.basis?.fires === "number") basisBits.push(`×${f.basis.fires}`)
      item.appendChild(el("div", "snippet", basisBits.join(" · ")))
      item.appendChild(el("div", "snippet", `${t(state.lang, "p_next")}: ${f?.nextPredictedAt ? new Date(f.nextPredictedAt).toLocaleString() : "—"}`))
      if (f?.basis) item.appendChild(el("div", "evidence", JSON.stringify(f.basis)))
      list.appendChild(item)
    }
    if (suggestions.length) list.appendChild(el("h3", null, t(state.lang, "p_s")))
    for (const s of suggestions) {
      const item = el("div", "list-item")
      const head = el("div", "head")
      head.appendChild(el("h3", null, `${s?.source ?? "?"}${s?.deviceId ? ` · ${s.deviceId}` : ""}`))
      const b = el("button", "btn", t(state.lang, "p_create"))
      b.type = "button"
      b.addEventListener("click", async () => {
        b.disabled = true
        try {
          await json("/api/automation/rules", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "upsert",
              rule: {
                name: `${s?.source ?? "suggestion"} · ${s?.deviceId ?? "device"}`,
                trigger: s?.suggestedTrigger ?? {},
                action: { kind: "notify", text: `§36 ${s?.source ?? ""}` },
              },
            }),
          })
          b.textContent = t(state.lang, "p_created")
        } catch (e) { fail(item, e) }
      })
      head.appendChild(b)
      item.appendChild(head)
      if (s?.reason) item.appendChild(el("div", "evidence", s.reason))
      list.appendChild(item)
    }
    view.appendChild(list)
  }

  // ---- السوق ----
  async function renderMarket(view) {
    busy(view)
    const { j } = await json("/api/marketplace")
    view.replaceChildren(el("h2", "section-title", t(state.lang, "m_title")))
    const chips = el("div", "chips")
    if (j?.keyFp) chips.appendChild(el("span", "chip", `${t(state.lang, "m_fp")}: ${j.keyFp}`))
    const installedIds = new Set((j?.installed ?? []).map((x) => x?.manifest?.id))
    chips.appendChild(el("span", "chip inst", `${t(state.lang, "m_installed")}: ${installedIds.size}`))
    view.appendChild(chips)
    const channel = Array.isArray(j?.channel) ? j.channel : []
    if (!channel.length) { view.appendChild(el("p", "empty", t(state.lang, "m_none"))); return }
    const grid = el("div", "cards")
    for (const it of channel) {
      const m = it?.manifest ?? {}
      const c = el("div", "card")
      const head = el("div", "head")
      head.appendChild(el("h3", null, m?.name ?? m?.id ?? "?"))
      if (installedIds.has(m?.id)) head.appendChild(el("span", "chip inst", t(state.lang, "m_installed")))
      c.appendChild(head)
      c.appendChild(el("div", "snippet", m?.description ?? ""))
      const meta = el("div", "kv")
      meta.appendChild(kvRow("v", m?.version ?? "—"))
      if (it?.pub?.id) meta.appendChild(kvRow(t(state.lang, "m_pub"), `${it.pub.id} · kv ${it.pub.kv ?? "?"}`))
      c.appendChild(meta)
      const caps = el("div", "chips")
      for (const cap of m?.capabilities ?? []) caps.appendChild(el("span", "chip cap", String(cap)))
      c.appendChild(caps)
      const isInst = installedIds.has(m?.id)
      const b = el("button", `btn ${isInst ? "danger" : "primary"}`, isInst ? t(state.lang, "m_remove") : t(state.lang, "m_install"))
      b.type = "button"
      b.addEventListener("click", async () => {
        b.disabled = true
        try {
          await json("/api/marketplace", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(isInst ? { action: "uninstall", id: m.id } : { action: "install", manifest: m, sig: it?.sig ?? "", pub: it?.pub ?? null }),
          })
          await renderMarket(view)
        } catch (e) { fail(c, e) }
      })
      c.appendChild(b)
      grid.appendChild(c)
    }
    view.appendChild(grid)
  }

  // ---- العمليات (قراءة حصرًا — F6 محفوظ: الحمولة فارغة مع العلم) ----
  async function renderOps(view) {
    busy(view)
    const { j } = await json("/api/sync/ops?since=0")
    view.replaceChildren(el("h2", "section-title", t(state.lang, "o_title")))
    const chips = el("div", "chips")
    chips.appendChild(el("span", "chip", `${t(state.lang, "o_head")}: ${j?.head ?? 0}`))
    chips.appendChild(el("span", "chip", `${t(state.lang, "o_count")}: ${j?.count ?? 0}`))
    if (j?.truncated) chips.appendChild(el("span", "chip payload", t(state.lang, "o_trunc")))
    view.appendChild(chips)
    const list = el("div", "list")
    const ops = Array.isArray(j?.ops) ? j.ops : []
    if (!ops.length) { view.appendChild(el("p", "empty", t(state.lang, "o_empty"))); return }
    for (const o of ops.slice(-60)) {
      const item = el("div", "list-item")
      const head = el("div", "head")
      head.appendChild(el("h3", null, `#${o?.seq ?? "?"} · ${o?.kind ?? "?"}`))
      const ch = el("div", "chips")
      ch.appendChild(el("span", `chip ${o?.hasPayload ? "payload" : "nopayload"}`, o?.hasPayload ? t(state.lang, "o_has") : t(state.lang, "o_nop")))
      head.appendChild(ch)
      item.appendChild(head)
      item.appendChild(el("div", "snippet", `${o?.deviceId ?? "—"} · ${fmtRel(o?.at, state.lang)} · ${o?.opId ?? ""}`))
      list.appendChild(item)
    }
    view.appendChild(list)
  }

  // ---- التلفاز (§36.د) — قراءة حصرًا عبر الغلاف المُحرس ----
  async function renderTv(view) {
    const tick = () => {
      const clock = $id("tv-clock")
      if (clock) clock.textContent = new Date().toLocaleTimeString(state.lang === "ar" ? "ar" : "en", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      const date = $id("tv-date")
      if (date) date.textContent = new Date().toLocaleDateString(state.lang === "ar" ? "ar" : "en", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    }
    view.replaceChildren()
    const clockBox = el("div", "tv-clock", "--:--:--"); clockBox.id = "tv-clock"; view.appendChild(clockBox)
    const dateBox = el("div", "tv-date"); dateBox.id = "tv-date"; view.appendChild(dateBox)
    view.appendChild(el("p", "muted", t(state.lang, "tv_readonly")))
    const grid = el("div", "tv-grid")
    const left = el("div")
    left.appendChild(el("h2", "tv-sec-title", t(state.lang, "tv_devs")))
    const devsBox = el("div", "tv-devs"); devsBox.id = "tv-devs"; left.appendChild(devsBox)
    const right = el("div")
    right.appendChild(el("h2", "tv-sec-title", t(state.lang, "tv_health")))
    const kpis = el("div", "tv-kpis"); kpis.id = "tv-kpis"; right.appendChild(kpis)
    right.appendChild(el("h2", "tv-sec-title", t(state.lang, "tv_next")))
    const nextBox = el("div", "tv-devs"); nextBox.id = "tv-next"; right.appendChild(nextBox)
    grid.appendChild(left); grid.appendChild(right)
    view.appendChild(grid)
    tick()
    setInterval(tick, 1000)
    const pull = async () => {
      try {
        const [{ j: dj }, { j: hj }, { j: pj }] = await Promise.all([json("/api/devices"), json("/api/health"), json("/api/predictions")])
        const devs = Array.isArray(dj?.devices) ? dj.devices : []
        const online = devs.filter((d) => d?.state === "connected").length
        const db = $id("tv-devs")
        if (db) {
          db.replaceChildren()
          for (const d of devs.slice(0, 12)) {
            db.appendChild(el("span", `tv-dev state ${d?.state}`, `${d?.name ?? d?.id} · ${d?.battery ?? "?"}%`))
          }
          if (!devs.length) db.appendChild(el("span", "tv-dev muted", t(state.lang, "d_none")))
        }
        const kb = $id("tv-kpis")
        if (kb) {
          kb.replaceChildren()
          const kpi = (big, small) => { const k = el("div", "tv-kpi"); k.appendChild(el("b", null, big)); k.appendChild(el("span", null, small)); return k }
          kb.appendChild(kpi(`${online}/${devs.length}`, t(state.lang, "tv_online")))
          kb.appendChild(kpi(hj?.ok ? "OK" : "—", t(state.lang, "tv_health")))
          kb.appendChild(kpi(`${Math.floor((hj?.uptime ?? 0) / 3600)}h`, t(state.lang, "tv_uptime")))
        }
        const nb = $id("tv-next")
        if (nb) {
          nb.replaceChildren()
          const future = (pj?.forecasts ?? []).filter((x) => x?.nextPredictedAt > Date.now())
          const f = future.sort((a, b) => a.nextPredictedAt - b.nextPredictedAt)[0]
          nb.appendChild(el("span", "tv-dev", f ? `${f?.ruleName ?? f?.ruleId} · ${new Date(f.nextPredictedAt).toLocaleTimeString()}` : t(state.lang, "p_none")))
        }
      } catch { /* التلفاز يبقى صامتًا — حلقة قادمة */ }
    }
    await pull()
    setInterval(pull, 30000)
  }

  const RENDER = {
    devices: renderDevices, automation: renderAutomation, search: renderSearch, ask: renderAsk,
    insights: renderInsights, predictions: renderPredictions, market: renderMarket, ops: renderOps,
  }

  async function goto(id) {
    state.tab = id
    buildTabs()
    const view = $id("view")
    if (!view) return
    try { await RENDER[id](view) } catch (e) { fail(view, e) }
  }

  const boot = async () => {
    if (TV) document.body.classList.add("tv")
    applyLang()
    const langBtn = $id("lang-btn")
    langBtn?.addEventListener("click", () => { state.lang = state.lang === "ar" ? "en" : "ar"; applyLang(); if (!TV) goto(state.tab) })
    const origin = $id("foot-origin")
    if (origin) origin.textContent = location.origin
    try {
      const [{ j: h }, { j: v }] = await Promise.all([json("/api/health"), json("/api/version")])
      const dot = $id("health-dot")
      if (dot) { dot.className = `dot ${h?.ok ? "ok" : "off"}`; dot.title = t(state.lang, h?.ok ? "health_ok" : "health_off") }
      const vb = $id("ver-badge")
      if (vb && v?.current) { vb.hidden = false; vb.textContent = `v${v.current}` }
    } catch { /* النقطة تبقى مطفأة — صدق لا تزيين */ }
    if (TV) await renderTv($id("view"))
    else await goto(state.tab)
    if ("serviceWorker" in navigator && !TV) {
      navigator.serviceWorker.register("/web-client/sw.js").catch(() => {})
    }
  }

  void boot()
}
