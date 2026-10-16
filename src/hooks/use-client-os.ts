"use client"

import { useSyncExternalStore } from "react"
import { detectOS, type OsKind } from "@/lib/download-site-data"

const emptySubscribe = () => () => {}

function getSnapshot(): OsKind {
  return detectOS(typeof navigator === "undefined" ? "" : navigator.userAgent)
}

function getServerSnapshot(): OsKind {
  return "other"
}

/**
 * Reads the visitor's OS without effects/setState (hydration-safe):
 * the server snapshot is "other" and the client resolves the real OS.
 */
export function useClientOS(): OsKind {
  return useSyncExternalStore(emptySubscribe, getSnapshot, getServerSnapshot)
}
