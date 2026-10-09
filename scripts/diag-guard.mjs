// تشخيص جسر الحماية: يتصل، يستمع لكل الأحداث، يبث طلب مزامنة
import { io } from "socket.io-client"

const s = io("http://localhost:3006", { path: "/", transports: ["websocket"] })
const seen = []
s.onAny((ev, d) => { seen.push(ev); if (ev === "prox:state" && seen.filter(x=>x==="prox:state").length > 3) return; console.log("<<", ev, JSON.stringify(d)?.slice(0, 180)) })
s.on("connect", () => {
  console.log("connected, emitting dev:sync-request")
  s.emit("dev:sync-request")
  setTimeout(() => {
    console.log("--- events seen:", [...new Set(seen)].join(", "))
    process.exit(0)
  }, 3500)
})
setTimeout(() => { console.log("TIMEOUT"); process.exit(1) }, 8000)
