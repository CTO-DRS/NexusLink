import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/database/nexus_db.dart';
import '../data/native_bridge.dart';
import '../data/transfer_engine.dart';
import '../state/providers.dart';
import '../state/transfer_providers.dart';

/// شاشة النقل (البند 1/2/3/5): الطابور الحي + العروض الواردة + النصوص/الروابط
/// السريعة + السجل الدائم في SQLite، مع رفع ملفات/مجلدات ومشاركات أندرويد.
class TransfersScreen extends ConsumerWidget {
  const TransfersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conn = ref.watch(connectionProvider).value;
    final engine = ref.watch(engineProvider);
    final history = ref.watch(transfersHistoryProvider);
    final quick = ref.watch(quickIntakeProvider);
    final shares = ref.watch(shareIntakeProvider);
    final cs = Theme.of(context).colorScheme;

    final connected = conn?.phase == ConnectPhase.online;
    final tasks = engine?.tasks ?? const <TransferTask>[];
    final offers = tasks
        .where((t) => !t.isUpload && t.state == TxState.queued && !t.autoAccepted)
        .toList();
    final queue = tasks.where((t) => !t.isTerminal).where((t) => !offers.contains(t)).toList();
    final doneTasks = history.value ?? const [];

    return Scaffold(
      appBar: AppBar(
        title: Text('nav.transfers'.tr()),
        actions: [
          IconButton(
            tooltip: 'tx.pickFiles'.tr(),
            onPressed: connected ? () => _pickFiles(context, ref) : null,
            icon: const Icon(Icons.upload_file_rounded),
          ),
          IconButton(
            tooltip: 'tx.pickFolder'.tr(),
            onPressed: connected ? () => _pickFolder(context, ref) : null,
            icon: const Icon(Icons.folder_copy_rounded),
          ),
        ],
      ),
      floatingActionButton: connected
          ? FloatingActionButton.extended(
              heroTag: 'tx_send',
              onPressed: () => _pickFiles(context, ref),
              icon: const Icon(Icons.add_link_rounded),
              label: Text('tx.send'.tr()),
            )
          : null,
      body: !connected
          ? _Notice(text: 'tx.needConnect'.tr())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              children: [
                if (shares.isNotEmpty) ...[
                  _Header('tx.pendingShares'.tr()),
                  for (var i = 0; i < shares.length; i++)
                    _ShareCard(index: i, intake: shares[i], cs: cs),
                  const SizedBox(height: 14),
                ],
                if (offers.isNotEmpty) ...[
                  _Header('tx.incoming'.tr()),
                  for (final o in offers) _OfferCard(task: o, cs: cs),
                  const SizedBox(height: 14),
                ],
                if (quick.isNotEmpty) ...[
                  _Header('tx.quick'.tr()),
                  for (final q in quick.take(6)) _QuickCard(item: q, cs: cs),
                  const SizedBox(height: 14),
                ],
                _Header('tx.queue'.tr()),
                if (queue.isEmpty)
                  _Notice(text: 'tx.queueEmpty'.tr())
                else
                  for (final t in queue) _QueueCard(task: t, cs: cs),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(child: _Header('tx.history'.tr())),
                    TextButton(
                      onPressed: () => ref.read(engineProvider)?.clearFinished(),
                      child: Text('tx.clearFinished'.tr()),
                    ),
                  ],
                ),
                if (doneTasks.isEmpty)
                  _Notice(text: 'tx.historyEmpty'.tr())
                else
                  for (final r in doneTasks.take(50))
                    _HistoryRow(record: r, engine: engine, cs: cs),
              ],
            ),
    );
  }

  Future<void> _pickFiles(BuildContext context, WidgetRef ref) async {
    final res = await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
    if (res == null || res.files.isEmpty) return;
    if (!context.mounted) return;
    await _enqueuePaths(context, ref, res.files.map((f) => f.path).whereType<String>().toList());
  }

  Future<void> _pickFolder(BuildContext context, WidgetRef ref) async {
    final dir = await FilePicker.platform.getDirectoryPath();
    if (dir == null) return;
    final files = <String>[];
    try {
      await for (final e in Directory(dir).list(recursive: true, followLinks: false)) {
        if (e is File) files.add(e.path);
      }
    } catch (_) {}
    if (files.isEmpty) return;
    if (context.mounted) {
      final go = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('tx.folderConfirmTitle'.tr()),
          content: Text('tx.folderConfirmBody'.tr(namedArgs: {'n': '${files.length}'})),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('tx.cancel'.tr())),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text('tx.sendAll'.tr())),
          ],
        ),
      );
      if (go != true) return;
      if (!context.mounted) return;
      await _enqueuePaths(context, ref, files);
    }
  }

  Future<void> _enqueuePaths(BuildContext context, WidgetRef ref, List<String> paths) async {
    final engine = ref.read(engineProvider);
    if (engine == null) return;
    var added = 0;
    for (final p in paths) {
      try {
        final f = File(p);
        final size = await f.length();
        await engine.enqueueUpload(
          localPath: p,
          fileName: p.split(Platform.pathSeparator).last,
          size: size,
        );
        added++;
      } catch (_) {/* تخطَّ الملف غير القابل للقراءة */}
    }
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('tx.enqueued'.tr(namedArgs: {'n': '$added'}))),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// عناصر الواجهة
// ---------------------------------------------------------------------------

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 4),
      child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
    );
  }
}

class _Notice extends StatelessWidget {
  final String text;
  const _Notice({required this.text});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Text(text, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.outline)),
      ),
    );
  }
}

IconData _kindIcon(String fileName, {String? mime}) {
  final ext = fileName.contains('.') ? fileName.split('.').last.toLowerCase() : '';
  if (mime?.startsWith('image/') ?? false) return Icons.image_rounded;
  return switch (ext) {
    'jpg' || 'jpeg' || 'png' || 'gif' || 'webp' || 'bmp' => Icons.image_rounded,
    'mp4' || 'mkv' || 'webm' || 'mov' || 'avi' => Icons.movie_rounded,
    'mp3' || 'wav' || 'ogg' || 'm4a' || 'flac' => Icons.music_note_rounded,
    'apk' => Icons.android_rounded,
    'zip' || 'rar' || '7z' => Icons.folder_zip_rounded,
    'pdf' => Icons.picture_as_pdf_rounded,
    _ => Icons.insert_drive_file_rounded,
  };
}

String _fmtSize(int b) {
  if (b >= 1024 * 1024 * 1024) return '${(b / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  if (b >= 1024 * 1024) return '${(b / (1024 * 1024)).toStringAsFixed(1)} MB';
  if (b >= 1024) return '${(b / 1024).toStringAsFixed(0)} KB';
  return '$b B';
}

String _fmtSpeed(double bps) {
  if (bps <= 0) return '';
  return '${_fmtSize(bps.round())}/s';
}

/// بطاقة عرض ملف قادم — قبول/رفض (البند 2).
class _OfferCard extends ConsumerWidget {
  final TransferTask task;
  final ColorScheme cs;
  const _OfferCard({required this.task, required this.cs});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final engine = ref.read(engineProvider);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(_kindIcon(task.fileName, mime: task.mime), color: cs.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(task.fileName, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              Text(_fmtSize(task.totalBytes), style: TextStyle(fontSize: 12, color: cs.outline)),
            ]),
            const SizedBox(height: 4),
            Text('tx.fromServer'.tr(namedArgs: {'from': task.fromName ?? '—'}),
                style: TextStyle(fontSize: 12, color: cs.outline)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => engine?.accept(task.id),
                  icon: const Icon(Icons.download_rounded, size: 18),
                  label: Text('tx.accept'.tr()),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => engine?.reject(task.id),
                  icon: const Icon(Icons.close_rounded, size: 18),
                  label: Text('tx.reject'.tr()),
                ),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}

/// بطاقة مهمة حية: تقدم/سرعة/إيقاف/استئناف/إلغاء (البند 1).
class _QueueCard extends ConsumerWidget {
  final TransferTask task;
  final ColorScheme cs;
  const _QueueCard({required this.task, required this.cs});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final engine = ref.read(engineProvider);
    final pct = (task.progress * 100).toStringAsFixed(task.progress >= 1 ? 0 : 1);
    final active = task.state == TxState.active;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(
              task.isUpload ? Icons.upload_rounded : Icons.download_rounded,
              size: 18,
              color: task.isUpload ? cs.primary : cs.tertiary,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(task.fileName, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
            Text('${_fmtSize(task.transferred)} / ${_fmtSize(task.totalBytes)}',
                style: TextStyle(fontSize: 11, color: cs.outline)),
          ]),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: task.progress),
              duration: const Duration(milliseconds: 250),
              builder: (context, v, _) => LinearProgressIndicator(
                value: v,
                minHeight: 8,
                valueColor: AlwaysStoppedAnimation(active ? cs.primary : cs.outline),
                backgroundColor: cs.surfaceContainerHighest,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Text(
              task.state == TxState.paused
                  ? 'tx.paused'.tr()
                  : (task.state == TxState.queued ? 'tx.waiting'.tr() : '$pct%'),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
                  color: task.state == TxState.paused ? cs.outline : cs.primary),
            ),
            if (active && task.speedBps > 0) ...[
              const SizedBox(width: 8),
              Text(_fmtSpeed(task.speedBps), style: TextStyle(fontSize: 12, color: cs.outline)),
            ],
            const Spacer(),
            if (task.state == TxState.active)
              IconButton(
                tooltip: 'tx.pause'.tr(),
                onPressed: () => engine?.pause(task.id),
                icon: const Icon(Icons.pause_circle_outline_rounded),
              ),
            if (task.state == TxState.paused)
              IconButton(
                tooltip: 'tx.resume'.tr(),
                onPressed: () => engine?.resume(task.id),
                icon: const Icon(Icons.play_circle_outline_rounded),
              ),
            IconButton(
              tooltip: 'tx.cancel'.tr(),
              onPressed: () => engine?.cancel(task.id),
              icon: Icon(Icons.cancel_outlined, color: cs.error),
            ),
          ]),
          if (task.error != null)
            Text(task.error!, style: TextStyle(fontSize: 11, color: cs.error)),
        ]),
      ),
    );
  }
}

/// نص/رابط سريع وارد — نسخ/فتح (البند 3).
class _QuickCard extends ConsumerWidget {
  final QuickItem item;
  final ColorScheme cs;
  const _QuickCard({required this.item, required this.cs});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLink = item.isLink;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(isLink ? Icons.link_rounded : Icons.notes_rounded, color: cs.primary),
        title: Text(
          item.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        subtitle: Text('${isLink ? 'tx.quickLink'.tr() : 'tx.quickText'.tr()} · ${item.from}',
            style: TextStyle(fontSize: 11, color: cs.outline)),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          IconButton(
            tooltip: 'tx.copy'.tr(),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: isLink ? item.url! : item.clip!.content));
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('tx.copied'.tr())));
              }
            },
            icon: const Icon(Icons.copy_rounded, size: 20),
          ),
          if (isLink)
            IconButton(
              tooltip: 'tx.open'.tr(),
              onPressed: () => ref.read(nativeBridgeProvider).openUrl(item.url!),
              icon: const Icon(Icons.open_in_new_rounded, size: 20),
            ),
        ]),
      ),
    );
  }
}

/// صف سجل (مكتمل/فاشل/ملغى) من SQLite (البند 5).
class _HistoryRow extends ConsumerWidget {
  final TransferRecord record;
  final TransferEngine? engine;
  final ColorScheme cs;
  const _HistoryRow({required this.record, required this.engine, required this.cs});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isUpload = record.kind == 'upload';
    final (icon, color, label) = switch (record.state) {
      'done' => (Icons.check_circle_rounded, Colors.green.shade600, 'tx.done'.tr()),
      'failed' => (Icons.error_rounded, cs.error, 'tx.failed'.tr()),
      'cancelled' => (Icons.cancel_rounded, cs.outline, 'tx.cancelled'.tr()),
      _ => (Icons.schedule_rounded, cs.outline, record.state),
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ListTile(
        dense: true,
        leading: Icon(isUpload ? Icons.upload_rounded : Icons.download_rounded, size: 20, color: cs.outline),
        title: Text(record.fileName, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        subtitle: Text(
          '${isUpload ? 'tx.toServer'.tr() : 'tx.fromServerShort'.tr()} · ${_fmtSize(record.sizeBytes.toInt())}'
          '${record.finalPath != null ? ' · ${record.finalPath}' : ''}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 11, color: cs.outline),
        ),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: color)),
          if (record.state == 'done' && !isUpload && record.finalPath != null)
            IconButton(
              tooltip: 'tx.open'.tr(),
              onPressed: () => ref.read(nativeBridgeProvider).openPath(record.finalPath!),
              icon: const Icon(Icons.open_in_new_rounded, size: 18),
            ),
          if (record.state == 'done' && isUpload && record.finalPath != null)
            IconButton(
              tooltip: 'tx.copyPath'.tr(),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: record.finalPath!));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('tx.copied'.tr())));
                }
              },
              icon: const Icon(Icons.copy_rounded, size: 18),
            ),
          if (record.state == 'failed' || record.state == 'cancelled')
            IconButton(
              tooltip: 'tx.retry'.tr(),
              onPressed: () => engine?.retry(record.id),
              icon: const Icon(Icons.refresh_rounded, size: 18),
            ),
        ]),
      ),
    );
  }
}

/// بطاقة محتوى مشارَك معلّق من أندرويد (البند 4).
class _ShareCard extends ConsumerWidget {
  final int index;
  final SharedIntake intake;
  final ColorScheme cs;
  const _ShareCard({required this.index, required this.intake, required this.cs});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final engine = ref.read(engineProvider);
    final files = intake.files;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: cs.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.share_rounded, size: 18, color: cs.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                intake.text != null
                    ? 'tx.shareText'.tr(namedArgs: {'preview': intake.text!.substring(0, 60.clamp(0, intake.text!.length))})
                    : 'tx.shareFiles'.tr(namedArgs: {'n': '${files.length}'}),
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ]),
          if (files.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              files.map((f) => f.name).take(4).join(' · ') + (files.length > 4 ? ' …' : ''),
              style: TextStyle(fontSize: 11, color: cs.outline),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: () async {
                  if (intake.text != null && intake.text!.isNotEmpty) {
                    // نص مشارَك: انسخه للحافظة ليُستخدم في الإنتاجية لاحقًا + أرسله كحافظة موحدة لاحقًا
                    await Clipboard.setData(ClipboardData(text: intake.text!));
                  }
                  var added = 0;
                  for (final f in files) {
                    try {
                      await engine?.enqueueUpload(
                        localPath: f.path,
                        fileName: f.name,
                        size: f.size,
                        mime: f.mime,
                      );
                      added++;
                    } catch (_) {}
                  }
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('tx.enqueued'.tr(namedArgs: {'n': '$added'}))),
                    );
                  }
                  ref.read(shareIntakeProvider.notifier).removeAt(index);
                },
                icon: const Icon(Icons.upload_rounded, size: 18),
                label: Text('tx.sendViaNexus'.tr()),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'tx.dismiss'.tr(),
              onPressed: () => ref.read(shareIntakeProvider.notifier).removeAt(index),
              icon: const Icon(Icons.close_rounded),
            ),
          ]),
        ]),
      ),
    );
  }
}
