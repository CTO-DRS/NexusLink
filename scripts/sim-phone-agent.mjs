// محاكاة وكيل هاتف موثوق — يبلّغ حالة الإتاحة لاختبار Unblock Center في واجهة الويب (عقد §24/§25)
// الاستخدام: node scripts/sim-phone-agent.mjs false|true [seconds]
import { io } from "socket.io-client"

const accessibility = process.argv[2] === "true"
const seconds = Number(process.argv[3] || 60)
const DEVICE_ID = "galaxy-s24"
const DEVICE_NAME = "Galaxy S24 (sim)"

const sock = io("http://127.0.0.1:81", {
  query: { XTransformPort: "3006" },
  transports: ["polling", "websocket"],
  reconnection: true,
})

sock.on("connect", () => {
  console.log(`[sim] connected ${sock.id}`)
  sock.emit("guard:hello-phone", { name: DEVICE_NAME, deviceId: DEVICE_ID })
  const report = () => {
    sock.emit("dev:state", { accessibility, ctl: { active: false } })
    console.log(`[sim] dev:state accessibility=${accessibility} sent`)
  }
  setTimeout(report, 600)
  setInterval(report, 5000) // وكيل حقيقي يبث دوريًا — يقود المتصلين الجدد لاحقًا
})

sock.on("guard:agents", (d) => console.log("[sim] guard:agents", JSON.stringify(d)))
sock.on("dev:ctl-start", (d) => console.log("[sim] dev:ctl-start", JSON.stringify(d)))
sock.on("disconnect", () => console.log("[sim] disconnected"))

setTimeout(() => process.exit(0), seconds * 1000)
