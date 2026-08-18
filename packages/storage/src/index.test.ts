import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { labelSchema, statusDefinitionSchema } from "@pi-work/protocol";
import { PiWorkStore } from "./index.js";

describe("PiWorkStore", () => {
  it("renames the legacy blank task placeholder to a session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-session-placeholder-"));
    const filename = join(directory, "session-placeholder.db");
    const store = new PiWorkStore(filename);
    const workspace = store.createWorkspace({
      name: "Modes",
      rootPath: "/workspace/modes",
      outputPath: "/workspace/modes/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "New task",
      goal: "New task",
    });
    store.close();

    const reopened = new PiWorkStore(filename);
    expect(reopened.getTask(task.id)).toEqual(expect.objectContaining({
      title: "New session",
      goal: "New session",
    }));
    reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists execution mode and keeps legacy planMode in sync", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Modes",
      rootPath: "/workspace/modes",
      outputPath: "/workspace/modes/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "New task",
      goal: "Choose an execution path.",
      planMode: true,
      executionMode: "plan",
    });

    expect(store.getTask(task.id)).toEqual(expect.objectContaining({
      planMode: true,
      executionMode: "plan",
    }));
    expect(store.updateSession(task.id, { executionMode: "orchestration" })).toEqual(expect.objectContaining({
      planMode: false,
      executionMode: "orchestration",
    }));
    expect(store.updateSession(task.id, { planMode: true })).toEqual(expect.objectContaining({
      planMode: true,
      executionMode: "plan",
    }));
    store.close();
  });

  it("clears interrupted session runs while preserving durable workflows", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Recovery",
      rootPath: "/workspace/recovery",
      outputPath: "/workspace/recovery/Pi Work",
    });
    const interrupted = store.createTask({
      workspaceId: workspace.id,
      title: "Interrupted chat",
      goal: "Recover the composer.",
    });
    const durable = store.createTask({
      workspaceId: workspace.id,
      title: "Durable workflow",
      goal: "Keep running after restart.",
    });
    const legacy = store.createTask({
      workspaceId: workspace.id,
      title: "Legacy workflow",
      goal: "Do not treat legacy state as an automatic run.",
    });
    store.updateSession(interrupted.id, { running: true });
    store.updateSession(durable.id, { status: "running", running: true });
    store.updateSession(legacy.id, { running: true });

    const durableNodeId = randomUUID();
    store.createConductorRun({
      workspaceId: workspace.id,
      taskId: durable.id,
      status: "running",
      origin: "conversation",
      spec: {
        maxParallel: 1,
        nodes: [{
          id: durableNodeId,
          key: "durable",
          title: "Durable",
          prompt: "Continue.",
          dependsOn: [],
          executionClass: "read",
          maxAttempts: 1,
        }],
      },
    });
    const legacyNodeId = randomUUID();
    store.createConductorRun({
      workspaceId: workspace.id,
      taskId: legacy.id,
      status: "running",
      origin: "legacy",
      spec: {
        maxParallel: 1,
        nodes: [{
          id: legacyNodeId,
          key: "legacy",
          title: "Legacy",
          prompt: "Remain manual.",
          dependsOn: [],
          executionClass: "read",
          maxAttempts: 1,
        }],
      },
    });

    expect(store.reconcileInterruptedSessions().map(({ id }) => id).sort()).toEqual(
      [interrupted.id, legacy.id].sort(),
    );
    expect(store.getTask(interrupted.id)?.running).toBe(false);
    expect(store.getTask(durable.id)?.running).toBe(true);
    expect(store.getTask(legacy.id)?.running).toBe(false);
    store.close();
  });

  it("returns no workflow runs for personal conversations", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Personal",
      rootPath: "/workspace/personal-chat",
      outputPath: "/workspace/personal-chat/output",
      kind: "managed",
    });
    const session = store.createTask({
      workspaceId: workspace.id,
      title: "Personal research",
      goal: "Answer directly.",
      kind: "chat",
    });

    expect(store.listTaskConductorRuns(session.id)).toEqual([]);
    expect(store.listTaskConductorRuns(randomUUID())).toEqual([]);
    store.close();
  });

  it("associates multiple directories with a workspace and bounds task working directories", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });

    expect(workspace.directories).toEqual(["/workspace/product"]);
    expect(store.addWorkspaceDirectory(workspace.id, "/workspace/docs").directories).toEqual([
      "/workspace/product",
      "/workspace/docs",
    ]);
    expect(store.createTask({
      workspaceId: workspace.id,
      title: "Docs",
      goal: "Update the docs",
      workingDirectory: "/workspace/docs/guides",
    }).workingDirectory).toBe("/workspace/docs/guides");
    expect(() => store.createTask({
      workspaceId: workspace.id,
      title: "Outside",
      goal: "Touch another project",
      workingDirectory: "/workspace/other",
    })).toThrow("associated with this workspace");

    store.close();
  });

  it("saves workspace metadata and source folders atomically", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
      directories: ["/workspace/product", "/workspace/old-docs"],
    });

    const updated = store.updateWorkspace(workspace.id, {
      name: "Product workspace",
      outputPath: "/workspace/product/Artifacts",
      directories: ["/workspace/product", "/workspace/docs"],
      expectedVersion: workspace.version,
    });

    expect(updated).toEqual(expect.objectContaining({
      name: "Product workspace",
      outputPath: "/workspace/product/Artifacts",
      directories: ["/workspace/product", "/workspace/docs"],
      version: workspace.version + 1,
    }));
    expect(store.listWorkspaceDirectories(workspace.id).map(({ path, isRoot }) => ({ path, isRoot }))).toEqual([
      { path: "/workspace/product", isRoot: true },
      { path: "/workspace/docs", isRoot: false },
    ]);
    expect(() => store.updateWorkspace(workspace.id, {
      directories: ["/workspace/docs"],
      expectedVersion: updated.version,
    })).toThrow("root directory cannot be removed");
    store.close();
  });

  it("requires plan approval before recording an artifact", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Decision brief",
      goal: "Compare supplied documents.",
    });

    expect(() => store.createArtifact({
      taskId: task.id,
      relativePath: "brief.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/brief.md",
      content: "# Brief",
    })).toThrow("approved plan");

    store.close();
  });

  it("versions plan proposals and enforces the planning execution lifecycle", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Plan mode",
      goal: "Implement versioned plans.",
    });
    const feedback = store.addMessage({
      taskId: task.id,
      role: "user",
      content: "Include migration coverage.",
    });
    const proposal = {
      title: "Version plans",
      summary: "Store each proposal as an immutable revision.",
      steps: [{
        title: "Add storage",
        detail: "Create the plan revision table and migration.",
        targets: ["packages/storage/src/schema.ts"],
        verification: ["Run storage tests"],
      }],
      assumptions: ["Keep the legacy plans table during migration."],
      sources: [{ path: "packages/storage/src/schema.ts", operation: "read" as const }],
    };

    expect(store.beginPlanning(task.id)).toEqual(expect.objectContaining({
      status: "planning",
      running: true,
    }));
    expect(store.finishPlanningClarification(task.id)).toEqual(expect.objectContaining({
      status: "planning",
      running: false,
    }));

    const first = store.savePlanRevision({
      taskId: task.id,
      proposal,
      createdFromMessageId: feedback.id,
    });
    expect(first).toEqual(expect.objectContaining({
      revision: 1,
      status: "proposed",
      parentRevisionId: null,
      createdFromMessageId: feedback.id,
    }));
    expect(store.getTask(task.id)).toEqual(expect.objectContaining({
      status: "awaiting_plan_approval",
      running: false,
    }));

    const second = store.savePlanRevision({
      taskId: task.id,
      proposal: {
        ...proposal,
        summary: "Store each proposal and preserve its approval snapshot.",
      },
      createdFromMessageId: feedback.id,
    });
    expect(second).toEqual(expect.objectContaining({
      revision: 2,
      status: "proposed",
      parentRevisionId: first.id,
    }));
    expect(store.listPlanRevisions(task.id).map(({ revision, status }) => ({ revision, status }))).toEqual([
      { revision: 1, status: "superseded" },
      { revision: 2, status: "proposed" },
    ]);
    expect(() => store.approvePlanRevision(task.id, first.id)).toThrow("latest proposed");

    const approved = store.approvePlanRevision(task.id, second.id);
    expect(approved).toEqual(expect.objectContaining({ status: "approved", approvedAt: expect.any(String) }));
    expect(store.getTask(task.id)).toEqual(expect.objectContaining({ status: "running", running: true }));
    expect(() => store.approvePlanRevision(task.id, second.id)).toThrow("latest proposed");
    expect(() => store.retryApprovedPlan(task.id, second.id)).toThrow("already executing");

    expect(store.markAwaitingActionApproval(task.id)).toEqual(expect.objectContaining({
      status: "awaiting_action_approval",
      running: true,
    }));
    expect(store.resumePlanExecution(task.id)).toEqual(expect.objectContaining({
      status: "running",
      running: true,
    }));
    expect(store.finishPlanExecutionReview(task.id)).toEqual(expect.objectContaining({
      status: "reviewing",
      running: false,
    }));
    expect(store.retryApprovedPlan(task.id, second.id)).toEqual(approved);
    expect(store.cancelPlanExecution(task.id)).toEqual(expect.objectContaining({
      status: "cancelled",
      running: false,
    }));
    expect(store.retryApprovedPlan(task.id, second.id)).toEqual(approved);
    expect(store.failPlanExecution(task.id)).toEqual(expect.objectContaining({
      status: "failed",
      running: false,
    }));

    expect(store.listEvents(task.id).map(({ type }) => type)).toEqual(expect.arrayContaining([
      "plan.superseded",
      "plan.approved",
      "plan.execution_retried",
    ]));
    store.close();
  });

  it("retires a proposed plan when execution switches to orchestration", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Analyze",
      goal: "Analyze in parallel",
      executionMode: "plan",
    });
    const plan = store.savePlanRevision({
      taskId: task.id,
      proposal: {
        title: "Analysis plan",
        summary: "Review the system before execution.",
        steps: [{
          title: "Inspect",
          detail: "Inspect the relevant modules.",
          targets: ["src"],
          verification: ["Summarize findings"],
        }],
        assumptions: [],
        sources: [],
      },
    });

    expect(store.updateSession(task.id, { executionMode: "orchestration" })).toEqual(expect.objectContaining({
      executionMode: "orchestration",
      planMode: false,
      status: "draft",
      running: false,
    }));
    expect(store.getPlanRevision(plan.id)).toEqual(expect.objectContaining({ status: "superseded" }));
    expect(store.listEvents(task.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "plan.superseded",
        payload: expect.objectContaining({ reason: "execution_mode_changed" }),
      }),
    ]));
    store.close();
  });

  it("creates immutable human-edited revisions and computes diffs from their parent", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Plan editing",
      rootPath: "/workspace/plan-editing",
      outputPath: "/workspace/plan-editing/output",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Edit a plan",
      goal: "Edit plans without mutating approved snapshots.",
    });
    const parent = store.savePlanRevision({
      taskId: task.id,
      proposal: {
        title: "Initial plan",
        summary: "Create the first proposal.",
        steps: [
          {
            title: "Inspect",
            detail: "Inspect the current implementation.",
            targets: ["packages/storage"],
            verification: ["Run storage tests"],
          },
          {
            title: "Implement",
            detail: "Implement the change.",
            targets: ["apps/desktop"],
            verification: ["Run desktop tests"],
          },
        ],
        assumptions: ["Keep compatibility."],
        sources: [{ path: "packages/storage/src/index.ts", operation: "read" }],
      },
    });
    const retainedStep = parent.steps[0]!;

    expect(() => store.saveEditedPlanRevision({
      taskId: task.id,
      parentRevisionId: parent.id,
      title: parent.title,
      summary: parent.summary,
      steps: [
        { ...retainedStep },
        { ...retainedStep },
      ],
      assumptions: parent.assumptions,
    })).toThrow("duplicate step ID");
    expect(() => store.saveEditedPlanRevision({
      taskId: task.id,
      parentRevisionId: parent.id,
      title: parent.title,
      summary: parent.summary,
      steps: [{
        ...retainedStep,
        id: randomUUID(),
      }],
      assumptions: parent.assumptions,
    })).toThrow("not part of its parent");

    const edited = store.saveEditedPlanRevision({
      taskId: task.id,
      parentRevisionId: parent.id,
      title: "Edited plan",
      summary: "Create a reviewable edited proposal.",
      steps: [
        {
          ...retainedStep,
          detail: "Inspect storage and protocol.",
          targets: [...retainedStep.targets, "packages/protocol"],
        },
        {
          title: "Verify",
          detail: "Verify the edited revision.",
          targets: ["packages/storage/src/index.test.ts"],
          verification: ["Run storage tests", "Run typecheck"],
        },
      ],
      assumptions: ["Keep compatibility.", "Approved snapshots stay immutable."],
    });

    expect(edited).toEqual(expect.objectContaining({
      revision: 2,
      status: "proposed",
      parentRevisionId: parent.id,
      sources: parent.sources,
    }));
    expect(edited.steps[0]?.id).toBe(retainedStep.id);
    expect(edited.steps[1]?.id).not.toBe(parent.steps[1]?.id);
    expect(store.getPlanRevision(parent.id)).toEqual(expect.objectContaining({ status: "superseded" }));
    expect(store.getTask(task.id)).toEqual(expect.objectContaining({
      status: "awaiting_plan_approval",
      running: false,
    }));

    const diff = store.getPlanRevisionDiff(task.id, edited.id);
    expect(diff.baseRevisionId).toBe(parent.id);
    expect(diff.fieldChanges.map(({ field }) => field)).toEqual(["title", "summary", "assumptions"]);
    expect(diff.stepChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: retainedStep.id, changes: ["changed"] }),
      expect.objectContaining({ stepId: parent.steps[1]!.id, changes: ["removed"] }),
      expect.objectContaining({ stepId: edited.steps[1]!.id, changes: ["added"] }),
    ]));

    const approved = store.approvePlanRevisionForAction(task.id, edited.id, "approve_only").revision;
    const approvedSnapshot = structuredClone(approved);
    const revisedApproved = store.saveEditedPlanRevision({
      taskId: task.id,
      parentRevisionId: approved.id,
      title: "Post-approval revision",
      summary: approved.summary,
      steps: approved.steps,
      assumptions: approved.assumptions,
    });
    expect(store.getPlanRevision(approved.id)).toEqual(approvedSnapshot);
    expect(revisedApproved).toEqual(expect.objectContaining({
      revision: 3,
      status: "proposed",
      parentRevisionId: approved.id,
    }));
    expect(() => store.saveEditedPlanRevision({
      taskId: task.id,
      parentRevisionId: approved.id,
      title: approved.title,
      summary: approved.summary,
      steps: approved.steps,
      assumptions: approved.assumptions,
    })).toThrow("Only the latest plan revision");
    store.close();
  });

  it("migrates legacy plans into readable proposed and approved revisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-plan-migration-"));
    const filename = join(directory, "legacy-plans.db");
    const store = new PiWorkStore(filename);
    const workspace = store.createWorkspace({
      name: "Legacy",
      rootPath: "/workspace/legacy",
      outputPath: "/workspace/legacy/Pi Work",
    });
    const proposedTask = store.createTask({
      workspaceId: workspace.id,
      title: "Proposed legacy plan",
      goal: "Preserve the proposal.",
    });
    const approvedTask = store.createTask({
      workspaceId: workspace.id,
      title: "Approved legacy plan",
      goal: "Preserve the approval.",
    });
    store.updateSession(approvedTask.id, { status: "reviewing", running: false });
    store.close();

    const sqlite = new Database(filename);
    const legacyPlan = (taskId: string, summary: string) => JSON.stringify({
      taskId,
      summary,
      steps: [{
        id: randomUUID(),
        title: "Legacy step",
        detail: "Keep this content readable.",
      }],
      sources: ["/workspace/legacy/README.md"],
    });
    sqlite.prepare("INSERT INTO plans (task_id, value) VALUES (?, ?)").run(
      proposedTask.id,
      legacyPlan(proposedTask.id, "Unapproved legacy content."),
    );
    sqlite.prepare("INSERT INTO plans (task_id, value) VALUES (?, ?)").run(
      approvedTask.id,
      legacyPlan(approvedTask.id, "Approved legacy content."),
    );
    sqlite.close();

    const migrated = new PiWorkStore(filename);
    expect(migrated.listPlanRevisions(proposedTask.id)).toEqual([
      expect.objectContaining({
        revision: 1,
        status: "proposed",
        summary: "Unapproved legacy content.",
        sources: [{ path: "/workspace/legacy/README.md" }],
      }),
    ]);
    expect(migrated.listPlanRevisions(approvedTask.id)).toEqual([
      expect.objectContaining({
        revision: 1,
        status: "approved",
        summary: "Approved legacy content.",
        approvedAt: expect.any(String),
      }),
    ]);
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("adds automatic workflow columns before creating their indexes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-workflow-migration-"));
    const filename = join(directory, "legacy-workflows.db");
    const sqlite = new Database(filename);
    sqlite.exec(`
      CREATE TABLE conductor_runs (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        spec TEXT NOT NULL,
        last_event_sequence INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX conductor_runs_workspace_status ON conductor_runs(workspace_id, status);
    `);
    sqlite.close();

    const migrated = new PiWorkStore(filename);
    migrated.close();

    const verified = new Database(filename);
    const columns = verified.prepare("PRAGMA table_info(conductor_runs)").all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "origin",
      "title",
      "summary",
      "dedupe_key",
      "source_request_id",
      "source_message_id",
      "plan_revision_id",
      "parent_run_id",
      "synthesis_node_id",
      "finalization_status",
      "final_message_id",
    ]));
    expect(verified.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'conductor_runs_dedupe_key'",
    ).get()).toEqual({ name: "conductor_runs_dedupe_key" });
    verified.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists a run alongside the task lifecycle", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Decision brief",
      goal: "Compare supplied documents.",
    });

    expect(store.getLatestRun(task.id)?.status).toBe("draft");
    expect(store.listRuns(task.id)).toHaveLength(1);
    expect(store.completeTask(task.id).status).toBe("completed");
    expect(store.getLatestRun(task.id)?.completedAt).not.toBeNull();

    store.close();
  });

  it("edits a message and truncates everything after it", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });

    const first = store.addMessage({ taskId: task.id, role: "user", content: "First question" });
    const reply = store.addMessage({ taskId: task.id, role: "assistant", content: "First answer" });
    store.addActivity({ sessionId: task.id, messageId: reply.id, kind: "thinking", title: "Thinking", detail: "", metadata: {} });
    store.addAttachment({ sessionId: task.id, messageId: reply.id, name: "note.txt", path: "/tmp/note.txt", mimeType: "text/plain", size: 4 });
    store.addMessage({ taskId: task.id, role: "user", content: "Second question" });

    const edited = store.editMessage(first.id, "First question, revised");
    expect(edited.content).toBe("First question, revised");

    const remaining = store.listMessages(task.id);
    expect(remaining.map(({ content }) => content)).toEqual(["First question, revised"]);
    expect(store.listActivities(task.id)).toHaveLength(0);
    expect(store.listAttachments(task.id)).toHaveLength(0);
    expect(() => store.editMessage("00000000-0000-0000-0000-000000000000", "x")).toThrow("Message not found.");
    store.close();
  });

  it("removes plans and workflow runs from the edited message branch", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });
    const first = store.addMessage({ taskId: task.id, role: "user", content: "First question" });
    store.addMessage({ taskId: task.id, role: "assistant", content: "First answer" });
    const plan = store.savePlanRevision({
      taskId: task.id,
      createdFromMessageId: first.id,
      proposal: {
        title: "Research plan",
        summary: "Inspect the workspace.",
        steps: [{
          title: "Inspect",
          detail: "Read the relevant files.",
          targets: ["src"],
          verification: ["Summarize findings"],
        }],
        assumptions: [],
        sources: [],
      },
    });
    const node = {
      id: randomUUID(),
      key: "inspect",
      title: "Inspect",
      prompt: "Inspect the workspace.",
      dependsOn: [],
      executionClass: "read" as const,
      maxAttempts: 1,
    };
    const planRun = store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      origin: "approved_plan",
      planRevisionId: plan.id,
      spec: { maxParallel: 1, nodes: [node] },
    });
    store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      origin: "legacy",
      parentRunId: planRun.id,
      spec: { maxParallel: 1, nodes: [{ ...node, id: randomUUID() }] },
    });
    store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      origin: "conversation",
      sourceMessageId: first.id,
      spec: { maxParallel: 1, nodes: [{ ...node, id: randomUUID() }] },
    });

    store.editMessage(first.id, "First question, revised");

    expect(store.listPlanRevisions(task.id)).toEqual([]);
    expect(store.listConductorRuns(workspace.id, task.id)).toEqual([]);
    store.close();
  });

  it("removes an orphaned plan left by an older message edit", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });
    const current = store.addMessage({ taskId: task.id, role: "user", content: "Current request" });
    store.savePlanRevision({
      taskId: task.id,
      createdFromMessageId: randomUUID(),
      proposal: {
        title: "Plan from the replaced message",
        summary: "This plan belongs to an old branch.",
        steps: [{
          title: "Inspect",
          detail: "Read the relevant files.",
          targets: ["src"],
          verification: ["Summarize findings"],
        }],
        assumptions: [],
        sources: [],
      },
    });

    store.editMessage(current.id, "Current request, revised");

    expect(store.listPlanRevisions(task.id)).toEqual([]);
    store.close();
  });

  it("repairs orphaned plan branches when reopening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-orphaned-plans-"));
    const filename = join(directory, "orphaned-plans.db");
    const store = new PiWorkStore(filename);
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });
    const plan = store.savePlanRevision({
      taskId: task.id,
      createdFromMessageId: randomUUID(),
      proposal: {
        title: "Orphaned plan",
        summary: "This plan has no source message.",
        steps: [{
          title: "Inspect",
          detail: "Read the relevant files.",
          targets: ["src"],
          verification: ["Summarize findings"],
        }],
        assumptions: [],
        sources: [],
      },
    });
    const node = {
      id: randomUUID(),
      key: "inspect",
      title: "Inspect",
      prompt: "Inspect the workspace.",
      dependsOn: [],
      executionClass: "read" as const,
      maxAttempts: 1,
    };
    store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      origin: "approved_plan",
      planRevisionId: plan.id,
      spec: { maxParallel: 1, nodes: [node] },
    });
    store.close();

    const repaired = new PiWorkStore(filename);
    expect(repaired.listPlanRevisions(task.id)).toEqual([]);
    expect(repaired.listConductorRuns(workspace.id, task.id)).toEqual([]);
    repaired.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the edited message's own attachments intact", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });

    const first = store.addMessage({ taskId: task.id, role: "user", content: "Look at this" });
    store.addAttachment({ sessionId: task.id, messageId: first.id, name: "image.png", path: "/tmp/image.png", mimeType: "image/png", size: 8 });
    store.addMessage({ taskId: task.id, role: "assistant", content: "Sure" });

    store.editMessage(first.id, "Look at this again");

    expect(store.listMessages(task.id).map(({ role }) => role)).toEqual(["user"]);
    expect(store.listAttachments(task.id).map(({ name }) => name)).toEqual(["image.png"]);
    store.close();
  });

  it("stores chat messages and updates a slash-command goal", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });

    store.addMessage({ taskId: task.id, role: "user", content: "Compare the options" });
    store.addMessage({ taskId: task.id, role: "assistant", content: "Which constraints matter?" });

    expect(store.listMessages(task.id).map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(store.updateTaskGoal(task.id, "Choose the safest option").goal).toBe("Choose the safest option");
    store.close();
  });

  it("stores managed conversations, model selection, and app defaults", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Chat",
      rootPath: "/tmp/pi-work-chat",
      outputPath: "/tmp/pi-work-chat/Pi Work",
      kind: "managed",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Hello",
      goal: "Hello",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "high",
      kind: "chat",
    });

    expect(store.listManagedConversations()[0]?.task.id).toBe(task.id);
    const chatSelection = {
      providerId: "openai",
      modelId: "gpt-5",
      thinkingLevel: "medium" as const,
      workspaceId: null,
    };

    expect(store.updateTaskModel(task.id, chatSelection).modelId).toBe("gpt-5");
    expect(store.getTask(task.id)?.workspaceId).toBe(workspace.id);
    expect(store.updateAppSettings({ onboardingSkipped: true }).onboardingSkipped).toBe(true);
    expect(store.getAppSettings().disabledModelKeys).toEqual([]);
    expect(store.updateAppSettings({ disabledModelKeys: ["openai/gpt-5"] }).disabledModelKeys).toEqual(["openai/gpt-5"]);
    expect(store.updateAppSettings({ modelId: "gpt-5-mini" }).disabledModelKeys).toEqual(["openai/gpt-5"]);
    expect(store.removeConversation(task.id).workspace.kind).toBe("managed");
    expect(store.getWorkspace(workspace.id)).toBeNull();
    store.close();
  });

  it("enforces the personal-session and work-folder-task matrix", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });

    expect(() => store.createTask({ workspaceId: folder.id, title: "Chat", goal: "Chat", kind: "chat" })).toThrow("private sandboxes");
    expect(() => store.createTask({ workspaceId: managed.id, title: "Task", goal: "Task", kind: "task" })).toThrow("work folders");
    expect(store.createTask({ workspaceId: folder.id, title: "Task", goal: "Task", kind: "task" }).kind).toBe("task");
    expect(store.createTask({ workspaceId: managed.id, title: "Chat", goal: "Chat", kind: "chat" }).kind).toBe("chat");
    store.close();
  });

  it("keeps workflow resources within their work folder and ignores legacy global resources", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first",
      outputPath: "/workspace/first/Pi Work",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const firstTask = store.createTask({ workspaceId: first.id, title: "First", goal: "First" });
    const secondTask = store.createTask({ workspaceId: second.id, title: "Second", goal: "Second" });
    const status = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: first.id,
      name: "Review",
      color: "#786",
      position: 0,
    });
    const label = store.createDomainEntity("label", labelSchema, {
      workspaceId: first.id,
      parentId: null,
      name: "Important",
      color: "#786",
    });
    const legacyId = randomUUID();
    const now = new Date().toISOString();
    const sqlite = (store as unknown as { sqlite: Database.Database }).sqlite;
    sqlite.prepare("INSERT INTO domain_entities (id, domain, workspace_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      legacyId,
      "source",
      null,
      JSON.stringify({
        id: legacyId,
        workspaceId: null,
        name: "Legacy source",
        type: "local",
        enabled: false,
        config: {},
        createdAt: now,
        updatedAt: now,
      }),
      now,
      now,
    );

    expect(() => store.createSource({ workspaceId: managed.id, name: "Private", type: "local", enabled: false, config: {} })).toThrow("work folder");
    expect(() => store.listSources(managed.id)).toThrow("work folder");
    expect(store.listSources(first.id)).toEqual([]);
    expect(() => store.updateSession(secondTask.id, { statusId: status.id })).toThrow("different work folder");
    expect(() => store.updateSession(secondTask.id, { labelIds: [label.id] })).toThrow("different work folder");
    expect(store.updateSession(firstTask.id, { statusId: status.id, labelIds: [label.id] })).toMatchObject({
      statusId: status.id,
      labelIds: [label.id],
    });
    store.close();
  });

  it("stores MCP servers globally while regular sources remain folder-scoped", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const mcp = store.createSource({
      workspaceId: null,
      name: "Remote tools",
      type: "mcp_http",
      enabled: true,
      config: {
        url: "https://example.com/mcp",
        transport: "streamable_http",
        headers: {},
        auth: "none",
      },
    });

    expect(store.listGlobalMcpSources()).toEqual([mcp]);
    expect(store.listSources(workspace.id)).toEqual([]);
    expect(() => store.createSource({
      workspaceId: null,
      name: "Global files",
      type: "local",
      enabled: false,
      config: {},
    })).toThrow("work folder");

    store.close();
  });

  it("promotes a personal session into a folder task without losing its history", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const personal = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const session = store.createTask({
      workspaceId: personal.id,
      title: "Research options",
      goal: "Compare the available approaches.",
      kind: "chat",
      workingDirectory: personal.rootPath,
    });
    store.addMessage({ taskId: session.id, role: "user", content: "Compare the available approaches." });
    store.addMessage({ taskId: session.id, role: "assistant", content: "I found three viable options." });
    store.addActivity({
      sessionId: session.id,
      messageId: null,
      kind: "notice",
      title: "Research complete",
      detail: "The comparison is ready.",
      metadata: {},
    });
    const attachment = store.addAttachment({
      sessionId: session.id,
      messageId: null,
      name: "notes.pdf",
      path: "/tmp/pi-work-personal/notes.pdf",
      mimeType: "application/pdf",
      size: 42,
    });
    store.savePlan({
      taskId: session.id,
      summary: "Write up the options.",
      steps: [{ id: randomUUID(), title: "Compare", detail: "Compare the candidates." }],
      sources: [],
    });
    store.approvePlan(session.id, true);
    const staged = store.createArtifact({
      taskId: session.id,
      relativePath: "comparison.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/pi-work-personal/.pi-work/runs/session/staging/comparison.md",
      content: "# Comparison",
    });
    const published = store.createArtifact({
      taskId: session.id,
      relativePath: "published.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/pi-work-personal/.pi-work/runs/session/staging/published.md",
      content: "# Published",
    });
    store.publishArtifact(published.id, "/tmp/pi-work-personal/published.md");
    store.finishPlanExecutionReview(session.id);
    store.updateSession(session.id, {
      archived: true,
      flagged: true,
      unread: true,
      planMode: false,
      workingDirectory: personal.rootPath,
    });

    const targetStagedPath = "/workspace/product/.pi-work/runs/session/staging/comparison.md";
    const result = store.promoteManagedSession({
      sessionId: session.id,
      workspaceId: folder.id,
      stagedPaths: { [staged.id]: targetStagedPath },
    });

    expect(result.session).toEqual(expect.objectContaining({
      id: session.id,
      workspaceId: folder.id,
      kind: "task",
      status: "draft",
      archived: false,
      flagged: false,
      unread: false,
      statusId: null,
      labelIds: [],
      planMode: true,
      workingDirectory: folder.rootPath,
      running: false,
    }));
    expect(store.getWorkspace(personal.id)).toBeNull();
    expect(store.listMessages(session.id)).toHaveLength(2);
    expect(store.getPlan(session.id)).toEqual(expect.objectContaining({ summary: "Write up the options." }));
    expect(store.listActivities(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Research complete" }),
    ]));
    expect(store.getAttachment(attachment.id)?.path).toBe("/tmp/pi-work-personal/notes.pdf");
    expect(store.getArtifact(staged.id)?.stagedPath).toBe(targetStagedPath);
    expect(store.getArtifact(published.id)?.publishedPath).toBe("/tmp/pi-work-personal/published.md");
    expect(store.getLatestRun(session.id)).toEqual(expect.objectContaining({ status: "draft", completedAt: null }));
    store.close();
  });

  it("rejects invalid personal-session promotions without changing data", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const personal = store.createTask({ workspaceId: managed.id, title: "Research", goal: "Research", kind: "chat" });
    const folderTask = store.createTask({ workspaceId: folder.id, title: "Implement", goal: "Implement" });
    const running = store.updateSession(personal.id, { running: true });

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: folder.id,
      stagedPaths: {},
    })).toThrow("Stop this personal session");
    expect(store.getTask(personal.id)).toEqual(running);

    expect(() => store.promoteManagedSession({
      sessionId: folderTask.id,
      workspaceId: folder.id,
      stagedPaths: {},
    })).toThrow("Only personal sessions");
    expect(store.getTask(folderTask.id)).toEqual(folderTask);

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: managed.id,
      stagedPaths: {},
    })).toThrow("requires a work folder");
    expect(store.getTask(personal.id)).toEqual(running);

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: randomUUID(),
      stagedPaths: {},
    })).toThrow("Unknown work folder");
    expect(store.getWorkspace(managed.id)?.kind).toBe("managed");
    store.close();
  });

  it("never removes a folder workspace with its conversation", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Chat", goal: "Chat" });

    store.removeConversation(task.id);
    expect(store.getWorkspace(workspace.id)?.kind).toBe("folder");
    store.close();
  });

  it("migrates legacy project tasks into their workspace and removes project storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-storage-"));
    const filename = join(directory, "legacy.db");
    const workspaceId = randomUUID();
    const taskId = randomUUID();
    const projectId = randomUUID();
    const workspaceBoardId = randomUUID();
    const projectBoardId = randomUUID();
    const workspaceColumnId = randomUUID();
    const projectColumnId = randomUUID();
    const createdAt = new Date().toISOString();
    const sqlite = new Database(filename);
    sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE domain_entities (
        id TEXT PRIMARY KEY NOT NULL,
        domain TEXT NOT NULL,
        workspace_id TEXT,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE boards (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE board_columns (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        status_ids TEXT NOT NULL DEFAULT '[]',
        drop_status_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_board_state (
        task_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (task_id, board_id)
      );
    `);
    sqlite.prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)").run(
      workspaceId,
      "Legacy",
      "/workspace/legacy",
      "/workspace/legacy/Pi Work",
      createdAt,
    );
    sqlite.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      taskId,
      workspaceId,
      projectId,
      "Existing task",
      "Keep this task",
      "draft",
      createdAt,
      createdAt,
    );
    sqlite.prepare("INSERT INTO projects VALUES (?, ?, ?)").run(projectId, workspaceId, "Legacy project");
    sqlite.prepare("INSERT INTO boards VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      workspaceBoardId, workspaceId, null, "Workspace board", "workspace", 0, createdAt, createdAt,
    );
    sqlite.prepare("INSERT INTO boards VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      projectBoardId, workspaceId, projectId, "Project board", "project", 0, createdAt, createdAt,
    );
    sqlite.prepare("INSERT INTO board_columns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      workspaceColumnId, workspaceId, workspaceBoardId, "Todo", "gray", 0, "[]", null, createdAt, createdAt,
    );
    sqlite.prepare("INSERT INTO board_columns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      projectColumnId, workspaceId, projectBoardId, "Todo", "gray", 0, "[]", null, createdAt, createdAt,
    );
    sqlite.prepare("INSERT INTO task_board_state VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      taskId, workspaceId, workspaceBoardId, workspaceColumnId, 1_024, 0, createdAt,
    );
    sqlite.prepare("INSERT INTO task_board_state VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      taskId, workspaceId, projectBoardId, projectColumnId, 1_024, 0, createdAt,
    );
    sqlite.prepare("INSERT INTO domain_entities VALUES (?, ?, ?, ?, ?, ?)").run(
      projectId,
      "project",
      workspaceId,
      JSON.stringify({ name: "Legacy project" }),
      createdAt,
      createdAt,
    );
    sqlite.close();

    const store = new PiWorkStore(filename);
    expect(store.getWorkspace(workspaceId)?.kind).toBe("folder");
    expect(store.getTask(taskId)).toEqual(expect.objectContaining({
      title: "Existing task",
      providerId: null,
      modelId: null,
      thinkingLevel: "off",
    }));
    store.close();

    const migrated = new Database(filename);
    const taskColumns = migrated.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(taskColumns.map(({ name }) => name)).not.toContain("project_id");
    expect(migrated.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId)).toEqual({ id: taskId });
    expect(migrated.prepare("SELECT domain FROM domain_entities WHERE id = ?").get(projectId)).toBeUndefined();
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()).toBeUndefined();
    expect(migrated.prepare("SELECT id FROM boards").all()).toEqual([{ id: workspaceBoardId }]);
    expect(migrated.prepare("SELECT id FROM board_columns").all()).toEqual([{ id: workspaceColumnId }]);
    expect(migrated.prepare("SELECT board_id FROM task_board_state").all()).toEqual([{ board_id: workspaceBoardId }]);
    const boardColumns = migrated.prepare("PRAGMA table_info(boards)").all() as Array<{ name: string }>;
    expect(boardColumns.map(({ name }) => name)).not.toContain("project_id");
    expect(boardColumns.map(({ name }) => name)).not.toContain("kind");
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("searches session metadata and message content while preserving session controls", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const session = store.createTask({
      workspaceId: workspace.id,
      title: "Desktop parity",
      goal: "Implement the application shell",
      permissionMode: "explore",
    });
    store.addMessage({ taskId: session.id, role: "user", content: "Build a searchable kanban board" });
    const updated = store.updateSession(session.id, { status: "reviewing", flagged: true, archived: true, permissionMode: "auto" });

    expect(updated).toEqual(expect.objectContaining({ status: "reviewing", flagged: true, archived: true, permissionMode: "auto" }));
    expect(store.listSessions({ query: "kanban" }).map(({ id }) => id)).toEqual([session.id]);
    expect(store.listSessions({ archived: true }).map(({ id }) => id)).toEqual([session.id]);
    store.close();
  });

  it("keeps session search scoped to a work folder", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first",
      outputPath: "/workspace/first/Pi Work",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/Pi Work",
    });
    const matching = store.createTask({ workspaceId: first.id, title: "First", goal: "First" });
    const excluded = store.createTask({ workspaceId: second.id, title: "Second", goal: "Second" });
    store.addMessage({ taskId: matching.id, role: "user", content: "shared search phrase" });
    store.addMessage({ taskId: excluded.id, role: "user", content: "shared search phrase" });

    expect(store.listSessions({ workspaceId: first.id, query: "shared" }).map(({ id }) => id)).toEqual([matching.id]);
    store.close();
  });

  it("stores sources, skills, automations, activities, and attachments", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const session = store.createTask({ workspaceId: workspace.id, title: "Ship", goal: "Ship" });
    expect(store.createSource({
      workspaceId: workspace.id,
      name: "Repository",
      type: "local",
      enabled: true,
      config: { path: workspace.rootPath },
    }).type).toBe("local");
    expect(store.createSkill({
      workspaceId: workspace.id,
      name: "Reviewer",
      description: "",
      instructions: "Review changes.",
      enabled: true,
    }).enabled).toBe(true);
    expect(store.createAutomation({
      workspaceId: workspace.id,
      name: "Daily review",
      enabled: false,
      trigger: { type: "schedule", cron: "0 9 * * 1-5" },
      action: { type: "send_prompt", sessionId: session.id, prompt: "Review progress" },
      lastRunAt: null,
    }).trigger.type).toBe("schedule");
    store.addActivity({
      sessionId: session.id,
      messageId: null,
      kind: "tool_call",
      title: "read",
      detail: "Read package.json",
      metadata: {},
    });
    const attachment = store.addAttachment({
      sessionId: session.id,
      messageId: null,
      name: "brief.pdf",
      path: "/workspace/product/brief.pdf",
      mimeType: "application/pdf",
      size: 42,
    });

    expect(store.listSources(workspace.id)).toHaveLength(1);
    expect(store.listSkills(workspace.id)).toHaveLength(1);
    expect(store.listAutomations(workspace.id)).toHaveLength(1);
    expect(store.listActivities(session.id)).toHaveLength(1);
    expect(store.listAttachments(session.id)).toHaveLength(1);
    expect(store.getAttachment(attachment.id)?.path).toBe("/workspace/product/brief.pdf");
    store.removeConversation(session.id);
    expect(store.getAttachment(attachment.id)).toBeNull();
    store.close();
  });

  it("aggregates model usage into totals, by-model and by-day summaries", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const base = {
      taskId: "task-1",
      workspaceId: workspace.id,
      requestId: "req-1",
      messageId: null,
      responseModel: null,
      api: null,
      stopReason: null,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
    };
    store.recordModelUsage({
      ...base,
      provider: "anthropic",
      model: "claude",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      totalCost: 0.3,
    });
    store.recordModelUsage({
      ...base,
      provider: "anthropic",
      model: "claude",
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      totalCost: 0.6,
    });
    store.recordModelUsage({
      ...base,
      provider: "openai",
      model: "gpt",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      totalCost: 0.05,
    });

    const summary = store.usageSummary();
    expect(summary.totals.requests).toBe(3);
    expect(summary.totals.totalTokens).toBe(465);
    expect(summary.totals.totalCost).toBeCloseTo(0.95, 5);
    // Ordered by total cost descending: claude (0.9) then gpt (0.05).
    expect(summary.byModel).toHaveLength(2);
    expect(summary.byModel[0]?.model).toBe("claude");
    expect(summary.byModel[0]?.requests).toBe(2);
    expect(summary.byModel[0]?.totalCost).toBeCloseTo(0.9, 5);
    expect(summary.byModel[1]?.model).toBe("gpt");
    expect(summary.byDay).toHaveLength(1);
    expect(summary.byDay[0]?.totalTokens).toBe(465);

    // Filtering by a different workspace yields empty aggregates.
    const empty = store.usageSummary({ since: null, until: null, workspaceId: "other" });
    expect(empty.totals.requests).toBe(0);
    expect(empty.totals.totalCost).toBe(0);
    expect(empty.byModel).toHaveLength(0);
    store.close();
  });

  it("stores and retries telemetry outbox entries and drops them when delivered", () => {
    const store = new PiWorkStore();
    const future = "2999-01-01T00:00:00.000Z";
    store.enqueueTelemetry("{\"a\":1}");
    store.enqueueTelemetry("{\"b\":2}", future);
    expect(store.countTelemetryOutbox()).toBe(2);

    // Only entries whose next attempt is due are returned.
    const due = store.listDueTelemetry();
    expect(due).toHaveLength(1);
    expect(due[0]?.payload).toBe("{\"a\":1}");
    expect(due[0]?.attempts).toBe(0);

    // Recording a retry defers it into the future so it is no longer due now.
    store.markTelemetryRetry(due[0]!.id, 1, future);
    expect(store.listDueTelemetry()).toHaveLength(0);
    expect(store.countTelemetryOutbox()).toBe(2);

    store.deleteTelemetry(due[0]!.id);
    expect(store.countTelemetryOutbox()).toBe(1);
    store.close();
  });

  it("persists observability config with defaults and partial updates", () => {
    const store = new PiWorkStore();
    expect(store.getObservabilityConfig()).toEqual({
      enabled: false,
      host: "",
      publicKey: "",
      captureContent: true,
    });
    const updated = store.setObservabilityConfig({ enabled: true, host: "https://lf.example.com" });
    expect(updated.enabled).toBe(true);
    expect(updated.host).toBe("https://lf.example.com");
    expect(updated.captureContent).toBe(true);
    // Partial update leaves prior values intact.
    store.setObservabilityConfig({ publicKey: "pk-lf-1" });
    const reloaded = store.getObservabilityConfig();
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.host).toBe("https://lf.example.com");
    expect(reloaded.publicKey).toBe("pk-lf-1");
    store.close();
  });

  it("enforces canonical workspace directory ownership and protects the root", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first/../shared",
      outputPath: "/workspace/shared/output",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/output",
    });
    expect(() => store.addWorkspaceDirectory(second.id, "/workspace/shared")).toThrow("another workspace");
    const root = store.listWorkspaceDirectories(first.id).find(({ isRoot }) => isRoot);
    expect(root).toBeDefined();
    expect(() => store.removeWorkspaceDirectory(first.id, root!.id)).toThrow("root directory");
    store.close();
  });

  it("keeps workflow status separate from durable board placement and makes moves idempotent", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product-board",
      outputPath: "/workspace/product-board/output",
    });
    const todo = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: workspace.id,
      name: "To do",
      color: "#888",
      position: 0,
      category: "open",
    });
    const done = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: workspace.id,
      name: "Done",
      color: "#484",
      position: 1,
      category: "closed",
    });
    const createdTask = store.createTask({ workspaceId: workspace.id, title: "Ship", goal: "Ship it" });
    const task = store.updateSession(createdTask.id, { statusId: todo.id });
    const initial = store.getBoardSnapshot(workspace.id);
    const target = initial.columns.find(({ dropStatusId }) => dropStatusId === done.id)!;
    const state = initial.states.find(({ taskId }) => taskId === task.id)!;
    const commandId = randomUUID();
    const moved = store.moveBoardCard({
      commandId,
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: target.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    });
    expect(moved.states.find(({ taskId }) => taskId === task.id)?.columnId).toBe(target.id);
    expect(store.getTask(task.id)?.statusId).toBe(done.id);
    expect(store.moveBoardCard({
      commandId,
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: target.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    })).toEqual(moved);
    expect(() => store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: initial.columns[0]!.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    })).toThrow("another command");
    store.close();
  });

  it("uses one workspace board for every task", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/project-boards",
      outputPath: "/workspace/project-boards/output",
    });
    const boards = store.listBoards(workspace.id);
    expect(boards).toHaveLength(1);
    const task = store.createTask({ workspaceId: workspace.id, title: "Task", goal: "Do it" });
    expect(store.getBoardSnapshot(workspace.id, boards[0]!.id).states.some(({ taskId }) => taskId === task.id)).toBe(true);
    store.close();
  });

  it("places board cards before and after exact neighboring tasks", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Ordered board",
      rootPath: "/workspace/ordered-board",
      outputPath: "/workspace/ordered-board/output",
    });
    const first = store.createTask({ workspaceId: workspace.id, title: "First", goal: "First" });
    const second = store.createTask({ workspaceId: workspace.id, title: "Second", goal: "Second" });
    const third = store.createTask({ workspaceId: workspace.id, title: "Third", goal: "Third" });
    const initial = store.getBoardSnapshot(workspace.id);
    const columnId = initial.columns[0]!.id;
    const thirdState = initial.states.find(({ taskId }) => taskId === third.id)!;

    const before = store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: third.id,
      toColumnId: columnId,
      beforeTaskId: first.id,
      afterTaskId: null,
      expectedVersion: thirdState.version,
    });
    expect(before.states.filter(({ columnId: id }) => id === columnId).map(({ taskId }) => taskId))
      .toEqual([third.id, first.id, second.id]);

    const firstState = before.states.find(({ taskId }) => taskId === first.id)!;
    const after = store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: first.id,
      toColumnId: columnId,
      beforeTaskId: null,
      afterTaskId: second.id,
      expectedVersion: firstState.version,
    });
    expect(after.states.filter(({ columnId: id }) => id === columnId).map(({ taskId }) => taskId))
      .toEqual([third.id, second.id, first.id]);
    store.close();
  });

  it("persists conductor dependencies, leases, retries, and pause state", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/conductor",
      outputPath: "/workspace/conductor/output",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Research", goal: "Synthesize" });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const run = store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      spec: {
        maxParallel: 2,
        nodes: [
          { id: firstId, title: "Collect", prompt: "Collect facts", dependsOn: [], maxAttempts: 2 },
          { id: secondId, title: "Write", prompt: "Write result", dependsOn: [firstId], maxAttempts: 1 },
        ],
      },
    });
    const initialStates = new Map(store.listConductorNodeStates(workspace.id, run.id).map((state) => [state.nodeId, state.status]));
    expect(initialStates.get(firstId)).toBe("ready");
    expect(initialStates.get(secondId)).toBe("pending");
    expect(store.claimConductorRun(workspace.id, run.id, "owner-a").leaseOwner).toBe("owner-a");
    expect(() => store.claimConductorRun(workspace.id, run.id, "owner-b")).toThrow("leased");
    store.updateConductorNodeState(workspace.id, run.id, firstId, {
      status: "completed",
      attempt: 1,
      output: "facts",
      completedAt: new Date().toISOString(),
    });
    expect(store.listConductorNodeStates(workspace.id, run.id).find(({ nodeId }) => nodeId === secondId)?.status).toBe("ready");
    expect(store.updateConductorRunStatus(workspace.id, run.id, "paused").status).toBe("paused");
    store.close();
  });

  it("deduplicates automatic workflows and finalizes their published result once", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Automatic workflows",
      rootPath: "/workspace/automatic-workflows",
      outputPath: "/workspace/automatic-workflows/output",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Research", goal: "Run a workflow" });
    const message = store.addMessage({ taskId: task.id, role: "user", content: "Compare both modules in parallel." });
    const synthesisNodeId = randomUUID();
    const dedupeKey = `workflow:${randomUUID()}`;
    const input = {
      workspaceId: workspace.id,
      taskId: task.id,
      origin: "conversation" as const,
      title: "Compare modules",
      summary: "Inspect both modules and synthesize the result.",
      dedupeKey,
      sourceRequestId: randomUUID(),
      sourceMessageId: message.id,
      synthesisNodeId,
      spec: {
        maxParallel: 2,
        nodes: [{
          id: synthesisNodeId,
          key: "synthesis",
          title: "Synthesis",
          prompt: "Summarize.",
          dependsOn: [],
          executionClass: "read" as const,
          maxAttempts: 1,
        }],
      },
    };

    const first = store.createConductorRunOnce(input);
    const duplicate = store.createConductorRunOnce(input);
    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ run: first.run, created: false });
    expect(store.getConductorRun(workspace.id, first.run.id)).toEqual(expect.objectContaining({
      origin: "conversation",
      title: "Compare modules",
      summary: "Inspect both modules and synthesize the result.",
      dedupeKey,
      sourceMessageId: message.id,
      synthesisNodeId,
      finalizationStatus: "pending",
    }));

    expect(store.claimConductorRunFinalization(workspace.id, first.run.id)).toBe(true);
    expect(store.claimConductorRunFinalization(workspace.id, first.run.id)).toBe(false);
    const finalMessage = store.addMessage({ taskId: task.id, role: "assistant", content: "Final synthesis." });
    expect(store.completeConductorRunFinalization(
      workspace.id,
      first.run.id,
      "published",
      finalMessage.id,
    )).toEqual(expect.objectContaining({
      finalizationStatus: "published",
      finalMessageId: finalMessage.id,
    }));
    expect(store.claimConductorRunFinalization(workspace.id, first.run.id)).toBe(false);
    store.close();
  });

  it("publishes a workflow result and task state atomically and idempotently", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Workflow result",
      rootPath: "/workspace/workflow-result",
      outputPath: "/workspace/workflow-result/output",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Research", goal: "Publish once" });
    const nodeId = randomUUID();
    const run = store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      status: "running",
      origin: "conversation",
      title: "Research workflow",
      synthesisNodeId: nodeId,
      spec: {
        maxParallel: 1,
        nodes: [{
          id: nodeId,
          key: "synthesis",
          title: "Synthesis",
          prompt: "Summarize.",
          dependsOn: [],
          executionClass: "read",
          maxAttempts: 1,
        }],
      },
    });
    store.updateConductorRunStatus(workspace.id, run.id, "completed");

    const first = store.finalizeConductorRunResult(workspace.id, run.id, "Final synthesis.");
    const duplicate = store.finalizeConductorRunResult(workspace.id, run.id, "Duplicate synthesis.");

    expect(first.finalizationStatus).toBe("published");
    expect(duplicate.finalMessageId).toBe(first.finalMessageId);
    expect(store.listMessages(task.id).filter(({ role }) => role === "assistant")).toEqual([
      expect.objectContaining({ id: first.finalMessageId, content: "Final synthesis." }),
    ]);
    expect(store.getTask(task.id)).toEqual(expect.objectContaining({
      status: "reviewing",
      running: false,
    }));
    store.close();
  });

  it("persists node attempts and their agent event stream", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Execution history",
      rootPath: "/workspace/execution-history",
      outputPath: "/workspace/execution-history/output",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Trace", goal: "Keep node activity" });
    const nodeId = randomUUID();
    const run = store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      spec: {
        maxParallel: 1,
        nodes: [{ id: nodeId, title: "Trace node", prompt: "Trace", dependsOn: [], maxAttempts: 2 }],
      },
    });
    const executionId = randomUUID();
    const startedAt = new Date().toISOString();

    store.updateConductorNodeState(workspace.id, run.id, nodeId, {
      status: "running",
      attempt: 1,
      executionId,
      startedAt,
    });
    store.createConductorNodeAttempt({
      workspaceId: workspace.id,
      runId: run.id,
      nodeId,
      attempt: 1,
      executionId,
      startedAt,
    });
    expect(store.appendConductorNodeEvent({
      executionId,
      sequence: 1,
      kind: "thinking",
      payload: { phase: "delta", delta: "Inspecting." },
      createdAt: startedAt,
    })).toBe(true);
    expect(store.appendConductorNodeEvent({
      executionId: randomUUID(),
      sequence: 1,
      kind: "text_delta",
      payload: { delta: "Ignored" },
      createdAt: startedAt,
    })).toBe(false);
    store.updateConductorNodeAttempt(workspace.id, executionId, {
      status: "completed",
      output: "Done.",
      completedAt: new Date().toISOString(),
    });

    expect(store.listConductorNodeAttempts(workspace.id, run.id)).toEqual([expect.objectContaining({
      nodeId,
      attempt: 1,
      executionId,
      status: "completed",
      output: "Done.",
      events: [expect.objectContaining({ kind: "thinking", payload: { phase: "delta", delta: "Inspecting." } })],
    })]);
    store.close();
  });

  it("orders workspace and task event sequences numerically beyond ten events", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Events",
      rootPath: "/workspace/events",
      outputPath: "/workspace/events/output",
    });
    for (let index = 0; index < 12; index += 1) {
      store.updateWorkspace(workspace.id, { name: `Events ${index}` });
    }
    const task = store.createTask({ workspaceId: workspace.id, title: "Events", goal: "Test ordering" });
    for (let index = 0; index < 12; index += 1) {
      store.updateSession(task.id, { title: `Task ${index}` });
    }
    const workspaceSequences = store.listWorkspaceEvents(workspace.id).map(({ sequence }) => sequence);
    expect(workspaceSequences).toEqual(Array.from({ length: workspaceSequences.length }, (_, index) => index));
    expect(workspaceSequences.at(-1)).toBeGreaterThan(10);
    const sequences = store.listEvents(task.id).map(({ sequence }) => sequence);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(sequences.at(-1)).toBeGreaterThan(10);
    store.close();
  });
});
