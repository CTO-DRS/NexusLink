import 'dart:io';
import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../data/cloud_mode.dart';
import '../data/developer_banners.dart';
import '../state/transfer_providers.dart';
import 'developer_card.dart';

const _linkIds = {'wa': 'whatsapp', 'tg': 'telegram', 'tt': 'tiktok', 'ig': 'instagram', 'x': 'x', 'yt': 'youtube', 'gh': 'github', 'web': 'website'};

/// الوضع السحابي: صفحة روابط مستضافة مع إحصاءات. مُعطَّل افتراضيًا؛ لا طلب شبكة قبل التفعيل والموافقة على الإفصاح.
class CloudModeCard extends ConsumerStatefulWidget {
  const CloudModeCard({super.key});
  @override
  ConsumerState<CloudModeCard> createState() => _CloudModeCardState();
}

class _CloudModeCardState extends ConsumerState<CloudModeCard> {
  CloudState _s = const CloudState();
  CloudStats? _stats;
  bool _busy = false;
  final _handle = TextEditingController();

  @override
  void initState() {
    super.initState();
    loadCloud().then((v) {
      if (!mounted) return;
      setState(() => _s = v);
      _handle.text = v.handle;
      if (v.enabled && v.publishedUrl != null) _loadStats();
    });
  }

  @override
  void dispose() {
    _handle.dispose();
    super.dispose();
  }

  Future<void> _set(CloudState v) async {
    setState(() => _s = v);
    await saveCloud(v);
  }

  Future<void> _copyKey() async {
    if (_s.token.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: _s.token));
    _snack('settings.cloud_key_copied');
  }

  Future<void> _useKey() async {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('settings.cloud_use_key'.tr()),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('settings.cloud_use_key_hint'.tr(), style: const TextStyle(fontSize: 12)),
          const SizedBox(height: 10),
          TextField(controller: c, obscureText: true, autocorrect: false, enableSuggestions: false, textDirection: ui.TextDirection.ltr, decoration: const InputDecoration(border: OutlineInputBorder())),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text('settings.cloud_cancel'.tr())),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: Text('settings.cloud_use_key_ok'.tr())),
        ],
      ),
    );
    c.dispose();
    if (v == null) return;
    if (v.length < 32 || v.length > 128 || !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(v)) {
      _snack('settings.cloud_key_bad');
      return;
    }
    await _set(_s.copy(token: v));
    _snack('settings.cloud_key_saved');
  }

  void _snack(String key) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(key.tr())));
  }

  Future<void> _loadStats() async {
    try {
      final st = await cloudStats(_s);
      if (mounted) setState(() => _stats = st);
    } catch (_) {}
  }

  Future<void> _toggle(bool on) async {
    if (!on) {
      await _set(_s.copy(enabled: false));
      return;
    }
    final ok = await showDialog<bool>(context: context, builder: (_) => const _DisclosureDialog()) ?? false;
    if (!ok) return;
    await _set(_s.copy(enabled: true, acceptedAt: DateTime.now().millisecondsSinceEpoch, token: _s.token.isEmpty ? newCloudToken() : _s.token));
  }

  Map<String, dynamic> _page(String photo) {
    final lang = context.locale.languageCode == 'ar' ? 'ar' : 'en';
    return {
      'name': 'CTO: DRS',
      'role': 'settings.cloud_role'.tr(),
      'photo': photo,
      'lang': lang,
      'theme': ref.read(devThemeProvider),
      'animated': true,
      'capture': {'enabled': _s.capture, 'label': 'settings.cloud_form_label'.tr(), 'consent': 'settings.cloud_form_consent'.tr()},
      'links': [
        for (final l in DeveloperCard.linkData)
          {
            'id': _linkIds[l.$1.split('_').last] ?? l.$1.split('_').last,
            'label': l.$1 == 'settings.dev_gh' ? 'GitHub' : l.$1.tr(),
            'url': l.$4,
            'color': '#${(l.$3.value & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}',
          }
      ],
      'banners': [
        for (final b in activeBanners())
          {
            'id': b.id,
            'title': b.titleKey.tr(),
            'body': b.bodyKey.tr(),
            'cta': b.ctaKey.tr(),
            'url': b.url,
            'startsAt': b.startsAt == null ? null : b.startsAt!.millisecondsSinceEpoch ~/ 1000,
            'endsAt': b.endsAt == null ? null : b.endsAt!.millisecondsSinceEpoch ~/ 1000,
          }
      ],
    };
  }

  Future<void> _publish() async {
    final h = _handle.text.trim().toLowerCase();
    if (!cloudHandleOk(h)) {
      _snack('settings.cloud_bad_handle');
      return;
    }
    setState(() => _busy = true);
    try {
      final s = _s.copy(handle: h);
      final photo = await cloudPhotoDataUrl();
      if (!mounted) return;
      final url = await cloudPublish(s, _page(photo));
      await _set(s.copy(publishedUrl: url));
      _snack('settings.cloud_published');
      _loadStats();
    } on CloudException catch (e) {
      _snack(e.status == 403 ? 'settings.cloud_taken' : 'settings.cloud_unreachable');
    } catch (_) {
      _snack('settings.cloud_unreachable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    setState(() => _busy = true);
    try {
      await cloudDelete(_s);
      await _set(_s.copy(clearUrl: true));
      if (mounted) setState(() => _stats = null);
      _snack('settings.cloud_deleted');
    } catch (_) {
      _snack('settings.cloud_unreachable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _export() async {
    try {
      final csv = await cloudLeadsCsv(_s);
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/${_s.handle}-leads.csv');
      await f.writeAsString(csv);
      await Share.shareXFiles([XFile(f.path, mimeType: 'text/csv')]);
    } catch (_) {
      _snack('settings.cloud_unreachable');
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final muted = TextStyle(fontSize: 12, height: 1.6, color: cs.onSurface.withOpacity(.7));
    final url = _s.publishedUrl;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.cloud_outlined, color: cs.primary),
            const SizedBox(width: 10),
            Expanded(child: Text('settings.cloud_title'.tr(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
            Switch(value: _s.enabled, onChanged: _toggle),
          ]),
          const SizedBox(height: 6),
          Text('settings.cloud_sub'.tr(), style: muted),
          if (_s.enabled) ...[
            const Divider(height: 24),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: Colors.amber.withOpacity(.12), borderRadius: BorderRadius.circular(10)),
              child: Row(children: [
                const Icon(Icons.shield_outlined, size: 18, color: Colors.amber),
                const SizedBox(width: 8),
                Expanded(child: Text('settings.cloud_on_notice'.tr(), style: const TextStyle(fontSize: 12, height: 1.5))),
              ]),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _handle,
              textDirection: ui.TextDirection.ltr,
              autocorrect: false,
              decoration: InputDecoration(labelText: 'settings.cloud_handle'.tr(), hintText: 'cto-drs', border: const OutlineInputBorder()),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[a-z0-9-]')),
                LengthLimitingTextInputFormatter(32),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('settings.cloud_capture'.tr(), style: const TextStyle(fontSize: 13)),
              value: _s.capture,
              onChanged: (v) => _set(_s.copy(capture: v)),
            ),
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton(onPressed: _busy ? null : _publish, child: Text('settings.cloud_publish'.tr())),
              if (url != null) OutlinedButton(onPressed: _busy ? null : _delete, child: Text('settings.cloud_delete'.tr())),
            ]),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 4, children: [
              TextButton.icon(onPressed: _copyKey, icon: const Icon(Icons.vpn_key_outlined, size: 16), label: Text('settings.cloud_copy_key'.tr(), style: const TextStyle(fontSize: 12))),
              TextButton.icon(onPressed: _useKey, icon: const Icon(Icons.login_rounded, size: 16), label: Text('settings.cloud_use_key'.tr(), style: const TextStyle(fontSize: 12))),
            ]),
            if (url != null) ...[
              const SizedBox(height: 10),
              InkWell(
                onTap: () => ref.read(nativeBridgeProvider).openUrl(url),
                child: Text(url, textDirection: ui.TextDirection.ltr, style: TextStyle(fontSize: 12, color: cs.primary, decoration: TextDecoration.underline)),
              ),
            ],
            if (url != null && _stats != null) ...[
              const Divider(height: 24),
              Text('settings.cloud_stats_title'.tr(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(height: 8),
              Row(children: [
                _Tile(value: '${_stats!.views}', label: 'settings.cloud_views'.tr()),
                const SizedBox(width: 8),
                _Tile(value: '${_stats!.clicks}', label: 'settings.cloud_clicks'.tr()),
              ]),
              _Rows('settings.cloud_sources'.tr(), _stats!.sources),
              _Rows('settings.cloud_countries'.tr(), _stats!.countries),
              if (_stats!.peakHour != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('${'settings.cloud_peak'.tr()}: ${_stats!.peakHour.toString().padLeft(2, '0')}:00', style: muted),
                ),
              if (_s.capture)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: OutlinedButton(onPressed: _export, child: Text('settings.cloud_export'.tr())),
                ),
            ],
          ],
        ]),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final String value;
  final String label;
  const _Tile({required this.value, required this.label});
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(color: cs.onSurface.withOpacity(.06), borderRadius: BorderRadius.circular(10)),
        child: Column(children: [
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          Text(label, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(.65))),
        ]),
      ),
    );
  }
}

class _Rows extends StatelessWidget {
  final String title;
  final List<(String, int)> rows;
  const _Rows(this.title, this.rows);
  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(.65))),
        for (final r in rows.take(5))
          Directionality(
            textDirection: ui.TextDirection.ltr,
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(r.$1, style: const TextStyle(fontSize: 12)), Text('${r.$2}', style: const TextStyle(fontSize: 12))]),
          ),
      ]),
    );
  }
}

class _DisclosureDialog extends StatefulWidget {
  const _DisclosureDialog();
  @override
  State<_DisclosureDialog> createState() => _DisclosureDialogState();
}

class _DisclosureDialogState extends State<_DisclosureDialog> {
  bool _agree = false;
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('settings.cloud_dlg_title'.tr()),
      content: SingleChildScrollView(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('settings.cloud_dlg_sub'.tr(), style: const TextStyle(fontSize: 13)),
          const SizedBox(height: 10),
          for (final k in const ['settings.cloud_dlg_1', 'settings.cloud_dlg_2', 'settings.cloud_dlg_3', 'settings.cloud_dlg_4'])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('•  '),
                Expanded(child: Text(k.tr(), style: const TextStyle(fontSize: 13, height: 1.6))),
              ]),
            ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _agree,
            onChanged: (v) => setState(() => _agree = v ?? false),
            title: Text('settings.cloud_dlg_agree'.tr(), style: const TextStyle(fontSize: 13)),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text('settings.cloud_cancel'.tr())),
        FilledButton(onPressed: _agree ? () => Navigator.pop(context, true) : null, child: Text('settings.cloud_enable'.tr())),
      ],
    );
  }
}
