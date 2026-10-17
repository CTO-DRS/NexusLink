// مسبار تشخيصي: هل يستجيب جسر الأمان 3009 لsec:announce لجهاز موثوق؟
import { io } from "socket.io-client"

const REST = "http://127.0.0.1:3000"
const DIRECT = "http://127.0.0.1:3009"

// 1) جهّز جهازًا موثوقًا عبر pair (بسر QR — البروتوكول الجديد)
const qr = await fetch(`${REST}/api/devices/qr`).then((r) => r.json()).catch((e) => null)
console.log("qr fetch:", qr ? `code=${qr.code}` : "FAILED")
const DEV_ID = `probe-sec-${Date.now().toString(36)}`
const pr = await fetch(`${REST}/api/devices`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "pair", id: DEV_ID, name: "Probe-Sec", kind: "phone", secret: qr?.payload?.secret }),
})
console.log("pair status:", pr.status, "trusted:", (await pr.json())?.device?.trusted)

// 2) اتصل على 3009 مباشرة وأعلن
const s = io(DIRECT, { path: "/", transports: ["websocket"], reconnection: false, timeout: 5000 })
const events = []
s.on("connect", () => { console.log("socket connected:", s.id); s.emit("sec:announce", { role: "phone", deviceId: DEV_ID, name: "Probe-Sec", pub: "cHJvYmU=", eph: "cHJvYmU=" }) })
s.on("sec:hello", (d) => events.push(["sec:hello", `suite=${d?.suite?.slice(0, 30)} peers=${d?.peers?.length}`]))
s.on("sec:pending-trust", (d) => events.push(["sec:pending-trust", JSON.stringify(d).slice(0, 60)]))
s.on("kex:peer", (d) => events.push(["kex:peer", d?.deviceId]))
s.on("sec:peers", (d) => events.push(["sec:peers", JSON.stringify(d).slice(0, 80)]))
s.on("connect_error", (e) => events.push(["connect_error", String(e).slice(0, 80)]))
s.on("disconnect", (r) => events.push(["disconnect", r]))

await new Promise((r) => setTimeout(r, 3500))
console.log("events:", JSON.stringify(events, null, 1))
s.close()
process.exit(0)
