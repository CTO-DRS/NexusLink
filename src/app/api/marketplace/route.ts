import { NextRequest, NextResponse } from "next/server"
import {
  signedChannel, listInstalled, installPlugin, uninstallPlugin,
  getChannelKey, signManifest, PLUGIN_CAPABILITIES, type MarketManifest,
} from "@/lib/nexus/marketplace"

export const dynamic = "force-dynamic"

// API عام 2.0 — سوق التكاملات (عقد §34.ب — M3.2)
// ============================================================
// GET  → القناة الموقعة (10 تكاملات) + المثبت محليًا + بصمة المفتاح + الكتالوج
// POST → action: install | uninstall | sign (مساعد المؤلفين — محلي حصرًا)

export async function GET() {
  try {
    const [channel, installed, keyInfo] = await Promise.all([
      signedChannel(), listInstalled(), getChannelKey(),
    ])
    return NextResponse.json({
      keyFp: keyInfo.fp,
      capabilities: PLUGIN_CAPABILITIES,
      channel,
      installed: installed.map((p) => ({ ...p })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  try {
    if (action === "install") {
      const out = await installPlugin(body.manifest, body.sig)
      if (!out.ok) return NextResponse.json({ ok: false, error: out.reason }, { status: 400 })
      return NextResponse.json({ ok: true, installed: out.installed })
    }
    if (action === "uninstall") {
      const id = String(body.id ?? "").trim()
      if (!id) return NextResponse.json({ error: "معرف مفقود" }, { status: 400 })
      const gone = await uninstallPlugin(id)
      if (!gone) return NextResponse.json({ error: "التكامل غير مثبت" }, { status: 404 })
      return NextResponse.json({ ok: true })
    }
    if (action === "sign") {
      // مساعد مؤلفي التكاملات: يوقّع بمفتاح القناة المحلية (محلي حصرًا —
      // توقيع الطرف الثالث في الإنتاج يمر بإدارة مفاتيح مستقبلية موثقة §34.ب)
      const m = body.manifest
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        return NextResponse.json({ error: "manifest غير صالح" }, { status: 400 })
      }
      const { key, fp } = await getChannelKey()
      const sig = signManifest(m as MarketManifest, key)
      return NextResponse.json({ ok: true, sig, keyFp: fp })
    }
    return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
