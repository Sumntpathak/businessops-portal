import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
import { PageHeader } from "./PageHeader";

type PageWidth = "md" | "lg" | "full";

const widthClasses: Record<PageWidth, string> = {
  md: "max-w-2xl",
  lg: "max-w-4xl",
  full: "max-w-none",
};

interface PageShellProps {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}

export function PageShell({
  actions,
  breadcrumbs,
  children,
  className,
  description,
  meta,
  title,
  width = "full",
}: PageShellProps) {
  return (
    <div className={cn("min-w-0", widthClasses[width], className)}>
      {breadcrumbs}
      <PageHeader title={title} description={description} meta={meta} actions={actions} />
      <div className="min-w-0 space-y-4 sm:space-y-6">{children}</div>
    </div>
  );
}
