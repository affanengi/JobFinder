import React, { useState } from 'react';
import { LucideIcon, Lock, CheckCircle2, ArrowRight } from 'lucide-react';
import { AuthModal } from '../auth/AuthModal';

export interface AuthRequiredSecondaryAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

export interface AuthRequiredEmptyStateProps {
  icon?: LucideIcon;
  badge?: string;
  title: string;
  description: string;
  benefits?: string[];
  primaryActionText?: string;
  onPrimaryAction?: () => void;
  secondaryAction?: AuthRequiredSecondaryAction;
  authModalTitle?: string;
  authModalSubtitle?: string;
  className?: string;
}

export const AuthRequiredEmptyState: React.FC<AuthRequiredEmptyStateProps> = ({
  icon: Icon = Lock,
  badge,
  title,
  description,
  benefits,
  primaryActionText = 'Sign In / Create Account',
  onPrimaryAction,
  secondaryAction,
  authModalTitle,
  authModalSubtitle,
  className = '',
}) => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const handlePrimaryClick = () => {
    if (onPrimaryAction) {
      onPrimaryAction();
    } else {
      setIsAuthModalOpen(true);
    }
  };

  return (
    <div
      data-testid="auth-required-empty-state"
      className={`py-12 px-6 flex flex-col items-center justify-center text-center max-w-xl mx-auto ${className}`}
    >
      {/* Icon Container */}
      <div className="relative mb-4">
        <div className="w-14 h-14 rounded-2xl bg-neutral-900 border border-white/10 flex items-center justify-center text-white shadow-xl">
          <Icon className="w-7 h-7 text-neutral-200" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-neutral-950 border border-white/20 flex items-center justify-center text-amber-400">
          <Lock className="w-3 h-3" />
        </div>
      </div>

      {/* Optional Badge */}
      {badge && (
        <span className="mb-3 px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-white/5 border border-white/10 text-neutral-400 font-medium">
          {badge}
        </span>
      )}

      {/* Heading & Description */}
      <h3 className="text-base font-semibold text-white tracking-tight mb-2">
        {title}
      </h3>
      <p className="text-xs text-neutral-400 max-w-md leading-relaxed mb-6">
        {description}
      </p>

      {/* Optional Benefits List */}
      {benefits && benefits.length > 0 && (
        <div className="w-full bg-[#161616] border border-white/10 rounded-xl p-4 mb-6 text-left space-y-2">
          {benefits.map((benefit, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-xs text-neutral-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="leading-tight">{benefit}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handlePrimaryClick}
          className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-95"
        >
          <span>{primaryActionText}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="px-4 py-2 rounded-xl bg-[#222222] hover:bg-neutral-700 border border-white/20 text-white text-xs font-semibold transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            {secondaryAction.icon}
            <span>{secondaryAction.label}</span>
          </button>
        )}
      </div>

      {/* Auth Modal Portal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        title={authModalTitle}
        subtitle={authModalSubtitle}
      />
    </div>
  );
};
