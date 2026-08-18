import { beforeEach, describe, expect, it } from "vitest";
import { taskModes, useWorkspaceUi } from "./store.js";

describe("workspace UI state", () => {
  it("keeps Plan inside Conversation instead of exposing it as a task mode", () => {
    expect(taskModes).toEqual(["conversation", "orchestration", "artifacts"]);
  });

  beforeEach(() => {
    useWorkspaceUi.setState({
      view: "board",
      workspaceScope: "workspace-a",
      selectedTaskId: null,
      taskMode: "orchestration",
      contextPanel: "node",
    });
  });

  it("opens every task in Conversation with the context drawer closed", () => {
    useWorkspaceUi.getState().openTask("task-a");

    expect(useWorkspaceUi.getState()).toMatchObject({
      view: "inbox",
      selectedTaskId: "task-a",
      taskMode: "conversation",
      contextPanel: null,
    });
  });

  it("keeps task mode independent from node context selection", () => {
    useWorkspaceUi.getState().setTaskMode("orchestration");
    useWorkspaceUi.getState().openContextPanel("node");
    useWorkspaceUi.getState().closeContextPanel();

    expect(useWorkspaceUi.getState().taskMode).toBe("orchestration");
    expect(useWorkspaceUi.getState().contextPanel).toBeNull();
  });

  it("opens Plan as conversation context instead of a task mode", () => {
    useWorkspaceUi.getState().setTaskMode("conversation");
    useWorkspaceUi.getState().openContextPanel("plan");

    expect(useWorkspaceUi.getState()).toMatchObject({
      taskMode: "conversation",
      contextPanel: "plan",
    });
  });

  it("resets scope navigation to a clean Conversation", () => {
    useWorkspaceUi.getState().setWorkspaceScope("personal");

    expect(useWorkspaceUi.getState()).toMatchObject({
      workspaceScope: "personal",
      selectedTaskId: null,
      view: "inbox",
      taskMode: "conversation",
      contextPanel: null,
    });
  });
});
