import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
}

interface ThemeDropdownProps {
  options: DropdownOption[];
  selectedValue: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
}

export const ThemeDropdown: React.FC<ThemeDropdownProps> = ({
  options,
  selectedValue,
  onChange,
  icon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === selectedValue) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0D0D0D] border border-white/20 text-xs text-white hover:border-white/40 focus:outline-none transition-colors cursor-pointer select-none"
      >
        {icon && <span className="text-[#A3A3A3]">{icon}</span>}
        <span className="truncate max-w-[140px]">{selectedOption.label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#A3A3A3] transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-[#161616] border border-white/20 shadow-2xl p-1 z-50 animate-in fade-in slide-in-from-top-1 space-y-0.5">
          {options.map((option) => {
            const isSelected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                  isSelected
                    ? 'bg-white text-black font-semibold'
                    : 'text-[#A3A3A3] hover:text-white hover:bg-[#1F1F1F]'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-black shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
