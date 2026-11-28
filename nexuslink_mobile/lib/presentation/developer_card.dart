import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/developer_banners.dart';
import '../state/transfer_providers.dart';

/// بطاقة «عن المطوّر» — زجاج داكن، حلقة تدرّج حول الصورة، شارة توثيق، شبكة 4×2 بألوان العلامات.
/// الروابط تُفتح بنقرة المستخدم فقط عبر الجسر الأصلي (openUrl)، بلا أي طلب خلفي.
/// Card themes (accent presets), same ids and colors as the web card. Stored locally only.
class DevCardTheme {
  const DevCardTheme(this.id, this.label, this.ring, this.button, this.swatch);
  final String id;
  final String label;
  final List<Color> ring;
  final Color button;
  final Color swatch;
}

const devCardThemes = <DevCardTheme>[
  DevCardTheme('violet', 'settings.dev_theme_violet', [Color(0xFF6366F1), Color(0xFF06B6D4), Color(0xFFA855F7)], Color(0xFF6D3FC9), Color(0xFF6D3FC9)),
  DevCardTheme('ocean', 'settings.dev_theme_ocean', [Color(0xFF0EA5E9), Color(0xFF14B8A6), Color(0xFF6366F1)], Color(0xFF0B7FB8), Color(0xFF0EA5E9)),
  DevCardTheme('sunset', 'settings.dev_theme_sunset', [Color(0xFFF97316), Color(0xFFEC4899), Color(0xFF8B5CF6)], Color(0xFFC2306F), Color(0xFFEC4899)),
];

class DevThemeNotifier extends StateNotifier<String> {
  DevThemeNotifier() : super('violet') {
    SharedPreferences.getInstance().then((p) {
      final v = p.getString('nexus.devcard.theme');
      if (v != null && devCardThemes.any((t) => t.id == v)) state = v;
    });
  }
  Future<void> pick(String id) async {
    state = id;
    (await SharedPreferences.getInstance()).setString('nexus.devcard.theme', id);
  }
}

final devThemeProvider = StateNotifierProvider<DevThemeNotifier, String>((ref) => DevThemeNotifier());

class DeveloperCard extends ConsumerWidget {
  const DeveloperCard({super.key});

  /// يُستعمل لبناء صفحة الوضع السحابي من نفس الروابط.
  static List<(String, IconData, Color, String)> get linkData => _links;

  static const _links = <(String, IconData, Color, String)>[
    ('settings.dev_wa', FontAwesomeIcons.whatsapp, Color(0xFF25D366), 'https://wa.me/message/MVTVWPOPFOVFF1'),
    ('settings.dev_tg', FontAwesomeIcons.telegram, Color(0xFF229ED9), 'https://t.me/CTO_DRS'),
    ('settings.dev_tt', FontAwesomeIcons.tiktok, Color(0xFF111111), 'https://www.tiktok.com/@cto.drs'),
    ('settings.dev_ig', FontAwesomeIcons.instagram, Color(0xFFE1306C), 'https://www.instagram.com/cto.drs'),
    ('settings.dev_x', FontAwesomeIcons.xTwitter, Color(0xFF000000), 'https://x.com/cto_drs'),
    ('settings.dev_yt', FontAwesomeIcons.youtube, Color(0xFFFF0000), 'https://youtube.com/@cto-drs'),
    ('settings.dev_gh', FontAwesomeIcons.github, Color(0xFF24292F), 'https://github.com/CTO-DRS'),
    ('settings.dev_web', FontAwesomeIcons.globe, Color(0xFF4F46E5), 'https://cto-drs.com'),
  ];

  void _viewPhoto(BuildContext context) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black87,
      builder: (ctx) => GestureDetector(
        onTap: () => Navigator.of(ctx).pop(),
        child: Center(
          child: InteractiveViewer(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: Image.asset('assets/developer/cto-drs.jpg'),
            ),
          ),
        ),
      ),
    );
  }

  /// QR كصورة PNG تُرسم على الجهاز (بلا شبكة) ثم تُشارك عبر ورقة المشاركة الأصلية.
  Future<void> _shareQrImage(String url, String id) async {
    final painter = QrPainter(
      data: url,
      version: QrVersions.auto,
      errorCorrectionLevel: QrErrorCorrectLevel.M,
      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
      dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black),
    );
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec);
    canvas.drawRect(const Rect.fromLTWH(0, 0, 1000, 1000), Paint()..color = Colors.white);
    canvas.translate(100, 100);
    painter.paint(canvas, const Size(800, 800));
    final img = await rec.endRecording().toImage(1000, 1000);
    final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
    if (bytes == null) return;
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/cto-drs-$id-qr.png');
    await file.writeAsBytes(bytes.buffer.asUint8List(), flush: true);
    await Share.shareXFiles([XFile(file.path, mimeType: 'image/png')], text: url);
  }

  /// جهة اتصال vCard (.vcf) بالصورة، تُبنى على الجهاز وتُشارك/تُحفظ عبر ورقة المشاركة الأصلية.
  Future<void> _saveContact() async {
    final b = StringBuffer()
      ..write('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:CTO: DRS\r\nN:DRS;CTO;;;\r\nORG:CTO: DRS\r\nTITLE:App developer\r\nURL:https://cto-drs.com\r\n');
    var n = 1;
    for (final l in _links) {
      if (l.$4 == 'https://cto-drs.com') continue;
      b.write('item$n.URL:${l.$4}\r\nitem$n.X-ABLabel:${l.$1.split('_').last.toUpperCase()}\r\n');
      n++;
    }
    try {
      final data = await rootBundle.load('assets/developer/cto-drs.jpg');
      b.write('PHOTO;ENCODING=b;TYPE=JPEG:${base64Encode(data.buffer.asUint8List())}\r\n');
    } catch (_) {}
    b.write('END:VCARD\r\n');
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/CTO-DRS.vcf');
    await file.writeAsString(b.toString(), flush: true);
    await Share.shareXFiles([XFile(file.path, mimeType: 'text/vcard')], subject: 'CTO: DRS');
  }

  void _shareApp() {
    Share.share('${'settings.dev_share_app_msg'.tr()}\n$kAppSiteUrl', subject: 'NexusLink');
  }

  void _shareAll() {
    final b = StringBuffer('CTO: DRS\n');
    for (final l in _links) {
      b.writeln('${l.$1.tr()}: ${l.$4}');
    }
    Share.share(b.toString().trimRight(), subject: 'CTO: DRS');
  }

  /// ورقة زجاجية: QR مُولَّد على الجهاز + «فتح» و«نسخ الرابط».
  void _showQr(BuildContext context, WidgetRef ref, (String, IconData, Color, String) l) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black54,
      isScrollControlled: true,
      builder: (ctx) => ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + MediaQuery.of(ctx).viewPadding.bottom),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xD9181A3E), Color(0xE60B0C24)],
              ),
              border: Border.all(color: const Color(0x668E5BD0)),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0x40FFFFFF), borderRadius: BorderRadius.circular(2)),
                ),
                const SizedBox(height: 16),
                Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: l.$3,
                    border: Border.all(color: const Color(0x40FFFFFF)),
                  ),
                  child: FaIcon(l.$2, size: 24, color: Colors.white),
                ),
                const SizedBox(height: 8),
                Text(l.$1.tr(),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
                  child: QrImageView(
                    data: l.$4,
                    size: 200,
                    backgroundColor: Colors.white,
                    eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
                    dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Colors.black),
                  ),
                ),
                const SizedBox(height: 12),
                Text('settings.dev_scan'.tr(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: Color(0xFFCBD5E1))),
                const SizedBox(height: 4),
                Text(l.$4,
                    textDirection: ui.TextDirection.ltr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF6D3FC9),
                          minimumSize: const Size.fromHeight(46),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () {
                          final bridge = ref.read(nativeBridgeProvider);
                          Navigator.of(ctx).pop();
                          bridge.openUrl(l.$4);
                        },
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: Text('settings.dev_open'.tr()),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                          side: const BorderSide(color: Color(0x40FFFFFF)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () async {
                          final messenger = ScaffoldMessenger.of(context);
                          final msg = 'settings.dev_copied'.tr();
                          await Clipboard.setData(ClipboardData(text: l.$4));
                          if (ctx.mounted) Navigator.of(ctx).pop();
                          messenger.showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 2)));
                        },
                        icon: const Icon(Icons.copy_rounded, size: 18),
                        label: Text('settings.dev_copy'.tr()),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                          side: const BorderSide(color: Color(0x40FFFFFF)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () => Share.share(l.$4, subject: 'CTO: DRS • ${l.$1.tr()}'),
                        icon: const Icon(Icons.ios_share_rounded, size: 18),
                        label: Text('settings.dev_share_link'.tr()),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                          side: const BorderSide(color: Color(0x40FFFFFF)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () => _shareQrImage(l.$4, l.$1.split('_').last),
                        icon: const Icon(Icons.qr_code_2_rounded, size: 18),
                        label: Text('settings.dev_share_qr'.tr()),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final theme = devCardThemes.firstWhere((t) => t.id == ref.watch(devThemeProvider), orElse: () => devCardThemes.first);
    final rows = <Widget>[];
    for (var i = 0; i < _links.length; i += 4) {
      rows.add(Row(
        children: [
          for (final l in _links.skip(i).take(4))
            Expanded(
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _showQr(context, ref, l),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: l.$3,
                          border: Border.all(color: const Color(0x40FFFFFF)),
                        ),
                        child: FaIcon(l.$2, size: 22, color: Colors.white),
                      ),
                      const SizedBox(height: 6),
                      Text(l.$1.tr(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, color: Color(0xFFCBD5E1))),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Container(
            width: 4,
            height: 20,
            decoration: BoxDecoration(color: const Color(0xFF6D3FC9), borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(width: 10),
          Text('settings.developer'.tr(),
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: cs.onSurface)),
          const SizedBox(width: 10),
          const Expanded(child: Divider(height: 1, thickness: 1, color: Color(0x40A78BFA))),
        ]),
        const SizedBox(height: 10),
        const _BannerCarousel(),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF1B1C3A), Color(0xFF0B0C24)],
            ),
            border: Border.all(color: const Color(0x5C8E5BD0)),
          ),
          child: Column(
            children: [
              GestureDetector(
                onTap: () => _viewPhoto(context),
                child: SizedBox(
                  width: 96,
                  height: 96,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: theme.ring,
                          ),
                        ),
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF161437)),
                          child: const CircleAvatar(
                            backgroundImage: AssetImage('assets/developer/cto-drs.jpg'),
                          ),
                        ),
                      ),
                      PositionedDirectional(
                        end: -2,
                        bottom: -2,
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFF1D9BF0),
                            border: Border.all(color: const Color(0xFF0B0C24), width: 2),
                          ),
                          child: const Icon(Icons.check, size: 16, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text('CTO: DRS',
                  textDirection: ui.TextDirection.ltr,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 2),
              Text('settings.developerLine'.tr(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13, color: Color(0xFFA5B4FC))),
              const SizedBox(height: 14),
              ...rows,
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: theme.button,
                        minimumSize: const Size.fromHeight(46),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      onPressed: _shareApp,
                      icon: const Icon(Icons.ios_share_rounded, size: 18),
                      label: Text('settings.dev_share_app'.tr(), maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(46),
                        side: const BorderSide(color: Color(0x40FFFFFF)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      onPressed: _shareAll,
                      icon: const Icon(Icons.groups_rounded, size: 18),
                      label: Text('settings.dev_share_all'.tr(), maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(46),
                  side: const BorderSide(color: Color(0x40FFFFFF)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                onPressed: _saveContact,
                icon: const Icon(Icons.contact_page_rounded, size: 18),
                label: Text('settings.dev_save_contact'.tr()),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final t in devCardThemes)
                    Semantics(
                      button: true,
                      selected: t.id == theme.id,
                      label: t.label.tr(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: () => ref.read(devThemeProvider.notifier).pick(t.id),
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: t.swatch,
                              border: Border.all(color: t.id == theme.id ? Colors.white : const Color(0x40FFFFFF), width: t.id == theme.id ? 2.5 : 1),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              const _UpdateRow(),
            ],
          ),
        ),
      ],
    );
  }
}


/// لافتات دوّارة مدفوعة بالبيانات (developer_banners.dart): تتقدم تلقائيًا وتتوقف عند اللمس.
class _BannerCarousel extends ConsumerStatefulWidget {
  const _BannerCarousel();
  @override
  ConsumerState<_BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends ConsumerState<_BannerCarousel> {
  final _ctl = PageController();
  late final List<DeveloperBanner> _banners = activeBanners();
  Timer? _timer;
  int _i = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _timer?.cancel();
    if (_banners.length < 2) return;
    _timer = Timer.periodic(kBannerInterval, (_) {
      if (!mounted || !_ctl.hasClients) return;
      final next = (_i + 1) % _banners.length;
      _ctl.animateToPage(next, duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: SizedBox(
        height: 96,
        child: Stack(
          children: [
            Listener(
              onPointerDown: (_) => _timer?.cancel(),
              onPointerUp: (_) => _start(),
              child: PageView.builder(
                controller: _ctl,
                itemCount: _banners.length,
                onPageChanged: (v) => setState(() => _i = v),
                itemBuilder: (ctx, idx) {
                  final b = _banners[idx];
                  return InkWell(
                    onTap: () => ref.read(nativeBridgeProvider).openUrl(b.url),
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: b.colors),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(b.titleKey.tr(),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white)),
                                const SizedBox(height: 2),
                                Text(b.bodyKey.tr(),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, color: Color(0xCCFFFFFF), height: 1.4)),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                            decoration: BoxDecoration(color: const Color(0x33FFFFFF), borderRadius: BorderRadius.circular(20)),
                            child: Text(b.ctaKey.tr(),
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white)),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            if (_banners.length > 1)
              Positioned(
                left: 0,
                right: 0,
                bottom: 6,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var d = 0; d < _banners.length; d++)
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        width: d == _i ? 16 : 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: d == _i ? Colors.white : const Color(0x80FFFFFF),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

enum _UpdState { idle, busy, latest, available, error }

/// الإصدار الحي + «التحقق من التحديثات»: طلب واحد لصفحة إصدارات المشروع العامة عند الضغط فقط.
class _UpdateRow extends ConsumerStatefulWidget {
  const _UpdateRow();
  @override
  ConsumerState<_UpdateRow> createState() => _UpdateRowState();
}

class _UpdateRowState extends ConsumerState<_UpdateRow> {
  String _version = '';
  _UpdState _st = _UpdState.idle;
  String _tag = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((p) {
      if (mounted) setState(() => _version = p.version);
    }).catchError((_) {});
  }

  bool _isNewer(String a, String b) {
    List<int> n(String v) => v.split('.').map((x) => int.tryParse(x.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0).toList();
    final x = n(a), y = n(b);
    for (var i = 0; i < 3; i++) {
      final p = i < x.length ? x[i] : 0, q = i < y.length ? y[i] : 0;
      if (p != q) return p > q;
    }
    return false;
  }

  Future<void> _check() async {
    setState(() => _st = _UpdState.busy);
    try {
      final r = await http.get(Uri.parse(kReleasesApi), headers: {'Accept': 'application/vnd.github+json'}).timeout(const Duration(seconds: 8));
      if (r.statusCode != 200) throw Exception('http ${r.statusCode}');
      final tag = (jsonDecode(r.body)['tag_name'] as String? ?? '').replaceFirst(RegExp('^v'), '');
      if (!mounted) return;
      setState(() {
        _tag = tag;
        _st = _isNewer(tag, _version) ? _UpdState.available : _UpdState.latest;
      });
    } catch (_) {
      if (mounted) setState(() => _st = _UpdState.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('NexusLink • v${_version.isEmpty ? '…' : _version}',
            textDirection: ui.TextDirection.ltr,
            style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
        const SizedBox(height: 8),
        OutlinedButton(
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white,
            side: const BorderSide(color: Color(0x40FFFFFF)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          ),
          onPressed: _st == _UpdState.busy ? null : _check,
          child: Text(_st == _UpdState.busy ? 'settings.dev_checking'.tr() : 'settings.dev_check_update'.tr(),
              style: const TextStyle(fontSize: 12)),
        ),
        if (_st == _UpdState.latest)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('settings.dev_up_to_date'.tr(), style: const TextStyle(fontSize: 12, color: Color(0xFF6EE7B7))),
          ),
        if (_st == _UpdState.error)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('settings.dev_update_error'.tr(),
                textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Color(0xFFFCA5A5))),
          ),
        if (_st == _UpdState.available)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: InkWell(
              onTap: () => ref.read(nativeBridgeProvider).openUrl(kReleasesPage),
              child: Text('${'settings.dev_update_available'.tr()} v$_tag • ${'settings.dev_view_release'.tr()}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFA5B4FC), decoration: TextDecoration.underline)),
            ),
          ),
      ],
    );
  }
}
