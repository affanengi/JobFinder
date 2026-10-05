import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useScrollLock } from '../../hooks/useScrollLock';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  headerContent?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  headerContent,
  footer,
  children,
  className,
  bodyClassName,
  maxWidth = '2xl',
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
}: ModalProps) {
  useScrollLock(isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnBackdropClick) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-xl animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative w-full bg-surface border border-border-strong rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-150',
          maxWidthStyles[maxWidth],
          className
        )}
      >
        {(title || description || showCloseButton) && (
          <div className="px-6 py-4 border-b border-border flex items-start justify-between bg-surface shrink-0">
            <div className="flex-1 mr-4">
              {title && (
                typeof title === 'string' ? (
                  <h3 className="text-base font-semibold text-primary">{title}</h3>
                ) : (
                  <div className="text-base font-semibold text-primary">{title}</div>
                )
              )}
              {description && (
                typeof description === 'string' ? (
                  <p className="text-xs text-primary-secondary mt-0.5">{description}</p>
                ) : (
                  <div className="text-xs text-primary-secondary mt-0.5">{description}</div>
                )
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-primary-secondary hover:text-primary hover:bg-surface-subtle transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {headerContent && (
          <div className="border-b border-border bg-surface-subtle shrink-0">
            {headerContent}
          </div>
        )}

        <div className={cn('overflow-y-auto flex-1', bodyClassName ?? 'p-6')}>
          {children}
        </div>

        {footer && (
          <div className="px-6 py-3.5 border-t border-border bg-surface-subtle/50 shrink-0 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
