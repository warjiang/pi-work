import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, Workspace } from "@pi-work/protocol";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Icon } from "./components/ui/icon.js";
import {
  CommandPalette,
  NewTaskDialog,
  OnboardingDialog,
  Sidebar,
  TopBar,
} from "./features/app-shell.js";
import { BrowserPage } from "./features/browser-page.js";
import { SettingsPage } from "./features/settings-page.js";
import { TaskListPage, TaskWorkbench } from "./features/task-workbench.js";
import {
  AutomationsPage,
  BoardPage,
  FolderSettingsPage,
  SkillsPage,
  SourcesPage,
} from "./features/workspace-pages.js";
import { translator } from "./i18n.js";
import type { AppView, WorkspaceScope } from "./store.js";
import { useWorkspaceUi } from "./store.js";

export function App() {
  const queryClient = useQueryClient();
  const ui = useWorkspaceUi();
  const [appError, setAppError] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.piWork.settings.get() });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => window.piWork.workspace.list() });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => window.piWork.session.list() });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const models = useQuery({ queryKey: ["models"], queryFn: () => window.piWork.model.list() });
  const toolApprovals = useQuery({ queryKey: ["tool-approvals"], queryFn: () => window.piWork.chat.toolApprovals() });
  const language = settings.data?.language ?? "en";
  const t = translator(language);

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
  const folderSessions = scopedSessions.filter((session) => (
    session.kind === "task" && workspaceById.get(session.workspaceId)?.kind === "folder"
  ));
  const artifactQueries = useQueries({
    queries: folderSessions.map((session) => ({
      queryKey: ["artifacts", session.id],
      queryFn: () => window.piWork.artifact.list(session.id),
      staleTime: 2_000,
    })),
  });
  const unpublishedBySessionId = useMemo(() => new Map(
    folderSessions.map((session, index) => [
      session.id,
      (artifactQueries[index]?.data ?? []).some(({ publishedPath }) => publishedPath === null),
    ]),
  ), [artifactQueries, folderSessions]);
  const attentionIds = useMemo(() => {
    const ids = new Set<string>();
    scopedSessions.forEach((session) => {
      if (
        session.status === "awaiting_plan_approval"
        || session.status === "awaiting_action_approval"
        || session.status === "failed"
        || (toolApprovals.data ?? []).some(({ sessionId }) => sessionId === session.id)
        || unpublishedBySessionId.get(session.id) === true
      ) {
        ids.add(session.id);
      }
    });
    return ids;
  }, [scopedSessions, toolApprovals.data, unpublishedBySessionId]);

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
      if (command && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        ui.setNewTaskOpen(true);
      }
      if (command && event.key.toLocaleLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
      if (command && event.key.toLocaleLowerCase() === "i" && selectedSession !== null) {
        event.preventDefault();
        ui.toggleInspector();
      }
      if (event.key === "Escape") {
        ui.setCommandOpen(false);
        ui.setSidebarDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedSession, settings.data?.sidebarCollapsed, ui]);

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["statuses"] }),
      queryClient.invalidateQueries({ queryKey: ["labels"] }),
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

  function showView(view: AppView) {
    ui.selectTask(null);
    if (
      (view === "board" || view === "sources" || view === "skills" || view === "automations" || view === "folder-settings")
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

  const baseLoading = settings.isLoading
    || workspaces.isLoading
    || sessions.isLoading
    || providers.isLoading
    || models.isLoading
    || toolApprovals.isLoading;
  const baseError = settings.error ?? workspaces.error ?? sessions.error ?? providers.error ?? models.error ?? toolApprovals.error;
  if (baseLoading) return <AppLoading t={t} />;
  if (baseError !== null) {
    return <AppFailure t={t} detail={errorMessage(baseError)} onRetry={() => {
      void Promise.all([
        settings.refetch(),
        workspaces.refetch(),
        sessions.refetch(),
        providers.refetch(),
        models.refetch(),
        toolApprovals.refetch(),
      ]);
    }} />;
  }
  if (settings.data === undefined) {
    return <AppLoading t={t} />;
  }

  const inboxSessions = scopedSessions.filter(({ archived, status }) => !archived && status !== "completed");
  const attentionSessions = scopedSessions.filter(({ id, archived }) => !archived && attentionIds.has(id));
  const completedSessions = scopedSessions.filter(({ archived, status }) => !archived && status === "completed");
  const pageSessions = ui.view === "attention"
    ? attentionSessions
    : ui.view === "completed"
      ? completedSessions
      : inboxSessions;
  const resourceWorkspaceId = scopeWorkspace?.kind === "folder" ? scopeWorkspace.id : null;
  const appSettings = settings.data;
  const onboardingOpen = !appSettings.onboardingSkipped;

  return (
    <div className={`desktop ${ui.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">{t("work")}</a>
      <TopBar
        workspaceScope={ui.workspaceScope}
        workspaces={workspaces.data ?? []}
        t={t}
        onWorkspaceScope={ui.setWorkspaceScope}
        onAddWorkspace={() => void addWorkspace()}
        onManageWorkspaces={() => showView("settings")}
        onToggleSidebar={toggleSidebar}
        onOpenSearch={() => ui.setCommandOpen(true)}
        onNewTask={() => ui.setNewTaskOpen(true)}
      />
      <Sidebar
        view={ui.view}
        sessions={scopedSessions}
        selectedTaskId={ui.selectedTaskId}
        attentionIds={attentionIds}
        isFolder={scopeWorkspace?.kind === "folder"}
        collapsed={ui.sidebarCollapsed}
        drawerOpen={ui.sidebarDrawerOpen}
        t={t}
        onView={showView}
        onOpenTask={openSession}
        onCloseDrawer={() => ui.setSidebarDrawerOpen(false)}
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
            inspectorOpen={ui.inspectorOpen}
            inspectorTab={ui.inspectorTab}
            t={t}
            onInspectorOpen={ui.showInspector}
            onInspectorToggle={ui.toggleInspector}
            onInspectorTab={ui.setInspectorTab}
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
        {(ui.view === "inbox" && selectedSession === null) || ui.view === "attention" || ui.view === "completed" ? (
          <TaskListPage
            title={t(ui.view === "attention"
              ? "attention"
              : ui.view === "completed"
                ? "completed"
                : ui.workspaceScope === "personal"
                  ? "personalSessions"
                  : "folderTasks")}
            sessions={pageSessions}
            workspaces={workspaces.data ?? []}
            t={t}
            onOpenTask={openSession}
          />
        ) : null}
        {ui.view === "board" && boardWorkspace !== null ? (
            <BoardPage
              sessions={sessions.data ?? []}
              statuses={statuses.data ?? []}
              labels={labels.data ?? []}
              workspace={boardWorkspace}
              t={t}
              onOpenTask={openSession}
              onRefresh={refresh}
            />
        ) : null}
        {ui.view === "sources" && resourceWorkspaceId !== null ? <SourcesPage workspaceId={resourceWorkspaceId} t={t} /> : null}
        {ui.view === "skills" && resourceWorkspaceId !== null ? <SkillsPage workspaceId={resourceWorkspaceId} t={t} /> : null}
        {ui.view === "automations" && resourceWorkspaceId !== null ? <AutomationsPage workspaceId={resourceWorkspaceId} t={t} /> : null}
        {ui.view === "folder-settings" && boardWorkspace !== null ? <FolderSettingsPage workspace={boardWorkspace} t={t} /> : null}
        {ui.view === "browser" ? <BrowserPage t={t} /> : null}
        {ui.view === "settings" ? (
          <SettingsPage
            settings={appSettings}
            workspaces={workspaces.data ?? []}
            providers={providers.data ?? []}
            models={models.data}
            t={t}
            onUpdate={updateSettings}
            onAddWorkspace={addWorkspace}
            onProvidersChanged={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["providers"] }),
                queryClient.invalidateQueries({ queryKey: ["models"] }),
              ]);
            }}
            onRestartOnboarding={() => updateSettings({ onboardingSkipped: false })}
          />
        ) : null}
      </main>
      <CommandPalette
        open={ui.commandOpen}
        workspaces={workspaces.data ?? []}
        baseSessions={sessions.data ?? []}
        t={t}
        onOpenChange={ui.setCommandOpen}
        onOpenTask={openSession}
        onOpenContext={openContext}
      />
      <NewTaskDialog
        open={ui.newTaskOpen}
        scope={ui.workspaceScope}
        workspaces={workspaces.data ?? []}
        providers={providers.data ?? []}
        models={models.data}
        settings={appSettings}
        t={t}
        onOpenChange={ui.setNewTaskOpen}
        onCreated={(session) => {
          void refresh().then(() => {
            ui.setWorkspaceScope(session.kind === "chat" ? "personal" : session.workspaceId);
            ui.openTask(session.id);
          });
        }}
      />
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
    <div className="app-state">
      <Icon name="alert" />
      <h1>{props.t("failedToLoad")}</h1>
      <p>{props.detail}</p>
      <Button onClick={props.onRetry}>{props.t("tryAgain")}</Button>
    </div>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
