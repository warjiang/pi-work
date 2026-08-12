import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceUi } from "./store.js";

describe("settings UI state", () => {
  beforeEach(() => {
    useWorkspaceUi.setState({
      view: "board",
      workspaceScope: "workspace-1",
      selectedTaskId: "task-1",
      settingsOpen: false,
      settingsSection: "general",
    });
  });

  it("opens settings without changing the workspace context", () => {
    useWorkspaceUi.getState().openSettings("permissions");

    expect(useWorkspaceUi.getState()).toMatchObject({
      view: "board",
      workspaceScope: "workspace-1",
      selectedTaskId: "task-1",
      settingsOpen: true,
      settingsSection: "permissions",
    });
  });

  it("remembers the last section for the current app run", () => {
    useWorkspaceUi.getState().openSettings("browser");
    useWorkspaceUi.getState().closeSettings();
    useWorkspaceUi.getState().openSettings();

    expect(useWorkspaceUi.getState()).toMatchObject({
      settingsOpen: true,
      settingsSection: "browser",
      view: "board",
      workspaceScope: "workspace-1",
      selectedTaskId: "task-1",
    });
  });
});
