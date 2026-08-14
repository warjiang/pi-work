import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Automation,
  Label,
  Session,
  Skill,
  Source,
  McpInspectResult,
  StatusDefinition,
  SystemSkill,
  Workspace,
} from "@pi-work/protocol";
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
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
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
import { Textarea } from "@/components/ui/textarea.js";
import { Switch } from "@/components/ui/switch.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js";
import { sessionsByStage, sessionsForBoard } from "@/board.js";
import type { MessageKey } from "@/i18n.js";

type T = (key: MessageKey) => string;
type SkillFolderEntry = { name: string; path: string; type: "directory" | "file" };
type McpPreset = "stdio" | "streamable_http" | "sse";
type McpTransport = "stdio" | "streamable_http" | "sse";
const mcpSourceTypes: Source["type"][] = ["mcp_stdio", "mcp_http"];
const regularSourceTypes: Source["type"][] = ["local", "openapi", "google", "microsoft", "slack"];

function isMcpSource(source: Source): boolean {
  return mcpSourceTypes.includes(source.type);
}

export function PageHeader(props: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>{props.eyebrow ? <span>{props.eyebrow}</span> : null}<h1>{props.title}</h1>{props.detail ? <p>{props.detail}</p> : null}</div>
      {props.action}
    </header>
  );
}

export function FolderSettingsPage({ workspace, t }: { workspace: Workspace; t: T }) {
  return (
    <section className="page">
      <PageHeader eyebrow={workspace.name} title={t("folderSettings")} detail={t("folderSettingsDetail")} />
      <div className="page-body">
        <section className="settings-section">
          <div className="folder-settings-list">
            <div><Icon name="workspace" /><span><strong>{t("folderRoot")}</strong><code>{workspace.rootPath}</code></span></div>
            <div><Icon name="file-output" /><span><strong>{t("artifactRoot")}</strong><code>{workspace.outputPath}</code></span></div>
          </div>
        </section>
      </div>
    </section>
  );
}

export function BoardPage(props: {
  sessions: Session[];
  statuses: StatusDefinition[];
  labels: Label[];
  workspace: Workspace;
  t: T;
  onOpenTask(taskId: string): void;
  onRefresh(): Promise<void>;
}) {
  const [mode, setMode] = useState<"board" | "list">("board");
  const [manageOpen, setManageOpen] = useState(false);
  const visible = sessionsForBoard(props.sessions, props.workspace.id);
  const columns: Array<StatusDefinition | null> = [
    ...[...props.statuses].sort((a, b) => a.position - b.position),
    null,
  ];
  async function moveSession(sessionId: string, statusId: string | null) {
    await window.piWork.session.update({ sessionId, statusId });
    await props.onRefresh();
  }
  return (
    <section className="page">
      <PageHeader
        eyebrow={props.workspace.name}
        title={props.t("board")}
        detail={props.t("boardDetail")}
        action={<div className="page-header-actions"><ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as "board" | "list")}><ToggleGroupItem value="board">{props.t("board")}</ToggleGroupItem><ToggleGroupItem value="list">{props.t("list")}</ToggleGroupItem></ToggleGroup><Button variant="outline" onClick={() => setManageOpen(true)}><Icon name="sliders" />{props.t("manage")}</Button></div>}
      />
      <div className="page-body board-body">
        {mode === "board" ? (
          <div className="kanban">
            {columns.map((status) => {
              const columnSessions = sessionsByStage(visible, status, props.statuses);
              return (
                <section
                  className="kanban-column"
                  key={status?.id ?? "uncategorized"}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const sessionId = event.dataTransfer.getData("application/x-pi-work-session");
                    if (sessionId !== "") void moveSession(sessionId, status?.id ?? null);
                  }}
                >
                  <header><span>{status ? <i style={{ background: status.color }} /> : <i className="uncategorized-dot" />}<strong>{status?.name ?? props.t("uncategorized")}</strong></span><small>{columnSessions.length}</small></header>
                  <div className="kanban-cards">
                    {columnSessions.map((session) => (
                      <Button
                        variant="outline"
                        className="kanban-card"
                        draggable
                        key={session.id}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-pi-work-session", session.id);
                        }}
                        onClick={() => props.onOpenTask(session.id)}
                      >
                        <span className={`lifecycle-badge lifecycle-${session.status}`}>{systemStatusLabel(session, props.t)}</span>
                        <strong>{session.title}</strong>
                        <p>{session.goal}</p>
                        <footer><span>{session.labelIds.slice(0, 2).map((id) => props.labels.find((label) => label.id === id)?.name).filter(Boolean).join(" · ") || props.t("task")}</span>{session.flagged ? <Icon name="flag" size={14} /> : null}</footer>
                      </Button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="task-table">
            {visible.map((session) => (
              <Button variant="ghost" className="task-table-row" key={session.id} onClick={() => props.onOpenTask(session.id)}>
                <span className="task-state-dot" />
                <span className="task-table-copy"><strong>{session.title}</strong><small>{session.goal}</small></span>
                <span className={`lifecycle-badge lifecycle-${session.status}`}>{systemStatusLabel(session, props.t)}</span>
                <span>{props.statuses.find(({ id }) => id === session.statusId)?.name ?? props.t("uncategorized")}</span>
                <time>{new Date(session.updatedAt).toLocaleDateString()}</time>
              </Button>
            ))}
          </div>
        )}
      </div>
      <WorkflowManager open={manageOpen} workspaceId={props.workspace.id} statuses={props.statuses} labels={props.labels} t={props.t} onOpenChange={setManageOpen} onRefresh={props.onRefresh} />
    </section>
  );
}

function WorkflowManager(props: {
  open: boolean;
  workspaceId: string;
  statuses: StatusDefinition[];
  labels: Label[];
  t: T;
  onOpenChange(open: boolean): void;
  onRefresh(): Promise<void>;
}) {
  const [tab, setTab] = useState<"statuses" | "labels">("statuses");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8a8275");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; kind: "status" | "label" } | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      if (tab === "statuses") return window.piWork.status.create({ workspaceId: props.workspaceId, value: { name, color, position: props.statuses.length } });
      return window.piWork.label.create({ workspaceId: props.workspaceId, value: { name, color, parentId: null } });
    },
    onSuccess: async () => {
      setName("");
      await props.onRefresh();
    },
  });
  async function updateName(kind: "status" | "label", id: string, nextName: string) {
    if (!nextName.trim()) return;
    if (kind === "status") await window.piWork.status.update({ id, value: { name: nextName.trim() } });
    else await window.piWork.label.update({ id, value: { name: nextName.trim() } });
    await props.onRefresh();
  }
  async function remove() {
    if (removeTarget === null) return;
    if (removeTarget.kind === "status") await window.piWork.status.remove(removeTarget.id);
    else await window.piWork.label.remove(removeTarget.id);
    setRemoveTarget(null);
    await props.onRefresh();
  }
  const values = tab === "statuses" ? props.statuses : props.labels;
  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="workflow-dialog">
          <DialogHeader><DialogTitle>{props.t("manageWorkflow")}</DialogTitle><DialogDescription>{props.t("workflowDetail")}</DialogDescription></DialogHeader>
          <ToggleGroup type="single" value={tab} onValueChange={(value) => value && setTab(value as "statuses" | "labels")}><ToggleGroupItem value="statuses">{props.t("workStage")}</ToggleGroupItem><ToggleGroupItem value="labels">{props.t("labels")}</ToggleGroupItem></ToggleGroup>
          <div className="workflow-list">
            {values.map((value) => <WorkflowRow key={value.id} value={value} onSave={(nextName) => updateName(tab === "statuses" ? "status" : "label", value.id, nextName)} onDelete={() => setRemoveTarget({ id: value.id, name: value.name, kind: tab === "statuses" ? "status" : "label" })} t={props.t} />)}
          </div>
          <div className="workflow-create"><span className="color-preview" style={{ background: color }} /><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={props.t("name")} /><Input className="color-input" value={color} onChange={(event) => setColor(event.target.value)} aria-label={props.t("color")} /><Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}><Icon name="plus" />{props.t("add")}</Button></div>
          <DialogFooter><Button variant="ghost" onClick={() => props.onOpenChange(false)}>{props.t("close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.t("delete")}</AlertDialogTitle><AlertDialogDescription>{removeTarget?.name}{removeTarget?.kind === "status" ? ` · ${props.t("deleteStageDetail")}` : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function WorkflowRow(props: { value: StatusDefinition | Label; t: T; onSave(name: string): Promise<void>; onDelete(): void }) {
  const [name, setName] = useState(props.value.name);
  return <div className="workflow-row"><span className="color-preview" style={{ background: props.value.color }} /><Input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void props.onSave(name)} /><Button variant="ghost" size="icon" aria-label={props.t("delete")} onClick={props.onDelete}><Icon name="trash" /></Button></div>;
}

export function SourcesPage({ workspaceId, t }: { workspaceId: string; t: T }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["sources", workspaceId], queryFn: () => window.piWork.source.list(workspaceId) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sources = (query.data ?? []).filter((source) => !isMcpSource(source));
  const selected = sources.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sources", workspaceId] });
  const create = useMutation({ mutationFn: () => window.piWork.source.create({ workspaceId, value: { name: t("newSource"), type: "local", enabled: false, config: {} } }), onSuccess: async (source) => { await refresh(); setSelectedId(source.id); } });
  return (
    <LibraryLayout
      title={t("sources")}
      t={t}
      detail={t("sourcesDetail")}
      icon="source"
      items={sources}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noItems")}
      addLabel={t("add")}
      onAdd={() => create.mutate()}
      onSelect={setSelectedId}
      renderItem={(source) => <><strong>{source.name}</strong><small>{sourceTypeLabel(source.type, t)}</small><Badge>{source.enabled ? t("enabled") : t("disabled")}</Badge></>}
      detailPane={selected ? <SourceEditor source={selected} allowedTypes={regularSourceTypes} t={t} onSaved={refresh} onDeleted={async () => { setSelectedId(null); await refresh(); }} /> : null}
    />
  );
}

export function McpSettingsPage({ t }: { t: T }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["mcp-sources"],
    queryFn: () => window.piWork.mcp.list(),
  });
  const sources = (query.data ?? []).filter(isMcpSource);
  const selected = sources.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mcp-sources"] });
  useEffect(() => {
    if (selectedId !== null && sources.some(({ id }) => id === selectedId)) return;
    setSelectedId(sources[0]?.id ?? null);
  }, [selectedId, sources]);
  const create = useMutation({
    mutationFn: (preset: McpPreset) => {
      const type = preset === "stdio" ? "mcp_stdio" : "mcp_http";
      const config = preset === "stdio"
        ? { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], env: {} }
        : { url: "", transport: preset, headers: {}, auth: "none" };
      const name = preset === "stdio"
        ? t("newMcpLocal")
        : preset === "sse" ? t("newMcpSse") : t("newMcpRemote");
      return window.piWork.mcp.create({ name, type, enabled: false, config });
    },
    onSuccess: async (source) => {
      await refresh();
      setSelectedId(source.id);
    },
  });
  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={create.isPending}><Icon name="plus" />{t("addMcpServer")}<Icon name="chevron-down" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mcp-add-menu">
        <DropdownMenuItem onSelect={() => create.mutate("stdio")}>
          <Icon name="terminal" />
          <span><strong>{t("addMcpLocal")}</strong><small>{t("addMcpLocalDetail")}</small></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => create.mutate("streamable_http")}>
          <Icon name="browser" />
          <span><strong>{t("addMcpStreamable")}</strong><small>{t("addMcpStreamableDetail")}</small></span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => create.mutate("sse")}>
          <Icon name="radio" />
          <span><strong>{t("addMcpSse")}</strong><small>{t("addMcpSseDetail")}</small></span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <LibraryLayout
      className="settings-mcp-page"
      showHeader={false}
      title={t("mcp")}
      detail={t("mcpSettingsDetail")}
      t={t}
      icon="source"
      items={sources}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noMcpServers")}
      addLabel={t("add")}
      onSelect={setSelectedId}
      toolbar={<div className="settings-mcp-toolbar">
        <span className="settings-mcp-toolbar-detail">{t("mcpGlobalDetail")}</span>
        {addMenu}
        {query.isError || create.isError ? <div className="settings-mcp-error"><Icon name="alert" /><span>{query.error?.message ?? create.error?.message}</span>{query.isError ? <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>{t("retry")}</Button> : null}</div> : null}
      </div>}
      renderItem={(source) => <><strong>{source.name}</strong><span className="mcp-source-meta"><small>{mcpTransportLabel(source, t)}</small><span className={source.enabled ? "mcp-status enabled" : "mcp-status"}>{source.enabled ? t("enabled") : t("disabled")}</span></span></>}
      detailPane={selected
        ? <McpSourceEditor source={selected} t={t} onSaved={refresh} onDeleted={async () => { setSelectedId(null); await refresh(); }} />
        : sources.length === 0
          ? <div className="mcp-empty-state"><span className="mcp-empty-icon"><Icon name="source" /></span><h2>{t("mcpEmptyTitle")}</h2><p>{t("mcpEmptyDetail")}</p>{addMenu}</div>
          : null}
    />
  );
}

function mcpTransport(source: Source): McpTransport {
  if (source.type === "mcp_stdio") return "stdio";
  const transport = source.config.transport;
  return transport === "sse" ? "sse" : "streamable_http";
}

function mcpTransportLabel(source: Source, t: T): string {
  const transport = mcpTransport(source);
  if (transport === "stdio") return t("mcpTransportStdio");
  if (transport === "sse") return t("mcpTransportSse");
  return t("mcpTransportStreamable");
}

function jsonRecord(value: string, label: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
}

function jsonArguments(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Arguments must be a JSON string array.");
  }
  return parsed;
}

function McpSourceEditor({ source, t, onSaved, onDeleted }: {
  source: Source;
  t: T;
  onSaved(): Promise<unknown>;
  onDeleted(): Promise<void>;
}) {
  const queryClient = useQueryClient();
  const initialTransport = mcpTransport(source);
  const [name, setName] = useState(source.name);
  const [enabled, setEnabled] = useState(source.enabled);
  const [transport, setTransport] = useState<McpTransport>(initialTransport);
  const [command, setCommand] = useState(String(source.config.command ?? ""));
  const [args, setArgs] = useState(JSON.stringify(source.config.args ?? [], null, 2));
  const [cwd, setCwd] = useState(String(source.config.cwd ?? ""));
  const [env, setEnv] = useState(JSON.stringify(source.config.env ?? {}, null, 2));
  const [url, setUrl] = useState(String(source.config.url ?? ""));
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth">(
    source.config.auth === "bearer" || source.config.auth === "oauth" ? source.config.auth : "none",
  );
  const [bearerToken, setBearerToken] = useState(String(source.config.bearerToken ?? ""));
  const [headers, setHeaders] = useState(JSON.stringify(source.config.headers ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<McpInspectResult | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolArguments, setToolArguments] = useState("{}");
  const [toolResult, setToolResult] = useState("");
  const [saved, setSaved] = useState(false);
  const savedOAuthConfigurationMatches = source.type === "mcp_http"
    && source.config.auth === "oauth"
    && mcpTransport(source) === transport
    && source.config.url === url.trim();
  const authorizationStatus = useQuery({
    queryKey: ["mcp-authorization", source.id],
    queryFn: () => window.piWork.mcp.authorizationStatus(source.id),
    enabled: source.type === "mcp_http" && source.config.auth === "oauth",
    retry: false,
  });

  useEffect(() => {
    const nextTransport = mcpTransport(source);
    setName(source.name);
    setEnabled(source.enabled);
    setTransport(nextTransport);
    setCommand(String(source.config.command ?? ""));
    setArgs(JSON.stringify(source.config.args ?? [], null, 2));
    setCwd(String(source.config.cwd ?? ""));
    setEnv(JSON.stringify(source.config.env ?? {}, null, 2));
    setUrl(String(source.config.url ?? ""));
    setAuth(source.config.auth === "bearer" || source.config.auth === "oauth" ? source.config.auth : "none");
    setBearerToken(String(source.config.bearerToken ?? ""));
    setHeaders(JSON.stringify(source.config.headers ?? {}, null, 2));
    setInspectResult(null);
    setToolName("");
    setToolArguments("{}");
    setToolResult("");
    setSaved(false);
  }, [source.id]);

  function markChanged() {
    setSaved(false);
    setInspectResult(null);
  }

  async function persistSource() {
    const config = transport === "stdio"
      ? {
          command: command.trim(),
          args: jsonArguments(args),
          env: jsonRecord(env, t("mcpEnvironment")),
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        }
      : {
          url: url.trim(),
          transport,
          headers: jsonRecord(headers, t("mcpHeaders")),
          auth,
          ...(auth === "bearer" ? { bearerToken } : {}),
        };
    return window.piWork.mcp.update({
      id: source.id,
      value: {
        name: name.trim(),
        type: transport === "stdio" ? "mcp_stdio" : "mcp_http",
        config,
        enabled,
      },
    });
  }

  const save = useMutation({
    mutationFn: persistSource,
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await onSaved();
      if (transport !== "stdio" && auth === "oauth") await authorizationStatus.refetch();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const inspect = useMutation({
    mutationFn: async () => {
      await persistSource();
      return window.piWork.mcp.inspect(source.id);
    },
    onSuccess: async (result) => {
      setError(null);
      setSaved(true);
      setInspectResult(result);
      setToolName(result.tools[0]?.name ?? "");
      await onSaved();
      if (transport !== "stdio" && auth === "oauth") await authorizationStatus.refetch();
    },
    onError: async (cause: Error) => {
      setError(cause.message);
      if (transport !== "stdio" && auth === "oauth") await authorizationStatus.refetch();
    },
  });
  const authorize = useMutation({
    mutationFn: async () => {
      await persistSource();
      const status = await window.piWork.mcp.authorize(source.id);
      const result = await window.piWork.mcp.inspect(source.id);
      return { status, result };
    },
    onSuccess: async ({ status, result }) => {
      setError(null);
      setSaved(true);
      setInspectResult(result);
      setToolName(result.tools[0]?.name ?? "");
      queryClient.setQueryData(["mcp-authorization", source.id], status);
      await onSaved();
    },
    onError: async (cause: Error) => {
      setError(cause.message);
      await authorizationStatus.refetch();
    },
  });
  const callTool = useMutation({
    mutationFn: async () => {
      let input: Record<string, unknown>;
      try { input = JSON.parse(toolArguments) as Record<string, unknown>; } catch { throw new Error(t("invalidJson")); }
      return window.piWork.mcp.callTool({ sourceId: source.id, toolName, arguments: input });
    },
    onSuccess: (result) => { setError(null); setToolResult(JSON.stringify(result, null, 2)); },
    onError: (cause: Error) => setError(cause.message),
  });
  const busy = save.isPending || inspect.isPending || authorize.isPending;
  const change = <Value,>(setter: (value: Value) => void) => (value: Value) => { setter(value); markChanged(); };
  const oauthAuthorized = savedOAuthConfigurationMatches && authorizationStatus.data?.authorized === true;
  const oauthStatusLabel = !savedOAuthConfigurationMatches
    ? t("mcpAuthorizationSaveFirst")
    : authorizationStatus.isFetching
      ? t("mcpAuthorizationChecking")
      : oauthAuthorized
        ? t("mcpAuthorized")
        : t("mcpNotAuthorized");

  return <ResourceEditor
    title={name || source.name}
    status={`${transport === "stdio" ? t("mcpTransportStdio") : transport === "sse" ? t("mcpTransportSse") : t("mcpTransportStreamable")} · ${enabled ? t("enabled") : t("disabled")}`}
    t={t}
    onDelete={() => void window.piWork.mcp.remove(source.id).then(onDeleted)}
  >
    <FieldGroup className="mcp-editor-fields mcp-editor-compact">
      <div className="mcp-editor-summary">
        <Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => change(setName)(event.target.value)} /></Field>
        <Field><FieldLabel>{t("mcpTransport")}</FieldLabel><Select value={transport} onValueChange={(value) => change(setTransport)(value as McpTransport)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="stdio">{t("mcpTransportStdio")}</SelectItem>
            <SelectItem value="streamable_http">{t("mcpTransportStreamable")}</SelectItem>
            <SelectItem value="sse">{t("mcpTransportSse")}</SelectItem>
          </SelectGroup></SelectContent>
        </Select></Field>
        <Field className="mcp-enabled-inline">
          <span><FieldLabel>{t("enabled")}</FieldLabel><small>{t("mcpGlobalAvailability")}</small></span>
          <Switch checked={enabled} onCheckedChange={change(setEnabled)} />
        </Field>
      </div>

      <section className="mcp-config-card">
        <header><div><strong>{t("mcpConnection")}</strong><small>{transport === "stdio" ? t("mcpStdioDetail") : transport === "sse" ? t("mcpSseDetail") : t("mcpStreamableDetail")}</small></div><span className="mcp-transport-chip">{transport === "stdio" ? "stdio" : transport === "sse" ? "SSE" : "HTTP"}</span></header>
        {transport === "stdio" ? <div className="mcp-config-grid">
          <Field><FieldLabel>{t("mcpCommand")}</FieldLabel><Input value={command} onChange={(event) => change(setCommand)(event.target.value)} placeholder="npx" /></Field>
          <Field><FieldLabel>{t("mcpWorkingDirectory")}</FieldLabel><Input value={cwd} onChange={(event) => change(setCwd)(event.target.value)} placeholder={t("mcpOptional")} /></Field>
          <Field><FieldLabel>{t("mcpArguments")}</FieldLabel><Textarea className="code-textarea" rows={4} value={args} onChange={(event) => change(setArgs)(event.target.value)} spellCheck={false} /></Field>
          <Field><FieldLabel>{t("mcpEnvironment")}</FieldLabel><Textarea className="code-textarea" rows={4} value={env} onChange={(event) => change(setEnv)(event.target.value)} spellCheck={false} /></Field>
        </div> : <div className="mcp-config-grid">
          <Field className="mcp-field-wide"><FieldLabel>{t("mcpEndpoint")}</FieldLabel><Input value={url} onChange={(event) => change(setUrl)(event.target.value)} placeholder="https://example.com/mcp" /></Field>
          <Field className="mcp-auth-field mcp-field-wide"><FieldLabel>{t("mcpAuthentication")}</FieldLabel><div className={`mcp-auth-controls${auth === "oauth" ? " has-feedback" : ""}${auth === "bearer" ? " has-token" : ""}`}>
            <Select value={auth} onValueChange={(value) => change(setAuth)(value as typeof auth)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="none">{t("mcpAuthNone")}</SelectItem>
                <SelectItem value="bearer">{t("mcpAuthBearer")}</SelectItem>
                <SelectItem value="oauth">{t("mcpAuthOAuth")}</SelectItem>
              </SelectGroup></SelectContent>
            </Select>{auth === "bearer" ? <Input type="password" value={bearerToken} onChange={(event) => change(setBearerToken)(event.target.value)} aria-label={t("mcpBearerToken")} placeholder={t("mcpBearerToken")} /> : null}{auth === "oauth" ? <div className={oauthAuthorized ? "mcp-auth-feedback authorized" : "mcp-auth-feedback"}>
              <span className="mcp-auth-state"><Icon name={oauthAuthorized ? "check-circle" : "alert"} />{oauthStatusLabel}</span>
              <Button variant="ghost" size="sm" className="mcp-auth-action" disabled={busy || !name.trim()} onClick={() => authorize.mutate()}>{authorize.isPending ? t("mcpAuthorizing") : oauthAuthorized ? t("mcpReauthorize") : t("mcpAuthorize")}</Button>
            </div> : null}</div></Field>
          <Field className={auth === "none" ? undefined : "mcp-field-wide"}><FieldLabel>{t("mcpHeaders")}</FieldLabel><Textarea className="code-textarea" rows={4} value={headers} onChange={(event) => change(setHeaders)(event.target.value)} spellCheck={false} /></Field>
        </div>}
      </section>

      {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="resource-editor-actions mcp-action-bar">
        <Button disabled={busy || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button>
        <Button variant="outline" disabled={busy || !name.trim()} onClick={() => inspect.mutate()}>{inspect.isPending ? t("mcpConnecting") : t("mcpSaveConnect")}</Button>
        {saved && !busy ? <span className="mcp-save-state"><Icon name="check" />{t("saved")}</span> : null}
      </div>

      <section className="mcp-debug-section">
        <div className="mcp-debug-heading"><div><strong>{t("mcpTestConnection")}</strong><small>{t("mcpTestConnectionDetail")}</small></div>{inspectResult ? <span className="mcp-connection-ok"><Icon name="check-circle" />{t("mcpConnected")}</span> : null}</div>
        {!inspectResult ? <div className="mcp-test-empty"><Icon name="terminal" /><span>{t("mcpNoInspection")}</span></div> : <div className="mcp-debug-panel">
          <header><strong>{inspectResult.serverName ?? source.name}</strong><span>{inspectResult.serverVersion}</span><span>{inspectResult.transport}</span><span>{inspectResult.tools.length} {t("mcpTools")}</span><span>{inspectResult.resourceCount} {t("mcpResources")}</span><span>{inspectResult.promptCount} {t("mcpPrompts")}</span></header>
          {inspectResult.instructions ? <p>{inspectResult.instructions}</p> : null}
          <div className="mcp-tool-grid">
            <Field><FieldLabel>{t("mcpTool")}</FieldLabel><Select value={toolName} onValueChange={setToolName}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{inspectResult.tools.map((tool) => <SelectItem key={tool.name} value={tool.name}>{tool.title ?? tool.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel>{t("mcpArguments")}</FieldLabel><Textarea className="code-textarea" rows={3} value={toolArguments} onChange={(event) => setToolArguments(event.target.value)} spellCheck={false} /></Field>
          </div>
          <Button variant="outline" disabled={!toolName || callTool.isPending} onClick={() => callTool.mutate()}><Icon name="play" />{callTool.isPending ? t("mcpRunning") : t("mcpRunTool")}</Button>
          {toolResult ? <Field><FieldLabel>{t("mcpResult")}</FieldLabel><Textarea className="code-textarea" readOnly rows={6} value={toolResult} /></Field> : null}
          {inspectResult.logs.length > 0 ? <div className="mcp-log"><span>{t("mcpLogs")}</span><pre>{inspectResult.logs.join("\n")}</pre></div> : null}
        </div>}
      </section>
    </FieldGroup>
  </ResourceEditor>;
}

function SourceEditor({ source, allowedTypes, t, onSaved, onDeleted }: { source: Source; allowedTypes: Source["type"][]; t: T; onSaved(): Promise<unknown>; onDeleted(): Promise<void> }) {
  const [name, setName] = useState(source.name);
  const [type, setType] = useState<Source["type"]>(source.type);
  const [enabled, setEnabled] = useState(source.enabled);
  const [config, setConfig] = useState(JSON.stringify(source.config, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<McpInspectResult | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolArguments, setToolArguments] = useState("{}");
  const [toolResult, setToolResult] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setName(source.name);
    setType(source.type);
    setEnabled(source.enabled);
    setConfig(JSON.stringify(source.config, null, 2));
    setInspectResult(null);
    setToolName("");
    setToolArguments("{}");
    setToolResult("");
    setSaved(false);
  }, [source.id]);
  async function persistSource() {
    let value: Record<string, unknown>;
    try { value = JSON.parse(config) as Record<string, unknown>; } catch { throw new Error(t("invalidJson")); }
    return window.piWork.source.update({ id: source.id, value: { name: name.trim(), type, config: value, enabled } });
  }
  const save = useMutation({
    mutationFn: persistSource,
    onSuccess: async () => { setError(null); setSaved(true); await onSaved(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const inspect = useMutation({
    mutationFn: async () => {
      await persistSource();
      return window.piWork.mcp.inspect(source.id);
    },
    onSuccess: async (result) => { setError(null); setSaved(true); setInspectResult(result); setToolName(result.tools[0]?.name ?? ""); await onSaved(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const authorize = useMutation({
    mutationFn: async () => {
      await persistSource();
      await window.piWork.mcp.authorize(source.id);
      return window.piWork.mcp.inspect(source.id);
    },
    onSuccess: async (result) => { setError(null); setSaved(true); setInspectResult(result); setToolName(result.tools[0]?.name ?? ""); await onSaved(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const callTool = useMutation({
    mutationFn: async () => {
      let args: Record<string, unknown>;
      try { args = JSON.parse(toolArguments) as Record<string, unknown>; } catch { throw new Error(t("invalidJson")); }
      return window.piWork.mcp.callTool({ sourceId: source.id, toolName, arguments: args });
    },
    onSuccess: (result) => { setError(null); setToolResult(JSON.stringify(result, null, 2)); },
    onError: (cause: Error) => setError(cause.message),
  });
  const isMcp = type === "mcp_stdio" || type === "mcp_http";
  const isOAuthMcp = type === "mcp_http" && (() => {
    try {
      const value = JSON.parse(config) as Record<string, unknown>;
      return value.auth === "oauth";
    } catch {
      return false;
    }
  })();
  const busy = save.isPending || inspect.isPending || authorize.isPending;
  return <ResourceEditor title={name || source.name} status={enabled ? t("enabled") : t("disabled")} t={t} onDelete={() => void window.piWork.source.remove(source.id).then(onDeleted)}>
    <FieldGroup className={isMcp ? "mcp-editor-fields" : undefined}>
      {isMcp ? <div className="mcp-section-heading"><span>{t("mcpBasicInfo")}</span></div> : null}
      <div className={isMcp ? "mcp-basic-grid" : undefined}>
        <Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></Field>
        <Field><FieldLabel>{t("sourceType")}</FieldLabel><Select value={type} onValueChange={(value) => {
        const next = value as Source["type"];
        setType(next);
        setSaved(false);
        if (next === "mcp_stdio") setConfig(JSON.stringify({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], env: {} }, null, 2));
        if (next === "mcp_http") setConfig(JSON.stringify({ url: "", transport: "auto", headers: {}, auth: "none" }, null, 2));
      }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{allowedTypes.map((value) => <SelectItem key={value} value={value}>{sourceTypeLabel(value, t)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </div>
      {isMcp ? <div className="mcp-section-heading"><span>{t("mcpAvailability")}</span></div> : null}
      <Field className="mcp-enabled-field"><div><FieldLabel>{t("enabled")}</FieldLabel><small>{t(isMcp ? "mcpEnabledDetail" : "sourceEnabledDetail")}</small></div><Switch checked={enabled} onCheckedChange={(value) => { setEnabled(value); setSaved(false); }} /></Field>
      {isMcp ? <div className="mcp-section-heading"><span>{t("mcpConnection")}</span><small>{t("mcpConfigurationDetail")}</small></div> : null}
      <Field><FieldLabel>{t("configuration")}</FieldLabel><Textarea className="code-textarea mcp-config-editor" value={config} onChange={(event) => { setConfig(event.target.value); setSaved(false); }} rows={isMcp ? 9 : 12} spellCheck={false} /></Field>
      {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="resource-editor-actions">
        <Button disabled={busy || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button>
        {isMcp ? <Button variant="outline" disabled={busy || !name.trim()} onClick={() => inspect.mutate()}>{inspect.isPending ? t("mcpConnecting") : t("mcpSaveConnect")}</Button> : null}
        {isOAuthMcp ? <Button variant="ghost" disabled={busy || !name.trim()} onClick={() => authorize.mutate()}>{authorize.isPending ? t("mcpAuthorizing") : t("mcpAuthorize")}</Button> : null}
        {saved && !busy ? <span className="mcp-save-state"><Icon name="check" />{t("saved")}</span> : null}
      </div>
      {isMcp ? <div className="mcp-section-heading mcp-test-heading"><span>{t("mcpTestConnection")}</span><small>{t("mcpTestConnectionDetail")}</small></div> : null}
      {isMcp && !inspectResult ? <div className="mcp-test-empty"><Icon name="terminal" /><span>{t("mcpNoInspection")}</span></div> : null}
      {inspectResult ? <section className="mcp-debug-panel">
        <header><span className="mcp-connection-ok"><Icon name="check-circle" />{t("mcpConnected")}</span><strong>{inspectResult.serverName ?? source.name}</strong><span>{inspectResult.transport}</span><span>{inspectResult.tools.length} {t("mcpTools")}</span></header>
        {inspectResult.instructions ? <p>{inspectResult.instructions}</p> : null}
        <div className="mcp-tool-grid">
          <Field><FieldLabel>{t("mcpTool")}</FieldLabel><Select value={toolName} onValueChange={setToolName}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{inspectResult.tools.map((tool) => <SelectItem key={tool.name} value={tool.name}>{tool.title ?? tool.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>{t("mcpArguments")}</FieldLabel><Textarea className="code-textarea" rows={4} value={toolArguments} onChange={(event) => setToolArguments(event.target.value)} spellCheck={false} /></Field>
        </div>
        <Button variant="outline" disabled={!toolName || callTool.isPending} onClick={() => callTool.mutate()}><Icon name="play" />{callTool.isPending ? t("mcpRunning") : t("mcpRunTool")}</Button>
        {toolResult ? <Field><FieldLabel>{t("mcpResult")}</FieldLabel><Textarea className="code-textarea" readOnly rows={7} value={toolResult} /></Field> : null}
        {inspectResult.logs.length > 0 ? <div className="mcp-log"><span>{t("mcpLogs")}</span><pre>{inspectResult.logs.join("\n")}</pre></div> : null}
      </section> : null}
    </FieldGroup>
  </ResourceEditor>;
}

export function SkillsPage({ embedded = false, t }: { embedded?: boolean; t: T }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["skills"], queryFn: () => window.piWork.skill.list() });
  const systemSkills = useQuery({
    queryKey: ["system-skills"],
    queryFn: () => window.piWork.skill.scanSystem(),
    enabled: false,
  });
  const filtered = (query.data ?? []).filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selected = query.data?.find(({ id }) => id === selectedId) ?? null;
  useEffect(() => {
    const firstSkill = query.data?.[0];
    if (selectedId !== null || firstSkill === undefined) return;
    setSelectedId(firstSkill.id);
  }, [query.data, selectedId]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["skills"] });
  const create = useMutation({
    mutationFn: () => window.piWork.skill.create({
      name: nextSkillName(query.data ?? []),
      description: t("newSkillDescription"),
      instructions: "# Instructions\n",
      enabled: true,
    }),
    onSuccess: async (skill) => { setError(null); await refresh(); setSelectedId(skill.id); },
    onError: (cause: Error) => setError(cause.message),
  });
  const importSkill = useMutation({
    mutationFn: async () => {
      const path = await window.piWork.skill.chooseImport();
      if (path === null) return null;
      return window.piWork.skill.import(path);
    },
    onSuccess: async (skill) => {
      if (skill === null) return;
      setError(null);
      await refresh();
      setSelectedId(skill.id);
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const importSystemSkill = useMutation({
    mutationFn: (path: string) => window.piWork.skill.import(path),
    onSuccess: async (skill) => {
      setError(null);
      await refresh();
      await systemSkills.refetch();
      setSelectedId(skill.id);
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const actions = <div className="page-header-actions"><Button variant="outline" disabled={systemSkills.isFetching} onClick={() => void systemSkills.refetch()}><Icon name="search" />{t("scanSystemSkills")}</Button><Button variant="outline" disabled={importSkill.isPending} onClick={() => importSkill.mutate()}><Icon name="folder-plus" />{t("importSkill")}</Button><Button disabled={create.isPending} onClick={() => create.mutate()}><Icon name="plus" />{t("add")}</Button></div>;
  return (
    <LibraryLayout
      title={t("skills")}
      className={embedded ? "settings-skills-page" : undefined}
      showHeader={!embedded}
      toolbar={embedded ? <div className="settings-skills-toolbar">{actions}</div> : undefined}
      t={t}
      detail={t("skillRuntimeDetail")}
      icon="skills"
      itemIcon="workspace"
      items={filtered}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noItems")}
      addLabel={t("add")}
      action={actions}
      filter={<label className="library-search"><Icon name="search" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchSkills")} /></label>}
      listHeader={<div className="skill-folder-heading"><Icon name="workspace" size={14} /><span>{t("skillFolders")}</span></div>}
      onSelect={setSelectedId}
      renderItem={(skill) => <><span>{skill.name}</span><small>{skill.description}</small></>}
      detailPane={selected ? <SkillEditor skill={selected} t={t} onSaved={refresh} onDeleted={async () => { setSelectedId(null); await refresh(); }} /> : <SystemSkillsPanel skills={systemSkills.data} loading={systemSkills.isFetching} error={error ?? (systemSkills.error instanceof Error ? systemSkills.error.message : null)} importingPath={importSystemSkill.variables ?? null} t={t} onImport={(path) => importSystemSkill.mutate(path)} />}
    />
  );
}

function SystemSkillsPanel(props: {
  skills: SystemSkill[] | undefined;
  loading: boolean;
  error: string | null;
  importingPath: string | null;
  t: T;
  onImport(path: string): void;
}) {
  if (props.error) return <Alert className="form-error"><AlertDescription>{props.error}</AlertDescription></Alert>;
  if (props.skills === undefined) return <div className="resource-detail-empty"><Icon name="search" /><p>{props.t("scanSystemSkillsDetail")}</p></div>;
  if (props.loading) return <div className="page-loading"><span /><span /><span /></div>;
  if (props.skills.length === 0) return <div className="resource-detail-empty"><Icon name="skills" /><p>{props.t("noSystemSkills")}</p></div>;
  return <div className="resource-editor-body system-skills-panel">
    <Alert className="runtime-boundary"><AlertDescription>{props.t("scanSystemSkillsDetail")}</AlertDescription></Alert>
    <div className="system-skills-list">
      {props.skills.map((skill) => <div className="system-skill-row" key={skill.path}>
        <span className="resource-symbol"><Icon name="skills" /></span>
        <span className="system-skill-copy"><strong>{skill.name}</strong><small>{skill.description}</small><small>{systemSkillSourceLabel(skill.source, props.t)} · {skill.path}</small></span>
        <Button size="sm" disabled={skill.imported || props.importingPath === skill.path} onClick={() => props.onImport(skill.path)}>{skill.imported ? props.t("imported") : props.t("importSkill")}</Button>
      </div>)}
    </div>
  </div>;
}

function systemSkillSourceLabel(source: SystemSkill["source"], t: T): string {
  const labels: Record<SystemSkill["source"], MessageKey> = {
    pi: "systemSkillSourcePi",
    agents: "systemSkillSourceAgents",
    codex: "systemSkillSourceCodex",
    claude: "systemSkillSourceClaude",
  };
  return t(labels[source]);
}

function SkillEditor({ skill, t, onSaved, onDeleted }: { skill: Skill; t: T; onSaved(): Promise<unknown>; onDeleted(): Promise<void> }) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [enabled, setEnabled] = useState(skill.enabled);
  const [error, setError] = useState<string | null>(null);
  const files = useQuery({
    queryKey: ["skill-files", skill.id],
    queryFn: () => window.piWork.skill.listFiles(skill.id),
  });
  useEffect(() => { setName(skill.name); setDescription(skill.description); setInstructions(skill.instructions); setEnabled(skill.enabled); setError(null); }, [skill]);
  const save = useMutation({
    mutationFn: () => window.piWork.skill.update({ id: skill.id, value: { name, description, instructions, enabled } }),
    onSuccess: onSaved,
    onError: (cause: Error) => setError(cause.message),
  });
  const toggle = useMutation({
    mutationFn: (next: boolean) => window.piWork.skill.setEnabled(skill.id, next),
    onSuccess: async () => { setError(null); await onSaved(); },
    onError: (cause: Error) => { setEnabled(skill.enabled); setError(cause.message); },
  });
  const remove = useMutation({
    mutationFn: () => window.piWork.skill.remove(skill.id),
    onSuccess: onDeleted,
    onError: (cause: Error) => setError(cause.message),
  });
  return <ResourceEditor title={skill.name} status={t("skillRuntimeDetail")} t={t} onDelete={() => remove.mutate()}>
    <Alert className="runtime-boundary"><AlertDescription>{t("skillRuntimeDetail")}</AlertDescription></Alert>
    <SkillFolderTree entries={files.data} loading={files.isLoading} t={t} />
    <FieldGroup><Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>{t("description")}</FieldLabel><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field><Field><FieldLabel>{t("instructions")}</FieldLabel><Textarea className="markdown-editor" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={18} /></Field><Field><FieldLabel>{t("enabled")}</FieldLabel><Switch checked={enabled} disabled={toggle.isPending} onCheckedChange={(next) => { setEnabled(next); toggle.mutate(next); }} /></Field>{error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}<Button disabled={save.isPending || !name.trim() || !description.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button></FieldGroup>
  </ResourceEditor>;
}

function SkillFolderTree({ entries, loading, t }: { entries: SkillFolderEntry[] | undefined; loading: boolean; t: T }) {
  return (
    <details className="skill-folder-tree" open>
      <summary>
        <span><Icon name="workspace" size={14} />{t("skillFolderContents")}</span>
        <small>{loading ? t("loading") : `${entries?.length ?? 0} ${t("files")}`}</small>
      </summary>
      <div className="skill-folder-tree-list">
        {loading ? <div className="skill-folder-tree-loading">{t("loading")}</div> : null}
        {entries?.map((entry) => (
          <div className={`skill-folder-tree-row skill-folder-tree-row--${entry.type} skill-folder-tree-row--depth-${Math.min(entry.path.split("/").length - 1, 6)}`} key={entry.path}>
            <Icon name={entry.type === "directory" ? "workspace" : "file"} size={14} />
            <span>{entry.name}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function nextSkillName(skills: Skill[]): string {
  const names = new Set(skills.map(({ name }) => name));
  if (!names.has("untitled-skill")) return "untitled-skill";
  for (let suffix = 2; ; suffix++) {
    const candidate = `untitled-skill-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function AutomationsPage({ workspaceId, t }: { workspaceId: string; t: T }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["automations", workspaceId], queryFn: () => window.piWork.automation.list(workspaceId) });
  const statuses = useQuery({
    queryKey: ["statuses", workspaceId],
    queryFn: () => window.piWork.status.list(workspaceId),
  });
  const labels = useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: () => window.piWork.label.list(workspaceId),
  });
  const sessions = useQuery({
    queryKey: ["automation-sessions", workspaceId],
    queryFn: async () => {
      const values = await window.piWork.session.list();
      return values.filter((session) => session.workspaceId === workspaceId && session.kind === "task");
    },
  });
  const selected = query.data?.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["automations", workspaceId] });
  const create = useMutation({ mutationFn: () => window.piWork.automation.create({ workspaceId, value: { name: t("newAutomation"), enabled: false, trigger: { type: "schedule", cron: "0 9 * * 1-5" }, action: { type: "create_session", title: t("newTask"), prompt: t("newAutomation") }, lastRunAt: null } }), onSuccess: async (automation) => { await refresh(); setSelectedId(automation.id); } });
  return (
    <LibraryLayout
      title={t("automations")}
      t={t}
      detail={t("automationDetail")}
      icon="list-todo"
      items={query.data ?? []}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noItems")}
      addLabel={t("add")}
      onAdd={() => create.mutate()}
      onSelect={setSelectedId}
      renderItem={(automation) => <><strong>{automation.name}</strong><small>{automationTriggerSummary(automation, statuses.data ?? [], labels.data ?? [], t)}</small><Badge>{t("savedNotRunning")}</Badge></>}
      detailPane={selected ? (
        <AutomationEditor
          automation={selected}
          statuses={statuses.data ?? []}
          labels={labels.data ?? []}
          sessions={sessions.data ?? []}
          t={t}
          onSaved={refresh}
          onDeleted={async () => {
            setSelectedId(null);
            await refresh();
          }}
        />
      ) : null}
    />
  );
}

function AutomationEditor(props: {
  automation: Automation;
  statuses: StatusDefinition[];
  labels: Label[];
  sessions: Session[];
  t: T;
  onSaved(): Promise<unknown>;
  onDeleted(): Promise<void>;
}) {
  const { automation, t } = props;
  const [name, setName] = useState(automation.name);
  const [triggerType, setTriggerType] = useState<Automation["trigger"]["type"]>(automation.trigger.type);
  const [cron, setCron] = useState(automation.trigger.type === "schedule" ? automation.trigger.cron : "0 9 * * 1-5");
  const [statusId, setStatusId] = useState<string | null>(automation.trigger.type === "status_changed" ? automation.trigger.statusId : null);
  const [labelId, setLabelId] = useState(automation.trigger.type === "label_changed" ? automation.trigger.labelId : "");
  const [tool, setTool] = useState(automation.trigger.type === "tool_event" ? automation.trigger.tool : "");
  const [actionType, setActionType] = useState<Automation["action"]["type"]>(automation.action.type);
  const [title, setTitle] = useState(automation.action.type === "create_session" ? automation.action.title : automation.name);
  const [prompt, setPrompt] = useState(automation.action.type === "webhook" ? "" : automation.action.prompt);
  const [sessionId, setSessionId] = useState<string | null>(automation.action.type === "send_prompt" ? automation.action.sessionId : null);
  const [url, setUrl] = useState(automation.action.type === "webhook" ? automation.action.url : "");
  const [method, setMethod] = useState<"POST" | "PUT" | "PATCH">(automation.action.type === "webhook" ? automation.action.method : "POST");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(automation.name);
    setTriggerType(automation.trigger.type);
    if (automation.trigger.type === "schedule") setCron(automation.trigger.cron);
    if (automation.trigger.type === "status_changed") setStatusId(automation.trigger.statusId);
    if (automation.trigger.type === "label_changed") setLabelId(automation.trigger.labelId);
    if (automation.trigger.type === "tool_event") setTool(automation.trigger.tool);
    setActionType(automation.action.type);
    if (automation.action.type === "create_session") {
      setTitle(automation.action.title);
      setPrompt(automation.action.prompt);
    }
    if (automation.action.type === "send_prompt") {
      setSessionId(automation.action.sessionId);
      setPrompt(automation.action.prompt);
    }
    if (automation.action.type === "webhook") {
      setUrl(automation.action.url);
      setMethod(automation.action.method);
    }
    setError(null);
  }, [automation]);
  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      let trigger: Automation["trigger"];
      if (triggerType === "schedule") {
        if (!cron.trim()) throw new Error(t("validationRequired"));
        trigger = { type: "schedule", cron: cron.trim() };
      } else if (triggerType === "status_changed") {
        trigger = { type: "status_changed", statusId };
      } else if (triggerType === "label_changed") {
        if (!labelId) throw new Error(t("validationRequired"));
        trigger = { type: "label_changed", labelId };
      } else {
        if (!tool.trim()) throw new Error(t("validationRequired"));
        trigger = { type: "tool_event", tool: tool.trim() };
      }
      let action: Automation["action"];
      if (actionType === "create_session") {
        if (!prompt.trim()) throw new Error(t("validationRequired"));
        action = { type: "create_session", title: title.trim(), prompt: prompt.trim() };
      } else if (actionType === "send_prompt") {
        if (!prompt.trim()) throw new Error(t("validationRequired"));
        action = { type: "send_prompt", sessionId, prompt: prompt.trim() };
      } else {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error(t("invalidUrl"));
        }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(t("invalidUrl"));
        action = { type: "webhook", url: parsed.toString(), method };
      }
      return window.piWork.automation.update({
        id: automation.id,
        value: { name: name.trim(), enabled: false, trigger, action },
      });
    },
    onSuccess: props.onSaved,
    onError: (cause: Error) => setError(cause.message),
  });
  const missingLabel = labelId !== "" && !props.labels.some(({ id }) => id === labelId);
  const missingSession = sessionId !== null && !props.sessions.some(({ id }) => id === sessionId);
  return (
    <ResourceEditor title={automation.name} status={t("automationDetail")} t={t} onDelete={() => void window.piWork.automation.remove(automation.id).then(props.onDeleted)}>
      <Alert className="runtime-boundary"><AlertDescription>{t("automationDetail")}</AlertDescription></Alert>
      <FieldGroup>
        <Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field>
          <FieldLabel>{t("trigger")}</FieldLabel>
          <Select value={triggerType} onValueChange={(value) => setTriggerType(value as Automation["trigger"]["type"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="schedule">{t("schedule")}</SelectItem>
              <SelectItem value="status_changed">{t("statusChanged")}</SelectItem>
              <SelectItem value="label_changed">{t("labelChanged")}</SelectItem>
              <SelectItem value="tool_event">{t("toolEvent")}</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </Field>
        {triggerType === "schedule" ? <Field><FieldLabel>{t("cronExpression")}</FieldLabel><Input className="code-input" value={cron} onChange={(event) => setCron(event.target.value)} /></Field> : null}
        {triggerType === "status_changed" ? (
          <Field>
            <FieldLabel>{t("targetStage")}</FieldLabel>
            <Select value={statusId ?? "any"} onValueChange={(value) => setStatusId(value === "any" ? null : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="any">{t("anyStage")}</SelectItem>
                {props.statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        ) : null}
        {triggerType === "label_changed" ? (
          <Field>
            <FieldLabel>{t("targetLabel")}</FieldLabel>
            <Select value={labelId || "none"} onValueChange={(value) => setLabelId(value === "none" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {!labelId ? <SelectItem value="none">{t("chooseLabel")}</SelectItem> : null}
                {missingLabel ? <SelectItem value={labelId}>{t("unavailable")}</SelectItem> : null}
                {props.labels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        ) : null}
        {triggerType === "tool_event" ? <Field><FieldLabel>{t("toolName")}</FieldLabel><Input value={tool} onChange={(event) => setTool(event.target.value)} /></Field> : null}
        <Field>
          <FieldLabel>{t("action")}</FieldLabel>
          <Select value={actionType} onValueChange={(value) => setActionType(value as Automation["action"]["type"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="create_session">{t("createSession")}</SelectItem>
              <SelectItem value="send_prompt">{t("sendPrompt")}</SelectItem>
              <SelectItem value="webhook">{t("webhook")}</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </Field>
        {actionType === "create_session" ? <Field><FieldLabel>{t("taskTitle")}</FieldLabel><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field> : null}
        {actionType === "send_prompt" ? (
          <Field>
            <FieldLabel>{t("targetTask")}</FieldLabel>
            <Select value={sessionId ?? "new"} onValueChange={(value) => setSessionId(value === "new" ? null : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="new">{t("newConversation")}</SelectItem>
                {missingSession ? <SelectItem value={sessionId ?? "new"}>{t("unavailable")}</SelectItem> : null}
                {props.sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.title}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        ) : null}
        {actionType !== "webhook" ? <Field><FieldLabel>{t("prompt")}</FieldLabel><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} /></Field> : null}
        {actionType === "webhook" ? (
          <>
            <Field><FieldLabel>{t("webhookUrl")}</FieldLabel><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></Field>
            <Field>
              <FieldLabel>{t("httpMethod")}</FieldLabel>
              <Select value={method} onValueChange={(value) => setMethod(value as typeof method)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{["POST", "PUT", "PATCH"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
          </>
        ) : null}
        {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button>
      </FieldGroup>
    </ResourceEditor>
  );
}

function automationTriggerSummary(automation: Automation, statuses: StatusDefinition[], labels: Label[], t: T): string {
  if (automation.trigger.type === "schedule") return `${t("schedule")} · ${automation.trigger.cron}`;
  if (automation.trigger.type === "status_changed") {
    const targetStatusId = automation.trigger.statusId;
    const stage = statuses.find(({ id }) => id === targetStatusId)?.name ?? t("anyStage");
    return `${t("statusChanged")} · ${stage}`;
  }
  if (automation.trigger.type === "label_changed") {
    const targetLabelId = automation.trigger.labelId;
    const label = labels.find(({ id }) => id === targetLabelId)?.name ?? t("unavailable");
    return `${t("labelChanged")} · ${label}`;
  }
  return `${t("toolEvent")} · ${automation.trigger.tool}`;
}

function LibraryLayout<T extends { id: string }>(props: {
  title: string;
  detail: string;
  t: (key: MessageKey) => string;
  icon: IconName;
  className?: string | undefined;
  showHeader?: boolean;
  toolbar?: ReactNode | undefined;
  listHeader?: ReactNode | undefined;
  items: T[];
  itemIcon?: IconName | undefined;
  selectedId: string | null;
  loading: boolean;
  empty: string;
  addLabel: string;
  action?: ReactNode;
  filter?: ReactNode;
  onAdd?(): void;
  onSelect(id: string): void;
  renderItem(item: T): ReactNode;
  detailPane: ReactNode;
}) {
  return (
    <section className={`page library-page${props.className ? ` ${props.className}` : ""}`}>
      {props.showHeader !== false ? <PageHeader title={props.title} detail={props.detail} action={props.action ?? <Button onClick={props.onAdd}><Icon name="plus" />{props.addLabel}</Button>} /> : null}
      {props.toolbar}
      <div className={`library-layout ${props.detailPane ? "has-detail" : ""}`}>
        <div className="library-list-pane">
          {props.filter}
          {props.loading ? <div className="page-loading"><span /><span /><span /></div> : (
            <div className="library-list">
              {props.listHeader}
              {props.items.map((item) => <Button variant="ghost" className={props.selectedId === item.id ? "library-row selected" : "library-row"} key={item.id} onClick={() => props.onSelect(item.id)}><span className="resource-symbol"><Icon name={props.itemIcon ?? props.icon} /></span><span className="library-row-copy">{props.renderItem(item)}</span><Icon name="forward" size={14} /></Button>)}
              {props.items.length === 0 ? <p className="library-empty">{props.empty}</p> : null}
            </div>
          )}
        </div>
        {props.detailPane ? <aside className="resource-detail-pane">{props.detailPane}</aside> : <div className="resource-detail-empty"><Icon name={props.icon} /><p>{props.t("selectToView")}</p></div>}
      </div>
    </section>
  );
}

function ResourceEditor(props: { title: string; status: string; t: T; onDelete(): void; children: ReactNode }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <header className="resource-editor-header"><div><h2>{props.title}</h2><span>{props.status}</span></div><Button variant="ghost" size="icon" aria-label={props.t("delete")} onClick={() => setDeleteOpen(true)}><Icon name="trash" /></Button></header>
      <div className="resource-editor-body">{props.children}</div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.t("delete")}</AlertDialogTitle><AlertDialogDescription>{props.title}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("cancel")}</AlertDialogCancel><AlertDialogAction onClick={props.onDelete}>{props.t("delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function sourceTypeLabel(type: Source["type"], t: T): string {
  const keys: Record<Source["type"], MessageKey> = {
    local: "sourceLocal",
    mcp_stdio: "sourceMcpStdio",
    mcp_http: "sourceMcpHttp",
    openapi: "sourceOpenApi",
    google: "sourceGoogle",
    microsoft: "sourceMicrosoft",
    slack: "sourceSlack",
  };
  return t(keys[type]);
}

function systemStatusLabel(session: Session, t: T): string {
  if (session.running) return t("lifecycleRunning");
  const keys: Record<Session["status"], MessageKey> = {
    draft: "lifecycleDraft",
    planning: "lifecyclePlanning",
    awaiting_plan_approval: "lifecycleAwaitingPlan",
    running: "lifecycleRunning",
    awaiting_action_approval: "lifecycleAwaitingAction",
    reviewing: "lifecycleReviewing",
    completed: "lifecycleCompleted",
    failed: "lifecycleFailed",
    cancelled: "lifecycleCancelled",
  };
  return t(keys[session.status]);
}
