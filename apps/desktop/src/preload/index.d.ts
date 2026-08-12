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
  ModelCatalog,
  Plan,
  Session,
  Skill,
  Source,
  StatusDefinition,
  Task,
  ToolApproval,
  Conversation,
  Workspace,
} from "@pi-work/protocol";

declare global {
  interface Window {
    piWork: {
      workspace: {
        choose(): Promise<Workspace | null>;
        list(): Promise<Workspace[]>;
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
        getPlan(taskId: string): Promise<Plan | null>;
        generatePlan(input: unknown): Promise<Plan>;
        updateBrief(input: unknown): Promise<Task>;
        approvePlan(input: unknown): Promise<Task>;
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
      skill: DomainApi<Skill>;
      automation: DomainApi<Automation>;
      browser: BrowserApi;
    };
  }
}

type DomainApi<T> = {
  list(workspaceId: string): Promise<T[]>;
  create(input: unknown): Promise<T>;
  update(input: unknown): Promise<T>;
  remove(id: string): Promise<void>;
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

export {};
