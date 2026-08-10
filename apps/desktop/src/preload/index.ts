import { contextBridge, ipcRenderer } from "electron";

const piWork = {
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    list: () => ipcRenderer.invoke("workspace:list"),
  },
  provider: {
    list: () => ipcRenderer.invoke("provider:list"),
    save: (input: unknown) => ipcRenderer.invoke("provider:save", input),
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
  artifact: {
    list: (taskId: string) => ipcRenderer.invoke("artifact:list", taskId),
    create: (input: unknown) => ipcRenderer.invoke("artifact:create", input),
    publish: (input: unknown) => ipcRenderer.invoke("artifact:publish", input),
  },
};

contextBridge.exposeInMainWorld("piWork", piWork);
