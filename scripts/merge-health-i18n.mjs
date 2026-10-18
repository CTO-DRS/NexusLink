#!/usr/bin/env node
// دمج مفاتيح الترجمة EN لمركز صحة الأجهزة (عقد §26) في ar-en-map.json
// — إضافة حصرًا، لا تمس المفاتيح القائمة (ساعة/تحديث/الجهاز موجودة مسبقًا)
import { readFileSync, writeFileSync } from "node:fs"

const P = "/home/z/my-project/src/lib/ar-en-map.json"
const m = JSON.parse(readFileSync(P, "utf8"))

const ADD = {
  "التُقطت": "Captured",
  "عينة": "samples",
  "فشل التقاط العينة": "Failed to capture sample",
  "مركز صحة الأجهزة": "Device Health Center",
  "قياس زمني للبطارية والاستجابة والإتاحة — عينة كل 30 ثانية، احتفاظ 24 ساعة":
    "Time-series for battery, latency and availability — a sample every 30s, 24h retention",
  "6 ساعات": "6 hours",
  "24 ساعة": "24 hours",
  "التقاط عينة الآن": "Capture sample now",
  "متوسط الاستجابة": "Avg response",
  "أدنى بطارية": "Lowest battery",
  "تنبيهات النافذة": "Window alerts",
  "البطارية %": "Battery %",
  "الاستجابة ms": "Latency ms",
  "لا عينات بعد — تُسجَّل تلقائيًا من نبض الأجهزة، أو التقط عينة الآن":
    "No samples yet — recorded automatically from device heartbeats, or capture one now",
  "الإتاحة": "Availability",
  "عينات": "Samples",
  "لا تنبيهات خلال النافذة المحددة": "No alerts in the selected window",
  "انقطع الاتصال": "Went offline",
  "عاد للاتصال": "Back online",
  "بطارية منخفضة": "Low battery",
  "استجابة متدهورة": "Latency degraded",
  "التخزين شبه ممتلئ": "Storage nearly full",
}

let added = 0
for (const [k, v] of Object.entries(ADD)) {
  if (m[k] === undefined) {
    m[k] = v
    added++
  } else if (m[k] !== v) {
    console.log(`conflict (kept existing): ${k} → ${m[k]}`)
  }
}
writeFileSync(P, JSON.stringify(m, null, 2) + "\n")
console.log(`added ${added} keys — total ${Object.keys(m).length}`)
// فحص سلامة JSON
JSON.parse(readFileSync(P, "utf8"))
console.log("JSON valid ✓")
