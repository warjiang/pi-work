import { faSlack } from "@fortawesome/free-brands-svg-icons";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
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
  FolderCog,
  FolderPlus,
  FolderKanban,
  Globe2,
  GraduationCap,
  Inbox,
  Info,
  Keyboard,
  KeyRound,
  LayoutList,
  ListTodo,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Palette,
  Paperclip,
  PencilLine,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Tag,
  Terminal,
  Trash2,
  Puzzle,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { siFigma, siGithub, siGoogledocs, siGoogledrive, siNotion, type SimpleIcon } from "simple-icons";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils.js";

const icons = {
  appearance: Palette,
  attention: CircleAlert,
  alert: AlertCircle,
  automation: Workflow,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  back: ChevronLeft,
  browser: Globe2,
  models: Bot,
  check: Check,
  "check-circle": CheckCircle2,
  "chevron-down": ChevronDown,
  clock: Clock3,
  close: X,
  command: Command,
  copy: Copy,
  credentials: KeyRound,
  eye: Eye,
  external: ExternalLink,
  file: File,
  "file-output": FileOutput,
  flag: Flag,
  "folder-plus": FolderPlus,
  "folder-settings": FolderCog,
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
  permissions: ShieldCheck,
  plan: ClipboardList,
  play: Play,
  plus: Plus,
  radio: RadioTower,
  refresh: RefreshCw,
  rename: PencilLine,
  search: Search,
  settings: Settings,
  shortcuts: Keyboard,
  sliders: SlidersHorizontal,
  skills: GraduationCap,
  sparkles: Sparkles,
  source: Database,
  square: Square,
  "square-pen": SquarePen,
  status: Circle,
  stop: Square,
  tag: Tag,
  terminal: Terminal,
  trash: Trash2,
  extensions: Puzzle,
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

type BrandIconDefinition = {
  viewBox: string;
  paths: ReadonlyArray<{ d: string; fill: string }>;
};

function simpleBrandIcon(icon: SimpleIcon): BrandIconDefinition {
  return {
    viewBox: "0 0 24 24",
    paths: [{ d: icon.path, fill: `#${icon.hex}` }],
  };
}

const slackPath = faSlack.icon[4];
const brandIcons = {
  notion: simpleBrandIcon(siNotion),
  figma: simpleBrandIcon(siFigma),
  github: simpleBrandIcon(siGithub),
  "google-docs": simpleBrandIcon(siGoogledocs),
  google: simpleBrandIcon(siGoogledrive),
  slack: {
    viewBox: `0 0 ${faSlack.icon[0]} ${faSlack.icon[1]}`,
    paths: (Array.isArray(slackPath) ? slackPath : [slackPath]).map((d) => ({ d, fill: "#4A154B" })),
  },
} satisfies Record<string, BrandIconDefinition>;

export type BrandIconName = keyof typeof brandIcons;

export interface BrandIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  name: BrandIconName;
}

export function BrandIcon({ name, className, ...props }: BrandIconProps) {
  const icon = brandIcons[name];
  return (
    <svg aria-hidden="true" className={cn("brand-icon", className)} focusable="false" viewBox={icon.viewBox} {...props}>
      {icon.paths.map((path, index) => <path d={path.d} fill={path.fill} key={index} />)}
    </svg>
  );
}
