// NexusLink — خدمة مزامنة مجلدات الهاتف (FA-files عقد §14)
// ============================================================
// الاتجاه الهاتف → الكمبيوتر: مراقبة Download/NexusLink/Sync/ بـ Directory.watch
// (inotify عبر FUSE) + رفع أي ملف جديد/معدّل إلى /Sync/<rel> عبر محرك الرفع
// المجزّأ نفسه (§8.2) — يهبط في جذر الوكيل على الكمبيوتر وينسخه المراقب الأصلي
// (notify في Rust) إلى المجلد المتزامن خلال ثوانٍ.
// الاتجاه الكمبيوتر → الهاتف: عروض tx:offer من /Outbox/<pair>/ يهبطها محرك
// النقل في Sync/<pair>/ عبر publishDownload (subPath) — والصدى يُكسر بـ EchoRegistry.
// حدود موثقة بصدق: تعمل أثناء حياة التطبيق/الخدمة؛ الحذف لا ينتشر.
import 'dart:async';
import 'dart:io';

import 'echo_registry.dart';
import 'transfer_api.dart';

class PhoneSyncService {
  PhoneSyncService({required NexusTransferApi api, required String deviceId, void Function(String, {String kind})? onLog})
      : _api = api,
        _deviceId = deviceId,
        _onLog = onLog;

  final NexusTransferApi _api;
  final String _deviceId;
  final void Function(String, {String kind})? _onLog;

  static const String syncRoot = '/storage/emulated/0/Download/NexusLink/Sync';
  static const Duration debounce = Duration(milliseconds: 900);

  StreamSubscription<FileSystemEvent>? _sub;
  final Set<String> _pending = {};
  final Set<String> _uploading = {};
  bool _starting = false;

  bool get running => _sub != null;

  Future<void> start() async {
    if (_sub != null || _starting) return;
    _starting = true;
    try {
      final root = Directory(syncRoot);
      if (!await root.exists()) {
        await root.create(recursive: true);
      }
      _sub = root.watch(recursive: true).listen((event) {
        final p = event.path;
        if (p.endsWith('.nexuspart') || p.endsWith('.tmp')) return;
        final name = p.split('/').where((s) => s.isNotEmpty).last;
        if (name.isEmpty || name.startsWith('.') || name.startsWith('~')) return;
        // صدى: نزل من الكمبيوتر للتو؟ تجاهل (السجل نافذة 6 ثوانٍ)
        if (EchoRegistry.instance.recentlyWritten(p)) return;
        _pending.add(p);
        _scheduleFlush();
      }, onError: (Object e) {
        _onLog?.call('مراقب المزامنة توقف: $e', kind: 'warn');
      });
      _onLog?.call('مزامنة المجلدات نشطة على الهاتف ($syncRoot)', kind: 'ok');
    } catch (e) {
      _onLog?.call('تعذر بدء مزامنة المجلدات: $e', kind: 'warn');
    } finally {
      _starting = false;
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  void _scheduleFlush() {
    Future.delayed(debounce, () async {
      final batch = _pending.toList(growable: false);
      _pending.clear();
      for (final p in batch) {
        await _uploadOne(p);
      }
    });
  }

  Future<void> _uploadOne(String p) async {
    if (_uploading.contains(p)) return;
    final f = File(p);
    try {
      if (!await f.exists()) return; // حُذف قبل المعالجة — الحذف لا ينتشر (حد موثق)
      final st = await f.stat();
      if (st.length > 200 * 1024 * 1024) {
        _onLog?.call('تجاوز حد المزامنة (200MB): ${p.split('/').last}', kind: 'warn');
        return;
      }
      // صدى مجددًا بعد التهادئة (نزول حديث عبر publishDownload)
      if (EchoRegistry.instance.recentlyWritten(p)) return;
      final rel = p.startsWith(syncRoot) ? p.substring(syncRoot.length).replaceAll('\\', '/') : null;
      if (rel == null || rel.isEmpty || rel == '/') return;
      _uploading.add(p);
      try {
        final dirV = '/Sync${rel.substring(0, rel.lastIndexOf('/') < 0 ? 0 : rel.lastIndexOf('/'))}';
        final name = rel.split('/').last;
        // جلسة رفع مستقرة: taskId = المسار + الحجم (استئناف تلقائي بعد أي انقطاع)
        final taskId = 'sync_${_deviceId}_${rel.hashCode.toUnsigned(31)}_$name';
        final init = await _api.uploadInit(
          deviceId: _deviceId,
          name: name,
          size: st.length,
          mime: 'application/octet-stream',
          localPath: p,
          dir: dirV.isEmpty ? '/Sync' : dirV,
          taskId: taskId,
        );
        var received = init.received;
        if (received < st.length) {
          final raf = await f.open();
          try {
            while (received < st.length) {
              final len = st.length - received > 4 * 1024 * 1024 ? 4 * 1024 * 1024 : st.length - received;
              await raf.setPosition(received);
              final bytes = await raf.read(len);
              if (bytes.isEmpty) break;
              received = await _api.uploadChunk(init.uploadId, received, bytes);
            }
          } finally {
            await raf.close();
          }
        }
        if (received >= st.length) {
          await _api.uploadComplete(init.uploadId);
          _onLog?.call('مزامنة: رُفع $name إلى الكمبيوتر', kind: 'ok');
        }
      } catch (e) {
        _onLog?.call('مزامنة: تعذر رفع ملف — $e', kind: 'warn');
      } finally {
        _uploading.remove(p);
      }
    } catch (_) {/* الملف اختفى أثناء الفحص */}
  }
}
