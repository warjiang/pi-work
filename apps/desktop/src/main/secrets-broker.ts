import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const secretsFileSchema = z.object({
  langfuseSecretKey: z.string().optional(),
});

/**
 * Stores observability secrets outside SQLite. The workspace database can be
 * shared (see README), so the Langfuse secret key lives in a private
 * `agentDir/langfuse.json` written with mode 0600, mirroring CredentialBroker's
 * handling of provider auth. Values are only ever written, never returned to the
 * renderer — callers receive a mask instead.
 */
export class SecretsBroker {
  private readonly secretsPath: string;

  constructor(agentDir: string) {
    this.secretsPath = join(agentDir, "langfuse.json");
  }

  async getLangfuseSecretKey(): Promise<string | null> {
    const records = await this.read();
    const value = records.langfuseSecretKey?.trim();
    return value === undefined || value.length === 0 ? null : value;
  }

  async setLangfuseSecretKey(value: string | null): Promise<void> {
    const records = await this.read();
    if (value === null || value.trim().length === 0) {
      delete records.langfuseSecretKey;
    } else {
      records.langfuseSecretKey = value.trim();
    }
    await this.write(records);
  }

  private async read(): Promise<z.infer<typeof secretsFileSchema>> {
    try {
      return secretsFileSchema.parse(JSON.parse(await readFile(this.secretsPath, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      return {};
    }
  }

  private async write(records: z.infer<typeof secretsFileSchema>): Promise<void> {
    await mkdir(dirname(this.secretsPath), { recursive: true });
    await writeFile(this.secretsPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

/** Masks a secret so only its shape and last characters survive (`sk-lf-••••4b79`). */
export function maskSecret(value: string | null): string {
  if (value === null) return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const tail = trimmed.slice(-4);
  const prefixMatch = trimmed.match(/^(sk-lf-|pk-lf-)/);
  const prefix = prefixMatch === null ? "" : prefixMatch[1];
  return `${prefix}••••${tail}`;
}

/** Redacts Langfuse keys from arbitrary log text so pi-console output stays safe. */
export function redactSecrets(text: string): string {
  return text.replace(/(sk|pk)-lf-[A-Za-z0-9-]+/g, (match) => maskSecret(match));
}
