import { useState, useEffect, useCallback } from 'react';
import type { ProviderSummary } from '@shared/types';

export function useSnapshot() {
  const [summary, setSummary] = useState<ProviderSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      console.error('electronAPI not available');
      setLoading(false);
      return;
    }

    // Listen for push updates
    api.onSnapshotUpdated((newSummary) => {
      setSummary(newSummary);
      setLoading(false);
    });

    // Listen for reply to our request
    api.onSnapshotReply((newSummary) => {
      setSummary(newSummary);
      setLoading(false);
    });

    // Request current snapshot on mount
    api.requestSnapshot();
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    window.electronAPI?.triggerRefresh('deepseek');
  }, []);

  return { summary, loading, refresh };
}
