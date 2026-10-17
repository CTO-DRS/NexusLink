"use client"
// NexusLink — تبويب الروتينات (عقد §26) — محرّك الأتمتة فوق القنوات القائمة
// قواعد «عند حدوث X نفّذ Y»: مشغلات (أجهزة/بطارية/حافظة/وقت) → أفعال
// (إشعار/حافظة موحدة/رنين الهاتف/WoL). كل الأفعال تعبر القنوات القائمة حرفيًا.
import { useState } from "react"
import { useI18n } from "@/lib/i18n"
import { useAutomation } from "@/lib/automation-store"
import { autoRuleUpsert, autoRuleDelete, autoRuleToggle, autoRuleRunNow, autoLogClear } from "@/lib/automation-socket"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Workflow, MonitorSmartphone, MonitorOff, BatteryLow, ClipboardList, CalendarClock,
  BellRing, ClipboardPaste, PhoneCall, Power, Play, Trash2, Plus, History,
  Clock, Sparkles, ShieldAlert, Timer,
} from "lucide-react"
import type { TriggerKind, ActionKind, AutoRule } from "@/lib/nexus/automation-types"
import { toast } from "sonner"

type TFn = (s: string) => string

const TRIGGER_META: Record<TriggerKind, { icon: typeof Workflow; label: string }> = {
  "device.connect": { icon: MonitorSmartphone, label: "عند عودة جهاز للشبكة" },
  "device.disconnect": { icon: MonitorOff, label: "عند انقطاع جهاز عن الشبكة" },
  "battery.below": { icon: BatteryLow, label: "عند هبوط البطارية تحت عتبة" },
  "clip.received": { icon: ClipboardList, label: "عند وصول محتوى للحافظة الموحدة" },
  "time.once": { icon: Timer, label: "مرة واحدة عند موعد" },
  "time.daily": { icon: CalendarClock, label: "يوميًا عند ساعة محددة" },
}

const ACTION_META: Record<ActionKind, { icon: typeof Workflow; label: string }> = {
  notify: { icon: BellRing, label: "إشعار على الكمبيوتر" },
  "clipboard.push": { icon: ClipboardPaste, label: "دفع نص إلى الحافظة الموحدة" },
  "phone.ring": { icon: PhoneCall, label: "رنين الهاتف" },
  wol: { icon: Power, label: "إيقاظ جهاز على الشبكة (WoL)" },
}

function triggerSummary(r: AutoRule, tr: TFn): string {
  const t = r.trigger
  switch (t.kind) {
    case "device.connect":
    case "device.disconnect":
      return t.deviceId ? `${t.deviceId}` : tr("أي جهاز")
    case "battery.below":
      return `${t.deviceId || tr("أي جهاز")} — < ${t.threshold ?? 20}%`
    case "time.once":
      return t.at ? new Date(t.at).toLocaleString() : "—"
    case "time.daily":
      return `${String(t.hh ?? 0).padStart(2, "0")}:${String(t.mm ?? 0).padStart(2, "0")}`
    default:
      return "—"
  }
}

interface Draft {
  id?: string
  name: string
  tKind: TriggerKind
  aKind: ActionKind
  deviceId: string
  threshold: string
  onceAt: string
  hh: string
  mm: string
  text: string
  mac: string
}

const EMPTY_DRAFT: Draft = {
  name: "", tKind: "device.connect", aKind: "notify",
  deviceId: "", threshold: "20", onceAt: "", hh: "8", mm: "0",
  text: "", mac: "",
}

export function AutomationView() {
  const { t } = useI18n()
  const { online, rules, log, stats } = useAutomation()
  const [draft, setDraft] = useState<Draft | null>(null)

  const openNew = () => setDraft({ ...EMPTY_DRAFT })
  const openEdit = (r: AutoRule) => setDraft({
    id: r.id,
    name: r.name,
    tKind: r.trigger.kind,
    aKind: r.action.kind,
    deviceId: r.trigger.deviceId || "",
    threshold: String(r.trigger.threshold ?? 20),
    onceAt: r.trigger.at ? new Date(r.trigger.at - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
    hh: String(r.trigger.hh ?? 8),
    mm: String(r.trigger.mm ?? 0),
    text: r.action.text || "",
    mac: r.action.mac || "",
  })

  const save = () => {
    if (!draft) return
    const trig: AutoRule["trigger"] = { kind: draft.tKind }
    if (draft.deviceId.trim()) trig.deviceId = draft.deviceId.trim()
    if (draft.tKind === "battery.below") trig.threshold = Math.min(100, Math.max(1, Math.round(Number(draft.threshold) || 20)))
    if (draft.tKind === "time.once") {
      const at = draft.onceAt ? new Date(draft.onceAt).getTime() : 0
      if (!at) { toast.error(t("حدد موعدًا صالحًا")); return }
      trig.at = at
    }
    if (draft.tKind === "time.daily") {
      trig.hh = Math.min(23, Math.max(0, Math.round(Number(draft.hh) || 0)))
      trig.mm = Math.min(59, Math.max(0, Math.round(Number(draft.mm) || 0)))
    }
    const act: AutoRule["action"] = { kind: draft.aKind }
    if (draft.text.trim()) act.text = draft.text.trim()
    if (draft.aKind === "wol") act.mac = draft.mac.trim()
    autoRuleUpsert({ id: draft.id, name: draft.name, enabled: true, trigger: trig, action: act })
    setDraft(null)
  }

  return (
    <div className="space-y-4 pb-24" data-testid="automation-view">
      {/* الرأس */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-500">
            <Workflow className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold leading-tight">{t("الروتينات")}</h2>
            <p className="text-xs text-muted-foreground">{t("محرّك الأتمتة — عند حدوث X نفّذ Y فوق القنوات القائمة")}</p>
          </div>
        </div>
        <Badge variant={online ? "default" : "secondary"} className="gap-1.5" data-testid="automation-bridge-status">
          <span className={`size-1.5 rounded-full ${online ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
          {online ? t("المحرك متصل") : t("المحرك غير متصل")}
        </Badge>
      </div>

      {/* الإحصاءات */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold" data-testid="automation-stats-enabled">{stats.rulesEnabled}<span className="text-sm text-muted-foreground">/{stats.rulesTotal}</span></div>
            <div className="text-[11px] text-muted-foreground">{t("قواعد مفعّلة")}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold" data-testid="automation-stats-fires">{stats.firesToday}</div>
            <div className="text-[11px] text-muted-foreground">{t("تشغيلات ناجحة اليوم")}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-xl font-bold flex items-center justify-center gap-1" data-testid="automation-stats-last">
              <Clock className="size-4 text-muted-foreground" />
              {stats.lastFiredAt ? new Date(stats.lastFiredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">{t("آخر تشغيل")}</div>
          </CardContent></Card>
        </div>
      )}

      {/* القواعد */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="size-4 text-violet-500" />{t("القواعد")}</h3>
        <Button size="sm" onClick={openNew} data-testid="automation-new-rule"><Plus className="size-4" />{t("قاعدة جديدة")}</Button>
      </div>

      {rules.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{t("لا قواعد بعد — أنشئ أول روتين")}</CardContent></Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2" data-testid="automation-rules">
          {rules.map((r) => {
            const TIcon = TRIGGER_META[r.trigger.kind]?.icon ?? Workflow
            const AIcon = ACTION_META[r.action.kind]?.icon ?? BellRing
            return (
              <Card key={r.id} className={!r.enabled ? "opacity-60" : ""} data-testid="automation-rule-card">
                <CardContent className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate" data-testid="automation-rule-name">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.fireCount > 0 ? `${r.fireCount} ${t("تشغيل")} · ${r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleString() : ""}` : t("لم تُطلق بعد")}
                      </div>
                    </div>
                    <Switch checked={r.enabled} onCheckedChange={(v) => autoRuleToggle(r.id, v)} aria-label={t("تفعيل القاعدة")} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <Badge variant="outline" className="gap-1 font-normal"><TIcon className="size-3 text-violet-500" />{t(TRIGGER_META[r.trigger.kind]?.label ?? r.trigger.kind)}: <span className="font-medium">{triggerSummary(r, t)}</span></Badge>
                    <Badge variant="outline" className="gap-1 font-normal"><AIcon className="size-3 text-emerald-500" />{t(ACTION_META[r.action.kind]?.label ?? r.action.kind)}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Button size="sm" variant="secondary" className="h-7 gap-1 text-xs" onClick={() => autoRuleRunNow(r.id)} data-testid="automation-run-now"><Play className="size-3" />{t("شغّل الآن")}</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => openEdit(r)}>{t("تعديل")}</Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-red-500 hover:text-red-500" onClick={() => autoRuleDelete(r.id)} data-testid="automation-rule-delete"><Trash2 className="size-3" />{t("حذف")}</Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* سجل التشغيل */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><History className="size-4 text-muted-foreground" />{t("سجل التشغيل")}</h3>
        {log.length > 0 && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={autoLogClear}>{t("تفريغ السجل")}</Button>}
      </div>
      {log.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("لا تشغيلات بعد")}</CardContent></Card>
      ) : (
        <div className="space-y-1.5" data-testid="automation-log">
          {log.slice(0, 12).map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
              <span className={`size-1.5 shrink-0 rounded-full ${e.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="font-medium shrink-0">{e.ruleName}</span>
              <span className="text-muted-foreground truncate flex-1">{e.detail}</span>
              {e.manual && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{t("يدوي")}</Badge>}
              <span className="text-muted-foreground shrink-0 tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
          ))}
        </div>
      )}

      {/* حدود صادقة */}
      <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="p-3.5 text-xs text-muted-foreground space-y-1">
        <div className="font-semibold flex items-center gap-1.5 text-amber-600"><ShieldAlert className="size-3.5" />{t("حدود الإصدار الأول")}</div>
        <p>• {t("القواعد والسجل في ذاكرة الجسر — تُستبدل بالقواعد البذرية عند إعادة تشغيل الخادم")}</p>
        <p>• {t("أفعال الهاتف تعبر قناة الحماية القائمة وتتطلب وكيل هاتف متصلًا")}</p>
        <p>• {t("إيقاظ WoL يعمل داخل الشبكة المحلية فقط (بث UDP :9)")}</p>
        <p>• {t("مشغلات الأجهزة تقرأ سجل الأجهزة (الاقتران/القطع) لا نبض الوكيل الحي")}</p>
      </CardContent></Card>

      {/* محرر القاعدة */}
      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-md" data-testid="automation-editor">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("تعديل القاعدة") : t("قاعدة جديدة")}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="auto-name">{t("اسم القاعدة")}</Label>
                <Input id="auto-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("مثال: نبّهني عند انخفاض البطارية")} data-testid="automation-name-input" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("المشغّل")}</Label>
                <Select value={draft.tKind} onValueChange={(v) => setDraft({ ...draft, tKind: v as TriggerKind })}>
                  <SelectTrigger data-testid="automation-trigger-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRIGGER_META).map(([k, m]) => (
                      <SelectItem key={k} value={k}>{t(m.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(draft.tKind === "device.connect" || draft.tKind === "device.disconnect" || draft.tKind === "battery.below") && (
                  <Input value={draft.deviceId} onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })} placeholder={t("معرّف الجهاز (اختياري — فارغ = أي جهاز)")} />
                )}
                {draft.tKind === "battery.below" && (
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-xs">{t("العتبة %")}</Label>
                    <Input type="number" min={1} max={100} value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} data-testid="automation-threshold-input" />
                  </div>
                )}
                {draft.tKind === "time.once" && (
                  <Input type="datetime-local" value={draft.onceAt} onChange={(e) => setDraft({ ...draft, onceAt: e.target.value })} data-testid="automation-once-input" />
                )}
                {draft.tKind === "time.daily" && (
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={23} value={draft.hh} onChange={(e) => setDraft({ ...draft, hh: e.target.value })} aria-label={t("الساعة")} />
                    <span className="text-muted-foreground">:</span>
                    <Input type="number" min={0} max={59} value={draft.mm} onChange={(e) => setDraft({ ...draft, mm: e.target.value })} aria-label={t("الدقيقة")} />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("الفعل")}</Label>
                <Select value={draft.aKind} onValueChange={(v) => setDraft({ ...draft, aKind: v as ActionKind })}>
                  <SelectTrigger data-testid="automation-action-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTION_META).map(([k, m]) => (
                      <SelectItem key={k} value={k}>{t(m.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(draft.aKind === "notify" || draft.aKind === "clipboard.push") && (
                  <Input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder={draft.aKind === "notify" ? t("نص الإشعار (اختياري)") : t("النص المطلوب دفعه للحافظة")} data-testid="automation-text-input" />
                )}
                {draft.aKind === "wol" && (
                  <Input value={draft.mac} onChange={(e) => setDraft({ ...draft, mac: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" dir="ltr" data-testid="automation-mac-input" />
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>{t("إلغاء")}</Button>
            <Button onClick={save} disabled={!draft?.name.trim()} data-testid="automation-save">{draft?.id ? t("حفظ التعديلات") : t("إنشاء القاعدة")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
