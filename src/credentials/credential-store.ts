import * as fs from 'fs';
import * as path from 'path';

/**
 * Abstraction for storing and retrieving API keys.
 *
 * MVP uses local files with 0o600 permissions. The interface is designed
 * to be replaced by system Keychain in a future phase.
 */
export interface CredentialStore {
  get(providerId: string): Promise<string | null>;
  set(providerId: string, apiKey: string): Promise<void>;
  delete(providerId: string): Promise<void>;
}

export class FileCredentialStore implements CredentialStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.join(baseDir, 'auth', 'api');
  }

  private filePath(providerId: string): string {
    return path.join(this.baseDir, `${providerId}.json`);
  }

  async get(providerId: string): Promise<string | null> {
    try {
      const filePath = this.filePath(providerId);
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data.api_key ?? null;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    await fs.promises.mkdir(this.baseDir, { recursive: true });
    const filePath = this.filePath(providerId);
    const data = JSON.stringify({ api_key: apiKey, updated_at: new Date().toISOString() }, null, 2);
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });
  }

  async delete(providerId: string): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath(providerId));
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  }
}
