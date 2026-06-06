import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { controlBase, controlError, helperBase, labelBase } from "@/shared/ui/styles";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  wrapperClassName?: string;
  icon?: ReactNode;
}

export function Input({ className, error, hideLabel, hint, id, label, wrapperClassName, icon, ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <label className={cn("block", wrapperClassName)} htmlFor={inputId}>
      {label && (
        <span className={cn(labelBase, hideLabel && "sr-only")}>{label}</span>
      )}
      <div className={cn("relative", label && !hideLabel && "mt-1")}>
        {icon && (
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className={cn(
            controlBase,
            "py-2.5",
            icon ? "pl-10" : "",
            error && controlError,
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${inputId}-helper` : undefined}
          {...props}
        />
      </div>
      {(error || hint) && (
        <span
          id={`${inputId}-helper`}
          className={cn(helperBase, error ? "text-red-600" : "text-gray-500")}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

