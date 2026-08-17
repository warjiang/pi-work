import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type {
  Activity,
  AppSettings,
  Artifact,
  Attachment as StoredAttachment,
  AttachmentDraft,
  ChatMessage,
  ConductorNodeAttemptDetail,
  ConductorNodeState,
  ConductorRun,
  ConductorSpec,
  Label,
  ModelCatalog,
  ModelOption,
  PermissionMode,
  PlanApprovalAction,
  PlanClarificationOption,
  PlanExecutionDetail,
  PlanExecutionMode,
  PlanRevision,
  PlanRevisionDiff,
  PlanRevisionEditInput,
  PlanRevisionEditStep,
  Session,
  StatusDefinition,
  TaskExecutionMode,
  ThinkingLevel,
  ToolApproval,
  Workspace,
} from "@pi-work/protocol";
import { conductorSpecSchema, planRevisionMarkdown } from "@pi-work/protocol";
export { planRevisionMarkdown } from "@pi-work/protocol";
import {
  ComposerEditor,
  type ComposerSlashCommand,
} from "@/components/composer-editor.js";
import { MarkdownMessage } from "@/components/markdown-message.js";
import { knownPlatformLinks, platformLinkSegments, PlatformLinkCard } from "@/components/platform-link.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import { thinkingLevelLabel } from "@/i18n.js";
import type { MessageKey } from "@/i18n.js";
import type { ContextPanel, TaskMode } from "@/store.js";
import { ConductorFlow } from "./conductor-flow.js";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type T = (key: MessageKey) => string;
type LiveThought = { segmentId: number; contentIndex: number; content: string; complete: boolean };
type LiveTool = {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  detail: string;
  output: unknown;
  complete: boolean;
  failed: boolean;
};
type LiveProcessItem =
  | { kind: "thinking"; segmentId: number }
  | { kind: "tool"; toolCallId: string };
type LiveProcess = {
  thoughts: LiveThought[];
  tools: LiveTool[];
  timeline: LiveProcessItem[];
  notice: string | null;
};
type ConversationTurn = {
  messageId: string;
  targetId: string;
  question: string;
  answer: string | null;
};
type SelectedConductorNode = {
  runId: string;
  nodeId: string;
  title: string;
  maxAttempts: number;
};

export const defaultInspectorWidth = 380;
export const minimumInspectorWidth = 320;
export const maximumInspectorWidth = 520;
export const inspectorWidthStorageKey = "pi-work:task-inspector-width";
export const defaultPlanInspectorWidth = 680;
export const minimumPlanInspectorWidth = 420;
export const maximumPlanInspectorWidth = 820;
export const planInspectorWidthStorageKey = "pi-work:plan-inspector-width";

export function clampInspectorWidth(value: number): number {
  if (!Number.isFinite(value)) return defaultInspectorWidth;
  return Math.min(maximumInspectorWidth, Math.max(minimumInspectorWidth, Math.round(value)));
}

export function parseInspectorWidth(value: string | null): number {
  if (value === null || value.trim() === "") return defaultInspectorWidth;
  return clampInspectorWidth(Number(value));
}

export function clampPlanInspectorWidth(value: number): number {
  if (!Number.isFinite(value)) return defaultPlanInspectorWidth;
  return Math.min(maximumPlanInspectorWidth, Math.max(minimumPlanInspectorWidth, Math.round(value)));
}

export function parsePlanInspectorWidth(value: string | null): number {
  if (value === null || value.trim() === "") return defaultPlanInspectorWidth;
  return clampPlanInspectorWidth(Number(value));
}

function formatBytes(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function mergeAttachments(current: AttachmentDraft[], selected: AttachmentDraft[]): AttachmentDraft[] {
  return [...new Map([...current, ...selected].map((attachment) => [attachment.path, attachment])).values()].slice(0, 20);
}

export function restoreFailedComposerInput(current: string, submitted: string): string {
  return current === "" ? submitted : current;
}

function selectedModel(models: ModelOption[], providerId: string, modelId: string): ModelOption | undefined {
  return models.find((model) => model.providerId === providerId && model.modelId === modelId);
}

function attachmentDescription(attachment: AttachmentDraft): string {
  const subtype = attachment.mimeType.split("/").at(-1)?.split("+").at(0)?.toLocaleUpperCase() ?? "FILE";
  return `${subtype} · ${formatBytes(attachment.size)}`;
}

export function visibleMessageContent(content: string): string {
  return content
    .replace(/^Plan (?:ready|updated) for review:\s*[\s\S]*$/i, "")
    .replace(
      /(^|\n)Attached files:\s*\n(?:[ \t]*[-*]\s+\/[^\n]*(?:\n|$))+/gi,
      (_manifest, prefix: string) => (prefix === "\n" ? "\n" : ""),
    )
    .replace(/^\n+/, "");
}

function ComposerAttachment(props: {
  attachment: AttachmentDraft;
  removeLabel: string;
  onRemove(): void;
  onPreview(): void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const previewable = props.attachment.mimeType.startsWith("image/");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewable || typeof window.piWork.attachment.previewDraft !== "function") return;
    let active = true;
    void window.piWork.attachment.previewDraft(props.attachment)
      .then((url) => {
        if (active) setImageUrl(url);
      })
      .catch(() => {
        if (active) setThumbnailFailed(true);
      });
    return () => {
      active = false;
    };
  }, [previewable, props.attachment]);
  const content = <>
    <AttachmentMedia>
      {imageUrl !== null && !thumbnailFailed ? (
        <img
          src={imageUrl}
          alt={props.attachment.name}
          onError={() => setThumbnailFailed(true)}
        />
      ) : (
        <Icon name="file" />
      )}
    </AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle>{props.attachment.name}</AttachmentTitle>
      <AttachmentDescription>{attachmentDescription(props.attachment)}</AttachmentDescription>
    </AttachmentContent>
  </>;
  return (
    <Attachment size="sm" className="composer-attachment">
      {previewable ? (
        <button type="button" className="composer-attachment-preview" aria-label={`Preview ${props.attachment.name}`} onClick={props.onPreview}>
          {content}
        </button>
      ) : content}
      <AttachmentActions>
        <AttachmentAction type="button" aria-label={props.removeLabel} onClick={props.onRemove}>
          <Icon name="close" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

function ComposerPermissionMenu(props: {
  permissionMode: PermissionMode;
  disabled: boolean;
  t: T;
  onPermissionChange(mode: PermissionMode): void;
}) {
  const permission = permissionLabel(props.permissionMode, props.t);
  const permissionIcon = permissionModeIcon(props.permissionMode);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className={`composer-permission-trigger is-${props.permissionMode}`}
          aria-label={`${props.t("confirmation")}: ${permission}`}
          disabled={props.disabled}
        >
          <Icon name={permissionIcon} />
          <span>{permission}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="composer-permission-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="composer-permission-label">{props.t("confirmation")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={props.permissionMode} onValueChange={(value) => props.onPermissionChange(value as PermissionMode)}>
            <PermissionModeOption
              mode="ask"
              icon="lock"
              title={props.t("askEveryTime")}
              detail={props.t("askEveryTimeDetail")}
            />
            <PermissionModeOption
              mode="explore"
              icon="eye"
              title={props.t("exploreOnly")}
              detail={props.t("exploreOnlyDetail")}
            />
            <PermissionModeOption
              mode="auto"
              icon="terminal"
              title={props.t("automatic")}
              detail={props.t("automaticDetail")}
            />
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComposerTaskModeMenu(props: {
  mode: Exclude<TaskExecutionMode, "direct">;
  disabled: boolean;
  t: T;
  onChange(mode: Exclude<TaskExecutionMode, "direct">): void;
}) {
  const orchestration = props.mode === "orchestration";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="composer-task-mode-trigger"
          aria-label={`${props.t("executionMode")}: ${orchestration ? props.t("orchestration") : props.t("plan")}`}
          disabled={props.disabled}
        >
          <Icon name={orchestration ? "workflow" : "plan"} />
          <span>{orchestration ? props.t("orchestration") : props.t("plan")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="composer-task-mode-menu">
        <DropdownMenuLabel>{props.t("executionMode")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={props.mode} onValueChange={(value) => props.onChange(value as Exclude<TaskExecutionMode, "direct">)}>
          <DropdownMenuRadioItem value="plan" className="composer-task-mode-option">
            <span className="composer-task-mode-icon"><Icon name="plan" /></span>
            <span><strong>{props.t("plan")}</strong><small>{props.t("planModeDetail")}</small></span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="orchestration" className="composer-task-mode-option">
            <span className="composer-task-mode-icon"><Icon name="workflow" /></span>
            <span><strong>{props.t("orchestration")}</strong><small>{props.t("orchestrationModeDetail")}</small></span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskStartMode(props: {
  mode: Exclude<TaskExecutionMode, "direct">;
  disabled: boolean;
  t: T;
  onChange(mode: Exclude<TaskExecutionMode, "direct">): void;
}) {
  return (
    <section className="task-start-mode" aria-labelledby="task-start-title">
      <div className="task-start-copy">
        <span>{props.t("newTask")}</span>
        <h2 id="task-start-title">{props.t("chooseExecutionMode")}</h2>
        <p>{props.t("chooseExecutionModeDetail")}</p>
      </div>
      <div className="task-start-options" role="radiogroup" aria-label={props.t("executionMode")}>
        {([
          ["plan", "plan", props.t("plan"), props.t("planModeDetail")],
          ["orchestration", "workflow", props.t("orchestration"), props.t("orchestrationModeDetail")],
        ] as const).map(([mode, icon, title, detail]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={props.mode === mode}
            className={`task-start-option${props.mode === mode ? " is-selected" : ""}`}
            disabled={props.disabled}
            onClick={() => props.onChange(mode)}
          >
            <span className="task-start-option-icon"><Icon name={icon} /></span>
            <span><strong>{title}</strong><small>{detail}</small></span>
            <span className="task-start-option-check" aria-hidden="true"><Icon name="check" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PermissionModeOption(props: {
  mode: PermissionMode;
  icon: "eye" | "lock" | "terminal";
  title: string;
  detail: string;
}) {
  return (
    <DropdownMenuRadioItem value={props.mode} className={`composer-permission-option is-${props.mode}`}>
      <span className="composer-permission-option-icon"><Icon name={props.icon} /></span>
      <span className="composer-permission-option-copy">
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </span>
    </DropdownMenuRadioItem>
  );
}

function ComposerModelMenu(props: {
  models: ModelOption[];
  activeModel: ModelOption | undefined;
  activeModelKey: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  disabled: boolean;
  t: T;
  onModelChange(value: string): void;
  onThinkingChange(value: string): void;
}) {
  const thinking = thinkingLevelLabel(props.thinkingLevel, props.t);
  const activeModelLabel = props.activeModel
    ? `${props.activeModel.providerName}/${props.activeModel.modelName}`
    : props.t("noModel");
  const activeModelSummary = activeModelLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="composer-model-trigger"
          aria-label={`${props.t("model")}: ${activeModelSummary}; ${props.t("thinking")}: ${thinking}`}
          disabled={props.disabled}
        >
          <span className="composer-model-summary">
            <span title={activeModelSummary}>{activeModelSummary}</span>
            <span>{thinking}</span>
          </span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="composer-execution-menu">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="composer-execution-subtrigger">
              <span>{props.t("model")}</span>
              <span className="composer-menu-value" title={activeModelSummary}>
                {activeModelSummary}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="composer-choice-submenu composer-model-submenu">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="composer-choice-label">{props.t("model")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={props.activeModelKey} onValueChange={props.onModelChange}>
                  {props.models.map((model) => {
                    const key = `${model.providerId}/${model.modelId}`;
                    return (
                      <DropdownMenuRadioItem key={key} value={key} className="composer-choice-option">
                        <span className="composer-model-option">
                          <strong title={`${model.providerName}/${model.modelName}`}>
                            {model.providerName}/{model.modelName}
                          </strong>
                        </span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="composer-execution-subtrigger" disabled={props.activeModel === undefined}>
              <span>{props.t("thinking")}</span>
              <span className="composer-menu-value">{thinking}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="composer-choice-submenu">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="composer-choice-label">{props.t("thinking")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={props.thinkingLevel} onValueChange={props.onThinkingChange}>
                  {props.thinkingLevels.map((level) => (
                    <DropdownMenuRadioItem key={level} value={level} className="composer-choice-option">
                      {thinkingLevelLabel(level, props.t)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskListPage(props: {
  title: string;
  sessions: Session[];
  workspaces: Workspace[];
  t: T;
  onNewTask(): void;
  onOpenTask(taskId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const workspaceById = new Map(props.workspaces.map((workspace) => [workspace.id, workspace]));
  const filtered = props.sessions.filter((session) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchesQuery = normalizedQuery === "" || `${session.title} ${session.goal}`.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && (status === "all" || session.status === status);
  });
  return (
    <section className="task-list-page">
      <header className="page-header">
        <div><span>{props.t("work")}</span><h1>{props.title}</h1></div>
        <Button onClick={props.onNewTask}><Icon name="plus" size={14} />{props.t("newTask")}</Button>
      </header>
      <div className="task-list-toolbar">
        <div className="task-list-search"><Icon name="search" size={14} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={props.t("searchTasks")} /></div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label={props.t("status")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">{props.t("allStatuses")}</SelectItem>
            {["draft", "planning", "awaiting_plan_approval", "running", "awaiting_action_approval", "reviewing", "completed", "failed", "cancelled"].map((value) => (
              <SelectItem value={value} key={value}>{lifecycleLabel({ status: value as Session["status"], running: false }, props.t)}</SelectItem>
            ))}
          </SelectGroup></SelectContent>
        </Select>
        <span className="task-list-count">{filtered.length} {props.t("tasks")}</span>
      </div>
      {props.sessions.length === 0 ? (
        <div className="task-list-empty">
          <div className="empty-symbol"><Icon name="plan" /></div>
          <h2>{props.t("noTasksTitle")}</h2>
          <p>{props.t("noTasksDetail")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="task-list-empty"><Icon name="search" /><h2>{props.t("noSearchResults")}</h2></div>
      ) : (
        <div className="task-table">
          {filtered.map((session) => (
            <Button variant="ghost" className="task-table-row" key={session.id} onClick={() => props.onOpenTask(session.id)}>
              <span className={`task-state-dot state-${session.status}`} />
              <span className="task-table-copy"><strong>{session.title}</strong><small>{session.goal}</small></span>
              <span className={`lifecycle-badge lifecycle-${session.status}`}>{lifecycleLabel(session, props.t)}</span>
              <span className="task-table-folder">{workspaceById.get(session.workspaceId)?.name ?? props.t("personal")}</span>
              <time>{new Date(session.updatedAt).toLocaleDateString()}</time>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

export function SessionEmptyState(props: { personal: boolean; t: T; onNewTask(): void }) {
  if (props.personal) {
    return (
      <section className="session-empty-state session-empty-state-personal" aria-label="Pi Work">
        <div className="session-empty-personal-layout">
          <div className="session-empty-brand-copy">
            <p className="session-empty-kicker">{props.t("personalWorkspace")}</p>
            <h1>{props.t("personalEmptyTitle")}</h1>
            <p>{props.t("personalEmptyDetail")}</p>
          </div>
          <p className="session-empty-shortcut">
            <kbd>⌘ N</kbd>
            <span>{props.t("personalEmptyShortcut")}</span>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="session-empty-state">
      <div className="session-empty-state-content">
        <div className="empty-symbol"><Icon name="inbox" /></div>
        <h1>{props.t("selectSessionTitle")}</h1>
        <p>{props.t("selectSessionDetail")}</p>
        <Button onClick={props.onNewTask}>
          <Icon name="plus" size={14} />
          {props.t("newTask")}
        </Button>
      </div>
    </section>
  );
}

export function TaskWorkbench(props: {
  session: Session;
  workspace: Workspace | null;
  settings: AppSettings | undefined;
  models: ModelCatalog | undefined;
  statuses: StatusDefinition[];
  labels: Label[];
  approvals: ToolApproval[];
  taskMode: TaskMode;
  contextPanel: ContextPanel;
  t: T;
  onTaskMode(mode: TaskMode): void;
  onContextOpen(panel: Exclude<ContextPanel, null>): void;
  onContextClose(): void;
  onRefresh(): Promise<void>;
  onDelete(): void;
  folders: Workspace[];
  onPromoted(session: Session): void;
}) {
  const queryClient = useQueryClient();
  const sessionId = props.session.id;
  const personal = props.workspace?.kind === "managed" && props.session.kind === "chat";
  const draftKey = `pi-work:draft:${sessionId}`;
  const [input, setInput] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [streamed, setStreamed] = useState("");
  const [liveProcess, setLiveProcess] = useState<LiveProcess>({ thoughts: [], tools: [], timeline: [], notice: null });
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(props.session.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [topbarActionsTarget, setTopbarActionsTarget] = useState<HTMLElement | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Pick<AttachmentDraft, "name" | "mimeType"> | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [promotionWorkspaceId, setPromotionWorkspaceId] = useState(props.folders[0]?.id ?? "");
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishOutcome, setPublishOutcome] = useState<{ published: number; failed: number } | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [providerId, setProviderId] = useState(props.session.providerId ?? props.settings?.providerId ?? "");
  const [modelId, setModelId] = useState(props.session.modelId ?? props.settings?.modelId ?? "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(props.session.thinkingLevel);
  const [followStream, setFollowStream] = useState(true);
  const [atLatest, setAtLatest] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => (
    parseInspectorWidth(localStorage.getItem(inspectorWidthStorageKey))
  ));
  const [planInspectorWidth, setPlanInspectorWidth] = useState(() => (
    parsePlanInspectorWidth(localStorage.getItem(planInspectorWidthStorageKey))
  ));
  const [selectedPlanRevisionId, setSelectedPlanRevisionId] = useState<string | null>(null);
  const [selectedConductorRunId, setSelectedConductorRunId] = useState("");
  const [selectedConductorNode, setSelectedConductorNode] = useState<SelectedConductorNode | null>(null);
  const messageScroller = useRef<HTMLDivElement>(null);
  const messageFlow = useRef<HTMLDivElement>(null);
  const followStreamRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimer = useRef<number | null>(null);
  const streamQueue = useRef("");
  const streamTimer = useRef<number | null>(null);
  const streamWaiters = useRef<Array<() => void>>([]);
  const scrollFrame = useRef<number | null>(null);
  const navigatingTurnId = useRef<string | null>(null);
  const navigationTimer = useRef<number | null>(null);

  const messages = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => window.piWork.session.messages(sessionId),
    refetchInterval: props.session.running ? 1_000 : false,
  });
  const activities = useQuery({
    queryKey: ["activities", sessionId],
    queryFn: () => window.piWork.session.activities(sessionId),
    refetchInterval: props.session.running ? 1_000 : false,
  });
  const savedAttachments = useQuery({
    queryKey: ["attachments", sessionId],
    queryFn: () => window.piWork.session.attachments(sessionId),
    refetchInterval: props.session.running ? 1_000 : false,
  });
  const planRevisions = useQuery({
    queryKey: ["plan-revisions", sessionId],
    queryFn: () => window.piWork.task.listPlanRevisions(sessionId),
    refetchInterval: props.session.status === "planning" && props.session.running ? 1_000 : false,
  });
  const planExecutions = useQuery({
    queryKey: ["plan-executions", sessionId],
    queryFn: () => window.piWork.task.listPlanExecutions(sessionId),
    enabled: !personal,
    refetchInterval: (query) => (query.state.data as PlanExecutionDetail[] | undefined)
      ?.some(({ execution }) => execution.status === "pending" || execution.status === "running") ? 1_000 : false,
  });
  const conductorRuns = useQuery({
    queryKey: ["conductor-runs", props.workspace?.id, sessionId],
    queryFn: () => window.piWork.conductor.list({
      workspaceId: props.workspace!.id,
      taskId: sessionId,
    }),
    enabled: !personal && props.workspace !== null,
    refetchInterval: (query) => (query.state.data as ConductorRun[] | undefined)
      ?.some(({ status }) => status === "pending" || status === "running" || status === "paused") ? 1_000 : false,
  });
  const latestPlan = planRevisions.data?.at(-1) ?? null;
  const selectedPlan = planRevisions.data?.find(({ id }) => id === selectedPlanRevisionId) ?? latestPlan;
  const awaitingPlanApproval = !personal
    && props.session.executionMode === "plan"
    && props.session.status === "awaiting_plan_approval"
    && latestPlan?.status === "proposed";
  const artifacts = useQuery({
    queryKey: ["artifacts", sessionId],
    queryFn: () => window.piWork.artifact.list(sessionId),
    enabled: !personal,
  });
  const unpublished = (artifacts.data ?? []).filter(({ publishedPath }) => publishedPath === null);
  const configuredProviders = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const configured = new Set((configuredProviders.data ?? []).map(({ providerId: id }) => id));
  const disabledModelKeys = new Set(props.settings?.disabledModelKeys ?? []);
  const availableModels = (props.models?.models ?? []).filter((model) => (
    configured.has(model.providerId) && !disabledModelKeys.has(`${model.providerId}/${model.modelId}`)
  ));
  const activeModel = selectedModel(availableModels, providerId, modelId);
  const activeModelKey = activeModel === undefined ? "" : `${activeModel.providerId}/${activeModel.modelId}`;
  const thinkingLevels: ThinkingLevel[] = activeModel?.thinkingLevels.length ? activeModel.thinkingLevels : ["off"];
  const approvals = props.approvals;
  const turns = useMemo(() => conversationTurns(messages.data ?? []), [messages.data]);
  const liveResponsePersisted = pendingPrompt === null
    && persistedAssistantMatchesStream(messages.data ?? [], streamed);
  const collapsingProcessMessageId = liveResponsePersisted
    ? messages.data?.at(-1)?.id ?? null
    : null;
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  useEffect(() => {
    if (input === "") localStorage.removeItem(draftKey);
    else localStorage.setItem(draftKey, input);
  }, [draftKey, input]);
  useEffect(() => window.piWork.chat.onToolApproval((approval) => {
    if (approval.sessionId !== sessionId) return;
    void queryClient.invalidateQueries({ queryKey: ["tool-approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["activities", sessionId] });
  }), [queryClient, sessionId]);
  useEffect(() => window.piWork.agent.onEvent(({ sessionId: eventSessionId, event }) => {
    if (eventSessionId !== sessionId) return;
    if (event.kind === "text_delta"
      && event.payload.planning !== true
      && typeof event.payload.delta === "string") enqueueStream(event.payload.delta);
    setLiveProcess((current) => reduceLiveProcess(current, event.kind, event.payload, props.t));
    if (event.kind === "completed" || event.kind === "cancelled") {
      setRunNotice(event.kind === "cancelled" ? props.t("runCancelled") : props.t("responseComplete"));
      void finishLiveRun();
    }
  }), [props.onRefresh, props.t, queryClient, sessionId]);
  useEffect(() => () => {
    if (streamTimer.current !== null) window.clearTimeout(streamTimer.current);
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
    if (userScrollIntentTimer.current !== null) window.clearTimeout(userScrollIntentTimer.current);
    streamWaiters.current.splice(0).forEach((resolve) => resolve());
  }, []);
  useEffect(() => {
    cancelTurnNavigation();
    setStreamFollowing(true);
    setAtLatest(true);
    setPublishOutcome(null);
    setRunNotice(null);
    setSelectedConductorRunId("");
    setSelectedConductorNode(null);
    setSelectedPlanRevisionId(null);
    scheduleScrollToLatest("auto");
  }, [sessionId]);
  useEffect(() => {
    const flow = messageFlow.current;
    if (flow === null) return;
    const observer = new ResizeObserver(() => {
      const scroller = messageScroller.current;
      if (scroller !== null) setAtLatest(isNearBottom(scroller));
      if (followStreamRef.current) scheduleScrollToLatest("auto");
    });
    observer.observe(flow);
    return () => observer.disconnect();
  }, [sessionId]);
  useEffect(() => {
    setActiveTurnId((current) => {
      if (current !== null && turns.some(({ messageId }) => messageId === current)) return current;
      return turns.at(-1)?.messageId ?? null;
    });
  }, [turns]);
  useEffect(() => {
    if (!followStream) return;
    scheduleScrollToLatest("auto");
  }, [approvals.length, followStream, liveProcess, messages.data?.length, pendingPrompt, props.session.status, streamed]);
  useEffect(() => {
    if (!liveResponsePersisted) return;
    clearStream();
    setLiveProcess({ thoughts: [], tools: [], timeline: [], notice: null });
  }, [liveResponsePersisted]);
  useEffect(() => {
    if (!props.folders.some(({ id }) => id === promotionWorkspaceId)) {
      setPromotionWorkspaceId(props.folders[0]?.id ?? "");
    }
  }, [promotionWorkspaceId, props.folders]);

  const refreshTaskData = async () => {
    await Promise.all([
      props.onRefresh(),
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["attachments", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["activities", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["plan-revisions", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["plan-executions", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["conductor-runs", props.workspace?.id, sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["artifacts", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["tool-approvals"] }),
    ]);
  };
  const send = useMutation({
    mutationFn: ({
      content,
      editMessageId,
      submittedAttachments = [],
    }: {
      content: string;
      editMessageId?: string;
      submittedInput?: string;
      submittedAttachments?: AttachmentDraft[];
    }) => {
      clearStream();
      setRunNotice(null);
      setLiveProcess({ thoughts: [], tools: [], timeline: [], notice: null });
      if (providerId === "" || modelId === "") throw new Error(props.t("configureModel"));
      return window.piWork.chat.send({
        workspaceId: props.workspace?.id ?? null,
        taskId: sessionId,
        content,
        ...(editMessageId === undefined ? {} : { editMessageId }),
        providerId,
        modelId,
        thinkingLevel,
        permissionMode: props.session.permissionMode,
        planMode: personal ? false : props.session.executionMode === "plan",
        executionMode: personal ? "direct" : props.session.executionMode,
        attachments: editMessageId === undefined ? submittedAttachments : [],
      });
    },
    onMutate: async (variables) => {
      if (variables.editMessageId === undefined) return null;
      const messageKey = ["messages", sessionId] as const;
      const planKey = ["plan-revisions", sessionId] as const;
      const runKey = ["conductor-runs", props.workspace?.id, sessionId] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: messageKey }),
        queryClient.cancelQueries({ queryKey: planKey }),
        queryClient.cancelQueries({ queryKey: runKey }),
      ]);
      const snapshot = {
        messages: queryClient.getQueryData<ChatMessage[]>(messageKey),
        planRevisions: queryClient.getQueryData<PlanRevision[]>(planKey),
        conductorRuns: queryClient.getQueryData<ConductorRun[]>(runKey),
      };
      if (snapshot.messages === undefined) return snapshot;
      const edited = optimisticEditBranch({
        messages: snapshot.messages,
        planRevisions: snapshot.planRevisions ?? [],
        conductorRuns: snapshot.conductorRuns ?? [],
        messageId: variables.editMessageId,
        content: variables.content,
      });
      queryClient.setQueryData(messageKey, edited.messages);
      if (snapshot.planRevisions !== undefined) {
        queryClient.setQueryData(planKey, edited.planRevisions);
      }
      if (snapshot.conductorRuns !== undefined) {
        queryClient.setQueryData(runKey, edited.conductorRuns);
      }
      return snapshot;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["attachments", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["activities", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["plan-revisions", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["conductor-runs", props.workspace?.id, sessionId] }),
        props.onRefresh(),
      ]);
      setPendingPrompt(null);
    },
    onError: (cause: Error, variables, snapshot) => {
      if (snapshot?.messages !== undefined) {
        queryClient.setQueryData(["messages", sessionId], snapshot.messages);
      }
      if (snapshot?.planRevisions !== undefined) {
        queryClient.setQueryData(["plan-revisions", sessionId], snapshot.planRevisions);
      }
      if (snapshot?.conductorRuns !== undefined) {
        queryClient.setQueryData(
          ["conductor-runs", props.workspace?.id, sessionId],
          snapshot.conductorRuns,
        );
      }
      if (variables.editMessageId === undefined && variables.submittedInput !== undefined) {
        setInput((current) => restoreFailedComposerInput(current, variables.submittedInput ?? ""));
        setAttachments((current) => mergeAttachments(variables.submittedAttachments ?? [], current));
      }
      setPendingPrompt(null);
      clearStream();
      setLiveProcess({ thoughts: [], tools: [], timeline: [], notice: null });
      setError(cause.message);
    },
  });
  const updateSession = useMutation({
    mutationFn: (value: Record<string, unknown>) => window.piWork.session.update({ sessionId, ...value }),
    onSuccess: refreshTaskData,
    onError: (cause: Error) => setError(cause.message),
  });
  const updateModel = useMutation({
    mutationFn: (value: { providerId: string; modelId: string; thinkingLevel: ThinkingLevel }) => (
      window.piWork.conversation.updateModel({ taskId: sessionId, ...value })
    ),
    onSuccess: refreshTaskData,
    onError: (cause: Error) => setError(cause.message),
  });
  const approvePlan = useMutation({
    mutationFn: ({ planRevisionId, action }: { planRevisionId: string; action: PlanApprovalAction }) => (
      window.piWork.task.approvePlan({ taskId: sessionId, planRevisionId, action })
    ),
    onSuccess: async () => {
      await refreshTaskData();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const executeApprovedPlan = useMutation({
    mutationFn: ({ planRevisionId, mode }: { planRevisionId: string; mode: PlanExecutionMode }) => (
      window.piWork.task.executeApprovedPlan({ taskId: sessionId, planRevisionId, mode })
    ),
    onSuccess: refreshTaskData,
    onError: (cause: Error) => setError(cause.message),
  });
  const retryApprovedPlan = useMutation({
    mutationFn: (planRevisionId: string) => window.piWork.task.retryApprovedPlan({ taskId: sessionId, planRevisionId }),
    onSuccess: refreshTaskData,
    onError: (cause: Error) => setError(cause.message),
  });
  const savePlanRevision = useMutation({
    mutationFn: (input: Omit<PlanRevisionEditInput, "taskId">) => (
      window.piWork.task.savePlanRevision({ taskId: sessionId, ...input })
    ),
    onSuccess: async (revision) => {
      setSelectedPlanRevisionId(revision.id);
      await refreshTaskData();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const complete = useMutation({
    mutationFn: () => window.piWork.task.complete({ taskId: sessionId }),
    onSuccess: refreshTaskData,
    onError: (cause: Error) => setError(cause.message),
  });
  const promote = useMutation({
    mutationFn: () => {
      if (promotionWorkspaceId === "") throw new Error(props.t("chooseFolder"));
      return window.piWork.session.promote({ sessionId, workspaceId: promotionWorkspaceId });
    },
    onSuccess: (session) => {
      setPromotionOpen(false);
      props.onPromoted(session);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  async function publishAll() {
    const targets = unpublished;
    if (targets.length === 0) return;
    setPublishOutcome(null);
    setPublishingAll(true);
    let published = 0;
    let failure: string | null = null;
    for (const artifact of targets) {
      try {
        await window.piWork.artifact.publish({ artifactId: artifact.id });
        published += 1;
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : props.t("failedToLoad");
        break;
      }
    }
    setPublishOutcome({ published, failed: targets.length - published });
    if (failure !== null) setError(failure);
    await refreshTaskData();
    setPublishingAll(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (content === "") return;
    runPrompt(content);
  }

  function submitMessageEdit(messageId: string, content: string) {
    const trimmed = content.trim();
    if (trimmed === "" || send.isPending) return;
    setStreamFollowing(true);
    setAtLatest(true);
    scheduleScrollToLatest("smooth");
    send.mutate({ content: trimmed, editMessageId: messageId });
  }

  function changeModel(value: string) {
    const model = availableModels.find((candidate) => `${candidate.providerId}/${candidate.modelId}` === value);
    if (model === undefined) return;
    const nextThinking = model.thinkingLevels.includes(thinkingLevel) ? thinkingLevel : (model.thinkingLevels[0] ?? "off");
    setProviderId(model.providerId);
    setModelId(model.modelId);
    setThinkingLevel(nextThinking);
    updateModel.mutate({ providerId: model.providerId, modelId: model.modelId, thinkingLevel: nextThinking });
  }

  function changeThinkingLevel(value: string) {
    if (activeModel === undefined || !thinkingLevels.includes(value as ThinkingLevel)) return;
    const nextThinking = value as ThinkingLevel;
    setThinkingLevel(nextThinking);
    updateModel.mutate({ providerId: activeModel.providerId, modelId: activeModel.modelId, thinkingLevel: nextThinking });
  }

  const hasLiveActivity = liveProcess.thoughts.length > 0
    || liveProcess.tools.length > 0
    || liveProcess.notice !== null
    || streamed !== "";
  const showRunLoading = !liveResponsePersisted
    && (send.isPending || props.session.running)
    && streamed === "";
  const progressAnnouncement = useMemo(() => {
    if (!send.isPending && !props.session.running) return runNotice ?? "";
    const runningTool = liveProcess.tools.find((tool) => !tool.complete);
    if (runningTool !== undefined) return `${props.t("toolRunning")}: ${runningTool.toolName}`;
    if (streamed !== "") return props.t("responseStreaming");
    const lastTool = liveProcess.tools.at(-1);
    if (lastTool !== undefined && lastTool.complete) {
      return `${lastTool.failed ? props.t("toolFailed") : props.t("toolCompleted")}: ${lastTool.toolName}`;
    }
    if (liveProcess.thoughts.some((thought) => !thought.complete)) return props.t("thinkingInProgress");
    return props.t("sending");
  }, [liveProcess, props.session.running, props.t, runNotice, send.isPending, streamed]);
  const approvalAnnouncement = personal ? "" : approvals.length > 0
    ? `${props.t("toolRequest")}: ${approvals.map(({ tool }) => tool).join(", ")}`
    : props.session.status === "awaiting_plan_approval" ? props.t("planApprovalNeeded") : "";
  const canPromote = personal && !props.session.running && approvals.length === 0 && props.folders.length > 0;
  const slashCommands = useMemo<readonly ComposerSlashCommand[]>(() => [
    {
      id: "goal",
      command: "/goal",
      label: props.t("goal"),
      description: props.t("slashGoalDescription"),
      keywords: ["goal", "objective", "目标"],
      insertText: "/goal ",
    },
    ...(!personal ? [{
      id: "plan",
      command: "/plan" as const,
      label: props.t("plan"),
      description: props.t("slashPlanDescription"),
      keywords: ["plan", "planning", "计划"],
      insertText: "/plan ",
    }] : []),
  ], [personal, props.t]);
  useEffect(() => {
    setTopbarActionsTarget(document.getElementById("topbar-task-actions"));
  }, []);
  const headerActions = (
    <div className="task-header-actions">
      {!personal ? <Button variant="ghost" size="icon" aria-label={props.session.flagged ? props.t("unflag") : props.t("flag")} onClick={() => updateSession.mutate({ flagged: !props.session.flagged })}><Icon name="flag" /></Button> : null}
      {!personal ? <Button variant="ghost" size="icon" aria-label={props.contextPanel === "task" ? props.t("closeInspector") : props.t("openInspector")} aria-controls="task-inspector" aria-expanded={props.contextPanel !== null} onClick={() => props.contextPanel === "task" ? props.onContextClose() : props.onContextOpen("task")}><Icon name="panel-right" /></Button> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={props.t("advanced")}><Icon name="more" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {personal ? <DropdownMenuItem disabled={!canPromote} onSelect={() => setPromotionOpen(true)}><Icon name="workspace" />{props.t("moveToWorkFolder")}</DropdownMenuItem> : null}
          {personal ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => {
            setTitleDraft(props.session.title);
            setRenameOpen(true);
          }}><Icon name="rename" />{props.t("rename")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => updateSession.mutate({ archived: !props.session.archived })}><Icon name={props.session.archived ? "archive-restore" : "archive"} />{props.session.archived ? props.t("restore") : props.t("archive")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)}><Icon name="trash" />{props.t("delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const resizeInspector = (width: number, commit: boolean) => {
    const nextWidth = clampInspectorWidth(width);
    setInspectorWidth(nextWidth);
    if (commit) localStorage.setItem(inspectorWidthStorageKey, String(nextWidth));
  };
  const resizePlanInspector = (width: number, commit: boolean) => {
    const nextWidth = clampPlanInspectorWidth(width);
    setPlanInspectorWidth(nextWidth);
    if (commit) localStorage.setItem(planInspectorWidthStorageKey, String(nextWidth));
  };
  const openPlan = (planRevisionId: string) => {
    setSelectedPlanRevisionId(planRevisionId);
    props.onContextOpen("plan");
  };
  const openOrchestrationRun = (runId: string) => {
    setSelectedConductorRunId(runId);
    setSelectedConductorNode(null);
    const target = document.getElementById(conductorRunTargetId(runId));
    if (target === null) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  };
  const showConversation = true;
  const primaryWorkspaceActive = false;
  const activeInspectorWidth = props.contextPanel === "plan" ? planInspectorWidth : inspectorWidth;
  const taskExecutionMode: Exclude<TaskExecutionMode, "direct"> = props.session.executionMode === "orchestration"
    ? "orchestration"
    : "plan";
  return (
    <section
      className={`task-workbench ${!personal && props.contextPanel !== null ? "inspector-visible" : ""}${props.contextPanel === "plan" ? " plan-inspector-visible" : ""}`}
      style={{ "--inspector-width": `${activeInspectorWidth}px` } as CSSProperties}
    >
      <div className="execution-pane">
        {!personal ? <header className="task-context-header">
          <div className="task-context-meta">
            <span className={`lifecycle-badge lifecycle-${props.session.status}`}>{lifecycleLabel(props.session, props.t)}</span>
            <span className="folder-path"><Icon name="workspace" size={14} />{props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("workFolder")}</span>
          </div>
        </header> : null}
        {topbarActionsTarget === null ? null : createPortal(headerActions, topbarActionsTarget)}
        {error ? <Alert className="task-inline-error"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="icon" aria-label={props.t("close")} onClick={() => setError(null)}><Icon name="close" /></Button></Alert> : null}
        <div className={`conversation-stage${primaryWorkspaceActive ? " primary-workspace-stage" : ""}`}>
          {primaryWorkspaceActive && props.workspace !== null ? (
            <TaskPrimaryWorkspace
              session={props.session}
              workspace={props.workspace}
              mode={props.taskMode as Exclude<TaskMode, "conversation">}
              artifacts={artifacts.data ?? []}
              artifactsLoading={artifacts.isLoading}
              artifactsError={artifacts.isError}
              publishing={publishingAll}
              publishOutcome={publishOutcome}
              publishDestination={props.workspace.outputPath}
              completing={complete.isPending}
              selectedConductorRunId={selectedConductorRunId}
              selectedConductorNode={selectedConductorNode}
              t={props.t}
              onPublish={async (artifact) => {
                setPublishOutcome(null);
                try {
                  await window.piWork.artifact.publish({ artifactId: artifact.id });
                  setPublishOutcome({ published: 1, failed: 0 });
                  await refreshTaskData();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
                }
              }}
              onPublishAll={() => setPublishAllOpen(true)}
              onRetryArtifacts={() => void artifacts.refetch()}
              onSelectConductorRun={(runId) => {
                setSelectedConductorRunId(runId);
                setSelectedConductorNode(null);
              }}
              onSelectConductorNode={(node) => {
                setSelectedConductorNode(node);
                props.onContextOpen("node");
              }}
              onComplete={() => {
                if (unpublished.length > 0) setCompleteOpen(true);
                else complete.mutate();
              }}
            />
          ) : null}
          {showConversation ? (
          <>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label={props.t("agentStatus")}>{progressAnnouncement}</div>
          <div className="sr-only" role="alert" aria-atomic="true">{approvalAnnouncement}</div>
          <TurnNavigator
            turns={turns}
            activeTurnId={activeTurnId}
            t={props.t}
            onNavigate={navigateToTurn}
          />
          <div
            className="message-scroller"
            ref={messageScroller}
            onPointerDown={(event) => {
              cancelTurnNavigation();
              const bounds = event.currentTarget.getBoundingClientRect();
              if (event.clientX >= bounds.right - 16) markUserScrollIntent();
            }}
            onTouchStart={cancelTurnNavigation}
            onTouchMove={markUserScrollIntent}
            onWheel={() => {
              cancelTurnNavigation();
              markUserScrollIntent();
            }}
            onScroll={(event) => {
              const scroller = event.currentTarget;
              const nearBottom = isNearBottom(scroller);
              setAtLatest(nearBottom);
              if (userScrollIntentRef.current) setStreamFollowing(nearBottom);
              const visibleTurnId = activeTurnForScroller(scroller, turns);
              const nextTurnId = activeTurnDuringScroll(visibleTurnId, navigatingTurnId.current);
              setActiveTurnId((current) => current === nextTurnId ? current : nextTurnId);
            }}
          >
            <div className="message-flow" ref={messageFlow}>
              {messages.isError ? (
                <TaskSectionError t={props.t} onRetry={() => void messages.refetch()} />
              ) : (messages.data?.length ?? 0) === 0 && pendingPrompt === null ? (
                personal ? (
                  <div className="conversation-empty">
                    <span>{props.t("privateSandbox")}</span>
                    <h2>{props.session.goal}</h2>
                    <p>{props.t("privateSandboxDetail")}</p>
                  </div>
                ) : (
                  <TaskStartMode
                    mode={taskExecutionMode}
                    disabled={updateSession.isPending || props.session.running}
                    t={props.t}
                    onChange={(executionMode) => updateSession.mutate({ executionMode })}
                  />
                )
              ) : (
                <MessageList
                  messages={messages.data ?? []}
                  activities={activities.data ?? []}
                  attachments={savedAttachments.data ?? []}
                  collapsingProcessMessageId={collapsingProcessMessageId}
                  planRevisions={personal ? [] : planRevisions.data ?? []}
                  planExecutions={personal ? [] : planExecutions.data ?? []}
                  workflowRuns={personal ? [] : conductorRuns.data ?? []}
                  workspaceId={props.workspace?.id ?? null}
                  latestPlanRevisionId={latestPlan?.id ?? null}
                  taskStatus={props.session.status}
                  executionMode={props.session.executionMode}
                  permissionMode={props.session.permissionMode}
                  approvingPlanRevisionId={approvePlan.isPending ? approvePlan.variables?.planRevisionId ?? null : null}
                  executingPlanRevisionId={executeApprovedPlan.isPending ? executeApprovedPlan.variables?.planRevisionId ?? null : null}
                  retryingPlanRevisionId={retryApprovedPlan.isPending ? retryApprovedPlan.variables ?? null : null}
                  activePlanRevisionId={props.contextPanel === "plan" ? selectedPlan?.id ?? null : null}
                  t={props.t}
                  language={props.settings?.language ?? "en"}
                  onOpenPlan={openPlan}
                  onOpenOrchestrationRun={openOrchestrationRun}
                  onApprovePlan={(planRevisionId, action) => approvePlan.mutate({ planRevisionId, action })}
                  onExecuteApprovedPlan={(planRevisionId, mode) => executeApprovedPlan.mutate({ planRevisionId, mode })}
                  onRetryApprovedPlan={(planRevisionId) => retryApprovedPlan.mutate(planRevisionId)}
                  onQuickReply={send.isPending || props.session.running ? undefined : runPrompt}
                  onSubmitEdit={personal || !props.session.running ? submitMessageEdit : undefined}
                  onPreview={(attachment) => {
                    if (typeof window.piWork.attachment.preview !== "function") {
                      setError("Image preview is ready after restarting Pi Work.");
                      return;
                    }
                    setPreviewAttachment(attachment);
                    setPreviewUrl(null);
                    void window.piWork.attachment.preview(attachment.id)
                      .then(setPreviewUrl)
                      .catch((cause: Error) => setError(cause.message));
                  }}
                />
              )}
              {pendingPrompt !== null ? (
                <article className="message user pending"><UserMessageContent content={pendingPrompt} /></article>
              ) : null}
              {!liveResponsePersisted && (hasLiveActivity || showRunLoading) ? (
                <article className="message assistant">
                  {hasLiveActivity ? <LiveProcessView collapse={streamed !== ""} process={liveProcess} t={props.t} /> : null}
                  {streamed !== "" ? <AssistantResult streaming content={streamed} t={props.t} /> : null}
                  {showRunLoading ? <RunLoadingState label={props.t("runStarting")} /> : null}
                </article>
              ) : null}
              {planRevisions.isError && !personal && props.session.planMode ? (
                <TaskSectionError t={props.t} onRetry={() => void planRevisions.refetch()} />
              ) : null}
              {(planRevisions.isLoading || (props.session.status === "planning" && props.session.running))
                && !personal && props.session.planMode ? <PlanSkeleton t={props.t} /> : null}
              {approvals.map((approval) => <ToolApprovalCard key={approval.approvalId} approval={approval} t={props.t} onResolve={(approved) => resolveApproval(approval.approvalId, approved)} />)}
            </div>
          </div>
          </>
          ) : null}
        </div>
        {showConversation && awaitingPlanApproval && latestPlan !== null ? (
          <PlanApprovalDock
            permissionMode={props.session.permissionMode}
            busy={approvePlan.isPending || send.isPending || props.session.running}
            t={props.t}
            onApprove={(action) => approvePlan.mutate({ planRevisionId: latestPlan.id, action })}
            onRequestChanges={runPrompt}
          />
        ) : showConversation ? <div className="composer-dock">
          {!followStream || !atLatest ? (
            <Button variant="secondary" className="scroll-to-latest" size="icon" type="button" aria-label={props.t("scrollToLatest")} onClick={() => {
              setStreamFollowing(true);
              setAtLatest(true);
              scheduleScrollToLatest("smooth");
            }}><Icon name="arrow-down" /></Button>
          ) : null}
          <form className="composer" onSubmit={submit} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          void window.piWork.attachment.fromFiles(Array.from(event.dataTransfer.files)).then((selected) => setAttachments((current) => mergeAttachments(current, selected))).catch((cause: Error) => setError(cause.message));
          }}>
          {attachments.length > 0 ? (
            <AttachmentGroup className="composer-attachments">
              {attachments.map((attachment) => (
                <ComposerAttachment
                  key={attachment.path}
                  attachment={attachment}
                  removeLabel={`${props.t("removeAttachment")}: ${attachment.name}`}
                  onRemove={() => setAttachments((current) => current.filter(({ path }) => path !== attachment.path))}
                  onPreview={() => {
                    if (typeof window.piWork.attachment.previewDraft !== "function") {
                      setError("Image preview is ready after restarting Pi Work.");
                      return;
                    }
                    setPreviewAttachment(attachment);
                    setPreviewUrl(null);
                    void window.piWork.attachment.previewDraft(attachment)
                      .then(setPreviewUrl)
                      .catch((cause: Error) => setError(cause.message));
                  }}
                />
              ))}
            </AttachmentGroup>
          ) : null}
          <ComposerEditor
            className="composer-input"
            value={input}
            onChange={setInput}
            ariaLabel={props.t("messagePlaceholder")}
            slashCommands={slashCommands}
            onImagePaste={(image) => {
              void image.arrayBuffer()
                .then((buffer) => window.piWork.attachment.fromClipboardImage({
                  mimeType: image.type,
                  bytes: new Uint8Array(buffer),
                }))
                .then((attachment) => setAttachments((current) => mergeAttachments(current, [attachment])))
                .catch((cause: Error) => setError(cause.message));
            }}
            onSubmitShortcut={() => {
              const content = input.trim();
              if (content !== "") runPrompt(content);
            }}
            placeholder={props.session.planMode && (props.session.status === "planning" || props.session.status === "awaiting_plan_approval")
              ? props.t("planFeedbackPlaceholder")
              : props.t("messagePlaceholder")}
          />
          <div className="composer-toolbar">
            <div className="composer-toolbar-start">
              <Button variant="ghost" size="icon" className="composer-attachment-trigger" type="button" aria-label={props.t("addAttachment")} onClick={() => void window.piWork.attachment.choose().then((selected) => setAttachments((current) => mergeAttachments(current, selected))).catch((cause: Error) => setError(cause.message))}><Icon name="paperclip" /></Button>
              <ComposerPermissionMenu
                permissionMode={props.session.permissionMode}
                disabled={updateSession.isPending || props.session.running}
                t={props.t}
                onPermissionChange={(permissionMode) => updateSession.mutate({ permissionMode })}
              />
              {!personal ? (
                <ComposerTaskModeMenu
                  mode={taskExecutionMode}
                  disabled={updateSession.isPending || props.session.running}
                  t={props.t}
                  onChange={(executionMode) => updateSession.mutate({ executionMode })}
                />
              ) : null}
            </div>
            <div className="composer-toolbar-end">
              <ComposerModelMenu
                models={availableModels}
                activeModel={activeModel}
                activeModelKey={activeModelKey}
                thinkingLevel={thinkingLevel}
                thinkingLevels={thinkingLevels}
                disabled={availableModels.length === 0 || updateModel.isPending || props.session.running}
                t={props.t}
                onModelChange={changeModel}
                onThinkingChange={changeThinkingLevel}
              />
              {send.isPending || props.session.running ? (
                <Button size="icon" className="send-button stop-button" type="button" aria-label={props.t("stop")} onClick={() => void window.piWork.session.stop(sessionId).then(refreshTaskData).catch((cause: Error) => setError(cause.message))}><Icon name="stop" size={14} fill="currentColor" strokeWidth={0} /></Button>
              ) : (
                <Button size="icon" className="send-button" title={props.t("sendHint")} aria-label={props.t("send")} disabled={input.trim() === ""}><Icon name="arrow-up" /></Button>
              )}
            </div>
          </div>
          </form>
        </div> : null}
      </div>
      {!personal && props.contextPanel !== null ? <TaskInspector
        panel={props.contextPanel}
        plan={selectedPlan}
        planRevisions={planRevisions.data ?? []}
        planExecutions={(planExecutions.data ?? []).filter(({ execution }) => execution.planRevisionId === selectedPlan?.id)}
        session={props.session}
        workspace={props.workspace}
        statuses={props.statuses}
        labels={props.labels}
        activities={activities.data ?? []}
        activityLoading={activities.isLoading}
        activityError={activities.isError}
        approvals={approvals}
        t={props.t}
        onClose={props.onContextClose}
        inspectorWidth={activeInspectorWidth}
        minimumWidth={props.contextPanel === "plan" ? minimumPlanInspectorWidth : minimumInspectorWidth}
        maximumWidth={props.contextPanel === "plan" ? maximumPlanInspectorWidth : maximumInspectorWidth}
        defaultWidth={props.contextPanel === "plan" ? defaultPlanInspectorWidth : defaultInspectorWidth}
        onResize={props.contextPanel === "plan" ? resizePlanInspector : resizeInspector}
        selectedConductorNode={selectedConductorNode}
        permissionMode={props.session.permissionMode}
        workingDirectory={props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("workFolder")}
        outputPath={props.workspace?.outputPath ?? null}
        approvalRequired={selectedPlan?.status === "proposed"
          && selectedPlan.id === latestPlan?.id
          && props.session.executionMode === "plan"
          && props.session.status === "awaiting_plan_approval"}
        planHistorical={selectedPlan?.status === "superseded"
          || (selectedPlan?.status === "proposed" && props.session.executionMode !== "plan")}
        retryAllowed={selectedPlan?.status === "approved"
          && props.session.executionMode === "plan"
          && (props.session.status === "failed" || props.session.status === "cancelled")}
        approving={approvePlan.isPending && approvePlan.variables?.planRevisionId === selectedPlan?.id}
        executing={executeApprovedPlan.isPending && executeApprovedPlan.variables?.planRevisionId === selectedPlan?.id}
        retrying={retryApprovedPlan.isPending && retryApprovedPlan.variables === selectedPlan?.id}
        editable={selectedPlan !== null
          && selectedPlan.id === latestPlan?.id
          && (selectedPlan.status === "proposed" || selectedPlan.status === "approved")
          && !props.session.running}
        savingPlan={savePlanRevision.isPending}
        onApprovePlan={(action) => {
          if (selectedPlan !== null) approvePlan.mutate({ planRevisionId: selectedPlan.id, action });
        }}
        onExecutePlan={(mode) => {
          if (selectedPlan !== null) executeApprovedPlan.mutate({ planRevisionId: selectedPlan.id, mode });
        }}
        onRetryPlan={() => {
          if (selectedPlan !== null) retryApprovedPlan.mutate(selectedPlan.id);
        }}
        onSavePlan={(input) => savePlanRevision.mutate(input)}
        onOpenOrchestrationRun={openOrchestrationRun}
        onUpdateBrief={async (value) => {
          try {
            await window.piWork.task.updateBrief({ taskId: sessionId, ...value });
            await refreshTaskData();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
          }
        }}
        onUpdateSession={(value) => updateSession.mutate(value)}
        onResolveApproval={resolveApproval}
        onRetryActivity={() => void activities.refetch()}
      /> : null}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogTitle>{props.t("rename")}</DialogTitle>
          <form onSubmit={(event) => {
            event.preventDefault();
            const title = titleDraft.trim();
            if (title === "") return;
            updateSession.mutate({ title }, { onSuccess: () => setRenameOpen(false) });
          }}>
            <Input
              autoFocus
              aria-label={props.t("rename")}
              value={titleDraft}
              maxLength={160}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>{props.t("cancel")}</Button>
              <Button type="submit" disabled={updateSession.isPending || titleDraft.trim() === ""}>{props.t("save")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="delete-session-dialog">
          <AlertDialogHeader className="delete-session-header">
            <div className="delete-session-heading">
              <span className="delete-session-icon" aria-hidden="true"><Icon name="trash" size={14} /></span>
              <AlertDialogTitle>{props.t("deleteSession")}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>{props.t("deleteSessionDetail")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="delete-session-actions">
            <AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={props.onDelete}>{props.t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("completeWithUnpublished")}</AlertDialogTitle><AlertDialogDescription>{props.t("unpublishedWarning")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => complete.mutate()}>{props.t("completeTask")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={publishAllOpen} onOpenChange={setPublishAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t("publishConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{props.t("publishConfirmDetail")}</AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="publish-confirm-scope">
            <div><dt>{props.t("publishFilesLabel")}</dt><dd>{unpublished.length}</dd></div>
            <div><dt>{props.t("publishDestinationLabel")}</dt><dd><code>{props.workspace?.outputPath ?? props.t("workFolder")}</code></dd></div>
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publishAll()}>{props.t("publishAll")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={promotionOpen} onOpenChange={setPromotionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t("moveToWorkFolder")}</AlertDialogTitle>
            <AlertDialogDescription>{props.t("moveToWorkFolderDetail")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel>{props.t("selectWorkFolder")}</FieldLabel>
            <Select value={promotionWorkspaceId} onValueChange={setPromotionWorkspaceId}>
              <SelectTrigger><SelectValue placeholder={props.t("chooseFolder")} /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={promote.isPending || promotionWorkspaceId === ""} onClick={() => promote.mutate()}>
              {promote.isPending ? props.t("movingSession") : props.t("moveSession")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={previewAttachment !== null} onOpenChange={(open) => {
        if (!open) {
          setPreviewAttachment(null);
          setPreviewUrl(null);
        }
      }}>
        <DialogContent className="attachment-preview-dialog w-[min(900px,calc(100%-40px))] max-w-none p-2">
          <DialogTitle className="sr-only">{previewAttachment?.name ?? "Attachment preview"}</DialogTitle>
          {previewAttachment?.mimeType.startsWith("image/") && previewUrl !== null ? (
            <img src={previewUrl} alt={previewAttachment.name} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );

  function enqueueStream(delta: string) {
    streamQueue.current += delta;
    if (streamTimer.current !== null) return;
    const flush = () => {
      const chunkSize = Math.max(1, Math.ceil(streamQueue.current.length / 24));
      const chunk = streamQueue.current.slice(0, chunkSize);
      streamQueue.current = streamQueue.current.slice(chunkSize);
      if (chunk !== "") setStreamed((current) => current + chunk);
      if (streamQueue.current === "") {
        streamTimer.current = null;
        streamWaiters.current.splice(0).forEach((resolve) => resolve());
        return;
      }
      streamTimer.current = window.setTimeout(flush, 16);
    };
    streamTimer.current = window.setTimeout(flush, 0);
  }

  function scheduleScrollToLatest(behavior: ScrollBehavior) {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = null;
        const scroller = messageScroller.current;
        if (scroller === null) return;
        scroller.scrollTo({ top: scroller.scrollHeight, behavior });
        if (behavior === "auto") setAtLatest(true);
      });
    });
  }

  function setStreamFollowing(next: boolean) {
    followStreamRef.current = next;
    setFollowStream((current) => current === next ? current : next);
  }

  function markUserScrollIntent() {
    userScrollIntentRef.current = true;
    if (userScrollIntentTimer.current !== null) window.clearTimeout(userScrollIntentTimer.current);
    userScrollIntentTimer.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimer.current = null;
    }, 180);
  }

  function cancelTurnNavigation() {
    navigatingTurnId.current = null;
    if (navigationTimer.current !== null) {
      window.clearTimeout(navigationTimer.current);
      navigationTimer.current = null;
    }
  }

  function navigateToTurn(turn: ConversationTurn) {
    const target = document.getElementById(turn.targetId);
    if (target === null) return;
    cancelTurnNavigation();
    setStreamFollowing(false);
    setActiveTurnId(turn.messageId);
    navigatingTurnId.current = turn.messageId;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    navigationTimer.current = window.setTimeout(() => {
      if (navigatingTurnId.current === turn.messageId) navigatingTurnId.current = null;
      navigationTimer.current = null;
    }, 1_000);
  }

  function waitForStream(): Promise<void> {
    if (streamQueue.current === "" && streamTimer.current === null) return Promise.resolve();
    return new Promise((resolve) => streamWaiters.current.push(resolve));
  }

  async function finishLiveRun() {
    await waitForStream();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["attachments", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["activities", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["conductor-runs", props.workspace?.id, sessionId] }),
      props.onRefresh(),
    ]);
    clearStream();
    setLiveProcess({ thoughts: [], tools: [], timeline: [], notice: null });
  }

  function clearStream() {
    if (streamTimer.current !== null) window.clearTimeout(streamTimer.current);
    streamTimer.current = null;
    streamQueue.current = "";
    streamWaiters.current.splice(0).forEach((resolve) => resolve());
    setStreamed("");
  }

  function resolveApproval(approvalId: string, approved: boolean) {
    void window.piWork.chat.resolveToolApproval({ approvalId, approved }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["tool-approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["activities", sessionId] });
    }).catch((cause: Error) => setError(cause.message));
  }

  function runPrompt(content: string) {
    if (send.isPending || props.session.running) return;
    const submittedInput = input;
    const submittedAttachments = attachments;
    setInput("");
    setAttachments([]);
    setStreamFollowing(true);
    setAtLatest(true);
    setPendingPrompt(content);
    scheduleScrollToLatest("smooth");
    send.mutate({ content, submittedInput, submittedAttachments });
  }
}

function relativeMessageTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const locale = language === "zh" ? "zh-CN" : "en";
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absSec < 45) return language === "zh" ? "刚刚" : "just now";
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (absSec < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

function absoluteMessageTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const locale = language === "zh" ? "zh-CN" : "en";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function MessageActions({ content, createdAt, language, t, onEdit }: {
  content: string;
  createdAt: string;
  language: string;
  t: T;
  onEdit?: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);
  const copy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };
  return (
    <div className="message-actions" role="group">
      <time
        className="message-actions-time"
        dateTime={createdAt}
        title={absoluteMessageTime(createdAt, language)}
      >{relativeMessageTime(createdAt, language)}</time>
      <button
        type="button"
        className="message-action-button"
        data-copied={copied ? "true" : undefined}
        aria-label={copied ? t("copied") : t("copyMessage")}
        title={copied ? t("copied") : t("copyMessage")}
        onClick={copy}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
      {onEdit ? (
        <button
          type="button"
          className="message-action-button"
          aria-label={t("editMessage")}
          title={t("editMessage")}
          onClick={onEdit}
        >
          <Icon name="square-pen" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function MessageList({
  messages,
  activities,
  attachments,
  planRevisions,
  planExecutions,
  workflowRuns,
  workspaceId,
  latestPlanRevisionId,
  taskStatus,
  executionMode,
  permissionMode,
  approvingPlanRevisionId,
  executingPlanRevisionId,
  retryingPlanRevisionId,
  activePlanRevisionId,
  collapsingProcessMessageId,
  t,
  language,
  onOpenPlan,
  onOpenOrchestrationRun,
  onApprovePlan,
  onExecuteApprovedPlan,
  onRetryApprovedPlan,
  onQuickReply,
  onSubmitEdit,
  onPreview,
}: {
  messages: ChatMessage[];
  activities: Activity[];
  attachments: StoredAttachment[];
  planRevisions: PlanRevision[];
  planExecutions: PlanExecutionDetail[];
  workflowRuns: ConductorRun[];
  workspaceId: string | null;
  latestPlanRevisionId: string | null;
  taskStatus: Session["status"];
  executionMode: TaskExecutionMode;
  permissionMode: PermissionMode;
  approvingPlanRevisionId: string | null;
  executingPlanRevisionId: string | null;
  retryingPlanRevisionId: string | null;
  activePlanRevisionId: string | null;
  collapsingProcessMessageId: string | null;
  t: T;
  language: string;
  onOpenPlan(planRevisionId: string): void;
  onOpenOrchestrationRun(runId: string): void;
  onApprovePlan(planRevisionId: string, action: PlanApprovalAction): void;
  onExecuteApprovedPlan(planRevisionId: string, mode: PlanExecutionMode): void;
  onRetryApprovedPlan(planRevisionId: string): void;
  onQuickReply?: ((content: string) => void) | undefined;
  onSubmitEdit?: ((messageId: string, content: string) => void) | undefined;
  onPreview(attachment: StoredAttachment): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const messageIds = new Set(messages.map(({ id }) => id));
  const workflowCard = (run: ConductorRun) => workspaceId === null ? null : (
    <ConversationWorkflowCard
      key={run.id}
      run={run}
      runs={workflowRuns}
      workspaceId={workspaceId}
      t={t}
    />
  );
  const planCard = (plan: PlanRevision) => {
    const executionRun = planExecutionRun(workflowRuns, plan.id);
    const executions = planExecutions.filter(({ execution }) => execution.planRevisionId === plan.id);
    const historical = plan.status === "superseded"
      || (plan.status === "proposed" && executionMode !== "plan");
    return (
      <div className="conversation-plan-stack" key={plan.id}>
        <ConversationPlanCard
          plan={plan}
          latest={plan.id === latestPlanRevisionId}
          historical={historical}
          approvalRequired={!historical
            && executionMode === "plan"
            && plan.status === "proposed"
            && plan.id === latestPlanRevisionId
            && taskStatus === "awaiting_plan_approval"}
          readyToExecute={!historical
            && plan.status === "approved"
            && taskStatus === "ready_to_execute"}
          retryAllowed={executionMode === "plan"
            && plan.status === "approved"
            && (taskStatus === "failed" || taskStatus === "cancelled")}
          permissionMode={permissionMode}
          approving={approvingPlanRevisionId === plan.id}
          executing={executingPlanRevisionId === plan.id}
          retrying={retryingPlanRevisionId === plan.id}
          active={activePlanRevisionId === plan.id}
          t={t}
          onOpen={() => onOpenPlan(plan.id)}
          onOpenOrchestrationRun={onOpenOrchestrationRun}
          onApprove={(action) => onApprovePlan(plan.id, action)}
          onExecute={(mode) => onExecuteApprovedPlan(plan.id, mode)}
          onRetry={() => onRetryApprovedPlan(plan.id)}
          execution={executionRun !== null && workspaceId !== null ? (
            <ConversationWorkflowCard
              run={executionRun}
              runs={workflowRuns}
              workspaceId={workspaceId}
              presentation="plan-execution"
              t={t}
            />
          ) : null}
          executions={executions}
        />
      </div>
    );
  };
  const standaloneRuns = standaloneWorkflowRuns(workflowRuns);
  return (
    <div className="messages">
      {messages.map((message, messageIndex) => {
        const startsTurn = message.role === "user";
        const visibleContent = visibleMessageContent(message.content);
        const platformLinks = message.role === "user" ? knownPlatformLinks(visibleContent) : [];
        const showActions = message.role !== "system" && visibleContent !== "";
        const editing = editingId === message.id;
        const clarificationOptions = message.role === "assistant" && messageIndex === messages.length - 1
          ? planClarificationOptions(activities, message.id)
          : [];
        return (
          <div className="message-turn" id={startsTurn ? turnTargetId(message.id) : undefined} key={message.id}>
            <article className={`message ${message.role}${platformLinks.length > 0 ? " has-platform-links" : ""}${editing ? " is-editing" : ""}`}>
              {message.role === "assistant"
                ? <><HistoricalProcess activities={activities.filter((activity) => (activity.kind === "thinking" || activity.kind === "tool_result") && activity.messageId === message.id)} animateCollapse={message.id === collapsingProcessMessageId} t={t} />{visibleContent !== "" ? <AssistantResult content={visibleContent} t={t} /> : null}</>
                : editing
                  ? <MessageEditor
                      initialContent={visibleContent}
                      t={t}
                      onCancel={() => setEditingId(null)}
                      onSave={(content) => {
                        setEditingId(null);
                        onSubmitEdit?.(message.id, content);
                      }}
                    />
                  : <><MessageAttachments attachments={attachments.filter((attachment) => attachment.messageId === message.id)} onPreview={onPreview} />{visibleContent !== "" ? <UserMessageContent content={visibleContent} links={platformLinks} /> : null}</>}
              {showActions && !editing ? (
                <MessageActions
                  content={visibleContent}
                  createdAt={message.createdAt}
                  language={language}
                  t={t}
                  onEdit={message.role === "user" && onSubmitEdit ? () => setEditingId(message.id) : undefined}
                />
              ) : null}
            </article>
            {clarificationOptions.length > 0 && onQuickReply !== undefined ? (
              <div className="plan-clarification-options" role="group" aria-label={visibleContent}>
                {clarificationOptions.map((option) => (
                  <button
                    type="button"
                    key={`${message.id}:${option.label}`}
                    onClick={() => onQuickReply(option.label)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {planRevisions
              .filter(({ createdFromMessageId }) => createdFromMessageId === message.id)
              .map(planCard)}
            {standaloneRuns
              .filter(({ sourceMessageId }) => sourceMessageId === message.id)
              .map(workflowCard)}
          </div>
        );
      })}
      {planRevisions
        .filter(({ createdFromMessageId }) => createdFromMessageId === null || !messageIds.has(createdFromMessageId))
        .map(planCard)}
      {standaloneRuns
        .filter(({ sourceMessageId }) => sourceMessageId === null || !messageIds.has(sourceMessageId))
        .map(workflowCard)}
    </div>
  );
}

function planClarificationOptions(activities: Activity[], messageId: string): PlanClarificationOption[] {
  const activity = activities.find((candidate) => (
    candidate.messageId === messageId
    && candidate.kind === "notice"
    && candidate.metadata.type === "plan_clarification_options"
  ));
  const value = activity?.metadata.options;
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (
      typeof option !== "object"
      || option === null
      || typeof Reflect.get(option, "label") !== "string"
      || typeof Reflect.get(option, "description") !== "string"
    ) {
      return [];
    }
    return [{
      label: Reflect.get(option, "label") as string,
      description: Reflect.get(option, "description") as string,
    }];
  }).slice(0, 4);
}

function workflowOriginLabel(run: ConductorRun, t: T): string {
  if (run.origin === "conversation") return t("workflowOriginConversation");
  if (run.origin === "approved_plan") return t("planExecution");
  return t("workflowLegacy");
}

export function workflowRunsForPlan(runs: ConductorRun[], planRevisionId: string): ConductorRun[] {
  return runs.filter((run) => run.origin === "approved_plan" && run.planRevisionId === planRevisionId);
}

export function conductorRunTargetId(runId: string): string {
  return `conductor-run-${runId}`;
}

export function planExecutionRun(runs: ConductorRun[], planRevisionId: string): ConductorRun | null {
  return workflowRunsForPlan(runs, planRevisionId)[0] ?? null;
}

export function standaloneWorkflowRuns(runs: ConductorRun[]): ConductorRun[] {
  return runs.filter((run) => run.origin !== "approved_plan");
}

export function optimisticEditBranch(input: {
  messages: ChatMessage[];
  planRevisions: PlanRevision[];
  conductorRuns: ConductorRun[];
  messageId: string;
  content: string;
}): {
  messages: ChatMessage[];
  planRevisions: PlanRevision[];
  conductorRuns: ConductorRun[];
} {
  const index = input.messages.findIndex(({ id }) => id === input.messageId);
  const target = input.messages[index];
  if (index === -1 || target === undefined) {
    return {
      messages: input.messages,
      planRevisions: input.planRevisions,
      conductorRuns: input.conductorRuns,
    };
  }
  const affectedMessageIds = new Set(input.messages.slice(index).map(({ id }) => id));
  const availableMessageIds = new Set(input.messages.map(({ id }) => id));
  const removedPlanRevisionIds = new Set(input.planRevisions
    .filter((plan) => (
      (plan.createdFromMessageId !== null && affectedMessageIds.has(plan.createdFromMessageId))
      || (
        (plan.createdFromMessageId === null || !availableMessageIds.has(plan.createdFromMessageId))
        && plan.createdAt >= target.createdAt
      )
    ))
    .map(({ id }) => id));
  const removedRunIds = new Set(input.conductorRuns
    .filter((run) => (
      (run.sourceMessageId !== null && affectedMessageIds.has(run.sourceMessageId))
      || (run.finalMessageId !== null && affectedMessageIds.has(run.finalMessageId))
      || (run.planRevisionId !== null && removedPlanRevisionIds.has(run.planRevisionId))
      || (
        run.origin !== "legacy"
        && run.sourceMessageId === null
        && run.planRevisionId === null
        && run.createdAt >= target.createdAt
      )
    ))
    .map(({ id }) => id));
  let foundChildRun = true;
  while (foundChildRun) {
    foundChildRun = false;
    for (const run of input.conductorRuns) {
      if (
        run.parentRunId !== null
        && removedRunIds.has(run.parentRunId)
        && !removedRunIds.has(run.id)
      ) {
        removedRunIds.add(run.id);
        foundChildRun = true;
      }
    }
  }
  return {
    messages: [
      ...input.messages.slice(0, index),
      { ...target, content: input.content },
    ],
    planRevisions: input.planRevisions.filter(({ id }) => !removedPlanRevisionIds.has(id)),
    conductorRuns: input.conductorRuns.filter(({ id }) => !removedRunIds.has(id)),
  };
}

function workflowStatusLabel(status: ConductorRun["status"], t: T): string {
  if (status === "pending") return t("workflowStatusPending");
  if (status === "running") return t("workflowStatusRunning");
  if (status === "paused") return t("workflowStatusPaused");
  if (status === "completed") return t("workflowStatusCompleted");
  if (status === "failed") return t("workflowStatusFailed");
  return t("workflowStatusCancelled");
}

export function workflowProgress(states: ConductorNodeState[], total: number): {
  completed: number;
  total: number;
  current: ConductorNodeState | null;
} {
  return {
    completed: states.filter(({ status }) => status === "completed").length,
    total,
    current: states.find(({ status }) => status === "running")
      ?? states.find(({ status }) => status === "ready")
      ?? states.find(({ status }) => status === "pending")
      ?? null,
  };
}

function ConversationWorkflowCard(props: {
  run: ConductorRun;
  runs: ConductorRun[];
  workspaceId: string;
  presentation?: "workflow" | "plan-execution";
  t: T;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = props.run.status === "pending" || props.run.status === "running" || props.run.status === "paused";
  const nodes = useQuery({
    queryKey: ["conductor-nodes", props.workspaceId, props.run.id],
    queryFn: () => window.piWork.conductor.nodes({ workspaceId: props.workspaceId, runId: props.run.id }),
    refetchInterval: active ? 1_000 : false,
  });
  const attempts = useQuery({
    queryKey: ["conductor-attempts", props.workspaceId, props.run.id],
    queryFn: () => window.piWork.conductor.attempts({ workspaceId: props.workspaceId, runId: props.run.id }),
    enabled: open,
    refetchInterval: open && active ? 1_000 : false,
  });
  const progress = workflowProgress(nodes.data ?? [], props.run.spec.nodes.length);
  const currentNode = progress.current === null
    ? null
    : props.run.spec.nodes.find(({ id }) => id === progress.current?.nodeId) ?? null;
  const selectedNode = props.run.spec.nodes.find(({ id }) => id === selectedNodeId)
    ?? currentNode
    ?? props.run.spec.nodes[0]
    ?? null;
  const selectedState = selectedNode === null ? null : nodes.data?.find(({ nodeId }) => nodeId === selectedNode.id) ?? null;
  const selectedAttempts = selectedNode === null
    ? []
    : (attempts.data ?? []).filter(({ nodeId }) => nodeId === selectedNode.id);
  const planExecution = props.presentation === "plan-execution";
  const retryRuns = planExecution
    ? props.runs.filter((run) => (
        run.id !== props.run.id
        && run.origin === "approved_plan"
        && run.planRevisionId === props.run.planRevisionId
      ))
    : props.runs.filter(({ parentRunId }) => parentRunId === props.run.id);
  const surfaceLabel = planExecution ? props.t("planExecution") : props.t("workflow");
  const detailLabel = planExecution
    ? currentNode?.title ?? workflowStatusLabel(props.run.status, props.t)
    : props.run.title;
  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const next = await window.piWork.conductor.retry({ workspaceId: props.workspaceId, runId: props.run.id });
      queryClient.setQueryData<ConductorRun[]>(
        ["conductor-runs", props.workspaceId, props.run.taskId],
        (current = []) => [next, ...current.filter(({ id }) => id !== next.id)],
      );
      await queryClient.invalidateQueries({ queryKey: ["conductor-runs", props.workspaceId, props.run.taskId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <article
      id={conductorRunTargetId(props.run.id)}
      tabIndex={-1}
      className={`conversation-workflow workflow-${props.run.status}${planExecution ? " is-plan-execution" : ""}`}
      aria-label={`${surfaceLabel}: ${props.run.title}`}
      onFocus={(event) => {
        if (event.target === event.currentTarget) setOpen(true);
      }}
    >
      <button
        type="button"
        className="conversation-workflow-summary"
        aria-expanded={open}
        aria-label={open
          ? props.t(planExecution ? "planExecutionCollapseDetails" : "workflowCollapseDetails")
          : props.t(planExecution ? "planExecutionExpandDetails" : "workflowExpandDetails")}
        onClick={() => setOpen((value) => !value)}
      >
        {!planExecution ? <span className="conversation-workflow-icon"><Icon name="workflow" size={14} /></span> : null}
        <span className="conversation-workflow-copy">
          <span className="conversation-workflow-eyebrow">
            {planExecution
              ? surfaceLabel
              : <>{surfaceLabel} · {workflowOriginLabel(props.run, props.t)}</>}
          </span>
          <strong>{detailLabel}</strong>
          {!planExecution && props.run.summary !== "" ? <span>{props.run.summary}</span> : null}
        </span>
        <span className="conversation-workflow-progress">
          <span>{progress.completed}/{progress.total}</span>
          <ConductorStatusBadge status={props.run.status} label={workflowStatusLabel(props.run.status, props.t)} />
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
        </span>
      </button>
      <div className="sr-only" role="status" aria-live="polite">
        {props.run.title}: {workflowStatusLabel(props.run.status, props.t)}, {progress.completed}/{progress.total}
      </div>
      {open ? (
        <div className="conversation-workflow-detail">
          <div className="conversation-workflow-meta">
            <span><strong>{props.t("workflowProgress")}</strong>{progress.completed}/{progress.total}</span>
            <span><strong>{props.t("workflowCurrentPhase")}</strong>{currentNode?.title ?? workflowStatusLabel(props.run.status, props.t)}</span>
            <span><strong>{props.t("conductorParallelism")}</strong>{props.run.spec.maxParallel}</span>
          </div>
          {nodes.isError ? <TaskSectionError t={props.t} onRetry={() => void nodes.refetch()} /> : (
            <ConductorFlow
              compact
              runId={props.run.id}
              nodes={props.run.spec.nodes}
              states={nodes.data ?? []}
              selectedNodeId={selectedNode?.id ?? null}
              statusLabel={(status) => workflowNodeStatusLabel(status, props.t)}
              attemptLabel={props.t("attempt")}
              liveLabel={props.t("conductorLive")}
              onSelectNode={(node) => setSelectedNodeId(node.id)}
            />
          )}
          {selectedNode !== null ? (
            <section className="conversation-workflow-node">
              <header>
                <div>
                  <span>{selectedNode.executionClass === "read" ? props.t("workflowRead") : props.t("workflowWrite")}</span>
                  <h4>{selectedNode.title}</h4>
                </div>
                {selectedState !== null ? (
                  <ConductorStatusBadge
                    status={selectedState.status}
                    label={workflowNodeStatusLabel(selectedState.status, props.t)}
                  />
                ) : null}
              </header>
              {selectedState?.error ? <Alert><AlertDescription>{selectedState.error}</AlertDescription></Alert> : null}
              <div className="conversation-workflow-node-output">
                <strong>{props.t("workflowNodeOutput")}</strong>
                {selectedState?.output
                  ? <AssistantResult content={selectedState.output} t={props.t} />
                  : <p>{props.t("workflowNoOutput")}</p>}
              </div>
              {selectedAttempts.length > 0 ? (
                <div className="conversation-workflow-attempts">
                  {selectedAttempts.map((attempt) => <ConductorAttempt key={`${attempt.nodeId}-${attempt.attempt}`} attempt={attempt} t={props.t} />)}
                </div>
              ) : null}
            </section>
          ) : null}
          {retryRuns.length > 0 ? (
            <div className="conversation-workflow-retries">
              <strong>{props.t(planExecution ? "planExecutionHistory" : "workflowRetryHistory")}</strong>
              {retryRuns.map((run) => <span key={run.id}>{run.title} · {workflowStatusLabel(run.status, props.t)}</span>)}
            </div>
          ) : null}
          {error !== null ? <Alert><AlertDescription>{error}</AlertDescription></Alert> : null}
          {!planExecution && (props.run.status === "failed" || props.run.status === "cancelled") ? (
            <footer className="conversation-workflow-actions">
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                <Icon name="refresh" size={14} />
                {retrying ? props.t("workflowRetrying") : props.t("workflowRetry")}
              </Button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function MessageEditor({ initialContent, t, onSave, onCancel }: {
  initialContent: string;
  t: T;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialContent);
  const trimmed = value.trim();
  const submit = () => {
    if (trimmed === "") return;
    onSave(trimmed);
  };
  return (
    <div className="message-editor">
      <ComposerEditor
        className="message-editor-field"
        value={value}
        ariaLabel={t("editMessage")}
        autoFocus
        onChange={setValue}
        onSubmitShortcut={submit}
        onEscape={onCancel}
      />
      <div className="message-editor-footer">
        <span className="message-editor-hint">{t("editMessageHint")}</span>
        <div className="message-editor-buttons">
          <Button className="font-normal" type="button" variant="ghost" size="sm" onClick={onCancel}>{t("cancel")}</Button>
          <Button className="font-normal" type="button" size="sm" disabled={trimmed === ""} onClick={submit}>{t("editMessageSave")}</Button>
        </div>
      </div>
    </div>
  );
}

function UserMessageContent({ content, links = knownPlatformLinks(content) }: { content: string; links?: ReturnType<typeof knownPlatformLinks> }) {
  if (links.length === 0) return <div className="message-user-content">{content}</div>;
  const parts = platformLinkSegments(content);
  return <div className="message-user-content has-platform-links">
    {parts.map((part, index) => part.type === "link"
      ? <PlatformLinkCard key={`${part.value.url}-${index}`} link={part.value} appearance="message" />
      : part.value !== "" ? <span className="message-user-text" key={index}>{part.value}</span> : null)}
  </div>;
}

function TurnNavigator(props: {
  turns: ConversationTurn[];
  activeTurnId: string | null;
  t: T;
  onNavigate(turn: ConversationTurn): void;
}) {
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);
  if (props.turns.length === 0) return null;
  const hoveredIndex = props.turns.findIndex(({ messageId }) => messageId === hoveredTurnId);
  return (
    <nav
      className="turn-navigator"
      aria-label={props.t("turnNavigation")}
      data-hovering={hoveredIndex >= 0 ? "true" : undefined}
      onPointerLeave={() => setHoveredTurnId(null)}
    >
      {props.turns.map((turn, index) => {
        const label = turnLabel(props.t, index + 1);
        const previewId = `turn-preview-${turn.messageId}`;
        const hoverDistance = turnHoverDistance(index, hoveredIndex);
        return (
          <div className="turn-navigator-item" key={turn.messageId}>
            <button
              type="button"
              className="turn-navigator-button"
              aria-label={label}
              aria-current={props.activeTurnId === turn.messageId ? "step" : undefined}
              aria-describedby={previewId}
              data-hover-distance={hoverDistance ?? undefined}
              onPointerEnter={() => setHoveredTurnId(turn.messageId)}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) setHoveredTurnId(turn.messageId);
              }}
              onBlur={() => setHoveredTurnId((current) => current === turn.messageId ? null : current)}
              onClick={() => props.onNavigate(turn)}
            >
              <span className="turn-navigator-mark" aria-hidden="true" />
            </button>
            <div className="turn-navigator-preview" id={previewId} role="tooltip">
              <span className="turn-navigator-question">{turn.question}</span>
              {turn.answer !== null
                ? (
                    <div className="turn-navigator-answer">
                      <MarkdownMessage
                        compact
                        content={turn.answer}
                        copyLabel={props.t("copyCode")}
                        copiedLabel={props.t("copied")}
                      />
                    </div>
                  )
                : null}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function turnTargetId(messageId: string): string {
  return `turn-${messageId}`;
}

export function conversationTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        messageId: message.id,
        targetId: turnTargetId(message.id),
        question: visibleMessageContent(message.content).trim(),
        answer: null,
      });
      continue;
    }
    if (message.role !== "assistant" || turns.length === 0) continue;
    const answer = visibleMessageContent(message.content).trim();
    if (answer !== "") turns[turns.length - 1]!.answer = answer;
  }
  return turns;
}

export function persistedAssistantMatchesStream(messages: ChatMessage[], streamed: string): boolean {
  if (streamed === "") return false;
  const latest = messages.at(-1);
  if (latest?.role !== "assistant") return false;
  return visibleMessageContent(latest.content).startsWith(streamed);
}

export function activeTurnIndex(turnTops: number[], threshold: number): number {
  if (turnTops.length === 0) return -1;
  let active = 0;
  for (const [index, top] of turnTops.entries()) {
    if (top > threshold) break;
    active = index;
  }
  return active;
}

export function turnHoverDistance(index: number, hoveredIndex: number): number | null {
  if (hoveredIndex < 0) return null;
  const distance = Math.abs(index - hoveredIndex);
  return distance <= 3 ? distance : null;
}

export function activeTurnDuringScroll(
  visibleTurnId: string | null,
  navigationTargetId: string | null,
): string | null {
  return navigationTargetId ?? visibleTurnId;
}

function activeTurnForScroller(
  scroller: HTMLDivElement,
  turns: ConversationTurn[],
): string | null {
  if (turns.length === 0) return null;
  const scrollerBounds = scroller.getBoundingClientRect();
  const threshold = scrollerBounds.top + Math.min(140, scrollerBounds.height * 0.24);
  const visibleTurns = turns.flatMap((turn) => {
    const target = document.getElementById(turn.targetId);
    return target === null
      ? []
      : [{ messageId: turn.messageId, top: target.getBoundingClientRect().top }];
  });
  const activeIndex = activeTurnIndex(
    visibleTurns.map(({ top }) => top),
    threshold,
  );
  return visibleTurns[activeIndex]?.messageId ?? turns[0]?.messageId ?? null;
}

function MessageAttachments(props: {
  attachments: StoredAttachment[];
  onPreview(attachment: StoredAttachment): void;
}) {
  const { attachments, onPreview } = props;
  if (attachments.length === 0) return null;
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => attachment.mimeType.startsWith("image/")
        ? <MessageImageAttachment attachment={attachment} key={attachment.id} onPreview={() => onPreview(attachment)} />
        : (
          <Button variant="secondary" key={attachment.id} onClick={() => void window.piWork.attachment.open(attachment.id)}>
            <Icon name="file" />
            <span>{attachment.name}<small>{attachmentDescription(attachment)}</small></span>
          </Button>
        ))}
    </div>
  );
}

function MessageImageAttachment(props: {
  attachment: StoredAttachment;
  onPreview(): void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (typeof window.piWork.attachment.preview !== "function") return;
    let active = true;
    void window.piWork.attachment.preview(props.attachment.id)
      .then((url) => {
        if (active) setImageUrl(url);
      })
      .catch(() => {
        if (active) setThumbnailFailed(true);
      });
    return () => {
      active = false;
    };
  }, [props.attachment.id]);

  return (
    <button
      type="button"
      className="message-image-attachment"
      onClick={props.onPreview}
      aria-label={`Preview ${props.attachment.name}`}
      title={props.attachment.name}
    >
      <span className="message-image-thumbnail">
        {imageUrl !== null && !thumbnailFailed
          ? <img src={imageUrl} alt="" onError={() => setThumbnailFailed(true)} />
          : <Icon name="eye" />}
      </span>
    </button>
  );
}

export function isNearBottom(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">, threshold = 40): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function turnLabel(t: T, turn: number): string {
  return t("turn") === "第" ? `第 ${turn} 轮` : `${t("turn")} ${turn}`;
}

export function orderedProcessActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((left, right) => {
    const leftSequence = typeof left.metadata.sequence === "number" ? left.metadata.sequence : null;
    const rightSequence = typeof right.metadata.sequence === "number" ? right.metadata.sequence : null;
    if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) return leftSequence - rightSequence;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function HistoricalProcess({ activities, animateCollapse = false, t }: {
  activities: Activity[];
  animateCollapse?: boolean;
  t: T;
}) {
  const ordered = orderedProcessActivities(activities);
  const animateOnMount = useRef(animateCollapse).current;
  const hasActivities = ordered.length > 0;
  const [open, setOpen] = useState(animateOnMount);
  const groupRef = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const group = groupRef.current;
    const content = contentRef.current;
    if (!animateOnMount || !hasActivities || group === null || content === null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const summary = group.querySelector(":scope > summary");
    const timeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        setOpen(false);
        gsap.set([group, content, summary], { clearProps: "all" });
      },
    });
    timeline
      .to(content, {
        height: 0,
        autoAlpha: 0,
        y: -6,
        duration: reduceMotion ? 0 : 0.26,
        ease: "power3.inOut",
      }, 0)
      .to(group, {
        marginBottom: 8,
        duration: reduceMotion ? 0 : 0.26,
        ease: "power3.inOut",
      }, 0)
      .fromTo(summary, {
        scale: 0.985,
      }, {
        scale: 1,
        transformOrigin: "left center",
        duration: reduceMotion ? 0 : 0.2,
        ease: "power2.out",
      }, reduceMotion ? 0 : 0.12);
  }, { scope: groupRef });
  if (!hasActivities) return null;
  const thoughts = ordered.filter(({ kind }) => kind === "thinking").length;
  const tools = ordered.length - thoughts;
  return (
    <details
      ref={groupRef}
      className="process-group"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon name="chevron-down" size={14} className="process-group-chevron" />
        <span>{processSummary(tools, thoughts, t)}</span>
      </summary>
      <div ref={contentRef} className="process-group-content">
        <div className="process-group-content-inner">
          {ordered.map((activity) => (
            activity.kind === "thinking"
              ? <ThoughtProcessCard activity={activity} key={activity.id} t={t} />
              : <ToolProcessCard key={activity.id} tool={toolFromActivity(activity)} t={t} />
          ))}
        </div>
      </div>
    </details>
  );
}

export function processSummary(tools: number, thoughts: number, t: T): string {
  const parts = [];
  if (tools > 0) parts.push(`${tools} ${t(tools === 1 ? "toolCall" : "toolCalls")}`);
  if (thoughts > 0) parts.push(`${thoughts} ${t(thoughts === 1 ? "thoughtSegment" : "thoughtSegments")}`);
  return parts.join(t("processSummarySeparator"));
}

function AssistantResult({ content, t, streaming = false }: { content: string; t: T; streaming?: boolean }) {
  const resultRef = useRef<HTMLElement>(null);
  const revealedNodesRef = useRef(new WeakSet<Element>());
  const mountedRef = useRef(false);
  useGSAP(() => {
    if (!streaming || resultRef.current === null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const result = resultRef.current;
    const markdown = result.querySelector(":scope > .markdown-message");
    const nodes = markdown === null ? [] : Array.from(markdown.children);
    const freshNodes = nodes.filter((node) => !revealedNodesRef.current.has(node));
    freshNodes.forEach((node) => revealedNodesRef.current.add(node));

    if (!mountedRef.current) {
      mountedRef.current = true;
      const timeline = gsap.timeline({ defaults: { overwrite: "auto" } });
      timeline.fromTo(result, {
        autoAlpha: 0,
        y: 8,
      }, {
        autoAlpha: 1,
        y: 0,
        duration: reduceMotion ? 0 : 0.24,
        ease: "power3.out",
      }, 0);
    }

    if (freshNodes.length > 0) {
      gsap.fromTo(freshNodes, {
        autoAlpha: reduceMotion ? 1 : 0.35,
        y: reduceMotion ? 0 : 5,
      }, {
        autoAlpha: 1,
        y: 0,
        duration: reduceMotion ? 0 : 0.2,
        stagger: reduceMotion ? 0 : 0.025,
        ease: "power2.out",
        overwrite: "auto",
        clearProps: "opacity,visibility,transform",
      });
    }
  }, {
    scope: resultRef,
    dependencies: [content, streaming],
  });
  return (
    <section ref={resultRef} className={`assistant-result${streaming ? " is-streaming" : ""}`} aria-label={t("result")}>
      <MarkdownMessage streaming={streaming} content={content} copyLabel={t("copyCode")} copiedLabel={t("copied")} />
    </section>
  );
}

const runLoadingDelays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function RunLoadingState({ label }: { label: string }) {
  const [elapsedDeciseconds, setElapsedDeciseconds] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsedDeciseconds((current) => current + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  useGSAP(() => {
    if (rootRef.current === null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.fromTo(rootRef.current, {
      autoAlpha: reduceMotion ? 1 : 0,
      y: reduceMotion ? 0 : 5,
    }, {
      autoAlpha: 1,
      y: 0,
      duration: reduceMotion ? 0 : 0.2,
      ease: "power3.out",
    });
  }, { scope: rootRef });

  const totalSeconds = elapsedDeciseconds / 10;
  const elapsed = totalSeconds < 60
    ? `${totalSeconds.toFixed(1)}s`
    : `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`;

  return (
    <div ref={rootRef} className="run-loading-state" aria-hidden="true">
      <span className="run-loading-grid" aria-hidden="true">
        {runLoadingDelays.map((delay, index) => (
          <span
            key={index}
            style={{ "--run-loading-delay": `${delay}ms` } as CSSProperties}
          />
        ))}
      </span>
      <span className="run-loading-label">{label}</span>
      <span className="run-loading-elapsed">{elapsed}</span>
    </div>
  );
}

function ThoughtProcessCard({ activity, t, open = false, collapse = false, label }: {
  activity: Pick<Activity, "id" | "detail">;
  t: T;
  open?: boolean;
  collapse?: boolean;
  label?: string;
}) {
  const preview = summarizeThinkingPreview(activity.detail);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousCollapseRef = useRef(collapse);
  const collapsingRef = useRef(false);
  const [expanded, setExpanded] = useState(open && !collapse);

  useEffect(() => {
    if (collapse) return;
    setExpanded(open);
  }, [collapse, open]);

  useGSAP(() => {
    const details = detailsRef.current;
    const content = contentRef.current;
    const justCollapsed = !previousCollapseRef.current && collapse;
    previousCollapseRef.current = collapse;
    if (!justCollapsed || details === null || content === null || !details.open) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const summary = details.querySelector(":scope > summary");
    collapsingRef.current = true;
    const timeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        setExpanded(false);
        collapsingRef.current = false;
        gsap.set([content, summary], { clearProps: "all" });
      },
    });
    timeline
      .to(content, {
        height: 0,
        autoAlpha: 0,
        y: -5,
        duration: reduceMotion ? 0 : 0.24,
        ease: "power3.inOut",
      }, 0)
      .fromTo(summary, {
        scale: 0.985,
      }, {
        scale: 1,
        transformOrigin: "left center",
        duration: reduceMotion ? 0 : 0.18,
        ease: "power2.out",
      }, reduceMotion ? 0 : 0.12);
  }, {
    scope: detailsRef,
    dependencies: [collapse],
  });

  return (
    <details
      ref={detailsRef}
      className="thinking-block"
      open={expanded}
      onToggle={(event) => {
        if (!collapsingRef.current) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="thinking-marker"><Icon name="brain" size={14} /><Icon name="chevron-down" size={14} className="thinking-chevron" /></span>
        <span className="thinking-label">{label ?? t("thoughtProcess")}</span>
        {preview ? <span className="thinking-preview" title={preview}>{preview}</span> : null}
      </summary>
      <div ref={contentRef} className="thinking-content"><MarkdownMessage compact content={activity.detail} copyLabel={t("copyCode")} copiedLabel={t("copied")} /></div>
    </details>
  );
}

function LiveProcessView({ process, collapse, t }: { process: LiveProcess; collapse: boolean; t: T }) {
  return (
    <div className="live-process">
      {process.timeline.map((item, index) => {
        if (item.kind === "thinking") {
          const thought = process.thoughts.find(({ segmentId }) => segmentId === item.segmentId);
          if (thought === undefined || thought.content.trim() === "") return null;
          return (
            <LiveProcessItem key={`thinking-${thought.segmentId}`} last={index === process.timeline.length - 1}>
              <ThoughtProcessCard
                activity={{ id: String(thought.segmentId), detail: thought.content }}
                t={t}
                open={!thought.complete}
                collapse={collapse}
                label={thought.complete ? t("thoughtProcess") : t("thinkingInProgress")}
              />
            </LiveProcessItem>
          );
        }
        const tool = process.tools.find(({ toolCallId }) => toolCallId === item.toolCallId);
        return tool === undefined ? null : (
          <LiveProcessItem key={`tool-${tool.toolCallId}`} last={index === process.timeline.length - 1}>
            <ToolProcessCard animate collapse={collapse} tool={tool} t={t} />
          </LiveProcessItem>
        );
      })}
      {process.notice ? <div className="process-notice">{process.notice}</div> : null}
    </div>
  );
}

function LiveProcessItem({ children, last }: { children: ReactNode; last: boolean }) {
  const itemRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const item = itemRef.current;
    if (item === null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeline = gsap.timeline({ defaults: { overwrite: "auto" } });
    timeline
      .fromTo(item, {
        autoAlpha: reduceMotion ? 1 : 0,
        y: reduceMotion ? 0 : -9,
        clipPath: reduceMotion ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
      }, {
        autoAlpha: 1,
        y: 0,
        clipPath: "inset(0 0 0% 0)",
        duration: reduceMotion ? 0 : 0.28,
        ease: "power3.out",
      }, 0)
      .fromTo(item, {
        "--process-line-scale": reduceMotion ? 1 : 0,
      }, {
        "--process-line-scale": 1,
        duration: reduceMotion ? 0 : 0.32,
        ease: "power2.out",
      }, reduceMotion ? 0 : 0.08);
  }, { scope: itemRef });
  return <div ref={itemRef} className={`live-process-item${last ? " is-last" : ""}`}>{children}</div>;
}

function ToolProcessCard({ tool, t, animate = false, collapse = false }: { tool: LiveTool; t: T; animate?: boolean; collapse?: boolean }) {
  const preview = toolPreview(tool.arguments);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const previousCompleteRef = useRef(tool.complete);
  const previousCollapseRef = useRef(collapse);
  const collapsingRef = useRef(false);
  const [open, setOpen] = useState(false);

  useGSAP(() => {
    const details = detailsRef.current;
    const expanded = expandedRef.current;
    if (!animate || tool.complete || expanded === null || details === null || !details.open) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.fromTo(expanded, {
      height: 0,
      autoAlpha: reduceMotion ? 1 : 0,
      y: reduceMotion ? 0 : -4,
    }, {
      height: "auto",
      autoAlpha: 1,
      y: 0,
      duration: reduceMotion ? 0 : 0.24,
      ease: "power3.out",
      clearProps: "height,opacity,visibility,transform",
    });
  }, { scope: detailsRef });

  useGSAP(() => {
    const details = detailsRef.current;
    const expanded = expandedRef.current;
    const justCompleted = !previousCompleteRef.current && tool.complete;
    previousCompleteRef.current = tool.complete;
    if (!animate || collapse || !justCompleted || details === null || expanded === null || !details.open) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const summary = details.querySelector(":scope > summary");
    collapsingRef.current = true;
    setOpen(true);
    const timeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        setOpen(false);
        collapsingRef.current = false;
        gsap.set([expanded, summary], { clearProps: "all" });
      },
    });
    timeline
      .to(expanded, {
        height: 0,
        autoAlpha: 0,
        y: -5,
        duration: reduceMotion ? 0 : 0.24,
        ease: "power3.inOut",
      }, 0)
      .fromTo(summary, {
        scale: 0.985,
      }, {
        scale: 1,
        transformOrigin: "left center",
        duration: reduceMotion ? 0 : 0.18,
        ease: "power2.out",
      }, reduceMotion ? 0 : 0.12);
  }, {
    scope: detailsRef,
    dependencies: [tool.complete],
  });

  useGSAP(() => {
    const details = detailsRef.current;
    const expanded = expandedRef.current;
    const justCollapsed = !previousCollapseRef.current && collapse;
    previousCollapseRef.current = collapse;
    if (!animate || !justCollapsed || details === null || expanded === null || !details.open) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const summary = details.querySelector(":scope > summary");
    collapsingRef.current = true;
    const timeline = gsap.timeline({
      defaults: { overwrite: "auto" },
      onComplete: () => {
        setOpen(false);
        collapsingRef.current = false;
        gsap.set([expanded, summary], { clearProps: "all" });
      },
    });
    timeline
      .to(expanded, {
        height: 0,
        autoAlpha: 0,
        y: -5,
        duration: reduceMotion ? 0 : 0.24,
        ease: "power3.inOut",
      }, 0)
      .fromTo(summary, {
        scale: 0.985,
      }, {
        scale: 1,
        transformOrigin: "left center",
        duration: reduceMotion ? 0 : 0.18,
        ease: "power2.out",
      }, reduceMotion ? 0 : 0.12);
  }, {
    scope: detailsRef,
    dependencies: [collapse],
  });

  return (
    <details
      ref={detailsRef}
      className={`tool-status ${tool.complete ? "is-complete" : "is-running"}${tool.failed ? " is-failed" : ""}`}
      open={open}
      onToggle={(event) => {
        if (!collapsingRef.current) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="tool-status-icon"><Icon name={toolIcon(tool.toolName)} size={14} /><Icon name="chevron-down" size={14} className="tool-status-chevron" /></span>
        <span className="tool-status-copy">
          <span className="tool-status-heading">
            <code>{tool.toolName}</code>
            <span className="tool-status-preview" title={preview}>{preview}</span>
            <span className="tool-status-state">
              {tool.complete ? (tool.failed ? t("toolFailed") : t("toolCompleted")) : t("toolRunning")}
            </span>
          </span>
          {tool.detail ? <span className="tool-status-detail" title={tool.detail}>{tool.detail}</span> : null}
        </span>
      </summary>
      <div ref={expandedRef} className="tool-status-expanded">
        <ToolProcessSection label={t("activityToolCall")} value={tool.arguments} />
        {tool.output !== undefined ? <ToolProcessSection label={t("activityToolResult")} value={tool.output} error={tool.failed} /> : null}
      </div>
    </details>
  );
}

function ToolProcessSection(props: { label: string; value: unknown; error?: boolean }) {
  return (
    <section className={`tool-status-section${props.error ? " is-error" : ""}`}>
      <span>{props.label}</span>
      <pre>{formatProcessValue(props.value)}</pre>
    </section>
  );
}

export function toolFromActivity(activity: Pick<Activity, "id" | "title" | "detail" | "metadata">): LiveTool {
  const metadata = activity.metadata;
  const output = metadata.result ?? metadata.output;
  return {
    toolCallId: typeof metadata.toolCallId === "string" ? metadata.toolCallId : activity.id,
    toolName: typeof metadata.toolName === "string" ? metadata.toolName : activity.title,
    arguments: processArguments(metadata.arguments ?? metadata.args),
    detail: activity.detail,
    output,
    complete: true,
    failed: metadata.isError === true,
  };
}

export function reduceLiveProcess(current: LiveProcess, kind: string, payload: Record<string, unknown>, t: T): LiveProcess {
  if (kind === "thinking") {
    const contentIndex = typeof payload.contentIndex === "number" ? payload.contentIndex : 0;
    const thought = current.thoughts.findLast((item) => item.contentIndex === contentIndex && !item.complete);
    if (payload.phase === "start") {
      const segmentId = nextThoughtSegmentId(current.thoughts);
      return {
        ...current,
        timeline: [...current.timeline, { kind: "thinking", segmentId }],
        thoughts: [...current.thoughts, { segmentId, contentIndex, content: "", complete: false }],
      };
    }
    if (payload.phase === "delta" && typeof payload.delta === "string") {
      const next = thought ?? {
        segmentId: nextThoughtSegmentId(current.thoughts),
        contentIndex,
        content: "",
        complete: false,
      };
      return {
        ...current,
        timeline: thought === undefined ? [...current.timeline, { kind: "thinking", segmentId: next.segmentId }] : current.timeline,
        thoughts: [...current.thoughts.filter((item) => item.segmentId !== next.segmentId), { ...next, content: `${next.content}${payload.delta}` }],
      };
    }
    if (payload.phase === "end") {
      const next = thought ?? {
        segmentId: nextThoughtSegmentId(current.thoughts),
        contentIndex,
        content: "",
        complete: false,
      };
      const content = typeof payload.content === "string" ? payload.content : next.content;
      return {
        ...current,
        timeline: thought === undefined ? [...current.timeline, { kind: "thinking", segmentId: next.segmentId }] : current.timeline,
        thoughts: [...current.thoughts.filter((item) => item.segmentId !== next.segmentId), { ...next, content, complete: true }],
      };
    }
  }
  if (kind === "tool_call" && typeof payload.toolCallId === "string") return {
    ...current,
    timeline: appendLiveProcessItem(current.timeline, { kind: "tool", toolCallId: payload.toolCallId }),
    tools: [...current.tools.filter((tool) => tool.toolCallId !== payload.toolCallId), {
      toolCallId: payload.toolCallId,
      toolName: String(payload.toolName ?? "tool"),
      arguments: processArguments(payload.arguments),
      detail: "",
      output: undefined,
      complete: false,
      failed: false,
    }],
  };
  if ((kind === "tool_update" || kind === "tool_result") && typeof payload.toolCallId === "string") {
    const existing = current.tools.find((tool) => tool.toolCallId === payload.toolCallId);
    const tool = existing ?? {
      toolCallId: payload.toolCallId,
      toolName: String(payload.toolName ?? "tool"),
      arguments: processArguments(payload.arguments),
      detail: "",
      output: undefined,
      complete: false,
      failed: false,
    };
    const output = kind === "tool_result" ? payload.result : payload.output;
    const detail = summarizeProcessValue(output);
    return {
      ...current,
      timeline: appendLiveProcessItem(current.timeline, { kind: "tool", toolCallId: payload.toolCallId }),
      tools: [...current.tools.filter((item) => item.toolCallId !== payload.toolCallId), {
        ...tool,
        toolName: String(payload.toolName ?? tool.toolName),
        arguments: Object.keys(processArguments(payload.arguments)).length > 0 ? processArguments(payload.arguments) : tool.arguments,
        detail: detail || tool.detail,
        output,
        complete: kind === "tool_result",
        failed: kind === "tool_result" && payload.isError === true,
      }],
    };
  }
  if (kind === "runtime") {
    if (payload.state === "queue_clear" || payload.state === "retry_complete") return { ...current, notice: null };
    const notice = payload.state === "queued"
      ? t("queued")
      : payload.state === "retrying" || payload.state === "summarization_retry"
        ? t("retrying")
        : payload.state === "compacting"
          ? t("compacting")
          : payload.state === "compacted"
            ? t("contextCompacted")
            : null;
    return notice === null ? current : { ...current, notice };
  }
  return current;
}

function appendLiveProcessItem(items: LiveProcessItem[], next: LiveProcessItem): LiveProcessItem[] {
  const exists = items.some((item) => {
    if (item.kind === "thinking" && next.kind === "thinking") {
      return item.segmentId === next.segmentId;
    }
    if (item.kind === "tool" && next.kind === "tool") {
      return item.toolCallId === next.toolCallId;
    }
    return false;
  });
  return exists ? items : [...items, next];
}

function nextThoughtSegmentId(thoughts: LiveThought[]): number {
  return thoughts.reduce((highest, thought) => Math.max(highest, thought.segmentId), -1) + 1;
}

function toolIcon(toolName: string): IconName {
  const n = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const has = (...keys: string[]) => keys.some((key) => n.includes(key));
  // Fetching a specific URL / page.
  if (has("fetch", "http", "url", "curl", "scrape", "crawl", "browse", "navigate", "visit", "open_page")) return "browser";
  // Searching the web or content (grep, web_search, get_search_content…).
  if (has("search", "grep", "ripgrep", "query", "lookup", "find_text")) return "search";
  // Listing / exploring the filesystem.
  if (has("glob", "find_file", "list_dir", "list_files", "readdir", "tree")) return "folder-search";
  if (has("ls", "list", "dir")) return "workspace";
  // Task / todo management (before edit, so TodoWrite/update_plan don't read as edits).
  if (has("todo", "task", "plan")) return "list-todo";
  // Editing or writing files.
  if (has("edit", "write", "create", "update", "patch", "replace", "apply", "modify", "insert", "append")) return "file-pen";
  // Reading / viewing files.
  if (has("read", "cat", "view", "open", "get_file", "file")) return "file-text";
  // Removing files.
  if (has("delete", "remove", "unlink", "rm_")) return "file-x";
  // Shell execution (bash, sh, exec, run…).
  if (has("bash", "shell", "sh", "zsh", "exec", "command", "run", "terminal", "process")) return "terminal";
  return "terminal";
}

function processArguments(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function toolPreview(input?: Record<string, unknown>): string {
  if (input === undefined || input === null) return "";
  for (const key of ["command", "path", "file_path", "query", "pattern", "url", "prompt"]) {
    const value = summarizeToolValue(input[key]);
    if (value) return truncateProcessValue(value, 96);
  }
  const firstValue = Object.values(input).map(summarizeToolValue).find(Boolean);
  return firstValue ? truncateProcessValue(firstValue, 96) : "";
}

export function summarizeProcessValue(value: unknown): string {
  const parsed = typeof value === "string" ? parseToolValue(value) : value;
  const summary = summarizeToolValue(parsed);
  return summary ? truncateProcessValue(summary, 160) : "";
}

export function summarizeThinkingPreview(detail: unknown): string {
  if (typeof detail !== "string") return summarizeProcessValue(detail);
  const stripped = stripInlineMarkdown(detail).replace(/\s+/g, " ").trim();
  return truncateProcessValue(stripped, 160);
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*+/g, "")
    .replace(/`+/g, "");
}

function formatProcessValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseToolValue(value: string): unknown {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact.startsWith("{") && !compact.startsWith("[")) return compact;
  try {
    return JSON.parse(compact);
  } catch {
    return compact;
  }
}

function summarizeToolValue(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) {
    return value.map(summarizeToolValue).filter(Boolean).slice(0, 2).join(" · ");
  }
  if (value === null || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["text", "message", "summary", "title", "query", "url", "path", "command"]) {
    const candidate = summarizeToolValue(record[key]);
    if (candidate) return candidate;
  }
  for (const key of ["content", "output", "result", "data", "details"]) {
    const candidate = summarizeToolValue(record[key]);
    if (candidate) return candidate;
  }
  return "";
}

function truncateProcessValue(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

function TaskPrimaryWorkspace(props: {
  session: Session;
  workspace: Workspace;
  mode: Exclude<TaskMode, "conversation">;
  artifacts: Artifact[];
  artifactsLoading: boolean;
  artifactsError: boolean;
  publishing: boolean;
  completing: boolean;
  t: T;
  onPublish(artifact: Artifact): Promise<void>;
  onPublishAll(): void;
  publishOutcome: { published: number; failed: number } | null;
  publishDestination: string | null;
  onRetryArtifacts(): void;
  selectedConductorRunId: string;
  onSelectConductorRun(runId: string): void;
  selectedConductorNode: SelectedConductorNode | null;
  onSelectConductorNode(node: SelectedConductorNode): void;
  onComplete(): void;
}) {
  const unpublished = props.artifacts.filter(({ publishedPath }) => publishedPath === null);
  return (
    <section className={`primary-workspace primary-workspace-${props.mode}`} aria-label={props.t(props.mode)}>
      <div className="primary-workspace-inner">
        <div className="primary-workspace-body">
        {props.mode === "orchestration" ? (
          <div className="primary-orchestration">
            <ConductorPanel
              session={props.session}
              workspace={props.workspace}
              selectedRunId={props.selectedConductorRunId}
              t={props.t}
              onSelectRun={props.onSelectConductorRun}
            />
            <ConductorWorkspace
              session={props.session}
              workspace={props.workspace}
              selectedRunId={props.selectedConductorRunId}
              selectedNode={props.selectedConductorNode}
              t={props.t}
              onSelectRun={props.onSelectConductorRun}
              onSelectNode={props.onSelectConductorNode}
            />
          </div>
        ) : null}
        {props.mode === "artifacts" ? (
          <InspectorSection title={props.t("results")}>
            {props.artifactsError ? <TaskSectionError t={props.t} onRetry={props.onRetryArtifacts} /> : props.artifactsLoading ? <InspectorLoading t={props.t} /> : props.artifacts.length === 0 ? (
              <div className="inspector-empty"><Icon name="file-output" /><p>{props.t("resultEmpty")}</p></div>
            ) : (
              <div className="artifact-list">
                <Alert className="publish-note"><AlertDescription>{props.t("publishTarget")} {props.t("publishIrreversible")}</AlertDescription></Alert>
                {props.artifacts.map((artifact) => <ArtifactPreview key={artifact.id} artifact={artifact} t={props.t} onPublish={() => props.onPublish(artifact)} />)}
                <div className="publish-outcome-live" role="status" aria-live="polite">
                  {props.publishOutcome !== null ? (
                    <div className={`publish-outcome ${props.publishOutcome.failed > 0 ? "partial" : ""}`}>
                      <Icon name={props.publishOutcome.failed > 0 ? "alert" : "check-circle"} size={16} />
                      <div>
                        <strong>{props.publishOutcome.failed > 0 ? props.t("publishPartial") : props.t("publishSuccess")}</strong>
                        <p><span>{props.t("publishedFilesCount")}</span><code>{props.publishOutcome.published}</code></p>
                        {props.publishDestination !== null ? <p><span>{props.t("publishDestinationLabel")}</span><code>{props.publishDestination}</code></p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                {unpublished.length > 1 ? <Button variant="outline" disabled={props.publishing} onClick={() => props.onPublishAll()}>{props.publishing ? props.t("sending") : props.t("publishAll")}</Button> : null}
              </div>
            )}
            {props.session.status !== "completed" ? <Button className="complete-task-button" variant="secondary" disabled={props.completing} onClick={props.onComplete}><Icon name="check-circle" />{props.completing ? props.t("sending") : props.t("completeTask")}</Button> : null}
          </InspectorSection>
        ) : null}
        </div>
      </div>
    </section>
  );
}

function TaskInspector(props: {
  panel: Exclude<ContextPanel, null>;
  plan: PlanRevision | null;
  planRevisions: PlanRevision[];
  planExecutions: PlanExecutionDetail[];
  session: Session;
  workspace: Workspace | null;
  statuses: StatusDefinition[];
  labels: Label[];
  activities: Activity[];
  activityLoading: boolean;
  activityError: boolean;
  approvals: ToolApproval[];
  t: T;
  onClose(): void;
  inspectorWidth: number;
  minimumWidth: number;
  maximumWidth: number;
  defaultWidth: number;
  onResize(width: number, commit: boolean): void;
  selectedConductorNode: SelectedConductorNode | null;
  permissionMode: PermissionMode;
  workingDirectory: string;
  outputPath: string | null;
  approvalRequired: boolean;
  planHistorical: boolean;
  retryAllowed: boolean;
  approving: boolean;
  executing: boolean;
  retrying: boolean;
  editable: boolean;
  savingPlan: boolean;
  onApprovePlan(action: PlanApprovalAction): void;
  onExecutePlan(mode: PlanExecutionMode): void;
  onRetryPlan(): void;
  onSavePlan(input: Omit<PlanRevisionEditInput, "taskId">): void;
  onOpenOrchestrationRun(runId: string): void;
  onUpdateBrief(value: { title?: string; goal?: string }): Promise<void>;
  onUpdateSession(value: Record<string, unknown>): void;
  onResolveApproval(approvalId: string, approved: boolean): void;
  onRetryActivity(): void;
}) {
  const resizeState = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    latestWidth: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [title, setTitle] = useState(props.session.title);
  const [goal, setGoal] = useState(props.session.goal);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(props.session.title);
    setGoal(props.session.goal);
  }, [props.session.goal, props.session.title]);
  useEffect(() => {
    document.documentElement.dataset.inspectorResizing = String(resizing);
    return () => {
      delete document.documentElement.dataset.inspectorResizing;
    };
  }, [resizing]);

  const finishResize = (pointerId: number) => {
    const state = resizeState.current;
    if (state === null || state.pointerId !== pointerId) return;
    resizeState.current = null;
    setResizing(false);
    props.onResize(state.latestWidth, true);
  };
  return (
    <aside className={`task-inspector${props.panel === "plan" ? " task-inspector-plan" : ""}`} id="task-inspector">
      <div
        className="inspector-resize-handle"
        role="separator"
        aria-label={props.t("resizeInspector")}
        aria-orientation="vertical"
        aria-valuemin={props.minimumWidth}
        aria-valuemax={props.maximumWidth}
        aria-valuenow={props.inspectorWidth}
        tabIndex={0}
        onDoubleClick={() => props.onResize(props.defaultWidth, true)}
        onKeyDown={(event) => {
          let nextWidth = props.inspectorWidth;
          if (event.key === "ArrowLeft") nextWidth += 16;
          else if (event.key === "ArrowRight") nextWidth -= 16;
          else if (event.key === "Home") nextWidth = props.minimumWidth;
          else if (event.key === "End") nextWidth = props.maximumWidth;
          else return;
          event.preventDefault();
          props.onResize(nextWidth, true);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: props.inspectorWidth,
            latestWidth: props.inspectorWidth,
          };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const state = resizeState.current;
          if (state === null || state.pointerId !== event.pointerId) return;
          const width = Math.min(
            props.maximumWidth,
            Math.max(props.minimumWidth, Math.round(state.startWidth + state.startX - event.clientX)),
          );
          state.latestWidth = width;
          props.onResize(width, false);
        }}
        onPointerUp={(event) => finishResize(event.pointerId)}
        onPointerCancel={(event) => finishResize(event.pointerId)}
        onLostPointerCapture={(event) => finishResize(event.pointerId)}
      />
      <header className="inspector-execution-header">
        <span className="inspector-panel-title">
          {props.panel === "plan" ? <Icon name="plan" size={14} /> : null}
          {props.t(props.panel === "node" ? "conductorNodeExecution" : props.panel)}
          {props.panel === "plan" && props.plan !== null ? <small>v{props.plan.revision}</small> : null}
        </span>
        <Button variant="ghost" size="icon" aria-label={props.t("closeInspector")} onClick={props.onClose}><Icon name="close" /></Button>
      </header>
      <div className="inspector-body inspector-execution-body">
        {props.panel === "plan" ? (
          props.plan === null ? (
            <div className="inspector-empty"><Icon name="plan" /><p>{props.t("planEmpty")}</p></div>
          ) : (
            <PlanInspector
              plan={props.plan}
              planRevisions={props.planRevisions}
              executions={props.planExecutions}
              approvalRequired={props.approvalRequired}
              historical={props.planHistorical}
              editable={props.editable}
              saving={props.savingPlan}
              t={props.t}
              onSave={props.onSavePlan}
              onOpenOrchestrationRun={props.onOpenOrchestrationRun}
            />
          )
        ) : null}
        {props.panel === "task" ? (
          <div className="inspector-section-stack task-context-panel">
            <InspectorSection title={props.t("taskDescription")}>
              <FieldGroup>
                <Field><FieldLabel>{props.t("taskTitle")}</FieldLabel><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                <Field><FieldLabel>{props.t("goal")}</FieldLabel><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={6} /></Field>
                <Button variant="outline" disabled={saving || !title.trim() || !goal.trim()} onClick={() => {
                  setSaving(true);
                  void props.onUpdateBrief({ title: title.trim(), goal: goal.trim() }).finally(() => setSaving(false));
                }}>{saving ? props.t("saving") : props.t("save")}</Button>
              </FieldGroup>
            </InspectorSection>
            <InspectorSection title={props.t("workStage")}>
              <Select value={props.session.statusId ?? "uncategorized"} onValueChange={(value) => props.onUpdateSession({ statusId: value === "uncategorized" ? null : value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="uncategorized">{props.t("uncategorized")}</SelectItem>
                  {props.statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <div className="system-state-row"><span>{props.t("systemState")}</span><Badge className={`lifecycle-${props.session.status}`}>{lifecycleLabel(props.session, props.t)}</Badge></div>
            </InspectorSection>
            <InspectorSection title={props.t("labels")}>
              <div className="label-picker">
                {props.labels.map((label) => {
                  const active = props.session.labelIds.includes(label.id);
                  return <Button variant={active ? "secondary" : "ghost"} size="sm" key={label.id} onClick={() => props.onUpdateSession({ labelIds: active ? props.session.labelIds.filter((id) => id !== label.id) : [...props.session.labelIds, label.id] })}><span className="label-color" style={{ background: label.color }} />{label.name}</Button>;
                })}
                {props.labels.length === 0 ? <span className="inspector-empty-inline">{props.t("noItems")}</span> : null}
              </div>
            </InspectorSection>
            <InspectorSection title={props.t("authorizedBoundary")}>
              <code className="path-block">{props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("personal")}</code>
            </InspectorSection>
          </div>
        ) : null}
        {props.panel === "activity" ? (
          <InspectorSection title={props.t("activity")}>
            {props.activityError ? <TaskSectionError t={props.t} onRetry={props.onRetryActivity} /> : props.activityLoading ? <InspectorLoading t={props.t} /> : (
              <div className="activity-timeline">
                {props.approvals.map((approval) => <ToolApprovalCard key={approval.approvalId} approval={approval} compact t={props.t} onResolve={(approved) => props.onResolveApproval(approval.approvalId, approved)} />)}
                {props.activities.map((activity) => <ActivityTimelineItem key={activity.id} activity={activity} t={props.t} />)}
                {props.activities.length === 0 && props.approvals.length === 0 ? <div className="inspector-empty"><Icon name="clock" /><p>{props.t("activityEmpty")}</p></div> : null}
              </div>
            )}
          </InspectorSection>
        ) : null}
        {props.panel === "node" && props.workspace !== null && props.selectedConductorNode !== null ? (
          <ConductorNodeExecution
            workspace={props.workspace}
            selectedNode={props.selectedConductorNode}
            t={props.t}
          />
        ) : props.panel === "node" ? (
          <div className="conductor-inspector-empty">
            <Icon name="forward" size={14} />
            <p>{props.t("conductorExecutionPanelEmpty")}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function PlanInspector(props: {
  plan: PlanRevision;
  planRevisions: PlanRevision[];
  executions: PlanExecutionDetail[];
  approvalRequired: boolean;
  historical: boolean;
  editable: boolean;
  saving: boolean;
  t: T;
  onSave(input: Omit<PlanRevisionEditInput, "taskId">): void;
  onOpenOrchestrationRun(runId: string): void;
}) {
  const { plan, t } = props;
  const [editing, setEditing] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [compareToRevisionId, setCompareToRevisionId] = useState(plan.parentRevisionId ?? "");
  const [draft, setDraft] = useState(() => planRevisionEditDraft(plan));
  const [copied, setCopied] = useState(false);
  const content = planRevisionMarkdown(plan);
  const revisionDiff = useQuery({
    queryKey: ["plan-revision-diff", plan.taskId, plan.id, compareToRevisionId],
    queryFn: () => window.piWork.task.getPlanRevisionDiff({
      taskId: plan.taskId,
      revisionId: plan.id,
      compareToRevisionId,
    }),
    enabled: diffing && compareToRevisionId !== "",
  });
  const status = planRevisionStatusLabel(plan, props.approvalRequired, props.historical, t);
  useEffect(() => {
    setEditing(false);
    setDiffing(false);
    setCompareToRevisionId(plan.parentRevisionId ?? "");
    setDraft(planRevisionEditDraft(plan));
  }, [plan.id]);
  const copy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };
  return (
    <section className="plan-panel" aria-label={plan.title}>
      <div className="plan-panel-toolbar">
        <div className="plan-panel-state">
          <span className={`plan-panel-status-dot plan-status-${plan.status}`} />
          <span>{status}</span>
          <span className="plan-panel-state-meta">{plan.steps.length} {t("planSteps")}</span>
        </div>
        <div>
          {props.editable ? (
            <Button variant="ghost" size="sm" aria-pressed={editing} onClick={() => {
              setEditing((value) => !value);
              setDiffing(false);
            }}>
              <Icon name="square-pen" size={14} />
              {plan.status === "approved" ? t("createPlanRevision") : t("editPlan")}
            </Button>
          ) : null}
          {props.planRevisions.length > 1 ? (
            <Button variant="ghost" size="sm" aria-pressed={diffing} onClick={() => {
              setDiffing((value) => !value);
              setEditing(false);
              if (compareToRevisionId === "") {
                setCompareToRevisionId(props.planRevisions.find(({ id }) => id !== plan.id)?.id ?? "");
              }
            }}>
              <Icon name="file-text" size={14} />
              {t("revisionDiff")}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} />
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
      </div>
      <div className="plan-panel-scroll">
        {editing ? (
          <PlanRevisionEditor
            draft={draft}
            sources={plan.sources}
            saving={props.saving}
            t={t}
            onChange={setDraft}
            onCancel={() => {
              setDraft(planRevisionEditDraft(plan));
              setEditing(false);
            }}
            onSave={() => {
              props.onSave({
                parentRevisionId: plan.id,
                ...draft,
              });
            }}
          />
        ) : diffing ? (
          <PlanRevisionDiffView
            plan={plan}
            revisions={props.planRevisions}
            compareToRevisionId={compareToRevisionId}
            diff={revisionDiff.data ?? null}
            loading={revisionDiff.isLoading}
            error={revisionDiff.isError}
            t={t}
            onCompareChange={setCompareToRevisionId}
            onRetry={() => void revisionDiff.refetch()}
          />
        ) : (
          <article className="plan-panel-document">
            <MarkdownMessage
              content={content}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
            />
          </article>
        )}
      </div>
      <PlanExecutionHistory
        executions={props.executions}
        t={t}
        onOpenOrchestrationRun={props.onOpenOrchestrationRun}
      />
    </section>
  );
}

type PlanRevisionEditDraft = Pick<PlanRevisionEditInput, "title" | "summary" | "steps" | "assumptions">;

function planRevisionEditDraft(plan: PlanRevision): PlanRevisionEditDraft {
  return {
    title: plan.title,
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      ...step,
      targets: [...step.targets],
      verification: [...step.verification],
    })),
    assumptions: [...plan.assumptions],
  };
}

function splitPlanList(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function PlanRevisionEditor(props: {
  draft: PlanRevisionEditDraft;
  sources: PlanRevision["sources"];
  saving: boolean;
  t: T;
  onChange(value: PlanRevisionEditDraft): void;
  onCancel(): void;
  onSave(): void;
}) {
  const valid = props.draft.title.trim() !== ""
    && props.draft.summary.trim() !== ""
    && props.draft.steps.length > 0
    && props.draft.steps.every((step) => step.title.trim() !== "" && step.detail.trim() !== "");
  const updateStep = (index: number, update: Partial<PlanRevisionEditStep>) => {
    props.onChange({
      ...props.draft,
      steps: props.draft.steps.map((step, stepIndex) => (
        stepIndex === index ? { ...step, ...update } : step
      )),
    });
  };
  const moveStep = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= props.draft.steps.length) return;
    const steps = [...props.draft.steps];
    const [step] = steps.splice(index, 1);
    if (step === undefined) return;
    steps.splice(nextIndex, 0, step);
    props.onChange({ ...props.draft, steps });
  };
  return (
    <div className="plan-revision-editor">
      <FieldGroup>
        <Field>
          <FieldLabel>{props.t("planTitle")}</FieldLabel>
          <Input value={props.draft.title} onChange={(event) => props.onChange({ ...props.draft, title: event.target.value })} />
        </Field>
        <Field>
          <FieldLabel>{props.t("planSummary")}</FieldLabel>
          <Textarea rows={4} value={props.draft.summary} onChange={(event) => props.onChange({ ...props.draft, summary: event.target.value })} />
        </Field>
      </FieldGroup>
      <section className="plan-revision-editor-steps">
        <header><h2>{props.t("planSteps")}</h2><span>{props.draft.steps.length}</span></header>
        {props.draft.steps.map((step, index) => (
          <article className="plan-revision-editor-step" key={step.id ?? `new:${index}`}>
            <header>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <div>
                <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveStep(index, -1)}>{props.t("moveUp")}</Button>
                <Button variant="ghost" size="sm" disabled={index === props.draft.steps.length - 1} onClick={() => moveStep(index, 1)}>{props.t("moveDown")}</Button>
                <Button variant="ghost" size="sm" disabled={props.draft.steps.length === 1} onClick={() => props.onChange({
                  ...props.draft,
                  steps: props.draft.steps.filter((_, stepIndex) => stepIndex !== index),
                })}>{props.t("removeStep")}</Button>
              </div>
            </header>
            <FieldGroup>
              <Field>
                <FieldLabel>{props.t("stepTitle")}</FieldLabel>
                <Input value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>{props.t("stepDetail")}</FieldLabel>
                <Textarea rows={4} value={step.detail} onChange={(event) => updateStep(index, { detail: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel>{props.t("planTargets")}</FieldLabel>
                <Textarea rows={3} value={step.targets.join("\n")} onChange={(event) => updateStep(index, { targets: splitPlanList(event.target.value) })} />
              </Field>
              <Field>
                <FieldLabel>{props.t("planVerification")}</FieldLabel>
                <Textarea rows={3} value={step.verification.join("\n")} onChange={(event) => updateStep(index, { verification: splitPlanList(event.target.value) })} />
              </Field>
            </FieldGroup>
          </article>
        ))}
        <Button variant="outline" onClick={() => props.onChange({
          ...props.draft,
          steps: [...props.draft.steps, {
            title: props.t("newPlanStep"),
            detail: "",
            targets: [],
            verification: [],
          }],
        })}><Icon name="plus" size={14} />{props.t("addStep")}</Button>
      </section>
      <Field>
        <FieldLabel>{props.t("planAssumptions")}</FieldLabel>
        <Textarea rows={4} value={props.draft.assumptions.join("\n")} onChange={(event) => props.onChange({
          ...props.draft,
          assumptions: splitPlanList(event.target.value),
        })} />
      </Field>
      <section className="plan-revision-editor-sources">
        <header><h2>{props.t("planSources")}</h2><span>{props.t("readOnly")}</span></header>
        <div>{props.sources.map((source) => (
          <code key={`${source.operation ?? "source"}:${source.path}`}>
            {source.path}{source.operation === undefined ? "" : ` · ${source.operation}`}
          </code>
        ))}</div>
      </section>
      <footer>
        <Button variant="outline" disabled={props.saving} onClick={props.onCancel}>{props.t("cancel")}</Button>
        <Button disabled={!valid || props.saving} onClick={props.onSave}>{props.saving ? props.t("saving") : props.t("saveRevision")}</Button>
      </footer>
    </div>
  );
}

function PlanRevisionDiffView(props: {
  plan: PlanRevision;
  revisions: PlanRevision[];
  compareToRevisionId: string;
  diff: PlanRevisionDiff | null;
  loading: boolean;
  error: boolean;
  t: T;
  onCompareChange(revisionId: string): void;
  onRetry(): void;
}) {
  return (
    <div className="plan-revision-diff">
      <header>
        <div>
          <span>{props.t("compareRevision")}</span>
          <strong>v{props.plan.revision}</strong>
        </div>
        <Select value={props.compareToRevisionId} onValueChange={props.onCompareChange}>
          <SelectTrigger aria-label={props.t("compareRevision")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.revisions.filter(({ id }) => id !== props.plan.id).map((revision) => (
                <SelectItem key={revision.id} value={revision.id}>v{revision.revision} · {revision.status}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </header>
      {props.error ? <TaskSectionError t={props.t} onRetry={props.onRetry} /> : props.loading || props.diff === null ? <InspectorLoading t={props.t} /> : (
        <>
          <div className="plan-revision-diff-summary">
            <section>
              <h2>{props.t("fieldChanges")}</h2>
              {props.diff.fieldChanges.length === 0 ? <p>{props.t("noChanges")}</p> : (
                <ul>{props.diff.fieldChanges.map((change) => (
                  <li key={change.field}><strong>{change.field}</strong><span>{change.before}</span><span>{change.after}</span></li>
                ))}</ul>
              )}
            </section>
            <section>
              <h2>{props.t("stepChanges")}</h2>
              {props.diff.stepChanges.length === 0 ? <p>{props.t("noChanges")}</p> : (
                <ul>{props.diff.stepChanges.map((change) => (
                  <li key={change.stepId}>
                    <strong>{change.changes.join(" + ")}</strong>
                    <span>{change.beforeIndex === null ? "—" : change.beforeIndex + 1} → {change.afterIndex === null ? "—" : change.afterIndex + 1}</span>
                    {change.fields.length > 0 ? <small>{change.fields.join(", ")}</small> : null}
                  </li>
                ))}</ul>
              )}
            </section>
          </div>
          <pre className="plan-revision-unified-diff">{props.diff.markdownDiff}</pre>
        </>
      )}
    </div>
  );
}

function ConductorWorkspace(props: {
  session: Session;
  workspace: Workspace;
  selectedRunId: string;
  selectedNode: SelectedConductorNode | null;
  t: T;
  onSelectRun(runId: string): void;
  onSelectNode(node: SelectedConductorNode): void;
}) {
  const runs = useQuery({
    queryKey: ["conductor-runs", props.workspace.id, props.session.id],
    queryFn: () => window.piWork.conductor.list({
      workspaceId: props.workspace.id,
      taskId: props.session.id,
    }),
    refetchInterval: (query) => (query.state.data as ConductorRun[] | undefined)
      ?.some(({ status }) => status === "pending" || status === "running") ? 1_000 : false,
  });
  const selectedRun = (runs.data ?? []).find(({ id }) => id === props.selectedRunId) ?? runs.data?.[0] ?? null;
  useEffect(() => {
    if (selectedRun !== null && selectedRun.id !== props.selectedRunId) props.onSelectRun(selectedRun.id);
  }, [props.onSelectRun, props.selectedRunId, selectedRun]);
  const nodes = useQuery({
    queryKey: ["conductor-nodes", props.workspace.id, selectedRun?.id],
    queryFn: () => window.piWork.conductor.nodes({
      workspaceId: props.workspace.id,
      runId: selectedRun!.id,
    }),
    enabled: selectedRun !== null,
    refetchInterval: selectedRun?.status === "pending" || selectedRun?.status === "running" ? 1_000 : false,
  });
  const selectedNode = selectedRun !== null && props.selectedNode?.runId === selectedRun.id
    ? props.selectedNode
    : null;
  return (
    <section className="conductor-workspace" aria-label={props.t("orchestration")}>
      <header className="conductor-workspace-header">
        <div>
          <span className="conductor-workspace-origin">
            {selectedRun === null ? props.t("workflow") : workflowOriginLabel(selectedRun, props.t)}
          </span>
          <h2>{selectedRun?.title ?? props.t("conductorExecutionPlan")}</h2>
          <p>{selectedRun?.summary || props.t("conductorExecutionPlanDetail")}</p>
        </div>
        {selectedRun !== null ? (
          <div className="conductor-workspace-meta">
            <ConductorStatusBadge status={selectedRun.status} label={workflowStatusLabel(selectedRun.status, props.t)} />
            <span>{selectedRun.spec.maxParallel} {props.t("conductorParallelism")}</span>
          </div>
        ) : null}
      </header>
      {runs.isError ? <TaskSectionError t={props.t} onRetry={() => void runs.refetch()} /> : null}
      {!runs.isError && selectedRun === null ? (
        <div className="conductor-workspace-empty">
          <Icon name="plan" />
          <p>{props.t("noConductorRuns")}</p>
          <span>{props.t("orchestrationDetail")}</span>
        </div>
      ) : null}
      {selectedRun !== null ? (
        <>
          {nodes.isError ? <TaskSectionError t={props.t} onRetry={() => void nodes.refetch()} /> : (
            <ConductorFlow
              runId={selectedRun.id}
              nodes={selectedRun.spec.nodes}
              states={nodes.data ?? []}
              selectedNodeId={selectedNode?.nodeId ?? null}
              statusLabel={(status) => workflowNodeStatusLabel(status, props.t)}
              attemptLabel={props.t("attempt")}
              liveLabel={props.t("conductorLive")}
              onSelectNode={(node) => props.onSelectNode({
                runId: selectedRun.id,
                nodeId: node.id,
                title: node.title,
                maxAttempts: node.maxAttempts,
              })}
            />
          )}
        </>
      ) : null}
    </section>
  );
}

export function createConductorDraft(title: string, prompt: string, id = crypto.randomUUID()): ConductorSpec {
  return {
    nodes: [{
      id,
      title: title.trim() || "Untitled node",
      prompt: prompt.trim() || title.trim() || "Describe this step.",
      dependsOn: [],
      maxAttempts: 2,
    }],
    maxParallel: 4,
  };
}

export function serializeConductorDraft(draft: ConductorSpec): string {
  return JSON.stringify(draft, null, 2);
}

export function parseConductorDraft(value: string): ConductorSpec {
  return conductorSpecSchema.parse(JSON.parse(value));
}

export function conductorDraftError(value: unknown): string | null {
  const result = conductorSpecSchema.safeParse(value);
  if (result.success) return null;
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  }).join("\n");
}

function ConductorPanel(props: {
  session: Session;
  workspace: Workspace;
  selectedRunId: string;
  t: T;
  onSelectRun(runId: string): void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const runs = useQuery({
    queryKey: ["conductor-runs", props.workspace.id, props.session.id],
    queryFn: () => window.piWork.conductor.list({
      workspaceId: props.workspace.id,
      taskId: props.session.id,
    }),
    refetchInterval: (query) => (query.state.data as ConductorRun[] | undefined)
      ?.some(({ status }) => status === "pending" || status === "running") ? 1_000 : false,
  });
  const selectedRun = (runs.data ?? []).find(({ id }) => id === props.selectedRunId) ?? runs.data?.[0] ?? null;
  useEffect(() => {
    if (selectedRun !== null && selectedRun.id !== props.selectedRunId) props.onSelectRun(selectedRun.id);
  }, [props.onSelectRun, props.selectedRunId, selectedRun]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conductor-runs", props.workspace.id, props.session.id] }),
      queryClient.invalidateQueries({ queryKey: ["conductor-nodes", props.workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ["conductor-attempts", props.workspace.id] }),
    ]);
  };
  const command = async (action: "start" | "pause" | "resume" | "stop" | "retry") => {
    if (selectedRun === null) return;
    setError(null);
    if (action === "retry") setRetrying(true);
    try {
      const run = await window.piWork.conductor[action]({ workspaceId: props.workspace.id, runId: selectedRun.id });
      if (action === "retry") props.onSelectRun(run.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
    } finally {
      if (action === "retry") setRetrying(false);
    }
  };
  return (
    <section className="conductor-panel conductor-observer-panel" aria-label={props.t("orchestration")}>
      <header className="conductor-observer-header">
        <div>
          <span className="conductor-observer-eyebrow"><Icon name="workflow" size={14} />{props.t("workflowRunHistory")}</span>
          <p>{props.t("workflowObserveHint")}</p>
        </div>
        {selectedRun !== null ? (
          <div className="conductor-toolbar-actions">
            {selectedRun.status === "pending" ? <Button size="sm" onClick={() => void command("start")}>{props.t("start")}</Button> : null}
            {selectedRun.status === "running" ? <Button size="sm" variant="outline" onClick={() => void command("pause")}>{props.t("pause")}</Button> : null}
            {selectedRun.status === "paused" ? <Button size="sm" onClick={() => void command("resume")}>{props.t("resume")}</Button> : null}
            {selectedRun.status === "pending" || selectedRun.status === "running" || selectedRun.status === "paused"
              ? <Button size="sm" variant="ghost" onClick={() => void command("stop")}>{props.t("stop")}</Button>
              : null}
            {selectedRun.status === "failed" || selectedRun.status === "cancelled" ? (
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void command("retry")}>
                <Icon name="refresh" size={14} />
                {retrying ? props.t("workflowRetrying") : props.t("workflowRetry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      {runs.isError ? <TaskSectionError t={props.t} onRetry={() => void runs.refetch()} /> : null}
      {!runs.isError && (runs.data?.length ?? 0) === 0 ? (
        <div className="conductor-observer-empty">
          <Icon name="workflow" size={14} />
          <div><strong>{props.t("noConductorRuns")}</strong><span>{props.t("orchestrationDetail")}</span></div>
        </div>
      ) : (
        <div className="conductor-run-history" role="list">
          {runs.data?.map((run) => (
            <button
              type="button"
              role="listitem"
              key={run.id}
              className={`conductor-run-history-item${selectedRun?.id === run.id ? " is-selected" : ""}`}
              aria-current={selectedRun?.id === run.id ? "true" : undefined}
              onClick={() => props.onSelectRun(run.id)}
            >
              <span className="conductor-run-history-icon"><Icon name="workflow" size={14} /></span>
              <span className="conductor-run-history-copy">
                <strong>{run.title}</strong>
                <span>{workflowOriginLabel(run, props.t)} · {run.spec.nodes.length} {props.t("conductorNodes")}</span>
              </span>
              <ConductorStatusBadge status={run.status} label={workflowStatusLabel(run.status, props.t)} />
            </button>
          ))}
        </div>
      )}
      {error !== null ? <Alert><Icon name="alert" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </section>
  );
}

function ConductorNodeExecution(props: {
  workspace: Workspace;
  selectedNode: SelectedConductorNode;
  t: T;
}) {
  const queryClient = useQueryClient();
  const nodes = useQuery({
    queryKey: ["conductor-nodes", props.workspace.id, props.selectedNode.runId],
    queryFn: () => window.piWork.conductor.nodes({
      workspaceId: props.workspace.id,
      runId: props.selectedNode.runId,
    }),
    refetchInterval: 1_000,
  });
  const attempts = useQuery({
    queryKey: ["conductor-attempts", props.workspace.id, props.selectedNode.runId],
    queryFn: () => window.piWork.conductor.attempts({
      workspaceId: props.workspace.id,
      runId: props.selectedNode.runId,
    }),
    refetchInterval: 1_000,
  });
  const nodeState = nodes.data?.find(({ nodeId }) => nodeId === props.selectedNode.nodeId);
  const nodeAttempts = (attempts.data ?? []).filter(({ nodeId }) => nodeId === props.selectedNode.nodeId);
  const executionIds = useMemo(
    () => new Set(nodeAttempts.filter(({ status }) => status === "running").map(({ executionId }) => executionId)),
    [nodeAttempts],
  );
  useEffect(() => window.piWork.agent.onEvent(({ sessionId, event }) => {
    if (!executionIds.has(sessionId)) return;
    queryClient.setQueryData<ConductorNodeAttemptDetail[]>(
      ["conductor-attempts", props.workspace.id, props.selectedNode.runId],
      (current) => current?.map((attempt) => {
        if (attempt.executionId !== sessionId || attempt.events.some(({ sequence }) => sequence === event.sequence)) return attempt;
        return {
          ...attempt,
          events: [...attempt.events, {
            executionId: sessionId,
            sequence: event.sequence,
            kind: event.kind,
            payload: event.payload,
            createdAt: event.timestamp,
          }],
        };
      }),
    );
    if (event.kind === "completed" || event.kind === "cancelled") {
      void queryClient.invalidateQueries({ queryKey: ["conductor-nodes", props.workspace.id, props.selectedNode.runId] });
      void queryClient.invalidateQueries({ queryKey: ["conductor-attempts", props.workspace.id, props.selectedNode.runId] });
    }
  }), [executionIds, props.selectedNode.runId, props.workspace.id, queryClient]);
  const status = nodeState?.status ?? "pending";
  const attempt = nodeState?.attempt ?? 0;
  return (
    <article className="conductor-node-execution" aria-label={props.t("conductorNodeExecution")}>
      <header className="conductor-node-execution-header">
        <div>
          <p className="conductor-execution-label">{props.t("conductorNodeExecution")}</p>
          <h2>{props.selectedNode.title}</h2>
          <p>{props.t("conductorNodeExecutionDetail")}</p>
        </div>
      </header>
      <div className="conductor-node-execution-summary">
        <ConductorStatusBadge status={status} label={workflowNodeStatusLabel(status, props.t)} />
        <span>{props.t("attempt")} {attempt}/{props.selectedNode.maxAttempts}</span>
        {status === "running" ? <span className="conductor-node-live">{props.t("conductorLive")}</span> : null}
      </div>
      {attempts.isError || nodes.isError ? (
        <TaskSectionError t={props.t} onRetry={() => {
          void nodes.refetch();
          void attempts.refetch();
        }} />
      ) : null}
      {nodeAttempts.length > 0 ? (
        <div className="conductor-node-execution-attempts">
          {nodeAttempts.map((nodeAttempt) => <ConductorAttempt key={nodeAttempt.executionId} attempt={nodeAttempt} t={props.t} />)}
        </div>
      ) : null}
      {!attempts.isError && !nodes.isError && status === "running" && nodeAttempts.length === 0 ? (
        <div className="conductor-execution-empty" role="status">
          <span aria-hidden="true" />
          <p>{props.t("conductorExecutionStarting")}</p>
        </div>
      ) : null}
      {!attempts.isError && !nodes.isError && attempt > 0 && status !== "running" && nodeAttempts.length === 0 ? (
        <p className="conductor-execution-unavailable">{props.t("conductorExecutionUnavailable")}</p>
      ) : null}
      {!attempts.isError && !nodes.isError && attempt === 0 ? <p className="conductor-node-pending">{props.t("waitingDependencies")}</p> : null}
    </article>
  );
}

function ConductorStatusBadge(props: {
  status: ConductorRun["status"] | ConductorNodeState["status"] | ConductorNodeAttemptDetail["status"];
  label?: string;
}) {
  return <Badge className={`conductor-status-badge conductor-status-badge-${props.status}`}>{props.label ?? props.status}</Badge>;
}

function workflowNodeStatusLabel(
  status: ConductorNodeState["status"] | ConductorNodeAttemptDetail["status"],
  t: T,
): string {
  if (status === "ready") return t("workflowStatusReady");
  if (status === "skipped") return t("workflowStatusSkipped");
  return workflowStatusLabel(status, t);
}

function ConductorAttempt(props: { attempt: ConductorNodeAttemptDetail; t: T }) {
  const [open, setOpen] = useState(props.attempt.status === "running");
  const process = useMemo(() => props.attempt.events.reduce<LiveProcess>(
    (current, event) => reduceLiveProcess(current, event.kind, event.payload, props.t),
    { thoughts: [], tools: [], timeline: [], notice: null },
  ), [props.attempt.events, props.t]);
  const streamed = useMemo(() => props.attempt.events
    .filter(({ kind }) => kind === "text_delta")
    .map(({ payload }) => typeof payload.delta === "string" ? payload.delta : "")
    .join(""), [props.attempt.events]);
  const output = props.attempt.output ?? streamed;
  return (
    <details
      className={`conductor-attempt conductor-attempt-${props.attempt.status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{props.t("attempt")} {props.attempt.attempt}</span>
        <span className="conductor-attempt-meta">
          <code>{props.attempt.executionId.slice(0, 8)}</code>
          <time>{conductorElapsed(props.attempt.startedAt, props.attempt.completedAt)}</time>
          <ConductorStatusBadge
            status={props.attempt.status}
            label={workflowNodeStatusLabel(props.attempt.status, props.t)}
          />
        </span>
      </summary>
      <div className="conductor-attempt-content">
        {process.timeline.length > 0 || process.notice !== null ? <LiveProcessView collapse={false} process={process} t={props.t} /> : null}
        {output !== "" ? <AssistantResult streaming={props.attempt.status === "running"} content={output} t={props.t} /> : null}
        {props.attempt.error !== null ? <Alert><AlertDescription>{props.attempt.error}</AlertDescription></Alert> : null}
      </div>
    </details>
  );
}

function conductorElapsed(startedAt: string, completedAt: string | null): string {
  const elapsed = Math.max(0, new Date(completedAt ?? Date.now()).getTime() - new Date(startedAt).getTime());
  const seconds = Math.floor(elapsed / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function InspectorSection(props: { title: string; children: ReactNode }) {
  return <section className="inspector-section"><header>{props.title}</header>{props.children}</section>;
}

function InspectorLoading({ t }: { t: T }) {
  return <div className="inspector-loading"><span /><span /><span /><p>{t("loading")}</p></div>;
}

function TaskSectionError({ t, onRetry }: { t: T; onRetry(): void }) {
  return <Alert className="task-section-error"><Icon name="alert" /><AlertDescription>{t("failedToLoad")}</AlertDescription><Button variant="outline" size="sm" onClick={onRetry}>{t("tryAgain")}</Button></Alert>;
}

function ActivityTimelineItem({ activity, t }: { activity: Activity; t: T }) {
  const thinking = activity.kind === "thinking";
  const detail = thinking ? summarizeActivity(activity.detail) : activity.detail;
  const metadata = thinking ? omitThoughtMetadata(activity.metadata) : activity.metadata;
  return (
    <article className={`timeline-item timeline-${activity.kind}`}>
      <span className="timeline-marker"><Icon name={activity.kind === "error" ? "alert" : activity.kind === "file_change" ? "file" : activity.kind === "tool_call" ? "terminal" : "status"} size={14} /></span>
      <div><time>{new Date(activity.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><strong>{activityTitle(activity.kind, t)}</strong>{detail ? <p>{detail}</p> : null}{Object.keys(metadata).length ? <details><summary>{t("technicalDetails")}</summary><pre>{JSON.stringify(metadata, null, 2)}</pre></details> : null}</div>
    </article>
  );
}

function summarizeActivity(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

function omitThoughtMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { content: _content, delta: _delta, ...safeMetadata } = metadata;
  return safeMetadata;
}

function planRevisionStatusLabel(plan: PlanRevision, approvalRequired: boolean, historical: boolean, t: T): string {
  if (approvalRequired) return t("planStatusAwaitingApproval");
  if (historical || plan.status === "superseded") return t("planStatusSuperseded");
  if (plan.status === "approved") return t("planStatusApproved");
  return t("planStatusProposed");
}

function PlanActionMenu(props: {
  approvalRequired: boolean;
  readyToExecute: boolean;
  permissionMode: PermissionMode;
  busy: boolean;
  primaryLabel?: string;
  t: T;
  onApprove(action: PlanApprovalAction): void;
  onExecute(mode: PlanExecutionMode): void;
}) {
  const primaryLabel = props.busy
    ? props.t("sending")
    : props.primaryLabel !== undefined
      ? props.primaryLabel
    : props.readyToExecute
      ? props.t("executeApprovedPlan")
      : props.permissionMode === "explore"
        ? props.t("approveAndExplore")
        : props.t("approveAndStart");
  const primary = () => {
    if (props.readyToExecute) props.onExecute("current_session");
    else props.onApprove("approve_and_execute");
  };
  return (
    <div className="plan-action-split">
      <Button type="button" className="font-normal" size="sm" disabled={props.busy} onClick={primary}>{primaryLabel}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="font-normal plan-action-menu-trigger" size="sm" disabled={props.busy} aria-label={props.t("moreActions")}>
            <Icon name="chevron-down" size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {props.approvalRequired ? (
            <DropdownMenuItem onSelect={() => props.onApprove("approve_only")}>{props.t("approveOnly")}</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => (
            props.approvalRequired
              ? props.onApprove("approve_and_execute_fresh")
              : props.onExecute("fresh_session")
          )}>{props.t("executeFreshSession")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => (
            props.approvalRequired
              ? props.onApprove("approve_and_orchestrate")
              : props.onExecute("orchestration")
          )}>{props.t("executeWithOrchestration")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PlanApprovalDock(props: {
  permissionMode: PermissionMode;
  busy: boolean;
  t: T;
  onApprove(action: PlanApprovalAction): void;
  onRequestChanges(content: string): void;
}) {
  const titleId = useId();
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const submitFeedback = (event: FormEvent) => {
    event.preventDefault();
    const nextFeedback = feedback.trim();
    if (nextFeedback === "" || props.busy) return;
    props.onRequestChanges(nextFeedback);
  };
  return (
    <div className="composer-dock plan-approval-dock">
      <section className="plan-approval-dock-panel" aria-labelledby={titleId}>
        <header>
          <strong id={titleId}>{props.t("implementPlanQuestion")}</strong>
        </header>
        <div className="plan-approval-choice is-primary">
          <span aria-hidden="true">1</span>
          <PlanActionMenu
            approvalRequired
            readyToExecute={false}
            permissionMode={props.permissionMode}
            busy={props.busy}
            primaryLabel={props.t("confirmPlanImplementation")}
            t={props.t}
            onApprove={props.onApprove}
            onExecute={() => undefined}
          />
        </div>
        <div className="plan-feedback-direct">
          <button
            type="button"
            className={`plan-feedback-toggle${feedbackOpen ? " is-open" : ""}`}
            aria-expanded={feedbackOpen}
            onClick={() => setFeedbackOpen((open) => !open)}
          >
            <span aria-hidden="true"><Icon name="square-pen" size={14} /></span>
            <strong>{props.t("requestPlanChanges")}</strong>
            <Icon name={feedbackOpen ? "chevron-down" : "forward"} size={14} />
          </button>
          {feedbackOpen ? (
            <form className="plan-feedback-form" onSubmit={submitFeedback}>
              <Textarea
                autoFocus
                value={feedback}
                rows={2}
                disabled={props.busy}
                aria-label={props.t("requestPlanChanges")}
                placeholder={props.t("planFeedbackPlaceholder")}
                onChange={(event) => setFeedback(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="plan-feedback-submit"
                title={props.t("sendHint")}
                aria-label={props.t("send")}
                disabled={props.busy || feedback.trim() === ""}
              >
                <Icon name="arrow-up" size={14} />
              </Button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PlanExecutionHistory({
  executions,
  t,
  onOpenOrchestrationRun,
}: {
  executions: PlanExecutionDetail[];
  t: T;
  onOpenOrchestrationRun(runId: string): void;
}) {
  const latest = executions[0];
  if (latest === undefined) return null;
  const conductorRunId = latest.execution.conductorRunId;
  const elapsed = latest.execution.startedAt === null
    ? null
    : Math.max(0, new Date(latest.execution.completedAt ?? Date.now()).getTime() - new Date(latest.execution.startedAt).getTime());
  return (
    <details className="plan-execution-history" open={latest.execution.status === "running" || latest.execution.status === "failed"}>
      <summary>
        <span className={`plan-execution-status is-${latest.execution.status}`}>{t(`planExecutionStatus_${latest.execution.status}` as MessageKey)}</span>
        <span>{t(`planExecutionMode_${latest.execution.mode}` as MessageKey)}</span>
        {elapsed === null ? null : <span>{Math.max(1, Math.round(elapsed / 1_000))}s</span>}
        {executions.length > 1 ? <span>{executions.length} {t("planExecutionAttempts")}</span> : null}
      </summary>
      <ol>
        {latest.steps.map((step, index) => (
          <li className={`plan-progress-step is-${step.status}`} key={`${step.executionId}:${step.stepId}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{t(`planStepStatus_${step.status}` as MessageKey)}</strong>
              {step.note !== null ? <p>{step.note}</p> : null}
              {step.error !== null ? <p className="plan-progress-error">{step.error}</p> : null}
              {step.verificationResults.length > 0 ? (
                <ul>{step.verificationResults.map((result) => (
                  <li key={result.verificationIndex}>
                    {result.verificationIndex + 1}. {result.status}: {result.detail}
                  </li>
                ))}</ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {latest.execution.error !== null ? <p className="plan-progress-error">{latest.execution.error}</p> : null}
      {conductorRunId !== null ? (
        <div className="plan-execution-history-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenOrchestrationRun(conductorRunId)}
          >
            <Icon name="workflow" size={14} />
            {t("openOrchestrationRun")}
          </Button>
        </div>
      ) : null}
    </details>
  );
}

function ConversationPlanCard(props: {
  plan: PlanRevision;
  latest: boolean;
  historical: boolean;
  permissionMode: PermissionMode;
  approvalRequired: boolean;
  readyToExecute: boolean;
  retryAllowed: boolean;
  approving: boolean;
  executing: boolean;
  retrying: boolean;
  active: boolean;
  execution: ReactNode;
  executions: PlanExecutionDetail[];
  t: T;
  onOpen(): void;
  onOpenOrchestrationRun(runId: string): void;
  onApprove(action: PlanApprovalAction): void;
  onExecute(mode: PlanExecutionMode): void;
  onRetry(): void;
}) {
  const { plan, t } = props;
  const status = planRevisionStatusLabel(plan, props.approvalRequired, props.historical, t);
  const [copied, setCopied] = useState(false);
  const content = planRevisionMarkdown(plan);
  const copyPlan = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };
  return (
    <article
      className={`conversation-plan plan-status-${props.historical ? "superseded" : plan.status}${props.approvalRequired ? " is-awaiting-approval" : ""}${props.active ? " is-active" : ""}`}
      role="group"
      aria-label={plan.title}
    >
      <header className="conversation-plan-header">
        <span className="conversation-plan-label">
          <Icon name="idea" />
          <span>{t("plan")}</span>
          <span className="sr-only" aria-live="polite">{status}</span>
        </span>
        <span className="conversation-plan-tools">
          <button
            type="button"
            className="conversation-plan-tool"
            aria-label={copied ? t("copied") : t("copy")}
            title={copied ? t("copied") : t("copy")}
            onClick={copyPlan}
          >
            <Icon name={copied ? "check" : "copy"} />
          </button>
          <button
            type="button"
            className="conversation-plan-tool"
            aria-label={t("viewPlan")}
            aria-controls="task-inspector"
            aria-expanded={props.active}
            onClick={props.onOpen}
          >
            <Icon name="expand" />
          </button>
        </span>
      </header>
      <div className="conversation-plan-preview">
        <MarkdownMessage
          content={content}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          compact
        />
      </div>
      {props.execution !== null ? (
        <section className="conversation-plan-execution" aria-label={t("planExecution")}>
          {props.execution}
        </section>
      ) : null}
      <PlanExecutionHistory
        executions={props.executions}
        t={t}
        onOpenOrchestrationRun={props.onOpenOrchestrationRun}
      />
      {props.readyToExecute || props.retryAllowed || plan.status === "approved" ? (
        <footer className="conversation-plan-actions">
          {props.readyToExecute ? <span className="conversation-plan-feedback-hint">{t("planReadyToExecute")}</span> : null}
          {plan.status === "approved" && !props.retryAllowed ? <span className="conversation-plan-locked"><Icon name="check" size={14} />{t("planLocked")}</span> : null}
          {props.retryAllowed ? (
            <Button size="sm" disabled={props.retrying} onClick={props.onRetry}>
              {props.retrying ? t("sending") : t("retryApprovedPlan")}
            </Button>
          ) : null}
          {props.readyToExecute ? (
            <PlanActionMenu
              approvalRequired={false}
              readyToExecute={props.readyToExecute}
              permissionMode={props.permissionMode}
              busy={props.approving || props.executing}
              t={t}
              onApprove={props.onApprove}
              onExecute={props.onExecute}
            />
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function PlanSkeleton({ t }: { t: T }) {
  return (
    <article className="conversation-plan conversation-plan-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("planningInProgress")}</span>
      <header>
        <span className="conversation-plan-icon"><Icon name="plan" /></span>
        <div><span className="skeleton-line short" /><span className="skeleton-line title" /><span className="skeleton-line" /></div>
      </header>
      <div className="plan-skeleton-steps">
        {[0, 1, 2].map((index) => <span className="skeleton-line" key={index} />)}
      </div>
    </article>
  );
}

function ToolApprovalCard(props: { approval: ToolApproval; compact?: boolean; t: T; onResolve(approved: boolean): void }) {
  const { approval, t } = props;
  const path = argumentString(approval.arguments, ["path", "filePath", "file_path", "target", "targetPath"]);
  const command = argumentString(approval.arguments, ["command", "cmd", "script"]);
  const title = approval.tool === "bash" ? t("runCommand") : approval.tool === "write" ? t("writeFile") : t("editFile");
  const headingId = useId();
  return (
    <article className={`approval-card tool ${props.compact ? "compact" : ""}`} role="group" aria-labelledby={headingId}>
      <div className="approval-symbol"><Icon name={approval.tool === "bash" ? "terminal" : "file"} /></div>
      <div className="approval-copy">
        <span>{t("toolRequest")}</span>
        <h3 id={headingId}>{title}</h3>
        {path ? <p><strong>{t("path")}</strong><code>{path}</code></p> : null}
        {command ? <p><strong>{t("command")}</strong><code>{command}</code></p> : null}
        <p><strong>{t("workingDirectory")}</strong><code>{approval.cwd}</code></p>
        <details><summary>{t("technicalDetails")}</summary><pre>{JSON.stringify(approval.arguments, null, 2)}</pre></details>
      </div>
      <div className="approval-actions">
        <Button variant="ghost" size="sm" onClick={() => props.onResolve(false)}>{t("deny")}</Button>
        <Button size="sm" onClick={() => props.onResolve(true)}>{t("allowOnce")}</Button>
      </div>
    </article>
  );
}

function ArtifactPreview(props: { artifact: Artifact; t: T; onPublish(): Promise<void> }) {
  const [publishing, setPublishing] = useState(false);
  return (
    <article className="artifact-preview">
      <header><div><Icon name="file" /><span><strong>{props.artifact.relativePath}</strong><small>{props.artifact.mimeType}</small></span></div><Badge className={props.artifact.publishedPath === null ? "" : "artifact-published-badge"}>{props.artifact.publishedPath === null ? props.t("staged") : props.t("published")}</Badge></header>
      <pre>{props.artifact.content}</pre>
      <footer>
        <code>{props.artifact.publishedPath ?? props.artifact.stagedPath}</code>
        {props.artifact.publishedPath === null ? <Button size="sm" disabled={publishing} onClick={() => {
          setPublishing(true);
          void props.onPublish().finally(() => setPublishing(false));
        }}>{publishing ? props.t("sending") : props.t("publish")}</Button> : null}
      </footer>
    </article>
  );
}

function activityTitle(kind: Activity["kind"], t: T): string {
  const key: Record<Activity["kind"], MessageKey> = {
    thinking: "activityThinking",
    tool_call: "activityToolCall",
    tool_result: "activityToolResult",
    file_change: "activityFileChange",
    approval: "activityApproval",
    error: "activityError",
    notice: "activityNotice",
  };
  return t(key[kind]);
}

function argumentString(argumentsValue: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function permissionLabel(mode: PermissionMode, t: T): string {
  if (mode === "auto") return t("automatic");
  if (mode === "explore") return t("exploreOnly");
  return t("askEveryTime");
}

function permissionModeIcon(mode: PermissionMode): "eye" | "lock" | "terminal" {
  if (mode === "auto") return "terminal";
  if (mode === "explore") return "eye";
  return "lock";
}

function lifecycleLabel(session: Pick<Session, "status" | "running">, t: T): string {
  if (session.running) return t("lifecycleRunning");
  const key = {
    draft: "lifecycleDraft",
    planning: "lifecyclePlanning",
    awaiting_plan_approval: "lifecycleAwaitingPlan",
    ready_to_execute: "lifecycleReadyToExecute",
    running: "lifecycleRunning",
    awaiting_action_approval: "lifecycleAwaitingAction",
    reviewing: "lifecycleReviewing",
    completed: "lifecycleCompleted",
    failed: "lifecycleFailed",
    cancelled: "lifecycleCancelled",
  }[session.status] as MessageKey;
  return t(key);
}
