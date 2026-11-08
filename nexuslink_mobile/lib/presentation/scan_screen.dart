import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/nexus_api.dart';
import '../state/providers.dart';

/// §55 — الماسح الموثق الحي: صفحات JPEG من الهاتف تُدمج في PDF على حاسوب
/// المالك حرفيًا — مرور نقي بلا سحابة ولا وسيط (مقابل Adobe Scan/Google Drive).
/// الدورة: open → page (multipart) → rotate/move/remove → seal → PDF في
/// مجلد الكمبيوتر. السقوف مطابقة للسيرفر: 30 صفحة · 12MB/صفحة · 3 جلسات.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  ScanSession? _session;
  bool _busy = false;
  bool _starting = false;
  String? _error; // رمز سبب حرفي من السيرفر
  final _titleCtrl = TextEditingController();

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  NexusApi? _api() {
    final conn = ref.read(connectionProvider).value;
    final endpoint = conn?.endpoint;
    if (endpoint == null || !(conn?.isOnline ?? false)) return null;
    return NexusApi(endpoint);
  }

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Theme.of(context).colorScheme.errorContainer : null,
    ));
  }

  String _errText(String raw) {
    // رموز السيرفر الحرفية → رسائل مترجمة صادقة (scan-open/page: تُزال البادئة)
    final code = raw.contains(': ') ? raw.split(': ').last : raw;
    const map = {
      'not-found': 'scan.err.notFound',
      'too-many-sessions': 'scan.err.tooManySessions',
      'too-many-pages': 'scan.err.tooManyPages',
      'rate-limited': 'scan.err.rate',
      'not-jpeg': 'scan.err.notJpeg',
      'page-too-large': 'scan.err.tooLarge',
      'no-pages': 'scan.err.noPages',
      'escape-root': 'scan.err.escape',
      'bad-args': 'scan.err.badArgs',
    };
    final key = map[code];
    return key != null ? key.tr() : 'scan.failed'.tr();
  }

  Future<void> _guard(Future<void> Function() fn) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
      _toast(_errText(e.message), error: true);
    } catch (_) {
      _toast('scan.failed'.tr(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ------------------------------------------------------------------
  // الدورة: open → pages → seal
  // ------------------------------------------------------------------

  Future<void> _openSession() async {
    final api = _api();
    if (api == null) {
      _toast('scan.needConnect'.tr(), error: true);
      return;
    }
    await _guard(() async {
      final s = await api.scanOpen(title: _titleCtrl.text.trim());
      api.close();
      HapticFeedback.selectionClick();
      if (!mounted) return;
      setState(() => _session = s);
      ref.read(activityLogProvider.notifier).add('فُتحت جلسة مسح: ${s.title.isEmpty ? s.id : s.title}', kind: 'ok');
    });
  }

  Future<void> _addPages() async {
    final session = _session;
    if (session == null || _busy) return;
    if (session.pages.length >= 30) {
      _toast('scan.err.tooManyPages'.tr(), error: true);
      return;
    }
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: true,
      withData: false,
      lockParentWindow: true,
    );
    final files = picked?.files ?? const <PlatformFile>[];
    if (files.isEmpty) return;
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      var added = 0;
      for (final f in files) {
        if (_session == null) break; // أُلغيت الجلسة أثناء الرفع
        final List<int> bytes;
        if (f.path != null) {
          bytes = await File(f.path!).readAsBytes();
        } else if (f.bytes != null) {
          bytes = f.bytes!;
        } else {
          continue;
        }
        // فحص السحر محليًا مطابقًا للسيرفر: JPEG يبدأ FF D8 FF — نُخطر مبكرًا
        if (bytes.length < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes[2] != 0xFF) {
          _toast('scan.err.notJpegNamed'.tr(namedArgs: {'name': f.name}), error: true);
          continue;
        }
        await api.scanAddPage(_session!.id, fileName: f.name, bytes: bytes);
        added++;
      }
      final fresh = await api.scanGet(_session!.id);
      api.close();
      if (!mounted) return;
      setState(() => _session = fresh);
      HapticFeedback.selectionClick();
      ref.read(activityLogProvider.notifier).add('رُفعت $added صفحة إلى جلسة الماسح', kind: 'ok');
    });
  }

  Future<void> _rotate(ScanPage p) async {
    final session = _session;
    if (session == null) return;
    final next = switch (p.rotate) { 0 => 90, 90 => 180, 180 => 270, _ => 0 };
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      final s = await api.scanAct(session.id, action: 'rotate', args: {'n': p.n, 'deg': next});
      api.close();
      if (!mounted) return;
      setState(() => _session = s);
    });
  }

  Future<void> _move(ScanPage p, int delta) async {
    final session = _session;
    if (session == null) return;
    // السيرفر يستقبل من/إلى على مؤشر القائمة الصفري (من صفر)
    final from = session.pages.indexWhere((x) => x.n == p.n);
    final to = from + delta;
    if (from < 0 || to < 0 || to >= session.pages.length) return;
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      final s = await api.scanAct(session.id, action: 'move', args: {'from': from, 'to': to});
      api.close();
      if (!mounted) return;
      setState(() => _session = s);
    });
  }

  Future<void> _remove(ScanPage p) async {
    final session = _session;
    if (session == null) return;
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      final s = await api.scanAct(session.id, action: 'remove', args: {'n': p.n});
      api.close();
      if (!mounted) return;
      setState(() => _session = s);
    });
  }

  Future<void> _seal() async {
    final session = _session;
    if (session == null || session.pages.isEmpty) {
      _toast('scan.err.noPages'.tr(), error: true);
      return;
    }
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      final r = await api.scanSeal(session.id);
      api.close();
      HapticFeedback.mediumImpact();
      if (!mounted) return;
      ref.read(activityLogProvider.notifier).add(
            'خُتم PDF: ${r.pages} صفحة · ${r.bytes} باية — على الكمبيوتر',
            kind: 'ok',
          );
      showDialog<void>(context: context, builder: (_) => _SealDialog(seal: r));
    });
  }

  Future<void> _cancelSession() async {
    final session = _session;
    if (session == null) return;
    await _guard(() async {
      final api = _api();
      if (api == null) throw ApiException('not-found');
      await api.scanCancel(session.id);
      api.close();
      if (!mounted) return;
      setState(() => _session = null);
      _toast('scan.cancelled'.tr());
    });
  }

  // ------------------------------------------------------------------
  // الواجهة
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final conn = ref.watch(connectionProvider).value;
    final online = conn?.isOnline ?? false;
    final session = _session;

    return Scaffold(
      appBar: AppBar(
        title: Text('scan.title'.tr()),
        actions: [
          if (session != null && session.status == 'open') ...[
            IconButton(
              tooltip: 'scan.addPages'.tr(),
              onPressed: _busy ? null : _addPages,
              icon: const Icon(Icons.add_photo_alternate_rounded),
            ),
            IconButton(
              tooltip: 'scan.cancelSession'.tr(),
              onPressed: _busy ? null : _cancelSession,
              icon: const Icon(Icons.delete_sweep_rounded),
            ),
          ],
        ],
      ),
      body: !online
          ? _Notice(text: 'scan.needConnect'.tr())
          : session == null
              ? _StartCard(
                  titleCtrl: _titleCtrl,
                  starting: _starting,
                  busy: _busy,
                  onStart: _openSession,
                )
              : _busy && session.pages.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : _SessionView(
                      session: session,
                      busy: _busy,
                      error: _error,
                      cs: cs,
                      onRotate: _rotate,
                      onMoveUp: (p) => _move(p, -1),
                      onMoveDown: (p) => _move(p, 1),
                      onRemove: _remove,
                      onSeal: _seal,
                    ),
      floatingActionButton: (online && session != null && session.status == 'open' && session.pages.isNotEmpty)
          ? FloatingActionButton.extended(
              heroTag: 'scan_seal',
              onPressed: _busy ? null : _seal,
              icon: const Icon(Icons.picture_as_pdf_rounded),
              label: Text('scan.seal'.tr()),
            )
          : null,
    );
  }
}

// ---------------------------------------------------------------------------
// بطاقة البدء: عنوان + فتح جلسة
// ---------------------------------------------------------------------------

class _StartCard extends StatelessWidget {
  final TextEditingController titleCtrl;
  final bool starting;
  final bool busy;
  final VoidCallback onStart;

  const _StartCard({required this.titleCtrl, required this.starting, required this.busy, required this.onStart});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.document_scanner_rounded, size: 64, color: cs.primary),
            const SizedBox(height: 12),
            Text('scan.intro'.tr(), textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              'scan.limits'.tr(namedArgs: {'pages': '30', 'mb': '12'}),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.outline),
            ),
            const SizedBox(height: 18),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: TextField(
                controller: titleCtrl,
                maxLength: 60,
                decoration: InputDecoration(
                  labelText: 'scan.titleLabel'.tr(),
                  hintText: 'scan.titleHint'.tr(),
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: busy ? null : onStart,
              icon: const Icon(Icons.play_arrow_rounded),
              label: Text('scan.openSession'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// عرض الجلسة: صفحات + أفعال + ختم
// ---------------------------------------------------------------------------

class _SessionView extends StatelessWidget {
  final ScanSession session;
  final bool busy;
  final String? error;
  final ColorScheme cs;
  final Future<void> Function(ScanPage) onRotate;
  final Future<void> Function(ScanPage) onMoveUp;
  final Future<void> Function(ScanPage) onMoveDown;
  final Future<void> Function(ScanPage) onRemove;
  final VoidCallback onSeal;

  const _SessionView({
    required this.session,
    required this.busy,
    required this.error,
    required this.cs,
    required this.onRotate,
    required this.onMoveUp,
    required this.onMoveDown,
    required this.onRemove,
    required this.onSeal,
  });

  String _fmtSize(int bytes) {
    if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    if (bytes >= 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '$bytes B';
  }

  @override
  Widget build(BuildContext context) {
    final pages = session.pages;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      children: [
        Row(children: [
          Expanded(
            child: Text(
              session.title.isEmpty ? 'scan.sessionNoTitle'.tr() : session.title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          Text('${pages.length} / 30', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.outline)),
        ]),
        const SizedBox(height: 8),
        if (error != null)
          Card(
            color: cs.errorContainer,
            child: Padding(padding: const EdgeInsets.all(10), child: Text('scan.failed'.tr())),
          ),
        if (pages.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Column(children: [
              Icon(Icons.add_photo_alternate_outlined, size: 48, color: cs.outline),
              const SizedBox(height: 8),
              Text('scan.empty'.tr(), textAlign: TextAlign.center),
            ]),
          )
        else
          for (var i = 0; i < pages.length; i++)
            Card(
              child: ListTile(
                leading: CircleAvatar(child: Text('${pages[i].n}')),
                title: Text(pages[i].name, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${_fmtSize(pages[i].size)} · ${pages[i].rotate}°'),
                trailing: SizedBox(
                  width: 148,
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(
                      tooltip: 'scan.moveUp'.tr(),
                      onPressed: busy || i == 0 ? null : () => onMoveUp(pages[i]),
                      icon: const Icon(Icons.arrow_upward_rounded, size: 20),
                    ),
                    IconButton(
                      tooltip: 'scan.moveDown'.tr(),
                      onPressed: busy || i == pages.length - 1 ? null : () => onMoveDown(pages[i]),
                      icon: const Icon(Icons.arrow_downward_rounded, size: 20),
                    ),
                    IconButton(
                      tooltip: 'scan.rotate'.tr(),
                      onPressed: busy ? null : () => onRotate(pages[i]),
                      icon: const Icon(Icons.rotate_right_rounded, size: 20),
                    ),
                    IconButton(
                      tooltip: 'scan.remove'.tr(),
                      onPressed: busy ? null : () => onRemove(pages[i]),
                      icon: Icon(Icons.close_rounded, size: 20, color: cs.error),
                    ),
                  ]),
                ),
              ),
            ),
        if (session.status == 'sealed' && session.sealedFile != null) ...[
          const SizedBox(height: 12),
          Card(
            color: cs.secondaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(children: [
                const Icon(Icons.check_circle_rounded),
                const SizedBox(width: 10),
                Expanded(child: Text('scan.sealedTo'.tr(namedArgs: {'file': session.sealedFile!}))),
              ]),
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// حوار نتيجة الختم
// ---------------------------------------------------------------------------

class _SealDialog extends StatelessWidget {
  final ScanSeal seal;
  const _SealDialog({required this.seal});

  String _fmtSize(int bytes) {
    if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / 1024).toStringAsFixed(0)} KB';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return AlertDialog(
      icon: const Icon(Icons.task_alt_rounded),
      title: Text('scan.sealedTitle'.tr()),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('scan.sealedBody'.tr(namedArgs: {'pages': '${seal.pages}', 'size': _fmtSize(seal.bytes)})),
          const SizedBox(height: 10),
          Text(seal.file, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.outline)),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('scan.ok'.tr()),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// إشعار بلا اتصال
// ---------------------------------------------------------------------------

class _Notice extends StatelessWidget {
  final String text;
  const _Notice({required this.text});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.link_off_rounded, size: 48, color: cs.outline),
            const SizedBox(height: 10),
            Text(text, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
