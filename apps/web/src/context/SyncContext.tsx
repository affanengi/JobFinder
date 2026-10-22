import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

export type SyncStatus = 'SIGNED_OUT' | 'CONNECTING_CLOUD' | 'SYNCED' | 'DEGRADED';

interface PersistenceRecord {
  timestamp: number;
  operation: string;
}

interface FailureRecord {
  timestamp: number;
  operation: string;
  error?: string;
}

export interface SyncContextValue {
  status: SyncStatus;
  statusLabel: string;
  statusDetail: string;
  isOnline: boolean;
  recordPersistenceSuccess: (operation: string) => void;
  recordPersistenceFailure: (operation: string, error?: string) => void;
  resetSyncEvidence: () => void;
}

export const defaultSyncContext: SyncContextValue = {
  status: 'SIGNED_OUT',
  statusLabel: 'Guest Mode · Local Only',
  statusDetail: 'Signing in enables account-specific cloud persistence.',
  isOnline: true,
  recordPersistenceSuccess: () => {},
  recordPersistenceFailure: () => {},
  resetSyncEvidence: () => {},
};

const SyncContext = createContext<SyncContextValue>(defaultSyncContext);

export interface SyncProviderProps {
  children: React.ReactNode;
  initialStatus?: SyncStatus;
}

export const SyncProvider: React.FC<SyncProviderProps> = ({ children, initialStatus }) => {
  const { user, loading } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [lastSuccess, setLastSuccess] = useState<PersistenceRecord | null>(null);
  const [lastFailure, setLastFailure] = useState<FailureRecord | null>(null);
  const activeUserIdRef = useRef<string | null>(null);

  // Handle online / offline events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Invalidate and reset evidence on sign-out, account switch, or logout event
  const resetSyncEvidence = useCallback(() => {
    setLastSuccess(null);
    setLastFailure(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleLogout = () => {
      resetSyncEvidence();
      activeUserIdRef.current = null;
    };

    window.addEventListener('jobfinder:logout', handleLogout);
    return () => window.removeEventListener('jobfinder:logout', handleLogout);
  }, [resetSyncEvidence]);

  // Account switch safety: if the user identity changes, immediately discard prior user's sync evidence
  useEffect(() => {
    const currentUid = user?.uid || null;
    if (currentUid !== activeUserIdRef.current) {
      activeUserIdRef.current = currentUid;
      resetSyncEvidence();
    }
  }, [user?.uid, resetSyncEvidence]);

  const recordPersistenceSuccess = useCallback((operation: string) => {
    setLastSuccess({
      timestamp: Date.now(),
      operation,
    });
  }, []);

  const recordPersistenceFailure = useCallback((operation: string, error?: string) => {
    setLastFailure({
      timestamp: Date.now(),
      operation,
      error,
    });
  }, []);

  // Compute honest evidence-based status
  let status: SyncStatus;
  let statusLabel: string;
  let statusDetail: string;

  if (initialStatus) {
    status = initialStatus;
    switch (initialStatus) {
      case 'SIGNED_OUT':
        statusLabel = 'Guest Mode · Local Only';
        statusDetail = 'Signing in enables account-specific cloud persistence.';
        break;
      case 'CONNECTING_CLOUD':
        statusLabel = 'Connecting to Cloud...';
        statusDetail = 'Initializing secure cloud connection...';
        break;
      case 'SYNCED':
        statusLabel = 'Cloud Synced';
        statusDetail = 'Changes persisted to Google Cloud Firestore.';
        break;
      case 'DEGRADED':
        statusLabel = 'Sync Degraded';
        statusDetail = 'A recent cloud persistence operation failed.';
        break;
    }
  } else if (loading) {
    status = 'CONNECTING_CLOUD';
    statusLabel = 'Connecting to Cloud...';
    statusDetail = 'Initializing secure cloud connection...';
  } else if (!user) {
    status = 'SIGNED_OUT';
    statusLabel = 'Guest Mode · Local Only';
    statusDetail = 'Signing in enables account-specific cloud persistence.';
  } else if (!isOnline) {
    status = 'DEGRADED';
    statusLabel = 'Sync Degraded';
    statusDetail = 'Network connection offline · Cloud sync paused.';
  } else if (lastFailure && (!lastSuccess || lastFailure.timestamp > lastSuccess.timestamp)) {
    status = 'DEGRADED';
    statusLabel = 'Sync Degraded';
    statusDetail = lastFailure.error || `Persistence failed for ${lastFailure.operation}.`;
  } else if (lastSuccess && (!lastFailure || lastSuccess.timestamp >= lastFailure.timestamp)) {
    status = 'SYNCED';
    statusLabel = 'Cloud Synced';
    statusDetail = `Changes confirmed persisted to Google Cloud Firestore (${lastSuccess.operation}).`;
  } else {
    // Authenticated user with no active persistence evidence yet
    status = 'CONNECTING_CLOUD';
    statusLabel = 'Connecting to Cloud...';
    statusDetail = 'Authenticated session active. Awaiting cloud synchronization confirmation.';
  }

  const value: SyncContextValue = {
    status,
    statusLabel,
    statusDetail,
    isOnline,
    recordPersistenceSuccess,
    recordPersistenceFailure,
    resetSyncEvidence,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSync = (): SyncContextValue => {
  const context = useContext(SyncContext);
  return context || defaultSyncContext;
};
