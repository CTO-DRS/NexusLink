import 'dart:convert';

import 'package:flutter/services.dart';


/// عنصر مشارَك قادم من قائمة مشاركة أندرويد (Share Sheet).
class SharedIntake {
  final String? text; // نص/رابط مشارَك
  final List<SharedFile> files;
  const SharedIntake({this.text, this.files = const []});

  bool get isEmpty => (text == null || text!.isEmpty) && files.isEmpty;

  static SharedIntake fromMap(Map<Object?, Object?> m) {
    final text = m['text'] as String?;
    final rawFiles = (m['files'] as List?) ?? const [];
    final files = rawFiles
        .whereType<Map>()
        .map((f) => SharedFile(
              path: '${f['path'] ?? ''}',
              name: '${f['name'] ?? ''}',
              size: (f['size'] as num?)?.toInt() ?? 0,
              mime: (f['mime'] as String?)?.isEmpty == true ? null : f['mime'] as String?,
            ))
        .where((f) => f.path.isNotEmpty)
        .toList();
    return SharedIntake(text: (text?.isEmpty ?? true) ? null : text, files: files);
  }
}

class SharedFile {
  final String path; // نسخة في cache جاهزة للقراءة
  final String name;
  final int size;
  final String? mime;
  const SharedFile({required this.path, required this.name, required this.size, this.mime});
}

/// صورة جديدة مرصودة في DCIM (نسخة cache جاهزة للرفع).
class PhonePhoto {
  final String path; // ملف مؤقت في cache
  final String name;
  final int size;
  final int dateAddedSec;
  final String? mime;
  const PhonePhoto({required this.path, required this.name, required this.size, required this.dateAddedSec, this.mime});

  static PhonePhoto? tryParse(Map<Object?, Object?> m) {
    final path = '${m['path'] ?? ''}';
    if (path.isEmpty) return null;
    return PhonePhoto(
      path: path,
      name: '${m['name'] ?? 'photo.jpg'}',
      size: (m['size'] as num?)?.toInt() ?? 0,
      dateAddedSec: (m['dateAdded'] as num?)?.toInt() ?? 0,
      mime: m['mime'] as String?,
    );
  }
}

/// جسر أندرويد الأصلي لنقل الملفات والمشاركة والصور.
/// نفس القناة الموجودة "nexuslink/agent" — أساليب إضافية فوق أساليب الاتصال.
class NativeBridge {
  static const MethodChannel _ch = MethodChannel('nexuslink/agent');

  Future<T> _guard<T>(Future<T> Function() fn, T fallback) async {
    try {
      return await fn();
    } on MissingPluginException {
      return fallback; // بيئة بلا أندرويد (تحليل/فحص)
    } on PlatformException {
      return fallback;
    }
  }

  /// انشر ملفًا منزلًا في مجلد Download/NexusLink العام (MediaStore)
  /// واعرض إشعار نظام "اكتمل الاستلام". يعيد المسار النهائي.
  Future<String?> publishDownload({
    required String tempPath,
    required String displayName,
    String? mime,
  }) async {
    return _guard<String?>(() async {
      final r = await _ch.invokeMethod<dynamic>('publishDownload', {
        'tempPath': tempPath,
        'displayName': displayName,
        'mime': mime ?? 'application/octet-stream',
      });
      if (r is Map && r['path'] != null) return '${r['path']}';
      return null;
    }, null);
  }

  /// اسحب عناصر المشاركة المعلّقة (Share Sheet) — تُنسخ ملفاتها إلى cache أولًا.
  Future<SharedIntake> drainShare() async {
    return _guard<SharedIntake>(() async {
      final r = await _ch.invokeMethod<dynamic>('drainShare');
      if (r is Map) return SharedIntake.fromMap(r.cast<Object?, Object?>());
      return const SharedIntake();
    }, const SharedIntake());
  }

  /// امسح DCIM/Pictures عن صور أحدث من [sinceEpochSec] (ثواني Epoch).
  /// يعيد نسخًا cache جاهزة للرفع (ContentResolver → ملفات حقيقية).
  Future<List<PhonePhoto>> queryNewPhotos(int sinceEpochSec, {int limit = 200}) async {
    return _guard<List<PhonePhoto>>(() async {
      final r = await _ch.invokeMethod<dynamic>('queryNewPhotos', {
        'since': sinceEpochSec,
        'limit': limit,
      });
      final list = (r is Map ? r['photos'] as List? : null) ?? const [];
      return list
          .whereType<Map>()
          .map((m) => PhonePhoto.tryParse(m.cast<Object?, Object?>()))
          .whereType<PhonePhoto>()
          .toList();
    }, const <PhonePhoto>[]);
  }

  /// افتح ملفًا محليًا بمشاهده الافتراضي (FileProvider ACTION_VIEW).
  Future<void> openPath(String path) async {
    await _guard<dynamic>(() => _ch.invokeMethod('openPath', {'path': path}), null);
  }

  /// افتح رابطًا (ACTION_VIEW).
  Future<void> openUrl(String url) async {
    await _guard<dynamic>(() => _ch.invokeMethod('openUrl', {'url': url}), null);
  }

  /// ألغِ إشعارًا نشرته الخدمة (بعد معالجة الواجهة للعرض نفسه).
  Future<void> cancelNotif(int id) async {
    await _guard<dynamic>(() => _ch.invokeMethod('cancelNotif', {'id': id}), null);
  }

  /// أخبر الخدمة أن الواجهة حية/غير حية — تقرر نشر إشعارات النصوص بنفسها.
  Future<void> setUiAlive(bool alive) async {
    await _guard<dynamic>(() => _ch.invokeMethod('setUiAlive', {'alive': alive}), null);
  }

  /// فك JSON من تفاصيل حدث (أداة مساعدة).
  static Map<String, dynamic>? decodeDetail(Object? raw) {
    try {
      if (raw is Map) return raw.cast<String, dynamic>();
      if (raw is String) return Map<String, dynamic>.from(jsonDecode(raw));
    } catch (_) {}
    return null;
  }
}
