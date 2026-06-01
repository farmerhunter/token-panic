import type { ProviderAdapter, AdapterContext, FetchResult } from '../shared/types';

type FetchCallback = (
  adapter: ProviderAdapter,
  context: AdapterContext,
) => Promise<FetchResult>;

interface ScheduledProvider {
  adapter: ProviderAdapter;
  callback: FetchCallback;
  timer: NodeJS.Timeout | null;
  inProgress: boolean;
}

/**
 * Simple scheduler that manages periodic refresh for each provider.
 *
 * Key behaviors:
 * - Each provider has its own timer based on refresh_interval_min
 * - Manual refresh (triggerNow) skips the queue if a fetch is in progress
 * - Adapters receive their API key from the credential store (wired in index.ts)
 */
class Scheduler {
  private providers = new Map<string, ScheduledProvider>();
  private apiKeys = new Map<string, string>();

  register(
    adapter: ProviderAdapter,
    callback: FetchCallback,
  ): void {
    this.providers.set(adapter.id, {
      adapter,
      callback,
      timer: null,
      inProgress: false,
    });
  }

  setApiKey(providerId: string, apiKey: string | null): void {
    if (apiKey) {
      this.apiKeys.set(providerId, apiKey);
    } else {
      this.apiKeys.delete(providerId);
    }
  }

  startAll(): void {
    for (const [, entry] of this.providers) {
      this.startTimer(entry);
    }
  }

  stopAll(): void {
    for (const [, entry] of this.providers) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
    }
  }

  async triggerNow(providerId: string): Promise<void> {
    const entry = this.providers.get(providerId);
    if (!entry || entry.inProgress) return;

    entry.inProgress = true;
    try {
      const apiKey = this.apiKeys.get(providerId);
      await entry.callback(entry.adapter, { apiKey });
    } finally {
      entry.inProgress = false;
    }
  }

  private startTimer(entry: ScheduledProvider): void {
    if (entry.timer) {
      clearInterval(entry.timer);
    }
    const intervalMs = entry.adapter.refresh_interval_min * 60 * 1000;
    entry.timer = setInterval(() => {
      this.triggerNow(entry.adapter.id);
    }, intervalMs);
  }
}

// Singleton — one scheduler per process
let instance: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!instance) {
    instance = new Scheduler();
  }
  return instance;
}
