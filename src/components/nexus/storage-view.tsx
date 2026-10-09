"use client"

import { useCallback, useEffect, useState } from "react"
import { useNexus, fmtSize, fmtDate } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, Legend,
  BarChart, Bar, XAxis, YAxis,
} from "recharts"
import {
  HardDrive, CopyX, FileWarning, PackageOpen, Loader2, Trash2, Send, Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import type { StorageAnalysis, DuplicateGroup, FsEntry } from "@/lib/nexus/types"

const CAT_COLORS = ["#0d9488", "#f59e0b", "#e11d48", "#a855f7", "#0284c7", "#84cc16", "#f97316"]

export function StorageView() {
  const s = useNexus()
  const [analysis, setAnalysis] = useState<StorageAnalysis | null>(null)
  const [dups, setDups] = useState<DuplicateGroup[] | null>(null)
  const [wasted, setWasted] = useState(0)
  const [large, setLarge] = useState<FsEntry[] | null>(null)

  const load = useCallback(async () => {
    const dev = s.activeDeviceId
    const [a, d, l] = await Promise.all([
      fetch(`/api/storage?mode=analyze&device=${dev}`).then((r) => r.json()),
      fetch(`/api/storage?mode=duplicates&device=${dev}`).then((r) => r.json()),
      fetch(`/api/storage?mode=large&device=${dev}`).then((r) => r.json()),
    ])
    setAnalysis(a); setDups(d.groups || []); setWasted(d.wastedBytes || 0); setLarge(l.files || [])
  }, [s.activeDeviceId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; state updates only after awaits
    load()
  }, [load])

  const usedPct = analysis ? Math.round((analysis.usedBytes / analysis.totalBytes) * 100) : 0

  const deleteFile = async (path: string) => {
    await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: s.activeDeviceId, op: "delete", paths: [path] }),
    })
    toast.success("تم الحذف — تم تحرير المساحة")
    load()
  }

  const deleteDup = async (g: DuplicateGroup, keepIdx: number) => {
    const victims = g.files.filter((_, i) => i !== keepIdx).map((f) => f.path)
    await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: s.activeDeviceId, op: "delete", paths: victims }),
    })
    toast.success(`تم حذف ${victims.length} نسخة مكررة`)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">محلل التخزين</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            جهاز: <span className="font-semibold text-foreground">{s.devices.find((d) => d.id === s.activeDeviceId)?.name}</span> — فحص شامل للمساحة والتكرارات والملفات الضخمة
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { load(); toast("جارٍ إعادة الفحص…") }}>إعادة الفحص</Button>
      </div>

      {!analysis ? (
        <div className="py-20 text-center"><Loader2 className="w-7 h-7 animate-spin mx-auto text-primary" /></div>
      ) : (
        <Tabs defaultValue="overview" dir="rtl">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-grid">
            <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
            <TabsTrigger value="dups" className="gap-1.5">
              مكررات {dups && dups.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px]">{dups.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="large">ملفات ضخمة</TabsTrigger>
          </TabsList>

          {/* overview */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold">
                    <HardDrive className="w-4.5 h-4.5 text-primary" /> استخدام الوحدة
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {fmtSize(analysis.usedBytes)} / {fmtSize(analysis.totalBytes)}
                  </span>
                </div>
                <Progress value={usedPct} className="h-2.5" />
                <div className="text-xs text-muted-foreground">المتاح: {fmtSize(analysis.freeBytes)} ({100 - usedPct}%)</div>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-5">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-amber-500" /> حسب النوع</h3>
                  <div className="h-64" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analysis.categories}
                          dataKey="bytes" nameKey="category"
                          innerRadius={52} outerRadius={88} paddingAngle={3}
                        >
                          {analysis.categories.map((_, i) => (
                            <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} stroke="none" />
                          ))}
                        </Pie>
                        <RTooltip
                          formatter={(v: number, n: string) => [fmtSize(v), n]}
                          contentStyle={{ direction: "rtl", borderRadius: 12, fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, direction: "rtl" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <h3 className="text-sm font-semibold mb-3">أكبر المجلدات</h3>
                  <div className="h-64" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.folders.slice(0, 7).map((f) => ({ ...f, mb: f.bytes / 1024 ** 2 }))} layout="vertical">
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                        <RTooltip
                          formatter={(v: number) => [fmtSize(v * 1024 ** 2), "الحجم"]}
                          contentStyle={{ direction: "rtl", borderRadius: 12, fontSize: 12 }}
                        />
                        <Bar dataKey="mb" fill="#0d9488" radius={[0, 8, 8, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* duplicates */}
          <TabsContent value="dups" className="space-y-3">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <CopyX className="w-5 h-5 text-rose-500" />
                <div className="flex-1 text-sm">
                  {dups && dups.length > 0 ? (
                    <>
                      وُجد <b>{dups.length}</b> مجموعة مكررة — يمكنك تحرير{" "}
                      <b className="text-rose-500">{fmtSize(wasted)}</b> من المساحة.
                    </>
                  ) : "لا توجد ملفات مكررة. ممتاز!"}
                </div>
              </CardContent>
            </Card>
            {dups?.map((g, gi) => (
              <Card key={g.hash}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold truncate">{g.files[0].name}</span>
                    <Badge variant="outline" className="tabular-nums">{fmtSize(g.size)} × {g.files.length}</Badge>
                  </div>
                  {g.files.map((f, fi) => (
                    <div key={f.path} className="flex items-center gap-2 text-[12px] rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <span className="flex-1 truncate font-mono text-[11px]" dir="ltr">{f.path}</span>
                      <span className="text-muted-foreground text-[10.5px] shrink-0">{fmtDate(f.mtime)}</span>
                      {fi === 0 ? (
                        <Badge variant="secondary" className="text-[9px] shrink-0">النسخة المحفوظة</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive shrink-0" onClick={() => deleteDup(g, 0)}>
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* large files */}
          <TabsContent value="large" className="space-y-3">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <FileWarning className="w-5 h-5 text-amber-500" />
                <div className="text-sm">أكبر 15 ملفاً على الوحدة — مرتبة حسب الحجم.</div>
              </CardContent>
            </Card>
            {large?.map((f, i) => (
              <Card key={f.path}>
                <CardContent className="p-3.5 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-[10.5px] text-muted-foreground font-mono truncate" dir="ltr">{f.path}</div>
                  </div>
                  <Badge variant="outline" className="tabular-nums shrink-0">{fmtSize(f.size)}</Badge>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive" onClick={() => deleteFile(f.path)} title="حذف لتحرير المساحة">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      )}

      {/* APK quick tool */}
      <Card className="border-dashed">
        <CardContent className="p-4 flex items-center gap-3">
          <PackageOpen className="w-5 h-5 text-lime-600" />
          <div className="text-sm flex-1">أدوات APK: استخراج المثبّت من الجهاز أو فحص حزمة قبل التثبيت — افتح أي ملف APK من متصفح الملفات لتفقّده.</div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { s.setView("files"); s.setCwd("/Download") }}>
            <Send className="w-3.5 h-3.5" /> فتح التنزيلات
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
