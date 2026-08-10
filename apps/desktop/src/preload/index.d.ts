import type {
  Artifact,
  AppSettings,
  ChatMessage,
  ExtensionPackage,
  ModelCatalog,
  Plan,
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
      task: {
        list(workspaceId: string): Promise<Task[]>;
        create(input: unknown): Promise<Task>;
        plan(taskId: string): Promise<Plan | null>;
        approvePlan(input: unknown): Promise<Task>;
        abort(input: unknown): Promise<Task>;
        complete(input: unknown): Promise<Task>;
        resume(input: unknown): Promise<Task>;
      };
      chat: {
        list(taskId: string): Promise<ChatMessage[]>;
        send(input: unknown): Promise<Task>;
        onToolApproval(listener: (approval: ToolApproval) => void): () => void;
        resolveToolApproval(input: unknown): Promise<void>;
      };
      artifact: {
        list(taskId: string): Promise<Artifact[]>;
        create(input: unknown): Promise<Artifact>;
        publish(input: unknown): Promise<Artifact>;
      };
    };
  }
}

export {};
