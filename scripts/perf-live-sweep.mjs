// PERF §29 — مسحة حية على المكدس الحقيقي: rc:ack عبر الجسر المدمج + p95
// (بعد إعادة الإقلاع — تثبيت أن الإقرارات تعمل على الخدمة الجارية لا في الاختبار حصرًا)
import { io } from "socket.io-client"

const GW = "http://127.0.0.1:8180"
const mk = () => io(GW, { query: { XTransformPort: "3004" }, transports: ["websocket"], reconnection: false, timeout: 10000 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const desk = mk()
const ctl = mk()
await Promise.all([desk, ctl].map((s) => new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error("timeout")), 10000) })))
desk.emit("desktop:register", { name: "NEXUS-PC", mac: "A4:5E:60:C1:2D:9F" })
await sleep(400)

const rtts = []
ctl.on("rc:ack", (d) => {
  const x = rtts.find((y) => y.mid === d?.mid && y.rtt === null)
  if (x) x.rtt = Date.now() - x.t0
})
desk.on("rc:click", (d) => {
  if (d?.__m?.mid) desk.emit("rc:ack", { mid: d.__m.mid, mt: d.__m.mt, ev: "rc:click", at: Date.now() })
})
for (let i = 0; i < 20; i++) {
  const mid = `sweep-${i}-${Date.now().toString(36)}`
  rtts.push({ mid, t0: Date.now(), rtt: null })
  ctl.emit("rc:click", { button: "left", __m: { mid, mt: Date.now() } })
  await sleep(15)
}
await sleep(800)
const ok = rtts.filter((x) => x.rtt != null).map((x) => x.rtt)
const sorted = [...ok].sort((a, b) => a - b)
const p95 = sorted.length ? sorted[Math.max(1, Math.ceil(0.95 * sorted.length)) - 1] : null
console.log(`LIVE-SWEEP: acked=${ok.length}/20 p95=${p95}ms max=${ok.length ? Math.max(...ok) : "—"}ms`)
desk.disconnect(); ctl.disconnect()
process.exit(ok.length === 20 && p95 < 80 ? 0 : 1)
