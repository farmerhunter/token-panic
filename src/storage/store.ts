import * as fs from 'fs';
import * as path from 'path';
import type { ProviderSnapshot, StoredData, StoredPreferences } from '../shared/types';
import type { HistoryEntry } from '../domain/history';

const CURRENT_SCHEMA_VERSION = 1;
const DATA_FILENAME = 'data.json';
const HISTORY_FILENAME = 'history.json';
const MAX_HISTORY_PER_PROVIDER = 500;

const DEFAULT_PREFERENCES: StoredPreferences = {
  auto_refresh: true,
  default_refresh_interval_min: 30,
};

interface StoredHistory {
  schema_version: number;
  history: Record<string, HistoryEntry[]>;
}

function defaultData(): StoredData {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    snapshots: {},
    preferences: { ...DEFAULT_PREFERENCES },
  };
}

function defaultHistory(): StoredHistory {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    history: {},
  };
}

export class Store {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private get dataPath(): string {
    return path.join(this.dataDir, DATA_FILENAME);
  }

  private get historyPath(): string {
    return path.join(this.dataDir, HISTORY_FILENAME);
  }

  // ---- Full data read/write ----

  async loadData(): Promise<StoredData> {
    try {
      const raw = await fs.promises.readFile(this.dataPath, 'utf-8');
      const data = JSON.parse(raw) as StoredData;

      if (!data.schema_version || data.schema_version < CURRENT_SCHEMA_VERSION) {
        data.schema_version = CURRENT_SCHEMA_VERSION;
      }

      if (!data.snapshots) data.snapshots = {};
      if (!data.preferences) data.preferences = { ...DEFAULT_PREFERENCES };

      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return defaultData();
      }
      throw err;
    }
  }

  async saveData(data: StoredData): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    data.schema_version = CURRENT_SCHEMA_VERSION;
    const raw = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(this.dataPath, raw, 'utf-8');
  }

  // ---- Snapshot convenience methods ----

  async saveSnapshot(snapshot: ProviderSnapshot): Promise<void> {
    const data = await this.loadData();
    data.snapshots[snapshot.provider_id] = snapshot;
    await this.saveData(data);
  }

  async getSnapshot(providerId: string): Promise<ProviderSnapshot | null> {
    const data = await this.loadData();
    return data.snapshots[providerId] ?? null;
  }

  // ---- Preferences ----

  async getPreferences(): Promise<StoredPreferences> {
    const data = await this.loadData();
    return data.preferences;
  }

  async updatePreferences(partial: Partial<StoredPreferences>): Promise<void> {
    const data = await this.loadData();
    data.preferences = { ...data.preferences, ...partial };
    await this.saveData(data);
  }

  // ---- History (Phase 2) ----

  async loadHistory(): Promise<StoredHistory> {
    try {
      const raw = await fs.promises.readFile(this.historyPath, 'utf-8');
      const data = JSON.parse(raw) as StoredHistory;
      if (!data.history) data.history = {};
      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return defaultHistory();
      }
      throw err;
    }
  }

  async appendHistory(
    providerId: string,
    entry: HistoryEntry,
  ): Promise<void> {
    const data = await this.loadHistory();
    if (!data.history[providerId]) {
      data.history[providerId] = [];
    }

    data.history[providerId].push(entry);

    // Cap at MAX_HISTORY_PER_PROVIDER (FIFO)
    if (data.history[providerId].length > MAX_HISTORY_PER_PROVIDER) {
      data.history[providerId] = data.history[providerId].slice(
        -MAX_HISTORY_PER_PROVIDER,
      );
    }

    const raw = JSON.stringify(data, null, 2);
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.writeFile(this.historyPath, raw, 'utf-8');
  }

  async getHistory(providerId: string): Promise<HistoryEntry[]> {
    const data = await this.loadHistory();
    return data.history[providerId] ?? [];
  }
}
