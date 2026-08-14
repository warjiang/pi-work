#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "pi-work-test-mcp",
  version: "1.0.0",
});

server.registerTool("echo", {
  title: "Echo text",
  description: "Returns the supplied text with the configured prefix.",
  inputSchema: {
    text: z.string(),
  },
  outputSchema: {
    echoed: z.string(),
  },
}, async ({ text }) => {
  const echoed = `${process.env.PI_WORK_MCP_PREFIX ?? "echo"}:${text}`;
  return {
    content: [{ type: "text", text: echoed }],
    structuredContent: { echoed },
  };
});

await server.connect(new StdioServerTransport());
