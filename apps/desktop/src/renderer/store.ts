import { create } from "zustand";

export type AppView =
  | "inbox"
  | "board"
  | "sources"
  | "automations";

export const taskModes = ["conversation", "orchestration", "artifacts"] as const;
export type TaskMode = (typeof taskModes)[number];
export type ContextPanel = "task" | "activity" | "node" | "plan" | null;
export type WorkspaceScope = "personal" | string;
export type SettingsSection =
  | "general"
  | "preferences"
  | "appearance"
  | "modelsCredentials"
  | "workFolders"
  | "permissions"
  | "skills"
  | "mcp"
  | "extensions"
  | "browser"
  | "observability"
  | "shortcuts"
  | "about";

type WorkspaceUiState = {
  view: AppView;
  workspaceScope: WorkspaceScope;
  selectedTaskId: string | null;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  sidebarCollapsed: boolean;
  sidebarDrawerOpen: boolean;
  taskMode: TaskMode;
  contextPanel: ContextPanel;
  commandOpen: boolean;
  search: string;
  showView(view: AppView): void;
  setWorkspaceScope(scope: WorkspaceScope): void;
  selectTask(taskId: string | null): void;
  openTask(taskId: string): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  setSettingsSection(section: SettingsSection): void;
  toggleSidebar(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setSidebarDrawerOpen(open: boolean): void;
  setTaskMode(mode: TaskMode): void;
  openContextPanel(panel: Exclude<ContextPanel, null>): void;
  closeContextPanel(): void;
  toggleContextPanel(panel?: Exclude<ContextPanel, null>): void;
  setCommandOpen(open: boolean): void;
  setSearch(value: string): void;
};

export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  view: "inbox",
  workspaceScope: "personal",
  selectedTaskId: null,
  settingsOpen: false,
  settingsSection: "general",
  sidebarCollapsed: false,
  sidebarDrawerOpen: false,
  taskMode: "conversation",
  contextPanel: null,
  commandOpen: false,
  search: "",
  showView: (view) => set({ view, sidebarDrawerOpen: false }),
  setWorkspaceScope: (workspaceScope) => set({
    workspaceScope,
    selectedTaskId: null,
    view: "inbox",
    taskMode: "conversation",
    contextPanel: null,
  }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  openTask: (selectedTaskId) => set({
    selectedTaskId,
    view: "inbox",
    sidebarDrawerOpen: false,
    taskMode: "conversation",
    contextPanel: null,
  }),
  openSettings: (section) => set((state) => ({
    settingsOpen: true,
    settingsSection: section ?? state.settingsSection,
    sidebarDrawerOpen: false,
  })),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  toggleSidebar: () => set((state) => ({
    sidebarCollapsed: !state.sidebarCollapsed,
  })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarDrawerOpen: (sidebarDrawerOpen) => set({ sidebarDrawerOpen }),
  setTaskMode: (taskMode) => set({ taskMode }),
  openContextPanel: (contextPanel) => set({ contextPanel }),
  closeContextPanel: () => set({ contextPanel: null }),
  toggleContextPanel: (panel = "task") => set((state) => ({
    contextPanel: state.contextPanel === panel ? null : panel,
  })),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setSearch: (search) => set({ search }),
}));
