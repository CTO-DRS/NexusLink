// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'nexus_db.dart';

// ignore_for_file: type=lint
class $TrustedServersTable extends TrustedServers
    with TableInfo<$TrustedServersTable, TrustedServer> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TrustedServersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _serverKeyMeta =
      const VerificationMeta('serverKey');
  @override
  late final GeneratedColumn<String> serverKey = GeneratedColumn<String>(
      'server_key', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways('UNIQUE'));
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
      'name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _hostMeta = const VerificationMeta('host');
  @override
  late final GeneratedColumn<String> host = GeneratedColumn<String>(
      'host', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _portMeta = const VerificationMeta('port');
  @override
  late final GeneratedColumn<int> port = GeneratedColumn<int>(
      'port', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _modeMeta = const VerificationMeta('mode');
  @override
  late final GeneratedColumn<String> mode = GeneratedColumn<String>(
      'mode', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deviceIdMeta =
      const VerificationMeta('deviceId');
  @override
  late final GeneratedColumn<String> deviceId = GeneratedColumn<String>(
      'device_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deviceNameMeta =
      const VerificationMeta('deviceName');
  @override
  late final GeneratedColumn<String> deviceName = GeneratedColumn<String>(
      'device_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _pairingSecretMeta =
      const VerificationMeta('pairingSecret');
  @override
  late final GeneratedColumn<String> pairingSecret = GeneratedColumn<String>(
      'pairing_secret', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _pairedAtMeta =
      const VerificationMeta('pairedAt');
  @override
  late final GeneratedColumn<DateTime> pairedAt = GeneratedColumn<DateTime>(
      'paired_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _lastUsedAtMeta =
      const VerificationMeta('lastUsedAt');
  @override
  late final GeneratedColumn<DateTime> lastUsedAt = GeneratedColumn<DateTime>(
      'last_used_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _isLastUsedMeta =
      const VerificationMeta('isLastUsed');
  @override
  late final GeneratedColumn<bool> isLastUsed = GeneratedColumn<bool>(
      'is_last_used', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("is_last_used" IN (0, 1))'),
      defaultValue: const Constant(false));
  @override
  List<GeneratedColumn> get $columns => [
        id,
        serverKey,
        name,
        host,
        port,
        mode,
        deviceId,
        deviceName,
        pairingSecret,
        pairedAt,
        lastUsedAt,
        isLastUsed
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'trusted_servers';
  @override
  VerificationContext validateIntegrity(Insertable<TrustedServer> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('server_key')) {
      context.handle(_serverKeyMeta,
          serverKey.isAcceptableOrUnknown(data['server_key']!, _serverKeyMeta));
    } else if (isInserting) {
      context.missing(_serverKeyMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
          _nameMeta, name.isAcceptableOrUnknown(data['name']!, _nameMeta));
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('host')) {
      context.handle(
          _hostMeta, host.isAcceptableOrUnknown(data['host']!, _hostMeta));
    } else if (isInserting) {
      context.missing(_hostMeta);
    }
    if (data.containsKey('port')) {
      context.handle(
          _portMeta, port.isAcceptableOrUnknown(data['port']!, _portMeta));
    } else if (isInserting) {
      context.missing(_portMeta);
    }
    if (data.containsKey('mode')) {
      context.handle(
          _modeMeta, mode.isAcceptableOrUnknown(data['mode']!, _modeMeta));
    } else if (isInserting) {
      context.missing(_modeMeta);
    }
    if (data.containsKey('device_id')) {
      context.handle(_deviceIdMeta,
          deviceId.isAcceptableOrUnknown(data['device_id']!, _deviceIdMeta));
    } else if (isInserting) {
      context.missing(_deviceIdMeta);
    }
    if (data.containsKey('device_name')) {
      context.handle(
          _deviceNameMeta,
          deviceName.isAcceptableOrUnknown(
              data['device_name']!, _deviceNameMeta));
    } else if (isInserting) {
      context.missing(_deviceNameMeta);
    }
    if (data.containsKey('pairing_secret')) {
      context.handle(
          _pairingSecretMeta,
          pairingSecret.isAcceptableOrUnknown(
              data['pairing_secret']!, _pairingSecretMeta));
    }
    if (data.containsKey('paired_at')) {
      context.handle(_pairedAtMeta,
          pairedAt.isAcceptableOrUnknown(data['paired_at']!, _pairedAtMeta));
    } else if (isInserting) {
      context.missing(_pairedAtMeta);
    }
    if (data.containsKey('last_used_at')) {
      context.handle(
          _lastUsedAtMeta,
          lastUsedAt.isAcceptableOrUnknown(
              data['last_used_at']!, _lastUsedAtMeta));
    } else if (isInserting) {
      context.missing(_lastUsedAtMeta);
    }
    if (data.containsKey('is_last_used')) {
      context.handle(
          _isLastUsedMeta,
          isLastUsed.isAcceptableOrUnknown(
              data['is_last_used']!, _isLastUsedMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  TrustedServer map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TrustedServer(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      serverKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}server_key'])!,
      name: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}name'])!,
      host: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}host'])!,
      port: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}port'])!,
      mode: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mode'])!,
      deviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_id'])!,
      deviceName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_name'])!,
      pairingSecret: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}pairing_secret']),
      pairedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}paired_at'])!,
      lastUsedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}last_used_at'])!,
      isLastUsed: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_last_used'])!,
    );
  }

  @override
  $TrustedServersTable createAlias(String alias) {
    return $TrustedServersTable(attachedDatabase, alias);
  }
}

class TrustedServer extends DataClass implements Insertable<TrustedServer> {
  final int id;

  /// مفتاح فريد: "host:port"
  final String serverKey;

  /// اسم السيرفر المعروض (من QR أو mDNS أو يدوي)
  final String name;
  final String host;

  /// منفذ الوصول (بوابة 81 أو REST 3000)
  final int port;

  /// gateway | direct
  final String mode;

  /// معرّفنا لدى السيرفر (ناتج الاقتران — NexusDevice.id)
  final String deviceId;

  /// اسم جهازنا كما سجّلناه
  final String deviceName;

  /// سر الاقتران الأخير (للعرض فقط؛ السيرفر يولّد سرًا جديدًا لكل QR)
  final String? pairingSecret;
  final DateTime pairedAt;
  final DateTime lastUsedAt;
  final bool isLastUsed;
  const TrustedServer(
      {required this.id,
      required this.serverKey,
      required this.name,
      required this.host,
      required this.port,
      required this.mode,
      required this.deviceId,
      required this.deviceName,
      this.pairingSecret,
      required this.pairedAt,
      required this.lastUsedAt,
      required this.isLastUsed});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['server_key'] = Variable<String>(serverKey);
    map['name'] = Variable<String>(name);
    map['host'] = Variable<String>(host);
    map['port'] = Variable<int>(port);
    map['mode'] = Variable<String>(mode);
    map['device_id'] = Variable<String>(deviceId);
    map['device_name'] = Variable<String>(deviceName);
    if (!nullToAbsent || pairingSecret != null) {
      map['pairing_secret'] = Variable<String>(pairingSecret);
    }
    map['paired_at'] = Variable<DateTime>(pairedAt);
    map['last_used_at'] = Variable<DateTime>(lastUsedAt);
    map['is_last_used'] = Variable<bool>(isLastUsed);
    return map;
  }

  TrustedServersCompanion toCompanion(bool nullToAbsent) {
    return TrustedServersCompanion(
      id: Value(id),
      serverKey: Value(serverKey),
      name: Value(name),
      host: Value(host),
      port: Value(port),
      mode: Value(mode),
      deviceId: Value(deviceId),
      deviceName: Value(deviceName),
      pairingSecret: pairingSecret == null && nullToAbsent
          ? const Value.absent()
          : Value(pairingSecret),
      pairedAt: Value(pairedAt),
      lastUsedAt: Value(lastUsedAt),
      isLastUsed: Value(isLastUsed),
    );
  }

  factory TrustedServer.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TrustedServer(
      id: serializer.fromJson<int>(json['id']),
      serverKey: serializer.fromJson<String>(json['serverKey']),
      name: serializer.fromJson<String>(json['name']),
      host: serializer.fromJson<String>(json['host']),
      port: serializer.fromJson<int>(json['port']),
      mode: serializer.fromJson<String>(json['mode']),
      deviceId: serializer.fromJson<String>(json['deviceId']),
      deviceName: serializer.fromJson<String>(json['deviceName']),
      pairingSecret: serializer.fromJson<String?>(json['pairingSecret']),
      pairedAt: serializer.fromJson<DateTime>(json['pairedAt']),
      lastUsedAt: serializer.fromJson<DateTime>(json['lastUsedAt']),
      isLastUsed: serializer.fromJson<bool>(json['isLastUsed']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'serverKey': serializer.toJson<String>(serverKey),
      'name': serializer.toJson<String>(name),
      'host': serializer.toJson<String>(host),
      'port': serializer.toJson<int>(port),
      'mode': serializer.toJson<String>(mode),
      'deviceId': serializer.toJson<String>(deviceId),
      'deviceName': serializer.toJson<String>(deviceName),
      'pairingSecret': serializer.toJson<String?>(pairingSecret),
      'pairedAt': serializer.toJson<DateTime>(pairedAt),
      'lastUsedAt': serializer.toJson<DateTime>(lastUsedAt),
      'isLastUsed': serializer.toJson<bool>(isLastUsed),
    };
  }

  TrustedServer copyWith(
          {int? id,
          String? serverKey,
          String? name,
          String? host,
          int? port,
          String? mode,
          String? deviceId,
          String? deviceName,
          Value<String?> pairingSecret = const Value.absent(),
          DateTime? pairedAt,
          DateTime? lastUsedAt,
          bool? isLastUsed}) =>
      TrustedServer(
        id: id ?? this.id,
        serverKey: serverKey ?? this.serverKey,
        name: name ?? this.name,
        host: host ?? this.host,
        port: port ?? this.port,
        mode: mode ?? this.mode,
        deviceId: deviceId ?? this.deviceId,
        deviceName: deviceName ?? this.deviceName,
        pairingSecret:
            pairingSecret.present ? pairingSecret.value : this.pairingSecret,
        pairedAt: pairedAt ?? this.pairedAt,
        lastUsedAt: lastUsedAt ?? this.lastUsedAt,
        isLastUsed: isLastUsed ?? this.isLastUsed,
      );
  TrustedServer copyWithCompanion(TrustedServersCompanion data) {
    return TrustedServer(
      id: data.id.present ? data.id.value : this.id,
      serverKey: data.serverKey.present ? data.serverKey.value : this.serverKey,
      name: data.name.present ? data.name.value : this.name,
      host: data.host.present ? data.host.value : this.host,
      port: data.port.present ? data.port.value : this.port,
      mode: data.mode.present ? data.mode.value : this.mode,
      deviceId: data.deviceId.present ? data.deviceId.value : this.deviceId,
      deviceName:
          data.deviceName.present ? data.deviceName.value : this.deviceName,
      pairingSecret: data.pairingSecret.present
          ? data.pairingSecret.value
          : this.pairingSecret,
      pairedAt: data.pairedAt.present ? data.pairedAt.value : this.pairedAt,
      lastUsedAt:
          data.lastUsedAt.present ? data.lastUsedAt.value : this.lastUsedAt,
      isLastUsed:
          data.isLastUsed.present ? data.isLastUsed.value : this.isLastUsed,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TrustedServer(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('name: $name, ')
          ..write('host: $host, ')
          ..write('port: $port, ')
          ..write('mode: $mode, ')
          ..write('deviceId: $deviceId, ')
          ..write('deviceName: $deviceName, ')
          ..write('pairingSecret: $pairingSecret, ')
          ..write('pairedAt: $pairedAt, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('isLastUsed: $isLastUsed')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, serverKey, name, host, port, mode,
      deviceId, deviceName, pairingSecret, pairedAt, lastUsedAt, isLastUsed);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TrustedServer &&
          other.id == this.id &&
          other.serverKey == this.serverKey &&
          other.name == this.name &&
          other.host == this.host &&
          other.port == this.port &&
          other.mode == this.mode &&
          other.deviceId == this.deviceId &&
          other.deviceName == this.deviceName &&
          other.pairingSecret == this.pairingSecret &&
          other.pairedAt == this.pairedAt &&
          other.lastUsedAt == this.lastUsedAt &&
          other.isLastUsed == this.isLastUsed);
}

class TrustedServersCompanion extends UpdateCompanion<TrustedServer> {
  final Value<int> id;
  final Value<String> serverKey;
  final Value<String> name;
  final Value<String> host;
  final Value<int> port;
  final Value<String> mode;
  final Value<String> deviceId;
  final Value<String> deviceName;
  final Value<String?> pairingSecret;
  final Value<DateTime> pairedAt;
  final Value<DateTime> lastUsedAt;
  final Value<bool> isLastUsed;
  const TrustedServersCompanion({
    this.id = const Value.absent(),
    this.serverKey = const Value.absent(),
    this.name = const Value.absent(),
    this.host = const Value.absent(),
    this.port = const Value.absent(),
    this.mode = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.deviceName = const Value.absent(),
    this.pairingSecret = const Value.absent(),
    this.pairedAt = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.isLastUsed = const Value.absent(),
  });
  TrustedServersCompanion.insert({
    this.id = const Value.absent(),
    required String serverKey,
    required String name,
    required String host,
    required int port,
    required String mode,
    required String deviceId,
    required String deviceName,
    this.pairingSecret = const Value.absent(),
    required DateTime pairedAt,
    required DateTime lastUsedAt,
    this.isLastUsed = const Value.absent(),
  })  : serverKey = Value(serverKey),
        name = Value(name),
        host = Value(host),
        port = Value(port),
        mode = Value(mode),
        deviceId = Value(deviceId),
        deviceName = Value(deviceName),
        pairedAt = Value(pairedAt),
        lastUsedAt = Value(lastUsedAt);
  static Insertable<TrustedServer> custom({
    Expression<int>? id,
    Expression<String>? serverKey,
    Expression<String>? name,
    Expression<String>? host,
    Expression<int>? port,
    Expression<String>? mode,
    Expression<String>? deviceId,
    Expression<String>? deviceName,
    Expression<String>? pairingSecret,
    Expression<DateTime>? pairedAt,
    Expression<DateTime>? lastUsedAt,
    Expression<bool>? isLastUsed,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (serverKey != null) 'server_key': serverKey,
      if (name != null) 'name': name,
      if (host != null) 'host': host,
      if (port != null) 'port': port,
      if (mode != null) 'mode': mode,
      if (deviceId != null) 'device_id': deviceId,
      if (deviceName != null) 'device_name': deviceName,
      if (pairingSecret != null) 'pairing_secret': pairingSecret,
      if (pairedAt != null) 'paired_at': pairedAt,
      if (lastUsedAt != null) 'last_used_at': lastUsedAt,
      if (isLastUsed != null) 'is_last_used': isLastUsed,
    });
  }

  TrustedServersCompanion copyWith(
      {Value<int>? id,
      Value<String>? serverKey,
      Value<String>? name,
      Value<String>? host,
      Value<int>? port,
      Value<String>? mode,
      Value<String>? deviceId,
      Value<String>? deviceName,
      Value<String?>? pairingSecret,
      Value<DateTime>? pairedAt,
      Value<DateTime>? lastUsedAt,
      Value<bool>? isLastUsed}) {
    return TrustedServersCompanion(
      id: id ?? this.id,
      serverKey: serverKey ?? this.serverKey,
      name: name ?? this.name,
      host: host ?? this.host,
      port: port ?? this.port,
      mode: mode ?? this.mode,
      deviceId: deviceId ?? this.deviceId,
      deviceName: deviceName ?? this.deviceName,
      pairingSecret: pairingSecret ?? this.pairingSecret,
      pairedAt: pairedAt ?? this.pairedAt,
      lastUsedAt: lastUsedAt ?? this.lastUsedAt,
      isLastUsed: isLastUsed ?? this.isLastUsed,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (serverKey.present) {
      map['server_key'] = Variable<String>(serverKey.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (host.present) {
      map['host'] = Variable<String>(host.value);
    }
    if (port.present) {
      map['port'] = Variable<int>(port.value);
    }
    if (mode.present) {
      map['mode'] = Variable<String>(mode.value);
    }
    if (deviceId.present) {
      map['device_id'] = Variable<String>(deviceId.value);
    }
    if (deviceName.present) {
      map['device_name'] = Variable<String>(deviceName.value);
    }
    if (pairingSecret.present) {
      map['pairing_secret'] = Variable<String>(pairingSecret.value);
    }
    if (pairedAt.present) {
      map['paired_at'] = Variable<DateTime>(pairedAt.value);
    }
    if (lastUsedAt.present) {
      map['last_used_at'] = Variable<DateTime>(lastUsedAt.value);
    }
    if (isLastUsed.present) {
      map['is_last_used'] = Variable<bool>(isLastUsed.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TrustedServersCompanion(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('name: $name, ')
          ..write('host: $host, ')
          ..write('port: $port, ')
          ..write('mode: $mode, ')
          ..write('deviceId: $deviceId, ')
          ..write('deviceName: $deviceName, ')
          ..write('pairingSecret: $pairingSecret, ')
          ..write('pairedAt: $pairedAt, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('isLastUsed: $isLastUsed')
          ..write(')'))
        .toString();
  }
}

class $TransferHistoryTable extends TransferHistory
    with TableInfo<$TransferHistoryTable, TransferRecord> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TransferHistoryTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _serverKeyMeta =
      const VerificationMeta('serverKey');
  @override
  late final GeneratedColumn<String> serverKey = GeneratedColumn<String>(
      'server_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
      'kind', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _fileNameMeta =
      const VerificationMeta('fileName');
  @override
  late final GeneratedColumn<String> fileName = GeneratedColumn<String>(
      'file_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _mimeMeta = const VerificationMeta('mime');
  @override
  late final GeneratedColumn<String> mime = GeneratedColumn<String>(
      'mime', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _sizeBytesMeta =
      const VerificationMeta('sizeBytes');
  @override
  late final GeneratedColumn<BigInt> sizeBytes = GeneratedColumn<BigInt>(
      'size_bytes', aliasedName, false,
      type: DriftSqlType.bigInt, requiredDuringInsert: true);
  static const VerificationMeta _transferredBytesMeta =
      const VerificationMeta('transferredBytes');
  @override
  late final GeneratedColumn<BigInt> transferredBytes = GeneratedColumn<BigInt>(
      'transferred_bytes', aliasedName, false,
      type: DriftSqlType.bigInt,
      requiredDuringInsert: false,
      defaultValue: Constant(BigInt.zero));
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
      'state', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _localPathMeta =
      const VerificationMeta('localPath');
  @override
  late final GeneratedColumn<String> localPath = GeneratedColumn<String>(
      'local_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _tempPathMeta =
      const VerificationMeta('tempPath');
  @override
  late final GeneratedColumn<String> tempPath = GeneratedColumn<String>(
      'temp_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _finalPathMeta =
      const VerificationMeta('finalPath');
  @override
  late final GeneratedColumn<String> finalPath = GeneratedColumn<String>(
      'final_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _remoteVPathMeta =
      const VerificationMeta('remoteVPath');
  @override
  late final GeneratedColumn<String> remoteVPath = GeneratedColumn<String>(
      'remote_v_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _srcDeviceIdMeta =
      const VerificationMeta('srcDeviceId');
  @override
  late final GeneratedColumn<String> srcDeviceId = GeneratedColumn<String>(
      'src_device_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _offerIdMeta =
      const VerificationMeta('offerId');
  @override
  late final GeneratedColumn<String> offerId = GeneratedColumn<String>(
      'offer_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _fromNameMeta =
      const VerificationMeta('fromName');
  @override
  late final GeneratedColumn<String> fromName = GeneratedColumn<String>(
      'from_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _autoAcceptedMeta =
      const VerificationMeta('autoAccepted');
  @override
  late final GeneratedColumn<bool> autoAccepted = GeneratedColumn<bool>(
      'auto_accepted', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("auto_accepted" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _errorMeta = const VerificationMeta('error');
  @override
  late final GeneratedColumn<String> error = GeneratedColumn<String>(
      'error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _startedAtMeta =
      const VerificationMeta('startedAt');
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
      'started_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _completedAtMeta =
      const VerificationMeta('completedAt');
  @override
  late final GeneratedColumn<DateTime> completedAt = GeneratedColumn<DateTime>(
      'completed_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        serverKey,
        kind,
        fileName,
        mime,
        sizeBytes,
        transferredBytes,
        state,
        localPath,
        tempPath,
        finalPath,
        remoteVPath,
        srcDeviceId,
        offerId,
        fromName,
        autoAccepted,
        error,
        startedAt,
        updatedAt,
        completedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'transfer_history';
  @override
  VerificationContext validateIntegrity(Insertable<TransferRecord> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('server_key')) {
      context.handle(_serverKeyMeta,
          serverKey.isAcceptableOrUnknown(data['server_key']!, _serverKeyMeta));
    } else if (isInserting) {
      context.missing(_serverKeyMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
          _kindMeta, kind.isAcceptableOrUnknown(data['kind']!, _kindMeta));
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('file_name')) {
      context.handle(_fileNameMeta,
          fileName.isAcceptableOrUnknown(data['file_name']!, _fileNameMeta));
    } else if (isInserting) {
      context.missing(_fileNameMeta);
    }
    if (data.containsKey('mime')) {
      context.handle(
          _mimeMeta, mime.isAcceptableOrUnknown(data['mime']!, _mimeMeta));
    }
    if (data.containsKey('size_bytes')) {
      context.handle(_sizeBytesMeta,
          sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta));
    } else if (isInserting) {
      context.missing(_sizeBytesMeta);
    }
    if (data.containsKey('transferred_bytes')) {
      context.handle(
          _transferredBytesMeta,
          transferredBytes.isAcceptableOrUnknown(
              data['transferred_bytes']!, _transferredBytesMeta));
    }
    if (data.containsKey('state')) {
      context.handle(
          _stateMeta, state.isAcceptableOrUnknown(data['state']!, _stateMeta));
    } else if (isInserting) {
      context.missing(_stateMeta);
    }
    if (data.containsKey('local_path')) {
      context.handle(_localPathMeta,
          localPath.isAcceptableOrUnknown(data['local_path']!, _localPathMeta));
    }
    if (data.containsKey('temp_path')) {
      context.handle(_tempPathMeta,
          tempPath.isAcceptableOrUnknown(data['temp_path']!, _tempPathMeta));
    }
    if (data.containsKey('final_path')) {
      context.handle(_finalPathMeta,
          finalPath.isAcceptableOrUnknown(data['final_path']!, _finalPathMeta));
    }
    if (data.containsKey('remote_v_path')) {
      context.handle(
          _remoteVPathMeta,
          remoteVPath.isAcceptableOrUnknown(
              data['remote_v_path']!, _remoteVPathMeta));
    }
    if (data.containsKey('src_device_id')) {
      context.handle(
          _srcDeviceIdMeta,
          srcDeviceId.isAcceptableOrUnknown(
              data['src_device_id']!, _srcDeviceIdMeta));
    }
    if (data.containsKey('offer_id')) {
      context.handle(_offerIdMeta,
          offerId.isAcceptableOrUnknown(data['offer_id']!, _offerIdMeta));
    }
    if (data.containsKey('from_name')) {
      context.handle(_fromNameMeta,
          fromName.isAcceptableOrUnknown(data['from_name']!, _fromNameMeta));
    }
    if (data.containsKey('auto_accepted')) {
      context.handle(
          _autoAcceptedMeta,
          autoAccepted.isAcceptableOrUnknown(
              data['auto_accepted']!, _autoAcceptedMeta));
    }
    if (data.containsKey('error')) {
      context.handle(
          _errorMeta, error.isAcceptableOrUnknown(data['error']!, _errorMeta));
    }
    if (data.containsKey('started_at')) {
      context.handle(_startedAtMeta,
          startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta));
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('completed_at')) {
      context.handle(
          _completedAtMeta,
          completedAt.isAcceptableOrUnknown(
              data['completed_at']!, _completedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => const {};
  @override
  TransferRecord map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TransferRecord(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      serverKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}server_key'])!,
      kind: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}kind'])!,
      fileName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}file_name'])!,
      mime: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mime']),
      sizeBytes: attachedDatabase.typeMapping
          .read(DriftSqlType.bigInt, data['${effectivePrefix}size_bytes'])!,
      transferredBytes: attachedDatabase.typeMapping.read(
          DriftSqlType.bigInt, data['${effectivePrefix}transferred_bytes'])!,
      state: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}state'])!,
      localPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}local_path']),
      tempPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}temp_path']),
      finalPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}final_path']),
      remoteVPath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_v_path']),
      srcDeviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}src_device_id']),
      offerId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}offer_id']),
      fromName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}from_name']),
      autoAccepted: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}auto_accepted'])!,
      error: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}error']),
      startedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}started_at'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
      completedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}completed_at']),
    );
  }

  @override
  $TransferHistoryTable createAlias(String alias) {
    return $TransferHistoryTable(attachedDatabase, alias);
  }
}

class TransferRecord extends DataClass implements Insertable<TransferRecord> {
  /// معرّف مستقر محليًا (نفسه taskId لدى السيرفر للرفع — يجعل الاستئناف idempotent)
  final String id;

  /// "host:port" للسيرفر الذي تخصه المهمة
  final String serverKey;

  /// upload | download
  final String kind;
  final String fileName;
  final String? mime;
  final BigInt sizeBytes;
  final BigInt transferredBytes;

  /// queued | active | paused | done | failed | cancelled
  final String state;

  /// الرفع: مسار الملف المصدر على الهاتف
  final String? localPath;

  /// التنزيل: مسار الجزئي المحلي (.nexuspart) الذي يُستأنف منه
  final String? tempPath;

  /// المسار النهائي بعد الإكمال (محلي منشور / افتراضي على السيرفر)
  final String? finalPath;

  /// الرفع: مجلد الوجهة الافتراضي؛ التنزيل: مسار المصدر الافتراضي
  final String? remoteVPath;

  /// التنزيل: الجهاز الافتراضي المصدر على السيرفر
  final String? srcDeviceId;

  /// التنزيل: معرّف مهمة السيرفر (tx_…) — لإعادة الربط بعد إعادة التشغيل
  final String? offerId;

  /// التنزيل: اسم المُرسل (للعرض)
  final String? fromName;
  final bool autoAccepted;
  final String? error;
  final DateTime startedAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  const TransferRecord(
      {required this.id,
      required this.serverKey,
      required this.kind,
      required this.fileName,
      this.mime,
      required this.sizeBytes,
      required this.transferredBytes,
      required this.state,
      this.localPath,
      this.tempPath,
      this.finalPath,
      this.remoteVPath,
      this.srcDeviceId,
      this.offerId,
      this.fromName,
      required this.autoAccepted,
      this.error,
      required this.startedAt,
      required this.updatedAt,
      this.completedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['server_key'] = Variable<String>(serverKey);
    map['kind'] = Variable<String>(kind);
    map['file_name'] = Variable<String>(fileName);
    if (!nullToAbsent || mime != null) {
      map['mime'] = Variable<String>(mime);
    }
    map['size_bytes'] = Variable<BigInt>(sizeBytes);
    map['transferred_bytes'] = Variable<BigInt>(transferredBytes);
    map['state'] = Variable<String>(state);
    if (!nullToAbsent || localPath != null) {
      map['local_path'] = Variable<String>(localPath);
    }
    if (!nullToAbsent || tempPath != null) {
      map['temp_path'] = Variable<String>(tempPath);
    }
    if (!nullToAbsent || finalPath != null) {
      map['final_path'] = Variable<String>(finalPath);
    }
    if (!nullToAbsent || remoteVPath != null) {
      map['remote_v_path'] = Variable<String>(remoteVPath);
    }
    if (!nullToAbsent || srcDeviceId != null) {
      map['src_device_id'] = Variable<String>(srcDeviceId);
    }
    if (!nullToAbsent || offerId != null) {
      map['offer_id'] = Variable<String>(offerId);
    }
    if (!nullToAbsent || fromName != null) {
      map['from_name'] = Variable<String>(fromName);
    }
    map['auto_accepted'] = Variable<bool>(autoAccepted);
    if (!nullToAbsent || error != null) {
      map['error'] = Variable<String>(error);
    }
    map['started_at'] = Variable<DateTime>(startedAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    if (!nullToAbsent || completedAt != null) {
      map['completed_at'] = Variable<DateTime>(completedAt);
    }
    return map;
  }

  TransferHistoryCompanion toCompanion(bool nullToAbsent) {
    return TransferHistoryCompanion(
      id: Value(id),
      serverKey: Value(serverKey),
      kind: Value(kind),
      fileName: Value(fileName),
      mime: mime == null && nullToAbsent ? const Value.absent() : Value(mime),
      sizeBytes: Value(sizeBytes),
      transferredBytes: Value(transferredBytes),
      state: Value(state),
      localPath: localPath == null && nullToAbsent
          ? const Value.absent()
          : Value(localPath),
      tempPath: tempPath == null && nullToAbsent
          ? const Value.absent()
          : Value(tempPath),
      finalPath: finalPath == null && nullToAbsent
          ? const Value.absent()
          : Value(finalPath),
      remoteVPath: remoteVPath == null && nullToAbsent
          ? const Value.absent()
          : Value(remoteVPath),
      srcDeviceId: srcDeviceId == null && nullToAbsent
          ? const Value.absent()
          : Value(srcDeviceId),
      offerId: offerId == null && nullToAbsent
          ? const Value.absent()
          : Value(offerId),
      fromName: fromName == null && nullToAbsent
          ? const Value.absent()
          : Value(fromName),
      autoAccepted: Value(autoAccepted),
      error:
          error == null && nullToAbsent ? const Value.absent() : Value(error),
      startedAt: Value(startedAt),
      updatedAt: Value(updatedAt),
      completedAt: completedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAt),
    );
  }

  factory TransferRecord.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TransferRecord(
      id: serializer.fromJson<String>(json['id']),
      serverKey: serializer.fromJson<String>(json['serverKey']),
      kind: serializer.fromJson<String>(json['kind']),
      fileName: serializer.fromJson<String>(json['fileName']),
      mime: serializer.fromJson<String?>(json['mime']),
      sizeBytes: serializer.fromJson<BigInt>(json['sizeBytes']),
      transferredBytes: serializer.fromJson<BigInt>(json['transferredBytes']),
      state: serializer.fromJson<String>(json['state']),
      localPath: serializer.fromJson<String?>(json['localPath']),
      tempPath: serializer.fromJson<String?>(json['tempPath']),
      finalPath: serializer.fromJson<String?>(json['finalPath']),
      remoteVPath: serializer.fromJson<String?>(json['remoteVPath']),
      srcDeviceId: serializer.fromJson<String?>(json['srcDeviceId']),
      offerId: serializer.fromJson<String?>(json['offerId']),
      fromName: serializer.fromJson<String?>(json['fromName']),
      autoAccepted: serializer.fromJson<bool>(json['autoAccepted']),
      error: serializer.fromJson<String?>(json['error']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
      completedAt: serializer.fromJson<DateTime?>(json['completedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'serverKey': serializer.toJson<String>(serverKey),
      'kind': serializer.toJson<String>(kind),
      'fileName': serializer.toJson<String>(fileName),
      'mime': serializer.toJson<String?>(mime),
      'sizeBytes': serializer.toJson<BigInt>(sizeBytes),
      'transferredBytes': serializer.toJson<BigInt>(transferredBytes),
      'state': serializer.toJson<String>(state),
      'localPath': serializer.toJson<String?>(localPath),
      'tempPath': serializer.toJson<String?>(tempPath),
      'finalPath': serializer.toJson<String?>(finalPath),
      'remoteVPath': serializer.toJson<String?>(remoteVPath),
      'srcDeviceId': serializer.toJson<String?>(srcDeviceId),
      'offerId': serializer.toJson<String?>(offerId),
      'fromName': serializer.toJson<String?>(fromName),
      'autoAccepted': serializer.toJson<bool>(autoAccepted),
      'error': serializer.toJson<String?>(error),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
      'completedAt': serializer.toJson<DateTime?>(completedAt),
    };
  }

  TransferRecord copyWith(
          {String? id,
          String? serverKey,
          String? kind,
          String? fileName,
          Value<String?> mime = const Value.absent(),
          BigInt? sizeBytes,
          BigInt? transferredBytes,
          String? state,
          Value<String?> localPath = const Value.absent(),
          Value<String?> tempPath = const Value.absent(),
          Value<String?> finalPath = const Value.absent(),
          Value<String?> remoteVPath = const Value.absent(),
          Value<String?> srcDeviceId = const Value.absent(),
          Value<String?> offerId = const Value.absent(),
          Value<String?> fromName = const Value.absent(),
          bool? autoAccepted,
          Value<String?> error = const Value.absent(),
          DateTime? startedAt,
          DateTime? updatedAt,
          Value<DateTime?> completedAt = const Value.absent()}) =>
      TransferRecord(
        id: id ?? this.id,
        serverKey: serverKey ?? this.serverKey,
        kind: kind ?? this.kind,
        fileName: fileName ?? this.fileName,
        mime: mime.present ? mime.value : this.mime,
        sizeBytes: sizeBytes ?? this.sizeBytes,
        transferredBytes: transferredBytes ?? this.transferredBytes,
        state: state ?? this.state,
        localPath: localPath.present ? localPath.value : this.localPath,
        tempPath: tempPath.present ? tempPath.value : this.tempPath,
        finalPath: finalPath.present ? finalPath.value : this.finalPath,
        remoteVPath: remoteVPath.present ? remoteVPath.value : this.remoteVPath,
        srcDeviceId: srcDeviceId.present ? srcDeviceId.value : this.srcDeviceId,
        offerId: offerId.present ? offerId.value : this.offerId,
        fromName: fromName.present ? fromName.value : this.fromName,
        autoAccepted: autoAccepted ?? this.autoAccepted,
        error: error.present ? error.value : this.error,
        startedAt: startedAt ?? this.startedAt,
        updatedAt: updatedAt ?? this.updatedAt,
        completedAt: completedAt.present ? completedAt.value : this.completedAt,
      );
  TransferRecord copyWithCompanion(TransferHistoryCompanion data) {
    return TransferRecord(
      id: data.id.present ? data.id.value : this.id,
      serverKey: data.serverKey.present ? data.serverKey.value : this.serverKey,
      kind: data.kind.present ? data.kind.value : this.kind,
      fileName: data.fileName.present ? data.fileName.value : this.fileName,
      mime: data.mime.present ? data.mime.value : this.mime,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      transferredBytes: data.transferredBytes.present
          ? data.transferredBytes.value
          : this.transferredBytes,
      state: data.state.present ? data.state.value : this.state,
      localPath: data.localPath.present ? data.localPath.value : this.localPath,
      tempPath: data.tempPath.present ? data.tempPath.value : this.tempPath,
      finalPath: data.finalPath.present ? data.finalPath.value : this.finalPath,
      remoteVPath:
          data.remoteVPath.present ? data.remoteVPath.value : this.remoteVPath,
      srcDeviceId:
          data.srcDeviceId.present ? data.srcDeviceId.value : this.srcDeviceId,
      offerId: data.offerId.present ? data.offerId.value : this.offerId,
      fromName: data.fromName.present ? data.fromName.value : this.fromName,
      autoAccepted: data.autoAccepted.present
          ? data.autoAccepted.value
          : this.autoAccepted,
      error: data.error.present ? data.error.value : this.error,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      completedAt:
          data.completedAt.present ? data.completedAt.value : this.completedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TransferRecord(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('kind: $kind, ')
          ..write('fileName: $fileName, ')
          ..write('mime: $mime, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('transferredBytes: $transferredBytes, ')
          ..write('state: $state, ')
          ..write('localPath: $localPath, ')
          ..write('tempPath: $tempPath, ')
          ..write('finalPath: $finalPath, ')
          ..write('remoteVPath: $remoteVPath, ')
          ..write('srcDeviceId: $srcDeviceId, ')
          ..write('offerId: $offerId, ')
          ..write('fromName: $fromName, ')
          ..write('autoAccepted: $autoAccepted, ')
          ..write('error: $error, ')
          ..write('startedAt: $startedAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('completedAt: $completedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      serverKey,
      kind,
      fileName,
      mime,
      sizeBytes,
      transferredBytes,
      state,
      localPath,
      tempPath,
      finalPath,
      remoteVPath,
      srcDeviceId,
      offerId,
      fromName,
      autoAccepted,
      error,
      startedAt,
      updatedAt,
      completedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TransferRecord &&
          other.id == this.id &&
          other.serverKey == this.serverKey &&
          other.kind == this.kind &&
          other.fileName == this.fileName &&
          other.mime == this.mime &&
          other.sizeBytes == this.sizeBytes &&
          other.transferredBytes == this.transferredBytes &&
          other.state == this.state &&
          other.localPath == this.localPath &&
          other.tempPath == this.tempPath &&
          other.finalPath == this.finalPath &&
          other.remoteVPath == this.remoteVPath &&
          other.srcDeviceId == this.srcDeviceId &&
          other.offerId == this.offerId &&
          other.fromName == this.fromName &&
          other.autoAccepted == this.autoAccepted &&
          other.error == this.error &&
          other.startedAt == this.startedAt &&
          other.updatedAt == this.updatedAt &&
          other.completedAt == this.completedAt);
}

class TransferHistoryCompanion extends UpdateCompanion<TransferRecord> {
  final Value<String> id;
  final Value<String> serverKey;
  final Value<String> kind;
  final Value<String> fileName;
  final Value<String?> mime;
  final Value<BigInt> sizeBytes;
  final Value<BigInt> transferredBytes;
  final Value<String> state;
  final Value<String?> localPath;
  final Value<String?> tempPath;
  final Value<String?> finalPath;
  final Value<String?> remoteVPath;
  final Value<String?> srcDeviceId;
  final Value<String?> offerId;
  final Value<String?> fromName;
  final Value<bool> autoAccepted;
  final Value<String?> error;
  final Value<DateTime> startedAt;
  final Value<DateTime> updatedAt;
  final Value<DateTime?> completedAt;
  final Value<int> rowid;
  const TransferHistoryCompanion({
    this.id = const Value.absent(),
    this.serverKey = const Value.absent(),
    this.kind = const Value.absent(),
    this.fileName = const Value.absent(),
    this.mime = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.transferredBytes = const Value.absent(),
    this.state = const Value.absent(),
    this.localPath = const Value.absent(),
    this.tempPath = const Value.absent(),
    this.finalPath = const Value.absent(),
    this.remoteVPath = const Value.absent(),
    this.srcDeviceId = const Value.absent(),
    this.offerId = const Value.absent(),
    this.fromName = const Value.absent(),
    this.autoAccepted = const Value.absent(),
    this.error = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.completedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TransferHistoryCompanion.insert({
    required String id,
    required String serverKey,
    required String kind,
    required String fileName,
    this.mime = const Value.absent(),
    required BigInt sizeBytes,
    this.transferredBytes = const Value.absent(),
    required String state,
    this.localPath = const Value.absent(),
    this.tempPath = const Value.absent(),
    this.finalPath = const Value.absent(),
    this.remoteVPath = const Value.absent(),
    this.srcDeviceId = const Value.absent(),
    this.offerId = const Value.absent(),
    this.fromName = const Value.absent(),
    this.autoAccepted = const Value.absent(),
    this.error = const Value.absent(),
    required DateTime startedAt,
    required DateTime updatedAt,
    this.completedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        serverKey = Value(serverKey),
        kind = Value(kind),
        fileName = Value(fileName),
        sizeBytes = Value(sizeBytes),
        state = Value(state),
        startedAt = Value(startedAt),
        updatedAt = Value(updatedAt);
  static Insertable<TransferRecord> custom({
    Expression<String>? id,
    Expression<String>? serverKey,
    Expression<String>? kind,
    Expression<String>? fileName,
    Expression<String>? mime,
    Expression<BigInt>? sizeBytes,
    Expression<BigInt>? transferredBytes,
    Expression<String>? state,
    Expression<String>? localPath,
    Expression<String>? tempPath,
    Expression<String>? finalPath,
    Expression<String>? remoteVPath,
    Expression<String>? srcDeviceId,
    Expression<String>? offerId,
    Expression<String>? fromName,
    Expression<bool>? autoAccepted,
    Expression<String>? error,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? updatedAt,
    Expression<DateTime>? completedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (serverKey != null) 'server_key': serverKey,
      if (kind != null) 'kind': kind,
      if (fileName != null) 'file_name': fileName,
      if (mime != null) 'mime': mime,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (transferredBytes != null) 'transferred_bytes': transferredBytes,
      if (state != null) 'state': state,
      if (localPath != null) 'local_path': localPath,
      if (tempPath != null) 'temp_path': tempPath,
      if (finalPath != null) 'final_path': finalPath,
      if (remoteVPath != null) 'remote_v_path': remoteVPath,
      if (srcDeviceId != null) 'src_device_id': srcDeviceId,
      if (offerId != null) 'offer_id': offerId,
      if (fromName != null) 'from_name': fromName,
      if (autoAccepted != null) 'auto_accepted': autoAccepted,
      if (error != null) 'error': error,
      if (startedAt != null) 'started_at': startedAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (completedAt != null) 'completed_at': completedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TransferHistoryCompanion copyWith(
      {Value<String>? id,
      Value<String>? serverKey,
      Value<String>? kind,
      Value<String>? fileName,
      Value<String?>? mime,
      Value<BigInt>? sizeBytes,
      Value<BigInt>? transferredBytes,
      Value<String>? state,
      Value<String?>? localPath,
      Value<String?>? tempPath,
      Value<String?>? finalPath,
      Value<String?>? remoteVPath,
      Value<String?>? srcDeviceId,
      Value<String?>? offerId,
      Value<String?>? fromName,
      Value<bool>? autoAccepted,
      Value<String?>? error,
      Value<DateTime>? startedAt,
      Value<DateTime>? updatedAt,
      Value<DateTime?>? completedAt,
      Value<int>? rowid}) {
    return TransferHistoryCompanion(
      id: id ?? this.id,
      serverKey: serverKey ?? this.serverKey,
      kind: kind ?? this.kind,
      fileName: fileName ?? this.fileName,
      mime: mime ?? this.mime,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      transferredBytes: transferredBytes ?? this.transferredBytes,
      state: state ?? this.state,
      localPath: localPath ?? this.localPath,
      tempPath: tempPath ?? this.tempPath,
      finalPath: finalPath ?? this.finalPath,
      remoteVPath: remoteVPath ?? this.remoteVPath,
      srcDeviceId: srcDeviceId ?? this.srcDeviceId,
      offerId: offerId ?? this.offerId,
      fromName: fromName ?? this.fromName,
      autoAccepted: autoAccepted ?? this.autoAccepted,
      error: error ?? this.error,
      startedAt: startedAt ?? this.startedAt,
      updatedAt: updatedAt ?? this.updatedAt,
      completedAt: completedAt ?? this.completedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (serverKey.present) {
      map['server_key'] = Variable<String>(serverKey.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (fileName.present) {
      map['file_name'] = Variable<String>(fileName.value);
    }
    if (mime.present) {
      map['mime'] = Variable<String>(mime.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<BigInt>(sizeBytes.value);
    }
    if (transferredBytes.present) {
      map['transferred_bytes'] = Variable<BigInt>(transferredBytes.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (localPath.present) {
      map['local_path'] = Variable<String>(localPath.value);
    }
    if (tempPath.present) {
      map['temp_path'] = Variable<String>(tempPath.value);
    }
    if (finalPath.present) {
      map['final_path'] = Variable<String>(finalPath.value);
    }
    if (remoteVPath.present) {
      map['remote_v_path'] = Variable<String>(remoteVPath.value);
    }
    if (srcDeviceId.present) {
      map['src_device_id'] = Variable<String>(srcDeviceId.value);
    }
    if (offerId.present) {
      map['offer_id'] = Variable<String>(offerId.value);
    }
    if (fromName.present) {
      map['from_name'] = Variable<String>(fromName.value);
    }
    if (autoAccepted.present) {
      map['auto_accepted'] = Variable<bool>(autoAccepted.value);
    }
    if (error.present) {
      map['error'] = Variable<String>(error.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (completedAt.present) {
      map['completed_at'] = Variable<DateTime>(completedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TransferHistoryCompanion(')
          ..write('id: $id, ')
          ..write('serverKey: $serverKey, ')
          ..write('kind: $kind, ')
          ..write('fileName: $fileName, ')
          ..write('mime: $mime, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('transferredBytes: $transferredBytes, ')
          ..write('state: $state, ')
          ..write('localPath: $localPath, ')
          ..write('tempPath: $tempPath, ')
          ..write('finalPath: $finalPath, ')
          ..write('remoteVPath: $remoteVPath, ')
          ..write('srcDeviceId: $srcDeviceId, ')
          ..write('offerId: $offerId, ')
          ..write('fromName: $fromName, ')
          ..write('autoAccepted: $autoAccepted, ')
          ..write('error: $error, ')
          ..write('startedAt: $startedAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('completedAt: $completedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$NexusDatabase extends GeneratedDatabase {
  _$NexusDatabase(QueryExecutor e) : super(e);
  $NexusDatabaseManager get managers => $NexusDatabaseManager(this);
  late final $TrustedServersTable trustedServers = $TrustedServersTable(this);
  late final $TransferHistoryTable transferHistory =
      $TransferHistoryTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities =>
      [trustedServers, transferHistory];
}

typedef $$TrustedServersTableCreateCompanionBuilder = TrustedServersCompanion
    Function({
  Value<int> id,
  required String serverKey,
  required String name,
  required String host,
  required int port,
  required String mode,
  required String deviceId,
  required String deviceName,
  Value<String?> pairingSecret,
  required DateTime pairedAt,
  required DateTime lastUsedAt,
  Value<bool> isLastUsed,
});
typedef $$TrustedServersTableUpdateCompanionBuilder = TrustedServersCompanion
    Function({
  Value<int> id,
  Value<String> serverKey,
  Value<String> name,
  Value<String> host,
  Value<int> port,
  Value<String> mode,
  Value<String> deviceId,
  Value<String> deviceName,
  Value<String?> pairingSecret,
  Value<DateTime> pairedAt,
  Value<DateTime> lastUsedAt,
  Value<bool> isLastUsed,
});

class $$TrustedServersTableFilterComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get host => $composableBuilder(
      column: $table.host, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get port => $composableBuilder(
      column: $table.port, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mode => $composableBuilder(
      column: $table.mode, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get pairedAt => $composableBuilder(
      column: $table.pairedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => ColumnFilters(column));
}

class $$TrustedServersTableOrderingComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get host => $composableBuilder(
      column: $table.host, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get port => $composableBuilder(
      column: $table.port, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mode => $composableBuilder(
      column: $table.mode, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get pairedAt => $composableBuilder(
      column: $table.pairedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => ColumnOrderings(column));
}

class $$TrustedServersTableAnnotationComposer
    extends Composer<_$NexusDatabase, $TrustedServersTable> {
  $$TrustedServersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get serverKey =>
      $composableBuilder(column: $table.serverKey, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get host =>
      $composableBuilder(column: $table.host, builder: (column) => column);

  GeneratedColumn<int> get port =>
      $composableBuilder(column: $table.port, builder: (column) => column);

  GeneratedColumn<String> get mode =>
      $composableBuilder(column: $table.mode, builder: (column) => column);

  GeneratedColumn<String> get deviceId =>
      $composableBuilder(column: $table.deviceId, builder: (column) => column);

  GeneratedColumn<String> get deviceName => $composableBuilder(
      column: $table.deviceName, builder: (column) => column);

  GeneratedColumn<String> get pairingSecret => $composableBuilder(
      column: $table.pairingSecret, builder: (column) => column);

  GeneratedColumn<DateTime> get pairedAt =>
      $composableBuilder(column: $table.pairedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => column);

  GeneratedColumn<bool> get isLastUsed => $composableBuilder(
      column: $table.isLastUsed, builder: (column) => column);
}

class $$TrustedServersTableTableManager extends RootTableManager<
    _$NexusDatabase,
    $TrustedServersTable,
    TrustedServer,
    $$TrustedServersTableFilterComposer,
    $$TrustedServersTableOrderingComposer,
    $$TrustedServersTableAnnotationComposer,
    $$TrustedServersTableCreateCompanionBuilder,
    $$TrustedServersTableUpdateCompanionBuilder,
    (
      TrustedServer,
      BaseReferences<_$NexusDatabase, $TrustedServersTable, TrustedServer>
    ),
    TrustedServer,
    PrefetchHooks Function()> {
  $$TrustedServersTableTableManager(
      _$NexusDatabase db, $TrustedServersTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TrustedServersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TrustedServersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TrustedServersTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> serverKey = const Value.absent(),
            Value<String> name = const Value.absent(),
            Value<String> host = const Value.absent(),
            Value<int> port = const Value.absent(),
            Value<String> mode = const Value.absent(),
            Value<String> deviceId = const Value.absent(),
            Value<String> deviceName = const Value.absent(),
            Value<String?> pairingSecret = const Value.absent(),
            Value<DateTime> pairedAt = const Value.absent(),
            Value<DateTime> lastUsedAt = const Value.absent(),
            Value<bool> isLastUsed = const Value.absent(),
          }) =>
              TrustedServersCompanion(
            id: id,
            serverKey: serverKey,
            name: name,
            host: host,
            port: port,
            mode: mode,
            deviceId: deviceId,
            deviceName: deviceName,
            pairingSecret: pairingSecret,
            pairedAt: pairedAt,
            lastUsedAt: lastUsedAt,
            isLastUsed: isLastUsed,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String serverKey,
            required String name,
            required String host,
            required int port,
            required String mode,
            required String deviceId,
            required String deviceName,
            Value<String?> pairingSecret = const Value.absent(),
            required DateTime pairedAt,
            required DateTime lastUsedAt,
            Value<bool> isLastUsed = const Value.absent(),
          }) =>
              TrustedServersCompanion.insert(
            id: id,
            serverKey: serverKey,
            name: name,
            host: host,
            port: port,
            mode: mode,
            deviceId: deviceId,
            deviceName: deviceName,
            pairingSecret: pairingSecret,
            pairedAt: pairedAt,
            lastUsedAt: lastUsedAt,
            isLastUsed: isLastUsed,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$TrustedServersTableProcessedTableManager = ProcessedTableManager<
    _$NexusDatabase,
    $TrustedServersTable,
    TrustedServer,
    $$TrustedServersTableFilterComposer,
    $$TrustedServersTableOrderingComposer,
    $$TrustedServersTableAnnotationComposer,
    $$TrustedServersTableCreateCompanionBuilder,
    $$TrustedServersTableUpdateCompanionBuilder,
    (
      TrustedServer,
      BaseReferences<_$NexusDatabase, $TrustedServersTable, TrustedServer>
    ),
    TrustedServer,
    PrefetchHooks Function()>;
typedef $$TransferHistoryTableCreateCompanionBuilder = TransferHistoryCompanion
    Function({
  required String id,
  required String serverKey,
  required String kind,
  required String fileName,
  Value<String?> mime,
  required BigInt sizeBytes,
  Value<BigInt> transferredBytes,
  required String state,
  Value<String?> localPath,
  Value<String?> tempPath,
  Value<String?> finalPath,
  Value<String?> remoteVPath,
  Value<String?> srcDeviceId,
  Value<String?> offerId,
  Value<String?> fromName,
  Value<bool> autoAccepted,
  Value<String?> error,
  required DateTime startedAt,
  required DateTime updatedAt,
  Value<DateTime?> completedAt,
  Value<int> rowid,
});
typedef $$TransferHistoryTableUpdateCompanionBuilder = TransferHistoryCompanion
    Function({
  Value<String> id,
  Value<String> serverKey,
  Value<String> kind,
  Value<String> fileName,
  Value<String?> mime,
  Value<BigInt> sizeBytes,
  Value<BigInt> transferredBytes,
  Value<String> state,
  Value<String?> localPath,
  Value<String?> tempPath,
  Value<String?> finalPath,
  Value<String?> remoteVPath,
  Value<String?> srcDeviceId,
  Value<String?> offerId,
  Value<String?> fromName,
  Value<bool> autoAccepted,
  Value<String?> error,
  Value<DateTime> startedAt,
  Value<DateTime> updatedAt,
  Value<DateTime?> completedAt,
  Value<int> rowid,
});

class $$TransferHistoryTableFilterComposer
    extends Composer<_$NexusDatabase, $TransferHistoryTable> {
  $$TransferHistoryTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get kind => $composableBuilder(
      column: $table.kind, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mime => $composableBuilder(
      column: $table.mime, builder: (column) => ColumnFilters(column));

  ColumnFilters<BigInt> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnFilters(column));

  ColumnFilters<BigInt> get transferredBytes => $composableBuilder(
      column: $table.transferredBytes,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get state => $composableBuilder(
      column: $table.state, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get tempPath => $composableBuilder(
      column: $table.tempPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get finalPath => $composableBuilder(
      column: $table.finalPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteVPath => $composableBuilder(
      column: $table.remoteVPath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get srcDeviceId => $composableBuilder(
      column: $table.srcDeviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get offerId => $composableBuilder(
      column: $table.offerId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fromName => $composableBuilder(
      column: $table.fromName, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get autoAccepted => $composableBuilder(
      column: $table.autoAccepted, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get error => $composableBuilder(
      column: $table.error, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get completedAt => $composableBuilder(
      column: $table.completedAt, builder: (column) => ColumnFilters(column));
}

class $$TransferHistoryTableOrderingComposer
    extends Composer<_$NexusDatabase, $TransferHistoryTable> {
  $$TransferHistoryTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serverKey => $composableBuilder(
      column: $table.serverKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get kind => $composableBuilder(
      column: $table.kind, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fileName => $composableBuilder(
      column: $table.fileName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mime => $composableBuilder(
      column: $table.mime, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<BigInt> get sizeBytes => $composableBuilder(
      column: $table.sizeBytes, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<BigInt> get transferredBytes => $composableBuilder(
      column: $table.transferredBytes,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get state => $composableBuilder(
      column: $table.state, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get localPath => $composableBuilder(
      column: $table.localPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get tempPath => $composableBuilder(
      column: $table.tempPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get finalPath => $composableBuilder(
      column: $table.finalPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteVPath => $composableBuilder(
      column: $table.remoteVPath, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get srcDeviceId => $composableBuilder(
      column: $table.srcDeviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get offerId => $composableBuilder(
      column: $table.offerId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fromName => $composableBuilder(
      column: $table.fromName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get autoAccepted => $composableBuilder(
      column: $table.autoAccepted,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get error => $composableBuilder(
      column: $table.error, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get completedAt => $composableBuilder(
      column: $table.completedAt, builder: (column) => ColumnOrderings(column));
}

class $$TransferHistoryTableAnnotationComposer
    extends Composer<_$NexusDatabase, $TransferHistoryTable> {
  $$TransferHistoryTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get serverKey =>
      $composableBuilder(column: $table.serverKey, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get fileName =>
      $composableBuilder(column: $table.fileName, builder: (column) => column);

  GeneratedColumn<String> get mime =>
      $composableBuilder(column: $table.mime, builder: (column) => column);

  GeneratedColumn<BigInt> get sizeBytes =>
      $composableBuilder(column: $table.sizeBytes, builder: (column) => column);

  GeneratedColumn<BigInt> get transferredBytes => $composableBuilder(
      column: $table.transferredBytes, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get localPath =>
      $composableBuilder(column: $table.localPath, builder: (column) => column);

  GeneratedColumn<String> get tempPath =>
      $composableBuilder(column: $table.tempPath, builder: (column) => column);

  GeneratedColumn<String> get finalPath =>
      $composableBuilder(column: $table.finalPath, builder: (column) => column);

  GeneratedColumn<String> get remoteVPath => $composableBuilder(
      column: $table.remoteVPath, builder: (column) => column);

  GeneratedColumn<String> get srcDeviceId => $composableBuilder(
      column: $table.srcDeviceId, builder: (column) => column);

  GeneratedColumn<String> get offerId =>
      $composableBuilder(column: $table.offerId, builder: (column) => column);

  GeneratedColumn<String> get fromName =>
      $composableBuilder(column: $table.fromName, builder: (column) => column);

  GeneratedColumn<bool> get autoAccepted => $composableBuilder(
      column: $table.autoAccepted, builder: (column) => column);

  GeneratedColumn<String> get error =>
      $composableBuilder(column: $table.error, builder: (column) => column);

  GeneratedColumn<DateTime> get startedAt =>
      $composableBuilder(column: $table.startedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get completedAt => $composableBuilder(
      column: $table.completedAt, builder: (column) => column);
}

class $$TransferHistoryTableTableManager extends RootTableManager<
    _$NexusDatabase,
    $TransferHistoryTable,
    TransferRecord,
    $$TransferHistoryTableFilterComposer,
    $$TransferHistoryTableOrderingComposer,
    $$TransferHistoryTableAnnotationComposer,
    $$TransferHistoryTableCreateCompanionBuilder,
    $$TransferHistoryTableUpdateCompanionBuilder,
    (
      TransferRecord,
      BaseReferences<_$NexusDatabase, $TransferHistoryTable, TransferRecord>
    ),
    TransferRecord,
    PrefetchHooks Function()> {
  $$TransferHistoryTableTableManager(
      _$NexusDatabase db, $TransferHistoryTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TransferHistoryTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TransferHistoryTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TransferHistoryTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> serverKey = const Value.absent(),
            Value<String> kind = const Value.absent(),
            Value<String> fileName = const Value.absent(),
            Value<String?> mime = const Value.absent(),
            Value<BigInt> sizeBytes = const Value.absent(),
            Value<BigInt> transferredBytes = const Value.absent(),
            Value<String> state = const Value.absent(),
            Value<String?> localPath = const Value.absent(),
            Value<String?> tempPath = const Value.absent(),
            Value<String?> finalPath = const Value.absent(),
            Value<String?> remoteVPath = const Value.absent(),
            Value<String?> srcDeviceId = const Value.absent(),
            Value<String?> offerId = const Value.absent(),
            Value<String?> fromName = const Value.absent(),
            Value<bool> autoAccepted = const Value.absent(),
            Value<String?> error = const Value.absent(),
            Value<DateTime> startedAt = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<DateTime?> completedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TransferHistoryCompanion(
            id: id,
            serverKey: serverKey,
            kind: kind,
            fileName: fileName,
            mime: mime,
            sizeBytes: sizeBytes,
            transferredBytes: transferredBytes,
            state: state,
            localPath: localPath,
            tempPath: tempPath,
            finalPath: finalPath,
            remoteVPath: remoteVPath,
            srcDeviceId: srcDeviceId,
            offerId: offerId,
            fromName: fromName,
            autoAccepted: autoAccepted,
            error: error,
            startedAt: startedAt,
            updatedAt: updatedAt,
            completedAt: completedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String serverKey,
            required String kind,
            required String fileName,
            Value<String?> mime = const Value.absent(),
            required BigInt sizeBytes,
            Value<BigInt> transferredBytes = const Value.absent(),
            required String state,
            Value<String?> localPath = const Value.absent(),
            Value<String?> tempPath = const Value.absent(),
            Value<String?> finalPath = const Value.absent(),
            Value<String?> remoteVPath = const Value.absent(),
            Value<String?> srcDeviceId = const Value.absent(),
            Value<String?> offerId = const Value.absent(),
            Value<String?> fromName = const Value.absent(),
            Value<bool> autoAccepted = const Value.absent(),
            Value<String?> error = const Value.absent(),
            required DateTime startedAt,
            required DateTime updatedAt,
            Value<DateTime?> completedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TransferHistoryCompanion.insert(
            id: id,
            serverKey: serverKey,
            kind: kind,
            fileName: fileName,
            mime: mime,
            sizeBytes: sizeBytes,
            transferredBytes: transferredBytes,
            state: state,
            localPath: localPath,
            tempPath: tempPath,
            finalPath: finalPath,
            remoteVPath: remoteVPath,
            srcDeviceId: srcDeviceId,
            offerId: offerId,
            fromName: fromName,
            autoAccepted: autoAccepted,
            error: error,
            startedAt: startedAt,
            updatedAt: updatedAt,
            completedAt: completedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$TransferHistoryTableProcessedTableManager = ProcessedTableManager<
    _$NexusDatabase,
    $TransferHistoryTable,
    TransferRecord,
    $$TransferHistoryTableFilterComposer,
    $$TransferHistoryTableOrderingComposer,
    $$TransferHistoryTableAnnotationComposer,
    $$TransferHistoryTableCreateCompanionBuilder,
    $$TransferHistoryTableUpdateCompanionBuilder,
    (
      TransferRecord,
      BaseReferences<_$NexusDatabase, $TransferHistoryTable, TransferRecord>
    ),
    TransferRecord,
    PrefetchHooks Function()>;

class $NexusDatabaseManager {
  final _$NexusDatabase _db;
  $NexusDatabaseManager(this._db);
  $$TrustedServersTableTableManager get trustedServers =>
      $$TrustedServersTableTableManager(_db, _db.trustedServers);
  $$TransferHistoryTableTableManager get transferHistory =>
      $$TransferHistoryTableTableManager(_db, _db.transferHistory);
}
