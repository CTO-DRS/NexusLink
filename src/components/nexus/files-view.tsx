"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNexus, fmtSize, fmtDate, type SortKey } from "@/lib/store"
import { categoryIcon, categoryColor } from "./category-meta"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  LayoutGrid, List, Search, FolderPlus, ArrowUpDown, ChevronLeft, Home,
  Copy, Move, Trash2, Pencil, FileArchive, PackageOpen, Send, X, Loader2,
  ArrowDownToLine, Smartphone, Monitor, HardDrive, FolderOpen, CheckSquare,
  FileArchive as ZipIcon, Film, ExternalLink,
} from "lucide-react"
import { toast } from "sonner"
import type { FsEntry } from "@/lib/nexus/types"
import { pickSendTarget } from "@/lib/nexus/pick-target"
import { revealEntry, dragOutEntry, realPathOf, isDesktopShell } from "@/lib/desktop-files"
import { PhoneStorageModal } from "./phone-storage-modal"

const QUICK_DIRS = [
  { path: "/", label: "الذاكرة الداخلية", icon: HardDrive },
  { path: "/DCIM/Camera", label: "الكاميرا", icon: FolderOpen },
  { path: "/Download", label: "التنزيلات", icon: FolderOpen },
  { path: "/Music", label: "الموسيقى", icon: FolderOpen },
  { path: "/Movies", label: "الأفلام", icon: FolderOpen },
  { path: "/Documents", label: "المستندات", icon: FolderOpen },
  { path: "/WhatsApp/Media", label: "وسائط واتساب", icon: FolderOpen },
]

const SORT_LABEL: Record<SortKey, string> = {
  name: "الاسم", size: "الحجم", mtime: "التاريخ", category: "النوع",
}

export function FilesView() {
  const s = useNexus()
  const [renameOpen, setRenameOpen] = useState<FsEntry | null>(null)
  const [renameVal, setRenameVal] = useState("")
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirVal, setMkdirVal] = useState("")
  const [moveOpen, setMoveOpen] = useState<"copy" | "move" | null>(null)
  const [moveTarget, setMoveTarget] = useState<string>("/")
  const [moveDirs, setMoveDirs] = useState<FsEntry[]>([])
  const [busy, setBusy] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // FA-files — ذاكرة المسارات الحقيقية (أساس السحب الخارجي السريع أثناء الإيماءة)
  const realPaths = useRef<Map<string, string>>(new Map())
  const [phoneStorageOpen, setPhoneStorageOpen] = useState(false)

  const active = s.devices.find((d) => d.id === s.activeDeviceId)
  const previewableList = useMemo(() => {
    const list = s.searchResults ?? s.entries
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1
      let r = 0
      if (s.sortKey === "name") r = a.name.localeCompare(b.name, "ar")
      else if (s.sortKey === "size") r = a.size - b.size
      else if (s.sortKey === "mtime") r = a.mtime - b.mtime
      else r = a.category.localeCompare(b.category)
      return s.sortAsc ? r : -r
    })
  }, [s.searchResults, s.entries, s.sortKey, s.sortAsc])

  const load = useCallback(async () => {
    s.setLoading(true)
    try {
      const url = `/api/fs?device=${s.activeDeviceId}&path=${encodeURIComponent(s.cwd)}`
      const r = await fetch(url)
      const j = await r.json()
      s.setEntries(j.entries || [])
    } finally {
      s.setLoading(false)
    }
  }, [s.activeDeviceId, s.cwd])

  useEffect(() => { load() }, [load])

  // FA-files — جلب المسارات الحقيقية للإدخالات (خلفيًا — يخدم السحب والإفلات والإظهار)
  useEffect(() => {
    const list = s.searchResults ?? s.entries
    const files = list.filter((e) => e.type === "file").slice(0, 60)
    if (!files.length) return
    let alive = true
    void Promise.all(
      files.map(async (e) => {
        if (realPaths.current.has(e.path)) return
        const rp = await realPathOf(s.activeDeviceId, e.path)
        if (rp && alive) realPaths.current.set(e.path, rp)
      })
    )
    return () => { alive = false }
  }, [s.entries, s.searchResults, s.activeDeviceId])

  // search debounce
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = s.searchQuery.trim()
    if (!q) { s.setSearchResults(null); return }
    searchTimer.current = setTimeout(async () => {
      const r = await fetch(`/api/fs?device=${s.activeDeviceId}&q=${encodeURIComponent(q)}`)
      const j = await r.json()
      s.setSearchResults(j.entries || [])
    }, 350)
  }, [s.searchQuery, s.activeDeviceId])

  const op = async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      const r = await fetch("/api/fs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: s.activeDeviceId, ...body }),
      })
      const j = await r.json()
      if (j.ok) { toast.success(okMsg || j.message); await load() }
      else toast.error(j.message || "فشلت العملية")
    } catch { toast.error("تعذر تنفيذ العملية") }
    finally { setBusy(false) }
  }

  const sendToDevice = async (entry: FsEntry, direction: "in" | "out") => {
    const target = direction === "in"
      ? (s.devices.find((d) => d.id === "pc-office") ?? { id: "pc-office", name: "PC-OFFICE" })
      : (await pickSendTarget(s.activeDeviceId))
    if (!target) { toast.error("لا يوجد هاتف/جهاز متصل للإرسال إليه"); return }
    const res = await fetch("/api/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send-file", deviceId: target.id,
        deviceName: target.name, direction,
        srcDeviceId: s.activeDeviceId, srcPath: entry.path, fileName: entry.name,
      }),
    })
    const j = await res.json()
    if (j.ok) {
      toast.success(`بدأ النقل: ${entry.name} ← ${target.name}`, {
        action: { label: "عرض النقل", onClick: () => s.setView("transfers") },
      })
    } else toast.error(j.error || "فشل بدء النقل")
  }

  const openMoveDialog = async (mode: "copy" | "move") => {
    setMoveOpen(mode); setMoveTarget("/")
    try {
      const r = await fetch(`/api/fs?device=${s.activeDeviceId}&path=/`)
      const j = await r.json()
      setMoveDirs((j.entries || []).filter((e: FsEntry) => e.type === "dir"))
    } catch { setMoveDirs([]) }
  }

  const crumbs = s.cwd.split("/").filter(Boolean)
  const selCount = s.selection.size
  const inSearch = s.searchResults !== null

  const entryActions = (e: FsEntry) => (
    <>
      {e.type === "file" && (
        <ContextMenuItem onClick={() => s.setPreviewEntry(e)}>معاينة</ContextMenuItem>
      )}
      {e.type === "file" && (
        <ContextMenuItem onClick={() => sendToDevice(e, s.activeDeviceId === "pc-office" ? "out" : "in")}>
          إرسال إلى {s.activeDeviceId === "pc-office" ? "الهاتف" : "الكمبيوتر"}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onClick={async () => {
          const err = await revealEntry(s.activeDeviceId, e.path)
          if (err) toast.error(err)
        }}
      >
        <ExternalLink className="w-4 h-4 me-1.5" /> إظهار في المستكشف
      </ContextMenuItem>
      <ContextMenuItem onClick={() => { setRenameOpen(e); setRenameVal(e.name) }}>
        إعادة تسمية
      </ContextMenuItem>
      <ContextMenuItem onClick={() => { s.clearSelection(); s.toggleSelect(e.path); openMoveDialog("copy") }}>
        نسخ إلى…
      </ContextMenuItem>
      <ContextMenuItem onClick={() => { s.clearSelection(); s.toggleSelect(e.path); openMoveDialog("move") }}>
        نقل إلى…
      </ContextMenuItem>
      {e.type === "file" && ["zip", "apk"].includes(e.category) && (
        <ContextMenuItem onClick={() => op({ op: "extract", path: e.path }, "تم فك الضغط")}>
          <PackageOpen className="w-4 h-4 me-1.5" /> فك الضغط هنا
        </ContextMenuItem>
      )}
      <ContextMenuItem
        onClick={() => op({
          op: "zip",
          paths: selCount > 1 && s.selection.has(e.path) ? [...s.selection] : [e.path],
          zipName: `archive_${Date.now().toString(36)}.zip`,
        }, "تم إنشاء الأرشيف")}
      >
        <ZipIcon className="w-4 h-4 me-1.5" /> ضغط ZIP
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem className="text-destructive" onClick={() => op({ op: "delete", paths: [e.path] }, "تم الحذف")}>
        <Trash2 className="w-4 h-4 me-1.5" /> حذف
      </ContextMenuItem>
    </>
  )

  return (
    <div className="space-y-4">
      {/* device chips */}
      <div className="flex flex-wrap items-center gap-2">
        {s.devices.filter((d) => d.state === "connected").map((d) => {
          const Icon = d.kind === "phone" ? Smartphone : d.kind === "tablet" ? Monitor : Monitor
          const is = d.id === s.activeDeviceId
          return (
            <button
              key={d.id}
              onClick={() => s.setActiveDeviceId(d.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                is ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/25" : "bg-card hover:bg-accent"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {d.name}
            </button>
          )
        })}
        {active && (
          <Badge variant="outline" className="text-[10px] ms-auto hidden sm:flex">
            {active.ip} · {active.rttMs}ms · {active.mode === "wifi" ? "واي فاي" : active.mode}
          </Badge>
        )}
      </div>

      <div className="grid lg:grid-cols-[220px_1fr] gap-4">
        {/* sidebar quick dirs */}
        <aside className="hidden lg:flex flex-col gap-1 rounded-2xl border bg-card p-2 h-fit sticky top-20">
          <div className="text-[11px] font-semibold text-muted-foreground px-2 pt-1 pb-1.5">مواقع سريعة</div>
          {QUICK_DIRS.map((q) => {
            const is = s.cwd === q.path && !inSearch
            return (
              <button
                key={q.path}
                onClick={() => { s.setSearchQuery(""); s.setCwd(q.path) }}
                className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
                  is ? "bg-primary/12 text-primary font-semibold" : "hover:bg-accent text-foreground/85"
                }`}
              >
                <q.icon className="w-4 h-4 opacity-80" /> {q.label}
              </button>
            )
          })}
        </aside>

        <div className="space-y-3 min-w-0">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={s.searchQuery}
                onChange={(e) => s.setSearchQuery(e.target.value)}
                placeholder="بحث في كامل وحدة التخزين…"
                className="ps-9 bg-card"
              />
              {s.searchQuery && (
                <button
                  onClick={() => s.setSearchQuery("")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="مسح البحث"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ArrowUpDown className="w-4 h-4" />
                  <span className="hidden sm:inline">{SORT_LABEL[s.sortKey]}</span>
                  <span className="text-[10px] opacity-70">{s.sortAsc ? "↑" : "↓"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>ترتيب حسب</DropdownMenuLabel>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => s.setSort(k)}>
                    {SORT_LABEL[k]} {s.sortKey === k && (s.sortAsc ? "↑" : "↓")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex rounded-xl border overflow-hidden">
              <button
                onClick={() => s.setViewMode("grid")}
                className={`p-2 ${s.viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                aria-label="عرض شبكي"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => s.setViewMode("list")}
                className={`p-2 ${s.viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                aria-label="عرض قائمة"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMkdirVal(""); setMkdirOpen(true) }}>
              <FolderPlus className="w-4 h-4" />
              <span className="hidden sm:inline">مجلد جديد</span>
            </Button>

            {/* FA-files — تصفح تخزين الهاتف الحقيقي وبث الفيديو للمشغل الافتراضي */}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPhoneStorageOpen(true)}>
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">تخزين الهاتف</span>
            </Button>
          </div>

          {/* breadcrumb */}
          <div className="flex items-center gap-1 text-sm flex-wrap min-h-8">
            {inSearch && (
              <Badge className="gap-1">
                نتائج البحث: {previewableList.length} <button onClick={() => s.setSearchQuery("")}><X className="w-3 h-3" /></button>
              </Badge>
            )}
            <button
              onClick={() => s.setCwd("/")}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-accent ${s.cwd === "/" ? "font-bold text-primary" : ""}`}
            >
              <Home className="w-3.5 h-3.5" /> {active?.name || "الجهاز"}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
                <button
                  onClick={() => s.setCwd("/" + crumbs.slice(0, i + 1).join("/"))}
                  className={`rounded-lg px-2 py-1 hover:bg-accent ${i === crumbs.length - 1 ? "font-bold text-primary" : ""}`}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>

          {/* batch bar */}
          {selCount > 0 && (
            <div className="nexus-enter flex flex-wrap items-center gap-2 rounded-2xl border bg-primary/8 dark:bg-primary/15 px-3 py-2">
              <Badge className="gap-1">
                <CheckSquare className="w-3 h-3" /> {selCount} محدد
              </Badge>
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => openMoveDialog("copy")}>
                <Copy className="w-3.5 h-3.5" /> نسخ
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => openMoveDialog("move")}>
                <Move className="w-3.5 h-3.5" /> نقل
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1"
                onClick={() => op({ op: "zip", paths: [...s.selection], zipName: `archive_${Date.now().toString(36)}.zip` }, "تم الضغط")}>
                <FileArchive className="w-3.5 h-3.5" /> ضغط
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-destructive hover:text-destructive"
                onClick={() => op({ op: "delete", paths: [...s.selection] }, "تم الحذف")}>
                <Trash2 className="w-3.5 h-3.5" /> حذف
              </Button>
              <Button size="sm" variant="ghost" className="h-8 ms-auto" onClick={s.clearSelection}>إلغاء</Button>
            </div>
          )}

          {/* content */}
          <div className="rounded-2xl border bg-card p-3 min-h-[420px] relative">
            {s.loading && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-card/70 rounded-2xl">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            )}
            {!s.loading && previewableList.length === 0 && (
              <div className="py-16 text-center text-muted-foreground">
                <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
                {inSearch ? "لا نتائج مطابقة" : "المجلد فارغ"}
              </div>
            )}
            {s.viewMode === "grid" ? (
              <Grid
                items={previewableList}
                deviceId={s.activeDeviceId}
                selection={s.selection}
                onOpen={(e) => {
                  if (e.type === "dir") { s.setSearchQuery(""); s.setCwd(e.path) }
                  else s.setPreviewEntry(e)
                }}
                onToggle={(e) => s.toggleSelect(e.path)}
                actions={entryActions}
                realPaths={realPaths.current}
              />
            ) : (
              <ListView
                items={previewableList}
                selection={s.selection}
                deviceId={s.activeDeviceId}
                onOpen={(e) => {
                  if (e.type === "dir") { s.setSearchQuery(""); s.setCwd(e.path) }
                  else s.setPreviewEntry(e)
                }}
                onToggle={(e) => s.toggleSelect(e.path)}
                actions={entryActions}
                realPaths={realPaths.current}
              />
            )}
          </div>
        </div>
      </div>

      {/* FA-files — تخزين الهاتف الحقيقي + بث الفيديو */}
      <PhoneStorageModal open={phoneStorageOpen} onOpenChange={setPhoneStorageOpen} />

      {/* rename dialog */}
      <Dialog open={!!renameOpen} onOpenChange={(v) => !v && setRenameOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>إعادة تسمية</DialogTitle>
          </DialogHeader>
          <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>إلغاء</Button>
            <Button
              onClick={async () => {
                if (renameOpen && renameVal.trim()) {
                  await op({ op: "rename", path: renameOpen.path, name: renameVal.trim() }, "تمت إعادة التسمية")
                  setRenameOpen(null)
                }
              }}
            >حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* mkdir dialog */}
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>مجلد جديد</DialogTitle></DialogHeader>
          <Input value={mkdirVal} onChange={(e) => setMkdirVal(e.target.value)} placeholder="اسم المجلد" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>إلغاء</Button>
            <Button
              onClick={async () => {
                if (mkdirVal.trim()) {
                  await op({ op: "mkdir", path: s.cwd, name: mkdirVal.trim() }, "تم إنشاء المجلد")
                  setMkdirOpen(false)
                }
              }}
            >إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* copy/move dialog */}
      <Dialog open={!!moveOpen} onOpenChange={(v) => !v && setMoveOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{moveOpen === "copy" ? "نسخ" : "نقل"} {selCount} عنصر إلى…</DialogTitle>
            <DialogDescription>اختر المجلد الهدف من قائمة المجلدات الجذر.</DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto nexus-scroll space-y-1">
            <button
              onClick={() => setMoveTarget("/")}
              className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${moveTarget === "/" ? "bg-primary/12 text-primary font-semibold" : "hover:bg-accent"}`}
            >
              <HardDrive className="w-4 h-4" /> الجذر /
            </button>
            {moveDirs.map((d) => (
              <button
                key={d.path}
                onClick={() => setMoveTarget(d.path)}
                className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${moveTarget === d.path ? "bg-primary/12 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <FolderOpen className="w-4 h-4" /> {d.name}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(null)}>إلغاء</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await op({ op: moveOpen!, paths: [...s.selection], dest: moveTarget })
                setMoveOpen(null); s.clearSelection()
              }}
            >{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "تنفيذ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ---------- grid & list sub-components ---------- */

/** FA-files — معالجات السحب الخارجي (drag-out): عتبة 12px ثم استدعاء أمر الإضافة.
 * بلا Hooks (نقاط البداية على مستوى الوحدة مفتاحها مسار الملف) — يُستدعى داخل map. */
const dragStartPts = new Map<string, { x: number; y: number }>()

function dragOutHandlers(deviceId: string, e: FsEntry, realPaths: Map<string, string>) {
  if (e.type !== "file" || !isDesktopShell()) {
    return {}
  }
  return {
    onMouseDown: (ev: React.MouseEvent) => {
      if (ev.button !== 0) return
      dragStartPts.set(e.path, { x: ev.clientX, y: ev.clientY })
    },
    onMouseMove: (ev: React.MouseEvent) => {
      const st = dragStartPts.get(e.path)
      if (!st) return
      if (Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) > 12) {
        dragStartPts.delete(e.path)
        const real = realPaths.get(e.path)
        if (!real) {
          toast.error("هذا الملف ليس نسخة محلية — اسحب ملفات الكمبيوتر الحقيقية فقط")
          return
        }
        void dragOutEntry(deviceId, e.path).then((ok) => {
          if (!ok) toast.error("تعذر بدء السحب إلى سطح المكتب")
        })
      }
    },
    onMouseUp: () => { dragStartPts.delete(e.path) },
  }
}

function Grid({ items, deviceId, selection, onOpen, onToggle, actions, realPaths }: {
  items: FsEntry[]
  deviceId: string
  selection: Set<string>
  onOpen: (e: FsEntry) => void
  onToggle: (e: FsEntry) => void
  actions: (e: FsEntry) => React.ReactNode
  realPaths: Map<string, string>
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {items.map((e) => {
        const Icon = categoryIcon(e.type === "dir" ? "dir" : e.category)
        const sel = selection.has(e.path)
        const isImg = e.type === "file" && e.category === "image"
        const drag = dragOutHandlers(deviceId, e, realPaths)
        return (
          <ContextMenu key={e.path}>
            <ContextMenuTrigger asChild>
              <div
                role="button" tabIndex={0}
                onClick={() => onOpen(e)}
                onKeyDown={(ev) => ev.key === "Enter" && onOpen(e)}
                {...drag}
                className={`group relative rounded-2xl border p-2.5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  sel ? "border-primary ring-2 ring-primary/40 bg-primary/8" : "bg-background"
                }`}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); onToggle(e) }}
                  onKeyDown={(ev) => ev.key === "Enter" && onToggle(e)}
                  className="absolute top-2 end-2 z-10 opacity-0 group-hover:opacity-100 data-[on=true]:opacity-100 transition-opacity cursor-pointer"
                  data-on={sel}
                  aria-label="تحديد"
                >
                  <Checkbox checked={sel} className="bg-background" />
                </span>
                <div className="aspect-square rounded-xl overflow-hidden grid place-items-center bg-muted/60 mb-2">
                  {isImg ? (
                    <img
                      src={`/api/thumb?device=${encodeURIComponent(deviceId)}&path=${encodeURIComponent(e.path)}`}
                      alt={e.name}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none" }}
                    />
                  ) : (
                    <Icon className={`w-10 h-10 ${categoryColor(e.type === "dir" ? "dir" : e.category)}`} strokeWidth={1.6} />
                  )}
                </div>
                <div className="text-[12.5px] font-medium truncate" title={e.name}>{e.name}</div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {e.type === "dir" ? "مجلد" : fmtSize(e.size)}
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">{actions(e)}</ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}

function ListView({ items, selection, onOpen, onToggle, actions, deviceId, realPaths }: {
  items: FsEntry[]
  selection: Set<string>
  onOpen: (e: FsEntry) => void
  onToggle: (e: FsEntry) => void
  actions: (e: FsEntry) => React.ReactNode
  deviceId: string
  realPaths: Map<string, string>
}) {
  return (
    <div className="space-y-0.5">
      <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground border-b">
        <span className="flex-1">الاسم</span>
        <span className="w-20">الحجم</span>
        <span className="w-36">آخر تعديل</span>
      </div>
      {items.map((e) => {
        const Icon = categoryIcon(e.type === "dir" ? "dir" : e.category)
        const sel = selection.has(e.path)
        const drag = dragOutHandlers(deviceId, e, realPaths)
        return (
          <ContextMenu key={e.path}>
            <ContextMenuTrigger asChild>
              <div
                role="button" tabIndex={0}
                onClick={() => onOpen(e)}
                onKeyDown={(ev) => ev.key === "Enter" && onOpen(e)}
                {...drag}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                  sel ? "bg-primary/10 ring-1 ring-primary/35" : "hover:bg-accent"
                }`}
              >
                <span onClick={(ev) => { ev.stopPropagation(); onToggle(e) }} className="cursor-pointer" role="button" aria-label="تحديد">
                  <Checkbox checked={sel} />
                </span>
                <Icon className={`w-5 h-5 shrink-0 ${categoryColor(e.type === "dir" ? "dir" : e.category)}`} strokeWidth={1.8} />
                <span className="flex-1 text-[13px] font-medium truncate" title={e.name}>{e.name}</span>
                <span className="w-20 text-[11.5px] text-muted-foreground tabular-nums">
                  {e.type === "dir" ? "—" : fmtSize(e.size)}
                </span>
                <span className="hidden sm:block w-36 text-[11px] text-muted-foreground">{fmtDate(e.mtime)}</span>
                {e.type === "file" && (
                  <ArrowDownToLine
                    className="w-4 h-4 opacity-0 group-hover:opacity-60 transition-opacity"
                  />
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">{actions(e)}</ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}

export { Progress }
