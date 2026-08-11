import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Automation,
  Label,
  Session,
  Skill,
  Source,
  StatusDefinition,
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
} from "../components/ui/alert-dialog.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
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
import { Textarea } from "../components/ui/textarea.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import { sessionsByStage, sessionsForBoard } from "../board.js";
import type { MessageKey } from "../i18n.js";

type T = (key: MessageKey) => string;

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

export function SourcesPage({ workspaceId, t }: { workspaceId: string | null; t: T }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["sources", workspaceId], queryFn: () => window.piWork.source.list(workspaceId) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = query.data?.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sources", workspaceId] });
  const create = useMutation({ mutationFn: () => window.piWork.source.create({ workspaceId, value: { name: t("newSource"), type: "local", enabled: false, config: {} } }), onSuccess: async (source) => { await refresh(); setSelectedId(source.id); } });
  return (
    <LibraryLayout
      title={t("sources")}
      detail={t("notUsedForExecution")}
      icon="source"
      items={query.data ?? []}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noItems")}
      addLabel={t("add")}
      onAdd={() => create.mutate()}
      onSelect={setSelectedId}
      renderItem={(source) => <><strong>{source.name}</strong><small>{sourceTypeLabel(source.type, t)}</small><Badge>{t("notUsed")}</Badge></>}
      detailPane={selected ? <SourceEditor source={selected} t={t} onSaved={refresh} onDeleted={async () => { setSelectedId(null); await refresh(); }} /> : null}
    />
  );
}

function SourceEditor({ source, t, onSaved, onDeleted }: { source: Source; t: T; onSaved(): Promise<unknown>; onDeleted(): Promise<void> }) {
  const [name, setName] = useState(source.name);
  const [type, setType] = useState<Source["type"]>(source.type);
  const [config, setConfig] = useState(JSON.stringify(source.config, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setName(source.name); setType(source.type); setConfig(JSON.stringify(source.config, null, 2)); }, [source]);
  const save = useMutation({
    mutationFn: async () => {
      let value: Record<string, unknown>;
      try { value = JSON.parse(config) as Record<string, unknown>; } catch { throw new Error(t("invalidJson")); }
      return window.piWork.source.update({ id: source.id, value: { name, type, config: value, enabled: source.enabled } });
    },
    onSuccess: onSaved,
    onError: (cause: Error) => setError(cause.message),
  });
  return <ResourceEditor title={source.name} status={t("notUsedForExecution")} t={t} onDelete={() => void window.piWork.source.remove(source.id).then(onDeleted)}>
    <Alert className="runtime-boundary"><AlertDescription>{t("notUsedForExecution")}</AlertDescription></Alert>
    <FieldGroup><Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>{t("sourceType")}</FieldLabel><Select value={type} onValueChange={(value) => setType(value as Source["type"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{(["local", "mcp_stdio", "mcp_http", "openapi", "google", "microsoft", "slack"] as Source["type"][]).map((value) => <SelectItem key={value} value={value}>{sourceTypeLabel(value, t)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>{t("configuration")}</FieldLabel><Textarea className="code-textarea" value={config} onChange={(event) => setConfig(event.target.value)} rows={12} /></Field>{error ? <Alert className="form-error"><AlertDescription>{error}</AlertDescription></Alert> : null}<Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button></FieldGroup>
  </ResourceEditor>;
}

export function SkillsPage({ workspaceId, t }: { workspaceId: string | null; t: T }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["skills", workspaceId], queryFn: () => window.piWork.skill.list(workspaceId) });
  const filtered = (query.data ?? []).filter((skill) => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selected = query.data?.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["skills", workspaceId] });
  const create = useMutation({ mutationFn: () => window.piWork.skill.create({ workspaceId, value: { name: t("newSkill"), description: "", instructions: "# Instructions\n", enabled: false } }), onSuccess: async (skill) => { await refresh(); setSelectedId(skill.id); } });
  return (
    <LibraryLayout
      title={t("skills")}
      detail={t("skillDraftDetail")}
      icon="skills"
      items={filtered}
      selectedId={selectedId}
      loading={query.isLoading}
      empty={t("noItems")}
      addLabel={t("add")}
      filter={<label className="library-search"><Icon name="search" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchSkills")} /></label>}
      onAdd={() => create.mutate()}
      onSelect={setSelectedId}
      renderItem={(skill) => <><strong>{skill.name}</strong><small>{skill.description || t("skillDraft")}</small><Badge>{t("skillDraft")}</Badge></>}
      detailPane={selected ? <SkillEditor skill={selected} t={t} onSaved={refresh} onDeleted={async () => { setSelectedId(null); await refresh(); }} /> : null}
    />
  );
}

function SkillEditor({ skill, t, onSaved, onDeleted }: { skill: Skill; t: T; onSaved(): Promise<unknown>; onDeleted(): Promise<void> }) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [instructions, setInstructions] = useState(skill.instructions);
  useEffect(() => { setName(skill.name); setDescription(skill.description); setInstructions(skill.instructions); }, [skill]);
  const save = useMutation({ mutationFn: () => window.piWork.skill.update({ id: skill.id, value: { name, description, instructions, enabled: false } }), onSuccess: onSaved });
  return <ResourceEditor title={skill.name} status={t("skillDraftDetail")} t={t} onDelete={() => void window.piWork.skill.remove(skill.id).then(onDeleted)}>
    <FieldGroup><Field><FieldLabel>{t("name")}</FieldLabel><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field><FieldLabel>{t("description")}</FieldLabel><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></Field><Field><FieldLabel>{t("instructions")}</FieldLabel><Textarea className="markdown-editor" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={18} /></Field><Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? t("saving") : t("save")}</Button></FieldGroup>
  </ResourceEditor>;
}

export function AutomationsPage({ workspaceId, t }: { workspaceId: string | null; t: T }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["automations", workspaceId], queryFn: () => window.piWork.automation.list(workspaceId) });
  const statuses = useQuery({
    queryKey: ["statuses", workspaceId],
    queryFn: () => workspaceId === null ? Promise.resolve([]) : window.piWork.status.list(workspaceId),
  });
  const labels = useQuery({
    queryKey: ["labels", workspaceId],
    queryFn: () => workspaceId === null ? Promise.resolve([]) : window.piWork.label.list(workspaceId),
  });
  const sessions = useQuery({
    queryKey: ["automation-sessions", workspaceId],
    queryFn: async () => {
      const values = await window.piWork.session.list();
      return workspaceId === null ? values : values.filter((session) => session.workspaceId === workspaceId);
    },
  });
  const selected = query.data?.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["automations", workspaceId] });
  const create = useMutation({ mutationFn: () => window.piWork.automation.create({ workspaceId, value: { name: t("newAutomation"), enabled: false, trigger: { type: "schedule", cron: "0 9 * * 1-5" }, action: { type: "create_session", title: t("newTask"), prompt: t("newAutomation") }, lastRunAt: null } }), onSuccess: async (automation) => { await refresh(); setSelectedId(automation.id); } });
  return (
    <LibraryLayout
      title={t("automations")}
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
  icon: IconName;
  items: T[];
  selectedId: string | null;
  loading: boolean;
  empty: string;
  addLabel: string;
  filter?: ReactNode;
  onAdd(): void;
  onSelect(id: string): void;
  renderItem(item: T): ReactNode;
  detailPane: ReactNode;
}) {
  return (
    <section className="page library-page">
      <PageHeader eyebrow={props.detail} title={props.title} action={<Button onClick={props.onAdd}><Icon name="plus" />{props.addLabel}</Button>} />
      <div className={`library-layout ${props.detailPane ? "has-detail" : ""}`}>
        <div className="library-list-pane">
          {props.filter}
          {props.loading ? <div className="page-loading"><span /><span /><span /></div> : (
            <div className="library-list">
              {props.items.map((item) => <Button variant="ghost" className={props.selectedId === item.id ? "library-row selected" : "library-row"} key={item.id} onClick={() => props.onSelect(item.id)}><span className="resource-symbol"><Icon name={props.icon} /></span><span className="library-row-copy">{props.renderItem(item)}</span><Icon name="forward" size={14} /></Button>)}
              {props.items.length === 0 ? <p className="library-empty">{props.empty}</p> : null}
            </div>
          )}
        </div>
        {props.detailPane ? <aside className="resource-detail-pane">{props.detailPane}</aside> : <div className="resource-detail-empty"><Icon name={props.icon} /><p>{props.detail}</p></div>}
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
