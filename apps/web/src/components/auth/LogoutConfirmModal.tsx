import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, AlertTriangle, Loader2 } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleLogout = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (err: unknown) {
      console.error('Logout error:', err);
      setError(err instanceof Error ? err.message : 'Sign-out failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-modal-title"
      aria-describedby="logout-modal-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#141414] border border-white/20 rounded-xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-white"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 id="logout-modal-title" className="text-sm font-semibold tracking-tight text-white">
              Log out of JobFinder?
            </h3>
            <p id="logout-modal-desc" className="text-xs text-[#A3A3A3] leading-relaxed">
              Are you sure you want to log out? Outstanding requests will be cancelled and private workspace data will be cleared from this browser session.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/10">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-white/20 bg-[#1F1F1F] text-xs font-medium text-[#D4D4D4] hover:bg-[#2A2A2A] hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleLogout}
            className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Logging out...</span>
              </>
            ) : (
              <>
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
