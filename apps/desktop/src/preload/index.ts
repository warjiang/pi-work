import { contextBridge, ipcRenderer } from "electron";

const piWork = {
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    list: () => ipcRenderer.invoke("workspace:list"),
  },
  provider: {
    list: () => ipcRenderer.invoke("provider:list"),
    save: (input: unknown) => ipcRenderer.invoke("provider:save", input),
    remove: (providerId: string) => ipcRenderer.invoke("provider:remove", providerId),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (input: unknown) => ipcRenderer.invoke("settings:update", input),
  },
  extension: {
    list: () => ipcRenderer.invoke("extension:list"),
    install: (source: string) => ipcRenderer.invoke("extension:install", source),
    remove: (source: string) => ipcRenderer.invoke("extension:remove", source),
    chooseLocal: (kind: "file" | "directory") => ipcRenderer.invoke("extension:choose-local", kind),
  },
  model: {
    list: () => ipcRenderer.invoke("model:list"),
  },
  conversation: {
    list: () => ipcRenderer.invoke("conversation:list"),
    updateModel: (input: unknown) => ipcRenderer.invoke("conversation:update-model", input),
    remove: (input: unknown) => ipcRenderer.invoke("conversation:remove", input),
  },
  task: {
    list: (workspaceId: string) => ipcRenderer.invoke("task:list", workspaceId),
    create: (input: unknown) => ipcRenderer.invoke("task:create", input),
    plan: (taskId: string) => ipcRenderer.invoke("task:plan", taskId),
    approvePlan: (input: unknown) => ipcRenderer.invoke("task:approve-plan", input),
    abort: (input: unknown) => ipcRenderer.invoke("task:abort", input),
    complete: (input: unknown) => ipcRenderer.invoke("task:complete", input),
    resume: (input: unknown) => ipcRenderer.invoke("task:resume", input),
  },
  chat: {
    list: (taskId: string) => ipcRenderer.invoke("chat:list", taskId),
    send: (input: unknown) => ipcRenderer.invoke("chat:send", input),
    onToolApproval: (listener: (approval: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, approval: unknown) => listener(approval);
      ipcRenderer.on("chat:tool-approval", handler);
      return () => ipcRenderer.removeListener("chat:tool-approval", handler);
    },
    resolveToolApproval: (input: unknown) => ipcRenderer.invoke("chat:resolve-tool-approval", input),
  },
  artifact: {
    list: (taskId: string) => ipcRenderer.invoke("artifact:list", taskId),
    create: (input: unknown) => ipcRenderer.invoke("artifact:create", input),
    publish: (input: unknown) => ipcRenderer.invoke("artifact:publish", input),
  },
};

contextBridge.exposeInMainWorld("piWork", piWork);
