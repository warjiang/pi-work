import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Source } from "@pi-work/protocol";
import { mcpHttpConfigSchema } from "@pi-work/protocol";
import { z } from "zod";

const oauthRecordSchema = z.object({
  clientInformation: z.unknown().optional(),
  tokens: z.unknown().optional(),
  codeVerifier: z.string().optional(),
});
const oauthRecordsSchema = z.record(z.string(), oauthRecordSchema);
type OAuthRecord = z.infer<typeof oauthRecordSchema>;

export class McpOAuthManager {
  constructor(
    private readonly storagePath: string,
    private readonly openExternal: (url: string) => Promise<unknown>,
  ) {}

  async authorize(source: Source): Promise<string> {
    const config = this.requireOAuthSource(source);
    await this.remove(source.id);
    const oauthState = `${source.id}:${randomUUID()}`;
    const callback = await createCallbackServer(oauthState);
    const provider = new StoredOAuthProvider(
      callback.redirectUrl,
      oauthState,
      await this.readRecord(source.id),
      (record) => this.writeRecord(source.id, record),
      async (url) => {
        await this.openExternal(url.toString());
      },
    );
    const transport = createOAuthTransport(config.url, config.transport, config.headers, provider);
    const client = new Client({ name: "pi-work", version: "0.1.0" }, { capabilities: {} });
    try {
      try {
        await client.connect(transport as any);
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
        const code = await callback.code;
        await transport.finishAuth(code);
        const retryTransport = createOAuthTransport(config.url, config.transport, config.headers, provider);
        await client.connect(retryTransport as any);
      }
      const token = (await provider.tokens())?.access_token;
      if (!token) throw new Error("The MCP authorization server did not return an access token.");
      return token;
    } finally {
      callback.close();
      await client.close().catch(() => undefined);
    }
  }

  async accessToken(source: Source): Promise<string | null> {
    const config = this.requireOAuthSource(source);
    const record = await this.readRecord(source.id);
    if (record.tokens === undefined) return null;
    const provider = new StoredOAuthProvider(
      "http://127.0.0.1/callback",
      randomUUID(),
      record,
      (next) => this.writeRecord(source.id, next),
      () => {
        throw new Error(`MCP source "${source.name}" needs authorization.`);
      },
    );
    const transport = createOAuthTransport(config.url, config.transport, config.headers, provider);
    const client = new Client({ name: "pi-work", version: "0.1.0" }, { capabilities: {} });
    try {
      await client.connect(transport as any);
      return (await provider.tokens())?.access_token ?? null;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await this.remove(source.id);
        return null;
      }
      throw error;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async status(source: Source): Promise<boolean> {
    this.requireOAuthSource(source);
    const record = await this.readRecord(source.id);
    const tokens = record.tokens;
    return typeof tokens === "object"
      && tokens !== null
      && "access_token" in tokens
      && typeof tokens.access_token === "string"
      && tokens.access_token.length > 0;
  }

  async remove(sourceId: string): Promise<void> {
    const records = await this.readAll();
    delete records[sourceId];
    await this.writeAll(records);
  }

  private requireOAuthSource(source: Source) {
    if (source.type !== "mcp_http") throw new Error("OAuth is only available for remote MCP sources.");
    const config = mcpHttpConfigSchema.parse(source.config);
    if (config.auth !== "oauth") throw new Error("Set this remote MCP source to OAuth before authorizing.");
    return config;
  }

  private async readRecord(sourceId: string): Promise<OAuthRecord> {
    return (await this.readAll())[sourceId] ?? {};
  }

  private async writeRecord(sourceId: string, record: OAuthRecord): Promise<void> {
    const records = await this.readAll();
    records[sourceId] = record;
    await this.writeAll(records);
  }

  private async readAll(): Promise<Record<string, OAuthRecord>> {
    try {
      return oauthRecordsSchema.parse(JSON.parse(await readFile(this.storagePath, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeAll(records: Record<string, OAuthRecord>): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.storagePath, 0o600);
  }
}

class StoredOAuthProvider implements OAuthClientProvider {
  private record: OAuthRecord;

  constructor(
    readonly redirectUrl: string,
    private readonly oauthState: string,
    record: OAuthRecord,
    private readonly persist: (record: OAuthRecord) => Promise<void>,
    private readonly redirect: (url: URL) => void | Promise<void>,
  ) {
    this.record = record;
  }

  get clientMetadata() {
    return {
      client_name: "Pi Work",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      software_id: "pi-work",
      software_version: "0.1.0",
    };
  }

  state(): string {
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.record.clientInformation as OAuthClientInformationMixed | undefined;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.record.clientInformation = clientInformation;
    await this.persist(this.record);
  }

  tokens(): OAuthTokens | undefined {
    return this.record.tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.record.tokens = tokens;
    await this.persist(this.record);
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    return this.redirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.record.codeVerifier = codeVerifier;
    await this.persist(this.record);
  }

  codeVerifier(): string {
    if (!this.record.codeVerifier) throw new Error("No MCP OAuth code verifier is available.");
    return this.record.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") delete this.record.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.record.tokens;
    if (scope === "all" || scope === "verifier") delete this.record.codeVerifier;
    await this.persist(this.record);
  }
}

function createOAuthTransport(
  url: string,
  transport: "auto" | "streamable_http" | "sse",
  configuredHeaders: Record<string, string>,
  provider: OAuthClientProvider,
) {
  const requestInit = { headers: new Headers(configuredHeaders) };
  return transport === "sse"
    ? new SSEClientTransport(new URL(url), { authProvider: provider, requestInit })
    : new StreamableHTTPClientTransport(new URL(url), { authProvider: provider, requestInit });
}

async function createCallbackServer(expectedState: string): Promise<{
  redirectUrl: string;
  code: Promise<string>;
  close(): void;
}> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  let timeout: NodeJS.Timeout;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const error = url.searchParams.get("error");
    const authorizationCode = url.searchParams.get("code");
    if (error) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end(`MCP authorization failed: ${error}`);
      rejectCode(new Error(`MCP authorization failed: ${error}`));
      return;
    }
    if (!authorizationCode) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Missing authorization code.");
      return;
    }
    if (url.searchParams.get("state") !== expectedState) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid OAuth state.");
      rejectCode(new Error("MCP authorization failed because the OAuth state did not match."));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<h1>Pi Work connected</h1><p>You can close this window and return to Pi Work.</p>");
    clearTimeout(timeout);
    resolveCode(authorizationCode);
  });
  timeout = setTimeout(() => {
    rejectCode(new Error("MCP authorization timed out after 5 minutes."));
    server.close();
  }, 5 * 60_000);
  timeout.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not start the local MCP OAuth callback.");
  }
  return {
    redirectUrl: `http://127.0.0.1:${address.port}/callback`,
    code,
    close: () => {
      clearTimeout(timeout);
      server.close();
    },
  };
}
