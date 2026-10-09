"use client"
// مزامنة المجلدات ثنائية الاتجاه — أزواج دائمة بنسخ بايتات حقيقي
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  FolderSync, Plus, Play, Pause, Trash2, RefreshCcw, FolderOpen,
  ArrowRightLeft, AlertTriangle, ChevronLeft, Loader2, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProd, type SyncPairItem } from "@/lib/prod-store"
import { fmtSize, fmtDate, useNexus } from "@/lib/store"
import { cn } from "@/lib/utils"

const ACTION_LABEL: Record<string, string> = {
  "new-A2B": "جديد ←", "new-B2A": "→ جديد", "upd-A2B": "تحديث ←", "upd-B2A": "→ تحديث", conflict: "تعارض",
}

function PairFolderPicker({ deviceId, value, onChange }: { deviceId: string; value: string; onChange: (p: string) => void }) {
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([])
  const [cwd, setCwd] = useState("/")

  useEffect(() => {
    if (!deviceId) return
    fetch("/api/prod/pairs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, path: cwd }),
    })
      .then((r) => r.json())
      .then((j) => setDirs(j.dirs ?? []))
      .catch(() => setDirs([]))
  }, [deviceId, cwd])

  return (
    <div className="rounded-xl border bg-background/60 p-2 space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] font-mono dir-ltr justify-start">
        <Button variant="ghost" size="icon" className="w-6 h-6" aria-label="رجوع" onClick={() => setCwd(cwd === "/" ? "/" : cwd.split("/").slice(0, -1).join("/") || "/")}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="truncate">{cwd}</span>
      </div>
      <ScrollArea className="max-h-36">
        <div className="space-y-0.5">
          {dirs.map((d) => (
            <button
              key={d.path}
              className="w-full text-start rounded-lg px-2 py-1.5 text-[11.5px] hover:bg-accent flex items-center gap-1.5"
              onClick={() => { setCwd(d.path); onChange(d.path) }}
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
              {d.name}
            </button>
          ))}
          {dirs.length === 0 && <p className="text-[10.5px] text-muted-foreground px-2 py-2">لا مجلدات فرعية</p>}
        </div>
      </ScrollArea>
      <div className="text-[10.5px] text-violet-600 dark:text-violet-400 font-semibold truncate" dir="ltr">{value || "—"}</div>
    </div>
  )
}

export function FoldersTab() {
  const { pairs, setPairs, patchPair } = useProd()
  const devices = useNexus((s) => s.devices)
  const [open, setOpen] = useState(false)
  const [devA, setDevA] = useState("galaxy-s24")
  const [devB, setDevB] = useState("pc-office")
  const [foldA, setFoldA] = useState("")
  const [foldB, setFoldB] = useState("")
  const [busy, setBusy] = useState(false)

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id
  const deviceOnline = (id: string) => devices.find((d) => d.id === id)?.state === "connected"

  async function refresh() {
    const j = await fetch("/api/prod/pairs").then((r) => r.json()).catch(() => null)
    if (j?.pairs) setPairs(j.pairs)
  }

  async function runNow(id: string) {
    patchPair(id, { running: true })
    const r = await fetch("/api/prod/pairs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    if (j.ok) {
      toast.success(`تمت المزامنة — ${j.copied} ملف (${fmtSize(j.bytes)})`, { description: "نسخ بايتات فعلي بين المجلدين" })
    } else {
      toast.error("تعذرت المزامنة", { description: "تحقق من اتصال الجهازين" })
    }
    await refresh()
  }

  async function toggle(pair: SyncPairItem, key: "active" | "autoSync", v: boolean) {
    patchPair(pair.id, { [key]: v })
    await fetch("/api/prod/pairs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pair.id, [key]: v }),
    })
  }

  async function remove(id: string) {
    await fetch("/api/prod/pairs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    await refresh()
    toast("حُذف زوج المزامنة")
  }

  async function createPair() {
    if (!foldA || !foldB) {
      toast.error("اختر المجلدين من المتصفح")
      return
    }
    setBusy(true)
    const r = await fetch("/api/prod/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceA: devA, folderA: foldA, deviceB: devB, folderB: foldB }),
    })
    const j = await r.json()
    setBusy(false)
    if (j.ok) {
      setOpen(false)
      setFoldA(""); setFoldB("")
      await refresh()
      toast.success("أُنشئ الزوج — المزامنة الدائمة بدأت", { description: "أي تغيير في المجلدين يُنسخ تلقائياً للطرف الآخر" })
      void runNow(j.pair.id)
    } else {
      toast.error(j.error || "فشل الإنشاء")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[12.5px] text-muted-foreground leading-relaxed max-w-xl">
          اختر مجلدين في جهازين ← تزامن دائم ثنائي الاتجاه. الأحدث يفوز، والموجود في طرف فقط يُنسخ للطرف الآخر —
          بنسخ بايتات حقيقي عبر نظام ملفات كل جهاز.
        </div>
        <Button className="rounded-xl h-9 gap-1.5 text-[12px]" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4" /> زوج مزامنة جديد
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {pairs.map((p) => {
          const online = deviceOnline(p.deviceA) && deviceOnline(p.deviceB)
          const conflicts = (p.events ?? []).filter((e) => e.action === "conflict").length
          return (
            <div key={p.id} className={cn("rounded-2xl border bg-card p-4 space-y-3", !p.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-[12.5px] font-bold min-w-0">
                  <div className={cn("w-8 h-8 rounded-xl grid place-items-center shrink-0", p.active ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
                    <FolderSync className="w-4 h-4" />
                  </div>
                  <span className="truncate font-mono dir-ltr text-[11.5px]">{p.folderA}</span>
                  <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate font-mono dir-ltr text-[11.5px]">{p.folderB}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg" aria-label="مزامنة الآن" onClick={() => void runNow(p.id)} disabled={p.running || !online}>
                    {p.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-red-500" aria-label="حذف الزوج" onClick={() => void remove(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] text-muted-foreground">
                <Badge variant="outline" className="rounded-full text-[9.5px] gap-1">
                  {deviceName(p.deviceA)} {deviceOnline(p.deviceA) ? "🟢" : "🔴"}
                </Badge>
                <Badge variant="outline" className="rounded-full text-[9.5px] gap-1">
                  {deviceName(p.deviceB)} {deviceOnline(p.deviceB) ? "🟢" : "🔴"}
                </Badge>
                {p.lastSyncAt && (
                  <span>آخر مزامنة: {fmtDate(p.lastSyncAt)} · {p.lastCount} ملف ({fmtSize(p.lastBytes)})</span>
                )}
              </div>

              {p.running && (
                <div className="space-y-1">
                  <Progress value={p.progress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground">جارٍ النسخ…</p>
                </div>
              )}

              {conflicts > 0 && (
                <div className="flex items-center gap-1.5 text-[10.5px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {conflicts} تعارض حُلّ بالأحدث تلقائياً
                </div>
              )}

              {/* آخر الأحداث */}
              {(p.events ?? []).length > 0 && (
                <ScrollArea className="max-h-28 rounded-xl bg-background/60 border p-2">
                  <div className="space-y-1">
                    {(p.events ?? []).map((e) => (
                      <div key={e.id} className="flex items-center gap-1.5 text-[10.5px]">
                        <Badge variant="secondary" className="rounded-full text-[8.5px] px-1.5 shrink-0">{ACTION_LABEL[e.action] ?? e.action}</Badge>
                        <span className="font-mono dir-ltr truncate text-start">{e.relPath}</span>
                        <span className="ms-auto shrink-0 text-muted-foreground">{fmtSize(e.bytes)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <div className="flex items-center justify-between gap-2 border-t pt-2.5">
                <label className="flex items-center gap-1.5 text-[11px]">
                  <Switch checked={p.active} onCheckedChange={(v) => void toggle(p, "active", v)} aria-label="تفعيل الزوج" />
                  <span className="flex items-center gap-1">{p.active ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />} {p.active ? "مفعّل" : "موقوف"}</span>
                </label>
                <label className="flex items-center gap-1.5 text-[11px]">
                  <Switch checked={p.autoSync} onCheckedChange={(v) => void toggle(p, "autoSync", v)} aria-label="مزامنة تلقائية" />
                  تلقائي كل 12ث
                </label>
              </div>
            </div>
          )
        })}

        {pairs.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center md:col-span-2">
            <FolderSync className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-[12.5px] text-muted-foreground">لا أزواج بعد — أنشئ زوجاً واختر مجلدين ليبدأ التزامن الدائم</p>
          </div>
        )}
      </div>

      {/* حوار الإنشاء */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>زوج مزامنة جديد</DialogTitle>
            <DialogDescription>اختر جهازين ومجلداً في كل منهما — التزامن ثنائي الاتجاه دائم</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-[11.5px] font-bold flex items-center gap-1"><ArrowRightLeft className="w-3 h-3 rotate-90" /> الطرف A</div>
              <Select value={devA} onValueChange={setDevA}>
                <SelectTrigger className="w-full rounded-xl text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {devices.filter((d) => d.id !== devB).map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-[12px]">{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PairFolderPicker deviceId={devA} value={foldA} onChange={setFoldA} />
            </div>
            <div className="space-y-2">
              <div className="text-[11.5px] font-bold flex items-center gap-1"><ArrowRightLeft className="w-3 h-3 rotate-90" /> الطرف B</div>
              <Select value={devB} onValueChange={setDevB}>
                <SelectTrigger className="w-full rounded-xl text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {devices.filter((d) => d.id !== devA).map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-[12px]">{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PairFolderPicker deviceId={devB} value={foldB} onChange={setFoldB} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            بعد الإنشاء تُشغَّل مزامنة أولى فوراً وتُكرر تلقائياً كل 12 ثانية
          </div>
          <Button className="rounded-xl" disabled={busy || !foldA || !foldB} onClick={() => void createPair()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إنشاء وبدء المزامنة
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
