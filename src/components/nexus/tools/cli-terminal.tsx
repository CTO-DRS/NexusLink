"use client"

/**
 * NexusLink CLI — طرفية حقيقية للمستخدمين المتقدمين (المرحلة 11-8)
 * تنفّذ أوامر فعلية ضد واجهات النواة: devices / fs / transfer / tools
 * مثال: nexus send file.txt --to phone
 */
import { useEffect, useRef, useState } from "react"
import { useNexus } from "@/lib/store"
import { useI18n } from "@/lib/i18n"

type Kind = "cmd" | "ok" | "err" | "info" | "dim" | "warn"
interface Line {
  id: number
  text: string
  kind: Kind
}

const DEVICE_ALIASES: Record<string, string> = {
  phone: "galaxy-s24",
  pc: "pc-office",
  desktop: "pc-office",
  tablet: "ipad-pro",
  tv: "nexus-tv",
}

let seq = 0
const mk = (text: string, kind: Kind = "info"): Line => ({ id: ++seq, text, kind })

export function CliTerminal() {
  const { t } = useI18n()
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState("")
  const [histIdx, setHistIdx] = useState(-1)
  const historyRef = useRef<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const setView = useNexus((s) => s.setView)

  const push = (...ls: Line[]) => setLines((prev) => [...prev.slice(-300), ...ls])

  useEffect(() => {
    setLines([
      mk("NexusLink CLI 2.4.1 — nexus shell", "cmd"),
      mk(t("اكتب help لعرض الأوامر المتاحة"), "dim"),
    ])
     
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines])

  const run = async (raw: string) => {
    const cmd = raw.trim()
    push(mk(`nexus> ${cmd}`, "cmd"))
    if (!cmd) return
    historyRef.current.push(cmd)
    setHistIdx(-1)
    const [name, ...rest] = cmd.split(/\s+/)
    const args = rest.join(" ")

    try {
      switch (name) {
        case "help": {
          push(
            mk("devices                          " + t("قائمة الأجهزة وحالتها"), "dim"),
            mk("ls [path] [--device <id>]        " + t("سرد محتويات مسار"), "dim"),
            mk("send <name> --to <device>        " + t("إرسال ملف إلى جهاز (phone/pc/tablet/tv)"), "dim"),
            mk("status                           " + t("حالة سريعة للنظام"), "dim"),
            mk("speedtest [--quick]              " + t("اختبار سرعة الشبكة المحلية"), "dim"),
            mk("diag                             " + t("تشخيص النواة والخدمات"), "dim"),
            mk("theme [dark|light]               " + t("ضبط المظهر"), "dim"),
            mk("lang [ar|en]                     " + t("ضبط اللغة"), "dim"),
            mk("pair --qr                        " + t("فتح شاشة الاقتران"), "dim"),
            mk("version | whoami | clear", "dim"),
          )
          break
        }
        case "devices": {
          const r = await fetch("/api/devices")
          const j = await r.json()
          for (const d of j.devices ?? []) {
            const state = d.state === "connected" ? "●" : d.state === "offline" ? "○" : "◐"
            push(
              mk(
                `${state} ${String(d.name).padEnd(14)} ${String(d.kind).padEnd(8)} ${String(d.state).padEnd(10)} ${d.ip ?? "—"}  ${d.battery != null ? d.battery + "%" : "—"}  ${d.rttMs ?? "—"}ms`,
                d.state === "connected" ? "ok" : "dim",
              ),
            )
          }
          break
        }
        case "ls": {
          const dm = args.match(/--device\s+(\S+)/)
          const deviceId = dm ? DEVICE_ALIASES[dm[1]] ?? dm[1] : "galaxy-s24"
          const p = args.replace(/--device\s+\S+/, "").trim() || "/"
          const r = await fetch(`/api/fs?device=${deviceId}&path=${encodeURIComponent(p)}`)
          const j = await r.json()
          if (j.error) {
            push(mk(j.error, "err"))
            break
          }
          for (const e of j.entries ?? []) {
            push(mk(`${e.type === "dir" ? "d" : "-"} ${String(e.size ?? "").padStart(10)}  ${e.name}`, e.type === "dir" ? "info" : "dim"))
          }
          if (!j.entries?.length) push(mk(t("المجلد فارغ"), "dim"))
          break
        }
        case "send": {
          const to = args.match(/--to\s+(\S+)/)
          const from = args.match(/--from\s+(\S+)/)
          const fileName = args.replace(/--to\s+\S+/, "").replace(/--from\s+\S+/, "").trim().replace(/^["']|["']$/g, "")
          if (!to || !fileName) {
            push(mk(t("الاستخدام: send <اسم الملف> --to <device>"), "warn"))
            break
          }
          const targetId = DEVICE_ALIASES[to[1]] ?? to[1]
          const srcDeviceId = from ? DEVICE_ALIASES[from[1]] ?? from[1] : "galaxy-s24"
          const devR = await fetch("/api/devices")
          const devJ = await devR.json()
          const target = (devJ.devices ?? []).find((d: { id: string }) => d.id === targetId)
          if (!target) {
            push(mk(t("الجهاز الهدف غير موجود"), "err"))
            break
          }
          const q = fileName.split("/").pop() as string
          const sr = await fetch(`/api/fs?device=${srcDeviceId}&q=${encodeURIComponent(q)}`)
          const sj = await sr.json()
          const hits = (sj.entries ?? []) as Array<{ name: string; path: string; type: string }>
          const hit = hits.find((e) => e.name === q && e.type === "file")
            ?? hits.find((e) => e.name.toLowerCase() === q.toLowerCase())
          if (!hit) {
            push(mk(`${t("الملف غير موجود")}: ${q}`, "err"))
            break
          }
          const tr = await fetch("/api/devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send-file",
              deviceId: targetId,
              deviceName: target.name,
              direction: "out",
              srcDeviceId,
              srcPath: hit.path,
              fileName: hit.name,
            }),
          })
          const tj = await tr.json()
          if (tj.ok) {
            push(mk(`${t("بدأ النقل")}: ${hit.name} → ${target.name}  (${t("المهمة")} ${tj.job.id})`, "ok"))
            push(mk(t("تابع التقدم من شاشة النقل"), "dim"))
          } else {
            push(mk(tj.error || t("فشل بدء النقل"), "err"))
          }
          break
        }
        case "status": {
          const [dr, vr] = await Promise.all([fetch("/api/devices"), fetch("/api/version")])
          const [dj, vj] = await Promise.all([dr.json(), vr.json()])
          const conn = (dj.devices ?? []).filter((d: { state: string }) => d.state === "connected").length
          push(mk(`${t("الإصدار")}: ${vj.current} (${vj.channel})`, "info"))
          push(mk(`${t("متصل")}: ${conn}/${(dj.devices ?? []).length}`, "ok"))
          push(mk(`${t("البروتوكول")}: Nexus/1.2 · E2E X25519+AES-GCM`, "info"))
          break
        }
        case "speedtest": {
          const quick = args.includes("--quick")
          const bytes = quick ? 2 * 1024 * 1024 : 8 * 1024 * 1024
          push(mk(t("يقيس التنزيل…"), "dim"))
          let t0 = performance.now()
          const dr = await fetch(`/api/tools/speedtest?bytes=${bytes}`, { cache: "no-store" })
          await dr.arrayBuffer()
          const downSecs = (performance.now() - t0) / 1000
          const downMBs = bytes / 1048576 / downSecs
          push(mk(`↓ ${downMBs.toFixed(1)} MB/s`, "ok"))
          push(mk(t("يقيس الرفع…"), "dim"))
          const upBytes = quick ? 1024 * 1024 : 4 * 1024 * 1024
          const buf = new Uint8Array(Math.min(upBytes, 1024 * 1024))
          crypto.getRandomValues(buf)
          t0 = performance.now()
          await fetch("/api/tools/speedtest", { method: "POST", body: buf, cache: "no-store" })
          const upSecs = (performance.now() - t0) / 1000
          const upMBs = upBytes / 1048576 / upSecs
          push(mk(`↑ ${upMBs.toFixed(1)} MB/s`, "ok"))
          break
        }
        case "diag": {
          const r = await fetch("/api/tools/diag", { cache: "no-store" })
          const j = await r.json()
          push(mk(`${t("المنصة")}: ${j.platform} · ${j.runtime}`, "info"))
          push(mk(`RSS: ${j.memory.rssMB}MB · ${t("مدة التشغيل")}: ${j.uptimeSec}s`, "info"))
          push(mk(`comms:${j.services.commsBridge}  remote:${j.services.remoteBridge}`, j.services.commsBridge === "up" ? "ok" : "err"))
          break
        }
        case "theme": {
          const cur = document.documentElement.classList.contains("dark") ? "dark" : "light"
          const next = args === "dark" || args === "light" ? args : cur === "dark" ? "light" : "dark"
          document.documentElement.classList.toggle("dark", next === "dark")
          useNexus.setState({ theme: next as "dark" | "light" })
          try { localStorage.setItem("nexus-theme", next) } catch { /* ignore */ }
          push(mk(`theme = ${next}`, "ok"))
          break
        }
        case "lang": {
          const next = args === "en" || args === "ar" ? args : undefined
          if (next) {
            const { useI18n: st } = await import("@/lib/i18n")
            st.getState().setLang(next)
            push(mk(`lang = ${next}`, "ok"))
          } else {
            push(mk(`${t("اللغة الحالية")}: ${document.documentElement.lang}`, "info"))
          }
          break
        }
        case "pair": {
          setView("devices")
          push(mk(t("فتحت شاشة الأجهزة — امسح رمز QR للاقتران"), "ok"))
          break
        }
        case "version": {
          const r = await fetch("/api/version")
          const j = await r.json()
          push(mk(`NexusLink ${j.current} (${j.channel}) — ${t("آخر تحديث")} ${j.updatedAt}`, "info"))
          break
        }
        case "whoami": {
          push(mk("PC-OFFICE · nexus-desktop · 192.168.1.10", "info"))
          break
        }
        case "clear": {
          setLines([])
          break
        }
        default:
          push(mk(`${name}: ${t("أمر غير معروف")} — ${t("اكتب help")}`, "err"))
      }
    } catch (e) {
      push(mk(t("خطأ في التنفيذ") + ": " + (e instanceof Error ? e.message : String(e)), "err"))
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const v = input
      setInput("")
      void run(v)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const h = historyRef.current
      if (!h.length) return
      const i = histIdx < 0 ? h.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(i)
      setInput(h[i])
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const h = historyRef.current
      if (histIdx < 0) return
      const i = histIdx + 1
      if (i >= h.length) {
        setHistIdx(-1)
        setInput("")
      } else {
        setHistIdx(i)
        setInput(h[i])
      }
    } else if (e.key === "Tab") {
      e.preventDefault()
      const cmds = ["help", "devices", "ls", "send", "status", "speedtest", "diag", "theme", "lang", "pair", "version", "whoami", "clear"]
      const hit = cmds.find((c) => c.startsWith(input) && input)
      if (hit) setInput(hit + " ")
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden border shadow-inner" data-no-i18n>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/60 border-b">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        <span className="ms-2 text-[11px] font-mono text-muted-foreground">nexus — shell</span>
      </div>
      <div
        ref={scrollRef}
        className="nexus-term nexus-term-scroll h-[380px] overflow-y-auto px-4 py-3 cursor-text"
        onClick={() => inputRef.current?.focus()}
        role="log"
        aria-label={t("طرفية الأوامر")}
      >
        {lines.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-all t-${l.kind}`}>
            {l.text}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-1">
          <span className="t-cmd font-bold shrink-0">nexus&gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            className="flex-1 bg-transparent outline-none font-mono text-[12.5px] caret-emerald-400"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label={t("أدخل أمراً")}
          />
        </div>
      </div>
    </div>
  )
}
