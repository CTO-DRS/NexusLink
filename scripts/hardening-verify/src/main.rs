// NexusLink — محرك تحقق التقوية (FA-harden — عقد §16)
// ============================================================================
// يُضمِّن حرفيًا harden_core.rs (مصدر واحد مع الطبقة الأصلية) ثم يشغّل:
//   1) PBKDF2-HMAC-SHA256 بمتجهات معيارية (الكتلة الأولى، dkLen=32):
//      c=1/2/4096 (مشتقة كلاسيكية) + c=10_000 لرمزنا الفعلي (قيمة محسوبة
//      مستقلًا بـ Python hashlib والقيمة مثبتة أدناه)
//   2) hex roundtrip + رفض الفاسد
//   3) قرار الخمول الخالص بمتجهات صريحة (Wayland/عتبات/تعطيل)
//   4) طابور التدقيق: FIFO + إسقاط الأقدم عند 200 + القائمة البيضاء + بتر 400
//   5) تنقية سياسة المخزن المشترك = مرآة desktop-hardening.ts (صالح/فاسد/فارغ)
//   6) ملفات الإصدار: tauri.conf.json (updater + pubkey + createUpdaterArtifacts
//      + الإصدار 1.0.0 مقفول) + lock.html موجود + مفاتيح التوقيع في place
use std::sync::atomic::{AtomicUsize, Ordering};

mod core {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/harden_core.rs"));
}

use core::*;

static PASS: AtomicUsize = AtomicUsize::new(0);
static FAIL: AtomicUsize = AtomicUsize::new(0);

fn check(name: &str, cond: bool, detail: String) {
    if cond {
        PASS.fetch_add(1, Ordering::SeqCst);
        println!("  ✓ {name}");
    } else {
        FAIL.fetch_add(1, Ordering::SeqCst);
        println!("  ✗ {name} — {detail}");
    }
}

fn main() {
    println!("== FA-harden hardening-verify — نواة التقوية + أصول المحدّث الموقّع ==\n");

    // ---------- (1) PBKDF2-HMAC-SHA256 ----------
    println!("(1) PBKDF2-HMAC-SHA256 — متجهات معيارية");
    let vectors: &[(&str, &str, u32, &str)] = &[
        ("password", "salt", 1, "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"),
        ("password", "salt", 2, "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"),
        ("password", "salt", 4096, "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a"),
        // RFC 7914 (scrypt §التحقق من PBKDF2 الداخلي) — الكتلة الأولى، c=1
        ("passwd", "salt", 1, "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc"),
        // جولات إنتاجنا 10_000 — قيمة حُسبت مستقلًا (Python hashlib.pbkdf2_hmac)
        ("nexus", "link", PBKDF2_ROUNDS, "0e3e884f466433cc0ca265be049bfcc28e062ca58beeda878b95754cc524ef83"),
    ];
    for (p, s, rounds, expect) in vectors {
        let mut out = [0u8; 32];
        pbkdf2_hmac_sha256(p.as_bytes(), s.as_bytes(), *rounds, &mut out);
        check(
            &format!("PBKDF2({p:?}, {s:?}, {rounds})"),
            to_hex(&out) == *expect,
            format!("got {}", to_hex(&out)),
        );
    }
    // حتمية + تمييز الملح
    let a = hash_pin("1234", &[0u8; 16]);
    let b = hash_pin("1234", &[0u8; 16]);
    let c = hash_pin("1234", &[1u8; 16]);
    check("hash_pin حتمي", a == b, "نفس المدخلات أعطت هاشين".to_string());
    check("hash_pin حساس للملح", a != c, "ملح مختلف أعطى نفس الهاش".to_string());

    // ---------- (2) hex ----------
    println!("(2) hex مساعدات");
    let bytes = [0x0f, 0xa0, 0x01];
    check("to_hex", to_hex(&bytes) == "0fa001", to_hex(&bytes).to_string());
    check("from_hex roundtrip", from_hex("0fa001", 3) == Some(bytes.to_vec()), "فك فاشل".to_string());
    check("from_hex يرفض الطول الناقص", from_hex("0fa0", 3).is_none(), "قبل فاسد".to_string());
    check("from_hex يرفض المحرف الفاسد", from_hex("zzfa01", 3).is_none(), "قبل فاسد".to_string());

    // ---------- (3) قرار الخمول ----------
    println!("(3) قرار الخمول الخالص");
    check("Wayland (None) ⇒ لا وضع ولا قفل", idle_decision(None, 5, 10, true) == (false, false), "vec".to_string());
    check("قبل العتبتين", idle_decision(Some(60.0), 5, 10, true) == (false, false), "vec".to_string());
    check("تجاوز التوفير فقط", idle_decision(Some(310.0), 5, 10, true) == (true, false), "vec".to_string());
    check("تجاوز القفل + التوفير", idle_decision(Some(610.0), 5, 10, true) == (true, true), "vec".to_string());
    check("القفل يتطلب enabled", idle_decision(Some(610.0), 5, 10, false) == (true, false), "vec".to_string());
    check("عتبة قفل معطلة (0)", idle_decision(Some(10_000.0), 5, 0, true) == (true, false), "vec".to_string());
    check("توفير معطل والقفل يعمل", idle_decision(Some(610.0), 0, 10, true) == (false, true), "vec".to_string());

    // ---------- (4) طابور التدقيق ----------
    println!("(4) طابور التدقيق");
    let mut q = AuditQueue::new();
    for i in 0..(AUDIT_QUEUE_CAP + 20) {
        if let Some(item) = make_audit_item("power", "info", format!("op-{i}")) {
            q.push(item);
        }
    }
    check("السعة قصوى 200 (إسقاط الأقدم)", q.len() == AUDIT_QUEUE_CAP, format!("len={}", q.len()));
    let batch = q.drain(3);
    check("FIFO بعد الإسقاط — أول باقٍ op-20", batch[0].detail == "op-20", batch[0].detail.clone());
    check("تفريغ جزئي صحيح", q.len() == AUDIT_QUEUE_CAP - 3, format!("len={}", q.len()));
    check("القائمة البيضاء تقبل lock", make_audit_item("lock", "info", "قفل".into()).is_some(), "مرفوض ظلمًا".to_string());
    check("القائمة البيضاء ترفض غير المعروف", make_audit_item("hax", "info", "x".into()).is_none(), "مقبول ظلمًا".to_string());
    let long = make_audit_item("diag", "info", "د".repeat(1000)).unwrap();
    check("بتر التفاصيل 400", long.detail.chars().count() == 400, format!("len={}", long.detail.chars().count()));
    check("البادئة native-", long.action == "native-diag", long.action.clone());

    // ---------- (5) تنقية السياسة = مرآة السيرفر ----------
    println!("(5) تنقية سياسة المخزن المشترك");
    let cfg = serde_json::json!({
        "appLock": { "enabled": true, "idleLockMin": 15 },
        "idle": { "optMinutes": 3, "reducePolling": true },
        "updater": { "autoCheck": false }
    });
    check("سياسة صالحة تمر كما هي", policy_from_shared(&cfg) == (true, 15, 3, false), "vec".to_string());
    let bad = serde_json::json!({
        "appLock": { "enabled": true, "idleLockMin": 9999 },
        "idle": { "optMinutes": 0 },
        "updater": { "autoCheck": true }
    });
    check("خارج النطاق ⇒ محصور/افتراضي", policy_from_shared(&bad) == (true, 0, 5, true), "vec".to_string());
    check("كائن فارغ ⇒ افتراضيات", policy_from_shared(&serde_json::json!({})) == (false, 0, 5, true), "vec".to_string());
    check("قيمة غير عددية ⇒ افتراضي", policy_from_shared(&serde_json::json!({"appLock": {"idleLockMin": "خمسة عشر"}})) == (false, 0, 5, true), "vec".to_string());

    // ---------- (6) أصول المحدّث الموقّع + ملفات القفل ----------
    println!("(6) أصول المحدّث الموقّع");
    let manifest = env!("CARGO_MANIFEST_DIR");
    let base = std::path::Path::new(manifest).join("../../");
    let conf_path = base.join("apps/desktop/src-tauri/tauri.conf.json");
    let conf_text = std::fs::read_to_string(&conf_path).unwrap_or_default();
    let conf: serde_json::Value = serde_json::from_str(&conf_text).unwrap_or(serde_json::json!({}));
    check("tauri.conf.json صالح JSON", conf.is_object(), "فشل قراءة/تحليل".to_string());
    check("الإصدار مقفول 1.0.0", conf["version"] == "1.0.0", conf["version"].to_string());
    check("plugins.updater.endpoints موجودة", conf["plugins"]["updater"]["endpoints"].as_array().map(|a| !a.is_empty()).unwrap_or(false), "غائبة".to_string());
    let endpoints = conf["plugins"]["updater"]["endpoints"].as_array();
    check("نقطة latest.json على GitHub Releases", endpoints.map(|a| a.iter().any(|e| e.as_str().unwrap_or("").ends_with("/latest/download/latest.json"))).unwrap_or(false), "غائبة".to_string());
    let pubkey = conf["plugins"]["updater"]["pubkey"].as_str().unwrap_or("");
    check("pubkey مضبوط (base64 minisign)", pubkey.len() > 100 && base64_ok(pubkey), "قصير/غير base64".to_string());
    check("createUpdaterArtifacts مفعّل", conf["bundle"]["createUpdaterArtifacts"] == true, conf["bundle"]["createUpdaterArtifacts"].to_string());
    let lock_html = base.join("apps/desktop/splash/lock.html");
    check("lock.html موجود ضمن frontendDist", lock_html.is_file(), "غائب".to_string());
    let lock_text = std::fs::read_to_string(&lock_html).unwrap_or_default();
    check("lock.html يستدعي lock_verify_pin", lock_text.contains("lock_verify_pin"), "غائب".to_string());
    check("lock.html يستدعي lock_biometric", lock_text.contains("lock_biometric"), "غائب".to_string());
    // main.rs — الوحدات المسجلة
    let main_rs = std::fs::read_to_string(base.join("apps/desktop/src-tauri/src/main.rs")).unwrap_or_default();
    for cmd in ["lock_state", "lock_set_pin", "lock_verify_pin", "lock_biometric", "updater_check_now", "diag_sidecar_ports", "diag_speed_test", "diag_export"] {
        check(&format!("الأمر مسجل: {cmd}"), main_rs.contains(&format!("{cmd},")), "غير مسجل".to_string());
    }
    // audit actions مرآة السيرفر
    let hardening_ts = std::fs::read_to_string(base.join("src/lib/nexus/desktop-hardening.ts")).unwrap_or_default();
    check("السيرفر يحترم بادئة native- (حصرية لنا)", hardening_ts.contains("startsWith(\"native-\")"), "غائبة".to_string());

    println!();
    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("===== HARDENING-VERIFY: {p} passed, {f} failed =====");
    if f > 0 {
        std::process::exit(1);
    }
}

/// فحص base64 شكلي (محارف المجموعة القياسية + طول مضاعف 4)
fn base64_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() % 4 == 0
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}
