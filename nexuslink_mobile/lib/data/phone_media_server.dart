// NexusLink — خدمة وسائط الهاتف (FA-files عقد §14)
// ============================================================
// خادم HTTP خالص (dart:io) على الشبكة المحلية يخدم ملفات الهاتف الحقيقية
// للكمبيوتر: قائمة/تصفح + بث فيديو/صوت بدعم Range كامل (206).
// · رمز وصول عشوائي 32 خانة يُولَّد عند كل إقلاع — يُعلَن للسيرفر عبر
//   guard:hello-phone {media:{port, token}} (يمر عبر MethodChannel للخدمة الدائمة).
// · CORS مفتوح (واجهة الكمبيوتر تصل مباشرة من أصل :3000).
// · القيود موثقة بصدق: تعمل أثناء حياة التطبيق (الواجهة أو الخدمة الأمامية).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

class PhoneMediaServer {
  PhoneMediaServer._();
  static final PhoneMediaServer instance = PhoneMediaServer._();

  HttpServer? _server;
  String token = '';
  int port = 0;

  static const String announceEvent = 'guard:media';

  String get endpoint => 'http://0.0.0.0:$port';

  /// إقلاع idempotent — يعيد نفس الخدمة إن كانت حية.
  Future<void> start({int preferredPort = 3010}) async {
    if (_server != null) return;
    if (token.isEmpty) token = _genToken();
    try {
      _server = await HttpServer.bind(InternetAddress.anyIPv4, preferredPort);
    } on SocketException {
      // المنفذ مشغول (نسخة ثانية؟) — جرّب منافذ بديلة
      _server = await HttpServer.bind(InternetAddress.anyIPv4, 0);
    }
    port = _server!.port;
    _server!.listen((req) {
      // طلب واحد = إجابة واحدة — أخطاء لا تُسقط الخدمة
      _handle(req).catchError((_) {
        try {
          req.response.statusCode = HttpStatus.internalServerError;
          req.response.close();
        } catch (_) {}
      });
    });
    // ignore: avoid_print
    print('[media-server] على المنفذ $port (رمز ${token.length} خانة)');
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
    port = 0;
  }

  String _genToken() {
    final rnd = Random.secure();
    return List.generate(32, (_) => '0123456789abcdef'[rnd.nextInt(16)]).join();
  }

  bool _authorized(HttpRequest req) {
    final t = req.uri.queryParameters['token'] ?? '';
    if (t.length < 8) return false;
    // مقارنة ثابتة الزمن مبسطة — الشبكة محلية والرمز عشوائي لكل إقلاع
    var diff = 0;
    for (var i = 0; i < t.length && i < token.length; i++) {
      diff |= t.codeUnitAt(i) ^ token.codeUnitAt(i);
    }
    return diff == 0 && t.length == token.length;
  }

  Future<void> _handle(HttpRequest req) async {
    final res = req.response;
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method == 'OPTIONS') {
      res.statusCode = HttpStatus.noContent;
      await res.close();
      return;
    }
    if (!_authorized(req)) {
      res.statusCode = HttpStatus.forbidden;
      res.headers.set('Content-Type', 'application/json; charset=utf-8');
      res.write(jsonEncode({'ok': false, 'error': 'رمز وصول غير صالح'}));
      await res.close();
      return;
    }

    switch (req.uri.path) {
      case '/health':
        _json(res, {'ok': true, 'service': 'nexus-phone-media', 'at': DateTime.now().millisecondsSinceEpoch});
        return;
      case '/list':
        await _list(req, res);
        return;
      case '/stream':
        await _stream(req, res);
        return;
      default:
        res.statusCode = HttpStatus.notFound;
        _json(res, {'ok': false, 'error': 'مسار غير معروف'});
    }
  }

  void _json(HttpResponse res, Map<String, dynamic> j) {
    res.headers.set('Content-Type', 'application/json; charset=utf-8');
    res.write(jsonEncode(j));
    res.close();
  }

  Future<void> _list(HttpRequest req, HttpResponse res) async {
    final dirPath = req.uri.queryParameters['dir'] ?? '/storage/emulated/0/Movies';
    final dir = Directory(dirPath);
    final entries = <Map<String, dynamic>>[];
    try {
      await for (final e in dir.list(followLinks: false)) {
        try {
          final st = await e.stat();
          final name = e.path.split('/').where((s) => s.isNotEmpty).last;
          if (name.startsWith('.')) continue;
          final isDir = st.type == FileSystemEntityType.directory;
          final video = !isDir && _isVideo(name);
          if (!isDir && !video) continue; // قائمة الوسائط: مجلدات + فيديو فقط
          entries.add({
            'name': name,
            'path': e.path,
            'isDir': isDir,
            'size': isDir ? 0 : st.size,
            'mtime': st.modified.millisecondsSinceEpoch,
            'video': video,
          });
        } catch (_) {/* إدخال غير مقروء — تخطَّ */}
      }
      entries.sort((a, b) {
        if (a['isDir'] != b['isDir']) return a['isDir'] ? -1 : 1;
        return (a['name'] as String).toLowerCase().compareTo((b['name'] as String).toLowerCase());
      });
      _json(res, {'ok': true, 'dir': dirPath, 'entries': entries});
    } catch (e) {
      res.statusCode = HttpStatus.badRequest;
      _json(res, {'ok': false, 'error': 'تعذر قراءة المجلد: $e'});
    }
  }

  bool _isVideo(String name) {
    const exts = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.3gp', '.ts'];
    final n = name.toLowerCase();
    return exts.any(n.endsWith);
  }

  /// بث بدعم Range كامل — 206 + Content-Range (نفس عقد /api/preview §3.2).
  Future<void> _stream(HttpRequest req, HttpResponse res) async {
    final p = req.uri.queryParameters['path'] ?? '';
    if (p.isEmpty || p.contains('..')) {
      res.statusCode = HttpStatus.badRequest;
      _json(res, {'ok': false, 'error': 'مسار غير صالح'});
      return;
    }
    final f = File(p);
    if (!await f.exists()) {
      res.statusCode = HttpStatus.notFound;
      _json(res, {'ok': false, 'error': 'الملف غير موجود'});
      return;
    }
    final len = await f.length();
    final mime = _mimeOf(p);
    res.headers.set('Accept-Ranges', 'bytes');
    res.headers.set('Content-Type', mime);

    var start = 0;
    var end = len - 1;
    final range = req.headers.value('range');
    if (range != null) {
      final m = RegExp(r'bytes=(\d*)-(\d*)').firstMatch(range);
      if (m != null) {
        if (m.group(1)!.isNotEmpty) start = int.parse(m.group(1)!);
        if (m.group(2)!.isNotEmpty) end = int.parse(m.group(2)!);
        if (start > end || start >= len) {
          res.statusCode = HttpStatus.requestedRangeNotSatisfiable;
          res.headers.set('Content-Range', 'bytes */$len');
          await res.close();
          return;
        }
      }
    }
    final partial = range != null;
    res.statusCode = partial ? HttpStatus.partialContent : HttpStatus.ok;
    res.headers.set('Content-Range', 'bytes $start-$end/$len');
    res.contentLength = end - start + 1;
    await res.addStream(f.openRead(start, end + 1));
    await res.close();
  }

  String _mimeOf(String p) {
    const map = {
      '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
      '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.3gp': 'video/3gpp', '.ts': 'video/mp2t',
    };
    final n = p.toLowerCase();
    for (final k in map.keys) {
      if (n.endsWith(k)) return map[k]!;
    }
    return 'application/octet-stream';
  }
}
