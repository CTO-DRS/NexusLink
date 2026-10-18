#!/usr/bin/env node
// إضافة مفاتيح EN للتنبيهات المرسوخة (§26.ح) — دمج آمن يفحص التعارض
import fs from "node:fs"

const P = "src/lib/ar-en-map.json"
const map = JSON.parse(fs.readFileSync(P, "utf8"))

const ADD = {
  "تنبيهات روتين لم تُرَ": "Unseen routine alerts",
  "أُطلقت أثناء غيابك — آخرها": "fired while you were away — latest",
  "تعليم الكل كمقروء": "Mark all as read",
  "السجل الدائم للإطلاقات": "Durable fire log",
  "مرسوخ في قاعدة البيانات — آخر 200 يبقى بعد إعادة التشغيل": "Persisted in the database — last 200 survive a server restart",
  "لم يُرَ": "Unseen",
  "المحرك رفض الطلب": "The engine rejected the request",
  "الإطلاقات نفسها مرسوخة (آخر 200) والتنبيهات غير المرئية تظهر في ملخص العودة — الإطلاق بلا واجهة مفتوحة لا يضيع، وإيقاف عملية الخادم يوقف الالتقاط": "Fires themselves are persisted (last 200) and unseen alerts appear in the return digest — a fire with no open UI is never lost, but stopping the server process stops collection",
}

let added = 0, conflicts = 0
for (const [k, v] of Object.entries(ADD)) {
  if (map[k] !== undefined) {
    if (map[k] !== v) { console.log(`⚠️ تعارض: "${k}" موجود بـ "${map[k]}" — طلب "${v}"`); conflicts++ }
    continue
  }
  map[k] = v
  added++
}

fs.writeFileSync(P, JSON.stringify(map, Object.keys(map).sort(), 2).replace(/\n/g, "\n") + "\n")
console.log(`✅ أُضيف ${added} مفتاحًا · تعارضات: ${conflicts}`)
