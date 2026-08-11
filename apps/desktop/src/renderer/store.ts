import { create } from "zustand";

type WorkspaceUiState = {
  view: "inbox" | "browser" | "board" | "sources" | "skills" | "automations" | "settings";
  mode: "managed" | "folder";
  selectedWorkspaceId: string | null;
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  search: string;
  sessionFilter: "all" | "flagged" | "archived";
  newChat(): void;
  showInbox(filter?: WorkspaceUiState["sessionFilter"]): void;
  showView(view: WorkspaceUiState["view"]): void;
  showSettings(): void;
  setSearch(value: string): void;
  toggleSidebar(): void;
  selectWorkspace(workspaceId: string): void;
  selectConversation(workspaceId: string, taskId: string): void;
  selectTask(taskId: string | null): void;
};

export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  view: "inbox",
  mode: "managed",
  selectedWorkspaceId: null,
  selectedTaskId: null,
  sidebarCollapsed: false,
  search: "",
  sessionFilter: "all",
  newChat: () => set({
    view: "inbox",
    mode: "managed",
    selectedWorkspaceId: null,
    selectedTaskId: null,
    sessionFilter: "all",
  }),
  showInbox: (sessionFilter = "all") => set({ view: "inbox", sessionFilter }),
  showView: (view) => set({ view }),
  showSettings: () => set({ view: "settings" }),
  setSearch: (search) => set({ search }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  selectWorkspace: (workspaceId) => set({
    view: "inbox",
    mode: "folder",
    selectedWorkspaceId: workspaceId,
    selectedTaskId: null,
    sessionFilter: "all",
  }),
  selectConversation: (workspaceId, taskId) => set({
    view: "inbox",
    mode: "managed",
    selectedWorkspaceId: workspaceId,
    selectedTaskId: taskId,
  }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
}));
