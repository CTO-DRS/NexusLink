"use client"

import { useEffect, useState } from "react"
import { STATIC_RELEASE, type ReleaseInfo, type ReleaseAssetInfo } from "@/lib/download-site-data"

const TIMEOUT_MS = 9000

interface UseReleaseInfoResult {
  info: ReleaseInfo
  loading: boolean
}

/**
 * تكليف 50 (FA-21): بيانات الإصدار الحية عبر **الوكيل من نفس الأصل** حصرًا
 * (/api/releases/latest) — الطلب المباشر لapi.github.com من المتصفح كان مصدودًا
 * CSP (FA-18: connect-src 'self' صافية) بضمانة على كل تحميل — فشل صامت أبقى
 * اللقطة القديمة شهرًا. الوكيل يجعل الطلب نفس الأصل فتمره connect-src بلا أي
 * استثناء، والوجهة العلوية ثابتة في الخادم (صفر SSRF) والرمز لا يوجد أصلًا.
 * Falls back silently to the embedded offline snapshot so the page
 * never shows broken data — `live` tells which source is active.
 */
export function useReleaseInfo(): UseReleaseInfoResult {
  const [info, setInfo] = useState<ReleaseInfo>(STATIC_RELEASE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)

    fetch("/api/releases/latest", {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: {
        ok?: boolean
        tag?: string
        version?: string
        publishedAt?: string
        assets?: Record<string, ReleaseAssetInfo>
        live?: boolean
      }) => {
        if (!d?.ok || !d.tag || !d.assets || Object.keys(d.assets).length === 0) {
          // رد غير مكتمل → اللقطة كما هي (سلوك الفشل الصامت المحفوظ حرفيًا)
          return
        }
        setInfo({
          tag: d.tag,
          version: d.version ?? STATIC_RELEASE.version,
          publishedAt: d.publishedAt ?? STATIC_RELEASE.publishedAt,
          assets: d.assets,
          live: d.live === true,
        })
      })
      .catch(() => {
        /* offline / aborted → keep snapshot */
      })
      .finally(() => {
        clearTimeout(timer)
        setLoading(false)
      })

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [])

  return { info, loading }
}
