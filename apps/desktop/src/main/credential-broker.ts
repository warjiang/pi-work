import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { z } from "zod";
import {
  providerConfigSchema,
  setProviderCredentialInputSchema,
} from "@pi-work/protocol";
import type { ProviderConfig } from "@pi-work/protocol";

const legacyCredentialRecordSchema = z.record(
  z.string(),
  setProviderCredentialInputSchema.extend({ modelId: z.string().trim().min(1).optional() }),
);
const storedAuthSchema = z.record(z.string(), z.unknown());
const apiKeyCredentialSchema = z.object({
  type: z.literal("api_key"),
  key: z.string().min(1),
});

/**
 * Keeps Pi Work Settings and the bundled Pi runtime on the exact same private
 * auth.json file. credentials.enc is read only once for migration and is never
 * consulted at runtime afterwards.
 */
export class CredentialBroker {
  private readonly authPath: string;
  private readonly legacyMigrationPath: string;

  constructor(
    agentDir: string,
    private readonly legacyCredentialPath = join(dirname(agentDir), "credentials.enc"),
  ) {
    this.authPath = join(agentDir, "auth.json");
    this.legacyMigrationPath = join(agentDir, "credentials.enc.migrated");
  }

  async list(): Promise<ProviderConfig[]> {
    const records = await this.readAuth();
    return Object.entries(records).flatMap(([providerId, value]) => {
      const credential = apiKeyCredentialSchema.safeParse(value);
      return credential.success
        ? [providerConfigSchema.parse({ providerId, apiKey: credential.data.key })]
        : [];
    });
  }

  async get(providerId: string): Promise<z.infer<typeof setProviderCredentialInputSchema> | null> {
    const credential = apiKeyCredentialSchema.safeParse((await this.readAuth())[providerId]);
    return credential.success
      ? setProviderCredentialInputSchema.parse({ providerId, apiKey: credential.data.key })
      : null;
  }

  async save(input: unknown): Promise<ProviderConfig> {
    const credential = setProviderCredentialInputSchema.parse(input);
    const records = await this.readAuth();
    records[credential.providerId] = { type: "api_key", key: credential.apiKey };
    await this.writeAuth(records);
    return providerConfigSchema.parse(credential);
  }

  async remove(providerId: string): Promise<void> {
    const records = await this.readAuth();
    delete records[providerId];
    await this.writeAuth(records);
  }

  async migrateLegacyDefault(): Promise<{ providerId: string; modelId: string } | null> {
    if (await this.hasMigratedLegacyCredentials()) return null;
    const legacy = await this.readLegacy();
    const auth = await this.readAuth();
    for (const record of Object.values(legacy)) {
      if (auth[record.providerId] === undefined) {
        auth[record.providerId] = { type: "api_key", key: record.apiKey };
      }
    }
    if (Object.keys(legacy).length > 0) await this.writeAuth(auth);
    await mkdir(dirname(this.legacyMigrationPath), { recursive: true });
    await writeFile(this.legacyMigrationPath, "migrated\n", { encoding: "utf8", mode: 0o600 });
    const defaultRecord = Object.values(legacy).find((record) => record.modelId !== undefined);
    return defaultRecord?.modelId === undefined
      ? null
      : { providerId: defaultRecord.providerId, modelId: defaultRecord.modelId };
  }

  private async writeAuth(records: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.authPath), { recursive: true });
    await writeFile(this.authPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async readAuth(): Promise<Record<string, unknown>> {
    try {
      return storedAuthSchema.parse(JSON.parse(await readFile(this.authPath, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  private async readLegacy(): Promise<z.infer<typeof legacyCredentialRecordSchema>> {
    try {
      const encrypted = await readFile(this.legacyCredentialPath, "utf8");
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      return legacyCredentialRecordSchema.parse(JSON.parse(decrypted));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  private async hasMigratedLegacyCredentials(): Promise<boolean> {
    try {
      await access(this.legacyMigrationPath);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }
}
