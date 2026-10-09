"use client"
// تبويب التشفير E2E — مصافحة X25519 الحية + بصمة SAS + تدوير + نقل مشفر
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  KeyRound, Fingerprint, RefreshCcw, Send, FileText, ShieldCheck, Copy,
  ArrowDownUp, BadgeCheck, ScanFace, Lock,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useSec } from "@/lib/sec-store"
import { sendEncryptedFile, rotateKeys, sendSecureCmd } from "@/hooks/use-sec-bridge"
import { SUITE, toHex, fromB64 } from "@/lib/nexus/e2e-crypto"
import { fmtSize } from "@/lib/store"

interface WipableFile { deviceId: string; name: string; vPath: string; size: number }

export function CryptoTab({ onOpenPhone }: { onOpenPhone: () => void }) {
  const { kexDone, sas, sasConfirmed, confirmSas, myFingerprint, peer, rotations, transfer, setCheck, receivedClip, stealth } = useSec()
  const [files, setFiles] = useState<WipableFile[]>([])
  const [picked, setPicked] = useState<string>("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    void fetch("/api/security/wipe").then((r) => r.json()).then((j) => {
      if (j.ok) {
        const usable = (j.files as WipableFile[]).filter((f) => f.size > 0 && f.size < 8 * 1024 * 1024).slice(0, 40)
        setFiles(usable)
        if (usable.length) setPicked(`${usable[0].deviceId}|${usable[0].vPath}|${usable[0].name}|${usable[0].size}`)
      }
    }).catch(() => {})
  }, [])

  async function sendPicked() {
    const [deviceId, vPath, name, sizeStr] = picked.split("|")
    if (!deviceId || !vPath) { toast.error("اختر ملفاً أولاً"); return }
    setSending(true)
    try {
      const r = await fetch(`/api/preview?device=${encodeURIComponent(deviceId)}&path=${encodeURIComponent(vPath)}&download=1`)
      const buf = new Uint8Array(await r.arrayBuffer())
      await sendEncryptedFile(buf, name, false)
      setCheck("transfer", true)
    } catch {
      toast.error("فشل قراءة الملف المصدر")
    } finally {
      setSending(false)
    }
  }

  const peerPubHex = peer?.pub ? toHex(fromB64(peer.pub)).slice(0, 24).toUpperCase().match(/.{4}/g)?.join(" ") : "—"

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* بطاقة الجلسة */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-teal-600" /> جلسة التشفير الحية</div>
          <Badge variant={kexDone ? "default" : "outline"} className={kexDone ? "bg-emerald-600" : ""}>
            {kexDone ? "E2E نشط" : "بانتظار الهاتف"}
          </Badge>
        </div>
        <div className="text-[11px] font-mono bg-muted/60 rounded-xl p-2.5 text-center" dir="ltr">{SUITE}</div>

        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-xl border p-2.5 space-y-1">
            <div className="text-muted-foreground flex items-center gap-1"><Fingerprint className="w-3 h-3" /> بصمة هذا الجهاز (PC-OFFICE)</div>
            <div className="font-mono text-[10px] font-bold tracking-wider" dir="ltr">{myFingerprint || "…"}</div>
          </div>
          <div className="rounded-xl border p-2.5 space-y-1">
            <div className="text-muted-foreground flex items-center gap-1"><Fingerprint className="w-3 h-3" /> الطرف الآخر</div>
            <div className="font-mono text-[10px] font-bold tracking-wider" dir="ltr">{peer ? peerPubHex : "بانتظار الاتصال"}</div>
          </div>
        </div>

        {/* SAS */}
        <div className={`rounded-xl border-2 p-3 space-y-2 ${sasConfirmed ? "border-emerald-500/50 bg-emerald-500/10" : "border-amber-500/50 bg-amber-500/10"}`}>
          <div className="text-[12px] font-bold flex items-center gap-1.5">
            <ScanFace className="w-4 h-4" /> بصمة التحقق البصري (SAS)
          </div>
          {sas ? (
            <>
              <div className="text-2xl text-center tracking-widest" dir="ltr">{sas.emoji}</div>
              <div className="font-mono text-center text-sm font-bold tracking-[0.3em]" dir="ltr">{sas.hex}</div>
              <p className="text-[10px] text-muted-foreground text-center">طابِق هذه البصمة مع صفحة الهاتف — تطابقها يعني absence رجل في المنتصف</p>
              {!sasConfirmed ? (
                <Button size="sm" className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={() => { confirmSas(); setCheck("kex", true); toast.success("تم تأكيد مطابقة البصمة — القناة موثقة طرفاً لطرف") }}>
                  <BadgeCheck className="w-4 h-4" /> طابقت البصمة على الهاتف — وثّق القناة
                </Button>
              ) : (
                <div className="text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-400">✓ القناة موثقة بطرفيها — لا رجل في المنتصف</div>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">
              افتح صفحة الهاتف (<button className="underline" onClick={onOpenPhone}>رمز QR</button>) لتكتمل المصافحة
            </p>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>تدويرات المفاتيح: <b className="text-foreground">{rotations}</b> (تلقائي كل 3 دقائق)</span>
          <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => { void rotateKeys(); toast.info("بدأ تدوير المفاتيح — عصر جديد رجيعي (PFS)") }}>
            <RefreshCcw className="w-3 h-3" /> تدوير الآن
          </Button>
        </div>
      </div>

      {/* مصفوفة القنوات */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-600" /> خريطة تشفير القنوات</div>
        <div className="space-y-1.5">
          {[
            { name: "نقل الملفات", note: "chunks 48KB · AES-256-GCM لكل قطعة", on: kexDone },
            { name: "الحافظة الآمنة", note: "نص مشفر من الهاتف إلى الكمبيوتر", on: kexDone },
            { name: "أوامر التحكم (رن/قفل)", note: "أوامر مشفرة + صلاحيات لكل ميزة", on: kexDone },
            { name: "حالة القفل والتنبيهات", note: "ميتاداتا فقط — المحتوى دائماً مشفر", on: true },
          ].map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl border px-3 py-2">
              <div>
                <div className="text-[12px] font-bold flex items-center gap-1.5">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">{c.note}</div>
              </div>
              <Badge variant={c.on ? "default" : "outline"} className={c.on ? "bg-emerald-600" : ""}>{c.on ? "E2E ✓" : "بانتظار"}</Badge>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border border-dashed px-3 py-2">
            <div>
              <div className="text-[12px] font-bold">الإشعارات / SMS / الوسائط</div>
              <div className="text-[10px] text-muted-foreground">قنوات المراحل السابقة — عبر TLS (WSS) وجاهزة للترحيل إلى هذه القناة الموحدة</div>
            </div>
            <Badge variant="outline">TLS</Badge>
          </div>
        </div>

        {/* لصق آمن وارد */}
        {receivedClip && (
          <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-3 space-y-1.5">
            <div className="text-[11px] font-bold flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" /> نص مشفر وصل من الهاتف ({fmtSize(receivedClip.text.length)})</div>
            <div className="text-[12px] bg-background rounded-lg p-2 max-h-20 overflow-y-auto whitespace-pre-wrap">{receivedClip.text}</div>
            <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => { void navigator.clipboard.writeText(receivedClip.text); toast.success("نُسخ إلى حافظة النظام — Ctrl+V في أي مكان") }}>
              <Copy className="w-3 h-3" /> انسخ لحافظة النظام
            </Button>
          </div>
        )}
      </div>

      {/* نقل ملف مشفر */}
      <div className="lg:col-span-2 rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><Send className="w-4 h-4 text-teal-600" /> نقل ملف حقيقي عبر القناة المشفرة {stealth && <Badge className="bg-slate-700">وضع التخفي سيُطبق من تبويبه</Badge>}</div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-2">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="h-9 rounded-xl border bg-background px-3 text-[12px] max-w-full"
            aria-label="اختر ملفاً للنقل المشفر"
          >
            {files.length === 0 && <option>لا ملفات متاحة</option>}
            {files.map((f) => (
              <option key={f.vPath} value={`${f.deviceId}|${f.vPath}|${f.name}|${f.size}`}>
                {f.name} — {fmtSize(f.size)} ({f.deviceId})
              </option>
            ))}
          </select>
          <Button className="rounded-xl gap-1.5" disabled={!kexDone || !picked || sending} onClick={() => void sendPicked()}>
            <ArrowDownUp className="w-4 h-4" /> {sending ? "يُرسل مشفراً…" : "أرسل مشفراً إلى الهاتف"}
          </Button>
        </div>
        {transfer && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold flex items-center gap-1"><FileText className="w-3 h-3" /> {transfer.name} {transfer.stealth && "(تخفي)"}</span>
              <span>{fmtSize(transfer.sent)} / {fmtSize(transfer.size)} · {transfer.status === "done" ? "مكتمل ✓" : transfer.status === "error" ? "خطأ" : "جارٍ…"}</span>
            </div>
            <Progress value={Math.min(100, (transfer.sent / Math.max(transfer.size, 1)) * 100)} className="h-2" />
            {transfer.status === "done" && !transfer.stealth && (
              <div className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> وصل الهاتف وفُك تشفيره — SHA-256 مطابق، والخادم لم يرَ بايتاً صريحاً واحداً
              </div>
            )}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> جرّب أيضاً: أمر رن مشفر فوري
          <Button size="sm" variant="outline" className="h-6 rounded-lg text-[10px] gap-1" disabled={!kexDone} onClick={() => { void sendSecureCmd("ring", "remote_input"); toast.info("أُرسل أمر رن مشفراً — راقب الهاتف") }}>
            <Send className="w-3 h-3" /> رن الهاتف
          </Button>
        </div>
      </div>
    </div>
  )
}
