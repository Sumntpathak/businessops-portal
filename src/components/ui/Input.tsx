import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ className, error, hint, id, label, ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <label className="block" htmlFor={inputId}>
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <input
        id={inputId}
        className={cn(
          "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200",
          error && "border-red-300 focus:border-red-500 focus:ring-red-100",
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${inputId}-helper` : undefined}
        {...props}
      />
      {(error || hint) && (
        <span
          id={`${inputId}-helper`}
          className={cn("mt-1 block text-xs", error ? "text-red-600" : "text-slate-500")}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
