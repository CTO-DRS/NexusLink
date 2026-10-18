"use client"
// NexusLink — عميل socket.io لمحرك الروتينات (عقد §26 — XTransformPort=3008)
import { io, type Socket } from "socket.io-client"
import type { AutoRule } from "./nexus/automation-types"

let socket: Socket | null = null

export function getAutomationSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3008", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    // تسهيل التشخيص والاختبار من الكونسول
    ;(window as unknown as { __nexusAutoSocket?: Socket }).__nexusAutoSocket = socket
  }
  return socket
}

/** طلب لقطة الحالة الكاملة من المحرك. */
export function autoRefresh() {
  getAutomationSocket().emit("rules:list")
}

/** إنشاء/تعديل قاعدة (id موجود = تعديل). */
export function autoRuleUpsert(rule: Omit<AutoRule, "createdAt" | "lastFiredAt" | "fireCount" | "id"> & { id?: string }) {
  getAutomationSocket().emit("rule:upsert", { rule, id: rule.id })
}

/** حذف قاعدة. */
export function autoRuleDelete(id: string) {
  getAutomationSocket().emit("rule:delete", { id })
}

/** تفعيل/تعطيل قاعدة. */
export function autoRuleToggle(id: string, enabled: boolean) {
  getAutomationSocket().emit("rule:toggle", { id, enabled })
}

/** تشغيل قاعدة يدويًا الآن (اختبار). */
export function autoRuleRunNow(id: string) {
  getAutomationSocket().emit("rule:run-now", { id })
}

/** تفريغ سجل التشغيل. */
export function autoLogClear() {
  getAutomationSocket().emit("log:clear")
}

/** تعليم كل التنبيهات غير المرئية كمقروءة (§26.ح) — رسوخًا في SQLite. */
export function autoAlertsMarkSeen() {
  getAutomationSocket().emit("alerts:mark-seen")
}
