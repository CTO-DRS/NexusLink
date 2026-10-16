"use client"
// NexusLink — خطاف جهة الكمبيوتر لطبقة الوسائط:
// إقلاع الجسر، استقبال بث هاتف حقيقي عبر WebRTC (كاميرا/ميك)، مصراع،
// تنبيهات حركة/بكاء من الهواتف الحقيقية، وأوامر بث/شرائح عن بُعد.
import { useEffect, useRef } from "react"
import { useMedia } from "@/lib/media-store"
import {
  getMediaSocket, mediaRole, mediaPing,
} from "@/lib/media-socket"

/** قلب إشارات WebRTC من هاتف حقيقي إلى بث محلي يستقبلها الكمبيوتر */
class PhoneRtcReceiver {
  private pcs = new Map<string, RTCPeerConnection>()

  async handleOffer(
    kind: "cam" | "mic" | "baby",
    sdp: RTCSessionDescriptionInit,
    onStream: (stream: MediaStream) => void
  ) {
    const old = this.pcs.get(kind)
    if (old) {
      old.close()
      this.pcs.delete(kind)
    }
    const pc = new RTCPeerConnection()
    this.pcs.set(kind, pc)
    pc.ontrack = (e) => {
      onStream(e.streams[0] ?? new MediaStream([e.track]))
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void import("@/lib/media-socket").then((m) =>
          m.rtcSignal("rtc:ice", kind, { candidate: e.candidate!.toJSON() })
        )
      }
    }
    await pc.setRemoteDescription(sdp)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    const m = await import("@/lib/media-socket")
    m.rtcSignal("rtc:answer", kind, { sdp: pc.localDescription })
  }

  handleIce(kind: "cam" | "mic" | "baby", candidate: RTCIceCandidateInit) {
    const pc = this.pcs.get(kind)
    if (pc) void pc.addIceCandidate(candidate).catch(() => { /* ignore */ })
  }
}

export function useMediaBridge() {
  const receiverRef = useRef<PhoneRtcReceiver | null>(null)
  if (receiverRef.current == null) receiverRef.current = new PhoneRtcReceiver()

  useEffect(() => {
    fetch("/api/media/boot").catch(() => { /* ignore */ })
    const socket = getMediaSocket()
    const st = () => useMedia.getState()
    const recv = receiverRef.current!

    socket.on("connect", () => {
      st().setBridge(true)
      mediaRole("pc", "PC-OFFICE")
      st().log("جسر الوسائط متصل — بانتظار كاميرات وميكروفونات الأجهزة", "ok")
    })
    socket.on("disconnect", () => st().setBridge(false))

    socket.on("media:phone-online", (d: { name: string }) => {
      st().setPhoneOnline(d.name)
      st().log(`${d.name} انضم بقنوات الوسائط — يمكنه البث والتحكم`, "ok")
    })

    // ==== بث هاتف حقيقي (كاميرا / ميكروفون / غرفة طفل) ====
    // الجولة 5 (§24): kind=mirror هو بث شاشة هاتف لهاتف آخر (هاتف→هاتف) —
    // الكمبيوتر ليس عارضه إطلاقًا فيتجاهله (الهاتف أ هو المجيب الوحيد).
    socket.on("rtc:offer", (d: { kind: "cam" | "mic" | "baby" | "mirror"; sdp?: RTCSessionDescriptionInit }) => {
      if (!d?.sdp) return
      if (d.kind === "mirror") return
      const onStream = (stream: MediaStream) => {
        if (d.kind === "cam") st().setRemoteWebcam(stream)
        // FA-8: ميك/الطفل الحقيقيان يتوفران في المتجر لعنصري الصوت
        if (d.kind === "mic") st().setRemoteMicStream(stream)
        if (d.kind === "baby") st().setRemoteBabyStream(stream)
        window.dispatchEvent(new CustomEvent("nexus-remote-media", { detail: { kind: d.kind, stream } }))
      }
      void recv.handleOffer(d.kind, d.sdp, onStream)
    })
    socket.on("rtc:ice", (d: { kind: "cam" | "mic" | "baby" | "mirror"; candidate?: RTCIceCandidateInit }) => {
      if (d?.kind === "mirror") return
      if (d?.candidate) recv.handleIce(d.kind, d.candidate)
    })

    // ==== مصراع عن بُعد من الكمبيوتر/هاتف آخر ====
    socket.on("cam:shutter", (d: { timer: number }) => {
      void st().triggerShutter(d?.timer ?? 0)
    })
    socket.on("cam:captured", (d: { name?: string }) => {
      st().pushAlert("capture", `صورة جديدة التقطها الهاتف: ${d?.name ?? "IMG"}`)
      if (st().gallery.loadedOnce) void st().loadGallery()
    })

    // ==== تنبيهات من هاتف حقيقي ====
    socket.on("sec:motion", (d: { source?: string; level?: number }) => {
      st().pushAlert("motion", `حركة من مصدر خارجي (${d?.source ?? "هاتف"}): ${Math.round(d?.level ?? 0)}%`, { level: d?.level })
      st().pass("security")
    })
    socket.on("baby:alert", (d: { from?: string; level?: number }) => {
      st().pushAlert("cry", `تنبيه بكاء من ${d?.from ?? "غرفة الطفل"}: ${Math.round(d?.level ?? 0)}%`, { level: d?.level })
      st().pass("baby")
    })

    // ==== FA-8: حالة كاميرا الهاتف الحقيقي + مستشعراته ====
    socket.on("cam:state", (d: { deviceId?: string; active?: boolean; facing?: string; torch?: boolean; watch?: boolean }) => {
      st().setRealCam({
        active: d?.active === true,
        facing: d?.facing ?? "back",
        torch: d?.torch === true,
        watch: d?.watch === true,
        at: Date.now(),
      })
      st().log(
        d?.active
          ? `بث كاميرا الهاتف الحقيقي يعمل (${d?.facing === "front" ? "أمامية" : "خلفية"}${d?.torch ? " + فلاش" : ""}${d?.watch ? " — مراقبة" : ""})`
          : "بث كاميرا الهاتف الحقيقي توقف",
        d?.active ? "ok" : "info",
      )
    })
    socket.on("sensor:stream", (d: { a?: number[]; g?: number[]; from?: string }) => {
      st().setSensors({ a: d?.a ?? [], g: d?.g ?? [], at: Date.now() })
    })

    // ==== تحكم هاتف حقيقي بالبث والشرائح ====
    socket.on("cast:cmd", (d: { action: string; value?: number }) => {
      const a = d?.action
      if (a === "toggle") st().castToggle()
      else if (a === "play" && st().cast && !st().cast.playing) st().castToggle()
      else if (a === "pause" && st().cast && st().cast.playing) st().castToggle()
      else if (a === "volume") st().castVolume(d.value ?? 80)
      else if (a === "mute") st().castMute()
      else if (a === "stop") st().stopCast()
    })
    socket.on("slideshow:cmd", (d: { action: string; value?: number }) => {
      const a = d?.action
      if (a === "next") st().slideshowNext(1)
      else if (a === "prev") st().slideshowNext(-1)
      else if (a === "toggle") st().slideshowToggle()
      else if (a === "stop") st().stopSlideshow()
      else if (a === "interval" && d.value) st().setSlideshowInterval(d.value)
    })

    // ==== زمن الاستجابة ====
    let pingT = 0
    socket.on("media:pong", (d: { t: number }) => {
      if (d.t === pingT) st().setLatency(Date.now() - d.t)
    })
    const pv = window.setInterval(() => {
      pingT = Date.now()
      mediaPing(pingT)
    }, 5000)

    return () => {
      socket.off()
      window.clearInterval(pv)
    }
  }, [])
}
