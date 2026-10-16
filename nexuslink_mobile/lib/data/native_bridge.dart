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
  /// [subPath] اختياري (FA-files §14): مجلد فرعي تحت NexusLink —
  /// مزامنة المجلدات تهبط في Download/NexusLink/Sync/<الزوج>/.
  Future<String?> publishDownload({
    required String tempPath,
    required String displayName,
    String? mime,
    String? subPath,
  }) async {
    return _guard<String?>(() async {
      final r = await _ch.invokeMethod<dynamic>('publishDownload', {
        'tempPath': tempPath,
        'displayName': displayName,
        'mime': mime ?? 'application/octet-stream',
        if (subPath != null && subPath.isNotEmpty) 'subPath': subPath,
      });
      if (r is Map && r['path'] != null) return '${r['path']}';
      return null;
    }, null);
  }

  /// FA-files (عقد §14) — أبلغ الخدمة الدائمة بنقطة وسائط الهاتف (منفذ + رمز)
  /// لتُعلنها في guard:hello-phone {media:{...}} وتُحدّث بعد كل إعادة اتصال.
  Future<bool> setMediaEndpoint(int port, String token) async {
    return _guard<bool>(() async {
      final r = await _ch.invokeMethod<dynamic>('setMediaEndpoint', {
        'port': port,
        'token': token,
      });
      return r == true;
    }, false);
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

  // ------------------------------------------------------------------
  // FA-7 — التحكم عن بعد: الإتاحة + الجلسة
  // ------------------------------------------------------------------

  /// هل خدمة الإتاحة مفعّلة على الهاتف؟ (لشاشة الإرشاد)
  Future<CtlAccessibility> accessibilityStatus() async {
    return _guard<CtlAccessibility>(() async {
      final r = await _ch.invokeMethod<dynamic>('accessibilityStatus');
      if (r is Map) {
        return CtlAccessibility(
          enabled: r['enabled'] == true,
          ready: r['ready'] == true,
        );
      }
      return const CtlAccessibility();
    }, const CtlAccessibility());
  }

  /// افتح إعدادات الإتاحة مباشرة (خطوة الإرشاد).
  Future<void> openAccessibilitySettings() async {
    await _guard<dynamic>(
      () => _ch.invokeMethod('openAccessibilitySettings'),
      null,
    );
  }

  // ------------------------------------------------------------------
  // الجولة 5 (عقد §24/§25) — مشاركة الشاشة + مركز رفع القيود
  // ------------------------------------------------------------------

  /// خدمة أمامية بنوع mediaProjection — شرط أندرويد 14+ للمشاركة.
  /// الترتيب التعاقدي: موافقة Helper.requestCapturePermission أولًا ثم هذه.
  Future<void> startScreenShareService() async {
    await _guard<dynamic>(() => _ch.invokeMethod('startScreenShareService'), null);
  }

  /// إطفاء خدمة مشاركة الشاشة بعد إيقاف البث.
  Future<void> stopScreenShareService() async {
    await _guard<dynamic>(() => _ch.invokeMethod('stopScreenShareService'), null);
  }

  /// فتح صفحة التطبيق في إعدادات النظام (App Info) — البوابة الأولى لمركز
  /// رفع القيود: من فيها قائمة ⋮ ← «السماح بالإعدادات المقيّدة» (أندرويد 13+).
  Future<void> openAppDetails() async {
    await _guard<dynamic>(() => _ch.invokeMethod('openAppDetails'), null);
  }

  /// فحص حالة القيد: هل أندرويد يمنع تفعيل الإتاحة لهذا التطبيق (تثبيت APK)؟
  /// يعيد {restricted: bool, checked: bool} — checked=false إن لم يُستطع الفحص
  /// على هذه النسخة (تحقق أفضل جهد — بلا ادعاء).
  Future<({bool restricted, bool checked})> restrictedSettingsStatus() async {
    return _guard<({bool restricted, bool checked})>(() async {
      final r = await _ch.invokeMethod<dynamic>('restrictedSettingsStatus');
      if (r is Map) {
        return (restricted: r['restricted'] == true, checked: r['checked'] == true);
      }
      return (restricted: false, checked: false);
    }, (restricted: false, checked: false));
  }

  /// لقطة حالة جلسة التحكم من الخدمة (مزامنة عند فتح الواجهة).
  Future<CtlSession> ctlSnapshot() async {
    return _guard<CtlSession>(() async {
      final r = await _ch.invokeMethod<dynamic>('ctlSnapshot');
      if (r is Map) return CtlSession.fromMap(r.cast<Object?, Object?>());
      return const CtlSession();
    }, const CtlSession());
  }

  /// قرار حوار طلب التحكم (سماح/رفض) — يصل للخدمة الخلفية.
  Future<void> ctlDecision(bool allow) async {
    await _guard<dynamic>(
      () => _ch.invokeMethod('ctlDecision', {'allow': allow}),
      null,
    );
  }

  /// زر القطع الفوري من التطبيق.
  Future<void> ctlStop() async {
    await _guard<dynamic>(() => _ch.invokeMethod('ctlStop'), null);
  }

  /// إعداد طلب تأكيد بدء كل جلسة (يُحفظ داخل الخدمة).
  Future<void> setCtlConfirm(bool enabled) async {
    await _guard<dynamic>(
      () => _ch.invokeMethod('setCtlConfirm', {'enabled': enabled}),
      null,
    );
  }

  // ------------------------------------------------------------------
  // FA-8 — الوسائط: إشعار البث + WakeLock مراقبة الأطفال + لقطة الحالة
  // ------------------------------------------------------------------

  /// إشعار «بث نشط» أثناء أي جلسة كاميرا/ميكروفون (البند 1) — يديره Dart.
  Future<void> mediaNotify({required bool show, String title = '', String body = ''}) async {
    await _guard<dynamic>(
      () => _ch.invokeMethod('mediaNotify', {'show': show, 'title': title, 'body': body}),
      null,
    );
  }

  /// WakeLock جزئي طوال مراقبة الأطفال — يبقي البث حيًا والشاشة مطفأة (البند 4).
  Future<void> babyWake(bool on) async {
    await _guard<dynamic>(() => _ch.invokeMethod('babyWake', {'on': on}), null);
  }

  /// لقطة جلسات الوسائط — تُبث فورًا في dev:state.media للويب.
  Future<void> setMediaState(Map<String, Object?> state) async {
    await _guard<dynamic>(() => _ch.invokeMethod('setMediaState', {'state': state}), null);
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

/// حالة خدمة الإتاحة على الهاتف (FA-7 — شاشة الإرشاد).
class CtlAccessibility {
  final bool enabled; // مفعّلة في إعدادات النظام
  final bool ready; // النسخة الحية متصلة (instance != null)
  const CtlAccessibility({this.enabled = false, this.ready = false});
}

/// جلسة تحكم عن بعد كما تعرفها خدمة الوكيل (مصدر الحقيقة على الهاتف).
class CtlSession {
  final bool active;
  final String controller; // معرّف جهاز الكمبيوتر المُتحكم
  final String name; // اسمه المعروض
  final bool requireConfirm; // طلب تأكيد عند بدء كل جلسة
  const CtlSession({
    this.active = false,
    this.controller = '',
    this.name = '',
    this.requireConfirm = true,
  });

  factory CtlSession.fromMap(Map<Object?, Object?> m) => CtlSession(
        active: m['active'] == true,
        controller: '${m['controller'] ?? ''}',
        name: '${m['name'] ?? ''}',
        requireConfirm: m['requireConfirm'] != false,
      );
}
