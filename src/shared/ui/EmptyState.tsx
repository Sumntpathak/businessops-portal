import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ action, description, title }: EmptyStateProps) {
  return (
    <div className="px-4 py-10 text-center sm:px-5 sm:py-12">
      <p className="break-words text-sm font-semibold text-gray-800">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md break-words text-sm leading-6 text-gray-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
