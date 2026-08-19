import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useGSAP } from "@gsap/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, Workspace } from "@pi-work/protocol";
import { gsap } from "gsap";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Disclosure, DisclosureContent, DisclosureTrigger } from "./components/ui/disclosure.js";
import { Icon } from "./components/ui/icon.js";
import {
  CommandPalette,
  OnboardingDialog,
  Sidebar,
  TopBar,
  createNewFolderTaskInput,
  createNewSessionInput,
  mergeSessionSnapshot,
  resolveDefaultModel,
  resolveDefaultThinkingLevel,
} from "./features/app-shell.js";
import { SettingsPage } from "./features/settings-page.js";
import { PiConsolePanel } from "./features/pi-console-panel.js";
import { SessionEmptyState, TaskWorkbench } from "./features/task-workbench.js";
import {
  AutomationsPage,
  BoardPage,
  SourcesPage,
} from "./features/workspace-pages.js";
import { translator } from "./i18n.js";
import { parseSidebarWidth, sidebarWidthStorageKey } from "./sidebar-layout.js";
import type { AppView, WorkspaceScope } from "./store.js";
import { useWorkspaceUi } from "./store.js";

gsap.registerPlugin(useGSAP);

const consolePanelHeightStorageKey = "pi-work:console-panel-height";
const minimumConsolePanelHeight = 180;

function clampConsolePanelHeight(height: number): number {
  const maximum = Math.max(minimumConsolePanelHeight, window.innerHeight - 180);
  return Math.min(maximum, Math.max(minimumConsolePanelHeight, Math.round(height)));
}

function defaultConsolePanelHeight(): number {
  return clampConsolePanelHeight(window.innerHeight * 0.38);
}

export function App() {
  const queryClient = useQueryClient();
  const ui = useWorkspaceUi();
  const [appError, setAppError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleMounted, setConsoleMounted] = useState(false);
  const [consolePanelHeight, setConsolePanelHeight] = useState(() => {
    try {
      const savedHeight = Number(window.localStorage.getItem(consolePanelHeightStorageKey));
      return Number.isFinite(savedHeight) && savedHeight > 0
        ? clampConsolePanelHeight(savedHeight)
        : defaultConsolePanelHeight();
    } catch {
      return defaultConsolePanelHeight();
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return parseSidebarWidth(window.localStorage.getItem(sidebarWidthStorageKey));
    } catch {
      return parseSidebarWidth(null);
    }
  });
  const [consoleCommandRequest, setConsoleCommandRequest] = useState<{ id: number; value: string } | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | undefined>(undefined);
  const consoleCommandIdRef = useRef(0);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarAnimationReadyRef = useRef(false);
  const initialSidebarCollapsedRef = useRef(ui.sidebarCollapsed);
  const isDarwin = document.documentElement.dataset.platform === "darwin";
  const initialSidebarLayoutWidthRef = useRef(
    initialSidebarCollapsedRef.current ? "0px" : `${sidebarWidth}px`,
  );
  const initialTopbarContextPaddingRef = useRef(
    initialSidebarCollapsedRef.current ? `${isDarwin ? 128 : 64}px` : "20px",
  );
  const initialSidebarInlinePaddingRef = useRef(
    initialSidebarCollapsedRef.current ? "0px" : "11px",
  );
  const initialSidebarBorderWidthRef = useRef(
    initialSidebarCollapsedRef.current ? "0px" : "1px",
  );
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.piWork.settings.get() });
  const buildInfo = useQuery({ queryKey: ["system-info"], queryFn: () => window.piWork.system.info() });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => window.piWork.workspace.list() });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => window.piWork.session.list(),
    refetchInterval: (query) => (
      (query.state.data as Session[] | undefined)?.some(({ running }) => running) ? 1_000 : false
    ),
  });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const models = useQuery({ queryKey: ["models"], queryFn: () => window.piWork.model.list() });
  const toolApprovals = useQuery({ queryKey: ["tool-approvals"], queryFn: () => window.piWork.chat.toolApprovals() });
  const language = settings.data?.language ?? "en";
  const t = useMemo(() => translator(language), [language]);

  useEffect(() => window.piWork.session.onChanged((session) => {
    queryClient.setQueryData<Session[] | undefined>(
      ["sessions"],
      (current) => mergeSessionSnapshot(current, session),
    );
  }), [queryClient]);

  const workspaceById = useMemo(
    () => new Map((workspaces.data ?? []).map((workspace) => [workspace.id, workspace])),
    [workspaces.data],
  );
  const selectedSession = (sessions.data ?? []).find(({ id }) => id === ui.selectedTaskId) ?? null;
  const selectedWorkspace = selectedSession === null
    ? null
    : (workspaceById.get(selectedSession.workspaceId) ?? null);
  const scopedSessions = useMemo(() => {
    const values = sessions.data ?? [];
    if (ui.workspaceScope === "personal") {
      return values.filter((session) => (
        session.kind === "chat" && workspaceById.get(session.workspaceId)?.kind === "managed"
      ));
    }
    return values.filter((session) => session.workspaceId === ui.workspaceScope && session.kind === "task");
  }, [sessions.data, ui.workspaceScope, workspaceById]);
  const scopeWorkspace = ui.workspaceScope === "personal"
    ? null
    : (workspaceById.get(ui.workspaceScope) ?? null);
  const folderWorkspaces = (workspaces.data ?? []).filter(({ kind }) => kind === "folder");
  const boardWorkspace = scopeWorkspace?.kind === "folder" ? scopeWorkspace : null;
  const workflowWorkspaceId = scopeWorkspace?.kind === "folder" ? scopeWorkspace.id : null;
  const statuses = useQuery({
    queryKey: ["statuses", workflowWorkspaceId],
    queryFn: () => window.piWork.status.list(workflowWorkspaceId!),
    enabled: workflowWorkspaceId !== null,
  });
  const labels = useQuery({
    queryKey: ["labels", workflowWorkspaceId],
    queryFn: () => window.piWork.label.list(workflowWorkspaceId!),
    enabled: workflowWorkspaceId !== null,
  });
  const boards = useQuery({
    queryKey: ["boards", workflowWorkspaceId],
    queryFn: () => window.piWork.board.list(workflowWorkspaceId!),
    enabled: workflowWorkspaceId !== null,
  });
  const boardSnapshot = useQuery({
    queryKey: ["board-snapshot", workflowWorkspaceId, selectedBoardId],
    queryFn: () => window.piWork.board.snapshot({ workspaceId: workflowWorkspaceId, boardId: selectedBoardId }),
    enabled: workflowWorkspaceId !== null,
  });
  useEffect(() => setSelectedBoardId(undefined), [workflowWorkspaceId]);
  useEffect(() => {
    const value = settings.data;
    if (value === undefined) return;
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.dataset.compact = String(value.compactMode);
    document.documentElement.dataset.focus = String(value.focusMode);
    document.documentElement.lang = value.language;
    ui.setSidebarCollapsed(value.sidebarCollapsed);
  }, [
    settings.data?.compactMode,
    settings.data?.focusMode,
    settings.data?.language,
    settings.data?.sidebarCollapsed,
    settings.data?.theme,
  ]);
  useEffect(() => {
    document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? "darwin" : "other";
  }, []);
  useEffect(() => window.piWork.chat.onToolApproval(() => {
    void queryClient.invalidateQueries({ queryKey: ["tool-approvals"] });
  }), [queryClient]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        ui.setCommandOpen(true);
      }
      if (command && event.key.toLocaleLowerCase() === "j") {
        event.preventDefault();
        toggleConsole();
      }
      if (!ui.settingsOpen && command && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        createNewItem();
      }
      if (!ui.settingsOpen && command && event.key.toLocaleLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
      if (!ui.settingsOpen && command && event.key.toLocaleLowerCase() === "i" && selectedSession !== null) {
        event.preventDefault();
        ui.toggleContextPanel("task");
      }
      if (event.key === "Escape") {
        if (ui.commandOpen) {
          ui.setCommandOpen(false);
        } else if (consoleOpen) {
          closeConsole();
        }
        ui.setSidebarDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [consoleOpen, selectedSession, settings.data?.sidebarCollapsed, ui]);

  function openConsole(command: string | null = null) {
    if (command !== null) {
      consoleCommandIdRef.current += 1;
      setConsoleCommandRequest({ id: consoleCommandIdRef.current, value: command });
    }
    setConsoleMounted(true);
    setConsoleOpen(true);
  }

  function closeConsole() {
    setConsoleOpen(false);
  }

  function finishClosingConsole() {
    if (consoleOpen) return;
    void window.piWork.piConsole.close();
    setConsoleMounted(false);
    setConsoleCommandRequest(null);
  }

  function toggleConsole() {
    if (consoleOpen) closeConsole();
    else openConsole();
  }

  function resizeConsole(height: number, commit: boolean) {
    const nextHeight = clampConsolePanelHeight(height);
    setConsolePanelHeight(nextHeight);
    gsap.set(appShellRef.current, { "--console-panel-height": `${nextHeight}px` });
    if (!commit) return;
    try {
      window.localStorage.setItem(consolePanelHeightStorageKey, String(nextHeight));
    } catch {
      // The terminal remains resizable even if preferences cannot be persisted.
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["statuses"] }),
      queryClient.invalidateQueries({ queryKey: ["labels"] }),
      queryClient.invalidateQueries({ queryKey: ["board-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["boards"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-directories"] }),
      queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
    ]);
  }

  async function addWorkspace(): Promise<Workspace | null> {
    try {
      const workspace = await window.piWork.workspace.choose();
      if (workspace !== null) {
        await refresh();
        ui.setWorkspaceScope(workspace.id);
      }
      return workspace;
    } catch (cause) {
      setAppError(errorMessage(cause));
      return null;
    }
  }

  async function addWorkspaceDirectory(workspaceId: string): Promise<Workspace | null> {
    try {
      const workspace = await window.piWork.workspace.addDirectory(workspaceId);
      if (workspace !== null) await refresh();
      return workspace;
    } catch (cause) {
      setAppError(errorMessage(cause));
      return null;
    }
  }

  async function updateSettings(value: Parameters<typeof window.piWork.settings.update>[0]) {
    const next = await window.piWork.settings.update(value);
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
    return next;
  }

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 900px)").matches) {
      ui.setSidebarDrawerOpen(!ui.sidebarDrawerOpen);
      return;
    }
    const next = !ui.sidebarCollapsed;
    ui.setSidebarCollapsed(next);
    void window.piWork.settings.update({ sidebarCollapsed: next }).then(() => (
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    )).catch((cause: unknown) => setAppError(errorMessage(cause)));
  }

  function resizeSidebar(width: number, commit: boolean): void {
    setSidebarWidth(width);
    if (!ui.sidebarCollapsed) {
      appShellRef.current?.style.setProperty("--sidebar-layout-width", `${width}px`);
    }
    if (!commit) return;
    try {
      window.localStorage.setItem(sidebarWidthStorageKey, String(width));
    } catch {
      // A private or restricted renderer may not expose persistent storage.
    }
  }

  function showView(view: AppView) {
    ui.selectTask(null);
    if (
      (view === "board" || view === "sources" || view === "automations")
      && scopeWorkspace?.kind !== "folder"
    ) {
      return;
    }
    ui.showView(view);
  }

  function openSession(sessionId: string) {
    const session = (sessions.data ?? []).find((candidate) => candidate.id === sessionId);
    if (session === undefined) return;
    const workspace = workspaceById.get(session.workspaceId);
    if (workspace === undefined) return;
    ui.setWorkspaceScope(workspace.kind === "managed" ? "personal" : workspace.id);
    ui.openTask(session.id);
  }

  function openContext(scope: WorkspaceScope, view: AppView) {
    ui.setWorkspaceScope(scope);
    ui.showView(view);
  }

  const removeSession = useMutation({
    mutationFn: (sessionId: string) => window.piWork.session.remove(sessionId),
    onSuccess: async () => {
      ui.selectTask(null);
      await refresh();
    },
    onError: (cause: Error) => setAppError(cause.message),
  });
  const createPersonalSession = useMutation({
    mutationFn: () => {
      const model = resolveDefaultModel(
        providers.data ?? [],
        models.data,
        settings.data,
      );
      if (model === undefined) throw new Error(t("configureModel"));
      return window.piWork.session.create(createNewSessionInput(
        model,
        resolveDefaultThinkingLevel(model, settings.data),
      ));
    },
    onSuccess: async (session) => {
      await refresh();
      ui.setWorkspaceScope("personal");
      ui.openTask(session.id);
    },
    onError: (cause: Error) => setAppError(cause.message),
  });
  const createFolderTask = useMutation({
    mutationFn: () => {
      const workspace = scopeWorkspace?.kind === "folder" ? scopeWorkspace : null;
      if (workspace === null) throw new Error(t("chooseFolder"));
      const model = resolveDefaultModel(
        providers.data ?? [],
        models.data,
        settings.data,
      );
      if (model === undefined) throw new Error(t("configureModel"));
      return window.piWork.task.create(createNewFolderTaskInput(
        workspace,
        model,
        resolveDefaultThinkingLevel(model, settings.data),
      ));
    },
    onSuccess: async (session) => {
      await refresh();
      ui.setWorkspaceScope(session.workspaceId);
      ui.openTask(session.id);
    },
    onError: (cause: Error) => setAppError(cause.message),
  });

  function createNewItem() {
    if (ui.workspaceScope === "personal") {
      if (!createPersonalSession.isPending) createPersonalSession.mutate();
      return;
    }
    if (!createFolderTask.isPending) createFolderTask.mutate();
  }

  useGSAP(() => {
    const root = appShellRef.current;
    if (root === null) return;

    const sidebarContent = root.querySelectorAll(
      ".sidebar-body, .sidebar-footer, .sidebar-resize-handle",
    );
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targetWidth = ui.sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
    const targetContextPadding = ui.sidebarCollapsed ? `${isDarwin ? 128 : 64}px` : "20px";
    const targetSidebarPadding = ui.sidebarCollapsed ? "0px" : "11px";
    const targetSidebarBorderWidth = ui.sidebarCollapsed ? "0px" : "1px";

    if (!sidebarAnimationReadyRef.current) {
      gsap.set(root, {
        "--sidebar-layout-width": targetWidth,
        "--topbar-context-padding": targetContextPadding,
        "--sidebar-inline-padding": targetSidebarPadding,
        "--sidebar-border-width": targetSidebarBorderWidth,
      });
      gsap.set(sidebarContent, {
        autoAlpha: ui.sidebarCollapsed ? 0 : 1,
        x: ui.sidebarCollapsed ? -8 : 0,
      });
      sidebarAnimationReadyRef.current = true;
      return;
    }

    gsap.killTweensOf([root, ...sidebarContent]);
    const timeline = gsap.timeline({
      defaults: {
        overwrite: "auto",
      },
    });

    timeline.to(root, {
      "--sidebar-layout-width": targetWidth,
      "--topbar-context-padding": targetContextPadding,
      "--sidebar-inline-padding": targetSidebarPadding,
      "--sidebar-border-width": targetSidebarBorderWidth,
      duration: reduceMotion ? 0 : 0.28,
      ease: "power3.inOut",
    }, 0);

    timeline.to(sidebarContent, {
      autoAlpha: ui.sidebarCollapsed ? 0 : 1,
      x: ui.sidebarCollapsed ? -8 : 0,
      duration: reduceMotion ? 0 : (ui.sidebarCollapsed ? 0.14 : 0.2),
      ease: ui.sidebarCollapsed ? "power2.in" : "power2.out",
      stagger: reduceMotion || ui.sidebarCollapsed ? 0 : 0.015,
    }, reduceMotion || ui.sidebarCollapsed ? 0 : 0.08);
  }, {
    scope: appShellRef,
    dependencies: [ui.sidebarCollapsed],
  });

  useGSAP(() => {
    const root = appShellRef.current;
    if (root === null) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const panelHeight = consoleOpen ? clampConsolePanelHeight(consolePanelHeight) : 0;

    gsap.killTweensOf(root, "--console-panel-height");
    gsap.to(root, {
      "--console-panel-height": `${panelHeight}px`,
      duration: reduceMotion ? 0 : (consoleOpen ? 0.32 : 0.24),
      ease: consoleOpen ? "power3.out" : "power2.inOut",
      overwrite: "auto",
    });
  }, {
    scope: appShellRef,
    dependencies: [consoleOpen],
  });

  const baseLoading = settings.isLoading
    || buildInfo.isLoading
    || workspaces.isLoading
    || sessions.isLoading
    || providers.isLoading
    || models.isLoading
    || toolApprovals.isLoading;
  const baseError = settings.error ?? buildInfo.error ?? workspaces.error ?? sessions.error ?? providers.error ?? models.error ?? toolApprovals.error;
  if (baseLoading) return <AppLoading t={t} />;
  if (baseError !== null) {
    return <AppFailure t={t} detail={errorMessage(baseError)} onRetry={() => {
      void Promise.all([
        settings.refetch(),
        buildInfo.refetch(),
        workspaces.refetch(),
        sessions.refetch(),
        providers.refetch(),
        models.refetch(),
        toolApprovals.refetch(),
      ]);
    }} />;
  }
  if (settings.data === undefined || buildInfo.data === undefined) {
    return <AppLoading t={t} />;
  }

  const resourceWorkspaceId = scopeWorkspace?.kind === "folder" ? scopeWorkspace.id : null;
  const appSettings = settings.data;
  const onboardingOpen = !appSettings.onboardingSkipped;
  const terminalWorkingDirectory = selectedSession?.workingDirectory
    ?? selectedWorkspace?.rootPath
    ?? scopeWorkspace?.rootPath;
  const consolePanel = consoleMounted ? (
    <PiConsolePanel
      commandRequest={consoleCommandRequest}
      {...(terminalWorkingDirectory === undefined ? {} : { cwd: terminalWorkingDirectory })}
      open={consoleOpen}
      height={consolePanelHeight}
      t={t}
      onClose={closeConsole}
      onClosed={finishClosingConsole}
      onResize={resizeConsole}
    />
  ) : null;

  return (
    <div
      ref={appShellRef}
      className={`desktop ${ui.sidebarCollapsed ? "sidebar-collapsed" : ""}${consoleOpen && !ui.settingsOpen ? " pi-console-open" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--sidebar-layout-width": initialSidebarLayoutWidthRef.current,
        "--topbar-context-padding": initialTopbarContextPaddingRef.current,
        "--sidebar-inline-padding": initialSidebarInlinePaddingRef.current,
        "--sidebar-border-width": initialSidebarBorderWidthRef.current,
        "--console-panel-height": "0px",
      } as CSSProperties}
    >
      <div className="workspace-shell" inert={ui.settingsOpen ? true : undefined} aria-hidden={ui.settingsOpen || undefined}>
        <a className="skip-link" href="#main-content">{t("work")}</a>
        <TopBar
          workspaceScope={ui.workspaceScope}
          workspaces={workspaces.data ?? []}
          t={t}
          onWorkspaceScope={ui.setWorkspaceScope}
          onToggleSidebar={toggleSidebar}
          consoleOpen={consoleOpen}
          onToggleConsole={toggleConsole}
        />
        <Sidebar
          view={ui.view}
          buildInfo={buildInfo.data}
          sessions={scopedSessions}
          workspaceScope={ui.workspaceScope}
          selectedTaskId={ui.selectedTaskId}
          isFolder={scopeWorkspace?.kind === "folder"}
          collapsed={ui.sidebarCollapsed}
          drawerOpen={ui.sidebarDrawerOpen}
          width={sidebarWidth}
          t={t}
          onNewTask={() => {
            createNewItem();
            ui.setSidebarDrawerOpen(false);
          }}
          onView={showView}
          onOpenSettings={() => ui.openSettings()}
          onOpenTask={openSession}
          onCloseDrawer={() => ui.setSidebarDrawerOpen(false)}
          onResize={resizeSidebar}
        />
        <main className="app-main" id="main-content">
        {appError === null ? null : (
          <Alert className="app-notice">
            <AlertDescription>{appError}</AlertDescription>
            <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setAppError(null)}>
              <Icon name="close" />
            </Button>
          </Alert>
        )}
        {ui.view === "inbox" && selectedSession !== null ? (
          <TaskWorkbench
            key={selectedSession.id}
            session={selectedSession}
            workspace={selectedWorkspace}
            settings={appSettings}
            models={models.data}
            statuses={workflowWorkspaceId === null ? [] : (statuses.data ?? [])}
            labels={workflowWorkspaceId === null ? [] : (labels.data ?? [])}
            approvals={(toolApprovals.data ?? []).filter(({ sessionId }) => sessionId === selectedSession.id)}
            taskMode={ui.taskMode}
            contextPanel={ui.contextPanel}
            t={t}
            onTaskMode={ui.setTaskMode}
            onContextOpen={ui.openContextPanel}
            onContextClose={ui.closeContextPanel}
            onRefresh={refresh}
            onDelete={() => removeSession.mutate(selectedSession.id)}
            folders={folderWorkspaces}
            onPromoted={(session) => {
              void refresh().then(() => {
                ui.setWorkspaceScope(session.workspaceId);
                ui.openTask(session.id);
              });
            }}
          />
        ) : null}
        {ui.view === "inbox" && selectedSession === null ? (
          <SessionEmptyState
            personal={ui.workspaceScope === "personal"}
            t={t}
            onNewTask={createNewItem}
          />
        ) : null}
        {ui.view === "board" && boardWorkspace !== null ? (
          <BoardPage
            sessions={sessions.data ?? []}
            snapshot={boardSnapshot.data}
            boards={boards.data ?? []}
            statuses={statuses.data ?? []}
            labels={labels.data ?? []}
            workspace={boardWorkspace}
            t={t}
            onNewTask={createNewItem}
            onOpenTask={openSession}
            onSelectBoard={setSelectedBoardId}
            onRefresh={refresh}
          />
        ) : null}
        {ui.view === "sources" && resourceWorkspaceId !== null ? <SourcesPage workspaceId={resourceWorkspaceId} t={t} /> : null}
        {ui.view === "automations" && resourceWorkspaceId !== null ? <AutomationsPage workspaceId={resourceWorkspaceId} t={t} /> : null}
      </main>
        {!ui.settingsOpen ? consolePanel : null}
      </div>
      {ui.settingsOpen ? (
        <SettingsPage
          section={ui.settingsSection}
          settings={appSettings}
          buildInfo={buildInfo.data}
          workspaces={workspaces.data ?? []}
          providers={providers.data ?? []}
          models={models.data}
          t={t}
          onSectionChange={ui.setSettingsSection}
          onClose={ui.closeSettings}
          onUpdate={updateSettings}
          onAddWorkspace={addWorkspace}
          onAddWorkspaceDirectory={addWorkspaceDirectory}
          onProvidersChanged={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["providers"] }),
              queryClient.invalidateQueries({ queryKey: ["models"] }),
            ]);
          }}
          onModelsRefresh={async () => {
            await Promise.all([
              providers.refetch(),
              models.refetch(),
            ]);
          }}
          onRestartOnboarding={() => updateSettings({ onboardingSkipped: false })}
          consoleOpen={consoleOpen}
          consolePanel={consolePanel}
          onOpenConsole={openConsole}
          onToggleConsole={toggleConsole}
        />
      ) : null}
      <CommandPalette
        open={ui.commandOpen}
        workspaces={workspaces.data ?? []}
        baseSessions={sessions.data ?? []}
        t={t}
        onOpenChange={ui.setCommandOpen}
        onOpenTask={openSession}
        onOpenContext={openContext}
        onOpenSettings={ui.openSettings}
      />
      {!ui.settingsOpen ? (
        <OnboardingDialog
          open={onboardingOpen}
          settings={appSettings}
          models={models.data}
          workspaces={workspaces.data ?? []}
          t={t}
          onUpdateSettings={updateSettings}
          onSaveProvider={async (providerId, apiKey) => {
            await window.piWork.provider.save({ providerId, apiKey });
            await queryClient.invalidateQueries({ queryKey: ["providers"] });
          }}
          onAddWorkspace={addWorkspace}
          onFinish={() => updateSettings({ onboardingSkipped: true })}
        />
      ) : null}
    </div>
  );
}

function AppLoading({ t }: { t: ReturnType<typeof translator> }) {
  return (
    <div className="app-state">
      <div className="app-state-mark"><span /><span /><span /></div>
      <p>{t("loading")}</p>
    </div>
  );
}

function AppFailure(props: {
  t: ReturnType<typeof translator>;
  detail: string;
  onRetry(): void;
}) {
  return (
    <div className="app-state app-state-failure">
      <section className="app-failure" aria-labelledby="app-failure-title" aria-describedby="app-failure-summary">
        <div className="app-failure-message" role="alert" aria-atomic="true">
          <Icon className="app-failure-icon" name="alert" />
          <h1 id="app-failure-title">{props.t("appLoadFailedTitle")}</h1>
          <p className="app-failure-summary" id="app-failure-summary">{props.t("appLoadFailedDetail")}</p>
        </div>
        <Button onClick={props.onRetry}>{props.t("tryAgain")}</Button>
        <Disclosure className="app-failure-details">
          <DisclosureTrigger className="app-failure-details-trigger">
            {props.t("technicalDetails")}
            <Icon name="chevron-down" size={14} />
          </DisclosureTrigger>
          <DisclosureContent className="app-failure-details-content">
            <pre>{props.detail}</pre>
          </DisclosureContent>
        </Disclosure>
      </section>
    </div>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
