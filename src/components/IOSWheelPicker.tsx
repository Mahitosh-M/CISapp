import { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface WheelPickerOption<T extends string> {
  label: string;
  value: T;
}

interface IOSWheelPickerProps<T extends string> {
  label?: string;
  options: WheelPickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

const IOSWheelPicker = <T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className = ''
}: IOSWheelPickerProps<T>) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const snapTimerRef = useRef<number | undefined>(undefined);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const pickerHeight = ITEM_HEIGHT * VISIBLE_ITEMS;
  const centerPadding = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;

  const optionValues = useMemo(() => options.map((option) => option.value).join('|'), [options]);

  const scrollToIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
    scrollRef.current?.scrollTo({
      top: index * ITEM_HEIGHT,
      behavior
    });
  };

  useEffect(() => {
    setActiveIndex(selectedIndex);
    scrollToIndex(selectedIndex, 'auto');
  }, [selectedIndex, optionValues]);

  useEffect(() => {
    return () => {
      if (snapTimerRef.current) {
        window.clearTimeout(snapTimerRef.current);
      }
    };
  }, []);

  const commitIndex = (index: number) => {
    const boundedIndex = Math.min(Math.max(index, 0), options.length - 1);
    const nextOption = options[boundedIndex];
    if (!nextOption) return;

    setActiveIndex(boundedIndex);
    if (nextOption.value !== value) {
      onChange(nextOption.value);
    }
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (disabled) return;

    const nextIndex = Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), options.length - 1));

    if (snapTimerRef.current) {
      window.clearTimeout(snapTimerRef.current);
    }

    snapTimerRef.current = window.setTimeout(() => {
      commitIndex(Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT));
    }, 90);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      scrollToIndex(Math.min(selectedIndex + 1, options.length - 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      scrollToIndex(Math.max(selectedIndex - 1, 0));
    }
  };

  return (
    <div className={`ios-wheel-picker relative isolate w-full overflow-hidden rounded-xl bg-white ${className}`}>
      {label ? <div className="ios-wheel-picker-label mb-2 text-sm font-extrabold text-slate-900">{label}</div> : null}
      <div
        className="ios-wheel-picker-frame relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
        style={{ height: pickerHeight }}
      >
        <div className="ios-wheel-picker-guides pointer-events-none absolute inset-x-0 z-10" aria-hidden="true" />
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={label}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          className="ios-wheel-picker-scroll h-full overflow-y-auto overscroll-contain scroll-smooth"
          style={{
            paddingTop: centerPadding,
            paddingBottom: centerPadding,
            scrollSnapType: 'y mandatory'
          }}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
        >
          {options.map((option, index) => {
            const distance = Math.abs(index - activeIndex);
            const clampedDistance = Math.min(distance, 3);
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                className="ios-wheel-picker-item flex w-full items-center justify-center px-4 text-center font-extrabold text-slate-900"
                style={{
                  height: ITEM_HEIGHT,
                  scrollSnapAlign: 'center',
                  opacity: Math.max(0.28, 1 - clampedDistance * 0.22),
                  transform: `perspective(420px) rotateX(${index < activeIndex ? 16 * clampedDistance : -16 * clampedDistance}deg) scale(${1 - clampedDistance * 0.045})`
                }}
                onClick={() => scrollToIndex(index)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default IOSWheelPicker;
