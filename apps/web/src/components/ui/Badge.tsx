import React from 'react'
import { cn } from '../../lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'neutral'
  size?: 'sm' | 'md'
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const variantStyles = {
    default: 'bg-surface-subtle text-primary border-border',
    neutral: 'bg-surface-subtle text-primary-secondary border-border',
    success: 'bg-success-soft text-success border-success-border',
    warning: 'bg-warning-soft text-warning border-warning-border',
    danger: 'bg-danger-soft text-danger border-danger-border',
    info: 'bg-info-soft text-info border-info-border',
    outline: 'bg-transparent text-primary-secondary border-border-strong',
  }

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-md border tracking-tight transition-colors',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
