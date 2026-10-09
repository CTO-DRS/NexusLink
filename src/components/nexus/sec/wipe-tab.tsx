"use client"
// تبويب الحذف الآمن — تمريرات كتابة حقيقية على القرص + إزالة من inode (بلا سلة)
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Flame, HardDrive, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useSec } from "@/lib/sec-store"
import { getSecSocket } from "@/lib/sec-socket"
import { fmtSize, fmtDate } from "@/lib/store"

interface WipableFile { deviceId: string; name: string; vPath: string; size: number; mtime: number }

export function WipeTab() {
  const { wipeJob, wipeResult, setCheck } = useSec()
  const [files, setFiles] = useState<WipableFile[]>([])
  const [picked, setPicked] = useState("")
  const [passes, setPasses] = useState(3)
  const [confirmText, setConfirmText] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    const socket = getSecSocket()
    socket.emit("wipe:list")
    const handler = (j: WipableFile[] | { files: WipableFile[] }) => {
      const list = Array.isArray(j) ? j : (j?.files ?? [])
      setFiles(list)
      if (list.length) setPicked(`${list[0].deviceId}|${list[0].vPath}|${list[0].name}`)
    }
    socket.on("wipe:files", handler)
    return () => { socket.off("wipe:files", handler) }
  }, [])

  function runWipe() {
    const [deviceId, vPath, name] = picked.split("|")
    if (!deviceId || !vPath) return
    getSecSocket().emit("wipe:run", { deviceId, vPath, passes })
    setConfirmOpen(false)
    setConfirmText("")
    toast.info(`بدأ الحذف الآمن لـ «${name}» بـ ${passes} تمريرات — راقب التقدم`)
  }

  const phaseLabel = wipeJob?.phase === "write" ? `تمريرة ${wipeJob.pass}/${wipeJob.totalPasses} — نمط ${wipeJob.pattern}` : wipeJob?.phase === "unlink" ? "الإزالة النهائية من inode…" : "التحقق من عدم الوجود…"

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* اختيار وتنفيذ */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><Flame className="w-4 h-4 text-red-500" /> حذف آمن يتجاوز سلة المحذوفات</div>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          لا رجوع بعد التنفيذ: تُكتب أنماط 0x00 ثم 0xFF ثم عشوائي CSPRNG فوق بايتات الملف على القرص فعلياً
          (fsync بعد كل كتابة)، ثم يُزال من جدول inode مباشرة — لا يمر بسلة المحذوفات ولا بأي منطقة استرجاع.
        </div>

        <select value={picked} onChange={(e) => setPicked(e.target.value)} className="w-full h-9 rounded-xl border bg-background px-3 text-[12px]" aria-label="اختر ملفاً للحذف الآمن">
          {files.length === 0 && <option>جارٍ جلب الملفات…</option>}
          {files.map((f) => (
            <option key={f.deviceId + f.vPath} value={`${f.deviceId}|${f.vPath}|${f.name}`}>
              {f.name} — {fmtSize(f.size)} ({f.deviceId === "galaxy-s24" ? "هاتف" : "كمبيوتر"})
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="text-[12px]">عدد التمريرات:</span>
          {[3, 7].map((p) => (
            <button
              key={p} onClick={() => setPasses(p)}
              className={`rounded-xl px-3 py-1.5 text-[12px] font-bold border ${passes === p ? "bg-red-600 text-white border-red-600" : "bg-card"}`}
              aria-pressed={passes === p}
            >
              {p} {p === 3 ? "(قياسي)" : "(قسوة قصوى)"}
            </button>
          ))}
        </div>

        <Button variant="destructive" className="w-full rounded-xl gap-1.5" disabled={!picked} onClick={() => setConfirmOpen(true)}>
          <Flame className="w-4 h-4" /> ابدأ الحذف الآمن النهائي
        </Button>

        {/* تقدم التنفيذ */}
        {wipeJob && (
          <div className="space-y-1.5 rounded-xl border p-3 animate-pulse">
            <div className="flex justify-between text-[11px]">
              <b className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> {wipeJob.file}</b>
              <span className="text-muted-foreground">{phaseLabel}</span>
            </div>
            <Progress value={wipeJob.pct} className="h-2.5" />
          </div>
        )}
      </div>

      {/* النتيجة */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-teal-600" /> تقرير الحذف</div>
        {wipeResult ? (
          <div className="space-y-2">
            <div className={`rounded-xl p-3 flex items-center gap-2 font-bold text-[13px] ${wipeResult.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-600"}`}>
              {wipeResult.ok ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              {wipeResult.ok ? `«${wipeResult.file}» اختفى نهائياً — لا استرجاع ممكن` : `فشل: ${wipeResult.error}`}
            </div>
            {wipeResult.passes && (
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40"><tr><th className="text-start px-2 py-1.5">التمريرة</th><th className="text-start px-2 py-1.5">النمط</th><th className="text-start px-2 py-1.5">البايتات</th><th className="text-start px-2 py-1.5">المدة</th></tr></thead>
                  <tbody>
                    {wipeResult.passes.map((p) => (
                      <tr key={p.index} className="border-t">
                        <td className="px-2 py-1.5 font-bold">#{p.index}</td>
                        <td className="px-2 py-1.5" dir="ltr">{p.pattern}</td>
                        <td className="px-2 py-1.5">{fmtSize(p.bytes)}</td>
                        <td className="px-2 py-1.5">{p.ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {wipeResult.hashBefore && (
              <div className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded-lg p-2 break-all" dir="ltr">
                SHA-256 قبل الحذف: {wipeResult.hashBefore.slice(0, 32)}… — بعد الحذف: الملف غير موجود ✓
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11px]">
              <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">verifyGone: {wipeResult.verifyGone ? "true" : "false"}</Badge>
              <Badge variant="outline">تجاوز سلة المحذوفات: نعم (unlink مباشر)</Badge>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground bg-muted/40 rounded-xl p-4 text-center">
            لا تقرير بعد — اختر ملفاً ونفّذ الحذف. الحدث سيُوثق في سجل التدقيق تلقائياً.
          </div>
        )}
      </div>

      {/* تأكيد كتابي */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-4 h-4" /> حذف نهائي لا رجوع فيه</DialogTitle>
            <DialogDescription>
              سيُمسح <b>{picked.split("|")[2] ?? "الملف"}</b> بـ {passes} تمريرات كتابة على القرص ثم يُزال من inode.
              اكتب <b className="font-mono">احذف نهائياً</b> للتأكيد.
            </DialogDescription>
          </DialogHeader>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="اكتب: احذف نهائياً" className="h-9 rounded-xl border bg-background px-3 text-[13px]" aria-label="تأكيد الحذف" />
          <Button variant="destructive" className="rounded-xl" disabled={confirmText !== "احذف نهائياً"} onClick={runWipe}>
            تنفيذ الحذف الآمن
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
