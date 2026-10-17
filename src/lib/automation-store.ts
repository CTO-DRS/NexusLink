"use client"
// NexusLink — مخزن واجهة محرك الروتينات (عقد §26)
import { create } from "zustand"
import type { AutoRule, AutoRunEntry, AutoStatePayload } from "./nexus/automation-types"

interface AutoStore {
  online: boolean
  rules: AutoRule[]
  log: AutoRunEntry[]
  stats: AutoStatePayload["stats"] | null
  bootedAt: number | null
  setOnline: (v: boolean) => void
  applyState: (s: AutoStatePayload) => void
}

export const useAutomation = create<AutoStore>((set) => ({
  online: false,
  rules: [],
  log: [],
  stats: null,
  bootedAt: null,
  setOnline: (v) => set({ online: v }),
  applyState: (s) => set({ rules: s.rules, log: s.log, stats: s.stats, bootedAt: s.bootedAt }),
}))
