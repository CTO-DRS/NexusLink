#!/usr/bin/env node
// إضافة مفاتيح EN لمشغلات الصحة التاريخية (§26.و) — دمج آمن يفحص التعارض
import fs from "node:fs"

const P = "src/lib/ar-en-map.json"
const map = JSON.parse(fs.readFileSync(P, "utf8"))

const ADD = {
  "بقاء البطارية تحت عتبة لمدة (تاريخي)": "Battery stays below threshold for a duration (history)",
  "بقاء الاستجابة فوق عتبة لمدة (تاريخي)": "Latency stays above threshold for a duration (history)",
  "صمت جهاز عن التقارير لمدة (تاريخي)": "Device stops reporting for a duration (history)",
  "المدة (دقائق)": "Duration (minutes)",
  "1..1440 — يُقرأ من تاريخ مركز الصحة": "1..1440 — read from Health Center history",
  "تاريخي": "Historical",
  "دقيقة": "min",
  "بلا تقارير": "no reports",
  "العتبة ms": "Threshold ms",
  "مشغلات الصحة التاريخية تقرأ عينات مركز الصحة (احتفاظ 24 ساعة) — تحتاج دليل عينات يُغطي المدة بلا فجوات كبيرة": "Historical health triggers read Health Center samples (24h retention) — they need sample evidence covering the duration without large gaps",
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

fs.writeFileSync(P, JSON.stringify(map, null, 2) + "\n")
console.log(`✓ أُضيف ${added} مفتاحًا — تعارضات: ${conflicts} — الإجمالي: ${Object.keys(map).length}`)
