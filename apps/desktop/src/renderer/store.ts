import { create } from "zustand";

type WorkspaceUiState = {
  selectedWorkspaceId: string | null;
  selectedTaskId: string | null;
  selectWorkspace(workspaceId: string): void;
  selectTask(taskId: string): void;
};

export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  selectedWorkspaceId: null,
  selectedTaskId: null,
  selectWorkspace: (workspaceId) => set({ selectedWorkspaceId: workspaceId, selectedTaskId: null }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
}));
