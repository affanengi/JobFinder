import React from 'react'
import { cn } from '../../lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', children, disabled, ...props }, ref) => {
    const variantStyles = {
      primary: 'bg-white text-black hover:bg-neutral-200 active:bg-neutral-300 font-semibold shadow-sm',
      secondary: 'bg-surface-subtle text-primary hover:bg-surface-hover active:bg-[#2A2A2A] border border-border font-medium',
      outline: 'bg-transparent text-primary hover:bg-surface-subtle border border-border-strong font-medium',
      ghost: 'bg-transparent text-primary-secondary hover:text-primary hover:bg-surface-subtle font-medium',
      danger: 'bg-danger-soft text-danger hover:bg-danger/20 border border-danger-border font-medium',
    }

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1.5',
      md: 'text-xs px-3.5 py-2 rounded-md gap-2',
      lg: 'text-sm px-4 py-2.5 rounded-lg gap-2',
      icon: 'p-2 rounded-md aspect-square',
    }

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-white',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
