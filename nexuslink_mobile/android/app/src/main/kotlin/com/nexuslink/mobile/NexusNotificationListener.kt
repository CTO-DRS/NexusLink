package com.nexuslink.mobile

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * §45 — مرآة الإشعارات الحقيقية: هاتف → جسر الاتصالات 3003 → الكمبيوتر.
 *
 * لا تعمل إلا إذا منح المستخدم «الوصول إلى الإشعارات» من إعدادات النظام
 * (لا يمكن لأي تطبيق منحه لنفسه)، وبوجود وكيل Nexus حي ومقترن. ترسل العنوان
 * والنص المختصرين فقط — بلا صور ولا أزرار ولا محتوى الإشعارات الجارية/الصامتة.
 */
class NexusNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        if (n.packageName == packageName) return // لا صدى لإشعارات Nexus نفسها
        if (n.isOngoing) return // تشغيل موسيقى/تنزيلات/خدمات أمامية
        val notif = n.notification ?: return
        if (notif.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (notif.visibility == Notification.VISIBILITY_SECRET) return // إشعار سري: لا يغادر الهاتف
        val ex = notif.extras ?: return
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val body = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
        if (title.isEmpty() && body.isEmpty()) return
        val appName = try {
            val pm = packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(n.packageName, 0)).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            n.packageName
        } catch (_: Exception) {
            n.packageName
        }
        AgentForegroundService.mirrorNotification(
            n.packageName,
            appName.take(60),
            title.take(200),
            body.take(600),
        )
    }
}
