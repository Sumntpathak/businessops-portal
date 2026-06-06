import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { badgeBase } from "@/shared/ui/styles";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(badgeBase, "border-gray-200 bg-gray-50 text-gray-700", className)}
      {...props}
    />
  );
}
