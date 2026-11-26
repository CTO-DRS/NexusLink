// Cloud Mode client (optional, OFF by default). While disabled, none of these functions touch the network.
import { DEVELOPER } from "@/lib/developer-links"
import { DEVELOPER_BANNERS } from "@/lib/developer-banners"

const KEY = "nexus.cloud.v1"

export type CloudState = {
  enabled: boolean
  acceptedAt?: number // when the disclosure was accepted
  handle: string
  token: string // owner token, generated here, kept on this device only
  capture: boolean
  publishedUrl?: string
  publishedAt?: number
}

const fresh = (): CloudState => ({ enabled: false, handle: "", token: "", capture: false })

export function loadCloud(): CloudState {
  try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || "{}") } } catch { return fresh() }
}
export function saveCloud(s: CloudState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
}
export const handleOk = (h: string) => /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(h)

/** Builds the hosted page from the local developer card data (same links, banners and theme). */
export function buildCloudPage(opts: { theme: string; animated: boolean; capture: boolean; lang: "ar" | "en"; photo?: string; texts: { role: string; label: string; consent: string; titles: Record<string, string> } }) {
  return {
    name: DEVELOPER.name,
    role: opts.texts.role,
    photo: opts.photo ?? "",
    lang: opts.lang,
    theme: opts.theme,
    animated: opts.animated,
    capture: { enabled: opts.capture, label: opts.texts.label, consent: opts.texts.consent },
    links: DEVELOPER.links.map((l) => ({ id: l.id, label: opts.texts.titles[l.id] ?? l.label, url: l.url, color: l.color })),
    banners: DEVELOPER_BANNERS.map((b) => ({
      id: b.id, title: opts.texts.titles[b.title] ?? b.title, body: opts.texts.titles[b.body] ?? b.body, cta: opts.texts.titles[b.cta] ?? b.cta, url: b.url,
      startsAt: b.startsAt ? Date.parse(b.startsAt) / 1000 : null, endsAt: b.endsAt ? Date.parse(b.endsAt) / 1000 : null,
    })),
  }
}

async function call(op: "publish" | "delete" | "stats", s: CloudState, extra: Record<string, unknown> = {}) {
  if (!s.enabled || !s.acceptedAt) throw new Error("cloud_disabled") // hard gate: no request unless opted in
  const r = await fetch("/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, handle: s.handle, token: s.token, ...extra }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(d?.error || String(r.status)), { code: d?.error || r.status })
  return d
}
export const cloudPublish = (s: CloudState, page: unknown) => call("publish", s, { page })
export const cloudDelete = (s: CloudState) => call("delete", s)
export const cloudStats = (s: CloudState, days = 30) => call("stats", s, { days })
export async function cloudDeployed(): Promise<boolean> {
  try { return !!(await (await fetch("/api/cloud")).json()).deployed } catch { return false }
}
