import { create } from "zustand";

type WorkspaceUiState = {
  view: "chat" | "settings";
  mode: "managed" | "folder";
  selectedWorkspaceId: string | null;
  selectedTaskId: string | null;
  newChat(): void;
  showSettings(): void;
  selectWorkspace(workspaceId: string): void;
  selectConversation(workspaceId: string, taskId: string): void;
  selectTask(taskId: string | null): void;
};

export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  view: "chat",
  mode: "managed",
  selectedWorkspaceId: null,
  selectedTaskId: null,
  newChat: () => set({
    view: "chat",
    mode: "managed",
    selectedWorkspaceId: null,
    selectedTaskId: null,
  }),
  showSettings: () => set({ view: "settings" }),
  selectWorkspace: (workspaceId) => set({
    view: "chat",
    mode: "folder",
    selectedWorkspaceId: workspaceId,
    selectedTaskId: null,
  }),
  selectConversation: (workspaceId, taskId) => set({
    view: "chat",
    mode: "managed",
    selectedWorkspaceId: workspaceId,
    selectedTaskId: taskId,
  }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
}));
