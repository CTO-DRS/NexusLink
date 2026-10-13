// NexusLink Desktop — نواة التقوية النقية (FA-harden — عقد §16)
// ============================================================
// ملف نقي بلا تبعيات Tauri — يُضمَّن حرفيًا في الطبقة الأصلية (mod) وفي
// scripts/hardening-verify (include!) — نمط media_core.rs المعتمد.
// المحتوى: PBKDF2-HMAC-SHA256 لرمز القفل + مساعدات hex + قرار الخمول الخالص
// + طابور التدقيق (إسقاط الأقدم) + تنقية سياسة المخزن المشترك.
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub const PBKDF2_ROUNDS: u32 = 10_000;
pub const AUDIT_QUEUE_CAP: usize = 200;

// ---------------------------------------------------------------------------
// PBKDF2-HMAC-SHA256 — تنفيذ يدوي متحقق بمتجهات RFC (scripts/hardening-verify)
// ---------------------------------------------------------------------------

pub fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], rounds: u32, out: &mut [u8; 32]) {
    // ماك أساس نظيف يُستنسخ لكل تكرار — التكرار i يحسب U(i+1) = HMAC(P, U(i))
    // حصريًا (لا حالة ممتصة من S||INT(1) تتسرب إلى التكرارات)
    let base = Hmac::<Sha256>::new_from_slice(password).expect("hmac accepts any key length");
    let mut mac1 = base.clone();
    mac1.update(salt);
    mac1.update(&[0, 0, 0, 1]); // INT(1) — كتلة أولى فقط (dkLen=32 = hLen)
    let mut u = mac1.finalize().into_bytes(); // U1 — hmac 0.12: finalize(self)
    let mut acc = [0u8; 32];
    acc.copy_from_slice(&u);
    for _ in 1..rounds {
        let mut mac2 = base.clone();
        mac2.update(&u);
        u = mac2.finalize().into_bytes();
        for (a, b) in acc.iter_mut().zip(u.iter()) {
            *a ^= *b;
        }
    }
    *out = acc;
}

pub fn hash_pin(pin: &str, salt: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2_hmac_sha256(pin.as_bytes(), salt, PBKDF2_ROUNDS, &mut out);
    out
}

// ---------------------------------------------------------------------------
// hex مساعدات (الملح والهاش في config.json بصيغة hex)
// ---------------------------------------------------------------------------

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// فك hex إلى بايتات — طول غير صحيح/محرف فاسد ⇒ None (لا هلع)
pub fn from_hex(s: &str, expected: usize) -> Option<Vec<u8>> {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() != expected * 2 {
        return None;
    }
    let mut out = Vec::with_capacity(expected);
    for pair in chars.chunks(2) {
        let hi = pair[0].to_digit(16)?;
        let lo = pair[1].to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

// ---------------------------------------------------------------------------
// قرار الخمول الخالص — بندا 1 (قفل الخمول) و4 (وضع التوفير) من مصدر واحد
// ---------------------------------------------------------------------------

/// (وضع الخمول، قفل الخمول) من ثوانٍ الخمول الفعلية.
/// None (منصة بلا كشف خمول — Wayland) ⇒ (false, false) بصدق.
pub fn idle_decision(
    idle_secs: Option<f64>,
    opt_minutes: u32,
    lock_minutes: u32,
    app_lock_enabled: bool,
) -> (bool, bool) {
    let Some(secs) = idle_secs else {
        return (false, false);
    };
    let idle_on = opt_minutes > 0 && secs >= (opt_minutes as f64) * 60.0;
    let lock_on = app_lock_enabled && lock_minutes > 0 && secs >= (lock_minutes as f64) * 60.0;
    (idle_on, lock_on)
}

// ---------------------------------------------------------------------------
// طابور التدقيق — fire-and-forget: لا يحجب المتصل ولا يُسقط العملية الأصلية.
// امتلأ الطابور (السيرفر مطفأ طويلًا) ⇒ يُسقط الأقدم بلا ضجيج.
// ---------------------------------------------------------------------------

pub struct AuditItem {
    pub action: String,
    pub detail: String,
    pub severity: String,
}

pub const AUDIT_ACTIONS: &[&str] = &[
    "native-transfer",
    "native-clipboard",
    "native-power",
    "native-input",
    "native-screen",
    "native-vcam",
    "native-files",
    "native-sync",
    "native-lock",
    "native-updater",
    "native-diag",
];

/// بنية عنصر مدقق من أفعالنا المسموحة — None ⇒ إجراء غير معروف (يُهمل)
pub fn make_audit_item(action: &str, severity: &str, detail: String) -> Option<AuditItem> {
    let full = format!("native-{action}");
    if !AUDIT_ACTIONS.contains(&full.as_str()) {
        return None;
    }
    Some(AuditItem {
        action: full,
        detail: detail.chars().take(400).collect(),
        severity: severity.to_string(),
    })
}

pub struct AuditQueue {
    q: std::collections::VecDeque<AuditItem>,
}

impl AuditQueue {
    pub fn new() -> Self {
        Self {
            q: std::collections::VecDeque::new(),
        }
    }

    pub fn push(&mut self, item: AuditItem) {
        if self.q.len() >= AUDIT_QUEUE_CAP {
            self.q.pop_front(); // الأحدث أهم — إسقاط الأقدم بلا ضجيج
        }
        self.q.push_back(item);
    }

    /// تفريغ دفعة (حتى n) بترتيب الوصول
    pub fn drain(&mut self, n: usize) -> Vec<AuditItem> {
        let take = self.q.len().min(n);
        self.q.drain(..take).collect()
    }

    pub fn len(&self) -> usize {
        self.q.len()
    }
}

// ---------------------------------------------------------------------------
// تنقية سياسة المخزن المشترك (بند 6 — نفس SQLite) — مرآة تنقية السيرفر
// desktop-hardening.ts حرفيًا: فاسد ⇒ افتراضي، خارج النطاق ⇒ الافتراضي (رفض لا حصر).
// ترجع (enabled, idleLockMin, optMinutes, autoCheck).
// ---------------------------------------------------------------------------

pub fn policy_from_shared(cfg: &serde_json::Value) -> (bool, u32, u32, bool) {
    let app_lock = cfg.get("appLock");
    let idle = cfg.get("idle");
    let updater = cfg.get("updater");

    // sanitizeAppLock: enabled === true؛ idleLockMin 0..120 وإلا الافتراضي 0
    let enabled = app_lock
        .and_then(|a| a.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let lock_min = app_lock
        .and_then(|a| a.get("idleLockMin"))
        .and_then(|v| v.as_f64())
        .filter(|v| (0.0..=120.0).contains(v))
        .map(|v| v.floor() as u32)
        .unwrap_or(0);
    // sanitizeIdle: optMinutes 1..120 وإلا الافتراضي 5
    let opt_min = idle
        .and_then(|i| i.get("optMinutes"))
        .and_then(|v| v.as_f64())
        .filter(|v| (1.0..=120.0).contains(v))
        .map(|v| v.floor() as u32)
        .unwrap_or(5);
    // sanitizeUpdater: autoCheck !== false (الافتراضي مفعّل)
    let auto = updater
        .and_then(|u| u.get("autoCheck"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    (enabled, lock_min, opt_min, auto)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pbkdf2_known_vectors() {
        // PBKDF2-HMAC-SHA256 — المتجهات الكلاسيكية (DK = كتلة أولى، dkLen=32)
        let cases: &[(&str, &str, u32, &str)] = &[
            ("password", "salt", 1, "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"),
            ("password", "salt", 2, "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"),
            ("password", "salt", 4096, "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a"),
        ];
        for (p, s, rounds, expect) in cases {
            let mut out = [0u8; 32];
            pbkdf2_hmac_sha256(p.as_bytes(), s.as_bytes(), *rounds, &mut out);
            assert_eq!(&to_hex(&out), *expect, "rounds={rounds}");
        }
    }

    #[test]
    fn hash_pin_deterministic_and_salted() {
        let a = hash_pin("1234", &[0u8; 16]);
        let b = hash_pin("1234", &[0u8; 16]);
        let c = hash_pin("1234", &[1u8; 16]);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn hex_roundtrip_and_reject() {
        let bytes = [0x0f, 0xa0, 0x01];
        let hexed = to_hex(&bytes);
        assert_eq!(hexed, "0fa001");
        assert_eq!(from_hex(&hexed, 3), Some(bytes.to_vec()));
        assert_eq!(from_hex("0fa0", 3), None); // طول ناقص
        assert_eq!(from_hex("zzfa01", 3), None); // محرف فاسد
    }

    #[test]
    fn idle_decision_vectors() {
        // Wayland (None) — لا شيء
        assert_eq!(idle_decision(None, 5, 10, true), (false, false));
        // قبل العتبتين
        assert_eq!(idle_decision(60.0, 5, 10, true), (false, false));
        // تجاوز عتبة التوفير فقط
        assert_eq!(idle_decision(310.0, 5, 10, true), (true, false));
        // تجاوز عتبة القفل — القفل يتطلب enabled
        assert_eq!(idle_decision(610.0, 5, 10, true), (true, true));
        assert_eq!(idle_decision(610.0, 5, 10, false), (true, false));
        // عتبة قفل معطلة (0)
        assert_eq!(idle_decision(10_000.0, 5, 0, true), (true, false));
        // توفير معطل (0) — القفل يعمل مستقلًا
        assert_eq!(idle_decision(610.0, 0, 10, true), (false, true));
    }

    #[test]
    fn audit_queue_fifo_and_drop_oldest() {
        let mut q = AuditQueue::new();
        for i in 0..(AUDIT_QUEUE_CAP + 20) {
            if let Some(item) = make_audit_item("power", "info", format!("op-{i}")) {
                q.push(item);
            }
        }
        assert_eq!(q.len(), AUDIT_QUEUE_CAP);
        let batch = q.drain(3);
        assert_eq!(batch.len(), 3);
        // الأقدم أُسقط — أول باقٍ هو op-20
        assert_eq!(batch[0].detail, "op-20");
        assert_eq!(q.len(), AUDIT_QUEUE_CAP - 3);
    }

    #[test]
    fn audit_whitelist_and_truncation() {
        assert!(make_audit_item("lock", "info", "قفل".into()).is_some());
        assert!(make_audit_item("hax", "info", "x".into()).is_none()); // غير معروف
        let long = make_audit_item("diag", "info", "د".repeat(1000)).unwrap();
        assert_eq!(long.detail.chars().count(), 400);
        assert_eq!(long.action, "native-diag");
    }

    #[test]
    fn policy_sanitization_mirrors_server() {
        let cfg = serde_json::json!({
            "appLock": { "enabled": true, "idleLockMin": 15 },
            "idle": { "optMinutes": 3, "reducePolling": true },
            "updater": { "autoCheck": false }
        });
        assert_eq!(policy_from_shared(&cfg), (true, 15, 3, false));
        // خارج النطاق ⇒ رفض والافتراضي (نفس تنقية السيرفر حرفيًا — لا حصر)
        let bad = serde_json::json!({
            "appLock": { "enabled": true, "idleLockMin": 9999 },
            "idle": { "optMinutes": 0 },
            "updater": { "autoCheck": true }
        });
        assert_eq!(policy_from_shared(&bad), (true, 0, 5, true));
        // كائن فارغ ⇒ كل الافتراضيات
        assert_eq!(policy_from_shared(&serde_json::json!({})), (false, 0, 5, true));
    }
}
