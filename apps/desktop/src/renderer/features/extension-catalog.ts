export type ExtensionCatalogCategory = "automation" | "development" | "integration" | "productivity";

export type ExtensionCatalogItem = {
  id: string;
  source: string;
  packageName: string;
  category: ExtensionCatalogCategory;
  author: string;
  officialUrl: string;
  name: { en: string; "zh-CN": string };
  summary: { en: string; "zh-CN": string };
  description: { en: string; "zh-CN": string };
};

export const extensionCatalog: ExtensionCatalogItem[] = [
  {
    id: "pi-mcp-adapter",
    source: "npm:pi-mcp-adapter",
    packageName: "pi-mcp-adapter",
    category: "integration",
    author: "nicopreme",
    officialUrl: "https://pi.dev/packages/pi-mcp-adapter",
    name: { en: "MCP adapter", "zh-CN": "MCP 适配器" },
    summary: { en: "Connect Model Context Protocol servers to Pi.", "zh-CN": "将 Model Context Protocol 服务接入 Pi。" },
    description: { en: "Add tools and context from MCP servers to your Pi workflow.", "zh-CN": "为 Pi 工作流接入 MCP 服务提供的工具和上下文。" },
  },
  {
    id: "pi-web-access",
    source: "npm:pi-web-access",
    packageName: "pi-web-access",
    category: "integration",
    author: "nicopreme",
    officialUrl: "https://pi.dev/packages/pi-web-access",
    name: { en: "Web access", "zh-CN": "网页访问" },
    summary: { en: "Search, fetch pages, inspect PDFs, and understand web content.", "zh-CN": "搜索与抓取网页、解析 PDF，并理解网络内容。" },
    description: { en: "Give Pi focused web research tools with support for multiple search providers.", "zh-CN": "为 Pi 提供聚焦的网页研究能力，并支持多个搜索服务。" },
  },
  {
    id: "pi-subagents",
    source: "npm:pi-subagents",
    packageName: "pi-subagents",
    category: "automation",
    author: "nicopreme",
    officialUrl: "https://pi.dev/packages/pi-subagents",
    name: { en: "Subagents", "zh-CN": "子代理" },
    summary: { en: "Delegate focused work to coordinated Pi subagents.", "zh-CN": "将聚焦任务委派给协作式 Pi 子代理。" },
    description: { en: "Coordinate parallel task work while keeping the main conversation focused.", "zh-CN": "协调并行任务，同时保持主对话专注。" },
  },
  {
    id: "pi-lens",
    source: "npm:pi-lens",
    packageName: "pi-lens",
    category: "development",
    author: "apmantza",
    officialUrl: "https://pi.dev/packages/pi-lens",
    name: { en: "Pi Lens", "zh-CN": "Pi Lens" },
    summary: { en: "Run code-quality feedback through LSPs, linters, and type checks.", "zh-CN": "通过 LSP、Linter 与类型检查获得代码质量反馈。" },
    description: { en: "Surface structural issues and development feedback while Pi works in your project.", "zh-CN": "在 Pi 处理项目时提供结构问题与开发反馈。" },
  },
  {
    id: "pi-crew",
    source: "npm:pi-crew",
    packageName: "pi-crew",
    category: "automation",
    author: "Pi community",
    officialUrl: "https://pi.dev/packages/pi-crew",
    name: { en: "Pi Crew", "zh-CN": "Pi Crew" },
    summary: { en: "Coordinate teams, workflows, worktrees, and asynchronous tasks.", "zh-CN": "协调团队、工作流、工作树与异步任务。" },
    description: { en: "Organize larger pieces of work across multiple coordinated Pi agents.", "zh-CN": "在多个协作 Pi Agent 之间组织更大规模的工作。" },
  },
  {
    id: "pi-ssh-remote",
    source: "npm:pi-ssh-remote",
    packageName: "pi-ssh-remote",
    category: "integration",
    author: "Pi community",
    officialUrl: "https://pi.dev/packages/pi-ssh-remote",
    name: { en: "Remote SSH", "zh-CN": "远程 SSH" },
    summary: { en: "Work with persistent remote SSH workspaces.", "zh-CN": "使用持久化的远程 SSH 工作空间。" },
    description: { en: "Bring a remote development environment into your Pi workflow.", "zh-CN": "将远程开发环境带入 Pi 工作流。" },
  },
  {
    id: "rpiv-ask-user-question",
    source: "npm:@juicesharp/rpiv-ask-user-question",
    packageName: "@juicesharp/rpiv-ask-user-question",
    category: "productivity",
    author: "juicesharp",
    officialUrl: "https://pi.dev/packages/@juicesharp/rpiv-ask-user-question",
    name: { en: "Ask user question", "zh-CN": "向用户提问" },
    summary: { en: "Present structured questions when Pi needs a decision.", "zh-CN": "当 Pi 需要决策时展示结构化问题。" },
    description: { en: "Replace guesswork with typed choices and clear answers during a task.", "zh-CN": "在任务中用明确选项与答案替代猜测。" },
  },
  {
    id: "rpiv-todo",
    source: "npm:@juicesharp/rpiv-todo",
    packageName: "@juicesharp/rpiv-todo",
    category: "productivity",
    author: "juicesharp",
    officialUrl: "https://pi.dev/packages/@juicesharp/rpiv-todo",
    name: { en: "Persistent todo", "zh-CN": "持久待办" },
    summary: { en: "Keep a task checklist visible across reloads and compaction.", "zh-CN": "在重载和上下文压缩后仍保留任务清单。" },
    description: { en: "Track task progress in a lightweight overlay that survives long sessions.", "zh-CN": "在可跨长会话保留的轻量浮层中跟踪任务进度。" },
  },
  {
    id: "piolium",
    source: "npm:@vigolium/piolium",
    packageName: "@vigolium/piolium",
    category: "development",
    author: "j3ssie",
    officialUrl: "https://pi.dev/packages/@vigolium/piolium",
    name: { en: "Piolium", "zh-CN": "Piolium" },
    summary: { en: "Run multi-phase security audits with specialist subagents.", "zh-CN": "使用专业子代理执行多阶段安全审计。" },
    description: { en: "Coordinate isolated audit passes with capped concurrency and resumable state.", "zh-CN": "协调隔离的审计流程，控制并发并支持恢复。" },
  },
];

export function normalizeExtensionSource(source: string): string {
  const value = source.trim();
  if (!value.startsWith("npm:")) return value;

  const packageSpec = value.slice("npm:".length);
  if (packageSpec.startsWith("@")) {
    const versionIndex = packageSpec.indexOf("@", 1);
    return `npm:${versionIndex === -1 ? packageSpec : packageSpec.slice(0, versionIndex)}`;
  }

  const versionIndex = packageSpec.indexOf("@");
  return `npm:${versionIndex === -1 ? packageSpec : packageSpec.slice(0, versionIndex)}`;
}

export function isCatalogExtensionInstalled(source: string, installedSources: Iterable<string>): boolean {
  const normalized = normalizeExtensionSource(source);
  return Array.from(installedSources, normalizeExtensionSource).includes(normalized);
}
