import type { ReactNode } from "react";

/**
 * Standard dashboard page frame: a fixed header connected to the topbar and a
 * body that scrolls internally, so content never slides behind the header.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <section className="flex h-full min-h-0 flex-col">{children}</section>;
}

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, actions, children }: PageHeaderProps) {
  return (
    <div className="-mx-5 -mt-5 shrink-0 border-b bg-background px-5 py-4 sm:-mx-8 sm:-mt-8 sm:px-8 sm:py-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
          <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight">{title}</h1>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function PageBody({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={"-mx-1 mt-5 min-h-0 flex-1 overflow-y-auto px-1 pb-1 " + className}>
      {children}
    </div>
  );
}
