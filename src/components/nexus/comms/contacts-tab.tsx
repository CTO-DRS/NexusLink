"use client"
// جهات الاتصال + سجل المكالمات
import { useMemo, useState } from "react"
import { useComms, initials, avatarColor, relTime } from "@/lib/comms-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Search, Phone, MessageSquare, Star, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneCall, Users, History } from "lucide-react"
import { toast } from "sonner"
import { dial } from "./dialer"

function ContactRow({ id }: { id: string }) {
  const c = useComms((s) => s.contacts.find((x) => x.id === id))
  if (!c) return null
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-accent/60 transition-colors">
      <div
        className="w-10 h-10 rounded-2xl grid place-items-center text-white text-[13px] font-bold shrink-0"
        style={{ background: avatarColor(c.phone) }}
      >
        {initials(c.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold truncate">{c.name}</span>
          {c.favorite && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
        </div>
        <div className="text-[11px] text-muted-foreground" dir="ltr">{c.phone}</div>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => dial(c.phone, c.name)} aria-label={`اتصال بـ ${c.name}`}>
              <Phone className="w-4 h-4 text-emerald-600" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>اتصال</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => toast.info(`افتح تبويب «الرسائل» ثم اختر محادثة ${c.name}`)} aria-label="رسالة">
              <MessageSquare className="w-4 h-4 text-primary" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>رسالة SMS</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function CallRow({ id }: { id: string }) {
  const c = useComms((s) => s.calllog.find((x) => x.id === id))
  if (!c) return null
  const Icon = c.direction === "missed" ? PhoneMissed : c.direction === "out" ? PhoneOutgoing : PhoneIncoming
  const color = c.direction === "missed" ? "text-red-500" : c.direction === "out" ? "text-emerald-600" : "text-primary"
  const label = c.direction === "missed" ? "فائتة" : c.direction === "out" ? "صادرة" : "واردة"
  const dur = `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}`
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-accent/60 transition-colors">
      <div className={`w-8 h-8 rounded-xl bg-muted grid place-items-center shrink-0`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate">{c.contactName ?? c.number}</div>
        <div className="text-[10px] text-muted-foreground">
          {label} · {relTime(c.startedAt)}{c.durationSec > 0 && ` · ${dur}`}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground hidden sm:block" dir="ltr">{c.number}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => dial(c.number, c.contactName ?? undefined)} aria-label="معاودة الاتصال">
            <PhoneCall className="w-4 h-4 text-emerald-600" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>معاودة الاتصال</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ContactsTab() {
  const contacts = useComms((s) => s.contacts)
  const calllog = useComms((s) => s.calllog)
  const [section, setSection] = useState<"contacts" | "log">("contacts")
  const [q, setQ] = useState("")

  const filteredContacts = useMemo(() => contacts.filter((c) => c.name.includes(q.trim()) || c.phone.includes(q.trim())), [contacts, q])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-xl border p-0.5 gap-0.5 bg-card">
          {([["contacts", "جهات الاتصال"], ["log", "سجل المكالمات"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSection(k)}
              className={`px-3.5 h-7 rounded-lg text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
                section === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {k === "contacts" ? <Users className="w-3 h-3" /> : <History className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {section === "contacts" && (
          <div className="relative flex-1 max-w-64">
            <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو الرقم…" className="h-8 ps-9 rounded-xl text-[13px]" />
          </div>
        )}
        <Badge variant="secondary" className="text-[10px] ms-auto">
          {section === "contacts" ? `${contacts.length} جهة اتصال مزامَنة` : `${calllog.length} مكالمة`}
        </Badge>
      </div>

      <ScrollArea className="h-[calc(100vh-245px)] nexus-scroll pe-1">
        <div className="rounded-2xl border bg-card p-2 space-y-0.5">
          {section === "contacts" ? (
            filteredContacts.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-12">لا توجد نتائج</p>
            ) : (
              filteredContacts.map((c) => <ContactRow key={c.id} id={c.id} />)
            )
          ) : calllog.length === 0 ? (
            <p className="text-center text-[12px] text-muted-foreground py-12">لا توجد مكالمات بعد</p>
          ) : (
            calllog.map((c) => <CallRow key={c.id} id={c.id} />)
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
