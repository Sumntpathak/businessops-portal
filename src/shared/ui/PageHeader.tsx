import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ actions, className, description, meta, title }: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex min-w-0 flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {meta && <div className="mb-3">{meta}</div>}
        <h1 className="break-words text-xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end sm:gap-3">{actions}</div>}
    </div>
  );
}
