import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Activity,
  AppSettings,
  Artifact,
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
import { MarkdownMessage } from "../components/markdown-message.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "../components/ui/attachment.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
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
} from "../components/ui/dropdown-menu.js";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.js";
import { Icon } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Textarea } from "../components/ui/textarea.js";
import { thinkingLevelLabel } from "../i18n.js";
import type { MessageKey } from "../i18n.js";
import type { InspectorTab } from "../store.js";

type T = (key: MessageKey) => string;

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

function attachmentPreviewUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) => index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment))
    .join("/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${encoded}`;
}

function attachmentDescription(attachment: AttachmentDraft): string {
  const subtype = attachment.mimeType.split("/").at(-1)?.split("+").at(0)?.toLocaleUpperCase() ?? "FILE";
  return `${subtype} · ${formatBytes(attachment.size)}`;
}

function ComposerAttachment(props: {
  attachment: AttachmentDraft;
  removeLabel: string;
  onRemove(): void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const image = props.attachment.mimeType.startsWith("image/") && !thumbnailFailed;
  return (
    <Attachment size="sm" className="composer-attachment">
      <AttachmentMedia>
        {image ? (
          <img
            src={attachmentPreviewUrl(props.attachment.path)}
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="composer-permission-trigger"
          aria-label={`${props.t("confirmation")}: ${permission}`}
          disabled={props.disabled}
        >
          <Icon name="lock" />
          <span>{permission}</span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="composer-permission-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{props.t("confirmation")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={props.permissionMode} onValueChange={(value) => props.onPermissionChange(value as PermissionMode)}>
            <DropdownMenuRadioItem value="ask">{props.t("askEveryTime")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="explore">{props.t("exploreOnly")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="auto">{props.t("automatic")}</DropdownMenuRadioItem>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="composer-model-trigger"
          aria-label={`${props.t("model")}: ${props.activeModel?.modelName ?? props.t("noModel")}; ${props.t("thinking")}: ${thinking}`}
          disabled={props.disabled}
        >
          <span className="composer-model-summary">
            <span>{props.activeModel?.modelName ?? props.t("noModel")}</span>
            <span>{thinking}</span>
          </span>
          <Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="composer-execution-menu">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span>{props.t("model")}</span>
              <span className="composer-menu-value" title={props.activeModel ? `${props.activeModel.providerName} · ${props.activeModel.modelName}` : undefined}>
                {props.activeModel?.modelName ?? props.t("noModel")}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="composer-model-submenu">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{props.t("model")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={props.activeModelKey} onValueChange={props.onModelChange}>
                  {props.models.map((model) => {
                    const key = `${model.providerId}/${model.modelId}`;
                    return (
                      <DropdownMenuRadioItem key={key} value={key}>
                        <span className="composer-model-option">
                          <strong>{model.modelName}</strong>
                          <small>{model.providerName}</small>
                        </span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={props.activeModel === undefined}>
              <span>{props.t("thinking")}</span>
              <span className="composer-menu-value">{thinking}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{props.t("thinking")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={props.thinkingLevel} onValueChange={props.onThinkingChange}>
                  {props.thinkingLevels.map((level) => (
                    <DropdownMenuRadioItem key={level} value={level}>
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
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionWorkspaceId, setPromotionWorkspaceId] = useState(props.folders[0]?.id ?? "");
  const [publishingAll, setPublishingAll] = useState(false);
  const [providerId, setProviderId] = useState(props.session.providerId ?? props.settings?.providerId ?? "");
  const [modelId, setModelId] = useState(props.session.modelId ?? props.settings?.modelId ?? "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(props.session.thinkingLevel);
  const messageScroller = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const streamQueue = useRef("");
  const streamTimer = useRef<number | null>(null);
  const streamWaiters = useRef<Array<() => void>>([]);

  const messages = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => window.piWork.session.messages(sessionId),
  });
  const activities = useQuery({
    queryKey: ["activities", sessionId],
    queryFn: () => window.piWork.session.activities(sessionId),
    refetchInterval: props.session.running ? 1_000 : false,
  });
  const savedAttachments = useQuery({
    queryKey: ["attachments", sessionId],
    queryFn: () => window.piWork.session.attachments(sessionId),
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
    if (event.kind !== "text_delta") void queryClient.invalidateQueries({ queryKey: ["activities", sessionId] });
  }), [queryClient, sessionId]);
  useEffect(() => () => {
    if (streamTimer.current !== null) window.clearTimeout(streamTimer.current);
    streamWaiters.current.splice(0).forEach((resolve) => resolve());
  }, []);
  useEffect(() => {
    const scroller = messageScroller.current;
    if (scroller !== null) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [approvals.length, messages.data?.length, pendingPrompt, streamed]);
  useEffect(() => {
    if (personal) return;
    if (props.session.status === "awaiting_plan_approval") props.onInspectorOpen("plan");
    else if (approvals.length > 0 || props.session.status === "awaiting_action_approval") props.onInspectorOpen("activity");
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
      queryClient.invalidateQueries({ queryKey: ["activities", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["plan", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["artifacts", sessionId] }),
      queryClient.invalidateQueries({ queryKey: ["tool-approvals"] }),
    ]);
  };
  const send = useMutation({
    mutationFn: (content: string) => {
      clearStream();
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
      await waitForStream();
      setInput("");
      setAttachments([]);
      localStorage.removeItem(draftKey);
      setPendingPrompt(null);
      clearStream();
      await refreshTaskData();
    },
    onError: (cause: Error) => {
      setPendingPrompt(null);
      clearStream();
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
  const retryContent = input.trim() || [...(messages.data ?? [])].reverse().find(({ role }) => role === "user")?.content.trim() || "";
  const canPromote = personal && !props.session.running && approvals.length === 0 && props.folders.length > 0;
  return (
    <section className={`task-workbench ${!personal && props.inspectorOpen ? "inspector-visible" : ""}`}>
      <div className="execution-pane">
        <header className="task-context-header">
          <div className="task-context-title">
            <span>{personal ? props.t("privateSandbox") : (props.workspace?.name ?? props.t("workFolder"))}</span>
            <h1>{props.session.title}</h1>
          </div>
          {!personal ? (
            <>
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
            </>
          ) : null}
          <div className="task-header-actions">
            {!personal ? <Button variant="ghost" size="icon" aria-label={props.session.flagged ? props.t("unflag") : props.t("flag")} onClick={() => updateSession.mutate({ flagged: !props.session.flagged })}><Icon name="flag" /></Button> : null}
            {!personal ? <Button variant="ghost" size="icon" aria-label={props.inspectorOpen ? props.t("closeInspector") : props.t("openInspector")} onClick={props.onInspectorToggle}><Icon name="panel-right" /></Button> : null}
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
        </header>
        {error ? <Alert className="task-inline-error"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="icon" aria-label={props.t("close")} onClick={() => setError(null)}><Icon name="close" /></Button></Alert> : null}
        <div className="message-scroller" ref={messageScroller}>
          {messages.isError ? (
            <TaskSectionError t={props.t} onRetry={() => void messages.refetch()} />
          ) : (messages.data?.length ?? 0) === 0 && pendingPrompt === null ? (
            <div className="conversation-empty">
              <span>{personal ? props.t("privateSandbox") : props.t("taskDescription")}</span>
              <h2>{props.session.goal}</h2>
              <p>{personal ? props.t("privateSandboxDetail") : recommendation.label}</p>
            </div>
          ) : (
            <MessageList messages={messages.data ?? []} t={props.t} />
          )}
          {savedAttachments.data?.length ? (
            <div className="attachment-strip">{savedAttachments.data.map((attachment) => (
              <Button variant="secondary" key={attachment.id} onClick={() => void window.piWork.attachment.open(attachment.id)}>
                <Icon name="file" /><span>{attachment.name}<small>{formatBytes(attachment.size)}</small></span>
              </Button>
            ))}</div>
          ) : null}
          {pendingPrompt !== null ? (
            <article className="message user pending"><span>{props.t("you")}</span><div>{pendingPrompt}</div></article>
          ) : null}
          {streamed !== "" ? (
            <article className="message assistant"><span>{props.t("pi")}</span><MarkdownMessage streaming content={streamed} copyLabel={props.t("copyCode")} copiedLabel={props.t("copied")} /></article>
          ) : null}
          {approvals.map((approval) => <ToolApprovalCard key={approval.approvalId} approval={approval} t={props.t} onResolve={(approved) => resolveApproval(approval.approvalId, approved)} />)}
          {send.isPending && streamed === "" ? <div className="inline-progress"><span /><span /><span />{props.t("sending")}</div> : null}
        </div>
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
                />
              ))}
            </AttachmentGroup>
          ) : null}
          <Textarea ref={composerInput} className="composer-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} placeholder={props.t("messagePlaceholder")} rows={2} />
          <div className="composer-toolbar">
            <div className="composer-toolbar-start">
              <Button variant="ghost" size="icon" type="button" aria-label={props.t("addAttachment")} onClick={() => void window.piWork.attachment.choose().then((selected) => setAttachments((current) => mergeAttachments(current, selected))).catch((cause: Error) => setError(cause.message))}><Icon name="paperclip" /></Button>
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
          {props.session.permissionMode === "auto" ? (
            <Alert className="composer-risk-alert">
              <AlertDescription>{props.t("automaticRisk")}</AlertDescription>
            </Alert>
          ) : null}
        </form>
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
          try {
            await window.piWork.artifact.publish({ artifactId: artifact.id });
            await refreshTaskData();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
          }
        }}
        onPublishAll={async () => {
          setPublishingAll(true);
          try {
            for (const artifact of unpublished) await window.piWork.artifact.publish({ artifactId: artifact.id });
            await refreshTaskData();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : props.t("failedToLoad"));
          } finally {
            setPublishingAll(false);
          }
        }}
        onRetryPlan={() => void plan.refetch()}
        onRetryActivity={() => void activities.refetch()}
        onRetryArtifacts={() => void artifacts.refetch()}
        onComplete={() => {
          if (unpublished.length > 0) setCompleteOpen(true);
          else complete.mutate();
        }}
      /> : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("delete")}</AlertDialogTitle><AlertDialogDescription>“{props.session.title}”</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={props.onDelete}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("completeWithUnpublished")}</AlertDialogTitle><AlertDialogDescription>{props.t("unpublishedWarning")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => complete.mutate()}>{props.t("completeTask")}</AlertDialogAction></AlertDialogFooter>
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

  function waitForStream(): Promise<void> {
    if (streamQueue.current === "" && streamTimer.current === null) return Promise.resolve();
    return new Promise((resolve) => streamWaiters.current.push(resolve));
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

function MessageList({ messages, t }: { messages: ChatMessage[]; t: T }) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <span>{message.role === "user" ? t("you") : message.role === "assistant" ? t("pi") : t("system")}</span>
          {message.role === "assistant"
            ? <MarkdownMessage content={message.content} copyLabel={t("copyCode")} copiedLabel={t("copied")} />
            : <div>{message.content}</div>}
        </article>
      ))}
    </div>
  );
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
  onPublishAll(): Promise<void>;
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
    <aside className="task-inspector">
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
                <Alert className="publish-note"><AlertDescription>{props.t("publishTarget")}</AlertDescription></Alert>
                {props.artifacts.map((artifact) => <ArtifactPreview key={artifact.id} artifact={artifact} t={props.t} onPublish={() => props.onPublish(artifact)} />)}
                {unpublished.length > 1 ? <Button variant="outline" disabled={props.publishing} onClick={() => void props.onPublishAll()}>{props.t("publishAll")}</Button> : null}
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
  return (
    <article className={`timeline-item timeline-${activity.kind}`}>
      <span className="timeline-marker"><Icon name={activity.kind === "error" ? "alert" : activity.kind === "file_change" ? "file" : activity.kind === "tool_call" ? "terminal" : "status"} size={14} /></span>
      <div><time>{new Date(activity.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><strong>{activityTitle(activity.kind, t)}</strong>{activity.detail ? <p>{activity.detail}</p> : null}{Object.keys(activity.metadata).length ? <details><summary>{t("technicalDetails")}</summary><pre>{JSON.stringify(activity.metadata, null, 2)}</pre></details> : null}</div>
    </article>
  );
}

function ToolApprovalCard(props: { approval: ToolApproval; compact?: boolean; t: T; onResolve(approved: boolean): void }) {
  const { approval, t } = props;
  const path = argumentString(approval.arguments, ["path", "filePath", "file_path", "target", "targetPath"]);
  const command = argumentString(approval.arguments, ["command", "cmd", "script"]);
  const title = approval.tool === "bash" ? t("runCommand") : approval.tool === "write" ? t("writeFile") : t("editFile");
  return (
    <article className={`approval-card ${props.compact ? "compact" : ""}`}>
      <div className="approval-symbol"><Icon name={approval.tool === "bash" ? "terminal" : "file"} /></div>
      <div className="approval-copy">
        <span>{t("toolRequest")}</span>
        <h3>{title}</h3>
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
      <header><div><Icon name="file" /><span><strong>{props.artifact.relativePath}</strong><small>{props.artifact.mimeType}</small></span></div><Badge>{props.artifact.publishedPath === null ? props.t("staged") : props.t("published")}</Badge></header>
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
