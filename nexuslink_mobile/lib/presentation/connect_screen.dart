import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/protocol.dart';
import '../domain/models.dart';
import '../state/providers.dart';

/// شاشة «الاتصال بالسيرفر»: اكتشاف تلقائي mDNS + مسح QR + إدخال يدوي.
/// اختبار النجاح: مسح QR من الويب ← ظهور الجهاز فورًا في قائمة أجهزة الويب.
class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final _ipCtrl = TextEditingController();
  final _portCtrl = TextEditingController(text: '${NexusPorts.gateway}');
  bool _manualBusy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(discoveryProvider.notifier).start();
    });
  }

  @override
  void dispose() {
    _ipCtrl.dispose();
    _portCtrl.dispose();
    super.dispose();
  }

  Future<bool> _connect(ServerEndpoint ep, String name, {String? secret}) async {
    await ref.read(connectionProvider.notifier).connect(endpoint: ep, serverName: name, qrSecret: secret);
    final state = ref.read(connectionProvider).value;
    final ok = state?.phase == ConnectPhase.online;
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('connect.done'.tr())),
      );
    }
    return ok;
  }

  void _connectFromQr(QrPayload qr) {
    final mode = qr.port == NexusPorts.rest ? AccessMode.direct : AccessMode.gateway;
    _connect(
      ServerEndpoint(host: qr.host, port: qr.port, mode: mode),
      qr.name,
      secret: qr.secret,
    );
  }

  void _connectDiscovered(DiscoveredServer s) {
    _connect(
      ServerEndpoint(host: s.host, port: s.port, mode: AccessMode.gateway),
      s.name,
    );
  }

  Future<void> _scanQr() async {
    final raw = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _QrScannerPage()),
    );
    if (raw == null || !mounted) return;
    final qr = QrPayload.tryParse(raw);
    if (qr == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('connect.qrInvalid'.tr())),
      );
      return;
    }
    _connectFromQr(qr);
  }

  Future<void> _connectManual() async {
    final host = _ipCtrl.text.trim();
    final port = int.tryParse(_portCtrl.text.trim()) ?? 0;
    if (host.isEmpty || port <= 0 || port > 65535) return;
    FocusScope.of(context).unfocus();
    setState(() => _manualBusy = true);

    // اكتشاف النمط تلقائيًا: جرّب المنفذ المُدخل كبوابة، وإن فشل جرّب 3000 مباشرة
    final candidates = <ServerEndpoint>[
      ServerEndpoint(host: host, port: port, mode: port == NexusPorts.rest ? AccessMode.direct : AccessMode.gateway),
      if (port != NexusPorts.rest)
        ServerEndpoint(host: host, port: NexusPorts.rest, mode: AccessMode.direct),
    ];
    for (final ep in candidates) {
      final ok = await _connect(ep, host, secret: null);
      if (ok) {
        setState(() => _manualBusy = false);
        return;
      }
    }
    setState(() => _manualBusy = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('connect.healthFail'.tr())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final conn = ref.watch(connectionProvider);
    final connModel = conn.value ?? const ConnectionStateModel();
    final agentState = ref.watch(agentStateProvider);
    final discovered = ref.watch(discoveryProvider);
    final servers = ref.watch(trustedServersProvider).value ?? const [];
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text('connect.title'.tr())),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          _StatusBanner(model: connModel, agentState: agentState),
          const SizedBox(height: 16),

          Text('connect.subtitle'.tr(), style: TextStyle(color: cs.onSurface.withOpacity(.65))),
          const SizedBox(height: 16),

          // ==== 1) اكتشاف تلقائي mDNS ====
          _SectionCard(
            title: 'connect.auto'.tr(),
            icon: Icons.wifi_find_rounded,
            child: discovered.isEmpty
                ? Row(children: [
                    const SizedBox(
                      width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text('connect.nothingFound'.tr(),
                        style: const TextStyle(fontSize: 13))),
                  ])
                : Column(
                    children: [
                      for (final s in discovered)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          leading: const Icon(Icons.computer_rounded),
                          title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${s.host}:${s.port} · ${s.proto}'),
                          trailing: FilledButton.tonal(
                            onPressed: connModel.isOnline ? null : () => _connectDiscovered(s),
                            child: Text('connect.use'.tr()),
                          ),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 12),

          // ==== 2) مسح QR ====
          _SectionCard(
            title: 'connect.qr'.tr(),
            icon: Icons.qr_code_scanner_rounded,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('connect.qrHint'.tr(), style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _scanQr,
                  icon: const Icon(Icons.qr_code_scanner_rounded),
                  label: Text('connect.qr'.tr()),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // ==== 3) إدخال يدوي ====
          _SectionCard(
            title: 'connect.manual'.tr(),
            icon: Icons.edit_location_alt_rounded,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: _ipCtrl,
                        keyboardType: TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(labelText: 'connect.ip'.tr(), hintText: '192.168.1.2'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _portCtrl,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(labelText: 'connect.port'.tr(), hintText: 'connect.portHint'.tr()),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _manualBusy ? null : _connectManual,
                  icon: _manualBusy
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.link_rounded),
                  label: Text('connect.connect'.tr()),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // ==== الخوادم الموثوقة (SQLite) ====
          if (servers.isNotEmpty) ...[
            Row(
              children: [
                Text('connect.trustedServers'.tr(),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const Spacer(),
                Text('${servers.length}', style: TextStyle(color: cs.onSurface.withOpacity(.6))),
              ],
            ),
            const SizedBox(height: 8),
            for (final s in servers)
              Card(
                child: ListTile(
                  leading: Icon(
                    s.isLastUsed ? Icons.verified_rounded : Icons.dns_rounded,
                    color: s.isLastUsed ? cs.primary : null,
                  ),
                  title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${s.serverKey} · ${'connect.pairedAt'.tr()}: ${_fmt(s.pairedAt)}'),
                  trailing: Wrap(spacing: 4, children: [
                    IconButton(
                      tooltip: 'connect.use'.tr(),
                      icon: const Icon(Icons.swap_horiz_rounded),
                      onPressed: connModel.isOnline
                          ? null
                          : () => ref.read(connectionProvider.notifier).switchTo(s),
                    ),
                    IconButton(
                      tooltip: 'connect.forget'.tr(),
                      icon: Icon(Icons.delete_outline_rounded, color: cs.error),
                      onPressed: () => ref.read(connectionProvider.notifier).disconnect(forgetRow: false).then(
                            (_) => ref.read(nexusDbProvider).forget(s.id).then(
                                  (_) => ref.invalidate(trustedServersProvider),
                                ),
                          ),
                    ),
                  ]),
                ),
              ),
          ],
        ],
      ),
    );
  }

  String _fmt(DateTime d) => '${d.year}/${d.month.toString().padLeft(2, '0')}/${d.day.toString().padLeft(2, '0')}';
}

// ---------------------------------------------------------------------------
// شريط الحالة العلوي
// ---------------------------------------------------------------------------

class _StatusBanner extends ConsumerWidget {
  final ConnectionStateModel model;
  final AgentLinkState agentState;
  const _StatusBanner({required this.model, required this.agentState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final (Color bg, Color fg, String label, IconData icon) = switch (agentState) {
      AgentLinkState.online => (cs.primary, cs.onPrimary, 'status.online'.tr(), Icons.check_circle_rounded),
      AgentLinkState.connecting || AgentLinkState.reconnecting => (
          Colors.orange.shade700, Colors.white, 'status.reconnecting'.tr(), Icons.sync_rounded
        ),
      AgentLinkState.offline => (Colors.red.shade700, Colors.white, 'status.offline'.tr(), Icons.error_rounded),
      AgentLinkState.stopped => (
          Theme.of(context).colorScheme.secondary,
          Theme.of(context).colorScheme.onSecondary,
          'status.offline'.tr(),
          Icons.lan_outlined
        ),
    };

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: fg),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: TextStyle(color: fg, fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 2),
                Text(
                  model.serverName != null
                      ? '${model.serverName} · ${model.endpoint?.key ?? ''}${model.rttMs != null ? ' · ${model.rttMs}ms' : ''}'
                      : 'app.tagline'.tr(),
                  style: TextStyle(color: fg.withOpacity(.85), fontSize: 12),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (model.isOnline)
            TextButton(
              onPressed: () => ref.read(connectionProvider.notifier).disconnect(),
              style: TextButton.styleFrom(foregroundColor: fg),
              child: Text('connect.disconnect'.tr()),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// بطاقة قسم
// ---------------------------------------------------------------------------

class _SectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget child;
  const _SectionCard({required this.title, required this.icon, required this.child});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: cs.primary),
                const SizedBox(width: 8),
                Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// صفحة مسح QR (mobile_scanner)
// ---------------------------------------------------------------------------

class _QrScannerPage extends StatefulWidget {
  const _QrScannerPage();

  @override
  State<_QrScannerPage> createState() => _QrScannerPageState();
}

class _QrScannerPageState extends State<_QrScannerPage> {
  final MobileScannerController _controller = MobileScannerController(
    formats: const [BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final b in capture.barcodes) {
      final value = b.rawValue;
      if (value == null) continue;
      final qr = QrPayload.tryParse(value);
      if (qr != null) {
        _done = true;
        Navigator.of(context).pop(value);
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('connect.qr'.tr())),
      body: Stack(children: [
        MobileScanner(
          controller: _controller,
          onDetect: _onDetect,
          errorBuilder: (context, error) => Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(error.errorCode.name, textAlign: TextAlign.center),
            ),
          ),
        ),
        // إطار توجيه
        Center(
          child: Container(
            width: 240, height: 240,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white70, width: 2),
              borderRadius: BorderRadius.circular(16),
            ),
          ),
        ),
        Positioned(
          left: 24, right: 24, bottom: 36,
          child: Card(
            color: Colors.black54,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'connect.qrHint'.tr(),
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 13),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
