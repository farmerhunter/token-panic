import { useState, useEffect, useCallback } from 'react';
import type { ProviderSummary } from '@shared/types';

export function useProviderSummary(
  providerId: string,
  initialSummary: ProviderSummary | null = null,
) {
  const [summary, setSummary] = useState<ProviderSummary | null>(initialSummary);
  const [loading, setLoading] = useState(initialSummary === null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      console.error('electronAPI not available');
      setLoading(false);
      return;
    }

    const unsub1 = api.onSnapshotUpdated((s) => {
      if (s.provider_id === providerId) {
        setSummary(s);
        setLoading(false);
      }
    });

    const unsub2 = api.onSnapshotReply((s) => {
      if (s.provider_id === providerId) {
        setSummary(s);
        setLoading(false);
      }
    });

    // Request current snapshot on mount
    api.requestSnapshot();

    return () => {
      unsub1();
      unsub2();
    };
  }, [providerId]);

  const refresh = useCallback(() => {
    setLoading(true);
    window.electronAPI?.triggerRefresh(providerId);
  }, [providerId]);

  return { summary, loading, refresh };
}

export function useSnapshot(
  providerId: string,
  initialSummary: ProviderSummary | null = null,
) {
  return useProviderSummary(providerId, initialSummary);
}
