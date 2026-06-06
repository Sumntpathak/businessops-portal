import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";

export function CardToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-end gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-4 sm:px-5", className)}
      {...props}
    />
  );
}
