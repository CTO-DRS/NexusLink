import { NextRequest, NextResponse } from "next/server"
import {
  signedChannel, listInstalled, installPlugin, uninstallPlugin,
  getChannelKey, signManifest, PLUGIN_CAPABILITIES, type MarketManifest,
} from "@/lib/nexus/marketplace"
import {
  listPublishers, rotatePublisherKey, setPublisherRevoked,
  signWithPublisherKey, verifyPublisherEnvelope,
} from "@/lib/nexus/publisher"
import { readEnterprisePolicy } from "@/lib/enterprise-policy"
import { appendAudit, observePolicy } from "@/lib/enterprise-audit"

export const dynamic = "force-dynamic"

// API عام 2.0 — سوق التكاملات (عقد §34.ب — M3.2 + §35.أ/ب — عمق ما بعد M3)
// ============================================================
// GET  → القناة الموقعة (10 تكاملات بغلافي توقيع) + المثبت + الناشرون + البصمة + الكتالوج
// POST → action: install | uninstall | sign | pub-list | pub-rotate | pub-revoke
//        | pub-restore | pub-verify (مساعدو الناشرين — محلي حصرًا)
//
// §47 — تعطيل قدرة السوق مؤسسيًا: managed.disabledCapabilities تحتوي "market"
// → كل أفعال POST → 403 capability-disabled-by-policy (قبل أي منطق — حسم
// مبكر). GET يبقى قراءة صادقة: القناة تُرى والسياسة معلنة فيها (البطاقة
// تُطفئ الأزرار) — الغرض منع التثبيت لا إخفاء الوجود.

export async function GET() {
  try {
    const [channel, installed, keyInfo, publishers] = await Promise.all([
      signedChannel(), listInstalled(), getChannelKey(), listPublishers(),
    ])
    const pol = readEnterprisePolicy()
    return NextResponse.json({
      keyFp: keyInfo.fp,
      capabilities: PLUGIN_CAPABILITIES,
      channel,
      installed: installed.map((p) => ({ ...p })),
      // قناة الناشر (§35.أ): بصمات حصرًا — لا مفاتيح أبدًا
      publishers,
      policy: {
        marketDisabled: pol.state === "managed" && pol.disabledCapabilities.includes("market"),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  // §47 — حسم التعطيل قبل أي منطق (بلا أثر جانبي) + دليل §39
  const pol = readEnterprisePolicy()
  await observePolicy(pol)
  if (pol.state === "managed" && pol.disabledCapabilities.includes("market")) {
    await appendAudit("capability.denied", false, "local", { capability: "market", action: action.slice(0, 24) })
    return NextResponse.json(
      { ok: false, error: "capability-disabled-by-policy", detail: { capability: "market" } },
      { status: 403 },
    )
  }
  try {
    if (action === "install") {
      const out = await installPlugin(body.manifest, body.sig, body.pub)
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
    if (action === "pub-list") {
      // قناة الناشر (§35.أ): بصمات حصرًا لا مفاتيح — عرض عام آمن
      return NextResponse.json({ ok: true, publishers: await listPublishers() })
    }
    if (action === "pub-sign") {
      // توقيع بغلاف ناشر: مفتاح الناشر داخل العملية حصرًا — عبر loadRegistry
      // (تضمن البذرة عند أول استخدام فلا سباق ولا 404 مبكر)
      const m = body.manifest
      const pubId = String(body.pubId ?? "").trim()
      const kv = Math.round(Number(body.kv ?? 0))
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        return NextResponse.json({ error: "manifest غير صالح" }, { status: 400 })
      }
      const { loadRegistry } = await import("@/lib/nexus/publisher")
      const reg = await loadRegistry()
      const entry = reg[pubId]
      if (!entry) return NextResponse.json({ error: "ناشر غير معروف" }, { status: 404 })
      if (entry.revoked) return NextResponse.json({ error: "الناشر موقوف" }, { status: 403 })
      const useKv = kv > 0 ? kv : entry.currentKv
      const keyHex = entry.keys[String(useKv)]
      if (!keyHex) return NextResponse.json({ error: "إصدار مفتاح غير معروف" }, { status: 400 })
      const sig = signWithPublisherKey(m, keyHex)
      return NextResponse.json({ ok: true, pub: { id: pubId, kv: useKv, sig } })
    }
    if (action === "pub-verify") {
      const v = await verifyPublisherEnvelope(body.pub, body.manifest)
      return v.ok
        ? NextResponse.json({ ok: true, pubId: v.pubId, kv: v.kv })
        : NextResponse.json({ ok: false, error: v.reason }, { status: 400 })
    }
    if (action === "pub-rotate") {
      const out = await rotatePublisherKey(String(body.pubId ?? "").trim())
      if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 400 })
      return NextResponse.json({ ok: true, currentKv: out.currentKv, fp: out.fp })
    }
    if (action === "pub-revoke" || action === "pub-restore") {
      const out = await setPublisherRevoked(String(body.pubId ?? "").trim(), action === "pub-revoke")
      if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
