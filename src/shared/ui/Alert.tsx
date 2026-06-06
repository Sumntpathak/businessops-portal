import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { radiusControl } from "@/shared/ui/styles";

type AlertVariant = "error" | "info";

const variants: Record<AlertVariant, string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-gray-200 bg-gray-50 text-gray-700",
};

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

export function Alert({ className, variant = "error", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(radiusControl, "border px-4 py-3 text-sm", variants[variant], className)}
      {...props}
    />
  );
}
