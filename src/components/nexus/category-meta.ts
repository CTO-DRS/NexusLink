import type { FsCategory } from "@/lib/nexus/types"
import {
  FileImage, FileVideo, FileAudio, FileText, File as FileIco,
  FileArchive, Package, FileQuestion, Folder,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export const categoryIcon = (c: FsCategory | "dir"): LucideIcon => {
  switch (c) {
    case "dir": return Folder
    case "image": return FileImage
    case "video": return FileVideo
    case "audio": return FileAudio
    case "pdf": return FileText
    case "text": return FileText
    case "apk": return Package
    case "zip": return FileArchive
    default: return FileQuestion
  }
}

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  dir: Folder,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileText,
  apk: Package,
  zip: FileArchive,
  other: FileQuestion,
}

export const categoryColor = (c: FsCategory | "dir"): string => {
  switch (c) {
    case "dir": return "text-amber-500 fill-amber-500/20"
    case "image": return "text-emerald-500"
    case "video": return "text-rose-500"
    case "audio": return "text-violet-500"
    case "pdf": return "text-red-500"
    case "text": return "text-sky-600"
    case "apk": return "text-lime-600"
    case "zip": return "text-orange-500"
    default: return "text-muted-foreground"
  }
}
