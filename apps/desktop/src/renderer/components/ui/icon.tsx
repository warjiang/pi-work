import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Copy,
  Command,
  Database,
  ExternalLink,
  File,
  Flag,
  Folder,
  FolderKanban,
  Globe2,
  Inbox,
  ListTodo,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "../../lib/utils.js";

const icons = {
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "arrow-up": ArrowUp,
  back: ChevronLeft,
  browser: Globe2,
  check: Check,
  "chevron-down": ChevronDown,
  close: X,
  command: Command,
  copy: Copy,
  external: ExternalLink,
  file: File,
  flag: Flag,
  "folder-kanban": FolderKanban,
  forward: ChevronRight,
  inbox: Inbox,
  "list-todo": ListTodo,
  more: MoreHorizontal,
  panel: PanelLeft,
  paperclip: Paperclip,
  plan: ClipboardList,
  plus: Plus,
  refresh: RefreshCw,
  rename: PencilLine,
  search: Search,
  settings: Settings,
  skills: Sparkles,
  source: Database,
  square: Square,
  "square-pen": SquarePen,
  status: Circle,
  stop: Square,
  trash: Trash2,
  workspace: Folder,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export interface IconProps extends Omit<LucideProps, "ref" | "size"> {
  name: IconName;
  size?: 14 | 16;
}

export function Icon({ name, className, size = 16, strokeWidth = 1.75, ...props }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      aria-hidden="true"
      className={cn("ui-icon", className)}
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
