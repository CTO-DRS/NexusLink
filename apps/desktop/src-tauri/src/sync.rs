// FA-files (عقد §14) — مراقب مزامنة المجلدات الأصلي (notify) — طبقة Tauri
// ============================================================
// يقرأ الأزواج من status.desktop.sync (يديرها الإعداد) ويدير دورة حياة
// المراقبين: مجلد محلي (صادر) + جذر الوكيل agents/<agent>/Sync/<pair> (وارد).
// الصادر: نسخ إلى pc-fs/Outbox/<pair>/<rel> + عرض send-file (tx:offer).
// الوارد: نسخ من جذر الوكيل إلى المجلد المحلي (الأحدث يفوز).
// النواة النقية في sync_core.rs (تُضمَّن حرفيًا في محرك التحقق).
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::procman;
use crate::sync_core::{
    inbound_plan, is_self_write, offer_body, pairs_from_status, process_outgoing,
    record_out, rel_of, should_skip_name, staged_vpath_for, PairCfg,
};

const DEBOUNCE_MS: u64 = 700;
const ECHO_GUARD_MS: i64 = 6000;

struct PairRuntime {
    watchers: Vec<RecommendedWatcher>,
    /// ملفات أُرسلت محليًا للتو (حارس صدى) — rel → ms
    recent_out: Vec<(String, i64)>,
}
static RUNTIMES: OnceLock<Mutex<HashMap<String, PairRuntime>>> = OnceLock::new();
static PENDING: OnceLock<Mutex<HashMap<String, HashSet<String>>>> = OnceLock::new();
static LAST_PAIRS: OnceLock<Mutex<Vec<PairCfg>>> = OnceLock::new();
static LAST_SIG: OnceLock<Mutex<String>> = OnceLock::new();
static LAST_AGENT: OnceLock<Mutex<String>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(1);

fn runtimes() -> &'static Mutex<HashMap<String, PairRuntime>> {
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn pending() -> &'static Mutex<HashMap<String, HashSet<String>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn file_mtime_size(p: &Path) -> Option<(i64, u64)> {
    let st = std::fs::metadata(p).ok()?;
    if !st.is_file() {
        return None;
    }
    let mt = st
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some((mt, st.len()))
}

/// استبدال الأزواج من الحالة — يبدأ/يوقف المراقبين (idempotent، يُستدعى من الاستطلاع)
pub fn update_pairs(app: &AppHandle, status: &serde_json::Value) {
    let pairs = pairs_from_status(status);
    let agent = procman::current_agent_id();
    let server_root = procman::server_root(app);

    // توقيع للتغيير — لا لمس للمراقبين إن لم يتغير شيء؛ تغيّر الوكيل = إعادة كاملة
    let sig = pairs
        .iter()
        .map(|p| format!("{}:{}:{}", p.id, p.local_dir, p.enabled))
        .collect::<Vec<_>>()
        .join(";");
    {
        let mut l = LAST_SIG.get_or_init(|| Mutex::new(String::new())).lock().unwrap();
        if *l == sig {
            // الوكيل قد يتغير دون تغير الأزواج — أعد المراقبين إن تغير
            let mut la = LAST_AGENT.get_or_init(|| Mutex::new(String::new())).lock().unwrap();
            if *la == agent {
                return;
            }
            *la = agent.clone();
            runtimes().lock().unwrap().clear();
        } else {
            *l = sig.clone();
            let mut la = LAST_AGENT.get_or_init(|| Mutex::new(String::new())).lock().unwrap();
            if *la != agent {
                *la = agent.clone();
                runtimes().lock().unwrap().clear();
            }
        }
    }

    // زرع الأزواج الحالية (لقراءة pair_dirs من خيوط المراقبة)
    {
        let mut lp = LAST_PAIRS.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
        *lp = pairs.clone();
    }

    let agents_root = server_root.join("data").join("nexus-storage").join("agents");
    let mut rt = runtimes().lock().unwrap();
    let mut keep: HashSet<String> = HashSet::new();
    for p in pairs.iter().filter(|p| p.enabled) {
        keep.insert(p.id.clone());
        if rt.contains_key(&p.id) {
            continue;
        }
        // مراقب مجلد محلي (صادر)
        let local_dir = PathBuf::from(&p.local_dir);
        if !local_dir.is_dir() {
            println!("[sync] pair {} local dir missing: {}", p.id, p.local_dir);
            continue;
        }
        let id_out = p.id.clone();
        let mut watchers = Vec::new();
        match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(ev) = res {
                on_local_event(&id_out, &ev.paths);
            }
        }) {
            Ok(mut w) => {
                if let Err(e) = w.watch(&local_dir, RecursiveMode::Recursive) {
                    println!("[sync] watch local {}: {e}", p.local_dir);
                } else {
                    watchers.push(w);
                }
            }
            Err(e) => println!("[sync] watcher local {}: {e}", p.id),
        }
        // مراقب جذر الوكيل (وارد)
        let agent_sync = agents_root.join(&agent).join("Sync").join(&p.id);
        if std::fs::create_dir_all(&agent_sync).is_ok() {
            let id_in = p.id.clone();
            match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                if let Ok(ev) = res {
                    on_agent_event(&id_in, &ev.paths);
                }
            }) {
                Ok(mut w) => {
                    if let Err(e) = w.watch(&agent_sync, RecursiveMode::Recursive) {
                        println!("[sync] watch agent {}: {e}", p.id);
                    } else {
                        watchers.push(w);
                    }
                }
                Err(e) => println!("[sync] watcher agent {}: {e}", p.id),
            }
        }
        rt.insert(p.id.clone(), PairRuntime { watchers, recent_out: Vec::new() });
        println!("[sync] pair {} active: {} ↔ {}", p.id, p.local_dir, p.phone_dir);
    }
    // إيقاف الأزواج المحذوفة/المعطلة
    rt.retain(|k, _| keep.contains(k));
}


/// حدث محلي → علّم rel لمعالجتها بعد التهدئة
fn on_local_event(pair_id: &str, paths: &[std::path::PathBuf]) {
    let (local_dir, _phone) = pair_dirs(pair_id);
    let Some(local_dir) = local_dir else { return };
    let mut pend = pending().lock().unwrap();
    let set = pend.entry(pair_id.to_string()).or_default();
    for p in paths {
        if let Some(rel) = rel_of(Path::new(&local_dir), p) {
            let name = rel.rsplit('/').next().unwrap_or("");
            if !should_skip_name(name) {
                set.insert(rel);
            }
        }
    }
    schedule_flush(pair_id.to_string());
}

/// حدث جذر الوكيل → علّم rel الواردة
fn on_agent_event(pair_id: &str, paths: &[std::path::PathBuf]) {
    let agent_sync = agent_sync_dir(pair_id);
    let Some(root) = agent_sync else { return };
    let mut pend = pending().lock().unwrap();
    let set = pend.entry(format!("in:{pair_id}")).or_default();
    for p in paths {
        if let Some(rel) = rel_of(Path::new(&root), p) {
            let name = rel.rsplit('/').next().unwrap_or("");
            if !should_skip_name(name) {
                set.insert(rel);
            }
        }
    }
    schedule_flush(format!("in:{pair_id}"));
}

/// مجدولة معالجة مع تهادئة (thread لكل دفعة — المفتاح نفسه يُدمج)
fn schedule_flush(key: String) {
    let _ = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
        let batch: Vec<String> = {
            let mut pend = pending().lock().unwrap();
            match pend.remove(&key) {
                Some(set) => set.into_iter().collect(),
                None => Vec::new(),
            }
        };
        if batch.is_empty() {
            return;
        }
        if let Some(pair_id) = key.strip_prefix("in:") {
            process_inbound(pair_id, &batch);
        } else {
            process_outbound(&app_handle(), &key, &batch);
        }
    });
}

// مقبض التطبيق لاستخدامه من خيوط المراقبة (يُزرع من main.rs setup)
static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

pub fn set_app(app: AppHandle) {
    *APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(app);
}

fn app_handle() -> Option<AppHandle> {
    APP.get_or_init(|| Mutex::new(None)).lock().unwrap().clone()
}

fn pair_dirs(pair_id: &str) -> (Option<String>, Option<String>) {
    LAST_PAIRS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == pair_id)
        .map(|p| (Some(p.local_dir.clone()), Some(p.phone_dir.clone())))
        .unwrap_or((None, None))
}

fn agent_sync_dir(pair_id: &str) -> Option<PathBuf> {
    let app = app_handle()?;
    let agent = procman::current_agent_id();
    Some(
        procman::server_root(&app)
            .join("data")
            .join("nexus-storage")
            .join("agents")
            .join(agent)
            .join("Sync")
            .join(pair_id),
    )
}

/// الصادر: نسخ إلى Outbox + عرض نقل حي (القرارات من النواة النقية)
fn process_outbound(app: &Option<AppHandle>, pair_id: &str, rels: &[String]) {
    let Some(app) = app else { return };
    let (Some(local_dir), _) = pair_dirs(pair_id) else { return };
    let pc_fs = procman::server_root(app)
        .join("data")
        .join("nexus-storage")
        .join("pc-fs");
    let outbox = pc_fs.join("Outbox").join(pair_id);
    let mut sent = 0usize;
    for rel in rels {
        // حجم أقصى للإرسال التلقائي 200MB — الأكبر يحتاج زرًا يدويًا (حد موثق)
        let Some(out) = process_outgoing(Path::new(&local_dir), &outbox, rel, 200 * 1024 * 1024)
        else {
            continue;
        };
        let agent = procman::current_agent_id();
        let body = offer_body(&agent, pair_id, &rel, out.size);
        match procman::post_json("/api/devices", &body) {
            Ok(v) if v["ok"] == true => {
                sent += 1;
                let _ = staged_vpath_for(pair_id, rel); // الموثّق في السجل
                let mut rt = runtimes().lock().unwrap();
                if let Some(r) = rt.get_mut(pair_id) {
                    record_out(&mut r.recent_out, rel, now_ms());
                }
            }
            Ok(v) => println!("[sync] offer refused {rel}: {v}"),
            Err(e) => println!("[sync] offer failed {rel}: {e}"),
        }
    }
    if sent > 0 {
        crate::notify::plain(
            app,
            "مزامنة المجلدات",
            &format!("أُرسل {sent} ملفًا/ملفات إلى الهاتف"),
        );
    }
}

/// الوارد: من جذر الوكيل إلى المجلد المحلي (LWW + حارس صدى)
fn process_inbound(pair_id: &str, rels: &[String]) {
    let (Some(local_dir), _) = pair_dirs(pair_id) else { return };
    let Some(agent_sync) = agent_sync_dir(pair_id) else { return };
    let mut copied = 0usize;
    for rel in rels {
        // حارس صدى — خرج من هنا للتو؟ تجاهل (الهاتف أرفع نسخته بعد 6ث فقط إن عدّلها)
        {
            let rt = runtimes().lock().unwrap();
            if let Some(r) = rt.get(pair_id) {
                if is_self_write(&r.recent_out, rel, now_ms(), ECHO_GUARD_MS) {
                    continue;
                }
            }
        }
        let src = agent_sync.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let Some((rmt, rsize)) = file_mtime_size(&src) else { continue };
        let dst = Path::new(&local_dir).join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let (lexists, lmt, lsize) = match file_mtime_size(&dst) {
            Some((m, s)) => (true, m, s),
            None => (false, 0, 0),
        };
        let Some(plan) = inbound_plan(
            Path::new(&local_dir),
            &agent_sync,
            rel,
            lexists,
            lmt,
            lsize,
            rmt,
            rsize,
        ) else {
            continue;
        };
        if let Some(parent) = plan.dst.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::copy(&plan.src, &plan.dst) {
            Ok(_) => {
                copied += 1;
                // طابق mtime لمنع الترحال في الجولة التالية
                if let Ok(st) = std::fs::metadata(&plan.src) {
                    if let Ok(mt) = st.modified() {
                        let _ = filetime_copy(&plan.dst, mt);
                    }
                }
            }
            Err(e) => println!("[sync] inbound copy {rel}: {e}"),
        }
    }
    if copied > 0 {
        if let Some(app) = app_handle() {
            crate::notify::plain(
                &app,
                "مزامنة المجلدات",
                &format!("وصل {copied} ملفًا/ملفات من الهاتف"),
            );
        }
    }
}

/// كتابة mtime مستهدَف (يمنع الترحال في الجولة التالية)
fn filetime_copy(p: &Path, mt: SystemTime) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().write(true).open(p)?;
    f.set_modified(mt)
}

/// إيقاف كل المراقبين (عند الخروج)
pub fn stop_all() {
    runtimes().lock().unwrap().clear();
}
