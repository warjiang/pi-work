import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  AttachmentDraft,
  Automation,
  ChatMessage,
  ModelOption,
  PermissionMode,
  Project,
  Session,
  Skill,
  Source,
  ThinkingLevel,
  ToolApproval,
  Workspace,
} from "@pi-work/protocol";
import { MarkdownMessage } from "./components/markdown-message.js";
import { PiMark } from "./components/pi-mark.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { Empty, EmptyDescription } from "./components/ui/empty.js";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field.js";
import { Icon } from "./components/ui/icon.js";
import type { IconName } from "./components/ui/icon.js";
import { Input } from "./components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js";
import { Spinner } from "./components/ui/spinner.js";
import { Switch } from "./components/ui/switch.js";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { Textarea } from "./components/ui/textarea.js";
import { Toggle } from "./components/ui/toggle.js";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group.js";
import { translator } from "./i18n.js";
import type { MessageKey } from "./i18n.js";
import { useWorkspaceUi } from "./store.js";

type View = ReturnType<typeof useWorkspaceUi.getState>["view"];

function titleFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatBytes(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function mergeAttachments(current: AttachmentDraft[], selected: AttachmentDraft[]): AttachmentDraft[] {
  return [...new Map([...current, ...selected].map((attachment) => [attachment.path, attachment])).values()].slice(0, 20);
}

function nextThinking(model: ModelOption | undefined, current: ThinkingLevel): ThinkingLevel {
  if (model?.thinkingLevels.includes(current)) return current;
  return model?.thinkingLevels.includes("medium") ? "medium" : (model?.thinkingLevels[0] ?? "off");
}

export function App() {
  const queryClient = useQueryClient();
  const ui = useWorkspaceUi();
  const searchRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.piWork.settings.get() });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => window.piWork.workspace.list() });
  const sessions = useQuery({
    queryKey: ["sessions", ui.search],
    queryFn: () => window.piWork.session.list({ query: ui.search }),
  });
  const language = settings.data?.language ?? "en";
  const t = translator(language);

  useEffect(() => {
    const theme = settings.data?.theme ?? "system";
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
  }, [language, settings.data?.theme]);
  useEffect(() => {
    document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? "darwin" : "other";
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        ui.newChat();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        ui.toggleSidebar();
      }
      if (event.key === "Escape" && ui.search !== "") ui.setSearch("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ui.search]);

  const selectedSession = sessions.data?.find(({ id }) => id === ui.selectedTaskId) ?? null;
  const selectedWorkspace = (workspaces.data ?? []).find(({ id }) => id === (
    selectedSession?.workspaceId ?? ui.selectedWorkspaceId
  )) ?? null;
  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  }

  const chooseWorkspace = useMutation({
    mutationFn: () => window.piWork.workspace.choose(),
    onSuccess: async (workspace) => {
      await refresh();
      if (workspace !== null) ui.selectWorkspace(workspace.id);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const updateSession = useMutation({
    mutationFn: (input: { sessionId: string } & Record<string, unknown>) => window.piWork.session.update(input),
    onSuccess: async (_session, input) => {
      if (input.archived === true) ui.newChat();
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const removeSession = useMutation({
    mutationFn: (sessionId: string) => window.piWork.session.remove(sessionId),
    onSuccess: async () => {
      ui.newChat();
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const onboarding = settings.isSuccess && !settings.data.onboardingSkipped;

  return (
    <div className={`desktop ${ui.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <TopBar
        search={ui.search}
        searchRef={searchRef}
        t={t}
        workspace={selectedWorkspace}
        onSearch={ui.setSearch}
        onToggleSidebar={ui.toggleSidebar}
      />
      <Sidebar
        sessions={sessions.data ?? []}
        sessionFilter={ui.sessionFilter}
        selectedSessionId={ui.selectedTaskId}
        selectedWorkspaceId={ui.selectedWorkspaceId}
        workspaces={workspaces.data ?? []}
        view={ui.view}
        t={t}
        onAddWorkspace={() => chooseWorkspace.mutate()}
        onNew={ui.newChat}
        onSelect={(session) => ui.selectConversation(session.workspaceId, session.id)}
        onSelectWorkspace={ui.selectWorkspace}
        onSessionFilter={ui.showInbox}
        onView={ui.showView}
      />
      <main className="main-panel">
        {error !== null ? <Alert className="inline-error"><AlertDescription>{error}</AlertDescription><Button variant="ghost" size="icon" aria-label="Close" onClick={() => setError(null)}><Icon name="close" /></Button></Alert> : null}
        {ui.view === "inbox" ? (
          <Chat
            key={selectedSession?.id ?? `new:${ui.selectedWorkspaceId ?? "managed"}`}
            session={selectedSession}
            workspace={selectedWorkspace}
            settings={settings.data}
            onCreated={(session) => {
              void refresh();
              ui.selectConversation(session.workspaceId, session.id);
            }}
            onError={setError}
            onUpdate={(value) => updateSession.mutate(value)}
            onDelete={(id) => removeSession.mutate(id)}
            t={t}
          />
        ) : null}
        {ui.view === "projects" ? <ProjectsPage sessions={sessions.data ?? []} workspaceId={ui.selectedWorkspaceId} t={t} onOpen={(session) => ui.selectConversation(session.workspaceId, session.id)} onRefresh={refresh} /> : null}
        {ui.view === "browser" ? <BrowserPage session={selectedSession} t={t} /> : null}
        {ui.view === "sources" ? <SourcesPage workspaceId={ui.selectedWorkspaceId} t={t} /> : null}
        {ui.view === "skills" ? <SkillsPage workspaceId={ui.selectedWorkspaceId} t={t} /> : null}
        {ui.view === "automations" ? <AutomationsPage workspaceId={ui.selectedWorkspaceId} t={t} /> : null}
        {ui.view === "settings" ? <SettingsPage settings={settings.data} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["settings"] })} t={t} /> : null}
      </main>
      <Dialog open={onboarding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3"><PiMark />Pi Work</DialogTitle>
            <DialogDescription>{language === "zh-CN" ? "连接模型提供商后开始，也可以先浏览本地工作区。" : "Connect a model provider to begin, or explore a local workspace first."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void window.piWork.settings.update({ onboardingSkipped: true }).then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))}>
              {language === "zh-CN" ? "稍后设置" : "Set up later"}
            </Button>
            <Button onClick={() => void window.piWork.settings.update({ onboardingSkipped: true }).then(async () => {
              await queryClient.invalidateQueries({ queryKey: ["settings"] });
              ui.showSettings();
            })}>{t("settings")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TopBar(props: {
  search: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  workspace: Workspace | null;
  t: (key: MessageKey) => string;
  onSearch(value: string): void;
  onToggleSidebar(): void;
}) {
  return (
    <header className="topbar">
      <Button variant="ghost" size="icon" className="icon-button" aria-label="Toggle sidebar" onClick={props.onToggleSidebar}><Icon name="panel" /></Button>
      <div className="history-controls"><Button variant="ghost" size="icon" aria-label="Back" disabled><Icon name="back" /></Button><Button variant="ghost" size="icon" aria-label="Forward" disabled><Icon name="forward" /></Button></div>
      <Button variant="ghost" className="workspace-switcher"><PiMark size="compact" /><span>{props.workspace?.name ?? "Pi Work"}</span><Icon name="chevron-down" size={14} /></Button>
      <label className="global-search">
        <Icon name="search" />
        <Input className="global-search-input" ref={props.searchRef} value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={props.t("search")} />
        <kbd>⌘K</kbd>
      </label>
    </header>
  );
}

function Sidebar(props: {
  sessions: Session[];
  sessionFilter: "all" | "flagged" | "archived";
  workspaces: Workspace[];
  selectedSessionId: string | null;
  selectedWorkspaceId: string | null;
  view: View;
  t: (key: MessageKey) => string;
  onNew(): void;
  onSessionFilter(filter: "all" | "flagged" | "archived"): void;
  onView(view: View): void;
  onSelect(session: Session): void;
  onSelectWorkspace(id: string): void;
  onAddWorkspace(): void;
}) {
  const recent = props.sessions.filter((session) => {
    if (props.sessionFilter === "archived") return session.archived;
    if (props.sessionFilter === "flagged") return session.flagged && !session.archived;
    return !session.archived;
  }).slice(0, 30);
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><PiMark /><strong>Pi Work</strong></div>
      <Button variant="outline" className="new-chat" onClick={props.onNew}><Icon name="square-pen" />{props.t("newChat")}<kbd>⌘N</kbd></Button>
      <nav className="primary-nav">
        <NavButton active={props.view === "inbox" && props.sessionFilter === "all"} icon="inbox" label={props.t("inbox")} onClick={() => props.onSessionFilter("all")} />
        <NavButton active={props.view === "inbox" && props.sessionFilter === "flagged"} icon="flag" label={props.t("flagged")} badge={props.sessions.filter(({ flagged, archived }) => flagged && !archived).length} onClick={() => props.onSessionFilter("flagged")} />
        <NavButton active={props.view === "inbox" && props.sessionFilter === "archived"} icon="archive" label={props.t("archived")} badge={props.sessions.filter(({ archived }) => archived).length} onClick={() => props.onSessionFilter("archived")} />
      </nav>
      <div className="sidebar-section">
        <div className="sidebar-heading"><span>{props.t("allSessions")}</span><span>{recent.length}</span></div>
        <div className="session-list">
          {recent.map((session) => (
            <Button variant="ghost" className={`session-row ${session.id === props.selectedSessionId && props.view === "inbox" ? "selected" : ""}`} key={session.id} onClick={() => props.onSelect(session)}>
              <span className={`status-dot ${session.running ? "running" : ""}`} />
              <span><strong>{session.title}</strong><small>{session.permissionMode === "auto" ? "Auto" : session.permissionMode === "explore" ? "Explore" : "Ask"}</small></span>
              {session.flagged ? <Icon name="flag" size={14} /> : null}
            </Button>
          ))}
          {recent.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
        </div>
      </div>
      <nav className="secondary-nav">
        <NavButton active={props.view === "projects"} icon="folder-kanban" label={props.t("projects")} onClick={() => props.onView("projects")} />
        <NavButton active={props.view === "sources"} icon="source" label={props.t("sources")} onClick={() => props.onView("sources")} />
        <NavButton active={props.view === "skills"} icon="skills" label={props.t("skills")} onClick={() => props.onView("skills")} />
        <NavButton active={props.view === "automations"} icon="list-todo" label={props.t("automations")} onClick={() => props.onView("automations")} />
        <NavButton active={props.view === "browser"} icon="browser" label={props.t("browser")} onClick={() => props.onView("browser")} />
      </nav>
      <div className="workspace-list">
        <div className="sidebar-heading"><span>{props.t("workspaces")}</span><Button variant="ghost" size="icon" aria-label={props.t("add")} onClick={props.onAddWorkspace}><Icon name="plus" size={14} /></Button></div>
        {props.workspaces.filter(({ kind }) => kind === "folder").map((workspace) => (
          <Button variant="ghost" className={workspace.id === props.selectedWorkspaceId ? "workspace-row selected" : "workspace-row"} key={workspace.id} onClick={() => props.onSelectWorkspace(workspace.id)}>
            <Icon name="workspace" /><span><strong>{workspace.name}</strong><small>{titleFromPath(workspace.rootPath)}</small></span>
          </Button>
        ))}
      </div>
      <Button variant="ghost" className={`settings-row ${props.view === "settings" ? "selected" : ""}`} onClick={() => props.onView("settings")}><Icon name="settings" />{props.t("settings")}</Button>
    </aside>
  );
}

function NavButton(props: { active: boolean; icon: IconName; label: string; badge?: number; onClick(): void }) {
  return <Button variant="ghost" className={props.active ? "nav-button selected" : "nav-button"} onClick={props.onClick}><Icon name={props.icon} /><strong>{props.label}</strong>{props.badge ? <Badge>{props.badge}</Badge> : null}</Button>;
}

function Chat(props: {
  session: Session | null;
  workspace: Workspace | null;
  settings: AppSettings | undefined;
  t: (key: MessageKey) => string;
  onCreated(session: Session): void;
  onUpdate(input: { sessionId: string } & Record<string, unknown>): void;
  onDelete(id: string): void;
  onError(message: string): void;
}) {
  const queryClient = useQueryClient();
  const draftKey = `pi-work:draft:${props.session?.id ?? props.workspace?.id ?? "new"}`;
  const [input, setInput] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(props.session?.permissionMode ?? "ask");
  const [planMode, setPlanMode] = useState(props.session?.planMode ?? false);
  const [providerId, setProviderId] = useState(props.session?.providerId ?? props.settings?.providerId ?? "");
  const [modelId, setModelId] = useState(props.session?.modelId ?? props.settings?.modelId ?? "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(props.session?.thinkingLevel ?? props.settings?.thinkingLevel ?? "off");
  const [approvals, setApprovals] = useState<ToolApproval[]>([]);
  const [streamed, setStreamed] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.session?.title ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const activeSessionId = useRef(props.session?.id ?? null);
  const messageScroller = useRef<HTMLDivElement>(null);
  const streamQueue = useRef("");
  const streamTimer = useRef<number | null>(null);
  const streamWaiters = useRef<Array<() => void>>([]);
  const messages = useQuery({
    queryKey: ["messages", props.session?.id],
    queryFn: () => window.piWork.session.messages(props.session?.id ?? ""),
    enabled: props.session !== null,
  });
  const savedAttachments = useQuery({
    queryKey: ["attachments", props.session?.id],
    queryFn: () => window.piWork.session.attachments(props.session?.id ?? ""),
    enabled: props.session !== null,
  });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const models = useQuery({ queryKey: ["models"], queryFn: () => window.piWork.model.list() });
  const configured = new Set((providers.data ?? []).map(({ providerId: id }) => id));
  const availableModels = (models.data?.models ?? []).filter((model) => configured.has(model.providerId));
  const selectedModel = availableModels.find((model) => model.providerId === providerId && model.modelId === modelId);

  useEffect(() => {
    localStorage.setItem(draftKey, input);
  }, [draftKey, input]);
  useEffect(() => window.piWork.chat.onToolApproval((approval) => {
    activeSessionId.current ??= approval.sessionId;
    if (approval.sessionId === activeSessionId.current) {
      setApprovals((current) => [...current, approval]);
    }
  }), []);
  useEffect(() => window.piWork.agent.onEvent(({ sessionId, event }) => {
    activeSessionId.current ??= sessionId;
    if (sessionId !== activeSessionId.current) return;
    if (event.kind === "text_delta") {
      const delta = event.payload.delta;
      if (typeof delta === "string") enqueueStream(delta);
    }
  }), []);
  useEffect(() => {
    const sessionId = props.session?.id ?? null;
    if (sessionId === activeSessionId.current) return;
    activeSessionId.current = sessionId;
    clearStream();
    setPendingPrompt(null);
    setApprovals([]);
  }, [props.session?.id]);
  useEffect(() => () => {
    if (streamTimer.current !== null) window.clearTimeout(streamTimer.current);
    streamWaiters.current.splice(0).forEach((resolve) => resolve());
  }, []);
  useEffect(() => {
    const scroller = messageScroller.current;
    if (scroller !== null) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [approvals.length, messages.data?.length, pendingPrompt, streamed]);
  useEffect(() => {
    if (selectedModel !== undefined) return;
    const fallback = availableModels[0];
    if (fallback !== undefined) {
      setProviderId(fallback.providerId);
      setModelId(fallback.modelId);
      setThinkingLevel(nextThinking(fallback, thinkingLevel));
    }
  }, [availableModels.length, selectedModel]);

  const send = useMutation({
    mutationFn: (content: string) => {
      clearStream();
      if (providerId === "" || modelId === "") throw new Error("Configure a model provider in Settings.");
      return window.piWork.chat.send({
        workspaceId: props.workspace?.id ?? null,
        taskId: props.session?.id ?? null,
        content,
        providerId,
        modelId,
        thinkingLevel,
        permissionMode,
        planMode,
        attachments,
      });
    },
    onSuccess: async (session) => {
      await waitForStream();
      await queryClient.invalidateQueries({ queryKey: ["messages", session.id] });
      if (activeSessionId.current === session.id) {
        setInput("");
        setAttachments([]);
        localStorage.removeItem(draftKey);
        props.onCreated(session);
        setPendingPrompt(null);
        clearStream();
      }
    },
    onError: (cause: Error) => {
      setPendingPrompt(null);
      clearStream();
      props.onError(cause.message);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (content !== "") {
      setPendingPrompt(content);
      send.mutate(content);
    }
  }

  return (
    <section className="chat-panel">
      <header className="content-header">
        <div><span className="header-context">{props.workspace?.name ?? props.t("personal")}</span><h1>{props.session?.title ?? props.t("newChat")}</h1></div>
        {props.session ? (
          <div className="header-actions">
            <Button variant="ghost" size="icon" title={props.session.flagged ? props.t("unflag") : props.t("flag")} onClick={() => props.onUpdate({ sessionId: props.session!.id, flagged: !props.session!.flagged })}><Icon name="flag" /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`${props.t("rename")}, ${props.t("archive")}, ${props.t("delete")}`}><Icon name="more" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => {
                    setRenameTitle(props.session?.title ?? "");
                    setRenameOpen(true);
                  }}><Icon name="rename" />{props.t("rename")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => props.onUpdate({ sessionId: props.session!.id, archived: !props.session!.archived })}>
                    <Icon name={props.session.archived ? "archive-restore" : "archive"} />
                    {props.session.archived ? props.t("restore") : props.t("archive")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="text-[var(--danger)]" onSelect={() => setDeleteOpen(true)}><Icon name="trash" />{props.t("delete")}</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </header>
      <div className="message-scroller" ref={messageScroller}>
        {(messages.data?.length ?? 0) === 0 && pendingPrompt === null && streamed === "" && !send.isPending ? (
          <Empty className="welcome">
            <PiMark size="hero" />
            <CardTitle>{props.t("emptyTitle")}</CardTitle>
            <EmptyDescription>{props.t("emptyDetail")}</EmptyDescription>
            <div className="suggestions">
              <Button variant="outline" onClick={() => setInput("Review this workspace and summarize its architecture.")}><Icon name="command" />{props.t("reviewWorkspace")}</Button>
              <Button variant="outline" onClick={() => setInput("Create a practical implementation plan for my goal.")}><Icon name="plan" />{props.t("createPlan")}</Button>
              <Button variant="outline" onClick={() => setInput("Find the highest-impact issue to fix next.")}><Icon name="search" />{props.t("findNext")}</Button>
            </div>
          </Empty>
        ) : <MessageList messages={messages.data ?? []} copyLabel={props.t("copyCode")} copiedLabel={props.t("copied")} />}
        {pendingPrompt !== null ? <article className="message user pending"><span>You</span><div>{pendingPrompt}</div></article> : null}
        {streamed ? (
          <article className="message assistant streaming">
            <span>Pi</span>
            <MarkdownMessage
              content={streamed}
              copyLabel={props.t("copyCode")}
              copiedLabel={props.t("copied")}
              streaming
            />
          </article>
        ) : null}
        {(savedAttachments.data?.length ?? 0) > 0 ? <div className="attachment-strip">{savedAttachments.data?.map((attachment) => <Button variant="outline" key={attachment.id} onClick={() => void window.piWork.attachment.open(attachment.id)}><Icon name="file" /><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></Button>)}</div> : null}
        {send.isPending ? <ActivityCard title={props.t("sending")} detail={props.session?.workingDirectory ?? props.workspace?.rootPath ?? ""} /> : null}
        {approvals.map((approval) => (
          <Card className="approval-card" key={approval.approvalId}>
            <CardHeader><CardTitle>{approval.tool}</CardTitle><CardDescription>{JSON.stringify(approval.arguments)}</CardDescription></CardHeader>
            <CardContent><Button variant="outline" onClick={() => resolve(approval.approvalId, false)}>{props.t("deny")}</Button><Button onClick={() => resolve(approval.approvalId, true)}>{props.t("approve")}</Button></CardContent>
          </Card>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={submit}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void window.piWork.attachment.fromFiles([...event.dataTransfer.files])
            .then((selected) => setAttachments((current) => mergeAttachments(current, selected)))
            .catch((cause: Error) => props.onError(cause.message));
        }}
      >
        {attachments.length > 0 ? <div className="composer-attachments">{attachments.map((attachment) => <span key={attachment.path}><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small><Button variant="ghost" size="icon" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter(({ path }) => path !== attachment.path))}><Icon name="close" size={14} /></Button></span>)}</div> : null}
        <Textarea
          className="composer-input"
          rows={1}
          value={input}
          placeholder={props.t("message")}
          onChange={(event) => {
            setInput(event.target.value);
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div>
            <Button variant="ghost" size="icon" className="toolbar-icon-button" type="button" title={props.t("attach")} onClick={() => void window.piWork.attachment.choose().then((selected) => setAttachments((current) => mergeAttachments(current, selected)))}><Icon name="paperclip" /></Button>
            <Select value={permissionMode} onValueChange={(value) => setPermissionMode(value as PermissionMode)}>
              <SelectTrigger className="composer-select" aria-label="Permission mode"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="explore">{props.t("explore")}</SelectItem>
                <SelectItem value="ask">{props.t("ask")}</SelectItem>
                <SelectItem value="auto">{props.t("auto")}</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <Toggle type="button" pressed={planMode} onPressedChange={setPlanMode}><Icon name="plan" size={14} />{props.t("planMode")}</Toggle>
          </div>
          <div>
            <Select value={`${providerId}/${modelId}`} onValueChange={(value) => {
              const [provider, ...model] = value.split("/");
              setProviderId(provider ?? "");
              setModelId(model.join("/"));
            }}>
              <SelectTrigger className="model-select" aria-label="Model"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{availableModels.map((model) => <SelectItem key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>{model.modelName}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            <Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as ThinkingLevel)}>
              <SelectTrigger className="thinking-select" aria-label="Thinking"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(selectedModel?.thinkingLevels ?? ["off"]).map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            {send.isPending ? (
              <Button size="icon" className="send-button stop-button" type="button" aria-label="Stop generating" onClick={() => {
                const sessionId = activeSessionId.current;
                if (sessionId !== null) void window.piWork.session.stop(sessionId);
              }}><Icon name="stop" size={14} fill="currentColor" strokeWidth={0} /></Button>
            ) : <Button size="icon" className="send-button" aria-label="Send" disabled={input.trim() === ""}><Icon name="arrow-up" /></Button>}
          </div>
        </div>
      </form>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{props.t("rename")}</DialogTitle><DialogDescription>{props.session?.title}</DialogDescription></DialogHeader>
          <Input autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && renameTitle.trim()) {
              props.onUpdate({ sessionId: props.session!.id, title: renameTitle.trim() });
              setRenameOpen(false);
            }
          }} />
          <DialogFooter><Button variant="outline" onClick={() => setRenameOpen(false)}>{props.t("cancel")}</Button><Button disabled={!renameTitle.trim()} onClick={() => {
            props.onUpdate({ sessionId: props.session!.id, title: renameTitle.trim() });
            setRenameOpen(false);
          }}>{props.t("save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{props.t("delete")}</AlertDialogTitle><AlertDialogDescription>“{props.session?.title}”</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => props.session && props.onDelete(props.session.id)}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter>
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

  function resolve(approvalId: string, approved: boolean) {
    void window.piWork.chat.resolveToolApproval({ approvalId, approved });
    setApprovals((current) => current.filter((approval) => approval.approvalId !== approvalId));
  }
}

function MessageList({
  messages,
  copyLabel,
  copiedLabel,
}: {
  messages: ChatMessage[];
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <span>{message.role === "user" ? "You" : message.role === "assistant" ? "Pi" : "System"}</span>
          {message.role === "assistant"
            ? <MarkdownMessage content={message.content} copyLabel={copyLabel} copiedLabel={copiedLabel} />
            : <div>{message.content}</div>}
        </article>
      ))}
    </div>
  );
}

function ActivityCard({ title, detail }: { title: string; detail: string }) {
  return <Card className="activity-card"><Spinner /><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{detail}</CardDescription></CardHeader></Card>;
}

function BrowserPage({ session, t }: { session: Session | null; t: (key: MessageKey) => string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("https://example.com");
  const [state, setState] = useState({ url: "", title: "", canGoBack: false, canGoForward: false, loading: false });

  useEffect(() => {
    const removeState = window.piWork.browser.onState((next) => {
      setState(next);
      if (next.url) setAddress(next.url);
    });
    const host = hostRef.current;
    if (host === null) return removeState;
    const updateBounds = () => {
      const bounds = host.getBoundingClientRect();
      void window.piWork.browser.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(host);
    updateBounds();
    void window.piWork.browser.open(address);
    return () => {
      observer.disconnect();
      removeState();
      void window.piWork.browser.close();
    };
  }, []);

  return <section className="browser-page">
    <header className="browser-toolbar">
      <Button variant="ghost" size="icon" aria-label="Back" disabled={!state.canGoBack} onClick={() => void window.piWork.browser.back()}><Icon name="back" /></Button>
      <Button variant="ghost" size="icon" aria-label="Forward" disabled={!state.canGoForward} onClick={() => void window.piWork.browser.forward()}><Icon name="forward" /></Button>
      <Button variant="ghost" size="icon" aria-label={state.loading ? "Stop" : "Reload"} onClick={() => void window.piWork.browser.reload()}><Icon name={state.loading ? "close" : "refresh"} /></Button>
      <form onSubmit={(event) => { event.preventDefault(); void window.piWork.browser.navigate(address); }}><Icon name="search" /><Input value={address} onChange={(event) => setAddress(event.target.value)} /></form>
      <Button variant="ghost" size="icon" aria-label="Open externally" onClick={() => void window.piWork.browser.openExternal()}><Icon name="external" /></Button>
    </header>
    <div className="browser-layout">
      <aside className="browser-companion"><span className="header-context">{t("inbox")}</span><h2>{session?.title ?? t("newChat")}</h2><p>{session?.goal ?? t("emptyDetail")}</p><Alert className="browser-note"><AlertDescription>The browser is isolated from Pi Work and only permits HTTP(S) navigation.</AlertDescription></Alert></aside>
      <div className="browser-host" ref={hostRef} aria-label={state.title || t("browser")} />
    </div>
  </section>;
}

function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="page"><header className="content-header"><h1>{title}</h1>{action}</header><div className="page-body">{children}</div></section>;
}

function ProjectsPage(props: { sessions: Session[]; workspaceId: string | null; t: (key: MessageKey) => string; onOpen(session: Session): void; onRefresh(): Promise<void> }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"board" | "list">("board");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const projects = useQuery({ queryKey: ["projects", props.workspaceId], queryFn: () => window.piWork.project.list(props.workspaceId) });
  const visibleSessions = props.sessions.filter((session) => (
    (props.workspaceId === null || session.workspaceId === props.workspaceId)
    && (selectedProjectId === null || session.projectId === selectedProjectId)
    && !session.archived
  ));
  const create = useMutation({
    mutationFn: (name: string) => window.piWork.project.create({ workspaceId: props.workspaceId, value: { name, description: "", color: "#737373", archived: false } }),
    onSuccess: async () => {
      setProjectName("");
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const columns = [
    ["draft", "Backlog"],
    ["running", "In progress"],
    ["reviewing", "Review"],
    ["completed", "Done"],
  ] as const;
  async function moveSession(sessionId: string, status: Session["status"]): Promise<void> {
    await window.piWork.session.update({
      sessionId,
      status,
      ...(selectedProjectId === null ? {} : { projectId: selectedProjectId }),
    });
    await props.onRefresh();
  }
  return (
    <Page title={props.t("projects")} action={<div className="segmented"><ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as "board" | "list")}><ToggleGroupItem value="board">{props.t("board")}</ToggleGroupItem><ToggleGroupItem value="list">{props.t("list")}</ToggleGroupItem></ToggleGroup><Button onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />{props.t("add")}</Button></div>}>
      <Tabs value={selectedProjectId ?? "all"} onValueChange={(value) => setSelectedProjectId(value === "all" ? null : value)}>
        <TabsList className="project-tabs"><TabsTrigger value="all">All</TabsTrigger>{(projects.data ?? []).map((project) => <TabsTrigger key={project.id} value={project.id}>{project.name}</TabsTrigger>)}</TabsList>
      </Tabs>
      {mode === "board" ? (
        <div className="kanban">{columns.map(([status, label]) => {
          const columnSessions = visibleSessions.filter((session) => session.status === status);
          return <section className="kanban-column" key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            const sessionId = event.dataTransfer.getData("application/x-pi-work-session");
            if (sessionId !== "") void moveSession(sessionId, status);
          }}><header><strong>{label}</strong><span>{columnSessions.length}</span></header>{columnSessions.map((session) => <Button className="task-card" draggable key={session.id} onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-pi-work-session", session.id);
          }} variant="outline" onClick={() => props.onOpen(session)}><strong>{session.title}</strong><p>{session.goal}</p><footer><span>{session.modelId?.split("/").at(-1) ?? "Pi"}</span>{session.flagged ? <Icon name="flag" size={14} /> : <span />}</footer></Button>)}</section>;
        })}</div>
      ) : <div className="data-list">{visibleSessions.map((session) => <Button variant="ghost" key={session.id} onClick={() => props.onOpen(session)}><strong>{session.title}</strong><span>{session.status}</span><small>{session.updatedAt.slice(0, 10)}</small></Button>)}</div>}
      <NameDialog open={createOpen} onOpenChange={setCreateOpen} title={`${props.t("add")} ${props.t("projects")}`} value={projectName} onValueChange={setProjectName} onSubmit={() => projectName.trim() && create.mutate(projectName.trim())} t={props.t} />
    </Page>
  );
}

function SourcesPage({ workspaceId, t }: { workspaceId: string | null; t: (key: MessageKey) => string }) {
  return <DomainPage<Source>
    icon="source"
    title={t("sources")}
    queryKey="sources"
    list={() => window.piWork.source.list(workspaceId)}
    create={(name) => window.piWork.source.create({ workspaceId, value: { name, type: "local", enabled: true, config: {} } })}
    update={(source) => window.piWork.source.update({ id: source.id, value: { enabled: !source.enabled } })}
    remove={(id) => window.piWork.source.remove(id)}
    renderDetail={(source) => source.type.replace("_", " · ")}
    t={t}
  />;
}

function SkillsPage({ workspaceId, t }: { workspaceId: string | null; t: (key: MessageKey) => string }) {
  return <DomainPage<Skill>
    icon="skills"
    title={t("skills")}
    queryKey="skills"
    list={() => window.piWork.skill.list(workspaceId)}
    create={(name) => window.piWork.skill.create({ workspaceId, value: { name, description: "", instructions: `# ${name}\n`, enabled: true } })}
    update={(skill) => window.piWork.skill.update({ id: skill.id, value: { enabled: !skill.enabled } })}
    remove={(id) => window.piWork.skill.remove(id)}
    renderDetail={(skill) => skill.description || `${skill.instructions.length} chars`}
    t={t}
  />;
}

function AutomationsPage({ workspaceId, t }: { workspaceId: string | null; t: (key: MessageKey) => string }) {
  return <DomainPage<Automation>
    icon="list-todo"
    title={t("automations")}
    queryKey="automations"
    list={() => window.piWork.automation.list(workspaceId)}
    create={(name) => window.piWork.automation.create({ workspaceId, value: { name, enabled: false, trigger: { type: "schedule", cron: "0 9 * * 1-5" }, action: { type: "create_session", title: name, prompt: name }, lastRunAt: null } })}
    update={(automation) => window.piWork.automation.update({ id: automation.id, value: { enabled: !automation.enabled } })}
    remove={(id) => window.piWork.automation.remove(id)}
    renderDetail={(automation) => automation.trigger.type === "schedule" ? automation.trigger.cron : automation.trigger.type}
    t={t}
  />;
}

function DomainPage<T extends { id: string; name: string; enabled: boolean }>(props: {
  icon: IconName;
  title: string;
  queryKey: string;
  list(): Promise<T[]>;
  create(name: string): Promise<T>;
  update(value: T): Promise<T>;
  remove(id: string): Promise<void>;
  renderDetail(value: T): string;
  t: (key: MessageKey) => string;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [deleteItem, setDeleteItem] = useState<T | null>(null);
  const query = useQuery({ queryKey: [props.queryKey], queryFn: props.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [props.queryKey] });
  const create = useMutation({ mutationFn: props.create, onSuccess: async () => {
    setName("");
    setCreateOpen(false);
    await refresh();
  } });
  const update = useMutation({ mutationFn: props.update, onSuccess: refresh });
  const remove = useMutation({ mutationFn: props.remove, onSuccess: refresh });
  return <Page title={props.title} action={<Button onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} />{props.t("add")}</Button>}>
    <div className="resource-grid">
      {(query.data ?? []).map((item) => <Card className="resource-card" key={item.id}><div className="resource-icon"><Icon name={props.icon} /></div><CardHeader className="resource-copy"><CardTitle>{item.name}</CardTitle><CardDescription>{props.renderDetail(item)}</CardDescription></CardHeader><Switch checked={item.enabled} aria-label={`${item.name}: ${props.t(item.enabled ? "enabled" : "disabled")}`} onCheckedChange={() => update.mutate(item)} /><Button variant="ghost" size="icon" className="card-delete" aria-label="Delete" onClick={() => setDeleteItem(item)}><Icon name="trash" size={14} /></Button></Card>)}
      {(query.data?.length ?? 0) === 0 ? <Empty className="empty-card"><EmptyDescription>{props.t("noItems")}</EmptyDescription></Empty> : null}
    </div>
    <NameDialog open={createOpen} onOpenChange={setCreateOpen} title={`${props.t("add")} ${props.title}`} value={name} onValueChange={setName} onSubmit={() => name.trim() && create.mutate(name.trim())} t={props.t} />
    <AlertDialog open={deleteItem !== null} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{props.t("delete")}</AlertDialogTitle><AlertDialogDescription>“{deleteItem?.name}”</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => {
          if (deleteItem !== null) remove.mutate(deleteItem.id);
          setDeleteItem(null);
        }}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Page>;
}

function NameDialog(props: {
  open: boolean;
  title: string;
  value: string;
  t: (key: MessageKey) => string;
  onOpenChange(open: boolean): void;
  onValueChange(value: string): void;
  onSubmit(): void;
}) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{props.title}</DialogTitle><DialogDescription>{props.t("add")}</DialogDescription></DialogHeader>
      <Input autoFocus value={props.value} onChange={(event) => props.onValueChange(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && props.value.trim()) props.onSubmit();
      }} />
      <DialogFooter><Button variant="outline" onClick={() => props.onOpenChange(false)}>{props.t("cancel")}</Button><Button disabled={!props.value.trim()} onClick={props.onSubmit}>{props.t("save")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SettingsPage({ settings, onRefresh, t }: { settings: AppSettings | undefined; onRefresh(): Promise<unknown>; t: (key: MessageKey) => string }) {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const models = useQuery({ queryKey: ["models"], queryFn: () => window.piWork.model.list() });
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const providerOptions = useMemo(() => Array.from(new Map((models.data?.models ?? []).map((model) => [model.providerId, model.providerName])).entries()), [models.data]);
  useEffect(() => { if (providerId === "" && providerOptions[0]) setProviderId(providerOptions[0][0]); }, [providerOptions, providerId]);
  const updateSettings = (value: Partial<AppSettings>) => void window.piWork.settings.update(value).then(onRefresh);
  const saveProvider = useMutation({
    mutationFn: () => window.piWork.provider.save({ providerId, apiKey }),
    onSuccess: async () => { setApiKey(""); await queryClient.invalidateQueries({ queryKey: ["providers"] }); },
  });
  return <Page title={t("settings")}>
    <div className="settings-grid">
      <Card className="settings-card">
        <CardHeader><CardTitle>{t("appearance")}</CardTitle></CardHeader>
        <CardContent><FieldGroup>
          <Field className="settings-field"><FieldLabel>{t("theme")}</FieldLabel><Select value={settings?.theme ?? "system"} onValueChange={(value) => updateSettings({ theme: value as AppSettings["theme"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="system">{t("system")}</SelectItem><SelectItem value="light">{t("light")}</SelectItem><SelectItem value="dark">{t("dark")}</SelectItem></SelectGroup></SelectContent></Select></Field>
          <Field className="settings-field"><FieldLabel>{t("language")}</FieldLabel><Select value={settings?.language ?? "en"} onValueChange={(value) => updateSettings({ language: value as AppSettings["language"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="en">English</SelectItem><SelectItem value="zh-CN">简体中文</SelectItem></SelectGroup></SelectContent></Select></Field>
        </FieldGroup></CardContent>
      </Card>
      <Card className="settings-card">
        <CardHeader><CardTitle>{t("providers")}</CardTitle></CardHeader>
        <CardContent className="provider-content"><FieldGroup className="provider-entry">
          <Field><FieldLabel>{t("providers")}</FieldLabel><Select value={providerId} onValueChange={setProviderId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{providerOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>API key</FieldLabel><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key" /></Field>
          <Button disabled={!providerId || !apiKey} onClick={() => saveProvider.mutate()}>{t("save")}</Button>
        </FieldGroup><div className="chips">{(providers.data ?? []).map((provider) => <Badge key={provider.providerId}><Icon name="check" size={14} />{provider.providerId}</Badge>)}</div></CardContent>
      </Card>
      <Card className="settings-card">
        <CardHeader><CardTitle>{t("keyboard")}</CardTitle></CardHeader>
        <CardContent><div className="shortcut-list"><span>{t("search")} <kbd>⌘ K</kbd></span><span>{t("newChat")} <kbd>⌘ N</kbd></span><span>{t("sidebar")} <kbd>⌘ B</kbd></span></div></CardContent>
      </Card>
    </div>
  </Page>;
}
