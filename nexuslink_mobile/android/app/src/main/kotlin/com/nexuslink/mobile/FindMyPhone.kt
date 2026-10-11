package com.nexuslink.mobile

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * FindMyPhone — تنفيذ «أين هاتفي» (عقد §4.4 — FA-8).
 *
 * يعمل داخل خدمة الوكيل الدائمة لذلك يستجيب حتى مع انطفاء التطبيق:
 *  · startRing: وضع الرنين NORMAL (تجاوز الصامت/الاهتزاز) + مستوى صوت الأعلى
 *    (الموسيقى والمنبه) + رنين تكراري عبر MediaPlayer (USAGE_ALARM يواصل قبل
 *    القفل أيضاً) + اهتزاز مستمر + إضاءة الشاشة — حتى [stopRing].
 *  · lightScreen(on): إضاءة الشاشة + وميض الكشاف 5 ثوانٍ (CameraManager
 *    .setTorchMode عند توفره)، أو إطفاء الكشاف فوراً.
 *
 * يُستعاد كل ما عُدّل (الوضع الصامت، مستويات الصوت) عند التوقف.
 */
object FindMyPhone {

    private val main = Handler(Looper.getMainLooper())

    private var player: android.media.MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wake: PowerManager.WakeLock? = null
    private var torchOn = false

    private var savedRinger = AudioManager.RINGER_MODE_NORMAL
    private var savedMusic = -1
    private var savedAlarm = -1
    private var ringing = false

    private var torchRunnable: Runnable? = null

    // ------------------------------------------------------------------
    // الرن القوي
    // ------------------------------------------------------------------

    fun startRing(ctx: Context): String {
        if (ringing) return "الرنين جارٍ بالفعل"
        ringing = true
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        // حفظ الحالة الحالية لاستعادتها
        try {
            savedRinger = am.ringerMode
            savedMusic = am.getStreamVolume(AudioManager.STREAM_MUSIC)
            savedAlarm = am.getStreamVolume(AudioManager.STREAM_ALARM)
        } catch (_: Exception) {
        }

        // تجاهل الوضع الصامت — نوضع الرنين العادي ونرفع الصوت للأقصى
        try {
            am.ringerMode = AudioManager.RINGER_MODE_NORMAL
            am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0)
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        } catch (_: Exception) {
        }

        // رنين تكراري بأعلى صوت — نغمة المنبه (تعمل حتى لو القفل)
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val p = android.media.MediaPlayer()
            p.setDataSource(ctx, uri)
            p.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            p.isLooping = true
            p.prepare()
            p.start()
            player = p
        } catch (_: Exception) {
            player = null
        }

        // اهتزاز مستمر بنمط قوي
        try {
            val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            val pattern = longArrayOf(0, 700, 400, 700, 400)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(pattern, 0)
            }
            vibrator = v
        } catch (_: Exception) {
            vibrator = null
        }

        wakeScreen(ctx)
        return "رنين بأقصى صوت — تجاوز الوضع الصامت"
    }

    fun stopRing(ctx: Context): String {
        if (!ringing) return "لا رنين جارٍ"
        ringing = false
        try {
            player?.stop()
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        try {
            vibrator?.cancel()
        } catch (_: Exception) {
        }
        vibrator = null

        // استعادة ما قبل الرن
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.ringerMode = savedRinger
            if (savedMusic >= 0) am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusic, 0)
            if (savedAlarm >= 0) am.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarm, 0)
        } catch (_: Exception) {
        }
        wake?.let { try { it.release() } catch (_: Exception) {} }
        wake = null
        return "أُوقف الرنين واستُعيدت الإعدادات"
    }

    fun isRinging(): Boolean = ringing

    // ------------------------------------------------------------------
    // إضاءة الشاشة / الفلاش
    // ------------------------------------------------------------------

    fun lightScreen(ctx: Context, on: Boolean): String {
        if (!on) {
            setTorch(ctx, false)
            torchRunnable?.let { main.removeCallbacks(it) }
            torchRunnable = null
            return "أُطفئ الكشاف"
        }
        wakeScreen(ctx)
        setTorch(ctx, true)
        // وميض 5 ثوانٍ ثم انطفاء تلقائي (الشاشة تبقى مضاءة حتى انتهاء الـ WakeLock)
        torchRunnable?.let { main.removeCallbacks(it) }
        torchRunnable = Runnable { setTorch(ctx, false) }
        main.postDelayed(torchRunnable!!, 5_000L)
        return "أُضيئت الشاشة${if (torchOn) " والكشاف (5 ثوانٍ)" else ""}"
    }

    private fun wakeScreen(ctx: Context) {
        try {
            wake?.let { if (it.isHeld) try { it.release() } catch (_: Exception) {} }
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val w = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "NexusLink:find-phone",
            )
            w.acquire(10 * 60 * 1000L) // حتى 10 دقائق أثناء الرن
            wake = w
        } catch (_: Exception) {
        }
    }

    private fun setTorch(ctx: Context, on: Boolean) {
        try {
            val cam = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val ids = cam.cameraIdList
            for (id in ids) {
                val flash = cam.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                val facing = cam.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.LENS_FACING)
                if (flash && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    // الكشاف لا يعمل بينما كاميرا مشغولة من بث — نحاول ونصمت
                    cam.setTorchMode(id, on)
                    torchOn = on
                    return
                }
            }
        } catch (_: Exception) {
        }
        torchOn = false
    }

    fun isTorchOn(): Boolean = torchOn

    /** تنظيف شامل (انقطاع القناة/تدمير الخدمة). */
    fun shutdown(ctx: Context) {
        if (ringing) stopRing(ctx)
        torchRunnable?.let { main.removeCallbacks(it) }
        torchRunnable = null
        setTorch(ctx, false)
    }
}
