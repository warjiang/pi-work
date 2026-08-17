import type {
  Artifact,
  Activity,
  AppSettings,
  Attachment,
  AttachmentDraft,
  Automation,
  AgentMessage,
  BuildInfo,
  ChatMessage,
  ExtensionPackage,
  ManagedCliExecutionResult,
  ManagedCliPackage,
  ModelCatalog,
  McpAuthorizationStatus,
  McpCallToolResult,
  McpInspectResult,
  ObservabilitySettings,
  PlanExecutionDetail,
  PlanRevisionDiff,
  PlanRevision,
  Session,
  Skill,
  Source,
  StatusDefinition,
  Task,
  ToolApproval,
  Conversation,
  Workspace,
  WorkspaceDirectory,
  Board,
  BoardColumn,
  BoardSnapshot,
  ConductorRun,
  ConductorNodeState,
  ConductorNodeAttemptDetail,
} from "@pi-work/protocol";

declare global {
  interface Window {
    piWork: {
      workspace: {
        choose(): Promise<Workspace | null>;
        list(): Promise<Workspace[]>;
        get(workspaceId: string): Promise<Workspace | null>;
        update(input: unknown): Promise<Workspace>;
        directories(workspaceId: string): Promise<WorkspaceDirectory[]>;
        chooseDirectory(workspaceId: string): Promise<string | null>;
        addDirectory(workspaceId: string): Promise<Workspace | null>;
        removeDirectory(input: unknown): Promise<Workspace>;
      };
      board: {
        list(workspaceId: string): Promise<Board[]>;
        snapshot(input: unknown): Promise<BoardSnapshot>;
        createColumn(input: unknown): Promise<BoardColumn>;
        updateColumn(input: unknown): Promise<BoardColumn>;
        removeColumn(input: unknown): Promise<void>;
        moveCard(input: unknown): Promise<BoardSnapshot>;
      };
      conductor: {
        list(input: unknown): Promise<ConductorRun[]>;
        get(input: unknown): Promise<ConductorRun | null>;
        create(input: unknown): Promise<ConductorRun>;
        nodes(input: unknown): Promise<ConductorNodeState[]>;
        attempts(input: unknown): Promise<ConductorNodeAttemptDetail[]>;
        start(input: unknown): Promise<ConductorRun>;
        pause(input: unknown): Promise<ConductorRun>;
        resume(input: unknown): Promise<ConductorRun>;
        stop(input: unknown): Promise<ConductorRun>;
        retry(input: unknown): Promise<ConductorRun>;
      };
      provider: {
        list(): Promise<import("@pi-work/protocol").ProviderConfig[]>;
        save(input: unknown): Promise<import("@pi-work/protocol").ProviderConfig>;
        remove(providerId: string): Promise<void>;
      };
      settings: {
        get(): Promise<AppSettings>;
        update(input: unknown): Promise<AppSettings>;
      };
      observability: {
        get(): Promise<ObservabilitySettings>;
        update(input: unknown): Promise<ObservabilitySettings>;
        usage(input?: unknown): Promise<import("@pi-work/protocol").UsageSummary>;
      };
      system: {
        openExternal(url: string): Promise<void>;
        info(): Promise<BuildInfo>;
      };
      extension: {
        list(): Promise<ExtensionPackage[]>;
        install(source: string): Promise<ExtensionPackage[]>;
        remove(source: string): Promise<ExtensionPackage[]>;
        chooseLocal(kind: "file" | "directory"): Promise<string | null>;
      };
      piConsole: {
        start(input?: { cwd?: string }): Promise<{ started: true; reused: boolean; output: string } | { started: false; message: string }>;
        write(data: string): Promise<void>;
        resize(dimensions: { cols: number; rows: number }): Promise<void>;
        snapshot(): Promise<{ running: boolean; output: string }>;
        execute(input: PiConsoleExecuteInput): Promise<PiConsoleExecuteResult>;
        restart(input?: { cwd?: string }): Promise<{ started: true; reused: boolean; output: string } | { started: false; message: string }>;
        close(): Promise<void>;
        onEvent(listener: (event: PiConsoleEvent) => void): () => void;
      };
      managedCli: {
        list(): Promise<ManagedCliPackage[]>;
        install(input: { packageSpec: string }): Promise<ManagedCliPackage[]>;
        update(input: { name: string; version?: string }): Promise<ManagedCliPackage[]>;
        remove(input: { name: string }): Promise<ManagedCliPackage[]>;
        execute(input: {
          command: string;
          args?: string[];
          cwd?: string;
          sessionId?: string;
          env?: Record<string, string>;
          timeoutMs?: number;
        }): Promise<ManagedCliExecutionResult>;
      };
      runtimeEnvironment: {
        setSession(input: { sessionId: string; environment: Record<string, string> }): Promise<string[]>;
        clearSession(input: { sessionId: string }): Promise<void>;
        listSessionKeys(input: { sessionId: string }): Promise<string[]>;
      };
      model: {
        list(): Promise<ModelCatalog>;
      };
      conversation: {
        list(): Promise<Conversation[]>;
        updateModel(input: unknown): Promise<Task>;
        remove(input: unknown): Promise<void>;
      };
      session: {
        list(input?: unknown): Promise<Session[]>;
        create(input: unknown): Promise<Session>;
        get(sessionId: string): Promise<Session | null>;
        update(input: unknown): Promise<Session>;
        remove(sessionId: string): Promise<void>;
        messages(sessionId: string): Promise<ChatMessage[]>;
        activities(sessionId: string): Promise<Activity[]>;
        attachments(sessionId: string): Promise<Attachment[]>;
        stop(sessionId: string): Promise<void>;
        promote(input: unknown): Promise<Session>;
        onChanged(listener: (session: Session) => void): () => void;
      };
      agent: {
        onEvent(listener: (event: Extract<AgentMessage, { type: "event" }>) => void): () => void;
      };
      attachment: {
        choose(): Promise<AttachmentDraft[]>;
        fromFiles(files: File[]): Promise<AttachmentDraft[]>;
        fromClipboardImage(input: { mimeType: string; bytes: Uint8Array }): Promise<AttachmentDraft>;
        previewDraft(input: AttachmentDraft): Promise<string>;
        preview(attachmentId: string): Promise<string>;
        open(attachmentId: string): Promise<string>;
      };
      task: {
        list(workspaceId: string): Promise<Task[]>;
        create(input: unknown): Promise<Task>;
        getPlan(taskId: string): Promise<PlanRevision | null>;
        listPlanRevisions(taskId: string): Promise<PlanRevision[]>;
        listPlanExecutions(taskId: string): Promise<PlanExecutionDetail[]>;
        savePlanRevision(input: unknown): Promise<PlanRevision>;
        getPlanRevisionDiff(input: unknown): Promise<PlanRevisionDiff>;
        requestPlan(input: unknown): Promise<unknown>;
        generatePlan(input: unknown): Promise<unknown>;
        updateBrief(input: unknown): Promise<Task>;
        approvePlan(input: unknown): Promise<Task>;
        executeApprovedPlan(input: unknown): Promise<Task>;
        retryApprovedPlan(input: unknown): Promise<Task>;
        abort(input: unknown): Promise<Task>;
        complete(input: unknown): Promise<Task>;
        resume(input: unknown): Promise<Task>;
      };
      chat: {
        list(taskId: string): Promise<ChatMessage[]>;
        toolApprovals(taskId?: string): Promise<ToolApproval[]>;
        send(input: unknown): Promise<Task>;
        onToolApproval(listener: (approval: ToolApproval) => void): () => void;
        resolveToolApproval(input: unknown): Promise<void>;
      };
      artifact: {
        list(taskId: string): Promise<Artifact[]>;
        create(input: unknown): Promise<Artifact>;
        publish(input: unknown): Promise<Artifact>;
      };
      status: DomainApi<StatusDefinition>;
      label: DomainApi<import("@pi-work/protocol").Label>;
      source: DomainApi<Source>;
      skill: SkillApi;
      automation: DomainApi<Automation>;
      mcp: {
        list(): Promise<Source[]>;
        create(input: unknown): Promise<Source>;
        update(input: unknown): Promise<Source>;
        remove(sourceId: string): Promise<void>;
        inspect(sourceId: string): Promise<McpInspectResult>;
        callTool(input: { sourceId: string; toolName: string; arguments: Record<string, unknown> }): Promise<McpCallToolResult>;
        authorizationStatus(sourceId: string): Promise<McpAuthorizationStatus>;
        authorize(sourceId: string): Promise<McpAuthorizationStatus>;
      };
      browser: BrowserApi;
    };
  }
}

type DomainApi<T> = {
  list(workspaceId: string): Promise<T[]>;
  create(input: unknown): Promise<T>;
  update(input: unknown): Promise<T>;
  remove(id: string, workspaceId?: string): Promise<void>;
};

type SkillApi = {
  list(): Promise<Skill[]>;
  listFiles(id: string): Promise<Array<{ name: string; path: string; type: "directory" | "file" }>>;
  readFile(id: string, path: string): Promise<import("@pi-work/protocol").SkillFileContent>;
  scanSystem(): Promise<import("@pi-work/protocol").SystemSkill[]>;
  searchMarketplace(input: unknown): Promise<import("@pi-work/protocol").MarketplaceSkill[]>;
  previewRemote(input: unknown): Promise<import("@pi-work/protocol").RemoteSkillPreview>;
  installRemote(input: unknown): Promise<Skill[]>;
  cancelRemotePreview(previewId: string): Promise<void>;
  create(input: unknown): Promise<Skill>;
  update(input: unknown): Promise<Skill>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<Skill>;
  import(path: string): Promise<Skill>;
  chooseImport(): Promise<string | null>;
};

type BrowserApi = {
  open(url: string): Promise<void>;
  navigate(url: string): Promise<void>;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  openExternal(): Promise<void>;
  close(): Promise<void>;
  onState(listener: (state: BrowserState) => void): () => void;
};

type BrowserState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

type PiConsoleEvent =
  | { type: "started" }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

type PiConsoleExecuteInput = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

type PiConsoleExecuteResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export {};
