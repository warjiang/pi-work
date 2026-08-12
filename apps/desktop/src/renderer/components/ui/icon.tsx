import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ClipboardList,
  Copy,
  Command,
  Database,
  Eye,
  ExternalLink,
  File,
  FileOutput,
  Flag,
  Folder,
  FolderPlus,
  FolderKanban,
  Globe2,
  Inbox,
  Info,
  LayoutList,
  ListTodo,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Paperclip,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Tag,
  Terminal,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "../../lib/utils.js";

const icons = {
  alert: AlertCircle,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  back: ChevronLeft,
  browser: Globe2,
  check: Check,
  "check-circle": CheckCircle2,
  "chevron-down": ChevronDown,
  clock: Clock3,
  close: X,
  command: Command,
  copy: Copy,
  eye: Eye,
  external: ExternalLink,
  file: File,
  "file-output": FileOutput,
  flag: Flag,
  "folder-plus": FolderPlus,
  "folder-kanban": FolderKanban,
  forward: ChevronRight,
  inbox: Inbox,
  info: Info,
  list: LayoutList,
  "list-todo": ListTodo,
  lock: LockKeyhole,
  menu: Menu,
  more: MoreHorizontal,
  panel: PanelLeft,
  "panel-right": PanelRight,
  paperclip: Paperclip,
  plan: ClipboardList,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  rename: PencilLine,
  search: Search,
  settings: Settings,
  sliders: SlidersHorizontal,
  skills: Sparkles,
  source: Database,
  square: Square,
  "square-pen": SquarePen,
  status: Circle,
  stop: Square,
  tag: Tag,
  terminal: Terminal,
  trash: Trash2,
  wand: WandSparkles,
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
