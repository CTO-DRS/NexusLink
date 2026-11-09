import 'dart:io' show Platform;

import 'package:easy_localization/easy_localization.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/nexus_api.dart';
import '../state/providers.dart';

/// §53 — التسليم اليدوي الذكي: «أرسل إلى الحاسوب».
/// §60 — أنواع الدفع الكاملة من الهاتف: الأنواع الأربعة التي تعرفها نواة §53
/// كلها من الهاتف — رابط · نص · مرجع ملف (منتقي ملفات حقيقي) · موضع وسائط
/// (اسم + موضع بالثواني مع معاينة m:ss). إغلاق الحد المعلن من §56 حرفيًا:
/// ما تنسخه أو تتصفحه أو تشغّله على هاتفك يصل جرس الكمبيوتر بلمستين —
/// محليًا عبر شبكتك، بلا حساب ولا سحابة ولا وسيط (خندق الخصوصية المعمارية).
/// التحقق المحلي مرآة للسيرفر: رابط ≤2048 · نص ≤8192 · مرجع ≤512 ·
/// موضع وسائط JSON سليم (اسم ≤200 وموضع 0..86400000 مللي ثانية).
enum _SendKind { url, text, ref, media }

class SendToPcScreen extends ConsumerStatefulWidget {
  const SendToPcScreen({super.key});

  @override
  ConsumerState<SendToPcScreen> createState() => _SendToPcScreenState();
}

class _SendToPcScreenState extends ConsumerState<SendToPcScreen> {
  final _payloadCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  final _refCtrl = TextEditingController();
  final _mediaCtrl = TextEditingController();
  final _posCtrl = TextEditingController();
  _SendKind _kind = _SendKind.text;
  bool _sending = false;
  String _pickedName = '';

  static const _urlMax = 2048;
  static const _textMax = 8192;
  static const _refMax = NexusApi.handoffRefMax; // 512
  static const _mediaMax = NexusApi.handoffMediaMax; // 200
  static const _positionMaxSec = NexusApi.handoffPositionMaxMs ~/ 1000; // 86400

  int get _maxFor {
    switch (_kind) {
      case _SendKind.url:
        return _urlMax;
      case _SendKind.text:
        return _textMax;
      case _SendKind.ref:
        return _refMax;
      case _SendKind.media:
        return _mediaMax;
    }
  }

  /// الموضع المدخل بالثواني — null إن لم يكن صحيحًا ضمن السقف.
  int? get _positionSec {
    final p = int.tryParse(_posCtrl.text.trim());
    if (p == null || p < 0 || p > _positionMaxSec) return null;
    return p;
  }

  String get _mediaPreview {
    final s = _positionSec;
    if (s == null) return '—';
    final mm = s ~/ 60;
    final ss = (s % 60).toString().padLeft(2, '0');
    return '$mm:$ss';
  }

  bool get _valid {
    final t = _payloadCtrl.text.trim();
    switch (_kind) {
      case _SendKind.url:
        if (t.isEmpty || t.length > _urlMax) return false;
        final u = Uri.tryParse(t);
        return u != null && (u.scheme == 'http' || u.scheme == 'https') && u.host.isNotEmpty;
      case _SendKind.text:
        return t.isNotEmpty && t.length <= _textMax;
      case _SendKind.ref:
        final r = _refCtrl.text.trim();
        return r.isNotEmpty && r.length <= _refMax;
      case _SendKind.media:
        final m = _mediaCtrl.text.trim();
        return m.isNotEmpty && m.length <= _mediaMax && _positionSec != null;
    }
  }

  @override
  void dispose() {
    _payloadCtrl.dispose();
    _noteCtrl.dispose();
    _refCtrl.dispose();
    _mediaCtrl.dispose();
    _posCtrl.dispose();
    super.dispose();
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData('text/plain');
    final t = data?.text?.trim() ?? '';
    if (t.isEmpty) {
      _toast('handoff.clipboardEmpty'.tr(), error: true);
      return;
    }
    // الحافظة قد تتجاوز السقوف — نقص بصدق حتى السقف المسموح للنوع الحالي،
    // وكشف تلقائي: ما يبدأ http/https يفتح على نوع الرابط (نمط §56 الموروث).
    final capped = t.length > _maxFor ? t.substring(0, _maxFor) : t;
    setState(() {
      if (t.startsWith('http://') || t.startsWith('https://')) _kind = _SendKind.url;
      _payloadCtrl.text = capped;
    });
    HapticFeedback.selectionClick();
  }

  /// §60.ب — منتقي ملفات حقيقي: مسار الملف على الهاتف هو «مرجع الملف» الذي
  /// يهبط جرس الكمبيوتر (المعاينة هناك اسم الملف الأخير — handoffPreview §53).
  Future<void> _pickFile() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.any,
      withData: false,
      lockParentWindow: true,
    );
    final f = picked?.files.single;
    final path = f?.path;
    if (path == null || path.isEmpty) {
      if (picked != null && (picked.files.isNotEmpty)) _toast('handoff.noFile'.tr(), error: true);
      return;
    }
    // المرجع فوق سقفه يُقبل بالمنتقي نادرًا (مسارات أندرويد قصيرة) — القص
    // الصادق لا يخفي الحقيقة: نعرض الاسم ونبقي المسار كاملًا والزر يعطّل نفسه.
    setState(() {
      _refCtrl.text = path;
      _pickedName = f?.name ?? path.split('/').last;
    });
    HapticFeedback.selectionClick();
  }

  Future<void> _send() async {
    if (_sending || !_valid) return;
    final conn = ref.read(connectionProvider).value;
    final endpoint = conn?.endpoint;
    if (endpoint == null || !(conn?.isOnline ?? false)) {
      _toast('handoff.needConnect'.tr(), error: true);
      return;
    }
    setState(() => _sending = true);
    final note = _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim();
    final source = conn?.me?.name;
    final api = NexusApi(endpoint);
    try {
      String activity;
      switch (_kind) {
        case _SendKind.url:
          await api.handoffPush(
              kind: 'url', payload: _payloadCtrl.text.trim(), note: note, sourceDevice: source);
          activity = 'أُرسل إلى الحاسوب (رابط، ${_payloadCtrl.text.trim().length} محرفًا)';
          break;
        case _SendKind.text:
          await api.handoffPush(
              kind: 'text', payload: _payloadCtrl.text.trim(), note: note, sourceDevice: source);
          activity = 'أُرسل إلى الحاسوب (نص، ${_payloadCtrl.text.trim().length} محرفًا)';
          break;
        case _SendKind.ref:
          final r = _refCtrl.text.trim();
          await api.handoffPushFileRef(ref: r, note: note, sourceDevice: source);
          activity = 'أُرسل إلى الحاسوب (ملف، ${r.split(Platform.isWindows ? '\\' : '/').last})';
          break;
        case _SendKind.media:
          final m = _mediaCtrl.text.trim();
          await api.handoffPushMediaPosition(
              media: m, positionMs: _positionSec! * 1000, note: note, sourceDevice: source);
          activity = 'أُرسل إلى الحاسوب (وسائط، $_mediaPreview)';
          break;
      }
      api.close();
      ref.read(activityLogProvider.notifier).add(activity, kind: 'ok');
      HapticFeedback.mediumImpact();
      if (!mounted) return;
      _toast('handoff.sent'.tr());
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      _toast(_errorText(e.message), error: true);
    } catch (e) {
      if (!mounted) return;
      _toast('handoff.failed'.tr(), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _errorText(String code) {
    // أسباب مغلقة مطابقة للسيرفر حرفيًا — ترجمة صادقة لكل سبب
    const map = {
      'empty-payload': 'handoff.err.empty',
      'url-scheme': 'handoff.err.scheme',
      'url-too-long': 'handoff.err.tooLong',
      'url-no-host': 'handoff.err.noHost',
      'text-too-long': 'handoff.err.tooLong',
      'ref-too-long': 'handoff.err.refLong',
      'bad-media-position': 'handoff.err.mediaBad',
      'unknown-kind': 'handoff.err.empty',
      'rate-limited': 'handoff.err.rate',
    };
    final key = map[code];
    return key != null ? key.tr() : 'handoff.failed'.tr();
  }

  void _toast(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Theme.of(context).colorScheme.errorContainer : null,
    ));
  }

  Widget _kindChip(_SendKind k, IconData icon, String label) {
    final cs = Theme.of(context).colorScheme;
    final selected = _kind == k;
    return ChoiceChip(
      selected: selected,
      label: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 15, color: selected ? cs.onPrimary : cs.outline),
        const SizedBox(width: 5),
        Text(label),
      ]),
      onSelected: (_) => setState(() => _kind = k),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final conn = ref.watch(connectionProvider).value;
    final online = conn?.isOnline ?? false;

    return Scaffold(
      appBar: AppBar(title: Text('handoff.title'.tr())),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  Icon(Icons.computer_rounded, color: cs.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      online
                          ? 'handoff.targetNamed'.tr(namedArgs: {'name': conn?.serverName ?? 'PC'})
                          : 'handoff.needConnect'.tr(),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
                  Icon(
                    online ? Icons.circle : Icons.circle_outlined,
                    size: 12,
                    color: online ? Colors.green : cs.outline,
                  ),
                ]),
              ),
            ),
            const SizedBox(height: 10),
            // §60.ب — منتقي النوع: الأنواع الأربعة لنواة §53 كلها من الهاتف
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                _kindChip(_SendKind.url, Icons.link_rounded, 'handoff.kindUrl'.tr()),
                _kindChip(_SendKind.text, Icons.subject_rounded, 'handoff.kindText'.tr()),
                _kindChip(_SendKind.ref, Icons.file_open_rounded, 'handoff.kindRef'.tr()),
                _kindChip(_SendKind.media, Icons.play_circle_rounded, 'handoff.kindMedia'.tr()),
              ],
            ),
            const SizedBox(height: 10),
            // حقل الحمولة حسب النوع
            if (_kind == _SendKind.url || _kind == _SendKind.text) ...[
              TextField(
                controller: _payloadCtrl,
                minLines: 3,
                maxLines: 8,
                maxLength: _maxFor,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'handoff.payload'.tr(),
                  hintText: 'handoff.payloadHint'.tr(),
                  border: const OutlineInputBorder(),
                  counterText: '${_payloadCtrl.text.trim().length} / $_maxFor',
                ),
              ),
            ] else if (_kind == _SendKind.ref) ...[
              TextField(
                controller: _refCtrl,
                maxLength: _refMax,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'handoff.kindRef'.tr(),
                  hintText: 'handoff.refHint'.tr(),
                  border: const OutlineInputBorder(),
                  counterText: '${_refCtrl.text.trim().length} / $_refMax',
                ),
              ),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  onPressed: _pickFile,
                  icon: const Icon(Icons.folder_open_rounded, size: 18),
                  label: Text(_pickedName.isEmpty
                      ? 'handoff.pickFile'.tr()
                      : 'handoff.filePicked'.tr(namedArgs: {'name': _pickedName})),
                ),
              ),
            ] else ...[
              TextField(
                controller: _mediaCtrl,
                maxLength: _mediaMax,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'handoff.mediaName'.tr(),
                  hintText: 'handoff.mediaNameHint'.tr(),
                  border: const OutlineInputBorder(),
                  counterText: '${_mediaCtrl.text.trim().length} / $_mediaMax',
                ),
              ),
              const SizedBox(height: 8),
              Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Expanded(
                  child: TextField(
                    controller: _posCtrl,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    maxLength: 5,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: 'handoff.positionLabel'.tr(),
                      hintText: 'handoff.positionHint'.tr(),
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Text(
                    _mediaPreview,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: _positionSec == null && _posCtrl.text.isNotEmpty
                              ? cs.error
                              : cs.primary,
                        ),
                  ),
                ),
              ]),
            ],
            const SizedBox(height: 10),
            TextField(
              controller: _noteCtrl,
              maxLength: 200,
              decoration: InputDecoration(
                labelText: 'handoff.note'.tr(),
                hintText: 'handoff.noteHint'.tr(),
                border: const OutlineInputBorder(),
              ),
            ),
            // §56.ج — الحافظة بنقرة (للرابط والنص): ما نسخته على هاتفك يصل
            // الكمبيوتر — تعبئة الحقل من الحافظة المحلية بالمسار الموثق نفسه.
            if (_kind == _SendKind.url || _kind == _SendKind.text)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  onPressed: _pasteFromClipboard,
                  icon: const Icon(Icons.content_paste_rounded, size: 18),
                  label: Text('handoff.paste'.tr()),
                ),
              ),
            const Spacer(),
            FilledButton.icon(
              onPressed: (online && _valid && !_sending) ? _send : null,
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send_rounded),
              label: Text(_sending ? 'handoff.sending'.tr() : 'handoff.send'.tr()),
            ),
            const SizedBox(height: 4),
            Text(
              'handoff.privacyNote'.tr(),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.outline),
            ),
          ],
        ),
      ),
    );
  }
}
