// NexusLink — NexusLive مستقبل UDP الأصلي (الجولة 4 — عقد §18)
// ============================================================================
// «قناة UDP عالية التردد للإدخال الحي»: الطرف الأصلي على سطح المكتب.
// يرتبط على 127.0.0.1 حصرًا (NEXUS_LIVE_SINK_PORT — افتراضي 3011) — لا سطح
// هجوم شبكي: كل الثقة (جلسة موثوقة + مفتاح 8B + تثبيت عنوان المرسل) تُدار
// على جسر 3004 (Node) الذي يمرر الحزم الصالحة حصرًا إلى هذا المقبس.
//
// المسار: داتاجرام → live_core (فك ثنائي صارم) → أحداث JSON لمحلّل الإدخال
// القائم (input_exec §13/§15 — بلا مسار حقن موازٍ) → input::execute_sync
// (نفس بوابة الجلسة + انتظار اكتمال الحقن الفعلي في خيط enigo).
//
// القياس: ts المرسل (ملي ثانية epoch مقتطعة u32 بعد مزامنة إزاحة NTP-نمط
// عبر ping/pong على الجسر) مقابل ساعة الاستقبال — كمون طرف-إ-to-طرف حقيقي
// يُجمع في نافذة 256 عينة (P50/P95) ويُهمل العينة فوق 60ث (انحراف ساعة).
// إحصاء المستقبل متاح عبر أمر Tauri live_state (§18).
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[path = "live_core.rs"]
pub mod core;

static LISTENING: AtomicBool = AtomicBool::new(false);
static SINK_PORT: AtomicU64 = AtomicU64::new(0);

// إحصاء المستقبل الأصلي (جانب Rust — إحصاء الجسر عند Node بجانبه)
static RX_PACKETS: AtomicU64 = AtomicU64::new(0);
static INJECTED: AtomicU64 = AtomicU64::new(0);
static DROPPED_MALFORMED: AtomicU64 = AtomicU64::new(0);
static DROPPED_NO_SESSION: AtomicU64 = AtomicU64::new(0);
static INJECT_ERRORS: AtomicU64 = AtomicU64::new(0);
static GYRO_COUNT: AtomicU64 = AtomicU64::new(0);
static CLOCK_SKEW: AtomicU64 = AtomicU64::new(0);
static LAST_INJECT_US: AtomicU64 = AtomicU64::new(0);

/// نافذة كمون طرف-إلى-طرف (256 عينة) — P50/P95 عبر أمر live_state
static LAT_WINDOW: OnceLock<Mutex<VecDeque<u64>>> = OnceLock::new();

fn lat_window() -> &'static Mutex<VecDeque<u64>> {
    LAT_WINDOW.get_or_init(|| Mutex::new(VecDeque::with_capacity(256)))
}

fn push_latency(ms: u64) {
    let mut w = lat_window().lock().unwrap();
    if w.len() >= 256 {
        w.pop_front();
    }
    w.push_back(ms);
}

fn latency_percentiles() -> (Option<u64>, Option<u64>, usize) {
    let mut v: Vec<u64> = lat_window().lock().unwrap().iter().copied().collect();
    if v.is_empty() {
        return (None, None, 0);
    }
    v.sort_unstable();
    let p50 = v[v.len() / 2];
    let p95 = v[(v.len() * 95 / 100).min(v.len() - 1)];
    (Some(p50), Some(p95), v.len())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// منفذ الحوض — NEXUS_LIVE_SINK_PORT (افتراضي 3011، عقد §18)
fn sink_port() -> u32 {
    std::env::var("NEXUS_LIVE_SINK_PORT")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|p| (1024..65536).contains(p))
        .unwrap_or(3011)
}

/// إطلاق المستقبل عند الإقلاع (setup) — خيط واحد مدى حياة التطبيق.
/// فشل الربط لا يُسقط الإقلاع أبدًا: القناة الحية ميزة اختيارية (بذرتان
/// إعادة محاولة ثم استسلام صادق مع طباعة السبب).
pub fn spawn(app: tauri::AppHandle) {
    std::thread::Builder::new().name("nexus-live-sink".into()).spawn(move || run(app)).ok();
}

fn run(app: tauri::AppHandle) {
    let port = sink_port();
    let mut sock: Option<UdpSocket> = None;
    for attempt in 1..=3 {
        match UdpSocket::bind(("127.0.0.1", port as u16)) {
            Ok(s) => {
                sock = Some(s);
                break;
            }
            Err(e) => {
                println!("[live] bind 127.0.0.1:{port} فشل (محاولة {attempt}/3): {e}");
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }
    let sock = match sock {
        Some(s) => s,
        None => {
            println!("[live] NexusLive معطل — المنفذ {port} محجوز بمقبس آخر (قناة اختيارية)");
            return;
        }
    };
    LISTENING.store(true, Ordering::Relaxed);
    SINK_PORT.store(port as u64, Ordering::Relaxed);
    println!("[live] NexusLive sink يستمع على 127.0.0.1:{port} (حوض حصري بعد بوابة الجسر)");

    let mut buf = [0u8; 2048];
    let mut last_audit_count: u64 = 0;
    loop {
        // 1) أول حزمة: حجز مُنعكس (لا دوران مستهلك للمعالج)
        let n = match sock.recv_from(&mut buf) {
            Ok((n, _)) => n,
            Err(_) => {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
        };
        RX_PACKETS.fetch_add(1, Ordering::Relaxed);
        let mut ts_newest: u32 = 0;
        let mut batch: Vec<Value> = Vec::with_capacity(8);
        absorb(&app, &buf[..n], &mut batch, &mut ts_newest);

        // 2) تفريغ غير حاجز حتى 4 حزم إضافية (سقف الكمون المدمج) — الطابور في مقبس النظام
        //    والدمج الحي أدناه يمنع نمو الكمون خطيًا تحت التحميل
        let _ = sock.set_nonblocking(true);
        let mut drained = 0;
        while drained < 4 {
            match sock.recv_from(&mut buf) {
                Ok((n2, _)) => {
                    RX_PACKETS.fetch_add(1, Ordering::Relaxed);
                    absorb(&app, &buf[..n2], &mut batch, &mut ts_newest);
                    drained += 1;
                }
                Err(_) => break, // WouldBlock — انتهى ما هو متاح
            }
        }
        let _ = sock.set_nonblocking(false);

        // 3) دمج حي (latest-wins) — أحدث حركة فقط، والمنفصلات كلها بالترتيب
        let coalesced = core::coalesce(batch);
        if coalesced.is_empty() {
            continue;
        }
        // 4) بوابة الجلسة §13 (فحص مبكر للإحصاء — الحقن يعيد الفحص حتمًا)
        if !crate::input::is_active() {
            DROPPED_NO_SESSION.fetch_add(coalesced.len() as u64, Ordering::Relaxed);
            continue;
        }
        // 5) حقن الدفعة متزامنًا (انتظار اكتمال الحقن الفعلي) وقياس كمون
        //    أحدث حزمة في الدفعة طرف-إ-إلى-طرف (ts المرسل بعد إزاحة NTP-نمط)
        let t0 = Instant::now();
        match crate::input::execute_sync(&app, &coalesced, "controller") {
            Ok(()) => {
                INJECTED.fetch_add(coalesced.len() as u64, Ordering::Relaxed);
                LAST_INJECT_US.store(t0.elapsed().as_micros() as u64, Ordering::Relaxed);
                if ts_newest != 0 {
                    let e2e = (now_ms() as u32).wrapping_sub(ts_newest);
                    if e2e < 60_000 {
                        // عينة صالحة (انحراف الساعة المفرط يُهمل — موثق §18)
                        push_latency(e2e as u64);
                    } else {
                        CLOCK_SKEW.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            Err(_) => {
                // سباقات الجلسة/انتهاء المهلة — إحصاء صادق (فشل الحقن نفسه يُبث للواجهة من القناة)
                INJECT_ERRORS.fetch_add(1, Ordering::Relaxed);
            }
        }
        // 6) تدقيق خفيف كل 1000 حقنة (طابور التدقيق §16 — بلا إغراق)
        let inj = INJECTED.load(Ordering::Relaxed);
        if inj / 1000 != last_audit_count / 1000 {
            last_audit_count = inj;
            crate::audit::audit("input", "info", format!("NexusLive: حقن {inj} حزمة حية حتى الآن"));
        }
    }
}

/// فك حزمة واحدة وإضافة أحداثها إلى الدفعة (إحصاء ping/gyro/الفاسد هنا)
fn absorb(app: &tauri::AppHandle, buf: &[u8], batch: &mut Vec<Value>, ts_newest: &mut u32) {
    let _ = app;
    let (h, p) = match core::parse(buf) {
        Ok(x) => x,
        Err(e) => {
            DROPPED_MALFORMED.fetch_add(1, Ordering::Relaxed);
            // سبب عربي مرة كل 100 رفض كي لا يغرق السجل (نفس سياسة الجسر الصامتة)
            let n = DROPPED_MALFORMED.load(Ordering::Relaxed);
            if n % 100 == 1 {
                println!("[live] رفض حزمة فاسدة: {}", e.reason());
            }
            return;
        }
    };
    match p {
        // ping يرد عليه الجسر مباشرة — لا يصل هنا إلا انحرافًا: تجاهل صامت
        core::Payload::Ping | core::Payload::Pong => return,
        // الجيروسكوب: بلا وضع نشط → إحصاء فقط (كما كانت §18). الوضع النشط
        // (عقد §21) يستهلكه gyro::consume_gyro — يترجمه لأحداث قياسية (key/move/
        // presenter) عبر المسار القائم حصرًا — بلا مسار حقن موازٍ.
        core::Payload::Gyro { ax, ay, az, gx, gy, gz } => {
            let gyro_evs = crate::gyro::consume_gyro(h.flags, ax, ay, az, gx, gy, gz);
            if gyro_evs.is_empty() {
                GYRO_COUNT.fetch_add(1, Ordering::Relaxed);
                return;
            }
            if h.ts > *ts_newest {
                *ts_newest = h.ts;
            }
            batch.extend(gyro_evs);
            return;
        }
        // الجولة 4 مرحلة ② (عقد §20) — وضع اللوحة الافتراضية (لينكس uinput):
        // القلم يستهلك هنا حصرًا خلال جلسة نشطة (بوابة §13 فحصها المستهلك
        // حتمًا أيضًا) — خارج الوضع/المنصة يمر لمسار الماوس المطلق كالمعتاد.
        core::Payload::Pen { nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool } => {
            if crate::tablet::consume_pen(nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool) {
                return;
            }
        }
        _ => {}
    }
    let events = core::packet_to_events(&h, &p);
    if events.is_empty() {
        return;
    }
    if h.ts > *ts_newest {
        *ts_newest = h.ts;
    }
    batch.extend(events);
}

/// حالة القناة الحية الأصلية (أمر Tauri — عقد §18)
#[tauri::command]
pub fn live_state() -> Value {
    let (p50, p95, samples) = latency_percentiles();
    json!({
        "listening": LISTENING.load(Ordering::Relaxed),
        "sinkPort": SINK_PORT.load(Ordering::Relaxed),
        "sessionActive": crate::input::is_active(),
        "stats": {
            "rxPackets": RX_PACKETS.load(Ordering::Relaxed),
            "injected": INJECTED.load(Ordering::Relaxed),
            "droppedMalformed": DROPPED_MALFORMED.load(Ordering::Relaxed),
            "droppedNoSession": DROPPED_NO_SESSION.load(Ordering::Relaxed),
            "injectErrors": INJECT_ERRORS.load(Ordering::Relaxed),
            "gyroPackets": GYRO_COUNT.load(Ordering::Relaxed),
            "clockSkewDropped": CLOCK_SKEW.load(Ordering::Relaxed),
        },
        "latency": {
            "p50Ms": p50,
            "p95Ms": p95,
            "samples": samples,
            "lastInjectUs": LAST_INJECT_US.load(Ordering::Relaxed),
        }
    })
}
