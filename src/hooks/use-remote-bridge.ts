"use client"
// NexusLink — خطاف جهة الكمبيوتر: استقبال أوامر الهاتف وتطبيقها + بث الحالة
import { useEffect } from "react"
import { useDesktop, useRcMirror } from "@/lib/remote-store"
import { getRemoteSocket, desktopRegister, pushDesktopState, pushDesktopClipboard, rcPing } from "@/lib/remote-socket"

export function useRemoteBridge() {
  useEffect(() => {
    // إقلاع الجسر داخل خادم Next (idempotent) ثم الاتصال
    fetch("/api/remote/boot").catch(() => { /* ignore */ })
    const socket = getRemoteSocket()
    const st = () => useDesktop.getState()

    socket.on("connect", () => {
      st().setRcOnline(true)
      desktopRegister("NEXUS-PC", "A4:5E:60:C1:2D:9F")
      // مرآة الحالة لوحدة التحكم المدمجة في نفس الصفحة
      const mir = useRcMirror.getState()
      mir.setOnline(true)
      mir.setDesktopInfo("NEXUS-PC", "A4:5E:60:C1:2D:9F")
      st().pushLocalLog("جسر التحكم عن بُعد متصل — الكمبيوتر بانتظار أوامر الهاتف", "ok")
    })
    socket.on("disconnect", () => {
      st().setRcOnline(false)
      useRcMirror.getState().setOnline(false)
    })

    // ==== أحداث الإدخال من الهاتف ====
    socket.on("rc:move", (d: { dx: number; dy: number; source?: string; drag?: boolean }) => {
      st().applyMove(d.dx ?? 0, d.dy ?? 0, (d.source as "touchpad") ?? "touchpad")
      if (d.drag) useRcMirror.getState().setDragActive(true)
      else if (useRcMirror.getState().dragActive) useRcMirror.getState().setDragActive(false)
    })
    socket.on("rc:click", (d: { button: "left" | "right"; type?: "tap" | "double" }) => {
      st().applyClick(d.button ?? "left", d.type ?? "tap")
    })
    socket.on("rc:scroll", (d: { dy: number }) => st().applyScroll(d.dy ?? 0))
    socket.on("rc:pinch", (d: { scale: number }) => st().applyPinch(d.scale ?? 1))
    socket.on("rc:key", (d: { ch?: string; special?: string }) => st().applyKey(d))
    socket.on("rc:gamepad", (d: { kind: string; x?: number; y?: number; button?: string; action?: string }) => {
      st().applyGamepad(d)
    })
    socket.on("rc:presenter", (d: { action: string; value?: boolean; x?: number; y?: number }) => {
      st().applyPresenter(d)
    })
    socket.on("rc:media", (d: { action: string; value?: number; target?: string }) => st().applyMedia(d))
    socket.on("rc:power", (d: { action: "shutdown" | "restart" | "sleep" | "hibernate" | "lock" | "unlock" }) => {
      st().applyPower(d.action)
    })
    socket.on("rc:clipboard", (d: { direction: "toPc" | "pull"; text?: string }) => {
      if (d.direction === "toPc") st().applyClipboardToPc(d.text ?? "")
      else pushDesktopClipboard(useDesktop.getState().clipboard?.text ?? "")
    })
    socket.on("desktop:wake", (d: { source: string }) => st().applyWake(d.source))

    // ==== FA-9: تسليم رابط "أكمل من حيث توقفت" ====
    socket.on("rc:handoff", (d: { url?: string; title?: string }) => {
      st().pushHandoff(d.url ?? "", d.title)
    })

    // ==== سجل + هاتف متصل ====
    socket.on("rc:log", (e: { id: string; text: string; kind: "in" | "ok" | "info"; at: number }) => {
      st().pushRcLog(e)
    })
    socket.on("rc:controller-online", (d: { name: string }) => {
      st().setPhoneConnected(d.name)
    })

    // ==== بث الحالة عند أي تغيير (مُحسَّن بمقارنة التوقيع) ====
    let lastSig = ""
    const unsub = useDesktop.subscribe((s) => {
      const report = s.buildReport()
      const sig = `${report.power}|${report.activeApp}|${report.presenter.index}|${report.presenter.black}|${report.media.playing}|${report.media.track}|${report.media.position}|${report.media.volume}|${report.media.muted}|${report.media.target}|${report.gameScore}|${report.clipboardLen}|${report.notepadLen}`
      if (sig !== lastSig) {
        lastSig = sig
        pushDesktopState(report)
        // تحديث مرآة وحدة التحكم المدمجة فوراً
        useRcMirror.getState().setReport(report)
      }
    })

    // ==== تقدم الوسائط ====
    const iv = setInterval(() => st().tickMedia(), 1000)

    // ==== قياس زمن الاستجابة ====
    let pingT = 0
    socket.on("rc:pong", (d: { t: number }) => {
      if (d.t === pingT) {
        st().setLatency(Date.now() - d.t)
        useRcMirror.getState().setLatency(Date.now() - d.t)
      }
    })
    const pv = setInterval(() => {
      pingT = Date.now()
      rcPing(pingT)
      // تحديث دوري: الهواتف المتصلة متأخراً تحصل على الحالة فوراً
      pushDesktopState(useDesktop.getState().buildReport())
    }, 4000)

    return () => {
      unsub()
      socket.off()
      clearInterval(iv)
      clearInterval(pv)
    }
  }, [])
}

