"use client"
// FA-clipboard-sync — استدعاء أوامر الطبقة الأصلية داخل نافذة Tauri
// (withGlobalTauri: true — صحيح في apps/desktop/src-tauri/tauri.conf.json)
// خارج نافذة Tauri يرفض الوعد (المتصل يتعامل بهدوء).

type TauriGlobal = {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!((window as unknown as TauriGlobal).__TAURI__?.core?.invoke)
}

export function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = (window as unknown as TauriGlobal).__TAURI__?.core?.invoke
  if (!inv) return Promise.reject(new Error("لا نافذة Tauri"))
  return inv<T>(cmd, args)
}
