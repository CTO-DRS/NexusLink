import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'nexus_db.g.dart';

/// الخوادم الموثوقة المحفوظة محليًا (SQLite عبر drift) — البند 7 من مرحلة الاتصال.
class TrustedServers extends Table {
  IntColumn get id => integer().autoIncrement()();

  /// مفتاح فريد: "host:port"
  TextColumn get serverKey => text().unique()();

  /// اسم السيرفر المعروض (من QR أو mDNS أو يدوي)
  TextColumn get name => text()();

  TextColumn get host => text()();

  /// منفذ الوصول (بوابة 81 أو REST 3000)
  IntColumn get port => integer()();

  /// gateway | direct
  TextColumn get mode => text()();

  /// معرّفنا لدى السيرفر (ناتج الاقتران — NexusDevice.id)
  TextColumn get deviceId => text()();

  /// اسم جهازنا كما سجّلناه
  TextColumn get deviceName => text()();

  /// سر الاقتران الأخير (للعرض فقط؛ السيرفر يولّد سرًا جديدًا لكل QR)
  TextColumn get pairingSecret => text().nullable()();

  DateTimeColumn get pairedAt => dateTime()();
  DateTimeColumn get lastUsedAt => dateTime()();
  BoolColumn get isLastUsed => boolean().withDefault(const Constant(false))();
}

/// سجل نقل الملفات (البند 5 من مرحلة النقل): طابور + تاريخ مكتمل/فاشل/ملغى.
@DataClassName('TransferRecord')
/// كل صف = مهمة قابلة للاستئناف بعد قتل التطبيق (offsets مشتقة من الملفات نفسها).
class TransferHistory extends Table {
  /// معرّف مستقر محليًا (نفسه taskId لدى السيرفر للرفع — يجعل الاستئناف idempotent)
  TextColumn get id => text()();

  /// "host:port" للسيرفر الذي تخصه المهمة
  TextColumn get serverKey => text()();

  /// upload | download
  TextColumn get kind => text()();

  TextColumn get fileName => text()();
  TextColumn get mime => text().nullable()();
  Int64Column get sizeBytes => int64()();
  Int64Column get transferredBytes => int64().withDefault(Constant(BigInt.zero))();

  /// queued | active | paused | done | failed | cancelled
  TextColumn get state => text()();

  /// الرفع: مسار الملف المصدر على الهاتف
  TextColumn get localPath => text().nullable()();

  /// التنزيل: مسار الجزئي المحلي (.nexuspart) الذي يُستأنف منه
  TextColumn get tempPath => text().nullable()();

  /// المسار النهائي بعد الإكمال (محلي منشور / افتراضي على السيرفر)
  TextColumn get finalPath => text().nullable()();

  /// الرفع: مجلد الوجهة الافتراضي؛ التنزيل: مسار المصدر الافتراضي
  TextColumn get remoteVPath => text().nullable()();

  /// التنزيل: الجهاز الافتراضي المصدر على السيرفر
  TextColumn get srcDeviceId => text().nullable()();

  /// التنزيل: معرّف مهمة السيرفر (tx_…) — لإعادة الربط بعد إعادة التشغيل
  TextColumn get offerId => text().nullable()();

  /// التنزيل: اسم المُرسل (للعرض)
  TextColumn get fromName => text().nullable()();

  BoolColumn get autoAccepted => boolean().withDefault(const Constant(false))();
  TextColumn get error => text().nullable()();

  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  DateTimeColumn get completedAt => dateTime().nullable()();
}

@DriftDatabase(tables: [TrustedServers, TransferHistory])
class NexusDatabase extends _$NexusDatabase {
  NexusDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.createTable(transferHistory);
          }
        },
      );

  // ------------------------------------------------------------------
  // الخوادم الموثوقة
  // ------------------------------------------------------------------

  /// بث قائمة الخوادم (الأحدث استخدامًا أولًا) — للتبديل الحي بينها.
  Stream<List<TrustedServer>> watchAll() {
    return (select(trustedServers)
          ..orderBy([(t) => OrderingTerm.desc(t.lastUsedAt)]))
        .watch();
  }

  Future<List<TrustedServer>> all() => select(trustedServers).get();

  Future<TrustedServer?> lastUsed() =>
      (select(trustedServers)..where((t) => t.isLastUsed)).getSingleOrNull();

  Future<TrustedServer?> byKey(String key) =>
      (select(trustedServers)..where((t) => t.serverKey.equals(key))).getSingleOrNull();

  /// إدراج أو تحديث (idempotent لكل "host:port").
  Future<void> upsert(TrustedServersCompanion entry) async {
    await into(trustedServers).insertOnConflictUpdate(entry);
  }

  /// تعليم خادم كآخر استخدام (يسوّي البقية).
  Future<void> markLastUsed(int id) async {
    await transaction(() async {
      await (update(trustedServers)..where((t) => t.isLastUsed))
          .write(const TrustedServersCompanion(isLastUsed: Value(false)));
      await (update(trustedServers)..where((t) => t.id.equals(id))).write(
        TrustedServersCompanion(
          isLastUsed: const Value(true),
          lastUsedAt: Value(DateTime.now()),
        ),
      );
    });
  }

  Future<void> forget(int id) =>
      (delete(trustedServers)..where((t) => t.id.equals(id))).go();

  Future<void> clearLastUsed() =>
      (update(trustedServers)..where((t) => t.isLastUsed))
          .write(const TrustedServersCompanion(isLastUsed: Value(false)));

  // ------------------------------------------------------------------
  // سجل النقل
  // ------------------------------------------------------------------

  /// بث السجل كاملًا (الأحدث تحديثًا أولًا).
  Stream<List<TransferRecord>> watchTransfers() {
    return (select(transferHistory)
          ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
        .watch();
  }

  Future<List<TransferRecord>> transfersAll() =>
      (select(transferHistory)..orderBy([(t) => OrderingTerm.desc(t.updatedAt)])).get();

  Future<TransferRecord?> transferById(String id) =>
      (select(transferHistory)..where((t) => t.id.equals(id))).getSingleOrNull();

  /// المهام غير المنتهية لسيرفر معين (لاستئنافها عند الإقلاع/الاتصال).
  Future<List<TransferRecord>> unfinished(String serverKey) =>
      (select(transferHistory)
            ..where((t) => t.serverKey.equals(serverKey) &
                t.state.isIn(['queued', 'active', 'paused'])))
          .get();

  Future<void> upsertTransfer(TransferHistoryCompanion entry) async {
    await into(transferHistory).insertOnConflictUpdate(entry);
  }

  Future<void> updateTransferProgress({
    required String id,
    required int transferred,
    required String state,
    String? error,
    String? finalPath,
    bool completed = false,
  }) async {
    await (update(transferHistory)..where((t) => t.id.equals(id))).write(
      TransferHistoryCompanion(
        transferredBytes: Value(BigInt.from(transferred)),
        state: Value(state),
        updatedAt: Value(DateTime.now()),
        error: error == null ? const Value.absent() : Value(error),
        finalPath: finalPath == null ? const Value.absent() : Value(finalPath),
        completedAt: completed ? Value(DateTime.now()) : const Value.absent(),
      ),
    );
  }

  Future<void> removeTransfer(String id) =>
      (delete(transferHistory)..where((t) => t.id.equals(id))).go();

  /// تنظيف السجلات المنتهية الأقدم من [days] يومًا.
  Future<int> purgeOldTransfers({int days = 30}) async {
    final cutoff = DateTime.now().subtract(Duration(days: days));
    return (delete(transferHistory)
          ..where((t) => t.updatedAt.isSmallerThanValue(cutoff) &
              t.state.isIn(['done', 'failed', 'cancelled'])))
        .go();
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'nexuslink.db'));
    return NativeDatabase.createInBackground(file);
  });
}
