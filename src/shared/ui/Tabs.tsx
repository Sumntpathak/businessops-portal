"use client";

import { cn } from "@/shared/utils/cn";
import { focusRing, radiusControl, transitionBase } from "@/shared/ui/styles";

interface TabItem<T extends string> {
  label: string;
  value: T;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Tabs<T extends string>({ label, onChange, tabs, value }: TabsProps<T>) {
  return (
    <div aria-label={label} className={cn("inline-flex border border-gray-200 bg-gray-50 p-1", radiusControl)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            radiusControl,
            "px-4 py-1.5 text-sm font-medium",
            transitionBase,
            focusRing,
            value === tab.value ? "bg-white text-gray-950 shadow-sm" : "text-gray-500 hover:text-gray-800",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
