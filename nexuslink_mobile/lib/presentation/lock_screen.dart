import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/security_providers.dart';

/// شاشة قفل التطبيق (FA-10 البند 2): PIN عبر PBKDF2 + بصمة/وجه عبر local_auth.
/// تُعرض كبوابة قبل Shell عند locked=true (يدوي/تلقائي عند الخلفية/أمر كمبيوتر).
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  final _pin = TextEditingController();
  String _error = '';
  bool _busy = false;

  Future<void> _unlock() async {
    if (_busy) return;
    _busy = true;
    final ok = await ref.read(appLockProvider.notifier).verifyPin(_pin.text);
    _busy = false;
    if (!mounted) return;
    if (!ok) {
      setState(() => _error = tr('lock.wrongPin'));
      _pin.clear();
      HapticFeedback.heavyImpact();
    }
  }

  Future<void> _bio() async {
    if (_busy) return;
    _busy = true;
    await ref.read(appLockProvider.notifier).verifyBiometric();
    _busy = false;
  }

  @override
  Widget build(BuildContext context) {
    final cfg = ref.watch(lockConfigProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bg = dark ? const Color(0xFF0B0F19) : const Color(0xFFF8FAFC);
    final card = dark ? const Color(0xFF151B2B) : Colors.white;

    return Scaffold(
      backgroundColor: bg,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.lock_rounded, size: 64, color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 12),
              Text('lock.title'.tr(), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text(
                'lock.subtitle'.tr(),
                style: TextStyle(fontSize: 13, color: Theme.of(context).hintColor),
              ),
              const SizedBox(height: 28),
              Container(
                constraints: const BoxConstraints(maxWidth: 320),
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: card,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Theme.of(context).dividerColor.withOpacity(.4)),
                ),
                child: Column(
                  children: [
                    TextField(
                      controller: _pin,
                      obscureText: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      maxLength: 8,
                      textAlign: TextAlign.center,
                      autofocus: true,
                      style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w700),
                      decoration: InputDecoration(
                        counterText: '',
                        hintText: 'lock.pinHint'.tr(),
                        errorText: _error.isEmpty ? null : _error,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onSubmitted: (_) => _unlock(),
                      onChanged: (v) {
                        if (_error.isNotEmpty) setState(() => _error = '');
                        // إدخال كامل (4-6 أرقام) يحاول الفتح تلقائيًا
                        if (v.length >= 4 && v.length <= 6) _unlock();
                      },
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _unlock,
                        icon: const Icon(Icons.key_rounded, size: 18),
                        label: Text('lock.unlock'.tr()),
                      ),
                    ),
                    if (cfg.hasBiometric) ...[
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: _bio,
                        icon: const Icon(Icons.fingerprint_rounded, size: 22),
                        label: Text('lock.biometric'.tr()),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'lock.securedBy'.tr(),
                style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// بوابة وضع الفقدان (FA-10 البند 4): رسالة المالك ملء الشاشة +
/// زر «أنا المالك» يفتح التحقق (PIN/بصمة) ثم يلغي الوضع ويفك القفل.
class LostGate extends ConsumerStatefulWidget {
  const LostGate({super.key, required this.message});

  final String message;

  @override
  ConsumerState<LostGate> createState() => _LostGateState();
}

class _LostGateState extends ConsumerState<LostGate> {
  bool _busy = false;

  Future<void> _ownerUnlock() async {
    if (_busy) return;
    _busy = true;
    final cfg = ref.read(lockConfigProvider);
    bool ok = false;
    if (cfg.hasBiometric) {
      ok = await ref.read(appLockProvider.notifier).verifyBiometric();
    }
    if (!ok && cfg.hasPin && mounted) {
      ok = await showDialog<bool>(
            context: context,
            barrierDismissible: false,
            builder: (ctx) => _OwnerPinDialog(),
          ) ??
          false;
    }
    _busy = false;
    if (!mounted) return;
    if (ok) {
      // إلغاء وضع الفقدان + فك القفل معًا (عقد §9.3: dev:lost-off = «الهاتف فُتح»)
      await ref.read(lostProvider.notifier).stop();
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF7F1D1D),
      body: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF7F1D1D), Color(0xFF450A0A)],
          ),
        ),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('🛡️', style: TextStyle(fontSize: 72)),
              const SizedBox(height: 12),
              Text(
                'lost.title'.tr(),
                style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: Colors.white),
              ),
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Text(
                  widget.message.isEmpty ? 'lost.defaultMessage'.tr() : widget.message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 17, color: Colors.white, height: 1.5),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'lost.agentAlive'.tr(),
                style: TextStyle(fontSize: 12, color: Colors.red.shade200),
              ),
              const SizedBox(height: 36),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF991B1B),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                ),
                onPressed: _busy ? null : _ownerUnlock,
                icon: const Icon(Icons.verified_user_rounded, size: 20),
                label: Text('lost.imOwner'.tr()),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// حوار PIN للمالك داخل وضع الفقدان.
class _OwnerPinDialog extends ConsumerStatefulWidget {
  @override
  ConsumerState<_OwnerPinDialog> createState() => _OwnerPinDialogState();
}

class _OwnerPinDialogState extends ConsumerState<_OwnerPinDialog> {
  final _pin = TextEditingController();
  String _error = '';

  Future<void> _verify() async {
    final ok = await ref.read(appLockProvider.notifier).verifyPin(_pin.text);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(true);
    } else {
      setState(() => _error = tr('lock.wrongPin'));
      _pin.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('lock.ownerTitle'.tr()),
      content: TextField(
        controller: _pin,
        obscureText: true,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        autofocus: true,
        decoration: InputDecoration(
          hintText: 'lock.pinHint'.tr(),
          errorText: _error.isEmpty ? null : _error,
        ),
        onSubmitted: (_) => _verify(),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text('common.cancel'.tr())),
        FilledButton(onPressed: _verify, child: Text('lock.unlock'.tr())),
      ],
    );
  }
}
