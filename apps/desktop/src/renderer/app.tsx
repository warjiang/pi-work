import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Artifact,
  ChatMessage,
  ExtensionPackage,
  ModelOption,
  ProviderConfig,
  Task,
  ThinkingLevel,
  ToolApproval,
  Workspace,
} from "@pi-work/protocol";
import { Button } from "./components/ui/button.js";
import { useWorkspaceUi } from "./store.js";

function artifactDraft(task: Task): string {
  return `# ${task.title}\n\n## Goal\n\n${task.goal}\n\n## Decision summary\n\nAdd approved findings here.\n`;
}

function nextThinking(model: ModelOption | undefined, current: ThinkingLevel): ThinkingLevel {
  if (model?.thinkingLevels.includes(current)) return current;
  if (model?.thinkingLevels.includes("medium")) return "medium";
  return model?.thinkingLevels[0] ?? "off";
}

export function App() {
  const queryClient = useQueryClient();
  const ui = useWorkspaceUi();
  const [chatInput, setChatInput] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ToolApproval[]>([]);

  const providers = useQuery({ queryKey: ["providers"], queryFn: () => window.piWork.provider.list() });
  const models = useQuery({ queryKey: ["models"], queryFn: () => window.piWork.model.list() });
  const extensions = useQuery({ queryKey: ["extensions"], queryFn: () => window.piWork.extension.list() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.piWork.settings.get() });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => window.piWork.workspace.list() });
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => window.piWork.conversation.list(),
  });
  const folderWorkspaces = (workspaces.data ?? []).filter(({ kind }) => kind === "folder");
  const tasks = useQuery({
    queryKey: ["tasks", ui.selectedWorkspaceId],
    queryFn: () => window.piWork.task.list(ui.selectedWorkspaceId ?? ""),
    enabled: ui.mode === "folder" && ui.selectedWorkspaceId !== null,
  });
  const conversation = conversations.data?.find(({ task }) => task.id === ui.selectedTaskId);
  const task = ui.mode === "managed"
    ? conversation?.task ?? null
    : tasks.data?.find(({ id }) => id === ui.selectedTaskId) ?? null;
  const selectedWorkspace = ui.mode === "managed"
    ? conversation?.workspace ?? null
    : folderWorkspaces.find(({ id }) => id === ui.selectedWorkspaceId) ?? null;
  const messages = useQuery({
    queryKey: ["messages", ui.selectedTaskId],
    queryFn: () => window.piWork.chat.list(ui.selectedTaskId ?? ""),
    enabled: ui.selectedTaskId !== null,
  });
  const plan = useQuery({
    queryKey: ["plan", ui.selectedTaskId],
    queryFn: () => window.piWork.task.plan(ui.selectedTaskId ?? ""),
    enabled: ui.selectedTaskId !== null,
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", ui.selectedTaskId],
    queryFn: () => window.piWork.artifact.list(ui.selectedTaskId ?? ""),
    enabled: ui.mode === "folder" && ui.selectedTaskId !== null,
  });

  const configured = new Set((providers.data ?? []).map(({ providerId: id }) => id));
  const availableModels = (models.data?.models ?? []).filter((model) => configured.has(model.providerId));
  const selectedModel = models.data?.models.find(
    (model) => model.providerId === providerId && model.modelId === modelId,
  );
  const selectionAvailable = selectedModel !== undefined && configured.has(providerId);
  const onboarding = providers.isSuccess
    && providers.data.length === 0
    && settings.isSuccess
    && !settings.data.onboardingSkipped
    && ui.view !== "settings";

  useEffect(() => window.piWork.chat.onToolApproval(
    (approval) => setApprovals((current) => [...current, approval]),
  ), []);

  useEffect(() => {
    const preferredProvider = task?.providerId ?? settings.data?.providerId;
    const preferredModel = task?.modelId ?? settings.data?.modelId;
    const preferredThinking = task?.thinkingLevel ?? settings.data?.thinkingLevel ?? "off";
    if (preferredProvider !== null && preferredProvider !== undefined && preferredModel !== null && preferredModel !== undefined) {
      const preferred = models.data?.models.find(
        (model) => model.providerId === preferredProvider && model.modelId === preferredModel,
      );
      setProviderId(preferredProvider);
      setModelId(preferredModel);
      setThinkingLevel(preferred === undefined ? preferredThinking : nextThinking(preferred, preferredThinking));
    } else {
      const fallback = availableModels[0];
      if (fallback !== undefined) {
        setProviderId(fallback.providerId);
        setModelId(fallback.modelId);
        setThinkingLevel(nextThinking(fallback, preferredThinking));
      }
    }
  }, [task?.id, task?.providerId, task?.modelId, task?.thinkingLevel, settings.data, models.data]);

  async function invalidateChat(taskId?: string): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
      taskId === undefined ? Promise.resolve() : queryClient.invalidateQueries({ queryKey: ["messages", taskId] }),
      taskId === undefined ? Promise.resolve() : queryClient.invalidateQueries({ queryKey: ["plan", taskId] }),
    ]);
  }

  const sendChat = useMutation({
    mutationFn: (content: string) => {
      if (!selectionAvailable) throw new Error("This model is unavailable or has no credential. Open Settings.");
      return window.piWork.chat.send({
        workspaceId: ui.selectedWorkspaceId,
        taskId: ui.selectedTaskId,
        content,
        providerId,
        modelId,
        thinkingLevel,
      });
    },
    onSuccess: async (newTask) => {
      setChatInput("");
      await invalidateChat(newTask.id);
      if (ui.mode === "managed") ui.selectConversation(newTask.workspaceId, newTask.id);
      else ui.selectTask(newTask.id);
    },
    onError: async (cause: Error) => {
      setError(cause.message);
      await invalidateChat(ui.selectedTaskId ?? undefined);
    },
    onSettled: () => setApprovals([]),
  });

  const chooseWorkspace = useMutation({
    mutationFn: () => window.piWork.workspace.choose(),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (workspace !== null) ui.selectWorkspace(workspace.id);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const updateModel = useMutation({
    mutationFn: async (selection: { providerId: string; modelId: string; thinkingLevel: ThinkingLevel }) => {
      if (task === null) await window.piWork.settings.update(selection);
      else await window.piWork.conversation.updateModel({ taskId: task.id, ...selection });
    },
    onSuccess: () => invalidateChat(task?.id),
    onError: (cause: Error) => setError(cause.message),
  });

  function selectModel(value: string): void {
    const [nextProviderId, ...modelParts] = value.split("/");
    const nextModelId = modelParts.join("/");
    const nextModel = models.data?.models.find(
      (model) => model.providerId === nextProviderId && model.modelId === nextModelId,
    );
    const nextLevel = nextThinking(nextModel, thinkingLevel);
    setProviderId(nextProviderId ?? "");
    setModelId(nextModelId);
    setThinkingLevel(nextLevel);
    updateModel.mutate({ providerId: nextProviderId ?? "", modelId: nextModelId, thinkingLevel: nextLevel });
  }

  function selectThinking(level: ThinkingLevel): void {
    setThinkingLevel(level);
    if (providerId !== "" && modelId !== "") {
      updateModel.mutate({ providerId, modelId, thinkingLevel: level });
    }
  }

  const approvePlan = useMutation({
    mutationFn: (approved: boolean) => window.piWork.task.approvePlan({ taskId: task?.id, approved }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (cause: Error) => setError(cause.message),
  });
  const createArtifact = useMutation({
    mutationFn: () => {
      if (task === null) throw new Error("Choose a task first.");
      return window.piWork.artifact.create({
        taskId: task.id,
        relativePath: "decision-brief.md",
        content: artifactDraft(task),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["artifacts", task?.id] }),
    onError: (cause: Error) => setError(cause.message),
  });
  const publishArtifact = useMutation({
    mutationFn: (artifact: Artifact) => window.piWork.artifact.publish({ artifactId: artifact.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["artifacts", task?.id] }),
    onError: (cause: Error) => setError(cause.message),
  });
  const removeConversation = useMutation({
    mutationFn: (taskId: string) => window.piWork.conversation.remove({ taskId }),
    onSuccess: async () => {
      setPendingDelete(null);
      ui.newChat();
      await invalidateChat();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  function submitChat(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = chatInput.trim();
    if (content === "") return;
    setError(null);
    sendChat.mutate(content);
  }

  return (
    <>
      <main className={`app-shell ${ui.mode === "managed" || ui.view === "settings" ? "without-inspector" : ""}`}>
        <Sidebar
          conversations={conversations.data ?? []}
          folderWorkspaces={folderWorkspaces}
          selectedTaskId={ui.selectedTaskId}
          selectedWorkspaceId={ui.selectedWorkspaceId}
          view={ui.view}
          tasks={tasks.data ?? []}
          onChooseWorkspace={() => chooseWorkspace.mutate()}
          onDelete={setPendingDelete}
          onNewChat={ui.newChat}
          onSelectConversation={ui.selectConversation}
          onSelectTask={ui.selectTask}
          onSelectWorkspace={ui.selectWorkspace}
          onSettings={ui.showSettings}
        />

        {ui.view === "settings" ? (
          <Settings
            extensions={extensions.data ?? []}
            models={models.data?.models ?? []}
            providers={providers.data ?? []}
            diagnostics={models.data?.diagnostics ?? []}
            error={error}
            onError={setError}
          />
        ) : (
          <section className="content">
            <header className="page-header">
              <div>
                <p className="eyebrow">{ui.mode === "managed" ? "CHAT" : selectedWorkspace?.name ?? "WORKSPACE"}</p>
                <h2>{task?.title ?? "New chat"}</h2>
              </div>
            </header>
            {error !== null ? (
              <p className="error">{error} {!selectionAvailable ? <button className="link-button" onClick={ui.showSettings}>Open Settings</button> : null}</p>
            ) : null}
            <section className="chat">
              <div className="chat-messages">
                {(messages.data?.length ?? 0) === 0 ? (
                  <div className="chat-welcome">
                    <span className="brand-mark">π</span>
                    <h3>What can I help you with?</h3>
                    <p>{ui.mode === "managed" ? "Start a chat. A private working directory is created on first send." : "Ask Pi to inspect or change files in this workspace."}</p>
                  </div>
                ) : <ChatMessages messages={messages.data ?? []} />}
                {sendChat.isPending ? <div className="chat-message assistant"><p>Thinking…</p></div> : null}
                {approvals.map((approval) => (
                  <ToolApprovalCard
                    approval={approval}
                    key={approval.approvalId}
                    onResolve={(approved) => {
                      void window.piWork.chat.resolveToolApproval({ approvalId: approval.approvalId, approved });
                      setApprovals((current) => current.filter(({ approvalId }) => approvalId !== approval.approvalId));
                    }}
                  />
                ))}
                {plan.data ? <PlanCard task={task} plan={plan.data} onApprove={(value) => approvePlan.mutate(value)} /> : null}
                {task?.status === "running" && ui.mode === "folder" ? (
                  <article className="card action-card">
                    <div><p className="eyebrow">APPROVED</p><h3>Create a reviewable artifact</h3></div>
                    <Button onClick={() => createArtifact.mutate()}>Create decision brief</Button>
                  </article>
                ) : null}
              </div>
              <form className="chat-composer" onSubmit={submitChat}>
                <textarea
                  aria-label="Message Pi"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Message Pi"
                  rows={3}
                />
                <div className="composer-footer">
                  <div className="composer-selectors">
                    <select aria-label="Model" value={`${providerId}/${modelId}`} onChange={(event) => selectModel(event.target.value)}>
                      {!selectionAvailable && providerId !== "" ? <option value={`${providerId}/${modelId}`}>{providerId} / {modelId} (unavailable)</option> : null}
                      {availableModels.map((model) => (
                        <option key={`${model.providerId}/${model.modelId}`} value={`${model.providerId}/${model.modelId}`}>
                          {model.providerName} · {model.modelName}
                        </option>
                      ))}
                    </select>
                    <select aria-label="Thinking level" value={thinkingLevel} onChange={(event) => selectThinking(event.target.value as ThinkingLevel)}>
                      {(selectedModel?.thinkingLevels ?? ["off"]).map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                  <Button disabled={sendChat.isPending || chatInput.trim() === "" || !selectionAvailable} type="submit">
                    {sendChat.isPending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </form>
            </section>
          </section>
        )}

        {ui.view === "chat" && ui.mode === "folder" ? (
          <aside className="inspector">
            <div className="section-heading"><h2>Artifacts</h2><span>{artifacts.data?.length ?? 0}</span></div>
            <ArtifactList artifacts={artifacts.data ?? []} onPublish={(artifact) => publishArtifact.mutate(artifact)} />
          </aside>
        ) : null}
      </main>

      {onboarding ? (
        <div className="modal-backdrop">
          <section className="modal onboarding" role="dialog" aria-modal="true">
            <span className="brand-mark">π</span>
            <div><h2>Connect a provider</h2><p>Add an API key to use Pi, or skip and configure it later.</p></div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => {
                void window.piWork.settings.update({ onboardingSkipped: true }).then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }));
              }}>Skip for now</Button>
              <Button onClick={ui.showSettings}>Open Settings</Button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingDelete !== null ? (
        <ConfirmDialog
          title="Delete this chat?"
          detail="Its managed working directory and conversation history will be removed. Workspace folders are never deleted."
          pending={removeConversation.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => removeConversation.mutate(pendingDelete)}
        />
      ) : null}
    </>
  );
}

function Sidebar(props: {
  conversations: Awaited<ReturnType<typeof window.piWork.conversation.list>>;
  folderWorkspaces: Workspace[];
  tasks: Task[];
  selectedTaskId: string | null;
  selectedWorkspaceId: string | null;
  view: "chat" | "settings";
  onNewChat(): void;
  onSettings(): void;
  onChooseWorkspace(): void;
  onDelete(taskId: string): void;
  onSelectConversation(workspaceId: string, taskId: string): void;
  onSelectWorkspace(workspaceId: string): void;
  onSelectTask(taskId: string | null): void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">π</span><div><h1>Pi Work</h1><p>Local-first agent workspace</p></div></div>
      <Button variant="secondary" onClick={props.onNewChat}>＋ New chat</Button>
      <section>
        <div className="section-heading"><h2>Recent chats</h2></div>
        <div className="nav-list">
          {props.conversations.map(({ workspace, task }) => (
            <div className="nav-row" key={task.id}>
              <button className={task.id === props.selectedTaskId ? "nav-item selected" : "nav-item"} onClick={() => props.onSelectConversation(workspace.id, task.id)}>
                <span>{task.title}</span>
              </button>
              <button aria-label={`Delete ${task.title}`} className="nav-delete" onClick={() => props.onDelete(task.id)}>×</button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="section-heading"><h2>Workspaces</h2><button className="icon-button" onClick={props.onChooseWorkspace}>＋</button></div>
        <div className="nav-list">
          {props.folderWorkspaces.map((workspace) => (
            <button className={workspace.id === props.selectedWorkspaceId ? "nav-item selected" : "nav-item"} key={workspace.id} onClick={() => props.onSelectWorkspace(workspace.id)}>
              <span>{workspace.name}</span><small>{workspace.rootPath}</small>
            </button>
          ))}
        </div>
        {props.selectedWorkspaceId !== null && props.view === "chat" ? (
          <div className="nav-list nested">
            <button className={props.selectedTaskId === null ? "nav-item selected" : "nav-item"} onClick={() => props.onSelectTask(null)}>New workspace chat</button>
            {props.tasks.map((task) => <button className={task.id === props.selectedTaskId ? "nav-item selected" : "nav-item"} key={task.id} onClick={() => props.onSelectTask(task.id)}><span>{task.title}</span></button>)}
          </div>
        ) : null}
      </section>
      <button className={props.view === "settings" ? "settings-link selected" : "settings-link"} onClick={props.onSettings}>⚙ Settings</button>
    </aside>
  );
}

function Settings({
  extensions,
  models,
  providers,
  diagnostics,
  error,
  onError,
}: {
  extensions: ExtensionPackage[];
  models: ModelOption[];
  providers: ProviderConfig[];
  diagnostics: string[];
  error: string | null;
  onError(message: string | null): void;
}) {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState(models[0]?.providerId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pendingExtension, setPendingExtension] = useState<string | null>(null);
  const providerOptions = useMemo(() => Array.from(new Map(
    models.map((model) => [model.providerId, { id: model.providerId, name: model.providerName }]),
  ).values()), [models]);
  useEffect(() => {
    if (providerId === "" && providerOptions[0] !== undefined) setProviderId(providerOptions[0].id);
  }, [providerId, providerOptions]);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["providers"] }),
    queryClient.invalidateQueries({ queryKey: ["models"] }),
    queryClient.invalidateQueries({ queryKey: ["extensions"] }),
  ]);
  const saveProvider = useMutation({
    mutationFn: () => window.piWork.provider.save({ providerId, apiKey }),
    onSuccess: async () => { setApiKey(""); onError(null); await refresh(); },
    onError: (cause: Error) => onError(cause.message),
  });
  const removeProvider = useMutation({
    mutationFn: (id: string) => window.piWork.provider.remove(id),
    onSuccess: refresh,
    onError: (cause: Error) => onError(cause.message),
  });
  const installExtension = useMutation({
    mutationFn: (source: string) => window.piWork.extension.install(source),
    onSuccess: async () => { setPendingExtension(null); onError(null); await refresh(); },
    onError: (cause: Error) => onError(cause.message),
  });
  const removeExtension = useMutation({
    mutationFn: (source: string) => window.piWork.extension.remove(source),
    onSuccess: refresh,
    onError: (cause: Error) => onError(cause.message),
  });
  const chooseLocal = useMutation({
    mutationFn: (kind: "file" | "directory") => window.piWork.extension.chooseLocal(kind),
    onSuccess: (source) => { if (source !== null) setPendingExtension(source); },
    onError: (cause: Error) => onError(cause.message),
  });
  return (
    <section className="content settings-page">
      <header className="page-header"><div><p className="eyebrow">PI WORK</p><h2>Settings</h2></div></header>
      {error !== null ? <p className="error">{error}</p> : null}
      <section className="settings-section">
        <h3>Providers</h3>
        <p className="muted">API keys are encrypted by the desktop process and never returned to this view.</p>
        {diagnostics.map((diagnostic) => <p className="error" key={diagnostic}>{diagnostic}</p>)}
        <div className="provider-form settings-form">
          <label>Provider<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          <label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Stored encrypted" /></label>
          <Button disabled={providerId === "" || apiKey === "" || saveProvider.isPending} onClick={() => saveProvider.mutate()}>Save provider</Button>
        </div>
        <div className="provider-list">
          {providers.map((provider) => <article className="extension-item" key={provider.providerId}><strong>{provider.providerId}</strong><Button variant="danger" onClick={() => removeProvider.mutate(provider.providerId)}>Remove</Button></article>)}
        </div>
      </section>
      <section className="settings-section">
        <h3>Pi Extensions</h3>
        <ExtensionManager
          packages={extensions}
          pending={installExtension.isPending || removeExtension.isPending || chooseLocal.isPending}
          onChooseLocal={(kind) => chooseLocal.mutate(kind)}
          onInstall={setPendingExtension}
          onRemove={(source) => removeExtension.mutate(source)}
        />
      </section>
      {pendingExtension !== null ? (
        <ConfirmDialog
          title="Install Pi extension?"
          detail={`${pendingExtension}\n\nExtensions execute code with your user permissions. Install only sources you trust.`}
          pending={installExtension.isPending}
          onCancel={() => setPendingExtension(null)}
          onConfirm={() => installExtension.mutate(pendingExtension)}
        />
      ) : null}
    </section>
  );
}

function ExtensionManager(props: {
  packages: ExtensionPackage[];
  pending: boolean;
  onChooseLocal(kind: "file" | "directory"): void;
  onInstall(source: string): void;
  onRemove(source: string): void;
}) {
  const [source, setSource] = useState("");
  return (
    <div className="extension-manager">
      <p className="extension-warning">Extensions execute code with your user permissions. Install only trusted sources.</p>
      <div className="extension-install"><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="npm:package or Git URL" /><Button disabled={props.pending || source.trim() === ""} onClick={() => { props.onInstall(source.trim()); setSource(""); }}>Install</Button></div>
      <div className="extension-picker"><Button variant="secondary" onClick={() => props.onChooseLocal("file")}>Choose file</Button><Button variant="secondary" onClick={() => props.onChooseLocal("directory")}>Choose folder</Button></div>
      <div className="extension-list">{props.packages.map((extension) => <article className="extension-item" key={extension.source}><div><strong>{extension.source}</strong><small>{extension.installedPath ?? "Local source"}</small></div><Button variant="danger" onClick={() => props.onRemove(extension.source)}>Remove</Button></article>)}</div>
    </div>
  );
}

function ToolApprovalCard({ approval, onResolve }: { approval: ToolApproval; onResolve(approved: boolean): void }) {
  const detail = approval.tool === "bash"
    ? String(approval.arguments.command ?? "")
    : JSON.stringify(approval.arguments, null, 2);
  return (
    <article className="card approval-card">
      <div><p className="eyebrow">APPROVAL REQUIRED</p><h3>{approval.tool}</h3><p>This operation runs with your user permissions in {approval.cwd}.</p><pre>{detail}</pre></div>
      <div className="actions"><Button variant="secondary" onClick={() => onResolve(false)}>Deny</Button><Button onClick={() => onResolve(true)}>Approve</Button></div>
    </article>
  );
}

function PlanCard({ task, plan, onApprove }: { task: Task | null; plan: Awaited<ReturnType<typeof window.piWork.task.plan>>; onApprove(value: boolean): void }) {
  if (plan === null) return null;
  return <article className="card plan-card"><div className="card-heading"><div><p className="eyebrow">PROPOSED PLAN</p><h3>{plan.summary}</h3></div>{task?.status === "awaiting_plan_approval" ? <div className="actions"><Button variant="secondary" onClick={() => onApprove(false)}>Revise</Button><Button onClick={() => onApprove(true)}>Approve</Button></div> : null}</div><ol className="plan-steps">{plan.steps.map((step) => <li key={step.id}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol></article>;
}

function ConfirmDialog(props: { title: string; detail: string; pending: boolean; onCancel(): void; onConfirm(): void }) {
  return <div className="modal-backdrop" onClick={props.pending ? undefined : props.onCancel}><section className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="modal-icon">!</div><div><h2>{props.title}</h2><p className="pre-line">{props.detail}</p></div><div className="modal-actions"><Button variant="secondary" disabled={props.pending} onClick={props.onCancel}>Cancel</Button><Button disabled={props.pending} onClick={props.onConfirm}>{props.pending ? "Working…" : "Confirm"}</Button></div></section></div>;
}

function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  return <>{messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}><span>{message.role === "user" ? "You" : message.role === "assistant" ? "Pi" : "Command"}</span><p>{message.content}</p></article>)}</>;
}

function ArtifactList({ artifacts, onPublish }: { artifacts: Artifact[]; onPublish(artifact: Artifact): void }) {
  if (artifacts.length === 0) return <p className="muted">Reviewable outputs will appear here.</p>;
  return <div className="artifact-list">{artifacts.map((artifact) => <article className="artifact" key={artifact.id}><div><strong>{artifact.relativePath}</strong><p>{artifact.publishedPath === null ? "Staged for review" : "Published"}</p></div><pre>{artifact.content}</pre>{artifact.publishedPath === null ? <Button onClick={() => onPublish(artifact)}>Publish</Button> : null}</article>)}</div>;
}
