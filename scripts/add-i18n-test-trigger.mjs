#!/usr/bin/env node
// إضافة مفاتيح EN لفحص التاريخ الحي من المحرر + قائمة الأجهزة (§26.ي) — دمج آمن يفحص التعارض
import fs from "node:fs"

const P = "src/lib/ar-en-map.json"
const map = JSON.parse(fs.readFileSync(P, "utf8"))

const ADD = {
  "فحص التاريخ الآن": "Test history now",
  "جارٍ فحص التاريخ…": "Testing history…",
  "التاريخ يستوفي الشرط الآن": "History satisfies the condition now",
  "التاريخ لا يستوفي الشرط بعد": "History does not satisfy the condition yet",
  "الفحص قراءة محضة من التاريخ الحالي — بلا أي أثر": "The test is read-only from current history — leaves no trace",
  "نتيجة لضبط سابق — أعد الفحص": "Result from a previous setting — re-run the test",
  "معرّف يدوي…": "Manual ID…",
  "معرّف الجهاز — إدخال يدوي": "Device ID — manual entry",
  "اختيار من القائمة": "Pick from list",
  "عينات دليل": "Evidence samples",
  "تغطية": "Coverage",
  "عمر المرساة": "Anchor age",
  "آخر عينة": "Last sample",
  "فحص التاريخ متاح للمشغلات التاريخية المستمرة فقط": "History test is available for sustained historical triggers only",
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
console.log(`✅ أُضيف ${added} مفتاحًا · تعارضات: ${conflicts} · الإجمالي: ${Object.keys(map).length}`)
