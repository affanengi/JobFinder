import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useScrollLock } from '../../hooks/useScrollLock'

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  className?: string
  width?: string
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  className,
  width = 'max-w-2xl'
}: DrawerProps) {
  useScrollLock(isOpen);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
      className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full h-full bg-surface border-l border-border-strong shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-150',
          width,
          className
        )}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between bg-surface shrink-0">
          <div className="flex-1 pr-4">
            {typeof title === 'string' ? (
              <h2 className="text-base font-semibold text-primary">{title}</h2>
            ) : (
              title
            )}
            {subtitle && <div className="text-xs text-primary-secondary mt-1">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-primary-secondary hover:text-primary hover:bg-surface-subtle transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-6">{children}</div>
      </div>
    </div>,
    document.body
  )
}
