"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utils/cn";
import { controlBase, controlError, helperBase, labelBase } from "@/shared/ui/styles";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  error?: string;
  hint?: string;
  hideLabel?: boolean;
  placeholder?: string;
  wrapperClassName?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  className,
  error,
  hideLabel,
  hint,
  id,
  label,
  options,
  placeholder,
  wrapperClassName,
  value = "",
  onChange,
  name,
  disabled,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectId = id ?? name ?? "custom-select";

  const allOptions = placeholder
    ? [{ label: placeholder, value: "" }, ...options]
    : options;

  const currentOption = allOptions.find((opt) => opt.value === value) ?? allOptions[0];

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (val: string) => {
    if (disabled) return;
    setIsOpen(false);
    if (onChange && val !== value) {
      // Simulate React Change Event for HTMLSelectElement compatibility
      const mockEvent = {
        target: {
          name,
          id: selectId,
          value: val,
        },
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange(mockEvent);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown" && isOpen) {
      e.preventDefault();
      const currentIndex = allOptions.findIndex((opt) => opt.value === value);
      const nextIndex = currentIndex < allOptions.length - 1 ? currentIndex + 1 : 0;
      handleSelect(allOptions[nextIndex].value);
    } else if (e.key === "ArrowUp" && isOpen) {
      e.preventDefault();
      const currentIndex = allOptions.findIndex((opt) => opt.value === value);
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : allOptions.length - 1;
      handleSelect(allOptions[prevIndex].value);
    }
  };

  return (
    <div ref={containerRef} className={cn("block text-left", wrapperClassName)}>
      {label && (
        <span className={cn(labelBase, hideLabel && "sr-only", "mb-1")}>
          {label}
        </span>
      )}
      <div className="relative">
        <button
          id={selectId}
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          onKeyDown={handleKeyDown}
          className={cn(
            controlBase,
            "relative flex w-full items-center justify-between text-left pr-10",
            "border border-gray-200 bg-white px-3 text-sm text-gray-950 shadow-sm transition-all duration-200",
            "focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none",
            disabled && "cursor-not-allowed opacity-60 bg-gray-50",
            error && controlError,
            className
          )}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span className="truncate">
            {currentOption ? currentOption.label : placeholder ?? "Select..."}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
            <Icon name="chevronDown" />
          </span>
        </button>

        {isOpen && (
          <div
            className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white p-1 shadow-md ring-1 ring-black/5"
            role="listbox"
            aria-labelledby={label ? selectId : undefined}
          >
            <div className="max-h-60 overflow-y-auto">
              {allOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50",
                      isSelected && "bg-blue-50/50 text-blue-700 font-medium"
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && (
                      <Icon name="check" className="text-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {(error || hint) && (
        <span
          id={`${selectId}-helper`}
          className={cn(helperBase, error ? "text-red-600" : "text-gray-500")}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
