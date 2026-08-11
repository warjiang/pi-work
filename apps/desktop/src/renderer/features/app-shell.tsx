import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AppSettings,
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
import { PiMark } from "../components/pi-mark.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.js";
import { Icon } from "../components/ui/icon.js";
import type { IconName } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Switch } from "../components/ui/switch.js";
import { Textarea } from "../components/ui/textarea.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import { thinkingLevelLabel } from "../i18n.js";
import type { MessageKey } from "../i18n.js";
import type { AppView, WorkspaceScope } from "../store.js";

type T = (key: MessageKey) => string;

export function TopBar(props: {
  workspaceScope: WorkspaceScope;
  workspaces: Workspace[];
  t: T;
  onWorkspaceScope(scope: WorkspaceScope): void;
  onAddWorkspace(): void;
  onManageWorkspaces(): void;
  onToggleSidebar(): void;
  onOpenSearch(): void;
  onNewTask(): void;
}) {
  const folder = props.workspaces.find(({ id }) => id === props.workspaceScope);
  const scopeLabel = props.workspaceScope === "all"
    ? props.t("allWorkspaces")
    : props.workspaceScope === "personal"
      ? props.t("personal")
      : (folder?.name ?? props.t("allWorkspaces"));
  return (
    <header className="topbar">
      <Button variant="ghost" size="icon" className="topbar-menu" aria-label={props.t("toggleSidebar")} onClick={props.onToggleSidebar}>
        <Icon name="panel" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="workspace-switcher">
            <PiMark size="compact" />
            <span>{scopeLabel}</span>
            <Icon name="chevron-down" size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="workspace-menu">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => props.onWorkspaceScope("all")}><Icon name="inbox" />{props.t("allWorkspaces")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onWorkspaceScope("personal")}><Icon name="lock" />{props.t("personal")}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <div className="menu-label">{props.t("authorizedFolders")}</div>
          <DropdownMenuGroup>
            {props.workspaces.filter(({ kind }) => kind === "folder").map((workspace) => (
              <DropdownMenuItem key={workspace.id} onSelect={() => props.onWorkspaceScope(workspace.id)}>
                <Icon name="workspace" />
                <span className="menu-item-copy">{workspace.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={props.onAddWorkspace}><Icon name="folder-plus" />{props.t("addWorkFolder")}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={props.onManageWorkspaces}><Icon name="settings" />{props.t("manageWorkspaces")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" className="search-trigger" onClick={props.onOpenSearch}>
        <Icon name="search" />
        <span>{props.t("globalSearch")}</span>
        <kbd>⌘K</kbd>
      </Button>
      <Button className="topbar-new-task" onClick={props.onNewTask}><Icon name="plus" size={14} />{props.t("newTask")}</Button>
    </header>
  );
}

export function Sidebar(props: {
  view: AppView;
  sessions: Session[];
  selectedTaskId: string | null;
  attentionIds: Set<string>;
  collapsed: boolean;
  drawerOpen: boolean;
  t: T;
  onView(view: AppView): void;
  onOpenTask(taskId: string): void;
  onCloseDrawer(): void;
}) {
  const recent = props.sessions.filter(({ archived }) => !archived).slice(0, 14);
  const attentionCount = props.sessions.filter(({ id }) => props.attentionIds.has(id)).length;
  const completedCount = props.sessions.filter(({ status, archived }) => status === "completed" && !archived).length;
  return (
    <>
      {props.drawerOpen ? <Button variant="ghost" className="sidebar-backdrop" aria-label={props.t("close")} onClick={props.onCloseDrawer} /> : null}
      <aside className={`sidebar ${props.collapsed ? "is-collapsed" : ""} ${props.drawerOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand"><PiMark /><strong>{props.t("appName")}</strong></div>
        <SidebarSection title={props.t("work")}>
          <SidebarNavButton active={props.view === "inbox"} icon="inbox" label={props.t("inbox")} onClick={() => props.onView("inbox")} />
          <SidebarNavButton active={props.view === "attention"} icon="alert" label={props.t("attention")} badge={attentionCount} onClick={() => props.onView("attention")} />
          <SidebarNavButton active={props.view === "completed"} icon="check-circle" label={props.t("completed")} badge={completedCount} onClick={() => props.onView("completed")} />
          <SidebarNavButton active={props.view === "board"} icon="folder-kanban" label={props.t("board")} onClick={() => props.onView("board")} />
        </SidebarSection>
        <SidebarSection className="recent-section" title={props.t("recentTasks")} count={recent.length}>
          <div className="recent-task-list">
            {recent.map((session) => (
              <Button
                variant="ghost"
                className={`recent-task ${props.view === "inbox" && props.selectedTaskId === session.id ? "selected" : ""}`}
                key={session.id}
                onClick={() => props.onOpenTask(session.id)}
              >
                <span className={`task-state-dot state-${session.status}`} />
                <span>
                  <strong>{session.title}</strong>
                  <small>{session.kind === "task" ? props.t("task") : props.t("quickQuestion")}</small>
                </span>
                {session.flagged ? <Icon name="flag" size={14} /> : null}
              </Button>
            ))}
            {recent.length === 0 ? <p className="sidebar-empty">{props.t("noItems")}</p> : null}
          </div>
        </SidebarSection>
        <SidebarSection title={props.t("library")}>
          <SidebarNavButton active={props.view === "sources"} icon="source" label={props.t("sources")} onClick={() => props.onView("sources")} />
          <SidebarNavButton active={props.view === "skills"} icon="skills" label={props.t("skills")} onClick={() => props.onView("skills")} />
          <SidebarNavButton active={props.view === "automations"} icon="list-todo" label={props.t("automations")} onClick={() => props.onView("automations")} />
        </SidebarSection>
        <SidebarSection title={props.t("tools")}>
          <SidebarNavButton active={props.view === "browser"} icon="browser" label={props.t("browser")} onClick={() => props.onView("browser")} />
          <SidebarNavButton active={props.view === "settings"} icon="settings" label={props.t("settings")} onClick={() => props.onView("settings")} />
        </SidebarSection>
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
    <Button variant="ghost" className={`sidebar-nav-button ${props.active ? "selected" : ""}`} onClick={props.onClick}>
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

export function CommandPalette(props: {
  open: boolean;
  scope: WorkspaceScope;
  baseSessions: Session[];
  t: T;
  onOpenChange(open: boolean): void;
  onOpenTask(taskId: string): void;
  onOpenView(view: AppView): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const search = useQuery({
    queryKey: ["command-search", query, props.scope],
    queryFn: () => window.piWork.session.list({
      query,
      ...(props.scope === "all" ? {} : props.scope === "personal" ? {} : { workspaceId: props.scope }),
    }),
    enabled: props.open && query.trim().length > 0,
  });
  const sources = useQuery({
    queryKey: ["command-sources"],
    queryFn: () => window.piWork.source.list(),
    enabled: props.open && query.trim().length > 0,
  });
  const skills = useQuery({
    queryKey: ["command-skills"],
    queryFn: () => window.piWork.skill.list(),
    enabled: props.open && query.trim().length > 0,
  });
  const normalized = query.trim().toLocaleLowerCase();
  const scopedSessionIds = new Set(props.baseSessions.map(({ id }) => id));
  const sessions = query.trim() === ""
    ? props.baseSessions.slice(0, 8)
    : (search.data ?? []).filter(({ id }) => props.scope === "all" || scopedSessionIds.has(id));
  const items = useMemo<SearchItem[]>(() => {
    const result: SearchItem[] = [];
    sessions.forEach((session) => {
      const direct = `${session.title} ${session.goal}`.toLocaleLowerCase().includes(normalized);
      result.push({
        id: session.id,
        group: normalized !== "" && !direct ? "messages" : "tasks",
        title: session.title,
        detail: session.goal,
        icon: session.kind === "task" ? "plan" : "inbox",
        action: () => props.onOpenTask(session.id),
      });
    });
    const addResource = (resource: Source | Skill, kind: "sources" | "skills") => {
      if (normalized === "" || !`${resource.name} ${"description" in resource ? resource.description : resource.type}`.toLocaleLowerCase().includes(normalized)) return;
      result.push({
        id: `${kind}:${resource.id}`,
        group: "resources",
        title: resource.name,
        detail: kind === "sources" ? props.t("sources") : props.t("skills"),
        icon: kind === "sources" ? "source" : "skills",
        action: () => props.onOpenView(kind),
      });
    };
    (sources.data ?? []).forEach((source) => addResource(source, "sources"));
    (skills.data ?? []).forEach((skill) => addResource(skill, "skills"));
    const settings = [
      ["modelsCredentials", "settings"] as const,
      ["workFolders", "settings"] as const,
      ["permissions", "settings"] as const,
      ["appearance", "settings"] as const,
      ["extensions", "settings"] as const,
      ["shortcuts", "settings"] as const,
    ];
    settings.forEach(([key]) => {
      if (normalized === "" || !props.t(key).toLocaleLowerCase().includes(normalized)) return;
      result.push({
        id: `settings:${key}`,
        group: "settings",
        title: props.t(key),
        detail: props.t("settings"),
        icon: "settings",
        action: () => props.onOpenView("settings"),
      });
    });
    return result.slice(0, 28);
  }, [normalized, props, sessions, skills.data, sources.data]);
  const searching = search.isLoading || sources.isLoading || skills.isLoading;
  const searchFailed = search.isError || sources.isError || skills.isError;

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

export function NewTaskDialog(props: {
  open: boolean;
  workspaces: Workspace[];
  providers: ProviderConfig[];
  models: ModelCatalog | undefined;
  settings: AppSettings | undefined;
  t: T;
  onOpenChange(open: boolean): void;
  onAddWorkspace(): Promise<Workspace | null>;
  onCreated(session: Session): void;
}) {
  const folderWorkspaces = props.workspaces.filter(({ kind }) => kind === "folder");
  const configured = new Set(props.providers.map(({ providerId }) => providerId));
  const availableModels = (props.models?.models ?? []).filter(({ providerId }) => configured.has(providerId));
  const defaultModel = availableModels.find(({ providerId, modelId }) => (
    providerId === props.settings?.providerId && modelId === props.settings.modelId
  )) ?? availableModels[0];
  const [kind, setKind] = useState<"task" | "chat">("task");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [workspaceId, setWorkspaceId] = useState(folderWorkspaces[0]?.id ?? "");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
  const [planMode, setPlanMode] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [modelKey, setModelKey] = useState(defaultModel ? `${defaultModel.providerId}/${defaultModel.modelId}` : "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(props.settings?.thinkingLevel ?? "off");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId === "" && folderWorkspaces[0]) setWorkspaceId(folderWorkspaces[0].id);
  }, [folderWorkspaces, workspaceId]);
  useEffect(() => {
    if (modelKey === "" && defaultModel) {
      setModelKey(`${defaultModel.providerId}/${defaultModel.modelId}`);
      setThinkingLevel(defaultModel.thinkingLevels.includes(props.settings?.thinkingLevel ?? "off")
        ? (props.settings?.thinkingLevel ?? "off")
        : (defaultModel.thinkingLevels[0] ?? "off"));
    }
  }, [defaultModel, modelKey, props.settings?.thinkingLevel]);

  const selectedModel = availableModels.find((model) => `${model.providerId}/${model.modelId}` === modelKey);
  const create = useMutation({
    mutationFn: async () => {
      const cleanGoal = goal.trim();
      if (cleanGoal === "") throw new Error(props.t("validationRequired"));
      if (selectedModel === undefined) throw new Error(props.t("configureModel"));
      if (kind === "chat") {
        return window.piWork.chat.send({
          workspaceId: null,
          taskId: null,
          content: cleanGoal,
          providerId: selectedModel.providerId,
          modelId: selectedModel.modelId,
          thinkingLevel,
          permissionMode: "ask",
          planMode: false,
          attachments: [],
        });
      }
      const workspace = folderWorkspaces.find(({ id }) => id === workspaceId);
      if (workspace === undefined) throw new Error(props.t("chooseFolder"));
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
        workingDirectory: workspace.rootPath,
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
          <DialogTitle>{kind === "task" ? props.t("newTask") : props.t("quickQuestion")}</DialogTitle>
          <DialogDescription>{kind === "task" ? props.t("noTasksDetail") : props.t("messagePlaceholder")}</DialogDescription>
        </DialogHeader>
        <ToggleGroup className="task-kind-switch" type="single" value={kind} onValueChange={(value) => value && setKind(value as "task" | "chat")}>
          <ToggleGroupItem value="task"><Icon name="plan" />{props.t("newTask")}</ToggleGroupItem>
          <ToggleGroupItem value="chat"><Icon name="inbox" />{props.t("quickQuestion")}</ToggleGroupItem>
        </ToggleGroup>
        <FieldGroup>
          {kind === "task" ? (
            <Field>
              <FieldLabel>{props.t("taskTitle")}</FieldLabel>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={props.t("taskTitle")} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>{kind === "task" ? props.t("taskDescription") : props.t("quickQuestion")}</FieldLabel>
            <Textarea autoFocus value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} placeholder={props.t("goal")} />
          </Field>
          {kind === "task" ? (
            <Field>
              <FieldLabel>{props.t("workFolder")}</FieldLabel>
              <div className="folder-picker-row">
                <Select value={workspaceId} onValueChange={setWorkspaceId}>
                  <SelectTrigger><SelectValue placeholder={props.t("chooseFolder")} /></SelectTrigger>
                  <SelectContent><SelectGroup>{folderWorkspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Button variant="outline" size="icon" aria-label={props.t("addWorkFolder")} onClick={() => void props.onAddWorkspace().then((workspace) => {
                  if (workspace !== null) setWorkspaceId(workspace.id);
                })}><Icon name="folder-plus" /></Button>
              </div>
            </Field>
          ) : null}
          {kind === "task" ? (
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
          ) : null}
        </FieldGroup>
        <Button variant="ghost" className="advanced-toggle" onClick={() => setAdvanced((value) => !value)}>
          <Icon name="sliders" />{props.t("advanced")}<Icon name="chevron-down" size={14} className={advanced ? "rotated" : ""} />
        </Button>
        {advanced ? (
          <FieldGroup className="advanced-fields">
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
            {kind === "task" ? (
              <label className="switch-row"><span><strong>{props.t("planFirst")}</strong><small>{props.t("generatePlanNext")}</small></span><Switch checked={planMode} onCheckedChange={setPlanMode} /></label>
            ) : null}
          </FieldGroup>
        ) : null}
        {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{props.t("cancel")}</Button>
          <Button disabled={create.isPending || goal.trim() === ""} onClick={() => create.mutate()}>
            {create.isPending ? props.t("sending") : kind === "task" ? props.t("createTask") : props.t("askNow")}
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
