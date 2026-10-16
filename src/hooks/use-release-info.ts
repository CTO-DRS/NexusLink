"use client"

import { useEffect, useState } from "react"
import { STATIC_RELEASE, releaseVersion, type ReleaseInfo, type ReleaseAssetInfo } from "@/lib/download-site-data"

const GITHUB_LATEST_API = "https://api.github.com/repos/CTO-DRS/NexusLink/releases/latest"
const TIMEOUT_MS = 9000

interface UseReleaseInfoResult {
  info: ReleaseInfo
  loading: boolean
}

/**
 * Live release info from the public GitHub API (no token, client-side).
 * Falls back silently to the embedded offline snapshot so the page
 * never shows broken data — `live` tells which source is active.
 */
export function useReleaseInfo(): UseReleaseInfoResult {
  const [info, setInfo] = useState<ReleaseInfo>(STATIC_RELEASE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)

    fetch(GITHUB_LATEST_API, {
      signal: ac.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: {
        tag_name?: string
        published_at?: string
        assets?: { name: string; size: number; download_count: number }[]
      }) => {
        const assets: Record<string, ReleaseAssetInfo> = {}
        for (const a of d.assets ?? []) {
          assets[a.name] = { name: a.name, bytes: a.size, downloads: a.download_count }
        }
        const tag = d.tag_name ?? STATIC_RELEASE.tag
        setInfo({
          tag,
          version: releaseVersion(tag),
          publishedAt: d.published_at ?? STATIC_RELEASE.publishedAt,
          assets: Object.keys(assets).length ? assets : STATIC_RELEASE.assets,
          live: true,
        })
      })
      .catch(() => {
        /* offline / rate-limited → keep snapshot */
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
