import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Artifact, Task, Workspace } from "@pi-work/protocol";
import { Button } from "./components/ui/button.js";
import { useWorkspaceUi } from "./store.js";

function artifactDraft(task: Task): string {
  return `# ${task.title}\n\n## Goal\n\n${task.goal}\n\n## Decision summary\n\nAdd approved findings here.\n`;
}

export function App() {
  const queryClient = useQueryClient();
  const { selectedWorkspaceId, selectedTaskId, selectWorkspace, selectTask } = useWorkspaceUi();
  const [taskTitle, setTaskTitle] = useState("");
  const [taskGoal, setTaskGoal] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => window.piWork.workspace.list(),
  });
  const tasks = useQuery({
    queryKey: ["tasks", selectedWorkspaceId],
    queryFn: () => window.piWork.task.list(selectedWorkspaceId ?? ""),
    enabled: selectedWorkspaceId !== null,
  });
  const task = tasks.data?.find((candidate) => candidate.id === selectedTaskId) ?? null;
  const plan = useQuery({
    queryKey: ["plan", selectedTaskId],
    queryFn: () => window.piWork.task.plan(selectedTaskId ?? ""),
    enabled: selectedTaskId !== null,
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", selectedTaskId],
    queryFn: () => window.piWork.artifact.list(selectedTaskId ?? ""),
    enabled: selectedTaskId !== null,
  });

  useEffect(() => {
    const firstWorkspace = workspaces.data?.[0];
    if (firstWorkspace !== undefined && selectedWorkspaceId === null) {
      selectWorkspace(firstWorkspace.id);
    }
  }, [selectWorkspace, selectedWorkspaceId, workspaces.data]);

  useEffect(() => {
    const firstTask = tasks.data?.[0];
    if (firstTask !== undefined && selectedTaskId === null) {
      selectTask(firstTask.id);
    }
  }, [selectTask, selectedTaskId, tasks.data]);

  const chooseWorkspace = useMutation({
    mutationFn: () => window.piWork.workspace.choose(),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (workspace !== null) {
        selectWorkspace(workspace.id);
      }
    },
  });

  const createTask = useMutation({
    mutationFn: () => {
      if (selectedWorkspaceId === null) {
        throw new Error("Choose a workspace before creating a task.");
      }
      return window.piWork.task.create({
        workspaceId: selectedWorkspaceId,
        title: taskTitle,
        goal: taskGoal,
      });
    },
    onSuccess: async (newTask) => {
      setTaskTitle("");
      setTaskGoal("");
      selectTask(newTask.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", selectedWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["plan", newTask.id] }),
      ]);
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const approvePlan = useMutation({
    mutationFn: (approved: boolean) => {
      if (selectedTaskId === null) {
        throw new Error("Choose a task before approving a plan.");
      }
      return window.piWork.task.approvePlan({ taskId: selectedTaskId, approved });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks", selectedWorkspaceId] });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const createArtifact = useMutation({
    mutationFn: () => {
      if (task === null) {
        throw new Error("Choose a task before creating an artifact.");
      }
      return window.piWork.artifact.create({
        taskId: task.id,
        relativePath: "decision-brief.md",
        content: artifactDraft(task),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["artifacts", selectedTaskId] });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const publishArtifact = useMutation({
    mutationFn: (artifact: Artifact) => window.piWork.artifact.publish({ artifactId: artifact.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["artifacts", selectedTaskId] });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const abortTask = useMutation({
    mutationFn: () => {
      if (selectedTaskId === null) {
        throw new Error("Choose a task before cancelling.");
      }
      return window.piWork.task.abort({ taskId: selectedTaskId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks", selectedWorkspaceId] });
    },
  });

  function submitTask(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrorMessage(null);
    createTask.mutate();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <div>
            <h1>Pi Work</h1>
            <p>Local-first agent workspace</p>
          </div>
        </div>

        <section>
          <div className="section-heading">
            <h2>Workspaces</h2>
            <Button aria-label="Choose workspace" variant="secondary" onClick={() => chooseWorkspace.mutate()}>+</Button>
          </div>
          <WorkspaceList
            workspaces={workspaces.data ?? []}
            selectedId={selectedWorkspaceId}
            onSelect={selectWorkspace}
          />
        </section>

        <section>
          <div className="section-heading">
            <h2>Tasks</h2>
          </div>
          <TaskList tasks={tasks.data ?? []} selectedId={selectedTaskId} onSelect={selectTask} />
        </section>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">APPROVAL-LED WORKFLOW</p>
            <h2>{task?.title ?? "Start with an approved workspace"}</h2>
          </div>
          {task !== null && task.status !== "completed" && task.status !== "cancelled" ? (
            <Button variant="danger" onClick={() => abortTask.mutate()}>Cancel task</Button>
          ) : null}
        </header>

        {errorMessage !== null ? <p className="error">{errorMessage}</p> : null}

        {selectedWorkspaceId === null ? (
          <section className="empty-state">
            <h3>Select a local workspace</h3>
            <p>Pi Work only reads and publishes within the folder you explicitly choose.</p>
            <Button onClick={() => chooseWorkspace.mutate()}>Choose workspace</Button>
          </section>
        ) : (
          <form className="task-form" onSubmit={submitTask}>
            <label>
              Task title
              <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Decision brief" required />
            </label>
            <label>
              Goal
              <textarea value={taskGoal} onChange={(event) => setTaskGoal(event.target.value)} placeholder="Turn the selected sources into a concise decision brief." required />
            </label>
            <Button disabled={createTask.isPending} type="submit">
              {createTask.isPending ? "Planning…" : "Create a planned task"}
            </Button>
          </form>
        )}

        {task !== null ? (
          <section className="timeline">
            <StatusBanner task={task} />
            {plan.data !== null && plan.data !== undefined ? (
              <article className="card">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">PROPOSED PLAN</p>
                    <h3>{plan.data.summary}</h3>
                  </div>
                  {task.status === "awaiting_plan_approval" ? (
                    <div className="actions">
                      <Button variant="secondary" onClick={() => approvePlan.mutate(false)}>Request revision</Button>
                      <Button onClick={() => approvePlan.mutate(true)}>Approve plan</Button>
                    </div>
                  ) : null}
                </div>
                <ol className="plan-steps">
                  {plan.data.steps.map((step) => (
                    <li key={step.id}>
                      <strong>{step.title}</strong>
                      <span>{step.detail}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ) : null}

            {task.status === "running" ? (
              <article className="card action-card">
                <div>
                  <p className="eyebrow">STAGING</p>
                  <h3>Create the first reviewable artifact</h3>
                  <p>The artifact remains in staging until you explicitly publish it.</p>
                </div>
                <Button disabled={createArtifact.isPending} onClick={() => createArtifact.mutate()}>
                  {createArtifact.isPending ? "Creating…" : "Create decision brief"}
                </Button>
              </article>
            ) : null}
          </section>
        ) : null}
      </section>

      <aside className="inspector">
        <div className="section-heading">
          <h2>Artifacts</h2>
          <span>{artifacts.data?.length ?? 0}</span>
        </div>
        <ArtifactList artifacts={artifacts.data ?? []} onPublish={(artifact) => publishArtifact.mutate(artifact)} />
      </aside>
    </main>
  );
}

function WorkspaceList({
  workspaces,
  selectedId,
  onSelect,
}: {
  workspaces: Workspace[];
  selectedId: string | null;
  onSelect(workspaceId: string): void;
}) {
  return (
    <div className="nav-list">
      {workspaces.map((workspace) => (
        <button
          className={workspace.id === selectedId ? "nav-item selected" : "nav-item"}
          key={workspace.id}
          onClick={() => onSelect(workspace.id)}
        >
          <span>{workspace.name}</span>
          <small>{workspace.rootPath}</small>
        </button>
      ))}
    </div>
  );
}

function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect(taskId: string): void;
}) {
  return (
    <div className="nav-list">
      {tasks.map((task) => (
        <button
          className={task.id === selectedId ? "nav-item selected" : "nav-item"}
          key={task.id}
          onClick={() => onSelect(task.id)}
        >
          <span>{task.title}</span>
          <small className={`status ${task.status}`}>{task.status.replaceAll("_", " ")}</small>
        </button>
      ))}
    </div>
  );
}

function StatusBanner({ task }: { task: Task }) {
  const messages: Record<Task["status"], string> = {
    draft: "The task is ready to be planned.",
    planning: "Pi is preparing a read-only plan.",
    awaiting_plan_approval: "The plan is ready. Approval is required before Pi can create an artifact.",
    running: "The plan is approved. Pi can create reviewable artifacts in staging.",
    awaiting_action_approval: "An action is awaiting your approval.",
    reviewing: "Artifacts are ready for review.",
    completed: "The task is complete.",
    failed: "The task failed. Review the event history before retrying.",
    cancelled: "This task was cancelled. No further writes are allowed.",
  };

  return <p className={`status-banner ${task.status}`}>{messages[task.status]}</p>;
}

function ArtifactList({
  artifacts,
  onPublish,
}: {
  artifacts: Artifact[];
  onPublish(artifact: Artifact): void;
}) {
  if (artifacts.length === 0) {
    return <p className="muted">Reviewable outputs will appear here.</p>;
  }

  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <article className="artifact" key={artifact.id}>
          <div>
            <strong>{artifact.relativePath}</strong>
            <p>{artifact.publishedPath === null ? "Staged for review" : "Published"}</p>
          </div>
          <pre>{artifact.content}</pre>
          {artifact.publishedPath === null ? <Button onClick={() => onPublish(artifact)}>Publish</Button> : null}
        </article>
      ))}
    </div>
  );
}
