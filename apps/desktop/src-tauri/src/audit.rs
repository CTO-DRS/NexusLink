// NexusLink Desktop — سجل التدقيق الأصلي (FA-harden — عقد §16)
// ============================================================
// كل عملية من الطبقة الأصلية (نقل/تحكم/حافظة/طاقة/وسائط/قفل/تشخيص) تُكتب
// في SQLite المشتركة عبر POST /api/desktop/audit ببادئة native-* (حصرية لنا).
// التصميم: طابور منفصل بخيط واحد — audit() لا يحجب المتصل أبدًا ولا يُسقط
// العملية الأصلية مهما حدث (السيرفر مطفأ؟ الطابور يمتلئ ويُسقط الأقدم بلا ضجيج).
use serde_json::json;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const AUDIT_ACTIONS: &[&str] = &[
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

struct AuditItem {
    action: String,
    detail: String,
    severity: String,
}

fn queue() -> &'static Mutex<VecDeque<AuditItem>> {
    static Q: OnceLock<Mutex<VecDeque<AuditItem>>> = OnceLock::new();
    Q.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn worker_started() -> &'static Mutex<bool> {
    static S: OnceLock<Mutex<bool>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(false))
}

/// تسجيل عملية أصلية — fire-and-forget (لا يحجب ولا يفشل المتصل)
/// action: أحد الأفعال في AUDIT_ACTIONS (بدون بادئة) — مثل "power" | "screen"
/// severity: info | warn | critical
pub fn audit(action: &str, severity: &str, detail: String) {
    let full = format!("native-{action}");
    if !AUDIT_ACTIONS.contains(&full.as_str()) {
        println!("[audit] إجراء غير معروف: {full}");
        return;
    }
    let item = AuditItem {
        action: full,
        detail: detail.chars().take(400).collect(),
        severity: severity.to_string(),
    };
    {
        let mut q = queue().lock().unwrap();
        if q.len() >= 200 {
            q.pop_front(); // السيرفر مطفأ طويلًا — نُسقط الأقدم (الأحدث أهم)
        }
        q.push_back(item);
    }
    ensure_worker();
}

fn ensure_worker() {
    let mut started = worker_started().lock().unwrap();
    if *started {
        return;
    }
    *started = true;
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_millis(1500));
        // نفريغ دفعة كاملة بطلب واحد لكل عنصر (المسار بسيط ومدقق سيرفريًا)
        let batch: Vec<AuditItem> = {
            let mut q = queue().lock().unwrap();
            let n = q.len().min(20);
            q.drain(..n).collect()
        };
        for item in batch {
            let body = json!({
                "action": item.action,
                "detail": item.detail,
                "severity": item.severity,
            });
            if let Err(e) = crate::procman::post_json("/api/desktop/audit", &body) {
                println!("[audit] فشل كتابة {}: {e}", item.action);
            }
        }
    });
}
