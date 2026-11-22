import React from 'react';

interface Ios26ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  accent?: 'green' | 'blue' | 'orange';
  ariaLabel?: string;
}

const TOGGLE_ACCENTS: Record<NonNullable<Ios26ToggleProps['accent']>, string> = {
  green: 'bg-[#30d158]',
  blue: 'bg-[#0a84ff]',
  orange: 'bg-[#ff9f0a]',
};

/**
 * iOS 26 Capsule Switch: elongated pill track (54x28) with a horizontal
 * capsule thumb (30x22) and spring-physics glide.
 */
export const Ios26Toggle: React.FC<Ios26ToggleProps> = ({
  checked,
  onChange,
  accent = 'green',
  ariaLabel,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className={`group relative inline-flex h-[28px] w-[54px] shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors duration-200 ${
      checked ? TOGGLE_ACCENTS[accent] : 'bg-[#48484a]'
    }`}
    style={{
      boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
    }}
  >
    <span
      className={`pointer-events-none block h-[22px] w-[30px] rounded-full bg-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-active:w-[34px] ${
        checked ? 'translate-x-[18px] group-active:translate-x-[14px]' : 'translate-x-0'
      }`}
      style={{
        boxShadow:
          '0 2px 8px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.85)',
      }}
    />
  </button>
);

interface Ios26SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  accent?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * iOS 26 Capsule Slider: recessed 6px capsule track with dynamic filled progress
 * and a floating white horizontal pill thumb (32x20).
 */
export const Ios26Slider: React.FC<Ios26SliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  accent = '#0a84ff',
  className = 'w-full',
  ariaLabel,
}) => {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      className={`ios26-slider ${className}`}
      style={
        {
          '--slider-pct': `${pct}%`,
          '--slider-accent': accent,
        } as React.CSSProperties
      }
    />
  );
};
