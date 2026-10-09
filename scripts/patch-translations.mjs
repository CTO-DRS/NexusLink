#!/usr/bin/env node
// Hand-curated translations for the 51 strings the batch model missed.
import { readFileSync, writeFileSync } from "node:fs"
const PROG = "scripts/ar-en-progress.json"
const OUT = "src/lib/ar-en-map.json"
const map = JSON.parse(readFileSync(PROG, "utf8"))
const fix = {
  "وسائط": "Media",
  "وسائط واتساب": "WhatsApp media",
  "وسائط: ${label[a]}": "Media: ${label[a]}",
  "وصل نص للحافظة المشتركة من الهاتف: «${text.slice(0, 40)}${text.length > 40 ? \"…\" : \"\"}»": "Text arrived on shared clipboard from phone: \"${text.slice(0, 40)}${text.length > 40 ? \"…\" : \"\"}\"",
  "وصل نص من ${item.deviceName}": "Text arrived from ${item.deviceName}",
  "وصل نص من الكمبيوتر": "Text arrived from the computer",
  "وصل نص من حافظة الكمبيوتر": "Text arrived from the computer clipboard",
  "وصلت صورة من ${item.deviceName}": "Image arrived from ${item.deviceName}",
  "وصلك أمر مشفر عبر القناة الآمنة": "Encrypted command received over the secure channel",
  "وضع التخفي": "Stealth mode",
  "وضع الحافظة الموحدة: ${d.clipMode === \"auto\" ? \"تلقائي — النسخ بين الأجهزة بلا ضغطة\" : \"يدوي — من قائمة النسخ\"}": "Universal clipboard mode: ${d.clipMode === \"auto\" ? \"automatic — copying across devices with zero clicks\" : \"manual — from the copy menu\"}",
  "وضع الفقدان": "Lost mode",
  "وضع الفقدان برسالة على شاشة الهاتف": "Lost mode with a message on the phone screen",
  "وضع الفقدان مفعّل": "Lost mode is on",
  "وضع الفقدان مفعّل — الهاتف مقفل الآن": "Lost mode is on — the phone is now locked",
  "وضع المحاكاة نشط": "Simulation mode active",
  "وضع المراقبة فعّال: مصدر ${st.sec.source} → شاشة ${st.sec.viewer === \"tv\" ? \"Nexus-TV\" : \"الكمبيوتر\"} (كشف حركة بدون AI)": "Surveillance active: source ${st.sec.source} → screen ${st.sec.viewer === \"tv\" ? \"Nexus-TV\" : \"the computer\"} (AI-free motion detection)",
  "وضع المراقبة متوقف": "Surveillance stopped",
  "وضع المراقبة: بث + تنبيه عند حركة (بدون AI)": "Surveillance: streaming + motion alert (no AI)",
  "وضع تلقائي — المتصفح منع الكتابة المباشرة، الصقه من منطقة اللصق بالأسفل": "Automatic mode — the browser blocked direct typing; paste into the paste area below",
  "وضعت الهاتف بجوار الكمبيوتر": "You placed the phone next to the computer",
  "وعليكم السلام، نعم جاهز. العرض جاهز عندي": "Wa alaykum assalam — yes, ready. The presentation is ready on my side",
  "وقت النوم": "Bedtime",
  "ويب كام": "Webcam",
  "وُثّق «${current.name}» — أصبح جهازاً موثوقاً في السجل": "\"${current.name}\" verified — it is now a trusted device in the log",
  "يبث": "Broadcasting",
  "يبث إلى ${cast.target === \"tv\" ? \"Nexus-TV\" : \"الكمبيوتر\"}": "Casting to ${cast.target === \"tv\" ? \"Nexus-TV\" : \"the computer\"}",
  "يبث الصوت…": "Streaming audio…",
  "يبث…": "Streaming…",
  "يد ألعاب": "Gamepad",
  "يد الألعاب: زر ${String(data?.button ?? \"\")} → ${String(data?.action ?? \"\")}": "Gamepad: button ${String(data?.button ?? \"\")} → ${String(data?.action ?? \"\")}",
  "يد الألعاب: عصا + جيروسكوب + أزرار مخصصة": "Gamepad: sticks + gyroscope + custom buttons",
  "يدوي": "Manual",
  "يدوية": "Manual",
  "يرن عند الطرف الآخر…": "Ringing on the other side…",
  "يرن…": "Ringing…",
  "يستمع · ${Math.floor(since / 60)}:${String(since % 60).padStart(2, \"0\")}": "Listening · ${Math.floor(since / 60)}:${String(since % 60).padStart(2, \"0\")}",
  "يستمع بمستوى ${baby.gain}%": "Listening at ${baby.gain}% level",
  "يشحن الآن": "Charging now",
  "يعرض": "Displaying",
  "يعمل": "Running",
  "يعمل الآن — يتحكم به الهاتف من تبويب «الوسائط»": "Now running — the phone controls it from the \"Media\" tab",
  "يفحص البايتات…": "Inspecting bytes…",
  "ينقل في الظلام…": "Transferring in the dark…",
  "يُرسل مشفراً…": "Sending encrypted…",
  "— لا مقطع —": "— no clip —",
  "→ تحديث": "→ update",
  "→ جديد": "→ new",
  "≈ ${Math.round(d)} متر": "≈ ${Math.round(d)} m",
  "≈ ${Math.round(m.battery * 0.55)} ساعة شاشة": "≈ ${Math.round(m.battery * 0.55)} h of screen",
  "≈ ${d.toFixed(1)} متر": "≈ ${d.toFixed(1)} m",
}
let n = 0
for (const [k, v] of Object.entries(fix)) {
  if (!(k in map)) n++
  map[k] = v
}
writeFileSync(PROG, JSON.stringify(map))
writeFileSync(OUT, JSON.stringify(map, null, 0))
const all = JSON.parse(readFileSync("scripts/ar-strings.json", "utf8"))
const list = [...new Set([...all.strings, ...all.attrs])].filter((x) => /[\u0600-\u06FF]/.test(x))
const missing = list.filter((x) => !map[x])
console.log("patched", n, "| total keys:", Object.keys(map).length, "| still missing:", missing.length)
if (missing.length) console.log(missing)
