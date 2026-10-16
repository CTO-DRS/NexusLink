package com.nexuslink.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * الجولة 5 (عقد §24) — خدمة أمامية بنوع mediaProjection لمشاركة شاشة الهاتف
 * (هاتف→هاتف عبر المركز). أندرويد 14+ (targetSdk 34) يشترط وجود خدمة أمامية
 * بهذا النوع قبل createVirtualDisplay — الترتيب التعاقدي في Dart:
 *   1) Helper.requestCapturePermission (حوار موافقة النظام — شرط بدء FGS)
 *   2) startScreenShareService (هذه الخدمة — التطبيق في المقدمة)
 *   3) getDisplayMedia (يستخدم بيانات الموافقة المخزّنة في flutter_webrtc —
 *      تحقق حرفي من مصدر المكوّن 1.6.2+hotfix.4: GetUserMediaImpl.getDisplayMedia
 *      يتخطى حوار الموافقة حين mediaProjectionData != null)
 * المسار منMainActivity.startScreenShareService/stopScreenShareService.
 */
class ScreenShareService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // النوع الصريح إلزامي على أندرويد 14+ (FOREGROUND_SERVICE_MEDIA_PROJECTION)
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, n)
        }
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "مشاركة الشاشة",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "إشعار دائم أثناء مشاركة شاشة هاتفك مع هاتف آخر عبر NexusLink"
                    setShowBadge(false)
                },
            )
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("مشاركة الشاشة نشطة")
            .setContentText("شاشتك تُبث إلى هاتف آخر عبر NexusLink — اضغط للإيقاف")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(
                android.app.PendingIntent.getActivity(
                    this, 1,
                    Intent(this, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
                    },
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "nexus_screen_share"
        private const val NOTIF_ID = 7901
        const val ACTION_STOP = "com.nexuslink.mobile.screenshare.STOP"

        /** بدء الخدمة (بعد حوار الموافقة حصرًا — التطبيق في المقدمة). */
        fun start(context: Context) {
            val i = Intent(context, ScreenShareService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(i)
                } else {
                    context.startService(i)
                }
            } catch (_: Exception) {
            }
        }

        /** إيقاف الخدمة (بعد إيقاف البث). */
        fun stop(context: Context) {
            try {
                context.startService(
                    Intent(context, ScreenShareService::class.java).apply { action = ACTION_STOP },
                )
            } catch (_: Exception) {
                // التطبيق في الخلفية والنظام رفض startService — إسقاط مباشر
                try {
                    context.stopService(Intent(context, ScreenShareService::class.java))
                } catch (_: Exception) {
                }
            }
        }
    }
}
