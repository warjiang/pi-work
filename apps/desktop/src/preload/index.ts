import { contextBridge, ipcRenderer } from "electron";

const piWork = {
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    list: () => ipcRenderer.invoke("workspace:list"),
  },
  task: {
    list: (workspaceId: string) => ipcRenderer.invoke("task:list", workspaceId),
    create: (input: unknown) => ipcRenderer.invoke("task:create", input),
    plan: (taskId: string) => ipcRenderer.invoke("task:plan", taskId),
    approvePlan: (input: unknown) => ipcRenderer.invoke("task:approve-plan", input),
    abort: (input: unknown) => ipcRenderer.invoke("task:abort", input),
  },
  artifact: {
    list: (taskId: string) => ipcRenderer.invoke("artifact:list", taskId),
    create: (input: unknown) => ipcRenderer.invoke("artifact:create", input),
    publish: (input: unknown) => ipcRenderer.invoke("artifact:publish", input),
  },
};

contextBridge.exposeInMainWorld("piWork", piWork);
