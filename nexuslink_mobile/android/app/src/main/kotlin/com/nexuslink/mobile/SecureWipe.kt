package com.nexuslink.mobile

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.SecureRandom

/**
 * SecureWipe — حذف آمن للملفات المستلمة على الهاتف (FA-10، عقد §9.3).
 *
 * ملفات `Download/NexusLink` (كلها ملكية التطبيق عبر MediaStore) تُحرق كتابةً فوق
 * بعدد تمريرات محدد (3 أو 7): عشوائي → أصفار → 0xFF (تناوب)، مع fsync لكل تمريرة،
 * ثم حذف الإدخال من MediaStore. المسار القديم (≤28) ملف مباشر عبر RandomAccessFile.
 *
 * من الزر داخل التطبيق أو أمر السيرفر (`sec:wipe-cmd` / `dev:wipe`).
 */
object SecureWipe {

    class Item(val uri: Uri?, val path: String?, val name: String, val size: Long)

    /** قائمة الملفات المستلمة (Download/NexusLink). */
    fun listReceived(ctx: Context): List<Item> {
        val out = ArrayList<Item>()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
                val proj = arrayOf(
                    MediaStore.MediaColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.RELATIVE_PATH,
                )
                ctx.contentResolver.query(collection, proj, null, null, null)?.use { c ->
                    while (c.moveToNext()) {
                        val rel = c.getString(3) ?: continue
                        if (!rel.contains("NexusLink")) continue
                        val id = c.getLong(0)
                        out.add(
                            Item(
                                uri = ContentUris.withAppendedId(collection, id),
                                path = null,
                                name = c.getString(1) ?: "file",
                                size = c.getLong(2),
                            ),
                        )
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "NexusLink")
                dir.listFiles()?.forEach { f -> if (f.isFile) out.add(Item(null, f.absolutePath, f.name, f.length())) }
            }
        } catch (_: Exception) {
        }
        return out
    }

    /**
     * تنفيذ المسح الآمن — يعيد نتيجة عقد §4.6:
     * {ok, deviceId, count, bytes, files[], error?}
     */
    fun wipe(ctx: Context, deviceId: String, passes: Int, onProgress: ((done: Int, total: Int, file: String) -> Unit)? = null): JSONObject {
        val n = if (passes == 7) 7 else 3
        val files = listReceived(ctx)
        val result = JSONObject()
            .put("deviceId", deviceId)
            .put("passes", n)
        var bytes = 0L
        var count = 0
        val names = JSONArray()
        var error: String? = null
        try {
            for ((idx, item) in files.withIndex()) {
                try {
                    overwrite(ctx, item, n)
                    count++
                    bytes += item.size
                    names.put(item.name)
                } catch (e: Exception) {
                    if (error == null) error = "«${item.name}»: ${e.message?.take(80)}"
                }
                onProgress?.invoke(idx + 1, files.size, item.name)
            }
        } catch (e: Exception) {
            error = e.message?.take(120)
        }
        result
            .put("ok", error == null)
            .put("count", count)
            .put("bytes", bytes)
            .put("files", names)
        if (error != null) result.put("error", error)
        return result
    }

    private fun overwrite(ctx: Context, item: Item, passes: Int) {
        if (item.uri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // كتابة فوق عبر pfd ثم حذف من MediaStore
            val pfd: ParcelFileDescriptor = ctx.contentResolver.openFileDescriptor(item.uri, "rw")
                ?: throw IllegalStateException("لا يمكن فتح الملف")
            try {
                val size = pfd.statSize
                FileOutputStream(pfd.fileDescriptor).use { out ->
                    val buf = ByteArray(1024 * 1024)
                    val rnd = SecureRandom()
                    for (p in 1..passes) {
                        out.channel.position(0)
                        var remaining = size
                        while (remaining > 0) {
                            val chunk = minOf(buf.size.toLong(), remaining).toInt()
                            when (p % 3) {
                                1 -> rnd.nextBytes(buf) // تمريرة عشوائية
                                2 -> java.util.Arrays.fill(buf, 0, chunk, 0) // أصفار
                                else -> java.util.Arrays.fill(buf, 0, chunk, 0xFF.toByte()) // 0xFF
                            }
                            out.write(buf, 0, chunk)
                            remaining -= chunk
                        }
                        out.flush()
                        out.fd.sync()
                    }
                }
            } finally {
                try { pfd.close() } catch (_: Exception) {
                }
            }
            ctx.contentResolver.delete(item.uri, null, null)
        } else {
            val path = item.path ?: throw IllegalStateException("مسار غير معروف")
            val f = File(path)
            if (!f.exists()) return
            val size = f.length()
            RandomAccessFile(f, "rw").use { raf ->
                val buf = ByteArray(1024 * 1024)
                val rnd = SecureRandom()
                for (p in 1..passes) {
                    raf.seek(0)
                    var remaining = size
                    while (remaining > 0) {
                        val chunk = minOf(buf.size.toLong(), remaining).toInt()
                        when (p % 3) {
                            1 -> rnd.nextBytes(buf)
                            2 -> java.util.Arrays.fill(buf, 0, chunk, 0)
                            else -> java.util.Arrays.fill(buf, 0, chunk, 0xFF.toByte())
                        }
                        raf.write(buf, 0, chunk)
                        remaining -= chunk
                    }
                    raf.fd.sync()
                }
            }
            f.delete()
        }
    }
}
