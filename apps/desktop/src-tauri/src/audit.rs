// NexusLink Desktop — سجل التدقيق الأصلي (FA-harden — عقد §16)
// ============================================================
// كل عملية من الطبقة الأصلية (نقل/تحكم/حافظة/طاقة/وسائط/قفل/تشخيص) تُكتب
// في SQLite المشتركة عبر POST /api/desktop/audit ببادئة native-* (حصرية لنا).
// التصميم: طابور منفصل بخيط واحد — audit() لا يحجب المتصل أبدًا ولا يُسقط
// العملية الأصلية مهما حدث (السيرفر مطفأ؟ الطابور يمتلئ ويُسقط الأقدم بلا ضجيج).
// النواة (الطابور/القائمة البيضاء/البتر 400) في harden_core — مُختبرة في
// scripts/hardening-verify.
use serde_json::json;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::harden_core::{make_audit_item, AuditItem, AuditQueue};

fn queue() -> &'static Mutex<AuditQueue> {
    static Q: OnceLock<Mutex<AuditQueue>> = OnceLock::new();
    Q.get_or_init(|| Mutex::new(AuditQueue::new()))
}

fn worker_started() -> &'static Mutex<bool> {
    static S: OnceLock<Mutex<bool>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(false))
}

/// تسجيل عملية أصلية — fire-and-forget (لا يحجب ولا يفشل المتصل)
/// action: أحد الأفعال في قائمة harden_core (بدون بادئة) — مثل "power" | "screen"
/// severity: info | warn | critical
pub fn audit(action: &str, severity: &str, detail: String) {
    let Some(item) = make_audit_item(action, severity, detail) else {
        println!("[audit] إجراء غير معروف: native-{action}");
        return;
    };
    {
        let mut q = queue().lock().unwrap();
        q.push(item);
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
        // تفريغ دفعة (حتى 20 عنصرًا بترتيب الوصول) — المسار بسيط ومدقق سيرفريًا
        let batch: Vec<AuditItem> = {
            let mut q = queue().lock().unwrap();
            q.drain(20)
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
