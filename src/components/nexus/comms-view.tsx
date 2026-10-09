"use client"
// طبقة الاتصالات الشخصية — غلاف التبويبات
import { useComms } from "@/lib/comms-store"
import { NotificationsTab } from "./comms/notifications-tab"
import { MessagesTab } from "./comms/messages-tab"
import { ContactsTab } from "./comms/contacts-tab"
import { CallsTab } from "./comms/calls-tab"
import { MessagesSquare, BellRing, MessageSquareText, Users, Phone } from "lucide-react"

const TABS = [
  { id: "notifications", label: "الإشعارات", icon: BellRing },
  { id: "messages", label: "الرسائل", icon: MessageSquareText },
  { id: "contacts", label: "جهات الاتصال", icon: Users },
  { id: "calls", label: "الهاتف", icon: Phone },
] as const

export function CommsView() {
  const tab = useComms((s) => s.activeTab)
  const setTab = useComms((s) => s.setActiveTab)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-primary" />
            طبقة الاتصالات الشخصية
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            انعكاس الإشعارات، الرد السريع، الرسائل والمكالمات — كل شيء من الكمبيوتر عبر هاتفك
          </p>
        </div>
        <nav className="flex rounded-2xl border p-1 gap-1 bg-card" aria-label="تبويبات الاتصالات">
          {TABS.map((t) => {
            const active = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-xl text-[12.5px] font-medium transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="nexus-enter" key={tab}>
        {tab === "notifications" && <NotificationsTab />}
        {tab === "messages" && <MessagesTab />}
        {tab === "contacts" && <ContactsTab />}
        {tab === "calls" && <CallsTab />}
      </div>
    </div>
  )
}
