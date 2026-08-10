import type { Artifact, Plan, Task, Workspace } from "@pi-work/protocol";

declare global {
  interface Window {
    piWork: {
      workspace: {
        choose(): Promise<Workspace | null>;
        list(): Promise<Workspace[]>;
      };
      task: {
        list(workspaceId: string): Promise<Task[]>;
        create(input: unknown): Promise<Task>;
        plan(taskId: string): Promise<Plan | null>;
        approvePlan(input: unknown): Promise<Task>;
        abort(input: unknown): Promise<Task>;
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
