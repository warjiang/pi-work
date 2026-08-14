import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import type {
  AppSettings,
  BuildInfo,
  ModelCatalog,
  ModelOption,
  PermissionMode,
  ProviderConfig,
  Session,
  Skill,
  Source,
  ThinkingLevel,
  Workspace,
} from "@pi-work/protocol";
import { PiMark } from "@/components/pi-mark.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field.js";
import { Icon } from "@/components/ui/icon.js";
import type { IconName } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { thinkingLevelLabel } from "@/i18n.js";
import type { MessageKey } from "@/i18n.js";
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
} from "@/sidebar-layout.js";
import type { AppView, SettingsSection, WorkspaceScope } from "@/store.js";

type T = (key: MessageKey) => string;

export const workspaceSidebarIcons = {
  inbox: "inbox",
  attention: "attention",
  completed: "check-circle",
  board: "folder-kanban",
  sources: "source",
  automations: "automation",
  folderSettings: "folder-settings",
  settings: "settings",
} as const satisfies Record<string, IconName>;

export function TopBar(props: {
  workspaceScope: WorkspaceScope;
  workspaces: Workspace[];
  sessionTitle?: string;
  t: T;
  onToggleSidebar(): void;
  consoleOpen: boolean;
  onToggleConsole(): void;
}) {
  const folder = props.workspaces.find(({ id }) => id === props.workspaceScope);
  const personal = props.workspaceScope === "personal";
  const scopeLabel = personal ? props.t("personal") : (folder?.name ?? props.t("personal"));
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <Button variant="ghost" size="icon" className="topbar-menu" aria-label={props.t("toggleSidebar")} onClick={props.onToggleSidebar}>
          <Icon name="panel" />
        </Button>
      </div>
      <div className="topbar-context">
        {props.sessionTitle !== undefined ? (
          <>
            {!personal ? <Icon name="workspace" size={14} /> : null}
            <h1 title={props.sessionTitle}>{props.sessionTitle}</h1>
          </>
        ) : !personal ? (
          <div className="workspace-switcher"><span>{scopeLabel}</span></div>
        ) : null}
        <div className="topbar-task-actions" id="topbar-task-actions" />
      </div>
      <div className="topbar-trailing">
        <Button
          variant="ghost"
          size="icon"
          className={`topbar-console-trigger${props.consoleOpen ? " is-active" : ""}`}
          aria-label={props.t("piConsole")}
          aria-pressed={props.consoleOpen}
          onClick={props.onToggleConsole}
        >
          <Icon name="terminal" />
        </Button>
      </div>
    </header>
  );
}

export function Sidebar(props: {
  view: AppView;
  buildInfo: BuildInfo;
  sessions: Session[];
  personalSessions: Session[];
  workspaces: Workspace[];
  workspaceScope: WorkspaceScope;
  selectedTaskId: string | null;
  attentionIds: Set<string>;
  isFolder: boolean;
  collapsed: boolean;
  drawerOpen: boolean;
  width: number;
  t: T;
  onNewTask(): void;
  onView(view: AppView): void;
  onWorkspaceScope(scope: WorkspaceScope): void;
  onOpenSettings(): void;
  onOpenTask(taskId: string): void;
  onCloseDrawer(): void;
  onResize(width: number, commit: boolean): void;
}) {
  const resizeState = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    latestWidth: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const recent = props.sessions.filter(({ archived }) => !archived).slice(0, 14);
  const personalRecent = props.personalSessions.filter(({ archived }) => !archived).slice(0, 14);
  const folders = props.workspaces.filter(({ kind }) => kind === "folder");
  const attentionCount = props.sessions.filter(({ id }) => props.attentionIds.has(id)).length;
  const completedCount = props.sessions.filter(({ status, archived }) => status === "completed" && !archived).length;
  const version = props.buildInfo.version.startsWith("v") ? props.buildInfo.version : `v${props.buildInfo.version}`;
  const buildSummary = props.buildInfo.commit?.slice(0, 7);
  useEffect(() => {
    document.documentElement.dataset.sidebarResizing = String(resizing);
    return () => {
      delete document.documentElement.dataset.sidebarResizing;
    };
  }, [resizing]);

  const finishResize = (pointerId: number): void => {
    const state = resizeState.current;
    if (state === null || state.pointerId !== pointerId) return;
    resizeState.current = null;
    setResizing(false);
    props.onResize(state.latestWidth, true);
  };

  return (
    <>
      {props.drawerOpen ? <Button variant="ghost" className="sidebar-backdrop" aria-label={props.t("close")} onClick={props.onCloseDrawer} /> : null}
      <aside className={`sidebar ${props.collapsed ? "is-collapsed" : ""} ${props.drawerOpen ? "is-open" : ""}`}>
        <div className="sidebar-body">
          <div className="sidebar-brand"><PiMark /><strong>{props.t("appName")}</strong></div>
          <Button className="sidebar-new-task" onClick={props.onNewTask}>
            <Icon name="plus" size={14} />
            {props.workspaceScope === "personal" ? props.t("newSession") : props.t("newTask")}
          </Button>
          <SidebarSection className="workspace-list-section" title={props.t("allWorkspaces")}>
            {folders.map((workspace) => (
              <SidebarNavButton
                key={workspace.id}
                active={props.workspaceScope === workspace.id}
                icon="workspace"
                label={workspace.name}
                {...(workspace.directories.length > 1 ? { badge: workspace.directories.length } : {})}
                onClick={() => props.onWorkspaceScope(workspace.id)}
              />
            ))}
            {folders.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
          </SidebarSection>
          <SidebarSection className="recent-section personal-recent-section" title={props.t("personalSessions")} count={personalRecent.length}>
            <div className="recent-task-list">
              {personalRecent.map((session) => (
                <Button
                  variant="ghost"
                  className={`recent-task ${props.selectedTaskId === session.id ? "selected" : ""}`}
                  key={session.id}
                  aria-current={props.selectedTaskId === session.id ? "page" : undefined}
                  onClick={() => props.onOpenTask(session.id)}
                >
                  <span>{session.title}</span>
                  {session.flagged ? <Icon name="flag" size={14} /> : null}
                </Button>
              ))}
              {personalRecent.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
            </div>
          </SidebarSection>
          <SidebarSection title={props.t("work")}>
            <SidebarNavButton active={props.view === "inbox"} icon={workspaceSidebarIcons.inbox} label={props.t("inbox")} onClick={() => props.onView("inbox")} />
            <SidebarNavButton active={props.view === "attention"} icon={workspaceSidebarIcons.attention} label={props.t("attention")} badge={attentionCount} onClick={() => props.onView("attention")} />
            <SidebarNavButton active={props.view === "completed"} icon={workspaceSidebarIcons.completed} label={props.t("completed")} badge={completedCount} onClick={() => props.onView("completed")} />
            {props.isFolder ? <SidebarNavButton active={props.view === "board"} icon={workspaceSidebarIcons.board} label={props.t("board")} onClick={() => props.onView("board")} /> : null}
          </SidebarSection>
          {props.isFolder ? <SidebarSection className="recent-section workspace-task-section" title={props.t("folderTasks")} count={recent.length}>
            <div className="recent-task-list">
              {recent.map((session) => (
                <Button
                  variant="ghost"
                  className={`recent-task ${props.view === "inbox" && props.selectedTaskId === session.id ? "selected" : ""}`}
                  key={session.id}
                  aria-current={props.view === "inbox" && props.selectedTaskId === session.id ? "page" : undefined}
                  onClick={() => props.onOpenTask(session.id)}
                >
                  <span>{session.title}</span>
                  {session.flagged ? <Icon name="flag" size={14} /> : null}
                </Button>
              ))}
              {recent.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
            </div>
          </SidebarSection> : null}
          {props.isFolder ? (
            <SidebarSection title={props.t("library")}>
              <SidebarNavButton active={props.view === "sources"} icon={workspaceSidebarIcons.sources} label={props.t("sources")} onClick={() => props.onView("sources")} />
              <SidebarNavButton active={props.view === "automations"} icon={workspaceSidebarIcons.automations} label={props.t("automations")} onClick={() => props.onView("automations")} />
              <SidebarNavButton active={props.view === "folder-settings"} icon={workspaceSidebarIcons.folderSettings} label={props.t("folderSettings")} onClick={() => props.onView("folder-settings")} />
            </SidebarSection>
          ) : null}
        </div>
        <footer className="sidebar-footer">
          <Button type="button" variant="ghost" className="sidebar-settings-button" onClick={props.onOpenSettings}>
            <Icon name={workspaceSidebarIcons.settings} />
            <strong>{props.t("settings")}</strong>
            <span
              className="sidebar-settings-version"
              title={buildSummary ? `${version} · ${props.buildInfo.commit}` : version}
            >
              {buildSummary ? `${version} · ${buildSummary}` : version}
            </span>
          </Button>
        </footer>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label={props.t("resizeSidebar")}
          aria-orientation="vertical"
          aria-valuemin={minimumSidebarWidth}
          aria-valuemax={maximumSidebarWidth}
          aria-valuenow={props.width}
          tabIndex={0}
          onDoubleClick={() => props.onResize(defaultSidebarWidth, true)}
          onKeyDown={(event) => {
            let nextWidth = props.width;
            if (event.key === "ArrowLeft") nextWidth -= 16;
            else if (event.key === "ArrowRight") nextWidth += 16;
            else if (event.key === "Home") nextWidth = minimumSidebarWidth;
            else if (event.key === "End") nextWidth = maximumSidebarWidth;
            else return;
            event.preventDefault();
            props.onResize(clampSidebarWidth(nextWidth), true);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeState.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: props.width,
              latestWidth: props.width,
            };
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const state = resizeState.current;
            if (state === null || state.pointerId !== event.pointerId) return;
            const width = clampSidebarWidth(state.startWidth + event.clientX - state.startX);
            state.latestWidth = width;
            props.onResize(width, false);
          }}
          onPointerUp={(event) => finishResize(event.pointerId)}
          onPointerCancel={(event) => finishResize(event.pointerId)}
          onLostPointerCapture={(event) => finishResize(event.pointerId)}
        />
      </aside>
    </>
  );
}

function SidebarSection(props: { title: string; count?: number; className?: string; children: ReactNode }) {
  return (
    <section className={`sidebar-section ${props.className ?? ""}`}>
      <header><span>{props.title}</span>{props.count === undefined ? null : <small>{props.count}</small>}</header>
      <nav>{props.children}</nav>
    </section>
  );
}

function SidebarNavButton(props: { active: boolean; icon: IconName; label: string; badge?: number; onClick(): void }) {
  return (
    <Button type="button" variant="ghost" className={`sidebar-nav-button ${props.active ? "selected" : ""}`} aria-current={props.active ? "page" : undefined} onClick={props.onClick}>
      <Icon name={props.icon} />
      <strong>{props.label}</strong>
      {props.badge ? <span className="nav-count">{props.badge}</span> : null}
    </Button>
  );
}

type SearchItem = {
  id: string;
  group: "tasks" | "messages" | "resources" | "settings";
  title: string;
  detail: string;
  icon: IconName;
  action(): void;
};

export const commandSettingItems: ReadonlyArray<{ section: SettingsSection; key: MessageKey }> = [
  { section: "general", key: "general" },
  { section: "modelsCredentials", key: "modelsCredentials" },
  { section: "permissions", key: "permissions" },
  { section: "skills", key: "skills" },
  { section: "mcp", key: "mcp" },
  { section: "extensions", key: "extensions" },
  { section: "browser", key: "browser" },
  { section: "about", key: "about" },
];

export function CommandPalette(props: {
  open: boolean;
  workspaces: Workspace[];
  baseSessions: Session[];
  t: T;
  onOpenChange(open: boolean): void;
  onOpenTask(taskId: string): void;
  onOpenContext(scope: WorkspaceScope, view: AppView): void;
  onOpenSettings(section: SettingsSection): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const folders = props.workspaces.filter(({ kind }) => kind === "folder");
  const search = useQuery({
    queryKey: ["command-search", query],
    queryFn: () => window.piWork.session.list({ query }),
    enabled: props.open && query.trim().length > 0,
  });
  const sourceQueries = useQueries({
    queries: folders.map((workspace) => ({
      queryKey: ["command-sources", workspace.id],
      queryFn: () => window.piWork.source.list(workspace.id),
      enabled: props.open && query.trim().length > 0,
    })),
  });
  const skills = useQuery({
    queryKey: ["command-skills"],
    queryFn: () => window.piWork.skill.list(),
    enabled: props.open && query.trim().length > 0,
  });
  const normalized = query.trim().toLocaleLowerCase();
  const sessions = query.trim() === ""
    ? props.baseSessions.slice(0, 8)
    : (search.data ?? []);
  const items = useMemo<SearchItem[]>(() => {
    const result: SearchItem[] = [];
    sessions.forEach((session) => {
      const direct = `${session.title} ${session.goal}`.toLocaleLowerCase().includes(normalized);
      const workspace = props.workspaces.find(({ id }) => id === session.workspaceId);
      const context = workspace?.kind === "managed" ? props.t("personal") : (workspace?.name ?? props.t("workFolder"));
      result.push({
        id: session.id,
        group: normalized !== "" && !direct ? "messages" : "tasks",
        title: session.title,
        detail: session.goal ? `${context} · ${session.goal}` : context,
        icon: session.kind === "task" ? "plan" : "inbox",
        action: () => props.onOpenTask(session.id),
      });
    });
    const addResource = (resource: Source | Skill, workspace: Workspace | null, kind: "sources" | "skills") => {
      if (normalized === "" || !`${resource.name} ${"description" in resource ? resource.description : resource.type}`.toLocaleLowerCase().includes(normalized)) return;
      const isMcp = "type" in resource && (resource.type === "mcp_stdio" || resource.type === "mcp_http");
      result.push({
        id: `${kind}:${workspace?.id ?? "global"}:${resource.id}`,
        group: "resources",
        title: resource.name,
        detail: workspace === null ? props.t("skills") : `${workspace.name} · ${props.t(isMcp ? "mcp" : "sources")}`,
        icon: kind === "sources" ? "source" : "skills",
        action: () => kind === "skills"
          ? props.onOpenSettings("skills")
          : isMcp
            ? props.onOpenSettings("mcp")
            : props.onOpenContext(workspace!.id, "sources"),
      });
    };
    folders.forEach((workspace, index) => {
      (sourceQueries[index]?.data ?? []).forEach((source) => addResource(source, workspace, "sources"));
    });
    (skills.data ?? []).forEach((skill) => addResource(skill, null, "skills"));
    commandSettingItems.forEach(({ section, key }) => {
      if (normalized === "" || !props.t(key).toLocaleLowerCase().includes(normalized)) return;
      result.push({
        id: `settings:${section}`,
        group: "settings",
        title: props.t(key),
        detail: props.t("settings"),
        icon: "settings",
        action: () => props.onOpenSettings(section),
      });
    });
    return result.slice(0, 28);
  }, [folders, normalized, props, sessions, skills.data, sourceQueries]);
  const searching = search.isLoading || sourceQueries.some(({ isLoading }) => isLoading) || skills.isLoading;
  const searchFailed = search.isError || sourceQueries.some(({ isError }) => isError) || skills.isError;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!props.open) setQuery("");
  }, [props.open]);
  useEffect(() => {
    if (!props.open || items.length === 0) return;
    document.getElementById(`command-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, items.length, props.open]);

  const groups: SearchItem["group"][] = ["tasks", "messages", "resources", "settings"];
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="command-dialog"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (items.length > 0) setActive((value) => Math.min(items.length - 1, value + 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(0, value - 1));
          }
          if (event.key === "Enter" && items[active]) {
            event.preventDefault();
            items[active].action();
            props.onOpenChange(false);
          }
        }}
      >
        <DialogHeader className="command-header">
          <DialogTitle className="sr-only">{props.t("globalSearch")}</DialogTitle>
          <label className="command-input">
            <Icon name="search" />
            <Input
              autoFocus
              value={query}
              aria-controls="command-results"
              aria-activedescendant={items[active] ? `command-option-${active}` : undefined}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={props.t("globalSearch")}
            />
            <kbd>ESC</kbd>
          </label>
          <DialogDescription>{props.t("searchScope")}</DialogDescription>
        </DialogHeader>
        <div className="command-results" id="command-results" role="listbox" aria-label={props.t("globalSearch")}>
          {groups.map((group) => {
            const grouped = items.filter((item) => item.group === group);
            if (grouped.length === 0) return null;
            return (
              <section key={group} role="group" aria-labelledby={`command-group-${group}`}>
                <header id={`command-group-${group}`}>{props.t(group)}</header>
                {grouped.map((item) => {
                  const index = items.indexOf(item);
                  return (
                    <Button
                      id={`command-option-${index}`}
                      role="option"
                      variant="ghost"
                      className={index === active ? "command-result active" : "command-result"}
                      key={item.id}
                      aria-selected={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={() => {
                        item.action();
                        props.onOpenChange(false);
                      }}
                    >
                      <Icon name={item.icon} />
                      <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                      <kbd>↵</kbd>
                    </Button>
                  );
                })}
              </section>
            );
          })}
          {query.trim() !== "" && searching ? <p className="command-empty">{props.t("loading")}</p> : null}
          {query.trim() !== "" && searchFailed && !searching ? <p className="command-empty">{props.t("failedToLoad")}</p> : null}
          {query.trim() !== "" && items.length === 0 && !searching && !searchFailed ? <p className="command-empty">{props.t("noSearchResults")}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function configuredModels(
  providers: ProviderConfig[],
  models: ModelCatalog | undefined,
  settings?: AppSettings,
): ModelOption[] {
  const catalog = models?.models ?? [];
  const disabledModelKeys = new Set(settings?.disabledModelKeys ?? []);
  return providers.flatMap(({ providerId }) => catalog.filter((model) => (
    model.providerId === providerId && !disabledModelKeys.has(`${model.providerId}/${model.modelId}`)
  )));
}

export function resolveDefaultModel(
  providers: ProviderConfig[],
  models: ModelCatalog | undefined,
  settings: AppSettings | undefined,
): ModelOption | undefined {
  const availableModels = configuredModels(providers, models, settings);
  return availableModels.find(({ providerId, modelId }) => (
    providerId === settings?.providerId && modelId === settings.modelId
  )) ?? availableModels[0];
}

export function resolveDefaultThinkingLevel(
  model: ModelOption | undefined,
  settings: AppSettings | undefined,
): ThinkingLevel {
  const configuredLevel = settings?.thinkingLevel ?? "off";
  if (model?.thinkingLevels.includes(configuredLevel)) return configuredLevel;
  return model?.thinkingLevels[0] ?? "off";
}

export function createNewSessionInput(
  model: ModelOption,
  thinkingLevel: ThinkingLevel,
) {
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    thinkingLevel,
  };
}

export function NewTaskDialog(props: {
  open: boolean;
  scope: WorkspaceScope;
  workspaces: Workspace[];
  providers: ProviderConfig[];
  models: ModelCatalog | undefined;
  settings: AppSettings | undefined;
  t: T;
  onOpenChange(open: boolean): void;
  onCreated(session: Session): void;
}) {
  const workspace = props.workspaces.find(({ id, kind }) => id === props.scope && kind === "folder") ?? null;
  const availableModels = configuredModels(props.providers, props.models, props.settings);
  const defaultModel = resolveDefaultModel(props.providers, props.models, props.settings);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
  const [planMode, setPlanMode] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [modelKey, setModelKey] = useState(defaultModel ? `${defaultModel.providerId}/${defaultModel.modelId}` : "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(props.settings?.thinkingLevel ?? "off");
  const [workingDirectory, setWorkingDirectory] = useState(workspace?.rootPath ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (modelKey === "" && defaultModel) {
      setModelKey(`${defaultModel.providerId}/${defaultModel.modelId}`);
      setThinkingLevel(defaultModel.thinkingLevels.includes(props.settings?.thinkingLevel ?? "off")
        ? (props.settings?.thinkingLevel ?? "off")
        : (defaultModel.thinkingLevels[0] ?? "off"));
    }
  }, [defaultModel, modelKey, props.settings?.thinkingLevel]);
  useEffect(() => setWorkingDirectory(workspace?.rootPath ?? ""), [workspace?.id, workspace?.rootPath]);

  const selectedModel = availableModels.find((model) => `${model.providerId}/${model.modelId}` === modelKey);
  const create = useMutation({
    mutationFn: async () => {
      const cleanGoal = goal.trim();
      if (cleanGoal === "") throw new Error(props.t("validationRequired"));
      if (selectedModel === undefined) throw new Error(props.t("configureModel"));
      if (workspace === null) throw new Error(props.t("chooseFolder"));
      return window.piWork.task.create({
        workspaceId: workspace.id,
        title: title.trim() || cleanGoal.slice(0, 80),
        goal: cleanGoal,
        kind: "task",
        providerId: selectedModel.providerId,
        modelId: selectedModel.modelId,
        thinkingLevel,
        permissionMode,
        planMode,
        workingDirectory: workingDirectory || workspace.rootPath,
      });
    },
    onSuccess: (session) => {
      props.onCreated(session);
      props.onOpenChange(false);
      setTitle("");
      setGoal("");
      setError(null);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="new-task-dialog">
        <DialogHeader>
          <DialogTitle>{props.t("newTask")}</DialogTitle>
          <DialogDescription>{props.t("noTasksDetail")}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{props.t("taskTitle")}</FieldLabel>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={props.t("taskTitle")} />
          </Field>
          <Field>
            <FieldLabel>{props.t("taskDescription")}</FieldLabel>
            <Textarea autoFocus value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} placeholder={props.t("goal")} />
          </Field>
          <Field>
            <FieldLabel>{props.t("confirmation")}</FieldLabel>
            <Select value={permissionMode} onValueChange={(value) => setPermissionMode(value as PermissionMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="ask">{props.t("askEveryTime")}</SelectItem>
                <SelectItem value="explore">{props.t("exploreOnly")}</SelectItem>
                <SelectItem value="auto">{props.t("automatic")}</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            {permissionMode === "auto" ? <Alert className="risk-alert"><AlertDescription>{props.t("automaticRisk")}</AlertDescription></Alert> : null}
          </Field>
        </FieldGroup>
        <Button variant="ghost" className="advanced-toggle" onClick={() => setAdvanced((value) => !value)}>
          <Icon name="sliders" />{props.t("advanced")}<Icon name="chevron-down" size={14} className={advanced ? "rotated" : ""} />
        </Button>
        {advanced ? (
          <FieldGroup className="advanced-fields">
            <Field>
              <FieldLabel>{props.t("currentFolder")}</FieldLabel>
              <Select value={workingDirectory} onValueChange={setWorkingDirectory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{workspace?.directories.map((directory) => (
                  <SelectItem key={directory} value={directory}>{directory}</SelectItem>
                ))}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{props.t("model")}</FieldLabel>
              <Select value={modelKey} onValueChange={(value) => {
                setModelKey(value);
                const model = availableModels.find((candidate) => `${candidate.providerId}/${candidate.modelId}` === value);
                if (model && !model.thinkingLevels.includes(thinkingLevel)) setThinkingLevel(model.thinkingLevels[0] ?? "off");
              }}>
                <SelectTrigger><SelectValue placeholder={props.t("noModel")} /></SelectTrigger>
                <SelectContent><SelectGroup>{availableModels.map((model) => <SelectItem key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>{model.providerName} · {model.modelName}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{props.t("thinking")}</FieldLabel>
              <Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as ThinkingLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{(selectedModel?.thinkingLevels ?? ["off"]).map((level) => <SelectItem key={level} value={level}>{thinkingLevelLabel(level, props.t)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <label className="switch-row"><span><strong>{props.t("planFirst")}</strong><small>{props.t("generatePlanNext")}</small></span><Switch checked={planMode} onCheckedChange={setPlanMode} /></label>
          </FieldGroup>
        ) : null}
        {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{props.t("cancel")}</Button>
          <Button disabled={create.isPending || goal.trim() === ""} onClick={() => create.mutate()}>
            {create.isPending ? props.t("sending") : props.t("createTask")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OnboardingDialog(props: {
  open: boolean;
  settings: AppSettings | undefined;
  models: ModelCatalog | undefined;
  workspaces: Workspace[];
  t: T;
  onUpdateSettings(value: Partial<AppSettings>): Promise<unknown>;
  onSaveProvider(providerId: string, apiKey: string): Promise<unknown>;
  onAddWorkspace(): Promise<Workspace | null>;
  onFinish(): Promise<unknown>;
}) {
  const [step, setStep] = useState(0);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const providerOptions = useMemo(() => Array.from(new Map((props.models?.models ?? []).map((model) => [model.providerId, model.providerName])).entries()), [props.models]);
  useEffect(() => {
    if (providerId === "" && providerOptions[0]) setProviderId(providerOptions[0][0]);
  }, [providerId, providerOptions]);
  const steps = [
    [props.t("onboardingAppearance"), props.t("onboardingAppearanceDetail")],
    [props.t("onboardingModel"), props.t("onboardingModelDetail")],
    [props.t("onboardingFolder"), props.t("onboardingFolderDetail")],
  ];
  return (
    <Dialog open={props.open}>
      <DialogContent className="onboarding-dialog">
        <div className="onboarding-progress">{steps.map((_, index) => <span className={index <= step ? "active" : ""} key={index} />)}</div>
        <DialogHeader>
          <div className="onboarding-mark"><PiMark size="hero" /></div>
          <DialogTitle>{props.t("onboardingTitle")}</DialogTitle>
          <DialogDescription>{steps[step]?.[1]}</DialogDescription>
        </DialogHeader>
        {step === 0 ? (
          <FieldGroup>
            <Field>
              <FieldLabel>{props.t("language")}</FieldLabel>
              <Select value={props.settings?.language ?? "en"} onValueChange={(value) => void props.onUpdateSettings({ language: value as AppSettings["language"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{props.t("theme")}</FieldLabel>
              <Select value={props.settings?.theme ?? "system"} onValueChange={(value) => void props.onUpdateSettings({ theme: value as AppSettings["theme"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="system">{props.t("systemTheme")}</SelectItem>
                  <SelectItem value="light">{props.t("light")}</SelectItem>
                  <SelectItem value="dark">{props.t("dark")}</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        ) : null}
        {step === 1 ? (
          <FieldGroup>
            <Field><FieldLabel>{props.t("provider")}</FieldLabel><Select value={providerId} onValueChange={setProviderId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{providerOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel>{props.t("apiKey")}</FieldLabel><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
            <Button variant="outline" disabled={!providerId || !apiKey} onClick={() => void props.onSaveProvider(providerId, apiKey).then(() => setApiKey(""))}>{props.t("save")}</Button>
          </FieldGroup>
        ) : null}
        {step === 2 ? (
          <div className="onboarding-folder">
            <div><Icon name="workspace" /><span><strong>{props.t("authorizedFolders")}</strong><small>{props.workspaces.filter(({ kind }) => kind === "folder").length}</small></span></div>
            <Button variant="outline" onClick={() => void props.onAddWorkspace()}><Icon name="folder-plus" />{props.t("addWorkFolder")}</Button>
          </div>
        ) : null}
        <DialogFooter className="onboarding-footer">
          <Button variant="ghost" onClick={() => void props.onFinish()}>{props.t("skipForNow")}</Button>
          <span />
          {step > 0 ? <Button variant="outline" onClick={() => setStep((value) => value - 1)}>{props.t("previous")}</Button> : null}
          {step < 2
            ? <Button onClick={() => setStep((value) => value + 1)}>{props.t("next")}</Button>
            : <Button onClick={() => void props.onFinish()}>{props.t("finishSetup")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function modelForKey(models: ModelOption[], key: string): ModelOption | undefined {
  return models.find((model) => `${model.providerId}/${model.modelId}` === key);
}
