package com.nexuslink.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Point
import android.graphics.PointF
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.ArrayDeque

/**
 * NexusAccessibilityService — محرك حقن اللمس والإدخال (FA-7 — بديل AirMirror).
 *
 * تستقبل أوامرها من [AgentForegroundService] (نفس العملية) عبر النسخة الساكنة،
 * وتنفّذها بـ dispatchGesture بدقة بكسل:
 *  · tap / long / swipe / scroll — إيماءات مكتملة (إحلال واحد).
 *  · down / move / up — سلسلة StrokeDescription مستمرة (willContinue، API 26+،
 *    مع "نبضة" نصف بكسل كل 100ms تُبقي اللمس نازلًا أثناء الثبات — للضغط المطوّل
 *    عبر المسار الخام) وتساقط كامل عند الرفع كاحتياط لأقل من API 26.
 *  · ACTION_SET_TEXT على العقدة المركّزة (مع احتياط BFS لأول حقل قابل للتحرير).
 *  · أزرار النظام: GLOBAL_ACTION_BACK/HOME/RECENTS/NOTIFICATIONS.
 *
 * لا تفعل الخدمة شيئًا بنفسها: كل الأوامر تمر عبر بوابة الجلسة في خدمة الوكيل
 * (ctlActive) — لا جلسة تحكم نشطة، لا حقن إطلاقًا.
 */
class NexusAccessibilityService : AccessibilityService() {

    companion object {
        /** النسخة الحية — null إذا كانت الخدمة معطلة من إعدادات الإتاحة. */
        @Volatile
        var instance: NexusAccessibilityService? = null
            private set

        val isReady: Boolean get() = instance != null

        /** أبعاد الشاشة الحقيقية الفعلية — تُلتقط عند اتصال الخدمة. */
        @Volatile var screenW: Int = 0
        @Volatile var screenH: Int = 0
        @Volatile var screenDensity: Int = 0

        /** قراءة الأبعاد دون نسخة حية (بديل عن الخدمة — من أي سياق). */
        fun metricsFromContext(ctx: Context): Triple<Int, Int, Int>? = try {
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val w: Int; val h: Int
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = wm.maximumWindowMetrics.bounds
                w = b.width(); h = b.height()
            } else {
                val p = Point()
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealSize(p)
                w = p.x; h = p.y
            }
            if (w > 0 && h > 0) Triple(w, h, ctx.resources.displayMetrics.densityDpi) else null
        } catch (_: Exception) {
            null
        }
    }

    /** مخرج الإقرارات — الافتراضي: بث dev:touch-ack عبر خدمة الوكيل (نفس العملية). */
    @Volatile
    var ackSink: ((seq: Int, op: String, ok: Boolean, err: String?) -> Unit)? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    // ---- سلسلة اللمس المستمرة (down/move/up) ----
    private var contStroke: GestureDescription.StrokeDescription? = null
    private var contLast: PointF? = null
    private var contFirst: PointF? = null
    private var contStart: Long = 0
    private var contPhase: Boolean = false
    private var heartbeatOn: Boolean = false

    private companion object {
        const val POINTER_MS = 40L          // مدة مقطع اللمس المستمر الواحد
        const val HEARTBEAT_MS = 100L       // نبضة الاستمرار أثناء ثبات الإصبع
        const val TAP_MS = 60L
        const val MAX_NODES = 300
    }

    // ------------------------------------------------------------------
    // دورة الحياة
    // ------------------------------------------------------------------

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        captureMetrics()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        ackSink = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // لا نستهلك الأحداث — الشاشة قد تتغير الاتجاه؛ نحدّث الأبعاد عند تغيّر النافذة
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) captureMetrics()
    }

    private fun captureMetrics() {
        val m = metricsFromContext(this) ?: return
        screenW = m.first; screenH = m.second; screenDensity = m.third
    }

    /** أبعاد الشاشة الحالية (تلتقط من جديد إن لم تكن معروفة). */
    fun screenInfo(): Triple<Int, Int, Int>? {
        if (screenW <= 0 || screenH <= 0) captureMetrics()
        return if (screenW > 0 && screenH > 0) Triple(screenW, screenH, screenDensity) else null
    }

    // ------------------------------------------------------------------
    // الإيماءات المكتملة
    // ------------------------------------------------------------------

    fun tap(x: Float, y: Float, seq: Int) = mainHandler.post {
        val b = GestureDescription.Builder()
        b.addStroke(GestureDescription.StrokeDescription(pointPath(x, y), 0, TAP_MS))
        dispatch(b, seq, "tap")
    }

    fun longPress(x: Float, y: Float, durationMs: Long, seq: Int) = mainHandler.post {
        val b = GestureDescription.Builder()
        b.addStroke(
            GestureDescription.StrokeDescription(pointPath(x, y), 0, durationMs.coerceIn(400, 3000)),
        )
        dispatch(b, seq, "long")
    }

    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long, op: String, seq: Int) =
        mainHandler.post {
            val p = Path()
            p.moveTo(x1, y1)
            if (x1 == x2 && y1 == y2) p.lineTo(x1 + 0.5f, y1) else p.lineTo(x2, y2)
            val b = GestureDescription.Builder()
            b.addStroke(
                GestureDescription.StrokeDescription(p, 0, durationMs.coerceIn(40, 5000)),
            )
            dispatch(b, seq, op)
        }

    /** تمرير (scroll) كلمسة إصبع سلسة — المسافة والاتجاه يحددهما الويب. */
    fun scroll(x: Float, y: Float, dx: Float, dy: Float, durationMs: Long, seq: Int) {
        val x2 = (x + dx).coerceIn(0f, screenW.coerceAtLeast(1).toFloat())
        val y2 = (y + dy).coerceIn(0f, screenH.coerceAtLeast(1).toFloat())
        swipe(x, y, x2, y2, durationMs, "scroll", seq)
    }

    // ------------------------------------------------------------------
    // اللمس الخام المستمر — down / move / up
    // ------------------------------------------------------------------

    fun touchDown(x: Float, y: Float) = mainHandler.post {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return@post
        val s = GestureDescription.StrokeDescription(pointPath(x, y), 0, POINTER_MS, true)
        contStroke = s
        contLast = PointF(x, y)
        contFirst = PointF(x, y)
        contStart = SystemClock.uptimeMillis()
        safeDispatch(GestureDescription.Builder().addStroke(s).build())
        startHeartbeat()
    }

    fun touchMove(x: Float, y: Float) = mainHandler.post {
        val last = contLast ?: return@post
        if (Math.abs(last.x - x) < 0.6f && Math.abs(last.y - y) < 0.6f) return@post
        continueTo(x, y)
    }

    fun touchUp(x: Float, y: Float) = mainHandler.post {
        stopHeartbeat()
        val last = contLast ?: PointF(x, y)
        val s0 = contStroke
        if (s0 != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // خاتمة السلسلة — رفع الإصبع عند (x, y)
            val p = Path()
            p.moveTo(last.x, last.y)
            if (last.x == x && last.y == y) p.lineTo(x + 0.5f, y) else p.lineTo(x, y)
            val s = s0.continueStroke(p, 0, POINTER_MS, false)
            safeDispatch(GestureDescription.Builder().addStroke(s).build())
        } else {
            // احتياط <API 26: أطلق السحبة المجمّعة كاملة
            val first = contFirst ?: last
            val dur = (SystemClock.uptimeMillis() - contStart).coerceIn(60, 5000)
            val p = Path()
            p.moveTo(first.x, first.y)
            if (first.x == last.x && first.y == last.y) p.lineTo(last.x + 0.5f, last.y) else p.lineTo(last.x, last.y)
            val b = GestureDescription.Builder()
            b.addStroke(GestureDescription.StrokeDescription(p, 0, dur))
            safeDispatch(b.build())
        }
        contStroke = null; contLast = null; contFirst = null
    }

    private fun continueTo(x: Float, y: Float) {
        val last = contLast ?: return
        val s0 = contStroke ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val p = Path()
            p.moveTo(last.x, last.y)
            p.lineTo(x, y)
            val s = s0.continueStroke(p, 0, POINTER_MS, true)
            contStroke = s
            contLast = PointF(x, y)
            safeDispatch(GestureDescription.Builder().addStroke(s).build())
        } else {
            contLast = PointF(x, y) // يُطلق مجمّعًا عند الرفع
        }
    }

    /** نبضة تحافظ على نزول اللمس أثناء الثبات (ضغط مطوّل عبر المسار الخام). */
    private fun startHeartbeat() {
        if (heartbeatOn) return
        heartbeatOn = true
        val hb = object : Runnable {
            override fun run() {
                if (!heartbeatOn || contStroke == null) return
                val last = contLast
                if (last != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    contPhase = !contPhase
                    val dx = if (contPhase) 0.25f else -0.25f
                    val p = Path()
                    p.moveTo(last.x, last.y)
                    p.lineTo(last.x + dx, last.y)
                    val s = contStroke!!.continueStroke(p, 0, POINTER_MS, true)
                    contStroke = s
                    safeDispatch(GestureDescription.Builder().addStroke(s).build())
                }
                mainHandler.postDelayed(this, HEARTBEAT_MS)
            }
        }
        mainHandler.postDelayed(hb, HEARTBEAT_MS)
    }

    private fun stopHeartbeat() {
        heartbeatOn = false
    }

    // ------------------------------------------------------------------
    // النص وأزرار النظام
    // ------------------------------------------------------------------

    /** حقن نص في الحقل المركّز (نص فارغ = مسح). ACTION_SET_TEXT. */
    fun setText(text: String, seq: Int) = mainHandler.post {
        val node = focusedEditable()
        if (node == null) {
            ack(seq, "text", false, "no-editable-focus")
            return@post
        }
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val ok = try {
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } catch (_: Exception) {
            false
        }
        ack(seq, "text", ok, if (ok) null else "set-text-refused")
    }

    /** أزرار النظام: back/home/recents/notifications/keyboard. */
    fun keyAction(action: String, seq: Int) = mainHandler.post {
        when (action) {
            "back" -> ack(seq, "key", performGlobalAction(GLOBAL_ACTION_BACK), null)
            "home" -> ack(seq, "key", performGlobalAction(GLOBAL_ACTION_HOME), null)
            "recents" -> ack(seq, "key", performGlobalAction(GLOBAL_ACTION_RECENTS), null)
            "notifications" -> ack(seq, "key", performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS), null)
            "keyboard" -> {
                val focused = try {
                    rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                } catch (_: Exception) {
                    null
                }
                if (focused != null) {
                    // حقل مركّز موجود → نقرة تفتح لوحة المفاتيح
                    ack(seq, "key", focused.performAction(AccessibilityNodeInfo.ACTION_CLICK), null)
                } else {
                    // لا حقل → الرجوع يخفي لوحة المفاتيح إن كانت ظاهرة
                    ack(seq, "key", performGlobalAction(GLOBAL_ACTION_BACK), null)
                }
            }
            else -> ack(seq, "key", false, "unknown-action")
        }
    }

    private fun focusedEditable(): AccessibilityNodeInfo? {
        val root = try {
            rootInActiveWindow ?: return null
        } catch (_: Exception) {
            return null
        }
        try {
            root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.let { f ->
                if (f.isEditable && f.isEnabled) return f
            }
        } catch (_: Exception) {
        }
        // احتياط: أول حقل قابل للتحرير في الشجرة (BFS محدود)
        val q = ArrayDeque<AccessibilityNodeInfo>()
        q.add(root)
        var visited = 0
        while (q.isNotEmpty() && visited < MAX_NODES) {
            val n = try {
                q.pollFirst() ?: break
            } catch (_: Exception) {
                break
            }
            visited++
            if (n.isEditable && n.isEnabled) return n
            for (i in 0 until n.childCount) {
                try {
                    n.getChild(i)?.let { q.add(it) }
                } catch (_: Exception) {
                }
            }
        }
        return null
    }

    // ------------------------------------------------------------------
    // أدوات التفريغ والإقرار
    // ------------------------------------------------------------------

    private fun pointPath(x: Float, y: Float): Path {
        val p = Path()
        p.moveTo(x, y)
        p.lineTo(x + 0.5f, y) // طول غير صفري — بلا إزاحة محسوسة
        return p
    }

    private fun dispatch(builder: GestureDescription.Builder, seq: Int, op: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            ack(seq, op, false, "unsupported")
            return
        }
        try {
            val queued = dispatchGesture(
                builder.build(),
                object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) = ack(seq, op, true, null)
                    override fun onCancelled(gestureDescription: GestureDescription?) = ack(seq, op, false, "cancelled")
                },
                mainHandler,
            )
            if (!queued) ack(seq, op, false, "busy")
        } catch (e: Exception) {
            ack(seq, op, false, e.message?.take(80) ?: "error")
        }
    }

    private fun safeDispatch(desc: GestureDescription) {
        try {
            dispatchGesture(desc, null, mainHandler)
        } catch (_: Exception) {
        }
    }

    private fun ack(seq: Int, op: String, ok: Boolean, err: String?) {
        try {
            val sink = ackSink
            if (sink != null) {
                sink(seq, op, ok, err)
            } else {
                // المسار الافتراضي: خدمة الوكيل تبث dev:touch-ack للسيرفر
                AgentForegroundService.forwardTouchAck(seq, op, ok, err)
            }
        } catch (_: Exception) {
        }
    }
}
