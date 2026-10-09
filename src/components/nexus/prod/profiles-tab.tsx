"use client"
// ملفات التعريف حسب الشبكة — (البيت = مزامنة صور + إشعارات) / (العمل = إشعارات فقط)
import { useState } from "react"
import { toast } from "sonner"
import {
  Network, Home, Briefcase, Coffee, Laptop, Plus, Trash2, Wifi, Loader2,
  Images, BellRing, ClipboardCheck, FolderSync, Wand2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProd, type NetProfileT } from "@/lib/prod-store"
import { netSet } from "@/lib/prod-socket"
import { cn } from "@/lib/utils"

const ICONS: Record<string, typeof Home> = { home: Home, briefcase: Briefcase, coffee: Coffee, laptop: Laptop }

function FeatSwitch({ profile, feat, icon: Icon, label }: { profile: NetProfileT; feat: "photoSync" | "notifs" | "clipboard" | "folderSync"; icon: typeof Images; label: string }) {
  const { setProfiles } = useProd()
  async function toggle(v: boolean) {
    useProd.setState({
      profiles: useProd.getState().profiles.map((p) => (p.id === profile.id ? { ...p, [feat]: v } : p)),
    })
    if (useProd.getState().profile?.id === profile.id) {
      useProd.getState().setProfile({ ...profile, [feat]: v })
      if (feat === "notifs") useProd.getState().setState({ notifsPaused: !v })
    }
    const r = await fetch("/api/prod/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: profile.id, [feat]: v }),
    })
    const j = await r.json()
    if (j.ok) setProfiles(useProd.getState().profiles)
    else toast.error("تعذر الحفظ")
  }
  return (
    <label className="flex items-center justify-between gap-2 rounded-xl bg-background/60 border px-2.5 py-2 cursor-pointer">
      <span className="flex items-center gap-1.5 text-[11px] font-medium">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" /> {label}
      </span>
      <Switch checked={profile[feat]} onCheckedChange={(v) => void toggle(v)} aria-label={label} />
    </label>
  )
}

export function ProfilesTab() {
  const { profiles, state, profile, networks } = useProd()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [net, setNet] = useState("")
  const [icon, setIcon] = useState("laptop")
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)

  async function refresh() {
    const j = await fetch("/api/prod/profiles").then((r) => r.json()).catch(() => null)
    if (j?.profiles) useProd.getState().setProfiles(j.profiles)
  }

  async function switchNetwork(n: string) {
    setSwitching(true)
    netSet(n)
    // تحديث محلي فوري — ثم سحب الحقيقة من الخادم
    setTimeout(async () => {
      const j = await fetch("/api/prod/network").then((r) => r.json()).catch(() => null)
      if (j) {
        useProd.getState().setState({ network: j.network, activeProfileId: j.profile?.id ?? null })
        useProd.getState().setProfile(j.profile ?? null)
      }
      setSwitching(false)
    }, 600)
  }

  async function createProfile() {
    if (!name.trim() || !net.trim()) return
    setBusy(true)
    const r = await fetch("/api/prod/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), networkName: net.trim(), icon }),
    })
    const j = await r.json()
    setBusy(false)
    if (j.ok) {
      await refresh()
      setOpen(false); setName(""); setNet("")
      toast.success(`أُنشئ الملف «${j.profile.name}»`, { description: `ينطبق تلقائياً على شبكة ${j.profile.networkName}` })
    } else toast.error(j.error || "فشل الإنشاء")
  }

  async function removeProfile(id: string) {
    const r = await fetch("/api/prod/profiles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    if (!j.ok) toast.error(j.error || "تعذر الحذف")
    await refresh()
  }

  return (
    <div className="space-y-4">
      {/* الشبكة الحالية */}
      <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center">
            <Wifi className="w-4.5 h-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-bold">الشبكة الحالية: <span className="font-mono">{state.network}</span></div>
            <div className="text-[10.5px] text-muted-foreground">
              {profile ? `الملف الشخصي المطبق: ${profile.name}` : "لا ملف تعريف لهذه الشبكة — كل الميزات بالوضع اليدوي"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {switching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Select value={state.network} onValueChange={(v) => void switchNetwork(v)}>
            <SelectTrigger className="w-44 rounded-xl text-[12px]" aria-label="تبديل الشبكة"><SelectValue /></SelectTrigger>
            <SelectContent>
              {networks.map((n) => (
                <SelectItem key={n} value={n} className="text-[12px]">{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-[12.5px] text-muted-foreground leading-relaxed max-w-2xl">
        كل شبكة لها شخصية: <span className="font-semibold text-foreground">البيت</span> = مزامنة الصور + الإشعارات + الحافظة + المجلدات،
        و<span className="font-semibold text-foreground">العمل</span> = الإشعارات فقط — عند انتقال الجهاز بين الشبكات يُطبّق الملف المطابق تلقائياً
        وتمتلئ الميزات أو تتوقف حسب مضمونه. جرّب التبديل من القائمة أعلاه وشاهد التأثير الفوري.
      </p>

      {/* البطاقات */}
      <div className="grid gap-3 md:grid-cols-2">
        {profiles.map((p) => {
          const Icon = ICONS[p.icon] ?? Laptop
          const active = profile?.id === p.id
          return (
            <div key={p.id} className={cn("rounded-2xl border bg-card p-4 space-y-3", active ? "border-violet-500/60 ring-1 ring-violet-500/30" : "")}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={cn("w-9 h-9 rounded-xl grid place-items-center", active ? "bg-violet-500 text-white shadow-md shadow-violet-500/30" : "bg-muted text-muted-foreground")}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="leading-tight">
                    <div className="text-[13px] font-bold flex items-center gap-1.5">
                      {p.name}
                      {active && <Badge className="rounded-full text-[8.5px] bg-violet-500 hover:bg-violet-500">مطبق الآن</Badge>}
                      {p.builtin && <Badge variant="secondary" className="rounded-full text-[8.5px]">مدمج</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono dir-ltr text-start">📡 {p.networkName}</div>
                  </div>
                </div>
                {!p.builtin && (
                  <Button variant="ghost" size="icon" className="w-7 h-7 rounded-lg text-red-500" aria-label="حذف الملف" onClick={() => void removeProfile(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <FeatSwitch profile={p} feat="photoSync" icon={Images} label="مزامنة الصور" />
                <FeatSwitch profile={p} feat="notifs" icon={BellRing} label="الإشعارات" />
                <FeatSwitch profile={p} feat="clipboard" icon={ClipboardCheck} label="الحافظة" />
                <FeatSwitch profile={p} feat="folderSync" icon={FolderSync} label="مزامنة المجلدات" />
              </div>
            </div>
          )
        })}

        <button
          className="rounded-2xl border border-dashed bg-card/50 p-4 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors min-h-40"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-6 h-6" />
          <span className="text-[12px] font-semibold">ملف تعريف جديد</span>
          <span className="text-[10px]">اربط شبكة بشخصية مخصصة</span>
        </button>
      </div>

      {/* حوار الإنشاء */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ملف تعريف جديد</DialogTitle>
            <DialogDescription>سيُطبق تلقائياً عند اتصال الأجهزة بالشبكة المحددة</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الملف (مثال: المقهى)" className="rounded-xl text-[12.5px]" aria-label="اسم الملف" />
            <Input value={net} onChange={(e) => setNet(e.target.value)} placeholder="اسم الشبكة (SSID) مثال: Cafe-Guest" className="rounded-xl text-[12.5px]" aria-label="اسم الشبكة" dir="auto" />
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger className="w-full rounded-xl text-[12px]"><SelectValue placeholder="الأيقونة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="home" className="text-[12px]">بيت</SelectItem>
                <SelectItem value="briefcase" className="text-[12px]">عمل</SelectItem>
                <SelectItem value="coffee" className="text-[12px]">مقهى</SelectItem>
                <SelectItem value="laptop" className="text-[12px]">عام</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10.5px] text-muted-foreground flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" /> الميزات الأربع مفعّلة افتراضياً — عدّلها بعد الإنشاء من البطاقة
            </p>
            <Button className="w-full rounded-xl" disabled={busy || !name.trim() || !net.trim()} onClick={() => void createProfile()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إنشاء
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
