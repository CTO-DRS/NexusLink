// تنظيف نهائي لحالة الجسر الحية: بذرة واحدة لكل اسم + حذف قاعدة الاختبار الحية
import { io } from "socket.io-client"

const sock = io("http://127.0.0.1:3008", { path: "/", transports: ["websocket", "polling"], forceNew: true, reconnection: false, timeout: 8000 })

const latest = { state: null }
sock.on("auto:state", (s) => { latest.state = s })
sock.on("connect_error", (e) => console.log("CONN_ERR:", e?.message))

const done = (code) => { try { sock.disconnect() } catch {}; process.exit(code) }
setTimeout(() => { console.log("TIMEOUT — last state:", latest.state ? "ok" : "none"); done(1) }, 12000)

sock.on("connect", () => {
  const step = (fn, ms) => setTimeout(fn, ms)
  step(() => {
    // 1) احذف كل نسخ البذرة المكررة + قاعدة galaxy
    const kill = (pred) => (latest.state?.rules ?? []).filter(pred).forEach((r) => sock.emit("rule:delete", { id: r.id }))
    kill((r) => r.name === "بطارية جهاز منخفضة" || r.name.includes("galaxy"))
  }, 400)
  step(() => {
    // 2) أعِد البذرة نسخة واحدة
    sock.emit("rule:upsert", {
      rule: {
        name: "بطارية جهاز منخفضة", enabled: true,
        trigger: { kind: "battery.below", threshold: 20, deviceId: null },
        action: { kind: "notify", text: "بطارية أحد الأجهزة هبطت تحت 20%" },
      },
    })
  }, 900)
  step(() => {
    const names = (latest.state?.rules ?? []).map((r) => r.name)
    console.log("final rules:", JSON.stringify(names))
    const ok = names.length === 4 && names.filter((n) => n === "بطارية جهاز منخفضة").length === 1 && !names.some((n) => n.includes("galaxy"))
    console.log(ok ? "STATE CLEAN ✓" : "STATE UNEXPECTED ✗")
    done(ok ? 0 : 1)
  }, 1600)
})
