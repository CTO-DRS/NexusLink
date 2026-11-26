// Cloud Mode proxy (opt-in feature). The browser's CSP is connect-src 'self', so the app talks to this
// same-origin route, which forwards to the hosted Nexus Link Cloud service.
// The destination is fixed from server config (NEXUSLINK_CLOUD_ENDPOINT): no caller-supplied URL, so no SSRF.
// Nothing here runs on its own: it only forwards a request the user triggered from the Cloud Mode card.
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const ENDPOINT = (process.env.NEXUSLINK_CLOUD_ENDPOINT || "https://nexuslink-cloud.nexus-link.workers.dev").replace(/\/+$/, "")
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/

type Op = "publish" | "delete" | "stats" | "leads"

export async function POST(req: Request) {
  if (!ENDPOINT) return NextResponse.json({ error: "not_deployed" }, { status: 503 })
  let body: { op?: Op; handle?: string; token?: string; page?: unknown; days?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }
  const handle = String(body.handle || "").toLowerCase()
  const token = String(body.token || "")
  if (!HANDLE_RE.test(handle) || token.length < 32 || token.length > 128) return NextResponse.json({ error: "bad_request" }, { status: 400 })
  const headers = { authorization: `Bearer ${token}` }
  let r: Response
  try {
    const sig = AbortSignal.timeout(8000)
    if (body.op === "publish") r = await fetch(`${ENDPOINT}/api/pages`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ handle, page: body.page }), signal: sig })
    else if (body.op === "delete") r = await fetch(`${ENDPOINT}/api/pages?handle=${handle}`, { method: "DELETE", headers, signal: sig })
    else if (body.op === "stats") r = await fetch(`${ENDPOINT}/api/stats?handle=${handle}&days=${Math.min(395, Math.max(1, Number(body.days) || 30))}`, { headers, signal: sig })
    else if (body.op === "leads") {
      r = await fetch(`${ENDPOINT}/api/leads.csv?handle=${handle}`, { headers, signal: sig })
      return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${handle}-leads.csv"` } })
    } else return NextResponse.json({ error: "bad_request" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 })
  }
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status })
}

export async function GET() {
  return NextResponse.json({ deployed: !!ENDPOINT })
}
