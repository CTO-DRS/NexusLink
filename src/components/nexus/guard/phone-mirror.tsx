"use client"
// NexusLink — مرآة الهاتف: إطار هاتف مصغر يعكس حالة الهاتف لحظياً
// (الرن القوي، وضع الفقدان، المسح، الإعدادات السريعة، المنبهات، منارة القرب)
import { useEffect, useState } from "react"
import {
  Wifi, Bluetooth, Flashlight, BellOff, RotateCcw, Signal, BatteryCharging,
  BatteryFull, AlarmClock, BellRing, ShieldAlert, Eraser, Smartphone, Sun,
} from "lucide-react"
import { useGuard, alarmTime, nextAlarmIn } from "@/lib/guard-store"
import { RssiMeter } from "./guard-bits"
import { cn } from "@/lib/utils"

export function PhoneMirror() {
  const { qs, ringing, lost, wipe, alarms, prox, phoneOnline, targetDeviceId } = useGuard()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const nextAlarm = alarms.filter((a) => a.enabled).map((a) => ({ a, in: nextAlarmIn(a) })).filter((x) => x.in != null).sort((x, y) => x.in! - y.in!)[0]
  const hh = now.getHours().toString().padStart(2, "0")
  const mm = now.getMinutes().toString().padStart(2, "0")

  const tiles = [
    { on: qs.wifi, Icon: Wifi },
    { on: qs.bluetooth, Icon: Bluetooth },
    { on: qs.flashlight, Icon: Flashlight },
    { on: qs.dnd, Icon: BellOff },
    { on: qs.rotate, Icon: RotateCcw },
    { on: qs.data, Icon: Signal },
  ]

  return (
    <div className="rounded-[26px] border-4 border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden" dir="rtl">
      {/* شريط الحالة */}
      <div className="flex items-center justify-between px-3 pt-2 text-[9px] text-white/80 font-mono" dir="ltr">
        <span>{hh}:{mm}</span>
        <div className="flex items-center gap-1">
          {qs.hotspot && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
          <BatteryCharging className="w-3 h-3 text-emerald-400" />
          <span>78</span>
        </div>
      </div>

      {/* الشاشة */}
      <div className="relative aspect-[9/17] mx-3 my-2 rounded-2xl overflow-hidden bg-gradient-to-b from-zinc-900 to-black">
        {wipe.stage === "wiped" ? (
          <WipedScreen />
        ) : ringing ? (
          <RingingScreen />
        ) : lost.active ? (
          <LostScreen />
        ) : wipe.stage === "wiping" ? (
          <WipingScreen />
        ) : (
          <HomeScreen hh={hh} mm={mm} nextAlarm={nextAlarm} tiles={tiles} brightness={qs.brightness} />
        )}
      </div>

      {/* منارة القرب */}
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <Smartphone className={cn("w-3 h-3", phoneOnline ? "text-emerald-400" : "text-zinc-600")} />
        <span className="text-[9px] text-white/50 flex-1">
          {phoneOnline ? "هاتفك الحقيقي يبث المنارة" : targetDeviceId === "galaxy-s24" ? "Galaxy-S24 · منارة المحاكاة" : "لا هاتف متصل"}
        </span>
        <RssiMeter rssi={prox.rssi} size="sm" />
      </div>
    </div>
  )
}

function HomeScreen({ hh, mm, nextAlarm, tiles, brightness }: {
  hh: string; mm: string
  nextAlarm?: { a: { hour: number; minute: number; label: string; id?: string; days?: number[]; enabled?: boolean }; in: number | null }
  tiles: { on: boolean; Icon: typeof Wifi }[]
  brightness: number
}) {
  return (
    <div className="h-full flex flex-col p-3 text-white">
      <div className="text-center mt-4">
        <div className="text-4xl font-black tracking-tight" dir="ltr">{hh}:{mm}</div>
        <div className="text-[9px] text-white/40 mt-0.5">
          {new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
        </div>
      </div>
      {nextAlarm && (
        <div className="mt-4 rounded-xl bg-white/8 px-2.5 py-2 flex items-center gap-2">
          <AlarmClock className="w-3.5 h-3.5 text-teal-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold truncate">{nextAlarm.a.label}</div>
            <div className="text-[8.5px] text-white/40" dir="ltr">{alarmTime(nextAlarm.a as any)}</div>
          </div>
        </div>
      )}
      <div className="mt-auto grid grid-cols-3 gap-1.5">
        {tiles.map((t, i) => (
          <div key={i} className={cn("rounded-xl aspect-square grid place-items-center transition-colors", t.on ? "bg-teal-500/25 text-teal-300" : "bg-white/5 text-white/25")}>
            <t.Icon className="w-4 h-4" />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Sun className="w-3 h-3 text-white/40 shrink-0" />
        <div className="h-1 rounded-full bg-white/10 flex-1 overflow-hidden">
          <div className="h-full bg-white/60 rounded-full transition-all" style={{ width: `${brightness}%` }} />
        </div>
      </div>
    </div>
  )
}

function RingingScreen() {
  return (
    <div className="h-full grid place-items-center bg-red-600/90 animate-pulse">
      <div className="text-center text-white px-3">
        <BellRing className="w-14 h-14 mx-auto mb-3 animate-bounce" />
        <div className="text-[13px] font-black">الهاتف يرن بأقصى صوت</div>
        <div className="text-[9px] bg-white/20 rounded-full px-2 py-0.5 mt-1.5 inline-block">تجاوز الوضع الصامت</div>
      </div>
    </div>
  )
}

function LostScreen() {
  const { lost } = useGuard()
  return (
    <div className="h-full flex flex-col bg-zinc-900">
      <div className="bg-amber-500 text-black text-center text-[9px] font-bold py-1">وضع الفقدان مفعّل</div>
      <div className="flex-1 grid place-items-center px-4 text-center">
        <div>
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-amber-400" />
          <p className="text-[10.5px] text-white/90 leading-relaxed">{lost.message}</p>
          {lost.callback && <p className="text-[9px] text-white/50 mt-2 font-mono" dir="ltr">{lost.callback}</p>}
        </div>
      </div>
      <div className="text-center text-[8.5px] text-white/30 pb-3">NexusLink · حماية الجهاز</div>
    </div>
  )
}

function WipingScreen() {
  const { wipe } = useGuard()
  return (
    <div className="h-full grid place-items-center bg-black">
      <div className="text-center text-white px-4 w-full">
        <Eraser className="w-10 h-10 mx-auto mb-2 text-red-400 animate-pulse" />
        <div className="text-[11px] font-bold mb-2">جارٍ مسح البيانات…</div>
        <div className="h-1.5 rounded-full bg-white/10 mx-4 overflow-hidden">
          <div className="h-full bg-red-500 transition-all" style={{ width: `${wipe.progress}%` }} />
        </div>
        <div className="text-[9px] text-white/40 mt-1" dir="ltr">{Math.round(wipe.progress)}%</div>
      </div>
    </div>
  )
}

function WipedScreen() {
  return (
    <div className="h-full grid place-items-center bg-black text-center">
      <div className="text-white/70 px-4">
        <BatteryFull className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <div className="text-[11px] font-bold">تم مسح الجهاز</div>
        <div className="text-[9px] text-white/40 mt-1">مرحباً بك — أعد التنشيط للمتابعة</div>
      </div>
    </div>
  )
}
