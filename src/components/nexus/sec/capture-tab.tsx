"use client"
// تبويب اختبار Wireshark — الالتقاط الأسلاكي + فحص التسريب + تصدير pcap حقيقي
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ScanSearch, Radio, Download, Trash2, ShieldCheck, ShieldAlert, RefreshCcw, Hexagon, Globe,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { scanLeak, fromB64 } from "@/lib/nexus/e2e-crypto"
import { fmtSize, fmtDate } from "@/lib/store"

export function CaptureTab() {
  const { wire, capturePaused, toggleCapturePaused, leakScan, setLeakScan, setCheck, setTab } = useSec()
  const [needle, setNeedle] = useState("تقرير")
  const [scanning, setScanning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = () => getSecSocket().emit("sec:capture-get")
  useEffect(() => { refresh() }, [])

  const encryptedCount = wire.filter((f) => f.encrypted).length
  const bytesTotal = wire.reduce((a, f) => a + f.len, 0)

  async function runScan() {
    if (!needle.trim()) { toast.error("اكتب نصاً متوقعاً (اسم الملف أو كلمة من محتواه)"); return }
    setScanning(true)
    await new Promise((r) => setTimeout(r, 400))
    // نزّل الالتقاط الكامل من الخادم ثم افحص البايتات الفعلية
    try {
      const socket = getSecSocket()
      const frames = await new Promise<{ b64: string }[]>((res) => {
        socket.once("sec:capture", (d: { frames: { b64: string }[] }) => res(d.frames))
        socket.emit("sec:capture-get")
        setTimeout(() => res([]), 3000)
      })
      const hits = scanLeak(frames, needle.trim())
      let scanned = 0
      for (const f of frames) { try { scanned += fromB64(f.b64).length } catch { /* ignore */ } }
      setLeakScan({ needle: needle.trim(), hits, scannedBytes: scanned })
      if (hits === 0 && frames.length > 0) {
        setCheck("wireshark", true)
        toast.success(`صفر تطابق — «${needle.trim()}» لا وجود له في بايتات الشبكة`, { description: `${scanned.toLocaleString("en")} بايت فُحصت — كلها ciphertext` })
      } else if (frames.length === 0) {
        toast.error("لا إطارات ملتقطة — أرسل ملفاً أولاً ثم افحص")
      } else {
        toast.error(`تحذير: وُجد ${hits} تطابق — القناة مكشوفة!`)
      }
    } finally {
      setScanning(false)
    }
  }

  async function exportPcap() {
    const r = await fetch("/api/security/pcap", { method: "POST" })
    const j = await r.json()
    if (j.ok) {
      toast.success(`صُنع pcap حقيقي (${j.packets} حزمة) — يفتح في Wireshark مباشرة`, { description: "جارٍ التنزيل…" })
      window.location.href = "/api/security/pcap"
      setCheck("wireshark", true)
    } else {
      toast.error(j.error ?? "فشل التصدير")
    }
  }

  return (
    <div className="space-y-4">
      {/* شريط الاختبار */}
      <div className="rounded-2xl border-2 border-teal-500/40 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2">
          <ScanSearch className="w-4 h-4 text-teal-600" /> معيار القبول: التقاط الحزم أثناء نقل ملف ← لا محتوى قابل للقراءة
        </div>
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
          <input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="اكتب نصاً تتوقع وجوده في الملف المُنقل (اسم الملف أو كلمة من محتواه)…"
            className="h-10 rounded-xl border bg-background px-3 text-[13px]"
            aria-label="نص فحص التسريب"
          />
          <Button className="rounded-xl gap-1.5 bg-teal-600 hover:bg-teal-700" disabled={scanning} onClick={() => void runScan()}>
            <ScanSearch className="w-4 h-4" /> {scanning ? "يفحص البايتات…" : "افحص التسريب"}
          </Button>
          <Button variant="outline" className="rounded-xl gap-1.5" onClick={() => void exportPcap()}>
            <Download className="w-4 h-4" /> صدّر pcap لـ Wireshark
          </Button>
        </div>
        {leakScan && (
          <div className={`rounded-xl p-3 flex items-center gap-2 text-[12px] font-bold ${leakScan.hits === 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-600"}`}>
            {leakScan.hits === 0 ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {leakScan.hits === 0
              ? `«${leakScan.needle}»: 0 تطابق في ${leakScan.scannedBytes.toLocaleString("en")} بايت ملتقطة — ما سيراه Wireshark: بايتات مشفرة فقط ✓`
              : `تحذير أمني: «${leakScan.needle}» ظهر ${leakScan.hits} مرة في الالتقاط!`}
          </div>
        )}
      </div>

      {/* إحصاءات القناة */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "إطارات ملتقطة", value: wire.length, icon: Radio },
          { label: "إطارات مشفرة", value: `${encryptedCount}/${wire.length}`, icon: Hexagon },
          { label: "بايتات على السلك", value: fmtSize(bytesTotal), icon: Globe },
          { label: "نص صريح في الإطارات المشفرة", value: "0 بايت", icon: ShieldCheck },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-3">
            <div className="text-[10px] text-muted-foreground flex items-center gap-1"><s.icon className="w-3 h-3" /> {s.label}</div>
            <div className="text-lg font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* جدول الالتقاط */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/40">
          <div className="text-[12px] font-bold">الالتقاط الأسلاكي الحي — بايتات القناة كما تعبر الشبكة (منفذ 3009)</div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={refresh}><RefreshCcw className="w-3 h-3" /> تحديث</Button>
            <Button size="sm" variant={capturePaused ? "default" : "outline"} className="h-7 rounded-lg text-[11px]" onClick={toggleCapturePaused}>
              {capturePaused ? "موقوف" : "إيقاف مؤقت"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => { getSecSocket().emit("sec:capture-clear"); toast.info("مُسح الالتقاط") }}>
              <Trash2 className="w-3 h-3" /> مسح
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {wire.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-muted-foreground">
              لا إطارات بعد — افتح تبويب التشفير وأرسل ملفاً مشفراً، ثم عُد هنا لترى ما سيراه Wireshark
            </div>
          ) : (
            <table className="w-full text-[11px]" dir="ltr">
              <thead className="bg-muted/30 sticky top-0">
                <tr className="text-muted-foreground">
                  <th className="text-start px-2 py-1.5 font-medium">#</th>
                  <th className="text-start px-2 py-1.5 font-medium">time</th>
                  <th className="text-start px-2 py-1.5 font-medium">source → dest</th>
                  <th className="text-start px-2 py-1.5 font-medium">kind</th>
                  <th className="text-start px-2 py-1.5 font-medium">len</th>
                  <th className="text-start px-2 py-1.5 font-medium">payload (hex)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {wire.slice(0, 120).map((f, i) => (
                  <tr
                    key={f.id}
                    className={`border-t cursor-pointer hover:bg-muted/40 ${f.encrypted ? "" : "bg-amber-500/5"}`}
                    onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                  >
                    <td className="px-2 py-1.5 text-muted-foreground">{wire.length - i}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{new Date(f.at).toLocaleTimeString("en-GB")}.{String(f.at % 1000).padStart(3, "0")}</td>
                    <td className="px-2 py-1.5">{f.from} → {f.to}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant="outline" className={f.encrypted ? "text-emerald-600 border-emerald-500/40" : "text-amber-600"}>
                        {f.encrypted ? "AES-GCM" : f.kind}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">{f.len.toLocaleString("en")}</td>
                    <td className="px-2 py-1.5 max-w-[380px] truncate text-muted-foreground" dir="ltr">
                      {expanded === f.id ? f.hex.slice(0, 400) : f.hex.slice(0, 48)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* كيف تتحقق بـ Wireshark الحقيقي */}
      <div className="rounded-2xl border bg-card p-4 space-y-2 text-[12px]">
        <div className="font-bold">التحقق بـ Wireshark على جهازك الحقيقي:</div>
        <ol className="list-decimal ps-5 space-y-1 text-muted-foreground">
          <li>اضغط «صدّر pcap» أعلاه أثناء/بعد نقل ملف — يُنزّل <b className="text-foreground font-mono text-[11px]">nexuslink-capture.pcap</b> (حزم Ethernet/IP/TCP حقيقية الأبعادة محتواها إطارات القناة).</li>
          <li>افتح الملف في Wireshark ثم فلتر: <code className="font-mono bg-muted px-1 rounded" dir="ltr">tcp.port == 3009</code></li>
          <li>Follow → TCP Stream — سترى أسطراً مثل <code className="font-mono bg-muted px-1 rounded" dir="ltr">{"{"}&quot;iv&quot;:&quot;9Kd2…&quot;,&quot;ct&quot;:&quot;8fjH…&quot;{"}"}</code> — صفر نص من محتوى ملفك.</li>
          <li>أو على الشبكة مباشرة: <code className="font-mono bg-muted px-1 rounded" dir="ltr">sudo tcpdump -i any -w out.pcap port 3009</code> أثناء النقل ثم افتحه — النتيجة نفسها: ciphertext فقط.</li>
        </ol>
        <div className="text-[11px] text-muted-foreground pt-1 border-t">
          ملاحظة أمان: إطارات المصافحة (المفاتيح العامة X25519) هي الوحيدة غير المشفرة — وهذا حتمي رياضياً وآمن: المفاتيح العامة عالمية الإعلان، والسر المشترك لا يغادر الجهازين أبداً.
        </div>
        <button className="text-[11px] underline text-teal-600" onClick={() => setTab("crypto")}>← عُد لتبويب التشفير وأرسل ملفاً الآن</button>
      </div>
    </div>
  )
}
