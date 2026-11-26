// Nexus Link Cloud Mode: hosted link-in-bio page, analytics, optional lead capture.
// One Cloudflare Worker + D1. Opt-in only: the app talks to this service only after the owner enables Cloud Mode.
// Stored: page JSON, click/view events (hour, country, referrer host), leads the visitor submitted themselves.
// Never stored: IP addresses, user agents, cookies.

const RETENTION_DAYS = 395 // ~13 months
const MAX_PAGE_BYTES = 64 * 1024
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/
const THEMES = { violet: ["#6366F1", "#A855F7", "#0B0C24"], ocean: ["#0EA5E9", "#14B8A6", "#06121F"], sunset: ["#F97316", "#EC4899", "#1A0B1E"] }

const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } })
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const now = () => Math.floor(Date.now() / 1000)

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
const httpUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null } catch { return null } }
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "")

/** Validate and normalise a published page. Returns {ok, page} or {ok:false, error}. */
export function validatePage(p) {
  if (!p || typeof p !== "object") return { ok: false, error: "page" }
  const links = []
  for (const l of Array.isArray(p.links) ? p.links.slice(0, 24) : []) {
    const url = httpUrl(l?.url)
    const id = str(l?.id, 24)
    if (!url || !/^[a-z0-9_-]{1,24}$/i.test(id)) return { ok: false, error: "link" }
    links.push({ id, label: str(l.label, 40), url, color: /^#[0-9a-f]{6}$/i.test(l.color ?? "") ? l.color : "#4F46E5", startsAt: Number.isFinite(l.startsAt) ? l.startsAt : null, endsAt: Number.isFinite(l.endsAt) ? l.endsAt : null })
  }
  const banners = []
  for (const b of Array.isArray(p.banners) ? p.banners.slice(0, 6) : []) {
    const url = httpUrl(b?.url)
    if (!url) return { ok: false, error: "banner" }
    banners.push({ id: str(b.id, 24), title: str(b.title, 80), body: str(b.body, 160), cta: str(b.cta, 24), url, startsAt: Number.isFinite(b.startsAt) ? b.startsAt : null, endsAt: Number.isFinite(b.endsAt) ? b.endsAt : null })
  }
  let photo = ""
  if (typeof p.photo === "string" && p.photo) {
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo) && p.photo.length <= 90000) photo = p.photo
    else if (httpUrl(p.photo)?.startsWith("https:")) photo = p.photo
    else return { ok: false, error: "photo" }
  }
  return {
    ok: true,
    page: {
      name: str(p.name, 60) || "Nexus Link",
      role: str(p.role, 100),
      photo,
      lang: p.lang === "en" ? "en" : "ar",
      theme: THEMES[p.theme] ? p.theme : "violet",
      animated: !!p.animated,
      capture: { enabled: !!p.capture?.enabled, label: str(p.capture?.label, 80), consent: str(p.capture?.consent, 200) },
      links,
      banners,
    },
  }
}

const live = (x, t) => (x.startsAt == null || t >= x.startsAt) && (x.endsAt == null || t <= x.endsAt)

export function renderPage(handle, page, t = now()) {
  const [c1, c2, bg] = THEMES[page.theme]
  const rtl = page.lang === "ar"
  const L = rtl
    ? { notice: "هذه الصفحة تحصي الزيارات والنقرات (بدون حفظ عنوان IP).", send: "إرسال", ph: "بريدك الإلكتروني أو رقمك", ok: "تم الاستلام" }
    : { notice: "This page counts visits and clicks (no IP address is stored).", send: "Send", ph: "Your email or phone", ok: "Received" }
  const banners = page.banners.filter((b) => live(b, t))
  const links = page.links.filter((l) => live(l, t))
  const b0 = banners.map((b) => `<a class="ban" href="${esc(b.url)}" rel="noopener noreferrer"><b>${esc(b.title)}</b><span>${esc(b.body)}</span><i>${esc(b.cta)}</i></a>`).join("")
  const lk = links.map((l) => `<a class="lk" style="background:${esc(l.color)}" href="/go/${esc(handle)}/${esc(l.id)}" rel="noopener noreferrer">${esc(l.label)}</a>`).join("")
  const form = page.capture.enabled
    ? `<form id="f" class="card"><p>${esc(page.capture.label)}</p><input name="v" required maxlength="120" placeholder="${esc(L.ph)}"><label class="c"><input type="checkbox" required> ${esc(page.capture.consent)}</label><button>${esc(L.send)}</button><em id="m"></em></form>
<script>document.getElementById("f").addEventListener("submit",async e=>{e.preventDefault();const f=e.target;const r=await fetch("/lead/${esc(handle)}",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value:f.v.value,consent:true})});document.getElementById("m").textContent=r.ok?${JSON.stringify(L.ok)}:"!";if(r.ok)f.reset()})</script>`
    : ""
  return `<!doctype html><html lang="${page.lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.name)}</title>
<style>:root{--a:${c1};--b:${c2}}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:${bg};color:#fff;font:16px/1.5 system-ui,sans-serif;display:flex;justify-content:center}
body:before{content:"";position:fixed;inset:-20%;background:radial-gradient(40% 30% at 50% 10%,${c1}59,transparent);${page.animated ? "animation:d 9s ease-in-out infinite alternate;" : ""}pointer-events:none}
@keyframes d{to{transform:translateY(40px) scale(1.2)}}@media(prefers-reduced-motion:reduce){body:before{animation:none}}
main{position:relative;width:100%;max-width:440px;padding:28px 18px;text-align:center}.av{width:96px;height:96px;border-radius:50%;padding:3px;background:linear-gradient(135deg,var(--a),var(--b));margin:0 auto 10px}.av img{width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid ${bg}}
h1{margin:6px 0 0;font-size:22px}.role{color:#A5B4FC;margin:2px 0 18px;font-size:14px}.ban{display:flex;flex-direction:column;gap:2px;text-align:start;padding:14px 16px;margin-bottom:10px;border-radius:16px;color:#fff;text-decoration:none;background:linear-gradient(135deg,var(--a),var(--b))}.ban span{opacity:.85;font-size:13px}.ban i{font-style:normal;font-size:12px;opacity:.9}
.lk{display:block;padding:14px;margin:10px 0;border-radius:16px;color:#fff;text-decoration:none;font-weight:600;border:1px solid #ffffff40}.card{margin-top:18px;padding:14px;border-radius:16px;background:#ffffff14;border:1px solid #ffffff26}.card input:not([type=checkbox]){width:100%;padding:10px;border-radius:10px;border:0;margin:6px 0}.c{display:block;font-size:12px;opacity:.8}.card button{margin-top:8px;padding:10px 18px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--a),var(--b));color:#fff;font-weight:600}
footer{margin-top:22px;font-size:11px;color:#64748B}</style></head><body><main>
${page.photo ? `<div class="av"><img src="${esc(page.photo)}" alt="${esc(page.name)}"></div>` : ""}<h1>${esc(page.name)}</h1><p class="role">${esc(page.role)}</p>${b0}${lk}${form}<footer>${esc(L.notice)}</footer></main></body></html>`
}

async function authOwner(env, handle, req) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (tok.length < 32) return false
  const row = await env.DB.prepare("SELECT token_hash FROM pages WHERE handle=?").bind(handle).first()
  return !!row && safeEqual(row.token_hash, await sha256Hex(tok))
}

function refHost(req) {
  try { const h = new URL(req.headers.get("referer") || "").hostname; return h.slice(0, 80) || null } catch { return null }
}
function countryOf(req) {
  const c = (req.cf && req.cf.country) || req.headers.get("cf-ipcountry") || ""
  return /^[A-Z]{2}$/.test(c) ? c : null
}

async function record(env, handle, kind, linkId, req) {
  const t = now()
  await env.DB.prepare("INSERT INTO events(handle,ts,kind,link_id,ref_host,country,hour) VALUES(?,?,?,?,?,?,?)")
    .bind(handle, t, kind, linkId, refHost(req), countryOf(req), new Date(t * 1000).getUTCHours()).run()
  if (t % 50 === 0) await env.DB.prepare("DELETE FROM events WHERE ts<?").bind(t - RETENTION_DAYS * 86400).run()
}

export async function stats(env, handle, days = 30) {
  const since = now() - days * 86400
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(handle, since, ...a).all()).results
  const [tot] = await q("SELECT SUM(kind='view') AS views, SUM(kind='click') AS clicks FROM events WHERE handle=? AND ts>=?")
  return {
    days,
    views: tot?.views ?? 0,
    clicks: tot?.clicks ?? 0,
    perLink: await q("SELECT link_id AS id, COUNT(*) AS n FROM events WHERE handle=? AND ts>=? AND kind='click' GROUP BY link_id ORDER BY n DESC"),
    sources: await q("SELECT COALESCE(ref_host,'direct') AS source, COUNT(*) AS n FROM events WHERE handle=? AND ts>=? AND kind='view' GROUP BY 1 ORDER BY n DESC LIMIT 20"),
    countries: await q("SELECT COALESCE(country,'??') AS country, COUNT(*) AS n FROM events WHERE handle=? AND ts>=? GROUP BY 1 ORDER BY n DESC LIMIT 30"),
    hours: await q("SELECT hour, COUNT(*) AS n FROM events WHERE handle=? AND ts>=? GROUP BY hour ORDER BY hour"),
  }
}

const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && !/^\+[0-9][0-9 ()-]{6,19}$/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"` }

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const parts = url.pathname.split("/").filter(Boolean)
    const m = req.method

    try {
      // ---- owner API ----
      if (parts[0] === "api") {
        const handle = (url.searchParams.get("handle") || "").toLowerCase()
        if (parts[1] === "pages" && m === "PUT") {
          const body = await req.text()
          if (body.length > MAX_PAGE_BYTES) return json({ error: "too_large" }, 413)
          const { handle: h, page } = JSON.parse(body)
          const hh = String(h || "").toLowerCase()
          if (!HANDLE_RE.test(hh)) return json({ error: "handle" }, 400)
          const v = validatePage(page)
          if (!v.ok) return json({ error: v.error }, 400)
          const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
          if (tok.length < 32) return json({ error: "token" }, 401)
          const existing = await env.DB.prepare("SELECT token_hash FROM pages WHERE handle=?").bind(hh).first()
          const th = await sha256Hex(tok)
          if (existing && !safeEqual(existing.token_hash, th)) return json({ error: "forbidden" }, 403)
          const t = now()
          if (existing) await env.DB.prepare("UPDATE pages SET json=?, updated_at=? WHERE handle=?").bind(JSON.stringify(v.page), t, hh).run()
          else await env.DB.prepare("INSERT INTO pages(handle,token_hash,json,created_at,updated_at) VALUES(?,?,?,?,?)").bind(hh, th, JSON.stringify(v.page), t, t).run()
          return json({ ok: true, url: `${url.origin}/${hh}` })
        }
        if (!HANDLE_RE.test(handle)) return json({ error: "handle" }, 400)
        if (!(await authOwner(env, handle, req))) return json({ error: "unauthorized" }, 401)
        if (parts[1] === "stats" && m === "GET") return json(await stats(env, handle, Math.min(395, Math.max(1, Number(url.searchParams.get("days")) || 30))))
        if (parts[1] === "leads.csv" && m === "GET") {
          const rows = (await env.DB.prepare("SELECT ts,value FROM leads WHERE handle=? ORDER BY ts DESC").bind(handle).all()).results
          const csv = "\ufeff" + ["time_utc,value", ...rows.map((r) => `${csvCell(new Date(r.ts * 1000).toISOString())},${csvCell(r.value)}`)].join("\r\n") + "\r\n"
          return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${handle}-leads.csv"`, "cache-control": "no-store" } })
        }
        if (parts[1] === "pages" && m === "DELETE") {
          for (const tbl of ["events", "leads", "pages"]) await env.DB.prepare(`DELETE FROM ${tbl} WHERE handle=?`).bind(handle).run()
          return json({ ok: true })
        }
        return json({ error: "not_found" }, 404)
      }

      // ---- visitor: click redirect (target comes only from the stored page: no open redirect) ----
      if (parts[0] === "go" && parts.length === 3 && m === "GET") {
        const [, handle, linkId] = parts
        const row = await env.DB.prepare("SELECT json FROM pages WHERE handle=?").bind(handle).first()
        if (!row) return new Response("Not found", { status: 404 })
        const l = JSON.parse(row.json).links.find((x) => x.id === linkId && live(x, now()))
        if (!l) return new Response("Not found", { status: 404 })
        await record(env, handle, "click", linkId, req)
        return Response.redirect(l.url, 302)
      }

      // ---- visitor: lead capture ----
      if (parts[0] === "lead" && parts.length === 2 && m === "POST") {
        const handle = parts[1]
        const row = await env.DB.prepare("SELECT json FROM pages WHERE handle=?").bind(handle).first()
        if (!row || !JSON.parse(row.json).capture.enabled) return json({ error: "disabled" }, 404)
        const b = await req.json().catch(() => null)
        const v = String(b?.value ?? "").trim()
        const okEmail = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
        const okPhone = /^\+?[0-9 ()-]{7,20}$/.test(v)
        if (b?.consent !== true || !(okEmail || okPhone)) return json({ error: "invalid" }, 400)
        await env.DB.prepare("INSERT INTO leads(handle,ts,value) VALUES(?,?,?)").bind(handle, now(), v.slice(0, 120)).run()
        return json({ ok: true })
      }

      // ---- visitor: the page ----
      if (parts.length === 1 && m === "GET" && HANDLE_RE.test(parts[0])) {
        const row = await env.DB.prepare("SELECT json FROM pages WHERE handle=?").bind(parts[0]).first()
        if (!row) return new Response("Not found", { status: 404 })
        await record(env, parts[0], "view", null, req)
        return new Response(renderPage(parts[0], JSON.parse(row.json)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } })
      }
      return new Response("Not found", { status: 404 })
    } catch {
      return json({ error: "server" }, 500)
    }
  },
}
