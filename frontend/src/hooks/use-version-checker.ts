import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { VersionCheckResult } from '@agemon/shared';

export function useVersionChecker() {
  const [versionInfo, setVersionInfo] = useState<VersionCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.checkForUpdates(refresh);
      setVersionInfo(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return { versionInfo, loading, error, check };
}
