"use client"
// نافذة المفكرة — هدف الكتابة من لوحة مفاتيح الهاتف ولصق الحافظة المشتركة
import { NotebookPen, ClipboardPaste, Copy, Eraser } from "lucide-react"
import { toast } from "sonner"
import { useDesktop } from "@/lib/remote-store"
import { pushDesktopClipboard } from "@/lib/remote-socket"
import { Button } from "@/components/ui/button"

export function NotepadWindow() {
  const notepad = useDesktop((s) => s.notepad)
  const clipboard = useDesktop((s) => s.clipboard)
  const pasteClipboard = useDesktop((s) => s.pasteClipboard)
  const clearNotepad = useDesktop((s) => s.clearNotepad)

  return (
    <>
      <div className="flex items-center gap-2 px-3 h-9 border-b bg-card/60 shrink-0">
        <NotebookPen className="w-3.5 h-3.5 text-sky-500" />
        <span className="text-[12px] font-semibold">المفكرة — notes.txt</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 rounded-lg text-[10px] gap-1 px-2" onClick={pasteClipboard} disabled={!clipboard}>
          <ClipboardPaste className="w-3 h-3" /> لصق الحافظة
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 rounded-lg text-[10px] gap-1 px-2"
          onClick={() => {
            if (!notepad.trim()) return
            pushDesktopClipboard(notepad)
            toast.success("تم دفع نص المفكرة إلى حافظة الهاتف")
          }}
          disabled={!notepad.trim()}
        >
          <Copy className="w-3 h-3" /> نسخ إلى الهاتف
        </Button>
        <Button variant="ghost" size="sm" className="h-6 rounded-lg text-[10px] gap-1 px-2" onClick={clearNotepad} disabled={!notepad}>
          <Eraser className="w-3 h-3" /> مسح
        </Button>
      </div>

      <div className="flex-1 p-3.5 overflow-auto nexus-scroll">
        <pre className="whitespace-pre-wrap break-words text-[13px] leading-7 font-mono min-h-full">
          {notepad}
          <span className="nexus-caret inline-block w-[2px] h-[1.1em] bg-primary align-middle ms-0.5" />
        </pre>
      </div>

      <div className="flex items-center gap-3 px-3 h-7 border-t bg-card/40 text-[9.5px] text-muted-foreground shrink-0">
        <span>{notepad.length} حرف</span>
        <span>·</span>
        <span>{notepad.split("\n").length} أسطر</span>
        <span className="flex-1" />
        <span>لوحة مفاتيح الهاتف تكتب هنا مباشرة</span>
      </div>
    </>
  )
}
