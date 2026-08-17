import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MarkdownMessage } from "@/components/markdown-message.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Automation,
  Board,
  BoardColumn,
  BoardSnapshot,
  Label,
  MarketplaceSkill,
  RemoteSkillPreview,
  Session,
  Skill,
  SkillFileContent,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js";
import { sessionsForBoard } from "@/board.js";
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

export function BoardPage(props: {
  sessions: Session[];
  snapshot: BoardSnapshot | undefined;
  boards: Board[];
  statuses: StatusDefinition[];
  labels: Label[];
  workspace: Workspace;
  t: T;
  onNewTask(): void;
  onOpenTask(taskId: string): void;
  onSelectBoard(boardId: string | undefined): void;
  onRefresh(): Promise<void>;
}) {
  const [mode, setMode] = useState<"board" | "list">("board");
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("all");
  const visible = sessionsForBoard(props.sessions, props.workspace.id).filter((session) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchesQuery = normalizedQuery === "" || `${session.title} ${session.goal}`.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && (lifecycle === "all" || session.status === lifecycle);
  });
  const columns = props.snapshot?.columns ?? [];
  const stateByTaskId = new Map((props.snapshot?.states ?? []).map((state) => [state.taskId, state]));
  async function moveSession(
    sessionId: string,
    columnId: string,
    position: { beforeTaskId?: string; afterTaskId?: string } = {},
  ) {
    const state = stateByTaskId.get(sessionId);
    if (state === undefined || props.snapshot === undefined) return;
    await window.piWork.board.moveCard({
      commandId: crypto.randomUUID(),
      workspaceId: props.workspace.id,
      boardId: props.snapshot.board.id,
      taskId: sessionId,
      toColumnId: columnId,
      beforeTaskId: position.beforeTaskId ?? null,
      afterTaskId: position.afterTaskId ?? null,
      expectedVersion: state.version,
    });
    await props.onRefresh();
  }
  return (
    <section className="page board-page">
      <PageHeader
        eyebrow={props.workspace.name}
        title={props.t("board")}
        detail={props.t("boardDetail")}
        action={<div className="page-header-actions">
          <Select value={props.snapshot?.board.id ?? ""} onValueChange={(value) => props.onSelectBoard(value)}>
            <SelectTrigger aria-label={props.t("board")}><SelectValue placeholder={props.t("board")} /></SelectTrigger>
            <SelectContent><SelectGroup>{props.boards.map((board) => <SelectItem key={board.id} value={board.id}>{board.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <ToggleGroup className="board-view-toggle" type="single" value={mode} onValueChange={(value) => value && setMode(value as "board" | "list")}><ToggleGroupItem value="board">{props.t("board")}</ToggleGroupItem><ToggleGroupItem value="list">{props.t("list")}</ToggleGroupItem></ToggleGroup>
          <Button variant="outline" onClick={() => setManageOpen(true)}><Icon name="sliders" />{props.t("manage")}</Button>
          <Button onClick={props.onNewTask}><Icon name="plus" size={14} />{props.t("newTask")}</Button>
        </div>}
      />
      <div className="board-toolbar">
        <div className="task-list-search"><Icon name="search" size={14} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={props.t("searchTasks")} /></div>
        <Select value={lifecycle} onValueChange={setLifecycle}>
          <SelectTrigger aria-label={props.t("status")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">{props.t("allStatuses")}</SelectItem>
            {["draft", "planning", "awaiting_plan_approval", "running", "awaiting_action_approval", "reviewing", "completed", "failed", "cancelled"].map((value) => (
              <SelectItem value={value} key={value}>{systemStatusLabel({ status: value as Session["status"], running: false }, props.t)}</SelectItem>
            ))}
          </SelectGroup></SelectContent>
        </Select>
        <span>{visible.length} {props.t("tasks")}</span>
      </div>
      <div className="page-body board-body">
        {visible.length === 0 ? (
          <div className="task-list-empty"><Icon name="search" /><h2>{props.t("noSearchResults")}</h2></div>
        ) : mode === "board" ? (
          <div className="kanban">
            {columns.map((column) => {
              const taskOrder = new Map(
                (props.snapshot?.states ?? [])
                  .filter((state) => state.columnId === column.id)
                  .map((state, index) => [state.taskId, index]),
              );
              const columnSessions = visible
                .filter((session) => stateByTaskId.get(session.id)?.columnId === column.id)
                .sort((left, right) => (taskOrder.get(left.id) ?? 0) - (taskOrder.get(right.id) ?? 0));
              return (
                <section
                  className="kanban-column"
                  key={column.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const sessionId = event.dataTransfer.getData("application/x-pi-work-session");
                    if (sessionId !== "") void moveSession(sessionId, column.id);
                  }}
                >
                  <header><span><i style={{ background: column.color }} /><strong>{column.name}</strong></span><small>{columnSessions.length}</small></header>
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
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const sessionId = event.dataTransfer.getData("application/x-pi-work-session");
                          if (sessionId === "" || sessionId === session.id) return;
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const after = event.clientY >= bounds.top + bounds.height / 2;
                          void moveSession(sessionId, column.id, after
                            ? { afterTaskId: session.id }
                            : { beforeTaskId: session.id });
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
      <WorkflowManager open={manageOpen} workspaceId={props.workspace.id} snapshot={props.snapshot} statuses={props.statuses} labels={props.labels} t={props.t} onOpenChange={setManageOpen} onRefresh={props.onRefresh} />
    </section>
  );
}

function WorkflowManager(props: {
  open: boolean;
  workspaceId: string;
  snapshot: BoardSnapshot | undefined;
  statuses: StatusDefinition[];
  labels: Label[];
  t: T;
  onOpenChange(open: boolean): void;
  onRefresh(): Promise<void>;
}) {
  const [tab, setTab] = useState<"statuses" | "labels" | "columns">("statuses");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8a8275");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; kind: "status" | "label" } | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      if (tab === "columns") {
        if (props.snapshot === undefined) throw new Error("Board is not ready.");
        return window.piWork.board.createColumn({
          workspaceId: props.workspaceId,
          boardId: props.snapshot.board.id,
          name,
          color,
          statusIds: [],
          dropStatusId: null,
        });
      }
      if (tab === "statuses") return window.piWork.status.create({ workspaceId: props.workspaceId, value: { name, color, position: props.statuses.length, category: "open" } });
      return window.piWork.label.create({ workspaceId: props.workspaceId, value: { name, color, parentId: null } });
    },
    onSuccess: async () => {
      setName("");
      await props.onRefresh();
    },
  });
  async function updateName(kind: "status" | "label", id: string, nextName: string) {
    if (!nextName.trim()) return;
    if (kind === "status") await window.piWork.status.update({ workspaceId: props.workspaceId, id, value: { name: nextName.trim() } });
    else await window.piWork.label.update({ workspaceId: props.workspaceId, id, value: { name: nextName.trim() } });
    await props.onRefresh();
  }
  async function remove() {
    if (removeTarget === null) return;
    if (removeTarget.kind === "status") await window.piWork.status.remove(removeTarget.id, props.workspaceId);
    else await window.piWork.label.remove(removeTarget.id, props.workspaceId);
    setRemoveTarget(null);
    await props.onRefresh();
  }
  const values = tab === "statuses" ? props.statuses : props.labels;
  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="workflow-dialog">
          <DialogHeader><DialogTitle>{props.t("manageWorkflow")}</DialogTitle><DialogDescription>{props.t("workflowDetail")}</DialogDescription></DialogHeader>
          <ToggleGroup className="workflow-tabs" type="single" value={tab} onValueChange={(value) => value && setTab(value as "statuses" | "labels" | "columns")}><ToggleGroupItem value="statuses">{props.t("workStage")}</ToggleGroupItem><ToggleGroupItem value="columns">{props.t("boardColumns")}</ToggleGroupItem><ToggleGroupItem value="labels">{props.t("labels")}</ToggleGroupItem></ToggleGroup>
          <div className="workflow-list">
            {tab === "columns"
              ? (props.snapshot?.columns ?? []).map((column) => (
                <BoardColumnRow
                  key={column.id}
                  column={column}
                  columns={props.snapshot?.columns ?? []}
                  statuses={props.statuses}
                  t={props.t}
                  onRefresh={props.onRefresh}
                />
              ))
              : values.map((value) => <WorkflowRow key={value.id} value={value} onSave={(nextName) => updateName(tab === "statuses" ? "status" : "label", value.id, nextName)} onDelete={() => setRemoveTarget({ id: value.id, name: value.name, kind: tab === "statuses" ? "status" : "label" })} t={props.t} />)}
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

function BoardColumnRow(props: {
  column: BoardColumn;
  columns: BoardColumn[];
  statuses: StatusDefinition[];
  t: T;
  onRefresh(): Promise<void>;
}) {
  const [name, setName] = useState(props.column.name);
  const update = async (value: Partial<Pick<BoardColumn, "name" | "dropStatusId" | "statusIds">>) => {
    await window.piWork.board.updateColumn({
      workspaceId: props.column.workspaceId,
      boardId: props.column.boardId,
      columnId: props.column.id,
      ...value,
    });
    await props.onRefresh();
  };
  const remove = async () => {
    const destination = props.columns.find(({ id }) => id !== props.column.id);
    if (destination === undefined) return;
    await window.piWork.board.removeColumn({
      workspaceId: props.column.workspaceId,
      boardId: props.column.boardId,
      columnId: props.column.id,
      migrateToColumnId: destination.id,
    });
    await props.onRefresh();
  };
  return (
    <div className="workflow-row">
      <span className="color-preview" style={{ background: props.column.color }} />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() !== "" && name.trim() !== props.column.name) void update({ name: name.trim() });
        }}
      />
      <Select
        value={props.column.dropStatusId ?? "__none"}
        onValueChange={(value) => void update({
          dropStatusId: value === "__none" ? null : value,
          statusIds: value === "__none" ? [] : [value],
        })}
      >
        <SelectTrigger aria-label={props.t("dropStatus")}><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="__none">{props.t("noStatusChange")}</SelectItem>
          {props.statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      <Button variant="ghost" size="icon" disabled={props.columns.length <= 1} aria-label={props.t("delete")} onClick={() => void remove()}><Icon name="trash" /></Button>
    </div>
  );
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
  const [urlInstallOpen, setUrlInstallOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const saveSelectedRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerSelectedSave = useCallback((save: () => Promise<boolean>) => {
    saveSelectedRef.current = save;
  }, []);
  const query = useQuery({ queryKey: ["skills"], queryFn: () => window.piWork.skill.list() });
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
  const selectSkill = (id: string) => {
    if (dirty && id !== selectedId) {
      setPendingSelection(id);
      return;
    }
    setSelectedId(id);
  };
  const onDialogInstalled = async (skills: Skill[]) => {
    setError(null);
    await refresh();
    if (skills[0]) setSelectedId(skills[0].id);
  };
  const installMenu = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button><Icon name="plus" />{t("installSkill")}<Icon name="chevron-down" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setMarketplaceOpen(true)}><Icon name="skills" />{t("browseMarketplace")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setUrlInstallOpen(true)}><Icon name="browser" />{t("installFromUrl")}</DropdownMenuItem>
      <DropdownMenuItem disabled={importSkill.isPending} onSelect={() => importSkill.mutate()}><Icon name="folder-plus" />{t("installFromFolder")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setScanOpen(true)}><Icon name="search" />{t("scanSystemSkills")}</DropdownMenuItem>
      <DropdownMenuItem disabled={create.isPending} onSelect={() => create.mutate()}><Icon name="square-pen" />{t("createBlankSkill")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
  const toolbar = <div className="settings-skills-toolbar">
    <span className="settings-skills-toolbar-detail">{t("skillRuntimeDetail")}</span>
    {installMenu}
    {error ? <div className="settings-mcp-error"><Icon name="alert" /><span>{error}</span></div> : null}
  </div>;
  return (
    <>
      <LibraryLayout
        title={t("skills")}
        className={`${embedded ? "settings-skills-page skill-manager-page" : "skill-manager-page"}${(query.data?.length ?? 0) === 0 ? " skills-empty" : ""}`}
        showHeader={!embedded}
        toolbar={toolbar}
        t={t}
        detail={t("skillRuntimeDetail")}
        icon="skills"
        itemIcon="skills"
        items={filtered}
        selectedId={selectedId}
        loading={query.isLoading}
        empty={t("noInstalledSkills")}
        addLabel={t("installSkill")}
        filter={<label className="library-search"><Icon name="search" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchInstalledSkills")} /></label>}
        listHeader={<div className="skill-folder-heading"><span>{t("installedSkills")}</span><small>{query.data?.length ?? 0}</small></div>}
        onSelect={selectSkill}
        renderItem={(skill) => <><span className="skill-list-title"><span>{skill.name}</span><i className={skill.enabled ? "is-enabled" : ""} /></span><small>{skillSourceLabel(skill, t)}</small></>}
        detailPane={selected ? <SkillEditor
          skill={selected}
          t={t}
          onDirtyChange={setDirty}
          registerSave={registerSelectedSave}
          onSaved={refresh}
          onDeleted={async () => { setSelectedId(null); await refresh(); }}
        /> : <SkillsOnboarding t={t} error={error} installMenu={installMenu} />}
      />
      <SkillMarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        installed={query.data ?? []}
        t={t}
        onInstalled={async (skills) => { await onDialogInstalled(skills); setMarketplaceOpen(false); }}
      />
      <SystemScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        t={t}
        onImported={async (skill) => { await onDialogInstalled([skill]); }}
      />
      <RemoteSkillDialog open={urlInstallOpen} t={t} onOpenChange={setUrlInstallOpen} onInstalled={async (skills) => {
        await onDialogInstalled(skills);
        setUrlInstallOpen(false);
      }} />
      <AlertDialog open={pendingSelection !== null} onOpenChange={(open) => { if (!open) setPendingSelection(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("unsavedSkillChanges")}</AlertDialogTitle><AlertDialogDescription>{t("unsavedSkillChangesDetail")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <Button variant="outline" onClick={() => { setDirty(false); setSelectedId(pendingSelection); setPendingSelection(null); }}>{t("discardChanges")}</Button>
            <AlertDialogAction onClick={() => void (async () => {
              if (await saveSelectedRef.current?.()) {
                setSelectedId(pendingSelection);
                setPendingSelection(null);
              }
            })()}>{t("save")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SkillMarketplaceDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  installed: Skill[];
  t: T;
  onInstalled(skills: Skill[]): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null);
  const [preview, setPreview] = useState<RemoteSkillPreview | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => () => {
    if (preview !== null) discardRemotePreview(preview.previewId);
  }, [preview]);
  const results = useQuery({
    queryKey: ["skill-marketplace", debounced],
    queryFn: () => window.piWork.skill.searchMarketplace({ provider: "skills.sh", query: debounced, limit: 30 }),
    enabled: props.open && debounced.length >= 2,
  });
  const resolve = useMutation({
    mutationFn: (skill: MarketplaceSkill) => window.piWork.skill.previewRemote({
      sourceUrl: skill.sourceUrl,
      provider: "skills.sh",
      skillId: skill.skillId,
    }),
    onMutate: (skill) => { setSelected(skill); setPreview(null); setError(null); },
    onSuccess: (value) => {
      setPreview(value);
      setSelectedSkills(value.skills.filter(({ duplicate }) => !duplicate).map(({ id }) => id));
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const install = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error("Preview the Skill before installing it.");
      return window.piWork.skill.installRemote({ previewId: preview.previewId, skillIds: selectedSkills });
    },
    onSuccess: props.onInstalled,
    onError: (cause: Error) => setError(cause.message),
  });
  const installedNames = new Set(props.installed.map(({ name }) => name));
  const setOpen = (open: boolean) => {
    if (!open) {
      if (preview !== null) discardRemotePreview(preview.previewId);
      setPreview(null);
      setSelected(null);
      setSelectedSkills([]);
      setQuery("");
      setDebounced("");
      setError(null);
    }
    props.onOpenChange(open);
  };
  return <Dialog open={props.open} onOpenChange={setOpen}>
    <DialogContent className="skill-marketplace-dialog">
      <DialogHeader><DialogTitle>{props.t("skillMarketplace")}</DialogTitle><DialogDescription>{props.t("skillMarketplaceDialogDetail")}</DialogDescription></DialogHeader>
      <div className="skill-marketplace-layout">
        <section className="skill-marketplace-results">
          <label className="library-search skill-marketplace-search"><Icon name="search" /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={props.t("searchSkillMarketplace")} /></label>
          <div className="skill-marketplace-list">
            {query.trim().length < 2 ? <div className="skill-marketplace-empty"><Icon name="search" /><strong>{props.t("findSkills")}</strong><p>{props.t("findSkillsDetail")}</p></div> : null}
            {results.isFetching ? <div className="page-loading"><span /><span /><span /></div> : null}
            {results.error instanceof Error ? <Alert className="form-error"><AlertDescription>{results.error.message}</AlertDescription></Alert> : null}
            {results.data?.map((skill) => {
              const isInstalled = skill.installed || installedNames.has(skill.skillId);
              return <Button key={skill.id} variant="ghost" className={selected?.id === skill.id ? "skill-marketplace-row selected" : "skill-marketplace-row"} onClick={() => resolve.mutate(skill)}>
                <span className="resource-symbol"><Icon name="skills" /></span>
                <span><strong>{skill.name}</strong><small>{skill.source}</small><small>{formatInstallCount(skill.installs)} {props.t("installs")}</small></span>
                {isInstalled ? <Badge>{props.t("installed")}</Badge> : <Icon name="forward" size={14} />}
              </Button>;
            })}
            {results.data?.length === 0 ? <p className="library-empty">{props.t("noMarketplaceResults")}</p> : null}
          </div>
        </section>
        <aside className="skill-marketplace-preview">
          {resolve.isPending ? <div className="page-loading"><span /><span /><span /></div> : null}
          {!resolve.isPending && preview === null && error === null ? <div className="resource-detail-empty"><Icon name="skills" /><p>{props.t("selectMarketplaceSkill")}</p></div> : null}
          {error ? <div className="skill-preview-error"><Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert>{selected ? <Button variant="outline" onClick={() => resolve.mutate(selected)}><Icon name="refresh" />{props.t("retry")}</Button> : null}</div> : null}
          {preview ? <RemoteSkillPreviewPanel preview={preview} selected={selectedSkills} installing={install.isPending} t={props.t} onSelected={setSelectedSkills} onInstall={() => install.mutate()} /> : null}
        </aside>
      </div>
    </DialogContent>
  </Dialog>;
}

function RemoteSkillDialog(props: { open: boolean; t: T; onOpenChange(open: boolean): void; onInstalled(skills: Skill[]): Promise<void> }) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [preview, setPreview] = useState<RemoteSkillPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: () => window.piWork.skill.previewRemote({ sourceUrl, provider: "url" }),
    onSuccess: (value) => {
      if (!props.open) {
        discardRemotePreview(value.previewId);
        return;
      }
      setError(null);
      setPreview(value);
      setSelected(value.skills.filter(({ duplicate }) => !duplicate).map(({ id }) => id));
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const install = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error("Preview the Skill before installing it.");
      return window.piWork.skill.installRemote({ previewId: preview.previewId, skillIds: selected });
    },
    onSuccess: async (skills) => {
      props.onOpenChange(false);
      setSourceUrl("");
      setPreview(null);
      await props.onInstalled(skills);
    },
    onError: (cause: Error) => setError(cause.message),
  });
  useEffect(() => () => {
    if (preview !== null) discardRemotePreview(preview.previewId);
  }, [preview]);
  const setOpen = (open: boolean) => {
    if (!open) {
      if (preview !== null) discardRemotePreview(preview.previewId);
      setPreview(null);
      setSelected([]);
      setError(null);
    }
    props.onOpenChange(open);
  };
  return <Dialog open={props.open} onOpenChange={setOpen}>
    <DialogContent className="skill-url-dialog">
      <DialogHeader><DialogTitle>{props.t("installFromUrl")}</DialogTitle><DialogDescription>{props.t("installFromUrlDetail")}</DialogDescription></DialogHeader>
      <Field><FieldLabel>{props.t("sourceUrl")}</FieldLabel><Input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setPreview(null); }} placeholder="https://www.skills.sh/…" /></Field>
      {error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {preview ? <RemoteSkillPreviewPanel preview={preview} selected={selected} installing={install.isPending} compact t={props.t} onSelected={setSelected} onInstall={() => install.mutate()} /> : null}
      {!preview ? <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{props.t("cancel")}</Button><Button disabled={!sourceUrl.trim() || resolve.isPending} onClick={() => resolve.mutate()}>{resolve.isPending ? props.t("loading") : props.t("previewSkill")}</Button></DialogFooter> : null}
    </DialogContent>
  </Dialog>;
}

function discardRemotePreview(previewId: string): void {
  void window.piWork.skill.cancelRemotePreview(previewId).catch(() => undefined);
}

function RemoteSkillPreviewPanel(props: {
  preview: RemoteSkillPreview;
  selected: string[];
  installing: boolean;
  compact?: boolean;
  t: T;
  onSelected(ids: string[]): void;
  onInstall(): void;
}) {
  return <div className={props.compact ? "remote-skill-preview is-compact" : "remote-skill-preview"}>
    <header><div><span>{props.preview.provider}</span><h2>{props.preview.skills.length === 1 ? props.preview.skills[0]?.name : props.t("skillsFound")}</h2><p>{props.preview.repositoryUrl ?? props.preview.sourceUrl}</p></div><Icon name="skills" /></header>
    <div className="remote-skill-candidates">
      {props.preview.skills.map((skill) => {
        const checked = props.selected.includes(skill.id);
        return <label className={skill.duplicate ? "remote-skill-candidate is-disabled" : "remote-skill-candidate"} key={skill.id}>
          <input type="checkbox" checked={checked} disabled={skill.duplicate} onChange={(event) => props.onSelected(event.target.checked ? [...props.selected, skill.id] : props.selected.filter((id) => id !== skill.id))} />
          <span><strong>{skill.name}</strong><small>{skill.description}</small><small>{skill.files} {props.t("files")} · {skill.path}</small></span>
          {skill.duplicate ? <Badge>{props.t("installed")}</Badge> : null}
        </label>;
      })}
    </div>
    <footer><span>{props.selected.length} {props.t("selected")}</span><Button disabled={props.selected.length === 0 || props.installing} onClick={props.onInstall}>{props.installing ? props.t("installing") : props.t("installSelectedSkills")}</Button></footer>
  </div>;
}

function SkillsOnboarding(props: { t: T; error: string | null; installMenu: ReactNode }) {
  const t = props.t;
  return <div className="mcp-empty-state">
    <span className="mcp-empty-icon"><Icon name="skills" /></span>
    <h2>{t("getStartedWithSkills")}</h2>
    <p>{t("getStartedWithSkillsDetail")}</p>
    {props.error ? <Alert className="form-error skills-onboarding-error"><AlertDescription>{props.error}</AlertDescription></Alert> : null}
    {props.installMenu}
  </div>;
}

function SystemScanDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  t: T;
  onImported(skill: Skill): Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const scan = useQuery({
    queryKey: ["system-skills"],
    queryFn: () => window.piWork.skill.scanSystem(),
    enabled: props.open,
  });
  const importSkill = useMutation({
    mutationFn: (path: string) => window.piWork.skill.import(path),
    onSuccess: async (skill) => {
      setError(null);
      await props.onImported(skill);
      await scan.refetch();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="skill-scan-dialog">
      <DialogHeader><DialogTitle>{props.t("scanSystemSkillsTitle")}</DialogTitle><DialogDescription>{props.t("scanSystemSkillsDetail")}</DialogDescription></DialogHeader>
      <SystemSkillsPanel
        skills={scan.data}
        loading={scan.isFetching}
        error={error ?? (scan.error instanceof Error ? scan.error.message : null)}
        importingPath={importSkill.variables ?? null}
        t={props.t}
        onImport={(path) => importSkill.mutate(path)}
      />
      <DialogFooter><Button variant="ghost" onClick={() => props.onOpenChange(false)}>{props.t("close")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
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
  if (props.loading || props.skills === undefined) return <div className="page-loading"><span /><span /><span /></div>;
  if (props.skills.length === 0) return <div className="resource-detail-empty"><Icon name="skills" /><p>{props.t("noSystemSkills")}</p></div>;
  return <div className="system-skills-panel">
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

function SkillEditor({ skill, t, onSaved, onDeleted, onDirtyChange, registerSave }: {
  skill: Skill;
  t: T;
  onSaved(): Promise<unknown>;
  onDeleted(): Promise<void>;
  onDirtyChange(dirty: boolean): void;
  registerSave(save: () => Promise<boolean>): void;
}) {
  const [tab, setTab] = useState<"overview" | "instructions" | "files">("overview");
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [instructionsView, setInstructionsView] = useState<"raw" | "preview">("raw");
  const [enabled, setEnabled] = useState(skill.enabled);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const files = useQuery({
    queryKey: ["skill-files", skill.id],
    queryFn: () => window.piWork.skill.listFiles(skill.id),
  });
  const dirty = name !== skill.name || description !== skill.description || instructions !== skill.instructions || enabled !== skill.enabled;
  useEffect(() => { setName(skill.name); setDescription(skill.description); setInstructions(skill.instructions); setEnabled(skill.enabled); setError(null); setTab("overview"); }, [skill]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const save = useMutation({
    mutationFn: () => window.piWork.skill.update({ id: skill.id, value: { name, description, instructions, enabled } }),
    onSuccess: onSaved,
    onError: (cause: Error) => setError(cause.message),
  });
  const remove = useMutation({
    mutationFn: () => window.piWork.skill.remove(skill.id),
    onSuccess: onDeleted,
    onError: (cause: Error) => setError(cause.message),
  });
  const saveCurrentRef = useRef<() => Promise<boolean>>(async () => false);
  saveCurrentRef.current = async (): Promise<boolean> => {
    try {
      await save.mutateAsync();
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    registerSave(() => saveCurrentRef.current());
  }, [registerSave]);
  return <>
    <header className="skill-editor-header">
      <div><span>{skillSourceLabel(skill, t)}</span><h2>{skill.name}</h2><small>{dirty ? t("unsaved") : t("saved")}</small></div>
      <div><label className="skill-enabled-control"><span>{t("enabled")}</span><Switch checked={enabled} disabled={save.isPending} onCheckedChange={setEnabled} /></label><Button variant="outline" size="icon" aria-label={t("delete")} onClick={() => setDeleteOpen(true)}><Icon name="trash" /></Button><Button size="sm" disabled={!dirty || save.isPending || !name.trim() || !description.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button></div>
    </header>
    <Tabs className="skill-editor-tabs" value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
      <TabsList><TabsTrigger value="overview">{t("overview")}</TabsTrigger><TabsTrigger value="instructions">{t("instructions")}</TabsTrigger><TabsTrigger value="files">{t("files")}</TabsTrigger></TabsList>
    </Tabs>
    <div className={`skill-editor-content skill-editor-content--${tab}`}>
      {tab === "overview" ? <FieldGroup><div className="skill-source-summary"><span>{t("source")}</span><strong>{skillSourceDetail(skill, t)}</strong></div><Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>{t("description")}</FieldLabel><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field>{error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}</FieldGroup> : null}
      {tab === "instructions" ? (
        <div className="skill-instructions-panel">
          <div className="skill-instructions-toolbar">
            <ToggleGroup type="single" value={instructionsView} onValueChange={(value) => value && setInstructionsView(value as "raw" | "preview")}>
              <ToggleGroupItem value="raw">{t("raw")}</ToggleGroupItem>
              <ToggleGroupItem value="preview">{t("preview")}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {instructionsView === "raw" ? (
            <Textarea aria-label={t("instructions")} className="markdown-editor skill-instructions-editor" value={instructions} onChange={(event) => setInstructions(event.target.value)} spellCheck={false} />
          ) : (
            <div className="skill-instructions-preview"><MarkdownMessage content={instructions} copyLabel={t("copyCode")} copiedLabel={t("copied")} /></div>
          )}
        </div>
      ) : null}
      {tab === "files" ? <SkillFilesPanel skillId={skill.id} entries={files.data} loading={files.isLoading} t={t} /> : null}
    </div>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t("deleteSkill")}</AlertDialogTitle><AlertDialogDescription>{t("deleteSkillDetail")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={() => remove.mutate()}>{t("delete")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function isBinarySkillFileError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "Binary Skill files cannot be previewed." ||
    (error as { code?: string }).code === "BINARY_SKILL_FILE"
  );
}

function SkillFilesPanel({ skillId, entries, loading, t }: { skillId: string; entries: SkillFolderEntry[] | undefined; loading: boolean; t: T }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const files = entries?.filter(({ type }) => type === "file") ?? [];
    const preferred = files.find(({ path }) => path === "SKILL.md") ?? files[0];
    setSelectedPath((current) => files.some(({ path }) => path === current) ? current : preferred?.path ?? null);
  }, [entries, skillId]);
  useEffect(() => setCopied(false), [selectedPath]);
  const file = useQuery({
    queryKey: ["skill-file", skillId, selectedPath],
    queryFn: () => window.piWork.skill.readFile(skillId, selectedPath as string),
    enabled: selectedPath !== null,
    retry: false,
  });
  return (
    <div className="skill-files-panel">
      <aside className="skill-folder-tree">
        <header>
        <span><Icon name="workspace" size={14} />{t("skillFolderContents")}</span>
        <small>{loading ? t("loading") : `${entries?.length ?? 0} ${t("files")}`}</small>
        </header>
        <div className="skill-folder-tree-list">
          {loading ? <div className="skill-folder-tree-loading">{t("loading")}</div> : null}
          {entries?.map((entry) => entry.type === "file" ? (
            <button className={`skill-folder-tree-row skill-folder-tree-row--file skill-folder-tree-row--depth-${Math.min(entry.path.split("/").length - 1, 6)}${selectedPath === entry.path ? " selected" : ""}`} key={entry.path} onClick={() => setSelectedPath(entry.path)}>
              <Icon name="file" size={14} />
              <span>{entry.name}</span>
            </button>
          ) : (
            <div className={`skill-folder-tree-row skill-folder-tree-row--directory skill-folder-tree-row--depth-${Math.min(entry.path.split("/").length - 1, 6)}`} key={entry.path}>
              <Icon name="workspace" size={14} />
              <span>{entry.name}</span>
            </div>
          ))}
        </div>
      </aside>
      <section className="skill-file-viewer">
        {file.data ? <SkillFileViewer file={file.data} copied={copied} t={t} onCopy={() => {
          void navigator.clipboard.writeText(file.data.content).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }} /> : <div className={`skill-file-viewer-empty${isBinarySkillFileError(file.error) ? " skill-file-viewer-empty--binary" : ""}`}>
          {file.isLoading ? t("loading") : isBinarySkillFileError(file.error) ? <><Icon name="file-x" size={14} /><p>{t("binaryFileCannotPreview")}</p></> : file.error instanceof Error ? file.error.message : t("selectFileToPreview")}
        </div>}
      </section>
    </div>
  );
}

function SkillFileViewer({ file, copied, t, onCopy }: { file: SkillFileContent; copied: boolean; t: T; onCopy(): void }) {
  const lines = file.content.split("\n");
  return <>
    <header className="skill-file-viewer-header">
      <span><strong>{file.path}</strong><small>{file.language} · {formatFileSize(file.size)}</small></span>
      <Button variant="ghost" size="sm" onClick={onCopy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? t("copied") : t("copy")}</Button>
    </header>
    <div className="skill-code-viewer" role="region" aria-label={file.path}>
      <code>{lines.map((line, index) => <span className="skill-code-line" key={index}><i>{index + 1}</i><b>{line || "\u00a0"}</b></span>)}</code>
    </div>
  </>;
}

function formatFileSize(bytes: number): string {
  return bytes < 1_024 ? `${bytes} B` : `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

function nextSkillName(skills: Skill[]): string {
  const names = new Set(skills.map(({ name }) => name));
  if (!names.has("untitled-skill")) return "untitled-skill";
  for (let suffix = 2; ; suffix++) {
    const candidate = `untitled-skill-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

function skillSourceLabel(skill: Skill, t: T): string {
  if (skill.source?.type === "remote") return skill.source.provider;
  if (skill.source?.type === "system") return systemSkillSourceLabel(skill.source.provider, t);
  if (skill.source?.type === "created") return t("createdInPiWork");
  return t("localSkill");
}

function skillSourceDetail(skill: Skill, t: T): string {
  if (skill.source?.type === "remote") return skill.source.repositoryUrl ?? skill.source.sourceUrl;
  if (skill.source?.type === "system" || skill.source?.type === "local") return skill.source.path ?? t("localSkill");
  return t("createdInPiWork");
}

function formatInstallCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function systemStatusLabel(session: Pick<Session, "status" | "running">, t: T): string {
  if (session.running) return t("lifecycleRunning");
  const keys: Record<Session["status"], MessageKey> = {
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
  };
  return t(keys[session.status]);
}
