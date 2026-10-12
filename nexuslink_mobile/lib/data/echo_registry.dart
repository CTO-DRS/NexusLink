// NexusLink — سجل الصدى المشترك (FA-files عقد §14)
// ============================================================
// يمنع حلقة المزامنة: ملف نزل من الكمبيوتر عبر publishDownload لا يُرفع
// فورًا من مراقب المزامنة. خدمة المزامنة تستشير السجل قبل الرفع.
import 'dart:io';

class EchoRegistry {
  EchoRegistry._();
  static final EchoRegistry instance = EchoRegistry._();

  final List<(String, DateTime)> _recent = [];
  static const Duration window = Duration(seconds: 6);

  void record(String path) {
    _recent.removeWhere((e) => e.$1 == path || _sameFile(e.$1, path));
    _recent.add((path, DateTime.now()));
    if (_recent.length > 256) _recent.removeRange(0, _recent.length - 256);
  }

  bool recentlyWritten(String path) {
    final now = DateTime.now();
    _recent.removeWhere((e) => now.difference(e.$2) > window);
    return _recent.any((e) => e.$1 == path || _sameFile(e.$1, path));
  }

  static bool _sameFile(String a, String b) {
    try {
      final sa = File(a).statSync();
      final sb = File(b).statSync();
      // FUSE/MediaStore قد يعيد مسارات مختلفة لنفس الملف — قارن الحجم والزمن
      return sa.size == sb.size &&
          (sa.modified.difference(sb.modified).abs() < const Duration(seconds: 2)) &&
          sa.size > 0;
    } catch (_) {
      return false;
    }
  }
}
