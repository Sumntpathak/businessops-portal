import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { controlBase, controlError, helperBase, labelBase } from "@/shared/ui/styles";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  wrapperClassName?: string;
}

export function Textarea({
  className,
  error,
  hideLabel,
  hint,
  id,
  label,
  wrapperClassName,
  ...props
}: TextareaProps) {
  const textareaId = id ?? props.name;

  return (
    <label className={cn("block", wrapperClassName)} htmlFor={textareaId}>
      {label && (
        <span className={cn(labelBase, hideLabel && "sr-only")}>{label}</span>
      )}
      <textarea
        id={textareaId}
        className={cn(
          controlBase,
          "resize-y py-2.5",
          label && !hideLabel && "mt-1",
          error && controlError,
          className,
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${textareaId}-helper` : undefined}
        {...props}
      />
      {(error || hint) && (
        <span
          id={`${textareaId}-helper`}
          className={cn(helperBase, error ? "text-red-600" : "text-gray-500")}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
