import Link from "next/link";
import { cn } from "@/shared/utils/cn";
import { linkBase, transitionBase } from "@/shared/ui/styles";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-5 flex min-w-0 flex-wrap items-center gap-2 text-sm sm:mb-6", className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span key={`${item.label}-${index}`} className="inline-flex min-w-0 items-center gap-2">
            {index > 0 && <span className="text-gray-300" aria-hidden>/</span>}
            {item.href && !isLast ? (
              <Link href={item.href} className={cn(linkBase, "break-words font-normal text-gray-500 hover:text-gray-800")}>
                {item.label}
              </Link>
            ) : (
              <span className={cn("break-words", isLast && "font-medium text-gray-950", transitionBase)}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
