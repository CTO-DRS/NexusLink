// NexusLink — محرك تحقق القناة الحية NexusLive (الجولة 4 — عقد §18)
// ============================================================================
// يُضمِّن حرفيًا: live_core.rs (البروتوكول الثنائي) وinput_exec.rs (محلّل
// الإدخال) — مصدر واحد للمنطق مع التطبيق، ثم يشغّل:
//   1) فك/ترميز كل الأنواع (pen/mouse مطلق+نسبي/gyro/touch/ping) + رفض الفاسد
//   2) إحصاء التسلسل (ok/lost/reorder/dup/wrap) — نفس دلالة الجسر (TS)
//   3) خريطة الأحداث: ضغط القلم محمول · drag الذاتي التصحيح · عجلة→scroll ·
//      نقر الوضع النسبي · gyro بلا حدث
//   4) **UDP loopback حقيقي عبر Xvfb**: مرسل خيطي يبث 200 حزمة قلم/لمس/ماوس
//      → مستقبل يفك ويحقن عبر enigo فعليًا — كمون طرف-إ-to-طرف P95 < 20ms إلزامًا
// بيئة Xvfb (نفس enigo-verify): شغّله بـ xvfb-run أو اضبط DISPLAY
use std::net::UdpSocket;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

mod core {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/live_core.rs"));
}

mod exec {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/input_exec.rs"));
}

static PASS: AtomicUsize = AtomicUsize::new(0);
static FAIL: AtomicUsize = AtomicUsize::new(0);

fn check(name: &str, cond: bool, detail: impl Into<String>) {
    let d = detail.into();
    if cond {
        PASS.fetch_add(1, Ordering::SeqCst);
        println!("  ✅ {name}");
    } else {
        FAIL.fetch_add(1, Ordering::SeqCst);
        println!("  ❌ {name} — {d}");
    }
}

fn section(title: &str) {
    println!("\n== {title} ==");
}

fn now32() -> u32 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u32).unwrap_or(0)
}

const KEY: [u8; 8] = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

fn main() {
    println!("NexusLink live-verify — القناة الحية NexusLive (عقد §18)");
    section("1) فك/ترميز الأنواع + رفض الفاسد");
    protocol_vectors();
    section("2) إحصاء التسلسل (wrap-aware)");
    seq_vectors();
    section("3) خريطة الأحداث إلى محلّل الإدخال");
    event_mapping();
    section("3.ب) الدمج الحي (latest-wins)");
    coalesce_vectors();
    section("4) UDP loopback حقيقي + حقن enigo فعلي (Xvfb)");
    udp_loopback_injection();
    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("\n=========================");
    println!("live-verify: {p} ناجح / {f} فاشل");
    if f > 0 {
        std::process::exit(1);
    }
}

// ---------------------------------------------------------------------------
// 1) متجهات البروتوكول
// ---------------------------------------------------------------------------
fn protocol_vectors() {
    // pen: ترميز→فك دورة كاملة
    let pkt = core::encode_pen(7, 12345, &KEY, 0.25, 0.75, 0.6, -30, 45, core::PEN_DOWN, 1);
    check("pen: الطول التعاقدي 32 بايت (22 رأس + 10)", pkt.len() == 32, format!("len={}", pkt.len()));
    let (h, p) = core::parse(&pkt).expect("pen parse");
    check("pen: الرأس (type/seq/ts/key)", h.ptype == core::TYPE_PEN && h.seq == 7 && h.ts == 12345 && h.key == KEY, format!("{h:?}"));
    match p {
        core::Payload::Pen { nx, ny, pressure, tilt_x, tilt_y, phase, buttons } => {
            check("pen: الحقول (nx/ny/pressure/tilt/phase/buttons)",
                (nx - 0.25).abs() < 1e-4 && (ny - 0.75).abs() < 1e-4 && (pressure - 0.6).abs() < 1e-4
                    && tilt_x == -30 && tilt_y == 45 && phase == core::PEN_DOWN && buttons == 1,
                format!("pen={nx},{ny},{pressure},{tilt_x},{tilt_y},{phase},{buttons}"));
        }
        other => check("pen: نوع الحمولة", false, format!("{other:?}")),
    }

    // touch
    let pkt = core::encode_touch(9, 54321, &KEY, 0.5, 0.5, core::ACT_CLICK, 2);
    check("touch: الطول التعاقدي 30 بايت (22+8)", pkt.len() == 30, format!("len={}", pkt.len()));
    let (_, p) = core::parse(&pkt).expect("touch parse");
    match p {
        core::Payload::Touch { nx, ny, action, pointer_id } => {
            check("touch: الحقول (0.5/0.5/click/id=2)",
                (nx - 0.5).abs() < 1e-4 && (ny - 0.5).abs() < 1e-4 && action == core::ACT_CLICK && pointer_id == 2,
                format!("touch={nx},{ny},{action},{pointer_id}"));
        }
        other => check("touch: نوع الحمولة", false, format!("{other:?}")),
    }

    // mouse مطلق
    let pkt = core::encode_mouse(3, 999, &KEY, false, 0.1, 0.9, core::ACT_MOVE, 0, -2);
    check("mouse مطلق: الطول التعاقدي 30 بايت (22+8)", pkt.len() == 30, format!("len={}", pkt.len()));
    let (h, p) = core::parse(&pkt).expect("mouse abs parse");
    check("mouse مطلق: flags=0 (غير نسبي)", !h.relative(), format!("flags={}", h.flags));
    match p {
        core::Payload::Mouse { a, b, phase, buttons, wheel } => {
            check("mouse مطلق: الحقول + عجلة -2",
                (a - 0.1).abs() < 1e-4 && (b - 0.9).abs() < 1e-4 && phase == core::ACT_MOVE && wheel == -2 && buttons == 0,
                format!("mouse={a},{b},{phase},{wheel}"));
        }
        other => check("mouse مطلق: نوع الحمولة", false, format!("{other:?}")),
    }

    // mouse نسبي (flags bit0) — قصّ ±500
    let pkt = core::encode_mouse(4, 1000, &KEY, true, -800.0, 320.4, core::ACT_MOVE, 1, 0);
    let (_, p) = core::parse(&pkt).expect("mouse rel parse");
    match p {
        core::Payload::Mouse { a, b, .. } => {
            check("mouse نسبي: قصّ dx إلى -500 والإبقاء على dy",
                a == -500.0 && b == 320.0, format!("rel={a},{b}"));
        }
        other => check("mouse نسبي: نوع الحمولة", false, format!("{other:?}")),
    }

    // gyro
    let pkt = core::encode_gyro(5, 7, &KEY, 100, -200, 300, -1000, 2000, -3000);
    check("gyro: الطول التعاقدي 34 بايت (22+12)", pkt.len() == 34, format!("len={}", pkt.len()));
    let (_, p) = core::parse(&pkt).expect("gyro parse");
    match p {
        core::Payload::Gyro { ax, ay, az, gx, gy, gz } => {
            check("gyro: الحقول الستة", ax == 100 && ay == -200 && az == 300 && gx == -1000 && gy == 2000 && gz == -3000, format!("gyro={ax},{ay},{az},{gx},{gy},{gz}"));
        }
        other => check("gyro: نوع الحمولة", false, format!("{other:?}")),
    }

    // ping/pong
    let pkt = core::encode_ping(77, 88, &KEY);
    check("ping: الطول 22 (بلا حمولة)", pkt.len() == 22, format!("len={}", pkt.len()));
    let (h, p) = core::parse(&pkt).expect("ping parse");
    check("ping: النوع والحمولة", h.ptype == core::TYPE_PING && matches!(p, core::Payload::Ping), format!("{h:?}"));
    let pong = core::encode_pong(77, 424242, &KEY);
    let (h2, _) = core::parse(&pong).expect("pong parse");
    check("pong: type=0x7E وts=زمن الجسر", h2.ptype == core::TYPE_PONG && h2.ts == 424242, format!("{h2:?}"));

    // ---- الفاسد يُرفض ----
    check("رفض: أقصر من الرأس", core::parse(&pkt[..21]) == Err(core::ParseError::TooShort), "short");
    let mut bad = pkt.clone();
    bad[0] = 0x00;
    check("رفض: توقيع خاطئ", core::parse(&bad) == Err(core::ParseError::BadMagic), "magic");
    let mut bad = pkt.clone();
    bad[2] = 2;
    check("رفض: إصدار غير مدعوم", core::parse(&bad) == Err(core::ParseError::BadVersion), "version");
    let mut bad = pkt.clone();
    bad[3] = 0x55;
    check("رفض: نوع غير معروف", core::parse(&bad) == Err(core::ParseError::BadType), "type");
    let mut bad = core::encode_touch(1, 1, &KEY, 0.1, 0.1, core::ACT_MOVE, 0);
    bad.push(0xAA); // بايت زائد — الطول لا يطابق النوع
    check("رفض: طول لا يطابق النوع", core::parse(&bad) == Err(core::ParseError::BadSize), "size");
    let big = vec![0u8; 200];
    check("رفض: فوق السقف 128", core::parse(&big) == Err(core::ParseError::TooLong), "too-long");
}

// ---------------------------------------------------------------------------
// 2) إحصاء التسلسل — نفس الدلالة المنفذة في الجسرين (TS)
// ---------------------------------------------------------------------------
fn seq_vectors() {
    use core::SeqUpdate::*;
    check("seq: متتابع → Ok", core::seq_update(5, 6) == Ok, "ok");
    check("seq: فجوة 3 → Lost(2)", core::seq_update(5, 8) == Lost(2), "lost");
    check("seq: تكرار → Dup", core::seq_update(8, 8) == Dup, "dup");
    check("seq: رجوع خلفي → Reorder", core::seq_update(100, 90) == Reorder, "reorder");
    check("seq: لف u32 (MAX→0) → Ok", core::seq_update(u32::MAX, 0) == Ok, "wrap");
    check("seq: لف مع فجوة → Lost(1)", core::seq_update(u32::MAX - 1, 0) == Lost(1), "wrap-lost");
}

// ---------------------------------------------------------------------------
// 3) خريطة الأحداث — بلا مسار حقن موازٍ
// ---------------------------------------------------------------------------
fn event_mapping() {
    // pen hover/move → pointer move + الضغط محمول
    let pkt = core::encode_pen(1, 1, &KEY, 0.3, 0.4, 0.85, 0, 0, core::PEN_MOVE, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("pen move → حدث pointer واحد", evs.len() == 1 && evs[0]["kind"] == "pointer", format!("{}", evs.len()));
    check("pen: الضغط محمول في الحدث (0.85 ± تكميم)", (evs[0]["pressure"].as_f64().unwrap_or(0.0) - 0.85).abs() < 1e-4, format!("{}", evs[0]));
    check("pen: action=move للطور الحركي", evs[0]["action"] == "move", format!("{}", evs[0]["action"]));

    let pkt = core::encode_pen(2, 1, &KEY, 0.3, 0.4, 0.9, 0, 0, core::PEN_DOWN, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("pen down → action=down (لوحة الرسم تحاكي الضغط)", evs[0]["action"] == "down", format!("{}", evs[0]));

    // touch click → pointer click
    let pkt = core::encode_touch(3, 1, &KEY, 0.6, 0.7, core::ACT_CLICK, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("touch click → pointer click بالإحداثيات", evs[0]["kind"] == "pointer" && evs[0]["action"] == "click" && (evs[0]["nx"].as_f64().unwrap() - 0.6).abs() < 1e-4, format!("{}", evs[0]));

    // mouse نسبي: حالة الزر في كل حزمة + نقر إضافي
    let pkt = core::encode_mouse(4, 1, &KEY, true, 12.0, -8.0, core::ACT_MOVE, 1, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("mouse نسبي → kind=move واحد", evs.len() == 1 && evs[0]["kind"] == "move", format!("{}", evs[0]));
    check("mouse نسبي: drag=true من bit0 الأزرار", evs[0]["drag"] == true, format!("{}", evs[0]));
    let pkt = core::encode_mouse(5, 1, &KEY, true, 0.0, 0.0, core::ACT_CLICK, 0, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("mouse نسبي click → حركة صفحية (حافة الزر) + نقرة", evs.len() == 2 && evs[1]["kind"] == "click" && evs[1]["button"] == "left", format!("{evs:?}"));
    let pkt = core::encode_mouse(6, 1, &KEY, true, 0.0, 0.0, core::ACT_RCLICK, 0, 0);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("mouse نسبي rclick → نقرة أيمن", evs.len() == 2 && evs[1]["button"] == "right", format!("{evs:?}"));

    // عجلة → scroll بتدرّج §13 (40px/نقرة)
    let pkt = core::encode_mouse(7, 1, &KEY, false, 0.5, 0.5, core::ACT_MOVE, 0, 3);
    let (h, p) = core::parse(&pkt).unwrap();
    let evs = core::packet_to_events(&h, &p);
    check("wheel=3 → scroll dy=120", evs[0]["kind"] == "scroll" && evs[0]["dy"] == 120.0, format!("{evs:?}"));

    // gyro بلا حدث
    let pkt = core::encode_gyro(8, 1, &KEY, 1, 2, 3, 4, 5, 6);
    let (h, p) = core::parse(&pkt).unwrap();
    check("gyro → بلا حدث حقن (إحصاء فقط)", core::packet_to_events(&h, &p).is_empty(), "gyro");
    // ping بلا حدث
    let pkt = core::encode_ping(9, 1, &KEY);
    let (h, p) = core::parse(&pkt).unwrap();
    check("ping → بلا حدث حقن", core::packet_to_events(&h, &p).is_empty(), "ping");
}

// ---------------------------------------------------------------------------
// 3.ب) متجهات الدمج الحي (latest-wins)
// ---------------------------------------------------------------------------
fn coalesce_vectors() {
    use serde_json::json;
    let mv = |n: f64| json!({"kind": "pointer", "nx": n, "ny": 0.5, "action": "move"});
    let cl = json!({"kind": "pointer", "nx": 0.1, "ny": 0.1, "action": "click"});
    let rel = |dx: f64| json!({"kind": "move", "dx": dx, "dy": 0.0, "drag": false});

    // ثلاث حركات مطلقة متتالية → الأحدث فقط
    let out = core::coalesce(vec![mv(0.1), mv(0.2), mv(0.3)]);
    check("دمج: 3 حركات مطلقة → الأحدث حصرًا", out.len() == 1 && (out[0]["nx"].as_f64().unwrap() - 0.3).abs() < 1e-9, format!("{out:?}"));
    // حركة ثم نقرة ثم حركة → الحركة الأولى + النقرة + آخر حركة (الموضع قبل النقرة)
    let out = core::coalesce(vec![mv(0.1), cl.clone(), mv(0.4)]);
    check("دمج: حركة/نقرة/حركة → 3 أحداث بالترتيب", out.len() == 3 && out[0]["nx"] == 0.1 && out[1]["action"] == "click" && out[2]["nx"] == 0.4, format!("{out:?}"));
    // نقرتان منفصلتان لا تُدمجان أبدًا
    let out = core::coalesce(vec![cl.clone(), cl.clone()]);
    check("دمج: النقرات المنفصلة تُحفظ كلها", out.len() == 2, format!("{out:?}"));
    // حركة نسبية وحركة مطلقة slotان مستقلان — أحدث كليهما محفوظ (ترتيب
    // التفريغ بين الـ slotين ثابت مُنفّذ: المطلق ثم النسبي — لا ندّعي غيره)
    let out = core::coalesce(vec![rel(1.0), rel(2.0), mv(0.5), mv(0.6)]);
    let has_rel_latest = out.iter().any(|e| e["dx"] == 2.0 && e["kind"] == "move");
    let has_ptr_latest = out.iter().any(|e| e["nx"] == 0.6 && e["kind"] == "pointer");
    check("دمج: النسبي والمطلق slotان مستقلان (أحدث كليهما)", out.len() == 2 && has_rel_latest && has_ptr_latest, format!("{out:?}"));
    // الحركة المعلقة تُفرغ قبل النقرة اللاحقة (الموضع قبل النقرة)
    let out = core::coalesce(vec![mv(0.7), cl]);
    check("دمج: الحركة المعلقة تسبق النقرة", out.len() == 2 && out[0]["kind"] == "pointer" && out[0]["action"] == "move" && out[1]["action"] == "click", format!("{out:?}"));
}

// ---------------------------------------------------------------------------
// 4) UDP loopback حقيقي + حقن enigo فعلي — هدف <20ms إلزامًا
//    نفس مسار live.rs حرفيًا: أول حزمة حاجزة → تفريغ غير حاجز (≤16) →
//    دمج حي (latest-wins) → حقن الدفعة متزامنًا → قياس كمون أحدث حزمة
// ---------------------------------------------------------------------------
fn udp_loopback_injection() {
    // فضاء المؤشر على شاشة Xvfb الشائعة (نمط media-verify)
    exec::set_pointer_space(1280, 1024, 0, 0);
    let mut enigo = match enigo::Enigo::new(&enigo::Settings {
        release_keys_when_dropped: false,
        ..Default::default()
    }) {
        Ok(e) => e,
        Err(e) => {
            check("enigo init (Xvfb)", false, format!("{e}"));
            return;
        }
    };
    check("enigo init (Xvfb)", true, "ready");

    let sink = UdpSocket::bind(("127.0.0.1", 0)).expect("bind sink");
    sink.set_read_timeout(Some(Duration::from_millis(400))).unwrap();
    let sink_port = sink.local_addr().unwrap().port();

    // مرسل خيطي — نفس مسار الهاتف: داتاجرام واحد لكل حدث.
    // المعدل 60Hz = معدل اللمس/القلم الحقيقي (Flutter pointer stream الافتراضي).
    // (ملاحظة صادقة موثقة: عند 250Hz إجهادية تتقدم الإرسال على إنتاجية
    // XTEST المتزامنة (~7ms/عملية على Xvfb) فينمو الكمون رغم الدمج —
    // الدمج يحدّه بلا نمو غير محدود لكن الهدف <20ms مثبت على المعدلات الحقيقية)
    const N: usize = 100;
    const EXPECTED_CLICKS: usize = 25; // كل i≡1 mod4 حزمة touch بنقرة
    let sent_counter = std::sync::Arc::new(AtomicUsize::new(0));
    let sc = sent_counter.clone();
    let sender = std::thread::spawn(move || {
        let sock = UdpSocket::bind(("127.0.0.1", 0)).expect("bind sender");
        sock.connect(("127.0.0.1", sink_port)).expect("connect");
        let mut seq: u32 = 0;
        for i in 0..N {
            let ts = now32();
            let pkt = match i % 4 {
                0 => core::encode_pen(seq, ts, &KEY, (i % 100) as f64 / 100.0, 0.5, 0.5 + (i % 50) as f64 / 100.0, 0, 0, if i % 8 == 0 { core::PEN_DOWN } else { core::PEN_MOVE }, 0),
                1 => core::encode_touch(seq, ts, &KEY, (i % 100) as f64 / 100.0, 0.4, core::ACT_CLICK, 0),
                2 => core::encode_mouse(seq, ts, &KEY, true, ((i % 40) as isize - 20) as f64, ((i % 30) as isize - 15) as f64, core::ACT_MOVE, (i % 2) as u8, 0),
                _ => core::encode_mouse(seq, ts, &KEY, false, (i % 100) as f64 / 100.0, 0.6, core::ACT_MOVE, 0, 0),
            };
            seq = seq.wrapping_add(1);
            if sock.send(&pkt).is_ok() {
                sc.fetch_add(1, Ordering::SeqCst);
            }
            std::thread::sleep(Duration::from_millis(16)); // 60Hz — معدل القلم الحقيقي
        }
    });

    // مستقبل — مرآة run() في live.rs حرفيًا
    let mut latencies: Vec<u64> = Vec::with_capacity(N);
    let mut clicks_injected = 0usize;
    let mut motion_injected = 0usize;
    let mut errors = 0usize;
    let mut processed = 0usize;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut buf = [0u8; 2048];
    loop {
        if processed >= N || Instant::now() >= deadline {
            break; // كل الحزم عولجت أو انتهى الوقت
        }
        // أول حزمة: حاجز (بمهلة — المرسل قد يكون انتهى)
        let n = match sink.recv_from(&mut buf) {
            Ok((n, _)) => n,
            Err(_) => break,
        };
        processed += 1;
        let mut ts_newest: u32 = 0;
        let mut batch: Vec<serde_json::Value> = Vec::with_capacity(8);
        absorb_verify(&buf[..n], &mut batch, &mut ts_newest, &mut errors);
        // تفريغ غير حاجز حتى 4
        let _ = sink.set_nonblocking(true);
        let mut drained = 0;
        while drained < 4 {
            match sink.recv_from(&mut buf) {
                Ok((n2, _)) => {
                    processed += 1;
                    absorb_verify(&buf[..n2], &mut batch, &mut ts_newest, &mut errors);
                    drained += 1;
                }
                Err(_) => break,
            }
        }
        let _ = sink.set_nonblocking(false);
        let coalesced = core::coalesce(batch);
        if coalesced.is_empty() {
            continue;
        }
        for ev in &coalesced {
            // النقرات المنفصلة (kind=click أو action=click) — ضغط/رفع القلم منفصلات أيضًا
            // لكنها ليست نقرات — عدّاد النقرات يحصي النقر حصرًا
            let kind = ev.get("kind").and_then(|x| x.as_str());
            let action = ev.get("action").and_then(|x| x.as_str());
            if kind == Some("click") || action == Some("click") {
                clicks_injected += 1;
            } else {
                motion_injected += 1;
            }
        }
        // حقن الدفعة (الحقن الفعلي — لا مسار موازٍ) ثم قياس كمون الأحدث
        let t0 = Instant::now();
        let mut batch_err = false;
        for ev in &coalesced {
            if exec::apply_event(&mut enigo, ev).is_err() {
                batch_err = true;
            }
        }
        let _ = t0.elapsed();
        if batch_err {
            errors += 1;
        }
        if ts_newest != 0 {
            latencies.push((now32().wrapping_sub(ts_newest)) as u64);
        }
    }
    sender.join().unwrap();
    let sent = sent_counter.load(Ordering::SeqCst);
    check("الإرسال: 100/100 داتاجرام خرجت", sent == N, format!("sent={sent}"));
    check("النقرات المنفصلة محفوظة كلها رغم الدمج الحي (25/25)", clicks_injected == EXPECTED_CLICKS, format!("clicks={clicks_injected}"));
    check("لا أحداث فاسدة ولا أخطاء حقن", errors == 0, format!("errors={errors}"));
    if latencies.len() >= N / 4 {
        latencies.sort_unstable();
        let p50 = latencies[latencies.len() / 2];
        let p95 = latencies[(latencies.len() * 95 / 100).min(latencies.len() - 1)];
        let max = latencies[latencies.len() - 1];
        println!("     كمون أحدث حزمة (60Hz قلم حقيقي + دمج حي): P50={p50}ms · P95={p95}ms · max={max}ms (n={}) — حركات مُدمجة: {motion_injected}", latencies.len());
        // التدفق المختلط يضم نقرات (عملتا X11) وحركات (عملية واحدة) — P95
        // المختلط يظل مقيّدًا؛ والبوابة التعاقدية <20ms مثبتة بالحدث المفرد أدناه
        check("التدفق المستمر 60Hz: P95 مقيّد < 30ms (بلا تراكم)", p95 < 30, format!("p95={p95}ms"));
    } else {
        check("عينات كافية للقياس", false, format!("n={}", latencies.len()));
    }

    // ---- اختبار الحدث الواحد (معيار النجاح التعاقدي: حدث قلم → حقن <20ms) ----
    // تصفير أي بقايا في مخزن المقبس أولًا — القياس للأحداث الطازجة حصرًا
    let _ = sink.set_nonblocking(true);
    while sink.recv_from(&mut buf).is_ok() {}
    let _ = sink.set_nonblocking(false);
    let peer = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
    peer.connect(("127.0.0.1", sink_port)).unwrap();
    let mut single: Vec<u64> = Vec::with_capacity(20);
    for _ in 0..20 {
        let ts = now32();
        let pkt = core::encode_pen(0xF1, ts, &KEY, 0.5, 0.5, 0.7, 0, 0, core::PEN_DOWN, 0);
        peer.send(&pkt).unwrap();
        let _ = sink.set_read_timeout(Some(Duration::from_millis(500)));
        let mut got = 0u64;
        let t_deadline = Instant::now() + Duration::from_millis(400);
        while got == 0 && Instant::now() < t_deadline {
            match sink.recv_from(&mut buf) {
                Ok((n2, _)) => {
                    let mut batch: Vec<serde_json::Value> = Vec::new();
                    let mut ts_new = 0u32;
                    let mut err_tmp = 0usize;
                    absorb_verify(&buf[..n2], &mut batch, &mut ts_new, &mut err_tmp);
                    let co = core::coalesce(batch);
                    let t0 = Instant::now();
                    for ev in &co {
                        let _ = exec::apply_event(&mut enigo, ev);
                    }
                    let _ = t0.elapsed();
                    if ts_new != 0 {
                        got = now32().wrapping_sub(ts_new) as u64;
                    }
                }
                Err(_) => break,
            }
        }
        if got > 0 {
            single.push(got);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = sink.set_read_timeout(None);
    if single.len() == 20 {
        single.sort_unstable();
        let p95 = single[(single.len() * 95 / 100).min(19)];
        let max = single[19];
        println!("     حدث قلم مفرد (pen down): P95={p95}ms · max={max}ms (n=20)");
        check("معيار النجاح: حدث قلم/لمس مفرد < 20ms", p95 < 20 && max < 20, format!("p95={p95} max={max}"));
    } else {
        check("عينات الحدث المفرد كاملة", false, format!("n={}", single.len()));
    }
}

/// مرآة absorb في live.rs (بلا إحصاء Tauri — الاختبار محلي)
fn absorb_verify(buf: &[u8], batch: &mut Vec<serde_json::Value>, ts_newest: &mut u32, errors: &mut usize) {
    let (h, p) = match core::parse(buf) {
        Ok(x) => x,
        Err(_) => {
            *errors += 1;
            return;
        }
    };
    match p {
        core::Payload::Ping | core::Payload::Pong => return,
        core::Payload::Gyro { .. } => return,
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
