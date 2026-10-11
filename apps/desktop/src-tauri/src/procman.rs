// NexusLink Desktop — مدير العمليات المضمّنة (procman)
// ============================================================
// يدير ثلاث عمليات Node داخل التطبيق:
//   next    → Next standalone (الواجهة + REST + الجسور الداخلية 3004-3009) :3000
//   gateway → بوابة الإدخال (بديل Caddy بنفس العقد ?XTransformPort)      :81→8180
//   comms   → جسر الاتصالات + إعلان mDNS (_nexuslink._tcp)               :3003
// دورة الحياة: إقلاع متسلسل بانتظار الجاهزية → مراقبة صحية → إعادة تشغيل
// بتراجع أسّي عند الانهيار → إيقاف مؤقت/استئناف من الـ Tray → قتل نظيف عند الخروج.
use serde_json::json;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const REST_PORT: u16 = 3000;
const COMMS_PORT: u16 = 3003;
const HEALTH_TIMEOUT: Duration = Duration::from_millis(1600);

#[derive(Clone)]
pub struct ProcSpec {
    pub name: &'static str,
    pub script: String,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
}

pub struct ProcHandle {
    pub spec: ProcSpec,
    pub child: Mutex<Option<Child>>,
    pub started_at: Mutex<Instant>,
    pub attempts: AtomicU32,
}

pub struct DesktopState {
    pub node: PathBuf,
    #[allow(dead_code)]
    pub res: PathBuf,
    #[allow(dead_code)]
    pub server_name: String,
    pub procs: Mutex<Vec<std::sync::Arc<ProcHandle>>>,
    pub gateway_port: Mutex<Option<u16>>,
    pub ready: AtomicBool,
    pub paused: AtomicBool,
    pub fail_streak: AtomicU32,
}

static STATE: OnceLock<DesktopState> = OnceLock::new();
static PAUSE_SIGNAL: AtomicBool = AtomicBool::new(false);

// ---------- أدوات مساعدة ----------

fn http_get_json(port: u16, path: &str) -> Option<serde_json::Value> {
    use std::net::TcpStream;
    let mut s = TcpStream::connect(("127.0.0.1", port)).ok()?;
    s.set_read_timeout(Some(HEALTH_TIMEOUT)).ok()?;
    s.set_write_timeout(Some(HEALTH_TIMEOUT)).ok()?;
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nAccept: application/json\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let _ = s.take(1 << 20).read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    // تحمّلي: نأخذ من أول { إلى آخر } (يتعامل تلقائيًا مع chunked وحيد الإطار)
    let body = text.split("\r\n\r\n").nth(1)?;
    let start = body.find('{')?;
    let end = body.rfind('}')?;
    serde_json::from_str(&body[start..=end]).ok()
}

fn machine_name() -> String {
    if let Ok(n) = std::env::var("NEXUSLINK_NAME") {
        if !n.trim().is_empty() {
            return n.trim().to_string();
        }
    }
    if let Ok(n) = std::env::var("COMPUTERNAME") {
        if !n.trim().is_empty() {
            return n.trim().to_string();
        }
    }
    if let Ok(n) = std::fs::read_to_string("/etc/hostname") {
        let n = n.trim().to_string();
        if !n.is_empty() {
            return n;
        }
    }
    "NEXUS-PC".to_string()
}

fn resolve_node() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            if cand.exists() {
                return cand;
            }
        }
    }
    PathBuf::from("node") // من PATH (وضع التطوير أو بلا sidecar)
}

fn resolve_resources(app: &AppHandle) -> PathBuf {
    if let Ok(rd) = app.path().resource_dir() {
        if rd.join("server/server.js").exists() {
            return rd;
        }
    }
    // وضع التطوير: الموارد في src-tauri/resources (بعد build-resources.sh)
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

fn emit_status(app: &AppHandle, stage: &str, ar: &str, en: &str) {
    println!("[procman] {stage}: {ar}");
    let _ = app.emit("desktop://status", json!({ "stage": stage, "ar": ar, "en": en }));
    crate::tray::on_stage(app, stage);
}

// ---------- إقلاع العمليات ----------

fn spawn_proc(state: &DesktopState, spec: &ProcSpec, arc: &std::sync::Arc<ProcHandle>) -> Result<(), String> {
    // معالجة دفاعية: أي عملية سابقة لنفس الدور تُقتل أولًا (إقلاع idempotent بلا تسريب)
    if let Some(mut old) = arc.child.lock().unwrap().take() {
        let _ = old.kill();
        let _ = old.wait();
        std::thread::sleep(Duration::from_millis(120)); // لحظة تحرير المنفذ
    }
    let mut cmd = Command::new(&state.node);
    cmd.arg(&spec.script)
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    // ويندوز: بلا نافذة كونسول لكل عملية node
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn {}: {e}", spec.name))?;

    // تجفيف الأنابيب إلزامي — امتلاء buffer يجمّد السيرفر
    if let Some(out) = child.stdout.take() {
        let name = spec.name;
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if name == "gateway" {
                    if let Some(p) = line.trim().strip_prefix("[gateway] PORT=") {
                        if let Ok(port) = p.trim().parse::<u16>() {
                            if let Some(st) = STATE.get() {
                                *st.gateway_port.lock().unwrap() = Some(port);
                            }
                        }
                    }
                }
                println!("[{name}] {line}");
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let name = spec.name;
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                println!("[{name}] {line}");
            }
        });
    }

    *arc.child.lock().unwrap() = Some(child);
    *arc.started_at.lock().unwrap() = Instant::now();
    arc.attempts.store(0, Ordering::Relaxed);
    Ok(())
}

fn register(state: &DesktopState, spec: ProcSpec) -> std::sync::Arc<ProcHandle> {
    let arc = std::sync::Arc::new(ProcHandle {
        spec,
        child: Mutex::new(None),
        started_at: Mutex::new(Instant::now()),
        attempts: AtomicU32::new(0),
    });
    state.procs.lock().unwrap().push(std::sync::Arc::clone(&arc));
    arc
}

fn proc_by_name(state: &DesktopState, name: &str) -> Option<std::sync::Arc<ProcHandle>> {
    state.procs.lock().unwrap().iter().find(|p| p.spec.name == name).cloned()
}

fn wait_for<F: Fn() -> bool>(timeout: Duration, tick: Duration, mut ok: F) -> bool {
    let t0 = Instant::now();
    while t0.elapsed() < timeout {
        if ok() {
            return true;
        }
        std::thread::sleep(tick);
    }
    false
}

fn boot(app: &AppHandle, state: &DesktopState) -> bool {
    state.ready.store(false, Ordering::Relaxed);
    state.fail_streak.store(0, Ordering::Relaxed);
    *state.gateway_port.lock().unwrap() = None;

    // 1) واجهة + REST + الجسور الداخلية
    emit_status(app, "next", "تشغيل سيرفر الواجهة والجسور…", "Starting UI server & bridges…");
    let next = proc_by_name(state, "next").expect("next registered");
    let next_spec = next.spec.clone();
    if let Err(e) = spawn_proc(state, &next_spec, &next) {
        emit_status(app, "error", &format!("تعذّر تشغيل الواجهة: {e}"), &format!("UI server failed: {e}"));
        return false;
    }
    let health_ok = wait_for(Duration::from_secs(90), Duration::from_millis(500), || {
        http_get_json(REST_PORT, "/api/health").map(|j| j["ok"] == true).unwrap_or(false)
    });
    if !health_ok {
        emit_status(app, "error", "انتهت مهلة جاهزية سيرفر الواجهة", "UI server health timeout");
        return false;
    }

    // 2) بوابة الإدخال (تقرر منفذها الفعلي: 81 أو التراجع 8180)
    emit_status(app, "gateway", "تشغيل بوابة الإدخال…", "Starting entry gateway…");
    let gw = proc_by_name(state, "gateway").expect("gateway registered");
    let gw_spec = gw.spec.clone();
    if let Err(e) = spawn_proc(state, &gw_spec, &gw) {
        emit_status(app, "error", &format!("تعذّر تشغيل البوابة: {e}"), &format!("gateway failed: {e}"));
        return false;
    }
    wait_for(Duration::from_secs(6), Duration::from_millis(150), || {
        state.gateway_port.lock().unwrap().is_some()
    });
    let gw_port = state.gateway_port.lock().unwrap().unwrap_or(81);

    // 3) جسر الاتصالات + mDNS (يعلن منفذ البوابة الفعلي)
    emit_status(app, "comms", "تشغيل جسر الاتصالات والاكتشاف…", "Starting comms bridge & mDNS…");
    let comms = proc_by_name(state, "comms").expect("comms registered");
    let mut comms_spec = comms.spec.clone();
    // env الديناميكي الوحيد: منفذ البوابة الفعلي
    if let Some(e) = comms_spec.env.iter_mut().find(|(k, _)| k == "NEXUSLINK_GATEWAY_PORT") {
        e.1 = gw_port.to_string();
    }
    if let Err(e) = spawn_proc(state, &comms_spec, &comms) {
        emit_status(app, "error", &format!("تعذّر تشغيل جسر الاتصالات: {e}"), &format!("comms failed: {e}"));
        return false;
    }
    let comms_ok = wait_for(Duration::from_secs(15), Duration::from_millis(400), || {
        http_get_json(COMMS_PORT, "/status").map(|j| j["ok"] == true).unwrap_or(false)
    });
    let gw_ok = wait_for(Duration::from_secs(10), Duration::from_millis(400), || {
        http_get_json(gw_port, "/__gw/health").map(|j| j["ok"] == true).unwrap_or(false)
    });
    if !comms_ok || !gw_ok {
        emit_status(app, "error", "انتهت مهلة جاهزية البوابة/جسر الاتصالات", "gateway/comms health timeout");
        return false;
    }

    // 4) جاهز — افتح الواجهة وأغلق شاشة التحميل
    state.ready.store(true, Ordering::Relaxed);
    emit_status(app, "ready", "جاهز — جميع الخدمات تعمل", "Ready — all services are up");
    open_main_full(app);
    true
}

// ---------- المراقبة والصيانة ----------

fn restart_policy(arc: &ProcHandle) -> Duration {
    let n = arc.attempts.fetch_add(1, Ordering::Relaxed);
    let ms = 1000u64.saturating_mul(1u64 << n.min(4)); // 1s,2s,4s,8s,16s→15s cap
    Duration::from_millis(ms.min(15_000))
}

fn monitor_tick(app: &AppHandle, state: &DesktopState) {
    // 1) عملية ميتة؟ اجمعها أولًا (دون إمساك قفل procs أثناء الإعادة) ثم أعد تشغيلها بتراجع أسّي
    let dead: Vec<std::sync::Arc<ProcHandle>> = {
        let procs = state.procs.lock().unwrap();
        procs
            .iter()
            .filter(|arc| {
                let mut guard = arc.child.lock().unwrap();
                match guard.as_mut() {
                    None => true,
                    Some(c) => c.try_wait().map(|o| o.is_some()).unwrap_or(true),
                }
            })
            .cloned()
            .collect()
    };
    for arc in dead {
        let ran_stable = arc.started_at.lock().unwrap().elapsed() > Duration::from_secs(60);
        if ran_stable {
            arc.attempts.store(0, Ordering::Relaxed);
        }
        let wait = restart_policy(arc);
        println!("[procman] {} dead → restart in {:?}", arc.spec.name, wait);
        std::thread::sleep(wait);
        let _ = spawn_proc(state, &arc.spec, &arc);
        emit_status(app, "recover", &format!("أُعيد تشغيل {}…", arc.spec.name), &format!("restarting {}…", arc.spec.name));
    }

    // 2) الصحة الكلية + إشارة حياة الهاتف للـ Tray (كل ~10 ثوانٍ)
    static TICK: AtomicU32 = AtomicU32::new(0);
    let tick = TICK.fetch_add(1, Ordering::Relaxed) + 1;
    if tick % 5 != 0 {
        return;
    }
    if state.ready.load(Ordering::Relaxed) {
        match http_get_json(REST_PORT, "/api/desktop/status") {
            Some(j) => {
                state.fail_streak.store(0, Ordering::Relaxed);
                let online = j.pointer("/phone/online") == Some(&serde_json::Value::Bool(true));
                crate::tray::set_state(app, if online { "connected" } else { "waiting" });
            }
            None => {
                let n = state.fail_streak.fetch_add(1, Ordering::Relaxed) + 1;
                if n > 10 {
                    crate::tray::set_state(app, "error");
                } else {
                    crate::tray::set_state(app, "waiting");
                }
            }
        }
    }
}

// ---------- واجهة عامة ----------

pub fn start(app: AppHandle) {
    let node = resolve_node();
    let res = resolve_resources(&app);
    let server_name = machine_name();
    println!("[procman] node={node:?} resources={res:?} name={server_name:?}");

    let next_spec = ProcSpec {
        name: "next",
        script: res.join("server/server.js").to_string_lossy().to_string(),
        env: vec![
            ("PORT".into(), REST_PORT.to_string()),
            ("HOSTNAME".into(), "0.0.0.0".into()),
            ("NODE_ENV".into(), "production".into()),
        ],
        cwd: Some(res.join("server").to_string_lossy().to_string()),
    };
    let gw_spec = ProcSpec {
        name: "gateway",
        script: res.join("gateway/gateway.cjs").to_string_lossy().to_string(),
        env: vec![("GATEWAY_PORT".into(), "81".into()), ("REST_PORT".into(), REST_PORT.to_string())],
        cwd: None,
    };
    let comms_spec = ProcSpec {
        name: "comms",
        script: res.join("comms/comms.cjs").to_string_lossy().to_string(),
        env: vec![
            ("PORT".into(), COMMS_PORT.to_string()),
            ("NEXT_BASE".into(), format!("http://127.0.0.1:{REST_PORT}")),
            ("NEXUSLINK_NAME".into(), server_name.clone()),
            ("NEXUSLINK_GATEWAY_PORT".into(), "81".into()), // يُحدَّث بعد إقلاع البوابة
        ],
        cwd: None,
    };

    let st = STATE.get_or_init(move || DesktopState {
        node,
        res,
        server_name,
        procs: Mutex::new(Vec::new()),
        gateway_port: Mutex::new(None),
        ready: AtomicBool::new(false),
        paused: AtomicBool::new(false),
        fail_streak: AtomicU32::new(0),
    });
    register(st, next_spec);
    register(st, gw_spec);
    register(st, comms_spec);

    std::thread::spawn(move || {
        // صبر أولي على النافذة قبل بدء الإقلاع (لترى شاشة التحميل)
        std::thread::sleep(Duration::from_millis(350));
        loop {
            let paused = PAUSE_SIGNAL.load(Ordering::Relaxed);
            if paused {
                if !st.paused.load(Ordering::Relaxed) {
                    kill_all();
                    st.paused.store(true, Ordering::Relaxed);
                    st.ready.store(false, Ordering::Relaxed);
                    emit_status(&app, "paused", "السيرفر موقوف مؤقتًا", "Server paused");
                }
                std::thread::sleep(Duration::from_millis(300));
                continue;
            }
            if st.paused.swap(false, Ordering::Relaxed) {
                emit_status(&app, "resuming", "استئناف الخدمات…", "Resuming services…");
            }
            if !st.ready.load(Ordering::Relaxed) {
                let ok = boot(&app, st);
                if !ok {
                    // تراجع ثم حاول من جديد (الإقلاع الكامل مع إعادة تنظيف العمليات)
                    kill_all();
                    std::thread::sleep(Duration::from_secs(3));
                }
                continue;
            }
            monitor_tick(&app, st);
            std::thread::sleep(Duration::from_millis(2000));
        }
    });
}

pub fn kill_all() {
    if let Some(st) = STATE.get() {
        for arc in st.procs.lock().unwrap().iter() {
            if let Some(mut c) = arc.child.lock().unwrap().take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

pub fn toggle_pause(app: &AppHandle) {
    let now_paused = !PAUSE_SIGNAL.load(Ordering::Relaxed);
    PAUSE_SIGNAL.store(now_paused, Ordering::Relaxed);
    if now_paused {
        crate::tray::set_state(app, "paused");
    }
    // الاستئناف يتابعه حلقة الإدارة (boot من جديد)
    crate::tray::on_pause_toggled(app, now_paused);
}

/// فتح/إبراز نافذة الواجهة (أو شاشة التحميل أثناء الإقلاع)
pub fn open_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Some(s) = app.get_webview_window("splash") {
        let _ = s.show();
        let _ = s.set_focus();
    }
}

fn open_main_full(app: &AppHandle) {
    let url: tauri::Url = format!("http://127.0.0.1:{REST_PORT}/?desktop=1").parse().expect("valid url");
    let app2 = app.clone();
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("NexusLink")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 620.0)
        .visible(false)
        .on_page_load(move |_wv, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Some(w) = app2.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                if let Some(s) = app2.get_webview_window("splash") {
                    let _ = s.close();
                }
            }
        })
        .build();
}
