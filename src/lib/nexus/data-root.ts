import path from "node:path"

// G-30 (الجولة 3 — عقد §17): جذر بيانات قابل للكتابة.
// التثبيت per-machine (MSI) يضع الحزمة في Program Files — غير قابل للكتابة —
// بينما كل مسارات البيانات (nexus-storage/desktop-ui.json) كانت نسبيّة لـ cwd
// (جذر الحزمة). procman يمرر NEXUS_DATA_ROOT إلى عمليات node الثلاث
// (app_config_dir/nexus-data) — وفي التطوير بلا env: cwd/data كما كان.
export function nexusDataRoot(): string {
  return process.env.NEXUS_DATA_ROOT || path.join(process.cwd(), "data")
}

/** جذر التخزين المشترك (نفس بنية «data/nexus-storage» التاريخية) */
export function nexusStorageRoot(): string {
  return path.join(nexusDataRoot(), "nexus-storage")
}
