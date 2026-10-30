"use client"
// مركز الإشعارات — انعكاس فوري + رد سريع + قواعد الفلترة + وضع التركيز الموحد (§52)
import { FocusCard } from "./focus-card"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useComms, relTime } from "@/lib/comms-store"
import { notifAction, quickReplyToNotification, saveFilter } from "@/hooks/use-comms"
import { appMeta } from "@/lib/nexus/comms-types"
import { playNotifSound } from "@/lib/nexus/sounds"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Send, CheckCheck, Archive, Trash2, Settings2, BellOff, Reply, ChevronDown,
  Volume2, VolumeX, Layers, Filter, Sparkles,
} from "lucide-react"

const QUIET_OPTIONS = [
  { label: "15 دقيقة", ms: 15 * 60e3 },
  { label: "30 دقيقة", ms: 30 * 60e3 },
  { label: "ساعة", ms: 60 * 60e3 },
]

function AppIcon({ appId, appName, size = "md" }: { appId: string; appName: string; size?: "sm" | "md" }) {
  const meta = appMeta(appId)
  const dim = size === "sm" ? "w-6 h-6 text-[10px]" : "w-9 h-9 text-xs"
  return (
    <div
      className={`${dim} rounded-xl grid place-items-center shrink-0 text-white font-bold shadow-sm`}
      style={{ background: meta.color }}
      aria-hidden
    >
      {appName.slice(0, 1)}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  if (status === "muted")
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-amber-600 border-amber-500/40"><BellOff className="w-2.5 h-2.5" /> صامت</Badge>
  if (status === "replied")
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-emerald-600 border-emerald-500/40"><Reply className="w-2.5 h-2.5" /> تم الرد</Badge>
  if (status === "archived")
    return <Badge variant="outline" className="text-[10px] px-1.5 py-0">مؤرشف</Badge>
  if (status === "new")
    return <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary hover:bg-primary/15 border-0">جديد</Badge>
  return null
}

function NotificationCard({ id }: { id: string }) {
  const n = useComms((s) => s.notifications.find((x) => x.id === id))
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState("")
  if (!n) return null
  const meta = appMeta(n.appId)
  const dim = n.status === "muted" || n.status === "archived"

  const send = async () => {
    if (!text.trim()) return
    await quickReplyToNotification(n, text)
    setText("")
    setReplying(false)
  }

  return (
    <div className={`group rounded-2xl border bg-card p-3 transition-all hover:shadow-md ${dim ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <AppIcon appId={n.appId} appName={n.appName} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13px] truncate max-w-48">{n.title}</span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
              {n.appName}
            </span>
            <StatusChip status={n.status} />
            <span className="text-[10px] text-muted-foreground ms-auto">{relTime(n.createdAt)}</span>
          </div>
          <p className="text-[13px] text-foreground/85 mt-1 leading-relaxed">{n.body}</p>
          {n.status === "replied" && n.replyText && (
            <div className="mt-2 rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 text-[12px]">
              <span className="text-primary font-medium">ردّك: </span>{n.replyText}
            </div>
          )}

          {/* الرد السريع */}
          {n.actionable && (n.status === "new" || n.status === "read") && (
            <div className="mt-2">
              {replying ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder={`رد سريع عبر ${n.appName}…`}
                    className="h-8 text-[13px] rounded-xl"
                  />
                  <Button size="icon" className="h-8 w-8 rounded-xl shrink-0" onClick={send} aria-label="إرسال الرد">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl shrink-0" onClick={() => setReplying(false)} aria-label="إلغاء">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <Button variant="secondary" size="sm" className="h-7 text-[11px] rounded-lg gap-1.5" onClick={() => setReplying(true)}>
                    <Reply className="w-3 h-3" /> رد سريع
                  </Button>
                  {n.status !== "read" && (
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] rounded-lg gap-1.5" onClick={() => notifAction(n.id, "read")}>
                      <CheckCheck className="w-3 h-3" /> قراءة
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 text-[11px] rounded-lg gap-1.5" onClick={() => notifAction(n.id, "archive")}>
                    <Archive className="w-3 h-3" /> أرشفة
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[11px] rounded-lg gap-1.5 text-destructive hover:text-destructive" onClick={() => notifAction(n.id, "delete")}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const filter = useComms((s) => s.filter)

  const knownApps = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>()
    for (const n of useComms.getState().notifications) {
      const m = appMeta(n.appId)
      seen.set(m.id, { id: m.id, name: m.name, color: m.color })
    }
    return [...seen.values()]
  }, [open])

  const quietActive = filter.quietUntil && new Date(filter.quietUntil) > new Date()

  const toggleHidden = async (appId: string) => {
    const hidden = filter.hiddenApps.includes(appId)
      ? filter.hiddenApps.filter((a) => a !== appId)
      : [...filter.hiddenApps, appId]
    await saveFilter({ hiddenApps: hidden })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" /> قواعد فلترة الإشعارات
          </DialogTitle>
          <DialogDescription>تحكم بما يظهر على الكمبيوتر من إشعارات الهاتف</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* إخفاء تطبيقات */}
          <div>
            <div className="text-[13px] font-semibold mb-2">إخفاء تطبيقات معينة</div>
            <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto nexus-scroll pe-1">
              {knownApps.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-lg shrink-0" style={{ background: a.color }} />
                    <span className="text-[12px] truncate">{a.name}</span>
                  </div>
                  <Switch
                    checked={!filter.hiddenApps.includes(a.id)}
                    onCheckedChange={() => toggleHidden(a.id)}
                    aria-label={`إظهار إشعارات ${a.name}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* تجميع */}
          <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Layers className="w-4 h-4 text-primary" /> تجميع الإشعارات حسب التطبيق
            </div>
            <Switch checked={filter.grouping} onCheckedChange={(v) => saveFilter({ grouping: v })} aria-label="تجميع" />
          </div>

          {/* صامت لفترة */}
          <div>
            <div className="text-[13px] font-semibold mb-2 flex items-center gap-2">
              <BellOff className="w-4 h-4 text-amber-500" /> وضع صامت لفترة مؤقتة
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {QUIET_OPTIONS.map((o) => (
                <Button
                  key={o.ms}
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl text-[12px]"
                  onClick={async () => {
                    await saveFilter({ quietUntil: new Date(Date.now() + o.ms).toISOString() })
                    toast.success(`الإشعارات صامتة لمدة ${o.label}`)
                    onOpenChange(false)
                  }}
                >
                  {o.label}
                </Button>
              ))}
              {quietActive && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-xl text-[12px] gap-1.5"
                  onClick={async () => {
                    await saveFilter({ quietUntil: null })
                    toast("تم إلغاء الوضع الصامت")
                  }}
                >
                  <Volume2 className="w-3.5 h-3.5" /> إلغاء الصمت
                </Button>
              )}
            </div>
            {quietActive && (
              <p className="text-[11px] text-amber-600 mt-2">
                الوضع الصامت مفعّل حتى {new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date(filter.quietUntil!))}
              </p>
            )}
          </div>

          {/* الصوت */}
          <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              {filter.soundEnabled ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
              صوت تنبيه الإشعارات
            </div>
            <Switch checked={filter.soundEnabled} onCheckedChange={(v) => saveFilter({ soundEnabled: v })} aria-label="الصوت" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function NotificationsTab() {
  const notifications = useComms((s) => s.notifications)
  const filter = useComms((s) => s.filter)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [tab, setTab] = useState<"all" | "unread" | "archived">("all")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const visible = useMemo(() => {
    let list = notifications.filter((n) => n.status !== "hidden")
    if (tab === "unread") list = list.filter((n) => n.status === "new")
    else if (tab === "archived") list = list.filter((n) => n.status === "archived")
    else list = list.filter((n) => n.status !== "archived")
    return list
  }, [notifications, tab])

  const groups = useMemo(() => {
    if (!filter.grouping) return null
    const map = new Map<string, typeof visible>()
    for (const n of visible) {
      const arr = map.get(n.appId) ?? []
      arr.push(n)
      map.set(n.appId, arr)
    }
    return [...map.entries()].sort((a, b) => (a[1][0].createdAt < b[1][0].createdAt ? 1 : -1))
  }, [visible, filter.grouping])

  const quietActive = filter.quietUntil && new Date(filter.quietUntil) > new Date()

  return (
    <div className="space-y-3">
      {/* عقد §52 — وضع التركيز الموحد: مفتاح واحد للكتم عبر الأجهزة */}
      <FocusCard />
      {/* شريط الأدوات */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-xl border p-0.5 gap-0.5 bg-card">
          {([["all", "الكل"], ["unread", "غير المقروءة"], ["archived", "الأرشيف"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 h-7 rounded-lg text-[12px] font-medium transition-colors ${
                tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> انعكاس فوري عبر Nexus Protocol
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          {quietActive && (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
              <BellOff className="w-3 h-3" /> صامت حتى {new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date(filter.quietUntil!))}
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => setRulesOpen(true)}>
                <Settings2 className="w-3.5 h-3.5" /> قواعد الفلترة
              </Button>
            </TooltipTrigger>
            <TooltipContent>إخفاء تطبيقات، تجميع، صامت لفترة</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1.5" onClick={() => { playNotifSound(); toast.success("هذا صوت تنبيه الإشعارات") }}>
                {filter.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>تجربة صوت التنبيه</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* القائمة */}
      <ScrollArea className="h-[calc(100vh-215px)] nexus-scroll pe-1">
        {visible.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-muted grid place-items-center">
              <BellOff className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">لا توجد إشعارات هنا</p>
            <p className="text-[12px] text-muted-foreground">
              افتح «الهاتف الافتراضي» وجرّب «إشعار واتساب وارد» — سيظهر هنا فوراً
            </p>
          </div>
        ) : groups ? (
          <div className="space-y-4">
            {groups.map(([appId, list]) => {
              const isCollapsed = collapsed.has(appId)
              const meta = appMeta(appId)
              return (
                <div key={appId} className="space-y-2">
                  <button
                    className="flex items-center gap-2 w-full text-start"
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(appId)) next.delete(appId)
                        else next.add(appId)
                        return next
                      })
                    }
                  >
                    <AppIcon appId={appId} appName={meta.name} size="sm" />
                    <span className="text-[12px] font-semibold">{meta.name}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{list.length}</Badge>
                    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-2 ps-2">
                      {list.map((n) => <NotificationCard key={n.id} id={n.id} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((n) => <NotificationCard key={n.id} id={n.id} />)}
          </div>
        )}
      </ScrollArea>

      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
    </div>
  )
}
