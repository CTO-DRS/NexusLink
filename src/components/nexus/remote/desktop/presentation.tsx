"use client"
// نافذة العرض التقديمي — تتقلب بالأوامر الواردة من الهاتف + مؤشر ليزري
import { AnimatePresence, motion } from "framer-motion"
import { Presentation } from "lucide-react"
import { useDesktop } from "@/lib/remote-store"

export function PresentationWindow() {
  const slides = useDesktop((s) => s.slides)
  const index = useDesktop((s) => s.slideIndex)
  const black = useDesktop((s) => s.slideBlack)
  const laser = useDesktop((s) => s.laser)
  const slide = slides[index]

  return (
    <>
      {/* شريط العنوان */}
      <div className="flex items-center gap-2 px-3 h-9 border-b bg-card/60 shrink-0">
        <span className="flex gap-1.5" dir="ltr">
          <i className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <i className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <i className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        </span>
        <Presentation className="w-3.5 h-3.5 text-orange-500" />
        <span className="text-[12px] font-semibold">NexusLink-Phase6.pptx — عرض تقديمي</span>
        <span className="flex-1" />
        <span className="text-[10px] text-muted-foreground tabular-nums" dir="ltr">{index + 1} / {slides.length}</span>
      </div>

      {/* منطقة الشريحة */}
      <div className="relative flex-1 m-3 rounded-xl bg-white text-slate-900 overflow-hidden shadow-inner dark:bg-slate-100">
        <AnimatePresence mode="wait">
          {black ? (
            <motion.div
              key="black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black grid place-items-center"
            >
              <p className="text-white/40 text-sm">الشاشة السوداء — أوقفها من الهاتف للمتابعة</p>
            </motion.div>
          ) : (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <span className="text-5xl sm:text-6xl">{slide.emoji}</span>
              <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight">{slide.title}</h3>
              <div className="space-y-1.5">
                {slide.lines.map((l) => (
                  <p key={l} className="text-[13px] sm:text-[15px] text-slate-600 font-medium">{l}</p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* المؤشر الليزري */}
        {laser.active && !black && (
          <span
            className="absolute z-20 w-3 h-3 rounded-full bg-red-500 nexus-laser pointer-events-none"
            style={{ left: `${laser.x * 100}%`, top: `${laser.y * 100}%`, transform: "translate(-50%,-50%)" }}
            aria-hidden
          />
        )}

        {/* نقاط الشرائح */}
        {!black && (
          <div className="absolute bottom-2.5 inset-x-0 flex items-center justify-center gap-1.5">
            {slides.map((_, i) => (
              <span key={i} className={`rounded-full transition-all ${i === index ? "w-5 h-1.5 bg-teal-600" : "w-1.5 h-1.5 bg-slate-400/60"}`} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
