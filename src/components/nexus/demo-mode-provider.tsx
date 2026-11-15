"use client"
// NexusLink — مزوّد علم العرض التوضيحي (G2/P0)
// يضبط العلم ويزرع بذور الحماية الوهمية (مقاييس/تطبيقات/منبهات) حصرًا عند
// NEXUSLINK_DEMO=1 — قبل عرض أي مكون ابن، فلا وميض لأرقام وهمية.
import { useState, type ReactNode } from "react"
import { DemoModeContext, setClientDemo } from "@/lib/demo-client"
import { useGuard } from "@/lib/guard-store"

export function DemoModeProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  useState(() => {
    setClientDemo(demo)
    if (demo) useGuard.getState().loadDemoSeeds()
    return null
  })
  return <DemoModeContext.Provider value={demo}>{children}</DemoModeContext.Provider>
}
