# Pi Work

Pi Work is a local-first desktop app for turning approved research in a work folder into reviewable artifacts.

The first delivered vertical slice supports:

1. Select an authorized work folder.
2. Create a task and submit a structured plan.
3. Approve that plan before any artifact write.
4. Create a staged Markdown artifact.
5. Review its content and publish it into `Pi Work/<task>/`.

All renderer-to-main communication is schema-validated. The renderer cannot access Node APIs, writes are path-boundary checked, and the utility process hosting the Pi runtime is isolated from Electron main.

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

`pnpm evals` writes test evidence to `evals/.evidence/tape.jsonl`.

## MCP sources

Pi Work can connect MCP servers from **Sources** and exposes the enabled tools to the agent. The source editor also supports connection inspection, tool discovery, and manual tool calls.

### Local stdio

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
  "env": {},
  "cwd": "/optional/working/directory"
}
```

The workspace directory is used as `cwd` when it is omitted. Source environment variables are merged with the app and session environments.

### Remote Streamable HTTP or SSE

```json
{
  "url": "https://example.com/mcp",
  "transport": "auto",
  "headers": {},
  "auth": "none"
}
```

`transport` may be `auto`, `streamable_http`, or `sse`. Auto mode tries Streamable HTTP first and then legacy SSE. For a static token, use `"auth": "bearer"` with `"bearerToken": "..."`.

### Notion OAuth

```json
{
  "url": "https://mcp.notion.com/mcp",
  "transport": "auto",
  "headers": {},
  "auth": "oauth"
}
```

Save the source, choose **Authorize**, complete the browser flow, then use **Connect & inspect**. OAuth client data and tokens are stored in the app data directory as `mcp-oauth.json` with user-only file permissions. Static bearer tokens and custom authorization headers remain part of the source configuration, so avoid sharing the workspace database when those fields contain secrets.
