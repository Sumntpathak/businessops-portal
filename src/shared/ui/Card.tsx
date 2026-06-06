import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { radiusSurface } from "@/shared/ui/styles";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(radiusSurface, "border border-gray-200 bg-white shadow-[0_1px_2px_rgba(17,24,39,0.04)]", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-gray-100 px-4 py-4 sm:px-5", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-5 sm:py-5", className)} {...props} />;
}
