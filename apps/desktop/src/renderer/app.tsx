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
import { Button } from "./components/ui/button.js";
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
    onSuccess: refresh,
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
        {error !== null ? <div className="inline-error">{error}<button onClick={() => setError(null)}>×</button></div> : null}
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
            onDelete={(id) => {
              if (window.confirm(`${t("delete")} “${selectedSession?.title ?? ""}”?`)) removeSession.mutate(id);
            }}
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
      {onboarding ? (
        <div className="modal-backdrop">
          <section className="dialog onboarding" role="dialog" aria-modal="true">
            <span className="brand-mark">π</span>
            <div><h2>Pi Work</h2><p>{language === "zh-CN" ? "连接模型提供商后开始，也可以先浏览本地工作区。" : "Connect a model provider to begin, or explore a local workspace first."}</p></div>
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => void window.piWork.settings.update({ onboardingSkipped: true }).then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))}>
                {language === "zh-CN" ? "稍后设置" : "Set up later"}
              </Button>
              <Button onClick={() => ui.showSettings()}>{t("settings")}</Button>
            </div>
          </section>
        </div>
      ) : null}
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
      <button className="icon-button" aria-label="Toggle sidebar" onClick={props.onToggleSidebar}>☰</button>
      <div className="history-controls"><button disabled>‹</button><button disabled>›</button></div>
      <button className="workspace-switcher"><span className="workspace-dot" />{props.workspace?.name ?? "Pi Work"}⌄</button>
      <label className="global-search">
        <span>⌕</span>
        <input ref={props.searchRef} value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder={props.t("search")} />
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
      <div className="sidebar-brand"><span className="brand-mark">π</span><strong>Pi Work</strong></div>
      <button className="new-chat" onClick={props.onNew}><span>＋</span>{props.t("newChat")}<kbd>⌘N</kbd></button>
      <nav className="primary-nav">
        <NavButton active={props.view === "inbox" && props.sessionFilter === "all"} icon="⌂" label={props.t("inbox")} onClick={() => props.onSessionFilter("all")} />
        <NavButton active={props.view === "inbox" && props.sessionFilter === "flagged"} icon="⚑" label={props.t("flagged")} badge={props.sessions.filter(({ flagged, archived }) => flagged && !archived).length} onClick={() => props.onSessionFilter("flagged")} />
        <NavButton active={props.view === "inbox" && props.sessionFilter === "archived"} icon="◷" label={props.t("archived")} badge={props.sessions.filter(({ archived }) => archived).length} onClick={() => props.onSessionFilter("archived")} />
      </nav>
      <div className="sidebar-section">
        <div className="sidebar-heading"><span>{props.t("allSessions")}</span><span>{recent.length}</span></div>
        <div className="session-list">
          {recent.map((session) => (
            <button className={`session-row ${session.id === props.selectedSessionId && props.view === "inbox" ? "selected" : ""}`} key={session.id} onClick={() => props.onSelect(session)}>
              <span className={`status-dot ${session.running ? "running" : ""}`} />
              <span><strong>{session.title}</strong><small>{session.permissionMode === "auto" ? "Auto" : session.permissionMode === "explore" ? "Explore" : "Ask"}</small></span>
              {session.flagged ? <span>⚑</span> : null}
            </button>
          ))}
          {recent.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
        </div>
      </div>
      <nav className="secondary-nav">
        <NavButton active={props.view === "projects"} icon="▦" label={props.t("projects")} onClick={() => props.onView("projects")} />
        <NavButton active={props.view === "sources"} icon="⌁" label={props.t("sources")} onClick={() => props.onView("sources")} />
        <NavButton active={props.view === "skills"} icon="✦" label={props.t("skills")} onClick={() => props.onView("skills")} />
        <NavButton active={props.view === "automations"} icon="↻" label={props.t("automations")} onClick={() => props.onView("automations")} />
        <NavButton active={props.view === "browser"} icon="◎" label={props.t("browser")} onClick={() => props.onView("browser")} />
      </nav>
      <div className="workspace-list">
        <div className="sidebar-heading"><span>{props.t("workspaces")}</span><button onClick={props.onAddWorkspace}>＋</button></div>
        {props.workspaces.filter(({ kind }) => kind === "folder").map((workspace) => (
          <button className={workspace.id === props.selectedWorkspaceId ? "workspace-row selected" : "workspace-row"} key={workspace.id} onClick={() => props.onSelectWorkspace(workspace.id)}>
            <span>◇</span><span><strong>{workspace.name}</strong><small>{titleFromPath(workspace.rootPath)}</small></span>
          </button>
        ))}
      </div>
      <button className={`settings-row ${props.view === "settings" ? "selected" : ""}`} onClick={() => props.onView("settings")}>⚙ {props.t("settings")}</button>
    </aside>
  );
}

function NavButton(props: { active: boolean; icon: string; label: string; badge?: number; onClick(): void }) {
  return <button className={props.active ? "nav-button selected" : "nav-button"} onClick={props.onClick}><span>{props.icon}</span><strong>{props.label}</strong>{props.badge ? <small>{props.badge}</small> : null}</button>;
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
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const activeSessionId = useRef(props.session?.id ?? null);
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
      if (typeof delta === "string") setStreamed((current) => current + delta);
    }
    if (event.kind === "cancelled") setStreamed("");
  }), []);
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
      setStreamed("");
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
      setInput("");
      setAttachments([]);
      localStorage.removeItem(draftKey);
      props.onCreated(session);
      await queryClient.invalidateQueries({ queryKey: ["messages", session.id] });
      setStreamed("");
    },
    onError: (cause: Error) => props.onError(cause.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (content !== "") send.mutate(content);
  }

  return (
    <section className="chat-panel">
      <header className="content-header">
        <div><span className="header-context">{props.workspace?.name ?? props.t("personal")}</span><h1>{props.session?.title ?? props.t("newChat")}</h1></div>
        {props.session ? (
          <div className="header-actions">
            <button onClick={() => props.onUpdate({ sessionId: props.session!.id, flagged: !props.session!.flagged })}>{props.session.flagged ? "⚑" : "⚐"}</button>
            <button onClick={() => {
              const title = window.prompt(props.t("rename"), props.session?.title);
              if (title?.trim()) props.onUpdate({ sessionId: props.session!.id, title: title.trim() });
            }}>•••</button>
          </div>
        ) : null}
      </header>
      <div className="message-scroller">
        {(messages.data?.length ?? 0) === 0 ? (
          <div className="welcome">
            <span className="welcome-mark">π</span>
            <h2>{props.t("emptyTitle")}</h2>
            <p>{props.t("emptyDetail")}</p>
            <div className="suggestions">
              <button onClick={() => setInput("Review this workspace and summarize its architecture.")}>⌘ {props.t("reviewWorkspace")}</button>
              <button onClick={() => setInput("Create a practical implementation plan for my goal.")}>▤ {props.t("createPlan")}</button>
              <button onClick={() => setInput("Find the highest-impact issue to fix next.")}>⌕ {props.t("findNext")}</button>
            </div>
          </div>
        ) : <MessageList messages={messages.data ?? []} />}
        {streamed ? <article className="message assistant streaming"><span>Pi</span><div>{streamed}</div></article> : null}
        {(savedAttachments.data?.length ?? 0) > 0 ? <div className="attachment-strip">{savedAttachments.data?.map((attachment) => <button key={attachment.id} onClick={() => void window.piWork.attachment.open(attachment.id)}><span>▤</span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></button>)}</div> : null}
        {send.isPending ? <ActivityCard title={props.t("sending")} detail={props.session?.workingDirectory ?? props.workspace?.rootPath ?? ""} /> : null}
        {approvals.map((approval) => (
          <article className="approval-card" key={approval.approvalId}>
            <div><strong>{approval.tool}</strong><p>{JSON.stringify(approval.arguments)}</p></div>
            <div><button onClick={() => resolve(approval.approvalId, false)}>{props.t("deny")}</button><button className="primary" onClick={() => resolve(approval.approvalId, true)}>{props.t("approve")}</button></div>
          </article>
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
        {attachments.length > 0 ? <div className="composer-attachments">{attachments.map((attachment) => <span key={attachment.path}><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small><button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter(({ path }) => path !== attachment.path))}>×</button></span>)}</div> : null}
        <textarea
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
            <button type="button" title={props.t("attach")} onClick={() => void window.piWork.attachment.choose().then((selected) => setAttachments((current) => mergeAttachments(current, selected)))}>＋</button>
            <select aria-label="Permission mode" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as PermissionMode)}>
              <option value="explore">{props.t("explore")}</option><option value="ask">{props.t("ask")}</option><option value="auto">{props.t("auto")}</option>
            </select>
            <button type="button" className={planMode ? "toggle active" : "toggle"} onClick={() => setPlanMode(!planMode)}>▤ {props.t("planMode")}</button>
          </div>
          <div>
            <select aria-label="Model" value={`${providerId}/${modelId}`} onChange={(event) => {
              const [provider, ...model] = event.target.value.split("/");
              setProviderId(provider ?? "");
              setModelId(model.join("/"));
            }}>
              {availableModels.map((model) => <option key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>{model.modelName}</option>)}
            </select>
            <select aria-label="Thinking" value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}>
              {(selectedModel?.thinkingLevels ?? ["off"]).map((level) => <option key={level}>{level}</option>)}
            </select>
            {send.isPending ? (
              <button className="send-button stop-button" type="button" aria-label="Stop generating" onClick={() => {
                const sessionId = activeSessionId.current;
                if (sessionId !== null) void window.piWork.session.stop(sessionId);
              }}>■</button>
            ) : <button className="send-button" disabled={input.trim() === ""}>↑</button>}
          </div>
        </div>
      </form>
      {props.session ? (
        <div className="session-footer-actions">
          <button onClick={() => props.onUpdate({ sessionId: props.session!.id, archived: !props.session!.archived })}>{props.session.archived ? props.t("restore") : props.t("archive")}</button>
          <button className="danger-link" onClick={() => props.onDelete(props.session!.id)}>{props.t("delete")}</button>
        </div>
      ) : null}
    </section>
  );

  function resolve(approvalId: string, approved: boolean) {
    void window.piWork.chat.resolveToolApproval({ approvalId, approved });
    setApprovals((current) => current.filter((approval) => approval.approvalId !== approvalId));
  }
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return <div className="messages">{messages.map((message) => <article className={`message ${message.role}`} key={message.id}><span>{message.role === "user" ? "You" : message.role === "assistant" ? "Pi" : "System"}</span><div>{message.content}</div></article>)}</div>;
}

function ActivityCard({ title, detail }: { title: string; detail: string }) {
  return <article className="activity-card"><span className="spinner" /><div><strong>{title}</strong><small>{detail}</small></div></article>;
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
      <button disabled={!state.canGoBack} onClick={() => void window.piWork.browser.back()}>‹</button>
      <button disabled={!state.canGoForward} onClick={() => void window.piWork.browser.forward()}>›</button>
      <button onClick={() => void window.piWork.browser.reload()}>{state.loading ? "×" : "↻"}</button>
      <form onSubmit={(event) => { event.preventDefault(); void window.piWork.browser.navigate(address); }}><span>⌕</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></form>
      <button onClick={() => void window.piWork.browser.openExternal()}>↗</button>
    </header>
    <div className="browser-layout">
      <aside className="browser-companion"><span className="header-context">{t("inbox")}</span><h2>{session?.title ?? t("newChat")}</h2><p>{session?.goal ?? t("emptyDetail")}</p><div className="browser-note">The browser is isolated from Pi Work and only permits HTTP(S) navigation.</div></aside>
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
  const projects = useQuery({ queryKey: ["projects", props.workspaceId], queryFn: () => window.piWork.project.list(props.workspaceId) });
  const visibleSessions = props.sessions.filter((session) => (
    (props.workspaceId === null || session.workspaceId === props.workspaceId)
    && (selectedProjectId === null || session.projectId === selectedProjectId)
    && !session.archived
  ));
  const create = useMutation({
    mutationFn: () => {
      const name = window.prompt(`${props.t("add")} ${props.t("projects")}`);
      if (!name?.trim()) throw new Error("cancelled");
      return window.piWork.project.create({ workspaceId: props.workspaceId, value: { name: name.trim(), description: "", color: "#737373", archived: false } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
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
    <Page title={props.t("projects")} action={<div className="segmented"><button className={mode === "board" ? "active" : ""} onClick={() => setMode("board")}>{props.t("board")}</button><button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>{props.t("list")}</button><Button onClick={() => create.mutate()}>＋ {props.t("add")}</Button></div>}>
      <div className="project-tabs"><button className={selectedProjectId === null ? "active" : ""} onClick={() => setSelectedProjectId(null)}>All</button>{(projects.data ?? []).map((project) => <button className={selectedProjectId === project.id ? "active" : ""} key={project.id} onClick={() => setSelectedProjectId(project.id)}>{project.name}</button>)}</div>
      {mode === "board" ? (
        <div className="kanban">{columns.map(([status, label]) => {
          const columnSessions = visibleSessions.filter((session) => session.status === status);
          return <section className="kanban-column" key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            const sessionId = event.dataTransfer.getData("application/x-pi-work-session");
            if (sessionId !== "") void moveSession(sessionId, status);
          }}><header><strong>{label}</strong><span>{columnSessions.length}</span></header>{columnSessions.map((session) => <button className="task-card" draggable key={session.id} onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-pi-work-session", session.id);
          }} onClick={() => props.onOpen(session)}><strong>{session.title}</strong><p>{session.goal}</p><footer><span>{session.modelId?.split("/").at(-1) ?? "Pi"}</span><span>{session.flagged ? "⚑" : "○"}</span></footer></button>)}</section>;
        })}</div>
      ) : <div className="data-list">{visibleSessions.map((session) => <button key={session.id} onClick={() => props.onOpen(session)}><strong>{session.title}</strong><span>{session.status}</span><small>{session.updatedAt.slice(0, 10)}</small></button>)}</div>}
    </Page>
  );
}

function SourcesPage({ workspaceId, t }: { workspaceId: string | null; t: (key: MessageKey) => string }) {
  return <DomainPage<Source>
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
  const query = useQuery({ queryKey: [props.queryKey], queryFn: props.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [props.queryKey] });
  const create = useMutation({ mutationFn: props.create, onSuccess: refresh });
  const update = useMutation({ mutationFn: props.update, onSuccess: refresh });
  const remove = useMutation({ mutationFn: props.remove, onSuccess: refresh });
  return <Page title={props.title} action={<Button onClick={() => { const name = window.prompt(`${props.t("add")} ${props.title}`); if (name?.trim()) create.mutate(name.trim()); }}>＋ {props.t("add")}</Button>}>
    <div className="resource-grid">
      {(query.data ?? []).map((item) => <article className="resource-card" key={item.id}><div className="resource-icon">◇</div><div><h3>{item.name}</h3><p>{props.renderDetail(item)}</p></div><button className={`switch ${item.enabled ? "on" : ""}`} onClick={() => update.mutate(item)}><span /></button><button className="card-delete" onClick={() => remove.mutate(item.id)}>×</button></article>)}
      {(query.data?.length ?? 0) === 0 ? <div className="empty-card">{props.t("noItems")}</div> : null}
    </div>
  </Page>;
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
      <section className="settings-card"><h2>{t("appearance")}</h2><label>{t("theme")}<select value={settings?.theme ?? "system"} onChange={(event) => updateSettings({ theme: event.target.value as AppSettings["theme"] })}><option value="system">{t("system")}</option><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></select></label><label>{t("language")}<select value={settings?.language ?? "en"} onChange={(event) => updateSettings({ language: event.target.value as AppSettings["language"] })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label></section>
      <section className="settings-card"><h2>{t("providers")}</h2><div className="provider-entry"><select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key" /><Button disabled={!providerId || !apiKey} onClick={() => saveProvider.mutate()}>{t("save")}</Button></div><div className="chips">{(providers.data ?? []).map((provider) => <span key={provider.providerId}>{provider.providerId} ✓</span>)}</div></section>
      <section className="settings-card"><h2>{t("keyboard")}</h2><div className="shortcut-list"><span>{t("search")} <kbd>⌘ K</kbd></span><span>{t("newChat")} <kbd>⌘ N</kbd></span><span>{t("sidebar")} <kbd>⌘ B</kbd></span></div></section>
    </div>
  </Page>;
}
