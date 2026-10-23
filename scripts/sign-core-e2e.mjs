#!/usr/bin/env node
// NexusLink — E2E عقد §43: النوى النائمة للتوقيع والثقة (X1 Windows codesign · X2 macOS notarize)
// ============================================================
// المرحلة أ (بنية سير الإصدار): YAML سليم + الخطوات الثلاث المحارسة بأسرار
//   + عقل الإعدادات في سكربت مستقل + لا أسرار مكشوفة على مستوى الوظيفة.
// المرحلة ب (عقل الإعدادات حيًا ×4): غياب التوقيع يُطابق السلوك التاريخي
//   حرفيًا (سلسلتا UPDATER_SIGN) · البصمة تضيف كتلة windows كاملة ·
//   النفاية تُرفض فشل-مغلق (REFUSING — نمط §41).
// المرحلة ج (انحدار عقود الإصدار): سلاسل §23 التي يجرّها المقيّس الكامل
//   سليمة حرفيًا (الإضافة قابلة للجمع لا قابلة للكسر).
// المرحلة د (حدود صادقة): التوثيق موجود — §13 من دليل النشر وعقد §43.
import { spawnSync } from "node:child_process"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname
let passed = 0
let failed = 0
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`) }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const relPath = join(ROOT, ".github/workflows/release.yml")
const relRaw = readFileSync(relPath, "utf8")

// ============ المرحلة أ — بنية سير الإصدار ============
console.log("== [أ] بنية release.yml ==")
const py = spawnSync("python3", ["-c", `import yaml,json;d=yaml.safe_load(open(${JSON.stringify(relPath)}));print(json.dumps(d))`], { encoding: "utf8" })
ok("release.yml يُحلَّل YAML سليمًا (فشل-مغلق: بلا محلل = فشل صريح)", py.status === 0, py.status === 0 ? "safe_load OK" : py.stderr.slice(0, 120))
const wf = py.status === 0 ? JSON.parse(py.stdout) : null
const steps = wf?.jobs?.desktop?.steps ?? []
ok("وظيفة desktop تحمل خطواتها التاريخية + الأربع الجديدة (≥21)", steps.length >= 21, `steps=${steps.length}`)

const findStep = (needle) => steps.find((s) => String(s.get ? "" : s.name || "").includes(needle))
const winImport = findStep("Import Windows codesign certificate")
const macDetect = findStep("Detect Apple signing/notarization secrets")
const winVerify = findStep("Verify Authenticode signatures")
const buildStep = steps.find((s) => String(s.name || "").startsWith("Build Tauri bundles"))

ok("X1: خطوة استيراد شهادة Windows موجودة ومحارسة (if: windows)", !!winImport && String(winImport.if).includes("matrix.os-name == 'windows'"), winImport?.if)
ok("X1: الأسرار عبر خطوة env حصرًا (بلا كشف على مستوى الوظيفة)", !!winImport && winImport.env?.WINDOWS_PFX_BASE64 === "${{ secrets.WINDOWS_PFX_BASE64 }}" && winImport.env?.WINDOWS_PFX_PASSWORD === "${{ secrets.WINDOWS_PFX_PASSWORD }}")
ok("X1: خطوة عبور صادقة بغياب السر (IsNullOrEmpty → exit 0)", !!winImport && winImport.run.includes("IsNullOrEmpty") && winImport.run.includes("exit 0"))
ok("X1: بالسر = استيراد PFX قابل للتصدير + بصمة إلى GITHUB_ENV", !!winImport && winImport.run.includes("Import-PfxCertificate") && winImport.run.includes("-Exportable") && winImport.run.includes("WIN_THUMBPRINT=") && winImport.run.includes("GITHUB_ENV"))

ok("X2: خطوة استكشاف أسرار Apple موجودة ومحارسة (if: macos)", !!macDetect && String(macDetect.if).includes("matrix.os-name == 'macos'"), macDetect?.if)
const appleKeys = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]
ok("X2: الأسرار الستة كلها موصولة (لا قيم فارغة تُمرر — GITHUB_ENV عند الوجود حصرًا)",
  !!macDetect && appleKeys.every((k) => macDetect.env?.[`${k}_S`] === `\${{ secrets.${k} }}`) && macDetect.run.includes('>> "$GITHUB_ENV"'))
ok("X2: بوابتان مستقلتان صادقتان (توقيع ≠ notarization)", !!macDetect && macDetect.run.includes("MACOS_SIGN=") && macDetect.run.includes("MACOS_NOTARIZE="))

ok("البناء يستدعي عقل الإعدادات المُختبر (signing-config.sh)", !!buildStep && buildStep.run.includes("bash signing-config.sh"))
ok("لا منطق CONFIG داخلي قديم في خطوة البناء", !!buildStep && !buildStep.run.includes("createUpdaterArtifacts\":false}}'"))
ok("خطوة تحقق Authenticode محارسة بعلم WINDOWS_SIGNED (لا تعمل بغياب التوقيع)",
  !!winVerify && String(winVerify.if).includes("env.WINDOWS_SIGNED == 'true'") && winVerify.run.includes("Get-AuthenticodeSignature"))
ok("نظافة الأسرار: بلا سر واحد في env الوظيفة أو سير العمل (التوثيق بالمرجع {{ secrets }} حصرًا)",
  JSON.stringify(wf.env || {}).includes("secrets") === false
  && !Object.keys(wf.jobs.desktop.env ?? {}).length)

// ============ المرحلة ب — عقل الإعدادات حيًا (الأوضاع الأربعة) ============
console.log("== [ب] signing-config.sh حيًا ×4 ==")
const HIST_TRUE = '{"bundle":{"externalBin":["binaries/node"]}}'
const HIST_FALSE = '{"bundle":{"externalBin":["binaries/node"],"createUpdaterArtifacts":false}}'
const THUMB = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
const runCfg = (env) => {
  const r = spawnSync("bash", [join(ROOT, "apps/desktop/signing-config.sh")], { env: { ...process.env, ...env }, encoding: "utf8" })
  return { out: r.stdout.trim(), code: r.status }
}
const m1 = runCfg({ UPDATER_SIGN: "true" })
ok("وضع 1 — بلا توقيع + updater مفتاح: مطابق تاريخيًا حرفيًا", m1.out === HIST_TRUE && m1.code === 0, m1.out)
const m2 = runCfg({ UPDATER_SIGN: "false" })
ok("وضع 2 — بلا توقيع + بلا updater: مطابق تاريخيًا حرفيًا", m2.out === HIST_FALSE && m2.code === 0, m2.out)
const m3 = runCfg({ UPDATER_SIGN: "true", WIN_THUMBPRINT: THUMB })
let m3json = null
try { m3json = JSON.parse(m3.out) } catch {}
ok("وضع 3 — بتوقيع: JSON سليم + كتلة windows كاملة (بصمة + sha256 + طابع زمني)",
  m3.code === 0 && !!m3json && m3json.bundle.windows?.certificateThumbprint === THUMB
  && m3json.bundle.windows?.digestAlgorithm === "sha256"
  && m3json.bundle.windows?.timestampUrl === "http://timestamp.digicert.com"
  && m3json.bundle.externalBin?.[0] === "binaries/node", m3.out.slice(0, 90))
const m4 = runCfg({ UPDATER_SIGN: "false", WIN_THUMBPRINT: "zzz-garbage" })
ok("وضع 4 — نفاية في البصمة: فشل-مغلق مبكر (exit 2 + REFUSING)", m4.code === 2 && !m4.out, `exit=${m4.code}`)
const m5 = runCfg({ UPDATER_SIGN: "false", WIN_THUMBPRINT: THUMB })
let m5json = null
try { m5json = JSON.parse(m5.out) } catch {}
ok("وضع 5 — توقيع + بلا updater: الكتلتان مستقلتان (windows + createUpdaterArtifacts:false)",
  m5.code === 0 && !!m5json && m5json.bundle.windows?.certificateThumbprint === THUMB && m5json.bundle.createUpdaterArtifacts === false)

// ============ المرحلة ج — انحدار عقود الإصدار (سلاسل المقيّس الكامل) ============
console.log("== [ج] انحدار §23/§42 ==")
const mustKeep = [
  ['VERSION: "3.0.0"', "env.VERSION موحد"],
  ['default: "v3.0.0"', "وسم الإرفاق اليدوي"],
  ["Verify release notes exist (AR/EN)", "حارس ملاحظات الإصدار"],
  ["body_path: docs/releases/${{ github.ref_name }}.md", "body_path على الوسم"],
  ['"windows-x86_64"', "منصة ويندوز latest.json"],
  ['"linux-x86_64"', "منصة لينكس latest.json"],
  ['"darwin-aarch64"', "منصة ماك latest.json"],
  [".app.tar.gz.sig", "أصل updater موقّع"],
  ["SHA256SUMS", "بصمات الأصول"],
  ["draft: true", "مسودة قبل التثبيت"],
]
for (const [needle, label] of mustKeep) ok(`سلسلة محفوظة: ${label}`, relRaw.includes(needle))
ok("عقد §42 سليم: فلتر لا-ملاحظات-فارغة في route.ts", readFileSync(join(ROOT, "src/app/api/version/route.ts"), "utf8").includes("h.items.length > 0"))

// ============ المرحلة د — الحدود الصادقة الموثقة ============
console.log("== [د] التوثيق ==")
const deploy = readFileSync(join(ROOT, "docs/enterprise-deploy.md"), "utf8")
ok("دليل النشر يوثق §13 سلسلة الثقة (الأسرار + التفعيل + التحقق اليدوي)",
  deploy.includes("13") && deploy.includes("WINDOWS_PFX_BASE64") && deploy.includes("APPLE_CERTIFICATE")
  && deploy.includes("Get-AuthenticodeSignature") && deploy.includes("spctl --assess"))
const contract = readFileSync(join(ROOT, "docs/protocol-contract.md"), "utf8")
ok("عقد §43 موجود بحدوده الصادقة (نواة محلية · لا تفعيل بلا شهادة · desktop.yml فحصي)",
  contract.includes("43.إكمال سلسلة الثقة") || contract.includes("### 43.")
  ? contract.includes("desktop.yml") && contract.includes("نواة")
  : false, "contract §43")

console.log(`\n===== SIGN-CORE E2E: ${passed}/${passed + failed} passed =====`)
process.exit(failed ? 1 : 0)
