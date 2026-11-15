"use client"
// NexusLink — G2/P0: علم العرض التوضيحي على جهة العميل
// ------------------------------------------------------------
// المصدر الوحيد للحقيقة هو isDemoMode() على الخادم (NEXUSLINK_DEMO=1).
// التخطيط الجذري (خادمي) يقرؤه وقت الطلب ويمرره خاصيةً إلى DemoModeProvider —
// فلا متغير NEXT_PUBLIC_ مدمج وقت البناء، ولا سر يعبر للمتصفح: قيمة منطقية فقط.
// · useDemoMode(): للمكونات (سياق React — صحيح منذ أول عرض وفي SSR).
// · isClientDemo(): لوحدات غير React (محرك الوسائط) — يضبطه المزوّد قبل عرض الأبناء.
import { createContext, useContext } from "react"

let clientDemo = false

export function setClientDemo(v: boolean): void {
  clientDemo = v
}

export function isClientDemo(): boolean {
  return clientDemo
}

export const DemoModeContext = createContext<boolean>(false)

export function useDemoMode(): boolean {
  return useContext(DemoModeContext)
}
