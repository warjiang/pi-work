import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import { z } from "zod";
import {
  providerConfigSchema,
  setProviderCredentialInputSchema,
} from "@pi-work/protocol";
import type { ProviderConfig } from "@pi-work/protocol";

const credentialRecordSchema = z.record(z.string(), setProviderCredentialInputSchema);
const legacyCredentialRecordSchema = z.record(
  z.string(),
  setProviderCredentialInputSchema.extend({ modelId: z.string().trim().min(1).optional() }),
);

export class CredentialBroker {
  constructor(private readonly credentialPath: string) {}

  async list(): Promise<ProviderConfig[]> {
    const records = await this.read();
    return Object.values(records).map((record) => providerConfigSchema.parse(record));
  }

  async get(providerId: string): Promise<z.infer<typeof setProviderCredentialInputSchema> | null> {
    const records = await this.read();
    const credential = records[providerId];
    return credential === undefined ? null : setProviderCredentialInputSchema.parse(credential);
  }

  async save(input: unknown): Promise<ProviderConfig> {
    const credential = setProviderCredentialInputSchema.parse(input);
    const records = await this.read();
    records[credential.providerId] = credential;
    await this.write(records);
    return providerConfigSchema.parse(credential);
  }

  async remove(providerId: string): Promise<void> {
    const records = await this.read();
    delete records[providerId];
    await this.write(records);
  }

  async migrateLegacyDefault(): Promise<{ providerId: string; modelId: string } | null> {
    const records = await this.readLegacy();
    const legacy = Object.values(records).find((record) => record.modelId !== undefined);
    if (legacy === undefined || legacy.modelId === undefined) {
      return null;
    }
    await this.write(Object.fromEntries(
      Object.entries(records).map(([providerId, record]) => [
        providerId,
        setProviderCredentialInputSchema.parse(record),
      ]),
    ));
    return { providerId: legacy.providerId, modelId: legacy.modelId };
  }

  private async write(records: Record<string, z.infer<typeof setProviderCredentialInputSchema>>): Promise<void> {
    await mkdir(dirname(this.credentialPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(records)).toString("base64");
    await writeFile(this.credentialPath, encrypted, { encoding: "utf8", mode: 0o600 });
  }

  private async read(): Promise<Record<string, z.infer<typeof setProviderCredentialInputSchema>>> {
    return credentialRecordSchema.parse(await this.readLegacy());
  }

  private async readLegacy(): Promise<z.infer<typeof legacyCredentialRecordSchema>> {
    try {
      const encrypted = await readFile(this.credentialPath, "utf8");
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      return legacyCredentialRecordSchema.parse(JSON.parse(decrypted));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }
}
