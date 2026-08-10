import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import type { Plan } from "@pi-work/protocol";
import {
  agentResponseSchema,
  abortTaskInputSchema,
  approvePlanInputSchema,
  artifactSchema,
  createArtifactInputSchema,
  createTaskInputSchema,
  createWorkspaceInputSchema,
  planSchema,
  publishArtifactInputSchema,
  taskSchema,
  workspaceSchema,
} from "@pi-work/protocol";
import { stageArtifact, publishArtifact } from "@pi-work/artifacts";
import { PiWorkStore } from "@pi-work/storage";

let mainWindow: BrowserWindow | null = null;
let store: PiWorkStore;
let agentProcess: UtilityProcess | null = null;

function applicationDatabasePath(): string {
  return join(app.getPath("userData"), "pi-work.db");
}

function getStore(): PiWorkStore {
  if (store === undefined) {
    store = new PiWorkStore(applicationDatabasePath());
  }
  return store;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL === undefined) {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  } else {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  }
}

function getAgentProcess(): UtilityProcess {
  if (agentProcess !== null) {
    return agentProcess;
  }

  agentProcess = utilityProcess.fork(join(__dirname, "agent-service.js"));
  agentProcess.once("exit", () => {
    agentProcess = null;
  });
  return agentProcess;
}

async function generatePlan(task: { id: string; title: string; goal: string }): Promise<Plan> {
  const response = await new Promise<unknown>((resolve, reject) => {
    const process = getAgentProcess();
    const timer = setTimeout(() => reject(new Error("Pi planning service timed out.")), 10_000);
    process.once("message", (event) => {
      clearTimeout(timer);
      resolve(event.data);
    });
    process.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Pi planning service exited before responding."));
    });
    process.postMessage({ type: "plan", task });
  });
  const parsed = agentResponseSchema.parse(response);
  if (parsed.type === "error") {
    throw new Error(parsed.message);
  }
  if (parsed.type !== "plan") {
    throw new Error("Pi planning service returned an unexpected response.");
  }
  return parsed.plan;
}

function registerIpc(): void {
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a Pi Work workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) {
      return null;
    }

    const rootPath = result.filePaths[0];
    if (rootPath === undefined) {
      return null;
    }
    const workspace = createWorkspaceInputSchema.parse({
      name: basename(rootPath),
      rootPath,
    });
    const outputPath = join(rootPath, "Pi Work");
    await mkdir(outputPath, { recursive: true });
    return workspaceSchema.parse(getStore().createWorkspace({ ...workspace, outputPath }));
  });

  ipcMain.handle("workspace:list", () => getStore().listWorkspaces().map((workspace) => workspaceSchema.parse(workspace)));
  ipcMain.handle("task:list", (_event, workspaceId: unknown) => getStore().listTasks(String(workspaceId)).map((task) => taskSchema.parse(task)));
  ipcMain.handle("task:create", async (_event, input: unknown) => {
    const parsed = createTaskInputSchema.parse(input);
    const task = getStore().createTask(parsed);
    getStore().savePlan(await generatePlan(task));
    return taskSchema.parse(getStore().getTask(task.id));
  });
  ipcMain.handle("task:plan", (_event, taskId: unknown) => {
    const plan = getStore().getPlan(String(taskId));
    return plan === null ? null : planSchema.parse(plan);
  });
  ipcMain.handle("task:approve-plan", (_event, input: unknown) => {
    const parsed = approvePlanInputSchema.parse(input);
    return taskSchema.parse(getStore().approvePlan(parsed.taskId, parsed.approved));
  });
  ipcMain.handle("task:abort", (_event, input: unknown) => {
    const parsed = abortTaskInputSchema.parse(input);
    return taskSchema.parse(getStore().cancelTask(parsed.taskId));
  });
  ipcMain.handle("artifact:list", (_event, taskId: unknown) => getStore().listArtifacts(String(taskId)).map((artifact) => artifactSchema.parse(artifact)));
  ipcMain.handle("artifact:create", async (_event, input: unknown) => {
    const parsed = createArtifactInputSchema.parse(input);
    const task = getStore().getTask(parsed.taskId);
    if (task === null) {
      throw new Error("Task not found.");
    }
    const workspace = getStore().listWorkspaces().find((candidate) => candidate.id === task.workspaceId);
    if (workspace === undefined) {
      throw new Error("Workspace not found.");
    }
    const stagedPath = await stageArtifact(workspace, task, parsed);
    return artifactSchema.parse(getStore().createArtifact({ ...parsed, stagedPath }));
  });
  ipcMain.handle("artifact:publish", async (_event, input: unknown) => {
    const parsed = publishArtifactInputSchema.parse(input);
    const artifact = getStore().getArtifact(parsed.artifactId);
    if (artifact === null) {
      throw new Error("Artifact not found.");
    }
    const task = getStore().getTask(artifact.taskId);
    if (task === null) {
      throw new Error("Task not found.");
    }
    const workspace = getStore().listWorkspaces().find((candidate) => candidate.id === task.workspaceId);
    if (workspace === undefined) {
      throw new Error("Workspace not found.");
    }
    const publishedPath = await publishArtifact(workspace, task, artifact);
    return artifactSchema.parse(getStore().publishArtifact(artifact.id, publishedPath));
  });
}

app.whenReady().then(() => {
  getStore();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  store?.close();
  agentProcess?.kill();
});
