"use client"

import { useNexus, fmtSize, fmtSpeed } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  ArrowDownLeft, ArrowUpRight, Pause, Play, X, CheckCircle2,
  AlertTriangle, ShieldCheck, Loader2, Zap,
} from "lucide-react"
import { toast } from "sonner"

export function TransfersView() {
  const { transfers } = useNexus()
  const post = async (id: string, action: string) => {
    await fetch("/api/transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    })
  }

  const active = transfers.filter((t) => t.status === "active" || t.status === "queued" || t.status === "paused")
  const finished = transfers.filter((t) => t.status === "done" || t.status === "error")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">محرك النقل</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          نقل مُجزّأ (Chunked) 256KB · استئناف تلقائي من آخر قطعة · تحقق MD5 لكل دفعة
        </p>
      </div>

      {transfers.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-40" />
            لا توجد عمليات نقل بعد — افتح الملفات وأرسل ملفاً إلى الكمبيوتر أو الهاتف.
          </CardContent>
        </Card>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">جارية ({active.length})</h2>
          {active.map((t) => {
            const pct = t.totalBytes ? Math.min(100, (t.transferred / t.totalBytes) * 100) : 0
            const eta = t.speedBps > 0 ? (t.totalBytes - t.transferred) / t.speedBps : 0
            return (
              <Card key={t.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
                      t.direction === "in" ? "bg-teal-500/15 text-teal-600" : "bg-amber-500/15 text-amber-600"
                    }`}>
                      {t.direction === "in" ? <ArrowDownLeft className="w-4.5 h-4.5" /> : <ArrowUpRight className="w-4.5 h-4.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{t.fileName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.direction === "in" ? `استلام من ${t.deviceName}` : `إرسال إلى ${t.deviceName}`}
                        {" · "}قطعة {Math.min(t.chunksDone + 1, t.chunksTotal)} / {t.chunksTotal}
                      </div>
                    </div>
                    <Badge variant={t.status === "paused" ? "secondary" : "default"} className="text-[10px] shrink-0">
                      {t.status === "paused" ? "موقوف مؤقتاً" : t.status === "queued" ? "في الانتظار" : "جارٍ النقل"}
                    </Badge>
                    <div className="flex gap-1 shrink-0">
                      {t.status === "active" ? (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => post(t.id, "pause")} title="إيقاف مؤقت">
                          <Pause className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => post(t.id, "resume")} title="استئناف">
                          <Play className="w-4 h-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => post(t.id, "cancel")} title="إلغاء">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <div className="flex flex-wrap justify-between text-[11px] text-muted-foreground gap-x-4">
                    <span className="tabular-nums">{fmtSize(t.transferred)} / {fmtSize(t.totalBytes)} ({pct.toFixed(1)}%)</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      <Zap className="w-3 h-3 text-amber-500" /> {fmtSpeed(t.speedBps)}
                      {eta > 0 && t.status === "active" && <> · متبقٍ ~{Math.ceil(eta)} ث</>}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      )}

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">مكتملة / فاشلة</h2>
          {finished.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-3.5 flex items-center gap-3">
                {t.status === "done" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{t.fileName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.status === "done"
                      ? `اكتمل · ${fmtSize(t.totalBytes)} · محفوظ في ${t.destPath.split("/").slice(-2).join("/")}`
                      : t.error || "فشل النقل"}
                  </div>
                </div>
                {t.status === "done" && (
                  <Badge variant="outline" className="gap-1 text-[10px] text-emerald-600 border-emerald-500/40">
                    <ShieldCheck className="w-3 h-3" /> تحقق مطابق
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <Separator />
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="w-3 h-3" /> يتم التحديث مباشرة عبر استقصاء نبضات بفاصل 0.9 ثانية
      </p>
      <button className="hidden" onClick={() => toast("test")} />
    </div>
  )
}
