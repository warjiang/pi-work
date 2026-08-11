import { create } from "zustand";

export type AppView =
  | "inbox"
  | "attention"
  | "completed"
  | "board"
  | "sources"
  | "skills"
  | "automations"
  | "browser"
  | "settings";

export type InspectorTab = "task" | "plan" | "activity" | "output";
export type WorkspaceScope = "all" | "personal" | string;

type WorkspaceUiState = {
  view: AppView;
  workspaceScope: WorkspaceScope;
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  sidebarDrawerOpen: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  commandOpen: boolean;
  newTaskOpen: boolean;
  search: string;
  showView(view: AppView): void;
  setWorkspaceScope(scope: WorkspaceScope): void;
  selectTask(taskId: string | null): void;
  openTask(taskId: string): void;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setSidebarDrawerOpen(open: boolean): void;
  toggleInspector(): void;
  showInspector(tab?: InspectorTab): void;
  setInspectorTab(tab: InspectorTab): void;
  setCommandOpen(open: boolean): void;
  setNewTaskOpen(open: boolean): void;
  setSearch(value: string): void;
};

export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  view: "inbox",
  workspaceScope: "all",
  selectedTaskId: null,
  sidebarCollapsed: false,
  sidebarDrawerOpen: false,
  inspectorOpen: true,
  inspectorTab: "task",
  commandOpen: false,
  newTaskOpen: false,
  search: "",
  showView: (view) => set({ view, sidebarDrawerOpen: false }),
  setWorkspaceScope: (workspaceScope) => set({
    workspaceScope,
    selectedTaskId: null,
    view: "inbox",
  }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  openTask: (selectedTaskId) => set({
    selectedTaskId,
    view: "inbox",
    sidebarDrawerOpen: false,
  }),
  toggleSidebar: () => set((state) => ({
    sidebarCollapsed: !state.sidebarCollapsed,
  })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarDrawerOpen: (sidebarDrawerOpen) => set({ sidebarDrawerOpen }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  showInspector: (inspectorTab = "task") => set({ inspectorOpen: true, inspectorTab }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
  setSearch: (search) => set({ search }),
}));
