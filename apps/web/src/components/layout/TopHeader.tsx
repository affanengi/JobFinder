import React, { useState } from 'react';
import { Search, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../context/SyncContext';
import { AuthModal } from '../auth/AuthModal';
import { LogoutConfirmModal } from '../auth/LogoutConfirmModal';
import { SyncStatusBadge } from '../common/SyncStatusBadge';

interface TopHeaderProps {
  pageTitle: string;
  pageSubtitle?: string;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ pageTitle, pageSubtitle }) => {
  const { user, logout } = useAuth();
  const { status: syncStatus, isOnline } = useSync();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const isDegraded = !isOnline || syncStatus === 'DEGRADED';

  return (
    <>
      <header className="h-14 border-b border-white/40 bg-[#0D0D0D] px-6 flex items-center justify-between sticky top-0 z-30 shrink-0 w-full">
        <div className="flex flex-col justify-center">
          <h2 className="text-sm font-semibold text-white tracking-tight leading-none">{pageTitle}</h2>
          {pageSubtitle && <p className="text-[11px] text-[#A3A3A3] leading-none mt-1">{pageSubtitle}</p>}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[#1F1F1F] border border-white/20 rounded-lg text-xs text-[#A3A3A3]">
            <Search className="w-3.5 h-3.5 text-[#A3A3A3]" />
            <span>Quick search (Cmd+K)</span>
          </div>

          {/* Firebase Auth & Cloud Sync Status */}
          {user ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#161616] border border-white/20 text-xs text-white font-medium">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-4 h-4 rounded-full" />
                ) : (
                  <UserIcon className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span className="truncate max-w-[120px]">{user.displayName || user.email?.split('@')[0]}</span>
              </div>

              <button
                onClick={() => setIsLogoutModalOpen(true)}
                className="p-1.5 rounded-lg border border-white/10 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>

              {/* Connected to cloud indicator dot */}
              <div
                className={`flex items-center justify-center p-1.5 rounded-full ${
                  isDegraded
                    ? 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                    : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                }`}
                title={isDegraded ? 'Cloud Sync Degraded · Offline or Persistence Issue' : 'Connected to Cloud'}
                aria-label={isDegraded ? 'Cloud Sync Degraded' : 'Connected to Cloud'}
              >
                <span className="relative flex h-2 w-2">
                  {!isDegraded && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isDegraded ? 'bg-rose-500' : 'bg-emerald-400'}`}></span>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In / Sync</span>
              </button>
              <SyncStatusBadge />
            </div>
          )}
        </div>
      </header>

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      <LogoutConfirmModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={logout}
      />
    </>
  );
};
