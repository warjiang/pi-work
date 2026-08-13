import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Activity,
  AppSettings,
  Artifact,
  Attachment as StoredAttachment,
  AttachmentDraft,
  ChatMessage,
  Label,
  ModelCatalog,
  ModelOption,
  PermissionMode,
  Plan,
  Session,
  StatusDefinition,
  ThinkingLevel,
  ToolApproval,
  Workspace,
} from "@pi-work/protocol";
import { MarkdownMessage } from "@/components/markdown-message.js";
import { PiMark } from "@/components/pi-mark.js";
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
  DropdownMenuCheckboxItem,
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
import { Icon } from "@/components/ui/icon.js";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Textarea } from "@/components/ui/textarea.js";
import { thinkingLevelLabel } from "@/i18n.js";
import type { MessageKey } from "@/i18n.js";
import type { InspectorTab } from "@/store.js";

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

function formatBytes(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function mergeAttachments(current: AttachmentDraft[], selected: AttachmentDraft[]): AttachmentDraft[] {
  return [...new Map([...current, ...selected].map((attachment) => [attachment.path, attachment])).values()].slice(0, 20);
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
  planMode: boolean;
  showPlanMode: boolean;
  disabled: boolean;
  t: T;
  onPermissionChange(mode: PermissionMode): void;
  onPlanModeChange(enabled: boolean): void;
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
        {props.showPlanMode ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={props.planMode}
                onCheckedChange={(checked) => props.onPlanModeChange(checked === true)}
                className="composer-plan-option"
              >
                <span>
                  <strong>{props.t("planFirst")}</strong>
                  <small>{props.t("generatePlanNext")}</small>
                </span>
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
  onOpenTask(taskId: string): void;
}) {
  const workspaceById = new Map(props.workspaces.map((workspace) => [workspace.id, workspace]));
  return (
    <section className="task-list-page">
      <header className="page-header">
        <div><span>{props.t("work")}</span><h1>{props.title}</h1></div>
      </header>
      {props.sessions.length === 0 ? (
        <div className="task-list-empty">
          <div className="empty-symbol"><Icon name="plan" /></div>
          <h2>{props.t("noTasksTitle")}</h2>
          <p>{props.t("noTasksDetail")}</p>
        </div>
      ) : (
        <div className="task-table">
          {props.sessions.map((session) => (
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
          <header className="session-empty-brand-lockup">
            <PiMark size="hero" />
            <span>Pi Work</span>
          </header>
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
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  t: T;
  onInspectorOpen(tab?: InspectorTab): void;
  onInspectorToggle(): void;
  onInspectorTab(tab: InspectorTab): void;
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
  const messageScroller = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
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
  const plan = useQuery({
    queryKey: ["plan", sessionId],
    queryFn: () => window.piWork.task.getPlan(sessionId),
    enabled: !personal,
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", sessionId],
    queryFn: () => window.piWork.artifact.list(sessionId),
    enabled: !personal,
  });
  const unpublished = (artifacts.data ?? []).filter(({ publishedPath }) => publishedPath === null);
  const configuredProviders = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const configured = new Set((configuredProviders.data ?? []).map(({ providerId: id }) => id));
  const availableModels = (props.models?.models ?? []).filter((model) => configured.has(model.providerId));
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
    localStorage.setItem(draftKey, input);
  }, [draftKey, input]);
  useEffect(() => window.piWork.chat.onToolApproval((approval) => {
    if (approval.sessionId !== sessionId) return;
    if (!personal) props.onInspectorOpen("activity");
    void queryClient.invalidateQueries({ queryKey: ["tool-approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["activities", sessionId] });
  }), [personal, props.onInspectorOpen, queryClient, sessionId]);
  useEffect(() => window.piWork.agent.onEvent(({ sessionId: eventSessionId, event }) => {
    if (eventSessionId !== sessionId) return;
    if (event.kind === "text_delta" && typeof event.payload.delta === "string") enqueueStream(event.payload.delta);
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
    streamWaiters.current.splice(0).forEach((resolve) => resolve());
  }, []);
  useEffect(() => {
    cancelTurnNavigation();
    setFollowStream(true);
    setPublishOutcome(null);
    setRunNotice(null);
    scheduleScrollToLatest("auto");
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
    if (personal) return;
    if (props.session.status === "awaiting_plan_approval") return;
    if (approvals.length > 0 || props.session.status === "awaiting_action_approval") props.onInspectorOpen("activity");
    else if (unpublished.length > 0) props.onInspectorOpen("output");
  }, [approvals.length, personal, props.onInspectorOpen, props.session.status, unpublished.length]);
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
      queryClient.invalidateQueries({ queryKey: ["plan", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["artifacts", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["tool-approvals"] }),
    ]);
  };
  const send = useMutation({
    mutationFn: (content: string) => {
      clearStream();
      setRunNotice(null);
      setLiveProcess({ thoughts: [], tools: [], timeline: [], notice: null });
      if (providerId === "" || modelId === "") throw new Error(props.t("configureModel"));
      return window.piWork.chat.send({
        workspaceId: props.workspace?.id ?? null,
        taskId: sessionId,
        content,
        providerId,
        modelId,
        thinkingLevel,
        permissionMode: props.session.permissionMode,
        planMode: personal ? false : props.session.planMode,
        attachments,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["attachments", sessionId] }),
        props.onRefresh(),
      ]);
      setInput("");
      setAttachments([]);
      localStorage.removeItem(draftKey);
      setPendingPrompt(null);
    },
    onError: (cause: Error) => {
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
  const generatePlan = useMutation({
    mutationFn: () => window.piWork.task.generatePlan({ taskId: sessionId }),
    onSuccess: async () => {
      props.onInspectorOpen("plan");
      await refreshTaskData();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const approvePlan = useMutation({
    mutationFn: (approved: boolean) => window.piWork.task.approvePlan({ taskId: sessionId, approved }),
    onSuccess: async (_task, approved) => {
      if (!approved) props.onInspectorOpen("task");
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

  const recommendation = recommendedAction(props.session, unpublished.length, approvals.length, props.t);
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
  const retryContent = input.trim() || [...(messages.data ?? [])].reverse().find(({ role }) => role === "user")?.content.trim() || "";
  const canPromote = personal && !props.session.running && approvals.length === 0 && props.folders.length > 0;
  useEffect(() => {
    setTopbarActionsTarget(document.getElementById("topbar-task-actions"));
  }, []);
  const headerActions = (
    <div className="task-header-actions">
      {!personal ? <Button variant="ghost" size="icon" aria-label={props.session.flagged ? props.t("unflag") : props.t("flag")} onClick={() => updateSession.mutate({ flagged: !props.session.flagged })}><Icon name="flag" /></Button> : null}
      {!personal ? <Button variant="ghost" size="icon" aria-label={props.inspectorOpen ? props.t("closeInspector") : props.t("openInspector")} aria-controls="task-inspector" aria-expanded={props.inspectorOpen} onClick={props.onInspectorToggle}><Icon name="panel-right" /></Button> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={props.t("advanced")}><Icon name="more" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {personal ? <DropdownMenuItem disabled={!canPromote} onSelect={() => setPromotionOpen(true)}><Icon name="workspace" />{props.t("moveToWorkFolder")}</DropdownMenuItem> : null}
          {personal ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => updateSession.mutate({ archived: !props.session.archived })}><Icon name={props.session.archived ? "archive-restore" : "archive"} />{props.session.archived ? props.t("restore") : props.t("archive")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)}><Icon name="trash" />{props.t("delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <section className={`task-workbench ${!personal && props.inspectorOpen ? "inspector-visible" : ""}`}>
      <div className="execution-pane">
        {!personal ? <header className="task-context-header">
          <div className="task-context-title">
            <span>{props.workspace?.name ?? props.t("workFolder")}</span>
          </div>
          <div className="task-context-meta">
            <span className={`lifecycle-badge lifecycle-${props.session.status}`}>{lifecycleLabel(props.session, props.t)}</span>
            <span className="folder-path"><Icon name="workspace" size={14} />{props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("workFolder")}</span>
          </div>
          <div className="recommended-action">
            <span>{props.t("nextStep")}</span>
            <Button variant="ghost" onClick={() => {
              if (recommendation.tab) props.onInspectorOpen(recommendation.tab);
              else if (props.session.status === "failed" && retryContent !== "") runPrompt(retryContent);
              else composerInput.current?.focus();
            }}>{recommendation.label}<Icon name="forward" size={14} /></Button>
          </div>
        </header> : null}
        {topbarActionsTarget === null ? null : createPortal(headerActions, topbarActionsTarget)}
        {error ? <Alert className="task-inline-error"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="icon" aria-label={props.t("close")} onClick={() => setError(null)}><Icon name="close" /></Button></Alert> : null}
        <div className="conversation-stage">
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
            onPointerDown={cancelTurnNavigation}
            onTouchStart={cancelTurnNavigation}
            onWheel={cancelTurnNavigation}
            onScroll={(event) => {
              const scroller = event.currentTarget;
              const next = isNearBottom(scroller);
              setFollowStream((current) => current === next ? current : next);
              const visibleTurnId = activeTurnForScroller(scroller, turns);
              const nextTurnId = activeTurnDuringScroll(visibleTurnId, navigatingTurnId.current);
              setActiveTurnId((current) => current === nextTurnId ? current : nextTurnId);
            }}
          >
            {messages.isError ? (
              <TaskSectionError t={props.t} onRetry={() => void messages.refetch()} />
            ) : (messages.data?.length ?? 0) === 0 && pendingPrompt === null ? (
              <div className="conversation-empty">
                <span>{personal ? props.t("privateSandbox") : props.t("taskDescription")}</span>
                <h2>{props.session.goal}</h2>
                <p>{personal ? props.t("privateSandboxDetail") : recommendation.label}</p>
              </div>
            ) : (
              <MessageList
                messages={messages.data ?? []}
                activities={activities.data ?? []}
                attachments={savedAttachments.data ?? []}
                collapsingProcessMessageId={collapsingProcessMessageId}
                t={props.t}
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
              <article className="message user pending"><div>{pendingPrompt}</div></article>
            ) : null}
            {!liveResponsePersisted && (liveProcess.thoughts.length > 0 || liveProcess.tools.length > 0 || liveProcess.notice !== null || streamed !== "") ? (
              <article className="message assistant"><LiveProcessView process={liveProcess} t={props.t} />{streamed !== "" ? <AssistantResult streaming content={streamed} t={props.t} /> : null}</article>
            ) : null}
            {!personal && props.session.status === "awaiting_plan_approval" && plan.data !== null && plan.data !== undefined ? (
              <PlanApprovalCard
                plan={plan.data}
                workingDirectory={props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("workFolder")}
                outputPath={props.workspace?.outputPath ?? null}
                pending={approvePlan.isPending}
                t={props.t}
                onReviewSteps={() => props.onInspectorOpen("plan")}
                onResolve={(approved) => approvePlan.mutate(approved)}
              />
            ) : null}
            {approvals.map((approval) => <ToolApprovalCard key={approval.approvalId} approval={approval} t={props.t} onResolve={(approved) => resolveApproval(approval.approvalId, approved)} />)}
            {send.isPending && streamed === "" ? <div className="inline-progress"><span /><span /><span />{props.t("sending")}</div> : null}
          </div>
        </div>
        <div className="composer-dock">
          {!followStream ? (
            <Button variant="secondary" className="scroll-to-latest" size="icon" type="button" aria-label={props.t("scrollToLatest")} onClick={() => {
              setFollowStream(true);
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
          <Textarea ref={composerInput} className="composer-input" value={input} onChange={(event) => setInput(event.target.value)} onPaste={(event) => {
            const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
            if (image === undefined) return;
            event.preventDefault();
            void image.arrayBuffer()
              .then((buffer) => window.piWork.attachment.fromClipboardImage({
                mimeType: image.type,
                bytes: new Uint8Array(buffer),
              }))
              .then((attachment) => setAttachments((current) => mergeAttachments(current, [attachment])))
              .catch((cause: Error) => setError(cause.message));
          }} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} placeholder={props.t("messagePlaceholder")} rows={2} />
          <div className="composer-toolbar">
            <div className="composer-toolbar-start">
              <Button variant="ghost" size="icon" className="composer-attachment-trigger" type="button" aria-label={props.t("addAttachment")} onClick={() => void window.piWork.attachment.choose().then((selected) => setAttachments((current) => mergeAttachments(current, selected))).catch((cause: Error) => setError(cause.message))}><Icon name="paperclip" /></Button>
              <ComposerPermissionMenu
                permissionMode={props.session.permissionMode}
                planMode={props.session.planMode}
                showPlanMode={!personal}
                disabled={updateSession.isPending || props.session.running}
                t={props.t}
                onPermissionChange={(permissionMode) => updateSession.mutate({ permissionMode })}
                onPlanModeChange={(planMode) => updateSession.mutate({ planMode })}
              />
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
                <Button size="icon" className="send-button" aria-label={props.t("send")} disabled={input.trim() === ""}><Icon name="arrow-up" /></Button>
              )}
            </div>
          </div>
          </form>
        </div>
      </div>
      {!personal ? <TaskInspector
        session={props.session}
        workspace={props.workspace}
        statuses={props.statuses}
        labels={props.labels}
        tab={props.inspectorTab}
        plan={plan.data ?? null}
        planLoading={plan.isLoading}
        planError={plan.isError}
        activities={activities.data ?? []}
        activityLoading={activities.isLoading}
        activityError={activities.isError}
        approvals={approvals}
        artifacts={artifacts.data ?? []}
        artifactsLoading={artifacts.isLoading}
        artifactsError={artifacts.isError}
        generatingPlan={generatePlan.isPending}
        approvingPlan={approvePlan.isPending}
        publishing={publishingAll}
        publishOutcome={publishOutcome}
        publishDestination={props.workspace?.outputPath ?? null}
        completing={complete.isPending}
        t={props.t}
        onTab={props.onInspectorTab}
        onClose={props.onInspectorToggle}
        onUpdateBrief={async (value) => {
          try {
            await window.piWork.task.updateBrief({ taskId: sessionId, ...value });
            await refreshTaskData();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
          }
        }}
        onUpdateSession={(value) => updateSession.mutate(value)}
        onGeneratePlan={() => generatePlan.mutate()}
        onApprovePlan={(approved) => approvePlan.mutate(approved)}
        onResolveApproval={resolveApproval}
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
        onRetryPlan={() => void plan.refetch()}
        onRetryActivity={() => void activities.refetch()}
        onRetryArtifacts={() => void artifacts.refetch()}
        onComplete={() => {
          if (unpublished.length > 0) setCompleteOpen(true);
          else complete.mutate();
        }}
      /> : null}
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
      scrollFrame.current = null;
      const scroller = messageScroller.current;
      if (scroller !== null) scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    });
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
    setFollowStream(false);
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
    setPendingPrompt(content);
    send.mutate(content);
  }
}

function MessageList({ messages, activities, attachments, collapsingProcessMessageId, t, onPreview }: {
  messages: ChatMessage[];
  activities: Activity[];
  attachments: StoredAttachment[];
  collapsingProcessMessageId: string | null;
  t: T;
  onPreview(attachment: StoredAttachment): void;
}) {
  return (
    <div className="messages">
      {messages.map((message) => {
        const startsTurn = message.role === "user";
        const visibleContent = visibleMessageContent(message.content);
        return (
          <div className="message-turn" id={startsTurn ? turnTargetId(message.id) : undefined} key={message.id}>
            <article className={`message ${message.role}`}>
              {message.role === "assistant"
                ? <><HistoricalProcess activities={activities.filter((activity) => (activity.kind === "thinking" || activity.kind === "tool_result") && activity.messageId === message.id)} animateCollapse={message.id === collapsingProcessMessageId} t={t} />{visibleContent !== "" ? <AssistantResult content={visibleContent} t={t} /> : null}</>
                : <><MessageAttachments attachments={attachments.filter((attachment) => attachment.messageId === message.id)} onPreview={onPreview} />{visibleContent !== "" ? <div className="message-user-content">{visibleContent}</div> : null}</>}
            </article>
          </div>
        );
      })}
    </div>
  );
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
  const [collapsing, setCollapsing] = useState(false);
  useEffect(() => {
    if (!animateOnMount || !hasActivities) return;
    const frame = window.requestAnimationFrame(() => setCollapsing(true));
    const timer = window.setTimeout(() => {
      setOpen(false);
      setCollapsing(false);
    }, 220);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [animateOnMount, hasActivities]);
  if (!hasActivities) return null;
  const thoughts = ordered.filter(({ kind }) => kind === "thinking").length;
  const tools = ordered.length - thoughts;
  return (
    <details
      className={`process-group${collapsing ? " is-collapsing" : ""}`}
      open={open}
      onToggle={(event) => {
        if (!collapsing) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon name="chevron-down" size={14} className="process-group-chevron" />
        <span>{processSummary(tools, thoughts, t)}</span>
      </summary>
      <div className="process-group-content">
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
  return (
    <section className={`assistant-result${streaming ? " is-streaming" : ""}`} aria-label={streaming ? t("responseStreaming") : t("result")}>
      {streaming ? (
        <header>
          <span className="assistant-result-icon" aria-hidden="true">
            <Icon name="status" size={14} />
          </span>
          <span>{t("responseStreaming")}</span>
        </header>
      ) : null}
      <MarkdownMessage streaming={streaming} content={content} copyLabel={t("copyCode")} copiedLabel={t("copied")} />
    </section>
  );
}

function ThoughtProcessCard({ activity, t, open = false, label }: {
  activity: Pick<Activity, "id" | "detail">;
  t: T;
  open?: boolean;
  label?: string;
}) {
  const preview = summarizeProcessValue(activity.detail);
  return (
    <details className="thinking-block" open={open}>
      <summary>
        <span className="thinking-marker"><Icon name="skills" size={14} /><Icon name="chevron-down" size={14} className="thinking-chevron" /></span>
        <span className="thinking-label">{label ?? t("thoughtProcess")}</span>
        {preview ? <span className="thinking-preview" title={preview}>{preview}</span> : null}
      </summary>
      <div className="thinking-content"><MarkdownMessage compact content={activity.detail} copyLabel={t("copyCode")} copiedLabel={t("copied")} /></div>
    </details>
  );
}

function LiveProcessView({ process, t }: { process: LiveProcess; t: T }) {
  return (
    <div className="live-process">
      {process.timeline.map((item) => {
        if (item.kind === "thinking") {
          const thought = process.thoughts.find(({ segmentId }) => segmentId === item.segmentId);
          if (thought === undefined || thought.content.trim() === "") return null;
          return (
            <ThoughtProcessCard
              activity={{ id: String(thought.segmentId), detail: thought.content }}
              key={`thinking-${thought.segmentId}`}
              t={t}
              open={!thought.complete}
              label={thought.complete ? t("thoughtProcess") : t("thinkingInProgress")}
            />
          );
        }
        const tool = process.tools.find(({ toolCallId }) => toolCallId === item.toolCallId);
        return tool === undefined ? null : <ToolProcessCard key={`tool-${tool.toolCallId}`} tool={tool} t={t} />;
      })}
      {process.notice ? <div className="process-notice">{process.notice}</div> : null}
    </div>
  );
}

function ToolProcessCard({ tool, t }: { tool: LiveTool; t: T }) {
  const preview = toolPreview(tool.arguments);
  return (
    <details className={`tool-status ${tool.complete ? "is-complete" : "is-running"}${tool.failed ? " is-failed" : ""}`}>
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
      <div className="tool-status-expanded">
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

function toolIcon(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("search") || normalized.includes("web") || normalized.includes("browse")) return "search" as const;
  if (normalized.includes("read") || normalized.includes("write") || normalized.includes("file")) return "file" as const;
  return "terminal" as const;
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

function TaskInspector(props: {
  session: Session;
  workspace: Workspace | null;
  statuses: StatusDefinition[];
  labels: Label[];
  tab: InspectorTab;
  plan: Plan | null;
  planLoading: boolean;
  planError: boolean;
  activities: Activity[];
  activityLoading: boolean;
  activityError: boolean;
  approvals: ToolApproval[];
  artifacts: Artifact[];
  artifactsLoading: boolean;
  artifactsError: boolean;
  generatingPlan: boolean;
  approvingPlan: boolean;
  publishing: boolean;
  completing: boolean;
  t: T;
  onTab(tab: InspectorTab): void;
  onClose(): void;
  onUpdateBrief(value: { title?: string; goal?: string }): Promise<void>;
  onUpdateSession(value: Record<string, unknown>): void;
  onGeneratePlan(): void;
  onApprovePlan(approved: boolean): void;
  onResolveApproval(approvalId: string, approved: boolean): void;
  onPublish(artifact: Artifact): Promise<void>;
  onPublishAll(): void;
  publishOutcome: { published: number; failed: number } | null;
  publishDestination: string | null;
  onRetryPlan(): void;
  onRetryActivity(): void;
  onRetryArtifacts(): void;
  onComplete(): void;
}) {
  const [title, setTitle] = useState(props.session.title);
  const [goal, setGoal] = useState(props.session.goal);
  const [saving, setSaving] = useState(false);
  const unpublished = props.artifacts.filter(({ publishedPath }) => publishedPath === null);
  return (
    <aside className="task-inspector" id="task-inspector">
      <header className="inspector-header">
        <Tabs value={props.tab} onValueChange={(value) => props.onTab(value as InspectorTab)}>
          <TabsList className="inspector-tabs">
            <TabsTrigger value="task">{props.t("task")}</TabsTrigger>
            <TabsTrigger value="plan">{props.t("plan")}</TabsTrigger>
            <TabsTrigger value="activity">{props.t("activity")}</TabsTrigger>
            <TabsTrigger value="output">{props.t("results")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon" aria-label={props.t("closeInspector")} onClick={props.onClose}><Icon name="close" /></Button>
      </header>
      <div className="inspector-body">
        {props.tab === "task" ? (
          <div className="inspector-section-stack">
            <InspectorSection title={props.t("taskDescription")}>
              <FieldGroup>
                <Field><FieldLabel>{props.t("taskTitle")}</FieldLabel><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                <Field><FieldLabel>{props.t("goal")}</FieldLabel><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={7} /></Field>
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
            <InspectorSection title={props.t("currentFolder")}><code className="path-block">{props.session.workingDirectory ?? props.workspace?.rootPath ?? props.t("personal")}</code></InspectorSection>
          </div>
        ) : null}
        {props.tab === "plan" ? (
          <InspectorSection title={props.t("plan")}>
            {props.planError ? <TaskSectionError t={props.t} onRetry={props.onRetryPlan} /> : props.planLoading ? <InspectorLoading t={props.t} /> : props.plan === null ? (
              <div className="inspector-empty"><Icon name="plan" /><p>{props.t("planEmpty")}</p><Button onClick={props.onGeneratePlan} disabled={props.generatingPlan}>{props.generatingPlan ? props.t("sending") : props.t("generatePlan")}</Button></div>
            ) : (
              <div className="plan-detail">
                <p className="plan-summary">{props.plan.summary}</p>
                <ol>{props.plan.steps.map((step, index) => <li key={step.id}><span>{index + 1}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol>
                {props.plan.sources.length ? <div className="plan-sources"><strong>{props.t("planSources")}</strong>{props.plan.sources.map((source) => <code key={source}>{source}</code>)}</div> : null}
                <Alert className="plan-edit-note"><AlertDescription>{props.t("editBriefFirst")}</AlertDescription></Alert>
                <div className="inspector-actions">
                  <Button variant="outline" onClick={props.onGeneratePlan} disabled={props.generatingPlan || props.approvingPlan}>{props.t("regeneratePlan")}</Button>
                  {props.session.status === "awaiting_plan_approval" ? <><Button variant="ghost" disabled={props.approvingPlan} onClick={() => props.onApprovePlan(false)}>{props.t("rejectPlan")}</Button><Button disabled={props.approvingPlan} onClick={() => props.onApprovePlan(true)}>{props.approvingPlan ? props.t("sending") : props.t("approvePlan")}</Button></> : null}
                </div>
              </div>
            )}
          </InspectorSection>
        ) : null}
        {props.tab === "activity" ? (
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
        {props.tab === "output" ? (
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
    </aside>
  );
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

function PlanApprovalCard(props: {
  plan: Plan;
  workingDirectory: string;
  outputPath: string | null;
  pending: boolean;
  t: T;
  onReviewSteps(): void;
  onResolve(approved: boolean): void;
}) {
  const { plan, t } = props;
  const headingId = useId();
  return (
    <article className="approval-card plan" role="group" aria-labelledby={headingId}>
      <div className="approval-symbol"><Icon name="plan" /></div>
      <div className="approval-copy">
        <span>{t("planRequest")}</span>
        <h3 id={headingId}>{plan.summary}</h3>
        <p><strong>{t("workingDirectory")}</strong><code>{props.workingDirectory}</code></p>
        {props.outputPath !== null ? <p><strong>{t("planPublishesTo")}</strong><code>{props.outputPath}</code></p> : null}
        <p><strong>{t("planSteps")}</strong><code>{plan.steps.length}</code></p>
        {plan.sources.length > 0 ? <p><strong>{t("planSources")}</strong><code>{plan.sources.length}</code></p> : null}
        <p className="approval-scope-note">{t("planScopeNote")}</p>
        <Button variant="ghost" size="sm" className="approval-review-link" onClick={props.onReviewSteps}>
          {t("planReviewSteps")}<Icon name="forward" size={14} />
        </Button>
      </div>
      <div className="approval-actions">
        <Button variant="ghost" size="sm" disabled={props.pending} onClick={() => props.onResolve(false)}>{t("rejectPlan")}</Button>
        <Button size="sm" disabled={props.pending} onClick={() => props.onResolve(true)}>{props.pending ? t("sending") : t("approvePlan")}</Button>
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
    running: "lifecycleRunning",
    awaiting_action_approval: "lifecycleAwaitingAction",
    reviewing: "lifecycleReviewing",
    completed: "lifecycleCompleted",
    failed: "lifecycleFailed",
    cancelled: "lifecycleCancelled",
  }[session.status] as MessageKey;
  return t(key);
}

function recommendedAction(session: Session, unpublished: number, approvals: number, t: T): { label: string; tab?: InspectorTab } {
  if (session.status === "awaiting_plan_approval") return { label: t("planApprovalNeeded"), tab: "plan" };
  if (approvals > 0 || session.status === "awaiting_action_approval") return { label: t("actionApprovalNeeded"), tab: "activity" };
  if (unpublished > 0) return { label: t("unpublishedNeeded"), tab: "output" };
  if (session.running) return { label: t("runningNow"), tab: "activity" };
  if (session.status === "failed") return { label: t("retry") };
  if ((session.status === "draft" || session.status === "planning") && session.planMode) return { label: t("generatePlanNext"), tab: "plan" };
  if (session.status === "completed" || session.status === "cancelled") return { label: t("finished"), tab: "output" };
  return { label: t("continueTask") };
}
