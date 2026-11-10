import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Q1 (تكليف 52): استعلام وسائط المتصفح متجر خارجي (useSyncExternalStore) —
// لقطة الخادم false ولاقطة العميل من matchMedia مباشرة — بلا setState متزامن في effect.
function subscribeMobile(cb: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}
function getMobileSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}
function getServerMobileSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerMobileSnapshot)
}
