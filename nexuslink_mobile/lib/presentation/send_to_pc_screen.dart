import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/nexus_api.dart';
import '../state/providers.dart';

/// §53 — التسليم اليدوي الذكي: «أرسل إلى الحاسوب».
/// نص أو رابط من الهاتف يهبط جرس الشريط العلوي على حاسوب المالك حرفيًا —
/// محليًا عبر شبكتك، بلا حساب ولا سحابة ولا وسيط (خندق الخصوصية المعمارية).
/// التحقق المحلي مرآة للسيرفر: رابط http/https ≤2048 · نص ≤8192.
class SendToPcScreen extends ConsumerStatefulWidget {
  const SendToPcScreen({super.key});

  @override
  ConsumerState<SendToPcScreen> createState() => _SendToPcScreenState();
}

class _SendToPcScreenState extends ConsumerState<SendToPcScreen> {
  final _payloadCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  bool _sending = false;

  bool get _isUrl {
    final t = _payloadCtrl.text.trim();
    return t.startsWith('http://') || t.startsWith('https://');
  }

  bool get _valid {
    final t = _payloadCtrl.text.trim();
    if (t.isEmpty) return false;
    if (_isUrl) return t.length <= 2048;
    return t.length <= 8192;
  }

  @override
  void dispose() {
    _payloadCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
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
    final payload = _payloadCtrl.text.trim();
    final kind = _isUrl ? 'url' : 'text';
    try {
      final api = NexusApi(endpoint);
      await api.handoffPush(
        kind: kind,
        payload: payload,
        note: _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim(),
        sourceDevice: conn?.me?.name,
      );
      api.close();
      ref.read(activityLogProvider.notifier).add(
            'أُرسل إلى الحاسوب (${kind == 'url' ? 'رابط' : 'نص'}، ${payload.length} محرفًا)',
            kind: 'ok',
          );
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

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final conn = ref.watch(connectionProvider).value;
    final online = conn?.isOnline ?? false;
    final len = _payloadCtrl.text.trim().length;
    final max = _isUrl ? 2048 : 8192;

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
            const SizedBox(height: 12),
            TextField(
              controller: _payloadCtrl,
              minLines: 3,
              maxLines: 8,
              maxLength: max,
              autofocus: true,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'handoff.payload'.tr(),
                hintText: 'handoff.payloadHint'.tr(),
                border: const OutlineInputBorder(),
                counterText: '$len / $max',
              ),
            ),
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
