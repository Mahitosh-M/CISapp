import { useCallback, useEffect, useState } from 'react';
import { getAppSettings } from '../services/firestoreService';
import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS, mergeWithDefaultSettings } from '../utils/settings';

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setSettings(mergeWithDefaultSettings(await getAppSettings()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load ERP settings.');
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return {
    settings,
    loading,
    error,
    refreshSettings
  };
};
