import { contextBridge, ipcRenderer } from "electron";
const piWork = {
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    list: () => ipcRenderer.invoke("workspace:list")
  },
  task: {
    list: (workspaceId) => ipcRenderer.invoke("task:list", workspaceId),
    create: (input) => ipcRenderer.invoke("task:create", input),
    plan: (taskId) => ipcRenderer.invoke("task:plan", taskId),
    approvePlan: (input) => ipcRenderer.invoke("task:approve-plan", input),
    abort: (input) => ipcRenderer.invoke("task:abort", input)
  },
  artifact: {
    list: (taskId) => ipcRenderer.invoke("artifact:list", taskId),
    create: (input) => ipcRenderer.invoke("artifact:create", input),
    publish: (input) => ipcRenderer.invoke("artifact:publish", input)
  }
};
contextBridge.exposeInMainWorld("piWork", piWork);
