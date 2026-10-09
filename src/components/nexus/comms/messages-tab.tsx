"use client"
// الرسائل النصية SMS — قراءة وإرسال من الكمبيوتر مع سجل محادثات كامل
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useComms, initials, avatarColor, relTime, clockTime } from "@/lib/comms-store"
import { loadThread, sendSms } from "@/hooks/use-comms"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Send, Search, ArrowRight, RefreshCw, Phone, Check, CheckCheck, Clock3, MessageSquare,
} from "lucide-react"

function StatusTicks({ status }: { status: string }) {
  if (status === "sending") return <Clock3 className="w-3 h-3 text-white/60" />
  if (status === "sent") return <Check className="w-3 h-3 text-white/70" />
  if (status === "read") return <CheckCheck className="w-3 h-3 text-cyan-200" />
  return <CheckCheck className="w-3 h-3 text-white/70" /> // delivered
}

function ConversationRow({ id }: { id: string }) {
  const c = useComms((s) => s.conversations.find((x) => x.id === id))
  const activeId = useComms((s) => s.activeConversationId)
  const setActive = useComms((s) => s.setActiveConversationId)
  if (!c) return null
  const active = activeId === c.id
  const name = c.contactName ?? c.address
  return (
    <button
      onClick={() => setActive(c.id)}
      className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-start transition-colors ${
        active ? "bg-primary/12 border border-primary/30" : "hover:bg-accent/70 border border-transparent"
      }`}
    >
      <div
        className="w-10 h-10 rounded-2xl grid place-items-center text-white text-[13px] font-bold shrink-0"
        style={{ background: avatarColor(c.address) }}
      >
        {initials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold truncate">{name}</span>
          <span className="text-[10px] text-muted-foreground ms-auto shrink-0">{relTime(c.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[12px] text-muted-foreground truncate flex-1">{c.lastMessage ?? "…"}</p>
          {c.unread > 0 && (
            <Badge className="h-4.5 min-w-4.5 px-1.5 text-[10px] rounded-full bg-primary text-primary-foreground">
              {c.unread}
            </Badge>
          )}
        </div>
      </div>
    </button>
  )
}

function Thread({ conversationId }: { conversationId: string }) {
  const conversation = useComms((s) => s.conversations.find((c) => c.id === conversationId))
  const messages = useComms((s) => s.messages[conversationId])
  const contacts = useComms((s) => s.contacts)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { setActiveConversationId } = useComms()

  useEffect(() => {
    void loadThread(conversationId)
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages?.length])

  if (!conversation) return null
  const name = conversation.contactName ?? conversation.address
  const contact = contacts.find((c) => c.phone === conversation.address)

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await sendSms(conversationId, text)
    setText("")
    setSending(false)
  }

  return (
    <div className="flex flex-col h-full rounded-2xl border bg-card overflow-hidden">
      {/* رأس المحادثة */}
      <div className="flex items-center gap-3 px-4 h-14 border-b bg-card/80">
        <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setActiveConversationId(null)} aria-label="رجوع">
          <ArrowRight className="w-4 h-4" />
        </Button>
        <div
          className="w-9 h-9 rounded-2xl grid place-items-center text-white text-[12px] font-bold"
          style={{ background: avatarColor(conversation.address) }}
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground" dir="ltr">{conversation.address}</div>
        </div>
        <div className="ms-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="مكالمة">
                <Phone className="w-4 h-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>اتصل من تبويب الهاتف</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={async () => {
                  await loadThread(conversationId)
                  toast.success("تمت مزامنة الرسائل مع الهاتف")
                }}
                aria-label="مزامنة"
              >
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>مزامنة سجل المحادثة من الهاتف</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* الرسائل */}
      <ScrollArea className="flex-1 nexus-scroll px-4 py-3">
        <div className="space-y-2">
          {(messages ?? []).map((m) => (
            <div key={m.id} className={`flex ${m.direction === "out" ? "justify-start flex-row-reverse" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                  m.direction === "out"
                    ? "bg-primary text-primary-foreground rounded-ss-md"
                    : "bg-muted rounded-se-md"
                }`}
              >
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                <div className={`flex items-center gap-1 mt-0.5 ${m.direction === "out" ? "justify-start flex-row-reverse" : ""}`}>
                  <span className={`text-[9px] ${m.direction === "out" ? "text-white/60" : "text-muted-foreground"}`}>
                    {clockTime(m.createdAt)}
                  </span>
                  {m.direction === "out" && <StatusTicks status={m.status} />}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* محرر الإرسال */}
      <div className="p-3 border-t bg-card/80">
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={`رسالة إلى ${name}…`}
            className="flex-1 h-10 rounded-2xl text-[13px]"
          />
          <Button onClick={handleSend} disabled={!text.trim() || sending} className="h-10 w-10 rounded-2xl p-0" aria-label="إرسال SMS">
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          تُرسل الرسالة عبر هاتفك {contact ? `(${contact.name})` : ""} — إرسال فوري عبر Nexus Protocol
        </p>
      </div>
    </div>
  )
}

export function MessagesTab() {
  const conversations = useComms((s) => s.conversations)
  const activeId = useComms((s) => s.activeConversationId)
  const [q, setQ] = useState("")

  const filtered = useMemo(
    () =>
      conversations.filter((c) =>
        (c.contactName ?? c.address).includes(q.trim()) || c.address.includes(q.trim())
      ),
    [conversations, q]
  )

  return (
    <div className="grid md:grid-cols-[320px_1fr] gap-3 h-[calc(100vh-215px)]">
      {/* قائمة المحادثات */}
      <div className={`rounded-2xl border bg-card flex flex-col overflow-hidden ${activeId ? "hidden md:flex" : "flex"}`}>
        <div className="p-3 space-y-2 border-b">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث في المحادثات…" className="h-9 ps-9 rounded-xl text-[13px]" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground px-1">
            {conversations.length} محادثة · مزامنة كاملة مع الهاتف
          </p>
        </div>
        <ScrollArea className="flex-1 nexus-scroll">
          <div className="p-2 space-y-1">
            {filtered.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-10">لا توجد محادثات مطابقة</p>
            ) : (
              filtered.map((c) => <ConversationRow key={c.id} id={c.id} />)
            )}
          </div>
        </ScrollArea>
      </div>

      {/* المحادثة */}
      {activeId ? (
        <Thread conversationId={activeId} />
      ) : (
        <div className="hidden md:grid place-items-center rounded-2xl border bg-card/50">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-muted grid place-items-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">اختر محادثة</p>
            <p className="text-[12px] text-muted-foreground max-w-60">
              اقرأ سجل المحادثات كاملاً وأرسل رسائل SMS مباشرة من الكمبيوتر
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
