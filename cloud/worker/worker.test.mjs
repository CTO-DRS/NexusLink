// Run: node --test cloud/worker/worker.test.mjs   (Node 22+, uses the built-in node:sqlite as a stand-in for D1)
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { DatabaseSync } from "node:sqlite"
import worker, { validatePage, renderPage } from "./index.mjs"

function makeEnv() {
  const db = new DatabaseSync(":memory:")
  db.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"))
  const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({ run: async () => { st.run(...a) }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }) }) } } }
  return { DB, db }
}
const TOKEN = "t".repeat(40)
const OTHER = "o".repeat(40)
const page = {
  name: "CTO: DRS", role: "App developer", theme: "ocean", animated: true, lang: "ar",
  capture: { enabled: true, label: "Leave your email", consent: "I agree to be contacted" },
  links: [
    { id: "tg", label: "Telegram", url: "https://t.me/CTO_DRS", color: "#229ED9" },
    { id: "offer", label: "24h offer", url: "https://example.com/o", startsAt: 4102444800 }, // far future
  ],
  banners: [{ id: "b1", title: "New app", body: "Soon", cta: "Go", url: "https://example.com", endsAt: 1 }], // expired
}
const call = (env, path, init = {}) => worker.fetch(new Request("https://x.test" + path, init), env)
const auth = (t) => ({ authorization: "Bearer " + t })

test("publish, ownership and token handling", async () => {
  const { DB, db } = makeEnv(); const env = { DB }
  let r = await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page }) })
  assert.equal(r.status, 200)
  r = await call(env, "/api/pages", { method: "PUT", headers: auth(OTHER), body: JSON.stringify({ handle: "drs", page }) })
  assert.equal(r.status, 403)
  r = await call(env, "/api/pages", { method: "PUT", headers: auth("short"), body: JSON.stringify({ handle: "drs2", page }) })
  assert.equal(r.status, 401)
  const row = db.prepare("SELECT token_hash FROM pages WHERE handle='drs'").get()
  assert.notEqual(row.token_hash, TOKEN) // the token is never stored
  assert.equal(row.token_hash.length, 64)
})

test("validation rejects bad urls, handles and photos", async () => {
  assert.equal(validatePage({ links: [{ id: "a", label: "x", url: "javascript:alert(1)" }] }).ok, false)
  assert.equal(validatePage({ links: [], banners: [{ url: "data:text/html,x" }] }).ok, false)
  assert.equal(validatePage({ links: [], photo: "http://insecure/x.jpg" }).ok, false)
  assert.equal(validatePage({ links: [], theme: "nope" }).page.theme, "violet")
  const { DB } = makeEnv()
  const r = await call({ DB }, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "A_B", page }) })
  assert.equal(r.status, 400)
})

test("page renders safely, hides scheduled items, counts a view without storing IP", async () => {
  const { DB, db } = makeEnv(); const env = { DB }
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page: { ...page, name: "<script>x</script>" } }) })
  const r = await call(env, "/drs", { headers: { referer: "https://t.co/abc?secret=1", "cf-ipcountry": "SA", "x-forwarded-for": "203.0.113.9" } })
  const html = await r.text()
  assert.equal(r.status, 200)
  assert.ok(!html.includes("<script>x</script>")) // name escaped
  assert.ok(html.includes("&lt;script&gt;"))
  assert.ok(html.includes("/go/drs/tg"))
  assert.ok(!html.includes("/go/drs/offer")) // not live yet
  assert.ok(!html.includes("New app")) // banner expired
  assert.ok(html.includes("بدون حفظ عنوان IP"))
  const ev = db.prepare("SELECT * FROM events").all()
  assert.equal(ev.length, 1)
  assert.equal(ev[0].ref_host, "t.co") // host only
  assert.equal(ev[0].country, "SA")
  assert.ok(!JSON.stringify(ev).includes("203.0.113.9"))
  assert.equal((await call(env, "/nope")).status, 404)
})

test("click redirect uses stored url only and is counted", async () => {
  const { DB } = makeEnv(); const env = { DB }
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page }) })
  const r = await call(env, "/go/drs/tg", { redirect: "manual", headers: { "cf-ipcountry": "AE" } })
  assert.equal(r.status, 302)
  assert.equal(r.headers.get("location"), "https://t.me/CTO_DRS")
  assert.equal((await call(env, "/go/drs/offer")).status, 404)
  assert.equal((await call(env, "/go/drs/../etc")).status, 404)
})

test("stats are owner-only and aggregate sources, countries, hours", async () => {
  const { DB } = makeEnv(); const env = { DB }
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page }) })
  await call(env, "/drs", { headers: { referer: "https://t.co/x", "cf-ipcountry": "SA" } })
  await call(env, "/drs", { headers: { "cf-ipcountry": "SA" } })
  await call(env, "/go/drs/tg", { redirect: "manual", headers: { "cf-ipcountry": "AE" } })
  assert.equal((await call(env, "/api/stats?handle=drs")).status, 401)
  assert.equal((await call(env, "/api/stats?handle=drs", { headers: auth(OTHER) })).status, 401)
  const s = await (await call(env, "/api/stats?handle=drs", { headers: auth(TOKEN) })).json()
  assert.equal(s.views, 2); assert.equal(s.clicks, 1)
  assert.deepEqual(s.perLink, [{ id: "tg", n: 1 }])
  assert.deepEqual(s.sources.map((x) => x.source).sort(), ["direct", "t.co"])
  assert.deepEqual(s.countries.find((c) => c.country === "SA").n, 2)
  assert.equal(s.hours.reduce((a, h) => a + h.n, 0), 3)
})

test("lead capture needs consent and a valid value; CSV export is owner-only and injection-safe", async () => {
  const { DB } = makeEnv(); const env = { DB }
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page }) })
  const post = (b) => call(env, "/lead/drs", { method: "POST", body: JSON.stringify(b) })
  assert.equal((await post({ value: "a@b.co", consent: false })).status, 400)
  assert.equal((await post({ value: "not valid", consent: true })).status, 400)
  assert.equal((await post({ value: "a@b.co", consent: true })).status, 200)
  assert.equal((await post({ value: "+966 55 340 5949", consent: true })).status, 200)
  assert.equal((await post({ value: "=cmd@x.co", consent: true })).status, 200) // valid shape, must be neutralised in CSV
  assert.equal((await call(env, "/api/leads.csv?handle=drs")).status, 401)
  const csv = await (await call(env, "/api/leads.csv?handle=drs", { headers: auth(TOKEN) })).text()
  assert.ok(csv.includes('"a@b.co"') && csv.includes('"+966 55 340 5949"'))
  assert.ok(csv.includes(`"'=cmd@x.co"`))
  // capture disabled page rejects leads
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page: { ...page, capture: { enabled: false } } }) })
  assert.equal((await post({ value: "a@b.co", consent: true })).status, 404)
})

test("delete removes the page and all its data", async () => {
  const { DB, db } = makeEnv(); const env = { DB }
  await call(env, "/api/pages", { method: "PUT", headers: auth(TOKEN), body: JSON.stringify({ handle: "drs", page }) })
  await call(env, "/drs")
  await call(env, "/lead/drs", { method: "POST", body: JSON.stringify({ value: "a@b.co", consent: true }) })
  assert.equal((await call(env, "/api/pages?handle=drs", { method: "DELETE", headers: auth(OTHER) })).status, 401)
  assert.equal((await call(env, "/api/pages?handle=drs", { method: "DELETE", headers: auth(TOKEN) })).status, 200)
  for (const t of ["pages", "events", "leads"]) assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0)
  assert.equal((await call(env, "/drs")).status, 404)
})

test("render without capture has no form or script", () => {
  const v = validatePage({ ...page, capture: { enabled: false } })
  const html = renderPage("drs", v.page)
  assert.ok(!html.includes("<form") && !html.includes("<script"))
})
