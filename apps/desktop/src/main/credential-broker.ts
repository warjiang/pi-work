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
    await mkdir(dirname(this.credentialPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(records)).toString("base64");
    await writeFile(this.credentialPath, encrypted, { encoding: "utf8", mode: 0o600 });
    return providerConfigSchema.parse(credential);
  }

  private async read(): Promise<Record<string, z.infer<typeof setProviderCredentialInputSchema>>> {
    try {
      const encrypted = await readFile(this.credentialPath, "utf8");
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      return credentialRecordSchema.parse(JSON.parse(decrypted));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }
}
