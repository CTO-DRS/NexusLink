"use client"
// صفحة جهاز التحكم المستقلة — تُفتح على الهاتف الحقيقي وتتحكم بشاشة الكمبيوتر عبر Nexus Protocol
import { useControllerBridge } from "@/hooks/use-controller-bridge"
import { useRcMirror } from "@/lib/remote-store"
import { ControllerShell } from "@/components/nexus/remote/controller/controller-shell"
import { Link2, Smartphone, Wifi, WifiOff, Signal } from "lucide-react"

export default function ControllerPage() {
  useControllerBridge("هاتف Nexus (متصفح حقيقي)")
  const online = useRcMirror((s) => s.online)
  const latency = useRcMirror((s) => s.latency)
  const report = useRcMirror((s) => s.report)

  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-secondary/60 to-background">
      {/* ترويسة مدمجة */}
      <header className="shrink-0 flex items-center gap-2 px-3 h-12 border-b bg-background/80 backdrop-blur-xl">
        <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground grid place-items-center shadow-md shadow-primary/25">
          <Link2 className="w-3.5 h-3.5" strokeWidth={2.4} />
        </div>
        <div className="leading-tight me-auto">
          <p className="font-bold text-[13px]">NexusLink — جهاز التحكم</p>
          <p className="text-[9px] text-muted-foreground">المرحلة 6 · هاتفك يدير الكمبيوتر</p>
        </div>
        <span className={`flex items-center gap-1 text-[9.5px] font-bold rounded-full px-2 py-1 ${online ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? "متصل" : "غير متصل"}
        </span>
        {latency != null && (
          <span className="flex items-center gap-0.5 text-[9.5px] text-muted-foreground tabular-nums" dir="ltr">
            <Signal className="w-3 h-3" /> {latency}ms
          </span>
        )}
      </header>

      <main className="flex-1 min-h-0">
        <ControllerShell standalone />
      </main>

      <footer className="shrink-0 border-t bg-background/70 px-3 py-1.5 text-center text-[8.5px] text-muted-foreground">
        <Smartphone className="w-2.5 h-2.5 inline -mt-0.5 me-1" />
        {report ? `الكمبيوتر: ${report.power === "on" ? "يعمل" : report.power} · استجابة فورية عبر الجسر المحلي` : "بانتظار أول تقرير حالة من الكمبيوتر…"}
      </footer>
    </div>
  )
}
