import { contextBridge, ipcRenderer, webUtils } from "electron";

const piWork = {
  workspace: {
    choose: () => ipcRenderer.invoke("workspace:choose"),
    list: () => ipcRenderer.invoke("workspace:list"),
    addDirectory: (workspaceId: string) => ipcRenderer.invoke("workspace:add-directory", { workspaceId }),
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
  system: {
    openExternal: (url: string) => ipcRenderer.invoke("system:open-external", { url }),
    info: () => ipcRenderer.invoke("system:info"),
  },
  extension: {
    list: () => ipcRenderer.invoke("extension:list"),
    install: (source: string) => ipcRenderer.invoke("extension:install", source),
    remove: (source: string) => ipcRenderer.invoke("extension:remove", source),
    chooseLocal: (kind: "file" | "directory") => ipcRenderer.invoke("extension:choose-local", kind),
  },
  piConsole: {
    start: (input: { cwd?: string } = {}) => ipcRenderer.invoke("pi-console:start", input),
    write: (data: string) => ipcRenderer.invoke("pi-console:write", data),
    resize: (dimensions: { cols: number; rows: number }) => ipcRenderer.invoke("pi-console:resize", dimensions),
    snapshot: () => ipcRenderer.invoke("pi-console:snapshot"),
    execute: (input: unknown) => ipcRenderer.invoke("pi-console:execute", input),
    restart: (input: { cwd?: string } = {}) => ipcRenderer.invoke("pi-console:restart", input),
    close: () => ipcRenderer.invoke("pi-console:close"),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
      ipcRenderer.on("pi-console:event", handler);
      return () => ipcRenderer.removeListener("pi-console:event", handler);
    },
  },
  model: {
    list: () => ipcRenderer.invoke("model:list"),
  },
  conversation: {
    list: () => ipcRenderer.invoke("conversation:list"),
    updateModel: (input: unknown) => ipcRenderer.invoke("conversation:update-model", input),
    remove: (input: unknown) => ipcRenderer.invoke("conversation:remove", input),
  },
  session: {
    list: (input: unknown = {}) => ipcRenderer.invoke("session:list", input),
    create: (input: unknown) => ipcRenderer.invoke("session:create", input),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
    update: (input: unknown) => ipcRenderer.invoke("session:update", input),
    remove: (sessionId: string) => ipcRenderer.invoke("session:remove", { sessionId }),
    messages: (sessionId: string) => ipcRenderer.invoke("session:messages", sessionId),
    activities: (sessionId: string) => ipcRenderer.invoke("session:activities", sessionId),
    attachments: (sessionId: string) => ipcRenderer.invoke("session:attachments", sessionId),
    stop: (sessionId: string) => ipcRenderer.invoke("session:stop", sessionId),
    promote: (input: unknown) => ipcRenderer.invoke("session:promote", input),
  },
  agent: {
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.removeListener("agent:event", handler);
    },
  },
  attachment: {
    choose: () => ipcRenderer.invoke("attachment:choose"),
    fromFiles: (files: File[]) => ipcRenderer.invoke("attachment:inspect", files.map((file) => webUtils.getPathForFile(file))),
    fromClipboardImage: (input: { mimeType: string; bytes: Uint8Array }) => ipcRenderer.invoke("attachment:from-clipboard", input),
    previewDraft: (input: unknown) => ipcRenderer.invoke("attachment:preview-draft", input),
    preview: (attachmentId: string) => ipcRenderer.invoke("attachment:preview", attachmentId),
    open: (attachmentId: string) => ipcRenderer.invoke("attachment:open", attachmentId),
  },
  task: {
    list: (workspaceId: string) => ipcRenderer.invoke("task:list", workspaceId),
    create: (input: unknown) => ipcRenderer.invoke("task:create", input),
    getPlan: (taskId: string) => ipcRenderer.invoke("task:plan", taskId),
    generatePlan: (input: unknown) => ipcRenderer.invoke("task:generate-plan", input),
    updateBrief: (input: unknown) => ipcRenderer.invoke("task:update-brief", input),
    approvePlan: (input: unknown) => ipcRenderer.invoke("task:approve-plan", input),
    abort: (input: unknown) => ipcRenderer.invoke("task:abort", input),
    complete: (input: unknown) => ipcRenderer.invoke("task:complete", input),
    resume: (input: unknown) => ipcRenderer.invoke("task:resume", input),
  },
  chat: {
    list: (taskId: string) => ipcRenderer.invoke("chat:list", taskId),
    toolApprovals: (taskId?: string) => ipcRenderer.invoke("chat:tool-approvals", taskId),
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
  status: domainApi("status"),
  label: domainApi("label"),
  source: domainApi("source"),
  skill: {
    list: () => ipcRenderer.invoke("skill:list"),
    listFiles: (id: string) => ipcRenderer.invoke("skill:list-files", { id }),
    scanSystem: () => ipcRenderer.invoke("skill:scan-system"),
    create: (input: unknown) => ipcRenderer.invoke("skill:create", input),
    update: (input: unknown) => ipcRenderer.invoke("skill:update", input),
    remove: (id: string) => ipcRenderer.invoke("skill:remove", { id }),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("skill:set-enabled", { id, enabled }),
    import: (path: string) => ipcRenderer.invoke("skill:import", { path }),
    chooseImport: () => ipcRenderer.invoke("skill:choose-import"),
  },
  automation: domainApi("automation"),
  browser: {
    open: (url: string) => ipcRenderer.invoke("browser:open", { url }),
    navigate: (url: string) => ipcRenderer.invoke("browser:navigate", { url }),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke("browser:bounds", bounds),
    back: () => ipcRenderer.invoke("browser:back"),
    forward: () => ipcRenderer.invoke("browser:forward"),
    reload: () => ipcRenderer.invoke("browser:reload"),
    openExternal: () => ipcRenderer.invoke("browser:external"),
    close: () => ipcRenderer.invoke("browser:close"),
    onState: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("browser:state", handler);
      return () => ipcRenderer.removeListener("browser:state", handler);
    },
  },
};

contextBridge.exposeInMainWorld("piWork", piWork);

function domainApi(name: "status" | "label" | "source" | "skill" | "automation") {
  return {
    list: (workspaceId: string) => ipcRenderer.invoke(`${name}:list`, workspaceId),
    create: (input: unknown) => ipcRenderer.invoke(`${name}:create`, input),
    update: (input: unknown) => ipcRenderer.invoke(`${name}:update`, input),
    remove: (id: string) => ipcRenderer.invoke(`${name}:remove`, { id }),
  };
}
