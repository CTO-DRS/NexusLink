"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

/**
 * تكليف 49 (M1 PERF): بديل `motion.*` + `whileInView` من framer-motion في صفحات
 * الموقع — نفس لغة الحركة (fade + slide-up بتأخير متدرج) بلا مكتبة:
 * عنصر مخفي يُشغَّل عند دخوله المنظر أول مرة (IntersectionObserver بلاوه صناعة).
 * الجذر `.nx-reveal` والاتجاه في globals.css؛ تقليل الحركة محترم على مستويي
 * المنصة (html.motion-reduced) والنظام (prefers-reduced-motion).
 * `as` يدعم أي وسم نصي (div/li/section…) ليبقى المعنى الدلالي كما كان.
 */
/** تحريك عند التحميل حصرًا (كان animate= في framer) — CSS animation تلقائية بلا مراقب */
export function RevealLoad({
  children,
  className = "",
  delay = 0,
  as = "div",
  style,
  ...rest
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: "div" | "h1" | "h2" | "p" | "span" | "section"
  style?: CSSProperties
} & Record<string, unknown>) {
  const Tag = as as "div"
  return (
    <Tag
      className={`nx-reveal nx-reveal-in ${className}`.trim()}
      style={delay ? { ...(style ?? {}), animationDelay: `${delay}s` } : style}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function Reveal({
  children,
  className = "",
  delay = 0,
  as = "div",
  style,
  ...rest
}: {
  children: ReactNode
  className?: string
  /** تأخير البدء بالثواني — كان transition.delay */
  delay?: number
  as?: "div" | "li" | "section" | "span" | "article" | "tr"
  style?: CSSProperties
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  // Q1 (تكليف 52): غياب IntersectionObserver مشتق أثناء الرندر لا setState متزامن في effect
  const noIO = typeof IntersectionObserver === "undefined"
  const shown = noIO || inView
  useEffect(() => {
    if (noIO) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setInView(true); io.disconnect(); break }
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [noIO])
  const Tag = as as "div"
  return (
    <Tag
      ref={ref as never}
      className={`nx-reveal ${shown ? "nx-reveal-in" : ""} ${className}`.trim()}
      style={delay ? { ...(style ?? {}), animationDelay: `${delay}s` } : style}
      {...rest}
    >
      {children}
    </Tag>
  )
}
